import {
	composeMatrix,
	getNodeLocalBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findNode,
	findRenderableNodeEntry,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	type AnchorKind,
	anchorHandles,
	anchorKind,
	applyMatrix,
	isVisiblePathHandle,
	type Vec,
} from "../model/geometry";

// Structural mirror of the canvas registry OverlayProps; features cannot import
// the widget-layer registry types. The host passes a compatible superset.
type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		// Mirrors the host's wider sub-selection union; this overlay reads only the
		// path variants (each access is guarded by `kind === "anchor"|"handle-*"`),
		// and carries the foreign gradient-stop variant so the host stays assignable.
		readonly sub:
			| {
					readonly nodeId: string;
					readonly kind: "anchor" | "handle-in" | "handle-out";
					readonly index: number;
					readonly indices?: readonly number[];
			  }
			| { readonly nodeId?: string; readonly kind: string }
			| null;
	};
	readonly viewport: {
		readonly zoom: number;
	};
};

type PathOverlaySub = {
	readonly nodeId: string;
	readonly kind: "anchor" | "handle-in" | "handle-out";
	readonly index: number;
	readonly indices?: readonly number[];
};

const PERCENT = 100;
const ANCHOR_PX = 11;
const HANDLE_PX = 8;
const ANCHOR_STROKE_WIDTH = 2;
const HANDLE_STROKE_WIDTH = 1.5;
const LINE_STROKE_WIDTH = 1;
const HANDLE_LINE = "#8df1e8";
const HANDLE_STROKE = "#191817";
const HANDLE_FILL = "#f7f4eb";
const ANCHOR_STROKE = "#191817";
const ANCHOR_FILL = "#f7f4eb";
const ACTIVE_FILL = "#2ec4b6";
const OUTLINE_STROKE = "#2ec4b6";
const OUTLINE_STROKE_WIDTH = 1.5;
const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const screenScale = (zoom: number): number =>
	Number.isFinite(zoom) && zoom > 0 ? zoom / PERCENT : 1;

function ControlHandle({
	anchor,
	handle,
	radius,
	active,
}: {
	readonly anchor: Vec;
	readonly handle: Vec;
	readonly radius: number;
	readonly active: boolean;
}) {
	if (handle.x === anchor.x && handle.y === anchor.y) return null;
	return (
		<g>
			<line
				x1={anchor.x}
				y1={anchor.y}
				x2={handle.x}
				y2={handle.y}
				stroke={HANDLE_LINE}
				strokeWidth={LINE_STROKE_WIDTH}
				vectorEffect="non-scaling-stroke"
			/>
			<circle
				cx={handle.x}
				cy={handle.y}
				r={radius}
				fill={active ? ACTIVE_FILL : HANDLE_FILL}
				stroke={HANDLE_STROKE}
				strokeWidth={HANDLE_STROKE_WIDTH}
				vectorEffect="non-scaling-stroke"
			/>
		</g>
	);
}

function AnchorMarker({
	anchor,
	kind,
	radius,
	active,
}: {
	readonly anchor: Vec;
	readonly kind: AnchorKind;
	readonly radius: number;
	readonly active: boolean;
}) {
	const fill = active ? ACTIVE_FILL : ANCHOR_FILL;
	if (kind === "smooth") {
		return (
			<circle
				cx={anchor.x}
				cy={anchor.y}
				r={radius}
				fill={fill}
				stroke={ANCHOR_STROKE}
				strokeWidth={ANCHOR_STROKE_WIDTH}
				vectorEffect="non-scaling-stroke"
			/>
		);
	}
	return (
		<rect
			x={anchor.x - radius}
			y={anchor.y - radius}
			width={radius * 2}
			height={radius * 2}
			fill={fill}
			stroke={ANCHOR_STROKE}
			strokeWidth={ANCHOR_STROKE_WIDTH}
			vectorEffect="non-scaling-stroke"
		/>
	);
}

const isPathSubSelection = (
	sub: OverlayProps["selection"]["sub"],
): sub is PathOverlaySub => {
	if (!sub) return false;
	if (
		sub.kind !== "anchor" &&
		sub.kind !== "handle-in" &&
		sub.kind !== "handle-out"
	) {
		return false;
	}
	return (
		typeof sub.nodeId === "string" &&
		"index" in sub &&
		Number.isInteger(sub.index) &&
		(!("indices" in sub) ||
			sub.indices === undefined ||
			(Array.isArray(sub.indices) && sub.indices.every(Number.isInteger)))
	);
};

