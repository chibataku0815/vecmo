import {
	appendMaskStackItem as appendVecCoreMaskStackItem,
	attachMaskToEffect,
	type EffectInfluence,
	type EffectInfluenceAssignment,
	type EffectInfluenceAssignmentDraft,
	type EffectInfluenceDraft,
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	type EffectMaskContourSide,
	type EffectMaskGradientStop,
	type EffectMaskSource,
	type EffectMaskSourceDraft,
	type EffectMaskSpace,
	type EffectMaskStackItem,
	type EffectMaskStackItemDraft,
	normalizeEffectInfluenceAssignment,
	normalizeEffectInfluenceRecipe,
	normalizeEffectMaskSource,
	normalizeEffectMaskStackItem,
	removeMaskStackItem as removeVecCoreMaskStackItem,
	reorderEffectInfluenceAssignments,
	reorderMaskStackItem as reorderVecCoreMaskStackItem,
	replaceMaskStackItem as replaceVecCoreMaskStackItem,
} from "@/shared/vec-core";

const DEFAULT_MASK_SPACE: EffectMaskSpace = "target";

const DEFAULT_GRADIENT_STOPS = [
	{ offset: 0, alpha: 1 },
	{ offset: 1, alpha: 0 },
] as const satisfies readonly EffectMaskGradientStop[];

/** Shared authoring fields for mask sources; coordinates are in the chosen mask space and rotations are radians. */
export type EffectMaskSourceAuthoringInput = {
	readonly space?: EffectMaskSpace;
};

/** Circle authoring input stored as vec-core's canonical ellipse mask source. */
export type CircleEffectMaskSourceInput = EffectMaskSourceAuthoringInput & {
	readonly cx?: number;
	readonly cy?: number;
	readonly radius?: number;
	readonly rotation?: number;
};

/** Rectangle authoring input stored as vec-core's canonical rect mask source. */
export type RectEffectMaskSourceInput = EffectMaskSourceAuthoringInput & {
	readonly x?: number;
	readonly y?: number;
	readonly width?: number;
	readonly height?: number;
	readonly cornerRadius?: number;
	readonly rotation?: number;
};

/** Linear alpha ramp input for authoring soft mask bands. */
export type LinearGradientEffectMaskSourceInput =
	EffectMaskSourceAuthoringInput & {
		readonly x1?: number;
		readonly y1?: number;
		readonly x2?: number;
		readonly y2?: number;
		readonly stops?: readonly Partial<EffectMaskGradientStop>[];
	};

/** Radial alpha ramp input for spotlight/vignette-style mask authoring. */
export type RadialGradientEffectMaskSourceInput =
	EffectMaskSourceAuthoringInput & {
		readonly cx?: number;
		readonly cy?: number;
		readonly radius?: number;
		readonly rx?: number;
		readonly ry?: number;
		readonly rotation?: number;
		readonly stops?: readonly Partial<EffectMaskGradientStop>[];
	};

/** Procedural noise input used as a vec-core mask source, not as texture grain. */
export type NoiseEffectMaskSourceInput = EffectMaskSourceAuthoringInput & {
	readonly seed?: number;
	readonly scale?: number;
	readonly contrast?: number;
	readonly bias?: number;
};

/** Shape-following scalar field input shared by opacity, blur, glow, and edge owners. */
export type ContourEffectMaskSourceInput = EffectMaskSourceAuthoringInput & {
	readonly width?: number;
	readonly side?: EffectMaskContourSide;
};

/** Reusable scalar mesh input; vec-core normalizes its topology and values. */
export type FieldMeshEffectMaskSourceInput = EffectMaskSourceAuthoringInput & {
	readonly fieldMesh?: unknown;
};

/** Stack input preserves each item's combine mode while canonicalizing children. */
export type StackEffectMaskSourceInput = EffectMaskSourceAuthoringInput & {
	readonly items: readonly EffectMaskStackItemDraft[];
};

/** Input for adding a mask assignment to an EffectInfluenceRecipe. */
export type EffectInfluenceMaskAssignmentInput = Omit<
	EffectInfluenceAssignmentDraft,
	"influence"
> & {
	readonly source: EffectMaskSourceDraft;
	/**
	 * `featherRadius` is a normalized 0..1 fraction of the resolved space short
	 * axis, matching vec-core. Pixel conversion belongs to render adapters.
	 */
	readonly influence?: Omit<EffectInfluenceDraft, "source">;
};

/** Patch for replacing an existing mask assignment without inventing host schema. */
export type EffectInfluenceMaskAssignmentPatch = Partial<
	Omit<EffectInfluenceAssignmentDraft, "influence">
> & {
	readonly source?: EffectMaskSourceDraft;
	readonly influence?: EffectInfluenceDraft;
};

export type EffectMaskStackItemInput = EffectMaskStackItemDraft & {
	readonly source: EffectMaskSourceDraft;
};

