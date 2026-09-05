import { hexToRgb } from "@/shared/color";
import { scalarEffectFieldMeshScene } from "@/shared/effect-field";
import {
	encodePngDataUrl,
	type MeshEdge,
	type MeshPatch,
	type RasterPoint,
	rasterizeMesh,
} from "@/shared/mesh-raster";
import { type WarpMode, warpMapDataUrl } from "@/shared/raster-warp/warp-map";
import {
	type ColorRecipe,
	DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	effectiveTextureBlendMode,
	type GlowRecipe,
	legacyGlowBloomValue,
	legacyGlowRadiusValue,
	legacyRgbSplitValue,
	legacyTextureGrainValue,
	legacyTextureNoiseScaleValue,
	resolveTextureParticleLinearField,
	type TextureParticleFieldMesh,
	type TextureParticleLinearField,
	type TextureRecipe,
	textureParticleFieldMeshToScalarEffectFieldMesh,
	textureParticleFieldMode,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	effectFieldAlphaMultiplyPrimitives,
	effectFieldWetMixPrimitives,
} from "./effect-field-filter";
import type { EffectFieldRoutePlan } from "./effect-field-routing";
import type { SourceOpticsNodePlan } from "./source-optics";
import { sourceOpticsFilterPrimitives } from "./source-optics-filter";
import type {
	ResolvedBlurEffect,
	ResolvedEffect,
	ResolvedShadowEffect,
} from "./style-resolve";
import type { BlendMode, Bounds } from "./types";

/**
 * Pure, Workers-safe `ResolvedEffect[] → SVG <filter>` model. This module is the
 * SINGLE source of truth for node effect rendering: the editor canvas
 * (`CanvasShell`, JSX), the client SVG exporter (`features/export/model/svg.ts`,
 * string), and the server SVG renderer (`worker/export-jobs/render/scene-svg.ts`,
 * string) all build their filter from {@link buildEffectFilter} so the editor and
 * both export targets stay visually identical.
 *
 * It is intentionally POJO/string-only — no DOM, Node, or React types in any
 * position — so it compiles under `tsconfig.worker.json` and may be imported by
 * the Cloudflare Worker. Inputs are already normalized by `resolveNodeStyle`, so
 * this module never re-clamps; it only maps resolved effects to SVG filter
 * primitives, computes a non-clipping filter region, and serializes them.
 *
 * Scope: `drop-shadow`, `inner-shadow`, and `layer-blur` render as real filter
 * primitive chains (with spread, multiple stacked effects, and per-shadow blend
 * mode). `background-blur` has no faithful single-element SVG path (the
 * `BackgroundImage` filter input is dead in modern Chromium and CSS
 * `backdrop-filter` does not compose onto SVG shapes), so it is excluded from the
 * primitives and recorded in {@link EffectFilterSpec.deferred} for callers to
 * surface as a non-silent warning — never dropped without a trace.
 */

/** Gaussian sigma per blur radius: CSS box-shadow blur = 2σ, so σ = radius / 2. */
const BLUR_SIGMA_DIVISOR = 2;
/** Region margin reaches 3σ — the practical extent of a Gaussian blur tail. */
const REGION_SIGMA_REACH = 3;
/** Surfaced reason recorded for every deferred background-blur. */
export const BACKGROUND_BLUR_DEFERRED_REASON =
	"background-blur has no faithful SVG filter path (SVG BackgroundImage is unsupported in modern browsers); it is surfaced, not rendered";

/** Filter region in geometry-local user space (`filterUnits="userSpaceOnUse"`). */
export type FilterRegion = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/**
 * Per-primitive `color-interpolation-filters`. Omitting it keeps the renderer
 * default (`linearRGB`), correct for shadow/glow/blur. Grain sets `sRGB` so its
 * noise overlay reads as clean film grain instead of a washed, edge-fringed wash
 * (linearRGB lightens the body and tints the antialiased rim) — matching the
 * frame-tier grain, which already renders in `sRGB`.
 */
export type FilterColorInterpolation = "sRGB" | "linearRGB";

/**
 * One channel's transfer function for a `component-transfer` primitive. Mirrors
 * the W3C transfer-function set exactly — see
 * https://www.w3.org/TR/filter-effects-1/#feComponentTransferElement:
 * `identity` passes through; `table` interpolates between `tableValues`;
 * `discrete` steps through them; `linear` is `slope·C + intercept`; `gamma` is
 * `amplitude·C^exponent + offset`. Values are carried explicitly (the model does
 * not re-apply W3C attribute defaults — builders pass the concrete numbers).
 */
export type ComponentTransferFunction =
	| { readonly type: "identity" }
	| { readonly type: "table"; readonly tableValues: readonly number[] }
	| { readonly type: "discrete"; readonly tableValues: readonly number[] }
	| {
			readonly type: "linear";
			readonly slope: number;
			readonly intercept: number;
	  }
	| {
			readonly type: "gamma";
			readonly amplitude: number;
			readonly exponent: number;
			readonly offset: number;
	  };

/**
 * Per-channel transfer functions for a `component-transfer` primitive. An omitted
 * channel passes through unchanged (the SVG `identity` default), so the serializer
 * emits a `<feFunc*>` element only for the channels present here.
 */
export type ComponentTransferFunctions = {
	readonly r?: ComponentTransferFunction;
	readonly g?: ComponentTransferFunction;
	readonly b?: ComponentTransferFunction;
	readonly a?: ComponentTransferFunction;
};

/** `feDisplacementMap` channel selector: which channel of `in2` drives an axis. */
export type DisplacementChannel = "R" | "G" | "B" | "A";

/** `feConvolveMatrix` edge handling for kernel samples outside the input image. */
export type ConvolveEdgeMode = "duplicate" | "wrap" | "none";

/** String-safe coordinates for a generated linear-ramp image. */
type FilterLinearRampGeometry = {
	readonly x1: string;
	readonly y1: string;
	readonly x2: string;
	readonly y2: string;
	readonly plateau: string;
	readonly width: string;
	readonly height: string;
};

/**
 * Renderer-agnostic SVG filter primitive. Optional `in`/`result` mirror the SVG
 * defaults (omitted `in` chains from the previous primitive's output). Adapters
 * map these to `<fe*>` elements (string) or `<fe*>` JSX without re-deciding the
 * chain. The optional `colorInterpolation` (only on the kinds grain uses) is
 * emitted identically by both serializers so canvas and exports stay aligned.
 */
export type FilterPrimitive =
	| {
			readonly kind: "gaussian-blur";
			/**
			 * Blur sigma. A single number is isotropic; an `[sx, sy]` pair is an
			 * axis-aligned anisotropic Gaussian blur, emitted as SVG
			 * `stdDeviation="sx sy"`. It backs optional `radiusY` on Look-graph and
			 * layer blur. It encodes neither a trajectory nor arbitrary-angle motion
			 * blur.
			 */
			readonly stdDeviation: number | readonly [number, number];
			readonly in?: string;
			readonly result?: string;
	  }
	| {
			readonly kind: "offset";
			readonly dx: number;
			readonly dy: number;
			readonly in?: string;
			readonly result?: string;
	  }
	| {
			readonly kind: "flood";
			readonly floodColor: string;
			readonly floodOpacity: number;
			readonly result?: string;
	  }
	| {
			readonly kind: "composite";
			readonly operator: "over" | "in" | "out" | "atop" | "xor" | "arithmetic";
			readonly in: string;
			readonly in2: string;
			/**
			 * Arithmetic coefficients (`result = k1·i1·i2 + k2·i1 + k3·i2 + k4`),
			 * used only when `operator === "arithmetic"`; omitted (SVG default 0) for
			 * the Porter-Duff operators. A per-pixel lerp `i1·m + i2·(1-m)` uses two
			 * pre-masked inputs with `k2 = k3 = 1` (a plain add); the particle
			 * dissolve uses `k2 = 1, k3 = -1` for a `ramp − noise` alpha difference.
			 */
			readonly k1?: number;
			readonly k2?: number;
			readonly k3?: number;
			readonly k4?: number;
			readonly result?: string;
			readonly colorInterpolation?: FilterColorInterpolation;
	  }
	| {
			readonly kind: "morphology";
			readonly operator: "dilate" | "erode";
			readonly radius: number;
			readonly in: string;
			readonly result?: string;
	  }
	| {
			readonly kind: "merge";
			readonly inputs: readonly string[];
			readonly result?: string;
	  }
	| {
			readonly kind: "blend";
			readonly mode: BlendMode;
			readonly in: string;
			readonly in2: string;
			readonly result?: string;
			readonly colorInterpolation?: FilterColorInterpolation;
	  }
	| {
			readonly kind: "color-matrix";
			readonly matrixType: "saturate" | "matrix";
			/** `saturate`: single value; `matrix`: 20 row-major values. */
			readonly values: readonly number[];
			readonly in?: string;
			readonly result?: string;
			readonly colorInterpolation?: FilterColorInterpolation;
	  }
	| {
			readonly kind: "turbulence";
			/** feTurbulence `type`: smooth signed fractal clouds vs billowing veins. Defaults to `fractalNoise`. */
			readonly type?: "fractalNoise" | "turbulence";
			/**
			 * A single number is isotropic (same X/Y frequency, the SVG default). A
			 * `[x, y]` pair drives anisotropic noise — e.g. a near-zero X against a
			 * higher Y stretches the field into quasi-horizontal bands (scanlines)
			 * instead of an even stipple. Serializes to SVG's native
			 * `<number-optional-number>` `baseFrequency` syntax either way.
			 */
			readonly baseFrequency: number | readonly [number, number];
			readonly numOctaves: number;
			readonly seed: number;
			/**
			 * Optional SMIL animation of `baseFrequency` — the "living grain" boil.
			 * It runs on the browser's own animation clock, independent of React and
			 * the rAF playback driver (which does NOT rebuild per-node filter defs per
			 * tick), so the grain stays alive in live preview, and it exports natively
			 * inside an interactive SVG. `svg.setCurrentTime(t)` samples a deterministic
			 * frame — the seam for later timeline-sync, scrub, and video baking. Absent
			 * → byte-identical static `<feTurbulence/>` (non-animated filters unchanged).
			 */
			readonly animate?: {
				readonly attributeName: "baseFrequency";
				readonly values: string;
				readonly dur: string;
			};
			readonly colorInterpolation?: FilterColorInterpolation;
			readonly result?: string;
	  }
	| {
			readonly kind: "component-transfer";
			readonly functions: ComponentTransferFunctions;
			readonly in?: string;
			readonly result?: string;
			readonly colorInterpolation?: FilterColorInterpolation;
	  }
	| {
			readonly kind: "displacement-map";
			readonly in: string;
			readonly in2: string;
			/** Maximum displacement in user units; 0 leaves the input unmoved. */
			readonly scale: number;
			readonly xChannelSelector: DisplacementChannel;
			readonly yChannelSelector: DisplacementChannel;
			readonly result?: string;
			readonly colorInterpolation?: FilterColorInterpolation;
	  }
	| {
			readonly kind: "convolve-matrix";
			/** Square kernel order N (`orderX = orderY = N`); non-square is out of scope. */
			readonly order: number;
			/** Row-major kernel of exactly `order * order` values. */
			readonly kernelMatrix: readonly number[];
			readonly in?: string;
			/** Omit for the W3C default (sum of `kernelMatrix`, or 1 when that sum is 0). */
			readonly divisor?: number;
			/** Omit for the W3C default of 0. */
			readonly bias?: number;
			/** Omit for the W3C default of `"duplicate"`. */
			readonly edgeMode?: ConvolveEdgeMode;
			/** Omit for the W3C default of `false` (convolve all channels incl. alpha). */
			readonly preserveAlpha?: boolean;
			readonly result?: string;
			readonly colorInterpolation?: FilterColorInterpolation;
	  }
	| {
			/**
			 * `feImage`: paints an inlined data image into the filter graph. `x`/`y`/
			 * `width`/`height` are SVG lengths (the warp uses `"0%"`/`"100%"` to fill
			 * the filter region without needing pixel bounds at build time).
			 */
			readonly kind: "image";
			readonly href: string;
			readonly x?: string;
			readonly y?: string;
			readonly width?: string;
			readonly height?: string;
			/** Omit for the SVG default (`"xMidYMid meet"`); the warp uses `"none"`. */
			readonly preserveAspectRatio?: string;
			readonly result?: string;
	  };

/** A visible effect that exists in the model but cannot be rendered as SVG. */
export type DeferredEffect = {
	readonly kind: "background-blur" | "effect-field" | "source-optics";
	readonly reason: string;
	readonly assignmentId?: string;
};

/**
 * Built filter for one node. `primitives` is empty when only deferred effects
 * exist; adapters emit a `<filter>` and reference it ONLY when `primitives` is
 * non-empty, and surface a warning whenever `deferred` is non-empty.
 */
