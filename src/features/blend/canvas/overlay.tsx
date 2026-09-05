import { type ComponentType, useEffect } from "react";
import {
	blendSourceAttachmentLocalPoints,
	blendSourceStopParentPoint,
	blendStepSpineTValues,
	effectiveBlendSpineForSources,
	isClosedBlendSpine,
	moveNodeBlendSourceStopToPoint,
	normalizeBlendSpacing,
	resolveBlendSourceStops,
	sampleBlendSpine,
} from "@/entities/scene/model/blend";
import {
	applyMatrixToPoint,
	isIdentityMatrix,
	matrixFromTransform,
	matrixToSvg,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import type {
	BlendSourceStop,
	BlendSpacing,
	BlendSpine,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AeShape } from "@/shared/glammer/ae-shape";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import {
	type BlendSpineSubSelection,
	type BlendSpineTarget,
	useBlendToolStore,
} from "../model/tool-state";

type LocalToolId = "blend";

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly viewport: { readonly zoom: number };
};

type OverlayDescriptor = {
	readonly id: string;
	readonly tool?: LocalToolId;
	readonly Component: ComponentType<OverlayProps>;
};

const PERCENT = 100;
const ACCENT = "#2ec4b6";
const ACTIVE = "#f5c542";
const HANDLE_FILL = "#f7f4eb";
const HANDLE_STROKE = "#191817";

const pointDistance = (from: Vec2, to: Vec2): number =>
	Math.hypot(to.x - from.x, to.y - from.y);

const lineSpine = (from: Vec2, to: Vec2): BlendSpine => ({
	kind: "line",
	start: from,
	end: to,
});

const selectedBlendEndpoints = (
	document: SceneDocument,
	selection: OverlayProps["selection"],
): {
	readonly blendNodeId: string;
	readonly sources: readonly VectorNode[];
	readonly sourceStops: readonly BlendSourceStop[] | undefined;
	readonly spacing: BlendSpacing;
	readonly spine: BlendSpine;
	readonly stageTransform: string | null;
} | null => {
	const primaryNode = findNode(document, selection.primary);
	const node = primaryNode?.blend
		? primaryNode
		: (selection.nodeIds
				.map((nodeId) => findNode(document, nodeId))
				.find((candidate) => candidate?.blend) ?? null);
	if (!node?.blend || !node.children) return null;
	const sources = node.blend.sourceNodeIds
		.map((nodeId) => node.children?.find((child) => child.id === nodeId))
		.filter((child): child is VectorNode => Boolean(child));
	const containerMatrix = matrixFromTransform(node.transform);
	return sources.length === node.blend.sourceNodeIds.length &&
		sources.length >= 2
		? {
				blendNodeId: node.id,
				sources,
				sourceStops: node.blend.sourceStops,
				spacing: node.blend.spacing,
				spine: effectiveBlendSpineForSources(
					sources,
					node.blend.spine,
					node.blend.sourceStops,
				),
				// Spine and source-child coordinates live in the container's local
				// space; a moved/rotated container renders its controls through this
				// transform so overlay geometry matches the artwork.
				stageTransform: isIdentityMatrix(containerMatrix)
					? null
					: matrixToSvg(containerMatrix),
			}
		: null;
};

const pointVisible = (point: readonly number[]): boolean =>
	Math.hypot(point[0] ?? 0, point[1] ?? 0) > 0;

const isVisiblePathHandle = (
	shape: AeShape,
	index: number,
	kind: "in" | "out",
): boolean => {
	if (shape.closed) return true;
	const lastIndex = shape.vertices.length - 1;
	return kind === "in" ? index > 0 : index < lastIndex;
};

const tangentPoint = (
	vertex: readonly number[],
	tangent: readonly number[],
): Vec2 => ({
	x: (vertex[0] ?? 0) + (tangent[0] ?? 0),
	y: (vertex[1] ?? 0) + (tangent[1] ?? 0),
});

const cubicPoint = (
	p0: Vec2,
	p1: Vec2,
	p2: Vec2,
	p3: Vec2,
	t: number,
): Vec2 => {
	const mt = 1 - t;
	const a = mt * mt * mt;
	const b = 3 * mt * mt * t;
	const c = 3 * mt * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
};

