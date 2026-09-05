import {
	getGeometryBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	findArtboardById,
	type NormalizedArtboard,
	selectDefaultArtboard,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	type BoundingBoxSnapAxes,
	type BoundingBoxSnapResult,
	type BoundsExtent,
	projectGuide,
	projectMeasurement,
	projectPoint,
	type SnapAxis,
	type SnapCandidate,
	type SnapGuideVisual,
	type SnapIndicator,
	type SnapMeasurement,
	type SnapPoint,
	type SnapProjection,
	type SnapResult,
	snapBoundingBox,
	snapPoint as snapSharedPoint,
	unprojectPoint,
	worldThresholdFromScreen,
} from "@/shared/lib/snapping";

/**
 * THE single grid spacing. One constant feeds (a) the full-screen visible grid,
 * (b) 1-D grid-line snap candidates, and (c) 2-D grid-intersection candidates, so
 * "what you see is what you snap to" cannot drift. The 64px MAJOR cadence is a
 * heavier line every {@link GRID_MAJOR_EVERY} minor lines for readability; both
 * are phased to the same origin, so the origin always lands on a major line.
 */
export const BASE_GRID_SPACING = 8;
export const GRID_MAJOR_EVERY = 8;

const DEFAULT_GRID_SPACING = BASE_GRID_SPACING;
const DEFAULT_PIXEL_GRID_SPACING = 1;
const DEFAULT_GRID_MIN_SCREEN_STEP_PX = 4;
const DEFAULT_RULER_MIN_MAJOR_STEP_PX = 64;
const DEFAULT_RULER_MINOR_DIVISIONS = 4;
const GUIDE_LINE_PRIORITY = 120;
const ARTBOARD_PRIORITY = 100;
const OBJECT_PRIORITY = 80;
const GRID_PRIORITY = 10;
const EPSILON = 0.000001;

export type GuideAnchor =
	| "left"
	| "centerX"
	| "right"
	| "top"
	| "centerY"
	| "bottom";

export type GuideCandidateSource =
	| { readonly kind: "artboard"; readonly anchor: GuideAnchor }
	| { readonly kind: "guide"; readonly guideId: string }
	| {
			readonly kind: "grid";
			readonly axis: SnapAxis;
			readonly index: number;
			readonly spacing: number;
	  }
	| {
			readonly kind: "object";
			readonly nodeId: string;
			readonly anchor: GuideAnchor;
	  };

/**
 * Product-level snap candidate. The math is still one-dimensional, but source
 * metadata lets overlays and future inspectors distinguish artboard, grid, and
 * object guides without reading scene data again.
 */
export type GuideCandidate = SnapCandidate & {
	readonly source: GuideCandidateSource;
	readonly priority: number;
	readonly label: string;
	readonly guide: SnapGuideVisual;
};

export type GuideGridSettings = {
	readonly enabled?: boolean;
	readonly spacing?: number;
	readonly offset?: SnapPoint;
};

export type GuideLine = {
	readonly id: string;
	readonly axis: SnapAxis;
	readonly value: number;
	/**
	 * Pasteboard guides store global coordinates and span the workspace. Artboard
	 * guides store local coordinates against `artboardId`; omitted values are
	 * legacy default-artboard local guide data and stay readable without a
	 * migration.
	 */
	readonly coordinateSpace?: "pasteboard" | "artboard";
	readonly artboardId?: string;
	readonly label?: string;
	readonly visible?: boolean;
	readonly locked?: boolean;
};

export type CollectGuideCandidatesOptions = {
	readonly includeArtboard?: boolean;
	readonly includeGuideLines?: boolean;
	readonly includeGrid?: boolean;
	readonly includeObjects?: boolean;
	readonly grid?: GuideGridSettings;
	readonly guideLines?: readonly GuideLine[];
	readonly excludeNodeIds?: readonly string[];
};

export type GuideSnapContext = {
	readonly enabled: boolean;
	readonly candidates: readonly GuideCandidate[];
	readonly threshold?: number;
	readonly thresholdPx?: number;
	readonly projection?: SnapProjection;
	readonly showMeasurements?: boolean;
};

export type GuideSnapResult = SnapResult<GuideCandidate>;

export type ProjectedGuideSnapResult = {
	readonly adjustedPoint: SnapPoint;
	readonly guides: readonly SnapGuideVisual[];
	readonly measurements: readonly SnapMeasurement[];
	readonly indicator: SnapIndicator | null;
};

