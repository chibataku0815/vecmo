import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import type {
	GrammarDuplicateSample,
	GrammarFrameSample,
} from "@/entities/motion/model/grammar-bridge";
import {
	haveCompatiblePathShapeTopology,
	isValidMeshValue,
	isValidPathShape,
} from "@/entities/motion/model/keyframe-validation";
import { pathShapeAtFrame } from "@/entities/motion/model/path-shape";
import { effectiveMesh } from "@/entities/motion/model/sampler";
import type {
	AeKeyframe,
	AnimatableValue,
	KeyframeTrack,
	MotionDocument,
	SnapshotAnimatableProperty,
} from "@/entities/motion/model/types";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import { allNodes } from "@/entities/scene/model/selectors";
import type {
	BezierShape,
	MeshGradientPaint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import type {
	MotionGrammarDecompositionIssue,
	MotionGrammarDecompositionPlan,
	MotionGrammarEditableArtifactPlan,
	MotionGrammarEditableArtifactTrackPlan,
} from "./decomposition";
import { sampleGrammarFrame } from "./evaluator";
import type { MotionGrammarGeneratedNodeIdResolver } from "./scalar-track-emitter";
import type { MotionGrammarBinding } from "./types";

const LINEAR_INTERPOLATION = 6612;

/** Severity for source-frame snapshot artifact emission diagnostics. */
export type MotionGrammarSnapshotArtifactEmissionIssueSeverity =
	| "info"
	| "warning"
	| "error";

/** Stable issue codes reported while materializing editable snapshot artifacts. */
export type MotionGrammarSnapshotArtifactEmissionIssueCode =
	| "binding-plan-mismatch"
	| "decomposition-issue"
	| "empty-snapshot-plan"
	| "generated-target-unresolved"
	| "target-node-missing"
	| "temporal-echo-sample-missing"
	| "snapshot-source-frame-invalid"
	| "snapshot-value-missing"
	| "snapshot-value-invalid"
	| "path-shape-topology-mismatch";

/** Diagnostic emitted while turning source-frame artifacts into ordinary tracks. */
export type MotionGrammarSnapshotArtifactEmissionIssue = {
	readonly code: MotionGrammarSnapshotArtifactEmissionIssueCode;
	readonly severity: MotionGrammarSnapshotArtifactEmissionIssueSeverity;
	readonly message: string;
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly artifactIdSeed?: string;
	readonly trackIdSeed?: string;
	readonly nodeId?: string;
	readonly property?: SnapshotAnimatableProperty;
	readonly frame?: number;
	readonly sourceFrame?: number;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
};

/** Inputs required to materialize source-frame snapshot artifact outputs. */
export type EmitMotionGrammarSnapshotArtifactTracksInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly generatedNodeIdForSeed?: MotionGrammarGeneratedNodeIdResolver;
};

/**
 * Pure source-frame snapshot emission result. Tracks are ordinary
 * `MotionDocument` snapshot tracks, so after bake the timeline remains editable
 * without a grammar runtime dependency.
 */
export type MotionGrammarSnapshotArtifactEmission = {
	readonly bindingId: string;
	readonly techniqueId: string;
	readonly tracks: readonly KeyframeTrack[];
	readonly emittedTrackPlans: readonly MotionGrammarEditableArtifactTrackPlan[];
	readonly skippedTrackPlans: readonly MotionGrammarEditableArtifactTrackPlan[];
	readonly emittedArtifactPlans: readonly MotionGrammarEditableArtifactPlan[];
	readonly issues: readonly MotionGrammarSnapshotArtifactEmissionIssue[];
};

type SnapshotTrackTarget = {
	readonly outputNodeId: string;
	readonly sampleNode: VectorNode;
	readonly duplicateCopyIndex?: number;
};

type SnapshotSampleContext = {
	readonly frame: number;
	readonly frameSample: GrammarFrameSample;
};

