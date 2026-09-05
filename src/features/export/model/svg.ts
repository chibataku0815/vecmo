import {
	effectiveCornerRadii,
	effectiveCornerRadius,
	effectiveCornerSmoothing,
	effectiveOpacity,
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import {
	resolveTextAnimatorRender,
	type TextAnimatorRender,
	type TextFragmentPose,
} from "@/entities/motion/model/text-animator";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import {
	type AppearanceMaskRelationMetadata,
	affectedNodeIdsForMaskRelations,
	isImportedClipMaskKind,
	maskRelationSourceLabel,
	maskRelationSourceSummary,
	readAppearanceMaskRelations,
	readImportedCompoundPath,
	readImportedEffects,
	readImportedOpacityGroups,
	readImportedPaint,
} from "@/entities/scene/model/appearance";
import {
	effectFilterBoundsForNode,
	hasSubtreeCarrier,
} from "@/entities/scene/model/appearance-targets";
import {
	imagePaintHref,
	imagePlacementForNode,
	resolveImageAssetReference,
} from "@/entities/scene/model/assets";
import {
	rectNeedsBakedPath,
	roundedPolygonPathData,
	roundedRectPathData,
	roundedStarPathData,
	shapeNeedsBakedPath,
} from "@/entities/scene/model/corner-geometry";
import { compileEffectFieldRoutesForNode } from "@/entities/scene/model/effect-field-routing";
import {
	buildEffectFilter,
	buildFrameVisualRecipeFilter,
	type EffectFilterSpec,
	serializeEffectFilter,
	svgIdSegment,
} from "@/entities/scene/model/effect-filter";
import { sortedSceneFidelitySourcePaths } from "@/entities/scene/model/fidelity-issues";
import { scopedPathBlurTopmostTargetNodeIds } from "@/entities/scene/model/gpu-raster-adapter";
import {
	type LookGraph,
	lookGraphNodeLabel,
} from "@/entities/scene/model/look-graph";
import {
	compileLookGraph,
	type LookGraphFidelity,
	type LookGraphPlan,
	lookGraphPlanToEffectFilter,
} from "@/entities/scene/model/look-graph-compile";
import {
	resolveSceneMaskPlan,
	type SceneMaskPlan,
} from "@/entities/scene/model/mask-render";
import {
	buildMaskDefSvg,
	maskApplicationAttribute,
	strokeBlurFilterDefSvg,
	strokeBlurFilterId,
} from "@/entities/scene/model/mask-svg";
import {
	coonsPatchesFromMesh,
	meshBounds,
} from "@/entities/scene/model/mesh-edit";
import {
	isObjectNoiseGradientScopedLook,
	objectNoiseGradientParticleNode,
} from "@/entities/scene/model/noise-gradient-look";
import {
	imagePatternDef,
	linearGradientDef,
	paintTransformAttribute,
	radialGradientDef,
} from "@/entities/scene/model/paint-server-svg";
import { isObjectPathBlurScopedLook } from "@/entities/scene/model/path-blur-look";
import { createExpressionFrameContext } from "@/entities/scene/model/production-control";
import {
	resolveFrameEffectIntent,
	resolveNodeRecipe,
} from "@/entities/scene/model/recipe-resolve";
import {
	matrixFromTransform,
	matrixToSvg,
	svgTextAnchorForAlign,
	type TextMetrics,
	textAnchorXForAlign,
	textMetricsForGeometry,
} from "@/entities/scene/model/rendering";
import {
	compileScopedLookGraphOverlayFilter,
	type ScopedLookGraphOverlay,
	scopedLookGraphOverlayFilterId,
	scopedLookGraphOverlays,
	scopedLookGraphOverlayTargetMap,
	scopedLookGraphRunBoundsForTransform,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import { findNode } from "@/entities/scene/model/selectors";
import {
	type SourceOpticsPresentation,
	sourceOpticsTargetResponsePresentation,
} from "@/entities/scene/model/source-optics";
import { getStrokeWidthProfileOutline } from "@/entities/scene/model/stroke-outline";
import { strokePresentation } from "@/entities/scene/model/style-presentation";
import {
	artboardBackgroundIsTransparent,
	type ResolvedMeshGradientPaint,
	type ResolvedNodeStyle,
	type ResolvedPaint,
	resolvePaints,
} from "@/entities/scene/model/style-resolve";
import type { TextLineMeasurer } from "@/entities/scene/model/text-fragments";
import type {
	BezierShape,
	Bounds,
	NodeGeometry,
	RevealPaint,
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import {
	SVG_RENDER_PARTS,
	SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE,
	svgRenderPartAttributePair,
} from "@/shared/lib/svg-render-parts";
import { encodePngDataUrl, rasterizeMesh } from "@/shared/mesh-raster";
import {
	type EffectInfluenceRecipe,
	effectiveTextureBlendMode,
	type VisualRecipe,
} from "@/shared/vec-core";
import type { ExportIssue } from "./issues";
import {
	type ExportAsset,
	fileStemForScene,
	stableJsonStringify,
} from "./json";
import {
	type ProgramSurfaceDeliveryDecision,
	type ProgramSurfaceDeliveryIssueCode,
	resolveProgramSurfaceDeliveryForGeometry,
} from "./program-surface-delivery";
import {
	buildExportRenderPresentation,
	type ExportRenderPresentation,
} from "./render-presentation";
import {
	createExportAppearanceFidelityTracker,
	type ExportAppearanceFidelity,
	type ExportAppearanceFidelityTracker,
	type ExportPaintRole,
	fallbackColorForRole,
	finalizeExportAppearanceFidelity,
	paintKindSummary,
	paintListForRole,
	recordExportAppearanceFidelity,
	resolveExportNodeStyle,
} from "./style";
import {
	analyzeVecCoreRecipeSvgApproximation,
	VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
	VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE,
	vecCoreRecipePathSummary,
} from "./vec-core";

const SVG_MIME_TYPE = "image/svg+xml;charset=utf-8";

type SvgExportInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly fileNameStem?: string;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly renderPresentation?: ExportRenderPresentation;
	readonly transparentBackground?: boolean;
	/**
	 * Optional text-line measurer for split text-animator fragments. Omitted for
	 * static `.svg`/Worker export (the deterministic estimate is used); the browser
	 * WebM adapter passes the same measurer the editor uses so exported fragment
	 * positions match the authored layout instead of drifting on multi-glyph or
	 * non-left-aligned lines.
	 */
	readonly measurer?: TextLineMeasurer;
	/**
	 * Set by raster targets (WebM / animation sequence / future PNG rasterizers)
	 * that rasterize this SVG through an `<img>`, which freezes SMIL. Particle
	 * boil is baked to the sampled frame; Linear particle density still uses an
	 * inlined data-URL ramp so the authored angle survives raster capture.
	 */
	readonly rasterSafe?: boolean;
	/**
	 * GPU raster callers set this to keep particle TextureRecipe nodes out of the
	 * SVG prefix. Non-GPU exports leave it false so the SVG approximation remains.
	 */
	readonly deferGpuRasterEffects?: boolean;
};

export type SvgExportIssueCode =
	| "gpu-raster-compositing-lost"
	| "image-asset-invalid-source"
	| "image-asset-missing"
	| "image-asset-reference-fallback"
	| "external-asset-preview-fallback"
	| "external-asset-preview-required"
	| "program-surface-asset-missing"
	| "program-surface-declared-fallback-invalid"
	| "program-surface-declared-fallback-required"
	| "program-surface-manifest-invalid"
	| "program-surface-static-output-unsupported"
	| "program-surface-svg-raster-fallback"
	| "video-asset-frame-required"
	| "import-clip-mask-fallback"
	| "import-compound-path-split"
	| "import-effect-unsupported"
	| "import-opacity-group-flattened"
	| "import-paint-approximated"
	| "import-paint-unsupported"
	| "invalid-path"
	| "mask-relation-fallback"
	| "style-effect-unsupported"
	| "style-paint-approximated"
	| "style-paint-rasterized"
	| "style-paint-unsupported"
	| "style-stroke-align-unsupported"
	| "text-style-approximated"
	| "vec-core-recipe-svg-approximated"
	| "vec-core-recipe-svg-unsupported";

export type SvgExportIssue = ExportIssue & {
	readonly code: SvgExportIssueCode;
};

export type SvgExportAsset = ExportAsset & {
	readonly kind: "svg";
	readonly appearance: ExportAppearanceFidelity;
	readonly issues: readonly SvgExportIssue[];
};

/**
 * Full SVG render result. The string API stays available for preview, while the
 * issue list lets bundle exports report visible approximations and fallbacks.
 */
export type SvgRenderResult = {
	readonly contents: string;
	readonly appearance: ExportAppearanceFidelity;
	readonly issues: readonly SvgExportIssue[];
};

type SvgAttributeValue = string | number | boolean | null | undefined;

type SvgRenderState = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly defs: string[];
	readonly appearance: ExportAppearanceFidelityTracker;
	readonly issues: SvgExportIssue[];
	readonly maskPlan: SceneMaskPlan;
	readonly measurer?: TextLineMeasurer;
	readonly rasterSafe: boolean;
	readonly deferGpuRasterEffects: boolean;
	readonly fps: number;
	readonly effectInfluenceRecipe: EffectInfluenceRecipe | null;
	readonly scopedLookGraphTargets: ReadonlyMap<string, ScopedLookGraphOverlay>;
	readonly scopedLookGraphRunIndex: { value: number };
	readonly sourceOpticsPresentation?: SourceOpticsPresentation;
};

type IssueContext = {
	readonly layerId?: string;
	readonly nodeId?: string;
};

const importedEffectSummary = (node: VectorNode): string | undefined => {
	const effects = readImportedEffects(node).filter(
		(effect) => !isImportedClipMaskKind(effect.kind),
	);
	if (effects.length === 0) return undefined;
	return effects
		.map((effect) =>
			effect.ref
				? `${effect.kind}:${effect.ref}`
				: `${effect.kind}:${effect.value}`,
		)
		.join(",");
};

/**
 * Mask relations on a node that the render descriptor could NOT represent, so the
 * exporter still falls back to unclipped geometry and a typed issue for them.
 * Relations represented as a real `<clipPath>`/`<mask>` are filtered out here so
 * dropped-mask reporting only covers genuine fallbacks.
 */
const droppedMaskRelations = (
	node: VectorNode,
	state: SvgRenderState,
): readonly AppearanceMaskRelationMetadata[] =>
	readAppearanceMaskRelations(node).filter(
		(relation) => !state.maskPlan.representedRelationIds.has(relation.id),
	);

const maskRelationSummary = (
	node: VectorNode,
	state: SvgRenderState,
): string | undefined => {
	const relations = droppedMaskRelations(node, state);
	if (relations.length === 0) return undefined;
	return relations
		.map((relation) => {
			const source = maskRelationSourceLabel(relation);
			const targets =
				relation.affectedNodeIds.length > 0
					? relation.affectedNodeIds.join("+")
					: "unknown";
			return `${source}->${targets}`;
		})
		.join(",");
};

const importedPaintSummary = (node: VectorNode): string | undefined => {
	const paint = readImportedPaint(node);
	if (!paint) return undefined;
	return (["fill", "stroke"] as const)
		.flatMap((role) => {
			const entry = paint[role];
			if (!entry) return [];
			const ref = entry.ref ? `#${entry.ref}` : "";
			return [`${role}:${entry.source}${ref}->${entry.fallback}`];
		})
		.join(",");
};

const importedCompoundPathSummary = (node: VectorNode): string | undefined => {
	const compound = readImportedCompoundPath(node);
	if (!compound) return undefined;
	const index =
		compound.subpathIndex === undefined ? "?" : String(compound.subpathIndex);
	const count =
		compound.subpathCount === undefined ? "?" : String(compound.subpathCount);
	return `${compound.source}:${index}/${count}:${compound.fillRule ?? "unknown"}`;
};

const importedOpacityGroupSummary = (node: VectorNode): string | undefined => {
	const groups = readImportedOpacityGroups(node);
	if (groups.length === 0) return undefined;
	return groups
		.map((group) => {
			const source = group.ref
				? `${group.source}:#${group.ref}`
				: (group.sourcePath ?? group.source);
			return `${source}@${group.opacity}->${group.flattenedTo}`;
		})
		.join(",");
};

const SVG_STYLE_FALLBACK_COLOR = "#000000";

/**
 * Fixed export raster resolution (device px per node-local unit) for mesh paints.
 * Matches the canvas bridge so the exported bitmap and the live preview agree at
 * the pixel level; higher-fidelity native ShadingType 6 PDF is a later phase.
 */
const MESH_EXPORT_SCALE = 2;

/**
 * Serializes a mesh paint as a `userSpaceOnUse` `<pattern>` wrapping a rasterized
 * PNG. Returns `null` for a degenerate mesh (no patches / zero-area bounds) so the
 * caller can fall back to a flat color instead of emitting an empty pattern.
 */
const meshGradientDef = (
	id: string,
	paint: ResolvedMeshGradientPaint,
): string | null => {
	const bounds = meshBounds(paint);
	const patches = coonsPatchesFromMesh(paint);
	if (patches.length === 0 || bounds.width <= 0 || bounds.height <= 0) {
		return null;
	}
	const raster = rasterizeMesh({
		patches,
		bounds,
		deviceScale: MESH_EXPORT_SCALE,
	});
	const dataUrl = encodePngDataUrl(raster.pixels, raster.width, raster.height);
	// The tile sits at the mesh bounds; with patternContentUnits=userSpaceOnUse the
	// content origin is the tile origin, so the image is drawn at tile-local 0,0.
	return `<pattern ${renderAttributes([
		["id", id],
		["patternUnits", "userSpaceOnUse"],
		["patternContentUnits", "userSpaceOnUse"],
		["x", bounds.x],
		["y", bounds.y],
		["width", bounds.width],
		["height", bounds.height],
		["patternTransform", paintTransformAttribute(paint.transform)],
	])}>
<image ${renderAttributes([
		["href", dataUrl],
		["x", 0],
		["y", 0],
		["width", bounds.width],
		["height", bounds.height],
		["preserveAspectRatio", "none"],
	])} />
</pattern>`;
};

/**
 * Comma-separated list of effect kinds that the SVG filter could NOT render
 * (currently only `background-blur`), sourced from the built spec's `deferred`
 * list. Renderable effects now ship as a real `<filter>`, so they are absent
 * here. Returns undefined when nothing was dropped, so the `<g>` attribute is
 * omitted.
 */
const styleEffectSummary = (
	spec: EffectFilterSpec | null,
): string | undefined => {
	if (!spec || spec.deferred.length === 0) return undefined;
	return spec.deferred.map((effect) => effect.kind).join(",");
};

const escapeText = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const escapeAttribute = (value: string): string =>
	escapeText(value).replaceAll('"', "&quot;");

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	// String() and toFixed() both flip to exponent notation at |n| >= 1e21, which PDF number
	// syntax (ISO 32000-1) forbids as a content-stream token. This formatter is duplicated
	// byte-identically in pdf.ts and svg.ts, so both branches stay in sync. Every double this
	// large is integer-valued (past 2^52), so BigInt renders a plain-decimal token, never throwing.
	if (Math.abs(rounded) >= 1e21) return BigInt(rounded).toString();
	return String(rounded);
};

