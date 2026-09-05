import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import type { MotionDocument } from "@/entities/motion/model/types";
import { allNodes } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type {
	AutomationBinding,
	AutomationRecipe,
	AutomationTrack,
	EffectTargetRef,
} from "@/shared/vec-core";
import { normalizeAutomationRecipe } from "@/shared/vec-core";
import {
	PLANAR_TUMBLE_MIN_PROJECTION_DEFAULT,
	PLANAR_TUMBLE_PERIOD_DEFAULT,
	PLANAR_TUMBLE_PHASE_STAGGER_DEFAULT,
} from "./catalog";
import type {
	MotionGrammarDecompositionIssue,
	MotionGrammarDecompositionPlan,
	MotionGrammarEditableArtifactPlan,
} from "./decomposition";
import type { MotionGrammarBinding } from "./types";

/** Severity for projected-pose artifact materialization diagnostics. */
export type MotionGrammarProjectionPoseEmissionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes reported while expanding projected-pose artifacts. */
export type MotionGrammarProjectionPoseEmissionIssueCode =
	| "binding-plan-mismatch"
	| "decomposition-issue"
	| "empty-projection-pose-plan"
	| "unsupported-technique"
	| "target-node-missing"
	| "projection-value-non-finite";

/** Diagnostic emitted while turning projection artifacts into numeric automation. */
export type MotionGrammarProjectionPoseEmissionIssue = {
	readonly code: MotionGrammarProjectionPoseEmissionIssueCode;
	readonly severity: MotionGrammarProjectionPoseEmissionIssueSeverity;
	readonly message: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly artifactIdSeed?: string;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly path?: string;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
};

/** Inputs required to materialize projected-pose artifact outputs. */
export type EmitMotionGrammarProjectionPoseInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
};

/**
 * Pure projection-pose emission result. The tracks are intentionally stored as
 * vec-core transform automation metadata: planar tumble is already rendered by
 * ordinary rotation/scale tracks, while these tracks preserve the editable
 * depth/side-on state for future projection-aware controls.
 */
export type MotionGrammarProjectionPoseEmission = {
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly automationTracks: readonly AutomationTrack[];
	readonly emittedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly skippedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly issues: readonly MotionGrammarProjectionPoseEmissionIssue[];
};

type ProjectionPoseSample = {
	readonly depth: number;
	readonly sideOn: number;
	readonly widthFactor: number;
};

type ProjectionPoseTrackSpec = {
	readonly path:
		| "projection.depth"
		| "projection.sideOn"
		| "projection.widthFactor";
	readonly value: (sample: ProjectionPoseSample) => number;
};

const TAU = Math.PI * 2;

const PROJECTION_TRACK_SPECS: readonly ProjectionPoseTrackSpec[] = [
	{ path: "projection.depth", value: (sample) => sample.depth },
	{ path: "projection.sideOn", value: (sample) => sample.sideOn },
	{ path: "projection.widthFactor", value: (sample) => sample.widthFactor },
];

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const wrap = (value: number, period: number): number => {
	if (!(period > 0)) return value;
	return ((value % period) + period) % period;
};

const finiteParam = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const positiveParam = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = finiteParam(binding, key, fallback);
	return value > 0 ? value : fallback;
};

const createNodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> =>
	new Map(allNodes(scene).map((node) => [node.id, node]));

const issueForArtifact = ({
	code,
	severity,
	message,
	binding,
	artifactPlan,
	nodeId,
	frame,
	path,
	decompositionIssue,
}: {
	readonly code: MotionGrammarProjectionPoseEmissionIssueCode;
	readonly severity: MotionGrammarProjectionPoseEmissionIssueSeverity;
	readonly message: string;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan?: MotionGrammarEditableArtifactPlan;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly path?: string;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
}): MotionGrammarProjectionPoseEmissionIssue => ({
	code,
	severity,
	message,
	bindingId: binding.id,
	techniqueId: binding.techniqueId,
	...(artifactPlan ? { artifactIdSeed: artifactPlan.idSeed } : {}),
	...(nodeId ? { nodeId } : {}),
	...(frame === undefined ? {} : { frame }),
	...(path ? { path } : {}),
	...(decompositionIssue ? { decompositionIssue } : {}),
});

const decompositionIssueForResult = (
	binding: MotionGrammarBinding,
	issue: MotionGrammarDecompositionIssue,
): MotionGrammarProjectionPoseEmissionIssue =>
	issueForArtifact({
		code: "decomposition-issue",
		severity: issue.severity,
		message: issue.message,
		binding,
		decompositionIssue: issue,
	});

