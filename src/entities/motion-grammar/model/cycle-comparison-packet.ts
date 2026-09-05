import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import { sampleNodePathMetric } from "@/entities/scene/model/path-metrics";
import {
	findNode,
	findRenderableNodeEntry,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type CycleReferenceInput,
	type CycleReferenceSample,
	cycleReferenceCriticalFrames,
	sampleCycleReference,
} from "./cycle-reference-oracle";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

export const CYCLE_CANDIDATE_SURFACE =
	"shared-presentation-cycle-gate" as const;

export type CycleSurfaceId =
	| "canvas"
	| "svg"
	| "pdf"
	| "javascript-code-runtime"
	| "webgl"
	| "bake";

export type CycleSurfaceObservation = {
	readonly surface: CycleSurfaceId;
	readonly status: "supported" | "unsupported" | "not-evaluated";
	readonly reason: string;
};

export type CycleCandidateInput = {
	readonly source: CycleReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly pathNodeId: string;
	readonly artboardId?: string | null;
};

export type CycleCandidatePose = {
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly rotation: number;
};

export type CycleComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly reference: CycleReferenceSample;
	readonly candidatePoses: readonly CycleCandidatePose[];
	readonly candidateDashOffset: number | null;
	readonly candidateHeadDotPosition: {
		readonly x: number;
		readonly y: number;
	} | null;
};

export type CycleComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "incompatible";
			readonly candidateSurface: typeof CYCLE_CANDIDATE_SURFACE;
			readonly frames: readonly CycleComparisonFrame[];
			readonly gaps: readonly string[];
			readonly surfaces: readonly CycleSurfaceObservation[];
	  }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof CYCLE_CANDIDATE_SURFACE;
			readonly frames: readonly CycleComparisonFrame[];
			readonly surfaces: readonly CycleSurfaceObservation[];
	  };

const blocked = (reason: string): CycleComparisonPacket => ({
	status: "blocked",
	reason,
});

const surfaceObservations = (
	eligibleStaticDash: boolean,
): readonly CycleSurfaceObservation[] => {
	const status = eligibleStaticDash ? "supported" : "not-evaluated";
	const reason = eligibleStaticDash
		? "Static non-empty dash is transportable; source-law window/head-dot parity remains unproven."
		: "Requires a surviving non-empty static strokeDash and no strokeWidthProfile.";
	return [
		{ surface: "canvas", status, reason },
		{ surface: "svg", status, reason },
		{ surface: "pdf", status, reason },
		{ surface: "javascript-code-runtime", status, reason },
		{ surface: "webgl", status, reason },
		{
			surface: "bake",
			status: "unsupported",
			reason:
				"Current Cycle decomposition bakes position/rotation only, not dash/dashoffset.",
		},
	];
};

const resolveArtboardId = (input: CycleCandidateInput): string | null => {
	const path = findNode(input.scene, input.pathNodeId);
	if (!path) return null;
	const pathArtboardId = selectArtboardIdForNode(input.scene, path.id);
	if (!pathArtboardId) return null;
	if (input.artboardId !== undefined && input.artboardId !== null) {
		if (input.artboardId !== pathArtboardId) return null;
		return input.artboardId;
	}
	return pathArtboardId;
};

const isEligibleStaticDash = (input: CycleCandidateInput): boolean => {
	const path = findNode(input.scene, input.pathNodeId);
	if (path?.geometry.kind !== "path" || !path.geometry.shape.closed) {
		return false;
	}
	if (path.style.strokeWidthProfile) return false;
	const dash = path.style.strokeDash ?? [];
	if (
		dash.length !== 2 ||
		!dash.every((value) => Number.isFinite(value) && value > 0)
	) {
		return false;
	}
	const pathEnd = sampleNodePathMetric(path, 1);
	if (!pathEnd || !(pathEnd.length > 0)) return false;
	const windowFraction = input.binding.parameters.windowFraction;
	if (
		!(
			Number.isFinite(windowFraction) &&
			windowFraction > 0 &&
			windowFraction < 1
		)
	)
		return false;
	return (
		Math.abs(dash[0] - pathEnd.length * windowFraction) <= 1e-3 &&
		Math.abs(dash[1] - pathEnd.length * (1 - windowFraction)) <= 1e-3
	);
};

