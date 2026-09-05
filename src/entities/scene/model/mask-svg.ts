/**
 * Single source of truth for the SVG-string emission of masks and stroke-only
 * blur. Both the in-app SVG export ({@link ../../../features/export/model/svg.ts})
 * and the standalone code/runtime export (bundled via
 * {@link ../../../features/export/model/runtime-sampler-entry.ts}) emit these
 * exact strings, so a clip/mask/feather/stroke-blur can never drift between the
 * editor canvas, the in-app export, and exported playback.
 *
 * The mask plan itself ({@link ./mask-render resolveSceneMaskPlan}) decides which
 * relations are representable and in what mode; this module only serializes one
 * resolved def or application to SVG. It is pure and DOM-free so it bundles into
 * the standalone runtime unchanged.
 *
 * The small SVG-string primitives below (number/attribute formatting, element
 * emission, geometry → path/points) are kept module-private and intentionally
 * mirror the equivalents in `svg.ts`; the codebase already tolerates these tiny
 * pure helpers being duplicated (e.g. `compactPathData`, `formatNumber`). What
 * must not diverge — the actual mask/stroke-blur markup — is single-sourced here.
 */

import type { MotionDocument } from "@/entities/motion/model/types";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import {
	rectNeedsBakedPath,
	roundedPolygonPathData,
	roundedRectPathData,
	roundedStarPathData,
	shapeNeedsBakedPath,
} from "./corner-geometry";
import { svgIdSegment } from "./effect-filter";
import {
	type MaskFilterPrimitive,
	maskFilterPadding,
	maskFilterPrimitives,
	maskSolidPaintChannelCoverage,
	type ResolvedMaskApplication,
	type ResolvedMaskDef,
	resolveSceneMaskPlan,
} from "./mask-render";
import {
	getGeometryBounds,
	matrixFromTransform,
	matrixToSvg,
} from "./rendering";
import { resolveNodeStyle } from "./style-resolve";
import type {
	BezierShape,
	NodeGeometry,
	SceneDocument,
	Transform,
	VectorNode,
} from "./types";

/**
 * Motion's per-frame effective-geometry resolution, injected by the caller so this
 * module stays motion-free (scene must not value-import motion; see
 * `docs/architecture.md`). Callers pass motion's real `effectiveShape`/
 * `effectiveTransform` ({@link ../../motion/model/sampler.ts}) unchanged — the
 * shape here mirrors their exact signatures, so this is a pure signature move, not
 * a behavior change.
 */
export type MaskEffectiveGeometryResolver = {
	readonly effectiveShape: (
		node: VectorNode,
		motion: MotionDocument,
		frame: number,
	) => BezierShape | undefined;
	readonly effectiveTransform: (
		node: VectorNode,
		motion: MotionDocument,
		frame: number,
	) => Transform;
};

/** Per-frame context needed to serialize a mask def in artboard space. */
export type MaskSvgContext = {
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly artboard: { readonly width: number; readonly height: number };
	readonly effectiveGeometry: MaskEffectiveGeometryResolver;
};

/** Minimal style surface a stroke-only blur filter reads. */
export type StrokeBlurStyle = {
	readonly strokeWidth: number;
	readonly strokeBlurRadius: number;
};

export type SvgAttributeValue = string | number | boolean | null | undefined;

// --- SVG-string primitives (module-private; mirror svg.ts) ---------------------

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

const element = (
	tag: string,
	attributes: readonly (readonly [string, SvgAttributeValue])[],
): string => `<${tag} ${renderAttributes(attributes)} />`;

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

const compoundPathData = (
	shape: BezierShape,
	subpaths: readonly BezierShape[],
): string | null => {
	if (!isRenderableShape(shape)) return null;
	const contours = [shape, ...subpaths.filter(isRenderableShape)];
	return compactPathData(contours.map(aeShapeToSvgPath).join(" "));
};

// --- Mask defs / applications --------------------------------------------------

const MASK_SILHOUETTE_FILL = "#ffffff";

