/**
 * Versioned manifest for a rendered RGBA frame package (S4-A): the artifact a
 * linked production hands back when its source cannot be represented as an
 * interactive GLB, and the producing side rasterizes exact frames instead.
 *
 * This module is schema, parser, and admission verdicts only. It derives NO
 * build key: the single derivation lives in `production-artifacts.ts` and runs
 * at the companion boundary. A manifest CARRIES a build key and this module
 * checks it for shape and equality, which is what keeps "one derivation" true.
 *
 * Four disciplines are load-bearing here:
 *
 * - **Frame addressability is a hard gate, not a quality.** A package is
 *   admitted only when its frame table is a complete, strictly ascending,
 *   duplicate-free run of exactly `frameCount` entries. Partial, missing, and
 *   duplicate frames each fail closed with their own typed code; there is no
 *   "mostly complete" package, because a hole in the table would silently
 *   become a held or skipped frame at playback.
 *
 * - **The colour declaration is 法定値, never inherited and never defaulted.**
 *   S0c measured that WebP carries ZERO colour metadata (two RIFF samples, one
 *   VP8L chunk, no EXIF/XMP). A parser that filled in sRGB for an absent field
 *   would reintroduce exactly the inheritance the codec cannot provide, so an
 *   absent or unknown declaration rejects the manifest.
 *
 * - **Codec is declared, but no schema meaning depends on its value.** The
 *   design forbids embedding schema semantics in a codec name. The one place a
 *   codec-scoped rule is unavoidable — what the per-frame digest is taken over —
 *   is stated explicitly on `ProductionFramePackageCodec` rather than inferred.
 *
 * - **No timestamps and no absolute paths.** S0a's manifest is byte-identical
 *   across two independent `--background` runs because it emits no wall clock;
 *   this manifest keeps that property so cold/warm rebuilds are comparable by
 *   bytes. Frame entries name a bare filename, never a path, because the
 *   manifest is the easiest place for the companion's no-path discipline to
 *   leak.
 *
 * ## Why camera crossfade over a linked band is typed-unsupported
 *
 * S2-C already ruled this out for V1; the structural reason lives HERE. A
 * manifest maps one frame index to exactly one image, and it carries a single
 * `cameraDigest` for the whole package. A crossfade needs two camera
 * evaluations of the same frame blended by a weight — two images for one index,
 * under two camera identities. Neither is expressible in this shape, so the
 * unsupported verdict is a property of the artifact contract rather than a
 * policy that a later release could relax by flipping a flag.
 */

import {
	isProductionBuildKey,
	isProductionDigest,
	verifyProductionArtifact,
} from "./production-artifacts";
import type {
	ExternalProductionFrameContract,
	ExternalProductionLink,
} from "./production-link";

/** V1 is the only schema this build accepts; a future bump is explicit. */
export const PRODUCTION_FRAME_PACKAGE_SCHEMA_VERSION = 1 as const;

/** Guardrails sized for the plan's 120-frame benchmark envelope with headroom. */
export const PRODUCTION_FRAME_PACKAGE_MAX_FRAMES = 4096;
export const PRODUCTION_FRAME_PACKAGE_MAX_FRAME_BYTES = 64 * 1024 * 1024;
export const PRODUCTION_FRAME_PACKAGE_MAX_DIMENSION = 16_384;
const MAX_FILE_NAME_LENGTH = 128;
const MAX_VIEW_TRANSFORM_LENGTH = 64;

/**
 * Sequence codecs admitted by V1.
 *
 * `webp-lossless` is the S0c verdict (measured 499KB/frame at 1080p, ~38% of
 * PNG, whole-file byte-identical across fresh Blender processes). `png` is kept
 * as the documented fallback for a future 16-bit requirement or a WebP
 * regression — it is NOT a second-class citizen of the schema.
 *
 * CODEC-SCOPED RULE, stated rather than inferred: `frames[].digest` is taken
 * over the WHOLE encoded file for `webp-lossless`, which is sound because S0c
 * verified WebP embeds no volatile metadata on this build. PNG carries Blender
 * `Date`/`RenderTime` tEXt chunks whose suppression under `use_stamp=False` the
 * S0 record reports inconsistently, so a PNG lane MUST hash decoded pixel data
 * instead. A producer that hashes whole PNG files would emit manifests that
 * never compare equal across runs; that is a producer bug, not a schema
 * ambiguity.
 *
 * A second consequence: per-frame digests are NOT comparable across codecs.
 * WebP-lossless canonicalizes RGB to (0,0,0) wherever alpha is 0, which S0c
 * measured as 17.48% of bytes differing from the source PNG with zero
 * visually-relevant pixels differing. Comparing two packages that declare
 * different codecs is a typed error, never a `digest-mismatch` verdict.
 */
