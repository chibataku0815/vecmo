import { castDraft, current, type Draft, isDraft } from "immer";
import type { LookGraphOwnerRef } from "@/entities/scene/model/look-graph";
import {
	type SourceOpticsParameterTarget,
	sourceOpticsParameterDescriptor,
} from "@/entities/scene/model/source-optics";
import type {
	BezierShape,
	LinearGradientPaint,
	MeshGradientPaint,
	RadialGradientPaint,
	Vec2,
} from "@/entities/scene/model/types";
import {
	type ExpressionSource,
	type ParseResult,
	parseExpression,
} from "@/shared/expr-dsl";
import {
	type AeKeyframe,
	splitTemporalCurveAtTime,
} from "@/shared/glammer/keyframe-track";
import { deepEqual } from "@/shared/lib/deep-equal";
import { createId } from "@/shared/lib/id";
import {
	type AutomationTrack,
	normalizeAutomationTrack,
} from "@/shared/vec-core";
import {
	type AnimationClipRange,
	normalizeAnimationClipRange,
	sanitizeAnimationClipName,
	sanitizeAnimationClipTrackIds,
} from "./clips";
import type { MotionCommand } from "./command";
import {
	compileMotionTimingTemplateForKeyframe,
	defaultEasedKeyframe,
	type EasingCurve,
	type EasingPreset,
	type MotionTimingTemplateKeyframeHold,
	motionTimingTemplateKeyframeHoldOf,
	segmentEasingCurveOf,
	withSegmentEasing,
	withSegmentEasingCurve,
} from "./easing";
import { isValidPathShape, validateKeyframeValue } from "./keyframe-validation";
import {
	inspectMorphTopology,
	repairMorphShapeVertexCount,
	reverseMorphWinding,
	rotateMorphFirstVertex,
} from "./morph-topology";
import { clonePathShape } from "./path-shape";
import { TEXT_SELECTOR_OFFSET_EXPR_VARS } from "./text-animator";
import type {
	AnimatableProperty,
	AnimatableValue,
	AnimationClip,
	AnimationClipProvenance,
	KeyframeTrack,
	MotionDocument,
	MotionTimingRangeIssue,
	MotionTimingUpdateInput,
	PositionPathKey,
	PositionPathSpatialMode,
	RangeTextSelector,
	SourceOpticsParameterTrack,
	TextAnimatorBinding,
	TextAnimatorOffsetKeyAddress,
} from "./types";

const MIN_FRAME = 0;
const TRACK_ID_PREFIX = "track";
const CLIP_ID_PREFIX = "clip";

/** Snaps an authored frame onto the whole-frame grid inside the document range. */
export function snapMotionFrame(frame: number, durationFrames: number): number {
	const maxFrame = Number.isFinite(durationFrames)
		? Math.max(MIN_FRAME, Math.round(durationFrames))
		: MIN_FRAME;
	if (!Number.isFinite(frame)) return MIN_FRAME;
	return Math.min(maxFrame, Math.max(MIN_FRAME, Math.round(frame)));
}

const coalesceFrame = (frame: number): number =>
	Number.isFinite(frame) ? Math.round(frame) : MIN_FRAME;

const isTimelineFrame = (frame: number, durationFrames: number): boolean =>
	Number.isInteger(frame) && frame >= MIN_FRAME && frame < durationFrames;

const rangeIssue = (
	issues: MotionTimingRangeIssue[],
	path: string,
	frame: number,
	durationFrames: number,
): void => {
	if (!isTimelineFrame(frame, durationFrames)) {
		issues.push({ path, frame });
	}
};

const intervalIssue = (
	issues: MotionTimingRangeIssue[],
	path: string,
	startFrame: number,
	spanFrames: number,
	durationFrames: number,
): void => {
	const endFrameExclusive = startFrame + spanFrames;
	if (
		!Number.isInteger(startFrame) ||
		!Number.isInteger(spanFrames) ||
		startFrame < MIN_FRAME ||
		spanFrames <= 0 ||
		endFrameExclusive > durationFrames
	) {
		issues.push({ path, endFrameExclusive });
	}
};

/**
 * Lists persisted absolute frame addresses that would be invalid after a timing
 * shrink. It never shifts, rounds, clamps, or repairs data: callers use the
 * presence of any issue as a hard reject before changing duration. Grammar's
 * serialized bindings intentionally carry relative technique parameters rather
 * than absolute timeline addresses; any grammar output baked into the document is
 * already covered by tracks, clips, and automation below.
 */
export function motionTimingRangeIssues(
	document: MotionDocument,
	durationFrames: number,
): readonly MotionTimingRangeIssue[] {
	const issues: MotionTimingRangeIssue[] = [];
	if (!Number.isInteger(durationFrames) || durationFrames <= 0) {
		return [{ path: "durationFrames" }];
	}

	for (const track of document.tracks) {
		for (const keyframe of track.keyframes) {
			rangeIssue(
				issues,
				`tracks.${track.id}.keyframes`,
				keyframe.time,
				durationFrames,
			);
		}
	}
	for (const pathTrack of document.positionPaths ?? []) {
		for (const key of pathTrack.keys) {
			rangeIssue(
				issues,
				`positionPaths.${pathTrack.id}.keys`,
				key.frame,
				durationFrames,
			);
		}
	}
	for (const track of document.lookNodeTracks ?? []) {
		for (const keyframe of track.keyframes) {
			rangeIssue(
				issues,
				`lookNodeTracks.${track.id}.keyframes`,
				keyframe.time,
				durationFrames,
			);
		}
	}
	for (const track of document.sourceOpticsTracks ?? []) {
		for (const keyframe of track.keyframes) {
			rangeIssue(
				issues,
				`sourceOpticsTracks.${track.id}.keyframes`,
				keyframe.time,
				durationFrames,
			);
		}
	}
	for (const track of document.cameraTracks ?? []) {
		for (const keyframe of track.keyframes) {
			rangeIssue(
				issues,
				`cameraTracks.${track.id}.keyframes`,
				keyframe.time,
				durationFrames,
			);
		}
	}
	for (const segment of document.cameraCuts ?? []) {
		intervalIssue(
			issues,
			`cameraCuts.${segment.id}`,
			segment.startFrame,
			segment.durationFrames,
			durationFrames,
		);
		if (segment.thumbnailFrame !== undefined) {
			rangeIssue(
				issues,
				`cameraCuts.${segment.id}.thumbnailFrame`,
				segment.thumbnailFrame,
				durationFrames,
			);
		}
	}
	for (const animator of document.textAnimators ?? []) {
		if (animator.clip) {
			intervalIssue(
				issues,
				`textAnimators.${animator.id}.clip`,
				animator.clip.startFrame,
				animator.clip.durationFrames,
				durationFrames,
			);
		}
		for (const [selectorIndex, selector] of animator.selectors.entries()) {
			for (const keyframe of selector.offsetKeyframes ?? []) {
				rangeIssue(
					issues,
					`textAnimators.${animator.id}.selectors.${selectorIndex}.offsetKeyframes`,
					keyframe.time,
					durationFrames,
				);
			}
		}
	}
	for (const clip of document.clips) {
		intervalIssue(
			issues,
			`clips.${clip.id}`,
			clip.startFrame,
			clip.durationFrames,
			durationFrames,
		);
	}
	for (const [trackIndex, track] of (
		document.automation?.tracks ?? []
	).entries()) {
		for (const keyframe of track.keyframes) {
			rangeIssue(
				issues,
				`automation.tracks.${trackIndex}.keyframes`,
				keyframe.frame,
				durationFrames,
			);
		}
	}
	return issues;
}

const byTime = (
	a: AeKeyframe<AnimatableValue>,
	b: AeKeyframe<AnimatableValue>,
) => a.time - b.time;

const cloneKeyframeValue = (
	property: AnimatableProperty,
	value: AnimatableValue,
): AnimatableValue =>
	property === "pathShape" ? clonePathShape(value as BezierShape) : value;

const findTrackByTarget = (
	draft: Draft<MotionDocument>,
	nodeId: string,
	property: AnimatableProperty,
): Draft<KeyframeTrack> | undefined =>
	draft.tracks.find(
		(track) =>
			track.target.nodeId === nodeId && track.target.property === property,
	);

const findTrackById = (
	draft: Draft<MotionDocument>,
	trackId: string,
): Draft<KeyframeTrack> | undefined =>
	draft.tracks.find((track) => track.id === trackId);

const findClipById = (
	draft: Draft<MotionDocument>,
	clipId: string,
): Draft<AnimationClip> | undefined =>
	draft.clips.find((clip) => clip.id === clipId);

const sameTrackIds = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((trackId, index) => trackId === right[index]);

const sameStringList = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((value, index) => value === right[index]);

const cloneAnimationClipProvenance = (
	provenance: AnimationClipProvenance,
): AnimationClipProvenance => ({
	source: provenance.source,
	label: provenance.label,
	bindingId: provenance.bindingId,
	techniqueId: provenance.techniqueId,
	techniqueLabel: provenance.techniqueLabel,
	targetIds: [...provenance.targetIds],
	generatedNodeIds: [...provenance.generatedNodeIds],
	...(provenance.editableArtifacts
		? {
				editableArtifacts: provenance.editableArtifacts.map((artifact) => ({
					id: artifact.id,
					kind: artifact.kind,
					targetIds: [...artifact.targetIds],
					channels: [...artifact.channels],
					description: artifact.description,
				})),
			}
		: {}),
});

const replaceNodeIdList = (
	nodeIds: readonly string[],
	fromNodeId: string,
	toNodeId: string,
): readonly string[] =>
	nodeIds.map((nodeId) => (nodeId === fromNodeId ? toNodeId : nodeId));

const retargetAnimationClipProvenance = (
	provenance: AnimationClipProvenance,
	fromNodeId: string,
	toNodeId: string,
): AnimationClipProvenance => {
	const targetIds = replaceNodeIdList(
		provenance.targetIds,
		fromNodeId,
		toNodeId,
	);
	const generatedNodeIds = replaceNodeIdList(
		provenance.generatedNodeIds,
		fromNodeId,
		toNodeId,
	);
	const editableArtifacts = provenance.editableArtifacts?.map((artifact) => ({
		...artifact,
		targetIds: replaceNodeIdList(artifact.targetIds, fromNodeId, toNodeId),
	}));
	const artifactChanged =
		editableArtifacts?.some(
			(artifact, index) =>
				!sameStringList(
					artifact.targetIds,
					provenance.editableArtifacts?.[index]?.targetIds ?? [],
				),
		) ?? false;
	if (
		sameStringList(targetIds, provenance.targetIds) &&
		sameStringList(generatedNodeIds, provenance.generatedNodeIds) &&
		!artifactChanged
	) {
		return provenance;
	}
	return {
		...provenance,
		targetIds,
		generatedNodeIds,
		...(editableArtifacts ? { editableArtifacts } : {}),
	};
};

/**
 * Inserts or replaces a keyframe for a node property at a frame. A missing track
 * is created on demand, so the timeline and the inspector can record the first
 * key of a channel without a separate "add track" step. Replacing an existing key
 * keeps its easing handles and only rewrites the value; new keys get a smooth
 * symmetric default.
 *
 * Default coalesce key folds repeated writes to the same channel *at the same
 * requested frame* (one inspector drag with the playhead parked) into a single
 * undo entry, while edits at different requested frames stay independently
 * reversible. Callers that need clamp-aware coalescing should pass already
 * snapped frames from the active document.
 */
