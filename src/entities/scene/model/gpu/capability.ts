/**
 * GPU-artboard capability predicate (E1 S2/S3/S5/S7 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D1). Pure and DOM-free: this module
 * decides, for the COMMITTED scene+motion documents (plus a precomputed
 * committed-grammar-opacity summary — see `computeGpuArtboardSupport`'s doc
 * comment) only, whether an artboard qualifies for GPU rendering this slice
 * (solid/gradient/image fills, mesh paints, legacy uniform strokes, E0
 * width-profile strokes, placed image nodes, single-level hard clip-path
 * masks, effect-free geometry) or must stay on the SVG fallback. Never called
 * with live-drag overrides or a motion-sampled presentation document —
 * evaluating on anything but the committed documents would let a
 * transform-only drag or a scrub tick flip an artboard's render path
 * mid-gesture (D1's "no-flap" rule).
 *
 * A reason token is a stable, snake_case string identifying WHY a node failed;
 * `GpuArtboardSupport.reasons` collects the deduped set of tokens across every
 * node in the artboard, for the dev-only console diagnostic in
 * `CanvasShell.tsx`. Tokens are not localized/user-facing.
 *
 * S5 note: mesh-paint and image-paint RASTER/TEXTURE availability (whether the
 * bitmap has actually been decoded/uploaded yet) is a runtime pop-in timing
 * concern for the widget-layer texture cache (`shared/gpu/texture-cache.ts`),
 * never a capability-predicate concern here — this predicate only checks
 * STRUCTURAL admissibility (a resolvable asset/href, a supported `fit`, no
 * paint-level `transform`), matching how S2/S3 never re-check "has this
 * gradient's stencil geometry been flattened yet" either.
 *
 * S7 note: a masked content node is admitted only for a SINGLE, `mode:
 * "clip"` application (see `"mask"`'s own doc comment below and
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7 decisions) — an admitted
 * silhouette source node's own geometry/paint/effect facets are never
 * checked at all (it never paints as ordinary content, so its own quirks
 * cannot fail an otherwise-clean artboard), matching how S5's texture
 * timing note above already treats "will this actually draw" as orthogonal
 * to "is this structurally admissible."
 */

