import type {
	EffectInfluenceAssignment,
	EffectInfluenceRecipe,
	EffectMaskLinearGradientSource,
	EffectMaskRadialGradientSource,
} from "@/shared/vec-core";
import {
	createLinearGradientEffectMaskSource,
	createRadialGradientEffectMaskSource,
	type EffectInfluenceMaskAssignmentInput,
} from "./effect-influence";
import type { FrameInfluenceMaskOperation } from "./effect-intent-commands";

/** Compact soft-mask source kinds exposed to frame/artboard authoring surfaces. */
export type FrameEffectInfluenceMaskKind = "radialGradient" | "linearGradient";

/** Numeric influence fields an Inspector or Quick Action can edit without canvas tools. */
export type FrameEffectInfluenceNumberField =
	| "strength"
	| "featherRadius"
	| "cx"
	| "cy"
	| "radius"
	| "x1"
	| "y1"
	| "x2"
	| "y2";

/** First-assignment influence values projected into compact authoring controls. */
export type FrameEffectInfluenceEditingValues = {
	readonly strength: number | null;
	readonly featherRadius: number | null;
	readonly cx: number | null;
	readonly cy: number | null;
	readonly radius: number | null;
	readonly x1: number | null;
	readonly y1: number | null;
	readonly x2: number | null;
	readonly y2: number | null;
};

export const DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID =
	"inspector-frame-soft-mask";

const EMPTY_FRAME_INFLUENCE_VALUES: FrameEffectInfluenceEditingValues = {
	strength: null,
	featherRadius: null,
	cx: null,
	cy: null,
	radius: null,
	x1: null,
	y1: null,
	x2: null,
	y2: null,
};

const frameInfluenceSourceForKind = (kind: FrameEffectInfluenceMaskKind) =>
	kind === "radialGradient"
		? createRadialGradientEffectMaskSource({
				space: "target",
				cx: 0.5,
				cy: 0.5,
				radius: 0.46,
				rx: 0.46,
				ry: 0.46,
			})
		: createLinearGradientEffectMaskSource({
				space: "target",
				x1: 0.5,
				y1: 0,
				x2: 0.5,
				y2: 1,
			});

const frameInfluenceLabelForKind = (
	kind: FrameEffectInfluenceMaskKind,
): string =>
	kind === "radialGradient" ? "Radial soft mask" : "Linear soft mask";

const radialSourceWithNumber = (
	source: EffectMaskRadialGradientSource,
	field: FrameEffectInfluenceNumberField,
	value: number,
): EffectMaskRadialGradientSource | null => {
	if (field === "cx" || field === "cy") return { ...source, [field]: value };
	if (field === "radius") {
		return { ...source, radius: value, rx: value, ry: value };
	}
	return null;
};

const linearSourceWithNumber = (
	source: EffectMaskLinearGradientSource,
	field: FrameEffectInfluenceNumberField,
	value: number,
): EffectMaskLinearGradientSource | null => {
	if (field === "x1" || field === "y1" || field === "x2" || field === "y2") {
		return { ...source, [field]: value };
	}
	return null;
};

/**
 * Returns the compact assignment a frame influence surface should present first.
 * The dedicated default id wins when present; otherwise only a scene-scoped
 * recipe assignment is eligible. Object Effect Field routes are never borrowed
 * merely because they happen to be first in storage order.
 */
export function primaryFrameInfluenceAssignment(
	recipe: EffectInfluenceRecipe | null | undefined,
): EffectInfluenceAssignment | null {
	if (!recipe) return null;
	return (
		recipe.assignments.find(
			(assignment) => assignment.id === DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
		) ??
		recipe.assignments.find(
			(assignment) =>
				assignment.target.scope === "scene" &&
				assignment.effect.path.startsWith("recipe"),
		) ??
		null
	);
}

/**
 * Creates the default assignment used by compact frame/artboard influence
 * authoring. The side-car target chooses scene vs artboard ownership; the
 * assignment target stays within vec-core's supported target scopes.
 */
