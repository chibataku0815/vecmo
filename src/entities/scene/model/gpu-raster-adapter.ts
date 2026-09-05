import { hexToRgb } from "@/shared/color";
import type {
	GlowParams,
	ParticleDissolveAlphaMatte,
	ParticleDissolveFieldMode,
	ParticleDissolveParams,
	PathBlurParams,
	RasterEffectParams,
	RasterEffectPass,
	RasterLayer,
} from "@/shared/gpu-lens/surface";
import {
	buildPathBlurField,
	encodePathBlurFieldRgba,
	pathBlurGuidesKey,
} from "@/shared/path-blur/velocity-field";
import {
	DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	effectiveTextureBlendMode,
	legacyTextureNoiseScaleValue,
	resolveTextureParticleLinearField,
	type TextureMaterialAlphaMatteSource,
	type TextureRecipe,
	textureParticleFieldMode,
} from "@/shared/vec-core";
import type { LookGraphNode, RisoBlendMode } from "./look-graph";
import {
	type RasterPlanLayer,
	rasterPlan,
	rasterSegment,
} from "./look-graph-raster";
import {
	isObjectPathBlurScopedLook,
	objectPathBlurGraphNode,
} from "./path-blur-look";
import { resolveFrameLookGraph } from "./recipe-resolve";
import {
	scopedLookGraphNodeBounds,
	scopedLookGraphOverlays,
} from "./scoped-look-graph-overlay";
import { allNodes, findNode, selectArtboardIdForNode } from "./selectors";
import type { Bounds, SceneDocument } from "./types";

export type GpuRasterBuildOptions = {
	/** Sampled timeline time, in seconds, used for deterministic GPU particle Motion. */
	readonly timeSeconds?: number;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const clampRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Baked Path Blur velocity-field resolution and sampling — GPU pass inputs only. */
const PATH_BLUR_FIELD_WIDTH = 192;
const PATH_BLUR_FIELD_HEIGHT = 192;
const PATH_BLUR_FALLOFF = 0.25;
const PATH_BLUR_TAPS = 24;
/** `speed` is authored as a percent; divide to fold it into the `length` reach. */
const PATH_BLUR_SPEED_PERCENT = 100;
/** Cap the per-frame streak reach (UV) so an extreme speed cannot smear the frame. */
const PATH_BLUR_MAX_REACH = 0.5;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Riso ink-over-fill composite mode → the `uBlendMode` int the shader
 * switches on. Must agree exactly with the `blendOver` int cases in
 * `FRAGMENT_SHADER_RISO` (shared/gpu-lens/surface.ts) — this is the only
 * place that mapping is duplicated, since GLSL has no shared-constant import.
 */
const RISO_BLEND_MODE_TO_INT: Record<RisoBlendMode, number> = {
	normal: 0,
	multiply: 1,
	screen: 2,
	overlay: 3,
	darken: 4,
	lighten: 5,
	"color-dodge": 6,
	"color-burn": 7,
	"hard-light": 8,
	"soft-light": 9,
	difference: 10,
	exclusion: 11,
};

/**
 * Single-entry cache of the last baked direction field, keyed on the
 * coordinate-sensitive guide key. Skips the O(W·H·polyline) field BUILD when the
 * guides are unchanged — a static guide is re-rendered every export frame — and
 * keeps the bytes' identity stable for the surface's per-frame re-upload guard.
 */
let pathBlurFieldMemo: { key: string; field: Uint8ClampedArray } | null = null;

// Only the legacy fill-eroding dissolve renders on the GPU raster surface. A
// particle/mixed material with an authored blend mode ("hard-light", …) is the
// noise-OVER-fill reframe: it stays on the SVG path (particleOverlayPrimitives)
// even under GPU-raster Looks, so it must NOT be lowered to a GPU dissolve pass.
const textureIsParticleDissolve = (texture: TextureRecipe): boolean =>
	effectiveTextureBlendMode(texture.material) === "dissolve";

const GPU_PARTICLE_MESH_STRIDE = 8;
const GPU_PARTICLE_MESH_CAPACITY =
	GPU_PARTICLE_MESH_STRIDE * GPU_PARTICLE_MESH_STRIDE;

type GpuParticleMesh = {
	readonly rows: number;
	readonly cols: number;
	readonly values: readonly number[];
};

const GPU_ALPHA_MATTE_STOP_CAPACITY = 8;

const NO_ALPHA_MATTE: ParticleDissolveAlphaMatte = {
	kind: "none",
	stops: [],
};

const clampMeshDimension = (value: number): number =>
	Math.min(GPU_PARTICLE_MESH_STRIDE, Math.max(1, Math.round(value)));

const meshSampleIndex = (
	targetIndex: number,
	targetCount: number,
	sourceCount: number,
): number =>
	targetCount <= 1
		? 0
		: Math.round(
				(targetIndex / (targetCount - 1)) * Math.max(0, sourceCount - 1),
			);

const gpuParticleMesh = (texture: TextureRecipe): GpuParticleMesh => {
	const fieldMesh =
		texture.material.fieldMesh ?? DEFAULT_TEXTURE_PARTICLE_FIELD_MESH;
	const rows = clampMeshDimension(fieldMesh.rows);
	const cols = clampMeshDimension(fieldMesh.cols);
	const values = Array.from({ length: GPU_PARTICLE_MESH_CAPACITY }, () => 0);
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			const sourceRow = meshSampleIndex(row, rows, fieldMesh.rows);
			const sourceCol = meshSampleIndex(col, cols, fieldMesh.cols);
			const point = fieldMesh.points[sourceRow * fieldMesh.cols + sourceCol];
			values[row * GPU_PARTICLE_MESH_STRIDE + col] = clamp01(
				point?.density ?? 0,
			);
		}
	}
	return { rows, cols, values };
};

