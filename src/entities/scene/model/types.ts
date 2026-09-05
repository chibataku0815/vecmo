import type { AeShape } from "@/shared/glammer/ae-shape";
import type { StrokeWidthProfileStop } from "@/shared/stroke/width-profile";
import type { EffectInfluenceRecipe, VisualRecipe } from "@/shared/vec-core";
import type { DuplicateGeneratorBinding } from "./duplicate-generator";
import type { EffectExpressionBinding } from "./effect-expression-binding";
import type { EffectLayerStack } from "./effect-layer-stack";
import type { LookGraph } from "./look-graph";
import type { NativeExpressionBinding } from "./native-expression-binding";
import type { ExternalProductionLink } from "./production-link";
import type { TextFragmentGroupProvenance } from "./text-fragments";

export const SCENE_SCHEMA_VERSION = 1 as const;

/** Two-dimensional coordinate in artboard-local units. */
export type Vec2 = {
	readonly x: number;
	readonly y: number;
};

/**
 * Frozen artboard-local seats for an Arrangement A/B correspondence. Snapshot
 * references are stable node ids; deletion, duplication, or id remapping never
 * guesses a replacement and instead makes a consumer fail closed when a member
 * no longer resolves.
 */
export type ArrangementLayoutSnapshot = {
	readonly id: string;
	readonly name: string;
	readonly artboardId: string;
	readonly coordinateSpace: "artboard-local";
	readonly memberNodeIds: readonly string[];
	readonly positions: Readonly<Record<string, Vec2>>;
	/** Caller-owned capture token; recapture is explicit rather than implicit. */
	readonly captureToken: string;
	readonly capturedArtboardSize: {
		readonly width: number;
		readonly height: number;
	};
};

/** Three-dimensional coordinate in authored scene-camera space. */
export type Vec3 = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
};

/**
 * Serializable 2D affine matrix payload used by rigging contracts. It mirrors
 * `rendering.ts`'s `Matrix2D` shape without importing renderer helpers into the
 * frozen scene type module.
 */
export type AffineMatrix2D = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

/** Axis-aligned bounds in the local geometry coordinate space. */
export type Bounds = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/**
 * Transform applied around a node-local anchor. Rotation is stored in degrees,
 * scale is a ratio, and position is an artboard-space translation.
 */
export type Transform = {
	readonly position: Vec2;
	readonly rotation: number;
	readonly scale: Vec2;
	readonly anchor: Vec2;
	/**
	 * Exact renderer-local affine matrix carried only by sampled presentation
	 * scenes. Authored/persisted SceneDocument transforms remain TRS; relation and
	 * camera projection may attach this override when their exact result contains
	 * shear that cannot round-trip through TRS decomposition.
	 */
	readonly presentationMatrix?: AffineMatrix2D;
};

export type TransformConstraintChannel = "position" | "rotation" | "scale";
export type TransformConstraintSpace = "local" | "world";

/** Explicit maintain-offset values captured in the constraint's destination space. */
export type TransformConstraintOffset = {
	readonly position?: Vec2;
	readonly rotation?: number;
	readonly scale?: Vec2;
};

/**
 * Single-source transform follow relation owned by its target node. It remains
 * distinct from full affine motion parenting: only selected TRS channels blend,
 * while the target's unselected channels continue to be authored normally.
 */
export type TransformConstraint = {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly channels: readonly TransformConstraintChannel[];
	readonly strength: number;
	readonly sourceSpace: TransformConstraintSpace;
	readonly destinationSpace: TransformConstraintSpace;
	readonly maintainOffset: boolean;
	readonly offset?: TransformConstraintOffset;
};

/** Numeric scene properties admitted by the first property-relation registry. */
export type RelationNumericProperty =
	| "style.opacity"
	| "geometry.cornerRadius"
	| "geometry.cornerSmoothing";

/**
 * Registry-backed scalar relation owned by the target node/property. Arbitrary
 * field paths and executable expressions are intentionally not part of this
 * contract.
 */
export type PropertyRelation = {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly sourceProperty: RelationNumericProperty;
	readonly targetProperty: RelationNumericProperty;
	readonly scale: number;
	readonly offset: number;
	readonly clamp?: { readonly min: number; readonly max: number };
};

export type BezierShape = AeShape;

/**
 * Per-corner radii for a rectangle/frame, in scene units. Each value is the RAW
 * authored radius — never the size-clamped value. Renderers clamp at draw time
 * (`clampRectCorners`) so an animated/shrinking rect does not "stick" at the
 * pill radius. Present only when corners are independent; when all four are
 * equal the canonical form stores the uniform value on
 * {@link RectGeometry.cornerRadius} and omits this field.
 */
export type CornerRadii = {
	readonly tl: number;
	readonly tr: number;
	readonly br: number;
	readonly bl: number;
};

export type RectGeometry = {
	readonly kind: "rect";
	readonly bounds: Bounds;
	/**
	 * Uniform corner radius (RAW, unclamped) and the legacy fallback every
	 * existing consumer reads. Stays required for backward compatibility.
	 */
	readonly cornerRadius: number;
	/**
	 * Optional per-corner radii. When present it overrides {@link cornerRadius}
	 * for rendering; when absent corners are uniform. Additive: documents authored
	 * before per-corner support omit it.
	 */
	readonly cornerRadii?: CornerRadii;
	/**
	 * Optional whole-shape corner smoothing (squircle), `0..1`. `0`/absent is a
	 * plain circular arc; `1` is a full superellipse blend. Additive.
	 */
	readonly cornerSmoothing?: number;
};

export type EllipseGeometry = {
	readonly kind: "ellipse";
	readonly bounds: Bounds;
};

export type LineGeometry = {
	readonly kind: "line";
	readonly start: Vec2;
	readonly end: Vec2;
};

export type PolygonGeometry = {
	readonly kind: "polygon";
	readonly points: readonly Vec2[];
	/** Optional uniform corner rounding (RAW, scene units). Additive. */
	readonly cornerRadius?: number;
	/** Optional whole-shape corner smoothing (squircle), `0..1`. Additive. */
	readonly cornerSmoothing?: number;
};

export type StarGeometry = {
	readonly kind: "star";
	readonly center: Vec2;
	readonly points: number;
	readonly innerRadius: number;
	readonly outerRadius: number;
	/** Optional uniform corner rounding on the outer tips (RAW, scene units). */
	readonly cornerRadius?: number;
	/** Optional whole-shape corner smoothing (squircle), `0..1`. Additive. */
	readonly cornerSmoothing?: number;
};

export type FillRule = "nonzero" | "evenodd";

export type PathGeometry = {
	readonly kind: "path";
	readonly shape: BezierShape;
	/**
	 * Inner contours (holes) of a compound path, e.g. the cutout of a donut or
	 * the counter of a letter. Optional and additive: documents without holes
	 * omit it. Resolved against `shape` using {@link PathGeometry.fillRule}.
	 */
	readonly subpaths?: readonly BezierShape[];
	/**
	 * Fill rule for resolving holes between `shape` and `subpaths`. Defaults to
	 * `"nonzero"` when omitted, matching the SVG/canvas default.
	 */
	readonly fillRule?: FillRule;
};

export type TextAlign = "left" | "center" | "right";

/** Every {@link TextAlign} literal, `satisfies`-checked so other layers (the MCP wire schema) can derive their enum from this instead of hand-typing a second list. */
export const TEXT_ALIGN_VALUES = [
	"left",
	"center",
	"right",
] as const satisfies readonly TextAlign[];

export type TextResizeMode = "point" | "area";

/**
 * Typography stored with text geometry. Values are scene-local units so canvas,
 * export, and future inspector controls can agree without DOM measurement.
 */
export type TextStyle = {
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly lineHeight: number;
	readonly align: TextAlign;
	readonly fontWeight: number;
	/**
	 * Tracking in scene units added to each glyph advance. May be negative to
	 * tighten text; `0` means default spacing. Persisted geometry keeps it
	 * optional, so documents authored before tracking resolve to `0`.
	 */
	readonly letterSpacing: number;
	/**
	 * Optional additive typography flags. They stay optional on the type so the
	 * many full-`TextStyle` constructors across import/style-transfer/presets keep
	 * compiling unchanged; `normalizeTextStyle` always resolves them to a concrete
	 * boolean (`false` when absent), so normalized scene/render data is canonical.
	 * A missing flag is exactly "off" with zero fidelity loss, which is why neither
	 * is ever reported as a style fallback (see `resolveTextStyle`).
	 */
	readonly italic?: boolean;
	readonly underline?: boolean;
};

export type TextGeometry = {
	readonly kind: "text";
	readonly bounds: Bounds;
	readonly text: string;
	readonly style?: Partial<TextStyle>;
	/**
	 * `point` text grows to its natural width from content. `area` text keeps its
	 * authored width and wraps lines inside that box. Missing legacy values resolve
	 * to `point`.
	 */
	readonly mode?: TextResizeMode;
};

