import { Popover } from "@base-ui/react/popover";
import type { Icon } from "@phosphor-icons/react";
import {
	ArrowsLeftRight,
	ArrowsOutSimple,
	CaretLeft,
	CaretRight,
	Circle,
	Graph,
	GridFour,
	LineSegment,
	Trash,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	MAX_BLEND_STEPS,
	normalizeBlendOrientation,
	normalizeBlendSpacing,
	replaceableBlendSpineFromNode,
} from "@/entities/scene/model/blend";
import {
	buildCreateBlendCommand,
	buildMoveBlendSourceCommand,
	buildRemoveBlendSourceCommand,
	createClearBlendSpineCommand,
	createExpandBlendCommand,
	createReleaseBlendCommand,
	createReplaceBlendSpineCommand,
	createReverseBlendCommand,
	createReverseBlendFrontBackCommand,
	createUpdateBlendOrientationCommand,
	createUpdateBlendSpacingCommand,
} from "@/entities/scene/model/blend-commands";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import { convertPaintKind } from "@/entities/scene/model/gradient-edit";
import { getGeometryBounds } from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	BlendOrientation,
	BlendSpacing,
	RevealPaint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { useBlendToolStore } from "@/features/blend/model/tool-state";
import {
	DEFAULT_PENCIL_PRESSURE_SENSITIVITY,
	PENCIL_BRUSH_PRESETS,
	PENCIL_WIDTH_MAX,
	PENCIL_WIDTH_MIN,
	type PencilBrushType,
	usePencilToolStore,
} from "@/features/draw/model/pencil-tool-store";
import { useLookGraphWorkspaceTargetStore } from "@/features/look-authoring/model";
import {
	commitNoiseGradientToolAmount,
	commitNoiseGradientToolBlendMode,
	commitNoiseGradientToolFieldMode,
	commitNoiseGradientToolGrainStrength,
	commitNoiseGradientToolLinearFieldFit,
	commitNoiseGradientToolLinearFieldInvert,
	commitNoiseGradientToolMaterialMode,
	commitNoiseGradientToolOverlayColor,
	commitNoiseGradientToolRevealPaint,
	commitNoiseGradientToolSoftness,
	commitNoiseGradientToolStyle,
	noiseGradientToolControlState,
	resolveNoiseGradientOpenGraphTarget,
} from "@/features/noise-gradient/model/tool-controls";
import { useSelectionStore } from "@/features/selection/model/store";
import { cleanupShapeBuilderRemainders } from "@/features/shape-builder/model/command";
import { SHAPE_BUILDER_OUTPUT_DETAIL_PRESETS } from "@/features/shape-builder/model/output-detail";
import {
	buildShapeBuilderPalette,
	cycleShapeBuilderSwatch,
	swatchIndexForFill,
} from "@/features/shape-builder/model/palette";
import { useShapeBuilderStore } from "@/features/shape-builder/model/store";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import { useColorRecents } from "@/shared/color/recents";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import { ColorPicker } from "@/shared/ui/ColorPicker";
import { ScrubSlider } from "@/shared/ui/ScrubSlider";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import {
	TEXTURE_MATERIAL_BLEND_MODES,
	type TextureMaterialBlendMode,
	type TextureParticleFieldMode,
} from "@/shared/vec-core";

const NOISE_FIELD_MODE_OPTIONS = [
	{
		mode: "contour",
		title: "Circular field",
		Icon: Circle,
	},
	{
		mode: "linear",
		title: "Linear field",
		Icon: LineSegment,
	},
	{
		mode: "mesh",
		title: "Field Mesh",
		Icon: GridFour,
	},
] as const satisfies readonly {
	readonly mode: TextureParticleFieldMode;
	readonly title: string;
	readonly Icon: Icon;
}[];

const NOISE_STYLE_OPTIONS = [
	{ style: "off", label: "Off" },
	{ style: "overlay", label: "Overlay" },
	{ style: "dissolve", label: "Dissolve" },
] as const satisfies readonly {
	readonly style: "off" | "overlay" | "dissolve";
	readonly label: string;
}[];