/** Emits one mask alpha-filter primitive; the first in a chain reads SourceGraphic. */
const maskFilterPrimitiveSvg = (
	primitive: MaskFilterPrimitive,
	isFirst: boolean,
): string => {
	const inAttr: readonly (readonly [string, SvgAttributeValue])[] = isFirst
		? [["in", "SourceGraphic"]]
		: [];
	switch (primitive.kind) {
		case "morphology":
			return element("feMorphology", [
				...inAttr,
				["operator", primitive.operator],
				["radius", primitive.radius],
			]);
		case "blur":
			return element("feGaussianBlur", [
				...inAttr,
				["stdDeviation", primitive.stdDeviation],
			]);
		case "invert-alpha":
			return `<feComponentTransfer ${renderAttributes(inAttr)}>\n${element(
				"feFuncA",
				[
					["type", "table"],
					["tableValues", "1 0"],
				],
			)}\n</feComponentTransfer>`;
		case "invert-luminance":
			return [
				element("feColorMatrix", [
					...inAttr,
					["type", "luminanceToAlpha"],
					["result", "mask-luminance-alpha"],
				]),
				`<feComponentTransfer in="mask-luminance-alpha" result="mask-inverted-alpha">\n${element(
					"feFuncA",
					[
						["type", "table"],
						["tableValues", "1 0"],
					],
				)}\n</feComponentTransfer>`,
				element("feFlood", [
					["flood-color", "#ffffff"],
					["result", "mask-white"],
				]),
				element("feComposite", [
					["in", "mask-white"],
					["in2", "mask-inverted-alpha"],
					["operator", "in"],
				]),
			].join("\n");
		case "opacity":
			return element("feColorMatrix", [
				...inAttr,
				["type", "matrix"],
				["values", `1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${primitive.value} 0`],
			]);
	}
};

/**
 * Emits the mask source geometry as a bare silhouette (no paint, no stroke) for
 * use directly inside a `<clipPath>`/`<mask>`. The mask node's transform is placed
 * on the silhouette element itself (a shape/path element is a valid `<clipPath>`
 * child and accepts `transform`), so the def lives in artboard space without an
 * intervening `<g>` — which the SVG `<clipPath>` content model forbids and
 * spec-conformant consumers drop. Mask sources are restricted by the render
 * descriptor to renderable area geometry, so the switch is exhaustive for those.
 */
const maskSilhouetteElement = (
	maskNode: VectorNode,
	ctx: MaskSvgContext,
	transform: string,
	fill: string = MASK_SILHOUETTE_FILL,
	opacity: number = 1,
): string => {
	const { geometry } = maskNode;
	const paintAttributes: readonly (readonly [string, SvgAttributeValue])[] = [
		["fill", fill],
		...(opacity < 1 ? [["opacity", opacity] as const] : []),
	];
	switch (geometry.kind) {
		case "rect":
			if (rectNeedsBakedPath(geometry)) {
				return element("path", [
					["d", roundedRectPathData(geometry)],
					...paintAttributes,
					["transform", transform],
				]);
			}
			return element("rect", [
				["x", geometry.bounds.x],
				["y", geometry.bounds.y],
				["width", geometry.bounds.width],
				["height", geometry.bounds.height],
				["rx", geometry.cornerRadius],
				...paintAttributes,
				["transform", transform],
			]);
		case "ellipse":
			return element("ellipse", [
				["cx", geometry.bounds.x + geometry.bounds.width / 2],
				["cy", geometry.bounds.y + geometry.bounds.height / 2],
				["rx", geometry.bounds.width / 2],
				["ry", geometry.bounds.height / 2],
				...paintAttributes,
				["transform", transform],
			]);
		case "polygon":
			if (shapeNeedsBakedPath(geometry)) {
				return element("path", [
					["d", roundedPolygonPathData(geometry)],
					...paintAttributes,
					["transform", transform],
				]);
			}
			return element("polygon", [
				["points", pointList(geometry.points)],
				...paintAttributes,
				["transform", transform],
			]);
		case "star":
			if (shapeNeedsBakedPath(geometry)) {
				return element("path", [
					["d", roundedStarPathData(geometry)],
					...paintAttributes,
					["transform", transform],
				]);
			}
			return element("polygon", [
				["points", starPoints(geometry)],
				...paintAttributes,
				["transform", transform],
			]);
		case "path": {
			const sampledShape = ctx.effectiveGeometry.effectiveShape(
				maskNode,
				ctx.motion,
				ctx.frame,
			);
			const shape = sampledShape ?? geometry.shape;
			const pathData = compoundPathData(shape, geometry.subpaths ?? []);
			if (!pathData) return "";
			const attributes: (readonly [string, SvgAttributeValue])[] = [
				["d", pathData],
				...paintAttributes,
			];
			if (geometry.fillRule === "evenodd") {
				attributes.push(["fill-rule", "evenodd"]);
			}
			attributes.push(["transform", transform]);
			return element("path", attributes);
		}
		default:
			return "";
	}
};

/**
 * Builds a representable mask as an SVG `<clipPath>` or alpha `<mask>` def. The
 * mask node's own transform rides on the silhouette element so the def lives in
 * artboard space, while the content references it on an UNTRANSFORMED wrapper
 * (see {@link maskApplicationAttribute}) so the source transform is not applied
 * twice. `userSpaceOnUse` keeps both coordinate spaces aligned. The render
 * descriptor only yields defs with a non-degenerate silhouette, so this never
 * emits an empty clip region.
 */
