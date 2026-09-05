import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentDocumentContext } from "@/entities/agent/model/read-only";
import type { AgentSceneCommand } from "@/entities/agent/model/types";
import { applyAgentSceneCommands } from "@/entities/agent/model/write";
import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import { EMPTY_GRAMMAR_DOCUMENT } from "@/entities/motion-grammar/model/command";
import { allNodes } from "@/entities/scene/model/selectors";
import {
	type BezierShape,
	SCENE_SCHEMA_VERSION,
	type SceneDocument,
	type Vec2,
} from "@/entities/scene/model/types";
import { renderSceneSvgWithIssues } from "@/features/export/model/svg";

const OUTPUT_DIR = path.resolve(
	process.cwd(),
	"artifacts/noise-gradient-cube-capability-probe",
);
const ARTBOARD_WIDTH = 1400;
const ARTBOARD_HEIGHT = 820;
const ARTBOARD_ID = "noise-gradient-cube-capability-probe";
const NOISE_SCALE = 0.78;
const GRAIN_STRENGTH = 0.42;

type FaceRole = "top" | "left" | "right";

type FaceSpec = {
	readonly role: FaceRole;
	readonly points: readonly Vec2[];
	readonly gradient: {
		readonly from: Vec2;
		readonly to: Vec2;
		readonly stops: readonly {
			readonly offset: number;
			readonly color: string;
		}[];
	};
	readonly linearField: {
		readonly x1: number;
		readonly y1: number;
		readonly x2: number;
		readonly y2: number;
		readonly plateau: number;
	};
};

/** Builds one sharp, closed four-point face in the scene's AE-shape format. */
const closedShape = (points: readonly Vec2[]): BezierShape => ({
	type: "Shape",
	vertices: points.map((point) => [point.x, point.y]),
	inTangents: points.map(() => [0, 0]),
	outTangents: points.map(() => [0, 0]),
	closed: true,
});

/**
 * Returns three editable isometric faces. Fill and Noise Gradient axes share
 * one implied upper-left light world, while each face keeps local geometry.
 */
const cubeFaces = (centerX: number): readonly FaceSpec[] => {
	const top = { x: centerX, y: 145 };
	const rightTop = { x: centerX + 190, y: 265 };
	const center = { x: centerX, y: 385 };
	const leftTop = { x: centerX - 190, y: 265 };
	const rightBottom = { x: centerX + 190, y: 535 };
	const bottom = { x: centerX, y: 655 };
	const leftBottom = { x: centerX - 190, y: 535 };

	return [
		{
			role: "top",
			points: [top, rightTop, center, leftTop],
			gradient: {
				from: leftTop,
				to: rightTop,
				stops: [
					{ offset: 0, color: "#f8f8f6" },
					{ offset: 0.46, color: "#b7b7b4" },
					{ offset: 1, color: "#4b4b4a" },
				],
			},
			linearField: {
				x1: 1.15,
				y1: 0.5,
				x2: -0.35,
				y2: 0.5,
				plateau: 0.04,
			},
		},
		{
			role: "left",
			points: [leftTop, center, bottom, leftBottom],
			gradient: {
				from: leftTop,
				to: bottom,
				stops: [
					{ offset: 0, color: "#50504f" },
					{ offset: 0.58, color: "#a8a8a5" },
					{ offset: 1, color: "#efefec" },
				],
			},
			linearField: {
				x1: -0.15,
				y1: -0.15,
				x2: 1.35,
				y2: 1.35,
				plateau: 0.04,
			},
		},
		{
			role: "right",
			points: [center, rightTop, rightBottom, bottom],
			gradient: {
				from: rightTop,
				to: bottom,
				stops: [
					{ offset: 0, color: "#f7f7f4" },
					{ offset: 0.43, color: "#b9b9b6" },
					{ offset: 1, color: "#303030" },
				],
			},
			linearField: {
				x1: -0.15,
				y1: 1.15,
				x2: 1.25,
				y2: -0.25,
				plateau: 0.04,
			},
		},
	];
};

/**
 * Rewrites generated ids before scoped-look conversion so every derived graph
 * and SVG filter id is stable across runs, including ids stored as object keys.
 */
const remapIds = (
	value: unknown,
	map: ReadonlyMap<string, string>,
): unknown => {
	if (typeof value === "string") return map.get(value) ?? value;
	if (Array.isArray(value)) return value.map((item) => remapIds(item, map));
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			output[map.get(key) ?? key] = remapIds(item, map);
		}
		return output;
	}
	return value;
};

/** Crops an exported SVG by rewriting only its root viewport attributes. */
const cropSvg = (
	svg: string,
	crop: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
): string =>
	svg
		.replace(
			/viewBox="[^"]+"/,
			`viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"`,
		)
		.replace(/width="[^"]+"/, `width="${crop.width}"`)
		.replace(/height="[^"]+"/, `height="${crop.height}"`);

const wrapHtml = (svg: string): string =>
	`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f2ece4}svg{display:block}</style></head><body>${svg}</body></html>`;

const sha256 = (value: Uint8Array | string): string =>
	createHash("sha256").update(value).digest("hex");

mkdirSync(OUTPUT_DIR, { recursive: true });

const artboard = {
	id: ARTBOARD_ID,
	name: "Noise Gradient cube capability probe",
	position: { x: 0, y: 0 },
	width: ARTBOARD_WIDTH,
	height: ARTBOARD_HEIGHT,
	background: "#f2ece4",
	fps: 30,
	durationFrames: 1,
};

