import { Popover } from "@base-ui/react/popover";
import {
	ArrowSquareIn,
	ArrowSquareOut,
	ArrowsInSimple,
	ArrowsOutSimple,
	CaretDown,
	CaretUp,
	CornersIn,
	Crosshair,
	DotsSixVertical,
	Eye,
	EyeSlash,
	Graph,
	MagnifyingGlass,
	MagnifyingGlassMinus,
	MagnifyingGlassPlus,
	PencilSimple,
	Plus,
	Sparkle,
	Trash,
	X,
} from "@phosphor-icons/react";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	type ColoramaStop,
	type LookGraphEdge,
	type LookGraphEndpoint,
	type LookGraphNode,
	type LookGraphPort,
	type LookGraphPortDirection,
	lookGraphNodeLabel,
	RISO_BLEND_MODES,
} from "@/entities/scene/model/look-graph";
import { selectCurrentArtboard } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	analogFilmNodeLookStateForSelection,
	commitAnalogFilmNodeLook,
	commitRemoveAnalogFilmNodeLook,
} from "@/features/effect-authoring/model";
import {
	type AuthorableLookGraphNodeKind,
	beginFrameLookGraphNodeNumberGestureForTarget,
	commitConnectFrameLookGraphPortsForTarget,
	commitDisconnectFrameLookGraphInputForTarget,
	commitFrameLookGraphNodeFieldForTarget,
	commitFrameLookGraphNodeNumberForTarget,
	commitInsertFrameLookGraphNodeForTarget,
	commitInsertLookGraphStarterForTarget,
	commitInsertNoiseFieldBackgroundForTarget,
	commitInsertParticleDissolveNodeForTarget,
	commitMaterializeFrameLookGraphForTarget,
	commitMoveFrameLookGraphNodeForTarget,
	commitRemoveFrameLookGraphNodeForTarget,
	commitRemoveSelectionLookGraphRecipe,
	commitReorderFrameLookGraphNodeForTarget,
	commitSelectionLookGraphRecipe,
	commitToggleFrameLookGraphNodeForTarget,
	FRAME_LOOK_GRAPH_BLEND_MODES,
	FRAME_LOOK_GRAPH_NODE_KIND_LABELS,
	FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS,
	FRAME_LOOK_GRAPH_RENDERABLE_MASK_SOURCES,
	FRAME_LOOK_GRAPH_TEXTURE_MODE_OPTIONS,
	type FrameLookGraphConcreteTarget,
	type FrameLookGraphEditingNode,
	type FrameLookGraphInputConnection,
	type FrameLookGraphNodeNumberGesture,
	type FrameLookGraphNodeSliderSpec,
	type FrameLookGraphScope,
	type FrameLookGraphWorkspaceTarget,
	frameLookGraphEditingState,
	frameLookGraphEditingStateForTarget,
	frameLookGraphInputConnections,
	frameLookGraphNodeIsParticleTexture,
	frameLookGraphNodeReceivesRenderableMask,
	frameLookGraphParticleDirectionValue,
	frameLookGraphTextureModeForNode,
	type LookGraphStarterId,
	lookGraphOwnerForTarget,
	lookGraphTargetKey,
	type RenderableLookGraphMaskSource,
	type SelectionLookGraphRecipe,
	type SelectionLookGraphRecipeState,
	seedRisoPrintBloomForTarget,
	selectionLookGraphRecipeStateForSelection,
	selectionLookGraphWorkspaceTargetForSelection,
	useLookGraphWorkspaceTargetStore,
} from "@/features/look-authoring/model";
import {
	bareLookNodeParamKey,
	isLookNodeParamAnimated,
	lookNodeParamDisplayValue,
	lookNodeParamKeyframeState,
	toggleLookNodeParamKeyframe,
} from "@/features/look-authoring/model/look-node-keyframing";
import type { RisoPrintBloomDirection } from "@/features/look-authoring/model/riso-print-bloom";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { useSelectionStore } from "@/features/selection/model/store";
import { useLookGraphSelectionStore } from "@/shared/editor-chrome/model/look-graph-selection";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { usePanelResize } from "@/shared/editor-chrome/model/use-panel-resize";
import { cn } from "@/shared/lib/cn";
import { DEFAULT_LOOK_WORKSPACE_HEIGHT } from "@/shared/lib/look-workspace-height";
import { addFrameDiagnosticCount } from "@/shared/performance/frame-diagnostics";
import { ColorPicker } from "@/shared/ui/ColorPicker";
import { KeyframeDiamond } from "@/shared/ui/KeyframeDiamond";
import { PanelResizeHandle } from "@/shared/ui/PanelResizeHandle";
import { ScrubSlider } from "@/shared/ui/ScrubSlider";
import { useTargetWindow } from "@/shared/ui/target-window-context";

const NODE_WIDTH = 192;
const NODE_HEIGHT = 108;
const NODE_HEADER_HEIGHT = 28;
const NODE_X_GAP = 232;
const NODE_Y_GAP = 140;
const STAGE_PADDING = 28;
const GRAPH_ZOOM_MIN = 0.35;
const GRAPH_ZOOM_MAX = 1.4;
const GRAPH_ZOOM_STEP = 0.1;
const GRAPH_FIT_PADDING = 56;

/**
 * Shared chrome control recipes. Keeping focus/hit-target rules in one place makes
 * every interactive surface in the workspace (palette, node header, ports,
 * inspector) consistent — the AGENTS UI rule that selection/hover/focus states
 * stay visually distinct. Type stays the flat `text-ui` token; size grows via
 * height/padding, never a second font size.
 */
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70";
const ICON_BUTTON_BASE = `grid size-7 shrink-0 place-items-center rounded border text-ui transition disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING}`;
const ICON_BUTTON = `${ICON_BUTTON_BASE} border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-fg`;
const ICON_BUTTON_DANGER = `${ICON_BUTTON_BASE} border-danger/25 bg-danger-surface/45 text-danger-fg hover:border-danger/50`;

type StageSize = {
	readonly width: number;
	readonly height: number;
};

type GraphPoint = {
	readonly x: number;
	readonly y: number;
};

type DragState = {
	readonly nodeId: string;
	readonly pointerId: number;
	readonly zoom: number;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly originX: number;
	readonly originY: number;
	readonly moved: boolean;
};

type StagePanState = {
	readonly pointerId: number;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly scrollLeft: number;
	readonly scrollTop: number;
};

type NodeView = {
	readonly node: LookGraphNode;
	readonly editingNode: FrameLookGraphEditingNode | null;
	readonly x: number;
	readonly y: number;
	readonly serialIndex: number;
};

type WireEndpoint = LookGraphEndpoint & {
	readonly direction: LookGraphPortDirection;
};

type WireDraft = {
	readonly pointerId: number;
	readonly from: LookGraphEndpoint;
	readonly cursor: GraphPoint;
	readonly target: LookGraphEndpoint | null;
};

type GraphContentBounds = {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly centerX: number;
	readonly centerY: number;
};

const endpointOnly = (endpoint: WireEndpoint): LookGraphEndpoint => ({
	nodeId: endpoint.nodeId,
	portId: endpoint.portId,
});

const wireEndpointFromElement = (
	element: Element | null,
): WireEndpoint | null => {
	const target = element?.closest(
		"[data-look-port-node][data-look-port-id][data-look-port-direction]",
	);
	if (!(target instanceof HTMLElement)) return null;
	const { lookPortNode, lookPortId, lookPortDirection } = target.dataset;
	if (!lookPortNode || !lookPortId) return null;
	if (lookPortDirection !== "input" && lookPortDirection !== "output") {
		return null;
	}
	return {
		nodeId: lookPortNode,
		portId: lookPortId,
		direction: lookPortDirection,
	};
};

const nodeKindLabel = (node: LookGraphNode): string => {
	if (node.payload.kind !== "grain") {
		return node.label || lookGraphNodeLabel(node.kind);
	}
	const defaultish =
		node.label === "" ||
		node.label === "Grain" ||
		node.label === "Film Grain" ||
		node.label === "Particle Dissolve";
	if (!defaultish) return node.label;
	return frameLookGraphNodeIsParticleTexture(node)
		? "Particle Dissolve"
		: "Film Grain";
};

const nodeKindGroup = (node: LookGraphNode): string => {
	switch (node.kind) {
		case "source":
		case "output":
			return "Boundary";
		case "mask":
			return "Mask";
		case "composite":
			return "Composite";
		default:
			return "Effect";
	}
};

const roundedPosition = (value: number): number => Math.round(value * 10) / 10;

const clampScroll = (value: number, max: number): number =>
	Math.max(0, Math.min(max, value));

const clampGraphZoom = (value: number): number =>
	Math.max(GRAPH_ZOOM_MIN, Math.min(GRAPH_ZOOM_MAX, value));

const graphContentBounds = (
	views: readonly NodeView[],
): GraphContentBounds | null => {
	if (views.length === 0) return null;
	const left = Math.min(...views.map((view) => view.x));
	const top = Math.min(...views.map((view) => view.y));
	const right = Math.max(...views.map((view) => view.x + NODE_WIDTH));
	const bottom = Math.max(...views.map((view) => view.y + NODE_HEIGHT));
	return {
		left,
		top,
		right,
		bottom,
		centerX: (left + right) / 2,
		centerY: (top + bottom) / 2,
	};
};

function useStageSize() {
	const ref = useRef<HTMLDivElement | null>(null);
	const [size, setSize] = useState<StageSize>({ width: 960, height: 260 });
	// When detached, the host window is the popup, not the opener.
	const targetWindow = useTargetWindow();
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => {
			const rect = element.getBoundingClientRect();
			setSize({
				width: Math.max(1, Math.round(rect.width)),
				height: Math.max(1, Math.round(rect.height)),
			});
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		// A ResizeObserver created in the opener's realm is not guaranteed to fire
		// for an element living in the popup's document, so also re-measure on the
		// host window's resize. Docked, `targetWindow` is the opener — a harmless
		// extra re-measure on browser resize.
		targetWindow.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			targetWindow.removeEventListener("resize", update);
		};
	}, [targetWindow]);
	return { ref, size } as const;
}

function GraphSlider({
	target,
	commandTarget,
	nodeId,
	control,
	disabled,
}: {
	readonly target: FrameLookGraphConcreteTarget;
	readonly commandTarget: FrameLookGraphWorkspaceTarget;
	readonly nodeId: string;
	readonly control: FrameLookGraphNodeSliderSpec;
	readonly disabled: boolean;
}) {
	const gestureRef = useRef<FrameLookGraphNodeNumberGesture | null>(null);
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const recording = useTransportStore((state) => state.recording);
	const frame = Math.round(currentFrame);
	const keyframeContext = { recording, frame };
	const owner = lookGraphOwnerForTarget(target);
	// Show the keyframed value at the playhead when the param is animated, so the
	// slider tracks the timeline and a recorded edit starts from the right value.
	const value = owner
		? lookNodeParamDisplayValue(
				motion,
				owner,
				nodeId,
				bareLookNodeParamKey(control.path),
				control.value,
				frame,
			)
		: control.value;
	const keyframeState = owner
		? lookNodeParamKeyframeState(motion, owner, nodeId, control.path, frame)
		: { animatable: false, animated: false, hasKeyAtFrame: false };
	return (
		<ScrubSlider
			label={control.label}
			value={value}
			min={control.min}
			max={control.max}
			neutral={control.neutral}
			step={control.step}
			bipolar={control.kind === "bipolar"}
			unit={control.unit}
			disabled={disabled}
			action={
				keyframeState.animatable ? (
					<KeyframeDiamond
						keyed={keyframeState.hasKeyAtFrame}
						animated={keyframeState.animated}
						disabled={disabled}
						label={control.label}
						onToggle={() => {
							if (!owner) return;
							toggleLookNodeParamKeyframe(
								owner,
								nodeId,
								control.path,
								frame,
								value,
							);
						}}
					/>
				) : undefined
			}
			onScrubStart={() => {
				gestureRef.current = beginFrameLookGraphNodeNumberGestureForTarget(
					commandTarget,
					nodeId,
					control.path,
					keyframeContext,
				);
			}}
			onScrub={(next) => gestureRef.current?.update(next)}
			onScrubEnd={() => {
				gestureRef.current?.commit();
				gestureRef.current = null;
			}}
			onCommitValue={(next) =>
				commitFrameLookGraphNodeNumberForTarget(
					commandTarget,
					nodeId,
					control.path,
					next,
					keyframeContext,
				)
			}
		/>
	);
}

type LookGraphPaletteModeId = "looks" | "nodes";
type LookPaletteTargetId = "object" | "frame";

type LookRecipeCategoryId =
	| "film-optics"
	| "glow-light"
	| "texture-motion"
	| "print-poster"
	| "display-signal";

type LookGraphNodePaletteCategoryId =
	| "color-tone"
	| "light-focus"
	| "texture-source"
	| "distort-motion"
	| "topology";

type LookGraphNodePaletteEntry = {
	readonly kind: AuthorableLookGraphNodeKind;
	readonly category: LookGraphNodePaletteCategoryId;
	readonly aliases: readonly string[];
};

type LookRecipeVariant = {
	readonly target: LookPaletteTargetId;
	readonly summary: string;
};

type LookRecipeEntry =
	| {
			readonly action: "starter";
			readonly id: LookGraphStarterId;
			readonly label: string;
			readonly category: LookRecipeCategoryId;
			readonly variants: readonly LookRecipeVariant[];
			readonly aliases: readonly string[];
	  }
	| {
			readonly action: "noise-background" | "particle-dissolve";
			readonly id: "noise-background" | "particle-dissolve";
			readonly label: string;
			readonly category: LookRecipeCategoryId;
			readonly variants: readonly LookRecipeVariant[];
			readonly aliases: readonly string[];
	  }
	| {
			readonly action: "analog-film-selection";
			readonly id: "analog-film-selection";
			readonly label: string;
			readonly category: LookRecipeCategoryId;
			readonly variants: readonly LookRecipeVariant[];
			readonly aliases: readonly string[];
	  };

type LookGraphPaletteEntry = LookGraphNodePaletteEntry & {
	readonly entryKind: "node";
};

const LOOK_RECIPE_CATEGORIES = [
	{ id: "film-optics", label: "Film & Optics" },
	{ id: "glow-light", label: "Glow & Light" },
	{ id: "texture-motion", label: "Texture" },
	{ id: "print-poster", label: "Print & Poster" },
	{ id: "display-signal", label: "Display & Signal" },
] as const satisfies readonly {
	readonly id: LookRecipeCategoryId;
	readonly label: string;
}[];

type LookRecipeSection = {
	readonly id: LookRecipeCategoryId;
	readonly label: string;
	readonly entries: readonly LookRecipeEntry[];
};

