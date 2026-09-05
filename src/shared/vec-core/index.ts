// Vendored pure contract subset from visual-effect-core/packages/visual-effect-core/src/features/*.
// Renderer bridges stay out of the main client bundle. This file also contains
// read compatibility for vector-motion-author's earlier v3 recipe shape because
// both contracts used schemaVersion = 3.

import {
	insertScalarEffectFieldMeshColumn,
	insertScalarEffectFieldMeshRow,
	linearEffectFieldAxis,
	moveScalarEffectFieldMeshPoint,
	normalizeScalarEffectFieldMesh,
	removeScalarEffectFieldMeshColumn,
	removeScalarEffectFieldMeshPointLines,
	removeScalarEffectFieldMeshRow,
	SCALAR_EFFECT_FIELD_MESH_MAX_GRID,
	SCALAR_EFFECT_FIELD_MESH_MIN_GRID,
	type ScalarEffectFieldMesh,
	type ScalarEffectFieldMode,
	setScalarEffectFieldMeshPointValue,
} from "@/shared/effect-field";

export const VISUAL_RECIPE_SCHEMA_VERSION = 3 as const;

export type VisualRecipeSchemaVersion = typeof VISUAL_RECIPE_SCHEMA_VERSION;

export type DeepPartialObject<T> = {
	readonly [K in keyof T]?: T[K] extends readonly (infer U)[]
		? readonly DeepPartialObject<U>[]
		: T[K] extends object
			? DeepPartialObject<T[K]>
			: T[K];
};

export type VisualIntent =
	| "generic"
	| "photo-video"
	| "motion-graphics"
	| "ui-surface";

export type AlphaMode = "opaque" | "straight" | "premultiplied";

export type RecipeScalar = string | number | boolean;

export type RecipeMetadata = Readonly<Record<string, RecipeScalar>>;

export type ColorRecipe = {
	readonly exposure: number;
	readonly contrast: number;
	readonly saturation: number;
	readonly temperature: number;
	readonly tint: number;
	readonly density: number;
	readonly printContrast: number;
	readonly cmy: {
		readonly cyan: number;
		readonly magenta: number;
		readonly yellow: number;
	};
};

export type ColorRecipeDraft = Omit<DeepPartialObject<ColorRecipe>, "tint"> & {
	/** Legacy VMA accepted a tint color/null here; canonical vec-core tint is numeric. */
	readonly tint?: number | string | null;
};

export type SurfacePaintKind =
	| "solid"
	| "linearGradient"
	| "radialGradient"
	| "shaderGradient";

export type SurfaceShaderGradientType = "plane" | "sphere" | "waterPlane";

export type SurfacePaintSolid = {
	readonly kind: "solid";
	readonly color: string;
};

export type SurfacePaintLinearGradient = {
	readonly kind: "linearGradient";
	readonly from: string;
	readonly to: string;
	readonly angle: number;
	readonly balance: number;
};

export type SurfacePaintRadialGradient = {
	readonly kind: "radialGradient";
	readonly inner: string;
	readonly outer: string;
	readonly centerX: number;
	readonly centerY: number;
	readonly radius: number;
};

export type SurfacePaintShaderGradient = {
	readonly kind: "shaderGradient";
	readonly type: SurfaceShaderGradientType;
	readonly color1: string;
	readonly color2: string;
	readonly color3: string;
	readonly uSpeed: number;
	readonly uStrength: number;
	readonly uDensity: number;
	readonly uFrequency: number;
	readonly uAmplitude: number;
	readonly uTime: number;
	readonly brightness: number;
};

export type SurfacePaint =
	| SurfacePaintSolid
	| SurfacePaintLinearGradient
	| SurfacePaintRadialGradient
	| SurfacePaintShaderGradient;

export type SurfacePaintDraft =
	| (Partial<SurfacePaintSolid> & { readonly kind: "solid" })
	| (Partial<SurfacePaintLinearGradient> & {
			readonly kind: "linearGradient";
	  })
	| (Partial<SurfacePaintRadialGradient> & {
			readonly kind: "radialGradient";
	  })
	| (Partial<SurfacePaintShaderGradient> & {
			readonly kind: "shaderGradient";
	  });

export type SurfaceShadeRecipe = {
	readonly enabled: boolean;
	readonly strength: number;
	readonly softness: number;
	readonly angle: number;
	readonly offset: number;
};

export type SurfaceShadeRecipeDraft = Partial<SurfaceShadeRecipe>;

export type SurfaceRecipe = {
	readonly paint: SurfacePaint;
	readonly shade: SurfaceShadeRecipe;
};

export type SurfaceRecipeDraft = {
	readonly paint?: SurfacePaintDraft | "flat" | "source";
	readonly shade?: SurfaceShadeRecipeDraft;
	/** Legacy VMA color paired with `paint: "flat"`. */
	readonly color?: string | null;
};

export type TextureParticleCharacter =
	| "neutral"
	| "soft"
	| "clump"
	| "pepper"
	| "crystal";

export type TextureMaterialMode =
	| "off"
	| "density"
	| "dye"
	| "particle"
	| "mixed";

/**
 * How the texture's noise/particle output composites over the object's own fill.
 * The 16 real SVG/CSS blend modes read {@link grainPrimitives}-style noise-over-fill
 * (matching scene {@link BlendMode} string values so authoring surfaces share one
 * vocabulary); `"dissolve"` instead routes to the legacy particle-dissolve pipeline,
 * where the fill itself erodes into stippled coverage rather than compositing atop it.
 * vec-core is a lower layer than `entities/scene`, so this union is defined locally
 * rather than imported from there.
 */
export type TextureMaterialBlendMode =
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
	| "luminosity"
	| "dissolve";

export type TextureGrainFusionMode = "additive" | "overlay" | "softLight";

export type TextureParticleFieldMode = ScalarEffectFieldMode;

export type TextureParticleFieldMeshPoint = {
	/** Normalized horizontal position in the effect bounds, 0 = left, 1 = right. */
	readonly x: number;
	/** Normalized vertical position in the effect bounds, 0 = top, 1 = bottom. */
	readonly y: number;
	/** Particle density at this control point, 0 = transparent, 1 = fully dense. */
	readonly density: number;
};

export type TextureParticleFieldMesh = {
	/** Number of point rows in the scalar density grid. */
	readonly rows: number;
	/** Number of point columns in the scalar density grid. */
	readonly cols: number;
	readonly points: readonly TextureParticleFieldMeshPoint[];
};

export type TextureParticleLinearField = {
	readonly kind: "linear";
	readonly space: "target";
	/**
	 * Target-space normalized start/end coordinates. `0..1` is the object/effect
	 * bounds; values outside that range intentionally preserve handles dragged
	 * beyond the bounds, matching normal gradient-tool authoring.
	 */
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
	/** Solid-side hold before the particle fade, normalized along the field line. */
	readonly plateau: number;
	readonly invert?: boolean;
};

export type TextureMaterialAlphaMatteSource =
	| EffectMaskLinearGradientSource
	| EffectMaskRadialGradientSource
	| {
			readonly kind: "contourGradient";
			readonly space: EffectMaskSpace;
			readonly width: number;
			readonly invert: boolean;
			readonly stops: readonly EffectMaskGradientStop[];
	  };

/**
 * Calibrated noise-wipe reveal: an orthogonal final alpha mask applied after a
 * node's own material/grain composite (any {@link TextureMaterialMode}, including
 * `"off"`), driven by a directional field (typically `linearField`) perturbed by
 * fractal noise. `progress` sweeps the reveal from fully hidden (0) to fully
 * shown (1); `softness` is the normalized width of the transition band along the
 * field; `noiseWeight` blends in noise perturbation atop the directional ramp
 * (0 = a clean wipe, 1 = fully noise-driven edge). `mode` picks reveal direction:
 * `"in"` un-hides progressively, `"out"` dissolves progressively (the inverse
 * alpha). See {@link effect-filter.ts!revealMattePrimitives} for the render chain.
 */
export type TextureMaterialReveal = {
	readonly progress: number;
	readonly softness: number;
	readonly noiseWeight: number;
	readonly mode: "in" | "out";
};

export type TextureRecipe = {
	readonly grain: {
		readonly enabled: boolean;
		readonly strength: number;
		readonly size: number;
		readonly character: TextureParticleCharacter;
		readonly densityCoupling: number;
		readonly temporalStability: number;
		readonly seed: number;
		readonly fusionMode: TextureGrainFusionMode;
		readonly chroma: number;
	};
	readonly material: {
		readonly mode: TextureMaterialMode;
		/**
		 * How the material's noise/particle output composites over the object's
		 * own fill; see {@link TextureMaterialBlendMode}. Optional and never
		 * synthesized by {@link normalizeTextureRecipe} — omitted, it defaults
		 * through {@link effectiveTextureBlendMode} based on `mode`, so existing
		 * `"particle"`/`"mixed"` documents keep rendering as the dissolve.
		 */
		readonly blendMode?: TextureMaterialBlendMode;
		/**
		 * Optional tint for the noise-over-fill overlay grain (hex color). Absent =
		 * monochrome grayscale noise (byte-identical legacy render). Only meaningful
		 * on the non-"dissolve" particle/mixed overlay path; ignored by the dissolve
		 * erosion path. Mirrors `blendMode?`: optional and never synthesized by
		 * {@link normalizeTextureRecipe}, so existing documents render byte-identical.
		 */
		readonly overlayColor?: string;
		readonly strength: number;
		readonly dyeShift: number;
		readonly particleContrast: number;
		/**
		 * Density field used by particle dissolve. `contour` follows the alpha
		 * silhouette, reading circular on circles and shape-following on arbitrary
		 * paths; renderers may use an authored contour `angle` as an arc focus while
		 * keeping the boundary distance as the primary field. `linear` uses
		 * `linearField` when present, otherwise `angle` as a gradient-tool axis, and
		 * `mesh` uses `fieldMesh` as a scalar density surface. Omitted legacy data
		 * is interpreted from `angle`: angle present = linear, otherwise contour.
		 */
		readonly fieldMode?: TextureParticleFieldMode;
		/**
		 * Particle-dissolve direction in degrees (0 = →, clockwise in screen space).
		 * Used as the Linear axis when `fieldMode` resolves to `linear`; authored
		 * contour recipes may also use it as a silhouette-arc focus direction.
		 */
		readonly angle?: number;
		/**
		 * Scalar density mesh for particle dissolve. Coordinates are normalized to
		 * the resolved filter bounds so renderers, exporters, and MCP clients can
		 * share the same payload without depending on the current object size.
		 */
		readonly fieldMesh?: TextureParticleFieldMesh;
		/** Explicit target-space Linear particle field endpoints and range. */
		readonly linearField?: TextureParticleLinearField;
		/**
		 * Optional transparent-gradient matte applied before particle/noise coverage.
		 * When grain is disabled, GPU renderers can show this matte directly so the
		 * shape falloff is authorable and inspectable before particles are layered on.
		 */
		readonly alphaMatte?: TextureMaterialAlphaMatteSource;
		/**
		 * Optional calibrated noise-wipe reveal, an orthogonal final alpha mask
		 * independent of `mode`/`blendMode`. Absent = no reveal (fully
		 * backward-compatible; existing documents render unchanged).
		 */
		readonly reveal?: TextureMaterialReveal;
	};
};

export type TextureRecipeDraft = Omit<
	DeepPartialObject<TextureRecipe>,
	"grain"
> & {
	/** Legacy VMA scalar grain strength. */
	readonly grain?: DeepPartialObject<TextureRecipe["grain"]> | number;
	/** Legacy VMA grain scale. Canonical vec-core stores this as `grain.size`. */
	readonly noiseScale?: number;
};

export type GlowRecipe = {
	readonly bloom: {
		readonly strength: number;
		readonly threshold: number;
		readonly radius: number;
		readonly softKnee: number;
		readonly colorResponse: number;
	};
	readonly halation: {
		readonly strength: number;
		readonly threshold: number;
		readonly radius: number;
		readonly hue: number;
	};
	readonly diffusion: {
		readonly strength: number;
		readonly radius: number;
	};
	readonly lightShafts: {
		readonly strength: number;
		readonly decay: number;
		readonly originX: number;
		readonly originY: number;
	};
};

export type GlowRecipeDraft = Omit<DeepPartialObject<GlowRecipe>, "bloom"> & {
	/** Legacy VMA scalar bloom strength. */
	readonly bloom?: DeepPartialObject<GlowRecipe["bloom"]> | number;
	/** Legacy VMA SVG-approximation radius. Canonical vec-core stores 0..1 radius. */
	readonly radius?: number;
};

export type OpticsRecipe = {
	readonly lensSoftness: number;
	readonly vignette: number;
	readonly chromaticFringing: number;
	readonly rayAngleWeight: number;
	readonly crossFilter: {
		readonly strength: number;
		readonly points: number;
		readonly length: number;
		readonly angle: number;
	};
	readonly haloPrism: {
		readonly strength: number;
		readonly radius: number;
		readonly width: number;
		readonly chromatic: number;
	};
};

export type OpticsRecipeDraft = DeepPartialObject<OpticsRecipe> & {
	/** Legacy VMA name for canonical `chromaticFringing`. */
	readonly chromaticAberration?: number;
};

export type MotionTemporalSeedMode = "fixed" | "frame" | "time";

export type MotionRecipe = {
	readonly fps: number;
	readonly temporalSeedMode: MotionTemporalSeedMode;
	readonly shutterAngle: number;
	readonly breath: number;
	readonly layerSeed: string | null;
};

export type MotionRecipeDraft = DeepPartialObject<MotionRecipe> & {
	/** Legacy VMA placeholder field; kept only so old drafts remain readable. */
	readonly blur?: number;
};

export type ShadowDropMode = "behind" | "knockout";

export type ShadowDropRecipe = {
	readonly enabled: boolean;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly blur: number;
	readonly color: string;
	readonly opacity: number;
	readonly mode: ShadowDropMode;
};

export type ShadowInnerRecipe = {
	readonly enabled: boolean;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly blur: number;
	readonly color: string;
	readonly opacity: number;
};

export type ShadowAmbientRecipe = {
	readonly enabled: boolean;
	readonly strength: number;
	readonly radius: number;
};

export type ShadowRecipe = {
	readonly drop: ShadowDropRecipe;
	readonly inner: ShadowInnerRecipe;
	readonly ambient: ShadowAmbientRecipe;
};

export type ShadowRecipeDraft = {
	readonly drop?: Partial<ShadowDropRecipe>;
	readonly inner?: Partial<ShadowInnerRecipe>;
	readonly ambient?: Partial<ShadowAmbientRecipe>;
	/** Legacy VMA drop-shadow fields. */
	readonly opacity?: number;
	readonly blur?: number;
	readonly offsetX?: number;
	readonly offsetY?: number;
};

export type DistortionWarpKind = "barrel" | "pincushion" | "twirl";
export type DistortionAxis = "horizontal" | "vertical" | "radial";

export type DistortionRecipe = {
	readonly wave: {
		readonly enabled: boolean;
		readonly strength: number;
		readonly frequency: number;
		readonly axis: DistortionAxis;
		readonly phase: number;
	};
	readonly warp: {
		readonly enabled: boolean;
		readonly strength: number;
		readonly kind: DistortionWarpKind;
		readonly centerX: number;
		readonly centerY: number;
	};
	readonly displacement: {
		readonly enabled: boolean;
		readonly strength: number;
		readonly scale: number;
		readonly seed: number;
	};
};

