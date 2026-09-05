import { pruneEffectIntentFieldIdentities } from "./effect-field-identity";
import { hasEffectIntentPayload } from "./recipe-resolve";
import type {
	Artboard,
	EffectIntent,
	SceneDocument,
	ScopedEffectLook,
	VectorNode,
} from "./types";

/**
 * Target-id hygiene for object-scoped effect looks. Scoped looks (object Path
 * Blur, object noise gradient, analog-film selection) reference nodes by id
 * from scene/artboard effect-intent side-cars; node ids are never reused, so a
 * target id left behind by node removal would otherwise persist in saved
 * documents forever as invisible effect cruft. Node-removal commands prune the
 * ids they drop, and document hydration repairs already-polluted documents.
 */

const collectNodeIds = (
	nodes: readonly VectorNode[],
	output: Set<string>,
): void => {
	for (const node of nodes) {
		output.add(node.id);
		if (node.children) collectNodeIds(node.children, output);
	}
};

/** Collects every node id present in the document, including nested children. */
export const sceneDocumentNodeIds = (
	document: SceneDocument,
): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (const layer of document.layers) {
		collectNodeIds(layer.nodes, ids);
	}
	return ids;
};

/**
 * Drops matching target ids from scoped looks and removes any look whose target
 * list empties. Returns `null` when no target matches, so callers can skip no-op
 * side-car writes.
 */
export const pruneScopedLookTargets = (
	scopedLooks: readonly ScopedEffectLook[] | undefined,
	shouldDropTarget: (nodeId: string) => boolean,
): readonly ScopedEffectLook[] | null => {
	if (!scopedLooks?.some((look) => look.targetNodeIds.some(shouldDropTarget))) {
		return null;
	}
	return scopedLooks.flatMap((look): ScopedEffectLook[] => {
		const targetNodeIds = look.targetNodeIds.filter(
			(nodeId) => !shouldDropTarget(nodeId),
		);
		if (targetNodeIds.length === 0) return [];
		if (targetNodeIds.length === look.targetNodeIds.length) return [look];
		return [{ ...look, targetNodeIds }];
	});
};

/**
 * Prunes dead scoped-look targets plus object/group Effect Field targets and
 * SVG matte refs from one side-car. Returns the same reference when nothing
 * matched, and `undefined` when the pruned side-car carries no payload left.
 */
export const pruneEffectIntentScopedLookTargets = (
	intent: EffectIntent | undefined,
	shouldDropTarget: (nodeId: string) => boolean,
): EffectIntent | undefined => {
	if (!intent) return intent;
	const scopedLooks = pruneScopedLookTargets(
		intent.scopedLooks,
		shouldDropTarget,
	);
	const targetPrunedIntent = (() => {
		if (scopedLooks === null) return intent;
		if (scopedLooks.length > 0) return { ...intent, scopedLooks };
		const { scopedLooks: _omitted, ...rest } = intent;
		return hasEffectIntentPayload(rest) ? rest : undefined;
	})();
	return pruneEffectIntentFieldIdentities(targetPrunedIntent, {
		shouldRemoveTarget: (target) =>
			(target.scope === "object" || target.scope === "group") &&
			target.id !== undefined &&
			shouldDropTarget(target.id),
		shouldRemoveMatteRef: shouldDropTarget,
		removeUnreferencedFields: true,
	}).intent;
};

const sidecarHasPrunableTargets = (owner: {
	readonly effectIntent?: EffectIntent;
}): boolean =>
	(owner.effectIntent?.scopedLooks?.length ?? 0) > 0 ||
	owner.effectIntent?.influenceRecipe !== undefined;

const artboardWithPrunedScopedLookTargets = (
	artboard: Artboard,
	shouldDropTarget: (nodeId: string) => boolean,
): Artboard => {
	const effectIntent = pruneEffectIntentScopedLookTargets(
		artboard.effectIntent,
		shouldDropTarget,
	);
	if (effectIntent === artboard.effectIntent) return artboard;
	if (effectIntent) return { ...artboard, effectIntent };
	const { effectIntent: _omitted, ...rest } = artboard;
	return rest;
};

/**
 * Removes scoped-look target ids that reference nodes no longer present in the
 * document. Node-removal commands prune their own ids; this pure normalize
 * repairs documents persisted before that cleanup existed or polluted through
 * any other removal path. Returns the input document unchanged (by reference)
 * when no side-car needs repair, so hydration stays allocation-free on the
 * common clean path.
 */
export function pruneSceneDocumentScopedLookTargets(
	document: SceneDocument,
): SceneDocument {
	const hasPrunableTargets =
		sidecarHasPrunableTargets(document) ||
		sidecarHasPrunableTargets(document.artboard) ||
		(document.artboards?.some(sidecarHasPrunableTargets) ?? false);
	if (!hasPrunableTargets) return document;

	const liveNodeIds = sceneDocumentNodeIds(document);
	const shouldDropTarget = (nodeId: string): boolean =>
		!liveNodeIds.has(nodeId);

	const artboard = artboardWithPrunedScopedLookTargets(
		document.artboard,
		shouldDropTarget,
	);
	const artboards = document.artboards?.map((entry) =>
		artboardWithPrunedScopedLookTargets(entry, shouldDropTarget),
	);
	const effectIntent = pruneEffectIntentScopedLookTargets(
		document.effectIntent,
		shouldDropTarget,
	);

	const artboardsChanged =
		artboards?.some((entry, index) => entry !== document.artboards?.[index]) ??
		false;
	if (
		artboard === document.artboard &&
		!artboardsChanged &&
		effectIntent === document.effectIntent
	) {
		return document;
	}

	const next: SceneDocument = {
		...document,
		artboard,
		...(artboards ? { artboards } : {}),
	};
	if (effectIntent === document.effectIntent) return next;
	if (effectIntent) return { ...next, effectIntent };
	const { effectIntent: _omitted, ...rest } = next;
	return rest;
}
