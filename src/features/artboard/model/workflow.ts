import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createAddArtboardCommand,
	createDuplicateArtboardCommand,
	createRemoveArtboardCommand,
	createReorderArtboardCommand,
	createSetCurrentArtboardCommand,
	createUpdateArtboardCommand,
	type DuplicateArtboardOptions,
	planAddArtboard,
	planDuplicateArtboard,
	planDuplicateArtboardSelection,
} from "@/entities/scene/model/node-commands";
import {
	findArtboardById,
	normalizeArtboardRole,
	selectAllArtboards,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type {
	Artboard,
	ArtboardRole,
	Bounds,
	SceneDocument,
	Vec2,
} from "@/entities/scene/model/types";

export const ARTBOARD_CREATION_PRESETS = [
	{
		id: "desktop",
		name: "Desktop",
		width: 1440,
		height: 1024,
	},
	{
		id: "presentation-16-9",
		name: "Presentation 16:9",
		width: 1920,
		height: 1080,
	},
	{
		id: "mobile",
		name: "Mobile",
		width: 390,
		height: 844,
	},
	{
		id: "square",
		name: "Square",
		width: 1080,
		height: 1080,
	},
] as const;

export type ArtboardCreationPreset = (typeof ARTBOARD_CREATION_PRESETS)[number];

export type ArtboardCreationPresetId = ArtboardCreationPreset["id"];

export type ArtboardWorkflowOperation =
	| "create-artboard"
	| "duplicate-artboard"
	| "focus-artboard";

export type ArtboardWorkflowIssueCode =
	| "artboard.already-current"
	| "artboard.invalid-bounds"
	| "artboard.missing-artboard"
	| "artboard.missing-selection"
	| "artboard.unknown-preset";

export type ArtboardWorkflowIssue = {
	readonly code: ArtboardWorkflowIssueCode;
	readonly message: string;
	readonly operation: ArtboardWorkflowOperation;
	readonly severity: "error";
	readonly artboardId?: string;
	readonly presetId?: string;
};

export type ArtboardSelectionTarget = {
	readonly selectedArtboardId: string | null;
	readonly currentArtboardId: string | null;
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type CreateArtboardWorkflowSuccess = {
	readonly ok: true;
	readonly operation: "create-artboard";
	readonly artboardId: string;
	readonly artboard: Artboard;
	readonly bounds: Bounds;
	readonly command: SceneCommand;
	readonly selection: ArtboardSelectionTarget;
	readonly issues: readonly ArtboardWorkflowIssue[];
};

export type DuplicateArtboardWorkflowSuccess = {
	readonly ok: true;
	readonly operation: "duplicate-artboard";
	readonly sourceArtboardId: string;
	readonly duplicateArtboardId: string;
	readonly duplicateArtboard: Artboard;
	readonly command: SceneCommand;
	readonly selection: ArtboardSelectionTarget;
	readonly issues: readonly ArtboardWorkflowIssue[];
};

export type DuplicateArtboardRowSelectionSnapshot = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type DuplicateArtboardRowWorkflowSuccess = {
	readonly ok: true;
	readonly operation: "duplicate-artboard";
	readonly sourceArtboardId: string;
	readonly duplicateArtboardId: string;
	readonly command: SceneCommand;
	readonly selectNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly issues: readonly ArtboardWorkflowIssue[];
};

export type FocusArtboardWorkflowSuccess = {
	readonly ok: true;
	readonly operation: "focus-artboard";
	readonly artboardId: string;
	readonly command: SceneCommand;
	readonly selection: ArtboardSelectionTarget;
	readonly issues: readonly ArtboardWorkflowIssue[];
};

export type FocusArtboardRowSelectionSnapshot = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
};

export type FocusArtboardRowSelectionPlan = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
};

export type FocusArtboardRowWorkflowSuccess = {
	readonly ok: true;
	readonly operation: "focus-artboard";
	readonly artboardId: string;
	readonly command: SceneCommand;
	readonly selection: FocusArtboardRowSelectionPlan | null;
	readonly issues: readonly ArtboardWorkflowIssue[];
};

export type ArtboardWorkflowFailure = {
	readonly ok: false;
	readonly operation: ArtboardWorkflowOperation;
	readonly issues: readonly ArtboardWorkflowIssue[];
};

export type CreateArtboardWorkflowResult =
	| CreateArtboardWorkflowSuccess
	| ArtboardWorkflowFailure;

export type DuplicateArtboardWorkflowResult =
	| DuplicateArtboardWorkflowSuccess
	| ArtboardWorkflowFailure;

