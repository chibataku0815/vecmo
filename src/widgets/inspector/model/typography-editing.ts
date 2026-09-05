/**
 * Inspector editing for typography (text content/style/box), corner radius, and
 * star/polygon corner radius — the shape-and-text geometry surface of the Inspector.
 */
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	areCornersUniform,
	resolveCornerRadii,
} from "@/entities/scene/model/corner-geometry";
import {
	createResizeTextBoxCommand,
	createUpdateCornerSmoothingCommand,
	createUpdatePolygonStarCornerRadiusCommand,
	createUpdateRectCornerRadiiCommand,
	createUpdateRectCornerRadiusCommand,
	createUpdateTextNodeCommand,
	type TextBoxResizePatch,
	type TextStylePatch,
} from "@/entities/scene/model/node-commands";
import {
	normalizeTextGeometry,
	textLayoutForGeometry,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	isBoldWeight,
	resolveBoldToggleWeight,
	resolveTextFlagToggle,
} from "@/entities/scene/model/text-geometry";
import type {
	TextResizeMode,
	TextStyle,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	applyCommandsAsTransaction,
	type MixedValue,
	mixedValue,
	normalizeFontFamilyInput,
	normalizeTextAlignInput,
	type TextBoxEditingState,
	type TextEditingState,
	type TextStyleEditingState,
	type TextStyleNumberField,
	uniqueNodeIds,
} from "./editing-shared";

/**
 * Returns the text-editing state for a selection without requiring the UI to
 * understand geometry internals. Mixed selections edit only text nodes, while
 * non-text nodes remain selected and untouched by text commits.
 */
export function textEditingStateForSelection(
	nodes: readonly VectorNode[],
): TextEditingState {
	const textNodes = nodes.filter((node) => node.geometry.kind === "text");
	return {
		value: mixedValue(textNodes, (node) =>
			node.geometry.kind === "text" ? node.geometry.text : "",
		),
		textNodeIds: textNodes.map((node) => node.id),
		textNodeCount: textNodes.length,
		totalNodeCount: nodes.length,
		hasNonTextSelection: textNodes.length < nodes.length,
		canEdit: textNodes.length > 0,
	};
}

const textStyleForNode = (node: VectorNode): TextStyle => {
	if (node.geometry.kind !== "text") {
		throw new Error("Cannot read text style from a non-text node.");
	}
	return normalizeTextGeometry(node.geometry).style;
};

const textGeometryForNode = (node: VectorNode) => {
	if (node.geometry.kind !== "text") {
		throw new Error("Cannot read text geometry from a non-text node.");
	}
	return node.geometry;
};

/**
 * Returns typography state for the selected text-node subset. Non-text nodes are
 * ignored for value aggregation but still reported so the UI can show batch
 * scope accurately instead of leaking stale drafts across selection changes.
 */
export function textStyleEditingStateForSelection(
	nodes: readonly VectorNode[],
): TextStyleEditingState {
	const textNodes = nodes.filter((node) => node.geometry.kind === "text");
	return {
		values: {
			fontFamily: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).fontFamily,
			),
			fontSize: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).fontSize,
			),
			lineHeight: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).lineHeight,
			),
			align: mixedValue(textNodes, (node) => textStyleForNode(node).align),
			fontWeight: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).fontWeight,
			),
			letterSpacing: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).letterSpacing,
			),
			bold: mixedValue(textNodes, (node) =>
				isBoldWeight(textStyleForNode(node).fontWeight),
			),
			italic: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).italic ?? false,
			),
			underline: mixedValue(
				textNodes,
				(node) => textStyleForNode(node).underline ?? false,
			),
			fill: mixedValue(textNodes, (node) => node.style.fill),
		},
		textNodeIds: textNodes.map((node) => node.id),
		textNodeCount: textNodes.length,
		totalNodeCount: nodes.length,
		hasNonTextSelection: textNodes.length < nodes.length,
		canEdit: textNodes.length > 0,
	};
}

const finiteScale = (value: number): number =>
	Number.isFinite(value) && Math.abs(value) > 0 ? Math.abs(value) : 1;

/**
 * Returns authored text-box dimensions for the selected text subset. Width and
 * height are projected through node scale so the numbers match the Inspector's
 * transform fields while commits still update `TextGeometry.bounds`.
 */