export type DistortionRecipeDraft = DeepPartialObject<DistortionRecipe> & {
	/** Legacy VMA displacement strength. */
	readonly amount?: number;
	readonly seed?: number;
};

export type StylizationHalftoneShape = "dot" | "line" | "cross";
export type StylizationDitherPattern =
	| "bayer"
	| "blue-noise"
	| "error-diffusion";
/**
 * `luminance` quantizes source luma and maps the ramp onto `ink`..`paper`
 * (duotone print/screen look). `per-channel` threshold-quantizes each RGB
 * channel independently, ignoring `ink`/`paper`. VMA's internal ordered-dither
 * mode name for `per-channel` is `"rgb"`; any future export adapter maps
 * VMA `rgb` -> contract `per-channel`.
 */
export type StylizationDitherMode = "luminance" | "per-channel";

export type StylizationRecipe = {
	readonly posterize: {
		readonly enabled: boolean;
		readonly levels: number;
	};
	readonly halftone: {
		readonly enabled: boolean;
		readonly cellSize: number;
		readonly angle: number;
		readonly shape: StylizationHalftoneShape;
	};
	readonly dither: {
		readonly enabled: boolean;
		readonly pattern: StylizationDitherPattern;
		readonly strength: number;
		/** Cell pitch in pixels, >=1. */
		readonly cellSize: number;
		/** Quantization steps, 2..8. */
		readonly levels: number;
		readonly mode: StylizationDitherMode;
		/** Pre-dither exposure offset, -1..1 with 0 neutral. */
		readonly brightness: number;
		/** Midtone curve applied after brightness (1 = neutral), 0.25..2.5. */
		readonly gamma: number;
		/** Ink (dark) colour of the luminance-mode ramp. Hex string. `luminance` mode only. */
		readonly ink: string;
		/** Paper (light) colour of the luminance-mode ramp. Hex string. `luminance` mode only. */
		readonly paper: string;
	};
	readonly contour: {
		readonly enabled: boolean;
		readonly threshold: number;
		readonly thickness: number;
	};
};

export type StylizationRecipeDraft = {
	readonly posterize?: Partial<StylizationRecipe["posterize"]> | number;
	readonly halftone?: Partial<StylizationRecipe["halftone"]> | number;
	readonly dither?: Partial<StylizationRecipe["dither"]>;
	readonly contour?: Partial<StylizationRecipe["contour"]>;
};

export type VisualRecipe = {
	readonly schemaVersion: VisualRecipeSchemaVersion;
	readonly id: string;
	readonly label: string;
	readonly intent: VisualIntent;
	readonly alphaMode: AlphaMode;
	readonly color: ColorRecipe;
	readonly surface: SurfaceRecipe;
	readonly texture: TextureRecipe;
	readonly glow: GlowRecipe;
	readonly optics: OpticsRecipe;
	readonly motion: MotionRecipe;
	readonly shadow: ShadowRecipe;
	readonly distortion: DistortionRecipe;
	readonly stylization: StylizationRecipe;
	readonly metadata: RecipeMetadata;
};

export type VisualRecipeDraft = Partial<{
	readonly schemaVersion: VisualRecipeSchemaVersion;
	readonly id: string;
	readonly label: string;
	readonly intent: VisualIntent;
	readonly alphaMode: AlphaMode;
	readonly color: ColorRecipeDraft;
	readonly surface: SurfaceRecipeDraft;
	readonly texture: TextureRecipeDraft;
	readonly glow: GlowRecipeDraft;
	readonly optics: OpticsRecipeDraft;
	readonly motion: MotionRecipeDraft;
	readonly shadow: ShadowRecipeDraft;
	readonly distortion: DistortionRecipeDraft;
	readonly stylization: StylizationRecipeDraft;
	readonly metadata: RecipeMetadata;
}>;

export type EffectTargetScope =
	| "scene"
	| "selection"
	| "group"
	| "object"
	| "layer";

export type EffectTargetRef = {
	readonly scope: EffectTargetScope;
	readonly id?: string;
};

export type EffectSlotRef = {
	readonly id: string;
	readonly path: string;
	readonly label?: string;
};

export type EffectMaskSpace = "scene" | "target" | "objectBoundingBox";

export type EffectMaskSourceKind =
	| "fullFrame"
	| "rect"
	| "ellipse"
	| "polygon"
	| "linearGradient"
	| "radialGradient"
	| "contourGradient"
	| "fieldMesh"
	| "svgMatte"
	| "proceduralNoise"
	| "stack"
	| "unsupported";

export type EffectMaskPoint = {
	readonly x: number;
	readonly y: number;
};

export type EffectMaskGradientStop = {
	readonly offset: number;
	readonly alpha: number;
};

export type EffectMaskSourceBase = {
	readonly kind: EffectMaskSourceKind;
	readonly space: EffectMaskSpace;
};

export type EffectMaskFullFrameSource = EffectMaskSourceBase & {
	readonly kind: "fullFrame";
};

export type EffectMaskRectSource = EffectMaskSourceBase & {
	readonly kind: "rect";
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly cornerRadius: number;
	readonly rotation: number;
};

export type EffectMaskEllipseSource = EffectMaskSourceBase & {
	readonly kind: "ellipse";
	readonly cx: number;
	readonly cy: number;
	readonly rx: number;
	readonly ry: number;
	readonly rotation: number;
};

export type EffectMaskPolygonSource = EffectMaskSourceBase & {
	readonly kind: "polygon";
	readonly points: readonly EffectMaskPoint[];
};

export type EffectMaskLinearGradientSource = EffectMaskSourceBase & {
	readonly kind: "linearGradient";
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
	readonly stops: readonly EffectMaskGradientStop[];
};

export type EffectMaskRadialGradientSource = EffectMaskSourceBase & {
	readonly kind: "radialGradient";
	readonly cx: number;
	readonly cy: number;
	readonly radius: number;
	readonly rx: number;
	readonly ry: number;
	readonly rotation: number;
	readonly stops: readonly EffectMaskGradientStop[];
};

export type EffectMaskContourSide = "inside" | "outside" | "both";

/**
 * Shape-following scalar field. `width` is a normalized fraction of the target
 * short axis outside scene space, or scene units when `space` is `scene`.
 */
export type EffectMaskContourGradientSource = EffectMaskSourceBase & {
	readonly kind: "contourGradient";
	readonly width: number;
	readonly side: EffectMaskContourSide;
};

/** Reusable scalar mesh persisted with the same normalized contract as shared Effect Field tools. */
export type EffectMaskFieldMeshSource = EffectMaskSourceBase & {
	readonly kind: "fieldMesh";
	readonly fieldMesh: ScalarEffectFieldMesh;
};

export type EffectMaskAlphaMode = "alpha" | "luminance";

export type EffectMaskSvgMatteSource = EffectMaskSourceBase & {
	readonly kind: "svgMatte";
	readonly refId: string;
	readonly alphaMode: EffectMaskAlphaMode;
};

export type EffectMaskProceduralNoiseSource = EffectMaskSourceBase & {
	readonly kind: "proceduralNoise";
	readonly seed: number;
	readonly scale: number;
	readonly contrast: number;
	readonly bias: number;
};

export type EffectMaskStackSource = EffectMaskSourceBase & {
	readonly kind: "stack";
	readonly items: readonly EffectMaskStackItem[];
};

/**
 * Forward-compatible inert source. Unknown source payloads are retained here
 * instead of becoming a full-frame matte, which would silently change pixels.
 */
export type EffectMaskUnsupportedSource = EffectMaskSourceBase & {
	readonly kind: "unsupported";
	readonly sourceKind: string;
	readonly payload: Readonly<Record<string, unknown>>;
};

export type EffectMaskSource =
	| EffectMaskFullFrameSource
	| EffectMaskRectSource
	| EffectMaskEllipseSource
	| EffectMaskPolygonSource
	| EffectMaskLinearGradientSource
	| EffectMaskRadialGradientSource
	| EffectMaskContourGradientSource
	| EffectMaskFieldMeshSource
	| EffectMaskSvgMatteSource
	| EffectMaskProceduralNoiseSource
	| EffectMaskStackSource
	| EffectMaskUnsupportedSource;

export type EffectMaskCombineMode =
	| "replace"
	| "add"
	| "intersect"
	| "subtract"
	| "difference";

export type EffectInfluenceFalloffKind =
	| "linear"
	| "smoothstep"
	| "gamma"
	| "threshold";

export type EffectInfluenceFalloff = {
	readonly kind: EffectInfluenceFalloffKind;
	readonly inputMin: number;
	readonly inputMax: number;
	readonly gamma: number;
	readonly softness: number;
};

export type EffectInfluence = {
	readonly enabled: boolean;
	readonly source: EffectMaskSource;
	readonly strength: number;
	readonly invert: boolean;
	/**
	 * Edge feather as a normalized fraction of the active resolution space's
	 * short axis. Render adapters scale it to pixels at resolve time.
	 */
	readonly featherRadius: number;
	readonly falloff: EffectInfluenceFalloff;
};

export type EffectMaskStackItem = EffectInfluence & {
	readonly id: string;
	readonly label: string;
	readonly combineMode: EffectMaskCombineMode;
};

export type EffectInfluenceAssignment = {
	readonly id: string;
	readonly label: string;
	readonly target: EffectTargetRef;
	readonly effect: EffectSlotRef;
	readonly influence: EffectInfluence;
	/** Shared field identity; `influence.source` remains the render-safe fallback snapshot. */
	readonly fieldId?: string;
};

/** One reusable scalar field that may drive several influence assignments. */
export type EffectFieldDefinition = {
	readonly id: string;
	readonly label: string;
	readonly source: EffectMaskSource;
};

export type EffectInfluenceRecipe = {
	readonly enabled: boolean;
	readonly assignments: readonly EffectInfluenceAssignment[];
	/** Omitted on legacy documents and when no shared fields are authored. */
	readonly fields?: readonly EffectFieldDefinition[];
};

export type EffectTargetRefDraft = Partial<EffectTargetRef>;
export type EffectSlotRefDraft = Partial<EffectSlotRef>;

export type EffectMaskFullFrameSourceDraft =
	Partial<EffectMaskFullFrameSource> & { readonly kind: "fullFrame" };
export type EffectMaskRectSourceDraft = Partial<EffectMaskRectSource> & {
	readonly kind: "rect";
};
export type EffectMaskEllipseSourceDraft = Partial<EffectMaskEllipseSource> & {
	readonly kind: "ellipse";
};
export type EffectMaskPolygonSourceDraft = Partial<EffectMaskPolygonSource> & {
	readonly kind: "polygon";
};
export type EffectMaskLinearGradientSourceDraft = Partial<
	Omit<EffectMaskLinearGradientSource, "stops">
> & {
	readonly kind: "linearGradient";
	readonly stops?: readonly Partial<EffectMaskGradientStop>[];
};
export type EffectMaskRadialGradientSourceDraft = Partial<
	Omit<EffectMaskRadialGradientSource, "stops">
> & {
	readonly kind: "radialGradient";
	readonly stops?: readonly Partial<EffectMaskGradientStop>[];
};
export type EffectMaskContourGradientSourceDraft =
	Partial<EffectMaskContourGradientSource> & {
		readonly kind: "contourGradient";
	};
export type EffectMaskFieldMeshSourceDraft = Partial<
	Omit<EffectMaskFieldMeshSource, "fieldMesh">
> & {
	readonly kind: "fieldMesh";
	readonly fieldMesh?: unknown;
};
export type EffectMaskSvgMatteSourceDraft =
	Partial<EffectMaskSvgMatteSource> & {
		readonly kind: "svgMatte";
	};
export type EffectMaskProceduralNoiseSourceDraft =
	Partial<EffectMaskProceduralNoiseSource> & {
		readonly kind: "proceduralNoise";
	};
export type EffectMaskStackSourceDraft = Partial<
	Omit<EffectMaskStackSource, "items">
> & {
	readonly kind: "stack";
	readonly items?: readonly EffectMaskStackItemDraft[];
};
export type EffectMaskUnsupportedSourceDraft =
	Partial<EffectMaskUnsupportedSource> & {
		readonly kind: "unsupported";
	};

export type EffectMaskSourceDraft =
	| EffectMaskFullFrameSourceDraft
	| EffectMaskRectSourceDraft
	| EffectMaskEllipseSourceDraft
	| EffectMaskPolygonSourceDraft
	| EffectMaskLinearGradientSourceDraft
	| EffectMaskRadialGradientSourceDraft
	| EffectMaskContourGradientSourceDraft
	| EffectMaskFieldMeshSourceDraft
	| EffectMaskSvgMatteSourceDraft
	| EffectMaskProceduralNoiseSourceDraft
	| EffectMaskStackSourceDraft
	| EffectMaskUnsupportedSourceDraft;

export type TextureMaterialAlphaMatteSourceDraft =
	| EffectMaskLinearGradientSourceDraft
	| EffectMaskRadialGradientSourceDraft
	| {
			readonly kind: "contourGradient";
			readonly space?: EffectMaskSpace;
			readonly width?: number;
			readonly invert?: boolean;
			readonly stops?: readonly Partial<EffectMaskGradientStop>[];
	  };

export type EffectInfluenceFalloffDraft = Partial<EffectInfluenceFalloff>;

export type EffectInfluenceDraft = Partial<
	Omit<EffectInfluence, "source" | "falloff">
> & {
	readonly source?: EffectMaskSourceDraft;
	readonly falloff?: EffectInfluenceFalloffDraft;
};

export type EffectMaskStackItemDraft = Partial<
	Omit<EffectMaskStackItem, "source" | "falloff">
> & {
	readonly source?: EffectMaskSourceDraft;
	readonly falloff?: EffectInfluenceFalloffDraft;
};

export type EffectInfluenceAssignmentDraft = Partial<
	Omit<EffectInfluenceAssignment, "target" | "effect" | "influence">
> & {
	readonly target?: EffectTargetRefDraft;
	readonly effect?: EffectSlotRefDraft;
	readonly influence?: EffectInfluenceDraft;
};

export type EffectFieldDefinitionDraft = Partial<
	Omit<EffectFieldDefinition, "source">
> & {
	readonly source?: EffectMaskSourceDraft | Readonly<Record<string, unknown>>;
};

export type EffectInfluenceRecipeDraft = {
	readonly enabled?: boolean;
	readonly assignments?: readonly EffectInfluenceAssignmentDraft[];
	readonly fields?: readonly EffectFieldDefinitionDraft[];
};

export type MaskLayer = EffectMaskStackItem;
export type MaskLayerDraft = EffectMaskStackItemDraft;
export type MaskStack = EffectMaskStackSource;
export type MaskStackDraft = EffectMaskStackSourceDraft;
export type MaskRecipe = EffectInfluenceRecipe;
export type MaskRecipeDraft = EffectInfluenceRecipeDraft;

export type AutomationEasing = "linear" | "easeInOut" | "hold";

export type AutomationTrackMode = "additive" | "replace";

export type AutomationBindingChannel =
	| "effectInfluence"
	| "effectParam"
	| "transform";

export type AutomationBinding =
	| {
			readonly channel: "effectInfluence";
			readonly assignmentId: string;
			readonly path: string;
	  }
	| {
			readonly channel: "effectParam";
			readonly target: EffectTargetRef;
			readonly effect: EffectSlotRef;
			readonly path: string;
	  }
	| {
			readonly channel: "transform";
			readonly target: EffectTargetRef;
			readonly path: string;
	  };

