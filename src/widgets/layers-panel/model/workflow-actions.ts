import {
	type LinkedInstancePlan,
	planLinkedInstance,
} from "@/entities/component-motion/model/plan-linked-instance";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createComponentSourceCommand,
	createDetachComponentInstanceCommand,
} from "@/entities/scene/model/component-symbol-commands";
import {
	findComponentSymbol,
	findComponentSymbolBySourceNodeId,
} from "@/entities/scene/model/component-symbols";
import type {
	ComponentSymbol,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type { ClipboardPayload } from "@/features/clipboard";
import {
	type GroupingIssue,
	type SelectedGroupNodesAvailable,
	type SelectedGroupNodesUnavailable,
	type SelectedUngroupNodeAvailable,
	type SelectedUngroupNodeUnavailable,
	selectedGroupingState,
} from "@/features/grouping";
import {
	planSelectedObjectActions,
	type SelectedObjectActionIssue,
	type SelectedObjectNextSelection,
} from "@/features/structure-actions";
import {
	type LayerWorkflowClipboardActionId,
	type LayerWorkflowClipboardCommandActionId,
	type LayerWorkflowClipboardIssue,
	type LayerWorkflowClipboardPlanFor,
	planLayerWorkflowClipboardActions,
} from "./workflow-clipboard";

export type LayerWorkflowGroupingActionId = "group" | "ungroup";
export type LayerWorkflowStructureActionId = "delete";
export type LayerWorkflowComponentActionId =
	| "component-source"
	| "component-instance"
	| "component-detach";
export type LayerWorkflowActionId =
	| LayerWorkflowClipboardActionId
	| LayerWorkflowComponentActionId
	| LayerWorkflowGroupingActionId
	| LayerWorkflowStructureActionId;
export type LayerWorkflowCommandActionId =
	| LayerWorkflowClipboardCommandActionId
	| LayerWorkflowComponentActionId
	| LayerWorkflowGroupingActionId
	| LayerWorkflowStructureActionId;
type LayerWorkflowGroupingAvailableStateFor<
	TAction extends LayerWorkflowGroupingActionId,
> = TAction extends "group"
	? SelectedGroupNodesAvailable
	: SelectedUngroupNodeAvailable;
type LayerWorkflowGroupingUnavailableStateFor<
	TAction extends LayerWorkflowGroupingActionId,
> = TAction extends "group"
	? SelectedGroupNodesUnavailable
	: SelectedUngroupNodeUnavailable;

export type LayerWorkflowIssue =
	| LayerWorkflowComponentIssue
	| (GroupingIssue & { readonly source: "grouping" })
	| LayerWorkflowStructureIssue
	| LayerWorkflowClipboardIssue;

export type LayerWorkflowCommandPlan = {
	readonly enabled: true;
	readonly id: LayerWorkflowCommandActionId;
	readonly command: SceneCommand;
	/** Complete Scene + Motion + Grammar plan for `component-instance`. */
	readonly linkedInstance?: LinkedInstancePlan;
	readonly selectNodeIds: readonly string[];
	readonly issues: readonly LayerWorkflowIssue[];
	readonly disabledReason: null;
};

export type LayerWorkflowGroupingCommandPlan<
	TAction extends LayerWorkflowGroupingActionId = LayerWorkflowGroupingActionId,
> = TAction extends LayerWorkflowGroupingActionId
	? Omit<LayerWorkflowCommandPlan, "id"> & {
			readonly id: TAction;
			readonly groupingState: LayerWorkflowGroupingAvailableStateFor<TAction>;
		}
	: never;

export type LayerWorkflowCopyPlan = Extract<
	LayerWorkflowClipboardPlanFor<"copy">,
	{ readonly enabled: true }
>;

export type LayerWorkflowDisabledPlan = {
	readonly enabled: false;
	readonly id: LayerWorkflowActionId;
	readonly issues: readonly LayerWorkflowIssue[];
	readonly disabledReason: LayerWorkflowIssue | null;
};

export type LayerWorkflowGroupingDisabledPlan<
	TAction extends LayerWorkflowGroupingActionId = LayerWorkflowGroupingActionId,
> = TAction extends LayerWorkflowGroupingActionId
	? Omit<LayerWorkflowDisabledPlan, "id"> & {
			readonly id: TAction;
			readonly groupingState: LayerWorkflowGroupingUnavailableStateFor<TAction>;
		}
	: never;

export type LayerWorkflowActionPlan =
	| LayerWorkflowClipboardPlanFor<LayerWorkflowClipboardActionId>
	| LayerWorkflowCommandPlan
	| LayerWorkflowDisabledPlan
	| LayerWorkflowGroupingCommandPlan
	| LayerWorkflowGroupingDisabledPlan;

export type LayerWorkflowPlanFor<TAction extends LayerWorkflowActionId> =
	TAction extends LayerWorkflowClipboardActionId
		? LayerWorkflowClipboardPlanFor<TAction>
		: TAction extends LayerWorkflowGroupingActionId
			?
					| LayerWorkflowGroupingCommandPlan<TAction>
					| LayerWorkflowGroupingDisabledPlan<TAction>
			: TAction extends LayerWorkflowComponentActionId
				? LayerWorkflowCommandPlan | LayerWorkflowDisabledPlan
				: TAction extends LayerWorkflowStructureActionId
					? LayerWorkflowCommandPlan | LayerWorkflowDisabledPlan
					: never;

export type LayerWorkflowPlans = {
	readonly [TAction in LayerWorkflowActionId]: LayerWorkflowPlanFor<TAction>;
};

export type LayerWorkflowStructureIssueCode =
	| "structure.duplicate-selection"
	| "structure.empty-selection"
	| "structure.missing-selection"
	| "structure.no-deletable-selection"
	| "structure.protected-delete-selection";

export type LayerWorkflowStructureIssue = {
	readonly source: "structure";
	readonly code: LayerWorkflowStructureIssueCode;
	readonly severity: "error" | "warning";
	readonly message: string;
	readonly sourceId?: string;
	readonly layerId?: string;
};

export type LayerWorkflowComponentIssueCode =
	| "component.empty-selection"
	| "component.missing-selection"
	| "component.protected-selection"
	| "component.already-source"
	| "component.source-required"
	| "component.instance-required"
	| "component.instance-plan-failed";

export type LayerWorkflowComponentIssue = {
	readonly source: "component";
	readonly code: LayerWorkflowComponentIssueCode;
	readonly severity: "error" | "warning";
	readonly message: string;
	readonly sourceId?: string;
	readonly layerId?: string;
	readonly symbolId?: string;
};

export type LayerWorkflowSelectionCleanup = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly removedNodeIds: readonly string[];
};

