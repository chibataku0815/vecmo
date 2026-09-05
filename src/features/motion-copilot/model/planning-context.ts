import {
	ACCEPTED_MOTION_COMMAND_TYPES,
	MAX_CONVERSATION_INTENTS,
	MAX_CONVERSATION_KEYFRAMES,
	MAX_CONVERSATION_SEGMENTS,
	MAX_CONVERSATION_TRACKS,
	type PlanConversationSummary,
	type PlanningContextProjection,
} from "@/entities/agent/model/agent-plan-schema";
import { computeContextRevision } from "@/entities/agent/model/plan-context-revision";
import type { MotionCopilotAppliedRecord } from "@/entities/agent/model/plan-session";
import { motionTimingTemplatesForKeyframeSegment } from "@/entities/motion/model/easing";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	allNodes,
	selectAllArtboards,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { appliedFocusableTrackIds } from "./projection";

/**
 * Builds the bounded, source-free planning-context projection the composer sends
 * to the Worker (Creator 2, C2-L3). Reads the entity stores directly
 * (scene/motion) — this feature may not import `features/selection` or
 * `features/motion`, so the caller (the widget, which composes those features)
 * injects the live selection and playhead. Every collection is size-capped so a
 * large document cannot inflate the request, and nothing here carries raw
 * path/paint source — ids, names, counts, and numeric timing only.
 */

/** Selection + playhead the widget reads from the feature stores it may compose. */
export type ComposerSelectionContext = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string;
	readonly playheadFrame: number;
};

const NODE_CAP = 400;
const TRACK_CAP = 200;
const SELECTION_CAP = 200;
const CAMERA_CAP = 50;

// Advertise ONLY the timing templates the keyframe-segment apply path can honor
// (C2-R1 D3). The projection IS the provider's vocabulary, so a template that is
// `keyframeSegment: "unsupported"` (e.g. `settle.velocity-land`) must never appear
// here or the provider is induced to emit a construct the keyframe compile rejects
// as "requires a motion profile surface". This is vocabulary alignment only —
// validation is unchanged and still rejects such a template if one is ever emitted.
const TIMING_TEMPLATE_IDS = motionTimingTemplatesForKeyframeSegment().map(
	(template) => template.id,
);

/**
 * Snapshots the live documents + injected selection/playhead into a bounded
 * projection and mints a `contextRevision` from the same snapshot. Returns `null`
 * only when there is no current artboard to plan against (fail closed).
 */
export function buildPlanningContextProjection(
	selection: ComposerSelectionContext,
): {
	readonly projection: PlanningContextProjection;
	readonly contextRevision: string;
} | null {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const artboard = selectCurrentArtboard(scene);
	if (!artboard) return null;

	const artboards = selectAllArtboards(scene);
	const nodes = allNodes(scene);
	const cameras = scene.sceneCameras ?? [];
	const activeRigIds = Array.from(
		new Set(
			artboards
				.map((board) => board.activeSceneCameraId)
				.filter((id): id is string => typeof id === "string"),
		),
	).slice(0, CAMERA_CAP);

	const tracks = motion.tracks.slice(0, TRACK_CAP).map((track) => {
		const maxKeyframeFrame = track.keyframes.reduce(
			(max, keyframe) => Math.max(max, keyframe.time),
			0,
		);
		return {
			id: track.id,
			targetNodeId: track.target.nodeId,
			property: track.target.property,
			keyframeCount: track.keyframes.length,
			maxKeyframeFrame,
		};
	});

	const projection: PlanningContextProjection = {
		document: {
			name: scene.name.slice(0, 200),
			artboardCount: artboards.length,
			layerCount: scene.layers.length,
			nodeCount: nodes.length,
			motionTrackCount: motion.tracks.length,
			fps: motion.fps,
			durationFrames: motion.durationFrames,
		},
		artboard: {
			id: artboard.id,
			name: artboard.name.slice(0, 200),
			width: artboard.width,
			height: artboard.height,
			fps: artboard.fps,
			durationFrames: artboard.durationFrames,
			...(artboard.cameraSpacePolicy
				? { cameraSpacePolicy: artboard.cameraSpacePolicy }
				: {}),
		},
		selection: {
			nodeIds: selection.nodeIds.slice(0, SELECTION_CAP),
			...(selection.primaryNodeId
				? { primaryNodeId: selection.primaryNodeId }
				: {}),
		},
		nodes: nodes.slice(0, NODE_CAP).map((node) => ({
			id: node.id,
			name: node.name.slice(0, 200),
			kind: node.geometry.kind,
		})),
		tracks,
		cameras: {
			count: cameras.length,
			activeRigIds,
			rigs: cameras
				.slice(0, CAMERA_CAP)
				.map((rig) => ({ id: rig.id, name: rig.name })),
		},
		playheadFrame: selection.playheadFrame,
		capabilities: {
			motionCommandTypes: [...ACCEPTED_MOTION_COMMAND_TYPES],
			timingTemplateIds: [...TIMING_TEMPLATE_IDS],
		},
	};

	// One source for the revision: the composer records THIS value against the
	// projection it sends, and the staleness watcher recomputes it from the live
	// stores with the same function. `artboard` is present (guarded above), so the
	// value-sensitive revision is never null on this path.
	const contextRevision = computeContextRevision(scene, motion) ?? "";

	return { projection, contextRevision };
}