export type GuideRulerTickKind = "major" | "minor";

export type GuideRulerTick = {
	readonly axis: SnapAxis;
	readonly value: number;
	readonly screenPosition: number;
	readonly kind: GuideRulerTickKind;
	readonly label?: string;
};

export type AxisRange = {
	readonly min: number;
	readonly max: number;
};

export type VisibleDocumentRange = {
	readonly x: AxisRange;
	readonly y: AxisRange;
};

export type WorkspaceGridKind = "minor" | "major" | "pixel";

export type WorkspaceGridLine = {
	readonly axis: SnapAxis;
	readonly value: number;
	readonly screenPosition: number;
	readonly kind: WorkspaceGridKind;
};

export type WorkspaceGridSettings = {
	readonly visible?: boolean;
	readonly spacing?: number;
	readonly minScreenStepPx?: number;
};

export type CollectRulerTicksOptions = {
	readonly minMajorStepPx?: number;
	readonly minorDivisions?: number;
	readonly includeMinor?: boolean;
	/**
	 * Document-space range each axis should label. When present, ticks run
	 * across the whole visible viewport (so labels stay continuous under pan and
	 * zoom); when omitted, the range falls back to the document artboard so older
	 * callers keep their artboard-local behavior.
	 */
	readonly visibleRange?: VisibleDocumentRange;
};

export type CollectWorkspaceGridLinesOptions = {
	readonly layout?: WorkspaceGridSettings;
	readonly pixel?: WorkspaceGridSettings;
	readonly visibleRange?: VisibleDocumentRange;
	/**
	 * Phase origin (world coords) the grid lattice is aligned to. Defaults to world
	 * (0,0). Pass the active artboard's position so the artboard origin always lands
	 * on a grid line — this is also what makes the desk grid continue the artboard's
	 * on-card grid seamlessly, and what keeps the visible lattice identical to the
	 * artboard-local snap candidates.
	 */
	readonly offset?: SnapPoint;
};

type ResolvedRulerTickOptions = {
	readonly minMajorStepPx: number;
	readonly minorDivisions: number;
	readonly includeMinor: boolean;
};

type Aabb = {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
};

const labelFor = (owner: string, anchor: GuideAnchor): string =>
	`${owner} ${anchor}`;

const axisForAnchor = (anchor: GuideAnchor): SnapAxis =>
	anchor === "left" || anchor === "centerX" || anchor === "right" ? "x" : "y";

const roundWorldValue = (value: number): number =>
	Math.abs(value) < EPSILON ? 0 : Number(value.toFixed(6));

const guideLabel = (line: GuideLine): string =>
	line.label ?? `${line.axis.toUpperCase()} ${roundWorldValue(line.value)}px`;

const documentArtboardOrigin = (document: SceneDocument): SnapPoint => ({
	x: document.artboard.position?.x ?? 0,
	y: document.artboard.position?.y ?? 0,
});

const originForArtboard = (artboard: NormalizedArtboard): SnapPoint => ({
	x: artboard.position.x,
	y: artboard.position.y,
});

const artboardForGuideLine = (
	line: GuideLine,
	document: SceneDocument,
): NormalizedArtboard | undefined =>
	line.artboardId
		? findArtboardById(document, line.artboardId)
		: selectDefaultArtboard(document);

const axisPosition = (point: SnapPoint, axis: SnapAxis): number =>
	axis === "x" ? point.x : point.y;

/**
 * Resolves a persisted guide value into pasteboard-global coordinates. New
 * ruler-created guides store global values directly; legacy guides without a
 * coordinate space are interpreted relative to the document artboard origin.
 */
export function guideLineGlobalValue(
	line: GuideLine,
	document: SceneDocument,
): number {
	if (line.coordinateSpace === "pasteboard") return line.value;
	const artboard = artboardForGuideLine(line, document);
	const origin = artboard
		? originForArtboard(artboard)
		: documentArtboardOrigin(document);
	return line.value + axisPosition(origin, line.axis);
}

/**
 * Resolves a persisted guide value into the active artboard's local coordinates
 * so transform and hit-test math can stay artboard-local.
 */
export function guideLineLocalValue(
	line: GuideLine,
	document: SceneDocument,
): number {
	if (line.coordinateSpace !== "pasteboard") return line.value;
	return line.value - axisPosition(documentArtboardOrigin(document), line.axis);
}

