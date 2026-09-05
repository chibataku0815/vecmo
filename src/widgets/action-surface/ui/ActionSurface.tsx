import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { commitLinkedInstancePlan } from "@/entities/component-motion/model/plan-linked-instance";
import { useGuideStore } from "@/entities/guides/model/store";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	currentMotionGrammarTargetNodeIds,
	useMotionGrammarStore,
} from "@/entities/motion-grammar/model/store";
import { createUpdateNodeStyleCommand } from "@/entities/scene/model/node-commands";
import {
	findNode,
	selectAllArtboards,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Bounds, SceneDocument } from "@/entities/scene/model/types";
import { commitArrangeNodes } from "@/features/arrange/model/actions";
import { downloadExportBundle } from "@/features/export/adapters/download";
import { createExportBundle } from "@/features/export/model/bundle";
import { globalHistoryPort } from "@/features/history/model/undo-coordinator";
import {
	commitToggleNodeLocked,
	commitToggleNodeVisibility,
} from "@/features/layer-hierarchy/model/visibility-lock-commands";
import { keyNodePoseAtPlayhead } from "@/features/motion/model/key-pose";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { commitMotionRelationAuthoringPlan } from "@/features/motion-parenting/model/authoring";
import {
	commitSelectedPathFinishingOperation,
	commitSelectedPathOperation,
	type PathOperation,
	selectedPathFinishingCleanupSelection,
	selectedPathOperationCleanupSelection,
	selectedPathOperationState,
} from "@/features/path-ops";
import {
	commitSceneCameraAuthoringPlan,
	type SceneCameraAuthoringCommandPlan,
} from "@/features/scene-camera/model/authoring";
import { useSelectionStore } from "@/features/selection/model/store";
import {
	selectedObjectWorkflowTransactionCoalesceKey,
	useSelectedObjectRenameRequestStore,
} from "@/features/structure-actions";
import type { StyleTransferPayload } from "@/features/style-transfer";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import { commitFlipNodes } from "@/features/transform/model/flip";
import { useRepeatTransformStore } from "@/features/transform/model/repeat-transform";
import { useTransformUiStore } from "@/features/transform/model/store";
import { useViewportStore } from "@/features/viewport/model/store";
import {
	executeAction,
	executeActionItem,
	resolveRegistryInput,
	shortcutLabel,
} from "@/shared/actions";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import { createId } from "@/shared/lib/id";
import { addFrameDiagnosticCount } from "@/shared/performance/frame-diagnostics";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import { selectedNodePasteboardBounds } from "@/widgets/canvas-shell/model/context-actions";
import { applyRepeatTransformWorkflow } from "@/widgets/canvas-shell/model/repeat-transform-workflow";
import { useLayerWorkflowClipboardStore } from "@/widgets/layers-panel/model/workflow-clipboard";
import {
	type EditorActionContext,
	type EditorActionRuntime,
	editorActionGroupsForSurface,
	editorActionRegistry,
} from "../model/editor-actions";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";

type ExportSnapshot = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
};

/**
 * Boolean path operations exposed as a visible contextual toolbar (not just the
 * command palette). Order matches the common Illustrator pathfinder grouping.
 */
const VISIBLE_PATH_OPERATIONS = [
	"union",
	"subtract",
	"intersect",
] as const satisfies readonly PathOperation[];

const PATH_OPERATION_BUTTON_LABELS: Record<
	(typeof VISIBLE_PATH_OPERATIONS)[number],
	{ readonly short: string; readonly full: string }
> = {
	union: { short: "Uni", full: "Union paths" },
	subtract: { short: "Sub", full: "Subtract paths" },
	intersect: { short: "Int", full: "Intersect paths" },
};

const currentExportSnapshot = (): ExportSnapshot => ({
	scene: useSceneStore.getState().document,
	motion: useMotionStore.getState().document,
	frame: useTransportStore.getState().currentFrame,
});

const exportCurrentState = (): void => {
	downloadExportBundle(createExportBundle(currentExportSnapshot()));
};

const stopGlobalShortcut = (event: KeyboardEvent): void => {
	event.preventDefault();
	event.stopPropagation();
};

