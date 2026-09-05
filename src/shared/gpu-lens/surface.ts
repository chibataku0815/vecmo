/**
 * GPU (WebGL) raster-finish surface.
 *
 * VMA's GPU raster pass: a fullscreen-quad fragment shader that rasterizes an artboard
 * SVG into a texture and applies a remap or filter that SVG filters provably cannot do.
 * Each effect is a `mode`:
 *  - `lens` — spherical CC Lens (`feDisplacementMap` folds/tears on a magnifying lens).
 *  - `kaleidoscope` — N-fold wedge-and-mirror symmetry (a mandala from any content).
 *  - `flow` — evolving fractal-noise displacement (AE Turbulent Displace + Evolution).
 *  - `halftone` — rotated dot screen from per-cell luminance sampling.
 *  - `pixel-grid` — sampled display cells / LED matrix from stable source cells.
 *  - `ordered-dither` — true Bayer matrix thresholding in stable source cells.
 *  - `ascii-glyph` — fixed procedural 5x7 ASCII density glyph mosaic.
 *  - `block-mosaic` — raised block/tile mosaic with grout, bevel, and relief lighting.
 *  - `particle-dissolve` — vec-core particle dissolve from a sampled alpha/density field.
 *  - `glow` — AE Deep Glow: a threshold-extracted, multi-scale-blurred bloom screen-
 *    composited back over the frame. Unlike the others it is a *multi-draw* pass
 *    (extract → separable blur at several radii → composite) using its own scratch
 *    framebuffers, so it can bloom whatever the chain produced before it. A
 *    scoped invocation may provide a separate completed-artboard base texture.
 *
 * Browser-only by design — the caller degrades honestly to the plain SVG layer (and
 * SVG/PDF/Worker export omit the effect) when this surface is unavailable. The module
 * is self-contained and free of feature/entity imports so it can be lazy-`import()`ed
 * into its own Rollup chunk (the WebGL code must never land in an always-eager entry
 * chunk — see `scripts/check-bundle.ts`). It depends only on browser globals plus the
 * sibling blue-noise tile module, which rides in the same lazy chunk.
 *
 * The render pipeline and shaders were proven end-to-end in a real browser before this
 * module existed (see `docs/gpu-lens-raster-surface-plan.md`): SVG string → data-URL
 * `new Image()` + `await decode()` → `texImage2D` → shader → readback. `new
 * Image()+decode()` (NOT `createImageBitmap`, which is Safari-variable for SVG) keeps
 * the texture untainted so the canvas stays readable.
 *
 * (The folder is named `gpu-lens` for historical reasons — the lens shipped first.)
 */

import { hexToRgb } from "@/shared/color";
import {
	addFrameDiagnosticCount,
	beginFramePhase,
	setFrameDiagnosticGauge,
} from "@/shared/performance/frame-diagnostics";
import { BLUE_NOISE_SIZE, blueNoiseTileBytes } from "./blue-noise";
import type {
	RasterLayerMatrix,
	StaticRasterCompositionFrame,
	StaticRasterCompositionPlan,
} from "./static-composition";

/** Which effect the surface runs. */
export type RasterEffectMode =
	| "lens"
	| "kaleidoscope"
	| "flow"
	| "halftone"
	| "riso"
	| "pixel-grid"
	| "ordered-dither"
	| "ascii-glyph"
	| "block-mosaic"
	| "noise-source"
	| "particle-dissolve"
	| "path-blur"
	| "colorama"
	| "wave-warp"
	| "bend-warp"
	| "vhs-color"
	| "vhs-tracking"
	| "vhs-noise"
	| "crt-display"
	| "signal-glitch"
	| "interlace"
	| "glow";

/** AE CC Lens parameters (a spherical refraction), normalized for the shader. */
export interface LensParams {
	readonly mode: "lens";
	/** Lens radius in UV units (fraction of the frame from the centre; ~0.5 reaches a frame edge). */
	readonly size: number;
	/** 0 = flat passthrough, 1 = full spherical magnification (AE Convergence, normalized). */
	readonly convergence: number;
	/** Lens centre X, 0..1 fraction of frame width (0 = left). */
	readonly centerX: number;
	/** Lens centre Y, 0..1 fraction of frame height (0 = top). */
	readonly centerY: number;
	/**
	 * When true, everything outside the lens radius is replaced by {@link clipColor}
	 * (the artboard background) with an anti-aliased rim, instead of passing the source
	 * through unchanged — a hard "glass sphere on a clean background" cutout. Most
	 * meaningful when the lens is the terminal pass: a pass after it (e.g. Glow) bakes
	 * the flat fill in as image content (it would bloom/displace it).
	 */
	readonly clipToRim: boolean;
	/** Rim-fill colour (artboard background), RGB 0..1; used only when {@link clipToRim}. */
	readonly clipColor: readonly [number, number, number];
}

/** Kaleidoscope parameters (N-fold wedge-and-mirror symmetry). */
export interface KaleidoscopeParams {
	readonly mode: "kaleidoscope";
	/** Number of mirrored wedges around the centre (≥2). */
	readonly segments: number;
	/** Centre X, 0..1 fraction of frame width. */
	readonly centerX: number;
	/** Centre Y, 0..1 fraction of frame height. */
	readonly centerY: number;
	/** Rotation of the kaleidoscope, 0..1 = one full turn. */
	readonly roll: number;
}

/** The displacement pattern of a Flow effect. */
export type FlowPattern = "bulge" | "turbulent" | "twist";

/**
 * Flow parameters — an evolving organic displacement (AE Turbulent Displace +
 * Evolution): a fractal-noise field, sliced by an evolution axis so it morphs smoothly
 * over time (which SVG noise cannot do).
 */
export interface FlowParams {
	readonly mode: "flow";
	/** Displacement pattern: radial `bulge`, flowing curl-field `turbulent`, or angular `twist`. */
	readonly pattern: FlowPattern;
	/** Displacement strength in UV units (fraction of the frame). */
	readonly amount: number;
	/** Noise frequency (higher = finer, busier flow). */
	readonly scale: number;
	/** fbm octave count (AE Complexity): fewer = smoother flowing shapes, more = busier. */
	readonly octaves: number;
	/** Evolution phase; animate it (keyframe) to morph the field continuously. */
	readonly evolution: number;
	/** Centre X for bulge/twist, 0..1 (unused by turbulent). */
	readonly centerX: number;
	/** Centre Y for bulge/twist, 0..1 (unused by turbulent). */
	readonly centerY: number;
}

/** Halftone dot-screen parameters. */
export interface HalftoneParams {
	readonly mode: "halftone";
	/** Cell pitch in artboard pixels / scene units. */
	readonly cellSize: number;
	/** Maximum dot radius multiplier; values above 1 let dark cells overlap. */
	readonly dotSize: number;
	/** Tonal steepness before the dot-radius mapping, 0..1. */
	readonly contrast: number;
	/** Screen rotation in radians. */
	readonly angleRadians: number;
	/** Blend of the halftone result over the original image, 0..1. */
	readonly mix: number;
}

/** One risograph spot-ink plate: its colour, own screen angle, and print-registration offset. */
export interface RisoInkParams {
	/** Spot-ink colour, linear 0..1 RGB. */
	readonly colorRgb: readonly [number, number, number];
	/** This plate's screen rotation in radians (distinct per ink = the no-moiré rosette). */
	readonly angleRadians: number;
	/** This plate's print-registration offset in pixels (the off-register colour fringe). */
	readonly offsetPx: readonly [number, number];
}

/**
 * Risograph dot-screen parameters. 1–3 spot-ink plates are each screened at their
 * own angle and offset, then composited as a subtractive overprint (overlapping
 * dots multiply, e.g. pink×blue = purple) over the source fill.
 */
export interface RisoParams {
	readonly mode: "riso";
	/** Cell pitch in artboard pixels / scene units (absolute frequency). */
	readonly cellSize: number;
	/** Maximum dot radius multiplier, 0..1.5. */
	readonly dotSize: number;
	/** Tonal steepness before the dot-radius mapping, 0..1. */
	readonly contrast: number;
	/** Ink-coverage grain (unevenness), 0..1. */
	readonly grain: number;
	/** Overall effect opacity over the source, 0..1. */
	readonly mix: number;
	/** Print-on reveal, 0 = unprinted (source shows), 1 = fully printed. */
	readonly bloomProgress: number;
	/** Global effect amount, 0..1 — gates both dot scale and the final source↔printed mix. */
	readonly fieldStrength: number;
	/** Spatial field shape: 0 uniform (full-strength everywhere), 1 linear, 2 radial. */
	readonly fieldMode: number;
	/** Linear: gradient start point. Radial: centre point. Object-normalized. */
	readonly fieldA: readonly [number, number];
	/** Linear: gradient end point. Unused in radial/uniform modes. Object-normalized. */
	readonly fieldB: readonly [number, number];
	/** Radial: falloff radius, object-normalized. Unused in linear/uniform modes. */
	readonly fieldRadius: number;
	/** Field edge softness, 0 hard edge .. 1 fully smooth falloff. */
	readonly fieldSoftness: number;
	/** Whether the field is inverted (1) — full where the raw field reads 0, and vice versa. */
	readonly fieldInvert: number;
	/** Ink-over-fill composite: 0 normal, 1 multiply, 2 screen, 3 overlay. */
	readonly blendMode: number;
	/** 1–3 spot-ink plates, printed as a subtractive overprint. */
	readonly inks: readonly RisoInkParams[];
}

/** Pixel Grid / LED matrix cell-sampling parameters. */
export interface PixelGridParams {
	readonly mode: "pixel-grid";
	/** Cell pitch in artboard pixels / scene units. */
	readonly cellSize: number;
	/** Gap between lit cells as a fraction of each cell pitch, 0..0.6. */
	readonly gap: number;
	/** Shape morph, 0 = square pixel, 1 = round LED dot. */
	readonly roundness: number;
	/** Emissive gain applied to sampled cell colour. */
	readonly brightness: number;
	/** Tonal steepness before cell colour is displayed, 0..1. */
	readonly contrast: number;
	/** Blend of the pixel-grid result over the original image, 0..1. */
	readonly mix: number;
}

/** Ordered / Bayer dither threshold parameters. */
export interface OrderedDitherParams {
	readonly mode: "ordered-dither";
	/** Cell pitch in artboard pixels / scene units. */
	readonly cellSize: number;
	/**
	 * Threshold pattern: `blue-noise` reads the embedded organic tile (the
	 * error-diffusion-like texture, temporally stable on video); `bayer` keeps
	 * the classic ordered matrix. Vocabulary matches visual-effect-core's
	 * `StylizationDitherPattern`.
	 */
	readonly pattern: "blue-noise" | "bayer";
	/** Bayer matrix dimension, snapped by the scene model to 2, 4, or 8. */
	readonly matrixSize: number;
	/** Quantization levels, 2..8. */
	readonly levels: number;
	/** `luminance` outputs an ink-paper ramp; `rgb` threshold-quantizes each channel. */
	readonly ditherMode: "luminance" | "rgb";
	/** Pre-dither exposure offset, -1..1 with 0 neutral. */
	readonly brightness: number;
	/** Tonal steepness before thresholding, 0..1. */
	readonly contrast: number;
	/** Midtone curve applied after contrast (1 = neutral), 0.25..2.5. */
	readonly gamma: number;
	/** Global threshold bias, 0..1 with 0.5 neutral. */
	readonly threshold: number;
	/** Bayer threshold modulation strength, 0..1. */
	readonly strength: number;
	/** Ink (dark) colour of the luminance-mode ramp, RGB 0..1. */
	readonly ink: readonly [number, number, number];
	/** Paper (light) colour of the luminance-mode ramp, RGB 0..1. */
	readonly paper: readonly [number, number, number];
	/** Blend of the ordered-dither result over the original image, 0..1. */
	readonly mix: number;
}

/** Fixed-ramp ASCII/Glyph Mosaic parameters. */
export interface AsciiGlyphParams {
	readonly mode: "ascii-glyph";
	/** Character-cell height in artboard pixels / scene units. */
	readonly cellSize: number;
	/** Scale of the 5x7 glyph inside each character cell. */
	readonly glyphScale: number;
	/** Tonal steepness before glyph selection, 0..1. */
	readonly contrast: number;
	/** Emissive gain applied to lit glyph pixels. */
	readonly brightness: number;
	/** Bias before choosing the density ramp, -1..1. */
	readonly densityBias: number;
	/** Flip the density ramp so dark source cells choose denser glyphs. */
	readonly invert: boolean;
	/** Blend of the glyph mosaic over the original image, 0..1. */
	readonly mix: number;
}

/** Raised block/tile mosaic cell-sampling parameters. */
export interface BlockMosaicParams {
	readonly mode: "block-mosaic";
	/** Tile pitch in artboard pixels / scene units. */
	readonly cellSize: number;
	/** Grout/gap between block faces as a fraction of each cell pitch. */
	readonly gap: number;
	/** Beveled edge width as a fraction of the visible block face. */
	readonly bevel: number;
	/** Pseudo-height lighting strength. */
	readonly relief: number;
	/** Directional light angle in radians. */
	readonly lightAngleRadians: number;
	/** Light height above the block plane, 0..1. */
	readonly lightElevation: number;
	/** Tonal steepness before block colour and height sampling, 0..1. */
	readonly contrast: number;
	/** Deterministic per-block material variation, 0..1. */
	readonly variation: number;
	/** Blend of the block mosaic over the original image, 0..1. */
	readonly mix: number;
}

/**
 * Path Blur parameters — a spatially-varying directional motion blur. The per-pixel direction
 * + magnitude is supplied as an RGBA8 field texture baked on the CPU from the guide paths
 * (R/G = unit tangent encoded 0..1, B = magnitude). The shader marches an ITERATIVE streamline,
 * re-sampling the field per tap, so the streak follows the guide's curvature — SVG filters
 * cannot (no per-tap feedback). Deferred GPU tier, like flow.
 */
export interface PathBlurParams {
	readonly mode: "path-blur";
	/** RGBA8 direction field, row-major, v downward: R=dirX*.5+.5, G=dirY*.5+.5, B=magnitude, A=255. */
	readonly field: Uint8ClampedArray;
	readonly fieldWidth: number;
	readonly fieldHeight: number;
	/** Maximum streak length in UV units (fraction of the frame). */
	readonly speed: number;
	/** Tap count along the streamline (clamped to the shader's MAX_TAPS). */
	readonly taps: number;
	/** Endpoint taper 0..1 (weight falloff toward the ends of the streak). */
	readonly taper: number;
	/** Symmetric blur through each pixel (both directions) vs forward-only. */
	readonly centered: boolean;
}

/**
 * Noise Source parameters — a GPU procedural noise field (the same fbm/value-noise engine
 * Flow uses to displace, here writing the field directly). The `evolution` z-axis morphs the
 * field *in place* (true boil), which SVG `feTurbulence` cannot do. `evolution` is the already-
 * resolved value for the frame (keyframes + auto-evolve are folded in upstream); the surface
 * stays time-free and deterministic.
 */
export interface NoiseSourceParams {
	readonly mode: "noise-source";
	/** Feature size (matches the SVG noise-field convention: bigger = broader). Maps to uScale = k / scale. */
	readonly scale: number;
	/** fbm octave count (AE Complexity): fewer = smoother blobs, more = busier detail. */
	readonly octaves: number;
	/** Resolved evolution phase for this frame; advancing it slides through the noise volume (boil). */
	readonly evolution: number;
}

export type ParticleDissolveFieldMode = "contour" | "linear" | "mesh";

export type ParticleDissolveAlphaMatteKind =
	| "none"
	| "linear-gradient"
	| "radial-gradient"
	| "contour-gradient";

export type ParticleDissolveAlphaMatteStop = {
	readonly offset: number;
	readonly alpha: number;
};

export type ParticleDissolveAlphaMatte =
	| {
			readonly kind: "none";
			readonly stops: readonly ParticleDissolveAlphaMatteStop[];
	  }
	| {
			readonly kind: "linear-gradient";
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly stops: readonly ParticleDissolveAlphaMatteStop[];
	  }
	| {
			readonly kind: "radial-gradient";
			readonly cx: number;
			readonly cy: number;
			readonly rx: number;
			readonly ry: number;
			/** Radians, matching vec-core EffectMaskSource rotation. */
			readonly rotation: number;
			readonly stops: readonly ParticleDissolveAlphaMatteStop[];
	  }
	| {
			readonly kind: "contour-gradient";
			/** Normalized search width from the selected source contour inward. */
			readonly width: number;
			/** Flips the gradient response after stop interpolation. */
			readonly invert: boolean;
			readonly stops: readonly ParticleDissolveAlphaMatteStop[];
	  };

/**
 * Vec-core particle dissolve parameters lowered for the GPU raster pass. This is
 * intentionally sampled renderer state; the persisted authoring source remains
 * `TextureRecipe`.
 */
export interface ParticleDissolveParams {
	readonly mode: "particle-dissolve";
	/** Density field: source-alpha contour, directional linear, or scalar mesh. */
	readonly fieldMode: ParticleDissolveFieldMode;
	/** Linear field angle in degrees (`0 = right`, clockwise in screen coordinates). */
	readonly angle: number;
	/** True when Linear mode was authored as explicit target-space endpoints. */
	readonly linearFieldAuthored: boolean;
	/** Target-space Linear field endpoints: x1, y1, x2, y2. */
	readonly linearField: readonly [number, number, number, number];
	/** Solid-side hold before fadeout along `linearField`. */
	readonly linearFieldPlateau: number;
	/** In Contour mode, whether `angle` focuses the dissolve onto one silhouette arc. */
	readonly contourFocused: boolean;
	/** Artboard/background colour used when an opaque SVG prefix must expose particle holes. */
	readonly clipColor: readonly [number, number, number];
	/** False means render the transparent matte directly, without noise/threshold particles. */
	readonly particleEnabled: boolean;
	/** Optional first-class alpha matte applied before particle coverage. */
	readonly alphaMatte: ParticleDissolveAlphaMatte;
	/** Dissolve reach/extent, normalized 0..1. */
	readonly strength: number;
	/** Threshold hardness, normalized 0..1. */
	readonly contrast: number;
	/** Positive density bias, normalized 0..1. */
	readonly densityBias: number;
	/** Stable noise seed. */
	readonly seed: number;
	/** Noise frequency multiplier; bigger values produce finer particles. */
	readonly frequency: number;
	/** Deterministic sampled boil phase for this frame. */
	readonly evolution: number;
	/** Rectangular mesh dimensions. Ignored unless `fieldMode === "mesh"`. */
	readonly meshRows: number;
	readonly meshCols: number;
	/** Row-major density values, clamped 0..1. */
	readonly meshValues: readonly number[];
}

/**
 * Blend mode for compositing a GPU layer over a backdrop. Declared here (not imported from
 * entities) so the surface stays FSL-free of entity imports; it must stay a superset of the
 * scene's `BlendMode`. Divergence is caught at build time where the feature layer passes
 * `payload.blendMode` (a `BlendMode`) straight into a `RasterBlendMode` field
 * (`rasterParamsFromNode` in overlay/video) — that assignment fails tsc if the unions drift.
 */
export type RasterBlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "darken"
	| "lighten"
	| "color-dodge"
	| "color-burn"
	| "hard-light"
	| "soft-light"
	| "difference"
	| "exclusion"
	| "hue"
	| "saturation"
	| "color"
	| "luminosity";

/** Blend mode → shader branch index (matches the `blendVec` dispatch in GLSL). */
const BLEND_MODE_INDEX: Record<RasterBlendMode, number> = {
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
	hue: 12,
	saturation: 13,
	color: 14,
	luminosity: 15,
};

/** Colorama parameters — a cyclic luminance→palette ramp (AE Colorama). */
export interface ColoramaParams {
	readonly mode: "colorama";
	/** Ramp stops in ascending offset order; colours as `#rrggbb`. */
	readonly stops: readonly {
		readonly offset: number;
		readonly color: string;
	}[];
	readonly phase: number;
	/** Cycle Repetitions (AE Colorama): ramp repeats across 0..1 luminance, 1..32. */
	readonly repetitions: number;
	/** Input Phase (AE Colorama): which channel indexes the ramp. */
	readonly inputPhase: "luminance" | "alpha";
	readonly mix: number;
}

/** Wave Warp parameters — a periodic transverse displacement (AE Wave Warp). */
export interface WaveWarpParams {
	readonly mode: "wave-warp";
	readonly waveType: "sine" | "semicircle";
	readonly height: number;
	readonly width: number;
	/** Wave travel direction in radians (converted from the payload's degrees). */
	readonly angleRadians: number;
	readonly phase: number;
}

/** Bend Warp parameters — an arc bend plus independent H/V shear. */
export interface BendWarpParams {
	readonly mode: "bend-warp";
	/** Arc bend, -1..1. Positive arcs the frame content upward at the centre. */
	readonly bend: number;
	/** Horizontal shear by vertical position, -1..1. */
	readonly distortionH: number;
	/** Vertical shear by horizontal position, -1..1. */
	readonly distortionV: number;
	/**
	 * Zoom about the frame centre applied before the bend/shear remap,
	 * 0.25..4 (1 = no zoom). The AE-equivalent fix for keeping the warped
	 * source's boundaries out of frame — scale up instead of moving/scaling a
	 * precomp, since this node has no precomp of its own.
	 */
	readonly scale: number;
}

/**
 * VHS Color parameters — composite/S-video chroma degradation (YUV chroma
 * lowpass + subsample + color-under quantize). Gather-class: chroma taps
 * sample the upstream result several times. See {@link FRAGMENT_SHADER_VHS_COLOR}'s
 * doc comment for the exact math this and the DCTL emitter both port.
 */
export interface VhsColorParams {
	readonly mode: "vhs-color";
	/** Chroma horizontal lowpass radius, px, 0..32. */
	readonly bleed: number;
	/** Chroma resolution divisor, 1..8 (1 = full chroma resolution). */
	readonly subsample: number;
	/** Extra chroma smear + quantize amount, 0..1. */
	readonly colorUnder: number;
	readonly mix: number;
}

/**
 * VHS Tracking parameters — tape transport instability (per-scanline
 * time-base jitter, wow/flutter, head-switch tear, tracking-error band).
 * uv-remap-class plus a noise overlay in the band. `evolution` is the
 * pre-folded-per-frame time value (see `noise-source`'s `evolution` doc and
 * `presentation-stage-look-graph.ts`'s auto-evolve pass) — NOT a live clock.
 */
export interface VhsTrackingParams {
	readonly mode: "vhs-tracking";
	readonly jitter: number;
	readonly wobble: number;
	readonly tear: number;
	readonly band: number;
	readonly bandPosition: number;
	readonly evolution: number;
	readonly seed: number;
	readonly mix: number;
}

/**
 * VHS Noise parameters — tape noise floor (luma snow, dropout streaks,
 * generation-loss softness/desaturation/contrast crush). Mostly pointwise +
 * hash noise; `generation`'s softness is a small fixed-radius plus-shaped
 * gather (the one non-pointwise part). `evolution` mirrors
 * {@link VhsTrackingParams.evolution}.
 */
export interface VhsNoiseParams {
	readonly mode: "vhs-noise";
	readonly snow: number;
	readonly dropout: number;
	/** Dropout streak length, px. */
	readonly dropoutLength: number;
	/** Generation-loss amount, 1..5. */
	readonly generation: number;
	readonly evolution: number;
	readonly seed: number;
	readonly mix: number;
}

/**
 * CRT Display parameters — monitor physicality: barrel (pincushion-
 * correcting) curvature applied before sampling, a rounded-corner bezel
 * (black outside its bounds), an RGB triad/slot/dot shadow-mask tint in
 * screen space, and edge vignetting. `mix` scales every contribution
 * (curvature, corner crop, mask, vignette) so `mix` 0 is an exact single-tap
 * passthrough — see {@link FRAGMENT_SHADER_CRT_DISPLAY}'s doc comment for the
 * exact math this and the DCTL emitter both port.
 */
export interface CrtDisplayParams {
	readonly mode: "crt-display";
	/** Shadow-mask pattern family. */
	readonly maskType: "aperture" | "slot" | "shadow";
	/** RGB triad/slot/dot cell pitch, px. */
	readonly maskScale: number;
	/** Mask tint strength, 0..1. */
	readonly maskStrength: number;
	/** Barrel distortion amount, 0..1. */
	readonly curvature: number;
	/** Rounded-corner bezel radius, 0..1 fraction of the shorter frame half-extent. */
	readonly cornerRadius: number;
	/** Edge darkening strength, 0..1. */
	readonly vignette: number;
	readonly mix: number;
}

/**
 * Signal Glitch parameters — sync/glitch artifacts: a per-row hash decides
 * tear bands (horizontal offset), a time-driven vertical roll shifts the
 * whole frame, and a 3-tap RGB channel split (the same isolate-and-offset
 * trick the SVG `chromatic-fringe` node's `chromaticFringePrimitives` uses)
 * finishes the look. Gather-class: 3 taps at offset coordinates. `evolution`
 * is the pre-folded-per-frame time value (see `noise-source`'s `evolution`
 * doc), NOT a live clock. All displacement is pre-scaled by `mix` so `mix` 0
 * is an exact passthrough. See {@link FRAGMENT_SHADER_SIGNAL_GLITCH}'s doc
 * comment for the exact math this and the DCTL emitter both port.
 */
export interface SignalGlitchParams {
	readonly mode: "signal-glitch";
	/** RGB channel split distance, px. */
	readonly channelShift: number;
	/** Vertical sync-loss roll displacement, 0..1 fraction of frame height. */
	readonly rollAmount: number;
	/** Per-row tear-band probability, 0..1. */
	readonly tearDensity: number;
	/** Tear-band horizontal offset strength, px. */
	readonly tearStrength: number;
	readonly evolution: number;
	readonly seed: number;
	readonly mix: number;
}

