import { normalizeHex } from "@/shared/color";
import {
	type AePoint,
	type AeShape,
	isAeShape,
} from "@/shared/glammer/ae-shape";
import type { PathBlurGuide } from "@/shared/path-blur/velocity-field";
import {
	type ColorRecipe,
	type ColorRecipeDraft,
	type EffectInfluenceRecipe,
	type GlowRecipe,
	type GlowRecipeDraft,
	normalizeVisualRecipe,
	type TextureRecipe,
	type TextureRecipeDraft,
	type VisualRecipe,
} from "@/shared/vec-core";
import { svgIdSegment } from "./effect-filter";
import type {
	EffectLayer,
	EffectLayerAdaptationSource,
	EffectLayerOwnerRef,
	EffectLayerStack,
	EffectLayerStackDraft,
} from "./effect-layer-stack";
import { normalizeEffectLayerStack } from "./effect-layer-stack";
import type { BlendMode, RevealPaint } from "./types";

export const LOOK_GRAPH_SCHEMA_VERSION = 1 as const;

/**
 * Owner scope that stores or generates a Look graph. Scene/artboard/node scopes
 * mirror {@link EffectLayerOwnerRef}; scoped overlays add an explicit graph-only
 * owner so selected-object replacement graphs can be keyframed without being
 * misaddressed as the broad artboard look.
 */
export type LookGraphOwnerRef =
	| EffectLayerOwnerRef
	| {
			readonly scope: "scoped-overlay";
			readonly artboardId: string;
			readonly scopedLookId: string;
	  };

/** P0 node catalog for the graph-first Look model (+ P1 `blur`/`chromatic-fringe`). */
export type LookGraphNodeKind =
	| "source"
	| "output"
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
	| "composite";

export type OrderedDitherMode = "luminance" | "rgb";

/** CRT shadow-mask pattern family: continuous vertical stripes, offset short stripes, or staggered dots. */
export type CrtDisplayMaskType = "aperture" | "slot" | "shadow";

/**
 * Threshold texture: `blue-noise` is the organic field, `bayer` the matrix.
 * Values follow visual-effect-core's `StylizationDitherPattern` vocabulary
 * (`"bayer" | "blue-noise" | "error-diffusion"`) so a future vec-core adapter
 * and an error-diffusion addition stay name-compatible.
 */
export type OrderedDitherPattern = "blue-noise" | "bayer";

/** Value carried across a wire. `image`/`mask`/`matte` are pixel data; `control` is scalar. */
export type LookGraphValueType = "image" | "mask" | "matte" | "control";

export type LookGraphPortDirection = "input" | "output";

/** `single` accepts one incoming edge; `multi` accepts many (e.g. future merges). */
export type LookGraphPortCardinality = "single" | "multi";

/**
 * Typed connection point on a node. Port ids are deterministic
 * (`<nodeId>:in|out:<name>`) so UI, export, and MCP all address the same port.
 */
export type LookGraphPort = {
	readonly id: string;
	readonly name: string;
	readonly direction: LookGraphPortDirection;
	readonly valueType: LookGraphValueType;
	readonly cardinality: LookGraphPortCardinality;
};

/** A `(nodeId, portId)` pair identifying one end of an edge. */
export type LookGraphEndpoint = {
	readonly nodeId: string;
	readonly portId: string;
};

/** A directed wire from an output port to an input port. */
export type LookGraphEdge = {
	readonly id: string;
	readonly from: LookGraphEndpoint;
	readonly to: LookGraphEndpoint;
};

/** Mask routing source. Reuses the effect-layer adaptation vocabulary. */
export type LookGraphMaskSource = EffectLayerAdaptationSource;

/**
 * Composite mode a `riso` node's rendered dot screen blends over the source
 * with. The 12 separable CSS/PDF blend modes (not the full 16-value
 * {@link BlendMode}) — the 4 non-separable HSL modes (hue/saturation/color/
 * luminosity) mix hue and luminance across all three channels at once, which
 * has no simple per-channel GLSL formula, so the shader deliberately never
 * implements them.
 */
export type RisoBlendMode =
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
	| "exclusion";

/**
 * One risograph spot-ink screen: a solid `color` printed through its own
 * dot-screen angle and registration offset. Angle staggering keeps the
 * per-ink screens from moiré-aliasing into each other, and the offsets
 * simulate imperfect print registration.
 */
export type RisoInk = {
	readonly color: string;
	/** Screen angle in degrees, clamped to the repeatable -90..90 range. */
	readonly angle: number;
	/** Registration offset X in scene-px, bipolar. */
	readonly offsetX: number;
	/** Registration offset Y in scene-px, bipolar. */
	readonly offsetY: number;
};

/** Shape of a `riso` node's spatial effect field: flat, or gradiented across the object. */
export type RisoFieldMode = "uniform" | "linear" | "radial";

/**
 * A `riso` node's spatial field: gates how much of the print effect shows
 * across the object instead of uniformly. `uniform` ignores every other
 * field; `linear` reads the endpoint pair as a gradient axis; `radial` reads
 * the centre/radius pair. Coordinates are object-bounds-normalized (0..1
 * spans the object; values outside that range are still valid — they push
 * the field's start/end or centre off the object edge).
 */
export type RisoField = {
	readonly mode: RisoFieldMode;
	/** Linear gradient start, normalized to the object bounds. */
	readonly x1: number;
	readonly y1: number;
	/** Linear gradient end, normalized to the object bounds. */
	readonly x2: number;
	readonly y2: number;
	/** Radial centre, normalized to the object bounds. */
	readonly cx: number;
	readonly cy: number;
	/** Radial falloff radius, normalized to the object bounds. */
	readonly radius: number;
	/** Edge softness, 0 hard cutoff .. 1 fully smooth falloff. */
	readonly softness: number;
	/** Whether the field is inverted (full where the raw field reads empty, and vice versa). */
	readonly invert: boolean;
};

/** One stop of a Colorama output ramp. Cyclic: the last stop rejoins the first. */
export interface ColoramaStop {
	/** Ramp position, 0..1. */
	readonly offset: number;
	/** Stop colour as `#rrggbb`. */
	readonly color: string;
}

/**
 * Node payloads wrap canonical vec-core slices instead of duplicating scalar
 * state: `grade` owns `VisualRecipe.color`, `glow` owns `VisualRecipe.glow`,
 * `grain` owns `VisualRecipe.texture`. `source`/`output` are graph boundaries,
 * `mask` carries routing metadata, and `composite` owns blend/mix.
 */
