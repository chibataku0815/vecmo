/**
 * Inspector editing for paint (fill/stroke), gradients, mesh paints, and image-fit — the
 * fill/stroke appearance surface of the Inspector's Appearance section.
 */
import { expandPaintTargetIds } from "@/entities/scene/model/appearance-targets";
import { createSetSharedColorComponentPropCommand } from "@/entities/scene/model/component-prop-commands";
import { componentPropStyleColorTargetOwners } from "@/entities/scene/model/component-props";
import {
	addStop,
	addStopAt,
	convertPaintKind,
	type GradientPaint,
	gradientStops,
	hydrateGradientStops,
	isGradientPaint,
	linearAngleDeg,
	type PaintKind,
	paintLeadColor,
	removeStop,
	reverseStops,
	setLinearAngle,
	setStopColor,
	setStopOffset,
	setStopOpacity,
} from "@/entities/scene/model/gradient-edit";
import {
	canRemoveMeshPoint,
	MESH_FILLABLE_KINDS,
	meshPointAt,
	moveMeshPoint,
	removeMeshPointLines,
	setMeshPointColor,
	setMeshPointOpacity,
} from "@/entities/scene/model/mesh-edit";
import {
	createUpdateNodeStyleCommand,
	type NodeStylePatch,
} from "@/entities/scene/model/node-commands";
import { getGeometryBounds } from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { resolvePaints } from "@/entities/scene/model/style-resolve";
import type {
	ImagePaintFit,
	ImageReferencePaint,
	MeshGradientPaint,
	MeshPoint,
	NodeStyle,
	Paint,
	ShadowEffect,
	ShadowEffectKind,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	VectorNode,
} from "@/entities/scene/model/types";
import { useGradientEditorStore } from "@/features/gradient/model/editor-store";
import { useSelectionStore } from "@/features/selection/model/store";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import {
	STROKE_WIDTH_PROFILE_PRESET_IDS,
	STROKE_WIDTH_PROFILE_PRESETS,
	type StrokeWidthProfileStop,
} from "@/shared/stroke/width-profile";
import {
	type AppearanceEditingState,
	applyCommandsAsTransaction,
	applySceneCommand,
	applyStylePatchEntriesAsTransaction,
	clampOpacity,
	createNodeStyleCommands,
	DEFAULT_BLEND_MODE,
	DEFAULT_STROKE_ALIGN,
	DEFAULT_STROKE_CAP,
	DEFAULT_STROKE_JOIN,
	type GradientEditModel,
	hasStylePatch,
	type ImagePaintEditModel,
	INSPECTOR_BLEND_MODE_VALUES,
	INSPECTOR_IMAGE_FIT_VALUES,
	INSPECTOR_PAINT_KIND_VALUES,
	INSPECTOR_STROKE_ALIGN_VALUES,
	INSPECTOR_STROKE_CAP_VALUES,
	INSPECTOR_STROKE_JOIN_VALUES,
	layerBlurEnabled,
	layerBlurForNode,
	type MeshPaintEditModel,
	type MeshPointEditModel,
	type MeshSubSelectionLike,
	MIXED_VALUE,
	type MixedValue,
	mixedValue,
	normalizeColorInput,
	type PrimaryPaintRole,
	type StrokeOptionField,
	type StrokeStyleKind,
	type StrokeWidthProfileSelection,
	type StyleNumberField,
	selectedNodesForInspector,
	shadowEnabled,
	shadowForNode,
	typedIncludes,
	uniqueNodeIds,
} from "./editing-shared";

const primaryPaintList = (
	style: NodeStyle,
	role: PrimaryPaintRole,
): readonly Paint[] | undefined =>
	role === "fills" ? style.fills : style.strokes;

const legacyPaintColor = (style: NodeStyle, role: PrimaryPaintRole): string =>
	role === "fills" ? style.fill : style.stroke;

const paintRolePatch = (
	role: PrimaryPaintRole,
	paints: readonly Paint[],
): NodeStylePatch =>
	role === "fills" ? { fills: paints } : { strokes: paints };

const primaryPaintSummary = (
	node: VectorNode,
	role: PrimaryPaintRole,
): string => {
	const paints = primaryPaintList(node.style, role);
	if (paints === undefined) {
		const color = legacyPaintColor(node.style, role);
		return color === "none" ? "none" : `solid ${color}`;
	}
	if (paints.length === 0) return "none";
	const suffix = paints.length > 1 ? ` +${paints.length - 1}` : "";
	return `${paints[0]?.kind ?? "none"}${suffix}`;
};

/** An explicit "none" solid — the resolver's shape for a role painted with nothing. */
const isNonePaint = (paint: {
	readonly kind: string;
	readonly color?: string;
}) => paint.kind === "solid" && paint.color === "none";

/**
 * Whether the role's resolved paint list draws anything: at least one paint that
 * survives `Paint.visible` filtering and is not an explicit "none" solid. Shared
 * by the enabled predicate and the enable patch so both agree with the canvas.
 */
const paintRolePaintedForNode = (
	node: VectorNode,
	role: PrimaryPaintRole,
): boolean =>
	resolvePaints(
		primaryPaintList(node.style, role),
		legacyPaintColor(node.style, role),
	).some((paint) => !isNonePaint(paint));

/**
 * The Inspector's "has fill / has stroke" reading. A stroke additionally needs a
 * positive width — a painted stroke at width 0 renders nothing on every surface,
 * so the toggle reports it off (and enabling restores a visible width).
 */
const paintRoleEnabledForNode = (
	node: VectorNode,
	role: PrimaryPaintRole,
): boolean =>
	paintRolePaintedForNode(node, role) &&
	(role === "fills" || node.style.strokeWidth > 0);

const primaryPaintColor = (
	node: VectorNode,
	role: PrimaryPaintRole,
): string | null => {
	const paints = primaryPaintList(node.style, role);
	if (paints === undefined) return legacyPaintColor(node.style, role);
	const paint = paints[0];
	if (!paint) return "none";
	return paint.kind === "solid" ? paint.color : null;
};

const primaryPaintColorEditable = (
	node: VectorNode,
	role: PrimaryPaintRole,
): boolean => {
	const paints = primaryPaintList(node.style, role);
	if (paints === undefined) return true;
	const paint = paints[0];
	return !paint || paint.kind === "solid";
};

const primaryPaintOpacity = (
	node: VectorNode,
	role: PrimaryPaintRole,
): number | null => {
	const paints = primaryPaintList(node.style, role);
	if (paints === undefined) {
		return legacyPaintColor(node.style, role) === "none" ? null : 1;
	}
	const paint = paints[0];
	if (!paint) return null;
	return clampOpacity(paint.opacity ?? 1);
};