/**
 * Interlace parameters — a stateless field-parity comb: screen-row parity
 * (odd/even) is compared against the CURRENT field (which flips every
 * rendered frame, derived from `evolution`/`TIMELINE_FRAME_INDEX`) to darken
 * and horizontally displace "off-field" rows, plus a whole-frame brightness
 * alternation as the field flips. No frame history is used — this is a
 * same-frame approximation of interlace combing, not true field storage. See
 * {@link FRAGMENT_SHADER_INTERLACE}'s doc comment for the exact math this and
 * the DCTL emitter both port.
 */
export interface InterlaceParams {
	readonly mode: "interlace";
	/** Off-field line darkening (comb) strength, 0..1. */
	readonly strength: number;
	/** Odd-field horizontal displacement, px. */
	readonly fieldOffset: number;
	/** Per-field whole-frame brightness alternation strength, 0..1. */
	readonly flicker: number;
	readonly evolution: number;
	readonly mix: number;
}

/**
 * Glow parameters — AE Deep Glow. Bright areas (above `threshold`) are extracted,
 * blurred at several radii and summed in HDR (a tight core plus a wide halo), then
 * composited back over the frame with an exposure gain, a chromatic-aberration fringe,
 * and a selectable blend mode — the signature Deep Glow look.
 */
export interface GlowParams {
	readonly mode: "glow";
	/** Halo reach, 0..1 (fraction of the frame; resolution-independent). */
	readonly radius: number;
	/** Exposure gain on the glow (AE Deep Glow Exposure); can exceed 1 to blow the core. */
	readonly intensity: number;
	/** Luminance cutoff, 0..1: only pixels brighter than this bloom. */
	readonly threshold: number;
	/** Chromatic-aberration fringe on the halo, 0..1 (0 = none). */
	readonly chroma: number;
	/** How the glow composites over the frame (AE Deep Glow Blend Mode; default screen). */
	readonly blendMode: RasterBlendMode;
}

/** Parameters for one render, discriminated by `mode`. */
export type RasterEffectParams =
	| LensParams
	| KaleidoscopeParams
	| FlowParams
	| HalftoneParams
	| RisoParams
	| PixelGridParams
	| OrderedDitherParams
	| AsciiGlyphParams
	| BlockMosaicParams
	| NoiseSourceParams
	| ParticleDissolveParams
	| PathBlurParams
	| ColoramaParams
	| WaveWarpParams
	| BendWarpParams
	| VhsColorParams
	| VhsTrackingParams
	| VhsNoiseParams
	| CrtDisplayParams
	| SignalGlitchParams
	| InterlaceParams
	| GlowParams;

/** One GPU pass = one effect node. `nodeId` keeps the pass tied to its Look node. */
export interface RasterEffectPass {
	readonly nodeId: string;
	readonly params: RasterEffectParams;
}

/**
 * The GPU raster segment compiled from a Look graph: the SVG-expressible prefix
 * (rasterized once into the source texture) followed by the ordered GPU passes that
 * the serial path to `output` runs. A single-pass pipeline reproduces the old
 * one-effect behaviour exactly.
 */
export interface RasterEffectPipeline {
	readonly svgPrefix: string;
	readonly passes: readonly RasterEffectPass[];
	readonly sourceCanvas?: RasterCompositedSource;
}

/**
 * An already-composited frame handed in place of the SVG prefix. When present,
 * the GPU source texture is uploaded from this canvas INSTEAD of rasterizing
 * the prefix; the prefix is then only the caller's provenance for what the
 * canvas was built from.
 *
 * This is what lets the artboard/frame-level finish run AFTER a 3D band is
 * composited (artboard composite plan V1, step 4 — 経路A): the caller draws
 * back-run SVG → 3D overlay → front-run SVG into one 2D canvas and hands the
 * whole frame in, so the Look reaches the 3D pixels too. Absent, every existing
 * caller keeps the byte-identical SVG-only path.
 */
export type RasterCompositedSource = {
	readonly canvas: HTMLCanvasElement;
	/**
	 * Changes whenever the canvas contents change. The SVG path caches on string
	 * identity; a canvas has no such identity, so the caller supplies one rather
	 * than letting a stale texture survive a new frame.
	 */
	readonly revision: string;
};

/**
 * A node in the GPU composite tree (the general "stack blended raster layers" model). A
 * `source` leaf is the rasterized SVG prefix; `effects` runs a linear pass chain over its
 * input; `composite` blends two branches with a draw mode. A purely linear graph is a
 * single `effects` over `source` — and still renders through the verified pass chain.
 */
export type RasterLayer =
	| { readonly kind: "source" }
	| {
			readonly kind: "effects";
			readonly input: RasterLayer;
			readonly passes: readonly RasterEffectPass[];
	  }
	| {
			readonly kind: "composite";
			readonly base: RasterLayer;
			readonly overlay: RasterLayer;
			readonly blendMode: RasterBlendMode;
			readonly mix: number;
	  };

export interface RasterTreePipeline {
	readonly svgPrefix: string;
	readonly root: RasterLayer;
	readonly sourceCanvas?: RasterCompositedSource;
}

/**
 * A scoped Deep Glow composite keeps the finished artboard and the emission
 * source separate. The source SVG contains only the targeted post-material
 * pixels; the base SVG remains the complete scene. Both meet again inside the
 * canonical linear-light glow compositor, never through Canvas2D source-over.
 */
export interface ScopedGlowCompositePipeline {
	readonly baseSvg: string;
	readonly emissionSvg: string;
	readonly pass: RasterEffectPass & { readonly params: GlowParams };
	/** Composited base frame (see {@link RasterCompositedSource}); replaces `baseSvg` as the glow base. */
	readonly baseCanvas?: RasterCompositedSource;
}

export interface GpuRasterSurfaceOptions {
	/**
	 * Preserve transparent source pixels through the GPU pipeline and make lens
	 * `clipToRim` cut to alpha instead of the opaque artboard fill. Existing editor
	 * overlay/WebM callers leave this false to keep their established compositing.
	 */
	readonly transparentOutput?: boolean;
	/**
	 * Prefer smaller, safer GPU allocations for ornamental embeds on constrained
	 * browsers. This disables HDR glow scratch buffers and trims the glow/composite
	 * framebuffer pools while keeping the same rendering contract.
	 */
	readonly preferLowMemory?: boolean;
	/**
	 * Whether the browser must preserve the WebGL drawing buffer after compositing.
	 * Capture/readback paths can keep the default; live decorative canvases can set
	 * this false to reduce memory pressure on mobile WebKit.
	 */
	readonly preserveDrawingBuffer?: boolean;
	/**
	 * Transparent-background raster export only. Suppresses the AE-faithful opaque
	 * fill that alpha-phase Colorama (`inputPhase: "alpha"`) otherwise bakes in
	 * (`outAlpha = 1.0` unconditionally) so a transparent artboard's surround stays
	 * transparent instead of being painted with the ramp's stop-0 colour. Existing
	 * callers (editor overlay, WebM, decorative embeds) leave this false/omitted to
	 * keep the established AE-faithful "Colorama paints the whole layer" behaviour —
	 * this is an opt-in escape hatch for the specific case of exporting a
	 * transparent-background still/video frame, not a new default.
	 */
	readonly preserveSourceAlphaThroughGenerators?: boolean;
}

/** Flow pattern → shader branch index. */
const FLOW_PATTERN_INDEX: Record<FlowPattern, number> = {
	bulge: 0,
	turbulent: 1,
	twist: 2,
};

const PARTICLE_FIELD_MODE_INDEX: Record<ParticleDissolveFieldMode, number> = {
	contour: 0,
	linear: 1,
	mesh: 2,
};

const PARTICLE_ALPHA_MATTE_KIND_INDEX: Record<
	ParticleDissolveAlphaMatteKind,
	number
> = {
	none: 0,
	"linear-gradient": 1,
	"radial-gradient": 2,
	"contour-gradient": 3,
};

const PARTICLE_MESH_UNIFORM_CAPACITY = 64;
const PARTICLE_ALPHA_MATTE_STOP_CAPACITY = 8;

/**
 * Colorama ramp capacity. Must stay in sync by hand with the GLSL array size
 * and loop bound (`12`, literal) in `FRAGMENT_SHADER_COLORAMA` — GLSL has no
 * shared-constant import — and with `MAX_COLORAMA_STOPS` in
 * `entities/scene/model/look-graph.ts`.
 */
const COLORAMA_STOP_CAPACITY = 12;

/**
 * Wave Warp waveform → the shader's `uMode` int. Keep in sync by hand with the
 * `uMode` branch in `FRAGMENT_SHADER_WAVE_WARP` (same hand-maintained TS↔GLSL
 * contract as {@link FLOW_PATTERN_INDEX}).
 */
const WAVE_TYPE_INDEX: Record<WaveWarpParams["waveType"], number> = {
	sine: 0,
	semicircle: 1,
};

/**
 * CRT Display mask family → the shader's `uMaskType` int. Keep in sync by
 * hand with the `maskType` branch in {@link FRAGMENT_SHADER_CRT_DISPLAY}'s
 * `crtMaskTint` (same hand-maintained TS↔GLSL contract as {@link WAVE_TYPE_INDEX}).
 */
const CRT_DISPLAY_MASK_TYPE_INDEX: Record<
	CrtDisplayParams["maskType"],
	number
> = {
	aperture: 0,
	slot: 1,
	shadow: 2,
};

/**
 * Colorama Input Phase → the shader's `uInputPhase` int. Keep in sync by hand
 * with the `uInputPhase` branch in `FRAGMENT_SHADER_COLORAMA` (same
 * hand-maintained TS↔GLSL contract as {@link WAVE_TYPE_INDEX}).
 */
const COLORAMA_INPUT_PHASE_INDEX: Record<ColoramaParams["inputPhase"], number> =
	{
		luminance: 0,
		alpha: 1,
	};

/**
 * `#rrggbb` → RGB triple (0..1), falling back to black on an invalid hex. Mirrors
 * `rgbTripleFromHex` in `entities/scene/model/gpu-raster-adapter.ts` (used there for
 * riso ink colours) — same `hexToRgb`-based conversion, kept local here because this
 * module must stay free of entity imports (see the file header).
 */
const rampColorRgb = (hex: string): readonly [number, number, number] => {
	const rgb = hexToRgb(hex);
	return rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : [0, 0, 0];
};

/** A live GPU raster surface bound to its own `<canvas>`. */
export interface GpuRasterSurface {
	/** The output canvas; mount it (editor overlay) or `drawImage` it (WebM capture). */
	readonly canvas: HTMLCanvasElement;
	/**
	 * Run an ordered chain of GPU passes: the SVG prefix is rasterized once into the
	 * source texture, then passes ping-pong through two framebuffers, the last drawing
	 * to the canvas. Programs are compiled and cached per effect mode on demand.
	 */
	renderPipeline(pipeline: RasterEffectPipeline): Promise<void>;
	/**
	 * Render a GPU composite tree: branches render to framebuffers and blend with draw
	 * modes (the general layer-compositing model). Effect spines reuse the same pass
	 * chain as `renderPipeline`.
	 */
	renderTree(pipeline: RasterTreePipeline): Promise<void>;
	/** Composite target-owned Deep Glow over a separate, completed artboard base. */
	renderScopedGlow(pipeline: ScopedGlowCompositePipeline): Promise<void>;
	/** Decode and upload a fail-closed static-source playback composition plan. */
	prepareStaticComposition(plan: StaticRasterCompositionPlan): Promise<boolean>;
	/** Composite cached static sources at sampled transforms and apply scoped glow. */
	renderStaticComposition(
		frame: StaticRasterCompositionFrame,
	): Promise<boolean>;
	/** Disposes static-source textures and framebuffers without closing the surface. */
	clearStaticComposition(): void;
	/** Convenience wrapper: render one effect (a one-pass pipeline). */
	render(svg: string, params: RasterEffectParams): Promise<void>;
	/** Resize the output canvas (re-renders on the next call). */
	resize(width: number, height: number): void;
	/**
	 * Whether the underlying WebGL context has been lost (e.g. GPU process
	 * eviction under context pressure). A lost context makes every render a
	 * silent no-op — long-running consumers (WebM recording) must check this
	 * and report honest fidelity instead of shipping untouched frames.
	 */
	isContextLost(): boolean;
	/**
	 * Whether the last presented frame is fully transparent at every sampled
	 * point. Every real pass output covers the frame (cell/dot shaders paint
	 * opaque cells, remap/glow passes carry the source through), so an
	 * all-transparent presentation means the chain silently produced nothing —
	 * seen when Chrome's first rasterization of an `<img>`-decoded SVG with
	 * embedded data-URL subresources lands in `texImage2D` as an empty texture
	 * (`decode()` resolves before subresources rasterize). Requires
	 * `preserveDrawingBuffer` (the recording surface's default).
	 */
	presentationIsBlank(): boolean;
	/**
	 * Drop the decoded-SVG source cache so the next render re-decodes and
	 * re-uploads its prefix even for a byte-identical string — the recovery
	 * hook for the empty-first-rasterization case above, where the cached
	 * texture itself is the corrupt artifact.
	 */
	invalidateSourceCache(): void;
	/** Release the WebGL context and GPU resources. */
	dispose(): void;
}

/** A single oversized triangle covering clip space — cheaper than a quad, no seam. */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

/**
 * Shared fullscreen-triangle vertex stage. `uYSign` is the presentation-flip contract:
 * DOM image uploads use no UNPACK_FLIP_Y, so texture v=0 is the image's TOP row while
 * the default framebuffer displays row 0 at the canvas BOTTOM — drawn 1:1 the canvas
 * would present every chain upside-down (invisible on the symmetric orb/noise content
 * the surface was first verified on, glaring on photo/video sources). Intermediate FBO
 * passes stay in that y-down texture space (`uYSign = 1`, exactly the pre-fix pipeline),
 * and only a draw whose target is the default framebuffer mirrors clip-space Y
 * (`uYSign = -1`) so the canvas presents upright. Fragment shaders and every texture
 * upload (source SVG, Path Blur direction field) are deliberately untouched by this
 * contract — sampling space never changes, only the final hop to the screen.
 */
const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform float uYSign;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos.x, aPos.y * uYSign, 0.0, 1.0);
}`;

/**
 * Spherical-lens remap. Geometry is computed in image space (y-down, matching the
 * uploaded image and the caller's y-down centre); the source lookup flips y back to
 * GL texture space. Aspect-corrected so the lens stays circular on non-square frames.
 * Outside the lens radius the source passes through unchanged so the surface can
 * composite over the artboard without punching a hole — unless `uClipToRim` is set, in
 * which case the outside is replaced by `uClipColor` (the artboard background) with an
 * anti-aliased rim, a hard cutout that hides whatever the chain pushed past the circle.
 * Pure geometric magnify, with no luminance shading (AE CC Lens does not darken the rim —
 * that comes from the content).
 */
const FRAGMENT_SHADER_LENS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uConvergence;
uniform float uAspect;
uniform bool uClipToRim;
uniform bool uTransparentOutput;
uniform vec3 uClipColor;
void main() {
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);          // image space (y-down)
	vec2 d = iv - uCenter;
	vec2 da = vec2(d.x * uAspect, d.y);          // aspect-corrected for a circular lens
	float r = length(da) / max(uRadius, 1e-4);
	vec2 src = iv;
	if (r < 1.0) {
		float z = sqrt(1.0 - r * r);             // sphere height at this radius
		float k = mix(1.0, z, uConvergence);     // convergence pulls the lookup inward → magnify
		vec2 srcA = da * k;
		src = uCenter + vec2(srcA.x / uAspect, srcA.y);
	}
	vec4 lens = texture(uTex, vec2(src.x, 1.0 - src.y));
	if (uClipToRim) {
		// Hard cutout at the rim: fill outside with the artboard background, AA'd by one
		// screen pixel via fwidth(r). The band sits entirely inside r<1 (upper edge at
		// 1.0), so the r>=1 passthrough region is always fully replaced — no half-pixel
		// ring of the un-clipped source leaks through at the edge.
		float aa = fwidth(r);
		float coverage = 1.0 - smoothstep(1.0 - aa, 1.0, r);
		if (uTransparentOutput) {
			outColor = vec4(lens.rgb, lens.a * coverage);
		} else {
			outColor = vec4(mix(uClipColor, lens.rgb, coverage), 1.0);
		}
	} else {
		outColor = lens;
	}
}`;

/**
 * Kaleidoscope: fold the plane into `uSegments` wedges around the centre, mirroring
 * within each wedge so adjacent wedges reflect — a mandala from any content. Sampled
 * radius overshoots [0,1], so the texture uses REPEAT wrap (set below). Aspect-
 * corrected so the symmetry axes stay radial on non-square frames.
 */
const FRAGMENT_SHADER_KALEIDOSCOPE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uCenter;
uniform float uSegments;
uniform float uRoll;
uniform float uAspect;
const float TAU = 6.28318530717958648;
void main() {
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 da = vec2((iv.x - uCenter.x) * uAspect, iv.y - uCenter.y);
	float ang = atan(da.y, da.x) + uRoll * TAU;
	float rad = length(da);
	float seg = TAU / max(uSegments, 1.0);
	float a = mod(ang, seg);
	a = abs(a - seg * 0.5);                       // mirror fold within the wedge
	vec2 dir = vec2(cos(a), sin(a));
	vec2 src = uCenter + vec2(rad * dir.x / uAspect, rad * dir.y);
	outColor = texture(uTex, vec2(src.x, 1.0 - src.y));
}`;

/**
 * Flow: an evolving organic displacement. A 3D value-noise fbm sampled at
 * `(uv·scale, evolution)` displaces the source — so increasing `uEvolution` slides
 * through the noise volume and the field morphs *continuously* (the smooth evolution
 * SVG noise provably cannot do). `uPattern` picks the displacement: 0 = radial bulge,
 * 1 = turbulent (a divergence-free curl flow field — fluid-like flowing ribbons), 2 =
 * angular twist. Aspect-corrected for radial patterns.
 */
const FRAGMENT_SHADER_FLOW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uAmount;
uniform float uScale;
uniform float uEvolution;
uniform int uPattern;
uniform int uOctaves;
const float TAU = 6.28318530717958648;
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
			mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
		mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
			mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// fbm with a runtime octave count (AE Complexity). Normalized by the amplitude sum so
// the displacement magnitude stays consistent as octaves change — fewer octaves just
// means smoother, larger features (the reference's low-Complexity flowing flame).
float fbm(vec3 p) {
	float s = 0.0;
	float a = 0.5;
	float norm = 0.0;
	for (int i = 0; i < uOctaves; i++) { s += a * vnoise(p); norm += a; p *= 2.0; a *= 0.5; }
	return s / max(norm, 1e-4);
}
// Curl of the fbm potential (divergence-free): a smooth flowing velocity field. Advecting
// the source by it stretches content into flowing ribbons/tendrils — fluid-like turbulence
// (AE Turbulent Displace), where two independent noise samples only give a blobby push.
vec2 curl(vec3 p) {
	float e = 0.04;
	float n1 = fbm(p + vec3(0.0, e, 0.0));
	float n2 = fbm(p - vec3(0.0, e, 0.0));
	float n3 = fbm(p + vec3(e, 0.0, 0.0));
	float n4 = fbm(p - vec3(e, 0.0, 0.0));
	return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
void main() {
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	vec3 np = vec3(iv * uScale, uEvolution);
	vec2 src = iv;
	if (uPattern == 1) {                                  // turbulent (domain-warped curl flow)
		// Domain-warp the curl sample by a noise offset first, so the flow field itself
		// folds and swirls — fiery, churning tendrils rather than a single smooth swirl.
		vec2 q = vec2(fbm(np), fbm(np + vec3(5.2, 1.3, 2.1)));
		src = iv + curl(np + 3.0 * vec3(q, 0.0)) * uAmount * 0.5;
	} else if (uPattern == 0) {                           // bulge (radial)
		vec2 d = iv - uCenter; d.x *= uAspect;
		float n = fbm(np) - 0.5;
		vec2 dir = normalize(d + vec2(1e-5));
		vec2 off = dir * n * 2.0 * uAmount;
		src = iv + vec2(off.x / uAspect, off.y);
	} else {                                              // twist (angular)
		vec2 d = iv - uCenter; d.x *= uAspect;
		float ang = (fbm(np) - 0.5) * 2.0 * uAmount * TAU;
		float c = cos(ang), s = sin(ang);
		vec2 rd = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
		src = uCenter + vec2(rd.x / uAspect, rd.y);
	}
	outColor = texture(uTex, vec2(src.x, 1.0 - src.y));
}`;

/**
 * Wave Warp: a periodic transverse displacement (AE Wave Warp). The wave travels along
 * `uAngle`; the displacement is perpendicular to it, so a sine ramp reads as a travelling
 * ripple rather than a pulsing squeeze. `uMode` picks the profile: 0 = sine, 1 = semicircle
 * (alternating half-discs — fatter crests and cusped zero crossings, the AE "semicircle"
 * shape). Phase is in turns, driven by a keyframe track rather than wall-clock time, so the
 * motion is deterministic and an integer phase delta closes a loop exactly.
 *
 * Edges are pinned (AE "pinning: all edges"): the displacement tapers to zero within a band
 * of the border and the source uv is clamped, because the ping-pong FBOs are REPEAT-wrapped
 * and an untapered sample would fold the opposite edge into the frame. The taper band must
 * exceed the wave's spatial period (`uScale`), not just its amplitude (`uAmount`) — a band
 * sized to amplitude alone is narrower than one wavelength, so successive crests compress
 * into periodic dark pockets against the pin instead of tapering smoothly.
 */
const FRAGMENT_SHADER_WAVE_WARP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uAmount;
uniform float uScale;
uniform float uAngle;
uniform float uPhase;
uniform int uMode;
const float TAU = 6.28318530717958648;
float waveAt(float x) {
	if (uMode == 1) {
		float p = fract(x);
		float second = step(0.5, p);
		float centre = mix(0.25, 0.75, second);
		float q = (p - centre) * 4.0;
		return mix(1.0, -1.0, second) * sqrt(max(0.0, 1.0 - q * q));
	}
	return sin(TAU * x);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 dir = vec2(cos(uAngle), sin(uAngle));
	vec2 perp = vec2(-dir.y, dir.x);
	float wave = waveAt(dot(iv * resolution, dir) / max(uScale, 1.0) + uPhase);
	vec2 edge = min(iv, 1.0 - iv) * resolution;
	float band = max(abs(uAmount), uScale * 0.5);
	float pin = min(smoothstep(0.0, band, edge.x), smoothstep(0.0, band, edge.y));
	vec2 src = clamp(iv + perp * wave * uAmount * pin / resolution, vec2(0.0), vec2(1.0));
	outColor = texture(uTex, vec2(src.x, 1.0 - src.y));
}`;

/**
 * Bend Warp: an arc bend plus independent horizontal/vertical shear (AE Bend/
 * Distortion Warp, arc style). The vertical displacement follows a parabola
 * across x — zero at the left/right edges, strongest at centre — so `uBend`
 * reads as the frame arcing upward (positive) or downward (negative) at its
 * midpoint. `uDistortionH`/`uDistortionV` are simple shears: horizontal
 * position slides with y, vertical position slides with x. Source uv OUTSIDE
 * [0,1] on either axis is treated as reveal-transparency, not clamped to the
 * edge: AE's Warp reveals empty space beyond the source layer, it never
 * smears the boundary row/column outward. A hard clamp instead produces a
 * visible streaky band of repeated edge-texel colour wherever the remap pulls
 * content past the frame — this is a single-valued remap with no periodic
 * wraparound (unlike Wave Warp's pin/taper), so "nothing there" is the
 * correct read, not "hold the last sample". `uScale` zooms about the frame
 * centre BEFORE the bend/shear math, the AE equivalent of scaling a warped
 * precomp up so its own boundaries sit outside the comp — this node has no
 * precomp to scale, so the zoom is folded into the same remap instead.
 */
const FRAGMENT_SHADER_BEND_WARP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uBend;
uniform float uDistortionH;
uniform float uDistortionV;
uniform float uScale;
void main() {
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	// Zoom about the frame centre before warping — the AE equivalent of scaling
	// the warped precomp up so its boundaries sit outside the comp.
	iv = vec2(0.5) + (iv - vec2(0.5)) / max(uScale, 0.25);
	// AE Warp "Arc": vertical displacement follows a parabola across x, zero at
	// the left/right edges, strongest at centre. Bend 1.0 lifts the centre by
	// 40% of the frame height.
	float arc = uBend * 0.4 * 4.0 * iv.x * (1.0 - iv.x);
	// Distortions are shears: horizontal position slides with y, vertical with x.
	vec2 src = vec2(
		iv.x + uDistortionH * 0.5 * (iv.y - 0.5),
		iv.y - arc + uDistortionV * 0.5 * (iv.x - 0.5)
	);
	// AE Warp reveals empty space beyond the source, never a smeared edge:
	// outside the source rect the pass contributes nothing, and the surface
	// composites the artboard background there instead.
	if (src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0) {
		outColor = vec4(0.0);
		return;
	}
	outColor = texture(uTex, vec2(src.x, 1.0 - src.y));
}`;