const renderAttributes = (
	attributes: readonly (readonly [string, SvgAttributeValue])[],
): string =>
	attributes
		.flatMap(([name, value]) => {
			if (value === null || value === undefined || value === false) return [];
			const normalized =
				typeof value === "number" ? formatNumber(value) : String(value);
			return [`${name}="${escapeAttribute(normalized)}"`];
		})
		.join(" ");

const compactPathData = (pathData: string): string =>
	pathData.replace(/\b([MC])\s+/g, "$1").replace(/\s+Z$/, "Z");

const pointList = (
	points: readonly { readonly x: number; readonly y: number }[],
) =>
	points
		.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`)
		.join(" ");

const starPoints = (
	geometry: Extract<NodeGeometry, { readonly kind: "star" }>,
): string => {
	const points: string[] = [];
	const total = geometry.points * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		points.push(
			`${formatNumber(geometry.center.x + Math.cos(angle) * radius)},${formatNumber(geometry.center.y + Math.sin(angle) * radius)}`,
		);
	}
	return points.join(" ");
};

const isFiniteVec2 = (point: Vec2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const isFiniteAePoint = (
	point: readonly [number, number] | undefined,
): point is readonly [number, number] =>
	point !== undefined && Number.isFinite(point[0]) && Number.isFinite(point[1]);

const isRenderableShape = (shape: BezierShape): boolean => {
	if (
		shape.vertices.length === 0 ||
		shape.inTangents.length !== shape.vertices.length ||
		shape.outTangents.length !== shape.vertices.length
	) {
		return false;
	}

	return (
		shape.vertices.every(isFiniteAePoint) &&
		shape.inTangents.every(isFiniteAePoint) &&
		shape.outTangents.every(isFiniteAePoint)
	);
};

const safeBounds = (bounds: Bounds): Bounds => ({
	x: Number.isFinite(bounds.x) ? bounds.x : 0,
	y: Number.isFinite(bounds.y) ? bounds.y : 0,
	width: Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : 24,
	height:
		Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : 24,
});

const pathFallbackBounds = (shape: BezierShape): Bounds => {
	const points = shape.vertices
		.map(([x, y]) => ({ x, y }))
		.filter(isFiniteVec2);
	if (points.length === 0) return { x: 0, y: 0, width: 24, height: 24 };
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		x: minX,
		y: minY,
		width: Math.max(24, Math.max(...xs) - minX),
		height: Math.max(24, Math.max(...ys) - minY),
	};
};

/**
 * Joins an outer contour with its hole subpaths into one `d`, so a compound path
 * (donut, letter counter) exports as a single `<path>` resolved by `fill-rule`.
 * Returns null when the outer contour itself is not renderable.
 */
const compoundPathData = (
	shape: BezierShape,
	subpaths: readonly BezierShape[],
): string | null => {
	if (!isRenderableShape(shape)) return null;
	const contours = [shape, ...subpaths.filter(isRenderableShape)];
	return compactPathData(contours.map(aeShapeToSvgPath).join(" "));
};

const element = (
	tag: string,
	attributes: readonly (readonly [string, SvgAttributeValue])[],
): string => `<${tag} ${renderAttributes(attributes)} />`;

const joinSvgParts = (parts: readonly (string | null | undefined)[]): string =>
	parts.filter((part): part is string => Boolean(part)).join("\n");

const addIssue = (state: SvgRenderState, issue: SvgExportIssue): void => {
	state.issues.push(issue);
};

const recordAppearance = (
	state: SvgRenderState,
	status: Parameters<typeof recordExportAppearanceFidelity>[1],
	capability: string,
): void => {
	recordExportAppearanceFidelity(state.appearance, status, capability);
};

type SvgPaintResolution = {
	readonly value: string;
	readonly opacity: number;
};

const addStylePaintIssue = (
	state: SvgRenderState,
	context: IssueContext,
	role: ExportPaintRole,
	issue: Pick<
		SvgExportIssue,
		"category" | "code" | "fallback" | "message" | "severity" | "sourcePaths"
	>,
): void => {
	addIssue(state, {
		...issue,
		...context,
		message: `${role} ${issue.message}`,
	});
};

/**
 * Resolves ONE paint in a role's stack into an SVG paint value, pushing any def it
 * needs with an index-qualified id (`paint-<node>-<role>-<i>`) so stacked layers
 * never collide. Records honest per-paint fidelity: gradients/images preserved,
 * stop-less/source-less paints unsupported (fallback color), mesh rasterized. The
 * caller emits one geometry element per resolved layer, so a multi-paint stack is
 * rendered for real rather than collapsed — no `paint-stack` approximation.
 */
const resolveSvgPaintLayer = (
	node: VectorNode,
	paint: ResolvedNodeStyle["fills"][number],
	role: ExportPaintRole,
	paintIndex: number,
	style: ResolvedNodeStyle,
	state: SvgRenderState,
	context: IssueContext,
): SvgPaintResolution => {
	const paintDomId = `paint-${svgIdSegment(node.id)}-${role}-${paintIndex}`;
	switch (paint.kind) {
		case "solid":
			if (paint.opacity !== 1) {
				recordAppearance(state, "preserved", `${role}:paint-opacity`);
			}
			return { value: paint.color, opacity: paint.opacity };
		case "linear-gradient": {
			if (paint.stops.length === 0) {
				const fallback = fallbackColorForRole(
					style,
					role,
					SVG_STYLE_FALLBACK_COLOR,
				);
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "unsupported",
					code: "style-paint-unsupported",
					message: `paint ${paintKindSummary(paint)} has no stops and cannot be emitted as SVG vector paint; exported with deterministic fallback color ${fallback}.`,
					fallback: "default-color",
				});
				recordAppearance(state, "unsupported", `${role}:linear-gradient`);
				return { value: fallback, opacity: paint.opacity };
			}
			recordAppearance(state, "preserved", `${role}:linear-gradient`);
			if (paint.opacity !== 1) {
				recordAppearance(state, "preserved", `${role}:paint-opacity`);
			}
			if (paint.stops.some((stop) => stop.opacity !== 1)) {
				recordAppearance(state, "preserved", `${role}:gradient-stop-opacity`);
			}
			const id = paintDomId;
			state.defs.push(linearGradientDef(id, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "radial-gradient": {
			if (paint.stops.length === 0) {
				const fallback = fallbackColorForRole(
					style,
					role,
					SVG_STYLE_FALLBACK_COLOR,
				);
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "unsupported",
					code: "style-paint-unsupported",
					message: `paint ${paintKindSummary(paint)} has no stops and cannot be emitted as SVG vector paint; exported with deterministic fallback color ${fallback}.`,
					fallback: "default-color",
				});
				recordAppearance(state, "unsupported", `${role}:radial-gradient`);
				return { value: fallback, opacity: paint.opacity };
			}
			recordAppearance(state, "preserved", `${role}:radial-gradient`);
			if (paint.opacity !== 1) {
				recordAppearance(state, "preserved", `${role}:paint-opacity`);
			}
			if (paint.stops.some((stop) => stop.opacity !== 1)) {
				recordAppearance(state, "preserved", `${role}:gradient-stop-opacity`);
			}
			const id = paintDomId;
			state.defs.push(radialGradientDef(id, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "image-reference": {
			const href = imagePaintHref(paint, state.scene.assets);
			if (!href) {
				recordAppearance(state, "unsupported", `${role}:image-reference`);
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "unsupported",
					code: "style-paint-unsupported",
					message: `paint ${paintKindSummary(paint)} has no resolvable image source and cannot be emitted as SVG vector paint; exported with deterministic fallback color ${fallbackColorForRole(style, role, SVG_STYLE_FALLBACK_COLOR)}.`,
					fallback: "default-color",
				});
				return {
					value: fallbackColorForRole(style, role, SVG_STYLE_FALLBACK_COLOR),
					opacity: paint.opacity,
				};
			}
			recordAppearance(state, "preserved", `${role}:image-reference`);
			if (paint.opacity !== 1) {
				recordAppearance(state, "preserved", `${role}:paint-opacity`);
			}
			const id = paintDomId;
			state.defs.push(imagePatternDef(id, href, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "mesh-gradient": {
			const id = paintDomId;
			const def = meshGradientDef(id, paint);
			if (!def) {
				const fallback = fallbackColorForRole(
					style,
					role,
					SVG_STYLE_FALLBACK_COLOR,
				);
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "unsupported",
					code: "style-paint-unsupported",
					message: `paint ${paintKindSummary(paint)} has no patches and cannot be emitted as SVG paint; exported with deterministic fallback color ${fallback}.`,
					fallback: "default-color",
				});
				recordAppearance(state, "unsupported", `${role}:mesh-gradient`);
				return { value: fallback, opacity: paint.opacity };
			}
			// A mesh is rasterized to a bitmap pattern rather than vector paint, so
			// it is faithful pixels but not resolution-independent: record it as an
			// approximation so the export report stays honest.
			recordAppearance(state, "approximated", `${role}:mesh-gradient`);
			if (paint.opacity !== 1) {
				recordAppearance(state, "preserved", `${role}:paint-opacity`);
			}
			addStylePaintIssue(state, context, role, {
				severity: "info",
				category: "rasterized",
				code: "style-paint-rasterized",
				message: `paint ${paintKindSummary(paint)} was rasterized to a <pattern><image> bitmap (mesh gradients have no native SVG paint server).`,
				fallback: "rasterized-bitmap",
			});
			state.defs.push(def);
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
	}
};

/**
 * Resolves the leading paint of a role for the single-paint fast path (one element
 * carrying both fill and stroke). An empty list paints `none`. This is byte-identical
 * to the historical behavior: the only paint is index 0, so its def id ends `-0`.
 */
const resolveSvgPaint = (
	node: VectorNode,
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
	state: SvgRenderState,
	context: IssueContext,
): SvgPaintResolution => {
	const [paint] = paintListForRole(style, role);
	if (!paint) return { value: "none", opacity: 1 };
	return resolveSvgPaintLayer(node, paint, role, 0, style, state, context);
};

/**
 * Resolves every visible paint of a role into ordered SVG paint values, in render
 * (bottom→top) order — the leading source paint (index 0) is drawn last so it sits
 * on top. Defs are pushed in source order; only the returned values are reversed.
 * Used by the stacked render path that emits one geometry element per layer.
 */
const resolveSvgPaintLayers = (
	node: VectorNode,
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
	state: SvgRenderState,
	context: IssueContext,
): readonly SvgPaintResolution[] =>
	paintListForRole(style, role)
		.map((paint, index) =>
			resolveSvgPaintLayer(node, paint, role, index, style, state, context),
		)
		.reverse();

const visibleFallbackColor = (
	paints: readonly ResolvedPaint[],
	legacyColor: string,
): string => {
	for (const paint of paints) {
		if (paint.kind === "solid" && paint.color !== "none") return paint.color;
		if (
			(paint.kind === "linear-gradient" || paint.kind === "radial-gradient") &&
			paint.stops[0]
		) {
			return paint.stops[0].color;
		}
		if (paint.kind === "mesh-gradient" && paint.points[0]) {
			return paint.points[0].color;
		}
	}
	return legacyColor || "none";
};

const resolveSvgArtboardPaintLayer = (
	artboard: SceneDocument["artboard"],
	paint: ResolvedPaint,
	paintIndex: number,
	paints: readonly ResolvedPaint[],
	state: SvgRenderState,
): SvgPaintResolution => {
	const id = `paint-artboard-${svgIdSegment(artboard.id)}-background-${paintIndex}`;
	const fallback = visibleFallbackColor(paints, artboard.background);
	switch (paint.kind) {
		case "solid":
			return { value: paint.color, opacity: paint.opacity };
		case "linear-gradient":
			if (paint.stops.length === 0) {
				return { value: fallback, opacity: paint.opacity };
			}
			state.defs.push(linearGradientDef(id, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		case "radial-gradient":
			if (paint.stops.length === 0) {
				return { value: fallback, opacity: paint.opacity };
			}
			state.defs.push(radialGradientDef(id, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		case "image-reference": {
			const href = imagePaintHref(paint, state.scene.assets);
			if (!href) return { value: fallback, opacity: paint.opacity };
			state.defs.push(imagePatternDef(id, href, paint));
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
		case "mesh-gradient": {
			const def = meshGradientDef(id, paint);
			if (!def) return { value: fallback, opacity: paint.opacity };
			state.defs.push(def);
			return { value: `url(#${id})`, opacity: paint.opacity };
		}
	}
};