const primaryPaintEntry = (
	node: VectorNode,
	role: PrimaryPaintRole,
): Paint | undefined => primaryPaintList(node.style, role)?.[0];

const primaryPaintKind = (
	node: VectorNode,
	role: PrimaryPaintRole,
): PaintKind => primaryPaintEntry(node, role)?.kind ?? "solid";

const primaryImagePaint = (
	node: VectorNode,
	role: PrimaryPaintRole,
): ImageReferencePaint | null => {
	const paint = primaryPaintEntry(node, role);
	return paint?.kind === "image-reference" ? paint : null;
};

const primaryMeshPaint = (
	node: VectorNode,
	role: PrimaryPaintRole,
): MeshGradientPaint | null => {
	const paint = primaryPaintEntry(node, role);
	return paint?.kind === "mesh-gradient" ? paint : null;
};

const imagePaintSourceLabel = (paint: ImageReferencePaint): string => {
	if (paint.assetId) return `asset:${paint.assetId}`;
	if (paint.href) return `href:${paint.href}`;
	return "unresolved";
};

const mixedReadonlyValue = <T>(
	items: readonly T[],
	read: (item: T) => string,
): MixedValue<string> | null => {
	const first = items[0];
	if (!first) return null;
	const value = read(first);
	return items.every((item) => Object.is(read(item), value))
		? value
		: MIXED_VALUE;
};

const mixedImageFit = (
	paints: readonly ImageReferencePaint[],
): MixedValue<ImagePaintFit> | null => {
	const first = paints[0];
	if (!first) return null;
	const fit = first.fit ?? "fill";
	return paints.every((paint) => (paint.fit ?? "fill") === fit)
		? fit
		: MIXED_VALUE;
};

/**
 * Projects image-reference primary paints into an honest Inspector edit model.
 * Fit is editable only when every selected node has an image primary paint; mixed
 * paint selections stay visible but disabled so the user never batch-writes a
 * hidden subset by accident.
 */
const imagePaintEditModelForSelection = (
	nodes: readonly VectorNode[],
	role: PrimaryPaintRole,
): ImagePaintEditModel | null => {
	const images = nodes
		.map((node) => primaryImagePaint(node, role))
		.filter((paint): paint is ImageReferencePaint => paint !== null);
	if (images.length === 0) return null;
	const allImage = images.length === nodes.length;
	return {
		imageCount: images.length,
		totalNodeCount: nodes.length,
		source: mixedReadonlyValue(images, imagePaintSourceLabel),
		fit: mixedImageFit(images),
		canEditFit: allImage,
		unavailableReason: allImage
			? null
			: `Only ${images.length}/${nodes.length} selected paints are images.`,
	};
};

const meshPointEditModel = (
	point: MeshPoint,
	row: number,
	col: number,
): MeshPointEditModel => ({
	row,
	col,
	x: point.point.x,
	y: point.point.y,
	color: point.color,
	opacity: clampOpacity(point.opacity ?? 1),
});

/**
 * Projects the selected mesh point into compact Inspector controls. Mesh grids
 * are single-node authoring surfaces, so multi-selection keeps its appearance
 * summary but does not expose point edits.
 */
const meshPaintEditModelForSelection = (
	nodes: readonly VectorNode[],
	role: PrimaryPaintRole,
	subSelection: MeshSubSelectionLike,
): MeshPaintEditModel | null => {
	const node = nodes.length === 1 ? nodes[0] : undefined;
	if (!node) return null;
	const paint = primaryMeshPaint(node, role);
	if (!paint) return null;
	const selected =
		subSelection?.kind === "mesh-node" &&
		subSelection.nodeId === node.id &&
		subSelection.role === role
			? meshPointAt(paint, subSelection.row, subSelection.col)
			: undefined;
	const selectedPoint =
		selected && subSelection
			? meshPointEditModel(selected, subSelection.row, subSelection.col)
			: null;
	const hasMatchingSubSelection =
		subSelection?.kind === "mesh-node" &&
		subSelection.nodeId === node.id &&
		subSelection.role === role;
	return {
		nodeId: node.id,
		role,
		rows: paint.rows,
		cols: paint.cols,
		pointCount: paint.points.length,
		selectedPoint,
		canEditSelectedPoint: selectedPoint !== null,
		canRemoveSelectedPoint:
			selectedPoint !== null &&
			canRemoveMeshPoint(paint, selectedPoint.row, selectedPoint.col),
		unavailableReason: selectedPoint
			? null
			: hasMatchingSubSelection
				? "Selected mesh point is unavailable."
				: "Select a mesh point to edit.",
	};
};

/**
 * Single-selection gradient model for one role. Gradient stop editing is scoped
 * to a single node so a mixed multi-selection never silently rewrites disparate
 * gradients; the paint-kind switch still applies across the whole selection.
 */
const gradientEditModelForSelection = (
	nodes: readonly VectorNode[],
	role: PrimaryPaintRole,
): GradientEditModel | null => {
	const node = nodes.length === 1 ? nodes[0] : undefined;
	if (!node) return null;
	const paint = primaryPaintEntry(node, role);
	if (!isGradientPaint(paint)) return null;
	return {
		kind: paint.kind,
		angleDeg: paint.kind === "linear-gradient" ? linearAngleDeg(paint) : null,
		stops: gradientStops(paint).map((stop) => ({
			id: stop.id,
			offset: stop.offset,
			color: stop.color,
			opacity: clampOpacity(stop.opacity ?? 1),
		})),
	};
};

const normalizedStrokeDash = (
	strokeDash: readonly number[] | undefined,
): readonly number[] =>
	(strokeDash ?? [])
		.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0))
		.filter((value) => value > 0);

const dottedStrokeGap = (strokeWidth: number): number =>
	Math.max(
		DEFAULT_ENABLED_STROKE_WIDTH,
		Math.max(strokeWidth, DEFAULT_ENABLED_STROKE_WIDTH) *
			DOTTED_STROKE_GAP_RATIO,
	);

const dottedStrokeDashPattern = (strokeWidth: number): readonly number[] => [
	DOTTED_STROKE_DASH_LENGTH,
	dottedStrokeGap(strokeWidth),
];

