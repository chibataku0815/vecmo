import {
	CaretDown,
	CaretUp,
	DotsSixVertical,
	FilmStrip,
	SlidersHorizontal,
	Swatches,
	TextT,
} from "@phosphor-icons/react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	selectAllArtboards,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Bounds } from "@/entities/scene/model/types";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { useSelectionStore } from "@/features/selection/model/store";
import { type Camera, worldToScreen } from "@/features/viewport/model/camera";
import { useViewportStore } from "@/features/viewport/model/store";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import { selectedNodePasteboardBounds } from "@/widgets/canvas-shell/model/context-actions";
import { inspectorAuthoringReadState } from "../model/authoring-controller";
import {
	primaryNodeForInspector,
	selectedNodesForInspector,
	textEditingStateForSelection,
} from "../model/editing";
import {
	MultiSelectionPanel,
	SingleNodeAppearanceSection,
	SingleNodeTextSection,
	SingleNodeTransformSection,
} from "./InspectorPanel";
import { MotionTechniqueSection } from "./MotionTechniqueSection";

/**
 * The FloatingInspector is the docked Inspector rail's compact, modeless twin: a
 * draggable HUD that surfaces ONE property section at a time for the current
 * single selection, right over the canvas where the eye already is.
 *
 * It is intentionally an alternative *presentation* of the same inspector, not a
 * second source of state — it renders the exact `SingleNode*Section` components
 * the rail renders, so editing authors through the identical command path. To
 * avoid showing two inspectors at once it appears only while the docked rail is
 * hidden (`!inspectorOpen`); collapsing the dense rail is what reveals the HUD.
 */

/** Approximate float chrome geometry, used only to keep the card on-screen. */
const FLOAT_WIDTH_PX = 288;
const FLOAT_MIN_VISIBLE_HEIGHT_PX = 160;
const FLOAT_TOP_SAFE_PX = 72;
const FLOAT_EDGE_MARGIN_PX = 8;
const FLOAT_GAP_PX = 12;

type FloatPosition = { readonly x: number; readonly y: number };

type FloatSection = "transform" | "text" | "appearance" | "motion";

type SectionTab = {
	readonly id: FloatSection;
	readonly label: string;
	readonly Icon: typeof SlidersHorizontal;
};

/**
 * Every section the float can surface, in rail order. `Text` is included only
 * when the selection is an editable text node — the float mirrors the rail's
 * conditional Text panel. Splitting the dense rail scroll into one-tab-at-a-time
 * is the findability half of the fix: each section is a labelled click, never
 * buried in a tall scroll.
 */
const ALL_SECTION_TABS: readonly SectionTab[] = [
	{ id: "transform", label: "Transform", Icon: SlidersHorizontal },
	{ id: "text", label: "Text", Icon: TextT },
	{ id: "appearance", label: "Appearance", Icon: Swatches },
	{ id: "motion", label: "Motion", Icon: FilmStrip },
];

const clampRange = (value: number, min: number, max: number): number =>
	max < min ? min : Math.min(Math.max(value, min), max);

/**
 * Anchors the HUD next to the selection's top-right corner (flipping to the left
 * side when the right edge would clip it), then clamps both axes so a selection
 * near a viewport edge — or off-screen at deep zoom — still pins the card fully
 * visible. Mirrors the canvas quick-action bar's anchoring intent for a larger
 * card. `worldToScreen` yields canvas-viewport-relative pixels, and the card is
 * absolutely positioned inside the same full-bleed `.editor-grid`, so the screen
 * pixels map straight onto `left`/`top`.
 */
export function defaultFloatPosition(
	bounds: Bounds | null,
	camera: Camera,
	viewport: { readonly width: number; readonly height: number },
): FloatPosition {
	const maxX = Math.max(
		FLOAT_EDGE_MARGIN_PX,
		viewport.width - FLOAT_WIDTH_PX - FLOAT_EDGE_MARGIN_PX,
	);
	const maxY = Math.max(
		FLOAT_TOP_SAFE_PX,
		viewport.height - FLOAT_MIN_VISIBLE_HEIGHT_PX,
	);
	if (!bounds) {
		return { x: maxX, y: FLOAT_TOP_SAFE_PX };
	}
	const topRight = worldToScreen(camera, {
		x: bounds.x + bounds.width,
		y: bounds.y,
	});
	let x = topRight.x + FLOAT_GAP_PX;
	if (x > maxX) {
		const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
		x = topLeft.x - FLOAT_GAP_PX - FLOAT_WIDTH_PX;
	}
	return {
		x: clampRange(x, FLOAT_EDGE_MARGIN_PX, maxX),
		y: clampRange(topRight.y, FLOAT_TOP_SAFE_PX, maxY),
	};
}

const viewportSize = (): {
	readonly width: number;
	readonly height: number;
} => ({
	width: globalThis.innerWidth,
	height: globalThis.innerHeight,
});

