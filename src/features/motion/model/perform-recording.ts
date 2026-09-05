/**
 * Pure conversion for iPad Pencil-motion "Perform mode" (L3): turns the raw
 * `(x, y, tMs)` samples a Select-tool drag captures into a sparse list of
 * whole-frame `(frame, x, y)` keyframe stops. Kept out of the canvas handler
 * and the widget recorder so the branchy time→frame and jitter-decimation math
 * stays unit-testable without a store or the DOM (mirrors the freehand-stroke
 * pipeline in `features/draw/model/freehand.ts`, which this module cannot
 * import — features must not import other features — so the RDP thinning is
 * reimplemented inline here rather than shared).
 *
 * `x`/`y` are whatever coordinate space the caller captured (artboard-local
 * node position units in the shipped Perform-mode recorder); this module never
 * interprets them, only decimates and retimes the path.
 */

/** One raw drag sample: a position and elapsed time since the gesture started. */
export type PerformSample = {
	readonly x: number;
	readonly y: number;
	/** Milliseconds since the first sample of the gesture. Always finite, >= 0. */
	readonly tMs: number;
};

/** One authored stop: a whole timeline frame and the position keyed there. */
export type PerformKeyframe = {
	readonly frame: number;
	readonly x: number;
	readonly y: number;
};

/**
 * RDP perpendicular-distance tolerance, in the same units as `x`/`y` (artboard-
 * local node-position units for the shipped recorder). Fixed rather than a
 * parameter because the public signature is frozen by the calling contract
 * (`fps` only) — chosen small enough to remove sub-unit pointer jitter without
 * visibly straightening an intentional performed path.
 */
const JITTER_TOLERANCE = 1;

/** Defensive ceiling on an authored frame, so a stalled or runaway capture (a
 * gesture that somehow reports an enormous `tMs`) can never author a keyframe
 * far enough out to balloon the timeline. */
const MAX_PERFORM_FRAME = 600;

const FALLBACK_FPS = 30;

const isFiniteSample = (sample: PerformSample): boolean =>
	Number.isFinite(sample.x) &&
	Number.isFinite(sample.y) &&
	Number.isFinite(sample.tMs);

/**
 * Perpendicular distance from `sample` to the infinite line through `a`→`b` in
 * (x, y) only (`tMs` never bends the RDP decision). Degenerates to point
 * distance when `a`/`b` coincide, keeping the recursion finite on a paused
 * (zero-movement) span.
 */
function perpendicularDistance(
	sample: PerformSample,
	a: PerformSample,
	b: PerformSample,
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lineLength = Math.hypot(dx, dy);
	if (lineLength === 0) return Math.hypot(sample.x - a.x, sample.y - a.y);
	const cross = Math.abs(dx * (a.y - sample.y) - dy * (a.x - sample.x));
	return cross / lineLength;
}

/**
 * Ramer–Douglas–Peucker thinning over the (x, y) path only. Endpoints are
 * always kept; `tMs` rides along on each surviving sample unchanged. Iterative
 * (explicit stack) so a long capture cannot blow the call stack.
 */
function simplifyPerformSamples(
	samples: readonly PerformSample[],
	tolerance: number,
): readonly PerformSample[] {
	if (samples.length <= 2 || tolerance <= 0) return samples;

	const keep = Array.from({ length: samples.length }, () => false);
	keep[0] = true;
	keep[samples.length - 1] = true;

	const stack: Array<readonly [number, number]> = [[0, samples.length - 1]];
	while (stack.length > 0) {
		const span = stack.pop();
		if (!span) continue;
		const [start, end] = span;
		if (end - start < 2) continue;

		let maxDistance = 0;
		let maxIndex = -1;
		for (let index = start + 1; index < end; index += 1) {
			const distance = perpendicularDistance(
				samples[index],
				samples[start],
				samples[end],
			);
			if (distance > maxDistance) {
				maxDistance = distance;
				maxIndex = index;
			}
		}

		if (maxIndex !== -1 && maxDistance > tolerance) {
			keep[maxIndex] = true;
			stack.push([start, maxIndex]);
			stack.push([maxIndex, end]);
		}
	}

	return samples.filter((_, index) => keep[index]);
}

/**
 * Converts captured Perform-mode drag samples into whole-frame x/y keyframe
 * stops. `tMs → frame` is `round(tMs / 1000 * fps)` with no other offset — the
 * capture is a fresh "captured-timing motion path" anchored at its own start,
 * not a splice against the current playhead (see
 * `docs/product-knowledge/ipad-perform-motion.md`).
 *
 * Non-finite samples are dropped, then the (x, y) path is RDP-thinned to
 * remove sub-unit pointer jitter (endpoints always survive). Each surviving
 * sample keeps its own frame; because `tMs` only increases across a capture,
 * frame collisions can only happen between adjacent survivors, and the later
 * one (in time) wins — so a pause that yields several samples on one frame
 * still authors that frame's LAST position, not its first. Frames are clamped
 * to `[0, 600]` so a stalled/runaway capture cannot author an absurd frame.
 *
 * Returns `[]` for empty input. A single surviving sample still authors one
 * keyframe (a static key, no animation) rather than being rejected — a click-
 * length Perform drag is a valid, if degenerate, capture.
 */
export function performSamplesToKeyframes(
	samples: readonly PerformSample[],
	fps: number,
): readonly PerformKeyframe[] {
	const finiteSamples = samples.filter(isFiniteSample);
	if (finiteSamples.length === 0) return [];

	const simplified = simplifyPerformSamples(finiteSamples, JITTER_TOLERANCE);
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;

	const byFrame = new Map<number, PerformKeyframe>();
	for (const sample of simplified) {
		const frame = Math.min(
			MAX_PERFORM_FRAME,
			Math.max(0, Math.round((sample.tMs / 1000) * safeFps)),
		);
		// A later `Map.set` for an existing key overwrites its value without
		// moving the key's position in iteration order, so an explicit sort below
		// is still needed to guarantee frame order (it is otherwise a no-op, since
		// `tMs` — and therefore `frame` — only increases across `simplified`).
		byFrame.set(frame, { frame, x: sample.x, y: sample.y });
	}

	return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}
