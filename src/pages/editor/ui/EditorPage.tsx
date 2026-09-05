import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import {
	artboardBounds,
	selectAllArtboardBounds,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { useIpadAuthoringSurface } from "@/features/ipad-shell/model/authoring-surface";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import { useViewportStore } from "@/features/viewport/model/store";
import {
	createViewportFitTarget,
	fitViewportToAllArtboardBounds,
	fitViewportToCurrentArtboardBounds,
	fitViewportToTarget,
	fitViewportToUsableRect,
	type ViewportFitBounds,
	type ViewportFitFrame,
} from "@/features/viewport/model/workspace-fit";
import { actionShortcuts, shortcutLabel } from "@/shared/actions";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import { platformCapabilities } from "@/shared/platform/mode";
import { DetachedWindow } from "@/shared/ui/DetachedWindow";
import {
	type EditorActionId,
	editorActionRegistry,
} from "@/widgets/action-surface/model/editor-actions";
import { ActionSurface } from "@/widgets/action-surface/ui/ActionSurface";
import { CanvasShell } from "@/widgets/canvas-shell/ui/CanvasShell";
import { useGrammarPropagation } from "@/widgets/component-motion/model/use-grammar-propagation";
import { useMotionPropagation } from "@/widgets/component-motion/model/use-motion-propagation";
import { GravityReviewGuide } from "@/widgets/gravity-review-guide/ui/GravityReviewGuide";
import { IpadPencilBar } from "@/widgets/tool-options/ui/IpadPencilBar";
import { ToolOptions } from "@/widgets/tool-options/ui/ToolOptions";
import { ToolRail } from "@/widgets/tool-rail/ui/ToolRail";
import { TopBar } from "@/widgets/top-bar/ui/TopBar";
import { TutorialGuide } from "@/widgets/tutorial-guide/ui/TutorialGuide";

const FloatingInspector = lazy(() =>
	import("@/widgets/inspector/ui/FloatingInspector").then((module) => ({
		default: module.FloatingInspector,
	})),
);

const InspectorPanel = lazy(() =>
	import("@/widgets/inspector/ui/InspectorPanel").then((module) => ({
		default: module.InspectorPanel,
	})),
);

const LayersPanel = lazy(() =>
	import("@/widgets/layers-panel/ui/LayersPanel").then((module) => ({
		default: module.LayersPanel,
	})),
);

const LookWorkspacePanel = lazy(() =>
	import("@/widgets/look-workspace/ui/LookWorkspacePanel").then((module) => ({
		default: module.LookWorkspacePanel,
	})),
);

const MotionCopilotPanel = lazy(() =>
	import("@/widgets/motion-copilot/ui/MotionCopilotPanel").then((module) => ({
		default: module.MotionCopilotPanel,
	})),
);

const ParameterCaptureStage = lazy(() =>
	import("@/widgets/parameter-capture/ui/ParameterCaptureStage").then(
		(module) => ({
			default: module.ParameterCaptureStage,
		}),
	),
);

const TimelinePanel = lazy(() =>
	import("@/widgets/timeline/ui/TimelinePanel").then((module) => ({
		default: module.TimelinePanel,
	})),
);

const EditorVisualReviewWorkspace = lazy(() =>
	import("@/widgets/visual-review-workspace").then((module) => ({
		default: module.EditorVisualReviewWorkspace,
	})),
);

type LazyPanelComponent = LazyExoticComponent<ComponentType>;

type PanelDescriptor = {
	readonly id: string;
	readonly visible: boolean;
	readonly Component: ComponentType | LazyPanelComponent;
	readonly fallbackClassName: string;
};

const DEFAULT_CHROME_GAP = 10;
const ARTBOARD_LABEL_CLEARANCE_PX = 24;
const PANEL_CHUNK_FALLBACK_CHROME =
	"overflow-hidden rounded-md border border-white/10 bg-surface-raised/70 shadow-2xl shadow-black/25 backdrop-blur-xl";

type WorkspaceFitScope = "all" | "current";

const actionShortcutLabel = (id: EditorActionId): string => {
	const shortcut = editorActionRegistry.byId.get(id)?.shortcut;
	if (!shortcut) {
		throw new Error(`Missing required editor action shortcut: ${id}`);
	}
	return shortcutLabel(shortcut);
};

const actionShortcutTitle = (id: EditorActionId): string => {
	const action = editorActionRegistry.byId.get(id);
	if (!action) throw new Error(`Missing required editor action: ${id}`);
	const labels = actionShortcuts(action).map((shortcut) =>
		shortcutLabel(shortcut),
	);
	return labels.length > 0
		? `${action.label} (${labels.join(" / ")})`
		: action.label;
};

const relativeInset = (
	edge: "top" | "right" | "bottom" | "left",
	container: DOMRect,
	rect: DOMRect | null,
	gap: number,
): number => {
	if (!rect) return gap;
	if (edge === "top") return Math.max(0, rect.bottom - container.top + gap);
	if (edge === "right") return Math.max(0, container.right - rect.left + gap);
	if (edge === "bottom") return Math.max(0, container.bottom - rect.top + gap);
	return Math.max(0, rect.right - container.left + gap);
};

const workspaceRect = (selector: string): DOMRect | null => {
	const rect = globalThis.document
		.querySelector<HTMLElement>(selector)
		?.getBoundingClientRect();
	if (!rect || (rect.width === 0 && rect.height === 0)) return null;
	return rect;
};

const floatingVerticalChromeInsets = (
	container: DOMRect,
	rect: DOMRect | null,
	gap: number,
): { readonly top: number; readonly bottom: number } => {
	if (!rect) return { top: 0, bottom: 0 };
	const centerY = rect.top + rect.height / 2;
	const containerCenterY = container.top + container.height / 2;
	return centerY < containerCenterY
		? { top: relativeInset("top", container, rect, gap), bottom: 0 }
		: { top: 0, bottom: relativeInset("bottom", container, rect, gap) };
};

function PanelChunkFallback({ className }: { readonly className: string }) {
	return (
		<div
			aria-hidden="true"
			className={cn(className, PANEL_CHUNK_FALLBACK_CHROME)}
		>
			<div className="h-full w-full animate-pulse bg-white/5" />
		</div>
	);
}

function DetachedLookWorkspaceFallback() {
	return <div aria-hidden="true" className="h-full w-full bg-surface-raised" />;
}

const measureWorkspaceFitFrame = (): ViewportFitFrame => {
	const container =
		workspaceRect(".editor-grid") ??
		new DOMRect(0, 0, globalThis.innerWidth, globalThis.innerHeight);
	const styles = globalThis.getComputedStyle(
		globalThis.document.documentElement,
	);
	const parsedGap = Number.parseFloat(
		styles.getPropertyValue("--editor-fit-gap"),
	);
	const gap = Number.isFinite(parsedGap) ? parsedGap : DEFAULT_CHROME_GAP;
	const topBar = workspaceRect(".top-bar");
	const actionSurface = workspaceRect(".action-surface");
	const toolRail = workspaceRect(".tool-rail");
	const toolOptions = workspaceRect(".tool-options");
	const layersPanel = workspaceRect(".layers-panel");
	const inspectorPanel = workspaceRect(".inspector-panel");
	const motionCopilotPanel = workspaceRect(".motion-copilot-panel");
	const timelinePanel = workspaceRect(".timeline-panel");
	const lookWorkspacePanel = workspaceRect(".look-workspace-panel");
	const ipadAuthoringChromeInsets = floatingVerticalChromeInsets(
		container,
		workspaceRect("[data-ipad-authoring-chrome='true']"),
		gap,
	);

	return {
		width: container.width,
		height: container.height,
		insets: {
			top:
				Math.max(
					relativeInset("top", container, topBar, gap),
					relativeInset("top", container, actionSurface, gap),
					ipadAuthoringChromeInsets.top,
				) + ARTBOARD_LABEL_CLEARANCE_PX,
			right: Math.max(
				relativeInset("right", container, inspectorPanel, gap),
				relativeInset("right", container, motionCopilotPanel, gap),
			),
			bottom: Math.max(
				relativeInset("bottom", container, toolRail, gap),
				relativeInset("bottom", container, toolOptions, gap),
				relativeInset("bottom", container, timelinePanel, gap),
				relativeInset("bottom", container, lookWorkspacePanel, gap),
				ipadAuthoringChromeInsets.bottom,
			),
			left: relativeInset("left", container, layersPanel, gap),
		},
	};
};

export function EditorPage({
	referenceTutorialSlug,
	gravityReviewSlug,
	onSave,
	saveAvailable = false,
}: {
	/** Set only for a reference-scene session (`/editor?ref=<slug>`) — renders
	 * the floating `TutorialGuide` inside `.editor-grid` so its CSS reflow rules
	 * (dodging the docked timeline) apply. Omitted for the normal editor route. */
	readonly referenceTutorialSlug?: string;
	/** Set only for an internal Gravity review session. The guide is an
	 * ephemeral disclosure/playlist over a normally restored candidate, never a
	 * second document state or a bespoke media player. */
	readonly gravityReviewSlug?: string;
	readonly onSave?: () => void;
	readonly saveAvailable?: boolean;
} = {}) {
	// Keep linked component instances in sync with their masters. Installed once at
	// the editor root so a master edit through any path propagates: keyframe tracks
	// via the motion store, technique bindings via the grammar store.
	useMotionPropagation();
	useGrammarPropagation();
	const layersOpen = useEditorChromeStore((state) => state.layersOpen);
	const inspectorOpen = useEditorChromeStore((state) => state.inspectorOpen);
	const timelineOpen = useEditorChromeStore((state) => state.timelineOpen);
	const lookWorkspaceOpen = useEditorChromeStore(
		(state) => state.lookWorkspaceOpen,
	);
	const activeTool = useToolSelectionStore((state) => state.activeTool);
	const lookWorkspaceDetached = useEditorChromeStore(
		(state) => state.lookWorkspaceDetached,
	);
	const dockLookWorkspace = useEditorChromeStore(
		(state) => state.dockLookWorkspace,
	);
	const parameterCaptureOpen = useEditorChromeStore(
		(state) => state.parameterCaptureOpen,
	);
	const visualReviewOpen = useEditorChromeStore(
		(state) => state.visualReviewOpen,
	);
	const setVisualReviewOpen = useEditorChromeStore(
		(state) => state.setVisualReviewOpen,
	);
	// Scalar selectors keep this stable: at most one re-render of the page shell
	// per width commit, and the heavy panels never subscribe to width.
	const leftPanelWidth = useEditorChromeStore((state) => state.leftPanelWidth);
	const rightPanelWidth = useEditorChromeStore(
		(state) => state.rightPanelWidth,
	);
	const timelineExpanded = useEditorChromeStore(
		(state) => state.timelineExpanded,
	);
	const timelineHeight = useEditorChromeStore((state) => state.timelineHeight);
	const lookWorkspaceHeight = useEditorChromeStore(
		(state) => state.lookWorkspaceHeight,
	);
	const inspectorMotionHeight = useEditorChromeStore(
		(state) => state.inspectorMotionHeight,
	);
	const motionCopilotOpen = useEditorChromeStore(
		(state) => state.motionCopilotOpen,
	);
	const motionCopilotWidth = useEditorChromeStore(
		(state) => state.motionCopilotWidth,
	);
	const iPadAuthoringSurface = useIpadAuthoringSurface();
	const artboardFitSignature = useSceneStore((state) => {
		const bounds = selectAllArtboardBounds(state.document);
		const currentArtboardId = selectCurrentArtboard(state.document).id;
		return `${currentArtboardId}:${bounds
			.map(
				(bound) =>
					`${bound.artboardId},${bound.x},${bound.y},${bound.width},${bound.height}`,
			)
			.join("|")}`;
	});
	const lastFitScopeRef = useRef<WorkspaceFitScope>("current");
	const pendingFitFramesRef = useRef<readonly number[]>([]);
	const fitArtboardsToWorkspace = useCallback((scope: WorkspaceFitScope) => {
		lastFitScopeRef.current = scope;
		const document = useSceneStore.getState().document;
		const frame = measureWorkspaceFitFrame();
		const allArtboardBounds = selectAllArtboardBounds(document);
		const transform =
			(scope === "current" && allArtboardBounds.length > 0
				? fitViewportToCurrentArtboardBounds(
						artboardBounds(selectCurrentArtboard(document)),
						frame,
					)
				: fitViewportToAllArtboardBounds(allArtboardBounds, frame)) ??
			fitViewportToUsableRect(
				{ width: document.artboard.width, height: document.artboard.height },
				frame,
			);
		const viewport = useViewportStore.getState();
		viewport.setZoom(transform.zoom);
		viewport.setPan(transform.panX, transform.panY);
	}, []);
	const cancelScheduledFit = useCallback(() => {
		for (const frame of pendingFitFramesRef.current) {
			globalThis.cancelAnimationFrame(frame);
		}
		pendingFitFramesRef.current = [];
	}, []);
	const scheduleWorkspaceFit = useCallback(
		(scope: WorkspaceFitScope = lastFitScopeRef.current) => {
			cancelScheduledFit();
			const firstFrame = globalThis.requestAnimationFrame(() => {
				const secondFrame = globalThis.requestAnimationFrame(() => {
					pendingFitFramesRef.current = [];
					fitArtboardsToWorkspace(scope);
				});
				pendingFitFramesRef.current = [secondFrame];
			});
			pendingFitFramesRef.current = [firstFrame];
		},
		[cancelScheduledFit, fitArtboardsToWorkspace],
	);
	const fitArtboardToWorkspace = useCallback(() => {
		fitArtboardsToWorkspace("current");
	}, [fitArtboardsToWorkspace]);
	const fitSelectionToWorkspace = useCallback((bounds: ViewportFitBounds) => {
		const frame = measureWorkspaceFitFrame();
		const transform = fitViewportToTarget(
			createViewportFitTarget(bounds),
			frame,
		);
		const viewport = useViewportStore.getState();
		viewport.setZoom(transform.zoom);
		viewport.setPan(transform.panX, transform.panY);
	}, []);
	const layersPanelShortcutLabel = actionShortcutLabel(
		"view.toggle-layers-panel",
	);
	const inspectorPanelShortcutLabel = actionShortcutLabel(
		"view.toggle-inspector-panel",
	);
	const sidePanelsShortcutLabel = actionShortcutLabel("view.toggle-panels");
	const timelineShortcutLabel = actionShortcutLabel("view.toggle-timeline");
	const commandPaletteShortcutTitle = actionShortcutTitle(
		"view.command-palette",
	);
	useEffect(() => {
		scheduleWorkspaceFit("current");
		return cancelScheduledFit;
	}, [cancelScheduledFit, scheduleWorkspaceFit]);
	// Commit panel widths + bottom-dock heights to the CSS vars on
	// document.documentElement — the SAME element the resize handles write
	// imperatively mid-drag, so there is no :root-vs-descendant override flicker at
	// the drag->commit handoff. Pre-paint (useLayoutEffect) so the synchronously-
	// hydrated values are right on frame one (no default->persisted flash).
	// Timeline geometry is deliberately NOT a workspaceFitTrigger. Showing,
	// hiding, expanding, or resizing the timeline must not issue a camera command
	// or disturb the user's visual focus; the next explicit fit action reads the
	// live rects and accounts for the current side panels and bottom docks.
	useLayoutEffect(() => {
		const root = document.documentElement.style;
		root.setProperty("--editor-left-panel-width", `${leftPanelWidth}px`);
		root.setProperty("--editor-right-panel-width", `${rightPanelWidth}px`);
		root.setProperty(
			"--editor-timeline-expanded-height",
			`${timelineHeight}px`,
		);
		root.setProperty(
			"--editor-look-workspace-height",
			`${lookWorkspaceHeight}px`,
		);
		root.setProperty(
			"--editor-motion-copilot-width",
			`${motionCopilotWidth}px`,
		);
		// Inspector's internal motion-pane split height. NOT a workspaceFitTrigger
		// input: the split is inside the Inspector's fixed outer bounds, so it never
		// moves the canvas inset (unlike the docked timeline height, which does).
		root.setProperty(
			"--editor-inspector-motion-height",
			`${inspectorMotionHeight}px`,
		);
	}, [
		leftPanelWidth,
		rightPanelWidth,
		timelineHeight,
		lookWorkspaceHeight,
		inspectorMotionHeight,
		motionCopilotWidth,
	]);
	const workspaceFitTrigger = [
		artboardFitSignature,
		activeTool,
		lookWorkspaceOpen,
		lookWorkspaceHeight,
		motionCopilotOpen,
		motionCopilotWidth,
		iPadAuthoringSurface.visible,
	].join(":");
	useEffect(() => {
		void workspaceFitTrigger;
		scheduleWorkspaceFit(lastFitScopeRef.current);
	}, [scheduleWorkspaceFit, workspaceFitTrigger]);
	useEffect(() => {
		const container = globalThis.document.querySelector(".editor-grid");
		if (!(container instanceof HTMLElement)) return;
		const resizeObserver = new ResizeObserver(() => {
			scheduleWorkspaceFit(lastFitScopeRef.current);
		});
		resizeObserver.observe(container);
		return () => resizeObserver.disconnect();
	}, [scheduleWorkspaceFit]);
	const panels: readonly PanelDescriptor[] = [
		{
			id: "layers",
			visible: layersOpen,
			Component: LayersPanel,
			fallbackClassName: "layers-panel",
		},
		{
			id: "inspector",
			visible: inspectorOpen,
			Component: InspectorPanel,
			fallbackClassName: "inspector-panel",
		},
		{
			id: "timeline",
			visible: timelineOpen,
			Component: TimelinePanel,
			fallbackClassName: "timeline-panel",
		},
	];
	const desktopChromeVisible = !iPadAuthoringSurface.visible;
	// Stable element handed to the popup's own React root, so DetachedWindow
	// renders it once and the detached subtree self-updates via store subscriptions
	// rather than re-rendering on every EditorPage commit.
	const detachedLookWorkspace = useMemo(
		() => (
			<Suspense fallback={<DetachedLookWorkspaceFallback />}>
				<LookWorkspacePanel detached />
			</Suspense>
		),
		[],
	);

	return (
		<main
			className={cn(
				"editor-grid",
				timelineOpen && "timeline-open",
				timelineOpen && timelineExpanded && "timeline-mode",
				// Detached frees the docked footprint, so the canvas reclaims the strip.
				lookWorkspaceOpen && !lookWorkspaceDetached && "look-workspace-mode",
				// Motion Copilot dock (right); `inspector-open` lets it dodge the inspector.
				desktopChromeVisible && motionCopilotOpen && "motion-copilot-open",
				inspectorOpen && "inspector-open",
				parameterCaptureOpen && "parameter-capture-mode",
				iPadAuthoringSurface.visible && "ipad-authoring-mode",
			)}
		>
			{desktopChromeVisible ? (
				<TopBar
					onFitArtboard={fitArtboardToWorkspace}
					layersPanelShortcutLabel={layersPanelShortcutLabel}
					inspectorPanelShortcutLabel={inspectorPanelShortcutLabel}
					sidePanelsShortcutLabel={sidePanelsShortcutLabel}
					timelineShortcutLabel={timelineShortcutLabel}
					commandPaletteShortcutTitle={commandPaletteShortcutTitle}
				/>
			) : null}
			<ActionSurface
				onFitArtboard={fitArtboardToWorkspace}
				onFitSelection={fitSelectionToWorkspace}
				onSave={onSave}
				saveAvailable={saveAvailable}
			/>
			{desktopChromeVisible ? (
				<>
					<ToolRail />
					<ToolOptions />
				</>
			) : null}
			<CanvasShell
				onFitArtboard={fitArtboardToWorkspace}
				onFitSelection={fitSelectionToWorkspace}
			/>
			{iPadAuthoringSurface.visible && activeTool === "pencil" ? (
				<IpadPencilBar />
			) : null}
			{desktopChromeVisible ? (
				<Suspense fallback={null}>
					<ParameterCaptureStage />
				</Suspense>
			) : null}
			{desktopChromeVisible
				? panels.map(({ id, visible, Component, fallbackClassName }) =>
						visible ? (
							<Suspense
								key={id}
								fallback={<PanelChunkFallback className={fallbackClassName} />}
							>
								<Component />
							</Suspense>
						) : null,
					)
				: null}
			{desktopChromeVisible && lookWorkspaceOpen && !lookWorkspaceDetached ? (
				<Suspense
					fallback={<PanelChunkFallback className="look-workspace-panel" />}
				>
					<LookWorkspacePanel />
				</Suspense>
			) : null}
			{desktopChromeVisible && lookWorkspaceOpen && lookWorkspaceDetached ? (
				<DetachedWindow title="Look Graph" onClose={dockLookWorkspace}>
					{detachedLookWorkspace}
				</DetachedWindow>
			) : null}
			{desktopChromeVisible &&
			platformCapabilities.copilotServerPlanner &&
			motionCopilotOpen ? (
				<Suspense
					fallback={<PanelChunkFallback className="motion-copilot-panel" />}
				>
					<MotionCopilotPanel />
				</Suspense>
			) : null}
			{desktopChromeVisible && visualReviewOpen ? (
				<Suspense fallback={null}>
					<EditorVisualReviewWorkspace
						onClose={() => setVisualReviewOpen(false)}
					/>
				</Suspense>
			) : null}
			{referenceTutorialSlug ? (
				<TutorialGuide slug={referenceTutorialSlug} />
			) : null}
			{gravityReviewSlug ? (
				<GravityReviewGuide slug={gravityReviewSlug} />
			) : null}
			{desktopChromeVisible ? (
				<Suspense fallback={null}>
					<FloatingInspector />
				</Suspense>
			) : null}
		</main>
	);
}