const renderArtboardBackground = (
	renderScene: SceneDocument,
	state: SvgRenderState,
): string | null => {
	const artboard = renderScene.artboard;
	// Fast path aliasing the shared cross-exporter transparency decision (see
	// `artboardBackgroundIsTransparent`'s doc comment) — when it says
	// transparent, `resolvePaints` returned an empty list, so the `.map()`
	// below is trivially empty too. Left as an explicit early return (rather
	// than folded away) so this renderer visibly agrees with every other
	// consumer of the same predicate instead of silently re-deriving it.
	if (artboardBackgroundIsTransparent(artboard)) return null;
	const paints = resolvePaints(artboard.fills, artboard.background);
	const layers = paints
		.map((paint, index) =>
			resolveSvgArtboardPaintLayer(artboard, paint, index, paints, state),
		)
		.filter((paint) => paint.value !== "none")
		.reverse();
	if (layers.length === 0) return null;
	return joinSvgParts(
		layers.map((paint, index) =>
			element("rect", [
				["x", 0],
				["y", 0],
				["width", artboard.width],
				["height", artboard.height],
				["fill", paint.value],
				["fill-opacity", paint.opacity === 1 ? undefined : paint.opacity],
				["data-artboard-background", true],
				["data-artboard-background-layer", index],
			]),
		),
	);
};

const paintAttributes = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	style: ResolvedNodeStyle,
	state: SvgRenderState,
	context: IssueContext,
	/**
	 * Opacity for this element's own paint. Defaults to the node's motion-effective
	 * opacity; a subtree-carrier caller passes `1` — see
	 * {@link renderStackedShape}'s `paintOpacity` doc for why.
	 */
	paintOpacity: number = effectiveOpacity(node, motion, frame),
): readonly (readonly [string, SvgAttributeValue])[] => {
	const fill = resolveSvgPaint(node, style, "fill", state, context);
	const stroke =
		style.strokeWidth > 0
			? resolveSvgPaint(node, style, "stroke", state, context)
			: { value: "none", opacity: 1 };
	const hasStroke = stroke.value !== "none" && style.strokeWidth > 0;
	if (hasStroke) {
		if (style.strokeDash.length > 0) {
			recordAppearance(state, "preserved", "stroke:dash");
		}
		if (style.strokeCap !== "butt") {
			recordAppearance(state, "preserved", "stroke:cap");
		}
		if (style.strokeJoin !== "miter") {
			recordAppearance(state, "preserved", "stroke:join");
		}
		if (style.strokeJoin === "miter" && style.strokeMiterLimit !== 4) {
			recordAppearance(state, "preserved", "stroke:miter-limit");
		}
	}
	const strokeParts = strokePresentation(style, hasStroke);
	return [
		["fill", fill.value],
		["fill-opacity", fill.opacity === 1 ? undefined : fill.opacity],
		["opacity", paintOpacity],
		["stroke", stroke.value],
		["stroke-opacity", stroke.opacity === 1 ? undefined : stroke.opacity],
		["stroke-width", style.strokeWidth],
		["stroke-dasharray", strokeParts.strokeDasharray],
		["stroke-dashoffset", strokeParts.strokeDashoffset],
		["stroke-linecap", strokeParts.strokeLinecap],
		["stroke-linejoin", strokeParts.strokeLinejoin],
		["stroke-miterlimit", strokeParts.strokeMiterlimit],
		["vector-effect", "non-scaling-stroke"],
	];
};

const renderPathPlaceholder = (
	shape: BezierShape,
	state: SvgRenderState,
	context: IssueContext,
): string => {
	addIssue(state, {
		severity: "warning",
		category: "invalid",
		code: "invalid-path",
		message:
			"Path could not be emitted as SVG path data and was replaced with a visible placeholder.",
		fallback: "vector-placeholder",
		...context,
	});
	const bounds = safeBounds(pathFallbackBounds(shape));
	return element("rect", [
		["x", bounds.x],
		["y", bounds.y],
		["width", bounds.width],
		["height", bounds.height],
		["fill", "#fff1ff"],
		["stroke", "#d946ef"],
		["stroke-width", 1],
		["data-export-fallback", "invalid-path"],
	]);
};

const renderImagePlaceholder = (
	bounds: Bounds,
	state: SvgRenderState,
	context: IssueContext,
	issue: Omit<SvgExportIssue, "fallback" | keyof IssueContext> & {
		readonly fallback?: SvgExportIssue["fallback"];
	},
	metadata: {
		readonly assetKind?: string;
		readonly assetFormat?: string;
		readonly capabilitySummary?: readonly string[];
		readonly programSurfaceAssetId?: string;
	} = {},
): string => {
	addIssue(state, {
		...issue,
		fallback: issue.fallback ?? "vector-placeholder",
		...context,
	});
	const safe = safeBounds(bounds);
	return element("rect", [
		["x", safe.x],
		["y", safe.y],
		["width", safe.width],
		["height", safe.height],
		["fill", "#fff1ff"],
		["stroke", "#d946ef"],
		["stroke-width", 1],
		["data-export-fallback", issue.code],
		["data-external-asset-kind", metadata.assetKind],
		["data-external-asset-format", metadata.assetFormat],
		["data-external-asset-capabilities", metadata.capabilitySummary?.join(",")],
		["data-program-surface-asset-id", metadata.programSurfaceAssetId],
	]);
};

const imageCropAttribute = (crop: Bounds): string =>
	[
		formatNumber(crop.x),
		formatNumber(crop.y),
		formatNumber(crop.width),
		formatNumber(crop.height),
	].join(" ");

const imageSourceExtent = (
	asset: { readonly width?: number; readonly height?: number },
	crop: Bounds,
): { readonly width: number; readonly height: number } => ({
	width:
		Number.isFinite(asset.width) && (asset.width ?? 0) > 0
			? (asset.width ?? 0)
			: crop.x + crop.width,
	height:
		Number.isFinite(asset.height) && (asset.height ?? 0) > 0
			? (asset.height ?? 0)
			: crop.y + crop.height,
});

const renderCroppedImageGeometry = (input: {
	readonly href: string;
	readonly assetId: string;
	readonly sourceKind: string;
	readonly bounds: Bounds;
	readonly crop: Bounds;
	readonly opacity: number;
	readonly sourceExtent: { readonly width: number; readonly height: number };
	readonly filter: string | undefined;
	readonly programSurfaceFallbackAssetId?: string;
	readonly programSurfaceFallbackFrame?: number;
}): string => {
	const {
		href,
		assetId,
		sourceKind,
		bounds,
		crop,
		opacity,
		sourceExtent,
		filter,
		programSurfaceFallbackAssetId,
		programSurfaceFallbackFrame,
	} = input;
	return `<svg ${renderAttributes([
		["x", bounds.x],
		["y", bounds.y],
		["width", bounds.width],
		["height", bounds.height],
		["viewBox", imageCropAttribute(crop)],
		["preserveAspectRatio", "none"],
		["filter", filter],
		["data-asset-id", assetId],
		["data-export-image-source", sourceKind],
		["data-image-crop", imageCropAttribute(crop)],
		["data-program-surface-fallback-asset-id", programSurfaceFallbackAssetId],
		["data-program-surface-fallback-frame", programSurfaceFallbackFrame],
	])}>
${element("image", [
	["href", href],
	["x", 0],
	["y", 0],
	["width", sourceExtent.width],
	["height", sourceExtent.height],
	["opacity", opacity],
	["preserveAspectRatio", "none"],
	["data-asset-id", assetId],
	["data-export-image-source", sourceKind],
	["data-program-surface-fallback-asset-id", programSurfaceFallbackAssetId],
	["data-program-surface-fallback-frame", programSurfaceFallbackFrame],
])}
</svg>`;
};

const programSurfaceSvgIssueCode = (
	code: ProgramSurfaceDeliveryIssueCode | undefined,
): SvgExportIssueCode => {
	switch (code) {
		case "program-surface-asset-missing":
		case "program-surface-declared-fallback-invalid":
		case "program-surface-declared-fallback-required":
		case "program-surface-manifest-invalid":
		case "program-surface-static-output-unsupported":
		case "program-surface-svg-raster-fallback":
			return code;
		default:
			return "program-surface-static-output-unsupported";
	}
};

const programSurfaceSvgIssue = (
	delivery: ProgramSurfaceDeliveryDecision,
): SvgExportIssue => ({
	severity: delivery.issue?.severity ?? "warning",
	category: delivery.issue?.category ?? "unsupported",
	code: programSurfaceSvgIssueCode(delivery.issue?.code),
	message:
		delivery.issue?.message ??
		`Program Surface "${delivery.assetId}" has no available SVG delivery route.`,
	fallback: delivery.issue?.fallback ?? "vector-placeholder",
	assetId: delivery.assetId,
});

const renderProgramSurfaceSvgFallback = (
	node: VectorNode & {
		readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
	},
	state: SvgRenderState,
	context: IssueContext,
	filter: string | undefined,
	delivery: ProgramSurfaceDeliveryDecision,
): string => {
	const fallback = delivery.fallback;
	if (!fallback) {
		return renderImagePlaceholder(
			node.geometry.bounds,
			state,
			context,
			programSurfaceSvgIssue(delivery),
			{ programSurfaceAssetId: delivery.assetId },
		);
	}
	const issue = programSurfaceSvgIssue(delivery);
	addIssue(state, { ...issue, ...context });
	const { bounds } = node.geometry;
	const crop = imagePlacementForNode(node)?.crop;
	const opacity = effectiveOpacity(node, state.motion, state.frame);
	if (crop) {
		return renderCroppedImageGeometry({
			href: fallback.href,
			assetId: delivery.assetId,
			sourceKind: fallback.asset.source.kind,
			bounds,
			crop,
			opacity,
			sourceExtent: imageSourceExtent(fallback.asset, crop),
			filter,
			programSurfaceFallbackAssetId: fallback.assetId,
			...(fallback.frame !== undefined
				? { programSurfaceFallbackFrame: fallback.frame }
				: {}),
		});
	}
	return element("image", [
		["href", fallback.href],
		["x", bounds.x],
		["y", bounds.y],
		["width", bounds.width],
		["height", bounds.height],
		["opacity", opacity],
		["preserveAspectRatio", "none"],
		["filter", filter],
		["data-asset-id", delivery.assetId],
		["data-export-image-source", fallback.asset.source.kind],
		["data-program-surface-fallback-asset-id", fallback.assetId],
		["data-program-surface-fallback-frame", fallback.frame],
	]);
};

const renderImageGeometry = (
	node: VectorNode & {
		readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
	},
	state: SvgRenderState,
	context: IssueContext,
	filter: string | undefined,
): string => {
	const { bounds } = node.geometry;
	const programSurfaceDelivery = resolveProgramSurfaceDeliveryForGeometry({
		document: state.scene,
		geometry: node.geometry,
		target: "svg",
	});
	if (programSurfaceDelivery) {
		return programSurfaceDelivery.route === "raster-fallback" &&
			programSurfaceDelivery.fallback
			? renderProgramSurfaceSvgFallback(
					node,
					state,
					context,
					filter,
					programSurfaceDelivery,
				)
			: renderImagePlaceholder(
					bounds,
					state,
					context,
					programSurfaceSvgIssue(programSurfaceDelivery),
					{ programSurfaceAssetId: programSurfaceDelivery.assetId },
				);
	}

	const resolution = resolveImageAssetReference(state.scene, node.geometry);
	if (resolution.status === "missing") {
		return renderImagePlaceholder(bounds, state, context, {
			severity: "warning",
			category: "unsupported",
			code: "image-asset-missing",
			message: `Image node references missing asset "${node.geometry.assetId}" and was exported as a visible placeholder.`,
			assetId: node.geometry.assetId,
		});
	}

	if (resolution.status === "invalid-source") {
		return renderImagePlaceholder(bounds, state, context, {
			severity: "warning",
			category: "invalid",
			code: "image-asset-invalid-source",
			message: `Image asset "${resolution.asset.id}" has no usable image source and was exported as a visible placeholder.`,
			assetId: resolution.asset.id,
		});
	}

	if (resolution.status === "unsupported-asset") {
		if (
			resolution.asset.kind === "external-scene" ||
			resolution.asset.kind === "model-3d" ||
			resolution.asset.kind === "code-module"
		) {
			return renderImagePlaceholder(
				bounds,
				state,
				context,
				{
					severity: "warning",
					category: "unsupported",
					code: "external-asset-preview-required",
					message: `External asset "${resolution.asset.id}" has no usable preview image; SVG export used a visible placeholder instead of executing or rendering the source asset.`,
					assetId: resolution.asset.id,
				},
				{
					assetKind: resolution.asset.kind,
					assetFormat: resolution.asset.format,
					capabilitySummary: resolution.asset.capabilities,
				},
			);
		}
		return renderImagePlaceholder(bounds, state, context, {
			severity: "warning",
			category: "unsupported",
			code: "video-asset-frame-required",
			message: `Video asset "${resolution.asset.id}" needs browser frame extraction before static SVG export and was exported as a visible placeholder.`,
			assetId: resolution.asset.id,
		});
	}

	const asset =
		resolution.status === "external-preview"
			? resolution.previewAsset
			: resolution.asset;
	const sourceAsset =
		resolution.status === "external-preview" ? resolution.asset : asset;
	const { href } = resolution;
	if (resolution.status === "external-preview") {
		addIssue(state, {
			severity: "warning",
			category: "fallback",
			code: "external-asset-preview-fallback",
			message: `External asset "${sourceAsset.id}" was exported as its preview image; Vecmo preserved the source metadata but did not execute or natively render the external asset.`,
			fallback: "preview-image",
			assetId: sourceAsset.id,
			...context,
		});
	}
	if (resolution.status === "reference") {
		addIssue(state, {
			severity: "warning",
			category: "fallback",
			code: "image-asset-reference-fallback",
			message: `Image asset "${asset.id}" has no embedded data URL; SVG export kept external reference "${href}".`,
			fallback: "external-image-reference",
			assetId: asset.id,
			...context,
		});
	}

	const crop = imagePlacementForNode(node)?.crop;
	const opacity = effectiveOpacity(node, state.motion, state.frame);
	if (crop) {
		return renderCroppedImageGeometry({
			href,
			assetId: asset.id,
			sourceKind: asset.source.kind,
			bounds,
			crop,
			opacity,
			sourceExtent: imageSourceExtent(asset, crop),
			filter,
		});
	}

	return element("image", [
		["href", href],
		["x", bounds.x],
		["y", bounds.y],
		["width", bounds.width],
		["height", bounds.height],
		["opacity", opacity],
		["preserveAspectRatio", "none"],
		["filter", filter],
		["data-asset-id", sourceAsset.id],
		["data-export-image-source", sourceAsset.source.kind],
	]);
};

