import {
	composeMatrix,
	getNodeParentBounds,
	type Matrix2D,
	matrixFromTransform,
	transformFromMatrix,
} from "./rendering";
import { allNodes } from "./selectors";
import type {
	Bounds,
	LayoutCellFitMode,
	LayoutCellPlacement,
	LayoutFrameAutoFlow,
	LayoutFrameContract,
	LayoutFrameGap,
	LayoutFramePadding,
	LayoutFramePresetId,
	LayoutFrameVariantContract,
	LayoutFrameVariantMode,
	SceneDocument,
	Transform,
	Vec2,
	VectorNode,
} from "./types";

/**
 * Sparse layout edit accepted by GUI and MCP command compilers. Gap/padding are
 * intentionally partial so a single inspector field can update one side/axis.
 */
export type LayoutFramePatch = Partial<
	Pick<LayoutFrameContract, "columns" | "rows" | "autoFlow">
> & {
	readonly allowOverlap?: boolean | null;
	readonly preset?: LayoutFramePresetId | null;
	readonly gap?: Partial<LayoutFrameGap>;
	readonly padding?: Partial<LayoutFramePadding>;
	readonly placements?: LayoutFrameContract["placements"] | null;
	readonly variantMode?: LayoutFrameVariantMode | null;
	readonly activeVariantId?: string | null;
	readonly variants?: readonly LayoutFrameVariantContract[] | null;
};

/** Concrete resolved rectangle for one direct child of a layout frame. */
export type LayoutFrameCell = {
	readonly nodeId: string;
	readonly placement: LayoutCellPlacement;
	readonly bounds: Bounds;
};

/** Fully materializable layout plan for one frame snapshot. */
export type LayoutFramePlan = {
	readonly layout: LayoutFrameContract;
	readonly columns: number;
	readonly rows: number;
	readonly cells: readonly LayoutFrameCell[];
};

/** Presets exposed consistently in the Inspector and MCP command schema. */
export const LAYOUT_FRAME_PRESET_IDS = [
	"uniform-grid",
	"bento-hero-left",
	"bento-hero-top",
	"bento-mosaic",
] as const satisfies readonly LayoutFramePresetId[];

const normalizePresetId = (preset: unknown): LayoutFramePresetId | undefined =>
	typeof preset === "string" &&
	(LAYOUT_FRAME_PRESET_IDS as readonly string[]).includes(preset)
		? (preset as LayoutFramePresetId)
		: undefined;

/** Default layout used when a frame is first promoted to Grid/Bento authoring. */
export const DEFAULT_LAYOUT_FRAME_CONTRACT = {
	kind: "grid",
	version: 1,
	columns: 3,
	rows: "auto",
	gap: { x: 16, y: 16 },
	padding: { top: 16, right: 16, bottom: 16, left: 16 },
	autoFlow: "row",
} as const satisfies LayoutFrameContract;

const layoutIdentityTransform = (anchor: Vec2): Transform => ({
	position: { x: 0, y: 0 },
	rotation: 0,
	scale: { x: 1, y: 1 },
	anchor,
});

/**
 * Degrees of rotation tolerated as "axis-aligned" before a box-like layout
 * child falls back to the rotation-preserving fit-matrix branch. Kept tiny —
 * this only absorbs floating-point drift from repeated matrix round-trips,
 * not a real authored tilt.
 */
const LAYOUT_AXIS_ROTATION_EPSILON = 1e-6;

/** Whether a rotation (in degrees) is effectively 0/360 within the epsilon. */
const isAxisAlignedLayoutRotation = (rotation: number): boolean => {
	const turns = ((rotation % 360) + 360) % 360;
	return (
		turns < LAYOUT_AXIS_ROTATION_EPSILON ||
		360 - turns < LAYOUT_AXIS_ROTATION_EPSILON
	);
};

/**
 * Re-derives a transform anchor so it stays at the same RELATIVE position
 * inside a child's box after that box is re-materialized into new bounds
 * (e.g. old cell → new cell). This is purely a bookkeeping preservation: at
 * rest (identity position/rotation/scale) the anchor has no visual effect, but
 * a later rotate/scale keyframe pivots around it, so silently resetting it to
 * a corner on every relayout would visibly break authored motion. Falls back
 * to the raw anchor when the previous box was degenerate/non-finite.
 */
const anchorRelativeToBounds = (
	anchor: Vec2,
	previousBounds: Bounds,
	nextBounds: Bounds,
): Vec2 => {
	const relativeX =
		previousBounds.width > 0
			? (anchor.x - previousBounds.x) / previousBounds.width
			: undefined;
	const relativeY =
		previousBounds.height > 0
			? (anchor.y - previousBounds.y) / previousBounds.height
			: undefined;
	return {
		x:
			relativeX !== undefined && Number.isFinite(relativeX)
				? nextBounds.x + relativeX * nextBounds.width
				: anchor.x,
		y:
			relativeY !== undefined && Number.isFinite(relativeY)
				? nextBounds.y + relativeY * nextBounds.height
				: anchor.y,
	};
};

const isRectLikeGeometry = (
	geometry: VectorNode["geometry"],
): geometry is Extract<
	VectorNode["geometry"],
	{ readonly kind: "rect" | "ellipse" | "text" | "image" }
> =>
	geometry.kind === "rect" ||
	geometry.kind === "ellipse" ||
	geometry.kind === "text" ||
	geometry.kind === "image";

