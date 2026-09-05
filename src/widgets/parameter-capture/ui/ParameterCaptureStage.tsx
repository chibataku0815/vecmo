import { Diamond, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useMemo } from "react";
import { effectiveTransform } from "@/entities/motion/model/sampler";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import {
	findArtboardById,
	findNode,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { sceneNodeVisualAabb } from "@/entities/scene/model/spatial";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	bareLookNodeParamKey,
	FRAME_LOOK_GRAPH_NODE_KIND_LABELS,
	type FrameLookGraphEditingNode,
	type FrameLookGraphNodeSliderSpec,
	type FrameLookGraphScope,
	frameLookGraphEditingState,
	lookGraphOwnerForScope,
	lookNodeParamDisplayValue,
	lookNodeParamKeyframeState,
} from "@/features/look-authoring/model";
import { useMotionClipSelectionStore } from "@/features/motion/model/clip-selection-store";
import { useTransportStore } from "@/features/motion/model/transport-store";
import {
	buildMotionSystemCaptureTarget,
	type MotionSystemCaptureTarget,
} from "@/features/parameter-capture/model/capture-motion-system-read-model";
import {
	buildParameterCaptureTarget,
	type ParameterCaptureTarget,
} from "@/features/parameter-capture/model/capture-read-model";
import {
	buildDuplicateGeneratorCaptureTarget,
	buildEffectStackCaptureTarget,
	type SceneSidecarCaptureRow,
} from "@/features/parameter-capture/model/capture-scene-sidecars-read-model";
import { useSelectionStore } from "@/features/selection/model/store";
import { type Camera, worldToScreen } from "@/features/viewport/model/camera";
import { useViewportStore } from "@/features/viewport/model/store";
import { useLookGraphSelectionStore } from "@/shared/editor-chrome/model/look-graph-selection";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import { IconButton } from "@/shared/ui/IconButton";
import { TooltipProvider } from "@/shared/ui/Tooltip";

const STAGE_MIN_WIDTH_PX = 276;
const STAGE_MAX_WIDTH_PX = 340;
const STAGE_TOP_PX = 68;
const STAGE_BOTTOM_GAP_PX = 58;
const STAGE_EDGE_GAP_PX = 8;
const STAGE_SELECTION_GAP_PX = 14;
const STAGE_INSPECTOR_GAP_PX = 12;
const STAGE_MIN_VISIBLE_HEIGHT_PX = 180;
const ACTIVE_ROW_LIMIT = 6;

type ScreenBounds = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

type CaptureRowEmphasis = "keyed" | "animated" | "changed" | "rest";

type LookParameterCaptureRow = {
	readonly id: string;
	readonly label: string;
	readonly displayValue: string;
	readonly deltaDisplay: string | null;
	readonly animated: boolean;
	readonly keyedAtFrame: boolean;
	readonly emphasis: CaptureRowEmphasis;
};

type LookParameterCaptureTarget = {
	readonly id: string;
	readonly label: string;
	readonly kindLabel: string;
	readonly scopeLabel: string;
	readonly frame: number;
	readonly rows: readonly LookParameterCaptureRow[];
	readonly activeRowCount: number;
};

type StagePlacement = {
	readonly top: number;
	readonly right: number;
	readonly width: number;
	readonly maxHeight: number;
	readonly anchorX: number;
	readonly anchorY: number;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const emphasisRank = (emphasis: CaptureRowEmphasis): number => {
	if (emphasis === "keyed") return 0;
	if (emphasis === "animated") return 1;
	if (emphasis === "changed") return 2;
	return 3;
};

const readableRowLabel = (keyedAtFrame: boolean, animated: boolean): string => {
	if (keyedAtFrame) return "KEY";
	if (animated) return "ANIM";
	return "LIVE";
};

const formatLookNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	if (Number.isInteger(value)) return String(value);
	return String(Number(value.toFixed(2)));
};

const formatLookValue = (value: number, unit: string | undefined): string =>
	`${formatLookNumber(value)}${unit ?? ""}`;

const lookDeltaDisplay = (
	value: number,
	base: number,
	unit: string | undefined,
): string | null => {
	const delta = value - base;
	if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return null;
	const prefix = delta > 0 ? "+" : "";
	return `${prefix}${formatLookNumber(delta)}${unit ?? ""}`;
};