const addTextStyleIssue = (
	state: SvgRenderState,
	context: IssueContext,
	metrics: TextMetrics,
): void => {
	const fallbackFields = textStyleFieldSummary(
		metrics.styleResolution.fallbackFields,
	);
	const normalizedFields = textStyleFieldSummary(
		metrics.styleResolution.normalizedFields,
	);
	addIssue(state, {
		severity: "info",
		category: "approximated",
		code: "text-style-approximated",
		message: [
			"Text was emitted with SVG text attributes and deterministic estimated baseline metrics because font assets are not embedded by the exporter.",
			fallbackFields ? `Style fallbacks: ${fallbackFields}.` : null,
			normalizedFields ? `Style normalizations: ${normalizedFields}.` : null,
		]
			.filter((part): part is string => part !== null)
			.join(" "),
		fallback: "fixed-text-style",
		...context,
	});
};

const textStyleFieldSummary = (
	fields: readonly string[],
): string | undefined => (fields.length > 0 ? fields.join(",") : undefined);

const textMetricsModel = (metrics: TextMetrics): string =>
	`${metrics.fontMetrics.kind}:${metrics.fontMetrics.lineModel}:${metrics.fontMetrics.widthModel}`;

const addImportClipMaskIssue = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	const relations = droppedMaskRelations(node, state);
	if (relations.length === 0) return;
	const affectedNodeIds = affectedNodeIdsForMaskRelations(
		relations,
		context.nodeId,
	);
	const affectedSummary = affectedNodeIds.join(", ");
	const importedOnly = relations.every(
		(relation) => relation.origin === "imported",
	);
	const relationSourcePaths = sortedSceneFidelitySourcePaths(
		relations.map((relation) => relation.sourcePath),
	);
	addIssue(state, {
		severity: "warning",
		category: "unsupported",
		code: importedOnly ? "import-clip-mask-fallback" : "mask-relation-fallback",
		message: `${importedOnly ? "Imported c" : "C"}lip/mask relation metadata (${maskRelationSourceSummary(relations)}) cannot be re-emitted by SVG export yet; affected nodes (${affectedSummary}) were exported as unclipped vector geometry.`,
		fallback: "unclipped-vector",
		...context,
		...(relationSourcePaths.length > 0
			? { sourcePaths: relationSourcePaths }
			: {}),
	});
};

const addImportEffectIssue = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	const effects = readImportedEffects(node).filter(
		(effect) => !isImportedClipMaskKind(effect.kind),
	);
	if (effects.length === 0) return;
	const effectSourcePaths = sortedSceneFidelitySourcePaths(
		effects.map((effect) => effect.sourcePath),
	);
	addIssue(state, {
		severity: "warning",
		category: "unsupported",
		code: "import-effect-unsupported",
		message: `Imported effect metadata (${effects
			.map((effect) => effect.kind)
			.join(
				", ",
			)}) has no scene/export representation; node was exported as unclipped vector geometry.`,
		fallback: "unclipped-vector",
		...context,
		...(effectSourcePaths.length > 0 ? { sourcePaths: effectSourcePaths } : {}),
	});
};

const addImportOpacityGroupIssue = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	const groups = readImportedOpacityGroups(node);
	if (groups.length === 0) return;
	const groupSourcePaths = sortedSceneFidelitySourcePaths(
		groups.map((group) => group.sourcePath),
	);
	addIssue(state, {
		severity: "info",
		category: "approximated",
		code: "import-opacity-group-flattened",
		message: `Imported opacity group metadata (${groups
			.map((group) => `${group.source} ${group.opacity}`)
			.join(
				", ",
			)}) was flattened into node opacity; overlapping children may not composite exactly as the source.`,
		fallback: "normalized-value",
		...context,
		...(groupSourcePaths.length > 0 ? { sourcePaths: groupSourcePaths } : {}),
	});
};

const addImportPaintIssues = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	const paint = readImportedPaint(node);
	if (!paint) return;
	for (const role of ["fill", "stroke"] as const) {
		const entry = paint[role];
		if (!entry) continue;
		const ref = entry.ref ? ` #${entry.ref}` : "";
		const unsupported = entry.unsupported === true;
		const entrySourcePaths = sortedSceneFidelitySourcePaths([entry.sourcePath]);
		addIssue(state, {
			severity: unsupported ? "warning" : "info",
			category: unsupported ? "unsupported" : "approximated",
			code: unsupported
				? "import-paint-unsupported"
				: "import-paint-approximated",
			message: unsupported
				? `Imported ${role} paint ${entry.source}${ref} had no usable scene paint and was exported with fallback ${entry.fallback}.`
				: `Imported ${role} paint ${entry.source}${ref} was flattened to solid ${entry.fallback} for scene/export compatibility.`,
			fallback: "default-color",
			...context,
			...(entrySourcePaths.length > 0 ? { sourcePaths: entrySourcePaths } : {}),
		});
	}
};

const addImportCompoundPathIssue = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	const compound = readImportedCompoundPath(node);
	if (!compound) return;
	const compoundSourcePaths = sortedSceneFidelitySourcePaths([
		compound.sourcePath,
	]);
	addIssue(state, {
		severity: "info",
		category: "approximated",
		code: "import-compound-path-split",
		message: `Imported compound path subpath ${compound.subpathIndex ?? "?"} of ${compound.subpathCount ?? "?"} was exported as an independent editable path using ${compound.fillRule ?? "unknown"} fill-rule metadata.`,
		fallback: "normalized-value",
		...context,
		...(compoundSourcePaths.length > 0
			? { sourcePaths: compoundSourcePaths }
			: {}),
	});
};

/**
 * Surfaces ONLY the effects that the SVG filter pipeline could not render —
 * driven by {@link EffectFilterSpec.deferred}: unsupported background blur and
 * typed Effect Field owner/fidelity failures. Drop/inner shadows and supported
 * layer-blur fields ship as a real `<filter>`, so they do not raise an issue. The
 * `style-effect-unsupported` code is reused (no union churn); the message names
 * exactly which effect(s) were dropped and why.
 */
const addStyleEffectIssue = (
	spec: EffectFilterSpec | null,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	if (!spec || spec.deferred.length === 0) return;
	const dropped = spec.deferred.map((effect) => effect.kind).join(", ");
	for (const effect of spec.deferred) {
		recordAppearance(state, "unsupported", `effect:${effect.kind}`);
	}
	addIssue(state, {
		severity: "warning",
		category: "unsupported",
		code: "style-effect-unsupported",
		message: `Node effects (${dropped}) were deferred from SVG export: ${spec.deferred
			.map((effect) => effect.reason)
			.join(
				"; ",
			)}. All other supported effects were rendered as an SVG filter.`,
		fallback: "normalized-value",
		...context,
	});
};

const addStyleStrokeAlignIssue = (
	style: ResolvedNodeStyle,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	if (
		style.strokeAlign === "center" ||
		style.strokeWidth <= 0 ||
		paintListForRole(style, "stroke").length === 0
	) {
		return;
	}
	recordAppearance(state, "unsupported", "stroke:align");
	addIssue(state, {
		severity: "warning",
		category: "unsupported",
		code: "style-stroke-align-unsupported",
		message: `Stroke align "${style.strokeAlign}" cannot be emitted by SVG export yet; stroke was exported centered.`,
		fallback: "normalized-value",
		...context,
	});
};

const addVecCoreRecipeSvgIssues = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
): void => {
	const recipe = resolveNodeRecipe(node);
	if (!recipe) return;
	recordAppearance(state, "preserved", "recipe:sidecar");
	const analysis = analyzeVecCoreRecipeSvgApproximation(recipe);
	if (analysis.approximatedPaths.length > 0) {
		recordAppearance(state, "approximated", "recipe:svg-filter");
		addIssue(state, {
			severity: "warning",
			category: "approximated",
			code: VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
			message: `Vec-core recipe "${recipe.label}" was rendered through the SVG filter approximation tier (${vecCoreRecipePathSummary(analysis.approximatedPaths)}); the canonical high-fidelity payload is exported beside the SVG as .recipe.json.`,
			fallback: "normalized-value",
			...context,
		});
	}
	if (analysis.unsupportedPaths.length > 0) {
		recordAppearance(state, "unsupported", "recipe:high-fidelity-only");
		addIssue(state, {
			severity: "warning",
			category: "unsupported",
			code: VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE,
			message: `Vec-core recipe "${recipe.label}" contains high-fidelity fields not represented by SVG filters (${vecCoreRecipePathSummary(analysis.unsupportedPaths)}); those fields are preserved only in the .recipe.json payload.`,
			fallback: "normalized-value",
			...context,
		});
	}
};

/**
 * SVG `transform` for one fragment pose: position delta, then a pivot-anchored
 * rotation, then a pivot-anchored scale. Each clause is emitted only when it does
 * work, so a position-only reveal (Word Rise) stays a bare `translate`.
 */
const fragmentTransformAttribute = (
	pose: TextFragmentPose,
): string | undefined => {
	const parts: string[] = [];
	if (pose.translate.x !== 0 || pose.translate.y !== 0) {
		parts.push(
			`translate(${formatNumber(pose.translate.x)} ${formatNumber(pose.translate.y)})`,
		);
	}
	if (pose.rotation !== 0) {
		parts.push(
			`rotate(${formatNumber(pose.rotation)} ${formatNumber(pose.pivot.x)} ${formatNumber(pose.pivot.y)})`,
		);
	}
	if (pose.scaleX !== 1 || pose.scaleY !== 1) {
		parts.push(
			`translate(${formatNumber(pose.pivot.x)} ${formatNumber(pose.pivot.y)}) scale(${formatNumber(pose.scaleX)} ${formatNumber(pose.scaleY)}) translate(${formatNumber(-pose.pivot.x)} ${formatNumber(-pose.pivot.y)})`,
		);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
};

/**
 * Renders a text node split into per-fragment `<text>` elements driven by a text
 * animator. Each fragment is positioned absolutely at its measured left edge so the
 * group overlays the plain `<text>` render at rest, then carries its pose transform
 * and node-opacity × fragment-opacity. Separate `<text>` elements (not `<tspan>`)
 * are required because per-fragment scale/rotation transforms are unreliable on
 * `<tspan>` across browsers.
 */
const renderAnimatedTextFragments = (
	render: TextAnimatorRender,
	metrics: TextMetrics,
	paint: readonly (readonly [string, SvgAttributeValue])[],
	nodeOpacity: number,
): string => {
	const fragmentPaint = paint.filter(([key]) => key !== "opacity");
	const fontAttributes: readonly (readonly [string, SvgAttributeValue])[] = [
		["font-family", metrics.style.fontFamily],
		["font-size", metrics.style.fontSize],
		["font-weight", metrics.style.fontWeight],
		["font-style", metrics.style.italic ? "italic" : undefined],
		["text-decoration", metrics.style.underline ? "underline" : undefined],
		[
			"letter-spacing",
			metrics.style.letterSpacing === 0
				? undefined
				: metrics.style.letterSpacing,
		],
		["text-anchor", "start"],
	];
	const texts = render.fragments
		.map((fragment, index) => {
			if (fragment.text.length === 0) return "";
			const pose = render.evaluation.poses[index];
			const opacity = nodeOpacity * (pose?.opacity ?? 1);
			return `<text ${renderAttributes([
				...fragmentPaint,
				...fontAttributes,
				["x", fragment.bounds.x],
				["y", fragment.baseline],
				["opacity", opacity === 1 ? undefined : opacity],
				["transform", pose ? fragmentTransformAttribute(pose) : undefined],
				["data-text-fragment-id", fragment.id],
				["data-text-fragment-order", fragment.orderIndex],
			])}>${escapeText(fragment.text)}</text>`;
		})
		.join("");
	return `<g ${renderAttributes([
		["data-text-fragments", render.evaluation.unit],
	])}>${texts}</g>`;
};

/**
 * Renders one geometry element with the given paint attributes. `filterAttribute`
 * is used only by the image case (other kinds carry the filter inside `paint`).
 * Factored out of `renderShape` so the stacked path can emit it once per paint layer.
 */
const geometryElement = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
	paint: readonly (readonly [string, SvgAttributeValue])[],
	filterAttribute: string | undefined,
): string => {
	switch (node.geometry.kind) {
		case "rect": {
			// Sample corner radii + smoothing at the frame (consistent with the inline
			// transform/opacity/shape sampling); static export resolves to the base.
			const sampledRadii = effectiveCornerRadii(
				node,
				state.motion,
				state.frame,
			);
			const sampledSmoothing = effectiveCornerSmoothing(
				node,
				state.motion,
				state.frame,
			);
			const rect = sampledRadii
				? {
						...node.geometry,
						cornerRadii: sampledRadii,
						cornerSmoothing: sampledSmoothing ?? node.geometry.cornerSmoothing,
					}
				: node.geometry;
			// Per-corner / squircle corners cannot be expressed by <rect rx>; emit a
			// baked <path> from the shared corner builder so SVG matches the canvas.
			if (rectNeedsBakedPath(rect)) {
				return element("path", [...paint, ["d", roundedRectPathData(rect)]]);
			}
			return element("rect", [
				...paint,
				["x", rect.bounds.x],
				["y", rect.bounds.y],
				["width", rect.bounds.width],
				["height", rect.bounds.height],
				["rx", sampledRadii ? sampledRadii.tl : rect.cornerRadius],
			]);
		}
		case "ellipse":
			return element("ellipse", [
				...paint,
				["cx", node.geometry.bounds.x + node.geometry.bounds.width / 2],
				["cy", node.geometry.bounds.y + node.geometry.bounds.height / 2],
				["rx", node.geometry.bounds.width / 2],
				["ry", node.geometry.bounds.height / 2],
			]);
		case "line":
			return element("line", [
				...paint,
				["x1", node.geometry.start.x],
				["y1", node.geometry.start.y],
				["x2", node.geometry.end.x],
				["y2", node.geometry.end.y],
			]);
		case "polygon": {
			const polygon = {
				...node.geometry,
				cornerRadius:
					effectiveCornerRadius(node, state.motion, state.frame) ??
					node.geometry.cornerRadius,
				cornerSmoothing:
					effectiveCornerSmoothing(node, state.motion, state.frame) ??
					node.geometry.cornerSmoothing,
			};
			if (shapeNeedsBakedPath(polygon)) {
				return element("path", [
					...paint,
					["d", roundedPolygonPathData(polygon)],
				]);
			}
			return element("polygon", [
				...paint,
				["points", pointList(polygon.points)],
			]);
		}
		case "star": {
			const star = {
				...node.geometry,
				cornerRadius:
					effectiveCornerRadius(node, state.motion, state.frame) ??
					node.geometry.cornerRadius,
				cornerSmoothing:
					effectiveCornerSmoothing(node, state.motion, state.frame) ??
					node.geometry.cornerSmoothing,
			};
			if (shapeNeedsBakedPath(star)) {
				return element("path", [...paint, ["d", roundedStarPathData(star)]]);
			}
			return element("polygon", [...paint, ["points", starPoints(star)]]);
		}
		case "path": {
			const sampledShape = effectiveShape(node, state.motion, state.frame);
			const shape = sampledShape ?? node.geometry.shape;
			const pathData = compoundPathData(shape, node.geometry.subpaths ?? []);
			if (!pathData) return renderPathPlaceholder(shape, state, context);
			const pathAttributes: (readonly [string, SvgAttributeValue])[] = [
				...paint,
				["d", pathData],
			];
			if (node.geometry.fillRule === "evenodd") {
				pathAttributes.push(["fill-rule", "evenodd"]);
			}
			return element("path", pathAttributes);
		}
		case "text": {
			const { bounds } = node.geometry;
			const metrics = textMetricsForGeometry(node.geometry);
			addTextStyleIssue(state, context, metrics);
			// Export uses the deterministic estimate measurer (Worker-safe). When a
			// text animator is active the node renders as split per-fragment <text>;
			// otherwise it keeps the cheap single-<text> line path below.
			const animatorRender = resolveTextAnimatorRender(
				node,
				state.motion,
				state.frame,
				state.measurer,
				createExpressionFrameContext(state.scene, state.motion, state.frame),
			);
			if (animatorRender) {
				return renderAnimatedTextFragments(
					animatorRender,
					metrics,
					paint,
					effectiveOpacity(node, state.motion, state.frame),
				);
			}
			const anchorX = textAnchorXForAlign(bounds, metrics.style.align);
			const firstBaseline =
				metrics.lineMetrics[0]?.baseline ??
				bounds.y + metrics.fontMetrics.baselineOffset;
			const tspans = metrics.lines
				.map((line, index) => {
					const lineMetric = metrics.lineMetrics[index];
					const previousLineMetric = metrics.lineMetrics[index - 1];
					return `<tspan ${renderAttributes([
						["x", anchorX],
						[
							"dy",
							index === 0
								? 0
								: (lineMetric?.baseline ?? 0) -
									(previousLineMetric?.baseline ?? 0),
						],
						["data-line-top", lineMetric?.top],
						["data-line-baseline", lineMetric?.baseline],
						["data-line-width", lineMetric?.width],
					])}>${escapeText(line)}</tspan>`;
				})
				.join("");
			return `<text ${renderAttributes([
				...paint,
				["x", anchorX],
				["y", firstBaseline],
				["font-family", metrics.style.fontFamily],
				["font-size", metrics.style.fontSize],
				["font-weight", metrics.style.fontWeight],
				["font-style", metrics.style.italic ? "italic" : undefined],
				["text-decoration", metrics.style.underline ? "underline" : undefined],
				[
					"letter-spacing",
					metrics.style.letterSpacing === 0
						? undefined
						: metrics.style.letterSpacing,
				],
				["text-anchor", svgTextAnchorForAlign(metrics.style.align)],
				["data-text-metrics", textMetricsModel(metrics)],
				["data-text-baseline-offset", metrics.fontMetrics.baselineOffset],
				[
					"data-text-style-fallbacks",
					textStyleFieldSummary(metrics.styleResolution.fallbackFields),
				],
				[
					"data-text-style-normalized",
					textStyleFieldSummary(metrics.styleResolution.normalizedFields),
				],
			])}>${tspans}</text>`;
		}
		case "image":
			return renderImageGeometry(
				node as VectorNode & {
					readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
				},
				state,
				context,
				filterAttribute,
			);
	}
};