/**
 * Builds the canonical vec-core source for a circular influence mask. The circle
 * is represented as an ellipse with equal radii so downstream renderers consume
 * the upstream contract unchanged.
 */
export function createCircleEffectMaskSource(
	input: CircleEffectMaskSourceInput = {},
): EffectMaskSource {
	const radius = input.radius ?? 0.5;
	return normalizeEffectMaskSource({
		kind: "ellipse",
		space: input.space ?? DEFAULT_MASK_SPACE,
		cx: input.cx,
		cy: input.cy,
		rx: radius,
		ry: radius,
		rotation: input.rotation,
	});
}

/**
 * Builds the canonical vec-core source for a rectangular influence mask.
 * Dimensions remain in mask-space units; render adapters decide pixel scale.
 */
export function createRectEffectMaskSource(
	input: RectEffectMaskSourceInput = {},
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "rect",
		space: input.space ?? DEFAULT_MASK_SPACE,
		x: input.x,
		y: input.y,
		width: input.width,
		height: input.height,
		cornerRadius: input.cornerRadius,
		rotation: input.rotation,
	});
}

/**
 * Builds a canonical linear-gradient alpha mask. Stops are normalized and sorted
 * by vec-core so UI drags can pass partial or out-of-order stop drafts safely.
 */
export function createLinearGradientEffectMaskSource(
	input: LinearGradientEffectMaskSourceInput = {},
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "linearGradient",
		space: input.space ?? DEFAULT_MASK_SPACE,
		x1: input.x1,
		y1: input.y1,
		x2: input.x2,
		y2: input.y2,
		stops: input.stops ?? DEFAULT_GRADIENT_STOPS,
	});
}

/**
 * Builds a canonical radial-gradient alpha mask for spotlights, vignettes, and
 * soft localized effect fields.
 */
export function createRadialGradientEffectMaskSource(
	input: RadialGradientEffectMaskSourceInput = {},
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "radialGradient",
		space: input.space ?? DEFAULT_MASK_SPACE,
		cx: input.cx,
		cy: input.cy,
		radius: input.radius,
		rx: input.rx,
		ry: input.ry,
		rotation: input.rotation,
		stops: input.stops ?? DEFAULT_GRADIENT_STOPS,
	});
}

/**
 * Builds a canonical procedural-noise source for influence masking. This is kept
 * separate from texture grain so stack composition can use it as an alpha field.
 */
export function createNoiseEffectMaskSource(
	input: NoiseEffectMaskSourceInput = {},
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "proceduralNoise",
		space: input.space ?? DEFAULT_MASK_SPACE,
		seed: input.seed,
		scale: input.scale,
		contrast: input.contrast,
		bias: input.bias,
	});
}

/** Builds a normalized shape-following scalar Effect Field source. */
export function createContourEffectMaskSource(
	input: ContourEffectMaskSourceInput = {},
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "contourGradient",
		space: input.space ?? DEFAULT_MASK_SPACE,
		width: input.width,
		side: input.side,
	});
}

/** Builds a normalized editable scalar Field Mesh source. */
export function createFieldMeshEffectMaskSource(
	input: FieldMeshEffectMaskSourceInput = {},
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "fieldMesh",
		space: input.space ?? DEFAULT_MASK_SPACE,
		fieldMesh: input.fieldMesh,
	});
}

/**
 * Builds a canonical stack mask and preserves per-item combine modes. The first
 * item is not rewritten outside vec-core normalization, so callers may author
 * advanced stacks before renderer support lands.
 */
export function createStackEffectMaskSource(
	input: StackEffectMaskSourceInput,
): EffectMaskSource {
	return normalizeEffectMaskSource({
		kind: "stack",
		space: input.space ?? DEFAULT_MASK_SPACE,
		items: input.items,
	});
}

/**
 * Builds one normalized stack item for UI/editor state before it is inserted
 * into a stack source.
 */
export function createEffectMaskStackItem(
	input: EffectMaskStackItemInput,
	index = 0,
): EffectMaskStackItem {
	return normalizeEffectMaskStackItem(input, index);
}

/**
 * Attaches or replaces an influence assignment in a recipe. Existing assignment
 * ids are replaced through vec-core's canonical `attachMaskToEffect` operation.
 */
export function attachEffectInfluenceMask(
	recipe: EffectInfluenceRecipeDraft | undefined,
	assignment: EffectInfluenceMaskAssignmentInput,
	index = Number.POSITIVE_INFINITY,
): EffectInfluenceRecipe {
	return attachMaskToEffect(recipe, toAssignmentDraft(assignment), index);
}

/**
 * Replaces fields on an existing assignment and returns a normalized no-op when
 * the id is missing. Useful for Inspector or command adapters that should not
 * create hidden assignments from stale UI state.
 */
