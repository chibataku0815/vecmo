import { createNode } from "@/entities/scene/model/factory";
import { createReplaceNodeCommand } from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Bounds,
	EllipseGeometry,
	LineGeometry,
	RectGeometry,
	VectorNode,
} from "@/entities/scene/model/types";
import { shapeGeometryMeetsMinimum } from "@/features/draw/model/shape";
import { useStrokeIntentStore } from "@/shared/stroke/intent-store";
import type {
	IntentBounds,
	PencilIntentSample,
} from "@/shared/stroke/pencil-intent";
import {
	type RecognizedStrokeShape,
	recognizeStrokeShape,
} from "@/shared/stroke/shape-recognition";

/**
 * Sketch-to-clean-vector conversion: turns a committed Pencil stroke's fitted
 * path into a clean rect, ellipse, or line, in place, when its traced shape is
 * a strong match. It is deliberately opt-in (never auto-applied on stroke
 * commit) and non-destructive: the swap is one command-bus edit that reuses
 * the sketch's own node id and layer position, so a single undo restores the
 * exact original sketch.
 */

/**
 * Minimum recognized-shape extent, in artboard-local units (the space
 * `PencilStrokeIntent` samples already live in — no viewport-zoom conversion
 * applies here, unlike the shape tool's live-drag minimum). Below this a
 * "recognized" shape is too small to trust and the sketch is left untouched.
 */
const MIN_SHAPE_SIZE = 4;

const boundsFromIntentBounds = (bounds: IntentBounds): Bounds => ({
	x: bounds.minX,
	y: bounds.minY,
	width: bounds.maxX - bounds.minX,
	height: bounds.maxY - bounds.minY,
});

/**
 * Builds the corner-to-corner diagonal across `bounds` that matches the
 * stroke's own start -> end direction, using only the first/last captured
 * sample. A line drawn top-right to bottom-left comes back on that diagonal
 * rather than always defaulting to top-left-to-bottom-right.
 */
function diagonalLineFromBounds(
	bounds: IntentBounds,
	samples: readonly PencilIntentSample[],
): LineGeometry {
	const first = samples[0];
	const last = samples[samples.length - 1];
	const sameDirection = (last.x - first.x) * (last.y - first.y) >= 0;
	return sameDirection
		? {
				kind: "line",
				start: { x: bounds.minX, y: bounds.minY },
				end: { x: bounds.maxX, y: bounds.maxY },
			}
		: {
				kind: "line",
				start: { x: bounds.minX, y: bounds.maxY },
				end: { x: bounds.maxX, y: bounds.minY },
			};
}

/** Maps a neutral recognition result onto concrete scene geometry. */
function geometryFromRecognizedShape(
	recognized: RecognizedStrokeShape,
	samples: readonly PencilIntentSample[],
): RectGeometry | EllipseGeometry | LineGeometry {
	switch (recognized.kind) {
		case "rect":
			return {
				kind: "rect",
				bounds: boundsFromIntentBounds(recognized.bounds),
				cornerRadius: 0,
			};
		case "ellipse":
			return {
				kind: "ellipse",
				bounds: boundsFromIntentBounds(recognized.bounds),
			};
		case "line":
			return diagonalLineFromBounds(recognized.bounds, samples);
	}
}

/**
 * Converts the most recently committed Pencil stroke into a clean rect,
 * ellipse, or line when its traced shape is a strong match, replacing the
 * sketch node in place (same id, same layer index) as one undoable edit.
 * Copies the original node's name and style onto the clean shape. Consumes
 * the pending stroke intent on success — the same pending/clear contract
 * `authorStrokeDrawOnFromLastIntent` (`features/motion/model/draw-on-authoring.ts`)
 * follows for its own conversion.
 *
 * Returns `false` — leaving the sketch untouched and the intent pending —
 * when: no stroke is pending; the stroke does not read as a clean primitive;
 * the recognized shape is smaller than {@link MIN_SHAPE_SIZE}; or the sketch
 * node was since removed from the document (e.g. undone) before conversion.
 */
export function convertLastStrokeToShape(): boolean {
	const intent = useStrokeIntentStore.getState().lastIntent;
	if (!intent) return false;

	const recognized = recognizeStrokeShape(intent);
	if (!recognized) return false;

	const geometry = geometryFromRecognizedShape(recognized, intent.samples);
	if (!shapeGeometryMeetsMinimum(geometry, MIN_SHAPE_SIZE)) return false;

	const original = findNode(useSceneStore.getState().document, intent.id);
	if (!original) return false;

	const clean = createNode(recognized.kind, geometry, {
		name: original.name,
		style: original.style,
	});
	const replacement: VectorNode = { ...clean, id: intent.id };

	useSceneStore
		.getState()
		.apply(createReplaceNodeCommand(intent.id, replacement));
	useStrokeIntentStore.getState().clearLastIntent();
	return true;
}