export function upsertKeyframe<P extends AnimatableProperty>(
	nodeId: string,
	property: P,
	frame: number,
	value: P extends "pathShape"
		? BezierShape
		: P extends "meshPaint"
			? MeshGradientPaint
			: P extends "fillGradient"
				? LinearGradientPaint | RadialGradientPaint
				: number,
): MotionCommand;
export function upsertKeyframe(
	nodeId: string,
	property: AnimatableProperty,
	frame: number,
	value: AnimatableValue,
): MotionCommand {
	return {
		type: "motion/upsert-keyframe",
		label: "Set keyframe",
		coalesceKey: `motion-key:${nodeId}:${property}:${coalesceFrame(frame)}`,
		run: (draft) => {
			upsertKeyframeIntoDraft(draft, nodeId, property, frame, value);
		},
	};
}

/**
 * Inserts or replaces a single channel's key inside an already-open draft. Shared
 * by {@link upsertKeyframe} and the multi-channel position command so every write
 * path runs identical validation, cloning, default easing, and time-sorting.
 * Returns whether the channel was written (an invalid value is skipped silently,
 * mirroring the single-key command's no-op contract).
 */
const upsertKeyframeIntoDraft = (
	draft: Draft<MotionDocument>,
	nodeId: string,
	property: AnimatableProperty,
	frame: number,
	value: AnimatableValue,
): boolean => {
	const snapped = snapMotionFrame(frame, draft.durationFrames);
	const existingTrack = findTrackByTarget(draft, nodeId, property);
	const validation = validateKeyframeValue({
		property,
		value,
		track: existingTrack ? current(existingTrack) : undefined,
		frame: snapped,
	});
	if (!validation.valid) return false;
	const storedValue = cloneKeyframeValue(property, value);
	const track = existingTrack ?? appendTrack(draft, nodeId, property);
	const existing = track.keyframes.find(
		(keyframe) => keyframe.time === snapped,
	);
	if (existing) {
		// castDraft: a snapshot value (mesh paint) is deeply readonly, which Immer's
		// Draft slot type rejects; the value is owned/cloned, so the cast is safe.
		existing.value = castDraft(storedValue);
		return true;
	}
	track.keyframes.push(
		castDraft(defaultEasedKeyframe({ time: snapped, value: storedValue })),
	);
	track.keyframes.sort(byTime);
	return true;
};

/** Deterministic side-car track id for one Look-node param (owner + node + key). */
export const lookNodeTrackId = (
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
): string => {
	const ownerKey =
		owner.scope === "artboard"
			? `artboard:${owner.artboardId}`
			: owner.scope === "node"
				? `node:${owner.nodeId}`
				: owner.scope === "scoped-overlay"
					? `scoped-overlay:${owner.artboardId}:${owner.scopedLookId}`
					: "scene";
	return `look:${ownerKey}:${lookNodeId}:${paramKey}`;
};

const upsertLookNodeKeyframeIntoDraft = (
	draft: Draft<MotionDocument>,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	frame: number,
	value: number,
): boolean => {
	if (!Number.isFinite(value)) return false;
	const snapped = snapMotionFrame(frame, draft.durationFrames);
	if (!draft.lookNodeTracks) draft.lookNodeTracks = [];
	const trackId = lookNodeTrackId(owner, lookNodeId, paramKey);
	const existingTrack = draft.lookNodeTracks.find(
		(candidate) => candidate.id === trackId,
	);
	const track =
		existingTrack ??
		draft.lookNodeTracks[
			draft.lookNodeTracks.push({
				id: trackId,
				target: { owner, lookNodeId, paramKey },
				keyframes: [],
			}) - 1
		];
	const existing = track.keyframes.find(
		(keyframe) => keyframe.time === snapped,
	);
	if (existing) {
		existing.value = value;
		return true;
	}
	track.keyframes.push(
		castDraft(defaultEasedKeyframe({ time: snapped, value })),
	);
	track.keyframes.sort(byTime);
	return true;
};

/**
 * Upserts one keyframe on a Look-graph node param (the side-car `lookNodeTracks`).
 * This is the typed authoring operation shared by the agent/MCP write path and a
 * future Inspector recording UI — one undo entry per (track, frame) via the
 * coalesce key, mirroring {@link upsertKeyframe}. A non-finite value is a no-op.
 */
export function upsertLookNodeKeyframe(
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	frame: number,
	value: number,
): MotionCommand {
	return {
		type: "motion/upsert-look-node-keyframe",
		label: "Set look keyframe",
		coalesceKey: `motion-looknode:${lookNodeTrackId(owner, lookNodeId, paramKey)}:${coalesceFrame(frame)}`,
		run: (draft) => {
			upsertLookNodeKeyframeIntoDraft(
				draft,
				owner,
				lookNodeId,
				paramKey,
				frame,
				value,
			);
		},
	};
}

/**
 * Removes one keyframe from a Look-graph node param's side-car track, dropping the
 * whole track once its last key is gone (so the param reverts to its base value).
 * Mirrors {@link removeKeyframe} for the node-keyed tracks and snaps the frame the
 * same way {@link upsertLookNodeKeyframe} does, so the add and the remove address
 * the identical stored frame even at the duration boundary.
 */
export function removeLookNodeKeyframe(
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	frame: number,
): MotionCommand {
	return {
		type: "motion/remove-look-node-keyframe",
		label: "Delete look keyframe",
		coalesceKey: `motion-looknode-remove:${lookNodeTrackId(owner, lookNodeId, paramKey)}:${coalesceFrame(frame)}`,
		run: (draft) => {
			const tracks = draft.lookNodeTracks;
			if (!tracks) return;
			const trackId = lookNodeTrackId(owner, lookNodeId, paramKey);
			const trackIndex = tracks.findIndex((track) => track.id === trackId);
			if (trackIndex < 0) return;
			const track = tracks[trackIndex];
			const snapped = snapMotionFrame(frame, draft.durationFrames);
			const keyIndex = track.keyframes.findIndex(
				(keyframe) => keyframe.time === snapped,
			);
			if (keyIndex < 0) return;
			track.keyframes.splice(keyIndex, 1);
			if (track.keyframes.length === 0) tracks.splice(trackIndex, 1);
		},
	};
}

/**
 * Removes an entire Look-node parameter track. Used when an optional base
 * parameter is structurally cleared (for example relinking blur Y to X), where
 * leaving a side-car track would immediately reintroduce the cleared parameter
 * during presentation. A missing track is a no-op.
 */
export function removeLookNodeParamTrack(
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
): MotionCommand {
	return {
		type: "motion/remove-look-node-track",
		label: "Delete look parameter animation",
		run: (draft) => {
			const tracks = draft.lookNodeTracks;
			if (!tracks) return;
			const trackId = lookNodeTrackId(owner, lookNodeId, paramKey);
			const trackIndex = tracks.findIndex((track) => track.id === trackId);
			if (trackIndex >= 0) tracks.splice(trackIndex, 1);
		},
	};
}

const sourceOpticsTargetsEqual = (
	left: SourceOpticsParameterTarget,
	right: SourceOpticsParameterTarget,
): boolean => {
	if (
		left.kind !== right.kind ||
		left.artboardId !== right.artboardId ||
		left.rigId !== right.rigId ||
		left.parameterId !== right.parameterId
	) {
		return false;
	}
	if (left.kind === "ray" && right.kind === "ray") {
		return left.rayId === right.rayId;
	}
	if (left.kind === "binding" && right.kind === "binding") {
		return left.bindingId === right.bindingId;
	}
	return left.kind === "rig" && right.kind === "rig";
};

const sourceOpticsTargetIsKeyframable = (
	target: SourceOpticsParameterTarget,
): boolean => {
	const descriptor = sourceOpticsParameterDescriptor(target.parameterId);
	const owner = target.kind === "binding" ? "response" : target.kind;
	return descriptor?.keyframable === true && descriptor.owner === owner;
};

/** Stable track id derived from the complete Source Optics owner address. */
export function sourceOpticsTrackId(
	target: SourceOpticsParameterTarget,
): string {
	const parts = [
		"source-optics",
		target.kind,
		target.artboardId,
		target.rigId,
		...(target.kind === "ray"
			? [target.rayId]
			: target.kind === "binding"
				? [target.bindingId]
				: []),
		target.parameterId,
	];
	return parts.map((part) => encodeURIComponent(part)).join(":");
}

const upsertSourceOpticsKeyframeIntoDraft = (
	draft: Draft<MotionDocument>,
	target: SourceOpticsParameterTarget,
	frame: number,
	value: number,
): boolean => {
	if (!Number.isFinite(value) || !sourceOpticsTargetIsKeyframable(target)) {
		return false;
	}
	const snapped = snapMotionFrame(frame, draft.durationFrames);
	if (!draft.sourceOpticsTracks) draft.sourceOpticsTracks = [];
	const trackId = sourceOpticsTrackId(target);
	const existingTrack = draft.sourceOpticsTracks.find((candidate) =>
		sourceOpticsTargetsEqual(candidate.target, target),
	);
	const track =
		existingTrack ??
		draft.sourceOpticsTracks[
			draft.sourceOpticsTracks.push({ id: trackId, target, keyframes: [] }) - 1
		];
	const existing = track.keyframes.find(
		(keyframe) => keyframe.time === snapped,
	);
	if (existing) {
		existing.value = value;
		return true;
	}
	track.keyframes.push(
		castDraft(defaultEasedKeyframe({ time: snapped, value })),
	);
	track.keyframes.sort(byTime);
	return true;
};

/** Upserts one numeric Source Optics keyframe through the MotionDocument bus. */
export function upsertSourceOpticsKeyframe(
	target: SourceOpticsParameterTarget,
	frame: number,
	value: number,
): MotionCommand {
	return {
		type: "motion/upsert-source-optics-keyframe",
		label: "Set source optics keyframe",
		coalesceKey: `motion-source-optics:${sourceOpticsTrackId(target)}:${coalesceFrame(frame)}`,
		run: (draft) => {
			upsertSourceOpticsKeyframeIntoDraft(draft, target, frame, value);
		},
	};
}

/** Removes one key and drops the side-car track when it becomes empty. */
export function removeSourceOpticsKeyframe(
	target: SourceOpticsParameterTarget,
	frame: number,
): MotionCommand {
	return {
		type: "motion/remove-source-optics-keyframe",
		label: "Delete source optics keyframe",
		coalesceKey: `motion-source-optics-remove:${sourceOpticsTrackId(target)}:${coalesceFrame(frame)}`,
		run: (draft) => {
			const tracks = draft.sourceOpticsTracks;
			if (!tracks) return;
			const trackIndex = tracks.findIndex((track) =>
				sourceOpticsTargetsEqual(track.target, target),
			);
			if (trackIndex < 0) return;
			const track = tracks[trackIndex];
			const snapped = snapMotionFrame(frame, draft.durationFrames);
			const keyIndex = track.keyframes.findIndex(
				(keyframe) => keyframe.time === snapped,
			);
			if (keyIndex < 0) return;
			track.keyframes.splice(keyIndex, 1);
			if (track.keyframes.length === 0) tracks.splice(trackIndex, 1);
		},
	};
}

/** Removes a complete Source Optics parameter track by stable target. */
export function removeSourceOpticsParameterTrack(
	target: SourceOpticsParameterTarget,
): MotionCommand {
	return {
		type: "motion/remove-source-optics-track",
		label: "Delete source optics animation",
		run: (draft) => {
			const tracks = draft.sourceOpticsTracks;
			if (!tracks) return;
			const trackIndex = tracks.findIndex((track) =>
				sourceOpticsTargetsEqual(track.target, target),
			);
			if (trackIndex >= 0) tracks.splice(trackIndex, 1);
		},
	};
}