const gpuAlphaMatteStops = (
	stops: TextureMaterialAlphaMatteSource["stops"],
): ParticleDissolveAlphaMatte["stops"] =>
	stops
		.slice(0, GPU_ALPHA_MATTE_STOP_CAPACITY)
		.map((stop) => ({
			offset: clamp01(stop.offset),
			alpha: clamp01(stop.alpha),
		}))
		.sort((a, b) => a.offset - b.offset);

const gpuAlphaMatte = (
	matte: TextureMaterialAlphaMatteSource | undefined,
): ParticleDissolveAlphaMatte => {
	if (!matte) return NO_ALPHA_MATTE;
	if (matte.kind === "linearGradient") {
		return {
			kind: "linear-gradient",
			x1: matte.x1,
			y1: matte.y1,
			x2: matte.x2,
			y2: matte.y2,
			stops: gpuAlphaMatteStops(matte.stops),
		};
	}
	if (matte.kind === "radialGradient") {
		return {
			kind: "radial-gradient",
			cx: matte.cx,
			cy: matte.cy,
			rx: matte.rx,
			ry: matte.ry,
			rotation: matte.rotation,
			stops: gpuAlphaMatteStops(matte.stops),
		};
	}
	if (matte.kind === "contourGradient") {
		return {
			kind: "contour-gradient",
			width: clamp01(matte.width),
			invert: matte.invert,
			stops: gpuAlphaMatteStops(matte.stops),
		};
	}
	return NO_ALPHA_MATTE;
};

/** `#rrggbb` → RGB triple (0..1), falling back when the hex fails to parse. */
const rgbTripleFromHex = (
	hex: string,
	fallback: readonly [number, number, number],
): readonly [number, number, number] => {
	const rgb = hexToRgb(hex);
	return rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : fallback;
};

/**
 * Artboard background colour as an RGB triple (0..1), used by opaque GPU effects
 * whose cutout path needs a deterministic fill colour.
 */
export const artboardClipColor = (
	scene: SceneDocument,
): readonly [number, number, number] => {
	const rgb = hexToRgb(scene.artboard.background);
	return rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : [0, 0, 0];
};

