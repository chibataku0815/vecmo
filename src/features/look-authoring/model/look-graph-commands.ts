import type { SceneCommand } from "@/entities/scene/model/command";
import {
	type ColoramaStop,
	type CrtDisplayMaskType,
	DEFAULT_PATH_BLUR_GUIDE,
	LOOK_GRAPH_NODE_PORT_CATALOG,
	LOOK_GRAPH_SCHEMA_VERSION,
	type LookGraph,
	type LookGraphEdge,
	type LookGraphEdgeDraft,
	type LookGraphEndpoint,
	type LookGraphMaskSource,
	type LookGraphNode,
	type LookGraphNodeDraft,
	type LookGraphNodeKind,
	type LookGraphNodePayloadDraft,
	type LookGraphOwnerRef,
	lookGraphEdgeId,
	lookGraphFromIntent,
	lookGraphNodeId,
	lookGraphPortId,
	normalizeLookGraph,
	type OrderedDitherMode,
	type OrderedDitherPattern,
	type RisoBlendMode,
	type RisoFieldMode,
	validateLookEdge,
} from "@/entities/scene/model/look-graph";
import {
	createSetLookGraphCommand,
	type UpdateLookGraphOptions,
} from "@/entities/scene/model/look-graph-commands";
import { applyLookGraphOperation } from "@/entities/scene/model/look-graph-operations";
import type { EffectIntentTarget } from "@/entities/scene/model/node-commands";
import {
	resolveFrameEffectIntent,
	resolveFrameLookGraph,
} from "@/entities/scene/model/recipe-resolve";
import {
	createSetScopedLookGraphOverlayCommand,
	isScopedLookGraphOverlay,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import {
	findArtboardById,
	selectCurrentArtboard,
	selectDefaultArtboard,
} from "@/entities/scene/model/selectors";
import type {
	BlendMode,
	LookGraphScopedEffectLook,
	SceneDocument,
} from "@/entities/scene/model/types";
import {
	DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	resolveTextureParticleLinearField,
	type TextureMaterialMode,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
	textureParticleLinearFieldExtent,
	textureParticleLinearFieldWithAngle,
} from "@/shared/vec-core";

export type ScopedLookGraphTarget = {
	readonly scope: "scoped-overlay";
	readonly artboardId: string;
	readonly scopedLookId: string;
};

export type FrameLookGraphTarget = EffectIntentTarget | ScopedLookGraphTarget;
export type ConcreteFrameLookGraphTarget = Extract<
	FrameLookGraphTarget,
	{ readonly scope: "scene" | "artboard" | "scoped-overlay" }
>;

/** Stable UI/transaction identity for the concrete graph owner being edited. */
export const lookGraphTargetKey = (
	target: ConcreteFrameLookGraphTarget,
): string => {
	switch (target.scope) {
		case "scene":
			return "scene";
		case "artboard":
			return `artboard:${target.artboardId}`;
		case "scoped-overlay":
			return `scoped-overlay:${target.artboardId}:${target.scopedLookId}`;
	}
};

export type AuthorableLookGraphNodeKind = Extract<
	LookGraphNodeKind,
	| "grade"
	| "glow"
	| "grain"
	| "blur"
	| "chromatic-fringe"
	| "displace"
	| "posterize"
	| "color-map"
	| "find-edges"
	| "scanline"
	| "halftone"
	| "pixel-grid"
	| "ordered-dither"
	| "ascii-glyph"
	| "block-mosaic"
	| "noise-field"
	| "warp"
	| "lens"
	| "kaleidoscope"
	| "flow"
	| "path-blur"
	| "noise-source"
	| "deep-glow"
	| "riso"
	| "colorama"
	| "wave-warp"
	| "bend-warp"
	| "vhs-color"
	| "vhs-tracking"
	| "vhs-noise"
	| "crt-display"
	| "signal-glitch"
	| "interlace"
	| "mask"
	| "composite"
>;

export type LookGraphNodeNumberPath =
	| "grade.exposure"
	| "grade.contrast"
	| "grade.saturation"
	| "glow.strength"
	| "glow.radius"
	| "grain.strength"
	| "grain.size"
	| "grain.extent"
	| "grain.softness"
	| "grain.angle"
	| "blur.radius"
	| "blur.radiusY"
	| "chromatic-fringe.amount"
	| "displace.scale"
	| "displace.frequency"
	| "displace.octaves"
	| "posterize.levels"
	| "color-map.mix"
	| "find-edges.mix"
	| "scanline.density"
	| "scanline.intensity"
	| "scanline.softness"
	| "scanline.noiseMix"
	| "halftone.cellSize"
	| "halftone.dotSize"
	| "halftone.contrast"
	| "halftone.angle"
	| "halftone.mix"
	| "pixel-grid.cellSize"
	| "pixel-grid.gap"
	| "pixel-grid.roundness"
	| "pixel-grid.brightness"
	| "pixel-grid.contrast"
	| "pixel-grid.mix"
	| "ordered-dither.cellSize"
	| "ordered-dither.matrixSize"
	| "ordered-dither.levels"
	| "ordered-dither.contrast"
	| "ordered-dither.threshold"
	| "ordered-dither.strength"
	| "ordered-dither.mix"
	| "ordered-dither.brightness"
	| "ordered-dither.gamma"
	| "ascii-glyph.cellSize"
	| "ascii-glyph.glyphScale"
	| "ascii-glyph.contrast"
	| "ascii-glyph.brightness"
	| "ascii-glyph.densityBias"
	| "ascii-glyph.mix"
	| "block-mosaic.cellSize"
	| "block-mosaic.gap"
	| "block-mosaic.bevel"
	| "block-mosaic.relief"
	| "block-mosaic.lightAngle"
	| "block-mosaic.lightElevation"
	| "block-mosaic.contrast"
	| "block-mosaic.variation"
	| "block-mosaic.mix"
	| "noise-field.scale"
	| "noise-field.detail"
	| "noise-field.seed"
	| "warp.strength"
	| "warp.centerX"
	| "warp.centerY"
	| "lens.size"
	| "lens.convergence"
	| "lens.centerX"
	| "lens.centerY"
	| "kaleidoscope.segments"
	| "kaleidoscope.centerX"
	| "kaleidoscope.centerY"
	| "kaleidoscope.roll"
	| "flow.amount"
	| "flow.scale"
	| "flow.octaves"
	| "flow.evolution"
	| "flow.centerX"
	| "flow.centerY"
	| "path-blur.speed"
	| "path-blur.length"
	| "path-blur.taper"
	| "noise-source.scale"
	| "noise-source.octaves"
	| "noise-source.evolution"
	| "noise-source.speed"
	| "deep-glow.radius"
	| "deep-glow.intensity"
	| "deep-glow.threshold"
	| "deep-glow.chroma"
	| "riso.cellSize"
	| "riso.dotSize"
	| "riso.contrast"
	| "riso.grain"
	| "riso.mix"
	| "riso.bloomProgress"
	| "riso.amount"
	| "riso.fieldSoftness"
	| "colorama.phase"
	| "colorama.repetitions"
	| "colorama.mix"
	| "wave-warp.height"
	| "wave-warp.width"
	| "wave-warp.direction"
	| "wave-warp.phase"
	| "bend-warp.bend"
	| "bend-warp.distortionH"
	| "bend-warp.distortionV"
	| "bend-warp.scale"
	| "vhs-color.bleed"
	| "vhs-color.subsample"
	| "vhs-color.colorUnder"
	| "vhs-color.mix"
	| "vhs-tracking.jitter"
	| "vhs-tracking.wobble"
	| "vhs-tracking.tear"
	| "vhs-tracking.band"
	| "vhs-tracking.bandPosition"
	| "vhs-tracking.speed"
	| "vhs-tracking.seed"
	| "vhs-tracking.mix"
	| "vhs-tracking.evolution"
	| "vhs-noise.snow"
	| "vhs-noise.dropout"
	| "vhs-noise.dropoutLength"
	| "vhs-noise.generation"
	| "vhs-noise.speed"
	| "vhs-noise.seed"
	| "vhs-noise.mix"
	| "vhs-noise.evolution"
	| "crt-display.maskScale"
	| "crt-display.maskStrength"
	| "crt-display.curvature"
	| "crt-display.cornerRadius"
	| "crt-display.vignette"
	| "crt-display.mix"
	| "signal-glitch.channelShift"
	| "signal-glitch.rollAmount"
	| "signal-glitch.tearDensity"
	| "signal-glitch.tearStrength"
	| "signal-glitch.speed"
	| "signal-glitch.seed"
	| "signal-glitch.mix"
	| "signal-glitch.evolution"
	| "interlace.strength"
	| "interlace.fieldOffset"
	| "interlace.flicker"
	| "interlace.speed"
	| "interlace.mix"
	| "interlace.evolution"
	| "mask.feather"
	| "composite.mix";

export type RenderableLookGraphMaskSource = Extract<
	LookGraphMaskSource,
	"source-alpha" | "previous-alpha" | "previous-luminance"
>;

export type LookGraphTextureMode = "film-grain" | "particle-dissolve";

export type LookGraphNodeFieldPatch =
	| {
			readonly path: "mask.source";
			readonly value: RenderableLookGraphMaskSource;
	  }
	| { readonly path: "grain.mode"; readonly value: LookGraphTextureMode }
	| { readonly path: "grain.angle"; readonly value: number | null | "mesh" }
	| { readonly path: "blur.radiusY"; readonly value: number | null }
	| { readonly path: "mask.invert"; readonly value: boolean }
	| { readonly path: "composite.blendMode"; readonly value: BlendMode }
	| { readonly path: "deep-glow.blendMode"; readonly value: BlendMode }
	| { readonly path: "riso.blendMode"; readonly value: RisoBlendMode }
	| { readonly path: "riso.fieldMode"; readonly value: RisoFieldMode }
	| { readonly path: "riso.fieldInvert"; readonly value: boolean }
	| { readonly path: "color-map.shadow"; readonly value: string }
	| { readonly path: "color-map.midtone"; readonly value: string | null }
	| { readonly path: "color-map.highlight"; readonly value: string }
	| { readonly path: "find-edges.invert"; readonly value: boolean }
	| {
			readonly path: "noise-field.type";
			readonly value: "fractalNoise" | "turbulence";
	  }
	| { readonly path: "ordered-dither.mode"; readonly value: OrderedDitherMode }
	| {
			readonly path: "ordered-dither.pattern";
			readonly value: OrderedDitherPattern;
	  }
	| { readonly path: "ordered-dither.ink"; readonly value: string }
	| { readonly path: "ordered-dither.paper"; readonly value: string }
	| { readonly path: "ascii-glyph.invert"; readonly value: boolean }
	| { readonly path: "warp.mode"; readonly value: "radial" | "twirl" }
	| {
			readonly path: "flow.pattern";
			readonly value: "bulge" | "turbulent" | "twist";
	  }
	| { readonly path: "lens.clipToRim"; readonly value: boolean }
	| { readonly path: "path-blur.centeredBlur"; readonly value: boolean }
	| {
			readonly path: "wave-warp.waveType";
			readonly value: "sine" | "semicircle";
	  }
	| {
			readonly path: "colorama.inputPhase";
			readonly value: "luminance" | "alpha";
	  }
	| {
			readonly path: "colorama.stops";
			readonly value: readonly ColoramaStop[];
	  }
	| {
			readonly path: "crt-display.maskType";
			readonly value: CrtDisplayMaskType;
	  };

/** Command creation result used by Inspector UI without throwing on stale targets. */
export type FrameLookGraphCommandResult =
	| {
			readonly kind: "ready";
			readonly target: FrameLookGraphTarget;
			readonly graph: LookGraph;
			readonly command: SceneCommand;
			readonly focusNodeId?: string;
	  }
	| {
			readonly kind: "unchanged";
			readonly target: FrameLookGraphTarget;
			readonly graph: LookGraph | null;
	  }
	| { readonly kind: "missing-target"; readonly target: FrameLookGraphTarget }
	| { readonly kind: "missing-graph"; readonly target: FrameLookGraphTarget }
	| {
			readonly kind: "missing-node";
			readonly target: FrameLookGraphTarget;
			readonly graph: LookGraph;
	  }
	| {
			readonly kind: "unsupported-node";
			readonly target: FrameLookGraphTarget;
			readonly graph: LookGraph;
	  }
	| {
			readonly kind: "invalid";
			readonly target: FrameLookGraphTarget;
			readonly graph: LookGraph;
			readonly message: string;
	  };

export type InsertLookGraphNodeOptions = UpdateLookGraphOptions & {
	/**
	 * Optional serial-chain anchor. When it names a source/effect/composite node on
	 * the active source-to-output chain, image-processing nodes are inserted after
	 * that node instead of always before output. Generators and masks keep their
	 * special insertion semantics because they are not serial image processors.
	 */
	readonly insertAfterNodeId?: string | null;
};

/** Result-oriented palette recipes that expand into normal editable Look nodes. */
export type LookGraphStarterId =
	| "soft-glow"
	| "duotone-poster"
	| "flow-glow"
	| "print-poster"
	| "led-glow"
	| "glyph-poster"
	| "surveillance-feed"
	| "vhs-1985"
	| "vhs-ep"
	| "crt-monitor"
	| "broadcast-glitch";

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const concreteTargetForTarget = (
	document: SceneDocument,
	target: FrameLookGraphTarget,
): {
	readonly target: ConcreteFrameLookGraphTarget;
	readonly artboardId?: string;
} | null => {
	switch (target.scope) {
		case "scene":
			return { target };
		case "current-artboard": {
			const artboard = selectCurrentArtboard(document);
			return {
				target: { scope: "artboard", artboardId: artboard.id },
				artboardId: artboard.id,
			};
		}
		case "default-artboard": {
			const artboard = selectDefaultArtboard(document);
			return {
				target: { scope: "artboard", artboardId: artboard.id },
				artboardId: artboard.id,
			};
		}
		case "artboard":
			return findArtboardById(document, target.artboardId)
				? { target, artboardId: target.artboardId }
				: null;
		case "scoped-overlay": {
			const artboard = findArtboardById(document, target.artboardId);
			const scopedLook = artboard?.effectIntent?.scopedLooks?.find(
				(look) =>
					isScopedLookGraphOverlay(look) && look.id === target.scopedLookId,
			);
			return scopedLook ? { target, artboardId: target.artboardId } : null;
		}
	}
};

const readScopedLookGraphForTarget = (
	document: SceneDocument,
	target: ScopedLookGraphTarget,
): LookGraph | null => {
	const artboard = findArtboardById(document, target.artboardId);
	const scopedLook = artboard?.effectIntent?.scopedLooks?.find(
		(look): look is LookGraphScopedEffectLook =>
			isScopedLookGraphOverlay(look) && look.id === target.scopedLookId,
	);
	return scopedLook ? (normalizeLookGraph(scopedLook.lookGraph) ?? null) : null;
};

/**
 * Reads the graph a frame target is effectively using. Artboard targets resolve
 * artboard-over-scene fallback before UI edits, so the first Inspector edit
 * materializes the visible inherited Look as an artboard graph override.
 */
export function readFrameLookGraphForTarget(
	document: SceneDocument,
	target: FrameLookGraphTarget,
): LookGraph | null {
	const concrete = concreteTargetForTarget(document, target);
	if (!concrete) return null;
	if (concrete.target.scope === "scoped-overlay") {
		return readScopedLookGraphForTarget(document, concrete.target);
	}
	if (concrete.target.scope === "scene") {
		return (
			lookGraphFromIntent(document.effectIntent, { scope: "scene" }) ?? null
		);
	}
	return resolveFrameLookGraph(document, concrete.artboardId) ?? null;
}

/** Reports whether the active frame Look is backed by an explicit graph slot. */
export function targetUsesExplicitLookGraph(
	document: SceneDocument,
	target: FrameLookGraphTarget,
): boolean {
	const concrete = concreteTargetForTarget(document, target);
	if (!concrete) return false;
	if (concrete.target.scope === "scoped-overlay") {
		return readScopedLookGraphForTarget(document, concrete.target) !== null;
	}
	if (concrete.target.scope === "scene") {
		return Boolean(document.effectIntent?.lookGraph);
	}
	return Boolean(
		resolveFrameEffectIntent(document, concrete.artboardId).lookGraph,
	);
}

/** Reports whether the concrete target slot stores its own explicit graph. */
export function targetStoresExplicitLookGraph(
	document: SceneDocument,
	target: FrameLookGraphTarget,
): boolean {
	const concrete = concreteTargetForTarget(document, target);
	if (!concrete) return false;
	if (concrete.target.scope === "scoped-overlay") {
		return readScopedLookGraphForTarget(document, concrete.target) !== null;
	}
	if (concrete.target.scope === "scene") {
		return Boolean(document.effectIntent?.lookGraph);
	}
	return Boolean(
		findArtboardById(document, concrete.target.artboardId)?.effectIntent
			?.lookGraph,
	);
}

const sourceOutputGraph = (
	target: FrameLookGraphTarget,
): LookGraph | undefined => {
	const owner = lookGraphOwnerForTarget(target);
	if (!owner) return undefined;
	const sourceId = lookGraphNodeId(owner, "source");
	const outputId = lookGraphNodeId(owner, "output");
	return normalizeLookGraph({
		schemaVersion: LOOK_GRAPH_SCHEMA_VERSION,
		outputNodeId: outputId,
		nodes: [
			{ id: sourceId, kind: "source", payload: { kind: "source" } },
			{ id: outputId, kind: "output", payload: { kind: "output" } },
		],
		edges: [edgeDraft(sourceId, outputId)],
	});
};

export const lookGraphOwnerForTarget = (
	target: FrameLookGraphTarget,
): LookGraphOwnerRef | null => {
	switch (target.scope) {
		case "scene":
			return { scope: "scene" };
		case "artboard":
			return { scope: "artboard", artboardId: target.artboardId };
		case "scoped-overlay":
			return {
				scope: "scoped-overlay",
				artboardId: target.artboardId,
				scopedLookId: target.scopedLookId,
			};
		default:
			return null;
	}
};

const uniqueNodeIdFromUsed = (
	target: FrameLookGraphTarget,
	kind: AuthorableLookGraphNodeKind,
	used: Set<string>,
): string => {
	const owner = lookGraphOwnerForTarget(target);
	const base = owner ? lookGraphNodeId(owner, kind) : `look-${kind}`;
	if (!used.has(base)) return base;
	let suffix = 2;
	while (used.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
};

const uniqueNodeId = (
	graph: LookGraph,
	target: FrameLookGraphTarget,
	kind: AuthorableLookGraphNodeKind,
): string =>
	uniqueNodeIdFromUsed(
		target,
		kind,
		new Set(graph.nodes.map((node) => node.id)),
	);

const defaultPayloadForKind = (
	kind: AuthorableLookGraphNodeKind,
): LookGraphNodePayloadDraft => {
	switch (kind) {
		case "grade":
			return { kind, color: { exposure: -0.5, contrast: 1, saturation: 1 } };
		case "glow":
			return { kind, glow: { bloom: { strength: 0.35, radius: 0.5 } } };
		case "grain":
			return {
				kind,
				texture: { grain: { enabled: true, strength: 0.35, size: 0.3 } },
			};
		case "blur":
			return { kind, radius: 12 };
		case "chromatic-fringe":
			return { kind, amount: 0.4 };
		case "displace":
			return { kind, scale: 16, frequency: 0.03, octaves: 2 };
		case "posterize":
			return { kind, levels: 5 };
		case "color-map":
			// Omit `midtone` so the inserted node is a duotone (normalize → null).
			return { kind, shadow: "#161b3c", highlight: "#f5c542", mix: 1 };
		case "find-edges":
			return { kind, invert: false, mix: 1 };
		case "scanline":
			return { kind, density: 8, intensity: 0.5, softness: 0.15, noiseMix: 0 };
		case "halftone":
			return {
				kind,
				cellSize: 16,
				dotSize: 0.85,
				contrast: 0.65,
				angle: 15,
				mix: 1,
			};
		case "pixel-grid":
			return {
				kind,
				cellSize: 16,
				gap: 0.18,
				roundness: 0.6,
				brightness: 1.15,
				contrast: 0.45,
				mix: 1,
			};
		case "ordered-dither":
			return {
				kind,
				cellSize: 4,
				matrixSize: 4,
				levels: 2,
				mode: "luminance",
				pattern: "blue-noise",
				contrast: 0.55,
				threshold: 0.5,
				strength: 1,
				mix: 1,
				brightness: 0,
				gamma: 1,
				ink: "#000000",
				paper: "#ffffff",
			};
		case "ascii-glyph":
			return {
				kind,
				cellSize: 16,
				glyphScale: 0.9,
				contrast: 0.6,
				brightness: 1,
				densityBias: 0,
				invert: false,
				mix: 1,
			};
		case "block-mosaic":
			return {
				kind,
				cellSize: 24,
				gap: 0.1,
				bevel: 0.35,
				relief: 0.55,
				lightAngle: -35,
				lightElevation: 0.55,
				contrast: 0.45,
				variation: 0.16,
				mix: 1,
			};
		case "noise-field":
			return { kind, type: "fractalNoise", scale: 30, detail: 3, seed: 0 };
		case "warp":
			return {
				kind,
				mode: "radial",
				strength: 0.4,
				centerX: 0.5,
				centerY: 0.5,
			};
		case "lens":
			return {
				kind,
				size: 0.5,
				convergence: 0.7,
				centerX: 0.5,
				centerY: 0.5,
				clipToRim: false,
			};
		case "kaleidoscope":
			return { kind, segments: 6, centerX: 0.5, centerY: 0.5, roll: 0 };
		case "flow":
			return {
				kind,
				pattern: "turbulent",
				amount: 0.07,
				scale: 4,
				octaves: 3,
				evolution: 0,
				centerX: 0.5,
				centerY: 0.5,
			};
		case "path-blur":
			// Seed the canonical curved guide so the node bends a visible streak on drop;
			// scalars mirror the look-graph normalizer defaults (speed 100%, length 0.12).
			return {
				kind,
				guides: [DEFAULT_PATH_BLUR_GUIDE],
				speed: 100,
				length: 0.12,
				taper: 0.4,
				centeredBlur: false,
				strobeStrength: 0,
				strobeFlashes: 0,
			};
		case "noise-source":
			// speed 1 = boils on drop (the GPU node's point over the static SVG noise-field).
			return { kind, scale: 30, octaves: 3, evolution: 0, speed: 1 };
		case "deep-glow":
			return {
				kind,
				radius: 0.5,
				intensity: 0.45,
				threshold: 0.6,
				chroma: 0.3,
				blendMode: "screen",
			};
		case "riso":
			return {
				kind,
				cellSize: 12,
				dotSize: 0.9,
				contrast: 0.62,
				grain: 0.32,
				mix: 1,
				bloomProgress: 1,
				blendMode: "multiply",
				inks: [
					{ color: "#ff2d6b", angle: 15, offsetX: 0.6, offsetY: -0.4 },
					{ color: "#2b5cff", angle: 75, offsetX: -0.5, offsetY: 0.5 },
				],
			};
		case "colorama":
			return {
				kind,
				stops: [
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#ffffff" },
				],
				phase: 0,
				repetitions: 1,
				inputPhase: "luminance",
				mix: 1,
			};
		case "wave-warp":
			return {
				kind,
				waveType: "sine",
				height: 40,
				width: 200,
				direction: 90,
				phase: 0,
			};
		case "bend-warp":
			return { kind, bend: 0, distortionH: 0, distortionV: 0, scale: 1 };
		case "vhs-color":
			return { kind, bleed: 6, subsample: 2, colorUnder: 0.3, mix: 1 };
		case "vhs-tracking":
			return {
				kind,
				jitter: 0.25,
				wobble: 0.15,
				tear: 0.3,
				band: 0.2,
				bandPosition: 0.92,
				speed: 1,
				seed: 0,
				mix: 1,
				evolution: 0,
			};
		case "vhs-noise":
			return {
				kind,
				snow: 0.2,
				dropout: 0.15,
				dropoutLength: 24,
				generation: 2,
				speed: 1,
				seed: 0,
				mix: 1,
				evolution: 0,
			};
		case "crt-display":
			return {
				kind,
				maskType: "aperture",
				maskScale: 4,
				maskStrength: 0.5,
				curvature: 0.15,
				cornerRadius: 0.08,
				vignette: 0.35,
				mix: 1,
			};
		case "signal-glitch":
			return {
				kind,
				channelShift: 3,
				rollAmount: 0,
				tearDensity: 0.1,
				tearStrength: 20,
				speed: 1,
				seed: 0,
				mix: 1,
				evolution: 0,
			};
		case "interlace":
			return {
				kind,
				strength: 0.4,
				fieldOffset: 2,
				flicker: 0.15,
				speed: 1,
				mix: 1,
				evolution: 0,
			};
		case "mask":
			return { kind, source: "source-alpha", feather: 0 };
		case "composite":
			return { kind, blendMode: "normal", mix: 1 };
	}
};

const particleDissolvePayload = (): LookGraphNodePayloadDraft => ({
	kind: "grain",
	texture: {
		grain: {
			enabled: true,
			strength: 0.55,
			size: 0.24,
			densityCoupling: 0.48,
			temporalStability: 1,
			seed: 137,
		},
		material: {
			mode: "particle",
			strength: 0.65,
			particleContrast: 0.35,
			fieldMode: "contour",
		},
	},
});

const angleDegrees = (value: number): number => ((value % 360) + 360) % 360;

function imageEndpoint(nodeId: string, direction: "input" | "output") {
	return {
		nodeId,
		portId: lookGraphPortId(nodeId, direction, "image"),
	};
}

function endpointForPortName(
	nodeId: string,
	direction: "input" | "output",
	portName: string,
) {
	return {
		nodeId,
		portId: lookGraphPortId(nodeId, direction, portName),
	};
}

const primaryImageInputName = (kind: LookGraphNodeKind): string =>
	kind === "composite" ? "base" : "image";

function edgeDraft(fromNodeId: string, toNodeId: string): LookGraphEdgeDraft {
	const from = imageEndpoint(fromNodeId, "output");
	const to = imageEndpoint(toNodeId, "input");
	return { id: lookGraphEdgeId(from, to), from, to };
}

function edgeDraftToInput(
	fromNodeId: string,
	toNodeId: string,
	inputName: string,
): LookGraphEdgeDraft {
	const from = imageEndpoint(fromNodeId, "output");
	const to = endpointForPortName(toNodeId, "input", inputName);
	return { id: lookGraphEdgeId(from, to), from, to };
}

const sameEndpoint = (
	left: LookGraphEndpoint,
	right: LookGraphEndpoint,
): boolean => left.nodeId === right.nodeId && left.portId === right.portId;

const graphWithClearedInput = (
	graph: LookGraph,
	to: LookGraphEndpoint,
): LookGraph | undefined =>
	normalizeLookGraph({
		...graph,
		edges: graph.edges.filter((edge) => !sameEndpoint(edge.to, to)),
	});

const graphWithReplacedInputEdge = (
	graph: LookGraph,
	from: LookGraphEndpoint,
	to: LookGraphEndpoint,
): { readonly graph: LookGraph | undefined; readonly message?: string } => {
	const existingEdgeId = lookGraphEdgeId(from, to);
	const existingSameEdge = graph.edges.some(
		(edge) =>
			edge.id === existingEdgeId &&
			sameEndpoint(edge.from, from) &&
			sameEndpoint(edge.to, to),
	);
	if (existingSameEdge) return { graph };
	const targetPort = graph.nodes
		.find((node) => node.id === to.nodeId)
		?.inputs.find((port) => port.id === to.portId);
	const baseGraph =
		targetPort?.cardinality === "single"
			? graphWithClearedInput(graph, to)
			: graph;
	if (!baseGraph) {
		return { graph: undefined, message: "Look graph is empty." };
	}
	const issues = validateLookEdge(baseGraph, from, to);
	if (issues.length > 0) {
		return {
			graph: undefined,
			message: issues[0]?.message ?? "Cannot connect these ports.",
		};
	}
	return {
		graph: applyLookGraphOperation(graph, {
			kind: "connect",
			from,
			to,
			replaceInput: true,
		}),
	};
};

const incomingImageEdgeTo = (
	graph: LookGraph,
	nodeId: string,
): LookGraphEdge | undefined =>
	graph.edges.find(
		(edge) =>
			edge.to.nodeId === nodeId &&
			edge.to.portId === lookGraphPortId(nodeId, "input", "image"),
	);

const sourceNode = (graph: LookGraph): LookGraphNode | undefined =>
	graph.nodes.find((node) => node.kind === "source");

const serialInputPortForNode = (node: LookGraphNode): string | null =>
	node.kind === "mask"
		? null
		: lookGraphPortId(node.id, "input", primaryImageInputName(node.kind));

const serialNodeIds = (graph: LookGraph): readonly string[] => {
	const source = sourceNode(graph);
	const output = graph.nodes.find((node) => node.id === graph.outputNodeId);
	if (!source || !output || output.kind !== "output") return [];
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const ids: string[] = [source.id];
	const visited = new Set<string>(ids);
	let cursor = source.id;
	while (cursor !== output.id) {
		const next = graph.edges.find((edge) => {
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

const graphWithSerialEdges = (
	graph: LookGraph,
	chain: readonly string[],
): LookGraph | undefined => {
	const chainNodeIds = new Set(chain);
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const imageEdges = new Set(
		graph.edges
			.filter((edge) => {
				const toNode = nodesById.get(edge.to.nodeId);
				const serialInputPort = toNode ? serialInputPortForNode(toNode) : null;
				return (
					chainNodeIds.has(edge.from.nodeId) &&
					chainNodeIds.has(edge.to.nodeId) &&
					edge.from.portId ===
						lookGraphPortId(edge.from.nodeId, "output", "image") &&
					serialInputPort !== null &&
					edge.to.portId === serialInputPort
				);
			})
			.map((edge) => edge.id),
	);
	const preserved = graph.edges.filter((edge) => !imageEdges.has(edge.id));
	const edges: LookGraphEdgeDraft[] = [...preserved];
	for (let index = 0; index < chain.length - 1; index += 1) {
		const from = chain[index];
		const to = chain[index + 1];
		if (!from || !to) continue;
		const toNode = nodesById.get(to);
		if (!toNode) continue;
		edges.push(edgeDraftToInput(from, to, primaryImageInputName(toNode.kind)));
	}
	return normalizeLookGraph({ ...graph, edges });
};

type LookGraphStarterNodeSpec = {
	readonly kind: AuthorableLookGraphNodeKind;
	readonly label?: string;
	readonly payload?: LookGraphNodePayloadDraft;
	readonly focus?: boolean;
};

type LookGraphInsertion = {
	readonly graph: LookGraph | undefined;
	readonly focusNodeId?: string;
};

const focusMetadata = (
	focusNodeId: string | undefined,
): { readonly focusNodeId?: string } => (focusNodeId ? { focusNodeId } : {});

const starterLabel = (starterId: LookGraphStarterId): string => {
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

const starterNodeSpecs = (
	starterId: LookGraphStarterId,
): readonly LookGraphStarterNodeSpec[] => {
	switch (starterId) {
		case "soft-glow":
			return [
				{
					kind: "deep-glow",
					label: "Soft Glow",
					payload: {
						kind: "deep-glow",
						radius: 0.42,
						intensity: 0.55,
						threshold: 0.62,
						chroma: 0.16,
						blendMode: "screen",
					},
				},
			];
		case "duotone-poster":
			return [
				{
					kind: "color-map",
					label: "Duotone",
					payload: defaultPayloadForKind("color-map"),
					focus: true,
				},
				{
					kind: "posterize",
					payload: { kind: "posterize", levels: 6 },
				},
			];
		case "flow-glow":
			return [
				{
					kind: "flow",
					payload: {
						kind: "flow",
						pattern: "turbulent",
						amount: 0.05,
						scale: 3.5,
						octaves: 3,
						evolution: 0,
						centerX: 0.5,
						centerY: 0.5,
					},
				},
				{
					kind: "lens",
					payload: {
						kind: "lens",
						size: 0.48,
						convergence: 0.65,
						centerX: 0.5,
						centerY: 0.5,
						clipToRim: false,
					},
				},
				{
					kind: "deep-glow",
					payload: {
						kind: "deep-glow",
						radius: 0.52,
						intensity: 0.72,
						threshold: 0.55,
						chroma: 0.32,
						blendMode: "screen",
					},
					focus: true,
				},
			];
		case "print-poster":
			return [
				{
					kind: "color-map",
					label: "Ink Map",
					payload: {
						kind: "color-map",
						shadow: "#10151f",
						highlight: "#f4e8c9",
						mix: 1,
					},
				},
				{
					kind: "ordered-dither",
					label: "Bayer Ink",
					payload: {
						kind: "ordered-dither",
						cellSize: 4,
						matrixSize: 4,
						levels: 2,
						mode: "rgb",
						contrast: 0.66,
						threshold: 0.5,
						strength: 0.72,
						mix: 0.75,
					},
				},
				{
					kind: "halftone",
					label: "Print Screen",
					payload: {
						kind: "halftone",
						cellSize: 14,
						dotSize: 0.78,
						contrast: 0.7,
						angle: 15,
						mix: 0.82,
					},
					focus: true,
				},
			];
		case "led-glow":
			return [
				{
					kind: "pixel-grid",
					label: "LED Glow",
					payload: {
						kind: "pixel-grid",
						cellSize: 18,
						gap: 0.22,
						roundness: 0.82,
						brightness: 1.28,
						contrast: 0.5,
						mix: 1,
					},
					focus: true,
				},
				{
					kind: "deep-glow",
					label: "Panel Bloom",
					payload: {
						kind: "deep-glow",
						radius: 0.22,
						intensity: 0.34,
						threshold: 0.62,
						chroma: 0.12,
						blendMode: "screen",
					},
				},
			];
		case "glyph-poster":
			return [
				{
					kind: "color-map",
					label: "Terminal Map",
					payload: {
						kind: "color-map",
						shadow: "#081016",
						midtone: "#1f6f54",
						highlight: "#b7ffd6",
						mix: 0.82,
					},
				},
				{
					kind: "ascii-glyph",
					label: "Glyph Poster",
					payload: {
						kind: "ascii-glyph",
						cellSize: 16,
						glyphScale: 0.92,
						contrast: 0.72,
						brightness: 1.18,
						densityBias: 0.05,
						invert: false,
						mix: 1,
					},
					focus: true,
				},
			];
		case "surveillance-feed":
			return [
				{
					kind: "color-map",
					label: "Night Map",
					payload: {
						kind: "color-map",
						shadow: "#03130f",
						midtone: "#1f5f45",
						highlight: "#baf7d4",
						mix: 0.92,
					},
				},
				{
					kind: "scanline",
					label: "Signal Lines",
					payload: {
						kind: "scanline",
						density: 12,
						intensity: 0.42,
						softness: 0.22,
						noiseMix: 0.18,
					},
				},
				{
					kind: "pixel-grid",
					label: "Low-Res Display",
					payload: {
						kind: "pixel-grid",
						cellSize: 12,
						gap: 0.16,
						roundness: 0.24,
						brightness: 1.08,
						contrast: 0.58,
						mix: 0.88,
					},
					focus: true,
				},
			];
		case "vhs-1985":
			return [
				{
					kind: "vhs-color",
					label: "Composite Bleed",
					payload: {
						kind: "vhs-color",
						bleed: 8,
						subsample: 3,
						colorUnder: 0.35,
						mix: 0.85,
					},
				},
				{
					kind: "vhs-tracking",
					label: "Tape Tracking",
					payload: {
						kind: "vhs-tracking",
						jitter: 0.3,
						wobble: 0.2,
						tear: 0.25,
						band: 0.15,
						mix: 0.8,
					},
				},
				{
					kind: "vhs-noise",
					label: "Tape Noise",
					payload: {
						kind: "vhs-noise",
						snow: 0.18,
						dropout: 0.12,
						generation: 2,
						mix: 0.75,
					},
				},
				{
					kind: "grain",
					label: "Film Grain",
					payload: {
						kind: "grain",
						texture: { grain: { enabled: true, strength: 0.3, size: 0.35 } },
					},
					focus: true,
				},
			];
		case "vhs-ep":
			return [
				{
					kind: "vhs-color",
					label: "Composite Bleed",
					payload: {
						kind: "vhs-color",
						bleed: 14,
						subsample: 4,
						colorUnder: 0.55,
						mix: 0.9,
					},
				},
				{
					kind: "vhs-tracking",
					label: "Tape Tracking",
					payload: {
						kind: "vhs-tracking",
						jitter: 0.5,
						wobble: 0.35,
						tear: 0.45,
						band: 0.3,
						mix: 0.9,
					},
				},
				{
					kind: "vhs-noise",
					label: "Tape Noise",
					payload: {
						kind: "vhs-noise",
						snow: 0.32,
						dropout: 0.28,
						generation: 4,
						mix: 0.85,
					},
				},
				{
					kind: "interlace",
					label: "Field Comb",
					payload: {
						kind: "interlace",
						strength: 0.5,
						fieldOffset: 3,
						flicker: 0.25,
						mix: 0.8,
					},
					focus: true,
				},
			];
		case "crt-monitor":
			return [
				{
					kind: "scanline",
					label: "Scan Lines",
					payload: {
						kind: "scanline",
						density: 10,
						intensity: 0.4,
						softness: 0.2,
						noiseMix: 0.1,
					},
				},
				{
					kind: "crt-display",
					label: "CRT Monitor",
					payload: {
						kind: "crt-display",
						maskType: "aperture",
						maskScale: 4,
						maskStrength: 0.55,
						curvature: 0.2,
						cornerRadius: 0.1,
						vignette: 0.4,
						mix: 1,
					},
					focus: true,
				},
			];
		case "broadcast-glitch":
			return [
				{
					kind: "signal-glitch",
					label: "Signal Glitch",
					payload: {
						kind: "signal-glitch",
						channelShift: 5,
						rollAmount: 0.05,
						tearDensity: 0.15,
						tearStrength: 30,
						mix: 0.85,
					},
				},
				{
					kind: "vhs-color",
					label: "Composite Bleed",
					payload: {
						kind: "vhs-color",
						bleed: 6,
						subsample: 2,
						colorUnder: 0.3,
						mix: 0.7,
					},
					focus: true,
				},
			];
	}
};

const insertSerialNodeSequence = (
	graph: LookGraph,
	target: FrameLookGraphTarget,
	specs: readonly LookGraphStarterNodeSpec[],
	insertAfterNodeId?: string | null,
): LookGraphInsertion => {
	if (specs.length === 0) return { graph };
	const output = graph.nodes.find((node) => node.id === graph.outputNodeId);
	const source = sourceNode(graph);
	if (output?.kind !== "output" || !source) return { graph: undefined };
	const incoming = incomingImageEdgeTo(graph, output.id);
	const chain = serialNodeIds(graph);
	const anchorIndex = insertAfterNodeId ? chain.indexOf(insertAfterNodeId) : -1;
	const fromId =
		anchorIndex >= 0 && anchorIndex < chain.length - 1
			? chain[anchorIndex]
			: (incoming?.from.nodeId ?? source.id);
	const toId =
		anchorIndex >= 0 && anchorIndex < chain.length - 1
			? chain[anchorIndex + 1]
			: output.id;
	const toNode = graph.nodes.find((candidate) => candidate.id === toId);
	if (!fromId || !toId || !toNode) return { graph: undefined };
	const used = new Set(graph.nodes.map((node) => node.id));
	const nodeDrafts = specs.map((spec) => {
		const id = uniqueNodeIdFromUsed(target, spec.kind, used);
		used.add(id);
		return {
			id,
			kind: spec.kind,
			...(spec.label === undefined ? {} : { label: spec.label }),
			payload: spec.payload ?? defaultPayloadForKind(spec.kind),
		} satisfies LookGraphNodeDraft;
	});
	const replacedEdge = graph.edges.find(
		(edge) =>
			edge.from.nodeId === fromId &&
			edge.from.portId === lookGraphPortId(fromId, "output", "image") &&
			edge.to.nodeId === toId &&
			edge.to.portId ===
				lookGraphPortId(toId, "input", primaryImageInputName(toNode.kind)),
	);
	const edges = graph.edges.filter((edge) => edge.id !== replacedEdge?.id);
	const sequenceEdges: LookGraphEdgeDraft[] = [];
	const first = nodeDrafts[0];
	if (!first) return { graph: undefined };
	sequenceEdges.push(edgeDraftToInput(fromId, first.id, "image"));
	for (let index = 0; index < nodeDrafts.length - 1; index += 1) {
		const current = nodeDrafts[index];
		const next = nodeDrafts[index + 1];
		if (!current || !next) continue;
		sequenceEdges.push(edgeDraftToInput(current.id, next.id, "image"));
	}
	const last = nodeDrafts[nodeDrafts.length - 1];
	if (!last) return { graph: undefined };
	sequenceEdges.push(
		edgeDraftToInput(last.id, toId, primaryImageInputName(toNode.kind)),
	);
	const focusNodeId =
		nodeDrafts.find((_, index) => specs[index]?.focus)?.id ?? last.id;
	return {
		graph: normalizeLookGraph({
			...graph,
			nodes: [...graph.nodes, ...nodeDrafts],
			edges: [...edges, ...sequenceEdges],
		}),
		focusNodeId,
	};
};

const insertNode = (
	graph: LookGraph,
	target: FrameLookGraphTarget,
	kind: AuthorableLookGraphNodeKind,
	insertAfterNodeId?: string | null,
	draft?: {
		readonly label?: string;
		readonly payload?: LookGraphNodePayloadDraft;
	},
): LookGraphInsertion => {
	const output = graph.nodes.find((node) => node.id === graph.outputNodeId);
	const source = sourceNode(graph);
	if (output?.kind !== "output" || !source) return { graph: undefined };
	const incoming = incomingImageEdgeTo(graph, output.id);
	const nodeId = uniqueNodeId(graph, target, kind);
	const node: LookGraphNodeDraft = {
		id: nodeId,
		kind,
		...(draft?.label === undefined ? {} : { label: draft.label }),
		payload: draft?.payload ?? defaultPayloadForKind(kind),
	};
	if (kind === "mask") {
		return {
			graph: normalizeLookGraph({
				...graph,
				nodes: [...graph.nodes, node],
				edges: [...graph.edges, edgeDraft(source.id, nodeId)],
			}),
			focusNodeId: nodeId,
		};
	}
	// A generator (no image input — e.g. `noise-field`) cannot sit *between* upstream and
	// output. It becomes the rendered content: wire it straight to the output, dropping the
	// previous output-feeder (the prior chain stays as orphaned nodes the user can rewire).
	if (LOOK_GRAPH_NODE_PORT_CATALOG[kind].inputs.length === 0) {
		const edges = graph.edges.filter((edge) => edge.id !== incoming?.id);
		return {
			graph: normalizeLookGraph({
				...graph,
				nodes: [...graph.nodes, node],
				edges: [...edges, edgeDraft(nodeId, output.id)],
			}),
			focusNodeId: nodeId,
		};
	}
	const chain = serialNodeIds(graph);
	const anchorIndex = insertAfterNodeId ? chain.indexOf(insertAfterNodeId) : -1;
	const fromId =
		anchorIndex >= 0 && anchorIndex < chain.length - 1
			? chain[anchorIndex]
			: (incoming?.from.nodeId ?? source.id);
	const toId =
		anchorIndex >= 0 && anchorIndex < chain.length - 1
			? chain[anchorIndex + 1]
			: output.id;
	const toNode = graph.nodes.find((candidate) => candidate.id === toId);
	if (!fromId || !toId || !toNode) return { graph: undefined };
	const replacedEdge = graph.edges.find(
		(edge) =>
			edge.from.nodeId === fromId &&
			edge.from.portId === lookGraphPortId(fromId, "output", "image") &&
			edge.to.nodeId === toId &&
			edge.to.portId ===
				lookGraphPortId(toId, "input", primaryImageInputName(toNode.kind)),
	);
	const edges = graph.edges.filter((edge) => edge.id !== replacedEdge?.id);
	if (kind === "composite") {
		return {
			graph: normalizeLookGraph({
				...graph,
				nodes: [...graph.nodes, node],
				edges: [
					...edges,
					edgeDraftToInput(fromId, nodeId, "base"),
					edgeDraftToInput(nodeId, toId, primaryImageInputName(toNode.kind)),
				],
			}),
			focusNodeId: nodeId,
		};
	}
	return {
		graph: normalizeLookGraph({
			...graph,
			nodes: [...graph.nodes, node],
			edges: [
				...edges,
				edgeDraft(fromId, nodeId),
				edgeDraftToInput(nodeId, toId, primaryImageInputName(toNode.kind)),
			],
		}),
		focusNodeId: nodeId,
	};
};

/**
 * Noise Background starter action: drop a `noise-field` generator AND a `composite`
 * in one graph replacement (one undo), wiring the noise field UNDER the existing
 * look content. The current output feeder becomes the composite `overlay` (front,
 * `normal` blend); the noise becomes `base` (behind). Unlike a bare generator insert
 * the upstream chain stays connected (it routes through `overlay`), so nothing is
 * orphaned. Note: this composites behind the look-graph CONTENT — where that content
 * is fully opaque it hides the noise; it does not replace an opaque artboard fill.
 */
const insertNoiseFieldAsBackground = (
	graph: LookGraph,
	target: FrameLookGraphTarget,
): LookGraphInsertion => {
	const output = graph.nodes.find((node) => node.id === graph.outputNodeId);
	const source = sourceNode(graph);
	if (output?.kind !== "output" || !source) return { graph: undefined };
	const incoming = incomingImageEdgeTo(graph, output.id);
	const overlayUpstreamId = incoming?.from.nodeId ?? source.id;
	const used = new Set(graph.nodes.map((node) => node.id));
	const noiseId = uniqueNodeIdFromUsed(target, "noise-field", used);
	used.add(noiseId);
	const compositeId = uniqueNodeIdFromUsed(target, "composite", used);
	const noiseNode: LookGraphNodeDraft = {
		id: noiseId,
		kind: "noise-field",
		payload: defaultPayloadForKind("noise-field"),
	};
	const compositeNode: LookGraphNodeDraft = {
		id: compositeId,
		kind: "composite",
		payload: defaultPayloadForKind("composite"),
	};
	const edges = graph.edges.filter((edge) => edge.id !== incoming?.id);
	return {
		graph: normalizeLookGraph({
			...graph,
			nodes: [...graph.nodes, noiseNode, compositeNode],
			edges: [
				...edges,
				edgeDraftToInput(noiseId, compositeId, "base"),
				edgeDraftToInput(overlayUpstreamId, compositeId, "overlay"),
				edgeDraft(compositeId, output.id),
			],
		}),
		focusNodeId: noiseId,
	};
};

const removeAnyAuthorableNode = (
	graph: LookGraph,
	nodeId: string,
): LookGraph | undefined => {
	const node = graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || node.kind === "source" || node.kind === "output") {
		return undefined;
	}
	return normalizeLookGraph({
		...graph,
		nodes: graph.nodes.filter((candidate) => candidate.id !== nodeId),
		edges: graph.edges.filter(
			(edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId,
		),
	});
};

const removeSerialNode = (
	graph: LookGraph,
	nodeId: string,
): LookGraph | undefined => {
	const chain = serialNodeIds(graph);
	const index = chain.indexOf(nodeId);
	if (index <= 0 || index >= chain.length - 1) return undefined;
	const nextChain = chain.filter((id) => id !== nodeId);
	const nextNodes = graph.nodes.filter((node) => node.id !== nodeId);
	const nextGraph = normalizeLookGraph({
		...graph,
		nodes: nextNodes,
		edges: graph.edges.filter(
			(edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId,
		),
	});
	return nextGraph ? graphWithSerialEdges(nextGraph, nextChain) : undefined;
};

const removeNode = (graph: LookGraph, nodeId: string): LookGraph | undefined =>
	removeSerialNode(graph, nodeId) ?? removeAnyAuthorableNode(graph, nodeId);

const reorderSerialNode = (
	graph: LookGraph,
	nodeId: string,
	direction: "up" | "down",
): LookGraph | undefined => {
	const chain = [...serialNodeIds(graph)];
	const index = chain.indexOf(nodeId);
	if (index <= 0 || index >= chain.length - 1) return undefined;
	const nextIndex = direction === "up" ? index - 1 : index + 1;
	if (nextIndex <= 0 || nextIndex >= chain.length - 1) return undefined;
	const swap = chain[nextIndex];
	if (!swap) return undefined;
	chain[nextIndex] = nodeId;
	chain[index] = swap;
	return graphWithSerialEdges(graph, chain);
};

/** Creates the correct set-graph command for both frame-level and scoped overlay owners. */
export const createSetFrameLookGraphCommand = (
	target: FrameLookGraphTarget,
	graph: LookGraph,
	options: UpdateLookGraphOptions = {},
): SceneCommand =>
	target.scope === "scoped-overlay"
		? createSetScopedLookGraphOverlayCommand(
				target.artboardId,
				target.scopedLookId,
				graph,
				options,
			)
		: createSetLookGraphCommand(target, graph, options);

const resultFromNextGraph = (
	target: FrameLookGraphTarget,
	currentGraph: LookGraph | null,
	nextGraph: LookGraph | undefined,
	options: UpdateLookGraphOptions,
	metadata: { readonly focusNodeId?: string } = {},
): FrameLookGraphCommandResult => {
	if (!nextGraph) return { kind: "unchanged", target, graph: currentGraph };
	if (sameJson(currentGraph, nextGraph)) {
		return { kind: "unchanged", target, graph: nextGraph };
	}
	return {
		kind: "ready",
		target,
		graph: nextGraph,
		command: createSetFrameLookGraphCommand(target, nextGraph, options),
		...metadata,
	};
};

const commandResult = (
	target: FrameLookGraphTarget,
	currentGraph: LookGraph | null,
	nextGraph: LookGraph | undefined,
	options: UpdateLookGraphOptions,
): FrameLookGraphCommandResult =>
	resultFromNextGraph(target, currentGraph, nextGraph, options);

const concreteGraphContext = (
	document: SceneDocument,
	target: FrameLookGraphTarget,
): {
	readonly target: FrameLookGraphTarget;
	readonly graph: LookGraph | null;
} | null => {
	const concrete = concreteTargetForTarget(document, target);
	if (!concrete) return null;
	const resolvedTarget = concrete.target;
	return {
		target: resolvedTarget,
		graph: readFrameLookGraphForTarget(document, resolvedTarget),
	};
};

/** Inserts an authorable graph node using effect-chain or branch-safe defaults. */
export function createInsertLookGraphNodeCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	kind: AuthorableLookGraphNodeKind,
	options: InsertLookGraphNodeOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	const graph =
		context.graph ?? sourceOutputGraph(context.target) ?? context.graph;
	if (!graph) return { kind: "missing-graph", target: context.target };
	const { insertAfterNodeId, ...updateOptions } = options;
	const insertion = insertNode(graph, context.target, kind, insertAfterNodeId);
	return resultFromNextGraph(
		context.target,
		context.graph,
		insertion.graph,
		{ label: "Add look graph node", ...updateOptions },
		focusMetadata(insertion.focusNodeId),
	);
}

/** Inserts a first-class frame-scope particle dissolve texture node. */
export function createInsertParticleDissolveNodeCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	options: InsertLookGraphNodeOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	const graph =
		context.graph ?? sourceOutputGraph(context.target) ?? context.graph;
	if (!graph) return { kind: "missing-graph", target: context.target };
	const { insertAfterNodeId, ...updateOptions } = options;
	const insertion = insertNode(
		graph,
		context.target,
		"grain",
		insertAfterNodeId,
		{
			label: "Particle Dissolve",
			payload: particleDissolvePayload(),
		},
	);
	return resultFromNextGraph(
		context.target,
		context.graph,
		insertion.graph,
		{ label: "Add particle dissolve", ...updateOptions },
		focusMetadata(insertion.focusNodeId),
	);
}

/** Inserts a result-oriented starter Look as normal editable graph nodes. */
export function createInsertLookGraphStarterCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	starterId: LookGraphStarterId,
	options: InsertLookGraphNodeOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	const graph =
		context.graph ?? sourceOutputGraph(context.target) ?? context.graph;
	if (!graph) return { kind: "missing-graph", target: context.target };
	const { insertAfterNodeId, ...updateOptions } = options;
	const insertion = insertSerialNodeSequence(
		graph,
		context.target,
		starterNodeSpecs(starterId),
		insertAfterNodeId,
	);
	return resultFromNextGraph(
		context.target,
		context.graph,
		insertion.graph,
		{ label: starterLabel(starterId), ...updateOptions },
		focusMetadata(insertion.focusNodeId),
	);
}

/**
 * Noise Background starter action: insert a `noise-field` + `composite` and wire the
 * noise behind the existing look content in a single command (one undo). See
 * `insertNoiseFieldAsBackground` for the wiring and its opacity caveat.
 */
export function createInsertNoiseFieldBackgroundCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	const graph =
		context.graph ?? sourceOutputGraph(context.target) ?? context.graph;
	if (!graph) return { kind: "missing-graph", target: context.target };
	const insertion = insertNoiseFieldAsBackground(graph, context.target);
	return resultFromNextGraph(
		context.target,
		context.graph,
		insertion.graph,
		{ label: "Use noise as background", ...options },
		focusMetadata(insertion.focusNodeId),
	);
}

/** Writes the currently resolved frame Look into the concrete target's graph slot. */
export function createMaterializeLookGraphCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	const graph =
		context.graph ?? sourceOutputGraph(context.target) ?? context.graph;
	if (!graph) return { kind: "missing-graph", target: context.target };
	return commandResult(context.target, null, graph, {
		label: "Edit as look graph",
		...options,
	});
}

/** Removes one authorable graph node, reconnecting neighbors when it sits on the serial chain. */
export function createRemoveLookGraphNodeCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	nodeId: string,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (!context.graph) return { kind: "missing-graph", target: context.target };
	return resultFromNextGraph(
		context.target,
		context.graph,
		removeNode(context.graph, nodeId),
		{ label: "Remove look graph node", ...options },
	);
}

/** Swaps one serial node with its previous or next effect node. */
export function createReorderLookGraphNodeCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	nodeId: string,
	direction: "up" | "down",
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (!context.graph) return { kind: "missing-graph", target: context.target };
	return resultFromNextGraph(
		context.target,
		context.graph,
		reorderSerialNode(context.graph, nodeId, direction),
		{ label: "Reorder look graph", ...options },
	);
}

const nodePayloadWithNumber = (
	node: LookGraphNode,
	path: LookGraphNodeNumberPath,
	value: number,
): LookGraphNodePayloadDraft | null => {
	switch (path) {
		case "grade.exposure":
			return node.payload.kind === "grade"
				? { kind: "grade", color: { ...node.payload.color, exposure: value } }
				: null;
		case "grade.contrast":
			return node.payload.kind === "grade"
				? { kind: "grade", color: { ...node.payload.color, contrast: value } }
				: null;
		case "grade.saturation":
			return node.payload.kind === "grade"
				? { kind: "grade", color: { ...node.payload.color, saturation: value } }
				: null;
		case "glow.strength":
			return node.payload.kind === "glow"
				? {
						kind: "glow",
						glow: {
							...node.payload.glow,
							bloom: { ...node.payload.glow.bloom, strength: value },
						},
					}
				: null;
		case "glow.radius":
			return node.payload.kind === "glow"
				? {
						kind: "glow",
						glow: {
							...node.payload.glow,
							bloom: { ...node.payload.glow.bloom, radius: value },
						},
					}
				: null;
		case "grain.strength":
			return node.payload.kind === "grain"
				? {
						kind: "grain",
						texture: {
							...node.payload.texture,
							grain: {
								...node.payload.texture.grain,
								enabled:
									value > 0 ||
									node.payload.texture.material.mode === "particle" ||
									node.payload.texture.material.mode === "mixed",
								strength: value,
								densityCoupling:
									node.payload.texture.material.mode === "particle" ||
									node.payload.texture.material.mode === "mixed"
										? value
										: node.payload.texture.grain.densityCoupling,
							},
						},
					}
				: null;
		case "grain.size":
			return node.payload.kind === "grain"
				? {
						kind: "grain",
						texture: {
							...node.payload.texture,
							grain: { ...node.payload.texture.grain, size: value },
						},
					}
				: null;
		case "grain.extent":
			return node.payload.kind === "grain"
				? {
						kind: "grain",
						texture: {
							...node.payload.texture,
							material: {
								...node.payload.texture.material,
								strength: value,
								...(textureParticleFieldMode(node.payload.texture) === "linear"
									? {
											linearField: {
												...textureParticleLinearFieldEffective(
													resolveTextureParticleLinearField(
														node.payload.texture,
													),
												),
												plateau: 1 - value,
											},
										}
									: {}),
							},
						},
					}
				: null;
		case "grain.softness":
			return node.payload.kind === "grain"
				? {
						kind: "grain",
						texture: {
							...node.payload.texture,
							material: {
								...node.payload.texture.material,
								particleContrast: 1 - value,
							},
						},
					}
				: null;
		case "grain.angle": {
			if (node.payload.kind !== "grain") return null;
			const nextLinearField = textureParticleLinearFieldWithAngle(
				textureParticleLinearFieldEffective(
					resolveTextureParticleLinearField(node.payload.texture),
				),
				angleDegrees(value),
			);
			return {
				kind: "grain",
				texture: {
					...node.payload.texture,
					material: {
						...node.payload.texture.material,
						mode:
							node.payload.texture.material.mode === "off"
								? "particle"
								: node.payload.texture.material.mode,
						fieldMode: "linear",
						angle: textureParticleLinearFieldAngle(nextLinearField),
						strength: textureParticleLinearFieldExtent(nextLinearField),
						linearField: nextLinearField,
					},
				},
			};
		}
		case "blur.radius":
			return node.payload.kind === "blur"
				? { ...node.payload, kind: "blur", radius: value }
				: null;
		case "blur.radiusY":
			return node.payload.kind === "blur"
				? { ...node.payload, kind: "blur", radiusY: value }
				: null;
		case "chromatic-fringe.amount":
			return node.payload.kind === "chromatic-fringe"
				? { kind: "chromatic-fringe", amount: value }
				: null;
		case "displace.scale":
			return node.payload.kind === "displace"
				? { ...node.payload, kind: "displace", scale: value }
				: null;
		case "displace.frequency":
			return node.payload.kind === "displace"
				? { ...node.payload, kind: "displace", frequency: value }
				: null;
		case "displace.octaves":
			return node.payload.kind === "displace"
				? { ...node.payload, kind: "displace", octaves: value }
				: null;
		case "posterize.levels":
			return node.payload.kind === "posterize"
				? { kind: "posterize", levels: value }
				: null;
		case "color-map.mix":
			return node.payload.kind === "color-map"
				? { ...node.payload, kind: "color-map", mix: value }
				: null;
		case "find-edges.mix":
			return node.payload.kind === "find-edges"
				? { ...node.payload, kind: "find-edges", mix: value }
				: null;
		case "scanline.density":
			return node.payload.kind === "scanline"
				? { ...node.payload, kind: "scanline", density: value }
				: null;
		case "scanline.intensity":
			return node.payload.kind === "scanline"
				? { ...node.payload, kind: "scanline", intensity: value }
				: null;
		case "scanline.softness":
			return node.payload.kind === "scanline"
				? { ...node.payload, kind: "scanline", softness: value }
				: null;
		case "scanline.noiseMix":
			return node.payload.kind === "scanline"
				? { ...node.payload, kind: "scanline", noiseMix: value }
				: null;
		case "halftone.cellSize":
			return node.payload.kind === "halftone"
				? { ...node.payload, kind: "halftone", cellSize: value }
				: null;
		case "halftone.dotSize":
			return node.payload.kind === "halftone"
				? { ...node.payload, kind: "halftone", dotSize: value }
				: null;
		case "halftone.contrast":
			return node.payload.kind === "halftone"
				? { ...node.payload, kind: "halftone", contrast: value }
				: null;
		case "halftone.angle":
			return node.payload.kind === "halftone"
				? { ...node.payload, kind: "halftone", angle: value }
				: null;
		case "halftone.mix":
			return node.payload.kind === "halftone"
				? { ...node.payload, kind: "halftone", mix: value }
				: null;
		case "pixel-grid.cellSize":
			return node.payload.kind === "pixel-grid"
				? { ...node.payload, kind: "pixel-grid", cellSize: value }
				: null;
		case "pixel-grid.gap":
			return node.payload.kind === "pixel-grid"
				? { ...node.payload, kind: "pixel-grid", gap: value }
				: null;
		case "pixel-grid.roundness":
			return node.payload.kind === "pixel-grid"
				? { ...node.payload, kind: "pixel-grid", roundness: value }
				: null;
		case "pixel-grid.brightness":
			return node.payload.kind === "pixel-grid"
				? { ...node.payload, kind: "pixel-grid", brightness: value }
				: null;
		case "pixel-grid.contrast":
			return node.payload.kind === "pixel-grid"
				? { ...node.payload, kind: "pixel-grid", contrast: value }
				: null;
		case "pixel-grid.mix":
			return node.payload.kind === "pixel-grid"
				? { ...node.payload, kind: "pixel-grid", mix: value }
				: null;
		case "ordered-dither.cellSize":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", cellSize: value }
				: null;
		case "ordered-dither.matrixSize":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", matrixSize: value }
				: null;
		case "ordered-dither.levels":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", levels: value }
				: null;
		case "ordered-dither.contrast":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", contrast: value }
				: null;
		case "ordered-dither.threshold":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", threshold: value }
				: null;
		case "ordered-dither.strength":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", strength: value }
				: null;
		case "ordered-dither.mix":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", mix: value }
				: null;
		case "ordered-dither.brightness":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", brightness: value }
				: null;
		case "ordered-dither.gamma":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", gamma: value }
				: null;
		case "ascii-glyph.cellSize":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", cellSize: value }
				: null;
		case "ascii-glyph.glyphScale":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", glyphScale: value }
				: null;
		case "ascii-glyph.contrast":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", contrast: value }
				: null;
		case "ascii-glyph.brightness":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", brightness: value }
				: null;
		case "ascii-glyph.densityBias":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", densityBias: value }
				: null;
		case "ascii-glyph.mix":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", mix: value }
				: null;
		case "block-mosaic.cellSize":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", cellSize: value }
				: null;
		case "block-mosaic.gap":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", gap: value }
				: null;
		case "block-mosaic.bevel":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", bevel: value }
				: null;
		case "block-mosaic.relief":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", relief: value }
				: null;
		case "block-mosaic.lightAngle":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", lightAngle: value }
				: null;
		case "block-mosaic.lightElevation":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", lightElevation: value }
				: null;
		case "block-mosaic.contrast":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", contrast: value }
				: null;
		case "block-mosaic.variation":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", variation: value }
				: null;
		case "block-mosaic.mix":
			return node.payload.kind === "block-mosaic"
				? { ...node.payload, kind: "block-mosaic", mix: value }
				: null;
		case "noise-field.scale":
			return node.payload.kind === "noise-field"
				? { ...node.payload, kind: "noise-field", scale: value }
				: null;
		case "noise-field.detail":
			return node.payload.kind === "noise-field"
				? { ...node.payload, kind: "noise-field", detail: value }
				: null;
		case "noise-field.seed":
			return node.payload.kind === "noise-field"
				? { ...node.payload, kind: "noise-field", seed: value }
				: null;
		case "warp.strength":
			return node.payload.kind === "warp"
				? { ...node.payload, kind: "warp", strength: value }
				: null;
		case "warp.centerX":
			return node.payload.kind === "warp"
				? { ...node.payload, kind: "warp", centerX: value }
				: null;
		case "warp.centerY":
			return node.payload.kind === "warp"
				? { ...node.payload, kind: "warp", centerY: value }
				: null;
		case "lens.size":
			return node.payload.kind === "lens"
				? { ...node.payload, kind: "lens", size: value }
				: null;
		case "lens.convergence":
			return node.payload.kind === "lens"
				? { ...node.payload, kind: "lens", convergence: value }
				: null;
		case "lens.centerX":
			return node.payload.kind === "lens"
				? { ...node.payload, kind: "lens", centerX: value }
				: null;
		case "lens.centerY":
			return node.payload.kind === "lens"
				? { ...node.payload, kind: "lens", centerY: value }
				: null;
		case "kaleidoscope.segments":
			return node.payload.kind === "kaleidoscope"
				? { ...node.payload, kind: "kaleidoscope", segments: value }
				: null;
		case "kaleidoscope.centerX":
			return node.payload.kind === "kaleidoscope"
				? { ...node.payload, kind: "kaleidoscope", centerX: value }
				: null;
		case "kaleidoscope.centerY":
			return node.payload.kind === "kaleidoscope"
				? { ...node.payload, kind: "kaleidoscope", centerY: value }
				: null;
		case "kaleidoscope.roll":
			return node.payload.kind === "kaleidoscope"
				? { ...node.payload, kind: "kaleidoscope", roll: value }
				: null;
		case "flow.amount":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", amount: value }
				: null;
		case "flow.scale":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", scale: value }
				: null;
		case "flow.octaves":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", octaves: value }
				: null;
		case "flow.evolution":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", evolution: value }
				: null;
		case "flow.centerX":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", centerX: value }
				: null;
		case "flow.centerY":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", centerY: value }
				: null;
		case "path-blur.speed":
			return node.payload.kind === "path-blur"
				? { ...node.payload, kind: "path-blur", speed: value }
				: null;
		case "path-blur.length":
			return node.payload.kind === "path-blur"
				? { ...node.payload, kind: "path-blur", length: value }
				: null;
		case "path-blur.taper":
			return node.payload.kind === "path-blur"
				? { ...node.payload, kind: "path-blur", taper: value }
				: null;
		case "noise-source.scale":
			return node.payload.kind === "noise-source"
				? { ...node.payload, kind: "noise-source", scale: value }
				: null;
		case "noise-source.octaves":
			return node.payload.kind === "noise-source"
				? { ...node.payload, kind: "noise-source", octaves: value }
				: null;
		case "noise-source.evolution":
			return node.payload.kind === "noise-source"
				? { ...node.payload, kind: "noise-source", evolution: value }
				: null;
		case "noise-source.speed":
			return node.payload.kind === "noise-source"
				? { ...node.payload, kind: "noise-source", speed: value }
				: null;
		case "deep-glow.radius":
			return node.payload.kind === "deep-glow"
				? { ...node.payload, kind: "deep-glow", radius: value }
				: null;
		case "deep-glow.intensity":
			return node.payload.kind === "deep-glow"
				? { ...node.payload, kind: "deep-glow", intensity: value }
				: null;
		case "deep-glow.threshold":
			return node.payload.kind === "deep-glow"
				? { ...node.payload, kind: "deep-glow", threshold: value }
				: null;
		case "deep-glow.chroma":
			return node.payload.kind === "deep-glow"
				? { ...node.payload, kind: "deep-glow", chroma: value }
				: null;
		case "riso.cellSize":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", cellSize: value }
				: null;
		case "riso.dotSize":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", dotSize: value }
				: null;
		case "riso.contrast":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", contrast: value }
				: null;
		case "riso.grain":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", grain: value }
				: null;
		case "riso.mix":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", mix: value }
				: null;
		case "riso.bloomProgress":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", bloomProgress: value }
				: null;
		case "riso.amount":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", amount: value }
				: null;
		case "riso.fieldSoftness":
			return node.payload.kind === "riso"
				? {
						...node.payload,
						kind: "riso",
						field: { ...node.payload.field, softness: value },
					}
				: null;
		case "colorama.phase":
			return node.payload.kind === "colorama"
				? { ...node.payload, kind: "colorama", phase: value }
				: null;
		case "colorama.repetitions":
			return node.payload.kind === "colorama"
				? { ...node.payload, kind: "colorama", repetitions: value }
				: null;
		case "colorama.mix":
			return node.payload.kind === "colorama"
				? { ...node.payload, kind: "colorama", mix: value }
				: null;
		case "wave-warp.height":
			return node.payload.kind === "wave-warp"
				? { ...node.payload, kind: "wave-warp", height: value }
				: null;
		case "wave-warp.width":
			return node.payload.kind === "wave-warp"
				? { ...node.payload, kind: "wave-warp", width: value }
				: null;
		case "wave-warp.direction":
			return node.payload.kind === "wave-warp"
				? { ...node.payload, kind: "wave-warp", direction: value }
				: null;
		case "wave-warp.phase":
			return node.payload.kind === "wave-warp"
				? { ...node.payload, kind: "wave-warp", phase: value }
				: null;
		case "bend-warp.bend":
			return node.payload.kind === "bend-warp"
				? { ...node.payload, kind: "bend-warp", bend: value }
				: null;
		case "bend-warp.distortionH":
			return node.payload.kind === "bend-warp"
				? { ...node.payload, kind: "bend-warp", distortionH: value }
				: null;
		case "bend-warp.distortionV":
			return node.payload.kind === "bend-warp"
				? { ...node.payload, kind: "bend-warp", distortionV: value }
				: null;
		case "bend-warp.scale":
			return node.payload.kind === "bend-warp"
				? { ...node.payload, kind: "bend-warp", scale: value }
				: null;
		case "vhs-color.bleed":
			return node.payload.kind === "vhs-color"
				? { ...node.payload, kind: "vhs-color", bleed: value }
				: null;
		case "vhs-color.subsample":
			return node.payload.kind === "vhs-color"
				? { ...node.payload, kind: "vhs-color", subsample: value }
				: null;
		case "vhs-color.colorUnder":
			return node.payload.kind === "vhs-color"
				? { ...node.payload, kind: "vhs-color", colorUnder: value }
				: null;
		case "vhs-color.mix":
			return node.payload.kind === "vhs-color"
				? { ...node.payload, kind: "vhs-color", mix: value }
				: null;
		case "vhs-tracking.jitter":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", jitter: value }
				: null;
		case "vhs-tracking.wobble":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", wobble: value }
				: null;
		case "vhs-tracking.tear":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", tear: value }
				: null;
		case "vhs-tracking.band":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", band: value }
				: null;
		case "vhs-tracking.bandPosition":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", bandPosition: value }
				: null;
		case "vhs-tracking.speed":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", speed: value }
				: null;
		case "vhs-tracking.seed":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", seed: value }
				: null;
		case "vhs-tracking.mix":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", mix: value }
				: null;
		case "vhs-tracking.evolution":
			return node.payload.kind === "vhs-tracking"
				? { ...node.payload, kind: "vhs-tracking", evolution: value }
				: null;
		case "vhs-noise.snow":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", snow: value }
				: null;
		case "vhs-noise.dropout":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", dropout: value }
				: null;
		case "vhs-noise.dropoutLength":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", dropoutLength: value }
				: null;
		case "vhs-noise.generation":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", generation: value }
				: null;
		case "vhs-noise.speed":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", speed: value }
				: null;
		case "vhs-noise.seed":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", seed: value }
				: null;
		case "vhs-noise.mix":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", mix: value }
				: null;
		case "vhs-noise.evolution":
			return node.payload.kind === "vhs-noise"
				? { ...node.payload, kind: "vhs-noise", evolution: value }
				: null;
		case "crt-display.maskScale":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", maskScale: value }
				: null;
		case "crt-display.maskStrength":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", maskStrength: value }
				: null;
		case "crt-display.curvature":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", curvature: value }
				: null;
		case "crt-display.cornerRadius":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", cornerRadius: value }
				: null;
		case "crt-display.vignette":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", vignette: value }
				: null;
		case "crt-display.mix":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", mix: value }
				: null;
		case "signal-glitch.channelShift":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", channelShift: value }
				: null;
		case "signal-glitch.rollAmount":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", rollAmount: value }
				: null;
		case "signal-glitch.tearDensity":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", tearDensity: value }
				: null;
		case "signal-glitch.tearStrength":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", tearStrength: value }
				: null;
		case "signal-glitch.speed":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", speed: value }
				: null;
		case "signal-glitch.seed":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", seed: value }
				: null;
		case "signal-glitch.mix":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", mix: value }
				: null;
		case "signal-glitch.evolution":
			return node.payload.kind === "signal-glitch"
				? { ...node.payload, kind: "signal-glitch", evolution: value }
				: null;
		case "interlace.strength":
			return node.payload.kind === "interlace"
				? { ...node.payload, kind: "interlace", strength: value }
				: null;
		case "interlace.fieldOffset":
			return node.payload.kind === "interlace"
				? { ...node.payload, kind: "interlace", fieldOffset: value }
				: null;
		case "interlace.flicker":
			return node.payload.kind === "interlace"
				? { ...node.payload, kind: "interlace", flicker: value }
				: null;
		case "interlace.speed":
			return node.payload.kind === "interlace"
				? { ...node.payload, kind: "interlace", speed: value }
				: null;
		case "interlace.mix":
			return node.payload.kind === "interlace"
				? { ...node.payload, kind: "interlace", mix: value }
				: null;
		case "interlace.evolution":
			return node.payload.kind === "interlace"
				? { ...node.payload, kind: "interlace", evolution: value }
				: null;
		case "mask.feather":
			return node.payload.kind === "mask"
				? { ...node.payload, kind: "mask", feather: value }
				: null;
		case "composite.mix":
			return node.payload.kind === "composite"
				? { ...node.payload, kind: "composite", mix: value }
				: null;
	}
};

const nodePayloadWithFieldPatch = (
	node: LookGraphNode,
	patch: LookGraphNodeFieldPatch,
): LookGraphNodePayloadDraft | null => {
	switch (patch.path) {
		case "grain.mode":
			if (node.payload.kind !== "grain") return null;
			{
				const nextMode: TextureMaterialMode =
					patch.value === "particle-dissolve" ? "particle" : "off";
				const switchingToParticle = nextMode === "particle";
				const defaultFieldPatch =
					switchingToParticle &&
					node.payload.texture.material.fieldMode === undefined
						? ({ fieldMode: "contour" } as const)
						: {};
				return {
					kind: "grain",
					texture: {
						...node.payload.texture,
						grain: {
							...node.payload.texture.grain,
							enabled:
								switchingToParticle || node.payload.texture.grain.enabled,
						},
						material: {
							...node.payload.texture.material,
							mode: nextMode,
							strength: switchingToParticle
								? Math.max(0.35, node.payload.texture.material.strength)
								: node.payload.texture.material.strength,
							particleContrast: switchingToParticle
								? Math.max(0.25, node.payload.texture.material.particleContrast)
								: node.payload.texture.material.particleContrast,
							...defaultFieldPatch,
						},
					},
				};
			}
		case "grain.angle": {
			if (node.payload.kind !== "grain") return null;
			if (patch.value === null) {
				return {
					kind: "grain",
					texture: {
						...node.payload.texture,
						material: {
							...node.payload.texture.material,
							fieldMode: "contour",
						},
					},
				};
			}
			if (patch.value === "mesh") {
				return {
					kind: "grain",
					texture: {
						...node.payload.texture,
						material: {
							...node.payload.texture.material,
							mode:
								node.payload.texture.material.mode === "off"
									? "particle"
									: node.payload.texture.material.mode,
							fieldMode: "mesh",
							fieldMesh:
								node.payload.texture.material.fieldMesh ??
								DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
						},
					},
				};
			}
			const nextLinearField = textureParticleLinearFieldWithAngle(
				textureParticleLinearFieldEffective(
					resolveTextureParticleLinearField(node.payload.texture),
				),
				angleDegrees(patch.value),
			);
			return {
				kind: "grain",
				texture: {
					...node.payload.texture,
					material: {
						...node.payload.texture.material,
						mode:
							node.payload.texture.material.mode === "off"
								? "particle"
								: node.payload.texture.material.mode,
						fieldMode: "linear",
						angle: textureParticleLinearFieldAngle(nextLinearField),
						strength: textureParticleLinearFieldExtent(nextLinearField),
						linearField: nextLinearField,
					},
				},
			};
		}
		case "mask.source":
			return node.payload.kind === "mask"
				? { ...node.payload, kind: "mask", source: patch.value }
				: null;
		case "blur.radiusY":
			return node.payload.kind === "blur"
				? { ...node.payload, kind: "blur", radiusY: patch.value }
				: null;
		case "mask.invert":
			return node.payload.kind === "mask"
				? { ...node.payload, kind: "mask", invert: patch.value }
				: null;
		case "composite.blendMode":
			return node.payload.kind === "composite"
				? { ...node.payload, kind: "composite", blendMode: patch.value }
				: null;
		case "deep-glow.blendMode":
			return node.payload.kind === "deep-glow"
				? { ...node.payload, kind: "deep-glow", blendMode: patch.value }
				: null;
		case "riso.blendMode":
			return node.payload.kind === "riso"
				? { ...node.payload, kind: "riso", blendMode: patch.value }
				: null;
		case "riso.fieldMode":
			return node.payload.kind === "riso"
				? {
						...node.payload,
						kind: "riso",
						field: { ...node.payload.field, mode: patch.value },
					}
				: null;
		case "riso.fieldInvert":
			return node.payload.kind === "riso"
				? {
						...node.payload,
						kind: "riso",
						field: { ...node.payload.field, invert: patch.value },
					}
				: null;
		case "color-map.shadow":
			return node.payload.kind === "color-map"
				? { ...node.payload, kind: "color-map", shadow: patch.value }
				: null;
		case "color-map.midtone":
			return node.payload.kind === "color-map"
				? { ...node.payload, kind: "color-map", midtone: patch.value }
				: null;
		case "color-map.highlight":
			return node.payload.kind === "color-map"
				? { ...node.payload, kind: "color-map", highlight: patch.value }
				: null;
		case "find-edges.invert":
			return node.payload.kind === "find-edges"
				? { ...node.payload, kind: "find-edges", invert: patch.value }
				: null;
		case "noise-field.type":
			return node.payload.kind === "noise-field"
				? { ...node.payload, kind: "noise-field", type: patch.value }
				: null;
		case "ordered-dither.mode":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", mode: patch.value }
				: null;
		case "ordered-dither.pattern":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", pattern: patch.value }
				: null;
		case "ordered-dither.ink":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", ink: patch.value }
				: null;
		case "ordered-dither.paper":
			return node.payload.kind === "ordered-dither"
				? { ...node.payload, kind: "ordered-dither", paper: patch.value }
				: null;
		case "ascii-glyph.invert":
			return node.payload.kind === "ascii-glyph"
				? { ...node.payload, kind: "ascii-glyph", invert: patch.value }
				: null;
		case "warp.mode":
			return node.payload.kind === "warp"
				? { ...node.payload, kind: "warp", mode: patch.value }
				: null;
		case "flow.pattern":
			return node.payload.kind === "flow"
				? { ...node.payload, kind: "flow", pattern: patch.value }
				: null;
		case "lens.clipToRim":
			return node.payload.kind === "lens"
				? { ...node.payload, kind: "lens", clipToRim: patch.value }
				: null;
		case "path-blur.centeredBlur":
			return node.payload.kind === "path-blur"
				? { ...node.payload, kind: "path-blur", centeredBlur: patch.value }
				: null;
		case "wave-warp.waveType":
			return node.payload.kind === "wave-warp"
				? { ...node.payload, kind: "wave-warp", waveType: patch.value }
				: null;
		case "colorama.inputPhase":
			return node.payload.kind === "colorama"
				? { ...node.payload, kind: "colorama", inputPhase: patch.value }
				: null;
		case "colorama.stops":
			return node.payload.kind === "colorama"
				? { ...node.payload, kind: "colorama", stops: patch.value }
				: null;
		case "crt-display.maskType":
			return node.payload.kind === "crt-display"
				? { ...node.payload, kind: "crt-display", maskType: patch.value }
				: null;
	}
};

/** Updates one numeric payload field on an authorable graph node. */
export function createUpdateLookGraphNodeNumberCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	nodeId: string,
	path: LookGraphNodeNumberPath,
	value: number,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	if (!Number.isFinite(value)) return { kind: "missing-graph", target };
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (!context.graph) return { kind: "missing-graph", target: context.target };
	const node = context.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) {
		return {
			kind: "missing-node",
			target: context.target,
			graph: context.graph,
		};
	}
	const payload = nodePayloadWithNumber(node, path, value);
	if (!payload) {
		return {
			kind: "unsupported-node",
			target: context.target,
			graph: context.graph,
		};
	}
	const nextGraph = normalizeLookGraph({
		schemaVersion: context.graph.schemaVersion,
		nodes: context.graph.nodes.map((candidate) =>
			candidate.id === nodeId ? { ...candidate, payload } : candidate,
		),
		edges: context.graph.edges,
		outputNodeId: context.graph.outputNodeId,
	});
	return resultFromNextGraph(context.target, context.graph, nextGraph, {
		label: "Edit look graph node",
		...options,
	});
}

