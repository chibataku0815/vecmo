import { castDraft, type Draft } from "immer";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import type { MotionCommand } from "./command";
import { snapMotionFrame } from "./commands";
import {
	defaultEasedKeyframe,
	type EasingCurve,
	type EasingPreset,
	type MotionTimingTemplateKeyframeHold,
	withSegmentEasing,
	withSegmentEasingCurve,
} from "./easing";
import type {
	CameraCutSegment,
	CameraRigAnimatableProperty,
	CameraRigTrack,
	MotionDocument,
} from "./types";

type CameraRigVectorKind = "body" | "target" | "bodyRotation";

const CAMERA_TRACK_ID_PREFIX = "camera";

const byTime = (left: AeKeyframe<number>, right: AeKeyframe<number>): number =>
	left.time - right.time;

const coalesceFrame = (frame: number): number =>
	Number.isFinite(frame) ? Math.round(frame) : 0;

const finiteValue = (value: number): number | null =>
	Number.isFinite(value) ? value : null;

const positiveFrameCount = (value: number): number =>
	Number.isFinite(value) && value > 0 ? Math.round(value) : 1;

const optionalFrameCount = (value: number | undefined): number | undefined =>
	value !== undefined && Number.isFinite(value) && value > 0
		? Math.round(value)
		: undefined;

const defaultCrossfadeDurationFrames = (fps: number): number =>
	Math.max(2, Math.round((Number.isFinite(fps) ? fps : 24) / 4));

const optionalNonNegativeFrame = (
	value: number | undefined,
): number | undefined =>
	value !== undefined && Number.isFinite(value) && value >= 0
		? Math.round(value)
		: undefined;

const normalizedName = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const sortCameraCuts = (
	left: CameraCutSegment,
	right: CameraCutSegment,
): number =>
	left.artboardId.localeCompare(right.artboardId) ||
	left.startFrame - right.startFrame ||
	left.id.localeCompare(right.id);

const sanitizedCameraCut = (
	draft: Draft<MotionDocument>,
	segment: CameraCutSegment,
): CameraCutSegment | null => {
	if (
		!segment.id.trim() ||
		!segment.artboardId.trim() ||
		!segment.cameraRigId.trim()
	) {
		return null;
	}
	const startFrame = snapMotionFrame(segment.startFrame, draft.durationFrames);
	const durationFrames = Math.min(
		positiveFrameCount(segment.durationFrames),
		Math.max(1, draft.durationFrames - startFrame),
	);
	const transition = segment.transition === "crossfade" ? "crossfade" : "cut";
	const transitionDurationFrames =
		transition === "crossfade"
			? (optionalFrameCount(segment.transitionDurationFrames) ??
				defaultCrossfadeDurationFrames(draft.fps))
			: undefined;
	const name = normalizedName(segment.name);
	const laneId = normalizedName(segment.laneId);
	const thumbnailFrame = optionalNonNegativeFrame(segment.thumbnailFrame);
	return {
		id: segment.id,
		...(name ? { name } : {}),
		artboardId: segment.artboardId,
		cameraRigId: segment.cameraRigId,
		...(laneId ? { laneId } : {}),
		startFrame,
		durationFrames,
		transition,
		...(transition === "crossfade" && transitionDurationFrames !== undefined
			? {
					transitionDurationFrames: Math.min(
						transitionDurationFrames,
						durationFrames,
					),
				}
			: {}),
		...(thumbnailFrame !== undefined
			? {
					thumbnailFrame: Math.min(
						Math.max(0, thumbnailFrame),
						draft.durationFrames - 1,
					),
				}
			: {}),
	};
};

/** Deterministic side-car track id for one camera rig channel. */
export function cameraRigTrackId(
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
): string {
	return `${CAMERA_TRACK_ID_PREFIX}:${cameraRigId}:${property}`;
}

const findCameraTrackByTarget = (
	draft: Draft<MotionDocument>,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
): Draft<CameraRigTrack> | undefined =>
	draft.cameraTracks?.find(
		(track) =>
			track.target.cameraRigId === cameraRigId &&
			track.target.property === property,
	);

const findCameraTrackById = (
	draft: Draft<MotionDocument>,
	trackId: string,
): Draft<CameraRigTrack> | undefined =>
	draft.cameraTracks?.find((track) => track.id === trackId);

