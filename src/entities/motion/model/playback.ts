/**
 * Pure transport advancement, kept out of the rAF React effect so the loop/clamp
 * edge logic is unit-testable (per the "timeline math is pure" rule). Given the
 * current frame and the real elapsed seconds, it returns the next playhead frame
 * and whether non-looping playback has reached the end.
 */

// Caps a single advance so a backgrounded tab (rAF paused, then a huge delta on
// refocus) resumes smoothly instead of jumping or wrapping unpredictably.
const MAX_DELTA_SECONDS = 0.25;
const FRAME_EPSILON = 1e-9;

export type AdvanceOptions = {
	readonly fps: number;
	readonly durationFrames: number;
	readonly loop: boolean;
};

export type AdvanceResult = {
	readonly frame: number;
	/** True once non-looping playback has reached the final frame and should stop. */
	readonly ended: boolean;
};

/**
 * Normalizes the playhead just before playback starts. Replaying from the exact
 * final frame restarts at frame zero; otherwise the existing scrubbed frame is
 * preserved so play/pause round-trips do not drift.
 */
export function playbackStartFrame(
	currentFrame: number,
	options: Pick<AdvanceOptions, "durationFrames">,
): number {
	const finalFrame =
		Number.isFinite(options.durationFrames) && options.durationFrames > 0
			? Math.round(options.durationFrames)
			: 0;
	if (!Number.isFinite(currentFrame)) return 0;
	if (currentFrame >= finalFrame) return 0;
	return Math.max(0, currentFrame);
}

export function advanceFrame(
	currentFrame: number,
	deltaSeconds: number,
	options: AdvanceOptions,
): AdvanceResult {
	const { fps, durationFrames, loop } = options;
	if (!Number.isFinite(durationFrames) || durationFrames <= 0) {
		return { frame: 0, ended: true };
	}
	const finalFrame = Math.round(durationFrames);
	const startFrame = Number.isFinite(currentFrame)
		? Math.max(0, currentFrame)
		: 0;
	if (!Number.isFinite(fps) || fps <= 0) {
		return { frame: Math.min(startFrame, finalFrame), ended: true };
	}
	const delta = Math.max(0, Math.min(deltaSeconds, MAX_DELTA_SECONDS));
	if (!loop && startFrame >= finalFrame && delta === 0) {
		return { frame: 0, ended: false };
	}
	const raw = startFrame + delta * fps;
	if (loop) {
		const frame =
			Math.abs(raw - finalFrame) < FRAME_EPSILON
				? finalFrame
				: raw % finalFrame;
		return { frame, ended: false };
	}
	if (raw < finalFrame) return { frame: raw, ended: false };
	return { frame: finalFrame, ended: true };
}
