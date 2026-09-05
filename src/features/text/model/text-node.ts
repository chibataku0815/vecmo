import { createNode } from "@/entities/scene/model/factory";
import {
	abortGestureTransaction,
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import {
	createAppendNodeCommand,
	createUpdateTextNodeContentCommand,
} from "@/entities/scene/model/node-commands";
import {
	DEFAULT_TEXT_STYLE,
	normalizeTextContent,
	normalizeTextGeometry,
	resizedTextBoundsForGeometry,
	type TextMetrics,
	textBoundsForContent as textBoundsForStyledContent,
	textMetricsForContent,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Bounds,
	TextGeometry,
	TextResizeMode,
	TextStyle,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type TextEditSessionSource,
	useTextEditStore,
} from "./text-edit-store";

export const DEFAULT_TEXT_CONTENT = "Text";
export const TEXT_FONT_SIZE = DEFAULT_TEXT_STYLE.fontSize;
export const TEXT_LINE_HEIGHT = DEFAULT_TEXT_STYLE.lineHeight;

export type TextDraftLayout = {
	readonly bounds: Bounds;
	readonly metrics: TextMetrics;
	readonly style: TextStyle;
};

export type BeginTextEditingOptions = {
	readonly transaction?: GestureTransaction;
};

/**
 * Estimates editable bounds for scene text from the same deterministic metrics
 * used by render/export adapters, without introducing DOM font measurement.
 */
export function textBoundsForContent(
	origin: Vec2,
	text: string,
	style: Partial<TextStyle> = DEFAULT_TEXT_STYLE,
): Bounds {
	return textBoundsForStyledContent(origin, text, style);
}

/**
 * Resizes an existing text box from its current origin while preserving the text
 * geometry shape. This is intentionally content-only, not rich text layout.
 */
export function resizedTextBoundsForContent(
	current: Bounds,
	text: string,
	style?: Partial<TextStyle>,
	mode: TextResizeMode = "point",
): Bounds {
	return resizedTextBoundsForGeometry(current, text, style, mode);
}

/**
 * Derives the live canvas editing footprint for an existing text node. The
 * overlay consumes this so styled text drafts use the node's own typography
 * before commit, matching the command-bus resize that will be written later.
 */
export function textDraftLayoutForGeometry(
	geometry: TextGeometry,
	draftText: string,
): TextDraftLayout {
	const normalized = normalizeTextGeometry(geometry);
	const bounds =
		normalized.mode === "area"
			? geometry.bounds
			: resizedTextBoundsForGeometry(
					geometry.bounds,
					draftText,
					normalized.style,
					normalized.mode,
				);
	return {
		bounds,
		metrics: textMetricsForContent(
			bounds,
			draftText,
			normalized.style,
			normalized.mode,
		),
		style: normalized.style,
	};
}

/**
 * Creates the default text node authored by the Type tool at an artboard point.
 * The node is fully serializable and enters the document only through a command.
 */
export function createCanvasTextNode(
	point: Vec2,
	text = DEFAULT_TEXT_CONTENT,
	artboardId?: string | null,
): VectorNode {
	const normalized = normalizeTextContent(text);
	const node = createNode(
		"text",
		{
			kind: "text",
			bounds: textBoundsForStyledContent(point, normalized, DEFAULT_TEXT_STYLE),
			text: normalized,
			style: DEFAULT_TEXT_STYLE,
		},
		{
			name: "text",
			style: {
				fill: "#191817",
				stroke: "none",
				strokeWidth: 0,
			},
		},
	);
	return artboardId ? { ...node, artboardId } : node;
}

/**
 * Creates a fixed-width area text node. The initial height is authored by the
 * drag rectangle, while later content/style edits may expand it to fit wrapped
 * lines without changing its width.
 */
export function createCanvasAreaTextNode(
	bounds: Bounds,
	text = DEFAULT_TEXT_CONTENT,
	artboardId?: string | null,
): VectorNode {
	const normalized = normalizeTextContent(text);
	const node = createNode(
		"text",
		{
			kind: "text",
			bounds: {
				x: bounds.x,
				y: bounds.y,
				width: Math.max(TEXT_FONT_SIZE, bounds.width),
				height: Math.max(TEXT_LINE_HEIGHT, bounds.height),
			},
			text: normalized,
			mode: "area",
			style: DEFAULT_TEXT_STYLE,
		},
		{
			name: "text",
			style: {
				fill: "#191817",
				stroke: "none",
				strokeWidth: 0,
			},
		},
	);
	return artboardId ? { ...node, artboardId } : node;
}

/**
 * Inserts a text node through the scene command bus and reports whether the
 * document actually changed, so selection/edit side effects stay conditional.
 */
export function insertTextNode(node: VectorNode): boolean {
	const store = useSceneStore.getState();
	const before = store.document;
	store.apply(createAppendNodeCommand(node, { label: "Add text" }));
	return useSceneStore.getState().document !== before;
}

/**
 * Starts editing a live text node. Any previous text draft is first committed so
 * switching between text nodes cannot silently drop user input.
 */
export function beginTextEditing(
	nodeId: string,
	source: TextEditSessionSource,
	options: BeginTextEditingOptions = {},
): boolean {
	const current = useTextEditStore.getState().session;
	if (current && current.nodeId !== nodeId) commitActiveTextEditing();

	const node = findNode(useSceneStore.getState().document, nodeId);
	if (node?.geometry.kind !== "text") return false;
	const transaction =
		options.transaction ??
		beginGestureTransaction(
			`text:${source}:${nodeId}`,
			source === "new" ? "Add text" : "Edit text",
		);
	useTextEditStore.getState().start({
		nodeId,
		originalText: node.geometry.text,
		draftText: node.geometry.text,
		source,
		transaction,
	});
	return true;
}

/**
 * Commits the active canvas text draft as one undoable scene edit. Blank fresh
 * text still aborts the creation transaction so the canvas never keeps empty
 * placeholder nodes.
 */
export function commitActiveTextEditing(): boolean {
	const session = useTextEditStore.getState().session;
	if (!session) return false;

	const store = useSceneStore.getState();
	const node = findNode(store.document, session.nodeId);
	if (node?.geometry.kind !== "text") {
		if (session.transaction) abortGestureTransaction(session.transaction);
		useTextEditStore.getState().clear();
		return false;
	}

	const nextText = normalizeTextContent(session.draftText);
	if (session.source === "new" && nextText.trim().length === 0) {
		if (session.transaction) abortGestureTransaction(session.transaction);
		useTextEditStore.getState().clear();
		return false;
	}
	const mode = node.geometry.mode ?? "point";
	const bounds =
		mode === "area"
			? node.geometry.bounds
			: resizedTextBoundsForContent(
					node.geometry.bounds,
					nextText,
					node.geometry.style,
					mode,
				);
	const before = store.document;
	store.apply(
		createUpdateTextNodeContentCommand(session.nodeId, nextText, { bounds }),
	);
	useTextEditStore.getState().clear();
	if (session.transaction) commitGestureTransaction(session.transaction);
	return useSceneStore.getState().document !== before;
}

/** Cancels the active draft without mutating the scene or undo history. */
export function cancelActiveTextEditing(): void {
	const session = useTextEditStore.getState().session;
	if (session?.transaction) abortGestureTransaction(session.transaction);
	useTextEditStore.getState().clear();
}
