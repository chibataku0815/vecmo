import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type { InverseProportionReferenceInput } from "./inverse-proportion-reference-oracle";
import type { MotionGrammarBinding } from "./types";

/** Stable two-circle fixture for the tangent-anchor Inverse Proportion gate. */
export type InverseProportionCandidateFixture = {
	readonly source: InverseProportionReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly driverNodeId: string;
	readonly followerNodeId: string;
};

const PERIOD_FRAMES = 120;
const ANCHOR = { x: 320, y: 180 } as const;
const AXIS = { x: 1, y: 0 } as const;
const RADIUS_SUM = 128;
const DRIVER_BASE_RADIUS = 32;
const FOLLOWER_BASE_RADIUS = 96;
const DRIVER_SCALES = [1, 1.5, 0.75, 1.25, 1] as const;
const DRIVER_KEY_FRAMES = [0, 30, 60, 90, 120] as const;

const driverRadiusAt = (frame: number): number => {
	const local = ((frame % PERIOD_FRAMES) + PERIOD_FRAMES) % PERIOD_FRAMES;
	for (let index = 0; index < DRIVER_KEY_FRAMES.length - 1; index += 1) {
		const fromFrame = DRIVER_KEY_FRAMES[index];
		const toFrame = DRIVER_KEY_FRAMES[index + 1];
		if (local <= toFrame) {
			const progress = (local - fromFrame) / (toFrame - fromFrame);
			const from = DRIVER_SCALES[index] * DRIVER_BASE_RADIUS;
			const to = DRIVER_SCALES[index + 1] * DRIVER_BASE_RADIUS;
			return from + (to - from) * progress;
		}
	}
	return DRIVER_BASE_RADIUS;
};

export const INVERSE_PROPORTION_CONSTRUCTION_FIXTURE: InverseProportionReferenceInput =
	{
		periodFrames: PERIOD_FRAMES,
		anchor: ANCHOR,
		axis: AXIS,
		radiusSum: RADIUS_SUM,
		clearance: 0,
		driverRadiusAt,
	};

const circleNode = ({
	id,
	name,
	radius,
	position,
}: {
	readonly id: string;
	readonly name: string;
	readonly radius: number;
	readonly position: { readonly x: number; readonly y: number };
}): VectorNode => ({
	id,
	name,
	geometry: {
		kind: "ellipse",
		bounds: { x: -radius, y: -radius, width: radius * 2, height: radius * 2 },
	},
	transform: {
		position,
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill: "#73d13d",
		stroke: "#191817",
		strokeWidth: 2,
		opacity: 1,
	},
	visible: true,
	locked: false,
});

const scaleKeyframes = () =>
	DRIVER_KEY_FRAMES.map((time, index) => ({
		time,
		value: DRIVER_SCALES[index],
	}));

/** Creates a two-circle candidate with an independent driver radius phrase. */
export const createInverseProportionCandidateFixture = (
	source: InverseProportionReferenceInput = INVERSE_PROPORTION_CONSTRUCTION_FIXTURE,
): InverseProportionCandidateFixture => {
	const driverNodeId = "inverse-proportion-driver";
	const followerNodeId = "inverse-proportion-follower";
	const binding: MotionGrammarBinding = {
		id: "inverse-proportion-candidate-binding",
		techniqueId: "inverse-proportion-link",
		targetIds: [driverNodeId, followerNodeId],
		roleMap: {
			driver: driverNodeId,
			follower: followerNodeId,
		},
		parameters: {
			expressionVersion: 1,
			mode: 1,
			strength: 1,
			anchorX: source.anchor.x,
			anchorY: source.anchor.y,
			axisX: source.axis.x,
			axisY: source.axis.y,
			radiusSum: source.radiusSum,
			clearance: source.clearance,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "inverse-proportion-candidate-scene",
		name: "Inverse Proportion Tangent Pair Candidate",
		artboard: {
			id: "inverse-proportion-candidate-artboard",
			name: "Inverse Proportion Candidate",
			width: 640,
			height: 360,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "inverse-proportion-candidate-layer",
				name: "Inverse Proportion Tangent Pair",
				visible: true,
				locked: false,
				nodes: [
					circleNode({
						id: driverNodeId,
						name: "Inverse Proportion driver",
						radius: DRIVER_BASE_RADIUS,
						position: {
							x: source.anchor.x - DRIVER_BASE_RADIUS,
							y: source.anchor.y,
						},
					}),
					circleNode({
						id: followerNodeId,
						name: "Inverse Proportion follower",
						radius: FOLLOWER_BASE_RADIUS,
						position: {
							x: source.anchor.x + FOLLOWER_BASE_RADIUS,
							y: source.anchor.y,
						},
					}),
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
					id: "inverse-proportion-driver-scale-x",
					target: { nodeId: driverNodeId, property: "scaleX" },
					keyframes: scaleKeyframes(),
				},
				{
					id: "inverse-proportion-driver-scale-y",
					target: { nodeId: driverNodeId, property: "scaleY" },
					keyframes: scaleKeyframes(),
				},
			],
			clips: [
				{
					id: "inverse-proportion-candidate-clip",
					name: "Inverse Proportion candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [
						"inverse-proportion-driver-scale-x",
						"inverse-proportion-driver-scale-y",
					],
					provenance: {
						source: "motion-grammar",
						label: "Inverse Proportion candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Inverse Proportion",
						targetIds: [...binding.targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
		driverNodeId,
		followerNodeId,
	};
};