export type EffectFilterSpec = {
	readonly id: string;
	readonly region: FilterRegion;
	readonly primitives: readonly FilterPrimitive[];
	readonly deferred: readonly DeferredEffect[];
};

/**
 * Sanitizes an arbitrary node id into an SVG-id-safe segment. Moved here from the
 * client exporter so the canvas, client export, and worker export mint identical
 * filter ids from the same node — keep byte-identical to preserve existing
 * `paint-*` gradient ids that also depend on it.
 */
export const svgIdSegment = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/gu, "-")
		.replace(/^-+|-+$/gu, "") || "node";

/** Deterministic per-node filter id (`effect-<id-segment>`). No counter/clock. */
export const nodeFilterId = (nodeId: string): string =>
	`effect-${svgIdSegment(nodeId)}`;

type LayerInput = { readonly input: string; readonly mode: BlendMode };

/**
 * Reports whether a resolved object effect can change pixels in the shared SVG
 * filter model. This is intentionally narrower than `effect.visible`: a visible
 * but zero-radius blur or zero-opacity shadow is authored state, but renders as
 * identity and should not force adapters or GPU capability gates to treat the
 * node as filter-bearing.
 */
export const effectCanRenderVisibly = (effect: ResolvedEffect): boolean => {
	if (!effect.visible) return false;
	switch (effect.kind) {
		case "drop-shadow":
		case "inner-shadow":
			return effect.opacity > 0;
		case "layer-blur":
		case "background-blur":
			return effect.radius > 0 || (effect.radiusY ?? effect.radius) > 0;
	}
};

/**
 * Drop-shadow primitive chain (rendered BEHIND content). Spread dilates the
 * source alpha (positive) or erodes it (negative) before blurring; the colored
 * flood is clipped to the offset-blurred alpha via `feComposite operator="in"`.
 */
const dropShadowChain = (
	effect: ResolvedShadowEffect,
	prefix: string,
	result: string,
): readonly FilterPrimitive[] => {
	const chain: FilterPrimitive[] = [];
	let source = "SourceAlpha";
	if (effect.spread !== 0) {
		source = `${prefix}-sp`;
		chain.push({
			kind: "morphology",
			operator: effect.spread > 0 ? "dilate" : "erode",
			radius: Math.abs(effect.spread),
			in: "SourceAlpha",
			result: source,
		});
	}
	chain.push({
		kind: "gaussian-blur",
		stdDeviation: effect.radius / BLUR_SIGMA_DIVISOR,
		in: source,
		result: `${prefix}-bl`,
	});
	chain.push({
		kind: "offset",
		dx: effect.offset.x,
		dy: effect.offset.y,
		in: `${prefix}-bl`,
		result: `${prefix}-off`,
	});
	chain.push({
		kind: "flood",
		floodColor: effect.color,
		floodOpacity: effect.opacity,
		result: `${prefix}-fl`,
	});
	chain.push({
		kind: "composite",
		operator: "in",
		in: `${prefix}-fl`,
		in2: `${prefix}-off`,
		result,
	});
	return chain;
};

/**
 * Inner-shadow primitive chain (rendered OVER content, clipped inside the shape).
 * `feComposite operator="out"` of the source alpha against the offset-blurred
 * alpha yields the inner rim; the flood is clipped to it. Spread erodes (positive)
 * or dilates (negative) the source alpha — the INVERSE of a drop shadow, because
 * shrinking the offset alpha widens the inner rim. Direction is canvas-verified:
 * a positive-spread inner shadow renders a thicker inset rim, matching Figma.
 */
const innerShadowChain = (
	effect: ResolvedShadowEffect,
	prefix: string,
	result: string,
): readonly FilterPrimitive[] => {
	const chain: FilterPrimitive[] = [];
	let source = "SourceAlpha";
	if (effect.spread !== 0) {
		source = `${prefix}-sp`;
		chain.push({
			kind: "morphology",
			operator: effect.spread > 0 ? "erode" : "dilate",
			radius: Math.abs(effect.spread),
			in: "SourceAlpha",
			result: source,
		});
	}
	chain.push({
		kind: "gaussian-blur",
		stdDeviation: effect.radius / BLUR_SIGMA_DIVISOR,
		in: source,
		result: `${prefix}-bl`,
	});
	chain.push({
		kind: "offset",
		dx: effect.offset.x,
		dy: effect.offset.y,
		in: `${prefix}-bl`,
		result: `${prefix}-off`,
	});
	chain.push({
		kind: "composite",
		operator: "out",
		in: "SourceAlpha",
		in2: `${prefix}-off`,
		result: `${prefix}-inv`,
	});
	chain.push({
		kind: "flood",
		floodColor: effect.color,
		floodOpacity: effect.opacity,
		result: `${prefix}-fl`,
	});
	chain.push({
		kind: "composite",
		operator: "in",
		in: `${prefix}-fl`,
		in2: `${prefix}-inv`,
		result,
	});
	return chain;
};

/**
 * Computes a filter region that never clips. `userSpaceOnUse` with an absolute
 * per-axis margin equal to the worst outward reach over drop-shadows and
 * layer-blurs (`|offset| + 3σ + max(spread, 0)`), plus `strokeWidth` to cover the
 * baked non-scaling stroke. Inner shadows stay inside the shape and never expand
 * the region. `objectBoundingBox` is rejected: percentage units distort blur on
 * non-square shapes and clip the short axis on extreme aspect ratios.
 */
const computeRegion = (
	effects: readonly ResolvedEffect[],
	bounds: Bounds,
	strokeWidth: number,
	extraReach = 0,
): FilterRegion => {
	let marginX = Math.max(0, extraReach);
	let marginY = Math.max(0, extraReach);
	for (const effect of effects) {
		if (effect.kind === "inner-shadow" || effect.kind === "background-blur") {
			continue;
		}
		const blurReach = REGION_SIGMA_REACH * (effect.radius / BLUR_SIGMA_DIVISOR);
		if (effect.kind === "drop-shadow") {
			const spread = Math.max(effect.spread, 0);
			marginX = Math.max(
				marginX,
				Math.abs(effect.offset.x) + blurReach + spread,
			);
			marginY = Math.max(
				marginY,
				Math.abs(effect.offset.y) + blurReach + spread,
			);
		} else {
			marginX = Math.max(marginX, blurReach);
			marginY = Math.max(marginY, blurReach);
		}
	}
	marginX += strokeWidth;
	marginY += strokeWidth;
	return {
		x: bounds.x - marginX,
		y: bounds.y - marginY,
		width: bounds.width + marginX * 2,
		height: bounds.height + marginY * 2,
	};
};

/** Contrast pivots around mid-grey so a neutral contrast of 1 is identity. */
const GRADE_CONTRAST_PIVOT = 0.5;

/**
 * SVG color-grade primitives for the vector-expressible subset of a vec-core
 * recipe's {@link ColorRecipe}: saturation via `feColorMatrix type="saturate"`,
 * then a combined gain (exposure as 2^stops) x contrast (pivot 0.5) x coarse
 * channel response for canonical temperature/tint/CMY. Chains from `input` to
 * `result`; returns `[]` when the grade is neutral so no-op recipes emit nothing.
 *
 * This is the SVG-approximation tier (integration-doc P3 vector-native subset);
 * full-fidelity grade remains the P4 WebGPU bridge.
 */
export const colorGradePrimitives = (
	color: ColorRecipe,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	const needsSaturate = color.saturation !== 1;
	const gain = 2 ** color.exposure * (1 - color.density * 0.35);
	const contrast = color.contrast + color.printContrast * 0.5;
	const redGain = Math.max(
		0,
		1 + color.temperature * 0.08 - color.cmy.cyan * 0.25 + color.tint * 0.04,
	);
	const greenGain = Math.max(
		0,
		1 - color.cmy.magenta * 0.25 - Math.abs(color.tint) * 0.03,
	);
	const blueGain = Math.max(
		0,
		1 - color.temperature * 0.08 - color.cmy.yellow * 0.25 - color.tint * 0.04,
	);
	const needsMatrix =
		gain !== 1 ||
		contrast !== 1 ||
		redGain !== 1 ||
		greenGain !== 1 ||
		blueGain !== 1;
	if (!needsSaturate && !needsMatrix) return [];

	const primitives: FilterPrimitive[] = [];
	let cursor = input;
	if (needsSaturate) {
		const saturateResult = needsMatrix ? `${result}-sat` : result;
		primitives.push({
			kind: "color-matrix",
			matrixType: "saturate",
			values: [color.saturation],
			in: cursor,
			result: saturateResult,
		});
		cursor = saturateResult;
	}
	if (needsMatrix) {
		const bias = gain * GRADE_CONTRAST_PIVOT * (1 - contrast);
		// out_c = channelGain_c * gain * (contrast * in_c + 0.5 * (1 - contrast))
		primitives.push({
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				gain * redGain * contrast,
				0,
				0,
				0,
				bias * redGain,
				0,
				gain * greenGain * contrast,
				0,
				0,
				bias * greenGain,
				0,
				0,
				gain * blueGain * contrast,
				0,
				bias * blueGain,
				0,
				0,
				0,
				1,
				0,
			],
			in: cursor,
			result,
		});
	}
	return primitives;
};

/** Base feTurbulence frequency for grain at neutral noiseScale (1). */
const GRAIN_BASE_FREQUENCY = 0.65;
const GRAIN_MIN_NOISE_SCALE = 0.1;
const GRAIN_OCTAVES = 2;
/** Fixed turbulence seed keeps grain deterministic (no random/clock). */
const GRAIN_SEED = 0;
/** Equal-weight luminance for the grayscale grain texture. */
const GRAIN_LUMA = 1 / 3;
/**
 * Grain renders in `sRGB`, not the SVG default (`linearRGB`). The `overlay` of
 * 0.5-centered noise is luminance-preserving only in `sRGB`; in `linearRGB` it
 * lightens/desaturates the body and color-fringes the antialiased rim (reads as a
 * washed, semi-transparent object). This matches the frame-tier grain.
 */
const GRAIN_COLOR_INTERPOLATION: FilterColorInterpolation = "sRGB";

/**
 * SVG film-grain primitives for a recipe's {@link TextureRecipe}. Generates
 * fractal noise (feTurbulence), flattens it to a grayscale texture whose alpha is
 * the grain amount, clips it to the shape, and composites it over the content
 * with `blendMode` (an SVG/CSS `feBlend` mode — never `"dissolve"`, which routes
 * to {@link particleDissolvePrimitives} instead; see {@link texturePrimitives}).
 * Chains from `input` to `result`; returns `[]` when `grain <= 0`.
 *
 * SVG-approximation tier (integration-doc places grain in the P4 WebGPU finish);
 * this is a deliberate product-quality override delivering on-object grain now.
 * `noiseScale` sets grain coarseness; the seed is fixed for determinism.
 */
