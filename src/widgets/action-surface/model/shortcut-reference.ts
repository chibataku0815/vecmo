import { CAMERA_CUT_SHORTCUTS } from "@/features/motion/model/timeline-shortcuts";
import {
	actionShortcuts,
	resolveShortcutPlatform,
	type ShortcutPlatform,
	shortcutLabel,
} from "@/shared/actions";
import { editorActionRegistry } from "./editor-actions";

/**
 * Builds the data behind the keyboard-shortcut help overlay. The registry is the
 * single source for command shortcuts; the supplementary table below covers
 * product-local canvas and timeline behavior that cannot be represented as a
 * global action chord.
 */

export type ShortcutEntry = {
	readonly label: string;
	/**
	 * Pre-formatted, human-readable key combo. Modifiers are platform glyphs —
	 * `⌘+⇧+Z` on macOS, `Ctrl+Shift+Z` elsewhere — or free-form like `0–9`.
	 */
	readonly keys: string;
};

export type ShortcutSection = {
	readonly id: string;
	readonly title: string;
	readonly entries: readonly ShortcutEntry[];
};

/**
 * Help-overlay key formatter, re-bound to the shared platform-aware
 * {@link shortcutLabel} so the overlay, command palette, and tooltips render one
 * consistent glyph set (⌘+⇧+Z on macOS, Ctrl+Shift+Z elsewhere) from a single
 * source — they previously drifted (⇧ here vs. `S` in tooltips).
 */
export const formatShortcut = shortcutLabel;

/** Display titles and order for the sections, keyed by registry group id. */
const SECTION_ORDER: readonly {
	readonly id: string;
	readonly title: string;
}[] = [
	{ id: "tools", title: "Tools" },
	{ id: "view", title: "View & Panels" },
	{ id: "viewport", title: "Zoom & Pan" },
	{ id: "selection", title: "Selection" },
	{ id: "edit", title: "Edit" },
	{ id: "transform", title: "Transform" },
	{ id: "arrange", title: "Arrange" },
	{ id: "layer", title: "Layer" },
	{ id: "path", title: "Path & Vector" },
	{ id: "workflow", title: "Workflow" },
	{ id: "effects", title: "Effects" },
	{ id: "motion", title: "Motion & Timeline" },
	{ id: "history", title: "History" },
	{ id: "export", title: "Export" },
];

const cameraCutSupplements = (
	platform: ShortcutPlatform,
): readonly ShortcutEntry[] => [
	{
		label: "Toggle selected camera-cut transition",
		keys: formatShortcut(CAMERA_CUT_SHORTCUTS.toggleTransition, platform),
	},
	{
		label: "Move selected camera cut to next lane",
		keys: formatShortcut(CAMERA_CUT_SHORTCUTS.moveToNextLane, platform),
	},
];

/**
 * Keys owned outside the registry and the derived panel supplements above.
 * Source of truth lives in the annotated files; keep this list in sync when
 * those change. The companion test asserts shape and the no-dead-key (`M`/`E`)
 * invariant.
 */
const STATIC_SUPPLEMENTS: Readonly<Record<string, readonly ShortcutEntry[]>> = {
	// source: src/widgets/canvas-shell/ui/CanvasShell.tsx
	viewport: [{ label: "Pan workspace", keys: "Space + drag" }],
	// source: src/features/transform canvas handler
	transform: [{ label: "Nudge 1px / 10px", keys: "Arrows  /  ⇧+Arrows" }],
	// source: src/features/transform & bezier canvas handlers
	selection: [
		{ label: "Delete selection / anchor", keys: "Delete / Backspace" },
		{ label: "Cancel gesture / deselect", keys: "Esc" },
	],
	// source: src/features/bezier/canvas/handler.ts
	path: [{ label: "Open / close path", keys: "Enter  /  O" }],
	// source: src/widgets/canvas-shell/ui/CanvasShell.tsx
	motion: [{ label: "Play / pause", keys: "Space" }],
};

/**
 * Aggregates every active editor shortcut into ordered, titled sections for the
 * help overlay. Registry actions supply most rows; derived and static
 * supplements cover the canvas/handler-owned keys. `platform` defaults to the
 * host probe (⌘ on macOS) but is injectable so tests stay deterministic — the
 * Bun/Node test runner exposes a host `navigator`, so the default is not a
 * fixed spelling.
 */
export function buildShortcutReference(
	platform: ShortcutPlatform = resolveShortcutPlatform(),
): readonly ShortcutSection[] {
	const byGroup = new Map<string, ShortcutEntry[]>();
	const push = (groupId: string, entry: ShortcutEntry): void => {
		const existing = byGroup.get(groupId);
		if (existing) existing.push(entry);
		else byGroup.set(groupId, [entry]);
	};

	for (const action of editorActionRegistry.actions) {
		const shortcuts = actionShortcuts(action);
		if (shortcuts.length === 0) continue;
		push(action.group.id, {
			label: action.label,
			keys: shortcuts
				.map((shortcut) => formatShortcut(shortcut, platform))
				.join(" / "),
		});
	}

	for (const entry of cameraCutSupplements(platform)) push("motion", entry);
	for (const [groupId, entries] of Object.entries(STATIC_SUPPLEMENTS)) {
		for (const entry of entries) push(groupId, entry);
	}

	return SECTION_ORDER.flatMap(({ id, title }) => {
		const entries = byGroup.get(id);
		if (!entries || entries.length === 0) return [];
		return [{ id, title, entries }];
	});
}
