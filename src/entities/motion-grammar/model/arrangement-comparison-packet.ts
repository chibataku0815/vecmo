import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { readArrangementLayoutSnapshot } from "@/entities/scene/model/arrangement-layout-snapshot";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import {
	findNode,
	findRenderableNodeEntry,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type ArrangementReferenceInput,
	type ArrangementReferenceSample,
	arrangementReferenceCriticalFrames,
	sampleArrangementReference,
} from "./arrangement-reference-oracle";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

export const ARRANGEMENT_CANDIDATE_SURFACE =
	"shared-presentation-arrangement-gate" as const;

export type ArrangementSurfaceId =
	| "canvas"
	| "svg"
	| "pdf"
	| "javascript-code-runtime"
	| "webgl"
	| "bake";

export type ArrangementSurfaceObservation = {
	readonly surface: ArrangementSurfaceId;
	readonly status: "supported" | "unsupported" | "not-evaluated";
	readonly reason: string;
};

export type ArrangementCandidateInput = {
	readonly source: ArrangementReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly sourceSnapshotId: string;
	readonly destinationSnapshotId: string;
	readonly artboardId?: string | null;
};

export type ArrangementCandidatePose = {
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly rotation: number;
};

export type ArrangementComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly reference: ArrangementReferenceSample;
	readonly candidatePoses: readonly ArrangementCandidatePose[];
};

export type ArrangementComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible";
			readonly candidateSurface: typeof ARRANGEMENT_CANDIDATE_SURFACE;
			readonly frames: readonly ArrangementComparisonFrame[];
			readonly gaps: readonly string[];
			readonly surfaces: readonly ArrangementSurfaceObservation[];
	  }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof ARRANGEMENT_CANDIDATE_SURFACE;
			readonly frames: readonly ArrangementComparisonFrame[];
			readonly surfaces: readonly ArrangementSurfaceObservation[];
	  };

const blocked = (reason: string): ArrangementComparisonPacket => ({
	status: "blocked",
	reason,
});

const sameSnapshot = (
	left: ArrangementReferenceInput["sourceSnapshot"],
	right: ArrangementReferenceInput["sourceSnapshot"],
): boolean => {
	if (
		left.id !== right.id ||
		left.name !== right.name ||
		left.artboardId !== right.artboardId ||
		left.coordinateSpace !== right.coordinateSpace ||
		left.captureToken !== right.captureToken ||
		left.capturedArtboardSize.width !== right.capturedArtboardSize.width ||
		left.capturedArtboardSize.height !== right.capturedArtboardSize.height ||
		left.memberNodeIds.length !== right.memberNodeIds.length
	) {
		return false;
	}
	for (const nodeId of left.memberNodeIds) {
		if (!right.memberNodeIds.includes(nodeId)) return false;
		const leftPosition = left.positions[nodeId];
		const rightPosition = right.positions[nodeId];
		if (
			!leftPosition ||
			!rightPosition ||
			leftPosition.x !== rightPosition.x ||
			leftPosition.y !== rightPosition.y
		) {
			return false;
		}
	}
	return true;
};

const surfaceObservations = (): readonly ArrangementSurfaceObservation[] =>
	["canvas", "svg", "pdf", "javascript-code-runtime", "webgl", "bake"].map(
		(surface) => ({
			surface: surface as ArrangementSurfaceId,
			status: "not-evaluated",
			reason:
				"Current arrangement candidate has no source-equivalent layout correspondence admission.",
		}),
	);

const sameRecord = (
	left: Readonly<Record<string, string>>,
	right: Readonly<Record<string, string>>,
): boolean => {
	const leftEntries = Object.entries(left);
	return (
		leftEntries.length === Object.keys(right).length &&
		leftEntries.every(([key, value]) => right[key] === value)
	);
};

const samePointRecord = (
	left: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
	right: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
): boolean => {
	const leftEntries = Object.entries(left);
	return (
		leftEntries.length === Object.keys(right).length &&
		leftEntries.every(([key, value]) => {
			const other = right[key];
			return Boolean(other) && other.x === value.x && other.y === value.y;
		})
	);
};

const nativeMappingMatchesSource = (
	input: ArrangementCandidateInput,
): boolean => {
	const mapping = input.binding.arrangementMapping;
	if (!mapping) return false;
	if (
		mapping.sourceSnapshotId !== input.sourceSnapshotId ||
		mapping.destinationSnapshotId !== input.destinationSnapshotId ||
		!sameRecord(mapping.sourceToStage, input.source.sourceToStage) ||
		!sameRecord(mapping.stageToDestination, input.source.stageToDestination) ||
		!samePointRecord(mapping.stageSlots, input.source.stageSlots) ||
		mapping.pivot.x !== input.source.pivot.x ||
		mapping.pivot.y !== input.source.pivot.y
	) {
		return false;
	}
	const delays = input.source.stagingDelayFractionBySource ?? {};
	const candidateDelays = mapping.stagingDelayFractionBySource ?? {};
	if (Object.keys(delays).length !== Object.keys(candidateDelays).length)
		return false;
	for (const [key, value] of Object.entries(delays)) {
		if (candidateDelays[key] !== value) return false;
	}
	for (const [key, value] of [
		["periodFrames", input.source.periodFrames],
		["phaseStartFrame", input.source.phaseStartFrame],
		["gatherFraction", input.source.gatherFraction],
		["holdFraction", input.source.holdFraction],
		["sharedTurnDegrees", input.source.sharedTurnDegrees],
		["lobeDepth", input.source.lobeDepth],
	] as const) {
		if (input.binding.parameters[key] !== value) return false;
	}
	return true;
};