const lookEmphasis = ({
	animated,
	keyedAtFrame,
	deltaDisplay,
}: Pick<
	LookParameterCaptureRow,
	"animated" | "keyedAtFrame" | "deltaDisplay"
>): LookParameterCaptureRow["emphasis"] => {
	if (keyedAtFrame) return "keyed";
	if (animated) return "animated";
	if (deltaDisplay) return "changed";
	return "rest";
};

function useStagePlacement(bounds: ScreenBounds | null): StagePlacement {
	const viewportWidth = useViewportStore((state) => state.viewportWidth);
	const viewportHeight = useViewportStore((state) => state.viewportHeight);
	const inspectorOpen = useEditorChromeStore((state) => state.inspectorOpen);
	const rightPanelWidth = useEditorChromeStore(
		(state) => state.rightPanelWidth,
	);
	const width = clamp(
		Math.min(
			Math.max(rightPanelWidth, STAGE_MIN_WIDTH_PX),
			viewportWidth - STAGE_EDGE_GAP_PX * 2,
		),
		220,
		STAGE_MAX_WIDTH_PX,
	);
	const rightBoundary = inspectorOpen
		? viewportWidth - rightPanelWidth - STAGE_INSPECTOR_GAP_PX
		: viewportWidth - STAGE_EDGE_GAP_PX;
	const fallbackLeft = Math.max(STAGE_EDGE_GAP_PX, rightBoundary - width);
	const selectedRightLeft = bounds
		? bounds.x + bounds.width + STAGE_SELECTION_GAP_PX
		: Number.POSITIVE_INFINITY;
	const selectedLeftLeft = bounds
		? bounds.x - width - STAGE_SELECTION_GAP_PX
		: Number.NEGATIVE_INFINITY;
	const left =
		bounds && selectedRightLeft + width <= rightBoundary
			? selectedRightLeft
			: bounds && selectedLeftLeft >= STAGE_EDGE_GAP_PX
				? selectedLeftLeft
				: fallbackLeft;
	const right = Math.max(STAGE_EDGE_GAP_PX, viewportWidth - left - width);
	const resolvedLeft = viewportWidth - right - width;
	const maxTop = Math.max(
		STAGE_TOP_PX,
		viewportHeight - STAGE_BOTTOM_GAP_PX - STAGE_MIN_VISIBLE_HEIGHT_PX,
	);
	const top = bounds ? clamp(bounds.y, STAGE_TOP_PX, maxTop) : STAGE_TOP_PX;
	const maxHeight = Math.max(
		STAGE_MIN_VISIBLE_HEIGHT_PX,
		viewportHeight - top - STAGE_BOTTOM_GAP_PX,
	);
	const targetCenterX = bounds ? bounds.x + bounds.width / 2 : 0;
	const anchorX =
		bounds && resolvedLeft < targetCenterX
			? resolvedLeft + width
			: resolvedLeft;
	return {
		top,
		right,
		width,
		maxHeight,
		anchorX,
		anchorY: top + 30,
	};
}

function selectedNodeScreenBounds(
	document: SceneDocument,
	motion: MotionDocument,
	primaryNodeId: string | null,
	currentFrame: number,
	viewport: Camera,
): ScreenBounds | null {
	const node = findNode(document, primaryNodeId);
	if (!node) return null;
	const artboardId = selectArtboardIdForNode(document, node.id);
	const artboard =
		findArtboardById(document, artboardId) ?? selectCurrentArtboard(document);
	const bounds = sceneNodeVisualAabb({
		...node,
		transform: effectiveTransform(node, motion, currentFrame),
	});
	const topLeft = worldToScreen(viewport, {
		x: artboard.position.x + bounds.minX,
		y: artboard.position.y + bounds.minY,
	});
	const bottomRight = worldToScreen(viewport, {
		x: artboard.position.x + bounds.maxX,
		y: artboard.position.y + bounds.maxY,
	});
	const x = Math.min(topLeft.x, bottomRight.x);
	const y = Math.min(topLeft.y, bottomRight.y);
	return {
		x,
		y,
		width: Math.abs(bottomRight.x - topLeft.x),
		height: Math.abs(bottomRight.y - topLeft.y),
	};
}

const lookGraphScopesForCapture = [
	"current-artboard",
	"scene",
] as const satisfies readonly FrameLookGraphScope[];

const lookGraphScopeLabel = (scope: FrameLookGraphScope): string =>
	scope === "scene" ? "Scene Look" : "Frame Look";