type LookGraphPaletteSection = {
	readonly id: string;
	readonly label: string;
	readonly entries: readonly LookGraphPaletteEntry[];
};

const LOOK_RECIPE_ENTRIES = [
	{
		action: "analog-film-selection",
		id: "analog-film-selection",
		label: "Analog Film",
		category: "film-optics",
		variants: [
			{
				target: "object",
				summary: "Apply frame-level film optics clipped to object silhouettes.",
			},
		],
		aliases: ["film", "analog", "grain", "chromatic", "object", "selection"],
	},
	{
		action: "starter",
		id: "soft-glow",
		label: "Soft Glow",
		category: "glow-light",
		variants: [
			{
				target: "object",
				summary: "Apply a scoped glow graph to selected objects.",
			},
			{
				target: "frame",
				summary: "Insert a tuned Deep Glow chain as editable graph nodes.",
			},
		],
		aliases: ["bloom", "halo", "light", "recipe"],
	},
	{
		action: "noise-background",
		id: "noise-background",
		label: "Noise Background",
		category: "texture-motion",
		variants: [
			{
				target: "frame",
				summary: "Place procedural noise behind the current image chain.",
			},
		],
		aliases: ["background", "noise", "composite", "source", "recipe"],
	},
	{
		action: "particle-dissolve",
		id: "particle-dissolve",
		label: "Particle Dissolve",
		category: "texture-motion",
		variants: [
			{
				target: "object",
				summary: "Apply particle dissolve to selected object pixels.",
			},
			{
				target: "frame",
				summary: "Insert a particle Film Grain texture preset.",
			},
		],
		aliases: ["noise", "gradient", "particle", "dissolve", "spray"],
	},
	{
		action: "starter",
		id: "duotone-poster",
		label: "Duotone Poster",
		category: "print-poster",
		variants: [
			{
				target: "object",
				summary: "Apply poster color mapping to selected objects.",
			},
			{
				target: "frame",
				summary: "Build Color Map and Posterize nodes for poster color.",
			},
		],
		aliases: ["color", "gradient", "posterize", "bands", "recipe"],
	},
	{
		action: "starter",
		id: "flow-glow",
		label: "Flow Glow",
		category: "glow-light",
		variants: [
			{
				target: "object",
				summary: "Apply flow distortion and glow to selected objects.",
			},
			{
				target: "frame",
				summary: "Build Flow Distort, Lens, and Deep Glow as editable nodes.",
			},
		],
		aliases: ["distort", "motion", "lens", "bloom", "recipe"],
	},
	{
		action: "starter",
		id: "print-poster",
		label: "Print Poster",
		category: "print-poster",
		variants: [
			{
				target: "object",
				summary: "Apply print color, dither, and halftone to selected objects.",
			},
			{
				target: "frame",
				summary: "Build a color, dither, and halftone print chain.",
			},
		],
		aliases: [
			"dither",
			"halftone",
			"bayer",
			"newsprint",
			"risograph",
			"comic",
			"poster",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "led-glow",
		label: "LED Glow",
		category: "display-signal",
		variants: [
			{
				target: "object",
				summary: "Apply pixel-grid display glow to selected objects.",
			},
			{
				target: "frame",
				summary: "Build a Pixel Grid and Deep Glow display chain.",
			},
		],
		aliases: [
			"led",
			"pixel",
			"pixel grid",
			"signage",
			"display",
			"billboard",
			"glow",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "glyph-poster",
		label: "Glyph Poster",
		category: "print-poster",
		variants: [
			{
				target: "object",
				summary: "Apply glyph mosaic processing to selected objects.",
			},
			{
				target: "frame",
				summary: "Build a Color Map and ASCII Glyph poster chain.",
			},
		],
		aliases: [
			"ascii",
			"glyph",
			"terminal",
			"text art",
			"code",
			"mosaic",
			"poster",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "surveillance-feed",
		label: "Surveillance Feed",
		category: "display-signal",
		variants: [
			{
				target: "object",
				summary: "Apply scanline monitor processing to selected objects.",
			},
			{
				target: "frame",
				summary: "Build scanline and low-resolution monitor processing.",
			},
		],
		aliases: [
			"crt",
			"scanline",
			"surveillance",
			"security",
			"camera",
			"low-res",
			"monitor",
			"night vision",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "vhs-1985",
		label: "VHS 1985",
		category: "display-signal",
		variants: [
			{
				target: "object",
				summary:
					"Apply a VHS tape chroma/tracking/noise chain to selected objects.",
			},
			{
				target: "frame",
				summary: "Build a VHS Color, Tracking, Noise, and Film Grain chain.",
			},
		],
		aliases: [
			"vhs",
			"tape",
			"retro",
			"analog",
			"1985",
			"video",
			"nostalgia",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "vhs-ep",
		label: "VHS EP",
		category: "display-signal",
		variants: [
			{
				target: "object",
				summary:
					"Apply a heavy long-play VHS chain with field comb to selected objects.",
			},
			{
				target: "frame",
				summary:
					"Build a heavier VHS Color/Tracking/Noise chain with Interlace comb.",
			},
		],
		aliases: [
			"vhs",
			"tape",
			"ep",
			"long play",
			"worn",
			"degraded",
			"interlace",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "crt-monitor",
		label: "CRT Monitor",
		category: "display-signal",
		variants: [
			{
				target: "object",
				summary:
					"Apply scanline and CRT shadow-mask processing to selected objects.",
			},
			{
				target: "frame",
				summary: "Build a Scanline and CRT Display shadow-mask chain.",
			},
		],
		aliases: [
			"crt",
			"monitor",
			"tv",
			"shadow mask",
			"aperture grille",
			"curvature",
			"bezel",
			"recipe",
		],
	},
	{
		action: "starter",
		id: "broadcast-glitch",
		label: "Broadcast Glitch",
		category: "display-signal",
		variants: [
			{
				target: "object",
				summary: "Apply signal glitch and composite bleed to selected objects.",
			},
			{
				target: "frame",
				summary: "Build a Signal Glitch and VHS Color composite chain.",
			},
		],
		aliases: [
			"glitch",
			"broadcast",
			"signal",
			"sync",
			"tear",
			"channel shift",
			"recipe",
		],
	},
] as const satisfies readonly LookRecipeEntry[];

const LOOK_GRAPH_PALETTE_MODES = [
	{ id: "looks", label: "Looks" },
	{ id: "nodes", label: "Nodes" },
] as const satisfies readonly {
	readonly id: LookGraphPaletteModeId;
	readonly label: string;
}[];

const LOOK_GRAPH_PALETTE_CATEGORIES = [
	{ id: "color-tone", label: "Color & Tone" },
	{ id: "light-focus", label: "Light & Focus" },
	{ id: "texture-source", label: "Texture" },
	{ id: "distort-motion", label: "Distort & Motion" },
	{ id: "topology", label: "Build" },
] as const satisfies readonly {
	readonly id: LookGraphNodePaletteCategoryId;
	readonly label: string;
}[];

const LOOK_GRAPH_NODE_PALETTE = [
	{
		kind: "grade",
		category: "color-tone",
		aliases: ["exposure", "contrast", "saturation", "adjust"],
	},
	{
		kind: "color-map",
		category: "color-tone",
		aliases: ["gradient", "duotone", "tritone", "map", "palette", "look"],
	},
	{
		kind: "posterize",
		category: "color-tone",
		aliases: ["levels", "bands", "toon", "quantize"],
	},
	{
		kind: "find-edges",
		category: "color-tone",
		aliases: ["edge", "outline", "sobel", "detect"],
	},
	{
		kind: "colorama",
		category: "color-tone",
		aliases: [
			"ae colorama",
			"heat map",
			"heatmap",
			"ramp",
			"palette ramp",
			"cyclic",
			"iridescent",
			"chrome",
			"gradient map",
		],
	},
	{
		kind: "glow",
		category: "light-focus",
		aliases: ["bloom", "halo", "light", "legacy", "svg", "export"],
	},
	{
		kind: "deep-glow",
		category: "light-focus",
		aliases: ["bloom", "halo", "hdr", "fringe", "exposure", "light"],
	},
	{
		kind: "blur",
		category: "light-focus",
		aliases: ["soften", "defocus", "focus"],
	},
	{
		kind: "chromatic-fringe",
		category: "light-focus",
		aliases: ["aberration", "rgb", "split", "fringe", "chromatic"],
	},
	{
		kind: "grain",
		category: "texture-source",
		aliases: ["noise", "film", "texture", "grain"],
	},
	{
		kind: "scanline",
		category: "texture-source",
		aliases: ["crt", "tv", "retro", "lines", "display", "vhs", "pixel"],
	},
	{
		kind: "halftone",
		category: "texture-source",
		aliases: [
			"dots",
			"dot screen",
			"print",
			"newspaper",
			"comic",
			"manga",
			"risograph",
			"screen tone",
			"pixel",
		],
	},
	{
		kind: "pixel-grid",
		category: "texture-source",
		aliases: [
			"led",
			"matrix",
			"dot matrix",
			"pixel",
			"pixel grid",
			"display",
			"screen",
			"signage",
			"billboard",
			"diode",
			"low-res",
			"mosaic",
			"rgb",
		],
	},
	{
		kind: "ordered-dither",
		category: "texture-source",
		aliases: [
			"dither",
			"bayer",
			"ordered",
			"threshold",
			"matrix",
			"print",
			"retro",
			"pixel",
			"1-bit",
			"monochrome",
			"halftone",
		],
	},
	{
		kind: "ascii-glyph",
		category: "texture-source",
		aliases: [
			"ascii",
			"ascii art",
			"glyph",
			"character",
			"characters",
			"char",
			"symbol",
			"text art",
			"terminal",
			"ansi",
			"code",
			"type",
			"matrix",
			"mosaic",
			"low-res",
			"pixel",
			"retro",
			"poster",
		],
	},
	{
		kind: "block-mosaic",
		category: "texture-source",
		aliases: [
			"block",
			"blocks",
			"block mosaic",
			"tile",
			"tile mosaic",
			"mosaic",
			"brick",
			"bricks",
			"building blocks",
			"voxel",
			"voxel art",
			"low-res",
			"pixel",
			"poster",
			"cubist",
			"relief",
		],
	},
	{
		kind: "riso",
		category: "texture-source",
		aliases: [
			"riso",
			"risograph",
			"risograph print",
			"spot color",
			"spot ink",
			"screen print",
			"print",
			"dot screen",
			"dots",
			"newsprint",
			"poster",
		],
	},
	{
		kind: "noise-field",
		category: "texture-source",
		aliases: ["source", "fractal", "turbulence", "matte", "clouds", "static"],
	},
	{
		kind: "noise-source",
		category: "texture-source",
		aliases: ["gpu", "boil", "evolution", "procedural", "source", "animated"],
	},
	{
		kind: "displace",
		category: "distort-motion",
		aliases: ["turbulent", "warp", "offset", "distortion", "svg", "export"],
	},
	{
		kind: "warp",
		category: "distort-motion",
		aliases: ["bulge", "pinch", "twirl", "center", "warp"],
	},
	{
		kind: "lens",
		category: "distort-motion",
		aliases: ["sphere", "refraction", "magnify", "cc lens"],
	},
	{
		kind: "kaleidoscope",
		category: "distort-motion",
		aliases: ["mirror", "symmetry", "mandala", "segments"],
	},
	{
		kind: "flow",
		category: "distort-motion",
		aliases: ["turbulent", "curl", "evolution", "smoke", "flame", "displace"],
	},
	{
		kind: "wave-warp",
		category: "distort-motion",
		aliases: ["wave", "wave warp", "ripple", "warp", "distort", "travel"],
	},
	{
		kind: "bend-warp",
		category: "distort-motion",
		aliases: ["bend", "bend warp", "warp", "arc", "curve", "shear", "distort"],
	},
	{
		kind: "vhs-color",
		category: "texture-source",
		aliases: [
			"vhs",
			"tape",
			"chroma",
			"bleed",
			"composite",
			"s-video",
			"retro",
		],
	},
	{
		kind: "vhs-tracking",
		category: "texture-source",
		aliases: [
			"vhs",
			"tape",
			"tracking",
			"jitter",
			"wobble",
			"tear",
			"head switch",
			"retro",
		],
	},
	{
		kind: "vhs-noise",
		category: "texture-source",
		aliases: ["vhs", "tape", "snow", "dropout", "noise", "static", "retro"],
	},
	{
		kind: "crt-display",
		category: "texture-source",
		aliases: [
			"crt",
			"monitor",
			"tv",
			"shadow mask",
			"aperture grille",
			"curvature",
			"bezel",
			"vignette",
			"retro",
			"display",
		],
	},
	{
		kind: "signal-glitch",
		category: "distort-motion",
		aliases: [
			"glitch",
			"signal",
			"sync",
			"tear",
			"roll",
			"channel shift",
			"rgb split",
			"aberration",
			"broadcast",
		],
	},
	{
		kind: "interlace",
		category: "texture-source",
		aliases: [
			"interlace",
			"field",
			"comb",
			"scanline",
			"flicker",
			"video",
			"retro",
		],
	},
	{
		kind: "mask",
		category: "topology",
		aliases: ["matte", "alpha", "luma"],
	},
	{
		kind: "composite",
		category: "topology",
		aliases: ["blend", "mix", "merge", "layer"],
	},
] as const satisfies readonly LookGraphNodePaletteEntry[];

const LOOK_GRAPH_PALETTE_ENTRIES: readonly LookGraphPaletteEntry[] =
	LOOK_GRAPH_NODE_PALETTE.map((entry) => ({
		...entry,
		entryKind: "node" as const,
	}));

const paletteEntryLabel = (entry: LookGraphPaletteEntry): string =>
	FRAME_LOOK_GRAPH_NODE_KIND_LABELS[entry.kind];

const normalizePaletteSearch = (query: string): readonly string[] =>
	query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);

const lookRecipeCategoryLabel = (categoryId: LookRecipeCategoryId): string =>
	LOOK_RECIPE_CATEGORIES.find((category) => category.id === categoryId)
		?.label ?? categoryId;

const lookPaletteTargetLabel = (target: LookPaletteTargetId): string =>
	target === "object" ? "Object" : "Frame";

const lookRecipeVariantForTarget = (
	entry: LookRecipeEntry,
	target: LookPaletteTargetId,
): LookRecipeVariant | null =>
	entry.variants.find((variant) => variant.target === target) ?? null;

const selectionLookGraphRecipeForEntry = (
	entry: LookRecipeEntry,
): SelectionLookGraphRecipe | null => {
	switch (entry.action) {
		case "starter":
			return { action: "starter", id: entry.id, label: entry.label };
		case "particle-dissolve":
			return {
				action: "particle-dissolve",
				id: "particle-dissolve",
				label: entry.label,
			};
		default:
			return null;
	}
};

const lookRecipeSearchText = (entry: LookRecipeEntry): string =>
	[
		entry.label,
		entry.id,
		entry.action,
		lookRecipeCategoryLabel(entry.category),
		...entry.variants.map((variant) => variant.target),
		...entry.variants.map((variant) => variant.summary),
		...entry.aliases,
	]
		.join(" ")
		.toLocaleLowerCase();

const paletteEntrySearchText = (
	entry: LookGraphPaletteEntry,
	categoryLabel: string,
): string =>
	[paletteEntryLabel(entry), entry.kind, categoryLabel, ...entry.aliases]
		.join(" ")
		.toLocaleLowerCase();

const paletteCategoryLabel = (
	categoryId: LookGraphNodePaletteCategoryId,
): string =>
	LOOK_GRAPH_PALETTE_CATEGORIES.find((category) => category.id === categoryId)
		?.label ?? categoryId;

const maskSourceOptions = FRAME_LOOK_GRAPH_RENDERABLE_MASK_SOURCES.map(
	(value) => ({
		value,
		label:
			value === "source-alpha"
				? "Source alpha"
				: value === "previous-alpha"
					? "Previous alpha"
					: "Previous luma",
	}),
);

const isRenderableMaskSource = (
	value: string,
): value is RenderableLookGraphMaskSource =>
	FRAME_LOOK_GRAPH_RENDERABLE_MASK_SOURCES.includes(
		value as RenderableLookGraphMaskSource,
	);

const blendModeOptions = FRAME_LOOK_GRAPH_BLEND_MODES.map((value) => ({
	value,
	label: value
		.split("-")
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" "),
}));

const risoBlendModeOptions = RISO_BLEND_MODES.map((value) => ({
	value,
	label: value
		.split("-")
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" "),
}));

const warpModeOptions = [
	{ value: "radial" as const, label: "Bulge / Pinch" },
	{ value: "twirl" as const, label: "Twirl" },
];

const flowPatternOptions = [
	{ value: "turbulent" as const, label: "Turbulent" },
	{ value: "bulge" as const, label: "Bulge" },
	{ value: "twist" as const, label: "Twist" },
];

const noiseFieldTypeOptions = [
	{ value: "fractalNoise" as const, label: "Fractal (clouds)" },
	{ value: "turbulence" as const, label: "Turbulent (veins)" },
];

const orderedDitherModeOptions = [
	{ value: "luminance" as const, label: "Luminance" },
	{ value: "rgb" as const, label: "RGB channels" },
];

const orderedDitherPatternOptions = [
	{ value: "blue-noise" as const, label: "Organic" },
	{ value: "bayer" as const, label: "Bayer" },
];

const risoFieldModeOptions = [
	{ value: "uniform" as const, label: "Uniform" },
	{ value: "linear" as const, label: "Linear" },
	{ value: "radial" as const, label: "Radial" },
];

const waveWarpTypeOptions = [
	{ value: "sine" as const, label: "Sine" },
	{ value: "semicircle" as const, label: "Semicircle" },
];

const crtDisplayMaskTypeOptions = [
	{ value: "aperture" as const, label: "Aperture Grille" },
	{ value: "slot" as const, label: "Slot Mask" },
	{ value: "shadow" as const, label: "Shadow Mask" },
];

const coloramaInputPhaseOptions = [
	{ value: "luminance" as const, label: "Luminance" },
	{ value: "alpha" as const, label: "Alpha" },
];

function GraphSelectField<T extends string>({
	label,
	value,
	options,
	disabled,
	onCommit,
}: {
	readonly label: string;
	readonly value: T;
	readonly options: readonly { readonly value: T; readonly label: string }[];
	readonly disabled: boolean;
	readonly onCommit: (value: T) => void;
}) {
	return (
		<label className="block min-w-0">
			<span className="mb-0.5 block text-fg-subtle text-ui">{label}</span>
			<select
				value={value}
				disabled={disabled}
				onChange={(event) => onCommit(event.currentTarget.value as T)}
				className={cn(
					"h-7 w-full rounded border border-white/10 bg-black/25 px-1.5 text-fg text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45",
					FOCUS_RING,
				)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

function GraphToggleField({
	label,
	pressed,
	disabled,
	onToggle,
}: {
	readonly label: string;
	readonly pressed: boolean;
	readonly disabled: boolean;
	readonly onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			disabled={disabled}
			onClick={onToggle}
			className={cn(
				"flex h-7 min-w-0 items-center justify-center rounded border px-2 text-ui transition disabled:cursor-not-allowed disabled:opacity-45",
				FOCUS_RING,
				pressed
					? "border-accent bg-accent-surface text-accent-fg"
					: "border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-fg",
			)}
		>
			{label}
		</button>
	);
}

const COLOR_PICKER_PANEL_CLASS =
	"z-50 w-[232px] rounded-md border border-white/12 bg-surface-raised/98 p-2 text-fg text-ui shadow-2xl shadow-black/55 outline-none backdrop-blur-xl";

/**
 * Swatch trigger + popover {@link ColorPicker} for one Look graph node colour
 * field. Both the live drag tick and discrete commit route through the same
 * `commit` callback (a `commitFrameLookGraphNodeField` call): consecutive writes
 * share the field's stable coalesce key, so a drag previews live yet collapses to
 * one undo entry — the same path the mask/composite selects already use.
 */
function GraphColorField({
	label,
	value,
	resetKey,
	disabled,
	commit,
	onClear,
}: {
	readonly label: string;
	readonly value: string | null;
	readonly resetKey: string;
	readonly disabled: boolean;
	readonly commit: (hex: string) => void;
	readonly onClear?: () => void;
}) {
	const [open, setOpen] = useState(false);
	// Portal into THIS subtree's window so the picker pops inside the detached
	// window rather than the opener (base-ui defaults the portal to `<body>` of
	// the ambient document). Docked, this is the main document's body.
	const targetWindow = useTargetWindow();
	const swatch = value ?? "#000000";
	return (
		<div className="block min-w-0">
			<span className="mb-0.5 block text-fg-subtle text-ui">{label}</span>
			<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
				<Popover.Trigger
					type="button"
					disabled={disabled}
					aria-label={`${label} — open color picker`}
					title={label}
					className={cn(
						"flex h-7 w-full items-center gap-1.5 rounded border border-white/10 bg-black/25 px-1.5 text-fg text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45",
						FOCUS_RING,
					)}
				>
					<span
						className="size-3.5 shrink-0 rounded border border-white/20"
						style={{
							background: onClear && !value ? "transparent" : swatch,
						}}
					/>
					<span className="min-w-0 flex-1 truncate text-left font-mono text-fg-muted">
						{value ?? "None"}
					</span>
				</Popover.Trigger>
				<Popover.Portal container={targetWindow.document.body}>
					<Popover.Positioner
						align="start"
						side="bottom"
						sideOffset={6}
						collisionPadding={8}
						className="z-50 outline-none"
					>
						<Popover.Popup className={COLOR_PICKER_PANEL_CLASS}>
							<ColorPicker
								value={value}
								resetKey={resetKey}
								disabled={disabled}
								allowNone={Boolean(onClear)}
								onChange={(hex) => commit(hex)}
								onCommit={(hex) => {
									commit(hex);
									return true;
								}}
								onClear={
									onClear
										? () => {
												onClear();
												return true;
											}
										: undefined
								}
							/>
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
		</div>
	);
}

const portAnchor = (
	view: NodeView,
	endpoint: LookGraphEndpoint,
): GraphPoint => {
	const ports = view.node.inputs.some((port) => port.id === endpoint.portId)
		? view.node.inputs
		: view.node.outputs;
	const index = Math.max(
		0,
		ports.findIndex((port) => port.id === endpoint.portId),
	);
	const isInput = ports === view.node.inputs;
	// Distribute over the body region (below the drag-handle header) so a wire
	// endpoint lands on the port row, which is rendered with justify-evenly over
	// the same body height.
	const bodyHeight = NODE_HEIGHT - NODE_HEADER_HEIGHT;
	const step = bodyHeight / (ports.length + 1 || 2);
	return {
		x: view.x + (isInput ? 0 : NODE_WIDTH),
		y: view.y + NODE_HEADER_HEIGHT + step * (index + 1),
	};
};

function edgePath(
	edge: LookGraphEdge,
	viewsById: ReadonlyMap<string, NodeView>,
): string | null {
	const fromView = viewsById.get(edge.from.nodeId);
	const toView = viewsById.get(edge.to.nodeId);
	if (!fromView || !toView) return null;
	const from = portAnchor(fromView, edge.from);
	const to = portAnchor(toView, edge.to);
	const handle = Math.max(44, Math.abs(to.x - from.x) * 0.42);
	return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${
		to.x - handle
	} ${to.y}, ${to.x} ${to.y}`;
}

function draftEdgePath(
	draft: WireDraft,
	viewsById: ReadonlyMap<string, NodeView>,
): string | null {
	const fromView = viewsById.get(draft.from.nodeId);
	if (!fromView) return null;
	const from = portAnchor(fromView, draft.from);
	const targetView = draft.target ? viewsById.get(draft.target.nodeId) : null;
	const to =
		draft.target && targetView
			? portAnchor(targetView, draft.target)
			: draft.cursor;
	const handle = Math.max(44, Math.abs(to.x - from.x) * 0.42);
	return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${
		to.x - handle
	} ${to.y}, ${to.x} ${to.y}`;
}

function buildNodeViews({
	nodes,
	serialNodeIds,
	editingNodes,
	dragPreview,
}: {
	readonly nodes: readonly LookGraphNode[];
	readonly serialNodeIds: readonly string[];
	readonly editingNodes: readonly FrameLookGraphEditingNode[];
	readonly dragPreview: {
		readonly nodeId: string;
		readonly x: number;
		readonly y: number;
	} | null;
}): readonly NodeView[] {
	const editingById = new Map(editingNodes.map((node) => [node.id, node]));
	const serial =
		serialNodeIds.length > 0 ? serialNodeIds : nodes.map((node) => node.id);
	const orderedIds = [
		...serial,
		...nodes
			.map((node) => node.id)
			.filter((nodeId) => !serial.includes(nodeId)),
	];
	const order = new Map(orderedIds.map((nodeId, index) => [nodeId, index]));
	const serialSet = new Set(serial);
	return nodes
		.toSorted(
			(left, right) =>
				(order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
				(order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
		)
		.map((node) => {
			const orderedIndex = order.get(node.id) ?? 0;
			const serialIndex = serial.indexOf(node.id);
			const fallbackRow = serialSet.has(node.id)
				? 0
				: 1 + Math.floor(orderedIndex / 6);
			const fallbackColumn = serialSet.has(node.id)
				? Math.max(0, serialIndex)
				: orderedIndex % 6;
			const fallback = {
				x: STAGE_PADDING + fallbackColumn * NODE_X_GAP,
				y: STAGE_PADDING + 38 + fallbackRow * NODE_Y_GAP,
			};
			const preview =
				dragPreview?.nodeId === node.id
					? { x: dragPreview.x, y: dragPreview.y }
					: null;
			return {
				node,
				editingNode: editingById.get(node.id) ?? null,
				x: preview?.x ?? node.position?.x ?? fallback.x,
				y: preview?.y ?? node.position?.y ?? fallback.y,
				serialIndex,
			} satisfies NodeView;
		});
}

function PortList({
	nodeId,
	nodeLabel,
	ports,
	align,
	disabled,
	wireSourceNodeId,
	activeTarget,
	onWireStart,
	onWireMove,
	onWireEnd,
}: {
	readonly nodeId: string;
	readonly nodeLabel: string;
	readonly ports: readonly LookGraphPort[];
	readonly align: "left" | "right";
	readonly disabled: boolean;
	/**
	 * Node id sourcing the in-flight wire (null when idle). Input ports advertise
	 * themselves as drop targets while a wire is dragging — except those on the
	 * source node, which can never be a valid destination.
	 */
	readonly wireSourceNodeId: string | null;
	readonly activeTarget: LookGraphEndpoint | null;
	readonly onWireStart: (
		endpoint: LookGraphEndpoint,
		event: ReactPointerEvent<HTMLButtonElement>,
	) => void;
	readonly onWireMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	readonly onWireEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
	const direction: LookGraphPortDirection =
		align === "left" ? "input" : "output";
	const isOutput = direction === "output";
	if (ports.length === 0) {
		return <div className="min-w-0" aria-hidden="true" />;
	}
	return (
		<div
			className={cn(
				"flex h-full min-w-0 flex-col justify-evenly gap-1",
				align === "right" ? "items-end" : "items-start",
			)}
		>
			{ports.map((port) => {
				const isTarget =
					activeTarget?.nodeId === nodeId && activeTarget.portId === port.id;
				const droppable =
					wireSourceNodeId !== null && !isOutput && nodeId !== wireSourceNodeId;
				return (
					<button
						key={port.id}
						type="button"
						data-node-action="true"
						data-look-port-node={nodeId}
						data-look-port-id={port.id}
						data-look-port-direction={direction}
						disabled={disabled && isOutput}
						aria-disabled={isOutput ? disabled : undefined}
						aria-label={`${nodeLabel} ${port.name} ${port.valueType} ${direction} port`}
						tabIndex={isOutput && !disabled ? 0 : -1}
						className={cn(
							"flex h-6 max-w-24 items-center gap-1.5 rounded border px-1.5 font-mono text-fg-muted text-ui transition",
							FOCUS_RING,
							align === "right" && "flex-row-reverse",
							isTarget
								? "border-accent bg-accent-surface text-accent-fg"
								: droppable
									? "border-accent/45 bg-accent-surface/35 text-fg"
									: "border-white/10 bg-black/20",
							isOutput && !disabled
								? "cursor-crosshair hover:border-accent/60 hover:text-accent-fg"
								: "cursor-default",
							disabled && isOutput && "opacity-75",
						)}
						title={`${port.name}: ${port.valueType}`}
						onPointerDown={(event) => {
							if (!isOutput || disabled) return;
							event.stopPropagation();
							onWireStart({ nodeId, portId: port.id }, event);
						}}
						onPointerMove={(event) => {
							if (!isOutput) return;
							event.stopPropagation();
							onWireMove(event);
						}}
						onPointerUp={(event) => {
							if (!isOutput) return;
							event.stopPropagation();
							onWireEnd(event);
						}}
						onPointerCancel={(event) => {
							if (!isOutput) return;
							event.stopPropagation();
							onWireEnd(event);
						}}
						onLostPointerCapture={(event) => {
							if (!isOutput) return;
							event.stopPropagation();
							onWireEnd(event);
						}}
						onClick={(event) => event.stopPropagation()}
					>
						<span
							className={cn(
								"size-2 shrink-0 rounded-full transition",
								isTarget || droppable ? "bg-accent" : "bg-accent/70",
							)}
						/>
						<span className="truncate">{port.name}</span>
					</button>
				);
			})}
		</div>
	);
}

function GraphNodeCard({
	view,
	selected,
	elevated,
	disabled,
	graphActive,
	wireSourceNodeId,
	onSelect,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	activeWireTarget,
	onWireStart,
	onWireMove,
	onWireEnd,
	onToggle,
	onMoveUp,
	onMoveDown,
	onRemove,
}: {
	readonly view: NodeView;
	readonly selected: boolean;
	/** Lifted above siblings while dragging. */
	readonly elevated: boolean;
	readonly disabled: boolean;
	readonly graphActive: boolean;
	/** Node id sourcing the in-flight wire, or null. Drives input drop-target hints. */
	readonly wireSourceNodeId: string | null;
	readonly onSelect: () => void;
	readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly activeWireTarget: LookGraphEndpoint | null;
	readonly onWireStart: (
		endpoint: LookGraphEndpoint,
		event: ReactPointerEvent<HTMLButtonElement>,
	) => void;
	readonly onWireMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	readonly onWireEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	readonly onToggle: () => void;
	readonly onMoveUp: () => void;
	readonly onMoveDown: () => void;
	readonly onRemove: () => void;
}) {
	const canEdit = Boolean(view.editingNode);
	// Drag is the header's job (see onPointerDown on the handle below); graph-
	// inactive previews are read-only, so the grab affordance is suppressed.
	const draggable = graphActive;
	return (
		<div
			data-look-graph-node={view.node.id}
			className={cn(
				"absolute grid select-none grid-rows-[auto_1fr] rounded-md border bg-surface-raised/94 text-ui shadow-lg shadow-black/20 backdrop-blur-md transition-shadow",
				elevated ? "z-20 shadow-black/45 shadow-xl" : selected ? "z-10" : "",
				selected
					? "border-accent text-fg ring-1 ring-accent/40"
					: "border-white/10 text-fg-secondary hover:border-white/20",
				disabled && "opacity-70",
			)}
			style={{
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
				transform: `translate(${view.x}px, ${view.y}px)`,
			}}
			onPointerDown={() => onSelect()}
		>
			<div
				className={cn(
					"flex h-7 min-w-0 items-center gap-1 border-white/8 border-b px-1.5",
					draggable
						? elevated
							? "cursor-grabbing"
							: "cursor-grab"
						: "cursor-default",
				)}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onLostPointerCapture={onPointerUp}
			>
				<DotsSixVertical
					aria-hidden="true"
					size={12}
					weight="bold"
					className={cn(
						"shrink-0",
						draggable ? "text-fg-subtle" : "text-fg-subtle/40",
					)}
				/>
				<button
					type="button"
					aria-pressed={selected}
					onClick={(event) => {
						event.stopPropagation();
						onSelect();
					}}
					className={cn(
						"min-w-0 flex-1 truncate rounded text-left font-medium text-ui text-fg",
						FOCUS_RING,
					)}
					title={nodeKindLabel(view.node)}
				>
					{nodeKindLabel(view.node)}
				</button>
				{canEdit ? (
					<>
						<button
							type="button"
							data-node-action="true"
							aria-label={view.node.enabled ? "Disable node" : "Enable node"}
							disabled={disabled}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onToggle();
							}}
							className={cn(ICON_BUTTON, view.node.enabled && "text-accent-fg")}
						>
							{view.node.enabled ? (
								<Eye aria-hidden="true" size={13} />
							) : (
								<EyeSlash aria-hidden="true" size={13} />
							)}
						</button>
						<button
							type="button"
							data-node-action="true"
							aria-label="Move node up"
							disabled={disabled || !view.editingNode?.canMoveUp}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onMoveUp();
							}}
							className={ICON_BUTTON}
						>
							<CaretUp aria-hidden="true" size={13} />
						</button>
						<button
							type="button"
							data-node-action="true"
							aria-label="Move node down"
							disabled={disabled || !view.editingNode?.canMoveDown}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onMoveDown();
							}}
							className={ICON_BUTTON}
						>
							<CaretDown aria-hidden="true" size={13} />
						</button>
					</>
				) : null}
			</div>
			<div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1 px-1 py-1.5">
				<PortList
					nodeId={view.node.id}
					nodeLabel={nodeKindLabel(view.node)}
					ports={view.node.inputs}
					align="left"
					disabled={disabled}
					wireSourceNodeId={wireSourceNodeId}
					activeTarget={activeWireTarget}
					onWireStart={onWireStart}
					onWireMove={onWireMove}
					onWireEnd={onWireEnd}
				/>
				<div className="flex min-w-0 flex-col items-center justify-center gap-1.5">
					<span className="max-w-full truncate rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-fg-subtle">
						{nodeKindGroup(view.node)}
					</span>
					{graphActive && canEdit ? (
						<button
							type="button"
							data-node-action="true"
							aria-label="Remove node"
							disabled={disabled}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								onRemove();
							}}
							className={ICON_BUTTON_DANGER}
						>
							<Trash aria-hidden="true" size={13} />
						</button>
					) : null}
				</div>
				<PortList
					nodeId={view.node.id}
					nodeLabel={nodeKindLabel(view.node)}
					ports={view.node.outputs}
					align="right"
					disabled={disabled}
					wireSourceNodeId={wireSourceNodeId}
					activeTarget={activeWireTarget}
					onWireStart={onWireStart}
					onWireMove={onWireMove}
					onWireEnd={onWireEnd}
				/>
			</div>
		</div>
	);
}

const DEFAULT_PRINT_BLOOM_DURATION_FRAMES = 36;

/**
 * "Print Bloom" one-click reveal: seeds a `bloomProgress` 0→1 (develop-in) or 1→0
 * (dissolve-out) keyframe ramp of the entered duration, starting at frame 0. Pulled
 * into its own component (rather than inlined in the `riso` switch case) because it
 * owns the duration field's local state — a `useState` inside one arm of the
 * `GraphNodePayloadControls` switch would be a conditionally-called hook.
 */
function RisoPrintBloomControls({
	target,
	nodeId,
	disabled,
}: {
	readonly target: FrameLookGraphWorkspaceTarget;
	readonly nodeId: string;
	readonly disabled: boolean;
}) {
	const [durationFrames, setDurationFrames] = useState(
		DEFAULT_PRINT_BLOOM_DURATION_FRAMES,
	);
	const seed = (direction: RisoPrintBloomDirection) =>
		seedRisoPrintBloomForTarget(target, nodeId, direction, durationFrames, 0);
	return (
		<div className="grid grid-cols-1 gap-1 border-white/10 border-t pt-1.5">
			<span className="text-fg-subtle text-ui">Print Bloom</span>
			<label className="grid min-w-0 grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-1 rounded border border-white/10 bg-black/15 px-1.5 py-1">
				<span className="min-w-0 truncate text-fg-muted text-ui">
					Duration (frames)
				</span>
				<input
					type="number"
					min={1}
					step={1}
					value={durationFrames}
					disabled={disabled}
					onChange={(event) => {
						const next = Math.round(event.currentTarget.valueAsNumber);
						setDurationFrames(Number.isFinite(next) ? Math.max(1, next) : 1);
					}}
					className={cn(
						"h-6 min-w-0 rounded border border-white/10 bg-black/25 px-1 text-right text-fg text-ui tabular-nums outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45",
						FOCUS_RING,
					)}
					aria-label="Print Bloom duration in frames"
				/>
			</label>
			<div className="grid grid-cols-2 gap-1">
				<button
					type="button"
					disabled={disabled}
					onClick={() => seed("in")}
					title="Seed a 0→1 bloomProgress ramp so the riso dots develop in"
					className={cn(
						"flex h-7 min-w-0 items-center justify-center rounded border border-white/10 bg-black/15 px-2 text-fg-muted text-ui transition hover:border-accent/45 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
						FOCUS_RING,
					)}
				>
					Bloom in
				</button>
				<button
					type="button"
					disabled={disabled}
					onClick={() => seed("out")}
					title="Seed a 1→0 bloomProgress ramp so the riso dots dissolve out"
					className={cn(
						"flex h-7 min-w-0 items-center justify-center rounded border border-white/10 bg-black/15 px-2 text-fg-muted text-ui transition hover:border-accent/45 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
						FOCUS_RING,
					)}
				>
					Dissolve out
				</button>
			</div>
		</div>
	);
}

/**
 * Capacity mirrors the look-graph normalizer's own cap on a Colorama ramp
 * (`MAX_COLORAMA_STOPS` in `entities/scene/model/look-graph.ts`, module-
 * private). Kept here as a literal — the same hand-sync convention already
 * used for this exact number as `COLORAMA_STOP_CAPACITY` in
 * `src/shared/gpu-lens/surface.ts`'s GLSL array declaration.
 */
const COLORAMA_STOP_UI_CAPACITY = 12;

/**
 * Add/remove/edit rows for a Colorama ramp's stops (offset + colour) — the
 * smallest honest UI for an N-stop ramp, since this Look node has no
 * canvas-authored geometry to hand off to (unlike riso's ink field, whose
 * endpoints are canvas drag handles; see the TODO on the `riso` case below).
 * Every row edit rebuilds the whole array and commits it as one
 * `colorama.stops` field patch — full-array replacement, per the node's
 * command contract — so this component never validates ordering/hex format
 * itself; the look-graph normalizer re-sorts, clamps, and re-hexes on write
 * (`normalizeColoramaStops`).
 */
function ColoramaStopsEditor({
	target,
	nodeId,
	stops,
	disabled,
}: {
	readonly target: FrameLookGraphWorkspaceTarget;
	readonly nodeId: string;
	readonly stops: readonly ColoramaStop[];
	readonly disabled: boolean;
}) {
	const commitStops = (next: readonly ColoramaStop[]) =>
		commitFrameLookGraphNodeFieldForTarget(target, nodeId, {
			path: "colorama.stops",
			value: next,
		});
	return (
		<div className="grid grid-cols-1 gap-1">
			<span className="text-fg-subtle text-ui">Stops</span>
			{stops.map((stop, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: stops have no stable id — row identity is positional.
					key={index}
					className="grid min-w-0 grid-cols-[minmax(0,1fr)_3.5rem_auto] items-center gap-1"
				>
					<GraphColorField
						label={`Stop ${index + 1}`}
						value={stop.color}
						resetKey={`${nodeId}:stop:${index}`}
						disabled={disabled}
						commit={(hex) =>
							commitStops(
								stops.map((candidate, candidateIndex) =>
									candidateIndex === index
										? { ...candidate, color: hex }
										: candidate,
								),
							)
						}
					/>
					<input
						type="number"
						min={0}
						max={1}
						step={0.01}
						value={stop.offset}
						disabled={disabled}
						onChange={(event) => {
							const next = event.currentTarget.valueAsNumber;
							if (!Number.isFinite(next)) return;
							commitStops(
								stops.map((candidate, candidateIndex) =>
									candidateIndex === index
										? { ...candidate, offset: next }
										: candidate,
								),
							);
						}}
						aria-label={`Stop ${index + 1} offset`}
						className={cn(
							"h-7 min-w-0 rounded border border-white/10 bg-black/25 px-1 text-right text-fg text-ui tabular-nums outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45",
							FOCUS_RING,
						)}
					/>
					<button
						type="button"
						aria-label={`Remove stop ${index + 1}`}
						title="Remove stop"
						disabled={disabled || stops.length <= 1}
						onClick={() =>
							commitStops(
								stops.filter((_, candidateIndex) => candidateIndex !== index),
							)
						}
						className={cn(
							ICON_BUTTON_BASE,
							"border-white/10 bg-black/15 text-fg-muted hover:border-danger/40 hover:text-danger-fg",
						)}
					>
						<X aria-hidden="true" size={13} />
					</button>
				</div>
			))}
			<button
				type="button"
				disabled={disabled || stops.length >= COLORAMA_STOP_UI_CAPACITY}
				onClick={() =>
					commitStops([
						...stops,
						{
							offset: stops.length > 0 ? (stops.at(-1)?.offset ?? 1) : 0,
							color: "#ffffff",
						},
					])
				}
				className={cn(
					"flex h-7 min-w-0 items-center justify-center gap-1 rounded border border-white/10 bg-black/15 px-2 text-fg-muted text-ui transition hover:border-accent/45 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
					FOCUS_RING,
				)}
			>
				<Plus aria-hidden="true" size={13} />
				Add stop
			</button>
		</div>
	);
}

function GraphNodePayloadControls({
	target,
	ownerTarget,
	node,
	masked,
	disabled,
}: {
	readonly target: FrameLookGraphWorkspaceTarget;
	readonly ownerTarget: FrameLookGraphConcreteTarget;
	readonly node: LookGraphNode;
	readonly masked: boolean;
	readonly disabled: boolean;
}) {
	const motion = useMotionStore((state) => state.document);
	const payload = node.payload;
	const owner = lookGraphOwnerForTarget(ownerTarget);
	const radiusYAnimated =
		payload.kind === "blur" &&
		owner !== null &&
		isLookNodeParamAnimated(motion, owner, node.id, "radiusY");
	switch (payload.kind) {
		case "blur": {
			const linked = payload.radiusY === undefined && !radiusYAnimated;
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphToggleField
						label="Link X / Y"
						pressed={linked}
						disabled={disabled}
						onToggle={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "blur.radiusY",
								value: linked ? payload.radius : null,
							})
						}
					/>
					{radiusYAnimated ? (
						<span className="text-ui text-warn-fg">
							Relinking removes Y animation
						</span>
					) : null}
				</div>
			);
		}
		case "grain": {
			const particle = frameLookGraphNodeIsParticleTexture(node);
			const mode = frameLookGraphTextureModeForNode(node);
			const direction = frameLookGraphParticleDirectionValue(payload.texture);
			const directionOptions =
				direction === "custom"
					? FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS
					: FRAME_LOOK_GRAPH_PARTICLE_DIRECTION_OPTIONS.filter(
							(option) => option.value !== "custom",
						);
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Mode"
						value={mode}
						options={FRAME_LOOK_GRAPH_TEXTURE_MODE_OPTIONS}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "grain.mode",
								value,
							})
						}
					/>
					{particle ? (
						<>
							<GraphSelectField
								label="Field"
								value={direction}
								options={directionOptions}
								disabled={disabled}
								onCommit={(value) => {
									if (value === "custom") return;
									commitFrameLookGraphNodeFieldForTarget(target, node.id, {
										path: "grain.angle",
										value:
											value === "edge"
												? null
												: value === "mesh"
													? "mesh"
													: Number(value),
									});
								}}
							/>
							<span className="rounded border border-white/10 bg-black/15 px-1.5 py-1 text-fg-subtle">
								{masked ? "Masked frame pixels" : "Frame pixels"}
							</span>
						</>
					) : null}
				</div>
			);
		}
		case "mask": {
			const source = payload.source;
			const sourceOptions = isRenderableMaskSource(source)
				? maskSourceOptions
				: [
						{
							value: source,
							label: source === "none" ? "None" : "Deferred",
						},
						...maskSourceOptions,
					];
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Source"
						value={source}
						options={sourceOptions}
						disabled={disabled}
						onCommit={(value) => {
							if (!isRenderableMaskSource(value)) return;
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "mask.source",
								value,
							});
						}}
					/>
					<GraphToggleField
						label="Invert"
						pressed={Boolean(payload.invert)}
						disabled={disabled}
						onToggle={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "mask.invert",
								value: !payload.invert,
							})
						}
					/>
				</div>
			);
		}
		case "composite":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Blend"
						value={payload.blendMode}
						options={blendModeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "composite.blendMode",
								value,
							})
						}
					/>
				</div>
			);
		case "warp":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Mode"
						value={payload.mode}
						options={warpModeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "warp.mode",
								value,
							})
						}
					/>
				</div>
			);
		case "flow":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Pattern"
						value={payload.pattern}
						options={flowPatternOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "flow.pattern",
								value,
							})
						}
					/>
				</div>
			);
		case "wave-warp":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Wave Type"
						value={payload.waveType}
						options={waveWarpTypeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "wave-warp.waveType",
								value,
							})
						}
					/>
				</div>
			);
		case "crt-display":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Mask Type"
						value={payload.maskType}
						options={crtDisplayMaskTypeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "crt-display.maskType",
								value,
							})
						}
					/>
				</div>
			);
		case "lens":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphToggleField
						label="Clip to rim (hide outside the lens)"
						pressed={payload.clipToRim}
						disabled={disabled}
						onToggle={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "lens.clipToRim",
								value: !payload.clipToRim,
							})
						}
					/>
				</div>
			);
		case "noise-field":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Type"
						value={payload.type}
						options={noiseFieldTypeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "noise-field.type",
								value,
							})
						}
					/>
				</div>
			);
		case "ordered-dither":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Mode"
						value={payload.mode}
						options={orderedDitherModeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "ordered-dither.mode",
								value,
							})
						}
					/>
					<GraphSelectField
						label="Pattern"
						value={payload.pattern}
						options={orderedDitherPatternOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "ordered-dither.pattern",
								value,
							})
						}
					/>
					<GraphColorField
						label="Ink"
						value={payload.ink}
						resetKey={`${node.id}:ink`}
						disabled={disabled}
						commit={(hex) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "ordered-dither.ink",
								value: hex,
							})
						}
					/>
					<GraphColorField
						label="Paper"
						value={payload.paper}
						resetKey={`${node.id}:paper`}
						disabled={disabled}
						commit={(hex) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "ordered-dither.paper",
								value: hex,
							})
						}
					/>
				</div>
			);
		case "ascii-glyph":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphToggleField
						label="Invert density ramp"
						pressed={payload.invert}
						disabled={disabled}
						onToggle={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "ascii-glyph.invert",
								value: !payload.invert,
							})
						}
					/>
				</div>
			);
		case "deep-glow":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Blend"
						value={payload.blendMode}
						options={blendModeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "deep-glow.blendMode",
								value,
							})
						}
					/>
				</div>
			);
		case "find-edges":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphToggleField
						label="Invert (dark edges on white)"
						pressed={payload.invert}
						disabled={disabled}
						onToggle={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "find-edges.invert",
								value: !payload.invert,
							})
						}
					/>
				</div>
			);
		case "colorama":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Input Phase"
						value={payload.inputPhase}
						options={coloramaInputPhaseOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "colorama.inputPhase",
								value,
							})
						}
					/>
					<ColoramaStopsEditor
						target={target}
						nodeId={node.id}
						stops={payload.stops}
						disabled={disabled}
					/>
				</div>
			);
		case "color-map":
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphColorField
						label="Shadows"
						value={payload.shadow}
						resetKey={`${node.id}:shadow`}
						disabled={disabled}
						commit={(hex) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "color-map.shadow",
								value: hex,
							})
						}
					/>
					<GraphColorField
						label="Midtones"
						value={payload.midtone}
						resetKey={`${node.id}:midtone`}
						disabled={disabled}
						commit={(hex) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "color-map.midtone",
								value: hex,
							})
						}
						onClear={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "color-map.midtone",
								value: null,
							})
						}
					/>
					<GraphColorField
						label="Highlights"
						value={payload.highlight}
						resetKey={`${node.id}:highlight`}
						disabled={disabled}
						commit={(hex) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "color-map.highlight",
								value: hex,
							})
						}
					/>
				</div>
			);
		case "riso":
			// TODO: canvas field handles — the field's linear/radial endpoints
			// (x1/y1/x2/y2/cx/cy/radius) are authored via drag handles on the canvas,
			// not here; only the mode/invert toggle live in the Inspector for now.
			return (
				<div className="grid grid-cols-1 gap-1">
					<GraphSelectField
						label="Blend"
						value={payload.blendMode}
						options={risoBlendModeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "riso.blendMode",
								value,
							})
						}
					/>
					<GraphSelectField
						label="Field"
						value={payload.field.mode}
						options={risoFieldModeOptions}
						disabled={disabled}
						onCommit={(value) =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "riso.fieldMode",
								value,
							})
						}
					/>
					<GraphToggleField
						label="Invert field"
						pressed={payload.field.invert}
						disabled={disabled}
						onToggle={() =>
							commitFrameLookGraphNodeFieldForTarget(target, node.id, {
								path: "riso.fieldInvert",
								value: !payload.field.invert,
							})
						}
					/>
					<RisoPrintBloomControls
						target={target}
						nodeId={node.id}
						disabled={disabled}
					/>
				</div>
			);
		default:
			return null;
	}
}