export const PRODUCTION_FRAME_PACKAGE_CODECS = [
	"webp-lossless",
	"png",
] as const;
export type ProductionFramePackageCodec =
	(typeof PRODUCTION_FRAME_PACKAGE_CODECS)[number];

/**
 * The one place a frame package's codec becomes a browser media type. It lives
 * beside the codec allowlist rather than at each consumer so a codec cannot be
 * admitted by the parser while some blob is still being labelled with another
 * codec's type — an exhaustive record makes that a compile error instead.
 */
const FRAME_PACKAGE_MIME_TYPE_BY_CODEC: Readonly<
	Record<ProductionFramePackageCodec, string>
> = {
	"webp-lossless": "image/webp",
	png: "image/png",
};

export const mimeTypeForFramePackageCodec = (
	codec: ProductionFramePackageCodec,
): string => FRAME_PACKAGE_MIME_TYPE_BY_CODEC[codec];

/**
 * Blender view transforms this build will accept as a declaration. The list is
 * an allowlist so an unrecognized transform fails closed instead of being
 * recorded as an opaque string nobody can interpret later.
 */
export const PRODUCTION_FRAME_PACKAGE_VIEW_TRANSFORMS = [
	"Standard",
	"AgX",
	"Filmic",
	"Khronos PBR Neutral",
	"Raw",
] as const;
export type ProductionFramePackageViewTransform =
	(typeof PRODUCTION_FRAME_PACKAGE_VIEW_TRANSFORMS)[number];

/**
 * The S0c 法定値 block. Every field is REQUIRED. These are declarations of
 * measured fact about the encoded pixels, not requests to a consumer, and the
 * consumer has no other source for any of them.
 *
 * `alphaMode` is measured per output format, not assumed: S0c read PNG as
 * straight alpha and EXR as premultiplied with two independent readers, and
 * WebP-lossless round-trips the PNG convention bit-exactly wherever alpha is
 * non-zero. The historical `2a - a²` double-composite defect in
 * `features/export/adapters/video.ts` is exactly what an assumed convention
 * costs.
 */
export type ProductionFramePackageColorDeclaration = {
	readonly colorPrimaries: "bt709";
	readonly whitePoint: "d65";
	readonly transferFunction: "srgb";
	readonly viewTransform: ProductionFramePackageViewTransform;
	readonly alphaMode: "straight" | "premultiplied";
	readonly dynamicRange: "sdr";
	readonly bitsPerChannel: 8 | 16;
};

/**
 * One addressable frame.
 *
 * `index` is the package-local index, always dense and 0-based, and is the only
 * thing a consumer addresses by. `blenderFrame` is the producing side's own
 * frame number, recorded explicitly rather than recomputed: `parseFrameContract`
 * admits a `blenderFrameStart` at or below zero, and a mapping that a reader has
 * to reconstruct is a mapping that a reader can reconstruct wrongly. The parser
 * requires `blenderFrame === blenderFrameStart + index`, so the redundancy is a
 * checked invariant rather than a second source of truth.
 */
export type ProductionFramePackageFrame = {
	readonly index: number;
	readonly blenderFrame: number;
	/** Bare filename inside the package. Never a path, never absolute. */
	readonly fileName: string;
	readonly byteLength: number;
	/** Bare lowercase hex SHA-256, per the codec-scoped rule above. */
	readonly digest: string;
};

