import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import type {
	GrammarDuplicateSample,
	GrammarFrameSample,
	GrammarNodeSample,
} from "@/entities/motion/model/grammar-bridge";
import {
	effectiveCornerRadii,
	effectiveCornerRadius,
	effectiveCornerSmoothing,
	effectiveOpacity,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import type {
	AeKeyframe,
	KeyframeTrack,
	MotionDocument,
	ScalarAnimatableProperty,
} from "@/entities/motion/model/types";
import { allNodes } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type {
	MotionGrammarDecomposableScalarProperty,
	MotionGrammarDecompositionIssue,
	MotionGrammarDecompositionPlan,
	MotionGrammarScalarSampleChannel,
	MotionGrammarScalarTrackPlan,
} from "./decomposition";
import { sampleGrammarFrame } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

const LINEAR_INTERPOLATION = 6612;

/** Resolves a generated node seed to the concrete node id used by emitted tracks. */
export type MotionGrammarGeneratedNodeIdResolver = (
	nodeIdSeed: string,
) => string | undefined;

/** Severity for scalar emission issues that callers can surface before bake. */
export type MotionGrammarScalarTrackEmissionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes reported while turning scalar plans into keyframe tracks. */
export type MotionGrammarScalarTrackEmissionIssueCode =
	| "binding-plan-mismatch"
	| "decomposition-issue"
	| "empty-scalar-plan"
	| "generated-target-unresolved"
	| "target-node-missing"
	| "temporal-echo-sample-missing"
	| "scalar-value-non-finite";

/** Diagnostic emitted with enough address data to map back to a plan row. */
export type MotionGrammarScalarTrackEmissionIssue = {
	readonly code: MotionGrammarScalarTrackEmissionIssueCode;
	readonly severity: MotionGrammarScalarTrackEmissionIssueSeverity;
	readonly message: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly trackIdSeed?: string;
	readonly nodeId?: string;
	readonly property?: MotionGrammarDecomposableScalarProperty;
	readonly channel?: MotionGrammarScalarSampleChannel;
	readonly frame?: number;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
};

/** Inputs required to bake one decomposition plan's scalar outputs. */
export type EmitMotionGrammarScalarTracksInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	/**
	 * Generated scene-node plans carry deterministic seeds until the materializer
	 * creates real nodes. The scalar emitter defaults to those seeds as track
	 * targets, but callers can map them to concrete materialized ids.
	 */
	readonly generatedNodeIdForSeed?: MotionGrammarGeneratedNodeIdResolver;
};

/**
 * Pure scalar emission result. `tracks` are ordinary MotionDocument tracks;
 * skipped plans and issues explain channels that still require another stream.
 */
export type MotionGrammarScalarTrackEmission = {
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly tracks: readonly KeyframeTrack<number>[];
	readonly emittedTrackPlans: readonly MotionGrammarScalarTrackPlan[];
	readonly skippedTrackPlans: readonly MotionGrammarScalarTrackPlan[];
	readonly issues: readonly MotionGrammarScalarTrackEmissionIssue[];
};

type ScalarTrackTarget = {
	readonly outputNodeId: string;
	readonly sampleNode: VectorNode;
	readonly duplicateCopyIndex?: number;
};

type ScalarSampleContext = {
	readonly frame: number;
	readonly sample: GrammarNodeSample | undefined;
	readonly duplicates: readonly GrammarDuplicateSample[];
};

type GrammarFrameSampleCache = Map<number, GrammarFrameSample>;

