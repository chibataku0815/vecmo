import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	INTERFERENCE_CONSTRUCTION_FIXTURE,
	type InterferenceReferenceInput,
} from "./interference-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export type InterferenceCandidateFixture = {
	readonly source: InterferenceReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly driverNodeId: string;
	readonly ringNodeIds: readonly string[];
};

const driverNodeId = "interference-driver";
const node = (
	id: string,
	name: string,
	position: { readonly x: number; readonly y: number },
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
	style: { fill: "#73d13d", stroke: "#191817", strokeWidth: 2, opacity: 1 },
	visible: true,
	locked: false,
});

const trackCurve = { x1: 0, y1: 0, x2: 1, y2: 1 } as const;

export const createInterferenceCandidateFixture = (
	source: InterferenceReferenceInput = INTERFERENCE_CONSTRUCTION_FIXTURE,
): InterferenceCandidateFixture => {
	const ringNodeIds = source.targets.map((target) => target.targetId);
	const binding: MotionGrammarBinding = {
		id: "interference-candidate-binding",
		techniqueId: "ring-wave-interference",
		targetIds: [driverNodeId, ...ringNodeIds],
		roleMap: {
			"ring-wave-interference:driver": driverNodeId,
			...Object.fromEntries(
				ringNodeIds.map((nodeId) => [nodeId, "ring-wave-interference:ring"]),
			),
		},
		parameters: {
			expressionVersion: 1,
			periodFrames: source.periodFrames,
			wavelengthPx: 72,
			scaleAmplitude: source.scaleAmplitude,
			opacityFloor: source.opacityFloor,
			centerX: source.center.x,
			centerY: source.center.y,
			ringRadius: source.ringRadius,
			pulseRadius: source.pulseRadius,
			driverOrbitRadius: 48,
			phaseStepDegrees: source.phaseStepDegrees,
			radialPush: source.radialPush,
			tangentialSlide: source.tangentialSlide,
			falloffDistance: source.falloffDistance,
			falloffExponent: source.falloffExponent,
			minDistance: source.minDistance,
		},
		effectBinding: { kind: "none" },
	};
	const scene: SceneDocument = {
		schemaVersion: 1,
		id: "interference-candidate-scene",
		name: "Interference Orbit Field Candidate",
		artboard: {
			id: "interference-candidate-artboard",
			name: "Interference Candidate",
			width: 640,
			height: 360,
			background: "#f4f3ef",
			fps: 30,
			durationFrames: source.periodFrames,
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "interference-candidate-layer",
				name: "Interference Field",
				visible: true,
				locked: false,
				nodes: [
					node(driverNodeId, "Orbit driver", { x: 368, y: 180 }),
					...source.targets.map((target) =>
						node(target.targetId, `Ring ${target.index + 1}`, target.rest),
					),
				],
			},
		],
	};
	const points = [
		{ time: 0, x: 368, y: 180 },
		{ time: 24, x: 320, y: 228 },
		{ time: 48, x: 272, y: 180 },
		{ time: 72, x: 320, y: 132 },
		{ time: 96, x: 368, y: 180 },
	];
	const tracks = ["x", "y"].map((property) => ({
		id: `interference-driver-${property}`,
		target: { nodeId: driverNodeId, property: property as "x" | "y" },
		keyframes: points.map((point) => ({
			time: point.time,
			value: property === "x" ? point.x : point.y,
			outTemporalCurve: point.time < 96 ? trackCurve : undefined,
		})),
	}));
	return {
		source,
		scene,
		motion: {
			schemaVersion: 1,
			fps: 30,
			durationFrames: source.periodFrames,
			tracks,
			clips: [
				{
					id: "interference-candidate-clip",
					name: "Interference candidate",
					startFrame: 0,
					durationFrames: source.periodFrames,
					trackIds: tracks.map((track) => track.id),
					provenance: {
						source: "motion-grammar",
						label: "Interference candidate",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Interference",
						targetIds: [...binding.targetIds],
						generatedNodeIds: [],
					},
				},
			],
		},
		binding,
		bindings: [binding],
		driverNodeId,
		ringNodeIds,
	};
};
