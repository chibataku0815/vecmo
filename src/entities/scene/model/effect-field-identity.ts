import {
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	type EffectMaskSource,
	type EffectTargetRef,
	normalizeEffectInfluenceRecipe,
} from "@/shared/vec-core";
import type { EffectIntent, ScopedEffectLook } from "./types";

export type EffectFieldIdentityRemap = {
	readonly assignmentIds?: ReadonlyMap<string, string>;
	readonly fieldIds?: ReadonlyMap<string, string>;
	readonly targetIds?: ReadonlyMap<string, string>;
	readonly effectSlotIds?: ReadonlyMap<string, string>;
	readonly matteRefIds?: ReadonlyMap<string, string>;
	readonly stackItemIds?: ReadonlyMap<string, string>;
};

export type EffectFieldIdentityIssue = {
	readonly code:
		| "duplicate-assignment-id"
		| "duplicate-field-id"
		| "missing-field-reference"
		| "missing-target"
		| "missing-matte-ref";
	readonly id: string;
};

export type EffectFieldIdentityResult = {
	readonly recipe: EffectInfluenceRecipe;
	readonly issues: readonly EffectFieldIdentityIssue[];
};

export type EffectIntentFieldIdentityResult = {
	readonly intent: EffectIntent | undefined;
	readonly issues: readonly EffectFieldIdentityIssue[];
};

const remapped = (
	id: string,
	map: ReadonlyMap<string, string> | undefined,
): string => map?.get(id) ?? id;

const remapSource = (
	source: EffectMaskSource,
	remap: EffectFieldIdentityRemap,
): EffectMaskSource => {
	switch (source.kind) {
		case "svgMatte":
			return {
				...source,
				refId: remapped(source.refId, remap.matteRefIds),
			};
		case "stack":
			return {
				...source,
				items: source.items.map((item) => ({
					...item,
					id: remapped(item.id, remap.stackItemIds),
					source: remapSource(item.source, remap),
				})),
			};
		default:
			return source;
	}
};

const duplicateIssues = (
	values: readonly string[],
	code: "duplicate-assignment-id" | "duplicate-field-id",
): readonly EffectFieldIdentityIssue[] => {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].flatMap(([id, count]) =>
		count > 1 ? [{ code, id }] : [],
	);
};

/**
 * Remaps every identity-bearing seam used by Effect Fields. Collisions remain
 * represented and are reported; no duplicate silently wins during copy/paste.
 */
export function remapEffectFieldRecipeIdentities(
	recipeDraft: EffectInfluenceRecipeDraft | EffectInfluenceRecipe,
	remap: EffectFieldIdentityRemap,
): EffectFieldIdentityResult {
	const recipe = normalizeEffectInfluenceRecipe(recipeDraft);
	const fields = recipe.fields?.map((field) => ({
		...field,
		id: remapped(field.id, remap.fieldIds),
		source: remapSource(field.source, remap),
	}));
	const assignments = recipe.assignments.map((assignment) => ({
		...assignment,
		id: remapped(assignment.id, remap.assignmentIds),
		...(assignment.fieldId
			? { fieldId: remapped(assignment.fieldId, remap.fieldIds) }
			: {}),
		target: assignment.target.id
			? {
					scope: assignment.target.scope,
					id: remapped(assignment.target.id, remap.targetIds),
				}
			: assignment.target,
		effect: {
			...assignment.effect,
			id: remapped(assignment.effect.id, remap.effectSlotIds),
		},
		influence: {
			...assignment.influence,
			source: remapSource(assignment.influence.source, remap),
		},
	}));
	const normalized = normalizeEffectInfluenceRecipe({
		enabled: recipe.enabled,
		assignments,
		...(fields && fields.length > 0 ? { fields } : {}),
	});
	return {
		recipe: normalized,
		issues: [
			...duplicateIssues(
				normalized.assignments.map((assignment) => assignment.id),
				"duplicate-assignment-id",
			),
			...duplicateIssues(
				(normalized.fields ?? []).map((field) => field.id),
				"duplicate-field-id",
			),
		],
	};
}

export type PruneEffectFieldRecipeOptions = {
	readonly validTargetIds?: ReadonlySet<string>;
	readonly validMatteRefIds?: ReadonlySet<string>;
	readonly shouldRemoveTarget?: (target: EffectTargetRef) => boolean;
	readonly shouldRemoveMatteRef?: (refId: string) => boolean;
	/** Remove a field only when this prune removed its final assignment reference. */
	readonly removeUnreferencedFields?: boolean;
};