type ComponentWorkflowTarget = {
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly topLevelIndex: number | null;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
};

type ComponentWorkflowTargetResolution =
	| {
			readonly target: ComponentWorkflowTarget;
			readonly issues: readonly LayerWorkflowComponentIssue[];
	  }
	| {
			readonly target: null;
			readonly issues: readonly LayerWorkflowComponentIssue[];
	  };

const groupingIssues = (
	issues: readonly GroupingIssue[],
): readonly LayerWorkflowIssue[] =>
	issues.map((issue) => ({ ...issue, source: "grouping" as const }));

const collectNodeIds = (
	nodes: readonly VectorNode[],
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		output.push(node.id);
		if (node.children) collectNodeIds(node.children, output);
	}
	return output;
};

const collectDocumentNodeIds = (document: SceneDocument): ReadonlySet<string> =>
	new Set(document.layers.flatMap((layer) => collectNodeIds(layer.nodes)));

const structureIssue = (
	issue: Omit<LayerWorkflowStructureIssue, "source">,
): LayerWorkflowStructureIssue => ({ ...issue, source: "structure" });

const componentIssue = (
	issue: Omit<LayerWorkflowComponentIssue, "source">,
): LayerWorkflowComponentIssue => ({ ...issue, source: "component" });

const componentDisabledPlan = (
	id: LayerWorkflowComponentActionId,
	issues: readonly LayerWorkflowComponentIssue[],
): LayerWorkflowDisabledPlan => ({
	enabled: false,
	id,
	issues,
	disabledReason: firstLayerWorkflowIssue(issues),
});

const findComponentWorkflowTarget = (
	document: SceneDocument,
	nodeId: string,
): ComponentWorkflowTarget | null => {
	for (const layer of document.layers) {
		const visit = (
			nodes: readonly VectorNode[],
			inheritedVisible: boolean,
			inheritedLocked: boolean,
			parentIds: readonly string[],
		): ComponentWorkflowTarget | null => {
			for (const [index, node] of nodes.entries()) {
				const effectiveVisible = inheritedVisible && node.visible;
				const effectiveLocked = inheritedLocked || node.locked;
				if (node.id === nodeId) {
					return {
						node,
						layer,
						topLevelIndex: parentIds.length === 0 ? index : null,
						effectiveVisible,
						effectiveLocked,
					};
				}
				if (node.children) {
					const childTarget = visit(
						node.children,
						effectiveVisible,
						effectiveLocked,
						[...parentIds, node.id],
					);
					if (childTarget) return childTarget;
				}
			}
			return null;
		};

		const target = visit(layer.nodes, layer.visible, layer.locked, []);
		if (target) return target;
	}
	return null;
};

