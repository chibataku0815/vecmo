import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import { effectiveTransform } from "@/entities/motion/model/sampler";
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
import { BOOLEAN_DIFFERENCE_ROTATION_STRENGTH_DEFAULT } from "./catalog";
import type {
	MotionGrammarDecompositionIssue,
	MotionGrammarDecompositionPlan,
	MotionGrammarEditableArtifactPlan,
} from "./decomposition";
import type { MotionGrammarBinding } from "./types";

/** Severity for boolean-geometry artifact materialization diagnostics. */
export type MotionGrammarBooleanGeometryEmissionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes reported while expanding boolean-geometry artifacts. */
export type MotionGrammarBooleanGeometryEmissionIssueCode =
	| "binding-plan-mismatch"
	| "decomposition-issue"
	| "empty-boolean-geometry-plan"
	| "unsupported-technique"
	| "driver-node-missing"
	| "target-node-missing"
	| "boolean-relation-degenerate"
	| "boolean-value-non-finite";

/** Diagnostic emitted while turning boolean artifacts into numeric automation. */
export type MotionGrammarBooleanGeometryEmissionIssue = {
	readonly code: MotionGrammarBooleanGeometryEmissionIssueCode;
	readonly severity: MotionGrammarBooleanGeometryEmissionIssueSeverity;
	readonly message: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly artifactIdSeed?: string;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly path?: string;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
};

/** Inputs required to materialize boolean-geometry artifact outputs. */
export type EmitMotionGrammarBooleanGeometryInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
};

/**
 * Pure boolean-geometry emission result. The renderer currently represents
 * boolean difference as follower rotation; these object-scoped metadata tracks
 * preserve the sampled relation geometry so the artifact can be decomposed and
 * edited independently of the original grammar binding.
 */
export type MotionGrammarBooleanGeometryEmission = {
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly automationTracks: readonly AutomationTrack[];
	readonly emittedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly skippedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly issues: readonly MotionGrammarBooleanGeometryEmissionIssue[];
};

type BooleanGeometrySample = {
	readonly operation: number;
	readonly strength: number;
	readonly restAngleDeg: number;
	readonly currentAngleDeg: number;
	readonly angleDeltaDeg: number;
	readonly rotationDeg: number;
	readonly restDistance: number;
	readonly currentDistance: number;
};

type BooleanGeometryTrackSpec = {
	readonly path:
		| "boolean.operation"
		| "boolean.strength"
		| "boolean.restAngleDeg"
		| "boolean.currentAngleDeg"
		| "boolean.angleDeltaDeg"
		| "boolean.rotationDeg"
		| "boolean.restDistance"
		| "boolean.currentDistance";
	readonly value: (sample: BooleanGeometrySample) => number;
};

const BOOLEAN_OPERATION_DIFFERENCE = 1;
const RELATIONAL_EPSILON = 0.001;
const DRIVER_ROLE_ALIASES = ["driver", "lead", "leader", "source"] as const;
const FOLLOWER_ROLE_ALIASES = [
	"follower",
	"follow",
	"paired",
	"pair",
	"mirror",
	"target",
] as const;

const BOOLEAN_GEOMETRY_TRACK_SPECS: readonly BooleanGeometryTrackSpec[] = [
	{ path: "boolean.operation", value: (sample) => sample.operation },
	{ path: "boolean.strength", value: (sample) => sample.strength },
	{ path: "boolean.restAngleDeg", value: (sample) => sample.restAngleDeg },
	{
		path: "boolean.currentAngleDeg",
		value: (sample) => sample.currentAngleDeg,
	},
	{ path: "boolean.angleDeltaDeg", value: (sample) => sample.angleDeltaDeg },
	{ path: "boolean.rotationDeg", value: (sample) => sample.rotationDeg },
	{ path: "boolean.restDistance", value: (sample) => sample.restDistance },
	{
		path: "boolean.currentDistance",
		value: (sample) => sample.currentDistance,
	},
];

const wrap = (value: number, period: number): number => {
	if (!(period > 0)) return value;
	return ((value % period) + period) % period;
};

const degrees = (radians: number): number => (radians * 180) / Math.PI;

const normalizeDegrees = (value: number): number =>
	wrap(value + 180, 360) - 180;

const finiteParam = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const createNodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> =>
	new Map(allNodes(scene).map((node) => [node.id, node]));

