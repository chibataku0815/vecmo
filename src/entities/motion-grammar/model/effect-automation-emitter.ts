import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import type { GrammarFrameSample } from "@/entities/motion/model/grammar-bridge";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createUpdateEffectIntentCommand,
	type EffectIntentPatch,
} from "@/entities/scene/model/node-commands";
import { allNodes } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type {
	AutomationBinding,
	AutomationRecipe,
	AutomationTrack,
	EffectInfluenceAssignment,
	EffectInfluenceRecipe,
	EffectSlotRef,
	EffectTargetRef,
} from "@/shared/vec-core";
import {
	normalizeAutomationRecipe,
	normalizeEffectInfluence,
	normalizeEffectInfluenceRecipe,
	normalizeEffectSlotRef,
} from "@/shared/vec-core";
import type {
	MotionGrammarDecompositionIssue,
	MotionGrammarDecompositionPlan,
	MotionGrammarEditableArtifactPlan,
} from "./decomposition";
import { sampleGrammarFrame } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

/** Severity for effect automation artifact materialization diagnostics. */
export type MotionGrammarEffectAutomationEmissionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes reported while expanding effect artifacts. */
export type MotionGrammarEffectAutomationEmissionIssueCode =
	| "binding-plan-mismatch"
	| "decomposition-issue"
	| "empty-effect-automation-plan"
	| "effect-binding-none"
	| "effect-binding-temporal-echo"
	| "target-node-missing"
	| "automation-value-non-finite";

/** Diagnostic emitted while turning grammar effect artifacts into vec-core automation. */
export type MotionGrammarEffectAutomationEmissionIssue = {
	readonly code: MotionGrammarEffectAutomationEmissionIssueCode;
	readonly severity: MotionGrammarEffectAutomationEmissionIssueSeverity;
	readonly message: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly artifactIdSeed?: string;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
};

/** Inputs required to materialize one decomposition plan's effect automation artifacts. */
export type EmitMotionGrammarEffectAutomationInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
};

/**
 * Pure effect automation emission result. `automationTracks` are persisted under
 * `MotionDocument.automation`; `sceneCommands` install influence assignments the
 * automation tracks address by id.
 */
export type MotionGrammarEffectAutomationEmission = {
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly automationTracks: readonly AutomationTrack[];
	readonly influenceAssignments: readonly EffectInfluenceAssignment[];
	readonly sceneCommands: readonly SceneCommand[];
	readonly emittedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly skippedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly issues: readonly MotionGrammarEffectAutomationEmissionIssue[];
};

type NodeTargetEntry = {
	readonly nodeId: string;
	readonly target: EffectTargetRef;
};

type InfluenceTargetGroup = {
	readonly key: string;
	readonly target: EffectTargetRef;
	readonly nodeIds: readonly string[];
};

type GrammarFrameSampleCache = Map<number, GrammarFrameSample>;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

