import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createDeleteNodesCommand,
	createRenameNodeCommand,
	createSetCurrentArtboardCommand,
	createSetNodeLockedCommand,
	createSetNodeVisibilityCommand,
} from "@/entities/scene/model/node-commands";
import {
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import type {
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";

export const SELECTED_OBJECT_ACTION_IDS = {
	delete: "selected.delete",
	duplicate: "selected.duplicate",
	toggleLock: "selected.toggle-lock",
	toggleVisibility: "selected.toggle-visibility",
	rename: "selected.rename",
	focusArtboard: "selected.focus-artboard",
} as const;

/** Stable ids consumed by canvas menus, layer rows, quick actions, and future bars. */
export type SelectedObjectActionId =
	(typeof SELECTED_OBJECT_ACTION_IDS)[keyof typeof SELECTED_OBJECT_ACTION_IDS];

/** Product operation behind one selected-object action id. */
export type SelectedObjectOperation =
	| "delete"
	| "duplicate"
	| "toggle-lock"
	| "toggle-visibility"
	| "rename"
	| "focus-artboard";

export type SelectedObjectActionIssueSeverity = "warning" | "error";

export type SelectedObjectProtectionReason =
	| "ancestor-hidden"
	| "ancestor-locked"
	| "layer-hidden"
	| "layer-locked"
	| "node-hidden"
	| "node-locked";

export type SelectedObjectActionIssueCode =
	| "selected.cross-layer-selection"
	| "selected.duplicate-id"
	| "selected.empty-selection"
	| "selected.hidden-source"
	| "selected.locked-source"
	| "selected.missing-node"
	| "selected.mixed-artboard"
	| "selected.multiple-rename-targets"
	| "selected.nested-source-unsupported"
	| "selected.no-deletable-selection"
	| "selected.no-live-selection"
	| "selected.protected-delete-selection"
	| "selected.protected-source"
	| "selected.same-artboard-focus";

/** Typed planner feedback that UI surfaces can show or aggregate in reports. */
export type SelectedObjectActionIssue = {
	readonly code: SelectedObjectActionIssueCode;
	readonly severity: SelectedObjectActionIssueSeverity;
	readonly message: string;
	readonly actionId: SelectedObjectActionId;
	readonly sourceId?: string;
	readonly layerId?: string;
	readonly artboardId?: string;
	readonly reason?: SelectedObjectProtectionReason;
};

/** Deterministic disabled state derived from the highest-priority blocking issue. */
export type SelectedObjectActionDisabledReason = {
	readonly code: SelectedObjectActionIssueCode;
	readonly message: string;
	readonly issueCodes: readonly SelectedObjectActionIssueCode[];
	readonly issueCount: number;
	readonly sourceIds: readonly string[];
	readonly layerIds: readonly string[];
	readonly artboardIds: readonly string[];
	readonly protectionReasons: readonly SelectedObjectProtectionReason[];
};

/** Undo metadata lets command runners group multi-command plans consistently. */
export type SelectedObjectUndoPlan = {
	readonly label: string;
	readonly coalescePolicy: "by-command" | "never";
	readonly transactionKeyHint?: string;
};

export type DuplicateSelectedNodesCommandFactoryInput = {
	readonly kind: "clipboard.duplicate-nodes";
	readonly documentId: string;
	readonly sourceNodeIds: readonly string[];
	readonly sourceLayerId: string;
	readonly offset: Vec2;
};

export type RenameSelectedNodeIntent = {
	readonly kind: "start-node-rename";
	readonly nodeId: string;
	readonly currentName: string;
	readonly commit: {
		readonly kind: "scene.rename-node";
		readonly nodeId: string;
		readonly valueParameter: "name";
	};
};

export type SelectedObjectActionExecution =
	| {
			readonly kind: "scene-command";
			readonly command: SceneCommand;
	  }
	| {
			readonly kind: "scene-commands";
			readonly commands: readonly SceneCommand[];
			readonly transaction: SelectedObjectUndoPlan;
	  }
	| {
			readonly kind: "command-factory";
			readonly factory: "clipboard.duplicate-nodes";
			readonly input: DuplicateSelectedNodesCommandFactoryInput;
	  }
	| {
			readonly kind: "ui-intent";
			readonly intent: RenameSelectedNodeIntent;
	  };

export type SelectedObjectNextSelection =
	| {
			readonly kind: "preserve";
			readonly nodeIds: readonly string[];
			readonly primaryNodeId: string | null;
	  }
	| {
			readonly kind: "replace";
			readonly nodeIds: readonly string[];
			readonly primaryNodeId: string | null;
	  }
	| {
			readonly kind: "clear";
	  }
	| {
			readonly kind: "command-result";
			readonly source: "duplicate.new-root-node-ids";
			readonly fallbackNodeIds: readonly string[];
	  }
	| {
			readonly kind: "focus-artboard";
			readonly artboardId: string;
			readonly nodeIds: readonly string[];
			readonly primaryNodeId: string | null;
	  };

export type SelectedObjectActionReport = {
	readonly actionId: SelectedObjectActionId;
	readonly selectedNodeIds: readonly string[];
	readonly targetNodeIds: readonly string[];
	readonly missingNodeIds: readonly string[];
	readonly artboardIds: readonly string[];
	readonly issueCodes: readonly SelectedObjectActionIssueCode[];
	readonly issueCount: number;
};

export type SelectedObjectActionEnabledPlan<
	TActionId extends SelectedObjectActionId = SelectedObjectActionId,
> = {
	readonly enabled: true;
	readonly id: TActionId;
	readonly label: string;
	readonly operation: SelectedObjectOperation;
	readonly execution: SelectedObjectActionExecution;
	readonly nextSelection: SelectedObjectNextSelection;
	readonly undo: SelectedObjectUndoPlan | null;
	readonly issues: readonly SelectedObjectActionIssue[];
	readonly disabledReason: null;
	readonly report: SelectedObjectActionReport;
};

export type SelectedObjectActionDisabledPlan<
	TActionId extends SelectedObjectActionId = SelectedObjectActionId,
> = {
	readonly enabled: false;
	readonly id: TActionId;
	readonly label: string;
	readonly operation: SelectedObjectOperation;
	readonly execution: null;
	readonly nextSelection: SelectedObjectNextSelection;
	readonly undo: null;
	readonly issues: readonly SelectedObjectActionIssue[];
	readonly disabledReason: SelectedObjectActionDisabledReason;
	readonly report: SelectedObjectActionReport;
};

export type SelectedObjectActionPlan<
	TActionId extends SelectedObjectActionId = SelectedObjectActionId,
> =
	| SelectedObjectActionEnabledPlan<TActionId>
	| SelectedObjectActionDisabledPlan<TActionId>;

export type SelectedObjectActionPlans = {
	readonly delete: SelectedObjectActionPlan<
		typeof SELECTED_OBJECT_ACTION_IDS.delete
	>;
	readonly duplicate: SelectedObjectActionPlan<
		typeof SELECTED_OBJECT_ACTION_IDS.duplicate
	>;
	readonly toggleLock: SelectedObjectActionPlan<
		typeof SELECTED_OBJECT_ACTION_IDS.toggleLock
	>;
	readonly toggleVisibility: SelectedObjectActionPlan<
		typeof SELECTED_OBJECT_ACTION_IDS.toggleVisibility
	>;
	readonly rename: SelectedObjectActionPlan<
		typeof SELECTED_OBJECT_ACTION_IDS.rename
	>;
	readonly focusArtboard: SelectedObjectActionPlan<
		typeof SELECTED_OBJECT_ACTION_IDS.focusArtboard
	>;
};

export type PlanSelectedObjectActionsInput = {
	readonly document: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
	readonly duplicateOffset?: Vec2;
};

type SelectedObjectContext = {
	readonly document: SceneDocument;
	readonly requestedNodeIds: readonly string[];
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly targets: readonly SelectedObjectTarget[];
	readonly missingNodeIds: readonly string[];
	readonly duplicateNodeIds: readonly string[];
};

type SelectedObjectTarget = {
	readonly node: VectorNode;
	readonly nodeId: string;
	readonly layer: SceneLayer;
	readonly layerId: string;
	readonly layerIndex: number;
	readonly parentNodeIds: readonly string[];
	readonly topLevelIndex: number;
	readonly artboardId: string;
	readonly visible: boolean;
	readonly locked: boolean;
	readonly effectiveVisible: boolean;
	readonly effectiveLocked: boolean;
	readonly hiddenByAncestor: boolean;
	readonly lockedByAncestor: boolean;
};

type TargetLookup = {
	readonly targetsById: ReadonlyMap<string, SelectedObjectTarget>;
	readonly nodeIdsBySubtreeRootId: ReadonlyMap<string, readonly string[]>;
};

const DEFAULT_DUPLICATE_OFFSET = { x: 16, y: 16 } as const satisfies Vec2;

const ACTION_LABELS = {
	[SELECTED_OBJECT_ACTION_IDS.delete]: "Delete selection",
	[SELECTED_OBJECT_ACTION_IDS.duplicate]: "Duplicate selection",
	[SELECTED_OBJECT_ACTION_IDS.toggleLock]: "Lock selection",
	[SELECTED_OBJECT_ACTION_IDS.toggleVisibility]: "Hide selection",
	[SELECTED_OBJECT_ACTION_IDS.rename]: "Rename selection",
	[SELECTED_OBJECT_ACTION_IDS.focusArtboard]: "Focus artboard",
} as const satisfies Record<SelectedObjectActionId, string>;

const ACTION_OPERATIONS = {
	[SELECTED_OBJECT_ACTION_IDS.delete]: "delete",
	[SELECTED_OBJECT_ACTION_IDS.duplicate]: "duplicate",
	[SELECTED_OBJECT_ACTION_IDS.toggleLock]: "toggle-lock",
	[SELECTED_OBJECT_ACTION_IDS.toggleVisibility]: "toggle-visibility",
	[SELECTED_OBJECT_ACTION_IDS.rename]: "rename",
	[SELECTED_OBJECT_ACTION_IDS.focusArtboard]: "focus-artboard",
} as const satisfies Record<SelectedObjectActionId, SelectedObjectOperation>;

const uniqueStrings = <TValue extends string>(
	values: readonly TValue[],
): readonly TValue[] => [...new Set(values)];

const firstErrorOrIssue = (
	issues: readonly SelectedObjectActionIssue[],
): SelectedObjectActionIssue | null =>
	issues.find((issue) => issue.severity === "error") ?? issues[0] ?? null;

const issue = (
	actionId: SelectedObjectActionId,
	code: SelectedObjectActionIssueCode,
	severity: SelectedObjectActionIssueSeverity,
	message: string,
	options: {
		readonly sourceId?: string;
		readonly layerId?: string;
		readonly artboardId?: string;
		readonly reason?: SelectedObjectProtectionReason;
	} = {},
): SelectedObjectActionIssue => ({
	actionId,
	code,
	severity,
	message,
	...options,
});

const duplicateIdIssues = (
	actionId: SelectedObjectActionId,
	context: SelectedObjectContext,
	severity: SelectedObjectActionIssueSeverity,
): readonly SelectedObjectActionIssue[] =>
	context.duplicateNodeIds.map((sourceId) =>
		issue(
			actionId,
			"selected.duplicate-id",
			severity,
			"Selection contains the same node id more than once.",
			{ sourceId },
		),
	);

const missingNodeIssues = (
	actionId: SelectedObjectActionId,
	context: SelectedObjectContext,
	severity: SelectedObjectActionIssueSeverity,
): readonly SelectedObjectActionIssue[] =>
	context.missingNodeIds.map((sourceId) =>
		issue(
			actionId,
			"selected.missing-node",
			severity,
			"A selected node no longer exists in the scene.",
			{ sourceId },
		),
	);

const disabledReasonFromIssues = (
	issues: readonly SelectedObjectActionIssue[],
): SelectedObjectActionDisabledReason => {
	const blockingIssue = firstErrorOrIssue(issues);
	if (!blockingIssue) {
		return {
			code: "selected.no-live-selection",
			message: "No selected scene nodes are available for this action.",
			issueCodes: ["selected.no-live-selection"],
			issueCount: 1,
			sourceIds: [],
			layerIds: [],
			artboardIds: [],
			protectionReasons: [],
		};
	}

	return {
		code: blockingIssue.code,
		message: blockingIssue.message,
		issueCodes: uniqueStrings(issues.map((item) => item.code)),
		issueCount: issues.length,
		sourceIds: uniqueStrings(
			issues.flatMap((item) => (item.sourceId ? [item.sourceId] : [])),
		),
		layerIds: uniqueStrings(
			issues.flatMap((item) => (item.layerId ? [item.layerId] : [])),
		),
		artboardIds: uniqueStrings(
			issues.flatMap((item) => (item.artboardId ? [item.artboardId] : [])),
		),
		protectionReasons: uniqueStrings(
			issues.flatMap((item) => (item.reason ? [item.reason] : [])),
		),
	};
};

const reportFor = (
	actionId: SelectedObjectActionId,
	context: SelectedObjectContext,
	targetNodeIds: readonly string[],
	issues: readonly SelectedObjectActionIssue[],
): SelectedObjectActionReport => ({
	actionId,
	selectedNodeIds: context.selectedNodeIds,
	targetNodeIds,
	missingNodeIds: context.missingNodeIds,
	artboardIds: uniqueStrings(
		context.targets.map((target) => target.artboardId),
	),
	issueCodes: uniqueStrings(issues.map((item) => item.code)),
	issueCount: issues.length,
});

const preserveLiveSelection = (
	context: SelectedObjectContext,
): SelectedObjectNextSelection => ({
	kind: "preserve",
	nodeIds: context.targets.map((target) => target.nodeId),
	primaryNodeId: livePrimaryNodeId(
		context.targets.map((target) => target.nodeId),
		context.primaryNodeId,
	),
});

const replacementSelection = (
	nodeIds: readonly string[],
	previousPrimaryNodeId: string | null,
): SelectedObjectNextSelection => {
	const primaryNodeId = livePrimaryNodeId(nodeIds, previousPrimaryNodeId);
	if (nodeIds.length === 0) return { kind: "clear" };
	return {
		kind: "replace",
		nodeIds,
		primaryNodeId,
	};
};

const livePrimaryNodeId = (
	nodeIds: readonly string[],
	primaryNodeId: string | null,
): string | null => {
	if (primaryNodeId && nodeIds.includes(primaryNodeId)) return primaryNodeId;
	return nodeIds.at(-1) ?? null;
};

const normalizeOffset = (offset: Vec2 | undefined): Vec2 => ({
	x:
		offset && Number.isFinite(offset.x) ? offset.x : DEFAULT_DUPLICATE_OFFSET.x,
	y:
		offset && Number.isFinite(offset.y) ? offset.y : DEFAULT_DUPLICATE_OFFSET.y,
});

const targetIds = (
	targets: readonly SelectedObjectTarget[],
): readonly string[] => targets.map((target) => target.nodeId);

const disabledPlan = <TActionId extends SelectedObjectActionId>(
	actionId: TActionId,
	context: SelectedObjectContext,
	issues: readonly SelectedObjectActionIssue[],
	targetNodeIds: readonly string[] = targetIds(context.targets),
): SelectedObjectActionDisabledPlan<TActionId> => ({
	enabled: false,
	id: actionId,
	label: ACTION_LABELS[actionId],
	operation: ACTION_OPERATIONS[actionId],
	execution: null,
	nextSelection: preserveLiveSelection(context),
	undo: null,
	issues,
	disabledReason: disabledReasonFromIssues(issues),
	report: reportFor(actionId, context, targetNodeIds, issues),
});

const enabledPlan = <TActionId extends SelectedObjectActionId>(
	actionId: TActionId,
	context: SelectedObjectContext,
	options: {
		readonly label?: string;
		readonly execution: SelectedObjectActionExecution;
		readonly nextSelection?: SelectedObjectNextSelection;
		readonly undo: SelectedObjectUndoPlan | null;
		readonly issues?: readonly SelectedObjectActionIssue[];
		readonly targetNodeIds?: readonly string[];
	},
): SelectedObjectActionEnabledPlan<TActionId> => {
	const issues = options.issues ?? [];
	return {
		enabled: true,
		id: actionId,
		label: options.label ?? ACTION_LABELS[actionId],
		operation: ACTION_OPERATIONS[actionId],
		execution: options.execution,
		nextSelection: options.nextSelection ?? preserveLiveSelection(context),
		undo: options.undo,
		issues,
		disabledReason: null,
		report: reportFor(
			actionId,
			context,
			options.targetNodeIds ?? targetIds(context.targets),
			issues,
		),
	};
};

const collectSubtreeNodeIds = (
	node: VectorNode,
	output: string[] = [],
): readonly string[] => {
	output.push(node.id);
	if (node.children) {
		for (const child of node.children) collectSubtreeNodeIds(child, output);
	}
	return output;
};

const buildTargetLookup = (document: SceneDocument): TargetLookup => {
	const artboardMapping = selectNodeArtboardMapping(document);
	const targetsById = new Map<string, SelectedObjectTarget>();
	const nodeIdsBySubtreeRootId = new Map<string, readonly string[]>();

	for (const [layerIndex, layer] of document.layers.entries()) {
		const visit = (
			nodes: readonly VectorNode[],
			parentNodeIds: readonly string[],
			hiddenByAncestor: boolean,
			lockedByAncestor: boolean,
			topLevelIndex: number,
		): void => {
			for (const [index, node] of nodes.entries()) {
				const nextTopLevelIndex =
					parentNodeIds.length === 0 ? index : topLevelIndex;
				const effectiveVisible =
					layer.visible && !hiddenByAncestor && node.visible;
				const effectiveLocked = layer.locked || lockedByAncestor || node.locked;
				const subtreeNodeIds = collectSubtreeNodeIds(node, []);
				targetsById.set(node.id, {
					node,
					nodeId: node.id,
					layer,
					layerId: layer.id,
					layerIndex,
					parentNodeIds,
					topLevelIndex: nextTopLevelIndex,
					artboardId: artboardMapping.byNodeId[node.id] ?? document.artboard.id,
					visible: node.visible,
					locked: node.locked,
					effectiveVisible,
					effectiveLocked,
					hiddenByAncestor,
					lockedByAncestor,
				});
				nodeIdsBySubtreeRootId.set(node.id, subtreeNodeIds);
				if (node.children) {
					visit(
						node.children,
						[...parentNodeIds, node.id],
						hiddenByAncestor || !node.visible,
						lockedByAncestor || node.locked,
						nextTopLevelIndex,
					);
				}
			}
		};

		visit(layer.nodes, [], !layer.visible, layer.locked, 0);
	}

	return { targetsById, nodeIdsBySubtreeRootId };
};

const buildContext = (
	input: PlanSelectedObjectActionsInput,
): SelectedObjectContext => {
	const lookup = buildTargetLookup(input.document);
	const selectedNodeIds: string[] = [];
	const duplicateNodeIds: string[] = [];
	const seen = new Set<string>();

	for (const nodeId of input.selectedNodeIds) {
		if (seen.has(nodeId)) {
			duplicateNodeIds.push(nodeId);
			continue;
		}
		seen.add(nodeId);
		selectedNodeIds.push(nodeId);
	}

	const targets = selectedNodeIds.flatMap((nodeId) => {
		const target = lookup.targetsById.get(nodeId);
		return target ? [target] : [];
	});
	const missingNodeIds = selectedNodeIds.filter(
		(nodeId) => !lookup.targetsById.has(nodeId),
	);
	const requestedPrimary =
		input.primaryNodeId && selectedNodeIds.includes(input.primaryNodeId)
			? input.primaryNodeId
			: null;

	return {
		document: input.document,
		requestedNodeIds: input.selectedNodeIds,
		selectedNodeIds,
		primaryNodeId: requestedPrimary ?? selectedNodeIds.at(-1) ?? null,
		targets,
		missingNodeIds,
		duplicateNodeIds,
	};
};

const emptySelectionIssues = (
	actionId: SelectedObjectActionId,
	context: SelectedObjectContext,
): readonly SelectedObjectActionIssue[] =>
	context.selectedNodeIds.length === 0
		? [
				issue(
					actionId,
					"selected.empty-selection",
					"error",
					"Select at least one scene node before using this action.",
				),
			]
		: [];

const noLiveSelectionIssues = (
	actionId: SelectedObjectActionId,
	context: SelectedObjectContext,
): readonly SelectedObjectActionIssue[] =>
	context.targets.length === 0 && context.selectedNodeIds.length > 0
		? [
				issue(
					actionId,
					"selected.no-live-selection",
					"error",
					"The current selection has no live scene nodes.",
				),
			]
		: [];

const hiddenProtectionReason = (
	target: SelectedObjectTarget,
): SelectedObjectProtectionReason => {
	if (!target.visible) return "node-hidden";
	if (!target.layer.visible) return "layer-hidden";
	return "ancestor-hidden";
};

const lockedProtectionReason = (
	target: SelectedObjectTarget,
): SelectedObjectProtectionReason => {
	if (target.locked) return "node-locked";
	if (target.layer.locked) return "layer-locked";
	return "ancestor-locked";
};

const protectionIssueForTarget = (
	actionId: SelectedObjectActionId,
	target: SelectedObjectTarget,
	lockedSeverity: SelectedObjectActionIssueSeverity,
	hiddenSeverity: SelectedObjectActionIssueSeverity,
): readonly SelectedObjectActionIssue[] => {
	const issues: SelectedObjectActionIssue[] = [];
	if (!target.effectiveVisible) {
		const reason = hiddenProtectionReason(target);
		issues.push(
			issue(
				actionId,
				reason === "node-hidden"
					? "selected.hidden-source"
					: "selected.protected-source",
				hiddenSeverity,
				"Hidden selected nodes are protected for this action.",
				{
					sourceId: target.nodeId,
					layerId: target.layerId,
					artboardId: target.artboardId,
					reason,
				},
			),
		);
	}
	if (target.effectiveLocked) {
		const reason = lockedProtectionReason(target);
		issues.push(
			issue(
				actionId,
				reason === "node-locked"
					? "selected.locked-source"
					: "selected.protected-source",
				lockedSeverity,
				"Locked selected nodes are protected for this action.",
				{
					sourceId: target.nodeId,
					layerId: target.layerId,
					artboardId: target.artboardId,
					reason,
				},
			),
		);
	}
	return issues;
};

const planDelete = (
	context: SelectedObjectContext,
): SelectedObjectActionPlans["delete"] => {
	const actionId = SELECTED_OBJECT_ACTION_IDS.delete;
	const issues: SelectedObjectActionIssue[] = [
		...emptySelectionIssues(actionId, context),
		...missingNodeIssues(actionId, context, "warning"),
		...duplicateIdIssues(actionId, context, "warning"),
	];
	const commandNodeIds: string[] = [];
	const deletedNodeIds = new Set<string>();
	const protectedNodeIds = new Set<string>();
	const selectedIds = new Set(context.selectedNodeIds);
	const lookup = buildTargetLookup(context.document);

	const protectSelectedSubtree = (nodeId: string): void => {
		for (const subtreeNodeId of lookup.nodeIdsBySubtreeRootId.get(nodeId) ??
			[]) {
			if (selectedIds.has(subtreeNodeId)) protectedNodeIds.add(subtreeNodeId);
		}
	};

	const visit = (
		nodes: readonly VectorNode[],
		ancestorsUnlocked: boolean,
	): void => {
		for (const node of nodes) {
			if (!node.visible) {
				protectSelectedSubtree(node.id);
				continue;
			}

			const unlocked = ancestorsUnlocked && !node.locked;
			if (!unlocked) {
				if (selectedIds.has(node.id)) protectedNodeIds.add(node.id);
				if (node.children) visit(node.children, false);
				continue;
			}

			if (selectedIds.has(node.id)) {
				commandNodeIds.push(node.id);
				for (const subtreeNodeId of collectSubtreeNodeIds(node, [])) {
					deletedNodeIds.add(subtreeNodeId);
				}
				continue;
			}

			if (node.children) visit(node.children, true);
		}
	};

	for (const layer of context.document.layers) {
		if (!layer.visible || layer.locked) {
			for (const node of layer.nodes) protectSelectedSubtree(node.id);
			continue;
		}
		visit(layer.nodes, true);
	}

	for (const sourceId of protectedNodeIds) {
		const target = lookup.targetsById.get(sourceId);
		issues.push(
			issue(
				actionId,
				commandNodeIds.length > 0
					? "selected.protected-delete-selection"
					: "selected.no-deletable-selection",
				commandNodeIds.length > 0 ? "warning" : "error",
				commandNodeIds.length > 0
					? "Hidden or locked selected nodes will remain selected."
					: "Hidden or locked selected nodes cannot be deleted.",
				{
					sourceId,
					layerId: target?.layerId,
					artboardId: target?.artboardId,
					reason: target
						? target.effectiveVisible
							? lockedProtectionReason(target)
							: hiddenProtectionReason(target)
						: undefined,
				},
			),
		);
	}

	if (
		context.selectedNodeIds.length > 0 &&
		commandNodeIds.length === 0 &&
		protectedNodeIds.size === 0
	) {
		issues.push(
			issue(
				actionId,
				"selected.no-deletable-selection",
				"error",
				"The current selection has no deletable scene nodes.",
			),
		);
	}

	if (commandNodeIds.length === 0) {
		return disabledPlan(actionId, context, issues);
	}

	const remainingNodeIds = context.selectedNodeIds.filter(
		(nodeId) =>
			!deletedNodeIds.has(nodeId) && !context.missingNodeIds.includes(nodeId),
	);

	return enabledPlan(actionId, context, {
		execution: {
			kind: "scene-command",
			command: createDeleteNodesCommand(commandNodeIds),
		},
		nextSelection: replacementSelection(
			remainingNodeIds,
			context.primaryNodeId,
		),
		undo: { label: "Delete nodes", coalescePolicy: "by-command" },
		issues,
		targetNodeIds: commandNodeIds,
	});
};

const planDuplicate = (
	context: SelectedObjectContext,
	offset: Vec2 | undefined,
): SelectedObjectActionPlans["duplicate"] => {
	const actionId = SELECTED_OBJECT_ACTION_IDS.duplicate;
	const issues: SelectedObjectActionIssue[] = [
		...emptySelectionIssues(actionId, context),
		...noLiveSelectionIssues(actionId, context),
		...missingNodeIssues(actionId, context, "error"),
		...duplicateIdIssues(actionId, context, "error"),
	];
	for (const target of context.targets) {
		issues.push(
			...protectionIssueForTarget(actionId, target, "error", "error"),
		);
		if (target.parentNodeIds.length > 0) {
			issues.push(
				issue(
					actionId,
					"selected.nested-source-unsupported",
					"error",
					"Duplicate currently accepts top-level layer nodes as sources.",
					{
						sourceId: target.nodeId,
						layerId: target.layerId,
						artboardId: target.artboardId,
					},
				),
			);
		}
	}

	const layerIds = uniqueStrings(
		context.targets.map((target) => target.layerId),
	);
	if (layerIds.length > 1) {
		issues.push(
			issue(
				actionId,
				"selected.cross-layer-selection",
				"error",
				"Duplicate currently requires selected sources in one layer.",
			),
		);
	}

	const artboardIds = uniqueStrings(
		context.targets.map((target) => target.artboardId),
	);
	if (artboardIds.length > 1) {
		issues.push(
			issue(
				actionId,
				"selected.mixed-artboard",
				"warning",
				"Selection spans multiple artboards; duplicate preserves each source artboard.",
			),
		);
	}

	if (issues.some((item) => item.severity === "error")) {
		return disabledPlan(actionId, context, issues);
	}

	const sourceLayerId = layerIds[0];
	if (!sourceLayerId || context.targets.length === 0) {
		return disabledPlan(actionId, context, [
			...issues,
			issue(
				actionId,
				"selected.no-live-selection",
				"error",
				"The current selection has no duplicate sources.",
			),
		]);
	}

	return enabledPlan(actionId, context, {
		execution: {
			kind: "command-factory",
			factory: "clipboard.duplicate-nodes",
			input: {
				kind: "clipboard.duplicate-nodes",
				documentId: context.document.id,
				sourceNodeIds: context.targets.map((target) => target.nodeId),
				sourceLayerId,
				offset: normalizeOffset(offset),
			},
		},
		nextSelection: {
			kind: "command-result",
			source: "duplicate.new-root-node-ids",
			fallbackNodeIds: context.targets.map((target) => target.nodeId),
		},
		undo: { label: "Duplicate nodes", coalescePolicy: "by-command" },
		issues,
	});
};

const planToggleLock = (
	context: SelectedObjectContext,
): SelectedObjectActionPlans["toggleLock"] => {
	const actionId = SELECTED_OBJECT_ACTION_IDS.toggleLock;
	const issues: SelectedObjectActionIssue[] = [
		...emptySelectionIssues(actionId, context),
		...noLiveSelectionIssues(actionId, context),
		...missingNodeIssues(actionId, context, "warning"),
		...duplicateIdIssues(actionId, context, "warning"),
	];
	if (context.targets.length === 0)
		return disabledPlan(actionId, context, issues);

	const targetLocked = !context.targets.every((target) => target.locked);
	const label = targetLocked ? "Lock selection" : "Unlock selection";
	const commands = context.targets.map((target) =>
		createSetNodeLockedCommand(target.nodeId, targetLocked),
	);

	return enabledPlan(actionId, context, {
		label,
		execution: {
			kind: "scene-commands",
			commands,
			transaction: {
				label,
				coalescePolicy: "never",
				transactionKeyHint: "selected-object:toggle-lock",
			},
		},
		undo: {
			label,
			coalescePolicy: "never",
			transactionKeyHint: "selected-object:toggle-lock",
		},
		issues,
	});
};

const planToggleVisibility = (
	context: SelectedObjectContext,
): SelectedObjectActionPlans["toggleVisibility"] => {
	const actionId = SELECTED_OBJECT_ACTION_IDS.toggleVisibility;
	const issues: SelectedObjectActionIssue[] = [
		...emptySelectionIssues(actionId, context),
		...noLiveSelectionIssues(actionId, context),
		...missingNodeIssues(actionId, context, "warning"),
		...duplicateIdIssues(actionId, context, "warning"),
	];
	if (context.targets.length === 0)
		return disabledPlan(actionId, context, issues);

	const targetVisible = !context.targets.every((target) => target.visible);
	const label = targetVisible ? "Show selection" : "Hide selection";
	const commands = context.targets.map((target) =>
		createSetNodeVisibilityCommand(target.nodeId, targetVisible),
	);

	return enabledPlan(actionId, context, {
		label,
		execution: {
			kind: "scene-commands",
			commands,
			transaction: {
				label,
				coalescePolicy: "never",
				transactionKeyHint: "selected-object:toggle-visibility",
			},
		},
		nextSelection: targetVisible
			? preserveLiveSelection(context)
			: replacementSelection([], context.primaryNodeId),
		undo: {
			label,
			coalescePolicy: "never",
			transactionKeyHint: "selected-object:toggle-visibility",
		},
		issues,
	});
};

const planRename = (
	context: SelectedObjectContext,
): SelectedObjectActionPlans["rename"] => {
	const actionId = SELECTED_OBJECT_ACTION_IDS.rename;
	const issues: SelectedObjectActionIssue[] = [
		...emptySelectionIssues(actionId, context),
		...noLiveSelectionIssues(actionId, context),
		...missingNodeIssues(actionId, context, "warning"),
		...duplicateIdIssues(actionId, context, "warning"),
	];

	if (context.targets.length > 1) {
		issues.push(
			issue(
				actionId,
				"selected.multiple-rename-targets",
				"error",
				"Rename needs exactly one selected node.",
			),
		);
	}

	const target = context.targets[0];
	if (!target || issues.some((item) => item.severity === "error")) {
		return disabledPlan(actionId, context, issues);
	}

	return enabledPlan(actionId, context, {
		execution: {
			kind: "ui-intent",
			intent: {
				kind: "start-node-rename",
				nodeId: target.nodeId,
				currentName: target.node.name,
				commit: {
					kind: "scene.rename-node",
					nodeId: target.nodeId,
					valueParameter: "name",
				},
			},
		},
		undo: null,
		issues,
		targetNodeIds: [target.nodeId],
	});
};

const planFocusArtboard = (
	context: SelectedObjectContext,
): SelectedObjectActionPlans["focusArtboard"] => {
	const actionId = SELECTED_OBJECT_ACTION_IDS.focusArtboard;
	const issues: SelectedObjectActionIssue[] = [
		...emptySelectionIssues(actionId, context),
		...noLiveSelectionIssues(actionId, context),
		...missingNodeIssues(actionId, context, "warning"),
		...duplicateIdIssues(actionId, context, "warning"),
	];
	const artboardIds = uniqueStrings(
		context.targets.map((target) => target.artboardId),
	);

	if (artboardIds.length > 1) {
		issues.push(
			issue(
				actionId,
				"selected.mixed-artboard",
				"error",
				"Focus artboard needs selected nodes from one artboard.",
			),
		);
	}

	const artboardId = artboardIds[0];
	if (!artboardId || issues.some((item) => item.severity === "error")) {
		return disabledPlan(actionId, context, issues);
	}

	const currentArtboardId = selectCurrentArtboard(context.document).id;
	if (artboardId === currentArtboardId) {
		const sameArtboardIssues = [
			...issues,
			issue(
				actionId,
				"selected.same-artboard-focus",
				"error",
				"The selected nodes already belong to the focused artboard.",
				{ artboardId },
			),
		];
		return disabledPlan(actionId, context, sameArtboardIssues);
	}

	return enabledPlan(actionId, context, {
		execution: {
			kind: "scene-command",
			command: createSetCurrentArtboardCommand(artboardId, {
				label: "Focus artboard",
			}),
		},
		nextSelection: {
			kind: "focus-artboard",
			artboardId,
			nodeIds: context.targets.map((target) => target.nodeId),
			primaryNodeId: livePrimaryNodeId(
				context.targets.map((target) => target.nodeId),
				context.primaryNodeId,
			),
		},
		undo: { label: "Focus artboard", coalescePolicy: "by-command" },
		issues,
	});
};

/**
 * Plans high-frequency selected-object actions from a scene snapshot without
 * reading UI stores or mutating the command bus. The contract is intentionally
 * executable by different surfaces: some actions return scene commands, duplicate
 * returns a factory input for the existing clipboard command path, and rename
 * returns a UI start intent plus the scene rename factory metadata.
 */
export function planSelectedObjectActions(
	input: PlanSelectedObjectActionsInput,
): SelectedObjectActionPlans {
	const context = buildContext(input);
	return {
		delete: planDelete(context),
		duplicate: planDuplicate(context, input.duplicateOffset),
		toggleLock: planToggleLock(context),
		toggleVisibility: planToggleVisibility(context),
		rename: planRename(context),
		focusArtboard: planFocusArtboard(context),
	};
}

/**
 * Converts a rename intent produced by the planner into a scene command after UI
 * collects the new name. Keeping this bridge separate prevents the planner from
 * pretending rename is executable before the next name exists.
 */
export function createSelectedObjectRenameCommand(
	intent: RenameSelectedNodeIntent,
	name: string,
): SceneCommand {
	return createRenameNodeCommand(intent.nodeId, name);
}
