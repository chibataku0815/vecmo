import { stableJsonStringify } from "@/shared/lib/stable-json";

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

const textEncoder =
	typeof TextEncoder === "undefined" ? null : new TextEncoder();

const utf8Bytes = (value: string): Uint8Array => {
	if (textEncoder) return textEncoder.encode(value);
	const bytes: number[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else {
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}
	return new Uint8Array(bytes);
};

/**
 * Stable non-cryptographic 64-bit hash for cache identity. Cache artifacts are
 * always validated by schema/capability/version fields and are regenerable, so
 * the goal here is deterministic, compact identity rather than adversarial
 * collision resistance.
 */
export function stableHashBytes(bytes: Uint8Array): string {
	let hash = FNV_OFFSET_64;
	for (const byte of bytes) {
		hash ^= BigInt(byte);
		hash = (hash * FNV_PRIME_64) & UINT64_MASK;
	}
	return hash.toString(16).padStart(16, "0");
}

/** Hashes a string after UTF-8 encoding so browser and worker contexts agree. */
export function stableHashString(value: string): string {
	return stableHashBytes(utf8Bytes(value));
}

/** Hashes any JSON-compatible value using the repo's canonical JSON encoder. */
export function stableHashValue(value: unknown): string {
	return stableHashString(stableJsonStringify(value));
}