function GraphInputConnections({
	connections,
	disabled,
	onConnect,
	onDisconnect,
}: {
	readonly connections: readonly FrameLookGraphInputConnection[];
	readonly disabled: boolean;
	readonly onConnect: (from: LookGraphEndpoint, to: LookGraphEndpoint) => void;
	readonly onDisconnect: (endpoint: LookGraphEndpoint) => void;
}) {
	if (connections.length === 0) return null;
	return (
		<div className="grid grid-cols-1 gap-1">
			<p className="font-medium text-fg-muted">Inputs</p>
			{connections.map((connection) => {
				return (
					<div
						key={connection.endpoint.portId}
						className="flex min-w-0 items-center gap-1 rounded border border-white/10 bg-black/15 px-1.5 py-1.5"
					>
						<span className="shrink-0 font-mono text-fg-subtle">
							{connection.name}:{connection.valueType}
						</span>
						<span className="min-w-0 flex-1 truncate text-fg-muted">
							{connection.incoming?.label ?? "Open"}
						</span>
						{connection.sourceOptions.length > 0 ? (
							<select
								aria-label={`Connect ${connection.name}`}
								disabled={disabled}
								value=""
								onChange={(event) => {
									const option = connection.sourceOptions.find(
										(candidate) => candidate.id === event.currentTarget.value,
									);
									if (!option) return;
									onConnect(option.endpoint, connection.endpoint);
								}}
								className={cn(
									"h-7 max-w-28 rounded border border-white/10 bg-black/25 px-1.5 text-fg-muted text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45",
									FOCUS_RING,
								)}
							>
								<option value="">
									{connection.incoming ? "Replace" : "Connect"}
								</option>
								{connection.sourceOptions.map((option) => (
									<option key={option.id} value={option.id}>
										{option.replaces ? "Replace " : ""}
										{option.label}
									</option>
								))}
							</select>
						) : null}
						{connection.incoming ? (
							<button
								type="button"
								aria-label={`Disconnect ${connection.name}`}
								title={`Disconnect ${connection.name}`}
								disabled={disabled}
								onClick={() => onDisconnect(connection.endpoint)}
								className={cn(
									ICON_BUTTON_BASE,
									"border-white/10 bg-black/15 text-fg-muted hover:border-danger/40 hover:text-danger-fg",
								)}
							>
								<X aria-hidden="true" size={13} />
							</button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

export function LookWorkspacePanel({
	detached = false,
}: {
	/**
	 * Rendered into a separate OS window (see {@link DetachedWindow}) instead of
	 * the docked bottom strip. Fills the popup, drops the docked-only chrome (the
	 * height resize handle and the expand/compact toggle are meaningless when the
	 * OS window owns the size), and flips the detach button into a re-dock button.
	 */
	readonly detached?: boolean;
} = {}) {
	addFrameDiagnosticCount("react.LookWorkspacePanel.commit");
	const document = useSceneStore((state) => state.document);
	const closeWorkspace = useEditorChromeStore(
		(state) => state.toggleLookWorkspace,
	);
	const detachLookWorkspace = useEditorChromeStore(
		(state) => state.detachLookWorkspace,
	);
	const dockLookWorkspace = useEditorChromeStore(
		(state) => state.dockLookWorkspace,
	);
	const lookWorkspaceHeight = useEditorChromeStore(
		(state) => state.lookWorkspaceHeight,
	);
	const toggleLookWorkspaceExpanded = useEditorChromeStore(
		(state) => state.toggleLookWorkspaceExpanded,
	);
	const targetOverride = useLookGraphWorkspaceTargetStore(
		(state) => state.targetOverride,
	);
	const setTargetOverride = useLookGraphWorkspaceTargetStore(
		(state) => state.setTargetOverride,
	);
	const clearTargetOverride = useLookGraphWorkspaceTargetStore(
		(state) => state.clearTargetOverride,
	);
	const selectedSceneNodeIds = useSelectionStore(
		(selection) => selection.nodeIds,
	);
	const artboard = selectCurrentArtboard(document);
	const [scope, setScope] = useState<FrameLookGraphScope>("current-artboard");
	const [paletteSearch, setPaletteSearch] = useState("");
	const [activePaletteMode, setActivePaletteMode] =
		useState<LookGraphPaletteModeId>("looks");
	const selectedSceneNodeCount = selectedSceneNodeIds.length;
	const contextualPaletteTarget: LookPaletteTargetId =
		selectedSceneNodeCount > 0 ? "object" : "frame";
	const [activePaletteTarget, setActivePaletteTarget] =
		useState<LookPaletteTargetId>(contextualPaletteTarget);
	const workspaceTarget = useMemo<FrameLookGraphWorkspaceTarget>(
		() => targetOverride ?? { scope, artboardId: artboard.id },
		[targetOverride, scope, artboard.id],
	);
	const state = frameLookGraphEditingStateForTarget(document, workspaceTarget);
	const defaultState = frameLookGraphEditingStateForTarget(document, {
		scope,
		artboardId: artboard.id,
	});
	const activeState =
		state ??
		defaultState ??
		frameLookGraphEditingState(document, scope, artboard.id);
	const targetMissing = state === null;
	const commandTarget = targetMissing ? workspaceTarget : activeState.target;
	const scopedWorkspaceActive = activeState.target.scope === "scoped-overlay";
	const selectionOwnerKey = lookGraphTargetKey(activeState.target);
	const selectedNodeId = useLookGraphSelectionStore((selection) =>
		selection.selectedOwnerKey === selectionOwnerKey
			? selection.selectedNodeId
			: null,
	);
	const setSelectedNodeForOwner = useLookGraphSelectionStore(
		(selection) => selection.setSelectedNodeForOwner,
	);
	const { ref: stageViewportRef, size } = useStageSize();
	const lookWorkspaceResize = usePanelResize("look-workspace");
	const graphStageRef = useRef<HTMLDivElement | null>(null);
	const dragStateRef = useRef<DragState | null>(null);
	const stagePanStateRef = useRef<StagePanState | null>(null);
	const wireDraftRef = useRef<WireDraft | null>(null);
	const [dragPreview, setDragPreview] = useState<{
		readonly nodeId: string;
		readonly x: number;
		readonly y: number;
	} | null>(null);
	const [stagePanning, setStagePanning] = useState(false);
	const [wireDraft, setWireDraft] = useState<WireDraft | null>(null);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
	const [wireStatus, setWireStatus] = useState<string | null>(null);
	const [graphZoom, setGraphZoom] = useState(1);
	const [pendingCenterNodeId, setPendingCenterNodeId] = useState<string | null>(
		null,
	);

	useEffect(() => {
		setActivePaletteTarget(contextualPaletteTarget);
	}, [contextualPaletteTarget]);

	useEffect(() => {
		if (!targetOverride) return;
		if (!targetMissing) return;
		clearTargetOverride();
	}, [clearTargetOverride, targetMissing, targetOverride]);

	useEffect(() => {
		const graphNodeIds = new Set(
			activeState.graph?.nodes.map((node) => node.id) ?? [],
		);
		if (selectedNodeId && graphNodeIds.has(selectedNodeId)) return;
		const fallback =
			activeState.nodes[0]?.id ??
			activeState.graph?.nodes.find((node) => node.kind === "source")?.id ??
			activeState.graph?.nodes[0]?.id ??
			null;
		if (fallback !== selectedNodeId) {
			setSelectedNodeForOwner(selectionOwnerKey, fallback);
		}
	}, [
		selectedNodeId,
		selectionOwnerKey,
		setSelectedNodeForOwner,
		activeState.graph,
		activeState.nodes,
	]);

	useEffect(() => {
		if (!selectedEdgeId) return;
		const edgeIds = new Set(
			activeState.graph?.edges.map((edge) => edge.id) ?? [],
		);
		if (!edgeIds.has(selectedEdgeId)) setSelectedEdgeId(null);
	}, [selectedEdgeId, activeState.graph]);

	const views = useMemo(
		() =>
			activeState.graph
				? buildNodeViews({
						nodes: activeState.graph.nodes,
						serialNodeIds: activeState.serialNodeIds,
						editingNodes: activeState.nodes,
						dragPreview,
					})
				: [],
		[
			activeState.graph,
			activeState.nodes,
			activeState.serialNodeIds,
			dragPreview,
		],
	);
	const viewsById = useMemo(
		() => new Map(views.map((view) => [view.node.id, view])),
		[views],
	);
	const contentBounds = useMemo(() => graphContentBounds(views), [views]);
	const graphWidth = Math.max(
		size.width,
		...views.map((view) => view.x + NODE_WIDTH + STAGE_PADDING),
	);
	const graphHeight = Math.max(
		size.height,
		...views.map((view) => view.y + NODE_HEIGHT + STAGE_PADDING),
	);
	const scaledGraphWidth = Math.ceil(graphWidth * graphZoom);
	const scaledGraphHeight = Math.ceil(graphHeight * graphZoom);
	const selectedView =
		(selectedNodeId ? viewsById.get(selectedNodeId) : null) ?? null;
	const selectedEdge =
		activeState.graph?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
	const selectedSerialEdgeAnchorNodeId = (() => {
		if (!selectedEdge) return null;
		const fromIndex = activeState.serialNodeIds.indexOf(
			selectedEdge.from.nodeId,
		);
		if (fromIndex < 0) return null;
		return activeState.serialNodeIds[fromIndex + 1] === selectedEdge.to.nodeId
			? selectedEdge.from.nodeId
			: null;
	})();
	const selectedEditingNode = selectedView?.editingNode ?? null;
	const selectedInputConnections = useMemo(
		() =>
			activeState.graph && selectedNodeId
				? frameLookGraphInputConnections(activeState.graph, selectedNodeId)
				: [],
		[activeState.graph, selectedNodeId],
	);
	const selectedNodeReceivesRenderableMask =
		activeState.graph && selectedNodeId
			? frameLookGraphNodeReceivesRenderableMask(
					activeState.graph,
					selectedNodeId,
				)
			: false;
	const graphControlsDisabled = targetMissing || !activeState.graphActive;
	const status = activeState.graphActive
		? activeState.targetStoresGraph
			? "Graph"
			: "Inherited"
		: activeState.graphPresent
			? "Projected"
			: "Empty";
	const lookWorkspaceExpanded =
		lookWorkspaceHeight > DEFAULT_LOOK_WORKSPACE_HEIGHT + 80;
	const paletteSearchTerms = useMemo(
		() => normalizePaletteSearch(paletteSearch),
		[paletteSearch],
	);
	const paletteSearchActive = paletteSearchTerms.length > 0;
	const lookRecipeMatches = useMemo(
		() =>
			(entry: LookRecipeEntry): boolean => {
				if (!paletteSearchActive) return true;
				const searchText = lookRecipeSearchText(entry);
				return paletteSearchTerms.every((term) => searchText.includes(term));
			},
		[paletteSearchActive, paletteSearchTerms],
	);
	const paletteEntryMatches = useMemo(
		() =>
			(entry: LookGraphPaletteEntry): boolean => {
				if (!paletteSearchActive) return true;
				const categoryLabel = paletteCategoryLabel(entry.category);
				const searchText = paletteEntrySearchText(entry, categoryLabel);
				return paletteSearchTerms.every((term) => searchText.includes(term));
			},
		[paletteSearchActive, paletteSearchTerms],
	);
	const lookVisibleEntries = useMemo(
		() =>
			activePaletteMode === "looks"
				? LOOK_RECIPE_ENTRIES.filter(
						(entry) =>
							lookRecipeVariantForTarget(entry, activePaletteTarget) !== null &&
							lookRecipeMatches(entry),
					)
				: [],
		[activePaletteMode, activePaletteTarget, lookRecipeMatches],
	);
	const lookVisibleSections = useMemo<readonly LookRecipeSection[]>(
		() =>
			LOOK_RECIPE_CATEGORIES.map((category) => ({
				...category,
				entries: lookVisibleEntries.filter(
					(entry) => entry.category === category.id,
				),
			})).filter((section) => section.entries.length > 0),
		[lookVisibleEntries],
	);
	const lookVisibleCount = lookVisibleEntries.length;
	const nodeVisibleEntries = useMemo(
		() =>
			activePaletteMode === "nodes"
				? LOOK_GRAPH_PALETTE_ENTRIES.filter(paletteEntryMatches)
				: [],
		[activePaletteMode, paletteEntryMatches],
	);
	const nodeVisibleSections = useMemo<
		readonly LookGraphPaletteSection[]
	>(() => {
		return LOOK_GRAPH_PALETTE_CATEGORIES.flatMap((category) => {
			const entries = nodeVisibleEntries.filter(
				(entry) => entry.category === category.id,
			);
			return entries.length > 0 ? [{ ...category, entries }] : [];
		});
	}, [nodeVisibleEntries]);
	const nodeVisibleCount = nodeVisibleEntries.length;
	const allLookCount = useMemo(
		() =>
			LOOK_RECIPE_ENTRIES.filter(
				(entry) =>
					lookRecipeVariantForTarget(entry, activePaletteTarget) !== null &&
					lookRecipeMatches(entry),
			).length,
		[activePaletteTarget, lookRecipeMatches],
	);
	const allNodeCount = useMemo(
		() => LOOK_GRAPH_PALETTE_ENTRIES.filter(paletteEntryMatches).length,
		[paletteEntryMatches],
	);
	const paletteVisibleCount =
		activePaletteMode === "looks" ? lookVisibleCount : nodeVisibleCount;
	const paletteModeCount = (modeId: LookGraphPaletteModeId): number =>
		modeId === "looks" ? allLookCount : allNodeCount;
	const analogFilmSelectionState = useMemo(
		() => analogFilmNodeLookStateForSelection(document, selectedSceneNodeIds),
		[document, selectedSceneNodeIds],
	);
	const selectionLookGraphRecipeStates = useMemo(() => {
		const states = new Map<string, SelectionLookGraphRecipeState>();
		for (const entry of LOOK_RECIPE_ENTRIES) {
			const recipe = selectionLookGraphRecipeForEntry(entry);
			if (!recipe) continue;
			states.set(
				entry.id,
				selectionLookGraphRecipeStateForSelection(
					document,
					selectedSceneNodeIds,
					recipe,
				),
			);
		}
		return states;
	}, [document, selectedSceneNodeIds]);

	const viewportCenterPoint = (): GraphPoint | null => {
		const viewport = stageViewportRef.current;
		if (!viewport) return null;
		return {
			x: (viewport.scrollLeft + viewport.clientWidth / 2) / graphZoom,
			y: (viewport.scrollTop + viewport.clientHeight / 2) / graphZoom,
		};
	};

	const scrollStageToPoint = (
		point: GraphPoint,
		options?: {
			readonly zoom?: number;
			readonly behavior?: ScrollBehavior;
		},
	): void => {
		const viewport = stageViewportRef.current;
		if (!viewport) return;
		const zoom = options?.zoom ?? graphZoom;
		const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
		const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
		viewport.scrollTo({
			left: clampScroll(point.x * zoom - viewport.clientWidth / 2, maxLeft),
			top: clampScroll(point.y * zoom - viewport.clientHeight / 2, maxTop),
			behavior: options?.behavior ?? "smooth",
		});
	};

	const applyGraphZoom = (value: number): void => {
		const nextZoom = clampGraphZoom(roundedPosition(value));
		const center = viewportCenterPoint();
		setGraphZoom(nextZoom);
		if (!center) return;
		requestAnimationFrame(() =>
			scrollStageToPoint(center, { zoom: nextZoom, behavior: "auto" }),
		);
	};

	const fitGraphToView = (): void => {
		const viewport = stageViewportRef.current;
		if (!viewport || !contentBounds) return;
		const contentWidth =
			contentBounds.right - contentBounds.left + GRAPH_FIT_PADDING * 2;
		const contentHeight =
			contentBounds.bottom - contentBounds.top + GRAPH_FIT_PADDING * 2;
		const nextZoom = clampGraphZoom(
			Math.min(
				1,
				viewport.clientWidth / Math.max(1, contentWidth),
				viewport.clientHeight / Math.max(1, contentHeight),
			),
		);
		setGraphZoom(nextZoom);
		requestAnimationFrame(() =>
			scrollStageToPoint(
				{
					x: contentBounds.centerX,
					y: contentBounds.centerY,
				},
				{ zoom: nextZoom, behavior: "smooth" },
			),
		);
	};

	const centerGraphInView = (): void => {
		if (!contentBounds) return;
		scrollStageToPoint({
			x: contentBounds.centerX,
			y: contentBounds.centerY,
		});
	};

	const centerSelectedNodeInView = (): void => {
		if (!selectedView) return;
		scrollStageToPoint({
			x: selectedView.x + NODE_WIDTH / 2,
			y: selectedView.y + NODE_HEIGHT / 2,
		});
	};

	useEffect(() => {
		if (!pendingCenterNodeId) return;
		const view = viewsById.get(pendingCenterNodeId);
		if (!view) return;
		const frame = requestAnimationFrame(() => {
			const viewport = stageViewportRef.current;
			if (!viewport) return;
			const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
			const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
			viewport.scrollTo({
				left: clampScroll(
					(view.x + NODE_WIDTH / 2) * graphZoom - viewport.clientWidth / 2,
					maxLeft,
				),
				top: clampScroll(
					(view.y + NODE_HEIGHT / 2) * graphZoom - viewport.clientHeight / 2,
					maxTop,
				),
				behavior: "smooth",
			});
			setPendingCenterNodeId(null);
		});
		return () => cancelAnimationFrame(frame);
	}, [graphZoom, pendingCenterNodeId, viewsById, stageViewportRef.current]);

	const graphPointFromEvent = (
		event: ReactPointerEvent<Element>,
	): GraphPoint => {
		const rect = graphStageRef.current?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: roundedPosition((event.clientX - rect.left) / graphZoom),
			y: roundedPosition((event.clientY - rect.top) / graphZoom),
		};
	};

	const inputEndpointFromEvent = (
		event: ReactPointerEvent<Element>,
	): LookGraphEndpoint | null => {
		// Cards are freely positioned and can overlap, and the dragged source card
		// can sit on top of a target's input. Walk the full hit stack (topmost →
		// bottommost) instead of trusting the single topmost element, and never
		// resolve to the wire's own source node (no self-loops, no source-card
		// shadowing the real target underneath).
		const sourceNodeId = wireDraftRef.current?.from.nodeId ?? null;
		// Hit-test in the EVENT's own document, not `globalThis.document`: when the
		// workspace is detached into a separate window the panel lives in the popup's
		// document, so the opener's `document` would resolve the wrong (or no)
		// elements for these popup-space coordinates. Docked, `ownerDocument` is the
		// main document, so this is output-equivalent there.
		const hitDocument =
			event.currentTarget.ownerDocument ?? globalThis.document;
		const stack =
			hitDocument?.elementsFromPoint(event.clientX, event.clientY) ?? [];
		for (const element of stack) {
			const endpoint = wireEndpointFromElement(element);
			if (endpoint?.direction !== "input") continue;
			if (sourceNodeId && endpoint.nodeId === sourceNodeId) continue;
			return endpointOnly(endpoint);
		}
		return null;
	};

	const applyConnectResult = (
		result: ReturnType<typeof commitConnectFrameLookGraphPortsForTarget>,
		targetNodeId: string,
	): void => {
		switch (result.kind) {
			case "applied":
				setSelectedEdgeId(null);
				setSelectedNodeForOwner(selectionOwnerKey, targetNodeId);
				setWireStatus("Connected");
				return;
			case "unchanged":
				setWireStatus("Already connected");
				return;
			case "missing-graph":
				setWireStatus("Edit as graph first");
				return;
			case "invalid":
				setWireStatus(result.message);
				return;
			default: {
				const exhaustive: never = result;
				void exhaustive;
				return;
			}
		}
	};

	const selectNode = (nodeId: string): void => {
		setSelectedEdgeId(null);
		setSelectedNodeForOwner(selectionOwnerKey, nodeId);
		setWireStatus(null);
	};

	const connectInput = (
		from: LookGraphEndpoint,
		to: LookGraphEndpoint,
	): void => {
		applyConnectResult(
			commitConnectFrameLookGraphPortsForTarget(commandTarget, from, to),
			to.nodeId,
		);
	};

	const selectEdge = (edge: LookGraphEdge): void => {
		setSelectedEdgeId(edge.id);
		setWireStatus("Edge selected");
	};

	const disconnectSelectedEdge = (): void => {
		if (!selectedEdge) return;
		commitDisconnectFrameLookGraphInputForTarget(
			commandTarget,
			selectedEdge.to,
		);
		setSelectedEdgeId(null);
		setWireStatus("Disconnected");
	};

	const insertPaletteEntry = (entry: LookGraphPaletteEntry): void => {
		const applied = commitInsertFrameLookGraphNodeForTarget(
			commandTarget,
			entry.kind,
			{
				insertAfterNodeId:
					selectedSerialEdgeAnchorNodeId ?? selectedView?.node.id ?? null,
			},
		);
		if (!applied) return;
		const selection = useLookGraphSelectionStore.getState();
		if (selection.selectedOwnerKey !== selectionOwnerKey) return;
		if (!selection.selectedNodeId) return;
		setPendingCenterNodeId(selection.selectedNodeId);
	};

	const insertLookRecipeEntry = (entry: LookRecipeEntry): void => {
		const variant = lookRecipeVariantForTarget(entry, activePaletteTarget);
		if (!variant) return;
		if (activePaletteTarget === "object") {
			if (selectedSceneNodeCount === 0) return;
			if (entry.action === "analog-film-selection") {
				if (analogFilmSelectionState.status === "all") {
					commitRemoveAnalogFilmNodeLook(selectedSceneNodeIds);
					return;
				}
				commitAnalogFilmNodeLook(selectedSceneNodeIds);
				return;
			}
			const selectionRecipe = selectionLookGraphRecipeForEntry(entry);
			if (!selectionRecipe) return;
			const selectionRecipeState = selectionLookGraphRecipeStates.get(entry.id);
			if (selectionRecipeState?.status === "all") {
				commitRemoveSelectionLookGraphRecipe(
					selectedSceneNodeIds,
					selectionRecipe,
				);
				return;
			}
			if (
				!commitSelectionLookGraphRecipe(selectedSceneNodeIds, selectionRecipe)
			) {
				return;
			}
			const nextTarget = selectionLookGraphWorkspaceTargetForSelection(
				useSceneStore.getState().document,
				selectedSceneNodeIds,
				selectionRecipe,
			);
			if (nextTarget) setTargetOverride(nextTarget);
			return;
		}
		const frameCommandTarget: FrameLookGraphWorkspaceTarget = {
			scope,
			artboardId: artboard.id,
		};
		const insertAfterNodeId = scopedWorkspaceActive
			? null
			: (selectedSerialEdgeAnchorNodeId ?? selectedView?.node.id ?? null);
		const applied =
			entry.action === "starter"
				? commitInsertLookGraphStarterForTarget(frameCommandTarget, entry.id, {
						insertAfterNodeId,
					})
				: entry.action === "particle-dissolve"
					? commitInsertParticleDissolveNodeForTarget(frameCommandTarget, {
							insertAfterNodeId,
						})
					: commitInsertNoiseFieldBackgroundForTarget(frameCommandTarget);
		if (!applied) return;
		if (targetOverride) clearTargetOverride();
		const frameState = frameLookGraphEditingStateForTarget(
			useSceneStore.getState().document,
			frameCommandTarget,
		);
		if (!frameState) return;
		const frameSelectionOwnerKey = lookGraphTargetKey(frameState.target);
		const selection = useLookGraphSelectionStore.getState();
		if (selection.selectedOwnerKey !== frameSelectionOwnerKey) return;
		if (!selection.selectedNodeId) return;
		setPendingCenterNodeId(selection.selectedNodeId);
	};

	const openObjectLookGraphEntry = (entry: LookRecipeEntry): void => {
		const selectionRecipe = selectionLookGraphRecipeForEntry(entry);
		if (!selectionRecipe) return;
		const nextTarget = selectionLookGraphWorkspaceTargetForSelection(
			document,
			selectedSceneNodeIds,
			selectionRecipe,
		);
		if (!nextTarget) return;
		setActivePaletteTarget("object");
		setTargetOverride(nextTarget);
	};

	const lookRecipeInsertTitle = (
		entry: LookRecipeEntry,
		variant: LookRecipeVariant,
	): string => {
		const selectionGraphState =
			variant.target === "object" && entry.action !== "analog-film-selection"
				? selectionLookGraphRecipeStates.get(entry.id)
				: undefined;
		if (variant.target === "object") {
			if (selectedSceneNodeCount === 0) {
				return `${entry.label} - Select an object to apply this Object Look.`;
			}
			const status =
				entry.action === "analog-film-selection"
					? analogFilmSelectionState.status
					: selectionGraphState?.status;
			if (status === "all") {
				return `${entry.label} - Object: Remove this Object Look from the selected objects.`;
			}
			if (selectionGraphState && !selectionGraphState.canApply) {
				return `${entry.label} - Selected objects already have object graph Looks. Open or remove those object Looks first.`;
			}
		}
		const applied =
			variant.target === "object" &&
			(entry.action === "analog-film-selection"
				? analogFilmSelectionState.status !== "none"
				: selectionGraphState
					? selectionGraphState.status !== "none"
					: false);
		const blockedCount = selectionGraphState?.blockedCount ?? 0;
		const parts = [
			`${entry.label} - ${lookPaletteTargetLabel(variant.target)}:`,
			variant.summary,
			...(applied ? ["Selected objects already have this Look."] : []),
			...(blockedCount > 0
				? [
						`${blockedCount} selected object(s) already have another object graph Look.`,
					]
				: []),
		];
		return parts.join(" ");
	};

	const paletteInsertTitle = (
		entry: LookGraphPaletteEntry,
		label: string,
	): string => {
		const target = selectedSerialEdgeAnchorNodeId
			? "Insert on selected wire"
			: selectedView
				? "Insert after selected node"
				: "Insert before output";
		const aliases =
			entry.aliases.length > 0 ? ` - ${entry.aliases.join(", ")}` : "";
		return `${label} - ${target}${aliases}`;
	};

	const beginWire = (
		from: LookGraphEndpoint,
		event: ReactPointerEvent<HTMLButtonElement>,
	): void => {
		if (event.button !== 0 || graphControlsDisabled) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		selectNode(from.nodeId);
		setWireStatus(null);
		const nextDraft: WireDraft = {
			pointerId: event.pointerId,
			from,
			cursor: graphPointFromEvent(event),
			target: inputEndpointFromEvent(event),
		};
		wireDraftRef.current = nextDraft;
		setWireDraft(nextDraft);
	};

	const updateWire = (event: ReactPointerEvent<HTMLButtonElement>): void => {
		const draft = wireDraftRef.current;
		if (!draft || draft.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		const nextDraft: WireDraft = {
			...draft,
			cursor: graphPointFromEvent(event),
			target: inputEndpointFromEvent(event),
		};
		wireDraftRef.current = nextDraft;
		setWireDraft(nextDraft);
	};

	const endWire = (event: ReactPointerEvent<HTMLButtonElement>): void => {
		const draft = wireDraftRef.current;
		if (!draft || draft.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		wireDraftRef.current = null;
		setWireDraft(null);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		// pointercancel / lostpointercapture = the gesture was torn down (not a
		// deliberate drop), so abort without connecting.
		if (event.type === "pointercancel" || event.type === "lostpointercapture") {
			return;
		}
		const target = inputEndpointFromEvent(event);
		if (!target) {
			setWireStatus("Drop on an input port");
			return;
		}
		connectInput(draft.from, target);
	};

	const beginDrag =
		(view: NodeView) => (event: ReactPointerEvent<HTMLDivElement>) => {
			if (
				event.button !== 0 ||
				!activeState.graphActive ||
				// `Element`, not `HTMLElement`: the header action buttons render
				// Phosphor `<svg>` glyphs (SVGElement), so an HTMLElement prefilter
				// short-circuits to false when the press lands on the icon itself and
				// the drag would start from the toggle/reorder/remove control.
				(event.target instanceof Element &&
					event.target.closest("[data-node-action='true']"))
			) {
				return;
			}
			event.currentTarget.setPointerCapture(event.pointerId);
			selectNode(view.node.id);
			dragStateRef.current = {
				nodeId: view.node.id,
				pointerId: event.pointerId,
				zoom: graphZoom,
				startClientX: event.clientX,
				startClientY: event.clientY,
				originX: view.x,
				originY: view.y,
				moved: false,
			};
		};

	const updateDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const drag = dragStateRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const clientDx = event.clientX - drag.startClientX;
		const clientDy = event.clientY - drag.startClientY;
		const dx = clientDx / drag.zoom;
		const dy = clientDy / drag.zoom;
		const moved = drag.moved || Math.abs(clientDx) + Math.abs(clientDy) > 2;
		dragStateRef.current = { ...drag, moved };
		setDragPreview({
			nodeId: drag.nodeId,
			x: Math.max(STAGE_PADDING, roundedPosition(drag.originX + dx)),
			y: Math.max(STAGE_PADDING, roundedPosition(drag.originY + dy)),
		});
	};

	const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const drag = dragStateRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const clientDx = event.clientX - drag.startClientX;
		const clientDy = event.clientY - drag.startClientY;
		const dx = clientDx / drag.zoom;
		const dy = clientDy / drag.zoom;
		const moved = drag.moved || Math.abs(clientDx) + Math.abs(clientDy) > 2;
		const position = {
			x: Math.max(STAGE_PADDING, roundedPosition(drag.originX + dx)),
			y: Math.max(STAGE_PADDING, roundedPosition(drag.originY + dy)),
		};
		dragStateRef.current = null;
		setDragPreview(null);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		// A torn-down gesture (capture stolen, node unmounted) must not commit a
		// move at a stale last position; only a real pointerup persists.
		if (!moved || event.type === "lostpointercapture") return;
		commitMoveFrameLookGraphNodeForTarget(commandTarget, drag.nodeId, position);
	};

	const beginStagePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (event.button !== 0) return;
		if (
			event.target instanceof Element &&
			event.target.closest(
				"[data-look-graph-node],button,input,select,textarea,[role='separator']",
			)
		) {
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		stagePanStateRef.current = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			scrollLeft: event.currentTarget.scrollLeft,
			scrollTop: event.currentTarget.scrollTop,
		};
		setStagePanning(true);
	};

	const updateStagePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const pan = stagePanStateRef.current;
		if (!pan || pan.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.currentTarget.scrollLeft =
			pan.scrollLeft - (event.clientX - pan.startClientX);
		event.currentTarget.scrollTop =
			pan.scrollTop - (event.clientY - pan.startClientY);
	};

	const endStagePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const pan = stagePanStateRef.current;
		if (!pan || pan.pointerId !== event.pointerId) return;
		stagePanStateRef.current = null;
		setStagePanning(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	return (
		<section
			className={cn(
				"relative flex min-w-0 flex-col overflow-hidden border-white/10",
				detached
					? // Fill the popup window: solid backdrop (no canvas behind it), no
						// floating card chrome, OS window owns the size.
						"h-full w-full bg-surface-raised"
					: "look-workspace-panel rounded-md border bg-surface-raised/92 shadow-2xl shadow-black/35 backdrop-blur-xl",
			)}
		>
			<header className="flex h-9 shrink-0 items-center gap-1 border-white/10 border-b px-2 text-ui">
				<Graph aria-hidden="true" size={14} className="text-accent-fg" />
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-fg">Look Graph</p>
					<p className="truncate text-fg-subtle">{artboard.name}</p>
				</div>
				<div className="flex items-center gap-1">
					{scopedWorkspaceActive ? (
						<button
							type="button"
							aria-pressed="true"
							title="Editing an Object Look graph"
							className={cn(
								"h-7 rounded border border-accent bg-accent-surface px-2.5 text-accent-fg text-ui transition",
								FOCUS_RING,
							)}
						>
							Object
						</button>
					) : null}
					{(["current-artboard", "scene"] as const).map((nextScope) => (
						<button
							key={nextScope}
							type="button"
							aria-pressed={!scopedWorkspaceActive && scope === nextScope}
							onClick={() => {
								clearTargetOverride();
								setScope(nextScope);
								setActivePaletteTarget("frame");
							}}
							className={cn(
								"h-7 rounded border px-2.5 text-ui transition",
								FOCUS_RING,
								!scopedWorkspaceActive && scope === nextScope
									? "border-accent bg-accent-surface text-accent-fg"
									: "border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-fg",
							)}
						>
							{nextScope === "scene" ? "Scene" : "Frame"}
						</button>
					))}
					<span className="rounded border border-white/10 bg-black/15 px-2 py-1 font-mono text-fg-subtle">
						{status}
					</span>
					{wireStatus ? (
						<span className="max-w-32 truncate rounded border border-white/10 bg-black/15 px-2 py-1 text-fg-subtle">
							{wireStatus}
						</span>
					) : null}
					<button
						type="button"
						aria-label="Center graph"
						title="Center graph"
						disabled={!contentBounds}
						onClick={centerGraphInView}
						className={ICON_BUTTON}
					>
						<Graph aria-hidden="true" size={13} />
					</button>
					<button
						type="button"
						aria-label="Center selected node"
						title="Center selected node"
						disabled={!selectedView}
						onClick={centerSelectedNodeInView}
						className={ICON_BUTTON}
					>
						<Crosshair aria-hidden="true" size={13} />
					</button>
					<button
						type="button"
						aria-label="Zoom graph out"
						title="Zoom graph out"
						disabled={graphZoom <= GRAPH_ZOOM_MIN}
						onClick={() => applyGraphZoom(graphZoom - GRAPH_ZOOM_STEP)}
						className={ICON_BUTTON}
					>
						<MagnifyingGlassMinus aria-hidden="true" size={13} />
					</button>
					<button
						type="button"
						aria-label="Reset graph zoom"
						title="Reset graph zoom"
						onClick={() => applyGraphZoom(1)}
						className={cn(
							"h-7 min-w-10 rounded border border-white/10 bg-black/15 px-1.5 font-mono text-fg-muted text-ui transition hover:border-accent/45 hover:text-fg",
							FOCUS_RING,
						)}
					>
						{Math.round(graphZoom * 100)}%
					</button>
					<button
						type="button"
						aria-label="Zoom graph in"
						title="Zoom graph in"
						disabled={graphZoom >= GRAPH_ZOOM_MAX}
						onClick={() => applyGraphZoom(graphZoom + GRAPH_ZOOM_STEP)}
						className={ICON_BUTTON}
					>
						<MagnifyingGlassPlus aria-hidden="true" size={13} />
					</button>
					<button
						type="button"
						aria-label="Fit graph to view"
						title="Fit graph to view"
						disabled={!contentBounds}
						onClick={fitGraphToView}
						className={ICON_BUTTON}
					>
						<CornersIn aria-hidden="true" size={13} />
					</button>
					<button
						type="button"
						aria-label="Disconnect selected edge"
						title="Disconnect selected edge"
						disabled={graphControlsDisabled || !selectedEdge}
						onClick={disconnectSelectedEdge}
						className={ICON_BUTTON_DANGER}
					>
						<Trash aria-hidden="true" size={13} />
					</button>
					{detached ? null : (
						<button
							type="button"
							aria-label={
								lookWorkspaceExpanded
									? "Compact Look workspace"
									: "Expand Look workspace"
							}
							title={
								lookWorkspaceExpanded
									? "Compact Look workspace"
									: "Expand Look workspace"
							}
							onClick={toggleLookWorkspaceExpanded}
							className={ICON_BUTTON}
						>
							{lookWorkspaceExpanded ? (
								<ArrowsInSimple aria-hidden="true" size={13} />
							) : (
								<ArrowsOutSimple aria-hidden="true" size={13} />
							)}
						</button>
					)}
					<button
						type="button"
						aria-label={
							detached
								? "Dock Look workspace into the editor"
								: "Open Look workspace in a separate window"
						}
						title={detached ? "Dock into editor" : "Open in separate window"}
						onClick={detached ? dockLookWorkspace : detachLookWorkspace}
						className={ICON_BUTTON}
					>
						{detached ? (
							<ArrowSquareIn aria-hidden="true" size={13} />
						) : (
							<ArrowSquareOut aria-hidden="true" size={13} />
						)}
					</button>
					{targetMissing || activeState.graphActive ? null : (
						<button
							type="button"
							title="Edit this Look as an explicit graph"
							onClick={() =>
								commitMaterializeFrameLookGraphForTarget(commandTarget)
							}
							className={cn(
								"flex h-7 items-center gap-1 rounded border border-white/10 bg-black/15 px-2.5 text-fg-muted transition hover:border-accent/45 hover:text-accent-fg",
								FOCUS_RING,
							)}
						>
							<PencilSimple aria-hidden="true" size={13} />
							<span>Edit</span>
						</button>
					)}
					<button
						type="button"
						aria-label="Close Look workspace"
						title="Close Look workspace"
						onClick={closeWorkspace}
						className={cn(ICON_BUTTON, "hover:text-fg")}
					>
						<X aria-hidden="true" size={14} />
					</button>
				</div>
			</header>
			<div className="flex min-h-0 flex-1">
				<aside className="flex w-56 min-h-0 shrink-0 flex-col border-white/10 border-r text-ui">
					<div className="shrink-0 border-white/10 border-b p-2">
						<div className="mb-1 flex items-center justify-between gap-2">
							<p className="font-medium text-fg-muted">
								{activePaletteMode === "looks" ? "Looks" : "Nodes"}
							</p>
							<span className="rounded border border-white/10 bg-black/15 px-1.5 py-0.5 font-mono text-fg-subtle">
								{paletteVisibleCount}
							</span>
						</div>
						<label className="relative block min-w-0">
							<MagnifyingGlass
								aria-hidden="true"
								size={11}
								className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 text-fg-muted"
							/>
							<input
								type="text"
								value={paletteSearch}
								placeholder="Search"
								aria-label={
									activePaletteMode === "looks"
										? "Search Looks"
										: "Search Look graph nodes"
								}
								className={cn(
									"h-6 w-full rounded border border-white/10 bg-black/25 pr-5 pl-5 text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/70",
									FOCUS_RING,
								)}
								onChange={(event) =>
									setPaletteSearch(event.currentTarget.value)
								}
							/>
							{paletteSearch.length > 0 ? (
								<button
									type="button"
									aria-label="Clear effect search"
									title="Clear search"
									onClick={() => setPaletteSearch("")}
									className={cn(
										"-translate-y-1/2 absolute top-1/2 right-1 grid size-4 place-items-center rounded text-fg-muted transition hover:bg-white/[0.08] hover:text-fg",
										FOCUS_RING,
									)}
								>
									<X aria-hidden="true" size={9} />
								</button>
							) : null}
						</label>
						<div className="mt-1.5 grid grid-cols-2 gap-1">
							{LOOK_GRAPH_PALETTE_MODES.map((mode) => (
								<button
									key={mode.id}
									type="button"
									title={
										mode.id === "looks"
											? `${mode.label} - complete editable looks (${paletteModeCount(mode.id)})`
											: `${mode.label} - one graph node (${paletteModeCount(mode.id)})`
									}
									aria-pressed={activePaletteMode === mode.id}
									onClick={() => setActivePaletteMode(mode.id)}
									className={cn(
										"flex h-6 min-w-0 items-center justify-center rounded border px-1 text-center transition",
										FOCUS_RING,
										activePaletteMode === mode.id
											? "border-accent bg-accent-surface text-accent-fg"
											: "border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-fg",
									)}
								>
									<span className="truncate">{mode.label}</span>
								</button>
							))}
						</div>
						{activePaletteMode === "looks" ? (
							<div className="mt-1 grid grid-cols-2 gap-1">
								{(["object", "frame"] as const).map((target) => {
									const objectTargetDisabled =
										target === "object" && selectedSceneNodeCount === 0;
									return (
										<button
											key={target}
											type="button"
											disabled={objectTargetDisabled}
											title={
												target === "object"
													? selectedSceneNodeCount > 0
														? `Target selected objects (${selectedSceneNodeCount})`
														: "Select an object to use Object Looks"
													: "Target the whole frame or current graph scope"
											}
											aria-pressed={activePaletteTarget === target}
											onClick={() => {
												setActivePaletteTarget(target);
												if (target === "frame") clearTargetOverride();
											}}
											className={cn(
												"flex h-6 min-w-0 items-center justify-center rounded border px-1 text-center transition disabled:cursor-not-allowed disabled:opacity-45",
												FOCUS_RING,
												activePaletteTarget === target
													? "border-accent bg-accent-surface text-accent-fg"
													: "border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-fg",
											)}
										>
											<span className="truncate">
												{lookPaletteTargetLabel(target)}
											</span>
										</button>
									);
								})}
							</div>
						) : null}
					</div>
					<div className="chrome-scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
						{activePaletteMode === "looks" && lookVisibleSections.length > 0
							? lookVisibleSections.map((section) => (
									<div key={section.id} className="grid grid-cols-1 gap-1">
										<p className="font-medium text-fg-muted">{section.label}</p>
										{section.entries.map((entry) => {
											const variant = lookRecipeVariantForTarget(
												entry,
												activePaletteTarget,
											);
											if (!variant) return null;
											const selectionGraphState =
												entry.action === "analog-film-selection"
													? null
													: selectionLookGraphRecipeStates.get(entry.id);
											const blockedWithoutAction =
												selectionGraphState != null &&
												!selectionGraphState.canApply &&
												selectionGraphState.status === "none";
											const disabled =
												variant.target === "object" &&
												(selectedSceneNodeCount === 0 || blockedWithoutAction);
											const active =
												variant.target === "object" &&
												(entry.action === "analog-film-selection"
													? analogFilmSelectionState.status !== "none"
													: selectionGraphState
														? selectionGraphState.status !== "none"
														: false);
											const stateLabel = (() => {
												if (active) {
													const status =
														entry.action === "analog-film-selection"
															? analogFilmSelectionState.status
															: selectionGraphState?.status;
													return status === "partial" ? "Part" : "On";
												}
												return variant.target === "object" &&
													selectionGraphState &&
													selectionGraphState.blockedCount > 0
													? "Block"
													: null;
											})();
											const canOpenObjectGraph =
												variant.target === "object" &&
												entry.action !== "analog-film-selection" &&
												selectionGraphState != null &&
												selectionGraphState.status !== "none";
											return (
												<div key={entry.id} className="flex h-8 min-w-0 gap-1">
													<button
														type="button"
														disabled={disabled}
														title={lookRecipeInsertTitle(entry, variant)}
														onClick={() => insertLookRecipeEntry(entry)}
														className={cn(
															"flex min-w-0 flex-1 items-center gap-1.5 rounded border px-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
															FOCUS_RING,
															active
																? "border-accent bg-accent-surface text-accent-fg"
																: "border-accent/35 bg-accent-surface/70 text-accent-fg hover:border-accent hover:bg-accent-surface",
														)}
													>
														<Sparkle aria-hidden="true" size={12} />
														<span className="min-w-0 flex-1 truncate">
															{entry.label}
														</span>
														{stateLabel ? (
															<span className="shrink-0 font-mono text-fg-subtle">
																{stateLabel}
															</span>
														) : null}
													</button>
													{variant.target === "object" ? (
														canOpenObjectGraph ? (
															<button
																type="button"
																aria-label={`Open ${entry.label} Object Look graph`}
																title="Open this Object Look graph"
																onClick={() => openObjectLookGraphEntry(entry)}
																className={cn(
																	"grid size-8 shrink-0 place-items-center rounded border text-ui transition",
																	FOCUS_RING,
																	"border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-accent-fg",
																)}
															>
																<PencilSimple aria-hidden="true" size={12} />
															</button>
														) : (
															<span
																aria-hidden="true"
																className="size-8 shrink-0"
															/>
														)
													) : null}
												</div>
											);
										})}
									</div>
								))
							: null}
						{activePaletteMode === "nodes" && nodeVisibleSections.length > 0
							? nodeVisibleSections.map((section) => (
									<div key={section.id} className="grid grid-cols-1 gap-1">
										<p className="font-medium text-fg-muted">{section.label}</p>
										{section.entries.map((entry) => {
											const label = paletteEntryLabel(entry);
											const title = paletteInsertTitle(entry, label);
											return (
												<button
													key={entry.kind}
													type="button"
													title={title}
													onClick={() => insertPaletteEntry(entry)}
													className={cn(
														"flex h-8 min-w-0 items-center gap-1.5 rounded border border-white/10 bg-black/15 px-2.5 text-left text-fg-muted transition hover:border-accent/45 hover:text-accent-fg",
														FOCUS_RING,
													)}
												>
													<Plus aria-hidden="true" size={12} />
													<span className="truncate">{label}</span>
												</button>
											);
										})}
									</div>
								))
							: null}
						{paletteVisibleCount === 0 ? (
							<div className="rounded border border-white/10 bg-black/15 px-2 py-1 text-fg-subtle">
								{activePaletteMode === "looks"
									? `No ${lookPaletteTargetLabel(activePaletteTarget)} looks match`
									: "No nodes match"}
							</div>
						) : null}
					</div>
				</aside>
				<div
					ref={stageViewportRef}
					className={cn(
						"chrome-scrollbar-thin relative min-w-0 flex-1 overflow-auto bg-surface-sunken/80",
						stagePanning ? "cursor-grabbing" : "cursor-grab",
					)}
					onPointerDown={beginStagePan}
					onPointerMove={updateStagePan}
					onPointerUp={endStagePan}
					onPointerCancel={endStagePan}
					onLostPointerCapture={endStagePan}
				>
					<div
						className="relative"
						style={{ width: scaledGraphWidth, height: scaledGraphHeight }}
					>
						<div
							ref={graphStageRef}
							className="relative origin-top-left"
							style={{
								width: graphWidth,
								height: graphHeight,
								transform: `scale(${graphZoom})`,
							}}
						>
							<svg
								aria-label="Look graph edges"
								className="absolute inset-0"
								width={graphWidth}
								height={graphHeight}
								viewBox={`0 0 ${graphWidth} ${graphHeight}`}
							>
								{activeState.graph?.edges.map((edge) => {
									const path = edgePath(edge, viewsById);
									if (!path) return null;
									const edgeSelected = edge.id === selectedEdgeId;
									const nodeSelected =
										edge.from.nodeId === selectedNodeId ||
										edge.to.nodeId === selectedNodeId;
									return (
										// biome-ignore lint/a11y/useSemanticElements: an SVG <path> cannot be a native <button>; role + tabIndex + keyboard handlers are the correct interactive-SVG affordance
										<path
											key={edge.id}
											d={path}
											fill="none"
											stroke="currentColor"
											strokeLinecap="round"
											strokeWidth={edgeSelected ? 3 : nodeSelected ? 2.5 : 1.5}
											pointerEvents="stroke"
											tabIndex={0}
											role="button"
											aria-label="Select Look graph edge"
											className={
												edgeSelected || nodeSelected
													? "cursor-pointer text-accent-fg transition-colors"
													: "cursor-pointer text-fg-subtle transition-colors hover:text-fg-muted"
											}
											onPointerDown={(event) => {
												event.stopPropagation();
												selectEdge(edge);
											}}
											onKeyDown={(event) => {
												if (event.key !== "Enter" && event.key !== " ") return;
												event.preventDefault();
												selectEdge(edge);
											}}
										/>
									);
								})}
								{wireDraft
									? (() => {
											const path = draftEdgePath(wireDraft, viewsById);
											if (!path) return null;
											return (
												<path
													d={path}
													fill="none"
													stroke="currentColor"
													strokeDasharray="5 4"
													strokeLinecap="round"
													strokeWidth={2}
													className={
														wireDraft.target
															? "text-accent-fg"
															: "text-fg-subtle"
													}
												/>
											);
										})()
									: null}
							</svg>
							{views.map((view) => (
								<GraphNodeCard
									key={view.node.id}
									view={view}
									selected={view.node.id === selectedNodeId}
									elevated={dragPreview?.nodeId === view.node.id}
									disabled={graphControlsDisabled}
									graphActive={activeState.graphActive}
									wireSourceNodeId={wireDraft?.from.nodeId ?? null}
									onSelect={() => selectNode(view.node.id)}
									onPointerDown={beginDrag(view)}
									onPointerMove={updateDrag}
									onPointerUp={endDrag}
									activeWireTarget={wireDraft?.target ?? null}
									onWireStart={beginWire}
									onWireMove={updateWire}
									onWireEnd={endWire}
									onToggle={() =>
										commitToggleFrameLookGraphNodeForTarget(
											commandTarget,
											view.node.id,
											!view.node.enabled,
										)
									}
									onMoveUp={() =>
										commitReorderFrameLookGraphNodeForTarget(
											commandTarget,
											view.node.id,
											"up",
										)
									}
									onMoveDown={() =>
										commitReorderFrameLookGraphNodeForTarget(
											commandTarget,
											view.node.id,
											"down",
										)
									}
									onRemove={() =>
										commitRemoveFrameLookGraphNodeForTarget(
											commandTarget,
											view.node.id,
										)
									}
								/>
							))}
						</div>
					</div>
				</div>
				<aside className="flex w-64 min-h-0 shrink-0 flex-col gap-2 border-white/10 border-l p-2 text-ui">
					<div className="min-w-0 shrink-0">
						<p className="truncate font-medium text-fg">
							{selectedView ? nodeKindLabel(selectedView.node) : "No node"}
						</p>
						<p className="truncate text-fg-subtle">
							{selectedView ? selectedView.node.kind : "Look graph"}
						</p>
					</div>
					<div className="chrome-scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
						{selectedEditingNode ? (
							<>
								<div className="flex items-center gap-1">
									<button
										type="button"
										aria-pressed={selectedEditingNode.enabled}
										disabled={graphControlsDisabled}
										onClick={() =>
											commitToggleFrameLookGraphNodeForTarget(
												commandTarget,
												selectedEditingNode.id,
												!selectedEditingNode.enabled,
											)
										}
										className={cn(
											"flex h-7 flex-1 items-center justify-center gap-1.5 rounded border text-ui transition disabled:cursor-not-allowed disabled:opacity-45",
											FOCUS_RING,
											selectedEditingNode.enabled
												? "border-accent bg-accent-surface text-accent-fg"
												: "border-white/10 bg-black/15 text-fg-muted hover:border-accent/45 hover:text-fg",
										)}
									>
										{selectedEditingNode.enabled ? (
											<Eye aria-hidden="true" size={13} />
										) : (
											<EyeSlash aria-hidden="true" size={13} />
										)}
										<span>
											{selectedEditingNode.enabled ? "Enabled" : "Disabled"}
										</span>
									</button>
									<button
										type="button"
										disabled={
											graphControlsDisabled || !selectedEditingNode.canMoveUp
										}
										aria-label="Move node up"
										title="Move node up"
										onClick={() =>
											commitReorderFrameLookGraphNodeForTarget(
												commandTarget,
												selectedEditingNode.id,
												"up",
											)
										}
										className={ICON_BUTTON}
									>
										<CaretUp aria-hidden="true" size={13} />
									</button>
									<button
										type="button"
										disabled={
											graphControlsDisabled || !selectedEditingNode.canMoveDown
										}
										aria-label="Move node down"
										title="Move node down"
										onClick={() =>
											commitReorderFrameLookGraphNodeForTarget(
												commandTarget,
												selectedEditingNode.id,
												"down",
											)
										}
										className={ICON_BUTTON}
									>
										<CaretDown aria-hidden="true" size={13} />
									</button>
								</div>
								<div className="grid grid-cols-1 gap-1">
									{selectedEditingNode.sliders.map((control) => (
										<GraphSlider
											key={`${selectedEditingNode.id}:${control.path}`}
											target={activeState.target}
											commandTarget={commandTarget}
											nodeId={selectedEditingNode.id}
											control={control}
											disabled={
												graphControlsDisabled || !selectedEditingNode.enabled
											}
										/>
									))}
								</div>
								{selectedView ? (
									<GraphNodePayloadControls
										target={commandTarget}
										ownerTarget={activeState.target}
										node={selectedView.node}
										masked={selectedNodeReceivesRenderableMask}
										disabled={
											graphControlsDisabled || !selectedEditingNode.enabled
										}
									/>
								) : null}
								{selectedView && activeState.graph ? (
									<GraphInputConnections
										connections={selectedInputConnections}
										disabled={graphControlsDisabled}
										onConnect={connectInput}
										onDisconnect={(endpoint) =>
											commitDisconnectFrameLookGraphInputForTarget(
												commandTarget,
												endpoint,
											)
										}
									/>
								) : null}
							</>
						) : (
							<div className="rounded border border-white/10 bg-black/15 px-2 py-1 text-fg-subtle">
								{selectedView ? nodeKindGroup(selectedView.node) : status}
							</div>
						)}
					</div>
				</aside>
			</div>
			{detached ? null : (
				<PanelResizeHandle
					panelName="Look workspace"
					orientation="horizontal"
					{...lookWorkspaceResize}
				/>
			)}
		</section>
	);
}