export function textBoxEditingStateForSelection(
	nodes: readonly VectorNode[],
): TextBoxEditingState {
	const textNodes = nodes.filter((node) => node.geometry.kind === "text");
	return {
		values: {
			mode: mixedValue(
				textNodes,
				(node) => normalizeTextGeometry(textGeometryForNode(node)).mode,
			),
			width: mixedValue(
				textNodes,
				(node) =>
					textGeometryForNode(node).bounds.width *
					finiteScale(node.transform.scale.x),
			),
			height: mixedValue(
				textNodes,
				(node) =>
					textGeometryForNode(node).bounds.height *
					finiteScale(node.transform.scale.y),
			),
			overflowY: mixedValue(
				textNodes,
				(node) =>
					textLayoutForGeometry(textGeometryForNode(node)).overflowY *
					finiteScale(node.transform.scale.y),
			),
			fits: mixedValue(
				textNodes,
				(node) => textLayoutForGeometry(textGeometryForNode(node)).fits,
			),
		},
		textNodeIds: textNodes.map((node) => node.id),
		textNodeCount: textNodes.length,
		totalNodeCount: nodes.length,
		hasNonTextSelection: textNodes.length < nodes.length,
		canEdit: textNodes.length > 0,
	};
}

function createCornerRadiusCommands(
	nodeIds: readonly string[],
	cornerRadius: number,
): SceneCommand[] {
	return [...new Set(nodeIds)].map((nodeId) =>
		createUpdateRectCornerRadiusCommand(nodeId, cornerRadius),
	);
}

function createTextContentCommands(
	nodeIds: readonly string[],
	text: string,
): SceneCommand[] {
	return [...new Set(nodeIds)].map((nodeId) =>
		createUpdateTextNodeCommand(nodeId, { text }, { label: "Edit text" }),
	);
}

function createTextStyleCommands(
	nodeIds: readonly string[],
	patch: TextStylePatch,
): SceneCommand[] {
	return [...new Set(nodeIds)].map((nodeId) =>
		createUpdateTextNodeCommand(
			nodeId,
			{ style: patch },
			{ label: "Edit text style" },
		),
	);
}

const isTextResizeModeInput = (value: string): value is TextResizeMode =>
	value === "point" || value === "area";

const textBoxPatchForNode = (
	node: VectorNode,
	field: "width" | "height",
	value: number,
): TextBoxResizePatch | null => {
	if (node.geometry.kind !== "text" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	const scale =
		field === "width"
			? finiteScale(node.transform.scale.x)
			: finiteScale(node.transform.scale.y);
	const localValue = value / scale;
	return {
		mode: "area",
		bounds: {
			...node.geometry.bounds,
			[field]: localValue,
		},
	};
};

/**
 * Commits point/area conversion through the text-box command. Point mode
 * re-resolves natural content bounds; area mode preserves the current authored
 * bounds and only makes wrapping explicit.
 */
export function commitTextBoxMode(
	nodeIds: readonly string[],
	input: string,
): boolean {
	if (!isTextResizeModeInput(input) || nodeIds.length === 0) return false;
	return applyCommandsAsTransaction(
		`text-box:mode:${nodeIds.join(",")}`,
		"Edit text box",
		uniqueNodeIds(nodeIds).map((nodeId) =>
			createResizeTextBoxCommand(nodeId, { mode: input }),
		),
	);
}

/**
 * Commits authored area-text box dimensions. Editing either dimension is an
 * explicit fixed-box action, so point text converts to area text first.
 */
export function commitTextBoxNumber(
	nodeIds: readonly string[],
	field: "width" | "height",
	value: number,
): boolean {
	if (!Number.isFinite(value) || value <= 0 || nodeIds.length === 0) {
		return false;
	}
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (node?.geometry.kind !== "text") return [];
		const patch = textBoxPatchForNode(node, field, value);
		return patch ? [createResizeTextBoxCommand(nodeId, patch)] : [];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`text-box:${field}:${nodeIds.join(",")}`,
		"Edit text box",
		commands,
	);
}

/**
 * Validates numeric typography drafts before they reach scene text commands.
 * Font size and line height use positive scene units; font weight follows the
 * normalized 1..1000 text-style contract instead of relying on command clamps.
 */
export function normalizeTextStyleNumberInput(
	field: TextStyleNumberField,
	value: number,
): number | null {
	if (!Number.isFinite(value)) return null;
	if (field === "fontWeight") {
		const rounded = Math.round(value);
		return rounded >= 1 && rounded <= 1000 ? rounded : null;
	}
	// Tracking accepts any finite value, including negatives and 0; size and
	// line height stay strictly positive scene units.
	if (field === "letterSpacing") return value;
	return value > 0 ? value : null;
}

const textStyleNumberPatch = (
	field: TextStyleNumberField,
	value: number,
): TextStylePatch | null => {
	const normalized = normalizeTextStyleNumberInput(field, value);
	if (normalized === null) return null;
	if (field === "fontWeight") return { fontWeight: normalized };
	if (field === "fontSize") return { fontSize: normalized };
	if (field === "letterSpacing") return { letterSpacing: normalized };
	return { lineHeight: normalized };
};

