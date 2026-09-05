import {
	type AppearanceListRole,
	readAppearanceStack,
} from "@/entities/scene/model/appearance-stack";
import {
	createAddAppearanceItemCommand,
	createRemoveAppearanceItemCommand,
	createReorderAppearanceItemCommand,
	createToggleAppearanceItemVisibilityCommand,
	createUpdateAppearanceItemCommand,
} from "@/entities/scene/model/appearance-stack-commands";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	buildDefaultMeshForNode,
	MESH_FILLABLE_KINDS,
} from "@/entities/scene/model/mesh-edit";
import { createUpdateNodeStyleCommand } from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Paint, VectorNode } from "@/entities/scene/model/types";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";

/**
 * Inspector adapter for the node appearance stack. The panel reads
 * {@link appearanceStackView} for compact, render-ready fill/stroke rows and calls
 * the commit helpers, which run the undoable entity commands through the single
 * scene command bus — no raw store mutation, one action one undo. Rich gradient/
 * image/mesh editing stays in the existing primary-paint controls; this surface owns
 * list management (add/remove/reorder/toggle) plus inline solid-color edits.
 */

const PAINT_PREVIEW_FALLBACK = "#888888";

const NEW_FILL: Paint = { kind: "solid", color: "#ffffff" };
const NEW_STROKE: Paint = { kind: "solid", color: "#000000" };

/** One fill or stroke entry prepared for a compact stack row. */
export type AppearanceStackRow = {
	readonly id: string;
	readonly role: "fill" | "stroke";
	readonly index: number;
	readonly kindLabel: string;
	readonly previewColor: string;
	/** Solid paints expose an inline color edit; other kinds are list-managed only. */
	readonly solidColor: string | null;
	readonly visible: boolean;
};

export type AppearanceStackView = {
	readonly fills: readonly AppearanceStackRow[];
	readonly strokes: readonly AppearanceStackRow[];
	/**
	 * Whether the node can have its primary fill converted to a gradient mesh — true
	 * for a mesh-fillable geometry whose leading fill is not already a mesh. Drives
	 * the Inspector "convert to mesh" affordance, the discoverable counterpart to the
	 * on-canvas mesh tool (which has no panel presence).
	 */
	readonly canConvertFillToMesh: boolean;
};

const paintKindLabel = (paint: Paint): string => {
	switch (paint.kind) {
		case "solid":
			return "Solid";
		case "linear-gradient":
			return "Linear";
		case "radial-gradient":
			return "Radial";
		case "image-reference":
			return "Image";
		case "mesh-gradient":
			return "Mesh";
	}
};

const paintPreviewColor = (paint: Paint): string => {
	switch (paint.kind) {
		case "solid":
			return paint.color;
		case "linear-gradient":
		case "radial-gradient":
			return paint.stops[0]?.color ?? PAINT_PREVIEW_FALLBACK;
		case "mesh-gradient":
			return paint.points[0]?.color ?? PAINT_PREVIEW_FALLBACK;
		case "image-reference":
			return PAINT_PREVIEW_FALLBACK;
	}
};

const rowFromItem = (
	role: "fill" | "stroke",
	item: {
		readonly id: string;
		readonly index: number;
		readonly paint: Paint;
		readonly visibility: "visible" | "hidden";
	},
): AppearanceStackRow => ({
	id: item.id,
	role,
	index: item.index,
	kindLabel: paintKindLabel(item.paint),
	previewColor: paintPreviewColor(item.paint),
	solidColor: item.paint.kind === "solid" ? item.paint.color : null,
	visible: item.visibility === "visible",
});

/**
 * Builds the compact fill/stroke row lists for one node. Rows are in persisted
 * order (index 0 = leading paint, rendered on top), so the panel can present the
 * stack top-to-bottom exactly as it composites.
 */
export function appearanceStackView(node: VectorNode): AppearanceStackView {
	const stack = readAppearanceStack(node);
	return {
		fills: stack.fills.map((item) => rowFromItem("fill", item)),
		strokes: stack.strokes.map((item) => rowFromItem("stroke", item)),
		canConvertFillToMesh: canConvertFillToMesh(node),
	};
}

const canConvertFillToMesh = (node: VectorNode): boolean =>
	MESH_FILLABLE_KINDS.has(node.geometry.kind) &&
	node.style.fills?.[0]?.kind !== "mesh-gradient";

const applySceneCommand = (command: SceneCommand): boolean => {
	const before = useSceneStore.getState().document;
	useSceneStore.getState().apply(command);
	return useSceneStore.getState().document !== before;
};

/** Adds a default solid fill or stroke to the node's stack. */
export function commitAddAppearanceItem(
	nodeId: string,
	role: "fill" | "stroke",
): boolean {
	return applySceneCommand(
		createAddAppearanceItemCommand(
			nodeId,
			role,
			role === "fill" ? NEW_FILL : NEW_STROKE,
		),
	);
}

/**
 * Edits the color of a SOLID paint in place, preserving its visibility/opacity.
 * No-op when the addressed paint is missing or not solid (the row only exposes the
 * color input for solids).
 */
export function commitAppearanceItemColor(
	nodeId: string,
	role: "fill" | "stroke",
	index: number,
	color: string,
): boolean {
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return false;
	const source = role === "fill" ? node.style.fills : node.style.strokes;
	const current = source?.[index];
	if (current?.kind !== "solid") return false;
	return applySceneCommand(
		createUpdateAppearanceItemCommand(nodeId, role, index, {
			...current,
			color,
		}),
	);
}

/** Shows or hides one fill/stroke/effect item without removing it. */
export function commitToggleAppearanceItem(
	nodeId: string,
	role: AppearanceListRole,
	index: number,
	visible: boolean,
): boolean {
	return applySceneCommand(
		createToggleAppearanceItemVisibilityCommand(nodeId, role, index, visible),
	);
}

/** Moves one item up or down within its role's stack. */
export function commitReorderAppearanceItem(
	nodeId: string,
	role: AppearanceListRole,
	from: number,
	to: number,
): boolean {
	return applySceneCommand(
		createReorderAppearanceItemCommand(nodeId, role, from, to),
	);
}

/** Removes one item from its role's stack. */
export function commitRemoveAppearanceItem(
	nodeId: string,
	role: AppearanceListRole,
	index: number,
): boolean {
	return applySceneCommand(
		createRemoveAppearanceItemCommand(nodeId, role, index),
	);
}

/**
 * Converts the node's primary fill into a gradient mesh tonally seeded from its
 * current color (the same starting mesh the on-canvas mesh tool creates), in one
 * undoable step. This is the Inspector affordance for a tool that otherwise lives
 * only on the canvas. No-op when the node is missing, its geometry cannot carry a
 * mesh, or its leading fill is already a mesh.
 */
export function commitConvertFillToMesh(nodeId: string): boolean {
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return false;
	if (!MESH_FILLABLE_KINDS.has(node.geometry.kind)) return false;
	if (node.style.fills?.[0]?.kind === "mesh-gradient") return false;
	const tail = node.style.fills?.slice(1) ?? [];
	const applied = applySceneCommand(
		createUpdateNodeStyleCommand(
			nodeId,
			{
				fills: [buildDefaultMeshForNode(node), ...tail],
			},
			{ preservesPaintIndices: true },
		),
	);
	// Activate the mesh tool so the editing grid is immediately visible — the
	// Inspector entry point must land the user in the same editable state the
	// canvas tool does, not a gradient with no obvious way to edit its points.
	if (applied) useToolSelectionStore.getState().setActiveTool("mesh");
	return applied;
}