const roleTargetId = (
	binding: MotionGrammarBinding,
	roles: readonly string[],
): string | undefined => {
	if (!binding.roleMap) return undefined;
	const targetSet = new Set(binding.targetIds);
	for (const role of roles) {
		const direct = binding.roleMap[role];
		if (direct && targetSet.has(direct)) return direct;
	}
	for (const role of roles) {
		const reverse = binding.targetIds.find(
			(targetId) => binding.roleMap?.[targetId] === role,
		);
		if (reverse) return reverse;
	}
	return undefined;
};

const relationalTargetIds = (
	binding: MotionGrammarBinding,
): readonly string[] => {
	const ordered: string[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string | undefined): void => {
		if (!nodeId || seen.has(nodeId) || !binding.targetIds.includes(nodeId)) {
			return;
		}
		seen.add(nodeId);
		ordered.push(nodeId);
	};
	add(roleTargetId(binding, DRIVER_ROLE_ALIASES) ?? binding.targetIds[0]);
	add(roleTargetId(binding, FOLLOWER_ROLE_ALIASES));
	for (const nodeId of binding.targetIds) add(nodeId);
	return ordered;
};

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
	readonly code: MotionGrammarBooleanGeometryEmissionIssueCode;
	readonly severity: MotionGrammarBooleanGeometryEmissionIssueSeverity;
	readonly message: string;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan?: MotionGrammarEditableArtifactPlan;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly path?: string;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
}): MotionGrammarBooleanGeometryEmissionIssue => ({
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
): MotionGrammarBooleanGeometryEmissionIssue =>
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
	issue.outputKind === "editable-artifact" &&
	issue.channel === "boolean-geometry";

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
	readonly issues: MotionGrammarBooleanGeometryEmissionIssue[];
}): readonly string[] => {
	const nodeIds: string[] = [];
	for (const target of artifactPlan.targets) {
		if (target.kind !== "existing-scene-node") continue;
		if (!nodes.has(target.nodeId)) {
			issues.push(
				issueForArtifact({
					code: "target-node-missing",
					severity: "error",
					message: `Boolean-geometry target "${target.nodeId}" is not present in the scene document.`,
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

const booleanGeometrySample = ({
	binding,
	nodes,
	motion,
	driverId,
	nodeId,
	frame,
}: {
	readonly binding: MotionGrammarBinding;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly motion: MotionDocument;
	readonly driverId: string;
	readonly nodeId: string;
	readonly frame: number;
}): BooleanGeometrySample | undefined => {
	const driver = nodes.get(driverId);
	const follower = nodes.get(nodeId);
	if (!driver || !follower) return undefined;

	const driverNow = effectiveTransform(driver, motion, frame);
	const followerNow = effectiveTransform(follower, motion, frame);
	const restVector = {
		x: follower.transform.position.x - driver.transform.position.x,
		y: follower.transform.position.y - driver.transform.position.y,
	};
	const currentVector = {
		x: followerNow.position.x - driverNow.position.x,
		y: followerNow.position.y - driverNow.position.y,
	};
	const restDistance = Math.hypot(restVector.x, restVector.y);
	const currentDistance = Math.hypot(currentVector.x, currentVector.y);
	if (
		restDistance < RELATIONAL_EPSILON ||
		currentDistance < RELATIONAL_EPSILON
	) {
		return undefined;
	}

	const strength = finiteParam(
		binding,
		"strength",
		BOOLEAN_DIFFERENCE_ROTATION_STRENGTH_DEFAULT,
	);
	const restAngleDeg = degrees(Math.atan2(restVector.y, restVector.x));
	const currentAngleDeg = degrees(Math.atan2(currentVector.y, currentVector.x));
	const angleDeltaDeg = normalizeDegrees(currentAngleDeg - restAngleDeg);
	return {
		operation: BOOLEAN_OPERATION_DIFFERENCE,
		strength,
		restAngleDeg,
		currentAngleDeg,
		angleDeltaDeg,
		rotationDeg: angleDeltaDeg * strength,
		restDistance,
		currentDistance,
	};
};

const booleanGeometryTrack = ({
	spec,
	artifactPlan,
	binding,
	nodes,
	motion,
	driverId,
	nodeId,
}: {
	readonly spec: BooleanGeometryTrackSpec;
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly binding: MotionGrammarBinding;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly motion: MotionDocument;
	readonly driverId: string;
	readonly nodeId: string;
}): AutomationTrack | undefined => {
	const keyframes = artifactPlan.sampleFrames.flatMap((frame) => {
		const sample = booleanGeometrySample({
			binding,
			nodes,
			motion,
			driverId,
			nodeId,
			frame,
		});
		return sample
			? [{ frame, value: spec.value(sample), easing: "linear" as const }]
			: [];
	});
	if (keyframes.length === 0) return undefined;
	return {
		binding: {
			channel: "transform",
			target: { scope: "object", id: nodeId },
			path: spec.path,
		},
		mode: "replace",
		keyframes,
	};
};

const hasNonFiniteKeyframes = (track: AutomationTrack): boolean =>
	track.keyframes.some(
		(keyframe) =>
			!Number.isFinite(keyframe.frame) || !Number.isFinite(keyframe.value),
	);

/**
 * Converts `boolean-geometry-state` editable artifacts into object-scoped
 * transform automation tracks. Visible motion remains the existing scalar
 * rotation bake; the automation payload keeps the relation geometry editable.
 */
export function emitMotionGrammarBooleanGeometry({
	plan,
	binding,
	scene,
	motion,
}: EmitMotionGrammarBooleanGeometryInput): MotionGrammarBooleanGeometryEmission {
	const issues: MotionGrammarBooleanGeometryEmissionIssue[] = plan.issues
		.filter(shouldCarryDecompositionIssue)
		.map((issue) => decompositionIssueForResult(binding, issue));
	const artifactPlans = plan.outputs.filter(
		(output): output is MotionGrammarEditableArtifactPlan =>
			output.kind === "editable-artifact" &&
			output.artifactKind === "boolean-geometry-state",
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
					"Boolean-geometry emitter input binding does not match the decomposition plan.",
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
				code: "empty-boolean-geometry-plan",
				severity: "info",
				message: "Decomposition plan contains no boolean-geometry artifacts.",
				binding,
			}),
		);
	}

	if (binding.techniqueId !== "boolean-difference-rotation") {
		if (artifactPlans.length > 0) {
			issues.push(
				issueForArtifact({
					code: "unsupported-technique",
					severity: "error",
					message:
						"Boolean-geometry artifacts can only be materialized for boolean-difference-rotation.",
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
	const [driverId] = relationalTargetIds(binding);
	if (!driverId || !nodes.has(driverId)) {
		issues.push(
			issueForArtifact({
				code: "driver-node-missing",
				severity: "error",
				message:
					"Boolean-geometry emitter cannot resolve the relation driver node.",
				binding,
				nodeId: driverId,
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
			const hasSample = artifactPlan.sampleFrames.some((frame) =>
				Boolean(
					booleanGeometrySample({
						binding,
						nodes,
						motion,
						driverId,
						nodeId,
						frame,
					}),
				),
			);
			if (!hasSample) {
				issues.push(
					issueForArtifact({
						code: "boolean-relation-degenerate",
						severity: "warning",
						message:
							"Boolean-geometry relation has no non-degenerate driver/follower vector in the sampled range.",
						binding,
						artifactPlan,
						nodeId,
					}),
				);
				continue;
			}

			for (const spec of BOOLEAN_GEOMETRY_TRACK_SPECS) {
				const track = booleanGeometryTrack({
					spec,
					artifactPlan,
					binding,
					nodes,
					motion,
					driverId,
					nodeId,
				});
				if (!track) continue;
				if (hasNonFiniteKeyframes(track)) {
					issues.push(
						issueForArtifact({
							code: "boolean-value-non-finite",
							severity: "error",
							message:
								"Boolean-geometry emitter produced a non-finite automation keyframe value.",
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
 * Creates a motion command that upserts boolean-geometry transform automation
 * into the motion side-car. Re-bakes replace tracks addressing the same
 * object/path, so relation metadata remains deterministic.
 */
export function createApplyMotionGrammarBooleanGeometryCommand(
	emission: MotionGrammarBooleanGeometryEmission,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	return {
		type: "motion/apply-motion-grammar-boolean-geometry",
		label: options.label ?? "Create editable boolean geometry",
		coalesceKey:
			options.coalesceKey ??
			`motion/apply-motion-grammar-boolean-geometry:${emission.bindingId}`,
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