export type ProductionFramePackageManifest = {
	readonly schemaVersion: typeof PRODUCTION_FRAME_PACKAGE_SCHEMA_VERSION;
	readonly adapter: "blender";
	readonly outputProfile: "rendered-rgba-sequence";
	readonly linkId: string;
	readonly buildKey: string;
	readonly codec: ProductionFramePackageCodec;
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly frameCount: number;
	readonly blenderFrameStart: number;
	readonly color: ProductionFramePackageColorDeclaration;
	/**
	 * Single camera identity for the whole package. Its singularity is what makes
	 * camera crossfade structurally inexpressible here — see the module header.
	 */
	readonly cameraDigest: string;
	/**
	 * Whether the producing side can claim this package is reproducible from the
	 * same inputs. A `false` here downgrades the claim; it never changes the
	 * build key, because a nondeterministic build is still a build OF that key.
	 */
	readonly reproducible: boolean;
	readonly frames: readonly ProductionFramePackageFrame[];
};

/**
 * Typed failures. These are deliberately NOT added to
 * `PRODUCTION_LINK_DIAGNOSTIC_CODES`: that array defines what protocol v1's
 * server-message parser accepts on the wire, and widening it changes the
 * accepted protocol surface. Only a failure that actually has to cross the
 * companion socket belongs there.
 */
export const PRODUCTION_FRAME_PACKAGE_ISSUE_CODES = [
	/** Not an object, or a required field is absent/ill-typed. */
	"frame-package-malformed",
	/** `schemaVersion` is not the version this build implements. */
	"frame-package-schema-unsupported",
	/** `codec` is absent or outside the admitted set. */
	"frame-package-codec-unsupported",
	/** A 法定値 colour field is absent or outside its allowlist. */
	"frame-package-color-declaration-invalid",
	/** `frames.length` disagrees with the declared `frameCount`. */
	"frame-package-frame-count-mismatch",
	/** A gap in the index run: the package cannot address every frame. */
	"frame-package-frame-missing",
	/** The same index appears twice. */
	"frame-package-frame-duplicate",
	/** Indices are not strictly ascending by one. */
	"frame-package-frame-out-of-order",
	/** `blenderFrame` disagrees with `blenderFrameStart + index`. */
	"frame-package-frame-mapping-invalid",
	/** A frame entry has a malformed digest, name, or byte length. */
	"frame-package-frame-entry-invalid",
	/** `buildKey` or `cameraDigest` is not a bare hex SHA-256. */
	"frame-package-identity-invalid",
	/** The manifest describes a different link than the caller expects. */
	"frame-package-link-mismatch",
	/** The manifest's build key is not the desired one: this package is stale. */
	"frame-package-build-key-mismatch",
	/** fps / duration / frame start disagree with the durable link contract. */
	"frame-package-frame-contract-mismatch",
	/** Two packages declaring different codecs were compared. */
	"frame-package-codec-incomparable",
	/** Camera crossfade over a linked 3D band. Structural, not a policy. */
	"frame-package-camera-crossfade-unsupported",
	/** A last-good package is being previewed; an exact claim is refused. */
	"frame-package-stale-exact-export-blocked",
	/** The producing side could not claim reproducibility for this package. */
	"frame-package-not-reproducible",
] as const;
export type ProductionFramePackageIssueCode =
	(typeof PRODUCTION_FRAME_PACKAGE_ISSUE_CODES)[number];

export const isProductionFramePackageIssueCode = (
	value: unknown,
): value is ProductionFramePackageIssueCode =>
	PRODUCTION_FRAME_PACKAGE_ISSUE_CODES.some((code) => code === value);

export type ProductionFramePackageParseResult =
	| { readonly ok: true; readonly manifest: ProductionFramePackageManifest }
	| {
			readonly ok: false;
			readonly code: ProductionFramePackageIssueCode;
			/** Package-local frame index where the failure was observed, if any. */
			readonly index?: number;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveFinite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

const isSafeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value);

const isPositiveInteger = (value: unknown): value is number =>
	isSafeInteger(value) && value > 0;

/**
 * A bare filename: no separators, no traversal, no control characters, no
 * Windows drive letter. Everything a consumer needs to locate the bytes is the
 * package root it already holds plus this name.
 */
const PACKAGE_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/iu;

export const isProductionFramePackageFileName = (
	value: unknown,
): value is string =>
	typeof value === "string" &&
	value.length <= MAX_FILE_NAME_LENGTH &&
	PACKAGE_FILE_NAME_PATTERN.test(value) &&
	!value.includes("..");