/** Removes one Source Optics track by id for orphan-recovery surfaces. */
export function removeSourceOpticsTrack(trackId: string): MotionCommand {
	return {
		type: "motion/remove-source-optics-track-by-id",
		label: "Delete source optics animation",
		run: (draft) => {
			const tracks = draft.sourceOpticsTracks;
			if (!tracks) return;
			const trackIndex = tracks.findIndex((track) => track.id === trackId);
			if (trackIndex >= 0) tracks.splice(trackIndex, 1);
		},
	};
}

/** Returns the Source Optics track for one exact target. */
export function findSourceOpticsTrack(
	motion: MotionDocument,
	target: SourceOpticsParameterTarget,
): SourceOpticsParameterTrack | undefined {
	return motion.sourceOpticsTracks?.find((track) =>
		sourceOpticsTargetsEqual(track.target, target),
	);
}

const applySourceOpticsSegmentEasing = (
	track: Draft<SourceOpticsParameterTrack>,
	frame: number,
	easing: KeyframeUpsertEasing,
): void => {
	const index = track.keyframes.findIndex((item) => item.time === frame);
	if (index < 0) return;
	const leftDraft = track.keyframes[index];
	const rightDraft = track.keyframes[index + 1];
	const left = isDraft(leftDraft) ? current(leftDraft) : leftDraft;
	const right = rightDraft
		? isDraft(rightDraft)
			? current(rightDraft)
			: rightDraft
		: undefined;
	const eased =
		easing.kind === "preset"
			? withSegmentEasing(left, right, easing.preset)
			: withSegmentEasingCurve(left, right, easing.curve);
	track.keyframes[index] = castDraft(eased.left);
	if (rightDraft && eased.right) {
		track.keyframes[index + 1] = castDraft(eased.right);
	}
};

/** Retimes one Source Optics key without merging an occupied destination. */
export function setSourceOpticsKeyframeTime(
	trackId: string,
	fromFrame: number,
	toFrame: number,
	coalesceKey: string,
): MotionCommand {
	return {
		type: "motion/retime-source-optics-keyframe",
		label: "Move source optics keyframe",
		coalesceKey,
		run: (draft) => {
			const track = draft.sourceOpticsTracks?.find(
				(candidate) => candidate.id === trackId,
			);
			if (!track) return;
			const target = snapMotionFrame(toFrame, draft.durationFrames);
			if (target === fromFrame) return;
			const keyframe = track.keyframes.find((item) => item.time === fromFrame);
			if (!keyframe) return;
			if (
				track.keyframes.some(
					(item) => item !== keyframe && item.time === target,
				)
			) {
				return;
			}
			keyframe.time = target;
			track.keyframes.sort(byTime);
		},
	};
}

/** Rewrites the easing preset leaving one Source Optics numeric key. */
export function setSourceOpticsKeyframeEasing(
	trackId: string,
	frame: number,
	easing: EasingPreset,
): MotionCommand {
	return {
		type: "motion/set-source-optics-easing",
		label: "Set source optics easing",
		run: (draft) => {
			const track = draft.sourceOpticsTracks?.find(
				(candidate) => candidate.id === trackId,
			);
			if (!track) return;
			applySourceOpticsSegmentEasing(track, frame, {
				kind: "preset",
				preset: easing,
			});
		},
	};
}

/** Rewrites the custom easing curve leaving one Source Optics numeric key. */
export function setSourceOpticsKeyframeEasingCurve(
	trackId: string,
	frame: number,
	curve: EasingCurve,
): MotionCommand {
	return {
		type: "motion/set-source-optics-easing-curve",
		label: "Set source optics easing",
		coalesceKey: `motion-source-optics-easing:${trackId}:${frame}`,
		run: (draft) => {
			const track = draft.sourceOpticsTracks?.find(
				(candidate) => candidate.id === trackId,
			);
			if (!track) return;
			applySourceOpticsSegmentEasing(track, frame, { kind: "curve", curve });
		},
	};
}

/**
 * Authors a spatial motion-path stop by writing the `x` and `y` channels together
 * at one frame. This is the command form of dragging an object's trajectory point:
 * both position channels move in a single MotionDocument patch, so the gesture is
 * one undo entry that reverses both coordinates at once rather than leaving a
 * half-moved point if only one channel were keyed. Non-finite coordinates are
 * skipped per channel, so a partial write still records the valid axis.
 *
 * Default coalesce key folds repeated writes to the same node *at the same
 * requested frame* (one spatial drag with the playhead parked) into a single undo
 * entry, matching {@link upsertKeyframe}'s per-frame coalescing.
 */
export function upsertPositionKeyframe(
	nodeId: string,
	frame: number,
	position: { readonly x: number; readonly y: number },
): MotionCommand {
	return {
		type: "motion/upsert-position-keyframe",
		label: "Set position keyframe",
		coalesceKey: `motion-pos:${nodeId}:${coalesceFrame(frame)}`,
		run: (draft) => {
			upsertKeyframeIntoDraft(draft, nodeId, "x", frame, position.x);
			upsertKeyframeIntoDraft(draft, nodeId, "y", frame, position.y);
		},
	};
}

export type PositionPathSeed = {
	readonly frame: number;
	readonly position: Vec2;
	readonly inTangent?: Vec2;
	readonly outTangent?: Vec2;
	readonly spatialMode?: PositionPathSpatialMode;
	readonly roving?: boolean;
};

const positionPathKey = (seed: PositionPathSeed): PositionPathKey => ({
	frame: seed.frame,
	inTangent: seed.inTangent ?? { x: 0, y: 0 },
	outTangent: seed.outTangent ?? { x: 0, y: 0 },
	spatialMode: seed.spatialMode ?? "auto",
	...(seed.roving ? { roving: true } : {}),
});

/**
 * Promotes two or more sampled position stops into one editable spatial path.
 * X/Y remain the value truth; missing paired keys are authored in the same
 * MotionDocument command before the additive spatial metadata is installed.
 */
export function enablePositionPath(
	nodeId: string,
	seeds: readonly PositionPathSeed[],
): MotionCommand {
	return {
		type: "motion/enable-position-path",
		label: "Enable spatial motion path",
		run: (draft) => {
			const normalized = [...seeds]
				.filter(
					(seed) =>
						Number.isFinite(seed.frame) &&
						Number.isFinite(seed.position.x) &&
						Number.isFinite(seed.position.y) &&
						(!seed.inTangent ||
							(Number.isFinite(seed.inTangent.x) &&
								Number.isFinite(seed.inTangent.y))) &&
						(!seed.outTangent ||
							(Number.isFinite(seed.outTangent.x) &&
								Number.isFinite(seed.outTangent.y))),
				)
				.map((seed) => ({
					...seed,
					frame: snapMotionFrame(seed.frame, draft.durationFrames),
				}))
				.filter(
					(seed, index, items) =>
						items.findIndex((item) => item.frame === seed.frame) === index,
				)
				.sort((left, right) => left.frame - right.frame);
			if (normalized.length < 2) return;
			for (const seed of normalized) {
				upsertKeyframeIntoDraft(
					draft,
					nodeId,
					"x",
					seed.frame,
					seed.position.x,
				);
				upsertKeyframeIntoDraft(
					draft,
					nodeId,
					"y",
					seed.frame,
					seed.position.y,
				);
			}
			const xTrack = findTrackByTarget(draft, nodeId, "x");
			const yTrack = findTrackByTarget(draft, nodeId, "y");
			for (const seed of normalized) {
				const xKey = xTrack?.keyframes.find(
					(keyframe) => keyframe.time === seed.frame,
				);
				const yKey = yTrack?.keyframes.find(
					(keyframe) => keyframe.time === seed.frame,
				);
				if (!xKey || !yKey) continue;
				yKey.inInterpolationType = xKey.inInterpolationType;
				yKey.outInterpolationType = xKey.outInterpolationType;
				yKey.inTemporalEase = castDraft(
					xKey.inTemporalEase?.map((point) => ({ ...point })),
				);
				yKey.outTemporalEase = castDraft(
					xKey.outTemporalEase?.map((point) => ({ ...point })),
				);
			}
			draft.positionPaths ??= [];
			const paths = draft.positionPaths;
			const existing = paths.find((path) => path.nodeId === nodeId);
			const keys = normalized.map(positionPathKey);
			if (existing) {
				existing.keys = castDraft(keys);
				return;
			}
			paths.push(
				castDraft({
					id: createId("position-path"),
					nodeId,
					keys,
				}),
			);
		},
	};
}

/** Writes one spatial tangent without changing position values or temporal ease. */
export function setPositionPathTangent(
	nodeId: string,
	frame: number,
	direction: "in" | "out",
	tangent: Vec2,
	options: { readonly breakContinuity?: boolean } = {},
): MotionCommand {
	return {
		type: "motion/set-position-path-tangent",
		label: "Edit spatial tangent",
		coalesceKey: `motion-path-tangent:${nodeId}:${frame}:${direction}`,
		run: (draft) => {
			if (!Number.isFinite(tangent.x) || !Number.isFinite(tangent.y)) return;
			const path = draft.positionPaths?.find(
				(candidate) => candidate.nodeId === nodeId,
			);
			const key = path?.keys.find((candidate) => candidate.frame === frame);
			if (!key) return;
			key.spatialMode = options.breakContinuity ? "corner" : "continuous";
			if (direction === "in") {
				key.inTangent = castDraft(tangent);
				if (!options.breakContinuity) {
					key.outTangent = castDraft({ x: -tangent.x, y: -tangent.y });
				}
			} else {
				key.outTangent = castDraft(tangent);
				if (!options.breakContinuity) {
					key.inTangent = castDraft({ x: -tangent.x, y: -tangent.y });
				}
			}
		},
	};
}

/** Changes one stop's spatial continuity policy without touching temporal ease. */
export function setPositionPathSpatialMode(
	nodeId: string,
	frame: number,
	spatialMode: PositionPathSpatialMode,
): MotionCommand {
	return {
		type: "motion/set-position-path-mode",
		label: "Set spatial path mode",
		run: (draft) => {
			const key = draft.positionPaths
				?.find((path) => path.nodeId === nodeId)
				?.keys.find((candidate) => candidate.frame === frame);
			if (!key) return;
			key.spatialMode = spatialMode;
		},
	};
}

/** Applies a precise spatial-key metadata patch through one undoable command. */
export function updatePositionPathKey(
	nodeId: string,
	frame: number,
	patch: {
		readonly inTangent?: Vec2;
		readonly outTangent?: Vec2;
		readonly spatialMode?: PositionPathSpatialMode;
		readonly roving?: boolean;
	},
): MotionCommand {
	return {
		type: "motion/update-position-path-key",
		label: "Update spatial path key",
		coalesceKey: `motion-path-key:${nodeId}:${frame}`,
		run: (draft) => {
			const key = draft.positionPaths
				?.find((path) => path.nodeId === nodeId)
				?.keys.find((candidate) => candidate.frame === frame);
			if (!key) return;
			if (
				patch.inTangent &&
				Number.isFinite(patch.inTangent.x) &&
				Number.isFinite(patch.inTangent.y)
			) {
				key.inTangent = castDraft(patch.inTangent);
			}
			if (
				patch.outTangent &&
				Number.isFinite(patch.outTangent.x) &&
				Number.isFinite(patch.outTangent.y)
			) {
				key.outTangent = castDraft(patch.outTangent);
			}
			if (patch.spatialMode) key.spatialMode = patch.spatialMode;
			if (patch.roving !== undefined) key.roving = patch.roving || undefined;
		},
	};
}

/** Toggles whether one interior spatial key participates in roving distribution. */
export function setPositionPathRoving(
	nodeId: string,
	frame: number,
	roving: boolean,
): MotionCommand {
	return {
		type: "motion/set-position-path-roving",
		label: roving
			? "Enable roving position key"
			: "Disable roving position key",
		run: (draft) => {
			const path = draft.positionPaths?.find(
				(candidate) => candidate.nodeId === nodeId,
			);
			const index =
				path?.keys.findIndex((candidate) => candidate.frame === frame) ?? -1;
			if (!path || index <= 0 || index >= path.keys.length - 1) return;
			path.keys[index].roving = roving || undefined;
		},
	};
}

