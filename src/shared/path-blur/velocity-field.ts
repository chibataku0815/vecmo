// Pure, DOM-free Path-Blur velocity field. No React, no Worker runtime, no
// browser APIs. FSD `shared` layer: imports only from other `shared` modules.
//
// Coordinate space (single convention used everywhere in this module):
//   - All positions are normalized 0..1 frame-UV. `u` increases to the right
//     (→ x), `v` increases DOWNWARD (→ y). This matches the warp/lens centre
//     convention so a guide authored against the frame lands on the same texel.
//   - Distances and `falloff` are likewise measured in 0..1 UV units, never in
//     pixels — the field is resolution-independent.
//
// The field turns Path-Blur guide curves into a per-texel direction + magnitude
// grid and bakes it to RGBA8 for GPU upload. It is the single source of truth
// feeding the GPU shader: the march walks taps OFF the guide, so every texel —
// even far from any path — carries the nearest guide's unit tangent. Only the
// `magnitude` decays with distance; the direction is defined whole-frame.

import {
	type AeShape,
	aeShapeToFields,
	isAeShape,
	sampleAeShapePath,
} from "@/shared/glammer/ae-shape";

/**
 * One Path-Blur guide curve.
 *
 * `shape` vertices/tangents are in normalized 0..1 frame-UV (resolution-
 * independent, matching the warp/lens centre convention). `startSpeed`/
 * `endSpeed` are 0..1 magnitude scales at the path's start and end, lerped
 * along arc-length between them.
 */
export interface PathBlurGuide {
	readonly shape: AeShape;
	readonly startSpeed: number;
	readonly endSpeed: number;
}

/** Build-time configuration for {@link buildPathBlurField}. */
export interface PathBlurFieldOptions {
	/** Texel grid width (e.g. 192). */
	readonly width: number;
	/** Texel grid height. */
	readonly height: number;
	/** 0..1 UV radius over which off-path magnitude decays to 0. */
	readonly falloff: number;
}

/**
 * A sampled Path-Blur velocity field over a `width`×`height` texel grid.
 *
 * `sampleAt(u, v)` reads the grid at UV coords in 0..1 (u→x right, v→y down).
 * `dirX`/`dirY` are the unit tangent of the nearest guide (defined for EVERY
 * texel, including off-path ones). `magnitude` in 0..1 is the nearest sample's
 * lerped endpoint-speed multiplied by a smooth distance falloff: 1 on the
 * guide, 0 at/beyond `falloff`.
 */
export interface PathBlurVelocityField {
	readonly width: number;
	readonly height: number;
	/**
	 * u,v in 0..1 (u→x right, v→y down). Returns the nearest guide's unit
	 * tangent and the falloff-scaled endpoint speed at that texel.
	 */
	readonly sampleAt: (
		u: number,
		v: number,
	) => {
		readonly dirX: number;
		readonly dirY: number;
		readonly magnitude: number;
	};
}

/** Minimum vertices for a guide shape to describe a curve (a single segment). */
const MIN_GUIDE_VERTICES = 2;

/** Default grid resolution lower bound for polyline sampling density. */
const DEFAULT_SAMPLE_FLOOR = 64;

/**
 * Bézier-flattening density per cubic segment inside `sampleAeShapePath`. Kept
 * modest because the field samples each guide `max(DEFAULT_SAMPLE_FLOOR, width)`
 * times and `sampleAeShapePath` rebuilds its arc table on every call.
 */
const STEPS_PER_SEGMENT = 48;

/** Components per RGBA8 texel. */
const RGBA_STRIDE = 4;

/** Byte range for an 8-bit channel. */
const BYTE_MAX = 255;

/** Maps a signed unit component (-1..1) into the 0..1 encode range. */
const SIGNED_TO_UNORM_SCALE = 0.5;
const SIGNED_TO_UNORM_BIAS = 0.5;

/** Clamp a value into 0..1. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Hermite smoothstep on a 0..1 input — removes the hard stepping of a linear ramp. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Linear interpolation from `a` to `b` by `t` (caller keeps `t` in 0..1). */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Smooth distance falloff in UV space. 1 on the guide (`dist === 0`) →
 * 0 at/beyond `falloff`. This is the GLSL `smoothstep(falloff, 0, dist)`
 * (edges swapped) reduced onto the 1-arg Hermite. Guarded against a 0 radius.
 */
const distanceFalloff = (dist: number, falloff: number): number => {
	if (falloff <= 0) return dist <= 0 ? 1 : 0;
	return smoothstep(clamp01(1 - dist / falloff));
};