const headDotNodeId = (binding: MotionGrammarBinding): string | null => {
	const aliases = new Set(["head-dot", "cyclic-path-travel:head-dot"]);
	for (const nodeId of binding.targetIds) {
		if (aliases.has(binding.roleMap?.[nodeId] ?? "")) return nodeId;
	}
	for (const alias of aliases) {
		const nodeId = binding.roleMap?.[alias];
		if (nodeId && binding.targetIds.includes(nodeId)) return nodeId;
	}
	return null;
};

const roleNodeIds = (
	binding: MotionGrammarBinding,
	aliases: readonly string[],
): readonly string[] => {
	const aliasSet = new Set(aliases);
	const resolved = new Set<string>();
	for (const nodeId of binding.targetIds) {
		if (aliasSet.has(binding.roleMap?.[nodeId] ?? "")) resolved.add(nodeId);
	}
	for (const alias of aliases) {
		const nodeId = binding.roleMap?.[alias];
		if (nodeId && binding.targetIds.includes(nodeId)) resolved.add(nodeId);
	}
	return [...resolved];
};

const pointsMatch = (
	left: { readonly x: number; readonly y: number } | null,
	right: { readonly x: number; readonly y: number },
): boolean =>
	Boolean(
		left &&
			Math.abs(left.x - right.x) <= 1e-4 &&
			Math.abs(left.y - right.y) <= 1e-4,
	);

const candidatePosesAt = (
	input: CycleCandidateInput,
	frame: number,
	artboardId: string,
):
	| {
			readonly poses: readonly CycleCandidatePose[];
			readonly dashOffset: number | null;
	  }
	| string => {
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
		return "Cycle candidate has no shared grammar presentation sampler.";
	// The named loop seam is represented by the same presentation sample as the
	// loop origin; clip activation is end-exclusive for ordinary frames.
	const sampledFrame =
		frame >= input.motion.durationFrames
			? frame % Math.max(1, input.motion.durationFrames)
			: frame;
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame: sampledFrame,
		artboardId,
		grammar,
	});
	const sampledPath = findNode(presentation.scene, input.pathNodeId);
	const dashOffset = sampledPath?.style.strokeDashoffset ?? null;
	const poses: CycleCandidatePose[] = [];
	for (const nodeId of input.binding.targetIds) {
		if (nodeId === input.pathNodeId) continue;
		const value = presentation.values.find(
			(candidate) => candidate.nodeId === nodeId,
		);
		if (!value) continue;
		poses.push({
			nodeId,
			position: value.transform.position,
			rotation: value.transform.rotation,
		});
	}
	return { poses, dashOffset };
};

/**
 * Builds a read-only Cycle gate packet. It reports structural agreement only
 * when the registered whip/crawl expression, Scene-owned dash window, head dot,
 * timing parameters, and critical-frame poses all match the independent oracle.
 */
