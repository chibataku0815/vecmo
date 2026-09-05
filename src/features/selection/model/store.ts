import { create } from "zustand";
import type { SceneCameraAuthoringSelection } from "@/entities/scene/model/scene-camera-authoring";
import type { SceneDocument } from "@/entities/scene/model/types";

/**
 * Top-level nodes a user can select via Select All: visible and unlocked nodes
 * inside visible, unlocked layers. Group children are represented by their
 * top-level group node (matching the codebase's top-level arrange/z-order model
 * and Figma's Cmd+A scope), so a group and its children are never both selected.
 */
export function selectableNodeIds(document: SceneDocument): string[] {
	const ids: string[] = [];
	for (const layer of document.layers) {
		if (!layer.visible || layer.locked) continue;
		for (const node of layer.nodes) {
			if (node.visible && !node.locked) ids.push(node.id);
		}
	}
	return ids;
}

/** Selectable nodes that are not currently selected — the Select Inverse target. */
export function invertSelection(
	document: SceneDocument,
	currentNodeIds: readonly string[],
): string[] {
	const current = new Set(currentNodeIds);
	return selectableNodeIds(document).filter((id) => !current.has(id));
}

/** A selected vertex or bezier handle inside a path node. */
export type PathSubSelection = {
	readonly nodeId: string;
	readonly kind: "anchor" | "handle-in" | "handle-out";
	/**
	 * Primary selected anchor/handle. Anchor selections may also carry `indices`
	 * for multi-anchor direct selection; the primary index remains present so
	 * older single-anchor readers keep working.
	 */
	readonly index: number;
	readonly indices?: readonly number[];
};

/**
 * A selected gradient stop, addressed by its stable id rather than an index: stops
 * re-sort by offset on every edit, so an index would retarget mid-drag and detach
 * the inline editor. `role` records which paint stack (fill or stroke) it lives in.
 * This is the single channel the canvas annotator (via `api.setSubSelection`) and
 * the inspector ramp (reading `useSelectionStore`) share to stay in lockstep.
 */
export type GradientStopSubSelection = {
	readonly nodeId: string;
	readonly kind: "gradient-stop";
	readonly role: "fills" | "strokes";
	readonly stopId: string;
};

/**
 * A selected mesh point inside a mesh-gradient paint, addressed by its stable
 * `(row, col)` grid position. Unlike gradient stops (which re-sort by offset and
 * need id-tracking), mesh points keep a fixed grid index, so `(row, col)` is a
 * durable handle the canvas overlay and a future inspector both read. `role`
 * records which paint stack (fill or stroke) the mesh lives in.
 */
export type MeshNodeSubSelection = {
	readonly nodeId: string;
	readonly kind: "mesh-node";
	readonly role: "fills" | "strokes";
	readonly row: number;
	readonly col: number;
};

/**
 * A selected scalar-density point inside an object Noise Gradient Field Mesh.
 * This is deliberately separate from `mesh-node`: color Gradient Mesh edits paint
 * stops, while Noise Gradient mesh points edit texture density in vec-core recipe
 * payloads.
 */
export type NoiseFieldMeshPointSubSelection = {
	readonly nodeId: string;
	readonly kind: "noise-field-mesh-point";
	readonly row: number;
	readonly col: number;
};

/**
 * A selected Path Blur guide inside a frame Look's `path-blur` node, addressed by
 * its index in the node's `guides` array. Guides keep a stable order while editing
 * (only their vertices move), so the index is a durable handle the canvas overlay
 * reads to render the selected guide with accent emphasis and the tool's
 * `onKeyDown` reads to delete it.
 */
export type PathBlurGuideSubSelection = {
	readonly nodeId: string;
	readonly kind: "path-blur-guide";
	readonly guideIndex: number;
};

export type SubSelection =
	| PathSubSelection
	| GradientStopSubSelection
	| MeshNodeSubSelection
	| NoiseFieldMeshPointSubSelection
	| PathBlurGuideSubSelection
	| null;

