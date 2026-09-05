import { removeLookNodeParamTrack } from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	type LookGraph,
	type LookGraphEdge,
	type LookGraphEndpoint,
	type LookGraphNode,
	type LookGraphValueType,
	lookGraphNodeLabel,
	lookGraphPortId,
	normalizeLookGraph,
	validateLookEdge,
} from "@/entities/scene/model/look-graph";
import { findArtboardById } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { BlendMode, SceneDocument } from "@/entities/scene/model/types";
import { useLookGraphSelectionStore } from "@/shared/editor-chrome/model/look-graph-selection";
import { createId } from "@/shared/lib/id";
import {
	resolveTextureParticleLinearField,
	type TextureRecipe,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
} from "@/shared/vec-core";
import {
	type AuthorableLookGraphNodeKind,
	type ConcreteFrameLookGraphTarget,
	createConnectLookGraphPortsCommand,
	createDisconnectLookGraphInputCommand,
	createInsertLookGraphNodeCommand,
	createInsertLookGraphStarterCommand,
	createInsertNoiseFieldBackgroundCommand,
	createInsertParticleDissolveNodeCommand,
	createMaterializeLookGraphCommand,
	createRemoveLookGraphNodeCommand,
	createReorderLookGraphNodeCommand,
	createSetFrameLookGraphCommand,
	createToggleLookGraphNodeCommand,
	createUpdateLookGraphNodeFieldCommand,
	createUpdateLookGraphNodeNumberCommand,
	type FrameLookGraphCommandResult,
	type FrameLookGraphTarget,
	type InsertLookGraphNodeOptions,
	type LookGraphNodeFieldPatch,
	type LookGraphNodeNumberPath,
	type LookGraphStarterId,
	type LookGraphTextureMode,
	lookGraphTargetKey,
	type RenderableLookGraphMaskSource,
	readFrameLookGraphForTarget,
	targetStoresExplicitLookGraph,
	targetUsesExplicitLookGraph,
} from "./look-graph-commands";
import {
	applyLookNodeParamKeyframe,
	isLookNodeParamAnimated,
	type LookNodeKeyframeContext,
	planLookNodeKeyframe,
} from "./look-node-keyframing";
import {
	type RisoPrintBloomDirection,
	seedRisoPrintBloom,
} from "./riso-print-bloom";

export type FrameLookGraphScope = "current-artboard" | "scene";

export type FrameLookGraphWorkspaceTarget =
	| {
			readonly scope: FrameLookGraphScope;
			readonly artboardId?: string | null;
	  }
	| Extract<
			FrameLookGraphTarget,
			{ readonly scope: "artboard" | "scoped-overlay" }
	  >;

export type FrameLookGraphConcreteTarget = Extract<
	ConcreteFrameLookGraphTarget,
	{ readonly scope: "scene" | "artboard" | "scoped-overlay" }
>;

/** Slider-facing projection of one numeric Look graph node field. */
export type FrameLookGraphNodeSliderSpec = {
	readonly path: LookGraphNodeNumberPath;
	readonly label: string;
	readonly value: number;
	readonly kind: "unipolar" | "bipolar" | "multiplier";
	readonly min: number;
	readonly max: number;
	readonly neutral: number;
	readonly step: number;
	readonly unit?: string;
};

/** Compact row model for one authorable Look graph node. */
export type FrameLookGraphEditingNode = {
	readonly id: string;
	readonly kind: AuthorableLookGraphNodeKind;
	readonly label: string;
	readonly enabled: boolean;
	readonly sliders: readonly FrameLookGraphNodeSliderSpec[];
	readonly canMoveUp: boolean;
	readonly canMoveDown: boolean;
};

/** Selector-derived state for frame Look graph authoring surfaces. */
export type FrameLookGraphEditingState = {
	readonly graphActive: boolean;
	readonly targetStoresGraph: boolean;
	readonly graphPresent: boolean;
	readonly graph: LookGraph | null;
	readonly nodes: readonly FrameLookGraphEditingNode[];
	readonly serialNodeIds: readonly string[];
	readonly target: FrameLookGraphConcreteTarget;
	readonly resetKey: string;
};

/** Held scrub gesture that collapses multiple node-number edits into one undo entry. */
export type FrameLookGraphNodeNumberGesture = {
	readonly update: (value: number) => void;
	readonly commit: () => void;
};

export type FrameLookGraphConnectResult =
	| { readonly kind: "applied" }
	| { readonly kind: "unchanged" }
	| { readonly kind: "missing-graph" }
	| { readonly kind: "invalid"; readonly message: string };

export type FrameLookGraphInputSourceOption = {
	readonly id: string;
	readonly endpoint: LookGraphEndpoint;
	readonly label: string;
	readonly replaces: boolean;
};

export type FrameLookGraphInputConnection = {
	readonly endpoint: LookGraphEndpoint;
	readonly name: string;
	readonly valueType: LookGraphValueType;
	readonly incoming: {
		readonly endpoint: LookGraphEndpoint;
		readonly label: string;
	} | null;
	readonly sourceOptions: readonly FrameLookGraphInputSourceOption[];
};

export const FRAME_LOOK_GRAPH_RENDERABLE_MASK_SOURCES = [
	"source-alpha",
	"previous-alpha",
	"previous-luminance",
] as const satisfies readonly RenderableLookGraphMaskSource[];

export const FRAME_LOOK_GRAPH_BLEND_MODES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
] as const satisfies readonly BlendMode[];

export const FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS = [
	"grade",
	"glow",
	"grain",
	"blur",
	"chromatic-fringe",
	"displace",
	"posterize",
	"color-map",
	"find-edges",
	"scanline",
	"halftone",
	"pixel-grid",
	"ordered-dither",
	"ascii-glyph",
	"block-mosaic",
	"noise-field",
	"warp",
	"lens",
	"kaleidoscope",
	"flow",
	"path-blur",
	"noise-source",
	"deep-glow",
	"riso",
	"colorama",
	"wave-warp",
	"bend-warp",
	"vhs-color",
	"vhs-tracking",
	"vhs-noise",
	"crt-display",
	"signal-glitch",
	"interlace",
] as const satisfies readonly AuthorableLookGraphNodeKind[];

export const FRAME_LOOK_GRAPH_WORKSPACE_NODE_KINDS = [
	...FRAME_LOOK_GRAPH_AUTHORABLE_NODE_KINDS,
	"mask",
	"composite",
] as const satisfies readonly AuthorableLookGraphNodeKind[];

export const FRAME_LOOK_GRAPH_NODE_KIND_LABELS = {
	grade: "Grade",
	glow: "Glow",
	grain: "Film Grain",
	blur: "Blur",
	"chromatic-fringe": "RGB Fringe",
	displace: "Static Displace",
	posterize: "Posterize",
	"color-map": "Color Map",
	"find-edges": "Find Edges",
	scanline: "Scanline",
	halftone: "Halftone",
	"pixel-grid": "Pixel Grid",
	"ordered-dither": "Ordered Dither",
	"ascii-glyph": "Glyph Mosaic",
	"block-mosaic": "Block Mosaic",
	"noise-field": "Static Noise",
	warp: "Bulge / Twirl",
	lens: "Lens",
	kaleidoscope: "Kaleidoscope",
	flow: "Flow Distort",
	"path-blur": "Path Blur",
	"noise-source": "Animated Noise",
	"deep-glow": "Deep Glow",
	riso: "Riso",
	colorama: "Colorama",
	"wave-warp": "Wave Warp",
	"bend-warp": "Bend Warp",
	"vhs-color": "VHS Color",
	"vhs-tracking": "VHS Tracking",
	"vhs-noise": "VHS Noise",
	"crt-display": "CRT Display",
	"signal-glitch": "Signal Glitch",
	interlace: "Interlace",
	mask: "Mask",
	composite: "Composite",
} as const satisfies Record<AuthorableLookGraphNodeKind, string>;

export const FRAME_LOOK_GRAPH_TEXTURE_MODE_OPTIONS = [
	{ value: "film-grain", label: "Film Grain" },
	{ value: "particle-dissolve", label: "Particle Dissolve" },
] as const satisfies readonly {
	readonly value: LookGraphTextureMode;
	readonly label: string;
}[];

export type FrameLookGraphParticleDirectionValue =
	| "edge"
	| "mesh"
	| "0"
	| "45"
	| "90"
	| "135"
	| "180"
	| "225"
	| "270"
	| "315"
	| "custom";