/**
 * VHS Color: composite/S-video chroma degradation. Converts to Rec. 601 YUV,
 * lowpasses chroma only with a fixed 9-tap horizontal box average (the tap
 * COUNT is fixed so the GLSL preview and the DCTL emitter run the exact same
 * discrete math — a variable-width kernel would let the two diverge), quantizes
 * the sampling x-coordinate to `uSubsample`-texel blocks before that average
 * (chroma resolution downsample), then quantizes the averaged chroma to a
 * small step count that tightens with `uColorUnder` (extra tape smear). Luma
 * is read from the un-averaged centre sample, so edges stay sharp while only
 * colour softens — the signature "sharp luma, soft chroma" composite/S-video
 * look. `uBleed`/`uMix` are the hero DCTL params; `uSubsample`/`uColorUnder`
 * bake as DCTL constants. THE MATH (ported verbatim to
 * `features/export/model/look-dctl/emitters/vhs-color.ts`):
 *   yuv = rgb2yuv601(rgb); recombined = yuv2rgb601(vec3(centerY, blurredChroma))
 *   quantizedX = (floor(pxX / subsample) + 0.5) * subsample texel
 *   tap t in 0..8: offsetPx = (t/8 - 0.5) * bleed * 2; sample at quantizedX + offsetPx
 *   levels = mix(64, 6, colorUnder); chroma = floor(chroma*levels+0.5)/levels
 *   out = mix(centerRgb, recombined, mix)
 */
const FRAGMENT_SHADER_VHS_COLOR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uBleed;
uniform float uSubsample;
uniform float uColorUnder;
uniform float uMix;
const int VHS_COLOR_TAPS = 9;
vec3 rgb2yuv601(vec3 c) {
	float y = dot(c, vec3(0.299, 0.587, 0.114));
	float u = dot(c, vec3(-0.14713, -0.28886, 0.436));
	float v = dot(c, vec3(0.615, -0.51499, -0.10001));
	return vec3(y, u, v);
}
vec3 yuv2rgb601(vec3 yuv) {
	float y = yuv.x;
	float u = yuv.y;
	float v = yuv.z;
	return vec3(y + 1.13983 * v, y - 0.39465 * u - 0.58060 * v, y + 2.03211 * u);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 texel = 1.0 / resolution;
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	vec3 centerRgb = texture(uTex, vec2(iv.x, 1.0 - iv.y)).rgb;
	float centerY = rgb2yuv601(centerRgb).x;

	float subsamplePx = max(uSubsample, 1.0);
	float pxX = iv.x * resolution.x;
	float quantizedX = ((floor(pxX / subsamplePx) + 0.5) * subsamplePx) * texel.x;

	float bleedPx = max(uBleed, 0.0);
	vec2 chromaSum = vec2(0.0);
	for (int i = 0; i < VHS_COLOR_TAPS; i++) {
		float t = (float(i) / float(VHS_COLOR_TAPS - 1)) - 0.5;
		float offsetPx = t * bleedPx * 2.0;
		float tapX = clamp(quantizedX + offsetPx * texel.x, 0.0, 1.0);
		chromaSum += rgb2yuv601(texture(uTex, vec2(tapX, 1.0 - iv.y)).rgb).yz;
	}
	vec2 chroma = chromaSum / float(VHS_COLOR_TAPS);

	float levels = mix(64.0, 6.0, clamp(uColorUnder, 0.0, 1.0));
	chroma = floor(chroma * levels + 0.5) / levels;

	vec3 recombined = yuv2rgb601(vec3(centerY, chroma));
	outColor = vec4(mix(centerRgb, recombined, clamp(uMix, 0.0, 1.0)), 1.0);
}`;

/**
 * VHS Tracking: tape transport instability. A single upstream sample is
 * displaced horizontally per row before sampling (uv-remap), plus a small
 * additive luminance-noise overlay inside the tracking-error band — both
 * scaled by `uMix` so mix 0 is an exact passthrough (rather than a second
 * "clean" tap). All four noise contributions share `hash(vec3)` — the SAME
 * hash `noise-source`/`flow` already use, which the DCTL emitter's
 * `lk_hash3`/`lk_vnoise3` helpers already port exactly, so this node's
 * fidelity is `exact`, not `approx`. `uEvolution` is a pre-folded-per-frame
 * time value (see `noise-source`'s convention), NOT a live clock; DCTL
 * instead drives time from `TIMELINE_FRAME_INDEX * speed`. THE MATH (ported
 * verbatim to `features/export/model/look-dctl/emitters/vhs-tracking.ts`):
 *   row = floor(iv.y * height); time = evolution
 *   jitterPx = (hash(row,seed,time)*2-1) * jitter * 6px
 *   wobblePx = sin(iv.y*2*TAU + time*1.7 + seed) * wobble * 10px
 *   tearEnv = smoothstep(0.92, 1.0, iv.y); tearPx = (hash(row,time,seed+11)*2-1) * tearEnv * tear * 40px
 *   bandWindow = 1 - smoothstep(0, 0.035, abs(iv.y - bandPosition))
 *   bandPx = (hash(row,time,seed+23)*2-1) * bandWindow * band * 18px
 *   dx = (jitterPx+wobblePx+tearPx+bandPx) * mix; srcX = fract(iv.x + dx/width)
 *   overlay = (hash(pxX,row,time+seed)*2-1) * bandWindow * band * 0.35 * mix
 *   out = clamp(sample(srcX,iv.y) + overlay, 0, 1)
 */
const FRAGMENT_SHADER_VHS_TRACKING = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uJitter;
uniform float uWobble;
uniform float uTear;
uniform float uBand;
uniform float uBandPosition;
uniform float uEvolution;
uniform float uSeed;
uniform float uMix;
const float TAU = 6.28318530717958648;
const float JITTER_MAX_PX = 6.0;
const float WOBBLE_MAX_PX = 10.0;
const float WOBBLE_FREQ = 2.0;
const float WOBBLE_RATE = 1.7;
const float TEAR_BAND_HEIGHT = 0.08;
const float TEAR_MAX_PX = 40.0;
const float BAND_HALF_WIDTH = 0.035;
const float BAND_MAX_PX = 18.0;
const float BAND_NOISE_STRENGTH = 0.35;
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	float row = floor(iv.y * resolution.y);
	float time = uEvolution;
	float mixAmount = clamp(uMix, 0.0, 1.0);

	float jitterNoise = hash(vec3(row, uSeed, time)) * 2.0 - 1.0;
	float jitterPx = jitterNoise * uJitter * JITTER_MAX_PX;

	float wobblePx = sin(iv.y * WOBBLE_FREQ * TAU + time * WOBBLE_RATE + uSeed) * uWobble * WOBBLE_MAX_PX;

	float tearEnv = smoothstep(1.0 - TEAR_BAND_HEIGHT, 1.0, iv.y);
	float tearNoise = hash(vec3(row, time, uSeed + 11.0)) * 2.0 - 1.0;
	float tearPx = tearNoise * tearEnv * uTear * TEAR_MAX_PX;

	float bandWindow = 1.0 - smoothstep(0.0, BAND_HALF_WIDTH, abs(iv.y - uBandPosition));
	float bandNoise = hash(vec3(row, time, uSeed + 23.0)) * 2.0 - 1.0;
	float bandPx = bandNoise * bandWindow * uBand * BAND_MAX_PX;

	float dxPx = (jitterPx + wobblePx + tearPx + bandPx) * mixAmount;
	float srcX = fract(iv.x + dxPx / resolution.x);
	vec3 sampled = texture(uTex, vec2(srcX, 1.0 - iv.y)).rgb;

	float overlayNoise = hash(vec3(iv.x * resolution.x, row, time + uSeed)) * 2.0 - 1.0;
	float overlay = overlayNoise * bandWindow * uBand * BAND_NOISE_STRENGTH * mixAmount;

	outColor = vec4(clamp(sampled + vec3(overlay), 0.0, 1.0), 1.0);
}`;

/**
 * VHS Noise: tape noise floor. Mostly pointwise + hash noise: `generation`
 * softens the image via a small fixed plus-shaped 5-tap box blur (the one
 * gather part — radius scales 0 at generation 1 up to a few px at generation
 * 5) then desaturates and crushes contrast toward mid-grey by the same
 * generation curve; `snow` adds hash luma noise; `dropout` tests a
 * row-segment hash against a probability and, on a hit, replaces that
 * segment with a near-white streak. Shares `hash(vec3)` with `noise-source`/
 * `flow`/VHS Tracking, so the DCTL port stays `exact`. THE MATH (ported
 * verbatim to `features/export/model/look-dctl/emitters/vhs-noise.ts`):
 *   genT = clamp((generation-1)/4, 0, 1); softPx = genT * 2px
 *   softened = average(center, +-x softPx, +-y softPx) [5 taps]
 *   desat = mix(softened, luma(softened), genT*0.6); crushed = mix(desat, 0.5, genT*0.3)
 *   snowNoise = hash(pxXY, time+seed)*2-1; snowed = crushed + snowNoise*snow*0.5
 *   segment = floor(pxX / dropoutLength); dropoutHash = hash(segment, row, time+seed*1.37)
 *   isDropout = step(dropoutHash, dropout*0.08); dropped = mix(snowed, 0.92, isDropout)
 *   out = mix(centerRgb, dropped, mix)
 */
const FRAGMENT_SHADER_VHS_NOISE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uSnow;
uniform float uDropout;
uniform float uDropoutLength;
uniform float uGeneration;
uniform float uEvolution;
uniform float uSeed;
uniform float uMix;
const float SOFTEN_MAX_PX = 2.0;
const float DESAT_MAX = 0.6;
const float CRUSH_MAX = 0.3;
const float SNOW_STRENGTH = 0.5;
const float DROPOUT_MAX_PROB = 0.08;
const float DROPOUT_COLOR = 0.92;
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 texel = 1.0 / resolution;
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 sampleUv = vec2(iv.x, 1.0 - iv.y);
	float time = uEvolution;

	float genT = clamp((uGeneration - 1.0) / 4.0, 0.0, 1.0);
	float softPx = genT * SOFTEN_MAX_PX;
	vec3 centerRgb = texture(uTex, sampleUv).rgb;
	vec3 blurSum = centerRgb;
	blurSum += texture(uTex, sampleUv + vec2(texel.x * softPx, 0.0)).rgb;
	blurSum += texture(uTex, sampleUv - vec2(texel.x * softPx, 0.0)).rgb;
	blurSum += texture(uTex, sampleUv + vec2(0.0, texel.y * softPx)).rgb;
	blurSum += texture(uTex, sampleUv - vec2(0.0, texel.y * softPx)).rgb;
	vec3 softened = blurSum / 5.0;

	float luma = dot(softened, vec3(0.299, 0.587, 0.114));
	vec3 desat = mix(softened, vec3(luma), genT * DESAT_MAX);
	vec3 crushed = mix(desat, vec3(0.5), genT * CRUSH_MAX);

	float snowNoise = hash(vec3(iv * resolution, time + uSeed)) * 2.0 - 1.0;
	vec3 snowed = clamp(crushed + vec3(snowNoise * uSnow * SNOW_STRENGTH), 0.0, 1.0);

	float dropoutLengthPx = max(uDropoutLength, 1.0);
	float segmentIndex = floor(iv.x * resolution.x / dropoutLengthPx);
	float rowIndex = floor(iv.y * resolution.y);
	float dropoutHash = hash(vec3(segmentIndex, rowIndex, time + uSeed * 1.37));
	float isDropout = step(dropoutHash, uDropout * DROPOUT_MAX_PROB);
	vec3 dropped = mix(snowed, vec3(DROPOUT_COLOR), isDropout);

	outColor = vec4(mix(centerRgb, dropped, clamp(uMix, 0.0, 1.0)), 1.0);
}`;

/**
 * CRT Display: monitor physicality. Barrel-warps the sampling coordinate
 * (Lottes-style per-axis pincushion correction: each axis's offset scales
 * with the OTHER axis's squared distance from centre, `uCurvature` sets the
 * strength), samples black outside a rounded-corner bezel rect (a
 * `roundedBox` SDF test against the WARPED coordinate — so the bezel curves
 * with the tube glass), tints the sampled colour by an RGB triad/slot/dot
 * shadow-mask pattern in fixed SCREEN space (the physical mask sits on the
 * tube glass, unaffected by the electron-beam-side barrel warp), and darkens
 * toward the frame edges (vignette). Every contribution (curvature, corner
 * crop, mask strength, vignette) is pre-scaled by `uMix` so `uMix` 0 is an
 * exact single-tap passthrough — no second "clean" tap needed, the same
 * `mix`-scaling trick `FRAGMENT_SHADER_VHS_TRACKING` uses. `uMaskStrength`/
 * `uCurvature`/`uMix` are the hero DCTL params; `uMaskType`/`uMaskScale`/
 * `uCornerRadius`/`uVignette` bake as DCTL constants (`uMaskType` selects
 * which mask-pattern expression is emitted, no runtime branch — the same
 * codegen-time selection `FRAGMENT_SHADER_WAVE_WARP`'s `waveType` uses). THE
 * MATH (ported verbatim to `features/export/model/look-dctl/emitters/crt-display.ts`):
 *   cc = iv*2-1; k = curvature * CURVATURE_MAX * mix
 *   warped = (cc * (1 + k*vec2(cc.y^2, cc.x^2))) * 0.5 + 0.5
 *   halfSize = resolution/2; px = (warped-0.5)*resolution; radiusPx = cornerRadius*mix*min(halfSize)
 *   q = abs(px) - (halfSize - radiusPx); sdf = length(max(q,0)) + min(max(q.x,q.y),0) - radiusPx
 *   sampled = (sdf > 0 || warped outside [0,1]) ? black : texture(warped)
 *   maskTint = crtMaskTint(iv*resolution, maskType, maskScale, maskStrength*mix) [see per-branch pattern math below]
 *   vig = 1 - vignette*mix*smoothstep(0.2, 0.75, length((iv-0.5)*vec2(1, resolution.y/resolution.x)))
 *   out = clamp(sampled * maskTint * vig, 0, 1)
 */
const FRAGMENT_SHADER_CRT_DISPLAY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform int uMaskType;
uniform float uMaskScale;
uniform float uMaskStrength;
uniform float uCurvature;
uniform float uCornerRadius;
uniform float uVignette;
uniform float uMix;
const float CRT_CURVATURE_MAX = 0.4;
const float CRT_VIGNETTE_INNER = 0.2;
const float CRT_VIGNETTE_OUTER = 0.75;
vec3 crtMaskTint(vec2 px, int maskType, float scale, float strength) {
	float cell = max(scale, 1.0);
	vec3 tint;
	float fall = 1.0;
	if (maskType == 1) {
		// Slot mask: short vertical triads, offset one cell-and-a-half every other row pair.
		float rowPair = floor(px.y / (cell * 2.0));
		float rowOffset = mod(rowPair, 2.0) * (cell * 1.5);
		float cellX = mod(px.x + rowOffset, cell * 3.0);
		tint = cellX < cell ? vec3(1.0, 0.2, 0.2) : (cellX < cell * 2.0 ? vec3(0.2, 1.0, 0.2) : vec3(0.2, 0.2, 1.0));
	} else if (maskType == 2) {
		// Shadow mask: staggered round triad dots.
		vec2 cellCoord = floor(px / cell);
		float rowOffset = mod(cellCoord.y, 2.0) * 1.5;
		float cellX = mod(cellCoord.x + rowOffset, 3.0);
		tint = cellX < 1.0 ? vec3(1.0, 0.2, 0.2) : (cellX < 2.0 ? vec3(0.2, 1.0, 0.2) : vec3(0.2, 0.2, 1.0));
		float dotY = fract(px.y / cell);
		fall = 1.0 - smoothstep(0.25, 0.85, abs(dotY - 0.5) * 2.0);
	} else {
		// Aperture grille: continuous vertical RGB stripes.
		float cellX = mod(px.x, cell * 3.0);
		tint = cellX < cell ? vec3(1.0, 0.2, 0.2) : (cellX < cell * 2.0 ? vec3(0.2, 1.0, 0.2) : vec3(0.2, 0.2, 1.0));
	}
	return mix(vec3(1.0), tint, clamp(strength, 0.0, 1.0) * mix(0.6, 1.0, fall));
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	float mixAmount = clamp(uMix, 0.0, 1.0);

	vec2 cc = iv * 2.0 - 1.0;
	float k = clamp(uCurvature, 0.0, 1.0) * CRT_CURVATURE_MAX * mixAmount;
	vec2 warped = cc * (1.0 + k * vec2(cc.y * cc.y, cc.x * cc.x));
	warped = warped * 0.5 + 0.5;

	vec2 halfSize = resolution * 0.5;
	vec2 px = (warped - 0.5) * resolution;
	float radiusPx = clamp(uCornerRadius, 0.0, 1.0) * mixAmount * min(halfSize.x, halfSize.y);
	vec2 q = abs(px) - (halfSize - vec2(radiusPx));
	float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radiusPx;
	bool outside = sdf > 0.0 || warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0;
	vec3 sampled = outside ? vec3(0.0) : texture(uTex, vec2(warped.x, 1.0 - warped.y)).rgb;

	vec3 maskTint = crtMaskTint(iv * resolution, uMaskType, uMaskScale, clamp(uMaskStrength, 0.0, 1.0) * mixAmount);
	vec3 masked = sampled * maskTint;

	float vignetteDist = length((iv - 0.5) * vec2(1.0, resolution.y / resolution.x));
	float vig = 1.0 - clamp(uVignette, 0.0, 1.0) * mixAmount * smoothstep(CRT_VIGNETTE_INNER, CRT_VIGNETTE_OUTER, vignetteDist);

	outColor = vec4(clamp(masked * vig, 0.0, 1.0), 1.0);
}`;

/**
 * Signal Glitch: sync/glitch artifacts. A per-row hash decides whether this
 * scanline is a "tear" band and, if so, its horizontal offset; a
 * time-driven vertical roll (a wrapping `uv.y` shift, magnitude
 * `uRollAmount`, phase driven by `uEvolution`) simulates sync-loss picture
 * roll; a final 3-tap RGB channel split (sample R/G/B at horizontally
 * offset coordinates, like `FRAGMENT_SHADER_VHS_TRACKING`'s single-tap
 * displacement but split three ways) finishes the look. Every displacement
 * is pre-scaled by `uMix`, so `uMix` 0 makes all three taps sample the exact
 * same coordinate (an exact passthrough) — the same trick
 * `FRAGMENT_SHADER_VHS_TRACKING` uses. `uEvolution` is a pre-folded-per-frame
 * time value (see `noise-source`'s convention), NOT a live clock; DCTL
 * instead drives time from `TIMELINE_FRAME_INDEX * speed`. `uChannelShift`/
 * `uTearStrength`/`uMix` are the hero DCTL params; `uRollAmount`/
 * `uTearDensity`/`uSpeed`/`uSeed` bake as constants. THE MATH (ported
 * verbatim to `features/export/model/look-dctl/emitters/signal-glitch.ts`):
 *   row = floor(iv.y*height); time = evolution
 *   rollPhase = fract(rollAmount + time*ROLL_DRIFT_RATE) * mix
 *   tearHash = hash(row,seed,time); isTear = step(1-tearDensity, tearHash)
 *   tearOffsetHash = hash(row,seed+7,time)*2-1; tearPx = isTear*tearOffsetHash*tearStrength*mix
 *   srcX = fract(iv.x + tearPx/width); srcY = fract(iv.y + rollPhase)
 *   shiftUv = (channelShift*0.5*mix)/width
 *   out.r = sample(fract(srcX-shiftUv), srcY).r; out.g = sample(srcX, srcY).g; out.b = sample(fract(srcX+shiftUv), srcY).b
 */
const FRAGMENT_SHADER_SIGNAL_GLITCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uChannelShift;
uniform float uRollAmount;
uniform float uTearDensity;
uniform float uTearStrength;
uniform float uEvolution;
uniform float uSeed;
uniform float uMix;
const float SIGNAL_GLITCH_ROLL_DRIFT_RATE = 0.35;
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	float time = uEvolution;
	float mixAmount = clamp(uMix, 0.0, 1.0);

	float rollPhase = fract(uRollAmount + time * SIGNAL_GLITCH_ROLL_DRIFT_RATE) * mixAmount;

	float row = floor(iv.y * resolution.y);
	float tearHash = hash(vec3(row, uSeed, time));
	float isTear = step(1.0 - clamp(uTearDensity, 0.0, 1.0), tearHash);
	float tearOffsetHash = hash(vec3(row, uSeed + 7.0, time)) * 2.0 - 1.0;
	float tearPx = isTear * tearOffsetHash * uTearStrength * mixAmount;

	float srcX = fract(iv.x + tearPx / resolution.x);
	float srcY = fract(iv.y + rollPhase);

	float shiftUv = (uChannelShift * 0.5 * mixAmount) / resolution.x;
	float sampledR = texture(uTex, vec2(fract(srcX - shiftUv), 1.0 - srcY)).r;
	float sampledG = texture(uTex, vec2(srcX, 1.0 - srcY)).g;
	float sampledB = texture(uTex, vec2(fract(srcX + shiftUv), 1.0 - srcY)).b;
	outColor = vec4(sampledR, sampledG, sampledB, 1.0);
}`;

/**
 * Interlace: a stateless field-parity comb. Screen row parity (odd/even)
 * is compared against the CURRENT field's parity (`uEvolution` recovers the
 * exact rendered frame count — `evolution / EVOLVE_PER_FRAME`, the literal
 * inverse of how `presentation-stage-look-graph.ts` folds `speed * frame *
 * NOISE_SOURCE_EVOLVE_PER_FRAME` into `evolution` — then floors and takes
 * parity; HAND-SYNC: `INTERLACE_EVOLVE_PER_FRAME` below must match
 * `NOISE_SOURCE_EVOLVE_PER_FRAME` in `entities/scene/model/look-graph.ts`,
 * since this leaf `shared/gpu-lens` module cannot import it — see this
 * file's header comment); "off-field" rows (the opposite parity from the
 * current field) are darkened and horizontally displaced (`uFieldOffset`),
 * and the whole frame's brightness alternates as the field flips
 * (`uFlicker`). No frame history is read — a same-frame approximation of
 * interlace combing, not true field storage (the plan's explicit "no
 * previous-frame/temporal effects" non-goal). `uStrength`/`uMix` are the
 * hero DCTL params; `uFieldOffset`/`uFlicker`/`uSpeed` bake as constants.
 * DCTL computes `frameCount = TIMELINE_FRAME_INDEX * speed` directly —
 * algebraically the same quantity this GLSL path recovers via
 * `evolution / EVOLVE_PER_FRAME`, without the per-frame-increment
 * round-trip (DCTL never needs to fold `evolution` in the first place, since
 * `TIMELINE_FRAME_INDEX` is already an exact frame count). THE MATH (ported
 * verbatim to `features/export/model/look-dctl/emitters/interlace.ts`):
 *   frameCount = evolution / EVOLVE_PER_FRAME; fieldParity = mod(floor(frameCount), 2)
 *   row = floor(iv.y*height); rowParity = mod(row, 2); isOffField = step(0.5, abs(rowParity-fieldParity))
 *   srcX = fract(iv.x + fieldOffset*isOffField*mix/width)
 *   dim = 1 - strength*isOffField*mix*COMB_DARKEN_MAX
 *   flick = 1 + (fieldParity*2-1)*flicker*mix*FLICKER_RANGE
 *   out = clamp(sample(srcX, iv.y) * dim * flick, 0, 1)
 */
const FRAGMENT_SHADER_INTERLACE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uStrength;
uniform float uFieldOffset;
uniform float uFlicker;
uniform float uEvolution;
uniform float uMix;
const float INTERLACE_EVOLVE_PER_FRAME = 0.04;
const float INTERLACE_COMB_DARKEN_MAX = 0.6;
const float INTERLACE_FLICKER_RANGE = 0.15;
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	float mixAmount = clamp(uMix, 0.0, 1.0);

	float frameCount = uEvolution / INTERLACE_EVOLVE_PER_FRAME;
	float fieldParity = mod(floor(frameCount), 2.0);

	float row = floor(iv.y * resolution.y);
	float rowParity = mod(row, 2.0);
	float isOffField = step(0.5, abs(rowParity - fieldParity));

	float srcX = fract(iv.x + uFieldOffset * isOffField * mixAmount / resolution.x);
	vec3 sampled = texture(uTex, vec2(srcX, 1.0 - iv.y)).rgb;

	float dim = 1.0 - clamp(uStrength, 0.0, 1.0) * isOffField * mixAmount * INTERLACE_COMB_DARKEN_MAX;
	float flick = 1.0 + (fieldParity * 2.0 - 1.0) * clamp(uFlicker, 0.0, 1.0) * mixAmount * INTERLACE_FLICKER_RANGE;

	outColor = vec4(clamp(sampled * dim * flick, 0.0, 1.0), 1.0);
}`;