/**
 * Redistributes every contiguous run of roving interior keys by geometric chord
 * length between its surrounding fixed keys. Authored key times remain integral
 * frames and X/Y/spatial metadata move atomically; insufficient frame spans fail
 * closed instead of collapsing two keys onto one frame.
 */
export function distributeRovingPositionKeys(nodeId: string): MotionCommand {
	return {
		type: "motion/distribute-roving-position-keys",
		label: "Distribute roving position keys",
		run: (draft) => {
			const path = draft.positionPaths?.find(
				(candidate) => candidate.nodeId === nodeId,
			);
			const xTrack = findTrackByTarget(draft, nodeId, "x");
			const yTrack = findTrackByTarget(draft, nodeId, "y");
			if (!path || !xTrack || !yTrack || path.keys.length < 3) return;
			const sorted = [...path.keys].sort(
				(left, right) => left.frame - right.frame,
			);
			const valueAt = (frame: number): Vec2 | null => {
				const x = xTrack.keyframes.find(
					(keyframe) => keyframe.time === frame,
				)?.value;
				const y = yTrack.keyframes.find(
					(keyframe) => keyframe.time === frame,
				)?.value;
				return typeof x === "number" && typeof y === "number" ? { x, y } : null;
			};
			const retimes = new Map<number, number>();
			let index = 1;
			while (index < sorted.length - 1) {
				if (!sorted[index].roving) {
					index += 1;
					continue;
				}
				const startIndex = index - 1;
				let endIndex = index;
				while (endIndex < sorted.length - 1 && sorted[endIndex].roving) {
					endIndex += 1;
				}
				const startFrame = sorted[startIndex].frame;
				const endFrame = sorted[endIndex].frame;
				const intervalCount = endIndex - startIndex;
				if (endFrame - startFrame < intervalCount) return;
				const positions = sorted
					.slice(startIndex, endIndex + 1)
					.map((key) => valueAt(key.frame));
				if (positions.some((position) => position === null)) return;
				const distances = positions.slice(1).map((position, offset) => {
					const previous = positions[offset];
					if (!position || !previous) return 0;
					return Math.hypot(position.x - previous.x, position.y - previous.y);
				});
				const total = distances.reduce((sum, distance) => sum + distance, 0);
				let distance = 0;
				let previousFrame = startFrame;
				for (let offset = 1; offset < intervalCount; offset += 1) {
					distance += distances[offset - 1] ?? 0;
					const proportional =
						total > 0
							? startFrame + ((endFrame - startFrame) * distance) / total
							: startFrame + ((endFrame - startFrame) * offset) / intervalCount;
					const remaining = intervalCount - offset;
					const nextFrame = Math.min(
						endFrame - remaining,
						Math.max(previousFrame + 1, Math.round(proportional)),
					);
					retimes.set(sorted[startIndex + offset].frame, nextFrame);
					previousFrame = nextFrame;
				}
				index = endIndex + 1;
			}
			if (retimes.size === 0) return;
			for (const track of [xTrack, yTrack]) {
				for (const keyframe of track.keyframes) {
					const next = retimes.get(keyframe.time);
					if (next !== undefined) keyframe.time = next;
				}
				track.keyframes.sort(byTime);
			}
			for (const key of path.keys) {
				const next = retimes.get(key.frame);
				if (next !== undefined) key.frame = next;
			}
			path.keys.sort((left, right) => left.frame - right.frame);
		},
	};
}

/** Removes only spatial metadata; paired X/Y value keys continue to animate. */
export function removePositionPath(nodeId: string): MotionCommand {
	return {
		type: "motion/remove-position-path",
		label: "Remove spatial path",
		run: (draft) => {
			const index =
				draft.positionPaths?.findIndex((path) => path.nodeId === nodeId) ?? -1;
			if (index >= 0) draft.positionPaths?.splice(index, 1);
		},
	};
}

/** Repairs every valid path key to the track's largest vertex count. */
export function repairPathMorphTopology(trackId: string): MotionCommand {
	return {
		type: "motion/repair-path-morph-topology",
		label: "Repair morph topology",
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			if (track?.target.property !== "pathShape") return;
			const snapshot = current(track);
			const inspection = inspectMorphTopology(snapshot);
			if (inspection.issues.length > 0 || inspection.targetVertexCount < 2)
				return;
			for (const keyframe of track.keyframes) {
				if (!isValidPathShape(keyframe.value)) return;
				keyframe.value = castDraft(
					repairMorphShapeVertexCount(
						keyframe.value,
						inspection.targetVertexCount,
					),
				);
			}
		},
	};
}

/** Changes a closed path key's first-vertex seam without altering its pixels. */
export function setPathMorphFirstVertex(
	trackId: string,
	frame: number,
	firstVertexIndex: number,
): MotionCommand {
	return {
		type: "motion/set-path-morph-first-vertex",
		label: "Set morph first vertex",
		coalesceKey: `motion-morph-first:${trackId}:${frame}`,
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			const keyframe = track?.keyframes.find((key) => key.time === frame);
			if (track?.target.property !== "pathShape" || !keyframe) return;
			if (!isValidPathShape(keyframe.value)) return;
			const shape = rotateMorphFirstVertex(keyframe.value, firstVertexIndex);
			if (shape) keyframe.value = castDraft(shape);
		},
	};
}

/** Reverses one path key's winding while preserving its visible curve. */
export function reversePathMorphKeyWinding(
	trackId: string,
	frame: number,
): MotionCommand {
	return {
		type: "motion/reverse-path-morph-winding",
		label: "Reverse morph winding",
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			const keyframe = track?.keyframes.find((key) => key.time === frame);
			if (track?.target.property !== "pathShape" || !keyframe) return;
			if (!isValidPathShape(keyframe.value)) return;
			keyframe.value = castDraft(reverseMorphWinding(keyframe.value));
		},
	};
}

/**
 * Retimes one spatial stop and its paired X/Y values as one command. Spatial
 * metadata cannot drift from its value-key identity through this authoring path.
 */
export function retimePositionPathKeyframe(
	nodeId: string,
	fromFrame: number,
	toFrame: number,
): MotionCommand {
	return {
		type: "motion/retime-position-path-keyframe",
		label: "Retime spatial position key",
		coalesceKey: `motion-path-retime:${nodeId}:${fromFrame}`,
		run: (draft) => {
			const target = snapMotionFrame(toFrame, draft.durationFrames);
			const path = draft.positionPaths?.find(
				(candidate) => candidate.nodeId === nodeId,
			);
			const key = path?.keys.find((candidate) => candidate.frame === fromFrame);
			if (
				!path ||
				!key ||
				path.keys.some((candidate) => candidate.frame === target)
			) {
				return;
			}
			const tracks = [
				findTrackByTarget(draft, nodeId, "x"),
				findTrackByTarget(draft, nodeId, "y"),
			];
			if (
				tracks.some(
					(track) =>
						!track?.keyframes.some(
							(candidate) => candidate.time === fromFrame,
						) || track.keyframes.some((candidate) => candidate.time === target),
				)
			) {
				return;
			}
			for (const track of tracks) {
				const valueKey = track?.keyframes.find(
					(candidate) => candidate.time === fromFrame,
				);
				if (!track || !valueKey) continue;
				valueKey.time = target;
				track.keyframes.sort(byTime);
			}
			key.frame = target;
			path.keys.sort((left, right) => left.frame - right.frame);
		},
	};
}

/**
 * Extends the document timeline to at least `minDurationFrames`, never
 * shrinking it. `durationFrames` is the bound `snapMotionFrame` (and every
 * authoring path built on it, e.g. {@link upsertKeyframe}) clamps into, so a
 * capture flow whose content outgrows the current length — e.g. Perform-mode
 * motion capture (`docs/product-knowledge/ipad-perform-motion.md`) — must call
 * this BEFORE authoring keyframes past the old duration, or they silently clamp
 * onto its final frame instead of landing at their real one. A no-op when the
 * document is already at least `minDurationFrames` long, or the request is not
 * a finite, positive number.
 */
export function extendMotionDuration(minDurationFrames: number): MotionCommand {
	return {
		type: "motion/extend-duration",
		label: "Extend timeline",
		run: (draft) => {
			if (!Number.isFinite(minDurationFrames) || minDurationFrames <= 0) return;
			const next = Math.round(minDurationFrames);
			if (next <= draft.durationFrames) return;
			draft.durationFrames = next;
		},
	};
}

/**
 * Changes document timing without changing any stored frame coordinate. This
 * command is intentionally only one half of the live document-timing compound;
 * its caller must pair it with the target artboard command under a shared
 * `compoundId`. The agent compiler (`compileAgentDocumentCommandBatch`) already
 * proves the policy/fps/durationFrames shape and runs
 * {@link motionTimingRangeIssues} against a frozen pre-apply snapshot before
 * minting this command, so every condition below is expected to already hold
 * by the time `run` executes. A failure here — especially the range re-check
 * disagreeing with the compiler's snapshot check — means the draft diverged
 * from what was proven safe (a compiler/runtime divergence bug), not an
 * ordinary rejection, so it throws instead of silently no-opping: the shared
 * `applyDocumentTimingBatch` transaction wrapper catches this, aborts both the
 * scene and motion transactions, and reverts any already-committed compound
 * half, so a throw here can never leave scene/motion partially retimed.
 */
export function updateMotionDocumentTiming(
	input: MotionTimingUpdateInput,
): MotionCommand {
	return {
		type: "motion/update-timing",
		label: "Update document timing",
		run: (draft) => {
			if (
				input.temporalPolicy !== "preserve-frame-indices" ||
				input.outOfRangePolicy !== "reject" ||
				!Number.isInteger(input.fps) ||
				input.fps <= 0 ||
				!Number.isInteger(input.durationFrames) ||
				input.durationFrames <= 0
			) {
				throw new Error(
					`updateMotionDocumentTiming received a compound input the agent compiler should have already rejected (fps=${input.fps}, durationFrames=${input.durationFrames}, temporalPolicy=${input.temporalPolicy}, outOfRangePolicy=${input.outOfRangePolicy}); this is a compiler/runtime divergence bug.`,
				);
			}
			const rangeIssues = motionTimingRangeIssues(draft, input.durationFrames);
			if (rangeIssues.length > 0) {
				throw new Error(
					`updateMotionDocumentTiming's runtime range re-check found ${rangeIssues.length} out-of-range persisted address(es) (first: "${rangeIssues[0]?.path}") that the compiler's pre-apply snapshot check did not; this is a compiler/runtime divergence bug and must not silently no-op.`,
				);
			}
			draft.fps = input.fps;
			draft.durationFrames = input.durationFrames;
			if (draft.automation) {
				draft.automation.fps = input.fps;
				draft.automation.durationFrames = input.durationFrames;
			}
		},
	};
}

/** Timing to stamp on the segment leaving a keyframe at upsert time. */
export type KeyframeUpsertEasing =
	| { readonly kind: "preset"; readonly preset: EasingPreset }
	| { readonly kind: "curve"; readonly curve: EasingCurve };

/**
 * Snapshots a `KeyframeTrack` keyframe slot to a plain object regardless of
 * whether Immer sees it as a live draft. `track.keyframes[index]` is a real
 * draft for a pre-existing keyframe, but for one freshly `push`ed in the same
 * `run` (see {@link upsertKeyframeIntoDraft}) it is a plain object wearing a
 * `Draft<...>` type only via `castDraft` — Immer's `current()` throws on that
 * input, so it must be skipped rather than called.
 */
