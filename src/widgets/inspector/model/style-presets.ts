import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	createAddStylePresetCommand,
	createApplyStylePresetCommand,
	createInsertStylePresetCommand,
	createRemoveStylePresetCommand,
	createRenameStylePresetCommand,
	createReorderStylePresetCommand,
	createReplaceStylePresetCommand,
} from "@/entities/scene/model/style-preset-commands";
import {
	captureStylePresetFromNode,
	createStylePreset,
	readStylePresets,
} from "@/entities/scene/model/style-presets";
import type {
	SceneDocument,
	StylePreset,
	StylePresetKind,
} from "@/entities/scene/model/types";

/**
 * Inspector-facing adapter for the document style-preset library. This is the
 * concrete proof that a future style panel can attach to the foundation seam
 * without a scene schema rewrite: the panel reads `stylePresetInspectorState`,
 * then calls the commit helpers, which run undoable entity commands through the
 * single scene command bus. No `.tsx` surface is touched here.
 */

/** One library row prepared for display: id, name, kind, and which parts it carries. */
export type StylePresetSummary = {
	readonly id: string;
	readonly name: string;
	readonly kind: StylePresetKind;
	readonly hasPaint: boolean;
	readonly hasTypography: boolean;
};

/**
 * Derived, render-ready state for the style-preset section. `canCapture` is true
 * when exactly the inspector's primary node is available to seed a new preset;
 * `canApply` reflects whether any selected nodes can receive a preset.
 */
export type StylePresetInspectorState = {
	readonly presets: readonly StylePresetSummary[];
	readonly presetCount: number;
	readonly selectedNodeIds: readonly string[];
	readonly canApply: boolean;
	readonly canCapture: boolean;
	readonly captureSourceNodeId: string | null;
};

const summarize = (preset: StylePreset): StylePresetSummary => ({
	id: preset.id,
	name: preset.name,
	kind: preset.kind,
	hasPaint: preset.paint !== undefined,
	hasTypography: preset.typography !== undefined,
});

const liveSelectedNodeIds = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly string[] =>
	[...new Set(nodeIds)].filter(
		(nodeId) => findNode(document, nodeId) !== undefined,
	);

/**
 * Builds the inspector style-preset state from a scene document and the current
 * selection. The capture source is the primary selected node when present, so the
 * panel can offer "save this node's style as a preset" without reaching outside
 * the visible selection.
 */
export function stylePresetInspectorState(
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	primaryNodeId: string | null,
): StylePresetInspectorState {
	const presets = readStylePresets(document).map(summarize);
	const liveIds = liveSelectedNodeIds(document, selectedNodeIds);
	const captureSource =
		(primaryNodeId && liveIds.includes(primaryNodeId)
			? primaryNodeId
			: liveIds[0]) ?? null;

	return {
		presets,
		presetCount: presets.length,
		selectedNodeIds: liveIds,
		canApply: liveIds.length > 0,
		canCapture: captureSource !== null,
		captureSourceNodeId: captureSource,
	};
}

const applySceneCommand = (command: SceneCommand): boolean => {
	const before = useSceneStore.getState().document;
	useSceneStore.getState().apply(command);
	return useSceneStore.getState().document !== before;
};

/**
 * Adds a preset captured from a node's current appearance. Returns the minted
 * preset id on success so the panel can immediately select or apply it; returns
 * null when the node is missing or its payload normalizes to nothing.
 */
export function commitCaptureStylePreset(
	nodeId: string,
	name?: string,
): string | null {
	const document = useSceneStore.getState().document;
	const node = findNode(document, nodeId);
	if (!node) return null;
	const options = captureStylePresetFromNode(node);
	const preset = createStylePreset(readStylePresets(document), {
		...options,
		...(name ? { name } : {}),
	});
	if (!preset) return null;
	return applySceneCommand(createInsertStylePresetCommand(preset))
		? preset.id
		: null;
}

/**
 * Adds a preset from an explicit paint/typography payload. The entity command
 * mints a collision-free id/name; this returns whether the library changed.
 */
export function commitAddStylePreset(
	options: Parameters<typeof createAddStylePresetCommand>[0],
): boolean {
	return applySceneCommand(createAddStylePresetCommand(options));
}

/** Applies a preset to the live selection. Returns whether the document changed. */
export function commitApplyStylePreset(
	presetId: string,
	nodeIds: readonly string[],
): boolean {
	const document = useSceneStore.getState().document;
	const liveIds = liveSelectedNodeIds(document, nodeIds);
	if (liveIds.length === 0) return false;
	return applySceneCommand(
		createApplyStylePresetCommand(presetId, liveIds, {
			grammarTargetNodeIds: currentMotionGrammarTargetNodeIds(),
			motion: useMotionStore.getState().document,
		}),
	);
}

/** Renames a preset after the entity command validates blank/duplicate names. */
export function commitRenameStylePreset(
	presetId: string,
	name: string,
): boolean {
	return applySceneCommand(createRenameStylePresetCommand(presetId, name));
}

/**
 * Refreshes an existing preset from a selected source node. The command keeps
 * the preset identity stable while replacing paint/typography through the scene
 * domain capture rules, including normalized text geometry for text styles.
 */
export function commitUpdateStylePresetFromNode(
	presetId: string,
	nodeId: string,
): boolean {
	const document = useSceneStore.getState().document;
	const node = findNode(document, nodeId);
	if (!node) return false;
	return applySceneCommand(
		createReplaceStylePresetCommand(presetId, captureStylePresetFromNode(node)),
	);
}

/** Removes a preset from the library. Value-copied node styles are preserved. */
export function commitRemoveStylePreset(presetId: string): boolean {
	return applySceneCommand(createRemoveStylePresetCommand(presetId));
}

/** Moves a preset to a zero-based library position through the Scene command bus. */
export function commitReorderStylePreset(
	presetId: string,
	toIndex: number,
): boolean {
	return applySceneCommand(createReorderStylePresetCommand(presetId, toIndex));
}