/**
 * Commits rounded-corner edits to rect nodes only. Non-rect selections remain in
 * the batch so mixed selections can share one undoable inspector action.
 */
export function commitCornerRadius(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value) || value < 0) return false;
	return applyCommandsAsTransaction(
		`corner-radius:${nodeIds.join(",")}`,
		"Edit corner radius",
		createCornerRadiusCommands(nodeIds, value),
	);
}

/** A rect/frame corner identifier for per-corner radius editing. */
export type CornerKey = "tl" | "tr" | "br" | "bl";

/**
 * Reads each per-corner radius across the rect subset of a selection, resolving
 * the uniform fallback so a uniform rect reports four equal values. Non-rect
 * nodes are excluded (commits apply to the rect subset only).
 */
export function rectCornerRadiiValue(
	nodes: readonly VectorNode[],
): Record<CornerKey, MixedValue<number> | null> | null {
	const rects = nodes.filter((node) => node.geometry.kind === "rect");
	if (rects.length === 0) return null;
	const read = (key: CornerKey): MixedValue<number> | null =>
		mixedValue(rects, (node) =>
			node.geometry.kind === "rect"
				? resolveCornerRadii(node.geometry)[key]
				: 0,
		);
	return { tl: read("tl"), tr: read("tr"), br: read("br"), bl: read("bl") };
}

/**
 * Whether any selected rect currently has independent (non-uniform) corners.
 * Used to seed the inspector's "Independent corners" toggle from the data.
 */
export function rectCornersIndependent(nodes: readonly VectorNode[]): boolean {
	return nodes.some(
		(node) =>
			node.geometry.kind === "rect" &&
			node.geometry.cornerRadii !== undefined &&
			!areCornersUniform(resolveCornerRadii(node.geometry)),
	);
}

/** Reads whole-shape corner smoothing across the rect subset (0 when absent). */
export function rectCornerSmoothingValue(
	nodes: readonly VectorNode[],
): MixedValue<number> | null {
	const rects = nodes.filter((node) => node.geometry.kind === "rect");
	if (rects.length === 0) return null;
	return mixedValue(rects, (node) =>
		node.geometry.kind === "rect" ? (node.geometry.cornerSmoothing ?? 0) : 0,
	);
}

/** Commits a single corner's radius to the rect subset as one undoable edit. */
export function commitPerCornerRadius(
	nodeIds: readonly string[],
	corner: CornerKey,
	value: number,
): boolean {
	if (!Number.isFinite(value) || value < 0) return false;
	return applyCommandsAsTransaction(
		`corner-radii:${corner}:${nodeIds.join(",")}`,
		"Edit corner radius",
		[...new Set(nodeIds)].map((nodeId) =>
			createUpdateRectCornerRadiiCommand(nodeId, { [corner]: value }),
		),
	);
}

/** Reads the uniform corner radius across the star/polygon subset (0 absent). */
export function starPolygonCornerRadiusValue(
	nodes: readonly VectorNode[],
): MixedValue<number> | null {
	const shapes = nodes.filter(
		(node) => node.geometry.kind === "star" || node.geometry.kind === "polygon",
	);
	if (shapes.length === 0) return null;
	return mixedValue(shapes, (node) =>
		node.geometry.kind === "star" || node.geometry.kind === "polygon"
			? (node.geometry.cornerRadius ?? 0)
			: 0,
	);
}

/** Commits the uniform corner radius to the star/polygon subset. */
export function commitStarPolygonCornerRadius(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value) || value < 0) return false;
	return applyCommandsAsTransaction(
		`star-corner-radius:${nodeIds.join(",")}`,
		"Edit corner radius",
		[...new Set(nodeIds)].map((nodeId) =>
			createUpdatePolygonStarCornerRadiusCommand(nodeId, value),
		),
	);
}

/** Commits whole-shape corner smoothing (0..1) to the roundable subset. */
export function commitCornerSmoothing(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = Math.min(1, Math.max(0, value));
	return applyCommandsAsTransaction(
		`corner-smoothing:${nodeIds.join(",")}`,
		"Edit corner smoothing",
		[...new Set(nodeIds)].map((nodeId) =>
			createUpdateCornerSmoothingCommand(nodeId, clamped),
		),
	);
}

/**
 * Commits text content to the selected text-node subset as one Inspector action.
 * Empty content and multiline content are valid scene values; missing and
 * non-text ids produce no patches, so they do not create empty undo entries.
 */
export function commitTextContent(
	nodeIds: readonly string[],
	text: string,
): boolean {
	if (nodeIds.length === 0) return false;
	return applyCommandsAsTransaction(
		`text:${nodeIds.join(",")}`,
		"Edit text",
		createTextContentCommands(nodeIds, text),
	);
}