const pruneSource = (
	source: EffectMaskSource,
	options: Pick<
		PruneEffectFieldRecipeOptions,
		"shouldRemoveMatteRef" | "validMatteRefIds"
	>,
	issues: EffectFieldIdentityIssue[],
): EffectMaskSource | null => {
	if (source.kind === "svgMatte") {
		const invalidBySet =
			options.validMatteRefIds !== undefined &&
			!options.validMatteRefIds.has(source.refId);
		if (
			!invalidBySet &&
			!(options.shouldRemoveMatteRef?.(source.refId) ?? false)
		) {
			return source;
		}
		issues.push({ code: "missing-matte-ref", id: source.refId });
		return null;
	}
	if (source.kind !== "stack") return source;
	const items = source.items.flatMap((item) => {
		const child = pruneSource(item.source, options, issues);
		return child ? [{ ...item, source: child }] : [];
	});
	return items.length > 0 ? { ...source, items } : null;
};

/**
 * Prunes stale target and matte references after deletion. Linked assignments
 * retain their inline source when only the shared definition disappears, so a
 * later compiler can use the explicit compatibility fallback and report it.
 */
export function pruneEffectFieldRecipeIdentities(
	recipeDraft: EffectInfluenceRecipeDraft | EffectInfluenceRecipe,
	options: PruneEffectFieldRecipeOptions,
): EffectFieldIdentityResult {
	const recipe = normalizeEffectInfluenceRecipe(recipeDraft);
	const issues: EffectFieldIdentityIssue[] = [];
	const fieldsReferencedByRemovedAssignments = new Set<string>();
	const fields = (recipe.fields ?? []).flatMap((field) => {
		const source = pruneSource(field.source, options, issues);
		return source ? [{ ...field, source }] : [];
	});
	const assignments = recipe.assignments.flatMap((assignment) => {
		if (
			(options.shouldRemoveTarget?.(assignment.target) ?? false) ||
			(assignment.target.id !== undefined &&
				options.validTargetIds !== undefined &&
				!options.validTargetIds.has(assignment.target.id))
		) {
			issues.push({
				code: "missing-target",
				id: assignment.target.id ?? assignment.target.scope,
			});
			if (assignment.fieldId) {
				fieldsReferencedByRemovedAssignments.add(assignment.fieldId);
			}
			return [];
		}
		const source = pruneSource(assignment.influence.source, options, issues);
		if (!source && assignment.fieldId) {
			fieldsReferencedByRemovedAssignments.add(assignment.fieldId);
		}
		return source
			? [{ ...assignment, influence: { ...assignment.influence, source } }]
			: [];
	});
	const referencedFieldIds = new Set(
		assignments.flatMap((assignment) =>
			assignment.fieldId ? [assignment.fieldId] : [],
		),
	);
	const keptFields = options.removeUnreferencedFields
		? fields.filter(
				(field) =>
					!fieldsReferencedByRemovedAssignments.has(field.id) ||
					referencedFieldIds.has(field.id),
			)
		: fields;
	return {
		recipe: normalizeEffectInfluenceRecipe({
			enabled: assignments.length > 0 && recipe.enabled,
			assignments,
			...(keptFields.length > 0 ? { fields: keptFields } : {}),
		}),
		issues,
	};
}

/**
 * Prunes field identities in both the direct side-car recipe and Visual Recipe
 * scoped overlays. Unrelated Look/stack/recipe payloads remain byte-for-byte
 * untouched, and a side-car that loses its final payload is omitted.
 */
export function pruneEffectIntentFieldIdentities(
	intent: EffectIntent | undefined,
	options: PruneEffectFieldRecipeOptions,
): EffectIntentFieldIdentityResult {
	if (!intent) return { intent, issues: [] };
	const issues: EffectFieldIdentityIssue[] = [];
	let changed = false;
	let influenceRecipe = intent.influenceRecipe;
	if (influenceRecipe) {
		const pruned = pruneEffectFieldRecipeIdentities(influenceRecipe, options);
		issues.push(...pruned.issues);
		if (pruned.issues.length > 0) {
			changed = true;
			influenceRecipe =
				pruned.recipe.assignments.length > 0 ||
				(pruned.recipe.fields?.length ?? 0) > 0
					? pruned.recipe
					: undefined;
		}
	}
	const scopedLooks = intent.scopedLooks?.map((look): ScopedEffectLook => {
		if (look.kind !== "visual-recipe-overlay" || !look.influenceRecipe) {
			return look;
		}
		const pruned = pruneEffectFieldRecipeIdentities(
			look.influenceRecipe,
			options,
		);
		issues.push(...pruned.issues);
		if (pruned.issues.length === 0) return look;
		changed = true;
		if (
			pruned.recipe.assignments.length > 0 ||
			(pruned.recipe.fields?.length ?? 0) > 0
		) {
			return { ...look, influenceRecipe: pruned.recipe };
		}
		const { influenceRecipe: _removedInfluenceRecipe, ...withoutRecipe } = look;
		return withoutRecipe;
	});
	if (!changed) return { intent, issues };
	const {
		influenceRecipe: _sourceInfluenceRecipe,
		scopedLooks: _sourceScopedLooks,
		...rest
	} = intent;
	const next: EffectIntent = {
		...rest,
		...(influenceRecipe ? { influenceRecipe } : {}),
		...(scopedLooks && scopedLooks.length > 0 ? { scopedLooks } : {}),
	};
	return {
		intent: Object.keys(next).length > 0 ? next : undefined,
		issues,
	};
}