export type AutomationKeyframe = {
	readonly frame: number;
	readonly value: number;
	/** Governs the segment from this keyframe to the next. */
	readonly easing?: AutomationEasing;
};

export type AutomationTrack = {
	readonly binding: AutomationBinding;
	readonly mode?: AutomationTrackMode;
	readonly keyframes: readonly AutomationKeyframe[];
};

export type AutomationRecipe = {
	readonly enabled: boolean;
	readonly fps: number;
	readonly durationFrames: number;
	readonly tracks: readonly AutomationTrack[];
};

export type AutomationRecipeDraft = Partial<AutomationRecipe>;

export type AutomationWrite = {
	readonly binding: AutomationBinding;
	readonly value: number;
	readonly mode: AutomationTrackMode;
};

export const VISUAL_INTENTS = [
	"generic",
	"photo-video",
	"motion-graphics",
	"ui-surface",
] as const satisfies readonly VisualIntent[];

export const ALPHA_MODES = [
	"opaque",
	"straight",
	"premultiplied",
] as const satisfies readonly AlphaMode[];

export const SURFACE_PAINT_KINDS = [
	"solid",
	"linearGradient",
	"radialGradient",
	"shaderGradient",
] as const satisfies readonly SurfacePaintKind[];

export const SURFACE_SHADER_GRADIENT_TYPES = [
	"plane",
	"sphere",
	"waterPlane",
] as const satisfies readonly SurfaceShaderGradientType[];

export const TEXTURE_PARTICLE_CHARACTERS = [
	"neutral",
	"soft",
	"clump",
	"pepper",
	"crystal",
] as const satisfies readonly TextureParticleCharacter[];

export const TEXTURE_MATERIAL_MODES = [
	"off",
	"density",
	"dye",
	"particle",
	"mixed",
] as const satisfies readonly TextureMaterialMode[];

export const TEXTURE_MATERIAL_BLEND_MODES = [
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
	"dissolve",
] as const satisfies readonly TextureMaterialBlendMode[];

export const TEXTURE_MATERIAL_REVEAL_MODES = [
	"in",
	"out",
] as const satisfies readonly TextureMaterialReveal["mode"][];

export const TEXTURE_GRAIN_FUSION_MODES = [
	"additive",
	"overlay",
	"softLight",
] as const satisfies readonly TextureGrainFusionMode[];

export const TEXTURE_PARTICLE_FIELD_MODES = [
	"contour",
	"linear",
	"mesh",
] as const satisfies readonly TextureParticleFieldMode[];

const TEXTURE_PARTICLE_LINEAR_FIELD_COORD_MIN = -2;
const TEXTURE_PARTICLE_LINEAR_FIELD_COORD_MAX = 3;
const TEXTURE_PARTICLE_LINEAR_FIELD_MIN_LENGTH = 1e-6;
const FULL_TURN_DEGREES = 360;

export const TEXTURE_PARTICLE_FIELD_MESH_MIN_GRID =
	SCALAR_EFFECT_FIELD_MESH_MIN_GRID;
export const TEXTURE_PARTICLE_FIELD_MESH_MAX_GRID =
	SCALAR_EFFECT_FIELD_MESH_MAX_GRID;

export const DEFAULT_TEXTURE_PARTICLE_FIELD_MESH: TextureParticleFieldMesh = {
	rows: 3,
	cols: 3,
	points: [
		{ x: 0, y: 0, density: 0.12 },
		{ x: 0.5, y: 0, density: 0.68 },
		{ x: 1, y: 0, density: 0.36 },
		{ x: 0, y: 0.5, density: 0.22 },
		{ x: 0.5, y: 0.5, density: 1 },
		{ x: 1, y: 0.5, density: 0.82 },
		{ x: 0, y: 1, density: 0.06 },
		{ x: 0.5, y: 1, density: 0.48 },
		{ x: 1, y: 1, density: 0.24 },
	],
};

export const MOTION_TEMPORAL_SEED_MODES = [
	"fixed",
	"frame",
	"time",
] as const satisfies readonly MotionTemporalSeedMode[];

export const SHADOW_DROP_MODES = [
	"behind",
	"knockout",
] as const satisfies readonly ShadowDropMode[];

export const DISTORTION_WARP_KINDS = [
	"barrel",
	"pincushion",
	"twirl",
] as const satisfies readonly DistortionWarpKind[];

export const DISTORTION_AXES = [
	"horizontal",
	"vertical",
	"radial",
] as const satisfies readonly DistortionAxis[];

export const STYLIZATION_HALFTONE_SHAPES = [
	"dot",
	"line",
	"cross",
] as const satisfies readonly StylizationHalftoneShape[];

export const STYLIZATION_DITHER_PATTERNS = [
	"bayer",
	"blue-noise",
	"error-diffusion",
] as const satisfies readonly StylizationDitherPattern[];

export const STYLIZATION_DITHER_MODES = [
	"luminance",
	"per-channel",
] as const satisfies readonly StylizationDitherMode[];

export const EFFECT_TARGET_SCOPES = [
	"scene",
	"selection",
	"group",
	"object",
	"layer",
] as const satisfies readonly EffectTargetScope[];

export const EFFECT_MASK_SPACES = [
	"scene",
	"target",
	"objectBoundingBox",
] as const satisfies readonly EffectMaskSpace[];

export const EFFECT_MASK_SOURCE_KINDS = [
	"fullFrame",
	"rect",
	"ellipse",
	"polygon",
	"linearGradient",
	"radialGradient",
	"contourGradient",
	"fieldMesh",
	"svgMatte",
	"proceduralNoise",
	"stack",
	"unsupported",
] as const satisfies readonly EffectMaskSourceKind[];

export const EFFECT_MASK_CONTOUR_SIDES = [
	"inside",
	"outside",
	"both",
] as const satisfies readonly EffectMaskContourSide[];

export const EFFECT_MASK_ALPHA_MODES = [
	"alpha",
	"luminance",
] as const satisfies readonly EffectMaskAlphaMode[];

export const EFFECT_MASK_COMBINE_MODES = [
	"replace",
	"add",
	"intersect",
	"subtract",
	"difference",
] as const satisfies readonly EffectMaskCombineMode[];

export const EFFECT_INFLUENCE_FALLOFF_KINDS = [
	"linear",
	"smoothstep",
	"gamma",
	"threshold",
] as const satisfies readonly EffectInfluenceFalloffKind[];

export const AUTOMATION_EASINGS = [
	"linear",
	"easeInOut",
	"hold",
] as const satisfies readonly AutomationEasing[];

export const AUTOMATION_TRACK_MODES = [
	"additive",
	"replace",
] as const satisfies readonly AutomationTrackMode[];

export const AUTOMATION_BINDING_CHANNELS = [
	"effectInfluence",
	"effectParam",
	"transform",
] as const satisfies readonly AutomationBindingChannel[];

export const NEUTRAL_COLOR_RECIPE: ColorRecipe = {
	exposure: 0,
	contrast: 1,
	saturation: 1,
	temperature: 0,
	tint: 0,
	density: 0,
	printContrast: 0,
	cmy: {
		cyan: 0,
		magenta: 0,
		yellow: 0,
	},
};

export const NEUTRAL_SURFACE_PAINT_SOLID: SurfacePaintSolid = {
	kind: "solid",
	color: "#808080",
};

export const NEUTRAL_SURFACE_PAINT_LINEAR_GRADIENT: SurfacePaintLinearGradient =
	{
		kind: "linearGradient",
		from: "#000000",
		to: "#ffffff",
		angle: 0,
		balance: 0,
	};

export const NEUTRAL_SURFACE_PAINT_RADIAL_GRADIENT: SurfacePaintRadialGradient =
	{
		kind: "radialGradient",
		inner: "#ffffff",
		outer: "#000000",
		centerX: 0.5,
		centerY: 0.5,
		radius: 0.75,
	};

export const NEUTRAL_SURFACE_PAINT_SHADER_GRADIENT: SurfacePaintShaderGradient =
	{
		kind: "shaderGradient",
		type: "plane",
		color1: "#2f3936",
		color2: "#6f7a74",
		color3: "#c7d1c6",
		uSpeed: 0.22,
		uStrength: 3.2,
		uDensity: 1.1,
		uFrequency: 4.8,
		uAmplitude: 2.6,
		uTime: 0,
		brightness: 0.95,
	};

export const NEUTRAL_SURFACE_SHADE: SurfaceShadeRecipe = {
	enabled: false,
	strength: 0,
	softness: 0.5,
	angle: 0,
	offset: 0,
};

export const NEUTRAL_SURFACE_RECIPE: SurfaceRecipe = {
	paint: NEUTRAL_SURFACE_PAINT_SOLID,
	shade: NEUTRAL_SURFACE_SHADE,
};

export const NEUTRAL_TEXTURE_RECIPE: TextureRecipe = {
	grain: {
		enabled: false,
		strength: 0,
		size: 0.3,
		character: "neutral",
		densityCoupling: 0,
		temporalStability: 1,
		seed: 101,
		fusionMode: "additive",
		chroma: 0,
	},
	material: {
		mode: "off",
		strength: 0,
		dyeShift: 0,
		particleContrast: 0,
	},
};

export const NEUTRAL_GLOW_RECIPE: GlowRecipe = {
	bloom: {
		strength: 0,
		threshold: 0.8,
		radius: 0.35,
		softKnee: 0.25,
		colorResponse: 0,
	},
	halation: {
		strength: 0,
		threshold: 0.78,
		radius: 0.28,
		hue: 32,
	},
	diffusion: {
		strength: 0,
		radius: 0.3,
	},
	lightShafts: {
		strength: 0,
		decay: 0.5,
		originX: 0.5,
		originY: 0.15,
	},
};

export const NEUTRAL_OPTICS_RECIPE: OpticsRecipe = {
	lensSoftness: 0,
	vignette: 0,
	chromaticFringing: 0,
	rayAngleWeight: 0,
	crossFilter: {
		strength: 0,
		points: 4,
		length: 0.4,
		angle: 0,
	},
	haloPrism: {
		strength: 0,
		radius: 0.62,
		width: 0.22,
		chromatic: 0.65,
	},
};

export const NEUTRAL_MOTION_RECIPE: MotionRecipe = {
	fps: 24,
	temporalSeedMode: "fixed",
	shutterAngle: 0,
	breath: 0,
	layerSeed: null,
};

export const NEUTRAL_SHADOW_DROP: ShadowDropRecipe = {
	enabled: false,
	offsetX: 0,
	offsetY: 0,
	blur: 0,
	color: "#000000",
	opacity: 0,
	mode: "behind",
};

export const NEUTRAL_SHADOW_INNER: ShadowInnerRecipe = {
	enabled: false,
	offsetX: 0,
	offsetY: 0,
	blur: 0,
	color: "#000000",
	opacity: 0,
};

export const NEUTRAL_SHADOW_AMBIENT: ShadowAmbientRecipe = {
	enabled: false,
	strength: 0,
	radius: 0,
};

export const NEUTRAL_SHADOW_RECIPE: ShadowRecipe = {
	drop: NEUTRAL_SHADOW_DROP,
	inner: NEUTRAL_SHADOW_INNER,
	ambient: NEUTRAL_SHADOW_AMBIENT,
};

export const NEUTRAL_DISTORTION_RECIPE: DistortionRecipe = {
	wave: {
		enabled: false,
		strength: 0,
		frequency: 0,
		axis: "horizontal",
		phase: 0,
	},
	warp: {
		enabled: false,
		strength: 0,
		kind: "barrel",
		centerX: 0.5,
		centerY: 0.5,
	},
	displacement: {
		enabled: false,
		strength: 0,
		scale: 1,
		seed: 0,
	},
};

export const NEUTRAL_STYLIZATION_RECIPE: StylizationRecipe = {
	posterize: {
		enabled: false,
		levels: 32,
	},
	halftone: {
		enabled: false,
		cellSize: 0.01,
		angle: 0,
		shape: "dot",
	},
	dither: {
		enabled: false,
		pattern: "bayer",
		strength: 0,
		cellSize: 4,
		levels: 2,
		mode: "luminance",
		brightness: 0,
		gamma: 1,
		ink: "#000000",
		paper: "#ffffff",
	},
	contour: {
		enabled: false,
		threshold: 0.5,
		thickness: 0,
	},
};

export const NEUTRAL_VISUAL_RECIPE: VisualRecipe = {
	schemaVersion: VISUAL_RECIPE_SCHEMA_VERSION,
	id: "neutral",
	label: "Neutral",
	intent: "generic",
	alphaMode: "opaque",
	color: NEUTRAL_COLOR_RECIPE,
	surface: NEUTRAL_SURFACE_RECIPE,
	texture: NEUTRAL_TEXTURE_RECIPE,
	glow: NEUTRAL_GLOW_RECIPE,
	optics: NEUTRAL_OPTICS_RECIPE,
	motion: NEUTRAL_MOTION_RECIPE,
	shadow: NEUTRAL_SHADOW_RECIPE,
	distortion: NEUTRAL_DISTORTION_RECIPE,
	stylization: NEUTRAL_STYLIZATION_RECIPE,
	metadata: {},
};

export const NEUTRAL_EFFECT_TARGET_REF: EffectTargetRef = { scope: "scene" };

export const NEUTRAL_EFFECT_SLOT_REF: EffectSlotRef = {
	id: "visual-recipe",
	path: "recipe",
};

export const NEUTRAL_EFFECT_MASK_FULL_FRAME_SOURCE: EffectMaskFullFrameSource =
	{
		kind: "fullFrame",
		space: "target",
	};

/** Neutral shared mesh: full applicability at every control point. */
export const NEUTRAL_EFFECT_FIELD_MESH: ScalarEffectFieldMesh = {
	rows: 2,
	cols: 2,
	points: [
		{ x: 0, y: 0, value: 1 },
		{ x: 1, y: 0, value: 1 },
		{ x: 0, y: 1, value: 1 },
		{ x: 1, y: 1, value: 1 },
	],
};

export const NEUTRAL_EFFECT_MASK_SOURCE = NEUTRAL_EFFECT_MASK_FULL_FRAME_SOURCE;

export const NEUTRAL_EFFECT_INFLUENCE_FALLOFF: EffectInfluenceFalloff = {
	kind: "linear",
	inputMin: 0,
	inputMax: 1,
	gamma: 1,
	softness: 0,
};

export const NEUTRAL_EFFECT_INFLUENCE: EffectInfluence = {
	enabled: true,
	source: NEUTRAL_EFFECT_MASK_FULL_FRAME_SOURCE,
	strength: 1,
	invert: false,
	featherRadius: 0,
	falloff: NEUTRAL_EFFECT_INFLUENCE_FALLOFF,
};

export const NEUTRAL_EFFECT_INFLUENCE_RECIPE: EffectInfluenceRecipe = {
	enabled: false,
	assignments: [],
};