const baseScene: SceneDocument = {
	schemaVersion: SCENE_SCHEMA_VERSION,
	id: ARTBOARD_ID,
	name: "Noise Gradient cube capability probe",
	artboard,
	artboards: [artboard],
	currentArtboardId: artboard.id,
	layers: [
		{
			id: "noise-gradient-cube-layer",
			name: "Cube comparison",
			visible: true,
			locked: false,
			nodes: [],
		},
	],
};

const smoothFaces = cubeFaces(390);
const texturedFaces = cubeFaces(1010);
const appendCommands: AgentSceneCommand[] = [];
for (const [prefix, faces] of [
	["smooth", smoothFaces],
	["textured", texturedFaces],
] as const) {
	for (const face of faces) {
		appendCommands.push({
			type: "scene/append-node",
			node: {
				name: `${prefix}-${face.role}`,
				geometry: { kind: "path", shape: closedShape(face.points) },
				style: {
					strokeWidth: 0,
					fills: [
						{
							kind: "linear-gradient",
							from: face.gradient.from,
							to: face.gradient.to,
							stops: face.gradient.stops,
						},
					],
				},
			},
		});
	}
}

const context: AgentDocumentContext = {
	scene: baseScene,
	motion: structuredClone(initialMotionDocument),
	grammar: EMPTY_GRAMMAR_DOCUMENT,
};
const built = applyAgentSceneCommands(context, { commands: appendCommands });
const buildErrors = built.issues.filter((issue) => issue.severity === "error");
if (!built.ok || buildErrors.length > 0) {
	throw new Error(
		`Cube build failed: ${buildErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
	);
}

const generatedNodes = allNodes(built.data.scene);
const stableIdMap = new Map<string, string>();
for (const prefix of ["smooth", "textured"] as const) {
	for (const role of ["top", "left", "right"] as const) {
		const name = `${prefix}-${role}`;
		const node = generatedNodes.find((candidate) => candidate.name === name);
		if (!node) throw new Error(`Missing generated face "${name}".`);
		stableIdMap.set(node.id, `noise-gradient-cube-${name}`);
	}
}
const stableScene = remapIds(built.data.scene, stableIdMap) as SceneDocument;

const textureCommands: AgentSceneCommand[] = [];
for (const face of texturedFaces) {
	const nodeId = `noise-gradient-cube-textured-${face.role}`;
	textureCommands.push(
		{
			type: "scene/set-bindable-property",
			nodeId,
			propertyId: "effect.node-look.noiseScale",
			value: NOISE_SCALE,
		},
		{
			type: "scene/author-object-noise-gradient",
			nodeId,
			fieldMode: "linear",
			linearField: face.linearField,
			grainStrength: GRAIN_STRENGTH,
			blendMode: "hard-light",
			mode: "mixed",
		},
	);
}

const textured = applyAgentSceneCommands(
	{ ...context, scene: stableScene },
	{ commands: textureCommands },
);
const textureErrors = textured.issues.filter(
	(issue) => issue.severity === "error",
);
if (!textured.ok || textureErrors.length > 0) {
	throw new Error(
		`Texture authoring failed: ${textureErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
	);
}

const svgResult = renderSceneSvgWithIssues({
	scene: textured.data.scene,
	motion: { ...initialMotionDocument, durationFrames: 1 },
	frame: 0,
});
const smoothClose = cropSvg(svgResult.contents, {
	x: 175,
	y: 110,
	width: 430,
	height: 590,
});
const texturedClose = cropSvg(svgResult.contents, {
	x: 795,
	y: 110,
	width: 430,
	height: 590,
});

const generatedFiles = new Map<string, string>([
	["comparison.svg", svgResult.contents],
	["comparison.html", wrapHtml(svgResult.contents)],
	["smooth-close.svg", smoothClose],
	["smooth-close.html", wrapHtml(smoothClose)],
	["textured-close.svg", texturedClose],
	["textured-close.html", wrapHtml(texturedClose)],
	["scene.json", `${JSON.stringify(textured.data.scene, null, 2)}\n`],
	[
		"render-report.json",
		`${JSON.stringify(
			{
				buildIssues: built.issues,
				textureIssues: textured.issues,
				renderIssues: svgResult.issues,
				containsTurbulence: svgResult.contents.includes("feTurbulence"),
				containsLinearFieldImage: svgResult.contents.includes("feImage"),
				containsHardLightBlend:
					svgResult.contents.includes('mode="hard-light"'),
				parameters: {
					noiseScale: NOISE_SCALE,
					grainStrength: GRAIN_STRENGTH,
					blendMode: "hard-light",
					materialMode: "mixed",
					fieldMode: "linear",
				},
			},
			null,
			2,
		)}\n`,
	],
]);

for (const [name, contents] of generatedFiles) {
	writeFileSync(path.join(OUTPUT_DIR, name), contents, "utf8");
}

const hashes = Object.fromEntries(
	[...generatedFiles.keys()].map((name) => {
		const bytes = readFileSync(path.join(OUTPUT_DIR, name));
		return [name, sha256(bytes)] as const;
	}),
);
writeFileSync(
	path.join(OUTPUT_DIR, "generated-hashes.json"),
	`${JSON.stringify(hashes, null, 2)}\n`,
	"utf8",
);

console.log(`Wrote deterministic Noise Gradient cube probe to ${OUTPUT_DIR}`);
console.log(`Render issues: ${svgResult.issues.length}`);