const pathPoint = (point: readonly number[] | undefined): Vec2 => ({
	x: point?.[0] ?? 0,
	y: point?.[1] ?? 0,
});

const segmentPolyline = (shape: AeShape, segment: number): readonly Vec2[] => {
	const segmentCount = shape.closed
		? shape.vertices.length
		: shape.vertices.length - 1;
	if (
		shape.vertices.length === 0 ||
		segment < 0 ||
		segment >= segmentCount ||
		shape.vertices.length !== shape.inTangents.length ||
		shape.vertices.length !== shape.outTangents.length
	) {
		return [];
	}
	const next = shape.closed
		? (segment + 1) % shape.vertices.length
		: segment + 1;
	const p0 = pathPoint(shape.vertices[segment]);
	const p3 = pathPoint(shape.vertices[next]);
	const out = pathPoint(shape.outTangents[segment]);
	const incoming = pathPoint(shape.inTangents[next]);
	const p1 = { x: p0.x + out.x, y: p0.y + out.y };
	const p2 = { x: p3.x + incoming.x, y: p3.y + incoming.y };
	return Array.from({ length: 25 }, (_, index) =>
		cubicPoint(p0, p1, p2, p3, index / 24),
	);
};

const sameSpineTarget = (
	selection: BlendSpineSubSelection | null,
	blendNodeId: string | null,
	target: BlendSpineTarget,
): boolean =>
	Boolean(
		selection &&
			blendNodeId &&
			selection.blendNodeId === blendNodeId &&
			selection.kind === target.kind &&
			("t" in selection || "t" in target
				? "t" in selection &&
					"t" in target &&
					Math.abs(selection.t - target.t) <= 1e-6
				: true) &&
			("index" in selection ? selection.index : -1) ===
				("index" in target ? target.index : -1),
	);

const sameLineSegmentSelection = (
	selection: BlendSpineSubSelection | null,
	blendNodeId: string | null,
): boolean =>
	Boolean(
		selection &&
			blendNodeId &&
			selection.blendNodeId === blendNodeId &&
			selection.kind === "line-segment",
	);