export const FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS = [
	{ value: "edge", label: "Circular" },
	{ value: "mesh", label: "Field Mesh" },
	{ value: "0", label: "Linear right" },
	{ value: "45", label: "Linear down-right" },
	{ value: "90", label: "Linear down" },
	{ value: "135", label: "Linear down-left" },
	{ value: "180", label: "Linear left" },
	{ value: "225", label: "Linear up-left" },
	{ value: "270", label: "Linear up" },
	{ value: "315", label: "Linear up-right" },
	{ value: "custom", label: "Custom" },
] as const satisfies readonly {
	readonly value: FrameLookGraphParticleDirectionValue;
	readonly label: string;
}[];

const frameLookGraphTargetForScope = (
	document: SceneDocument,
	scope: FrameLookGraphScope,
	artboardId?: string | null,
): FrameLookGraphConcreteTarget =>
	scope === "scene"
		? { scope: "scene" }
		: {
				scope: "artboard",
				artboardId:
					artboardId ?? document.currentArtboardId ?? document.artboard.id,
			};

const frameLookGraphTargetForWorkspaceTarget = (
	document: SceneDocument,
	target: FrameLookGraphWorkspaceTarget,
): FrameLookGraphConcreteTarget | null => {
	if (target.scope === "artboard") {
		return findArtboardById(document, target.artboardId) ? target : null;
	}
	if (target.scope === "scoped-overlay") {
		const artboard = findArtboardById(document, target.artboardId);
		const scopedLook = artboard?.effectIntent?.scopedLooks?.find(
			(look) =>
				look.kind === "look-graph-overlay" && look.id === target.scopedLookId,
		);
		return scopedLook ? target : null;
	}
	return frameLookGraphTargetForScope(
		document,
		target.scope,
		target.artboardId,
	);
};

const isAuthorableLookGraphNode = (
	node: LookGraphNode,
): node is LookGraphNode & { readonly kind: AuthorableLookGraphNodeKind } =>
	FRAME_LOOK_GRAPH_WORKSPACE_NODE_KINDS.includes(
		node.kind as AuthorableLookGraphNodeKind,
	);

const primaryImageInputName = (node: LookGraphNode): string =>
	node.kind === "composite" ? "base" : "image";

/** Reports whether a Film Grain graph node is authoring particle dissolve material. */
export const frameLookGraphNodeIsParticleTexture = (
	node: LookGraphNode,
): boolean =>
	node.payload.kind === "grain" &&
	(node.payload.texture.material.mode === "particle" ||
		node.payload.texture.material.mode === "mixed");

/** Maps a texture node payload to the user-facing mode selector value. */
export const frameLookGraphTextureModeForNode = (
	node: LookGraphNode,
): LookGraphTextureMode =>
	frameLookGraphNodeIsParticleTexture(node)
		? "particle-dissolve"
		: "film-grain";

/** Maps a particle texture field to the compact direction preset selector. */
export const frameLookGraphParticleDirectionValue = (
	texture: TextureRecipe,
): FrameLookGraphParticleDirectionValue => {
	const fieldMode = textureParticleFieldMode(texture);
	if (fieldMode === "mesh") return "mesh";
	if (fieldMode !== "linear") return "edge";
	const angle = textureParticleLinearFieldAngle(
		textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		),
	);
	const normalized = Math.round(((angle % 360) + 360) % 360);
	switch (normalized) {
		case 0:
		case 45:
		case 90:
		case 135:
		case 180:
		case 225:
		case 270:
		case 315:
			return String(normalized) as FrameLookGraphParticleDirectionValue;
		default:
			return "custom";
	}
};

const frameLookGraphMaskNodeProducesMatte = (node: LookGraphNode): boolean =>
	node.payload.kind === "mask" &&
	node.enabled &&
	node.payload.source !== "mask" &&
	(node.payload.influenceAssignmentIds?.length ?? 0) === 0;

/**
 * Mirrors Look Graph compile semantics for the `mask` input. A wire only counts
 * as a rendered matte when the producer is an enabled image-derived mask node.
 */
export const frameLookGraphNodeReceivesRenderableMask = (
	graph: LookGraph,
	nodeId: string,
): boolean => {
	const node = graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return false;
	return graph.edges.some((edge) => {
		if (edge.to.nodeId !== nodeId) return false;
		const inputPort = node.inputs.find((port) => port.id === edge.to.portId);
		if (inputPort?.name !== "mask") return false;
		const producer = graph.nodes.find(
			(candidate) => candidate.id === edge.from.nodeId,
		);
		return producer ? frameLookGraphMaskNodeProducesMatte(producer) : false;
	});
};

const frameLookGraphNodeDisplayLabel = (node: LookGraphNode): string => {
	if (node.payload.kind !== "grain") {
		return node.label || lookGraphNodeLabel(node.kind);
	}
	const defaultish =
		node.label === "" ||
		node.label === "Grain" ||
		node.label === "Film Grain" ||
		node.label === "Particle Dissolve";
	if (!defaultish) return node.label;
	return frameLookGraphNodeIsParticleTexture(node)
		? "Particle Dissolve"
		: "Film Grain";
};

const serialInputPortForNode = (node: LookGraphNode): string | null =>
	node.kind === "mask"
		? null
		: lookGraphPortId(node.id, "input", primaryImageInputName(node));

const frameLookGraphSerialNodeIds = (
	nodes: readonly LookGraphNode[],
	edges: readonly LookGraphEdge[],
	outputNodeId: string,
): readonly string[] => {
	const source = nodes.find((node) => node.kind === "source");
	const output = nodes.find((node) => node.id === outputNodeId);
	if (!source || !output || output.kind !== "output") return [];
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const ids: string[] = [source.id];
	const visited = new Set<string>(ids);
	let cursor = source.id;
	while (cursor !== output.id) {
		const next = edges.find((edge) => {
			const toNode = nodesById.get(edge.to.nodeId);
			const serialInputPort = toNode ? serialInputPortForNode(toNode) : null;
			return (
				edge.from.nodeId === cursor &&
				edge.from.portId === lookGraphPortId(cursor, "output", "image") &&
				serialInputPort !== null &&
				edge.to.portId === serialInputPort
			);
		})?.to.nodeId;
		if (!next || visited.has(next)) return [];
		ids.push(next);
		visited.add(next);
		cursor = next;
	}
	return ids;
};

const sliderSpec = (
	path: LookGraphNodeNumberPath,
	label: string,
	value: number,
	kind: FrameLookGraphNodeSliderSpec["kind"],
	min: number,
	max: number,
	neutral: number,
	step: number,
	unit?: string,
): FrameLookGraphNodeSliderSpec => ({
	path,
	label,
	value,
	kind,
	min,
	max,
	neutral,
	step,
	...(unit ? { unit } : {}),
});

