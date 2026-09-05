import { castDraft, type Draft, type Patch } from "immer";
import type { SceneCommand } from "./command";
import { cloneSceneDocument } from "./factory";
import {
	type LayoutFramePatch,
	layoutFramePresetPatch,
	materializeLayoutChildIntoBounds,
	packLayoutFramePlacementsContract,
	patchActiveLayoutFrameContract,
	patchLayoutFrameContract,
	patchLayoutFramePlacementContract,
	patchLayoutFramePlacementsContract,
	resolveLayoutFramePlan,
} from "./layout-frame";
import { getNodeParentBounds, unionBounds } from "./rendering";
import { findDraftNode } from "./selectors";
import type {
	Bounds,
	LayoutCellPlacement,
	LayoutFrameContract,
	LayoutFramePresetId,
	NodeStyle,
	SceneDocument,
	Transform,
	VectorNode,
} from "./types";

const FRAME_BACKGROUND_STYLE = {
	fill: "none",
	stroke: "none",
	strokeWidth: 0,
	opacity: 1,
} as const satisfies NodeStyle;

const cloneIdentityTransform = (): Transform => ({
	position: { x: 0, y: 0 },
	rotation: 0,
	scale: { x: 1, y: 1 },
	anchor: { x: 0, y: 0 },
});

const frameBoundsForNodes = (nodes: readonly VectorNode[]): Bounds =>
	unionBounds(nodes.map((node) => getNodeParentBounds(node)));

const findLayoutSourceContainer = (
	nodes: Draft<VectorNode[]>,
	parentNodeId: string | null | undefined,
): Draft<VectorNode[]> | null => {
	if (!parentNodeId) return nodes;
	for (const node of nodes) {
		if (node.id === parentNodeId) {
			if (!node.children) {
				if (node.frame?.kind !== "frame") return null;
				node.children = [];
			}
			return castDraft(node.children);
		}
		if (!node.children) continue;
		const nested = findLayoutSourceContainer(
			castDraft(node.children),
			parentNodeId,
		);
		if (nested) return nested;
	}
	return null;
};

const materializeLayoutChild = (
	node: Draft<VectorNode>,
	bounds: Bounds,
	placement: LayoutCellPlacement,
): void => {
	const materialized = materializeLayoutChildIntoBounds(
		node,
		bounds,
		placement.fit,
	);
	node.geometry = castDraft(materialized.geometry);
	node.transform = castDraft(materialized.transform);
};

const directChildIds = (node: Draft<VectorNode>): readonly string[] =>
	(node.children ?? []).map((child) => child.id);

const applyLayoutToFrameDraft = (
	frame: Draft<VectorNode>,
	layout: LayoutFrameContract | LayoutFramePatch | undefined,
): void => {
	if (frame.frame?.kind !== "frame" || frame.geometry.kind !== "rect") return;
	const children = frame.children;
	if (!children || children.length === 0) {
		frame.frame = {
			...frame.frame,
			layout: castDraft(
				patchLayoutFrameContract(frame.frame.layout, layout ?? {}),
			),
		};
		return;
	}

	const plan = resolveLayoutFramePlan(
		frame.geometry.bounds,
		layout ?? frame.frame.layout,
		directChildIds(frame),
	);
	frame.frame = {
		...frame.frame,
		layout: castDraft(plan.layout),
	};
	for (const cell of plan.cells) {
		const child = children.find((item) => item.id === cell.nodeId);
		if (!child) continue;
		materializeLayoutChild(child, cell.bounds, cell.placement);
		reapplyLayoutFrameDraft(child);
	}
};

const reapplyLayoutFrameDraft = (frame: Draft<VectorNode>): boolean => {
	if (frame.frame?.kind !== "frame" || !frame.frame.layout) return false;
	applyLayoutToFrameDraft(frame, frame.frame.layout);
	return true;
};

const reapplyLayoutFrameDrafts = (
	nodes: Draft<readonly VectorNode[]>,
): number => {
	let count = 0;
	for (const node of nodes) {
		if (reapplyLayoutFrameDraft(node)) {
			count += 1;
			continue;
		}
		if (node.children) count += reapplyLayoutFrameDrafts(node.children);
	}
	return count;
};

const LAYOUT_REPAIR_NODE_FIELDS = new Set(["geometry", "transform", "frame"]);

type LayoutRepairPatchTarget =
	| { readonly kind: "fallback" }
	| { readonly kind: "irrelevant" }
	| { readonly kind: "handled"; readonly frames: readonly Draft<VectorNode>[] };

const handledLayoutRepair = (
	frames: readonly Draft<VectorNode>[] = [],
): LayoutRepairPatchTarget => ({
	kind: "handled",
	frames,
});

