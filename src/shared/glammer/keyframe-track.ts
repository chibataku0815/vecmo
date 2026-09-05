// Vendored from motion-grammar-lab/packages/motion-grammar/src/keyframe-track.ts.
// Keep this module standalone: no DOM, renderer, React, or Worker runtime imports.

// AE keyframe track sampler.
// Models a single property animated through After Effects keyframes with
// per-key temporal ease (speed + influence) and per-key interpolation type.
//
// Interpolation type codes mirror AE's KeyframeInterpolationType:
//   6612 = LINEAR
//   6613 = BEZIER
//   6614 = HOLD
//
// Influence is reported as a percent (0..100). Speed is in property-units/second.
// For BEZIER (and for LINEAR keys with non-default influence that should still
// be eased), this module converts ease pairs into a normalized cubic Bezier
// (x1,y1,x2,y2) and evaluates the curve for arbitrary t.

export type AeTemporalEasePoint = {
	speed: number;
	influence: number;
};

/** Exact normalized cubic carried by the segment leaving one keyframe. */
export type AeTemporalCurve = {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
};

export type AeKeyInterp = 6612 | 6613 | 6614 | number;

export type AeKeyframe<V> = {
	time: number;
	value: V;
	inInterpolationType?: AeKeyInterp;
	outInterpolationType?: AeKeyInterp;
	inTemporalEase?: AeTemporalEasePoint[];
	outTemporalEase?: AeTemporalEasePoint[];
	/**
	 * Optional exact Vecmo curve. Legacy AE influence fields remain for import and
	 * preset compatibility; when present this curve is the sampling truth.
	 */
	outTemporalCurve?: AeTemporalCurve;
};

const HOLD = 6614;

const averageInfluence = (
	eases: AeTemporalEasePoint[] | undefined,
): number | undefined => {
	if (!eases?.length) return undefined;
	return eases.reduce((sum, ease) => sum + ease.influence, 0) / eases.length;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const isTemporalCurve = (value: unknown): value is AeTemporalCurve => {
	if (!value || typeof value !== "object") return false;
	const curve = value as Partial<AeTemporalCurve>;
	return (
		Number.isFinite(curve.x1) &&
		Number.isFinite(curve.y1) &&
		Number.isFinite(curve.x2) &&
		Number.isFinite(curve.y2)
	);
};

// Solves cubic Bezier y for given x via Newton's method with bisection fallback.
// Control points are (0,0), (x1,y1), (x2,y2), (1,1). Assumes x(t) is monotonic
// across the unit interval, which AE keyframe ease curves are by construction
// (x1, x2 may exceed each other for overshoot but x stays monotonic between 0 and 1
// as long as both control x-coordinates are in [0,1]).
const cubicBezier = (
	x: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): number => {
	const fx = (t: number): number =>
		3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
	const fy = (t: number): number =>
		3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
	const dfx = (t: number): number =>
		3 * (1 - t) * (1 - t) * x1 +
		6 * (1 - t) * t * (x2 - x1) +
		3 * t * t * (1 - x2);
	let t = x;
	for (let i = 0; i < 8; i += 1) {
		const cx = fx(t);
		const diff = cx - x;
		if (Math.abs(diff) < 1e-6) return fy(t);
		const slope = dfx(t);
		if (Math.abs(slope) < 1e-6) break;
		t = clamp(t - diff / slope, 0, 1);
	}
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 24; i += 1) {
		const mid = (lo + hi) / 2;
		const cx = fx(mid);
		if (Math.abs(cx - x) < 1e-5) return fy(mid);
		if (cx < x) lo = mid;
		else hi = mid;
	}
	return fy((lo + hi) / 2);
};

const cubicCoordinate = (
	t: number,
	control1: number,
	control2: number,
): number =>
	3 * (1 - t) * (1 - t) * t * control1 +
	3 * (1 - t) * t * t * control2 +
	t * t * t;

