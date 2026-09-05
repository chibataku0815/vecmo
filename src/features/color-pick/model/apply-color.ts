import {
	indexOfStop,
	isGradientPaint,
	setStopColor,
} from "@/entities/scene/model/gradient-edit";
import {
	createUpdateNodeStyleCommand,
	type NodeStylePatch,
} from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Paint, VectorNode } from "@/entities/scene/model/types";
import type { ColorPickCandidate, ColorPickPaintRole } from "./color-pick";

/**
 * Local mirror of the host's sub-selection union (features cannot import the
 * selection feature). Only the gradient-stop variant is acted on; the path
 * variants are carried so the host's wider selection stays assignable.
 */
export type ColorPickSubSelection =
	| {
			readonly nodeId: string;
			readonly kind: "gradient-stop";
			readonly role: "fills" | "strokes";
			readonly stopId: string;
	  }
	| {
			readonly nodeId: string;
			readonly kind: "anchor" | "handle-in" | "handle-out";
	  }
	| null;

export type ColorPickSelectionTarget = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
	readonly sub?: ColorPickSubSelection;
};

const STACK_ROLE: Record<ColorPickPaintRole, "fills" | "strokes"> = {
	fill: "fills",
	stroke: "strokes",
};

export type ColorPickApplyResult =
	| {
			readonly kind: "applied";
			readonly color: string;
			readonly role: ColorPickPaintRole;
			readonly nodeIds: readonly string[];
			readonly candidate: ColorPickCandidate;
	  }
	| {
			readonly kind: "empty";
			readonly reason: "no-selection" | "no-live-target" | "no-change";
			readonly color: string;
			readonly role: ColorPickPaintRole;
			readonly candidate: ColorPickCandidate;
	  };

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const targetNodeIds = (
	selection: ColorPickSelectionTarget,
): readonly string[] => {
	if (selection.nodeIds.length > 0) return uniqueNodeIds(selection.nodeIds);
	return selection.primary ? [selection.primary] : [];
};

const solidPaint = (color: string, opacity: number | undefined): Paint => ({
	kind: "solid",
	color,
	...(opacity === undefined ? {} : { opacity }),
});

const paintList = (
	node: VectorNode,
	role: ColorPickPaintRole,
): readonly Paint[] | undefined =>
	role === "fill" ? node.style.fills : node.style.strokes;

const legacyColor = (node: VectorNode, role: ColorPickPaintRole): string =>
	role === "fill" ? node.style.fill : node.style.stroke;

const paintRolePatch = (
	role: ColorPickPaintRole,
	paints: readonly Paint[],
): Pick<NodeStylePatch, "fills" | "strokes"> =>
	role === "fill" ? { fills: paints } : { strokes: paints };

const legacyColorPatch = (
	role: ColorPickPaintRole,
	color: string,
): Pick<NodeStylePatch, "fill" | "stroke"> =>
	role === "fill" ? { fill: color } : { stroke: color };

/**
 * Recolors the sub-selected gradient stop on this node/role, or `null` when the
 * sub-selection does not target an editable stop here. Keeps the gradient intact
 * instead of flattening it to a solid, and leaves the legacy color untouched (a
 * gradient has no single legacy color to sync).
 */
const gradientStopPatchForNode = (
	node: VectorNode,
	role: ColorPickPaintRole,
	color: string,
	sub: ColorPickSubSelection | undefined,
): NodeStylePatch | null => {
	if (
		sub?.kind !== "gradient-stop" ||
		sub.nodeId !== node.id ||
		sub.role !== STACK_ROLE[role]
	) {
		return null;
	}
	const paints = paintList(node, role);
	const paint = paints?.[0];
	if (!isGradientPaint(paint)) return null;
	const index = indexOfStop(paint, sub.stopId);
	if (index < 0) return null;
	return paintRolePatch(role, [
		setStopColor(paint, index, color),
		...(paints?.slice(1) ?? []),
	]);
};

const primaryPaintColorPatchForNode = (
	node: VectorNode,
	role: ColorPickPaintRole,
	color: string,
	sub: ColorPickSubSelection | undefined,
): NodeStylePatch => {
	const stopPatch = gradientStopPatchForNode(node, role, color, sub);
	if (stopPatch) return stopPatch;
	const paints = paintList(node, role);
	if (paints === undefined && color === legacyColor(node, role)) return {};
	const tail = paints?.slice(1) ?? [];
	const currentOpacity = paints?.[0]?.opacity;
	return {
		...legacyColorPatch(role, color),
		...paintRolePatch(role, [solidPaint(color, currentOpacity), ...tail]),
	};
};

const hasStylePatch = (patch: NodeStylePatch): boolean =>
	patch.fill !== undefined ||
	patch.stroke !== undefined ||
	patch.strokeWidth !== undefined ||
	patch.opacity !== undefined ||
	patch.fills !== undefined ||
	patch.strokes !== undefined ||
	patch.effects !== undefined ||
	patch.blendMode !== undefined ||
	patch.strokeAlign !== undefined ||
	patch.strokeDash !== undefined ||
	patch.strokeCap !== undefined ||
	patch.strokeJoin !== undefined ||
	patch.strokeMiterLimit !== undefined;

/**
 * Applies one sampled scene-data color to the current selection through the
 * scene command bus. The helper mirrors primary paint edits: legacy fill/stroke
 * fields are kept aligned with expressive paint lists so canvas rendering,
 * resolver paths, and undo/redo all observe one committed style change.
 */
export function applyPickedColorToSelection(
	candidate: ColorPickCandidate,
	selection: ColorPickSelectionTarget,
	options: {
		readonly targetRole?: ColorPickPaintRole;
	} = {},
): ColorPickApplyResult {
	const role = options.targetRole ?? candidate.role;
	const nodeIds = targetNodeIds(selection);
	if (nodeIds.length === 0) {
		return {
			kind: "empty",
			reason: "no-selection",
			color: candidate.color,
			role,
			candidate,
		};
	}

	const document = useSceneStore.getState().document;
	const entries = nodeIds.flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const patch = primaryPaintColorPatchForNode(
			node,
			role,
			candidate.color,
			selection.sub,
		);
		return hasStylePatch(patch) ? [{ nodeId, patch }] : [];
	});

	if (entries.length === 0) {
		const hasLiveTarget = nodeIds.some((nodeId) => findNode(document, nodeId));
		return {
			kind: "empty",
			reason: hasLiveTarget ? "no-change" : "no-live-target",
			color: candidate.color,
			role,
			candidate,
		};
	}

	const store = useSceneStore.getState();
	const before = store.document;
	store.beginTransaction(
		`color-pick:${role}:${entries.map((entry) => entry.nodeId).join(",")}`,
		"Apply picked color",
	);
	for (const entry of entries) {
		store.apply(
			createUpdateNodeStyleCommand(entry.nodeId, entry.patch, {
				preservesPaintIndices: true,
			}),
		);
	}
	store.commit();

	return useSceneStore.getState().document === before
		? {
				kind: "empty",
				reason: "no-change",
				color: candidate.color,
				role,
				candidate,
			}
		: {
				kind: "applied",
				color: candidate.color,
				role,
				nodeIds: entries.map((entry) => entry.nodeId),
				candidate,
			};
}