type GrammarFrameSampleCache = Map<number, GrammarFrameSample>;

const snapshotKeyframe = <V extends AnimatableValue>(
	time: number,
	value: V,
): AeKeyframe<V> => ({
	time,
	value,
	inInterpolationType: LINEAR_INTERPOLATION,
	outInterpolationType: LINEAR_INTERPOLATION,
	inTemporalEase: [{ speed: 0, influence: 0 }],
	outTemporalEase: [{ speed: 0, influence: 0 }],
});

const createNodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> =>
	new Map(allNodes(scene).map((node) => [node.id, node]));

const generatedCopyIndexBySeed = (
	plan: MotionGrammarDecompositionPlan,
): ReadonlyMap<string, number> =>
	new Map(
		plan.outputs.flatMap((output) =>
			output.kind === "scene-node" ? [[output.idSeed, output.copyIndex]] : [],
		),
	);

const issueForPlan = ({
	code,
	severity,
	message,
	binding,
	artifactPlan,
	trackPlan,
	nodeId,
	frame,
	sourceFrame,
	decompositionIssue,
}: {
	readonly code: MotionGrammarSnapshotArtifactEmissionIssueCode;
	readonly severity: MotionGrammarSnapshotArtifactEmissionIssueSeverity;
	readonly message: string;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan?: MotionGrammarEditableArtifactPlan;
	readonly trackPlan?: MotionGrammarEditableArtifactTrackPlan;
	readonly nodeId?: string;
	readonly frame?: number;
	readonly sourceFrame?: number;
	readonly decompositionIssue?: MotionGrammarDecompositionIssue;
}): MotionGrammarSnapshotArtifactEmissionIssue => ({
	code,
	severity,
	message,
	bindingId: binding.id,
	techniqueId: binding.techniqueId,
	...(artifactPlan ? { artifactIdSeed: artifactPlan.idSeed } : {}),
	...(trackPlan
		? {
				trackIdSeed: trackPlan.idSeed,
				property: trackPlan.property,
			}
		: {}),
	...(nodeId ? { nodeId } : {}),
	...(frame === undefined ? {} : { frame }),
	...(sourceFrame === undefined ? {} : { sourceFrame }),
	...(decompositionIssue ? { decompositionIssue } : {}),
});

const decompositionIssueForResult = (
	binding: MotionGrammarBinding,
	issue: MotionGrammarDecompositionIssue,
): MotionGrammarSnapshotArtifactEmissionIssue =>
	issueForPlan({
		code: "decomposition-issue",
		severity: issue.severity,
		message: issue.message,
		binding,
		decompositionIssue: issue,
	});

const shouldCarryDecompositionIssue = (
	issue: MotionGrammarDecompositionIssue,
): boolean => issue.code !== "pending-emitter";

const duplicateForTarget = (
	context: SnapshotSampleContext,
	sourceNodeId: string,
	copyIndex: number | undefined,
): GrammarDuplicateSample | undefined => {
	if (copyIndex === undefined) return undefined;
	const sourceDuplicates = context.frameSample.duplicates.filter(
		(duplicate) => duplicate.sourceNodeId === sourceNodeId,
	);
	return sourceDuplicates[copyIndex - 1];
};

const sourceFrameForTarget = ({
	target,
	context,
	binding,
	artifactPlan,
	trackPlan,
	issues,
}: {
	readonly target: SnapshotTrackTarget;
	readonly context: SnapshotSampleContext;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly trackPlan: MotionGrammarEditableArtifactTrackPlan;
	readonly issues: MotionGrammarSnapshotArtifactEmissionIssue[];
}): number | undefined => {
	if (target.duplicateCopyIndex !== undefined) {
		const duplicate = duplicateForTarget(
			context,
			target.sampleNode.id,
			target.duplicateCopyIndex,
		);
		if (!duplicate) {
			issues.push(
				issueForPlan({
					code: "temporal-echo-sample-missing",
					severity: "error",
					message:
						"Temporal-echo snapshot sample was not available for this generated target.",
					binding,
					artifactPlan,
					trackPlan,
					nodeId: target.outputNodeId,
					frame: context.frame,
				}),
			);
			return undefined;
		}
		return duplicate.sourceFrame;
	}
	return (
		context.frameSample.samples.get(target.sampleNode.id)?.sourceFrame ??
		context.frame
	);
};