let opacityShortcutSequence = 0;

const uniqueNodeIds = (nodeIds: readonly string[]): readonly string[] => [
	...new Set(nodeIds),
];

const applySelectedOpacity = (
	nodeIds: readonly string[],
	opacity: number,
): void => {
	const targetNodeIds = uniqueNodeIds(nodeIds);
	if (targetNodeIds.length === 0) return;
	const store = useSceneStore.getState();
	if (store.transaction) return;
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	const label = `Set opacity ${Math.round(opacity * 100)}%`;
	const onlyNodeId = targetNodeIds[0];
	if (targetNodeIds.length === 1 && onlyNodeId) {
		store.apply(
			createUpdateNodeStyleCommand(
				onlyNodeId,
				{ opacity },
				{
					grammarTargetNodeIds,
					motion,
				},
			),
		);
		return;
	}
	store.beginTransaction(
		`shortcut-opacity:${opacityShortcutSequence++}`,
		label,
	);
	for (const nodeId of targetNodeIds) {
		store.apply(
			createUpdateNodeStyleCommand(
				nodeId,
				{ opacity },
				{
					grammarTargetNodeIds,
					motion,
				},
			),
		);
	}
	store.commit();
};

const applySceneCameraAuthoringPlan = (
	plan: SceneCameraAuthoringCommandPlan,
	selection?: Parameters<EditorActionRuntime["selectSceneCamera"]>[0],
): void => {
	commitSceneCameraAuthoringPlan(plan);
	if (selection !== undefined) {
		useSelectionStore.getState().selectSceneCamera(selection);
	}
};

type ActionSurfaceProps = {
	readonly onFitArtboard: () => void;
	readonly onFitSelection: (bounds: Bounds) => void;
	readonly onSave?: () => void;
	readonly saveAvailable?: boolean;
};

