import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	SYMMETRY_CONSTRUCTION_FIXTURE,
	type SymmetryReferenceInput,
} from "./symmetry-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export type SymmetryCandidateFixture = {
	readonly source: SymmetryReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
};

const node = (
	target: SymmetryReferenceInput["targets"][number],
): VectorNode => ({
	id: target.targetId,
	name: `Symmetry ${target.role}`,
	geometry: {
		kind: "ellipse",
		bounds: { x: -22, y: -22, width: 44, height: 44 },
	},
	transform: {
		position: target.rest,
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill: target.role === "center" ? "#ffb000" : "#73d13d",
		stroke: "#191817",
		strokeWidth: 2,
		opacity: 1,
	},
	visible: true,
	locked: false,
});

export const createSymmetryCandidateFixture = (
	source: SymmetryReferenceInput = SYMMETRY_CONSTRUCTION_FIXTURE,
): SymmetryCandidateFixture => {
	const binding: MotionGrammarBinding = {
		id: "symmetry-candidate-binding",
		techniqueId: "mirror-symmetric-scale",
		targetIds: source.targets.map((target) => target.targetId),
		roleMap: Object.fromEntries(
			source.targets.map((target) => [
				`mirror-symmetric-scale:${target.role}`,
				target.targetId,
			]),
		),
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			riseFrames: source.riseFrames,
			holdFrames: source.holdFrames,
			outerTranslation: source.outerTranslation,
			innerTranslation: source.innerTranslation,
			outerScale: source.outerScale,
			innerScale: source.innerScale,
			centerScale: source.centerScale,
			centerRotationDegrees: source.centerRotationDegrees,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "symmetry-candidate-scene",
		name: "Symmetry Shared Pulse Candidate",
		artboard: {
			id: "symmetry-candidate-artboard",
			name: "Symmetry Candidate",
			width: 640,
			height: 360,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "symmetry-candidate-layer",
				name: "Symmetry Roles",
				visible: true,
				locked: false,
				nodes: source.targets.map(node),
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
					id: "symmetry-candidate-clip",
					name: "Symmetry candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Symmetry candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Symmetry",
						targetIds: [...binding.targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
	};
};
