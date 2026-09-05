import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";

/**
 * Remaps a binding's `roleMap` through a source→instance node-id map. Entries are
 * driver/follower role assignments: keys (and node-id values) that name a source
 * node are repointed at the instance node; role-label values not in the map pass
 * through unchanged.
 */
const remapRoleMap = (
	roleMap: Readonly<Record<string, string>>,
	sourceToInstanceNodeIds: Readonly<Record<string, string>>,
): Record<string, string> => {
	const remapped: Record<string, string> = {};
	for (const [key, value] of Object.entries(roleMap)) {
		remapped[sourceToInstanceNodeIds[key] ?? key] =
			sourceToInstanceNodeIds[value] ?? value;
	}
	return remapped;
};

/**
 * Clones the motion-grammar bindings that animate a component's source subtree onto
 * one instance.
 *
 * Grammar is a third store keyed by node id (like motion tracks), so a scene-only
 * instance clone leaves any grammar-authored motion — `cyclic-path-travel`,
 * `time-delay`, etc. — pointing at the master's nodes and the instance sits still.
 * For each binding whose targets are ENTIRELY inside the source subtree we emit a
 * clone with target ids (order preserved — order IS the wavefront) and `roleMap`
 * node refs remapped through `sourceToInstanceNodeIds`. `parameters`/`seed` are
 * verbatim; path-based techniques read geometry from the (artboard-local) target
 * nodes, so no coordinate rebase is needed. `effectBinding` is also verbatim: it is
 * a type-only channel today (defaults to `none`, no resolver) whose refs are
 * effect-slot/scope handles, not scene node ids — revisit this remap if a
 * node-scoped effect resolver lands.
 *
 * Bindings spanning nodes outside the component are skipped (their remap is
 * ambiguous) — a documented Phase-1 limit. The clone id is deterministic
 * (`${sourceBindingId}::${instanceKey}`) so re-running upserts the same binding in
 * place rather than accumulating duplicates.
 * Arrangement bindings with Scene-owned snapshot ids are skipped until the Scene
 * clone path can duplicate and remap those snapshots atomically; preserving a
 * source snapshot id would otherwise silently animate the wrong identity set.
 */
export function cloneInstanceGrammarBindings(
	bindings: readonly MotionGrammarBinding[],
	sourceToInstanceNodeIds: Readonly<Record<string, string>>,
	instanceKey: string,
): readonly MotionGrammarBinding[] {
	return bindings.flatMap((binding) => {
		if (binding.targetIds.length === 0) return [];
		if (binding.arrangementMapping) return [];
		const fullyInside = binding.targetIds.every((id) =>
			Object.hasOwn(sourceToInstanceNodeIds, id),
		);
		if (!fullyInside) return [];
		return [
			{
				...binding,
				id: `${binding.id}::${instanceKey}`,
				targetIds: binding.targetIds.map((id) => sourceToInstanceNodeIds[id]),
				...(binding.roleMap
					? { roleMap: remapRoleMap(binding.roleMap, sourceToInstanceNodeIds) }
					: {}),
			},
		];
	});
}