const resolveComponentWorkflowTarget = (
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	primaryNodeId: string | null,
): ComponentWorkflowTargetResolution => {
	const candidateIds = [
		...new Set(
			[primaryNodeId, ...selectedNodeIds].filter(
				(nodeId): nodeId is string => typeof nodeId === "string",
			),
		),
	];

	if (candidateIds.length === 0) {
		return {
			target: null,
			issues: [
				componentIssue({
					code: "component.empty-selection",
					severity: "error",
					message: "Select an object before using saved-object actions.",
				}),
			],
		};
	}

	const missingNodeIds: string[] = [];
	for (const nodeId of candidateIds) {
		const target = findComponentWorkflowTarget(document, nodeId);
		if (target) {
			return {
				target,
				issues: missingNodeIds.map((sourceId) =>
					componentIssue({
						code: "component.missing-selection",
						severity: "warning",
						message: "A selected saved-object target no longer exists.",
						sourceId,
					}),
				),
			};
		}
		missingNodeIds.push(nodeId);
	}

	return {
		target: null,
		issues: missingNodeIds.map((sourceId) =>
			componentIssue({
				code: "component.missing-selection",
				severity: "error",
				message: "The selected saved-object target no longer exists.",
				sourceId,
			}),
		),
	};
};

const componentSymbolForNode = (
	document: SceneDocument,
	node: VectorNode,
): ComponentSymbol | undefined => {
	const binding = node.component;
	if (binding?.kind === "instance") {
		return (
			findComponentSymbol(document, binding.symbolId) ??
			findComponentSymbolBySourceNodeId(document, binding.sourceNodeId)
		);
	}
	if (binding?.kind === "source") {
		const boundSymbol = findComponentSymbol(document, binding.symbolId);
		if (boundSymbol?.sourceNodeId === node.id) return boundSymbol;
	}
	return findComponentSymbolBySourceNodeId(document, node.id);
};

const protectedComponentTargetIssue = (
	target: ComponentWorkflowTarget,
	message: string,
): LayerWorkflowComponentIssue =>
	componentIssue({
		code: "component.protected-selection",
		severity: "error",
		message,
		sourceId: target.node.id,
		layerId: target.layer.id,
	});

const layerWorkflowStructureIssueCode = (
	issue: SelectedObjectActionIssue,
): LayerWorkflowStructureIssueCode => {
	switch (issue.code) {
		case "selected.duplicate-id":
			return "structure.duplicate-selection";
		case "selected.empty-selection":
			return "structure.empty-selection";
		case "selected.missing-node":
			return "structure.missing-selection";
		case "selected.protected-delete-selection":
			return "structure.protected-delete-selection";
		case "selected.no-deletable-selection":
			return "structure.no-deletable-selection";
		default:
			return "structure.no-deletable-selection";
	}
};

const structureIssuesFromSelectedObjectDelete = (
	issues: readonly SelectedObjectActionIssue[],
): readonly LayerWorkflowIssue[] =>
	issues.map((issue) =>
		structureIssue({
			code: layerWorkflowStructureIssueCode(issue),
			severity: issue.severity,
			message: issue.message,
			sourceId: issue.sourceId,
			layerId: issue.layerId,
		}),
	);

const workflowSelectionNodeIds = (
	nextSelection: SelectedObjectNextSelection,
	fallbackNodeIds: readonly string[],
): readonly string[] => {
	switch (nextSelection.kind) {
		case "preserve":
		case "replace":
		case "focus-artboard":
			return nextSelection.nodeIds;
		case "clear":
			return [];
		case "command-result":
			return fallbackNodeIds;
	}
};