/**
 * Commits only curated code-safe font-family stacks to selected text nodes.
 * Empty or arbitrary family drafts stay in widget state and reset on blur
 * instead of becoming loosely validated scene strings.
 */
export function commitTextFontFamily(
	nodeIds: readonly string[],
	input: string,
): boolean {
	const fontFamily = normalizeFontFamilyInput(input);
	if (!fontFamily || nodeIds.length === 0) return false;
	return applyCommandsAsTransaction(
		`text-style:fontFamily:${nodeIds.join(",")}`,
		"Edit text style",
		createTextStyleCommands(nodeIds, { fontFamily }),
	);
}

/**
 * Commits positive text style numbers through the text-node command helper.
 * Font size and line height are scene units; weight follows the normalized
 * OpenType-like 1..1000 domain used by `normalizeTextGeometry`.
 */
export function commitTextStyleNumber(
	nodeIds: readonly string[],
	field: TextStyleNumberField,
	value: number,
): boolean {
	const patch = textStyleNumberPatch(field, value);
	if (!patch || nodeIds.length === 0) return false;
	return applyCommandsAsTransaction(
		`text-style:${field}:${nodeIds.join(",")}`,
		"Edit text style",
		createTextStyleCommands(nodeIds, patch),
	);
}

/**
 * Commits text alignment after validating the small scene alignment union.
 * Unsupported drafts are rejected before they can reach the scene command bus.
 */
export function commitTextAlign(
	nodeIds: readonly string[],
	input: string,
): boolean {
	const align = normalizeTextAlignInput(input);
	if (!align || nodeIds.length === 0) return false;
	return applyCommandsAsTransaction(
		`text-style:align:${nodeIds.join(",")}`,
		"Edit text style",
		createTextStyleCommands(nodeIds, { align }),
	);
}

/**
 * Resolves the live text nodes for a selection so a toggle decides its next
 * value from current scene state rather than a stale widget snapshot. Non-text
 * ids are dropped, so mixed selections only ever restyle text geometry.
 */
const liveTextNodes = (nodeIds: readonly string[]): readonly VectorNode[] => {
	const document = useSceneStore.getState().document;
	return uniqueNodeIds(nodeIds)
		.map((nodeId) => findNode(document, nodeId))
		.filter((node): node is VectorNode => node?.geometry.kind === "text");
};

const applyTextStyleToggle = (
	textNodes: readonly VectorNode[],
	scope: string,
	label: string,
	patch: TextStylePatch,
): boolean =>
	applyCommandsAsTransaction(
		`text-style:${scope}:${textNodes.map((node) => node.id).join(",")}`,
		label,
		createTextStyleCommands(
			textNodes.map((node) => node.id),
			patch,
		),
	);

/**
 * Toggles bold across the selected text nodes as one undoable Inspector action.
 * Bold maps onto numeric font weight (the {@link isBoldWeight} heuristic); a
 * fully-bold selection turns regular, otherwise the whole selection turns bold.
 */
export function commitToggleTextBold(nodeIds: readonly string[]): boolean {
	const textNodes = liveTextNodes(nodeIds);
	if (textNodes.length === 0) return false;
	const fontWeight = resolveBoldToggleWeight(
		textNodes.map((node) => textStyleForNode(node).fontWeight),
	);
	return applyTextStyleToggle(textNodes, "bold", "Toggle bold", { fontWeight });
}

/**
 * Toggles italic across the selected text nodes as one undoable Inspector action.
 * Note: the italic glyph render is part of the deferred italic/underline render
 * bridge; this updates scene/undo state correctly today.
 */
export function commitToggleTextItalic(nodeIds: readonly string[]): boolean {
	const textNodes = liveTextNodes(nodeIds);
	if (textNodes.length === 0) return false;
	const italic = resolveTextFlagToggle(
		textNodes.map((node) => textStyleForNode(node).italic ?? false),
	);
	return applyTextStyleToggle(textNodes, "italic", "Toggle italic", { italic });
}

/**
 * Toggles underline across the selected text nodes as one undoable Inspector
 * action. Like {@link commitToggleTextItalic}, the visible underline is part of
 * the deferred render bridge; scene/undo state is correct today.
 */
export function commitToggleTextUnderline(nodeIds: readonly string[]): boolean {
	const textNodes = liveTextNodes(nodeIds);
	if (textNodes.length === 0) return false;
	const underline = resolveTextFlagToggle(
		textNodes.map((node) => textStyleForNode(node).underline ?? false),
	);
	return applyTextStyleToggle(textNodes, "underline", "Toggle underline", {
		underline,
	});
}
