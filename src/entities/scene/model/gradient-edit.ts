import { createId } from "@/shared/lib/id";
import type {
	Bounds,
	GradientStop,
	LinearGradientPaint,
	Paint,
	RadialGradientPaint,
	Vec2,
} from "./types";

/** Vector paints must keep at least this many stops to export as a real gradient. */
export const MIN_GRADIENT_STOPS = 2;

const DEFAULT_GRADIENT_END_COLOR = "#ffffff";
const FALLBACK_GRADIENT_COLOR = "#9ca3af";
const DEGREES_PER_RADIAN = 180 / Math.PI;
const STOP_ID_PREFIX = "stop";

const HEX_RADIX = 16;
const RGB_MAX = 255;
const HEX_PAIR = 2;
const SHORT_HEX_LENGTH = 3;
const LONG_HEX_LENGTH = 6;

const newStopId = (): string => createId(STOP_ID_PREFIX);

const withStopId = (stop: GradientStop): GradientStop =>
	stop.id ? stop : { ...stop, id: newStopId() };

const hydrateStopList = (
	stops: readonly GradientStop[],
): readonly GradientStop[] =>
	stops.every((stop) => stop.id) ? stops : stops.map(withStopId);

type Rgb = { readonly r: number; readonly g: number; readonly b: number };