export function ActionSurface({
	onFitArtboard,
	onFitSelection,
	onSave = () => undefined,
	saveAvailable = false,
}: ActionSurfaceProps) {
	addFrameDiagnosticCount("react.ActionSurface.commit");
	const activeTool = useToolSelectionStore((state) => state.activeTool);
	const panelsOpen = useEditorChromeStore((state) => state.panelsOpen);
	const layersOpen = useEditorChromeStore((state) => state.layersOpen);
	const inspectorOpen = useEditorChromeStore((state) => state.inspectorOpen);
	const timelineOpen = useEditorChromeStore((state) => state.timelineOpen);
	const lookWorkspaceOpen = useEditorChromeStore(
		(state) => state.lookWorkspaceOpen,
	);
	const boundingBoxHandlesVisible = useTransformUiStore(
		(state) => state.boundingBoxHandlesVisible,
	);
	const zoom = useViewportStore((state) => state.zoom);
	const panX = useViewportStore((state) => state.panX);
	const panY = useViewportStore((state) => state.panY);
	const scene = useSceneStore((state) => state.document);
	const motionDocument = useMotionStore((state) => state.document);
	const motionDurationFrames = motionDocument.durationFrames;
	const isPlaying = useTransportStore((state) => state.isPlaying);
	const [authoringFrame, setAuthoringFrame] = useState(
		() => useTransportStore.getState().currentFrame,
	);
	useEffect(
		() =>
			useTransportStore.subscribe((state, previous) => {
				if (state.isPlaying) return;
				if (
					state.currentFrame !== previous.currentFrame ||
					state.isPlaying !== previous.isPlaying
				) {
					setAuthoringFrame(state.currentFrame);
				}
			}),
		[],
	);
	const selectedNodeIds = useSelectionStore((state) => state.nodeIds);
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const sceneCameraSelection = useSelectionStore((state) => state.sceneCamera);
	const repeatTransformPlan = useRepeatTransformStore((state) => state.plan);
	const clipboardPayload = useLayerWorkflowClipboardStore(
		(state) => state.payload,
	);
	const guideLines = useGuideStore((state) => state.guideLines);
	const smartGuides = useGuideStore((state) => state.snap.smartGuides);
	const snapToPoint = useGuideStore((state) => state.snap.snapToPoint);
	const guideLinesVisible = useGuideStore(
		(state) => state.view.guideLinesVisible,
	);
	// Combined grid visibility for the Show/hide grid toggle's checked state: the
	// single user-facing "grid" is showing when either ambient grid is on.
	const gridVisible = useGuideStore(
		(state) => state.view.workspaceGridVisible || state.view.gridVisible,
	);
	// Global Cmd+Z is arbitrated across stores (see undo-coordinator), so its
	// enablement is the OR of every coordinated store, not scene alone.
	const sceneCanUndo = useSceneStore((state) => state.canUndo);
	const sceneCanRedo = useSceneStore((state) => state.canRedo);
	const motionCanUndo = useMotionStore((state) => state.canUndo);
	const motionCanRedo = useMotionStore((state) => state.canRedo);
	const grammarCanUndo = useMotionGrammarStore((state) => state.canUndo);
	const grammarCanRedo = useMotionGrammarStore((state) => state.canRedo);
	const canUndo = sceneCanUndo || motionCanUndo || grammarCanUndo;
	const canRedo = sceneCanRedo || motionCanRedo || grammarCanRedo;
	const [styleTransferPayload, setStyleTransferPayload] =
		useState<StyleTransferPayload | null>(null);
	// The command palette open-state is cross-cutting editor UI: the visible
	// trigger now lives in the top-bar (always reachable, incl. <=1080px), while
	// this surface owns the popover + keyboard dispatch. Both read it from the
	// shared editor store rather than passing refs between sibling widgets.
	const open = useEditorChromeStore((state) => state.commandPaletteOpen);
	const setCommandPaletteOpen = useEditorChromeStore(
		(state) => state.setCommandPaletteOpen,
	);
	const commandPaletteAction = editorActionRegistry.byId.get(
		"view.command-palette",
	);
	if (!commandPaletteAction?.shortcut) {
		throw new Error("Missing command palette action shortcut.");
	}
	const commandPaletteShortcutLabel = [
		commandPaletteAction.shortcut,
		...(commandPaletteAction.shortcutAliases ?? []),
	]
		.map((shortcut) => shortcutLabel(shortcut))
		.join(" / ");
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const paletteRef = useRef<HTMLDivElement>(null);
	const paletteBaseId = useId();
	const listboxId = `${paletteBaseId}-listbox`;
	const optionId = (index: number): string =>
		`${paletteBaseId}-option-${index}`;

	const selectionBounds = useMemo(() => {
		const nodes = selectedNodeIds.flatMap((nodeId) => {
			const node = findNode(scene, nodeId);
			return node ? [node] : [];
		});
		if (nodes.length === 0) return null;
		return selectedNodePasteboardBounds(
			nodes,
			selectAllArtboards(scene),
			selectNodeArtboardMapping(scene).byNodeId,
		);
	}, [scene, selectedNodeIds]);

	const context = useMemo<EditorActionContext>(
		() => ({
			scene,
			activeTool,
			panelsOpen,
			layersOpen,
			inspectorOpen,
			timelineOpen,
			lookWorkspaceOpen,
			boundingBoxHandlesVisible,
			zoom,
			panX,
			panY,
			selection: {
				nodeIds: selectedNodeIds,
				primary: primaryNodeId,
				sceneCamera: sceneCameraSelection,
			},
			repeatTransformPlan,
			selectionBounds,
			clipboardPayload,
			styleTransferPayload,
			guideLines,
			guideLinesVisible,
			gridVisible,
			smartGuides,
			snapToPoint,
			motion: {
				currentFrame: authoringFrame,
				durationFrames: motionDurationFrames,
				isPlaying,
			},
			motionDocument,
			canUndo,
			canRedo,
			canExport: true,
			saveAvailable,
		}),
		[
			activeTool,
			boundingBoxHandlesVisible,
			canRedo,
			canUndo,
			clipboardPayload,
			authoringFrame,
			gridVisible,
			guideLines,
			guideLinesVisible,
			inspectorOpen,
			isPlaying,
			layersOpen,
			lookWorkspaceOpen,
			motionDurationFrames,
			motionDocument,
			panX,
			panY,
			panelsOpen,
			primaryNodeId,
			repeatTransformPlan,
			sceneCameraSelection,
			scene,
			selectedNodeIds,
			selectionBounds,
			smartGuides,
			snapToPoint,
			styleTransferPayload,
			timelineOpen,
			zoom,
			saveAvailable,
		],
	);
	const contextAtExecution = useCallback((): EditorActionContext => {
		const transport = useTransportStore.getState();
		return {
			...context,
			motion: {
				...context.motion,
				currentFrame: transport.currentFrame,
				isPlaying: transport.isPlaying,
			},
		};
	}, [context]);

	const runtime = useMemo<EditorActionRuntime>(
		() => ({
			setActiveTool: (tool) =>
				useToolSelectionStore.getState().setActiveTool(tool),
			togglePanels: () => useEditorChromeStore.getState().togglePanels(),
			toggleLayersPanel: () =>
				useEditorChromeStore.getState().toggleLayersPanel(),
			toggleInspectorPanel: () =>
				useEditorChromeStore.getState().toggleInspectorPanel(),
			toggleTimeline: () => useEditorChromeStore.getState().toggleTimeline(),
			toggleLookWorkspace: () =>
				useEditorChromeStore.getState().toggleLookWorkspace(),
			toggleVisualReview: () =>
				useEditorChromeStore.getState().toggleVisualReview(),
			toggleShortcutHelp: () =>
				useEditorChromeStore.getState().toggleShortcutHelp(),
			toggleCommandPalette: () =>
				useEditorChromeStore.getState().toggleCommandPalette(),
			zoomIn: () => useViewportStore.getState().zoomStepIn(),
			zoomOut: () => useViewportStore.getState().zoomStepOut(),
			zoomTo100: () => useViewportStore.getState().zoomToActualSize(),
			zoomToSelection: onFitSelection,
			resetViewport: onFitArtboard,
			undo: () => globalHistoryPort.undo(),
			redo: () => globalHistoryPort.redo(),
			arrangeNodes: commitArrangeNodes,
			selectAll: () =>
				useSelectionStore
					.getState()
					.selectAll(useSceneStore.getState().document),
			selectInverse: () =>
				useSelectionStore
					.getState()
					.selectInverse(useSceneStore.getState().document),
			selectNodes: (nodeIds, primaryNodeId) =>
				useSelectionStore.getState().setSelection(nodeIds, primaryNodeId),
			applyMotionRelationPlan: commitMotionRelationAuthoringPlan,
			applyMotionCommand: (command) => useMotionStore.getState().apply(command),
			flipNodes: (nodeIds, axis) => {
				commitFlipNodes(nodeIds, axis);
			},
			resetBoundingBox: (nodeIds) =>
				useTransformUiStore.getState().resetToAxisAligned(nodeIds),
			toggleBoundingBox: () =>
				useTransformUiStore.getState().toggleBoundingBoxHandles(),
			toggleNodesLocked: (nodeIds) => {
				commitToggleNodeLocked(nodeIds);
			},
			toggleNodesVisibility: (nodeIds) => {
				commitToggleNodeVisibility(nodeIds);
			},
			setSelectedOpacity: applySelectedOpacity,
			togglePlayback: () => useTransportStore.getState().togglePlay(),
			stopPlayback: () => useTransportStore.getState().stop(),
			setMotionFrame: (frame) => {
				const transport = useTransportStore.getState();
				transport.pause();
				transport.setFrame(frame);
			},
			keyNodePose: keyNodePoseAtPlayhead,
			applySceneCameraPlan: applySceneCameraAuthoringPlan,
			selectSceneCamera: (selection) =>
				useSelectionStore.getState().selectSceneCamera(selection),
			performPathOperation: (operation, selection) => {
				const result = commitSelectedPathOperation(operation, selection);
				const cleanup = selectedPathOperationCleanupSelection(result);
				if (!cleanup) return;
				useSelectionStore
					.getState()
					.setSelection(cleanup.nodeIds, cleanup.primary);
			},
			performPathFinishingOperation: (operation, selection) => {
				const result = commitSelectedPathFinishingOperation(
					operation,
					selection,
				);
				const cleanup = selectedPathFinishingCleanupSelection(result);
				if (!cleanup) return;
				useSelectionStore
					.getState()
					.setSelection(cleanup.nodeIds, cleanup.primary);
			},
			setWorkflowClipboardPayload: (payload) =>
				useLayerWorkflowClipboardStore.getState().setPayload(payload),
			setStyleTransferPayload,
			applyWorkflowCommand: (command, selectNodeIds, primaryNodeId) => {
				useSceneStore.getState().apply(command);
				const document = useSceneStore.getState().document;
				useSelectionStore.getState().setSelection(selectNodeIds, primaryNodeId);
				return document;
			},
			applyWorkflowCommands: (
				commands,
				selectNodeIds,
				transaction,
				primaryNodeId,
			) => {
				const sceneStore = useSceneStore.getState();
				if (commands.length === 0) return;
				if (commands.length === 1 || !transaction) {
					for (const command of commands) sceneStore.apply(command);
				} else {
					sceneStore.beginTransaction(
						selectedObjectWorkflowTransactionCoalesceKey(transaction),
						transaction.label,
					);
					for (const command of commands) sceneStore.apply(command);
					sceneStore.commit();
				}
				useSelectionStore.getState().setSelection(selectNodeIds, primaryNodeId);
			},
			applyLinkedInstancePlan: (plan) => {
				commitLinkedInstancePlan(
					plan,
					{
						scene: (command) => useSceneStore.getState().apply(command),
						motion: (command) => useMotionStore.getState().apply(command),
						grammar: (command) =>
							useMotionGrammarStore.getState().apply(command),
					},
					createId("instance-action"),
				);
				useSelectionStore
					.getState()
					.setSelection(plan.selectNodeIds, plan.selectNodeIds[0] ?? null);
			},
			applyStyleTransferCommand: (command, selectNodeIds) => {
				useSceneStore.getState().apply(command);
				useSelectionStore.getState().setSelection(selectNodeIds);
			},
			requestSelectedObjectRename: (intent) => {
				const chrome = useEditorChromeStore.getState();
				if (!chrome.layersOpen) chrome.toggleLayersPanel();
				useSelectedObjectRenameRequestStore.getState().requestRename(intent);
			},
			repeatTransform: applyRepeatTransformWorkflow,
			applyEffectIntentCommand: (command) => {
				useSceneStore.getState().apply(command);
			},
			toggleGuideLinesVisible: () =>
				useGuideStore.getState().toggleGuideLinesVisible(),
			toggleGrid: () => useGuideStore.getState().toggleGridGroup(),
			toggleSmartGuides: () => {
				useGuideStore.getState().toggleSmartGuides();
			},
			toggleSnapToPoint: () => {
				useGuideStore.getState().toggleSnapToPoint();
			},
			exportCurrentState,
			save: onSave,
		}),
		[onFitArtboard, onFitSelection, onSave],
	);

	const pathOpControls = useMemo(() => {
		const selection = { nodeIds: selectedNodeIds, primary: primaryNodeId };
		return VISIBLE_PATH_OPERATIONS.map((operation) => {
			const state = selectedPathOperationState(scene, operation, selection);
			return {
				operation,
				enabled: state.enabled,
				reason: state.enabled ? null : state.reason,
			};
		});
	}, [scene, selectedNodeIds, primaryNodeId]);
	const showPathOps = selectedNodeIds.length >= 2;

	const groups = useMemo(
		() => editorActionGroupsForSurface("command-palette", context, query),
		[context, query],
	);
	const visibleItems = useMemo(
		() => groups.flatMap((group) => group.items),
		[groups],
	);
	const activeItem = visibleItems[activeIndex] ?? null;
	useEffect(() => {
		setActiveIndex(0);
	}, []);

	useEffect(() => {
		if (activeIndex >= visibleItems.length) setActiveIndex(0);
	}, [activeIndex, visibleItems.length]);

	useEffect(() => {
		if (!open) return;
		// Opening (top-bar button, Mod+K, or Mod+P) focuses the search field and
		// resets the query/active row. Focus-return to the trigger is owned by the
		// top-bar that hosts it, so this surface no longer tracks the trigger ref.
		inputRef.current?.focus();
		setQuery("");
		setActiveIndex(0);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (
				paletteRef.current?.contains(target) ||
				(target instanceof Element &&
					target.closest("[data-command-palette-trigger]"))
			) {
				return;
			}
			setCommandPaletteOpen(false);
			setQuery("");
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", onPointerDown, true);
	}, [open, setCommandPaletteOpen]);

	useEffect(() => {
		if (!open) return;
		document
			.getElementById(`${paletteBaseId}-option-${activeIndex}`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open, paletteBaseId]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.defaultPrevented) return;
			// While the shortcut-help overlay is open it behaves as a modal: only
			// its own toggle (and Escape, handled by the overlay) may act. Each
			// global dispatcher gates on this flag independently so the guard does
			// not depend on window listener registration order.
			const helpOpen = useEditorChromeStore.getState().shortcutHelpOpen;
			const executionContext = contextAtExecution();
			const resolution = resolveRegistryInput(
				editorActionRegistry,
				event,
				executionContext,
				helpOpen ? { modalRootActionIds: ["view.shortcut-help"] } : undefined,
			);
			if (resolution.kind === "defer" || resolution.kind === "none") return;
			if (resolution.kind === "blocked") {
				if (
					resolution.reason === "disabled" ||
					resolution.reason === "modal-exclusive"
				) {
					stopGlobalShortcut(event);
				}
				return;
			}
			stopGlobalShortcut(event);
			void executeAction(
				editorActionRegistry,
				resolution.value.id,
				runtime,
				executionContext,
			);
		};

		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [contextAtExecution, runtime]);

	const runItem = (item: (typeof visibleItems)[number]): void => {
		if (!executeActionItem(item, runtime, contextAtExecution())) return;
		setCommandPaletteOpen(false);
		setQuery("");
		setActiveIndex(0);
	};

	const onPaletteKeyDown = (
		event: ReactKeyboardEvent<HTMLInputElement>,
	): void => {
		if (event.key === "Tab") {
			// The combobox input is the only focusable element in the palette
			// (options are aria-activedescendant, not tab stops), so trap Tab here.
			event.preventDefault();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			setCommandPaletteOpen(false);
			setQuery("");
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) =>
				visibleItems.length === 0 ? 0 : (index + 1) % visibleItems.length,
			);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) =>
				visibleItems.length === 0
					? 0
					: (index - 1 + visibleItems.length) % visibleItems.length,
			);
			return;
		}
		if (event.key === "Enter" && activeItem) {
			event.preventDefault();
			runItem(activeItem);
		}
	};

	return (
		<div className="action-surface">
			<TooltipProvider>
				<div className="action-surface-strip flex items-center gap-1">
					{showPathOps ? (
						<fieldset
							aria-label="Path operations"
							className="pointer-events-auto m-0 inline-flex h-8 items-center gap-0.5 rounded-md border border-white/10 bg-surface-raised/90 p-1 shadow-2xl shadow-black/35 backdrop-blur-xl"
						>
							{pathOpControls.map(({ operation, enabled, reason }) => {
								const labels = PATH_OPERATION_BUTTON_LABELS[operation];
								const tooltipLabel = reason
									? `${labels.full}. ${reason}`
									: labels.full;
								return (
									<Tooltip key={operation} label={tooltipLabel} side="bottom">
										<button
											type="button"
											aria-disabled={!enabled}
											aria-label={tooltipLabel}
											className={cn(
												"h-6 min-w-9 rounded px-1.5 font-medium text-ui leading-none transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent",
												enabled
													? "text-fg-secondary hover:bg-white/[0.08] hover:text-accent-fg"
													: "cursor-not-allowed text-fg-subtle hover:bg-transparent",
											)}
											onClick={() => {
												if (!enabled) return;
												runtime.performPathOperation(operation, {
													nodeIds: selectedNodeIds,
													primary: primaryNodeId,
													sceneCamera: sceneCameraSelection,
												});
											}}
										>
											{labels.short}
										</button>
									</Tooltip>
								);
							})}
						</fieldset>
					) : null}
				</div>
			</TooltipProvider>

			{open ? (
				<div
					ref={paletteRef}
					className="pointer-events-auto absolute top-9 left-1/2 w-[min(calc(100vw-16px),340px)] -translate-x-1/2 overflow-hidden rounded-lg border border-white/10 bg-surface-raised/96 shadow-2xl shadow-black/45 backdrop-blur-xl"
				>
					<label className="flex h-9 items-center gap-1.5 border-white/10 border-b px-2.5">
						<MagnifyingGlass
							aria-hidden="true"
							size={13}
							className="text-fg-muted"
						/>
						<input
							ref={inputRef}
							value={query}
							placeholder="Search actions"
							aria-label="Search actions"
							role="combobox"
							aria-expanded={open}
							aria-controls={listboxId}
							aria-autocomplete="list"
							aria-activedescendant={
								activeItem ? optionId(activeIndex) : undefined
							}
							onChange={(event) => {
								setQuery(event.currentTarget.value);
								setActiveIndex(0);
							}}
							onKeyDown={onPaletteKeyDown}
							className="min-w-0 flex-1 bg-transparent text-fg text-ui outline-none placeholder:text-fg-subtle"
						/>
						<span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-fg-muted text-ui">
							{commandPaletteShortcutLabel}
						</span>
					</label>

					<div
						id={listboxId}
						role="listbox"
						aria-label="Actions"
						className="max-h-[min(52svh,360px)] overflow-auto p-1"
					>
						{groups.length === 0 ? (
							<div className="px-2 py-3 text-center text-fg-muted text-ui">
								No actions
							</div>
						) : (
							groups.map((group) => (
								<section key={group.group.id} className="py-0.5">
									<div
										aria-hidden="true"
										className="px-2 pb-0.5 font-medium text-fg-muted text-ui uppercase tracking-[0.08em]"
									>
										{group.group.label}
									</div>
									<div className="space-y-0.5">
										{group.items.map((item) => {
											const enabled = item.availability.enabled;
											const selected = item.action.id === activeItem?.action.id;
											const itemIndex = visibleItems.findIndex(
												(visibleItem) =>
													visibleItem.action.id === item.action.id,
											);
											const disabledReason = enabled
												? null
												: item.availability.reason;
											return (
												<button
													key={item.action.id}
													type="button"
													role="option"
													id={optionId(itemIndex)}
													aria-selected={selected}
													tabIndex={-1}
													aria-disabled={!enabled}
													aria-label={
														disabledReason
															? `${item.action.label}. ${disabledReason}`
															: item.action.label
													}
													title={disabledReason ?? item.action.label}
													className={cn(
														"grid min-h-7 w-full grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-2 py-1 text-left text-ui transition",
														selected
															? "bg-accent-surface text-accent-fg"
															: "text-fg-secondary hover:bg-white/[0.06]",
														!enabled &&
															"cursor-not-allowed text-fg-subtle hover:bg-transparent",
													)}
													onMouseEnter={() => {
														const nextIndex = visibleItems.findIndex(
															(visibleItem) =>
																visibleItem.action.id === item.action.id,
														);
														if (nextIndex >= 0) setActiveIndex(nextIndex);
													}}
													onClick={() => runItem(item)}
												>
													<span className="grid size-3.5 place-items-center">
														{item.checked ? (
															<Check aria-hidden="true" size={11} />
														) : null}
													</span>
													<span className="min-w-0">
														<span className="block truncate">
															{item.action.label}
														</span>
														{disabledReason ? (
															<span className="block truncate text-fg-muted text-ui leading-tight">
																{disabledReason}
															</span>
														) : null}
													</span>
													{item.action.shortcut ? (
														<span className="font-mono text-fg-muted text-ui">
															{shortcutLabel(item.action.shortcut)}
														</span>
													) : null}
												</button>
											);
										})}
									</div>
								</section>
							))
						)}
					</div>
				</div>
			) : null}
			<ShortcutHelpOverlay />
		</div>
	);
}
