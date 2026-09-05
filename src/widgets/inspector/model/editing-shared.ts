/**
 * Shared inspector-editing primitives: transaction/command-bus helpers, cross-domain type
 * contracts, and generic selector/normalizer utilities reused across every inspector
 * editing domain module. This is the base layer every domain file below imports from;
 * it must never import from a domain file (no upward dependency, no cycles).
 */

import { useMotionStore } from "@/entities/motion/model/store";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import {
	type AppearanceMaskChannel,
	type AppearanceMaskRelationMetadata,
	type AppearanceMaskSourceSampling,
	createSetMaskRelationBehaviorCommand,
	createSetMaskRelationPropertyCommand,
	MASK_RELATION_EXPAND_PROPERTY_ID,
	MASK_RELATION_FEATHER_PROPERTY_ID,
	MASK_RELATION_INVERT_PROPERTY_ID,
	MASK_RELATION_OPACITY_PROPERTY_ID,
	type MaskRelationPropertyId,
	readAppearanceMaskRelations,
} from "@/entities/scene/model/appearance";
import type { SceneCommand } from "@/entities/scene/model/command";
import type { PaintKind } from "@/entities/scene/model/gradient-edit";
import {
	type ArtboardPatch,
	createUpdateArtboardCommand,
	createUpdateNodeStyleCommand,
	type NodeStylePatch,
} from "@/entities/scene/model/node-commands";
import {
	type InspectorTransformValues,
	inspectorValuesForNode,
	matrixFromInspectorValues,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findArtboardById,
	findNode,
	type NormalizedArtboard,
	normalizeSceneArtboards,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { normalizeCodeSafeTextFontFamily } from "@/entities/scene/model/text-fonts";
import type {
	BlendMode,
	BlurEffect,
	Effect,
	ImagePaintFit,
	Paint,
	SceneDocument,
	ShadowEffect,
	ShadowEffectKind,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	TextAlign,
	TextResizeMode,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { recordNodeTransformRepeat } from "@/features/transform/model/repeat-transform";
import type { StrokeWidthProfilePresetId } from "@/shared/stroke/width-profile";
import { applyNodeTransform } from "@/widgets/canvas-shell/model/writer";

export const MIXED_VALUE = "mixed" as const;

export type {
	FrameEffectInfluenceEditingValues,
	FrameEffectInfluenceMaskKind,
	FrameEffectInfluenceNumberField,
} from "@/features/effect-authoring/model/frame-influence-authoring";

export type MixedValue<T> = T | typeof MIXED_VALUE;
export type TransformNumberField = Exclude<
	keyof InspectorTransformValues,
	"opacity"
>;
export type StyleNumberField = "opacity" | "strokeWidth";
export type NodeColorField = "fill" | "stroke";
export type PrimaryPaintRole = "fills" | "strokes";
export type StrokeOptionField = "strokeAlign" | "strokeCap" | "strokeJoin";
export type DropShadowNumberField = "x" | "y" | "radius" | "spread" | "opacity";
/** Alias for the shared shadow numeric fields; inner-shadow reuses the same set. */
export type ShadowNumberField = DropShadowNumberField;
export type TextStyleNumberField =
	| "fontSize"
	| "lineHeight"
	| "fontWeight"
	| "letterSpacing";
export type ArtboardInspectorNumberField = "x" | "y" | "width" | "height";

export const INSPECTOR_BLEND_MODE_VALUES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
] as const satisfies readonly BlendMode[];

export const INSPECTOR_STROKE_ALIGN_VALUES = [
	"inside",
	"center",
	"outside",
] as const satisfies readonly StrokeAlign[];

export const INSPECTOR_STROKE_CAP_VALUES = [
	"butt",
	"round",
	"square",
] as const satisfies readonly StrokeCap[];

export const INSPECTOR_STROKE_JOIN_VALUES = [
	"miter",
	"round",
	"bevel",
] as const satisfies readonly StrokeJoin[];

/** Paint kinds the inspector lets the user switch between (image is read-only). */
export const INSPECTOR_PAINT_KIND_VALUES = [
	"solid",
	"linear-gradient",
	"radial-gradient",
] as const satisfies readonly PaintKind[];

export type InspectorPaintKind = (typeof INSPECTOR_PAINT_KIND_VALUES)[number];

/** Image-reference fit modes the Inspector can safely write without asset changes. */
export const INSPECTOR_IMAGE_FIT_VALUES = [
	"fill",
	"fit",
	"crop",
	"tile",
] as const satisfies readonly ImagePaintFit[];

export type InspectorImageFit = (typeof INSPECTOR_IMAGE_FIT_VALUES)[number];

/** A single gradient stop projected for the Inspector stop list. */
export type GradientStopModel = {
	/** Stable stop id, shared with the canvas annotator and `selection.sub`. */
	readonly id: string | undefined;
	readonly offset: number;
	readonly color: string;
	readonly opacity: number;
};

/** Single-selection gradient editing model for one paint role. */
export type GradientEditModel = {
	readonly kind: "linear-gradient" | "radial-gradient";
	/** Linear direction in degrees (node-local) for the inspector angle field; null for radial. */
	readonly angleDeg: number | null;
	readonly stops: readonly GradientStopModel[];
};

/** Minimal mesh sub-selection shape read by the Inspector without importing the selection store. */
export type MeshSubSelectionLike = {
	readonly nodeId: string;
	readonly kind: "mesh-node";
	readonly role: PrimaryPaintRole;
	readonly row: number;
	readonly col: number;
} | null;

/** Read/edit projection for image-reference primary paints in one paint role. */
export type ImagePaintEditModel = {
	readonly imageCount: number;
	readonly totalNodeCount: number;
	readonly source: MixedValue<string> | null;
	readonly fit: MixedValue<ImagePaintFit> | null;
	readonly canEditFit: boolean;
	readonly unavailableReason: string | null;
};

/** Selected mesh point values shown by compact Inspector fields. */
export type MeshPointEditModel = {
	readonly row: number;
	readonly col: number;
	readonly x: number;
	readonly y: number;
	readonly color: string;
	readonly opacity: number;
};

/** Single-node mesh paint projection for readout plus selected-point authoring. */
export type MeshPaintEditModel = {
	readonly nodeId: string;
	readonly role: PrimaryPaintRole;
	readonly rows: number;
	readonly cols: number;
	readonly pointCount: number;
	readonly selectedPoint: MeshPointEditModel | null;
	readonly canEditSelectedPoint: boolean;
	/**
	 * Whether the selected point's mesh lines can be removed. False for the four
	 * corner points (boundary on both axes), which would shrink the mesh; the
	 * Inspector disables its remove button instead of silently no-op'ing.
	 */
	readonly canRemoveSelectedPoint: boolean;
	readonly unavailableReason: string | null;
};

/**
 * Selection-derived contract for Inspector text editing. It separates the
 * editable text-node subset from the full selection so mixed vector/text
 * selections can keep their selection state while committing only text content.
 */
export type TextEditingState = {
	readonly value: MixedValue<string> | null;
	readonly textNodeIds: readonly string[];
	readonly textNodeCount: number;
	readonly totalNodeCount: number;
	readonly hasNonTextSelection: boolean;
	readonly canEdit: boolean;
};

export type TextStyleEditingValues = {
	readonly fontFamily: MixedValue<string> | null;
	readonly fontSize: MixedValue<number> | null;
	readonly lineHeight: MixedValue<number> | null;
	readonly align: MixedValue<TextAlign> | null;
	readonly fontWeight: MixedValue<number> | null;
	readonly letterSpacing: MixedValue<number> | null;
	/** Whether the selected text reads bold (font-weight heuristic). */
	readonly bold: MixedValue<boolean> | null;
	readonly italic: MixedValue<boolean> | null;
	readonly underline: MixedValue<boolean> | null;
	readonly fill: MixedValue<string> | null;
};

/**
 * Selection-derived contract for Inspector text style controls. Geometry-owned
 * typography is normalized through the scene text helper, while fill stays on
 * node appearance because canvas, SVG, and PDF render text color from there.
 */
export type TextStyleEditingState = {
	readonly values: TextStyleEditingValues;
	readonly textNodeIds: readonly string[];
	readonly textNodeCount: number;
	readonly totalNodeCount: number;
	readonly hasNonTextSelection: boolean;
	readonly canEdit: boolean;
};

export type TextBoxEditingValues = {
	readonly mode: MixedValue<TextResizeMode> | null;
	readonly width: MixedValue<number> | null;
	readonly height: MixedValue<number> | null;
	readonly overflowY: MixedValue<number> | null;
	readonly fits: MixedValue<boolean> | null;
};

export type TextBoxEditingState = {
	readonly values: TextBoxEditingValues;
	readonly textNodeIds: readonly string[];
	readonly textNodeCount: number;
	readonly totalNodeCount: number;
	readonly hasNonTextSelection: boolean;
	readonly canEdit: boolean;
};

/**
 * Whether a stroke renders solid or dashed — the Inspector's one-click stroke
 * style control. Derived from `strokeDash` (empty = solid) rather than a new
 * schema field so canvas/export behavior is untouched.
 */
export type StrokeStyleKind = "solid" | "dashed" | "dotted";

/**
 * Inspector-facing width profile selection: `"none"` when the node style's
 * `strokeWidthProfile` is unset, a built-in preset id (see
 * `STROKE_WIDTH_PROFILE_PRESETS` in `@/shared/stroke/width-profile`) when the
 * stops deep-equal one of those presets, and `"custom"` for any other stop
 * list (e.g. authored via the agent/MCP surface, or a future width-profile
 * editor). "Custom" has no dedicated option in the Inspector select — it is
 * shown as the current label only, and choosing any other option overwrites it.
 */
export type StrokeWidthProfileSelection =
	| "none"
	| StrokeWidthProfilePresetId
	| "custom";

export type AppearanceEditingValues = {
	/**
	 * Whether the role currently paints anything on canvas: at least one visible,
	 * non-"none" paint (and, for strokes, a positive stroke width). Drives the
	 * Inspector's "has fill / has stroke" toggle.
	 */
	readonly fillEnabled: MixedValue<boolean> | null;
	readonly fillColor: MixedValue<string | null> | null;
	readonly fillColorEditable: boolean;
	readonly fillOpacity: MixedValue<number | null> | null;
	readonly fillSummary: MixedValue<string> | null;
	readonly fillPaintKind: MixedValue<PaintKind> | null;
	readonly fillGradient: GradientEditModel | null;
	readonly fillImage: ImagePaintEditModel | null;
	readonly fillMesh: MeshPaintEditModel | null;
	/**
	 * True only when exactly one node is selected whose geometry can carry a mesh and
	 * whose leading fill is not already a mesh — drives whether the unified fill paint
	 * picker offers the "Mesh" row (which routes to {@link commitConvertFillToMesh}, not
	 * the symmetric {@link commitPaintKind} seam).
	 */
	readonly fillCanConvertToMesh: boolean;
	/** Stroke counterpart of {@link AppearanceEditingValues.fillEnabled}. */
	readonly strokeEnabled: MixedValue<boolean> | null;
	readonly strokeColor: MixedValue<string | null> | null;
	readonly strokeColorEditable: boolean;
	readonly strokeOpacity: MixedValue<number | null> | null;
	readonly strokeSummary: MixedValue<string> | null;
	readonly strokePaintKind: MixedValue<PaintKind> | null;
	readonly strokeGradient: GradientEditModel | null;
	readonly strokeImage: ImagePaintEditModel | null;
	readonly strokeMesh: MeshPaintEditModel | null;
	readonly strokeWidth: MixedValue<number> | null;
	readonly strokeBlur: MixedValue<number> | null;
	readonly blendMode: MixedValue<BlendMode> | null;
	readonly strokeAlign: MixedValue<StrokeAlign> | null;
	readonly strokeCap: MixedValue<StrokeCap> | null;
	readonly strokeJoin: MixedValue<StrokeJoin> | null;
	readonly strokeDash: MixedValue<string> | null;
	readonly strokeStyleKind: MixedValue<StrokeStyleKind> | null;
	readonly strokeWidthProfile: MixedValue<StrokeWidthProfileSelection> | null;
	readonly dropShadowEnabled: MixedValue<boolean> | null;
	readonly dropShadowColor: MixedValue<string | null> | null;
	readonly dropShadowOpacity: MixedValue<number | null> | null;
	readonly dropShadowX: MixedValue<number | null> | null;
	readonly dropShadowY: MixedValue<number | null> | null;
	readonly dropShadowRadius: MixedValue<number | null> | null;
	readonly dropShadowSpread: MixedValue<number | null> | null;
	readonly innerShadowEnabled: MixedValue<boolean> | null;
	readonly innerShadowColor: MixedValue<string | null> | null;
	readonly innerShadowOpacity: MixedValue<number | null> | null;
	readonly innerShadowX: MixedValue<number | null> | null;
	readonly innerShadowY: MixedValue<number | null> | null;
	readonly innerShadowRadius: MixedValue<number | null> | null;
	readonly innerShadowSpread: MixedValue<number | null> | null;
	readonly layerBlurEnabled: MixedValue<boolean> | null;
	/** X-axis radius; this is the legacy scalar `radius` field. */
	readonly layerBlurRadius: MixedValue<number | null> | null;
	/** Effective Y-axis radius (`radiusY ?? radius`). */
	readonly layerBlurRadiusY: MixedValue<number | null> | null;
	/** True when `radiusY` is omitted and Y follows X. */
	readonly layerBlurAxesLinked: MixedValue<boolean> | null;
};

/**
 * Selection-derived appearance state for the compact Inspector controls. Values
 * follow `resolveNodeStyle` defaults so optional expressive fields can be edited
 * without requiring a scene migration or a duplicate UI-only style model.
 */
export type AppearanceEditingState = {
	readonly values: AppearanceEditingValues;
	readonly nodeIds: readonly string[];
	readonly nodeCount: number;
	readonly canEdit: boolean;
	/**
	 * `nodeIds` expanded through {@link expandPaintTargetIds}: a selected group or
	 * Blend container resolves to its drawable leaves. Paint-scoped controls (the
	 * fill/stroke paint picker, opacity slider, image fit, and their commit calls)
	 * must pass this set — not `nodeIds` — so editing a paint through a container
	 * selection reaches the members it visually represents. Node-scoped fields
	 * (opacity, blend mode, effects, corner radius) keep using `nodeIds`.
	 */
	readonly paintNodeIds: readonly string[];
};

/**
 * Inspector view of the first editable native mask relation on a single node.
 * The relation id is part of the UI state because the value is authored on the
 * relation metadata, not on the content node's fill/stroke style.
 */
export type MaskFeatherEditingState = {
	readonly contentNodeId: string;
	readonly relationId: string;
	readonly maskNodeId: string;
	readonly featherRadius: number;
	readonly opacity: number;
	readonly expand: number;
	readonly invert: boolean;
	readonly channel: AppearanceMaskChannel;
	readonly sourceSampling: AppearanceMaskSourceSampling;
};

/**
 * Draft-facing values for the artboard section. Position is already normalized
 * by scene selectors, so UI fields never need legacy missing-position fallback.
 */
export type ArtboardInspectorValues = {
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly background: string;
};

/** Patch shape future artboard command adapters must translate to scene commands. */
export type ArtboardInspectorMutationPatch = Partial<{
	readonly name: string;
	readonly position: Partial<Vec2>;
	readonly width: number;
	readonly height: number;
	readonly background: string;
	readonly fills: readonly Paint[];
}>;

/**
 * Fully validated Inspector mutation request. Adapters receive normalized
 * values only; they own command-bus execution and no-op detection at scene depth.
 */
export type ArtboardInspectorMutation = {
	readonly artboardId: string;
	readonly patch: ArtboardInspectorMutationPatch;
	readonly label: string;
	readonly coalesceKey: string;
};

/** Availability state for the artboard mutation adapter visible to the panel. */
export type ArtboardInspectorMutationStatus =
	| {
			readonly kind: "ready";
	  }
	| {
			readonly kind: "unavailable";
			readonly reason: string;
	  };

/**
 * Adapter boundary for scene-level artboard command execution. Inspector
 * helpers validate drafts before this seam; adapters decide whether the command
 * bus is available and report whether the document actually changed.
 */
export type ArtboardInspectorMutationAdapter = {
	readonly status: ArtboardInspectorMutationStatus;
	readonly commit: (mutation: ArtboardInspectorMutation) => boolean;
};

/**
 * Selector-derived state for the no-selection artboard panel. `resetKey` changes
 * with artboard focus, protecting draft inputs when current artboard switches.
 */
export type ArtboardInspectorState = {
	readonly artboard: NormalizedArtboard;
	readonly values: ArtboardInspectorValues;
	readonly artboardCount: number;
	readonly isDefaultArtboard: boolean;
	readonly canMutate: boolean;
	readonly canAdd: boolean;
	readonly canDuplicate: boolean;
	readonly canRemove: boolean;
	readonly unavailableReason: string | null;
	readonly resetKey: string;
};

/**
 * Read-only adapter kept for tests and future degraded states where artboard
 * commands should be hidden without changing inspector draft validation.
 */
export const unavailableArtboardMutationAdapter: ArtboardInspectorMutationAdapter =
	{
		status: {
			kind: "unavailable",
			reason: "Artboard editing is unavailable in this inspector context.",
		},
		commit: () => false,
	};

let commitSequence = 0;

export const nextCommitKey = (scope: string): string =>
	`inspector:${scope}:${commitSequence++}`;

export const clampOpacity = (value: number): number =>
	Math.min(1, Math.max(0, value));
const textAlignValues = ["left", "center", "right"] as const;
export const DEFAULT_BLEND_MODE = "normal" satisfies BlendMode;
export const DEFAULT_STROKE_ALIGN = "center" satisfies StrokeAlign;
export const DEFAULT_STROKE_CAP = "butt" satisfies StrokeCap;
export const DEFAULT_STROKE_JOIN = "miter" satisfies StrokeJoin;
const DEFAULT_DROP_SHADOW = {
	kind: "drop-shadow",
	offset: { x: 0, y: 8 },
	radius: 16,
	spread: 0,
	color: "#000000",
	opacity: 0.25,
	visible: true,
	blendMode: DEFAULT_BLEND_MODE,
} satisfies ShadowEffect;

const DEFAULT_INNER_SHADOW = {
	kind: "inner-shadow",
	offset: { x: 0, y: 2 },
	radius: 4,
	spread: 0,
	color: "#000000",
	opacity: 0.25,
	visible: true,
	blendMode: DEFAULT_BLEND_MODE,
} satisfies ShadowEffect;

export const DEFAULT_LAYER_BLUR = {
	kind: "layer-blur",
	radius: 4,
	visible: true,
} satisfies BlurEffect;

/** Seed effect a shadow commit creates when the selected node has no shadow of `kind` yet. */
export const defaultShadowForKind = (kind: ShadowEffectKind): ShadowEffect =>
	kind === "inner-shadow" ? DEFAULT_INNER_SHADOW : DEFAULT_DROP_SHADOW;

export const hasStylePatch = (patch: NodeStylePatch): boolean =>
	patch.fill !== undefined ||
	patch.stroke !== undefined ||
	patch.strokeWidth !== undefined ||
	patch.opacity !== undefined ||
	patch.fills !== undefined ||
	patch.strokes !== undefined ||
	patch.effects !== undefined ||
	patch.blendMode !== undefined ||
	patch.strokeAlign !== undefined ||
	patch.strokeDash !== undefined ||
	patch.strokeCap !== undefined ||
	patch.strokeJoin !== undefined ||
	patch.strokeMiterLimit !== undefined;

export const applyCommandsAsTransaction = (
	scope: string,
	label: string,
	commands: readonly SceneCommand[],
	coalesceKey?: string,
): boolean => {
	const store = useSceneStore.getState();
	const before = store.document;
	// A stable per-gesture coalesceKey lets a color drag's per-frame commits
	// merge into one undo entry (the store coalesces consecutive same-key
	// entries); omitting it falls back to a unique key, keeping discrete edits
	// as separate undo entries.
	store.beginTransaction(coalesceKey ?? nextCommitKey(scope), label);
	for (const command of commands) {
		useSceneStore.getState().apply(command);
	}
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
};

export const applySceneCommand = (command: SceneCommand): boolean => {
	const before = useSceneStore.getState().document;
	useSceneStore.getState().apply(command);
	return useSceneStore.getState().document !== before;
};

const applyWriterAsTransaction = (
	scope: string,
	label: string,
	write: () => void,
): boolean => {
	const store = useSceneStore.getState();
	const before = store.document;
	store.beginTransaction(nextCommitKey(scope), label);
	write();
	useSceneStore.getState().commit();
	return useSceneStore.getState().document !== before;
};

const commandPatchFromArtboardMutation = (
	mutation: ArtboardInspectorMutation,
): ArtboardPatch => {
	const { position, ...patch } = mutation.patch;
	if (position === undefined) return patch;
	const liveArtboard = findArtboardById(
		useSceneStore.getState().document,
		mutation.artboardId,
	);
	if (!liveArtboard) return patch;
	return {
		...patch,
		position: {
			x: position.x ?? liveArtboard.position.x,
			y: position.y ?? liveArtboard.position.y,
		},
	};
};

/**
 * Production adapter for no-selection artboard field edits. It delegates all
 * scene mutation and stale-id/no-op protection to the entity artboard command,
 * while expanding partial position edits against the latest live artboard.
 */
export const sceneArtboardMutationAdapter: ArtboardInspectorMutationAdapter = {
	status: { kind: "ready" },
	commit: (mutation) =>
		applySceneCommand(
			createUpdateArtboardCommand(
				mutation.artboardId,
				commandPatchFromArtboardMutation(mutation),
				{
					label: mutation.label,
					coalesceKey: mutation.coalesceKey,
				},
			),
		),
};

/**
 * Parses user-authored numeric drafts without treating an empty field as zero.
 * Invalid drafts are intentionally represented as null so callers can keep them
 * out of the scene command bus.
 */
export function parseNumericDraft(draft: string): number | null {
	const normalized = draft.trim();
	if (normalized === "") return null;
	const value = Number(normalized);
	return Number.isFinite(value) ? value : null;
}

/**
 * Formats inspector numbers for stable text inputs while keeping domain values
 * readable at typical editor precision.
 */
export function formatInspectorNumber(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: String(Number(value.toFixed(4)));
}

/**
 * Normalizes color text accepted by the scene style model. The initial editor
 * state only uses hex colors and "none", so unsupported CSS forms are rejected
 * instead of being persisted as loosely validated strings.
 */
export function normalizeColorInput(input: string): string | null {
	const value = input.trim().toLowerCase();
	if (value === "none") return value;
	const shortHex = /^#([\da-f])([\da-f])([\da-f])$/u.exec(value);
	if (shortHex) {
		const [, r, g, b] = shortHex;
		return `#${r}${r}${g}${g}${b}${b}`;
	}
	if (/^#[\da-f]{6}$/u.test(value)) return value;
	return null;
}

/** Normalizes artboard display names and rejects blank drafts. */
export function normalizeArtboardNameInput(input: string): string | null {
	const trimmed = input.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validates artboard geometry fields. Position may be negative on the pasteboard,
 * but persisted dimensions must remain positive finite scene units.
 */
export function normalizeArtboardNumberInput(
	field: ArtboardInspectorNumberField,
	value: number,
): number | null {
	if (!Number.isFinite(value)) return null;
	if ((field === "width" || field === "height") && value <= 0) return null;
	return value;
}

/** Normalizes concrete artboard fills and rejects transparent `none` drafts. */
export function normalizeArtboardBackgroundInput(input: string): string | null {
	const background = normalizeColorInput(input);
	return background && background !== "none" ? background : null;
}

export function normalizeFontFamilyInput(input: string): string | null {
	return normalizeCodeSafeTextFontFamily(input);
}

export function normalizeTextAlignInput(input: string): TextAlign | null {
	return textAlignValues.includes(input as TextAlign)
		? (input as TextAlign)
		: null;
}

/**
 * Reads the current artboard through the normalized scene selectors and exposes
 * stable draft keys so the no-selection inspector never reuses stale field text
 * when focus moves between default and non-default artboards.
 */
export function artboardInspectorState(
	document: SceneDocument,
	adapter: ArtboardInspectorMutationAdapter = sceneArtboardMutationAdapter,
	selectedArtboardId: string | null = null,
): ArtboardInspectorState {
	const { artboards, currentArtboard, defaultArtboard } =
		normalizeSceneArtboards(document);
	// The panel reflects the canvas-selected artboard when one is selected,
	// falling back to the current artboard so it never blanks (selection and the
	// document's `currentArtboardId` are intentionally decoupled — a selection is
	// not undoable). A stale selected id falls back to current too.
	const target =
		(selectedArtboardId
			? artboards.find((artboard) => artboard.id === selectedArtboardId)
			: undefined) ?? currentArtboard;
	const values = {
		name: target.name,
		x: target.position.x,
		y: target.position.y,
		width: target.width,
		height: target.height,
		background: target.background,
	} satisfies ArtboardInspectorValues;
	const unavailableReason =
		adapter.status.kind === "unavailable" ? adapter.status.reason : null;
	const canMutate = adapter.status.kind === "ready";

	return {
		artboard: target,
		values,
		artboardCount: artboards.length,
		isDefaultArtboard: target.id === defaultArtboard.id,
		canMutate,
		canAdd: canMutate,
		canDuplicate: canMutate,
		canRemove: canMutate && artboards.length > 1,
		unavailableReason,
		resetKey: `artboard:${target.id}`,
	};
}

/**
 * Returns selected nodes in selection-store order, dropping stale ids that no
 * longer exist in the document.
 */
export function selectedNodesForInspector(
	document: SceneDocument,
	nodeIds: readonly string[],
): VectorNode[] {
	return nodeIds
		.map((nodeId) => findNode(document, nodeId))
		.filter((node): node is VectorNode => node !== undefined);
}

/**
 * Resolves the primary inspector node from the already-filtered selection.
 * Selection store updates can briefly leave `primary` out of sync with ids, so
 * the inspector must never reach outside the visible selection to choose an
 * editable node.
 */
export function primaryNodeForInspector(
	nodes: readonly VectorNode[],
	primaryNodeId: string | null,
): VectorNode | undefined {
	return nodes.find((node) => node.id === primaryNodeId) ?? nodes[0];
}

/**
 * Collapses a property across selected nodes into a single value or a mixed
 * sentinel. This is the core contract behind multi-selection inspector fields.
 */
export function mixedValue<T>(
	nodes: readonly VectorNode[],
	read: (node: VectorNode) => T,
): MixedValue<T> | null {
	if (nodes.length === 0) return null;
	const first = read(nodes[0]);
	return nodes.every((node) => Object.is(read(node), first))
		? first
		: MIXED_VALUE;
}

/**
 * Reads corner radius only from rect nodes. Mixed selections may include
 * non-rect nodes; commits intentionally apply to the editable rect subset.
 */
export function rectCornerRadiusValue(
	nodes: readonly VectorNode[],
): MixedValue<number> | null {
	const rects = nodes.filter((node) => node.geometry.kind === "rect");
	return mixedValue(rects, (node) =>
		node.geometry.kind === "rect" ? node.geometry.cornerRadius : 0,
	);
}

export function rectNodeCount(nodes: readonly VectorNode[]): number {
	return nodes.filter((node) => node.geometry.kind === "rect").length;
}

const countNodesDeep = (nodes: readonly VectorNode[]): number =>
	nodes.reduce(
		(count, node) =>
			count + 1 + (node.children ? countNodesDeep(node.children) : 0),
		0,
	);

/**
 * Counts every node represented in the document summary, including future group
 * children so the no-selection inspector does not under-report nested scenes.
 */
export function sceneNodeCount(document: SceneDocument): number {
	return document.layers.reduce(
		(count, layer) => count + countNodesDeep(layer.nodes),
		0,
	);
}

export const isShadowOfKind =
	(kind: ShadowEffectKind) =>
	(effect: Effect): effect is ShadowEffect =>
		effect.kind === kind;

export const isLayerBlur = (effect: Effect): effect is BlurEffect =>
	effect.kind === "layer-blur";

/** Returns the first shadow effect of `kind` on the node, or null when absent. */
export const shadowForNode = (
	node: VectorNode,
	kind: ShadowEffectKind,
): ShadowEffect | null =>
	node.style.effects?.find(isShadowOfKind(kind)) ?? null;

/** Reports whether the node's shadow effect of `kind` is present and visible. */
export const shadowEnabled = (
	node: VectorNode,
	kind: ShadowEffectKind,
): boolean => {
	const shadow = shadowForNode(node, kind);
	return shadow ? (shadow.visible ?? true) : false;
};

/** Returns the node's layer-blur effect, or null when absent. */
export const layerBlurForNode = (node: VectorNode): BlurEffect | null =>
	node.style.effects?.find(isLayerBlur) ?? null;

/** Reports whether the node's layer-blur effect is present and visible. */
export const layerBlurEnabled = (node: VectorNode): boolean => {
	const blur = layerBlurForNode(node);
	return blur ? (blur.visible ?? true) : false;
};

const editableNativeMaskRelation = (
	node: VectorNode,
): AppearanceMaskRelationMetadata | undefined =>
	readAppearanceMaskRelations(node).find(
		(relation) => relation.origin === "native" && !!relation.maskNodeId,
	);

/**
 * Returns the single-node object-mask softness surface for the Inspector. Mask
 * relation ids stay explicit here because the editable value belongs to the
 * relation metadata, not to node style or frame Effect Layer state.
 */
export function maskFeatherEditingStateForNode(
	node: VectorNode,
): MaskFeatherEditingState | null {
	const relation = editableNativeMaskRelation(node);
	if (!relation?.maskNodeId) return null;
	return {
		contentNodeId: node.id,
		relationId: relation.id,
		maskNodeId: relation.maskNodeId,
		featherRadius: relation.settings?.featherRadius ?? 0,
		opacity: relation.settings?.opacity ?? 1,
		expand: relation.settings?.expand ?? 0,
		invert: relation.settings?.invert === true,
		channel: relation.settings?.channel ?? "alpha",
		sourceSampling: relation.settings?.sourceSampling ?? "pre-effects",
	};
}

export const uniqueNodeIds = (
	nodeIds: readonly string[],
): readonly string[] => [...new Set(nodeIds)];

export const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const stylePatchChangesNode = (
	node: VectorNode,
	patch: NodeStylePatch,
): boolean =>
	(Object.keys(patch) as (keyof NodeStylePatch)[]).some((field) => {
		const next = patch[field];
		if (next === undefined) return false;
		return !sameSerializable(node.style[field], next);
	});

const createNodeStylePatchCommands = (
	entries: readonly {
		readonly nodeId: string;
		readonly patch: NodeStylePatch;
	}[],
): SceneCommand[] => {
	const document = useSceneStore.getState().document;
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	const seen = new Set<string>();
	return entries.flatMap(({ nodeId, patch }) => {
		if (seen.has(nodeId) || !hasStylePatch(patch)) return [];
		seen.add(nodeId);
		const node = findNode(document, nodeId);
		if (!node || !stylePatchChangesNode(node, patch)) return [];
		return [
			createUpdateNodeStyleCommand(nodeId, patch, {
				preservesPaintIndices: true,
				grammarTargetNodeIds,
				motion,
			}),
		];
	});
};

export const applyStylePatchEntriesAsTransaction = (
	scope: string,
	label: string,
	entries: readonly {
		readonly nodeId: string;
		readonly patch: NodeStylePatch;
	}[],
	coalesceKey?: string,
): boolean => {
	const commands = createNodeStylePatchCommands(entries);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(scope, label, commands, coalesceKey);
};

/**
 * Commits a single selected node's transform field through the same writer used
 * by canvas tools, wrapped in an Inspector-specific transaction so separate
 * field commits stay as separate undo entries.
 */
export function commitSingleTransformNumber(
	node: VectorNode,
	field: TransformNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	if ((field === "width" || field === "height") && value <= 0) return false;
	if (Object.is(inspectorValuesForNode(node)[field], value)) return false;

	const snapshot = {
		nodeId: node.id,
		matrix: matrixFromTransform(node.transform),
	};
	const changed = applyWriterAsTransaction(
		`transform:${node.id}:${field}`,
		"Edit transform",
		() => {
			applyNodeTransform(node.id, {
				matrix: matrixFromInspectorValues(node, { [field]: value }),
			});
		},
	);
	if (changed) {
		recordNodeTransformRepeat(
			[snapshot],
			useSceneStore.getState().document,
			"Edit transform",
			{
				application:
					field === "width" || field === "height" ? "local" : "world",
			},
		);
	}
	return changed;
}

/**
 * Commits opacity through the transform writer because opacity is an animatable
 * scalar in the existing transform bridge. Values are clamped to the scene
 * contract before reaching the command bus.
 */
export function commitSingleOpacity(node: VectorNode, value: number): boolean {
	if (!Number.isFinite(value)) return false;
	return applyWriterAsTransaction(`opacity:${node.id}`, "Edit opacity", () => {
		applyNodeTransform(node.id, { opacity: clampOpacity(value) });
	});
}

export function createNodeStyleCommands(
	nodeIds: readonly string[],
	patch: NodeStylePatch,
): SceneCommand[] {
	const grammarTargetNodeIds = currentMotionGrammarTargetNodeIds();
	const motion = useMotionStore.getState().document;
	return uniqueNodeIds(nodeIds).map((nodeId) =>
		createUpdateNodeStyleCommand(nodeId, patch, {
			grammarTargetNodeIds,
			motion,
		}),
	);
}

/**
 * Validates text color input before batching fill/stroke edits through scene
 * commands. Unsupported CSS values are rejected while still in draft UI state.
 */
export function commitNodeColor(
	nodeIds: readonly string[],
	field: NodeColorField,
	input: string,
): boolean {
	const color = normalizeColorInput(input);
	if (!color) return false;
	return applyCommandsAsTransaction(
		`style:${field}:${nodeIds.join(",")}`,
		"Edit appearance",
		createNodeStyleCommands(nodeIds, { [field]: color }),
	);
}

/**
 * Commits object mask feather through the native relation command. This is kept
 * out of `commitNodeStyleNumber` so the Inspector does not imply that mask
 * softness is a stroke/fill style field.
 */
export function commitMaskRelationFeather(
	contentNodeId: string,
	relationId: string,
	value: number,
): boolean {
	if (!Number.isFinite(value) || value < 0) return false;
	return applyCommandsAsTransaction(
		`mask-relation:${contentNodeId}:${relationId}:feather`,
		"Edit mask blur",
		[
			createSetMaskRelationPropertyCommand(
				contentNodeId,
				relationId,
				MASK_RELATION_FEATHER_PROPERTY_ID,
				value,
			),
		],
	);
}

const MASK_RELATION_SETTING_LABEL: Record<MaskRelationPropertyId, string> = {
	[MASK_RELATION_FEATHER_PROPERTY_ID]: "Edit mask blur",
	[MASK_RELATION_OPACITY_PROPERTY_ID]: "Edit mask opacity",
	[MASK_RELATION_EXPAND_PROPERTY_ID]: "Edit mask expand",
	[MASK_RELATION_INVERT_PROPERTY_ID]: "Edit mask invert",
};

/**
 * Commits one native mask-relation setting (opacity / expand / invert) through
 * the canonical relation command. Finite-only: the scene-command setter owns
 * range semantics (opacity clamps `0..1`, expand is signed, invert reads `0|1`),
 * matching the agent/code write path so UI and AI edits stay coherent. Per-
 * property coalescing keeps a slider/scrub gesture to one undo entry.
 */
export function commitMaskRelationSetting(
	contentNodeId: string,
	relationId: string,
	propertyId: MaskRelationPropertyId,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	return applyCommandsAsTransaction(
		`mask-relation:${contentNodeId}:${relationId}:${propertyId}`,
		MASK_RELATION_SETTING_LABEL[propertyId],
		[
			createSetMaskRelationPropertyCommand(
				contentNodeId,
				relationId,
				propertyId,
				value,
			),
		],
	);
}

/** Commits alpha/luminance and pre/post-effect matte behavior by relation id. */
export function commitMaskRelationBehavior(
	contentNodeId: string,
	relationId: string,
	patch: {
		readonly channel?: AppearanceMaskChannel;
		readonly sourceSampling?: AppearanceMaskSourceSampling;
	},
): boolean {
	return applyCommandsAsTransaction(
		`mask-relation-behavior:${contentNodeId}:${relationId}`,
		"Edit matte behavior",
		[
			createSetMaskRelationBehaviorCommand(contentNodeId, relationId, {
				...patch,
				coordinateSpace: "artboard",
			}),
		],
	);
}

export const typedIncludes = <T extends string>(
	values: readonly T[],
	input: string,
): input is T => values.includes(input as T);
