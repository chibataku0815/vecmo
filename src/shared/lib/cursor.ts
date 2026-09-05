export type HoverOctant =
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "nw"
	| "rotate";

export type EditorCursor =
	| "default"
	| "crosshair"
	| "grab"
	| "grabbing"
	| "move"
	| "pointer"
	| "text"
	| "rotate"
	| "nesw-resize"
	| "nwse-resize"
	| "ns-resize"
	| "ew-resize";

export type CursorTool =
	| "select"
	| "direct-select"
	| "pen"
	| "shape"
	| "type"
	| "motion-path"
	| "effect";

const resizeCursors: Record<HoverOctant, EditorCursor> = {
	n: "ns-resize",
	ne: "nesw-resize",
	e: "ew-resize",
	se: "nwse-resize",
	s: "ns-resize",
	sw: "nesw-resize",
	w: "ew-resize",
	nw: "nwse-resize",
	rotate: "rotate",
};

/**
 * Shared cursor vocabulary for canvas tools. Feature handlers feed hover state
 * into this service instead of inventing tool-local cursor strings.
 */
export function cursorForTool(
	tool: CursorTool,
	hover?: HoverOctant,
	dragging = false,
): EditorCursor {
	if (dragging) return "grabbing";
	if (hover) return resizeCursors[hover];
	if (tool === "pen" || tool === "shape") return "crosshair";
	if (tool === "type") return "text";
	if (tool === "direct-select") return "pointer";
	if (tool === "select") return "default";
	return "grab";
}
