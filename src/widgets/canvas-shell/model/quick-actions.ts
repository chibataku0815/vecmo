import type { Icon } from "@phosphor-icons/react";
import {
	Circle,
	Copy,
	PenNib,
	Shapes,
	Stack,
	StackSimple,
} from "@phosphor-icons/react";
import type { SceneCommand } from "@/entities/scene/model/command";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import type { buildDuplicateClipboardCommand } from "@/features/clipboard/model/clipboard";
import { convertLastStrokeToShape } from "@/features/draw/model/sketch-to-shape";
import type { selectedGroupingState } from "@/features/grouping/model/actions";
import {
	authorStrokeDrawOn,
	authorStrokeDrawOnFromLastIntent,
} from "@/features/motion/model/draw-on-authoring";
import { useTransportStore } from "@/features/motion/model/transport-store";
import type { PencilStrokeIntent } from "@/shared/stroke/pencil-intent";
import { recordDuplicateRepeatWorkflow } from "./repeat-transform-workflow";

/**
 * One entry in the canvas selection quick-action bar (`ContextualQuickActions`).
 * `onClick` is a fully-bound thunk — the builder closes over the reactive inputs
 * so the widget only has to render `label`/`IconComponent` and call `onClick`.
 */
export type CanvasQuickAction = {
	readonly id: string;
	readonly label: string;
	readonly title: string;
	readonly IconComponent: Icon;
	readonly onClick: () => void;
};

/**
 * Reactive inputs the widget computes (memos/callbacks) and hands to
 * {@link buildCanvasQuickActions}. Kept as a plain data bag so the builder stays
 * a pure, React-free, unit-testable function: the component owns the hooks, this
 * module owns "which actions exist, when, and what they do".
 */
export type CanvasQuickActionInput = {
	readonly duplicatePlan: ReturnType<typeof buildDuplicateClipboardCommand>;
	readonly groupingState: ReturnType<typeof selectedGroupingState>;
	readonly pendingStrokeIntent: PencilStrokeIntent | null;
	readonly selectionNodeIds: readonly string[];
	readonly sceneDocument: SceneDocument;
	readonly applyCommandAndSelect: (
		command: SceneCommand,
		nodeIds: readonly string[],
	) => SceneDocument | null;
};

/**
 * Assembles the selection quick-action bar from the current selection/document
 * state. Pure and side-effect-free at build time — every action's effect lives
 * in its `onClick`. Extracted from `CanvasShell` so the widget composes the bar
 * rather than defining it inline (see `docs/canvas-shell-decomposition-plan.md`).
 *
 * Order is intentional: structural edits first (duplicate, then group/ungroup),
 * then the opt-in Pencil-motion authoring actions (draw-on, make-shape, perform).
 */
export function buildCanvasQuickActions(
	input: CanvasQuickActionInput,
): readonly CanvasQuickAction[] {
	const {
		duplicatePlan,
		groupingState,
		pendingStrokeIntent,
		selectionNodeIds,
		sceneDocument,
		applyCommandAndSelect,
	} = input;
	const actions: CanvasQuickAction[] = [];
	if (duplicatePlan.ok) {
		actions.push({
			id: "duplicate",
			label: "Duplicate selection",
			title: "Duplicate selection",
			IconComponent: Copy,
			onClick: () => {
				const document = applyCommandAndSelect(
					duplicatePlan.command,
					duplicatePlan.newRootNodeIds,
				);
				if (!document) return;
				recordDuplicateRepeatWorkflow({
					sourceDocument: sceneDocument,
					sourceNodeIds: selectionNodeIds,
					duplicateNodeIds: duplicatePlan.newRootNodeIds,
					document,
				});
			},
		});
	}
	const ungroup = groupingState.ungroup;
	const group = groupingState.group;
	if (ungroup.enabled) {
		actions.push({
			id: "ungroup",
			label: "Ungroup",
			title: "Ungroup",
			IconComponent: StackSimple,
			onClick: () =>
				applyCommandAndSelect(ungroup.command, ungroup.selectNodeIds),
		});
	} else if (group.enabled) {
		actions.push({
			id: "group",
			label: "Group",
			title: "Group",
			IconComponent: Stack,
			onClick: () => applyCommandAndSelect(group.command, group.selectNodeIds),
		});
	}
	// Opt-in stroke-to-motion trigger: never auto-applied on stroke commit. A
	// pending Pencil-stroke intent always wins (it consumes itself on success);
	// with none pending, a single selected path node is a valid fallback target
	// (authorStrokeDrawOn no-ops safely on any other node kind).
	const singleSelectedNode =
		selectionNodeIds.length === 1
			? findNode(sceneDocument, selectionNodeIds[0])
			: null;
	if (
		pendingStrokeIntent !== null ||
		singleSelectedNode?.geometry.kind === "path"
	) {
		actions.push({
			id: "animate-draw-on",
			label: "Draw on",
			title: "Animate draw-on",
			IconComponent: PenNib,
			onClick: () => {
				if (authorStrokeDrawOnFromLastIntent()) return;
				if (selectionNodeIds.length === 1) {
					authorStrokeDrawOn({
						nodeId: selectionNodeIds[0],
						durationFrames: 30,
					});
				}
			},
		});
	}
	// Opt-in sketch-to-clean-vector (L4): recognizes a pending Pencil stroke's
	// traced shape as a clean rect/ellipse/line and swaps it in, in place, as
	// one undoable edit. Only offered while its own stroke intent is still
	// pending and reads as a shape candidate — conversion only ever touches
	// the sketch that produced the intent, never an arbitrary selection.
	if (
		pendingStrokeIntent?.candidates.includes("closed-shape") ||
		pendingStrokeIntent?.candidates.includes("straight-line")
	) {
		actions.push({
			id: "make-shape",
			label: "Make shape",
			title: "Convert sketch to a clean shape",
			IconComponent: Shapes,
			onClick: () => convertLastStrokeToShape(),
		});
	}
	// Opt-in Perform mode (iPad Pencil-motion L3): arms the SINGLE next
	// Select-tool drag on this node to be captured as x/y keyframes instead
	// of an ordinary move. One node only — Perform is position-only (v1) and
	// records exactly one node's path, so a multi-selection never shows it.
	if (selectionNodeIds.length === 1) {
		actions.push({
			id: "animate-perform",
			label: "Perform",
			title: "Perform: drag to record motion",
			IconComponent: Circle,
			onClick: () => useTransportStore.getState().armPerform(),
		});
	}
	return actions;
}
