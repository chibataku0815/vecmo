/**
 * Pure, dependency-free PNG encoder for RGBA bitmaps. It exists so a rasterized
 * mesh ({@link ./raster}) can be embedded as an `<image href="data:image/png…">`
 * identically in the browser (live canvas + client SVG export) and in the
 * Cloudflare Worker — neither of which can share a single `OffscreenCanvas`/`btoa`
 * path. Using one deterministic encoder everywhere also keeps the cross-environment
 * fidelity fixture meaningful and lets the SVG-export unit test run under Node.
 *
 * Encoding: 8-bit RGBA (PNG color type 6), one adaptively-filtered scanline per row
 * (RFC 2083 §6.2 — all five standard filters evaluated per row, minimum-sum-of-abs
 * chosen), compressed with a from-scratch DEFLATE implementation (RFC 1951: LZ77 +
 * Huffman coding), wrapped in a zlib stream (RFC 1950).
 *
 * DETERMINISM CONTRACT: output bytes are a pure function of `(pixels, width,
 * height)` — integer-only arithmetic, no clocks, no randomness, and no
 * engine-provided compressor. `CompressionStream`/Node's native zlib bindings are
 * deliberately NOT used here even though they implement the same RFCs: they are
 * async (this encoder is called from synchronous render/export paths) and their
 * exact byte output is an implementation detail of the underlying engine (V8/zlib
 * version), not a spec guarantee. Two different runtimes calling
 * `CompressionStream` on identical input can legally emit different (still valid)
 * DEFLATE streams. That would break the one property this module is designed to
 * protect: the browser, Node (Vitest), and Cloudflare Worker must produce
 * byte-identical PNGs from the same pixels, because the cross-environment fidelity
 * fixture and the code-export runtime player diff against this encoder's exact
 * output. A hand-rolled, spec-pinned encoder is the only way to keep that
 * property independent of host engine internals.
 */

// ---------------------------------------------------------------------------
// PNG container (RFC 2083)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const BASE64_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 output is joined from chunks this large (chars) instead of one `+=` per quantum. */
const BASE64_JOIN_CHUNK_CHARS = 3072;

const crcTable: Uint32Array = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