export type DuplicateArtboardRowWorkflowResult =
	| DuplicateArtboardRowWorkflowSuccess
	| ArtboardWorkflowFailure;

export type FocusArtboardWorkflowResult =
	| FocusArtboardWorkflowSuccess
	| ArtboardWorkflowFailure;

export type FocusArtboardRowWorkflowResult =
	| FocusArtboardRowWorkflowSuccess
	| ArtboardWorkflowFailure;

export type CreateArtboardFromBoundsOptions = {
	readonly idBase?: string;
	readonly name?: string;
	readonly background?: string;
	readonly fps?: number;
	readonly durationFrames?: number;
	readonly toIndex?: number;
	readonly select?: boolean;
	readonly label?: string;
};

export type CreateArtboardFromPresetOptions = Omit<
	CreateArtboardFromBoundsOptions,
	"name"
> & {
	readonly name?: string;
	readonly position?: Vec2;
};

export type DuplicateSelectedArtboardOptions = Pick<
	DuplicateArtboardOptions,
	"duplicateContents" | "label" | "select"
>;

export type ArtboardRowMoveDirection = "up" | "down";

const issue = (
	operation: ArtboardWorkflowOperation,
	code: ArtboardWorkflowIssueCode,
	message: string,
	location: {
		readonly artboardId?: string;
		readonly presetId?: string;
	} = {},
): ArtboardWorkflowIssue => ({
	code,
	message,
	operation,
	severity: "error",
	...location,
});

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const normalizeDragBounds = (bounds: Bounds): Bounds | null => {
	const right = bounds.x + bounds.width;
	const bottom = bounds.y + bounds.height;
	if (
		!isFiniteNumber(bounds.x) ||
		!isFiniteNumber(bounds.y) ||
		!isFiniteNumber(right) ||
		!isFiniteNumber(bottom)
	) {
		return null;
	}

	const x = Math.min(bounds.x, right);
	const y = Math.min(bounds.y, bottom);
	const width = Math.abs(bounds.width);
	const height = Math.abs(bounds.height);
	if (width <= 0 || height <= 0) return null;
	return { x, y, width, height };
};

const insertIndexAfterCurrentArtboard = (document: SceneDocument): number => {
	const artboards = selectAllArtboards(document);
	const currentArtboardId = selectCurrentArtboard(document).id;
	const currentIndex = artboards.findIndex(
		(artboard) => artboard.id === currentArtboardId,
	);
	return currentIndex < 0 ? artboards.length : currentIndex + 1;
};

const selectionForArtboard = (
	document: SceneDocument,
	artboardId: string,
	focusesArtboard: boolean,
): ArtboardSelectionTarget => ({
	selectedArtboardId: artboardId,
	currentArtboardId: focusesArtboard
		? artboardId
		: selectCurrentArtboard(document).id,
	nodeIds: [],
	primaryNodeId: null,
});

const presetById = (
	presetId: ArtboardCreationPresetId,
): ArtboardCreationPreset | undefined =>
	ARTBOARD_CREATION_PRESETS.find((preset) => preset.id === presetId);

const positionDelta = (from: Vec2, to: Vec2): Vec2 => ({
	x: to.x - from.x,
	y: to.y - from.y,
});

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const primaryForNodeSelection = (
	nodeIds: readonly string[],
	primaryNodeId: string | null | undefined,
): string | null => {
	if (primaryNodeId && nodeIds.includes(primaryNodeId)) return primaryNodeId;
	return nodeIds.at(-1) ?? null;
};

const focusRowSelectionPlan = (
	nodeIds: readonly string[],
	primaryNodeId?: string | null,
): FocusArtboardRowSelectionPlan => {
	const unique = uniqueNodeIds(nodeIds);
	return {
		nodeIds: unique,
		primaryNodeId: primaryForNodeSelection(unique, primaryNodeId),
	};
};

/**
 * Normalizes a drag rectangle from the future frame/artboard tool into
 * pasteboard-space artboard bounds. Negative drags are allowed, but zero,
 * infinite, and NaN dimensions are rejected so UI bridges can avoid dispatching
 * inert command-bus entries.
 */
export function normalizeArtboardCreationBounds(bounds: Bounds): Bounds | null {
	return normalizeDragBounds(bounds);
}

/**
 * Plans a command-backed artboard creation from a pasteboard drag rectangle.
 * This is the domain seam UX7 can call from CanvasShell without knowing
 * artboard id/name collision rules or insertion ordering.
 */
