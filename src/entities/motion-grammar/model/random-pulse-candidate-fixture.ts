import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type { RandomPulseCandidateRoleMapping } from "./random-pulse-presentation-candidate";
import { RANDOM_PULSE_PROFILE_VERSION } from "./random-pulse-profile";
import {
	RANDOM_PULSE_CONSTRUCTION_FIXTURE,
	type RandomPulseReferenceInput,
} from "./random-pulse-reference-oracle";
import type {
	MotionGrammarBinding,
	MotionGrammarRandomPulseProfile,
} from "./types";

/**
 * Reusable evidence fixture for the Random Pulse candidate path.
 *
 * This is intentionally a field-only carrier with stable semantic ids. It is
 * not a product preset or a hidden source default; callers must still provide
 * the reference input and decide whether the field is eligible for review.
 */
export type RandomPulseCandidateFixture = {
	readonly source: RandomPulseReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly roleMappings: readonly RandomPulseCandidateRoleMapping[];
};

const node = (id: string, index: number): VectorNode => ({
	id,
	name: `Random Pulse cell ${index + 1}`,
	geometry: {
		kind: "ellipse",
		bounds: { x: -14, y: -14, width: 28, height: 28 },
	},
	transform: {
		position: {
			x: 140 + (index % 3) * 88,
			y: 120 + Math.floor(index / 3) * 88,
		},
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

const profileFromSource = (
	source: RandomPulseReferenceInput,
): MotionGrammarRandomPulseProfile => ({
	version: RANDOM_PULSE_PROFILE_VERSION,
	durationFrames: source.envelope.durationFrames,
	segments: source.envelope.segments.map((segment) => ({
		fromFrame: segment.fromFrame,
		toFrame: segment.toFrame,
		fromValue: segment.fromValue,
		toValue: segment.toValue,
		easing: segment.easing,
	})),
});

/** Creates a stable nine-cell field candidate for structural comparison. */
export const createRandomPulseCandidateFixture = (
	source: RandomPulseReferenceInput = RANDOM_PULSE_CONSTRUCTION_FIXTURE,
): RandomPulseCandidateFixture => {
	const targetIds = source.targets
		.slice()
		.sort((left, right) => left.rank - right.rank)
		.map((target) => target.targetId);
	const binding: MotionGrammarBinding = {
		id: "random-pulse-candidate-binding",
		techniqueId: "random-phase-pulse",
		targetIds,
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			cadenceFrames: source.cadenceFrames,
			pulseFrames: source.envelope.durationFrames,
			scaleAmplitude: source.scaleAmplitude,
			opacityFloor: source.opacityFloor,
		},
		seed: 13,
		randomPulseProfile: profileFromSource(source),
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "random-pulse-candidate-scene",
		name: "Random Pulse Candidate Field",
		artboard: {
			id: "random-pulse-candidate-artboard",
			name: "Random Pulse Candidate",
			width: 520,
			height: 360,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
		},
		layers: [
			{
				id: "random-pulse-candidate-layer",
				name: "Random Pulse Field",
				visible: true,
				locked: false,
				nodes: targetIds.map((targetId, index) => node(targetId, index)),
			},
		],
	};
	const roleMappings = targetIds.map((targetId) => ({
		sourceTargetId: targetId,
		candidateNodeId: targetId,
	}));
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
					id: "random-pulse-candidate-clip",
					name: "Random Pulse candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Random Pulse candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Random Pulse",
						targetIds: [...binding.targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
		roleMappings,
	};
};