export const frameLookGraphSlidersForNode = (
	node: LookGraphNode,
): readonly FrameLookGraphNodeSliderSpec[] => {
	switch (node.payload.kind) {
		case "grade":
			return [
				sliderSpec(
					"grade.exposure",
					"Exposure",
					node.payload.color.exposure,
					"bipolar",
					-4,
					4,
					0,
					0.05,
				),
				sliderSpec(
					"grade.contrast",
					"Contrast",
					node.payload.color.contrast,
					"multiplier",
					0,
					4,
					1,
					0.01,
					"x",
				),
				sliderSpec(
					"grade.saturation",
					"Saturate",
					node.payload.color.saturation,
					"multiplier",
					0,
					4,
					1,
					0.01,
					"x",
				),
			];
		case "glow":
			return [
				sliderSpec(
					"glow.strength",
					"Glow",
					node.payload.glow.bloom.strength,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"glow.radius",
					"Radius",
					node.payload.glow.bloom.radius,
					"unipolar",
					0,
					1,
					0.35,
					0.01,
				),
			];
		case "grain": {
			const texture = node.payload.texture;
			const particle = frameLookGraphNodeIsParticleTexture(node);
			const sliders = [
				sliderSpec(
					"grain.strength",
					particle ? "Amount" : "Grain",
					particle ? texture.grain.densityCoupling : texture.grain.strength,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"grain.size",
					"Size",
					texture.grain.size,
					"unipolar",
					0,
					1,
					0.3,
					0.01,
				),
			];
			if (!particle) return sliders;
			sliders.push(
				sliderSpec(
					"grain.extent",
					"Extent",
					texture.material.strength,
					"unipolar",
					0,
					1,
					0.65,
					0.01,
				),
				sliderSpec(
					"grain.softness",
					"Softness",
					1 - texture.material.particleContrast,
					"unipolar",
					0,
					1,
					0.65,
					0.01,
				),
			);
			if (textureParticleFieldMode(texture) === "linear") {
				sliders.push(
					sliderSpec(
						"grain.angle",
						"Angle",
						textureParticleLinearFieldAngle(
							textureParticleLinearFieldEffective(
								resolveTextureParticleLinearField(texture),
							),
						),
						"unipolar",
						0,
						360,
						0,
						1,
						"deg",
					),
				);
			}
			return sliders;
		}
		case "blur":
			return node.payload.radiusY === undefined
				? [
						sliderSpec(
							"blur.radius",
							"Radius",
							node.payload.radius,
							"unipolar",
							0,
							80,
							12,
							1,
							"px",
						),
					]
				: [
						sliderSpec(
							"blur.radius",
							"X",
							node.payload.radius,
							"unipolar",
							0,
							80,
							12,
							1,
							"px",
						),
						sliderSpec(
							"blur.radiusY",
							"Y",
							node.payload.radiusY,
							"unipolar",
							0,
							80,
							12,
							1,
							"px",
						),
					];
		case "chromatic-fringe":
			return [
				sliderSpec(
					"chromatic-fringe.amount",
					"Amount",
					node.payload.amount,
					"unipolar",
					0,
					10,
					0,
					0.1,
				),
			];
		case "displace":
			return [
				sliderSpec(
					"displace.scale",
					"Amount",
					node.payload.scale,
					"unipolar",
					0,
					60,
					16,
					1,
					"px",
				),
				sliderSpec(
					"displace.frequency",
					"Frequency",
					node.payload.frequency,
					"unipolar",
					0.005,
					0.2,
					0.03,
					0.005,
				),
				sliderSpec(
					"displace.octaves",
					"Complexity",
					node.payload.octaves,
					"unipolar",
					1,
					5,
					2,
					1,
				),
			];
		case "posterize":
			return [
				sliderSpec(
					"posterize.levels",
					"Levels",
					node.payload.levels,
					"unipolar",
					2,
					16,
					5,
					1,
				),
			];
		case "color-map":
			return [
				sliderSpec(
					"color-map.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
			];
		case "find-edges":
			return [
				sliderSpec(
					"find-edges.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
			];
		case "scanline":
			return [
				sliderSpec(
					"scanline.density",
					"Density",
					node.payload.density,
					"unipolar",
					4,
					240,
					8,
					1,
				),
				sliderSpec(
					"scanline.intensity",
					"Intensity",
					node.payload.intensity,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"scanline.softness",
					"Softness",
					node.payload.softness,
					"unipolar",
					0,
					1,
					0.15,
					0.01,
				),
				sliderSpec(
					"scanline.noiseMix",
					"Noise Mix",
					node.payload.noiseMix,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
			];
		case "halftone":
			return [
				sliderSpec(
					"halftone.cellSize",
					"Cell Size",
					node.payload.cellSize,
					"unipolar",
					4,
					80,
					16,
					1,
					"px",
				),
				sliderSpec(
					"halftone.dotSize",
					"Dot Size",
					node.payload.dotSize,
					"unipolar",
					0.25,
					1.5,
					0.85,
					0.01,
					"x",
				),
				sliderSpec(
					"halftone.contrast",
					"Contrast",
					node.payload.contrast,
					"unipolar",
					0,
					1,
					0.65,
					0.01,
				),
				sliderSpec(
					"halftone.angle",
					"Angle",
					node.payload.angle,
					"bipolar",
					-90,
					90,
					15,
					1,
					"deg",
				),
				sliderSpec(
					"halftone.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
			];
		case "pixel-grid":
			return [
				sliderSpec(
					"pixel-grid.cellSize",
					"Cell Size",
					node.payload.cellSize,
					"unipolar",
					4,
					96,
					16,
					1,
					"px",
				),
				sliderSpec(
					"pixel-grid.gap",
					"Gap",
					node.payload.gap,
					"unipolar",
					0,
					0.6,
					0.18,
					0.01,
				),
				sliderSpec(
					"pixel-grid.roundness",
					"Roundness",
					node.payload.roundness,
					"unipolar",
					0,
					1,
					0.6,
					0.01,
				),
				sliderSpec(
					"pixel-grid.brightness",
					"Brightness",
					node.payload.brightness,
					"unipolar",
					0,
					2,
					1.15,
					0.01,
					"x",
				),
				sliderSpec(
					"pixel-grid.contrast",
					"Contrast",
					node.payload.contrast,
					"unipolar",
					0,
					1,
					0.45,
					0.01,
				),
				sliderSpec(
					"pixel-grid.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
			];
		case "ordered-dither":
			return [
				sliderSpec(
					"ordered-dither.cellSize",
					"Cell Size",
					node.payload.cellSize,
					"unipolar",
					2,
					32,
					4,
					1,
					"px",
				),
				sliderSpec(
					"ordered-dither.matrixSize",
					"Matrix Size",
					node.payload.matrixSize,
					"unipolar",
					2,
					8,
					4,
					2,
					"x",
				),
				sliderSpec(
					"ordered-dither.levels",
					"Levels",
					node.payload.levels,
					"unipolar",
					2,
					8,
					2,
					1,
				),
				sliderSpec(
					"ordered-dither.contrast",
					"Contrast",
					node.payload.contrast,
					"unipolar",
					0,
					1,
					0.55,
					0.01,
				),
				sliderSpec(
					"ordered-dither.threshold",
					"Threshold",
					node.payload.threshold,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"ordered-dither.strength",
					"Strength",
					node.payload.strength,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
				sliderSpec(
					"ordered-dither.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
				sliderSpec(
					"ordered-dither.brightness",
					"Brightness",
					node.payload.brightness,
					"bipolar",
					-1,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"ordered-dither.gamma",
					"Gamma",
					node.payload.gamma,
					"multiplier",
					0.25,
					2.5,
					1,
					0.01,
					"x",
				),
			];
		case "ascii-glyph":
			return [
				sliderSpec(
					"ascii-glyph.cellSize",
					"Cell Size",
					node.payload.cellSize,
					"unipolar",
					8,
					96,
					16,
					1,
					"px",
				),
				sliderSpec(
					"ascii-glyph.glyphScale",
					"Glyph Size",
					node.payload.glyphScale,
					"multiplier",
					0.5,
					1.15,
					0.9,
					0.01,
					"x",
				),
				sliderSpec(
					"ascii-glyph.contrast",
					"Contrast",
					node.payload.contrast,
					"unipolar",
					0,
					1,
					0.6,
					0.01,
				),
				sliderSpec(
					"ascii-glyph.brightness",
					"Brightness",
					node.payload.brightness,
					"unipolar",
					0,
					2,
					1,
					0.01,
					"x",
				),
				sliderSpec(
					"ascii-glyph.densityBias",
					"Density Bias",
					node.payload.densityBias,
					"bipolar",
					-1,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"ascii-glyph.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
			];
		case "block-mosaic":
			return [
				sliderSpec(
					"block-mosaic.cellSize",
					"Cell Size",
					node.payload.cellSize,
					"unipolar",
					8,
					128,
					24,
					1,
					"px",
				),
				sliderSpec(
					"block-mosaic.gap",
					"Gap",
					node.payload.gap,
					"unipolar",
					0,
					0.55,
					0.1,
					0.01,
				),
				sliderSpec(
					"block-mosaic.bevel",
					"Bevel",
					node.payload.bevel,
					"unipolar",
					0,
					1,
					0.35,
					0.01,
				),
				sliderSpec(
					"block-mosaic.relief",
					"Relief",
					node.payload.relief,
					"unipolar",
					0,
					1,
					0.55,
					0.01,
				),
				sliderSpec(
					"block-mosaic.lightAngle",
					"Light Angle",
					node.payload.lightAngle,
					"bipolar",
					-180,
					180,
					-35,
					1,
					"deg",
				),
				sliderSpec(
					"block-mosaic.lightElevation",
					"Light Height",
					node.payload.lightElevation,
					"unipolar",
					0,
					1,
					0.55,
					0.01,
				),
				sliderSpec(
					"block-mosaic.contrast",
					"Contrast",
					node.payload.contrast,
					"unipolar",
					0,
					1,
					0.45,
					0.01,
				),
				sliderSpec(
					"block-mosaic.variation",
					"Variation",
					node.payload.variation,
					"unipolar",
					0,
					1,
					0.16,
					0.01,
				),
				sliderSpec(
					"block-mosaic.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
			];
		case "noise-field":
			return [
				sliderSpec(
					"noise-field.scale",
					"Scale",
					node.payload.scale,
					"unipolar",
					2,
					200,
					30,
					1,
				),
				sliderSpec(
					"noise-field.detail",
					"Detail",
					node.payload.detail,
					"unipolar",
					1,
					6,
					3,
					1,
				),
				sliderSpec(
					"noise-field.seed",
					"Seed",
					node.payload.seed,
					"unipolar",
					0,
					64,
					0,
					1,
				),
			];
		case "warp":
			return [
				sliderSpec(
					"warp.strength",
					"Amount",
					node.payload.strength,
					"bipolar",
					-1,
					1,
					0,
					0.02,
				),
				sliderSpec(
					"warp.centerX",
					"Center X",
					node.payload.centerX,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"warp.centerY",
					"Center Y",
					node.payload.centerY,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
			];
		case "lens":
			return [
				sliderSpec(
					"lens.size",
					"Size",
					node.payload.size,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"lens.convergence",
					"Convergence",
					node.payload.convergence,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"lens.centerX",
					"Center X",
					node.payload.centerX,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"lens.centerY",
					"Center Y",
					node.payload.centerY,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
			];
		case "kaleidoscope":
			return [
				sliderSpec(
					"kaleidoscope.segments",
					"Segments",
					node.payload.segments,
					"unipolar",
					2,
					24,
					6,
					1,
				),
				sliderSpec(
					"kaleidoscope.roll",
					"Rotation",
					node.payload.roll,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"kaleidoscope.centerX",
					"Center X",
					node.payload.centerX,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"kaleidoscope.centerY",
					"Center Y",
					node.payload.centerY,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
			];
		case "flow":
			return [
				sliderSpec(
					"flow.amount",
					"Amount",
					node.payload.amount,
					"unipolar",
					0,
					0.5,
					0,
					0.005,
				),
				sliderSpec(
					"flow.scale",
					"Detail",
					node.payload.scale,
					"unipolar",
					0.5,
					16,
					4,
					0.1,
				),
				sliderSpec(
					"flow.octaves",
					"Complexity",
					node.payload.octaves,
					"unipolar",
					1,
					6,
					3,
					1,
				),
				sliderSpec(
					"flow.evolution",
					"Evolution",
					node.payload.evolution,
					"unipolar",
					0,
					4,
					0,
					0.01,
				),
				sliderSpec(
					"flow.centerX",
					"Center X",
					node.payload.centerX,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"flow.centerY",
					"Center Y",
					node.payload.centerY,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
			];
		case "noise-source":
			return [
				sliderSpec(
					"noise-source.scale",
					"Scale",
					node.payload.scale,
					"unipolar",
					2,
					200,
					30,
					1,
				),
				sliderSpec(
					"noise-source.octaves",
					"Detail",
					node.payload.octaves,
					"unipolar",
					1,
					6,
					3,
					1,
				),
				sliderSpec(
					"noise-source.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					10,
					1,
					0.1,
				),
				sliderSpec(
					"noise-source.evolution",
					"Evolution",
					node.payload.evolution,
					"unipolar",
					0,
					8,
					0,
					0.01,
				),
			];
		case "deep-glow":
			return [
				sliderSpec(
					"deep-glow.radius",
					"Radius",
					node.payload.radius,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"deep-glow.intensity",
					"Exposure",
					node.payload.intensity,
					"unipolar",
					0,
					4,
					0.9,
					0.02,
				),
				sliderSpec(
					"deep-glow.threshold",
					"Threshold",
					node.payload.threshold,
					"unipolar",
					0,
					1,
					0.6,
					0.01,
				),
				sliderSpec(
					"deep-glow.chroma",
					"Fringe",
					node.payload.chroma,
					"unipolar",
					0,
					1,
					0.3,
					0.01,
				),
			];
		case "riso":
			return [
				sliderSpec(
					"riso.cellSize",
					"Cell Size",
					node.payload.cellSize,
					"unipolar",
					2,
					64,
					12,
					1,
					"px",
				),
				sliderSpec(
					"riso.dotSize",
					"Dot Size",
					node.payload.dotSize,
					"unipolar",
					0,
					1.5,
					0.9,
					0.01,
					"x",
				),
				sliderSpec(
					"riso.contrast",
					"Contrast",
					node.payload.contrast,
					"unipolar",
					0,
					1,
					0.62,
					0.01,
				),
				sliderSpec(
					"riso.grain",
					"Grain",
					node.payload.grain,
					"unipolar",
					0,
					1,
					0.32,
					0.01,
				),
				sliderSpec(
					"riso.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
				sliderSpec(
					"riso.bloomProgress",
					"Print On",
					node.payload.bloomProgress,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
				sliderSpec(
					"riso.amount",
					"Amount",
					node.payload.amount,
					"unipolar",
					0,
					1,
					1,
					0.01,
				),
				sliderSpec(
					"riso.fieldSoftness",
					"Field Softness",
					node.payload.field.softness,
					"unipolar",
					0,
					1,
					0.6,
					0.01,
				),
			];
		case "colorama":
			return [
				sliderSpec(
					"colorama.phase",
					"Phase",
					node.payload.phase,
					"unipolar",
					0,
					4,
					0,
					0.01,
				),
				sliderSpec(
					"colorama.repetitions",
					"Repetitions",
					node.payload.repetitions,
					"unipolar",
					1,
					32,
					1,
					1,
				),
				sliderSpec(
					"colorama.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
			];
		case "wave-warp":
			return [
				sliderSpec(
					"wave-warp.height",
					"Height",
					node.payload.height,
					"unipolar",
					0,
					2000,
					40,
					1,
					"px",
				),
				sliderSpec(
					"wave-warp.width",
					"Width",
					node.payload.width,
					"unipolar",
					1,
					4000,
					200,
					1,
					"px",
				),
				sliderSpec(
					"wave-warp.direction",
					"Direction",
					node.payload.direction,
					"unipolar",
					0,
					360,
					90,
					1,
					"deg",
				),
				sliderSpec(
					"wave-warp.phase",
					"Phase",
					node.payload.phase,
					"unipolar",
					0,
					4,
					0,
					0.01,
				),
			];
		case "bend-warp":
			return [
				sliderSpec(
					"bend-warp.bend",
					"Bend",
					node.payload.bend,
					"bipolar",
					-1,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"bend-warp.distortionH",
					"Distortion H",
					node.payload.distortionH,
					"bipolar",
					-1,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"bend-warp.distortionV",
					"Distortion V",
					node.payload.distortionV,
					"bipolar",
					-1,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"bend-warp.scale",
					"Scale",
					node.payload.scale,
					"multiplier",
					0.25,
					4,
					1,
					0.01,
					"x",
				),
			];
		case "vhs-color":
			return [
				sliderSpec(
					"vhs-color.bleed",
					"Bleed",
					node.payload.bleed,
					"unipolar",
					0,
					32,
					6,
					1,
					"px",
				),
				sliderSpec(
					"vhs-color.subsample",
					"Subsample",
					node.payload.subsample,
					"unipolar",
					1,
					8,
					2,
					1,
					"x",
				),
				sliderSpec(
					"vhs-color.colorUnder",
					"Color Under",
					node.payload.colorUnder,
					"unipolar",
					0,
					1,
					0.3,
					0.01,
				),
				sliderSpec(
					"vhs-color.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
			];
		case "vhs-tracking":
			return [
				sliderSpec(
					"vhs-tracking.jitter",
					"Jitter",
					node.payload.jitter,
					"unipolar",
					0,
					1,
					0.25,
					0.01,
				),
				sliderSpec(
					"vhs-tracking.wobble",
					"Wobble",
					node.payload.wobble,
					"unipolar",
					0,
					1,
					0.15,
					0.01,
				),
				sliderSpec(
					"vhs-tracking.tear",
					"Tear",
					node.payload.tear,
					"unipolar",
					0,
					1,
					0.3,
					0.01,
				),
				sliderSpec(
					"vhs-tracking.band",
					"Band",
					node.payload.band,
					"unipolar",
					0,
					1,
					0.2,
					0.01,
				),
				sliderSpec(
					"vhs-tracking.bandPosition",
					"Band Position",
					node.payload.bandPosition,
					"unipolar",
					0,
					1,
					0.92,
					0.01,
				),
				sliderSpec(
					"vhs-tracking.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					10,
					1,
					0.1,
				),
				sliderSpec(
					"vhs-tracking.seed",
					"Seed",
					node.payload.seed,
					"unipolar",
					0,
					64,
					0,
					1,
				),
				sliderSpec(
					"vhs-tracking.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
				sliderSpec(
					"vhs-tracking.evolution",
					"Evolution",
					node.payload.evolution,
					"unipolar",
					0,
					8,
					0,
					0.01,
				),
			];
		case "vhs-noise":
			return [
				sliderSpec(
					"vhs-noise.snow",
					"Snow",
					node.payload.snow,
					"unipolar",
					0,
					1,
					0.2,
					0.01,
				),
				sliderSpec(
					"vhs-noise.dropout",
					"Dropout",
					node.payload.dropout,
					"unipolar",
					0,
					1,
					0.15,
					0.01,
				),
				sliderSpec(
					"vhs-noise.dropoutLength",
					"Dropout Length",
					node.payload.dropoutLength,
					"unipolar",
					1,
					200,
					24,
					1,
					"px",
				),
				sliderSpec(
					"vhs-noise.generation",
					"Generation",
					node.payload.generation,
					"unipolar",
					1,
					5,
					2,
					1,
				),
				sliderSpec(
					"vhs-noise.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					10,
					1,
					0.1,
				),
				sliderSpec(
					"vhs-noise.seed",
					"Seed",
					node.payload.seed,
					"unipolar",
					0,
					64,
					0,
					1,
				),
				sliderSpec(
					"vhs-noise.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
				sliderSpec(
					"vhs-noise.evolution",
					"Evolution",
					node.payload.evolution,
					"unipolar",
					0,
					8,
					0,
					0.01,
				),
			];
		case "crt-display":
			return [
				sliderSpec(
					"crt-display.maskScale",
					"Mask Scale",
					node.payload.maskScale,
					"unipolar",
					1,
					24,
					4,
					1,
					"px",
				),
				sliderSpec(
					"crt-display.maskStrength",
					"Mask Strength",
					node.payload.maskStrength,
					"unipolar",
					0,
					1,
					0.5,
					0.01,
				),
				sliderSpec(
					"crt-display.curvature",
					"Curvature",
					node.payload.curvature,
					"unipolar",
					0,
					1,
					0.15,
					0.01,
				),
				sliderSpec(
					"crt-display.cornerRadius",
					"Corner Radius",
					node.payload.cornerRadius,
					"unipolar",
					0,
					1,
					0.08,
					0.01,
				),
				sliderSpec(
					"crt-display.vignette",
					"Vignette",
					node.payload.vignette,
					"unipolar",
					0,
					1,
					0.35,
					0.01,
				),
				sliderSpec(
					"crt-display.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
			];
		case "signal-glitch":
			return [
				sliderSpec(
					"signal-glitch.channelShift",
					"Channel Shift",
					node.payload.channelShift,
					"unipolar",
					0,
					32,
					3,
					0.5,
					"px",
				),
				sliderSpec(
					"signal-glitch.rollAmount",
					"Roll Amount",
					node.payload.rollAmount,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
				sliderSpec(
					"signal-glitch.tearDensity",
					"Tear Density",
					node.payload.tearDensity,
					"unipolar",
					0,
					1,
					0.1,
					0.01,
				),
				sliderSpec(
					"signal-glitch.tearStrength",
					"Tear Strength",
					node.payload.tearStrength,
					"unipolar",
					0,
					200,
					20,
					1,
					"px",
				),
				sliderSpec(
					"signal-glitch.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					10,
					1,
					0.1,
				),
				sliderSpec(
					"signal-glitch.seed",
					"Seed",
					node.payload.seed,
					"unipolar",
					0,
					64,
					0,
					1,
				),
				sliderSpec(
					"signal-glitch.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
				sliderSpec(
					"signal-glitch.evolution",
					"Evolution",
					node.payload.evolution,
					"unipolar",
					0,
					8,
					0,
					0.01,
				),
			];
		case "interlace":
			return [
				sliderSpec(
					"interlace.strength",
					"Strength",
					node.payload.strength,
					"unipolar",
					0,
					1,
					0.4,
					0.01,
				),
				sliderSpec(
					"interlace.fieldOffset",
					"Field Offset",
					node.payload.fieldOffset,
					"unipolar",
					0,
					40,
					2,
					0.5,
					"px",
				),
				sliderSpec(
					"interlace.flicker",
					"Flicker",
					node.payload.flicker,
					"unipolar",
					0,
					1,
					0.15,
					0.01,
				),
				sliderSpec(
					"interlace.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					10,
					1,
					0.1,
				),
				sliderSpec(
					"interlace.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
				sliderSpec(
					"interlace.evolution",
					"Evolution",
					node.payload.evolution,
					"unipolar",
					0,
					8,
					0,
					0.01,
				),
			];
		case "mask":
			return [
				sliderSpec(
					"mask.feather",
					"Feather",
					node.payload.feather ?? 0,
					"unipolar",
					0,
					1,
					0,
					0.01,
				),
			];
		case "composite":
			return [
				sliderSpec(
					"composite.mix",
					"Mix",
					node.payload.mix,
					"unipolar",
					0,
					1,
					1,
					0.05,
				),
			];
		case "path-blur":
			return [
				sliderSpec(
					"path-blur.speed",
					"Speed",
					node.payload.speed,
					"unipolar",
					0,
					500,
					100,
					1,
					"%",
				),
				sliderSpec(
					"path-blur.length",
					"Length",
					node.payload.length,
					"unipolar",
					0,
					1,
					0.12,
					0.01,
				),
				sliderSpec(
					"path-blur.taper",
					"Taper",
					node.payload.taper,
					"unipolar",
					0,
					1,
					0.4,
					0.01,
				),
			];
		default:
			return [];
	}
};

const frameLookGraphPayloadKey = (node: LookGraphNode | undefined): string => {
	if (!node) return "";
	switch (node.payload.kind) {
		case "mask":
			return [
				node.payload.source,
				node.payload.invert ?? false,
				node.payload.feather ?? 0,
			].join(":");
		case "composite":
			return `${node.payload.blendMode}:${node.payload.mix}`;
		case "color-map":
			return `${node.payload.shadow}:${node.payload.midtone ?? "none"}:${node.payload.highlight}:${node.payload.mix}`;
		case "find-edges":
			return `${node.payload.invert}:${node.payload.mix}`;
		case "scanline":
			return `${node.payload.density}:${node.payload.intensity}:${node.payload.softness}:${node.payload.noiseMix}`;
		case "halftone":
			return `${node.payload.cellSize}:${node.payload.dotSize}:${node.payload.contrast}:${node.payload.angle}:${node.payload.mix}`;
		case "pixel-grid":
			return `${node.payload.cellSize}:${node.payload.gap}:${node.payload.roundness}:${node.payload.brightness}:${node.payload.contrast}:${node.payload.mix}`;
		case "ordered-dither":
			return `${node.payload.cellSize}:${node.payload.matrixSize}:${node.payload.levels}:${node.payload.mode}:${node.payload.pattern}:${node.payload.contrast}:${node.payload.threshold}:${node.payload.strength}:${node.payload.mix}:${node.payload.brightness}:${node.payload.gamma}:${node.payload.ink}:${node.payload.paper}`;
		case "ascii-glyph":
			return `${node.payload.cellSize}:${node.payload.glyphScale}:${node.payload.contrast}:${node.payload.brightness}:${node.payload.densityBias}:${node.payload.invert}:${node.payload.mix}`;
		case "block-mosaic":
			return `${node.payload.cellSize}:${node.payload.gap}:${node.payload.bevel}:${node.payload.relief}:${node.payload.lightAngle}:${node.payload.lightElevation}:${node.payload.contrast}:${node.payload.variation}:${node.payload.mix}`;
		case "noise-field":
			return `${node.payload.type}:${node.payload.scale}:${node.payload.detail}:${node.payload.seed}`;
		case "warp":
			return `${node.payload.mode}:${node.payload.strength}:${node.payload.centerX}:${node.payload.centerY}`;
		case "flow":
			return `${node.payload.pattern}:${node.payload.amount}:${node.payload.scale}:${node.payload.octaves}:${node.payload.evolution}:${node.payload.centerX}:${node.payload.centerY}`;
		case "noise-source":
			return `${node.payload.scale}:${node.payload.octaves}:${node.payload.evolution}:${node.payload.speed}`;
		case "deep-glow":
			return `${node.payload.blendMode}:${node.payload.radius}:${node.payload.intensity}:${node.payload.threshold}:${node.payload.chroma}`;
		case "riso": {
			const f = node.payload.field;
			return `${node.payload.blendMode}:${node.payload.cellSize}:${node.payload.dotSize}:${node.payload.contrast}:${node.payload.grain}:${node.payload.mix}:${node.payload.bloomProgress}:${node.payload.amount}:${f.mode}:${f.x1}:${f.y1}:${f.x2}:${f.y2}:${f.cx}:${f.cy}:${f.radius}:${f.softness}:${f.invert}:${node.payload.inks
				.map((ink) => `${ink.color}:${ink.angle}:${ink.offsetX}:${ink.offsetY}`)
				.join(",")}`;
		}
		case "lens":
			return `${node.payload.size}:${node.payload.convergence}:${node.payload.centerX}:${node.payload.centerY}:${node.payload.clipToRim}`;
		case "path-blur":
			return `${node.payload.speed}:${node.payload.length}:${node.payload.taper}:${node.payload.centeredBlur}`;
		case "colorama":
			return `${node.payload.phase}:${node.payload.repetitions}:${node.payload.inputPhase}:${node.payload.mix}:${node.payload.stops
				.map((stop) => `${stop.offset}:${stop.color}`)
				.join(",")}`;
		case "wave-warp":
			return `${node.payload.waveType}:${node.payload.height}:${node.payload.width}:${node.payload.direction}:${node.payload.phase}`;
		case "bend-warp":
			return `${node.payload.bend}:${node.payload.distortionH}:${node.payload.distortionV}:${node.payload.scale}`;
		case "vhs-color":
			return `${node.payload.bleed}:${node.payload.subsample}:${node.payload.colorUnder}:${node.payload.mix}`;
		case "vhs-tracking":
			return `${node.payload.jitter}:${node.payload.wobble}:${node.payload.tear}:${node.payload.band}:${node.payload.bandPosition}:${node.payload.speed}:${node.payload.seed}:${node.payload.mix}:${node.payload.evolution}`;
		case "vhs-noise":
			return `${node.payload.snow}:${node.payload.dropout}:${node.payload.dropoutLength}:${node.payload.generation}:${node.payload.speed}:${node.payload.seed}:${node.payload.mix}:${node.payload.evolution}`;
		case "crt-display":
			return `${node.payload.maskType}:${node.payload.maskScale}:${node.payload.maskStrength}:${node.payload.curvature}:${node.payload.cornerRadius}:${node.payload.vignette}:${node.payload.mix}`;
		case "signal-glitch":
			return `${node.payload.channelShift}:${node.payload.rollAmount}:${node.payload.tearDensity}:${node.payload.tearStrength}:${node.payload.speed}:${node.payload.seed}:${node.payload.mix}:${node.payload.evolution}`;
		case "interlace":
			return `${node.payload.strength}:${node.payload.fieldOffset}:${node.payload.flicker}:${node.payload.speed}:${node.payload.mix}:${node.payload.evolution}`;
		default:
			return "";
	}
};

const sameEndpoint = (
	left: LookGraphEndpoint,
	right: LookGraphEndpoint,
): boolean => left.nodeId === right.nodeId && left.portId === right.portId;

const frameLookGraphEditingStateForConcreteTarget = (
	document: SceneDocument,
	target: FrameLookGraphConcreteTarget,
): FrameLookGraphEditingState => {
	const graph = readFrameLookGraphForTarget(document, target);
	const serialIds = graph
		? frameLookGraphSerialNodeIds(graph.nodes, graph.edges, graph.outputNodeId)
		: [];
	const serialEffectIds = serialIds.filter((id) => {
		const node = graph?.nodes.find((candidate) => candidate.id === id);
		return node ? isAuthorableLookGraphNode(node) : false;
	});
	const serialOrder = new Map(
		serialEffectIds.map((nodeId, index) => [nodeId, index]),
	);
	const nodes = graph
		? graph.nodes
				.filter(isAuthorableLookGraphNode)
				.toSorted(
					(left, right) =>
						(serialOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
						(serialOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
				)
				.map((node) => {
					const serialIndex = serialOrder.get(node.id) ?? -1;
					return {
						id: node.id,
						kind: node.kind,
						label: frameLookGraphNodeDisplayLabel(node),
						enabled: node.enabled,
						sliders: frameLookGraphSlidersForNode(node),
						canMoveUp: serialIndex > 0,
						canMoveDown:
							serialIndex >= 0 && serialIndex < serialEffectIds.length - 1,
					} satisfies FrameLookGraphEditingNode;
				})
		: [];
	return {
		graphActive: targetUsesExplicitLookGraph(document, target),
		targetStoresGraph: targetStoresExplicitLookGraph(document, target),
		graphPresent: graph !== null,
		graph,
		nodes,
		serialNodeIds: serialIds,
		target,
		resetKey: [
			lookGraphTargetKey(target),
			graph ? graph.outputNodeId : "none",
			...nodes.map(
				(node) =>
					`${node.id}:${node.kind}:${node.enabled}:${node.sliders
						.map((slider) => `${slider.path}:${slider.value}`)
						.join(",")}:${frameLookGraphPayloadKey(
						graph?.nodes.find((candidate) => candidate.id === node.id),
					)}`,
			),
		].join("|"),
	};
};

/** Projects the resolved frame Look graph into authoring rows and sliders. */
export function frameLookGraphEditingState(
	document: SceneDocument,
	scope: FrameLookGraphScope,
	artboardId?: string | null,
): FrameLookGraphEditingState {
	return frameLookGraphEditingStateForConcreteTarget(
		document,
		frameLookGraphTargetForScope(document, scope, artboardId),
	);
}

/** Projects any concrete workspace graph owner, including scoped overlays. */
export function frameLookGraphEditingStateForTarget(
	document: SceneDocument,
	target: FrameLookGraphWorkspaceTarget,
): FrameLookGraphEditingState | null {
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	return concrete
		? frameLookGraphEditingStateForConcreteTarget(document, concrete)
		: null;
}

/** Projects selected-node input ports into connectable source choices for workspace UI. */
export function frameLookGraphInputConnections(
	graph: LookGraph,
	nodeId: string,
): readonly FrameLookGraphInputConnection[] {
	const node = graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return [];
	return node.inputs.map((port) => {
		const endpoint = { nodeId: node.id, portId: port.id };
		const incoming =
			graph.edges.find((edge) => sameEndpoint(edge.to, endpoint)) ?? null;
		const incomingNode = incoming
			? graph.nodes.find((candidate) => candidate.id === incoming.from.nodeId)
			: null;
		const baseGraph =
			port.cardinality === "single"
				? normalizeLookGraph({
						...graph,
						edges: graph.edges.filter(
							(edge) => !sameEndpoint(edge.to, endpoint),
						),
					})
				: graph;
		const sourceOptions = baseGraph
			? baseGraph.nodes.flatMap((sourceNode) =>
					sourceNode.outputs.flatMap((sourcePort) => {
						if (sourcePort.valueType !== port.valueType) return [];
						const sourceEndpoint = {
							nodeId: sourceNode.id,
							portId: sourcePort.id,
						};
						if (incoming && sameEndpoint(incoming.from, sourceEndpoint)) {
							return [];
						}
						const issues = validateLookEdge(
							baseGraph,
							sourceEndpoint,
							endpoint,
						);
						if (issues.length > 0) return [];
						return [
							{
								id: `${sourceEndpoint.nodeId}:${sourceEndpoint.portId}`,
								endpoint: sourceEndpoint,
								label: `${lookGraphNodeLabel(sourceNode.kind)}:${sourcePort.name}`,
								replaces: incoming !== null,
							} satisfies FrameLookGraphInputSourceOption,
						];
					}),
				)
			: [];
		return {
			endpoint,
			name: port.name,
			valueType: port.valueType,
			incoming: incoming
				? {
						endpoint: incoming.from,
						label: incomingNode
							? lookGraphNodeLabel(incomingNode.kind)
							: "Connected",
					}
				: null,
			sourceOptions,
		} satisfies FrameLookGraphInputConnection;
	});
}

const applyLookGraphCommand = (
	command: SceneCommand,
	label: string,
	coalesceKey: string,
): boolean => {
	const store = useSceneStore.getState();
	const before = store.document;
	if (command.compoundId) {
		if (store.transaction) store.commit();
		useSceneStore.getState().apply(command);
		return useSceneStore.getState().document !== before;
	}
	store.beginTransaction(coalesceKey, label);
	useSceneStore.getState().apply(command);
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
};

const applyFrameLookGraphResult = (
	result: FrameLookGraphCommandResult,
	label: string,
	operationKey: string,
): boolean => {
	if (result.kind !== "ready") return false;
	switch (result.target.scope) {
		case "scene":
		case "artboard":
		case "scoped-overlay": {
			const targetKey = lookGraphTargetKey(result.target);
			const applied = applyLookGraphCommand(
				result.command,
				label,
				`frame-look-graph:${targetKey}:${operationKey}`,
			);
			if (applied && result.focusNodeId) {
				useLookGraphSelectionStore
					.getState()
					.setSelectedNodeForOwner(targetKey, result.focusNodeId);
			}
			return applied;
		}
		default:
			return false;
	}
};

/** Materializes the resolved Look into the selected workspace target's graph slot. */
export function commitMaterializeFrameLookGraphForTarget(
	target: FrameLookGraphWorkspaceTarget,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createMaterializeLookGraphCommand(document, concrete, {
			label: "Edit as look graph",
		}),
		"Edit as look graph",
		"materialize",
	);
}

/** Materializes the resolved Frame/Scene Look into the selected scope's graph slot. */
export function commitMaterializeFrameLookGraph(
	scope: FrameLookGraphScope,
	artboardId?: string | null,
): boolean {
	return commitMaterializeFrameLookGraphForTarget({ scope, artboardId });
}

/** Adds one Look graph node through the scene command bus for a workspace target. */
export function commitInsertFrameLookGraphNodeForTarget(
	target: FrameLookGraphWorkspaceTarget,
	kind: AuthorableLookGraphNodeKind,
	options: Pick<InsertLookGraphNodeOptions, "insertAfterNodeId"> = {},
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createInsertLookGraphNodeCommand(document, concrete, kind, {
			label: "Add look graph node",
			...options,
		}),
		"Add look graph node",
		options.insertAfterNodeId
			? `insert:${kind}:after:${options.insertAfterNodeId}`
			: `insert:${kind}`,
	);
}

/** Adds one Look graph node through the scene command bus. */
export function commitInsertFrameLookGraphNode(
	scope: FrameLookGraphScope,
	kind: AuthorableLookGraphNodeKind,
	artboardId?: string | null,
	options: Pick<InsertLookGraphNodeOptions, "insertAfterNodeId"> = {},
): boolean {
	return commitInsertFrameLookGraphNodeForTarget(
		{ scope, artboardId },
		kind,
		options,
	);
}

/**
 * Noise Background starter action: insert a `noise-field` generator wired behind the
 * current look content (via a `composite`) in one undo for a workspace target.
 */
export function commitInsertNoiseFieldBackgroundForTarget(
	target: FrameLookGraphWorkspaceTarget,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createInsertNoiseFieldBackgroundCommand(document, concrete, {
			label: "Use noise as background",
		}),
		"Use noise as background",
		"insert:noise-background",
	);
}

/**
 * Noise Background starter action: insert a `noise-field` generator wired behind the
 * current look content (via a `composite`) in one undo.
 */
export function commitInsertNoiseFieldBackground(
	scope: FrameLookGraphScope,
	artboardId?: string | null,
): boolean {
	return commitInsertNoiseFieldBackgroundForTarget({ scope, artboardId });
}

/** Inserts a Particle Dissolve texture node into the target Look graph. */
export function commitInsertParticleDissolveNodeForTarget(
	target: FrameLookGraphWorkspaceTarget,
	options: InsertLookGraphNodeOptions = {},
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createInsertParticleDissolveNodeCommand(document, concrete, {
			label: "Add particle dissolve",
			...options,
		}),
		"Add particle dissolve",
		options.insertAfterNodeId
			? `insert:particle-dissolve:after:${options.insertAfterNodeId}`
			: "insert:particle-dissolve",
	);
}

/** Inserts a frame-scope Particle Dissolve texture node into the active Look graph. */
export function commitInsertParticleDissolveNode(
	scope: FrameLookGraphScope,
	artboardId?: string | null,
	options: InsertLookGraphNodeOptions = {},
): boolean {
	return commitInsertParticleDissolveNodeForTarget(
		{ scope, artboardId },
		options,
	);
}

const lookGraphStarterActionLabel = (starterId: LookGraphStarterId): string => {
	switch (starterId) {
		case "soft-glow":
			return "Add soft glow";
		case "duotone-poster":
			return "Add duotone poster";
		case "flow-glow":
			return "Add flow glow";
		case "print-poster":
			return "Add print poster";
		case "led-glow":
			return "Add LED glow";
		case "glyph-poster":
			return "Add glyph poster";
		case "surveillance-feed":
			return "Add surveillance feed";
		case "vhs-1985":
			return "Add VHS 1985";
		case "vhs-ep":
			return "Add VHS EP";
		case "crt-monitor":
			return "Add CRT monitor";
		case "broadcast-glitch":
			return "Add broadcast glitch";
	}
};

let lookGraphStarterInsertSeq = 0;

/** Inserts a result-oriented starter Look as editable graph nodes. */
export function commitInsertLookGraphStarterForTarget(
	target: FrameLookGraphWorkspaceTarget,
	starterId: LookGraphStarterId,
	options: Pick<InsertLookGraphNodeOptions, "insertAfterNodeId"> = {},
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	const label = lookGraphStarterActionLabel(starterId);
	return applyFrameLookGraphResult(
		createInsertLookGraphStarterCommand(document, concrete, starterId, {
			label,
			...options,
		}),
		label,
		options.insertAfterNodeId
			? `insert-starter:${starterId}:after:${options.insertAfterNodeId}:${lookGraphStarterInsertSeq++}`
			: `insert-starter:${starterId}:${lookGraphStarterInsertSeq++}`,
	);
}

/** Removes one Look graph node through the scene command bus for a workspace target. */
export function commitRemoveFrameLookGraphNodeForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createRemoveLookGraphNodeCommand(document, concrete, nodeId, {
			label: "Remove look graph node",
		}),
		"Remove look graph node",
		`remove:${nodeId}`,
	);
}

/** Removes one Look graph node through the scene command bus. */
export function commitRemoveFrameLookGraphNode(
	scope: FrameLookGraphScope,
	nodeId: string,
	artboardId?: string | null,
): boolean {
	return commitRemoveFrameLookGraphNodeForTarget({ scope, artboardId }, nodeId);
}

/** Moves one serial Look graph node up or down in a workspace target's graph chain. */
export function commitReorderFrameLookGraphNodeForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
	direction: "up" | "down",
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createReorderLookGraphNodeCommand(document, concrete, nodeId, direction, {
			label: "Reorder look graph",
		}),
		"Reorder look graph",
		`reorder:${nodeId}:${direction}`,
	);
}

/** Moves one serial Look graph node up or down in the graph chain. */
export function commitReorderFrameLookGraphNode(
	scope: FrameLookGraphScope,
	nodeId: string,
	direction: "up" | "down",
	artboardId?: string | null,
): boolean {
	return commitReorderFrameLookGraphNodeForTarget(
		{ scope, artboardId },
		nodeId,
		direction,
	);
}

/** Toggles one Look graph node's enabled state for a workspace target. */
export function commitToggleFrameLookGraphNodeForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
	enabled: boolean,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createToggleLookGraphNodeCommand(document, concrete, nodeId, enabled, {
			label: "Toggle look graph node",
		}),
		"Toggle look graph node",
		`toggle:${nodeId}:${enabled}`,
	);
}

/** Toggles one Look graph node's enabled state. */
export function commitToggleFrameLookGraphNode(
	scope: FrameLookGraphScope,
	nodeId: string,
	enabled: boolean,
	artboardId?: string | null,
): boolean {
	return commitToggleFrameLookGraphNodeForTarget(
		{ scope, artboardId },
		nodeId,
		enabled,
	);
}

/** Commits one numeric Look graph node value as a discrete undoable edit for a target. */
export function commitFrameLookGraphNodeNumberForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	value: number,
	keyframeContext?: LookNodeKeyframeContext,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	const graph = readFrameLookGraphForTarget(document, concrete);
	if (!graph?.nodes.some((candidate) => candidate.id === nodeId)) return false;
	const keyframe = planLookNodeKeyframe(
		useMotionStore.getState().document,
		keyframeContext,
		concrete,
		nodeId,
		path,
	);
	if (keyframe) {
		applyLookNodeParamKeyframe(
			keyframe.owner,
			nodeId,
			keyframe.paramKey,
			keyframe.frame,
			value,
		);
		return true;
	}
	return applyFrameLookGraphResult(
		createUpdateLookGraphNodeNumberCommand(
			document,
			concrete,
			nodeId,
			path,
			value,
			{ label: "Edit look graph node" },
		),
		"Edit look graph node",
		`number:${nodeId}:${path}`,
	);
}

/** Commits one numeric Look graph node value as a discrete undoable edit. */
export function commitFrameLookGraphNodeNumber(
	scope: FrameLookGraphScope,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	value: number,
	artboardId?: string | null,
	keyframeContext?: LookNodeKeyframeContext,
): boolean {
	return commitFrameLookGraphNodeNumberForTarget(
		{ scope, artboardId },
		nodeId,
		path,
		value,
		keyframeContext,
	);
}

/**
 * Commits one non-slider Look field. Relinking blur axes also removes the
 * `radiusY` motion track; when both stores change, their commands share a
 * compound id so global undo restores the base payload and animation together.
 */
export function commitFrameLookGraphNodeFieldForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
	patch: LookGraphNodeFieldPatch,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	const result = createUpdateLookGraphNodeFieldCommand(
		document,
		concrete,
		nodeId,
		patch,
		{ label: "Edit look graph node" },
	);
	const relinkingBlur = patch.path === "blur.radiusY" && patch.value === null;
	if (!relinkingBlur) {
		return applyFrameLookGraphResult(
			result,
			"Edit look graph node",
			`field:${nodeId}:${patch.path}`,
		);
	}
	const hasRadiusYTrack = isLookNodeParamAnimated(
		useMotionStore.getState().document,
		concrete,
		nodeId,
		"radiusY",
	);
	if (result.kind !== "ready" && result.kind !== "unchanged") return false;
	if (result.kind === "unchanged" && !hasRadiusYTrack) return false;
	const compoundId =
		result.kind === "ready" && hasRadiusYTrack
			? createId("look-blur-relink")
			: undefined;
	const sceneApplied =
		result.kind === "ready"
			? applyFrameLookGraphResult(
					compoundId
						? {
								...result,
								command: { ...result.command, compoundId },
							}
						: result,
					"Relink blur axes",
					`field:${nodeId}:${patch.path}`,
				)
			: false;
	if (hasRadiusYTrack) {
		const motionStore = useMotionStore.getState();
		if (motionStore.transaction) motionStore.commit();
		useMotionStore.getState().apply({
			...removeLookNodeParamTrack(concrete, nodeId, "radiusY"),
			...(compoundId ? { compoundId } : {}),
		});
	}
	return sceneApplied || hasRadiusYTrack;
}

/** Commits one enum/boolean Look graph node payload field as a discrete edit. */
export function commitFrameLookGraphNodeField(
	scope: FrameLookGraphScope,
	nodeId: string,
	patch: LookGraphNodeFieldPatch,
	artboardId?: string | null,
): boolean {
	return commitFrameLookGraphNodeFieldForTarget(
		{ scope, artboardId },
		nodeId,
		patch,
	);
}

/**
 * Seeds a `bloomProgress` reveal/dissolve ramp on a `riso` node for a workspace
 * target — the "Print Bloom" one-click affordance. Resolves the abstract target
 * to the concrete Look-graph owner the same way every other Look graph mutation
 * in this module does, then delegates to {@link seedRisoPrintBloom}. Returns
 * whether the target resolved (and the seed was applied).
 */
export function seedRisoPrintBloomForTarget(
	target: FrameLookGraphWorkspaceTarget,
	risoNodeId: string,
	direction: RisoPrintBloomDirection,
	durationFrames: number,
	startFrame?: number,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	seedRisoPrintBloom({
		owner: concrete,
		risoNodeId,
		direction,
		durationFrames,
		startFrame,
	});
	return true;
}

let frameLookGraphGestureSeq = 0;

const noopFrameLookGraphNodeNumberGesture: FrameLookGraphNodeNumberGesture = {
	update: () => undefined,
	commit: () => undefined,
};

/** Opens a held graph-node scrub transaction for a target; callers must call `commit()`. */
export function beginFrameLookGraphNodeNumberGestureForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	keyframeContext?: LookNodeKeyframeContext,
): FrameLookGraphNodeNumberGesture {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return noopFrameLookGraphNodeNumberGesture;
	const graph = readFrameLookGraphForTarget(document, concrete);
	if (!graph?.nodes.some((candidate) => candidate.id === nodeId)) {
		return noopFrameLookGraphNodeNumberGesture;
	}
	// When the param should be keyed (recording or already animated), the whole
	// scrub records keyframes at the playhead frame instead of writing the base.
	// The frame is fixed for the gesture's life, so the command's per-(track,frame)
	// coalesce key folds every tick into one undo — no motion transaction needed.
	const keyframe = planLookNodeKeyframe(
		useMotionStore.getState().document,
		keyframeContext,
		concrete,
		nodeId,
		path,
	);
	if (keyframe) {
		let keyframeSealed = false;
		return {
			update: (value) => {
				if (keyframeSealed) return;
				applyLookNodeParamKeyframe(
					keyframe.owner,
					nodeId,
					keyframe.paramKey,
					keyframe.frame,
					value,
				);
			},
			commit: () => {
				keyframeSealed = true;
			},
		};
	}
	const targetKey = lookGraphTargetKey(concrete);
	const coalesceKey = `frame-look-graph-scrub:${targetKey}:${nodeId}:${path}:${frameLookGraphGestureSeq++}`;
	useSceneStore
		.getState()
		.beginTransaction(coalesceKey, "Edit look graph node");
	let sealed = false;
	return {
		update: (value) => {
			if (sealed) return;
			const result = createUpdateLookGraphNodeNumberCommand(
				useSceneStore.getState().document,
				concrete,
				nodeId,
				path,
				value,
				{
					label: "Edit look graph node",
					coalesceKey,
				},
			);
			if (result.kind === "ready") {
				useSceneStore.getState().apply(result.command);
			}
		},
		commit: () => {
			if (sealed) return;
			sealed = true;
			useSceneStore.getState().commit();
		},
	};
}

/** Opens a held graph-node scrub transaction; callers must call `commit()`. */
export function beginFrameLookGraphNodeNumberGesture(
	scope: FrameLookGraphScope,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	artboardId?: string | null,
	keyframeContext?: LookNodeKeyframeContext,
): FrameLookGraphNodeNumberGesture {
	return beginFrameLookGraphNodeNumberGestureForTarget(
		{ scope, artboardId },
		nodeId,
		path,
		keyframeContext,
	);
}

/** Persists a graph node's workspace position for a target without changing render output. */
export function commitMoveFrameLookGraphNodeForTarget(
	target: FrameLookGraphWorkspaceTarget,
	nodeId: string,
	position: { readonly x: number; readonly y: number },
): boolean {
	if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
		return false;
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	const graph = readFrameLookGraphForTarget(document, concrete);
	if (!graph || !targetUsesExplicitLookGraph(document, concrete)) return false;
	const currentNode = graph.nodes.find((node) => node.id === nodeId);
	if (!currentNode) return false;
	if (
		currentNode.position?.x === position.x &&
		currentNode.position?.y === position.y
	) {
		return false;
	}
	const nextGraph = normalizeLookGraph({
		...graph,
		nodes: graph.nodes.map((node) =>
			node.id === nodeId ? { ...node, position } : node,
		),
	});
	if (!nextGraph || nextGraph === graph) return false;
	const targetKey = lookGraphTargetKey(concrete);
	return applyLookGraphCommand(
		createSetFrameLookGraphCommand(concrete, nextGraph, {
			label: "Move look graph node",
		}),
		"Move look graph node",
		`frame-look-graph:${targetKey}:move:${nodeId}`,
	);
}

/** Persists a graph node's workspace position without changing render output. */
export function commitMoveFrameLookGraphNode(
	scope: FrameLookGraphScope,
	nodeId: string,
	position: { readonly x: number; readonly y: number },
	artboardId?: string | null,
): boolean {
	return commitMoveFrameLookGraphNodeForTarget(
		{ scope, artboardId },
		nodeId,
		position,
	);
}

/** Connects graph ports for a target, replacing the previous single-cardinality wire. */
export function commitConnectFrameLookGraphPortsForTarget(
	target: FrameLookGraphWorkspaceTarget,
	from: LookGraphEndpoint,
	to: LookGraphEndpoint,
): FrameLookGraphConnectResult {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return { kind: "missing-graph" };
	const result = createConnectLookGraphPortsCommand(
		document,
		concrete,
		from,
		to,
		{
			label: "Connect look graph ports",
		},
	);
	if (result.kind === "invalid") {
		return { kind: "invalid", message: result.message };
	}
	if (result.kind === "missing-graph" || result.kind === "missing-target") {
		return { kind: "missing-graph" };
	}
	if (result.kind === "unchanged") return { kind: "unchanged" };
	const applied = applyFrameLookGraphResult(
		result,
		"Connect look graph ports",
		`connect:${from.portId}:${to.portId}`,
	);
	return applied ? { kind: "applied" } : { kind: "unchanged" };
}

/** Connects graph ports, replacing the previous wire when the target input is single-cardinality. */
export function commitConnectFrameLookGraphPorts(
	scope: FrameLookGraphScope,
	from: LookGraphEndpoint,
	to: LookGraphEndpoint,
	artboardId?: string | null,
): FrameLookGraphConnectResult {
	return commitConnectFrameLookGraphPortsForTarget(
		{ scope, artboardId },
		from,
		to,
	);
}

/** Removes every edge currently feeding one graph input port for a target. */
export function commitDisconnectFrameLookGraphInputForTarget(
	target: FrameLookGraphWorkspaceTarget,
	to: LookGraphEndpoint,
): boolean {
	const document = useSceneStore.getState().document;
	const concrete = frameLookGraphTargetForWorkspaceTarget(document, target);
	if (!concrete) return false;
	return applyFrameLookGraphResult(
		createDisconnectLookGraphInputCommand(document, concrete, to, {
			label: "Disconnect look graph input",
		}),
		"Disconnect look graph input",
		`disconnect:${to.portId}`,
	);
}

/** Removes every edge currently feeding one graph input port. */
export function commitDisconnectFrameLookGraphInput(
	scope: FrameLookGraphScope,
	to: LookGraphEndpoint,
	artboardId?: string | null,
): boolean {
	return commitDisconnectFrameLookGraphInputForTarget(
		{ scope, artboardId },
		to,
	);
}