export const NEUTRAL_AUTOMATION_RECIPE: AutomationRecipe = {
	enabled: false,
	fps: 30,
	durationFrames: 1,
	tracks: [],
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const DEFAULT_GRADIENT_STOPS: readonly EffectMaskGradientStop[] = [
	{ offset: 0, alpha: 1 },
	{ offset: 1, alpha: 0 },
];
const LEGACY_NOISE_SCALE_TO_GRAIN_SIZE = NEUTRAL_TEXTURE_RECIPE.grain.size;
const LEGACY_GLOW_RADIUS_SCALE = 100;
const LEGACY_RGB_SPLIT_SCALE = 10;

const isObjectRecord = (
	value: unknown,
): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positiveInt = (value: unknown, fallback: number): number => {
	const numeric = finiteNumber(value, fallback);
	return Math.max(1, Math.floor(numeric));
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const clamp01 = (value: number): number => clamp(value, 0, 1);

const oneOf = <T extends string>(
	value: unknown,
	choices: readonly T[],
	fallback: T,
): T =>
	typeof value === "string" && choices.includes(value as T)
		? (value as T)
		: fallback;

const stringOrDefault = (value: unknown, fallback: string): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const hexOrDefault = (value: unknown, fallback: string): string =>
	typeof value === "string" && HEX_RE.test(value) ? value : fallback;

const wrapAngle = (value: unknown, fallback = 0): number => {
	const numeric = finiteNumber(value, fallback);
	const full = Math.PI * 2;
	return ((numeric % full) + full) % full;
};

const normalizeDegrees = (value: number): number =>
	((value % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

const legacyScaled01 = (
	value: unknown,
	fallback: number,
	scale: number,
): number =>
	typeof value === "number" && Number.isFinite(value)
		? clamp01(value / scale)
		: fallback;

const asRecord = (
	value: unknown,
): Readonly<Record<string, unknown>> | undefined =>
	isObjectRecord(value) ? value : undefined;

/**
 * Converts the persisted particle-dissolve `density` mesh into the reusable
 * scalar Effect Field representation. Storage keeps the domain name `density`;
 * shared editors and hit-testing operate on the generic `value` channel.
 */
export function textureParticleFieldMeshToScalarEffectFieldMesh(
	fieldMesh: TextureParticleFieldMesh,
): ScalarEffectFieldMesh {
	return {
		rows: fieldMesh.rows,
		cols: fieldMesh.cols,
		points: fieldMesh.points.map((point) => ({
			x: point.x,
			y: point.y,
			value: point.density,
		})),
	};
}

/**
 * Converts a reusable scalar Effect Field mesh back to the persisted
 * particle-dissolve `density` mesh shape.
 */
export function scalarEffectFieldMeshToTextureParticleFieldMesh(
	fieldMesh: ScalarEffectFieldMesh,
): TextureParticleFieldMesh {
	return {
		rows: fieldMesh.rows,
		cols: fieldMesh.cols,
		points: fieldMesh.points.map((point) => ({
			x: point.x,
			y: point.y,
			density: point.value,
		})),
	};
}

const normalizeTextureParticleFieldMesh = (
	draft: unknown,
	fallback: TextureParticleFieldMesh = DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
): TextureParticleFieldMesh =>
	scalarEffectFieldMeshToTextureParticleFieldMesh(
		normalizeScalarEffectFieldMesh(
			draft,
			textureParticleFieldMeshToScalarEffectFieldMesh(fallback),
			{ valueKeys: ["density", "value"] },
		),
	);

const clampLinearFieldCoordinate = (value: unknown, fallback: number): number =>
	clamp(
		finiteNumber(value, fallback),
		TEXTURE_PARTICLE_LINEAR_FIELD_COORD_MIN,
		TEXTURE_PARTICLE_LINEAR_FIELD_COORD_MAX,
	);

/** Synthesizes a target-space Linear particle field from legacy angle+extent. */
export function textureParticleLinearFieldFromAngle(
	angle: number,
	extent: number,
): TextureParticleLinearField {
	const axis = linearEffectFieldAxis(
		{ x: 0, y: 0, width: 1, height: 1 },
		normalizeDegrees(angle),
	);
	return {
		kind: "linear",
		space: "target",
		x1: axis.from.x,
		y1: axis.from.y,
		x2: axis.to.x,
		y2: axis.to.y,
		plateau: clamp(finiteNumber(1 - extent, 0.1), 0, 0.99),
	};
}

/**
 * Materializes a legacy `invert` flag into start/end coordinates and returns a
 * canonical Linear field with no hidden direction flip. Authoring tools use this
 * before presenting or rewriting endpoints so the visible field line matches the
 * renderer's effective alpha ramp.
 */
export function textureParticleLinearFieldEffective(
	field: TextureParticleLinearField,
): TextureParticleLinearField {
	const base = {
		kind: field.kind,
		space: field.space,
		x1: field.x1,
		y1: field.y1,
		x2: field.x2,
		y2: field.y2,
		plateau: field.plateau,
	} satisfies TextureParticleLinearField;
	if (!field.invert) return base;
	return {
		...base,
		x1: field.x2,
		y1: field.y2,
		x2: field.x1,
		y2: field.y1,
	};
}

/** Returns the screen-space angle represented by target-space Linear endpoints. */
export function textureParticleLinearFieldAngle(
	field: TextureParticleLinearField,
): number {
	const dx = field.x2 - field.x1;
	const dy = field.y2 - field.y1;
	if (dx * dx + dy * dy <= TEXTURE_PARTICLE_LINEAR_FIELD_MIN_LENGTH) {
		return 0;
	}
	return normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
}

/** Converts a Linear field plateau back into the legacy Extent scalar. */
export function textureParticleLinearFieldExtent(
	field: TextureParticleLinearField,
): number {
	return clamp01(1 - field.plateau);
}

/** Rotates a Linear field around its current center while preserving length/range. */
export function textureParticleLinearFieldWithAngle(
	field: TextureParticleLinearField,
	angle: number,
): TextureParticleLinearField {
	const dx = field.x2 - field.x1;
	const dy = field.y2 - field.y1;
	const length = Math.hypot(dx, dy);
	if (length <= TEXTURE_PARTICLE_LINEAR_FIELD_MIN_LENGTH) {
		return textureParticleLinearFieldFromAngle(
			angle,
			textureParticleLinearFieldExtent(field),
		);
	}
	const radians = (normalizeDegrees(angle) * Math.PI) / 180;
	const half = length / 2;
	const center = {
		x: (field.x1 + field.x2) / 2,
		y: (field.y1 + field.y2) / 2,
	};
	const direction = { x: Math.cos(radians), y: Math.sin(radians) };
	return {
		...field,
		x1: center.x - direction.x * half,
		y1: center.y - direction.y * half,
		x2: center.x + direction.x * half,
		y2: center.y + direction.y * half,
	};
}

const normalizeTextureParticleLinearField = (
	draft: unknown,
	fallback: TextureParticleLinearField,
): TextureParticleLinearField => {
	const field = asRecord(draft);
	if (!field) return fallback;
	let x1 = clampLinearFieldCoordinate(field.x1, fallback.x1);
	let y1 = clampLinearFieldCoordinate(field.y1, fallback.y1);
	let x2 = clampLinearFieldCoordinate(field.x2, fallback.x2);
	let y2 = clampLinearFieldCoordinate(field.y2, fallback.y2);
	const dx = x2 - x1;
	const dy = y2 - y1;
	if (dx * dx + dy * dy <= TEXTURE_PARTICLE_LINEAR_FIELD_MIN_LENGTH) {
		// Both endpoints came from user/serialized input and collided; resetting
		// only x2/y2 could still leave a zero-length field (or teleport just one
		// endpoint) if the fallback's rescue point also collides with x1/y1.
		// `fallback` is non-degenerate by construction, so replacing all four
		// coordinates guarantees a valid field regardless of which endpoint(s)
		// collided.
		x1 = fallback.x1;
		y1 = fallback.y1;
		x2 = fallback.x2;
		y2 = fallback.y2;
	}
	const invert = Boolean(field.invert ?? fallback.invert ?? false);
	return {
		kind: "linear",
		space: "target",
		x1,
		y1,
		x2,
		y2,
		plateau: clamp(finiteNumber(field.plateau, fallback.plateau), 0, 0.99),
		...(invert ? { invert } : {}),
	};
};

/** Resolves the effective Linear particle field, including angle-only legacy data. */
export function resolveTextureParticleLinearField(
	texture: TextureRecipe,
): TextureParticleLinearField {
	return (
		texture.material.linearField ??
		textureParticleLinearFieldFromAngle(
			texture.material.angle ?? 0,
			texture.material.strength,
		)
	);
}

/**
 * Moves one scalar field-mesh point in normalized effect-bounds coordinates.
 * The rectangular grid topology is preserved; renderers keep using the same
 * Coons-patch lowering while point positions may be warped by authoring.
 */
export function moveTextureParticleFieldMeshPoint(
	fieldMesh: TextureParticleFieldMesh,
	row: number,
	col: number,
	point: { readonly x: number; readonly y: number },
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		moveScalarEffectFieldMeshPoint(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			row,
			col,
			point,
		),
	);
}

/** Sets one scalar field-mesh control point's particle density. */
export function setTextureParticleFieldMeshPointDensity(
	fieldMesh: TextureParticleFieldMesh,
	row: number,
	col: number,
	density: number,
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		setScalarEffectFieldMeshPointValue(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			row,
			col,
			density,
		),
	);
}

/** Inserts a scalar density row between `afterRow` and `afterRow + 1`. */
export function insertTextureParticleFieldMeshRow(
	fieldMesh: TextureParticleFieldMesh,
	afterRow: number,
	t: number,
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		insertScalarEffectFieldMeshRow(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			afterRow,
			t,
		),
	);
}

/** Inserts a scalar density column between `afterCol` and `afterCol + 1`. */
export function insertTextureParticleFieldMeshColumn(
	fieldMesh: TextureParticleFieldMesh,
	afterCol: number,
	t: number,
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		insertScalarEffectFieldMeshColumn(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			afterCol,
			t,
		),
	);
}

/** Removes one interior density row; boundary rows are retained. */
export function removeTextureParticleFieldMeshRow(
	fieldMesh: TextureParticleFieldMesh,
	row: number,
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		removeScalarEffectFieldMeshRow(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			row,
		),
	);
}

/** Removes one interior density column; boundary columns are retained. */
export function removeTextureParticleFieldMeshColumn(
	fieldMesh: TextureParticleFieldMesh,
	col: number,
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		removeScalarEffectFieldMeshColumn(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			col,
		),
	);
}

/** Removes the interior row and/or column passing through a density point. */
export function removeTextureParticleFieldMeshPointLines(
	fieldMesh: TextureParticleFieldMesh,
	row: number,
	col: number,
): TextureParticleFieldMesh {
	return scalarEffectFieldMeshToTextureParticleFieldMesh(
		removeScalarEffectFieldMeshPointLines(
			textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
			row,
			col,
		),
	);
}

/**
 * Canonicalizes vec-core color grade data. Legacy VMA `tint: string | null`
 * inputs are treated as neutral because upstream v3 uses a numeric tint axis.
 */
export function normalizeColorRecipe(
	draft: ColorRecipeDraft = {},
): ColorRecipe {
	const base = NEUTRAL_COLOR_RECIPE;
	const cmy = draft.cmy ?? {};
	return {
		exposure: clamp(finiteNumber(draft.exposure, base.exposure), -4, 4),
		contrast: clamp(finiteNumber(draft.contrast, base.contrast), 0, 4),
		saturation: clamp(finiteNumber(draft.saturation, base.saturation), 0, 4),
		temperature: clamp(
			finiteNumber(draft.temperature, base.temperature),
			-1,
			1,
		),
		tint: clamp(
			typeof draft.tint === "number"
				? finiteNumber(draft.tint, base.tint)
				: base.tint,
			-1,
			1,
		),
		density: clamp01(finiteNumber(draft.density, base.density)),
		printContrast: clamp01(
			finiteNumber(draft.printContrast, base.printContrast),
		),
		cmy: {
			cyan: clamp(finiteNumber(cmy.cyan, base.cmy.cyan), -1, 1),
			magenta: clamp(finiteNumber(cmy.magenta, base.cmy.magenta), -1, 1),
			yellow: clamp(finiteNumber(cmy.yellow, base.cmy.yellow), -1, 1),
		},
	};
}

export function mergeColorRecipeDraft(
	base: ColorRecipeDraft | undefined,
	override: ColorRecipeDraft | undefined,
): ColorRecipeDraft {
	return {
		...base,
		...override,
		cmy: {
			...base?.cmy,
			...override?.cmy,
		},
	};
}

export function normalizeSurfacePaint(
	draft: SurfaceRecipeDraft["paint"],
	legacyColor?: string | null,
): SurfacePaint {
	if (draft === "flat") {
		return {
			kind: "solid",
			color: hexOrDefault(legacyColor, NEUTRAL_SURFACE_PAINT_SOLID.color),
		};
	}
	if (draft === "source" || !draft || typeof draft !== "object") {
		return NEUTRAL_SURFACE_PAINT_SOLID;
	}
	switch (draft.kind) {
		case "solid":
			return {
				kind: "solid",
				color: hexOrDefault(draft.color, NEUTRAL_SURFACE_PAINT_SOLID.color),
			};
		case "linearGradient": {
			const base = NEUTRAL_SURFACE_PAINT_LINEAR_GRADIENT;
			return {
				kind: "linearGradient",
				from: hexOrDefault(draft.from, base.from),
				to: hexOrDefault(draft.to, base.to),
				angle: wrapAngle(draft.angle, base.angle),
				balance: clamp(finiteNumber(draft.balance, base.balance), -1, 1),
			};
		}
		case "radialGradient": {
			const base = NEUTRAL_SURFACE_PAINT_RADIAL_GRADIENT;
			return {
				kind: "radialGradient",
				inner: hexOrDefault(draft.inner, base.inner),
				outer: hexOrDefault(draft.outer, base.outer),
				centerX: clamp01(finiteNumber(draft.centerX, base.centerX)),
				centerY: clamp01(finiteNumber(draft.centerY, base.centerY)),
				radius: clamp(finiteNumber(draft.radius, base.radius), 0.01, 2),
			};
		}
		case "shaderGradient": {
			const base = NEUTRAL_SURFACE_PAINT_SHADER_GRADIENT;
			return {
				kind: "shaderGradient",
				type: oneOf(draft.type, SURFACE_SHADER_GRADIENT_TYPES, base.type),
				color1: hexOrDefault(draft.color1, base.color1),
				color2: hexOrDefault(draft.color2, base.color2),
				color3: hexOrDefault(draft.color3, base.color3),
				uSpeed: clamp(finiteNumber(draft.uSpeed, base.uSpeed), -4, 4),
				uStrength: clamp(finiteNumber(draft.uStrength, base.uStrength), 0, 8),
				uDensity: clamp(finiteNumber(draft.uDensity, base.uDensity), 0.01, 4),
				uFrequency: clamp(
					finiteNumber(draft.uFrequency, base.uFrequency),
					0,
					16,
				),
				uAmplitude: clamp(
					finiteNumber(draft.uAmplitude, base.uAmplitude),
					0,
					8,
				),
				uTime: finiteNumber(draft.uTime, base.uTime),
				brightness: clamp(
					finiteNumber(draft.brightness, base.brightness),
					0,
					2.5,
				),
			};
		}
		default:
			return NEUTRAL_SURFACE_PAINT_SOLID;
	}
}

export function normalizeSurfaceShade(
	draft: SurfaceShadeRecipeDraft | undefined,
): SurfaceShadeRecipe {
	const base = NEUTRAL_SURFACE_SHADE;
	const value = draft ?? {};
	return {
		enabled: Boolean(value.enabled ?? base.enabled),
		strength: clamp01(finiteNumber(value.strength, base.strength)),
		softness: clamp01(finiteNumber(value.softness, base.softness)),
		angle: wrapAngle(value.angle, base.angle),
		offset: clamp(finiteNumber(value.offset, base.offset), -1, 1),
	};
}