const cubicParameterForX = (x: number, x1: number, x2: number): number => {
	let low = 0;
	let high = 1;
	for (let index = 0; index < 32; index += 1) {
		const middle = (low + high) / 2;
		if (cubicCoordinate(middle, x1, x2) < x) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
};

const mix = (from: number, to: number, progress: number): number =>
	from + (to - from) * progress;

/**
 * Splits one exact temporal cubic at normalized time `u`. The returned curves
 * reproduce the same value graph on either side after an intermediate key is
 * inserted. A degenerate value range cannot be re-normalized and fails closed.
 */
export function splitTemporalCurveAtTime(
	curve: AeTemporalCurve,
	u: number,
): {
	readonly valueProgress: number;
	readonly left: AeTemporalCurve;
	readonly right: AeTemporalCurve;
} | null {
	const normalizedU = clamp(u, 0, 1);
	if (normalizedU <= 0 || normalizedU >= 1 || !isTemporalCurve(curve)) {
		return null;
	}
	const x1 = clamp(curve.x1, 0, 1);
	const x2 = clamp(curve.x2, 0, 1);
	const t = cubicParameterForX(normalizedU, x1, x2);
	const p0 = { x: 0, y: 0 };
	const p1 = { x: x1, y: curve.y1 };
	const p2 = { x: x2, y: curve.y2 };
	const p3 = { x: 1, y: 1 };
	const q0 = { x: mix(p0.x, p1.x, t), y: mix(p0.y, p1.y, t) };
	const q1 = { x: mix(p1.x, p2.x, t), y: mix(p1.y, p2.y, t) };
	const q2 = { x: mix(p2.x, p3.x, t), y: mix(p2.y, p3.y, t) };
	const r0 = { x: mix(q0.x, q1.x, t), y: mix(q0.y, q1.y, t) };
	const r1 = { x: mix(q1.x, q2.x, t), y: mix(q1.y, q2.y, t) };
	const split = { x: mix(r0.x, r1.x, t), y: mix(r0.y, r1.y, t) };
	const leftYSpan = split.y;
	const rightYSpan = 1 - split.y;
	if (Math.abs(leftYSpan) <= 1e-9 || Math.abs(rightYSpan) <= 1e-9) return null;
	return {
		valueProgress: split.y,
		left: {
			x1: q0.x / split.x,
			y1: q0.y / leftYSpan,
			x2: r0.x / split.x,
			y2: r0.y / leftYSpan,
		},
		right: {
			x1: (r1.x - split.x) / (1 - split.x),
			y1: (r1.y - split.y) / rightYSpan,
			x2: (q2.x - split.x) / (1 - split.x),
			y2: (q2.y - split.y) / rightYSpan,
		},
	};
}

const easeFromKeyPair = (
	from: AeKeyframe<unknown>,
	to: AeKeyframe<unknown>,
): ((u: number) => number) => {
	if (isTemporalCurve(from.outTemporalCurve)) {
		const curve = from.outTemporalCurve;
		return (u: number) =>
			cubicBezier(
				clamp(u, 0, 1),
				clamp(curve.x1, 0, 1),
				curve.y1,
				clamp(curve.x2, 0, 1),
				curve.y2,
			);
	}
	// u in [0,1] normalised time within segment.
	// AE convention: outTemporalEase on the FROM key controls the x1 handle distance
	// (out-influence%, scaled into [0,1]); inTemporalEase on the TO key controls
	// (1 - in-influence%). Handle y-coordinates default to (0, 1) — the standard
	// "easy ease" envelope. Speed contributes to overshoot but is not modelled here.
	const outInf = averageInfluence(from.outTemporalEase);
	const inInf = averageInfluence(to.inTemporalEase);
	const fromInf = outInf ?? 100 / 3;
	const toInf = inInf ?? 100 / 3;
	const x1 = clamp(fromInf / 100, 0, 1);
	const x2 = clamp(1 - toInf / 100, 0, 1);
	return (u: number) => cubicBezier(clamp(u, 0, 1), x1, 0, x2, 1);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec = (
	a: readonly number[],
	b: readonly number[],
	t: number,
): number[] => {
	const out: number[] = [];
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i += 1) out.push(a[i] + (b[i] - a[i]) * t);
	return out;
};

const findSegment = <V>(
	track: AeKeyframe<V>[],
	time: number,
): { from: AeKeyframe<V>; to: AeKeyframe<V>; u: number } | null => {
	if (track.length === 0) return null;
	if (time <= track[0].time) {
		return { from: track[0], to: track[0], u: 0 };
	}
	if (time >= track[track.length - 1].time) {
		const last = track[track.length - 1];
		return { from: last, to: last, u: 1 };
	}
	let low = 0;
	let high = track.length - 1;
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2);
		if (time < track[middle].time) high = middle;
		else low = middle;
	}
	const from = track[low];
	const to = track[high];
	if (from && to && time >= from.time && time < to.time) {
		const span = to.time - from.time;
		const u = span > 0 ? (time - from.time) / span : 0;
		return { from, to, u };
	}
	return null;
};

export const sampleKeyframeTrack = (
	track: AeKeyframe<number>[],
	time: number,
): number => {
	const seg = findSegment(track, time);
	if (!seg) return Number.NaN;
	if (seg.from === seg.to) return seg.from.value;
	if (seg.from.outInterpolationType === HOLD) return seg.from.value;
	const ease = easeFromKeyPair(seg.from, seg.to);
	const t = ease(seg.u);
	return lerp(seg.from.value, seg.to.value, t);
};

export const sampleKeyframeTrackVec = (
	track: AeKeyframe<readonly number[]>[],
	time: number,
): number[] => {
	const seg = findSegment(track, time);
	if (!seg) return [];
	if (seg.from === seg.to) return [...seg.from.value];
	if (seg.from.outInterpolationType === HOLD) return [...seg.from.value];
	const ease = easeFromKeyPair(seg.from, seg.to);
	const t = ease(seg.u);
	return lerpVec(seg.from.value, seg.to.value, t);
};