const activeAnchorIndexSet = (
	active: PathOverlaySub | null,
): ReadonlySet<number> =>
	new Set(
		active
			? (active.indices ?? [active.index]).filter((index) =>
					Number.isInteger(index),
				)
			: [],
	);

const parentMatrixForNode = (
	document: SceneDocument,
	nodeId: string,
): Matrix2D => {
	const entry = findRenderableNodeEntry(document, nodeId);
	if (!entry || entry.parentIds.length === 0) return IDENTITY_MATRIX;
	return entry.parentIds.reduce((matrix, parentId) => {
		const parent = findNode(document, parentId);
		return parent
			? composeMatrix(matrix, matrixFromTransform(parent.transform))
			: matrix;
	}, IDENTITY_MATRIX);
};

const worldMatrixForNode = (
	document: SceneDocument,
	node: VectorNode,
): Matrix2D =>
	composeMatrix(
		parentMatrixForNode(document, node.id),
		matrixFromTransform(node.transform),
	);

function SelectionOutline({
	document,
	node,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
}) {
	const bounds = getNodeLocalBounds(node);
	const matrix = worldMatrixForNode(document, node);
	const corners = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		{ x: bounds.x, y: bounds.y + bounds.height },
	].map((point) => applyMatrix(matrix, point));
	return (
		<polygon
			points={corners.map((point) => `${point.x},${point.y}`).join(" ")}
			fill="none"
			stroke={OUTLINE_STROKE}
			strokeWidth={OUTLINE_STROKE_WIDTH}
			vectorEffect="non-scaling-stroke"
		/>
	);
}

/**
 * Direct-select chrome for the primary path node. It draws anchors (corner vs
 * smooth), control handles, and the active sub-selection. It is presentation
 * only; the canvas handler owns interaction because the host SVG captures the
 * pointer.
 */
function BezierOverlay({ document, selection, viewport }: OverlayProps) {
	const selectedNodes = selection.nodeIds
		.map((nodeId) => findNode(document, nodeId))
		.filter((node): node is VectorNode => Boolean(node));
	const node = findNode(document, selection.primary);
	const shape = node?.geometry.kind === "path" ? node.geometry.shape : null;
	const matrix = node ? worldMatrixForNode(document, node) : IDENTITY_MATRIX;
	const scale = screenScale(viewport.zoom);
	const anchorRadius = ANCHOR_PX / scale / 2;
	const handleRadius = HANDLE_PX / scale / 2;
	const active =
		node &&
		isPathSubSelection(selection.sub) &&
		selection.sub.nodeId === node.id
			? selection.sub
			: null;
	const activeAnchors = activeAnchorIndexSet(
		active?.kind === "anchor" ? active : null,
	);
	const pathAnchorChrome = shape
		? shape.vertices.map((_vertex, index) => {
				const handles = anchorHandles(shape, index);
				const anchor = applyMatrix(matrix, handles.anchor);
				const inHandle = applyMatrix(matrix, handles.inHandle);
				const outHandle = applyMatrix(matrix, handles.outHandle);
				return (
					// Anchor identity is positional; markers are stateless SVG, so the
					// index is the stable key (coordinates move every drag frame).
					// biome-ignore lint/suspicious/noArrayIndexKey: positional identity
					<g key={`anchor-${index}`}>
						{isVisiblePathHandle(shape, index, "handle-in") ? (
							<ControlHandle
								anchor={anchor}
								handle={inHandle}
								radius={handleRadius}
								active={active?.kind === "handle-in" && active.index === index}
							/>
						) : null}
						{isVisiblePathHandle(shape, index, "handle-out") ? (
							<ControlHandle
								anchor={anchor}
								handle={outHandle}
								radius={handleRadius}
								active={active?.kind === "handle-out" && active.index === index}
							/>
						) : null}
						<AnchorMarker
							anchor={anchor}
							kind={anchorKind(shape, index)}
							radius={anchorRadius}
							active={activeAnchors.has(index)}
						/>
					</g>
				);
			})
		: null;

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{selectedNodes.map((selectedNode) => (
				<SelectionOutline
					key={`outline-${selectedNode.id}`}
					document={document}
					node={selectedNode}
				/>
			))}
			{pathAnchorChrome}
		</svg>
	);
}

export const overlay = {
	id: "bezier-direct-select",
	tool: "direct-select" as const,
	Component: BezierOverlay,
};