export function normalizeSurfaceRecipe(
	draft: SurfaceRecipeDraft = {},
): SurfaceRecipe {
	return {
		paint: normalizeSurfacePaint(draft.paint, draft.color),
		shade: normalizeSurfaceShade(draft.shade),
	};
}

export function mergeSurfaceRecipeDraft(
	base: SurfaceRecipeDraft | undefined,
	override: SurfaceRecipeDraft | undefined,
): SurfaceRecipeDraft {
	const basePaint = base?.paint;
	const overridePaint = override?.paint;
	const paint =
		isObjectRecord(basePaint) &&
		isObjectRecord(overridePaint) &&
		basePaint.kind === overridePaint.kind
			? ({
					...basePaint,
					...overridePaint,
				} as SurfacePaintDraft)
			: (overridePaint ?? basePaint);
	const color = override?.color ?? base?.color;
	return {
		...(paint === undefined ? {} : { paint }),
		shade: {
			...base?.shade,
			...override?.shade,
		},
		...(color === undefined ? {} : { color }),
	};
}

/**
 * Canonicalizes texture data and migrates the old VMA scalar
 * `{ grain, noiseScale }` pair into upstream `grain.strength` / `grain.size`.
 */
export function normalizeTextureRecipe(
	draft: TextureRecipeDraft = {},
): TextureRecipe {
	const base = NEUTRAL_TEXTURE_RECIPE;
	const grainDraft = asRecord(draft.grain);
	const legacyGrain =
		typeof draft.grain === "number" ? finiteNumber(draft.grain, 0) : undefined;
	const legacySize =
		typeof draft.noiseScale === "number" && Number.isFinite(draft.noiseScale)
			? draft.noiseScale * LEGACY_NOISE_SCALE_TO_GRAIN_SIZE
			: undefined;
	const strength = clamp01(
		finiteNumber(grainDraft?.strength, legacyGrain ?? base.grain.strength),
	);
	const material = draft.material ?? {};
	const materialStrength = clamp01(
		finiteNumber(material.strength, base.material.strength),
	);
	const fieldMode = oneOf(
		material.fieldMode,
		TEXTURE_PARTICLE_FIELD_MODES,
		base.material.fieldMode ?? "contour",
	);
	const hasAuthoredFieldMode = fieldMode === material.fieldMode;
	const hasFieldMeshDraft = material.fieldMesh !== undefined;
	const hasLinearFieldDraft = material.linearField !== undefined;
	const serializedFieldMode = hasAuthoredFieldMode
		? fieldMode
		: hasFieldMeshDraft
			? ("mesh" as const)
			: hasLinearFieldDraft
				? ("linear" as const)
				: null;
	const alphaMatte = normalizeTextureMaterialAlphaMatte(
		material.alphaMatte as TextureMaterialAlphaMatteSourceDraft | undefined,
	);
	const reveal = normalizeTextureMaterialReveal(material.reveal);
	// Validate-or-omit, never synthesize: an absent/invalid draft value must stay
	// absent in the normalized output so `effectiveTextureBlendMode` can tell
	// "never authored" (derive from `mode`) apart from an authored blend mode.
	const blendMode =
		typeof material.blendMode === "string" &&
		(TEXTURE_MATERIAL_BLEND_MODES as readonly string[]).includes(
			material.blendMode,
		)
			? (material.blendMode as TextureMaterialBlendMode)
			: undefined;
	const overlayColor =
		typeof material.overlayColor === "string"
			? material.overlayColor
			: undefined;
	const fallbackLinearField = textureParticleLinearFieldFromAngle(
		typeof material.angle === "number" && Number.isFinite(material.angle)
			? material.angle
			: (base.material.angle ?? 0),
		materialStrength,
	);
	const linearField =
		fieldMode === "linear" || hasLinearFieldDraft
			? normalizeTextureParticleLinearField(
					material.linearField,
					fallbackLinearField,
				)
			: null;
	const deriveLinearScalars =
		serializedFieldMode === "linear" ? linearField : null;
	const resolvedMaterialStrength = deriveLinearScalars
		? textureParticleLinearFieldExtent(deriveLinearScalars)
		: materialStrength;
	const resolvedMaterialAngle = deriveLinearScalars
		? textureParticleLinearFieldAngle(deriveLinearScalars)
		: typeof material.angle === "number" && Number.isFinite(material.angle)
			? normalizeDegrees(material.angle)
			: null;
	return {
		grain: {
			enabled: Boolean(
				grainDraft?.enabled ??
					(legacyGrain === undefined ? base.grain.enabled : strength > 0),
			),
			strength,
			size: clamp01(
				finiteNumber(grainDraft?.size, legacySize ?? base.grain.size),
			),
			character: oneOf(
				grainDraft?.character,
				TEXTURE_PARTICLE_CHARACTERS,
				base.grain.character,
			),
			densityCoupling: clamp01(
				finiteNumber(grainDraft?.densityCoupling, base.grain.densityCoupling),
			),
			temporalStability: clamp01(
				finiteNumber(
					grainDraft?.temporalStability,
					base.grain.temporalStability,
				),
			),
			seed: Math.trunc(
				clamp(finiteNumber(grainDraft?.seed, base.grain.seed), 0, 999999),
			),
			fusionMode: oneOf(
				grainDraft?.fusionMode,
				TEXTURE_GRAIN_FUSION_MODES,
				base.grain.fusionMode,
			),
			chroma: clamp01(finiteNumber(grainDraft?.chroma, base.grain.chroma)),
		},
		material: {
			mode: oneOf(material.mode, TEXTURE_MATERIAL_MODES, base.material.mode),
			...(blendMode ? { blendMode } : {}),
			...(overlayColor ? { overlayColor } : {}),
			strength: resolvedMaterialStrength,
			dyeShift: clamp(
				finiteNumber(material.dyeShift, base.material.dyeShift),
				-1,
				1,
			),
			particleContrast: clamp01(
				finiteNumber(material.particleContrast, base.material.particleContrast),
			),
			...(hasAuthoredFieldMode
				? { fieldMode }
				: hasFieldMeshDraft
					? { fieldMode: "mesh" as const }
					: hasLinearFieldDraft
						? { fieldMode: "linear" as const }
						: {}),
			...(fieldMode === "mesh" || hasFieldMeshDraft
				? {
						fieldMesh: normalizeTextureParticleFieldMesh(
							material.fieldMesh,
							base.material.fieldMesh ?? DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
						),
					}
				: {}),
			...(linearField ? { linearField } : {}),
			...(resolvedMaterialAngle !== null
				? { angle: resolvedMaterialAngle }
				: {}),
			...(alphaMatte ? { alphaMatte } : {}),
			...(reveal ? { reveal } : {}),
		},
	};
}

/**
 * Resolves how a texture's material actually composites, filling in the one
 * legacy signal available when `material.blendMode` was never authored: a
 * `"particle"`/`"mixed"` mode is the pre-reframe particle dissolve, so it
 * resolves to `"dissolve"` (keeping existing documents byte-identical); every
 * other mode resolves to `"overlay"` — the pre-reframe {@link grainPrimitives}
 * hardcoded `feBlend` mode, so existing non-particle grain documents also stay
 * byte-identical. Once `blendMode` is explicitly set it always wins,
 * independent of `mode`.
 */
export function effectiveTextureBlendMode(
	material: TextureRecipe["material"],
): TextureMaterialBlendMode {
	return (
		material.blendMode ??
		(material.mode === "particle" || material.mode === "mixed"
			? "dissolve"
			: "overlay")
	);
}

/**
 * Resolves the effective particle-dissolve density field while preserving legacy
 * documents where the presence of `material.angle` was the only linear signal.
 */
export function textureParticleFieldMode(
	texture: TextureRecipe,
): TextureParticleFieldMode {
	return (
		texture.material.fieldMode ??
		(texture.material.linearField ? "linear" : undefined) ??
		(typeof texture.material.angle === "number" ? "linear" : "contour")
	);
}

export function mergeTextureRecipeDraft(
	base: TextureRecipeDraft | undefined,
	override: TextureRecipeDraft | undefined,
): TextureRecipeDraft {
	const baseGrain = asRecord(base?.grain);
	const overrideGrain = asRecord(override?.grain);
	return {
		...base,
		...override,
		grain:
			overrideGrain || baseGrain
				? {
						...baseGrain,
						...overrideGrain,
					}
				: (override?.grain ?? base?.grain),
		material: {
			...base?.material,
			...override?.material,
		},
	};
}

export function normalizeGlowRecipe(draft: GlowRecipeDraft = {}): GlowRecipe {
	const base = NEUTRAL_GLOW_RECIPE;
	const bloomDraft = asRecord(draft.bloom);
	const legacyBloom =
		typeof draft.bloom === "number" ? finiteNumber(draft.bloom, 0) : undefined;
	const halation = draft.halation ?? {};
	const diffusion = draft.diffusion ?? {};
	const lightShafts = draft.lightShafts ?? {};
	return {
		bloom: {
			strength: clamp01(
				finiteNumber(bloomDraft?.strength, legacyBloom ?? base.bloom.strength),
			),
			threshold: clamp01(
				finiteNumber(bloomDraft?.threshold, base.bloom.threshold),
			),
			radius: clamp01(
				finiteNumber(
					bloomDraft?.radius,
					legacyScaled01(
						draft.radius,
						base.bloom.radius,
						LEGACY_GLOW_RADIUS_SCALE,
					),
				),
			),
			softKnee: clamp01(
				finiteNumber(bloomDraft?.softKnee, base.bloom.softKnee),
			),
			colorResponse: clamp01(
				finiteNumber(bloomDraft?.colorResponse, base.bloom.colorResponse),
			),
		},
		halation: {
			strength: clamp01(
				finiteNumber(halation.strength, base.halation.strength),
			),
			threshold: clamp01(
				finiteNumber(halation.threshold, base.halation.threshold),
			),
			radius: clamp01(finiteNumber(halation.radius, base.halation.radius)),
			hue: clamp(finiteNumber(halation.hue, base.halation.hue), 0, 360),
		},
		diffusion: {
			strength: clamp01(
				finiteNumber(diffusion.strength, base.diffusion.strength),
			),
			radius: clamp01(finiteNumber(diffusion.radius, base.diffusion.radius)),
		},
		lightShafts: {
			strength: clamp01(
				finiteNumber(lightShafts.strength, base.lightShafts.strength),
			),
			decay: clamp01(finiteNumber(lightShafts.decay, base.lightShafts.decay)),
			originX: clamp01(
				finiteNumber(lightShafts.originX, base.lightShafts.originX),
			),
			originY: clamp01(
				finiteNumber(lightShafts.originY, base.lightShafts.originY),
			),
		},
	};
}

export function mergeGlowRecipeDraft(
	base: GlowRecipeDraft | undefined,
	override: GlowRecipeDraft | undefined,
): GlowRecipeDraft {
	const baseBloom = asRecord(base?.bloom);
	const overrideBloom = asRecord(override?.bloom);
	return {
		...base,
		...override,
		bloom:
			overrideBloom || baseBloom
				? { ...baseBloom, ...overrideBloom }
				: (override?.bloom ?? base?.bloom),
		halation: { ...base?.halation, ...override?.halation },
		diffusion: { ...base?.diffusion, ...override?.diffusion },
		lightShafts: {
			...base?.lightShafts,
			...override?.lightShafts,
		},
	};
}

export function normalizeOpticsRecipe(
	draft: OpticsRecipeDraft = {},
): OpticsRecipe {
	const base = NEUTRAL_OPTICS_RECIPE;
	const crossFilter = draft.crossFilter ?? {};
	const haloPrism = draft.haloPrism ?? {};
	return {
		lensSoftness: clamp01(finiteNumber(draft.lensSoftness, base.lensSoftness)),
		vignette: clamp01(finiteNumber(draft.vignette, base.vignette)),
		chromaticFringing: clamp01(
			finiteNumber(
				draft.chromaticFringing,
				legacyScaled01(
					draft.chromaticAberration,
					base.chromaticFringing,
					LEGACY_RGB_SPLIT_SCALE,
				),
			),
		),
		rayAngleWeight: clamp01(
			finiteNumber(draft.rayAngleWeight, base.rayAngleWeight),
		),
		crossFilter: {
			strength: clamp01(
				finiteNumber(crossFilter.strength, base.crossFilter.strength),
			),
			points: Math.trunc(
				clamp(finiteNumber(crossFilter.points, base.crossFilter.points), 4, 12),
			),
			length: clamp01(
				finiteNumber(crossFilter.length, base.crossFilter.length),
			),
			angle: clamp(
				finiteNumber(crossFilter.angle, base.crossFilter.angle),
				0,
				360,
			),
		},
		haloPrism: {
			strength: clamp01(
				finiteNumber(haloPrism.strength, base.haloPrism.strength),
			),
			radius: clamp01(finiteNumber(haloPrism.radius, base.haloPrism.radius)),
			width: clamp01(finiteNumber(haloPrism.width, base.haloPrism.width)),
			chromatic: clamp01(
				finiteNumber(haloPrism.chromatic, base.haloPrism.chromatic),
			),
		},
	};
}

export function mergeOpticsRecipeDraft(
	base: OpticsRecipeDraft | undefined,
	override: OpticsRecipeDraft | undefined,
): OpticsRecipeDraft {
	return {
		...base,
		...override,
		crossFilter: {
			...base?.crossFilter,
			...override?.crossFilter,
		},
		haloPrism: {
			...base?.haloPrism,
			...override?.haloPrism,
		},
	};
}

export function normalizeMotionRecipe(
	draft: MotionRecipeDraft = {},
): MotionRecipe {
	const base = NEUTRAL_MOTION_RECIPE;
	return {
		fps: clamp(finiteNumber(draft.fps, base.fps), 1, 240),
		temporalSeedMode: oneOf(
			draft.temporalSeedMode,
			MOTION_TEMPORAL_SEED_MODES,
			base.temporalSeedMode,
		),
		shutterAngle: clamp(
			finiteNumber(draft.shutterAngle, base.shutterAngle),
			0,
			720,
		),
		breath: clamp01(finiteNumber(draft.breath, base.breath)),
		layerSeed:
			typeof draft.layerSeed === "string" ? draft.layerSeed : base.layerSeed,
	};
}

export function mergeMotionRecipeDraft(
	base: MotionRecipeDraft | undefined,
	override: MotionRecipeDraft | undefined,
): MotionRecipeDraft {
	return {
		...base,
		...override,
	};
}

export function normalizeShadowDrop(
	draft: ShadowRecipeDraft["drop"] | undefined,
	legacy: ShadowRecipeDraft = {},
): ShadowDropRecipe {
	const base = NEUTRAL_SHADOW_DROP;
	const value = draft ?? {};
	const opacity = finiteNumber(value.opacity, legacy.opacity ?? base.opacity);
	return {
		enabled: Boolean(
			value.enabled ??
				(legacy.opacity === undefined ? base.enabled : opacity > 0),
		),
		offsetX: clamp(
			finiteNumber(value.offsetX, legacy.offsetX ?? base.offsetX),
			-1,
			1,
		),
		offsetY: clamp(
			finiteNumber(value.offsetY, legacy.offsetY ?? base.offsetY),
			-1,
			1,
		),
		blur: clamp01(finiteNumber(value.blur, legacy.blur ?? base.blur)),
		color: hexOrDefault(value.color, base.color),
		opacity: clamp01(opacity),
		mode: oneOf(value.mode, SHADOW_DROP_MODES, base.mode),
	};
}

