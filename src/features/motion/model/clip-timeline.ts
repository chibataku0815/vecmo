import {
	type AnimationClipRange,
	animationClipContainsFrame,
	animationClipEndFrame,
	normalizeAnimationClipRange,
	sanitizeAnimationClipTrackIds,
} from "@/entities/motion/model/clips";
import type { MotionCommand } from "@/entities/motion/model/command";
import {
	assignAnimationClipTracks,
	type CreateAnimationClipInput,
	createAnimationClip,
	deleteAnimationClip,
	renameAnimationClip,
	reorderAnimationClip,
	snapMotionFrame,
	trimAnimationClip,
} from "@/entities/motion/model/commands";
import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";

/**
 * Read-only clip lane row for a future timeline widget. The row carries
 * normalized timing and valid track membership so UI code does not need to
 * inspect raw MotionDocument arrays.
 */
export type MotionClipTimelineRow = AnimationClipRange & {
	readonly id: string;
	readonly name: string;
	readonly index: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly trackCount: number;
	readonly selected: boolean;
	readonly activeAtFrame: boolean;
};

export type MotionClipTrimEdge = "start" | "end";

/** Scene-free timeline clip projection for the current motion playhead. */
export type MotionClipTimelineState = {
	readonly fps: number;
	readonly durationFrames: number;
	readonly currentFrame: number;
	readonly selectedClipId: string | null;
	readonly clips: readonly MotionClipTimelineRow[];
	readonly hasClips: boolean;
};

const rowForClip = (
	motion: MotionDocument,
	clip: AnimationClip,
	index: number,
	currentFrame: number,
	selectedClipId: string | null,
): MotionClipTimelineRow => {
	const range = normalizeAnimationClipRange(clip, motion.durationFrames);
	const trackIds = sanitizeAnimationClipTrackIds(motion, clip.trackIds);
	return {
		id: clip.id,
		name: clip.name,
		index,
		startFrame: range.startFrame,
		durationFrames: range.durationFrames,
		endFrame: range.endFrame,
		trackIds,
		trackCount: trackIds.length,
		selected: clip.id === selectedClipId,
		activeAtFrame: animationClipContainsFrame(range, currentFrame),
	};
};

/**
 * Projects MotionDocument clips into stable timeline rows for the later widget
 * bridge. This adapter is intentionally read-only and scene-free: it never
 * samples SceneDocument, never mutates stores, and filters stale track ids at the
 * presentation edge rather than rewriting history.
 */
export function buildMotionClipTimelineState({
	motion,
	currentFrame,
	selectedClipId = null,
}: {
	readonly motion: MotionDocument;
	readonly currentFrame: number;
	readonly selectedClipId?: string | null;
}): MotionClipTimelineState {
	const snappedFrame = snapMotionFrame(currentFrame, motion.durationFrames);
	const clips = motion.clips.map((clip, index) =>
		rowForClip(motion, clip, index, snappedFrame, selectedClipId),
	);
	return {
		fps: motion.fps,
		durationFrames: motion.durationFrames,
		currentFrame: snappedFrame,
		selectedClipId,
		clips,
		hasClips: clips.length > 0,
	};
}

/**
 * Creates the timeline command for a new clip. The returned command writes only
 * MotionDocument state when applied by the motion command bus.
 */
export function createTimelineClipCreateCommand(
	input: CreateAnimationClipInput,
): MotionCommand {
	return createAnimationClip(input);
}

/** Creates the timeline command for committing an inline clip rename. */
export function createTimelineClipRenameCommand(
	clipId: string,
	name: string,
): MotionCommand {
	return renameAnimationClip(clipId, name);
}

/** Creates the timeline command for a clip edge drag or numeric range edit. */
export function createTimelineClipTrimCommand(
	clipId: string,
	range: AnimationClipRange,
): MotionCommand {
	return trimAnimationClip(clipId, range);
}

/** Creates the timeline command for assigning tracks to a clip lane. */
export function createTimelineClipAssignTracksCommand(
	clipId: string,
	trackIds: readonly string[],
): MotionCommand {
	return assignAnimationClipTracks(clipId, trackIds);
}

/** Creates the timeline command for reordering clip lanes. */
export function createTimelineClipReorderCommand(
	clipId: string,
	toIndex: number,
): MotionCommand {
	return reorderAnimationClip(clipId, toIndex);
}

/** Creates the timeline command for removing a clip lane entry. */
export function createTimelineClipDeleteCommand(clipId: string): MotionCommand {
	return deleteAnimationClip(clipId);
}

/**
 * Resolves the clip id the timeline can still address after the MotionDocument
 * changes. UI state uses this to clear a deleted/undone clip selection instead
 * of leaving focus on a lane row that no longer exists.
 */
export function resolveMotionClipTimelineSelection(
	state: MotionClipTimelineState,
): string | null {
	if (!state.selectedClipId) return null;
	return state.clips.some((clip) => clip.id === state.selectedClipId)
		? state.selectedClipId
		: null;
}

/**
 * Converts a dragged clip edge into the range consumed by the existing
 * MotionDocument trim command. The helper preserves the opposite edge and keeps
 * the clip at least one frame wide, matching timeline handle behavior without
 * redefining clip normalization rules in React.
 */
export function createTimelineClipTrimRangeForEdge({
	clip,
	edge,
	frame,
	durationFrames,
}: {
	readonly clip: AnimationClipRange;
	readonly edge: MotionClipTrimEdge;
	readonly frame: number;
	readonly durationFrames: number;
}): AnimationClipRange {
	const frameRange = normalizeAnimationClipRange(
		{ startFrame: frame, durationFrames: 1 },
		durationFrames,
	);
	const currentRange = normalizeAnimationClipRange(clip, durationFrames);
	if (edge === "start") {
		const startFrame = Math.min(currentRange.endFrame, frameRange.startFrame);
		return {
			startFrame,
			durationFrames: currentRange.endFrame - startFrame + 1,
		};
	}
	const endFrame = Math.max(currentRange.startFrame, frameRange.startFrame);
	const range = normalizeAnimationClipRange(
		{
			startFrame: currentRange.startFrame,
			durationFrames: endFrame - currentRange.startFrame + 1,
		},
		durationFrames,
	);
	return {
		startFrame: range.startFrame,
		durationFrames: range.durationFrames,
	};
}

/** Returns the inclusive end frame a timeline handle should display for a row. */
export function motionClipTimelineEndFrame(clip: AnimationClipRange): number {
	return animationClipEndFrame(clip);
}
