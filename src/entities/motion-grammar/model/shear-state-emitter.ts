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
	SHEAR_SPLIT_DISTANCE_DEFAULT,
	SHEAR_SPLIT_PERIOD_DEFAULT,
	SHEAR_SPLIT_ROTATION_DEFAULT,
} from "./catalog";
import type {
	MotionGrammarDecompositionIssue,
	MotionGrammarDecompositionPlan,
	MotionGrammarEditableArtifactPlan,
} from "./decomposition";
import type { MotionGrammarBinding } from "./types";

/** Severity for shear-state artifact materialization diagnostics. */
export type MotionGrammarShearStateEmissionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes reported while expanding shear-state artifacts. */
export type MotionGrammarShearStateEmissionIssueCode =
	| "binding-plan-mismatch"
	| "decomposition-issue"
	| "empty-shear-state-plan"
	| "unsupported-technique"
	| "target-node-missing"
	| "shear-value-non-finite";

/** Diagnostic emitted while turning shear artifacts into numeric automation. */
export type MotionGrammarShearStateEmissionIssue = {
	readonly code: MotionGrammarShearStateEmissionIssueCode;
	readonly severity: MotionGrammarShearStateEmissionIssueSeverity;
	readonly message: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly artifactIdSeed?: string;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly path?: string;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
};

/** Inputs required to materialize shear-state artifact outputs. */
export type EmitMotionGrammarShearStateInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
};

/**
 * Pure shear-state emission result. The visible bake is already ordinary
 * translate/rotate tracks; these transform automation tracks preserve the
 * authorable shear/split state as editable numeric metadata.
 */
export type MotionGrammarShearStateEmission = {
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly automationTracks: readonly AutomationTrack[];
	readonly emittedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly skippedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly issues: readonly MotionGrammarShearStateEmissionIssue[];
};

type ShearStateSample = {
	readonly phase: number;
	readonly rank: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly counterRotationDeg: number;
	readonly shearX: number;
};

type ShearStateTrackSpec = {
	readonly path:
		| "shear.phase"
		| "shear.rank"
		| "shear.offsetX"
		| "shear.offsetY"
		| "shear.counterRotationDeg"
		| "shear.matrix.c";
	readonly value: (sample: ShearStateSample) => number;
};

