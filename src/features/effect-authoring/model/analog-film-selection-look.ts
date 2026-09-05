import { ANALOG_FILM_LOOK_RECIPE } from "@/entities/motion-grammar/model/time-delay-materialization";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createUpdateEffectIntentCommand,
	type UpdateEffectIntentOptions,
} from "@/entities/scene/model/node-commands";
import {
	findArtboardById,
	findNode,
	flattenRenderableNodes,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Artboard,
	SceneDocument,
	ScopedEffectLook,
	VisualRecipeScopedEffectLook,
} from "@/entities/scene/model/types";
import {
	type EffectInfluenceRecipe,
	type EffectMaskSource,
	normalizeEffectInfluenceRecipe,
} from "@/shared/vec-core";

const ANALOG_FILM_SELECTION_ASSIGNMENT_ID =
	"inspector-analog-film-selection-mask";
const ANALOG_FILM_SELECTION_LOOK_ID = "inspector-analog-film-selection";

const ANALOG_FILM_SELECTION_FALLOFF = {
	kind: "linear",
	inputMin: 0,
	inputMax: 1,
	gamma: 1,
	softness: 0,
} as const;

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const applyCommandsAsTransaction = (
	scope: string,
	label: string,
	commands: readonly SceneCommand[],
	coalesceKey?: string,
): boolean => {
	const store = useSceneStore.getState();
	const before = store.document;
	store.beginTransaction(coalesceKey ?? scope, label);
	for (const command of commands) {
		useSceneStore.getState().apply(command);
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
};

const nodeIdsByArtboard = (
	document: SceneDocument,
	nodeIds: readonly string[],
): ReadonlyMap<string, readonly string[]> => {
	const nodeOrder = new Map(
		flattenRenderableNodes(document).map(({ node }, index) => [node.id, index]),
	);
	const idsByArtboard = new Map<string, string[]>();
	for (const nodeId of [...uniqueNodeIds(nodeIds)].sort(
		(left, right) =>
			(nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
			(nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
	)) {
		const node = findNode(document, nodeId);
		if (!node) continue;
		const artboardId = selectArtboardIdForNode(document, node.id);
		if (!artboardId) continue;
		const ids = idsByArtboard.get(artboardId) ?? [];
		ids.push(node.id);
		idsByArtboard.set(artboardId, ids);
	}
	return idsByArtboard;
};

const isAnalogFilmSelectionScopedLook = (
	look: ScopedEffectLook,
): look is VisualRecipeScopedEffectLook =>
	look.id === ANALOG_FILM_SELECTION_LOOK_ID &&
	look.source === "analog-film-selection" &&
	look.kind === "visual-recipe-overlay";

const selectionMatteSource = (nodeIds: readonly string[]): EffectMaskSource => {
	if (nodeIds.length === 1) {
		return {
			kind: "svgMatte",
			space: "target",
			refId: nodeIds[0],
			alphaMode: "alpha",
		};
	}
	return {
		kind: "stack",
		space: "target",
		items: nodeIds.map((nodeId, index) => ({
			id: `selection-${nodeId}`,
			label: "Selection",
			combineMode: index === 0 ? "replace" : "add",
			enabled: true,
			source: {
				kind: "svgMatte",
				space: "target",
				refId: nodeId,
				alphaMode: "alpha",
			},
			strength: 1,
			invert: false,
			featherRadius: 0,
			falloff: ANALOG_FILM_SELECTION_FALLOFF,
		})),
	};
};

const analogFilmSelectionInfluenceRecipe = (
	nodeIds: readonly string[],
): EffectInfluenceRecipe =>
	normalizeEffectInfluenceRecipe({
		enabled: true,
		assignments: [
			{
				id: ANALOG_FILM_SELECTION_ASSIGNMENT_ID,
				label: "Selection mask",
				target: { scope: "scene" },
				effect: {
					id: ANALOG_FILM_LOOK_RECIPE.id,
					path: "recipe",
					label: ANALOG_FILM_LOOK_RECIPE.label,
				},
				influence: {
					enabled: true,
					source: selectionMatteSource(nodeIds),
					strength: 1,
					invert: false,
					featherRadius: 0,
					falloff: ANALOG_FILM_SELECTION_FALLOFF,
				},
			},
		],
	});

const analogFilmSelectionScopedLook = (
	nodeIds: readonly string[],
): VisualRecipeScopedEffectLook => ({
	id: ANALOG_FILM_SELECTION_LOOK_ID,
	kind: "visual-recipe-overlay",
	source: "analog-film-selection",
	visualRecipe: ANALOG_FILM_LOOK_RECIPE,
	targetNodeIds: nodeIds,
	influenceRecipe: analogFilmSelectionInfluenceRecipe(nodeIds),
});

const replaceAnalogFilmSelectionScopedLook = (
	current: readonly ScopedEffectLook[] | undefined,
	next: VisualRecipeScopedEffectLook,
): readonly ScopedEffectLook[] => [
	...(current ?? []).filter((look) => !isAnalogFilmSelectionScopedLook(look)),
	next,
];

const hasLegacyAnalogFilmSelectionFrameLook = (
	effectIntent: Artboard["effectIntent"],
): boolean =>
	Boolean(
		effectIntent?.visualRecipe?.id === ANALOG_FILM_LOOK_RECIPE.id &&
			effectIntent.influenceRecipe?.assignments.some(
				(assignment) => assignment.id === ANALOG_FILM_SELECTION_ASSIGNMENT_ID,
			),
	);

export type AnalogFilmNodeLookSelectionState = {
	readonly status: "none" | "partial" | "all";
	readonly selectedCount: number;
	readonly appliedCount: number;
};

/**
 * Applies the canonical frame-level Analog Film pass, then masks that pass to
 * selected object silhouettes. The command writes artboard `scopedLooks`, so the
 * object workflow stays on the same optical renderer as broad frame Looks while
 * keeping node-local material recipes unchanged.
 */
export function commitAnalogFilmNodeLook(nodeIds: readonly string[]): boolean {
	const document = useSceneStore.getState().document;
	const idsByArtboard = nodeIdsByArtboard(document, nodeIds);

	const commands = [...idsByArtboard.entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			if (!artboard) return [];
			const scopedLook = analogFilmSelectionScopedLook(artboardNodeIds);
			const scopedLooks = replaceAnalogFilmSelectionScopedLook(
				artboard.effectIntent?.scopedLooks,
				scopedLook,
			);
			const clearsLegacyFrameLook = hasLegacyAnalogFilmSelectionFrameLook(
				artboard.effectIntent,
			);
			if (
				sameSerializable(artboard.effectIntent?.scopedLooks, scopedLooks) &&
				!clearsLegacyFrameLook
			) {
				return [];
			}
			const options: UpdateEffectIntentOptions = {
				label: "Apply Analog Film",
				coalesceKey: `frame-look:analog-film-selection:${artboardId}`,
			};
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{
						...(clearsLegacyFrameLook
							? { visualRecipe: null, influenceRecipe: null }
							: {}),
						scopedLooks,
					},
					options,
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`frame-look:analog-film-selection:${uniqueNodeIds(nodeIds).join(",")}`,
		"Apply Analog Film",
		commands,
	);
}

/**
 * Reports how much of the selected object set is covered by the Analog Film
 * scoped overlay. This deliberately reads artboard `scopedLooks` rather than
 * node recipes so UI callers do not confuse object material edits with frame
 * optical overlays.
 */
export function analogFilmNodeLookStateForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): AnalogFilmNodeLookSelectionState {
	let selectedCount = 0;
	let appliedCount = 0;

	for (const [artboardId, artboardNodeIds] of nodeIdsByArtboard(
		document,
		nodeIds,
	)) {
		const artboard = findArtboardById(document, artboardId);
		if (!artboard) continue;
		selectedCount += artboardNodeIds.length;
		const scopedLook = artboard.effectIntent?.scopedLooks?.find(
			isAnalogFilmSelectionScopedLook,
		);
		if (!scopedLook) continue;
		const targetIds = new Set(scopedLook.targetNodeIds);
		appliedCount += artboardNodeIds.filter((nodeId) =>
			targetIds.has(nodeId),
		).length;
	}

	return {
		status:
			appliedCount === 0
				? "none"
				: appliedCount === selectedCount
					? "all"
					: "partial",
		selectedCount,
		appliedCount,
	};
}

/**
 * Removes the selected-object Analog Film scoped overlay from only the selected
 * node ids. Other scoped looks and broad frame visual/influence intent are
 * preserved so object unapply cannot erase a full-frame Look.
 */
export function commitRemoveAnalogFilmNodeLook(
	nodeIds: readonly string[],
): boolean {
	const document = useSceneStore.getState().document;
	const idsByArtboard = nodeIdsByArtboard(document, nodeIds);
	const commands = [...idsByArtboard.entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			const scopedLooks = artboard?.effectIntent?.scopedLooks;
			if (!artboard || !scopedLooks?.length) return [];

			const selectedIds = new Set(artboardNodeIds);
			let changed = false;
			const nextScopedLooks: ScopedEffectLook[] = scopedLooks.flatMap(
				(look): ScopedEffectLook[] => {
					if (!isAnalogFilmSelectionScopedLook(look)) return [look];
					const remainingTargetNodeIds = look.targetNodeIds.filter(
						(nodeId) => !selectedIds.has(nodeId),
					);
					if (remainingTargetNodeIds.length === look.targetNodeIds.length) {
						return [look];
					}
					changed = true;
					return remainingTargetNodeIds.length > 0
						? [analogFilmSelectionScopedLook(remainingTargetNodeIds)]
						: [];
				},
			);

			if (!changed) return [];
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{ scopedLooks: nextScopedLooks.length > 0 ? nextScopedLooks : null },
					{
						label: "Remove Analog Film",
						coalesceKey: `frame-look:analog-film-selection-remove:${artboardId}`,
					},
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`frame-look:analog-film-selection-remove:${uniqueNodeIds(nodeIds).join(",")}`,
		"Remove Analog Film",
		commands,
	);
}