/**
 * Lowers vec-core particle dissolve texture into the browser-only GPU pass
 * contract. The persisted recipe remains the source of truth; the returned
 * params are sampled renderer inputs, not serializable authoring state.
 * `evolution` is always 0 — the particle dissolve is unconditionally static
 * regardless of `options.timeSeconds` or `grain.temporalStability` — so
 * `options` is unused here but kept for call-site compatibility with the
 * shared {@link GpuRasterBuildOptions} dispatch.
 */
export const particleDissolveParamsFromTexture = (
	texture: TextureRecipe,
	clipColor: readonly [number, number, number],
	_options: GpuRasterBuildOptions = {},
): ParticleDissolveParams | null => {
	if (!textureIsParticleDissolve(texture)) return null;
	const fieldMode = textureParticleFieldMode(
		texture,
	) as ParticleDissolveFieldMode;
	const fieldMesh = gpuParticleMesh(texture);
	const hasAuthoredAngle =
		typeof texture.material.angle === "number" &&
		Number.isFinite(texture.material.angle);
	const linearField = resolveTextureParticleLinearField(texture);
	const linearFrom = linearField.invert
		? { x: linearField.x2, y: linearField.y2 }
		: { x: linearField.x1, y: linearField.y1 };
	const linearTo = linearField.invert
		? { x: linearField.x1, y: linearField.y1 }
		: { x: linearField.x2, y: linearField.y2 };
	return {
		mode: "particle-dissolve",
		fieldMode,
		angle: hasAuthoredAngle ? texture.material.angle : 0,
		linearFieldAuthored: texture.material.linearField !== undefined,
		linearField: [linearFrom.x, linearFrom.y, linearTo.x, linearTo.y],
		linearFieldPlateau: linearField.plateau,
		contourFocused: fieldMode === "contour" && hasAuthoredAngle,
		clipColor,
		particleEnabled: texture.grain.enabled,
		alphaMatte: gpuAlphaMatte(texture.material.alphaMatte),
		strength: clamp01(texture.material.strength),
		contrast: clamp01(texture.material.particleContrast),
		densityBias: clamp01(texture.grain.densityCoupling),
		seed: texture.grain.seed,
		frequency: 1 / Math.max(legacyTextureNoiseScaleValue(texture), 0.1),
		// The particle dissolve is unconditionally static — no procedural "boil"
		// regardless of `grain.temporalStability`. Explicit animation stays
		// available by keyframing `grain.seed` through the timeline system.
		evolution: 0,
		meshRows: fieldMesh.rows,
		meshCols: fieldMesh.cols,
		meshValues: fieldMesh.values,
	};
};