const strokeStyleKindForNode = (node: VectorNode): StrokeStyleKind => {
	const strokeDash = normalizedStrokeDash(node.style.strokeDash);
	if (strokeDash.length === 0) return "solid";
	const cap = node.style.strokeCap ?? DEFAULT_STROKE_CAP;
	const strokeWidth = Math.max(
		node.style.strokeWidth,
		DEFAULT_ENABLED_STROKE_WIDTH,
	);
	const dottedDashThreshold = Math.max(
		DOTTED_STROKE_DASH_LENGTH,
		strokeWidth * DOTTED_STROKE_DASH_THRESHOLD_RATIO,
	);
	return cap === "round" &&
		strokeDash.length >= 2 &&
		strokeDash[0] <= dottedDashThreshold
		? "dotted"
		: "dashed";
};

const strokeDashDraft = (node: VectorNode): string =>
	normalizedStrokeDash(node.style.strokeDash).join(" ");

const strokeWidthProfileStopsEqual = (
	left: readonly StrokeWidthProfileStop[],
	right: readonly StrokeWidthProfileStop[],
): boolean =>
	left.length === right.length &&
	left.every((stop, index) => {
		const other = right[index];
		return stop.t === other.t && stop.w === other.w;
	});

/**
 * Classifies a node's {@link NodeStyle.strokeWidthProfile} for the Inspector's
 * width-profile select: `"none"` when unset, the matching built-in preset id
 * when the stops deep-equal one of {@link STROKE_WIDTH_PROFILE_PRESETS}, and
 * `"custom"` for any other stop list (agent-authored or future editor output).
 */
const strokeWidthProfileSelectionForNode = (
	node: VectorNode,
): StrokeWidthProfileSelection => {
	const stops = node.style.strokeWidthProfile;
	if (stops === undefined) return "none";
	const presetId = STROKE_WIDTH_PROFILE_PRESET_IDS.find((id) =>
		strokeWidthProfileStopsEqual(stops, STROKE_WIDTH_PROFILE_PRESETS[id]),
	);
	return presetId ?? "custom";
};

/**
 * Builds the full appearance editing model from selected nodes. Paint values
 * expose solid primary paints for direct color editing while preserving
 * gradient/image summaries so the UI can avoid pretending every paint is solid.
 *
 * Paint-derived values (fill/stroke enabled, color, opacity, paint kind,
 * gradient/image/mesh summaries, and the paint-adjacent stroke geometry fields)
 * are read from `nodes` EXPANDED through {@link expandPaintTargetIds}: a
 * selected group or Blend container has no meaningful own paint (its wrapper
 * geometry is a fixed placeholder — see `appearance-targets.ts`), so reading its
 * own style would show a value that does not correspond to anything on canvas.
 * Node-scoped values (opacity, blend mode, shadows, layer blur) keep reading the
 * raw, un-expanded `nodes` because those properties render on the container
 * itself (a group's `<g>` carries opacity/blend for its whole subtree).
 */
export function appearanceEditingStateForSelection(
	nodes: readonly VectorNode[],
	meshSubSelection: MeshSubSelectionLike = null,
): AppearanceEditingState {
	const paintNodeIds = expandPaintTargetIds(
		useSceneStore.getState().document,
		nodes.map((node) => node.id),
	);
	const paintNodes = selectedNodesForInspector(
		useSceneStore.getState().document,
		paintNodeIds,
	);

	const shadowValue = <T>(
		kind: ShadowEffectKind,
		read: (shadow: ShadowEffect) => T,
	): MixedValue<T | null> | null =>
		mixedValue(nodes, (node) => {
			const shadow = shadowForNode(node, kind);
			return shadow ? read(shadow) : null;
		});

	const singleFillNode = paintNodes.length === 1 ? paintNodes[0] : undefined;
	return {
		nodeIds: nodes.map((node) => node.id),
		nodeCount: nodes.length,
		canEdit: nodes.length > 0,
		paintNodeIds,
		values: {
			fillEnabled: mixedValue(paintNodes, (node) =>
				paintRoleEnabledForNode(node, "fills"),
			),
			fillColor: mixedValue(paintNodes, (node) =>
				primaryPaintColor(node, "fills"),
			),
			fillColorEditable:
				paintNodes.length > 0 &&
				paintNodes.every((node) => primaryPaintColorEditable(node, "fills")),
			fillOpacity: mixedValue(paintNodes, (node) =>
				primaryPaintOpacity(node, "fills"),
			),
			fillSummary: mixedValue(paintNodes, (node) =>
				primaryPaintSummary(node, "fills"),
			),
			fillPaintKind: mixedValue(paintNodes, (node) =>
				primaryPaintKind(node, "fills"),
			),
			fillGradient: gradientEditModelForSelection(paintNodes, "fills"),
			fillImage: imagePaintEditModelForSelection(paintNodes, "fills"),
			fillMesh: meshPaintEditModelForSelection(
				paintNodes,
				"fills",
				meshSubSelection,
			),
			fillCanConvertToMesh:
				singleFillNode !== undefined &&
				MESH_FILLABLE_KINDS.has(singleFillNode.geometry.kind) &&
				singleFillNode.style.fills?.[0]?.kind !== "mesh-gradient",
			strokeEnabled: mixedValue(paintNodes, (node) =>
				paintRoleEnabledForNode(node, "strokes"),
			),
			strokeColor: mixedValue(paintNodes, (node) =>
				primaryPaintColor(node, "strokes"),
			),
			strokeColorEditable:
				paintNodes.length > 0 &&
				paintNodes.every((node) => primaryPaintColorEditable(node, "strokes")),
			strokeOpacity: mixedValue(paintNodes, (node) =>
				primaryPaintOpacity(node, "strokes"),
			),
			strokeSummary: mixedValue(paintNodes, (node) =>
				primaryPaintSummary(node, "strokes"),
			),
			strokePaintKind: mixedValue(paintNodes, (node) =>
				primaryPaintKind(node, "strokes"),
			),
			strokeGradient: gradientEditModelForSelection(paintNodes, "strokes"),
			strokeImage: imagePaintEditModelForSelection(paintNodes, "strokes"),
			strokeMesh: meshPaintEditModelForSelection(
				paintNodes,
				"strokes",
				meshSubSelection,
			),
			strokeWidth: mixedValue(paintNodes, (node) => node.style.strokeWidth),
			strokeBlur: mixedValue(
				paintNodes,
				(node) => node.style.strokeSoftness?.blurRadius ?? 0,
			),
			blendMode: mixedValue(
				nodes,
				(node) => node.style.blendMode ?? DEFAULT_BLEND_MODE,
			),
			strokeAlign: mixedValue(
				paintNodes,
				(node) => node.style.strokeAlign ?? DEFAULT_STROKE_ALIGN,
			),
			strokeCap: mixedValue(
				paintNodes,
				(node) => node.style.strokeCap ?? DEFAULT_STROKE_CAP,
			),
			strokeJoin: mixedValue(
				paintNodes,
				(node) => node.style.strokeJoin ?? DEFAULT_STROKE_JOIN,
			),
			strokeDash: mixedValue(paintNodes, strokeDashDraft),
			strokeStyleKind: mixedValue(paintNodes, strokeStyleKindForNode),
			strokeWidthProfile: mixedValue(
				paintNodes,
				strokeWidthProfileSelectionForNode,
			),
			dropShadowEnabled: mixedValue(nodes, (node) =>
				shadowEnabled(node, "drop-shadow"),
			),
			dropShadowColor: shadowValue("drop-shadow", (shadow) => shadow.color),
			dropShadowOpacity: shadowValue("drop-shadow", (shadow) =>
				clampOpacity(shadow.opacity ?? 1),
			),
			dropShadowX: shadowValue("drop-shadow", (shadow) => shadow.offset.x),
			dropShadowY: shadowValue("drop-shadow", (shadow) => shadow.offset.y),
			dropShadowRadius: shadowValue("drop-shadow", (shadow) => shadow.radius),
			dropShadowSpread: shadowValue(
				"drop-shadow",
				(shadow) => shadow.spread ?? 0,
			),
			innerShadowEnabled: mixedValue(nodes, (node) =>
				shadowEnabled(node, "inner-shadow"),
			),
			innerShadowColor: shadowValue("inner-shadow", (shadow) => shadow.color),
			innerShadowOpacity: shadowValue("inner-shadow", (shadow) =>
				clampOpacity(shadow.opacity ?? 1),
			),
			innerShadowX: shadowValue("inner-shadow", (shadow) => shadow.offset.x),
			innerShadowY: shadowValue("inner-shadow", (shadow) => shadow.offset.y),
			innerShadowRadius: shadowValue("inner-shadow", (shadow) => shadow.radius),
			innerShadowSpread: shadowValue(
				"inner-shadow",
				(shadow) => shadow.spread ?? 0,
			),
			layerBlurEnabled: mixedValue(nodes, layerBlurEnabled),
			layerBlurRadius: mixedValue(nodes, (node) => {
				const blur = layerBlurForNode(node);
				return blur ? blur.radius : null;
			}),
			layerBlurRadiusY: mixedValue(nodes, (node) => {
				const blur = layerBlurForNode(node);
				return blur ? (blur.radiusY ?? blur.radius) : null;
			}),
			layerBlurAxesLinked: mixedValue(nodes, (node) => {
				const blur = layerBlurForNode(node);
				return blur ? blur.radiusY === undefined : true;
			}),
		},
	};
}