const finiteValue = (value: number | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteOrNaN = (value: number | undefined): number | undefined =>
	value === undefined ? undefined : (finiteValue(value) ?? Number.NaN);

const scalarKeyframe = (time: number, value: number): AeKeyframe<number> => ({
	time,
	value,
	inInterpolationType: LINEAR_INTERPOLATION,
	outInterpolationType: LINEAR_INTERPOLATION,
	inTemporalEase: [{ speed: 0, influence: 0 }],
	outTemporalEase: [{ speed: 0, influence: 0 }],
});

const createNodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> =>
	new Map(allNodes(scene).map((node) => [node.id, node]));

const issueForPlan = ({
	code,
	severity,
	message,
	binding,
	plan,
	nodeId,
	frame,
	decompositionIssue,
}: {
	readonly code: MotionGrammarScalarTrackEmissionIssueCode;
	readonly severity: MotionGrammarScalarTrackEmissionIssueSeverity;
	readonly message: string;
	readonly binding: MotionGrammarBinding;
	readonly plan?: MotionGrammarScalarTrackPlan;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
}): MotionGrammarScalarTrackEmissionIssue => ({
	code,
	severity,
	message,
	bindingId: binding.id,
	techniqueId: binding.techniqueId,
	...(plan
		? {
				trackIdSeed: plan.idSeed,
				property: plan.property,
				channel: plan.sourceChannel,
			}
		: {}),
	...(nodeId ? { nodeId } : {}),
	...(frame === undefined ? {} : { frame }),
	...(decompositionIssue ? { decompositionIssue } : {}),
});

const decompositionIssueForResult = (
	binding: MotionGrammarBinding,
	issue: MotionGrammarDecompositionIssue,
): MotionGrammarScalarTrackEmissionIssue =>
	issueForPlan({
		code: "decomposition-issue",
		severity: issue.severity,
		message: issue.message,
		binding,
		decompositionIssue: issue,
	});

const shouldCarryDecompositionIssue = (
	issue: MotionGrammarDecompositionIssue,
): boolean =>
	issue.code !== "pending-emitter" || issue.outputKind !== "motion-track";

const propertyValueAtFrame = (
	node: VectorNode,
	motion: MotionDocument,
	property: ScalarAnimatableProperty,
	frame: number,
): number => {
	if (property === "opacity") {
		return effectiveOpacity(node, motion, frame);
	}
	if (property === "cornerRadius") {
		return effectiveCornerRadius(node, motion, frame) ?? 0;
	}
	if (property === "cornerSmoothing") {
		return effectiveCornerSmoothing(node, motion, frame) ?? 0;
	}
	if (property === "cornerRadiusTL") {
		return effectiveCornerRadii(node, motion, frame)?.tl ?? 0;
	}
	if (property === "cornerRadiusTR") {
		return effectiveCornerRadii(node, motion, frame)?.tr ?? 0;
	}
	if (property === "cornerRadiusBR") {
		return effectiveCornerRadii(node, motion, frame)?.br ?? 0;
	}
	if (property === "cornerRadiusBL") {
		return effectiveCornerRadii(node, motion, frame)?.bl ?? 0;
	}
	const transform = effectiveTransform(node, motion, frame);
	switch (property) {
		case "x":
			return transform.position.x;
		case "y":
			return transform.position.y;
		case "anchorX":
			return transform.anchor.x;
		case "anchorY":
			return transform.anchor.y;
		case "rotation":
			return transform.rotation;
		case "scaleX":
			return transform.scale.x;
		case "scaleY":
			return transform.scale.y;
	}
};

const channelAddend = (
	channel: MotionGrammarScalarSampleChannel,
	sample: GrammarNodeSample | undefined,
): number | undefined => {
	switch (channel) {
		case "translate-x":
			return sample?.translate?.x;
		case "translate-y":
			return sample?.translate?.y;
		case "rotate":
			return sample?.rotate;
		default:
			return undefined;
	}
};

const channelFactor = (
	channel: MotionGrammarScalarSampleChannel,
	sample: GrammarNodeSample | undefined,
): number | undefined => {
	switch (channel) {
		case "scale-factor-x":
			return sample?.scaleFactor?.x;
		case "scale-factor-y":
			return sample?.scaleFactor?.y;
		case "opacity-factor":
			return sample?.opacityFactor;
		default:
			return undefined;
	}
};

const channelReplacement = (
	channel: MotionGrammarScalarSampleChannel,
	sample: GrammarNodeSample | undefined,
): number | undefined => {
	switch (channel) {
		case "rotation-override":
			return sample?.rotationOverride;
		default:
			return undefined;
	}
};

const duplicateForTarget = (
	context: ScalarSampleContext,
	sourceNodeId: string,
	copyIndex: number | undefined,
): GrammarDuplicateSample | undefined => {
	if (copyIndex === undefined) return undefined;
	const sourceDuplicates = context.duplicates.filter(
		(duplicate) => duplicate.sourceNodeId === sourceNodeId,
	);
	return sourceDuplicates[copyIndex - 1];
};

const duplicateTrackValue = ({
	trackPlan,
	target,
	context,
	motion,
}: {
	readonly trackPlan: MotionGrammarScalarTrackPlan;
	readonly target: ScalarTrackTarget;
	readonly context: ScalarSampleContext;
	readonly motion: MotionDocument;
}): number | undefined => {
	const duplicate = duplicateForTarget(
		context,
		target.sampleNode.id,
		target.duplicateCopyIndex,
	);
	if (!duplicate) return undefined;
	if (trackPlan.sourceChannel === "duplicate-opacity") {
		return (
			effectiveOpacity(target.sampleNode, motion, duplicate.sourceFrame) *
			duplicate.opacityFactor
		);
	}
	if (trackPlan.sourceChannel === "duplicate-source-frame") {
		return propertyValueAtFrame(
			target.sampleNode,
			motion,
			trackPlan.property,
			duplicate.sourceFrame,
		);
	}
	return undefined;
};

const scalarTrackValue = ({
	trackPlan,
	target,
	context,
	motion,
}: {
	readonly trackPlan: MotionGrammarScalarTrackPlan;
	readonly target: ScalarTrackTarget;
	readonly context: ScalarSampleContext;
	readonly motion: MotionDocument;
}): number | undefined => {
	if (
		trackPlan.sourceChannel === "duplicate-source-frame" ||
		trackPlan.sourceChannel === "duplicate-opacity"
	) {
		return duplicateTrackValue({ trackPlan, target, context, motion });
	}

	const baseFrame = finiteValue(context.sample?.sourceFrame) ?? context.frame;
	const baseValue = propertyValueAtFrame(
		target.sampleNode,
		motion,
		trackPlan.property,
		baseFrame,
	);

	switch (trackPlan.composition) {
		case "retime-source":
			return baseValue;
		case "add":
			return (
				baseValue +
				(finiteOrNaN(channelAddend(trackPlan.sourceChannel, context.sample)) ??
					0)
			);
		case "multiply":
			return (
				baseValue *
				(finiteOrNaN(channelFactor(trackPlan.sourceChannel, context.sample)) ??
					1)
			);
		case "replace":
			return (
				finiteOrNaN(
					channelReplacement(trackPlan.sourceChannel, context.sample),
				) ?? baseValue
			);
	}
};

const generatedCopyIndexBySeed = (
	plan: MotionGrammarDecompositionPlan,
): ReadonlyMap<string, number> =>
	new Map(
		plan.outputs.flatMap((output) =>
			output.kind === "scene-node" ? [[output.idSeed, output.copyIndex]] : [],
		),
	);

const resolveTrackTarget = ({
	trackPlan,
	nodes,
	generatedCopyIndex,
	generatedNodeIdForSeed,
	binding,
	issues,
}: {
	readonly trackPlan: MotionGrammarScalarTrackPlan;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly generatedCopyIndex: ReadonlyMap<string, number>;
	readonly generatedNodeIdForSeed: MotionGrammarGeneratedNodeIdResolver;
	readonly binding: MotionGrammarBinding;
	readonly issues: MotionGrammarScalarTrackEmissionIssue[];
}): ScalarTrackTarget | undefined => {
	switch (trackPlan.target.kind) {
		case "existing-scene-node": {
			const node = nodes.get(trackPlan.target.nodeId);
			if (!node) {
				issues.push(
					issueForPlan({
						code: "target-node-missing",
						severity: "error",
						message: `Scalar track target "${trackPlan.target.nodeId}" is not present in the scene document.`,
						binding,
						plan: trackPlan,
						nodeId: trackPlan.target.nodeId,
					}),
				);
				return undefined;
			}
			return { outputNodeId: node.id, sampleNode: node };
		}
		case "generated-scene-node": {
			const sourceNode = nodes.get(trackPlan.target.sourceNodeId);
			const outputNodeId = generatedNodeIdForSeed(trackPlan.target.nodeIdSeed);
			const copyIndex = generatedCopyIndex.get(trackPlan.target.nodeIdSeed);
			if (!sourceNode) {
				issues.push(
					issueForPlan({
						code: "target-node-missing",
						severity: "error",
						message: `Generated scalar track source "${trackPlan.target.sourceNodeId}" is not present in the scene document.`,
						binding,
						plan: trackPlan,
						nodeId: trackPlan.target.sourceNodeId,
					}),
				);
				return undefined;
			}
			if (!outputNodeId || copyIndex === undefined) {
				issues.push(
					issueForPlan({
						code: "generated-target-unresolved",
						severity: "warning",
						message:
							"Generated scalar track target could not be resolved to a concrete node id.",
						binding,
						plan: trackPlan,
						nodeId: trackPlan.target.nodeIdSeed,
					}),
				);
				return undefined;
			}
			return {
				outputNodeId,
				sampleNode: sourceNode,
				duplicateCopyIndex: copyIndex,
			};
		}
	}
};

const emitTrack = ({
	trackPlan,
	target,
	binding,
	scene,
	motion,
	frameSampleCache,
	issues,
}: {
	readonly trackPlan: MotionGrammarScalarTrackPlan;
	readonly target: ScalarTrackTarget;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frameSampleCache: GrammarFrameSampleCache;
	readonly issues: MotionGrammarScalarTrackEmissionIssue[];
}): KeyframeTrack<number> | undefined => {
	const keyframes: AeKeyframe<number>[] = [];
	for (const frame of trackPlan.sampleFrames) {
		const cachedSample = frameSampleCache.get(frame);
		const frameSample =
			cachedSample ?? sampleGrammarFrame([binding], { scene, motion, frame });
		if (!cachedSample) frameSampleCache.set(frame, frameSample);
		const context: ScalarSampleContext = {
			frame,
			sample: frameSample.samples.get(target.sampleNode.id),
			duplicates: frameSample.duplicates,
		};
		const value = scalarTrackValue({
			trackPlan,
			target,
			context,
			motion,
		});
		const finite = finiteValue(value);
		if (finite === undefined) {
			const isTemporalEcho =
				trackPlan.sourceChannel === "duplicate-source-frame" ||
				trackPlan.sourceChannel === "duplicate-opacity";
			issues.push(
				issueForPlan({
					code: isTemporalEcho
						? "temporal-echo-sample-missing"
						: "scalar-value-non-finite",
					severity: "error",
					message: isTemporalEcho
						? "Temporal-echo scalar sample was not available for this generated track."
						: "Scalar emitter produced a non-finite keyframe value.",
					binding,
					plan: trackPlan,
					nodeId: target.outputNodeId,
					frame,
				}),
			);
			continue;
		}
		keyframes.push(scalarKeyframe(frame, finite));
	}
	if (keyframes.length === 0) return undefined;
	return {
		id: trackPlan.idSeed,
		target: {
			nodeId: target.outputNodeId,
			property: trackPlan.property,
		},
		keyframes,
	};
};

/**
 * Converts `motion-track` decomposition outputs into ordinary scalar
 * `MotionDocument` tracks by sampling the live grammar evaluator over the plan's
 * frame range. The emitted values are absolute channel values because the current
 * sampler treats scalar tracks as overrides over the scene rest pose.
 *
 * The function is pure and store-free. Non-scalar grammar semantics are planned
 * as `editable-artifact` outputs and handled by dedicated materializers, so this
 * scalar emitter only carries genuine decomposition diagnostics forward.
 */
export function emitMotionGrammarScalarTracks({
	plan,
	binding,
	scene,
	motion,
	generatedNodeIdForSeed = () => undefined,
}: EmitMotionGrammarScalarTracksInput): MotionGrammarScalarTrackEmission {
	const issues: MotionGrammarScalarTrackEmissionIssue[] = plan.issues
		.filter(shouldCarryDecompositionIssue)
		.map((issue) => decompositionIssueForResult(binding, issue));

	if (
		plan.bindingId !== binding.id ||
		plan.techniqueId !== binding.techniqueId
	) {
		issues.push(
			issueForPlan({
				code: "binding-plan-mismatch",
				severity: "error",
				message:
					"Scalar emitter input binding does not match the decomposition plan.",
				binding,
			}),
		);
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			tracks: [],
			emittedTrackPlans: [],
			skippedTrackPlans: plan.outputs.filter(
				(output): output is MotionGrammarScalarTrackPlan =>
					output.kind === "motion-track",
			),
			issues,
		};
	}

	const trackPlans = plan.outputs.filter(
		(output): output is MotionGrammarScalarTrackPlan =>
			output.kind === "motion-track",
	);
	if (trackPlans.length === 0) {
		issues.push(
			issueForPlan({
				code: "empty-scalar-plan",
				severity: "info",
				message: "Decomposition plan contains no scalar motion-track outputs.",
				binding,
			}),
		);
	}

	const nodes = createNodeMap(scene);
	const generatedCopyIndex = generatedCopyIndexBySeed(plan);
	const frameSampleCache: GrammarFrameSampleCache = new Map();
	const tracks: KeyframeTrack<number>[] = [];
	const emittedTrackPlans: MotionGrammarScalarTrackPlan[] = [];
	const skippedTrackPlans: MotionGrammarScalarTrackPlan[] = [];

	for (const trackPlan of trackPlans) {
		const target = resolveTrackTarget({
			trackPlan,
			nodes,
			generatedCopyIndex,
			generatedNodeIdForSeed,
			binding,
			issues,
		});
		if (!target) {
			skippedTrackPlans.push(trackPlan);
			continue;
		}
		const track = emitTrack({
			trackPlan,
			target,
			binding,
			scene,
			motion,
			frameSampleCache,
			issues,
		});
		if (!track) {
			skippedTrackPlans.push(trackPlan);
			continue;
		}
		tracks.push(track);
		emittedTrackPlans.push(trackPlan);
	}

	return {
		bindingId: plan.bindingId,
		techniqueId: plan.techniqueId,
		tracks,
		emittedTrackPlans,
		skippedTrackPlans,
		issues,
	};
}

