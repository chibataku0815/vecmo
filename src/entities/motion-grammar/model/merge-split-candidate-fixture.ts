import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT,
	MERGE_SPLIT_GATHER_FRACTION_DEFAULT,
	MERGE_SPLIT_HOLD_FRACTION_DEFAULT,
	MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
	MERGE_SPLIT_PERIOD_DEFAULT,
	MERGE_SPLIT_RETURN_FRACTION_DEFAULT,
	MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT,
	MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT,
	MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
	MERGE_SPLIT_STAGGER_FRAMES_DEFAULT,
	MERGE_SPLIT_STRENGTH_DEFAULT,
} from "./catalog";
import type {
	MergeSplitReferenceInput,
	MergeSplitReferenceRole,
} from "./merge-split-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export type MergeSplitCandidateFixture = {
	readonly source: MergeSplitReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly roleMappings: readonly {
		readonly sourceTargetId: string;
		readonly candidateNodeId: string;
	}[];
};

const TARGETS = [
	{ id: "merge-split-core", role: "core" as const, x: 320, y: 240 },
	{ id: "merge-split-member-1", role: "member" as const, x: 320, y: 120 },
	{ id: "merge-split-member-2", role: "member" as const, x: 424, y: 180 },
	{ id: "merge-split-member-3", role: "member" as const, x: 424, y: 300 },
	{ id: "merge-split-member-4", role: "member" as const, x: 320, y: 360 },
	{ id: "merge-split-member-5", role: "member" as const, x: 216, y: 300 },
	{ id: "merge-split-member-6", role: "member" as const, x: 216, y: 180 },
] as const;

export const MERGE_SPLIT_CONSTRUCTION_FIXTURE: MergeSplitReferenceInput = {
	periodFrames: MERGE_SPLIT_PERIOD_DEFAULT,
	strength: MERGE_SPLIT_STRENGTH_DEFAULT,
	scaleFloor: MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
	opacityFloor: MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
	gatherFraction: MERGE_SPLIT_GATHER_FRACTION_DEFAULT,
	holdFraction: MERGE_SPLIT_HOLD_FRACTION_DEFAULT,
	returnFraction: MERGE_SPLIT_RETURN_FRACTION_DEFAULT,
	staggerFrames: MERGE_SPLIT_STAGGER_FRAMES_DEFAULT,
	ringTurnDegrees: MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT,
	returnOvershoot: MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT,
	coreScaleGain: MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT,
	targets: TARGETS.map((target) => ({
		targetId: target.id,
		role: target.role,
		rest: { x: target.x, y: target.y },
	})),
};

const node = (target: {
	readonly id: string;
	readonly role: MergeSplitReferenceRole;
	readonly x: number;
	readonly y: number;
}): VectorNode => ({
	id: target.id,
	name: `Merge / Split ${target.role}`,
	geometry: {
		kind: "ellipse",
		bounds: { x: -16, y: -16, width: 32, height: 32 },
	},
	transform: {
		position: { x: target.x, y: target.y },
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill: target.role === "core" ? "#191817" : "#73d13d",
		stroke: "#191817",
		strokeWidth: 2,
		opacity: 1,
	},
	visible: true,
	locked: false,
});

export const createMergeSplitCandidateFixture = (
	source: MergeSplitReferenceInput = MERGE_SPLIT_CONSTRUCTION_FIXTURE,
): MergeSplitCandidateFixture => {
	const targetIds = source.targets.map((target) => target.targetId);
	const roleMap = Object.fromEntries(
		source.targets.map((target) => [
			target.targetId,
			`merge-split-cycle:${target.role}`,
		]),
	);
	const binding: MotionGrammarBinding = {
		id: "merge-split-candidate-binding",
		techniqueId: "merge-split-cycle",
		targetIds,
		roleMap,
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			strength: source.strength,
			scaleFloor: source.scaleFloor,
			opacityFloor: source.opacityFloor,
			gatherFraction: source.gatherFraction,
			holdFraction: source.holdFraction,
			returnFraction: source.returnFraction,
			staggerFrames: source.staggerFrames,
			ringTurnDegrees: source.ringTurnDegrees,
			returnOvershoot: source.returnOvershoot,
			coreScaleGain: source.coreScaleGain,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "merge-split-candidate-scene",
		name: "Merge / Split Delayed Gather Candidate",
		artboard: {
			id: "merge-split-candidate-artboard",
			name: "Merge / Split Candidate",
			width: 640,
			height: 480,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "merge-split-candidate-layer",
				name: "Merge / Split Field",
				visible: true,
				locked: false,
				nodes: source.targets.map((target) =>
					node({
						id: target.targetId,
						role: target.role,
						x: target.rest.x,
						y: target.rest.y,
					}),
				),
			},
		],
	};
	return {
		source,
		scene,
		motion: {
			schemaVersion: 1,
			fps: 30,
			durationFrames: source.periodFrames,
			tracks: [],
			clips: [
				{
					id: "merge-split-candidate-clip",
					name: "Merge / Split candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Merge / Split candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Merge / Split",
						targetIds: [...targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
		roleMappings: targetIds.map((targetId) => ({
			sourceTargetId: targetId,
			candidateNodeId: targetId,
		})),
	};
};