/**
 * Resolves fill/stroke-scoped commit ids against the live document: a selected
 * group or Blend container expands to its drawable leaves (see
 * {@link expandPaintTargetIds}) so a paint edit reaches the members it visually
 * represents instead of the container's own meaningless wrapper paint, while a
 * leaf or frame id passes through unchanged. Every paint-scoped commit in this
 * module resolves its ids through this helper before deduping/patching so the
 * expansion is applied uniformly across single- and multi-selection, and across
 * mixed selections that include a container alongside plain nodes.
 */
const paintTargetIds = (nodeIds: readonly string[]): readonly string[] =>
	expandPaintTargetIds(useSceneStore.getState().document, nodeIds);

/**
 * Commits batch-editable appearance numbers with inspector-level validation.
 * Opacity is clamped to the scene range; negative stroke widths are rejected
 * before a command can create history.
 */
export function commitNodeStyleNumber(
	nodeIds: readonly string[],
	field: StyleNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	if (field === "opacity") {
		const patch = { opacity: clampOpacity(value) } satisfies NodeStylePatch;
		return applyCommandsAsTransaction(
			`style:${field}:${nodeIds.join(",")}`,
			"Edit appearance",
			createNodeStyleCommands(nodeIds, patch),
		);
	}
	if (value < 0) return false;
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const patch: NodeStylePatch =
			strokeStyleKindForNode(node) === "dotted"
				? {
						strokeWidth: value,
						strokeDash: dottedStrokeDashPattern(value),
						strokeCap: "round",
					}
				: { strokeWidth: value };
		return [{ nodeId, patch }];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${field}:${nodeIds.join(",")}`,
		"Edit appearance",
		entries,
	);
}

/**
 * Commits node-wide stroke-only blur through the canonical node-style command.
 * The value lives on `NodeStyle.strokeSoftness.blurRadius`; a `0`/negative radius
 * clears the softness bucket so the node returns to the byte-identical sharp path.
 * Kept separate from `commitNodeStyleNumber` because the patch is a nested object,
 * not a flat scalar key. Resolves `nodeIds` through {@link paintTargetIds} like
 * every other paint-scoped commit in this module: a container has no own stroke,
 * so blurring it must reach the drawable leaves that actually paint one.
 */
export function commitStrokeBlur(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value) || value < 0) return false;
	const blurRadius = Math.max(0, value);
	const targetIds = paintTargetIds(nodeIds);
	return applyCommandsAsTransaction(
		`style:stroke-softness-blur:${targetIds.join(",")}`,
		"Edit stroke blur",
		createNodeStyleCommands(targetIds, {
			strokeSoftness: { blurRadius },
		}),
	);
}

/**
 * Commits the Inspector's width-profile preset picker. `"none"` clears
 * {@link NodeStyle.strokeWidthProfile}; a built-in preset id writes its stops
 * as-is. `"custom"` has no writable selection (it is a read-only display state
 * for agent-authored or future-editor stop lists that don't match a preset),
 * so it is rejected rather than silently doing nothing useful.
 *
 * Not routed through `applyStylePatchEntriesAsTransaction` because
 * `hasStylePatch` (the shared no-op gate that helper uses) does not enumerate
 * `strokeWidthProfile` — the same reason {@link commitStrokeBlur} bypasses it
 * for `strokeSoftness`. Resolves `nodeIds` through {@link paintTargetIds} like
 * every other paint-scoped stroke commit in this module.
 */
export function commitStrokeWidthProfile(
	nodeIds: readonly string[],
	selection: StrokeWidthProfileSelection,
): boolean {
	if (selection === "custom") return false;
	const strokeWidthProfile =
		selection === "none" ? null : STROKE_WIDTH_PROFILE_PRESETS[selection];
	const targetIds = paintTargetIds(nodeIds);
	return applyCommandsAsTransaction(
		`style:stroke-width-profile:${targetIds.join(",")}`,
		"Edit stroke width profile",
		createNodeStyleCommands(targetIds, { strokeWidthProfile }),
	);
}

const solidPaint = (color: string, opacity: number | undefined): Paint => ({
	kind: "solid",
	color,
	...(opacity === undefined ? {} : { opacity }),
});

const primaryPaintColorPatchForNode = (
	node: VectorNode,
	role: PrimaryPaintRole,
	color: string,
): NodeStylePatch => {
	const paints = primaryPaintList(node.style, role);
	if (paints === undefined && color === legacyPaintColor(node.style, role)) {
		return {};
	}
	const tail = paints?.slice(1) ?? [];
	if (color === "none") {
		return {
			...(role === "fills" ? { fill: color } : { stroke: color }),
			...paintRolePatch(role, []),
		};
	}
	// Carry opacity AND visibility from the replaced primary: a color edit on a
	// hidden paint recolors it without resurrecting it (the on/off toggle owns
	// visibility; its enable path re-shows the seeded paint explicitly).
	const current = paints?.[0];
	const nextPaint = {
		...solidPaint(color, current?.opacity),
		...(current?.visible === undefined ? {} : { visible: current.visible }),
	};
	return {
		...(role === "fills" ? { fill: color } : { stroke: color }),
		...paintRolePatch(role, [nextPaint, ...tail]),
	};
};

/**
 * Commits the primary fill/stroke paint as a solid paint while preserving any
 * secondary paint-list entries. The matching legacy color is updated too so
 * current canvas code and resolver/export paths stay aligned for solid edits.
 */
export function commitPrimaryPaintColor(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	input: string,
	coalesceKey?: string,
): boolean {
	const color = normalizeColorInput(input);
	if (!color || nodeIds.length === 0) return false;
	const store = useSceneStore.getState();
	const document = store.document;
	const targetIds = uniqueNodeIds(paintTargetIds(nodeIds));
	const ownerSets = targetIds.map((nodeId) =>
		componentPropStyleColorTargetOwners(document, {
			kind: "style-color",
			nodeId,
			role: role === "fills" ? "fill" : "stroke",
			paintIndex: 0,
		}),
	);
	const hasSharedOwner = ownerSets.some((owners) => owners.length > 0);
	if (hasSharedOwner) {
		if (color === "none" || ownerSets.some((owners) => owners.length !== 1)) {
			return false;
		}
		const owner = ownerSets[0]?.[0];
		if (!owner || ownerSets.some((owners) => owners[0]?.id !== owner.id)) {
			return false;
		}
		const before = store.document;
		store.apply(
			createSetSharedColorComponentPropCommand(owner.id, color, {
				...(coalesceKey ? { coalesceKey } : {}),
			}),
		);
		return useSceneStore.getState().document !== before;
	}
	const entries = targetIds.flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		return node
			? [{ nodeId, patch: primaryPaintColorPatchForNode(node, role, color) }]
			: [];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:color:${nodeIds.join(",")}`,
		"Edit appearance",
		entries,
		coalesceKey,
	);
}