const snapshotKeyframe = (
	keyframe: Draft<AeKeyframe<AnimatableValue>>,
): AeKeyframe<AnimatableValue> =>
	isDraft(keyframe) ? current(keyframe) : keyframe;

/**
 * Rewrites the easing of the segment leaving the keyframe at `frame` on
 * `track`, exactly like {@link setKeyframeEasing}/{@link setKeyframeEasingCurve}
 * but operating on an already-open draft track (so {@link upsertKeyframeWithEasing}
 * can compose it with an upsert in one Immer `run` instead of two separate
 * commands / undo entries). No-ops if `frame` has no keyframe on the track.
 */
const applySegmentEasingToDraftTrack = (
	track: Draft<KeyframeTrack>,
	frame: number,
	easing: KeyframeUpsertEasing,
): void => {
	const index = track.keyframes.findIndex((item) => item.time === frame);
	if (index < 0) return;
	const nextDraft = track.keyframes[index + 1];
	const left = snapshotKeyframe(track.keyframes[index]);
	const right = nextDraft ? snapshotKeyframe(nextDraft) : undefined;
	const eased =
		easing.kind === "preset"
			? withSegmentEasing(left, right, easing.preset)
			: withSegmentEasingCurve(left, right, easing.curve);
	track.keyframes[index] = castDraft(eased.left);
	if (nextDraft && eased.right)
		track.keyframes[index + 1] = castDraft(eased.right);
};

const positionPathSiblingTrack = (
	draft: Draft<MotionDocument>,
	track: Draft<KeyframeTrack>,
	frame: number,
): Draft<KeyframeTrack> | undefined => {
	if (track.target.property !== "x" && track.target.property !== "y") return;
	const hasSpatialKey = draft.positionPaths
		?.find((path) => path.nodeId === track.target.nodeId)
		?.keys.some((key) => key.frame === frame);
	if (!hasSpatialKey) return;
	const sibling = findTrackByTarget(
		draft,
		track.target.nodeId,
		track.target.property === "x" ? "y" : "x",
	);
	return sibling?.keyframes.some((keyframe) => keyframe.time === frame)
		? sibling
		: undefined;
};

const applySpatiallySynchronizedEasing = (
	draft: Draft<MotionDocument>,
	track: Draft<KeyframeTrack>,
	frame: number,
	easing: KeyframeUpsertEasing,
): void => {
	applySegmentEasingToDraftTrack(track, frame, easing);
	const sibling = positionPathSiblingTrack(draft, track, frame);
	if (sibling) applySegmentEasingToDraftTrack(sibling, frame, easing);
};

const holdFrameForSegment = (
	leftFrame: number,
	rightFrame: number,
	hold: MotionTimingTemplateKeyframeHold,
): number | null => {
	const gapFrames = rightFrame - leftFrame;
	if (gapFrames < hold.minGapFrames) return null;
	const moveFrames = Math.max(1, Math.round(gapFrames * hold.progress));
	const holdFrame = Math.min(rightFrame - 1, leftFrame + moveFrames);
	return holdFrame > leftFrame && holdFrame < rightFrame ? holdFrame : null;
};

const applySegmentEasingWithHoldToDraftTrack = (
	draft: Draft<MotionDocument>,
	track: Draft<KeyframeTrack>,
	frame: number,
	easing: KeyframeUpsertEasing,
	hold: MotionTimingTemplateKeyframeHold | undefined,
): void => {
	if (hold) {
		const index = track.keyframes.findIndex((item) => item.time === frame);
		const rightDraft = index >= 0 ? track.keyframes[index + 1] : undefined;
		if (rightDraft) {
			const left = snapshotKeyframe(track.keyframes[index]);
			const right = snapshotKeyframe(rightDraft);
			const followingDraft = track.keyframes[index + 2];
			const alreadyHolding =
				hold.source === "right-key-value" &&
				followingDraft !== undefined &&
				deepEqual(right.value, snapshotKeyframe(followingDraft).value);
			const holdFrame = alreadyHolding
				? null
				: holdFrameForSegment(left.time, right.time, hold);
			if (holdFrame !== null) {
				upsertKeyframeIntoDraft(
					draft,
					track.target.nodeId,
					track.target.property,
					holdFrame,
					right.value,
				);
			}
		}
	}
	applySegmentEasingToDraftTrack(track, frame, easing);
};

/**
 * Upserts a keyframe and, when `easing` is supplied, stamps the segment
 * leaving it in the SAME undo entry — the agent-facing equivalent of calling
 * {@link upsertKeyframe} followed by {@link setKeyframeEasing}/
 * {@link setKeyframeEasingCurve}, without a second command/history entry. When
 * `easing` is omitted this behaves exactly like {@link upsertKeyframe} (new
 * keys keep the engine's default symmetric ease; an existing key's easing is
 * left untouched). `hold`, when supplied by a semantic timing template, duplicates
 * the right key's value into an intermediate proof key before stamping the
 * outgoing segment.
 */
export function upsertKeyframeWithEasing(
	nodeId: string,
	property: AnimatableProperty,
	frame: number,
	value: AnimatableValue,
	easing?: KeyframeUpsertEasing,
	hold?: MotionTimingTemplateKeyframeHold,
): MotionCommand {
	return {
		type: "motion/upsert-keyframe",
		label: "Set keyframe",
		coalesceKey: `motion-key:${nodeId}:${property}:${coalesceFrame(frame)}`,
		run: (draft) => {
			const wrote = upsertKeyframeIntoDraft(
				draft,
				nodeId,
				property,
				frame,
				value,
			);
			if (!wrote || !easing) return;
			const track = findTrackByTarget(draft, nodeId, property);
			if (!track) return;
			const snapped = snapMotionFrame(frame, draft.durationFrames);
			applySegmentEasingWithHoldToDraftTrack(
				draft,
				track,
				snapped,
				easing,
				hold,
			);
		},
	};
}

const appendTrack = (
	draft: Draft<MotionDocument>,
	nodeId: string,
	property: AnimatableProperty,
): Draft<KeyframeTrack> => {
	draft.tracks.push({
		id: createId(TRACK_ID_PREFIX),
		target: { nodeId, property },
		keyframes: [],
	});
	return draft.tracks[draft.tracks.length - 1];
};

/**
 * Retimes a keyframe by dragging it from one frame to another. Moves that would
 * collide with an existing key on the same track are dropped so a drag can never
 * silently merge two keys. The caller supplies a gesture-unique coalesce key so a
 * whole drag collapses into a single undo step.
 */
export function setKeyframeTime(
	trackId: string,
	fromFrame: number,
	toFrame: number,
	coalesceKey: string,
): MotionCommand {
	return {
		type: "motion/retime-keyframe",
		label: "Move keyframe",
		coalesceKey,
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			if (!track) return;
			const target = snapMotionFrame(toFrame, draft.durationFrames);
			if (target === fromFrame) return;
			const keyframe = track.keyframes.find((item) => item.time === fromFrame);
			if (!keyframe) return;
			if (track.target.property === "x" || track.target.property === "y") {
				const path = draft.positionPaths?.find(
					(candidate) => candidate.nodeId === track.target.nodeId,
				);
				const pathKey = path?.keys.find(
					(candidate) => candidate.frame === fromFrame,
				);
				if (path && pathKey) {
					const sibling = findTrackByTarget(
						draft,
						track.target.nodeId,
						track.target.property === "x" ? "y" : "x",
					);
					const siblingKey = sibling?.keyframes.find(
						(item) => item.time === fromFrame,
					);
					if (
						!sibling ||
						!siblingKey ||
						track.keyframes.some(
							(item) => item !== keyframe && item.time === target,
						) ||
						path.keys.some(
							(item) => item !== pathKey && item.frame === target,
						) ||
						sibling.keyframes.some(
							(item) => item !== siblingKey && item.time === target,
						)
					) {
						return;
					}
					keyframe.time = target;
					siblingKey.time = target;
					pathKey.frame = target;
					track.keyframes.sort(byTime);
					sibling.keyframes.sort(byTime);
					path.keys.sort((left, right) => left.frame - right.frame);
					return;
				}
			}
			const occupied = track.keyframes.some(
				(item) => item !== keyframe && item.time === target,
			);
			if (occupied) return;
			keyframe.time = target;
			track.keyframes.sort(byTime);
		},
	};
}

/**
 * Rewrites the easing of the segment that *leaves* the keyframe at `frame`. The
 * left key's out-handle and the next key's in-handle are both updated so the
 * glammer sampler renders the chosen CSS-style curve. On the final key (no
 * outgoing segment) only the out-handle is stamped.
 */
export function setKeyframeEasing(
	trackId: string,
	frame: number,
	easing: EasingPreset,
): MotionCommand {
	return {
		type: "motion/set-easing",
		label: "Set easing",
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			if (!track) return;
			applySpatiallySynchronizedEasing(draft, track, frame, {
				kind: "preset",
				preset: easing,
			});
		},
	};
}

/**
 * Rewrites the selected segment with a custom sampler-compatible cubic curve.
 * Repeated slider/handle updates for the same segment share a coalesce key so a
 * curve-drag stays one undo step unless another command lands between edits.
 */
export function setKeyframeEasingCurve(
	trackId: string,
	frame: number,
	curve: EasingCurve,
): MotionCommand {
	return {
		type: "motion/set-easing-curve",
		label: "Set easing curve",
		coalesceKey: `motion-easing:${trackId}:${frame}`,
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			if (!track) return;
			applySpatiallySynchronizedEasing(draft, track, frame, {
				kind: "curve",
				curve,
			});
		},
	};
}

/**
 * Inserts an interior numeric key while preserving the sampled temporal cubic on
 * both resulting segments. Direct spatial paths fail closed because their paired
 * X/Y key and spatial-key identity must be split by the path authoring owner.
 */
export function splitNumericKeyframeSegment(
	trackId: string,
	frame: number,
): MotionCommand {
	return {
		type: "motion/split-keyframe-segment",
		label: "Split keyframe segment",
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			if (!track) return;
			if (
				(track.target.property === "x" || track.target.property === "y") &&
				draft.positionPaths?.some((path) => path.nodeId === track.target.nodeId)
			) {
				return;
			}
			const snapped = snapMotionFrame(frame, draft.durationFrames);
			const index = track.keyframes.findIndex(
				(key, keyIndex) =>
					keyIndex < track.keyframes.length - 1 &&
					snapped > key.time &&
					snapped < track.keyframes[keyIndex + 1].time,
			);
			if (index < 0) return;
			const left = snapshotKeyframe(track.keyframes[index]);
			const right = snapshotKeyframe(track.keyframes[index + 1]);
			if (typeof left.value !== "number" || typeof right.value !== "number")
				return;
			const timeProgress = (snapped - left.time) / (right.time - left.time);
			if (left.outInterpolationType === 6614) {
				track.keyframes.splice(
					index + 1,
					0,
					castDraft({
						...defaultEasedKeyframe({ time: snapped, value: left.value }),
						outInterpolationType: 6614,
					}),
				);
				return;
			}
			const split = splitTemporalCurveAtTime(
				segmentEasingCurveOf(left, right),
				timeProgress,
			);
			if (!split) return;
			const value =
				left.value + (right.value - left.value) * split.valueProgress;
			track.keyframes.splice(
				index + 1,
				0,
				castDraft(defaultEasedKeyframe({ time: snapped, value })),
			);
			applySegmentEasingToDraftTrack(track, left.time, {
				kind: "curve",
				curve: split.left,
			});
			applySegmentEasingToDraftTrack(track, snapped, {
				kind: "curve",
				curve: split.right,
			});
		},
	};
}