/** Maps one GPU raster Look node's payload to shader params (`null` if not GPU-tier). */
export const rasterParamsFromNode = (
	node: LookGraphNode,
	clipColor: readonly [number, number, number],
	options: GpuRasterBuildOptions = {},
): RasterEffectParams | null => {
	const payload = node.payload;
	if (payload.kind === "lens") {
		const { size, convergence, centerX, centerY, clipToRim } = payload;
		return {
			mode: "lens",
			size,
			convergence,
			centerX,
			centerY,
			clipToRim,
			clipColor,
		};
	}
	if (payload.kind === "kaleidoscope") {
		const { segments, centerX, centerY, roll } = payload;
		return { mode: "kaleidoscope", segments, centerX, centerY, roll };
	}
	if (payload.kind === "flow") {
		const { pattern, amount, scale, octaves, evolution, centerX, centerY } =
			payload;
		return {
			mode: "flow",
			pattern,
			amount,
			scale,
			octaves,
			evolution,
			centerX,
			centerY,
		};
	}
	if (payload.kind === "halftone") {
		const { cellSize, dotSize, contrast, angle, mix } = payload;
		return {
			mode: "halftone",
			cellSize,
			dotSize,
			contrast,
			angleRadians: angle * DEGREES_TO_RADIANS,
			mix,
		};
	}
	if (payload.kind === "riso") {
		const {
			cellSize,
			dotSize,
			contrast,
			grain,
			mix,
			bloomProgress,
			blendMode,
			inks,
			amount,
			field,
		} = payload;
		return {
			mode: "riso",
			cellSize,
			dotSize,
			contrast,
			grain,
			mix,
			bloomProgress,
			fieldStrength: amount,
			fieldMode: field.mode === "linear" ? 1 : field.mode === "radial" ? 2 : 0,
			fieldA:
				field.mode === "radial"
					? ([field.cx, field.cy] as const)
					: ([field.x1, field.y1] as const),
			fieldB: [field.x2, field.y2] as const,
			fieldRadius: field.radius,
			fieldSoftness: field.softness,
			fieldInvert: field.invert ? 1 : 0,
			blendMode: RISO_BLEND_MODE_TO_INT[blendMode],
			inks: inks.map((ink) => ({
				colorRgb: rgbTripleFromHex(ink.color, [0, 0, 0]),
				angleRadians: ink.angle * DEGREES_TO_RADIANS,
				offsetPx: [ink.offsetX, ink.offsetY] as const,
			})),
		};
	}
	if (payload.kind === "colorama") {
		const { stops, phase, repetitions, inputPhase, mix } = payload;
		return { mode: "colorama", stops, phase, repetitions, inputPhase, mix };
	}
	if (payload.kind === "wave-warp") {
		const { waveType, height, width, direction, phase } = payload;
		return {
			mode: "wave-warp",
			waveType,
			height,
			width,
			angleRadians: direction * DEGREES_TO_RADIANS,
			phase,
		};
	}
	if (payload.kind === "bend-warp") {
		const { bend, distortionH, distortionV, scale } = payload;
		return { mode: "bend-warp", bend, distortionH, distortionV, scale };
	}
	if (payload.kind === "vhs-color") {
		const { bleed, subsample, colorUnder, mix } = payload;
		return { mode: "vhs-color", bleed, subsample, colorUnder, mix };
	}
	if (payload.kind === "vhs-tracking") {
		const { jitter, wobble, tear, band, bandPosition, evolution, seed, mix } =
			payload;
		return {
			mode: "vhs-tracking",
			jitter,
			wobble,
			tear,
			band,
			bandPosition,
			evolution,
			seed,
			mix,
		};
	}
	if (payload.kind === "vhs-noise") {
		const { snow, dropout, dropoutLength, generation, evolution, seed, mix } =
			payload;
		return {
			mode: "vhs-noise",
			snow,
			dropout,
			dropoutLength,
			generation,
			evolution,
			seed,
			mix,
		};
	}
	if (payload.kind === "crt-display") {
		const {
			maskType,
			maskScale,
			maskStrength,
			curvature,
			cornerRadius,
			vignette,
			mix,
		} = payload;
		return {
			mode: "crt-display",
			maskType,
			maskScale,
			maskStrength,
			curvature,
			cornerRadius,
			vignette,
			mix,
		};
	}
	if (payload.kind === "signal-glitch") {
		const {
			channelShift,
			rollAmount,
			tearDensity,
			tearStrength,
			evolution,
			seed,
			mix,
		} = payload;
		return {
			mode: "signal-glitch",
			channelShift,
			rollAmount,
			tearDensity,
			tearStrength,
			evolution,
			seed,
			mix,
		};
	}
	if (payload.kind === "interlace") {
		const { strength, fieldOffset, flicker, evolution, mix } = payload;
		return {
			mode: "interlace",
			strength,
			fieldOffset,
			flicker,
			evolution,
			mix,
		};
	}
	if (payload.kind === "pixel-grid") {
		const { cellSize, gap, roundness, brightness, contrast, mix } = payload;
		return {
			mode: "pixel-grid",
			cellSize,
			gap,
			roundness,
			brightness,
			contrast,
			mix,
		};
	}
	if (payload.kind === "ordered-dither") {
		const {
			cellSize,
			pattern,
			matrixSize,
			levels,
			mode,
			brightness,
			contrast,
			gamma,
			threshold,
			strength,
			ink,
			paper,
			mix,
		} = payload;
		return {
			mode: "ordered-dither",
			cellSize,
			pattern,
			matrixSize,
			levels,
			ditherMode: mode,
			brightness,
			contrast,
			gamma,
			threshold,
			strength,
			ink: rgbTripleFromHex(ink, [0, 0, 0]),
			paper: rgbTripleFromHex(paper, [1, 1, 1]),
			mix,
		};
	}
	if (payload.kind === "ascii-glyph") {
		const {
			cellSize,
			glyphScale,
			contrast,
			brightness,
			densityBias,
			invert,
			mix,
		} = payload;
		return {
			mode: "ascii-glyph",
			cellSize,
			glyphScale,
			contrast,
			brightness,
			densityBias,
			invert,
			mix,
		};
	}
	if (payload.kind === "block-mosaic") {
		const {
			cellSize,
			gap,
			bevel,
			relief,
			lightAngle,
			lightElevation,
			contrast,
			variation,
			mix,
		} = payload;
		return {
			mode: "block-mosaic",
			cellSize,
			gap,
			bevel,
			relief,
			lightAngleRadians: lightAngle * DEGREES_TO_RADIANS,
			lightElevation,
			contrast,
			variation,
			mix,
		};
	}
	if (payload.kind === "path-blur") {
		// Coordinate-sensitive key so a guide edit invalidates the bake; reuse the
		// cached bytes (skipping the expensive field rebuild) when the guides are
		// unchanged across export frames.
		const guidesKey = pathBlurGuidesKey(payload.guides);
		let field: Uint8ClampedArray;
		if (pathBlurFieldMemo && pathBlurFieldMemo.key === guidesKey) {
			field = pathBlurFieldMemo.field;
		} else {
			field = encodePathBlurFieldRgba(
				buildPathBlurField(payload.guides, {
					width: PATH_BLUR_FIELD_WIDTH,
					height: PATH_BLUR_FIELD_HEIGHT,
					falloff: PATH_BLUR_FALLOFF,
				}),
				guidesKey,
			);
			pathBlurFieldMemo = { key: guidesKey, field };
		}
		const reach = clampRange(
			payload.length * (payload.speed / PATH_BLUR_SPEED_PERCENT),
			0,
			PATH_BLUR_MAX_REACH,
		);
		return {
			mode: "path-blur",
			field,
			fieldWidth: PATH_BLUR_FIELD_WIDTH,
			fieldHeight: PATH_BLUR_FIELD_HEIGHT,
			speed: reach,
			taps: PATH_BLUR_TAPS,
			taper: payload.taper,
			centered: payload.centeredBlur,
		} satisfies PathBlurParams;
	}
	if (payload.kind === "noise-source") {
		const { scale, octaves, evolution } = payload;
		return { mode: "noise-source", scale, octaves, evolution };
	}
	if (payload.kind === "deep-glow") {
		const { radius, intensity, threshold, chroma, blendMode } = payload;
		return { mode: "glow", radius, intensity, threshold, chroma, blendMode };
	}
	if (payload.kind === "grain") {
		return particleDissolveParamsFromTexture(
			payload.texture,
			clipColor,
			options,
		);
	}
	return null;
};