/**
 * Explicit artboard-scoped guides only participate in the artboard they name.
 * Legacy local guides omit `artboardId` and remain scoped to the active/default
 * document passed to the collector.
 */
export function guideLineAppliesToDocument(
	line: GuideLine,
	document: SceneDocument,
): boolean {
	return (
		line.coordinateSpace === "pasteboard" ||
		line.artboardId === undefined ||
		line.artboardId === document.artboard.id
	);
}

/** Treats omitted visibility as visible so older persisted guide state remains usable. */
export const isGuideLineVisible = (line: GuideLine): boolean =>
	line.visible ?? true;

/**
 * Editing guards are intentionally independent from visibility: a hidden guide
 * can still be removed or shown by future list controls, while a locked guide
 * cannot be moved or removed through pointer interactions.
 */
export const isGuideLineEditable = (line: GuideLine): boolean => !line.locked;

/**
 * Filters user guide lines down to the set that may participate in snapping.
 * Hidden and locked guides are excluded so precision placement only snaps to
 * visible, intentionally editable construction lines.
 */
export const snapEligibleGuideLines = (
	guideLines: readonly GuideLine[] | undefined,
): GuideLine[] =>
	(guideLines ?? []).filter((line) => isGuideLineVisible(line) && !line.locked);

const applyMatrix = (matrix: Matrix2D, point: SnapPoint): SnapPoint => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const cornersAabb = (corners: readonly SnapPoint[]): Aabb => {
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
};