const collectLayoutRepairFrames = (
	node: Draft<VectorNode>,
	output: Draft<VectorNode>[],
): void => {
	if (node.frame?.layout) {
		output.push(node);
		return;
	}
	for (const child of node.children ?? []) {
		collectLayoutRepairFrames(child, output);
	}
};

const layoutRepairFramesForSubtree = (
	node: Draft<VectorNode> | undefined,
): readonly Draft<VectorNode>[] => {
	if (!node) return [];
	const frames: Draft<VectorNode>[] = [];
	collectLayoutRepairFrames(node, frames);
	return frames;
};

const resolveLayoutRepairPatchTarget = (
	draft: Draft<SceneDocument>,
	patch: Patch,
): LayoutRepairPatchTarget => {
	const { path } = patch;
	if (path.length === 0) return { kind: "fallback" };
	if (path[0] !== "layers") return { kind: "irrelevant" };
	const layerIndex = path[1];
	if (typeof layerIndex !== "number") return { kind: "fallback" };
	const layer = draft.layers[layerIndex];
	if (!layer) return { kind: "fallback" };
	if (path[2] !== "nodes") return { kind: "irrelevant" };
	const nodeIndex = path[3];
	if (typeof nodeIndex !== "number") return { kind: "fallback" };
	if (path.length === 4 && patch.op === "remove") {
		return handledLayoutRepair();
	}
	let node = layer.nodes[nodeIndex];
	if (!node) return { kind: "fallback" };
	if (path.length === 4) {
		return handledLayoutRepair(layoutRepairFramesForSubtree(node));
	}
	let outerLayoutFrame: Draft<VectorNode> | null = node.frame?.layout
		? node
		: null;
	let cursor = 4;
	while (path[cursor] === "children") {
		if (cursor + 1 === path.length) {
			return node.frame?.layout
				? handledLayoutRepair([node])
				: handledLayoutRepair(
						patch.op === "remove"
							? []
							: (node.children ?? []).flatMap((child) =>
									layoutRepairFramesForSubtree(child),
								),
					);
		}
		const childIndex = path[cursor + 1];
		if (typeof childIndex !== "number") return { kind: "fallback" };
		if (cursor + 2 === path.length) {
			const child = node.children?.[childIndex];
			return node.frame?.layout
				? handledLayoutRepair([node])
				: handledLayoutRepair(
						patch.op === "remove" ? [] : layoutRepairFramesForSubtree(child),
					);
		}
		const child = node.children?.[childIndex];
		if (!child) return { kind: "fallback" };
		node = child;
		if (!outerLayoutFrame && node.frame?.layout) {
			outerLayoutFrame = node;
		}
		cursor += 2;
	}
	const field = path[cursor];
	if (field === undefined || field === "children") return { kind: "fallback" };
	if (typeof field !== "string") return { kind: "fallback" };
	if (!LAYOUT_REPAIR_NODE_FIELDS.has(field)) return { kind: "irrelevant" };
	return handledLayoutRepair(outerLayoutFrame ? [outerLayoutFrame] : []);
};

/**
 * Re-materializes only layout frames touched by exact node-field patches or by
 * structural array patches whose surviving layout parent/subtree is known.
 * Known structural no-ops, such as deleting a non-layout sibling, are resolved
 * without repair so ordinary layer churn does not rewrite unrelated cached
 * layout geometry. Broad structural patches deliberately return `false` so
 * callers can fall back to the older global refresh path rather than guessing
 * from unstable array indexes.
 */
export function reapplyLayoutFramesAffectedByPatchesInDraft(
	draft: Draft<SceneDocument>,
	patches: readonly Patch[],
): boolean {
	const affectedFrames = new Map<string, Draft<VectorNode>>();
	let handledLayoutRelevantPatch = false;
	for (const patch of patches) {
		const target = resolveLayoutRepairPatchTarget(draft, patch);
		if (target.kind === "fallback") return false;
		if (target.kind === "irrelevant") continue;
		handledLayoutRelevantPatch = true;
		for (const frame of target.frames) {
			affectedFrames.set(frame.id, frame);
		}
	}
	for (const frame of affectedFrames.values()) {
		reapplyLayoutFrameDraft(frame);
	}
	return handledLayoutRelevantPatch;
}

/**
 * Re-materializes every stored layout frame inside a scene draft. Layout frames
 * nested inside a materialized cell are refreshed immediately from the new cell
 * bounds, which keeps command-side geometry coherent without a second global
 * pass after layout-specific commands.
 */
export function reapplyLayoutFramesInDraft(draft: Draft<SceneDocument>): void {
	for (const layer of draft.layers) {
		reapplyLayoutFrameDrafts(layer.nodes);
	}
}

