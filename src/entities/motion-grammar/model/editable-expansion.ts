import type { MotionCommand } from "@/entities/motion/model/command";
import { createAnimationClip } from "@/entities/motion/model/commands";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	createApplyMotionGrammarBooleanGeometryCommand,
	emitMotionGrammarBooleanGeometry,
} from "./boolean-geometry-emitter";
import type { MotionGrammarCommand } from "./command";
import { removeGrammarBinding } from "./commands";
import { createMotionGrammarDecompositionPlan } from "./decomposition";
import { createMotionGrammarClipWritePlan } from "./decomposition-clips";
import {
	createApplyMotionGrammarEffectAutomationCommand,
	emitMotionGrammarEffectAutomation,
} from "./effect-automation-emitter";
import {
	createApplyMotionGrammarProjectionPoseCommand,
	emitMotionGrammarProjectionPose,
} from "./projection-pose-emitter";
import {
	createApplyMotionGrammarScalarTracksCommand,
	emitMotionGrammarScalarTracks,
} from "./scalar-track-emitter";
import {
	createMaterializeMotionGrammarSceneNodesCommand,
	createMotionGrammarSceneNodeMaterializationPlan,
} from "./scene-node-materialization";
import {
	createApplyMotionGrammarShearStateCommand,
	emitMotionGrammarShearState,
} from "./shear-state-emitter";
import {
	createApplyMotionGrammarSnapshotArtifactTracksCommand,
	emitMotionGrammarSnapshotArtifactTracks,
} from "./snapshot-artifact-emitter";
import type { MotionGrammarBinding } from "./types";

export type MotionGrammarExpansionSourceDisposition = "archive" | "remove";

export type MotionGrammarEditableExpansionCommandPlan =
	| {
			readonly status: "blocked";
			readonly reasons: readonly string[];
	  }
	| {
			readonly status: "ready";
			readonly sceneCommands: readonly SceneCommand[];
			readonly motionCommands: readonly MotionCommand[];
			readonly grammarCommands: readonly MotionGrammarCommand[];
			readonly summary: {
				readonly generatedNodeCount: number;
				readonly scalarTrackCount: number;
				readonly snapshotTrackCount: number;
				readonly automationTrackCount: number;
				readonly clipCount: number;
				readonly editableArtifactCount: number;
				readonly warningCount: number;
			};
	  };

const errorMessages = (
	issues: readonly { readonly severity: string; readonly message: string }[],
): readonly string[] =>
	issues
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);

const warningCount = (
	issues: readonly { readonly severity: string }[],
): number => issues.filter((issue) => issue.severity === "warning").length;

/**
 * Compiles a live grammar binding into ordinary editable Scene/Motion artifacts.
 * It is store-free and returns only entity commands, making the Inspector,
 * Agent live coordinator, and headless runner share exactly one decomposition
 * and emitter path.
 */