export function normalizeShadowInner(
	draft: ShadowRecipeDraft["inner"] | undefined,
): ShadowInnerRecipe {
	const base = NEUTRAL_SHADOW_INNER;
	const value = draft ?? {};
	return {
		enabled: Boolean(value.enabled ?? base.enabled),
		offsetX: clamp(finiteNumber(value.offsetX, base.offsetX), -1, 1),
		offsetY: clamp(finiteNumber(value.offsetY, base.offsetY), -1, 1),
		blur: clamp01(finiteNumber(value.blur, base.blur)),
		color: hexOrDefault(value.color, base.color),
		opacity: clamp01(finiteNumber(value.opacity, base.opacity)),
	};
}

export function normalizeShadowAmbient(
	draft: ShadowRecipeDraft["ambient"] | undefined,
): ShadowAmbientRecipe {
	const base = NEUTRAL_SHADOW_AMBIENT;
	const value = draft ?? {};
	return {
		enabled: Boolean(value.enabled ?? base.enabled),
		strength: clamp01(finiteNumber(value.strength, base.strength)),
		radius: clamp01(finiteNumber(value.radius, base.radius)),
	};
}

export function normalizeShadowRecipe(
	draft: ShadowRecipeDraft = {},
): ShadowRecipe {
	return {
		drop: normalizeShadowDrop(draft.drop, draft),
		inner: normalizeShadowInner(draft.inner),
		ambient: normalizeShadowAmbient(draft.ambient),
	};
}

export function mergeShadowRecipeDraft(
	base: ShadowRecipeDraft | undefined,
	override: ShadowRecipeDraft | undefined,
): ShadowRecipeDraft {
	return {
		...base,
		...override,
		drop: { ...base?.drop, ...override?.drop },
		inner: { ...base?.inner, ...override?.inner },
		ambient: { ...base?.ambient, ...override?.ambient },
	};
}

export function normalizeDistortionRecipe(
	draft: DistortionRecipeDraft = {},
): DistortionRecipe {
	const base = NEUTRAL_DISTORTION_RECIPE;
	const wave = draft.wave ?? {};
	const warp = draft.warp ?? {};
	const displacement = draft.displacement ?? {};
	const legacyAmount = draft.amount;
	return {
		wave: {
			enabled: Boolean(wave.enabled ?? base.wave.enabled),
			strength: clamp01(finiteNumber(wave.strength, base.wave.strength)),
			frequency: clamp(
				finiteNumber(wave.frequency, base.wave.frequency),
				0,
				32,
			),
			axis: oneOf(wave.axis, DISTORTION_AXES, base.wave.axis),
			phase: wrapAngle(wave.phase, base.wave.phase),
		},
		warp: {
			enabled: Boolean(warp.enabled ?? base.warp.enabled),
			strength: clamp01(finiteNumber(warp.strength, base.warp.strength)),
			kind: oneOf(warp.kind, DISTORTION_WARP_KINDS, base.warp.kind),
			centerX: clamp01(finiteNumber(warp.centerX, base.warp.centerX)),
			centerY: clamp01(finiteNumber(warp.centerY, base.warp.centerY)),
		},
		displacement: {
			enabled: Boolean(
				displacement.enabled ??
					(legacyAmount === undefined
						? base.displacement.enabled
						: legacyAmount > 0),
			),
			strength: clamp01(
				finiteNumber(
					displacement.strength,
					legacyAmount ?? base.displacement.strength,
				),
			),
			scale: clamp(
				finiteNumber(displacement.scale, base.displacement.scale),
				0.25,
				8,
			),
			seed: Math.floor(
				finiteNumber(displacement.seed, draft.seed ?? base.displacement.seed),
			),
		},
	};
}

export function mergeDistortionRecipeDraft(
	base: DistortionRecipeDraft | undefined,
	override: DistortionRecipeDraft | undefined,
): DistortionRecipeDraft {
	return {
		...base,
		...override,
		wave: { ...base?.wave, ...override?.wave },
		warp: { ...base?.warp, ...override?.warp },
		displacement: {
			...base?.displacement,
			...override?.displacement,
		},
	};
}

export function normalizeStylizationRecipe(
	draft: StylizationRecipeDraft = {},
): StylizationRecipe {
	const base = NEUTRAL_STYLIZATION_RECIPE;
	const posterize = asRecord(draft.posterize);
	const halftone = asRecord(draft.halftone);
	const legacyPosterize =
		typeof draft.posterize === "number"
			? finiteNumber(draft.posterize, 0)
			: undefined;
	const legacyHalftone =
		typeof draft.halftone === "number"
			? finiteNumber(draft.halftone, 0)
			: undefined;
	const dither = draft.dither ?? {};
	const contour = draft.contour ?? {};
	return {
		posterize: {
			enabled: Boolean(
				posterize?.enabled ??
					(legacyPosterize === undefined
						? base.posterize.enabled
						: legacyPosterize > 0),
			),
			levels: Math.floor(
				clamp(finiteNumber(posterize?.levels, base.posterize.levels), 2, 32),
			),
		},
		halftone: {
			enabled: Boolean(
				halftone?.enabled ??
					(legacyHalftone === undefined
						? base.halftone.enabled
						: legacyHalftone > 0),
			),
			cellSize: clamp(
				finiteNumber(halftone?.cellSize, base.halftone.cellSize),
				0.001,
				0.1,
			),
			angle: wrapAngle(halftone?.angle, base.halftone.angle),
			shape: oneOf(
				halftone?.shape,
				STYLIZATION_HALFTONE_SHAPES,
				base.halftone.shape,
			),
		},
		dither: {
			enabled: Boolean(dither.enabled ?? base.dither.enabled),
			pattern: oneOf(
				dither.pattern,
				STYLIZATION_DITHER_PATTERNS,
				base.dither.pattern,
			),
			strength: clamp01(finiteNumber(dither.strength, base.dither.strength)),
			cellSize: clamp(
				finiteNumber(dither.cellSize, base.dither.cellSize),
				1,
				32,
			),
			levels: Math.floor(
				clamp(finiteNumber(dither.levels, base.dither.levels), 2, 8) + 0.5,
			),
			mode: oneOf(dither.mode, STYLIZATION_DITHER_MODES, base.dither.mode),
			brightness: clamp(
				finiteNumber(dither.brightness, base.dither.brightness),
				-1,
				1,
			),
			gamma: clamp(finiteNumber(dither.gamma, base.dither.gamma), 0.25, 2.5),
			ink: hexOrDefault(dither.ink, base.dither.ink),
			paper: hexOrDefault(dither.paper, base.dither.paper),
		},
		contour: {
			enabled: Boolean(contour.enabled ?? base.contour.enabled),
			threshold: clamp01(
				finiteNumber(contour.threshold, base.contour.threshold),
			),
			thickness: clamp(
				finiteNumber(contour.thickness, base.contour.thickness),
				0,
				0.05,
			),
		},
	};
}

export function mergeStylizationRecipeDraft(
	base: StylizationRecipeDraft | undefined,
	override: StylizationRecipeDraft | undefined,
): StylizationRecipeDraft {
	const basePosterize = asRecord(base?.posterize);
	const overridePosterize = asRecord(override?.posterize);
	const baseHalftone = asRecord(base?.halftone);
	const overrideHalftone = asRecord(override?.halftone);
	return {
		...base,
		...override,
		posterize:
			overridePosterize || basePosterize
				? { ...basePosterize, ...overridePosterize }
				: (override?.posterize ?? base?.posterize),
		halftone:
			overrideHalftone || baseHalftone
				? { ...baseHalftone, ...overrideHalftone }
				: (override?.halftone ?? base?.halftone),
		dither: { ...base?.dither, ...override?.dither },
		contour: { ...base?.contour, ...override?.contour },
	};
}

/**
 * Returns a canonical, renderer-neutral visual recipe. It accepts both the
 * canonical vec-core v3 shape and VMA's older same-version scalar draft shape.
 */
export function normalizeVisualRecipe(
	draft: VisualRecipeDraft = {},
): VisualRecipe {
	const base = NEUTRAL_VISUAL_RECIPE;
	return {
		schemaVersion: VISUAL_RECIPE_SCHEMA_VERSION,
		id: stringOrDefault(draft.id, base.id),
		label: stringOrDefault(draft.label, base.label),
		intent: oneOf(draft.intent, VISUAL_INTENTS, base.intent),
		alphaMode: oneOf(draft.alphaMode, ALPHA_MODES, base.alphaMode),
		color: normalizeColorRecipe(draft.color),
		surface: normalizeSurfaceRecipe(draft.surface),
		texture: normalizeTextureRecipe(draft.texture),
		glow: normalizeGlowRecipe(draft.glow),
		optics: normalizeOpticsRecipe(draft.optics),
		motion: normalizeMotionRecipe(draft.motion),
		shadow: normalizeShadowRecipe(draft.shadow),
		distortion: normalizeDistortionRecipe(draft.distortion),
		stylization: normalizeStylizationRecipe(draft.stylization),
		metadata: {
			...base.metadata,
			...draft.metadata,
		},
	};
}

export function createVisualRecipe(
	draft: VisualRecipeDraft = {},
): VisualRecipe {
	return normalizeVisualRecipe(draft);
}

export function composeVisualRecipe(
	baseRecipe: VisualRecipeDraft,
	override: VisualRecipeDraft,
): VisualRecipe {
	return normalizeVisualRecipe({
		...baseRecipe,
		...override,
		color: mergeColorRecipeDraft(baseRecipe.color, override.color),
		surface: mergeSurfaceRecipeDraft(baseRecipe.surface, override.surface),
		texture: mergeTextureRecipeDraft(baseRecipe.texture, override.texture),
		glow: mergeGlowRecipeDraft(baseRecipe.glow, override.glow),
		optics: mergeOpticsRecipeDraft(baseRecipe.optics, override.optics),
		motion: mergeMotionRecipeDraft(baseRecipe.motion, override.motion),
		shadow: mergeShadowRecipeDraft(baseRecipe.shadow, override.shadow),
		distortion: mergeDistortionRecipeDraft(
			baseRecipe.distortion,
			override.distortion,
		),
		stylization: mergeStylizationRecipeDraft(
			baseRecipe.stylization,
			override.stylization,
		),
		metadata: {
			...baseRecipe.metadata,
			...override.metadata,
		},
	});
}

/**
 * Legacy scalar read for current VMA controls and SVG approximation code.
 * New authoring streams should write canonical `texture.grain.strength`.
 */
export function legacyTextureGrainValue(texture: TextureRecipe): number {
	return texture.grain.enabled ? texture.grain.strength : 0;
}

/**
 * Legacy scalar read for VMA's grain scale control. Canonical vec-core stores
 * this as normalized `texture.grain.size`.
 */
export function legacyTextureNoiseScaleValue(texture: TextureRecipe): number {
	return texture.grain.size / LEGACY_NOISE_SCALE_TO_GRAIN_SIZE;
}

export function legacyTextureNoiseScaleToGrainSize(value: number): number {
	return clamp01(value * LEGACY_NOISE_SCALE_TO_GRAIN_SIZE);
}

export function legacyGlowBloomValue(glow: GlowRecipe): number {
	return glow.bloom.strength;
}

export function legacyGlowRadiusValue(glow: GlowRecipe): number {
	return glow.bloom.radius * LEGACY_GLOW_RADIUS_SCALE;
}

export function legacyGlowRadiusToCanonical(value: number): number {
	return clamp01(value / LEGACY_GLOW_RADIUS_SCALE);
}

export function legacyRgbSplitValue(optics: OpticsRecipe): number {
	return optics.chromaticFringing * LEGACY_RGB_SPLIT_SCALE;
}

export function legacyRgbSplitToCanonical(value: number): number {
	return clamp01(value / LEGACY_RGB_SPLIT_SCALE);
}

export const DEFAULT_CHROMATIC_ABERRATION_MAX_SHIFT_PX = 6;
export const VECMO_CHROMATIC_ABERRATION_MAX_SHIFT_METADATA_KEY =
	"vecmo.chromaticAberration.maxShiftPx" as const;

export const VECMO_FILM_GRAIN_SEED_NAMESPACE_METADATA_KEY =
	"vecmo.filmGrain.seedNamespace" as const;
export const VECMO_FILM_GRAIN_OBJECT_WEIGHT_METADATA_KEY =
	"vecmo.filmGrain.objectWeight" as const;
export const VECMO_FILM_GRAIN_BACKGROUND_WEIGHT_METADATA_KEY =
	"vecmo.filmGrain.backgroundWeight" as const;

export const DEFAULT_FILM_GRAIN_TEXTURE_HEIGHT = 960;
export const DEFAULT_FILM_GRAIN_OVERLAY_ALPHA_GAIN = 0.35;
export const DEFAULT_FILM_GRAIN_OBJECT_WEIGHT = 1;
export const DEFAULT_FILM_GRAIN_BACKGROUND_WEIGHT = 1;

export type FilmGrainParams = {
	readonly strength: number;
	readonly seed: number;
	readonly seedNamespace: string;
	readonly objectWeight: number;
	readonly backgroundWeight: number;
};

function xmur3(str: string): () => number {
	let h = 1779033703 ^ str.length;
	for (let i = 0; i < str.length; i += 1) {
		h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return () => {
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return h >>> 0;
	};
}

function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Generates the same signed grain field used by vec-core's SVG/WebGPU bridge.
 * Callers provide the temporal seed so animated previews can reseed per frame
 * instead of behaving like a fixed dirty-lens texture.
 */
export function grainSampleField(
	temporalSeed: string,
	width: number,
	height: number,
	strength: number,
): Float32Array {
	const n = Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height));
	const out = new Float32Array(n);
	if (strength <= 0 || n === 0) return out;

	const rand = mulberry32(xmur3(temporalSeed)());
	for (let i = 0; i < n; i += 1) {
		out[i] = (rand() * 2 - 1) * strength;
	}
	return out;
}

/**
 * Encodes a signed grain field as black/white alpha overlay pixels. This keeps
 * the editor preview on the same source-derived representation as the reference
 * `motion-grammar-lab` finish pass.
 */
export function encodeGrainOverlayRgba(
	field: Float32Array,
	alphaGain = DEFAULT_FILM_GRAIN_OVERLAY_ALPHA_GAIN,
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(field.length * 4);
	const gain = Math.max(0, alphaGain);

	for (let i = 0; i < field.length; i += 1) {
		const v = field[i] ?? 0;
		const alpha = Math.min(255, Math.round(Math.abs(v) * gain * 255));
		const channel = v >= 0 ? 255 : 0;
		const idx = i * 4;
		data[idx] = channel;
		data[idx + 1] = channel;
		data[idx + 2] = channel;
		data[idx + 3] = alpha;
	}

	return data;
}