export function buildCreateArtboardFromBoundsCommand(
	document: SceneDocument,
	bounds: Bounds,
	options: CreateArtboardFromBoundsOptions = {},
): CreateArtboardWorkflowResult {
	const normalizedBounds = normalizeArtboardCreationBounds(bounds);
	if (!normalizedBounds) {
		return {
			ok: false,
			operation: "create-artboard",
			issues: [
				issue(
					"create-artboard",
					"artboard.invalid-bounds",
					"Artboard creation needs finite non-zero bounds.",
				),
			],
		};
	}

	const plan = planAddArtboard(document, {
		id: options.idBase ?? "artboard",
		name: options.name ?? "Artboard",
		position: { x: normalizedBounds.x, y: normalizedBounds.y },
		width: normalizedBounds.width,
		height: normalizedBounds.height,
		background: options.background,
		fps: options.fps,
		durationFrames: options.durationFrames,
		toIndex: options.toIndex ?? insertIndexAfterCurrentArtboard(document),
	});
	if (!plan) {
		return {
			ok: false,
			operation: "create-artboard",
			issues: [
				issue(
					"create-artboard",
					"artboard.invalid-bounds",
					"Artboard creation could not produce a valid scene artboard.",
				),
			],
		};
	}

	const focusesArtboard = options.select ?? true;
	return {
		ok: true,
		operation: "create-artboard",
		artboardId: plan.artboard.id,
		artboard: plan.artboard,
		bounds: normalizedBounds,
		command: createAddArtboardCommand(plan.artboard, {
			label: options.label ?? "Create artboard",
			select: focusesArtboard,
			toIndex: plan.toIndex,
		}),
		selection: selectionForArtboard(
			document,
			plan.artboard.id,
			focusesArtboard,
		),
		issues: [],
	};
}

/**
 * Plans a preset artboard creation using the same add-artboard command path as
 * drag creation. Omitted positions use the entity planner's current-artboard
 * placement rule; explicit positions let menu/UI bridges create at the cursor.
 */
export function buildCreateArtboardFromPresetCommand(
	document: SceneDocument,
	presetId: ArtboardCreationPresetId,
	options: CreateArtboardFromPresetOptions = {},
): CreateArtboardWorkflowResult {
	const preset = presetById(presetId);
	if (!preset) {
		return {
			ok: false,
			operation: "create-artboard",
			issues: [
				issue(
					"create-artboard",
					"artboard.unknown-preset",
					"Requested artboard preset does not exist.",
					{ presetId },
				),
			],
		};
	}

	const plan = planAddArtboard(document, {
		id: options.idBase ?? `artboard-${preset.id}`,
		name: options.name ?? preset.name,
		position: options.position,
		width: preset.width,
		height: preset.height,
		background: options.background,
		fps: options.fps,
		durationFrames: options.durationFrames,
		toIndex: options.toIndex ?? insertIndexAfterCurrentArtboard(document),
	});
	if (!plan) {
		return {
			ok: false,
			operation: "create-artboard",
			issues: [
				issue(
					"create-artboard",
					"artboard.invalid-bounds",
					"Artboard preset could not produce a valid scene artboard.",
					{ presetId },
				),
			],
		};
	}

	const focusesArtboard = options.select ?? true;
	const bounds = {
		x: plan.artboard.position?.x ?? 0,
		y: plan.artboard.position?.y ?? 0,
		width: plan.artboard.width,
		height: plan.artboard.height,
	};
	return {
		ok: true,
		operation: "create-artboard",
		artboardId: plan.artboard.id,
		artboard: plan.artboard,
		bounds,
		command: createAddArtboardCommand(plan.artboard, {
			label: options.label ?? `Create ${preset.name} artboard`,
			select: focusesArtboard,
			toIndex: plan.toIndex,
		}),
		selection: selectionForArtboard(
			document,
			plan.artboard.id,
			focusesArtboard,
		),
		issues: [],
	};
}

/**
 * Converts the canvas-selected artboard id into an undoable current-artboard
 * focus command. Selection stays ephemeral; only `currentArtboardId` is written
 * through the scene command bus.
 */