const lookParameterRow = ({
	motion,
	scope,
	artboardId,
	node,
	control,
	frame,
}: {
	readonly motion: MotionDocument;
	readonly scope: FrameLookGraphScope;
	readonly artboardId: string;
	readonly node: FrameLookGraphEditingNode;
	readonly control: FrameLookGraphNodeSliderSpec;
	readonly frame: number;
}): LookParameterCaptureRow => {
	const owner = lookGraphOwnerForScope(scope, artboardId);
	const paramKey = bareLookNodeParamKey(control.path);
	const value = lookNodeParamDisplayValue(
		motion,
		owner,
		node.id,
		paramKey,
		control.value,
		frame,
	);
	const keyframeState = lookNodeParamKeyframeState(
		motion,
		owner,
		node.id,
		control.path,
		frame,
	);
	const deltaDisplay = lookDeltaDisplay(value, control.value, control.unit);
	const animated = keyframeState.animatable ? keyframeState.animated : false;
	const keyedAtFrame = keyframeState.animatable
		? keyframeState.hasKeyAtFrame
		: false;
	return {
		id: `${node.id}:${control.path}`,
		label: control.label,
		displayValue: formatLookValue(value, control.unit),
		deltaDisplay,
		animated,
		keyedAtFrame,
		emphasis: lookEmphasis({ animated, keyedAtFrame, deltaDisplay }),
	};
};

function lookParameterCaptureTarget({
	document,
	motion,
	selectedLookNodeId,
	artboardId,
	currentFrame,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly selectedLookNodeId: string | null;
	readonly artboardId: string;
	readonly currentFrame: number;
}): LookParameterCaptureTarget | null {
	if (!selectedLookNodeId) return null;
	const frame = Number.isFinite(currentFrame)
		? Math.max(0, Math.round(currentFrame))
		: 0;
	for (const scope of lookGraphScopesForCapture) {
		const state = frameLookGraphEditingState(document, scope, artboardId);
		const node =
			state.nodes.find((candidate) => candidate.id === selectedLookNodeId) ??
			null;
		if (!node || node.sliders.length === 0) continue;
		const rows = node.sliders.map((control) =>
			lookParameterRow({ motion, scope, artboardId, node, control, frame }),
		);
		return {
			id: node.id,
			label: node.label,
			kindLabel: FRAME_LOOK_GRAPH_NODE_KIND_LABELS[node.kind],
			scopeLabel: lookGraphScopeLabel(scope),
			frame,
			rows,
			activeRowCount: rows.filter((row) => row.emphasis !== "rest").length,
		};
	}
	return null;
}

function ParameterCaptureToggle() {
	const open = useEditorChromeStore((state) => state.parameterCaptureOpen);
	const toggle = useEditorChromeStore((state) => state.toggleParameterCapture);
	return (
		<div className="parameter-capture-toggle pointer-events-auto">
			<TooltipProvider>
				<IconButton
					icon={SlidersHorizontal}
					label="Parameter capture"
					active={open}
					tooltipSide="left"
					onClick={toggle}
				/>
			</TooltipProvider>
		</div>
	);
}

function CaptureCallout({
	bounds,
	placement,
}: {
	readonly bounds: ScreenBounds | null;
	readonly placement: StagePlacement;
}) {
	const viewportWidth = useViewportStore((state) => state.viewportWidth);
	const viewportHeight = useViewportStore((state) => state.viewportHeight);
	if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) return null;

	const targetX = clamp(bounds.x + bounds.width / 2, 0, viewportWidth);
	const targetY = clamp(bounds.y + bounds.height / 2, 0, viewportHeight);
	const anchorX = clamp(placement.anchorX, 0, viewportWidth);
	const anchorY = clamp(placement.anchorY, 0, viewportHeight);
	const controlX = targetX + (anchorX - targetX) * 0.54;
	const path = `M ${targetX} ${targetY} C ${controlX} ${targetY}, ${controlX} ${anchorY}, ${anchorX} ${anchorY}`;
	const boxX = clamp(bounds.x, 0, viewportWidth);
	const boxY = clamp(bounds.y, 0, viewportHeight);
	const boxWidth = clamp(bounds.width, 0, viewportWidth - boxX);
	const boxHeight = clamp(bounds.height, 0, viewportHeight - boxY);

	return (
		<svg
			aria-hidden="true"
			className="parameter-capture-callouts pointer-events-none absolute inset-0"
			viewBox={`0 0 ${Math.max(1, viewportWidth)} ${Math.max(1, viewportHeight)}`}
		>
			<path
				d={path}
				className="fill-none stroke-accent"
				strokeOpacity={0.7}
				strokeWidth={1.5}
			/>
			<rect
				x={boxX}
				y={boxY}
				width={boxWidth}
				height={boxHeight}
				rx={6}
				className="fill-none stroke-accent"
				strokeOpacity={0.58}
				strokeWidth={1}
			/>
			<circle
				cx={targetX}
				cy={targetY}
				r={4}
				className="fill-accent stroke-surface"
				strokeWidth={2}
			/>
			<circle cx={anchorX} cy={anchorY} r={3} className="fill-accent" />
		</svg>
	);
}