const createLayoutFrameNode = (input: {
	readonly frameNodeId: string;
	readonly children: readonly VectorNode[];
	readonly bounds: Bounds;
	readonly layout?: LayoutFrameContract | LayoutFramePatch;
	readonly name?: string;
	readonly clipsContent?: boolean;
	readonly artboardId?: string;
}): VectorNode => {
	const frameNode: VectorNode = {
		id: input.frameNodeId,
		name: input.name ?? "Grid layout",
		...(input.artboardId ? { artboardId: input.artboardId } : {}),
		geometry: {
			kind: "rect",
			bounds: input.bounds,
			cornerRadius: 0,
		},
		transform: cloneIdentityTransform(),
		style: { ...FRAME_BACKGROUND_STYLE },
		visible: true,
		locked: false,
		frame: {
			kind: "frame",
			clipsContent: input.clipsContent ?? true,
		},
		children: cloneSceneDocument(input.children),
	};

	const draftFrame = castDraft(frameNode);
	applyLayoutToFrameDraft(draftFrame, input.layout);
	return cloneSceneDocument(draftFrame);
};

/**
 * Wraps sibling nodes in a layout frame and immediately materializes child
 * bounds from the stored grid/bento contract. Top-level sources use the layer
 * root; nested sources use `parentNodeId` and must already share that parent.
 * The command authors `frame.layout` so GUI and MCP flows share scene state.
 */
export function createLayoutFrameFromNodesCommand(options: {
	readonly layerId: string;
	readonly parentNodeId?: string | null;
	readonly frameNodeId: string;
	readonly sourceNodeIds: readonly string[];
	readonly layout?: LayoutFrameContract | LayoutFramePatch;
	readonly preset?: LayoutFramePresetId;
	readonly name?: string;
	readonly clipsContent?: boolean;
	readonly artboardId?: string;
	readonly bounds?: Bounds;
}): SceneCommand {
	return {
		type: "scene/create-layout-frame",
		label: "Wrap in grid layout",
		layoutReapply: "skip",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer) return;
			if (findDraftNode(draft, options.frameNodeId)) return;
			const sourceIds = [...new Set(options.sourceNodeIds)];
			if (sourceIds.length === 0 && !options.bounds) return;
			const sourceContainer = findLayoutSourceContainer(
				layer.nodes,
				options.parentNodeId,
			);
			if (!sourceContainer) return;

			const sourceEntries = sourceIds
				.map((nodeId) => ({
					nodeId,
					index: sourceContainer.findIndex((node) => node.id === nodeId),
				}))
				.filter(
					(
						entry,
					): entry is { readonly nodeId: string; readonly index: number } =>
						entry.index >= 0,
				);
			if (sourceEntries.length !== sourceIds.length) return;

			const orderedEntries = [...sourceEntries].sort(
				(left, right) => left.index - right.index,
			);
			const firstIndex = orderedEntries[0]?.index ?? sourceContainer.length;

			const children: VectorNode[] = [];
			for (const entry of orderedEntries) {
				const node = sourceContainer[entry.index];
				if (!node) return;
				children.push(cloneSceneDocument<VectorNode>(node));
			}

			const childIds = children.map((child) => child.id);
			const presetPatch = options.preset
				? layoutFramePresetPatch(options.preset, childIds)
				: undefined;
			const layout = presetPatch
				? { ...(options.layout ?? {}), ...presetPatch }
				: options.layout;
			const frameNode = createLayoutFrameNode({
				frameNodeId: options.frameNodeId,
				children,
				bounds: options.bounds ?? frameBoundsForNodes(children),
				layout,
				name: options.name,
				clipsContent: options.clipsContent,
				artboardId: options.artboardId,
			});

			for (const entry of orderedEntries.toReversed()) {
				sourceContainer.splice(entry.index, 1);
			}
			sourceContainer.splice(firstIndex, 0, castDraft(frameNode));
		},
	};
}

/**
 * Updates a layout frame's contract and re-materializes its direct children.
 * Missing frames, non-frames, and non-rect frame geometry are no-ops so stale
 * GUI/MCP requests cannot corrupt unrelated scene nodes.
 */
export function createUpdateLayoutFrameCommand(
	frameNodeId: string,
	patch: LayoutFramePatch,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	return {
		type: "scene/update-layout-frame",
		label: options.label ?? "Edit grid layout",
		coalesceKey: options.coalesceKey,
		layoutReapply: "skip",
		run: (draft) => {
			const frame = findDraftNode(draft, frameNodeId);
			if (frame?.frame?.kind !== "frame") return;
			const layout = patchActiveLayoutFrameContract(frame.frame.layout, patch, {
				width:
					frame.geometry.kind === "rect"
						? frame.geometry.bounds.width
						: undefined,
			});
			applyLayoutToFrameDraft(frame, layout);
		},
	};
}

/**
 * Sets the zero-based grid placement for one direct child, then applies the
 * updated layout to every child so spans and auto-filled siblings stay coherent.
 */
