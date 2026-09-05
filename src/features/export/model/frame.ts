/**
 * Clamps preview/export sampling to the frame range understood by the motion
 * transport. Frame units are preserved as frames, including fractional playback
 * positions produced by rAF.
 */
export function clampExportFrame(
	frame: number,
	durationFrames: number,
): number {
	if (!Number.isFinite(frame) || !Number.isFinite(durationFrames)) return 0;
	const maxFrame = Math.max(0, durationFrames);
	return Math.min(Math.max(0, frame), maxFrame);
}
