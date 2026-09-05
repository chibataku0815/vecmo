import {
	composeMatrix,
	IDENTITY_MATRIX,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { allNodes, findNode } from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: { readonly nodeIds: readonly string[] };
	readonly viewport: { readonly zoom: number };
};

const PERCENT = 100;
const CONTROLLER_STROKE = "#2ec4b6";
const CONTROLLER_SHADOW = "#191817";
const CONTROLLER_FILL = "#f7f4eb";

const nodeWorldOrigins = (
	document: SceneDocument,
): ReadonlyMap<string, Vec2> => {
	const origins = new Map<string, Vec2>();
	const visit = (node: VectorNode, parent: Matrix2D): void => {
		const world = composeMatrix(parent, matrixFromTransform(node.transform));
		origins.set(node.id, { x: world.e, y: world.f });
		for (const child of node.children ?? []) visit(child, world);
	};
	for (const layer of document.layers) {
		for (const node of layer.nodes) visit(node, IDENTITY_MATRIX);
	}
	return origins;
};

function MotionParentingOverlay({
	document,
	selection,
	viewport,
}: OverlayProps) {
	const selectedIds = new Set(selection.nodeIds);
	const all = allNodes(document);
	const relevantControllerIds = new Set<string>();
	for (const nodeId of selectedIds) {
		const node = findNode(document, nodeId);
		if (node?.motionController) relevantControllerIds.add(node.id);
		if (node?.motionParent)
			relevantControllerIds.add(node.motionParent.parentNodeId);
	}
	if (relevantControllerIds.size === 0) return null;
	const origins = nodeWorldOrigins(document);
	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const radius = 7 / scale;
	const cross = 11 / scale;
	const strokeWidth = 1.25 / scale;
	const lines = all.flatMap((node) => {
		const parentId = node.motionParent?.parentNodeId;
		if (!parentId || !relevantControllerIds.has(parentId)) return [];
		if (!selectedIds.has(parentId) && !selectedIds.has(node.id)) return [];
		const parent = origins.get(parentId);
		const child = origins.get(node.id);
		return parent && child ? [{ nodeId: node.id, parent, child }] : [];
	});

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{lines.map((line) => (
				<g key={line.nodeId}>
					<line
						x1={line.parent.x}
						y1={line.parent.y}
						x2={line.child.x}
						y2={line.child.y}
						stroke={CONTROLLER_SHADOW}
						strokeDasharray={`${4 / scale} ${3 / scale}`}
						strokeWidth={strokeWidth * 2.2}
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={line.parent.x}
						y1={line.parent.y}
						x2={line.child.x}
						y2={line.child.y}
						stroke={CONTROLLER_STROKE}
						strokeDasharray={`${4 / scale} ${3 / scale}`}
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
					/>
				</g>
			))}
			{[...relevantControllerIds].map((controllerId) => {
				const point = origins.get(controllerId);
				if (!point) return null;
				return (
					<g key={controllerId}>
						<circle
							cx={point.x}
							cy={point.y}
							r={radius}
							fill={CONTROLLER_FILL}
							stroke={CONTROLLER_SHADOW}
							strokeWidth={strokeWidth * 2.2}
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={point.x}
							cy={point.y}
							r={radius}
							fill="none"
							stroke={CONTROLLER_STROKE}
							strokeWidth={strokeWidth}
							vectorEffect="non-scaling-stroke"
						/>
						<path
							d={`M ${point.x - cross} ${point.y} L ${point.x + cross} ${point.y} M ${point.x} ${point.y - cross} L ${point.x} ${point.y + cross}`}
							fill="none"
							stroke={CONTROLLER_STROKE}
							strokeLinecap="round"
							strokeWidth={strokeWidth}
							vectorEffect="non-scaling-stroke"
						/>
					</g>
				);
			})}
		</svg>
	);
}

export const overlay = {
	id: "motion-parenting",
	paintOrder: 13,
	Component: MotionParentingOverlay,
};