const meshPaintAtFrame = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): MeshGradientPaint | null => {
	const animated = effectiveMesh(node, motion, frame);
	if (animated) return cloneSceneDocument(animated);
	const base = node.style.fills?.[0];
	return base?.kind === "mesh-gradient" ? cloneSceneDocument(base) : null;
};

const snapshotValueAtFrame = (
	node: VectorNode,
	motion: MotionDocument,
	property: SnapshotAnimatableProperty,
	sourceFrame: number,
): BezierShape | MeshGradientPaint | null => {
	if (property === "pathShape")
		return pathShapeAtFrame(node, motion, sourceFrame);
	return meshPaintAtFrame(node, motion, sourceFrame);
};

const validateSnapshotValue = ({
	value,
	property,
	referenceShape,
}: {
	readonly value: BezierShape | MeshGradientPaint;
	readonly property: SnapshotAnimatableProperty;
	readonly referenceShape?: BezierShape;
}):
	| { readonly valid: true }
	| {
			readonly valid: false;
			readonly reason:
				| "snapshot-value-invalid"
				| "path-shape-topology-mismatch";
	  } => {
	if (property === "meshPaint") {
		return isValidMeshValue(value)
			? { valid: true }
			: { valid: false, reason: "snapshot-value-invalid" };
	}
	if (!isValidPathShape(value)) {
		return { valid: false, reason: "snapshot-value-invalid" };
	}
	if (
		referenceShape &&
		!haveCompatiblePathShapeTopology(referenceShape, value)
	) {
		return { valid: false, reason: "path-shape-topology-mismatch" };
	}
	return { valid: true };
};