const shouldCarryDecompositionIssue = (
	issue: MotionGrammarDecompositionIssue,
): boolean =>
	issue.outputKind === "editable-artifact" && issue.channel === "true-3d-depth";

const automationTargetKey = (target: EffectTargetRef): string =>
	target.id ? `${target.scope}:${target.id}` : target.scope;

const automationBindingKey = (binding: AutomationBinding): string => {
	switch (binding.channel) {
		case "effectInfluence":
			return `effectInfluence:${binding.assignmentId}:${binding.path}`;
		case "effectParam":
			return `effectParam:${automationTargetKey(binding.target)}:${binding.effect.id}:${binding.effect.path}:${binding.path}`;
		case "transform":
			return `transform:${automationTargetKey(binding.target)}:${binding.path}`;
	}
};

const resolveExistingArtifactNodeIds = ({
	artifactPlan,
	nodes,
	binding,
	issues,
}: {
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly binding: MotionGrammarBinding;
	readonly issues: MotionGrammarProjectionPoseEmissionIssue[];
}): readonly string[] => {
	const nodeIds: string[] = [];
	for (const target of artifactPlan.targets) {
		if (target.kind !== "existing-scene-node") continue;
		if (!nodes.has(target.nodeId)) {
			issues.push(
				issueForArtifact({
					code: "target-node-missing",
					severity: "error",
					message: `Projection-pose target "${target.nodeId}" is not present in the scene document.`,
					binding,
					artifactPlan,
					nodeId: target.nodeId,
				}),
			);
			continue;
		}
		nodeIds.push(target.nodeId);
	}
	return nodeIds;
};

const projectionPoseSample = ({
	binding,
	nodeId,
	frame,
}: {
	readonly binding: MotionGrammarBinding;
	readonly nodeId: string;
	readonly frame: number;
}): ProjectionPoseSample => {
	const period = positiveParam(
		binding,
		"periodFrames",
		PLANAR_TUMBLE_PERIOD_DEFAULT,
	);
	const phaseStagger = finiteParam(
		binding,
		"phaseStaggerFrames",
		PLANAR_TUMBLE_PHASE_STAGGER_DEFAULT,
	);
	const minProjection = clamp(
		finiteParam(binding, "minProjection", PLANAR_TUMBLE_MIN_PROJECTION_DEFAULT),
		0.05,
		1,
	);
	const targetIndex = Math.max(0, binding.targetIds.indexOf(nodeId));
	const angle =
		(wrap(frame + targetIndex * phaseStagger, period) / period) * TAU;
	const depth = Math.sin(angle);
	const sideOn = Math.abs(depth);
	const widthFactor =
		minProjection + (1 - minProjection) * Math.abs(Math.cos(angle));
	return { depth, sideOn, widthFactor };
};

const projectionPoseTrack = ({
	spec,
	artifactPlan,
	binding,
	nodeId,
}: {
	readonly spec: ProjectionPoseTrackSpec;
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly binding: MotionGrammarBinding;
	readonly nodeId: string;
}): AutomationTrack => ({
	binding: {
		channel: "transform",
		target: { scope: "object", id: nodeId },
		path: spec.path,
	},
	mode: "replace",
	keyframes: artifactPlan.sampleFrames.map((frame) => ({
		frame,
		value: spec.value(projectionPoseSample({ binding, nodeId, frame })),
		easing: "linear",
	})),
});

const hasNonFiniteKeyframes = (track: AutomationTrack): boolean =>
	track.keyframes.some(
		(keyframe) =>
			!Number.isFinite(keyframe.frame) || !Number.isFinite(keyframe.value),
	);

/**
 * Converts `projection-pose-state` editable artifacts into object-scoped
 * transform automation tracks. The current renderer continues to use the
 * already-baked scalar scale/rotation tracks; these numeric pose tracks preserve
 * the decomposed 3D-projection intent as editable data instead of leaving a
 * provenance-only artifact.
 */