export function replaceEffectInfluenceMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	patch: EffectInfluenceMaskAssignmentPatch,
): EffectInfluenceRecipe {
	return updateAssignment(recipe, assignmentId, (assignment) =>
		normalizeEffectInfluenceAssignment(mergeAssignmentPatch(assignment, patch)),
	);
}

/**
 * Removes a mask assignment by id. Removing the final assignment disables the
 * recipe so an empty influence payload is neutral by default.
 */
export function removeEffectInfluenceMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
): EffectInfluenceRecipe {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const assignments = normalized.assignments.filter(
		(assignment) => assignment.id !== assignmentId,
	);
	if (assignments.length === normalized.assignments.length) return normalized;
	return {
		...normalized,
		enabled: assignments.length > 0 && normalized.enabled,
		assignments,
	};
}

/**
 * Reorders mask assignments without touching their source or target payloads.
 * Out-of-range indexes clamp through vec-core's reorder helper.
 */
export function reorderEffectInfluenceMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	toIndex: number,
): EffectInfluenceRecipe {
	return reorderEffectInfluenceAssignments(recipe, assignmentId, toIndex);
}

/**
 * Appends a stack item to an assignment influence, converting a single-source
 * influence into a stack when needed while preserving the base source.
 */
export function appendEffectInfluenceStackMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	item: EffectMaskStackItemInput,
	index = Number.POSITIVE_INFINITY,
): EffectInfluenceRecipe {
	return updateAssignmentInfluence(recipe, assignmentId, (influence) =>
		appendVecCoreMaskStackItem(influence, item, index),
	);
}

/**
 * Replaces one item inside an assignment's stack source. Non-stack assignments
 * and stale item ids normalize to no-ops.
 */
export function replaceEffectInfluenceStackMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	itemId: string,
	patch: EffectMaskStackItemDraft,
): EffectInfluenceRecipe {
	return updateAssignmentInfluence(recipe, assignmentId, (influence) =>
		replaceVecCoreMaskStackItem(influence, itemId, patch),
	);
}

/**
 * Removes one item inside an assignment's stack source. Combine modes on the
 * remaining items are preserved exactly.
 */
export function removeEffectInfluenceStackMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	itemId: string,
): EffectInfluenceRecipe {
	return updateAssignmentInfluence(recipe, assignmentId, (influence) =>
		removeVecCoreMaskStackItem(influence, itemId),
	);
}

/**
 * Reorders one item inside an assignment's stack source without forcing first
 * item combine semantics; authored combine modes remain intact.
 */
export function reorderEffectInfluenceStackMask(
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	itemId: string,
	toIndex: number,
): EffectInfluenceRecipe {
	return updateAssignmentInfluence(recipe, assignmentId, (influence) =>
		reorderVecCoreMaskStackItem(influence, itemId, toIndex),
	);
}

const toAssignmentDraft = (
	assignment: EffectInfluenceMaskAssignmentInput,
): EffectInfluenceAssignmentDraft => {
	const { influence, source, ...assignmentDraft } = assignment;
	return {
		...assignmentDraft,
		influence: {
			...influence,
			source,
		},
	};
};

const mergeAssignmentPatch = (
	assignment: EffectInfluenceAssignment,
	patch: EffectInfluenceMaskAssignmentPatch,
): EffectInfluenceAssignmentDraft => {
	const { influence, source, ...assignmentPatch } = patch;
	return {
		...assignment,
		...assignmentPatch,
		target: assignmentPatch.target ?? assignment.target,
		effect: assignmentPatch.effect ?? assignment.effect,
		influence: mergeInfluencePatch(assignment.influence, influence, source),
	};
};

const mergeInfluencePatch = (
	influence: EffectInfluence,
	patch: EffectInfluenceDraft | undefined,
	source: EffectMaskSourceDraft | undefined,
): EffectInfluenceDraft => ({
	...influence,
	...patch,
	source: source ?? patch?.source ?? influence.source,
	falloff: {
		...influence.falloff,
		...patch?.falloff,
	},
});

const updateAssignment = (
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	update: (assignment: EffectInfluenceAssignment) => EffectInfluenceAssignment,
): EffectInfluenceRecipe => {
	const normalized = normalizeEffectInfluenceRecipe(recipe);
	const assignmentIndex = normalized.assignments.findIndex(
		(assignment) => assignment.id === assignmentId,
	);
	if (assignmentIndex < 0) return normalized;
	return {
		...normalized,
		assignments: normalized.assignments.map((assignment, index) =>
			index === assignmentIndex ? update(assignment) : assignment,
		),
	};
};

const updateAssignmentInfluence = (
	recipe: EffectInfluenceRecipeDraft,
	assignmentId: string,
	update: (influence: EffectInfluence) => EffectInfluence,
): EffectInfluenceRecipe =>
	updateAssignment(recipe, assignmentId, (assignment) =>
		normalizeEffectInfluenceAssignment({
			...assignment,
			influence: update(assignment.influence),
		}),
	);