/**
 * Rewrites a segment and, when the timing template asks for it, inserts an
 * intermediate hold key that duplicates the right key's value before stamping the
 * final curve. This keeps intent templates such as Snap hold as one undoable
 * command while preserving the normal keyframe validation path.
 */
export function setKeyframeEasingWithHold(
	trackId: string,
	frame: number,
	easing: KeyframeUpsertEasing,
	hold: MotionTimingTemplateKeyframeHold,
): MotionCommand {
	return {
		type: "motion/set-easing-hold",
		label: "Set easing",
		coalesceKey: `motion-easing:${trackId}:${frame}`,
		run: (draft) => {
			const track = findTrackById(draft, trackId);
			if (!track) return;
			applySegmentEasingWithHoldToDraftTrack(draft, track, frame, easing, hold);
		},
	};
}

/** Applies a timing-template easing and optional proof hold to Source Optics. */
export function setSourceOpticsKeyframeEasingWithHold(
	trackId: string,
	frame: number,
	easing: KeyframeUpsertEasing,
	hold: MotionTimingTemplateKeyframeHold,
): MotionCommand {
	return {
		type: "motion/set-source-optics-easing-hold",
		label: "Set source optics easing",
		coalesceKey: `motion-source-optics-easing:${trackId}:${frame}`,
		run: (draft) => {
			const track = draft.sourceOpticsTracks?.find(
				(candidate) => candidate.id === trackId,
			);
			if (!track) return;
			const index = track.keyframes.findIndex((item) => item.time === frame);
			const right = index >= 0 ? track.keyframes[index + 1] : undefined;
			if (right) {
				const holdFrame = holdFrameForSegment(frame, right.time, hold);
				if (holdFrame !== null) {
					upsertSourceOpticsKeyframeIntoDraft(
						draft,
						track.target,
						holdFrame,
						right.value,
					);
				}
			}
			applySourceOpticsSegmentEasing(track, frame, easing);
		},
	};
}

/** Removes a keyframe, dropping the whole track once its last key is gone. */
export function removeKeyframe(trackId: string, frame: number): MotionCommand {
	return {
		type: "motion/remove-keyframe",
		label: "Delete keyframe",
		run: (draft) => {
			const trackIndex = draft.tracks.findIndex((item) => item.id === trackId);
			if (trackIndex < 0) return;
			const track = draft.tracks[trackIndex];
			const keyframeIndex = track.keyframes.findIndex(
				(item) => item.time === frame,
			);
			if (keyframeIndex < 0) return;
			track.keyframes.splice(keyframeIndex, 1);
			if (track.target.property === "x" || track.target.property === "y") {
				const path = draft.positionPaths?.find(
					(candidate) => candidate.nodeId === track.target.nodeId,
				);
				const pathKeyIndex =
					path?.keys.findIndex((candidate) => candidate.frame === frame) ?? -1;
				if (path && pathKeyIndex >= 0) path.keys.splice(pathKeyIndex, 1);
				if (path && path.keys.length < 2) {
					const pathIndex = draft.positionPaths?.indexOf(path) ?? -1;
					if (pathIndex >= 0) draft.positionPaths?.splice(pathIndex, 1);
				}
			}
			if (track.keyframes.length === 0) draft.tracks.splice(trackIndex, 1);
		},
	};
}

/**
 * Removes an entire track by id and scrubs it from any clip membership. No-op
 * (no history entry) when the id is absent — mirrors {@link removeKeyframe}.
 * This is the prune primitive for a track stranded by a deleted scene node:
 * `removeKeyframe` only drops a track once its LAST key is gone, so it cannot
 * clear a multi-key orphan in one step.
 */
export function removeTrack(trackId: string): MotionCommand {
	return {
		type: "motion/remove-track",
		label: "Delete track",
		run: (draft) => {
			const trackIndex = draft.tracks.findIndex((item) => item.id === trackId);
			if (trackIndex < 0) return;
			const target = draft.tracks[trackIndex].target;
			draft.tracks.splice(trackIndex, 1);
			if (target.property === "x" || target.property === "y") {
				const pathIndex =
					draft.positionPaths?.findIndex(
						(path) => path.nodeId === target.nodeId,
					) ?? -1;
				if (pathIndex >= 0) draft.positionPaths?.splice(pathIndex, 1);
			}
			for (const clip of draft.clips) {
				const index = clip.trackIds.indexOf(trackId);
				if (index >= 0) clip.trackIds.splice(index, 1);
			}
		},
	};
}

/**
 * Serializable request for adding a clip to the MotionDocument side-car. `id` is
 * optional so UI callers can let the command mint ids, while tests and imported
 * timelines can supply stable ids.
 */
export type CreateAnimationClipInput = {
	readonly id?: string;
	readonly name: string;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly trackIds?: readonly string[];
	readonly provenance?: AnimationClipProvenance;
};

/**
 * Creates an authorable clip in the MotionDocument side-car. Track membership is
 * deduped against the current motion tracks, but empty clips remain valid so a
 * user can block timing before assigning channels.
 */
export function createAnimationClip(
	input: CreateAnimationClipInput,
): MotionCommand {
	return {
		type: "motion/create-clip",
		label: "Create animation clip",
		run: (draft) => {
			const id = input.id ?? createId(CLIP_ID_PREFIX);
			if (draft.clips.some((clip) => clip.id === id)) return;
			const range = normalizeAnimationClipRange(input, draft.durationFrames);
			const trackIds = sanitizeAnimationClipTrackIds(
				current(draft),
				input.trackIds ?? [],
				{ clipId: id, range },
			);
			draft.clips.push({
				id,
				name: sanitizeAnimationClipName(input.name),
				startFrame: range.startFrame,
				durationFrames: range.durationFrames,
				trackIds: [...trackIds],
				...(input.provenance
					? {
							provenance: castDraft(
								cloneAnimationClipProvenance(input.provenance),
							),
						}
					: {}),
			});
		},
	};
}

/**
 * Applies one semantic segment-timing template to every authored segment inside
 * a clip as a single Motion command. Role identity, spatial tangents, and clip
 * range stay unchanged. Most templates only rewrite departure/arrival timing;
 * templates with explicit hold metadata may add an intermediate proof key that
 * duplicates the segment destination value.
 */
export function applyAnimationClipTimingTemplate(
	clipId: string,
	templateId: string,
): MotionCommand {
	return {
		type: "motion/apply-clip-timing-template",
		label: "Apply phrase timing",
		run: (draft) => {
			const clip = findClipById(draft, clipId);
			const compiled = compileMotionTimingTemplateForKeyframe(templateId);
			if (!clip || compiled.status !== "ready") return;
			const hold = motionTimingTemplateKeyframeHoldOf(templateId);
			const start = clip.startFrame;
			const end = clip.startFrame + clip.durationFrames;
			for (const trackId of clip.trackIds) {
				const track = findTrackById(draft, trackId);
				if (!track) continue;
				const segmentFrames = track.keyframes.flatMap(
					(keyframe, index, keys) => {
						const next = keys[index + 1];
						return next &&
							keyframe.time >= start &&
							keyframe.time < end &&
							next.time >= start &&
							next.time < end
							? [keyframe.time]
							: [];
					},
				);
				for (const frame of segmentFrames) {
					applySegmentEasingWithHoldToDraftTrack(
						draft,
						track,
						frame,
						compiled.easing,
						hold,
					);
				}
			}
		},
	};
}

/**
 * Renames a clip while preventing empty labels from reaching the timeline. The
 * coalesce key lets inline rename edits collapse into one undo entry.
 */
export function renameAnimationClip(
	clipId: string,
	name: string,
): MotionCommand {
	return {
		type: "motion/rename-clip",
		label: "Rename animation clip",
		coalesceKey: `motion-clip-name:${clipId}`,
		run: (draft) => {
			const clip = findClipById(draft, clipId);
			if (!clip) return;
			const nextName = sanitizeAnimationClipName(name);
			if (clip.name === nextName) return;
			clip.name = nextName;
		},
	};
}

/**
 * Trims a clip to a normalized document-local frame range. Start and duration are
 * stored as whole frames so a later timeline bridge can drag edges without
 * introducing sub-frame clip boundaries.
 */
export function trimAnimationClip(
	clipId: string,
	range: AnimationClipRange,
): MotionCommand {
	return {
		type: "motion/trim-clip",
		label: "Trim animation clip",
		coalesceKey: `motion-clip-range:${clipId}`,
		run: (draft) => {
			const clip = findClipById(draft, clipId);
			if (!clip) return;
			const nextRange = normalizeAnimationClipRange(
				range,
				draft.durationFrames,
			);
			if (
				clip.startFrame === nextRange.startFrame &&
				clip.durationFrames === nextRange.durationFrames
			) {
				const trackIds = sanitizeAnimationClipTrackIds(
					current(draft),
					clip.trackIds,
					{ clipId, range: nextRange },
				);
				if (sameTrackIds(clip.trackIds, trackIds)) return;
				clip.trackIds = [...trackIds];
				return;
			}
			const trackIds = sanitizeAnimationClipTrackIds(
				current(draft),
				clip.trackIds,
				{ clipId, range: nextRange },
			);
			clip.startFrame = nextRange.startFrame;
			clip.durationFrames = nextRange.durationFrames;
			clip.trackIds = [...trackIds];
		},
	};
}

/**
 * Replaces clip track membership with the valid, non-overlapping ids from the
 * request. Missing ids, duplicates, and tracks already assigned to another clip
 * whose normalized range overlaps this clip are filtered in input order.
 */
export function assignAnimationClipTracks(
	clipId: string,
	trackIds: readonly string[],
): MotionCommand {
	return {
		type: "motion/assign-clip-tracks",
		label: "Assign animation clip tracks",
		coalesceKey: `motion-clip-tracks:${clipId}`,
		run: (draft) => {
			const clip = findClipById(draft, clipId);
			if (!clip) return;
			const nextTrackIds = sanitizeAnimationClipTrackIds(
				current(draft),
				trackIds,
				{ clipId, range: clip },
			);
			if (sameTrackIds(clip.trackIds, nextTrackIds)) return;
			clip.trackIds = [...nextTrackIds];
		},
	};
}

const ensureAutomationRecipe = (
	draft: Draft<MotionDocument>,
): NonNullable<Draft<MotionDocument>["automation"]> => {
	if (!draft.automation) {
		draft.automation = {
			enabled: true,
			fps: draft.fps,
			durationFrames: draft.durationFrames,
			tracks: [],
		};
	}
	return draft.automation;
};

/** Enables or disables the durable automation side-car without altering tracks. */
export function setAutomationEnabled(enabled: boolean): MotionCommand {
	return {
		type: "motion/set-automation-enabled",
		label: enabled ? "Enable automation" : "Disable automation",
		coalesceKey: "motion-automation-enabled",
		run: (draft) => {
			if (!draft.automation && !enabled) return;
			const automation = ensureAutomationRecipe(draft);
			if (automation.enabled === enabled) return;
			automation.enabled = enabled;
		},
	};
}

/** Adds one normalized automation track at the end of the authored stack. */
export function createAutomationTrack(track: AutomationTrack): MotionCommand {
	return {
		type: "motion/create-automation-track",
		label: "Create automation track",
		run: (draft) => {
			const normalized = normalizeAutomationTrack(track);
			if (normalized.keyframes.length === 0) return;
			ensureAutomationRecipe(draft).tracks.push(castDraft(normalized));
		},
	};
}

