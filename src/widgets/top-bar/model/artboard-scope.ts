import { selectNodeArtboardMapping } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import type {
	ExportArtboardScopeInput,
	ExportArtboardScopeMode,
} from "@/features/export/model/artboards";

export type TopBarArtboardScopeMode = ExportArtboardScopeMode;

export const TOP_BAR_ARTBOARD_SCOPE_MODES = [
	"current",
	"all",
	"selected",
] as const satisfies readonly TopBarArtboardScopeMode[];

/**
 * Derives selected artboards from the current node selection. TopBar owns only a
 * compact scope control, so it reuses the scene read model instead of adding a
 * separate artboard-selection store.
 */
export function selectedArtboardIdsForNodes(
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): readonly string[] {
	const mapping = selectNodeArtboardMapping(scene);
	const selectedArtboardIds = selectedNodeIds
		.map((nodeId) => mapping.byNodeId[nodeId])
		.filter((artboardId): artboardId is string => Boolean(artboardId));
	return [...new Set(selectedArtboardIds)];
}

/**
 * Builds the existing export model's artboard scope input from TopBar state.
 * Empty selected scopes are passed through deliberately so the export resolver
 * can emit its typed fallback issue and report the current-artboard fallback.
 */
export function createTopBarExportArtboardScope(
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
	mode: TopBarArtboardScopeMode,
): ExportArtboardScopeInput {
	if (mode !== "selected") return mode;
	return {
		mode,
		artboardIds: selectedArtboardIdsForNodes(scene, selectedNodeIds),
	};
}
