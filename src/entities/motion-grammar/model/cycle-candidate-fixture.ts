import type { MotionDocument } from "@/entities/motion/model/types";
import { sampleNodePathMetric } from "@/entities/scene/model/path-metrics";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import type {
	CycleReferenceInput,
	CycleReferencePathSample,
} from "./cycle-reference-oracle";
import type { MotionGrammarBinding } from "./types";

const ARTBOARD_ID = "cycle-candidate-artboard";
const PATH_NODE_ID = "cycle-candidate-path";
const BODY_NODE_ID = "cycle-candidate-body";
const HEAD_DOT_NODE_ID = "cycle-candidate-head-dot";
const PATH_LENGTH = 4 * Math.hypot(130, 130);
const PATH_VERTICES = [
	[320, 80],
	[450, 210],
	[320, 340],
	[190, 210],
] as const;

const pathShape = {
	type: "Shape" as const,
	closed: true,
	vertices: PATH_VERTICES.map(([x, y]) => [x, y] as [number, number]),
	inTangents: PATH_VERTICES.map(() => [0, 0] as [number, number]),
	outTangents: PATH_VERTICES.map(() => [0, 0] as [number, number]),
};

const ellipseNode = (
	id: string,
	name: string,
	position: { x: number; y: number },
): VectorNode => ({
	id,
	name,
	geometry: {
		kind: "ellipse",
		bounds: { x: -12, y: -12, width: 24, height: 24 },
	},
	transform: {
		position,
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill: "#191817",
		stroke: "none",
		strokeWidth: 0,
		opacity: 1,
	},
	visible: true,
	locked: false,
});

const pathNode = (): VectorNode => ({
	id: PATH_NODE_ID,
	name: "Cycle candidate closed path",
	geometry: { kind: "path", shape: pathShape },
	transform: {
		position: { x: 0, y: 0 },
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill: "none",
		stroke: "#73d13d",
		strokeWidth: 6,
		strokeDash: [PATH_LENGTH * 0.22, PATH_LENGTH * 0.78],
		opacity: 1,
	},
	visible: true,
	locked: false,
});

const sampleDiamond = (progress: number): CycleReferencePathSample => {
	const sampled = sampleNodePathMetric(pathNode(), progress);
	if (!sampled) throw new Error("Cycle fixture path metric did not sample.");
	return {
		point: sampled.point,
		tangent: sampled.tangent,
		angleDegrees: sampled.angleDegrees,
	};
};

export type CycleCandidateFixture = {
	readonly source: CycleReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly pathNodeId: string;
};

/** Closed diamond carrier with one body and one explicit head-dot role. */
export const createCycleCandidateFixture = (): CycleCandidateFixture => {
	const source: CycleReferenceInput = {
		periodFrames: 90,
		phaseStartFrame: 0,
		whipDurationFrames: 18,
		whipSpanFraction: 0.35,
		windowFraction: 0.22,
		headLagFraction: 0.04,
		pathLength: PATH_LENGTH,
		pathSampleAt: sampleDiamond,
	};
	const binding: MotionGrammarBinding = {
		id: "cycle-candidate-binding",
		techniqueId: "cyclic-path-travel",
		targetIds: [BODY_NODE_ID, HEAD_DOT_NODE_ID, PATH_NODE_ID],
		roleMap: {
			[BODY_NODE_ID]: "cyclic-path-travel:body",
			[HEAD_DOT_NODE_ID]: "cyclic-path-travel:head-dot",
			[PATH_NODE_ID]: "cyclic-path-travel:path",
		},
		parameters: {
			periodFrames: source.periodFrames,
			phaseOffsetDegrees: 0,
			phaseStartFrame: source.phaseStartFrame,
			whipDurationFrames: source.whipDurationFrames,
			whipSpanFraction: source.whipSpanFraction,
			phaseStepDegrees: 0,
			pathOffsetPx: 0,
			orientToTangent: 1,
			orientationOffsetDegrees: 0,
			windowFraction: source.windowFraction,
			headLagFraction: source.headLagFraction,
		},
		effectBinding: { kind: "none" },
	};
	const start = sampleDiamond(0).point;
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "cycle-candidate-scene",
		name: "Cycle closed-lap candidate",
		artboard: {
			id: ARTBOARD_ID,
			name: "Cycle candidate",
			width: 640,
			height: 420,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "cycle-candidate-layer",
				name: "Cycle carrier",
				visible: true,
				locked: false,
				nodes: [
					pathNode(),
					ellipseNode(BODY_NODE_ID, "Cycle body", start),
					ellipseNode(HEAD_DOT_NODE_ID, "Cycle head dot", start),
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
			tracks: [],
			clips: [
				{
					id: "cycle-candidate-clip",
					name: "Cycle candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Cycle candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Cycle",
						targetIds: [...binding.targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
		pathNodeId: PATH_NODE_ID,
	};
};