/**
 * Renders a node whose appearance stacks more than one fill or stroke. Each paint
 * becomes its own geometry element (fills bottom→top, then strokes above all fills)
 * inside one wrapper `<g>` that owns the node opacity and the effect filter, so the
 * composited stack fades/filters as a unit. Strokes share the node's single
 * weight/dash/cap/join (the schema has no per-stroke geometry). Image geometry never
 * reaches here — it has no fill/stroke stack — so the caller keeps it on the fast path.
 */
const renderStackedShape = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
	style: ResolvedNodeStyle,
	filterAttribute: string | undefined,
	/**
	 * Opacity for this element's own paint. Defaults to the node's motion-effective
	 * opacity; a subtree-carrier caller (see `hasSubtreeCarrier`: group, Blend, or
	 * frame) passes `1` because `renderNode` already wraps this element plus its
	 * children in a subtree-carrier `<g>` that owns the node opacity — see that
	 * function's doc.
	 */
	paintOpacity: number = effectiveOpacity(node, state.motion, state.frame),
): string => {
	const fillLayers = resolveSvgPaintLayers(node, style, "fill", state, context);
	const strokeLayers =
		style.strokeWidth > 0
			? resolveSvgPaintLayers(node, style, "stroke", state, context)
			: [];
	const hasStroke = strokeLayers.length > 0;
	// Mirror the stroke-presentation fidelity records that `paintAttributes` makes on
	// the single-paint path, so the export report is identical for shared stroke geometry.
	if (hasStroke) {
		if (style.strokeDash.length > 0) {
			recordAppearance(state, "preserved", "stroke:dash");
		}
		if (style.strokeCap !== "butt") {
			recordAppearance(state, "preserved", "stroke:cap");
		}
		if (style.strokeJoin !== "miter") {
			recordAppearance(state, "preserved", "stroke:join");
		}
		if (style.strokeJoin === "miter" && style.strokeMiterLimit !== 4) {
			recordAppearance(state, "preserved", "stroke:miter-limit");
		}
	}
	const strokeParts = strokePresentation(style, hasStroke);
	const fillElements = fillLayers.map((layer) =>
		geometryElement(
			node,
			state,
			context,
			[
				["fill", layer.value],
				["fill-opacity", layer.opacity === 1 ? undefined : layer.opacity],
				["stroke", "none"],
				["vector-effect", "non-scaling-stroke"],
			],
			undefined,
		),
	);
	const strokeElements = strokeLayers.map((layer) =>
		geometryElement(
			node,
			state,
			context,
			[
				["fill", "none"],
				["stroke", layer.value],
				["stroke-opacity", layer.opacity === 1 ? undefined : layer.opacity],
				["stroke-width", style.strokeWidth],
				["stroke-dasharray", strokeParts.strokeDasharray],
				["stroke-dashoffset", strokeParts.strokeDashoffset],
				["stroke-linecap", strokeParts.strokeLinecap],
				["stroke-linejoin", strokeParts.strokeLinejoin],
				["stroke-miterlimit", strokeParts.strokeMiterlimit],
				["vector-effect", "non-scaling-stroke"],
			],
			undefined,
		),
	);
	// Stroke-only blur: keep the fill stack sharp and Gaussian-blur just the stroke
	// group. Node opacity and the node effect filter stay on the outer <g> so they
	// apply to the COMBINED result, not to fill and stroke independently.
	const strokeBlurActive = hasStroke && style.strokeBlurRadius > 0;
	if (strokeBlurActive) {
		recordAppearance(state, "preserved", "stroke:blur");
		state.defs.push(strokeBlurFilterDefSvg(node, style));
	}
	const strokeMarkup =
		strokeBlurActive && strokeElements.length > 0
			? `<g ${renderAttributes([
					["filter", `url(#${strokeBlurFilterId(node.id)})`],
				])}>\n${strokeElements.join("\n")}\n</g>`
			: strokeElements.join("\n");
	const body = [...fillElements, strokeMarkup].filter(Boolean).join("\n");
	return `<g ${renderAttributes([
		["opacity", paintOpacity],
		["filter", filterAttribute],
	])}>\n${body}\n</g>`;
};

const renderShape = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
	style: ResolvedNodeStyle,
	filterSpec: EffectFilterSpec | null,
	/**
	 * True for a {@link hasSubtreeCarrier} node (group, Blend, or frame): its own
	 * filter/opacity are applied by `renderNode`'s subtree carrier instead of this
	 * shape element, so this shape renders with neither — filter is dropped
	 * entirely and paint opacity is forced to 1. For a group/Blend this shape is
	 * always the invisible degenerate placeholder, so the override is a
	 * DOM-cleanliness choice with no visual effect; for a frame this shape IS the
	 * real background paint, so the override is load-bearing (prevents double
	 * opacity/filter application: once here, once on the carrier). The filter
	 * `<def>` is still pushed unconditionally below because the carrier needs
	 * `filterSpec.id` to reference it.
	 */
	subtreeCarrier = false,
	/**
	 * True for the single node of a revealing object-Noise-Gradient dissolve run
	 * (see `renderNode`'s `revealingFilter` param): forces paint opacity to 1,
	 * like `subtreeCarrier`, but WITHOUT dropping `filterSpec` — the node's own
	 * effect filter (if any) still belongs on this element, innermost, with the
	 * scoped-look dissolve filter wrapping it from `renderNode` one level out
	 * (see that function's `revealingFilter` doc). Opacity moves to `renderNode`'s
	 * `<g data-node-id>` wrapper instead, so the (underlay + this filtered shape)
	 * pair fades as one object — the two params are independent because a
	 * subtree carrier drops the filter too (children render as its siblings, so
	 * a filter left here would miss them), while a revealing node's children (if
	 * any — none in practice, see `revealPaintForNode`'s doc) still need this
	 * element's OWN filter for its own appearance.
	 */
	forcePaintOpacityToOne = false,
): string => {
	addImportPaintIssues(node, state, context);
	addImportCompoundPathIssue(node, state, context);
	addImportOpacityGroupIssue(node, state, context);
	addImportClipMaskIssue(node, state, context);
	addImportEffectIssue(node, state, context);
	// Reference the filter on the inner shape element (never the transformed <g>):
	// the region is geometry-local, so the same def aligns across all renderers.
	// `serializeEffectFilter` is "" for a deferred-only spec, so emit a def and the
	// attr ONLY when the spec carries renderable primitives. A subtree-carrier node
	// never attaches the attribute here (see the `subtreeCarrier` param doc) but the
	// def is still pushed so `renderNode`'s carrier can reference the same id.
	const filterAttribute =
		!subtreeCarrier && filterSpec && filterSpec.primitives.length > 0
			? `url(#${filterSpec.id})`
			: undefined;
	if (filterSpec && filterSpec.primitives.length > 0) {
		recordAppearance(state, "preserved", "effect-filter");
		state.defs.push(serializeEffectFilter(filterSpec));
	}
	const paintOpacity =
		subtreeCarrier || forcePaintOpacityToOne
			? 1
			: effectiveOpacity(node, state.motion, state.frame);

	// A node carrying more than one fill or stroke renders each paint as its own
	// stacked layer; the common single-paint node keeps the byte-identical fast path
	// (one element with the node opacity, filter, and both fill and stroke). Stroke-
	// only blur also forces the split path even for the single-fill/single-stroke
	// case, because the blur must reach the stroke group without touching the fill.
	const needsStrokeBlur = style.strokeWidth > 0 && style.strokeBlurRadius > 0;
	if (
		node.geometry.kind !== "image" &&
		(style.fills.length > 1 || style.strokes.length > 1 || needsStrokeBlur)
	) {
		return renderStackedShape(
			node,
			state,
			context,
			style,
			filterAttribute,
			paintOpacity,
		);
	}

	// A variable-width stroke profile expands to a separate filled outline path
	// instead of a uniform SVG stroke — see `getStrokeWidthProfileOutline`'s doc
	// for the eligibility gate (only ever true here on the single-paint fast
	// path; the stacked multi-paint path above never qualifies). The outline's
	// fill is the RAW legacy `node.style.stroke` color, not a resolved paint
	// value: an explicit empty `strokes[]` stack resolves to `"none"` even
	// though the legacy color the profile expands is still real, so resolving
	// through `resolveSvgPaint` here would silently paint an invisible outline
	// for that case (mirrors the canvas renderer's identical `VectorShape`
	// branch, which reuses this exact rationale). Both elements share one
	// wrapping `<g>` for opacity/filter — matching `renderStackedShape` — so a
	// blur/shadow or opacity < 1 applies once to the composited result instead
	// of twice (double shadow) or with a visible seam (overlapping siblings).
	const outlineShape =
		node.geometry.kind === "path" ? getStrokeWidthProfileOutline(node) : null;
	if (outlineShape) {
		// The filled outline replaces the uniform stroke, so a dash pattern has
		// nothing to apply to; record the drop for export fidelity reporting.
		if (style.strokeDash.length > 0) {
			recordAppearance(state, "approximated", "stroke:dash");
		}
		const basePaint = [
			["fill", resolveSvgPaint(node, style, "fill", state, context).value],
			["stroke", "none"],
			["vector-effect", "non-scaling-stroke"],
		] satisfies (readonly [string, SvgAttributeValue])[];
		const baseElement = geometryElement(
			node,
			state,
			context,
			basePaint,
			undefined,
		);
		const outlineData = compoundPathData(outlineShape, []);
		const outlineElement = outlineData
			? element("path", [
					["fill", node.style.stroke],
					["fill-rule", "nonzero"],
					["d", outlineData],
				])
			: renderPathPlaceholder(outlineShape, state, context);
		return `<g ${renderAttributes([
			["opacity", paintOpacity],
			["filter", filterAttribute],
		])}>\n${baseElement}\n${outlineElement}\n</g>`;
	}

	const basePaint = paintAttributes(
		node,
		state.motion,
		state.frame,
		style,
		state,
		context,
		paintOpacity,
	);
	const paint: readonly (readonly [string, SvgAttributeValue])[] =
		filterAttribute ? [...basePaint, ["filter", filterAttribute]] : basePaint;
	return geometryElement(node, state, context, paint, filterAttribute);
};

