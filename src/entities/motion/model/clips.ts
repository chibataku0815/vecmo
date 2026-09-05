import type { AnimationClip, MotionDocument } from "./types";

const FIRST_FRAME = 0;
const MIN_CLIP_DURATION_FRAMES = 1;

/** Authored clip timing before or after normalization to document frame bounds. */
export type AnimationClipRange = Pick<
	AnimationClip,
	"startFrame" | "durationFrames"
>;

/** Clip timing plus the inclusive final frame used by timeline handles. */
export type NormalizedAnimationClipRange = AnimationClipRange & {
	readonly endFrame: number;
};

/**
 * Context for sanitizing track assignment during clip authoring. Supplying a
 * range and clip id enables deterministic overlap rejection while keeping the
 * read-only timeline projection free to merely drop stale track ids.
 */
export type AnimationClipTrackSanitizationOptions = {
	readonly clipId?: string;
	readonly range?: AnimationClipRange;
};

export type AnimationClipTrackAssignmentRejectionReason =
	| "missing-track"
	| "duplicate-track"
	| "overlapping-range";

export type RejectedAnimationClipTrackAssignment = {
	readonly trackId: string;
	readonly reason: AnimationClipTrackAssignmentRejectionReason;
};

export type AnimationClipTrackAssignmentValidation = {
	readonly trackIds: readonly string[];
	readonly rejected: readonly RejectedAnimationClipTrackAssignment[];
};

type MotionClipTrackSanitizationDocument = Pick<MotionDocument, "tracks"> &
	Partial<Pick<MotionDocument, "clips" | "durationFrames">>;

const finiteRoundedFrame = (value: number, fallback: number): number =>
	Number.isFinite(value) ? Math.round(value) : fallback;

const documentFinalFrame = (durationFrames: number): number =>
	Math.max(FIRST_FRAME, finiteRoundedFrame(durationFrames, FIRST_FRAME));

/**
 * Returns the inclusive final frame covered by a clip. `durationFrames` is a
 * frame count, while the document timeline addresses concrete frame indices; a
 * one-frame clip that starts at frame 12 therefore ends at frame 12.
 */
export function animationClipEndFrame(clip: AnimationClipRange): number {
	const startFrame = finiteRoundedFrame(clip.startFrame, FIRST_FRAME);
	const durationFrames = Math.max(
		MIN_CLIP_DURATION_FRAMES,
		finiteRoundedFrame(clip.durationFrames, MIN_CLIP_DURATION_FRAMES),
	);
	return startFrame + durationFrames - 1;
}

/**
 * Clamps an authored clip range to the finite frame indices carried by the
 * MotionDocument. The helper preserves a one-frame clip at the document's final
 * frame instead of forcing timeline UI to special-case that legal endpoint.
 */
export function normalizeAnimationClipRange(
	range: AnimationClipRange,
	documentDurationFrames: number,
): NormalizedAnimationClipRange {
	const finalFrame = documentFinalFrame(documentDurationFrames);
	const startFrame = Math.min(
		finalFrame,
		Math.max(FIRST_FRAME, finiteRoundedFrame(range.startFrame, FIRST_FRAME)),
	);
	const requestedDurationFrames = Math.max(
		MIN_CLIP_DURATION_FRAMES,
		finiteRoundedFrame(range.durationFrames, MIN_CLIP_DURATION_FRAMES),
	);
	const maxDurationFrames = finalFrame - startFrame + 1;
	const durationFrames = Math.min(
		requestedDurationFrames,
		Math.max(MIN_CLIP_DURATION_FRAMES, maxDurationFrames),
	);
	return {
		startFrame,
		durationFrames,
		endFrame: startFrame + durationFrames - 1,
	};
}

/**
 * Returns whether two authored clip ranges intersect after both are normalized
 * to the same MotionDocument frame bounds. Ranges use inclusive final frames so
 * a clip ending at frame 12 does not overlap one starting at frame 13.
 */
export function animationClipRangesOverlap(
	left: AnimationClipRange,
	right: AnimationClipRange,
	documentDurationFrames: number,
): boolean {
	const normalizedLeft = normalizeAnimationClipRange(
		left,
		documentDurationFrames,
	);
	const normalizedRight = normalizeAnimationClipRange(
		right,
		documentDurationFrames,
	);
	return (
		normalizedLeft.startFrame <= normalizedRight.endFrame &&
		normalizedRight.startFrame <= normalizedLeft.endFrame
	);
}

/**
 * Checks whether a playhead frame falls inside a clip's inclusive frame range.
 * Fractional playback frames are accepted so preview can mark a clip active
 * during interpolated playback without snapping the transport.
 */
export function animationClipContainsFrame(
	clip: AnimationClipRange,
	frame: number,
): boolean {
	if (!Number.isFinite(frame)) return false;
	return frame >= clip.startFrame && frame <= animationClipEndFrame(clip);
}

/** Keeps timeline labels readable even if a caller submits a blank rename. */
export function sanitizeAnimationClipName(name: string): string {
	const trimmed = name.trim();
	return trimmed.length > 0 ? trimmed : "Untitled clip";
}

const trackOverlapsAssignedClip = (
	motion: MotionClipTrackSanitizationDocument,
	trackId: string,
	options: AnimationClipTrackSanitizationOptions | undefined,
): boolean => {
	const range = options?.range;
	const clips = motion.clips;
	const durationFrames = motion.durationFrames;
	if (!range || clips === undefined || durationFrames === undefined) {
		return false;
	}
	return clips.some((clip) => {
		if (clip.id === options.clipId) return false;
		if (!clip.trackIds.includes(trackId)) return false;
		return animationClipRangesOverlap(range, clip, durationFrames);
	});
};

/**
 * Validates clip track membership against the current MotionDocument. Missing
 * ids, duplicates, and overlapping assignments are reported in input order so UI
 * callers can show stable rejected reasons before committing a command.
 */
export function validateAnimationClipTrackAssignment(
	motion: MotionClipTrackSanitizationDocument,
	trackIds: readonly string[],
	options?: AnimationClipTrackSanitizationOptions,
): AnimationClipTrackAssignmentValidation {
	const existingTrackIds = new Set(motion.tracks.map((track) => track.id));
	const seen = new Set<string>();
	const sanitized: string[] = [];
	const rejected: RejectedAnimationClipTrackAssignment[] = [];
	for (const trackId of trackIds) {
		if (!existingTrackIds.has(trackId)) {
			rejected.push({ trackId, reason: "missing-track" });
			continue;
		}
		if (seen.has(trackId)) {
			rejected.push({ trackId, reason: "duplicate-track" });
			continue;
		}
		if (trackOverlapsAssignedClip(motion, trackId, options)) {
			rejected.push({ trackId, reason: "overlapping-range" });
			continue;
		}
		seen.add(trackId);
		sanitized.push(trackId);
	}
	return { trackIds: sanitized, rejected };
}

/**
 * Dedupe and validate clip track membership against the current MotionDocument.
 * Clips may be empty, but they should not retain ids for tracks that the side-car
 * no longer owns. During authoring, callers can provide the target clip range so
 * a track already assigned to an overlapping clip is rejected deterministically.
 */
export function sanitizeAnimationClipTrackIds(
	motion: MotionClipTrackSanitizationDocument,
	trackIds: readonly string[],
	options?: AnimationClipTrackSanitizationOptions,
): readonly string[] {
	return validateAnimationClipTrackAssignment(motion, trackIds, options)
		.trackIds;
}