const primaryPaintOpacityPatchForNode = (
	node: VectorNode,
	role: PrimaryPaintRole,
	opacity: number,
): NodeStylePatch | null => {
	const paints = primaryPaintList(node.style, role);
	if (paints !== undefined) {
		const paint = paints[0];
		if (!paint) return null;
		return paintRolePatch(role, [{ ...paint, opacity }, ...paints.slice(1)]);
	}
	const color = legacyPaintColor(node.style, role);
	if (color === "none") return null;
	if (opacity === 1) return null;
	return paintRolePatch(role, [solidPaint(color, opacity)]);
};

/**
 * Commits primary paint opacity through expressive paint lists. Pass a gesture
 * `coalesceKey` for live slider drags so every tick lands in one held
 * transaction (one undo per gesture), mirroring {@link commitPrimaryPaintColor}.
 */
export function commitPrimaryPaintOpacity(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	value: number,
	coalesceKey?: string,
): boolean {
	if (!Number.isFinite(value) || nodeIds.length === 0) return false;
	const opacity = clampOpacity(value);
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		const patch = node
			? primaryPaintOpacityPatchForNode(node, role, opacity)
			: null;
		return patch ? [{ nodeId, patch }] : [];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:opacity:${nodeIds.join(",")}`,
		"Edit appearance",
		entries,
		coalesceKey,
	);
}

/** Solid color restored when enabling a role whose paint resolves to "none". */
const DEFAULT_ENABLED_FILL_COLOR = "#ffffff";
const DEFAULT_ENABLED_STROKE_COLOR = "#000000";
/** Width restored when enabling a stroke that would stay invisible at 0. */
const DEFAULT_ENABLED_STROKE_WIDTH = 1;
/** Dash pattern seeded when switching a solid stroke to dashed. */
const DEFAULT_STROKE_DASH_PATTERN: readonly number[] = [4, 4];
/**
 * SVG zero-length dashes are normalized away by the command/resolver pipeline, so
 * the dotted preset stores a tiny positive dash and relies on round caps for dots.
 */
const DOTTED_STROKE_DASH_LENGTH = 0.01;
const DOTTED_STROKE_GAP_RATIO = 2;
const DOTTED_STROKE_DASH_THRESHOLD_RATIO = 0.1;

const allPaintsHidden = (paints: readonly Paint[]): boolean =>
	paints.length > 0 && paints.every((paint) => paint.visible === false);

const revealedPaints = (paints: readonly Paint[]): readonly Paint[] =>
	paints.map((paint) =>
		paint.visible === false ? { ...paint, visible: true } : paint,
	);

/**
 * Patch that makes a role paint again. Prefers un-hiding an all-hidden stack
 * (restoring exactly what the off toggle hid — gradients, meshes, secondary
 * paints and all); falls back to seeding a default solid when the role resolves
 * to an explicit "none". Strokes also get a visible width when theirs is 0.
 */
const enablePaintRolePatchForNode = (
	node: VectorNode,
	role: PrimaryPaintRole,
): NodeStylePatch => {
	const paints = primaryPaintList(node.style, role);
	const legacy = legacyPaintColor(node.style, role);
	const paintPatch = (() => {
		if (paintRolePaintedForNode(node, role)) return {};
		if (paints !== undefined && allPaintsHidden(paints)) {
			const revealed = revealedPaints(paints);
			if (
				resolvePaints(revealed, legacy).some((paint) => !isNonePaint(paint))
			) {
				return paintRolePatch(role, revealed);
			}
		}
		// Seed a default solid, then force the seeded list visible: the color
		// patch preserves the replaced paint's hidden flag by design, but this IS
		// the on switch — an enable that leaves the seed hidden would be a no-op.
		const seeded = primaryPaintColorPatchForNode(
			node,
			role,
			role === "fills"
				? DEFAULT_ENABLED_FILL_COLOR
				: DEFAULT_ENABLED_STROKE_COLOR,
		);
		const seededPaints = role === "fills" ? seeded.fills : seeded.strokes;
		return seededPaints
			? { ...seeded, ...paintRolePatch(role, revealedPaints(seededPaints)) }
			: seeded;
	})();
	if (role === "strokes" && !(node.style.strokeWidth > 0)) {
		return { ...paintPatch, strokeWidth: DEFAULT_ENABLED_STROKE_WIDTH };
	}
	return paintPatch;
};

/**
 * Patch that stops a role from painting without destroying it: every paint in
 * the stack is flagged `visible: false` (materializing the legacy single color
 * into a hidden solid when no list exists yet), so re-enabling round-trips
 * gradients/images/meshes intact. Stroke width is deliberately left alone.
 */
const disablePaintRolePatchForNode = (
	node: VectorNode,
	role: PrimaryPaintRole,
): NodeStylePatch => {
	if (!paintRolePaintedForNode(node, role)) return {};
	const paints = primaryPaintList(node.style, role) ?? [
		solidPaint(legacyPaintColor(node.style, role), undefined),
	];
	return paintRolePatch(
		role,
		paints.map((paint) =>
			paint.visible === false ? paint : { ...paint, visible: false },
		),
	);
};

/**
 * Toggles whether a paint role renders at all — the Inspector's "has fill / has
 * stroke" switch. Off hides every paint via `Paint.visible`, which every
 * renderer and exporter already drops at resolve time; on re-shows them, seeding
 * a default solid color (and a visible stroke width) only when nothing would
 * otherwise appear.
 */
export function commitPaintRoleEnabled(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	enabled: boolean,
): boolean {
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const patch = enabled
			? enablePaintRolePatchForNode(node, role)
			: disablePaintRolePatchForNode(node, role);
		return hasStylePatch(patch) ? [{ nodeId, patch }] : [];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:enabled:${nodeIds.join(",")}`,
		`${enabled ? "Show" : "Hide"} ${role === "fills" ? "fill" : "stroke"}`,
		entries,
	);
}