export function buildCycleComparisonPacket(
	input: CycleCandidateInput,
): CycleComparisonPacket {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return blocked(
			"Cycle comparison requires exactly one binding object matching input.binding.",
		);
	}
	if (input.binding.techniqueId !== "cyclic-path-travel") {
		return blocked(
			"Cycle comparison requires the registered cyclic-path-travel expression.",
		);
	}
	const path = findNode(input.scene, input.pathNodeId);
	if (path?.geometry.kind !== "path" || !path.geometry.shape.closed) {
		return blocked("Cycle comparison requires one existing closed path role.");
	}
	if (!findRenderableNodeEntry(input.scene, input.pathNodeId)) {
		return blocked("Cycle path role is not renderable.");
	}
	const artboardId = resolveArtboardId(input);
	if (!artboardId)
		return blocked(
			"Cycle path and candidate artboard must resolve to one artboard.",
		);
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === artboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return blocked(
			"Cycle comparison requires an explicit screen_2d camera-space policy.",
		);
	}
	const sourceCritical = cycleReferenceCriticalFrames(input.source);
	if (sourceCritical.status === "blocked")
		return blocked(sourceCritical.reason);
	const gaps: string[] = [];
	const eligibleStaticDash = isEligibleStaticDash(input);
	if (!eligibleStaticDash)
		gaps.push("path is not eligible for static dash transport");
	const headDotId = headDotNodeId(input.binding);
	if (!headDotId) gaps.push("binding has no explicit head-dot role target");
	const bodyIds = roleNodeIds(input.binding, [
		"body",
		"cyclic-path-travel:body",
		"cyclic-path-travel:traveler",
	]);
	if (bodyIds.length !== 1)
		gaps.push(
			"Cycle structural comparison requires exactly one body/head target",
		);
	const pathMetric = sampleNodePathMetric(path, 1);
	const candidatePathLength = pathMetric?.length ?? Number.NaN;
	const candidatePeriod = input.binding.parameters.periodFrames;
	const candidatePhaseStart = input.binding.parameters.phaseStartFrame;
	const candidateWhipDuration = input.binding.parameters.whipDurationFrames;
	const candidateWhipSpan = input.binding.parameters.whipSpanFraction;
	const candidateWindow = input.binding.parameters.windowFraction;
	const candidateHeadLag = input.binding.parameters.headLagFraction;
	if (
		Math.abs((candidatePeriod ?? Number.NaN) - input.source.periodFrames) >
			1e-4 ||
		Math.abs(
			(candidatePhaseStart ?? Number.NaN) - input.source.phaseStartFrame,
		) > 1e-4 ||
		Math.abs(
			(candidateWhipDuration ?? Number.NaN) - input.source.whipDurationFrames,
		) > 1e-4 ||
		Math.abs(
			(candidateWhipSpan ?? Number.NaN) - input.source.whipSpanFraction,
		) > 1e-4 ||
		Math.abs((candidateWindow ?? Number.NaN) - input.source.windowFraction) >
			1e-4 ||
		Math.abs((candidateHeadLag ?? Number.NaN) - input.source.headLagFraction) >
			1e-4 ||
		Math.abs(candidatePathLength - input.source.pathLength) > 1e-4
	) {
		gaps.push(
			"candidate Cycle timing/window/path parameters do not match the source oracle input",
		);
	}
	const frames: CycleComparisonFrame[] = [];
	for (const critical of sourceCritical.samples) {
		const reference = sampleCycleReference(input.source, critical.frame);
		if (reference.status === "blocked") return blocked(reference.reason);
		const sourceSample = reference.samples[0];
		if (!sourceSample)
			return blocked("Cycle source oracle returned no critical-frame sample.");
		const candidate = candidatePosesAt(input, critical.frame, artboardId);
		if (typeof candidate === "string") return blocked(candidate);
		frames.push({
			id: critical.id,
			purpose: critical.purpose,
			sourceFrame: critical.frame,
			reference: sourceSample,
			candidatePoses: candidate.poses,
			candidateDashOffset: candidate.dashOffset,
			candidateHeadDotPosition:
				candidate.poses.find((pose) => pose.nodeId === headDotId)?.position ??
				null,
		});
	}
	const bodyMatches =
		bodyIds.length === 1 &&
		frames.every((frame) => {
			const candidate = frame.candidatePoses.find(
				(pose) => pose.nodeId === bodyIds[0],
			);
			return pointsMatch(
				candidate?.position ?? null,
				frame.reference.head.point,
			);
		});
	const dashMatches = frames.every(
		(frame) =>
			frame.candidateDashOffset !== null &&
			Math.abs(frame.candidateDashOffset - frame.reference.dashOffset) <= 1e-4,
	);
	const headDotMatches =
		Boolean(headDotId) &&
		frames.every((frame) => {
			const reference = frame.reference.headDot.point;
			const candidate = frame.candidateHeadDotPosition;
			return pointsMatch(candidate, reference);
		});
	if (!bodyMatches)
		gaps.push(
			"body/head position does not match the source head sample at every critical frame",
		);
	if (!dashMatches)
		gaps.push(
			"stroke dash offset does not match the source head progress at every critical frame",
		);
	if (
		eligibleStaticDash &&
		bodyMatches &&
		dashMatches &&
		headDotId &&
		headDotMatches &&
		gaps.length === 0
	) {
		return {
			status: "ready",
			candidateSurface: CYCLE_CANDIDATE_SURFACE,
			frames,
			surfaces: surfaceObservations(true),
		};
	}
	if (headDotId && !headDotMatches)
		gaps.push(
			"head-dot position does not match the independent path sample at every critical frame",
		);
	return {
		status: "incompatible",
		candidateSurface: CYCLE_CANDIDATE_SURFACE,
		frames,
		gaps,
		surfaces: surfaceObservations(eligibleStaticDash),
	};
}