function CaptureRows({
	rows,
}: {
	readonly rows: ParameterCaptureTarget["rows"];
}) {
	const visibleRows = [...rows]
		.sort((a, b) => emphasisRank(a.emphasis) - emphasisRank(b.emphasis))
		.slice(0, ACTIVE_ROW_LIMIT);
	return (
		<div className="grid gap-1.5">
			{visibleRows.map((row) => (
				<div
					key={row.id}
					className={cn(
						"grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5",
						row.emphasis === "keyed"
							? "border-accent/70 bg-accent-surface text-accent-fg"
							: row.emphasis === "animated"
								? "border-warn/45 bg-warn-surface text-warn-fg"
								: row.emphasis === "changed"
									? "border-white/14 bg-white/[0.07] text-fg"
									: "border-white/8 bg-black/20 text-fg-secondary",
					)}
				>
					<div className="min-w-0">
						<div className="truncate font-medium text-ui leading-3">
							{row.label}
						</div>
						<div className="truncate text-fg-muted text-ui leading-3">
							{row.deltaDisplay ?? "rest pose"}
						</div>
					</div>
					<div className="capture-value tabular-nums">{row.displayValue}</div>
					<div
						className={cn(
							"grid h-5 min-w-9 grid-cols-[auto_1fr] items-center gap-1 rounded border px-1 text-center text-ui",
							row.keyedAtFrame
								? "border-accent/60 bg-accent/10 text-accent-fg"
								: row.animated
									? "border-warn/40 bg-warn/10 text-warn-fg"
									: "border-white/10 bg-black/20 text-fg-muted",
						)}
					>
						<Diamond
							aria-hidden="true"
							size={8}
							weight={row.keyedAtFrame ? "fill" : "regular"}
						/>
						<span>{readableRowLabel(row.keyedAtFrame, row.animated)}</span>
					</div>
				</div>
			))}
		</div>
	);
}

function LookCaptureRows({
	target,
}: {
	readonly target: LookParameterCaptureTarget;
}) {
	const visibleRows = [...target.rows]
		.sort((a, b) => emphasisRank(a.emphasis) - emphasisRank(b.emphasis))
		.slice(0, ACTIVE_ROW_LIMIT);
	return (
		<div className="grid gap-1.5 border-white/10 border-t pt-2">
			<div className="flex items-center justify-between gap-2 text-ui">
				<div className="min-w-0">
					<div className="truncate font-medium text-fg">Look parameters</div>
					<div className="truncate text-fg-muted">
						{target.scopeLabel} / {target.kindLabel}
					</div>
				</div>
				<div className="shrink-0 text-fg-muted">
					{target.activeRowCount} active
				</div>
			</div>
			{visibleRows.map((row) => (
				<div
					key={row.id}
					className={cn(
						"grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5",
						row.emphasis === "keyed"
							? "border-accent/70 bg-accent-surface text-accent-fg"
							: row.emphasis === "animated"
								? "border-warn/45 bg-warn-surface text-warn-fg"
								: row.emphasis === "changed"
									? "border-white/14 bg-white/[0.07] text-fg"
									: "border-white/8 bg-black/20 text-fg-secondary",
					)}
				>
					<div className="min-w-0">
						<div className="truncate font-medium text-ui leading-3">
							{row.label}
						</div>
						<div className="truncate text-fg-muted text-ui leading-3">
							{row.deltaDisplay ?? "base value"}
						</div>
					</div>
					<div className="capture-value tabular-nums">{row.displayValue}</div>
					<div
						className={cn(
							"grid h-5 min-w-9 grid-cols-[auto_1fr] items-center gap-1 rounded border px-1 text-center text-ui",
							row.keyedAtFrame
								? "border-accent/60 bg-accent/10 text-accent-fg"
								: row.animated
									? "border-warn/40 bg-warn/10 text-warn-fg"
									: "border-white/10 bg-black/20 text-fg-muted",
						)}
					>
						<Diamond
							aria-hidden="true"
							size={8}
							weight={row.keyedAtFrame ? "fill" : "regular"}
						/>
						<span>{readableRowLabel(row.keyedAtFrame, row.animated)}</span>
					</div>
				</div>
			))}
		</div>
	);
}

