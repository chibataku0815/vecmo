import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	FOLLOW_THROUGH_CONSTRUCTION_FIXTURE,
	type FollowThroughReferenceInput,
} from "./follow-through-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export type FollowThroughCandidateFixture = {
	readonly source: FollowThroughReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly leaderNodeId: string;
	readonly followerNodeIds: readonly string[];
};

const leaderNodeId = "follow-through-leader";

const node = (
	id: string,
	name: string,
	position: { readonly x: number; readonly y: number },
): VectorNode => ({
	id,
	name,
	geometry: {
		kind: "ellipse",
		bounds: { x: -18, y: -18, width: 36, height: 36 },
	},
	transform: {
		position,
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: { fill: "#73d13d", stroke: "#191817", strokeWidth: 2, opacity: 1 },
	visible: true,
	locked: false,
});

const leadKeyframes = [
	{
		time: 0,
		value: 240,
		outInterpolationType: 6612,
		outTemporalCurve: { x1: 0, y1: 0, x2: 1, y2: 1 },
	},
	{
		time: 30,
		value: 360,
		outInterpolationType: 6612,
		outTemporalCurve: { x1: 0, y1: 0, x2: 1, y2: 1 },
	},
	{
		time: 60,
		value: 480,
		outInterpolationType: 6612,
		outTemporalCurve: { x1: 0, y1: 0, x2: 1, y2: 1 },
	},
	{
		time: 90,
		value: 360,
		outInterpolationType: 6612,
		outTemporalCurve: { x1: 0, y1: 0, x2: 1, y2: 1 },
	},
	{ time: 120, value: 240 },
];

export const createFollowThroughCandidateFixture = (
	source: FollowThroughReferenceInput = FOLLOW_THROUGH_CONSTRUCTION_FIXTURE,
): FollowThroughCandidateFixture => {
	const followerNodeIds = source.targets.map((target) => target.targetId);
	const binding: MotionGrammarBinding = {
		id: "follow-through-candidate-binding",
		techniqueId: "lag-follow-through",
		targetIds: [leaderNodeId, ...followerNodeIds],
		roleMap: {
			"lag-follow-through:leader": leaderNodeId,
			...Object.fromEntries(
				followerNodeIds.map((nodeId) => [
					nodeId,
					"lag-follow-through:follower",
				]),
			),
		},
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			delayFrames: source.delayFrames,
			response: source.response,
			settleFrames: source.settleFrames,
			decay: source.decay,
			velocityLookback: source.velocityLookback,
			rotationResponse: source.rotationResponse,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "follow-through-candidate-scene",
		name: "Follow-through Velocity Candidate",
		artboard: {
			id: "follow-through-candidate-artboard",
			name: "Follow-through Candidate",
			width: 640,
			height: 360,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "follow-through-candidate-layer",
				name: "Follow-through Roles",
				visible: true,
				locked: false,
				nodes: [
					node(leaderNodeId, "Follow-through leader", { x: 240, y: 180 }),
					...source.targets.map((target) =>
						node(target.targetId, `Follower ${target.index}`, target.rest),
					),
				],
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
			tracks: [
				{
					id: "follow-through-leader-x",
					target: { nodeId: leaderNodeId, property: "x" },
					keyframes: leadKeyframes,
				},
				{
					id: "follow-through-leader-y",
					target: { nodeId: leaderNodeId, property: "y" },
					keyframes: [{ time: 0, value: 180 }],
				},
			],
			clips: [
				{
					id: "follow-through-candidate-clip",
					name: "Follow-through candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: ["follow-through-leader-x", "follow-through-leader-y"],
					provenance: {
						source: "motion-grammar",
						label: "Follow-through candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Follow-through",
						targetIds: [...binding.targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
		leaderNodeId,
		followerNodeIds,
	};
};