/**
 * One-click stroke style switch. "Solid" clears the dash array; "dashed" seeds
 * the default pattern only when leaving solid/dotted, so an existing custom dash
 * pattern is not overwritten by re-selecting Dashed. "Dotted" writes a near-zero
 * dash pattern and round cap because SVG dots are a dash/cap coupling, not a
 * standalone stroke style.
 */
export function commitStrokeStyleKind(
	nodeIds: readonly string[],
	kind: StrokeStyleKind,
): boolean {
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = strokeStyleKindForNode(node);
		if (current === kind) return [];
		const patch = (() => {
			if (kind === "solid") {
				return { strokeDash: [] } satisfies NodeStylePatch;
			}
			if (kind === "dotted") {
				return {
					strokeDash: dottedStrokeDashPattern(node.style.strokeWidth),
					strokeCap: "round",
				} satisfies NodeStylePatch;
			}
			return {
				strokeDash: DEFAULT_STROKE_DASH_PATTERN,
			} satisfies NodeStylePatch;
		})();
		return [{ nodeId, patch }];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:strokeDash:${nodeIds.join(",")}`,
		"Edit stroke options",
		entries,
	);
}

const legacyColorPatch = (
	role: PrimaryPaintRole,
	color: string,
): NodeStylePatch => (role === "fills" ? { fill: color } : { stroke: color });

/**
 * Builds the style patch that replaces a role's primary paint with a new paint
 * (or none) while keeping any secondary paints and syncing the legacy flat color
 * to the paint's lead color so canvas/export/eyedropper stay aligned.
 */
const primaryPaintReplacementPatch = (
	node: VectorNode,
	role: PrimaryPaintRole,
	next: Paint | null,
): NodeStylePatch => {
	if (!next) return {};
	const tail = primaryPaintList(node.style, role)?.slice(1) ?? [];
	const legacy = paintLeadColor(next, legacyPaintColor(node.style, role));
	return {
		...legacyColorPatch(role, legacy),
		...paintRolePatch(role, [next, ...tail]),
	};
};

/**
 * Couples a single-node paint-kind switch to the gradient tool so the on-canvas
 * endpoint handles appear (and accept drags) without the user discovering the `G`
 * shortcut. The gradient overlay's visual gate and canvas pointer routing are keyed
 * on the active tool, while the gradient editor's ephemeral target role decides
 * whether those handles edit the primary fill or stroke paint.
 */
const revealGradientToolForPaintKind = (
	role: PrimaryPaintRole,
	input: string,
): void => {
	const editor = useToolSelectionStore.getState();
	const gradientEditor = useGradientEditorStore.getState();
	if (input === "linear-gradient" || input === "radial-gradient") {
		gradientEditor.setTargetRole(role);
		editor.setActiveTool("gradient");
		return;
	}
	if (
		input === "solid" &&
		editor.activeTool === "gradient" &&
		gradientEditor.targetRole === role
	) {
		editor.setActiveTool("select");
		gradientEditor.setTargetRole("fills");
	}
};

/** Converts the primary paint of every selected node to the requested kind. */
export function commitPaintKind(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	input: string,
): boolean {
	if (!typedIncludes(INSPECTOR_PAINT_KIND_VALUES, input)) return false;
	const document = useSceneStore.getState().document;
	const ids = uniqueNodeIds(paintTargetIds(nodeIds));
	const entries = ids.flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const next = convertPaintKind(
			primaryPaintEntry(node, role),
			input,
			legacyPaintColor(node.style, role),
			getGeometryBounds(node.geometry),
		);
		return [{ nodeId, patch: primaryPaintReplacementPatch(node, role, next) }];
	});
	const applied = applyStylePatchEntriesAsTransaction(
		`style:${role}:kind:${nodeIds.join(",")}`,
		"Edit paint type",
		entries,
	);
	if (applied && ids.length === 1) {
		revealGradientToolForPaintKind(role, input);
	}
	return applied;
}

/** Reads the live primary gradient paint for Inspector drag gestures. */
export function liveGradientPaintForInspector(
	nodeId: string,
	role: PrimaryPaintRole,
): GradientPaint | null {
	const node = findNode(useSceneStore.getState().document, nodeId);
	const paint = node ? primaryPaintEntry(node, role) : undefined;
	return isGradientPaint(paint) ? paint : null;
}

/**
 * Writes a live primary gradient paint during Inspector ramp drags, preserving
 * secondary paints and routing the mutation through the scene command bus.
 */
export function commitLiveGradientPaint(
	nodeId: string,
	role: PrimaryPaintRole,
	paint: GradientPaint,
	coalesceKey: string,
): boolean {
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return false;
	const tail = primaryPaintList(node.style, role)?.slice(1) ?? [];
	return applySceneCommand({
		...createUpdateNodeStyleCommand(
			nodeId,
			{
				...paintRolePatch(role, [paint, ...tail]),
			},
			{ preservesPaintIndices: true },
		),
		coalesceKey,
	});
}

/** Commits image-reference fit mode when every selected primary paint is image-backed. */
export function commitImagePaintFit(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	input: string,
): boolean {
	if (!typedIncludes(INSPECTOR_IMAGE_FIT_VALUES, input)) return false;
	const ids = uniqueNodeIds(paintTargetIds(nodeIds));
	if (ids.length === 0) return false;
	const document = useSceneStore.getState().document;
	let imageCandidates = 0;
	const entries = ids.flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		const paint = node ? primaryImagePaint(node, role) : null;
		if (!node || !paint) return [];
		imageCandidates += 1;
		if ((paint.fit ?? "fill") === input) return [];
		const tail = primaryPaintList(node.style, role)?.slice(1) ?? [];
		return [
			{
				nodeId,
				patch: paintRolePatch(role, [{ ...paint, fit: input }, ...tail]),
			},
		];
	});
	if (imageCandidates !== ids.length) return false;
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:image-fit:${ids.join(",")}`,
		"Edit image fit",
		entries,
	);
}

