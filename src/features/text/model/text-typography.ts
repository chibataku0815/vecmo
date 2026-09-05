import {
	createUpdateTextNodeCommand,
	type TextStylePatch,
} from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	BOLD_FONT_WEIGHT,
	isBoldWeight,
	normalizeTextGeometry,
	REGULAR_FONT_WEIGHT,
} from "@/entities/scene/model/text-geometry";
import type {
	TextGeometry,
	TextStyle,
	VectorNode,
} from "@/entities/scene/model/types";
import { useTextEditStore } from "./text-edit-store";

type TextNode = VectorNode & { readonly geometry: TextGeometry };

/**
 * Resolves the text node currently bound to the inline edit session, if any.
 * Typography toggles target this node so editing a word and changing its weight
 * read as one continuous authoring gesture rather than a separate selection step.
 */
function activeTextNode(): TextNode | null {
	const session = useTextEditStore.getState().session;
	if (!session) return null;
	const node = findNode(useSceneStore.getState().document, session.nodeId);
	if (node?.geometry.kind !== "text") return null;
	return node as TextNode;
}

/**
 * Applies a typography patch to the actively edited text node as one undoable
 * scene edit, recomputing bounds from the node's own origin. Returns whether the
 * document actually changed so callers can keep side effects conditional. The
 * draft string in the edit session is untouched: only geometry style changes, so
 * an in-flight edit is never silently committed by a style toggle.
 */
function mutateActiveTextStyle(
	produce: (style: TextStyle) => TextStylePatch | null,
	label: string,
): boolean {
	const node = activeTextNode();
	if (!node) return false;
	const style = normalizeTextGeometry(node.geometry).style;
	const patch = produce(style);
	if (!patch) return false;
	const store = useSceneStore.getState();
	const before = store.document;
	store.apply(
		createUpdateTextNodeCommand(node.id, { style: patch }, { label }),
	);
	return useSceneStore.getState().document !== before;
}

/**
 * Toggles bold on the actively edited text node. Bold is the numeric font-weight
 * heuristic (see {@link isBoldWeight}); this is fully rendered today because both
 * canvas and export already read `fontWeight`.
 */
export function toggleActiveTextBold(): boolean {
	return mutateActiveTextStyle(
		(style) => ({
			fontWeight: isBoldWeight(style.fontWeight)
				? REGULAR_FONT_WEIGHT
				: BOLD_FONT_WEIGHT,
		}),
		"Toggle bold",
	);
}

/**
 * Toggles italic on the actively edited text node as an undoable model edit.
 * Italic renders end-to-end (canvas + SVG export emit `font-style`, and the
 * inline-edit textarea slants live), so the `Cmd/Ctrl+I` key reflects what the
 * user sees. PDF export records an unsupported-feature issue rather than a slant.
 */
export function toggleActiveTextItalic(): boolean {
	return mutateActiveTextStyle(
		(style) => ({ italic: !(style.italic ?? false) }),
		"Toggle italic",
	);
}

/**
 * Toggles underline on the actively edited text node as an undoable model edit.
 * Like {@link toggleActiveTextItalic}, underline renders end-to-end via
 * `text-decoration` (canvas + SVG export + the inline-edit textarea); PDF export
 * records an unsupported-feature issue.
 */
export function toggleActiveTextUnderline(): boolean {
	return mutateActiveTextStyle(
		(style) => ({ underline: !(style.underline ?? false) }),
		"Toggle underline",
	);
}