export function buildFocusSelectedArtboardCommand(
	document: SceneDocument,
	selectedArtboardId: string | null,
): FocusArtboardWorkflowResult {
	if (!selectedArtboardId) {
		return {
			ok: false,
			operation: "focus-artboard",
			issues: [
				issue(
					"focus-artboard",
					"artboard.missing-selection",
					"Focus artboard needs a selected artboard.",
				),
			],
		};
	}

	const artboard = findArtboardById(document, selectedArtboardId);
	if (!artboard) {
		return {
			ok: false,
			operation: "focus-artboard",
			issues: [
				issue(
					"focus-artboard",
					"artboard.missing-artboard",
					"Selected artboard is no longer in the scene.",
					{ artboardId: selectedArtboardId },
				),
			],
		};
	}

	if (selectCurrentArtboard(document).id === artboard.id) {
		return {
			ok: false,
			operation: "focus-artboard",
			issues: [
				issue(
					"focus-artboard",
					"artboard.already-current",
					"Selected artboard is already current.",
					{ artboardId: artboard.id },
				),
			],
		};
	}

	return {
		ok: true,
		operation: "focus-artboard",
		artboardId: artboard.id,
		command: createSetCurrentArtboardCommand(artboard.id, {
			label: "Focus artboard",
		}),
		selection: selectionForArtboard(document, artboard.id, true),
		issues: [],
	};
}

/**
 * Plans a Layers-row artboard focus gesture, including additive whole-artboard
 * selection toggling. The scene command writes only current-artboard state; node
 * selection remains an explicit UI plan returned to the caller.
 */
export function buildFocusArtboardRowCommand({
	artboardId,
	subtreeNodeIds,
	selection,
	additive,
}: {
	readonly artboardId: string;
	readonly subtreeNodeIds: readonly string[];
	readonly selection: FocusArtboardRowSelectionSnapshot;
	readonly additive: boolean;
}): FocusArtboardRowWorkflowSuccess {
	const command = createSetCurrentArtboardCommand(artboardId, {
		label: "Set current artboard",
	});
	if (subtreeNodeIds.length === 0) {
		return {
			ok: true,
			operation: "focus-artboard",
			artboardId,
			command,
			selection: additive ? null : { nodeIds: [], primaryNodeId: null },
			issues: [],
		};
	}

	if (!additive) {
		return {
			ok: true,
			operation: "focus-artboard",
			artboardId,
			command,
			selection: focusRowSelectionPlan(subtreeNodeIds),
			issues: [],
		};
	}

	const selectedNodeSet = new Set(selection.nodeIds);
	const artboardNodeIds = new Set(subtreeNodeIds);
	const everyNodeSelected = subtreeNodeIds.every((nodeId) =>
		selectedNodeSet.has(nodeId),
	);
	const nodeIds = everyNodeSelected
		? selection.nodeIds.filter((nodeId) => !artboardNodeIds.has(nodeId))
		: [
				...selection.nodeIds,
				...subtreeNodeIds.filter((nodeId) => !selectedNodeSet.has(nodeId)),
			];

	return {
		ok: true,
		operation: "focus-artboard",
		artboardId,
		command,
		selection: focusRowSelectionPlan(nodeIds),
		issues: [],
	};
}

/**
 * Plans a guarded Layers-row artboard remove command. The feature owns the
 * "last artboard" guard so UI rows do not become the source of truth for whether
 * destructive artboard actions are available.
 */
export function buildRemoveArtboardRowCommand(
	document: SceneDocument,
	artboardId: string,
): SceneCommand | null {
	if (selectAllArtboards(document).length <= 1) return null;
	if (!findArtboardById(document, artboardId)) return null;
	return createRemoveArtboardCommand(artboardId);
}

/**
 * Plans an artboard authoring/export role change. No-op requests are filtered in
 * the feature workflow so row UI, command palettes, and future bars can share the
 * same role semantics.
 */
export function buildSetArtboardRoleRowCommand(
	document: SceneDocument,
	artboardId: string,
	role: ArtboardRole,
): SceneCommand | null {
	const artboard = findArtboardById(document, artboardId);
	if (!artboard) return null;
	if (normalizeArtboardRole(artboard) === role) return null;
	return createUpdateArtboardCommand(
		artboardId,
		{ role },
		{ label: "Set artboard role" },
	);
}

/**
 * Creates a guarded one-step artboard row reorder command. The default artboard
 * is kept fixed at index 0 so layer-tree ordering stays aligned with the
 * multi-artboard selector contract.
 */
export function buildMoveArtboardRowCommand(
	document: SceneDocument,
	artboardId: string,
	direction: ArtboardRowMoveDirection,
): SceneCommand | null {
	const artboards = selectAllArtboards(document);
	const artboardIndex = artboards.findIndex(
		(artboard) => artboard.id === artboardId,
	);
	if (artboardIndex < 0) return null;
	const targetIndex =
		direction === "up" ? artboardIndex - 1 : artboardIndex + 1;
	const canMove =
		direction === "up"
			? artboardIndex > 1
			: artboardIndex > 0 && artboardIndex < artboards.length - 1;
	if (!canMove) return null;
	return createReorderArtboardCommand(artboardId, targetIndex);
}