/** Builds the ordered GPU pass chain for an artboard's frame Look graph. */
export const buildRasterPasses = (
	scene: SceneDocument,
	options: GpuRasterBuildOptions = {},
): RasterEffectPass[] => {
	const graph = resolveFrameLookGraph(scene, scene.artboard.id);
	if (!graph) return [];
	const clipColor = artboardClipColor(scene);
	const passes: RasterEffectPass[] = [];
	for (const node of rasterSegment(graph).passes) {
		const params = rasterParamsFromNode(node, clipColor, options);
		if (params) passes.push({ nodeId: node.id, params });
	}
	return passes;
};

/** Converts the entities composite plan to the surface layer tree (`null` if unrenderable). */
const toRasterLayer = (
	layer: RasterPlanLayer,
	clipColor: readonly [number, number, number],
	options: GpuRasterBuildOptions,
): RasterLayer | null => {
	if (layer.kind === "source") return { kind: "source" };
	if (layer.kind === "effects") {
		const input = toRasterLayer(layer.input, clipColor, options);
		if (!input) return null;
		const passes: RasterEffectPass[] = [];
		for (const node of layer.nodes) {
			const params = rasterParamsFromNode(node, clipColor, options);
			if (params) passes.push({ nodeId: node.id, params });
		}
		return passes.length === 0 ? input : { kind: "effects", input, passes };
	}
	const base = toRasterLayer(layer.base, clipColor, options);
	const overlay = toRasterLayer(layer.overlay, clipColor, options);
	if (!base || !overlay || layer.node.payload.kind !== "composite") return null;
	const { blendMode, mix } = layer.node.payload;
	return { kind: "composite", base, overlay, blendMode, mix };
};

