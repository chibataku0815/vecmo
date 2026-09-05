import { create } from "zustand";
import type { SceneCommand } from "@/entities/scene/model/command";
import type { SceneDocument, Vec2 } from "@/entities/scene/model/types";
import {
	buildClipboardPayload,
	buildDuplicateClipboardCommand,
	buildPasteClipboardCommand,
	type ClipboardIssue,
	type ClipboardPayload,
} from "@/features/clipboard";

type LayerWorkflowClipboardState = {
	readonly payload: ClipboardPayload | null;
	readonly setPayload: (payload: ClipboardPayload) => void;
	readonly clearPayload: () => void;
};

export type LayerWorkflowClipboardActionId = "copy" | "duplicate" | "paste";
export type LayerWorkflowClipboardCommandActionId = Exclude<
	LayerWorkflowClipboardActionId,
	"copy"
>;

export type LayerWorkflowClipboardIssue = ClipboardIssue & {
	readonly source: "clipboard";
};

export type LayerWorkflowClipboardCommandPlan<
	TAction extends
		LayerWorkflowClipboardCommandActionId = LayerWorkflowClipboardCommandActionId,
> = {
	readonly enabled: true;
	readonly id: TAction;
	readonly command: SceneCommand;
	readonly payload: ClipboardPayload;
	readonly targetLayerId: string;
	readonly selectNodeIds: readonly string[];
	readonly newRootNodeIds: readonly string[];
	readonly idMap: Readonly<Record<string, string>>;
	readonly offset: Vec2;
	readonly issues: readonly LayerWorkflowClipboardIssue[];
	readonly disabledReason: null;
};

export type LayerWorkflowClipboardCopyPlan = {
	readonly enabled: true;
	readonly id: "copy";
	readonly payload: ClipboardPayload;
	readonly copiedNodeCount: number;
	readonly sourceNodeIds: readonly string[];
	readonly targetLayerId: string;
	readonly issues: readonly LayerWorkflowClipboardIssue[];
	readonly disabledReason: null;
};

export type LayerWorkflowClipboardDisabledPlan<
	TAction extends
		LayerWorkflowClipboardActionId = LayerWorkflowClipboardActionId,
> = {
	readonly enabled: false;
	readonly id: TAction;
	readonly issues: readonly LayerWorkflowClipboardIssue[];
	readonly disabledReason: LayerWorkflowClipboardIssue | null;
};

export type LayerWorkflowClipboardPlanFor<
	TAction extends LayerWorkflowClipboardActionId,
> = TAction extends "copy"
	? LayerWorkflowClipboardCopyPlan | LayerWorkflowClipboardDisabledPlan<"copy">
	: TAction extends LayerWorkflowClipboardCommandActionId
		?
				| LayerWorkflowClipboardCommandPlan<TAction>
				| LayerWorkflowClipboardDisabledPlan<TAction>
		: never;

export type LayerWorkflowClipboardPlan =
	LayerWorkflowClipboardPlanFor<LayerWorkflowClipboardActionId>;

export type LayerWorkflowClipboardPlans = {
	readonly [TAction in LayerWorkflowClipboardActionId]: LayerWorkflowClipboardPlanFor<TAction>;
};

export const useLayerWorkflowClipboardStore =
	create<LayerWorkflowClipboardState>()((set) => ({
		payload: null,
		setPayload: (payload) => set({ payload }),
		clearPayload: () => set({ payload: null }),
	}));

const clipboardIssues = (
	issues: readonly ClipboardIssue[],
): readonly LayerWorkflowClipboardIssue[] =>
	issues.map((issue) => ({ ...issue, source: "clipboard" as const }));

const firstWorkflowClipboardIssue = (
	issues: readonly LayerWorkflowClipboardIssue[],
): LayerWorkflowClipboardIssue | null =>
	issues.find((issue) => issue.severity === "error") ?? issues[0] ?? null;

const disabledPlan = <TAction extends LayerWorkflowClipboardActionId>(
	id: TAction,
	issues: readonly ClipboardIssue[],
): LayerWorkflowClipboardDisabledPlan<TAction> => {
	const workflowIssues = clipboardIssues(issues);
	return {
		enabled: false,
		id,
		issues: workflowIssues,
		disabledReason: firstWorkflowClipboardIssue(workflowIssues),
	};
};

const emptyClipboardPlan = (): LayerWorkflowClipboardDisabledPlan<"paste"> => {
	const issues: readonly LayerWorkflowClipboardIssue[] = [
		{
			source: "clipboard",
			code: "clipboard.empty-payload",
			message: "Paste requires an in-memory clipboard payload from Copy first.",
			severity: "error",
			operation: "paste",
		},
	];
	return {
		enabled: false,
		id: "paste",
		issues,
		disabledReason: firstWorkflowClipboardIssue(issues),
	};
};

/**
 * Plans copy, duplicate, and paste actions for layer workflow surfaces. The
 * clipboard feature remains the source of truth for payload validity and scene
 * commands; this helper adds UI-safe availability, disabled reasons, selection
 * targets, paste offsets, and id remap metadata.
 */
export function planLayerWorkflowClipboardActions(options: {
	readonly document: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly clipboardPayload: ClipboardPayload | null;
	readonly duplicateOffset?: Vec2;
	readonly pasteOffset?: Vec2;
	readonly pasteTargetLayerId?: string;
}): LayerWorkflowClipboardPlans {
	const copy = buildClipboardPayload(options.document, options.selectedNodeIds);
	const duplicate = buildDuplicateClipboardCommand(
		options.document,
		options.selectedNodeIds,
		{ offset: options.duplicateOffset },
	);
	const paste = options.clipboardPayload
		? buildPasteClipboardCommand(options.document, options.clipboardPayload, {
				offset: options.pasteOffset,
				targetLayerId: options.pasteTargetLayerId,
			})
		: null;

	return {
		copy: copy.ok
			? {
					enabled: true,
					id: "copy",
					payload: copy.payload,
					copiedNodeCount: copy.payload.nodes.length,
					sourceNodeIds: copy.payload.source.nodeIds,
					targetLayerId: copy.payload.source.layerId,
					issues: clipboardIssues(copy.issues),
					disabledReason: null,
				}
			: disabledPlan("copy", copy.issues),
		duplicate: duplicate.ok
			? {
					enabled: true,
					id: "duplicate",
					command: duplicate.command,
					payload: duplicate.payload,
					targetLayerId: duplicate.targetLayerId,
					selectNodeIds: duplicate.newRootNodeIds,
					newRootNodeIds: duplicate.newRootNodeIds,
					idMap: duplicate.idMap,
					offset: duplicate.offset,
					issues: clipboardIssues(duplicate.issues),
					disabledReason: null,
				}
			: disabledPlan("duplicate", duplicate.issues),
		paste:
			paste === null
				? emptyClipboardPlan()
				: paste.ok
					? {
							enabled: true,
							id: "paste",
							command: paste.command,
							payload: paste.payload,
							targetLayerId: paste.targetLayerId,
							selectNodeIds: paste.newRootNodeIds,
							newRootNodeIds: paste.newRootNodeIds,
							idMap: paste.idMap,
							offset: paste.offset,
							issues: clipboardIssues(paste.issues),
							disabledReason: null,
						}
					: disabledPlan("paste", paste.issues),
	};
}