export type DuplicateEffectFieldAssignmentsResult =
	EffectFieldIdentityResult & {
		readonly copiedAssignmentIds: readonly string[];
	};

const uniqueDerivedId = (base: string, usedIds: Set<string>): string => {
	if (!usedIds.has(base)) {
		usedIds.add(base);
		return base;
	}
	let ordinal = 2;
	while (usedIds.has(`${base}:${ordinal}`)) ordinal += 1;
	const id = `${base}:${ordinal}`;
	usedIds.add(id);
	return id;
};

const cloneSourceForDuplicate = (
	source: EffectMaskSource,
	matteRefIds: ReadonlyMap<string, string>,
	usedStackItemIds: Set<string>,
	suffix: string,
): EffectMaskSource => {
	if (source.kind === "svgMatte") {
		return { ...source, refId: matteRefIds.get(source.refId) ?? source.refId };
	}
	if (source.kind !== "stack") return source;
	return {
		...source,
		items: source.items.map((item) => ({
			...item,
			id: uniqueDerivedId(`${item.id}:copy:${suffix}`, usedStackItemIds),
			source: cloneSourceForDuplicate(
				item.source,
				matteRefIds,
				usedStackItemIds,
				suffix,
			),
		})),
	};
};

const collectStackItemIds = (
	source: EffectMaskSource,
	output: Set<string>,
): void => {
	if (source.kind !== "stack") return;
	for (const item of source.items) {
		output.add(item.id);
		collectStackItemIds(item.source, output);
	}
};

/**
 * Appends independent copies of object/group field assignments for duplicated
 * scene nodes. Shared fields are cloned once per operation and remain shared by
 * the copied assignments, while originals retain their existing field identity.
 * Ambiguous assignment ids are not copied and an absent/ambiguous linked field
 * falls back to the assignment's inline source instead of selecting a winner.
 */