import type { MotionDocument } from "@/entities/motion/model/types";
import {
	effectFilterBoundsForNode,
	hasSubtreeCarrier,
	isWrapperContainer,
} from "@/entities/scene/model/appearance-targets";
import {
	imagePaintHref,
	imagePlacementForNode,
} from "@/entities/scene/model/assets";
import { canvasPaintsForStyle } from "@/entities/scene/model/canvas-paint";
import {
	rectNeedsBakedPath,
	resolveCornerRadii,
	shapeNeedsBakedPath,
} from "@/entities/scene/model/corner-geometry";
import { compileEffectFieldRoutes } from "@/entities/scene/model/effect-field-routing";
import { buildEffectFilter } from "@/entities/scene/model/effect-filter";
import {
	explicitFrameFilmLookGraphRecipe,
	frameGpuFilmPostEffectParams,
	frameVisualRecipeCanRenderVisibly,
} from "@/entities/scene/model/frame-look-visibility";
import {
	gpuKnownOpaqueImageBackgroundHref,
	gpuMeshBackgroundUsesOpaqueRaster,
} from "@/entities/scene/model/gpu/background-paint";
import { normalizeDashPattern } from "@/entities/scene/model/gpu/display-list";
import {
	compileLookGraph,
	lookGraphPlanToEffectFilter,
} from "@/entities/scene/model/look-graph-compile";
import {
	maskApplicationUsesHardSilhouette,
	resolveSceneMaskPlan,
} from "@/entities/scene/model/mask-render";
import {
	resolveFrameEffectIntent,
	resolveNodeRecipe,
} from "@/entities/scene/model/recipe-resolve";
import {
	boundsUnderMatrix,
	composeMatrix,
	getGeometryBounds,
	getNodeLocalPaintBounds,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { scopedLookGraphOverlays } from "@/entities/scene/model/scoped-look-graph-overlay";
import type {
	NodeArtboardMapping,
	NormalizedArtboard,
} from "@/entities/scene/model/selectors";
import {
	selectAllArtboards,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import { buildSourceOpticsPresentation } from "@/entities/scene/model/source-optics";
import { getStrokeWidthProfileOutline } from "@/entities/scene/model/stroke-outline";
import type {
	ResolvedImageReferencePaint,
	ResolvedPaint,
} from "@/entities/scene/model/style-resolve";
import {
	resolveNodeStyle,
	resolvePaints,
} from "@/entities/scene/model/style-resolve";
import { normalizeTextGeometry } from "@/entities/scene/model/text-geometry";
import type {
	Artboard,
	BezierShape,
	BlendMode,
	Bounds,
	SceneAsset,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { hexToRgb } from "@/shared/color";
import type { GpuBlendMode } from "@/shared/gpu/types";
import {
	MAX_DASH_PATTERN_ENTRIES,
	MAX_GRADIENT_STOPS,
} from "@/shared/gpu/types";

/** Stable, snake_case failure token — see this module's doc comment. */
export type GpuCapabilityReason =
	/** A text node outside the S9.0 static text-raster envelope. */
	| "text"
	| "carrier_opacity"
	| "mesh_paint"
	| "blend_mode"
	| "image"
	| "filter_or_look"
	/** Source Optics exists but uses an owner arrangement the native effect-island path cannot execute atomically. */
	| "source_optics_feature"
	/**
	 * A masked content node or a consumed mask-source node whose relation is
	 * NOT the single-application hard-silhouette subset E1 S7/S30 admits (see
	 * `docs/gpu-canvas-convergence-e1-plan.md`'s S7/S30 decisions) — a soft
	 * alpha-mask (`mode: "alpha-mask"` with feather/opacity/expand/invert), a
	 * content node with more than one mask application, a chained mask, or a
	 * source consumed by any non-admitted relation elsewhere in the document. A
	 * single-application hard clip-path relation or hard alpha-mask is instead represented via
	 * `display-list.ts`'s `clip-begin`/`clip-end` stencil scope and does NOT
	 * emit this token for either the content node or its silhouette source.
	 */
	| "mask"
	| "multi_paint"
	| "translucent_background"
	| "unsupported_geometry"
	| "unparsable_fill"
	| "unparsable_stroke"
	| "animated_carrier_opacity"
	| "grammar_carrier_opacity"
	/** Stroke paint is a mesh paint server; solid, linear/radial gradient, and image-reference uniform strokes are GPU-supported inside their feature envelopes. */
	| "stroke_paint"
	/**
	 * A non-empty `strokeDash` pattern outside the S8 GPU dash envelope: a
	 * non-butt cap, more entries than `MAX_DASH_PATTERN_ENTRIES`, or geometry
	 * outside the current straight-contour envelope (an un-rounded
	 * native-`<rect>` fast path, `line`, straight `path`, or sharp
	 * `polygon`/`star`; see `isDashableGeometry`'s doc comment for the exact
	 * gate and the curved-geometry exclusion).
	 * Renamed from S2's blanket `"dash"` token now that solid uniform strokes
	 * are otherwise supported.
	 */
	| "stroke_dash"
	/** A gradient fill/stroke has a stop count outside `1..MAX_GRADIENT_STOPS` (the cover shader's fixed uniform-array capacity). */
	| "gradient_stops"
	/** A gradient fill/stroke uses a feature outside the S3/S24 envelope (a paint-level `transform` matrix — see `docs/gpu-canvas-convergence-e1-plan.md`'s gradient decisions). */
	| "gradient_feature"
	/** A mesh-gradient fill uses a paint-level `transform` matrix; the S5 mesh-raster bridge places the rasterized mesh over `meshBounds` but does not model SVG `patternTransform`. */
	| "mesh_feature"
	/** Node opacity (or an animated/grammar-driven leaf opacity) composites over a LEAF's own combined fill+stroke paint, which SVG renders as one group-opacity unit the GPU cannot yet reproduce without double-darkening the overlap — see the long comment above this token's emission site in `nodeCapabilityReasons`. */
	| "combined_paint_opacity"
	/** An image fill/placed-image node references an asset (or inline href) that does not resolve to a usable href — `hrefForImageAsset`/`imagePaintHref` returned nothing (missing asset, empty source, unsupported video-frame asset). Distinct from the pre-S5 blanket `"image"` token, which is now unreachable for `kind: "image"` geometry (folded into `SUPPORTED_GEOMETRY_KINDS`) and for image-reference fill paints (folded into `gradientOrPaintReasons`'s image branch) — it remains defined only so old console-log snapshots/tests referencing it are not silently reinterpreted. */
	| "image_asset"
	/** An image fill/stroke uses a feature outside the image envelope: a singular paint-level `transform` matrix, `fit: "tile"` (no wrap-sampling in the cover shader), or a degenerate object-bounding-box stroke paint — see `docs/gpu-canvas-convergence-e1-plan.md`'s S5/S21/S22/S25/S33 decisions. */
	| "image_feature"
	/**
	 * A non-`"normal"` `blendMode` (E1 S6/S31) on a node outside the five
	 * fixed-function-representable modes (`multiply`/`screen`/`darken`/
	 * `lighten`/`exclusion` — see `shared/gpu/types.ts::GpuBlendMode`'s doc comment), OR on
	 * a carrier (a wrapper container or any node with children — SVG blends
	 * the whole composited SUBTREE as one unit, which the GPU's per-leaf draw
	 * list cannot reproduce). Distinct from `"blend_mode_feature"`, which
	 * covers the five admitted modes failing a NARROWER per-leaf gate — see
	 * `docs/gpu-canvas-convergence-e1-plan.md`'s S6/S31 decisions for the full
	 * gate list.
	 */
	| "blend_mode_feature";

export type GpuArtboardSupport = {
	readonly supported: boolean;
	readonly reasons: readonly GpuCapabilityReason[];
};

/**
 * Geometry kinds S2's display-list compiler can normalize to path contours.
 * `"line"` (E1 S12) is admitted only as stroke geometry; visible line fills
 * are kept on SVG because SVG ignores `fill` on `<line>` while the GPU fill
 * path would otherwise treat it as area paint. `"polygon"`/`"star"` (E1 S11)
 * route through corner-geometry's filleted
 * polygon SSOT, matching the SVG renderer's native `<polygon>` vs baked
 * rounded-`<path>` split without introducing a new GPU primitive.
 * `"image"` (E1 S5) is a plain axis-aligned rect placement — the display-list
 * compiler builds its contour the same way it already does for `"rect"`
 * (`buildRoundedRectShape` with zero radii) — so it joins this set alongside
 * the SAME structural checks every other geometry kind gets; whether an image
 * node's ASSET actually resolves is a separate, per-node check (the
 * `node.geometry.kind === "image"` branch inside {@link nodeCapabilityReasons}),
 * not a geometry-kind gate.
 */
const SUPPORTED_GEOMETRY_KINDS: ReadonlySet<VectorNode["geometry"]["kind"]> =
	new Set([
		"rect",
		"ellipse",
		"path",
		"polygon",
		"star",
		"line",
		"image",
		"text",
	]);

/**
 * True when an enabled text animator targets `nodeId`. Kept inline rather than
 * importing `entities/motion/model/text-animator.ts`: this scene-layer
 * predicate may type-import `MotionDocument`, but value-importing a higher-rank
 * motion module would violate `check:arch`'s scene→motion boundary.
 */
function hasActiveTextAnimator(
	motion: MotionDocument,
	nodeId: string,
): boolean {
	return (
		motion.textAnimators?.some(
			(binding) => binding.enabled && binding.target.nodeId === nodeId,
		) ?? false
	);
}

/**
 * True when every vertex of `shape` has all-zero in/out tangents — i.e. the
 * contour is a plain polyline with no Bézier curvature anywhere along it.
 * `[0, 0]` is the codebase's exact (not epsilon) zero-tangent convention for
 * an authored/generated straight polyline (see `gpu-stress-scene.ts`'s
 * `straightBezierShape` and `corner-geometry.ts`'s baked-corner builders,
 * which both author literal `[0, 0]` for straight vertices) — comparing for
 * exact zero is correct and matches how straight geometry is actually
 * produced, no tolerance needed.
 */
function isStraightBezierShape(shape: BezierShape): boolean {
	return (
		shape.inTangents.every(([x, y]) => x === 0 && y === 0) &&
		shape.outTangents.every(([x, y]) => x === 0 && y === 0)
	);
}

/**
 * True when `geometry`'s rendered OUTLINE is entirely straight edges. This
 * was E1 S8's original dash-admission envelope; it is now a NECESSARY but no
 * longer SUFFICIENT condition — {@link isDashableGeometry} below is what the
 * dash gate actually calls — kept as its own documented predicate (rather
 * than deleted or inlined) because it is still the correct test for "has no
 * curvature to flatten," the reason curved geometry can never dash on the
 * GPU surface (see that reason in {@link isDashableGeometry}'s doc comment).
 *
 * `rect`/`polygon`/`star` are straight iff their corner treatment resolves
 * to zero rounding (`resolveCornerRadii`/`shapeNeedsBakedPath`'s existing
 * SSOT corner resolvers — reused rather than re-deriving corner logic here).
 * `line` has no curve concept at all (two endpoints), so it is always
 * straight. `ellipse` is always curved. `path` defers to
 * {@link isStraightBezierShape} over its outer shape and every subpath
 * (hole) — ALL contours must be straight, not just the outer one.
 *
 * `polygon`/`star` are straight only on the same sharp branch where the live
 * renderer emits native `<polygon>` using the identical first-vertex order that
 * `filletPolygonShape(..., 0)` and `starVertices(...)` feed into the GPU closed
 * contour. `line` has one native segment and one GPU open contour with the same
 * start endpoint.
 */
function isStraightSegmentGeometry(geometry: VectorNode["geometry"]): boolean {
	switch (geometry.kind) {
		case "rect": {
			const radii = resolveCornerRadii(geometry);
			return (
				radii.tl === 0 && radii.tr === 0 && radii.br === 0 && radii.bl === 0
			);
		}
		case "polygon":
		case "star":
			return !shapeNeedsBakedPath(geometry);
		case "line":
			return true;
		case "path":
			return (
				isStraightBezierShape(geometry.shape) &&
				(geometry.subpaths ?? []).every(isStraightBezierShape)
			);
		default:
			return false;
	}
}

/**
 * True when `geometry` is admitted into the E1 S8+ GPU dash envelope — the
 * predicate the `"stroke_dash"` gate in {@link nodeCapabilityReasons} actually
 * calls. The post-S8 path-parity fix removed the live SVG renderer's
 * hardcoded round cap/join for `path`, so a BUTT-capped straight `path` can now
 * use the same fragment-time dash discard as an un-rounded native-`<rect>`
 * outline. Curved geometry still stays out: the GPU mesh dashes by flattened
 * chord length from the flattened ring's own start, while SVG dashes native
 * curves by true analytic arc length from the curve's canonical start.
 *
 * Rects additionally require `!rectNeedsBakedPath`, not just zero radii:
 * `cornerSmoothing > 0` on a zero-radius rect still forces the live canvas's
 * baked-`<path>` branch, so the dash gate mirrors the renderer's own native
 * `<rect>` fast-path predicate exactly. Sharp polygon/star geometry shares
 * the straight-path dash contract: the SVG renderer emits one native
 * `<polygon>` whose point order is the same order the GPU closed contour uses,
 * so the dash phase starts at the same vertex and accumulates the same straight
 * segment lengths. Rounded polygon/star geometry remains excluded because it
 * bakes to a curved `<path>`.
 */
function isDashableGeometry(geometry: VectorNode["geometry"]): boolean {
	switch (geometry.kind) {
		case "rect":
			return (
				isStraightSegmentGeometry(geometry) && !rectNeedsBakedPath(geometry)
			);
		case "path":
		case "line":
		case "polygon":
		case "star":
			return isStraightSegmentGeometry(geometry);
		default:
			return false;
	}
}

/**
 * {@link BlendMode} values fixed-function-representable on the GPU cover
 * pipeline (E1 S6/S31 — see `shared/gpu/types.ts::GpuBlendMode`'s doc comment for
 * the exact `GPUBlendState` each maps to). A `BlendMode` string outside this
 * set fails gate (a) in {@link nodeCapabilityReasons} unconditionally.
 */
const FIXED_FUNCTION_BLEND_MODES: ReadonlySet<BlendMode> = new Set([
	"multiply",
	"screen",
	"darken",
	"lighten",
	"exclusion",
] satisfies readonly GpuBlendMode[]);

/**
 * Reports every capability failure a single node contributes. The caller
 * (`computeGpuArtboardSupport`) invokes this once per node in the artboard's
 * already-flattened `byArtboardId` list — see that function's doc comment for
 * why this does NOT recurse into `.children` itself. A wrapper container
 * (group/Blend) has a degenerate own-geometry placeholder that is never
 * actually painted — see `isWrapperContainer`'s doc — so its own paint/geometry
 * is not checked here; only carrier-opacity and effect/look/mask targeting
 * apply to it, exactly the facets that DO composite over its subtree.
 */
function nodeCapabilityReasons(
	node: VectorNode,
	scopedLookGraphTargetIds: ReadonlySet<string>,
	maskedNodeIds: ReadonlySet<string>,
	motion: MotionDocument,
	grammarOpacityNodeIds: ReadonlySet<string>,
	resolveImageHref: (paint: ResolvedImageReferencePaint) => string | undefined,
): readonly GpuCapabilityReason[] {
	const reasons = new Set<GpuCapabilityReason>();

	if (maskedNodeIds.has(node.id)) reasons.add("mask");
	if (scopedLookGraphTargetIds.has(node.id)) reasons.add("filter_or_look");

	const style = node.style;
	const resolvedStyle = resolveNodeStyle(style);
	const recipe = resolveNodeRecipe(node);
	if (resolvedStyle.effects.length > 0 || recipe) {
		const effectFilterSpec = buildEffectFilter(
			node.id,
			resolvedStyle.effects,
			effectFilterBoundsForNode(node),
			resolvedStyle.strokeWidth,
			recipe,
		);
		if (effectFilterSpec) reasons.add("filter_or_look");
	}

	// Whether a committed keyframe track or committed grammar binding can drive
	// THIS node's opacity below 1 at some sampled frame — shared by both the
	// carrier-opacity checks below (unchanged from S2) and the new leaf-level
	// `combined_paint_opacity` check (S3): a leaf's fill+stroke composite is
	// exactly as GPU-unrepresentable under an ANIMATED sub-unity opacity as
	// under a static one, since either way SVG composites the pair under one
	// implicit group-opacity unit at render time.
	//
	// Inlined equivalent of `entities/motion/model/sampler.ts::findTrack` (that
	// module cannot be imported at the value level here: `check:arch` ranks
	// `entities/scene` strictly below `entities/motion`, and this is the one
	// motion-aware fact this otherwise scene-only predicate needs — see this
	// module's doc comment). `MotionDocument`/`KeyframeTrack`'s TYPE import
	// above is exempt from that rank check (type-only imports erase at build
	// time and create no runtime dependency).
	const opacityTrack = motion.tracks.find(
		(track) =>
			track.target.nodeId === node.id && track.target.property === "opacity",
	);
	const hasSubUnityKeyframe = (opacityTrack?.keyframes ?? []).some(
		(keyframe) => typeof keyframe.value === "number" && keyframe.value < 1,
	);
	// A committed motion-grammar binding can drive an opacity-like channel
	// (`opacity`/`opacity-factor`) at SAMPLE time with no committed keyframe
	// track at all — `motion.tracks` above never sees it. `grammarOpacityNodeIds`
	// is a precomputed summary (see `gpu-grammar-opacity.ts`'s doc comment for
	// why this predicate cannot import `entities/motion-grammar` directly) of
	// every node id a committed binding targets with an opacity-driving
	// technique.
	const hasGrammarDrivenOpacity = grammarOpacityNodeIds.has(node.id);
	const canGoSubUnity =
		node.style.opacity !== 1 || hasSubUnityKeyframe || hasGrammarDrivenOpacity;

	if (hasSubtreeCarrier(node)) {
		if (node.style.opacity !== 1) reasons.add("carrier_opacity");
		if (hasSubUnityKeyframe) reasons.add("animated_carrier_opacity");
		if (hasGrammarDrivenOpacity) reasons.add("grammar_carrier_opacity");
	}

	// E1 S6/S31 blend-mode gates (a)/(b) — evaluated for EVERY node, carrier or
	// leaf, so this sits above the `isWrapperContainer` early return below (a
	// carrier's blend mode still needs gate (b) even though its own paint is
	// never otherwise checked). See `docs/gpu-canvas-convergence-e1-plan.md`'s
	// S6/S31 decisions for the full gate list; gates (c)/(e) are leaf-only and are
	// evaluated further down, once this leaf's resolved paint is known.
	const resolvedBlendMode = resolveNodeStyle(node.style).blendMode;
	const isFixedFunctionBlendMode =
		FIXED_FUNCTION_BLEND_MODES.has(resolvedBlendMode);
	if (resolvedBlendMode !== "normal") {
		if (!isFixedFunctionBlendMode) {
			// Gate (a): outside the fixed-function-representable modes.
			reasons.add("blend_mode");
		} else if (isWrapperContainer(node) || hasSubtreeCarrier(node)) {
			// Gate (b): SVG composites a carrier's whole SUBTREE then blends the
			// result as one unit; the GPU's per-leaf draw list has no equivalent
			// "blend the composited subtree" operation.
			reasons.add("blend_mode_feature");
		}
	}

	if (isWrapperContainer(node)) return [...reasons];

	if (!SUPPORTED_GEOMETRY_KINDS.has(node.geometry.kind)) {
		reasons.add("unsupported_geometry");
	}
	if (node.geometry.kind === "image") {
		const placement = imagePlacementForNode(node);
		// A placed image node's href resolves through the SAME asset lookup
		// `PlacedImageNode` in `CanvasShell.tsx` uses (`hrefForImageAsset` off
		// the document's asset library) — `resolveImageHref` closes over
		// `document.assets`, built once in `computeGpuArtboardSupport` (see its
		// doc comment), and this reuses that SAME closure rather than a second
		// lookup helper. `fit`/`opacity` are irrelevant to href resolution, so
		// placeholder values are fine here.
		const resolvedHref = resolveImageHref({
			kind: "image-reference",
			assetId: placement?.assetId,
			fit: "fill",
			opacity: 1,
		});
		if (!resolvedHref) reasons.add("image_asset");
	}

	// E1 S8: a non-empty `strokeDash` is admitted only for a BUTT-capped stroke
	// (round/square dash caps are per-dash-segment geometry the fragment-time
	// discard approach cannot reproduce) whose SVG-normalized (odd-length
	// doubled — see `normalizeDashPattern`) pattern is no longer than
	// `MAX_DASH_PATTERN_ENTRIES` (the WGSL fragment shader's fixed uniform-array
	// capacity, mirroring `"gradient_stops"`'s identical too-many-entries
	// pattern) — see `docs/gpu-canvas-convergence-e1-plan.md`'s S8 decisions —
	// AND on the current straight-contour geometry envelope (see
	// {@link isDashableGeometry}'s doc comment). Every other dashed stroke
	// (round/square cap, too many entries, a rounded/smoothed rect, curved
	// geometry, or a still-unsupported geometry kind) keeps failing via
	// `"stroke_dash"`.
	if (resolvedStyle.strokeDash.length > 0) {
		const normalizedDashLength = normalizeDashPattern(
			resolvedStyle.strokeDash,
		).length;
		const isAdmittedDash =
			resolvedStyle.strokeCap === "butt" &&
			normalizedDashLength <= MAX_DASH_PATTERN_ENTRIES &&
			isDashableGeometry(node.geometry);
		if (!isAdmittedDash) reasons.add("stroke_dash");
	}

	const fillCount = resolvedStyle.fills.length;
	const strokeCount = resolvedStyle.strokes.length;
	if (fillCount > 1 || strokeCount > 1) reasons.add("multi_paint");

	const { fill, stroke } = canvasPaintsForStyle(
		resolvedStyle,
		"gpu-capability",
		resolveImageHref,
	);
	if (node.geometry.kind === "line" && fill.value !== "none") {
		reasons.add("unsupported_geometry");
	}
	const hasUniformStroke =
		stroke.value !== "none" && resolvedStyle.strokeWidth > 0;
	const profileOutline = getStrokeWidthProfileOutline(node);

	if (node.geometry.kind === "text") {
		const hasVisibleTextFill = fill.value !== "none";
		const leadingTextFillPaint = resolvedStyle.fills[0];
		const textImageFillSupported =
			fill.def?.kind === "image" &&
			leadingTextFillPaint?.kind === "image-reference" &&
			leadingTextFillPaint.fit !== "tile" &&
			!leadingTextFillPaint.transform;
		const textMeshFillSupported =
			leadingTextFillPaint?.kind === "mesh-gradient" &&
			!leadingTextFillPaint.transform;
		const textFallbackSolidSupported =
			!fill.def &&
			hexToRgb(fill.value) !== null &&
			leadingTextFillPaint?.kind !== "mesh-gradient";
		const textFillSupported =
			!hasVisibleTextFill ||
			textFallbackSolidSupported ||
			fill.def?.kind === "linear" ||
			fill.def?.kind === "radial" ||
			textImageFillSupported ||
			textMeshFillSupported;
		const textStrokePaintSupported = (() => {
			if (!hasUniformStroke) return true;
			if (profileOutline) return false;
			if (resolvedStyle.strokeDash.length > 0) return false;
			if (resolvedStyle.strokeBlurRadius > 0) return false;
			if (normalizeTextGeometry(node.geometry).style.underline) return false;
			if (!stroke.def) return hexToRgb(stroke.value) !== null;
			if (stroke.def.kind !== "linear" && stroke.def.kind !== "radial") {
				return false;
			}
			return (
				gradientOrPaintReasons(stroke.def, resolvedStyle.strokes[0]).length ===
				0
			);
		})();
		const textStrokeSupported = !profileOutline && textStrokePaintSupported;
		const textBlendSupported =
			resolvedStyle.blendMode === "normal" ||
			resolvedStyle.blendMode === "multiply" ||
			resolvedStyle.blendMode === "screen" ||
			resolvedStyle.blendMode === "exclusion";
		const isStaticText = !hasActiveTextAnimator(motion, node.id);
		if (
			!textFillSupported ||
			!textStrokeSupported ||
			!isStaticText ||
			!textBlendSupported
		) {
			reasons.add("text");
		}
	}

	if (fill.value !== "none") {
		const leadingFillPaint = resolvedStyle.fills[0];
		if (
			leadingFillPaint?.kind === "mesh-gradient" &&
			leadingFillPaint.transform
		) {
			reasons.add("mesh_feature");
		}
		if (fill.def) {
			// `fill.def` only exists once `resolveImageHref` (for an image paint)
			// or a non-empty stop list (for a gradient) already succeeded — see
			// `canvasPaint`'s doc comment. The RAW resolved paint (not the
			// SVG-string-encoded `fill.def`) is what carries `fit`/`transform` as
			// plain values, mirroring `buildFillPaint`'s identical "read
			// `resolvedStyle.fills[0]` alongside the resolved `CanvasPaint`"
			// pattern in `display-list.ts`.
			for (const reason of gradientOrPaintReasons(fill.def, leadingFillPaint)) {
				reasons.add(reason);
			}
		} else if (!hexToRgb(fill.value)) {
			reasons.add("unparsable_fill");
		}
	}

	// A profile outline REPLACES the uniform-stroke render entirely (see
	// `getStrokeWidthProfileOutline`'s doc and `VectorShape`'s render branch in
	// `CanvasShell.tsx`) — when active, the node's own `stroke`/`strokeWidth`
	// resolution is irrelevant (the SVG renderer never reads it in that
	// branch), so only the outline's OWN paint (the raw legacy `style.stroke`
	// color, always solid — `expandStrokeWidthProfile` has no gradient/image
	// concept) needs a capability check.
	if (profileOutline) {
		if (!hexToRgb(style.stroke)) reasons.add("unparsable_stroke");
	} else if (hasUniformStroke) {
		if (stroke.def) {
			const leadingStrokePaint = resolvedStyle.strokes[0];
			for (const reason of strokePaintReasons(
				stroke.def,
				leadingStrokePaint,
				getGeometryBounds(node.geometry),
			)) {
				reasons.add(reason);
			}
		} else if (!hexToRgb(stroke.value)) {
			reasons.add("unparsable_stroke");
		}
	}

	// A leaf (non-carrier — carriers are handled entirely above) whose own
	// paint is a fill PLUS a stroke-equivalent (uniform stroke or E0 outline)
	// renders, in every SVG/canvas surface, as ONE element (or one `paint`
	// group) whose `opacity` composites the COMBINED fill+stroke result as a
	// unit (see `VectorShape`'s single-`<path>` fast path in `CanvasShell.tsx`,
	// which sets one `opacity` attribute alongside both `fill` and `stroke` on
	// the SAME element — the browser's native equivalent of the `StackedVector
	// Shape`/subtree-carrier `<g opacity>` wrapper). The GPU display-list
	// compiler instead emits the fill and stroke as two SEPARATE draws, each
	// independently alpha-blended — mathematically equivalent to the SVG
	// semantics ONLY when opacity is exactly 1 (nothing to double-composite)
	// or when only one of the two paints is visible (S2's existing multiply-
	// through safety net, still correct for a fill-only or stroke-only leaf).
	// Once BOTH are visible and opacity can go below 1 (statically, via a
	// committed keyframe, or via a committed grammar binding), the stroke's
	// own half-width band overlaps the fill along the shape's boundary, and
	// two independently-blended sub-unity-alpha draws darken that overlap more
	// than one unit composite would — so this case fails GPU capability
	// entirely, matching `carrier_opacity`'s established precedent one level
	// down (leaf, not subtree).
	const hasVisibleFill = fill.value !== "none";
	const hasVisibleStrokeEquivalent =
		Boolean(profileOutline) || hasUniformStroke;
	if (hasVisibleFill && hasVisibleStrokeEquivalent && canGoSubUnity) {
		reasons.add("combined_paint_opacity");
	}

	// E1 S6/S31 blend-mode gates (c)/(e) — leaf-only, narrower than gate (b) above:
	// these fire only for a leaf whose blend mode IS one of the five
	// fixed-function-representable modes but whose own paint shape still
	// breaks the per-draw blend equivalence. See
	// `docs/gpu-canvas-convergence-e1-plan.md`'s S6/S31 decisions for the exact
	// math each gate protects.
	if (resolvedBlendMode !== "normal" && isFixedFunctionBlendMode) {
		// Gate (c): admitted leaf shapes are fill-only or E0-outline-only.
		// - A leaf with BOTH a visible fill AND a visible stroke-equivalent (a
		//   uniform stroke OR an E0 outline) would double-blend the overlap
		//   band if fill and stroke were each blended as separate draws — SVG
		//   blends the fill+stroke composite as ONE unit.
		// - A uniform (non-scaling) stroke is EXCLUDED even when it is the
		//   leaf's only visible paint (`hasUniformStroke` already implies
		//   `hasVisibleStrokeEquivalent`): unlike an E0 outline (a fixed
		//   WORLD-space contour), a uniform stroke's rendered width is
		//   screen-constant, so its WORLD-space reach — and therefore whether
		//   it stays inside the artboard rect for gate (d) — changes with
		//   zoom, which this capability predicate (evaluated once on the
		//   committed document, not per-frame) cannot express.
		if (hasUniformStroke || (hasVisibleFill && hasVisibleStrokeEquivalent)) {
			reasons.add("blend_mode_feature");
		}

		// Gate (d): the leaf's committed WORLD paint bounds must be fully
		// inside its artboard rect (SVG does not clip plain artboards, so an
		// overhanging blended node would blend against the page outside the
		// artboard, where the GPU has no backdrop). NOT checked here — this
		// function only reports whether a leaf survived gates (a)/(b)/(c)/(e);
		// gate (d) itself runs as a separate, LAZY pass in
		// {@link computeGpuArtboardSupport} (see {@link blendOverhangReasons}),
		// only for artboards that actually have a blend-eligible leaf, since it
		// needs a per-node world-transform accumulator this flat, ancestry-free
		// per-node function has no way to build on its own.

		// Gate (e): darken/lighten additionally require the leaf's single
		// visible paint (by this point, thanks to gate (c) above, always
		// either a fill-only or an E0-outline-only leaf) to be an opaque solid
		// — spatially varying alpha (gradient/image/mesh), or any alpha < 1,
		// breaks the min/max-over-opaque-backdrop equivalence (see
		// `shared/gpu/types.ts::GpuBlendMode`'s doc comment). `exclusion` is
		// intentionally not included here: like multiply/screen, its
		// fixed-function equation is exact for any source alpha over the opaque
		// artboard backdrop. An E0 outline is
		// always solid-colored (`buildOutlineEntry` never resolves a
		// gradient/image outline) at `overallOpacity` — i.e. exactly
		// `!canGoSubUnity`, the same static/keyframe/grammar opacity summary
		// already computed above — so both leaf shapes share one check.
		if (resolvedBlendMode === "darken" || resolvedBlendMode === "lighten") {
			const leadingFillPaint = resolvedStyle.fills[0];
			const isOpaqueSolidFill =
				leadingFillPaint?.kind === "solid" &&
				!canGoSubUnity &&
				fill.opacity === 1;
			const isOpaqueOutlineOnly = Boolean(profileOutline) && !canGoSubUnity;
			const isOpaqueSolidLeaf = hasVisibleFill
				? isOpaqueSolidFill
				: isOpaqueOutlineOnly;
			if (!isOpaqueSolidLeaf) {
				reasons.add("blend_mode_feature");
			}
		}
	}

	return [...reasons];
}

/**
 * Capability reasons for one fill's paint-def (gradient/image/mesh) — an empty
 * array when the def is fully supported. A gradient's own `stops`/`transform`
 * fields, when out of the S3 envelope, degrade to a reason token rather than
 * an approximation (fail closed, per `docs/gpu-canvas-convergence-e1-plan.md`'s
 * gradient decisions); every stop's color must independently parse as hex —
 * an unparsable stop is the SAME failure class as an unparsable solid fill.
 *
 * `leadingPaint` is the RAW resolved paint `def` was built from (needed for
 * `fit`/`transform`, which `def` — the SVG-string-encoded `CanvasImageDef` —
 * does not carry as plain values); it is only ever read for `def.kind ===
 * "image"`, mirroring `buildFillPaint`'s identical pattern in
 * `display-list.ts`.
 *
 * Mesh (E1 S5): a mesh def only ever reaches here once `href`/`dataUrl`
 * resolution already happened upstream in `canvasPaint` (an unresolved mesh —
 * no rasterized bitmap yet — degrades to `def: null` there, the SAME "not yet
 * resolved" shape an image paint takes before its href resolves), so a mesh
 * `def` here is ALWAYS a structurally admissible mesh — raster pop-in is a
 * runtime timing concern for the frame builder's texture cache, never a
 * capability-predicate concern (see `docs/gpu-canvas-convergence-e1-plan.md`'s
 * S5 decisions).
 *
 * Image (E1 S5/S21/S33): admitted unless it uses a singular paint-level
 * `transform` or `fit: "tile"` (the cover shader has no wrap-sampling).
 * S21's shader handles centered `fit`/`crop`; S33 composes non-singular
 * pattern transforms into the frame builder's `worldToLocal` matrix.
 */
type GpuCanvasPaintDef = NonNullable<
	ReturnType<typeof canvasPaintsForStyle>["fill"]["def"]
>;

function gradientOrPaintReasons(
	def: GpuCanvasPaintDef,
	leadingPaint: ResolvedPaint | undefined,
): readonly GpuCapabilityReason[] {
	if (def.kind === "mesh") return [];
	if (def.kind === "image") {
		const reasons: GpuCapabilityReason[] = [];
		const fit =
			leadingPaint?.kind === "image-reference" ? leadingPaint.fit : "fill";
		const transform =
			leadingPaint?.kind === "image-reference"
				? leadingPaint.transform
				: undefined;
		if (transform && !invertMatrix(transform)) reasons.push("image_feature");
		if (fit === "tile") reasons.push("image_feature");
		return reasons;
	}
	// def.kind === "linear" | "radial"
	const reasons: GpuCapabilityReason[] = [];
	if (def.transform) reasons.push("gradient_feature");
	// An empty `stops` array is as GPU-unrepresentable as too many: the cover
	// shader's `writeQuadUniforms` (`webgpu.ts`) always writes at least
	// `paint.stops[0]`'s offset/color unconditionally when `paint.kind !==
	// "solid"` — a zero-length array would read `undefined` there instead of
	// failing closed here, the SAME `"gradient_stops"` reason token already
	// used for the too-many-stops case (both are "stop count outside the
	// representable range", not a distinct failure class).
	if (def.stops.length === 0 || def.stops.length > MAX_GRADIENT_STOPS) {
		reasons.push("gradient_stops");
	}
	if (def.stops.some((stop) => !hexToRgb(stop.color))) {
		reasons.push("unparsable_fill");
	}
	return reasons;
}

/**
 * Stroke paints share the solid/gradient and textured cover shaders with
 * fills. Mesh strokes still need the mesh-raster bridge and replay semantics
 * before they can leave SVG fallback.
 */
function strokePaintReasons(
	def: GpuCanvasPaintDef,
	leadingPaint: ResolvedPaint | undefined,
	geometryBounds: Bounds,
): readonly GpuCapabilityReason[] {
	if (def.kind === "mesh") return ["stroke_paint"];
	if (def.kind === "image") {
		const reasons: GpuCapabilityReason[] = [];
		const fit =
			leadingPaint?.kind === "image-reference" ? leadingPaint.fit : "fill";
		const transform =
			leadingPaint?.kind === "image-reference"
				? leadingPaint.transform
				: undefined;
		if (transform && !invertMatrix(transform)) reasons.push("image_feature");
		if (fit === "tile") reasons.push("image_feature");
		if (geometryBounds.width <= 0 || geometryBounds.height <= 0) {
			reasons.push("image_feature");
		}
		return reasons;
	}
	const reasons: GpuCapabilityReason[] = [];
	if (def.transform) reasons.push("gradient_feature");
	if (def.stops.length === 0 || def.stops.length > MAX_GRADIENT_STOPS) {
		reasons.push("gradient_stops");
	}
	if (def.stops.some((stop) => !hexToRgb(stop.color))) {
		reasons.push("unparsable_stroke");
	}
	return reasons;
}

function backgroundGradientIsSupported(paint: ResolvedPaint): boolean {
	if (paint.kind !== "linear-gradient" && paint.kind !== "radial-gradient") {
		return false;
	}
	return (
		paint.opacity === 1 &&
		!paint.transform &&
		paint.stops.length > 0 &&
		paint.stops.length <= MAX_GRADIENT_STOPS &&
		paint.stops.every(
			(stop) => stop.opacity === 1 && hexToRgb(stop.color) !== null,
		)
	);
}

/**
 * Reports whether the artboard background renders as GPU-supported: exactly
 * one fully opaque paint. Solid backgrounds use the original quad path; linear
 * and radial gradients are admitted only when every stop is fully opaque.
 * S33 image/mesh backgrounds are admitted only when the raster source is
 * known to be fully opaque. The retained SVG artboard background under
 * GPU-active chrome makes opacity strict: any transparent background pixel
 * would double-composite.
 */
function backgroundIsSupported(
	artboard: Artboard,
	assets: readonly SceneAsset[] | undefined,
): boolean {
	const [paint, ...rest] = resolvePaints(artboard.fills, artboard.background);
	if (!paint || rest.length > 0 || paint.opacity !== 1) return false;
	if (paint.kind === "solid") return hexToRgb(paint.color) !== null;
	if (paint.kind === "image-reference") {
		return Boolean(gpuKnownOpaqueImageBackgroundHref(paint, assets));
	}
	if (paint.kind === "mesh-gradient") {
		return gpuMeshBackgroundUsesOpaqueRaster(paint);
	}
	return backgroundGradientIsSupported(paint);
}

const boundsIntersect = (a: Bounds, b: Bounds): boolean =>
	a.x < b.x + b.width &&
	a.x + a.width > b.x &&
	a.y < b.y + b.height &&
	a.y + a.height > b.y;

const artboardWorldBounds = (artboard: NormalizedArtboard): Bounds => ({
	x: artboard.position.x,
	y: artboard.position.y,
	width: artboard.width,
	height: artboard.height,
});

/**
 * Reports whether `artboard` is covered by any later-painted artboard.
 *
 * Frame-film post effects sample the already-composited source texture and then
 * overwrite this artboard's frame rect. That is exact when overlapping artboards
 * are earlier/lower in paint order: this artboard's opaque background has
 * already covered them inside its own rect. It is not exact when a later/higher
 * artboard intersects the rect, because this artboard's post effect would sample
 * and rewrite those higher pixels. This gate therefore fails only for later
 * overlaps, not for all overlaps.
 */
const artboardHasLaterPaintedOverlap = (
	artboard: NormalizedArtboard,
	allArtboards: readonly NormalizedArtboard[],
): boolean => {
	const bounds = artboardWorldBounds(artboard);
	const artboardIndex = allArtboards.findIndex(
		(candidate) => candidate.id === artboard.id,
	);
	if (artboardIndex < 0) return true;
	return allArtboards
		.slice(artboardIndex + 1)
		.some((other) => boundsIntersect(bounds, artboardWorldBounds(other)));
};

const artboardContentOverhangs = (
	document: SceneDocument,
	artboardId: string,
	artboard: Artboard,
	mapping: NodeArtboardMapping,
): boolean => {
	const artboardRect: Bounds = {
		x: 0,
		y: 0,
		width: artboard.width,
		height: artboard.height,
	};
	const isFullyContained = (bounds: Bounds): boolean =>
		bounds.x >= artboardRect.x &&
		bounds.y >= artboardRect.y &&
		bounds.x + bounds.width <= artboardRect.x + artboardRect.width &&
		bounds.y + bounds.height <= artboardRect.y + artboardRect.height;
	const walk = (node: VectorNode, parentWorld: Matrix2D): boolean => {
		if (!node.visible) return false;
		const world = composeMatrix(
			parentWorld,
			matrixFromTransform(node.transform),
		);
		if (
			!isWrapperContainer(node) &&
			!isFullyContained(boundsUnderMatrix(getNodeLocalPaintBounds(node), world))
		) {
			return true;
		}
		for (const child of node.children ?? []) {
			if (walk(child, world)) return true;
		}
		return false;
	};
	for (const layer of document.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) {
			if (mapping.byNodeId[node.id] !== artboardId) continue;
			if (walk(node, IDENTITY_MATRIX)) return true;
		}
	}
	return false;
};

/**
 * Reports whether a whole-ARTBOARD look/filter is attached — either directly
 * on `artboard.effectIntent` or inherited from the document-wide
 * `SceneDocument.effectIntent` fallback (`resolveFrameEffectIntent`'s
 * artboard-then-scene precedence, the SAME resolution `buildArtboardLookPlan`
 * uses to decide whether the SVG renderer attaches a frame-look `<filter>`).
 * This is DISTINCT from any per-node `style.effects`/`recipe` check in
 * {@link nodeCapabilityReasons}: a frame/scene-level look can filter every
 * node's composite even when EVERY individual node is otherwise
 * GPU-supported, so it must be checked once per artboard, not folded into the
 * per-node loop. Like the node-level S13 gate, this asks the matching frame
 * renderer predicate whether the authored frame look actually emits pixels
 * before adding a fallback reason; identity frame looks should not block an
 * otherwise GPU-ready artboard.
 */
function hasFrameLevelLook(
	document: SceneDocument,
	artboard: NormalizedArtboard,
	allArtboards: readonly NormalizedArtboard[],
	mapping: NodeArtboardMapping,
): boolean {
	const bounds = { x: 0, y: 0, width: artboard.width, height: artboard.height };
	const intent = resolveFrameEffectIntent(document, artboard.id);
	const fieldPlan = compileEffectFieldRoutes(intent.influenceRecipe, {
		surface: "editor-svg",
	});
	if (
		fieldPlan.routes.some(
			(route) =>
				route.fidelity.status === "native" ||
				route.fidelity.status === "approximated",
		)
	) {
		return true;
	}
	if (intent.lookGraph) {
		const explicitFrameFilmRecipe = explicitFrameFilmLookGraphRecipe(
			intent.lookGraph,
		);
		if (
			explicitFrameFilmRecipe &&
			!intent.influenceRecipe &&
			!artboardHasLaterPaintedOverlap(artboard, allArtboards) &&
			!artboardContentOverhangs(document, artboard.id, artboard, mapping)
		) {
			return false;
		}
		const plan = compileLookGraph(intent.lookGraph, {
			owner: { scope: "artboard", artboardId: intent.artboardId },
			bounds,
		});
		return (
			lookGraphPlanToEffectFilter(plan, {
				id: "gpu-capability-frame-look",
				bounds,
			}) !== null
		);
	}
	if (intent.visualRecipe) {
		const gpuFilmParams = frameGpuFilmPostEffectParams(intent.visualRecipe);
		if (
			gpuFilmParams &&
			!intent.influenceRecipe &&
			!artboardHasLaterPaintedOverlap(artboard, allArtboards) &&
			!artboardContentOverhangs(document, artboard.id, artboard, mapping)
		) {
			return false;
		}
		return frameVisualRecipeCanRenderVisibly(intent.visualRecipe);
	}
	// Effect-layer stacks are authoring state, but the live canvas frame-film path
	// renders only their synchronized `visualRecipe` projection unless an explicit
	// lookGraph exists. A stack without a visible projection is therefore identity
	// for the current canvas renderer and should not block GPU admission.
	return false;
}

/** Zero-translation, zero-rotation identity affine — the artboard-local walk seed for {@link blendOverhangReasons}, see that function's doc comment for why this is identity rather than the artboard's pasteboard-position translation. */
const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Gate (d) (E1 S6/S31): reports `["blend_mode_feature"]` once if ANY node in
 * `blendLeafIds` — a leaf already known to have survived gates (a)/(b)/(c)/
 * (e), see {@link computeGpuArtboardSupport}'s caller comment — has committed
 * world paint bounds that do NOT sit fully inside its own artboard's rect
 * (`{x: 0, y: 0, width: artboard.width, height: artboard.height}`), or `[]`
 * when every blend-eligible leaf is fully contained. SVG does not clip
 * ordinary artboard content to the artboard's own rect (existing, unrelated
 * behavior — ordinary non-blended overhang is harmless because SVG simply
 * keeps compositing against whatever pasteboard content is actually there);
 * a BLENDED leaf is different — blending against nothing outside the
 * artboard (the GPU surface's only backdrop) would visibly diverge from
 * SVG's `mix-blend-mode`, which blends against real pasteboard content.
 *
 * LAZY by construction: {@link computeGpuArtboardSupport} only calls this
 * when `blendLeafIds` is non-empty, so an artboard with no blend-mode usage
 * at all (the overwhelming majority of documents) pays ZERO cost for gate
 * (d) — no extra tree walk, no extra matrix math.
 *
 * Walks in ARTBOARD-LOCAL space (seeded with {@link IDENTITY_MATRIX}, NOT
 * `pasteboardOriginMatrix` — contrast with `gpu/display-list.ts`'s compiler,
 * which seeds its OWN walk with the artboard's pasteboard-position
 * translation because it compares against WORLD/pasteboard-space content):
 * this function only ever compares a leaf's bounds against its OWN
 * artboard's `{0, 0, width, height}` rect, which is expressed in that
 * artboard's local space, so seeding with identity avoids introducing the
 * pasteboard offset only to subtract it back out again.
 *
 * Selects root nodes and recurses the SAME way `compileArtboardDrawList`
 * does (`document.layers` → skip invisible layers → `layer.nodes` → skip
 * any node `mapping.byNodeId` does not resolve to THIS artboard → recurse
 * into `.children`), and skips an invisible node's whole subtree exactly
 * like `gpu/display-list.ts`'s `compileNode` — an invisible blend-mode leaf
 * paints nothing, so its bounds are irrelevant regardless of where they'd
 * fall. Stops at the FIRST violation (the caller only needs to know whether
 * ANY blend leaf overhangs, not which one or how many).
 *
 * Reuses this module's existing SSOT bounds/matrix helpers
 * (`composeMatrix`, `matrixFromTransform`, `boundsUnderMatrix`,
 * `getNodeLocalPaintBounds`) rather than inventing a parallel
 * implementation — the one and only new accumulator this gate needed is
 * this function's own local recursive walk, scoped entirely inside this
 * file and never exported.
 */
function blendOverhangReasons(
	document: SceneDocument,
	artboardId: string,
	artboard: Artboard,
	blendLeafIds: ReadonlySet<string>,
	mapping: NodeArtboardMapping,
): readonly GpuCapabilityReason[] {
	const artboardRect: Bounds = {
		x: 0,
		y: 0,
		width: artboard.width,
		height: artboard.height,
	};

	const isFullyContained = (bounds: Bounds): boolean =>
		bounds.x >= artboardRect.x &&
		bounds.y >= artboardRect.y &&
		bounds.x + bounds.width <= artboardRect.x + artboardRect.width &&
		bounds.y + bounds.height <= artboardRect.y + artboardRect.height;

	// Returns true once an overhanging blend leaf is found (early-exit),
	// mirroring `compileNode`'s own recursive shape (world-matrix
	// accumulation via `composeMatrix`/`matrixFromTransform`, invisible
	// subtrees skipped) but never emitting a draw entry — only a boolean.
	const walk = (node: VectorNode, parentWorld: Matrix2D): boolean => {
		if (!node.visible) return false;
		const world = composeMatrix(
			parentWorld,
			matrixFromTransform(node.transform),
		);
		if (
			blendLeafIds.has(node.id) &&
			!isFullyContained(boundsUnderMatrix(getNodeLocalPaintBounds(node), world))
		) {
			return true;
		}
		for (const child of node.children ?? []) {
			if (walk(child, world)) return true;
		}
		return false;
	};

	for (const layer of document.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) {
			if (mapping.byNodeId[node.id] !== artboardId) continue;
			if (walk(node, IDENTITY_MATRIX)) return ["blend_mode_feature"];
		}
	}
	return [];
}

/**
 * Computes GPU-render support for every artboard in `document`, evaluated
 * against `motion`'s committed keyframe tracks and `grammarOpacityNodeIds` (a
 * precomputed summary of node ids a COMMITTED motion-grammar binding drives an
 * opacity-like channel for — see `widgets/canvas-shell/model/gpu-grammar-
 * opacity.ts`'s doc comment for why this predicate takes that as a plain
 * `ReadonlySet<string>` instead of importing `entities/motion-grammar`
 * directly). Callers MUST pass the committed `useSceneStore`/`useMotionStore`
 * documents and the committed `useMotionGrammarStore` bindings (via that
 * precomputed set) — never a live-drag override merge or a
 * `samplePresentation`-sampled document (see this module's doc comment for
 * why).
 *
 * Reads `mapping.byArtboardId` directly (rather than recursing into
 * `.children` from top-level roots): that map is already a FLATTENED list of
 * every node at every depth resolved to the artboard (see
 * `selectNodeArtboardMapping`'s doc), so a single non-recursive pass over it
 * checks each node's own reasons exactly once — recursing into `.children` on
 * top of that would revisit nested nodes redundantly (harmless for a `Set`
 * accumulator, but wasted work and confusing to read).
 */
export function computeGpuArtboardSupport(
	document: SceneDocument,
	motion: MotionDocument,
	grammarOpacityNodeIds: ReadonlySet<string>,
): ReadonlyMap<string, GpuArtboardSupport> {
	const mapping = selectNodeArtboardMapping(document);
	const allArtboards = selectAllArtboards(document);
	const result = new Map<string, GpuArtboardSupport>();
	// Built once per document (not per-node): the SAME `imagePaintHref`
	// resolution `canvasPaintsForStyle` uses in every other renderer, closed
	// over `document.assets` so both an image-reference FILL paint and a
	// placed-image-node's `assetId` resolve through one identical lookup (E1
	// S5).
	const resolveImageHref = (
		paint: ResolvedImageReferencePaint,
	): string | undefined => imagePaintHref(paint, document.assets);
	// Computed once for the whole document (not per-node) — E1 S7 admits the
	// single-level hard clip subset, and S30 admits the alpha-mask spelling of
	// the same hard silhouette when it has no soft settings. Multi-application,
	// chained, feathered, translucent, expanded, or inverted masks still force
	// their artboard to SVG via the `"mask"` reason token, unchanged from S2.
	//
	// `admittedHardMaskContentNodeIds`: content node ids whose applications array
	// has EXACTLY ONE entry AND that entry can use the GPU hard-clip stencil
	// path. A content node with one admitted application ALONGSIDE any other
	// application (mixed clip+soft alpha-mask, or two clip relations) is
	// excluded here even though one application is individually a plain clip —
	// this tier only ever wraps a SINGLE clip scope per node.
	//
	// `admittedConsumedMaskNodeIds`: silhouette source node ids where EVERY
	// application referencing that source anywhere in the document is itself
	// one of the single-application hard-silhouette relations just admitted above — NOT
	// simply "referenced by at least one admitted relation." One mask source
	// can be `maskNodeId` for relations on SEVERAL different content nodes
	// (e.g. one clip application on node A plus a second, soft alpha-mask
	// application on node B, both pointing at the same source) — the source
	// is only GPU-paintable-as-consumed (i.e. never painted, matching
	// `display-list.ts`'s `consumedMaskNodeIds` contract) when NONE of its
	// consumers needs the SVG-only soft-alpha/multi-application path; a
	// source with even one non-admitted consumer must keep failing capability
	// via `"mask"` for every artboard it participates in, exactly like S2.
	const maskPlan = resolveSceneMaskPlan(document);
	const maskDefByKey = new Map(maskPlan.defs.map((def) => [def.key, def]));
	const admittedHardMaskContentNodeIds = new Set<string>();
	const nonAdmittedMaskNodeIds = new Set<string>();
	for (const [
		contentNodeId,
		applications,
	] of maskPlan.applicationsByContentNodeId) {
		const [application] = applications;
		const isAdmitted =
			applications.length === 1 &&
			application !== undefined &&
			maskDefByKey.get(application.defKey)?.directGpuCompatible === true &&
			maskApplicationUsesHardSilhouette(
				application,
				maskDefByKey.get(application.defKey),
			);
		if (isAdmitted) {
			admittedHardMaskContentNodeIds.add(contentNodeId);
		} else {
			for (const application of applications) {
				nonAdmittedMaskNodeIds.add(application.maskNodeId);
			}
		}
	}
	const admittedConsumedMaskNodeIds = new Set<string>(
		[...maskPlan.consumedMaskNodeIds].filter(
			(maskNodeId) => !nonAdmittedMaskNodeIds.has(maskNodeId),
		),
	);
	// Every OTHER masked content node or consumed source (soft alpha-mask,
	// multi-application, or any relation this predicate did not just admit above)
	// still fails capability via the pre-existing `"mask"` token — unchanged
	// from S2/S6 except for the carve-out just computed.
	const maskedNodeIds = new Set<string>(
		[
			...maskPlan.applicationsByContentNodeId.keys(),
			...maskPlan.consumedMaskNodeIds,
		].filter(
			(nodeId) =>
				!admittedHardMaskContentNodeIds.has(nodeId) &&
				!admittedConsumedMaskNodeIds.has(nodeId),
		),
	);

	for (const [artboardId, nodesInArtboard] of Object.entries(
		mapping.byArtboardId,
	)) {
		const artboard =
			allArtboards.find((entry) => entry.id === artboardId) ?? undefined;
		const reasons = new Set<GpuCapabilityReason>();
		if (!artboard || !backgroundIsSupported(artboard, document.assets)) {
			reasons.add("translucent_background");
		}
		if (
			artboard &&
			hasFrameLevelLook(document, artboard, allArtboards, mapping)
		) {
			reasons.add("filter_or_look");
		}
		const activeSourceOpticsRigs =
			artboard?.sourceOpticsRigs?.filter((rig) => rig.enabled) ?? [];
		if (artboard && activeSourceOpticsRigs.length > 0) {
			const presentation = buildSourceOpticsPresentation(
				document,
				artboard.id,
				"webgpu",
			);
			const ownerIds = new Set([
				...presentation.sourcePlans.map((plan) => plan.sourceNodeId),
				...presentation.targetPlans.map((plan) => plan.targetNodeId),
			]);
			const ownerArrangementUnsupported = [...ownerIds].some((nodeId) => {
				const node = nodesInArtboard.find(
					(candidate) => candidate.id === nodeId,
				);
				return (
					!node ||
					isWrapperContainer(node) ||
					maskPlan.applicationsByContentNodeId.has(nodeId) ||
					maskPlan.consumedMaskNodeIds.has(nodeId)
				);
			});
			const authoredFeatureUnsupported = activeSourceOpticsRigs.some(
				(rig) =>
					(rig.bloom.blendMode !== "normal" &&
						rig.bloom.blendMode !== "screen") ||
					Boolean(rig.atmosphere?.fieldId) ||
					Boolean(rig.atmosphere?.tint && !hexToRgb(rig.atmosphere.tint)) ||
					rig.responses.some(
						(response) =>
							Boolean(response.fieldId) ||
							Boolean(
								response.surface?.tint && !hexToRgb(response.surface.tint),
							) ||
							Boolean(
								response.diffusion?.tint && !hexToRgb(response.diffusion.tint),
							) ||
							Boolean(response.edge?.tint && !hexToRgb(response.edge.tint)),
					),
			);
			if (
				presentation.issues.length > 0 ||
				ownerIds.size === 0 ||
				ownerArrangementUnsupported ||
				authoredFeatureUnsupported
			) {
				reasons.add("source_optics_feature");
			}
		}
		const scopedLookGraphTargetIds = new Set<string>(
			artboard
				? scopedLookGraphOverlays(artboard).flatMap(
						(overlay) => overlay.targetNodeIds,
					)
				: [],
		);
		// E1 S6/S31 gate (d) — leaves whose blend mode passed gates (a)/(b)/(c)/(e)
		// (a fixed-function mode, not a carrier, fill-only or E0-outline-only
		// paint shape, and — for darken/lighten — an opaque solid) but whose
		// world paint bounds have not yet been checked against the artboard
		// rect. A node that already produced `"blend_mode"`/
		// `"blend_mode_feature"` from one of those gates is excluded — its
		// artboard already fails capability for a reason gate (d) cannot add
		// to or subtract from.
		const blendLeafIds = new Set<string>();
		for (const node of nodesInArtboard) {
			// E1 S7: an admitted clip silhouette source never paints as ordinary
			// content (`display-list.ts`'s compiler skips it the same way), so its
			// OWN geometry/paint/effect/BLEND checks must not run at all here — an
			// unrelated quirk in a consumed-but-unpainted source (an unparsable
			// fill color, a second fill, its own attached effect, an incidental
			// `style.blendMode` value that never actually composites, etc.) must
			// never fail an otherwise-GPU-clean artboard for content the GPU
			// surface never actually draws. Skipping the S6 blend-eligibility
			// check too (not just `nodeCapabilityReasons`) matters: without it, an
			// admitted source with a fixed-function blend mode set (however
			// unlikely to be authored deliberately) would still get added to
			// `blendLeafIds` below, and gate (d)'s bounds check could then fail
			// the whole artboard over bounds belonging to content that never
			// draws. A NON-admitted consumed source (still in `maskedNodeIds`)
			// falls through to the ordinary calls below and correctly re-earns
			// `"mask"` (and remains blend-eligible exactly as before this slice —
			// its own quirks are real quirks since it might still paint on SVG's
			// fallback path for a DIFFERENT relation elsewhere, e.g. as a
			// non-admitted soft alpha-mask source).
			const isAdmittedConsumedSource = admittedConsumedMaskNodeIds.has(node.id);
			const nodeReasons = isAdmittedConsumedSource
				? []
				: nodeCapabilityReasons(
						node,
						scopedLookGraphTargetIds,
						maskedNodeIds,
						motion,
						grammarOpacityNodeIds,
						resolveImageHref,
					);
			for (const reason of nodeReasons) reasons.add(reason);

			const resolvedBlendMode = resolveNodeStyle(node.style).blendMode;
			if (
				!isAdmittedConsumedSource &&
				!isWrapperContainer(node) &&
				FIXED_FUNCTION_BLEND_MODES.has(resolvedBlendMode) &&
				!nodeReasons.includes("blend_mode") &&
				!nodeReasons.includes("blend_mode_feature")
			) {
				blendLeafIds.add(node.id);
			}
		}
		if (blendLeafIds.size > 0 && artboard) {
			for (const reason of blendOverhangReasons(
				document,
				artboardId,
				artboard,
				blendLeafIds,
				mapping,
			)) {
				reasons.add(reason);
			}
		}
		result.set(artboardId, {
			supported: reasons.size === 0,
			reasons: [...reasons],
		});
	}

	return result;
}
