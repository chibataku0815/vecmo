import type {
	IntentBounds,
	PencilIntentSample,
	PencilStrokeIntent,
} from "./pencil-intent";

/**
 * Neutral "this sketch reads as a clean primitive" classification for a
 * committed Pencil stroke. Derived purely from {@link PencilStrokeIntent}'s
 * already-computed signals/candidates — no scene or geometry types — so it
 * stays in `shared` and is mapped onto a concrete `VectorNode` by the
 * consuming feature (`features/draw/model/sketch-to-shape.ts`). `bounds` is
 * always the stroke's own bounding box; for `"line"` the caller picks which
 * diagonal to draw (this module does not privilege either).
 */
export type RecognizedStrokeShape = {
	readonly kind: "rect" | "ellipse" | "line";
	readonly bounds: IntentBounds;
};

/**
 * A perfect rect fills ~100% of its own bounding box; a perfect ellipse fills
 * `π/4` (~78.5%) of it, the area ratio between an ellipse and its bounding
 * rectangle. The midpoint of those two reference ratios is a simple,
 * scale-invariant split between them — scaling a stroke up or down changes
 * both the traced area and the box area by the same factor, so the ratio (and
 * this threshold) never depends on how far in the user was zoomed.
 */
const RECT_ELLIPSE_FILL_RATIO_THRESHOLD = (1 + Math.PI / 4) / 2;

/**
 * Unsigned polygon area via the shoelace formula, treating `points` as an
 * implicitly closed loop (the last point connects back to the first). Safe
 * for the near-but-not-exactly-closed traces a hand-drawn stroke produces.
 */
function shoelaceArea(points: readonly PencilIntentSample[]): number {
	let sum = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		sum += current.x * next.y - next.x * current.y;
	}
	return Math.abs(sum) / 2;
}

const boundsArea = (bounds: IntentBounds): number =>
	(bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

/**
 * Splits a closed stroke into `"rect"` or `"ellipse"` by how much of its own
 * bounding box the traced polygon fills (see {@link RECT_ELLIPSE_FILL_RATIO_THRESHOLD}).
 * A degenerate (zero-area) box guards the division and reads as `"ellipse"`
 * rather than producing NaN — neither reading is meaningful there, and the
 * caller's own minimum-size gate is what actually rejects it.
 */
function discriminateClosedShape(
	intent: PencilStrokeIntent,
	bounds: IntentBounds,
): "rect" | "ellipse" {
	const area = boundsArea(bounds);
	const ratio = area > 0 ? shoelaceArea(intent.samples) / area : 0;
	return ratio >= RECT_ELLIPSE_FILL_RATIO_THRESHOLD ? "rect" : "ellipse";
}

/**
 * Classifies a committed Pencil stroke as a candidate for conversion into a
 * clean rect, ellipse, or line, or returns `null` when it should stay a
 * freehand sketch:
 *
 * - `intent.candidates` includes `"straight-line"` -> `"line"` (bounds only;
 *   the stroke's dominant diagonal is for the caller to pick from its own
 *   first/last sample, since this module carries no start/end concept).
 * - Otherwise, includes `"closed-shape"` -> `"rect"` or `"ellipse"` by
 *   bounding-box fill ratio.
 * - Otherwise -> `null`.
 *
 * Pencil-intent samples are already in artboard-local units, and every ratio
 * here is a dimensionless area-over-area comparison, so the result never
 * depends on viewport zoom.
 */
export function recognizeStrokeShape(
	intent: PencilStrokeIntent,
): RecognizedStrokeShape | null {
	const bounds = intent.signals.bounds;
	if (intent.candidates.includes("straight-line")) {
		return { kind: "line", bounds };
	}
	if (intent.candidates.includes("closed-shape")) {
		return { kind: discriminateClosedShape(intent, bounds), bounds };
	}
	return null;
}
