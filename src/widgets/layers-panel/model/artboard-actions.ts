import type { SceneCommand } from "@/entities/scene/model/command";
import { createUpdateArtboardCommand } from "@/entities/scene/model/node-commands";
import { normalizeArtboardRole } from "@/entities/scene/model/selectors";
import type { ArtboardRole, SceneDocument } from "@/entities/scene/model/types";
import {
	buildDuplicateArtboardRowCommand,
	buildMoveArtboardRowCommand,
	buildRemoveArtboardRowCommand,
	buildSetArtboardRoleRowCommand,
} from "@/features/artboard";
import type { MoveDirection } from "./reorder";
import type { LayerPanelArtboardRow } from "./rows";

export type ArtboardRowStatusBadgeId =
	| "current"
	| "empty"
	| "hidden"
	| "locked"
	| "selected";

export type ArtboardRowStatusBadge = {
	readonly id: ArtboardRowStatusBadgeId;
	readonly label: string;
	readonly count?: number;
};

export type ArtboardRowSelectionSnapshot = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type ArtboardRowDuplicatePlan = {
	readonly command: SceneCommand;
	readonly duplicateArtboardId: string;
	readonly selectNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type ArtboardRowRoleOption = {
	readonly role: ArtboardRole;
	readonly label: string;
	readonly shortLabel: string;
	readonly description: string;
};

const DEFAULT_ARTBOARD_ROW_ROLE_OPTION = {
	role: "scene",
	label: "Scene",
	shortLabel: "Scene",
	description: "Exportable scene artboard",
} as const satisfies ArtboardRowRoleOption;

export const artboardRoleOptions = [
	DEFAULT_ARTBOARD_ROW_ROLE_OPTION,
	{
		role: "asset-board",
		label: "Asset board",
		shortLabel: "Asset",
		description: "Non-export reusable asset board",
	},
	{
		role: "scratch",
		label: "Scratch",
		shortLabel: "Scratch",
		description: "Non-export scratch board",
	},
	{
		role: "reference",
		label: "Reference",
		shortLabel: "Ref",
		description: "Non-export reference board",
	},
] as const satisfies readonly ArtboardRowRoleOption[];

/** Returns compact display metadata for an artboard's normalized role. */
export function getArtboardRowRoleOption(
	row: LayerPanelArtboardRow,
): ArtboardRowRoleOption {
	const role = normalizeArtboardRole(row.artboard);
	return (
		artboardRoleOptions.find((option) => option.role === role) ??
		DEFAULT_ARTBOARD_ROW_ROLE_OPTION
	);
}

/**
 * Produces compact status badges for an artboard row without coupling the UI to
 * the row's aggregate-count rules. Empty, hidden, locked, selected, and current
 * are intentionally distinct so dense chrome can expose production state with
 * stable icon affordances.
 */
export function getArtboardRowStatusBadges(
	row: LayerPanelArtboardRow,
): readonly ArtboardRowStatusBadge[] {
	const badges: ArtboardRowStatusBadge[] = [];
	if (row.current) badges.push({ id: "current", label: "Current artboard" });
	if (row.nodeCount === 0)
		badges.push({ id: "empty", label: "Empty artboard" });
	if (row.hiddenNodeCount > 0) {
		badges.push({
			id: "hidden",
			label: `${row.hiddenNodeCount} hidden node${
				row.hiddenNodeCount === 1 ? "" : "s"
			}`,
			count: row.hiddenNodeCount,
		});
	}
	if (row.lockedNodeCount > 0) {
		badges.push({
			id: "locked",
			label: `${row.lockedNodeCount} locked node${
				row.lockedNodeCount === 1 ? "" : "s"
			}`,
			count: row.lockedNodeCount,
		});
	}
	if (row.selectedNodeCount > 0) {
		badges.push({
			id: "selected",
			label: `${row.selectedNodeCount} selected node${
				row.selectedNodeCount === 1 ? "" : "s"
			}`,
			count: row.selectedNodeCount,
		});
	}
	return badges;
}

/**
 * Creates an undoable artboard rename command, returning null for empty or
 * semantic no-op names so inline editing does not create inert history entries.
 */
export function createRenameArtboardRowCommand(
	row: LayerPanelArtboardRow,
	name: string,
): SceneCommand | null {
	const trimmedName = name.trim();
	if (trimmedName.length === 0 || trimmedName === row.artboard.name)
		return null;
	return createUpdateArtboardCommand(
		row.artboardId,
		{ name: trimmedName },
		{ label: "Rename artboard" },
	);
}

/** Creates an undoable command for changing an artboard's authoring/export role. */
export function createSetArtboardRoleRowCommand(
	document: SceneDocument,
	row: LayerPanelArtboardRow,
	role: ArtboardRole,
): SceneCommand | null {
	return buildSetArtboardRoleRowCommand(document, row.artboardId, role);
}

/**
 * Plans an artboard duplicate and the post-command selection in one snapshot.
 * The returned command uses the preplanned id/name/position so the UI can select
 * the duplicated content without leaving source-artboard selections active.
 */
export function planDuplicateArtboardRowCommand(
	document: SceneDocument,
	row: LayerPanelArtboardRow,
	selection: ArtboardRowSelectionSnapshot,
): ArtboardRowDuplicatePlan | null {
	const plan = buildDuplicateArtboardRowCommand(
		document,
		row.artboardId,
		selection,
	);
	if (!plan.ok) return null;
	return plan;
}

/**
 * Creates a guarded remove command for an artboard row. The entity command owns
 * fallback current-artboard selection and node ownership reassignment; this
 * guard only protects the final artboard affordance before dispatch.
 */
export function createRemoveArtboardRowCommand(
	document: SceneDocument,
	row: LayerPanelArtboardRow,
): SceneCommand | null {
	return buildRemoveArtboardRowCommand(document, row.artboardId);
}

/**
 * Creates a guarded row-reorder command for non-default artboards. Default
 * artboard movement remains blocked to preserve the multi-artboard selector
 * contract that treats the default artboard as the first entry.
 */
export function createMoveArtboardRowCommand(
	document: SceneDocument,
	row: LayerPanelArtboardRow,
	direction: MoveDirection,
): SceneCommand | null {
	return buildMoveArtboardRowCommand(document, row.artboardId, direction);
}
