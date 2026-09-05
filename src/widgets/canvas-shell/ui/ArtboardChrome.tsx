/**
 * Presentational chrome for canvas artboards: the background fill, the
 * per-artboard frame/look content group, the floating name label, the
 * in-progress frame-draft preview, and the new-artboard preset picker — plus the
 * label-sizing helpers they share. Extracted verbatim from `CanvasShell` (see
 * `docs/canvas-shell-decomposition-plan.md`); the shared per-artboard document
 * resolver lives in `model/artboard-document`.
 */
import type { CSSProperties, ReactNode } from "react";
import { imagePaintHref } from "@/entities/scene/model/assets";
import { canvasPaintLayersForPaints } from "@/entities/scene/model/canvas-paint";
import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import { resolvePaints } from "@/entities/scene/model/style-resolve";
import type { Bounds, SceneDocument, Vec2 } from "@/entities/scene/model/types";
import {
	frameRectFromDraft,
	useFrameDraftStore,
} from "@/features/artboard/model/frame-draft-store";
import {
	ARTBOARD_CREATION_PRESETS,
	type ArtboardCreationPresetId,
} from "@/features/artboard/model/workflow";
import { type Camera, worldToScreen } from "@/features/viewport/model/camera";
import { artboardLookSvgIdSegment as svgIdSegment } from "@/widgets/canvas-shell/model/artboard-look-plan";
import { fullFrameLookRegion } from "./FrameLookDefs";
import { PaintDefs } from "./SvgSceneNode";

const ARTBOARD_LABEL_LIMIT = 36;
const ARTBOARD_LABEL_GAP_PX = 6;
const ARTBOARD_LABEL_MIN_WIDTH_PX = 96;
const ARTBOARD_LABEL_MAX_WIDTH_PX = 240;

const truncateLabel = (label: string): string =>
	label.length > ARTBOARD_LABEL_LIMIT
		? `${label.slice(0, ARTBOARD_LABEL_LIMIT - 1)}...`
		: label;

const artboardLabel = (
	artboard: NormalizedArtboard,
	options: { readonly current: boolean; readonly default: boolean },
): string => {
	const state = options.current ? "Current" : options.default ? "Default" : "";
	const name = truncateLabel(artboard.name);
	return state ? `${name} - ${state}` : name;
};

const artboardLabelStyle = (
	artboard: NormalizedArtboard,
	camera: Camera,
): CSSProperties => {
	const screen = worldToScreen(camera, artboard.position);
	const scale = camera.zoom / 100;
	return {
		left: screen.x,
		maxWidth: Math.min(
			ARTBOARD_LABEL_MAX_WIDTH_PX,
			Math.max(ARTBOARD_LABEL_MIN_WIDTH_PX, artboard.width * scale - 8),
		),
		top: screen.y,
		transform: `translateY(calc(-100% - ${ARTBOARD_LABEL_GAP_PX}px))`,
	};
};

export function ArtboardBackground({
	artboard,
	assets,
	slot,
	x = 0,
	y = 0,
	width = artboard.width,
	height = artboard.height,
	filter,
}: {
	readonly artboard: NormalizedArtboard;
	readonly assets: SceneDocument["assets"];
	readonly slot: string;
	readonly x?: number;
	readonly y?: number;
	readonly width?: number;
	readonly height?: number;
	readonly filter?: string;
}) {
	const layers = canvasPaintLayersForPaints(
		resolvePaints(artboard.fills, artboard.background),
		artboard.background,
		`artboard-${svgIdSegment(artboard.id)}-${slot}`,
		(paint) => imagePaintHref(paint, assets),
	);
	if (layers.length === 0) return null;
	return (
		<>
			<PaintDefs paints={layers.map((layer) => layer.paint)} />
			<g filter={filter}>
				{layers.map((layer) => (
					<rect
						key={layer.key}
						x={x}
						y={y}
						width={width}
						height={height}
						fill={layer.paint.value}
						fillOpacity={
							layer.paint.opacity === 1 ? undefined : layer.paint.opacity
						}
					/>
				))}
			</g>
		</>
	);
}

