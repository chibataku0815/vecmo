import type { ReactNode } from "react";
import { imagePlacementForNode } from "@/entities/scene/model/assets";
import {
	matrixFromTransform,
	matrixToSvg,
	svgTextAnchorForAlign,
	textAnchorXForAlign,
	textMetricsForGeometry,
} from "@/entities/scene/model/rendering";
import type {
	Bounds,
	NodeGeometry,
	TextGeometry,
	VectorNode,
} from "@/entities/scene/model/types";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import { cn } from "@/shared/lib/cn";

type AssetNodePreviewProps = {
	readonly node: VectorNode | undefined;
	readonly bounds: Bounds | undefined;
	readonly imageHrefByAssetId: ReadonlyMap<string, string>;
	readonly label: string;
	readonly className?: string;
};

const finitePositive = (value: number): boolean =>
	Number.isFinite(value) && value > 0;

const usableBounds = (bounds: Bounds | undefined): bounds is Bounds =>
	Boolean(
		bounds &&
			Number.isFinite(bounds.x) &&
			Number.isFinite(bounds.y) &&
			finitePositive(bounds.width) &&
			finitePositive(bounds.height),
	);

const paddedViewBox = (bounds: Bounds): string => {
	const longestSide = Math.max(bounds.width, bounds.height);
	const padding = Math.max(4, Math.min(24, longestSide * 0.08));
	return [
		bounds.x - padding,
		bounds.y - padding,
		bounds.width + padding * 2,
		bounds.height + padding * 2,
	].join(" ");
};

const starPoints = (
	geometry: Extract<NodeGeometry, { readonly kind: "star" }>,
): string => {
	const pointCount = Math.max(2, Math.floor(geometry.points)) * 2;
	return Array.from({ length: pointCount }, (_, index) => {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / pointCount) * Math.PI * 2;
		return [
			geometry.center.x + Math.cos(angle) * radius,
			geometry.center.y + Math.sin(angle) * radius,
		].join(",");
	}).join(" ");
};

const pathDataForGeometry = (
	geometry: Extract<NodeGeometry, { readonly kind: "path" }>,
): string =>
	[geometry.shape, ...(geometry.subpaths ?? [])]
		.map((shape) => aeShapeToSvgPath(shape))
		.join(" ");

const strokeDash = (node: VectorNode): string | undefined =>
	node.style.strokeDash && node.style.strokeDash.length > 0
		? node.style.strokeDash.join(" ")
		: undefined;

const sharedPaintProps = (node: VectorNode) =>
	({
		fill: node.style.fill,
		opacity: node.style.opacity,
		stroke: node.style.stroke,
		strokeWidth: node.style.strokeWidth,
		strokeDasharray: strokeDash(node),
		strokeDashoffset: node.style.strokeDashoffset,
		strokeLinecap: node.style.strokeCap,
		strokeLinejoin: node.style.strokeJoin,
		strokeMiterlimit: node.style.strokeMiterLimit,
		vectorEffect: "non-scaling-stroke",
	}) as const;

const renderTextGeometry = (
	node: VectorNode & { readonly geometry: TextGeometry },
): ReactNode => {
	const { bounds } = node.geometry;
	const metrics = textMetricsForGeometry(node.geometry);
	const anchorX = textAnchorXForAlign(bounds, metrics.style.align);
	return (
		<text
			{...sharedPaintProps(node)}
			x={anchorX}
			y={metrics.lineMetrics[0]?.baseline ?? bounds.y}
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
					key={`${node.id}:${lineMetric.index}:${lineMetric.text}`}
					x={anchorX}
					y={lineMetric.baseline}
				>
					{lineMetric.text}
				</tspan>
			))}
		</text>
	);
};