/** Updates one non-numeric payload field on an authorable graph node. */
export function createUpdateLookGraphNodeFieldCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	nodeId: string,
	patch: LookGraphNodeFieldPatch,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (!context.graph) return { kind: "missing-graph", target: context.target };
	const node = context.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) {
		return {
			kind: "missing-node",
			target: context.target,
			graph: context.graph,
		};
	}
	const payload = nodePayloadWithFieldPatch(node, patch);
	if (!payload) {
		return {
			kind: "unsupported-node",
			target: context.target,
			graph: context.graph,
		};
	}
	const nextGraph = normalizeLookGraph({
		schemaVersion: context.graph.schemaVersion,
		nodes: context.graph.nodes.map((candidate) =>
			candidate.id === nodeId
				? {
						...candidate,
						label:
							patch.path === "grain.mode"
								? patch.value === "particle-dissolve"
									? "Particle Dissolve"
									: "Film Grain"
								: candidate.label,
						payload,
					}
				: candidate,
		),
		edges: context.graph.edges,
		outputNodeId: context.graph.outputNodeId,
	});
	return resultFromNextGraph(context.target, context.graph, nextGraph, {
		label: "Edit look graph node",
		...options,
	});
}

/** Connects two graph ports, replacing an occupied single input before validation. */
export function createConnectLookGraphPortsCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	from: LookGraphEndpoint,
	to: LookGraphEndpoint,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (
		!context.graph ||
		!targetUsesExplicitLookGraph(document, context.target)
	) {
		return { kind: "missing-graph", target: context.target };
	}
	const result = graphWithReplacedInputEdge(context.graph, from, to);
	if (result.message) {
		return {
			kind: "invalid",
			target: context.target,
			graph: context.graph,
			message: result.message,
		};
	}
	return resultFromNextGraph(context.target, context.graph, result.graph, {
		label: "Connect look graph ports",
		...options,
	});
}

