import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import {
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import {
	type InverseProportionReferenceInput,
	type InverseProportionReferenceSample,
	inverseProportionReferenceCriticalFrames,
	sampleInverseProportionReference,
} from "./inverse-proportion-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export const INVERSE_PROPORTION_CANDIDATE_SURFACE =
	"shared-presentation-relation-gate" as const;

type SurfaceId =
	| "canvas"
	| "svg"
	| "pdf"
	| "javascript-code-runtime"
	| "webgl"
	| "bake";

export type InverseProportionSurfaceObservation = {
	readonly surface: SurfaceId;
	readonly status: "not-evaluated" | "unsupported";
	readonly reason: string;
};

export type InverseProportionCandidateInput = {
	readonly source: InverseProportionReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly driverNodeId: string;
	readonly followerNodeId: string;
	readonly artboardId?: string | null;
};

export type InverseProportionCandidatePose = {
	readonly nodeId: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly scale: { readonly x: number; readonly y: number };
	readonly uniformCircleRadius: number;
};

export type InverseProportionComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly reference: InverseProportionReferenceSample;
	readonly candidatePoses: readonly InverseProportionCandidatePose[];
};

export type InverseProportionComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof INVERSE_PROPORTION_CANDIDATE_SURFACE;
			readonly frames: readonly InverseProportionComparisonFrame[];
			readonly surfaces: readonly InverseProportionSurfaceObservation[];
	  }
	| {
			readonly status: "incompatible";
			readonly candidateSurface: typeof INVERSE_PROPORTION_CANDIDATE_SURFACE;
			readonly frames: readonly InverseProportionComparisonFrame[];
			readonly gaps: readonly string[];
			readonly surfaces: readonly InverseProportionSurfaceObservation[];
	  };

const blocked = (reason: string): InverseProportionComparisonPacket => ({
	status: "blocked",
	reason,
});

const surfaces = (): readonly InverseProportionSurfaceObservation[] => [
	...(
		["canvas", "svg", "pdf", "javascript-code-runtime", "webgl"] as const
	).map((surface) => ({
		surface,
		status: "not-evaluated" as const,
		reason: "No tangent-anchor relation candidate exists for this surface.",
	})),
	{
		surface: "bake",
		status: "unsupported",
		reason: "No derived relation expansion or bake owner exists.",
	},
];

const circleRadius = (
	node: VectorNode,
	scale = node.transform.scale,
): number | null => {
	if (node.geometry.kind !== "ellipse") return null;
	const { width, height } = node.geometry.bounds;
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		width !== height
	) {
		return null;
	}
	const { x, y } = scale;
	if (!Number.isFinite(x) || !Number.isFinite(y) || x !== y || x <= 0)
		return null;
	return (width * x) / 2;
};

const mappedRoleNodeId = (
	binding: MotionGrammarBinding,
	roles: readonly string[],
): string | null => {
	if (!binding.roleMap) return null;
	for (const role of roles) {
		const direct = binding.roleMap[role];
		if (direct && binding.targetIds.includes(direct)) return direct;
	}
	for (const nodeId of binding.targetIds) {
		if (roles.includes(binding.roleMap[nodeId] ?? "")) return nodeId;
	}
	return null;
};

const candidatePoseAt = (
	input: InverseProportionCandidateInput,
	frame: number,
	artboardId: string,
): readonly InverseProportionCandidatePose[] | string => {
	const candidateFrame =
		((frame % input.source.periodFrames) + input.source.periodFrames) %
		input.source.periodFrames;
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
		return "Inverse Proportion candidate has no shared presentation sampler.";
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame: candidateFrame,
		artboardId,
		grammar,
	});
	const poses: InverseProportionCandidatePose[] = [];
	for (const nodeId of [input.driverNodeId, input.followerNodeId]) {
		const node = findNode(input.scene, nodeId);
		const sampled = presentation.values.find(
			(value) => value.nodeId === nodeId,
		);
		const radius = node ? circleRadius(node, sampled?.transform.scale) : null;
		if (!node || !sampled || radius === null) continue;
		poses.push({
			nodeId,
			position: sampled.transform.position,
			scale: sampled.transform.scale,
			uniformCircleRadius: radius,
		});
	}
	return poses;
};

/**
 * Compares the legacy/tangent relation modes against the complement and tangent
 * oracle. Only the explicit tangent mode can produce a structural ready packet.
 */
