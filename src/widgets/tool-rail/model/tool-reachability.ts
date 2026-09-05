import type { ShapeKind } from "@/features/draw/model/shape";
import { globalToolShortcut } from "@/features/tool-selection/model/tool-shortcuts";
import type { ToolId } from "@/features/tool-selection/model/tools";
import type { ActionShortcut, ShortcutModifier } from "@/shared/actions";

/** Tool ids that global action surfaces may activate directly by setting ToolId. */
export type ActivatableToolId = (typeof ACTIVATABLE_TOOL_IDS)[number];
/** Tool ids that ToolRail may activate, including variants routed to handlers. */
export type RailActivatableToolId = (typeof RAIL_ACTIVATABLE_TOOL_IDS)[number];
/** Tool ids that stay searchable but must not activate a missing handler. */
export type UnavailableToolId = (typeof UNAVAILABLE_TOOL_IDS)[number];
/** Complete set of tool ids intentionally represented in ToolRail/Quick Actions. */
export type DiscoverableToolId =
	| ActivatableToolId
	| RailActivatableToolId
	| UnavailableToolId;

export type ToolActivation = {
	readonly toolId: ToolId;
	readonly shapeKind?: ShapeKind;
};

/** Reachability metadata for a tool that has a working activation path. */
export type ActivatableToolReachability = {
	readonly kind: "activatable";
	readonly activation: ToolActivation;
	readonly shortcut?: ActionShortcut;
	readonly keywords: readonly string[];
};

/** Reachability metadata for a tool shell that should show why it cannot run. */
export type UnavailableToolReachability = {
	readonly kind: "unavailable";
	readonly reason: string;
	readonly shortcut?: ActionShortcut;
	readonly keywords: readonly string[];
};

/** Tool chrome contract consumed by ToolRail and ActionSurface. */
export type ToolReachability =
	| ActivatableToolReachability
	| UnavailableToolReachability;

const key = (value: string): ActionShortcut => ({ key: value });
const chord = (
	value: string,
	modifiers: readonly ShortcutModifier[],
): ActionShortcut => ({ key: value, modifiers });

/** Ordered tools that can be activated from runtime shortcuts or Quick Actions. */
export const ACTIVATABLE_TOOL_IDS = [
	"select",
	"direct-select",
	"hand",
	"frame",
	"pen",
	"pencil",
	"shape",
	"type",
	"eyedropper",
	"gradient",
	"noise-gradient",
	"mesh",
	"shape-builder",
	"blend",
	"motion-path",
	"path-blur",
	"effect",
] as const satisfies readonly ToolId[];

/** Ordered tools that can be activated from the rail without fake ToolIds. */
export const RAIL_ACTIVATABLE_TOOL_IDS = [
	"select",
	"direct-select",
	"hand",
	"frame",
	"pen",
	"pencil",
	"rectangle",
	"ellipse",
	"line",
	"type",
	"eyedropper",
	"gradient",
	"noise-gradient",
	"mesh",
	"shape-builder",
	"blend",
	"motion-path",
	"path-blur",
	"effect",
] as const satisfies readonly ToolId[];

/** Ordered unavailable tool shells that remain discoverable with disabled reasons. */
export const UNAVAILABLE_TOOL_IDS = [
	"arrow",
	"scale",
] as const satisfies readonly ToolId[];

/**
 * Ordered tool ids intentionally surfaced by the compact ToolRail. The five
 * shape primitives collapse into a single `shape` entry that ToolRail renders as
 * a flyout (rectangle/ellipse/line/polygon/star); the individual shape ids stay
 * in {@link RAIL_ACTIVATABLE_TOOL_IDS}/{@link DISCOVERABLE_TOOL_IDS} for the
 * command palette and reachability metadata.
 */
export const TOOL_RAIL_TOOL_IDS = [
	"select",
	"direct-select",
	"hand",
	"frame",
	"pen",
	"pencil",
	"shape",
	"type",
	"eyedropper",
	"gradient",
	"noise-gradient",
	"mesh",
	"shape-builder",
	"blend",
	"motion-path",
	"path-blur",
	"effect",
] as const satisfies readonly DiscoverableToolId[];

/** Ordered tool ids intentionally surfaced by the widget chrome. */
export const DISCOVERABLE_TOOL_IDS = [
	"select",
	"direct-select",
	"hand",
	"pen",
	"pencil",
	"shape",
	"rectangle",
	"ellipse",
	"line",
	"arrow",
	"scale",
	"frame",
	"type",
	"eyedropper",
	"gradient",
	"noise-gradient",
	"mesh",
	"shape-builder",
	"blend",
	"motion-path",
	"path-blur",
	"effect",
] as const satisfies readonly DiscoverableToolId[];

const direct = (toolId: ToolId): ToolActivation => ({ toolId });
const shapeVariant = (shapeKind: ShapeKind): ToolActivation => ({
	toolId: "shape",
	shapeKind,
});