const ensureCameraTracks = (
	draft: Draft<MotionDocument>,
): Draft<CameraRigTrack>[] => {
	if (!draft.cameraTracks) draft.cameraTracks = [];
	return draft.cameraTracks as Draft<CameraRigTrack>[];
};

const upsertCameraRigKeyframeIntoDraft = (
	draft: Draft<MotionDocument>,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
	frame: number,
	value: number,
): boolean => {
	const storedValue = finiteValue(value);
	if (storedValue === null) return false;
	const snapped = snapMotionFrame(frame, draft.durationFrames);
	const existingTrack = findCameraTrackByTarget(draft, cameraRigId, property);
	const tracks = ensureCameraTracks(draft);
	const track =
		existingTrack ??
		tracks[
			tracks.push({
				id: cameraRigTrackId(cameraRigId, property),
				target: { cameraRigId, property },
				keyframes: [],
			}) - 1
		];
	const existing = track.keyframes.find(
		(keyframe) => keyframe.time === snapped,
	);
	if (existing) {
		existing.value = storedValue;
		return true;
	}
	track.keyframes.push(
		castDraft(defaultEasedKeyframe({ time: snapped, value: storedValue })),
	);
	track.keyframes.sort(byTime);
	return true;
};

/**
 * Upserts one camera rig keyframe in the `cameraTracks` side-car. This keeps
 * authored camera motion out of node-keyed tracks and prevents sentinel node ids
 * from leaking into the timeline model.
 */
export function upsertCameraRigKeyframe(
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
	frame: number,
	value: number,
): MotionCommand {
	return {
		type: "motion/upsert-camera-keyframe",
		label: "Set camera keyframe",
		coalesceKey: `motion-camera:${cameraRigId}:${property}:${coalesceFrame(frame)}`,
		run: (draft) => {
			upsertCameraRigKeyframeIntoDraft(
				draft,
				cameraRigId,
				property,
				frame,
				value,
			);
		},
	};
}

const vectorProperty = (
	kind: CameraRigVectorKind,
	axis: "x" | "y" | "z",
): CameraRigAnimatableProperty => {
	if (kind === "body") {
		if (axis === "x") return "bodyX";
		if (axis === "y") return "bodyY";
		return "bodyZ";
	}
	if (kind === "bodyRotation") {
		if (axis === "x") return "bodyRotationX";
		if (axis === "y") return "bodyRotationY";
		return "bodyRotationZ";
	}
	if (axis === "x") return "targetX";
	if (axis === "y") return "targetY";
	return "targetZ";
};

/**
 * Upserts body, rotation, or target X/Y/Z camera keys as one command, so
 * dragging a camera point or stamping camera orientation can undo as a single
 * authored pose instead of three separate channels.
 */
export function upsertCameraRigVectorKeyframes(
	cameraRigId: string,
	kind: CameraRigVectorKind,
	frame: number,
	value: Partial<Record<"x" | "y" | "z", number>>,
): MotionCommand {
	return {
		type: "motion/upsert-camera-vector-keyframes",
		label:
			kind === "body"
				? "Set camera body keyframe"
				: kind === "bodyRotation"
					? "Set camera rotation keyframe"
					: "Set camera target keyframe",
		coalesceKey: `motion-camera:${cameraRigId}:${kind}:${coalesceFrame(frame)}`,
		run: (draft) => {
			for (const axis of ["x", "y", "z"] as const) {
				const axisValue = value[axis];
				if (axisValue === undefined) continue;
				upsertCameraRigKeyframeIntoDraft(
					draft,
					cameraRigId,
					vectorProperty(kind, axis),
					frame,
					axisValue,
				);
			}
		},
	};
}

/** Removes one camera keyframe and drops the channel once its last key is gone. */
export function removeCameraRigKeyframe(
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
	frame: number,
): MotionCommand {
	return {
		type: "motion/remove-camera-keyframe",
		label: "Delete camera keyframe",
		coalesceKey: `motion-camera-remove:${cameraRigId}:${property}:${coalesceFrame(frame)}`,
		run: (draft) => {
			const tracks = draft.cameraTracks;
			if (!tracks) return;
			const trackIndex = tracks.findIndex(
				(track) =>
					track.target.cameraRigId === cameraRigId &&
					track.target.property === property,
			);
			if (trackIndex < 0) return;
			const snapped = snapMotionFrame(frame, draft.durationFrames);
			const track = tracks[trackIndex];
			const keyIndex = track.keyframes.findIndex(
				(keyframe) => keyframe.time === snapped,
			);
			if (keyIndex < 0) return;
			track.keyframes.splice(keyIndex, 1);
			if (track.keyframes.length === 0) tracks.splice(trackIndex, 1);
			if (tracks.length === 0) draft.cameraTracks = undefined;
		},
	};
}