/** CRC-32 (IEEE 802.3 polynomial) over a byte range, per RFC 2083 Annex D. */
function crc32(bytes: Uint8Array, start: number, end: number): number {
	let crc = 0xffffffff;
	for (let i = start; i < end; i += 1) {
		crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32 checksum (RFC 1950 §8.2), batched at NMAX so `b` never overflows before its modulo. */
function adler32(bytes: Uint8Array): number {
	const MOD_ADLER = 65521;
	/** Largest N such that `255*N*(N+1)/2 + (N+1)*(MOD_ADLER-1) <= 2^32-1`. */
	const NMAX = 5552;
	let a = 1;
	let b = 0;
	let offset = 0;
	const { length } = bytes;
	while (offset < length) {
		const span = Math.min(NMAX, length - offset);
		const end = offset + span;
		for (let i = offset; i < end; i += 1) {
			a += bytes[i];
			b += a;
		}
		a %= MOD_ADLER;
		b %= MOD_ADLER;
		offset = end;
	}
	return ((b << 16) | a) >>> 0;
}

/** Growable byte buffer so encoder stages never `push(...)`/spread bulk typed data. */
class ByteWriter {
	private buffer: Uint8Array;
	private len = 0;

	constructor(initialCapacity: number) {
		this.buffer = new Uint8Array(Math.max(64, initialCapacity));
	}

	private ensure(extra: number): void {
		if (this.len + extra <= this.buffer.length) return;
		let capacity = this.buffer.length * 2;
		while (capacity < this.len + extra) capacity *= 2;
		const next = new Uint8Array(capacity);
		next.set(this.buffer.subarray(0, this.len));
		this.buffer = next;
	}

	byte(value: number): void {
		this.ensure(1);
		this.buffer[this.len] = value & 0xff;
		this.len += 1;
	}

	bytes(values: Uint8Array): void {
		this.ensure(values.length);
		this.buffer.set(values, this.len);
		this.len += values.length;
	}

	u32be(value: number): void {
		this.ensure(4);
		this.buffer[this.len] = (value >>> 24) & 0xff;
		this.buffer[this.len + 1] = (value >>> 16) & 0xff;
		this.buffer[this.len + 2] = (value >>> 8) & 0xff;
		this.buffer[this.len + 3] = value & 0xff;
		this.len += 4;
	}

	get length(): number {
		return this.len;
	}

	/** Snapshot as an exactly-sized view (no trailing unused capacity). */
	toUint8Array(): Uint8Array {
		return this.buffer.subarray(0, this.len);
	}
}

/** One PNG chunk: 4-byte big-endian length, 4-byte ASCII type, data, CRC-32 over type+data. */
function writeChunk(out: ByteWriter, type: string, data: Uint8Array): void {
	out.u32be(data.length);
	const typeStart = out.length;
	for (let i = 0; i < type.length; i += 1) out.byte(type.charCodeAt(i));
	out.bytes(data);
	// CRC covers type + data, which is exactly the range just written.
	const scratch = out.toUint8Array();
	out.u32be(crc32(scratch, typeStart, scratch.length));
}

// ---------------------------------------------------------------------------
// Per-row adaptive filtering (RFC 2083 §6.2)
// ---------------------------------------------------------------------------

/** Bytes per pixel for 8-bit RGBA (color type 6). Every filter below assumes this stride. */
const BYTES_PER_PIXEL = 4;

const FILTER_NONE = 0;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

/** Paeth predictor (RFC 2083 §6.6): picks whichever neighbour is closest to `a + b − c`. */
function paethPredictor(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	if (pb <= pc) return b;
	return c;
}

/**
 * Applies one of the five RFC 2083 filters to a scanline into `dst` (length
 * `1 + rowBytes`, byte 0 is the filter-type tag). `prior` is the previous row's
 * RAW (unfiltered) bytes, or `undefined` for row 0 (treated as all-zero per spec).
 */
function applyFilter(
	dst: Uint8Array,
	filterType: number,
	row: Uint8Array,
	rowStart: number,
	rowBytes: number,
	prior: Uint8Array | undefined,
	priorStart: number,
): void {
	dst[0] = filterType;
	for (let i = 0; i < rowBytes; i += 1) {
		const x = row[rowStart + i];
		const a = i >= BYTES_PER_PIXEL ? row[rowStart + i - BYTES_PER_PIXEL] : 0;
		const b = prior ? prior[priorStart + i] : 0;
		const c =
			prior && i >= BYTES_PER_PIXEL
				? prior[priorStart + i - BYTES_PER_PIXEL]
				: 0;
		let filtered: number;
		switch (filterType) {
			case FILTER_SUB:
				filtered = x - a;
				break;
			case FILTER_UP:
				filtered = x - b;
				break;
			case FILTER_AVERAGE:
				filtered = x - Math.floor((a + b) / 2);
				break;
			case FILTER_PAETH:
				filtered = x - paethPredictor(a, b, c);
				break;
			default:
				filtered = x;
				break;
		}
		dst[1 + i] = filtered & 0xff;
	}
}

/** Sum of |signed byte value| — RFC 2083's recommended minimum-sum-of-absolute-values heuristic. */
function filteredSum(dst: Uint8Array, rowBytes: number): number {
	let sum = 0;
	for (let i = 1; i <= rowBytes; i += 1) {
		// Interpret the filtered byte as signed (two's complement) before taking |.|.
		const signed = (dst[i] << 24) >> 24;
		sum += Math.abs(signed);
	}
	return sum;
}

/**
 * Produces the filtered scanline stream DEFLATE compresses: for every row, all
 * five filters are tried and the one with the lowest sum-of-absolute-values wins
 * (ties broken by lowest filter id). Deterministic and free of any encoder-only
 * heuristic randomness. Output length is exactly `height * (1 + width *
 * BYTES_PER_PIXEL)`, matching the spec's documented contract.
 */
function filterScanlines(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
): Uint8Array {
	const rowBytes = width * BYTES_PER_PIXEL;
	const stride = 1 + rowBytes;
	const out = new Uint8Array(height * stride);
	const raw = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length);
	const candidates = [
		new Uint8Array(stride),
		new Uint8Array(stride),
		new Uint8Array(stride),
		new Uint8Array(stride),
		new Uint8Array(stride),
	];
	for (let y = 0; y < height; y += 1) {
		const rowStart = y * rowBytes;
		const hasPrior = y > 0;
		const priorStart = hasPrior ? (y - 1) * rowBytes : 0;
		let bestFilter = FILTER_NONE;
		let bestSum = Number.POSITIVE_INFINITY;
		for (let f = FILTER_NONE; f <= FILTER_PAETH; f += 1) {
			const dst = candidates[f];
			applyFilter(
				dst,
				f,
				raw,
				rowStart,
				rowBytes,
				hasPrior ? raw : undefined,
				priorStart,
			);
			const sum = filteredSum(dst, rowBytes);
			if (sum < bestSum) {
				bestSum = sum;
				bestFilter = f;
			}
		}
		out.set(candidates[bestFilter], y * stride);
	}
	return out;
}

// ---------------------------------------------------------------------------
// LZ77 (RFC 1951 §4)
// ---------------------------------------------------------------------------

const LZ_WINDOW_SIZE = 32768;
const LZ_MIN_MATCH = 3;
const LZ_MAX_MATCH = 258;
/**
 * Hash-chain search depth cap; bounds worst-case encode time on pathological
 * (highly self-similar) input. 32 was chosen empirically, benchmarked against
 * a ~1.5MB filtered scanline stream (the largest mesh raster this encoder
 * currently handles): it keeps encode time comfortably under 500ms with
 * margin for slower hardware, trading a modest amount of match quality for
 * that headroom — raising this value improves compression ratio at roughly
 * linear cost in encode time.
 */
const LZ_MAX_CHAIN = 32;
/** 3-byte rolling hash table width: 2^15 buckets, matching the 32K window. */
const LZ_HASH_BITS = 15;
const LZ_HASH_SIZE = 1 << LZ_HASH_BITS;

/** Deterministic 3-byte mix into a `LZ_HASH_BITS`-wide bucket index. */
function hash3(data: Uint8Array, pos: number): number {
	const h = (data[pos] << 10) ^ (data[pos + 1] << 5) ^ data[pos + 2];
	return h & (LZ_HASH_SIZE - 1);
}

/** One LZ77 token: a literal byte, or a length+distance back-reference. */
type LzToken =
	| { readonly literal: number }
	| { readonly length: number; readonly distance: number };

/**
 * Greedy LZ77 parse over `data` using `head`/`prev` hash chains (a classic
 * zlib-style deflate parser, minus the lazy-matching second look-ahead — greedy
 * is sufficient here since this encoder optimizes for correctness/determinism
 * over maximum ratio). Chain search is capped at {@link LZ_MAX_CHAIN} entries so
 * highly-repetitive input cannot make encoding superlinear.
 */
function lz77Parse(data: Uint8Array): LzToken[] {
	const { length } = data;
	const tokens: LzToken[] = [];
	if (length === 0) return tokens;
	const head = new Int32Array(LZ_HASH_SIZE).fill(-1);
	const prev = new Int32Array(length).fill(-1);

	let pos = 0;
	while (pos < length) {
		let bestLength = 0;
		let bestDistance = 0;
		if (pos + LZ_MIN_MATCH <= length) {
			const h = hash3(data, pos);
			let candidate = head[h];
			let chain = 0;
			const maxLen = Math.min(LZ_MAX_MATCH, length - pos);
			while (candidate >= 0 && chain < LZ_MAX_CHAIN) {
				if (pos - candidate <= LZ_WINDOW_SIZE) {
					let matchLen = 0;
					while (
						matchLen < maxLen &&
						data[candidate + matchLen] === data[pos + matchLen]
					) {
						matchLen += 1;
					}
					if (matchLen > bestLength) {
						bestLength = matchLen;
						bestDistance = pos - candidate;
						if (matchLen >= maxLen) break;
					}
				}
				candidate = prev[candidate];
				chain += 1;
			}
		}

		if (bestLength >= LZ_MIN_MATCH) {
			tokens.push({ length: bestLength, distance: bestDistance });
			// Insert every position covered by the match into the hash chains so
			// future matches can reference into it.
			const end = pos + bestLength;
			const insertEnd = Math.min(end, length - LZ_MIN_MATCH + 1);
			for (let i = pos; i < insertEnd; i += 1) {
				const h = hash3(data, i);
				prev[i] = head[h];
				head[h] = i;
			}
			pos = end;
		} else {
			tokens.push({ literal: data[pos] });
			if (pos + LZ_MIN_MATCH <= length) {
				const h = hash3(data, pos);
				prev[pos] = head[h];
				head[h] = pos;
			}
			pos += 1;
		}
	}
	return tokens;
}

// ---------------------------------------------------------------------------
// Bit writer (LSB-first bit packing, RFC 1951 §3.1.1)
// ---------------------------------------------------------------------------

/**
 * Packs bits LSB-first into bytes, which is how DEFLATE serializes everything
 * EXCEPT Huffman codes: Huffman codes are conceptually MSB-first (the RFC draws
 * them "most significant bit first") and must be bit-reversed into this LSB-first
 * stream via {@link writeHuffmanCode}. Getting the two directions backwards is
 * the classic DEFLATE encoder bug — RFC 1951 §3.1.1 and §3.2.2 spell this out
 * explicitly because of how often it is missed.
 */
class BitWriter {
	private bytes = new Uint8Array(64);
	private byteLen = 0;
	private bitBuffer = 0;
	private bitCount = 0;

	private pushByte(value: number): void {
		if (this.byteLen >= this.bytes.length) {
			const next = new Uint8Array(this.bytes.length * 2);
			next.set(this.bytes);
			this.bytes = next;
		}
		this.bytes[this.byteLen] = value;
		this.byteLen += 1;
	}

	/** Writes the low `count` bits of `value`, LSB first. */
	writeBits(value: number, count: number): void {
		this.bitBuffer |= (value & ((1 << count) - 1)) << this.bitCount;
		this.bitCount += count;
		while (this.bitCount >= 8) {
			this.pushByte(this.bitBuffer & 0xff);
			this.bitBuffer >>>= 8;
			this.bitCount -= 8;
		}
	}

	/** Writes a canonical Huffman `code` of `length` bits, MSB-first (bit-reversed into the LSB stream). */
	writeHuffmanCode(code: number, length: number): void {
		let reversed = 0;
		let c = code;
		for (let i = 0; i < length; i += 1) {
			reversed = (reversed << 1) | (c & 1);
			c >>>= 1;
		}
		this.writeBits(reversed, length);
	}

	/** Pads the current byte with zero bits so the next write starts byte-aligned. */
	alignToByte(): void {
		if (this.bitCount > 0) {
			this.pushByte(this.bitBuffer & 0xff);
			this.bitBuffer = 0;
			this.bitCount = 0;
		}
	}

	/** Raw byte copy — only valid when the writer is byte-aligned (used for stored blocks). */
	writeAlignedBytes(data: Uint8Array, start: number, end: number): void {
		for (let i = start; i < end; i += 1) this.pushByte(data[i]);
	}

	finish(): Uint8Array {
		this.alignToByte();
		return this.bytes.subarray(0, this.byteLen);
	}
}

// ---------------------------------------------------------------------------
// Length/distance code tables (RFC 1951 §3.2.5)
// ---------------------------------------------------------------------------

/** `[code, extraBits, baseLength]` for litlen symbols 257..285, RFC 1951 §3.2.5 table. */
const LENGTH_TABLE: readonly (readonly [number, number, number])[] = [
	[257, 0, 3],
	[258, 0, 4],
	[259, 0, 5],
	[260, 0, 6],
	[261, 0, 7],
	[262, 0, 8],
	[263, 0, 9],
	[264, 0, 10],
	[265, 1, 11],
	[266, 1, 13],
	[267, 1, 15],
	[268, 1, 17],
	[269, 2, 19],
	[270, 2, 23],
	[271, 2, 27],
	[272, 2, 31],
	[273, 3, 35],
	[274, 3, 43],
	[275, 3, 51],
	[276, 3, 59],
	[277, 4, 67],
	[278, 4, 83],
	[279, 4, 99],
	[280, 4, 115],
	[281, 5, 131],
	[282, 5, 163],
	[283, 5, 195],
	[284, 5, 227],
	[285, 0, 258],
];

/** `[code, extraBits, baseDistance]` for dist symbols 0..29, RFC 1951 §3.2.5 table. */
const DISTANCE_TABLE: readonly (readonly [number, number, number])[] = [
	[0, 0, 1],
	[1, 0, 2],
	[2, 0, 3],
	[3, 0, 4],
	[4, 1, 5],
	[5, 1, 7],
	[6, 2, 9],
	[7, 2, 13],
	[8, 3, 17],
	[9, 3, 25],
	[10, 4, 33],
	[11, 4, 49],
	[12, 5, 65],
	[13, 5, 97],
	[14, 6, 129],
	[15, 6, 193],
	[16, 7, 257],
	[17, 7, 385],
	[18, 8, 513],
	[19, 8, 769],
	[20, 9, 1025],
	[21, 9, 1537],
	[22, 10, 2049],
	[23, 10, 3073],
	[24, 11, 4097],
	[25, 11, 6145],
	[26, 12, 8193],
	[27, 12, 12289],
	[28, 13, 16385],
	[29, 13, 24577],
];

/** Length symbol/extra-bits/base lookup tables, indexed directly by match length (3..258); built once from {@link LENGTH_TABLE}. */
const LENGTH_SYMBOL_BY_VALUE = new Int32Array(259); // covers lengths 3..258
const LENGTH_EXTRA_BITS = new Int32Array(259);
const LENGTH_EXTRA_BASE = new Int32Array(259);
{
	let tableIndex = 0;
	for (let len = 3; len <= 258; len += 1) {
		while (
			tableIndex < LENGTH_TABLE.length - 1 &&
			len >= LENGTH_TABLE[tableIndex + 1][2]
		) {
			tableIndex += 1;
		}
		const [symbol, extraBits, base] = LENGTH_TABLE[tableIndex];
		LENGTH_SYMBOL_BY_VALUE[len] = symbol;
		LENGTH_EXTRA_BITS[len] = extraBits;
		LENGTH_EXTRA_BASE[len] = base;
	}
}

/** Maps a distance (1..32768) to its RFC 1951 dist symbol via the table's base thresholds. */
function distanceSymbol(distance: number): number {
	let lo = 0;
	let hi = DISTANCE_TABLE.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (DISTANCE_TABLE[mid][2] <= distance) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

const LITLEN_ALPHABET_SIZE = 286;
const DIST_ALPHABET_SIZE = 30;
const MAX_CODE_LENGTH = 15;
const END_OF_BLOCK = 256;

// ---------------------------------------------------------------------------
// Canonical Huffman code construction (RFC 1951 §3.2.2)
// ---------------------------------------------------------------------------

type HuffmanCodes = {
	/** Code length in bits per symbol; 0 means "symbol unused, no code". */
	readonly lengths: Uint8Array;
	/** Canonical code value per symbol (meaningful only where `lengths[i] > 0`). */
	readonly codes: Uint16Array;
};

/**
 * Builds length-limited (≤{@link MAX_CODE_LENGTH}-bit) canonical Huffman codes from
 * symbol frequencies. Deterministic by construction:
 *  1. Leaves are sorted by `(frequency asc, symbol asc)`. Internal nodes are
 *     created in strict merge order and always lose a frequency tie to a leaf
 *     (see {@link buildHuffmanTreeDepths}), so the resulting tree shape — and
 *     therefore every code length — is a pure function of the input
 *     frequencies, never of insertion-order incidentals.
 *  2. If the resulting max depth exceeds {@link MAX_CODE_LENGTH}, the standard
 *     `bl_count` overflow fixup (used by zlib/`gzip`/every RFC 1951 encoder)
 *     redistributes length budget from the deepest codes to shallower ones,
 *     one leaf at a time, until the limit holds. This preserves the Kraft
 *     inequality (`Σ 2^-length === 1`) so the result is still a valid prefix
 *     code.
 *  3. Canonical codes are assigned by `(bit length asc, symbol asc)`, the
 *     standard canonical-Huffman construction (RFC 1951 §3.2.2).
 *
 * A frequency table with zero or one nonzero entries is degenerate (no real
 * binary tree); those cases are handled explicitly so the result is still a
 * valid canonical code table for the RFC 1951 bitstream (see call sites: a
 * single-symbol alphabet gets a 1-bit code).
 */
function buildHuffmanCodes(
	frequencies: Uint32Array,
	alphabetSize: number,
): HuffmanCodes {
	const usedSymbols: number[] = [];
	for (let s = 0; s < alphabetSize; s += 1) {
		if (frequencies[s] > 0) usedSymbols.push(s);
	}
	const lengths = new Uint8Array(alphabetSize);
	const codes = new Uint16Array(alphabetSize);

	if (usedSymbols.length === 0) {
		return { lengths, codes };
	}
	if (usedSymbols.length === 1) {
		// RFC 1951: a Huffman tree with one distinct value still needs a code so
		// the alphabet is representable in the bitstream; length 1 is standard.
		lengths[usedSymbols[0]] = 1;
		codes[usedSymbols[0]] = 0;
		return { lengths, codes };
	}

	const depths = buildHuffmanTreeDepths(frequencies, usedSymbols, alphabetSize);
	limitCodeLengths(depths, usedSymbols);
	for (const symbol of usedSymbols) lengths[symbol] = depths[symbol];
	assignCanonicalCodes(lengths, codes, usedSymbols);
	return { lengths, codes };
}

/**
 * Merges leaves (sorted `(frequency asc, symbol asc)`) with internal nodes
 * (created in strict FIFO merge order) to produce each used symbol's tree
 * depth. Two parallel sorted queues — `leaves` and `internal` — are merged
 * head-to-head; on a frequency tie, `leaves` wins, which is what keeps the
 * construction deterministic and independent of object-identity/insertion
 * quirks (a leaf never loses a tie to an internal node of equal weight).
 */
function buildHuffmanTreeDepths(
	frequencies: Uint32Array,
	usedSymbols: readonly number[],
	alphabetSize: number,
): Uint8Array {
	type TreeNode = {
		readonly freq: number;
		readonly left: TreeNode | null;
		readonly right: TreeNode | null;
		readonly symbol: number; // -1 for internal nodes
	};
	const leaves: TreeNode[] = usedSymbols
		.slice()
		.sort((a, b) => a - b)
		.map((symbol) => ({
			freq: frequencies[symbol],
			left: null,
			right: null,
			symbol,
		}));
	let leafHead = 0;
	const internal: TreeNode[] = [];
	let internalHead = 0;

	const takeSmallest = (): TreeNode => {
		const leaf = leafHead < leaves.length ? leaves[leafHead] : undefined;
		const node =
			internalHead < internal.length ? internal[internalHead] : undefined;
		if (node === undefined || (leaf !== undefined && leaf.freq <= node.freq)) {
			leafHead += 1;
			// biome-ignore lint/style/noNonNullAssertion: leaf is defined whenever node is undefined or leaf.freq <= node.freq
			return leaf!;
		}
		internalHead += 1;
		return node;
	};

	let remaining = leaves.length;
	while (remaining > 1) {
		const a = takeSmallest();
		const b = takeSmallest();
		internal.push({ freq: a.freq + b.freq, left: a, right: b, symbol: -1 });
		remaining -= 1;
	}
	const root = takeSmallest();

	const depths = new Uint8Array(alphabetSize);
	// Iterative pre-order walk (no recursion) so depth is never bounded by JS
	// call-stack limits even for a maximal 286-symbol alphabet.
	const stackNodes: TreeNode[] = [root];
	const stackDepths: number[] = [0];
	while (stackNodes.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: guarded by the loop condition
		const node = stackNodes.pop()!;
		// biome-ignore lint/style/noNonNullAssertion: pushed in lockstep with stackNodes
		const depth = stackDepths.pop()!;
		if (node.symbol >= 0) {
			depths[node.symbol] = depth;
			continue;
		}
		if (node.left) {
			stackNodes.push(node.left);
			stackDepths.push(depth + 1);
		}
		if (node.right) {
			stackNodes.push(node.right);
			stackDepths.push(depth + 1);
		}
	}
	return depths;
}

/**
 * Clamps `depths` (mutated in place) to {@link MAX_CODE_LENGTH}. Any leaf
 * deeper than the limit is moved to exactly the limit; this INCREASES the
 * Kraft sum (`Σ 2^-length`) of the tree above the required exact 1 (a
 * shallower code costs more Kraft budget than a deeper one), so the fixup loop
 * below pays that excess back down to exactly 1, one `2^-MAX_CODE_LENGTH` unit
 * at a time, by trading one leaf at the shallowest available depth `<
 * MAX_CODE_LENGTH` for two leaves one level deeper (Kraft-neutral, `+1` leaf)
 * while retiring one of the parked-at-the-limit leaves (`-1` leaf,
 * `-2^-MAX_CODE_LENGTH`) — net: leaf count unchanged, Kraft sum reduced by
 * exactly one unit per iteration.
 *
 * The number of required iterations is NOT simply the count of overflowed
 * leaves: a leaf originally at depth `d` only overshoots by `2^-15 - 2^-d`
 * when truncated, and those per-leaf shortfalls generally do NOT sum to a
 * whole number of `2^-15` units equal to the leaf count once `d` varies
 * (e.g. truncating leaves from several different depths at once). The excess
 * is therefore computed with `bigint` (scaled by `2^maxDepth`, exactly — a
 * plain `number` loses precision past 2^53, and `maxDepth` can legitimately
 * reach into the hundreds for a maximally skewed 286-symbol Huffman tree)
 * rather than floating point, so the iteration count is provably exact and
 * never off by one. This is the single highest-risk spot in the whole
 * encoder: an off-by-one here silently produces a Kraft sum ≠ 1, which a real
 * inflater rejects as "invalid literal/lengths set" despite passing any check
 * that doesn't independently verify decodability — exactly the failure mode
 * this routine replaced, caught only by this module's mandated round-trip
 * harness, not by code review of the algorithm shape.
 */
function limitCodeLengths(
	depths: Uint8Array,
	usedSymbols: readonly number[],
): void {
	let maxDepth = 0;
	for (const symbol of usedSymbols) {
		if (depths[symbol] > maxDepth) maxDepth = depths[symbol];
	}
	if (maxDepth <= MAX_CODE_LENGTH) return;

	const blCount = new Uint32Array(maxDepth + 1);
	for (const symbol of usedSymbols) blCount[depths[symbol]] += 1;

	for (let bits = maxDepth; bits > MAX_CODE_LENGTH; bits -= 1) {
		blCount[bits] = 0;
	}
	let leavesAtOrBeyondLimit = 0;
	for (const symbol of usedSymbols) {
		if (depths[symbol] >= MAX_CODE_LENGTH) leavesAtOrBeyondLimit += 1;
	}
	blCount[MAX_CODE_LENGTH] = leavesAtOrBeyondLimit;

	// Scaled (by 2^maxDepth) Kraft sum of the tree AFTER truncating every
	// leaf beyond MAX_CODE_LENGTH down to exactly MAX_CODE_LENGTH. A complete
	// (Kraft-sum-1) tree scales to exactly `2^maxDepth`; anything above that
	// is the exact scaled excess this fixup must remove.
	let scaledKraftSumAfterTruncation = 0n;
	for (let bits = 1; bits <= MAX_CODE_LENGTH; bits += 1) {
		if (blCount[bits] === 0) continue;
		scaledKraftSumAfterTruncation +=
			BigInt(blCount[bits]) * 2n ** BigInt(maxDepth - bits);
	}
	const fullScale = 2n ** BigInt(maxDepth);
	const scaledExcess = scaledKraftSumAfterTruncation - fullScale;
	const unitScale = 2n ** BigInt(maxDepth - MAX_CODE_LENGTH); // one 2^-MAX_CODE_LENGTH unit, scaled
	if (scaledExcess % unitScale !== 0n) {
		// Cannot happen for a valid Huffman tree (every depth/count here comes
		// from integer tree construction), but fail loudly rather than silently
		// truncate toward a wrong iteration count if it ever did.
		throw new Error(
			"limitCodeLengths: Kraft-sum excess is not a whole number of units — Huffman tree invariant violated",
		);
	}
	const fixupIterations = Number(scaledExcess / unitScale);

	// `bits` restarts from `MAX_CODE_LENGTH - 1` on every iteration (it is NOT
	// carried forward monotonically): each split can only ever remove from the
	// SHALLOWEST currently-available depth below the limit, and after a split
	// that depth's count may return to zero while a much shallower depth still
	// has plenty of leaves to split next. Threading `bits` through as
	// monotonically decreasing (this function's first, buggy revision) walks
	// straight past depth 1 into negative indices once the shallow depths are
	// exhausted, silently corrupting `blCount[0]` (length 0 is "no code" —
	// never a valid Huffman length) instead of throwing.
	for (let i = 0; i < fixupIterations; i += 1) {
		let bits = MAX_CODE_LENGTH - 1;
		while (blCount[bits] === 0) bits -= 1;
		blCount[bits] -= 1;
		blCount[bits + 1] += 2;
		blCount[MAX_CODE_LENGTH] -= 1;
	}

	// Redistribute the fixed-up histogram back onto symbols: symbols that were
	// naturally shallower keep shorter codes, ties broken by symbol ascending —
	// matching the documented canonical ordering used everywhere else here.
	const bySymbolThenDepth = usedSymbols
		.slice()
		.sort((a, b) => depths[a] - depths[b] || a - b);
	let cursor = 1;
	const remainingAtLength = blCount.slice(0, MAX_CODE_LENGTH + 1);
	for (const symbol of bySymbolThenDepth) {
		while (cursor <= MAX_CODE_LENGTH && remainingAtLength[cursor] === 0) {
			cursor += 1;
		}
		depths[symbol] = cursor;
		remainingAtLength[cursor] -= 1;
	}
}

/** Canonical code assignment (RFC 1951 §3.2.2): symbols ordered by `(length asc, symbol asc)` get consecutive, left-shifted codes per length. */
function assignCanonicalCodes(
	lengths: Uint8Array,
	codes: Uint16Array,
	usedSymbols: readonly number[],
): void {
	const blCount = new Uint32Array(MAX_CODE_LENGTH + 1);
	for (const symbol of usedSymbols) blCount[lengths[symbol]] += 1;
	const nextCode = new Uint32Array(MAX_CODE_LENGTH + 1);
	let code = 0;
	for (let bits = 1; bits <= MAX_CODE_LENGTH; bits += 1) {
		code = (code + blCount[bits - 1]) << 1;
		nextCode[bits] = code;
	}
	const orderedSymbols = usedSymbols
		.slice()
		.sort((a, b) => lengths[a] - lengths[b] || a - b);
	for (const symbol of orderedSymbols) {
		const len = lengths[symbol];
		codes[symbol] = nextCode[len];
		nextCode[len] += 1;
	}
}

// ---------------------------------------------------------------------------
// Fixed Huffman codes (RFC 1951 §3.2.6)
// ---------------------------------------------------------------------------

/**
 * RFC 1951 §3.2.6 defines the fixed litlen table over the FULL 0..287 symbol
 * space (symbols 286/287 are unused by any real token but still occupy two
 * codes in the 8-bit group alongside 280..285). Canonical code VALUES depend
 * on how many symbols share each length, so 286/287 must be counted here even
 * though they are never looked up — omitting them would shift every 9-bit
 * code's starting value and silently diverge from the codes every standard
 * decoder (browsers, `node:zlib`) hardcodes.
 */
const FIXED_LITLEN_FULL_ALPHABET_SIZE = 288;

const FIXED_LITLEN_CODES: HuffmanCodes = (() => {
	const fullLengths = new Uint8Array(FIXED_LITLEN_FULL_ALPHABET_SIZE);
	for (let s = 0; s <= 143; s += 1) fullLengths[s] = 8;
	for (let s = 144; s <= 255; s += 1) fullLengths[s] = 9;
	for (let s = 256; s <= 279; s += 1) fullLengths[s] = 7;
	for (let s = 280; s <= 287; s += 1) fullLengths[s] = 8;
	const fullCodes = new Uint16Array(FIXED_LITLEN_FULL_ALPHABET_SIZE);
	const blCount = new Uint32Array(10);
	for (let s = 0; s < FIXED_LITLEN_FULL_ALPHABET_SIZE; s += 1) {
		blCount[fullLengths[s]] += 1;
	}
	const nextCode = new Uint32Array(10);
	let code = 0;
	for (let bits = 1; bits <= 9; bits += 1) {
		code = (code + blCount[bits - 1]) << 1;
		nextCode[bits] = code;
	}
	for (let s = 0; s < FIXED_LITLEN_FULL_ALPHABET_SIZE; s += 1) {
		fullCodes[s] = nextCode[fullLengths[s]];
		nextCode[fullLengths[s]] += 1;
	}
	// Only symbols 0..285 (LITLEN_ALPHABET_SIZE) are ever encoded/decoded by
	// this module; truncate the lookup tables but keep the codes computed above
	// intact for those symbols.
	return {
		lengths: fullLengths.subarray(0, LITLEN_ALPHABET_SIZE),
		codes: fullCodes.subarray(0, LITLEN_ALPHABET_SIZE),
	};
})();

const FIXED_DIST_CODES: HuffmanCodes = (() => {
	// All 30 distance codes get a fixed 5-bit length per RFC 1951 §3.2.6.
	const lengths = new Uint8Array(DIST_ALPHABET_SIZE).fill(5);
	const codes = new Uint16Array(DIST_ALPHABET_SIZE);
	for (let s = 0; s < DIST_ALPHABET_SIZE; s += 1) codes[s] = s;
	return { lengths, codes };
})();

// ---------------------------------------------------------------------------
// Token → symbol-stream cost/emit shared by fixed and dynamic Huffman blocks
// ---------------------------------------------------------------------------

/** Per-token exact bit cost under a given litlen/dist code table (for the cost comparison). */
function tokenBits(
	token: LzToken,
	litlen: HuffmanCodes,
	dist: HuffmanCodes,
): number {
	if ("literal" in token) {
		return litlen.lengths[token.literal];
	}
	const lenSymbol = LENGTH_SYMBOL_BY_VALUE[token.length];
	const lenExtra = LENGTH_EXTRA_BITS[token.length];
	const distSym = distanceSymbol(token.distance);
	const distExtra = DISTANCE_TABLE[distSym][1];
	return (
		litlen.lengths[lenSymbol] + lenExtra + dist.lengths[distSym] + distExtra
	);
}

function totalTokenBits(
	tokens: readonly LzToken[],
	litlen: HuffmanCodes,
	dist: HuffmanCodes,
): number {
	let bits = litlen.lengths[END_OF_BLOCK]; // end-of-block symbol
	for (const token of tokens) bits += tokenBits(token, litlen, dist);
	return bits;
}

function writeTokens(
	writer: BitWriter,
	tokens: readonly LzToken[],
	litlen: HuffmanCodes,
	dist: HuffmanCodes,
): void {
	for (const token of tokens) {
		if ("literal" in token) {
			writer.writeHuffmanCode(
				litlen.codes[token.literal],
				litlen.lengths[token.literal],
			);
			continue;
		}
		const lenSymbol = LENGTH_SYMBOL_BY_VALUE[token.length];
		const lenExtraBits = LENGTH_EXTRA_BITS[token.length];
		const lenExtraBase = LENGTH_EXTRA_BASE[token.length];
		writer.writeHuffmanCode(litlen.codes[lenSymbol], litlen.lengths[lenSymbol]);
		if (lenExtraBits > 0) {
			writer.writeBits(token.length - lenExtraBase, lenExtraBits);
		}
		const distSym = distanceSymbol(token.distance);
		const [, distExtraBits, distBase] = DISTANCE_TABLE[distSym];
		writer.writeHuffmanCode(dist.codes[distSym], dist.lengths[distSym]);
		if (distExtraBits > 0) {
			writer.writeBits(token.distance - distBase, distExtraBits);
		}
	}
	writer.writeHuffmanCode(
		litlen.codes[END_OF_BLOCK],
		litlen.lengths[END_OF_BLOCK],
	);
}

function tokenFrequencies(tokens: readonly LzToken[]): {
	litlen: Uint32Array;
	dist: Uint32Array;
} {
	const litlen = new Uint32Array(LITLEN_ALPHABET_SIZE);
	const dist = new Uint32Array(DIST_ALPHABET_SIZE);
	for (const token of tokens) {
		if ("literal" in token) {
			litlen[token.literal] += 1;
			continue;
		}
		litlen[LENGTH_SYMBOL_BY_VALUE[token.length]] += 1;
		dist[distanceSymbol(token.distance)] += 1;
	}
	litlen[END_OF_BLOCK] += 1; // every block emits exactly one end-of-block symbol
	return { litlen, dist };
}

// ---------------------------------------------------------------------------
// Dynamic Huffman block header (RFC 1951 §3.2.7)
// ---------------------------------------------------------------------------

/** Code-length symbol transmission order — RFC 1951 §3.2.7's HCLEN permutation. */
const CODE_LENGTH_ORDER = [
	16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
] as const;

type CodeLengthToken = { readonly symbol: number; readonly extra: number };

/**
 * RLE-encodes a code-length array using symbols 0..15 (literal length),
 * 16 (repeat previous 3-6×), 17 (repeat zero 3-10×), 18 (repeat zero 11-138×),
 * per RFC 1951 §3.2.7. Greedy left-to-right, which is the standard/only
 * sanctioned encoding of this sub-alphabet.
 */
function runLengthEncodeCodeLengths(
	lengths: Uint8Array,
	count: number,
): CodeLengthToken[] {
	const tokens: CodeLengthToken[] = [];
	let i = 0;
	while (i < count) {
		const value = lengths[i];
		let runLength = 1;
		while (i + runLength < count && lengths[i + runLength] === value) {
			runLength += 1;
		}
		if (value === 0) {
			let remaining = runLength;
			while (remaining > 0) {
				if (remaining >= 11) {
					const take = Math.min(138, remaining);
					tokens.push({ symbol: 18, extra: take - 11 });
					remaining -= take;
				} else if (remaining >= 3) {
					const take = Math.min(10, remaining);
					tokens.push({ symbol: 17, extra: take - 3 });
					remaining -= take;
				} else {
					tokens.push({ symbol: 0, extra: 0 });
					remaining -= 1;
				}
			}
		} else {
			tokens.push({ symbol: value, extra: 0 });
			let remaining = runLength - 1;
			while (remaining > 0) {
				const take = Math.min(6, remaining);
				if (take >= 3) {
					tokens.push({ symbol: 16, extra: take - 3 });
					remaining -= take;
				} else {
					for (let k = 0; k < take; k += 1) {
						tokens.push({ symbol: value, extra: 0 });
					}
					remaining -= take;
				}
			}
		}
		i += runLength;
	}
	return tokens;
}

const CODE_LENGTH_EXTRA_BITS: Readonly<Record<number, number>> = {
	16: 2,
	17: 3,
	18: 7,
};

/** Bit cost of a code-length RLE token stream under its own Huffman table, plus extra bits. */
function codeLengthTokensBits(
	tokens: readonly CodeLengthToken[],
	codeLengthCodes: HuffmanCodes,
): number {
	let bits = 0;
	for (const token of tokens) {
		bits +=
			codeLengthCodes.lengths[token.symbol] +
			(CODE_LENGTH_EXTRA_BITS[token.symbol] ?? 0);
	}
	return bits;
}

function writeCodeLengthTokens(
	writer: BitWriter,
	tokens: readonly CodeLengthToken[],
	codeLengthCodes: HuffmanCodes,
): void {
	for (const token of tokens) {
		writer.writeHuffmanCode(
			codeLengthCodes.codes[token.symbol],
			codeLengthCodes.lengths[token.symbol],
		);
		const extraBits = CODE_LENGTH_EXTRA_BITS[token.symbol];
		if (extraBits) writer.writeBits(token.extra, extraBits);
	}
}

type DynamicHeader = {
	readonly hlit: number;
	readonly hdist: number;
	readonly hclen: number;
	readonly codeLengthCodes: HuffmanCodes;
	readonly litlenTokens: CodeLengthToken[];
	readonly distTokens: CodeLengthToken[];
	readonly headerBits: number;
};

/**
 * Builds the dynamic-block header: HLIT/HDIST/HCLEN counts, the code-length
 * alphabet's own Huffman table, and the RLE'd litlen+dist length sequences.
 * `hdist` is clamped to at least 1 (HDIST field is `count − 1`, so a value of 0
 * always encodes "one distance code") — RFC 1951 requires at least one distance
 * code even when the block emits no back-references, so a synthetic
 * zero-length-1 entry keeps the stream well-formed per spec rather than relying
 * on the cost comparison to route distance-free blocks elsewhere.
 */
function buildDynamicHeader(
	litlenLengths: Uint8Array,
	distLengths: Uint8Array,
): DynamicHeader {
	let hlit = LITLEN_ALPHABET_SIZE;
	while (hlit > 257 && litlenLengths[hlit - 1] === 0) hlit -= 1;
	let effectiveDistLengths = distLengths;
	let hdist = DIST_ALPHABET_SIZE;
	while (hdist > 1 && effectiveDistLengths[hdist - 1] === 0) hdist -= 1;
	if (hdist === 1 && effectiveDistLengths[0] === 0) {
		// No distance codes used at all: synthesize a single 1-bit code for
		// symbol 0 so HDIST encodes a non-empty, spec-valid distance alphabet.
		effectiveDistLengths = new Uint8Array(DIST_ALPHABET_SIZE);
		effectiveDistLengths[0] = 1;
	}

	const litlenTokens = runLengthEncodeCodeLengths(litlenLengths, hlit);
	const distTokens = runLengthEncodeCodeLengths(effectiveDistLengths, hdist);

	const clFrequencies = new Uint32Array(19);
	for (const token of litlenTokens) clFrequencies[token.symbol] += 1;
	for (const token of distTokens) clFrequencies[token.symbol] += 1;
	const codeLengthCodesFull = buildHuffmanCodes(clFrequencies, 19);

	let hclen = 19;
	while (
		hclen > 4 &&
		codeLengthCodesFull.lengths[CODE_LENGTH_ORDER[hclen - 1]] === 0
	) {
		hclen -= 1;
	}

	const headerBits =
		5 +
		5 +
		4 +
		hclen * 3 +
		codeLengthTokensBits(litlenTokens, codeLengthCodesFull) +
		codeLengthTokensBits(distTokens, codeLengthCodesFull);

	return {
		hlit,
		hdist,
		hclen,
		codeLengthCodes: codeLengthCodesFull,
		litlenTokens,
		distTokens,
		headerBits,
	};
}

function writeDynamicHeader(writer: BitWriter, header: DynamicHeader): void {
	writer.writeBits(header.hlit - 257, 5);
	writer.writeBits(header.hdist - 1, 5);
	writer.writeBits(header.hclen - 4, 4);
	for (let i = 0; i < header.hclen; i += 1) {
		const symbol = CODE_LENGTH_ORDER[i];
		writer.writeBits(header.codeLengthCodes.lengths[symbol], 3);
	}
	writeCodeLengthTokens(writer, header.litlenTokens, header.codeLengthCodes);
	writeCodeLengthTokens(writer, header.distTokens, header.codeLengthCodes);
}

// ---------------------------------------------------------------------------
// DEFLATE block assembly + entropy-stage cost comparison (RFC 1951 §3.2.3-4)
// ---------------------------------------------------------------------------

const BTYPE_STORED = 0;
const BTYPE_FIXED = 1;
const BTYPE_DYNAMIC = 2;
/** RFC 1951 §3.2.4: a stored block's length field is 16-bit, so max 65535 bytes/block. */
const STORED_BLOCK_MAX = 0xffff;

function writeStoredBlocks(
	writer: BitWriter,
	data: Uint8Array,
	isFinalDeflateBlock: boolean,
): void {
	if (data.length === 0) {
		writer.writeBits(isFinalDeflateBlock ? 1 : 0, 1);
		writer.writeBits(BTYPE_STORED, 2);
		writer.alignToByte();
		writer.writeAlignedBytes(new Uint8Array([0, 0, 0xff, 0xff]), 0, 4);
		return;
	}
	for (let offset = 0; offset < data.length; offset += STORED_BLOCK_MAX) {
		const len = Math.min(STORED_BLOCK_MAX, data.length - offset);
		const isLastBlock = offset + len >= data.length;
		writer.writeBits(isFinalDeflateBlock && isLastBlock ? 1 : 0, 1);
		writer.writeBits(BTYPE_STORED, 2);
		writer.alignToByte();
		const header = new Uint8Array([
			len & 0xff,
			(len >>> 8) & 0xff,
			~len & 0xff,
			(~len >>> 8) & 0xff,
		]);
		writer.writeAlignedBytes(header, 0, 4);
		writer.writeAlignedBytes(data, offset, offset + len);
	}
}

/**
 * Exact bit cost of stored encoding: a 5-byte header (3-bit block tag padded to
 * a byte, then 4-byte LEN/NLEN) per 65535-byte chunk, PLUS the data bytes
 * themselves — the header alone is not the cost, it is the fixed overhead on
 * top of `dataLength * 8` payload bits.
 */
function storedBits(dataLength: number): number {
	const blocks =
		dataLength === 0 ? 1 : Math.ceil(dataLength / STORED_BLOCK_MAX);
	return blocks * 5 * 8 + dataLength * 8;
}

/** Which of the three RFC 1951 block encodings a stream was written with. */
type DeflateBlockKind = "stored" | "fixed" | "dynamic";

type DeflatePlan = {
	readonly kind: DeflateBlockKind;
	readonly tokens: readonly LzToken[];
	readonly dynamicLitlen: HuffmanCodes;
	readonly dynamicDist: HuffmanCodes;
	readonly dynamicHeader: DynamicHeader;
};

/**
 * Computes the exact bit cost of all three RFC 1951 block encodings for `data`
 * and picks the cheapest — this is the zlib entropy-stage strategy, and it
 * guarantees the compressed output is never larger than stored mode (the true
 * worst case for any input, including incompressible noise).
 */
function planDeflate(data: Uint8Array): DeflatePlan {
	const tokens = lz77Parse(data);
	const { litlen: litlenFreq, dist: distFreq } = tokenFrequencies(tokens);
	const dynamicLitlen = buildHuffmanCodes(litlenFreq, LITLEN_ALPHABET_SIZE);
	const dynamicDist = buildHuffmanCodes(distFreq, DIST_ALPHABET_SIZE);
	const dynamicHeader = buildDynamicHeader(
		dynamicLitlen.lengths,
		dynamicDist.lengths,
	);

	const fixedBits =
		3 + totalTokenBits(tokens, FIXED_LITLEN_CODES, FIXED_DIST_CODES);
	const dynamicBits =
		3 +
		dynamicHeader.headerBits +
		totalTokenBits(tokens, dynamicLitlen, dynamicDist);
	const storedBitsTotal = storedBits(data.length);

	const kind: DeflateBlockKind =
		storedBitsTotal <= fixedBits && storedBitsTotal <= dynamicBits
			? "stored"
			: dynamicBits <= fixedBits
				? "dynamic"
				: "fixed";

	return { kind, tokens, dynamicLitlen, dynamicDist, dynamicHeader };
}

/**
 * Compresses `data` as a single complete DEFLATE stream (RFC 1951), choosing
 * whichever of stored/fixed-Huffman/dynamic-Huffman encodes it in the fewest
 * bits (see {@link planDeflate}).
 */
function deflate(data: Uint8Array): Uint8Array {
	const writer = new BitWriter();
	const plan = planDeflate(data);

	if (plan.kind === "stored") {
		writeStoredBlocks(writer, data, true);
		return writer.finish();
	}

	writer.writeBits(1, 1); // BFINAL: this encoder always emits one block per zlib stream
	if (plan.kind === "dynamic") {
		writer.writeBits(BTYPE_DYNAMIC, 2);
		writeDynamicHeader(writer, plan.dynamicHeader);
		writeTokens(writer, plan.tokens, plan.dynamicLitlen, plan.dynamicDist);
	} else {
		writer.writeBits(BTYPE_FIXED, 2);
		writeTokens(writer, plan.tokens, FIXED_LITLEN_CODES, FIXED_DIST_CODES);
	}
	return writer.finish();
}

// ---------------------------------------------------------------------------
// zlib wrapper (RFC 1950)
// ---------------------------------------------------------------------------

/** RFC 1950 CMF/FLG header: CM=8 (deflate), CINFO=7 (32K window), no preset dictionary, FCHECK makes `(CMF*256+FLG) % 31 === 0`. */
const ZLIB_CMF = 0x78;
const ZLIB_FLG = 0x01;

/** Wraps a raw DEFLATE stream in the zlib container: 2-byte header + payload + big-endian Adler-32 of the pre-compression bytes. */
function zlibWrap(filtered: Uint8Array): Uint8Array {
	const compressed = deflate(filtered);
	const out = new Uint8Array(2 + compressed.length + 4);
	out[0] = ZLIB_CMF;
	out[1] = ZLIB_FLG;
	out.set(compressed, 2);
	const adler = adler32(filtered);
	const trailerStart = 2 + compressed.length;
	out[trailerStart] = (adler >>> 24) & 0xff;
	out[trailerStart + 1] = (adler >>> 16) & 0xff;
	out[trailerStart + 2] = (adler >>> 8) & 0xff;
	out[trailerStart + 3] = adler & 0xff;
	return out;
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

/** Standard (RFC 4648 §4) base64 with `=` padding, built in large joined chunks rather than per-quantum `+=`. */
function base64(bytes: Uint8Array): string {
	const parts: string[] = [];
	let current = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
		current += BASE64_ALPHABET[(triple >> 18) & 0x3f];
		current += BASE64_ALPHABET[(triple >> 12) & 0x3f];
		current +=
			i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : "=";
		current += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : "=";
		if (current.length >= BASE64_JOIN_CHUNK_CHARS) {
			parts.push(current);
			current = "";
		}
	}
	if (current.length > 0) parts.push(current);
	return parts.join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encodes an RGBA buffer (`width * height * 4`, straight alpha) as PNG bytes.
 * Throws on a buffer/dimension mismatch so a miscomputed raster surfaces loudly
 * instead of producing a corrupt image.
 */
export function encodePng(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
): Uint8Array {
	if (pixels.length !== width * height * 4) {
		throw new Error(
			`encodePng: pixel buffer length ${pixels.length} !== ${width}×${height}×4`,
		);
	}
	const ihdr = new Uint8Array(13);
	ihdr[0] = (width >>> 24) & 0xff;
	ihdr[1] = (width >>> 16) & 0xff;
	ihdr[2] = (width >>> 8) & 0xff;
	ihdr[3] = width & 0xff;
	ihdr[4] = (height >>> 24) & 0xff;
	ihdr[5] = (height >>> 16) & 0xff;
	ihdr[6] = (height >>> 8) & 0xff;
	ihdr[7] = height & 0xff;
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const filtered = filterScanlines(pixels, width, height);
	const idat = zlibWrap(filtered);

	const out = new ByteWriter(64 + idat.length);
	out.bytes(new Uint8Array(PNG_SIGNATURE));
	writeChunk(out, "IHDR", ihdr);
	writeChunk(out, "IDAT", idat);
	writeChunk(out, "IEND", new Uint8Array(0));
	return out.toUint8Array();
}

/** Encodes an RGBA buffer as a `data:image/png;base64,…` URL. */
export function encodePngDataUrl(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
): string {
	return `data:image/png;base64,${base64(encodePng(pixels, width, height))}`;
}