/** Replaces one automation track while preserving its stack position. */
export function updateAutomationTrack(
	trackIndex: number,
	track: AutomationTrack,
): MotionCommand {
	return {
		type: "motion/update-automation-track",
		label: "Update automation track",
		coalesceKey: `motion-automation-track:${trackIndex}`,
		run: (draft) => {
			if (!draft.automation) return;
			const index = Math.round(trackIndex);
			if (index < 0 || index >= draft.automation.tracks.length) return;
			const existing = draft.automation.tracks[index];
			if (!existing) return;
			const normalized = normalizeAutomationTrack(track);
			if (normalized.keyframes.length === 0) return;
			if (deepEqual(current(existing), normalized)) return;
			draft.automation.tracks[index] = castDraft(normalized);
		},
	};
}

/** Removes one automation track by its current authored stack index. */
export function removeAutomationTrack(trackIndex: number): MotionCommand {
	return {
		type: "motion/remove-automation-track",
		label: "Remove automation track",
		run: (draft) => {
			if (!draft.automation) return;
			const index = Math.round(trackIndex);
			if (index < 0 || index >= draft.automation.tracks.length) return;
			draft.automation.tracks.splice(index, 1);
		},
	};
}

/** Reorders one automation track within the durable track stack. */
export function reorderAutomationTrack(
	trackIndex: number,
	toIndex: number,
): MotionCommand {
	return {
		type: "motion/reorder-automation-track",
		label: "Move automation track",
		coalesceKey: `motion-automation-order:${trackIndex}`,
		run: (draft) => {
			if (!draft.automation) return;
			const from = Math.round(trackIndex);
			const last = draft.automation.tracks.length - 1;
			if (from < 0 || from > last) return;
			const to = Number.isFinite(toIndex)
				? Math.min(last, Math.max(0, Math.round(toIndex)))
				: from;
			if (to === from) return;
			const [track] = draft.automation.tracks.splice(from, 1);
			if (!track) return;
			draft.automation.tracks.splice(to, 0, track);
		},
	};
}

/** Removes the complete automation recipe and every authored automation track. */
export function removeAutomationRecipe(): MotionCommand {
	return {
		type: "motion/remove-automation",
		label: "Remove automation",
		run: (draft) => {
			if (!draft.automation) return;
			delete draft.automation;
		},
	};
}

/**
 * Retargets authored motion references from one scene node to another. This is
 * the motion-side half of object replacement: role replacement may swap the
 * scene object behind a motion-grammar slot, and all ordinary tracks plus
 * matching grammar clip provenance must follow the replacement node id.
 */
export function retargetMotionNodeReferences({
	fromNodeId,
	toNodeId,
	bindingId,
	coalesceKey,
}: {
	readonly fromNodeId: string;
	readonly toNodeId: string;
	readonly bindingId?: string;
	readonly coalesceKey?: string;
}): MotionCommand {
	return {
		type: "motion/retarget-node-references",
		label: "Replace motion object",
		...(coalesceKey ? { coalesceKey } : {}),
		run: (draft) => {
			if (
				fromNodeId.length === 0 ||
				toNodeId.length === 0 ||
				fromNodeId === toNodeId
			) {
				return;
			}
			const sourceTracks = draft.tracks.filter(
				(track) => track.target.nodeId === fromNodeId,
			);
			if (
				sourceTracks.some((sourceTrack) =>
					draft.tracks.some(
						(candidate) =>
							candidate.target.nodeId === toNodeId &&
							candidate.target.property === sourceTrack.target.property,
					),
				) ||
				((draft.positionPaths ?? []).some(
					(path) => path.nodeId === fromNodeId,
				) &&
					(draft.positionPaths ?? []).some((path) => path.nodeId === toNodeId))
			) {
				return;
			}
			for (const track of draft.tracks) {
				if (track.target.nodeId === fromNodeId) {
					track.target = { ...track.target, nodeId: toNodeId };
				}
			}
			for (const path of draft.positionPaths ?? []) {
				if (path.nodeId === fromNodeId) path.nodeId = toNodeId;
			}
			for (const clip of draft.clips) {
				if (!clip.provenance) continue;
				if (bindingId && clip.provenance.bindingId !== bindingId) continue;
				const currentProvenance = current(clip.provenance);
				const nextProvenance = retargetAnimationClipProvenance(
					currentProvenance,
					fromNodeId,
					toNodeId,
				);
				if (nextProvenance !== currentProvenance) {
					clip.provenance = castDraft(nextProvenance);
				}
			}
		},
	};
}

/**
 * Deep-clones one keyframe so a copied instance track shares no mutable structure
 * with its master source track. Scalar values are immutable; `pathShape`/`meshPaint`
 * values clone through {@link cloneKeyframeValue}, and the AE temporal-ease arrays
 * are copied point-by-point. `offsetFrames` phase-shifts the keyframe in time (a
 * per-instance timing offset baked into the copy), defaulting to no shift.
 */
const cloneKeyframeForCopy = (
	property: AnimatableProperty,
	keyframe: AeKeyframe<AnimatableValue>,
	offsetFrames = 0,
): AeKeyframe<AnimatableValue> => ({
	...keyframe,
	time: keyframe.time + offsetFrames,
	value: cloneKeyframeValue(property, keyframe.value),
	...(keyframe.inTemporalEase
		? { inTemporalEase: keyframe.inTemporalEase.map((point) => ({ ...point })) }
		: {}),
	...(keyframe.outTemporalEase
		? {
				outTemporalEase: keyframe.outTemporalEase.map((point) => ({
					...point,
				})),
			}
		: {}),
});

/**
 * Copies every authored keyframe track whose target node is a key in
 * `sourceToInstanceNodeIds` onto the mapped instance node, minting fresh track ids
 * so the master (source) tracks keep animating. This is the motion half of
 * creating a component instance: {@link retargetMotionNodeReferences} MOVES a
 * track onto a replacement node (object replacement), whereas instancing must
 * COPY — the master and the instance must both animate.
 *
 * No coordinate rebase is applied. Node coordinates (including the animated `x`/`y`
 * channels) are artboard-LOCAL: the renderer paints each node inside its artboard's
 * `<g transform="translate(artboard.position)">` group. A verbatim clone therefore
 * replays the master's local choreography offset into the instance's own artboard,
 * which is exactly the intended cross-artboard reuse.
 *
 * `maskedTargets` skips any `${instanceNodeId}:${property}` pair the instance has
 * detached or overridden, so a later propagation rebuild cannot clobber
 * instance-local motion. Idempotent: tracks upsert by (instanceNodeId, property),
 * so re-running rebuilds the same instance tracks in place instead of duplicating.
 */
export function copyMotionTracksForInstance(input: {
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
	readonly maskedTargets?: ReadonlySet<string>;
	readonly timingOffsetFrames?: number;
	readonly coalesceKey?: string;
	readonly label?: string;
}): MotionCommand {
	const {
		sourceToInstanceNodeIds,
		maskedTargets,
		timingOffsetFrames = 0,
		coalesceKey,
		label,
	} = input;
	return {
		type: "motion/copy-tracks-for-instance",
		label: label ?? "Carry component motion",
		...(coalesceKey ? { coalesceKey } : {}),
		run: (draft) => {
			if (Object.keys(sourceToInstanceNodeIds).length === 0) return;
			const sourceSnapshot = current(draft);
			// Snapshot the source tracks before mutating: the loop reads master
			// tracks and pushes instance tracks into the same `draft.tracks` array.
			const sourceTracks = sourceSnapshot.tracks.filter((track) =>
				Object.hasOwn(sourceToInstanceNodeIds, track.target.nodeId),
			);
			for (const sourceTrack of sourceTracks) {
				const instanceNodeId =
					sourceToInstanceNodeIds[sourceTrack.target.nodeId];
				if (!instanceNodeId) continue;
				const { property } = sourceTrack.target;
				if (maskedTargets?.has(`${instanceNodeId}:${property}`)) continue;
				const keyframes = sourceTrack.keyframes.map((keyframe) =>
					cloneKeyframeForCopy(property, keyframe, timingOffsetFrames),
				);
				const existing = findTrackByTarget(draft, instanceNodeId, property);
				// Already in sync: skip the write so re-running this command (every
				// propagation pass) is a TRUE no-op. Reassigning an identical-but-fresh
				// array would otherwise register as an immer change and pollute history.
				// Compare the SHIFTED keyframes so a timing offset still converges.
				if (existing && deepEqual(keyframes, current(existing).keyframes)) {
					continue;
				}
				if (existing) {
					existing.keyframes = castDraft(keyframes);
					continue;
				}
				draft.tracks.push(
					castDraft({
						id: createId(TRACK_ID_PREFIX),
						target: { nodeId: instanceNodeId, property },
						keyframes,
					}),
				);
			}
			for (const sourcePath of sourceSnapshot.positionPaths ?? []) {
				const instanceNodeId = sourceToInstanceNodeIds[sourcePath.nodeId];
				if (
					!instanceNodeId ||
					maskedTargets?.has(`${instanceNodeId}:x`) ||
					maskedTargets?.has(`${instanceNodeId}:y`)
				) {
					continue;
				}
				const keys = sourcePath.keys.map((key) => ({
					...key,
					frame: key.frame + timingOffsetFrames,
				}));
				draft.positionPaths ??= [];
				const paths = draft.positionPaths;
				const existing = paths.find((path) => path.nodeId === instanceNodeId);
				if (existing && deepEqual(keys, current(existing).keys)) continue;
				if (existing) {
					existing.keys = castDraft(keys);
					continue;
				}
				paths.push(
					castDraft({
						id: createId("position-path"),
						nodeId: instanceNodeId,
						keys,
					}),
				);
			}
		},
	};
}

/**
 * Reorders a clip within the MotionDocument clip lane. The target index is
 * clamped to the current clip list so keyboard and drag operations can share the
 * same command without pre-validating edge moves.
 */
export function reorderAnimationClip(
	clipId: string,
	toIndex: number,
): MotionCommand {
	return {
		type: "motion/reorder-clip",
		label: "Move animation clip",
		coalesceKey: `motion-clip-order:${clipId}`,
		run: (draft) => {
			const fromIndex = draft.clips.findIndex((clip) => clip.id === clipId);
			if (fromIndex < 0) return;
			const lastIndex = draft.clips.length - 1;
			const targetIndex = Number.isFinite(toIndex)
				? Math.min(lastIndex, Math.max(0, Math.round(toIndex)))
				: fromIndex;
			if (targetIndex === fromIndex) return;
			const [clip] = draft.clips.splice(fromIndex, 1);
			draft.clips.splice(targetIndex, 0, clip);
		},
	};
}

/** Deletes a clip from MotionDocument without touching tracks or SceneDocument. */
export function deleteAnimationClip(clipId: string): MotionCommand {
	return {
		type: "motion/delete-clip",
		label: "Delete animation clip",
		run: (draft) => {
			const index = draft.clips.findIndex((clip) => clip.id === clipId);
			if (index < 0) return;
			draft.clips.splice(index, 1);
		},
	};
}

const textAnimatorSelectorInDraft = (
	draft: Draft<MotionDocument>,
	bindingId: string,
	selectorIndex: number,
): Draft<RangeTextSelector> | undefined => {
	if (!Number.isInteger(selectorIndex) || selectorIndex < 0) return;
	const binding = draft.textAnimators?.find(
		(candidate) => candidate.id === bindingId,
	);
	return binding?.selectors[selectorIndex];
};

const snapshotTextAnimatorOffsetKey = (
	keyframe: Draft<AeKeyframe<number>>,
): AeKeyframe<number> => (isDraft(keyframe) ? current(keyframe) : keyframe);

const upsertTextAnimatorOffsetKeyframeIntoDraft = (
	draft: Draft<MotionDocument>,
	bindingId: string,
	selectorIndex: number,
	frame: number,
	value: number,
): boolean => {
	if (!Number.isFinite(value)) return false;
	const selector = textAnimatorSelectorInDraft(draft, bindingId, selectorIndex);
	if (!selector) return false;
	const snapped = snapMotionFrame(frame, draft.durationFrames);
	selector.offsetKeyframes ??= [];
	const existing = selector.offsetKeyframes.find(
		(keyframe) => keyframe.time === snapped,
	);
	if (existing) {
		existing.value = value;
		return true;
	}
	selector.offsetKeyframes.push(
		castDraft(defaultEasedKeyframe({ time: snapped, value })),
	);
	selector.offsetKeyframes.sort((left, right) => left.time - right.time);
	return true;
};