export function createSetLayoutChildPlacementCommand(options: {
	readonly frameNodeId: string;
	readonly childNodeId: string;
	readonly placement: LayoutCellPlacement;
}): SceneCommand {
	return {
		type: "scene/set-layout-child-placement",
		label: "Place grid child",
		layoutReapply: "skip",
		run: (draft) => {
			const frame = findDraftNode(draft, options.frameNodeId);
			if (frame?.frame?.kind !== "frame") return;
			if (!frame.children?.some((child) => child.id === options.childNodeId)) {
				return;
			}
			const layout = patchLayoutFramePlacementContract(
				frame.frame.layout,
				options.childNodeId,
				options.placement,
				{
					width:
						frame.geometry.kind === "rect"
							? frame.geometry.bounds.width
							: undefined,
				},
			);
			applyLayoutToFrameDraft(frame, layout);
		},
	};
}

/**
 * Sets multiple direct-child grid placements in one priority group, then applies
 * the updated layout once so multi-cell canvas moves are one undoable scene edit.
 */
export function createSetLayoutChildrenPlacementsCommand(options: {
	readonly frameNodeId: string;
	readonly placements: readonly {
		readonly childNodeId: string;
		readonly placement: LayoutCellPlacement;
	}[];
}): SceneCommand {
	return {
		type: "scene/set-layout-children-placements",
		label: "Place grid children",
		layoutReapply: "skip",
		run: (draft) => {
			const frame = findDraftNode(draft, options.frameNodeId);
			if (frame?.frame?.kind !== "frame") return;
			const childIds = new Set(frame.children?.map((child) => child.id) ?? []);
			const placements = options.placements
				.filter((item) => childIds.has(item.childNodeId))
				.map((item) => ({
					nodeId: item.childNodeId,
					placement: item.placement,
				}));
			if (placements.length === 0) return;
			const layout = patchLayoutFramePlacementsContract(
				frame.frame.layout,
				placements,
				{
					width:
						frame.geometry.kind === "rect"
							? frame.geometry.bounds.width
							: undefined,
				},
			);
			applyLayoutToFrameDraft(frame, layout);
		},
	};
}

/**
 * Applies a named bento/grid preset to a layout frame's direct children. Presets
 * are stored as ordinary placement data so subsequent inspector or MCP edits can
 * keep refining the result without remembering a separate template operation.
 */
export function createApplyLayoutPresetCommand(options: {
	readonly frameNodeId: string;
	readonly preset: LayoutFramePresetId;
}): SceneCommand {
	return {
		type: "scene/apply-layout-preset",
		label: "Apply grid layout preset",
		layoutReapply: "skip",
		run: (draft) => {
			const frame = findDraftNode(draft, options.frameNodeId);
			if (frame?.frame?.kind !== "frame") return;
			const childIds = directChildIds(frame);
			const layout = patchActiveLayoutFrameContract(
				frame.frame.layout,
				layoutFramePresetPatch(options.preset, childIds),
				{
					width:
						frame.geometry.kind === "rect"
							? frame.geometry.bounds.width
							: undefined,
				},
			);
			applyLayoutToFrameDraft(frame, layout);
		},
	};
}

/**
 * Repairs explicit layout placements by preserving each child span/fit and
 * moving overlapping cells to the first available grid range. This is a distinct
 * authoring operation from "reapply", which is primarily a geometry refresh.
 */
export function createPackLayoutFrameCommand(
	frameNodeId: string,
): SceneCommand {
	return {
		type: "scene/pack-layout-frame",
		label: "Pack grid cells",
		layoutReapply: "skip",
		run: (draft) => {
			const frame = findDraftNode(draft, frameNodeId);
			if (frame?.frame?.kind !== "frame") return;
			const layout = packLayoutFramePlacementsContract(
				frame.frame.layout,
				directChildIds(frame),
				{
					width:
						frame.geometry.kind === "rect"
							? frame.geometry.bounds.width
							: undefined,
				},
			);
			applyLayoutToFrameDraft(frame, layout);
		},
	};
}

/**
 * Re-materializes layout-managed children from the stored frame contract without
 * changing authored layout intent. This is the first live-layout bridge: callers
 * can repair child geometry after external edits, imports, or command batches
 * that add/move children before the renderer/exporter become layout-aware.
 */
export function createReapplyLayoutFrameCommand(
	frameNodeId?: string,
): SceneCommand {
	return {
		type: "scene/reapply-layout-frame",
		label: frameNodeId ? "Reapply grid layout" : "Reapply grid layouts",
		layoutReapply: "skip",
		run: (draft) => {
			if (frameNodeId) {
				const frame = findDraftNode(draft, frameNodeId);
				if (!frame) return;
				reapplyLayoutFrameDraft(frame);
				return;
			}
			reapplyLayoutFramesInDraft(draft);
		},
	};
}