export function emitMotionGrammarProjectionPose({
	plan,
	binding,
	scene,
}: EmitMotionGrammarProjectionPoseInput): MotionGrammarProjectionPoseEmission {
	const issues: MotionGrammarProjectionPoseEmissionIssue[] = plan.issues
		.filter(shouldCarryDecompositionIssue)
		.map((issue) => decompositionIssueForResult(binding, issue));
	const artifactPlans = plan.outputs.filter(
		(output): output is MotionGrammarEditableArtifactPlan =>
			output.kind === "editable-artifact" &&
			output.artifactKind === "projection-pose-state",
	);

	if (
		plan.bindingId !== binding.id ||
		plan.techniqueId !== binding.techniqueId
	) {
		issues.push(
			issueForArtifact({
				code: "binding-plan-mismatch",
				severity: "error",
				message:
					"Projection-pose emitter input binding does not match the decomposition plan.",
				binding,
			}),
		);
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			automationTracks: [],
			emittedArtifactPlans: [],
			skippedArtifactPlans: artifactPlans,
			issues,
		};
	}

	if (artifactPlans.length === 0) {
		issues.push(
			issueForArtifact({
				code: "empty-projection-pose-plan",
				severity: "info",
				message: "Decomposition plan contains no projection-pose artifacts.",
				binding,
			}),
		);
	}

	if (binding.techniqueId !== "planar-solid-tumble") {
		if (artifactPlans.length > 0) {
			issues.push(
				issueForArtifact({
					code: "unsupported-technique",
					severity: "error",
					message:
						"Projection-pose artifacts can only be materialized for planar-solid-tumble.",
					binding,
				}),
			);
		}
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			automationTracks: [],
			emittedArtifactPlans: [],
			skippedArtifactPlans: artifactPlans,
			issues,
		};
	}

	const nodes = createNodeMap(scene);
	const automationTracks: AutomationTrack[] = [];
	const emittedArtifactPlans: MotionGrammarEditableArtifactPlan[] = [];
	const skippedArtifactPlans: MotionGrammarEditableArtifactPlan[] = [];

	for (const artifactPlan of artifactPlans) {
		const nodeIds = resolveExistingArtifactNodeIds({
			artifactPlan,
			nodes,
			binding,
			issues,
		});
		if (nodeIds.length === 0) {
			skippedArtifactPlans.push(artifactPlan);
			continue;
		}

		let emitted = false;
		for (const nodeId of nodeIds) {
			for (const spec of PROJECTION_TRACK_SPECS) {
				const track = projectionPoseTrack({
					spec,
					artifactPlan,
					binding,
					nodeId,
				});
				if (hasNonFiniteKeyframes(track)) {
					issues.push(
						issueForArtifact({
							code: "projection-value-non-finite",
							severity: "error",
							message:
								"Projection-pose emitter produced a non-finite automation keyframe value.",
							binding,
							artifactPlan,
							nodeId,
							path: spec.path,
						}),
					);
					continue;
				}
				automationTracks.push(track);
				emitted = true;
			}
		}
		if (emitted) {
			emittedArtifactPlans.push(artifactPlan);
		} else {
			skippedArtifactPlans.push(artifactPlan);
		}
	}

	return {
		bindingId: plan.bindingId,
		techniqueId: plan.techniqueId,
		automationTracks,
		emittedArtifactPlans,
		skippedArtifactPlans,
		issues,
	};
}

/**
 * Creates a motion command that upserts projected-pose transform automation into
 * the motion side-car. Re-bakes replace tracks addressing the same object/path,
 * so projection metadata stays deterministic.
 */
export function createApplyMotionGrammarProjectionPoseCommand(
	emission: MotionGrammarProjectionPoseEmission,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	return {
		type: "motion/apply-motion-grammar-projection-pose",
		label: options.label ?? "Create editable projection pose",
		coalesceKey:
			options.coalesceKey ??
			`motion/apply-motion-grammar-projection-pose:${emission.bindingId}`,
		run: (draft) => {
			if (emission.automationTracks.length === 0) return;
			const replacementKeys = new Set(
				emission.automationTracks.map((track) =>
					automationBindingKey(track.binding),
				),
			);
			const existing = normalizeAutomationRecipe(
				draft.automation ?? {
					enabled: true,
					fps: draft.fps,
					durationFrames: draft.durationFrames,
					tracks: [],
				},
			);
			const tracks = [
				...existing.tracks.filter(
					(track) => !replacementKeys.has(automationBindingKey(track.binding)),
				),
				...emission.automationTracks,
			];
			const nextRecipe: AutomationRecipe = normalizeAutomationRecipe({
				enabled: true,
				fps: draft.fps,
				durationFrames: draft.durationFrames,
				tracks,
			});
			draft.automation = castDraft(nextRecipe);
		},
	};
}
