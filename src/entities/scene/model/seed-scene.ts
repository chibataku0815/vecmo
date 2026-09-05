import type { Artboard, BezierShape, SceneDocument, VectorNode } from "./types";
import { IDENTITY_TRANSFORM, SCENE_SCHEMA_VERSION } from "./types";

const blankMainArtboard = {
	id: "artboard-main",
	name: "Artboard 1",
	position: { x: 0, y: 0 },
	width: 1280,
	height: 720,
	background: "#ffffff",
	fps: 30,
	durationFrames: 180,
} satisfies Artboard;

/**
 * Runtime document for a new editor session. The first paint should be an
 * authoring surface, not a bundled poster/demo, while keeping a writable layer
 * so drawing/import commands can append objects immediately.
 */
export const blankSceneDocument: SceneDocument = {
	schemaVersion: SCENE_SCHEMA_VERSION,
	id: "scene-primary",
	name: "Untitled",
	artboard: blankMainArtboard,
	artboards: [blankMainArtboard],
	currentArtboardId: blankMainArtboard.id,
	layers: [
		{
			id: "layer-main",
			name: "Layer 1",
			visible: true,
			locked: false,
			nodes: [],
		},
	],
};

const seedSplineShape: BezierShape = {
	type: "Shape",
	closed: false,
	vertices: [
		[308, 436],
		[716, 342],
		[984, 198],
	],
	inTangents: [
		[0, 0],
		[-84, -204],
		[-54, 246],
	],
	outTangents: [
		[148, -310],
		[68, 168],
		[0, 0],
	],
};

const seedMainArtboard = {
	id: "artboard-main",
	name: "Motion Poster 01",
	position: { x: 0, y: 0 },
	width: 1280,
	height: 720,
	background: "#f7f4eb",
	fps: 30,
	durationFrames: 180,
} satisfies Artboard;

const seedSquareArtboard = {
	id: "artboard-square",
	name: "Motion Poster Square",
	position: { x: 1440, y: 0 },
	width: 720,
	height: 720,
	background: "#f8fafc",
	fps: 30,
	durationFrames: 180,
} satisfies Artboard;

/**
 * Initial document used by the editor and tests. It is intentionally a plain
 * object tree with identity transforms so the migrated model renders the same
 * seed scene as the original shell.
 */
export const initialSceneDocument: SceneDocument = {
	schemaVersion: SCENE_SCHEMA_VERSION,
	id: "scene-primary",
	name: "Motion Vector Study",
	artboard: seedMainArtboard,
	artboards: [seedMainArtboard, seedSquareArtboard],
	currentArtboardId: seedMainArtboard.id,
	layers: [
		{
			id: "layer-motion-guides",
			name: "motion guides",
			visible: true,
			locked: false,
			nodes: [
				{
					id: "node-spline",
					name: "orbit spline",
					artboardId: seedMainArtboard.id,
					geometry: {
						kind: "path",
						shape: seedSplineShape,
					},
					transform: IDENTITY_TRANSFORM,
					style: {
						fill: "none",
						stroke: "#2ec4b6",
						strokeWidth: 18,
						opacity: 0.95,
						strokeCap: "round",
						strokeJoin: "round",
					},
					visible: true,
					locked: false,
				},
			],
		},
		{
			id: "layer-forms",
			name: "vector forms",
			visible: true,
			locked: false,
			nodes: [
				{
					id: "node-panel",
					name: "signal card",
					artboardId: seedMainArtboard.id,
					geometry: {
						kind: "rect",
						bounds: { x: 352, y: 224, width: 360, height: 248 },
						cornerRadius: 18,
					},
					transform: IDENTITY_TRANSFORM,
					style: {
						fill: "#191817",
						stroke: "#ebe7dd",
						strokeWidth: 3,
						opacity: 1,
					},
					visible: true,
					locked: false,
				},
				{
					id: "node-sun",
					name: "amber emitter",
					artboardId: seedMainArtboard.id,
					geometry: {
						kind: "ellipse",
						bounds: { x: 762, y: 186, width: 178, height: 178 },
					},
					transform: IDENTITY_TRANSFORM,
					style: {
						fill: "#f4c430",
						stroke: "#191817",
						strokeWidth: 4,
						opacity: 1,
					},
					visible: true,
					locked: false,
				},
				{
					id: "node-coral",
					name: "coral block",
					artboardId: seedMainArtboard.id,
					geometry: {
						kind: "rect",
						bounds: { x: 738, y: 390, width: 194, height: 112 },
						cornerRadius: 18,
					},
					transform: IDENTITY_TRANSFORM,
					style: {
						fill: "#ff5a5f",
						stroke: "#191817",
						strokeWidth: 4,
						opacity: 1,
					},
					visible: true,
					locked: false,
				},
			],
		},
		{
			id: "layer-type",
			name: "type",
			visible: true,
			locked: false,
			nodes: [
				{
					id: "node-title",
					name: "scene label",
					artboardId: seedMainArtboard.id,
					geometry: {
						kind: "text",
						bounds: { x: 394, y: 300, width: 276, height: 78 },
						text: "VECTOR\nMOTION",
					},
					transform: IDENTITY_TRANSFORM,
					style: {
						fill: "#ebe7dd",
						stroke: "none",
						strokeWidth: 0,
						opacity: 1,
					},
					visible: true,
					locked: false,
				},
			],
		},
	],
};

export const seedScene = initialSceneDocument;

export const allSceneNodes = initialSceneDocument.layers.flatMap(
	(layer) => layer.nodes,
);

export function findSeedNode(nodeId: string): VectorNode | undefined {
	return allSceneNodes.find((node) => node.id === nodeId);
}
