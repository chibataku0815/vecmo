import {
	getNodeLocalBounds,
	matrixFromTransform,
	matrixToSvg,
} from "@/entities/scene/model/rendering";
import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import type { VectorNode } from "@/entities/scene/model/types";

/**
 * Selection chrome for a canvas-selected node: a dashed bounds outline plus 4
 * corner handles, drawn in the node's local space (`<g transform=matrix>`) so it
 * tracks the node's transform for free. Padding/handles are sized in screen
 * pixels (divided by `scale`) so they stay constant at every zoom; strokes are
 * non-scaling. `touchComfortable` widens the hit targets for iPad.
 */
export function SelectionOverlay({
	node,
	selected,
	scale,
	touchComfortable,
}: {
	readonly node: VectorNode;
	readonly selected: boolean;
	readonly scale: number;
	readonly touchComfortable: boolean;
}) {
	const bounds = getNodeLocalBounds(node);
	const matrix = matrixFromTransform(node.transform);
	const padding = (touchComfortable ? 14 : 10) / scale;
	const handleSize = (touchComfortable ? 18 : 14) / scale;
	const handleHalf = handleSize / 2;
	const handlePoints = [
		[bounds.x - padding, bounds.y - padding],
		[bounds.x + bounds.width + padding, bounds.y - padding],
		[bounds.x - padding, bounds.y + bounds.height + padding],
		[bounds.x + bounds.width + padding, bounds.y + bounds.height + padding],
	] as const;

	return (
		<g pointerEvents="none" transform={matrixToSvg(matrix)}>
			<rect
				x={bounds.x - padding}
				y={bounds.y - padding}
				width={bounds.width + padding * 2}
				height={bounds.height + padding * 2}
				fill="none"
				stroke={selected ? "#2ec4b6" : "#8df1e8"}
				strokeDasharray="10 8"
				strokeWidth="3"
				vectorEffect="non-scaling-stroke"
			/>
			{handlePoints.map(([x, y]) => (
				<rect
					key={`${node.id}-${x}-${y}`}
					x={x - handleHalf}
					y={y - handleHalf}
					width={handleSize}
					height={handleSize}
					fill="#f7f4eb"
					stroke="#191817"
					strokeWidth="2"
					vectorEffect="non-scaling-stroke"
				/>
			))}
		</g>
	);
}

const ARTBOARD_HANDLE_PX = 9;

/**
 * Selection chrome for a canvas-selected artboard: a teal bounds outline plus 8
 * resize handles. Rendered INSIDE the artboard's `<g transform=translate(pos)>`
 * so it tracks the frame during a move for free, in artboard-local coordinates.
 * Handles are sized in screen pixels (divided by `scale`) so they stay constant
 * at every zoom; the stroke is non-scaling. There is no rotation handle —
 * artboards are axis-aligned and carry no rotation.
 */
export function ArtboardSelectionChrome({
	artboard,
	scale,
	touchComfortable,
}: {
	readonly artboard: NormalizedArtboard;
	readonly scale: number;
	readonly touchComfortable: boolean;
}) {
	const { width, height } = artboard;
	const size = (touchComfortable ? 13 : ARTBOARD_HANDLE_PX) / scale;
	const half = size / 2;
	const handlePoints = [
		[0, 0],
		[width / 2, 0],
		[width, 0],
		[width, height / 2],
		[width, height],
		[width / 2, height],
		[0, height],
		[0, height / 2],
	] as const;

	return (
		<g pointerEvents="none">
			<rect
				width={width}
				height={height}
				fill="none"
				stroke="#2ec4b6"
				strokeWidth={2}
				vectorEffect="non-scaling-stroke"
			/>
			{handlePoints.map(([hx, hy]) => (
				<rect
					key={`artboard-handle-${hx}-${hy}`}
					x={hx - half}
					y={hy - half}
					width={size}
					height={size}
					fill="#f7f4eb"
					stroke="#191817"
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			))}
		</g>
	);
}