/**
 * The draggable, collapsible float chrome. Body differs by selection count
 * (single = tabbed focus view, multi = the rail's whole `MultiSelectionPanel`),
 * so the shell is shared to keep the drag/collapse behaviour identical.
 */
function FloatShell({
	title,
	position,
	collapsed,
	onToggleCollapse,
	onGripPointerDown,
	onGripPointerMove,
	onGripPointerUp,
	children,
}: {
	readonly title: string;
	readonly position: FloatPosition;
	readonly collapsed: boolean;
	readonly onToggleCollapse: () => void;
	readonly onGripPointerDown: (
		event: ReactPointerEvent<HTMLButtonElement>,
	) => void;
	readonly onGripPointerMove: (
		event: ReactPointerEvent<HTMLButtonElement>,
	) => void;
	readonly onGripPointerUp: (
		event: ReactPointerEvent<HTMLButtonElement>,
	) => void;
	readonly children: ReactNode;
}) {
	return (
		<div
			className="floating-inspector pointer-events-auto absolute z-[36] flex w-72 flex-col overflow-hidden rounded-md border border-white/10 bg-surface-raised/92 text-fg shadow-2xl shadow-black/40 backdrop-blur-xl"
			style={{ left: position.x, top: position.y }}
		>
			<div className="flex h-8 shrink-0 items-center gap-1 border-white/10 border-b pr-1 pl-0.5">
				<button
					type="button"
					aria-label="Move properties HUD"
					title="Drag to move"
					onPointerDown={onGripPointerDown}
					onPointerMove={onGripPointerMove}
					onPointerUp={onGripPointerUp}
					className="flex h-7 cursor-grab touch-none items-center gap-1 rounded px-1 text-fg-muted hover:text-fg active:cursor-grabbing"
				>
					<DotsSixVertical aria-hidden="true" size={12} />
				</button>
				<span className="min-w-0 flex-1 truncate font-medium text-ui">
					{title}
				</span>
				<button
					type="button"
					aria-label={collapsed ? "Expand properties" : "Collapse properties"}
					title={collapsed ? "Expand" : "Collapse"}
					aria-expanded={!collapsed}
					onClick={onToggleCollapse}
					className="grid size-6 place-items-center rounded text-fg-muted transition hover:bg-white/[0.08] hover:text-fg"
				>
					{collapsed ? (
						<CaretDown aria-hidden="true" size={12} />
					) : (
						<CaretUp aria-hidden="true" size={12} />
					)}
				</button>
			</div>
			{collapsed ? null : children}
		</div>
	);
}