export type SelectionState = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
	readonly sub: SubSelection;
	/**
	 * Camera-authoring selection is intentionally separate from node ids. A camera
	 * rig is not a vector node, while hidden target/body nulls may be scene nodes
	 * whose authoring role should still be selectable in Layers, Inspector, or MCP.
	 */
	readonly sceneCamera: SceneCameraAuthoringSelection | null;
	/**
	 * Canvas-selected artboard, mutually exclusive with node selection: an
	 * artboard and a node can never be co-selected because an artboard has no
	 * Transform/matrix and a mixed selection has no coherent gesture frame or
	 * inspector. Every node-focusing setter clears this, and {@link selectArtboard}
	 * clears node focus, so the illegal "both populated" state is unrepresentable.
	 * This is ephemeral UI state and is intentionally decoupled from the document's
	 * `currentArtboardId` (a focus change is undoable; a selection must never be).
	 */
	readonly selectedArtboardId: string | null;
};

type SelectionStore = SelectionState & {
	readonly setSelection: (
		nodeIds: readonly string[],
		primary?: string | null,
	) => void;
	readonly selectNode: (nodeId: string, additive?: boolean) => void;
	readonly selectAll: (document: SceneDocument) => void;
	readonly selectInverse: (document: SceneDocument) => void;
	readonly clearSelection: () => void;
	readonly setSubSelection: (sub: SubSelection) => void;
	/**
	 * Selects a scene-camera authoring item (or clears it with `null`). Clears node
	 * and artboard selection because camera rigs have a different inspector model
	 * from ordinary vector geometry.
	 */
	readonly selectSceneCamera: (
		selection: SceneCameraAuthoringSelection | null,
	) => void;
	/**
	 * Selects an artboard (or clears artboard selection with `null`). Clears node
	 * selection to keep the two selection dimensions mutually exclusive.
	 */
	readonly selectArtboard: (artboardId: string | null) => void;
};

export const useSelectionStore = create<SelectionStore>()((set, get) => ({
	nodeIds: ["node-panel"],
	primary: "node-panel",
	sub: null,
	sceneCamera: null,
	selectedArtboardId: null,
	setSelection: (nodeIds, primary) => {
		const unique = [...new Set(nodeIds)];
		set({
			nodeIds: unique,
			primary: primary === undefined ? (unique.at(-1) ?? null) : primary,
			sub: null,
			sceneCamera: null,
			selectedArtboardId: null,
		});
	},
	selectNode: (nodeId, additive = false) => {
		if (!additive) {
			set({
				nodeIds: [nodeId],
				primary: nodeId,
				sub: null,
				sceneCamera: null,
				selectedArtboardId: null,
			});
			return;
		}
		const current = get().nodeIds;
		const nodeIds = current.includes(nodeId)
			? current.filter((id) => id !== nodeId)
			: [...current, nodeId];
		set({
			nodeIds,
			primary: nodeIds.at(-1) ?? null,
			sub: null,
			sceneCamera: null,
			selectedArtboardId: null,
		});
	},
	selectAll: (document) => get().setSelection(selectableNodeIds(document)),
	selectInverse: (document) =>
		get().setSelection(invertSelection(document, get().nodeIds)),
	clearSelection: () =>
		set({
			nodeIds: [],
			primary: null,
			sub: null,
			sceneCamera: null,
			selectedArtboardId: null,
		}),
	setSubSelection: (sub) =>
		set({ sub, sceneCamera: null, selectedArtboardId: null }),
	selectSceneCamera: (sceneCamera) =>
		set({
			nodeIds: [],
			primary: null,
			sub: null,
			sceneCamera,
			selectedArtboardId: null,
		}),
	selectArtboard: (artboardId) =>
		set({
			nodeIds: [],
			primary: null,
			sub: null,
			sceneCamera: null,
			selectedArtboardId: artboardId,
		}),
}));