const matrixForLayoutBoundsFit = (
	parentBounds: Bounds,
	target: Bounds,
	fit: LayoutCellFitMode = "contain",
): Matrix2D => {
	const scaleCandidates = [
		parentBounds.width > 0 ? target.width / parentBounds.width : undefined,
		parentBounds.height > 0 ? target.height / parentBounds.height : undefined,
	].filter((value): value is number => value !== undefined);
	const rawScale =
		scaleCandidates.length > 0
			? fit === "cover"
				? Math.max(...scaleCandidates)
				: Math.min(...scaleCandidates)
			: 1;
	const scale =
		Number.isFinite(rawScale) && rawScale >= 0 ? Math.max(1e-6, rawScale) : 1;
	const sourceCenter = {
		x: parentBounds.x + parentBounds.width / 2,
		y: parentBounds.y + parentBounds.height / 2,
	};
	const targetCenter = {
		x: target.x + target.width / 2,
		y: target.y + target.height / 2,
	};
	return {
		a: scale,
		b: 0,
		c: 0,
		d: scale,
		e: targetCenter.x - sourceCenter.x * scale,
		f: targetCenter.y - sourceCenter.y * scale,
	};
};

export type LayoutMaterializedChildPatch = Pick<
	VectorNode,
	"geometry" | "transform"
>;

/**
 * Projects a layout-managed child into a concrete cell without changing
 * fields outside geometry/transform. Axis-aligned (rotation ≈ 0) box-like
 * geometry owns its cell rectangle directly, resetting position/rotation/
 * scale to identity; its transform anchor is re-derived at the same RELATIVE
 * position inside the new bounds (see {@link anchorRelativeToBounds}) so a
 * later rotate/scale keyframe still pivots where it was authored, even though
 * re-materialization runs on every layout-relevant patch. A rotated box-like
 * child — and every non-box (vector) shape regardless of rotation — instead
 * fits its current parent-space bounds into the target via a contain/cover
 * matrix composed over the existing transform, which preserves the authored
 * rotation and aspect.
 */
export function materializeLayoutChildIntoBounds(
	node: VectorNode,
	bounds: Bounds,
	fit: LayoutCellFitMode = "contain",
): LayoutMaterializedChildPatch {
	if (
		isRectLikeGeometry(node.geometry) &&
		isAxisAlignedLayoutRotation(node.transform.rotation)
	) {
		return {
			geometry: {
				...node.geometry,
				bounds,
			},
			transform: layoutIdentityTransform(
				anchorRelativeToBounds(
					node.transform.anchor,
					node.geometry.bounds,
					bounds,
				),
			),
		};
	}

	const fitMatrix = matrixForLayoutBoundsFit(
		getNodeParentBounds(node),
		bounds,
		fit,
	);
	return {
		geometry: node.geometry,
		transform: transformFromMatrix(
			composeMatrix(fitMatrix, matrixFromTransform(node.transform)),
			node.transform.anchor,
		),
	};
}

/**
 * Every direct child id of any layout frame in the document. Ordinary
 * transform gestures (canvas drag, Inspector X/Y/W/H) treat these ids as
 * layout-owned geometry — the layout materializer re-derives their
 * geometry/transform on every layout-relevant patch, so a raw write to one is
 * either fought back on the next reapply or silently discarded.
 */
export function collectLayoutManagedChildIds(
	document: SceneDocument,
): ReadonlySet<string> {
	const managedIds = new Set<string>();
	for (const node of allNodes(document)) {
		if (!node.frame?.layout) continue;
		for (const child of node.children ?? []) managedIds.add(child.id);
	}
	return managedIds;
}

