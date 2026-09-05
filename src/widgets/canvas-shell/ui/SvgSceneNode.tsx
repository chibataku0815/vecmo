import {
	Fragment,
	memo,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
} from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	activeTextAnimator,
	evaluateTextAnimator,
	type TextFragmentPose,
} from "@/entities/motion/model/text-animator";
import type { TextAnimatorBinding } from "@/entities/motion/model/types";
import {
	effectFilterBoundsForNode,
	hasSubtreeCarrier,
} from "@/entities/scene/model/appearance-targets";
import {
	externalAssetPlacementMetadataForNode,
	imagePaintHref,
	imagePlacementForNode,
	preserveAspectRatioForImageFit,
	resolveImageAssetReference,
} from "@/entities/scene/model/assets";
import {
	type CanvasGradientDef,
	type CanvasImageDef,
	type CanvasMeshDef,
	type CanvasPaint,
	type CanvasPaintDef,
	type CanvasPaintLayer,
	canvasPaint,
	canvasPaintLayersForStyle,
	canvasPaintsForStyle,
} from "@/entities/scene/model/canvas-paint";
import {
	rectNeedsBakedPath,
	roundedPolygonPathData,
	roundedRectPathData,
	roundedStarPathData,
	shapeNeedsBakedPath,
} from "@/entities/scene/model/corner-geometry";
import { compileEffectFieldRoutesForNode } from "@/entities/scene/model/effect-field-routing";
import {
	baseFrequencyToken,
	buildEffectFilter,
	type ComponentTransferFunction,
	type ComponentTransferFunctions,
	type EffectFilterSpec,
	type FilterPrimitive,
} from "@/entities/scene/model/effect-filter";
import {
	type MaskFilterPrimitive,
	maskFilterPadding,
	maskFilterPrimitives,
	maskSolidPaintChannelCoverage,
	type ResolvedMaskApplication,
	type ResolvedMaskDef,
} from "@/entities/scene/model/mask-render";
import {
	isObjectNoiseGradientScopedLook,
	objectNoiseGradientParticleNode,
} from "@/entities/scene/model/noise-gradient-look";
import { createExpressionFrameContext } from "@/entities/scene/model/production-control";
import { resolveNodeRecipe } from "@/entities/scene/model/recipe-resolve";
import {
	getGeometryBounds,
	matrixFromTransform,
	matrixToSvg,
	pathDataForGeometry,
	svgTextAnchorForAlign,
	textAnchorXForAlign,
	textMetricsForGeometry,
} from "@/entities/scene/model/rendering";
import {
	compileScopedLookGraphOverlayFilter,
	type ScopedLookGraphOverlay,
	scopedLookGraphOverlayFilterId,
	scopedLookGraphRunBounds,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import type { SourceOpticsPresentation } from "@/entities/scene/model/source-optics";
import { useSceneStore } from "@/entities/scene/model/store";
import { getStrokeWidthProfileOutline } from "@/entities/scene/model/stroke-outline";
import {
	blendModePresentation,
	type StrokePresentation,
	strokePresentation,
} from "@/entities/scene/model/style-presentation";
import {
	type ResolvedNodeStyle,
	resolveEffects,
	resolveNodeStyle,
	resolvePaints,
} from "@/entities/scene/model/style-resolve";
import { resolveLiveTextFragments } from "@/entities/scene/model/text-fragments";
import { canvasTextLineMeasurer } from "@/entities/scene/model/text-measure";
import type {
	NodeGeometry,
	RevealPaint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { useLiveTransformStore } from "@/features/transform/model/live-drag-store";
import {
	SVG_RENDER_PART_ATTRIBUTE,
	SVG_RENDER_PARTS,
	SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE,
} from "@/shared/lib/svg-render-parts";
import {
	type EffectInfluenceRecipe,
	effectiveTextureBlendMode,
} from "@/shared/vec-core";
import { artboardLookSvgIdSegment as svgIdSegment } from "@/widgets/canvas-shell/model/artboard-look-plan";
import { rasterizeStyleMeshes } from "@/widgets/canvas-shell/model/mesh-raster-bridge";

const starPoints = (
	geometry: Extract<NodeGeometry, { kind: "star" }>,
): string => {
	const points: string[] = [];
	const total = geometry.points * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		points.push(
			`${geometry.center.x + Math.cos(angle) * radius},${geometry.center.y + Math.sin(angle) * radius}`,
		);
	}
	return points.join(" ");
};

const MASK_SILHOUETTE_FILL = "#ffffff";

/**
 * The clip-path/mask attribute the UNTRANSFORMED wrapper around masked content
 * carries. Mirrors the SVG exporter: the def lives in artboard space (the source
 * transform rides on the silhouette), so the wrapper must NOT re-apply the content
 * node's own transform — hence it sits above `<g data-node-id transform>`.
 */
export const maskApplicationProps = (
	application: ResolvedMaskApplication,
): { readonly clipPath: string } | { readonly mask: string } => {
	const reference = `url(#${application.domId})`;
	return application.mode === "clip"
		? { clipPath: reference }
		: { mask: reference };
};

/** Renders one mask alpha-filter primitive; the first in a chain reads SourceGraphic. */
function MaskFilterPrimitiveElement({
	primitive,
	isFirst,
}: {
	readonly primitive: MaskFilterPrimitive;
	readonly isFirst: boolean;
}) {
	const inProps = isFirst ? { in: "SourceGraphic" } : {};
	switch (primitive.kind) {
		case "morphology":
			return (
				<feMorphology
					{...inProps}
					operator={primitive.operator}
					radius={primitive.radius}
				/>
			);
		case "blur":
			return (
				<feGaussianBlur {...inProps} stdDeviation={primitive.stdDeviation} />
			);
		case "invert-alpha":
			return (
				<feComponentTransfer {...inProps}>
					<feFuncA type="table" tableValues="1 0" />
				</feComponentTransfer>
			);
		case "invert-luminance":
			return (
				<>
					<feColorMatrix
						{...inProps}
						type="luminanceToAlpha"
						result="mask-luminance-alpha"
					/>
					<feComponentTransfer
						in="mask-luminance-alpha"
						result="mask-inverted-alpha"
					>
						<feFuncA type="table" tableValues="1 0" />
					</feComponentTransfer>
					<feFlood floodColor="#ffffff" result="mask-white" />
					<feComposite
						in="mask-white"
						in2="mask-inverted-alpha"
						operator="in"
					/>
				</>
			);
		case "opacity":
			return (
				<feColorMatrix
					{...inProps}
					type="matrix"
					values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${primitive.value} 0`}
				/>
			);
	}
}

/** Authored stroke-blur radius -> Gaussian sigma, matching the node-effect convention. */
const strokeBlurSigmaForRadius = (radius: number): number =>
	Math.max(0, radius) / 2;

/** Stable geometry-local filter id for a node's stroke-only blur, shared with export. */
const strokeBlurFilterDomId = (nodeId: string): string =>
	`vecmo-stroke-blur-${svgIdSegment(nodeId)}`;

/**
 * Geometry-local `<filter>` that Gaussian-blurs only the stroke group, byte-aligned
 * with the SVG exporter's `strokeBlurFilterDef` so the live canvas and an exported
 * SVG soften the stroke identically.
 */
function StrokeBlurFilterDef({
	node,
	resolvedStyle,
}: {
	readonly node: VectorNode;
	readonly resolvedStyle: ResolvedNodeStyle;
}) {
	const sigma = strokeBlurSigmaForRadius(resolvedStyle.strokeBlurRadius);
	const bounds = getGeometryBounds(node.geometry);
	const pad = resolvedStyle.strokeWidth / 2 + sigma * 3;
	return (
		<filter
			id={strokeBlurFilterDomId(node.id)}
			filterUnits="userSpaceOnUse"
			x={bounds.x - pad}
			y={bounds.y - pad}
			width={bounds.width + pad * 2}
			height={bounds.height + pad * 2}
			colorInterpolationFilters="sRGB"
		>
			<feGaussianBlur in="SourceGraphic" stdDeviation={sigma} />
		</filter>
	);
}

/**
 * Paints a node as a white silhouette for use directly inside a
 * `<clipPath>`/`<mask>`. Regular scene masks remain fill-only; frame-look
 * selection mattes opt into stroke inclusion so the filtered duplicate covers
 * the same object edge as the full-frame pass.
 */
export function MaskSilhouette({
	node,
	includeStroke = false,
	fill = MASK_SILHOUETTE_FILL,
}: {
	readonly node: VectorNode;
	readonly includeStroke?: boolean;
	readonly fill?: string;
}) {
	const transform = matrixToSvg(matrixFromTransform(node.transform));
	const { geometry } = node;
	const strokeWidth = includeStroke ? Math.max(0, node.style.strokeWidth) : 0;
	const strokeProps =
		strokeWidth > 0
			? ({
					stroke: fill,
					strokeWidth,
				} as const)
			: {};
	switch (geometry.kind) {
		case "rect":
			// Match the fill render: baked <path> for per-corner/squircle so the
			// mask silhouette never diverges from the painted shape.
			if (rectNeedsBakedPath(geometry)) {
				return (
					<path
						d={roundedRectPathData(geometry)}
						fill={fill}
						transform={transform}
					/>
				);
			}
			return (
				<rect
					x={geometry.bounds.x}
					y={geometry.bounds.y}
					width={geometry.bounds.width}
					height={geometry.bounds.height}
					rx={geometry.cornerRadius}
					fill={fill}
					transform={transform}
					{...strokeProps}
				/>
			);
		case "ellipse":
			return (
				<ellipse
					cx={geometry.bounds.x + geometry.bounds.width / 2}
					cy={geometry.bounds.y + geometry.bounds.height / 2}
					rx={geometry.bounds.width / 2}
					ry={geometry.bounds.height / 2}
					fill={fill}
					transform={transform}
					{...strokeProps}
				/>
			);
		case "line":
			return includeStroke ? (
				<line
					x1={geometry.start.x}
					y1={geometry.start.y}
					x2={geometry.end.x}
					y2={geometry.end.y}
					fill="none"
					stroke={fill}
					strokeWidth={Math.max(1, strokeWidth)}
					transform={transform}
				/>
			) : null;
		case "polygon":
			if (shapeNeedsBakedPath(geometry)) {
				return (
					<path
						d={roundedPolygonPathData(geometry)}
						fill={fill}
						transform={transform}
					/>
				);
			}
			return (
				<polygon
					points={geometry.points
						.map((point) => `${point.x},${point.y}`)
						.join(" ")}
					fill={fill}
					transform={transform}
					{...strokeProps}
				/>
			);
		case "star":
			if (shapeNeedsBakedPath(geometry)) {
				return (
					<path
						d={roundedStarPathData(geometry)}
						fill={fill}
						transform={transform}
					/>
				);
			}
			return (
				<polygon
					points={starPoints(geometry)}
					fill={fill}
					transform={transform}
					{...strokeProps}
				/>
			);
		case "path":
			return (
				<path
					d={pathDataForGeometry(geometry)}
					fillRule={geometry.fillRule}
					fill={fill}
					transform={transform}
					{...strokeProps}
				/>
			);
		case "image":
		case "text":
			return includeStroke ? (
				<rect
					x={geometry.bounds.x}
					y={geometry.bounds.y}
					width={geometry.bounds.width}
					height={geometry.bounds.height}
					fill={fill}
					transform={transform}
				/>
			) : null;
		default:
			return null;
	}
}

/** Renders one representable mask as a `<clipPath>` or luminance `<mask>` def. */
function MaskDef({
	def,
	artboardWidth,
	artboardHeight,
}: {
	readonly def: ResolvedMaskDef;
	readonly artboardWidth: number;
	readonly artboardHeight: number;
}) {
	const domId = def.domId;
	const channel = def.channel ?? "alpha";
	const silhouettes = def.maskNodes.map((maskNode) => {
		const sourceStyle = resolveNodeStyle(maskNode.style);
		const sourcePaint = sourceStyle.fills[0];
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
		const opacity =
			(sourcePaint?.kind === "solid" ? sourcePaint.opacity : 1) *
			sourceStyle.opacity *
			rgbCoverage;
		return {
			node: maskNode,
			fill,
			opacity,
		};
	});
	if (def.mode === "clip") {
		return (
			<clipPath id={domId} clipPathUnits="userSpaceOnUse">
				{silhouettes.map((entry) => (
					<MaskSilhouette
						key={entry.node.id}
						node={entry.node}
						fill={entry.fill}
					/>
				))}
			</clipPath>
		);
	}
	const primitives = maskFilterPrimitives(def);
	const padding = maskFilterPadding(def);
	const filterId = primitives.length > 0 ? `${domId}-feather` : null;
	return (
		<>
			{filterId ? (
				<filter
					id={filterId}
					filterUnits="userSpaceOnUse"
					x={-padding}
					y={-padding}
					width={artboardWidth + padding * 2}
					height={artboardHeight + padding * 2}
					colorInterpolationFilters="sRGB"
				>
					{primitives.map((primitive, index) => (
						<MaskFilterPrimitiveElement
							// biome-ignore lint/suspicious/noArrayIndexKey: ordered fixed filter chain
							key={index}
							primitive={primitive}
							isFirst={index === 0}
						/>
					))}
				</filter>
			) : null}
			<mask
				id={domId}
				maskUnits="userSpaceOnUse"
				{...{ "mask-type": channel === "luminance" ? "luminance" : "alpha" }}
				x={-padding}
				y={-padding}
				width={artboardWidth + padding * 2}
				height={artboardHeight + padding * 2}
			>
				{filterId ? (
					<g filter={`url(#${filterId})`}>
						{silhouettes.map((entry) => (
							<g key={entry.node.id} opacity={entry.opacity}>
								<MaskSilhouette node={entry.node} fill={entry.fill} />
							</g>
						))}
					</g>
				) : (
					silhouettes.map((entry) => (
						<g key={entry.node.id} opacity={entry.opacity}>
							<MaskSilhouette node={entry.node} fill={entry.fill} />
						</g>
					))
				)}
			</mask>
		</>
	);
}

/**
 * Emits the `<clipPath>`/`<mask>` defs for the mask sources that live in one
 * artboard. Rendered inside the artboard's translate group so the artboard-local
 * silhouette coordinates align with the (also artboard-local) masked content. The
 * source ids are document-unique, so the def ids never collide across artboards.
 */
export function CanvasMaskDefs({
	defs,
	artboardWidth,
	artboardHeight,
}: {
	readonly defs: readonly ResolvedMaskDef[];
	readonly artboardWidth: number;
	readonly artboardHeight: number;
}) {
	if (defs.length === 0) return null;
	return (
		<defs>
			{defs.map((def) => (
				<MaskDef
					key={def.key}
					def={def}
					artboardWidth={artboardWidth}
					artboardHeight={artboardHeight}
				/>
			))}
		</defs>
	);
}

type VectorShapeBaseProps = {
	readonly [SVG_RENDER_PART_ATTRIBUTE]: typeof SVG_RENDER_PARTS.paint;
	readonly fill: string;
	readonly fillOpacity: number | undefined;
	readonly filter: string | undefined;
	readonly opacity: number;
	readonly stroke: string;
	readonly strokeOpacity: number | undefined;
	readonly strokeWidth: number;
	readonly vectorEffect: "non-scaling-stroke";
} & StrokePresentation;

/**
 * Presentation props {@link renderVectorGeometry} can paint a geometry with. The
 * single-paint path passes {@link VectorShapeBaseProps} (render-part marker +
 * absolute node opacity on the element); each stacked layer passes a subset (no
 * marker, no opacity — those live on the wrapping paint group), so the marker and
 * opacity are optional here.
 */
type GeometryPaintProps = {
	readonly [SVG_RENDER_PART_ATTRIBUTE]?: typeof SVG_RENDER_PARTS.paint;
	readonly fill: string;
	readonly fillOpacity?: number;
	readonly filter?: string;
	readonly opacity?: number;
	readonly stroke: string;
	readonly strokeOpacity?: number;
	readonly strokeWidth: number;
	readonly vectorEffect: "non-scaling-stroke";
} & Partial<StrokePresentation>;

function GradientDef({ def }: { readonly def: CanvasGradientDef }) {
	const stops = def.stops.map((stop) => (
		<stop
			key={`${def.id}-stop-${stop.offset}-${stop.color}-${stop.opacity}`}
			offset={stop.offset}
			stopColor={stop.color}
			stopOpacity={stop.opacity}
		/>
	));
	if (def.kind === "linear" && def.linear) {
		return (
			<linearGradient
				id={def.id}
				gradientUnits="userSpaceOnUse"
				x1={def.linear.x1}
				y1={def.linear.y1}
				x2={def.linear.x2}
				y2={def.linear.y2}
				gradientTransform={def.transform}
			>
				{stops}
			</linearGradient>
		);
	}
	if (def.kind === "radial" && def.radial) {
		return (
			<radialGradient
				id={def.id}
				gradientUnits="userSpaceOnUse"
				cx={def.radial.cx}
				cy={def.radial.cy}
				r={def.radial.r}
				gradientTransform={def.transform}
			>
				{stops}
			</radialGradient>
		);
	}
	return null;
}

function ImagePatternDef({ def }: { readonly def: CanvasImageDef }) {
	return (
		<pattern
			id={def.id}
			patternUnits="objectBoundingBox"
			patternContentUnits="objectBoundingBox"
			width={1}
			height={1}
			patternTransform={def.transform}
		>
			<image
				href={def.href}
				width={1}
				height={1}
				preserveAspectRatio={preserveAspectRatioForImageFit(def.fit)}
			/>
		</pattern>
	);
}

/**
 * Renderer adapter for a mesh paint: a `userSpaceOnUse` `<pattern>` wrapping the
 * pre-rasterized bitmap. The tile is positioned at the mesh's node-local bounds
 * (`x/y/width/height`); under `patternContentUnits="userSpaceOnUse"` the content
 * origin is the TILE origin, so the `<image>` is placed at `0,0` (tile-local) and
 * sized to the bounds. `preserveAspectRatio="none"` lets a non-square mesh stretch
 * to its box without letterboxing. The fill then tracks the shape under pan/zoom.
 */
function MeshPatternDef({ def }: { readonly def: CanvasMeshDef }) {
	return (
		<pattern
			id={def.id}
			patternUnits="userSpaceOnUse"
			patternContentUnits="userSpaceOnUse"
			x={def.x}
			y={def.y}
			width={def.width}
			height={def.height}
			patternTransform={def.transform}
		>
			<image
				href={def.dataUrl}
				x={0}
				y={0}
				width={def.width}
				height={def.height}
				preserveAspectRatio="none"
			/>
		</pattern>
	);
}

function PaintDef({ def }: { readonly def: CanvasPaintDef }) {
	if (def.kind === "image") return <ImagePatternDef def={def} />;
	if (def.kind === "mesh") return <MeshPatternDef def={def} />;
	return <GradientDef def={def} />;
}

/** Emits paint defs needed by the provided resolved canvas paints. */
export function PaintDefs({
	paints,
}: {
	readonly paints: readonly CanvasPaint[];
}) {
	const defs = paints
		.map((paint) => paint.def)
		.filter((def): def is CanvasPaintDef => def !== null);
	if (defs.length === 0) return null;
	return (
		<defs>
			{defs.map((def) => (
				<PaintDef key={def.id} def={def} />
			))}
		</defs>
	);
}

function renderVectorGeometry(node: VectorNode, baseProps: GeometryPaintProps) {
	switch (node.geometry.kind) {
		case "rect": {
			const geometry = node.geometry;
			// Per-corner or squircle corners cannot be expressed by <rect rx>, so
			// emit a baked <path> from the shared corner builder; uniform circular
			// corners keep the cheap native <rect rx> fast path.
			if (rectNeedsBakedPath(geometry)) {
				return (
					<path
						{...baseProps}
						d={roundedRectPathData(geometry)}
						strokeLinejoin="round"
					/>
				);
			}
			return (
				<rect
					{...baseProps}
					x={geometry.bounds.x}
					y={geometry.bounds.y}
					width={geometry.bounds.width}
					height={geometry.bounds.height}
					rx={geometry.cornerRadius}
				/>
			);
		}
		case "ellipse":
			return (
				<ellipse
					{...baseProps}
					cx={node.geometry.bounds.x + node.geometry.bounds.width / 2}
					cy={node.geometry.bounds.y + node.geometry.bounds.height / 2}
					rx={node.geometry.bounds.width / 2}
					ry={node.geometry.bounds.height / 2}
				/>
			);
		case "line":
			return (
				<line
					{...baseProps}
					x1={node.geometry.start.x}
					y1={node.geometry.start.y}
					x2={node.geometry.end.x}
					y2={node.geometry.end.y}
				/>
			);
		case "polygon": {
			const polygon = node.geometry;
			if (shapeNeedsBakedPath(polygon)) {
				return (
					<path
						{...baseProps}
						d={roundedPolygonPathData(polygon)}
						strokeLinejoin="round"
					/>
				);
			}
			return (
				<polygon
					{...baseProps}
					points={polygon.points
						.map((point) => `${point.x},${point.y}`)
						.join(" ")}
				/>
			);
		}
		case "star": {
			const star = node.geometry;
			if (shapeNeedsBakedPath(star)) {
				return (
					<path
						{...baseProps}
						d={roundedStarPathData(star)}
						strokeLinejoin="round"
					/>
				);
			}
			return <polygon {...baseProps} points={starPoints(star)} />;
		}
		case "text":
			// Text routes through a component so it can subscribe to the motion store
			// (to detect a text animator) and, only when one is active, to the playhead
			// frame for per-fragment poses — without re-rendering plain text per tick.
			return <TextNodeContent node={node} baseProps={baseProps} />;
		case "path":
			return (
				<path
					{...baseProps}
					d={pathDataForGeometry(node.geometry)}
					fillRule={node.geometry.fillRule}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			);
	}
}

/**
 * SVG `transform` for one fragment pose: position delta, then a pivot-anchored
 * rotation, then a pivot-anchored scale. Each clause is emitted only when it does
 * work, so a position-only reveal (Word Rise) stays a bare `translate`.
 */
function fragmentTransformValue(pose: TextFragmentPose): string | undefined {
	const parts: string[] = [];
	if (pose.translate.x !== 0 || pose.translate.y !== 0) {
		parts.push(`translate(${pose.translate.x} ${pose.translate.y})`);
	}
	if (pose.rotation !== 0) {
		parts.push(`rotate(${pose.rotation} ${pose.pivot.x} ${pose.pivot.y})`);
	}
	if (pose.scaleX !== 1 || pose.scaleY !== 1) {
		parts.push(
			`translate(${pose.pivot.x} ${pose.pivot.y}) scale(${pose.scaleX} ${pose.scaleY}) translate(${-pose.pivot.x} ${-pose.pivot.y})`,
		);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

/** Plain single-`<text>` render — the path for text nodes with no active animator. */
function renderPlainTextNode(node: VectorNode, baseProps: GeometryPaintProps) {
	if (node.geometry.kind !== "text") return null;
	const { bounds } = node.geometry;
	const metrics = textMetricsForGeometry(node.geometry);
	const anchorX = textAnchorXForAlign(bounds, metrics.style.align);
	const firstBaseline =
		metrics.lineMetrics[0]?.baseline ??
		bounds.y + metrics.fontMetrics.baselineOffset;
	return (
		<text
			{...baseProps}
			x={anchorX}
			y={firstBaseline}
			fontFamily={metrics.style.fontFamily}
			fontSize={metrics.style.fontSize}
			fontWeight={metrics.style.fontWeight}
			fontStyle={metrics.style.italic ? "italic" : undefined}
			textDecoration={metrics.style.underline ? "underline" : undefined}
			letterSpacing={metrics.style.letterSpacing || undefined}
			textAnchor={svgTextAnchorForAlign(metrics.style.align)}
		>
			{metrics.lineMetrics.map((lineMetric) => (
				<tspan
					key={`${node.id}-${lineMetric.index}-${lineMetric.text}`}
					x={anchorX}
					y={lineMetric.baseline}
				>
					{lineMetric.text}
				</tspan>
			))}
		</text>
	);
}

/**
 * Per-fragment text render driven by an active animator. Subscribes to the playhead
 * frame so it re-renders each scrub/playback tick (one node, cheap), recomputing
 * poses from the live motion document. Each fragment is its own `<text>` positioned
 * at its measured left edge, carrying node-opacity × fragment-opacity and the pose
 * transform; at rest the group overlays the plain `<text>` render.
 */
function AnimatedTextFragments({
	node,
	baseProps,
	binding,
}: {
	readonly node: VectorNode;
	readonly baseProps: GeometryPaintProps;
	readonly binding: TextAnimatorBinding;
}) {
	const frame = useTransportStore((state) => state.currentFrame);
	// Only a selector that actually carries an Offset expression needs the
	// documents; without one both selectors return `null`, so this leaf keeps its
	// narrow subscription and never re-renders on unrelated document edits.
	const needsExpressionContext = binding.selectors.some(
		(selector) => selector.offsetExpression !== undefined,
	);
	const expressionScene = useSceneStore((state) =>
		needsExpressionContext ? state.document : null,
	);
	const expressionMotion = useMotionStore((state) =>
		needsExpressionContext ? state.document : null,
	);
	const render = useMemo(() => {
		if (node.geometry.kind !== "text") return null;
		const target = resolveLiveTextFragments(
			node.id,
			node.geometry,
			binding.unit,
			{ measurer: canvasTextLineMeasurer },
		);
		const context =
			expressionScene && expressionMotion
				? createExpressionFrameContext(expressionScene, expressionMotion, frame)
				: undefined;
		return {
			fragments: target.fragments,
			poses: evaluateTextAnimator(target, binding, frame, context).poses,
			style: textMetricsForGeometry(node.geometry).style,
		};
	}, [node, binding, frame, expressionScene, expressionMotion]);
	if (!render) return renderPlainTextNode(node, baseProps);
	const baseOpacity = node.style.opacity ?? 1;
	const { style } = render;
	return (
		<g data-text-fragments={binding.unit}>
			{render.fragments.map((fragment, index) => {
				if (fragment.text.length === 0) return null;
				const pose = render.poses[index];
				const opacity = baseOpacity * (pose?.opacity ?? 1);
				return (
					<text
						{...baseProps}
						key={fragment.id}
						x={fragment.bounds.x}
						y={fragment.baseline}
						opacity={opacity}
						transform={pose ? fragmentTransformValue(pose) : undefined}
						fontFamily={style.fontFamily}
						fontSize={style.fontSize}
						fontWeight={style.fontWeight}
						fontStyle={style.italic ? "italic" : undefined}
						textDecoration={style.underline ? "underline" : undefined}
						letterSpacing={style.letterSpacing || undefined}
						textAnchor="start"
					>
						{fragment.text}
					</text>
				);
			})}
		</g>
	);
}

/**
 * Text node body. Subscribes only to the motion store to detect an active animator,
 * so plain text never re-renders per playback tick; an active animator hands off to
 * {@link AnimatedTextFragments}, which subscribes to the frame.
 */
function TextNodeContent({
	node,
	baseProps,
}: {
	readonly node: VectorNode;
	readonly baseProps: GeometryPaintProps;
}) {
	const binding = useMotionStore((state) =>
		activeTextAnimator(state.document, node.id),
	);
	if (!binding) return renderPlainTextNode(node, baseProps);
	return (
		<AnimatedTextFragments
			node={node}
			baseProps={baseProps}
			binding={binding}
		/>
	);
}

function PlacedImageNode({
	node,
	filterId,
	assets,
}: {
	readonly node: VectorNode & {
		readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
	};
	readonly filterId?: string;
	readonly assets: SceneDocument["assets"];
}) {
	const resolution = resolveImageAssetReference({ assets }, node.geometry);
	const presentationAsset =
		resolution.status === "external-preview"
			? resolution.previewAsset
			: resolution.status === "data-url" || resolution.status === "reference"
				? resolution.asset
				: undefined;
	const href =
		resolution.status === "external-preview" ||
		resolution.status === "data-url" ||
		resolution.status === "reference"
			? resolution.href
			: undefined;
	const externalPlacement = externalAssetPlacementMetadataForNode(node);
	const isBabylonFallback =
		externalPlacement?.assetKind === "model-3d" &&
		(externalPlacement.format === "glb" || externalPlacement.format === "gltf");
	const placement = imagePlacementForNode(node);
	const { bounds } = node.geometry;
	const commonProps = {
		[SVG_RENDER_PART_ATTRIBUTE]: SVG_RENDER_PARTS.paint,
		...(isBabylonFallback ? { "data-runtime-3d-fallback": "babylon" } : {}),
		opacity: node.style.opacity,
		filter: filterId ? `url(#${filterId})` : undefined,
	} as const;
	if (!href) {
		if (externalPlacement) {
			const label =
				externalPlacement.assetKind === "model-3d"
					? "3D model"
					: externalPlacement.assetKind === "code-module"
						? "Code asset"
						: "External asset";
			const detail = [
				externalPlacement.format,
				externalPlacement.capabilitySummary?.includes("runtime-webgl")
					? "WebGL"
					: null,
				externalPlacement.previewAssetId ? "preview" : "no preview",
			]
				.filter(Boolean)
				.join(" · ");
			const fontSize = Math.max(
				8,
				Math.min(14, Math.min(bounds.width / 12, bounds.height / 5)),
			);
			return (
				<g {...commonProps}>
					<rect
						x={bounds.x}
						y={bounds.y}
						width={bounds.width}
						height={bounds.height}
						rx={Math.min(
							10,
							Math.max(2, Math.min(bounds.width, bounds.height) / 18),
						)}
						fill="#101319"
						stroke="#4f8cff"
						strokeDasharray="6 4"
						strokeWidth={1}
						vectorEffect="non-scaling-stroke"
					/>
					<path
						d={`M ${bounds.x + bounds.width * 0.22} ${bounds.y + bounds.height * 0.42} L ${bounds.x + bounds.width * 0.5} ${bounds.y + bounds.height * 0.26} L ${bounds.x + bounds.width * 0.78} ${bounds.y + bounds.height * 0.42} L ${bounds.x + bounds.width * 0.5} ${bounds.y + bounds.height * 0.58} Z`}
						fill="none"
						stroke="#7fb0ff"
						strokeWidth={1.2}
						vectorEffect="non-scaling-stroke"
						opacity={0.9}
					/>
					<text
						x={bounds.x + bounds.width / 2}
						y={bounds.y + bounds.height * 0.7}
						fill="#dce8ff"
						fontFamily="ui-sans-serif, system-ui, sans-serif"
						fontSize={fontSize}
						fontWeight={500}
						textAnchor="middle"
					>
						{label}
					</text>
					{detail ? (
						<text
							x={bounds.x + bounds.width / 2}
							y={bounds.y + bounds.height * 0.7 + fontSize * 1.25}
							fill="#8ba6cc"
							fontFamily="ui-sans-serif, system-ui, sans-serif"
							fontSize={Math.max(7, fontSize * 0.72)}
							textAnchor="middle"
						>
							{detail}
						</text>
					) : null}
				</g>
			);
		}
		return (
			<rect
				{...commonProps}
				x={bounds.x}
				y={bounds.y}
				width={bounds.width}
				height={bounds.height}
				fill="#111111"
				stroke="#3a3a3a"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		);
	}
	if (placement?.crop) {
		const crop = placement.crop;
		const sourceWidth = presentationAsset?.width ?? crop.width;
		const sourceHeight = presentationAsset?.height ?? crop.height;
		return (
			<svg
				{...commonProps}
				aria-hidden="true"
				x={bounds.x}
				y={bounds.y}
				width={bounds.width}
				height={bounds.height}
				viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
				preserveAspectRatio="none"
			>
				<image
					href={href}
					x={0}
					y={0}
					width={sourceWidth}
					height={sourceHeight}
					preserveAspectRatio="none"
				/>
			</svg>
		);
	}
	return (
		<image
			{...commonProps}
			href={href}
			x={bounds.x}
			y={bounds.y}
			width={bounds.width}
			height={bounds.height}
			preserveAspectRatio="none"
		/>
	);
}

/**
 * Shared `<feFunc*>` attributes for one transfer function. A single (non-union)
 * shape so it spreads cleanly into the four channel elements; omitted fields fall
 * back to the SVG defaults, matching the string serializer.
 */
function transferFuncProps(func: ComponentTransferFunction): {
	type: ComponentTransferFunction["type"];
	tableValues?: string;
	slope?: number;
	intercept?: number;
	amplitude?: number;
	exponent?: number;
	offset?: number;
} {
	switch (func.type) {
		case "identity":
			return { type: "identity" };
		case "table":
		case "discrete":
			return { type: func.type, tableValues: func.tableValues.join(" ") };
		case "linear":
			return { type: "linear", slope: func.slope, intercept: func.intercept };
		case "gamma":
			return {
				type: "gamma",
				amplitude: func.amplitude,
				exponent: func.exponent,
				offset: func.offset,
			};
	}
}

/** `<feFunc{R,G,B,A}>` children for a `component-transfer` primitive's functions. */
function transferFuncElements(
	functions: ComponentTransferFunctions,
): ReactNode[] {
	const elements: ReactNode[] = [];
	if (functions.r)
		elements.push(<feFuncR key="r" {...transferFuncProps(functions.r)} />);
	if (functions.g)
		elements.push(<feFuncG key="g" {...transferFuncProps(functions.g)} />);
	if (functions.b)
		elements.push(<feFuncB key="b" {...transferFuncProps(functions.b)} />);
	if (functions.a)
		elements.push(<feFuncA key="a" {...transferFuncProps(functions.a)} />);
	return elements;
}

/** Maps one renderer-agnostic {@link FilterPrimitive} to its SVG `<fe*>` JSX. */
function primitiveElement(primitive: FilterPrimitive, key: number) {
	switch (primitive.kind) {
		case "gaussian-blur":
			return (
				<feGaussianBlur
					key={key}
					in={primitive.in}
					stdDeviation={
						typeof primitive.stdDeviation === "number"
							? primitive.stdDeviation
							: `${primitive.stdDeviation[0]} ${primitive.stdDeviation[1]}`
					}
					result={primitive.result}
				/>
			);
		case "offset":
			return (
				<feOffset
					key={key}
					in={primitive.in}
					dx={primitive.dx}
					dy={primitive.dy}
					result={primitive.result}
				/>
			);
		case "flood":
			return (
				<feFlood
					key={key}
					floodColor={primitive.floodColor}
					floodOpacity={primitive.floodOpacity}
					result={primitive.result}
				/>
			);
		case "composite": {
			const arithmetic = primitive.operator === "arithmetic";
			return (
				<feComposite
					key={key}
					operator={primitive.operator}
					in={primitive.in}
					in2={primitive.in2}
					k1={arithmetic ? primitive.k1 : undefined}
					k2={arithmetic ? primitive.k2 : undefined}
					k3={arithmetic ? primitive.k3 : undefined}
					k4={arithmetic ? primitive.k4 : undefined}
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				/>
			);
		}
		case "morphology":
			return (
				<feMorphology
					key={key}
					operator={primitive.operator}
					radius={primitive.radius}
					in={primitive.in}
					result={primitive.result}
				/>
			);
		case "blend":
			return (
				<feBlend
					key={key}
					mode={primitive.mode}
					in={primitive.in}
					in2={primitive.in2}
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				/>
			);
		case "merge":
			return (
				<feMerge key={key} result={primitive.result}>
					{primitive.inputs.map((input) => (
						<feMergeNode key={input} in={input} />
					))}
				</feMerge>
			);
		case "color-matrix":
			return (
				<feColorMatrix
					key={key}
					type={primitive.matrixType}
					in={primitive.in}
					values={
						primitive.matrixType === "saturate"
							? String(primitive.values[0] ?? 1)
							: primitive.values.join(" ")
					}
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				/>
			);
		case "turbulence":
			return (
				<feTurbulence
					key={key}
					type={primitive.type ?? "fractalNoise"}
					baseFrequency={baseFrequencyToken(primitive.baseFrequency)}
					numOctaves={primitive.numOctaves}
					seed={primitive.seed}
					stitchTiles="stitch"
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				>
					{primitive.animate ? (
						<animate
							attributeName={primitive.animate.attributeName}
							values={primitive.animate.values}
							dur={primitive.animate.dur}
							repeatCount="indefinite"
						/>
					) : null}
				</feTurbulence>
			);
		case "component-transfer":
			return (
				<feComponentTransfer
					key={key}
					in={primitive.in}
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				>
					{transferFuncElements(primitive.functions)}
				</feComponentTransfer>
			);
		case "displacement-map":
			return (
				<feDisplacementMap
					key={key}
					in={primitive.in}
					in2={primitive.in2}
					scale={primitive.scale}
					xChannelSelector={primitive.xChannelSelector}
					yChannelSelector={primitive.yChannelSelector}
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				/>
			);
		case "convolve-matrix":
			return (
				<feConvolveMatrix
					key={key}
					in={primitive.in}
					order={primitive.order}
					kernelMatrix={primitive.kernelMatrix.join(" ")}
					divisor={primitive.divisor}
					bias={primitive.bias}
					edgeMode={primitive.edgeMode}
					preserveAlpha={primitive.preserveAlpha}
					colorInterpolationFilters={primitive.colorInterpolation}
					result={primitive.result}
				/>
			);
		case "image":
			return (
				<feImage
					key={key}
					href={primitive.href}
					x={primitive.x}
					y={primitive.y}
					width={primitive.width}
					height={primitive.height}
					preserveAspectRatio={primitive.preserveAspectRatio}
					result={primitive.result}
				/>
			);
	}
}

/**
 * Renderer adapter: maps a built {@link EffectFilterSpec} to an inline SVG
 * `<filter>`. It is the canvas twin of the string exporters' `serializeEffectFilter`,
 * driven by the same `spec.primitives`, so the editor and both export targets stay
 * visually identical. `filterUnits="userSpaceOnUse"` with the untransformed region
 * (geometry-local for a leaf, composite-local for a subtree-carrier node — see
 * `effectFilterBoundsForNode`) keeps the filter transform-independent, which is why
 * it can live inside the node `<g>` and still match every renderer. Callers render
 * it only when `spec.primitives` is non-empty.
 */
export function EffectFilterDefs({
	spec,
}: {
	readonly spec: EffectFilterSpec;
}) {
	return (
		<filter
			id={spec.id}
			filterUnits="userSpaceOnUse"
			x={spec.region.x}
			y={spec.region.y}
			width={spec.region.width}
			height={spec.region.height}
		>
			{spec.primitives.map(primitiveElement)}
		</filter>
	);
}

/**
 * Renders a node whose appearance carries more than one fill or stroke. Each paint
 * becomes its own geometry layer (fills bottom→top, then strokes above all fills),
 * wrapped in one `data-render-part="paint"` group that owns the node opacity and the
 * effect filter — so the composited stack fades/filters as a unit and motion playback
 * still finds a single paint target. Strokes share the node's one stroke
 * weight/dash/cap/join (the schema has no per-stroke geometry).
 *
 * `paintOpacity` defaults to the node's own opacity; a subtree-carrier caller
 * (see `hasSubtreeCarrier`: group, Blend, and frame containers) passes `1` here
 * because its subtree carrier `<g>` already owns the node opacity. For a
 * group/Blend this element is always the invisible degenerate placeholder, so
 * the override only keeps the DOM attribute clean and has no visual effect; for
 * a frame this element IS the real, visible background paint, so the override
 * is load-bearing — without it the background would double-apply opacity (once
 * here, once on the carrier).
 */
function StackedVectorShape({
	node,
	resolvedStyle,
	filterId,
	idSeed,
	assets,
	paintOpacity = node.style.opacity,
}: {
	readonly node: VectorNode;
	readonly resolvedStyle: ResolvedNodeStyle;
	readonly filterId?: string;
	readonly idSeed: string;
	readonly assets: SceneDocument["assets"];
	readonly paintOpacity?: number;
}) {
	const { fills, strokes } = canvasPaintLayersForStyle(
		resolvedStyle,
		idSeed,
		(paint) => imagePaintHref(paint, assets),
	);
	const strokeParts = strokePresentation(resolvedStyle, true);
	const fillLayerProps = (layer: CanvasPaintLayer): GeometryPaintProps => ({
		fill: layer.paint.value,
		fillOpacity: layer.paint.opacity === 1 ? undefined : layer.paint.opacity,
		stroke: "none",
		strokeWidth: 0,
		vectorEffect: "non-scaling-stroke",
	});
	const strokeLayerProps = (layer: CanvasPaintLayer): GeometryPaintProps => ({
		fill: "none",
		stroke: layer.paint.value,
		strokeOpacity: layer.paint.opacity === 1 ? undefined : layer.paint.opacity,
		strokeWidth: resolvedStyle.strokeWidth,
		vectorEffect: "non-scaling-stroke",
		...strokeParts,
	});
	// Stroke-only blur: keep fills sharp and Gaussian-blur just the stroke group.
	// Node opacity and the node effect filter stay on the outer <g> so they apply
	// to the COMBINED result, not to fill and stroke independently.
	const strokeBlurActive =
		resolvedStyle.strokeWidth > 0 &&
		resolvedStyle.strokeBlurRadius > 0 &&
		strokes.length > 0;
	const strokeNodes = strokes.map((layer) => (
		<Fragment key={layer.key}>
			{renderVectorGeometry(node, strokeLayerProps(layer))}
		</Fragment>
	));
	return (
		<>
			<PaintDefs paints={[...fills, ...strokes].map((layer) => layer.paint)} />
			{strokeBlurActive ? (
				<StrokeBlurFilterDef node={node} resolvedStyle={resolvedStyle} />
			) : null}
			<g
				{...{ [SVG_RENDER_PART_ATTRIBUTE]: SVG_RENDER_PARTS.paint }}
				opacity={paintOpacity}
				filter={filterId ? `url(#${filterId})` : undefined}
			>
				{fills.map((layer) => (
					<Fragment key={layer.key}>
						{renderVectorGeometry(node, fillLayerProps(layer))}
					</Fragment>
				))}
				{strokeBlurActive ? (
					<g filter={`url(#${strokeBlurFilterDomId(node.id)})`}>
						{strokeNodes}
					</g>
				) : (
					strokeNodes
				)}
			</g>
		</>
	);
}

function VectorShape({
	node,
	filterId,
	assets,
	paintOpacity = node.style.opacity,
}: {
	readonly node: VectorNode;
	readonly filterId?: string;
	readonly assets: SceneDocument["assets"];
	/**
	 * Opacity applied to this node's own paint. Defaults to the node's opacity; a
	 * subtree-carrier caller (see `hasSubtreeCarrier`) passes `1` because the
	 * subtree carrier `<g>` built by `SceneNode` already owns node opacity — see
	 * `StackedVectorShape`'s doc for why this is a DOM-cleanliness no-op for a
	 * group/Blend's always-invisible placeholder shape, but load-bearing for a
	 * frame's real background paint.
	 */
	readonly paintOpacity?: number;
}) {
	const paintSeed = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	// Rasterizing a mesh fill (adaptive subdivision + pure-JS PNG encode) is costly,
	// so memoize on the node's style reference. Image-reference href resolution is
	// still host-owned because it depends on the scene asset library.
	const resolvedStyle = useMemo(
		() => rasterizeStyleMeshes(resolveNodeStyle(node.style)),
		[node.style],
	);
	if (node.geometry.kind === "image") {
		const imageNode = node as VectorNode & {
			readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
		};
		return (
			<PlacedImageNode node={imageNode} filterId={filterId} assets={assets} />
		);
	}
	// A node with more than one fill or stroke renders each paint as its own stacked
	// layer; the common single-paint node keeps the byte-identical fast path below
	// (one element carrying the render-part marker, node opacity, and fill + stroke).
	// Stroke-only blur also forces the split so the blur reaches the stroke group
	// without softening the fill.
	const needsStrokeBlur =
		resolvedStyle.strokeWidth > 0 && resolvedStyle.strokeBlurRadius > 0;
	if (
		resolvedStyle.fills.length > 1 ||
		resolvedStyle.strokes.length > 1 ||
		needsStrokeBlur
	) {
		return (
			<StackedVectorShape
				node={node}
				resolvedStyle={resolvedStyle}
				filterId={filterId}
				idSeed={paintSeed}
				assets={assets}
				paintOpacity={paintOpacity}
			/>
		);
	}
	const { fill, stroke } = canvasPaintsForStyle(
		resolvedStyle,
		paintSeed,
		(paint) => imagePaintHref(paint, assets),
	);
	const hasStroke = stroke.value !== "none" && resolvedStyle.strokeWidth > 0;

	// A variable-width stroke profile expands to a separate filled outline path
	// instead of a uniform SVG stroke — see `getStrokeWidthProfileOutline`'s doc
	// for the eligibility gate (only ever true on this single-paint fast path,
	// never the stacked multi-paint path). The outline's fill is the RAW legacy
	// `style.stroke` color, not the resolved `stroke.value`: an explicit empty
	// `strokes[]` stack resolves to `"none"` (see `canvasPaint`'s empty-list
	// fallback) even though the legacy color the profile expands is still real,
	// so resolving through the paint pipeline here would silently paint an
	// invisible outline for that case. `pathDataForGeometry` is the SAME shared
	// serializer the node's own path geometry renders with, so the outline
	// matches the base fill's curve fidelity exactly.
	const outline = getStrokeWidthProfileOutline(node);
	if (outline) {
		const baseProps: GeometryPaintProps = {
			fill: fill.value,
			fillOpacity: fill.opacity === 1 ? undefined : fill.opacity,
			stroke: "none",
			strokeWidth: 0,
			vectorEffect: "non-scaling-stroke",
		};
		return (
			<>
				<PaintDefs paints={[fill]} />
				<g
					{...{ [SVG_RENDER_PART_ATTRIBUTE]: SVG_RENDER_PARTS.paint }}
					opacity={paintOpacity}
					filter={filterId ? `url(#${filterId})` : undefined}
				>
					{renderVectorGeometry(node, baseProps)}
					<path
						d={pathDataForGeometry({ kind: "path", shape: outline })}
						fill={node.style.stroke}
						fillRule="nonzero"
					/>
				</g>
			</>
		);
	}

	const baseProps: VectorShapeBaseProps = {
		[SVG_RENDER_PART_ATTRIBUTE]: SVG_RENDER_PARTS.paint,
		fill: fill.value,
		fillOpacity: fill.opacity === 1 ? undefined : fill.opacity,
		filter: filterId ? `url(#${filterId})` : undefined,
		opacity: paintOpacity,
		stroke: stroke.value,
		strokeOpacity: stroke.opacity === 1 ? undefined : stroke.opacity,
		strokeWidth: node.style.strokeWidth,
		vectorEffect: "non-scaling-stroke",
		...strokePresentation(resolvedStyle, hasStroke),
	};

	return (
		<>
			<PaintDefs paints={[fill, stroke]} />
			{renderVectorGeometry(node, baseProps)}
		</>
	);
}

/** Scoped-look grouping context shared while rendering one artboard's node list. */
export type ScopedLookGraphCanvasContext = {
	readonly artboardId: string;
	readonly targets: ReadonlyMap<string, ScopedLookGraphOverlay>;
	readonly runIndex: { value: number };
};

/**
 * Wraps a run of consecutive same-overlay nodes in the compiled scoped-look
 * filter — the SVG-approximated form of a Look Graph overlay (Path Blur,
 * Object Noise Gradient, or a generic selection-scoped graph) that targets one
 * or more nodes as a single filtered unit (see `compileScopedLookGraphOverlayFilter`).
 *
 * A Noise Gradient dissolve's `revealPaint` (see `revealPaintForNode`'s doc)
 * is the ONE exception: `objectNoiseGradientScopedLook` targets exactly one
 * node by construction, so a revealing run is always a run of one. For that
 * case this component renders ONLY the filter `<defs>` (still referenced by
 * id) and hands the SAME compiled filter id + `revealPaint` to that one
 * `SceneNode` via `revealingFilter`, which builds the underlay INSIDE its own
 * `<g data-node-id>` (sibling of the filtered content, both inside the node's
 * own wrapper) instead of this component wrapping a run-level `<g filter>`
 * with the underlay as an external sibling before it. Internalizing into the
 * node's own wrapper is what makes opacity/blend-mode/motion-playback treat
 * the (underlay + filtered content) pair as ONE object — see `SceneNode`'s
 * doc. Every other scoped-look source (Path Blur, a generic selection graph,
 * a non-dissolve or revealPaint-less object-NG run, or any multi-node run)
 * keeps this run-level wrap exactly as before: zero behavior change.
 *
 * This component calls `renderRunNode` to build each child (rather than
 * receiving pre-built `children`) so the filter id it computes below and the
 * id any revealing child references are the SAME single read-and-increment of
 * `context.runIndex` — splitting that computation across two call sites risks
 * two runs racing to read the counter before either increments it, minting a
 * DUPLICATE filter id (a real bug caught and reverted during this fix). Two
 * call sites use this component with two DIFFERENT per-node render shapes
 * (bare `SceneNode` for a node's own `children` list; `SceneNode` wrapped in
 * frame-look-filters/mask-application for a top-level artboard node list —
 * see `renderScopedSceneNodeList` vs `renderArtboardNodeList`), which is why
 * this takes a callback instead of hardcoding `SceneNode` construction here.
 */
export function ScopedLookGraphRun({
	context,
	overlay,
	nodes,
	renderRunNode,
}: {
	readonly context: ScopedLookGraphCanvasContext;
	readonly overlay: ScopedLookGraphOverlay;
	readonly nodes: readonly VectorNode[];
	readonly renderRunNode: (
		node: VectorNode,
		revealingFilter: {
			readonly filterId: string;
			readonly revealPaint: RevealPaint;
		} | null,
	) => ReactNode;
}) {
	const bounds = scopedLookGraphRunBounds(nodes);
	const id = scopedLookGraphOverlayFilterId({
		artboardId: context.artboardId,
		overlay,
		runIndex: context.runIndex.value,
	});
	context.runIndex.value += 1;
	const compiled = compileScopedLookGraphOverlayFilter({
		artboardId: context.artboardId,
		overlay,
		bounds,
		id,
	});
	const revealPaint = revealPaintForNode(overlay);
	// Guard `compiled` here too: if `revealPaint` is set but the graph fails to
	// compile a filter, a child render call must NOT receive a `revealingFilter`
	// referencing a filter id with no matching `<filter>` def — an SVG element
	// with a dangling `filter="url(#missing)"` reference is DROPPED entirely
	// (content vanishes), which is worse than the plain unfiltered render the
	// `!compiled` path below already falls back to.
	const revealingFilter =
		compiled && revealPaint
			? { filterId: compiled.spec.id, revealPaint }
			: null;
	const children = nodes.map((runNode) => (
		<Fragment key={runNode.id}>
			{renderRunNode(runNode, revealingFilter)}
		</Fragment>
	));
	if (!compiled) return <>{children}</>;
	if (revealingFilter) {
		return (
			<>
				<EffectFilterDefs spec={compiled.spec} />
				{children}
			</>
		);
	}
	return (
		<>
			<EffectFilterDefs spec={compiled.spec} />
			<g
				filter={`url(#${compiled.spec.id})`}
				data-scoped-look-graph-id={overlay.id}
				data-scoped-look-graph-source={overlay.source}
			>
				{children}
			</g>
		</>
	);
}

const renderScopedSceneNodeList = (
	nodes: readonly VectorNode[],
	decorative: boolean,
	context: ScopedLookGraphCanvasContext | undefined,
	suppressScopedLookGraphOverlay: boolean,
	assets: SceneDocument["assets"],
	effectInfluenceRecipe: EffectInfluenceRecipe | null | undefined,
	sourceOpticsPresentation: SourceOpticsPresentation | undefined,
): ReactNode => {
	const rendered: ReactNode[] = [];
	let index = 0;
	while (index < nodes.length) {
		const node = nodes[index];
		const overlay =
			context && !suppressScopedLookGraphOverlay && node.visible
				? (context.targets.get(node.id) ?? null)
				: null;
		if (!overlay || !context) {
			rendered.push(
				<SceneNode
					key={node.id}
					node={node}
					decorative={decorative}
					scopedLookGraph={context}
					suppressScopedLookGraphOverlay={suppressScopedLookGraphOverlay}
					assets={assets}
					effectInfluenceRecipe={effectInfluenceRecipe}
					sourceOpticsPresentation={sourceOpticsPresentation}
				/>,
			);
			index += 1;
			continue;
		}
		const run = [node];
		index += 1;
		while (index < nodes.length) {
			const next = nodes[index];
			const nextOverlay =
				next.visible && context ? (context.targets.get(next.id) ?? null) : null;
			if (!nextOverlay || nextOverlay.id !== overlay.id) break;
			run.push(next);
			index += 1;
		}
		rendered.push(
			<ScopedLookGraphRun
				key={`scoped-look-graph-${overlay.id}-${node.id}`}
				context={context}
				overlay={overlay}
				nodes={run}
				renderRunNode={(runNode, revealingFilter) => (
					<SceneNode
						node={runNode}
						decorative={decorative}
						scopedLookGraph={context}
						suppressScopedLookGraphOverlay
						revealingFilter={revealingFilter}
						assets={assets}
						effectInfluenceRecipe={effectInfluenceRecipe}
						sourceOpticsPresentation={sourceOpticsPresentation}
					/>
				)}
			/>,
		);
	}
	return rendered;
};

/**
 * Resolves the second color/gradient a node's Noise Gradient dissolve reveals
 * underneath its own fill, or `null` when this node carries no such reveal.
 * Takes the scoped overlay directly (the caller already knows it — a run's
 * every node shares one overlay, see `ScopedLookGraphRun`) rather than looking
 * it up by nodeId: `ScopedLookGraphRun` calls this once per run to decide
 * whether the run is a revealing one at all (see that component's doc), and a
 * revealing run is always a run of one, so there is never a second node in the
 * SAME call whose overlay this could disagree with. Gated on BOTH the overlay
 * actually being an object-Noise-Gradient overlay (never Path Blur or a
 * generic selection graph) AND the grain node's effective texture blend mode
 * resolving to `"dissolve"` — every other blend mode has no "hole" in the
 * object's own fill for a reveal color to show through, so `revealPaint` is
 * authored-but-inert there and must not render (see
 * {@link import("@/shared/vec-core").effectiveTextureBlendMode}).
 */
function revealPaintForNode(
	overlay: ScopedLookGraphOverlay | null | undefined,
): RevealPaint | null {
	if (!overlay || !isObjectNoiseGradientScopedLook(overlay)) return null;
	const grainNode = objectNoiseGradientParticleNode(overlay);
	if (grainNode?.payload.kind !== "grain") return null;
	const { payload } = grainNode;
	if (!payload.revealPaint) return null;
	if (effectiveTextureBlendMode(payload.texture.material) !== "dissolve") {
		return null;
	}
	return payload.revealPaint;
}

/**
 * Renders the SAME node geometry filled with `revealPaint`, carrying NO
 * filter and NO opacity of its own, as a sibling underlay for a Noise
 * Gradient dissolve (see `RevealPaint`'s doc on `types.ts` and the `grain`
 * payload doc on `LookGraphNodePayload`). Reuses `canvasPaint`/`resolvePaints`
 * — the exact same paint→SVG serializer/defs machinery `VectorShape` uses for
 * `fills` — so a reveal gradient resolves through one paint pipeline, not a
 * second one.
 *
 * Rendered by `SceneNode` as a sibling immediately BEFORE the dissolve-
 * filtered `<g filter>`, INSIDE that node's own `<g data-node-id>` (bottom
 * paint order, so it still composites underneath the filtered content above
 * it) — never inside the filtered group itself, whose final `feComposite`
 * would swallow it (same reasoning as `ScopedLookGraphRun`'s doc). Carries no
 * `transform` of its own: it inherits the SAME transform as its parent `<g
 * data-node-id>` for free by sitting inside it, unlike the pre-fix
 * architecture where it rendered as a sibling OUTSIDE that group and needed
 * its own duplicated `transform` attribute to land in the same place.
 *
 * Carries no `opacity` of its own either — opacity now lives ONLY on the
 * shared `<g data-node-id>` wrapper (see `SceneNode`'s `reveal` branch), so
 * the (underlay + filtered content) pair fades as ONE object instead of two
 * independently-translucent overlapping layers (the F1 opacity-bleed bug this
 * restructure fixes: fixed content underneath a `revealPaint` hole is no
 * longer double-composited against an independently-opaque underlay).
 *
 * Deliberately does NOT carry `SVG_RENDER_PART_ATTRIBUTE`/`SVG_RENDER_PARTS.paint`:
 * `features/motion/canvas/overlay.tsx`'s `findPaintTarget` resolves a node's
 * animatable paint element via a first-match
 * `querySelector([data-render-part="paint"])` inside the node's `<g
 * data-node-id>` — this underlay uses its own distinct `data-reveal-underlay`
 * marker instead so that first-match query still resolves past it to the REAL
 * filtered content group, and so a reveal underlay (authored-static
 * appearance, no keyframing/bindable, per this feature's v1 scope) is never
 * mistaken for a renderer-owned part playback should retarget on its own.
 * Being INSIDE the node's own wrapper (not a run-level sibling outside it)
 * means it needs no separate pose-mirroring hook at all: motion playback and
 * live-drag both already retarget the wrapper's own transform/opacity as one
 * unit, and this underlay now rides along with that for free — see
 * `SceneNode`'s doc for how the drag path specifically benefits (the pre-fix
 * architecture's `data-reveal-underlay-for` mirroring only ever covered Play,
 * never live-drag; this structural fix covers both with zero extra code).
 */
function RevealUnderlay({
	node,
	revealPaint,
	idSeed,
}: {
	readonly node: VectorNode;
	readonly revealPaint: RevealPaint;
	readonly idSeed: string;
}) {
	const resolved = resolvePaints([revealPaint], "none")[0];
	if (!resolved) return null;
	const paint = canvasPaint([resolved], "none", idSeed);
	if (paint.value === "none") return null;
	const baseProps: GeometryPaintProps = {
		fill: paint.value,
		fillOpacity: paint.opacity === 1 ? undefined : paint.opacity,
		stroke: "none",
		strokeWidth: 0,
		vectorEffect: "non-scaling-stroke",
	};
	return (
		<>
			{paint.def ? (
				<defs>
					<PaintDef def={paint.def} />
				</defs>
			) : null}
			<g data-reveal-underlay="true" pointerEvents="none">
				{renderVectorGeometry(node, baseProps)}
			</g>
		</>
	);
}

/**
 * Recursive SVG scene-node renderer for live canvas content. It owns geometry
 * paint/effect defs and the per-node live-transform subscription.
 */
export const SceneNode = memo(function SceneNode({
	node: baseNode,
	decorative = false,
	scopedLookGraph,
	suppressScopedLookGraphOverlay = false,
	revealingFilter = null,
	assets,
	effectInfluenceRecipe,
	sourceOpticsPresentation,
}: {
	readonly node: VectorNode;
	readonly decorative?: boolean;
	readonly scopedLookGraph?: ScopedLookGraphCanvasContext;
	readonly suppressScopedLookGraphOverlay?: boolean;
	/**
	 * Set by `ScopedLookGraphRun` ONLY for the single node of a revealing
	 * object-Noise-Gradient dissolve run (see that component's doc). When
	 * present, this node's dissolve filter and `revealPaint` underlay render
	 * INSIDE this node's own `<g data-node-id>` instead of `ScopedLookGraphRun`
	 * wrapping this node's whole output from outside — see the `content`
	 * construction below for the resulting structure and why it is what makes
	 * opacity/blend-mode/motion-playback treat the (underlay + filtered
	 * content) pair as ONE object.
	 */
	revealingFilter?: {
		readonly filterId: string;
		readonly revealPaint: RevealPaint;
	} | null;
	readonly assets: SceneDocument["assets"];
	readonly effectInfluenceRecipe?: EffectInfluenceRecipe | null;
	readonly sourceOpticsPresentation?: SourceOpticsPresentation;
}) {
	// Per-node subscription to the transient live-drag override: while this
	// node is the one being moved/resized/rotated, the selector below returns a
	// fresh override object each pointermove and re-renders JUST this node.
	// Every uninvolved `SceneNode` in the tree keeps returning `undefined` (a
	// stable reference), so it never re-renders — the ancestor tree above this
	// component does not re-render at all mid-drag, since `useSceneStore`'s
	// document is not written until the gesture commits (see
	// `src/features/transform/canvas/handler.ts`). While an Alt/Option-drag
	// duplicate is in progress, this node's own override is suppressed if it is
	// one of the dragged SOURCE nodes: the original renders at its base
	// (pre-drag) position and the moving preview is a separate ghost pass (see
	// `DuplicateGhostLayer` below) — an uninvolved node's `.includes` check is
	// always `false`, so its `undefined` return stays just as stable as before.
	const override = useLiveTransformStore((state) =>
		state.duplicateIntent?.sourceIds.includes(baseNode.id)
			? undefined
			: state.overrides?.get(baseNode.id),
	);
	const node = override ?? baseNode;
	const rigOnly = node.motionController?.kind === "motion-controller";
	const hasCarrier = hasSubtreeCarrier(node);
	const effectFieldRouting = compileEffectFieldRoutesForNode(
		effectInfluenceRecipe,
		node.id,
		"editor-svg",
	);
	const spec =
		node.visible && !rigOnly
			? buildEffectFilter(
					node.id,
					resolveEffects(node.style.effects),
					effectFilterBoundsForNode(node),
					node.style.strokeWidth,
					resolveNodeRecipe(node),
					false,
					undefined,
					effectFieldRouting.routes,
					sourceOpticsPresentation?.nodePlans[node.id],
				)
			: null;
	// Surface un-renderable effects (e.g. background-blur) once per node rather
	// than on every frame scrub: `SceneNode` re-renders with a fresh node object
	// (and a fresh `spec`) each frame, so warning in the render body would spam.
	// Depending on the joined reason STRING (a primitive, compared by value)
	// fires the warning once per node per distinct deferred-state, never per frame.
	const deferredReasons =
		spec?.deferred.map((effect) => effect.reason).join("; ") ?? "";
	const routingIssueReasons = effectFieldRouting.issues
		.map((issue) => issue.detail)
		.join("; ");
	useEffect(() => {
		const reasons = [deferredReasons, routingIssueReasons]
			.filter(Boolean)
			.join("; ");
		if (!reasons || !import.meta.env.DEV) return;
		console.warn(
			`Node ${node.id} has effects that cannot render as SVG: ${reasons}`,
		);
	}, [node.id, deferredReasons, routingIssueReasons]);

	if (!node.visible) return null;
	const matrix = matrixFromTransform(node.transform);
	const filterSpec = spec && spec.primitives.length > 0 ? spec : null;
	// Blend mode lives on the wrapping group (not the painted element) so the
	// node's composited result — including any effect filter on the child shape —
	// blends against the backdrop. Group nodes carry members in `children`;
	// nesting them here composes the group transform the same way export does.
	const blendMode = blendModePresentation(resolveNodeStyle(node.style));
	const childrenNodes = node.children
		? renderScopedSceneNodeList(
				node.children,
				decorative,
				scopedLookGraph,
				suppressScopedLookGraphOverlay,
				assets,
				effectInfluenceRecipe,
				sourceOpticsPresentation,
			)
		: null;
	// `revealingFilter` is only ever set by `ScopedLookGraphRun` for the single
	// node of a revealing object-NG dissolve, and that overlay source never
	// targets a `hasSubtreeCarrier` node (see `scopedLookGraphRunRevealUnderlays`'s
	// former `!hasSubtreeCarrier` gate, now folded into this same condition) —
	// `!hasCarrier` here is a defensive guard, not a live branch today.
	const reveal = !hasCarrier ? revealingFilter : null;
	// A children-bearing node's opacity/effect filter would be visually dead if
	// left only on its own paint element (the bug this carrier fixes): a
	// group/Blend's own geometry is a fixed invisible placeholder (see
	// `isWrapperContainer`), and even a frame's real background paint is only
	// ONE layer among siblings, not an ancestor of its children. The subtree
	// carrier is an UNTRANSFORMED inner `<g>` (it sits inside this node's own
	// transformed `<g>`, so a second transform would double it) wrapping the
	// node's own shape AND its children, so both opacity and the filter (whose
	// region is geometry-local/composite-local, see `EffectFilterDefs`'s doc and
	// `effectFilterBoundsForNode`) composite over the whole subtree as one unit.
	// It is ALWAYS emitted for a `hasSubtreeCarrier` node — even at opacity 1
	// with no effects — so motion playback (which retargets this same render
	// part, see `features/motion/canvas/overlay.tsx`) finds a stable DOM shape
	// whether or not the node is currently animating.
	//
	// A Noise Gradient dissolve's `revealPaint` underlay (see
	// `revealPaintForNode`'s doc) renders HERE, inside this node's own `<g
	// data-node-id>`, as a sibling immediately before the scoped-look-filtered
	// content group — never inside that filtered group itself (its final
	// `feComposite` would swallow the underlay, same reasoning as
	// `ScopedLookGraphRun`'s doc). Being INSIDE the node's own wrapper (rather
	// than a run-level sibling OUTSIDE it, the pre-fix architecture) means the
	// SAME wrapper that carries this node's opacity/blend-mode and that
	// `features/motion/canvas/overlay.tsx`/live-drag both already retarget as
	// ONE unit now covers the underlay too — no separate pose-mirroring
	// mechanism needed for either Play or drag.
	const content = hasCarrier ? (
		<g
			{...{ [SVG_RENDER_PART_ATTRIBUTE]: SVG_RENDER_PARTS.subtree }}
			opacity={node.style.opacity}
			filter={filterSpec ? `url(#${filterSpec.id})` : undefined}
		>
			{rigOnly ? null : (
				<VectorShape node={node} paintOpacity={1} assets={assets} />
			)}
			{childrenNodes}
		</g>
	) : reveal && !rigOnly ? (
		<>
			<RevealUnderlay
				node={node}
				revealPaint={reveal.revealPaint}
				idSeed={`${node.id}-reveal`}
			/>
			<g filter={`url(#${reveal.filterId})`}>
				<VectorShape
					node={node}
					filterId={filterSpec?.id}
					paintOpacity={1}
					assets={assets}
				/>
			</g>
			{childrenNodes}
		</>
	) : (
		<>
			{rigOnly ? null : (
				<VectorShape node={node} filterId={filterSpec?.id} assets={assets} />
			)}
			{childrenNodes}
		</>
	);
	return (
		<g
			{...(decorative
				? { "data-frame-look-node-id": node.id }
				: { "data-node-id": node.id })}
			{...(reveal ? { [SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE]: "true" } : {})}
			pointerEvents={
				decorative || node.locked || rigOnly ? "none" : "visiblePainted"
			}
			transform={matrixToSvg(matrix)}
			opacity={reveal ? node.style.opacity : undefined}
			style={blendMode ? { mixBlendMode: blendMode } : undefined}
		>
			{filterSpec ? <EffectFilterDefs spec={filterSpec} /> : null}
			{content}
		</g>
	);
});

/**
 * Alt/Option-drag-to-duplicate ghost pass: while `duplicateIntent` targets
 * THIS artboard, renders the dragged source nodes' live-override geometry
 * (full fills/strokes/effects/opacity/children, via `SceneNode`) on top of the
 * ordinary artwork — the moving preview the cursor drags around, while the
 * suppressed originals (see `SceneNode`'s override selector above) stay put at
 * their base position. `decorative` keeps it non-interactive and out of the
 * `data-node-id` export marker space.
 *
 * Two RAW-field selectors, not one derived selector: `useSyncExternalStore`
 * (which Zustand's hook is built on) requires a selector to return the SAME
 * reference when called twice against the same state, or React treats the
 * snapshot as perpetually "changed" and throws (infinite-loop guard). A
 * selector that builds the filtered ghost array inline (`.map().filter()`)
 * fabricates a new array on every call — even with no relevant state change —
 * so it can never satisfy that contract. Reading `duplicateIntent` and
 * `overrides` as plain field selectors is trivially stable (a direct property
 * read never allocates), and the derived array is built exactly once per
 * actual reference change via the `useMemo` below, which is the correct place
 * to fabricate a new array from unstable inputs.
 */
export function DuplicateGhostLayer({
	artboardId,
	assets,
	effectInfluenceRecipe,
}: {
	readonly artboardId: string;
	readonly assets: SceneDocument["assets"];
	readonly effectInfluenceRecipe?: EffectInfluenceRecipe | null;
}) {
	const duplicateIntent = useLiveTransformStore(
		(state) => state.duplicateIntent,
	);
	const overrides = useLiveTransformStore((state) => state.overrides);
	const ghosts = useMemo(() => {
		if (!duplicateIntent || duplicateIntent.artboardId !== artboardId) {
			return null;
		}
		return duplicateIntent.sourceIds
			.map((nodeId) => overrides?.get(nodeId))
			.filter((node): node is VectorNode => node !== undefined);
	}, [duplicateIntent, artboardId, overrides]);
	if (!ghosts || ghosts.length === 0) return null;
	return (
		<g pointerEvents="none">
			{ghosts.map((node) => (
				<SceneNode
					key={`${node.id}-duplicate-ghost`}
					node={node}
					decorative
					assets={assets}
					effectInfluenceRecipe={effectInfluenceRecipe}
				/>
			))}
		</g>
	);
}
