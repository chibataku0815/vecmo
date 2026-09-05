import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	PARALLAX_AXIS_DEGREES_DEFAULT,
	PARALLAX_DESCENT_FRACTION_DEFAULT,
	PARALLAX_FAR_AMPLITUDE_DEFAULT,
	PARALLAX_MID_AMPLITUDE_DEFAULT,
	PARALLAX_NEAR_AMPLITUDE_DEFAULT,
	PARALLAX_PERIOD_DEFAULT,
	PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT,
} from "./catalog";
import type {
	ParallaxReferenceInput,
	ParallaxReferenceRole,
} from "./parallax-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export type ParallaxCandidateFixture = {
	readonly source: ParallaxReferenceInput;
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
	{ id: "parallax-near", role: "near" as const, x: 208, y: 200 },
	{ id: "parallax-mid", role: "mid" as const, x: 320, y: 240 },
	{ id: "parallax-far", role: "far" as const, x: 432, y: 280 },
	{ id: "parallax-near-2", role: "near" as const, x: 208, y: 320 },
	{ id: "parallax-far-2", role: "far" as const, x: 432, y: 160 },
] as const;

export const PARALLAX_CONSTRUCTION_FIXTURE: ParallaxReferenceInput = {
	periodFrames: PARALLAX_PERIOD_DEFAULT,
	descentFraction: PARALLAX_DESCENT_FRACTION_DEFAULT,
	axisDegrees: PARALLAX_AXIS_DEGREES_DEFAULT,
	phaseOffsetFrames: PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT,
	nearAmplitude: PARALLAX_NEAR_AMPLITUDE_DEFAULT,
	midAmplitude: PARALLAX_MID_AMPLITUDE_DEFAULT,
	farAmplitude: PARALLAX_FAR_AMPLITUDE_DEFAULT,
	targets: TARGETS.map((target) => ({
		targetId: target.id,
		role: target.role,
		rest: { x: target.x, y: target.y },
	})),
};

const node = (target: {
	readonly id: string;
	readonly role: ParallaxReferenceRole;
	readonly x: number;
	readonly y: number;
}): VectorNode => ({
	id: target.id,
	name: `Parallax ${target.role}`,
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
	style: { fill: "#73d13d", stroke: "#191817", strokeWidth: 2, opacity: 1 },
	visible: true,
	locked: false,
});

export const createParallaxCandidateFixture = (
	source: ParallaxReferenceInput = PARALLAX_CONSTRUCTION_FIXTURE,
): ParallaxCandidateFixture => {
	const targetIds = source.targets.map((target) => target.targetId);
	const binding: MotionGrammarBinding = {
		id: "parallax-candidate-binding",
		techniqueId: "size-speed-parallax",
		targetIds,
		roleMap: Object.fromEntries(
			source.targets.map((target) => [
				target.targetId,
				`size-speed-parallax:${target.role}`,
			]),
		),
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			descentFraction: source.descentFraction,
			axisDegrees: source.axisDegrees,
			phaseOffsetFrames: source.phaseOffsetFrames,
			nearAmplitude: source.nearAmplitude,
			midAmplitude: source.midAmplitude,
			farAmplitude: source.farAmplitude,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "parallax-candidate-scene",
		name: "Parallax Shared Wave Candidate",
		artboard: {
			id: "parallax-candidate-artboard",
			name: "Parallax Candidate",
			width: 640,
			height: 480,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "parallax-candidate-layer",
				name: "Parallax Field",
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
					id: "parallax-candidate-clip",
					name: "Parallax candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Parallax candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Parallax",
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