/**
 * Plans an undoable duplicate for the canvas-selected artboard. The returned
 * selected-artboard target lets a future Layers/Canvas bridge select the new
 * artboard without guessing the entity planner's collision suffixes.
 */
export function buildDuplicateSelectedArtboardCommand(
	document: SceneDocument,
	selectedArtboardId: string | null,
	options: DuplicateSelectedArtboardOptions = {},
): DuplicateArtboardWorkflowResult {
	if (!selectedArtboardId) {
		return {
			ok: false,
			operation: "duplicate-artboard",
			issues: [
				issue(
					"duplicate-artboard",
					"artboard.missing-selection",
					"Duplicate artboard needs a selected artboard.",
				),
			],
		};
	}

	const source = findArtboardById(document, selectedArtboardId);
	if (!source) {
		return {
			ok: false,
			operation: "duplicate-artboard",
			issues: [
				issue(
					"duplicate-artboard",
					"artboard.missing-artboard",
					"Selected artboard is no longer in the scene.",
					{ artboardId: selectedArtboardId },
				),
			],
		};
	}

	const plan = planDuplicateArtboard(document, source.id, {
		duplicateContents: options.duplicateContents,
		select: options.select,
	});
	if (!plan) {
		return {
			ok: false,
			operation: "duplicate-artboard",
			issues: [
				issue(
					"duplicate-artboard",
					"artboard.missing-artboard",
					"Selected artboard could not be duplicated.",
					{ artboardId: selectedArtboardId },
				),
			],
		};
	}

	const duplicatePosition = plan.duplicate.position ?? source.position;
	const focusesArtboard = options.select ?? true;
	return {
		ok: true,
		operation: "duplicate-artboard",
		sourceArtboardId: source.id,
		duplicateArtboardId: plan.duplicate.id,
		duplicateArtboard: plan.duplicate,
		command: createDuplicateArtboardCommand(source.id, {
			id: plan.duplicate.id,
			name: plan.duplicate.name,
			toIndex: plan.toIndex,
			offset: positionDelta(source.position, duplicatePosition),
			duplicateContents: options.duplicateContents,
			label: options.label ?? "Duplicate artboard",
			select: focusesArtboard,
		}),
		selection: selectionForArtboard(
			document,
			plan.duplicate.id,
			focusesArtboard,
		),
		issues: [],
	};
}

/**
 * Plans a Layers-row artboard duplicate and the post-command node selection in
 * one snapshot. Unlike canvas artboard duplicate, this keeps selected duplicated
 * contents active so the Layers workflow does not leave source selections behind.
 */
export function buildDuplicateArtboardRowCommand(
	document: SceneDocument,
	artboardId: string,
	selection: DuplicateArtboardRowSelectionSnapshot,
): DuplicateArtboardRowWorkflowResult {
	const source = findArtboardById(document, artboardId);
	if (!source) {
		return {
			ok: false,
			operation: "duplicate-artboard",
			issues: [
				issue(
					"duplicate-artboard",
					"artboard.missing-artboard",
					"Selected artboard is no longer in the scene.",
					{ artboardId },
				),
			],
		};
	}

	const plan = planDuplicateArtboard(document, source.id);
	if (!plan) {
		return {
			ok: false,
			operation: "duplicate-artboard",
			issues: [
				issue(
					"duplicate-artboard",
					"artboard.missing-artboard",
					"Selected artboard could not be duplicated.",
					{ artboardId },
				),
			],
		};
	}

	const selectionPlan = planDuplicateArtboardSelection(
		document,
		source.id,
		plan.contents,
		selection,
	);
	const duplicatePosition = plan.duplicate.position ?? source.position;
	return {
		ok: true,
		operation: "duplicate-artboard",
		sourceArtboardId: source.id,
		duplicateArtboardId: plan.duplicate.id,
		command: createDuplicateArtboardCommand(source.id, {
			id: plan.duplicate.id,
			name: plan.duplicate.name,
			toIndex: plan.toIndex,
			offset: positionDelta(source.position, duplicatePosition),
		}),
		selectNodeIds: selectionPlan.nodeIds,
		primaryNodeId: selectionPlan.primaryNodeId,
		issues: [],
	};
}