const nodeAabb = (node: VectorNode): Aabb => {
	const bounds = getGeometryBounds(node.geometry);
	const matrix = matrixFromTransform(node.transform);
	return cornersAabb([
		applyMatrix(matrix, { x: bounds.x, y: bounds.y }),
		applyMatrix(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
		applyMatrix(matrix, {
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		}),
		applyMatrix(matrix, { x: bounds.x, y: bounds.y + bounds.height }),
	]);
};

const guideLine = (
	axis: SnapAxis,
	value: number,
	document: SceneDocument,
	label: string,
): SnapGuideVisual =>
	axis === "x"
		? {
				axis,
				from: { x: value, y: 0 },
				to: { x: value, y: document.artboard.height },
				label,
				labelAt: { x: value, y: 0 },
			}
		: {
				axis,
				from: { x: 0, y: value },
				to: { x: document.artboard.width, y: value },
				label,
				labelAt: { x: 0, y: value },
			};

const candidate = (
	id: string,
	axis: SnapAxis,
	value: number,
	source: GuideCandidateSource,
	document: SceneDocument,
	label: string,
	priority: number,
): GuideCandidate => ({
	id,
	axis,
	value,
	source,
	label,
	priority,
	guide: guideLine(axis, value, document, label),
});

const collectVisibleNodes = (
	nodes: readonly VectorNode[],
	output: VectorNode[],
	excluded: ReadonlySet<string>,
): VectorNode[] => {
	for (const node of nodes) {
		if (excluded.has(node.id)) continue;
		if (!node.visible || node.locked) continue;
		output.push(node);
		if (node.children) collectVisibleNodes(node.children, output, excluded);
	}
	return output;
};

const visibleGuideNodes = (
	document: SceneDocument,
	excluded: ReadonlySet<string>,
): VectorNode[] =>
	document.layers
		.filter((layer) => layer.visible && !layer.locked)
		.reduce<VectorNode[]>(
			(output, layer) => collectVisibleNodes(layer.nodes, output, excluded),
			[],
		);

const pushArtboardCandidates = (
	document: SceneDocument,
	candidates: GuideCandidate[],
): void => {
	const { width, height } = document.artboard;
	const values: readonly [GuideAnchor, number][] = [
		["left", 0],
		["centerX", width / 2],
		["right", width],
		["top", 0],
		["centerY", height / 2],
		["bottom", height],
	];
	for (const [anchor, value] of values) {
		const axis = axisForAnchor(anchor);
		const label = labelFor("artboard", anchor);
		candidates.push(
			candidate(
				`artboard:${anchor}`,
				axis,
				value,
				{ kind: "artboard", anchor },
				document,
				label,
				ARTBOARD_PRIORITY,
			),
		);
	}
};

const pushGuideLineCandidates = (
	document: SceneDocument,
	candidates: GuideCandidate[],
	guideLines: readonly GuideLine[] | undefined,
): void => {
	for (const line of snapEligibleGuideLines(guideLines)) {
		if (!guideLineAppliesToDocument(line, document)) continue;
		const limit =
			line.axis === "x" ? document.artboard.width : document.artboard.height;
		const localValue = guideLineLocalValue(line, document);
		if (!Number.isFinite(localValue) || localValue < 0 || localValue > limit) {
			continue;
		}
		const value = roundWorldValue(localValue);
		candidates.push(
			candidate(
				`guide:${line.id}`,
				line.axis,
				value,
				{ kind: "guide", guideId: line.id },
				document,
				guideLabel(line),
				GUIDE_LINE_PRIORITY,
			),
		);
	}
};

const pushGridAxisCandidates = (
	document: SceneDocument,
	candidates: GuideCandidate[],
	axis: SnapAxis,
	limit: number,
	spacing: number,
	offset: number,
): void => {
	const first = Math.ceil((0 - offset) / spacing);
	const last = Math.floor((limit - offset) / spacing);
	for (let index = first; index <= last; index += 1) {
		const value = offset + index * spacing;
		if (value < -EPSILON || value > limit + EPSILON) continue;
		const roundedValue = Math.abs(value) < EPSILON ? 0 : value;
		const label = `grid ${axis} ${index}`;
		candidates.push(
			candidate(
				`grid:${axis}:${index}`,
				axis,
				roundedValue,
				{ kind: "grid", axis, index, spacing },
				document,
				label,
				GRID_PRIORITY,
			),
		);
	}
};

const pushGridCandidates = (
	document: SceneDocument,
	candidates: GuideCandidate[],
	grid: GuideGridSettings | undefined,
): void => {
	const spacing = grid?.spacing ?? DEFAULT_GRID_SPACING;
	if (!Number.isFinite(spacing) || spacing <= 0) return;
	const offset = grid?.offset ?? { x: 0, y: 0 };
	pushGridAxisCandidates(
		document,
		candidates,
		"x",
		document.artboard.width,
		spacing,
		offset.x,
	);
	pushGridAxisCandidates(
		document,
		candidates,
		"y",
		document.artboard.height,
		spacing,
		offset.y,
	);
};

const pushObjectCandidates = (
	document: SceneDocument,
	candidates: GuideCandidate[],
	excluded: ReadonlySet<string>,
): void => {
	for (const node of visibleGuideNodes(document, excluded)) {
		const box = nodeAabb(node);
		const values: readonly [GuideAnchor, number][] = [
			["left", box.minX],
			["centerX", (box.minX + box.maxX) / 2],
			["right", box.maxX],
			["top", box.minY],
			["centerY", (box.minY + box.maxY) / 2],
			["bottom", box.maxY],
		];
		for (const [anchor, value] of values) {
			const axis = axisForAnchor(anchor);
			const label = labelFor(node.name, anchor);
			candidates.push(
				candidate(
					`object:${node.id}:${anchor}`,
					axis,
					value,
					{ kind: "object", nodeId: node.id, anchor },
					document,
					label,
					OBJECT_PRIORITY,
				),
			);
		}
	}
};

/**
 * Collects smart-guide candidates from immutable scene data. The returned list
 * is safe to cache for a drag gesture because it contains only primitive values
 * and does not retain mutable scene references.
 */
export function collectGuideCandidates(
	document: SceneDocument,
	options: CollectGuideCandidatesOptions = {},
): GuideCandidate[] {
	const candidates: GuideCandidate[] = [];
	if (options.includeArtboard ?? true) {
		pushArtboardCandidates(document, candidates);
	}
	if (options.includeGuideLines ?? true) {
		pushGuideLineCandidates(document, candidates, options.guideLines);
	}
	const gridEnabled = options.grid?.enabled ?? options.includeGrid ?? true;
	if (gridEnabled) pushGridCandidates(document, candidates, options.grid);
	if (options.includeObjects ?? true) {
		pushObjectCandidates(
			document,
			candidates,
			new Set(options.excludeNodeIds ?? []),
		);
	}
	return candidates;
}

/**
 * Evaluates a point against collected guide candidates. `thresholdPx` plus a
 * projection keeps the magnet radius screen-stable while preserving world-space
 * output for later transform handlers.
 */
export function snapPointToGuides(
	point: SnapPoint,
	context: GuideSnapContext,
): GuideSnapResult {
	return snapSharedPoint(point, {
		enabled: context.enabled,
		threshold: context.threshold ?? 0,
		thresholdPx: context.thresholdPx,
		projection: context.projection,
		candidates: context.candidates,
		emitMeasurements: context.showMeasurements ?? false,
	});
}

export type GuideBboxSnapContext = GuideSnapContext & {
	readonly axes?: BoundingBoxSnapAxes;
};

export type GuideBoundingBoxSnapResult = BoundingBoxSnapResult<GuideCandidate>;

/**
 * Smart-guide snapping for a dragged selection's bounding box. Type-pinned
 * wrapper over {@link snapBoundingBox} so transform/draw handlers consume one
 * guide-snapping module. Returns the delta correction that best aligns an
 * edge/center plus the winning guide lines for the overlay.
 */
export function snapSelectionBboxToGuides(
	box: BoundsExtent,
	proposedDelta: SnapPoint,
	context: GuideBboxSnapContext,
): GuideBoundingBoxSnapResult {
	return snapBoundingBox(box, proposedDelta, {
		enabled: context.enabled,
		threshold: context.threshold ?? 0,
		thresholdPx: context.thresholdPx,
		projection: context.projection,
		candidates: context.candidates,
		axes: context.axes,
	});
}

/**
 * Projects only overlay-facing snap result fields. The source result remains in
 * artboard units, while this helper gives a renderer screen coordinates for
 * guide strokes, labels, and measurement segments.
 */
export function projectGuideSnapResult(
	result: GuideSnapResult,
	projection: SnapProjection,
): ProjectedGuideSnapResult {
	return {
		adjustedPoint: projectPoint(result.adjustedPoint, projection),
		guides: result.guides.map((guide) => projectGuide(guide, projection)),
		measurements: result.measurements.map((measurement) =>
			projectMeasurement(measurement, projection),
		),
		indicator: result.indicator
			? {
					...result.indicator,
					point: projectPoint(result.indicator.point, projection),
				}
			: null,
	};
}

const niceStep = (rawStep: number): number => {
	if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
	const exponent = Math.floor(Math.log10(rawStep));
	const base = 10 ** exponent;
	const fraction = rawStep / base;
	const niceFraction =
		fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
	return niceFraction * base;
};

const normalizedMinorDivisions = (value: number | undefined): number => {
	const candidate = value ?? DEFAULT_RULER_MINOR_DIVISIONS;
	if (!Number.isFinite(candidate)) return DEFAULT_RULER_MINOR_DIVISIONS;
	return Math.max(1, Math.floor(candidate));
};

const formatRulerLabel = (value: number): string =>
	String(roundWorldValue(value));

const resolvedGridSpacing = (
	settings: WorkspaceGridSettings | undefined,
	fallback: number,
): number => {
	const spacing = settings?.spacing ?? fallback;
	return Number.isFinite(spacing) && spacing > 0 ? spacing : fallback;
};

const shouldCollectGridKind = (
	settings: WorkspaceGridSettings | undefined,
	projection: SnapProjection,
	spacing: number,
	defaultVisible: boolean,
): boolean => {
	if (!(settings?.visible ?? defaultVisible)) return false;
	const minScreenStepPx =
		settings?.minScreenStepPx ?? DEFAULT_GRID_MIN_SCREEN_STEP_PX;
	return spacing * Math.abs(projection.zoom) >= minScreenStepPx;
};

/**
 * Per-kind visibility under zoom: the minor (BASE) lattice is suppressed once it
 * is denser than `minScreenStepPx`, while the major lattice (BASE*majorEvery)
 * survives much longer — so zooming out fades the fine grid down to the 64px
 * lattice instead of to nothing. The returned booleans gate BOTH the visible
 * lines AND the snap candidates, so a line you cannot see is never a snap target.
 */
export function gridLineDensity(
	zoom: number,
	options: {
		readonly spacing?: number;
		readonly majorEvery?: number;
		readonly minScreenStepPx?: number;
	} = {},
): { readonly showMinor: boolean; readonly showMajor: boolean } {
	const spacing = options.spacing ?? BASE_GRID_SPACING;
	const majorEvery = options.majorEvery ?? GRID_MAJOR_EVERY;
	const minScreenStepPx =
		options.minScreenStepPx ?? DEFAULT_GRID_MIN_SCREEN_STEP_PX;
	const z = Math.abs(zoom);
	return {
		showMinor: spacing * z >= minScreenStepPx,
		showMajor: spacing * majorEvery * z >= minScreenStepPx,
	};
}

/** A grid index is MAJOR when it is a multiple of the major cadence. */
export const isMajorGridIndex = (
	index: number,
	majorEvery: number = GRID_MAJOR_EVERY,
): boolean => index % majorEvery === 0;

const collectAxisWorkspaceGridLines = (
	axis: SnapAxis,
	range: AxisRange,
	projection: SnapProjection,
	spacing: number,
	offset: number,
	density: { readonly showMinor: boolean; readonly showMajor: boolean },
): WorkspaceGridLine[] => {
	const first = Math.ceil((range.min - offset) / spacing);
	const last = Math.floor((range.max - offset) / spacing);
	const lines: WorkspaceGridLine[] = [];
	for (let index = first; index <= last; index += 1) {
		const major = isMajorGridIndex(index);
		if (major ? !density.showMajor : !density.showMinor) continue;
		const value = roundWorldValue(offset + index * spacing);
		if (value < range.min - EPSILON || value > range.max + EPSILON) continue;
		const projected = projectPoint(
			axis === "x" ? { x: value, y: 0 } : { x: 0, y: value },
			projection,
		);
		lines.push({
			axis,
			value,
			screenPosition: axis === "x" ? projected.x : projected.y,
			kind: major ? "major" : "minor",
		});
	}
	return lines;
};

const collectAxisPixelGridLines = (
	axis: SnapAxis,
	range: AxisRange,
	projection: SnapProjection,
	spacing: number,
	offset: number,
): WorkspaceGridLine[] => {
	const first = Math.ceil((range.min - offset) / spacing);
	const last = Math.floor((range.max - offset) / spacing);
	const lines: WorkspaceGridLine[] = [];
	for (let index = first; index <= last; index += 1) {
		const value = roundWorldValue(offset + index * spacing);
		if (value < range.min - EPSILON || value > range.max + EPSILON) continue;
		const projected = projectPoint(
			axis === "x" ? { x: value, y: 0 } : { x: 0, y: value },
			projection,
		);
		lines.push({
			axis,
			value,
			screenPosition: axis === "x" ? projected.x : projected.y,
			kind: "pixel",
		});
	}
	return lines;
};

/**
 * Computes the full-screen workspace/pasteboard grid as viewport-space strokes,
 * derived from the same projection used by rulers and guide drags so zoom/pan and
 * negative pasteboard coordinates cannot make the visual grid drift from the
 * production coordinate system. The single layout tier emits a BASE-spaced minor
 * lattice plus a heavier major lattice every {@link GRID_MAJOR_EVERY} lines, both
 * phased to `options.offset` (pass the active artboard origin) so the visible grid
 * is identical to the artboard-local snap candidates — what you see is what you
 * snap to, across the whole canvas.
 */
export function collectWorkspaceGridLines(
	projection: SnapProjection,
	size: { readonly width: number; readonly height: number },
	options: CollectWorkspaceGridLinesOptions = {},
): WorkspaceGridLine[] {
	if (!(projection.zoom > 0) || size.width <= 0 || size.height <= 0) {
		return [];
	}
	const visibleRange =
		options.visibleRange ?? visibleDocumentRange(projection, size);
	const offset = options.offset ?? { x: 0, y: 0 };
	const lines: WorkspaceGridLine[] = [];

	if (options.layout?.visible ?? true) {
		const spacing = resolvedGridSpacing(options.layout, BASE_GRID_SPACING);
		const density = gridLineDensity(projection.zoom, {
			spacing,
			minScreenStepPx: options.layout?.minScreenStepPx,
		});
		if (density.showMinor || density.showMajor) {
			lines.push(
				...collectAxisWorkspaceGridLines(
					"x",
					visibleRange.x,
					projection,
					spacing,
					offset.x,
					density,
				),
				...collectAxisWorkspaceGridLines(
					"y",
					visibleRange.y,
					projection,
					spacing,
					offset.y,
					density,
				),
			);
		}
	}

	if (options.pixel?.visible ?? false) {
		const spacing = resolvedGridSpacing(
			options.pixel,
			DEFAULT_PIXEL_GRID_SPACING,
		);
		if (shouldCollectGridKind(options.pixel, projection, spacing, false)) {
			lines.push(
				...collectAxisPixelGridLines(
					"x",
					visibleRange.x,
					projection,
					spacing,
					offset.x,
				),
				...collectAxisPixelGridLines(
					"y",
					visibleRange.y,
					projection,
					spacing,
					offset.y,
				),
			);
		}
	}
	return lines;
}

/**
 * The finest grid spacing the user can actually SEE at this zoom, so snap targets
 * never include a lattice that is too dense to render (which would let an object
 * snap to an invisible line). Returns BASE while the minor grid is visible, the
 * 64px major spacing once the minor lattice has thinned away, or null when even
 * the major grid is too dense to show — in which case the grid is not a snap
 * target at all. This is the snap-side half of "what you see is what you snap to".
 */
export function visibleGridSpacing(
	zoom: number,
	base: number = BASE_GRID_SPACING,
	majorEvery: number = GRID_MAJOR_EVERY,
): number | null {
	const density = gridLineDensity(zoom, { spacing: base, majorEvery });
	if (density.showMinor) return base;
	if (density.showMajor) return base * majorEvery;
	return null;
}

/** A grid-crossing 2-D snap target, tagged so the indicator draws a grid glyph. */
export type GridIntersectionCandidate = {
	readonly x: number;
	readonly y: number;
	readonly kind: "grid";
};

/**
 * Grid INTERSECTION points (2-D) in the immediate neighborhood of `point`, on the
 * lattice of `spacing` phased to `offset`. Returns the 3×3 block of intersections
 * around the point — which always contains the nearest one regardless of the snap
 * radius — so the 2-D point engine can lock onto a grid crossing without ever
 * enumerating the (unbounded) full pasteboard lattice. Pure and allocation-light.
 */
export function collectGridIntersectionsNear(
	point: SnapPoint,
	spacing: number,
	offset: SnapPoint = { x: 0, y: 0 },
): GridIntersectionCandidate[] {
	if (!(spacing > 0)) return [];
	const nx = Math.round((point.x - offset.x) / spacing);
	const ny = Math.round((point.y - offset.y) / spacing);
	const out: GridIntersectionCandidate[] = [];
	for (let dx = -1; dx <= 1; dx += 1) {
		for (let dy = -1; dy <= 1; dy += 1) {
			out.push({
				x: offset.x + (nx + dx) * spacing,
				y: offset.y + (ny + dy) * spacing,
				kind: "grid",
			});
		}
	}
	return out;
}

/**
 * 1-D grid-LINE snap candidates near a dragged box's axis anchors. For each anchor
 * value the three nearest lattice lines (floor/round/ceil) are emitted as full
 * {@link GuideCandidate}s, so a bbox edge/center snaps to a grid line exactly like
 * it snaps to an artboard or object guide — and only to lines on the visible
 * lattice. Generated locally around the anchors (not the whole pasteboard) so it
 * works beyond the artboard without enumerating an unbounded grid.
 */
export function collectGridLineCandidatesNear(
	document: SceneDocument,
	spacing: number,
	anchorsX: readonly number[],
	anchorsY: readonly number[],
	offset: SnapPoint = { x: 0, y: 0 },
): GuideCandidate[] {
	if (!(spacing > 0)) return [];
	const out: GuideCandidate[] = [];
	const seen = new Set<string>();
	const pushAxis = (axis: SnapAxis, anchors: readonly number[]): void => {
		const phase = axis === "x" ? offset.x : offset.y;
		for (const anchor of anchors) {
			const base = Math.round((anchor - phase) / spacing);
			for (const index of [base - 1, base, base + 1]) {
				const key = `${axis}:${index}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const value = roundWorldValue(phase + index * spacing);
				out.push(
					candidate(
						`grid:${axis}:${index}`,
						axis,
						value,
						{ kind: "grid", axis, index, spacing },
						document,
						`grid ${axis} ${index}`,
						GRID_PRIORITY,
					),
				);
			}
		}
	};
	pushAxis("x", anchorsX);
	pushAxis("y", anchorsY);
	return out;
}

const collectAxisRulerTicks = (
	axis: SnapAxis,
	start: number,
	end: number,
	projection: SnapProjection,
	options: ResolvedRulerTickOptions,
): GuideRulerTick[] => {
	const majorStep = niceStep(
		worldThresholdFromScreen(options.minMajorStepPx, projection),
	);
	const minorDivisions = normalizedMinorDivisions(options.minorDivisions);
	const minorStep = majorStep / minorDivisions;
	const first = Math.ceil(start / minorStep);
	const last = Math.floor(end / minorStep);
	const ticks: GuideRulerTick[] = [];
	for (let index = first; index <= last; index += 1) {
		const value = roundWorldValue(index * minorStep);
		if (value < start - EPSILON || value > end + EPSILON) continue;
		const isMajor = index % minorDivisions === 0;
		if (!isMajor && !options.includeMinor) continue;
		const projected = projectPoint(
			axis === "x" ? { x: value, y: 0 } : { x: 0, y: value },
			projection,
		);
		ticks.push({
			axis,
			value,
			screenPosition: axis === "x" ? projected.x : projected.y,
			kind: isMajor ? "major" : "minor",
			label: isMajor ? formatRulerLabel(value) : undefined,
		});
	}
	return ticks;
};

/**
 * Computes screen-projected ruler ticks without coupling the guide feature to a
 * specific renderer. The output is stable under pan and zoom, so an overlay can
 * draw tick marks in CSS pixels while still labeling artboard-space units.
 */
export function collectRulerTicks(
	document: SceneDocument,
	projection: SnapProjection,
	options: CollectRulerTicksOptions = {},
): GuideRulerTick[] {
	const resolved = {
		minMajorStepPx: options.minMajorStepPx ?? DEFAULT_RULER_MIN_MAJOR_STEP_PX,
		minorDivisions: normalizedMinorDivisions(options.minorDivisions),
		includeMinor: options.includeMinor ?? true,
	} satisfies ResolvedRulerTickOptions;
	const origin = documentArtboardOrigin(document);
	const xRange = options.visibleRange?.x ?? {
		min: origin.x,
		max: origin.x + document.artboard.width,
	};
	const yRange = options.visibleRange?.y ?? {
		min: origin.y,
		max: origin.y + document.artboard.height,
	};
	return [
		...collectAxisRulerTicks("x", xRange.min, xRange.max, projection, resolved),
		...collectAxisRulerTicks("y", yRange.min, yRange.max, projection, resolved),
	];
}

/**
 * Inverts the stage projection over a viewport box to find the document-space
 * range currently visible on each axis. Feeds {@link collectRulerTicks} so ruler
 * labels run continuously across whatever the user has panned into view.
 */
export function visibleDocumentRange(
	projection: SnapProjection,
	size: { readonly width: number; readonly height: number },
): VisibleDocumentRange {
	const topLeft = unprojectPoint({ x: 0, y: 0 }, projection);
	const bottomRight = unprojectPoint(
		{ x: size.width, y: size.height },
		projection,
	);
	return {
		x: {
			min: Math.min(topLeft.x, bottomRight.x),
			max: Math.max(topLeft.x, bottomRight.x),
		},
		y: {
			min: Math.min(topLeft.y, bottomRight.y),
			max: Math.max(topLeft.y, bottomRight.y),
		},
	};
}

/**
 * Converts a pointer position into a user guide line candidate. Pasteboard
 * guides span the whole pasteboard, so any finite drop is valid — the ruler-drag
 * handler decides delete/cancel by where the pointer is released. Legacy
 * artboard-local guides keep the in-bounds clamp so out-of-frame drops cancel.
 */
export function guideLineFromDrag(
	id: string,
	axis: SnapAxis,
	point: SnapPoint,
	document: SceneDocument,
	options: {
		readonly coordinateSpace?: GuideLine["coordinateSpace"];
		readonly artboardId?: string;
	} = {},
): GuideLine | null {
	const coordinateSpace = options.coordinateSpace ?? "artboard";
	const valueForAxis = axis === "x" ? point.x : point.y;
	if (!Number.isFinite(valueForAxis)) return null;
	if (coordinateSpace === "pasteboard") {
		const value = roundWorldValue(valueForAxis);
		return {
			id,
			axis,
			value,
			coordinateSpace: "pasteboard",
			label: `${axis.toUpperCase()} ${value}px`,
		};
	}
	const targetArtboard = options.artboardId
		? findArtboardById(document, options.artboardId)
		: selectDefaultArtboard(document);
	if (!targetArtboard) return null;
	const localValue =
		valueForAxis - axisPosition(originForArtboard(targetArtboard), axis);
	const limit = axis === "x" ? targetArtboard.width : targetArtboard.height;
	if (localValue < 0 || localValue > limit) return null;
	const value = roundWorldValue(localValue);
	const explicitArtboardScope =
		options.coordinateSpace === "artboard" || options.artboardId !== undefined;
	return {
		id,
		axis,
		value,
		...(explicitArtboardScope
			? { coordinateSpace: "artboard" as const, artboardId: targetArtboard.id }
			: {}),
		label: `${axis.toUpperCase()} ${value}px`,
	};
}