/**
 * Scene-scoped asset bytes or inert reference metadata. `data-url` keeps
 * import/user-created raster content and approved source snapshots
 * self-contained; `reference` preserves an external identifier without
 * introducing storage, upload, or tenant persistence.
 */
export type SceneMediaSource =
	| {
			readonly kind: "data-url";
			readonly dataUrl: string;
	  }
	| {
			readonly kind: "reference";
			readonly href: string;
	  };

export type ImageAssetSource = SceneMediaSource;

export type VideoAssetSource = SceneMediaSource;

export type AudioAssetSource = SceneMediaSource;

export type ExternalSceneAssetSource = SceneMediaSource;

export type ExternalSceneAssetKind =
	| "external-scene"
	| "model-3d"
	| "code-module";

export type ExternalSceneAssetFormat =
	| "gltf"
	| "glb"
	| "three-scene-json"
	| "module"
	| "html"
	| "unknown";

export type ExternalSceneAssetCapability =
	| "preview"
	| "runtime-webgl"
	| "runtime-sandbox"
	| "agent-generated"
	| "import-placeholder"
	| "depth-plane-ready"
	| "export-fallback"
	| (string & {});

export type SceneAssetFidelityIssue = {
	readonly severity: "info" | "warning" | "error";
	readonly code: string;
	readonly message?: string;
};

export type ExternalSceneAssetPreview = {
	readonly assetId: string;
	readonly role: "thumbnail" | "editor-preview" | "export-fallback";
};

/**
 * One explicit, host-provided input to a bounded Program Surface. V1 deliberately
 * exposes values and read-only renderer facts only; it never carries a document,
 * store, command handle, or arbitrary callback into the program.
 */
export type ProgramSurfaceInputPort =
	| {
			readonly id: string;
			readonly kind: "scalar";
			readonly label?: string;
			readonly defaultValue?: number;
			readonly min?: number;
			readonly max?: number;
	  }
	| {
			readonly id: string;
			readonly kind: "color";
			readonly label?: string;
			readonly defaultValue?: string;
	  }
	| {
			readonly id: string;
			readonly kind:
				| "asset-texture"
				| "time"
				| "frame"
				| "seed"
				| "pointer"
				| "resolved-scene-camera";
			readonly label?: string;
	  };

/** A Program Surface emits one bounded, compositable RGBA texture in V1. */
export type ProgramSurfaceOutput = {
	readonly kind: "rgba-texture";
	readonly alphaMode: "premultiplied" | "straight";
	readonly width: number;
	readonly height: number;
};

/**
 * Serialized source portability facts. The actual immutable source package is
 * carried by `ProgramSurfaceAsset.source`; this metadata binds it to the
 * declared snapshot digest without making it executable.
 */
export type ProgramSurfaceSourceManifest = {
	readonly snapshotDigest: string;
	readonly portability: "self-contained" | "reference-only";
};

/** Honest per-delivery capability declaration for a Program Surface. */
export type ProgramSurfaceDelivery = {
	readonly editor: "live" | "fallback";
	readonly webglPlayer: "live" | "fallback" | "unsupported";
	readonly svgPdf: "raster-fallback" | "unsupported";
	readonly video: "capture" | "raster-fallback" | "unsupported";
};

/** Named raster fallback used only where a declared live program cannot ship. */
export type ProgramSurfaceFallback = {
	readonly assetId: string;
	readonly frame?: number;
};

/**
 * Strict V1 declaration for a bounded programmable render asset. It describes
 * only a WebGL2 package and typed ports; execution authority is intentionally
 * absent from the durable scene model.
 */
export type ProgramSurfaceManifestV1 = {
	readonly schemaVersion: 1;
	readonly runtime: {
		readonly kind: "webgl2";
		readonly entry: string;
		readonly compiledDigest: string;
	};
	readonly source: ProgramSurfaceSourceManifest;
	readonly inputs: readonly ProgramSurfaceInputPort[];
	readonly output: ProgramSurfaceOutput;
	readonly timing: {
		readonly seed: number;
		readonly deterministicAtFrame: boolean;
	};
	readonly space: {
		readonly cameraSpacePolicy: "screen_2d" | "resolved-scene-camera";
	};
	readonly delivery: ProgramSurfaceDelivery;
	readonly fallback?: ProgramSurfaceFallback;
};

/**
 * Session-local approval for one compiled Program Surface digest. This type is
 * intentionally not reachable from `SceneDocument`, so a collaborator, cloud
 * restore, or agent cannot grant execution authority by writing document data.
 */
export type ProgramSurfaceLocalDigestApproval = {
	readonly assetId: string;
	readonly compiledDigest: string;
};

/**
 * Serializable in-document raster asset metadata. Intrinsic dimensions are
 * optional because importers may only know placement bounds; editable node
 * geometry remains the source of placement truth.
 */
export type ImageAsset = {
	readonly id: string;
	readonly kind: "image";
	readonly name: string;
	readonly source: ImageAssetSource;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
};

/**
 * Serializable in-document video source metadata. The first implementation
 * reuses image geometry for rectangular placement; browser renderers materialize
 * the current video frame into a transient image asset before SVG/GPU export.
 */
export type VideoAsset = {
	readonly id: string;
	readonly kind: "video";
	readonly name: string;
	readonly source: VideoAssetSource;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly durationSeconds?: number;
};

/**
 * Serializable in-document audio source metadata (S5a minimal audio lane). Audio
 * has no scene-node geometry: it is scheduled purely against the global frame
 * clock through an {@link AudioTrack} sidecar rather than a node placement, so
 * this asset never appears on `ImageGeometry.assetId` or any other node
 * reference. `sampleRate`/`channels` are informational decode hints only; the
 * frame-anchored schedule itself lives on `AudioTrack`, not here.
 */
export type AudioAsset = {
	readonly id: string;
	readonly kind: "audio";
	readonly name: string;
	readonly source: AudioAssetSource;
	readonly mimeType?: string;
	readonly durationSeconds?: number;
	readonly sampleRate?: number;
	readonly channels?: number;
};

/**
 * Frame-anchored audio placement sidecar (S5a). `offsetFrames` positions the
 * track's trimmed-in point on the document's single global frame clock and may
 * be negative (started before frame 0). `inFrames`/`outFrames` trim the source
 * asset itself, in the same frame units, and are independent of `offsetFrames`.
 * This is deliberately NOT a scene node: audio has no geometry, selection, or
 * transform, so it lives on `SceneDocument.audioTracks` instead of
 * `SceneLayer.nodes`.
 */
export type AudioTrack = {
	readonly id: string;
	readonly assetId: string;
	readonly offsetFrames: number;
	readonly inFrames?: number;
	readonly outFrames?: number;
	readonly gainDb: number;
	readonly muted: boolean;
};

/**
 * Serializable metadata for externally generated 3D/code scene artifacts. Vecmo
 * stores loading, preview, placement, capability, and fidelity information, but
 * does not execute code or expose mesh/material editing through this contract.
 */
export type ExternalSceneAsset = {
	readonly id: string;
	readonly kind: ExternalSceneAssetKind;
	readonly name: string;
	readonly source: ExternalSceneAssetSource;
	readonly format?: ExternalSceneAssetFormat;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly preview?: ExternalSceneAssetPreview;
	readonly capabilities?: readonly ExternalSceneAssetCapability[];
	readonly issues?: readonly SceneAssetFidelityIssue[];
	/**
	 * Additive link to an externally produced source that Vecmo regenerates
	 * rather than owns. Absent on every hand-imported asset, so the field is
	 * migration-free. It never carries a filesystem path or pairing token: local
	 * binding identity lives in the working-copy registry owned by
	 * `entities/editor-session`, so a portable backup or cloud restore reproduces
	 * the logical link without leaking a machine-specific location.
	 */
	readonly production?: ExternalProductionLink;
};

/**
 * Serializable declaration and inert source package for one Program Surface.
 * The source is either an embedded data URL for a self-contained snapshot or an
 * inert reference label for a reference-only package. Neither form authorizes
 * execution; a future host must separately verify a local digest approval.
 */
export type ProgramSurfaceAsset = {
	readonly id: string;
	readonly kind: "program-surface";
	readonly name: string;
	readonly source: SceneMediaSource;
	readonly manifest: ProgramSurfaceManifestV1;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly issues?: readonly SceneAssetFidelityIssue[];
};

/** Scene asset library entry. Additive union for future asset kinds. */
export type SceneAsset =
	| ImageAsset
	| VideoAsset
	| AudioAsset
	| ExternalSceneAsset
	| ProgramSurfaceAsset;

/**
 * Editable raster/image placement node. The geometry stores artboard-local
 * bounds like other primitives, while `assetId` points at document-scoped image
 * metadata so transforms, selection, export, and future UI controls can treat
 * the image as a normal scene node.
 */
