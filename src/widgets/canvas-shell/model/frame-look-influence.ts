import type { Bounds } from "@/entities/scene/model/types";
import type {
	EffectInfluence,
	EffectInfluenceAssignment,
	EffectInfluenceRecipe,
	EffectMaskSource,
} from "@/shared/vec-core";

export type FrameLookInfluenceArtboardSize = {
	readonly width: number;
	readonly height: number;
};

export type FrameLookInfluenceMaskPlan =
	| { readonly kind: "none" }
	| {
			readonly kind: "masked";
			readonly assignmentId: string;
			readonly influence: EffectInfluence;
			readonly source: EffectMaskSource;
			readonly bounds: Bounds;
	  }
	| {
			readonly kind: "unsupported";
			readonly assignmentIds: readonly string[];
			readonly sourceKind?: EffectMaskSource["kind"];
			readonly reason: "ambiguous-assignments" | "source-unsupported";
	  };

export type FrameLookInfluenceMatteBounds = ReadonlyMap<string, Bounds>;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const finiteOr = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const normalizedX = (
	value: number,
	source: EffectMaskSource,
	artboard: FrameLookInfluenceArtboardSize,
): number =>
	source.space === "scene"
		? finiteOr(value, 0)
		: finiteOr(value, 0) * artboard.width;

const normalizedY = (
	value: number,
	source: EffectMaskSource,
	artboard: FrameLookInfluenceArtboardSize,
): number =>
	source.space === "scene"
		? finiteOr(value, 0)
		: finiteOr(value, 0) * artboard.height;

const normalizedWidth = (
	value: number,
	source: EffectMaskSource,
	artboard: FrameLookInfluenceArtboardSize,
): number =>
	source.space === "scene"
		? finiteOr(value, 0)
		: finiteOr(value, 0) * artboard.width;

const normalizedHeight = (
	value: number,
	source: EffectMaskSource,
	artboard: FrameLookInfluenceArtboardSize,
): number =>
	source.space === "scene"
		? finiteOr(value, 0)
		: finiteOr(value, 0) * artboard.height;

const artboardBounds = (artboard: FrameLookInfluenceArtboardSize): Bounds => ({
	x: 0,
	y: 0,
	width: artboard.width,
	height: artboard.height,
});

const clampBoundsToArtboard = (
	bounds: Bounds,
	artboard: FrameLookInfluenceArtboardSize,
): Bounds => {
	const minX = clamp(bounds.x, 0, artboard.width);
	const minY = clamp(bounds.y, 0, artboard.height);
	const maxX = clamp(bounds.x + bounds.width, 0, artboard.width);
	const maxY = clamp(bounds.y + bounds.height, 0, artboard.height);
	return {
		x: minX,
		y: minY,
		width: Math.max(0, maxX - minX),
		height: Math.max(0, maxY - minY),
	};
};

const unionBounds = (bounds: readonly Bounds[]): Bounds | null => {
	const first = bounds[0];
	if (!first) return null;
	let minX = first.x;
	let minY = first.y;
	let maxX = first.x + first.width;
	let maxY = first.y + first.height;
	for (const bound of bounds.slice(1)) {
		minX = Math.min(minX, bound.x);
		minY = Math.min(minY, bound.y);
		maxX = Math.max(maxX, bound.x + bound.width);
		maxY = Math.max(maxY, bound.y + bound.height);
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(0, maxX - minX),
		height: Math.max(0, maxY - minY),
	};
};

const boundsForSource = (
	source: EffectMaskSource,
	artboard: FrameLookInfluenceArtboardSize,
	matteBoundsByRefId: FrameLookInfluenceMatteBounds | undefined,
): Bounds | null => {
	switch (source.kind) {
		case "fullFrame":
		case "linearGradient":
			return artboardBounds(artboard);
		case "rect":
			return clampBoundsToArtboard(
				{
					x: normalizedX(source.x, source, artboard),
					y: normalizedY(source.y, source, artboard),
					width: normalizedWidth(source.width, source, artboard),
					height: normalizedHeight(source.height, source, artboard),
				},
				artboard,
			);
		case "ellipse": {
			const cx = normalizedX(source.cx, source, artboard);
			const cy = normalizedY(source.cy, source, artboard);
			const rx = normalizedWidth(source.rx, source, artboard);
			const ry = normalizedHeight(source.ry, source, artboard);
			return clampBoundsToArtboard(
				{ x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
				artboard,
			);
		}
		case "radialGradient": {
			const cx = normalizedX(source.cx, source, artboard);
			const cy = normalizedY(source.cy, source, artboard);
			const rx = normalizedWidth(source.rx, source, artboard);
			const ry = normalizedHeight(source.ry, source, artboard);
			return clampBoundsToArtboard(
				{ x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
				artboard,
			);
		}
		case "svgMatte": {
			const bounds = matteBoundsByRefId?.get(source.refId);
			return bounds ? clampBoundsToArtboard(bounds, artboard) : null;
		}
		case "stack": {
			const childBounds: Bounds[] = [];
			for (const item of source.items) {
				if (!item.enabled || item.strength <= 0) continue;
				if (
					item.source.kind !== "svgMatte" ||
					(item.combineMode !== "replace" && item.combineMode !== "add") ||
					item.invert ||
					item.featherRadius > 0
				) {
					return null;
				}
				const bounds = boundsForSource(
					item.source,
					artboard,
					matteBoundsByRefId,
				);
				if (!bounds) return null;
				childBounds.push(bounds);
			}
			const bounds = unionBounds(childBounds);
			return bounds ? clampBoundsToArtboard(bounds, artboard) : null;
		}
		default:
			return null;
	}
};

const activeAssignments = (
	recipe: EffectInfluenceRecipe | null | undefined,
): readonly EffectInfluenceAssignment[] =>
	!recipe?.enabled
		? []
		: recipe.assignments.filter(
				(assignment) =>
					assignment.target.scope === "scene" &&
					assignment.effect.path.startsWith("recipe") &&
					assignment.influence.enabled &&
					assignment.influence.strength > 0,
			);

/**
 * Resolves whether the frame-look renderer should stay full-frame, become a
 * masked overlay, or suppress the pixel pass because an active influence source
 * cannot be represented by the current SVG canvas renderer.
 */
export function resolveFrameLookInfluenceMaskPlan(
	recipe: EffectInfluenceRecipe | null | undefined,
	artboard: FrameLookInfluenceArtboardSize,
	matteBoundsByRefId?: FrameLookInfluenceMatteBounds,
): FrameLookInfluenceMaskPlan {
	const assignments = activeAssignments(recipe);
	if (assignments.length > 1) {
		return {
			kind: "unsupported",
			assignmentIds: assignments.map((assignment) => assignment.id),
			reason: "ambiguous-assignments",
		};
	}
	const assignment = assignments[0];
	if (!assignment) return { kind: "none" };

	const { influence } = assignment;
	const source = influence.source;
	if (source.kind === "fullFrame") return { kind: "none" };

	const bounds = boundsForSource(source, artboard, matteBoundsByRefId);
	if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
		return {
			kind: "unsupported",
			assignmentIds: [assignment.id],
			sourceKind: source.kind,
			reason: "source-unsupported",
		};
	}

	return {
		kind: "masked",
		assignmentId: assignment.id,
		influence,
		source,
		bounds,
	};
}