const renderImageGeometry = (
	node: VectorNode & {
		readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
	},
	imageHrefByAssetId: ReadonlyMap<string, string>,
): ReactNode => {
	const { bounds } = node.geometry;
	const href = imageHrefByAssetId.get(node.geometry.assetId);
	if (!href) {
		return (
			<rect
				x={bounds.x}
				y={bounds.y}
				width={bounds.width}
				height={bounds.height}
				fill="none"
				stroke="currentColor"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		);
	}
	const placement = imagePlacementForNode(node);
	if (placement?.crop) {
		const crop = placement.crop;
		return (
			<svg
				x={bounds.x}
				y={bounds.y}
				width={bounds.width}
				height={bounds.height}
				viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
				preserveAspectRatio="none"
				opacity={node.style.opacity}
			>
				<title>Image crop preview</title>
				<image
					href={href}
					x={0}
					y={0}
					width={crop.x + crop.width}
					height={crop.y + crop.height}
					preserveAspectRatio="none"
				/>
			</svg>
		);
	}
	return (
		<image
			href={href}
			x={bounds.x}
			y={bounds.y}
			width={bounds.width}
			height={bounds.height}
			preserveAspectRatio="none"
			opacity={node.style.opacity}
		/>
	);
};

const renderGeometry = (
	node: VectorNode,
	imageHrefByAssetId: ReadonlyMap<string, string>,
): ReactNode => {
	switch (node.geometry.kind) {
		case "rect":
			return (
				<rect
					{...sharedPaintProps(node)}
					x={node.geometry.bounds.x}
					y={node.geometry.bounds.y}
					width={node.geometry.bounds.width}
					height={node.geometry.bounds.height}
					rx={node.geometry.cornerRadius}
				/>
			);
		case "ellipse":
			return (
				<ellipse
					{...sharedPaintProps(node)}
					cx={node.geometry.bounds.x + node.geometry.bounds.width / 2}
					cy={node.geometry.bounds.y + node.geometry.bounds.height / 2}
					rx={node.geometry.bounds.width / 2}
					ry={node.geometry.bounds.height / 2}
				/>
			);
		case "line":
			return (
				<line
					{...sharedPaintProps(node)}
					x1={node.geometry.start.x}
					y1={node.geometry.start.y}
					x2={node.geometry.end.x}
					y2={node.geometry.end.y}
				/>
			);
		case "polygon":
			return (
				<polygon
					{...sharedPaintProps(node)}
					points={node.geometry.points
						.map((point) => `${point.x},${point.y}`)
						.join(" ")}
				/>
			);
		case "star":
			return (
				<polygon
					{...sharedPaintProps(node)}
					points={starPoints(node.geometry)}
				/>
			);
		case "path":
			return (
				<path
					{...sharedPaintProps(node)}
					d={pathDataForGeometry(node.geometry)}
					fillRule={node.geometry.fillRule}
				/>
			);
		case "text":
			return renderTextGeometry({
				...node,
				geometry: node.geometry,
			});
		case "image":
			return renderImageGeometry(
				{
					...node,
					geometry: node.geometry,
				},
				imageHrefByAssetId,
			);
	}
};

function PreviewNode({
	node,
	imageHrefByAssetId,
}: {
	readonly node: VectorNode;
	readonly imageHrefByAssetId: ReadonlyMap<string, string>;
}) {
	const transform = matrixToSvg(matrixFromTransform(node.transform));
	return (
		<g transform={transform}>
			{renderGeometry(node, imageHrefByAssetId)}
			{node.children?.map((child) => (
				<PreviewNode
					key={child.id}
					node={child}
					imageHrefByAssetId={imageHrefByAssetId}
				/>
			))}
		</g>
	);
}

export function AssetNodePreview({
	node,
	bounds,
	imageHrefByAssetId,
	label,
	className,
}: AssetNodePreviewProps) {
	if (!node || !usableBounds(bounds)) {
		return (
			<div
				className={cn(
					"grid size-full place-items-center text-fg-subtle text-ui",
					className,
				)}
			>
				Missing
			</div>
		);
	}
	return (
		<svg
			role="img"
			aria-label={label}
			className={cn("size-full text-fg-subtle", className)}
			viewBox={paddedViewBox(bounds)}
			preserveAspectRatio="xMidYMid meet"
		>
			<title>{label}</title>
			<PreviewNode node={node} imageHrefByAssetId={imageHrefByAssetId} />
		</svg>
	);
}