export function buildInverseProportionComparisonPacket(
	input: InverseProportionCandidateInput,
): InverseProportionComparisonPacket {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return blocked(
			"Inverse Proportion comparison requires exactly one binding object matching input.binding.",
		);
	}
	if (input.binding.techniqueId !== "inverse-proportion-link") {
		return blocked(
			"Inverse Proportion comparison requires the registered inverse-proportion-link expression.",
		);
	}
	if (
		!input.binding.targetIds.includes(input.driverNodeId) ||
		!input.binding.targetIds.includes(input.followerNodeId)
	) {
		return blocked(
			"Inverse Proportion driver and follower must both belong to the binding target set.",
		);
	}
	if (input.binding.targetIds.length !== 2) {
		return blocked(
			"Tangent-anchor Inverse Proportion requires exactly one driver and one follower target.",
		);
	}
	if (
		mappedRoleNodeId(input.binding, [
			"driver",
			"inverse-proportion-link:driver",
		]) !== input.driverNodeId ||
		mappedRoleNodeId(input.binding, [
			"follower",
			"inverse-proportion-link:follower",
		]) !== input.followerNodeId
	) {
		return blocked(
			"Tangent-anchor Inverse Proportion requires explicit driver and follower role mappings.",
		);
	}
	const driver = findNode(input.scene, input.driverNodeId);
	const follower = findNode(input.scene, input.followerNodeId);
	if (!driver || !follower)
		return blocked(
			"Inverse Proportion roles must resolve to existing scene nodes.",
		);
	if (circleRadius(driver) === null || circleRadius(follower) === null) {
		return blocked(
			"Inverse Proportion admission initially requires two uniformly scaled true circles.",
		);
	}
	const driverArtboardId = selectArtboardIdForNode(input.scene, driver.id);
	const followerArtboardId = selectArtboardIdForNode(input.scene, follower.id);
	if (!driverArtboardId || driverArtboardId !== followerArtboardId) {
		return blocked("Inverse Proportion roles must resolve to one artboard.");
	}
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== driverArtboardId
	) {
		return blocked(
			"Inverse Proportion artboard must match both relation roles.",
		);
	}
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === driverArtboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return blocked(
			"Inverse Proportion comparison requires an explicit screen_2d camera-space policy.",
		);
	}
	const critical = inverseProportionReferenceCriticalFrames(input.source);
	if (critical.status === "blocked") return blocked(critical.reason);
	const frames: InverseProportionComparisonFrame[] = [];
	for (const frame of critical.samples) {
		const reference = sampleInverseProportionReference(
			input.source,
			frame.frame,
		);
		if (reference.status === "blocked") return blocked(reference.reason);
		const referenceSample = reference.samples[0];
		if (!referenceSample)
			return blocked(
				"Inverse Proportion oracle returned no critical-frame sample.",
			);
		const candidate = candidatePoseAt(input, frame.frame, driverArtboardId);
		if (typeof candidate === "string") return blocked(candidate);
		frames.push({
			id: frame.id,
			purpose: frame.purpose,
			sourceFrame: frame.frame,
			reference: referenceSample,
			candidatePoses: candidate,
		});
	}
	const mode = input.binding.parameters.mode;
	const candidateAxis = {
		x: input.binding.parameters.axisX ?? Number.NaN,
		y: input.binding.parameters.axisY ?? Number.NaN,
	};
	const candidateAxisLength = Math.hypot(candidateAxis.x, candidateAxis.y);
	const sourceAxisLength = Math.hypot(input.source.axis.x, input.source.axis.y);
	const axisMatches =
		candidateAxisLength > 1e-8 &&
		sourceAxisLength > 1e-8 &&
		Math.abs(
			candidateAxis.x / candidateAxisLength -
				input.source.axis.x / sourceAxisLength,
		) <= 1e-4 &&
		Math.abs(
			candidateAxis.y / candidateAxisLength -
				input.source.axis.y / sourceAxisLength,
		) <= 1e-4;
	const sourceParametersMatch =
		mode !== undefined &&
		mode >= 0.5 &&
		Math.abs(
			(input.binding.parameters.anchorX ?? Number.NaN) - input.source.anchor.x,
		) <= 1e-4 &&
		Math.abs(
			(input.binding.parameters.anchorY ?? Number.NaN) - input.source.anchor.y,
		) <= 1e-4 &&
		axisMatches &&
		Math.abs(
			(input.binding.parameters.radiusSum ?? Number.NaN) -
				input.source.radiusSum,
		) <= 1e-4 &&
		Math.abs(
			(input.binding.parameters.clearance ?? Number.NaN) -
				input.source.clearance,
		) <= 1e-4 &&
		Math.abs((input.binding.parameters.strength ?? Number.NaN) - 1) <= 1e-4;
	const driverFollowerPositionsMatch = frames.every((frame) => {
		const driver = frame.candidatePoses.find(
			(pose) => pose.nodeId === input.driverNodeId,
		);
		const follower = frame.candidatePoses.find(
			(pose) => pose.nodeId === input.followerNodeId,
		);
		return Boolean(
			driver &&
				follower &&
				Math.abs(driver.position.x - frame.reference.driverCenter.x) <= 1e-4 &&
				Math.abs(driver.position.y - frame.reference.driverCenter.y) <= 1e-4 &&
				Math.abs(follower.position.x - frame.reference.followerCenter.x) <=
					1e-4 &&
				Math.abs(follower.position.y - frame.reference.followerCenter.y) <=
					1e-4 &&
				Math.abs(driver.uniformCircleRadius - frame.reference.driverRadius) <=
					1e-4 &&
				Math.abs(
					follower.uniformCircleRadius - frame.reference.followerRadius,
				) <= 1e-4,
		);
	});
	if (sourceParametersMatch && driverFollowerPositionsMatch) {
		return {
			status: "ready",
			candidateSurface: INVERSE_PROPORTION_CANDIDATE_SURFACE,
			frames,
			surfaces: surfaces(),
		};
	}
	const gaps: string[] = [];
	if (!sourceParametersMatch)
		gaps.push(
			"tangent-anchor mode, anchor/axis, radiusSum, clearance, or full-strength parameters do not match the source relation input",
		);
	if (!driverFollowerPositionsMatch)
		gaps.push(
			"driver/follower centers or circle radii do not match the complement/tangent oracle at every critical frame",
		);
	return {
		status: "incompatible",
		candidateSurface: INVERSE_PROPORTION_CANDIDATE_SURFACE,
		frames,
		gaps,
		surfaces: surfaces(),
	};
}