const cloneScalarTrack = (
	track: KeyframeTrack<number>,
): KeyframeTrack<number> => ({
	id: track.id,
	target: { ...track.target },
	keyframes: track.keyframes.map((keyframe) => ({
		...keyframe,
		inTemporalEase: keyframe.inTemporalEase?.map((ease) => ({ ...ease })),
		outTemporalEase: keyframe.outTemporalEase?.map((ease) => ({ ...ease })),
	})),
});

/**
 * Creates a motion command that makes emitted scalar tracks the post-bake source
 * of truth. Existing tracks with the same id or same node/property target are
 * replaced so re-baking a binding cannot leave duplicate channels that the
 * sampler would ignore.
 */
export function createApplyMotionGrammarScalarTracksCommand(
	emission: MotionGrammarScalarTrackEmission,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	return {
		type: "motion/apply-motion-grammar-scalar-tracks",
		label: options.label ?? "Create editable motion tracks",
		coalesceKey:
			options.coalesceKey ??
			`motion/apply-motion-grammar-scalar-tracks:${emission.bindingId}`,
		run: (draft) => {
			for (const track of emission.tracks) {
				const target = track.target;
				const existingIndex = draft.tracks.findIndex(
					(candidate) =>
						candidate.id === track.id ||
						(candidate.target.nodeId === target.nodeId &&
							candidate.target.property === target.property),
				);
				const cloned = castDraft(cloneScalarTrack(track));
				if (existingIndex >= 0) {
					draft.tracks[existingIndex] = cloned;
					continue;
				}
				draft.tracks.push(cloned);
			}
		},
	};
}