function MotionSystemCaptureRows({
	target,
}: {
	readonly target: MotionSystemCaptureTarget;
}) {
	const visibleRows = target.rows.slice(0, ACTIVE_ROW_LIMIT);
	const hiddenCount = Math.max(0, target.rows.length - visibleRows.length);
	return (
		<div className="grid gap-1.5 border-white/10 border-t pt-2">
			<div className="flex items-center justify-between gap-2 text-ui">
				<div className="min-w-0">
					<div className="truncate font-medium text-fg">Motion system</div>
					<div className="truncate text-fg-muted">
						{target.clipName} / {target.techniqueLabel}
					</div>
				</div>
				<div className="shrink-0 text-fg-muted">
					{target.activeRowCount} active
				</div>
			</div>
			{visibleRows.map((row) => (
				<div
					key={row.id}
					className={cn(
						"grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5",
						row.emphasis === "keyed"
							? "border-accent/70 bg-accent-surface text-accent-fg"
							: row.emphasis === "animated"
								? "border-warn/45 bg-warn-surface text-warn-fg"
								: row.emphasis === "changed"
									? "border-white/14 bg-white/[0.07] text-fg"
									: "border-white/8 bg-black/20 text-fg-secondary",
					)}
				>
					<div className="min-w-0">
						<div className="truncate font-medium text-ui leading-3">
							{row.label}
						</div>
						<div className="truncate text-fg-muted text-ui leading-3">
							{row.deltaDisplay ?? "profile default"}
						</div>
					</div>
					<div className="capture-value tabular-nums">{row.displayValue}</div>
					<div
						className={cn(
							"grid h-5 min-w-9 grid-cols-[auto_1fr] items-center gap-1 rounded border px-1 text-center text-ui",
							row.keyedAtFrame
								? "border-accent/60 bg-accent/10 text-accent-fg"
								: row.animated
									? "border-warn/40 bg-warn/10 text-warn-fg"
									: "border-white/10 bg-black/20 text-fg-muted",
						)}
					>
						<Diamond
							aria-hidden="true"
							size={8}
							weight={row.keyedAtFrame ? "fill" : "regular"}
						/>
						<span>{readableRowLabel(row.keyedAtFrame, row.animated)}</span>
					</div>
				</div>
			))}
			{hiddenCount > 0 ? (
				<div className="rounded border border-white/8 bg-black/20 px-2 py-1 text-fg-muted text-ui">
					+{hiddenCount} more parameters
				</div>
			) : null}
		</div>
	);
}