/**
 * Colorama: a cyclic palette ramp (AE Colorama). `uInputPhase` picks which channel indexes
 * the ramp (AE "Input Phase"): `0` = source luminance (Rec.709, matching the SVG `color-map`
 * node) — the default, unchanged behaviour; `1` = source alpha — the structural trick for a
 * silhouette-shaped source (e.g. a blurred star): alpha contours become the colour bands, and
 * the fully-transparent surround (alpha 0) maps to stop 0, instead of every luminance value
 * everywhere in an opaque frame. `uPhase` (in turns) rotates the index through the ramp, and
 * the ramp is cyclic — the final stop rejoins the first across the 1.0/0.0 seam — so a phase
 * ramp cycles the palette continuously instead of snapping at the ends. `uRepetitions` (AE
 * "Cycle Repetitions") multiplies the phase input before the ramp lookup, so the ramp repeats
 * that many times across the input's 0..1 range — this decouples "which colours" (the
 * authored stops) from "how many bands" (repetitions), instead of hand-packing extra stop
 * offsets to get banding. `uMix` blends against the original.
 *
 * Alpha-mode output is deliberately OPAQUE (`outAlpha = 1.0`) BY DEFAULT: AE's alpha-input
 * Colorama paints the whole layer — the ramped colour IS the new content, not a tint riding
 * on the old alpha shape — which is what lets the transparent surround resolve to a visible
 * stop-0 fill instead of just vanishing (an alpha-0 output there would erase the very field
 * the effect exists to paint). `uPreserveSourceAlpha` (wired from
 * {@link GpuRasterSurfaceOptions.preserveSourceAlphaThroughGenerators}) is the opt-in escape
 * hatch for transparent-background raster export: when true, alpha-mode output reverts to
 * `src.a` instead of forcing 1.0, so a transparent artboard's surround stays transparent.
 * Every other input-phase/output caller (luminance mode, and every existing alpha-mode
 * caller that leaves the option unset) is byte-identical to before this uniform existed.
 * HAND-SYNC: `uPreserveSourceAlpha` must stay wired at every one of: this struct's `bool`
 * uniform, `createGpuRasterSurface`'s `preserveSourceAlpha` local, the uniform-name union,
 * the uniform map entry, and the colorama draw branch's `gl.uniform1i` call — a missed spot
 * makes `getUniformLocation` return `null` and every draw-time `gl.uniform1i` a silent no-op.
 */
const FRAGMENT_SHADER_COLORAMA = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform int uRampCount;
uniform float uRampOffset[12];
uniform vec3 uRampColor[12];
uniform float uPhase;
uniform float uRepetitions;
uniform int uInputPhase;
uniform bool uPreserveSourceAlpha;
uniform float uMix;
vec3 rampAt(float t) {
	if (uRampCount <= 0) return vec3(t);
	float firstOffset = clamp(uRampOffset[0], 0.0, 1.0);
	vec3 firstColor = uRampColor[0];
	if (uRampCount == 1) return firstColor;
	float previousOffset = firstOffset;
	vec3 previousColor = firstColor;
	bool resolved = false;
	vec3 result = firstColor;
	for (int i = 1; i < 12; i++) {
		if (i >= uRampCount) break;
		float offset = clamp(uRampOffset[i], 0.0, 1.0);
		vec3 color = uRampColor[i];
		if (!resolved && t >= previousOffset && t <= offset) {
			float span = max(offset - previousOffset, 1e-5);
			result = mix(previousColor, color, (t - previousOffset) / span);
			resolved = true;
		}
		previousOffset = offset;
		previousColor = color;
	}
	if (resolved) return result;
	float span = max((firstOffset + 1.0) - previousOffset, 1e-5);
	float travel = (t < firstOffset ? t + 1.0 : t) - previousOffset;
	return mix(previousColor, firstColor, clamp(travel / span, 0.0, 1.0));
}
void main() {
	vec4 src = texture(uTex, vUv);
	float luma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
	float phaseInput = uInputPhase == 1 ? src.a : luma;
	vec3 mapped = rampAt(fract(phaseInput * uRepetitions + uPhase));
	float outAlpha = (uInputPhase == 1 && !uPreserveSourceAlpha) ? 1.0 : src.a;
	outColor = vec4(mix(src.rgb, mapped, clamp(uMix, 0.0, 1.0)), outAlpha);
}`;

/**
 * Halftone dot screen: rotate a regular cell lattice, sample source luminance
 * at each cell centre, convert tone to dot radius, then analytically cover each
 * fragment with an anti-aliased circle. The shader preserves source alpha so a
 * scoped transparent render does not turn into a full opaque paper rectangle.
 */
const FRAGMENT_SHADER_HALFTONE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uScale;
uniform float uStrength;
uniform float uContrast;
uniform float uAngle;
uniform float uMix;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
mat2 rotate2(float radians) {
	float c = cos(radians);
	float s = sin(radians);
	return mat2(c, -s, s, c);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 imageUv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 px = imageUv * resolution;
	vec2 origin = resolution * 0.5;
	float cellSize = max(1.0, uScale);
	mat2 toGrid = rotate2(-uAngle);
	mat2 fromGrid = rotate2(uAngle);
	vec2 gridPx = toGrid * (px - origin);
	vec2 cellCoord = floor(gridPx / cellSize);
	vec2 localPx = (fract(gridPx / cellSize) - 0.5) * cellSize;
	vec4 src = texture(uTex, vec2(imageUv.x, 1.0 - imageUv.y));
	// Area-average the rotated cell (4x4 taps) instead of point-sampling its
	// centre: honest tone per dot, and stable dots on video sources.
	vec3 avgRgb = vec3(0.0);
	float avgAlpha = 0.0;
	for (int tapY = 0; tapY < 4; tapY++) {
		for (int tapX = 0; tapX < 4; tapX++) {
			vec2 tapGridPx = (cellCoord + vec2((float(tapX) + 0.5) / 4.0, (float(tapY) + 0.5) / 4.0)) * cellSize;
			vec2 tapPx = fromGrid * tapGridPx + origin;
			vec2 tapUv = clamp(tapPx / resolution, 0.0, 1.0);
			vec4 tap = texture(uTex, vec2(tapUv.x, 1.0 - tapUv.y));
			avgRgb += tap.rgb;
			avgAlpha += tap.a;
		}
	}
	avgRgb /= 16.0;
	avgAlpha /= 16.0;
	vec3 tonalRgb = avgAlpha > 0.02 ? avgRgb : src.rgb;
	float luma = dot(tonalRgb, LUMA);
	float gain = mix(0.75, 2.5, clamp(uContrast, 0.0, 1.0));
	float tone = clamp((luma - 0.5) * gain + 0.5, 0.0, 1.0);
	float radius = sqrt(1.0 - tone) * 0.5 * cellSize * clamp(uStrength, 0.0, 1.5);
	float dist = length(localPx);
	float aa = max(fwidth(dist), 0.75);
	float coverage = 1.0 - smoothstep(radius - aa, radius + aa, dist);
	coverage *= smoothstep(0.01, 0.5, radius) * src.a;
	vec3 halftoneRgb = mix(vec3(1.0), tonalRgb, coverage);
	vec4 halftone = vec4(halftoneRgb, src.a);
	outColor = mix(src, halftone, clamp(uMix, 0.0, 1.0));
}`;

/**
 * Risograph: 1–3 spot-ink plates, each screened at its own angle and shifted by
 * its own registration offset, composited as a subtractive overprint (overlapping
 * dots multiply toward a darker mixed ink) over the source. Grain thins ink
 * coverage unevenly at absolute frequency; `uBloom` grows the dots from nothing
 * (print-on reveal); `uFieldStrength` is the global dot-size field hook. Source
 * alpha is preserved so scoped transparent renders stay transparent.
 */