export function createMotionGrammarEditableExpansionCommandPlan({
	binding,
	scene,
	motion,
	sampleStepFrames = 1,
	sourceDisposition = "remove",
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly sampleStepFrames?: number;
	readonly sourceDisposition?: MotionGrammarExpansionSourceDisposition;
}): MotionGrammarEditableExpansionCommandPlan {
	const decompositionPlan = createMotionGrammarDecompositionPlan({
		binding,
		scene,
		motion,
		sampleStepFrames,
		includeClip: true,
	});
	const initialErrors = errorMessages(decompositionPlan.issues);
	if (initialErrors.length > 0 || decompositionPlan.outputs.length === 0) {
		return {
			status: "blocked",
			reasons:
				initialErrors.length > 0
					? initialErrors
					: ["No editable output was planned."],
		};
	}
	const materializationPlan = createMotionGrammarSceneNodeMaterializationPlan({
		decompositionPlan,
		scene,
		motion,
	});
	const generatedNodeIdForSeed = (nodeIdSeed: string) =>
		materializationPlan.nodeIdBySeed[nodeIdSeed];
	const scalarEmission = emitMotionGrammarScalarTracks({
		plan: decompositionPlan,
		binding,
		scene,
		motion,
		generatedNodeIdForSeed,
	});
	const snapshotEmission = emitMotionGrammarSnapshotArtifactTracks({
		plan: decompositionPlan,
		binding,
		scene,
		motion,
		generatedNodeIdForSeed,
	});
	const effectAutomationEmission = emitMotionGrammarEffectAutomation({
		plan: decompositionPlan,
		binding,
		scene,
		motion,
	});
	const projectionPoseEmission = emitMotionGrammarProjectionPose({
		plan: decompositionPlan,
		binding,
		scene,
		motion,
	});
	const shearStateEmission = emitMotionGrammarShearState({
		plan: decompositionPlan,
		binding,
		scene,
		motion,
	});
	const booleanGeometryEmission = emitMotionGrammarBooleanGeometry({
		plan: decompositionPlan,
		binding,
		scene,
		motion,
	});
	const trackIdsBySeed = Object.fromEntries(
		[
			...scalarEmission.emittedTrackPlans,
			...snapshotEmission.emittedTrackPlans,
		].map((trackPlan) => [trackPlan.idSeed, trackPlan.idSeed]),
	);
	const motionWithPlannedTracks: MotionDocument = {
		...motion,
		tracks: [
			...motion.tracks,
			...scalarEmission.tracks,
			...snapshotEmission.tracks,
		],
	};
	const clipWritePlan = createMotionGrammarClipWritePlan({
		plan: decompositionPlan,
		motion: motionWithPlannedTracks,
		trackIdsBySeed,
		generatedNodeIdsBySeed: materializationPlan.nodeIdBySeed,
	});
	const issueGroups = [
		materializationPlan.issues,
		scalarEmission.issues,
		snapshotEmission.issues,
		effectAutomationEmission.issues,
		projectionPoseEmission.issues,
		shearStateEmission.issues,
		booleanGeometryEmission.issues,
		clipWritePlan.issues,
	] as const;
	const reasons = issueGroups.flatMap(errorMessages);
	if (reasons.length > 0) return { status: "blocked", reasons };
	const label = "Create Editable Motion";
	const coalesceKey = `motion-grammar:expand:${binding.id}`;
	const sceneCommands: SceneCommand[] = [
		...(materializationPlan.insertions.length > 0
			? [
					createMaterializeMotionGrammarSceneNodesCommand(materializationPlan, {
						label,
						coalesceKey,
					}),
				]
			: []),
		...effectAutomationEmission.sceneCommands,
	];
	const motionCommands: MotionCommand[] = [
		createApplyMotionGrammarScalarTracksCommand(scalarEmission, {
			label,
			coalesceKey,
		}),
		createApplyMotionGrammarSnapshotArtifactTracksCommand(snapshotEmission, {
			label,
			coalesceKey,
		}),
		createApplyMotionGrammarEffectAutomationCommand(effectAutomationEmission, {
			label,
			coalesceKey,
		}),
		createApplyMotionGrammarProjectionPoseCommand(projectionPoseEmission, {
			label,
			coalesceKey,
		}),
		createApplyMotionGrammarShearStateCommand(shearStateEmission, {
			label,
			coalesceKey,
		}),
		createApplyMotionGrammarBooleanGeometryCommand(booleanGeometryEmission, {
			label,
			coalesceKey,
		}),
		...clipWritePlan.clips.map((clip) => createAnimationClip(clip)),
	];
	return {
		status: "ready",
		sceneCommands,
		motionCommands,
		grammarCommands:
			sourceDisposition === "remove" ? [removeGrammarBinding(binding.id)] : [],
		summary: {
			generatedNodeCount: materializationPlan.insertions.length,
			scalarTrackCount: scalarEmission.tracks.length,
			snapshotTrackCount: snapshotEmission.tracks.length,
			automationTrackCount:
				effectAutomationEmission.automationTracks.length +
				projectionPoseEmission.automationTracks.length +
				shearStateEmission.automationTracks.length +
				booleanGeometryEmission.automationTracks.length,
			clipCount: clipWritePlan.clips.length,
			editableArtifactCount: decompositionPlan.estimates.editableArtifactCount,
			warningCount: issueGroups.reduce(
				(count, issues) => count + warningCount(issues),
				0,
			),
		},
	};
}