/** Builds the GPU composite tree for an artboard's frame Look graph (`null` = use passes). */
export const buildRasterTree = (
	scene: SceneDocument,
	options: GpuRasterBuildOptions = {},
): RasterLayer | null => {
	const graph = resolveFrameLookGraph(scene, scene.artboard.id);
	if (!graph) return null;
	const plan = rasterPlan(graph);
	return plan ? toRasterLayer(plan, artboardClipColor(scene), options) : null;
};

/** Whether an artboard's frame Look graph needs a GPU surface (a pass chain or a tree). */
export const sceneNeedsGpuSurface = (scene: SceneDocument): boolean =>
	buildRasterTree(scene) !== null ||
	buildRasterPasses(scene).length > 0 ||
	buildScopedDeepGlowPlan(scene) !== null;

/** One generic target-set Deep Glow invocation for the full-artboard compositor. */
export type ScopedDeepGlowPlan = {
	readonly overlayId: string;
	readonly targetNodeIds: readonly string[];
	readonly pass: RasterEffectPass & { readonly params: GlowParams };
};

/**
 * Resolves a selection-scoped source → Deep Glow → output graph without
 * materializing helper nodes. P1 deliberately accepts only a target set that
 * covers every visible top-level scene node: that makes the set one complete
 * paint-order run, so compositing its radiance over the finished artboard is
 * semantically sound. Partial/non-contiguous sets remain stored but render
 * through their existing honest non-GPU fallback until an ordered span
 * compositor lands.
 */
export function buildScopedDeepGlowPlan(
	scene: SceneDocument,
	options: GpuRasterBuildOptions = {},
): ScopedDeepGlowPlan | null {
	const visibleTopLevelIds = scene.layers
		.filter((layer) => layer.visible)
		.flatMap((layer) => layer.nodes)
		.filter(
			(node) =>
				node.visible &&
				selectArtboardIdForNode(scene, node.id) === scene.artboard.id,
		)
		.map((node) => node.id);
	if (visibleTopLevelIds.length === 0) return null;
	const visibleTopLevelSet = new Set(visibleTopLevelIds);
	const clipColor = artboardClipColor(scene);
	for (const overlay of scopedLookGraphOverlays(scene.artboard)) {
		if (overlay.source !== "selection-look-graph") continue;
		const graph = overlay.lookGraph;
		const sourceNodes = graph.nodes.filter((node) => node.kind === "source");
		const sourceNode = sourceNodes[0];
		const outputNode = graph.nodes.find(
			(node) => node.id === graph.outputNodeId && node.kind === "output",
		);
		const activeEffects = graph.nodes.filter(
			(node) =>
				node.enabled && node.kind !== "source" && node.kind !== "output",
		);
		const glowNode = activeEffects[0];
		const hasDirectEdge = (fromId: string, toId: string): boolean =>
			graph.edges.some(
				(edge) => edge.from.nodeId === fromId && edge.to.nodeId === toId,
			);
		if (
			graph.nodes.length !== 3 ||
			graph.edges.length !== 2 ||
			sourceNodes.length !== 1 ||
			!sourceNode?.enabled ||
			!outputNode?.enabled ||
			activeEffects.length !== 1 ||
			glowNode?.payload.kind !== "deep-glow"
		) {
			continue;
		}
		if (
			!hasDirectEdge(sourceNode.id, glowNode.id) ||
			!hasDirectEdge(glowNode.id, outputNode.id)
		) {
			continue;
		}
		const targetSet = new Set(overlay.targetNodeIds);
		if (
			targetSet.size !== visibleTopLevelSet.size ||
			visibleTopLevelIds.some((nodeId) => !targetSet.has(nodeId))
		) {
			continue;
		}
		const params = rasterParamsFromNode(glowNode, clipColor, options);
		if (params?.mode !== "glow") continue;
		return {
			overlayId: overlay.id,
			targetNodeIds: visibleTopLevelIds,
			pass: { nodeId: glowNode.id, params },
		};
	}
	return null;
}