const finiteNumber = (value: number | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const issueForArtifact = ({
	code,
	severity,
	message,
	binding,
	artifactPlan,
	nodeId,
	frame,
	decompositionIssue,
}: {
	readonly code: MotionGrammarEffectAutomationEmissionIssueCode;
	readonly severity: MotionGrammarEffectAutomationEmissionIssueSeverity;
	readonly message: string;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan?: MotionGrammarEditableArtifactPlan;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
}): MotionGrammarEffectAutomationEmissionIssue => ({
	code,
	severity,
	message,
	bindingId: binding.id,
	techniqueId: binding.techniqueId,
	...(artifactPlan ? { artifactIdSeed: artifactPlan.idSeed } : {}),
	...(nodeId ? { nodeId } : {}),
	...(frame === undefined ? {} : { frame }),
	...(decompositionIssue ? { decompositionIssue } : {}),
});

const decompositionIssueForResult = (
	binding: MotionGrammarBinding,
	issue: MotionGrammarDecompositionIssue,
): MotionGrammarEffectAutomationEmissionIssue =>
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
	(issue.channel === "effect-automation" ||
		issue.channel === "active-target-influence" ||
		issue.channel === "temporal-echo");

const createNodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> =>
	new Map(allNodes(scene).map((node) => [node.id, node]));

const createNodeLayerMap = (
	scene: SceneDocument,
): ReadonlyMap<string, string> => {
	const entries: [string, string][] = [];
	for (const layer of scene.layers) {
		const visit = (nodes: readonly VectorNode[]): void => {
			for (const node of nodes) {
				entries.push([node.id, layer.id]);
				if (node.children) visit(node.children);
			}
		};
		visit(layer.nodes);
	}
	return new Map(entries);
};

const effectTargetKey = (target: EffectTargetRef): string =>
	target.id ? `${target.scope}:${target.id}` : target.scope;

const effectSlotKey = (effect: EffectSlotRef): string =>
	`${effect.id}:${effect.path}`;

const automationBindingKey = (binding: AutomationBinding): string => {
	switch (binding.channel) {
		case "effectInfluence":
			return `effectInfluence:${binding.assignmentId}:${binding.path}`;
		case "effectParam":
			return `effectParam:${effectTargetKey(binding.target)}:${effectSlotKey(
				binding.effect,
			)}:${binding.path}`;
		case "transform":
			return `transform:${effectTargetKey(binding.target)}:${binding.path}`;
	}
};

const grammarActivationAtFrame = (
	frameSample: GrammarFrameSample,
	nodeId: string,
	frame: number,
	durationFrames: number,
): number => {
	const sample = frameSample.samples.get(nodeId);
	if (!sample) return 0;
	const magnitudes: number[] = [];
	if (sample.opacityFactor !== undefined) {
		magnitudes.push(Math.abs(sample.opacityFactor - 1));
	}
	if (sample.scaleFactor) {
		magnitudes.push(
			Math.max(
				Math.abs(sample.scaleFactor.x - 1),
				Math.abs(sample.scaleFactor.y - 1),
			),
		);
	}
	if (sample.translate) {
		magnitudes.push(Math.hypot(sample.translate.x, sample.translate.y) / 100);
	}
	if (sample.rotate !== undefined) {
		magnitudes.push(Math.abs(sample.rotate) / 180);
	}
	if (sample.rotationOverride !== undefined) {
		magnitudes.push(Math.abs(sample.rotationOverride) / 180);
	}
	if (sample.sourceFrame !== undefined) {
		const sourceDelta = Math.abs(sample.sourceFrame - frame);
		magnitudes.push(
			sourceDelta > 0 ? sourceDelta / Math.max(1, durationFrames) : 1,
		);
	}
	return clamp01(Math.max(0, ...magnitudes));
};

const frameSampleFor = ({
	frame,
	cache,
	binding,
	scene,
	motion,
}: {
	readonly frame: number;
	readonly cache: GrammarFrameSampleCache;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
}): GrammarFrameSample => {
	const cached = cache.get(frame);
	if (cached) return cached;
	const sample = sampleGrammarFrame([binding], { scene, motion, frame });
	cache.set(frame, sample);
	return sample;
};

const averageActivation = ({
	nodeIds,
	artifactPlan,
	frame,
	cache,
	binding,
	scene,
	motion,
}: {
	readonly nodeIds: readonly string[];
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly frame: number;
	readonly cache: GrammarFrameSampleCache;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
}): number => {
	if (nodeIds.length === 0) return 0;
	const frameSample = frameSampleFor({ frame, cache, binding, scene, motion });
	const total = nodeIds.reduce(
		(sum, nodeId) =>
			sum +
			grammarActivationAtFrame(
				frameSample,
				nodeId,
				frame,
				artifactPlan.frameRange.endFrame - artifactPlan.frameRange.startFrame,
			),
		0,
	);
	return total / nodeIds.length;
};

const automationKeyframesForNodes = ({
	nodeIds,
	artifactPlan,
	cache,
	binding,
	scene,
	motion,
	scale = 1,
}: {
	readonly nodeIds: readonly string[];
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly cache: GrammarFrameSampleCache;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly scale?: number;
}): AutomationTrack["keyframes"] =>
	artifactPlan.sampleFrames.map((frame) => ({
		frame,
		value: clamp01(
			averageActivation({
				nodeIds,
				artifactPlan,
				frame,
				cache,
				binding,
				scene,
				motion,
			}) * scale,
		),
		easing: "linear",
	}));

const resolveExistingArtifactNodeIds = ({
	artifactPlan,
	nodes,
	binding,
	issues,
}: {
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly binding: MotionGrammarBinding;
	readonly issues: MotionGrammarEffectAutomationEmissionIssue[];
}): readonly string[] => {
	const nodeIds: string[] = [];
	for (const target of artifactPlan.targets) {
		if (target.kind !== "existing-scene-node") continue;
		if (!nodes.has(target.nodeId)) {
			issues.push(
				issueForArtifact({
					code: "target-node-missing",
					severity: "error",
					message: `Effect automation target "${target.nodeId}" is not present in the scene document.`,
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

const targetForNode = ({
	nodeId,
	targetScope,
	nodeLayerIds,
}: {
	readonly nodeId: string;
	readonly targetScope: EffectTargetRef["scope"] | undefined;
	readonly nodeLayerIds: ReadonlyMap<string, string>;
}): EffectTargetRef => {
	switch (targetScope ?? "object") {
		case "scene":
			return { scope: "scene" };
		case "selection":
			return { scope: "selection" };
		case "layer": {
			const layerId = nodeLayerIds.get(nodeId);
			return layerId
				? { scope: "layer", id: layerId }
				: { scope: "object", id: nodeId };
		}
		case "group":
			return { scope: "group", id: nodeId };
		case "object":
			return { scope: "object", id: nodeId };
	}
};

const influenceTargetGroups = (
	entries: readonly NodeTargetEntry[],
): readonly InfluenceTargetGroup[] => {
	const groups = new Map<
		string,
		{ target: EffectTargetRef; nodeIds: string[] }
	>();
	for (const entry of entries) {
		const key = effectTargetKey(entry.target);
		const group = groups.get(key) ?? { target: entry.target, nodeIds: [] };
		group.nodeIds.push(entry.nodeId);
		groups.set(key, group);
	}
	return [...groups.entries()].map(([key, group]) => ({
		key,
		target: group.target,
		nodeIds: group.nodeIds,
	}));
};

const upsertInfluenceAssignments = (
	recipe: EffectInfluenceRecipe | undefined,
	assignments: readonly EffectInfluenceAssignment[],
): EffectInfluenceRecipe => {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const replacementIds = new Set(
		assignments.map((assignment) => assignment.id),
	);
	return normalizeEffectInfluenceRecipe({
		enabled: true,
		assignments: [
			...normalized.assignments.filter(
				(assignment) => !replacementIds.has(assignment.id),
			),
			...assignments,
		],
	});
};

const emitEffectParamTrack = ({
	artifactPlan,
	nodeIds,
	binding,
	scene,
	motion,
	cache,
}: {
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly nodeIds: readonly string[];
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly cache: GrammarFrameSampleCache;
}): AutomationTrack | undefined => {
	const effectBinding = binding.effectBinding;
	if (effectBinding?.kind !== "automation-param") return undefined;
	return {
		binding: {
			channel: "effectParam",
			target: { scope: "scene" },
			effect: normalizeEffectSlotRef(effectBinding.effect),
			path: effectBinding.path,
		},
		mode: effectBinding.mode ?? "replace",
		keyframes: automationKeyframesForNodes({
			nodeIds,
			artifactPlan,
			cache,
			binding,
			scene,
			motion,
		}),
	};
};

const emitInfluenceTracks = ({
	artifactPlan,
	nodeIds,
	binding,
	scene,
	motion,
	cache,
	nodeLayerIds,
}: {
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly nodeIds: readonly string[];
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly cache: GrammarFrameSampleCache;
	readonly nodeLayerIds: ReadonlyMap<string, string>;
}): {
	readonly tracks: readonly AutomationTrack[];
	readonly assignments: readonly EffectInfluenceAssignment[];
} => {
	const effectBinding = binding.effectBinding;
	if (effectBinding?.kind !== "active-target-influence") {
		return { tracks: [], assignments: [] };
	}

	const effect = normalizeEffectSlotRef(effectBinding.effect);
	const groups = influenceTargetGroups(
		nodeIds.map((nodeId) => ({
			nodeId,
			target: targetForNode({
				nodeId,
				targetScope: effectBinding.targetScope,
				nodeLayerIds,
			}),
		})),
	);
	const assignments: EffectInfluenceAssignment[] = [];
	const tracks: AutomationTrack[] = [];
	const strength = finiteNumber(effectBinding.strength) ?? 1;

	for (const group of groups) {
		const assignmentId = `${artifactPlan.idSeed}:influence:${group.key}`;
		assignments.push({
			id: assignmentId,
			label: `${artifactPlan.provenance.techniqueLabel} influence`,
			target: group.target,
			effect,
			influence: normalizeEffectInfluence({
				enabled: true,
				strength: clamp01(strength),
			}),
		});
		tracks.push({
			binding: {
				channel: "effectInfluence",
				assignmentId,
				path: "strength",
			},
			mode: "replace",
			keyframes: automationKeyframesForNodes({
				nodeIds: group.nodeIds,
				artifactPlan,
				cache,
				binding,
				scene,
				motion,
				scale: strength,
			}),
		});
	}

	return { tracks, assignments };
};

const sceneCommandsForAssignments = ({
	scene,
	assignments,
	label,
	coalesceKey,
}: {
	readonly scene: SceneDocument;
	readonly assignments: readonly EffectInfluenceAssignment[];
	readonly label?: string;
	readonly coalesceKey?: string;
}): readonly SceneCommand[] => {
	if (assignments.length === 0) return [];
	const nextRecipe = upsertInfluenceAssignments(
		scene.effectIntent?.influenceRecipe,
		assignments,
	);
	const patch: EffectIntentPatch = { influenceRecipe: nextRecipe };
	return [
		createUpdateEffectIntentCommand({ scope: "scene" }, patch, {
			label,
			coalesceKey,
		}),
	];
};

const hasNonFiniteKeyframes = (track: AutomationTrack): boolean =>
	track.keyframes.some(
		(keyframe) =>
			!Number.isFinite(keyframe.frame) || !Number.isFinite(keyframe.value),
	);

/**
 * Converts `effect-automation` editable artifacts into vec-core automation. The
 * emitted data remains time-authorable: effect parameters live on
 * `MotionDocument.automation`, while influence assignments are scene intent
 * anchors addressed by automation binding ids.
 */
export function emitMotionGrammarEffectAutomation({
	plan,
	binding,
	scene,
	motion,
}: EmitMotionGrammarEffectAutomationInput): MotionGrammarEffectAutomationEmission {
	const issues: MotionGrammarEffectAutomationEmissionIssue[] = plan.issues
		.filter(shouldCarryDecompositionIssue)
		.map((issue) => decompositionIssueForResult(binding, issue));
	const artifactPlans = plan.outputs.filter(
		(output): output is MotionGrammarEditableArtifactPlan =>
			output.kind === "editable-artifact" &&
			output.artifactKind === "effect-automation",
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
					"Effect automation emitter input binding does not match the decomposition plan.",
				binding,
			}),
		);
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			automationTracks: [],
			influenceAssignments: [],
			sceneCommands: [],
			emittedArtifactPlans: [],
			skippedArtifactPlans: artifactPlans,
			issues,
		};
	}

	if (artifactPlans.length === 0) {
		issues.push(
			issueForArtifact({
				code: "empty-effect-automation-plan",
				severity: "info",
				message: "Decomposition plan contains no effect automation artifacts.",
				binding,
			}),
		);
	}

	const effectBinding = binding.effectBinding;
	if (!effectBinding || effectBinding.kind === "none") {
		if (artifactPlans.length > 0) {
			issues.push(
				issueForArtifact({
					code: "effect-binding-none",
					severity: "error",
					message:
						"Effect automation artifact exists, but the grammar binding has no effect binding.",
					binding,
				}),
			);
		}
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			automationTracks: [],
			influenceAssignments: [],
			sceneCommands: [],
			emittedArtifactPlans: [],
			skippedArtifactPlans: artifactPlans,
			issues,
		};
	}
	if (effectBinding.kind === "temporal-echo") {
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			automationTracks: [],
			influenceAssignments: [],
			sceneCommands: [],
			emittedArtifactPlans: [],
			skippedArtifactPlans: artifactPlans,
			issues: [
				...issues,
				issueForArtifact({
					code: "effect-binding-temporal-echo",
					severity: "info",
					message:
						"Temporal echo effect binding is represented by generated scene nodes, not vec-core automation tracks.",
					binding,
				}),
			],
		};
	}

	const nodes = createNodeMap(scene);
	const nodeLayerIds = createNodeLayerMap(scene);
	const cache: GrammarFrameSampleCache = new Map();
	const automationTracks: AutomationTrack[] = [];
	const influenceAssignments: EffectInfluenceAssignment[] = [];
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

		if (effectBinding.kind === "automation-param") {
			const track = emitEffectParamTrack({
				artifactPlan,
				nodeIds,
				binding,
				scene,
				motion,
				cache,
			});
			if (!track || hasNonFiniteKeyframes(track)) {
				issues.push(
					issueForArtifact({
						code: "automation-value-non-finite",
						severity: "error",
						message:
							"Effect parameter automation emitted a non-finite keyframe value.",
						binding,
						artifactPlan,
					}),
				);
				skippedArtifactPlans.push(artifactPlan);
				continue;
			}
			automationTracks.push(track);
			emittedArtifactPlans.push(artifactPlan);
			continue;
		}

		const influence = emitInfluenceTracks({
			artifactPlan,
			nodeIds,
			binding,
			scene,
			motion,
			cache,
			nodeLayerIds,
		});
		if (influence.tracks.some(hasNonFiniteKeyframes)) {
			issues.push(
				issueForArtifact({
					code: "automation-value-non-finite",
					severity: "error",
					message:
						"Effect influence automation emitted a non-finite keyframe value.",
					binding,
					artifactPlan,
				}),
			);
			skippedArtifactPlans.push(artifactPlan);
			continue;
		}
		automationTracks.push(...influence.tracks);
		influenceAssignments.push(...influence.assignments);
		emittedArtifactPlans.push(artifactPlan);
	}

	return {
		bindingId: plan.bindingId,
		techniqueId: plan.techniqueId,
		automationTracks,
		influenceAssignments,
		sceneCommands: sceneCommandsForAssignments({
			scene,
			assignments: influenceAssignments,
		}),
		emittedArtifactPlans,
		skippedArtifactPlans,
		issues,
	};
}

/**
 * Creates a motion command that upserts emitted vec-core automation tracks into
 * the `MotionDocument.automation` side-car. Re-bakes replace tracks that address
 * the same normalized binding so automation does not accumulate duplicates.
 */
export function createApplyMotionGrammarEffectAutomationCommand(
	emission: MotionGrammarEffectAutomationEmission,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	return {
		type: "motion/apply-motion-grammar-effect-automation",
		label: options.label ?? "Create editable effect automation",
		coalesceKey:
			options.coalesceKey ??
			`motion/apply-motion-grammar-effect-automation:${emission.bindingId}`,
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