/**
 * Retimes one camera keyframe without routing through node-keyed tracks. Colliding
 * moves are dropped so camera diamond drags never merge authored poses.
 */
export function setCameraRigKeyframeTime(
	trackId: string,
	fromFrame: number,
	toFrame: number,
	coalesceKey: string,
): MotionCommand {
	return {
		type: "motion/retime-camera-keyframe",
		label: "Move camera keyframe",
		coalesceKey,
		run: (draft) => {
			const track = findCameraTrackById(draft, trackId);
			if (!track) return;
			const target = snapMotionFrame(toFrame, draft.durationFrames);
			if (target === fromFrame) return;
			const keyframe = track.keyframes.find((item) => item.time === fromFrame);
			if (!keyframe) return;
			const occupied = track.keyframes.some(
				(item) => item !== keyframe && item.time === target,
			);
			if (occupied) return;
			keyframe.time = target;
			track.keyframes.sort(byTime);
		},
	};
}

const applySegmentEasingToCameraTrack = (
	track: Draft<CameraRigTrack>,
	frame: number,
	easing:
		| { readonly kind: "preset"; readonly preset: EasingPreset }
		| { readonly kind: "curve"; readonly curve: EasingCurve },
): void => {
	const index = track.keyframes.findIndex((item) => item.time === frame);
	if (index < 0) return;
	const nextDraft = track.keyframes[index + 1];
	const left = track.keyframes[index];
	const right = nextDraft ? { ...nextDraft } : undefined;
	const eased =
		easing.kind === "preset"
			? withSegmentEasing({ ...left }, right, easing.preset)
			: withSegmentEasingCurve({ ...left }, right, easing.curve);
	track.keyframes[index] = castDraft(eased.left);
	if (nextDraft && eased.right)
		track.keyframes[index + 1] = castDraft(eased.right);
};

