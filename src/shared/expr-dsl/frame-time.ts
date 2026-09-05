/**
 * The `time` variable an expression reads, derived from the sampled frame.
 *
 * It lives in `shared/` rather than beside one presentation stage because every
 * expression seam needs it and they do NOT share a layer: node-native and effect
 * bindings are sampled from `entities/motion`, camera-channel expressions from
 * `entities/scene`. A second copy of the fallback would let two seams disagree
 * about what `time` means at the same frame on the same document.
 */

/** fps assumed when a document carries no usable rate. */
const FALLBACK_FPS = 30;

/** Time (seconds) for a frame at a given fps, defaulting to 30fps when unset/invalid. */
export const expressionFrameTime = (
	frame: number,
	fps: number | undefined,
): number => {
	const safeFps =
		typeof fps === "number" && Number.isFinite(fps) && fps > 0
			? fps
			: FALLBACK_FPS;
	return frame / safeFps;
};
