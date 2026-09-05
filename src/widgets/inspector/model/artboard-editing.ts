/**
 * Inspector editing for no-selection artboard CRUD (add/duplicate/remove/rename/resize/
 * background) and the standalone authored-interaction removal action.
 */
import { createRemoveInteractionCommand } from "@/entities/scene/model/interaction-commands";
import {
	createAddArtboardCommand,
	createDuplicateArtboardCommand,
	createRemoveArtboardCommand,
} from "@/entities/scene/model/node-commands";
import {
	type NormalizedArtboard,
	normalizeSceneArtboards,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Artboard, SceneDocument } from "@/entities/scene/model/types";
import {
	type ArtboardInspectorMutationAdapter,
	type ArtboardInspectorMutationPatch,
	type ArtboardInspectorNumberField,
	applySceneCommand,
	nextCommitKey,
	normalizeArtboardBackgroundInput,
	normalizeArtboardNameInput,
	normalizeArtboardNumberInput,
} from "./editing-shared";

/**
 * Validates and dispatches an artboard rename through the injected adapter.
 * Returns false for invalid, unchanged, or currently unavailable mutations.
 */
export function commitArtboardInspectorName(
	adapter: ArtboardInspectorMutationAdapter,
	artboard: NormalizedArtboard,
	input: string,
): boolean {
	const name = normalizeArtboardNameInput(input);
	if (!name || name === artboard.name) return false;
	return adapter.commit({
		artboardId: artboard.id,
		patch: { name },
		label: "Rename artboard",
		coalesceKey: nextCommitKey(`artboard:${artboard.id}:name`),
	});
}

const artboardNumberPatch = (
	artboard: NormalizedArtboard,
	field: ArtboardInspectorNumberField,
	value: number,
): ArtboardInspectorMutationPatch | null => {
	const normalized = normalizeArtboardNumberInput(field, value);
	if (normalized === null) return null;
	if (field === "x") {
		if (Object.is(normalized, artboard.position.x)) return null;
		return { position: { x: normalized } };
	}
	if (field === "y") {
		if (Object.is(normalized, artboard.position.y)) return null;
		return { position: { y: normalized } };
	}
	if (Object.is(normalized, artboard[field])) return null;
	return { [field]: normalized };
};

/**
 * Validates and dispatches an artboard position or size edit through the adapter.
 * Width and height are positive scene units; x/y are pasteboard coordinates.
 */
export function commitArtboardInspectorNumber(
	adapter: ArtboardInspectorMutationAdapter,
	artboard: NormalizedArtboard,
	field: ArtboardInspectorNumberField,
	value: number,
): boolean {
	const patch = artboardNumberPatch(artboard, field, value);
	if (!patch) return false;
	return adapter.commit({
		artboardId: artboard.id,
		patch,
		label: "Edit artboard",
		coalesceKey: nextCommitKey(`artboard:${artboard.id}:${field}`),
	});
}

/**
 * Validates and dispatches a concrete artboard background edit through the
 * adapter, preserving the scene contract that artboards have visible fills.
 */
export function commitArtboardInspectorBackground(
	adapter: ArtboardInspectorMutationAdapter,
	artboard: NormalizedArtboard,
	input: string,
	coalesceKey?: string,
): boolean {
	const background = normalizeArtboardBackgroundInput(input);
	const [primaryFill, ...extraFills] = artboard.fills ?? [];
	const alreadySolid =
		extraFills.length === 0 &&
		primaryFill?.kind === "solid" &&
		primaryFill.color === background;
	if (!background || (background === artboard.background && alreadySolid)) {
		return false;
	}
	return adapter.commit({
		artboardId: artboard.id,
		patch: { background, fills: [{ kind: "solid", color: background }] },
		label: "Edit artboard",
		// A stable per-gesture key (passed during a color drag) coalesces the
		// per-frame background writes into one undo entry; the default unique key
		// keeps discrete edits separate.
		coalesceKey:
			coalesceKey ?? nextCommitKey(`artboard:${artboard.id}:background`),
	});
}

const ARTBOARD_ADD_GAP = 80;

const nextArtboardOrdinal = (
	artboards: readonly NormalizedArtboard[],
): number => {
	const ids = new Set(artboards.map((artboard) => artboard.id));
	const names = new Set(artboards.map((artboard) => artboard.name));
	let ordinal = artboards.length + 1;
	while (ids.has(`artboard-${ordinal}`) || names.has(`Artboard ${ordinal}`)) {
		ordinal += 1;
	}
	return ordinal;
};

const rightmostArtboardEdge = (
	artboards: readonly NormalizedArtboard[],
): number =>
	artboards.reduce(
		(max, artboard) => Math.max(max, artboard.position.x + artboard.width),
		Number.NEGATIVE_INFINITY,
	);

const createInspectorArtboard = (document: SceneDocument): Artboard => {
	const { artboards, currentArtboard } = normalizeSceneArtboards(document);
	const ordinal = nextArtboardOrdinal(artboards);
	return {
		id: `artboard-${ordinal}`,
		name: `Artboard ${ordinal}`,
		position: {
			x: rightmostArtboardEdge(artboards) + ARTBOARD_ADD_GAP,
			y: currentArtboard.position.y,
		},
		width: currentArtboard.width,
		height: currentArtboard.height,
		background: currentArtboard.background,
		...(currentArtboard.fills ? { fills: currentArtboard.fills } : {}),
		fps: currentArtboard.fps,
		durationFrames: currentArtboard.durationFrames,
	};
};

const currentArtboardInsertIndex = (document: SceneDocument): number => {
	const { artboards, currentArtboard } = normalizeSceneArtboards(document);
	const currentIndex = artboards.findIndex(
		(artboard) => artboard.id === currentArtboard.id,
	);
	return currentIndex < 0 ? artboards.length : currentIndex + 1;
};

/** Adds a new artboard beside the existing pasteboard set and focuses it. */
export function commitAddArtboardFromInspector(): boolean {
	const document = useSceneStore.getState().document;
	return applySceneCommand(
		createAddArtboardCommand(createInspectorArtboard(document), {
			label: "Add artboard",
			select: true,
			toIndex: currentArtboardInsertIndex(document),
		}),
	);
}

/**
 * Duplicates the current artboard shell through the entity command. Owned node
 * cloning intentionally stays out of the inspector until the content duplicate
 * stream lands its deeper command semantics.
 */
export function commitDuplicateArtboardFromInspector(
	artboardId: string,
): boolean {
	return applySceneCommand(
		createDuplicateArtboardCommand(artboardId, {
			label: "Duplicate artboard",
			select: true,
		}),
	);
}

/**
 * Removes an artboard only when another artboard can receive focus and owned
 * nodes. The command still performs stale-id and final-artboard protection.
 */
export function commitRemoveArtboardFromInspector(artboardId: string): boolean {
	const { artboards } = normalizeSceneArtboards(
		useSceneStore.getState().document,
	);
	if (artboards.length <= 1) return false;
	return applySceneCommand(
		createRemoveArtboardCommand(artboardId, { label: "Remove artboard" }),
	);
}

/**
 * Removes one authored interaction from the document library (Interactive
 * Motion program, T3-S4 inspector listing — undoable, routed through the
 * scene command bus like every other inspector mutation in this file).
 * Missing ids are already a safe no-op in
 * `createRemoveInteractionCommand` itself.
 */
export function commitRemoveInteractionFromInspector(
	interactionId: string,
): boolean {
	return applySceneCommand(createRemoveInteractionCommand(interactionId));
}