const SHEAR_TRACK_SPECS: readonly ShearStateTrackSpec[] = [
	{ path: "shear.phase", value: (sample) => sample.phase },
	{ path: "shear.rank", value: (sample) => sample.rank },
	{ path: "shear.offsetX", value: (sample) => sample.offsetX },
	{ path: "shear.offsetY", value: (sample) => sample.offsetY },
	{
		path: "shear.counterRotationDeg",
		value: (sample) => sample.counterRotationDeg,
	},
	{ path: "shear.matrix.c", value: (sample) => sample.shearX },
];

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
	readonly code: MotionGrammarShearStateEmissionIssueCode;
	readonly severity: MotionGrammarShearStateEmissionIssueSeverity;
	readonly message: string;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan?: MotionGrammarEditableArtifactPlan;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly path?: string;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
}): MotionGrammarShearStateEmissionIssue => ({
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
): MotionGrammarShearStateEmissionIssue =>
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
	issue.outputKind === "editable-artifact" && issue.channel === "shear-matrix";

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
	readonly issues: MotionGrammarShearStateEmissionIssue[];
}): readonly string[] => {
	const nodeIds: string[] = [];
	for (const target of artifactPlan.targets) {
		if (target.kind !== "existing-scene-node") continue;
		if (!nodes.has(target.nodeId)) {
			issues.push(
				issueForArtifact({
					code: "target-node-missing",
					severity: "error",
					message: `Shear-state target "${target.nodeId}" is not present in the scene document.`,
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

const rankForNode = (binding: MotionGrammarBinding, nodeId: string): number => {
	if (binding.targetIds.length === 1) return 1;
	const index = binding.targetIds.indexOf(nodeId);
	const center = (binding.targetIds.length - 1) / 2;
	const maxDistanceFromCenter = center === 0 ? 1 : center;
	return ((index < 0 ? 0 : index) - center) / maxDistanceFromCenter;
};

const shearStateSample = ({
	binding,
	nodeId,
	frame,
}: {
	readonly binding: MotionGrammarBinding;
	readonly nodeId: string;
	readonly frame: number;
}): ShearStateSample => {
	const period = positiveParam(
		binding,
		"periodFrames",
		SHEAR_SPLIT_PERIOD_DEFAULT,
	);
	const splitDistance = finiteParam(
		binding,
		"splitDistance",
		SHEAR_SPLIT_DISTANCE_DEFAULT,
	);
	const rotationDegrees = finiteParam(
		binding,
		"rotationDegrees",
		SHEAR_SPLIT_ROTATION_DEFAULT,
	);
	const phase = Math.sin((wrap(frame, period) / period) * Math.PI);
	const rank = rankForNode(binding, nodeId);
	const offsetX = rank * splitDistance * phase;
	const offsetY = Math.abs(rank) * splitDistance * 0.12 * phase;
	const counterRotationDeg = rank * rotationDegrees * phase;
	const shearX = rank * phase;
	return { phase, rank, offsetX, offsetY, counterRotationDeg, shearX };
};

const shearStateTrack = ({
	spec,
	artifactPlan,
	binding,
	nodeId,
}: {
	readonly spec: ShearStateTrackSpec;
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
		value: spec.value(shearStateSample({ binding, nodeId, frame })),
		easing: "linear",
	})),
});

const hasNonFiniteKeyframes = (track: AutomationTrack): boolean =>
	track.keyframes.some(
		(keyframe) =>
			!Number.isFinite(keyframe.frame) || !Number.isFinite(keyframe.value),
	);

/**
 * Converts `shear-state` editable artifacts into object-scoped transform
 * automation tracks. The current renderer continues to use scalar translate and
 * rotation tracks; these tracks keep the decomposed shear/split intent editable.
 */
export function emitMotionGrammarShearState({
	plan,
	binding,
	scene,
}: EmitMotionGrammarShearStateInput): MotionGrammarShearStateEmission {
	const issues: MotionGrammarShearStateEmissionIssue[] = plan.issues
		.filter(shouldCarryDecompositionIssue)
		.map((issue) => decompositionIssueForResult(binding, issue));
	const artifactPlans = plan.outputs.filter(
		(output): output is MotionGrammarEditableArtifactPlan =>
			output.kind === "editable-artifact" &&
			output.artifactKind === "shear-state",
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
					"Shear-state emitter input binding does not match the decomposition plan.",
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
				code: "empty-shear-state-plan",
				severity: "info",
				message: "Decomposition plan contains no shear-state artifacts.",
				binding,
			}),
		);
	}

	if (binding.techniqueId !== "shear-split") {
		if (artifactPlans.length > 0) {
			issues.push(
				issueForArtifact({
					code: "unsupported-technique",
					severity: "error",
					message:
						"Shear-state artifacts can only be materialized for shear-split.",
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
			for (const spec of SHEAR_TRACK_SPECS) {
				const track = shearStateTrack({ spec, artifactPlan, binding, nodeId });
				if (hasNonFiniteKeyframes(track)) {
					issues.push(
						issueForArtifact({
							code: "shear-value-non-finite",
							severity: "error",
							message:
								"Shear-state emitter produced a non-finite automation keyframe value.",
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
 * Creates a motion command that upserts shear-state transform automation into
 * the motion side-car. Re-bakes replace tracks addressing the same object/path,
 * so shear metadata stays deterministic.
 */
export function createApplyMotionGrammarShearStateCommand(
	emission: MotionGrammarShearStateEmission,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	return {
		type: "motion/apply-motion-grammar-shear-state",
		label: options.label ?? "Create editable shear state",
		coalesceKey:
			options.coalesceKey ??
			`motion/apply-motion-grammar-shear-state:${emission.bindingId}`,
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