const parseViewTransform = (
	value: unknown,
): ProductionFramePackageViewTransform | null => {
	if (typeof value !== "string" || value.length > MAX_VIEW_TRANSFORM_LENGTH) {
		return null;
	}
	return (
		PRODUCTION_FRAME_PACKAGE_VIEW_TRANSFORMS.find(
			(transform) => transform === value,
		) ?? null
	);
};

const parseCodec = (value: unknown): ProductionFramePackageCodec | null =>
	PRODUCTION_FRAME_PACKAGE_CODECS.find((codec) => codec === value) ?? null;

/**
 * Parses the 法定値 block. Every field is required and every field is checked
 * against a closed set; there is no default anywhere in this function, which is
 * the whole point of it existing separately.
 */
const parseColorDeclaration = (
	value: unknown,
): ProductionFramePackageColorDeclaration | null => {
	if (!isRecord(value)) return null;
	if (value.colorPrimaries !== "bt709") return null;
	if (value.whitePoint !== "d65") return null;
	if (value.transferFunction !== "srgb") return null;
	if (value.dynamicRange !== "sdr") return null;
	if (value.alphaMode !== "straight" && value.alphaMode !== "premultiplied") {
		return null;
	}
	if (value.bitsPerChannel !== 8 && value.bitsPerChannel !== 16) return null;
	const viewTransform = parseViewTransform(value.viewTransform);
	if (!viewTransform) return null;
	return {
		colorPrimaries: "bt709",
		whitePoint: "d65",
		transferFunction: "srgb",
		viewTransform,
		alphaMode: value.alphaMode,
		dynamicRange: "sdr",
		bitsPerChannel: value.bitsPerChannel,
	};
};

/**
 * What each admitted codec can physically carry, per S0c measurement.
 *
 * A declaration is 法定値 — but a required field that may contradict measured
 * fact is worse than an absent one, because it launders an impossible claim
 * through a schema that looks strict. S0c read PNG as straight alpha and WebP
 * as round-tripping that convention bit-exactly; neither writer emits
 * premultiplied, and Blender's WebP writer has no 16-bit path at all. So a
 * package claiming premultiplied WebP, or 16bpc WebP, is describing pixels that
 * cannot exist and is rejected rather than recorded.
 *
 * `premultiplied` stays in the union because S0c measured EXR as premultiplied,
 * and a future codec admitting it should not require a type change.
 */
const CODEC_COLOR_CONSTRAINTS: Readonly<
	Record<
		ProductionFramePackageCodec,
		{
			readonly alphaModes: readonly ProductionFramePackageColorDeclaration["alphaMode"][];
			readonly bitDepths: readonly ProductionFramePackageColorDeclaration["bitsPerChannel"][];
		}
	>
> = {
	"webp-lossless": { alphaModes: ["straight"], bitDepths: [8] },
	png: { alphaModes: ["straight"], bitDepths: [8, 16] },
};

const colorDeclarationSuitsCodec = (
	color: ProductionFramePackageColorDeclaration,
	codec: ProductionFramePackageCodec,
): boolean => {
	const constraint = CODEC_COLOR_CONSTRAINTS[codec];
	return (
		constraint.alphaModes.includes(color.alphaMode) &&
		constraint.bitDepths.includes(color.bitsPerChannel)
	);
};

/**
 * Structural check of one entry. Index-run rules are NOT checked here: a single
 * entry cannot know whether it duplicates a sibling, so ordering, gaps, and
 * duplicates are the table's business and get their own codes.
 */
const parseFrameEntry = (
	value: unknown,
): ProductionFramePackageFrame | null => {
	if (!isRecord(value)) return null;
	if (!isSafeInteger(value.index) || value.index < 0) return null;
	if (!isSafeInteger(value.blenderFrame)) return null;
	if (!isProductionFramePackageFileName(value.fileName)) return null;
	if (
		!isPositiveInteger(value.byteLength) ||
		value.byteLength > PRODUCTION_FRAME_PACKAGE_MAX_FRAME_BYTES
	) {
		return null;
	}
	if (!isProductionDigest(value.digest)) return null;
	return {
		index: value.index,
		blenderFrame: value.blenderFrame,
		fileName: value.fileName,
		byteLength: value.byteLength,
		digest: value.digest,
	};
};

/**
 * The only gate that may turn untrusted JSON into a manifest. It fails closed
 * with one typed code rather than returning a partially trusted object: a
 * half-accepted frame table is precisely the state that lets a hole become a
 * silently held frame.
 */