export const buildMaskDefSvg = (
	def: ResolvedMaskDef,
	ctx: MaskSvgContext,
): string => {
	const channel = def.channel ?? "alpha";
	const silhouette = def.maskNodes
		.map((maskNode) => {
			const transform = matrixToSvg(
				matrixFromTransform(
					ctx.effectiveGeometry.effectiveTransform(
						maskNode,
						ctx.motion,
						ctx.frame,
					),
				),
			);
			const sourceStyle = resolveNodeStyle(maskNode.style);
			const sourcePaint = sourceStyle.fills[0];
			const paintOpacity =
				sourcePaint?.kind === "solid" ? sourcePaint.opacity : 1;
			const fill =
				channel === "luminance" && sourcePaint?.kind === "solid"
					? sourcePaint.color
					: MASK_SILHOUETTE_FILL;
			const rgbCoverage =
				channel === "red" || channel === "green" || channel === "blue"
					? sourcePaint?.kind === "solid"
						? (maskSolidPaintChannelCoverage(sourcePaint.color, channel) ?? 0)
						: 0
					: 1;
			return maskSilhouetteElement(
				maskNode,
				ctx,
				transform,
				fill,
				paintOpacity * sourceStyle.opacity * rgbCoverage,
			);
		})
		.join("\n");
	const domId = def.domId;
	if (def.mode === "clip") {
		return `<clipPath ${renderAttributes([
			["id", domId],
			["clipPathUnits", "userSpaceOnUse"],
		])}>\n${silhouette}\n</clipPath>`;
	}
	const { artboard } = ctx;
	const primitives = maskFilterPrimitives(def);
	const padding = maskFilterPadding(def);
	const filterId = primitives.length > 0 ? `${domId}-feather` : null;
	const filter = filterId
		? `<filter ${renderAttributes([
				["id", filterId],
				["filterUnits", "userSpaceOnUse"],
				["x", -padding],
				["y", -padding],
				["width", artboard.width + padding * 2],
				["height", artboard.height + padding * 2],
				["color-interpolation-filters", "sRGB"],
			])}>\n${primitives
				.map((primitive, index) =>
					maskFilterPrimitiveSvg(primitive, index === 0),
				)
				.join("\n")}\n</filter>\n`
		: "";
	const maskContents = filterId
		? `<g ${renderAttributes([
				["filter", `url(#${filterId})`],
			])}>\n${silhouette}\n</g>`
		: silhouette;
	const mask = `<mask ${renderAttributes([
		["id", domId],
		["maskUnits", "userSpaceOnUse"],
		["mask-type", channel === "luminance" ? "luminance" : "alpha"],
		["x", -padding],
		["y", -padding],
		["width", artboard.width + padding * 2],
		["height", artboard.height + padding * 2],
	])}>\n${maskContents}\n</mask>`;
	return `${filter}${mask}`;
};

/** The clip-path/mask attribute a content node's wrapper carries when masked. */
export const maskApplicationAttribute = (
	application: ResolvedMaskApplication,
): readonly [string, SvgAttributeValue] => {
	const reference = `url(#${application.domId})`;
	return application.mode === "clip"
		? ["clip-path", reference]
		: ["mask", reference];
};

// --- Stroke-only blur ----------------------------------------------------------

/** Authored stroke-blur radius -> Gaussian sigma, matching the node-effect convention. */
const strokeBlurSigma = (radius: number): number => Math.max(0, radius) / 2;

/** Stable geometry-local filter id for a node's stroke-only blur. */
export const strokeBlurFilterId = (nodeId: string): string =>
	`vecmo-stroke-blur-${svgIdSegment(nodeId)}`;

/**
 * Geometry-local `<filter>` that Gaussian-blurs only the stroke group. The region
 * is padded by the stroke half-width plus the blur's `3σ` reach so a soft stroke
 * halo is never clipped; it mirrors the mask-feather filter shape so canvas and
 * export stay visually identical.
 */
export const strokeBlurFilterDefSvg = (
	node: VectorNode,
	style: StrokeBlurStyle,
): string => {
	const sigma = strokeBlurSigma(style.strokeBlurRadius);
	const bounds = getGeometryBounds(node.geometry);
	const pad = style.strokeWidth / 2 + sigma * 3;
	return `<filter ${renderAttributes([
		["id", strokeBlurFilterId(node.id)],
		["filterUnits", "userSpaceOnUse"],
		["x", bounds.x - pad],
		["y", bounds.y - pad],
		["width", bounds.width + pad * 2],
		["height", bounds.height + pad * 2],
		["color-interpolation-filters", "sRGB"],
	])}>\n${element("feGaussianBlur", [
		["in", "SourceGraphic"],
		["stdDeviation", sigma],
	])}\n</filter>`;
};