export function ArtboardChrome({
	artboard,
	assets,
	current,
	defaultArtboard,
	contentFilterIds,
	contentClipPathId,
	contentMaskId,
	contentRegion,
	contentPadding = 0,
	contentFilterBackground = true,
	filteredChildren,
	children,
}: {
	readonly artboard: NormalizedArtboard;
	readonly assets: SceneDocument["assets"];
	readonly current: boolean;
	readonly defaultArtboard: boolean;
	readonly contentFilterIds?: readonly string[];
	readonly contentClipPathId?: string;
	readonly contentMaskId?: string;
	readonly contentRegion?: Bounds;
	readonly contentPadding?: number;
	readonly contentFilterBackground?: boolean;
	readonly filteredChildren?: ReactNode;
	readonly children?: ReactNode;
}) {
	const stroke = current ? "#2ec4b6" : defaultArtboard ? "#191817" : "#b9b0a0";
	const strokeWidth = current ? 2.5 : defaultArtboard ? 1.5 : 1;
	const filterRegion =
		contentRegion ?? fullFrameLookRegion(artboard, contentPadding);
	const clipProps = contentClipPathId
		? { clipPath: `url(#${contentClipPathId})` }
		: {};
	const filteredContent =
		contentFilterIds && contentFilterIds.length > 0
			? contentFilterIds.reduceRight<ReactNode>(
					(acc, filterId) => (
						<g key={filterId} filter={`url(#${filterId})`}>
							{acc}
						</g>
					),
					<>
						{contentFilterBackground ? (
							<ArtboardBackground
								artboard={artboard}
								assets={assets}
								slot="filter-bg"
								x={filterRegion.x}
								y={filterRegion.y}
								width={filterRegion.width}
								height={filterRegion.height}
							/>
						) : null}
						{contentMaskId ? (filteredChildren ?? children) : children}
					</>,
				)
			: null;
	const maskedFilteredContent =
		filteredContent && contentMaskId ? (
			<g mask={`url(#${contentMaskId})`} pointerEvents="none">
				{filteredContent}
			</g>
		) : (
			filteredContent
		);
	const content = filteredContent ? (
		<>
			<ArtboardBackground
				artboard={artboard}
				assets={assets}
				slot="shadow"
				filter="url(#vecmo-artboard-shadow)"
			/>
			{contentMaskId ? (
				<g {...clipProps}>
					<ArtboardBackground
						artboard={artboard}
						assets={assets}
						slot="masked-bg"
					/>
					{children}
				</g>
			) : null}
			<g {...clipProps}>{maskedFilteredContent}</g>
		</>
	) : (
		<>
			<ArtboardBackground
				artboard={artboard}
				assets={assets}
				slot="shadow"
				filter="url(#vecmo-artboard-shadow)"
			/>
			{children}
		</>
	);
	return (
		<>
			{content}
			<rect
				width={artboard.width}
				height={artboard.height}
				fill="none"
				stroke={stroke}
				strokeWidth={strokeWidth}
				vectorEffect="non-scaling-stroke"
			/>
		</>
	);
}

export function ArtboardNameLabel({
	artboard,
	current,
	defaultArtboard,
	selected,
	interactive,
	onSelect,
	camera,
}: {
	readonly artboard: NormalizedArtboard;
	readonly current: boolean;
	readonly defaultArtboard: boolean;
	readonly selected: boolean;
	/**
	 * Whether the label selects its artboard on click. True only under the select
	 * tool; false under creation/edit/hand tools, where the label becomes
	 * `pointer-events-none` + non-focusable so a click near a frame edge falls
	 * through to the active tool instead of hijacking it into an artboard select.
	 */
	readonly interactive: boolean;
	readonly onSelect: () => void;
	readonly camera: Camera;
}) {
	const label = artboardLabel(artboard, { current, default: defaultArtboard });
	// The label is the primary (and only) canvas affordance for selecting an
	// artboard, so it is interactive ONLY under the select tool — otherwise an
	// incidental click near a frame edge would steal focus from the active tool.
	// The label stays rendered/legible under every tool; only its pointer/keyboard
	// reactivity is scoped. Selected wins over current for the active fill; current
	// is the lighter focus tint.
	const pointerClass = interactive
		? "pointer-events-auto cursor-pointer"
		: "pointer-events-none";
	const className = selected
		? `${pointerClass} absolute z-20 truncate rounded-[3px] border border-accent bg-accent px-1.5 py-0.5 font-semibold text-accent-fg text-ui leading-4 shadow-sm shadow-black/10`
		: current
			? `${pointerClass} absolute z-20 truncate rounded-[3px] border border-accent/70 bg-accent-fg/95 px-1.5 py-0.5 font-semibold text-accent-strong text-ui leading-4 shadow-sm shadow-black/10`
			: `${pointerClass} absolute z-20 truncate rounded-[3px] border border-fg-secondary/80 bg-surface-light/95 px-1.5 py-0.5 font-medium text-ink text-ui leading-4 shadow-sm shadow-black/10`;

	return (
		<button
			type="button"
			className={className}
			style={artboardLabelStyle(artboard, camera)}
			title={label}
			tabIndex={interactive ? undefined : -1}
			onPointerDown={(event) => {
				event.stopPropagation();
				onSelect();
			}}
		>
			{label}
		</button>
	);
}