/**
 * Coarse per-keyframe easing signature for the conversation summary — the exact
 * temporal curve when present (so a manual handle reshape is visible to the
 * provider), else the outgoing interpolation type. Kept within the schema's 64-char
 * cap.
 */
const keyframeEasingSignature = (keyframe: {
	readonly inInterpolationType?: number;
	readonly outInterpolationType?: number;
	readonly outTemporalCurve?: {
		readonly x1: number;
		readonly y1: number;
		readonly x2: number;
		readonly y2: number;
	};
}): string | undefined => {
	const curve = keyframe.outTemporalCurve;
	if (curve) {
		return `c:${curve.x1},${curve.y1},${curve.x2},${curve.y2}`.slice(0, 64);
	}
	if (keyframe.outInterpolationType !== undefined) {
		return `i:${keyframe.outInterpolationType}`;
	}
	return undefined;
};

type AffectedTrack = PlanConversationSummary["affectedTracks"][number];

/**
 * Derives ordered inter-key segment labels (Creator 2, C2-L5) from a track's
 * summary keyframes so the provider can resolve relative follow-up references —
 * "the final settle", "the last bump" — against explicit frame spans instead of
 * guessing from a flat keyframe list (the recorded gap where "final settle" was
 * misread as the first settle). Each segment spans one consecutive keyframe pair;
 * the LAST is flagged `final`. Purely structural: frame spans + ordering + a final
 * marker, NO semantic role name (rise/overshoot cannot be inferred from numbers —
 * that reading stays the model's job). Fewer than two keys yields no segments.
 */
const buildSegmentLabels = (
	keyframes: AffectedTrack["keyframes"],
): NonNullable<AffectedTrack["segments"]> => {
	if (keyframes.length < 2) return [];
	const lastIndex = keyframes.length - 2;
	return keyframes
		.slice(0, MAX_CONVERSATION_SEGMENTS + 1)
		.slice(0, -1)
		.map((keyframe, index) => ({
			index,
			fromFrame: keyframe.frame,
			toFrame: keyframes[index + 1].frame,
			...(index === lastIndex ? { final: true as const } : {}),
		}));
};

/**
 * Builds the compact follow-up conversation summary (Creator 2, C2-L4) from the
 * accepted-delta thread. Reads the LIVE motion/scene stores so previously-affected
 * tracks carry their CURRENT (post-manual-edit) keyframe values — this is the
 * manual-edit-preservation mechanism (the provider computes a delta from reality,
 * not from its own prior proposal), not a diff engine. Returns `undefined` when the
 * thread is empty (a first-turn request), so the first plan behaves exactly as in
 * C2-L3. Only the transient thread is read; nothing durable is created here.
 */
export function buildConversationSummary(
	history: readonly MotionCopilotAppliedRecord[],
): PlanConversationSummary | undefined {
	if (history.length === 0) return undefined;

	// Prior accepted intents, chronological (oldest → newest), most-recent-capped.
	const priorIntents = history
		.slice(0, MAX_CONVERSATION_INTENTS)
		.map((record) => record.result.intent)
		.reverse();

	// Union of every track earlier accepted plans touched, newest-first, deduped.
	const affectedTrackIds: string[] = [];
	const seenAffected = new Set<string>();
	for (const record of history) {
		for (const trackId of appliedFocusableTrackIds(record.result)) {
			if (seenAffected.has(trackId)) continue;
			seenAffected.add(trackId);
			affectedTrackIds.push(trackId);
		}
	}

	const motion = useMotionStore.getState().document;
	const resolveTrack = (affectedId: string) =>
		motion.tracks.find((track) => track.id === affectedId) ??
		motion.tracks.find(
			(track) =>
				`${track.target.nodeId}:${track.target.property}` === affectedId,
		);

	const affectedTracks: PlanConversationSummary["affectedTracks"] = [];
	const seenTracks = new Set<string>();
	for (const affectedId of affectedTrackIds) {
		if (affectedTracks.length >= MAX_CONVERSATION_TRACKS) break;
		const track = resolveTrack(affectedId);
		if (!track || seenTracks.has(track.id)) continue;
		seenTracks.add(track.id);
		const summaryKeyframes = track.keyframes
			.slice(0, MAX_CONVERSATION_KEYFRAMES)
			.map((keyframe) => {
				const easing = keyframeEasingSignature(keyframe);
				return {
					frame: keyframe.time,
					...(typeof keyframe.value === "number" &&
					Number.isFinite(keyframe.value)
						? { value: keyframe.value }
						: {}),
					...(easing ? { easing } : {}),
				};
			});
		const segments = buildSegmentLabels(summaryKeyframes);
		affectedTracks.push({
			trackId: track.id,
			...(track.target.nodeId ? { targetNodeId: track.target.nodeId } : {}),
			property: track.target.property,
			keyframes: summaryKeyframes,
			...(segments.length > 0 ? { segments } : {}),
		});
	}

	return { priorIntents, affectedTracks };
}