/**
 * Resolves the second color/gradient a node's Noise Gradient dissolve reveals
 * underneath its own fill, or `null` when this overlay carries no such
 * reveal. Mirrors `revealPaintForNode` in `CanvasShell.tsx` exactly: takes the
 * scoped overlay directly (the caller already knows it — a run's every node
 * shares one overlay, see `renderScopedLookGraphRun`) rather than looking it
 * up by nodeId: `renderScopedLookGraphRun` calls this once per run to decide
 * whether the run is a revealing one at all, and a revealing run is always a
 * run of one, so there is never a second node in the SAME call whose overlay
 * this could disagree with. Gated on BOTH the overlay actually being an
 * object-Noise-Gradient overlay (never Path Blur or a generic selection
 * graph) AND the grain node's effective texture blend mode resolving to
 * `"dissolve"` — every other blend mode has no "hole" in the object's own
 * fill for a reveal color to show through.
 */
const revealPaintForNode = (
	overlay: ScopedLookGraphOverlay | null | undefined,
): RevealPaint | null => {
	if (!overlay || !isObjectNoiseGradientScopedLook(overlay)) return null;
	const grainNode = objectNoiseGradientParticleNode(overlay);
	if (grainNode?.payload.kind !== "grain") return null;
	const { payload } = grainNode;
	if (!payload.revealPaint) return null;
	if (effectiveTextureBlendMode(payload.texture.material) !== "dissolve") {
		return null;
	}
	return payload.revealPaint;
};

/**
 * Serializes `revealPaint` to an SVG paint value, pushing a gradient def when
 * needed. Reuses `linearGradientDef`/`radialGradientDef` — the SAME
 * paint-server serializer `resolveSvgPaintLayer` uses for a node's own
 * `fills`/`strokes` (`paint-server-svg.ts`'s single source of truth) — rather
 * than routing through `resolveSvgPaintLayer` itself, which also records
 * per-role (`fill`/`stroke`) appearance-fidelity issues that would misattribute
 * this dissolve-reveal paint as the node's ordinary fill/stroke.
 */
const revealPaintValue = (
	revealPaint: RevealPaint,
	paintDomId: string,
	state: SvgRenderState,
): string => {
	const resolved = resolvePaints([revealPaint], "none")[0];
	if (!resolved) return "none";
	switch (resolved.kind) {
		case "solid":
			return resolved.color;
		case "linear-gradient":
			if (resolved.stops.length === 0) return "none";
			state.defs.push(linearGradientDef(paintDomId, resolved));
			return `url(#${paintDomId})`;
		case "radial-gradient":
			if (resolved.stops.length === 0) return "none";
			state.defs.push(radialGradientDef(paintDomId, resolved));
			return `url(#${paintDomId})`;
		default:
			return "none";
	}
};

/**
 * Renders the SAME node geometry filled with `revealPaint`, carrying NO
 * filter and NO opacity of its own, as a string sibling underlay for a Noise
 * Gradient dissolve. Rendered by `renderNode` as a sibling immediately BEFORE
 * the dissolve-filtered `<g filter>`, INSIDE that node's own `<g
 * data-node-id>` (SVG paints earlier siblings first/below, so it still
 * composites underneath) — mirrors `RevealUnderlay` in `CanvasShell.tsx`.
 * Returns `""` when the resolved paint has nothing to draw (e.g. a stop-less
 * gradient).
 *
 * Carries no `transform` of its own: sitting inside the node's own `<g
 * data-node-id>` means it inherits that group's transform for free, unlike
 * the pre-fix architecture where it rendered as a sibling OUTSIDE that group
 * and needed its own duplicated `transform` attribute to land in the same
 * place.
 *
 * Carries no `opacity` of its own either — opacity now lives ONLY on the
 * `<g data-node-id>` wrapper (see `renderNode`'s `revealingFilter` param), so
 * the (underlay + filtered content) pair fades as ONE object instead of two
 * independently-translucent overlapping layers (the F1 opacity-bleed bug this
 * restructure fixes).
 *
 * Deliberately does NOT carry `SVG_RENDER_PART_ATTRIBUTE`/`SVG_RENDER_PARTS.paint`
 * (same reasoning as `RevealUnderlay` in `CanvasShell.tsx`): `data-render-part`
 * is reserved for the renderer-owned parts a DOM re-querier resolves by
 * first-match `querySelector`. This underlay uses its own distinct
 * `data-reveal-underlay` marker instead, both so that query still resolves
 * past it to the real filtered content group and so a reveal underlay
 * (authored-static appearance, no keyframing/bindable, per this feature's v1
 * scope) is never mistaken for a renderer-owned part.
 *
 * Being INSIDE the node's own wrapper means it needs no pose-mirroring
 * attribute at all: this string exporter always renders one exact frame with
 * the node's own transform already applied to the wrapper it now sits inside,
 * and the live canvas's equivalent (`RevealUnderlay` in `CanvasShell.tsx`)
 * gets its structural motion-tracking (Play AND live-drag) for free from the
 * SAME containment — see that component's doc.
 */
const renderRevealUnderlay = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
	revealPaint: RevealPaint,
): string => {
	const paintDomId = `paint-${svgIdSegment(node.id)}-reveal`;
	const value = revealPaintValue(revealPaint, paintDomId, state);
	if (value === "none") return "";
	return `<g ${renderAttributes([
		["data-reveal-underlay", "true"],
		["pointer-events", "none"],
	])}>\n${geometryElement(
		node,
		state,
		context,
		[
			["fill", value],
			["stroke", "none"],
			["vector-effect", "non-scaling-stroke"],
		],
		undefined,
	)}\n</g>`;
};

const renderNode = (
	node: VectorNode,
	state: SvgRenderState,
	context: IssueContext,
	options: {
		readonly suppressScopedLookGraphOverlay?: boolean;
		/**
		 * Set by `renderScopedLookGraphRun` ONLY for the single node of a
		 * revealing object-Noise-Gradient dissolve run (see that function's
		 * doc). When present, this node's dissolve filter and `revealPaint`
		 * underlay render INSIDE this node's own `<g data-node-id>` instead of
		 * `renderScopedLookGraphRun` wrapping this node's whole rendered string
		 * from outside — see the `contents`/`group` construction below for the
		 * resulting structure and why it is what makes
		 * opacity/blend-mode/motion-playback treat the (underlay + filtered
		 * content) pair as ONE object. Mirrors `SceneNode`'s `revealingFilter`
		 * prop in `CanvasShell.tsx` exactly.
		 */
		readonly revealingFilter?: {
			readonly filterId: string;
			readonly revealPaint: RevealPaint;
		} | null;
	} = {},
): string | null => {
	if (!node.visible) return null;
	// A node consumed as a representable mask source is not painted as ordinary
	// geometry: only its silhouette (emitted as a <clipPath>/<mask> def) clips the
	// masked content, matching Figma/Illustrator "use as mask" semantics.
	if (state.maskPlan.consumedMaskNodeIds.has(node.id)) return null;

	const nodeContext = { ...context, nodeId: node.id };
	const style = resolveExportNodeStyle(node);
	const recipe = resolveNodeRecipe(node);
	const effectFieldRouting = compileEffectFieldRoutesForNode(
		state.effectInfluenceRecipe,
		node.id,
		"svg-export",
	);
	const hasCarrier = hasSubtreeCarrier(node);
	// `revealingFilter` is only ever set for the single node of a revealing
	// object-NG dissolve, and that overlay source never targets a
	// `hasSubtreeCarrier` node (see `renderScopedLookGraphRunRevealUnderlays`'s
	// former `!hasSubtreeCarrier` gate, now folded into this same condition) —
	// `!hasCarrier` here is a defensive guard, not a live branch today.
	const reveal = !hasCarrier ? (options.revealingFilter ?? null) : null;
	addVecCoreRecipeSvgIssues(node, state, nodeContext);
	// Build the node's effect filter ONCE here: the spec drives the inner-shape
	// filter attr/def (in renderShape), the dropped-effect issue, and the
	// data-export-dropped-style-effects <g> attribute, so all three agree. A
	// subtree-carrier node's filter region must cover everything the carrier
	// composites — see `effectFilterBoundsForNode`'s doc for why that is the
	// children-only union for a group/Blend's degenerate own geometry, but the
	// own-geometry-UNION-children paint bounds for a frame's real background.
	const filterSpec = buildEffectFilter(
		node.id,
		style.effects,
		effectFilterBoundsForNode(node),
		style.strokeWidth,
		recipe,
		state.rasterSafe,
		state.fps > 0 ? state.frame / state.fps : 0,
		effectFieldRouting.routes,
		state.sourceOpticsPresentation?.nodePlans[node.id],
	);
	addStyleEffectIssue(filterSpec, state, nodeContext);
	if (effectFieldRouting.issues.length > 0) {
		recordAppearance(state, "unsupported", "effect-field:routing");
		addIssue(state, {
			severity: "warning",
			category: "unsupported",
			code: "style-effect-unsupported",
			message: `Effect Field routing was not applied: ${effectFieldRouting.issues
				.map((issue) => issue.detail)
				.join("; ")}.`,
			fallback: "normalized-value",
			...nodeContext,
		});
	}
	addStyleStrokeAlignIssue(style, state, nodeContext);
	const transform = effectiveTransform(node, state.motion, state.frame);
	if (style.blendMode !== "normal") {
		recordAppearance(state, "preserved", "blend-mode");
	}
	const children = node.children
		? renderNodeList(node.children, state, nodeContext, options)
		: "";
	const shape = node.motionController
		? ""
		: renderShape(
				node,
				state,
				nodeContext,
				style,
				filterSpec,
				hasCarrier,
				Boolean(reveal),
			);
	// A subtree-carrier node's (group, Blend, or frame) own opacity/effect filter
	// would be visually dead if left only on its own shape (the bug this carrier
	// fixes): for group/Blend that shape is a degenerate placeholder and children
	// render as SIBLINGS, not descendants, of it; for a frame that shape is real
	// background paint but is likewise just one layer among sibling children, not
	// their ancestor. The subtree carrier is an UNTRANSFORMED inner `<g>` (it sits
	// inside this node's own transformed `<g>` below, so a second transform would
	// double it) wrapping the node's own shape AND its children, so opacity and the
	// filter (whose region is geometry-local/composite-local, see the filterSpec
	// comment above) composite over the whole subtree as one unit. It is ALWAYS
	// emitted for a `hasSubtreeCarrier` node — even at opacity 1 with no effects —
	// matching the canvas renderer (`CanvasShell.tsx` `SceneNode`) so a group
	// crossing opacity 1.0 during motion never needs a structural DOM change
	// mid-animation.
	const subtreeCarrierFilterAttribute =
		filterSpec && filterSpec.primitives.length > 0
			? `url(#${filterSpec.id})`
			: undefined;
	const shapeAndChildren = [shape, ...(children ? [children] : [])].join("\n");
	// A Noise Gradient dissolve's `revealPaint` underlay (see
	// `revealPaintForNode`'s doc) renders HERE, inside this node's own `<g
	// data-node-id>`, as a sibling immediately before the scoped-look-filtered
	// shape — never inside that filtered element itself (its final
	// `feComposite` would swallow the underlay, same reasoning as
	// `renderScopedLookGraphRun`'s doc). Being INSIDE the node's own wrapper
	// (rather than a run-level sibling OUTSIDE it, the pre-fix architecture)
	// means the SAME wrapper that carries this node's opacity/blend-mode now
	// covers the underlay too, with no separate pose-tracking mechanism needed.
	const contents = hasCarrier
		? `<g ${renderAttributes([
				svgRenderPartAttributePair(SVG_RENDER_PARTS.subtree),
				["opacity", effectiveOpacity(node, state.motion, state.frame)],
				["filter", subtreeCarrierFilterAttribute],
			])}>\n${shapeAndChildren}\n</g>`
		: reveal
			? [
					renderRevealUnderlay(node, state, nodeContext, reveal.revealPaint),
					`<g filter="url(#${reveal.filterId})">\n${shapeAndChildren}\n</g>`,
				]
					.filter(Boolean)
					.join("\n")
			: shapeAndChildren;

	const group = `<g ${renderAttributes([
		["data-node-id", node.id],
		["data-node-name", node.name],
		["data-export-dropped-clip-masks", maskRelationSummary(node, state)],
		["data-export-dropped-effects", importedEffectSummary(node)],
		["data-export-dropped-style-effects", styleEffectSummary(filterSpec)],
		[
			"data-export-stroke-align",
			style.strokeAlign === "center"
				? undefined
				: `${style.strokeAlign}->center`,
		],
		[
			"data-export-blend-mode",
			style.blendMode === "normal" ? undefined : style.blendMode,
		],
		["data-export-dropped-paint", importedPaintSummary(node)],
		["data-export-compound-path", importedCompoundPathSummary(node)],
		["data-export-opacity-groups", importedOpacityGroupSummary(node)],
		[SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE, reveal ? "true" : undefined],
		["transform", matrixToSvg(matrixFromTransform(transform))],
		[
			"opacity",
			reveal ? effectiveOpacity(node, state.motion, state.frame) : undefined,
		],
		[
			"style",
			style.blendMode === "normal"
				? undefined
				: `mix-blend-mode:${style.blendMode}`,
		],
	])}>\n${contents}\n</g>`;

	// Wrap masked content in untransformed clip/mask wrapper(s) so the referenced
	// def (built in artboard space) is not skewed by the node's own transform.
	const applications =
		state.maskPlan.applicationsByContentNodeId.get(node.id) ?? [];
	return applications.reduce(
		(inner, application) =>
			`<g ${renderAttributes([maskApplicationAttribute(application)])}>\n${inner}\n</g>`,
		group,
	);
};