/**
 * World-space preview for the Frame tool's in-progress drag. Artboards live in
 * pasteboard space, so this projects the shared draft rect (the exact rect that
 * will be committed) through the camera and floats a dashed outline plus a live
 * size readout — the size matters because artboards are named by their
 * dimensions. Rendered as a screen-projected div (like the artboard labels)
 * rather than inside the artboard-local overlay slot, which is anchored to a
 * single artboard.
 */
export function FrameDraftPreview({ camera }: { readonly camera: Camera }) {
	const draft = useFrameDraftStore((state) => state.draft);
	if (!draft) return null;
	const rect = frameRectFromDraft(draft);
	if (rect.width <= 0 || rect.height <= 0) return null;
	const scale = camera.zoom / 100;
	const screen = worldToScreen(camera, { x: rect.x, y: rect.y });
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute z-30 border-2 border-accent border-dashed"
			style={{
				left: screen.x,
				top: screen.y,
				width: rect.width * scale,
				height: rect.height * scale,
			}}
		>
			<span className="-translate-x-1/2 absolute top-full left-1/2 mt-1 whitespace-nowrap rounded-[3px] bg-accent px-1.5 py-0.5 font-medium text-accent-fg text-ui leading-4 shadow-black/10 shadow-sm">
				{Math.round(rect.width)} × {Math.round(rect.height)}
			</span>
		</div>
	);
}

/**
 * Size-preset menu floated at a Frame-tool click point. A plain click (no drag)
 * with the Frame tool opens this instead of doing nothing — Figma opens presets on
 * click. Choosing one creates a preset-sized artboard centered on the click. The
 * menu is projected to the click's screen position (like the artboard labels) and
 * is interactive (`pointer-events-auto`), so it stops pointer events from reaching
 * the canvas tool handler underneath.
 */
const PRESET_MENU_EST_WIDTH = 200;
const PRESET_MENU_EST_HEIGHT = 140;

export function FramePresetPicker({
	camera,
	viewportSize,
	onPick,
}: {
	readonly camera: Camera;
	readonly viewportSize: { readonly width: number; readonly height: number };
	readonly onPick: (presetId: ArtboardCreationPresetId, anchor: Vec2) => void;
}) {
	const presetAnchor = useFrameDraftStore((state) => state.presetAnchor);
	if (!presetAnchor) return null;
	const screen = worldToScreen(camera, presetAnchor);
	// Flip the menu back toward the canvas when a corner click would push it past
	// the viewport edge, mirroring how the contextual quick-action float clamps to
	// stay on-screen.
	const flipX = screen.x + PRESET_MENU_EST_WIDTH > viewportSize.width;
	const flipY = screen.y + PRESET_MENU_EST_HEIGHT > viewportSize.height;
	return (
		<div
			className="pointer-events-auto absolute z-30 flex flex-col gap-0.5 rounded-[6px] border border-surface/15 bg-surface-light/95 p-1 shadow-[0_10px_30px_rgba(25,24,23,0.18)] backdrop-blur"
			onPointerDown={(event) => event.stopPropagation()}
			style={{
				left: screen.x,
				top: screen.y,
				transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
			}}
		>
			{ARTBOARD_CREATION_PRESETS.map((preset) => (
				<button
					key={preset.id}
					type="button"
					className="flex items-center justify-between gap-4 rounded-[4px] px-2 py-1 text-left text-ink text-ui transition hover:bg-accent-fg"
					onClick={(event) => {
						event.stopPropagation();
						onPick(preset.id, presetAnchor);
					}}
				>
					<span className="font-medium">{preset.name}</span>
					<span className="text-fg-secondary tabular-nums">
						{preset.width} × {preset.height}
					</span>
				</button>
			))}
		</div>
	);
}