export const grainPrimitives = (
	texture: TextureRecipe,
	input: string,
	result: string,
	blendMode: BlendMode,
	bounds: Bounds,
): readonly FilterPrimitive[] => {
	const grain = legacyTextureGrainValue(texture);
	if (grain <= 0) return [];
	const baseFrequency =
		GRAIN_BASE_FREQUENCY /
		Math.max(legacyTextureNoiseScaleValue(texture), GRAIN_MIN_NOISE_SCALE);
	const luma = GRAIN_LUMA;
	// Intensity mask: the Linear/Mesh field ramp (opaque on the dense side, fading
	// to transparent) clipped to the fill silhouette, so the noise fades across the
	// object like a gradient. Contour / no authored field = the fill silhouette
	// itself (uniform noise over the whole fill). This is the same ramp the dissolve
	// path uses, so both blend modes fade identically.
	const fieldImageHref = particleFieldImageHref(texture, bounds);
	const maskPrimitives: readonly FilterPrimitive[] = fieldImageHref
		? [
				{
					kind: "image",
					href: fieldImageHref,
					x: String(bounds.x),
					y: String(bounds.y),
					width: String(bounds.width),
					height: String(bounds.height),
					preserveAspectRatio: "none",
					result: `${result}-rampimg`,
				},
				{
					kind: "color-matrix",
					matrixType: "matrix",
					values: PARTICLE_IMAGE_ALPHA_MATRIX,
					in: `${result}-rampimg`,
					result: `${result}-rampraw`,
				},
				{
					kind: "composite",
					operator: "in",
					in: `${result}-rampraw`,
					in2: "SourceAlpha",
					result: `${result}-mask`,
				},
			]
		: [];
	const maskRef = fieldImageHref ? `${result}-mask` : "SourceAlpha";
	return [
		{
			kind: "turbulence",
			baseFrequency,
			numOctaves: GRAIN_OCTAVES,
			seed: GRAIN_SEED,
			result: `${result}-noise`,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
		{
			// RGB = grayscale noise luminance; alpha = grain amount.
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				luma,
				luma,
				luma,
				0,
				0,
				luma,
				luma,
				luma,
				0,
				0,
				luma,
				luma,
				luma,
				0,
				0,
				0,
				0,
				0,
				0,
				grain,
			],
			in: `${result}-noise`,
			result: `${result}-tex`,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
		...maskPrimitives,
		{
			// Fade the noise by the field ramp AND clip it to the fill silhouette:
			// `-tex` survives only where `maskRef` is opaque, so the fill (`input`)
			// shows through everywhere the mask fades — the fill is preserved.
			kind: "composite",
			operator: "in",
			in: `${result}-tex`,
			in2: maskRef,
			result: `${result}-faded`,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
		{
			// Composite the faded noise OVER the object's own fill via the blend mode.
			kind: "blend",
			mode: blendMode,
			in: `${result}-faded`,
			in2: input,
			result,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
	];
};

/** Procedural-noise generator: baseFrequency = numerator / Scale (bigger Scale = broader features). */
const NOISE_FIELD_FREQUENCY_NUMERATOR = 0.3;
/** Equal-weight luminance flatten of the RGB noise to a single grayscale field. */
const NOISE_FIELD_LUMA = 1 / 3;
/** The grayscale field reads naturally in sRGB (same rationale as grain). */
const NOISE_FIELD_COLOR_INTERPOLATION: FilterColorInterpolation = "sRGB";

/**
 * SVG primitives for a procedural-noise GENERATOR (a source node, not a transform):
 * `feTurbulence` (a paint primitive with no `in`) flattened to an **opaque grayscale
 * field** by `feColorMatrix`. This is {@link grainPrimitives}' first two primitives with
 * the content-coupling tail (`feComposite operator="in"` + `feBlend overlay`) removed and
 * alpha forced to 1, so it stands free of any image input and fills the filter region.
 * `Scale` sets feature size (inverse baseFrequency), `detail` the fractal octaves, `seed`
 * the field; `type` picks smooth fractal clouds vs billowing turbulent veins. SVG-native:
 * renders identically in editor canvas, SVG export, and WebM capture.
 */
export const noiseFieldPrimitives = (
	noise: {
		readonly type: "fractalNoise" | "turbulence";
		readonly scale: number;
		readonly detail: number;
		readonly seed: number;
	},
	result: string,
): readonly FilterPrimitive[] => {
	const baseFrequency =
		NOISE_FIELD_FREQUENCY_NUMERATOR / Math.max(noise.scale, 1);
	const l = NOISE_FIELD_LUMA;
	return [
		{
			kind: "turbulence",
			type: noise.type,
			baseFrequency,
			numOctaves: noise.detail,
			seed: noise.seed,
			result: `${result}-noise`,
			colorInterpolation: NOISE_FIELD_COLOR_INTERPOLATION,
		},
		{
			// RGB = luminance of the noise (grayscale field); A = 1 (opaque).
			kind: "color-matrix",
			matrixType: "matrix",
			values: [l, l, l, 0, 0, l, l, l, 0, 0, l, l, l, 0, 0, 0, 0, 0, 0, 1],
			in: `${result}-noise`,
			result,
			colorInterpolation: NOISE_FIELD_COLOR_INTERPOLATION,
		},
	];
};

/** Higher turbulence frequency than grain: a particle dissolve wants near-per-pixel noise (fine, refined grain). */
const PARTICLE_BASE_FREQUENCY = 1.2;
/** A single octave keeps the noise close to white (flat-ish) so density tracks the ramp. */
const PARTICLE_OCTAVES = 1;
/**
 * Peak alpha of the particle noise LAYER on the dense side of the field, for the
 * noise-over-fill path (any non-`"dissolve"` blend mode). Fixed (not driven by
 * `material.strength`, which authors the field EXTENT, not intensity) so the tool
 * always paints visible noise on a fresh apply — the `grain` sub-recipe is
 * disabled by default and never enabled by the Noise Gradient tool, so a
 * grain-gated amount would render nothing. Tuned so `hard-light` reads clearly on
 * both light and dark fills without crushing the fill.
 */
const PARTICLE_OVERLAY_ALPHA = 0.85;
/** Dissolve band reach (geometry-local units) at `material.strength` 0 and 1. */
const PARTICLE_MIN_BAND = 4;
const PARTICLE_MAX_BAND = 44;
/** Threshold steepness at `material.particleContrast` 0 (soft, feathered) and 1 (hard, binary). */
const PARTICLE_MIN_SLOPE = 6;
const PARTICLE_MAX_SLOPE = 255;
/** `densityCoupling` 1 shifts the `ramp − noise` threshold this far toward denser coverage. */
const PARTICLE_DENSITY_BIAS_SCALE = 0.3;
/** Longest side for the inlined Field Mesh alpha map. */
const PARTICLE_FIELD_MESH_TARGET_PX = 192;

/** Isolates turbulence red into the alpha channel (rgb→0) so the threshold is alpha-only. */
const PARTICLE_NOISE_TO_ALPHA_MATRIX: readonly number[] = [
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
];
/** Keeps the directional ramp image's alpha (rgb→0) so it threshold-matches the noise. */
const PARTICLE_IMAGE_ALPHA_MATRIX: readonly number[] = [
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
];

/** Compact numeric token for the inline ramp SVG (keeps the data-URL small). */
const rampToken = (value: number): string => String(Number(value.toFixed(2)));

/**
 * Computes the normalized alpha ramp geometry for a linear particle field.
 * Coordinates are in the generated image's own 0..width/height space; `feImage`
 * positions that image into the owning filter's user-space bounds.
 */
const filterLinearRampGeometry = ({
	bounds,
	field,
}: {
	readonly bounds: Bounds;
	readonly field: TextureParticleLinearField;
}): FilterLinearRampGeometry => {
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);
	const from = field.invert
		? { x: field.x2, y: field.y2 }
		: { x: field.x1, y: field.y1 };
	const to = field.invert
		? { x: field.x1, y: field.y1 }
		: { x: field.x2, y: field.y2 };
	return {
		x1: rampToken(from.x * width),
		y1: rampToken(from.y * height),
		x2: rampToken(to.x * width),
		y2: rampToken(to.y * height),
		plateau: rampToken(field.plateau),
		width: rampToken(width),
		height: rampToken(height),
	};
};

/**
 * Pure-string `data:image/svg+xml` URL holding a `<linearGradient>` alpha ramp.
 * The ramp is inlined, not fetched as an external sub-resource, so SVG image
 * capture can keep the authored Linear angle without needing DOM-only helpers.
 */
const directionalRampHref = (
	field: TextureParticleLinearField,
	bounds: Bounds,
): string => {
	const { x1, y1, x2, y2, plateau, width, height } = filterLinearRampGeometry({
		bounds,
		field,
	});
	const svg =
		`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
		`<defs><linearGradient id='r' gradientUnits='userSpaceOnUse' x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}'>` +
		`<stop offset='${plateau}' stop-color='#fff' stop-opacity='1'/>` +
		`<stop offset='1' stop-color='#fff' stop-opacity='0'/>` +
		`</linearGradient></defs>` +
		`<rect width='${width}' height='${height}' fill='url(#r)'/></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const straightMeshEdge = (from: RasterPoint, to: RasterPoint): MeshEdge => [
	from,
	{
		x: from.x + (to.x - from.x) / 3,
		y: from.y + (to.y - from.y) / 3,
	},
	{
		x: from.x + ((to.x - from.x) * 2) / 3,
		y: from.y + ((to.y - from.y) * 2) / 3,
	},
	to,
];

const fieldMeshCorner = (
	scene: ReturnType<typeof scalarEffectFieldMeshScene>,
	row: number,
	col: number,
): MeshPatch["corners"][number] => {
	const point = scene.points.find((p) => p.row === row && p.col === col);
	return {
		point: point?.local ?? { x: 0, y: 0 },
		color: "#ffffff",
		opacity: point?.value ?? 0,
	};
};

const particleFieldMeshPatches = (
	fieldMesh: TextureParticleFieldMesh,
	bounds: Bounds,
): readonly MeshPatch[] => {
	if (fieldMesh.rows < 2 || fieldMesh.cols < 2) return [];
	const scene = scalarEffectFieldMeshScene(
		textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
		bounds,
		(point) => point,
	);
	const patches: MeshPatch[] = [];
	for (let row = 0; row < fieldMesh.rows - 1; row += 1) {
		for (let col = 0; col < fieldMesh.cols - 1; col += 1) {
			const tl = fieldMeshCorner(scene, row, col);
			const tr = fieldMeshCorner(scene, row, col + 1);
			const br = fieldMeshCorner(scene, row + 1, col + 1);
			const bl = fieldMeshCorner(scene, row + 1, col);
			patches.push({
				edges: [
					straightMeshEdge(tl.point, tr.point),
					straightMeshEdge(tr.point, br.point),
					straightMeshEdge(br.point, bl.point),
					straightMeshEdge(bl.point, tl.point),
				],
				corners: [tl, tr, br, bl],
			});
		}
	}
	return patches;
};

const particleFieldMeshHref = (
	fieldMesh: TextureParticleFieldMesh,
	bounds: Bounds,
): string | null => {
	if (bounds.width <= 0 || bounds.height <= 0) return null;
	const patches = particleFieldMeshPatches(fieldMesh, bounds);
	if (patches.length === 0) return null;
	const raster = rasterizeMesh({
		patches,
		bounds,
		deviceScale:
			PARTICLE_FIELD_MESH_TARGET_PX / Math.max(bounds.width, bounds.height, 1),
		dither: false,
	});
	return encodePngDataUrl(raster.pixels, raster.width, raster.height);
};

/** The dissolve band reach (geometry-local units) for a particle-mode texture. */
const particleBand = (texture: TextureRecipe): number =>
	PARTICLE_MIN_BAND +
	(PARTICLE_MAX_BAND - PARTICLE_MIN_BAND) *
		Math.min(1, Math.max(0, texture.material.strength));

/** True when the texture's material mode dissolves the shape into noise particles. */
export const isParticleDissolve = (texture: TextureRecipe): boolean =>
	texture.material.mode === "particle" || texture.material.mode === "mixed";

/**
 * True when the texture should render through the particle-dissolve pipeline —
 * the composited quantity {@link texturePrimitives} actually dispatches on.
 * Differs from {@link isParticleDissolve} (a raw `mode` check) once an explicit
 * `material.blendMode` is authored: a `"particle"`/`"mixed"` mode with a real
 * blend mode (e.g. `"overlay"`) resolves to the noise-over-fill path instead, and
 * an explicit `blendMode: "dissolve"` resolves here even off a non-particle mode.
 */
const usesParticleDissolvePipeline = (texture: TextureRecipe): boolean =>
	effectiveTextureBlendMode(texture.material) === "dissolve";

const particleFieldImageHref = (
	texture: TextureRecipe,
	bounds: Bounds,
): string | null => {
	const fieldMode = textureParticleFieldMode(texture);
	if (fieldMode === "linear") {
		return directionalRampHref(
			resolveTextureParticleLinearField(texture),
			bounds,
		);
	}
	if (fieldMode === "mesh") {
		return particleFieldMeshHref(
			texture.material.fieldMesh ?? DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
			bounds,
		);
	}
	return null;
};

/** Outward distance (geometry-local units) a particle dissolve sprays beyond geometry. */
export const particleOutwardReach = (texture: TextureRecipe): number =>
	usesParticleDissolvePipeline(texture) ? particleBand(texture) : 0;

/**
 * SVG "noise gradient" primitives — the dissolve that turns a shape (or its
 * fill's own alpha ramp) into stippled noise particles whose DENSITY follows a
 * gradient, like After Effects' Inner-Shadow + Dissolve or Illustrator's
 * gradient + Grain. Chains `input` (the colored content so far) to `result`,
 * REPLACING it with the stipple; returns `[]` when the texture is not in a
 * particle material mode.
 *
 * Pipeline (browser-verified): blur `SourceAlpha` into a soft edge ramp (so a
 * solid shape dissolves at its rim and a gradient-alpha fill keeps its own
 * richer ramp) → fractal noise isolated into the alpha channel → `ramp − noise`
 * via `feComposite` arithmetic in premultiplied-alpha space (both operands are
 * premultiplied black, so only alpha carries signal) → a steep `feFuncA` linear
 * ramp binarizes it into a stipple mask → the dilated content is clipped to the
 * mask so the fill colour sprays outward through the particles.
 *
 * Params map to vec-core `TextureRecipe`: `material.strength` = band reach,
 * `material.particleContrast` = threshold hardness, `grain.size` = grain
 * coarseness, `grain.densityCoupling` = density bias, `grain.seed` = the noise
 * field (keyframe it for an animated dissolve). Linear and Field Mesh authoring
 * feed an inlined alpha image into the same threshold chain; Circular stays
 * shape-alpha driven.
 */
export const particleDissolvePrimitives = (
	texture: TextureRecipe,
	bounds: Bounds,
	input: string,
	result: string,
	// Kept for call-site compatibility (raster export passes these for other
	// texture kinds); the particle dissolve itself is unconditionally static
	// and never reads them — no procedural "boil" over `baseFrequency`.
	_rasterSafe = false,
	_frameTimeSeconds?: number,
): readonly FilterPrimitive[] => {
	if (!usesParticleDissolvePipeline(texture)) return [];
	const band = particleBand(texture);
	const baseFrequency =
		PARTICLE_BASE_FREQUENCY /
		Math.max(legacyTextureNoiseScaleValue(texture), GRAIN_MIN_NOISE_SCALE);
	const slope =
		PARTICLE_MIN_SLOPE +
		(PARTICLE_MAX_SLOPE - PARTICLE_MIN_SLOPE) *
			Math.min(1, Math.max(0, texture.material.particleContrast));
	const bias =
		Math.min(1, Math.max(0, texture.grain.densityCoupling)) *
		PARTICLE_DENSITY_BIAS_SCALE;
	// Density ramp: contour follows the shape alpha (round on circles, silhouette-
	// aware on paths); linear and mesh use authored alpha images.
	const fieldImageHref = particleFieldImageHref(texture, bounds);
	const rampPrimitives: readonly FilterPrimitive[] = fieldImageHref
		? [
				{
					kind: "image",
					href: fieldImageHref,
					x: String(bounds.x),
					y: String(bounds.y),
					width: String(bounds.width),
					height: String(bounds.height),
					preserveAspectRatio: "none",
					result: `${result}-rampimg`,
				},
				{
					kind: "color-matrix",
					matrixType: "matrix",
					values: PARTICLE_IMAGE_ALPHA_MATRIX,
					in: `${result}-rampimg`,
					result: `${result}-rampraw`,
				},
				{
					kind: "composite",
					operator: "in",
					in: `${result}-rampraw`,
					in2: "SourceAlpha",
					result: `${result}-ramp`,
				},
			]
		: [
				{
					kind: "gaussian-blur",
					in: "SourceAlpha",
					stdDeviation: band,
					result: `${result}-ramp`,
				},
			];
	return [
		...rampPrimitives,
		{
			kind: "turbulence",
			baseFrequency,
			numOctaves: PARTICLE_OCTAVES,
			seed: texture.grain.seed,
			result: `${result}-noise`,
		},
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: PARTICLE_NOISE_TO_ALPHA_MATRIX,
			in: `${result}-noise`,
			result: `${result}-noiseA`,
		},
		{
			kind: "composite",
			operator: "arithmetic",
			k1: 0,
			k2: 1,
			k3: -1,
			k4: bias,
			in: `${result}-ramp`,
			in2: `${result}-noiseA`,
			result: `${result}-diff`,
		},
		{
			kind: "component-transfer",
			in: `${result}-diff`,
			functions: { a: { type: "linear", slope, intercept: 0 } },
			result: `${result}-mask`,
		},
		{
			kind: "morphology",
			operator: "dilate",
			radius: band,
			in: input,
			result: `${result}-wide`,
		},
		{
			kind: "composite",
			operator: "in",
			in: `${result}-wide`,
			in2: `${result}-mask`,
			result,
		},
	];
};

/**
 * Resolves {@link TextureRecipe.material}'s `overlayColor` to 0..1 RGB tint
 * channels for {@link particleOverlayPrimitives}'s noise color-matrix. Absent or
 * unparseable (anything `hexToRgb` rejects) falls back to `(1, 1, 1)` — white,
 * which multiplies the matrix's luma rows by 1 and reproduces the pre-tint
 * grayscale matrix exactly, keeping documents without an authored color
 * byte-identical.
 */
const overlayTintChannels01 = (
	overlayColor: string | undefined,
): readonly [number, number, number] => {
	const rgb = overlayColor ? hexToRgb(overlayColor) : null;
	if (!rgb) return [1, 1, 1];
	return [
		rgb.r / RGB_CHANNEL_MAX,
		rgb.g / RGB_CHANNEL_MAX,
		rgb.b / RGB_CHANNEL_MAX,
	];
};

/**
 * Noise-OVER-fill sibling of {@link particleDissolvePrimitives}: the SAME fractal
 * particle noise and field ramp, but composited OVER the object's own fill with a
 * `feBlend` blend mode instead of eroding the fill into stipple. This is the Noise
 * Gradient tool's default surface once a real blend mode is authored
 * (`"overlay"`, `"hard-light"`, …); `"dissolve"` still routes to the erosion path
 * so existing documents render byte-identical. Amount is a fixed
 * {@link PARTICLE_OVERLAY_ALPHA} (the `grain` sub-recipe stays disabled, so a
 * grain-gated amount would paint nothing), faded by the field ramp so the noise
 * reads as a gradient and the fill shows through where the ramp fades. The noise
 * is tinted by `texture.material.overlayColor` when authored (white/absent stays
 * grayscale, see {@link overlayTintChannels01}). Chains `input` → `result`.
 */
export const particleOverlayPrimitives = (
	texture: TextureRecipe,
	input: string,
	result: string,
	blendMode: BlendMode,
	bounds: Bounds,
): readonly FilterPrimitive[] => {
	const amount = PARTICLE_OVERLAY_ALPHA;
	const baseFrequency =
		PARTICLE_BASE_FREQUENCY /
		Math.max(legacyTextureNoiseScaleValue(texture), GRAIN_MIN_NOISE_SCALE);
	const luma = GRAIN_LUMA;
	const [tintR, tintG, tintB] = overlayTintChannels01(
		texture.material.overlayColor,
	);
	// Intensity mask: the authored Linear/Mesh field ramp (opaque on the dense
	// side, fading to transparent) clipped to the fill silhouette, so the noise
	// fades across the object like a gradient — the SAME ramp the dissolve path
	// uses, so switching blend modes keeps an identical fade. Contour / no field =
	// the fill silhouette itself (uniform noise over the whole fill).
	const fieldImageHref = particleFieldImageHref(texture, bounds);
	const maskPrimitives: readonly FilterPrimitive[] = fieldImageHref
		? [
				{
					kind: "image",
					href: fieldImageHref,
					x: String(bounds.x),
					y: String(bounds.y),
					width: String(bounds.width),
					height: String(bounds.height),
					preserveAspectRatio: "none",
					result: `${result}-rampimg`,
				},
				{
					kind: "color-matrix",
					matrixType: "matrix",
					values: PARTICLE_IMAGE_ALPHA_MATRIX,
					in: `${result}-rampimg`,
					result: `${result}-rampraw`,
				},
				{
					kind: "composite",
					operator: "in",
					in: `${result}-rampraw`,
					in2: "SourceAlpha",
					result: `${result}-mask`,
				},
			]
		: [];
	const maskRef = fieldImageHref ? `${result}-mask` : "SourceAlpha";
	return [
		{
			kind: "turbulence",
			baseFrequency,
			numOctaves: PARTICLE_OCTAVES,
			seed: texture.grain.seed,
			result: `${result}-noise`,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
		{
			// RGB = grayscale noise luminance tinted by overlayColor (white/absent =
			// unscaled grayscale, byte-identical to the pre-tint matrix); alpha =
			// overlay amount.
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				tintR * luma,
				tintR * luma,
				tintR * luma,
				0,
				0,
				tintG * luma,
				tintG * luma,
				tintG * luma,
				0,
				0,
				tintB * luma,
				tintB * luma,
				tintB * luma,
				0,
				0,
				0,
				0,
				0,
				0,
				amount,
			],
			in: `${result}-noise`,
			result: `${result}-tex`,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
		...maskPrimitives,
		{
			// Fade the noise by the field ramp AND clip it to the fill silhouette, so
			// the fill (`input`) shows through everywhere the mask fades.
			kind: "composite",
			operator: "in",
			in: `${result}-tex`,
			in2: maskRef,
			result: `${result}-faded`,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
		{
			// Composite the faded noise OVER the fill via the authored blend mode.
			kind: "blend",
			mode: blendMode,
			in: `${result}-faded`,
			in2: input,
			result,
			colorInterpolation: GRAIN_COLOR_INTERPOLATION,
		},
	];
};

/**
 * Reveal-noise grain frequency in cycles per user-space px — ABSOLUTE, not
 * object-relative. The wipe front's grain is a fixed on-canvas SIZE regardless of
 * object size (a larger object shows MORE grains, not BIGGER ones), matching how
 * film grain and the Noise Gradient overlay's grain read, and how the user judges
 * "particle size". Object-relative frequency was wrong here: dividing by the
 * object's bounds holds grain COUNT constant, so grain SIZE drifted with object
 * size — coarse on large objects (the "too big" the user rejected twice) and
 * near-per-pixel grit on small ones. Calibrated to the fineness the user approved
 * on the 200px comparison ladder (baseFrequency 1.0 ≈ 1px grain), with
 * {@link REVEAL_OCTAVES} fractal octaves for a rich grainy texture.
 */
const REVEAL_GRAIN_FREQUENCY = 1.0;
/** Fractal octaves for the reveal noise: multiple octaves give the front a rich, grainy texture that reads as noise rather than smooth undulation. */
const REVEAL_OCTAVES = 4;
/** Softness floor: keeps `1/(U-L)` finite as authored softness approaches 0 (a near-hard edge, never a divide-by-zero). */
const REVEAL_MIN_SOFTNESS = 0.001;

/**
 * SVG primitives for the calibrated noise-wipe reveal (`texture.material.reveal`,
 * vec-core's `TextureMaterialReveal`): an orthogonal FINAL alpha mask applied
 * after a node's own material/grain composite, independent of `material.mode`.
 * Chains `input` (the fully-composited object) to `result`, REPLACING it with the
 * revealed/dissolved output.
 *
 * Pipeline (browser-verified via a throwaway prototype before this port):
 * fractal noise flattened to luminance-in-alpha (`N`) + the authored directional
 * field ramp's alpha (`R`, the SAME ramp {@link particleOverlayPrimitives} and
 * {@link particleDissolvePrimitives} use, falling back to `SourceAlpha` when no
 * Linear/Mesh field is authored) → `G = R + noiseWeight·(N − 0.5)` via
 * `feComposite arithmetic` → a calibrated linear `feFuncA` remap of `G` into the
 * reveal alpha `α`, whose `slope`/`intercept` slide `[L, U]` outside `[0, 1]` as
 * `progress` sweeps 0→1 (so the remap fully clears even though `G` itself stays
 * clamped to `[0, 1]`) → `feComposite operator="in"` masks `input` by `α`.
 *
 * `mode: "out"` (dissolve-out) negates the same linear remap to compute `1 − α`
 * directly, rather than adding a separate invert stage. `U − L` is always
 * `softness` (never zero after the {@link REVEAL_MIN_SOFTNESS} floor), so
 * `slope` reduces to `1 / softness`.
 */
export const revealMattePrimitives = (
	texture: TextureRecipe,
	input: string,
	result: string,
	bounds: Bounds,
): readonly FilterPrimitive[] => {
	const reveal = texture.material.reveal;
	if (!reveal) return [];
	const baseFrequency = REVEAL_GRAIN_FREQUENCY;
	const luma = GRAIN_LUMA;
	const w = reveal.noiseWeight;
	const t = reveal.progress;
	const s = Math.max(reveal.softness, REVEAL_MIN_SOFTNESS);
	const L = 1 - t * (1 + s);
	const U = (1 - t) * (1 + s);
	const denom = U - L; // always `s` by construction; kept explicit for clarity.
	const slope = 1 / denom;
	const intercept = -L / denom;

	// Directional field ramp alpha: the same authored Linear/Mesh field the rest
	// of the Noise Gradient tool reads, so a reveal composes with an existing
	// field instead of introducing a second axis of authoring. Falls back to
	// SourceAlpha (the shape's own silhouette) when no field is authored.
	const fieldImageHref = particleFieldImageHref(texture, bounds);
	const rampPrimitives: readonly FilterPrimitive[] = fieldImageHref
		? [
				{
					kind: "image",
					href: fieldImageHref,
					x: String(bounds.x),
					y: String(bounds.y),
					width: String(bounds.width),
					height: String(bounds.height),
					preserveAspectRatio: "none",
					result: `${result}-rampimg`,
				},
				{
					kind: "color-matrix",
					matrixType: "matrix",
					values: PARTICLE_IMAGE_ALPHA_MATRIX,
					in: `${result}-rampimg`,
					result: `${result}-R`,
				},
			]
		: [];
	const rampRef = fieldImageHref ? `${result}-R` : "SourceAlpha";

	return [
		...rampPrimitives,
		{
			kind: "turbulence",
			baseFrequency,
			numOctaves: REVEAL_OCTAVES,
			seed: texture.grain.seed,
			result: `${result}-noise`,
		},
		{
			// RGB zeroed; alpha = luminance of the noise (N).
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				luma,
				luma,
				luma,
				0,
				0,
			],
			in: `${result}-noise`,
			result: `${result}-N`,
		},
		{
			// G = R + w·(N − 0.5), evaluated on the two alpha-only inputs above.
			kind: "composite",
			operator: "arithmetic",
			k1: 0,
			k2: 1,
			k3: w,
			k4: -0.5 * w,
			in: rampRef,
			in2: `${result}-N`,
			result: `${result}-G`,
		},
		{
			kind: "component-transfer",
			in: `${result}-G`,
			// "out" computes `1 − α` directly: negate slope, complement intercept.
			functions:
				reveal.mode === "out"
					? { a: { type: "linear", slope: -slope, intercept: 1 - intercept } }
					: { a: { type: "linear", slope, intercept } },
			result: `${result}-alpha`,
		},
		{
			kind: "composite",
			operator: "in",
			in: input,
			in2: `${result}-alpha`,
			result,
		},
	];
};

/** feBlend mode for the film-grain layer stacked over the particle overlay in "mixed" mode (matches the off-mode grain default). */
const MIXED_GRAIN_LAYER_BLEND: BlendMode = "overlay";

/** Result of lowering a vec-core texture into one SVG filter chain. */
export type TexturePrimitiveResult = {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
	readonly outwardReach: number;
};

/**
 * Lowers a canonical {@link TextureRecipe} through the single texture dispatch
 * used by node filters, Look Graphs, and effect-layer stacks, routing on
 * {@link effectiveTextureBlendMode}. `"dissolve"` (the pre-reframe default for
 * `"particle"`/`"mixed"` material modes, so existing documents render
 * byte-identical) becomes the bounded particle dissolve whose filter region must
 * be padded by {@link particleOutwardReach}. `"mixed"` with an active grain
 * sub-recipe layers film grain ({@link grainPrimitives}) on top of the particle
 * overlay ({@link particleOverlayPrimitives}) via {@link MIXED_GRAIN_LAYER_BLEND};
 * every other non-dissolve mode keeps the object's own fill and composites noise
 * over it with a single primitive chain.
 */
export const texturePrimitives = ({
	texture,
	bounds,
	input,
	result,
	rasterSafe = false,
	frameTimeSeconds,
}: {
	readonly texture: TextureRecipe;
	readonly bounds: Bounds;
	readonly input: string;
	readonly result: string;
	readonly rasterSafe?: boolean;
	readonly frameTimeSeconds?: number;
}): TexturePrimitiveResult => {
	const effectiveBlendMode = effectiveTextureBlendMode(texture.material);
	// Particle/mixed material with a real blend mode is the Noise Gradient tool's
	// noise-OVER-fill surface (material-driven particle noise); off/density/dye is
	// the film-grain surface (grain-sub-recipe driven). Only "dissolve" erodes.
	const isParticleMaterial =
		texture.material.mode === "particle" || texture.material.mode === "mixed";
	// "mixed" with an active grain sub-recipe = particle overlay noise PLUS a
	// film-grain layer on top. No document authored purely via the material mode
	// (grain-less "mixed") or the grain-only surfaces (off/density/dye) takes this
	// branch, so existing renders stay byte-identical.
	const isMixedWithGrain =
		texture.material.mode === "mixed" && legacyTextureGrainValue(texture) > 0;
	let primitives: readonly FilterPrimitive[];
	if (effectiveBlendMode === "dissolve") {
		primitives = particleDissolvePrimitives(
			texture,
			bounds,
			input,
			result,
			rasterSafe,
			frameTimeSeconds,
		);
	} else if (isMixedWithGrain) {
		const overlayResult = `${result}-mix`;
		const overlay = particleOverlayPrimitives(
			texture,
			input,
			overlayResult,
			effectiveBlendMode,
			bounds,
		);
		const grain = grainPrimitives(
			texture,
			overlayResult,
			result,
			MIXED_GRAIN_LAYER_BLEND,
			bounds,
		);
		primitives = [...overlay, ...grain];
	} else if (isParticleMaterial) {
		primitives = particleOverlayPrimitives(
			texture,
			input,
			result,
			effectiveBlendMode,
			bounds,
		);
	} else {
		primitives = grainPrimitives(
			texture,
			input,
			result,
			effectiveBlendMode,
			bounds,
		);
	}
	return {
		primitives,
		output: primitives.length > 0 ? result : input,
		outwardReach: particleOutwardReach(texture),
	};
};

/** Outward halo reach (geometry-local units) of a glow, or 0 when inactive. */
const glowReach = (glow: GlowRecipe): number =>
	legacyGlowBloomValue(glow) > 0 && legacyGlowRadiusValue(glow) > 0
		? REGION_SIGMA_REACH * (legacyGlowRadiusValue(glow) / BLUR_SIGMA_DIVISOR)
		: 0;

/**
 * SVG glow primitives for a recipe's {@link GlowRecipe}: a blurred, alpha-boosted
 * copy of the content merged BEHIND it so a self-colored halo bleeds outward
 * (`radius` = halo size, `bloom` = intensity). Chains from `input` to `result`;
 * returns `[]` when inactive. Unlike grade/grain this reaches OUTSIDE the shape,
 * so callers must pad the filter region and cull bounds by {@link glowReach}.
 *
 * SVG-approximation tier (integration-doc places glow in the P4 WebGPU finish);
 * a deliberate product-quality override delivering on-object glow now.
 */
export const glowPrimitives = (
	glow: GlowRecipe,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	const bloom = legacyGlowBloomValue(glow);
	const radius = legacyGlowRadiusValue(glow);
	if (bloom <= 0 || radius <= 0) return [];
	const alphaGain = 1 + bloom;
	return [
		{
			kind: "gaussian-blur",
			in: input,
			stdDeviation: radius / BLUR_SIGMA_DIVISOR,
			result: `${result}-blur`,
		},
		{
			// Boost the blurred halo's alpha so bloom controls glow intensity.
			kind: "color-matrix",
			matrixType: "matrix",
			values: [
				1,
				0,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				alphaGain,
				0,
			],
			in: `${result}-blur`,
			result: `${result}-halo`,
		},
		{ kind: "merge", inputs: [`${result}-halo`, input], result },
	];
};

/**
 * A faithful Gaussian blur primitive (radius → sigma via the shared
 * {@link BLUR_SIGMA_DIVISOR}), shared so the Look-graph `blur` operator blurs by the
 * same amount as a stack/layer blur. Returns `[]` for a non-positive radius.
 *
 * An optional `radiusY` makes the Gaussian anisotropic but still axis-aligned:
 * `radius` drives x-axis sigma and `radiusY` drives y-axis sigma. Omitted or
 * equal values remain isotropic with byte-identical scalar output. This does
 * not provide an angle, trajectory, or motion-blur model.
 */
export const blurPrimitives = (
	radius: number,
	input: string,
	result: string,
	radiusY?: number,
): readonly FilterPrimitive[] => {
	const rx = Math.max(radius, 0);
	const ry = Math.max(radiusY ?? radius, 0);
	if (rx <= 0 && ry <= 0) return [];
	const sx = rx / BLUR_SIGMA_DIVISOR;
	const sy = ry / BLUR_SIGMA_DIVISOR;
	return [
		{
			kind: "gaussian-blur",
			in: input,
			stdDeviation: sx === sy ? sx : ([sx, sy] as const),
			result,
		},
	];
};

/** Outward reach (geometry-local units) a Gaussian blur of `radius` bleeds. */
export const blurOutwardReach = (radius: number): number =>
	radius > 0 ? REGION_SIGMA_REACH * (radius / BLUR_SIGMA_DIVISOR) : 0;

/**
 * `feColorMatrix` isolating one RGB channel (0=R, 1=G, 2=B) while preserving
 * alpha — the building block of the channel-offset chromatic-fringe chain.
 */
const channelIsolationMatrix = (channel: 0 | 1 | 2): readonly number[] => {
	const values = new Array<number>(20).fill(0);
	values[channel * 5 + channel] = 1; // keep this channel on its own row
	values[18] = 1; // preserve alpha (A' = A)
	return values;
};

/**
 * Channel-offset chromatic aberration: isolate R/G/B, shift R and B in opposite
 * directions, then recombine with `screen` (which exactly sums non-overlapping
 * channels). A uniform approximation of true radial CA — the canvas does the radial
 * `feDisplacementMap` version — but it makes the signature film fringe renderable in
 * SVG, where the recipe's `optics.chromaticFringing` is otherwise dropped. `[]` for
 * a non-positive amount.
 */
export const chromaticFringePrimitives = (
	amount: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	if (amount <= 0) return [];
	const shift = amount / 2;
	return [
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: channelIsolationMatrix(0),
			in: input,
			result: `${result}-r`,
		},
		{
			kind: "offset",
			dx: shift,
			dy: 0,
			in: `${result}-r`,
			result: `${result}-rs`,
		},
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: channelIsolationMatrix(1),
			in: input,
			result: `${result}-g`,
		},
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: channelIsolationMatrix(2),
			in: input,
			result: `${result}-b`,
		},
		{
			kind: "offset",
			dx: -shift,
			dy: 0,
			in: `${result}-b`,
			result: `${result}-bs`,
		},
		{
			kind: "blend",
			mode: "screen",
			in: `${result}-rs`,
			in2: `${result}-g`,
			result: `${result}-rg`,
		},
		{
			kind: "blend",
			mode: "screen",
			in: `${result}-bs`,
			in2: `${result}-rg`,
			result,
		},
	];
};

/** Outward reach (geometry-local units) a chromatic fringe of `amount` bleeds. */
export const chromaticFringeOutwardReach = (amount: number): number =>
	amount > 0 ? amount / 2 : 0;

/** Fixed turbulence seed for displacement; deterministic (no random/clock). */
const DISPLACE_SEED = 0;

/**
 * Turbulent-displace primitives: a fractal-noise field (feTurbulence) drives a
 * per-pixel warp of `input` via feDisplacementMap (R→x, G→y). `scale` is the peak
 * displacement in user units — the map's ±0.5 channel range maps to ∓scale/2 — so
 * the warp reaches at most `scale/2` beyond the shape. `frequency` is the noise
 * base frequency (smaller = broader swirls); `octaves` adds fractal detail.
 * Chains from `input` to `result`; returns `[]` when `scale`/`frequency` ≤ 0.
 */
export const displacePrimitives = (
	scale: number,
	frequency: number,
	octaves: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	if (scale <= 0 || frequency <= 0) return [];
	return [
		{
			kind: "turbulence",
			baseFrequency: frequency,
			numOctaves: octaves,
			seed: DISPLACE_SEED,
			result: `${result}-map`,
		},
		{
			kind: "displacement-map",
			in: input,
			in2: `${result}-map`,
			scale,
			xChannelSelector: "R",
			yChannelSelector: "G",
			result,
		},
	];
};

/** Outward reach (geometry-local units) a turbulent displace of `scale` bleeds. */
export const displaceOutwardReach = (scale: number): number =>
	scale > 0 ? scale / 2 : 0;

/** Fewer than two posterize bands is a no-op (one level = flat). */
const MIN_POSTERIZE_LEVELS = 2;

/**
 * Posterize primitives: quantizes each RGB channel to `levels` evenly-spaced
 * bands via a `discrete` `feComponentTransfer` (alpha passes through). The N-entry
 * table is `[0, 1/(N-1), …, 1]`, so `levels` 2 → `[0, 1]` (hard threshold) and
 * 3 → `[0, 0.5, 1]`. Contains the only off-by-one worth pinning. Stays inside the
 * shape (no outward reach). `levels < 2` is rounded up to 2.
 */
export const posterizePrimitives = (
	levels: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	const bands = Math.max(MIN_POSTERIZE_LEVELS, Math.round(levels));
	const tableValues = Array.from(
		{ length: bands },
		(_, index) => index / (bands - 1),
	);
	const channel: ComponentTransferFunction = {
		type: "discrete",
		tableValues,
	};
	return [
		{
			kind: "component-transfer",
			in: input,
			functions: { r: channel, g: channel, b: channel },
			result,
		},
	];
};

/** Channel scale shared by the gradient-map ramp (`hexToRgb` returns 0..255). */
const RGB_CHANNEL_MAX = 255;

/**
 * Rec. 709 luminance as a `feColorMatrix` that writes the same grey into R/G/B and
 * passes alpha through. Computed on sRGB (the gradient map runs in `sRGB`), which
 * is the perceptually expected luminance for a tone map. Row-major, 20 values.
 */
const LUMINANCE_709_MATRIX: readonly number[] = [
	0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152,
	0.0722, 0, 0, 0, 0, 0, 1, 0,
];

const hexChannels01 = (hex: string): readonly [number, number, number] => {
	const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
	return [
		rgb.r / RGB_CHANNEL_MAX,
		rgb.g / RGB_CHANNEL_MAX,
		rgb.b / RGB_CHANNEL_MAX,
	];
};

/**
 * Gradient-map ("Color Look" / duotone) primitives: remaps image luminance onto a
 * 2- or 3-stop colour ramp, then blends the mapped result over the original by
 * `mix`. Pure standard SVG (renders natively, no approximation):
 *
 * 1. `feColorMatrix` collapses RGB to Rec. 709 luminance L (alpha preserved).
 * 2. `feComponentTransfer` `table` maps L→ramp per channel: R'=lerp(rampR, L),
 *    etc. Two stops (`midtone` omitted) is a duotone shadow→highlight; three stops
 *    is a tritone shadow→midtone→highlight (the `table` mode interpolates between
 *    consecutive stops). Alpha passes through (no alpha `feFunc`).
 * 3. `feComposite operator="arithmetic"` lerps mapped (i1) over original (i2) as
 *    `mix·i1 + (1-mix)·i2` (`k2=mix`, `k3=1-mix`). Both inputs share the source
 *    alpha so the blend preserves it. `mix` 1 → pure map, 0 → original; one op
 *    covers the whole range so `result` is always defined.
 *
 * All three run in `sRGB` so luminance and the ramp interpolate perceptually
 * (matching the grain-texture precedent), not in the linear-RGB filter default.
 */
export const colorMapPrimitives = (
	shadow: string,
	midtone: string | null,
	highlight: string,
	mix: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	const blend = Math.min(1, Math.max(0, mix));
	const luminance = `${result}-lum`;
	const mapped = `${result}-map`;
	const stops =
		midtone === null ? [shadow, highlight] : [shadow, midtone, highlight];
	const channels = stops.map(hexChannels01);
	const rampChannel = (index: 0 | 1 | 2): ComponentTransferFunction => ({
		type: "table",
		tableValues: channels.map((channel) => channel[index]),
	});
	return [
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: LUMINANCE_709_MATRIX,
			in: input,
			result: luminance,
			colorInterpolation: "sRGB",
		},
		{
			kind: "component-transfer",
			in: luminance,
			functions: {
				r: rampChannel(0),
				g: rampChannel(1),
				b: rampChannel(2),
			},
			result: mapped,
			colorInterpolation: "sRGB",
		},
		{
			kind: "composite",
			operator: "arithmetic",
			in: mapped,
			in2: input,
			k1: 0,
			k2: blend,
			k3: 1 - blend,
			k4: 0,
			result,
			colorInterpolation: "sRGB",
		},
	];
};

/**
 * 3×3 Laplacian edge-detection kernel (8-neighbour). Its values sum to 0, so flat
 * regions map to 0 (black) and only luminance discontinuities survive — the classic
 * "find edges" outline. The kernel sum being 0 means the divisor is OMITTED so the
 * serializer applies the W3C default of 1 (never pass `divisor: 0`).
 */
const FIND_EDGES_KERNEL: readonly number[] = [
	-1, -1, -1, -1, 8, -1, -1, -1, -1,
];

/** Inverts each colour channel (0↔1) via a two-entry `table`; alpha untouched. */
const INVERT_CHANNEL: ComponentTransferFunction = {
	type: "table",
	tableValues: [1, 0],
};

/**
 * Find-Edges primitives: grayscale edge detection (NOT AE's per-channel Find Edges)
 * that blends an outline over the original by `mix`. Pure standard SVG (native):
 *
 * 1. `feColorMatrix` collapses RGB to Rec. 709 luminance L (alpha preserved).
 * 2. `feConvolveMatrix` applies the Laplacian {@link FIND_EDGES_KERNEL} with
 *    `preserveAlpha` so only the colour channels are convolved — without it the
 *    zero-sum kernel would erase alpha everywhere except edges. Bright edges on
 *    black; clamped negative lobes make edges thin/one-sided (normal, not a bug).
 * 3. When `invert`, a two-entry `table` flips it to dark edges on white (sketch).
 * 4. `feComposite operator="arithmetic"` lerps the outline (i1) over the original
 *    (i2) as `mix·i1 + (1-mix)·i2`; both share the source alpha so it is preserved.
 *
 * Runs in `sRGB` so edges follow perceptual luminance, matching the grain/color-map
 * precedent. This is the first consumer of the `convolve-matrix` primitive.
 */
export const findEdgesPrimitives = (
	invert: boolean,
	mix: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	const blend = Math.min(1, Math.max(0, mix));
	const luminance = `${result}-lum`;
	const edges = `${result}-edge`;
	const inverted = `${result}-inv`;
	const outline = invert ? inverted : edges;
	const primitives: FilterPrimitive[] = [
		{
			kind: "color-matrix",
			matrixType: "matrix",
			values: LUMINANCE_709_MATRIX,
			in: input,
			result: luminance,
			colorInterpolation: "sRGB",
		},
		{
			kind: "convolve-matrix",
			order: 3,
			kernelMatrix: FIND_EDGES_KERNEL,
			preserveAlpha: true,
			in: luminance,
			result: edges,
			colorInterpolation: "sRGB",
		},
	];
	if (invert) {
		primitives.push({
			kind: "component-transfer",
			in: edges,
			functions: {
				r: INVERT_CHANNEL,
				g: INVERT_CHANNEL,
				b: INVERT_CHANNEL,
			},
			result: inverted,
			colorInterpolation: "sRGB",
		});
	}
	primitives.push({
		kind: "composite",
		operator: "arithmetic",
		in: outline,
		in2: input,
		k1: 0,
		k2: blend,
		k3: 1 - blend,
		k4: 0,
		result,
		colorInterpolation: "sRGB",
	});
	return primitives;
};

/** Fixed turbulence seed for scanlines; deterministic (no random/clock). */
const SCANLINE_SEED = 0;
/** Fixed turbulence seed for the optional noise-mix layer — distinct from the line seed. */
const SCANLINE_NOISE_SEED = 7;
/**
 * Near-zero X frequency: the line field drifts almost imperceptibly along X, so
 * bands read as an organic CRT scan (a slight per-row waver) rather than a
 * mathematically flat, ruled stripe.
 */
const SCANLINE_X_FREQUENCY = 0.004;
/** `density` (bands per 100 geometry-local units) → feTurbulence Y baseFrequency. */
const SCANLINE_DENSITY_DIVISOR = 100;
/** Edge-steepness range mapped from `softness` (0 = crisp CRT line, 1 = soft glow band). */
const SCANLINE_MIN_SLOPE = 2;
const SCANLINE_MAX_SLOPE = 40;
/** Fixed frequency for the optional static/flicker noise-mix layer (fine, near-per-pixel). */
const SCANLINE_NOISE_FREQUENCY = 0.9;
const SCANLINE_COLOR_INTERPOLATION: FilterColorInterpolation = "sRGB";
/**
 * Rec. 709 luminance that forces alpha to 1 (opaque), for collapsing a
 * `feTurbulence` GENERATOR field — unlike {@link LUMINANCE_709_MATRIX}, whose
 * alpha-passthrough row is correct for a real image (grade/color-map/find-edges)
 * but wrong here: raw turbulence output carries noise in its alpha channel too,
 * and passing that through would make the later `feBlend multiply` darken by a
 * random, independent field instead of the intended luminance mask.
 */
const SCANLINE_LUMA_MATRIX: readonly number[] = [
	0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152,
	0.0722, 0, 0, 0, 0, 0, 0, 1,
];

/**
 * Scanline / CRT primitives: an anisotropic fractal-noise field (feTurbulence
 * with a near-zero X frequency and a Y frequency set by `density`) collapsed to
 * luminance and thresholded into quasi-horizontal bands, then multiplied into the
 * source to darken alternating rows. `softness` controls the band edge (crisp
 * line vs soft glow) via the threshold's `feComponentTransfer` slope; `noiseMix`
 * optionally blends a second, finer noise field in as static/flicker. Fully
 * SVG-native — feTurbulence/feColorMatrix/feComponentTransfer/feBlend all render
 * identically in editor canvas, SVG export, PNG/WebM raster capture, and the
 * Worker SVG renderer (no feImage/SMIL, unlike a baked pattern tile). Chains from
 * `input` to `result`; returns `[]` when both `intensity` and `noiseMix` are
 * non-positive (a no-op).
 */
export const scanlinePrimitives = (
	density: number,
	intensity: number,
	softness: number,
	noiseMix: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	if (intensity <= 0 && noiseMix <= 0) return [];
	const slope =
		SCANLINE_MIN_SLOPE +
		(SCANLINE_MAX_SLOPE - SCANLINE_MIN_SLOPE) *
			(1 - Math.min(1, Math.max(0, softness)));
	const intercept = 0.5 * (1 - slope);
	const thresholdFn: ComponentTransferFunction = {
		type: "linear",
		slope,
		intercept,
	};
	const primitives: FilterPrimitive[] = [];
	let cursor = input;
	if (intensity > 0) {
		const freqY = Math.max(0.0001, density / SCANLINE_DENSITY_DIVISOR);
		const darkenFn: ComponentTransferFunction = {
			type: "linear",
			slope: intensity,
			intercept: 1 - intensity,
		};
		const linesResult = noiseMix > 0 ? `${result}-lines` : result;
		primitives.push(
			{
				kind: "turbulence",
				type: "fractalNoise",
				baseFrequency: [SCANLINE_X_FREQUENCY, freqY],
				numOctaves: 1,
				seed: SCANLINE_SEED,
				result: `${result}-raw`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "color-matrix",
				matrixType: "matrix",
				values: SCANLINE_LUMA_MATRIX,
				in: `${result}-raw`,
				result: `${result}-luma`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "component-transfer",
				in: `${result}-luma`,
				functions: { r: thresholdFn, g: thresholdFn, b: thresholdFn },
				result: `${result}-mask`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "component-transfer",
				in: `${result}-mask`,
				functions: { r: darkenFn, g: darkenFn, b: darkenFn },
				result: `${result}-darken`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "blend",
				mode: "multiply",
				in: cursor,
				in2: `${result}-darken`,
				result: linesResult,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
		);
		cursor = linesResult;
	}
	if (noiseMix > 0) {
		const mix = Math.min(1, Math.max(0, noiseMix));
		const mixFn: ComponentTransferFunction = {
			type: "linear",
			slope: mix,
			intercept: 1 - mix,
		};
		primitives.push(
			{
				kind: "turbulence",
				type: "fractalNoise",
				baseFrequency: SCANLINE_NOISE_FREQUENCY,
				numOctaves: 1,
				seed: SCANLINE_NOISE_SEED,
				result: `${result}-noise-raw`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "color-matrix",
				matrixType: "matrix",
				values: SCANLINE_LUMA_MATRIX,
				in: `${result}-noise-raw`,
				result: `${result}-noise-luma`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "component-transfer",
				in: `${result}-noise-luma`,
				functions: { r: mixFn, g: mixFn, b: mixFn },
				result: `${result}-noise-mask`,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
			{
				kind: "blend",
				mode: "multiply",
				in: cursor,
				in2: `${result}-noise-mask`,
				result,
				colorInterpolation: SCANLINE_COLOR_INTERPOLATION,
			},
		);
	}
	return primitives;
};

/** Peak displacement (geometry-local px) a radial warp of strength ±1 reaches. */
const MAX_WARP_DISPLACEMENT = 120;

/**
 * Warp primitives: a pure-generated displacement map ({@link warpMapDataUrl}, keyed
 * by `mode` — `radial` bulge/pinch or `twirl` swirl) painted via `feImage` drives a
 * `feDisplacementMap` over the source. `strength` is bipolar — a positive
 * `feDisplacementMap` scale pushes/swirls one way, negative the other; 0 is identity.
 * The
 * map fills the filter region via `feImage width="100%"` (no pixel bounds needed at
 * build time). This is standard SVG (renders natively in editor, exported SVG, and
 * the WebM SVG→canvas capture — all verified) — NOT a Canvas2D raster pass.
 */
export const warpPrimitives = (
	mode: WarpMode,
	strength: number,
	centerX: number,
	centerY: number,
	input: string,
	result: string,
): readonly FilterPrimitive[] => {
	const map = `${result}-map`;
	return [
		{
			kind: "image",
			href: warpMapDataUrl(mode, centerX, centerY),
			x: "0%",
			y: "0%",
			width: "100%",
			height: "100%",
			preserveAspectRatio: "none",
			result: map,
		},
		{
			kind: "displacement-map",
			in: input,
			in2: map,
			scale: strength * MAX_WARP_DISPLACEMENT,
			xChannelSelector: "R",
			yChannelSelector: "G",
			result,
		},
	];
};

type VisualRecipePrimitiveChain = {
	readonly primitives: readonly FilterPrimitive[];
	readonly output: string;
	readonly effectFieldDeferred: readonly DeferredEffect[];
};

const recipeResultName = (prefix: string, name: string): string =>
	prefix ? `${prefix}-${name}` : name;

/**
 * Builds the vector-expressible vec-core visual recipe chain shared by node and
 * frame filters. The order intentionally mirrors the editor's film-look path:
 * glow expands the source, texture is composited into that image, optional
 * frame-level chromatic fringe shifts the channels, then color grade finishes
 * the image.
 */
const visualRecipePrimitives = ({
	recipe,
	bounds,
	input,
	resultPrefix,
	rasterSafe,
	frameTimeSeconds,
	includeChromaticFringe,
	glowFieldRoute,
}: {
	readonly recipe: VisualRecipe;
	readonly bounds: Bounds;
	readonly input: string;
	readonly resultPrefix: string;
	readonly rasterSafe: boolean;
	readonly frameTimeSeconds: number | undefined;
	readonly includeChromaticFringe: boolean;
	readonly glowFieldRoute?: EffectFieldRoutePlan | null;
}): VisualRecipePrimitiveChain => {
	const primitives: FilterPrimitive[] = [];
	const effectFieldDeferred: DeferredEffect[] = [];
	let contentInput = input;
	const glowContent = glowPrimitives(
		recipe.glow,
		contentInput,
		recipeResultName(resultPrefix, "glowed"),
	);
	if (glowContent.length > 0) {
		primitives.push(...glowContent);
		const glowOutput = recipeResultName(resultPrefix, "glowed");
		if (glowFieldRoute) {
			const wetMix = effectFieldWetMixPrimitives(
				glowFieldRoute,
				bounds,
				contentInput,
				glowOutput,
				recipeResultName(resultPrefix, "glow-field-mix"),
			);
			if (wetMix) {
				primitives.push(...wetMix.primitives);
				contentInput = wetMix.output;
			} else {
				effectFieldDeferred.push({
					kind: "effect-field",
					assignmentId: glowFieldRoute.assignmentId,
					reason: "glow field source could not be lowered to an SVG matte",
				});
				contentInput = glowOutput;
			}
		} else {
			contentInput = glowOutput;
		}
	} else if (glowFieldRoute) {
		effectFieldDeferred.push({
			kind: "effect-field",
			assignmentId: glowFieldRoute.assignmentId,
			reason: "glow field route has no active glow owner",
		});
	}
	const textureContent = texturePrimitives({
		texture: recipe.texture,
		bounds,
		input: contentInput,
		result: recipeResultName(resultPrefix, "grained"),
		rasterSafe,
		...(frameTimeSeconds !== undefined ? { frameTimeSeconds } : {}),
	});
	if (textureContent.primitives.length > 0) {
		primitives.push(...textureContent.primitives);
		contentInput = textureContent.output;
	}
	const fringeContent = includeChromaticFringe
		? chromaticFringePrimitives(
				legacyRgbSplitValue(recipe.optics),
				contentInput,
				recipeResultName(resultPrefix, "fringed"),
			)
		: [];
	if (fringeContent.length > 0) {
		primitives.push(...fringeContent);
		contentInput = recipeResultName(resultPrefix, "fringed");
	}
	const gradeContent = colorGradePrimitives(
		recipe.color,
		contentInput,
		recipeResultName(resultPrefix, "graded"),
	);
	if (gradeContent.length > 0) {
		primitives.push(...gradeContent);
		contentInput = recipeResultName(resultPrefix, "graded");
	}
	return { primitives, output: contentInput, effectFieldDeferred };
};

/**
 * Worst-case outward reach (geometry-local units) of a recipe's vector-expressible
 * effects that paint BEYOND the shape. Callers pad the filter region and cull
 * bounds by this so neither clips.
 */
export const recipeOutwardReach = (recipe: VisualRecipe): number =>
	Math.max(glowReach(recipe.glow), particleOutwardReach(recipe.texture));

const frameVisualRecipeOutwardReach = (recipe: VisualRecipe): number =>
	Math.max(
		recipeOutwardReach(recipe),
		chromaticFringeOutwardReach(legacyRgbSplitValue(recipe.optics)),
	);

/**
 * The symmetric outward distance (geometry-local units) a node's paint can reach
 * beyond its geometry bounds: the worst of stroke width and visible
 * drop-shadow/layer-blur reach (`|offset| + 3σ + max(spread, 0)`). It mirrors the
 * per-axis margins of {@link computeRegion} collapsed to a single conservative
 * value, and filters to `visible` effects exactly as `buildEffectFilter` does so
 * the value matches what actually paints. Bounds-independent. The canvas uses it
 * to pad cull bounds so a node whose stroke/shadow/blur reaches the viewport is
 * never wrongly culled even when its geometry sits just off-screen.
 *
 * A recipe's glow and particle dissolve can also reach outward, so pass it to
 * keep recipe-painted nodes from being wrongly culled at the viewport edge.
 */
export function nodeVisualMargin(
	effects: readonly ResolvedEffect[],
	strokeWidth: number,
	recipe: VisualRecipe | null = null,
	strokeBlurRadius = 0,
): number {
	let margin = recipe ? recipeOutwardReach(recipe) : 0;
	for (const effect of effects) {
		if (!effect.visible) continue;
		if (effect.kind === "inner-shadow" || effect.kind === "background-blur") {
			continue;
		}
		const blurReach = REGION_SIGMA_REACH * (effect.radius / BLUR_SIGMA_DIVISOR);
		if (effect.kind === "drop-shadow") {
			const spread = Math.max(effect.spread, 0);
			margin = Math.max(
				margin,
				Math.abs(effect.offset.x) + blurReach + spread,
				Math.abs(effect.offset.y) + blurReach + spread,
			);
		} else {
			margin = Math.max(margin, blurReach);
		}
	}
	// Stroke-only blur softens beyond the stroke edge, so its Gaussian reach adds to
	// the stroke half-width already covered by `strokeWidth`. Additive (not max'd)
	// because it is a distinct outward pass from drop-shadow/layer-blur.
	const strokeBlurReach =
		strokeBlurRadius > 0
			? REGION_SIGMA_REACH * (strokeBlurRadius / BLUR_SIGMA_DIVISOR)
			: 0;
	return margin + Math.max(0, strokeWidth) + strokeBlurReach;
}

/**
 * Builds an artboard-scoped visual-recipe filter for export renderers. Unlike
 * node filters, the input is the already-composited artboard content, so the
 * resulting SVG filter should wrap the frame background and layers together.
 */
export function buildFrameVisualRecipeFilter({
	id,
	bounds,
	recipe,
	rasterSafe = false,
	frameTimeSeconds,
}: {
	readonly id: string;
	readonly bounds: Bounds;
	readonly recipe: VisualRecipe;
	readonly rasterSafe?: boolean;
	readonly frameTimeSeconds?: number;
}): EffectFilterSpec | null {
	const chain = visualRecipePrimitives({
		recipe,
		bounds,
		input: "SourceGraphic",
		resultPrefix: "frame-look",
		rasterSafe,
		frameTimeSeconds,
		includeChromaticFringe: true,
	});
	if (chain.primitives.length === 0) return null;
	return {
		id,
		region: computeRegion([], bounds, 0, frameVisualRecipeOutwardReach(recipe)),
		primitives: [
			...chain.primitives,
			{ kind: "merge", inputs: [chain.output] },
		],
		deferred: [],
	};
}

/**
 * Builds the filter spec for a node from its RESOLVED effects and optional
 * vec-core recipe. Returns `null` when nothing visible exists (so adapters emit
 * nothing). When only a background-blur is visible, returns a spec with empty
 * `primitives` and a non-empty `deferred` so callers still surface the limitation.
 *
 * Compositing order: layer-blur wraps the content (last visible layer-blur wins),
 * drop-shadows render under it and inner-shadows over it, both in resolved-array
 * order (index 0 is the backmost within its group; a later effect paints over an
 * earlier one). Matching Figma's exact frontmost-first stacking for multiple
 * shadows on one node is a deferred refinement; single-effect nodes are unaffected.
 * A normal-blend stack uses one `feMerge`; any non-normal per-shadow blend mode
 * switches to a sequential `feBlend` fold (feMerge is over-only).
 *
 * @param nodeId stable node id; the only input to the deterministic filter id.
 * @param effects resolved effects (visibility/clamping already applied upstream).
 * @param bounds geometry-local bounds (no transform, no stroke) for region math.
 * @param strokeWidth resolved stroke width, added to the region margin.
 * @param recipe optional vec-core recipe; its SVG-approx chain paints the
 *   content before shadows. Omit/`null` for no look.
 */
export function buildEffectFilter(
	nodeId: string,
	effects: readonly ResolvedEffect[],
	bounds: Bounds,
	strokeWidth: number,
	recipe: VisualRecipe | null = null,
	/**
	 * When true (raster export targets only), SMIL `<animate>` is unusable
	 * because a raster capture loads the SVG via `<img>` and freezes SMIL, so
	 * animated effects elsewhere in the chain bake their per-frame value instead.
	 * The Linear density ramp remains an inlined `feImage` data URL, so the
	 * authored angle survives without external sub-resource fetches.
	 */
	rasterSafe = false,
	/**
	 * Frame time in seconds (raster export only). Forwarded through the recipe
	 * chain for effects whose SVG output is animated (e.g. explicit keyframed
	 * `feTurbulence` seeds); the particle dissolve itself never reads this — it
	 * is unconditionally static.
	 */
	frameTimeSeconds?: number,
	/**
	 * Pre-resolved routes for this exact node/group target. Callers must use the
	 * registry compiler; this adapter still rejects duplicates defensively.
	 */
	effectFieldRoutes: readonly EffectFieldRoutePlan[] = [],
	/** Renderer-neutral source/target consequence for this exact node. */
	sourceOpticsNodePlan?: SourceOpticsNodePlan | null,
): EffectFilterSpec | null {
	const visible = effects.filter(effectCanRenderVisibly);

	const id = nodeFilterId(nodeId);
	const deferred: DeferredEffect[] = [];
	const primitives: FilterPrimitive[] = [];
	const underLayers: LayerInput[] = [];
	const overLayers: LayerInput[] = [];
	const routeForDescriptor = (
		descriptorId: string,
	): EffectFieldRoutePlan | null => {
		const matches = effectFieldRoutes.filter(
			(route) => route.descriptorId === descriptorId,
		);
		if (matches.length === 1) {
			const route = matches[0];
			return route &&
				(route.fidelity.status === "native" ||
					route.fidelity.status === "approximated" ||
					route.fidelity.status === "capture-only")
				? route
				: null;
		}
		if (matches.length > 1) {
			for (const route of matches) {
				deferred.push({
					kind: "effect-field",
					assignmentId: route.assignmentId,
					reason: `duplicate active field routes target ${descriptorId}; none was applied`,
				});
			}
		}
		return null;
	};
	for (const route of effectFieldRoutes) {
		if (
			route.fidelity.status === "native" ||
			route.fidelity.status === "approximated" ||
			route.fidelity.status === "capture-only"
		) {
			continue;
		}
		deferred.push({
			kind: "effect-field",
			assignmentId: route.assignmentId,
			reason:
				route.fidelity.reason ??
				`effect field route is ${route.fidelity.status} on this surface`,
		});
	}
	const opacityFieldRoute = routeForDescriptor("style.opacity");
	const layerBlurFieldRoute = routeForDescriptor("style.effects.layer-blur");
	const glowFieldRoute = routeForDescriptor("recipe.glow.bloom");

	// Content chain: SourceGraphic -> [layer blur] -> [recipe look].
	const layerBlurs = visible.filter(
		(effect): effect is ResolvedBlurEffect => effect.kind === "layer-blur",
	);
	const activeLayerBlur = layerBlurs.at(-1);
	let contentInput = "SourceGraphic";
	if (activeLayerBlur) {
		const sx = activeLayerBlur.radius / BLUR_SIGMA_DIVISOR;
		const sy =
			(activeLayerBlur.radiusY ?? activeLayerBlur.radius) / BLUR_SIGMA_DIVISOR;
		const wetInput = layerBlurFieldRoute ? "content-wet" : "content";
		primitives.push({
			kind: "gaussian-blur",
			in: "SourceGraphic",
			stdDeviation: sx === sy ? sx : ([sx, sy] as const),
			result: wetInput,
		});
		if (layerBlurFieldRoute) {
			const wetMix = effectFieldWetMixPrimitives(
				layerBlurFieldRoute,
				bounds,
				"SourceGraphic",
				wetInput,
				"content",
			);
			if (wetMix) {
				primitives.push(...wetMix.primitives);
				contentInput = wetMix.output;
			} else {
				deferred.push({
					kind: "effect-field",
					assignmentId: layerBlurFieldRoute.assignmentId,
					reason:
						"layer-blur field source could not be lowered to an SVG matte",
				});
				contentInput = "SourceGraphic";
			}
		} else {
			contentInput = wetInput;
		}
	} else if (layerBlurFieldRoute) {
		deferred.push({
			kind: "effect-field",
			assignmentId: layerBlurFieldRoute.assignmentId,
			reason: "layer-blur field route has no active layer-blur owner",
		});
	}
	const recipeChain = recipe
		? visualRecipePrimitives({
				recipe,
				bounds,
				input: contentInput,
				resultPrefix: "",
				rasterSafe,
				frameTimeSeconds,
				includeChromaticFringe: false,
				glowFieldRoute,
			})
		: {
				primitives: [],
				output: contentInput,
				effectFieldDeferred: glowFieldRoute
					? ([
							{
								kind: "effect-field",
								assignmentId: glowFieldRoute.assignmentId,
								reason: "glow field route has no visual-recipe owner",
							},
						] as const)
					: [],
			};
	deferred.push(...recipeChain.effectFieldDeferred);
	if (recipeChain.primitives.length > 0) {
		primitives.push(...recipeChain.primitives);
		contentInput = recipeChain.output;
	}
	const sourceOptics = sourceOpticsFilterPrimitives(
		sourceOpticsNodePlan,
		bounds,
		contentInput,
	);
	if (sourceOptics.primitives.length > 0) {
		primitives.push(...sourceOptics.primitives);
		contentInput = sourceOptics.output;
	}
	deferred.push(...sourceOptics.deferred);

	visible.forEach((effect, index) => {
		const prefix = `e${index}`;
		if (effect.kind === "drop-shadow") {
			const result = `${prefix}-shadow`;
			primitives.push(...dropShadowChain(effect, prefix, result));
			underLayers.push({ input: result, mode: effect.blendMode });
		} else if (effect.kind === "inner-shadow") {
			const result = `${prefix}-inner`;
			primitives.push(...innerShadowChain(effect, prefix, result));
			overLayers.push({ input: result, mode: effect.blendMode });
		} else if (effect.kind === "background-blur") {
			deferred.push({
				kind: "background-blur",
				reason: BACKGROUND_BLUR_DEFERRED_REASON,
			});
		}
	});

	// Recipe paint can reach outside the shape, so pad the region by it.
	const region = computeRegion(
		visible,
		bounds,
		strokeWidth,
		(recipe ? recipeOutwardReach(recipe) : 0) + sourceOptics.outwardReach,
	);
	// The reveal is an orthogonal final alpha mask, independent of `material.mode`
	// (it must still render when nothing else in the recipe/effects is
	// renderable — e.g. `mode: "off"` with only a reveal authored).
	const reveal = recipe?.texture.material.reveal;
	const hasReveal = reveal !== undefined;
	const hasRenderable =
		activeLayerBlur !== undefined ||
		recipeChain.primitives.length > 0 ||
		sourceOptics.primitives.length > 0 ||
		underLayers.length > 0 ||
		overLayers.length > 0 ||
		hasReveal ||
		opacityFieldRoute !== null;
	if (!hasRenderable) {
		// Nothing renderable: emit null unless a deferred (e.g. background-blur)
		// limitation must still be surfaced via an empty-primitive spec.
		if (deferred.length === 0) return null;
		return { id, region, primitives: [], deferred };
	}

	const layers: readonly LayerInput[] = [
		...underLayers,
		{ input: contentInput, mode: "normal" },
		...overLayers,
	];

	// Terminal name of the fully-composited object, BEFORE the reveal mask. Only
	// named explicitly when a reveal needs to reference it — otherwise the merge
	// primitive keeps its historical unnamed `result` so non-reveal documents
	// keep serializing byte-identically.
	let compositedOutput = contentInput;
	if (layers.length > 1) {
		if (layers.every((layer) => layer.mode === "normal")) {
			const mergeResult =
				hasReveal || opacityFieldRoute ? "composited" : undefined;
			primitives.push({
				kind: "merge",
				inputs: layers.map((layer) => layer.input),
				...(mergeResult ? { result: mergeResult } : {}),
			});
			if (mergeResult) compositedOutput = mergeResult;
		} else {
			let accumulator = layers[0].input;
			for (let index = 1; index < layers.length; index += 1) {
				const result = `blend${index}`;
				primitives.push({
					kind: "blend",
					mode: layers[index].mode,
					in: layers[index].input,
					in2: accumulator,
					result,
				});
				accumulator = result;
			}
			compositedOutput = accumulator;
		}
	}

	if (recipe && reveal) {
		primitives.push(
			...revealMattePrimitives(
				recipe.texture,
				compositedOutput,
				"reveal",
				bounds,
			),
		);
		compositedOutput = "reveal";
	}

	if (opacityFieldRoute) {
		const opacity = effectFieldAlphaMultiplyPrimitives(
			opacityFieldRoute,
			bounds,
			compositedOutput,
			"field-opacity",
		);
		if (opacity) {
			primitives.push(...opacity.primitives);
		} else {
			deferred.push({
				kind: "effect-field",
				assignmentId: opacityFieldRoute.assignmentId,
				reason: "opacity field source could not be lowered to an SVG matte",
			});
		}
	}

	return { id, region, primitives, deferred };
}

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	return String(rounded);
};

/**
 * Formats feTurbulence `baseFrequency`: one number, or an `x y` pair for
 * anisotropic noise. Exported so the JSX serializer (`CanvasShell`) can pass the
 * same token as the `baseFrequency` prop — React does not join array props with
 * SVG's `<number-optional-number>` space syntax on its own.
 */
export const baseFrequencyToken = (
	value: number | readonly [number, number],
): string =>
	Array.isArray(value)
		? value.map(formatNumber).join(" ")
		: formatNumber(value as number);

/** Formats feColorMatrix `values`: one number for `saturate`, else 20 joined. */
const colorMatrixValues = (
	matrixType: "saturate" | "matrix",
	values: readonly number[],
): string =>
	matrixType === "saturate"
		? formatNumber(values[0] ?? 1)
		: values.map(formatNumber).join(" ");

const escapeAttribute = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

type Attribute = readonly [string, string | number | undefined];

const renderAttributes = (attributes: readonly Attribute[]): string =>
	attributes
		.flatMap(([name, value]) => {
			if (value === undefined) return [];
			const normalized =
				typeof value === "number" ? formatNumber(value) : value;
			return [`${name}="${escapeAttribute(normalized)}"`];
		})
		.join(" ");

/** Serializes one `<feFunc{R,G,B,A}>` child of a `component-transfer` primitive. */
const serializeTransferFunc = (
	channel: "R" | "G" | "B" | "A",
	func: ComponentTransferFunction,
): string => {
	const attributes: Attribute[] = [["type", func.type]];
	switch (func.type) {
		case "identity":
			break;
		case "table":
		case "discrete":
			attributes.push([
				"tableValues",
				func.tableValues.map(formatNumber).join(" "),
			]);
			break;
		case "linear":
			attributes.push(["slope", func.slope], ["intercept", func.intercept]);
			break;
		case "gamma":
			attributes.push(
				["amplitude", func.amplitude],
				["exponent", func.exponent],
				["offset", func.offset],
			);
			break;
	}
	return `<feFunc${channel} ${renderAttributes(attributes)} />`;
};

const serializeTransferFuncs = (
	functions: ComponentTransferFunctions,
): string =>
	(
		[
			["R", functions.r],
			["G", functions.g],
			["B", functions.b],
			["A", functions.a],
		] as const
	)
		.flatMap(([channel, func]) =>
			func ? [serializeTransferFunc(channel, func)] : [],
		)
		.join("");

const serializePrimitive = (primitive: FilterPrimitive): string => {
	switch (primitive.kind) {
		case "gaussian-blur": {
			const stdDeviation =
				typeof primitive.stdDeviation === "number"
					? primitive.stdDeviation
					: `${formatNumber(primitive.stdDeviation[0])} ${formatNumber(primitive.stdDeviation[1])}`;
			return `<feGaussianBlur ${renderAttributes([
				["in", primitive.in],
				["stdDeviation", stdDeviation],
				["result", primitive.result],
			])} />`;
		}
		case "offset":
			return `<feOffset ${renderAttributes([
				["in", primitive.in],
				["dx", primitive.dx],
				["dy", primitive.dy],
				["result", primitive.result],
			])} />`;
		case "flood":
			return `<feFlood ${renderAttributes([
				["flood-color", primitive.floodColor],
				["flood-opacity", primitive.floodOpacity],
				["result", primitive.result],
			])} />`;
		case "composite": {
			const arithmetic = primitive.operator === "arithmetic";
			return `<feComposite ${renderAttributes([
				["operator", primitive.operator],
				["in", primitive.in],
				["in2", primitive.in2],
				["k1", arithmetic ? primitive.k1 : undefined],
				["k2", arithmetic ? primitive.k2 : undefined],
				["k3", arithmetic ? primitive.k3 : undefined],
				["k4", arithmetic ? primitive.k4 : undefined],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			])} />`;
		}
		case "morphology":
			return `<feMorphology ${renderAttributes([
				["operator", primitive.operator],
				["radius", primitive.radius],
				["in", primitive.in],
				["result", primitive.result],
			])} />`;
		case "blend":
			return `<feBlend ${renderAttributes([
				["mode", primitive.mode],
				["in", primitive.in],
				["in2", primitive.in2],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			])} />`;
		case "color-matrix":
			return `<feColorMatrix ${renderAttributes([
				["type", primitive.matrixType],
				["in", primitive.in],
				["values", colorMatrixValues(primitive.matrixType, primitive.values)],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			])} />`;
		case "turbulence": {
			const turbulenceAttributes = renderAttributes([
				["type", primitive.type ?? "fractalNoise"],
				["baseFrequency", baseFrequencyToken(primitive.baseFrequency)],
				["numOctaves", primitive.numOctaves],
				["seed", primitive.seed],
				["stitchTiles", "stitch"],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			]);
			if (!primitive.animate) return `<feTurbulence ${turbulenceAttributes} />`;
			const animateAttributes = renderAttributes([
				["attributeName", primitive.animate.attributeName],
				["values", primitive.animate.values],
				["dur", primitive.animate.dur],
				["repeatCount", "indefinite"],
			]);
			return `<feTurbulence ${turbulenceAttributes}><animate ${animateAttributes} /></feTurbulence>`;
		}
		case "merge": {
			const nodes = primitive.inputs
				.map((input) => `<feMergeNode in="${escapeAttribute(input)}" />`)
				.join("");
			return `<feMerge${primitive.result ? ` result="${escapeAttribute(primitive.result)}"` : ""}>${nodes}</feMerge>`;
		}
		case "component-transfer":
			return `<feComponentTransfer ${renderAttributes([
				["in", primitive.in],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			])}>${serializeTransferFuncs(primitive.functions)}</feComponentTransfer>`;
		case "displacement-map":
			return `<feDisplacementMap ${renderAttributes([
				["in", primitive.in],
				["in2", primitive.in2],
				["scale", primitive.scale],
				["xChannelSelector", primitive.xChannelSelector],
				["yChannelSelector", primitive.yChannelSelector],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			])} />`;
		case "convolve-matrix":
			return `<feConvolveMatrix ${renderAttributes([
				["in", primitive.in],
				["order", primitive.order],
				["kernelMatrix", primitive.kernelMatrix.map(formatNumber).join(" ")],
				["divisor", primitive.divisor],
				["bias", primitive.bias],
				["edgeMode", primitive.edgeMode],
				[
					"preserveAlpha",
					primitive.preserveAlpha === undefined
						? undefined
						: String(primitive.preserveAlpha),
				],
				["color-interpolation-filters", primitive.colorInterpolation],
				["result", primitive.result],
			])} />`;
		case "image":
			return `<feImage ${renderAttributes([
				["href", primitive.href],
				["x", primitive.x],
				["y", primitive.y],
				["width", primitive.width],
				["height", primitive.height],
				["preserveAspectRatio", primitive.preserveAspectRatio],
				["result", primitive.result],
			])} />`;
	}
};

/**
 * Serializes a built spec into an SVG `<filter>` string for the two string
 * exporters. The canvas maps the same `spec.primitives` to JSX. Number
 * formatting mirrors both exporters byte-for-byte so server and client SVG stay
 * comparable. Returns an empty string for a spec with no primitives so callers
 * never emit an empty filter element.
 */
export function serializeEffectFilter(spec: EffectFilterSpec): string {
	if (spec.primitives.length === 0) return "";
	const attributes = renderAttributes([
		["id", spec.id],
		["filterUnits", "userSpaceOnUse"],
		["x", spec.region.x],
		["y", spec.region.y],
		["width", spec.region.width],
		["height", spec.region.height],
	]);
	const body = spec.primitives.map(serializePrimitive).join("\n");
	return `<filter ${attributes}>\n${body}\n</filter>`;
}