const TOOL_REACHABILITY = {
	select: {
		kind: "activatable",
		activation: direct("select"),
		shortcut: globalToolShortcut("select"),
		keywords: ["move", "cursor"],
	},
	"direct-select": {
		kind: "activatable",
		activation: direct("direct-select"),
		shortcut: globalToolShortcut("direct-select"),
		keywords: ["anchor", "vector", "node"],
	},
	hand: {
		kind: "activatable",
		activation: direct("hand"),
		shortcut: globalToolShortcut("hand"),
		keywords: ["pan", "viewport", "move canvas", "space"],
	},
	pen: {
		kind: "activatable",
		activation: direct("pen"),
		shortcut: globalToolShortcut("pen"),
		keywords: ["bezier", "path", "draw"],
	},
	pencil: {
		kind: "activatable",
		activation: direct("pencil"),
		shortcut: globalToolShortcut("pencil"),
		keywords: ["freehand", "sketch", "draw", "path"],
	},
	shape: {
		kind: "activatable",
		activation: shapeVariant("rect"),
		shortcut: globalToolShortcut("shape"),
		keywords: ["rectangle", "ellipse", "line", "polygon", "star"],
	},
	rectangle: {
		kind: "activatable",
		activation: shapeVariant("rect"),
		keywords: ["shape", "box", "rect"],
	},
	ellipse: {
		kind: "activatable",
		activation: shapeVariant("ellipse"),
		keywords: ["shape", "circle", "oval"],
	},
	line: {
		kind: "activatable",
		activation: shapeVariant("line"),
		keywords: ["shape", "segment", "stroke"],
	},
	type: {
		kind: "activatable",
		activation: direct("type"),
		shortcut: globalToolShortcut("type"),
		keywords: ["text", "label"],
	},
	eyedropper: {
		kind: "activatable",
		activation: direct("eyedropper"),
		shortcut: globalToolShortcut("eyedropper"),
		keywords: ["color", "pick", "sample", "paint"],
	},
	gradient: {
		kind: "activatable",
		activation: direct("gradient"),
		shortcut: globalToolShortcut("gradient"),
		keywords: ["fill", "paint", "stop", "linear", "radial"],
	},
	"noise-gradient": {
		kind: "activatable",
		activation: direct("noise-gradient"),
		shortcut: globalToolShortcut("noise-gradient"),
		keywords: ["noise", "particle", "dissolve", "spray", "look"],
	},
	mesh: {
		kind: "activatable",
		activation: direct("mesh"),
		shortcut: globalToolShortcut("mesh"),
		keywords: ["gradient mesh", "paint", "point", "color"],
	},
	"shape-builder": {
		kind: "activatable",
		activation: direct("shape-builder"),
		shortcut: globalToolShortcut("shape-builder"),
		keywords: [
			"merge",
			"unite",
			"subtract",
			"intersect",
			"boolean",
			"pathfinder",
			"combine",
		],
	},
	blend: {
		kind: "activatable",
		activation: direct("blend"),
		shortcut: globalToolShortcut("blend"),
		keywords: ["blend", "steps", "interpolate", "morph"],
	},
	"motion-path": {
		kind: "activatable",
		activation: direct("motion-path"),
		shortcut: globalToolShortcut("motion-path"),
		keywords: ["animation", "trajectory", "path", "timeline"],
	},
	"path-blur": {
		kind: "activatable",
		activation: direct("path-blur"),
		shortcut: globalToolShortcut("path-blur"),
		keywords: ["path blur", "directional", "motion blur", "streak", "look"],
	},
	arrow: {
		kind: "unavailable",
		reason: "Arrowheads are not connected to the draw model yet.",
		shortcut: chord("l", ["shift"]),
		keywords: ["line", "connector", "arrowhead", "shape"],
	},
	scale: {
		kind: "unavailable",
		reason:
			"Resize handles exist; a persistent scale tool is not connected yet.",
		shortcut: key("k"),
		keywords: ["transform", "resize", "bounding box"],
	},
	frame: {
		kind: "activatable",
		activation: direct("frame"),
		shortcut: globalToolShortcut("frame"),
		keywords: ["artboard", "wrap", "container"],
	},
	effect: {
		kind: "activatable",
		activation: direct("effect"),
		shortcut: globalToolShortcut("effect"),
		keywords: ["effect field", "contour", "linear", "mesh", "influence"],
	},
} as const satisfies Record<DiscoverableToolId, ToolReachability>;

/**
 * Returns the widget reachability contract for tool chrome. The feature tool
 * union contains entries that are not rail actions yet, so callers fail closed
 * with a disabled reason instead of activating an unowned tool id.
 */
export function toolReachability(toolId: ToolId): ToolReachability {
	return (
		TOOL_REACHABILITY[toolId as DiscoverableToolId] ?? {
			kind: "unavailable",
			reason: "Tool is not available from this surface.",
			keywords: [],
		}
	);
}