const applyTextAnimatorOffsetSegmentEasing = (
	selector: Draft<RangeTextSelector>,
	frame: number,
	easing: KeyframeUpsertEasing,
): void => {
	const keys = selector.offsetKeyframes;
	if (!keys) return;
	const index = keys.findIndex((keyframe) => keyframe.time === frame);
	if (index < 0) return;
	const left = snapshotTextAnimatorOffsetKey(keys[index]);
	const rightDraft = keys[index + 1];
	const right = rightDraft
		? snapshotTextAnimatorOffsetKey(rightDraft)
		: undefined;
	const eased =
		easing.kind === "preset"
			? withSegmentEasing(left, right, easing.preset)
			: withSegmentEasingCurve(left, right, easing.curve);
	keys[index] = castDraft(eased.left);
	if (rightDraft && eased.right) keys[index + 1] = castDraft(eased.right);
};

/** Adds or replaces one selector Offset key without materializing a Motion track. */
export function upsertTextAnimatorOffsetKeyframe(
	bindingId: string,
	selectorIndex: number,
	frame: number,
	value: number,
): MotionCommand {
	return {
		type: "motion/upsert-text-animator-offset-keyframe",
		label: "Set text animator offset keyframe",
		coalesceKey: `motion-text-animator-offset:${bindingId}:${selectorIndex}:${coalesceFrame(frame)}`,
		run: (draft) => {
			upsertTextAnimatorOffsetKeyframeIntoDraft(
				draft,
				bindingId,
				selectorIndex,
				frame,
				value,
			);
		},
	};
}

/** Revalues an existing selector key; a stale address is an intentional no-op. */
export function setTextAnimatorOffsetKeyframeValue(
	address: TextAnimatorOffsetKeyAddress,
	value: number,
): MotionCommand {
	return {
		type: "motion/set-text-animator-offset-keyframe-value",
		label: "Set text animator offset value",
		coalesceKey: `motion-text-animator-offset-value:${address.bindingId}:${address.selectorIndex}:${coalesceFrame(address.frame)}`,
		run: (draft) => {
			if (!Number.isFinite(value)) return;
			const keyframe = textAnimatorSelectorInDraft(
				draft,
				address.bindingId,
				address.selectorIndex,
			)?.offsetKeyframes?.find((key) => key.time === address.frame);
			if (!keyframe) return;
			keyframe.value = value;
		},
	};
}

/** Retimes one existing selector key without merging an occupied destination. */
export function setTextAnimatorOffsetKeyframeTime(
	address: TextAnimatorOffsetKeyAddress,
	toFrame: number,
	coalesceKey: string,
): MotionCommand {
	return {
		type: "motion/retime-text-animator-offset-keyframe",
		label: "Move text animator offset keyframe",
		coalesceKey,
		run: (draft) => {
			const keys = textAnimatorSelectorInDraft(
				draft,
				address.bindingId,
				address.selectorIndex,
			)?.offsetKeyframes;
			if (!keys) return;
			const keyframe = keys.find((key) => key.time === address.frame);
			if (!keyframe) return;
			const target = snapMotionFrame(toFrame, draft.durationFrames);
			if (
				target === address.frame ||
				keys.some((key) => key !== keyframe && key.time === target)
			) {
				return;
			}
			keyframe.time = target;
			keys.sort((left, right) => left.time - right.time);
		},
	};
}

/** Deletes one exact selector Offset key and removes the empty optional array. */
export function removeTextAnimatorOffsetKeyframe(
	address: TextAnimatorOffsetKeyAddress,
): MotionCommand {
	return {
		type: "motion/remove-text-animator-offset-keyframe",
		label: "Delete text animator offset keyframe",
		run: (draft) => {
			const selector = textAnimatorSelectorInDraft(
				draft,
				address.bindingId,
				address.selectorIndex,
			);
			const keys = selector?.offsetKeyframes;
			if (!selector || !keys) return;
			const index = keys.findIndex((key) => key.time === address.frame);
			if (index < 0) return;
			keys.splice(index, 1);
			if (keys.length === 0) selector.offsetKeyframes = undefined;
		},
	};
}

/** Rewrites the temporal preset leaving one exact selector Offset key. */
export function setTextAnimatorOffsetKeyframeEasing(
	address: TextAnimatorOffsetKeyAddress,
	easing: EasingPreset,
): MotionCommand {
	return {
		type: "motion/set-text-animator-offset-easing",
		label: "Set text animator offset easing",
		run: (draft) => {
			const selector = textAnimatorSelectorInDraft(
				draft,
				address.bindingId,
				address.selectorIndex,
			);
			if (selector) {
				applyTextAnimatorOffsetSegmentEasing(selector, address.frame, {
					kind: "preset",
					preset: easing,
				});
			}
		},
	};
}

/** Rewrites the sampler-compatible cubic leaving one exact selector Offset key. */
export function setTextAnimatorOffsetKeyframeEasingCurve(
	address: TextAnimatorOffsetKeyAddress,
	curve: EasingCurve,
): MotionCommand {
	return {
		type: "motion/set-text-animator-offset-easing-curve",
		label: "Set text animator offset easing",
		coalesceKey: `motion-text-animator-offset-easing:${address.bindingId}:${address.selectorIndex}:${address.frame}`,
		run: (draft) => {
			const selector = textAnimatorSelectorInDraft(
				draft,
				address.bindingId,
				address.selectorIndex,
			);
			if (selector) {
				applyTextAnimatorOffsetSegmentEasing(selector, address.frame, {
					kind: "curve",
					curve,
				});
			}
		},
	};
}

/** Applies a timing-template curve and optional proof hold to one selector. */
export function setTextAnimatorOffsetKeyframeEasingWithHold(
	address: TextAnimatorOffsetKeyAddress,
	easing: KeyframeUpsertEasing,
	hold: MotionTimingTemplateKeyframeHold,
): MotionCommand {
	return {
		type: "motion/set-text-animator-offset-easing-hold",
		label: "Set text animator offset easing",
		coalesceKey: `motion-text-animator-offset-easing:${address.bindingId}:${address.selectorIndex}:${address.frame}`,
		run: (draft) => {
			const selector = textAnimatorSelectorInDraft(
				draft,
				address.bindingId,
				address.selectorIndex,
			);
			const keys = selector?.offsetKeyframes;
			if (!selector || !keys) return;
			const index = keys.findIndex((key) => key.time === address.frame);
			const right = index >= 0 ? keys[index + 1] : undefined;
			if (right) {
				const following = keys[index + 2];
				const alreadyHolding =
					hold.source === "right-key-value" &&
					following !== undefined &&
					deepEqual(right.value, following.value);
				const holdFrame = alreadyHolding
					? null
					: holdFrameForSegment(address.frame, right.time, hold);
				if (holdFrame !== null) {
					upsertTextAnimatorOffsetKeyframeIntoDraft(
						draft,
						address.bindingId,
						address.selectorIndex,
						holdFrame,
						right.value,
					);
				}
			}
			applyTextAnimatorOffsetSegmentEasing(selector, address.frame, easing);
		},
	};
}

/**
 * Parses authoring text for a selector Offset. `control()` is admitted because
 * every surface that evaluates a text animator receives the published-control
 * resolver; this is the ONE place that decision is made for this seam.
 *
 * It lives with the commands rather than next to the evaluator on purpose: the
 * evaluator is bundled into the exported standalone runtime, and the runtime
 * never parses — it reads a stored AST. Keeping `parseExpression` out of that
 * module keeps the parser out of every export profile.
 */
export function parseTextAnimatorOffsetExpression(source: string): ParseResult {
	return parseExpression(source, TEXT_SELECTOR_OFFSET_EXPR_VARS, {
		allowControlReferences: true,
	});
}

/**
 * Binds one Range Selector's Offset to an expression. Addressed by
 * `(bindingId, selectorIndex)` — the same identity a selector Offset key uses,
 * because a selector has no durable id of its own.
 *
 * `setTextAnimator` can also carry an `offsetExpression` (it replaces the whole
 * binding), but that is the apply-a-preset primitive: rebinding through it would
 * discard every keyframe the author has since edited. This command touches the
 * one field, so the base curve survives and one undo clears exactly the binding.
 */
export function setTextAnimatorOffsetExpression(
	bindingId: string,
	selectorIndex: number,
	expr: ExpressionSource,
): MotionCommand {
	return {
		type: "motion/set-text-animator-offset-expression",
		label: "Bind text offset to code",
		coalesceKey: `motion-text-offset-expression:${bindingId}:${selectorIndex}`,
		run: (draft) => {
			const selector = textAnimatorSelectorInDraft(
				draft,
				bindingId,
				selectorIndex,
			);
			if (!selector) return;
			selector.offsetExpression = castDraft(expr);
		},
	};
}

/** Clears one Range Selector's Offset expression. Missing selectors are no-ops. */
export function removeTextAnimatorOffsetExpression(
	bindingId: string,
	selectorIndex: number,
): MotionCommand {
	return {
		type: "motion/remove-text-animator-offset-expression",
		label: "Clear text offset code",
		coalesceKey: `motion-text-offset-expression-remove:${bindingId}:${selectorIndex}`,
		run: (draft) => {
			const selector = textAnimatorSelectorInDraft(
				draft,
				bindingId,
				selectorIndex,
			);
			if (!selector?.offsetExpression) return;
			selector.offsetExpression = undefined;
		},
	};
}

/**
 * Upserts a text-animator binding into the `textAnimators` side-car (by `id`). This
 * is the durable authoring primitive a preset button / MCP write / future UI calls
 * to apply or replace a Range Selector on a node — the binding itself is built by a
 * preset factory (e.g. `createWordRiseBinding`). One undo entry per apply.
 */
export function setTextAnimator(binding: TextAnimatorBinding): MotionCommand {
	return {
		type: "motion/set-text-animator",
		label: "Apply text motion",
		run: (draft) => {
			if (!draft.textAnimators) draft.textAnimators = [];
			const index = draft.textAnimators.findIndex(
				(candidate) => candidate.id === binding.id,
			);
			if (index < 0) {
				draft.textAnimators.push(castDraft(binding));
				return;
			}
			draft.textAnimators[index] = castDraft(binding);
		},
	};
}

/**
 * Removes a text-animator binding by id, dropping the whole `textAnimators` side-car
 * once empty so a document with no text motion serializes without the field.
 */
export function removeTextAnimator(bindingId: string): MotionCommand {
	return {
		type: "motion/remove-text-animator",
		label: "Remove text motion",
		run: (draft) => {
			const animators = draft.textAnimators;
			if (!animators) return;
			const index = animators.findIndex(
				(candidate) => candidate.id === bindingId,
			);
			if (index < 0) return;
			animators.splice(index, 1);
			if (animators.length === 0) draft.textAnimators = undefined;
		},
	};
}

/** Toggles a text-animator binding's `enabled` flag without touching its selectors. */
export function setTextAnimatorEnabled(
	bindingId: string,
	enabled: boolean,
): MotionCommand {
	return {
		type: "motion/set-text-animator-enabled",
		label: enabled ? "Enable text motion" : "Disable text motion",
		run: (draft) => {
			const binding = draft.textAnimators?.find(
				(candidate) => candidate.id === bindingId,
			);
			if (!binding) return;
			binding.enabled = enabled;
		},
	};
}