/** "hard-light" -> "Hard Light"; hyphen-split + capitalize keeps this in sync with new blend modes without a hand-listed label table. */
function blendModeLabel(mode: TextureMaterialBlendMode): string {
	return mode
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** Real compositing blend modes offered in the Overlay Style's Blend dropdown — never "dissolve", which is a Style axis value (a render mode), not a compositing blend. */
const OVERLAY_BLEND_MODES = TEXTURE_MATERIAL_BLEND_MODES.filter(
	(mode) => mode !== "dissolve",
);

const BLEND_SPACING_MODE_OPTIONS = [
	{ kind: "specified-steps", label: "Steps" },
	{ kind: "specified-distance", label: "Distance" },
	{ kind: "smooth-color", label: "Smooth" },
] as const satisfies readonly {
	readonly kind: BlendSpacing["kind"];
	readonly label: string;
}[];

const BLEND_ORIENTATION_OPTIONS = [
	{ orientation: "page", label: "Page" },
	{ orientation: "spine", label: "Spine" },
] as const satisfies readonly {
	readonly orientation: BlendOrientation;
	readonly label: string;
}[];

const DEFAULT_BLEND_UI_STEPS = 8;
const DEFAULT_BLEND_UI_DISTANCE = 40;
const DEFAULT_BLEND_UI_SMOOTH_MAX = 64;
const COLOR_PICKER_PANEL_CLASS =
	"z-50 w-[232px] rounded-md border border-white/12 bg-surface-raised/98 p-2 text-fg text-ui shadow-2xl shadow-black/55 outline-none backdrop-blur-xl";

/** Symmetric reveal-paint kinds offered as a compact segmented row (mirrors the Inspector's `FILL_PAINT_KIND_ROW`). */
const REVEAL_PAINT_KIND_ROW = [
	{ value: "solid", label: "Solid" },
	{ value: "linear-gradient", label: "Linear" },
	{ value: "radial-gradient", label: "Radial" },
] as const;

/** A no-fill swatch glyph, matching the Inspector's `FILL_SWATCH_NONE`. */
const REVEAL_PAINT_SWATCH_NONE =
	"linear-gradient(135deg, transparent 0 42%, var(--danger) 42% 58%, transparent 58%)";

/**
 * Fallback bounds for seeding a fresh reveal-paint gradient when the resolved
 * owner's node geometry cannot be read; mirrors the Inspector's
 * `REVEAL_PAINT_DEFAULT_BOUNDS` fallback.
 */
const REVEAL_PAINT_DEFAULT_BOUNDS = { x: 0, y: 0, width: 200, height: 200 };

function percent(value: number): string {
	return `${Math.round(value)}%`;
}

/** Pencil options bar's Width readout — plain pixels, no forced decimal padding. */
function pixels(value: number): string {
	return `${value}px`;
}

/** Segmented brush-family row for the Pencil options bar. */
const PENCIL_BRUSH_TYPE_OPTIONS = [
	{ type: "pen", label: "Pen" },
	{ type: "pencil", label: "Pencil" },
	{ type: "marker", label: "Marker" },
] as const satisfies readonly {
	readonly type: PencilBrushType;
	readonly label: string;
}[];

/** Live swatch preview for the tool bar's compact reveal-paint control. */
function revealPaintSwatchBackground(value: RevealPaint | null): string {
	if (!value) return REVEAL_PAINT_SWATCH_NONE;
	if (value.kind === "solid") return value.color;
	const stops = [...value.stops]
		.sort((a, b) => a.offset - b.offset)
		.map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
		.join(", ");
	return `linear-gradient(90deg, ${stops})`;
}

function ShapeBuilderOptions() {
	const [pickerOpen, setPickerOpen] = useState(false);
	const document = useSceneStore((state) => state.document);
	const nodeIds = useSelectionStore((state) => state.nodeIds);
	const paintMode = useShapeBuilderStore((state) => state.paintMode);
	const activeFill = useShapeBuilderStore((state) => state.activeFill);
	const activeSwatchIndex = useShapeBuilderStore(
		(state) => state.activeSwatchIndex,
	);
	const setPaintMode = useShapeBuilderStore((state) => state.setPaintMode);
	const setActiveFill = useShapeBuilderStore((state) => state.setActiveFill);
	const outputDetail = useShapeBuilderStore((state) => state.outputDetail);
	const setOutputDetail = useShapeBuilderStore(
		(state) => state.setOutputDetail,
	);
	const cleanup = useShapeBuilderStore((state) => state.cleanup);
	const clearCleanupCandidates = useShapeBuilderStore(
		(state) => state.clearCleanupCandidates,
	);
	const recents = useColorRecents((state) => state.recents);
	const palette = useMemo(
		() => buildShapeBuilderPalette({ document, nodeIds, recents }),
		[document, nodeIds, recents],
	);
	const cleanupNodeIds = useMemo(
		() => cleanup.remainderNodeIds.filter((id) => findNode(document, id)),
		[document, cleanup.remainderNodeIds],
	);
	const cleanupFocusNodeIds = useMemo(
		() => cleanup.focusNodeIds.filter((id) => findNode(document, id)),
		[document, cleanup.focusNodeIds],
	);
	const cleanupCount = cleanupNodeIds.length;

	const activateSwatchMode = (): void => {
		const index = swatchIndexForFill(palette, activeFill, activeSwatchIndex);
		const fill = palette[index]?.color ?? activeFill;
		setPaintMode("swatch");
		setActiveFill(fill, index);
	};

	const commitFill = (hex: string): boolean => {
		const index = swatchIndexForFill(palette, hex, activeSwatchIndex);
		setPaintMode("swatch");
		setActiveFill(hex, index);
		return true;
	};

	const cycle = (direction: -1 | 1): void => {
		const next = cycleShapeBuilderSwatch({
			palette,
			activeFill,
			activeSwatchIndex,
			direction,
		});
		setPaintMode("swatch");
		setActiveFill(next.fill, next.index);
	};

	const cleanRemainders = (): void => {
		if (cleanupCount === 0) {
			clearCleanupCandidates();
			return;
		}
		cleanupShapeBuilderRemainders(cleanupNodeIds);
		clearCleanupCandidates();
		useSelectionStore
			.getState()
			.setSelection(cleanupFocusNodeIds, cleanupFocusNodeIds.at(-1) ?? null);
	};

	return (
		<TooltipProvider>
			<aside
				className="tool-options pointer-events-auto flex max-w-full items-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-surface-raised/92 p-1 text-fg shadow-2xl shadow-black/45 backdrop-blur-xl"
				role="toolbar"
				aria-label="Shape Builder options"
			>
				<fieldset className="m-0 grid shrink-0 grid-cols-2 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
					<legend className="sr-only">Shape Builder paint source</legend>
					{(["artwork", "swatch"] as const).map((mode) => {
						const selected = paintMode === mode;
						const label = mode === "artwork" ? "Artwork" : "Swatch";
						return (
							<Tooltip key={mode} label={label} side="top">
								<button
									type="button"
									aria-label={`Shape Builder ${label} mode`}
									aria-pressed={selected}
									onClick={() => {
										if (mode === "swatch") activateSwatchMode();
										else setPaintMode("artwork");
									}}
									className={cn(
										"flex h-7 min-w-14 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
										selected
											? "border-accent bg-accent-surface text-accent-fg"
											: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
									)}
								>
									{label}
								</button>
							</Tooltip>
						);
					})}
				</fieldset>
				{paintMode === "swatch" ? (
					<>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<Tooltip label="Previous swatch" side="top">
							<button
								type="button"
								aria-label="Previous Shape Builder swatch"
								onClick={() => cycle(-1)}
								className="grid size-7 place-items-center rounded-md border border-white/10 bg-black/10 text-fg-muted text-ui transition hover:border-white/20 hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
							>
								<CaretLeft aria-hidden="true" size={12} />
							</button>
						</Tooltip>
						<Popover.Root
							open={pickerOpen}
							onOpenChange={setPickerOpen}
							modal={false}
						>
							<Popover.Trigger
								type="button"
								aria-label="Open Shape Builder fill picker"
								title="Shape Builder fill"
								className="grid size-7 place-items-center rounded-md border border-white/10 bg-black/10 transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
							>
								<span
									className="size-4 rounded border border-white/20"
									style={{ backgroundColor: activeFill }}
								/>
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Positioner
									align="center"
									side="top"
									sideOffset={8}
									collisionPadding={8}
									className="z-50 outline-none"
								>
									<Popover.Popup className={COLOR_PICKER_PANEL_CLASS}>
										<ColorPicker
											value={activeFill}
											resetKey={`shape-builder:${activeFill}`}
											allowNone={false}
											onChange={(hex) => {
												const index = swatchIndexForFill(
													palette,
													hex,
													activeSwatchIndex,
												);
												setActiveFill(hex, index);
											}}
											onCommit={commitFill}
										/>
									</Popover.Popup>
								</Popover.Positioner>
							</Popover.Portal>
						</Popover.Root>
						<Tooltip label="Next swatch" side="top">
							<button
								type="button"
								aria-label="Next Shape Builder swatch"
								onClick={() => cycle(1)}
								className="grid size-7 place-items-center rounded-md border border-white/10 bg-black/10 text-fg-muted text-ui transition hover:border-white/20 hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
							>
								<CaretRight aria-hidden="true" size={12} />
							</button>
						</Tooltip>
					</>
				) : null}
				<div className="h-5 w-px bg-white/10" aria-hidden="true" />
				<fieldset className="m-0 grid shrink-0 grid-cols-2 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
					<legend className="sr-only">Shape Builder curve detail</legend>
					{SHAPE_BUILDER_OUTPUT_DETAIL_PRESETS.map((preset) => {
						const selected = outputDetail === preset.detail;
						return (
							<Tooltip
								key={preset.id}
								label={
									preset.id === "fewer-anchors"
										? "Fewer anchors"
										: `${preset.label} curve detail`
								}
								side="top"
							>
								<button
									type="button"
									aria-label={`Shape Builder ${preset.label} curve detail`}
									aria-pressed={selected}
									onClick={() => setOutputDetail(preset.detail)}
									className={cn(
										"flex h-7 min-w-12 items-center justify-center rounded-md border px-1.5 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
										selected
											? "border-accent bg-accent-surface text-accent-fg"
											: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
									)}
								>
									{preset.label}
								</button>
							</Tooltip>
						);
					})}
				</fieldset>
				{cleanupCount > 0 ? (
					<>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<Tooltip
							label={`Delete ${cleanupCount} last extract remainder${
								cleanupCount === 1 ? "" : "s"
							}`}
							side="top"
						>
							<button
								type="button"
								aria-label="Delete last extract remainders"
								onClick={cleanRemainders}
								className="flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border border-white/10 bg-black/10 px-1.5 text-fg-muted text-ui transition hover:border-danger/40 hover:bg-danger-surface/40 hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
							>
								<Trash aria-hidden="true" size={12} />
								<span className="min-w-3 text-center tabular-nums">
									{cleanupCount}
								</span>
							</button>
						</Tooltip>
					</>
				) : null}
			</aside>
		</TooltipProvider>
	);
}

/**
 * Pencil tool's pre-draw brush-authoring bar: pick a brush family, set width
 * and pressure taper BEFORE drawing. Purely local tool config (no scene
 * selection or document mutation involved), so its `ScrubSlider`s drive
 * `usePencilToolStore` setters directly instead of a command-bus gesture
 * transaction — there is nothing to coalesce into undo history.
 */
function PencilOptions() {
	const brushType = usePencilToolStore((state) => state.brushType);
	const setBrushType = usePencilToolStore((state) => state.setBrushType);
	const width = usePencilToolStore((state) => state.width);
	const setWidth = usePencilToolStore((state) => state.setWidth);
	const pressureEnabled = usePencilToolStore((state) => state.pressureEnabled);
	const setPressureEnabled = usePencilToolStore(
		(state) => state.setPressureEnabled,
	);
	const pressureSensitivity = usePencilToolStore(
		(state) => state.pressureSensitivity,
	);
	const setPressureSensitivity = usePencilToolStore(
		(state) => state.setPressureSensitivity,
	);
	const widthNeutral = PENCIL_BRUSH_PRESETS[brushType].width;

	return (
		<TooltipProvider>
			<aside
				className="tool-options pointer-events-auto flex max-w-full items-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-surface-raised/92 p-1 text-fg shadow-2xl shadow-black/45 backdrop-blur-xl"
				role="toolbar"
				aria-label="Pencil options"
			>
				<fieldset className="m-0 grid shrink-0 grid-cols-3 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
					<legend className="sr-only">Pencil brush type</legend>
					{PENCIL_BRUSH_TYPE_OPTIONS.map(({ type, label }) => {
						const selected = brushType === type;
						return (
							<Tooltip key={type} label={`${label} brush`} side="top">
								<button
									type="button"
									aria-label={`Pencil ${label} brush`}
									aria-pressed={selected}
									onClick={() => setBrushType(type)}
									className={cn(
										"flex h-7 min-w-14 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
										selected
											? "border-accent bg-accent-surface text-accent-fg"
											: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
									)}
								>
									{label}
								</button>
							</Tooltip>
						);
					})}
				</fieldset>
				<div className="h-5 w-px bg-white/10" aria-hidden="true" />
				<div className="w-36 shrink-0">
					<ScrubSlider
						label="Width"
						value={width}
						min={PENCIL_WIDTH_MIN}
						max={PENCIL_WIDTH_MAX}
						neutral={widthNeutral}
						step={0.5}
						unit="px"
						format={pixels}
						onScrubStart={() => {}}
						onScrub={(next) => setWidth(next)}
						onScrubEnd={() => {}}
						onCommitValue={(next) => setWidth(next)}
					/>
				</div>
				<div className="h-5 w-px bg-white/10" aria-hidden="true" />
				<Tooltip label="Vary width with pen pressure" side="top">
					<button
						type="button"
						aria-label="Pencil pressure-sensitive width"
						aria-pressed={pressureEnabled}
						onClick={() => setPressureEnabled(!pressureEnabled)}
						className={cn(
							"flex h-7 shrink-0 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
							pressureEnabled
								? "border-accent bg-accent-surface text-accent-fg"
								: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
						)}
					>
						Pressure
					</button>
				</Tooltip>
				{pressureEnabled ? (
					<>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<div className="w-36 shrink-0">
							<ScrubSlider
								label="Sensitivity"
								value={pressureSensitivity * 100}
								min={0}
								max={100}
								neutral={DEFAULT_PENCIL_PRESSURE_SENSITIVITY * 100}
								step={1}
								unit="%"
								format={percent}
								onScrubStart={() => {}}
								onScrub={(next) => setPressureSensitivity(next / 100)}
								onScrubEnd={() => {}}
								onCommitValue={(next) => setPressureSensitivity(next / 100)}
							/>
						</div>
					</>
				) : null}
			</aside>
		</TooltipProvider>
	);
}

function NoiseGradientOptions() {
	const document = useSceneStore((state) => state.document);
	const nodeIds = useSelectionStore((state) => state.nodeIds);
	const primary = useSelectionStore((state) => state.primary);
	const selection = useMemo(() => ({ nodeIds, primary }), [nodeIds, primary]);
	const lookWorkspaceOpen = useEditorChromeStore(
		(editor) => editor.lookWorkspaceOpen,
	);
	const toggleLookWorkspace = useEditorChromeStore(
		(editor) => editor.toggleLookWorkspace,
	);
	const setLookWorkspaceTarget = useLookGraphWorkspaceTargetStore(
		(workspace) => workspace.setTargetOverride,
	);
	const lastFixedAngleByNodeRef = useRef(new Map<string, number>());
	const amountGestureRef = useRef<GestureTransaction | null>(null);
	const softnessGestureRef = useRef<GestureTransaction | null>(null);
	const grainGestureRef = useRef<GestureTransaction | null>(null);
	const state = noiseGradientToolControlState(document, selection);
	useEffect(() => {
		if (state?.fieldMode === "linear") {
			lastFixedAngleByNodeRef.current.set(state.nodeId, state.angle);
		}
	}, [state?.angle, state?.fieldMode, state?.nodeId]);

	if (!state) return null;

	const restoredLineAngle =
		state.fieldMode === "linear"
			? state.angle
			: (lastFixedAngleByNodeRef.current.get(state.nodeId) ?? state.angle);
	const linearMode = state.fieldMode === "linear";
	const openGraph = (): void => {
		const target = resolveNoiseGradientOpenGraphTarget(state.nodeId);
		if (!target) return;
		setLookWorkspaceTarget({
			scope: "scoped-overlay",
			artboardId: target.artboardId,
			scopedLookId: target.scopedLookId,
		});
		if (!lookWorkspaceOpen) toggleLookWorkspace();
	};

	return (
		<TooltipProvider>
			{/*
			 * width:max-content keeps the grouped bar on a single row (sized to its
			 * widest, reserved Look content) instead of collapsing to the narrower
			 * absolutely-positioned shrink-to-fit width that wraps it into two rows.
			 * (fit-content would collapse to min-content here and stack vertically.)
			 * The max-w-full cap still lets it wrap on a genuinely narrow viewport.
			 */}
			<aside
				className="tool-options pointer-events-auto flex max-w-full flex-wrap items-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-surface-raised/92 p-1 text-fg shadow-2xl shadow-black/45 backdrop-blur-xl"
				style={{ width: "max-content" }}
				role="toolbar"
				aria-label="Noise Gradient options"
			>
				<span className="shrink-0 px-1 text-fg-subtle text-ui">Field</span>
				<fieldset className="m-0 grid shrink-0 grid-cols-3 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
					<legend className="sr-only">Noise Gradient field</legend>
					{NOISE_FIELD_MODE_OPTIONS.map(({ mode, title, Icon }) => {
						const selected = state.fieldMode === mode;
						const label = state.editable
							? title
							: `${title}. Open Graph to edit this field.`;
						return (
							<Tooltip key={mode} label={label} side="top">
								<button
									type="button"
									aria-label={label}
									aria-disabled={!state.editable}
									aria-pressed={selected}
									onClick={() => {
										if (!state.editable) return;
										commitNoiseGradientToolFieldMode(
											state.nodeId,
											mode,
											restoredLineAngle,
										);
									}}
									className={cn(
										"grid size-7 place-items-center rounded-md border text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
										selected
											? "border-accent bg-accent-surface text-accent-fg"
											: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
										!state.editable &&
											"cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-black/10 hover:text-fg-muted",
									)}
								>
									<Icon
										aria-hidden="true"
										size={13}
										weight={selected ? "duotone" : "regular"}
									/>
								</button>
							</Tooltip>
						);
					})}
				</fieldset>
				{linearMode ? (
					<>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<Tooltip label="Invert Linear field" side="top">
							<button
								type="button"
								aria-label="Invert Linear Noise Gradient field"
								aria-disabled={!state.editable}
								onClick={() => {
									if (!state.editable) return;
									commitNoiseGradientToolLinearFieldInvert(state.nodeId);
								}}
								className={cn(
									"grid size-7 place-items-center rounded-md border border-white/10 bg-black/10 text-fg-muted text-ui transition hover:border-white/20 hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
									!state.editable &&
										"cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-black/10 hover:text-fg-muted",
								)}
							>
								<ArrowsLeftRight aria-hidden="true" size={13} />
							</button>
						</Tooltip>
						<Tooltip label="Fit Linear field" side="top">
							<button
								type="button"
								aria-label="Fit Linear Noise Gradient field to bounds"
								aria-disabled={!state.editable}
								onClick={() => {
									if (!state.editable) return;
									commitNoiseGradientToolLinearFieldFit(state.nodeId);
								}}
								className={cn(
									"grid size-7 place-items-center rounded-md border border-white/10 bg-black/10 text-fg-muted text-ui transition hover:border-white/20 hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
									!state.editable &&
										"cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-black/10 hover:text-fg-muted",
								)}
							>
								<ArrowsOutSimple aria-hidden="true" size={13} />
							</button>
						</Tooltip>
					</>
				) : null}
				<div className="h-5 w-px bg-white/10" aria-hidden="true" />
				<span className="shrink-0 px-1 text-fg-subtle text-ui">Style</span>
				<fieldset className="m-0 grid shrink-0 grid-cols-3 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
					<legend className="sr-only">Noise Gradient style</legend>
					{NOISE_STYLE_OPTIONS.map(({ style, label }) => {
						const selected = state.style === style;
						return (
							<button
								key={style}
								type="button"
								aria-label={`Noise Gradient style: ${label}`}
								aria-disabled={!state.editable}
								aria-pressed={selected}
								onClick={() => {
									if (!state.editable) return;
									commitNoiseGradientToolStyle(state.nodeId, style);
								}}
								className={cn(
									"grid h-7 place-items-center rounded-md border px-1.5 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
									selected
										? "border-accent bg-accent-surface text-accent-fg"
										: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
									!state.editable &&
										"cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-black/10 hover:text-fg-muted",
								)}
							>
								{label}
							</button>
						);
					})}
				</fieldset>
				<div className="h-5 w-px bg-white/10" aria-hidden="true" />
				<span className="shrink-0 px-1 text-fg-subtle text-ui">Look</span>
				{/* Grid-stack: the three Style variants share one cell, so the Look region
				    always sizes to the widest (Overlay + Film grain) and switching Style — or
				    toggling Film grain — never re-wraps or shifts the bar. No magic width, and
				    content can't overflow. Inactive variants stay mounted but invisible. */}
				<div className="grid shrink-0 items-center">
					<div
						className={cn(
							"col-start-1 row-start-1 flex items-center gap-1",
							state.style !== "overlay" && "invisible",
						)}
						aria-hidden={state.style !== "overlay"}
					>
						<Tooltip
							label={
								state.editable
									? "Noise Gradient blend mode"
									: "Open Graph to change blend mode"
							}
							side="top"
						>
							<select
								aria-label="Noise Gradient blend mode"
								value={state.blendMode}
								disabled={!state.editable}
								onChange={(event) => {
									commitNoiseGradientToolBlendMode(
										state.nodeId,
										event.currentTarget.value as TextureMaterialBlendMode,
									);
								}}
								className="h-7 shrink-0 rounded-md border border-white/10 bg-black/10 px-1.5 text-fg-muted text-ui transition hover:border-white/20 hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
							>
								{OVERLAY_BLEND_MODES.map((mode) => (
									<option key={mode} value={mode}>
										{blendModeLabel(mode)}
									</option>
								))}
							</select>
						</Tooltip>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<GrainColorSwatch
							nodeId={state.nodeId}
							value={state.overlayColor}
							disabled={!state.editable}
						/>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<Tooltip label="Add a film-grain layer over the overlay" side="top">
							<button
								type="button"
								aria-label="Film grain"
								aria-pressed={state.materialMode === "mixed"}
								aria-disabled={!state.editable}
								onClick={() => {
									if (!state.editable) return;
									commitNoiseGradientToolMaterialMode(
										state.nodeId,
										state.materialMode === "mixed" ? "particle" : "mixed",
									);
								}}
								className={cn(
									"flex h-7 shrink-0 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
									state.materialMode === "mixed"
										? "border-accent bg-accent-surface text-accent-fg"
										: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
									!state.editable &&
										"cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-black/10 hover:text-fg-muted",
								)}
							>
								Film grain
							</button>
						</Tooltip>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<div
							className={cn(
								"w-36 shrink-0",
								state.materialMode !== "mixed" && "invisible",
							)}
						>
							<ScrubSlider
								label="Grain"
								value={state.grainStrength * 100}
								min={0}
								max={100}
								neutral={0}
								step={1}
								unit="%"
								disabled={!state.editable || state.materialMode !== "mixed"}
								format={percent}
								onScrubStart={() => {
									grainGestureRef.current = beginGestureTransaction(
										`noise-gradient-tool-options:${state.nodeId}:grain-strength`,
										"Edit Noise Gradient grain strength",
									);
								}}
								onScrub={(next) =>
									commitNoiseGradientToolGrainStrength(state.nodeId, next / 100)
								}
								onScrubEnd={() => {
									if (grainGestureRef.current) {
										commitGestureTransaction(grainGestureRef.current);
										grainGestureRef.current = null;
									}
								}}
								onCommitValue={(next) =>
									commitNoiseGradientToolGrainStrength(state.nodeId, next / 100)
								}
							/>
						</div>
					</div>
					<div
						className={cn(
							"col-start-1 row-start-1 flex items-center gap-1",
							state.style !== "dissolve" && "invisible",
						)}
						aria-hidden={state.style !== "dissolve"}
					>
						<div className="w-36 shrink-0">
							<ScrubSlider
								label="Coverage"
								value={state.amount * 100}
								min={0}
								max={100}
								neutral={0}
								step={1}
								unit="%"
								disabled={!state.editable}
								format={percent}
								onScrubStart={() => {
									amountGestureRef.current = beginGestureTransaction(
										`noise-gradient-tool-options:${state.nodeId}:amount`,
										"Edit Noise Gradient coverage",
									);
								}}
								onScrub={(next) =>
									commitNoiseGradientToolAmount(state.nodeId, next / 100)
								}
								onScrubEnd={() => {
									if (amountGestureRef.current) {
										commitGestureTransaction(amountGestureRef.current);
										amountGestureRef.current = null;
									}
								}}
								onCommitValue={(next) =>
									commitNoiseGradientToolAmount(state.nodeId, next / 100)
								}
							/>
						</div>
						<div className="w-36 shrink-0">
							<ScrubSlider
								label="Softness"
								value={state.softness * 100}
								min={0}
								max={100}
								neutral={0}
								step={1}
								unit="%"
								disabled={!state.editable}
								format={percent}
								onScrubStart={() => {
									softnessGestureRef.current = beginGestureTransaction(
										`noise-gradient-tool-options:${state.nodeId}:softness`,
										"Edit Noise Gradient softness",
									);
								}}
								onScrub={(next) =>
									commitNoiseGradientToolSoftness(state.nodeId, next / 100)
								}
								onScrubEnd={() => {
									if (softnessGestureRef.current) {
										commitGestureTransaction(softnessGestureRef.current);
										softnessGestureRef.current = null;
									}
								}}
								onCommitValue={(next) =>
									commitNoiseGradientToolSoftness(state.nodeId, next / 100)
								}
							/>
						</div>
						<div className="h-5 w-px bg-white/10" aria-hidden="true" />
						<RevealPaintSwatch
							nodeId={state.nodeId}
							value={state.revealPaint}
							disabled={!state.editable}
							document={document}
						/>
					</div>
					<div
						className={cn(
							"col-start-1 row-start-1 flex items-center",
							state.style !== "off" && "invisible",
						)}
						aria-hidden={state.style !== "off"}
					>
						<span className="px-1 text-fg-subtle text-ui">
							Choose Overlay or Dissolve to adjust its look.
						</span>
					</div>
				</div>
				<div className="h-5 w-px bg-white/10" aria-hidden="true" />
				<Tooltip label={state.openGraphTitle} side="top">
					<button
						type="button"
						aria-label={state.openGraphLabel}
						onClick={openGraph}
						className="grid size-7 place-items-center rounded-md border border-white/10 bg-black/10 text-fg-muted text-ui transition hover:border-accent/45 hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
					>
						<Graph aria-hidden="true" size={12} />
					</button>
				</Tooltip>
			</aside>
		</TooltipProvider>
	);
}

/**
 * Compact reveal-paint swatch → popover for the Noise Gradient tool options
 * bar. Visually mirrors the Inspector's `RevealPaintField` (same swatch/
 * popover/kind-row shape) but is rebuilt locally with shared primitives —
 * `features/noise-gradient` may not import `widgets/inspector/*` (FSD import
 * direction), so this does not reuse that component, only its visual
 * pattern. Gradient depth is intentionally pragmatic (v1, matching the
 * Inspector): kind + stop colors are editable, with no on-canvas ramp/
 * endpoint editing.
 */
function RevealPaintSwatch({
	nodeId,
	value,
	disabled,
	document,
}: {
	readonly nodeId: string;
	readonly value: RevealPaint | null;
	readonly disabled: boolean;
	readonly document: SceneDocument;
}) {
	const [open, setOpen] = useState(false);
	// Which gradient stop the single editor below targets (v1 edits one stop at a
	// time instead of stacking a full ColorPicker per stop, which overflowed).
	const [activeStop, setActiveStop] = useState(0);
	// Live drag ticks share one gesture transaction: only one ColorPicker (the
	// solid swatch, or exactly one gradient stop) is being dragged at a time
	// inside this popover, so one ref is enough to bracket onChange → onScrubEnd
	// as a single coalesced undo entry (same contract ScrubSlider/ColorPicker
	// both document: a drag streams live ticks, the host owns the transaction).
	const colorGestureRef = useRef<GestureTransaction | null>(null);
	const kind = value?.kind ?? null;
	const isGradient = kind === "linear-gradient" || kind === "radial-gradient";
	const stopCount =
		value?.kind === "linear-gradient" || value?.kind === "radial-gradient"
			? value.stops.length
			: 0;
	const safeStop = stopCount > 0 ? Math.min(activeStop, stopCount - 1) : 0;
	const bounds = useMemo(() => {
		const node = findNode(document, nodeId);
		return node
			? getGeometryBounds(node.geometry)
			: REVEAL_PAINT_DEFAULT_BOUNDS;
	}, [document, nodeId]);

	const commitKind = (input: string): void => {
		if (
			input !== "solid" &&
			input !== "linear-gradient" &&
			input !== "radial-gradient"
		) {
			return;
		}
		const next = convertPaintKind(value ?? undefined, input, "none", bounds);
		// `convertPaintKind` only returns `null` for image/mesh kinds, neither of
		// which `REVEAL_PAINT_KIND_ROW` offers here — see its own doc.
		if (
			next &&
			next.kind !== "image-reference" &&
			next.kind !== "mesh-gradient"
		) {
			commitNoiseGradientToolRevealPaint(nodeId, next);
		}
	};

	const solidWithColor = (color: string): RevealPaint => ({
		kind: "solid",
		color,
	});

	const gradientWithStopColor = (
		paint: Extract<
			RevealPaint,
			{ readonly kind: "linear-gradient" | "radial-gradient" }
		>,
		index: number,
		color: string,
	): RevealPaint => ({
		...paint,
		stops: paint.stops.map((stop, stopIndex) =>
			stopIndex === index ? { ...stop, color } : stop,
		),
	});

	const beginColorGesture = (): void => {
		colorGestureRef.current = beginGestureTransaction(
			`noise-gradient-tool-options:${nodeId}:reveal-paint-color`,
			"Edit Noise Gradient reveal paint",
		);
	};

	const endColorGesture = (): void => {
		if (colorGestureRef.current) {
			commitGestureTransaction(colorGestureRef.current);
			colorGestureRef.current = null;
		}
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
			<Popover.Trigger
				type="button"
				disabled={disabled}
				aria-label="Reveal paint — open paint editor"
				title="Reveal paint (the color the dissolve reveals under the fill)"
				className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-black/10 px-2 text-fg-muted text-ui transition hover:border-white/20 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
			>
				<span
					className="grid size-4 shrink-0 place-items-center rounded border border-white/25 text-fg-muted text-ui leading-none"
					style={
						value
							? { background: revealPaintSwatchBackground(value) }
							: undefined
					}
				>
					{value ? null : "+"}
				</span>
				<span>Reveal</span>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="center"
					side="top"
					sideOffset={8}
					collisionPadding={8}
					className="z-50 outline-none"
				>
					<Popover.Popup
						className={cn(
							COLOR_PICKER_PANEL_CLASS,
							"flex max-h-[70vh] flex-col gap-2 overflow-y-auto",
						)}
					>
						<div className="space-y-1">
							<span className="block text-fg-muted text-ui">Reveal paint</span>
							<div className="grid grid-cols-3 overflow-hidden rounded-md border border-white/10 bg-black/25">
								{REVEAL_PAINT_KIND_ROW.map((option) => {
									const selected = kind === option.value;
									return (
										<button
											key={option.value}
											type="button"
											aria-pressed={selected}
											disabled={disabled}
											onClick={() => commitKind(option.value)}
											className={cn(
												"grid h-6 min-w-0 place-items-center border-white/10 border-r text-fg-muted transition last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45",
												selected
													? "bg-accent-surface text-accent-fg"
													: "hover:bg-white/[0.06] hover:text-white",
											)}
										>
											{option.label}
										</button>
									);
								})}
							</div>
							<button
								type="button"
								disabled={disabled || !value}
								title="Remove the reveal paint (the dissolve reveals the object's own fill/background instead)"
								onClick={() => commitNoiseGradientToolRevealPaint(nodeId, null)}
								className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-fg-muted transition hover:bg-white/[0.08] hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
							>
								Clear
							</button>
						</div>
						{value?.kind === "solid" ? (
							<ColorPicker
								value={value.color}
								resetKey={`noise-gradient-reveal-paint:${nodeId}:color`}
								disabled={disabled}
								onChange={(hex) =>
									commitNoiseGradientToolRevealPaint(
										nodeId,
										solidWithColor(hex),
									)
								}
								onCommit={(hex) => {
									commitNoiseGradientToolRevealPaint(
										nodeId,
										solidWithColor(hex),
									);
									return true;
								}}
								onGestureStart={beginColorGesture}
								onGestureEnd={endColorGesture}
							/>
						) : isGradient && value ? (
							<div className="space-y-1.5">
								<span className="block text-fg-muted text-ui">
									Stops · editing {safeStop + 1}/{value.stops.length}
								</span>
								<div className="flex items-center gap-1">
									{value.stops.map((stop, index) => (
										<button
											key={stop.id ?? `${index}:${stop.offset}`}
											type="button"
											aria-label={`Edit reveal stop ${index + 1}`}
											aria-pressed={index === safeStop}
											disabled={disabled}
											onClick={() => setActiveStop(index)}
											className={cn(
												"size-6 shrink-0 rounded border transition",
												index === safeStop
													? "border-accent ring-1 ring-accent"
													: "border-white/20 hover:border-white/45",
											)}
											style={{ background: stop.color }}
										/>
									))}
								</div>
								<ColorPicker
									key={`stop:${safeStop}`}
									value={value.stops[safeStop]?.color ?? "#000000"}
									resetKey={`noise-gradient-reveal-paint:${nodeId}:stop:${safeStop}`}
									disabled={disabled}
									onChange={(hex) =>
										commitNoiseGradientToolRevealPaint(
											nodeId,
											gradientWithStopColor(value, safeStop, hex),
										)
									}
									onCommit={(hex) => {
										commitNoiseGradientToolRevealPaint(
											nodeId,
											gradientWithStopColor(value, safeStop, hex),
										);
										return true;
									}}
									onGestureStart={beginColorGesture}
									onGestureEnd={endColorGesture}
								/>
							</div>
						) : null}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

/**
 * Compact grain-color swatch → popover for the Noise Gradient tool options
 * bar. Visually mirrors {@link RevealPaintSwatch}'s swatch/popover shape and
 * gesture-transaction bracketing, but is solid-color only — the overlay tint
 * (`material.overlayColor`) has no gradient/kind axis, so this omits the kind
 * row and `convertPaintKind`/bounds plumbing entirely.
 */
function GrainColorSwatch({
	nodeId,
	value,
	disabled,
}: {
	readonly nodeId: string;
	readonly value: string | null;
	readonly disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const colorGestureRef = useRef<GestureTransaction | null>(null);

	const beginColorGesture = (): void => {
		colorGestureRef.current = beginGestureTransaction(
			`noise-gradient-tool-options:${nodeId}:grain-color`,
			"Edit Noise Gradient grain color",
		);
	};

	const endColorGesture = (): void => {
		if (colorGestureRef.current) {
			commitGestureTransaction(colorGestureRef.current);
			colorGestureRef.current = null;
		}
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
			<Popover.Trigger
				type="button"
				disabled={disabled}
				aria-label="Grain tint — open color editor"
				title="Grain tint (tints the overlay noise grain)"
				className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-black/10 px-2 text-fg-muted text-ui transition hover:border-white/20 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
			>
				<span
					className="grid size-4 shrink-0 place-items-center rounded border border-white/25 text-fg-muted text-ui leading-none"
					style={value ? { background: value } : undefined}
				>
					{value ? null : "+"}
				</span>
				<span>Tint</span>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="center"
					side="top"
					sideOffset={8}
					collisionPadding={8}
					className="z-50 outline-none"
				>
					<Popover.Popup
						className={cn(
							COLOR_PICKER_PANEL_CLASS,
							"flex max-h-[70vh] flex-col gap-2 overflow-y-auto",
						)}
					>
						<div className="space-y-1">
							<span className="block text-fg-muted text-ui">Grain tint</span>
							<ColorPicker
								value={value ?? "#ffffff"}
								resetKey={`noise-gradient-grain-color:${nodeId}`}
								disabled={disabled}
								onChange={(hex) =>
									commitNoiseGradientToolOverlayColor(nodeId, hex)
								}
								onCommit={(hex) => {
									commitNoiseGradientToolOverlayColor(nodeId, hex);
									return true;
								}}
								onGestureStart={beginColorGesture}
								onGestureEnd={endColorGesture}
							/>
							<button
								type="button"
								disabled={disabled || !value}
								title="Clear the grain tint (the noise renders monochrome)"
								onClick={() =>
									commitNoiseGradientToolOverlayColor(nodeId, null)
								}
								className="flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-fg-muted transition hover:bg-white/[0.08] hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
							>
								Clear
							</button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

const spacingForKind = (
	kind: BlendSpacing["kind"],
	current: BlendSpacing,
): BlendSpacing => {
	switch (kind) {
		case "specified-steps":
			return {
				kind,
				steps:
					current.kind === "specified-steps"
						? current.steps
						: DEFAULT_BLEND_UI_STEPS,
			};
		case "specified-distance":
			return {
				kind,
				distance:
					current.kind === "specified-distance"
						? current.distance
						: DEFAULT_BLEND_UI_DISTANCE,
			};
		case "smooth-color":
			return {
				kind,
				maxSteps:
					current.kind === "smooth-color"
						? (current.maxSteps ?? DEFAULT_BLEND_UI_SMOOTH_MAX)
						: DEFAULT_BLEND_UI_SMOOTH_MAX,
			};
	}
};

const spacingNumericValue = (spacing: BlendSpacing): number => {
	switch (spacing.kind) {
		case "specified-steps":
			return spacing.steps;
		case "specified-distance":
			return spacing.distance;
		case "smooth-color":
			return spacing.maxSteps ?? DEFAULT_BLEND_UI_SMOOTH_MAX;
	}
};

const spacingWithNumericValue = (
	spacing: BlendSpacing,
	value: number,
): BlendSpacing => {
	switch (spacing.kind) {
		case "specified-steps":
			return { kind: spacing.kind, steps: value };
		case "specified-distance":
			return { kind: spacing.kind, distance: value };
		case "smooth-color":
			return { kind: spacing.kind, maxSteps: value };
	}
};

const spacingInputLabel = (spacing: BlendSpacing): string => {
	switch (spacing.kind) {
		case "specified-steps":
			return "Steps";
		case "specified-distance":
			return "Distance";
		case "smooth-color":
			return "Max";
	}
};

const spacingInputStep = (spacing: BlendSpacing): number =>
	spacing.kind === "specified-distance" ? 5 : 1;

type SelectedTopLevelNodeEntry = {
	readonly node: VectorNode;
	readonly layerId: string;
};

const selectedTopLevelNodeEntriesForIds = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly SelectedTopLevelNodeEntry[] => {
	const topLevelNodes = new Map<string, SelectedTopLevelNodeEntry>();
	for (const layer of document.layers) {
		for (const node of layer.nodes) {
			topLevelNodes.set(node.id, { node, layerId: layer.id });
		}
	}
	return nodeIds.flatMap((nodeId) => {
		const entry = topLevelNodes.get(nodeId);
		return entry ? [entry] : [];
	});
};

const blendOpClass = (enabled: boolean): string =>
	cn(
		"flex h-7 shrink-0 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
		enabled
			? "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg"
			: "cursor-not-allowed border-white/10 bg-black/10 text-fg-subtle",
	);

function BlendOptions() {
	const document = useSceneStore((state) => state.document);
	const nodeIds = useSelectionStore((state) => state.nodeIds);
	const primary = useSelectionStore((state) => state.primary);
	const spacing = useBlendToolStore((state) => state.spacing);
	const setSpacing = useBlendToolStore((state) => state.setSpacing);
	const orientation = useBlendToolStore((state) => state.orientation);
	const setOrientation = useBlendToolStore((state) => state.setOrientation);
	const selectedTopLevelEntries = useMemo(
		() => selectedTopLevelNodeEntriesForIds(document, nodeIds),
		[document, nodeIds],
	);
	const selectedBlendEntry =
		selectedTopLevelEntries.find((entry) => entry.node.blend) ??
		selectedTopLevelEntries.find((entry) => entry.node.id === primary) ??
		null;
	const activeBlend = selectedBlendEntry?.node.blend
		? selectedBlendEntry.node
		: null;
	const activeBlendLayerId = activeBlend
		? (selectedBlendEntry?.layerId ?? null)
		: null;
	const spineCandidate =
		activeBlend && activeBlendLayerId && selectedTopLevelEntries.length > 1
			? (selectedTopLevelEntries.find(
					({ node, layerId }) =>
						layerId === activeBlendLayerId &&
						node.id !== activeBlend.id &&
						!node.blend &&
						!node.blendStep &&
						Boolean(replaceableBlendSpineFromNode(node)),
				)?.node ?? null)
			: null;
	const activeSpacing = normalizeBlendSpacing(
		activeBlend?.blend?.spacing ?? spacing,
	);
	const activeOrientation = normalizeBlendOrientation(
		activeBlend?.blend?.orientation ?? orientation,
	);
	const spacingValue = spacingNumericValue(activeSpacing);
	const spacingStep = spacingInputStep(activeSpacing);
	const createBlendPlan = useMemo(
		() =>
			activeBlend
				? null
				: buildCreateBlendCommand(document, nodeIds, {
						spacing: activeSpacing,
						orientation: activeOrientation,
						sourceOrder: "layer",
					}),
		[document, nodeIds, activeBlend, activeSpacing, activeOrientation],
	);
	const canMakeBlend = createBlendPlan?.ok === true;
	const makeBlendLabel = canMakeBlend
		? "Make Blend"
		: (createBlendPlan?.issues[0]?.message ??
			"Select two or more compatible objects to make a blend.");

	const commitSpacing = (nextSpacing: BlendSpacing): void => {
		const normalized = normalizeBlendSpacing(nextSpacing);
		setSpacing(normalized);
		if (!activeBlend) return;
		useSceneStore.getState().apply(
			createUpdateBlendSpacingCommand(activeBlend.id, normalized, {
				coalesceKey: `blend-spacing:${activeBlend.id}`,
			}),
		);
	};

	const commitOrientation = (nextOrientation: BlendOrientation): void => {
		const normalized = normalizeBlendOrientation(nextOrientation);
		setOrientation(normalized);
		if (!activeBlend) return;
		useSceneStore.getState().apply(
			createUpdateBlendOrientationCommand(activeBlend.id, normalized, {
				coalesceKey: `blend-orientation:${activeBlend.id}`,
			}),
		);
	};

	const commitSpacingKind = (kind: BlendSpacing["kind"]): void => {
		commitSpacing(spacingForKind(kind, activeSpacing));
	};

	const commitSpacingValue = (nextValue: number): void => {
		commitSpacing(spacingWithNumericValue(activeSpacing, nextValue));
	};

	const makeBlend = (): void => {
		if (createBlendPlan?.ok !== true) return;
		const before = useSceneStore.getState().document;
		useSceneStore.getState().apply(createBlendPlan.command);
		if (useSceneStore.getState().document === before) return;
		useSelectionStore
			.getState()
			.setSelection([createBlendPlan.blendNodeId], createBlendPlan.blendNodeId);
	};

	const applySelectedBlendCommand = (
		commandFactory: (blendNodeId: string) => SceneCommand,
	): void => {
		if (!activeBlend) return;
		useSceneStore.getState().apply(commandFactory(activeBlend.id));
	};

	const replaceSpine = (): void => {
		if (!activeBlend || !spineCandidate) return;
		useSceneStore.getState().apply(
			createReplaceBlendSpineCommand(activeBlend.id, spineCandidate.id, {
				orientation: activeOrientation,
			}),
		);
		useSelectionStore.getState().setSelection([activeBlend.id], activeBlend.id);
	};

	const moveStop = (sourceNodeId: string, toIndex: number): void => {
		if (!activeBlend) return;
		const plan = buildMoveBlendSourceCommand(
			document,
			activeBlend.id,
			sourceNodeId,
			toIndex,
		);
		if (!plan.ok) return;
		useSceneStore.getState().apply(plan.command);
	};

	const removeStop = (sourceNodeId: string): void => {
		if (!activeBlend) return;
		const plan = buildRemoveBlendSourceCommand(
			document,
			activeBlend.id,
			sourceNodeId,
		);
		if (!plan.ok) return;
		useSceneStore.getState().apply(plan.command);
	};

	const stopIds = activeBlend?.blend?.sourceNodeIds ?? [];

	return (
		<TooltipProvider>
			<aside
				className="tool-options pointer-events-auto flex max-w-full flex-col gap-1 overflow-hidden rounded-lg border border-white/10 bg-surface-raised/92 p-1 text-fg shadow-2xl shadow-black/45 backdrop-blur-xl"
				role="toolbar"
				aria-label="Blend options"
			>
				<div className="flex max-w-full flex-wrap items-center justify-center gap-1">
					<Tooltip label={makeBlendLabel} side="top">
						<button
							type="button"
							aria-label="Make Blend"
							aria-disabled={!canMakeBlend}
							onClick={makeBlend}
							className={cn(
								"flex h-7 shrink-0 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
								canMakeBlend
									? "border-accent/45 bg-accent-surface text-accent-fg hover:border-accent"
									: "cursor-not-allowed border-white/10 bg-black/10 text-fg-subtle",
							)}
						>
							Make
						</button>
					</Tooltip>
					{!activeBlend && !canMakeBlend ? (
						<span className="shrink-0 px-1 text-fg-subtle text-ui">
							Select 2+ objects
						</span>
					) : null}
					<div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
					<fieldset className="m-0 flex shrink-0 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
						<legend className="sr-only">Blend spacing mode</legend>
						{BLEND_SPACING_MODE_OPTIONS.map(({ kind, label }) => {
							const selected = activeSpacing.kind === kind;
							return (
								<Tooltip key={kind} label={label} side="top">
									<button
										type="button"
										aria-label={`Blend ${label}`}
										aria-pressed={selected}
										onClick={() => commitSpacingKind(kind)}
										className={cn(
											"flex h-7 min-w-12 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
											selected
												? "border-accent bg-accent-surface text-accent-fg"
												: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
										)}
									>
										{label}
									</button>
								</Tooltip>
							);
						})}
					</fieldset>
					<div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
					<label className="flex shrink-0 items-center gap-1 text-fg-muted text-ui">
						<span>{spacingInputLabel(activeSpacing)}</span>
						<div className="flex items-center overflow-hidden rounded-md border border-white/10 bg-black/10 transition focus-within:border-accent">
							<button
								type="button"
								aria-label="Decrease blend spacing"
								onClick={() =>
									commitSpacingValue(Math.max(1, spacingValue - spacingStep))
								}
								className="grid size-6 shrink-0 place-items-center text-fg-muted text-ui transition hover:bg-white/[0.08] hover:text-fg"
							>
								-
							</button>
							<input
								type="number"
								min={1}
								max={
									activeSpacing.kind === "specified-distance"
										? undefined
										: MAX_BLEND_STEPS
								}
								step={spacingStep}
								value={spacingValue}
								onChange={(event) => {
									const next = Number(event.currentTarget.value);
									if (!Number.isFinite(next)) return;
									commitSpacingValue(next);
								}}
								className="h-6 w-12 border-0 bg-transparent text-center text-fg text-ui outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
							/>
							<button
								type="button"
								aria-label="Increase blend spacing"
								onClick={() =>
									commitSpacingValue(
										Math.min(
											activeSpacing.kind === "specified-distance"
												? Number.POSITIVE_INFINITY
												: MAX_BLEND_STEPS,
											spacingValue + spacingStep,
										),
									)
								}
								className="grid size-6 shrink-0 place-items-center text-fg-muted text-ui transition hover:bg-white/[0.08] hover:text-fg"
							>
								+
							</button>
						</div>
					</label>
					<div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
					<fieldset className="m-0 flex shrink-0 gap-0.5 rounded-md border-0 bg-black/15 p-0.5">
						<legend className="sr-only">Blend orientation</legend>
						{BLEND_ORIENTATION_OPTIONS.map(({ orientation: mode, label }) => {
							const selected = activeOrientation === mode;
							return (
								<Tooltip key={mode} label={`Orient to ${label}`} side="top">
									<button
										type="button"
										aria-label={`Orient Blend to ${label}`}
										aria-pressed={selected}
										onClick={() => commitOrientation(mode)}
										className={cn(
											"flex h-7 min-w-11 items-center justify-center rounded-md border px-2 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
											selected
												? "border-accent bg-accent-surface text-accent-fg"
												: "border-white/10 bg-black/10 text-fg-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-fg",
										)}
									>
										{label}
									</button>
								</Tooltip>
							);
						})}
					</fieldset>
				</div>
				{activeBlend ? (
					<div className="flex max-w-full flex-wrap items-center justify-center gap-1">
						<Tooltip
							label={
								spineCandidate
									? "Use selected line, path, or shape as Blend spine"
									: "Select a Blend and one same-layer line, path, or shape to replace the spine."
							}
							side="top"
						>
							<button
								type="button"
								aria-label="Use selected line, path, or shape as Blend spine"
								aria-disabled={!spineCandidate}
								onClick={replaceSpine}
								className={blendOpClass(Boolean(spineCandidate))}
							>
								Spine
							</button>
						</Tooltip>
						<Tooltip label="Clear custom Blend spine" side="top">
							<button
								type="button"
								aria-label="Clear custom Blend spine"
								aria-disabled={!activeBlend?.blend?.spine}
								onClick={() => {
									if (!activeBlend?.blend?.spine) return;
									applySelectedBlendCommand(createClearBlendSpineCommand);
								}}
								className={blendOpClass(Boolean(activeBlend?.blend?.spine))}
							>
								Clear
							</button>
						</Tooltip>
						<div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
						<Tooltip label="Reverse Blend" side="top">
							<button
								type="button"
								aria-label="Reverse Blend"
								aria-disabled={!activeBlend}
								onClick={() =>
									applySelectedBlendCommand(createReverseBlendCommand)
								}
								className={blendOpClass(Boolean(activeBlend))}
							>
								Reverse
							</button>
						</Tooltip>
						<Tooltip label="Reverse Blend front to back" side="top">
							<button
								type="button"
								aria-label="Reverse Blend front to back"
								aria-disabled={!activeBlend}
								onClick={() =>
									applySelectedBlendCommand(createReverseBlendFrontBackCommand)
								}
								className={blendOpClass(Boolean(activeBlend))}
							>
								Front/Back
							</button>
						</Tooltip>
						<div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
						<Tooltip label="Expand Blend" side="top">
							<button
								type="button"
								aria-label="Expand Blend"
								aria-disabled={!activeBlend}
								onClick={() =>
									applySelectedBlendCommand(createExpandBlendCommand)
								}
								className={blendOpClass(Boolean(activeBlend))}
							>
								Expand
							</button>
						</Tooltip>
						<Tooltip label="Release Blend" side="top">
							<button
								type="button"
								aria-label="Release Blend"
								aria-disabled={!activeBlend}
								onClick={() =>
									applySelectedBlendCommand(createReleaseBlendCommand)
								}
								className={blendOpClass(Boolean(activeBlend))}
							>
								Release
							</button>
						</Tooltip>
					</div>
				) : null}
				{activeBlend && stopIds.length >= 2 ? (
					<fieldset className="m-0 flex max-w-full flex-wrap items-center gap-1 border-0 border-white/10 border-t pt-1">
						<legend className="sr-only">Blend stops</legend>
						<span className="px-1 text-fg-muted text-ui">Stops</span>
						{stopIds.map((stopId, index) => {
							const stopName =
								activeBlend.children?.find((child) => child.id === stopId)
									?.name ?? stopId;
							const canRemove = stopIds.length > 2;
							const canMoveEarlier = index > 0;
							const canMoveLater = index < stopIds.length - 1;
							return (
								<div
									key={stopId}
									className="flex items-center gap-0.5 rounded-md border border-white/10 bg-black/10 px-1 py-0.5"
								>
									<Tooltip label={stopName} side="top">
										<span className="min-w-3 text-center text-fg text-ui">
											{index + 1}
										</span>
									</Tooltip>
									<button
										type="button"
										aria-label={`Move blend stop ${index + 1} earlier`}
										aria-disabled={!canMoveEarlier}
										onClick={() => {
											if (canMoveEarlier) moveStop(stopId, index - 1);
										}}
										className={cn(
											"grid size-5 place-items-center rounded text-ui transition",
											canMoveEarlier
												? "text-fg-muted hover:bg-white/[0.08] hover:text-fg"
												: "cursor-not-allowed text-fg-subtle",
										)}
									>
										‹
									</button>
									<button
										type="button"
										aria-label={`Move blend stop ${index + 1} later`}
										aria-disabled={!canMoveLater}
										onClick={() => {
											if (canMoveLater) moveStop(stopId, index + 1);
										}}
										className={cn(
											"grid size-5 place-items-center rounded text-ui transition",
											canMoveLater
												? "text-fg-muted hover:bg-white/[0.08] hover:text-fg"
												: "cursor-not-allowed text-fg-subtle",
										)}
									>
										›
									</button>
									<Tooltip
										label={
											canRemove
												? `Remove blend stop ${index + 1} (keeps the object)`
												: "Blend keeps at least two stops; use Release instead."
										}
										side="top"
									>
										<button
											type="button"
											aria-label={`Remove blend stop ${index + 1}`}
											aria-disabled={!canRemove}
											onClick={() => {
												if (canRemove) removeStop(stopId);
											}}
											className={cn(
												"grid size-5 place-items-center rounded text-ui transition",
												canRemove
													? "text-fg-muted hover:bg-white/[0.08] hover:text-fg"
													: "cursor-not-allowed text-fg-subtle",
											)}
										>
											×
										</button>
									</Tooltip>
								</div>
							);
						})}
					</fieldset>
				) : null}
			</aside>
		</TooltipProvider>
	);
}

/**
 * Bottom-center tool option strip for active tools whose setup belongs beside
 * the ToolRail instead of over the selected artwork.
 */
export function ToolOptions() {
	const activeTool = useToolSelectionStore((state) => state.activeTool);
	if (activeTool === "shape-builder") return <ShapeBuilderOptions />;
	if (activeTool === "blend") return <BlendOptions />;
	if (activeTool === "pencil") return <PencilOptions />;
	if (activeTool !== "noise-gradient") return null;
	return <NoiseGradientOptions />;
}