// --- Whole-scene artifacts (shared by in-app export + standalone runtime) -------

/** The mask defs + per-node application attributes both SVG consumers emit. */
export type SceneMaskSvgArtifacts = {
	/** Concatenated `<clipPath>`/`<mask>` (+ feather `<filter>`) defs, "\n"-joined. */
	readonly defs: string;
	/**
	 * Rendered `clip-path`/`mask` attribute markup per content node id, in plan
	 * order (innermost wrapper first), e.g. `clip-path="url(#mask-clip-…)"`.
	 */
	readonly applicationsByNodeId: Readonly<Record<string, readonly string[]>>;
	/**
	 * Node ids consumed as representable mask sources. A consumer must NOT paint
	 * these as ordinary geometry (only their silhouette lives inside the def),
	 * matching "use as mask" semantics in the editor and SVG export.
	 */
	readonly consumedNodeIds: readonly string[];
};

/**
 * Resolves the scene mask plan and serializes it to the SVG artifacts both the
 * in-app SVG export and the standalone code/runtime export emit. Pass the COMPOSED
 * scene plus the presentation's `renderMotion`/`frame` (exactly what svg.ts feeds
 * its renderer) so the mask source transforms/shapes sample identically; the defs
 * are then byte-identical to the editor's, with zero second implementation. Pass
 * motion's real `effectiveShape`/`effectiveTransform` as `effectiveGeometry` (see
 * {@link MaskEffectiveGeometryResolver}).
 */
export const buildSceneMaskSvgArtifacts = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	effectiveGeometry: MaskEffectiveGeometryResolver,
): SceneMaskSvgArtifacts => {
	const plan = resolveSceneMaskPlan(scene);
	const ctx: MaskSvgContext = {
		motion,
		frame,
		artboard: scene.artboard,
		effectiveGeometry,
	};
	const defs = plan.defs.map((def) => buildMaskDefSvg(def, ctx)).join("\n");
	const applicationsByNodeId: Record<string, string[]> = {};
	for (const [nodeId, applications] of plan.applicationsByContentNodeId) {
		applicationsByNodeId[nodeId] = applications.map((application) =>
			renderAttributes([maskApplicationAttribute(application)]),
		);
	}
	return {
		defs,
		applicationsByNodeId,
		consumedNodeIds: [...plan.consumedMaskNodeIds],
	};
};

const isVisibleStroke = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized !== "" && normalized !== "none" && normalized !== "transparent"
	);
};

/** The stroke-blur `<filter>` defs + which node id each wraps its stroke with. */
export type SceneStrokeBlurSvgArtifacts = {
	/** Concatenated stroke-blur `<filter>` defs, "\n"-joined. */
	readonly defs: string;
	/** Stroke-blur filter id per node id whose stroke must be Gaussian-blurred. */
	readonly filterIdByNodeId: Readonly<Record<string, string>>;
};

/**
 * Walks the (composed) scene and serializes a stroke-only blur `<filter>` for every
 * node whose resolved style has a visible stroke and a nonzero stroke blur, using
 * the SAME resolution ({@link resolveNodeStyle}) and filter math the in-app SVG
 * export uses — so the filter region/sigma are byte-identical wherever both emit.
 * A consumer applies `filterIdByNodeId[node.id]` to a stroke-only element so the
 * fill stays sharp.
 *
 * "Visible stroke" mirrors `renderStackedShape`'s `hasStroke` activation: a
 * stack-owned stroke (`style.strokes.length > 0`) counts even when the legacy
 * scalar `style.stroke` is `"none"`, since the resolved stack — not the
 * scalar — is what actually paints in that case. The `isVisibleStroke`
 * scalar check is kept for the runtime's legacy-scalar fallback path, where
 * there is no stack to consult.
 */
export const buildSceneStrokeBlurArtifacts = (
	scene: SceneDocument,
): SceneStrokeBlurSvgArtifacts => {
	const defParts: string[] = [];
	const filterIdByNodeId: Record<string, string> = {};
	const visit = (nodes: readonly VectorNode[]): void => {
		for (const node of nodes) {
			const style = resolveNodeStyle(node.style);
			if (
				style.strokeBlurRadius > 0 &&
				style.strokeWidth > 0 &&
				(style.strokes.length > 0 || isVisibleStroke(style.stroke))
			) {
				defParts.push(strokeBlurFilterDefSvg(node, style));
				filterIdByNodeId[node.id] = strokeBlurFilterId(node.id);
			}
			if (node.children) visit(node.children);
		}
	};
	for (const layer of scene.layers) visit(layer.nodes);
	return { defs: defParts.join("\n"), filterIdByNodeId };
};