export type ImageGeometry = {
	readonly kind: "image";
	readonly bounds: Bounds;
	readonly assetId: string;
};

/**
 * Frozen additive geometry union. Future tools may append new kinds, but
 * existing variants must preserve their payload shape for fan-out worktrees.
 */
export type NodeGeometry =
	| RectGeometry
	| EllipseGeometry
	| LineGeometry
	| PolygonGeometry
	| StarGeometry
	| PathGeometry
	| TextGeometry
	| ImageGeometry;

export type VectorNodeKind = NodeGeometry["kind"];

/**
 * Affine transform stored with paints such as gradients or tiled images. The
 * matrix is in node-local paint coordinates so renderers and import/export
 * adapters can preserve author intent without coupling paint data to SVG attrs.
 */
export type PaintTransform = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

/** Stop position and color for gradient paints. Offsets resolve into [0, 1]. */
export type GradientStop = {
	/**
	 * Stable identity minted on authoring. Optional and additive: legacy documents
	 * and fixtures without ids still hydrate (`hydrateGradientStops` backfills on
	 * read), and renderers/exporters read only `offset`/`color`/`opacity`, so the
	 * field never reaches SVG. It exists so selection, the on-canvas annotator, the
	 * inspector ramp, and future keyframing all address the same stop even though
	 * stops re-sort by offset on every edit.
	 */
	readonly id?: string;
	readonly offset: number;
	readonly color: string;
	readonly opacity?: number;
};

/**
 * Optional per-paint visibility for the appearance stack. Omitted means visible:
 * legacy documents and every single-paint node never set it, so resolve/render
 * output is byte-identical. A `false` value keeps the paint in the persisted
 * stack (non-destructive toggle, like Figma's fill eye) while renderers skip it.
 */
export type PaintVisibility = {
	readonly visible?: boolean;
};

export type SolidPaint = {
	readonly kind: "solid";
	readonly color: string;
	readonly opacity?: number;
} & PaintVisibility;

export type LinearGradientPaint = {
	readonly kind: "linear-gradient";
	readonly stops: readonly GradientStop[];
	readonly from: Vec2;
	readonly to: Vec2;
	readonly opacity?: number;
	readonly transform?: PaintTransform;
} & PaintVisibility;

export type RadialGradientPaint = {
	readonly kind: "radial-gradient";
	readonly stops: readonly GradientStop[];
	readonly center: Vec2;
	readonly radius: Vec2;
	readonly opacity?: number;
	readonly transform?: PaintTransform;
} & PaintVisibility;

export type ImagePaintFit = "fill" | "fit" | "crop" | "tile";

export type ImageReferencePaint = {
	readonly kind: "image-reference";
	readonly assetId?: string;
	readonly href?: string;
	readonly fit?: ImagePaintFit;
	readonly opacity?: number;
	readonly transform?: PaintTransform;
} & PaintVisibility;

/**
 * One mesh point in a gradient-mesh grid: a node-local position and an sRGB color.
 * Points are addressed by their stable `(row, col)` position in
 * {@link MeshGradientPaint.points}, so no per-point id is needed (unlike gradient
 * stops, which re-sort by offset).
 *
 * Optional tangent handles bend the patch edges meeting at this point into cubic
 * Béziers. Each is a node-local OFFSET from `point` toward the named grid
 * neighbour (so a handle moves with its point); an omitted handle yields a
 * straight edge to that neighbour — the bilinear-degenerate case identical to a
 * handle-free mesh. The edge between two adjacent points uses the facing handles
 * of both (e.g. a horizontal edge uses the left point's `handleRight` and the
 * right point's `handleLeft`).
 */
export type MeshPoint = {
	readonly point: Vec2;
	readonly color: string;
	/** 0..1; defaults to 1 when omitted. */
	readonly opacity?: number;
	readonly handleUp?: Vec2;
	readonly handleDown?: Vec2;
	readonly handleLeft?: Vec2;
	readonly handleRight?: Vec2;
};

/**
 * Illustrator-style gradient mesh paint. The STORED form is a grid of mesh points
 * (the editable source of truth); renderers and exporters DERIVE Coons patches
 * from it via `coonsPatchesFromMesh` (see `mesh-edit.ts`) rather than storing
 * per-patch data, so shared edges/corners cannot desync. Browsers ship no usable
 * native `<meshgradient>`, so a mesh is CPU-rasterized to a bitmap and emitted as
 * `<pattern><image>` (live canvas + SVG export) or a first-point color
 * approximation (PDF, until native ShadingType 6).
 *
 * COORDINATE SPACE: every `Vec2` is in node-local geometry units (the space of
 * `PathGeometry` and gradient `from`/`to`); `transform` maps paint→node space like
 * the other paint transforms (→ SVG `patternTransform`).
 *
 * INVARIANTS: `rows >= 2 && cols >= 2`; `points.length === rows * cols`, row-major
 * (`points[row * cols + col]`).
 *
 * NOT ANIMATABLE through Phase 0–2: the motion system patches `fill` imperatively
 * via `data-render-part` and cannot mutate `<pattern>`/`<defs>` content. Mesh
 * keyframing is a later phase.
 */
export type MeshGradientPaint = {
	readonly kind: "mesh-gradient";
	readonly rows: number;
	readonly cols: number;
	readonly points: readonly MeshPoint[];
	readonly opacity?: number;
	readonly transform?: PaintTransform;
} & PaintVisibility;

/**
 * Expressive paint contract for node appearance. Legacy `fill` and `stroke`
 * remain on `NodeStyle`; these richer paint entries become authoritative only
 * when `fills` or `strokes` is present on a node.
 */
export type Paint =
	| SolidPaint
	| LinearGradientPaint
	| RadialGradientPaint
	| ImageReferencePaint
	| MeshGradientPaint;

/**
 * Paint kinds a {@link RevealPaint} accepts: the vector paint servers a Noise
 * Gradient dissolve's `revealPaint` renders through the SAME paint→SVG
 * serializer/defs machinery as `style.fills` (see `canvas-paint.ts`/
 * `paint-server-svg.ts`), narrower than the full {@link Paint} union because an
 * image/mesh reveal has no clean single-element underlay rendering (a mesh
 * needs its own rasterized bitmap per node instance, an image reference has no
 * "second color" reading) — solid/gradient covers every real two-color
 * interpenetrating-grain composition this feature exists for.
 */
export type RevealPaint =
	| SolidPaint
	| LinearGradientPaint
	| RadialGradientPaint;

export type BlendMode =
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

/**
 * Every {@link BlendMode} literal, structurally checked against the type by
 * `satisfies` so a new blend mode added to the type without a matching entry
 * here is a compile error. The single source other layers (the MCP wire
 * schema) should derive their blend-mode enum from instead of hand-typing a
 * second literal list that can silently drift.
 */