const parseHexColor = (color: string): Rgb | null => {
	const hex = color.trim().replace(/^#/, "");
	const expanded =
		hex.length === SHORT_HEX_LENGTH
			? hex
					.split("")
					.map((channel) => channel + channel)
					.join("")
			: hex;
	if (
		expanded.length !== LONG_HEX_LENGTH ||
		!/^[0-9a-fA-F]{6}$/.test(expanded)
	) {
		return null;
	}
	return {
		r: Number.parseInt(expanded.slice(0, HEX_PAIR), HEX_RADIX),
		g: Number.parseInt(expanded.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
		b: Number.parseInt(expanded.slice(HEX_PAIR * 2), HEX_RADIX),
	};
};

const toHexChannel = (value: number): string =>
	Math.round(Math.min(RGB_MAX, Math.max(0, value)))
		.toString(HEX_RADIX)
		.padStart(HEX_PAIR, "0");

/**
 * sRGB-channel lerp between two hex colors. Non-hex inputs (named/`rgb()`) have no
 * cheap channel form, so the blend snaps to the nearer endpoint rather than
 * guessing — callers only rely on this to avoid a visible jump when adding a stop.
 */
const lerpHexColor = (from: string, to: string, t: number): string => {
	const a = parseHexColor(from);
	const b = parseHexColor(to);
	if (!a || !b) return t < 0.5 ? from : to;
	const mix = (x: number, y: number): number => x + (y - x) * t;
	return `#${toHexChannel(mix(a.r, b.r))}${toHexChannel(mix(a.g, b.g))}${toHexChannel(mix(a.b, b.b))}`;
};

export type GradientPaint = LinearGradientPaint | RadialGradientPaint;

/** Paint kinds the inspector can read; only solid/linear/radial are authorable. */
export type PaintKind = Paint["kind"];

export function isGradientPaint(
	paint: Paint | undefined,
): paint is GradientPaint {
	return paint?.kind === "linear-gradient" || paint?.kind === "radial-gradient";
}

const isVisibleColor = (color: string): boolean => {
	const normalized = color.trim().toLowerCase();
	return (
		normalized !== "" && normalized !== "none" && normalized !== "transparent"
	);
};

const visibleColor = (color: string): string =>
	isVisibleColor(color) ? color : FALLBACK_GRADIENT_COLOR;

const clampOffset = (offset: number): number =>
	Number.isFinite(offset) ? Math.min(1, Math.max(0, offset)) : 0;

const bySortedOffset = (
	stops: readonly GradientStop[],
): readonly GradientStop[] =>
	stops
		.map((stop, index) => ({ stop, index }))
		.sort((a, b) => a.stop.offset - b.stop.offset || a.index - b.index)
		.map(({ stop }) => stop);

/** Stops in stable left-to-right display order (gradients render sorted anyway). */
export function gradientStops(paint: GradientPaint): readonly GradientStop[] {
	return bySortedOffset(paint.stops);
}

/**
 * The lead color a paint contributes: a solid's color or a gradient's first stop.
 * Used to seed conversions and keep the legacy flat color in sync.
 */
export function paintLeadColor(
	paint: Paint | undefined,
	fallback: string,
): string {
	if (!paint) return fallback;
	if (paint.kind === "solid") return paint.color;
	if (isGradientPaint(paint)) return paint.stops[0]?.color ?? fallback;
	if (paint.kind === "mesh-gradient") return paint.points[0]?.color ?? fallback;
	return fallback;
}

/**
 * Two-stop seed for a freshly authored gradient: the source color fading into the
 * same hue at zero alpha (Figma's default gradient), so a new gradient reads as a
 * soft falloff rather than an arbitrary white/black ramp. The end stop's alpha is
 * editable in the stop color picker (alpha is unified into the picker, not hidden).
 */
export function defaultGradientStops(color: string): readonly GradientStop[] {
	const start = visibleColor(color);
	return [
		{ id: newStopId(), offset: 0, color: start },
		{ id: newStopId(), offset: 1, color: start, opacity: 0 },
	];
}

const linearGeometry = (
	bounds: Bounds,
): Pick<LinearGradientPaint, "from" | "to"> => {
	const midY = bounds.y + bounds.height / 2;
	return {
		from: { x: bounds.x, y: midY },
		to: { x: bounds.x + bounds.width, y: midY },
	};
};

const radialGeometry = (
	bounds: Bounds,
): Pick<RadialGradientPaint, "center" | "radius"> => ({
	center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
	radius: { x: bounds.width / 2, y: bounds.height / 2 },
});

export function defaultLinearGradient(
	color: string,
	bounds: Bounds,
): LinearGradientPaint {
	return {
		kind: "linear-gradient",
		...linearGeometry(bounds),
		stops: defaultGradientStops(color),
	};
}

export function defaultRadialGradient(
	color: string,
	bounds: Bounds,
): RadialGradientPaint {
	return {
		kind: "radial-gradient",
		...radialGeometry(bounds),
		stops: defaultGradientStops(color),
	};
}

/**
 * Carries paint-level metadata (opacity AND visibility) from the paint being
 * replaced onto its converted successor. Visibility is load-bearing: the
 * Inspector's fill/stroke on/off toggle stores "off" as `visible: false`, so a
 * kind conversion that dropped the flag would silently resurrect a hidden paint.
 */
const withPaintMeta = <T extends Paint>(
	paint: T,
	current: Paint | undefined,
): T => ({
	...paint,
	...(current?.opacity === undefined ? {} : { opacity: current.opacity }),
	...(current?.visible === undefined ? {} : { visible: current.visible }),
});

/**
 * Converts the primary paint to a target kind. Switching between gradient kinds
 * preserves the authored stops (and paint opacity/visibility); switching from
 * solid/empty seeds a default two-stop gradient sized to the node bounds.
 * Returns `null` for `image-reference`, which the inspector does not author.
 * Idempotent when the paint already has the requested kind.
 */
export function convertPaintKind(
	current: Paint | undefined,
	kind: PaintKind,
	legacyColor: string,
	bounds: Bounds,
): Paint | null {
	if (current?.kind === kind) return current;
	const seedColor = visibleColor(paintLeadColor(current, legacyColor));

	switch (kind) {
		case "solid":
			return withPaintMeta({ kind: "solid", color: seedColor }, current);
		case "linear-gradient":
			if (isGradientPaint(current)) {
				return withPaintMeta(
					{
						kind: "linear-gradient",
						...linearGeometry(bounds),
						stops: hydrateStopList(current.stops),
					},
					current,
				);
			}
			return withPaintMeta(defaultLinearGradient(seedColor, bounds), current);
		case "radial-gradient":
			if (isGradientPaint(current)) {
				return withPaintMeta(
					{
						kind: "radial-gradient",
						...radialGeometry(bounds),
						stops: hydrateStopList(current.stops),
					},
					current,
				);
			}
			return withPaintMeta(defaultRadialGradient(seedColor, bounds), current);
		case "image-reference":
			return null;
		case "mesh-gradient":
			// Mesh is authored by its dedicated tool, not by inspector kind-conversion.
			return null;
	}
}

const replaceStops = (
	paint: GradientPaint,
	stops: readonly GradientStop[],
): GradientPaint => ({ ...paint, stops: bySortedOffset(stops) });

export function setStopColor(
	paint: GradientPaint,
	index: number,
	color: string,
): GradientPaint {
	return replaceStops(
		paint,
		paint.stops.map((stop, i) => (i === index ? { ...stop, color } : stop)),
	);
}

/** Sets one stop's opacity, clamped to [0, 1]; offsets/colors untouched. */
export function setStopOpacity(
	paint: GradientPaint,
	index: number,
	opacity: number,
): GradientPaint {
	const clamped = Number.isFinite(opacity)
		? Math.min(1, Math.max(0, opacity))
		: 1;
	return replaceStops(
		paint,
		paint.stops.map((stop, i) =>
			i === index ? { ...stop, opacity: clamped } : stop,
		),
	);
}

export function setStopOffset(
	paint: GradientPaint,
	index: number,
	offset: number,
): GradientPaint {
	const clamped = clampOffset(offset);
	return replaceStops(
		paint,
		paint.stops.map((stop, i) =>
			i === index ? { ...stop, offset: clamped } : stop,
		),
	);
}

/**
 * Inserts a stop in the widest offset gap, colored like the gap's lower stop, so
 * adding a stop never collapses two stops onto the same offset by default.
 */
export function addStop(paint: GradientPaint): GradientPaint {
	const sorted = bySortedOffset(paint.stops);
	let insertOffset = 0.5;
	let insertColor = sorted[0]?.color ?? DEFAULT_GRADIENT_END_COLOR;
	let widest = -1;
	for (let i = 0; i < sorted.length - 1; i += 1) {
		const lower = sorted[i];
		const upper = sorted[i + 1];
		const gap = upper.offset - lower.offset;
		if (gap > widest) {
			widest = gap;
			insertOffset = clampOffset((lower.offset + upper.offset) / 2);
			insertColor = lower.color;
		}
	}
	return replaceStops(paint, [
		...paint.stops,
		{ id: newStopId(), offset: insertOffset, color: insertColor },
	]);
}

/**
 * Removes a stop unless that would drop below {@link MIN_GRADIENT_STOPS}, which
 * keeps every authored gradient exportable as a real vector gradient. Returns
 * `null` when the removal is refused.
 */
export function removeStop(
	paint: GradientPaint,
	index: number,
): GradientPaint | null {
	if (paint.stops.length <= MIN_GRADIENT_STOPS) return null;
	if (index < 0 || index >= paint.stops.length) return null;
	return replaceStops(
		paint,
		paint.stops.filter((_, i) => i !== index),
	);
}

/**
 * Mirrors every stop across the ramp (`offset := 1 − offset`), preserving each
 * stop's id/color/opacity so the active selection survives the implicit re-sort.
 * Geometry (from/to, center) is untouched, so the gradient visually reverses in
 * place — the one-click "flip" users reach for in Figma/Illustrator.
 */
export function reverseStops(paint: GradientPaint): GradientPaint {
	return replaceStops(
		paint,
		paint.stops.map((stop) => ({
			...stop,
			offset: clampOffset(1 - stop.offset),
		})),
	);
}

/**
 * Linear gradient direction in degrees in node-local space, positive measured
 * clockwise from the +x axis (y-down canvas, matching SVG). The handle scene
 * applies the node matrix on top, so this is the raw axis angle the user edits.
 */
export function linearAngleDeg(paint: LinearGradientPaint): number {
	return (
		Math.atan2(paint.to.y - paint.from.y, paint.to.x - paint.from.x) *
		DEGREES_PER_RADIAN
	);
}

/**
 * Re-aims a linear gradient to `deg` by rotating about the line midpoint while
 * preserving the current axis length, so typing an angle never resizes a
 * hand-dragged endpoint. Sign convention matches {@link linearAngleDeg}.
 */
export function setLinearAngle(
	paint: LinearGradientPaint,
	deg: number,
): LinearGradientPaint {
	const cx = (paint.from.x + paint.to.x) / 2;
	const cy = (paint.from.y + paint.to.y) / 2;
	const half =
		Math.hypot(paint.to.x - paint.from.x, paint.to.y - paint.from.y) / 2;
	const rad = (Number.isFinite(deg) ? deg : 0) / DEGREES_PER_RADIAN;
	const dx = Math.cos(rad) * half;
	const dy = Math.sin(rad) * half;
	return {
		...paint,
		from: { x: cx - dx, y: cy - dy },
		to: { x: cx + dx, y: cy + dy },
	};
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
	x: lerp(a.x, b.x, t),
	y: lerp(a.y, b.y, t),
});

const TAU = Math.PI * 2;

/** Interpolates an angle along the shortest arc (radians), so a re-aim never spins the long way. */
const lerpAngle = (a: number, b: number, t: number): number => {
	let delta = (b - a) % TAU;
	if (delta > Math.PI) delta -= TAU;
	if (delta < -Math.PI) delta += TAU;
	return a + delta * t;
};

/**
 * Interpolates a linear gradient's axis in POLAR form — midpoint (cartesian),
 * direction (shortest-arc angle), and length each tween independently — so a rotating
 * gradient sweeps at constant shape instead of foreshortening. A naive cartesian lerp
 * of the two endpoints collapses the axis to a point at a 180° re-aim (the endpoints
 * cross through the midpoint); polar interpolation rotates cleanly through every angle.
 */
const interpolateLinearAxis = (
	from: LinearGradientPaint,
	to: LinearGradientPaint,
	t: number,
): Pick<LinearGradientPaint, "from" | "to"> => {
	const midX = lerp(
		(from.from.x + from.to.x) / 2,
		(to.from.x + to.to.x) / 2,
		t,
	);
	const midY = lerp(
		(from.from.y + from.to.y) / 2,
		(to.from.y + to.to.y) / 2,
		t,
	);
	const angleFrom = Math.atan2(
		from.to.y - from.from.y,
		from.to.x - from.from.x,
	);
	const angleTo = Math.atan2(to.to.y - to.from.y, to.to.x - to.from.x);
	const angle = lerpAngle(angleFrom, angleTo, t);
	const half =
		lerp(
			Math.hypot(from.to.x - from.from.x, from.to.y - from.from.y),
			Math.hypot(to.to.x - to.from.x, to.to.y - to.from.y),
			t,
		) / 2;
	const dx = Math.cos(angle) * half;
	const dy = Math.sin(angle) * half;
	return {
		from: { x: midX - dx, y: midY - dy },
		to: { x: midX + dx, y: midY + dy },
	};
};

const lerpStops = (
	from: readonly GradientStop[],
	to: readonly GradientStop[],
	t: number,
): readonly GradientStop[] =>
	from.map((stop, index) => {
		const target = to[index] ?? stop;
		return {
			...stop,
			offset: clampOffset(lerp(stop.offset, target.offset, t)),
			color: lerpHexColor(stop.color, target.color, t),
			opacity: lerp(stop.opacity ?? 1, target.opacity ?? 1, t),
		};
	});

/**
 * Tweens a linear/radial gradient fill between two keyframe snapshots: a linear axis
 * interpolates in polar form (midpoint + shortest-arc angle + length) so rotation
 * sweeps cleanly; a radial center/radius lerps cartesian; each stop (offset + sRGB
 * color + alpha) lerps pairwise. Holds (no tween) when the two snapshots differ in
 * kind or stop count — a same-shape pair is the common authored case (re-aim / rotate
 * / recolor / flow in place); cross-shape morphing is a deferred refinement. Mirrors
 * {@link interpolateMesh}, which the motion sampler calls for the mesh fill.
 */
export function interpolateGradient(
	from: GradientPaint,
	to: GradientPaint,
	t: number,
): GradientPaint {
	if (from.kind !== to.kind || from.stops.length !== to.stops.length) {
		return t >= 1 ? to : from;
	}
	const stops = lerpStops(from.stops, to.stops, t);
	if (from.kind === "linear-gradient" && to.kind === "linear-gradient") {
		return { ...from, ...interpolateLinearAxis(from, to, t), stops };
	}
	if (from.kind === "radial-gradient" && to.kind === "radial-gradient") {
		return {
			...from,
			center: lerpVec2(from.center, to.center, t),
			radius: lerpVec2(from.radius, to.radius, t),
			stops,
		};
	}
	return t >= 1 ? to : from;
}

const GRADIENT_BLEND_OFFSET_EPSILON = 1e-4;

const sampleGradientOpacityAt = (
	paint: GradientPaint,
	offset: number,
): number => {
	const sorted = bySortedOffset(paint.stops);
	const first = sorted[0];
	if (!first) return 1;
	const clamped = clampOffset(offset);
	if (clamped <= first.offset) return first.opacity ?? 1;
	const last = sorted[sorted.length - 1];
	if (clamped >= last.offset) return last.opacity ?? 1;
	for (let index = 0; index < sorted.length - 1; index += 1) {
		const lower = sorted[index];
		const upper = sorted[index + 1];
		if (clamped >= lower.offset && clamped <= upper.offset) {
			const span = upper.offset - lower.offset;
			const segmentT = span <= 0 ? 0 : (clamped - lower.offset) / span;
			return lerp(lower.opacity ?? 1, upper.opacity ?? 1, segmentT);
		}
	}
	return last.opacity ?? 1;
};

const unionStopOffsets = (
	from: GradientPaint,
	to: GradientPaint,
): readonly number[] => {
	const offsets = [...from.stops, ...to.stops]
		.map((stop) => clampOffset(stop.offset))
		.sort((left, right) => left - right);
	const unique: number[] = [];
	for (const offset of offsets) {
		const previous = unique[unique.length - 1];
		if (
			previous === undefined ||
			offset - previous > GRADIENT_BLEND_OFFSET_EPSILON
		) {
			unique.push(offset);
		}
	}
	return unique;
};

/**
 * Blend-grade gradient interpolation. Same-kind gradients with different stop
 * counts resample both color ramps at the union of their stop offsets and lerp
 * color/alpha per offset; the union contains every breakpoint of both ramps,
 * so t=0 and t=1 reproduce the endpoint gradients exactly while intermediates
 * tween smoothly instead of snapping mid-blend. Same-count pairs keep
 * {@link interpolateGradient}'s pairwise stop travel, and cross-kind pairs
 * still hold — this intentionally does NOT change the motion sampler's
 * documented hold-on-mismatch keyframe contract, which keeps calling
 * {@link interpolateGradient} directly.
 */
export function interpolateGradientForBlend(
	from: GradientPaint,
	to: GradientPaint,
	t: number,
): GradientPaint {
	if (from.kind !== to.kind || from.stops.length === to.stops.length) {
		return interpolateGradient(from, to, t);
	}
	const stops = unionStopOffsets(from, to).map(
		(offset): GradientStop => ({
			offset,
			color: lerpHexColor(
				sampleGradientColorAt(from, offset),
				sampleGradientColorAt(to, offset),
				t,
			),
			opacity: lerp(
				sampleGradientOpacityAt(from, offset),
				sampleGradientOpacityAt(to, offset),
				t,
			),
		}),
	);
	if (from.kind === "linear-gradient" && to.kind === "linear-gradient") {
		return { ...from, ...interpolateLinearAxis(from, to, t), stops };
	}
	if (from.kind === "radial-gradient" && to.kind === "radial-gradient") {
		return {
			...from,
			center: lerpVec2(from.center, to.center, t),
			radius: lerpVec2(from.radius, to.radius, t),
			stops,
		};
	}
	return t >= 1 ? to : from;
}

/**
 * Backfills stable ids onto any id-less stops, idempotent (existing ids kept). Use
 * at the editing boundary so legacy/id-less gradients become addressable by id
 * before the annotator, inspector ramp, or selection start tracking stops.
 */
export function hydrateGradientStops<T extends GradientPaint>(paint: T): T {
	if (paint.stops.every((stop) => stop.id)) return paint;
	return { ...paint, stops: paint.stops.map(withStopId) };
}

/**
 * Sorted-order index of the stop with `stopId`, or `-1`. Callers cache a stop's id
 * at gesture start and re-resolve the index per move, so selection survives the
 * re-sort that `replaceStops` runs on every offset edit.
 */
export function indexOfStop(paint: GradientPaint, stopId: string): number {
	return bySortedOffset(paint.stops).findIndex((stop) => stop.id === stopId);
}

/**
 * The color a gradient shows at `offset`, sRGB-lerped between the bracketing stops
 * (endpoints clamp to the nearest stop). Lets click-to-add seed a new stop with the
 * color already under the pointer so adding a stop never visibly jumps the fill.
 */
export function sampleGradientColorAt(
	paint: GradientPaint,
	offset: number,
): string {
	const sorted = bySortedOffset(paint.stops);
	const first = sorted[0];
	if (!first) return FALLBACK_GRADIENT_COLOR;
	const clamped = clampOffset(offset);
	if (clamped <= first.offset) return first.color;
	const last = sorted[sorted.length - 1];
	if (clamped >= last.offset) return last.color;
	for (let i = 0; i < sorted.length - 1; i += 1) {
		const lower = sorted[i];
		const upper = sorted[i + 1];
		if (clamped >= lower.offset && clamped <= upper.offset) {
			const span = upper.offset - lower.offset;
			const t = span <= 0 ? 0 : (clamped - lower.offset) / span;
			return lerpHexColor(lower.color, upper.color, t);
		}
	}
	return last.color;
}

/**
 * Inserts a stop at `offset`, minting a stable id and (when `color` is omitted)
 * sampling the interpolated color so the gradient does not jump. Returns the new
 * paint and the new stop's id so a caller can immediately select what it added.
 */
export function addStopAt(
	paint: GradientPaint,
	offset: number,
	color?: string,
): { readonly paint: GradientPaint; readonly stopId: string } {
	const clamped = clampOffset(offset);
	const id = newStopId();
	const stop: GradientStop = {
		id,
		offset: clamped,
		color: color ?? sampleGradientColorAt(paint, clamped),
	};
	return { paint: replaceStops(paint, [...paint.stops, stop]), stopId: id };
}

/** Moves one endpoint of a linear gradient (node-local coords); stops untouched. */
export function setLinearEndpoint(
	paint: LinearGradientPaint,
	which: "from" | "to",
	point: Vec2,
): LinearGradientPaint {
	return which === "from" ? { ...paint, from: point } : { ...paint, to: point };
}

/** Moves a radial gradient's center (node-local coords); radius/stops untouched. */
export function setRadialCenter(
	paint: RadialGradientPaint,
	center: Vec2,
): RadialGradientPaint {
	return { ...paint, center };
}

/**
 * The single scalar radius the renderer actually uses: SVG/canvas both collapse a
 * radial paint to a circle of `max(rx, ry)`, so the on-canvas handle is one value.
 */
export function radialScalarRadius(paint: RadialGradientPaint): number {
	return Math.max(paint.radius.x, paint.radius.y, 0);
}

/**
 * Sets a radial gradient to a circular radius (`rx = ry = radius`). Keeping the
 * radii uniform matches what the renderer draws, so the handle never drifts off
 * the painted edge. Elliptical radii would need an emitted gradient transform.
 */
export function setRadialRadius(
	paint: RadialGradientPaint,
	radius: number,
): RadialGradientPaint {
	const r = Number.isFinite(radius) ? Math.max(0, radius) : 0;
	return { ...paint, radius: { x: r, y: r } };
}