const holdFrameForCameraSegment = (
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

const applySegmentEasingWithHoldToCameraTrack = (
	draft: Draft<MotionDocument>,
	track: Draft<CameraRigTrack>,
	frame: number,
	easing:
		| { readonly kind: "preset"; readonly preset: EasingPreset }
		| { readonly kind: "curve"; readonly curve: EasingCurve },
	hold: MotionTimingTemplateKeyframeHold,
): void => {
	const index = track.keyframes.findIndex((item) => item.time === frame);
	const right = index >= 0 ? track.keyframes[index + 1] : undefined;
	if (right) {
		const following = track.keyframes[index + 2];
		const alreadyHolding =
			hold.source === "right-key-value" &&
			following !== undefined &&
			Object.is(right.value, following.value);
		const holdFrame = alreadyHolding
			? null
			: holdFrameForCameraSegment(frame, right.time, hold);
		if (holdFrame !== null) {
			upsertCameraRigKeyframeIntoDraft(
				draft,
				track.target.cameraRigId,
				track.target.property,
				holdFrame,
				right.value,
			);
		}
	}
	applySegmentEasingToCameraTrack(track, frame, easing);
};

/** Rewrites the easing of the segment leaving a camera keyframe. */
export function setCameraRigKeyframeEasing(
	trackId: string,
	frame: number,
	easing: EasingPreset,
): MotionCommand {
	return {
		type: "motion/set-camera-easing",
		label: "Set camera easing",
		run: (draft) => {
			const track = findCameraTrackById(draft, trackId);
			if (!track) return;
			applySegmentEasingToCameraTrack(track, frame, {
				kind: "preset",
				preset: easing,
			});
		},
	};
}

/** Rewrites the selected camera segment with a sampler-compatible cubic curve. */
export function setCameraRigKeyframeEasingCurve(
	trackId: string,
	frame: number,
	curve: EasingCurve,
): MotionCommand {
	return {
		type: "motion/set-camera-easing-curve",
		label: "Set camera easing curve",
		coalesceKey: `motion-camera-easing:${trackId}:${frame}`,
		run: (draft) => {
			const track = findCameraTrackById(draft, trackId);
			if (!track) return;
			applySegmentEasingToCameraTrack(track, frame, { kind: "curve", curve });
		},
	};
}

/** Applies a semantic timing template that inserts an intermediate camera hold. */
export function setCameraRigKeyframeEasingWithHold(
	trackId: string,
	frame: number,
	easing:
		| { readonly kind: "preset"; readonly preset: EasingPreset }
		| { readonly kind: "curve"; readonly curve: EasingCurve },
	hold: MotionTimingTemplateKeyframeHold,
): MotionCommand {
	return {
		type: "motion/set-camera-easing-hold",
		label: "Set camera easing",
		coalesceKey: `motion-camera-easing:${trackId}:${frame}`,
		run: (draft) => {
			const track = findCameraTrackById(draft, trackId);
			if (!track) return;
			applySegmentEasingWithHoldToCameraTrack(
				draft,
				track,
				frame,
				easing,
				hold,
			);
		},
	};
}

/** Removes one camera channel track by target. */
export function removeCameraRigTrack(
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
): MotionCommand {
	return {
		type: "motion/remove-camera-track",
		label: "Delete camera track",
		run: (draft) => {
			const tracks = draft.cameraTracks;
			if (!tracks) return;
			const next = tracks.filter(
				(track) =>
					!(
						track.target.cameraRigId === cameraRigId &&
						track.target.property === property
					),
			);
			draft.cameraTracks = next.length > 0 ? castDraft(next) : undefined;
		},
	};
}

/** Removes every camera track for a rig, used when deleting a scene camera. */
export function removeCameraRigTracks(cameraRigId: string): MotionCommand {
	return {
		type: "motion/remove-camera-rig-tracks",
		label: "Delete camera motion",
		run: (draft) => {
			const tracks = draft.cameraTracks;
			if (tracks) {
				const next = tracks.filter(
					(track) => track.target.cameraRigId !== cameraRigId,
				);
				draft.cameraTracks = next.length > 0 ? castDraft(next) : undefined;
			}
			const cuts = draft.cameraCuts?.filter(
				(segment) => segment.cameraRigId !== cameraRigId,
			);
			if (draft.cameraCuts) {
				draft.cameraCuts =
					cuts && cuts.length > 0 ? castDraft(cuts) : undefined;
			}
		},
	};
}

/** Adds or replaces a hard camera cut segment. */
export function upsertCameraCutSegment(
	segment: CameraCutSegment,
): MotionCommand {
	return {
		type: "motion/upsert-camera-cut",
		label: "Set camera cut",
		coalesceKey: `motion-camera-cut:${segment.id}`,
		run: (draft) => {
			const next = sanitizedCameraCut(draft, segment);
			if (!next) return;
			const cuts = draft.cameraCuts ? [...draft.cameraCuts] : [];
			const index = cuts.findIndex((item) => item.id === next.id);
			if (index >= 0) {
				cuts[index] = next;
			} else {
				cuts.push(next);
			}
			cuts.sort(sortCameraCuts);
			draft.cameraCuts = castDraft(cuts);
		},
	};
}

/** Retimes one camera cut segment while preserving its camera assignment. */
export function retimeCameraCutSegment({
	segmentId,
	startFrame,
	durationFrames,
}: {
	readonly segmentId: string;
	readonly startFrame?: number;
	readonly durationFrames?: number;
}): MotionCommand {
	return {
		type: "motion/retime-camera-cut",
		label: "Move camera cut",
		coalesceKey: `motion-camera-cut-retime:${segmentId}`,
		run: (draft) => {
			const cuts = draft.cameraCuts;
			if (!cuts) return;
			const index = cuts.findIndex((segment) => segment.id === segmentId);
			if (index < 0) return;
			const current = cuts[index];
			const next = sanitizedCameraCut(draft, {
				...current,
				startFrame: startFrame ?? current.startFrame,
				durationFrames: durationFrames ?? current.durationFrames,
			});
			if (!next) return;
			const updated = [...cuts];
			updated[index] = next;
			updated.sort(sortCameraCuts);
			draft.cameraCuts = castDraft(updated);
		},
	};
}

/** Removes one hard camera cut segment. */
export function removeCameraCutSegment(segmentId: string): MotionCommand {
	return {
		type: "motion/remove-camera-cut",
		label: "Delete camera cut",
		run: (draft) => {
			const cuts = draft.cameraCuts;
			if (!cuts) return;
			const next = cuts.filter((segment) => segment.id !== segmentId);
			draft.cameraCuts = next.length > 0 ? castDraft(next) : undefined;
		},
	};
}