/** One flattened guide sample: UV point, unit tangent, lerped endpoint speed. */
interface PolylineSample {
	readonly x: number;
	readonly y: number;
	readonly dirX: number;
	readonly dirY: number;
	readonly speed: number;
}

/**
 * Flatten one guide into a polyline of {point, unit tangent, lerped speed} by
 * sampling `sampleAeShapePath` at `sampleCount` evenly spaced arc-length
 * percents. Speed is `lerp(startSpeed, endSpeed, percent)`. Returns an empty
 * array for shapes that are not valid / have too few vertices (never throws).
 */
const flattenGuide = (
	guide: PathBlurGuide,
	sampleCount: number,
): PolylineSample[] => {
	const { shape } = guide;
	if (!isAeShape(shape)) return [];
	if (shape.vertices.length < MIN_GUIDE_VERTICES) return [];
	// `sampleAeShapePath` indexes in/out tangents by vertex; mismatched array
	// lengths would read `undefined` and throw. Drop such guides (never throws).
	if (
		shape.inTangents.length !== shape.vertices.length ||
		shape.outTangents.length !== shape.vertices.length
	)
		return [];

	const samples: PolylineSample[] = [];
	// `sampleCount` percents inclusive of both endpoints (0 and 1).
	const lastIndex = sampleCount - 1;
	for (let i = 0; i < sampleCount; i++) {
		const percent = lastIndex > 0 ? i / lastIndex : 0;
		const sample = sampleAeShapePath(shape, percent, {
			stepsPerSegment: STEPS_PER_SEGMENT,
		});
		samples.push({
			x: sample.point[0],
			y: sample.point[1],
			dirX: sample.tangent[0],
			dirY: sample.tangent[1],
			speed: lerp(guide.startSpeed, guide.endSpeed, percent),
		});
	}
	return samples;
};

/** Result of a nearest-polyline-sample lookup at a texel centre. */
interface NearestHit {
	readonly dirX: number;
	readonly dirY: number;
	readonly magnitude: number;
}

const ZERO_HIT: NearestHit = { dirX: 0, dirY: 0, magnitude: 0 };

/**
 * Build the per-pixel velocity field by densely flattening each guide into a
 * polyline, then for each texel centre taking the nearest polyline sample's
 * tangent as the direction (whole-frame fill — required, the GPU march walks
 * taps off the guide) and `sampleSpeed × distanceFalloff(dist)` as the
 * magnitude. With multiple guides the nearest sample across all of them wins.
 *
 * Empty or fully-invalid guides (none valid / every shape <2 vertices) produce
 * a zero field whose `sampleAt` always returns `{dirX:0, dirY:0, magnitude:0}`.
 * Never throws.
 *
 * The grid is computed eagerly at texel centres `((i+0.5)/w, (j+0.5)/h)` and
 * stored row-major (`j*width + i`); `sampleAt` reads it nearest-neighbour. This
 * exact centre convention is shared with {@link encodePathBlurFieldRgba} so an
 * encode round-trips the same texels.
 */
export const buildPathBlurField = (
	guides: readonly PathBlurGuide[],
	opts: PathBlurFieldOptions,
): PathBlurVelocityField => {
	const { width, height, falloff } = opts;

	const sampleCount = Math.max(DEFAULT_SAMPLE_FLOOR, width);
	const polylines = guides
		.map((guide) => flattenGuide(guide, sampleCount))
		.filter((samples) => samples.length > 0);

	// No usable guide anywhere → zero field. `sampleAt` returns the zero hit and
	// an encode of it lands on the documented (128,128,0,255) sentinel.
	if (polylines.length === 0) {
		return {
			width,
			height,
			sampleAt: () => ZERO_HIT,
		};
	}

	const grid: NearestHit[] = Array.from(
		{ length: width * height },
		(_, index) => {
			const i = index % width;
			const j = (index - i) / width;
			const u = (i + 0.5) / width;
			const v = (j + 0.5) / height;
			return nearestHit(polylines, u, v, falloff);
		},
	);

	return {
		width,
		height,
		sampleAt: (u, v) => {
			const i = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
			const j = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
			return grid[j * width + i] ?? ZERO_HIT;
		},
	};
};

/**
 * Nearest-sample lookup at one UV texel centre across every guide's polyline.
 * Direction is the nearest sample's unit tangent (set unconditionally, so it is
 * defined off-path); magnitude is that sample's lerped speed × the UV-space
 * distance falloff, clamped to 0..1.
 */