export function FloatingInspector() {
	const inspectorOpen = useEditorChromeStore((state) => state.inspectorOpen);
	const parameterCaptureOpen = useEditorChromeStore(
		(state) => state.parameterCaptureOpen,
	);
	const document = useSceneStore((state) => state.document);
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const recording = useTransportStore((state) => state.recording);
	const toggleRecording = useTransportStore((state) => state.toggleRecording);
	const nodeIds = useSelectionStore((state) => state.nodeIds);
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const zoom = useViewportStore((state) => state.zoom);
	const panX = useViewportStore((state) => state.panX);
	const panY = useViewportStore((state) => state.panY);

	const [activeSection, setActiveSection] = useState<FloatSection>("transform");
	const [collapsed, setCollapsed] = useState(false);
	// `null` = follow the selection (re-anchor on each new selection); a value =
	// the user has dragged it and pinned it there.
	const [userPosition, setUserPosition] = useState<FloatPosition | null>(null);
	const dragRef = useRef<{
		readonly startX: number;
		readonly startY: number;
		readonly baseX: number;
		readonly baseY: number;
	} | null>(null);

	const selectedBaseNodes = selectedNodesForInspector(document, nodeIds);
	const primaryBaseNode = primaryNodeForInspector(
		selectedBaseNodes,
		primaryNodeId,
	);
	const authoringState = useMemo(
		() =>
			inspectorAuthoringReadState({
				document,
				motion,
				selectedNodeIds: nodeIds,
				primaryNodeId,
				currentFrame,
				recording,
			}),
		[document, motion, nodeIds, primaryNodeId, currentFrame, recording],
	);
	const frame = authoringState.frame;
	const keyframeState = authoringState.keyframeState;

	// Anchor on the UNION of the selection so the float rides the whole selection,
	// not just the primary node — correct for both single (one node) and multi.
	const selectionBounds = useMemo((): Bounds | null => {
		const nodes = selectedNodesForInspector(document, nodeIds);
		if (nodes.length === 0) return null;
		return selectedNodePasteboardBounds(
			nodes,
			selectAllArtboards(document),
			selectNodeArtboardMapping(document).byNodeId,
		);
	}, [document, nodeIds]);

	const camera = useMemo<Camera>(
		() => ({ zoom, panX, panY }),
		[zoom, panX, panY],
	);
	const defaultPosition = useMemo(
		() => defaultFloatPosition(selectionBounds, camera, viewportSize()),
		[selectionBounds, camera],
	);
	const position = userPosition ?? defaultPosition;

	const onGripPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>): void => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				baseX: position.x,
				baseY: position.y,
			};
		},
		[position.x, position.y],
	);
	const onGripPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>): void => {
			const drag = dragRef.current;
			if (!drag) return;
			const view = viewportSize();
			setUserPosition({
				x: clampRange(
					drag.baseX + (event.clientX - drag.startX),
					FLOAT_EDGE_MARGIN_PX - FLOAT_WIDTH_PX + 48,
					view.width - 48,
				),
				y: clampRange(
					drag.baseY + (event.clientY - drag.startY),
					FLOAT_TOP_SAFE_PX,
					view.height - 48,
				),
			});
		},
		[],
	);
	const onGripPointerUp = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>): void => {
			if (!dragRef.current) return;
			dragRef.current = null;
			event.currentTarget.releasePointerCapture?.(event.pointerId);
		},
		[],
	);

	// The HUD is the rail's stand-in: only one inspector shows at a time. Capture
	// Mode also owns the near-selection slot, so the editing HUD steps aside while
	// the filmed parameter card is visible.
	if (inspectorOpen || parameterCaptureOpen) return null;
	const count = selectedBaseNodes.length;
	if (count === 0) return null;

	const onToggleCollapse = () => setCollapsed((value) => !value);
	const shellProps = {
		position,
		collapsed,
		onToggleCollapse,
		onGripPointerDown,
		onGripPointerMove,
		onGripPointerUp,
	};

	// 2+ selection: reuse the rail's MultiSelectionPanel WHOLE (un-tabbed). Multi
	// has few sections, so stacking the same component keeps the float a complete
	// editing surface across selection states with zero section extraction/drift.
	if (count >= 2) {
		return (
			<FloatShell title={`${count} selected`} {...shellProps}>
				<div className="chrome-scrollbar-thin min-h-0 max-h-[min(60svh,480px)] flex-1 overflow-y-auto overflow-x-hidden">
					<MultiSelectionPanel
						document={document}
						baseNodes={selectedBaseNodes}
						primaryNodeId={primaryNodeId}
						resetKey={`${document.id}:${nodeIds.join("|")}:${frame}:float`}
					/>
				</div>
			</FloatShell>
		);
	}

	// Single selection: tabbed focus view. Text is selection-conditional; the rest
	// are always offered. If the active tab is no longer available (e.g. switched
	// off a text node while Text was open), fall back to Transform — no effect.
	if (!primaryBaseNode || keyframeState.status !== "ready") return null;
	const isTextNode = textEditingStateForSelection([primaryBaseNode]).canEdit;
	const availableTabs = ALL_SECTION_TABS.filter(
		(tab) => tab.id !== "text" || isTextNode,
	);
	const effectiveSection: FloatSection = availableTabs.some(
		(tab) => tab.id === activeSection,
	)
		? activeSection
		: "transform";

	return (
		<FloatShell title={primaryBaseNode.name} {...shellProps}>
			<div
				role="tablist"
				aria-label="Property sections"
				className="chrome-scrollbar-thin flex shrink-0 items-center gap-0.5 overflow-x-auto border-white/10 border-b px-1 py-1"
			>
				{availableTabs.map(({ id, label, Icon }) => {
					const selected = id === effectiveSection;
					return (
						<button
							key={id}
							type="button"
							role="tab"
							aria-selected={selected}
							onClick={() => setActiveSection(id)}
							className={cn(
								"flex h-6 flex-1 shrink-0 items-center justify-center gap-1 rounded px-1.5 font-medium text-ui transition",
								selected
									? "bg-accent-surface text-accent-fg"
									: "text-fg-secondary hover:bg-white/[0.06] hover:text-fg",
							)}
						>
							<Icon aria-hidden="true" size={11} />
							<span className="truncate">{label}</span>
						</button>
					);
				})}
			</div>

			<div className="chrome-scrollbar-thin min-h-0 max-h-[min(60svh,480px)] flex-1 overflow-y-auto overflow-x-hidden py-1.5">
				{effectiveSection === "transform" ? (
					<SingleNodeTransformSection
						document={document}
						baseNode={primaryBaseNode}
						keyframeState={keyframeState}
						recording={recording}
						onToggleRecording={toggleRecording}
					/>
				) : effectiveSection === "text" ? (
					<SingleNodeTextSection
						document={document}
						baseNode={primaryBaseNode}
						resetKey={`${document.id}:${primaryBaseNode.id}:${frame}:float`}
						recording={recording}
						keyframeState={keyframeState}
					/>
				) : effectiveSection === "motion" ? (
					<MotionTechniqueSection nodeIds={[primaryBaseNode.id]} />
				) : (
					<SingleNodeAppearanceSection
						document={document}
						baseNode={primaryBaseNode}
						motion={motion}
						resetKey={`${document.id}:${primaryBaseNode.id}:${frame}:float`}
					/>
				)}
			</div>
		</FloatShell>
	);
}