/** One object-scoped Path Blur ready for the isolated-crop GPU compositor. */
export type ScopedPathBlurTarget = {
	readonly nodeId: string;
	/** Padded paint bounds in artboard-root pixel space (crop position/size). */
	readonly bounds: Bounds;
	readonly params: PathBlurParams;
};

/**
 * Node ids of object-scoped Path Blur overlays that are currently topmost in
 * their artboard's paint order — i.e. the ones `buildScopedPathBlurTargets`
 * will actually composite this render. Deliberately cheap (no velocity-field
 * bake, no `rasterParamsFromNode`): callers that only need to decide whether
 * to SUPPRESS a node from the base render (so the GPU compositor can draw the
 * blurred replacement in its place) must match this same topmost criterion —
 * suppressing a node that will NOT actually be composited (because something
 * now occludes it) would make the object vanish instead of degrading to a
 * plain unblurred render.
 */
export const scopedPathBlurTopmostTargetNodeIds = (
	scene: SceneDocument,
): ReadonlySet<string> => {
	const scopedLooks = scene.artboard.effectIntent?.scopedLooks;
	if (!scopedLooks || scopedLooks.length === 0) return new Set();
	const topmostVisibleId = [...allNodes(scene)]
		.reverse()
		.find((node) => node.visible)?.id;
	if (!topmostVisibleId) return new Set();
	const ids = new Set<string>();
	for (const look of scopedLooks) {
		if (!isObjectPathBlurScopedLook(look)) continue;
		const nodeId = look.targetNodeIds[0];
		if (nodeId === topmostVisibleId) ids.add(nodeId);
	}
	return ids;
};

/**
 * Resolves object-scoped Path Blur overlays into isolated GPU compositor
 * inputs. Unlike `buildRasterPasses`/`buildRasterTree` (whole-artboard
 * passes), each target here is rendered into its own small crop surface and
 * composited back onto the finished frame — see the GPU raster overlay and
 * the WebM export adapter, both of which suppress the target node from their
 * own base render so this composites in its place rather than doubling it.
 *
 * MVP scope, silently enforced here (no error, the target list just omits
 * them): only the frontmost node in paint order composites correctly —
 * drawing a crop "on top of the finished frame" cannot respect a later
 * sibling that should occlude it, so a non-topmost target is skipped (see
 * `scopedPathBlurTopmostTargetNodeIds`, which base-render suppression must
 * also key off so a non-topmost target degrades to sharp rather than vanishing).
 */
export const buildScopedPathBlurTargets = (
	scene: SceneDocument,
	options: GpuRasterBuildOptions = {},
): readonly ScopedPathBlurTarget[] => {
	const eligibleIds = scopedPathBlurTopmostTargetNodeIds(scene);
	if (eligibleIds.size === 0) return [];
	const scopedLooks = scene.artboard.effectIntent?.scopedLooks ?? [];
	const clipColor = artboardClipColor(scene);
	const targets: ScopedPathBlurTarget[] = [];
	for (const look of scopedLooks) {
		if (!isObjectPathBlurScopedLook(look)) continue;
		const nodeId = look.targetNodeIds[0];
		if (!nodeId || !eligibleIds.has(nodeId)) continue;
		const node = findNode(scene, nodeId);
		if (!node?.visible) continue;
		const pathBlurNode = objectPathBlurGraphNode(look);
		if (!pathBlurNode) continue;
		const params = rasterParamsFromNode(pathBlurNode, clipColor, options);
		if (params?.mode !== "path-blur") continue;
		targets.push({ nodeId, bounds: scopedLookGraphNodeBounds(node), params });
	}
	return targets;
};