const resolveArtboardId = (input: ArrangementCandidateInput): string | null => {
	const firstTargetId = input.binding.targetIds[0];
	if (!firstTargetId) return null;
	const firstTarget = findNode(input.scene, firstTargetId);
	if (!firstTarget) return null;
	const targetArtboardId = selectArtboardIdForNode(input.scene, firstTarget.id);
	if (!targetArtboardId) return null;
	if (input.artboardId !== undefined && input.artboardId !== null) {
		return input.artboardId === targetArtboardId ? input.artboardId : null;
	}
	return targetArtboardId;
};

const candidatePosesAt = (
	input: ArrangementCandidateInput,
	frame: number,
	artboardId: string,
): readonly ArrangementCandidatePose[] | string => {
	const layoutScene = materializeLayoutFramesForPresentation(input.scene);
	const grammar = buildExpressionAwareFrameSampler({
		scene: layoutScene,
		fps: input.motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: input.bindings,
			scene: layoutScene,
			motion: input.motion,
		}),
	});
	if (!grammar)
		return "Arrangement candidate has no shared grammar presentation sampler.";
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame,
		artboardId,
		grammar,
	});
	return input.binding.targetIds.flatMap((nodeId) => {
		const value = presentation.values.find(
			(candidate) => candidate.nodeId === nodeId,
		);
		return value
			? [
					{
						nodeId,
						position: value.transform.position,
						rotation: value.transform.rotation,
					},
				]
			: [];
	});
};

/** Builds a read-only Arrangement gate packet without promoting the centroid ring. */
export function buildArrangementComparisonPacket(
	input: ArrangementCandidateInput,
): ArrangementComparisonPacket {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return blocked(
			"Arrangement comparison requires exactly one binding object matching input.binding.",
		);
	}
	if (input.binding.techniqueId !== "arrangement-transition") {
		return blocked(
			"Arrangement comparison requires the registered arrangement-transition expression.",
		);
	}
	const sourceSnapshot = (input.scene.arrangementLayoutSnapshots ?? []).find(
		(snapshot) => snapshot.id === input.sourceSnapshotId,
	);
	const destinationSnapshot = (
		input.scene.arrangementLayoutSnapshots ?? []
	).find((snapshot) => snapshot.id === input.destinationSnapshotId);
	if (!sourceSnapshot || !destinationSnapshot) {
		return blocked(
			"Arrangement comparison requires named Scene-owned source and destination snapshots.",
		);
	}
	if (
		!sameSnapshot(input.source.sourceSnapshot, sourceSnapshot) ||
		!sameSnapshot(input.source.destinationSnapshot, destinationSnapshot)
	) {
		return blocked(
			"Arrangement oracle snapshots must bind exactly to the named Scene snapshots.",
		);
	}
	const sourceRead = readArrangementLayoutSnapshot(input.scene, sourceSnapshot);
	const destinationRead = readArrangementLayoutSnapshot(
		input.scene,
		destinationSnapshot,
	);
	if (sourceRead.status === "stale" || destinationRead.status === "stale") {
		return blocked(
			`Arrangement snapshot is stale: ${[
				...sourceRead.reasons,
				...destinationRead.reasons,
			].join("; ")}`,
		);
	}
	if (
		sourceRead.snapshot.artboardId !== destinationRead.snapshot.artboardId ||
		!findRenderableNodeEntry(
			input.scene,
			sourceRead.snapshot.memberNodeIds[0] ?? "",
		)
	) {
		return blocked(
			"Arrangement snapshots must resolve to one renderable artboard collection.",
		);
	}
	const artboardId = resolveArtboardId(input);
	if (!artboardId || artboardId !== sourceRead.snapshot.artboardId) {
		return blocked(
			"Arrangement target collection and snapshots must resolve to one artboard.",
		);
	}
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === artboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return blocked(
			"Arrangement comparison requires an explicit screen_2d camera-space policy.",
		);
	}
	const sourceCritical = arrangementReferenceCriticalFrames(input.source);
	if (sourceCritical.status === "blocked")
		return blocked(sourceCritical.reason);
	const expectedIds = new Set(sourceRead.snapshot.memberNodeIds);
	if (
		input.binding.targetIds.length !== expectedIds.size ||
		input.binding.targetIds.some((nodeId) => !expectedIds.has(nodeId))
	) {
		return blocked(
			"Arrangement binding targets must exactly match source snapshot members.",
		);
	}
	const frames: ArrangementComparisonFrame[] = [];
	for (const critical of sourceCritical.samples) {
		const reference = sampleArrangementReference(input.source, critical.frame);
		if (reference.status === "blocked") return blocked(reference.reason);
		const referenceSample = reference.samples[0];
		if (!referenceSample)
			return blocked(
				"Arrangement source oracle returned no critical-frame sample.",
			);
		const candidate = candidatePosesAt(input, critical.frame, artboardId);
		if (typeof candidate === "string") return blocked(candidate);
		frames.push({
			id: critical.id,
			purpose: critical.purpose,
			sourceFrame: critical.frame,
			reference: referenceSample,
			candidatePoses: candidate,
		});
	}
	if (nativeMappingMatchesSource(input)) {
		return {
			status: "ready",
			candidateSurface: ARRANGEMENT_CANDIDATE_SURFACE,
			frames,
			surfaces: surfaceObservations(),
		};
	}
	return {
		status: "incompatible",
		candidateSurface: ARRANGEMENT_CANDIDATE_SURFACE,
		frames,
		gaps: [
			"current expression derives an evenly spaced centroid ring instead of named source/destination snapshots",
			"current expression has no explicit source-to-stage or stage-to-destination identity maps",
			"current expression has no gather lobe, staging hold, or shared turn/chord output",
		],
		surfaces: surfaceObservations(),
	};
}