const addScopedLookGraphOverlayIssue = (
	state: SvgRenderState,
	overlay: ScopedLookGraphOverlay,
	fidelity: readonly LookGraphFidelity[],
): void => {
	const approxNodeIds = fidelity
		.filter((entry) => entry.status === "approx")
		.map((entry) => entry.nodeId);
	const deferredNodeIds = fidelity
		.filter((entry) => entry.status === "deferred")
		.map((entry) => entry.nodeId);
	addIssue(state, {
		severity: "warning",
		category: "approximated",
		code: VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
		message: `Scoped Look graph overlay "${overlay.id}" was rendered as an SVG filter${
			approxNodeIds.length > 0
				? `; SVG-approximated nodes: ${approxNodeIds.join(", ")}`
				: ""
		}${
			deferredNodeIds.length > 0
				? `; deferred (not rendered): ${deferredNodeIds.join(", ")}`
				: ""
		}.`,
		fallback: "normalized-value",
	});
};

const appendScopedLookGraphRunFilter = (
	overlay: ScopedLookGraphOverlay,
	nodes: readonly VectorNode[],
	state: SvgRenderState,
): string | null => {
	const bounds = scopedLookGraphRunBoundsForTransform(
		nodes.map((node) => ({
			node,
			transform: effectiveTransform(node, state.motion, state.frame),
		})),
	);
	const id = scopedLookGraphOverlayFilterId({
		artboardId: state.scene.artboard.id,
		overlay,
		runIndex: state.scopedLookGraphRunIndex.value,
	});
	state.scopedLookGraphRunIndex.value += 1;
	const compiled = compileScopedLookGraphOverlayFilter({
		artboardId: state.scene.artboard.id,
		overlay,
		bounds,
		id,
		rasterSafe: state.rasterSafe,
		deferGpuRasterEffects: state.deferGpuRasterEffects,
		frameTimeSeconds: state.fps > 0 ? state.frame / state.fps : 0,
	});
	if (!compiled) return null;
	const markup = serializeEffectFilter(compiled.spec);
	if (!markup) return null;
	state.defs.push(markup);
	recordAppearance(state, "approximated", "look-graph:scoped-svg-filter");
	addScopedLookGraphOverlayIssue(state, overlay, compiled.fidelity);
	return compiled.spec.id;
};

/**
 * Wraps a run of consecutive same-overlay nodes in the compiled scoped-look
 * filter — the SVG-approximated form of a Look Graph overlay (Path Blur,
 * Object Noise Gradient, or a generic selection-scoped graph) that targets one
 * or more nodes as a single filtered unit.
 *
 * A Noise Gradient dissolve's `revealPaint` (see `revealPaintForNode`'s doc)
 * is the ONE exception: `objectNoiseGradientScopedLook` targets exactly one
 * node by construction, so a revealing run is always a run of one. For that
 * case this function pushes ONLY the filter `<defs>` (still referenced by id)
 * and passes the SAME compiled filter id + `revealPaint` to that one node's
 * `renderNode` call via `revealingFilter`, which renders the underlay INSIDE
 * that node's own `<g data-node-id>` (sibling of the filtered content, both
 * inside the node's own wrapper) instead of this function wrapping a
 * run-level `<g filter>` with the underlay as an external sibling before it.
 * Internalizing into the node's own wrapper is what makes
 * opacity/blend-mode/motion-playback treat the (underlay + filtered content)
 * pair as ONE object — see `renderNode`'s doc. Every other scoped-look source
 * (Path Blur, a generic selection graph, a non-dissolve or revealPaint-less
 * object-NG run, or any multi-node run) keeps this run-level wrap exactly as
 * before: zero behavior change.
 */