function SceneSidecarCaptureRows({
	title,
	subtitle,
	activeCount,
	rows,
}: {
	readonly title: string;
	readonly subtitle: string;
	readonly activeCount: number;
	readonly rows: readonly SceneSidecarCaptureRow[];
}) {
	const visibleRows = rows.slice(0, ACTIVE_ROW_LIMIT);
	const hiddenCount = Math.max(0, rows.length - visibleRows.length);
	return (
		<div className="grid gap-1.5 border-white/10 border-t pt-2">
			<div className="flex items-center justify-between gap-2 text-ui">
				<div className="min-w-0">
					<div className="truncate font-medium text-fg">{title}</div>
					<div className="truncate text-fg-muted">{subtitle}</div>
				</div>
				<div className="shrink-0 text-fg-muted">{activeCount} active</div>
			</div>
			{visibleRows.map((row) => (
				<div
					key={row.id}
					className={cn(
						"grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5",
						row.emphasis === "keyed"
							? "border-accent/70 bg-accent-surface text-accent-fg"
							: row.emphasis === "animated"
								? "border-warn/45 bg-warn-surface text-warn-fg"
								: row.emphasis === "changed"
									? "border-white/14 bg-white/[0.07] text-fg"
									: "border-white/8 bg-black/20 text-fg-secondary",
					)}
				>
					<div className="min-w-0">
						<div className="truncate font-medium text-ui leading-3">
							{row.label}
						</div>
						<div className="truncate text-fg-muted text-ui leading-3">
							{row.deltaDisplay ?? "base value"}
						</div>
					</div>
					<div className="capture-value tabular-nums">{row.displayValue}</div>
					<div
						className={cn(
							"grid h-5 min-w-9 grid-cols-[auto_1fr] items-center gap-1 rounded border px-1 text-center text-ui",
							row.keyedAtFrame
								? "border-accent/60 bg-accent/10 text-accent-fg"
								: row.animated
									? "border-warn/40 bg-warn/10 text-warn-fg"
									: "border-white/10 bg-black/20 text-fg-muted",
						)}
					>
						<Diamond
							aria-hidden="true"
							size={8}
							weight={row.keyedAtFrame ? "fill" : "regular"}
						/>
						<span>{readableRowLabel(row.keyedAtFrame, row.animated)}</span>
					</div>
				</div>
			))}
			{hiddenCount > 0 ? (
				<div className="rounded border border-white/8 bg-black/20 px-2 py-1 text-fg-muted text-ui">
					+{hiddenCount} more parameters
				</div>
			) : null}
		</div>
	);
}

/**
 * Filming overlay for motion-authoring shots. It reads selection, transport,
 * viewport, scene, and motion state, but deliberately writes only its own open
 * flag so it never enters scene or motion history.
 */