export const parseProductionFramePackageManifest = (
	value: unknown,
): ProductionFramePackageParseResult => {
	if (!isRecord(value)) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (value.schemaVersion !== PRODUCTION_FRAME_PACKAGE_SCHEMA_VERSION) {
		return { ok: false, code: "frame-package-schema-unsupported" };
	}
	if (value.adapter !== "blender") {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (value.outputProfile !== "rendered-rgba-sequence") {
		return { ok: false, code: "frame-package-malformed" };
	}
	const linkId = value.linkId;
	if (typeof linkId !== "string" || linkId.length === 0) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (!isProductionBuildKey(value.buildKey)) {
		return { ok: false, code: "frame-package-identity-invalid" };
	}
	if (!isProductionDigest(value.cameraDigest)) {
		return { ok: false, code: "frame-package-identity-invalid" };
	}
	const codec = parseCodec(value.codec);
	if (!codec) {
		return { ok: false, code: "frame-package-codec-unsupported" };
	}
	if (
		!isPositiveInteger(value.width) ||
		value.width > PRODUCTION_FRAME_PACKAGE_MAX_DIMENSION ||
		!isPositiveInteger(value.height) ||
		value.height > PRODUCTION_FRAME_PACKAGE_MAX_DIMENSION
	) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (!isPositiveFinite(value.fps)) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (
		!isPositiveInteger(value.frameCount) ||
		value.frameCount > PRODUCTION_FRAME_PACKAGE_MAX_FRAMES
	) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (!isSafeInteger(value.blenderFrameStart)) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (typeof value.reproducible !== "boolean") {
		return { ok: false, code: "frame-package-malformed" };
	}
	const color = parseColorDeclaration(value.color);
	if (!color || !colorDeclarationSuitsCodec(color, codec)) {
		return { ok: false, code: "frame-package-color-declaration-invalid" };
	}
	if (!Array.isArray(value.frames)) {
		return { ok: false, code: "frame-package-malformed" };
	}
	if (value.frames.length !== value.frameCount) {
		return { ok: false, code: "frame-package-frame-count-mismatch" };
	}

	const frames: ProductionFramePackageFrame[] = [];
	const seenIndices = new Set<number>();
	const seenNames = new Set<string>();
	for (let position = 0; position < value.frames.length; position += 1) {
		const frame = parseFrameEntry(value.frames[position]);
		if (!frame) {
			return {
				ok: false,
				code: "frame-package-frame-entry-invalid",
				index: position,
			};
		}
		if (seenIndices.has(frame.index) || seenNames.has(frame.fileName)) {
			return {
				ok: false,
				code: "frame-package-frame-duplicate",
				index: frame.index,
			};
		}
		seenIndices.add(frame.index);
		seenNames.add(frame.fileName);
		frames.push(frame);
	}

	// Coverage before order, deliberately. A single forward pass cannot tell a
	// gap from a swap: at the first position whose index is too large, "60 is
	// absent" and "60 and 61 traded places" look identical, and reporting the
	// wrong one sends a reader after the wrong producer bug. Deciding coverage
	// over the whole set first makes each verdict a fact rather than a guess.
	for (let expected = 0; expected < frames.length; expected += 1) {
		if (!seenIndices.has(expected)) {
			return {
				ok: false,
				code: "frame-package-frame-missing",
				index: expected,
			};
		}
	}
	// The set is exactly 0..frameCount-1 here, so any position disagreement is
	// purely an ordering fault.
	const outOfOrder = frames.findIndex(
		(frame, position) => frame.index !== position,
	);
	if (outOfOrder >= 0) {
		return {
			ok: false,
			code: "frame-package-frame-out-of-order",
			index: outOfOrder,
		};
	}
	for (const frame of frames) {
		if (frame.blenderFrame !== value.blenderFrameStart + frame.index) {
			return {
				ok: false,
				code: "frame-package-frame-mapping-invalid",
				index: frame.index,
			};
		}
	}

	return {
		ok: true,
		manifest: {
			schemaVersion: PRODUCTION_FRAME_PACKAGE_SCHEMA_VERSION,
			adapter: "blender",
			outputProfile: "rendered-rgba-sequence",
			linkId,
			buildKey: value.buildKey,
			codec,
			width: value.width,
			height: value.height,
			fps: value.fps,
			frameCount: value.frameCount,
			blenderFrameStart: value.blenderFrameStart,
			color,
			cameraDigest: value.cameraDigest,
			reproducible: value.reproducible,
			frames,
		},
	};
};

/**
 * Exact frame addressing. Returns `undefined` for an out-of-range index rather
 * than clamping: a clamped read is a held frame nobody authored, and the F3
 * defect in the glTF lane (Vecmo frame `f` sampling authored frame `2f`) is what
 * an implicit index transform costs. There is deliberately no time-based
 * accessor here — a caller that has a time must convert it once, explicitly.
 */
export const productionFramePackageFrameAt = (
	manifest: ProductionFramePackageManifest,
	index: number,
): ProductionFramePackageFrame | undefined =>
	Number.isSafeInteger(index) && index >= 0 && index < manifest.frames.length
		? manifest.frames[index]
		: undefined;

/**
 * The producing side's frame number for a package-local index. Exposed so a
 * diagnostic, an overlay assertion, or a re-render request can speak the
 * producer's own numbering without any caller re-deriving the offset.
 */
export const productionFramePackageBlenderFrame = (
	manifest: ProductionFramePackageManifest,
	index: number,
): number | undefined =>
	productionFramePackageFrameAt(manifest, index)?.blenderFrame;

export type ProductionFramePackageAdmission =
	| { readonly status: "admitted" }
	| {
			readonly status: "rejected";
			readonly code: ProductionFramePackageIssueCode;
	  };

/**
 * Admits a parsed manifest against the durable link and the desired build key.
 *
 * The frame contract is compared field by field rather than digested, because a
 * caller that sees `frame-package-frame-contract-mismatch` needs to know the
 * package describes a different timeline, not that two opaque hashes differ.
 * The build-key comparison is what makes a control edit visible: any published
 * control change moves the desired key, so a package built before the edit is
 * rejected as stale instead of being served under a key that no longer
 * describes it.
 */
export const admitProductionFramePackage = ({
	manifest,
	link,
	desiredBuildKey,
	frameContract,
}: {
	readonly manifest: ProductionFramePackageManifest;
	readonly link: ExternalProductionLink;
	readonly desiredBuildKey: string;
	readonly frameContract?: ExternalProductionFrameContract;
}): ProductionFramePackageAdmission => {
	if (manifest.linkId !== link.linkId) {
		return { status: "rejected", code: "frame-package-link-mismatch" };
	}
	if (link.outputProfile !== "rendered-rgba-sequence") {
		return { status: "rejected", code: "frame-package-link-mismatch" };
	}
	if (
		!isProductionBuildKey(desiredBuildKey) ||
		manifest.buildKey !== desiredBuildKey
	) {
		return { status: "rejected", code: "frame-package-build-key-mismatch" };
	}
	const contract = frameContract ?? link.frame;
	if (
		manifest.fps !== contract.fps ||
		manifest.frameCount !== contract.durationFrames ||
		manifest.blenderFrameStart !== contract.blenderFrameStart
	) {
		return {
			status: "rejected",
			code: "frame-package-frame-contract-mismatch",
		};
	}
	return { status: "admitted" };
};

/**
 * Per-frame byte admission. This delegates to `verifyProductionArtifact` rather
 * than re-implementing a digest comparison, so the rendered lane and the GLB
 * lane fail closed on exactly the same rules for a truncated, empty, or
 * unhashable payload.
 */
export const verifyProductionFramePackageFrame = ({
	bytes,
	frame,
}: {
	readonly bytes: Uint8Array;
	readonly frame: ProductionFramePackageFrame;
}) =>
	verifyProductionArtifact({
		bytes,
		expectedDigest: frame.digest,
		expectedByteLength: frame.byteLength,
	});

/** Total encoded size of a package. The unit a storage budget is measured in. */
export const productionFramePackageByteLength = (
	manifest: ProductionFramePackageManifest,
): number =>
	manifest.frames.reduce((total, frame) => total + frame.byteLength, 0);

export type ProductionFramePackageComparison =
	| {
			readonly status: "identical";
			readonly frameCount: number;
	  }
	| {
			readonly status: "differs";
			readonly differingIndices: readonly number[];
			readonly metadataDiffers: boolean;
	  }
	| {
			readonly status: "incomparable";
			readonly code: ProductionFramePackageIssueCode;
	  };

/**
 * Compares two manifests of the same build, which is how a cold and a warm
 * rebuild are held against each other.
 *
 * Different codecs are `incomparable`, never `differs`: WebP-lossless
 * canonicalizes RGB to (0,0,0) under alpha 0, so a cross-codec digest
 * disagreement is a property of the encoders rather than evidence about the
 * render. Reporting it as a difference would manufacture an unclassifiable
 * finding out of a known one.
 */
export const compareProductionFramePackages = (
	left: ProductionFramePackageManifest,
	right: ProductionFramePackageManifest,
): ProductionFramePackageComparison => {
	if (left.codec !== right.codec) {
		return { status: "incomparable", code: "frame-package-codec-incomparable" };
	}
	if (left.linkId !== right.linkId || left.buildKey !== right.buildKey) {
		return { status: "incomparable", code: "frame-package-build-key-mismatch" };
	}
	if (left.frameCount !== right.frameCount) {
		return {
			status: "incomparable",
			code: "frame-package-frame-count-mismatch",
		};
	}
	const metadataDiffers =
		left.width !== right.width ||
		left.height !== right.height ||
		left.fps !== right.fps ||
		left.blenderFrameStart !== right.blenderFrameStart ||
		left.cameraDigest !== right.cameraDigest ||
		left.reproducible !== right.reproducible ||
		left.color.viewTransform !== right.color.viewTransform ||
		left.color.alphaMode !== right.color.alphaMode ||
		left.color.bitsPerChannel !== right.color.bitsPerChannel;
	const differingIndices = left.frames
		.filter((frame, index) => {
			const other = right.frames[index];
			return !other || other.digest !== frame.digest;
		})
		.map((frame) => frame.index);
	if (differingIndices.length === 0 && !metadataDiffers) {
		return { status: "identical", frameCount: left.frameCount };
	}
	return { status: "differs", differingIndices, metadataDiffers };
};

/**
 * The typed refusal for a camera crossfade that spans a linked 3D band. It is a
 * function rather than a bare constant so every caller gets the same code and
 * the reason stays attached to it at the call site.
 *
 * See the module header for why this is structural: one index maps to one
 * image, and one package carries one `cameraDigest`.
 */
export const productionFramePackageCrossfadeUnsupported =
	(): ProductionFramePackageIssueCode =>
		"frame-package-camera-crossfade-unsupported";

export type ProductionFramePackageUsage =
	| { readonly status: "exact" }
	| {
			/**
			 * Preview is allowed and export is not. The package is real, verified,
			 * and internally consistent — it simply describes a build the document
			 * has since moved past.
			 */
			readonly status: "preview-only";
			readonly code: ProductionFramePackageIssueCode;
	  };

/**
 * Decides what a resolved package may be USED for, which is a different question
 * from whether it may be admitted.
 *
 * The split is the design's "last-good stale sequence is previewable but blocks
 * exact export". Showing the last good frames is honest and useful — an author
 * editing a control wants to keep seeing the band while the rebuild runs — but
 * an export carrying those frames would be claiming exactness for pixels that
 * answer a superseded build key. So staleness degrades the CLAIM rather than
 * hiding the pixels.
 *
 * `reproducible: false` blocks exact export for the same reason by a different
 * route: the producing side measured a state-carrying feature it could not
 * promise to reproduce, so nobody can assert these pixels are the pixels a
 * rebuild would give. That is a downgrade of the claim, never a change to the
 * build key.
 */
export const productionFramePackageUsage = ({
	manifest,
	desiredBuildKey,
}: {
	readonly manifest: ProductionFramePackageManifest;
	readonly desiredBuildKey: string;
}): ProductionFramePackageUsage => {
	if (
		!isProductionBuildKey(desiredBuildKey) ||
		manifest.buildKey !== desiredBuildKey
	) {
		return {
			status: "preview-only",
			code: "frame-package-stale-exact-export-blocked",
		};
	}
	if (!manifest.reproducible) {
		return { status: "preview-only", code: "frame-package-not-reproducible" };
	}
	return { status: "exact" };
};