const renderScopedLookGraphRun = (
	overlay: ScopedLookGraphOverlay,
	nodes: readonly VectorNode[],
	state: SvgRenderState,
	context: IssueContext,
): string => {
	// Object Path Blur has no SVG filter equivalent (GPU-only, like the frame
	// node it mirrors). When a GPU compositor is about to run on top of this
	// base render (editor canvas, WebM capture) AND this target is actually
	// eligible to be composited (topmost in paint order — see
	// `scopedPathBlurTopmostTargetNodeIds`), omit the node here entirely
	// instead of painting it sharp — the compositor supplies the blurred crop
	// in its place. A second, unsuppressed base render would double-paint the
	// object (sharp underneath, blurred crop on top). A non-eligible target
	// (occluded by something painted after it) falls through to the normal
	// render below so it degrades to sharp/unblurred rather than vanishing —
	// the same path static SVG/PDF export (`deferGpuRasterEffects: false`)
	// always takes ("honest degradation", also used for the frame-level node).
	const eligiblePathBlurTargetIds = isObjectPathBlurScopedLook(overlay)
		? scopedPathBlurTopmostTargetNodeIds(state.scene)
		: null;
	if (
		eligiblePathBlurTargetIds &&
		state.deferGpuRasterEffects &&
		overlay.targetNodeIds.some((id) => eligiblePathBlurTargetIds.has(id))
	) {
		recordAppearance(state, "approximated", "look-graph:scoped-gpu-deferred");
		return "";
	}
	const filterId = appendScopedLookGraphRunFilter(overlay, nodes, state);
	const revealPaint = revealPaintForNode(overlay);
	// Guard `filterId` here too: if `revealPaint` is set but the graph fails to
	// compile a filter, a node must NOT receive a `revealingFilter` referencing
	// a filter id with no matching `<filter>` def — an SVG element with a
	// dangling `filter="url(#missing)"` reference is DROPPED entirely (content
	// vanishes), which is worse than the plain unfiltered render the
	// `!filterId` path below already falls back to.
	const revealingFilter =
		filterId && revealPaint ? { filterId, revealPaint } : null;
	const renderedNodes = nodes
		.map((node) =>
			renderNode(node, state, context, {
				suppressScopedLookGraphOverlay: true,
				revealingFilter,
			}),
		)
		.filter((node): node is string => Boolean(node))
		.join("\n");
	if (!renderedNodes) return "";
	if (!filterId || revealingFilter) return renderedNodes;
	const filteredGroup = `<g ${renderAttributes([
		["filter", `url(#${filterId})`],
		["data-scoped-look-graph-id", overlay.id],
		["data-scoped-look-graph-source", overlay.source],
	])}>\n${renderedNodes}\n</g>`;
	return filteredGroup;
};

const renderNodeList = (
	nodes: readonly VectorNode[],
	state: SvgRenderState,
	context: IssueContext,
	options: { readonly suppressScopedLookGraphOverlay?: boolean } = {},
): string => {
	const rendered: string[] = [];
	let index = 0;
	while (index < nodes.length) {
		const node = nodes[index];
		const overlay =
			!options.suppressScopedLookGraphOverlay &&
			node.visible &&
			!state.maskPlan.consumedMaskNodeIds.has(node.id)
				? (state.scopedLookGraphTargets.get(node.id) ?? null)
				: null;
		if (!overlay) {
			const normal = renderNode(node, state, context, options);
			if (normal) rendered.push(normal);
			index += 1;
			continue;
		}
		const run = [node];
		index += 1;
		while (index < nodes.length) {
			const next = nodes[index];
			const nextOverlay =
				next.visible && !state.maskPlan.consumedMaskNodeIds.has(next.id)
					? (state.scopedLookGraphTargets.get(next.id) ?? null)
					: null;
			if (!nextOverlay || nextOverlay.id !== overlay.id) break;
			run.push(next);
			index += 1;
		}
		const scoped = renderScopedLookGraphRun(overlay, run, state, context);
		if (scoped) rendered.push(scoped);
	}
	return rendered.join("\n");
};

const renderLayer = (
	layer: SceneLayer,
	state: SvgRenderState,
): string | null => {
	if (!layer.visible) return null;
	const nodes = renderNodeList(layer.nodes, state, { layerId: layer.id });
	return `<g ${renderAttributes([
		["data-layer-id", layer.id],
		["data-layer-name", layer.name],
	])}>\n${nodes}\n</g>`;
};

/**
 * Renders the frame-level Look as an SVG `<filter>` — but ONLY when an explicit
 * graph-first `lookGraph` is authored (not a projected `visualRecipe`/stack, which
 * already export clean geometry plus a high-fidelity `.recipe.json` side-car and
 * whose canvas-only texture must not be degraded into baked SVG bytes). For an
 * explicit graph, which renders nowhere else today, this is strictly additive: the
 * compiled plan lowers through the same `serializeEffectFilter` chain as node looks.
 * Pushes the `<filter>` to defs, records the honest approximation fidelity, and
 * returns the filter id to wrap the artboard content; returns `null` for a no-op.
 */
const addFrameLookGraphIssue = (
	state: SvgRenderState,
	graph: LookGraph,
	plan: LookGraphPlan,
	renderedAsFilter: boolean,
): void => {
	const approxNodeIds = plan.fidelity
		.filter((fidelity) => fidelity.status === "approx")
		.map((fidelity) => fidelity.nodeId);
	const omittedNodes = plan.nodes.filter(
		(node) =>
			node.fidelity.status !== "native" && node.fidelity.status !== "approx",
	);
	if (approxNodeIds.length === 0 && omittedNodes.length === 0) return;
	const omittedNodeIds = omittedNodes.map((node) => node.nodeId);
	const omittedNodeLabels = [
		...new Set(omittedNodes.map((node) => lookGraphNodeLabel(node.kind))),
	]
		.sort()
		.join(", ");
	for (const node of omittedNodes) {
		recordAppearance(state, "unsupported", `look-graph:${node.kind}`);
	}
	addIssue(state, {
		severity: "warning",
		category:
			omittedNodes.length > 0 && !renderedAsFilter
				? "unsupported"
				: "approximated",
		code:
			omittedNodes.length > 0 && !renderedAsFilter
				? VEC_CORE_RECIPE_SVG_UNSUPPORTED_ISSUE_CODE
				: VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
		message: `Frame Look graph (${graph.nodes.length} nodes) ${
			renderedAsFilter
				? "was rendered as an SVG filter"
				: "could not be rendered as an SVG filter because the output path has no SVG-renderable primitives"
		}${
			approxNodeIds.length > 0
				? `; SVG-approximated nodes: ${approxNodeIds.join(", ")}`
				: ""
		}${
			omittedNodeIds.length > 0
				? `; deferred (not rendered): ${omittedNodeLabels} (${omittedNodeIds.join(", ")})`
				: ""
		}. Per-node fidelity and the canonical graph are exported beside the SVG as .recipe.json.`,
		fallback:
			omittedNodes.length > 0 ? "local-raster-required" : "normalized-value",
	});
};

const appendFrameLookFilter = (
	renderScene: SceneDocument,
	state: SvgRenderState,
): string | null => {
	const frameIntent = resolveFrameEffectIntent(
		renderScene,
		renderScene.artboard.id,
	);
	const graph = frameIntent.lookGraph;
	if (!graph) return null;
	const bounds = {
		x: 0,
		y: 0,
		width: renderScene.artboard.width,
		height: renderScene.artboard.height,
	};
	const plan = compileLookGraph(graph, {
		owner: { scope: "artboard", artboardId: frameIntent.artboardId },
		bounds,
		rasterSafe: state.rasterSafe,
		deferGpuRasterEffects: state.deferGpuRasterEffects,
		frameTimeSeconds: state.fps > 0 ? state.frame / state.fps : 0,
	});
	const filterId = `vecmo-frame-look-${svgIdSegment(frameIntent.artboardId)}`;
	const spec = lookGraphPlanToEffectFilter(plan, {
		id: filterId,
		bounds,
	});
	if (!spec) {
		addFrameLookGraphIssue(state, graph, plan, false);
		return null;
	}
	const markup = serializeEffectFilter(spec);
	if (!markup) {
		addFrameLookGraphIssue(state, graph, plan, false);
		return null;
	}
	state.defs.push(markup);
	recordAppearance(state, "approximated", "look-graph:svg-filter");
	addFrameLookGraphIssue(state, graph, plan, true);
	return filterId;
};

/**
 * Renders the sampled frame-level visual recipe as an SVG filter approximation.
 * The caller wraps the full artboard content, including the background rect,
 * because these recipes describe a finished frame look rather than a layer look.
 */
const appendFrameVisualRecipeFilter = (
	renderScene: SceneDocument,
	recipe: VisualRecipe | null,
	state: SvgRenderState,
): string | null => {
	if (!recipe) return null;
	const filterId = `vecmo-frame-visual-recipe-${svgIdSegment(
		renderScene.artboard.id,
	)}`;
	const spec = buildFrameVisualRecipeFilter({
		id: filterId,
		bounds: {
			x: 0,
			y: 0,
			width: renderScene.artboard.width,
			height: renderScene.artboard.height,
		},
		recipe,
		rasterSafe: state.rasterSafe,
		frameTimeSeconds: state.fps > 0 ? state.frame / state.fps : 0,
	});
	if (!spec) return null;
	const markup = serializeEffectFilter(spec);
	if (!markup) return null;
	state.defs.push(markup);
	recordAppearance(state, "approximated", "frame-visual-recipe:svg-filter");
	addIssue(state, {
		severity: "warning",
		category: "approximated",
		code: VEC_CORE_RECIPE_SVG_APPROXIMATED_ISSUE_CODE,
		message:
			"Frame visual recipe was rendered as an SVG filter approximation so frame-level film looks appear in SVG/PNG exports. The canonical recipe is exported beside the SVG as .recipe.json.",
		fallback: "normalized-value",
	});
	return filterId;
};

export function renderSceneSvgWithIssues({
	scene,
	motion,
	frame,
	grammarBindings,
	renderPresentation,
	transparentBackground = false,
	measurer,
	rasterSafe = false,
	deferGpuRasterEffects = false,
}: SvgExportInput): SvgRenderResult {
	const presentation =
		renderPresentation ??
		buildExportRenderPresentation({
			scene,
			motion,
			frame,
			grammarBindings,
		});
	const renderScene = presentation.scene;
	const renderMotion = presentation.renderMotion;
	const sampledFrame = presentation.frame;
	const state: SvgRenderState = {
		scene: renderScene,
		motion: renderMotion,
		frame: sampledFrame,
		defs: [],
		appearance: createExportAppearanceFidelityTracker(),
		issues: [],
		maskPlan: resolveSceneMaskPlan(renderScene),
		measurer,
		rasterSafe,
		deferGpuRasterEffects,
		fps: presentation.sourceMotion.fps,
		effectInfluenceRecipe: resolveFrameEffectIntent(
			renderScene,
			renderScene.artboard.id,
		).influenceRecipe,
		scopedLookGraphTargets: scopedLookGraphOverlayTargetMap(
			scopedLookGraphOverlays(renderScene.artboard),
		),
		scopedLookGraphRunIndex: { value: 0 },
		sourceOpticsPresentation: presentation.sourceOptics,
	};
	for (const issue of state.sourceOpticsPresentation?.issues ?? []) {
		recordAppearance(state, "unsupported", "source-optics:routing");
		addIssue(state, {
			severity: "warning",
			category: "unsupported",
			code: "style-effect-unsupported",
			message: `Source Optics routing was not applied: ${issue.detail}`,
			fallback: "normalized-value",
			...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
		});
	}
	for (const relation of state.maskPlan.unrepresented) {
		recordAppearance(state, "unsupported", `mask:${relation.reason}`);
		addIssue(state, {
			severity: "warning",
			category: "unsupported",
			code: "mask-relation-fallback",
			message: `Mask relation "${relation.relationId}" could not be represented (${relation.reason}); node "${relation.contentNodeId}" was exported unclipped.`,
			fallback: "unclipped-vector",
			nodeId: relation.contentNodeId,
		});
	}
	for (const def of state.maskPlan.defs) {
		state.defs.push(
			buildMaskDefSvg(def, {
				motion: state.motion,
				frame: state.frame,
				artboard: state.scene.artboard,
				effectiveGeometry: { effectiveShape, effectiveTransform },
			}),
		);
		const soft =
			def.featherRadius > 0 ||
			def.opacity < 1 ||
			def.expand !== 0 ||
			def.invert;
		if (!soft) {
			recordAppearance(state, "preserved", `mask:${def.relationKind}`);
		} else {
			if (def.featherRadius > 0)
				recordAppearance(
					state,
					"preserved",
					`mask:${def.relationKind}:feather`,
				);
			if (def.opacity < 1)
				recordAppearance(
					state,
					"preserved",
					`mask:${def.relationKind}:opacity`,
				);
			if (def.expand !== 0)
				recordAppearance(state, "preserved", `mask:${def.relationKind}:expand`);
			if (def.invert)
				recordAppearance(state, "preserved", `mask:${def.relationKind}:invert`);
		}
	}
	const metadata = stableJsonStringify({
		durationFrames: presentation.sourceMotion.durationFrames,
		exportFormat: "vector-motion-author/svg",
		fps: presentation.sourceMotion.fps,
		frame: sampledFrame,
		motionSchemaVersion: presentation.sourceMotion.schemaVersion,
		sceneSchemaVersion: renderScene.schemaVersion,
	}).trim();
	const layers = renderScene.layers
		.map((layer) => renderLayer(layer, state))
		.filter((layer): layer is string => Boolean(layer))
		.join("\n");
	const artboardBackground = transparentBackground
		? null
		: renderArtboardBackground(renderScene, state);
	// Explicit graph Looks keep the historical layers-only wrapping. Sampled
	// visualRecipe Looks are frame finishes, so they wrap background + layers.
	const frameLookFilterId = appendFrameLookFilter(renderScene, state);
	const frameVisualRecipeFilterId =
		frameLookFilterId || (!artboardBackground && !layers)
			? null
			: appendFrameVisualRecipeFilter(
					renderScene,
					presentation.presentation.effectIntent.visualRecipe,
					state,
				);
	const framedLayers = frameLookFilterId
		? `<g ${renderAttributes([["filter", `url(#${frameLookFilterId})`]])}>\n${layers}\n</g>`
		: layers;
	const artboardContent = frameVisualRecipeFilterId
		? `<g ${renderAttributes([
				["filter", `url(#${frameVisualRecipeFilterId})`],
			])}>\n${joinSvgParts([artboardBackground, layers])}\n</g>`
		: joinSvgParts([artboardBackground, framedLayers]);
	const defs = state.defs.length
		? `<defs>\n${state.defs.join("\n")}\n</defs>`
		: null;

	return {
		contents: [
			`<svg ${renderAttributes([
				["xmlns", "http://www.w3.org/2000/svg"],
				[
					"viewBox",
					`0 0 ${formatNumber(renderScene.artboard.width)} ${formatNumber(renderScene.artboard.height)}`,
				],
				["width", renderScene.artboard.width],
				["height", renderScene.artboard.height],
				["data-scene-schema-version", renderScene.schemaVersion],
				["data-motion-schema-version", presentation.sourceMotion.schemaVersion],
				["data-frame", sampledFrame],
			])}>`,
			`<metadata>${escapeText(metadata)}</metadata>`,
			...(defs ? [defs] : []),
			artboardContent,
			"</svg>",
			"",
		].join("\n"),
		appearance: finalizeExportAppearanceFidelity(state.appearance),
		issues: state.issues,
	};
}

/**
 * Renders a standalone SVG surface for preview callers that only need bytes.
 * Use `renderSceneSvgWithIssues` when the caller needs fidelity metadata.
 */
export function renderSceneSvg(input: SvgExportInput): string {
	return renderSceneSvgWithIssues(input).contents;
}

export type SvgIsolatedNodeInput = SvgExportInput & {
	readonly nodeId: string;
	/** Crop region in artboard-root pixel space; becomes the returned SVG's viewBox. */
	readonly bounds: Bounds;
};

/**
 * Serializes ONE node's own rendered markup — real paint, effects, and masks
 * via `renderNode`, not a hand-rolled approximation — as a standalone SVG
 * cropped to `bounds`. Used by the per-object GPU Path Blur compositor: it
 * uploads this as the isolated crop source texture, runs the blur shader over
 * it, then draws the result back onto the finished frame at the same `bounds`
 * offset. The node's own scoped Look Graph overlay is intentionally not
 * applied here (`suppressScopedLookGraphOverlay`) — this produces the sharp
 * pre-blur source the GPU pass then blurs; the frame-level filter chain
 * (`appendFrameLookFilter` and friends) is also skipped since this crop
 * captures only the node's own appearance, not frame-wide Looks.
 */
export function renderIsolatedNodeSvg({
	scene,
	motion,
	frame,
	grammarBindings,
	renderPresentation,
	measurer,
	rasterSafe = false,
	nodeId,
	bounds,
}: SvgIsolatedNodeInput): string | null {
	const presentation =
		renderPresentation ??
		buildExportRenderPresentation({ scene, motion, frame, grammarBindings });
	const renderScene = presentation.scene;
	const node = findNode(renderScene, nodeId);
	if (!node) return null;
	const state: SvgRenderState = {
		scene: renderScene,
		motion: presentation.renderMotion,
		frame: presentation.frame,
		defs: [],
		appearance: createExportAppearanceFidelityTracker(),
		issues: [],
		maskPlan: resolveSceneMaskPlan(renderScene),
		measurer,
		rasterSafe,
		deferGpuRasterEffects: true,
		fps: presentation.sourceMotion.fps,
		effectInfluenceRecipe: resolveFrameEffectIntent(
			renderScene,
			renderScene.artboard.id,
		).influenceRecipe,
		scopedLookGraphTargets: new Map(),
		scopedLookGraphRunIndex: { value: 0 },
		sourceOpticsPresentation: undefined,
	};
	for (const def of state.maskPlan.defs) {
		state.defs.push(
			buildMaskDefSvg(def, {
				motion: state.motion,
				frame: state.frame,
				artboard: state.scene.artboard,
				effectiveGeometry: { effectiveShape, effectiveTransform },
			}),
		);
	}
	const markup = renderNode(
		node,
		state,
		{},
		{
			suppressScopedLookGraphOverlay: true,
		},
	);
	if (!markup) return null;
	const defs = state.defs.length
		? `<defs>\n${state.defs.join("\n")}\n</defs>`
		: null;
	return [
		`<svg ${renderAttributes([
			["xmlns", "http://www.w3.org/2000/svg"],
			[
				"viewBox",
				`${formatNumber(bounds.x)} ${formatNumber(bounds.y)} ${formatNumber(bounds.width)} ${formatNumber(bounds.height)}`,
			],
			["width", bounds.width],
			["height", bounds.height],
		])}>`,
		...(defs ? [defs] : []),
		markup,
		"</svg>",
	].join("\n");
}

export type SvgIsolatedNodeSetInput = SvgExportInput & {
	readonly nodeIds: readonly string[];
	/** Scoped GPU Look whose own pass must not be baked into its emission source. */
	readonly excludedScopedLookId: string;
	/** Optional artboard-space crop for static playback layer preparation. */
	readonly bounds?: Bounds;
	/** Retain source-owned Source Optics for a static base layer, never emission. */
	readonly includeSourceOpticsSourceOwners?: boolean;
};

/**
 * Renders a transparent, full-artboard emission source for one scoped GPU Look.
 * Target nodes keep their earlier object-scoped material Looks (for example
 * Noise Gradient) and their target-owned Source Optics surface consequences.
 * The excluded Deep Glow graph, frame Looks, artboard background, and
 * source-owned Bloom/Ray/Atmosphere/Lens remain absent. The resulting pixels
 * are therefore the post-material source of radiance, not the finished frame
 * and never a geometry-alpha proxy.
 */
export function renderIsolatedNodeSetSvg({
	scene,
	motion,
	frame,
	grammarBindings,
	renderPresentation,
	measurer,
	rasterSafe = false,
	nodeIds,
	excludedScopedLookId,
	bounds,
	includeSourceOpticsSourceOwners = false,
}: SvgIsolatedNodeSetInput): string | null {
	const presentation =
		renderPresentation ??
		buildExportRenderPresentation({ scene, motion, frame, grammarBindings });
	const renderScene = presentation.scene;
	const targetIds = new Set(nodeIds);
	if (targetIds.size === 0) return null;
	const retainedScopedLooks = scopedLookGraphOverlays(
		renderScene.artboard,
	).filter((overlay) => overlay.id !== excludedScopedLookId);
	const state: SvgRenderState = {
		scene: renderScene,
		motion: presentation.renderMotion,
		frame: presentation.frame,
		defs: [],
		appearance: createExportAppearanceFidelityTracker(),
		issues: [],
		maskPlan: resolveSceneMaskPlan(renderScene),
		measurer,
		rasterSafe,
		deferGpuRasterEffects: true,
		fps: presentation.sourceMotion.fps,
		effectInfluenceRecipe: resolveFrameEffectIntent(
			renderScene,
			renderScene.artboard.id,
		).influenceRecipe,
		scopedLookGraphTargets:
			scopedLookGraphOverlayTargetMap(retainedScopedLooks),
		scopedLookGraphRunIndex: { value: 0 },
		sourceOpticsPresentation: includeSourceOpticsSourceOwners
			? presentation.sourceOptics
			: sourceOpticsTargetResponsePresentation(
					presentation.sourceOptics,
					targetIds,
				),
	};
	for (const def of state.maskPlan.defs) {
		state.defs.push(
			buildMaskDefSvg(def, {
				motion: state.motion,
				frame: state.frame,
				artboard: state.scene.artboard,
				effectiveGeometry: { effectiveShape, effectiveTransform },
			}),
		);
	}
	const layers = renderScene.layers
		.filter((layer) => layer.visible)
		.map((layer) => {
			const nodes = layer.nodes.filter(
				(node) => node.visible && targetIds.has(node.id),
			);
			if (nodes.length === 0) return null;
			const markup = renderNodeList(nodes, state, { layerId: layer.id });
			return markup
				? `<g ${renderAttributes([
						["data-layer-id", layer.id],
						["data-layer-name", layer.name],
					])}>\n${markup}\n</g>`
				: null;
		})
		.filter((layer): layer is string => Boolean(layer))
		.join("\n");
	if (!layers) return null;
	const defs = state.defs.length
		? `<defs>\n${state.defs.join("\n")}\n</defs>`
		: null;
	const outputBounds = bounds ?? {
		x: 0,
		y: 0,
		width: renderScene.artboard.width,
		height: renderScene.artboard.height,
	};
	return [
		`<svg ${renderAttributes([
			["xmlns", "http://www.w3.org/2000/svg"],
			[
				"viewBox",
				`${formatNumber(outputBounds.x)} ${formatNumber(outputBounds.y)} ${formatNumber(outputBounds.width)} ${formatNumber(outputBounds.height)}`,
			],
			["width", outputBounds.width],
			["height", outputBounds.height],
		])}>`,
		...(defs ? [defs] : []),
		layers,
		"</svg>",
	].join("\n");
}

/**
 * Creates the SVG export asset sampled at the requested frame. The SVG embeds
 * scene and motion schema versions in metadata and data attributes so the file
 * remains self-describing outside the editor.
 */
export function createSvgExport({
	scene,
	motion,
	frame,
	fileNameStem,
	grammarBindings,
	renderPresentation,
}: SvgExportInput): SvgExportAsset {
	const presentation =
		renderPresentation ??
		buildExportRenderPresentation({
			scene,
			motion,
			frame,
			grammarBindings,
		});
	const sampledFrame = presentation.frame;
	const result = renderSceneSvgWithIssues({
		scene,
		motion,
		frame: sampledFrame,
		renderPresentation: presentation,
	});
	return {
		kind: "svg",
		fileName: `${fileNameStem ?? fileStemForScene(scene)}.frame-${Math.round(sampledFrame)}.svg`,
		mimeType: SVG_MIME_TYPE,
		contents: result.contents,
		appearance: result.appearance,
		issues: result.issues,
	};
}