const metadataNumber = (
	metadata: RecipeMetadata,
	key: string,
	fallback: number,
): number => {
	const value = metadata[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

/**
 * Extracts frame-level film grain parameters from a visual recipe. Grain is a
 * post-composite finish in the reference pipeline, so renderers should apply
 * this to an artboard/frame surface rather than to individual nodes.
 */
export function computeFilmGrain(recipe: VisualRecipe): FilmGrainParams | null {
	const grain = recipe.texture.grain;
	if (!grain.enabled || grain.strength <= 0) return null;
	const seedNamespaceValue =
		recipe.metadata[VECMO_FILM_GRAIN_SEED_NAMESPACE_METADATA_KEY];
	return {
		strength: grain.strength,
		seed: grain.seed,
		seedNamespace:
			typeof seedNamespaceValue === "string" && seedNamespaceValue.length > 0
				? seedNamespaceValue
				: (recipe.id ?? "grain"),
		objectWeight: clamp01(
			metadataNumber(
				recipe.metadata,
				VECMO_FILM_GRAIN_OBJECT_WEIGHT_METADATA_KEY,
				DEFAULT_FILM_GRAIN_OBJECT_WEIGHT,
			),
		),
		backgroundWeight: clamp01(
			metadataNumber(
				recipe.metadata,
				VECMO_FILM_GRAIN_BACKGROUND_WEIGHT_METADATA_KEY,
				DEFAULT_FILM_GRAIN_BACKGROUND_WEIGHT,
			),
		),
	};
}

export type ChromaticAberrationFocus = {
	readonly cx: number;
	readonly cy: number;
	readonly radiusPx: number;
};

export type ChromaticAberrationParams = {
	readonly fringing: number;
	readonly maxShiftPx: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly focus?: ChromaticAberrationFocus;
};

/**
 * Extracts the vec-core radial chromatic-aberration parameters from a recipe.
 * This mirrors `@bridges/svg-webgpu`: neutral or negative fringing returns null
 * so renderers can skip the pass, while the optical centre defaults to frame
 * centre in normalized coordinates.
 */
export function computeChromaticAberration(
	recipe: VisualRecipe,
	maxShiftPx: number = DEFAULT_CHROMATIC_ABERRATION_MAX_SHIFT_PX,
	center?: { readonly x?: number; readonly y?: number },
): ChromaticAberrationParams | null {
	const fringing = recipe.optics.chromaticFringing;
	if (!(fringing > 0)) return null;
	return {
		fringing: clamp01(fringing),
		maxShiftPx: Math.max(0, maxShiftPx),
		centerX: clamp01(center?.x ?? 0.5),
		centerY: clamp01(center?.y ?? 0.5),
	};
}

const sampleChromaticAberrationChannel = (
	source: ArrayLike<number>,
	width: number,
	height: number,
	fx: number,
	fy: number,
	channel: number,
): number => {
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const cx0 = x0 < 0 ? 0 : x0 >= width ? width - 1 : x0;
	const cy0 = y0 < 0 ? 0 : y0 >= height ? height - 1 : y0;
	const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= width ? width - 1 : x0 + 1;
	const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= height ? height - 1 : y0 + 1;
	const p00 = source[(cy0 * width + cx0) * 4 + channel] as number;
	const p10 = source[(cy0 * width + cx1) * 4 + channel] as number;
	const p01 = source[(cy1 * width + cx0) * 4 + channel] as number;
	const p11 = source[(cy1 * width + cx1) * 4 + channel] as number;
	const top = p00 + (p10 - p00) * tx;
	const bottom = p01 + (p11 - p01) * tx;
	return top + (bottom - top) * ty;
};

/**
 * Applies vec-core radial lateral chromatic aberration to an RGBA buffer.
 * R is sampled inward from the optical centre, B outward, and G/alpha stay at
 * the source position. The source buffer is never mutated.
 */
export function applyChromaticAberration(
	source: ArrayLike<number>,
	width: number,
	height: number,
	params: ChromaticAberrationParams,
): Uint8ClampedArray {
	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));
	if (source.length < w * h * 4) {
		throw new Error(
			"applyChromaticAberration: source data is shorter than width * height * 4",
		);
	}
	const out = new Uint8ClampedArray(w * h * 4);
	const focus = params.focus;
	const cx = focus ? focus.cx : params.centerX * (w - 1);
	const cy = focus ? focus.cy : params.centerY * (h - 1);
	const refDist = focus
		? Math.max(1, focus.radiusPx)
		: Math.sqrt(cx * cx + cy * cy) || 1;
	const peak = params.fringing * params.maxShiftPx;

	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const idx = (y * w + x) * 4;
			const dx = x - cx;
			const dy = y - cy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const shift = focus
				? peak * Math.min(1, dist / refDist)
				: peak * (dist / refDist);
			const ux = dist > 1e-6 ? dx / dist : 0;
			const uy = dist > 1e-6 ? dy / dist : 0;
			out[idx] = sampleChromaticAberrationChannel(
				source,
				w,
				h,
				x - ux * shift,
				y - uy * shift,
				0,
			);
			out[idx + 1] = source[idx + 1] as number;
			out[idx + 2] = sampleChromaticAberrationChannel(
				source,
				w,
				h,
				x + ux * shift,
				y + uy * shift,
				2,
			);
			out[idx + 3] = source[idx + 3] as number;
		}
	}
	return out;
}

export function normalizeEffectTargetRef(
	draft: EffectTargetRefDraft | undefined,
): EffectTargetRef {
	const scope = oneOf(
		draft?.scope,
		EFFECT_TARGET_SCOPES,
		NEUTRAL_EFFECT_TARGET_REF.scope,
	);
	if (scope === "scene" || scope === "selection") {
		return { scope };
	}
	const id = optionalString(draft?.id);
	return id ? { scope, id } : { scope };
}

export function normalizeEffectSlotRef(
	draft: EffectSlotRefDraft | undefined,
): EffectSlotRef {
	const id = stringOrDefault(draft?.id, NEUTRAL_EFFECT_SLOT_REF.id);
	const path = stringOrDefault(
		draft?.path,
		optionalString(draft?.id) ? id : NEUTRAL_EFFECT_SLOT_REF.path,
	);
	const label = optionalString(draft?.label);
	return label ? { id, path, label } : { id, path };
}

const normalizeGradientStops = (
	stops: readonly Partial<EffectMaskGradientStop>[] | undefined,
): readonly EffectMaskGradientStop[] => {
	const source = stops && stops.length > 0 ? stops : DEFAULT_GRADIENT_STOPS;
	return source
		.map((stop) => ({
			offset: clamp01(finiteNumber(stop.offset, 0)),
			alpha: clamp01(finiteNumber(stop.alpha, 1)),
		}))
		.sort((a, b) => a.offset - b.offset);
};

const normalizePoint = (point: Partial<EffectMaskPoint>): EffectMaskPoint => ({
	x: finiteNumber(point.x, 0),
	y: finiteNumber(point.y, 0),
});

/**
 * Canonicalizes mask source data, including upstream `stack` sources. Missing
 * input keeps the legacy neutral full-frame default, while malformed or unknown
 * authored sources remain inert `unsupported` payloads rather than expanding an
 * accidentally invalid local mask to the full target.
 */
export function normalizeEffectMaskSource(
	draft: EffectMaskSourceDraft | undefined,
): EffectMaskSource {
	if (!draft || typeof draft !== "object") {
		return NEUTRAL_EFFECT_MASK_FULL_FRAME_SOURCE;
	}
	const space = oneOf(
		draft.space,
		EFFECT_MASK_SPACES,
		NEUTRAL_EFFECT_MASK_FULL_FRAME_SOURCE.space,
	);

	switch (draft.kind) {
		case "fullFrame":
			return { kind: "fullFrame", space };
		case "rect":
			return {
				kind: "rect",
				space,
				x: finiteNumber(draft.x, 0),
				y: finiteNumber(draft.y, 0),
				width: clamp(finiteNumber(draft.width, 1), 0, 1_000_000),
				height: clamp(finiteNumber(draft.height, 1), 0, 1_000_000),
				cornerRadius: clamp(finiteNumber(draft.cornerRadius, 0), 0, 1_000_000),
				rotation: wrapAngle(draft.rotation, 0),
			};
		case "ellipse":
			return {
				kind: "ellipse",
				space,
				cx: finiteNumber(draft.cx, 0.5),
				cy: finiteNumber(draft.cy, 0.5),
				rx: clamp(finiteNumber(draft.rx, 0.5), 0, 1_000_000),
				ry: clamp(finiteNumber(draft.ry, 0.5), 0, 1_000_000),
				rotation: wrapAngle(draft.rotation, 0),
			};
		case "polygon": {
			const points = (draft.points ?? [])
				.map((point) => normalizePoint(point))
				.filter(
					(point) => Number.isFinite(point.x) && Number.isFinite(point.y),
				);
			return points.length >= 3
				? { kind: "polygon", space, points }
				: {
						kind: "unsupported",
						space,
						sourceKind: "polygon",
						payload: asRecord(draft) ?? {},
					};
		}
		case "linearGradient":
			return {
				kind: "linearGradient",
				space,
				x1: finiteNumber(draft.x1, 0),
				y1: finiteNumber(draft.y1, 0),
				x2: finiteNumber(draft.x2, 1),
				y2: finiteNumber(draft.y2, 0),
				stops: normalizeGradientStops(draft.stops),
			};
		case "radialGradient": {
			const radius = clamp(finiteNumber(draft.radius, 0.5), 0, 1_000_000);
			return {
				kind: "radialGradient",
				space,
				cx: finiteNumber(draft.cx, 0.5),
				cy: finiteNumber(draft.cy, 0.5),
				radius,
				rx: clamp(finiteNumber(draft.rx, radius), 0, 1_000_000),
				ry: clamp(finiteNumber(draft.ry, radius), 0, 1_000_000),
				rotation: wrapAngle(draft.rotation, 0),
				stops: normalizeGradientStops(draft.stops),
			};
		}
		case "contourGradient":
			return {
				kind: "contourGradient",
				space,
				width: clamp(
					finiteNumber(draft.width, 0.2),
					0.001,
					space === "scene" ? 1_000_000 : 1,
				),
				side: oneOf(draft.side, EFFECT_MASK_CONTOUR_SIDES, "inside"),
			};
		case "fieldMesh":
			return {
				kind: "fieldMesh",
				space,
				fieldMesh: normalizeScalarEffectFieldMesh(
					draft.fieldMesh,
					NEUTRAL_EFFECT_FIELD_MESH,
					{ defaultValue: 1 },
				),
			};
		case "svgMatte": {
			const refId = optionalString(draft.refId);
			return refId
				? {
						kind: "svgMatte",
						space,
						refId,
						alphaMode: oneOf(draft.alphaMode, EFFECT_MASK_ALPHA_MODES, "alpha"),
					}
				: {
						kind: "unsupported",
						space,
						sourceKind: "svgMatte",
						payload: asRecord(draft) ?? {},
					};
		}
		case "proceduralNoise":
			return {
				kind: "proceduralNoise",
				space,
				seed: Math.trunc(clamp(finiteNumber(draft.seed, 0), 0, 999_999_999)),
				scale: clamp(finiteNumber(draft.scale, 1), 0.001, 4096),
				contrast: clamp(finiteNumber(draft.contrast, 1), 0, 16),
				bias: clamp(finiteNumber(draft.bias, 0), -1, 1),
			};
		case "stack":
			return {
				kind: "stack",
				space,
				items: (draft.items ?? []).map((item, index) =>
					normalizeEffectMaskStackItem(item, index),
				),
			};
		case "unsupported":
			return {
				kind: "unsupported",
				space,
				sourceKind: stringOrDefault(draft.sourceKind, "unknown"),
				payload: asRecord(draft.payload) ?? {},
			};
		default: {
			const payload = asRecord(draft) ?? {};
			return {
				kind: "unsupported",
				space,
				sourceKind: stringOrDefault(payload.kind, "unknown"),
				payload,
			};
		}
	}
}

/**
 * Canonicalizes the material-local transparent matte used by Particle Dissolve.
 * This intentionally accepts only gradient mattes for now; other mask sources
 * need target bounds or external matte texture plumbing before GPU lowering can
 * render them faithfully.
 */
export function normalizeTextureMaterialAlphaMatte(
	draft: TextureMaterialAlphaMatteSourceDraft | undefined,
): TextureMaterialAlphaMatteSource | undefined {
	if (!draft || typeof draft !== "object") return undefined;
	if (draft.kind === "contourGradient") {
		return {
			kind: "contourGradient",
			space: oneOf(
				draft.space,
				EFFECT_MASK_SPACES,
				NEUTRAL_EFFECT_MASK_FULL_FRAME_SOURCE.space,
			),
			width: clamp(finiteNumber(draft.width, 0.34), 0.01, 1),
			invert: Boolean(draft.invert ?? false),
			stops: normalizeGradientStops(draft.stops),
		};
	}
	if (draft.kind !== "linearGradient" && draft.kind !== "radialGradient") {
		return undefined;
	}
	const source = normalizeEffectMaskSource(draft);
	return source.kind === "linearGradient" || source.kind === "radialGradient"
		? source
		: undefined;
}

/**
 * Canonicalizes an authored noise-wipe reveal. Validate-or-omit like
 * {@link normalizeTextureMaterialAlphaMatte}: an absent draft stays absent
 * (never synthesized), so documents that never authored a reveal keep
 * serializing byte-identically.
 */
export function normalizeTextureMaterialReveal(
	draft: DeepPartialObject<TextureMaterialReveal> | undefined,
): TextureMaterialReveal | undefined {
	if (!draft || typeof draft !== "object") return undefined;
	return {
		progress: clamp01(finiteNumber(draft.progress, 0)),
		softness: clamp01(finiteNumber(draft.softness, 0)),
		noiseWeight: clamp01(finiteNumber(draft.noiseWeight, 0)),
		mode: oneOf(draft.mode, TEXTURE_MATERIAL_REVEAL_MODES, "in"),
	};
}

export function normalizeEffectInfluenceFalloff(
	draft: EffectInfluenceFalloffDraft | undefined,
): EffectInfluenceFalloff {
	const base = NEUTRAL_EFFECT_INFLUENCE_FALLOFF;
	const inputMin = clamp01(finiteNumber(draft?.inputMin, base.inputMin));
	const inputMax = clamp01(finiteNumber(draft?.inputMax, base.inputMax));
	return {
		kind: oneOf(draft?.kind, EFFECT_INFLUENCE_FALLOFF_KINDS, base.kind),
		inputMin: Math.min(inputMin, inputMax),
		inputMax: Math.max(inputMin, inputMax),
		gamma: clamp(finiteNumber(draft?.gamma, base.gamma), 0.01, 16),
		softness: clamp01(finiteNumber(draft?.softness, base.softness)),
	};
}

export function normalizeEffectInfluence(
	draft: EffectInfluenceDraft | undefined,
): EffectInfluence {
	const base = NEUTRAL_EFFECT_INFLUENCE;
	return {
		enabled: Boolean(draft?.enabled ?? base.enabled),
		source: normalizeEffectMaskSource(draft?.source),
		strength: clamp01(finiteNumber(draft?.strength, base.strength)),
		invert: Boolean(draft?.invert ?? base.invert),
		featherRadius: clamp01(
			finiteNumber(draft?.featherRadius, base.featherRadius),
		),
		falloff: normalizeEffectInfluenceFalloff(draft?.falloff),
	};
}

export function normalizeEffectMaskStackItem(
	draft: EffectMaskStackItemDraft | undefined,
	index = 0,
): EffectMaskStackItem {
	const influence = normalizeEffectInfluence(draft);
	return {
		...influence,
		id: stringOrDefault(draft?.id, `mask-${index + 1}`),
		label: stringOrDefault(draft?.label, `Mask ${index + 1}`),
		combineMode: oneOf(
			draft?.combineMode,
			EFFECT_MASK_COMBINE_MODES,
			index === 0 ? "replace" : "intersect",
		),
	};
}