export function ParameterCaptureStage() {
	const open = useEditorChromeStore((state) => state.parameterCaptureOpen);
	const close = useEditorChromeStore((state) => state.setParameterCaptureOpen);
	const document = useSceneStore((state) => state.document);
	const motion = useMotionStore((state) => state.document);
	const grammarBindings = useMotionGrammarStore(
		(state) => state.document.bindings,
	);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const selectedCount = useSelectionStore((state) => state.nodeIds.length);
	const selectedLookNodeId = useLookGraphSelectionStore(
		(state) => state.selectedNodeId,
	);
	const selectedClipId = useMotionClipSelectionStore(
		(state) => state.selectedClipId,
	);
	const zoom = useViewportStore((state) => state.zoom);
	const panX = useViewportStore((state) => state.panX);
	const panY = useViewportStore((state) => state.panY);
	const node = findNode(document, primaryNodeId);
	const artboardId = selectCurrentArtboard(document).id;
	const target = useMemo(
		() =>
			node
				? buildParameterCaptureTarget({
						node,
						motion,
						currentFrame,
					})
				: null,
		[node, motion, currentFrame],
	);
	const lookTarget = useMemo(
		() =>
			lookParameterCaptureTarget({
				document,
				motion,
				selectedLookNodeId,
				artboardId,
				currentFrame,
			}),
		[document, motion, selectedLookNodeId, artboardId, currentFrame],
	);
	const duplicateTarget = useMemo(
		() =>
			buildDuplicateGeneratorCaptureTarget({
				document,
				motion,
				node: node ?? null,
				currentFrame,
			}),
		[document, motion, node, currentFrame],
	);
	const effectStackTarget = useMemo(
		() =>
			buildEffectStackCaptureTarget({
				document,
				artboardId,
			}),
		[document, artboardId],
	);
	const motionSystemTarget = useMemo(
		() =>
			buildMotionSystemCaptureTarget({
				motion,
				bindings: grammarBindings,
				selectedClipId,
				currentFrame,
			}),
		[motion, grammarBindings, selectedClipId, currentFrame],
	);
	const bounds = useMemo(
		() =>
			open
				? selectedNodeScreenBounds(
						document,
						motion,
						primaryNodeId,
						currentFrame,
						{
							zoom,
							panX,
							panY,
						},
					)
				: null,
		[open, document, motion, primaryNodeId, currentFrame, zoom, panX, panY],
	);
	const placement = useStagePlacement(bounds);

	if (!open) return <ParameterCaptureToggle />;

	const hasCaptureTarget = Boolean(
		target ||
			lookTarget ||
			duplicateTarget ||
			effectStackTarget ||
			motionSystemTarget,
	);
	const emptyLabel =
		selectedCount > 0 || selectedLookNodeId || selectedClipId
			? "Selection unavailable"
			: "No selection";
	const emptyBody = selectedClipId
		? "Selected clip has no captured motion-system parameters."
		: selectedLookNodeId
			? "Selected Look node has no captured numeric parameters."
			: "No vector part, Look node, or motion-system clip selected.";

	return (
		<>
			<CaptureCallout bounds={bounds} placement={placement} />
			<section
				className="parameter-capture-stage chrome-scrollbar-thin pointer-events-auto overflow-y-auto rounded-md border border-white/10 bg-surface-raised/92 p-2 text-ui shadow-2xl shadow-scrim/35 backdrop-blur-xl"
				style={{
					right: placement.right,
					top: placement.top,
					width: placement.width,
					maxHeight: placement.maxHeight,
				}}
				aria-label="Parameter capture stage"
			>
				<div className="mb-2 flex items-start gap-2">
					<div className="grid min-w-0 flex-1 gap-0.5">
						<div className="flex items-center gap-1 text-accent-fg">
							<SlidersHorizontal aria-hidden="true" size={13} />
							<span className="font-medium">Parameter Capture</span>
						</div>
						{target ? (
							<>
								<div className="truncate text-fg">
									{target.nodeName}
									<span className="text-fg-muted">
										{" "}
										/{target.nodeKindLabel}
									</span>
								</div>
								<div className="flex gap-2 text-fg-muted">
									<span>Frame {target.frame}</span>
									<span>{target.activeRowCount} active</span>
								</div>
							</>
						) : lookTarget ? (
							<>
								<div className="truncate text-fg">
									{lookTarget.label}
									<span className="text-fg-muted">
										{" "}
										/{lookTarget.kindLabel}
									</span>
								</div>
								<div className="flex gap-2 text-fg-muted">
									<span>Frame {lookTarget.frame}</span>
									<span>{lookTarget.activeRowCount} active</span>
								</div>
							</>
						) : motionSystemTarget ? (
							<>
								<div className="truncate text-fg">
									{motionSystemTarget.clipName}
									<span className="text-fg-muted">
										{" "}
										/{motionSystemTarget.techniqueLabel}
									</span>
								</div>
								<div className="flex gap-2 text-fg-muted">
									<span>Frame {motionSystemTarget.frame}</span>
									<span>{motionSystemTarget.activeRowCount} active</span>
								</div>
							</>
						) : effectStackTarget ? (
							<>
								<div className="truncate text-fg">
									Effect Stack
									<span className="text-fg-muted">
										{" "}
										/{effectStackTarget.scopeLabel}
									</span>
								</div>
								<div className="flex gap-2 text-fg-muted">
									<span>{effectStackTarget.layerCount} layers</span>
									<span>{effectStackTarget.activeRowCount} active</span>
								</div>
							</>
						) : (
							<div className="text-fg-muted">{emptyLabel}</div>
						)}
					</div>
					<button
						type="button"
						className="grid size-6 shrink-0 place-items-center rounded border border-white/10 bg-black/20 text-fg-secondary transition hover:border-white/20 hover:text-fg"
						aria-label="Close parameter capture"
						onClick={() => close(false)}
					>
						<X aria-hidden="true" size={12} />
					</button>
				</div>
				<div className="grid gap-2">
					{target ? <CaptureRows rows={target.rows} /> : null}
					{duplicateTarget ? (
						<SceneSidecarCaptureRows
							title="Duplicate generator"
							subtitle={duplicateTarget.sourceName}
							activeCount={duplicateTarget.activeRowCount}
							rows={duplicateTarget.rows}
						/>
					) : null}
					{lookTarget ? <LookCaptureRows target={lookTarget} /> : null}
					{effectStackTarget ? (
						<SceneSidecarCaptureRows
							title="Effect stack"
							subtitle={`${effectStackTarget.scopeLabel} / ${effectStackTarget.layerCount} layers`}
							activeCount={effectStackTarget.activeRowCount}
							rows={effectStackTarget.rows}
						/>
					) : null}
					{motionSystemTarget ? (
						<MotionSystemCaptureRows target={motionSystemTarget} />
					) : null}
					{!hasCaptureTarget ? (
						<div className="rounded-md border border-white/8 bg-black/20 px-2 py-3 text-fg-secondary">
							{emptyBody}
						</div>
					) : null}
				</div>
			</section>
		</>
	);
}
