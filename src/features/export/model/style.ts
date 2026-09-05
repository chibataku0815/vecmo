import {
	type ResolvedEffect,
	type ResolvedNodeStyle,
	type ResolvedPaint,
	resolveNodeStyle,
} from "@/entities/scene/model/style-resolve";
import type { VectorNode } from "@/entities/scene/model/types";

export type ExportPaintRole = "fill" | "stroke";

export type ExportAppearanceFidelityStatus =
	| "approximated"
	| "preserved"
	| "unsupported";

/**
 * Compact manifest payload that explains which appearance capabilities a render
 * asset preserved, approximated, or could not represent. The strings are
 * intentionally renderer-neutral and sorted at finalization so reports can
 * compare SVG/PDF fidelity without parsing asset bytes.
 */
export type ExportAppearanceFidelity = Readonly<
	Record<ExportAppearanceFidelityStatus, readonly string[]>
>;

export type ExportAppearanceFidelityTracker = {
	readonly approximated: Set<string>;
	readonly preserved: Set<string>;
	readonly unsupported: Set<string>;
};

/** Creates a mutable appearance-fidelity collector for one render asset. */
export function createExportAppearanceFidelityTracker(): ExportAppearanceFidelityTracker {
	return {
		approximated: new Set<string>(),
		preserved: new Set<string>(),
		unsupported: new Set<string>(),
	};
}

/** Records one deterministic appearance capability in the requested bucket. */
export function recordExportAppearanceFidelity(
	tracker: ExportAppearanceFidelityTracker,
	status: ExportAppearanceFidelityStatus,
	capability: string,
): void {
	tracker[status].add(capability);
}

/** Freezes and sorts the collected capabilities for manifest serialization. */
export function finalizeExportAppearanceFidelity(
	tracker: ExportAppearanceFidelityTracker,
): ExportAppearanceFidelity {
	const sorted = (values: ReadonlySet<string>): readonly string[] =>
		[...values].sort((left, right) => left.localeCompare(right));
	return {
		approximated: sorted(tracker.approximated),
		preserved: sorted(tracker.preserved),
		unsupported: sorted(tracker.unsupported),
	};
}

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	return String(rounded);
};

const pointSummary = (point: {
	readonly x: number;
	readonly y: number;
}): string => `${formatNumber(point.x)},${formatNumber(point.y)}`;

const isVisibleColor = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized !== "" && normalized !== "none" && normalized !== "transparent"
	);
};

/**
 * Resolves a node style once for export adapters so SVG, PDF, and bundle issue
 * metadata share the same expressive paint/effect/stroke defaults.
 */
export function resolveExportNodeStyle(node: VectorNode): ResolvedNodeStyle {
	return resolveNodeStyle(node.style);
}

/** Returns the resolved paint stack for one SVG/PDF paint role. */
export function paintListForRole(
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
): readonly ResolvedPaint[] {
	return role === "fill" ? style.fills : style.strokes;
}

/** Returns the legacy color that backs omitted expressive paint lists. */
export function legacyColorForRole(
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
): string {
	return role === "fill" ? style.fill : style.stroke;
}

/** Filters out hidden effects so exporters only report visible fidelity loss. */
export function visibleStyleEffects(
	style: ResolvedNodeStyle,
): readonly ResolvedEffect[] {
	return style.effects.filter((effect) => effect.visible);
}

/** Builds compact deterministic labels for style fallback issue messages. */
export function paintKindSummary(paint: ResolvedPaint): string {
	switch (paint.kind) {
		case "solid":
			return `solid:${paint.color}`;
		case "linear-gradient":
			return `linear-gradient:${pointSummary(paint.from)}->${pointSummary(paint.to)}:${paint.stops.length}-stops`;
		case "radial-gradient":
			return `radial-gradient:${pointSummary(paint.center)}:${pointSummary(paint.radius)}:${paint.stops.length}-stops`;
		case "image-reference":
			return `image-reference:${paint.assetId ?? paint.href ?? "unresolved"}`;
		case "mesh-gradient":
			return `mesh-gradient:${paint.rows}x${paint.cols}:${paint.points.length}-points`;
	}
}

/** Builds a stable comma-separated paint-stack label for metadata messages. */
export function paintListSummary(paints: readonly ResolvedPaint[]): string {
	return paints.map(paintKindSummary).join(", ");
}

/**
 * Chooses a deterministic visible fallback color without inventing renderer
 * behavior: solid paint, first gradient stop, legacy color, then caller default.
 */
export function fallbackColorForRole(
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
	defaultColor: string,
): string {
	const paints = paintListForRole(style, role);
	for (const paint of paints) {
		if (paint.kind === "solid" && isVisibleColor(paint.color))
			return paint.color;
		if (
			(paint.kind === "linear-gradient" || paint.kind === "radial-gradient") &&
			paint.stops[0] &&
			isVisibleColor(paint.stops[0].color)
		) {
			return paint.stops[0].color;
		}
		if (
			paint.kind === "mesh-gradient" &&
			paint.points[0] &&
			isVisibleColor(paint.points[0].color)
		) {
			return paint.points[0].color;
		}
	}

	const legacy = legacyColorForRole(style, role);
	return isVisibleColor(legacy) ? legacy : defaultColor;
}