const FRAGMENT_SHADER_RISO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uScale;
uniform float uStrength;
uniform float uContrast;
uniform float uMix;
uniform float uGrain;
uniform float uBloom;
uniform float uFieldStrength;
uniform int uRisoFieldMode;
uniform vec2 uFieldA;
uniform vec2 uFieldB;
uniform float uFieldRadius;
uniform float uFieldSoftness;
uniform int uFieldInvert;
uniform int uBlendMode;
uniform int uInkCount;
uniform vec3 uInkColor[3];
uniform float uInkAngle[3];
uniform vec2 uInkOffset[3];
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
mat2 rot2(float radians) {
	float c = cos(radians);
	float s = sin(radians);
	return mat2(c, -s, s, c);
}
float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float inkCoverage(vec2 imageUv, vec2 resolution, float cellSize, float angle, vec2 offsetPx, float dotScale, float toneBias) {
	vec2 origin = resolution * 0.5;
	// Shift this plate by its registration offset (the print misregistration).
	vec2 q = imageUv * resolution - offsetPx;
	mat2 toGrid = rot2(-angle);
	mat2 fromGrid = rot2(angle);
	vec2 gridPx = toGrid * (q - origin);
	vec2 cellCoord = floor(gridPx / cellSize);
	vec2 localPx = (fract(gridPx / cellSize) - 0.5) * cellSize;
	// Area-average this plate's cell (2x2 taps) for honest, stable tone per dot.
	vec3 avgRgb = vec3(0.0);
	float avgAlpha = 0.0;
	for (int ty = 0; ty < 2; ty++) {
		for (int tx = 0; tx < 2; tx++) {
			vec2 tapGrid = (cellCoord + vec2((float(tx) + 0.5) / 2.0, (float(ty) + 0.5) / 2.0)) * cellSize;
			vec2 tapPaper = fromGrid * tapGrid + origin;
			vec2 tapUv = clamp(tapPaper / resolution, 0.0, 1.0);
			vec4 tap = texture(uTex, vec2(tapUv.x, 1.0 - tapUv.y));
			avgRgb += tap.rgb;
			avgAlpha += tap.a;
		}
	}
	avgRgb /= 4.0;
	avgAlpha /= 4.0;
	vec3 tonal = avgAlpha > 0.02 ? avgRgb : vec3(1.0);
	float luma = dot(tonal, LUMA);
	float gain = mix(0.75, 2.5, clamp(uContrast, 0.0, 1.0));
	// Per-plate tonal bias separates the inks (duotone) instead of stacking two
	// identical screens — one plate carries shadows, the other the accents.
	float tone = clamp((luma - 0.5) * gain + 0.5 + toneBias, 0.0, 1.0);
	float radius = sqrt(1.0 - tone) * 0.5 * cellSize * clamp(uStrength, 0.0, 1.5) * dotScale;
	float dist = length(localPx);
	// Softer edge than the hard halftone screen — ink spread, not a laser dot.
	float aa = max(fwidth(dist), 1.2);
	float cov = (1.0 - smoothstep(radius - aa, radius + aa, dist)) * smoothstep(0.01, 0.5, radius);
	return clamp(cov, 0.0, 1.0);
}
vec3 blendOver(vec3 b, vec3 s, int m) {
	if (m == 1) return b * s;
	if (m == 2) return 1.0 - (1.0 - b) * (1.0 - s);
	if (m == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
	if (m == 4) return min(b, s);
	if (m == 5) return max(b, s);
	if (m == 6) return clamp(b / max(1.0 - s, 1e-4), 0.0, 1.0);
	if (m == 7) return 1.0 - clamp((1.0 - b) / max(s, 1e-4), 0.0, 1.0);
	if (m == 8) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
	if (m == 9) {
		vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
		return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
	}
	if (m == 10) return abs(b - s);
	if (m == 11) return b + s - 2.0 * b * s;
	return s;
}
float fieldValue(vec2 p) {
	if (uRisoFieldMode == 0) return 1.0;
	float f;
	if (uRisoFieldMode == 1) {
		vec2 ab = uFieldB - uFieldA;
		f = clamp(dot(p - uFieldA, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
	} else {
		float d = distance(p, uFieldA) / max(uFieldRadius, 1e-3);
		f = 1.0 - clamp(d, 0.0, 1.0);
	}
	float s = clamp(uFieldSoftness, 0.0, 1.0);
	f = mix(smoothstep(0.42, 0.58, f), smoothstep(0.0, 1.0, f), s);
	if (uFieldInvert == 1) f = 1.0 - f;
	return clamp(f, 0.0, 1.0);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 imageUv = vec2(vUv.x, 1.0 - vUv.y);
	vec4 src = texture(uTex, vec2(imageUv.x, 1.0 - imageUv.y));
	float fv = fieldValue(imageUv);
	float amt = clamp(uFieldStrength, 0.0, 1.0) * fv;
	float dotScale = amt * smoothstep(0.0, 1.0, clamp(uBloom, 0.0, 1.0));
	float cellSize = max(1.0, uScale);
	vec3 riso = vec3(1.0);
	for (int i = 0; i < 3; i++) {
		float inkOn = i < uInkCount ? 1.0 : 0.0;
		float toneBias = (float(i) - 0.5 * (float(uInkCount) - 1.0)) * 0.22;
		float cov = inkCoverage(imageUv, resolution, cellSize, uInkAngle[i], uInkOffset[i], dotScale, toneBias);
		float grainN = hash21(imageUv * resolution * 0.4 + vec2(float(i) * 17.0));
		cov *= mix(1.0, grainN, clamp(uGrain, 0.0, 1.0) * 0.7);
		riso *= mix(vec3(1.0), uInkColor[i], cov * inkOn);
	}
	vec3 composited = blendOver(src.rgb, riso, uBlendMode);
	vec4 printed = vec4(composited, src.a);
	outColor = mix(src, printed, clamp(uMix, 0.0, 1.0) * amt * src.a);
}`;

/**
 * Pixel Grid / LED matrix: sample the source once at each stable cell centre,
 * draw an anti-aliased square-to-round cell mask, and leave the inter-cell gap
 * dark. Alpha stays tied to the source so scoped transparent renders do not
 * create an opaque black rectangle.
 */
const FRAGMENT_SHADER_PIXEL_GRID = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uScale;
uniform float uGap;
uniform float uRoundness;
uniform float uBrightness;
uniform float uContrast;
uniform float uMix;
float roundedBoxSdf(vec2 p, vec2 halfSize, float radius) {
	vec2 q = abs(p) - (halfSize - vec2(radius));
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 imageUv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 px = imageUv * resolution;
	float cellSize = max(1.0, uScale);
	vec2 cellCoord = floor(px / cellSize);
	vec2 localPx = (fract(px / cellSize) - 0.5) * cellSize;
	vec4 src = texture(uTex, vec2(imageUv.x, 1.0 - imageUv.y));
	// Area-average the cell (4x4 taps) so LED colour reflects the whole cell
	// and stays stable frame-to-frame on video sources.
	vec3 avgRgb = vec3(0.0);
	float avgAlpha = 0.0;
	for (int tapY = 0; tapY < 4; tapY++) {
		for (int tapX = 0; tapX < 4; tapX++) {
			vec2 tapPx = (cellCoord + vec2((float(tapX) + 0.5) / 4.0, (float(tapY) + 0.5) / 4.0)) * cellSize;
			vec2 tapUv = clamp(tapPx / resolution, 0.0, 1.0);
			vec4 tap = texture(uTex, vec2(tapUv.x, 1.0 - tapUv.y));
			avgRgb += tap.rgb;
			avgAlpha += tap.a;
		}
	}
	avgRgb /= 16.0;
	avgAlpha /= 16.0;
	vec3 sampledRgb = avgAlpha > 0.02 ? avgRgb : src.rgb;
	float gap = clamp(uGap, 0.0, 0.6);
	float halfLit = max(0.5, cellSize * 0.5 * (1.0 - gap));
	float radius = halfLit * clamp(uRoundness, 0.0, 1.0);
	float sdf = roundedBoxSdf(localPx, vec2(halfLit), radius);
	float aa = max(fwidth(sdf), 0.75);
	float coverage = 1.0 - smoothstep(0.0, aa, sdf);
	float gain = mix(0.8, 2.6, clamp(uContrast, 0.0, 1.0));
	vec3 toned = clamp((sampledRgb - 0.5) * gain + 0.5, 0.0, 1.0);
	vec3 litRgb = min(vec3(1.0), toned * clamp(uBrightness, 0.0, 2.0));
	vec4 pixelGrid = vec4(litRgb * coverage, src.a);
	outColor = mix(src, pixelGrid, clamp(uMix, 0.0, 1.0));
}`;

/**
 * Ordered Dither: area-average the source per authored cell, run it through a
 * brightness → contrast → gamma tone pipeline, then threshold against either
 * the embedded blue-noise tile (`blue-noise` — the error-diffusion-like texture,
 * chosen over true Floyd–Steinberg because a threshold lookup is GPU-parallel
 * and temporally stable on video where scan-order error feedback crawls) or a
 * deterministic 2x2/4x4/8x8 Bayer lattice. Luminance mode maps the quantized
 * ramp onto ink→paper duotone colours; RGB mode quantizes each channel.
 * The 4x4 cell average (not a centre point-sample) is what keeps detail honest
 * and cells stable frame-to-frame on video sources.
 */
const FRAGMENT_SHADER_ORDERED_DITHER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uBlueNoise;
uniform vec2 uResolution;
uniform float uScale;
uniform int uPattern;
uniform float uMatrixSize;
uniform float uLevels;
uniform int uMode;
uniform float uBrightness;
uniform float uContrast;
uniform float uGamma;
uniform float uThreshold;
uniform float uStrength;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uMix;
float bayer2Value(vec2 p) {
	vec2 q = floor(mod(p, 2.0));
	if (q.y < 0.5) return q.x < 0.5 ? 0.0 : 2.0;
	return q.x < 0.5 ? 3.0 : 1.0;
}
float bayer4Value(vec2 p) {
	vec2 q = floor(mod(p, 4.0));
	return 4.0 * bayer2Value(mod(q, 2.0)) + bayer2Value(floor(q / 2.0));
}
float bayer8Value(vec2 p) {
	vec2 q = floor(mod(p, 8.0));
	return 4.0 * bayer4Value(mod(q, 4.0)) + bayer2Value(floor(q / 4.0));
}
float bayerThreshold(vec2 p, float size) {
	if (size < 3.0) return (bayer2Value(p) + 0.5) / 4.0;
	if (size < 6.0) return (bayer4Value(p) + 0.5) / 16.0;
	return (bayer8Value(p) + 0.5) / 64.0;
}
float cellThreshold(vec2 cellCoord) {
	if (uPattern == 1) {
		float matrixSize = uMatrixSize < 3.0 ? 2.0 : (uMatrixSize < 6.0 ? 4.0 : 8.0);
		return bayerThreshold(cellCoord, matrixSize);
	}
	// Organic: one blue-noise threshold per cell; REPEAT wrap tiles the 64x64.
	return texture(uBlueNoise, (cellCoord + 0.5) / 64.0).r;
}
float orderedQuantize(float value, float threshold, float levels, float strength) {
	float steps = max(2.0, levels);
	float scaled = clamp(value, 0.0, 1.0) * (steps - 1.0);
	float base = floor(scaled);
	float fractional = fract(scaled);
	float activeThreshold = mix(0.5, threshold, clamp(strength, 0.0, 1.0));
	float raised = fractional >= activeThreshold ? 1.0 : 0.0;
	return clamp((base + raised) / (steps - 1.0), 0.0, 1.0);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 imageUv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 px = imageUv * resolution;
	float cellSize = max(1.0, uScale);
	vec2 cellCoord = floor(px / cellSize);
	vec4 src = texture(uTex, vec2(imageUv.x, 1.0 - imageUv.y));
	vec3 avgRgb = vec3(0.0);
	float avgAlpha = 0.0;
	for (int tapY = 0; tapY < 4; tapY++) {
		for (int tapX = 0; tapX < 4; tapX++) {
			vec2 tapPx = (cellCoord + vec2((float(tapX) + 0.5) / 4.0, (float(tapY) + 0.5) / 4.0)) * cellSize;
			vec2 tapUv = clamp(tapPx / resolution, 0.0, 1.0);
			vec4 tap = texture(uTex, vec2(tapUv.x, 1.0 - tapUv.y));
			avgRgb += tap.rgb;
			avgAlpha += tap.a;
		}
	}
	avgRgb /= 16.0;
	avgAlpha /= 16.0;
	vec3 sampledRgb = avgAlpha > 0.02 ? avgRgb : src.rgb;
	float gain = mix(0.8, 2.8, clamp(uContrast, 0.0, 1.0));
	vec3 toned = clamp((sampledRgb + uBrightness - 0.5) * gain + 0.5, 0.0, 1.0);
	toned = pow(toned, vec3(1.0 / clamp(uGamma, 0.25, 2.5)));
	float matrixThreshold = cellThreshold(cellCoord);
	float threshold = clamp(matrixThreshold + (clamp(uThreshold, 0.0, 1.0) - 0.5), 0.0, 1.0);
	float levels = floor(clamp(uLevels, 2.0, 8.0) + 0.5);
	vec4 result;
	if (uMode == 1) {
		vec3 dithered = vec3(
			orderedQuantize(toned.r, threshold, levels, uStrength),
			orderedQuantize(toned.g, threshold, levels, uStrength),
			orderedQuantize(toned.b, threshold, levels, uStrength)
		);
		result = vec4(dithered, src.a);
	} else {
		float luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
		float ramp = orderedQuantize(luma, threshold, levels, uStrength);
		result = vec4(mix(uInk, uPaper, ramp), src.a);
	}
	outColor = mix(src, result, clamp(uMix, 0.0, 1.0));
}`;

/**
 * Glyph Mosaic: sample one source colour per character cell, choose a density
 * glyph from a fixed 5x7 ASCII ramp, then draw lit glyph pixels on a dark cell.
 * No external font, texture atlas, or editable text contract is implied.
 */
const FRAGMENT_SHADER_ASCII_GLYPH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uScale;
uniform float uGlyphScale;
uniform float uContrast;
uniform float uBrightness;
uniform float uDensityBias;
uniform int uInvert;
uniform float uMix;
float rowAt(float row, float r0, float r1, float r2, float r3, float r4, float r5, float r6) {
	if (row < 0.5) return r0;
	if (row < 1.5) return r1;
	if (row < 2.5) return r2;
	if (row < 3.5) return r3;
	if (row < 4.5) return r4;
	if (row < 5.5) return r5;
	return r6;
}
// Density ramp " .:-%+=*#@", ordered by each 5x7 bitmap's MEASURED lit-pixel count
// (0, 2, 4, 5, 8, 9, 10, 17, 18, 24) — NOT by the conventional ASCII-art ramp order.
// In these bitmaps '%' lights only 8 pixels, far sparser than its usual ramp slot
// after '#' (18): keeping the conventional order rendered a visibly BRIGHTER band
// inside the dark end of a smooth gradient (tone-to-ink density must stay monotonic).
// '@' is drawn with a closed ring (24 lit) rather than a typographic '@' (21 lit,
// open counters) for the same reason: the top tone band must out-cover '#'.
float glyphRow(float glyph, float row) {
	if (glyph < 0.5) return 0.0;                                      // space (0 lit)
	if (glyph < 1.5) return rowAt(row, 0.0, 0.0, 0.0, 0.0, 0.0, 4.0, 4.0); // . (2)
	if (glyph < 2.5) return rowAt(row, 0.0, 4.0, 4.0, 0.0, 4.0, 4.0, 0.0); // : (4)
	if (glyph < 3.5) return rowAt(row, 0.0, 0.0, 0.0, 31.0, 0.0, 0.0, 0.0); // - (5)
	if (glyph < 4.5) return rowAt(row, 17.0, 2.0, 4.0, 8.0, 16.0, 17.0, 0.0); // % (8)
	if (glyph < 5.5) return rowAt(row, 0.0, 4.0, 4.0, 31.0, 4.0, 4.0, 0.0); // + (9)
	if (glyph < 6.5) return rowAt(row, 0.0, 0.0, 31.0, 0.0, 31.0, 0.0, 0.0); // = (10)
	if (glyph < 7.5) return rowAt(row, 0.0, 21.0, 14.0, 31.0, 14.0, 21.0, 0.0); // * (17)
	if (glyph < 8.5) return rowAt(row, 10.0, 31.0, 10.0, 10.0, 31.0, 10.0, 0.0); // # (18)
	return rowAt(row, 14.0, 31.0, 23.0, 21.0, 23.0, 17.0, 14.0); // @ (24)
}
float glyphMask(float glyph, vec2 localUv, float scale) {
	vec2 glyphUv = (localUv - 0.5) / max(scale, 0.1) + 0.5;
	if (glyphUv.x < 0.0 || glyphUv.x >= 1.0 || glyphUv.y < 0.0 || glyphUv.y >= 1.0) return 0.0;
	float col = floor(glyphUv.x * 5.0);
	float row = floor(glyphUv.y * 7.0);
	float mask = glyphRow(glyph, row);
	float divisor = pow(2.0, 4.0 - col);
	return mod(floor(mask / divisor), 2.0);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 imageUv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 px = imageUv * resolution;
	float cellHeight = max(4.0, uScale);
	vec2 cellPitch = vec2(cellHeight * 0.72, cellHeight);
	vec2 cellCoord = floor(px / cellPitch);
	vec2 localUv = fract(px / cellPitch);
	vec4 src = texture(uTex, vec2(imageUv.x, 1.0 - imageUv.y));
	// Area-average the character cell (4x4 taps) so glyph choice reflects the
	// whole cell and stays stable frame-to-frame on video sources.
	vec3 avgRgb = vec3(0.0);
	float avgAlpha = 0.0;
	for (int tapY = 0; tapY < 4; tapY++) {
		for (int tapX = 0; tapX < 4; tapX++) {
			vec2 tapPx = (cellCoord + vec2((float(tapX) + 0.5) / 4.0, (float(tapY) + 0.5) / 4.0)) * cellPitch;
			vec2 tapUv = clamp(tapPx / resolution, 0.0, 1.0);
			vec4 tap = texture(uTex, vec2(tapUv.x, 1.0 - tapUv.y));
			avgRgb += tap.rgb;
			avgAlpha += tap.a;
		}
	}
	avgRgb /= 16.0;
	avgAlpha /= 16.0;
	vec3 sampledRgb = avgAlpha > 0.02 ? avgRgb : src.rgb;
	float gain = mix(0.75, 2.75, clamp(uContrast, 0.0, 1.0));
	vec3 toned = clamp((sampledRgb - 0.5) * gain + 0.5, 0.0, 1.0);
	float tone = dot(toned, vec3(0.2126, 0.7152, 0.0722));
	tone = clamp(tone + clamp(uDensityBias, -1.0, 1.0), 0.0, 1.0);
	if (uInvert == 1) tone = 1.0 - tone;
	float glyph = floor(clamp(tone, 0.0, 0.999) * 10.0);
	float mask = glyphMask(glyph, localUv, clamp(uGlyphScale, 0.35, 1.25));
	vec3 glyphRgb = min(vec3(1.0), vec3(mask) * clamp(uBrightness, 0.0, 2.0));
	vec4 glyphMosaic = vec4(glyphRgb, src.a);
	outColor = mix(src, glyphMosaic, clamp(uMix, 0.0, 1.0));
}`;

/**
 * Block Mosaic: sample one source colour per stable cell, draw a dark grout
 * field plus a raised tile face with local bevel lighting. This is a material
 * illusion, not editable tile geometry or a voxel reconstruction.
 */
const FRAGMENT_SHADER_BLOCK_MOSAIC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uScale;
uniform float uGap;
uniform float uBevel;
uniform float uRelief;
uniform float uAngle;
uniform float uLightElevation;
uniform float uContrast;
uniform float uVariation;
uniform float uMix;
float hash21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
void main() {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 imageUv = vec2(vUv.x, 1.0 - vUv.y);
	vec2 px = imageUv * resolution;
	float cell = max(4.0, uScale);
	vec2 cellCoord = floor(px / cell);
	vec2 localUv = fract(px / cell);
	vec4 src = texture(uTex, vec2(imageUv.x, 1.0 - imageUv.y));
	// Area-average the tile (4x4 taps) so face colour reflects the whole tile
	// and stays stable frame-to-frame on video sources.
	vec3 avgRgb = vec3(0.0);
	float avgAlpha = 0.0;
	for (int tapY = 0; tapY < 4; tapY++) {
		for (int tapX = 0; tapX < 4; tapX++) {
			vec2 tapPx = (cellCoord + vec2((float(tapX) + 0.5) / 4.0, (float(tapY) + 0.5) / 4.0)) * cell;
			vec2 tapUv = clamp(tapPx / resolution, 0.0, 1.0);
			vec4 tap = texture(uTex, vec2(tapUv.x, 1.0 - tapUv.y));
			avgRgb += tap.rgb;
			avgAlpha += tap.a;
		}
	}
	avgRgb /= 16.0;
	avgAlpha /= 16.0;
	vec3 sampledRgb = avgAlpha > 0.02 ? avgRgb : src.rgb;
	float gain = mix(0.72, 2.65, clamp(uContrast, 0.0, 1.0));
	vec3 toned = clamp((sampledRgb - 0.5) * gain + 0.5, 0.0, 1.0);
	float tileNoise = hash21(cellCoord);
	toned = clamp(toned * (1.0 + (tileNoise - 0.5) * clamp(uVariation, 0.0, 1.0) * 0.34), 0.0, 1.0);
	float luma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
	float inset = clamp(uGap, 0.0, 0.55) * 0.5;
	vec2 aa = max(fwidth(localUv) * 1.5, vec2(0.001));
	float maskX = smoothstep(inset, inset + aa.x, localUv.x) *
		(1.0 - smoothstep(1.0 - inset - aa.x, 1.0 - inset, localUv.x));
	float maskY = smoothstep(inset, inset + aa.y, localUv.y) *
		(1.0 - smoothstep(1.0 - inset - aa.y, 1.0 - inset, localUv.y));
	float faceMask = clamp(maskX * maskY, 0.0, 1.0);
	vec2 faceUv = clamp((localUv - inset) / max(1.0 - inset * 2.0, 0.001), 0.0, 1.0);
	float bevelWidth = mix(0.018, 0.28, clamp(uBevel, 0.0, 1.0));
	float left = 1.0 - smoothstep(0.0, bevelWidth, faceUv.x);
	float right = 1.0 - smoothstep(0.0, bevelWidth, 1.0 - faceUv.x);
	float top = 1.0 - smoothstep(0.0, bevelWidth, faceUv.y);
	float bottom = 1.0 - smoothstep(0.0, bevelWidth, 1.0 - faceUv.y);
	float edgeBand = clamp(max(max(left, right), max(top, bottom)), 0.0, 1.0);
	vec2 edgeNormal = vec2(right - left, bottom - top);
	edgeNormal = edgeNormal / max(length(edgeNormal), 0.0001);
	float relief = clamp(uRelief, 0.0, 1.0);
	vec3 lightDir = normalize(vec3(cos(uAngle), sin(uAngle), mix(0.22, 1.6, clamp(uLightElevation, 0.0, 1.0))));
	vec3 bevelNormal = normalize(vec3(edgeNormal * edgeBand * relief * 1.35, 1.0));
	float diffuse = clamp(dot(bevelNormal, lightDir) * 0.5 + 0.5, 0.0, 1.0);
	float bevelShade = mix(0.62, 1.34, diffuse);
	float topShade = mix(0.94, 1.12, luma);
	float shade = mix(topShade, bevelShade, edgeBand * relief);
	float cornerDarken = min(left + top, right + bottom) * 0.12 * relief;
	vec3 blockRgb = clamp(toned * max(0.0, shade - cornerDarken), 0.0, 1.0);
	vec3 groutRgb = mix(vec3(0.035), toned * 0.22, 0.25 + luma * 0.2);
	vec3 mosaicRgb = mix(groutRgb, blockRgb, faceMask);
	vec4 blockMosaic = vec4(mosaicRgb, src.a);
	outColor = mix(src, blockMosaic, clamp(uMix, 0.0, 1.0));
}`;

/**
 * Path Blur: a spatially-varying directional motion blur. `uPathBlurMap` holds the per-pixel
 * unit tangent (RG, encoded 0..1) and magnitude (B). An ITERATIVE streamline march re-samples
 * the field at each marched position, so the streak bends along the guide's curvature (a single
 * displacement or a fixed-direction tap cannot). Taps accumulate in premultiplied alpha and are
 * un-premultiplied at the end, so transparent edges average without dark fringing. `uTaper`
 * falls the per-tap weight off toward the streak ends; `uCentered` integrates both directions
 * through the pixel (symmetric) or forward only (directional). The source is sampled with no
 * Y flip: Flow's double flip nets to `texture(uTex, vUv)`, so a zero-magnitude pixel here is an
 * exact passthrough — the field and the source share the same vUv parametrization and align.
 */
const FRAGMENT_SHADER_PATH_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uPathBlurMap;
uniform float uSpeed;
uniform int uTaps;
uniform float uTaper;
uniform int uCentered;
const int MAX_TAPS = 48;
void main() {
	int n = uTaps;
	if (n < 1) n = 1;
	vec4 accum = vec4(0.0);
	float wsum = 0.0;
	vec2 pf = vUv;
	vec2 pb = vUv;
	for (int i = 0; i < MAX_TAPS; i++) {
		if (i >= n) break;
		float fi = (n > 1) ? float(i) / float(n - 1) : 0.0;
		float w = mix(1.0, 1.0 - fi, uTaper);
		vec4 cf = texture(uTex, pf);
		accum.rgb += cf.rgb * cf.a * w;
		accum.a += cf.a * w;
		wsum += w;
		vec3 ff = texture(uPathBlurMap, clamp(pf, 0.0, 1.0)).rgb;
		vec2 fdir = ff.xy * 2.0 - 1.0;
		float fmag = ff.b;
		pf += fdir * (uSpeed * fmag / float(n));
		if (uCentered == 1) {
			// March first, then sample: at i==0 this steps off the centre (already
			// counted by the forward tap) so the symmetric blur isn't double-weighted.
			vec3 bf = texture(uPathBlurMap, clamp(pb, 0.0, 1.0)).rgb;
			vec2 bdir = bf.xy * 2.0 - 1.0;
			float bmag = bf.b;
			pb -= bdir * (uSpeed * bmag / float(n));
			vec4 cb = texture(uTex, pb);
			accum.rgb += cb.rgb * cb.a * w;
			accum.a += cb.a * w;
			wsum += w;
		}
	}
	float a = accum.a / max(wsum, 1e-4);
	vec3 rgb = accum.rgb / max(accum.a, 1e-4);
	outColor = vec4(rgb, a);
}`;

/**
 * Noise Source: write the fbm field directly (a generator), reusing Flow's exact
 * hash/vnoise/fbm engine and the same `uEvolution` z-axis. It IGNORES `uTex` (a SOURCE, not a
 * transform), so `outColor` is the opaque grayscale field. `uScale` is the noise frequency
 * (the feature-size→frequency conversion is done host-side in `setUniforms`).
 */
const FRAGMENT_SHADER_NOISE_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uScale;
uniform float uEvolution;
uniform int uOctaves;
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
			mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
		mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
			mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
	float s = 0.0;
	float a = 0.5;
	float norm = 0.0;
	for (int i = 0; i < uOctaves; i++) { s += a * vnoise(p); norm += a; p *= 2.0; a *= 0.5; }
	return s / max(norm, 1e-4);
}
void main() {
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	vec3 np = vec3(iv * uScale, uEvolution);
	outColor = vec4(vec3(fbm(np)), 1.0);
}`;

/**
 * Vec-core particle dissolve. The pass treats the input texture alpha as the
 * source matte, then optionally multiplies it by a first-class transparent
 * gradient matte. With particles disabled this renders that matte directly, so
 * the gradient shape can be verified before noise/threshold coverage is layered
 * on. The legacy particle branch can still sample nearby source colour for spray;
 * it must consume the authored matte rather than invent the matte itself.
 */
const FRAGMENT_SHADER_PARTICLE_DISSOLVE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform int uFieldMode;
uniform float uAngle;
uniform bool uLinearFieldAuthored;
uniform vec4 uLinearField;
uniform vec2 uLinearFieldAspect;
uniform float uLinearFieldPlateau;
uniform bool uContourFocused;
uniform bool uTransparentOutput;
uniform vec3 uClipColor;
uniform bool uParticleEnabled;
uniform int uMatteKind;
uniform vec4 uMatteLinear;
uniform vec4 uMatteRadial;
uniform vec4 uMatteContour;
uniform float uMatteRotation;
uniform int uMatteStopCount;
uniform float uMatteStopOffsets[8];
uniform float uMatteStopAlphas[8];
uniform float uStrength;
uniform float uContrast;
uniform float uDensityBias;
uniform float uSeed;
uniform float uScale;
uniform float uEvolution;
uniform vec2 uMeshShape;
uniform float uMeshValues[64];
const float PI = 3.14159265358979323846;
const int CONTOUR_RING_STEPS = 10;
const int ALPHA_SPAN_STEPS = 48;
const float OPAQUE_MATTE_DISTANCE = 0.92;
const int MATTE_NONE = 0;
const int MATTE_LINEAR_GRADIENT = 1;
const int MATTE_RADIAL_GRADIENT = 2;
const int MATTE_CONTOUR_GRADIENT = 3;
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
			mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
		mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
			mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
	float s = 0.0;
	float a = 0.5;
	float norm = 0.0;
	for (int i = 0; i < 3; i++) { s += a * vnoise(p); norm += a; p *= 2.0; a *= 0.5; }
	return s / max(norm, 1e-4);
}
vec4 rawAt(vec2 imageUv) {
	return texture(uTex, imageUv);
}
float gradientStopAlpha(float position) {
	float t = clamp(position, 0.0, 1.0);
	if (uMatteStopCount <= 0) return 1.0;
	float previousOffset = clamp(uMatteStopOffsets[0], 0.0, 1.0);
	float previousAlpha = clamp(uMatteStopAlphas[0], 0.0, 1.0);
	if (t <= previousOffset) return previousAlpha;
	for (int i = 1; i < 8; i++) {
		if (i >= uMatteStopCount) break;
		float offset = clamp(uMatteStopOffsets[i], 0.0, 1.0);
		float alpha = clamp(uMatteStopAlphas[i], 0.0, 1.0);
		if (t <= offset) {
			float span = max(offset - previousOffset, 1e-5);
			return mix(previousAlpha, alpha, clamp((t - previousOffset) / span, 0.0, 1.0));
		}
		previousOffset = offset;
		previousAlpha = alpha;
	}
	return previousAlpha;
}
float alphaDeadZone(float alpha) {
	return smoothstep(0.018, 0.995, clamp(alpha, 0.0, 1.0));
}
float matteAt(vec2 imageUv) {
	vec4 raw = rawAt(imageUv);
	if (raw.a < 0.999) return raw.a;
	float colorDistance = distance(raw.rgb, uClipColor);
	return alphaDeadZone(
		colorDistance / max(OPAQUE_MATTE_DISTANCE, 1e-4)
	);
}
float contourGradientAlphaAt(vec2 imageUv, float baseAlpha) {
	if (baseAlpha <= 0.001) return 0.0;
	float width = clamp(uMatteContour.x, 0.01, 1.0);
	float shouldInvert = uMatteContour.y;
	float radians = uAngle * PI / 180.0;
	vec2 selectedNormal = vec2(cos(radians), sin(radians));
	float distanceToContour = width;
	float found = 0.0;
	float stepSize = width / float(ALPHA_SPAN_STEPS);
	for (int step = 1; step <= ALPHA_SPAN_STEPS; step++) {
		float distance = stepSize * float(step);
		vec2 sampleUv = clamp(imageUv + selectedNormal * distance, 0.0, 1.0);
		float sampleAlpha = matteAt(sampleUv);
		if (sampleAlpha <= 0.02) {
			float low = max(0.0, distance - stepSize);
			float high = distance;
			for (int refine = 0; refine < 5; refine++) {
				float mid = (low + high) * 0.5;
				float midAlpha = matteAt(clamp(imageUv + selectedNormal * mid, 0.0, 1.0));
				if (midAlpha > 0.02) {
					low = mid;
				} else {
					high = mid;
				}
			}
			distanceToContour = high;
			found = 1.0;
			break;
		}
	}
	if (found < 0.5) return 1.0;
	float position = clamp(distanceToContour / max(width, 1e-5), 0.0, 1.0);
	float alpha = gradientStopAlpha(position);
	if (shouldInvert > 0.5) alpha = 1.0 - alpha;
	return alpha;
}
float authoredAlphaMatteAt(vec2 imageUv, float baseAlpha) {
	if (uMatteKind == MATTE_LINEAR_GRADIENT) {
		vec2 from = uMatteLinear.xy;
		vec2 to = uMatteLinear.zw;
		vec2 axis = to - from;
		float axisLength = dot(axis, axis);
		float t = axisLength <= 1e-6 ? 1.0 : dot(imageUv - from, axis) / axisLength;
		return gradientStopAlpha(t);
	}
	if (uMatteKind == MATTE_RADIAL_GRADIENT) {
		vec2 delta = imageUv - uMatteRadial.xy;
		float c = cos(-uMatteRotation);
		float s = sin(-uMatteRotation);
		vec2 rotated = vec2(
			delta.x * c - delta.y * s,
			delta.x * s + delta.y * c
		);
		vec2 radius = max(uMatteRadial.zw, vec2(1e-5));
		return gradientStopAlpha(length(rotated / radius));
	}
	if (uMatteKind == MATTE_CONTOUR_GRADIENT) {
		return contourGradientAlphaAt(imageUv, baseAlpha);
	}
	return 1.0;
}
float foregroundAlphaAt(vec2 imageUv, vec3 foregroundRgb) {
	vec4 raw = rawAt(imageUv);
	if (raw.a < 0.999) return raw.a;
	vec3 axis = foregroundRgb - uClipColor;
	float denom = dot(axis, axis);
	if (denom <= 1e-5) return matteAt(imageUv);
	return alphaDeadZone(dot(raw.rgb - uClipColor, axis) / denom);
}
vec3 foregroundRgbAt(vec2 imageUv, vec3 fallbackRgb, float alpha) {
	vec4 raw = rawAt(imageUv);
	if (raw.a < 0.999) return raw.rgb;
	if (alpha <= 1e-4) return fallbackRgb;
	return clamp((raw.rgb - uClipColor * (1.0 - alpha)) / alpha, 0.0, 1.0);
}
vec4 sourceAt(vec2 imageUv) {
	vec4 raw = rawAt(imageUv);
	float baseAlpha = matteAt(imageUv);
	return vec4(raw.rgb, baseAlpha * authoredAlphaMatteAt(imageUv, baseAlpha));
}
float meshValueAt(int row, int col) {
	int rows = int(max(1.0, uMeshShape.x));
	int cols = int(max(1.0, uMeshShape.y));
	int r = clamp(row, 0, rows - 1);
	int c = clamp(col, 0, cols - 1);
	return uMeshValues[r * 8 + c];
}
float meshField(vec2 uv) {
	int rows = int(max(1.0, uMeshShape.x));
	int cols = int(max(1.0, uMeshShape.y));
	vec2 grid = clamp(uv, 0.0, 1.0) * vec2(float(cols - 1), float(rows - 1));
	int c0 = int(floor(grid.x));
	int r0 = int(floor(grid.y));
	int c1 = min(c0 + 1, cols - 1);
	int r1 = min(r0 + 1, rows - 1);
	vec2 f = fract(grid);
	float top = mix(meshValueAt(r0, c0), meshValueAt(r0, c1), f.x);
	float bottom = mix(meshValueAt(r1, c0), meshValueAt(r1, c1), f.x);
	return mix(top, bottom, f.y);
}
vec4 sampledContourSource(
	vec2 uv,
	float reach,
	out float sourceBand,
	out float edgeProximity,
	out vec2 edgeNormal
) {
	vec4 best = sourceAt(uv);
	float localAlpha = best.a;
	bool localInside = localAlpha > 0.02;
	float bestAlpha = best.a;
	float band = best.a;
	float nearestBoundary = reach;
	vec2 normalSum = vec2(0.0);
	float normalWeight = 0.0;
	vec2 dirs[12] = vec2[12](
		vec2(1.0, 0.0), vec2(0.866, 0.5), vec2(0.5, 0.866), vec2(0.0, 1.0),
		vec2(-0.5, 0.866), vec2(-0.866, 0.5), vec2(-1.0, 0.0), vec2(-0.866, -0.5),
		vec2(-0.5, -0.866), vec2(0.0, -1.0), vec2(0.5, -0.866), vec2(0.866, -0.5)
	);
	for (int ring = 1; ring <= CONTOUR_RING_STEPS; ring++) {
		float t = float(ring) / float(CONTOUR_RING_STEPS);
		float w = 1.0 - t * 0.82;
		for (int i = 0; i < 12; i++) {
			vec2 sampleUv = clamp(uv + dirs[i] * reach * t, 0.0, 1.0);
			vec4 s = sourceAt(sampleUv);
			float candidate = s.a * w;
			band = max(band, candidate);
			bool sampleInside = s.a > 0.02;
			if (sampleInside != localInside) {
				nearestBoundary = min(nearestBoundary, reach * t);
				float weight = 1.0 - t * 0.7;
				normalSum += (localInside ? dirs[i] : -dirs[i]) * weight;
				normalWeight += weight;
			}
			if (s.a > bestAlpha) {
				best = s;
				bestAlpha = s.a;
			}
		}
	}
	float eps = max(0.0015, reach * 0.08);
	vec2 grad = vec2(
		sourceAt(clamp(uv + vec2(eps, 0.0), 0.0, 1.0)).a -
			sourceAt(clamp(uv - vec2(eps, 0.0), 0.0, 1.0)).a,
		sourceAt(clamp(uv + vec2(0.0, eps), 0.0, 1.0)).a -
			sourceAt(clamp(uv - vec2(0.0, eps), 0.0, 1.0)).a
	);
	float gradLength = length(grad);
	if (gradLength > 1e-4) {
		normalSum += (-grad / gradLength) * 2.0;
		normalWeight += 2.0;
	}
	sourceBand = clamp(band, 0.0, 1.0);
	float normalizedBoundary = clamp(nearestBoundary / max(reach, 1e-4), 0.0, 1.0);
	edgeProximity = 1.0 - normalizedBoundary;
	edgeNormal = normalWeight > 0.0 ? normalize(normalSum) : vec2(-1.0, 0.0);
	return best;
}
float alphaSpanField(vec2 uv, vec2 dir) {
	float localAlpha = sourceAt(uv).a;
	bool localInside = localAlpha > 0.02;
	float negDistance = 1.42;
	float posDistance = 1.42;
	bool negFound = false;
	bool posFound = false;
	for (int step = 1; step <= ALPHA_SPAN_STEPS; step++) {
		float t = 1.42 * float(step) / float(ALPHA_SPAN_STEPS);
		float negAlpha = sourceAt(clamp(uv - dir * t, 0.0, 1.0)).a;
		float posAlpha = sourceAt(clamp(uv + dir * t, 0.0, 1.0)).a;
		bool negInside = negAlpha > 0.02;
		bool posInside = posAlpha > 0.02;
		if (localInside) {
			if (!negFound && !negInside) {
				negFound = true;
				negDistance = t;
			}
			if (!posFound && !posInside) {
				posFound = true;
				posDistance = t;
			}
		} else {
			if (!negFound && negInside) {
				negFound = true;
				negDistance = t;
			}
			if (!posFound && posInside) {
				posFound = true;
				posDistance = t;
			}
		}
	}
	if (localInside) {
		return clamp(negDistance / max(negDistance + posDistance, 1e-4), 0.0, 1.0);
	}
	if (negFound && !posFound) return 1.0;
	if (!negFound && posFound) return 0.0;
	if (negFound && posFound) return negDistance < posDistance ? 1.0 : 0.0;
	return clamp(dot(uv - vec2(0.5), dir) + 0.5, 0.0, 1.0);
}
// Projects in object-pixel-proportional space (uv and axis scaled by the object's
// own width/height) so an authored diagonal field lands at the same normalized
// offset the SVG ramp computes (filterLinearRampGeometry, which builds the
// gradient in bounds.width/bounds.height pixel space). A plain UV-space dot
// product would be isotropic and disagree with SVG on non-square objects.
float authoredLinearFieldPosition(vec2 uv) {
	vec2 from = uLinearField.xy;
	vec2 to = uLinearField.zw;
	vec2 axis = (to - from) * uLinearFieldAspect;
	vec2 p = (uv - from) * uLinearFieldAspect;
	float axisLength = dot(axis, axis);
	if (axisLength <= 1e-6) return 0.0;
	return dot(p, axis) / axisLength;
}
float contourGeneratedAlpha(vec2 uv, float edgeProximity, float edgeArcMask) {
	float edgeNoise = fbm(vec3(uv * 5.5 + uSeed * 0.011, uEvolution * 0.25));
	float warpedProximity = clamp(
		edgeProximity + (edgeNoise - 0.5) * 0.24 * edgeArcMask,
		0.0,
		1.0
	);
	float boundaryFade = smoothstep(
		0.02,
		0.96,
		pow(warpedProximity, 0.74)
	);
	float fadeAmount = mix(0.18, 0.98, clamp(uStrength, 0.0, 1.0));
	return clamp(1.0 - edgeArcMask * boundaryFade * fadeAmount, 0.0, 1.0);
}
void main() {
	vec2 iv = vec2(vUv.x, 1.0 - vUv.y);
	float baseLocalAlpha = matteAt(iv);
	float authoredMatte = authoredAlphaMatteAt(iv, baseLocalAlpha);
	if (uMatteKind != MATTE_NONE && !uParticleEnabled) {
		if (baseLocalAlpha <= 0.001) {
			outColor = uTransparentOutput ? vec4(0.0) : vec4(uClipColor, 1.0);
			return;
		}
		vec4 raw = rawAt(iv);
		vec3 foregroundRgb = foregroundRgbAt(iv, raw.rgb, baseLocalAlpha);
		float displayAlpha = clamp(baseLocalAlpha * authoredMatte, 0.0, 1.0);
		outColor = uTransparentOutput
			? vec4(foregroundRgb, displayAlpha)
			: vec4(mix(uClipColor, foregroundRgb, displayAlpha), 1.0);
		return;
	}
	float sourceBand = 0.0;
	float edgeProximity = 0.0;
	vec2 edgeNormal = vec2(-1.0, 0.0);
	float reach = mix(0.012, 0.38, clamp(uStrength, 0.0, 1.0));
	vec4 source = sampledContourSource(iv, reach, sourceBand, edgeProximity, edgeNormal);
	if (source.a <= 0.001 && sourceBand <= 0.001) {
		outColor = uTransparentOutput ? vec4(0.0) : vec4(uClipColor, 1.0);
			return;
		}
		float reconstructedAlpha = foregroundAlphaAt(iv, source.rgb);
		float localAlpha = reconstructedAlpha * authoredMatte;
		source = vec4(
			foregroundRgbAt(iv, source.rgb, reconstructedAlpha),
			max(source.a, localAlpha)
		);
	float insideSource = smoothstep(0.02, 0.2, localAlpha);
	float outsideSource = 1.0 - insideSource;
	float radians = uAngle * PI / 180.0;
	vec2 dir = vec2(cos(radians), sin(radians));
	float edgeArcMask = uContourFocused
		? smoothstep(0.18, 0.72, dot(edgeNormal, dir))
		: 1.0;
	float boundaryFeather = smoothstep(0.12, 0.86, edgeProximity);
	float contourBand = pow(clamp(edgeProximity, 0.0, 1.0), 1.1);
	float insideContourArc = contourBand * edgeArcMask * insideSource;
	float outsideContourArc = pow(clamp(edgeProximity, 0.0, 1.0), 5.0) *
		edgeArcMask * outsideSource;
	float contourArc = insideContourArc + outsideContourArc * 0.08;
	float activation = contourArc;
	float solidDissolveActivation = insideContourArc;
	float particleFrequency = mix(420.0, 1350.0, clamp(uScale, 0.0, 4.0) / 4.0);
	vec2 particleCell = floor(iv * particleFrequency);
	float noise = hash(vec3(particleCell + uSeed * 0.17, floor(uEvolution * 17.0) + uSeed * 0.013));
	float densityMod = mix(0.78, 1.18, fbm(vec3(iv * 7.0 + uSeed * 0.003, uEvolution)));
	float particleSoftness = mix(0.006, 0.0008, clamp(uContrast, 0.0, 1.0));
	float bias = clamp(uDensityBias, 0.0, 1.0);
	if (uFieldMode == 0) {
		if (uMatteKind != MATTE_NONE) {
			float baseInside = smoothstep(0.02, 0.12, baseLocalAlpha);
			float mattePosition = clamp(authoredMatte, 0.0, 1.0);
			float solidCore = baseInside * smoothstep(0.86, 0.965, mattePosition);
			float transitionBand = baseInside *
				smoothstep(0.015, 0.18, mattePosition) *
				(1.0 - smoothstep(0.94, 1.0, mattePosition));
			float particleDensity = clamp(
				pow(mattePosition, 0.82) *
					(0.82 + bias * 0.2) *
					densityMod,
				0.0,
				0.985
			);
			float particleCoverage = smoothstep(
				0.0,
				particleSoftness,
				particleDensity - noise
			);
			float displayAlpha = clamp(
				max(solidCore, particleCoverage * transitionBand),
				0.0,
				1.0
			);
			outColor = uTransparentOutput
				? vec4(source.rgb, displayAlpha)
				: vec4(mix(uClipColor, source.rgb, displayAlpha), 1.0);
			return;
		}
		float generatedAlpha = contourGeneratedAlpha(iv, edgeProximity, edgeArcMask);
		float insideRange = smoothstep(0.018, 0.08, localAlpha);
		float alphaField = min(localAlpha, generatedAlpha) * insideRange;
		float outsideAlpha = outsideContourArc *
			mix(0.02, 0.2, clamp(uStrength, 0.0, 1.0)) *
			smoothstep(0.04, 0.3, sourceBand);
		float displayAlpha = clamp(
			max(alphaField, outsideAlpha),
			0.0,
			1.0
		);
		outColor = uTransparentOutput
			? vec4(source.rgb, displayAlpha)
			: vec4(mix(uClipColor, source.rgb, displayAlpha), 1.0);
		return;
	}
	if (uFieldMode == 1) {
		if (uLinearFieldAuthored) {
			float position = authoredLinearFieldPosition(iv);
			float plateau = clamp(uLinearFieldPlateau, 0.0, 0.99);
			float fieldFade = smoothstep(plateau, 1.0, position);
			float contourActivation = edgeProximity * fieldFade;
			activation = max(contourActivation, fieldFade * insideSource * edgeProximity * 0.08);
			solidDissolveActivation = contourActivation;
		} else {
			float spanField = alphaSpanField(iv, dir);
			float directionalWidth = mix(0.12, 0.62, clamp(uStrength, 0.0, 1.0));
			float sideActivation = smoothstep(1.0 - directionalWidth, 1.0, spanField);
			float contourSide = smoothstep(0.22, 0.96, spanField);
			float contourActivation = edgeProximity * contourSide;
			activation = max(contourActivation, sideActivation * insideSource * edgeProximity * 0.08);
			solidDissolveActivation = contourActivation;
		}
	} else if (uFieldMode == 2) {
		activation = meshField(iv) * max(sourceBand, edgeProximity);
		solidDissolveActivation = activation;
	}
	float dissolveActivation = clamp(solidDissolveActivation * densityMod, 0.0, 1.0);
	float particleActivation = clamp(activation * densityMod, 0.0, 1.0);
	float eraseDensity = clamp(
		pow(dissolveActivation, 0.72) * (0.9 + bias * 0.09),
		0.0,
		0.985
	);
	float dissolveMask = smoothstep(0.0, particleSoftness, eraseDensity - noise);
	float particleDensity = clamp(
		particleActivation * (0.44 + bias * 0.18) +
			outsideSource * boundaryFeather * edgeArcMask * 0.12,
		0.0,
		0.78
	);
	float particleCoverage = smoothstep(0.0, particleSoftness, particleDensity - noise);
	float particleAlphaScale = mix(1.0, 0.68, outsideSource);
	float solidCore = localAlpha * (1.0 - dissolveMask);
	float coverage = max(solidCore, particleCoverage * particleAlphaScale);
	float outputAlpha = source.a * coverage;
	float displayAlpha = smoothstep(0.42, 0.56, outputAlpha);
	outColor = uTransparentOutput
		? vec4(source.rgb, displayAlpha)
		: vec4(mix(uClipColor, source.rgb, displayAlpha), 1.0);
}`;

/**
 * Noise Source frequency numerator: `uScale = NOISE_SOURCE_FREQ_NUMERATOR / scale`, so a
 * bigger user-facing Scale gives broader features (the noise-family convention). 180 puts ~6
 * noise periods across the frame at the default Scale 30, roughly matching the SVG node.
 */
const NOISE_SOURCE_FREQ_NUMERATOR = 180;

/** A single-draw effect mode (one fullscreen UV-remap). `glow` is multi-draw, not here. */
type SingleDrawMode = Exclude<RasterEffectMode, "glow">;

const FRAGMENT_SHADER: Record<SingleDrawMode, string> = {
	lens: FRAGMENT_SHADER_LENS,
	kaleidoscope: FRAGMENT_SHADER_KALEIDOSCOPE,
	flow: FRAGMENT_SHADER_FLOW,
	halftone: FRAGMENT_SHADER_HALFTONE,
	riso: FRAGMENT_SHADER_RISO,
	"pixel-grid": FRAGMENT_SHADER_PIXEL_GRID,
	"ordered-dither": FRAGMENT_SHADER_ORDERED_DITHER,
	"ascii-glyph": FRAGMENT_SHADER_ASCII_GLYPH,
	"block-mosaic": FRAGMENT_SHADER_BLOCK_MOSAIC,
	"noise-source": FRAGMENT_SHADER_NOISE_SOURCE,
	"particle-dissolve": FRAGMENT_SHADER_PARTICLE_DISSOLVE,
	"path-blur": FRAGMENT_SHADER_PATH_BLUR,
	colorama: FRAGMENT_SHADER_COLORAMA,
	"wave-warp": FRAGMENT_SHADER_WAVE_WARP,
	"bend-warp": FRAGMENT_SHADER_BEND_WARP,
	"vhs-color": FRAGMENT_SHADER_VHS_COLOR,
	"vhs-tracking": FRAGMENT_SHADER_VHS_TRACKING,
	"vhs-noise": FRAGMENT_SHADER_VHS_NOISE,
	"crt-display": FRAGMENT_SHADER_CRT_DISPLAY,
	"signal-glitch": FRAGMENT_SHADER_SIGNAL_GLITCH,
	interlace: FRAGMENT_SHADER_INTERLACE,
};

// --- Glow (AE Deep Glow), a multi-draw composite pass ------------------------------
//
// extract → downsample pyramid → blur each level → additive upsample → screen composite.
// Browser-proven before this code: a single wide blur at full resolution *ghosts* (the
// 9-tap kernel undersamples at large spacing), so each level is blurred at its own
// reduced resolution where tight taps cover a wide area smoothly, then bilinearly
// upsampled and summed (a tight core through a wide halo). The scratch is CLAMP_TO_EDGE —
// REPEAT would wrap a bright edge's halo onto the opposite edge.

/** Per-tap blur spacing in level-texels: `GLOW_TAP_MIN + radius·GLOW_TAP_RANGE`. */
const GLOW_TAP_MIN = 1;
const GLOW_TAP_RANGE = 0.75;
/** Build pyramid levels down to ~this size, so halo reach scales with the frame. */
const GLOW_MIN_LEVEL_PX = 20;
/** Cap the pyramid depth (bounds scratch-buffer count). */
const GLOW_MAX_LEVELS = 6;
/** `chroma` (0..1) maps to this max radial UV split for the chromatic-aberration fringe. */
const GLOW_CHROMA_SCALE = 0.06;
/**
 * Positive octave weights fitted to a regularized inverse-square-like tail.
 * Radius biases energy toward wider octaves, but the normalized sum stays one
 * so Radius owns reach while Exposure owns energy.
 */
const GLOW_POWER_LAW_WEIGHTS = [
	0.3, 0.22, 0.16, 0.12, 0.085, 0.06, 0.035,
] as const;

const glowBandWeights = (
	levelCount: number,
	radius: number,
): readonly number[] => {
	const spreadBias = 0.8 + Math.min(1, Math.max(0, radius)) * 0.5;
	const raw = GLOW_POWER_LAW_WEIGHTS.slice(0, levelCount).map(
		(weight, index) => weight * spreadBias ** index,
	);
	const sum = raw.reduce((total, weight) => total + weight, 0);
	return raw.map((weight) => weight / Math.max(sum, Number.EPSILON));
};

/**
 * Extract post-material radiance in linear light. The soft knee prevents a
 * bright gradient from turning into a hard threshold contour, while alpha is
 * used only as coverage — opaque dark pixels never emit merely because they
 * belong to a target.
 */
const FRAGMENT_GLOW_EXTRACT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uThreshold;
vec3 srgbToLinear(vec3 c) {
	vec3 low = c / 12.92;
	vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
	return mix(low, high, step(vec3(0.04045), c));
}
float srgbChannelToLinear(float c) {
	return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
void main() {
	vec4 c = texture(uTex, vUv);
	vec3 linearRgb = srgbToLinear(max(c.rgb, vec3(0.0)));
	float luminance = dot(linearRgb, vec3(0.2126, 0.7152, 0.0722));
	float threshold = srgbChannelToLinear(clamp(uThreshold, 0.0, 1.0));
	float knee = max(0.002, 0.18 * max(threshold, 0.01));
	float excess = luminance - threshold;
	float soft = clamp(excess + knee, 0.0, 2.0 * knee);
	soft = soft * soft / max(4.0 * knee, 1e-5);
	float contribution = max(excess, soft) / max(luminance, 1e-5);
	contribution = clamp(contribution, 0.0, 1.0) * c.a;
	outColor = vec4(linearRgb * contribution, contribution);
}`;

/** Separable 9-tap Gaussian; `uStep` carries direction and per-tap spacing (in UV). */
const FRAGMENT_GLOW_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uStep;
const float W[5] = float[5](0.227027, 0.194595, 0.121622, 0.054054, 0.016216);
void main() {
	vec4 s = texture(uTex, vUv) * W[0];
	for (int i = 1; i < 5; i++) {
		vec2 o = uStep * float(i);
		s += texture(uTex, vUv + o) * W[i];
		s += texture(uTex, vUv - o) * W[i];
	}
	outColor = s;
}`;

/** Plain copy used to downsample one pyramid level into the next. */
const FRAGMENT_GLOW_COPY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
	outColor = texture(uTex, vUv);
}`;

/** Places one cached artboard-space crop through the current transform delta. */
const FRAGMENT_STATIC_LAYER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uArtboardSize;
uniform vec4 uLayerBounds;
uniform mat3 uInverseDelta;
void main() {
	vec2 currentPoint = vUv * uArtboardSize;
	vec2 restPoint = (uInverseDelta * vec3(currentPoint, 1.0)).xy;
	vec2 layerUv = (restPoint - uLayerBounds.xy) / uLayerBounds.zw;
	if (layerUv.x < 0.0 || layerUv.x > 1.0 || layerUv.y < 0.0 || layerUv.y > 1.0) discard;
	outColor = texture(uTex, layerUv);
}`;

/**
 * Weighted tent reconstruction of one octave into the full-resolution HDR
 * field. The 3x3 kernel prevents a very small bright source from exposing the
 * deepest pyramid level's coarse texel footprint as a rectangle or column.
 */
const FRAGMENT_GLOW_ACCUMULATE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uWeight;
uniform vec2 uTexel;
void main() {
	vec4 sampleValue = texture(uTex, vUv) * 4.0;
	sampleValue += texture(uTex, vUv + vec2(uTexel.x, 0.0)) * 2.0;
	sampleValue += texture(uTex, vUv - vec2(uTexel.x, 0.0)) * 2.0;
	sampleValue += texture(uTex, vUv + vec2(0.0, uTexel.y)) * 2.0;
	sampleValue += texture(uTex, vUv - vec2(0.0, uTexel.y)) * 2.0;
	sampleValue += texture(uTex, vUv + uTexel);
	sampleValue += texture(uTex, vUv - uTexel);
	sampleValue += texture(uTex, vUv + vec2(uTexel.x, -uTexel.y));
	sampleValue += texture(uTex, vUv + vec2(-uTexel.x, uTexel.y));
	outColor = sampleValue * (uWeight / 16.0);
}`;

/**
 * Separable + non-separable Porter-Duff blend modes (W3C compositing spec), shared GLSL
 * reused wherever the GPU pipeline composites a layer over a backdrop. `uBlend` indexes
 * the mode (see `BLEND_MODE_INDEX`). Glow compositing (below) is the first consumer; the
 * same prelude can drive a general blended-layer composite later.
 */
const GLSL_BLEND_PRELUDE = `
float blendOne(int m, float b, float s) {
	if (m == 1) return b * s;                                              // multiply
	if (m == 2) return b + s - b * s;                                      // screen
	if (m == 3) return b <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); // overlay
	if (m == 4) return min(b, s);                                          // darken
	if (m == 5) return max(b, s);                                          // lighten
	if (m == 6) return s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s));           // color-dodge
	if (m == 7) return s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s);     // color-burn
	if (m == 8) return s <= 0.5 ? 2.0 * s * b : 1.0 - 2.0 * (1.0 - s) * (1.0 - b); // hard-light
	if (m == 9) {                                                          // soft-light
		if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
		float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
		return b + (2.0 * s - 1.0) * (d - b);
	}
	if (m == 10) return abs(b - s);                                        // difference
	if (m == 11) return b + s - 2.0 * b * s;                               // exclusion
	return s;                                                              // normal
}
float blum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 bclip(vec3 c) {
	float l = blum(c);
	float n = min(min(c.r, c.g), c.b);
	float x = max(max(c.r, c.g), c.b);
	if (n < 0.0) c = l + (c - l) * l / (l - n + 1e-6);
	if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l + 1e-6);
	return c;
}
vec3 bsetlum(vec3 c, float l) { return bclip(c + (l - blum(c))); }
float bsat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 bsetsat(vec3 c, float s) {
	float mn = min(min(c.r, c.g), c.b);
	float mx = max(max(c.r, c.g), c.b);
	return mx > mn ? (c - mn) / (mx - mn) * s : vec3(0.0);
}
vec3 blendVec(int m, vec3 b, vec3 s) {
	if (m == 12) return bsetlum(bsetsat(s, bsat(b)), blum(b));   // hue
	if (m == 13) return bsetlum(bsetsat(b, bsat(s)), blum(b));   // saturation
	if (m == 14) return bsetlum(s, blum(b));                      // color
	if (m == 15) return bsetlum(b, blum(s));                      // luminosity
	return vec3(blendOne(m, b.r, s.r), blendOne(m, b.g, s.g), blendOne(m, b.b, s.b));
}
// Modes where blend(b, 0) == b can composite at full strength; the rest composite by
// glow coverage so dark transparent areas keep the backdrop instead of being crushed
// (e.g. multiply against black).
float blendCoverage(int m, vec3 g) {
	if (m == 2 || m == 5 || m == 6 || m == 10 || m == 11) return 1.0;
	return clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0);
}`;

/**
 * Composite: exposure-gain the HDR glow, split it into a radial chromatic-aberration
 * fringe (red sampled outward, blue inward — the signature Deep Glow colour bleed), then
 * blend it over the original frame using `uBlend` (Screen by default, AE Deep Glow's
 * Blend Mode). `uGlow` is the float reconstruction, so the core can sum past 1 and blow out
 * smoothly under exposure.
 */
const FRAGMENT_GLOW_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uBase;
uniform sampler2D uGlow;
uniform sampler2D uBlueNoise;
uniform float uIntensity;
uniform float uChroma;
uniform int uBlend;
${GLSL_BLEND_PRELUDE}
vec3 srgbToLinear(vec3 c) {
	vec3 low = c / 12.92;
	vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
	return mix(low, high, step(vec3(0.04045), c));
}
vec3 linearToSrgb(vec3 c) {
	vec3 low = c * 12.92;
	vec3 high = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
	return mix(low, high, step(vec3(0.0031308), c));
}
void main() {
	vec4 base = texture(uBase, vUv);
	vec3 b = srgbToLinear(max(base.rgb, vec3(0.0)));
	vec2 d = vUv - 0.5;
	vec4 glowR = texture(uGlow, 0.5 + d * (1.0 + uChroma));
	vec4 glowG = texture(uGlow, vUv);
	vec4 glowB = texture(uGlow, 0.5 + d * (1.0 - uChroma));
	// Stored Intensity is an exposure control, not a linear opacity. Keep zero
	// truly off, preserve a readable default, and leave deliberate headroom for
	// broad low-energy tails at the upper end of the existing 0..4 range.
	float exposureGain = max((exp2(max(uIntensity, 0.0) * 1.5) - 1.0) * 3.0, 0.0);
	vec3 g = vec3(glowR.r, glowG.g, glowB.b) * exposureGain;
	g = clamp(g, 0.0, 1.0);
	vec3 blended = blendVec(uBlend, b, g);
	float coverage = blendCoverage(uBlend, g);
	float glowAlpha = clamp(max(max(glowR.a, glowG.a), glowB.a) * exposureGain, 0.0, 1.0);
	float outAlpha = max(base.a, glowAlpha * coverage);
	vec3 linearRgb = outAlpha > 1e-5
		? clamp(mix(b * base.a, blended, coverage) / outAlpha, 0.0, 1.0)
		: vec3(0.0);
	vec3 displayRgb = linearToSrgb(linearRgb);
	float dither = texture(uBlueNoise, gl_FragCoord.xy / 64.0).r - 0.5;
	displayRgb = clamp(displayRgb + vec3(dither / 255.0), 0.0, 1.0);
	outColor = vec4(displayRgb, outAlpha);
}`;

