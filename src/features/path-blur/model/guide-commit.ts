import { createSetLookGraphCommand } from "@/entities/scene/model/look-graph-commands";
import type { EffectIntentTarget } from "@/entities/scene/model/node-commands";
import {
	objectPathBlurGraphNode,
	objectPathBlurScopedLookForNode,
} from "@/entities/scene/model/path-blur-look";
import { resolveFrameLookGraph } from "@/entities/scene/model/recipe-resolve";
import {
	createSetScopedLookGraphOverlayCommand,
	scopedLookGraphNodeBounds,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import type { PathBlurGuide } from "@/shared/path-blur/velocity-field";

const GUIDE_LABEL = "Edit Path Blur guide";
/** Undo label for appending another guide path (vs editing an existing one). */
export const ADD_GUIDE_LABEL = "Add Path Blur guide";
/** Undo label for deleting a selected guide path. */
export const DELETE_GUIDE_LABEL = "Delete Path Blur guide";
/** Undo label for inserting an anchor into an existing guide path. */
export const INSERT_ANCHOR_LABEL = "Add Path Blur anchor";
/** Undo label for removing an anchor from a guide path. */
export const REMOVE_ANCHOR_LABEL = "Remove Path Blur anchor";

const artboardTarget = (artboardId: string): EffectIntentTarget => ({
	scope: "artboard",
	artboardId,
});

/**
 * Where a Path Blur guide edit writes to: the frame Look graph (whole-artboard
 * blur, legacy/default behavior) or one object's scoped Look Graph overlay
 * (per-object blur). {@link resolvePathBlurTarget} picks between the two based
 * on the current selection.
 */
export type PathBlurWriteTarget =
	| { readonly scope: "frame"; readonly artboardId: string }
	| {
			readonly scope: "object";
			readonly artboardId: string;
			readonly scopedLookId: string;
	  };

/**
 * Writes new guide paths onto a Path Blur graph node through the command bus
 * (the only document writer features may use). All moves within one drag
 * share `coalesceKey`, so the gesture collapses to a single undo entry — the
 * same live-drag coalescing the gradient/inspector scrubs use. Reads the
 * current graph fresh from the store each call so concurrent edits compose.
 */
export const commitPathBlurGuides = (
	write: PathBlurWriteTarget,
	nodeId: string,
	nextGuides: readonly PathBlurGuide[],
	coalesceKey: string,
	label: string = GUIDE_LABEL,
): void => {
	const document = useSceneStore.getState().document;
	if (write.scope === "frame") {
		const graph = resolveFrameLookGraph(document, write.artboardId);
		if (!graph) return;
		const nextGraph = {
			...graph,
			nodes: graph.nodes.map((node) =>
				node.id === nodeId && node.payload.kind === "path-blur"
					? { ...node, payload: { ...node.payload, guides: nextGuides } }
					: node,
			),
		};
		useSceneStore.getState().apply(
			createSetLookGraphCommand(artboardTarget(write.artboardId), nextGraph, {
				label,
				coalesceKey,
			}),
		);
		return;
	}
	const artboard =
		document.artboard.id === write.artboardId
			? document.artboard
			: document.artboards?.find((entry) => entry.id === write.artboardId);
	const look = artboard?.effectIntent?.scopedLooks?.find(
		(entry) => entry.id === write.scopedLookId,
	);
	if (look?.kind !== "look-graph-overlay") return;
	const nextGraph = {
		...look.lookGraph,
		nodes: look.lookGraph.nodes.map((node) =>
			node.id === nodeId && node.payload.kind === "path-blur"
				? { ...node, payload: { ...node.payload, guides: nextGuides } }
				: node,
		),
	};
	useSceneStore
		.getState()
		.apply(
			createSetScopedLookGraphOverlayCommand(
				write.artboardId,
				write.scopedLookId,
				nextGraph,
				{ label, coalesceKey },
			),
		);
};

/**
 * The pixel space guide edits happen in: the whole artboard for a frame-scope
 * target, or one object's own padded paint-bounds crop for an object-scope
 * target. Guides are always stored as 0..1 UV *within this space* — an object
 * target's guides are object-local UV, not frame UV, matching the isolated
 * GPU crop compositor that renders and blurs that same region. `offsetX`/
 * `offsetY` place the space's origin in artboard-pixel coordinates, which
 * pointer hit-testing and the guide overlay both need to convert between
 * artboard-pixel pointer/paint coordinates and this space.
 */
export type PathBlurEditSpace = {
	readonly width: number;
	readonly height: number;
	readonly offsetX: number;
	readonly offsetY: number;
};

export type ResolvedPathBlurTarget = {
	readonly nodeId: string;
	readonly guides: readonly PathBlurGuide[];
	readonly write: PathBlurWriteTarget;
	readonly space: PathBlurEditSpace;
};

/**
 * Picks which Path Blur graph node the tool session edits: the current
 * selection's object-scoped overlay when exactly one node is selected and it
 * owns one, otherwise the frame Look graph's node (legacy whole-artboard
 * behavior). Re-resolves fresh on every call so a selection change while the
 * Path Blur tool stays active retargets live.
 */
export const resolvePathBlurTarget = (
	document: SceneDocument,
	selection: { readonly nodeIds: readonly string[] },
): ResolvedPathBlurTarget | null => {
	const artboardId = document.artboard.id;
	if (selection.nodeIds.length === 1) {
		const targetNodeId = selection.nodeIds[0];
		const look = objectPathBlurScopedLookForNode(
			document.artboard,
			targetNodeId,
		);
		const targetNode = look ? findNode(document, targetNodeId) : undefined;
		const graphNode = look ? objectPathBlurGraphNode(look) : null;
		if (look && targetNode && graphNode?.payload.kind === "path-blur") {
			const bounds = scopedLookGraphNodeBounds(targetNode);
			return {
				nodeId: graphNode.id,
				guides: graphNode.payload.guides,
				write: { scope: "object", artboardId, scopedLookId: look.id },
				space: {
					width: bounds.width,
					height: bounds.height,
					offsetX: bounds.x,
					offsetY: bounds.y,
				},
			};
		}
	}
	const graph = resolveFrameLookGraph(document, artboardId);
	const node = graph?.nodes.find((entry) => entry.payload.kind === "path-blur");
	if (node?.payload.kind !== "path-blur") return null;
	return {
		nodeId: node.id,
		guides: node.payload.guides,
		write: { scope: "frame", artboardId },
		space: {
			width: document.artboard.width,
			height: document.artboard.height,
			offsetX: 0,
			offsetY: 0,
		},
	};
};
