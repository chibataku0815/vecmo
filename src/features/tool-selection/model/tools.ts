import type { Icon } from "@phosphor-icons/react";
import {
	ArrowUp,
	BoundingBox,
	Circle,
	CircleHalf,
	CirclesThree,
	Cursor,
	Eyedropper,
	GridFour,
	HandPalm,
	Intersect,
	LineSegment,
	MagicWand,
	PencilSimple,
	PenNib,
	Scribble,
	Selection,
	Shapes,
	Square,
	TextT,
	VectorTwo,
	Wind,
} from "@phosphor-icons/react";

export type ToolId =
	| "select"
	| "direct-select"
	| "hand"
	| "pen"
	| "pencil"
	| "shape"
	| "rectangle"
	| "ellipse"
	| "line"
	| "arrow"
	| "scale"
	| "frame"
	| "type"
	| "eyedropper"
	| "gradient"
	| "noise-gradient"
	| "mesh"
	| "shape-builder"
	| "blend"
	| "motion-path"
	| "path-blur"
	| "effect";

export type EditorTool = {
	id: ToolId;
	label: string;
	Icon: Icon;
};

export const editorTools: EditorTool[] = [
	{ id: "select", label: "Select", Icon: Cursor },
	{
		id: "direct-select",
		label: "Direct Select",
		Icon: Selection,
	},
	{ id: "hand", label: "Hand", Icon: HandPalm },
	{ id: "pen", label: "Pen", Icon: PenNib },
	{ id: "pencil", label: "Pencil", Icon: PencilSimple },
	{ id: "shape", label: "Shape", Icon: Shapes },
	{ id: "rectangle", label: "Rectangle", Icon: Square },
	{ id: "ellipse", label: "Ellipse", Icon: Circle },
	{ id: "line", label: "Line", Icon: LineSegment },
	{ id: "arrow", label: "Arrow", Icon: ArrowUp },
	{ id: "scale", label: "Scale", Icon: BoundingBox },
	{ id: "frame", label: "Frame", Icon: BoundingBox },
	{ id: "type", label: "Type", Icon: TextT },
	{ id: "eyedropper", label: "Eyedropper", Icon: Eyedropper },
	{ id: "gradient", label: "Gradient", Icon: CircleHalf },
	{
		id: "noise-gradient",
		label: "Noise Gradient",
		Icon: Scribble,
	},
	{ id: "mesh", label: "Mesh", Icon: GridFour },
	{
		id: "shape-builder",
		label: "Shape Builder",
		Icon: Intersect,
	},
	{ id: "blend", label: "Blend", Icon: CirclesThree },
	{ id: "motion-path", label: "Motion Path", Icon: VectorTwo },
	{ id: "path-blur", label: "Path Blur", Icon: Wind },
	{ id: "effect", label: "Effect Field", Icon: MagicWand },
];

const editorToolById = new Map<ToolId, EditorTool>(
	editorTools.map((tool) => [tool.id, tool]),
);

/**
 * Resolves canonical chrome metadata for a tool id. Tool ordering differs by
 * surface, but labels/icons stay centralized so disabled shells and activatable
 * variants cannot drift.
 */
export function getEditorTool(toolId: ToolId): EditorTool {
	const tool = editorToolById.get(toolId);
	if (!tool) throw new Error(`Missing editor tool metadata for ${toolId}`);
	return tool;
}