const resolveTrackTarget = ({
	trackPlan,
	nodes,
	generatedCopyIndex,
	generatedNodeIdForSeed,
	binding,
	artifactPlan,
	issues,
}: {
	readonly trackPlan: MotionGrammarEditableArtifactTrackPlan;
	readonly nodes: ReadonlyMap<string, VectorNode>;
	readonly generatedCopyIndex: ReadonlyMap<string, number>;
	readonly generatedNodeIdForSeed: MotionGrammarGeneratedNodeIdResolver;
	readonly binding: MotionGrammarBinding;
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly issues: MotionGrammarSnapshotArtifactEmissionIssue[];
}): SnapshotTrackTarget | undefined => {
	switch (trackPlan.target.kind) {
		case "existing-scene-node": {
			const node = nodes.get(trackPlan.target.nodeId);
			if (!node) {
				issues.push(
					issueForPlan({
						code: "target-node-missing",
						severity: "error",
						message: `Snapshot artifact target "${trackPlan.target.nodeId}" is not present in the scene document.`,
						binding,
						artifactPlan,
						trackPlan,
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
						message: `Generated snapshot source "${trackPlan.target.sourceNodeId}" is not present in the scene document.`,
						binding,
						artifactPlan,
						trackPlan,
						nodeId: trackPlan.target.sourceNodeId,
					}),
				);
				return undefined;
			}
			if (!outputNodeId || copyIndex === undefined) {
				issues.push(
					issueForPlan({
						code: "generated-target-unresolved",
						severity: "error",
						message:
							"Generated snapshot target could not be resolved to a concrete node id.",
						binding,
						artifactPlan,
						trackPlan,
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
	artifactPlan,
	trackPlan,
	target,
	binding,
	scene,
	motion,
	frameSampleCache,
	issues,
}: {
	readonly artifactPlan: MotionGrammarEditableArtifactPlan;
	readonly trackPlan: MotionGrammarEditableArtifactTrackPlan;
	readonly target: SnapshotTrackTarget;
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frameSampleCache: GrammarFrameSampleCache;
	readonly issues: MotionGrammarSnapshotArtifactEmissionIssue[];
}): KeyframeTrack | undefined => {
	const keyframes: AeKeyframe<AnimatableValue>[] = [];
	let referenceShape: BezierShape | undefined;

	for (const frame of artifactPlan.sampleFrames) {
		const cachedSample = frameSampleCache.get(frame);
		const frameSample =
			cachedSample ?? sampleGrammarFrame([binding], { scene, motion, frame });
		if (!cachedSample) frameSampleCache.set(frame, frameSample);
		const sourceFrame = sourceFrameForTarget({
			target,
			context: { frame, frameSample },
			binding,
			artifactPlan,
			trackPlan,
			issues,
		});
		if (sourceFrame === undefined) continue;
		if (!Number.isFinite(sourceFrame)) {
			issues.push(
				issueForPlan({
					code: "snapshot-source-frame-invalid",
					severity: "error",
					message: "Snapshot artifact source frame is not finite.",
					binding,
					artifactPlan,
					trackPlan,
					nodeId: target.outputNodeId,
					frame,
					sourceFrame,
				}),
			);
			continue;
		}
		const value = snapshotValueAtFrame(
			target.sampleNode,
			motion,
			trackPlan.property,
			sourceFrame,
		);
		if (!value) {
			issues.push(
				issueForPlan({
					code: "snapshot-value-missing",
					severity: "error",
					message:
						"Snapshot artifact could not sample a value for this property.",
					binding,
					artifactPlan,
					trackPlan,
					nodeId: target.outputNodeId,
					frame,
					sourceFrame,
				}),
			);
			continue;
		}
		const validation = validateSnapshotValue({
			value,
			property: trackPlan.property,
			referenceShape,
		});
		if (!validation.valid) {
			issues.push(
				issueForPlan({
					code: validation.reason,
					severity: "error",
					message:
						validation.reason === "path-shape-topology-mismatch"
							? "Snapshot path shape topology changes across sampled keys."
							: "Snapshot artifact sampled an invalid value.",
					binding,
					artifactPlan,
					trackPlan,
					nodeId: target.outputNodeId,
					frame,
					sourceFrame,
				}),
			);
			continue;
		}
		if (trackPlan.property === "pathShape" && isValidPathShape(value)) {
			referenceShape = referenceShape ?? value;
		}
		keyframes.push(snapshotKeyframe(frame, cloneSceneDocument(value)));
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
 * Converts `source-frame-snapshot` editable artifacts into ordinary snapshot
 * keyframe tracks by sampling path shape and mesh paint values over the plan's
 * range. Generated afterimage targets resolve through the scene-node
 * materialization seed map before tracks are emitted.
 */
export function emitMotionGrammarSnapshotArtifactTracks({
	plan,
	binding,
	scene,
	motion,
	generatedNodeIdForSeed = () => undefined,
}: EmitMotionGrammarSnapshotArtifactTracksInput): MotionGrammarSnapshotArtifactEmission {
	const issues: MotionGrammarSnapshotArtifactEmissionIssue[] = plan.issues
		.filter(shouldCarryDecompositionIssue)
		.map((issue) => decompositionIssueForResult(binding, issue));

	const artifactPlans = plan.outputs.filter(
		(output): output is MotionGrammarEditableArtifactPlan =>
			output.kind === "editable-artifact" &&
			output.artifactKind === "source-frame-snapshot",
	);

	if (
		plan.bindingId !== binding.id ||
		plan.techniqueId !== binding.techniqueId
	) {
		issues.push(
			issueForPlan({
				code: "binding-plan-mismatch",
				severity: "error",
				message:
					"Snapshot artifact emitter input binding does not match the decomposition plan.",
				binding,
			}),
		);
		return {
			bindingId: plan.bindingId,
			techniqueId: plan.techniqueId,
			tracks: [],
			emittedTrackPlans: [],
			skippedTrackPlans: artifactPlans.flatMap((artifact) =>
				artifact.trackPlans.map((trackPlan) => trackPlan),
			),
			emittedArtifactPlans: [],
			issues,
		};
	}

	const trackPlans = artifactPlans.flatMap((artifact) => artifact.trackPlans);
	if (trackPlans.length === 0) {
		issues.push(
			issueForPlan({
				code: "empty-snapshot-plan",
				severity: "info",
				message: "Decomposition plan contains no source-frame snapshot tracks.",
				binding,
			}),
		);
	}

	const nodes = createNodeMap(scene);
	const generatedCopyIndex = generatedCopyIndexBySeed(plan);
	const frameSampleCache: GrammarFrameSampleCache = new Map();
	const tracks: KeyframeTrack[] = [];
	const emittedTrackPlans: MotionGrammarEditableArtifactTrackPlan[] = [];
	const skippedTrackPlans: MotionGrammarEditableArtifactTrackPlan[] = [];
	const emittedArtifactPlanIds = new Set<string>();

	for (const artifactPlan of artifactPlans) {
		for (const trackPlan of artifactPlan.trackPlans) {
			const target = resolveTrackTarget({
				trackPlan,
				nodes,
				generatedCopyIndex,
				generatedNodeIdForSeed,
				binding,
				artifactPlan,
				issues,
			});
			if (!target) {
				skippedTrackPlans.push(trackPlan);
				continue;
			}
			const track = emitTrack({
				artifactPlan,
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
			emittedArtifactPlanIds.add(artifactPlan.idSeed);
		}
	}

	return {
		bindingId: plan.bindingId,
		techniqueId: plan.techniqueId,
		tracks,
		emittedTrackPlans,
		skippedTrackPlans,
		emittedArtifactPlans: artifactPlans.filter((artifact) =>
			emittedArtifactPlanIds.has(artifact.idSeed),
		),
		issues,
	};
}

const cloneSnapshotTrack = (track: KeyframeTrack): KeyframeTrack => ({
	id: track.id,
	target: { ...track.target },
	keyframes: track.keyframes.map((keyframe) => ({
		...keyframe,
		value: cloneSceneDocument(keyframe.value),
		inTemporalEase: keyframe.inTemporalEase?.map((ease) => ({ ...ease })),
		outTemporalEase: keyframe.outTemporalEase?.map((ease) => ({ ...ease })),
	})),
});

/**
 * Creates a motion command that writes emitted snapshot artifact tracks as
 * normal path-shape or mesh-paint tracks. Re-bakes replace matching target
 * properties, mirroring scalar track materialization.
 */
export function createApplyMotionGrammarSnapshotArtifactTracksCommand(
	emission: MotionGrammarSnapshotArtifactEmission,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	return {
		type: "motion/apply-motion-grammar-snapshot-artifact-tracks",
		label: options.label ?? "Create editable motion snapshots",
		coalesceKey:
			options.coalesceKey ??
			`motion/apply-motion-grammar-snapshot-artifact-tracks:${emission.bindingId}`,
		run: (draft) => {
			for (const track of emission.tracks) {
				const target = track.target;
				const existingIndex = draft.tracks.findIndex(
					(candidate) =>
						candidate.id === track.id ||
						(candidate.target.nodeId === target.nodeId &&
							candidate.target.property === target.property),
				);
				const cloned = castDraft(cloneSnapshotTrack(track));
				if (existingIndex >= 0) {
					draft.tracks[existingIndex] = cloned;
					continue;
				}
				draft.tracks.push(cloned);
			}
		},
	};
}