export function createFrameInfluenceAssignment(
	kind: FrameEffectInfluenceMaskKind,
	assignmentId = DEFAULT_FRAME_INFLUENCE_ASSIGNMENT_ID,
): EffectInfluenceMaskAssignmentInput {
	return {
		id: assignmentId,
		label: frameInfluenceLabelForKind(kind),
		target: { scope: "scene" },
		effect: {
			id: "bloom",
			path: "recipe.glow.bloom",
			label: "Bloom",
		},
		source: frameInfluenceSourceForKind(kind),
		influence: {
			enabled: true,
			strength: 0.7,
			featherRadius: 0.08,
			falloff: { kind: "smoothstep", softness: 0.35 },
		},
	};
}

/** Classifies whether an existing assignment source can be edited by the compact controls. */
export function frameInfluenceMaskKind(
	assignment: EffectInfluenceAssignment | null,
): FrameEffectInfluenceMaskKind | "unsupported" | null {
	if (!assignment) return null;
	const { kind } = assignment.influence.source;
	return kind === "radialGradient" || kind === "linearGradient"
		? kind
		: "unsupported";
}

/** Projects the editable numeric values from the compact frame influence assignment. */
export function frameInfluenceValues(
	assignment: EffectInfluenceAssignment | null,
): FrameEffectInfluenceEditingValues {
	if (!assignment) return EMPTY_FRAME_INFLUENCE_VALUES;
	const { influence } = assignment;
	if (influence.source.kind === "radialGradient") {
		return {
			...EMPTY_FRAME_INFLUENCE_VALUES,
			strength: influence.strength,
			featherRadius: influence.featherRadius,
			cx: influence.source.cx,
			cy: influence.source.cy,
			radius: influence.source.radius,
		};
	}
	if (influence.source.kind === "linearGradient") {
		return {
			...EMPTY_FRAME_INFLUENCE_VALUES,
			strength: influence.strength,
			featherRadius: influence.featherRadius,
			x1: influence.source.x1,
			y1: influence.source.y1,
			x2: influence.source.x2,
			y2: influence.source.y2,
		};
	}
	return {
		...EMPTY_FRAME_INFLUENCE_VALUES,
		strength: influence.strength,
		featherRadius: influence.featherRadius,
	};
}

/**
 * Builds the attach/replace operation for switching the compact frame influence
 * mask kind while preserving the current strength, feather, and falloff where a
 * prior assignment exists.
 */
export function createFrameInfluenceMaskKindOperation(
	recipe: EffectInfluenceRecipe | null | undefined,
	kind: FrameEffectInfluenceMaskKind,
): FrameInfluenceMaskOperation {
	const assignment = primaryFrameInfluenceAssignment(recipe);
	if (!recipe || !assignment) {
		return {
			kind: "attach",
			assignment: createFrameInfluenceAssignment(kind),
		};
	}
	const shouldReplaceSource = frameInfluenceMaskKind(assignment) !== kind;
	return {
		kind: "replace",
		assignmentId: assignment.id,
		patch: {
			label: frameInfluenceLabelForKind(kind),
			...(shouldReplaceSource
				? { source: frameInfluenceSourceForKind(kind) }
				: {}),
			influence: {
				enabled: true,
				strength: assignment.influence.strength,
				featherRadius: assignment.influence.featherRadius,
				falloff: assignment.influence.falloff,
			},
		},
	};
}

/**
 * Builds a numeric patch operation for the requested assignment. Unsupported
 * source-field combinations return null so stale UI state cannot fabricate a
 * different mask shape.
 */
export function createFrameInfluenceNumberOperation(
	recipe: EffectInfluenceRecipe | null | undefined,
	assignmentId: string,
	field: FrameEffectInfluenceNumberField,
	value: number,
): FrameInfluenceMaskOperation | null {
	if (!Number.isFinite(value)) return null;
	const assignment = recipe?.assignments.find(
		(item) => item.id === assignmentId,
	);
	if (!assignment) return null;
	if (field === "strength") {
		return {
			kind: "replace",
			assignmentId,
			patch: { influence: { strength: value } },
		};
	}
	if (field === "featherRadius") {
		return {
			kind: "replace",
			assignmentId,
			patch: { influence: { featherRadius: value } },
		};
	}

	const { source } = assignment.influence;
	const nextSource =
		source.kind === "radialGradient"
			? radialSourceWithNumber(source, field, value)
			: source.kind === "linearGradient"
				? linearSourceWithNumber(source, field, value)
				: null;
	return nextSource
		? { kind: "replace", assignmentId, patch: { source: nextSource } }
		: null;
}