/**
 * Layer composite: blend two full GPU branches (`uBase` backdrop, `uOverlay` top) with a
 * blend mode and `uMix` opacity — the general "stack raster layers with a draw mode"
 * primitive that backs a GPU `composite` node. Reuses the shared blend library.
 */
const FRAGMENT_BLEND_LAYER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uBase;
uniform sampler2D uOverlay;
uniform int uBlend;
uniform float uMix;
${GLSL_BLEND_PRELUDE}
void main() {
	vec4 base = texture(uBase, vUv);
	vec4 overlay = texture(uOverlay, vUv);
	vec3 blended = blendVec(uBlend, base.rgb, overlay.rgb);
	float sourceAlpha = clamp(overlay.a * uMix, 0.0, 1.0);
	float outAlpha = sourceAlpha + base.a * (1.0 - sourceAlpha);
	vec3 outPremul = blended * sourceAlpha + base.rgb * base.a * (1.0 - sourceAlpha);
	outColor = vec4(outAlpha > 1e-5 ? clamp(outPremul / outAlpha, 0.0, 1.0) : vec3(0.0), outAlpha);
}`;

function compileShader(
	gl: WebGL2RenderingContext,
	type: number,
	source: string,
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function linkProgram(
	gl: WebGL2RenderingContext,
	fragmentSource: string,
): WebGLProgram | null {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	if (!vertex || !fragment) return null;
	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	// The shaders are linked into the program; the standalone objects are no longer needed.
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}
	return program;
}

/** Decode an SVG string to an `<img>` via a data-URL (untainted, Safari-safe). */
async function decodeSvgImage(svg: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	return image;
}

/** Locations of every uniform a shader might use (absent ones are `null` = no-op). */
type ProgramUniforms = Record<
	| "uCenter"
	| "uResolution"
	| "uAspect"
	| "uRadius"
	| "uConvergence"
	| "uClipToRim"
	| "uTransparentOutput"
	| "uClipColor"
	| "uSegments"
	| "uRoll"
	| "uAmount"
	| "uScale"
	| "uGap"
	| "uRoundness"
	| "uBevel"
	| "uRelief"
	| "uBrightness"
	| "uLightElevation"
	| "uMatrixSize"
	| "uLevels"
	| "uMode"
	| "uGlyphScale"
	| "uInvert"
	| "uEvolution"
	| "uPattern"
	| "uOctaves"
	| "uFieldMode"
	| "uAngle"
	| "uLinearFieldAuthored"
	| "uLinearField"
	| "uLinearFieldAspect"
	| "uLinearFieldPlateau"
	| "uContourFocused"
	| "uParticleEnabled"
	| "uMatteKind"
	| "uMatteLinear"
	| "uMatteRadial"
	| "uMatteContour"
	| "uMatteRotation"
	| "uMatteStopCount"
	| "uMatteStopOffsets"
	| "uMatteStopAlphas"
	| "uStrength"
	| "uContrast"
	| "uDensityBias"
	| "uVariation"
	| "uSeed"
	| "uMeshShape"
	| "uMeshValues"
	| "uThreshold"
	| "uStep"
	| "uWeight"
	| "uTexel"
	| "uIntensity"
	| "uChroma"
	| "uBlend"
	| "uMix"
	| "uSpeed"
	| "uTaps"
	| "uTaper"
	| "uCentered"
	| "uGamma"
	| "uInk"
	| "uPaper"
	| "uYSign"
	| "uGrain"
	| "uBloom"
	| "uFieldStrength"
	| "uRisoFieldMode"
	| "uFieldA"
	| "uFieldB"
	| "uFieldRadius"
	| "uFieldSoftness"
	| "uFieldInvert"
	| "uBlendMode"
	| "uInkCount"
	| "uInkColor"
	| "uInkAngle"
	| "uInkOffset"
	| "uLayerBounds"
	| "uArtboardSize"
	| "uInverseDelta"
	| "uPhase"
	| "uRepetitions"
	| "uInputPhase"
	| "uPreserveSourceAlpha"
	| "uRampCount"
	| "uRampOffset"
	| "uRampColor"
	| "uBend"
	| "uDistortionH"
	| "uDistortionV"
	| "uBleed"
	| "uSubsample"
	| "uColorUnder"
	| "uJitter"
	| "uWobble"
	| "uTear"
	| "uBand"
	| "uBandPosition"
	| "uSnow"
	| "uDropout"
	| "uDropoutLength"
	| "uGeneration"
	| "uMaskType"
	| "uMaskScale"
	| "uMaskStrength"
	| "uCurvature"
	| "uCornerRadius"
	| "uVignette"
	| "uChannelShift"
	| "uRollAmount"
	| "uTearDensity"
	| "uTearStrength"
	| "uFieldOffset"
	| "uFlicker",
	WebGLUniformLocation | null
>;

type CachedProgram = {
	readonly program: WebGLProgram;
	readonly uniforms: ProgramUniforms;
};

type FboTarget = {
	readonly texture: WebGLTexture;
	readonly framebuffer: WebGLFramebuffer;
};

const invertRasterMatrix = (
	matrix: RasterLayerMatrix,
): RasterLayerMatrix | null => {
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10)
		return null;
	return {
		a: matrix.d / determinant,
		b: -matrix.b / determinant,
		c: -matrix.c / determinant,
		d: matrix.a / determinant,
		e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
		f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
	};
};

const multiplyRasterMatrices = (
	left: RasterLayerMatrix,
	right: RasterLayerMatrix,
): RasterLayerMatrix => ({
	a: left.a * right.a + left.c * right.b,
	b: left.b * right.a + left.d * right.b,
	c: left.a * right.c + left.c * right.d,
	d: left.b * right.c + left.d * right.d,
	e: left.a * right.e + left.c * right.f + left.e,
	f: left.b * right.e + left.d * right.f + left.f,
});

const rasterMatrixUniform = (matrix: RasterLayerMatrix): Float32Array =>
	new Float32Array([
		matrix.a,
		matrix.b,
		0,
		matrix.c,
		matrix.d,
		0,
		matrix.e,
		matrix.f,
		1,
	]);

/**
 * Apply LINEAR sampling with the given wrap to the currently-bound 2D texture. The
 * source/ping-pong textures use REPEAT (kaleidoscope/flow sample outside [0,1]; the lens
 * never overshoots, so REPEAT is safe for it too). The glow scratch textures must use
 * CLAMP_TO_EDGE — the blur samples neighbours, and REPEAT would wrap a bright edge's halo
 * onto the opposite edge.
 */
function configureTexture(gl: WebGL2RenderingContext, wrap: number): void {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

/**
 * Create a GPU raster surface, or `null` if WebGL2 is unavailable (the caller then
 * keeps showing the plain SVG layer). One surface runs any chain of effects: shader
 * programs are compiled and cached per mode on demand, and multi-pass chains ping-pong
 * through two framebuffers. The source SVG is decoded once and cached by string.
 */
export function createGpuRasterSurface(
	width: number,
	height: number,
	options: GpuRasterSurfaceOptions = {},
): GpuRasterSurface | null {
	const transparentOutput = options.transparentOutput === true;
	const preserveSourceAlpha =
		options.preserveSourceAlphaThroughGenerators === true;
	const preferLowMemory = options.preferLowMemory === true;
	const preserveDrawingBuffer =
		options.preserveDrawingBuffer ?? !preferLowMemory;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: false,
		powerPreference: preferLowMemory ? "low-power" : "high-performance",
		preserveDrawingBuffer,
	});
	if (!gl) return null;
	setFrameDiagnosticGauge("gpu.backingWidth", canvas.width);
	setFrameDiagnosticGauge("gpu.backingHeight", canvas.height);
	setFrameDiagnosticGauge("gpu.liveSourceTextures", 2);

	// Fullscreen triangle bound to attribute location 0 (fixed in the vertex shader),
	// so every cached program shares this one vertex setup.
	const positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

	const sourceTexture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
	configureTexture(gl, gl.REPEAT);
	const scopedEmissionTexture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, scopedEmissionTexture);
	configureTexture(gl, gl.CLAMP_TO_EDGE);

	// Programs are keyed by a string (an effect mode, or a glow sub-shader like
	// `glow:blur`) and compiled on demand. Sampler units are pinned here once: `uTex`/
	// `uBase` → unit 0, `uGlow` → unit 1.
	const programs = new Map<string, CachedProgram>();
	const getProgram = (key: string, source: string): CachedProgram | null => {
		const cached = programs.get(key);
		if (cached) return cached;
		const program = linkProgram(gl, source);
		if (!program) return null;
		// biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook.
		gl.useProgram(program);
		const u = (name: string) => gl.getUniformLocation(program, name);
		const bindSampler = (name: string, unit: number): void => {
			const loc = u(name);
			if (loc) gl.uniform1i(loc, unit);
		};
		bindSampler("uTex", 0);
		bindSampler("uBase", 0);
		bindSampler("uGlow", 1);
		bindSampler("uOverlay", 1);
		bindSampler("uPathBlurMap", 2);
		bindSampler("uBlueNoise", 3);
		const entry: CachedProgram = {
			program,
			uniforms: {
				uCenter: u("uCenter"),
				uResolution: u("uResolution"),
				uAspect: u("uAspect"),
				uRadius: u("uRadius"),
				uConvergence: u("uConvergence"),
				uClipToRim: u("uClipToRim"),
				uTransparentOutput: u("uTransparentOutput"),
				uClipColor: u("uClipColor"),
				uSegments: u("uSegments"),
				uRoll: u("uRoll"),
				uAmount: u("uAmount"),
				uScale: u("uScale"),
				uGrain: u("uGrain"),
				uBloom: u("uBloom"),
				uFieldStrength: u("uFieldStrength"),
				uRisoFieldMode: u("uRisoFieldMode"),
				uFieldA: u("uFieldA"),
				uFieldB: u("uFieldB"),
				uFieldRadius: u("uFieldRadius"),
				uFieldSoftness: u("uFieldSoftness"),
				uFieldInvert: u("uFieldInvert"),
				uBlendMode: u("uBlendMode"),
				uInkCount: u("uInkCount"),
				uInkColor: u("uInkColor[0]"),
				uInkAngle: u("uInkAngle[0]"),
				uInkOffset: u("uInkOffset[0]"),
				uGap: u("uGap"),
				uRoundness: u("uRoundness"),
				uBevel: u("uBevel"),
				uRelief: u("uRelief"),
				uBrightness: u("uBrightness"),
				uLightElevation: u("uLightElevation"),
				uMatrixSize: u("uMatrixSize"),
				uLevels: u("uLevels"),
				uMode: u("uMode"),
				uGlyphScale: u("uGlyphScale"),
				uInvert: u("uInvert"),
				uEvolution: u("uEvolution"),
				uPattern: u("uPattern"),
				uOctaves: u("uOctaves"),
				uFieldMode: u("uFieldMode"),
				uAngle: u("uAngle"),
				uLinearFieldAuthored: u("uLinearFieldAuthored"),
				uLinearField: u("uLinearField"),
				uLinearFieldAspect: u("uLinearFieldAspect"),
				uLinearFieldPlateau: u("uLinearFieldPlateau"),
				uContourFocused: u("uContourFocused"),
				uParticleEnabled: u("uParticleEnabled"),
				uMatteKind: u("uMatteKind"),
				uMatteLinear: u("uMatteLinear"),
				uMatteRadial: u("uMatteRadial"),
				uMatteContour: u("uMatteContour"),
				uMatteRotation: u("uMatteRotation"),
				uMatteStopCount: u("uMatteStopCount"),
				uMatteStopOffsets: u("uMatteStopOffsets[0]"),
				uMatteStopAlphas: u("uMatteStopAlphas[0]"),
				uStrength: u("uStrength"),
				uContrast: u("uContrast"),
				uDensityBias: u("uDensityBias"),
				uVariation: u("uVariation"),
				uSeed: u("uSeed"),
				uMeshShape: u("uMeshShape"),
				uMeshValues: u("uMeshValues[0]"),
				uThreshold: u("uThreshold"),
				uStep: u("uStep"),
				uWeight: u("uWeight"),
				uTexel: u("uTexel"),
				uIntensity: u("uIntensity"),
				uChroma: u("uChroma"),
				uBlend: u("uBlend"),
				uMix: u("uMix"),
				uSpeed: u("uSpeed"),
				uTaps: u("uTaps"),
				uTaper: u("uTaper"),
				uCentered: u("uCentered"),
				uGamma: u("uGamma"),
				uInk: u("uInk"),
				uPaper: u("uPaper"),
				uYSign: u("uYSign"),
				uLayerBounds: u("uLayerBounds"),
				uArtboardSize: u("uArtboardSize"),
				uInverseDelta: u("uInverseDelta"),
				uPhase: u("uPhase"),
				uRepetitions: u("uRepetitions"),
				uInputPhase: u("uInputPhase"),
				uPreserveSourceAlpha: u("uPreserveSourceAlpha"),
				uRampCount: u("uRampCount"),
				uRampOffset: u("uRampOffset[0]"),
				uRampColor: u("uRampColor[0]"),
				uBend: u("uBend"),
				uDistortionH: u("uDistortionH"),
				uDistortionV: u("uDistortionV"),
				uBleed: u("uBleed"),
				uSubsample: u("uSubsample"),
				uColorUnder: u("uColorUnder"),
				uJitter: u("uJitter"),
				uWobble: u("uWobble"),
				uTear: u("uTear"),
				uBand: u("uBand"),
				uBandPosition: u("uBandPosition"),
				uSnow: u("uSnow"),
				uDropout: u("uDropout"),
				uDropoutLength: u("uDropoutLength"),
				uGeneration: u("uGeneration"),
				uMaskType: u("uMaskType"),
				uMaskScale: u("uMaskScale"),
				uMaskStrength: u("uMaskStrength"),
				uCurvature: u("uCurvature"),
				uCornerRadius: u("uCornerRadius"),
				uVignette: u("uVignette"),
				uChannelShift: u("uChannelShift"),
				uRollAmount: u("uRollAmount"),
				uTearDensity: u("uTearDensity"),
				uTearStrength: u("uTearStrength"),
				uFieldOffset: u("uFieldOffset"),
				uFlicker: u("uFlicker"),
			},
		};
		programs.set(key, entry);
		return entry;
	};

	// HDR scratch (RGBA16F) lets the glow pyramid sum past 1.0 so an exposure gain blows the
	// core out smoothly. It needs both a float-renderable target (EXT_color_buffer_float) and
	// LINEAR filtering of half-float (core in WebGL2; this WebGL1-era extension is requested
	// defensively for impls that gate it). If a float FBO still comes back incomplete on this
	// driver, `hdrUsable` flips off and every scratch (re)build uses 8-bit — the glow then
	// clamps at 1.0 (flatter core) but renders correctly rather than going black.
	const floatColorBuffer = preferLowMemory
		? null
		: gl.getExtension("EXT_color_buffer_float");
	if (!preferLowMemory) gl.getExtension("OES_texture_half_float_linear");
	let hdrUsable = !preferLowMemory && floatColorBuffer !== null;
	const createFbo = (
		wrap: number,
		fboWidth: number = canvas.width,
		fboHeight: number = canvas.height,
		hdr = false,
	): FboTarget => {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		const writeStorage = (useFloat: boolean): void => {
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				useFloat ? gl.RGBA16F : gl.RGBA,
				fboWidth,
				fboHeight,
				0,
				gl.RGBA,
				useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
				null,
			);
		};
		let useFloat = hdr && hdrUsable;
		writeStorage(useFloat);
		configureTexture(gl, wrap);
		// biome-ignore lint/style/noNonNullAssertion: createFramebuffer only returns null on context loss.
		const framebuffer = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			texture,
			0,
		);
		if (
			useFloat &&
			gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
		) {
			// Float target not actually usable on this driver — drop to 8-bit here and after.
			hdrUsable = false;
			useFloat = false;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			writeStorage(false);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				texture,
				0,
			);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return { texture, framebuffer };
	};

	// Two ping-pong framebuffer targets (REPEAT), created lazily (only for multi-pass
	// chains) and recreated on resize so they always match the canvas size.
	let ping: readonly [FboTarget, FboTarget] | null = null;
	const disposePing = (): void => {
		if (!ping) return;
		for (const target of ping) {
			gl.deleteTexture(target.texture);
			gl.deleteFramebuffer(target.framebuffer);
		}
		ping = null;
	};

	// Glow scratch: a downsample pyramid. Each level holds the downsampled extract (`down`)
	// and a scratch/reconstruction target (`tmp`). All CLAMP_TO_EDGE so the blur never wraps
	// a bright edge's halo onto the opposite edge. Built lazily, sized to the canvas (deeper
	// pyramid on bigger frames → halo reach scales with the frame).
	type GlowLevel = {
		readonly down: FboTarget;
		readonly tmp: FboTarget;
		readonly width: number;
		readonly height: number;
	};
	let glowFbos: { readonly levels: readonly GlowLevel[] } | null = null;
	const buildGlow = (): { levels: readonly GlowLevel[] } => {
		const levels: GlowLevel[] = [];
		const glowMaxLevels = preferLowMemory ? 4 : GLOW_MAX_LEVELS;
		for (let i = 0; i < glowMaxLevels; i++) {
			const w = canvas.width >> i;
			const h = canvas.height >> i;
			if (i > 0 && (w < GLOW_MIN_LEVEL_PX || h < GLOW_MIN_LEVEL_PX)) break;
			levels.push({
				down: createFbo(gl.CLAMP_TO_EDGE, Math.max(1, w), Math.max(1, h), true),
				tmp: createFbo(gl.CLAMP_TO_EDGE, Math.max(1, w), Math.max(1, h), true),
				width: Math.max(1, w),
				height: Math.max(1, h),
			});
		}
		setFrameDiagnosticGauge("gpu.glowLevelCount", levels.length);
		setFrameDiagnosticGauge("gpu.glowScratchFboCount", levels.length * 2);
		return { levels };
	};
	const disposeGlow = (): void => {
		if (!glowFbos) return;
		const targets: FboTarget[] = [];
		for (const level of glowFbos.levels) targets.push(level.down, level.tmp);
		for (const target of targets) {
			gl.deleteTexture(target.texture);
			gl.deleteFramebuffer(target.framebuffer);
		}
		glowFbos = null;
	};

	// One deterministic blue-noise tile is shared by Ordered Dither and the
	// final Deep Glow display quantization. Keeping it surface-owned prevents a
	// new texture allocation on every glow render.
	let blueNoiseTexture: WebGLTexture | null = null;
	const ensureBlueNoiseTexture = (): void => {
		if (blueNoiseTexture !== null) return;
		blueNoiseTexture = gl.createTexture();
		gl.activeTexture(gl.TEXTURE3);
		gl.bindTexture(gl.TEXTURE_2D, blueNoiseTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.R8,
			BLUE_NOISE_SIZE,
			BLUE_NOISE_SIZE,
			0,
			gl.RED,
			gl.UNSIGNED_BYTE,
			blueNoiseTileBytes(),
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.activeTexture(gl.TEXTURE0);
	};

	// `glow` is multi-draw and never reaches here. Some single-draw modes share
	// centre/aspect uniforms; source/generator and dot-screen modes set only their
	// own shader-specific uniforms.
	const setUniforms = (
		u: ProgramUniforms,
		params: Exclude<RasterEffectParams, GlowParams>,
	): void => {
		if (params.mode === "noise-source") {
			// Feature size → frequency: bigger Scale = broader features. No centre/aspect.
			gl.uniform1f(
				u.uScale,
				NOISE_SOURCE_FREQ_NUMERATOR / Math.max(1, params.scale),
			);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform1i(u.uOctaves, Math.max(1, Math.round(params.octaves)));
			return;
		}
		if (params.mode === "halftone") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uScale, params.cellSize);
			gl.uniform1f(u.uStrength, params.dotSize);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uAngle, params.angleRadians);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "riso") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uScale, params.cellSize);
			gl.uniform1f(u.uStrength, params.dotSize);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uMix, params.mix);
			gl.uniform1f(u.uGrain, params.grain);
			gl.uniform1f(u.uBloom, params.bloomProgress);
			gl.uniform1f(u.uFieldStrength, params.fieldStrength);
			gl.uniform1i(u.uRisoFieldMode, params.fieldMode);
			gl.uniform2f(u.uFieldA, params.fieldA[0], params.fieldA[1]);
			gl.uniform2f(u.uFieldB, params.fieldB[0], params.fieldB[1]);
			gl.uniform1f(u.uFieldRadius, params.fieldRadius);
			gl.uniform1f(u.uFieldSoftness, params.fieldSoftness);
			gl.uniform1i(u.uFieldInvert, params.fieldInvert);
			gl.uniform1i(u.uBlendMode, params.blendMode);
			const inkCount = Math.min(3, Math.max(1, params.inks.length));
			gl.uniform1i(u.uInkCount, inkCount);
			const inkColors = new Float32Array(9);
			const inkAngles = new Float32Array(3);
			const inkOffsets = new Float32Array(6);
			for (let i = 0; i < 3; i++) {
				const ink = params.inks[Math.min(i, params.inks.length - 1)];
				inkColors[i * 3] = ink.colorRgb[0];
				inkColors[i * 3 + 1] = ink.colorRgb[1];
				inkColors[i * 3 + 2] = ink.colorRgb[2];
				inkAngles[i] = ink.angleRadians;
				inkOffsets[i * 2] = ink.offsetPx[0];
				inkOffsets[i * 2 + 1] = ink.offsetPx[1];
			}
			gl.uniform3fv(u.uInkColor, inkColors);
			gl.uniform1fv(u.uInkAngle, inkAngles);
			gl.uniform2fv(u.uInkOffset, inkOffsets);
			return;
		}
		if (params.mode === "pixel-grid") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uScale, params.cellSize);
			gl.uniform1f(u.uGap, params.gap);
			gl.uniform1f(u.uRoundness, params.roundness);
			gl.uniform1f(u.uBrightness, params.brightness);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "ordered-dither") {
			// The blue-noise tile is static: upload once per surface to unit 3 and
			// leave it bound there (restore unit 0 so drawPass's source binding
			// stays the active unit). NEAREST + REPEAT = one exact threshold per
			// cell with seamless tiling.
			ensureBlueNoiseTexture();
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uScale, params.cellSize);
			gl.uniform1i(u.uPattern, params.pattern === "bayer" ? 1 : 0);
			gl.uniform1f(u.uMatrixSize, params.matrixSize);
			gl.uniform1f(u.uLevels, params.levels);
			gl.uniform1i(u.uMode, params.ditherMode === "rgb" ? 1 : 0);
			gl.uniform1f(u.uBrightness, params.brightness);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uGamma, params.gamma);
			gl.uniform1f(u.uThreshold, params.threshold);
			gl.uniform1f(u.uStrength, params.strength);
			gl.uniform3f(u.uInk, params.ink[0], params.ink[1], params.ink[2]);
			gl.uniform3f(u.uPaper, params.paper[0], params.paper[1], params.paper[2]);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "ascii-glyph") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uScale, params.cellSize);
			gl.uniform1f(u.uGlyphScale, params.glyphScale);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uBrightness, params.brightness);
			gl.uniform1f(u.uDensityBias, params.densityBias);
			gl.uniform1i(u.uInvert, params.invert ? 1 : 0);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "block-mosaic") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uScale, params.cellSize);
			gl.uniform1f(u.uGap, params.gap);
			gl.uniform1f(u.uBevel, params.bevel);
			gl.uniform1f(u.uRelief, params.relief);
			gl.uniform1f(u.uAngle, params.lightAngleRadians);
			gl.uniform1f(u.uLightElevation, params.lightElevation);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uVariation, params.variation);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "path-blur") {
			// Upload the direction field to unit 2 (re-upload only when the bytes change), then set
			// the streak scalars. Restore unit 0 so drawPass's source binding stays the active unit.
			if (pathBlurTexture === null) pathBlurTexture = gl.createTexture();
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, pathBlurTexture);
			if (params.field !== lastPathBlurField) {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					params.fieldWidth,
					params.fieldHeight,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					params.field,
				);
				configureTexture(gl, gl.CLAMP_TO_EDGE);
				lastPathBlurField = params.field;
			}
			gl.activeTexture(gl.TEXTURE0);
			gl.uniform1f(u.uSpeed, params.speed);
			gl.uniform1i(u.uTaps, Math.max(1, Math.round(params.taps)));
			gl.uniform1f(u.uTaper, params.taper);
			gl.uniform1i(u.uCentered, params.centered ? 1 : 0);
			return;
		}
		if (params.mode === "particle-dissolve") {
			const values = new Float32Array(PARTICLE_MESH_UNIFORM_CAPACITY);
			for (
				let index = 0;
				index < Math.min(params.meshValues.length, values.length);
				index += 1
			) {
				values[index] = params.meshValues[index] ?? 0;
			}
			const matteStopOffsets = new Float32Array(
				PARTICLE_ALPHA_MATTE_STOP_CAPACITY,
			);
			const matteStopAlphas = new Float32Array(
				PARTICLE_ALPHA_MATTE_STOP_CAPACITY,
			);
			for (
				let index = 0;
				index <
				Math.min(
					params.alphaMatte.stops.length,
					PARTICLE_ALPHA_MATTE_STOP_CAPACITY,
				);
				index += 1
			) {
				const stop = params.alphaMatte.stops[index];
				matteStopOffsets[index] = stop?.offset ?? 0;
				matteStopAlphas[index] = stop?.alpha ?? 1;
			}
			gl.uniform1i(
				u.uFieldMode,
				PARTICLE_FIELD_MODE_INDEX[params.fieldMode] ?? 0,
			);
			gl.uniform1f(u.uAngle, params.angle);
			gl.uniform1i(u.uLinearFieldAuthored, params.linearFieldAuthored ? 1 : 0);
			gl.uniform4f(
				u.uLinearField,
				params.linearField[0],
				params.linearField[1],
				params.linearField[2],
				params.linearField[3],
			);
			// The particle pass always renders at the artboard's own resolution (the
			// editor overlay, WebM export, and WebGL player mount the canvas at
			// `scene.artboard.width/height`), which is exactly the `bounds` the SVG
			// frame filter uses for its ramp (`filterLinearRampGeometry`). Feeding
			// that same width/height here keeps the GPU projection in the same
			// object-pixel-proportional space as the SVG gradient, instead of the
			// isotropic UV-space dot product this replaces.
			gl.uniform2f(u.uLinearFieldAspect, canvas.width, canvas.height);
			gl.uniform1f(u.uLinearFieldPlateau, params.linearFieldPlateau);
			gl.uniform1i(u.uContourFocused, params.contourFocused ? 1 : 0);
			gl.uniform1i(u.uTransparentOutput, transparentOutput ? 1 : 0);
			gl.uniform1i(u.uParticleEnabled, params.particleEnabled ? 1 : 0);
			gl.uniform1i(
				u.uMatteKind,
				PARTICLE_ALPHA_MATTE_KIND_INDEX[params.alphaMatte.kind] ?? 0,
			);
			if (params.alphaMatte.kind === "linear-gradient") {
				gl.uniform4f(
					u.uMatteLinear,
					params.alphaMatte.x1,
					params.alphaMatte.y1,
					params.alphaMatte.x2,
					params.alphaMatte.y2,
				);
				gl.uniform4f(u.uMatteRadial, 0.5, 0.5, 0.5, 0.5);
				gl.uniform4f(u.uMatteContour, 0.34, 0, 0, 0);
				gl.uniform1f(u.uMatteRotation, 0);
			} else if (params.alphaMatte.kind === "radial-gradient") {
				gl.uniform4f(u.uMatteLinear, 0, 0, 1, 0);
				gl.uniform4f(
					u.uMatteRadial,
					params.alphaMatte.cx,
					params.alphaMatte.cy,
					params.alphaMatte.rx,
					params.alphaMatte.ry,
				);
				gl.uniform4f(u.uMatteContour, 0.34, 0, 0, 0);
				gl.uniform1f(u.uMatteRotation, params.alphaMatte.rotation);
			} else if (params.alphaMatte.kind === "contour-gradient") {
				gl.uniform4f(u.uMatteLinear, 0, 0, 1, 0);
				gl.uniform4f(u.uMatteRadial, 0.5, 0.5, 0.5, 0.5);
				gl.uniform4f(
					u.uMatteContour,
					params.alphaMatte.width,
					params.alphaMatte.invert ? 1 : 0,
					0,
					0,
				);
				gl.uniform1f(u.uMatteRotation, 0);
			} else {
				gl.uniform4f(u.uMatteLinear, 0, 0, 1, 0);
				gl.uniform4f(u.uMatteRadial, 0.5, 0.5, 0.5, 0.5);
				gl.uniform4f(u.uMatteContour, 0.34, 0, 0, 0);
				gl.uniform1f(u.uMatteRotation, 0);
			}
			gl.uniform1i(
				u.uMatteStopCount,
				Math.min(
					params.alphaMatte.stops.length,
					PARTICLE_ALPHA_MATTE_STOP_CAPACITY,
				),
			);
			gl.uniform1fv(u.uMatteStopOffsets, matteStopOffsets);
			gl.uniform1fv(u.uMatteStopAlphas, matteStopAlphas);
			gl.uniform3f(
				u.uClipColor,
				params.clipColor[0],
				params.clipColor[1],
				params.clipColor[2],
			);
			gl.uniform1f(u.uStrength, params.strength);
			gl.uniform1f(u.uContrast, params.contrast);
			gl.uniform1f(u.uDensityBias, params.densityBias);
			gl.uniform1f(u.uSeed, params.seed);
			gl.uniform1f(u.uScale, params.frequency);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform2f(u.uMeshShape, params.meshRows, params.meshCols);
			gl.uniform1fv(u.uMeshValues, values);
			return;
		}
		if (params.mode === "wave-warp") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uAmount, params.height);
			gl.uniform1f(u.uScale, params.width);
			gl.uniform1f(u.uAngle, params.angleRadians);
			gl.uniform1f(u.uPhase, params.phase);
			gl.uniform1i(u.uMode, WAVE_TYPE_INDEX[params.waveType]);
			return;
		}
		if (params.mode === "bend-warp") {
			gl.uniform1f(u.uBend, params.bend);
			gl.uniform1f(u.uDistortionH, params.distortionH);
			gl.uniform1f(u.uDistortionV, params.distortionV);
			gl.uniform1f(u.uScale, params.scale);
			return;
		}
		if (params.mode === "vhs-color") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uBleed, params.bleed);
			gl.uniform1f(u.uSubsample, params.subsample);
			gl.uniform1f(u.uColorUnder, params.colorUnder);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "vhs-tracking") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uJitter, params.jitter);
			gl.uniform1f(u.uWobble, params.wobble);
			gl.uniform1f(u.uTear, params.tear);
			gl.uniform1f(u.uBand, params.band);
			gl.uniform1f(u.uBandPosition, params.bandPosition);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform1f(u.uSeed, params.seed);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "vhs-noise") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uSnow, params.snow);
			gl.uniform1f(u.uDropout, params.dropout);
			gl.uniform1f(u.uDropoutLength, params.dropoutLength);
			gl.uniform1f(u.uGeneration, params.generation);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform1f(u.uSeed, params.seed);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "crt-display") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1i(u.uMaskType, CRT_DISPLAY_MASK_TYPE_INDEX[params.maskType]);
			gl.uniform1f(u.uMaskScale, params.maskScale);
			gl.uniform1f(u.uMaskStrength, params.maskStrength);
			gl.uniform1f(u.uCurvature, params.curvature);
			gl.uniform1f(u.uCornerRadius, params.cornerRadius);
			gl.uniform1f(u.uVignette, params.vignette);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "signal-glitch") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uChannelShift, params.channelShift);
			gl.uniform1f(u.uRollAmount, params.rollAmount);
			gl.uniform1f(u.uTearDensity, params.tearDensity);
			gl.uniform1f(u.uTearStrength, params.tearStrength);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform1f(u.uSeed, params.seed);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "interlace") {
			gl.uniform2f(u.uResolution, canvas.width, canvas.height);
			gl.uniform1f(u.uStrength, params.strength);
			gl.uniform1f(u.uFieldOffset, params.fieldOffset);
			gl.uniform1f(u.uFlicker, params.flicker);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		if (params.mode === "colorama") {
			const count = Math.min(params.stops.length, COLORAMA_STOP_CAPACITY);
			const offsets = new Float32Array(COLORAMA_STOP_CAPACITY);
			const colors = new Float32Array(COLORAMA_STOP_CAPACITY * 3);
			for (let index = 0; index < count; index += 1) {
				const stop = params.stops[index];
				offsets[index] = stop.offset;
				const [r, g, b] = rampColorRgb(stop.color);
				colors[index * 3] = r;
				colors[index * 3 + 1] = g;
				colors[index * 3 + 2] = b;
			}
			gl.uniform1i(u.uRampCount, count);
			gl.uniform1fv(u.uRampOffset, offsets);
			gl.uniform3fv(u.uRampColor, colors);
			gl.uniform1f(u.uPhase, params.phase);
			gl.uniform1f(u.uRepetitions, params.repetitions);
			gl.uniform1i(
				u.uInputPhase,
				COLORAMA_INPUT_PHASE_INDEX[params.inputPhase],
			);
			gl.uniform1i(u.uPreserveSourceAlpha, preserveSourceAlpha ? 1 : 0);
			gl.uniform1f(u.uMix, params.mix);
			return;
		}
		// The remaining UV-remap modes (lens/kaleidoscope/flow) all carry a centre.
		gl.uniform2f(u.uCenter, params.centerX, params.centerY);
		gl.uniform1f(u.uAspect, canvas.width / Math.max(1, canvas.height));
		if (params.mode === "lens") {
			gl.uniform1f(u.uRadius, params.size);
			gl.uniform1f(u.uConvergence, params.convergence);
			gl.uniform1i(u.uClipToRim, params.clipToRim ? 1 : 0);
			gl.uniform1i(u.uTransparentOutput, transparentOutput ? 1 : 0);
			gl.uniform3f(
				u.uClipColor,
				params.clipColor[0],
				params.clipColor[1],
				params.clipColor[2],
			);
		} else if (params.mode === "kaleidoscope") {
			gl.uniform1f(u.uSegments, params.segments);
			gl.uniform1f(u.uRoll, params.roll);
		} else if (params.mode === "flow") {
			gl.uniform1f(u.uAmount, params.amount);
			gl.uniform1f(u.uScale, params.scale);
			gl.uniform1f(u.uEvolution, params.evolution);
			gl.uniform1i(u.uPattern, FLOW_PATTERN_INDEX[params.pattern]);
			gl.uniform1i(u.uOctaves, Math.max(1, Math.round(params.octaves)));
		}
		// `glow` is multi-draw — handled by `drawGlowPass`, never reaches here.
	};

	/**
	 * The most recently activated cached program. `blitFullscreen` reads it to set the
	 * presentation-flip uniform on whichever program the caller bound — every blit call
	 * site does `bindProgram(...)` first, so this never draws with a stale entry.
	 */
	let boundProgram: CachedProgram | null = null;

	/** Activate a cached program (wrapped so Biome doesn't read `gl.useProgram` as a hook). */
	const bindProgram = (program: CachedProgram): void => {
		// biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook.
		gl.useProgram(program.program);
		boundProgram = program;
	};

	/**
	 * Draw the fullscreen triangle into `target` at the given viewport, optionally
	 * additive. A `null` target is the default framebuffer — the presentation hop — so
	 * clip-space Y mirrors there (`uYSign`, see `VERTEX_SHADER`) and FBO hops draw 1:1.
	 */
	const blitFullscreen = (
		target: FboTarget | null,
		viewWidth: number,
		viewHeight: number,
		blend: boolean,
	): void => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
		gl.viewport(0, 0, viewWidth, viewHeight);
		if (boundProgram)
			gl.uniform1f(boundProgram.uniforms.uYSign, target ? 1 : -1);
		if (blend) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE);
		} else {
			gl.disable(gl.BLEND);
		}
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	/**
	 * Deep Glow as a multi-draw pass: extract the bright pixels of `srcTexture`, build a
	 * downsample pyramid, blur each level at its own (reduced) resolution so the taps stay
	 * tight, then progressively tent-upsample the coarse reconstruction into each finer
	 * level (a tight core through a wide halo) and composite that over `baseTexture` into
	 * `target`.
	 * Blurring per level avoids the ghosting a single wide full-res blur produces. Uses
	 * its own CLAMP_TO_EDGE scratch, so it never disturbs the chain's ping-pong buffers.
	 */
	const drawGlowPass = (
		srcTexture: WebGLTexture,
		params: GlowParams,
		target: FboTarget | null,
		baseTexture: WebGLTexture = srcTexture,
	): void => {
		const finishGlow = beginFramePhase("gpu.glowSubmit");
		const extract = getProgram("glow:extract", FRAGMENT_GLOW_EXTRACT);
		const blur = getProgram("glow:blur", FRAGMENT_GLOW_BLUR);
		const copy = getProgram("glow:copy", FRAGMENT_GLOW_COPY);
		const accumulate = getProgram("glow:accumulate", FRAGMENT_GLOW_ACCUMULATE);
		const composite = getProgram("glow:composite", FRAGMENT_GLOW_COMPOSITE);
		if (!extract || !blur || !copy || !accumulate || !composite) {
			finishGlow();
			return;
		}
		if (!glowFbos) glowFbos = buildGlow();
		const { levels } = glowFbos;
		const finest = levels[0];
		if (!finest) {
			finishGlow();
			return;
		}

		// 1. Extract bright pixels (source → finest level).
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, srcTexture);
		bindProgram(extract);
		gl.uniform1f(extract.uniforms.uThreshold, params.threshold);
		blitFullscreen(finest.down, finest.width, finest.height, false);

		// 2. Downsample the extract through the pyramid (each level halves the last).
		bindProgram(copy);
		for (let i = 1; i < levels.length; i++) {
			gl.bindTexture(gl.TEXTURE_2D, levels[i - 1].down.texture);
			blitFullscreen(levels[i].down, levels[i].width, levels[i].height, false);
		}

		// 3. Blur every level in place at its own resolution (tight taps → smooth, no ghost).
		const tap = GLOW_TAP_MIN + params.radius * GLOW_TAP_RANGE;
		bindProgram(blur);
		for (const level of levels) {
			gl.bindTexture(gl.TEXTURE_2D, level.down.texture);
			gl.uniform2f(blur.uniforms.uStep, tap / level.width, 0);
			blitFullscreen(level.tmp, level.width, level.height, false); // horizontal
			gl.bindTexture(gl.TEXTURE_2D, level.tmp.texture);
			gl.uniform2f(blur.uniforms.uStep, 0, tap / level.height);
			blitFullscreen(level.down, level.width, level.height, false); // vertical
		}

		// 4. Reconstruct from coarse → fine. Each octave first writes its own weighted
		// field into `tmp`, then receives the already-combined coarser field through one
		// tent upsample. Repeated staged filtering removes the deep-level texel grid that
		// a direct coarse → full-resolution blit exposes around small bright sources.
		bindProgram(accumulate);
		const weights = glowBandWeights(levels.length, params.radius);
		for (let levelIndex = levels.length - 1; levelIndex >= 0; levelIndex -= 1) {
			const level = levels[levelIndex];
			if (!level) continue;
			gl.bindTexture(gl.TEXTURE_2D, level.down.texture);
			gl.uniform1f(accumulate.uniforms.uWeight, weights[levelIndex] ?? 0);
			gl.uniform2f(accumulate.uniforms.uTexel, 0, 0);
			blitFullscreen(level.tmp, level.width, level.height, false);
			const coarser = levels[levelIndex + 1];
			if (!coarser) continue;
			gl.bindTexture(gl.TEXTURE_2D, coarser.tmp.texture);
			gl.uniform1f(accumulate.uniforms.uWeight, 1);
			gl.uniform2f(
				accumulate.uniforms.uTexel,
				1 / coarser.width,
				1 / coarser.height,
			);
			blitFullscreen(level.tmp, level.width, level.height, true);
		}

		// 5. Composite the full-resolution reconstruction over the completed base.
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, baseTexture);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, finest.tmp.texture);
		bindProgram(composite);
		gl.uniform1f(composite.uniforms.uIntensity, params.intensity);
		gl.uniform1f(composite.uniforms.uChroma, params.chroma * GLOW_CHROMA_SCALE);
		gl.uniform1i(composite.uniforms.uBlend, BLEND_MODE_INDEX[params.blendMode]);
		ensureBlueNoiseTexture();
		blitFullscreen(target, canvas.width, canvas.height, false);
		finishGlow();
	};

	const drawPass = (
		srcTexture: WebGLTexture,
		params: RasterEffectParams,
		target: FboTarget | null,
	): void => {
		if (params.mode === "glow") {
			drawGlowPass(srcTexture, params, target);
			return;
		}
		const entry = getProgram(params.mode, FRAGMENT_SHADER[params.mode]);
		if (!entry) return;
		bindProgram(entry);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, srcTexture);
		setUniforms(entry.uniforms, params);
		gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform1f(entry.uniforms.uYSign, target ? 1 : -1);
		gl.disable(gl.BLEND);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	let disposed = false;
	// The decoded source texture is cached by its SVG string: a byte-identical prefix
	// (static content — only effect params animate) skips the expensive `Image.decode()`
	// and re-upload, so per-frame playback of an animated param is nearly free.
	let lastSvg: string | null = null;
	/** Cache identity for a composited-canvas source (see `RasterCompositedSource`). */
	let lastCompositedRevision: string | null = null;
	let lastScopedEmissionSvg: string | null = null;
	// Path Blur direction-field texture (RGBA8, sampler unit 2): created lazily and re-uploaded
	// only when the field bytes change. The adapter memoizes the field per guide topology, so
	// identical guides across frames reuse one texture rather than leaking one per frame.
	let pathBlurTexture: WebGLTexture | null = null;
	let lastPathBlurField: Uint8ClampedArray | null = null;
	const uploadSvgTexture = async (
		texture: WebGLTexture,
		svg: string,
	): Promise<boolean> => {
		const finishDecode = beginFramePhase("gpu.svgDecode");
		const image = await decodeSvgImage(svg);
		finishDecode();
		if (disposed) return false;
		const finishUpload = beginFramePhase("gpu.textureUpload");
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		finishUpload();
		image.removeAttribute("src");
		return true;
	};
	/**
	 * Same upload contract as `uploadSvgTexture` (non-premultiplied RGBA8),
	 * sourced from an already-composited 2D canvas instead of a decoded SVG.
	 */
	const uploadCanvasTexture = (
		texture: WebGLTexture,
		source: HTMLCanvasElement,
	): boolean => {
		if (disposed) return false;
		const finishUpload = beginFramePhase("gpu.textureUpload");
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		finishUpload();
		return true;
	};
	const uploadSource = async (
		svg: string,
		composited?: RasterCompositedSource,
	): Promise<boolean> => {
		if (composited) {
			if (composited.revision === lastCompositedRevision) {
				addFrameDiagnosticCount("gpu.baseCacheHit");
				return true;
			}
			addFrameDiagnosticCount("gpu.baseCacheMiss");
			if (!uploadCanvasTexture(sourceTexture, composited.canvas)) return false;
			lastCompositedRevision = composited.revision;
			// The source texture no longer holds this SVG, so the string cache must
			// not claim a hit on the next SVG-sourced frame.
			lastSvg = null;
			return true;
		}
		lastCompositedRevision = null;
		if (svg === lastSvg) {
			addFrameDiagnosticCount("gpu.baseCacheHit");
			return true;
		}
		addFrameDiagnosticCount("gpu.baseCacheMiss");
		if (!(await uploadSvgTexture(sourceTexture, svg))) return false;
		lastSvg = svg;
		return true;
	};
	const uploadScopedEmission = async (svg: string): Promise<boolean> => {
		if (svg === lastScopedEmissionSvg) {
			addFrameDiagnosticCount("gpu.emissionCacheHit");
			return true;
		}
		addFrameDiagnosticCount("gpu.emissionCacheMiss");
		if (!(await uploadSvgTexture(scopedEmissionTexture, svg))) return false;
		lastScopedEmissionSvg = svg;
		return true;
	};

	type CachedStaticLayer = StaticRasterCompositionPlan["layers"][number] & {
		readonly emissionTexture: WebGLTexture | null;
		readonly texture: WebGLTexture;
	};
	const deleteStaticLayers = (layers: readonly CachedStaticLayer[]): void => {
		for (const layer of layers) {
			gl.deleteTexture(layer.texture);
			if (layer.emissionTexture) gl.deleteTexture(layer.emissionTexture);
		}
	};
	let staticPlan: StaticRasterCompositionPlan | null = null;
	let staticLayers: CachedStaticLayer[] = [];
	let staticBaseTarget: FboTarget | null = null;
	let staticEmissionTarget: FboTarget | null = null;
	let staticGeneration = 0;
	const disposeStaticTargets = (): void => {
		if (staticBaseTarget) {
			gl.deleteTexture(staticBaseTarget.texture);
			gl.deleteFramebuffer(staticBaseTarget.framebuffer);
		}
		if (staticEmissionTarget) {
			gl.deleteTexture(staticEmissionTarget.texture);
			gl.deleteFramebuffer(staticEmissionTarget.framebuffer);
		}
		staticBaseTarget = null;
		staticEmissionTarget = null;
	};
	const clearStaticComposition = (): void => {
		staticGeneration += 1;
		deleteStaticLayers(staticLayers);
		staticLayers = [];
		staticPlan = null;
		disposeStaticTargets();
		setFrameDiagnosticGauge("gpu.staticLayerCount", 0);
		setFrameDiagnosticGauge("gpu.liveSourceTextures", 2);
		addFrameDiagnosticCount("gpu.staticPlanDisposed");
	};
	const ensureStaticTargets = (): {
		readonly base: FboTarget;
		readonly emission: FboTarget;
	} => {
		if (!staticBaseTarget) staticBaseTarget = createFbo(gl.CLAMP_TO_EDGE);
		if (!staticEmissionTarget)
			staticEmissionTarget = createFbo(gl.CLAMP_TO_EDGE);
		return { base: staticBaseTarget, emission: staticEmissionTarget };
	};
	const prepareStaticComposition = async (
		plan: StaticRasterCompositionPlan,
	): Promise<boolean> => {
		if (disposed || plan.layers.length === 0) return false;
		clearStaticComposition();
		const generation = staticGeneration;
		const prepared: CachedStaticLayer[] = [];
		for (const layer of plan.layers) {
			if (
				layer.bounds.width <= 0 ||
				layer.bounds.height <= 0 ||
				!invertRasterMatrix(layer.restMatrix)
			) {
				deleteStaticLayers(prepared);
				return false;
			}
			const texture = gl.createTexture();
			if (!texture) {
				deleteStaticLayers(prepared);
				return false;
			}
			gl.bindTexture(gl.TEXTURE_2D, texture);
			configureTexture(gl, gl.CLAMP_TO_EDGE);
			if (!(await uploadSvgTexture(texture, layer.svg))) {
				gl.deleteTexture(texture);
				deleteStaticLayers(prepared);
				return false;
			}
			if (generation !== staticGeneration || disposed) {
				gl.deleteTexture(texture);
				deleteStaticLayers(prepared);
				return false;
			}
			let emissionTexture: WebGLTexture | null = null;
			if (layer.emissionSvg && layer.emissionSvg !== layer.svg) {
				emissionTexture = gl.createTexture();
				if (!emissionTexture) {
					gl.deleteTexture(texture);
					deleteStaticLayers(prepared);
					return false;
				}
				gl.bindTexture(gl.TEXTURE_2D, emissionTexture);
				configureTexture(gl, gl.CLAMP_TO_EDGE);
				if (!(await uploadSvgTexture(emissionTexture, layer.emissionSvg))) {
					gl.deleteTexture(texture);
					gl.deleteTexture(emissionTexture);
					deleteStaticLayers(prepared);
					return false;
				}
				if (generation !== staticGeneration || disposed) {
					gl.deleteTexture(texture);
					gl.deleteTexture(emissionTexture);
					deleteStaticLayers(prepared);
					return false;
				}
			}
			prepared.push({ ...layer, emissionTexture, texture });
		}
		staticPlan = plan;
		staticLayers = prepared;
		addFrameDiagnosticCount("gpu.staticPlanPrepared");
		setFrameDiagnosticGauge("gpu.staticLayerCount", prepared.length);
		setFrameDiagnosticGauge(
			"gpu.liveSourceTextures",
			2 +
				prepared.length +
				prepared.filter((layer) => layer.emissionTexture).length,
		);
		return true;
	};
	const drawStaticLayer = (
		entry: CachedProgram,
		layer: CachedStaticLayer,
		matrix: RasterLayerMatrix,
		target: FboTarget,
		texture: WebGLTexture,
	): boolean => {
		const inverseCurrent = invertRasterMatrix(matrix);
		if (!inverseCurrent) return false;
		const inverseDelta = multiplyRasterMatrices(
			layer.restMatrix,
			inverseCurrent,
		);
		bindProgram(entry);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		if (!staticPlan) return false;
		gl.uniform2f(
			entry.uniforms.uArtboardSize,
			staticPlan.artboardWidth,
			staticPlan.artboardHeight,
		);
		gl.uniform4f(
			entry.uniforms.uLayerBounds,
			layer.bounds.x,
			layer.bounds.y,
			layer.bounds.width,
			layer.bounds.height,
		);
		gl.uniformMatrix3fv(
			entry.uniforms.uInverseDelta,
			false,
			rasterMatrixUniform(inverseDelta),
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform1f(entry.uniforms.uYSign, 1);
		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(
			gl.SRC_ALPHA,
			gl.ONE_MINUS_SRC_ALPHA,
			gl.ONE,
			gl.ONE_MINUS_SRC_ALPHA,
		);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		return true;
	};
	const renderStaticComposition = async (
		frame: StaticRasterCompositionFrame,
	): Promise<boolean> => {
		if (disposed || !staticPlan || staticLayers.length === 0) return false;
		const transforms = new Map(
			frame.layers.map((layer) => [layer.nodeId, layer.matrix] as const),
		);
		if (transforms.size !== staticLayers.length) return false;
		const program = getProgram("static:layer", FRAGMENT_STATIC_LAYER);
		if (!program) return false;
		const targets = ensureStaticTargets();
		gl.bindFramebuffer(gl.FRAMEBUFFER, targets.base.framebuffer);
		gl.clearColor(...staticPlan.background);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.bindFramebuffer(gl.FRAMEBUFFER, targets.emission.framebuffer);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		for (const layer of staticLayers) {
			const matrix = transforms.get(layer.nodeId);
			if (
				!matrix ||
				!drawStaticLayer(program, layer, matrix, targets.base, layer.texture)
			) {
				return false;
			}
			if (
				layer.emitsGlow &&
				!drawStaticLayer(
					program,
					layer,
					matrix,
					targets.emission,
					layer.emissionTexture ?? layer.texture,
				)
			) {
				return false;
			}
		}
		gl.disable(gl.BLEND);
		drawGlowPass(
			targets.emission.texture,
			staticPlan.glow,
			null,
			targets.base.texture,
		);
		addFrameDiagnosticCount("gpu.staticFramesRendered");
		return true;
	};

	// Run a linear pass chain over `srcTexture` into `target` (or the canvas). This is the
	// verified single-/multi-pass ping-pong renderer; both `renderPipeline` (whole linear
	// chain) and the composite tree's effect spines go through it, so they render the same.
	const renderPassChain = (
		srcTexture: WebGLTexture,
		passes: readonly RasterEffectPass[],
		target: FboTarget | null,
	): void => {
		if (passes.length === 1) {
			drawPass(srcTexture, passes[0].params, target);
			return;
		}
		if (!ping) ping = [createFbo(gl.REPEAT), createFbo(gl.REPEAT)];
		const pong = ping;
		let src = srcTexture;
		for (let i = 0; i < passes.length; i++) {
			const isLast = i === passes.length - 1;
			drawPass(src, passes[i].params, isLast ? target : pong[i % 2]);
			if (!isLast) src = pong[i % 2].texture;
		}
	};

	const renderPipeline = async (
		pipeline: RasterEffectPipeline,
	): Promise<void> => {
		if (disposed || pipeline.passes.length === 0) return;
		if (!(await uploadSource(pipeline.svgPrefix, pipeline.sourceCanvas)))
			return;
		renderPassChain(sourceTexture, pipeline.passes, null);
	};

	const renderScopedGlow = async (
		pipeline: ScopedGlowCompositePipeline,
	): Promise<void> => {
		if (disposed) return;
		const [baseReady, emissionReady] = await Promise.all([
			uploadSource(pipeline.baseSvg, pipeline.baseCanvas),
			uploadScopedEmission(pipeline.emissionSvg),
		]);
		if (!baseReady || !emissionReady) return;
		drawGlowPass(
			scopedEmissionTexture,
			pipeline.pass.params,
			null,
			sourceTexture,
		);
	};

	// Branch-output framebuffers for the composite tree (distinct from the ping-pong, so a
	// branch's result survives while the other branch renders). Grown on demand; a counter
	// hands out a fresh one per evaluation within a frame and resets each `renderTree`.
	// Capped so a pathological deeply-nested composite graph can't grow framebuffers without
	// bound — past the cap an evaluation reuses the last buffer (visually degraded, but no
	// OOM); real hand-authored graphs use a handful.
	const MAX_BRANCH_FBOS = 32;
	const branchFboLimit = preferLowMemory ? 12 : MAX_BRANCH_FBOS;
	const branchPool: FboTarget[] = [];
	let branchUsed = 0;
	const acquireBranchFbo = (): FboTarget => {
		if (branchUsed >= branchFboLimit) return branchPool[branchFboLimit - 1];
		if (branchUsed >= branchPool.length) branchPool.push(createFbo(gl.REPEAT));
		const fbo = branchPool[branchUsed];
		branchUsed += 1;
		return fbo;
	};
	const disposeBranchPool = (): void => {
		for (const fbo of branchPool) {
			gl.deleteTexture(fbo.texture);
			gl.deleteFramebuffer(fbo.framebuffer);
		}
		branchPool.length = 0;
		branchUsed = 0;
	};

	/** Blend two branch textures (overlay over base) with a draw mode + mix, into `target`. */
	const blendLayers = (
		baseTexture: WebGLTexture,
		overlayTexture: WebGLTexture,
		blendMode: RasterBlendMode,
		mix: number,
		target: FboTarget | null,
	): void => {
		const prog = getProgram("blend:layer", FRAGMENT_BLEND_LAYER);
		if (!prog) return;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, baseTexture);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
		bindProgram(prog);
		gl.uniform1i(prog.uniforms.uBlend, BLEND_MODE_INDEX[blendMode]);
		gl.uniform1f(prog.uniforms.uMix, mix);
		blitFullscreen(target, canvas.width, canvas.height, false);
	};

	/** Evaluate a layer to a texture (source = the source texture; others → a branch FBO). */
	const evaluateLayer = (layer: RasterLayer): WebGLTexture => {
		if (layer.kind === "source") return sourceTexture;
		if (layer.kind === "effects") {
			const inputTexture = evaluateLayer(layer.input);
			const out = acquireBranchFbo();
			renderPassChain(inputTexture, layer.passes, out);
			return out.texture;
		}
		const baseTexture = evaluateLayer(layer.base);
		const overlayTexture = evaluateLayer(layer.overlay);
		const out = acquireBranchFbo();
		blendLayers(baseTexture, overlayTexture, layer.blendMode, layer.mix, out);
		return out.texture;
	};

	const renderTree = async (pipeline: RasterTreePipeline): Promise<void> => {
		if (disposed) return;
		if (!(await uploadSource(pipeline.svgPrefix, pipeline.sourceCanvas)))
			return;
		branchUsed = 0;
		const root = pipeline.root;
		if (root.kind === "effects") {
			renderPassChain(evaluateLayer(root.input), root.passes, null);
		} else if (root.kind === "composite") {
			const baseTexture = evaluateLayer(root.base);
			const overlayTexture = evaluateLayer(root.overlay);
			blendLayers(baseTexture, overlayTexture, root.blendMode, root.mix, null);
		} else {
			// Source-only root: blit the source straight to the canvas.
			const copy = getProgram("glow:copy", FRAGMENT_GLOW_COPY);
			if (!copy) return;
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
			bindProgram(copy);
			blitFullscreen(null, canvas.width, canvas.height, false);
		}
	};

	return {
		canvas,
		renderPipeline,
		renderTree,
		renderScopedGlow,
		prepareStaticComposition,
		renderStaticComposition,
		clearStaticComposition,
		async render(svg: string, params: RasterEffectParams): Promise<void> {
			return renderPipeline({
				svgPrefix: svg,
				passes: [{ nodeId: "main", params }],
			});
		},
		resize(nextWidth: number, nextHeight: number): void {
			const w = Math.max(1, Math.round(nextWidth));
			const h = Math.max(1, Math.round(nextHeight));
			// No-op when the backing size is unchanged: callers resize on every scrub/document
			// update, and tearing down the glow pyramid + branch pool each time (only to
			// rebuild them) is a real per-frame cost. Playback preview bucket changes and
			// native-quality pause restoration are the only expected interactive resizes.
			if (w === canvas.width && h === canvas.height) return;
			addFrameDiagnosticCount("gpu.resize");
			canvas.width = w;
			canvas.height = h;
			setFrameDiagnosticGauge("gpu.backingWidth", w);
			setFrameDiagnosticGauge("gpu.backingHeight", h);
			// FBO textures must match the canvas size; recreate them lazily next chain.
			disposePing();
			disposeGlow();
			disposeBranchPool();
			disposeStaticTargets();
		},
		isContextLost(): boolean {
			return gl.isContextLost();
		},
		presentationIsBlank(): boolean {
			if (gl.isContextLost()) return true;
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			const pixel = new Uint8Array(4);
			const points: readonly (readonly [number, number])[] = [
				[canvas.width >> 1, canvas.height >> 1],
				[canvas.width >> 2, canvas.height >> 2],
				[(canvas.width * 3) >> 2, canvas.height >> 2],
				[canvas.width >> 2, (canvas.height * 3) >> 2],
				[(canvas.width * 3) >> 2, (canvas.height * 3) >> 2],
			];
			for (const [x, y] of points) {
				gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
				if (pixel[3] !== 0) return false;
			}
			return true;
		},
		invalidateSourceCache(): void {
			lastSvg = null;
			lastCompositedRevision = null;
			lastScopedEmissionSvg = null;
		},
		dispose(): void {
			disposed = true;
			gl.deleteTexture(sourceTexture);
			gl.deleteTexture(scopedEmissionTexture);
			if (pathBlurTexture) gl.deleteTexture(pathBlurTexture);
			if (blueNoiseTexture) gl.deleteTexture(blueNoiseTexture);
			gl.deleteBuffer(positionBuffer);
			for (const entry of programs.values()) gl.deleteProgram(entry.program);
			programs.clear();
			disposePing();
			disposeGlow();
			disposeBranchPool();
			clearStaticComposition();
			const lose = gl.getExtension("WEBGL_lose_context");
			lose?.loseContext();
		},
	};
}
