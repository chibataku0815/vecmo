import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type { CountGrowthCandidateRoleMapping } from "./count-growth-presentation-candidate";
import type {
	CountGrowthReferenceInput,
	CountGrowthReferenceTarget,
} from "./count-growth-reference-oracle";
import type { MotionGrammarBinding } from "./types";

/** Stable structural fixture for Count Growth oracle/candidate comparison. */
export type CountGrowthCandidateFixture = {
	readonly source: CountGrowthReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly roleMappings: readonly CountGrowthCandidateRoleMapping[];
};

const TARGETS = [
	{ id: "count-growth-core", role: "core" as const, x: 224, y: 176 },
	{ id: "count-growth-arm", role: "arm" as const, x: 320, y: 144 },
	{ id: "count-growth-edge", role: "edge" as const, x: 416, y: 176 },
	{ id: "count-growth-member-4", role: "member" as const, x: 448, y: 272 },
	{ id: "count-growth-member-5", role: "member" as const, x: 320, y: 336 },
	{ id: "count-growth-member-6", role: "member" as const, x: 192, y: 272 },
] as const;

const node = (
	target: CountGrowthReferenceTarget["rest"] &
		Pick<CountGrowthReferenceTarget, "role"> & { readonly id: string },
): VectorNode => ({
	id: target.id,
	name: `Count Growth ${target.role}`,
	geometry: {
		kind: "ellipse",
		bounds: { x: -14, y: -14, width: 28, height: 28 },
	},
	transform: {
		position: { x: target.x, y: target.y },
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

export const COUNT_GROWTH_CONSTRUCTION_FIXTURE: CountGrowthReferenceInput = {
	periodFrames: 120,
	growFrames: 12,
	scaleFloor: 0.25,
	opacityFloor: 0.05,
	breathOpenFraction: 0.28,
	breathHoldFraction: 0.24,
	breathRadiusScale: 1.2,
	centerOffsetX: 0,
	centerOffsetY: 0,
	rotationDegrees: 180,
	edgeRailAmplitude: 18,
	groupStaggerFrames: 4,
	targets: TARGETS.map((target) => ({
		targetId: target.id,
		role: target.role,
		rest: { x: target.x, y: target.y },
	})),
};

/** Creates a six-member lattice fixture with explicit semantic roles. */
export const createCountGrowthCandidateFixture = (
	source: CountGrowthReferenceInput = COUNT_GROWTH_CONSTRUCTION_FIXTURE,
): CountGrowthCandidateFixture => {
	const targetIds = source.targets.map((target) => target.targetId);
	const roleMap = Object.fromEntries(
		source.targets.map((target) => [
			target.targetId,
			`count-growth:${target.role}`,
		]),
	);
	const binding: MotionGrammarBinding = {
		id: "count-growth-candidate-binding",
		techniqueId: "count-growth",
		targetIds,
		roleMap,
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			growFrames: source.growFrames,
			scaleFloor: source.scaleFloor,
			opacityFloor: source.opacityFloor,
			breathOpenFraction: source.breathOpenFraction,
			breathHoldFraction: source.breathHoldFraction,
			breathRadiusScale: source.breathRadiusScale,
			centerOffsetX: source.centerOffsetX,
			centerOffsetY: source.centerOffsetY,
			rotationDegrees: source.rotationDegrees,
			edgeRailAmplitude: source.edgeRailAmplitude,
			groupStaggerFrames: source.groupStaggerFrames,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "count-growth-candidate-scene",
		name: "Count Growth Lattice Candidate",
		artboard: {
			id: "count-growth-candidate-artboard",
			name: "Count Growth Candidate",
			width: 640,
			height: 480,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "count-growth-candidate-layer",
				name: "Count Growth Lattice",
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
					id: "count-growth-candidate-clip",
					name: "Count Growth candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Count Growth candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Count Growth",
						targetIds: [...targetIds],
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