const meshPointMutation = (
	nodeId: string,
	role: PrimaryPaintRole,
	row: number,
	col: number,
	scope: string,
	label: string,
	mutate: (
		paint: MeshGradientPaint,
		point: MeshPoint,
	) => MeshGradientPaint | null,
): boolean => {
	if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return false;
	const paint = primaryMeshPaint(node, role);
	if (!paint) return false;
	const point = meshPointAt(paint, row, col);
	if (!point) return false;
	const next = mutate(paint, point);
	if (!next) return false;
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:mesh-${scope}:${nodeId}:${row}:${col}`,
		label,
		[
			{
				nodeId,
				patch: primaryPaintReplacementPatch(node, role, next),
			},
		],
	);
};

/** Recolors one selected mesh point after validating Inspector hex input. */
export function commitMeshPointColor(
	nodeId: string,
	role: PrimaryPaintRole,
	row: number,
	col: number,
	input: string,
): boolean {
	const color = normalizeColorInput(input);
	if (!color || color === "none") return false;
	return meshPointMutation(
		nodeId,
		role,
		row,
		col,
		"point-color",
		"Edit mesh point",
		(paint) => setMeshPointColor(paint, row, col, color),
	);
}

export type MeshPointNumberField = "x" | "y" | "opacity";

/** Edits one selected mesh point position or opacity with finite-value guards. */
export function commitMeshPointNumber(
	nodeId: string,
	role: PrimaryPaintRole,
	row: number,
	col: number,
	field: MeshPointNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	return meshPointMutation(
		nodeId,
		role,
		row,
		col,
		`point-${field}`,
		"Edit mesh point",
		(paint, point) => {
			if (field === "opacity") {
				return setMeshPointOpacity(paint, row, col, value);
			}
			return moveMeshPoint(paint, row, col, {
				x: field === "x" ? value : point.point.x,
				y: field === "y" ? value : point.point.y,
			});
		},
	);
}

/**
 * Removes the selected mesh point's interior lines (its row and/or column) — the
 * Inspector twin of the canvas Alt-click/Delete gesture, sharing
 * {@link removeMeshPointLines} so both delete identically. A corner point is not
 * removable and returns false without mutating (the button is disabled for it).
 * On success it clears the now-stale `(row, col)` sub-selection so the Inspector
 * and overlay stop addressing a point that moved or no longer exists.
 */
export function commitMeshRemovePoint(
	nodeId: string,
	role: PrimaryPaintRole,
	row: number,
	col: number,
): boolean {
	const removed = meshPointMutation(
		nodeId,
		role,
		row,
		col,
		"remove-point",
		"Remove mesh point",
		(paint) => {
			const next = removeMeshPointLines(paint, row, col);
			return next === paint ? null : next;
		},
	);
	if (removed) useSelectionStore.getState().setSubSelection(null);
	return removed;
}

const applyGradientStopMutation = (
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	scope: string,
	label: string,
	mutate: (paint: GradientPaint) => GradientPaint | null,
	coalesceKey?: string,
): boolean => {
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const paint = primaryPaintEntry(node, role);
		if (!isGradientPaint(paint)) return [];
		const next = mutate(paint);
		return [{ nodeId, patch: primaryPaintReplacementPatch(node, role, next) }];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:${scope}:${nodeIds.join(",")}`,
		label,
		entries,
		coalesceKey,
	);
};

/** Recolors one gradient stop after validating the CSS color input. */
export function commitGradientStopColor(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	index: number,
	input: string,
	coalesceKey?: string,
): boolean {
	const color = normalizeColorInput(input);
	if (!color) return false;
	return applyGradientStopMutation(
		nodeIds,
		role,
		`stop-color:${index}`,
		"Edit gradient stop",
		(paint) => setStopColor(paint, index, color),
		coalesceKey,
	);
}

/** Moves one gradient stop; the offset is clamped to [0, 1] by the model. */
export function commitGradientStopOffset(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	index: number,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	return applyGradientStopMutation(
		nodeIds,
		role,
		`stop-offset:${index}`,
		"Edit gradient stop",
		(paint) => setStopOffset(paint, index, value),
	);
}

/**
 * Sets one gradient stop's opacity; clamped to [0, 1] by the model. A `coalesceKey`
 * collapses a live alpha-slider drag into one undo entry (the stop color picker
 * passes a per-gesture key, mirroring `commitGradientStopColor`).
 */
export function commitGradientStopOpacity(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	index: number,
	value: number,
	coalesceKey?: string,
): boolean {
	if (!Number.isFinite(value)) return false;
	return applyGradientStopMutation(
		nodeIds,
		role,
		`stop-opacity:${index}`,
		"Edit gradient stop",
		(paint) => setStopOpacity(paint, index, value),
		coalesceKey,
	);
}

/**
 * Backfills stable stop ids onto a legacy/id-less gradient via one command-bus
 * write, so the inspector ramp can address every stop by id (id-less stops are
 * skipped on render). Idempotent: already-hydrated gradients write nothing and
 * add no undo entry. Mirrors the canvas handler's `ensureHydrated`.
 */