function BlendOverlay({ document, selection, viewport }: OverlayProps) {
	const sourceStops = useBlendToolStore((state) => state.sourceStops);
	const hoverStop = useBlendToolStore((state) => state.hoverStop);
	const cursor = useBlendToolStore((state) => state.cursor);
	const spacing = useBlendToolStore((state) => state.spacing);
	const selectedSpine = useBlendToolStore((state) => state.selectedSpine);
	const hoverSpine = useBlendToolStore((state) => state.hoverSpine);

	useEffect(() => () => useBlendToolStore.getState().resetGesture(), []);

	const pendingEntries = sourceStops.flatMap((stop) => {
		const node = findNode(document, stop.nodeId);
		return node ? [{ stop, node }] : [];
	});
	const hoverNode = hoverStop ? findNode(document, hoverStop.nodeId) : null;
	const selected = selectedBlendEndpoints(document, selection);
	const lastPending = pendingEntries[pendingEntries.length - 1] ?? null;
	const lastAttachment = lastPending
		? blendSourceStopParentPoint(lastPending.node, lastPending.stop)
		: null;
	const previewTarget =
		hoverNode && hoverStop
			? blendSourceStopParentPoint(hoverNode, hoverStop)
			: cursor;
	const targetEntry =
		hoverNode && hoverStop
			? { node: hoverNode, stop: hoverStop }
			: lastPending && previewTarget
				? {
						node: moveNodeBlendSourceStopToPoint(
							lastPending.node,
							lastPending.stop,
							previewTarget,
						),
						stop: lastPending.stop,
					}
				: null;
	const previewEntries =
		pendingEntries.length > 0 && targetEntry
			? [...pendingEntries, targetEntry]
			: [];

	const line =
		previewEntries.length >= 2
			? {
					blendNodeId: null,
					sources: previewEntries.map((entry) => entry.node),
					sourceStops: previewEntries.map((entry) => entry.stop),
					spine:
						previewEntries.length === 2 && lastAttachment && previewTarget
							? lineSpine(lastAttachment, previewTarget)
							: effectiveBlendSpineForSources(
									previewEntries.map((entry) => entry.node),
									undefined,
									previewEntries.map((entry) => entry.stop),
								),
					spacing,
					stageTransform: null,
				}
			: selected
				? {
						blendNodeId: selected.blendNodeId,
						sources: selected.sources,
						sourceStops: selected.sourceStops,
						spine: selected.spine,
						spacing: selected.spacing,
						stageTransform: selected.stageTransform,
					}
				: null;

	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const px = (value: number): number => value / scale;
	const hoverAnchorPoints = hoverNode
		? (() => {
				const matrix = matrixFromTransform(hoverNode.transform);
				return blendSourceAttachmentLocalPoints(hoverNode).map((localPoint) =>
					applyMatrixToPoint(matrix, localPoint),
				);
			})()
		: [];
	const hoverAttachment =
		hoverNode && hoverStop
			? blendSourceStopParentPoint(hoverNode, hoverStop)
			: null;
	const pendingAttachments = pendingEntries.map((entry) =>
		blendSourceStopParentPoint(entry.node, entry.stop),
	);
	const sourceStopHints = (
		<g>
			{hoverAnchorPoints.map((point, index) => (
				<circle
					// biome-ignore lint/suspicious/noArrayIndexKey: stable-order anchor candidates, index is the identity (coordinates move and can coincide).
					key={`hover-anchor-${index}`}
					cx={point.x}
					cy={point.y}
					r={px(2.5)}
					fill={HANDLE_FILL}
					stroke={ACCENT}
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				/>
			))}
			{hoverAttachment ? (
				<circle
					cx={hoverAttachment.x}
					cy={hoverAttachment.y}
					r={px(4.5)}
					fill="none"
					stroke={ACTIVE}
					strokeWidth={2}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{pendingAttachments.map((point, index) => (
				<circle
					// biome-ignore lint/suspicious/noArrayIndexKey: ordered pending stops, index is the identity.
					key={`pending-stop-${index}`}
					cx={point.x}
					cy={point.y}
					r={px(4)}
					fill={ACTIVE}
					fillOpacity={0.9}
					stroke={HANDLE_STROKE}
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				/>
			))}
		</g>
	);
	const showsHints =
		hoverAnchorPoints.length > 0 || pendingAttachments.length > 0;
	if (!line) {
		return showsHints ? (
			<svg
				className="pointer-events-none absolute inset-0 h-full w-full"
				viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
				aria-hidden="true"
			>
				{sourceStopHints}
			</svg>
		) : null;
	}

	const orderedStopMarkers =
		selected &&
		line.blendNodeId === selected.blendNodeId &&
		selected.sources.length > 2
			? resolveBlendSourceStops(selected.sources, selected.sourceStops)
			: [];
	const closedSeamMarker = isClosedBlendSpine(line.spine)
		? (() => {
				const seam = sampleBlendSpine(line.spine, 0).point;
				const forward = sampleBlendSpine(line.spine, 0.035).point;
				const distance = pointDistance(seam, forward);
				if (distance <= 0) return null;
				const length = px(18);
				return {
					seam,
					tip: {
						x: seam.x + ((forward.x - seam.x) / distance) * length,
						y: seam.y + ((forward.y - seam.y) / distance) * length,
					},
				};
			})()
		: null;
	const from = sampleBlendSpine(line.spine, 0).point;
	const to = sampleBlendSpine(line.spine, 1).point;
	const startTarget: BlendSpineTarget =
		line.spine.kind === "path"
			? { kind: "path-anchor", index: 0 }
			: { kind: "line-start" };
	const endTarget: BlendSpineTarget =
		line.spine.kind === "path"
			? {
					kind: "path-anchor",
					index: Math.max(0, line.spine.shape.vertices.length - 1),
				}
			: { kind: "line-end" };
	const lineSegmentTarget: BlendSpineTarget | null =
		line.spine.kind === "line" ? { kind: "line-segment", t: 0.5 } : null;
	const tickPoints = blendStepSpineTValues(
		line.sources,
		normalizeBlendSpacing(line.spacing),
		line.spine,
		line.sourceStops,
	).map((tick) => sampleBlendSpine(line.spine, tick).point);
	const strokeForTarget = (target: BlendSpineTarget): string => {
		if (sameSpineTarget(selectedSpine, line.blendNodeId, target)) return ACTIVE;
		if (sameSpineTarget(hoverSpine, line.blendNodeId, target))
			return HANDLE_FILL;
		return ACCENT;
	};
	const radiusForTarget = (target: BlendSpineTarget, base: number): number =>
		px(
			sameSpineTarget(selectedSpine, line.blendNodeId, target)
				? base + 2
				: sameSpineTarget(hoverSpine, line.blendNodeId, target)
					? base + 1
					: base,
		);
	const lineSegmentWidth =
		lineSegmentTarget &&
		sameLineSegmentSelection(selectedSpine, line.blendNodeId)
			? 3
			: lineSegmentTarget &&
					sameLineSegmentSelection(hoverSpine, line.blendNodeId)
				? 2.25
				: 1.5;
	const lineSegmentStroke = sameLineSegmentSelection(
		selectedSpine,
		line.blendNodeId,
	)
		? ACTIVE
		: sameLineSegmentSelection(hoverSpine, line.blendNodeId)
			? HANDLE_FILL
			: ACCENT;
	const showEndpointHandles = !isClosedBlendSpine(line.spine);
	const activeSegment =
		line.spine.kind === "path" &&
		selectedSpine?.blendNodeId === line.blendNodeId &&
		selectedSpine.kind === "path-segment"
			? selectedSpine
			: line.spine.kind === "path" &&
					hoverSpine?.blendNodeId === line.blendNodeId &&
					hoverSpine.kind === "path-segment"
				? hoverSpine
				: null;
	const activeSegmentPoints =
		line.spine.kind === "path" && activeSegment
			? segmentPolyline(line.spine.shape, activeSegment.index)
			: [];
	const activeSegmentTarget = activeSegment
		? ({
				kind: "path-segment",
				index: activeSegment.index,
				t: activeSegment.t,
			} satisfies BlendSpineTarget)
		: null;
	const pathSpineHandles =
		line.spine.kind === "path"
			? (() => {
					const shape = line.spine.shape;
					return shape.vertices.flatMap((vertex, index) => {
						const inTangent = shape.inTangents[index];
						const outTangent = shape.outTangents[index];
						const anchorTarget = { kind: "path-anchor", index } as const;
						// Spine anchor identity is positional; markers are stateless SVG,
						// so the index is the stable key (coordinates move every drag
						// frame and can coincide).
						const handles = [
							<circle
								// biome-ignore lint/suspicious/noArrayIndexKey: positional identity
								key={`anchor-${index}`}
								cx={vertex[0]}
								cy={vertex[1]}
								r={radiusForTarget(anchorTarget, 5.5)}
								fill={HANDLE_FILL}
								stroke={strokeForTarget(anchorTarget)}
								strokeWidth={2}
								vectorEffect="non-scaling-stroke"
							/>,
						];
						if (
							inTangent &&
							isVisiblePathHandle(shape, index, "in") &&
							pointVisible(inTangent)
						) {
							const point = tangentPoint(vertex, inTangent);
							const target = { kind: "path-in", index } as const;
							handles.push(
								<line
									// biome-ignore lint/suspicious/noArrayIndexKey: positional identity
									key={`in-line-${index}`}
									x1={vertex[0]}
									y1={vertex[1]}
									x2={point.x}
									y2={point.y}
									stroke={strokeForTarget(target)}
									strokeOpacity={0.62}
									strokeWidth={1}
									vectorEffect="non-scaling-stroke"
								/>,
								<circle
									// biome-ignore lint/suspicious/noArrayIndexKey: positional identity
									key={`in-${index}`}
									cx={point.x}
									cy={point.y}
									r={radiusForTarget(target, 3.5)}
									fill={HANDLE_FILL}
									stroke={strokeForTarget(target)}
									strokeWidth={1.5}
									vectorEffect="non-scaling-stroke"
								/>,
							);
						}
						if (
							outTangent &&
							isVisiblePathHandle(shape, index, "out") &&
							pointVisible(outTangent)
						) {
							const point = tangentPoint(vertex, outTangent);
							const target = { kind: "path-out", index } as const;
							handles.push(
								<line
									// biome-ignore lint/suspicious/noArrayIndexKey: positional identity
									key={`out-line-${index}`}
									x1={vertex[0]}
									y1={vertex[1]}
									x2={point.x}
									y2={point.y}
									stroke={strokeForTarget(target)}
									strokeOpacity={0.62}
									strokeWidth={1}
									vectorEffect="non-scaling-stroke"
								/>,
								<circle
									// biome-ignore lint/suspicious/noArrayIndexKey: positional identity
									key={`out-${index}`}
									cx={point.x}
									cy={point.y}
									r={radiusForTarget(target, 3.5)}
									fill={HANDLE_FILL}
									stroke={strokeForTarget(target)}
									strokeWidth={1.5}
									vectorEffect="non-scaling-stroke"
								/>,
							);
						}
						return handles;
					});
				})()
			: null;

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			<g transform={line.stageTransform ?? undefined}>
				{line.spine.kind === "line" ? (
					<line
						x1={line.spine.start.x}
						y1={line.spine.start.y}
						x2={line.spine.end.x}
						y2={line.spine.end.y}
						stroke={lineSegmentStroke}
						strokeDasharray="6 7"
						strokeWidth={lineSegmentWidth}
						vectorEffect="non-scaling-stroke"
					/>
				) : (
					<path
						d={aeShapeToSvgPath(line.spine.shape)}
						fill="none"
						stroke={ACCENT}
						strokeDasharray="6 7"
						strokeWidth={1.5}
						vectorEffect="non-scaling-stroke"
					/>
				)}
				{tickPoints.map((point, index) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: stable-order spine samples, index is the identity.
						key={`tick-${index}`}
						cx={point.x}
						cy={point.y}
						r={px(3.5)}
						fill={ACCENT}
						fillOpacity={0.68}
					/>
				))}
				{activeSegmentTarget && activeSegmentPoints.length > 1 ? (
					<polyline
						points={activeSegmentPoints
							.map((point) => `${point.x},${point.y}`)
							.join(" ")}
						fill="none"
						stroke={strokeForTarget(activeSegmentTarget)}
						strokeWidth={3}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
				) : null}
				{closedSeamMarker ? (
					<>
						<line
							x1={closedSeamMarker.seam.x}
							y1={closedSeamMarker.seam.y}
							x2={closedSeamMarker.tip.x}
							y2={closedSeamMarker.tip.y}
							stroke={ACTIVE}
							strokeWidth={2.25}
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={closedSeamMarker.seam.x}
							cy={closedSeamMarker.seam.y}
							r={px(4.75)}
							fill={HANDLE_FILL}
							stroke={ACTIVE}
							strokeWidth={2}
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={closedSeamMarker.tip.x}
							cy={closedSeamMarker.tip.y}
							r={px(2.75)}
							fill={ACTIVE}
						/>
					</>
				) : null}
				{pathSpineHandles}
				{showEndpointHandles ? (
					<>
						<circle
							cx={from.x}
							cy={from.y}
							r={radiusForTarget(startTarget, 8)}
							fill={HANDLE_FILL}
							stroke={HANDLE_STROKE}
							strokeWidth={2}
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={from.x}
							cy={from.y}
							r={radiusForTarget(startTarget, 13)}
							fill="none"
							stroke={strokeForTarget(startTarget)}
							strokeWidth={2}
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={to.x}
							cy={to.y}
							r={radiusForTarget(endTarget, 6)}
							fill={hoverNode ? HANDLE_FILL : "none"}
							stroke={strokeForTarget(endTarget)}
							strokeWidth={2}
							vectorEffect="non-scaling-stroke"
						/>
					</>
				) : null}
				{orderedStopMarkers.map((stop, index) => (
					<g key={`stop-order-${stop.nodeId}`}>
						<circle
							cx={stop.parentPoint.x}
							cy={stop.parentPoint.y}
							r={px(6.5)}
							fill={HANDLE_FILL}
							fillOpacity={0.92}
							stroke={ACCENT}
							strokeWidth={1.5}
							vectorEffect="non-scaling-stroke"
						/>
						<text
							x={stop.parentPoint.x}
							y={stop.parentPoint.y}
							textAnchor="middle"
							dominantBaseline="central"
							fontSize={px(8.5)}
							fill={HANDLE_STROKE}
						>
							{index + 1}
						</text>
					</g>
				))}
			</g>
			{sourceStopHints}
		</svg>
	);
}

const blendOverlay: OverlayDescriptor = {
	id: "blend-overlay",
	tool: "blend",
	Component: BlendOverlay,
};

export default blendOverlay;