const finiteOr = (value: number | undefined, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const wholeAtLeast = (value: number | undefined, min: number): number =>
	Math.max(min, Math.floor(finiteOr(value, min)));

const nonNegative = (value: number | undefined): number =>
	Math.max(0, finiteOr(value, 0));

const finiteNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeGap = (
	gap: Partial<LayoutFrameGap> | undefined,
): LayoutFrameGap => ({
	x: nonNegative(finiteNumber(gap?.x) ?? DEFAULT_LAYOUT_FRAME_CONTRACT.gap.x),
	y: nonNegative(finiteNumber(gap?.y) ?? DEFAULT_LAYOUT_FRAME_CONTRACT.gap.y),
});

const normalizePadding = (
	padding: Partial<LayoutFramePadding> | undefined,
): LayoutFramePadding => ({
	top: nonNegative(
		finiteNumber(padding?.top) ?? DEFAULT_LAYOUT_FRAME_CONTRACT.padding.top,
	),
	right: nonNegative(
		finiteNumber(padding?.right) ?? DEFAULT_LAYOUT_FRAME_CONTRACT.padding.right,
	),
	bottom: nonNegative(
		finiteNumber(padding?.bottom) ??
			DEFAULT_LAYOUT_FRAME_CONTRACT.padding.bottom,
	),
	left: nonNegative(
		finiteNumber(padding?.left) ?? DEFAULT_LAYOUT_FRAME_CONTRACT.padding.left,
	),
});

const normalizeAutoFlow = (
	autoFlow: LayoutFrameAutoFlow | undefined,
): LayoutFrameAutoFlow =>
	autoFlow === "column" ? "column" : DEFAULT_LAYOUT_FRAME_CONTRACT.autoFlow;

const normalizeCellFit = (
	fit: LayoutCellFitMode | undefined,
): LayoutCellFitMode | undefined => {
	if (fit === "cover") return fit;
	return undefined;
};

const normalizeVariantMode = (
	variantMode: LayoutFrameVariantMode | null | undefined,
): LayoutFrameVariantMode | undefined =>
	variantMode === "auto" || variantMode === "manual" ? variantMode : undefined;

const normalizeAllowOverlap = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

const normalizePlacement = (
	placement: unknown,
	columns: number,
): LayoutCellPlacement | null => {
	if (!isRecord(placement)) return null;
	const column = Math.min(
		columns - 1,
		wholeAtLeast(finiteNumber(placement.column), 0),
	);
	const row = wholeAtLeast(finiteNumber(placement.row), 0);
	const columnSpan = Math.min(
		columns - column,
		wholeAtLeast(finiteNumber(placement.columnSpan), 1),
	);
	const rowSpan = wholeAtLeast(finiteNumber(placement.rowSpan), 1);
	const fit = normalizeCellFit(placement.fit === "cover" ? "cover" : undefined);
	return {
		column,
		row,
		...(columnSpan === 1 ? {} : { columnSpan }),
		...(rowSpan === 1 ? {} : { rowSpan }),
		...(fit ? { fit } : {}),
	};
};

const normalizePlacements = (
	placements: LayoutFrameContract["placements"] | undefined,
	columns: number,
): LayoutFrameContract["placements"] | undefined => {
	if (!isRecord(placements)) return undefined;
	const normalized: Record<string, LayoutCellPlacement> = {};
	for (const [nodeId, placement] of Object.entries(placements)) {
		const value = normalizePlacement(placement, columns);
		if (!value) continue;
		normalized[nodeId] = value;
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const placementEndColumn = (placement: LayoutCellPlacement): number =>
	placement.column + (placement.columnSpan ?? 1);

const placementEndRow = (placement: LayoutCellPlacement): number =>
	placement.row + (placement.rowSpan ?? 1);

const placementsOverlap = (
	left: LayoutCellPlacement,
	right: LayoutCellPlacement,
): boolean =>
	left.column < placementEndColumn(right) &&
	placementEndColumn(left) > right.column &&
	left.row < placementEndRow(right) &&
	placementEndRow(left) > right.row;

const placementMapWithPriority = (
	placements: LayoutFrameContract["placements"] | undefined,
	nodeId: string,
	placement: LayoutCellPlacement,
	columns: number,
	options: { readonly allowOverlap?: boolean } = {},
): LayoutFrameContract["placements"] => {
	const normalizedPlacement = normalizePlacement(placement, columns) ?? {
		column: 0,
		row: 0,
	};
	const output: Record<string, LayoutCellPlacement> = {};
	for (const [candidateNodeId, candidatePlacement] of Object.entries(
		placements ?? {},
	)) {
		if (candidateNodeId === nodeId) continue;
		const normalizedCandidate = normalizePlacement(candidatePlacement, columns);
		if (!normalizedCandidate) continue;
		if (
			!options.allowOverlap &&
			placementsOverlap(normalizedCandidate, normalizedPlacement)
		) {
			continue;
		}
		output[candidateNodeId] = normalizedCandidate;
	}
	output[nodeId] = normalizedPlacement;
	return output;
};

const placementMapWithPrioritySet = (
	placements: LayoutFrameContract["placements"] | undefined,
	updates: readonly {
		readonly nodeId: string;
		readonly placement: LayoutCellPlacement;
	}[],
	columns: number,
	options: { readonly allowOverlap?: boolean } = {},
): LayoutFrameContract["placements"] => {
	const prioritized = new Map<string, LayoutCellPlacement>();
	for (const update of updates) {
		const normalizedPlacement = normalizePlacement(update.placement, columns);
		if (!normalizedPlacement) continue;
		prioritized.set(update.nodeId, normalizedPlacement);
	}
	if (prioritized.size === 0) return normalizePlacements(placements, columns);
	const output: Record<string, LayoutCellPlacement> = {};
	const priorityPlacements = [...prioritized.values()];
	for (const [candidateNodeId, candidatePlacement] of Object.entries(
		placements ?? {},
	)) {
		if (prioritized.has(candidateNodeId)) continue;
		const normalizedCandidate = normalizePlacement(candidatePlacement, columns);
		if (!normalizedCandidate) continue;
		if (
			!options.allowOverlap &&
			priorityPlacements.some((placement) =>
				placementsOverlap(normalizedCandidate, placement),
			)
		) {
			continue;
		}
		output[candidateNodeId] = normalizedCandidate;
	}
	for (const [nodeId, placement] of prioritized) {
		output[nodeId] = placement;
	}
	return output;
};

const normalizeVariantName = (name: unknown, index: number): string =>
	(typeof name === "string" ? name.trim() : "") || `Variant ${index + 1}`;

const normalizeVariant = (
	variant: unknown,
	baseColumns: number,
	index: number,
): LayoutFrameVariantContract | null => {
	if (!isRecord(variant) || typeof variant.id !== "string") return null;
	const id = variant.id.trim();
	if (!id) return null;
	const columns =
		typeof variant.columns === "number"
			? wholeAtLeast(finiteNumber(variant.columns), 1)
			: undefined;
	const rows =
		variant.rows === "auto"
			? "auto"
			: typeof variant.rows === "number"
				? wholeAtLeast(finiteNumber(variant.rows), 1)
				: undefined;
	const gap = isRecord(variant.gap)
		? {
				...(finiteNumber(variant.gap.x) === undefined
					? {}
					: { x: nonNegative(finiteNumber(variant.gap.x)) }),
				...(finiteNumber(variant.gap.y) === undefined
					? {}
					: { y: nonNegative(finiteNumber(variant.gap.y)) }),
			}
		: undefined;
	const padding = isRecord(variant.padding)
		? {
				...(finiteNumber(variant.padding.top) === undefined
					? {}
					: { top: nonNegative(finiteNumber(variant.padding.top)) }),
				...(finiteNumber(variant.padding.right) === undefined
					? {}
					: { right: nonNegative(finiteNumber(variant.padding.right)) }),
				...(finiteNumber(variant.padding.bottom) === undefined
					? {}
					: { bottom: nonNegative(finiteNumber(variant.padding.bottom)) }),
				...(finiteNumber(variant.padding.left) === undefined
					? {}
					: { left: nonNegative(finiteNumber(variant.padding.left)) }),
			}
		: undefined;
	const placementColumns = columns ?? baseColumns;
	const placements = normalizePlacements(
		isRecord(variant.placements)
			? (variant.placements as LayoutFrameContract["placements"])
			: undefined,
		placementColumns,
	);
	const minWidth =
		typeof variant.minWidth === "number"
			? nonNegative(finiteNumber(variant.minWidth))
			: undefined;
	const rawMaxWidth =
		typeof variant.maxWidth === "number"
			? nonNegative(finiteNumber(variant.maxWidth))
			: undefined;
	const maxWidth =
		rawMaxWidth === undefined || minWidth === undefined
			? rawMaxWidth
			: Math.max(minWidth, rawMaxWidth);
	const preset = normalizePresetId(variant.preset);
	const allowOverlap = normalizeAllowOverlap(variant.allowOverlap);
	return {
		id,
		name: normalizeVariantName(variant.name, index),
		...(minWidth === undefined ? {} : { minWidth }),
		...(maxWidth === undefined ? {} : { maxWidth }),
		...(columns === undefined ? {} : { columns }),
		...(rows === undefined ? {} : { rows }),
		...(gap && Object.keys(gap).length > 0 ? { gap } : {}),
		...(padding && Object.keys(padding).length > 0 ? { padding } : {}),
		...(variant.autoFlow === "row" || variant.autoFlow === "column"
			? { autoFlow: normalizeAutoFlow(variant.autoFlow) }
			: {}),
		...(allowOverlap === undefined ? {} : { allowOverlap }),
		...(preset ? { preset } : {}),
		...(placements ? { placements } : {}),
	};
};

const normalizeVariants = (
	variants: readonly LayoutFrameVariantContract[] | undefined,
	baseColumns: number,
): readonly LayoutFrameVariantContract[] | undefined => {
	if (!Array.isArray(variants)) return undefined;
	const seen = new Set<string>();
	const normalized: LayoutFrameVariantContract[] = [];
	for (const [index, variant] of variants.entries()) {
		const value = normalizeVariant(variant, baseColumns, index);
		if (!value || seen.has(value.id)) continue;
		seen.add(value.id);
		normalized.push(value);
	}
	return normalized.length > 0 ? normalized : undefined;
};

/**
 * Normalizes a possibly partial grid contract into the serial shape commands
 * store on a frame. The function clamps negative and non-finite values so GUI
 * text fields and MCP JSON both reach the same safe authoring state.
 */
export function normalizeLayoutFrameContract(
	input: LayoutFrameContract | LayoutFramePatch | undefined,
): LayoutFrameContract {
	const columns = wholeAtLeast(
		input?.columns,
		DEFAULT_LAYOUT_FRAME_CONTRACT.columns,
	);
	const rows =
		input?.rows === "auto"
			? "auto"
			: wholeAtLeast(
					typeof input?.rows === "number" ? input.rows : undefined,
					1,
				);
	const placements =
		input?.placements === null
			? undefined
			: normalizePlacements(input?.placements, columns);
	const variants =
		input?.variants === null
			? undefined
			: normalizeVariants(input?.variants, columns);
	const activeVariantIdInput = input?.activeVariantId;
	const activeVariantId =
		typeof activeVariantIdInput === "string" &&
		variants?.some((variant) => variant.id === activeVariantIdInput.trim())
			? activeVariantIdInput.trim()
			: undefined;
	const variantMode = normalizeVariantMode(input?.variantMode);
	const allowOverlap = normalizeAllowOverlap(input?.allowOverlap);
	const preset = normalizePresetId(input?.preset);
	return {
		kind: "grid",
		version: 1,
		columns,
		rows,
		gap: normalizeGap(input?.gap),
		padding: normalizePadding(input?.padding),
		autoFlow: normalizeAutoFlow(input?.autoFlow),
		...(allowOverlap ? { allowOverlap: true } : {}),
		...(preset ? { preset } : {}),
		...(placements ? { placements } : {}),
		...(variantMode ? { variantMode } : {}),
		...(activeVariantId ? { activeVariantId } : {}),
		...(variants ? { variants } : {}),
	};
}

const variantPatch = (
	variant: LayoutFrameVariantContract,
	patch: LayoutFramePatch,
): LayoutFrameVariantContract => {
	const { allowOverlap, gap, padding, preset, placements, ...rest } = variant;
	return {
		...rest,
		...(patch.columns === undefined ? {} : { columns: patch.columns }),
		...(patch.rows === undefined ? {} : { rows: patch.rows }),
		...(patch.gap
			? { gap: { ...(gap ?? {}), ...patch.gap } }
			: gap
				? { gap }
				: {}),
		...(patch.padding
			? { padding: { ...(padding ?? {}), ...patch.padding } }
			: padding
				? { padding }
				: {}),
		...(patch.autoFlow === undefined ? {} : { autoFlow: patch.autoFlow }),
		...(patch.allowOverlap === undefined
			? allowOverlap === undefined
				? {}
				: { allowOverlap }
			: patch.allowOverlap === null
				? {}
				: { allowOverlap: patch.allowOverlap }),
		...(patch.preset === undefined
			? preset
				? { preset }
				: {}
			: patch.preset === null
				? {}
				: { preset: patch.preset }),
		...(patch.placements === null
			? {}
			: patch.placements
				? { placements: patch.placements }
				: placements
					? { placements }
					: {}),
	};
};

/**
 * Merges a sparse layout patch over the current contract. Passing
 * `placements: null` clears explicit child placement and lets auto-flow fill the
 * frame again.
 */
export function patchLayoutFrameContract(
	current: LayoutFrameContract | undefined,
	patch: LayoutFramePatch,
): LayoutFrameContract {
	const base = normalizeLayoutFrameContract(current);
	return normalizeLayoutFrameContract({
		...base,
		...patch,
		gap: patch.gap ? { ...base.gap, ...patch.gap } : base.gap,
		padding: patch.padding
			? { ...base.padding, ...patch.padding }
			: base.padding,
		placements:
			patch.placements === null
				? undefined
				: (patch.placements ?? base.placements),
		activeVariantId:
			patch.activeVariantId === null
				? undefined
				: (patch.activeVariantId ?? base.activeVariantId),
		variantMode:
			patch.variantMode === null
				? undefined
				: (patch.variantMode ?? base.variantMode),
		allowOverlap:
			patch.allowOverlap === null
				? undefined
				: (patch.allowOverlap ?? base.allowOverlap),
		variants:
			patch.variants === null ? undefined : (patch.variants ?? base.variants),
	});
}

/**
 * Resolves the variant that a GUI or MCP write should mutate. Auto mode with a
 * known frame width is strictly WYSIWYG: the write targets only the width-matched
 * variant, and falls back to the base layout when no breakpoint matches.
 */
export function resolveLayoutFrameWriteVariantId(
	input: LayoutFrameContract | LayoutFramePatch | undefined,
	width?: number,
): string | undefined {
	const layout = normalizeLayoutFrameContract(input);
	if (layout.variantMode !== "auto") return layout.activeVariantId;
	const resolvedWidth = finiteNumber(width);
	return resolvedWidth === undefined
		? layout.activeVariantId
		: resolveLayoutFrameVariantId(layout, resolvedWidth);
}

const patchBaseLayoutWriteTarget = (
	base: LayoutFrameContract,
	patch: LayoutFramePatch,
	options: { readonly width?: number },
	targetVariantId: string | undefined,
): LayoutFrameContract => {
	const shouldClearUnresolvedAutoTarget =
		targetVariantId === undefined &&
		base.variantMode === "auto" &&
		finiteNumber(options.width) !== undefined &&
		patch.activeVariantId === undefined &&
		patch.variantMode === undefined &&
		patch.variants === undefined;

	return patchLayoutFrameContract(base, {
		...patch,
		...(shouldClearUnresolvedAutoTarget ? { activeVariantId: null } : {}),
	});
};

/** Merges layout fields into the active variant when one is selected. */
export function patchActiveLayoutFrameContract(
	current: LayoutFrameContract | undefined,
	patch: LayoutFramePatch,
	options: { readonly width?: number } = {},
): LayoutFrameContract {
	const base = normalizeLayoutFrameContract(current);
	const targetVariantId = resolveLayoutFrameWriteVariantId(base, options.width);
	if (!targetVariantId || patch.activeVariantId !== undefined) {
		return patchBaseLayoutWriteTarget(base, patch, options, targetVariantId);
	}
	if (patch.variantMode !== undefined)
		return patchLayoutFrameContract(base, patch);
	if (patch.variants !== undefined)
		return patchLayoutFrameContract(base, patch);
	const variants = base.variants?.map((variant) =>
		variant.id === targetVariantId ? variantPatch(variant, patch) : variant,
	);
	return normalizeLayoutFrameContract({
		...base,
		activeVariantId: targetVariantId,
		variants,
	});
}

/** Updates one child placement in the active layout target. */
export function patchLayoutFramePlacementContract(
	current: LayoutFrameContract | undefined,
	nodeId: string,
	placement: LayoutCellPlacement,
	options: { readonly width?: number } = {},
): LayoutFrameContract {
	const base = normalizeLayoutFrameContract(current);
	const targetVariantId = resolveLayoutFrameWriteVariantId(base, options.width);
	if (targetVariantId && base.variants) {
		const variants = base.variants.map((variant) => {
			if (variant.id !== targetVariantId) return variant;
			const columns = variant.columns ?? base.columns;
			const allowOverlap = variant.allowOverlap ?? base.allowOverlap;
			return {
				...variant,
				placements: placementMapWithPriority(
					variant.placements ?? base.placements,
					nodeId,
					placement,
					columns,
					{ allowOverlap },
				),
			};
		});
		return normalizeLayoutFrameContract({
			...base,
			activeVariantId: targetVariantId,
			variants,
		});
	}
	return patchBaseLayoutWriteTarget(
		base,
		{
			placements: placementMapWithPriority(
				base.placements,
				nodeId,
				placement,
				base.columns,
				{ allowOverlap: base.allowOverlap },
			),
		},
		options,
		targetVariantId,
	);
}

/** Updates a set of child placements in the active layout target as one priority group. */
export function patchLayoutFramePlacementsContract(
	current: LayoutFrameContract | undefined,
	updates: readonly {
		readonly nodeId: string;
		readonly placement: LayoutCellPlacement;
	}[],
	options: { readonly width?: number } = {},
): LayoutFrameContract {
	const base = normalizeLayoutFrameContract(current);
	const targetVariantId = resolveLayoutFrameWriteVariantId(base, options.width);
	if (targetVariantId && base.variants) {
		const variants = base.variants.map((variant) => {
			if (variant.id !== targetVariantId) return variant;
			const columns = variant.columns ?? base.columns;
			const allowOverlap = variant.allowOverlap ?? base.allowOverlap;
			return {
				...variant,
				placements: placementMapWithPrioritySet(
					variant.placements ?? base.placements,
					updates,
					columns,
					{ allowOverlap },
				),
			};
		});
		return normalizeLayoutFrameContract({
			...base,
			activeVariantId: targetVariantId,
			variants,
		});
	}
	return patchBaseLayoutWriteTarget(
		base,
		{
			placements: placementMapWithPrioritySet(
				base.placements,
				updates,
				base.columns,
				{ allowOverlap: base.allowOverlap },
			),
		},
		options,
		targetVariantId,
	);
}

const variantWidthRange = (
	variant: LayoutFrameVariantContract,
): { readonly min: number; readonly max: number } => ({
	min: variant.minWidth ?? 0,
	max: variant.maxWidth ?? Number.POSITIVE_INFINITY,
});

const variantMatchesWidth = (
	variant: LayoutFrameVariantContract,
	width: number,
): boolean => {
	if (variant.minWidth === undefined && variant.maxWidth === undefined) {
		return false;
	}
	const range = variantWidthRange(variant);
	return width >= range.min && width <= range.max;
};

const activeVariantForLayout = (
	layout: LayoutFrameContract,
	width?: number,
): LayoutFrameVariantContract | undefined => {
	if (!layout.variants) return undefined;
	if (layout.variantMode === "auto" && width !== undefined) {
		return [...layout.variants]
			.filter((variant) => variantMatchesWidth(variant, Math.max(0, width)))
			.sort((left, right) => {
				const leftRange = variantWidthRange(left);
				const rightRange = variantWidthRange(right);
				if (leftRange.min !== rightRange.min) {
					return rightRange.min - leftRange.min;
				}
				if (leftRange.max !== rightRange.max) {
					return leftRange.max - rightRange.max;
				}
				return 0;
			})[0];
	}
	return layout.variants.find(
		(variant) => variant.id === layout.activeVariantId,
	);
};

/**
 * Resolves the variant currently responsible for materialization. Manual mode
 * follows `activeVariantId`; auto mode uses the frame width and ignores variants
 * that have no breakpoint bounds.
 */
export function resolveLayoutFrameVariantId(
	input: LayoutFrameContract | LayoutFramePatch | undefined,
	width?: number,
): string | undefined {
	const layout = normalizeLayoutFrameContract(input);
	return activeVariantForLayout(layout, width)?.id;
}

const layoutBaseForEffective = (
	layout: LayoutFrameContract,
): LayoutFrameContract =>
	normalizeLayoutFrameContract({
		kind: "grid",
		version: 1,
		columns: layout.columns,
		rows: layout.rows,
		gap: layout.gap,
		padding: layout.padding,
		autoFlow: layout.autoFlow,
		...(layout.allowOverlap ? { allowOverlap: true } : {}),
		...(layout.preset ? { preset: layout.preset } : {}),
		...(layout.placements ? { placements: layout.placements } : {}),
	});

const variantOverridesForEffective = (
	variant: LayoutFrameVariantContract,
): LayoutFramePatch => ({
	...(variant.columns === undefined ? {} : { columns: variant.columns }),
	...(variant.rows === undefined ? {} : { rows: variant.rows }),
	...(variant.gap ? { gap: variant.gap } : {}),
	...(variant.padding ? { padding: variant.padding } : {}),
	...(variant.autoFlow ? { autoFlow: variant.autoFlow } : {}),
	...(variant.allowOverlap === undefined
		? {}
		: { allowOverlap: variant.allowOverlap }),
	...(variant.preset ? { preset: variant.preset } : {}),
	...(variant.placements ? { placements: variant.placements } : {}),
});

/** Resolves the concrete layout currently materialized from base + variant. */
export function effectiveLayoutFrameContract(
	input: LayoutFrameContract | LayoutFramePatch | undefined,
	options: { readonly width?: number } = {},
): LayoutFrameContract {
	const base = normalizeLayoutFrameContract(input);
	const variant = activeVariantForLayout(base, options.width);
	const baseWithoutVariants = layoutBaseForEffective(base);
	if (!variant) {
		return normalizeLayoutFrameContract(baseWithoutVariants);
	}
	return normalizeLayoutFrameContract({
		...baseWithoutVariants,
		...variantOverridesForEffective(variant),
		gap: variant.gap ? { ...base.gap, ...variant.gap } : base.gap,
		padding: variant.padding
			? { ...base.padding, ...variant.padding }
			: base.padding,
		placements: variant.placements ?? base.placements,
	});
}

const layoutWithResolvedPlacements = (
	layout: LayoutFrameContract,
	placements: Readonly<Record<string, LayoutCellPlacement>>,
	targetVariantId?: string,
): LayoutFrameContract => {
	if (targetVariantId && layout.variants) {
		return normalizeLayoutFrameContract({
			...layout,
			activeVariantId: targetVariantId,
			variants: layout.variants.map((variant) =>
				variant.id === targetVariantId ? { ...variant, placements } : variant,
			),
		});
	}
	if (layout.variantMode === "auto") {
		return normalizeLayoutFrameContract({
			...layout,
			activeVariantId: null,
			placements,
		});
	}
	return normalizeLayoutFrameContract({ ...layout, placements });
};

const cellKey = (row: number, column: number): string => `${row}:${column}`;

const markOccupied = (
	occupied: Set<string>,
	placement: LayoutCellPlacement,
): void => {
	const columnSpan = placement.columnSpan ?? 1;
	const rowSpan = placement.rowSpan ?? 1;
	for (let row = placement.row; row < placement.row + rowSpan; row += 1) {
		for (
			let column = placement.column;
			column < placement.column + columnSpan;
			column += 1
		) {
			occupied.add(cellKey(row, column));
		}
	}
};

const placementFits = (
	occupied: ReadonlySet<string>,
	placement: LayoutCellPlacement,
	columns: number,
): boolean => {
	const columnSpan = placement.columnSpan ?? 1;
	const rowSpan = placement.rowSpan ?? 1;
	if (placement.column + columnSpan > columns) return false;
	for (let row = placement.row; row < placement.row + rowSpan; row += 1) {
		for (
			let column = placement.column;
			column < placement.column + columnSpan;
			column += 1
		) {
			if (occupied.has(cellKey(row, column))) return false;
		}
	}
	return true;
};

const firstFreePlacement = (
	occupied: ReadonlySet<string>,
	columns: number,
	minRows: number,
	autoFlow: LayoutFrameAutoFlow,
): LayoutCellPlacement => {
	const rowLimit = Math.max(1, minRows);
	if (autoFlow === "column") {
		for (let column = 0; column < columns; column += 1) {
			for (let row = 0; row < rowLimit; row += 1) {
				const placement = { column, row };
				if (placementFits(occupied, placement, columns)) return placement;
			}
		}
	}
	for (let row = 0; row < rowLimit; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const placement = { column, row };
			if (placementFits(occupied, placement, columns)) return placement;
		}
	}
	return { column: 0, row: rowLimit };
};

const placementWithOrigin = (
	placement: LayoutCellPlacement,
	column: number,
	row: number,
): LayoutCellPlacement => {
	const columnSpan = placement.columnSpan ?? 1;
	const rowSpan = placement.rowSpan ?? 1;
	return {
		column,
		row,
		...(columnSpan === 1 ? {} : { columnSpan }),
		...(rowSpan === 1 ? {} : { rowSpan }),
		...(placement.fit ? { fit: placement.fit } : {}),
	};
};

const firstFreePlacementForSpan = (
	occupied: ReadonlySet<string>,
	columns: number,
	minRows: number,
	autoFlow: LayoutFrameAutoFlow,
	template: LayoutCellPlacement,
): LayoutCellPlacement => {
	const columnSpan = Math.min(template.columnSpan ?? 1, columns);
	const rowSpan = template.rowSpan ?? 1;
	const rowLimit = Math.max(1, minRows);
	const candidateFor = (column: number, row: number): LayoutCellPlacement =>
		placementWithOrigin(
			{
				...template,
				columnSpan,
				rowSpan,
			},
			column,
			row,
		);
	if (autoFlow === "column") {
		for (let column = 0; column <= columns - columnSpan; column += 1) {
			for (let row = 0; row < rowLimit; row += 1) {
				const placement = candidateFor(column, row);
				if (placementFits(occupied, placement, columns)) return placement;
			}
		}
	}
	for (let row = 0; row < rowLimit; row += 1) {
		for (let column = 0; column <= columns - columnSpan; column += 1) {
			const placement = candidateFor(column, row);
			if (placementFits(occupied, placement, columns)) return placement;
		}
	}
	return candidateFor(0, rowLimit);
};

const packablePlacement = (
	placement: LayoutCellPlacement | undefined,
	columns: number,
): LayoutCellPlacement =>
	normalizePlacement(placement, columns) ?? {
		column: 0,
		row: 0,
	};

const packLayoutFramePlacements = (
	layout: LayoutFrameContract,
	childNodeIds: readonly string[],
): Readonly<Record<string, LayoutCellPlacement>> => {
	const output: Record<string, LayoutCellPlacement> = {};
	const occupied = new Set<string>();
	const baseRows =
		layout.rows === "auto"
			? Math.max(1, Math.ceil(childNodeIds.length / layout.columns))
			: layout.rows;
	for (const [index, nodeId] of childNodeIds.entries()) {
		const desired = packablePlacement(
			layout.placements?.[nodeId],
			layout.columns,
		);
		const placement = placementFits(occupied, desired, layout.columns)
			? desired
			: firstFreePlacementForSpan(
					occupied,
					layout.columns,
					baseRows + Math.floor(index / layout.columns),
					layout.autoFlow,
					desired,
				);
		output[nodeId] = placement;
		markOccupied(occupied, placement);
	}
	return output;
};

const resolvePlacements = (
	layout: LayoutFrameContract,
	childNodeIds: readonly string[],
): Readonly<Record<string, LayoutCellPlacement>> => {
	const output: Record<string, LayoutCellPlacement> = {};
	const occupied = new Set<string>();
	const baseRows =
		layout.rows === "auto"
			? Math.max(1, Math.ceil(childNodeIds.length / layout.columns))
			: layout.rows;
	for (const nodeId of childNodeIds) {
		const explicit = normalizePlacement(
			layout.placements?.[nodeId],
			layout.columns,
		);
		if (!explicit) continue;
		if (
			!layout.allowOverlap &&
			!placementFits(occupied, explicit, layout.columns)
		) {
			continue;
		}
		output[nodeId] = explicit;
		markOccupied(occupied, explicit);
	}
	for (const nodeId of childNodeIds) {
		if (output[nodeId]) continue;
		const placement = firstFreePlacement(
			occupied,
			layout.columns,
			baseRows + Math.floor(Object.keys(output).length / layout.columns),
			layout.autoFlow,
		);
		output[nodeId] = placement;
		markOccupied(occupied, placement);
	}
	return output;
};

const rowsForPlacements = (
	layout: LayoutFrameContract,
	placements: Readonly<Record<string, LayoutCellPlacement>>,
): number => {
	const authoredRows = layout.rows === "auto" ? 1 : layout.rows;
	let rows = authoredRows;
	for (const placement of Object.values(placements)) {
		rows = Math.max(rows, placement.row + (placement.rowSpan ?? 1));
	}
	return Math.max(1, rows);
};

const cellBounds = (
	frameBounds: Bounds,
	layout: LayoutFrameContract,
	rows: number,
	placement: LayoutCellPlacement,
): Bounds => {
	const contentX = frameBounds.x + layout.padding.left;
	const contentY = frameBounds.y + layout.padding.top;
	const contentWidth = Math.max(
		0,
		frameBounds.width -
			layout.padding.left -
			layout.padding.right -
			layout.gap.x * (layout.columns - 1),
	);
	const contentHeight = Math.max(
		0,
		frameBounds.height -
			layout.padding.top -
			layout.padding.bottom -
			layout.gap.y * (rows - 1),
	);
	const columnWidth = contentWidth / layout.columns;
	const rowHeight = contentHeight / rows;
	const columnSpan = placement.columnSpan ?? 1;
	const rowSpan = placement.rowSpan ?? 1;
	return {
		x: contentX + placement.column * (columnWidth + layout.gap.x),
		y: contentY + placement.row * (rowHeight + layout.gap.y),
		width: Math.max(
			0,
			columnWidth * columnSpan + layout.gap.x * (columnSpan - 1),
		),
		height: Math.max(0, rowHeight * rowSpan + layout.gap.y * (rowSpan - 1)),
	};
};

/**
 * Resolves every direct child into a concrete cell rectangle in frame-local
 * coordinates. The returned `layout` includes explicit placements for all child
 * ids so later GUI/MCP edits address stable cells rather than relying on order.
 */
export function resolveLayoutFramePlan(
	frameBounds: Bounds,
	layoutInput: LayoutFrameContract | LayoutFramePatch | undefined,
	childNodeIds: readonly string[],
): LayoutFramePlan {
	const layout = normalizeLayoutFrameContract(layoutInput);
	const targetVariantId = resolveLayoutFrameVariantId(
		layout,
		frameBounds.width,
	);
	const effective = effectiveLayoutFrameContract(layout, {
		width: frameBounds.width,
	});
	const placements = resolvePlacements(effective, childNodeIds);
	const rows = rowsForPlacements(effective, placements);
	const cells = childNodeIds.map((nodeId) => {
		const placement = placements[nodeId] ?? { column: 0, row: 0 };
		return {
			nodeId,
			placement,
			bounds: cellBounds(frameBounds, effective, rows, placement),
		};
	});
	return {
		layout: layoutWithResolvedPlacements(layout, placements, targetVariantId),
		columns: effective.columns,
		rows,
		cells,
	};
}

/**
 * Rewrites explicit child placements into a non-overlapping packed set while
 * preserving each child's authored span and Fit/Fill mode where possible. This
 * is the repair operation behind GUI/MCP "Pack cells"; unlike a plain reapply,
 * conflicted bento cards keep their footprint and are moved to the first cell
 * range that can contain that footprint.
 */
export function packLayoutFramePlacementsContract(
	current: LayoutFrameContract | undefined,
	childNodeIds: readonly string[],
	options: { readonly width?: number } = {},
): LayoutFrameContract {
	const base = normalizeLayoutFrameContract(current);
	const targetVariantId = resolveLayoutFrameWriteVariantId(base, options.width);
	const effective = effectiveLayoutFrameContract(base, {
		width: options.width,
	});
	const placements = packLayoutFramePlacements(effective, childNodeIds);
	return layoutWithResolvedPlacements(base, placements, targetVariantId);
}

const autoColumnsForCount = (count: number): number =>
	Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));