const planCreateComponentSource = (
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	primaryNodeId: string | null,
): LayerWorkflowCommandPlan | LayerWorkflowDisabledPlan => {
	const resolution = resolveComponentWorkflowTarget(
		document,
		selectedNodeIds,
		primaryNodeId,
	);
	if (!resolution.target) {
		return componentDisabledPlan("component-source", resolution.issues);
	}

	const { target } = resolution;
	const issues = [...resolution.issues];
	if (!target.effectiveVisible || target.effectiveLocked) {
		return componentDisabledPlan("component-source", [
			...issues,
			protectedComponentTargetIssue(
				target,
				"Hidden or locked objects cannot be saved.",
			),
		]);
	}
	if (target.node.component?.kind === "instance") {
		return componentDisabledPlan("component-source", [
			...issues,
			componentIssue({
				code: "component.source-required",
				severity: "error",
				message: "Detach this placed copy before saving it.",
				sourceId: target.node.id,
				layerId: target.layer.id,
				symbolId: target.node.component.symbolId,
			}),
		]);
	}

	const existingSource = findComponentSymbolBySourceNodeId(
		document,
		target.node.id,
	);
	if (existingSource) {
		return componentDisabledPlan("component-source", [
			...issues,
			componentIssue({
				code: "component.already-source",
				severity: "error",
				message: "The selected object is already saved.",
				sourceId: target.node.id,
				layerId: target.layer.id,
				symbolId: existingSource.id,
			}),
		]);
	}

	return {
		enabled: true,
		id: "component-source",
		command: createComponentSourceCommand(target.node.id, undefined, {
			label: "Save object asset",
		}),
		selectNodeIds: [target.node.id],
		issues,
		disabledReason: null,
	};
};

const planCreateComponentInstance = (
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	primaryNodeId: string | null,
	grammarBindings: readonly MotionGrammarBinding[],
): LayerWorkflowCommandPlan | LayerWorkflowDisabledPlan => {
	const resolution = resolveComponentWorkflowTarget(
		document,
		selectedNodeIds,
		primaryNodeId,
	);
	if (!resolution.target) {
		return componentDisabledPlan("component-instance", resolution.issues);
	}

	const { target } = resolution;
	const issues = [...resolution.issues];
	if (!target.layer.visible || target.layer.locked) {
		return componentDisabledPlan("component-instance", [
			...issues,
			protectedComponentTargetIssue(
				target,
				"Cannot place a saved object into a hidden or locked layer.",
			),
		]);
	}

	const symbol = componentSymbolForNode(document, target.node);
	if (!symbol) {
		return componentDisabledPlan("component-instance", [
			...issues,
			componentIssue({
				code: "component.source-required",
				severity: "error",
				message:
					"Select a saved object or placed copy before placing another copy.",
				sourceId: target.node.id,
				layerId: target.layer.id,
			}),
		]);
	}

	const instancePlan = planLinkedInstance(document, symbol.id, {
		layerId: target.layer.id,
		...(target.node.artboardId ? { artboardId: target.node.artboardId } : {}),
		...(target.topLevelIndex !== null
			? { toIndex: target.topLevelIndex + 1 }
			: {}),
		grammarBindings,
		sceneLabel: "Place saved object",
	});

	if (!instancePlan) {
		return componentDisabledPlan("component-instance", [
			...issues,
			componentIssue({
				code: "component.instance-plan-failed",
				severity: "error",
				message: "The selected saved object cannot place a copy.",
				sourceId: target.node.id,
				layerId: target.layer.id,
				symbolId: symbol.id,
			}),
		]);
	}

	return {
		enabled: true,
		id: "component-instance",
		command: instancePlan.sceneCommand,
		linkedInstance: instancePlan,
		selectNodeIds: instancePlan.selectNodeIds,
		issues,
		disabledReason: null,
	};
};

const planDetachComponentInstance = (
	document: SceneDocument,
	selectedNodeIds: readonly string[],
	primaryNodeId: string | null,
): LayerWorkflowCommandPlan | LayerWorkflowDisabledPlan => {
	const resolution = resolveComponentWorkflowTarget(
		document,
		selectedNodeIds,
		primaryNodeId,
	);
	if (!resolution.target) {
		return componentDisabledPlan("component-detach", resolution.issues);
	}

	const { target } = resolution;
	const issues = [...resolution.issues];
	if (!target.effectiveVisible || target.effectiveLocked) {
		return componentDisabledPlan("component-detach", [
			...issues,
			protectedComponentTargetIssue(
				target,
				"Hidden or locked placed copies cannot be detached.",
			),
		]);
	}
	if (target.node.component?.kind !== "instance") {
		return componentDisabledPlan("component-detach", [
			...issues,
			componentIssue({
				code: "component.instance-required",
				severity: "error",
				message: "Select a placed copy before detaching.",
				sourceId: target.node.id,
				layerId: target.layer.id,
			}),
		]);
	}

	return {
		enabled: true,
		id: "component-detach",
		command: createDetachComponentInstanceCommand(target.node.id, {
			label: "Detach placed copy",
		}),
		selectNodeIds: [target.node.id],
		issues,
		disabledReason: null,
	};
};

/**
 * Removes stale selection ids against the current scene snapshot while
 * preserving the existing primary whenever it is still live. LayersPanel uses
 * this after structural edits so filters, hidden rows, and future async command
 * bridges cannot leave dangling ids in the selection store.
 */