export const BLEND_MODES = [
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

export type ShadowEffectKind = "drop-shadow" | "inner-shadow";

export type BlurEffectKind = "layer-blur" | "background-blur";

export type ShadowEffect = {
	readonly kind: ShadowEffectKind;
	readonly offset: Vec2;
	readonly radius: number;
	readonly color: string;
	readonly opacity?: number;
	readonly spread?: number;
	readonly visible?: boolean;
	readonly blendMode?: BlendMode;
};

export type BlurEffect = {
	readonly kind: BlurEffectKind;
	readonly radius: number;
	/**
	 * Optional y-axis sigma control for axis-aligned anisotropic Gaussian blur.
	 * `radius` controls X and `radiusY` controls Y; omission links Y to X and keeps
	 * byte-identical isotropic output. This does not encode angle, trajectory, or
	 * motion blur.
	 */
	readonly radiusY?: number;
	readonly visible?: boolean;
};

/** Node-level visual effects resolved in list order by future render adapters. */
export type Effect = ShadowEffect | BlurEffect;

/**
 * Node-wide softness applied to the stroke stack only, kept on `NodeStyle` so it
 * is canonical object appearance — never frame effect intent and never a parallel
 * appearance model. `blurRadius` is an authored scene-unit radius (`>= 0`, `0`
 * means no softness); the renderer splits fill/stroke and Gaussian-blurs only the
 * stroke group when it is nonzero. `featherRadius` is reserved for a later tier
 * and is not yet rendered.
 */
export type StrokeSoftness = {
	readonly blurRadius?: number;
	readonly featherRadius?: number;
};

export type StrokeAlign = "inside" | "center" | "outside";

/**
 * Every {@link StrokeAlign} literal, structurally checked against the type by
 * `satisfies` so a new alignment added to the type without a matching entry
 * here is a compile error. The single source other layers (the MCP wire
 * schema) should derive their enum from instead of hand-typing a second
 * literal list that can silently drift.
 */
export const STROKE_ALIGN_VALUES = [
	"inside",
	"center",
	"outside",
] as const satisfies readonly StrokeAlign[];

export type StrokeCap = "butt" | "round" | "square";

/** Every {@link StrokeCap} literal, `satisfies`-checked so other layers (the MCP wire schema) can derive their enum from this instead of hand-typing a second list. */
export const STROKE_CAP_VALUES = [
	"butt",
	"round",
	"square",
] as const satisfies readonly StrokeCap[];

export type StrokeJoin = "miter" | "round" | "bevel";

/** Every {@link StrokeJoin} literal, `satisfies`-checked so other layers (the MCP wire schema) can derive their enum from this instead of hand-typing a second list. */
export const STROKE_JOIN_VALUES = [
	"miter",
	"round",
	"bevel",
] as const satisfies readonly StrokeJoin[];

export type NodeStyle = {
	readonly fill: string;
	readonly stroke: string;
	readonly strokeWidth: number;
	readonly opacity: number;
	readonly fills?: readonly Paint[];
	readonly strokes?: readonly Paint[];
	readonly effects?: readonly Effect[];
	readonly blendMode?: BlendMode;
	readonly strokeAlign?: StrokeAlign;
	readonly strokeDash?: readonly number[];
	/**
	 * Phase offset into {@link strokeDash}. Marches a static dash pattern along the
	 * path (the SVG `stroke-dashoffset` primitive); the motion-expression runtime
	 * drives this per frame to animate a travelling stroke window without mutating
	 * the dash array (which would tear at a closed-path seam).
	 */
	readonly strokeDashoffset?: number;
	readonly strokeCap?: StrokeCap;
	readonly strokeJoin?: StrokeJoin;
	readonly strokeMiterLimit?: number;
	readonly strokeSoftness?: StrokeSoftness;
	/**
	 * Variable-width stroke profile: multiplier stops over normalized arc length
	 * (see {@link StrokeWidthProfileStop}). When present, renderers expand the
	 * stroked spine into a filled outline instead of a uniform-width stroke, and
	 * {@link strokeDash}/{@link strokeDashoffset} are ignored (a dashed variable-width
	 * stroke is out of v1 scope). Not animatable in v1 — `strokeWidth` itself is
	 * keyframable, but the profile shape is static per edit.
	 */
	readonly strokeWidthProfile?: readonly StrokeWidthProfileStop[];
};

/**
 * Scene-scoped reusable component source. The source node remains an ordinary
 * scene node so current render/export paths keep working; this library record
 * gives future component UI a stable id/name/source lookup without a migration.
 */
export type ComponentSymbol = {
	readonly id: string;
	readonly name: string;
	readonly sourceNodeId: string;
};

type ComponentOverrideTarget = {
	readonly sourceNodeId: string;
	readonly instanceNodeId: string;
};

export type ComponentNameOverride = ComponentOverrideTarget & {
	readonly kind: "name";
	readonly name: string;
};

export type ComponentStyleOverride = ComponentOverrideTarget & {
	readonly kind: "style";
	readonly style: Partial<NodeStyle>;
};

export type ComponentTransformOverride = ComponentOverrideTarget & {
	readonly kind: "transform";
	readonly transform: Partial<Transform>;
};

export type ComponentTextOverride = ComponentOverrideTarget & {
	readonly kind: "text";
	readonly text?: string;
	readonly bounds?: Bounds;
	readonly style?: Partial<TextStyle>;
};

/**
 * Instance override metadata, keyed by both source and instance node ids so a
 * future sync UI can show what diverged even after instance ids are remapped.
 */
export type ComponentNodeOverride =
	| ComponentNameOverride
	| ComponentStyleOverride
	| ComponentTransformOverride
	| ComponentTextOverride;

export type ComponentSourceBinding = {
	readonly kind: "source";
	readonly symbolId: string;
};

export type ComponentInstanceBinding = {
	readonly kind: "instance";
	readonly symbolId: string;
	readonly sourceNodeId: string;
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
	readonly overrides?: readonly ComponentNodeOverride[];
	/**
	 * Per-instance motion phase shift, in frames. The instance plays the master's
	 * keyframe motion advanced/delayed by this amount, so a row of linked instances
	 * can stagger into a wave. It is BAKED into the instance's copied tracks (each
	 * keyframe time shifted) rather than resolved at sample time, keeping the sampler
	 * component-unaware; propagation re-applies it so a master edit never drops the
	 * offset. Omitted/legacy instances resolve to `0`. Applies to keyframe tracks
	 * only — grammar-technique phase offset is a follow-up.
	 */
	readonly timingOffsetFrames?: number;
};

/**
 * Optional node-level component role. Omitted legacy nodes remain normal scene
 * nodes; source and instance nodes still carry normal geometry/style data so
 * rendering, hit testing, and export do not need component awareness.
 */
export type ComponentNodeBinding =
	| ComponentSourceBinding
	| ComponentInstanceBinding;

export type LayoutFrameAutoFlow = "row" | "column";

export type LayoutFrameVariantMode = "manual" | "auto";

export type LayoutCellFitMode = "contain" | "cover";

export type LayoutFramePresetId =
	| "uniform-grid"
	| "bento-hero-left"
	| "bento-hero-top"
	| "bento-mosaic";

export type LayoutFrameGap = {
	readonly x: number;
	readonly y: number;
};

export type LayoutFramePadding = {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
};

/**
 * Zero-based grid placement for one direct child of a layout frame. Span values
 * are cell counts, not end-line numbers. `fit` controls how non-box vector
 * content is projected into the cell while keeping the contract CSS-free.
 */
export type LayoutCellPlacement = {
	readonly column: number;
	readonly row: number;
	readonly columnSpan?: number;
	readonly rowSpan?: number;
	readonly fit?: LayoutCellFitMode;
};

/**
 * Named responsive layout variant. Variants are stored as sparse overrides on
 * top of the base layout so switching variants never destroys the base grid.
 * Width bounds participate in automatic breakpoint selection when the frame
 * opts into `variantMode: "auto"`; otherwise `activeVariantId` is manual.
 */
export type LayoutFrameVariantContract = {
	readonly id: string;
	readonly name: string;
	readonly minWidth?: number;
	readonly maxWidth?: number;
	readonly columns?: number;
	readonly rows?: number | "auto";
	readonly gap?: Partial<LayoutFrameGap>;
	readonly padding?: Partial<LayoutFramePadding>;
	readonly autoFlow?: LayoutFrameAutoFlow;
	readonly allowOverlap?: boolean;
	readonly preset?: LayoutFramePresetId;
	readonly placements?: Readonly<Record<string, LayoutCellPlacement>>;
};

/**
 * Author-owned layout intent for a frame. Renderers still see ordinary children;
 * commands materialize this contract into child geometry so initial Grid/Bento
 * authoring works through the existing scene, export, and motion paths.
 */
export type LayoutFrameContract = {
	readonly kind: "grid";
	readonly version: 1;
	readonly columns: number;
	readonly rows: number | "auto";
	readonly gap: LayoutFrameGap;
	readonly padding: LayoutFramePadding;
	readonly autoFlow: LayoutFrameAutoFlow;
	readonly allowOverlap?: boolean;
	readonly preset?: LayoutFramePresetId;
	readonly placements?: Readonly<Record<string, LayoutCellPlacement>>;
	readonly variantMode?: LayoutFrameVariantMode;
	readonly activeVariantId?: string;
	readonly variants?: readonly LayoutFrameVariantContract[];
};

/**
 * Optional node-level frame role. A frame is an ordinary container node — it keeps
 * `children` (the wrapped content), a `rect` geometry whose `bounds` are the
 * frame box, and a normal style for its background — plus this marker carrying
 * frame-specific intent. Omitting it keeps a node a plain node or a group, so the
 * field is purely additive: legacy documents, the existing group/ungroup path,
 * and renderers that ignore the marker are unaffected.
 *
 * A frame is deliberately NOT an artboard. Artboards are page-level (`Artboard`,
 * owning fps/duration/page background and editor focus via `currentArtboardId`);
 * a frame is a nestable scene node that wraps selected content into one
 * transformable, clippable container without changing artboard ownership or
 * focus. The `kind` discriminant keeps serialized frames self-identifying and
 * leaves room for future frame variants (e.g. layout frames).
 */
export type FrameNodeContract = {
	readonly kind: "frame";
	/**
	 * Whether the frame clips its children to its box. Foundation-level intent
	 * only: this records author intent so read model, inspector, and export can
	 * agree; the actual clip render/export path is the mask/clip stream's work.
	 * Readers resolve an omitted value as `true` (the Figma frame default).
	 */
	readonly clipsContent?: boolean;
	/**
	 * Optional authoring layout applied to direct children. Omitted frames keep the
	 * pre-layout behavior; when present, GUI and MCP commands update it through the
	 * scene command bus and materialize child placement from the same pure planner.
	 */
	readonly layout?: LayoutFrameContract;
};

export type BlendSpacing =
	| { readonly kind: "specified-steps"; readonly steps: number }
	| { readonly kind: "specified-distance"; readonly distance: number }
	| { readonly kind: "smooth-color"; readonly maxSteps?: number };

export type BlendSpine =
	| { readonly kind: "line"; readonly start: Vec2; readonly end: Vec2 }
	| { readonly kind: "path"; readonly shape: BezierShape };

export type BlendOrientation = "page" | "spine";
export type BlendStackingOrder = "normal" | "reversed";

/**
 * Stable reference to the authored contour vertex selected as a Blend source
 * attachment. It lets regenerated Blend steps follow the current vertex after
 * geometry edits, while `BlendSourceStop.localPoint` remains a fallback snapshot.
 */
export type BlendSourceAnchorRef =
	| { readonly kind: "main"; readonly index: number }
	| {
			readonly kind: "subpath";
			readonly subpathIndex: number;
			readonly index: number;
	  };

/**
 * Ordered Blend source metadata. `nodeId` mirrors `sourceNodeIds`; `anchorRef`
 * stores the clicked contour vertex when the source geometry exposes one, while
 * `localPoint` keeps the node-local fallback coordinate used by existing
 * documents and by registration-point placement.
 */
export type BlendSourceStop = {
	readonly nodeId: string;
	readonly anchorRef?: BlendSourceAnchorRef;
	readonly localPoint?: Vec2;
};

/**
 * Semantic contract for an Illustrator-style blend container. The container is a
 * normal node with `children`; source-stop children remain the authored
 * sources, while generated step children are a command-maintained
 * materialization cache. `spine` is stored in the blend container's
 * parent/artboard coordinate space. `sourceStops` is optional for legacy and
 * center-registered blends; when present it follows `sourceNodeIds` order.
 */
export type BlendNodeContract = {
	readonly kind: "blend";
	readonly version: 1;
	/** Ordered Blend stops. The contract requires at least two source node ids. */
	readonly sourceNodeIds: readonly string[];
	readonly sourceStops?: readonly BlendSourceStop[];
	readonly generatedNodeIds: readonly string[];
	readonly spacing: BlendSpacing;
	readonly spine?: BlendSpine;
	readonly orientation?: BlendOrientation;
	readonly stacking?: BlendStackingOrder;
};

/** Provenance for generated intermediate children owned by a blend container. */
export type BlendStepContract = {
	readonly kind: "blend-step";
	readonly blendNodeId: string;
	readonly index: number;
	readonly segmentIndex?: number;
	readonly segmentT?: number;
	readonly t: number;
};

/** Shared rigging link for nodes driven by a controller/null in motion space. */
export type MotionParentBinding = {
	readonly parentNodeId: string;
	readonly bindMatrix: AffineMatrix2D;
};

/**
 * Marks an ordinary node as a null/controller. It remains a scene node for
 * selection and keyframing, while render/export adapters may suppress its paint
 * when it is used only as rigging chrome.
 */
export type MotionControllerNodeContract = {
	readonly kind: "motion-controller";
	readonly handleRadius?: number;
};

export type SceneCameraProjectionKind = "orthographic" | "perspective";

/**
 * Declares how an artboard's motion relates to camera space. Canonical home for
 * this vocabulary (see `docs/3d-camera-motion-standards-plan.md` §3.1); reproduction
 * descriptor import (`features/reproduction-descriptor/model/descriptor-import.ts`)
 * imports this type downward instead of forking its own copy. `"screen_2d"` is an
 * explicit, audit-visible opt-out of the camera-first standard (flat motion is
 * deliberate); `"vector_2_5d"`/`"camera_space"`/`"true_3d_required"` are increasing
 * commitments to authored camera space.
 */
export type CameraSpacePolicy =
	| "screen_2d"
	| "vector_2_5d"
	| "camera_space"
	| "true_3d_required";

/** Authored camera body / point-of-interest relation for one scene scope. */
export type SceneCameraRigContract = {
	readonly id: string;
	readonly name: string;
	readonly version: 1;
	readonly scope:
		| { readonly kind: "artboard"; readonly artboardId: string }
		| { readonly kind: "scene" };
	readonly projection: {
		readonly kind: SceneCameraProjectionKind;
		readonly fovDegrees?: number;
		readonly zoom?: number;
		readonly focalLengthMm?: number;
		readonly focusDistance?: number;
		readonly aperture?: number;
		readonly near?: number;
		readonly far?: number;
	};
	readonly body: {
		readonly position: Vec3;
		readonly rotation?: Vec3;
		readonly parentControllerNodeId?: string;
	};
	readonly target?: {
		readonly point: Vec3;
		readonly nodeId?: string;
		readonly parentControllerNodeId?: string;
	};
	readonly parentControllerNodeId?: string;
};

/** Places flat vector artwork into authored camera space without making it mesh. */
export type SceneDepthPlaneContract = {
	readonly kind: "depth-plane";
	readonly version: 1;
	readonly z: number;
	readonly billboarding?: "screen-facing" | "plane";
	readonly cameraRigId?: string;
};

/**
 * Plain scene node. The document graph must stay serializable as POJOs so
 * Immer patches, persistence, and future Worker adapters can replay it.
 */
export type VectorNode = {
	readonly id: string;
	readonly name: string;
	/**
	 * Optional owning artboard for multi-artboard documents. Omitted legacy
	 * nodes are treated as belonging to the current/default artboard by selectors.
	 */
	readonly artboardId?: string;
	readonly geometry: NodeGeometry;
	readonly transform: Transform;
	readonly style: NodeStyle;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly recipeRef?: string;
	/**
	 * Inline vec-core visual recipe ("look") attached to this node as authoring
	 * intent (integration-doc P3: contract-as-state). The SVG renderers paint the
	 * vector-expressible subset (color grade now; grain/glow as labeled SVG-approx
	 * tiers) via the effect-filter adapter; full-fidelity raster finish stays the
	 * P4 WebGPU bridge. `recipeRef` is reserved for a future shared recipe library;
	 * when both exist, the inline `recipe` wins. Omitted = no look (legacy nodes).
	 */
	readonly recipe?: VisualRecipe;
	readonly component?: ComponentNodeBinding;
	/**
	 * Optional frame container role. Present only on nodes created by the
	 * wrap-in-frame command; omitted nodes (including groups) stay frame-agnostic.
	 * See {@link FrameNodeContract} for why a frame is a node role, not an artboard.
	 */
	readonly frame?: FrameNodeContract;
	readonly motionParent?: MotionParentBinding;
	readonly transformConstraint?: TransformConstraint;
	readonly propertyRelations?: readonly PropertyRelation[];
	readonly motionController?: MotionControllerNodeContract;
	readonly depthPlane?: SceneDepthPlaneContract;
	readonly children?: readonly VectorNode[];
	/**
	 * Optional text-fragment-group provenance: marks this node's children as ordered
	 * text-motion fragments (one per word/char/line) that an `outline-group` text
	 * animator poses as real nodes. Present only on groups produced by a bake/explode
	 * op or outline import; omitted on ordinary groups. See {@link TextFragmentGroupProvenance}.
	 */
	readonly textFragmentGroup?: TextFragmentGroupProvenance;
	readonly blend?: BlendNodeContract;
	readonly blendStep?: BlendStepContract;
	readonly data?: Record<string, unknown>;
};

export type SceneLayer = {
	readonly id: string;
	readonly name: string;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly nodes: readonly VectorNode[];
};

/**
 * Portable vec-core effect intent attached outside individual nodes. Scene and
 * artboard side-cars let frame-level looks, masks, export manifests, and future
 * automation address the same normalized recipe payloads without changing the
 * legacy node-level `recipe` compatibility field.
 */
export type EffectIntent = {
	/**
	 * Canonical graph-first Look document for this scope. When present it is the
	 * source of truth and takes precedence over {@link EffectIntent.effectLayerStack}
	 * and {@link EffectIntent.visualRecipe}, which become compatibility projections.
	 * Omitted on legacy/stack-only documents, which still read as a generated graph.
	 */
	readonly lookGraph?: LookGraph;
	/**
	 * Ordered look/effect layers for TouchDesigner-style compositing. Now a
	 * compatibility projection of the Look graph rather than the canonical model:
	 * the rows wrap canonical vec-core recipe/influence payloads with stable
	 * identity, target, order, blend/mix, adaptation, and fidelity metadata; they
	 * do not duplicate scalar recipe state.
	 */
	readonly effectLayerStack?: EffectLayerStack;
	/** Canonical frame/node look recipe. Omitted means no look at this scope. */
	readonly visualRecipe?: VisualRecipe;
	/**
	 * Canonical mask/influence assignments for the scope. Omitted means no
	 * influence side-car at this scope; an empty disabled recipe remains valid
	 * when a caller needs to preserve explicit author intent.
	 */
	readonly influenceRecipe?: EffectInfluenceRecipe;
	/**
	 * Object-scoped look overlays owned by this scene/artboard side-car. These do
	 * not participate in frame look inheritance; renderers resolve them as
	 * explicit target-node overlays so a selected-object action cannot silently
	 * become a whole-frame effect.
	 */
	readonly scopedLooks?: readonly ScopedEffectLook[];
};

export type VisualRecipeScopedEffectLook = {
	readonly id: string;
	readonly kind: "visual-recipe-overlay";
	readonly source: "analog-film-selection";
	readonly visualRecipe: VisualRecipe;
	readonly targetNodeIds: readonly string[];
	readonly influenceRecipe?: EffectInfluenceRecipe;
};

export type LookGraphScopedEffectLook = {
	readonly id: string;
	readonly kind: "look-graph-overlay";
	readonly source:
		| "object-noise-gradient"
		| "object-path-blur"
		| "selection-look-graph";
	readonly lookGraph: LookGraph;
	readonly targetNodeIds: readonly string[];
};

export type ScopedEffectLook =
	| VisualRecipeScopedEffectLook
	| LookGraphScopedEffectLook;

/**
 * Authoring role for an artboard-like canvas surface. Omitted role means
 * `"scene"` for legacy documents: existing artboards remain exportable scenes
 * until the user explicitly marks them as library/scratch/reference surfaces.
 */
export type ArtboardRole = "scene" | "asset-board" | "scratch" | "reference";

/** Source-isolated, axis-aligned bloom authored independently from the source core. */
export type SourceOpticsBloomContract = {
	readonly enabled: boolean;
	readonly radiusX: number;
	/** Omission links Y to X and preserves the legacy isotropic representation. */
	readonly radiusY?: number;
	readonly intensity: number;
	readonly threshold: number;
	readonly blendMode: BlendMode;
};

/** One bounded directional streak derived from the canonical source node. */
export type SourceOpticsRayContract = {
	readonly id: string;
	readonly enabled: boolean;
	/** Artboard-space angle in degrees. */
	readonly angle: number;
	readonly length: number;
	readonly width: number;
	readonly intensity: number;
	readonly falloff: number;
	readonly oppositeSideRatio: number;
};

/** Wide, low-mix optical propagation optionally shaped by a shared Effect Field. */
export type SourceOpticsAtmosphereContract = {
	readonly enabled: boolean;
	readonly fieldId?: string;
	readonly mix: number;
	readonly falloff: number;
	readonly reach: number;
	readonly tint?: string;
};

/** Source-local display/lens consequence; never a frame-wide post effect. */
export type SourceOpticsLensContract = {
	readonly enabled: boolean;
	readonly mix: number;
	readonly chroma: number;
	readonly reach: number;
};

/** Source-facing surface highlight response for an arbitrary rasterizable target. */
export type SourceOpticsSurfaceResponse = {
	readonly amount: number;
	readonly width: number;
	readonly softness: number;
	readonly tint?: string;
};

/** Bounded inward diffusion response for an arbitrary rasterizable target. */
export type SourceOpticsDiffusionResponse = {
	readonly amount: number;
	readonly depth: number;
	readonly softness: number;
	readonly tint?: string;
};

/** Explicit silhouette-band response; distinct from layer blur and mask feather. */
export type SourceOpticsEdgeResponse = {
	readonly amount: number;
	readonly width: number;
	readonly softness: number;
	readonly tint?: string;
};

/** Couples response opacity to existing target luminance/texture without creating texture. */
export type SourceOpticsMicrostructureResponse = {
	readonly amount: number;
};

/** Localized spectral separation contained by the target response matte. */
export type SourceOpticsSpectralResponse = {
	readonly amount: number;
	readonly offset: number;
};

/** One target's authored response to a source rig; parameters describe behavior, not material names. */
export type SourceOpticsResponseBinding = {
	readonly id: string;
	readonly targetNodeId: string;
	readonly enabled: boolean;
	readonly fieldId?: string;
	readonly surface?: SourceOpticsSurfaceResponse;
	readonly diffusion?: SourceOpticsDiffusionResponse;
	readonly edge?: SourceOpticsEdgeResponse;
	readonly microstructure?: SourceOpticsMicrostructureResponse;
	readonly spectral?: SourceOpticsSpectralResponse;
};

/**
 * Artboard-scoped causal relation from one canonical source node to existing
 * targets. It stores no copied source geometry, paint, position, or material
 * identity and never materializes helper scene nodes.
 */
export type SourceOpticsRigContract = {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly sourceNodeId: string;
	readonly bloom: SourceOpticsBloomContract;
	readonly rays?: readonly SourceOpticsRayContract[];
	readonly atmosphere?: SourceOpticsAtmosphereContract;
	readonly lens?: SourceOpticsLensContract;
	readonly responses: readonly SourceOpticsResponseBinding[];
};

export type Artboard = {
	readonly id: string;
	readonly name: string;
	/**
	 * Authoring/export role for this board. Missing values intentionally read as
	 * `"scene"` through selectors so older documents do not need migration.
	 */
	readonly role?: ArtboardRole;
	/**
	 * Pasteboard-space origin for this artboard. Legacy single-artboard documents
	 * omit it and normalize to { x: 0, y: 0 }.
	 */
	readonly position?: Vec2;
	readonly width: number;
	readonly height: number;
	readonly background: string;
	/**
	 * Figma-style frame fills for the artboard background. Omitted means legacy
	 * documents render the scalar `background` color; when present, the fill stack
	 * is authoritative and `background` remains the solid fallback/metadata color.
	 */
	readonly fills?: readonly Paint[];
	readonly fps: number;
	readonly durationFrames: number;
	/** Optional active authored scene camera for this artboard's rendered scope. */
	readonly activeSceneCameraId?: string;
	/**
	 * Optional declared camera-space commitment for this artboard (per-artboard so
	 * a multi-artboard document can mix deliberately flat and camera-authored
	 * boards). Omitted documents read as undeclared; validation treats undeclared
	 * plus spatial motion plus no active camera as a warning, not an error.
	 */
	readonly cameraSpacePolicy?: CameraSpacePolicy;
	/**
	 * Optional artboard/frame-level vec-core intent. It is additive so legacy
	 * documents without this field still hydrate through selector defaults.
	 */
	readonly effectIntent?: EffectIntent;
	/** Optional causal source/target optics relations; legacy artboards omit it. */
	readonly sourceOpticsRigs?: readonly SourceOpticsRigContract[];
};

/**
 * First-class composition order for artboard-as-scene export. The MVP supports
 * only hard cuts, but the object wrapper leaves room for explicit transition
 * metadata without overloading artboard order or timeline keyframes.
 */
export type SceneTransition = {
	readonly kind: "cut";
};

/**
 * One scene artboard placed inside a document-level sequence. `durationFrames`
 * is an override for composition/export; omitting it lets callers fall back to
 * the artboard's own duration, then the motion document's duration.
 */
export type SceneSequenceItem = {
	readonly id: string;
	readonly artboardId: string;
	readonly label?: string;
	readonly durationFrames?: number;
	readonly transition?: SceneTransition;
};

/**
 * Scene-level sequence side-car. It orders scene artboards for long-form
 * preview/export without changing `artboards` array order, which remains a
 * layout/management concern.
 */
export type SceneSequence = {
	readonly id: string;
	readonly name: string;
	readonly fps?: number;
	readonly exportSize?: {
		readonly width: number;
		readonly height: number;
	};
	readonly items: readonly SceneSequenceItem[];
};

/**
 * UI categorization hint for a reusable style preset. The kind drives how a
 * future style panel groups presets; it does NOT restrict which payload parts a
 * preset may carry, because text color lives on `NodeStyle.fill` while typography
 * lives on `TextStyle`. A "text" preset may carry both a paint part and a
 * typography part.
 */
export type StylePresetKind = "node" | "text";

/** Paint subset a preset can apply to any node's appearance. */
export type StylePresetPaint = Partial<
	Pick<NodeStyle, "fill" | "stroke" | "strokeWidth" | "opacity">
>;

/** Typography subset a preset can apply to text-node geometry style. */
export type StylePresetTypography = Partial<TextStyle>;

/**
 * Full appearance subset a graphic-style preset can apply: the expressive paint
 * stacks, effects, blend mode, and stroke geometry. This is what lets a preset
 * reproduce a multi-fill/effect appearance, beyond the legacy single-color
 * {@link StylePresetPaint}. Value-copied on apply (presets are not live links).
 */
export type StylePresetAppearance = Partial<
	Pick<
		NodeStyle,
		| "fills"
		| "strokes"
		| "effects"
		| "blendMode"
		| "strokeAlign"
		| "strokeDash"
		| "strokeCap"
		| "strokeJoin"
		| "strokeMiterLimit"
		| "opacity"
	>
>;

/** A component prop's authored value kind. Drives both its {@link ComponentPropValue} shape and which {@link ComponentPropBinding} kinds it accepts. */
export type ComponentPropType = "number" | "color" | "text";

/**
 * Every {@link ComponentPropType} literal, `satisfies`-checked so other layers
 * (the MCP wire schema) can derive their enum from this instead of hand-typing
 * a second literal list that can silently drift.
 */
export const COMPONENT_PROP_TYPES = [
	"number",
	"color",
	"text",
] as const satisfies readonly ComponentPropType[];

/**
 * A component prop's default/authored value, discriminated by its parent
 * {@link ComponentPropDefinition.type}. `color` is a CSS color string (matching
 * `NodeStyle.fill`/`SolidPaint.color`'s own string contract, not a structured
 * color object) and `text` is plain string content — both value kinds a host
 * embedding the exported component can pass as an ordinary prop.
 */
export type ComponentPropValue =
	| { readonly type: "number"; readonly value: number }
	| { readonly type: "color"; readonly value: string }
	| { readonly type: "text"; readonly value: string };

/**
 * Binds a `number` component prop to an existing bindable-property authoring
 * channel on a node (`transform.x`, `style.opacity`, `effect.*`, etc. — the
 * `bindable-property.ts` registry). `propertyId` must resolve in that registry
 * AND be eligible for `nodeId`'s current geometry/target-scope (see
 * `resolveComponentPropBindingIssue` in `component-props.ts`, which is the
 * single place this eligibility is checked so agent commands and future UI
 * cannot drift from each other).
 */
export type ComponentPropBindingBindable = {
	readonly kind: "bindable";
	readonly nodeId: string;
	readonly propertyId: string;
};

/**
 * Binds a `color` component prop to one SOLID paint slot in a node's appearance
 * stack (`role` selects `style.fills`/`style.strokes`; `paintIndex` selects the
 * slot, defaulting to `0` — the same index space as `readAppearanceStack`'s
 * `fills`/`strokes` rows, including the single synthesized legacy item at index
 * `0` when the node has no rich paint array yet). v1 constraint: the resolved
 * paint slot must be a {@link SolidPaint} — gradient, mesh, and image paint
 * targets are refused with a typed reason. Gradient-stop color binding
 * (targeting one stop inside a `LinearGradientPaint`/`RadialGradientPaint`) is
 * deferred to a later slice; this shape does not carry a stop index.
 */
export type ComponentPropBindingStyleColor = {
	readonly kind: "style-color";
	readonly nodeId: string;
	readonly role: "fill" | "stroke";
	readonly paintIndex?: number;
};

/**
 * Binds a `text` component prop to a text node's content (`geometry.text`).
 * `nodeId` must resolve to a node whose `geometry.kind === "text"`.
 */
export type ComponentPropBindingTextContent = {
	readonly kind: "text-content";
	readonly nodeId: string;
};

/** One prop-to-node wire. A prop may carry more than one binding (fan-out to several nodes/properties from a single host-settable value). */
export type ComponentPropBinding =
	| ComponentPropBindingBindable
	| ComponentPropBindingStyleColor
	| ComponentPropBindingTextContent;

/**
 * Every {@link ComponentPropBinding} `kind` literal, `satisfies`-checked so
 * other layers (the MCP wire schema) can derive their enum from this instead of
 * hand-typing a second literal list that can silently drift.
 */
export const COMPONENT_PROP_BINDING_KINDS = [
	"bindable",
	"style-color",
	"text-content",
] as const satisfies readonly ComponentPropBinding["kind"][];

/**
 * A document-scoped, host-settable authoring prop for Motion Component export
 * (the goal this slice lays the model for: an exported scene becomes an
 * embeddable component with typed props a host app can set). `defaultValue`'s
 * `type` must match `type`, and every entry in `bindings` must be a binding
 * kind compatible with `type` (`number` -> `bindable` only, `color` ->
 * `style-color` only, `text` -> `text-content` only) — see
 * `normalizeComponentPropDefinition` in `component-props.ts` for the single
 * normalization seam that enforces this. `min`/`max`/`step` are only
 * meaningful when `type === "number"`; they describe the host-facing control
 * range, not a render-time clamp (bindable-property writes already clamp at
 * their own registry).
 *
 * Export compilation resolves these bindings into one typed applier table used
 * by both SVG and WebGL runtimes; the editor's Shared colors surface authors the
 * same color props without introducing a second palette payload.
 */
export type ComponentPropDefinition = {
	readonly id: string;
	readonly name: string;
	readonly type: ComponentPropType;
	readonly defaultValue: ComponentPropValue;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly bindings: readonly ComponentPropBinding[];
};

/**
 * A trigger's activation kind (Interactive Motion, T3-S1: document model + agent
 * authoring only — no runtime/editor-preview consumes this yet). `click`/`hover-in`/
 * `hover-out` fire on a pointer event against `trigger.nodeId` (or the whole
 * mounted player when `nodeId` is omitted — a component-level trigger); `in-view`
 * fires when `trigger.nodeId` (or the player's root, when omitted) crosses
 * `trigger.threshold` visibility fraction in the host viewport; `scroll-progress`
 * maps host scroll progress `0..1` onto a seek/playback range and REQUIRES exactly
 * one action (`seek` with `progress` form, or `play-clip`) — see
 * {@link InteractionDefinition}'s doc comment for that shape rule.
 */
export type InteractionTriggerKind =
	| "click"
	| "hover-in"
	| "hover-out"
	| "in-view"
	| "scroll-progress";

/**
 * Every {@link InteractionTriggerKind} literal, `satisfies`-checked so other
 * layers (the MCP wire schema) can derive their enum from this instead of
 * hand-typing a second literal list that can silently drift.
 */
export const INTERACTION_TRIGGER_KINDS = [
	"click",
	"hover-in",
	"hover-out",
	"in-view",
	"scroll-progress",
] as const satisfies readonly InteractionTriggerKind[];

/**
 * One interaction's activation condition. `nodeId` omitted means the trigger is
 * component-level (the whole mounted player, not a specific scene node) — a
 * later runtime slice fires it from a host-level event (any click inside the
 * player, the player's own viewport intersection, etc.) rather than a
 * node-scoped hit target. `threshold` is only meaningful for `"in-view"` (the
 * 0..1 visibility fraction that counts as "in view", default `0.5` when
 * omitted) and MUST be finite and within `0..1` when present — see
 * `validateInteractionTrigger` in `interactions.ts` for the enforcing check.
 */
export type InteractionTrigger = {
	readonly kind: InteractionTriggerKind;
	readonly nodeId?: string;
	readonly threshold?: number;
};

/**
 * Every {@link InteractionAction} `kind` literal, `satisfies`-checked so other
 * layers (the MCP wire schema) can derive their enum from this instead of
 * hand-typing a second literal list that can silently drift.
 */
export const INTERACTION_ACTION_KINDS = [
	"play-clip",
	"toggle-clip",
	"seek",
	"set-prop",
	"pause",
	"resume",
] as const;

export type InteractionActionKind = (typeof INTERACTION_ACTION_KINDS)[number];

/**
 * Plays an `AnimationClip` (by id, resolved against `MotionDocument.clips` — see
 * `resolveInteractionIssue` in `interactions.ts`) from its start. `direction`
 * defaults to `"forward"`; `then` describes what happens when playback reaches
 * the clip's end: `"hold"` (default semantics a later runtime slice
 * implements — freeze on the last frame) or `"reset"` (return to the clip's
 * start frame). A `clipId` that does not resolve is a WARNING, not an error —
 * see {@link InteractionDefinition}'s doc comment for why.
 */
export type InteractionActionPlayClip = {
	readonly kind: "play-clip";
	readonly clipId: string;
	readonly loop?: boolean;
	readonly direction?: "forward" | "reverse";
	readonly then?: "hold" | "reset";
};

/** Starts the clip if not already playing, or stops it if it is — the toggle counterpart to {@link InteractionActionPlayClip}. Shares its `clipId` resolution/warning contract. */
export type InteractionActionToggleClip = {
	readonly kind: "toggle-clip";
	readonly clipId: string;
	readonly loop?: boolean;
};

/**
 * Seeks the component's playback position. Exactly one of `frame` (an absolute
 * frame index, `>= 0` and finite) or `progress` (a normalized `0..1` fraction of
 * the current/target duration) must be present — see `validateInteractionAction`
 * in `interactions.ts` for the enforcing check. `scroll-progress`-triggered
 * interactions require the `progress` form specifically (see
 * {@link InteractionDefinition}'s doc comment).
 */
export type InteractionActionSeek = {
	readonly kind: "seek";
	readonly frame?: number;
	readonly progress?: number;
};

/**
 * Writes a document component prop's value (by `propName`, resolved against
 * `SceneDocument.componentProps` — see `resolveInteractionIssue` in
 * `interactions.ts`). `value`'s runtime type must match the resolved prop's
 * declared `type` when the prop currently exists (`number` value for a
 * `number` prop; `string` value for `color`/`text`) — a mismatch is an ERROR,
 * unlike an unresolved `propName`, which is a WARNING (the prop may be added
 * later; see {@link InteractionDefinition}'s doc comment).
 */
export type InteractionActionSetProp = {
	readonly kind: "set-prop";
	readonly propName: string;
	readonly value: number | string;
};

/** Pauses whatever clip(s) are currently playing on the component, with no target of its own. */
export type InteractionActionPause = { readonly kind: "pause" };

/** Resumes whatever clip(s) were paused on the component, with no target of its own. */
export type InteractionActionResume = { readonly kind: "resume" };

/** One effect an {@link InteractionDefinition}'s trigger fires. An interaction's `actions` list is non-empty (see `validateInteractionActions` in `interactions.ts`) and every action fires together when the trigger activates. */
export type InteractionAction =
	| InteractionActionPlayClip
	| InteractionActionToggleClip
	| InteractionActionSeek
	| InteractionActionSetProp
	| InteractionActionPause
	| InteractionActionResume;

/**
 * An authored trigger -> action(s) interaction (Interactive Motion program,
 * slice 1, T3-S1: document model + agent authoring only — no renderer,
 * exporter, or editor-preview consumes `SceneDocument.interactions` yet; a
 * later slice wires trigger listening and action execution into the exported
 * runtimes). `actions` must be non-empty (an interaction with a trigger but no
 * effect is a typed issue, not a silently-stored no-op).
 *
 * `trigger.kind === "scroll-progress"` is a v1-minimal, deliberately
 * constrained shape rather than a general trigger/action pairing DSL: it
 * REQUIRES `actions` to contain exactly one entry, and that entry must be
 * either `{kind: "seek", progress: ...}` (the `progress` form specifically,
 * not `frame`) or `{kind: "play-clip", ...}` — a later runtime slice maps the
 * host's `0..1` scroll fraction onto that one action's target (the seek
 * progress directly, or that clip's local `0..1` playback progress). Any other
 * `actions` shape on a `scroll-progress` trigger is a typed
 * `agent.interaction-trigger-invalid` error — see `validateInteractionTrigger`
 * in `interactions.ts`.
 *
 * Two reference kinds inside `actions`/`trigger` are ALLOW-WITH-WARNING rather
 * than hard errors, because the referenced entity may legitimately be
 * authored in a later step of the same editing session: an unresolved
 * `play-clip`/`toggle-clip` `clipId` (the clip may not exist in
 * `MotionDocument.clips` yet) and an unresolved `set-prop` `propName` (the
 * component prop may not exist in `SceneDocument.componentProps` yet) both
 * compile successfully with a WARNING-severity issue, mirroring
 * `agent.component-prop-binding-animated-conflict`'s allow-with-warning
 * precedent in `component-props.ts`. Every OTHER reference kind (a
 * `trigger.nodeId` that does not resolve in the scene, and a `set-prop` value
 * whose runtime type mismatches an EXISTING prop's declared type) is a hard
 * ERROR, since those are checkable with certainty against current document
 * state and never become valid by waiting.
 */
export type InteractionDefinition = {
	readonly id: string;
	readonly name?: string;
	readonly trigger: InteractionTrigger;
	readonly actions: readonly InteractionAction[];
};

/**
 * Reusable, document-scoped style preset. The payload is modeled as optional
 * parts rather than a single style object so one preset can describe paint,
 * typography, full appearance, or any combination. Applying a preset value-copies
 * its parts onto target nodes; presets are not live links.
 */
export type StylePreset = {
	readonly id: string;
	readonly name: string;
	readonly kind: StylePresetKind;
	/** Paint values applied to `NodeStyle`. Omitted when the preset is type-only. */
	readonly paint?: StylePresetPaint;
	/** Typography values applied to text geometry. Omitted for paint-only presets. */
	readonly typography?: StylePresetTypography;
	/**
	 * Rich appearance (fill/stroke stacks, effects, blend, stroke geometry) applied
	 * to `NodeStyle`. Omitted on legacy presets, which carry only `paint`. Captured
	 * from a node's full style so reapplying reproduces a visual-equivalent stack.
	 */
	readonly appearance?: StylePresetAppearance;
};

export type SceneDocument = {
	readonly schemaVersion: typeof SCENE_SCHEMA_VERSION;
	readonly id: string;
	readonly name: string;
	/**
	 * Legacy/default artboard. This remains required so existing documents and
	 * commands keep working while multi-artboard flows adopt `artboards`.
	 */
	readonly artboard: Artboard;
	/** Optional additive collection for multi-artboard workflows. */
	readonly artboards?: readonly Artboard[];
	/**
	 * Preferred artboard id for editor focus. Invalid or omitted ids fall back to
	 * the legacy/default artboard through selectors.
	 */
	readonly currentArtboardId?: string;
	/**
	 * Optional additive long-form composition side-car. Artboard order stays
	 * independent from sequence order; legacy documents omit this and read as not
	 * having a composed motion/video sequence yet.
	 */
	readonly sequence?: SceneSequence;
	/**
	 * Optional scene-wide vec-core intent used as the fallback frame look/mask
	 * when the current artboard does not define its own side-car.
	 */
	readonly effectIntent?: EffectIntent;
	readonly layers: readonly SceneLayer[];
	/**
	 * Optional additive library of reusable style presets. Omitted on legacy
	 * documents and treated as empty by style-preset helpers, so no migration is
	 * required for existing scenes.
	 */
	readonly stylePresets?: readonly StylePreset[];
	/**
	 * Optional additive library of reusable component sources. Existing documents
	 * omit it and read as having no component symbols; node source/instance roles
	 * stay optional on `VectorNode` for the same migration-free contract.
	 */
	readonly componentSymbols?: readonly ComponentSymbol[];
	/**
	 * Optional additive document-local asset metadata. Legacy scenes omit this and
	 * image nodes that reference missing assets render/export deterministic
	 * fallbacks instead of requiring a migration.
	 */
	readonly assets?: readonly SceneAsset[];
	/**
	 * Optional authored scene-camera rigs. Omitted documents stay purely 2D; active
	 * artboards opt into a rig through `Artboard.activeSceneCameraId`.
	 */
	readonly sceneCameras?: readonly SceneCameraRigContract[];
	/**
	 * Optional additive Codeable-Effect bindings: node recipe controls plus
	 * scene/artboard recipe or influence controls driven by a DSL expression instead
	 * of a constant. Legacy documents omit this and read as having no effect
	 * expressions, so no migration is required.
	 */
	readonly effectExpressionBindings?: readonly EffectExpressionBinding[];
	/**
	 * Optional additive Codeable-Native bindings: transform/opacity/corner geometry
	 * properties driven by the safe DSL at presentation/export time. Omitted on
	 * legacy documents and treated as empty.
	 */
	readonly nativeExpressionBindings?: readonly NativeExpressionBinding[];
	/**
	 * Optional additive Codeable-Duplicate generators: parametric expansions of one
	 * source node into presentation-only instances. Omitted on legacy documents and
	 * treated as empty by the generator helpers.
	 */
	readonly duplicateGenerators?: readonly DuplicateGeneratorBinding[];
	/**
	 * Optional additive library of host-settable Motion Component export props.
	 * Omitted on legacy documents and treated as empty by `component-props.ts`
	 * helpers, so no migration is required. Export/runtime and Inspector shared
	 * colors consume this exact library through typed binding compilation.
	 */
	readonly componentProps?: readonly ComponentPropDefinition[];
	/**
	 * Optional additive library of authored trigger -> action interactions
	 * (Interactive Motion program, T3-S1: document model + agent authoring only
	 * — see {@link InteractionDefinition}). Omitted on legacy documents and
	 * treated as empty by `interactions.ts` helpers, so no migration is
	 * required. No renderer/exporter/runtime consumes this yet — a later slice
	 * wires trigger listening and action execution into the exported runtimes.
	 */
	readonly interactions?: readonly InteractionDefinition[];
	/** Optional frozen A/B seats for Arrangement correspondence; legacy scenes omit it. */
	readonly arrangementLayoutSnapshots?: readonly ArrangementLayoutSnapshot[];
	/**
	 * Optional additive minimal audio lane (S5a). Frame-anchored placements of
	 * `AudioAsset` entries in `assets`; never a node, never wall-clock-scheduled.
	 * Omitted on legacy documents and treated as empty by audio helpers.
	 */
	readonly audioTracks?: readonly AudioTrack[];
};

export const IDENTITY_TRANSFORM: Transform = {
	position: { x: 0, y: 0 },
	rotation: 0,
	scale: { x: 1, y: 1 },
	anchor: { x: 0, y: 0 },
};