export type LookGraphNodePayload =
	| { readonly kind: "source" }
	| { readonly kind: "output" }
	| { readonly kind: "grade"; readonly color: ColorRecipe }
	| { readonly kind: "glow"; readonly glow: GlowRecipe }
	| {
			readonly kind: "grain";
			readonly texture: TextureRecipe;
			/**
			 * Optional second color/gradient a Noise Gradient dissolve reveals
			 * underneath the object's own fill, so one node's own fill + dissolve
			 * appearance renders the two-color interpenetrating grain that
			 * otherwise needs a second plate node stacked beneath (see
			 * `objectNoiseGradientLookGraph` in `noise-gradient-look.ts`). Only
			 * meaningful when {@link import("@/shared/vec-core").effectiveTextureBlendMode}
			 * resolves `texture.material` to `"dissolve"` — every other blend mode
			 * ignores it (there is no "hole" for a reveal color to show through).
			 * Renderers emit it as an UNFILTERED sibling underlay, never a filter
			 * primitive (`feImage` cannot rasterize it reliably in this pipeline).
			 */
			readonly revealPaint?: RevealPaint;
	  }
	| {
			readonly kind: "blur";
			readonly radius: number;
			/**
			 * Optional y-axis radius for an axis-aligned anisotropic Gaussian blur.
			 * `radius` drives x sigma and `radiusY` drives y sigma; omission links Y
			 * to X and keeps the blur isotropic. A downstream mask gates this blur but
			 * does not add angle, trajectory, or motion-blur semantics.
			 */
			readonly radiusY?: number;
	  }
	| { readonly kind: "chromatic-fringe"; readonly amount: number }
	| {
			readonly kind: "displace";
			/** Peak displacement in geometry-local units (warp strength). */
			readonly scale: number;
			/** Noise base frequency (smaller = broader swirls). */
			readonly frequency: number;
			/** Fractal octaves added to the noise field (detail). */
			readonly octaves: number;
	  }
	| {
			readonly kind: "posterize";
			/** Number of evenly-spaced tone bands per RGB channel (≥2). */
			readonly levels: number;
	  }
	| {
			readonly kind: "color-map";
			/** Colour mapped to luminance 0 (shadows), `#rrggbb`. */
			readonly shadow: string;
			/** Colour at luminance 0.5 (`#rrggbb`); `null` makes it a pure duotone. */
			readonly midtone: string | null;
			/** Colour mapped to luminance 1 (highlights), `#rrggbb`. */
			readonly highlight: string;
			/** Blend of the mapped result over the original, 0..1 (1 = full map). */
			readonly mix: number;
	  }
	| {
			readonly kind: "find-edges";
			/** Dark edges on white (true) instead of bright edges on black (false). */
			readonly invert: boolean;
			/** Blend of the edge outline over the original, 0..1 (1 = full outline). */
			readonly mix: number;
	  }
	| {
			readonly kind: "scanline";
			/** Scan-band pitch: bands per 100 geometry-local units (higher = finer lines). */
			readonly density: number;
			/** Darkening strength of the dim bands, 0..1 (0 = invisible, 1 = fully black). */
			readonly intensity: number;
			/** Band edge softness, 0..1 (0 = crisp hard-edged CRT line, 1 = soft glow band). */
			readonly softness: number;
			/** Static/flicker noise blended into the bands, 0..1 (0 = clean lines). */
			readonly noiseMix: number;
	  }
	| {
			readonly kind: "halftone";
			/** Cell pitch in artboard pixels / scene units; larger cells produce coarser dots. */
			readonly cellSize: number;
			/** Maximum dot radius multiplier; >1 lets the darkest cells overlap slightly. */
			readonly dotSize: number;
			/** Tonal steepness before the dot-radius mapping, 0..1. */
			readonly contrast: number;
			/** Screen angle in degrees, clamped to the repeatable -90..90 range. */
			readonly angle: number;
			/** Blend of the halftone result over the original image, 0..1. */
			readonly mix: number;
	  }
	| {
			readonly kind: "pixel-grid";
			/** Cell pitch in artboard pixels / scene units; larger cells produce a coarser display grid. */
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
	| {
			readonly kind: "ordered-dither";
			/** Cell pitch in artboard pixels / scene units; larger cells produce coarser matrix pixels. */
			readonly cellSize: number;
			/** Bayer matrix dimension, normalized to 2, 4, or 8. */
			readonly matrixSize: number;
			/** Quantization levels per channel or luminance ramp, integer 2..8. */
			readonly levels: number;
			/** Whether thresholding runs on luminance or each RGB channel. */
			readonly mode: OrderedDitherMode;
			/** Threshold texture: organic blue-noise field or the Bayer matrix. */
			readonly pattern: OrderedDitherPattern;
			/** Tonal steepness before ordered thresholding, 0..1. */
			readonly contrast: number;
			/** Global threshold bias, 0..1 with 0.5 neutral. */
			readonly threshold: number;
			/** How strongly the Bayer threshold modulates quantization, 0..1. */
			readonly strength: number;
			/** Blend of the dither result over the original image, 0..1. */
			readonly mix: number;
			/** Pre-dither exposure offset, bipolar -1..1 with 0 neutral. */
			readonly brightness: number;
			/** Midtone curve applied before thresholding; 1 is neutral, 0.25..2.5. */
			readonly gamma: number;
			/** Colour of the dark/ink cells in luminance mode, `#rrggbb`. */
			readonly ink: string;
			/** Colour of the light/paper cells in luminance mode, `#rrggbb`. */
			readonly paper: string;
	  }
	| {
			readonly kind: "ascii-glyph";
			/** Character-cell height in artboard pixels / scene units. */
			readonly cellSize: number;
			/** Scale of the 5x7 glyph inside each character cell. */
			readonly glyphScale: number;
			/** Tonal steepness before glyph selection, 0..1. */
			readonly contrast: number;
			/** Emissive gain applied to lit glyph pixels. */
			readonly brightness: number;
			/** Bias applied before choosing the density ramp, -1..1. */
			readonly densityBias: number;
			/** Flip the density ramp so dark source cells choose denser glyphs. */
			readonly invert: boolean;
			/** Blend of the glyph mosaic over the original image, 0..1. */
			readonly mix: number;
	  }
	| {
			readonly kind: "block-mosaic";
			/** Tile pitch in artboard pixels / scene units. */
			readonly cellSize: number;
			/** Grout/gap between block faces as a fraction of each cell pitch, 0..0.55. */
			readonly gap: number;
			/** Beveled edge width as a fraction of the visible block face, 0..1. */
			readonly bevel: number;
			/** Pseudo-height lighting strength, 0..1. */
			readonly relief: number;
			/** Directional light angle in degrees. */
			readonly lightAngle: number;
			/** Light height above the block plane, 0..1. */
			readonly lightElevation: number;
			/** Tonal steepness before block colour and height sampling, 0..1. */
			readonly contrast: number;
			/** Deterministic per-block material variation, 0..1. */
			readonly variation: number;
			/** Blend of the block mosaic over the original image, 0..1. */
			readonly mix: number;
	  }
	| {
			readonly kind: "noise-field";
			/** Noise flavor: smooth signed fractal clouds vs billowing turbulent veins. */
			readonly type: "fractalNoise" | "turbulence";
			/** Feature size (bigger = broader swirls); inverse of feTurbulence baseFrequency. */
			readonly scale: number;
			/** Fractal octaves (AE "Detail"); more = finer compounded detail. */
			readonly detail: number;
			/** Which field — discrete; each seed is an uncorrelated noise (not continuous evolution). */
			readonly seed: number;
	  }
	| {
			readonly kind: "warp";
			/** Field shape: `radial` bulges/pinches, `twirl` swirls around the centre. */
			readonly mode: "radial" | "twirl";
			/**
			 * Warp amount, bipolar −1..1. For `radial`, positive bulges / negative
			 * pinches; for `twirl`, positive/negative are opposite swirl directions.
			 */
			readonly strength: number;
			/** Warp centre X, normalized 0..1 across the frame. */
			readonly centerX: number;
			/** Warp centre Y, normalized 0..1 across the frame. */
			readonly centerY: number;
	  }
	| {
			readonly kind: "lens";
			/**
			 * Lens radius in UV units (fraction of the frame from the centre;
			 * ~0.5 reaches a frame edge, ~0.71 reaches a corner).
			 */
			readonly size: number;
			/** Spherical magnification (AE Convergence), 0..1 (0 = flat, 1 = full sphere). */
			readonly convergence: number;
			/** Lens centre X, normalized 0..1 across the frame. */
			readonly centerX: number;
			/** Lens centre Y, normalized 0..1 down the frame. */
			readonly centerY: number;
			/**
			 * Hard-clip everything outside the lens radius to the artboard background
			 * (opaque, anti-aliased rim) instead of passing the source through. Off by
			 * default; pre-existing documents load as passthrough.
			 */
			readonly clipToRim: boolean;
	  }
	| {
			readonly kind: "kaleidoscope";
			/** Number of mirrored wedges around the centre (integer ≥2). */
			readonly segments: number;
			/** Kaleidoscope centre X, normalized 0..1 across the frame. */
			readonly centerX: number;
			/** Kaleidoscope centre Y, normalized 0..1 down the frame. */
			readonly centerY: number;
			/** Rotation of the kaleidoscope, 0..1 = one full turn. */
			readonly roll: number;
	  }
	| {
			readonly kind: "flow";
			/** Displacement pattern: radial `bulge`, flowing curl-field `turbulent`, angular `twist`. */
			readonly pattern: "bulge" | "turbulent" | "twist";
			/** Displacement strength in UV units (fraction of the frame). */
			readonly amount: number;
			/** Noise frequency (higher = finer, busier flow). */
			readonly scale: number;
			/** fbm octave count (AE Complexity): fewer = smoother flowing shapes. */
			readonly octaves: number;
			/** Evolution phase; keyframe it to morph the noise field over time. */
			readonly evolution: number;
			/** Centre X for bulge/twist, normalized 0..1. */
			readonly centerX: number;
			/** Centre Y for bulge/twist, normalized 0..1. */
			readonly centerY: number;
	  }
	| {
			readonly kind: "path-blur";
			/**
			 * Guide paths the blur streaks along. Each guide's `shape` is an
			 * {@link PathBlurGuide} `AeShape` in 0..1 frame-UV (origin top-left),
			 * with `startSpeed`/`endSpeed` scaling the streak reach along the path.
			 */
			readonly guides: readonly PathBlurGuide[];
			/** Reach multiplier, 0..500 (%). 100 = the base `length` unscaled. */
			readonly speed: number;
			/** Base streak length in UV units (fraction of the frame), e.g. 0.12. */
			readonly length: number;
			/** Streak taper toward the tail, 0..1 (0 = even smear, 1 = fully tapered). */
			readonly taper: number;
			/** Centre the streak on the source pixel (true) vs trail behind it (false). */
			readonly centeredBlur: boolean;
			/** Strobe modulation depth, 0..1 (stored now; used by a later strobe phase). */
			readonly strobeStrength: number;
			/** Strobe flash count, integer ≥0 (stored now; used by a later strobe phase). */
			readonly strobeFlashes: number;
	  }
	| {
			readonly kind: "noise-source";
			/** Feature size (like the SVG noise-field: bigger = broader). GPU-rendered, can boil. */
			readonly scale: number;
			/** fbm octave count (AE Complexity): fewer = smoother blobs, more = busier detail. */
			readonly octaves: number;
			/** Evolution phase; keyframe it to morph the field. Combined with `speed` per frame. */
			readonly evolution: number;
			/** Auto-evolve rate: the field boils on its own during playback (0 = keyframe-only). */
			readonly speed: number;
	  }
	| {
			readonly kind: "deep-glow";
			/** Halo reach, 0..1 (fraction of the frame; resolution-independent). */
			readonly radius: number;
			/** Exposure gain on the glow (AE Deep Glow Exposure); 0..4, can blow the core. */
			readonly intensity: number;
			/** Luminance cutoff, 0..1: only pixels brighter than this bloom. */
			readonly threshold: number;
			/** Chromatic-aberration fringe on the halo, 0..1 (0 = none). */
			readonly chroma: number;
			/** How the glow composites over the frame (AE Deep Glow Blend Mode). */
			readonly blendMode: BlendMode;
	  }
	| {
			readonly kind: "riso";
			/** Dot pitch in artboard pixels / scene units (absolute, GPU raster-finish). */
			readonly cellSize: number;
			/** Maximum dot radius ratio; >1 lets the darkest cells overlap slightly. */
			readonly dotSize: number;
			/** Tonal steepness before the dot-radius mapping, 0..1. */
			readonly contrast: number;
			/** Ink grain (paper-texture roughness on the printed dots), 0..1. */
			readonly grain: number;
			/** Blend of the printed riso result over the original image, 0..1. */
			readonly mix: number;
			/** Print-on reveal progress, 0..1 (1 = fully printed; 0 = unprinted). */
			readonly bloomProgress: number;
			/** How the printed dot screen composites over the source. */
			readonly blendMode: RisoBlendMode;
			/** 1..3 spot inks, each with its own colour, screen angle, and registration offset. */
			readonly inks: readonly RisoInk[];
			/** Global effect amount, 0..1 — gates both dot scale and the source↔printed mix. */
			readonly amount: number;
			/** Spatial field gradiented the print effect across the object; `uniform` = flat. */
			readonly field: RisoField;
	  }
	| {
			readonly kind: "colorama";
			/** Ordered output ramp, 1..12 stops (cyclic). */
			readonly stops: readonly ColoramaStop[];
			/** Ramp phase in turns; keyframe it to cycle the palette. */
			readonly phase: number;
			/**
			 * Cycle Repetitions (AE Colorama): how many times the ramp repeats
			 * across the 0..1 luminance range, 1..32. Decouples "which colours"
			 * from "how many bands" so the authored ramp stays natural while
			 * banding density is tuned independently.
			 */
			readonly repetitions: number;
			/**
			 * Input Phase (AE Colorama): which channel indexes the ramp. `luminance`
			 * (default) reads Rec.709 luminance, unchanged behaviour. `alpha` reads
			 * source alpha instead — the structural trick for e.g. a blurred silhouette,
			 * where alpha contours become colour bands and the fully-transparent
			 * surround (alpha 0) maps to stop 0, instead of every luminance value
			 * everywhere in a filled frame.
			 */
			readonly inputPhase: "luminance" | "alpha";
			/** Blend with the original, 0..1. */
			readonly mix: number;
	  }
	| {
			readonly kind: "wave-warp";
			readonly waveType: "sine" | "semicircle";
			/** Displacement amplitude in px. */
			readonly height: number;
			/** Wavelength in px. */
			readonly width: number;
			/** Wave travel direction in degrees. */
			readonly direction: number;
			/** Wave phase in turns; keyframe it to travel the wave. */
			readonly phase: number;
	  }
	| {
			readonly kind: "bend-warp";
			/** Arc bend, -1..1. Positive arcs the frame content upward at the centre. */
			readonly bend: number;
			/** Horizontal shear by vertical position, -1..1. */
			readonly distortionH: number;
			/** Vertical shear by horizontal position, -1..1. */
			readonly distortionV: number;
			/**
			 * Zoom about the frame centre applied before the bend/shear remap,
			 * 0.25..4 (default 1 = no zoom). AE's warped precomp is scaled up so
			 * its boundaries sit outside the comp; this is the equivalent —
			 * zooming in shrinks the visible source rect, pushing its edges (and
			 * bend-warp's reveal-transparency there) out past the frame.
			 */
			readonly scale: number;
	  }
	| {
			readonly kind: "vhs-color";
			/** Chroma horizontal lowpass radius (composite/S-video chroma bleed), scene px, 0..32. */
			readonly bleed: number;
			/** Chroma resolution divisor (S-video chroma subsampling), 1..8 (1 = full chroma resolution). */
			readonly subsample: number;
			/** Extra chroma smear + quantize amount (color-under recording noise), 0..1. */
			readonly colorUnder: number;
			/** Blend with the original, 0..1. */
			readonly mix: number;
	  }
	| {
			readonly kind: "vhs-tracking";
			/** Per-scanline horizontal time-base jitter strength, 0..1. */
			readonly jitter: number;
			/** Low-frequency wow/flutter horizontal displacement strength, 0..1. */
			readonly wobble: number;
			/** Head-switch tear band strength at the frame bottom, 0..1. */
			readonly tear: number;
			/** Tracking-error band strength, 0..1. */
			readonly band: number;
			/** Tracking-error band vertical position, 0..1 (0 = top of frame). */
			readonly bandPosition: number;
			/** Auto-evolve rate: the noise animates on its own during playback (0 = static). */
			readonly speed: number;
			/** Hash seed; keeps this node's noise independent from siblings with the same fields. */
			readonly seed: number;
			/** Blend with the original, 0..1. */
			readonly mix: number;
			/**
			 * Internal auto-evolve phase, folded from `speed * frame` the exact way
			 * `noise-source`'s `evolution` is (see {@link NOISE_SOURCE_EVOLVE_PER_FRAME}
			 * and `presentation-stage-look-graph.ts`'s auto-evolve pass) — still a
			 * plain keyframable number, not a hidden field. DCTL export drives its
			 * own time from Resolve's `TIMELINE_FRAME_INDEX` instead of this value.
			 */
			readonly evolution: number;
	  }
	| {
			readonly kind: "vhs-noise";
			/** Luma noise (tape snow) strength, 0..1. */
			readonly snow: number;
			/** White dropout streak probability, 0..1. */
			readonly dropout: number;
			/** Dropout streak length, scene px. */
			readonly dropoutLength: number;
			/** Composite generation-loss amount (softness + desaturation + contrast crush), 1..5. */
			readonly generation: number;
			/** Auto-evolve rate: the snow/dropout noise animates on its own during playback (0 = static). */
			readonly speed: number;
			/** Hash seed; keeps this node's noise independent from siblings with the same fields. */
			readonly seed: number;
			/** Blend with the original, 0..1. */
			readonly mix: number;
			/** Internal auto-evolve phase, folded from `speed * frame` — see `vhs-tracking`'s `evolution` field doc above. */
			readonly evolution: number;
	  }
	| {
			readonly kind: "crt-display";
			/** Shadow-mask pattern family. */
			readonly maskType: CrtDisplayMaskType;
			/** RGB triad/slot/dot cell pitch, scene px. */
			readonly maskScale: number;
			/** Mask tint strength, 0..1 (0 = no mask visible, 1 = fully saturated triads). */
			readonly maskStrength: number;
			/** Barrel (pincushion-correcting) distortion amount, 0..1. */
			readonly curvature: number;
			/** Rounded-corner bezel radius, 0..1 fraction of the shorter frame half-extent. */
			readonly cornerRadius: number;
			/** Edge darkening strength, 0..1. */
			readonly vignette: number;
			/** Blend with the original, 0..1. */
			readonly mix: number;
	  }
	| {
			readonly kind: "signal-glitch";
			/** RGB channel split distance, scene px. */
			readonly channelShift: number;
			/** Vertical sync-loss roll displacement, 0..1 fraction of frame height. */
			readonly rollAmount: number;
			/** Per-row tear-band probability, 0..1. */
			readonly tearDensity: number;
			/** Tear-band horizontal offset strength, scene px. */
			readonly tearStrength: number;
			/** Auto-evolve rate: the roll/tear noise animates on its own during playback (0 = static). */
			readonly speed: number;
			/** Hash seed; keeps this node's noise independent from siblings with the same fields. */
			readonly seed: number;
			/** Blend with the original, 0..1. */
			readonly mix: number;
			/** Internal auto-evolve phase, folded from `speed * frame` — see `vhs-tracking`'s `evolution` field doc. */
			readonly evolution: number;
	  }
	| {
			readonly kind: "interlace";
			/** Off-field line darkening (comb) strength, 0..1. */
			readonly strength: number;
			/** Odd-field horizontal displacement, scene px. */
			readonly fieldOffset: number;
			/** Per-field whole-frame brightness alternation strength, 0..1. */
			readonly flicker: number;
			/** Auto-evolve rate: field parity flips on its own during playback (0 = static, frozen on one field). */
			readonly speed: number;
			/** Blend with the original, 0..1. */
			readonly mix: number;
			/** Internal auto-evolve phase, folded from `speed * frame` — see `vhs-tracking`'s `evolution` field doc. */
			readonly evolution: number;
	  }
	| {
			readonly kind: "mask";
			readonly source: LookGraphMaskSource;
			readonly invert?: boolean;
			readonly feather?: number;
			readonly influenceAssignmentIds?: readonly string[];
	  }
	| {
			readonly kind: "composite";
			readonly blendMode: BlendMode;
			readonly mix: number;
	  };

/** One typed graph node with stable id, ports, and a canonical-slice payload. */
export type LookGraphNode = {
	readonly id: string;
	readonly kind: LookGraphNodeKind;
	readonly label: string;
	readonly enabled: boolean;
	readonly inputs: readonly LookGraphPort[];
	readonly outputs: readonly LookGraphPort[];
	readonly payload: LookGraphNodePayload;
	readonly position?: { readonly x: number; readonly y: number };
};

/**
 * Canonical graph-first Look document. Branches, mask inputs, and multi-input
 * composites are all representable; serial chains are the simple default. This
 * is the source of truth — `effectLayerStack`/`visualRecipe` are projections.
 */
export type LookGraph = {
	readonly schemaVersion: typeof LOOK_GRAPH_SCHEMA_VERSION;
	readonly nodes: readonly LookGraphNode[];
	readonly edges: readonly LookGraphEdge[];
	readonly outputNodeId: string;
};

/** Sparse payload accepted from commands, imports, and agent/MCP writes. */
export type LookGraphNodePayloadDraft =
	| { readonly kind: "source" }
	| { readonly kind: "output" }
	| { readonly kind: "grade"; readonly color?: ColorRecipeDraft }
	| { readonly kind: "glow"; readonly glow?: GlowRecipeDraft }
	| {
			readonly kind: "grain";
			readonly texture?: TextureRecipeDraft;
			readonly revealPaint?: RevealPaint;
	  }
	| {
			readonly kind: "blur";
			readonly radius?: number;
			/** `null` is the command/MCP clear value that restores linked X/Y blur. */
			readonly radiusY?: number | null;
	  }
	| { readonly kind: "chromatic-fringe"; readonly amount?: number }
	| {
			readonly kind: "displace";
			readonly scale?: number;
			readonly frequency?: number;
			readonly octaves?: number;
	  }
	| { readonly kind: "posterize"; readonly levels?: number }
	| {
			readonly kind: "color-map";
			readonly shadow?: string;
			readonly midtone?: string | null;
			readonly highlight?: string;
			readonly mix?: number;
	  }
	| {
			readonly kind: "find-edges";
			readonly invert?: boolean;
			readonly mix?: number;
	  }
	| {
			readonly kind: "scanline";
			readonly density?: number;
			readonly intensity?: number;
			readonly softness?: number;
			readonly noiseMix?: number;
	  }
	| {
			readonly kind: "halftone";
			readonly cellSize?: number;
			readonly dotSize?: number;
			readonly contrast?: number;
			readonly angle?: number;
			readonly mix?: number;
	  }
	| {
			readonly kind: "pixel-grid";
			readonly cellSize?: number;
			readonly gap?: number;
			readonly roundness?: number;
			readonly brightness?: number;
			readonly contrast?: number;
			readonly mix?: number;
	  }
	| {
			readonly kind: "ordered-dither";
			readonly cellSize?: number;
			readonly matrixSize?: number;
			readonly levels?: number;
			readonly mode?: OrderedDitherMode;
			readonly pattern?: OrderedDitherPattern;
			readonly contrast?: number;
			readonly threshold?: number;
			readonly strength?: number;
			readonly mix?: number;
			readonly brightness?: number;
			readonly gamma?: number;
			readonly ink?: string;
			readonly paper?: string;
	  }
	| {
			readonly kind: "ascii-glyph";
			readonly cellSize?: number;
			readonly glyphScale?: number;
			readonly contrast?: number;
			readonly brightness?: number;
			readonly densityBias?: number;
			readonly invert?: boolean;
			readonly mix?: number;
	  }
	| {
			readonly kind: "block-mosaic";
			readonly cellSize?: number;
			readonly gap?: number;
			readonly bevel?: number;
			readonly relief?: number;
			readonly lightAngle?: number;
			readonly lightElevation?: number;
			readonly contrast?: number;
			readonly variation?: number;
			readonly mix?: number;
	  }
	| {
			readonly kind: "noise-field";
			readonly type?: "fractalNoise" | "turbulence";
			readonly scale?: number;
			readonly detail?: number;
			readonly seed?: number;
	  }
	| {
			readonly kind: "warp";
			readonly mode?: "radial" | "twirl";
			readonly strength?: number;
			readonly centerX?: number;
			readonly centerY?: number;
	  }
	| {
			readonly kind: "lens";
			readonly size?: number;
			readonly convergence?: number;
			readonly centerX?: number;
			readonly centerY?: number;
			readonly clipToRim?: boolean;
	  }
	| {
			readonly kind: "kaleidoscope";
			readonly segments?: number;
			readonly centerX?: number;
			readonly centerY?: number;
			readonly roll?: number;
	  }
	| {
			readonly kind: "flow";
			readonly pattern?: "bulge" | "turbulent" | "twist";
			readonly amount?: number;
			readonly scale?: number;
			readonly octaves?: number;
			readonly evolution?: number;
			readonly centerX?: number;
			readonly centerY?: number;
	  }
	| {
			readonly kind: "path-blur";
			readonly guides?: readonly PathBlurGuide[];
			readonly speed?: number;
			readonly length?: number;
			readonly taper?: number;
			readonly centeredBlur?: boolean;
			readonly strobeStrength?: number;
			readonly strobeFlashes?: number;
	  }
	| {
			readonly kind: "noise-source";
			readonly scale?: number;
			readonly octaves?: number;
			readonly evolution?: number;
			readonly speed?: number;
	  }
	| {
			readonly kind: "deep-glow";
			readonly radius?: number;
			readonly intensity?: number;
			readonly threshold?: number;
			readonly chroma?: number;
			readonly blendMode?: BlendMode;
	  }
	| {
			readonly kind: "riso";
			readonly cellSize?: number;
			readonly dotSize?: number;
			readonly contrast?: number;
			readonly grain?: number;
			readonly mix?: number;
			readonly bloomProgress?: number;
			readonly blendMode?: RisoBlendMode;
			readonly inks?: readonly RisoInk[];
			readonly amount?: number;
			readonly field?: Partial<RisoField>;
	  }
	| {
			readonly kind: "colorama";
			readonly stops?: readonly Partial<ColoramaStop>[];
			readonly phase?: number;
			readonly repetitions?: number;
			readonly inputPhase?: "luminance" | "alpha";
			readonly mix?: number;
	  }
	| {
			readonly kind: "wave-warp";
			readonly waveType?: "sine" | "semicircle";
			readonly height?: number;
			readonly width?: number;
			readonly direction?: number;
			readonly phase?: number;
	  }
	| {
			readonly kind: "bend-warp";
			readonly bend?: number;
			readonly distortionH?: number;
			readonly distortionV?: number;
			readonly scale?: number;
	  }
	| {
			readonly kind: "vhs-color";
			readonly bleed?: number;
			readonly subsample?: number;
			readonly colorUnder?: number;
			readonly mix?: number;
	  }
	| {
			readonly kind: "vhs-tracking";
			readonly jitter?: number;
			readonly wobble?: number;
			readonly tear?: number;
			readonly band?: number;
			readonly bandPosition?: number;
			readonly speed?: number;
			readonly seed?: number;
			readonly mix?: number;
			readonly evolution?: number;
	  }
	| {
			readonly kind: "vhs-noise";
			readonly snow?: number;
			readonly dropout?: number;
			readonly dropoutLength?: number;
			readonly generation?: number;
			readonly speed?: number;
			readonly seed?: number;
			readonly mix?: number;
			readonly evolution?: number;
	  }
	| {
			readonly kind: "crt-display";
			readonly maskType?: CrtDisplayMaskType;
			readonly maskScale?: number;
			readonly maskStrength?: number;
			readonly curvature?: number;
			readonly cornerRadius?: number;
			readonly vignette?: number;
			readonly mix?: number;
	  }
	| {
			readonly kind: "signal-glitch";
			readonly channelShift?: number;
			readonly rollAmount?: number;
			readonly tearDensity?: number;
			readonly tearStrength?: number;
			readonly speed?: number;
			readonly seed?: number;
			readonly mix?: number;
			readonly evolution?: number;
	  }
	| {
			readonly kind: "interlace";
			readonly strength?: number;
			readonly fieldOffset?: number;
			readonly flicker?: number;
			readonly speed?: number;
			readonly mix?: number;
			readonly evolution?: number;
	  }
	| {
			readonly kind: "mask";
			readonly source?: LookGraphMaskSource;
			readonly invert?: boolean;
			readonly feather?: number;
			readonly influenceAssignmentIds?: readonly string[];
	  }
	| {
			readonly kind: "composite";
			readonly blendMode?: BlendMode;
			readonly mix?: number;
	  };

export type LookGraphNodeDraft = {
	readonly id?: string;
	readonly kind?: LookGraphNodeKind;
	readonly label?: string;
	readonly enabled?: boolean;
	readonly payload?: LookGraphNodePayloadDraft;
	readonly position?: { readonly x: number; readonly y: number };
};

export type LookGraphEdgeDraft = {
	readonly id?: string;
	readonly from?: Partial<LookGraphEndpoint>;
	readonly to?: Partial<LookGraphEndpoint>;
};

export type LookGraphDraft = {
	readonly schemaVersion?: typeof LOOK_GRAPH_SCHEMA_VERSION;
	readonly nodes?: readonly LookGraphNodeDraft[];
	readonly edges?: readonly LookGraphEdgeDraft[];
	readonly outputNodeId?: string;
};

/** Source slots a Look graph can be read or generated from, in precedence order. */
export type LookGraphIntentSource = {
	readonly lookGraph?: LookGraph | LookGraphDraft;
	readonly effectLayerStack?: EffectLayerStack | EffectLayerStackDraft;
	readonly visualRecipe?: VisualRecipe;
	readonly influenceRecipe?: EffectInfluenceRecipe;
};

/**
 * Typed topology/port issue. Callers reject invalid edges before command
 * creation by inspecting these instead of running ad hoc string checks.
 */
export type LookGraphIssue =
	| { readonly code: "empty-graph"; readonly message: string }
	| {
			readonly code: "duplicate-node-id";
			readonly nodeId: string;
			readonly message: string;
	  }
	| {
			readonly code: "unknown-node-kind";
			readonly nodeId: string;
			readonly message: string;
	  }
	| {
			readonly code: "duplicate-edge-id";
			readonly edgeId: string;
			readonly message: string;
	  }
	| {
			readonly code: "unknown-endpoint-node";
			readonly edgeId: string;
			readonly nodeId: string;
			readonly message: string;
	  }
	| {
			readonly code: "unknown-endpoint-port";
			readonly edgeId: string;
			readonly nodeId: string;
			readonly portId: string;
			readonly message: string;
	  }
	| {
			readonly code: "port-direction-mismatch";
			readonly edgeId: string;
			readonly endpoint: LookGraphEndpoint;
			readonly message: string;
	  }
	| {
			readonly code: "port-type-mismatch";
			readonly edgeId: string;
			readonly fromType: LookGraphValueType;
			readonly toType: LookGraphValueType;
			readonly message: string;
	  }
	| {
			readonly code: "input-cardinality-exceeded";
			readonly edgeId: string;
			readonly endpoint: LookGraphEndpoint;
			readonly message: string;
	  }
	| {
			readonly code: "cycle-detected";
			readonly nodeIds: readonly string[];
			readonly message: string;
	  }
	| { readonly code: "missing-output-node"; readonly message: string }
	| {
			readonly code: "output-node-not-output-kind";
			readonly nodeId: string;
			readonly message: string;
	  };

/**
 * Every {@link LookGraphNodeKind} literal, structurally checked against the type
 * by `satisfies` so a new node kind added to the type without a matching entry
 * here is a compile error. This is the single source other layers (the MCP wire
 * schema, agent capability catalogs) should derive their node-kind enum from
 * instead of hand-typing a second literal list that can silently drift.
 */
export const LOOK_GRAPH_NODE_KINDS = [
	"source",
	"output",
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
	"mask",
	"composite",
] as const satisfies readonly LookGraphNodeKind[];

const isNodeKind = (value: unknown): value is LookGraphNodeKind =>
	LOOK_GRAPH_NODE_KINDS.includes(value as LookGraphNodeKind);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const clampNonNegative = (value: number): number => Math.max(0, value);

const clampToRange = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/** Default Gaussian blur radius (geometry-local units) for a new `blur` node. */
const DEFAULT_BLUR_RADIUS = 4;

/** Default channel separation (geometry-local units) for a new fringe node. */
const DEFAULT_FRINGE_AMOUNT = 3;

/** Defaults for a new turbulent-displace node (peak warp / noise size / detail). */
const DEFAULT_DISPLACE_SCALE = 12;
const DEFAULT_DISPLACE_FREQUENCY = 0.02;
const DEFAULT_DISPLACE_OCTAVES = 2;
/** Octaves are clamped to a small integer range (≥1 has effect; high is costly). */
const MIN_DISPLACE_OCTAVES = 1;
const MAX_DISPLACE_OCTAVES = 5;

/** Posterize tone bands per channel; ≥2 has effect, beyond ~16 is near-continuous. */
const DEFAULT_POSTERIZE_LEVELS = 5;
const MIN_POSTERIZE_LEVELS = 2;
const MAX_POSTERIZE_LEVELS = 32;

/**
 * Default gradient-map ramp: a deep indigo→gold duotone (no midtone) at full mix,
 * so a freshly-inserted Color Map node reads as an obvious tone map immediately
 * (the posterize-levels-5 precedent of "visible on insert").
 */
const DEFAULT_COLOR_MAP_SHADOW = "#161b3c";
const DEFAULT_COLOR_MAP_HIGHLIGHT = "#f5c542";
const DEFAULT_COLOR_MAP_MIX = 1;

/** Find-Edges defaults: full bright-on-black outline, visible the moment it inserts. */
const DEFAULT_FIND_EDGES_MIX = 1;

/**
 * Scanline defaults: wide, half-strength, mostly-crisp bands that read as an
 * obvious CRT overlay the moment the node inserts (verified in-browser — the
 * `feTurbulence`/`fractalNoise` field only reads as distinct bands at a low
 * density; higher values collapse into fine hatching rather than scanlines),
 * with the static/flicker noise-mix off by default (clean lines).
 */
const DEFAULT_SCANLINE_DENSITY = 8;
const MIN_SCANLINE_DENSITY = 4;
const MAX_SCANLINE_DENSITY = 240;
const DEFAULT_SCANLINE_INTENSITY = 0.5;
const DEFAULT_SCANLINE_SOFTNESS = 0.15;
const DEFAULT_SCANLINE_NOISE_MIX = 0;

/**
 * Halftone defaults: a coarse, immediately-legible dot screen. This is a GPU
 * raster-finish effect, so `cellSize` is authored in artboard pixels / scene
 * units and mapped to the actual canvas resolution by the shader.
 */
const DEFAULT_HALFTONE_CELL_SIZE = 16;
const MIN_HALFTONE_CELL_SIZE = 4;
const MAX_HALFTONE_CELL_SIZE = 80;
const DEFAULT_HALFTONE_DOT_SIZE = 0.85;
const MIN_HALFTONE_DOT_SIZE = 0.25;
const MAX_HALFTONE_DOT_SIZE = 1.5;
const DEFAULT_HALFTONE_CONTRAST = 0.65;
const DEFAULT_HALFTONE_ANGLE = 15;
const MIN_HALFTONE_ANGLE = -90;
const MAX_HALFTONE_ANGLE = 90;
const DEFAULT_HALFTONE_MIX = 1;

/**
 * Pixel Grid defaults: a visible low-resolution LED/display-cell treatment. Like
 * Halftone, it is a GPU raster-finish effect and authors `cellSize` in artboard
 * pixels / scene units.
 */
const DEFAULT_PIXEL_GRID_CELL_SIZE = 16;
const MIN_PIXEL_GRID_CELL_SIZE = 4;
const MAX_PIXEL_GRID_CELL_SIZE = 96;
const DEFAULT_PIXEL_GRID_GAP = 0.18;
const MAX_PIXEL_GRID_GAP = 0.6;
const DEFAULT_PIXEL_GRID_ROUNDNESS = 0.6;
const DEFAULT_PIXEL_GRID_BRIGHTNESS = 1.15;
const MAX_PIXEL_GRID_BRIGHTNESS = 2;
const DEFAULT_PIXEL_GRID_CONTRAST = 0.45;
const DEFAULT_PIXEL_GRID_MIX = 1;

/**
 * Ordered Dither defaults: a true Bayer matrix threshold that reads immediately
 * as print/screen dither. It is GPU raster-finish only; the matrix is anchored in
 * artboard pixels instead of approximated with procedural noise.
 */
const DEFAULT_ORDERED_DITHER_CELL_SIZE = 4;
const MIN_ORDERED_DITHER_CELL_SIZE = 2;
const MAX_ORDERED_DITHER_CELL_SIZE = 32;
const DEFAULT_ORDERED_DITHER_MATRIX_SIZE = 4;
const DEFAULT_ORDERED_DITHER_LEVELS = 2;
const MIN_ORDERED_DITHER_LEVELS = 2;
const MAX_ORDERED_DITHER_LEVELS = 8;
const DEFAULT_ORDERED_DITHER_MODE: OrderedDitherMode = "luminance";
const DEFAULT_ORDERED_DITHER_PATTERN: OrderedDitherPattern = "blue-noise";
/**
 * Normalization fallback for documents whose ordered-dither payload predates
 * the `pattern` field (or carries an unknown value). Pre-pattern documents
 * rendered the Bayer lattice unconditionally, so absent/unknown MUST stay
 * `bayer` — falling back to the new blue-noise default would silently change
 * the rendered appearance of existing saved documents on next open. New nodes
 * still default to `blue-noise` via `defaultPayloadForKind`.
 */
const LEGACY_ORDERED_DITHER_PATTERN: OrderedDitherPattern = "bayer";
const DEFAULT_ORDERED_DITHER_CONTRAST = 0.55;
const DEFAULT_ORDERED_DITHER_THRESHOLD = 0.5;
const DEFAULT_ORDERED_DITHER_STRENGTH = 1;
const DEFAULT_ORDERED_DITHER_MIX = 1;
const DEFAULT_ORDERED_DITHER_BRIGHTNESS = 0;
const MIN_ORDERED_DITHER_BRIGHTNESS = -1;
const MAX_ORDERED_DITHER_BRIGHTNESS = 1;
const DEFAULT_ORDERED_DITHER_GAMMA = 1;
const MIN_ORDERED_DITHER_GAMMA = 0.25;
const MAX_ORDERED_DITHER_GAMMA = 2.5;
const DEFAULT_ORDERED_DITHER_INK = "#000000";
const DEFAULT_ORDERED_DITHER_PAPER = "#ffffff";

/**
 * ASCII/Glyph Mosaic defaults: a fixed procedural 5x7 ASCII density ramp. V1
 * intentionally avoids external fonts, arbitrary text, or custom charset state.
 */
const DEFAULT_ASCII_GLYPH_CELL_SIZE = 16;
const MIN_ASCII_GLYPH_CELL_SIZE = 8;
const MAX_ASCII_GLYPH_CELL_SIZE = 96;
const DEFAULT_ASCII_GLYPH_SCALE = 0.9;
const MIN_ASCII_GLYPH_SCALE = 0.5;
const MAX_ASCII_GLYPH_SCALE = 1.15;
const DEFAULT_ASCII_GLYPH_CONTRAST = 0.6;
const DEFAULT_ASCII_GLYPH_BRIGHTNESS = 1;
const MAX_ASCII_GLYPH_BRIGHTNESS = 2;
const DEFAULT_ASCII_GLYPH_DENSITY_BIAS = 0;
const DEFAULT_ASCII_GLYPH_MIX = 1;

/**
 * Block Mosaic defaults: a GPU raster-finish raised-tile reconstruction. It
 * keeps the same stable source-cell contract as Pixel Grid, but adds physical
 * grout, bevel, and directional relief lighting instead of display dots.
 */
const DEFAULT_BLOCK_MOSAIC_CELL_SIZE = 24;
const MIN_BLOCK_MOSAIC_CELL_SIZE = 8;
const MAX_BLOCK_MOSAIC_CELL_SIZE = 128;
const DEFAULT_BLOCK_MOSAIC_GAP = 0.1;
const MAX_BLOCK_MOSAIC_GAP = 0.55;
const DEFAULT_BLOCK_MOSAIC_BEVEL = 0.35;
const DEFAULT_BLOCK_MOSAIC_RELIEF = 0.55;
const DEFAULT_BLOCK_MOSAIC_LIGHT_ANGLE = -35;
const MIN_BLOCK_MOSAIC_LIGHT_ANGLE = -180;
const MAX_BLOCK_MOSAIC_LIGHT_ANGLE = 180;
const DEFAULT_BLOCK_MOSAIC_LIGHT_ELEVATION = 0.55;
const DEFAULT_BLOCK_MOSAIC_CONTRAST = 0.45;
const DEFAULT_BLOCK_MOSAIC_VARIATION = 0.16;
const DEFAULT_BLOCK_MOSAIC_MIX = 1;

/**
 * Noise-field defaults: a broad fractal cloud field that reads as an organic texture the
 * moment the generator inserts (not fine static). `scale` is feature size (bigger =
 * broader); `detail` the octaves; `seed` the field.
 */
const DEFAULT_NOISE_FIELD_TYPE = "fractalNoise" as const;
const DEFAULT_NOISE_FIELD_SCALE = 30;
const MIN_NOISE_FIELD_SCALE = 2;
const MAX_NOISE_FIELD_SCALE = 200;
const DEFAULT_NOISE_FIELD_DETAIL = 3;
const MIN_NOISE_FIELD_DETAIL = 1;
const MAX_NOISE_FIELD_DETAIL = 6;
const DEFAULT_NOISE_FIELD_SEED = 0;

/** Warp defaults: a moderate centred bulge, obvious the moment the node inserts. */
const DEFAULT_WARP_STRENGTH = 0.4;
const DEFAULT_WARP_CENTER = 0.5;

/**
 * Lens (CC Lens) defaults: a centred sphere reaching the frame edges with enough
 * convergence to read as an obvious spherical lens the moment the node inserts.
 */
const DEFAULT_LENS_SIZE = 0.5;
const DEFAULT_LENS_CONVERGENCE = 0.7;
const DEFAULT_LENS_CENTER = 0.5;

/** Kaleidoscope defaults: a 6-fold centred mandala, obvious the moment it inserts. */
const DEFAULT_KALEIDOSCOPE_SEGMENTS = 6;
const MIN_KALEIDOSCOPE_SEGMENTS = 2;
const MAX_KALEIDOSCOPE_SEGMENTS = 24;
const DEFAULT_KALEIDOSCOPE_CENTER = 0.5;
const DEFAULT_KALEIDOSCOPE_ROLL = 0;

/** Flow defaults: a turbulent displacement strong enough to read on insert. */
const DEFAULT_FLOW_AMOUNT = 0.07;
const DEFAULT_FLOW_SCALE = 4;
const DEFAULT_FLOW_OCTAVES = 3;
const MIN_FLOW_OCTAVES = 1;
const MAX_FLOW_OCTAVES = 6;
const DEFAULT_FLOW_EVOLUTION = 0;
const DEFAULT_FLOW_CENTER = 0.5;

/**
 * Path Blur defaults. The seed guide is a CURVED arc in 0..1 frame-UV (origin
 * top-left): three vertices sweeping left→centre→right with non-zero in/out
 * tangents so the path visibly bends, giving the streak a curved direction the
 * moment the node inserts (a straight guide would read as a plain motion blur).
 * `startSpeed`/`endSpeed` taper the reach from the path head to its tail.
 */
const DEFAULT_PATH_BLUR_GUIDE_START_SPEED = 1;
const DEFAULT_PATH_BLUR_GUIDE_END_SPEED = 0.2;
const PATH_BLUR_GUIDE_TANGENT_REACH = 0.12;
const DEFAULT_PATH_BLUR_GUIDE_SHAPE: AeShape = {
	type: "Shape",
	closed: false,
	vertices: [
		[0.15, 0.7],
		[0.5, 0.3],
		[0.85, 0.7],
	],
	inTangents: [
		[-PATH_BLUR_GUIDE_TANGENT_REACH, 0],
		[-PATH_BLUR_GUIDE_TANGENT_REACH, 0],
		[-PATH_BLUR_GUIDE_TANGENT_REACH, 0],
	],
	outTangents: [
		[PATH_BLUR_GUIDE_TANGENT_REACH, 0],
		[PATH_BLUR_GUIDE_TANGENT_REACH, 0],
		[PATH_BLUR_GUIDE_TANGENT_REACH, 0],
	],
};

/** Canonical default Path Blur guide (single curved arc, head-to-tail taper). */
export const DEFAULT_PATH_BLUR_GUIDE: PathBlurGuide = {
	shape: DEFAULT_PATH_BLUR_GUIDE_SHAPE,
	startSpeed: DEFAULT_PATH_BLUR_GUIDE_START_SPEED,
	endSpeed: DEFAULT_PATH_BLUR_GUIDE_END_SPEED,
};

/** Path Blur scalar defaults: a visible curved streak the moment the node inserts. */
const DEFAULT_PATH_BLUR_SPEED = 100;
const MIN_PATH_BLUR_SPEED = 0;
const MAX_PATH_BLUR_SPEED = 500;
const DEFAULT_PATH_BLUR_LENGTH = 0.12;
const MAX_PATH_BLUR_LENGTH = 1;
const DEFAULT_PATH_BLUR_TAPER = 0.4;
const DEFAULT_PATH_BLUR_CENTERED = false;
const DEFAULT_PATH_BLUR_STROBE_STRENGTH = 0;
const DEFAULT_PATH_BLUR_STROBE_FLASHES = 0;
const MAX_PATH_BLUR_STROBE_FLASHES = 64;
/** A guide needs at least this many vertices to define a direction. */
const MIN_PATH_BLUR_GUIDE_VERTICES = 2;

const samePathBlurPoint = (
	left: AePoint | undefined,
	right: AePoint | undefined,
): boolean =>
	left !== undefined &&
	right !== undefined &&
	left[0] === right[0] &&
	left[1] === right[1];

const samePathBlurPointList = (
	left: readonly AePoint[],
	right: readonly AePoint[],
): boolean =>
	left.length === right.length &&
	left.every((point, index) => samePathBlurPoint(point, right[index]));

const samePathBlurGuide = (
	left: PathBlurGuide | undefined,
	right: PathBlurGuide,
): boolean =>
	left !== undefined &&
	left.startSpeed === right.startSpeed &&
	left.endSpeed === right.endSpeed &&
	left.shape.closed === right.shape.closed &&
	samePathBlurPointList(left.shape.vertices, right.shape.vertices) &&
	samePathBlurPointList(left.shape.inTangents, right.shape.inTangents) &&
	samePathBlurPointList(left.shape.outTangents, right.shape.outTangents);

/**
 * True when a `path-blur` payload still carries the EXACT insert-time defaults:
 * a single guide deep-equal to {@link DEFAULT_PATH_BLUR_GUIDE} and every scalar
 * at its default. Legacy-document repair uses this as the conservative half of
 * its auto-seed fingerprint — any user-touched value (a moved guide anchor, an
 * added guide, a scrubbed slider) fails the match, so the payload is treated as
 * user-authored and never offered for cleanup. Scalar comparison is exact
 * (`===`): defaults survive JSON persistence bit-for-bit and the normalizer
 * passes in-range values through unchanged.
 */
export const isDefaultPathBlurPayload = (
	payload: LookGraphNodePayload,
): boolean =>
	payload.kind === "path-blur" &&
	payload.speed === DEFAULT_PATH_BLUR_SPEED &&
	payload.length === DEFAULT_PATH_BLUR_LENGTH &&
	payload.taper === DEFAULT_PATH_BLUR_TAPER &&
	payload.centeredBlur === DEFAULT_PATH_BLUR_CENTERED &&
	payload.strobeStrength === DEFAULT_PATH_BLUR_STROBE_STRENGTH &&
	payload.strobeFlashes === DEFAULT_PATH_BLUR_STROBE_FLASHES &&
	payload.guides.length === 1 &&
	samePathBlurGuide(payload.guides[0], DEFAULT_PATH_BLUR_GUIDE);

/**
 * Animated Noise defaults: a mid-scale field that boils on its own (speed 1) the
 * moment it inserts — the GPU node's whole point over the static SVG noise-field.
 * Scale mirrors the noise-field convention (feature size, 2..200). `speed` 0 =
 * keyframe-only.
 */
const DEFAULT_NOISE_SOURCE_SCALE = 30;
const MIN_NOISE_SOURCE_SCALE = 2;
const MAX_NOISE_SOURCE_SCALE = 200;
const DEFAULT_NOISE_SOURCE_OCTAVES = 3;
const MIN_NOISE_SOURCE_OCTAVES = 1;
const MAX_NOISE_SOURCE_OCTAVES = 6;
const DEFAULT_NOISE_SOURCE_EVOLUTION = 0;
const DEFAULT_NOISE_SOURCE_SPEED = 1;
const MAX_NOISE_SOURCE_SPEED = 10;
/** Per-frame evolution advance at `speed` 1 — folds the user 0..10 Speed into a boil rate. */
export const NOISE_SOURCE_EVOLVE_PER_FRAME = 0.04;

/**
 * Deep Glow defaults: an immediately legible optical bloom, with enough reach and
 * exposure to demonstrate the effect on insertion. Source extraction still follows
 * post-material luminance rather than alpha, so dark opaque regions do not become
 * fake emitters and a scene-wide application remains controllable via Threshold.
 */
const DEFAULT_DEEP_GLOW_RADIUS = 0.68;
const DEFAULT_DEEP_GLOW_INTENSITY = 0.7;
const MAX_DEEP_GLOW_INTENSITY = 4;
const DEFAULT_DEEP_GLOW_THRESHOLD = 0.42;
const DEFAULT_DEEP_GLOW_CHROMA = 0.12;
/** Deep Glow composites with Screen by default — the reference's Blend Mode. */
const DEFAULT_DEEP_GLOW_BLEND_MODE: BlendMode = "screen";

/**
 * Riso defaults: a two-ink risograph print pass with staggered screen angles
 * (15°/75°) so the dot screens read as distinct inks rather than moiré into
 * one another, at full mix/print-on. GPU raster-finish, like Halftone —
 * `cellSize`/offsets are authored in artboard pixels / scene units.
 */
const DEFAULT_RISO_CELL_SIZE = 12;
const MIN_RISO_CELL_SIZE = 2;
const MAX_RISO_CELL_SIZE = 64;
const DEFAULT_RISO_DOT_SIZE = 0.9;
const MIN_RISO_DOT_SIZE = 0;
const MAX_RISO_DOT_SIZE = 1.5;
const DEFAULT_RISO_CONTRAST = 0.62;
const DEFAULT_RISO_GRAIN = 0.32;
const DEFAULT_RISO_MIX = 1;
const DEFAULT_RISO_BLOOM_PROGRESS = 1;
const DEFAULT_RISO_BLEND_MODE: RisoBlendMode = "multiply";
/**
 * The 12 separable {@link RisoBlendMode} values, in the same order the
 * shader's `blendOver` int-switch and {@link RISO_BLEND_MODE_TO_INT}-style
 * adapters expect. Exported so widgets (the Inspector's Blend dropdown) build
 * their option list from this single source instead of hand-copying the union.
 */
export const RISO_BLEND_MODES: readonly RisoBlendMode[] = [
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
];
const MIN_RISO_INK_ANGLE = -90;
const MAX_RISO_INK_ANGLE = 90;
const MIN_RISO_INK_OFFSET = -3;
const MAX_RISO_INK_OFFSET = 3;
const MIN_RISO_INKS = 1;
const MAX_RISO_INKS = 3;
const DEFAULT_RISO_INKS: readonly RisoInk[] = [
	{ color: "#ff2d6b", angle: 15, offsetX: 0.6, offsetY: -0.4 },
	{ color: "#2b5cff", angle: 75, offsetX: -0.5, offsetY: 0.5 },
];

/** Global riso effect amount default — fully applied. */
const DEFAULT_RISO_AMOUNT = 1;
/** Riso field defaults: `uniform` (flat, ignores every other field param). */
const DEFAULT_RISO_FIELD: RisoField = {
	mode: "uniform",
	x1: 0.5,
	y1: 0,
	x2: 0.5,
	y2: 1,
	cx: 0.5,
	cy: 0.5,
	radius: 0.5,
	softness: 0.6,
	invert: false,
};
const RISO_FIELD_MODES: readonly RisoFieldMode[] = [
	"uniform",
	"linear",
	"radial",
];
/** Field coordinates are object-bounds-normalized but authorable beyond 0..1 (off-object start/end/centre). */
const MIN_RISO_FIELD_COORD = -2;
const MAX_RISO_FIELD_COORD = 3;
const MIN_RISO_FIELD_RADIUS = 0.01;
const MAX_RISO_FIELD_RADIUS = 3;

/**
 * Capacity of a `colorama` ramp. Must stay in sync by hand with
 * `COLORAMA_STOP_CAPACITY` in `shared/gpu-lens/surface.ts` (the GLSL array
 * declaration and loop bound there use the literal `12`, not a shared const —
 * GLSL has no shared-constant import).
 */
const MAX_COLORAMA_STOPS = 12;
const DEFAULT_COLORAMA_STOPS: readonly ColoramaStop[] = [
	{ offset: 0, color: "#000000" },
	{ offset: 1, color: "#ffffff" },
];
const DEFAULT_COLORAMA_PHASE = 0;
const DEFAULT_COLORAMA_MIX = 1;
/** AE "Cycle Repetitions": how many times the ramp repeats across 0..1 luminance. */
const DEFAULT_COLORAMA_REPETITIONS = 1;
const MIN_COLORAMA_REPETITIONS = 1;
const MAX_COLORAMA_REPETITIONS = 32;

type ColoramaInputPhase = "luminance" | "alpha";
const DEFAULT_COLORAMA_INPUT_PHASE: ColoramaInputPhase = "luminance";
const COLORAMA_INPUT_PHASES: readonly ColoramaInputPhase[] = [
	"luminance",
	"alpha",
];

type WaveWarpType = "sine" | "semicircle";
const DEFAULT_WAVE_TYPE: WaveWarpType = "sine";
const WAVE_TYPES: readonly WaveWarpType[] = ["sine", "semicircle"];
const DEFAULT_WAVE_WARP_HEIGHT = 40;
const MIN_WAVE_WARP_HEIGHT = 0;
const MAX_WAVE_WARP_HEIGHT = 2000;
const DEFAULT_WAVE_WARP_WIDTH = 200;
const MIN_WAVE_WARP_WIDTH = 1;
const MAX_WAVE_WARP_WIDTH = 4000;
const DEFAULT_WAVE_WARP_DIRECTION = 90;
const DEFAULT_WAVE_WARP_PHASE = 0;
const FULL_TURN_DEGREES = 360;

const DEFAULT_BEND_WARP_BEND = 0;
const DEFAULT_BEND_WARP_DISTORTION_H = 0;
const DEFAULT_BEND_WARP_DISTORTION_V = 0;
const DEFAULT_BEND_WARP_SCALE = 1;
const MIN_BEND_WARP_SCALE = 0.25;
const MAX_BEND_WARP_SCALE = 4;

/**
 * VHS Color (composite/S-video chroma degradation) defaults: a mild but
 * visible bleed/subsample right out of the box. `bleed` mirrors the SVG blur
 * radius convention (scene px); `subsample` is a chroma-resolution divisor
 * (1 = full chroma resolution, i.e. a clean digital signal).
 */
const DEFAULT_VHS_COLOR_BLEED = 6;
const MIN_VHS_COLOR_BLEED = 0;
const MAX_VHS_COLOR_BLEED = 32;
const DEFAULT_VHS_COLOR_SUBSAMPLE = 2;
const MIN_VHS_COLOR_SUBSAMPLE = 1;
const MAX_VHS_COLOR_SUBSAMPLE = 8;
const DEFAULT_VHS_COLOR_COLOR_UNDER = 0.3;
const DEFAULT_VHS_COLOR_MIX = 1;

/**
 * VHS Tracking (tape transport instability) defaults: light jitter/tear so
 * the node reads immediately without overwhelming the frame. `speed` follows
 * `noise-source`'s auto-evolve convention (0 = static, no keyframes needed
 * for the noise to move); `seed` mirrors `noise-field`'s 0..64 hash range.
 */
const DEFAULT_VHS_TRACKING_JITTER = 0.25;
const DEFAULT_VHS_TRACKING_WOBBLE = 0.15;
const DEFAULT_VHS_TRACKING_TEAR = 0.3;
const DEFAULT_VHS_TRACKING_BAND = 0.2;
const DEFAULT_VHS_TRACKING_BAND_POSITION = 0.92;
const DEFAULT_VHS_TRACKING_SPEED = 1;
const MAX_VHS_TRACKING_SPEED = 10;
const DEFAULT_VHS_TRACKING_SEED = 0;
const MAX_VHS_TRACKING_SEED = 64;
const DEFAULT_VHS_TRACKING_MIX = 1;
const DEFAULT_VHS_TRACKING_EVOLUTION = 0;

/**
 * VHS Noise (tape noise floor) defaults: visible snow/dropout at a light
 * generation-loss setting. `generation` follows the "Nth-generation dub"
 * convention (1 = pristine master, 5 = heavily copied).
 */
const DEFAULT_VHS_NOISE_SNOW = 0.2;
const DEFAULT_VHS_NOISE_DROPOUT = 0.15;
const DEFAULT_VHS_NOISE_DROPOUT_LENGTH = 24;
const MIN_VHS_NOISE_DROPOUT_LENGTH = 1;
const MAX_VHS_NOISE_DROPOUT_LENGTH = 200;
const DEFAULT_VHS_NOISE_GENERATION = 2;
const MIN_VHS_NOISE_GENERATION = 1;
const MAX_VHS_NOISE_GENERATION = 5;
const DEFAULT_VHS_NOISE_SPEED = 1;
const MAX_VHS_NOISE_SPEED = 10;
const DEFAULT_VHS_NOISE_SEED = 0;
const MAX_VHS_NOISE_SEED = 64;
const DEFAULT_VHS_NOISE_MIX = 1;
const DEFAULT_VHS_NOISE_EVOLUTION = 0;

/**
 * CRT Display (monitor physicality: shadow mask + barrel curvature + bezel +
 * vignette) defaults: a subtle, immediately visible CRT read without
 * overwhelming the frame. `maskScale` mirrors `vhs-color`'s chroma-block px
 * convention; `curvature`/`cornerRadius`/`vignette` are all normalized 0..1
 * fractions of the frame.
 */
const DEFAULT_CRT_DISPLAY_MASK_TYPE: CrtDisplayMaskType = "aperture";
const DEFAULT_CRT_DISPLAY_MASK_SCALE = 4;
const MIN_CRT_DISPLAY_MASK_SCALE = 1;
const MAX_CRT_DISPLAY_MASK_SCALE = 24;
const DEFAULT_CRT_DISPLAY_MASK_STRENGTH = 0.5;
const DEFAULT_CRT_DISPLAY_CURVATURE = 0.15;
const DEFAULT_CRT_DISPLAY_CORNER_RADIUS = 0.08;
const DEFAULT_CRT_DISPLAY_VIGNETTE = 0.35;
const DEFAULT_CRT_DISPLAY_MIX = 1;

/**
 * Signal Glitch (sync/glitch artifacts: channel split, vertical roll, tear
 * bands) defaults: a light, readable glitch out of the box. `channelShift`
 * mirrors `chromatic-fringe.amount`'s scene-px convention; `speed`/`seed`
 * follow `vhs-tracking`'s auto-evolve convention exactly.
 */
const DEFAULT_SIGNAL_GLITCH_CHANNEL_SHIFT = 3;
const MIN_SIGNAL_GLITCH_CHANNEL_SHIFT = 0;
const MAX_SIGNAL_GLITCH_CHANNEL_SHIFT = 32;
const DEFAULT_SIGNAL_GLITCH_ROLL_AMOUNT = 0;
const DEFAULT_SIGNAL_GLITCH_TEAR_DENSITY = 0.1;
const DEFAULT_SIGNAL_GLITCH_TEAR_STRENGTH = 20;
const MAX_SIGNAL_GLITCH_TEAR_STRENGTH = 200;
const DEFAULT_SIGNAL_GLITCH_SPEED = 1;
const MAX_SIGNAL_GLITCH_SPEED = 10;
const DEFAULT_SIGNAL_GLITCH_SEED = 0;
const MAX_SIGNAL_GLITCH_SEED = 64;
const DEFAULT_SIGNAL_GLITCH_MIX = 1;
const DEFAULT_SIGNAL_GLITCH_EVOLUTION = 0;

/**
 * Interlace (stateless field-parity comb) defaults: a light comb visible on
 * high-contrast edges without dominating the frame. `speed` follows the
 * auto-evolve convention (1 = parity flips once per rendered frame — see the
 * payload's `evolution` field doc).
 */
const DEFAULT_INTERLACE_STRENGTH = 0.4;
const DEFAULT_INTERLACE_FIELD_OFFSET = 2;
const MAX_INTERLACE_FIELD_OFFSET = 40;
const DEFAULT_INTERLACE_FLICKER = 0.15;
const DEFAULT_INTERLACE_SPEED = 1;
const MAX_INTERLACE_SPEED = 10;
const DEFAULT_INTERLACE_MIX = 1;
const DEFAULT_INTERLACE_EVOLUTION = 0;

const clampBipolar = (value: number): number =>
	Math.min(1, Math.max(-1, value));

const normalizeColorOr = (value: unknown, fallback: string): string =>
	typeof value === "string" ? (normalizeHex(value) ?? fallback) : fallback;

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeOrderedDitherMode = (value: unknown): OrderedDitherMode =>
	value === "rgb" ? "rgb" : DEFAULT_ORDERED_DITHER_MODE;

const normalizeOrderedDitherPattern = (value: unknown): OrderedDitherPattern =>
	value === "blue-noise" ? "blue-noise" : LEGACY_ORDERED_DITHER_PATTERN;

const normalizeCrtDisplayMaskType = (value: unknown): CrtDisplayMaskType =>
	value === "slot" || value === "shadow"
		? value
		: DEFAULT_CRT_DISPLAY_MASK_TYPE;

const normalizeOrderedDitherMatrixSize = (value: unknown): number => {
	const size = clampToRange(
		finiteOr(value, DEFAULT_ORDERED_DITHER_MATRIX_SIZE),
		2,
		8,
	);
	if (size <= 3) return 2;
	if (size < 6) return 4;
	return 8;
};

const nonEmpty = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const uniqueStrings = (
	values: readonly string[] | undefined,
): readonly string[] => {
	if (!values) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const id = nonEmpty(value);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
};

/** Human label for a node kind (single source for default labels + capabilities). */
export const lookGraphNodeLabel = (kind: LookGraphNodeKind): string => {
	switch (kind) {
		case "source":
			return "Source";
		case "output":
			return "Output";
		case "grade":
			return "Grade";
		case "glow":
			return "Glow";
		case "grain":
			return "Film Grain";
		case "blur":
			return "Blur";
		case "chromatic-fringe":
			return "RGB Fringe";
		case "displace":
			return "Static Displace";
		case "posterize":
			return "Posterize";
		case "color-map":
			return "Color Map";
		case "find-edges":
			return "Find Edges";
		case "scanline":
			return "Scanline";
		case "halftone":
			return "Halftone";
		case "pixel-grid":
			return "Pixel Grid";
		case "ordered-dither":
			return "Ordered Dither";
		case "ascii-glyph":
			return "Glyph Mosaic";
		case "block-mosaic":
			return "Block Mosaic";
		case "noise-field":
			return "Static Noise";
		case "warp":
			return "Bulge / Twirl";
		case "lens":
			return "Lens";
		case "kaleidoscope":
			return "Kaleidoscope";
		case "flow":
			return "Flow Distort";
		case "path-blur":
			return "Path Blur";
		case "noise-source":
			return "Animated Noise";
		case "deep-glow":
			return "Deep Glow";
		case "riso":
			return "Riso";
		case "colorama":
			return "Colorama";
		case "wave-warp":
			return "Wave Warp";
		case "bend-warp":
			return "Bend Warp";
		case "vhs-color":
			return "VHS Color";
		case "vhs-tracking":
			return "VHS Tracking";
		case "vhs-noise":
			return "VHS Noise";
		case "crt-display":
			return "CRT Display";
		case "signal-glitch":
			return "Signal Glitch";
		case "interlace":
			return "Interlace";
		case "mask":
			return "Mask";
		case "composite":
			return "Composite";
	}
};

/** Structural equality for two Look graph owners (scene/artboard/node scope). */
export const sameLookGraphOwner = (
	a: LookGraphOwnerRef,
	b: LookGraphOwnerRef,
): boolean => {
	switch (a.scope) {
		case "scene":
			return b.scope === "scene";
		case "artboard":
			return b.scope === "artboard" && a.artboardId === b.artboardId;
		case "node":
			return b.scope === "node" && a.nodeId === b.nodeId;
		case "scoped-overlay":
			return (
				b.scope === "scoped-overlay" &&
				a.artboardId === b.artboardId &&
				a.scopedLookId === b.scopedLookId
			);
	}
};

/**
 * Returns the payload with one top-level numeric param replaced by `value`, for
 * the non-projectable effect kinds whose params are not recipe sub-domains
 * (blur/chromatic-fringe/displace/posterize/color-map/find-edges/warp/lens/mask/composite). Unknown `paramKey`,
 * or grade/glow/grain (which animate through the recipe), return the payload
 * unchanged. The value is RAW — `compileLookGraph` re-normalizes (clamps) it. This
 * is the single source for "set a look-node scalar param" outside command drafts.
 */
export const withLookNodeParam = (
	payload: LookGraphNodePayload,
	paramKey: string,
	value: number,
): LookGraphNodePayload => {
	switch (payload.kind) {
		case "blur":
			switch (paramKey) {
				case "radius":
					return { ...payload, radius: value };
				case "radiusY":
					// An omitted Y radius is a structural X/Y link. A stale side-car
					// track must not silently break that link during presentation.
					return payload.radiusY === undefined
						? payload
						: { ...payload, radiusY: value };
				default:
					return payload;
			}
		case "chromatic-fringe":
			return paramKey === "amount" ? { ...payload, amount: value } : payload;
		case "displace":
			switch (paramKey) {
				case "scale":
					return { ...payload, scale: value };
				case "frequency":
					return { ...payload, frequency: value };
				case "octaves":
					return { ...payload, octaves: value };
				default:
					return payload;
			}
		case "posterize":
			return paramKey === "levels" ? { ...payload, levels: value } : payload;
		case "color-map":
			return paramKey === "mix" ? { ...payload, mix: value } : payload;
		case "find-edges":
			return paramKey === "mix" ? { ...payload, mix: value } : payload;
		case "scanline":
			switch (paramKey) {
				case "density":
					return { ...payload, density: value };
				case "intensity":
					return { ...payload, intensity: value };
				case "softness":
					return { ...payload, softness: value };
				case "noiseMix":
					return { ...payload, noiseMix: value };
				default:
					return payload;
			}
		case "halftone":
			switch (paramKey) {
				case "cellSize":
					return { ...payload, cellSize: value };
				case "dotSize":
					return { ...payload, dotSize: value };
				case "contrast":
					return { ...payload, contrast: value };
				case "angle":
					return { ...payload, angle: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "pixel-grid":
			switch (paramKey) {
				case "cellSize":
					return { ...payload, cellSize: value };
				case "gap":
					return { ...payload, gap: value };
				case "roundness":
					return { ...payload, roundness: value };
				case "brightness":
					return { ...payload, brightness: value };
				case "contrast":
					return { ...payload, contrast: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "ordered-dither":
			switch (paramKey) {
				case "cellSize":
					return { ...payload, cellSize: value };
				case "matrixSize":
					return { ...payload, matrixSize: value };
				case "levels":
					return { ...payload, levels: value };
				case "contrast":
					return { ...payload, contrast: value };
				case "threshold":
					return { ...payload, threshold: value };
				case "strength":
					return { ...payload, strength: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "ascii-glyph":
			switch (paramKey) {
				case "cellSize":
					return { ...payload, cellSize: value };
				case "glyphScale":
					return { ...payload, glyphScale: value };
				case "contrast":
					return { ...payload, contrast: value };
				case "brightness":
					return { ...payload, brightness: value };
				case "densityBias":
					return { ...payload, densityBias: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "block-mosaic":
			switch (paramKey) {
				case "cellSize":
					return { ...payload, cellSize: value };
				case "gap":
					return { ...payload, gap: value };
				case "bevel":
					return { ...payload, bevel: value };
				case "relief":
					return { ...payload, relief: value };
				case "lightAngle":
					return { ...payload, lightAngle: value };
				case "lightElevation":
					return { ...payload, lightElevation: value };
				case "contrast":
					return { ...payload, contrast: value };
				case "variation":
					return { ...payload, variation: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "noise-field":
			switch (paramKey) {
				case "scale":
					return { ...payload, scale: value };
				case "detail":
					return { ...payload, detail: value };
				case "seed":
					return { ...payload, seed: value };
				default:
					return payload;
			}
		case "warp":
			switch (paramKey) {
				case "strength":
					return { ...payload, strength: value };
				case "centerX":
					return { ...payload, centerX: value };
				case "centerY":
					return { ...payload, centerY: value };
				default:
					return payload;
			}
		case "lens":
			switch (paramKey) {
				case "size":
					return { ...payload, size: value };
				case "convergence":
					return { ...payload, convergence: value };
				case "centerX":
					return { ...payload, centerX: value };
				case "centerY":
					return { ...payload, centerY: value };
				default:
					return payload;
			}
		case "kaleidoscope":
			switch (paramKey) {
				case "segments":
					return { ...payload, segments: value };
				case "centerX":
					return { ...payload, centerX: value };
				case "centerY":
					return { ...payload, centerY: value };
				case "roll":
					return { ...payload, roll: value };
				default:
					return payload;
			}
		case "flow":
			switch (paramKey) {
				case "amount":
					return { ...payload, amount: value };
				case "scale":
					return { ...payload, scale: value };
				case "octaves":
					return { ...payload, octaves: value };
				case "evolution":
					return { ...payload, evolution: value };
				case "centerX":
					return { ...payload, centerX: value };
				case "centerY":
					return { ...payload, centerY: value };
				default:
					return payload;
			}
		case "path-blur":
			// Per-guide speeds + guide geometry are not bindable here; only the
			// frame-level scalars route through this seam (compile re-normalizes).
			switch (paramKey) {
				case "speed":
					return { ...payload, speed: value };
				case "length":
					return { ...payload, length: value };
				case "taper":
					return { ...payload, taper: value };
				case "strobeStrength":
					return { ...payload, strobeStrength: value };
				case "strobeFlashes":
					return { ...payload, strobeFlashes: value };
				default:
					return payload;
			}
		case "noise-source":
			switch (paramKey) {
				case "scale":
					return { ...payload, scale: value };
				case "octaves":
					return { ...payload, octaves: value };
				case "evolution":
					return { ...payload, evolution: value };
				case "speed":
					return { ...payload, speed: value };
				default:
					return payload;
			}
		case "deep-glow":
			switch (paramKey) {
				case "radius":
					return { ...payload, radius: value };
				case "intensity":
					return { ...payload, intensity: value };
				case "threshold":
					return { ...payload, threshold: value };
				case "chroma":
					return { ...payload, chroma: value };
				default:
					return payload;
			}
		case "riso":
			switch (paramKey) {
				case "cellSize":
					return { ...payload, cellSize: value };
				case "dotSize":
					return { ...payload, dotSize: value };
				case "contrast":
					return { ...payload, contrast: value };
				case "grain":
					return { ...payload, grain: value };
				case "mix":
					return { ...payload, mix: value };
				case "bloomProgress":
					return { ...payload, bloomProgress: value };
				case "amount":
					return { ...payload, amount: value };
				default:
					return payload;
			}
		case "colorama":
			switch (paramKey) {
				case "phase":
					return { ...payload, phase: value };
				case "repetitions":
					return { ...payload, repetitions: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "wave-warp":
			switch (paramKey) {
				case "height":
					return { ...payload, height: value };
				case "width":
					return { ...payload, width: value };
				case "direction":
					return { ...payload, direction: value };
				case "phase":
					return { ...payload, phase: value };
				default:
					return payload;
			}
		case "bend-warp":
			switch (paramKey) {
				case "bend":
					return { ...payload, bend: value };
				case "distortionH":
					return { ...payload, distortionH: value };
				case "distortionV":
					return { ...payload, distortionV: value };
				case "scale":
					return { ...payload, scale: value };
				default:
					return payload;
			}
		case "vhs-color":
			switch (paramKey) {
				case "bleed":
					return { ...payload, bleed: value };
				case "subsample":
					return { ...payload, subsample: value };
				case "colorUnder":
					return { ...payload, colorUnder: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "vhs-tracking":
			switch (paramKey) {
				case "jitter":
					return { ...payload, jitter: value };
				case "wobble":
					return { ...payload, wobble: value };
				case "tear":
					return { ...payload, tear: value };
				case "band":
					return { ...payload, band: value };
				case "bandPosition":
					return { ...payload, bandPosition: value };
				case "speed":
					return { ...payload, speed: value };
				case "seed":
					return { ...payload, seed: value };
				case "mix":
					return { ...payload, mix: value };
				case "evolution":
					return { ...payload, evolution: value };
				default:
					return payload;
			}
		case "vhs-noise":
			switch (paramKey) {
				case "snow":
					return { ...payload, snow: value };
				case "dropout":
					return { ...payload, dropout: value };
				case "dropoutLength":
					return { ...payload, dropoutLength: value };
				case "generation":
					return { ...payload, generation: value };
				case "speed":
					return { ...payload, speed: value };
				case "seed":
					return { ...payload, seed: value };
				case "mix":
					return { ...payload, mix: value };
				case "evolution":
					return { ...payload, evolution: value };
				default:
					return payload;
			}
		case "crt-display":
			switch (paramKey) {
				case "maskScale":
					return { ...payload, maskScale: value };
				case "maskStrength":
					return { ...payload, maskStrength: value };
				case "curvature":
					return { ...payload, curvature: value };
				case "cornerRadius":
					return { ...payload, cornerRadius: value };
				case "vignette":
					return { ...payload, vignette: value };
				case "mix":
					return { ...payload, mix: value };
				default:
					return payload;
			}
		case "signal-glitch":
			switch (paramKey) {
				case "channelShift":
					return { ...payload, channelShift: value };
				case "rollAmount":
					return { ...payload, rollAmount: value };
				case "tearDensity":
					return { ...payload, tearDensity: value };
				case "tearStrength":
					return { ...payload, tearStrength: value };
				case "speed":
					return { ...payload, speed: value };
				case "seed":
					return { ...payload, seed: value };
				case "mix":
					return { ...payload, mix: value };
				case "evolution":
					return { ...payload, evolution: value };
				default:
					return payload;
			}
		case "interlace":
			switch (paramKey) {
				case "strength":
					return { ...payload, strength: value };
				case "fieldOffset":
					return { ...payload, fieldOffset: value };
				case "flicker":
					return { ...payload, flicker: value };
				case "speed":
					return { ...payload, speed: value };
				case "mix":
					return { ...payload, mix: value };
				case "evolution":
					return { ...payload, evolution: value };
				default:
					return payload;
			}
		case "mask":
			return paramKey === "feather" ? { ...payload, feather: value } : payload;
		case "composite":
			return paramKey === "mix" ? { ...payload, mix: value } : payload;
		default:
			return payload;
	}
};

/** Deterministic owner id segment shared by generated node ids. */
const ownerSegment = (owner: LookGraphOwnerRef): string => {
	switch (owner.scope) {
		case "scene":
			return "scene";
		case "artboard":
			return `artboard-${svgIdSegment(owner.artboardId)}`;
		case "node":
			return `node-${svgIdSegment(owner.nodeId)}`;
		case "scoped-overlay":
			return `scoped-${svgIdSegment(owner.artboardId)}-${svgIdSegment(
				owner.scopedLookId,
			)}`;
	}
};

/** Stable id for a generated boundary/effect node (`<owner>-look-<role>`). */
export const lookGraphNodeId = (
	owner: LookGraphOwnerRef,
	role: string,
): string => `${ownerSegment(owner)}-look-${svgIdSegment(role)}`;

/** Stable id seed for a node generated from one compatibility stack layer. */
export const lookGraphNodeIdFromLayer = (
	owner: LookGraphOwnerRef,
	layerId: string,
): string => `${ownerSegment(owner)}-looknode-${svgIdSegment(layerId)}`;

/** Deterministic port id (`<nodeId>:in|out:<name>`). No counter/clock. */
export const lookGraphPortId = (
	nodeId: string,
	direction: LookGraphPortDirection,
	name: string,
): string => `${nodeId}:${direction === "input" ? "in" : "out"}:${name}`;

/** Deterministic edge id derived from its endpoints. */
export const lookGraphEdgeId = (
	from: LookGraphEndpoint,
	to: LookGraphEndpoint,
): string => `${from.portId}->${to.portId}`;

const port = (
	nodeId: string,
	direction: LookGraphPortDirection,
	name: string,
	valueType: LookGraphValueType,
	cardinality: LookGraphPortCardinality = "single",
): LookGraphPort => ({
	id: lookGraphPortId(nodeId, direction, name),
	name,
	direction,
	valueType,
	cardinality,
});

type NodePorts = {
	readonly inputs: readonly LookGraphPort[];
	readonly outputs: readonly LookGraphPort[];
};

/**
 * Node-id-independent port description (name + value type + cardinality). This is
 * the single source the node-id-scoped {@link LookGraphPort}s are minted from, so
 * a capability catalog and the normalizer cannot advertise diverging ports.
 */
export type LookGraphPortSpec = {
	readonly name: string;
	readonly valueType: LookGraphValueType;
	readonly cardinality: LookGraphPortCardinality;
};

export type LookGraphNodeParamSpec =
	| {
			readonly key: string;
			readonly valueType: "number";
			readonly defaultValue: number;
			readonly min?: number;
			readonly max?: number;
			readonly step?: number;
			readonly values?: readonly number[];
			readonly unit?: "scene-px" | "ratio" | "degrees" | "levels";
			/** Explicit wire value that removes an optional parameter, when supported. */
			readonly clearValue?: null;
	  }
	| {
			readonly key: string;
			readonly valueType: "enum";
			readonly defaultValue: string;
			readonly values: readonly string[];
	  }
	| {
			readonly key: string;
			readonly valueType: "boolean";
			readonly defaultValue: boolean;
	  };

type NodePortSpec = {
	readonly inputs: readonly LookGraphPortSpec[];
	readonly outputs: readonly LookGraphPortSpec[];
};

const IMAGE_PORT: LookGraphPortSpec = {
	name: "image",
	valueType: "image",
	cardinality: "single",
};
const MASK_INPUT_PORT: LookGraphPortSpec = {
	name: "mask",
	valueType: "mask",
	cardinality: "single",
};
const MASK_OUTPUT_PORT: LookGraphPortSpec = {
	name: "mask",
	valueType: "mask",
	cardinality: "single",
};
const EFFECT_NODE_PORTS: NodePortSpec = {
	inputs: [IMAGE_PORT, MASK_INPUT_PORT],
	outputs: [IMAGE_PORT],
};
const IMAGE_EFFECT_NODE_PORTS: NodePortSpec = {
	inputs: [IMAGE_PORT],
	outputs: [IMAGE_PORT],
};

const LOOK_GRAPH_MASK_SOURCE_VALUES: readonly LookGraphMaskSource[] = [
	"none",
	"source-alpha",
	"previous-alpha",
	"previous-luminance",
	"mask",
];

const BLEND_MODES: readonly BlendMode[] = [
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
];

/**
 * Canonical, deterministic port catalog keyed by node kind. Exported so the
 * agent/MCP capability surface advertises exactly the ports the normalizer mints.
 */
export const LOOK_GRAPH_NODE_PORT_CATALOG: Readonly<
	Record<LookGraphNodeKind, NodePortSpec>
> = {
	source: { inputs: [], outputs: [IMAGE_PORT] },
	output: { inputs: [IMAGE_PORT], outputs: [] },
	grade: EFFECT_NODE_PORTS,
	glow: EFFECT_NODE_PORTS,
	grain: EFFECT_NODE_PORTS,
	blur: EFFECT_NODE_PORTS,
	"chromatic-fringe": EFFECT_NODE_PORTS,
	displace: EFFECT_NODE_PORTS,
	posterize: EFFECT_NODE_PORTS,
	"color-map": EFFECT_NODE_PORTS,
	"find-edges": EFFECT_NODE_PORTS,
	scanline: EFFECT_NODE_PORTS,
	halftone: IMAGE_EFFECT_NODE_PORTS,
	"pixel-grid": IMAGE_EFFECT_NODE_PORTS,
	"ordered-dither": IMAGE_EFFECT_NODE_PORTS,
	"ascii-glyph": IMAGE_EFFECT_NODE_PORTS,
	"block-mosaic": IMAGE_EFFECT_NODE_PORTS,
	// A generator/source: no image input, one image output (same shape as `source`).
	"noise-field": { inputs: [], outputs: [IMAGE_PORT] },
	warp: EFFECT_NODE_PORTS,
	lens: EFFECT_NODE_PORTS,
	kaleidoscope: EFFECT_NODE_PORTS,
	flow: EFFECT_NODE_PORTS,
	"path-blur": EFFECT_NODE_PORTS,
	// A GPU generator/source: no image input, one image output (same shape as `source`).
	"noise-source": { inputs: [], outputs: [IMAGE_PORT] },
	"deep-glow": EFFECT_NODE_PORTS,
	riso: IMAGE_EFFECT_NODE_PORTS,
	colorama: EFFECT_NODE_PORTS,
	"wave-warp": EFFECT_NODE_PORTS,
	"bend-warp": EFFECT_NODE_PORTS,
	"vhs-color": EFFECT_NODE_PORTS,
	"vhs-tracking": EFFECT_NODE_PORTS,
	"vhs-noise": EFFECT_NODE_PORTS,
	"crt-display": EFFECT_NODE_PORTS,
	"signal-glitch": EFFECT_NODE_PORTS,
	interlace: EFFECT_NODE_PORTS,
	mask: { inputs: [IMAGE_PORT], outputs: [MASK_OUTPUT_PORT] },
	composite: {
		inputs: [
			{ name: "base", valueType: "image", cardinality: "single" },
			{ name: "overlay", valueType: "image", cardinality: "single" },
		],
		outputs: [IMAGE_PORT],
	},
};

/**
 * Agent-facing payload parameter catalog. UI affordances can keep richer labels
 * and grouping in feature code, while MCP clients get enough typed metadata to
 * add a node, patch canonical payload fields, and keyframe scalar params without
 * guessing ranges or enum values.
 */
export const LOOK_GRAPH_NODE_PARAM_CATALOG: Partial<
	Record<LookGraphNodeKind, readonly LookGraphNodeParamSpec[]>
> = {
	blur: [
		{
			key: "radius",
			valueType: "number",
			defaultValue: DEFAULT_BLUR_RADIUS,
			min: 0,
			max: 80,
			step: 1,
			unit: "scene-px",
		},
		{
			// Optional y-axis radius; equal to `radius` until set independently. A null
			// sparse-patch value clears it so MCP and UI relinking share one contract.
			key: "radiusY",
			valueType: "number",
			defaultValue: DEFAULT_BLUR_RADIUS,
			min: 0,
			max: 80,
			step: 1,
			unit: "scene-px",
			clearValue: null,
		},
	],
	"chromatic-fringe": [
		{
			key: "amount",
			valueType: "number",
			defaultValue: DEFAULT_FRINGE_AMOUNT,
			min: 0,
			max: 10,
			step: 0.1,
			unit: "scene-px",
		},
	],
	displace: [
		{
			key: "scale",
			valueType: "number",
			defaultValue: DEFAULT_DISPLACE_SCALE,
			min: 0,
			max: 60,
			step: 1,
			unit: "scene-px",
		},
		{
			key: "frequency",
			valueType: "number",
			defaultValue: DEFAULT_DISPLACE_FREQUENCY,
			min: 0.005,
			max: 0.2,
			step: 0.005,
		},
		{
			key: "octaves",
			valueType: "number",
			defaultValue: DEFAULT_DISPLACE_OCTAVES,
			min: MIN_DISPLACE_OCTAVES,
			max: MAX_DISPLACE_OCTAVES,
			step: 1,
		},
	],
	posterize: [
		{
			key: "levels",
			valueType: "number",
			defaultValue: DEFAULT_POSTERIZE_LEVELS,
			min: MIN_POSTERIZE_LEVELS,
			max: MAX_POSTERIZE_LEVELS,
			step: 1,
			unit: "levels",
		},
	],
	"color-map": [
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_COLOR_MAP_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
	],
	"find-edges": [
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_FIND_EDGES_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
	],
	scanline: [
		{
			key: "density",
			valueType: "number",
			defaultValue: DEFAULT_SCANLINE_DENSITY,
			min: MIN_SCANLINE_DENSITY,
			max: MAX_SCANLINE_DENSITY,
		},
		{
			key: "intensity",
			valueType: "number",
			defaultValue: DEFAULT_SCANLINE_INTENSITY,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "softness",
			valueType: "number",
			defaultValue: DEFAULT_SCANLINE_SOFTNESS,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "noiseMix",
			valueType: "number",
			defaultValue: DEFAULT_SCANLINE_NOISE_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
	],
	halftone: [
		{
			key: "cellSize",
			valueType: "number",
			defaultValue: DEFAULT_HALFTONE_CELL_SIZE,
			min: MIN_HALFTONE_CELL_SIZE,
			max: MAX_HALFTONE_CELL_SIZE,
			unit: "scene-px",
		},
		{
			key: "dotSize",
			valueType: "number",
			defaultValue: DEFAULT_HALFTONE_DOT_SIZE,
			min: MIN_HALFTONE_DOT_SIZE,
			max: MAX_HALFTONE_DOT_SIZE,
			unit: "ratio",
		},
		{
			key: "contrast",
			valueType: "number",
			defaultValue: DEFAULT_HALFTONE_CONTRAST,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "angle",
			valueType: "number",
			defaultValue: DEFAULT_HALFTONE_ANGLE,
			min: MIN_HALFTONE_ANGLE,
			max: MAX_HALFTONE_ANGLE,
			unit: "degrees",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_HALFTONE_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
	],
	"pixel-grid": [
		{
			key: "cellSize",
			valueType: "number",
			defaultValue: DEFAULT_PIXEL_GRID_CELL_SIZE,
			min: MIN_PIXEL_GRID_CELL_SIZE,
			max: MAX_PIXEL_GRID_CELL_SIZE,
			unit: "scene-px",
		},
		{
			key: "gap",
			valueType: "number",
			defaultValue: DEFAULT_PIXEL_GRID_GAP,
			min: 0,
			max: MAX_PIXEL_GRID_GAP,
			unit: "ratio",
		},
		{
			key: "roundness",
			valueType: "number",
			defaultValue: DEFAULT_PIXEL_GRID_ROUNDNESS,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "brightness",
			valueType: "number",
			defaultValue: DEFAULT_PIXEL_GRID_BRIGHTNESS,
			min: 0,
			max: MAX_PIXEL_GRID_BRIGHTNESS,
			unit: "ratio",
		},
		{
			key: "contrast",
			valueType: "number",
			defaultValue: DEFAULT_PIXEL_GRID_CONTRAST,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_PIXEL_GRID_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
	],
	"ordered-dither": [
		{
			key: "cellSize",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_CELL_SIZE,
			min: MIN_ORDERED_DITHER_CELL_SIZE,
			max: MAX_ORDERED_DITHER_CELL_SIZE,
			unit: "scene-px",
		},
		{
			key: "matrixSize",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_MATRIX_SIZE,
			values: [2, 4, 8],
		},
		{
			key: "levels",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_LEVELS,
			min: MIN_ORDERED_DITHER_LEVELS,
			max: MAX_ORDERED_DITHER_LEVELS,
			step: 1,
			unit: "levels",
		},
		{
			key: "mode",
			valueType: "enum",
			defaultValue: DEFAULT_ORDERED_DITHER_MODE,
			values: ["luminance", "rgb"],
		},
		{
			key: "pattern",
			valueType: "enum",
			defaultValue: DEFAULT_ORDERED_DITHER_PATTERN,
			values: ["blue-noise", "bayer"],
		},
		{
			key: "contrast",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_CONTRAST,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "threshold",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_THRESHOLD,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "strength",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_STRENGTH,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "brightness",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_BRIGHTNESS,
			min: MIN_ORDERED_DITHER_BRIGHTNESS,
			max: MAX_ORDERED_DITHER_BRIGHTNESS,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "gamma",
			valueType: "number",
			defaultValue: DEFAULT_ORDERED_DITHER_GAMMA,
			min: MIN_ORDERED_DITHER_GAMMA,
			max: MAX_ORDERED_DITHER_GAMMA,
			step: 0.01,
			unit: "ratio",
		},
	],
	"ascii-glyph": [
		{
			key: "cellSize",
			valueType: "number",
			defaultValue: DEFAULT_ASCII_GLYPH_CELL_SIZE,
			min: MIN_ASCII_GLYPH_CELL_SIZE,
			max: MAX_ASCII_GLYPH_CELL_SIZE,
			unit: "scene-px",
		},
		{
			key: "glyphScale",
			valueType: "number",
			defaultValue: DEFAULT_ASCII_GLYPH_SCALE,
			min: MIN_ASCII_GLYPH_SCALE,
			max: MAX_ASCII_GLYPH_SCALE,
			unit: "ratio",
		},
		{
			key: "contrast",
			valueType: "number",
			defaultValue: DEFAULT_ASCII_GLYPH_CONTRAST,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "brightness",
			valueType: "number",
			defaultValue: DEFAULT_ASCII_GLYPH_BRIGHTNESS,
			min: 0,
			max: MAX_ASCII_GLYPH_BRIGHTNESS,
			unit: "ratio",
		},
		{
			key: "densityBias",
			valueType: "number",
			defaultValue: DEFAULT_ASCII_GLYPH_DENSITY_BIAS,
			min: -1,
			max: 1,
			unit: "ratio",
		},
		{
			key: "invert",
			valueType: "boolean",
			defaultValue: false,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_ASCII_GLYPH_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
	],
	"block-mosaic": [
		{
			key: "cellSize",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_CELL_SIZE,
			min: MIN_BLOCK_MOSAIC_CELL_SIZE,
			max: MAX_BLOCK_MOSAIC_CELL_SIZE,
			unit: "scene-px",
		},
		{
			key: "gap",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_GAP,
			min: 0,
			max: MAX_BLOCK_MOSAIC_GAP,
			unit: "ratio",
		},
		{
			key: "bevel",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_BEVEL,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "relief",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_RELIEF,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "lightAngle",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_LIGHT_ANGLE,
			min: MIN_BLOCK_MOSAIC_LIGHT_ANGLE,
			max: MAX_BLOCK_MOSAIC_LIGHT_ANGLE,
			unit: "degrees",
		},
		{
			key: "lightElevation",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_LIGHT_ELEVATION,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "contrast",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_CONTRAST,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "variation",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_VARIATION,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_BLOCK_MOSAIC_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
	],
	"noise-field": [
		{
			key: "type",
			valueType: "enum",
			defaultValue: DEFAULT_NOISE_FIELD_TYPE,
			values: ["fractalNoise", "turbulence"],
		},
		{
			key: "scale",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_FIELD_SCALE,
			min: MIN_NOISE_FIELD_SCALE,
			max: MAX_NOISE_FIELD_SCALE,
			step: 1,
		},
		{
			key: "detail",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_FIELD_DETAIL,
			min: MIN_NOISE_FIELD_DETAIL,
			max: MAX_NOISE_FIELD_DETAIL,
			step: 1,
		},
		{
			key: "seed",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_FIELD_SEED,
			min: 0,
			max: 64,
			step: 1,
		},
	],
	warp: [
		{
			key: "mode",
			valueType: "enum",
			defaultValue: "radial",
			values: ["radial", "twirl"],
		},
		{
			key: "strength",
			valueType: "number",
			defaultValue: DEFAULT_WARP_STRENGTH,
			min: -1,
			max: 1,
			step: 0.02,
			unit: "ratio",
		},
		{
			key: "centerX",
			valueType: "number",
			defaultValue: DEFAULT_WARP_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "centerY",
			valueType: "number",
			defaultValue: DEFAULT_WARP_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
	],
	lens: [
		{
			key: "size",
			valueType: "number",
			defaultValue: DEFAULT_LENS_SIZE,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "convergence",
			valueType: "number",
			defaultValue: DEFAULT_LENS_CONVERGENCE,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "centerX",
			valueType: "number",
			defaultValue: DEFAULT_LENS_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "centerY",
			valueType: "number",
			defaultValue: DEFAULT_LENS_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "clipToRim",
			valueType: "boolean",
			defaultValue: false,
		},
	],
	kaleidoscope: [
		{
			key: "segments",
			valueType: "number",
			defaultValue: DEFAULT_KALEIDOSCOPE_SEGMENTS,
			min: MIN_KALEIDOSCOPE_SEGMENTS,
			max: MAX_KALEIDOSCOPE_SEGMENTS,
			step: 1,
		},
		{
			key: "centerX",
			valueType: "number",
			defaultValue: DEFAULT_KALEIDOSCOPE_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "centerY",
			valueType: "number",
			defaultValue: DEFAULT_KALEIDOSCOPE_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "roll",
			valueType: "number",
			defaultValue: DEFAULT_KALEIDOSCOPE_ROLL,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
	],
	flow: [
		{
			key: "pattern",
			valueType: "enum",
			defaultValue: "turbulent",
			values: ["bulge", "turbulent", "twist"],
		},
		{
			key: "amount",
			valueType: "number",
			defaultValue: DEFAULT_FLOW_AMOUNT,
			min: 0,
			max: 0.5,
			step: 0.005,
			unit: "ratio",
		},
		{
			key: "scale",
			valueType: "number",
			defaultValue: DEFAULT_FLOW_SCALE,
			min: 0,
			max: 24,
			step: 0.1,
		},
		{
			key: "octaves",
			valueType: "number",
			defaultValue: DEFAULT_FLOW_OCTAVES,
			min: MIN_FLOW_OCTAVES,
			max: MAX_FLOW_OCTAVES,
			step: 1,
		},
		{
			key: "evolution",
			valueType: "number",
			defaultValue: DEFAULT_FLOW_EVOLUTION,
			min: 0,
			max: 4,
			step: 0.01,
		},
		{
			key: "centerX",
			valueType: "number",
			defaultValue: DEFAULT_FLOW_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "centerY",
			valueType: "number",
			defaultValue: DEFAULT_FLOW_CENTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
	],
	"path-blur": [
		{
			key: "speed",
			valueType: "number",
			defaultValue: DEFAULT_PATH_BLUR_SPEED,
			min: MIN_PATH_BLUR_SPEED,
			max: MAX_PATH_BLUR_SPEED,
			step: 1,
		},
		{
			key: "length",
			valueType: "number",
			defaultValue: DEFAULT_PATH_BLUR_LENGTH,
			min: 0,
			max: MAX_PATH_BLUR_LENGTH,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "taper",
			valueType: "number",
			defaultValue: DEFAULT_PATH_BLUR_TAPER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "centeredBlur",
			valueType: "boolean",
			defaultValue: DEFAULT_PATH_BLUR_CENTERED,
		},
		{
			key: "strobeStrength",
			valueType: "number",
			defaultValue: DEFAULT_PATH_BLUR_STROBE_STRENGTH,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "strobeFlashes",
			valueType: "number",
			defaultValue: DEFAULT_PATH_BLUR_STROBE_FLASHES,
			min: 0,
			max: MAX_PATH_BLUR_STROBE_FLASHES,
			step: 1,
		},
	],
	"noise-source": [
		{
			key: "scale",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_SOURCE_SCALE,
			min: MIN_NOISE_SOURCE_SCALE,
			max: MAX_NOISE_SOURCE_SCALE,
			step: 1,
		},
		{
			key: "octaves",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_SOURCE_OCTAVES,
			min: MIN_NOISE_SOURCE_OCTAVES,
			max: MAX_NOISE_SOURCE_OCTAVES,
			step: 1,
		},
		{
			key: "evolution",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_SOURCE_EVOLUTION,
			min: 0,
			max: 8,
			step: 0.01,
		},
		{
			key: "speed",
			valueType: "number",
			defaultValue: DEFAULT_NOISE_SOURCE_SPEED,
			min: 0,
			max: MAX_NOISE_SOURCE_SPEED,
			step: 0.01,
		},
	],
	"deep-glow": [
		{
			key: "radius",
			valueType: "number",
			defaultValue: DEFAULT_DEEP_GLOW_RADIUS,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "intensity",
			valueType: "number",
			defaultValue: DEFAULT_DEEP_GLOW_INTENSITY,
			min: 0,
			max: MAX_DEEP_GLOW_INTENSITY,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "threshold",
			valueType: "number",
			defaultValue: DEFAULT_DEEP_GLOW_THRESHOLD,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "chroma",
			valueType: "number",
			defaultValue: DEFAULT_DEEP_GLOW_CHROMA,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "blendMode",
			valueType: "enum",
			defaultValue: DEFAULT_DEEP_GLOW_BLEND_MODE,
			values: BLEND_MODES,
		},
	],
	riso: [
		{
			key: "cellSize",
			valueType: "number",
			defaultValue: DEFAULT_RISO_CELL_SIZE,
			min: MIN_RISO_CELL_SIZE,
			max: MAX_RISO_CELL_SIZE,
			unit: "scene-px",
		},
		{
			key: "dotSize",
			valueType: "number",
			defaultValue: DEFAULT_RISO_DOT_SIZE,
			min: MIN_RISO_DOT_SIZE,
			max: MAX_RISO_DOT_SIZE,
			unit: "ratio",
		},
		{
			key: "contrast",
			valueType: "number",
			defaultValue: DEFAULT_RISO_CONTRAST,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "grain",
			valueType: "number",
			defaultValue: DEFAULT_RISO_GRAIN,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_RISO_MIX,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "bloomProgress",
			valueType: "number",
			defaultValue: DEFAULT_RISO_BLOOM_PROGRESS,
			min: 0,
			max: 1,
			unit: "ratio",
		},
		{
			key: "amount",
			valueType: "number",
			defaultValue: DEFAULT_RISO_AMOUNT,
			min: 0,
			max: 1,
			unit: "ratio",
		},
	],
	colorama: [
		{
			key: "phase",
			valueType: "number",
			defaultValue: DEFAULT_COLORAMA_PHASE,
			min: 0,
			max: 4,
			step: 0.01,
		},
		{
			key: "repetitions",
			valueType: "number",
			defaultValue: DEFAULT_COLORAMA_REPETITIONS,
			min: MIN_COLORAMA_REPETITIONS,
			max: MAX_COLORAMA_REPETITIONS,
			step: 1,
		},
		{
			// Not keyframeable: `isLookGraphNodeParamKeyframable` gates on
			// `valueType === "number"`, so this enum correctly stays a static
			// payload switch, like wave-warp's `waveType`.
			key: "inputPhase",
			valueType: "enum",
			defaultValue: DEFAULT_COLORAMA_INPUT_PHASE,
			values: COLORAMA_INPUT_PHASES,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_COLORAMA_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
	],
	"wave-warp": [
		{
			key: "height",
			valueType: "number",
			defaultValue: DEFAULT_WAVE_WARP_HEIGHT,
			min: MIN_WAVE_WARP_HEIGHT,
			max: MAX_WAVE_WARP_HEIGHT,
			unit: "scene-px",
		},
		{
			key: "width",
			valueType: "number",
			defaultValue: DEFAULT_WAVE_WARP_WIDTH,
			min: MIN_WAVE_WARP_WIDTH,
			max: MAX_WAVE_WARP_WIDTH,
			unit: "scene-px",
		},
		{
			key: "direction",
			valueType: "number",
			defaultValue: DEFAULT_WAVE_WARP_DIRECTION,
			min: 0,
			max: FULL_TURN_DEGREES,
			unit: "degrees",
		},
		{
			key: "phase",
			valueType: "number",
			defaultValue: DEFAULT_WAVE_WARP_PHASE,
			min: 0,
			max: 4,
			step: 0.01,
		},
	],
	"bend-warp": [
		{
			key: "bend",
			valueType: "number",
			defaultValue: DEFAULT_BEND_WARP_BEND,
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			key: "distortionH",
			valueType: "number",
			defaultValue: DEFAULT_BEND_WARP_DISTORTION_H,
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			key: "distortionV",
			valueType: "number",
			defaultValue: DEFAULT_BEND_WARP_DISTORTION_V,
			min: -1,
			max: 1,
			step: 0.01,
		},
		{
			key: "scale",
			valueType: "number",
			defaultValue: DEFAULT_BEND_WARP_SCALE,
			min: MIN_BEND_WARP_SCALE,
			max: MAX_BEND_WARP_SCALE,
			step: 0.01,
		},
	],
	"vhs-color": [
		{
			key: "bleed",
			valueType: "number",
			defaultValue: DEFAULT_VHS_COLOR_BLEED,
			min: MIN_VHS_COLOR_BLEED,
			max: MAX_VHS_COLOR_BLEED,
			step: 1,
			unit: "scene-px",
		},
		{
			key: "subsample",
			valueType: "number",
			defaultValue: DEFAULT_VHS_COLOR_SUBSAMPLE,
			min: MIN_VHS_COLOR_SUBSAMPLE,
			max: MAX_VHS_COLOR_SUBSAMPLE,
			step: 1,
		},
		{
			key: "colorUnder",
			valueType: "number",
			defaultValue: DEFAULT_VHS_COLOR_COLOR_UNDER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_VHS_COLOR_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
	],
	"vhs-tracking": [
		{
			key: "jitter",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_JITTER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "wobble",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_WOBBLE,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "tear",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_TEAR,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "band",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_BAND,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "bandPosition",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_BAND_POSITION,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "speed",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_SPEED,
			min: 0,
			max: MAX_VHS_TRACKING_SPEED,
			step: 0.01,
		},
		{
			key: "seed",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_SEED,
			min: 0,
			max: MAX_VHS_TRACKING_SEED,
			step: 1,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
		{
			key: "evolution",
			valueType: "number",
			defaultValue: DEFAULT_VHS_TRACKING_EVOLUTION,
			min: 0,
			max: 8,
			step: 0.01,
		},
	],
	"vhs-noise": [
		{
			key: "snow",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_SNOW,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "dropout",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_DROPOUT,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "dropoutLength",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_DROPOUT_LENGTH,
			min: MIN_VHS_NOISE_DROPOUT_LENGTH,
			max: MAX_VHS_NOISE_DROPOUT_LENGTH,
			step: 1,
			unit: "scene-px",
		},
		{
			key: "generation",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_GENERATION,
			min: MIN_VHS_NOISE_GENERATION,
			max: MAX_VHS_NOISE_GENERATION,
			step: 1,
			unit: "levels",
		},
		{
			key: "speed",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_SPEED,
			min: 0,
			max: MAX_VHS_NOISE_SPEED,
			step: 0.01,
		},
		{
			key: "seed",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_SEED,
			min: 0,
			max: MAX_VHS_NOISE_SEED,
			step: 1,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
		{
			key: "evolution",
			valueType: "number",
			defaultValue: DEFAULT_VHS_NOISE_EVOLUTION,
			min: 0,
			max: 8,
			step: 0.01,
		},
	],
	"crt-display": [
		{
			key: "maskType",
			valueType: "enum",
			defaultValue: DEFAULT_CRT_DISPLAY_MASK_TYPE,
			values: ["aperture", "slot", "shadow"],
		},
		{
			key: "maskScale",
			valueType: "number",
			defaultValue: DEFAULT_CRT_DISPLAY_MASK_SCALE,
			min: MIN_CRT_DISPLAY_MASK_SCALE,
			max: MAX_CRT_DISPLAY_MASK_SCALE,
			step: 1,
			unit: "scene-px",
		},
		{
			key: "maskStrength",
			valueType: "number",
			defaultValue: DEFAULT_CRT_DISPLAY_MASK_STRENGTH,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "curvature",
			valueType: "number",
			defaultValue: DEFAULT_CRT_DISPLAY_CURVATURE,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "cornerRadius",
			valueType: "number",
			defaultValue: DEFAULT_CRT_DISPLAY_CORNER_RADIUS,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "vignette",
			valueType: "number",
			defaultValue: DEFAULT_CRT_DISPLAY_VIGNETTE,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_CRT_DISPLAY_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
	],
	"signal-glitch": [
		{
			key: "channelShift",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_CHANNEL_SHIFT,
			min: MIN_SIGNAL_GLITCH_CHANNEL_SHIFT,
			max: MAX_SIGNAL_GLITCH_CHANNEL_SHIFT,
			step: 0.5,
			unit: "scene-px",
		},
		{
			key: "rollAmount",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_ROLL_AMOUNT,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "tearDensity",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_TEAR_DENSITY,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "tearStrength",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_TEAR_STRENGTH,
			min: 0,
			max: MAX_SIGNAL_GLITCH_TEAR_STRENGTH,
			step: 1,
			unit: "scene-px",
		},
		{
			key: "speed",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_SPEED,
			min: 0,
			max: MAX_SIGNAL_GLITCH_SPEED,
			step: 0.01,
		},
		{
			key: "seed",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_SEED,
			min: 0,
			max: MAX_SIGNAL_GLITCH_SEED,
			step: 1,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
		{
			key: "evolution",
			valueType: "number",
			defaultValue: DEFAULT_SIGNAL_GLITCH_EVOLUTION,
			min: 0,
			max: 8,
			step: 0.01,
		},
	],
	interlace: [
		{
			key: "strength",
			valueType: "number",
			defaultValue: DEFAULT_INTERLACE_STRENGTH,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "fieldOffset",
			valueType: "number",
			defaultValue: DEFAULT_INTERLACE_FIELD_OFFSET,
			min: 0,
			max: MAX_INTERLACE_FIELD_OFFSET,
			step: 0.5,
			unit: "scene-px",
		},
		{
			key: "flicker",
			valueType: "number",
			defaultValue: DEFAULT_INTERLACE_FLICKER,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
		{
			key: "speed",
			valueType: "number",
			defaultValue: DEFAULT_INTERLACE_SPEED,
			min: 0,
			max: MAX_INTERLACE_SPEED,
			step: 0.01,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: DEFAULT_INTERLACE_MIX,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
		{
			key: "evolution",
			valueType: "number",
			defaultValue: DEFAULT_INTERLACE_EVOLUTION,
			min: 0,
			max: 8,
			step: 0.01,
		},
	],
	mask: [
		{
			key: "source",
			valueType: "enum",
			defaultValue: "source-alpha",
			values: LOOK_GRAPH_MASK_SOURCE_VALUES,
		},
		{
			key: "invert",
			valueType: "boolean",
			defaultValue: false,
		},
		{
			key: "feather",
			valueType: "number",
			defaultValue: 0,
			min: 0,
			max: 1,
			step: 0.01,
			unit: "ratio",
		},
	],
	composite: [
		{
			key: "blendMode",
			valueType: "enum",
			defaultValue: "normal",
			values: BLEND_MODES,
		},
		{
			key: "mix",
			valueType: "number",
			defaultValue: 1,
			min: 0,
			max: 1,
			step: 0.05,
			unit: "ratio",
		},
	],
};

/**
 * Returns the canonical agent/MCP parameter spec for one Look node payload key.
 * The catalog is intentionally entity-owned so discovery, write validation, and
 * future agent-side UIs share one scalar/enum/boolean contract.
 */
export const lookGraphNodeParamSpec = (
	kind: LookGraphNodeKind,
	paramKey: string,
): LookGraphNodeParamSpec | undefined =>
	LOOK_GRAPH_NODE_PARAM_CATALOG[kind]?.find((param) => param.key === paramKey);

/**
 * Whether a Look node payload key can be driven through the numeric
 * `lookNodeTracks` side-car. Non-number catalog entries may be patched as static
 * payload, but are rejected by motion keyframe writes.
 */
export const isLookGraphNodeParamKeyframable = (
	kind: LookGraphNodeKind,
	paramKey: string,
): boolean => lookGraphNodeParamSpec(kind, paramKey)?.valueType === "number";

/** Canonical, deterministic port set for one node kind (ids scoped to `nodeId`). */
const portsForKind = (nodeId: string, kind: LookGraphNodeKind): NodePorts => {
	const spec = LOOK_GRAPH_NODE_PORT_CATALOG[kind];
	return {
		inputs: spec.inputs.map((portSpec) =>
			port(
				nodeId,
				"input",
				portSpec.name,
				portSpec.valueType,
				portSpec.cardinality,
			),
		),
		outputs: spec.outputs.map((portSpec) =>
			port(
				nodeId,
				"output",
				portSpec.name,
				portSpec.valueType,
				portSpec.cardinality,
			),
		),
	};
};

/** Port name that receives the primary image input in a serial chain. */
const primaryImageInputName = (kind: LookGraphNodeKind): string =>
	kind === "composite" ? "base" : "image";

const normalizeMaskSource = (
	value: unknown,
): LookGraphMaskSource | undefined => {
	return LOOK_GRAPH_MASK_SOURCE_VALUES.includes(value as LookGraphMaskSource)
		? (value as LookGraphMaskSource)
		: undefined;
};

const isBlendMode = (value: unknown): value is BlendMode =>
	BLEND_MODES.includes(value as BlendMode);

/**
 * Narrow guard for {@link RisoBlendMode} — deliberately separate from
 * {@link isBlendMode}, whose 16-value {@link BlendMode} catalog would accept
 * modes (e.g. `"darken"`) the riso shader never implements.
 */
const isRisoBlendMode = (value: unknown): value is RisoBlendMode =>
	RISO_BLEND_MODES.includes(value as RisoBlendMode);

/**
 * Normalizes one draft ink into a valid {@link RisoInk}: clamps the screen
 * angle/offsets to their authorable ranges and falls back to the matching
 * {@link DEFAULT_RISO_INKS} entry's colour on an invalid hex (rather than a
 * fixed fallback) so a malformed single field doesn't discard an otherwise
 * intentional colour choice made via the other default ink.
 */
const normalizeRisoInk = (
	ink: Partial<RisoInk> | undefined,
	fallback: RisoInk,
): RisoInk => ({
	color: normalizeColorOr(ink?.color, fallback.color),
	angle: clampToRange(
		finiteOr(ink?.angle, fallback.angle),
		MIN_RISO_INK_ANGLE,
		MAX_RISO_INK_ANGLE,
	),
	offsetX: clampToRange(
		finiteOr(ink?.offsetX, fallback.offsetX),
		MIN_RISO_INK_OFFSET,
		MAX_RISO_INK_OFFSET,
	),
	offsetY: clampToRange(
		finiteOr(ink?.offsetY, fallback.offsetY),
		MIN_RISO_INK_OFFSET,
		MAX_RISO_INK_OFFSET,
	),
});

/**
 * Normalizes a draft ink list to 1..3 entries. An empty/missing draft falls
 * back to the full {@link DEFAULT_RISO_INKS} set (never a single ink) so a
 * freshly-inserted node reads as an obvious two-colour risograph print; a
 * partial draft ink is repaired against its positional default so, e.g.,
 * clearing just the first ink's colour cannot blank the whole print.
 */
const normalizeRisoInks = (
	draft: readonly Partial<RisoInk>[] | undefined,
): readonly RisoInk[] => {
	if (!draft || draft.length === 0) return DEFAULT_RISO_INKS;
	const count = clampToRange(draft.length, MIN_RISO_INKS, MAX_RISO_INKS);
	return draft
		.slice(0, count)
		.map((ink, index) =>
			normalizeRisoInk(
				ink,
				DEFAULT_RISO_INKS[index % DEFAULT_RISO_INKS.length],
			),
		);
};

/** Narrow guard for {@link RisoFieldMode}. */
const isRisoFieldMode = (value: unknown): value is RisoFieldMode =>
	RISO_FIELD_MODES.includes(value as RisoFieldMode);

/**
 * Normalizes a draft `riso.field` into a valid {@link RisoField}: clamps
 * gradient/radial coordinates to their authorable range (which extends past
 * 0..1 so a start/end/centre can sit off the object edge), the radius to a
 * positive authorable range, softness to 0..1, and falls back per-field to
 * {@link fallback} (not a fixed default) so a partial draft — e.g. only
 * `mode` changing — cannot blank the rest of an intentionally authored field.
 */
const normalizeRisoField = (
	draft: Partial<RisoField> | undefined,
	fallback: RisoField = DEFAULT_RISO_FIELD,
): RisoField => ({
	mode: isRisoFieldMode(draft?.mode) ? draft.mode : fallback.mode,
	x1: clampToRange(
		finiteOr(draft?.x1, fallback.x1),
		MIN_RISO_FIELD_COORD,
		MAX_RISO_FIELD_COORD,
	),
	y1: clampToRange(
		finiteOr(draft?.y1, fallback.y1),
		MIN_RISO_FIELD_COORD,
		MAX_RISO_FIELD_COORD,
	),
	x2: clampToRange(
		finiteOr(draft?.x2, fallback.x2),
		MIN_RISO_FIELD_COORD,
		MAX_RISO_FIELD_COORD,
	),
	y2: clampToRange(
		finiteOr(draft?.y2, fallback.y2),
		MIN_RISO_FIELD_COORD,
		MAX_RISO_FIELD_COORD,
	),
	cx: clampToRange(
		finiteOr(draft?.cx, fallback.cx),
		MIN_RISO_FIELD_COORD,
		MAX_RISO_FIELD_COORD,
	),
	cy: clampToRange(
		finiteOr(draft?.cy, fallback.cy),
		MIN_RISO_FIELD_COORD,
		MAX_RISO_FIELD_COORD,
	),
	radius: clampToRange(
		finiteOr(draft?.radius, fallback.radius),
		MIN_RISO_FIELD_RADIUS,
		MAX_RISO_FIELD_RADIUS,
	),
	softness: clamp01(finiteOr(draft?.softness, fallback.softness)),
	invert: draft?.invert === undefined ? fallback.invert : draft.invert === true,
});

/**
 * Normalizes a draft `colorama` ramp to 1..{@link MAX_COLORAMA_STOPS} entries,
 * sorted ascending by offset. An empty/missing draft falls back to the default
 * black→white pair (never zero stops, which would leave the shader's `rampAt`
 * with no anchor colour). An invalid hex on a stop normalizes to `"#000000"`
 * rather than dropping the stop, so one malformed field cannot shrink the ramp.
 */
const normalizeColoramaStops = (
	draft: readonly Partial<ColoramaStop>[] | undefined,
): readonly ColoramaStop[] => {
	if (!draft || draft.length === 0) return DEFAULT_COLORAMA_STOPS;
	return draft
		.slice(0, MAX_COLORAMA_STOPS)
		.map((stop) => ({
			offset: clamp01(finiteOr(stop?.offset, 0)),
			color: normalizeColorOr(stop?.color, "#000000"),
		}))
		.sort((a, b) => a.offset - b.offset);
};

/** Narrow guard for `colorama`'s Input Phase (AE Colorama Input Phase). */
const isColoramaInputPhase = (value: unknown): value is ColoramaInputPhase =>
	COLORAMA_INPUT_PHASES.includes(value as ColoramaInputPhase);

/** Narrow guard for the `wave-warp` waveform shape. */
const isWaveWarpType = (value: unknown): value is WaveWarpType =>
	WAVE_TYPES.includes(value as WaveWarpType);

/**
 * Wraps a `wave-warp` direction into `[0, 360)` degrees so an authored negative
 * or overshoot angle still normalizes to one canonical value.
 */
const normalizeDirectionDegrees = (value: number): number =>
	((value % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

/**
 * Narrows an unvalidated {@link RevealPaint} draft to the exact three paint
 * kinds it accepts (solid/linear-gradient/radial-gradient), dropping anything
 * else (including a stray image/mesh paint, which has no clean single-element
 * underlay rendering — see {@link RevealPaint}'s doc) rather than storing a
 * value the renderer would need its own second check to skip. Passed through
 * verbatim otherwise: gradient stops/coordinates are RAW here and resolved the
 * same way `style.fills` paints are, at render time (`resolvePaints` /
 * `canvasPaint`), so this is not a second normalizer for paint shapes.
 */
const normalizeRevealPaint = (
	value: RevealPaint | undefined,
): RevealPaint | undefined =>
	value?.kind === "solid" ||
	value?.kind === "linear-gradient" ||
	value?.kind === "radial-gradient"
		? value
		: undefined;

/**
 * Builds a canonical payload for a node, wrapping vec-core slices through the
 * existing recipe normalizer so scalar state is never duplicated or unvalidated.
 */
const normalizePayload = (
	kind: LookGraphNodeKind,
	draft: LookGraphNodePayloadDraft | undefined,
): LookGraphNodePayload => {
	switch (kind) {
		case "source":
			return { kind: "source" };
		case "output":
			return { kind: "output" };
		case "grade": {
			const color = draft?.kind === "grade" ? draft.color : undefined;
			return { kind: "grade", color: normalizeVisualRecipe({ color }).color };
		}
		case "glow": {
			const glow = draft?.kind === "glow" ? draft.glow : undefined;
			return { kind: "glow", glow: normalizeVisualRecipe({ glow }).glow };
		}
		case "grain": {
			const grainDraft = draft?.kind === "grain" ? draft : undefined;
			const revealPaint = normalizeRevealPaint(grainDraft?.revealPaint);
			return {
				kind: "grain",
				texture: normalizeVisualRecipe({ texture: grainDraft?.texture })
					.texture,
				...(revealPaint ? { revealPaint } : {}),
			};
		}
		case "blur": {
			const blurDraft = draft?.kind === "blur" ? draft : undefined;
			const radius = clampNonNegative(
				finiteOr(blurDraft?.radius, DEFAULT_BLUR_RADIUS),
			);
			// Preserve an independent y-axis radius when authored; omit it otherwise
			// so isotropic blur normalizes byte-identically to the scalar form.
			const radiusY =
				blurDraft?.radiusY === undefined || blurDraft.radiusY === null
					? undefined
					: clampNonNegative(finiteOr(blurDraft.radiusY, radius));
			return radiusY === undefined
				? { kind: "blur", radius }
				: { kind: "blur", radius, radiusY };
		}
		case "chromatic-fringe": {
			const amount =
				draft?.kind === "chromatic-fringe" ? draft.amount : undefined;
			return {
				kind: "chromatic-fringe",
				amount: clampNonNegative(finiteOr(amount, DEFAULT_FRINGE_AMOUNT)),
			};
		}
		case "displace": {
			const displaceDraft = draft?.kind === "displace" ? draft : undefined;
			return {
				kind: "displace",
				scale: clampNonNegative(
					finiteOr(displaceDraft?.scale, DEFAULT_DISPLACE_SCALE),
				),
				frequency: clampNonNegative(
					finiteOr(displaceDraft?.frequency, DEFAULT_DISPLACE_FREQUENCY),
				),
				octaves: Math.min(
					MAX_DISPLACE_OCTAVES,
					Math.max(
						MIN_DISPLACE_OCTAVES,
						Math.round(
							finiteOr(displaceDraft?.octaves, DEFAULT_DISPLACE_OCTAVES),
						),
					),
				),
			};
		}
		case "posterize": {
			const posterizeDraft = draft?.kind === "posterize" ? draft : undefined;
			return {
				kind: "posterize",
				levels: Math.min(
					MAX_POSTERIZE_LEVELS,
					Math.max(
						MIN_POSTERIZE_LEVELS,
						Math.round(
							finiteOr(posterizeDraft?.levels, DEFAULT_POSTERIZE_LEVELS),
						),
					),
				),
			};
		}
		case "color-map": {
			const colorDraft = draft?.kind === "color-map" ? draft : undefined;
			const midtoneRaw = colorDraft?.midtone;
			const midtone =
				midtoneRaw === undefined || midtoneRaw === null
					? null
					: (normalizeHex(midtoneRaw) ?? null);
			return {
				kind: "color-map",
				shadow: normalizeColorOr(colorDraft?.shadow, DEFAULT_COLOR_MAP_SHADOW),
				midtone,
				highlight: normalizeColorOr(
					colorDraft?.highlight,
					DEFAULT_COLOR_MAP_HIGHLIGHT,
				),
				mix: clamp01(finiteOr(colorDraft?.mix, DEFAULT_COLOR_MAP_MIX)),
			};
		}
		case "find-edges": {
			const edgesDraft = draft?.kind === "find-edges" ? draft : undefined;
			return {
				kind: "find-edges",
				invert: edgesDraft?.invert ?? false,
				mix: clamp01(finiteOr(edgesDraft?.mix, DEFAULT_FIND_EDGES_MIX)),
			};
		}
		case "scanline": {
			const scanlineDraft = draft?.kind === "scanline" ? draft : undefined;
			return {
				kind: "scanline",
				density: clampToRange(
					finiteOr(scanlineDraft?.density, DEFAULT_SCANLINE_DENSITY),
					MIN_SCANLINE_DENSITY,
					MAX_SCANLINE_DENSITY,
				),
				intensity: clamp01(
					finiteOr(scanlineDraft?.intensity, DEFAULT_SCANLINE_INTENSITY),
				),
				softness: clamp01(
					finiteOr(scanlineDraft?.softness, DEFAULT_SCANLINE_SOFTNESS),
				),
				noiseMix: clamp01(
					finiteOr(scanlineDraft?.noiseMix, DEFAULT_SCANLINE_NOISE_MIX),
				),
			};
		}
		case "halftone": {
			const halftoneDraft = draft?.kind === "halftone" ? draft : undefined;
			return {
				kind: "halftone",
				cellSize: clampToRange(
					finiteOr(halftoneDraft?.cellSize, DEFAULT_HALFTONE_CELL_SIZE),
					MIN_HALFTONE_CELL_SIZE,
					MAX_HALFTONE_CELL_SIZE,
				),
				dotSize: clampToRange(
					finiteOr(halftoneDraft?.dotSize, DEFAULT_HALFTONE_DOT_SIZE),
					MIN_HALFTONE_DOT_SIZE,
					MAX_HALFTONE_DOT_SIZE,
				),
				contrast: clamp01(
					finiteOr(halftoneDraft?.contrast, DEFAULT_HALFTONE_CONTRAST),
				),
				angle: clampToRange(
					finiteOr(halftoneDraft?.angle, DEFAULT_HALFTONE_ANGLE),
					MIN_HALFTONE_ANGLE,
					MAX_HALFTONE_ANGLE,
				),
				mix: clamp01(finiteOr(halftoneDraft?.mix, DEFAULT_HALFTONE_MIX)),
			};
		}
		case "pixel-grid": {
			const pixelGridDraft = draft?.kind === "pixel-grid" ? draft : undefined;
			return {
				kind: "pixel-grid",
				cellSize: clampToRange(
					finiteOr(pixelGridDraft?.cellSize, DEFAULT_PIXEL_GRID_CELL_SIZE),
					MIN_PIXEL_GRID_CELL_SIZE,
					MAX_PIXEL_GRID_CELL_SIZE,
				),
				gap: clampToRange(
					finiteOr(pixelGridDraft?.gap, DEFAULT_PIXEL_GRID_GAP),
					0,
					MAX_PIXEL_GRID_GAP,
				),
				roundness: clamp01(
					finiteOr(pixelGridDraft?.roundness, DEFAULT_PIXEL_GRID_ROUNDNESS),
				),
				brightness: clampToRange(
					finiteOr(pixelGridDraft?.brightness, DEFAULT_PIXEL_GRID_BRIGHTNESS),
					0,
					MAX_PIXEL_GRID_BRIGHTNESS,
				),
				contrast: clamp01(
					finiteOr(pixelGridDraft?.contrast, DEFAULT_PIXEL_GRID_CONTRAST),
				),
				mix: clamp01(finiteOr(pixelGridDraft?.mix, DEFAULT_PIXEL_GRID_MIX)),
			};
		}
		case "ordered-dither": {
			const ditherDraft = draft?.kind === "ordered-dither" ? draft : undefined;
			return {
				kind: "ordered-dither",
				cellSize: clampToRange(
					finiteOr(ditherDraft?.cellSize, DEFAULT_ORDERED_DITHER_CELL_SIZE),
					MIN_ORDERED_DITHER_CELL_SIZE,
					MAX_ORDERED_DITHER_CELL_SIZE,
				),
				matrixSize: normalizeOrderedDitherMatrixSize(ditherDraft?.matrixSize),
				levels: Math.round(
					clampToRange(
						finiteOr(ditherDraft?.levels, DEFAULT_ORDERED_DITHER_LEVELS),
						MIN_ORDERED_DITHER_LEVELS,
						MAX_ORDERED_DITHER_LEVELS,
					),
				),
				mode: normalizeOrderedDitherMode(ditherDraft?.mode),
				pattern: normalizeOrderedDitherPattern(ditherDraft?.pattern),
				contrast: clamp01(
					finiteOr(ditherDraft?.contrast, DEFAULT_ORDERED_DITHER_CONTRAST),
				),
				threshold: clamp01(
					finiteOr(ditherDraft?.threshold, DEFAULT_ORDERED_DITHER_THRESHOLD),
				),
				strength: clamp01(
					finiteOr(ditherDraft?.strength, DEFAULT_ORDERED_DITHER_STRENGTH),
				),
				mix: clamp01(finiteOr(ditherDraft?.mix, DEFAULT_ORDERED_DITHER_MIX)),
				brightness: clampToRange(
					finiteOr(ditherDraft?.brightness, DEFAULT_ORDERED_DITHER_BRIGHTNESS),
					MIN_ORDERED_DITHER_BRIGHTNESS,
					MAX_ORDERED_DITHER_BRIGHTNESS,
				),
				gamma: clampToRange(
					finiteOr(ditherDraft?.gamma, DEFAULT_ORDERED_DITHER_GAMMA),
					MIN_ORDERED_DITHER_GAMMA,
					MAX_ORDERED_DITHER_GAMMA,
				),
				ink: normalizeColorOr(ditherDraft?.ink, DEFAULT_ORDERED_DITHER_INK),
				paper: normalizeColorOr(
					ditherDraft?.paper,
					DEFAULT_ORDERED_DITHER_PAPER,
				),
			};
		}
		case "ascii-glyph": {
			const glyphDraft = draft?.kind === "ascii-glyph" ? draft : undefined;
			return {
				kind: "ascii-glyph",
				cellSize: clampToRange(
					finiteOr(glyphDraft?.cellSize, DEFAULT_ASCII_GLYPH_CELL_SIZE),
					MIN_ASCII_GLYPH_CELL_SIZE,
					MAX_ASCII_GLYPH_CELL_SIZE,
				),
				glyphScale: clampToRange(
					finiteOr(glyphDraft?.glyphScale, DEFAULT_ASCII_GLYPH_SCALE),
					MIN_ASCII_GLYPH_SCALE,
					MAX_ASCII_GLYPH_SCALE,
				),
				contrast: clamp01(
					finiteOr(glyphDraft?.contrast, DEFAULT_ASCII_GLYPH_CONTRAST),
				),
				brightness: clampToRange(
					finiteOr(glyphDraft?.brightness, DEFAULT_ASCII_GLYPH_BRIGHTNESS),
					0,
					MAX_ASCII_GLYPH_BRIGHTNESS,
				),
				densityBias: clampBipolar(
					finiteOr(glyphDraft?.densityBias, DEFAULT_ASCII_GLYPH_DENSITY_BIAS),
				),
				invert: glyphDraft?.invert === true,
				mix: clamp01(finiteOr(glyphDraft?.mix, DEFAULT_ASCII_GLYPH_MIX)),
			};
		}
		case "block-mosaic": {
			const blockDraft = draft?.kind === "block-mosaic" ? draft : undefined;
			return {
				kind: "block-mosaic",
				cellSize: clampToRange(
					finiteOr(blockDraft?.cellSize, DEFAULT_BLOCK_MOSAIC_CELL_SIZE),
					MIN_BLOCK_MOSAIC_CELL_SIZE,
					MAX_BLOCK_MOSAIC_CELL_SIZE,
				),
				gap: clampToRange(
					finiteOr(blockDraft?.gap, DEFAULT_BLOCK_MOSAIC_GAP),
					0,
					MAX_BLOCK_MOSAIC_GAP,
				),
				bevel: clamp01(finiteOr(blockDraft?.bevel, DEFAULT_BLOCK_MOSAIC_BEVEL)),
				relief: clamp01(
					finiteOr(blockDraft?.relief, DEFAULT_BLOCK_MOSAIC_RELIEF),
				),
				lightAngle: clampToRange(
					finiteOr(blockDraft?.lightAngle, DEFAULT_BLOCK_MOSAIC_LIGHT_ANGLE),
					MIN_BLOCK_MOSAIC_LIGHT_ANGLE,
					MAX_BLOCK_MOSAIC_LIGHT_ANGLE,
				),
				lightElevation: clamp01(
					finiteOr(
						blockDraft?.lightElevation,
						DEFAULT_BLOCK_MOSAIC_LIGHT_ELEVATION,
					),
				),
				contrast: clamp01(
					finiteOr(blockDraft?.contrast, DEFAULT_BLOCK_MOSAIC_CONTRAST),
				),
				variation: clamp01(
					finiteOr(blockDraft?.variation, DEFAULT_BLOCK_MOSAIC_VARIATION),
				),
				mix: clamp01(finiteOr(blockDraft?.mix, DEFAULT_BLOCK_MOSAIC_MIX)),
			};
		}
		case "noise-field": {
			const noiseDraft = draft?.kind === "noise-field" ? draft : undefined;
			return {
				kind: "noise-field",
				type:
					noiseDraft?.type === "turbulence"
						? "turbulence"
						: DEFAULT_NOISE_FIELD_TYPE,
				scale: clampToRange(
					finiteOr(noiseDraft?.scale, DEFAULT_NOISE_FIELD_SCALE),
					MIN_NOISE_FIELD_SCALE,
					MAX_NOISE_FIELD_SCALE,
				),
				detail: Math.round(
					clampToRange(
						finiteOr(noiseDraft?.detail, DEFAULT_NOISE_FIELD_DETAIL),
						MIN_NOISE_FIELD_DETAIL,
						MAX_NOISE_FIELD_DETAIL,
					),
				),
				seed: Math.round(
					Math.max(0, finiteOr(noiseDraft?.seed, DEFAULT_NOISE_FIELD_SEED)),
				),
			};
		}
		case "warp": {
			const warpDraft = draft?.kind === "warp" ? draft : undefined;
			return {
				kind: "warp",
				mode: warpDraft?.mode === "twirl" ? "twirl" : "radial",
				strength: clampBipolar(
					finiteOr(warpDraft?.strength, DEFAULT_WARP_STRENGTH),
				),
				centerX: clamp01(finiteOr(warpDraft?.centerX, DEFAULT_WARP_CENTER)),
				centerY: clamp01(finiteOr(warpDraft?.centerY, DEFAULT_WARP_CENTER)),
			};
		}
		case "lens": {
			const lensDraft = draft?.kind === "lens" ? draft : undefined;
			return {
				kind: "lens",
				size: clamp01(finiteOr(lensDraft?.size, DEFAULT_LENS_SIZE)),
				convergence: clamp01(
					finiteOr(lensDraft?.convergence, DEFAULT_LENS_CONVERGENCE),
				),
				centerX: clamp01(finiteOr(lensDraft?.centerX, DEFAULT_LENS_CENTER)),
				centerY: clamp01(finiteOr(lensDraft?.centerY, DEFAULT_LENS_CENTER)),
				clipToRim: lensDraft?.clipToRim ?? false,
			};
		}
		case "kaleidoscope": {
			const kaleidoDraft = draft?.kind === "kaleidoscope" ? draft : undefined;
			return {
				kind: "kaleidoscope",
				segments: Math.min(
					MAX_KALEIDOSCOPE_SEGMENTS,
					Math.max(
						MIN_KALEIDOSCOPE_SEGMENTS,
						Math.round(
							finiteOr(kaleidoDraft?.segments, DEFAULT_KALEIDOSCOPE_SEGMENTS),
						),
					),
				),
				centerX: clamp01(
					finiteOr(kaleidoDraft?.centerX, DEFAULT_KALEIDOSCOPE_CENTER),
				),
				centerY: clamp01(
					finiteOr(kaleidoDraft?.centerY, DEFAULT_KALEIDOSCOPE_CENTER),
				),
				roll: clamp01(finiteOr(kaleidoDraft?.roll, DEFAULT_KALEIDOSCOPE_ROLL)),
			};
		}
		case "flow": {
			const flowDraft = draft?.kind === "flow" ? draft : undefined;
			const pattern =
				flowDraft?.pattern === "bulge" || flowDraft?.pattern === "twist"
					? flowDraft.pattern
					: "turbulent";
			return {
				kind: "flow",
				pattern,
				amount: clamp01(finiteOr(flowDraft?.amount, DEFAULT_FLOW_AMOUNT)),
				scale: clampNonNegative(finiteOr(flowDraft?.scale, DEFAULT_FLOW_SCALE)),
				octaves: Math.round(
					clampToRange(
						finiteOr(flowDraft?.octaves, DEFAULT_FLOW_OCTAVES),
						MIN_FLOW_OCTAVES,
						MAX_FLOW_OCTAVES,
					),
				),
				evolution: clampNonNegative(
					finiteOr(flowDraft?.evolution, DEFAULT_FLOW_EVOLUTION),
				),
				centerX: clamp01(finiteOr(flowDraft?.centerX, DEFAULT_FLOW_CENTER)),
				centerY: clamp01(finiteOr(flowDraft?.centerY, DEFAULT_FLOW_CENTER)),
			};
		}
		case "path-blur": {
			const pathBlurDraft = draft?.kind === "path-blur" ? draft : undefined;
			// Keep only guides whose shape is a real AeShape with enough vertices to
			// define a direction; fall back to the curved default so the node is
			// never a no-op on insert. Never throws — invalid guides are dropped.
			const validGuides = (pathBlurDraft?.guides ?? []).flatMap((guide) =>
				isAeShape(guide?.shape) &&
				guide.shape.vertices.length >= MIN_PATH_BLUR_GUIDE_VERTICES &&
				guide.shape.inTangents.length === guide.shape.vertices.length &&
				guide.shape.outTangents.length === guide.shape.vertices.length
					? [
							{
								shape: guide.shape,
								startSpeed: finiteOr(guide.startSpeed, 1),
								endSpeed: finiteOr(guide.endSpeed, 1),
							},
						]
					: [],
			);
			const guides =
				validGuides.length > 0 ? validGuides : [DEFAULT_PATH_BLUR_GUIDE];
			return {
				kind: "path-blur",
				guides,
				speed: clampToRange(
					finiteOr(pathBlurDraft?.speed, DEFAULT_PATH_BLUR_SPEED),
					MIN_PATH_BLUR_SPEED,
					MAX_PATH_BLUR_SPEED,
				),
				length: clampToRange(
					finiteOr(pathBlurDraft?.length, DEFAULT_PATH_BLUR_LENGTH),
					0,
					MAX_PATH_BLUR_LENGTH,
				),
				taper: clamp01(finiteOr(pathBlurDraft?.taper, DEFAULT_PATH_BLUR_TAPER)),
				centeredBlur: pathBlurDraft?.centeredBlur ?? DEFAULT_PATH_BLUR_CENTERED,
				strobeStrength: clamp01(
					finiteOr(
						pathBlurDraft?.strobeStrength,
						DEFAULT_PATH_BLUR_STROBE_STRENGTH,
					),
				),
				strobeFlashes: Math.round(
					clampToRange(
						finiteOr(
							pathBlurDraft?.strobeFlashes,
							DEFAULT_PATH_BLUR_STROBE_FLASHES,
						),
						0,
						MAX_PATH_BLUR_STROBE_FLASHES,
					),
				),
			};
		}
		case "noise-source": {
			const noiseDraft = draft?.kind === "noise-source" ? draft : undefined;
			return {
				kind: "noise-source",
				scale: clampToRange(
					finiteOr(noiseDraft?.scale, DEFAULT_NOISE_SOURCE_SCALE),
					MIN_NOISE_SOURCE_SCALE,
					MAX_NOISE_SOURCE_SCALE,
				),
				octaves: Math.round(
					clampToRange(
						finiteOr(noiseDraft?.octaves, DEFAULT_NOISE_SOURCE_OCTAVES),
						MIN_NOISE_SOURCE_OCTAVES,
						MAX_NOISE_SOURCE_OCTAVES,
					),
				),
				evolution: finiteOr(
					noiseDraft?.evolution,
					DEFAULT_NOISE_SOURCE_EVOLUTION,
				),
				speed: clampToRange(
					finiteOr(noiseDraft?.speed, DEFAULT_NOISE_SOURCE_SPEED),
					0,
					MAX_NOISE_SOURCE_SPEED,
				),
			};
		}
		case "deep-glow": {
			const glowDraft = draft?.kind === "deep-glow" ? draft : undefined;
			return {
				kind: "deep-glow",
				radius: clamp01(finiteOr(glowDraft?.radius, DEFAULT_DEEP_GLOW_RADIUS)),
				intensity: clampToRange(
					finiteOr(glowDraft?.intensity, DEFAULT_DEEP_GLOW_INTENSITY),
					0,
					MAX_DEEP_GLOW_INTENSITY,
				),
				threshold: clamp01(
					finiteOr(glowDraft?.threshold, DEFAULT_DEEP_GLOW_THRESHOLD),
				),
				chroma: clamp01(finiteOr(glowDraft?.chroma, DEFAULT_DEEP_GLOW_CHROMA)),
				blendMode: isBlendMode(glowDraft?.blendMode)
					? glowDraft.blendMode
					: DEFAULT_DEEP_GLOW_BLEND_MODE,
			};
		}
		case "riso": {
			const risoDraft = draft?.kind === "riso" ? draft : undefined;
			return {
				kind: "riso",
				cellSize: clampToRange(
					finiteOr(risoDraft?.cellSize, DEFAULT_RISO_CELL_SIZE),
					MIN_RISO_CELL_SIZE,
					MAX_RISO_CELL_SIZE,
				),
				dotSize: clampToRange(
					finiteOr(risoDraft?.dotSize, DEFAULT_RISO_DOT_SIZE),
					MIN_RISO_DOT_SIZE,
					MAX_RISO_DOT_SIZE,
				),
				contrast: clamp01(finiteOr(risoDraft?.contrast, DEFAULT_RISO_CONTRAST)),
				grain: clamp01(finiteOr(risoDraft?.grain, DEFAULT_RISO_GRAIN)),
				mix: clamp01(finiteOr(risoDraft?.mix, DEFAULT_RISO_MIX)),
				bloomProgress: clamp01(
					finiteOr(risoDraft?.bloomProgress, DEFAULT_RISO_BLOOM_PROGRESS),
				),
				blendMode: isRisoBlendMode(risoDraft?.blendMode)
					? risoDraft.blendMode
					: DEFAULT_RISO_BLEND_MODE,
				inks: normalizeRisoInks(risoDraft?.inks),
				amount: clamp01(finiteOr(risoDraft?.amount, DEFAULT_RISO_AMOUNT)),
				field: normalizeRisoField(risoDraft?.field),
			};
		}
		case "colorama": {
			const coloramaDraft = draft?.kind === "colorama" ? draft : undefined;
			return {
				kind: "colorama",
				stops: normalizeColoramaStops(coloramaDraft?.stops),
				// Raw turns, unclamped — the shader `fract()`s it, so an authored
				// integer phase delta closes a keyframe loop exactly.
				phase: finiteOr(coloramaDraft?.phase, DEFAULT_COLORAMA_PHASE),
				repetitions: clampToRange(
					finiteOr(coloramaDraft?.repetitions, DEFAULT_COLORAMA_REPETITIONS),
					MIN_COLORAMA_REPETITIONS,
					MAX_COLORAMA_REPETITIONS,
				),
				inputPhase: isColoramaInputPhase(coloramaDraft?.inputPhase)
					? coloramaDraft.inputPhase
					: DEFAULT_COLORAMA_INPUT_PHASE,
				mix: clamp01(finiteOr(coloramaDraft?.mix, DEFAULT_COLORAMA_MIX)),
			};
		}
		case "wave-warp": {
			const waveWarpDraft = draft?.kind === "wave-warp" ? draft : undefined;
			return {
				kind: "wave-warp",
				waveType: isWaveWarpType(waveWarpDraft?.waveType)
					? waveWarpDraft.waveType
					: DEFAULT_WAVE_TYPE,
				height: clampToRange(
					finiteOr(waveWarpDraft?.height, DEFAULT_WAVE_WARP_HEIGHT),
					MIN_WAVE_WARP_HEIGHT,
					MAX_WAVE_WARP_HEIGHT,
				),
				width: clampToRange(
					finiteOr(waveWarpDraft?.width, DEFAULT_WAVE_WARP_WIDTH),
					MIN_WAVE_WARP_WIDTH,
					MAX_WAVE_WARP_WIDTH,
				),
				direction: normalizeDirectionDegrees(
					finiteOr(waveWarpDraft?.direction, DEFAULT_WAVE_WARP_DIRECTION),
				),
				// Raw turns, unclamped — see the colorama `phase` comment above.
				phase: finiteOr(waveWarpDraft?.phase, DEFAULT_WAVE_WARP_PHASE),
			};
		}
		case "bend-warp": {
			const bendWarpDraft = draft?.kind === "bend-warp" ? draft : undefined;
			return {
				kind: "bend-warp",
				bend: clampBipolar(
					finiteOr(bendWarpDraft?.bend, DEFAULT_BEND_WARP_BEND),
				),
				distortionH: clampBipolar(
					finiteOr(bendWarpDraft?.distortionH, DEFAULT_BEND_WARP_DISTORTION_H),
				),
				distortionV: clampBipolar(
					finiteOr(bendWarpDraft?.distortionV, DEFAULT_BEND_WARP_DISTORTION_V),
				),
				scale: clampToRange(
					finiteOr(bendWarpDraft?.scale, DEFAULT_BEND_WARP_SCALE),
					MIN_BEND_WARP_SCALE,
					MAX_BEND_WARP_SCALE,
				),
			};
		}
		case "vhs-color": {
			const vhsColorDraft = draft?.kind === "vhs-color" ? draft : undefined;
			return {
				kind: "vhs-color",
				bleed: clampToRange(
					finiteOr(vhsColorDraft?.bleed, DEFAULT_VHS_COLOR_BLEED),
					MIN_VHS_COLOR_BLEED,
					MAX_VHS_COLOR_BLEED,
				),
				subsample: Math.round(
					clampToRange(
						finiteOr(vhsColorDraft?.subsample, DEFAULT_VHS_COLOR_SUBSAMPLE),
						MIN_VHS_COLOR_SUBSAMPLE,
						MAX_VHS_COLOR_SUBSAMPLE,
					),
				),
				colorUnder: clamp01(
					finiteOr(vhsColorDraft?.colorUnder, DEFAULT_VHS_COLOR_COLOR_UNDER),
				),
				mix: clamp01(finiteOr(vhsColorDraft?.mix, DEFAULT_VHS_COLOR_MIX)),
			};
		}
		case "vhs-tracking": {
			const vhsTrackingDraft =
				draft?.kind === "vhs-tracking" ? draft : undefined;
			return {
				kind: "vhs-tracking",
				jitter: clamp01(
					finiteOr(vhsTrackingDraft?.jitter, DEFAULT_VHS_TRACKING_JITTER),
				),
				wobble: clamp01(
					finiteOr(vhsTrackingDraft?.wobble, DEFAULT_VHS_TRACKING_WOBBLE),
				),
				tear: clamp01(
					finiteOr(vhsTrackingDraft?.tear, DEFAULT_VHS_TRACKING_TEAR),
				),
				band: clamp01(
					finiteOr(vhsTrackingDraft?.band, DEFAULT_VHS_TRACKING_BAND),
				),
				bandPosition: clamp01(
					finiteOr(
						vhsTrackingDraft?.bandPosition,
						DEFAULT_VHS_TRACKING_BAND_POSITION,
					),
				),
				speed: clampToRange(
					finiteOr(vhsTrackingDraft?.speed, DEFAULT_VHS_TRACKING_SPEED),
					0,
					MAX_VHS_TRACKING_SPEED,
				),
				seed: clampToRange(
					finiteOr(vhsTrackingDraft?.seed, DEFAULT_VHS_TRACKING_SEED),
					0,
					MAX_VHS_TRACKING_SEED,
				),
				mix: clamp01(finiteOr(vhsTrackingDraft?.mix, DEFAULT_VHS_TRACKING_MIX)),
				// Raw, unclamped — folded from `speed * frame` on top of any authored
				// value, same as `noise-source`'s `evolution` (see that field's doc).
				evolution: finiteOr(
					vhsTrackingDraft?.evolution,
					DEFAULT_VHS_TRACKING_EVOLUTION,
				),
			};
		}
		case "vhs-noise": {
			const vhsNoiseDraft = draft?.kind === "vhs-noise" ? draft : undefined;
			return {
				kind: "vhs-noise",
				snow: clamp01(finiteOr(vhsNoiseDraft?.snow, DEFAULT_VHS_NOISE_SNOW)),
				dropout: clamp01(
					finiteOr(vhsNoiseDraft?.dropout, DEFAULT_VHS_NOISE_DROPOUT),
				),
				dropoutLength: clampToRange(
					finiteOr(
						vhsNoiseDraft?.dropoutLength,
						DEFAULT_VHS_NOISE_DROPOUT_LENGTH,
					),
					MIN_VHS_NOISE_DROPOUT_LENGTH,
					MAX_VHS_NOISE_DROPOUT_LENGTH,
				),
				generation: Math.round(
					clampToRange(
						finiteOr(vhsNoiseDraft?.generation, DEFAULT_VHS_NOISE_GENERATION),
						MIN_VHS_NOISE_GENERATION,
						MAX_VHS_NOISE_GENERATION,
					),
				),
				speed: clampToRange(
					finiteOr(vhsNoiseDraft?.speed, DEFAULT_VHS_NOISE_SPEED),
					0,
					MAX_VHS_NOISE_SPEED,
				),
				seed: clampToRange(
					finiteOr(vhsNoiseDraft?.seed, DEFAULT_VHS_NOISE_SEED),
					0,
					MAX_VHS_NOISE_SEED,
				),
				mix: clamp01(finiteOr(vhsNoiseDraft?.mix, DEFAULT_VHS_NOISE_MIX)),
				evolution: finiteOr(
					vhsNoiseDraft?.evolution,
					DEFAULT_VHS_NOISE_EVOLUTION,
				),
			};
		}
		case "crt-display": {
			const crtDraft = draft?.kind === "crt-display" ? draft : undefined;
			return {
				kind: "crt-display",
				maskType: normalizeCrtDisplayMaskType(crtDraft?.maskType),
				maskScale: clampToRange(
					finiteOr(crtDraft?.maskScale, DEFAULT_CRT_DISPLAY_MASK_SCALE),
					MIN_CRT_DISPLAY_MASK_SCALE,
					MAX_CRT_DISPLAY_MASK_SCALE,
				),
				maskStrength: clamp01(
					finiteOr(crtDraft?.maskStrength, DEFAULT_CRT_DISPLAY_MASK_STRENGTH),
				),
				curvature: clamp01(
					finiteOr(crtDraft?.curvature, DEFAULT_CRT_DISPLAY_CURVATURE),
				),
				cornerRadius: clamp01(
					finiteOr(crtDraft?.cornerRadius, DEFAULT_CRT_DISPLAY_CORNER_RADIUS),
				),
				vignette: clamp01(
					finiteOr(crtDraft?.vignette, DEFAULT_CRT_DISPLAY_VIGNETTE),
				),
				mix: clamp01(finiteOr(crtDraft?.mix, DEFAULT_CRT_DISPLAY_MIX)),
			};
		}
		case "signal-glitch": {
			const glitchDraft = draft?.kind === "signal-glitch" ? draft : undefined;
			return {
				kind: "signal-glitch",
				channelShift: clampToRange(
					finiteOr(
						glitchDraft?.channelShift,
						DEFAULT_SIGNAL_GLITCH_CHANNEL_SHIFT,
					),
					MIN_SIGNAL_GLITCH_CHANNEL_SHIFT,
					MAX_SIGNAL_GLITCH_CHANNEL_SHIFT,
				),
				rollAmount: clamp01(
					finiteOr(glitchDraft?.rollAmount, DEFAULT_SIGNAL_GLITCH_ROLL_AMOUNT),
				),
				tearDensity: clamp01(
					finiteOr(
						glitchDraft?.tearDensity,
						DEFAULT_SIGNAL_GLITCH_TEAR_DENSITY,
					),
				),
				tearStrength: clampToRange(
					finiteOr(
						glitchDraft?.tearStrength,
						DEFAULT_SIGNAL_GLITCH_TEAR_STRENGTH,
					),
					0,
					MAX_SIGNAL_GLITCH_TEAR_STRENGTH,
				),
				speed: clampToRange(
					finiteOr(glitchDraft?.speed, DEFAULT_SIGNAL_GLITCH_SPEED),
					0,
					MAX_SIGNAL_GLITCH_SPEED,
				),
				seed: clampToRange(
					finiteOr(glitchDraft?.seed, DEFAULT_SIGNAL_GLITCH_SEED),
					0,
					MAX_SIGNAL_GLITCH_SEED,
				),
				mix: clamp01(finiteOr(glitchDraft?.mix, DEFAULT_SIGNAL_GLITCH_MIX)),
				evolution: finiteOr(
					glitchDraft?.evolution,
					DEFAULT_SIGNAL_GLITCH_EVOLUTION,
				),
			};
		}
		case "interlace": {
			const interlaceDraft = draft?.kind === "interlace" ? draft : undefined;
			return {
				kind: "interlace",
				strength: clamp01(
					finiteOr(interlaceDraft?.strength, DEFAULT_INTERLACE_STRENGTH),
				),
				fieldOffset: clampToRange(
					finiteOr(interlaceDraft?.fieldOffset, DEFAULT_INTERLACE_FIELD_OFFSET),
					0,
					MAX_INTERLACE_FIELD_OFFSET,
				),
				flicker: clamp01(
					finiteOr(interlaceDraft?.flicker, DEFAULT_INTERLACE_FLICKER),
				),
				speed: clampToRange(
					finiteOr(interlaceDraft?.speed, DEFAULT_INTERLACE_SPEED),
					0,
					MAX_INTERLACE_SPEED,
				),
				mix: clamp01(finiteOr(interlaceDraft?.mix, DEFAULT_INTERLACE_MIX)),
				evolution: finiteOr(
					interlaceDraft?.evolution,
					DEFAULT_INTERLACE_EVOLUTION,
				),
			};
		}
		case "mask": {
			const maskDraft = draft?.kind === "mask" ? draft : undefined;
			const influenceAssignmentIds = uniqueStrings(
				maskDraft?.influenceAssignmentIds,
			);
			return {
				kind: "mask",
				source: normalizeMaskSource(maskDraft?.source) ?? "source-alpha",
				...(maskDraft?.invert === undefined
					? {}
					: { invert: maskDraft.invert }),
				...(maskDraft?.feather === undefined
					? {}
					: { feather: clamp01(finiteOr(maskDraft.feather, 0)) }),
				...(influenceAssignmentIds.length > 0
					? { influenceAssignmentIds }
					: {}),
			};
		}
		case "composite": {
			const compositeDraft = draft?.kind === "composite" ? draft : undefined;
			return {
				kind: "composite",
				blendMode:
					compositeDraft && isBlendMode(compositeDraft.blendMode)
						? compositeDraft.blendMode
						: "normal",
				mix: clamp01(finiteOr(compositeDraft?.mix, 1)),
			};
		}
	}
};

const normalizeNode = (
	draft: LookGraphNodeDraft,
	usedIds: Set<string>,
): LookGraphNode | null => {
	const id = nonEmpty(draft.id);
	if (!id || usedIds.has(id) || !isNodeKind(draft.kind)) return null;
	usedIds.add(id);
	const kind = draft.kind;
	const ports = portsForKind(id, kind);
	return {
		id,
		kind,
		label: nonEmpty(draft.label) ?? lookGraphNodeLabel(kind),
		enabled: draft.enabled ?? true,
		inputs: ports.inputs,
		outputs: ports.outputs,
		payload: normalizePayload(kind, draft.payload),
		...(draft.position
			? {
					position: {
						x: finiteOr(draft.position.x, 0),
						y: finiteOr(draft.position.y, 0),
					},
				}
			: {}),
	};
};

type PortIndex = {
	readonly node: LookGraphNode;
	readonly port: LookGraphPort;
};

const indexPorts = (
	nodes: readonly LookGraphNode[],
): Map<string, Map<string, PortIndex>> => {
	const index = new Map<string, Map<string, PortIndex>>();
	for (const node of nodes) {
		const ports = new Map<string, PortIndex>();
		for (const nodePort of [...node.inputs, ...node.outputs]) {
			ports.set(nodePort.id, { node, port: nodePort });
		}
		index.set(node.id, ports);
	}
	return index;
};

const resolveEndpoint = (
	endpoint: Partial<LookGraphEndpoint> | undefined,
): LookGraphEndpoint | null => {
	const nodeId = nonEmpty(endpoint?.nodeId);
	const portId = nonEmpty(endpoint?.portId);
	return nodeId && portId ? { nodeId, portId } : null;
};

const wouldCreateCycle = (
	edges: readonly { from: LookGraphEndpoint; to: LookGraphEndpoint }[],
	from: string,
	to: string,
): boolean => {
	// A cycle forms if `to` can already reach `from` through existing edges.
	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		const list = adjacency.get(edge.from.nodeId) ?? [];
		list.push(edge.to.nodeId);
		adjacency.set(edge.from.nodeId, list);
	}
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) continue;
		if (current === from) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		for (const next of adjacency.get(current) ?? []) stack.push(next);
	}
	return false;
};

const normalizeEdges = (
	draftEdges: readonly LookGraphEdgeDraft[],
	nodes: readonly LookGraphNode[],
): readonly LookGraphEdge[] => {
	const portIndex = indexPorts(nodes);
	const accepted: LookGraphEdge[] = [];
	const usedEdgeIds = new Set<string>();
	const filledSingleInputs = new Set<string>();
	for (const draft of draftEdges) {
		const from = resolveEndpoint(draft.from);
		const to = resolveEndpoint(draft.to);
		if (!from || !to) continue;
		const fromPort = portIndex.get(from.nodeId)?.get(from.portId);
		const toPort = portIndex.get(to.nodeId)?.get(to.portId);
		if (!fromPort || !toPort) continue;
		if (fromPort.port.direction !== "output") continue;
		if (toPort.port.direction !== "input") continue;
		if (fromPort.port.valueType !== toPort.port.valueType) continue;
		const inputKey = `${to.nodeId}:${to.portId}`;
		if (
			toPort.port.cardinality === "single" &&
			filledSingleInputs.has(inputKey)
		)
			continue;
		if (wouldCreateCycle(accepted, from.nodeId, to.nodeId)) continue;
		const id = (() => {
			const provided = nonEmpty(draft.id);
			if (provided && !usedEdgeIds.has(provided)) return provided;
			return lookGraphEdgeId(from, to);
		})();
		if (usedEdgeIds.has(id)) continue;
		usedEdgeIds.add(id);
		if (toPort.port.cardinality === "single") filledSingleInputs.add(inputKey);
		accepted.push({ id, from, to });
	}
	return accepted;
};

const resolveOutputNodeId = (
	nodes: readonly LookGraphNode[],
	requested: string | undefined,
): string => {
	const requestedId = nonEmpty(requested);
	if (requestedId) {
		const requestedNode = nodes.find((node) => node.id === requestedId);
		if (requestedNode?.kind === "output") return requestedNode.id;
	}
	const outputNode = nodes.find((node) => node.kind === "output");
	return outputNode?.id ?? nodes[0]?.id ?? "";
};

/**
 * Normalizes a graph into a clean, deterministic {@link LookGraph}. Invalid or
 * duplicate nodes are dropped, ports are regenerated canonically per kind, and
 * structurally-invalid edges (unknown endpoints, wrong direction, type mismatch,
 * single-input overflow, cycles) are rejected so stored graphs stay consistent.
 * Returns `undefined` for an empty graph so legacy-shaped intents stay compact.
 */
export function normalizeLookGraph(
	draft: LookGraphDraft | LookGraph | null | undefined,
): LookGraph | undefined {
	if (!draft) return undefined;
	const usedIds = new Set<string>();
	const nodes = (draft.nodes ?? []).flatMap((node) => {
		const normalized = normalizeNode(node, usedIds);
		return normalized ? [normalized] : [];
	});
	if (nodes.length === 0) return undefined;
	const edges = normalizeEdges(draft.edges ?? [], nodes);
	return {
		schemaVersion: LOOK_GRAPH_SCHEMA_VERSION,
		nodes,
		edges,
		outputNodeId: resolveOutputNodeId(nodes, draft.outputNodeId),
	};
}

const detectCycleNodes = (graph: LookGraph): readonly string[] => {
	// Kahn's algorithm: nodes never removed from the queue sit on a cycle.
	const indegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();
	for (const node of graph.nodes) {
		indegree.set(node.id, 0);
		adjacency.set(node.id, []);
	}
	for (const edge of graph.edges) {
		if (!indegree.has(edge.to.nodeId) || !adjacency.has(edge.from.nodeId)) {
			continue;
		}
		indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
		adjacency.get(edge.from.nodeId)?.push(edge.to.nodeId);
	}
	const queue = graph.nodes
		.filter((node) => (indegree.get(node.id) ?? 0) === 0)
		.map((node) => node.id);
	let visited = 0;
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) continue;
		visited += 1;
		for (const next of adjacency.get(current) ?? []) {
			const remaining = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, remaining);
			if (remaining === 0) queue.push(next);
		}
	}
	if (visited === graph.nodes.length) return [];
	return graph.nodes
		.filter((node) => (indegree.get(node.id) ?? 0) > 0)
		.map((node) => node.id);
};

/**
 * Validates a normalized graph and returns typed issues for the whole topology:
 * missing/incorrect output node, duplicate ids, and any latent cycle. Edge-level
 * structural problems are already removed by {@link normalizeLookGraph}; this is
 * the higher-level invariant surface for UI/MCP diagnostics.
 */
export function validateLookGraph(
	graph: LookGraph | null | undefined,
): readonly LookGraphIssue[] {
	if (!graph || graph.nodes.length === 0) {
		return [{ code: "empty-graph", message: "Look graph has no nodes" }];
	}
	const issues: LookGraphIssue[] = [];
	const outputNode = graph.nodes.find((node) => node.id === graph.outputNodeId);
	if (!outputNode) {
		issues.push({
			code: "missing-output-node",
			message: "Look graph output node id does not resolve to a node",
		});
	} else if (outputNode.kind !== "output") {
		issues.push({
			code: "output-node-not-output-kind",
			nodeId: outputNode.id,
			message: `Output node "${outputNode.id}" is a ${outputNode.kind} node`,
		});
	}
	// Detect any cycle reachable through the accepted edges.
	const indegreeCycle = detectCycleNodes(graph);
	if (indegreeCycle.length > 0) {
		issues.push({
			code: "cycle-detected",
			nodeIds: indegreeCycle,
			message: "Look graph contains a cycle",
		});
	}
	return issues;
}

/**
 * Validates a single proposed edge against a normalized graph and returns typed
 * issues. An empty result means the edge is connectable, which lets command and
 * agent layers reject invalid wires before they enter command history.
 */
export function validateLookEdge(
	graph: LookGraph,
	from: LookGraphEndpoint,
	to: LookGraphEndpoint,
): readonly LookGraphIssue[] {
	const issues: LookGraphIssue[] = [];
	const edgeId = lookGraphEdgeId(from, to);
	const portIndex = indexPorts(graph.nodes);
	const fromPorts = portIndex.get(from.nodeId);
	const toPorts = portIndex.get(to.nodeId);
	if (!fromPorts) {
		issues.push({
			code: "unknown-endpoint-node",
			edgeId,
			nodeId: from.nodeId,
			message: `Edge source node "${from.nodeId}" does not exist`,
		});
	}
	if (!toPorts) {
		issues.push({
			code: "unknown-endpoint-node",
			edgeId,
			nodeId: to.nodeId,
			message: `Edge target node "${to.nodeId}" does not exist`,
		});
	}
	if (!fromPorts || !toPorts) return issues;
	const fromPort = fromPorts.get(from.portId);
	const toPort = toPorts.get(to.portId);
	if (!fromPort) {
		issues.push({
			code: "unknown-endpoint-port",
			edgeId,
			nodeId: from.nodeId,
			portId: from.portId,
			message: `Edge source port "${from.portId}" does not exist`,
		});
	} else if (fromPort.port.direction !== "output") {
		issues.push({
			code: "port-direction-mismatch",
			edgeId,
			endpoint: from,
			message: `Edge source port "${from.portId}" is not an output`,
		});
	}
	if (!toPort) {
		issues.push({
			code: "unknown-endpoint-port",
			edgeId,
			nodeId: to.nodeId,
			portId: to.portId,
			message: `Edge target port "${to.portId}" does not exist`,
		});
	} else if (toPort.port.direction !== "input") {
		issues.push({
			code: "port-direction-mismatch",
			edgeId,
			endpoint: to,
			message: `Edge target port "${to.portId}" is not an input`,
		});
	}
	if (!fromPort || !toPort) return issues;
	if (
		fromPort.port.direction === "output" &&
		toPort.port.direction === "input"
	) {
		if (fromPort.port.valueType !== toPort.port.valueType) {
			issues.push({
				code: "port-type-mismatch",
				edgeId,
				fromType: fromPort.port.valueType,
				toType: toPort.port.valueType,
				message: `Cannot connect ${fromPort.port.valueType} to ${toPort.port.valueType}`,
			});
		}
		const occupied =
			toPort.port.cardinality === "single" &&
			graph.edges.some(
				(edge) => edge.to.nodeId === to.nodeId && edge.to.portId === to.portId,
			);
		if (occupied) {
			issues.push({
				code: "input-cardinality-exceeded",
				edgeId,
				endpoint: to,
				message: `Input port "${to.portId}" already has a connection`,
			});
		}
		if (wouldCreateCycle(graph.edges, from.nodeId, to.nodeId)) {
			issues.push({
				code: "cycle-detected",
				nodeIds: [from.nodeId, to.nodeId],
				message: "Edge would create a cycle",
			});
		}
	}
	return issues;
}

type EffectNodeSpec = {
	readonly id: string;
	readonly kind: Exclude<LookGraphNodeKind, "source" | "output">;
	readonly label: string;
	readonly enabled: boolean;
	readonly payload: LookGraphNodePayloadDraft;
};

/**
 * Wires a `Source -> ...specs -> Output` serial graph through canonical image
 * ports. Boundary nodes use stable owner-scoped ids so projections of the same
 * owner/recipe always produce the same graph.
 */
const buildSerialLookGraph = (
	owner: LookGraphOwnerRef,
	specs: readonly EffectNodeSpec[],
): LookGraph | undefined => {
	const sourceId = lookGraphNodeId(owner, "source");
	const outputId = lookGraphNodeId(owner, "output");
	const nodeDrafts: LookGraphNodeDraft[] = [
		{ id: sourceId, kind: "source", payload: { kind: "source" } },
		...specs.map((spec) => ({
			id: spec.id,
			kind: spec.kind,
			label: spec.label,
			enabled: spec.enabled,
			payload: spec.payload,
		})),
		{ id: outputId, kind: "output", payload: { kind: "output" } },
	];
	const chain = [
		{ id: sourceId, kind: "source" as const },
		...specs.map((spec) => ({ id: spec.id, kind: spec.kind })),
		{ id: outputId, kind: "output" as const },
	];
	const edgeDrafts: LookGraphEdgeDraft[] = [];
	for (let index = 0; index < chain.length - 1; index += 1) {
		const fromNode = chain[index];
		const toNode = chain[index + 1];
		if (!fromNode || !toNode) continue;
		edgeDrafts.push({
			from: {
				nodeId: fromNode.id,
				portId: lookGraphPortId(fromNode.id, "output", "image"),
			},
			to: {
				nodeId: toNode.id,
				portId: lookGraphPortId(
					toNode.id,
					"input",
					primaryImageInputName(toNode.kind),
				),
			},
		});
	}
	return normalizeLookGraph({
		schemaVersion: LOOK_GRAPH_SCHEMA_VERSION,
		nodes: nodeDrafts,
		edges: edgeDrafts,
		outputNodeId: outputId,
	});
};

/**
 * Translates one compatibility stack layer into ordered effect-node specs. Most
 * layer kinds map 1:1; a legacy `recipe-compat` layer expands into the canonical
 * `glow -> grain -> grade` triple. A stack `blur` layer is skipped even though the
 * graph now has a functional `blur` node: the stack `blur` kind is a reserved no-op
 * placeholder (it carries no radius and the stack compiler marks it `unsupported`),
 * so projecting it to a graph blur node would fabricate a blur that was never there.
 */
const layerToSpecs = (
	owner: LookGraphOwnerRef,
	layer: EffectLayer,
): readonly EffectNodeSpec[] => {
	const base = lookGraphNodeIdFromLayer(owner, layer.id);
	switch (layer.kind) {
		case "grade":
			return [
				{
					id: base,
					kind: "grade",
					label: layer.label,
					enabled: layer.enabled,
					payload: { kind: "grade", color: layer.visualRecipe.color },
				},
			];
		case "glow":
			return [
				{
					id: base,
					kind: "glow",
					label: layer.label,
					enabled: layer.enabled,
					payload: { kind: "glow", glow: layer.visualRecipe.glow },
				},
			];
		case "grain":
			return [
				{
					id: base,
					kind: "grain",
					label: layer.label,
					enabled: layer.enabled,
					payload: { kind: "grain", texture: layer.visualRecipe.texture },
				},
			];
		case "composite":
			return [
				{
					id: base,
					kind: "composite",
					label: layer.label,
					enabled: layer.enabled,
					payload: {
						kind: "composite",
						blendMode: layer.blendMode,
						mix: layer.mix,
					},
				},
			];
		case "recipe-compat":
			return [
				{
					id: `${base}-glow`,
					kind: "glow",
					label: "Glow",
					enabled: layer.enabled,
					payload: { kind: "glow", glow: layer.visualRecipe.glow },
				},
				{
					id: `${base}-grain`,
					kind: "grain",
					label: "Grain",
					enabled: layer.enabled,
					payload: { kind: "grain", texture: layer.visualRecipe.texture },
				},
				{
					id: `${base}-grade`,
					kind: "grade",
					label: "Grade",
					enabled: layer.enabled,
					payload: { kind: "grade", color: layer.visualRecipe.color },
				},
			];
		case "blur":
			// Reserved no-op stack layer (no radius) — nothing to project. See above.
			return [];
	}
};

/**
 * Projects an ordered effect-layer stack into a serial Look graph. This is the
 * second precedence tier: explicit graphs win, but an existing stack is read as
 * `Source -> ...layers -> Output` so stack-only documents enter the graph model.
 */
export function lookGraphFromEffectLayerStack(
	stack: EffectLayerStack | EffectLayerStackDraft | null | undefined,
	owner: LookGraphOwnerRef,
): LookGraph | undefined {
	if (owner.scope === "scoped-overlay") return undefined;
	const normalized = normalizeEffectLayerStack(stack, owner);
	if (!normalized) return undefined;
	const specs = normalized.layers.flatMap((layer) =>
		layerToSpecs(owner, layer),
	);
	return buildSerialLookGraph(owner, specs);
}

/**
 * Projects a legacy `VisualRecipe` into the canonical serial Look graph
 * `Source -> Glow -> Grain -> Grade -> Output`. Each effect node wraps the
 * matching canonical recipe slice; recipe payloads stay the source of truth.
 */
export function lookGraphFromVisualRecipe(
	recipe: VisualRecipe,
	owner: LookGraphOwnerRef,
): LookGraph | undefined {
	const normalized = normalizeVisualRecipe(recipe);
	const specs: EffectNodeSpec[] = [
		{
			id: lookGraphNodeId(owner, "glow"),
			kind: "glow",
			label: "Glow",
			enabled: true,
			payload: { kind: "glow", glow: normalized.glow },
		},
		{
			id: lookGraphNodeId(owner, "grain"),
			kind: "grain",
			label: "Grain",
			enabled: true,
			payload: { kind: "grain", texture: normalized.texture },
		},
		{
			id: lookGraphNodeId(owner, "grade"),
			kind: "grade",
			label: "Grade",
			enabled: true,
			payload: { kind: "grade", color: normalized.color },
		},
	];
	return buildSerialLookGraph(owner, specs);
}

/**
 * Reads an effect intent as a Look graph with graph-first precedence: an
 * explicit `lookGraph` wins; otherwise an `effectLayerStack` projects to a serial
 * graph; otherwise a legacy `visualRecipe` projects to
 * `Source -> Glow -> Grain -> Grade -> Output`. Returns `undefined` when the
 * scope carries no Look.
 */
export function lookGraphFromIntent(
	intent: LookGraphIntentSource | null | undefined,
	owner: LookGraphOwnerRef,
): LookGraph | undefined {
	if (!intent) return undefined;
	const explicit = normalizeLookGraph(intent.lookGraph);
	if (explicit) return explicit;
	const stack = lookGraphFromEffectLayerStack(intent.effectLayerStack, owner);
	if (stack) return stack;
	if (!intent.visualRecipe) return undefined;
	return lookGraphFromVisualRecipe(intent.visualRecipe, owner);
}