export function normalizeEffectInfluenceAssignment(
	draft: EffectInfluenceAssignmentDraft | undefined,
	index = 0,
): EffectInfluenceAssignment {
	const fieldId = optionalString(draft?.fieldId);
	return {
		id: stringOrDefault(draft?.id, `influence-${index + 1}`),
		label: stringOrDefault(draft?.label, `Influence ${index + 1}`),
		target: normalizeEffectTargetRef(draft?.target),
		effect: normalizeEffectSlotRef(draft?.effect),
		influence: normalizeEffectInfluence(draft?.influence),
		...(fieldId ? { fieldId } : {}),
	};
}

/** Canonicalizes one reusable field while retaining unknown sources inertly. */
export function normalizeEffectFieldDefinition(
	draft: EffectFieldDefinitionDraft | undefined,
	index = 0,
): EffectFieldDefinition {
	return {
		id: stringOrDefault(draft?.id, `field-${index + 1}`),
		label: stringOrDefault(draft?.label, `Field ${index + 1}`),
		source: normalizeEffectMaskSource(
			draft?.source as EffectMaskSourceDraft | undefined,
		),
	};
}

/**
 * Canonicalizes the standalone influence recipe and normalizes assignment
 * internals recursively, including nested mask stack items.
 */
export function normalizeEffectInfluenceRecipe(
	draft: EffectInfluenceRecipeDraft = {},
): EffectInfluenceRecipe {
	const fields = draft.fields?.map((field, index) =>
		normalizeEffectFieldDefinition(field, index),
	);
	return {
		enabled: Boolean(draft.enabled ?? NEUTRAL_EFFECT_INFLUENCE_RECIPE.enabled),
		assignments: (draft.assignments ?? []).map((assignment, index) =>
			normalizeEffectInfluenceAssignment(assignment, index),
		),
		...(fields && fields.length > 0 ? { fields } : {}),
	};
}

export function mergeEffectInfluenceDraft(
	base: EffectInfluenceDraft | undefined,
	override: EffectInfluenceDraft | undefined,
): EffectInfluenceDraft {
	return {
		...base,
		...override,
		source: override?.source ?? base?.source,
		falloff: {
			...base?.falloff,
			...override?.falloff,
		},
	};
}

export function mergeEffectInfluenceRecipeDraft(
	base: EffectInfluenceRecipeDraft | undefined,
	override: EffectInfluenceRecipeDraft | undefined,
): EffectInfluenceRecipeDraft {
	return {
		enabled: override?.enabled ?? base?.enabled,
		assignments: override?.assignments ?? base?.assignments ?? [],
		fields: override?.fields ?? base?.fields,
	};
}

const clampIndex = (index: number, length: number): number =>
	Number.isFinite(index)
		? Math.max(0, Math.min(length, Math.trunc(index)))
		: length;

const insertAt = <T>(
	items: readonly T[],
	item: T,
	index: number,
): readonly T[] => {
	const next = items.slice();
	next.splice(clampIndex(index, next.length), 0, item);
	return next;
};

const moveItem = <T>(
	items: readonly T[],
	fromIndex: number,
	toIndex: number,
): readonly T[] => {
	if (fromIndex < 0 || fromIndex >= items.length) return items;
	const next = items.slice();
	const [item] = next.splice(fromIndex, 1);
	if (item === undefined) return items;
	next.splice(clampIndex(toIndex, next.length), 0, item);
	return next;
};

export function createEffectInfluenceAssignment(
	draft: EffectInfluenceAssignmentDraft,
): EffectInfluenceAssignment {
	return normalizeEffectInfluenceAssignment(draft);
}

/** Builds one normalized reusable Effect Field definition. */
export function createEffectFieldDefinition(
	draft: EffectFieldDefinitionDraft,
): EffectFieldDefinition {
	return normalizeEffectFieldDefinition(draft);
}

/**
 * Adds or replaces one uniquely-addressed field. Ambiguous duplicate ids are a
 * no-op; the routing compiler reports them instead of selecting a winner.
 */
export function upsertEffectFieldDefinition(
	recipe: EffectInfluenceRecipeDraft | undefined,
	field: EffectFieldDefinitionDraft,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const nextField = normalizeEffectFieldDefinition(
		field,
		normalized.fields?.length ?? 0,
	);
	const matches = (normalized.fields ?? []).filter(
		(candidate) => candidate.id === nextField.id,
	);
	if (matches.length > 1) return normalized;
	const fields =
		matches.length === 1
			? (normalized.fields ?? []).map((candidate) =>
					candidate.id === nextField.id ? nextField : candidate,
				)
			: [...(normalized.fields ?? []), nextField];
	return { ...normalized, fields };
}

/**
 * Links one unique assignment to one unique field and refreshes its inline
 * source snapshot in the same value operation.
 */
export function linkEffectInfluenceAssignmentField(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	fieldId: string,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const assignments = normalized.assignments.filter(
		(assignment) => assignment.id === assignmentId,
	);
	const fields = (normalized.fields ?? []).filter(
		(field) => field.id === fieldId,
	);
	const [resolvedField] = fields;
	if (assignments.length !== 1 || fields.length !== 1 || !resolvedField) {
		return normalized;
	}
	const source = resolvedField.source;
	return {
		...normalized,
		assignments: normalized.assignments.map((assignment) =>
			assignment.id === assignmentId
				? normalizeEffectInfluenceAssignment({
						...assignment,
						fieldId,
						influence: { ...assignment.influence, source },
					})
				: assignment,
		),
	};
}

/** Clears a field link while retaining the assignment's last valid inline source. */
export function unlinkEffectInfluenceAssignmentField(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const matches = normalized.assignments.filter(
		(assignment) => assignment.id === assignmentId,
	);
	if (matches.length !== 1 || !matches[0]?.fieldId) return normalized;
	return {
		...normalized,
		assignments: normalized.assignments.map((assignment) => {
			if (assignment.id !== assignmentId) return assignment;
			return {
				id: assignment.id,
				label: assignment.label,
				target: assignment.target,
				effect: assignment.effect,
				influence: assignment.influence,
			};
		}),
	};
}

/**
 * Replaces a unique field source and refreshes every linked fallback snapshot
 * atomically. Duplicate field ids remain unchanged and are rejected at compile.
 */
export function replaceEffectFieldSource(
	recipe: EffectInfluenceRecipeDraft,
	fieldId: string,
	source: EffectMaskSourceDraft,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const matches = (normalized.fields ?? []).filter(
		(field) => field.id === fieldId,
	);
	if (matches.length !== 1) return normalized;
	const nextSource = normalizeEffectMaskSource(source);
	return {
		...normalized,
		fields: (normalized.fields ?? []).map((field) =>
			field.id === fieldId ? { ...field, source: nextSource } : field,
		),
		assignments: normalized.assignments.map((assignment) =>
			assignment.fieldId === fieldId
				? {
						...assignment,
						influence: { ...assignment.influence, source: nextSource },
					}
				: assignment,
		),
	};
}

/**
 * Removes one unique field and unlinks its assignments without discarding their
 * inline fallback snapshots.
 */
export function removeEffectFieldDefinition(
	recipe: EffectInfluenceRecipeDraft,
	fieldId: string,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const matches = (normalized.fields ?? []).filter(
		(field) => field.id === fieldId,
	);
	if (matches.length !== 1) return normalized;
	const fields = (normalized.fields ?? []).filter(
		(field) => field.id !== fieldId,
	);
	return {
		enabled: normalized.enabled,
		...(fields.length > 0 ? { fields } : {}),
		assignments: normalized.assignments.map((assignment) => {
			if (assignment.fieldId !== fieldId) return assignment;
			return {
				id: assignment.id,
				label: assignment.label,
				target: assignment.target,
				effect: assignment.effect,
				influence: assignment.influence,
			};
		}),
	};
}

export function attachEffectInfluenceAssignment(
	recipe: EffectInfluenceRecipeDraft | undefined,
	assignment: EffectInfluenceAssignmentDraft,
	index = Number.POSITIVE_INFINITY,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const nextAssignment = normalizeEffectInfluenceAssignment(
		assignment,
		normalized.assignments.length,
	);
	return {
		...normalized,
		enabled: true,
		assignments: insertAt(normalized.assignments, nextAssignment, index),
	};
}

export function retargetEffectInfluenceAssignment(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	target: EffectTargetRefDraft,
	effect?: EffectSlotRefDraft,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	return {
		...normalized,
		assignments: normalized.assignments.map((assignment) =>
			assignment.id === assignmentId
				? normalizeEffectInfluenceAssignment({
						...assignment,
						target,
						effect: effect ?? assignment.effect,
						influence: assignment.influence,
					})
				: assignment,
		),
	};
}

export function reorderEffectInfluenceAssignments(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	toIndex: number,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const fromIndex = normalized.assignments.findIndex(
		(assignment) => assignment.id === assignmentId,
	);
	return {
		...normalized,
		assignments: moveItem(normalized.assignments, fromIndex, toIndex),
	};
}

export function replaceEffectInfluence(
	assignment: EffectInfluenceAssignmentDraft,
	influence: EffectInfluenceDraft,
): EffectInfluenceAssignment {
	return normalizeEffectInfluenceAssignment({
		...assignment,
		influence,
	});
}

export function appendMaskStackItem(
	influence: EffectInfluenceDraft | undefined,
	item: EffectMaskStackItemDraft,
	index = Number.POSITIVE_INFINITY,
): EffectInfluence {
	const normalized = normalizeEffectInfluence(influence);
	const existing =
		normalized.source.kind === "stack"
			? normalized.source.items
			: influence?.source
				? [
						{
							...normalized,
							id: "base-mask",
							label: "Base mask",
							combineMode: "replace" as const,
						},
					]
				: [];
	const nextItem = normalizeEffectMaskStackItem(item, existing.length);
	return {
		...normalized,
		source: {
			kind: "stack",
			space: normalized.source.space,
			items: insertAt(existing, nextItem, index),
		},
	};
}

export function reorderMaskStackItem(
	influence: EffectInfluenceDraft,
	itemId: string,
	toIndex: number,
): EffectInfluence {
	const normalized = normalizeEffectInfluence(influence);
	if (normalized.source.kind !== "stack") return normalized;
	const fromIndex = normalized.source.items.findIndex(
		(item) => item.id === itemId,
	);
	return {
		...normalized,
		source: {
			...normalized.source,
			items: moveItem(normalized.source.items, fromIndex, toIndex),
		},
	};
}

export function replaceMaskStackItem(
	influence: EffectInfluenceDraft,
	itemId: string,
	patch: EffectMaskStackItemDraft,
): EffectInfluence {
	const normalized = normalizeEffectInfluence(influence);
	if (normalized.source.kind !== "stack") return normalized;
	return {
		...normalized,
		source: {
			...normalized.source,
			items: normalized.source.items.map((item) =>
				item.id === itemId
					? normalizeEffectMaskStackItem(
							{
								...item,
								...patch,
								source: patch.source ?? item.source,
								falloff: {
									...item.falloff,
									...patch.falloff,
								},
							},
							0,
						)
					: item,
			),
		},
	};
}

export function removeMaskStackItem(
	influence: EffectInfluenceDraft,
	itemId: string,
): EffectInfluence {
	const normalized = normalizeEffectInfluence(influence);
	if (normalized.source.kind !== "stack") return normalized;
	return {
		...normalized,
		source: {
			...normalized.source,
			items: normalized.source.items.filter((item) => item.id !== itemId),
		},
	};
}

export function isMaskStackItem(value: unknown): value is EffectMaskStackItem {
	return (
		isObjectRecord(value) &&
		"id" in value &&
		"source" in value &&
		"combineMode" in value
	);
}

export function attachMaskToEffect(
	recipe: EffectInfluenceRecipeDraft | undefined,
	assignment: EffectInfluenceAssignmentDraft,
	index = Number.POSITIVE_INFINITY,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const nextAssignment = normalizeEffectInfluenceAssignment(
		assignment,
		normalized.assignments.length,
	);
	const existingIndex = normalized.assignments.findIndex(
		(candidate) => candidate.id === nextAssignment.id,
	);
	if (existingIndex >= 0) {
		return {
			...normalized,
			enabled: true,
			assignments: normalized.assignments.map((candidate, candidateIndex) =>
				candidateIndex === existingIndex ? nextAssignment : candidate,
			),
		};
	}
	return {
		...normalized,
		enabled: true,
		assignments: insertAt(normalized.assignments, nextAssignment, index),
	};
}

export function moveMaskToTarget(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	target: EffectTargetRefDraft,
	effect?: EffectSlotRefDraft,
): EffectInfluenceRecipe {
	return retargetEffectInfluenceAssignment(
		recipe,
		assignmentId,
		target,
		effect,
	);
}

export function reorderMaskStack(
	influence: EffectInfluenceDraft,
	itemId: string,
	toIndex: number,
): EffectInfluence {
	return reorderMaskStackItem(influence, itemId, toIndex);
}

export type MaskGradientSourceDraft =
	| EffectMaskLinearGradientSourceDraft
	| EffectMaskRadialGradientSourceDraft;

export function setMaskGradient(
	influence: EffectInfluenceDraft,
	itemId: string,
	source: MaskGradientSourceDraft,
): EffectInfluence {
	return replaceMaskStackItem(influence, itemId, { source });
}

const normalizeAutomationKeyframes = (
	keyframes: readonly AutomationKeyframe[],
): readonly AutomationKeyframe[] =>
	[...keyframes]
		.filter(
			(keyframe) =>
				Number.isFinite(keyframe.frame) && Number.isFinite(keyframe.value),
		)
		.map((keyframe) => ({
			frame: Math.floor(keyframe.frame),
			value: keyframe.value,
			...(oneOf(keyframe.easing, AUTOMATION_EASINGS, "linear") === "linear" &&
			keyframe.easing !== "linear"
				? {}
				: { easing: oneOf(keyframe.easing, AUTOMATION_EASINGS, "linear") }),
		}))
		.sort((a, b) => a.frame - b.frame);

export function normalizeAutomationTrack(
	track: AutomationTrack,
): AutomationTrack {
	return {
		binding: track.binding,
		mode: oneOf(track.mode, AUTOMATION_TRACK_MODES, "additive"),
		keyframes: normalizeAutomationKeyframes(track.keyframes),
	};
}

/**
 * Canonicalizes the standalone temporal-authoring contract. Tracks with no
 * finite keyframes are dropped because they carry no authored contribution.
 */
export function normalizeAutomationRecipe(
	draft: AutomationRecipeDraft = {},
): AutomationRecipe {
	return {
		enabled: Boolean(draft.enabled ?? NEUTRAL_AUTOMATION_RECIPE.enabled),
		fps: positiveInt(draft.fps, NEUTRAL_AUTOMATION_RECIPE.fps),
		durationFrames: positiveInt(
			draft.durationFrames,
			NEUTRAL_AUTOMATION_RECIPE.durationFrames,
		),
		tracks: (draft.tracks ?? [])
			.map(normalizeAutomationTrack)
			.filter((track) => track.keyframes.length > 0),
	};
}

export function mergeAutomationRecipeDraft(
	base: AutomationRecipeDraft,
	override: AutomationRecipeDraft,
): AutomationRecipeDraft {
	return {
		enabled: override.enabled ?? base.enabled,
		fps: override.fps ?? base.fps,
		durationFrames: override.durationFrames ?? base.durationFrames,
		tracks: override.tracks ?? base.tracks,
	};
}