const nearestHit = (
	polylines: readonly PolylineSample[][],
	u: number,
	v: number,
	falloff: number,
): NearestHit => {
	let bestDistSq = Number.POSITIVE_INFINITY;
	let best: PolylineSample | undefined;
	for (const samples of polylines) {
		for (const sample of samples) {
			const dx = sample.x - u;
			const dy = sample.y - v;
			const distSq = dx * dx + dy * dy;
			if (distSq < bestDistSq) {
				bestDistSq = distSq;
				best = sample;
			}
		}
	}
	if (!best) return ZERO_HIT;

	const dist = Math.sqrt(bestDistSq);
	const magnitude = clamp01(best.speed * distanceFalloff(dist, falloff));
	return { dirX: best.dirX, dirY: best.dirY, magnitude };
};

/** Single-entry "last key" memo for {@link encodePathBlurFieldRgba}. */
interface EncodeMemo {
	key: string;
	bytes: Uint8ClampedArray;
}

let encodeMemo: EncodeMemo | undefined;

/**
 * Bake a field to RGBA8 (length `width*height*4`, row-major, `v` increasing
 * downward):
 *   - R = (dirX*0.5+0.5) * 255
 *   - G = (dirY*0.5+0.5) * 255
 *   - B = magnitude (0..1) * 255
 *   - A = 255
 *
 * Texels are read at the same centres the field was built on, so the bake
 * round-trips. A zero field encodes to the (128,128,0,255) sentinel naturally
 * (dir 0 → 0.5 → ×255 → 127.5 → Uint8Clamped ties-to-even → 128).
 *
 * Memoization contract: results are cached on `guidesKey` + the field's
 * dimensions. Re-encoding the same guides at the same size (e.g. the unchanged
 * frame of a static export) returns the cached bytes. The cache holds only the
 * most recent entry, so an animated export — whose `guidesKey` changes per
 * frame — cannot leak one buffer per frame. `guidesKey` MUST be derived from
 * the guides' {@link aeShapeTopologyKey} + speeds (see
 * {@link pathBlurGuidesKey}); two distinct guide sets must not share a key.
 */
export const encodePathBlurFieldRgba = (
	field: PathBlurVelocityField,
	guidesKey: string,
): Uint8ClampedArray => {
	const { width, height } = field;
	const memoKey = `${guidesKey}|${width}x${height}`;
	if (encodeMemo && encodeMemo.key === memoKey) return encodeMemo.bytes;

	const bytes = new Uint8ClampedArray(width * height * RGBA_STRIDE);
	for (let j = 0; j < height; j++) {
		const v = (j + 0.5) / height;
		for (let i = 0; i < width; i++) {
			const u = (i + 0.5) / width;
			const { dirX, dirY, magnitude } = field.sampleAt(u, v);
			const offset = (j * width + i) * RGBA_STRIDE;
			// Uint8ClampedArray rounds (ties-to-even) and clamps on assignment.
			bytes[offset] =
				(dirX * SIGNED_TO_UNORM_SCALE + SIGNED_TO_UNORM_BIAS) * BYTE_MAX;
			bytes[offset + 1] =
				(dirY * SIGNED_TO_UNORM_SCALE + SIGNED_TO_UNORM_BIAS) * BYTE_MAX;
			bytes[offset + 2] = magnitude * BYTE_MAX;
			bytes[offset + 3] = BYTE_MAX;
		}
	}

	encodeMemo = { key: memoKey, bytes };
	return bytes;
};

/**
 * Derive a memo key for a guide set that changes whenever the guides' geometry
 * OR speeds change. Keys on every vertex/tangent coordinate via
 * {@link aeShapeToFields}, NOT just the topology counts — a count-only key would
 * alias two differently-shaped guides and, worse, return a stale baked field
 * after a vertex is dragged without changing the vertex count. Use as the
 * `guidesKey` argument to {@link encodePathBlurFieldRgba}. Invalid shapes key as
 * `"x"` so they still contribute a distinct, stable token.
 */
export const pathBlurGuidesKey = (guides: readonly PathBlurGuide[]): string =>
	guides
		.map((guide) => {
			const shapeKey = isAeShape(guide.shape)
				? Object.values(aeShapeToFields(guide.shape)).join(",")
				: "x";
			return `${shapeKey}@${guide.startSpeed},${guide.endSpeed}`;
		})
		.join(";");