export function commitHydrateGradientStops(
	nodeId: string,
	role: PrimaryPaintRole,
): boolean {
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return false;
	const paint = primaryPaintEntry(node, role);
	if (!isGradientPaint(paint)) return false;
	const hydrated = hydrateGradientStops(paint);
	if (hydrated === paint) return false;
	return applyStylePatchEntriesAsTransaction(
		`style:${role}:hydrate-stops:${nodeId}`,
		"Prepare gradient",
		[{ nodeId, patch: primaryPaintReplacementPatch(node, role, hydrated) }],
	);
}

/** Mirrors the gradient stops (offset → 1 − offset) on a single node's primary gradient. */
export function commitReverseGradientStops(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
): boolean {
	return applyGradientStopMutation(
		nodeIds,
		role,
		"stop-reverse",
		"Reverse gradient",
		(paint) => reverseStops(paint),
	);
}

/**
 * Re-aims a linear gradient to `deg` (node-local), rotating about the axis midpoint
 * while preserving its length, on a single node's primary fill/stroke gradient.
 */
export function commitLinearGradientAngle(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	deg: number,
): boolean {
	if (!Number.isFinite(deg)) return false;
	return applyGradientStopMutation(
		nodeIds,
		role,
		"gradient-angle",
		"Edit gradient angle",
		(paint) =>
			paint.kind === "linear-gradient" ? setLinearAngle(paint, deg) : null,
	);
}

/**
 * Inserts a gradient stop at `offset` on a single node's primary gradient (sampling
 * the interpolated color), returning the new stop's id so the caller can select it,
 * or `null` if the node has no editable gradient in the role.
 */
export function commitAddGradientStopAt(
	nodeId: string,
	role: PrimaryPaintRole,
	offset: number,
): string | null {
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return null;
	const paint = primaryPaintEntry(node, role);
	if (!isGradientPaint(paint)) return null;
	const added = addStopAt(paint, offset);
	const committed = applyStylePatchEntriesAsTransaction(
		`style:${role}:stop-add-at:${nodeId}`,
		"Add gradient stop",
		[{ nodeId, patch: primaryPaintReplacementPatch(node, role, added.paint) }],
	);
	return committed ? added.stopId : null;
}

/** Inserts a gradient stop in the widest gap of the role's primary gradient. */
export function commitAddGradientStop(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
): boolean {
	return applyGradientStopMutation(
		nodeIds,
		role,
		"stop-add",
		"Add gradient stop",
		(paint) => addStop(paint),
	);
}

/** Removes a gradient stop unless that would drop below the two-stop minimum. */
export function commitRemoveGradientStop(
	nodeIds: readonly string[],
	role: PrimaryPaintRole,
	index: number,
): boolean {
	return applyGradientStopMutation(
		nodeIds,
		role,
		`stop-remove:${index}`,
		"Remove gradient stop",
		(paint) => removeStop(paint, index),
	);
}

/** Commits node blend mode after validating the scene blend union. */
export function commitBlendMode(
	nodeIds: readonly string[],
	input: string,
): boolean {
	if (!typedIncludes(INSPECTOR_BLEND_MODE_VALUES, input)) return false;
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node || (node.style.blendMode ?? DEFAULT_BLEND_MODE) === input) {
			return [];
		}
		return [{ nodeId, patch: { blendMode: input } satisfies NodeStylePatch }];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:blend:${nodeIds.join(",")}`,
		"Edit appearance",
		entries,
	);
}

const strokeOptionPatch = (
	field: StrokeOptionField,
	input: string,
): Pick<NodeStyle, StrokeOptionField> | null => {
	if (
		field === "strokeAlign" &&
		typedIncludes(INSPECTOR_STROKE_ALIGN_VALUES, input)
	) {
		return { strokeAlign: input };
	}
	if (
		field === "strokeCap" &&
		typedIncludes(INSPECTOR_STROKE_CAP_VALUES, input)
	) {
		return { strokeCap: input };
	}
	if (
		field === "strokeJoin" &&
		typedIncludes(INSPECTOR_STROKE_JOIN_VALUES, input)
	) {
		return { strokeJoin: input };
	}
	return null;
};

const resolvedStrokeOption = (
	node: VectorNode,
	field: StrokeOptionField,
): StrokeAlign | StrokeCap | StrokeJoin => {
	if (field === "strokeAlign") {
		return node.style.strokeAlign ?? DEFAULT_STROKE_ALIGN;
	}
	if (field === "strokeCap") return node.style.strokeCap ?? DEFAULT_STROKE_CAP;
	return node.style.strokeJoin ?? DEFAULT_STROKE_JOIN;
};

/** Commits stroke align/cap/join options using resolver-compatible defaults. */
export function commitStrokeOption(
	nodeIds: readonly string[],
	field: StrokeOptionField,
	input: string,
): boolean {
	const patch = strokeOptionPatch(field, input);
	if (!patch) return false;
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node || resolvedStrokeOption(node, field) === input) return [];
		return [{ nodeId, patch }];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${field}:${nodeIds.join(",")}`,
		"Edit stroke options",
		entries,
	);
}

export function normalizeStrokeDashInput(
	input: string,
): readonly number[] | null {
	const trimmed = input.trim();
	if (trimmed === "") return [];
	const values = trimmed.split(/[,\s]+/u).map((part) => Number(part));
	if (values.some((value) => !Number.isFinite(value) || value < 0)) {
		return null;
	}
	return values.filter((value) => value > 0);
}

/** Commits the editable stroke dash list from a compact space/comma draft. */
export function commitStrokeDash(
	nodeIds: readonly string[],
	input: string,
): boolean {
	const strokeDash = normalizeStrokeDashInput(input);
	if (!strokeDash) return false;
	const document = useSceneStore.getState().document;
	const nextDraft = strokeDash.join(" ");
	const entries = uniqueNodeIds(paintTargetIds(nodeIds)).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node || strokeDashDraft(node) === nextDraft) return [];
		return [{ nodeId, patch: { strokeDash } satisfies NodeStylePatch }];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:strokeDash:${nodeIds.join(",")}`,
		"Edit stroke options",
		entries,
	);
}

/**
 * Commits visible text color through the node appearance command used by canvas,
 * SVG, and PDF renderers. The helper re-filters live text nodes so mixed
 * selections cannot accidentally recolor non-text geometry through the Text
 * section.
 */
export function commitTextFill(
	nodeIds: readonly string[],
	input: string,
	coalesceKey?: string,
): boolean {
	if (nodeIds.length === 0) return false;
	const document = useSceneStore.getState().document;
	const textNodeIds = uniqueNodeIds(nodeIds).filter(
		(nodeId) => findNode(document, nodeId)?.geometry.kind === "text",
	);
	if (textNodeIds.length === 0) return false;
	return commitPrimaryPaintColor(textNodeIds, "fills", input, coalesceKey);
}