const placementRecord = (
	childNodeIds: readonly string[],
	placements: readonly LayoutCellPlacement[],
): Readonly<Record<string, LayoutCellPlacement>> => {
	const output: Record<string, LayoutCellPlacement> = {};
	for (const [index, nodeId] of childNodeIds.entries()) {
		const placement = placements[index];
		if (!placement) break;
		output[nodeId] = placement;
	}
	return output;
};

/**
 * Builds the authoring patch for a named bento/grid preset. Presets are ordinary
 * layout contracts, not template geometry, so users can keep editing them after
 * the command materializes the first arrangement.
 */
export function layoutFramePresetPatch(
	presetId: LayoutFramePresetId,
	childNodeIds: readonly string[],
): LayoutFramePatch {
	const count = childNodeIds.length;
	switch (presetId) {
		case "bento-hero-left":
			return {
				preset: presetId,
				columns: 4,
				rows: 3,
				placements: placementRecord(childNodeIds, [
					{ column: 0, row: 0, columnSpan: 2, rowSpan: 3 },
					{ column: 2, row: 0, columnSpan: 2 },
					{ column: 2, row: 1 },
					{ column: 3, row: 1 },
					{ column: 2, row: 2, columnSpan: 2 },
				]),
			};
		case "bento-hero-top":
			return {
				preset: presetId,
				columns: 4,
				rows: 3,
				placements: placementRecord(childNodeIds, [
					{ column: 0, row: 0, columnSpan: 4 },
					{ column: 0, row: 1 },
					{ column: 1, row: 1 },
					{ column: 2, row: 1 },
					{ column: 3, row: 1 },
					{ column: 0, row: 2, columnSpan: 2 },
					{ column: 2, row: 2, columnSpan: 2 },
				]),
			};
		case "bento-mosaic":
			return {
				preset: presetId,
				columns: 4,
				rows: 4,
				placements: placementRecord(childNodeIds, [
					{ column: 0, row: 0, columnSpan: 2, rowSpan: 2 },
					{ column: 2, row: 0, columnSpan: 2 },
					{ column: 2, row: 1 },
					{ column: 3, row: 1, rowSpan: 2 },
					{ column: 0, row: 2 },
					{ column: 1, row: 2, columnSpan: 2 },
					{ column: 0, row: 3, columnSpan: 4 },
				]),
			};
		case "uniform-grid":
			return {
				preset: presetId,
				columns: autoColumnsForCount(count),
				rows: "auto",
				placements: null,
			};
	}
}