export function cleanupLayerWorkflowSelection(
	document: SceneDocument,
	options: {
		readonly selectedNodeIds: readonly string[];
		readonly primaryNodeId: string | null;
	},
): LayerWorkflowSelectionCleanup {
	const liveNodeIds = collectDocumentNodeIds(document);
	const nodeIds = [...new Set(options.selectedNodeIds)].filter((nodeId) =>
		liveNodeIds.has(nodeId),
	);
	const primaryNodeId =
		options.primaryNodeId !== null && nodeIds.includes(options.primaryNodeId)
			? options.primaryNodeId
			: (nodeIds.at(-1) ?? null);

	return {
		nodeIds,
		primaryNodeId,
		removedNodeIds: options.selectedNodeIds.filter(
			(nodeId) => !liveNodeIds.has(nodeId),
		),
	};
}

/**
 * Plans the layer-panel workflow actions against the current scene snapshot.
 * The helper keeps UI disabled states backed by existing grouping/clipboard
 * issue codes, so panel buttons can explain blocked commands before mutation.
 */
export function planLayerWorkflowActions(options: {
	readonly document: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly clipboardPayload: ClipboardPayload | null;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): LayerWorkflowPlans {
	const {
		document,
		selectedNodeIds,
		primaryNodeId,
		clipboardPayload,
		grammarBindings = [],
	} = options;
	const groupingState = selectedGroupingState(document, {
		nodeIds: selectedNodeIds,
		primary: primaryNodeId,
	});
	const groupIssues = groupingIssues(groupingState.group.issues);
	const ungroupIssues = groupingIssues(groupingState.ungroup.issues);
	const clipboard = planLayerWorkflowClipboardActions({
		document,
		selectedNodeIds,
		clipboardPayload,
	});
	const componentSource = planCreateComponentSource(
		document,
		selectedNodeIds,
		primaryNodeId,
	);
	const componentInstance = planCreateComponentInstance(
		document,
		selectedNodeIds,
		primaryNodeId,
		grammarBindings,
	);
	const componentDetach = planDetachComponentInstance(
		document,
		selectedNodeIds,
		primaryNodeId,
	);
	const selectedObjectPlans = planSelectedObjectActions({
		document,
		selectedNodeIds,
		primaryNodeId,
	});
	const deletePlan = selectedObjectPlans.delete;
	const deletePlanIssues = structureIssuesFromSelectedObjectDelete(
		deletePlan.issues,
	);
	const deleteExecution =
		deletePlan.enabled && deletePlan.execution.kind === "scene-command"
			? deletePlan.execution
			: null;

	return {
		delete: deleteExecution
			? {
					enabled: true,
					id: "delete",
					command: deleteExecution.command,
					selectNodeIds: workflowSelectionNodeIds(
						deletePlan.nextSelection,
						deletePlan.report.targetNodeIds,
					),
					issues: deletePlanIssues,
					disabledReason: null,
				}
			: {
					enabled: false,
					id: "delete",
					issues: deletePlanIssues,
					disabledReason: firstLayerWorkflowIssue(deletePlanIssues),
				},
		group: groupingState.group.enabled
			? {
					enabled: true,
					id: "group",
					command: groupingState.group.command,
					selectNodeIds: groupingState.group.selectNodeIds,
					issues: groupIssues,
					disabledReason: null,
					groupingState: groupingState.group,
				}
			: {
					enabled: false,
					id: "group",
					issues: groupIssues,
					disabledReason: firstLayerWorkflowIssue(groupIssues),
					groupingState: groupingState.group,
				},
		ungroup: groupingState.ungroup.enabled
			? {
					enabled: true,
					id: "ungroup",
					command: groupingState.ungroup.command,
					selectNodeIds: groupingState.ungroup.selectNodeIds,
					issues: ungroupIssues,
					disabledReason: null,
					groupingState: groupingState.ungroup,
				}
			: {
					enabled: false,
					id: "ungroup",
					issues: ungroupIssues,
					disabledReason: firstLayerWorkflowIssue(ungroupIssues),
					groupingState: groupingState.ungroup,
				},
		copy: clipboard.copy,
		paste: clipboard.paste,
		duplicate: clipboard.duplicate,
		"component-source": componentSource,
		"component-instance": componentInstance,
		"component-detach": componentDetach,
	};
}

export function firstLayerWorkflowIssue(
	issues: readonly LayerWorkflowIssue[],
): LayerWorkflowIssue | null {
	return (
		issues.find((issue) => issue.severity === "error") ?? issues[0] ?? null
	);
}