export function duplicateEffectFieldAssignmentsForTargets(
	recipeDraft: EffectInfluenceRecipeDraft | EffectInfluenceRecipe,
	targetIds: ReadonlyMap<string, string>,
): DuplicateEffectFieldAssignmentsResult {
	const recipe = normalizeEffectInfluenceRecipe(recipeDraft);
	const assignmentCounts = new Map<string, number>();
	for (const assignment of recipe.assignments) {
		assignmentCounts.set(
			assignment.id,
			(assignmentCounts.get(assignment.id) ?? 0) + 1,
		);
	}
	const issues: EffectFieldIdentityIssue[] = [
		...duplicateIssues(
			recipe.assignments.map((assignment) => assignment.id),
			"duplicate-assignment-id",
		),
	];
	const copySources = recipe.assignments.filter(
		(assignment) =>
			assignmentCounts.get(assignment.id) === 1 &&
			(assignment.target.scope === "object" ||
				assignment.target.scope === "group") &&
			assignment.target.id !== undefined &&
			targetIds.has(assignment.target.id),
	);
	if (copySources.length === 0) {
		return { recipe, issues, copiedAssignmentIds: [] };
	}

	const fieldCounts = new Map<string, number>();
	for (const field of recipe.fields ?? []) {
		fieldCounts.set(field.id, (fieldCounts.get(field.id) ?? 0) + 1);
	}
	const usedAssignmentIds = new Set(
		recipe.assignments.map((assignment) => assignment.id),
	);
	const usedFieldIds = new Set((recipe.fields ?? []).map((field) => field.id));
	const usedStackItemIds = new Set<string>();
	for (const assignment of recipe.assignments) {
		collectStackItemIds(assignment.influence.source, usedStackItemIds);
	}
	for (const field of recipe.fields ?? []) {
		collectStackItemIds(field.source, usedStackItemIds);
	}

	const fieldIdMap = new Map<string, string>();
	const copiedFields = [] as NonNullable<
		EffectInfluenceRecipe["fields"]
	>[number][];
	const requestedFieldIds = new Set(
		copySources.flatMap((assignment) =>
			assignment.fieldId ? [assignment.fieldId] : [],
		),
	);
	for (const fieldId of requestedFieldIds) {
		const matchingFields = (recipe.fields ?? []).filter(
			(field) => field.id === fieldId,
		);
		if (matchingFields.length !== 1 || fieldCounts.get(fieldId) !== 1) {
			issues.push(
				matchingFields.length === 0
					? { code: "missing-field-reference", id: fieldId }
					: { code: "duplicate-field-id", id: fieldId },
			);
			continue;
		}
		const field = matchingFields[0];
		if (!field) continue;
		const linkedTargetIds = copySources
			.flatMap((assignment) =>
				assignment.fieldId === fieldId && assignment.target.id
					? [targetIds.get(assignment.target.id)]
					: [],
			)
			.filter((id): id is string => id !== undefined);
		const suffix = linkedTargetIds.sort().join("+") || "detached";
		const copiedFieldId = uniqueDerivedId(
			`${field.id}:copy:${suffix}`,
			usedFieldIds,
		);
		fieldIdMap.set(field.id, copiedFieldId);
		copiedFields.push({
			...field,
			id: copiedFieldId,
			source: cloneSourceForDuplicate(
				field.source,
				targetIds,
				usedStackItemIds,
				suffix,
			),
		});
	}

	const copiedAssignments = copySources.flatMap((assignment) => {
		const sourceTargetId = assignment.target.id;
		const copiedTargetId = sourceTargetId
			? targetIds.get(sourceTargetId)
			: undefined;
		if (!copiedTargetId) return [];
		const copiedAssignmentId = uniqueDerivedId(
			`${assignment.id}:copy:${copiedTargetId}`,
			usedAssignmentIds,
		);
		const copiedFieldId = assignment.fieldId
			? fieldIdMap.get(assignment.fieldId)
			: undefined;
		const { fieldId: _sourceFieldId, ...withoutFieldId } = assignment;
		return [
			{
				...withoutFieldId,
				id: copiedAssignmentId,
				target: { ...assignment.target, id: copiedTargetId },
				...(copiedFieldId ? { fieldId: copiedFieldId } : {}),
				influence: {
					...assignment.influence,
					source: cloneSourceForDuplicate(
						assignment.influence.source,
						targetIds,
						usedStackItemIds,
						copiedTargetId,
					),
				},
			},
		];
	});

	return {
		recipe: normalizeEffectInfluenceRecipe({
			enabled: recipe.enabled,
			assignments: [...recipe.assignments, ...copiedAssignments],
			...((recipe.fields?.length ?? 0) + copiedFields.length > 0
				? { fields: [...(recipe.fields ?? []), ...copiedFields] }
				: {}),
		}),
		issues,
		copiedAssignmentIds: copiedAssignments.map((assignment) => assignment.id),
	};
}

/**
 * Applies node-duplicate field copying to one effect-intent side-car, including
 * Visual Recipe scoped overlays that own an independent influence recipe.
 */
export function duplicateEffectIntentFieldAssignmentsForTargets(
	intent: EffectIntent | undefined,
	targetIds: ReadonlyMap<string, string>,
): EffectIntent | undefined {
	if (!intent || targetIds.size === 0) return intent;
	let changed = false;
	const influenceRecipe = intent.influenceRecipe
		? duplicateEffectFieldAssignmentsForTargets(
				intent.influenceRecipe,
				targetIds,
			)
		: null;
	if ((influenceRecipe?.copiedAssignmentIds.length ?? 0) > 0) changed = true;
	const scopedLooks = intent.scopedLooks?.map((look): ScopedEffectLook => {
		if (look.kind !== "visual-recipe-overlay" || !look.influenceRecipe) {
			return look;
		}
		const copied = duplicateEffectFieldAssignmentsForTargets(
			look.influenceRecipe,
			targetIds,
		);
		if (copied.copiedAssignmentIds.length === 0) return look;
		changed = true;
		return { ...look, influenceRecipe: copied.recipe };
	});
	if (!changed) return intent;
	return {
		...intent,
		...(influenceRecipe ? { influenceRecipe: influenceRecipe.recipe } : {}),
		...(scopedLooks ? { scopedLooks } : {}),
	};
}
