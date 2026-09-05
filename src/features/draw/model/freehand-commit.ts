import { createNode } from "@/entities/scene/model/factory";
import type { NodeStyle } from "@/entities/scene/model/types";
import {
	MAX_WIDTH_MULTIPLIER,
	MIN_WIDTH_MULTIPLIER,
} from "@/shared/stroke/resample";
import type { StrokeWidthProfileStop } from "@/shared/stroke/width-profile";
import { addNode } from "./command";
import {
	type FreehandPoint,
	freehandStrokeToShape,
	freehandStrokeToWidthProfile,
	strokeLength,
} from "./freehand";
import { resolvePencilBrush, usePencilToolStore } from "./pencil-tool-store";

const PERCENT = 100;
const FREEHAND_SIMPLIFY_PX = 2.5;
const MIN_FREEHAND_LENGTH_PX = 6;
const QUICK_LINE_MAX_DEVIATION_PX = 7;
const QUICK_LINE_MIN_LENGTH_PX = 24;
const PENCIL_STYLE: Partial<NodeStyle> = {
	fill: "none",
	stroke: "#191817",
};

/**
 * Blends a raw pressure-derived width profile toward uniform (`w = 1`) by
 * `sensitivity`: at `sensitivity = 1` the raw taper passes through unchanged,
 * at `0` every stop flattens to a uniform width, matching the Pencil tool's
 * pressure-sensitivity control ({@link resolvePencilBrush}). Re-clamps into
 * the profile's valid multiplier range so a scaled value can never fall
 * outside what {@link validateStrokeWidthProfile} accepts.
 */
function scaleWidthProfileSensitivity(
	stops: readonly StrokeWidthProfileStop[],
	sensitivity: number,
): readonly StrokeWidthProfileStop[] {
	return stops.map((stop) => ({
		t: stop.t,
		w: Math.min(
			MAX_WIDTH_MULTIPLIER,
			Math.max(MIN_WIDTH_MULTIPLIER, 1 + (stop.w - 1) * sensitivity),
		),
	}));
}

export type FreehandCommitResult =
	| {
			readonly kind: "inserted";
			readonly nodeId: string;
			readonly quickShape?: "line";
	  }
	| {
			readonly kind: "ignored";
			readonly reason: "too-short" | "invalid-shape" | "insert-failed";
	  };

const pointLineDistance = (
	point: FreehandPoint,
	start: FreehandPoint,
	end: FreehandPoint,
): number => {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
	return (
		Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
		length
	);
};

const quickLinePoints = (
	points: readonly FreehandPoint[],
	scale: number,
): readonly FreehandPoint[] | null => {
	const start = points[0];
	const end = points.at(-1);
	if (!start || !end) return null;
	const length = Math.hypot(end.x - start.x, end.y - start.y);
	if (length < QUICK_LINE_MIN_LENGTH_PX / scale) return null;
	const maxDeviation = QUICK_LINE_MAX_DEVIATION_PX / scale;
	if (
		points.some((point) => pointLineDistance(point, start, end) > maxDeviation)
	) {
		return null;
	}
	return [start, end];
};

/**
 * Commits an artboard-local freehand stroke through the draw feature's existing
 * add-node command path. Browser PointerEvents and native iPad Pencil samples use
 * this same function so pressure-derived profiles and undo semantics stay
 * identical across shells.
 *
 * Reads the Pencil tool's brush configuration once, at commit time, via
 * `usePencilToolStore.getState()` — not subscribed — so a config change made
 * after this stroke started only affects the *next* stroke. `strokeWidth`/
 * `strokeCap`/`strokeJoin` come straight from {@link resolvePencilBrush}; a
 * pressure-derived `strokeWidthProfile` is attached only when the resolved
 * brush opts into it, scaled by its sensitivity via
 * {@link scaleWidthProfileSensitivity}. A brush with pressure off (or a mouse/
 * touch capture with no pressure signal at all) commits a plain uniform-width
 * stroke, matching {@link freehandStrokeToWidthProfile}'s `null` contract.
 */
export function commitFreehandStroke({
	points,
	recognizeQuickLine = false,
	viewportZoom,
	selectNode,
}: {
	readonly points: readonly FreehandPoint[];
	readonly recognizeQuickLine?: boolean;
	readonly viewportZoom: number;
	readonly selectNode?: (nodeId: string) => void;
}): FreehandCommitResult {
	const scale = Math.max(viewportZoom / PERCENT, 0.001);
	const quickLine = recognizeQuickLine ? quickLinePoints(points, scale) : null;
	const commitPoints = quickLine ?? points;
	if (strokeLength(commitPoints) < MIN_FREEHAND_LENGTH_PX / scale) {
		return { kind: "ignored", reason: "too-short" };
	}

	const shape = freehandStrokeToShape(commitPoints, {
		simplifyTolerance: FREEHAND_SIMPLIFY_PX / scale,
	});
	if (!shape) return { kind: "ignored", reason: "invalid-shape" };

	const brush = resolvePencilBrush(usePencilToolStore.getState());
	const rawProfile = brush.deriveProfile
		? freehandStrokeToWidthProfile(commitPoints)
		: null;
	const strokeWidthProfile = rawProfile
		? scaleWidthProfileSensitivity(rawProfile, brush.sensitivity)
		: null;

	const node = createNode(
		"path",
		{ kind: "path", shape },
		{
			name: "pencil path",
			style: {
				...PENCIL_STYLE,
				strokeWidth: brush.strokeWidth,
				strokeCap: brush.strokeCap,
				strokeJoin: brush.strokeJoin,
				...(strokeWidthProfile ? { strokeWidthProfile } : {}),
			},
		},
	);
	if (!addNode(node)) return { kind: "ignored", reason: "insert-failed" };
	selectNode?.(node.id);
	return {
		kind: "inserted",
		nodeId: node.id,
		...(quickLine ? { quickShape: "line" } : {}),
	};
}