/** Removes every edge currently feeding one graph input port. */
export function createDisconnectLookGraphInputCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	to: LookGraphEndpoint,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (
		!context.graph ||
		!targetUsesExplicitLookGraph(document, context.target)
	) {
		return { kind: "missing-graph", target: context.target };
	}
	if (!context.graph.edges.some((edge) => sameEndpoint(edge.to, to))) {
		return {
			kind: "unchanged",
			target: context.target,
			graph: context.graph,
		};
	}
	return resultFromNextGraph(
		context.target,
		context.graph,
		graphWithClearedInput(context.graph, to),
		{
			label: "Disconnect look graph input",
			...options,
		},
	);
}

/** Enables or disables one graph node without changing topology. */
export function createToggleLookGraphNodeCommand(
	document: SceneDocument,
	target: FrameLookGraphTarget,
	nodeId: string,
	enabled: boolean,
	options: UpdateLookGraphOptions = {},
): FrameLookGraphCommandResult {
	const context = concreteGraphContext(document, target);
	if (!context) return { kind: "missing-target", target };
	if (!context.graph) return { kind: "missing-graph", target: context.target };
	const node = context.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) {
		return {
			kind: "missing-node",
			target: context.target,
			graph: context.graph,
		};
	}
	if (node.enabled === enabled) {
		return { kind: "unchanged", target: context.target, graph: context.graph };
	}
	const nextGraph = normalizeLookGraph({
		schemaVersion: context.graph.schemaVersion,
		nodes: context.graph.nodes.map((candidate) =>
			candidate.id === nodeId ? { ...candidate, enabled } : candidate,
		),
		edges: context.graph.edges,
		outputNodeId: context.graph.outputNodeId,
	});
	return resultFromNextGraph(context.target, context.graph, nextGraph, {
		label: "Toggle look graph node",
		...options,
	});
}
