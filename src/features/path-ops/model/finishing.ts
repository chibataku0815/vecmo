import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "@/entities/scene/model/command";
import { readComponentProps } from "@/entities/scene/model/component-props";
import { matrixFromTransform } from "@/entities/scene/model/rendering";
import {
	findLayerByNodeId,
	findNode,
	isNodeTransformable,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	BezierShape,
	NodeGeometry,
	NodeStyle,
	PathGeometry,
	SceneDocument,
	Transform,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { IDENTITY_TRANSFORM } from "@/entities/scene/model/types";
import {
	geometryToPathGeometry,
	type PathOpPoint,
	pathShapeToPolyline,
} from "./path-conversion";
import type { PathOpIssue } from "./types";

export const PATH_FINISHING_OPERATIONS = [
	"flatten",
	"outline-stroke",
	"swap-fill-stroke",
	"remove-fill",
	"remove-stroke",
] as const;

/** Illustrator-style finishing operations that mutate selected scene nodes. */
export type PathFinishingOperation = (typeof PATH_FINISHING_OPERATIONS)[number];

export type PathFinishingIssueCode =
	| PathOpIssue["code"]
	| "path-finishing.too-few-sources"
	| "path-finishing.duplicate-source"
	| "path-finishing.missing-source"
	| "path-finishing.protected-source"
	| "path-finishing.no-op"
	| "path-finishing.no-visible-stroke"
	| "path-finishing.shared-color-owned"
	| "path-finishing.stroke-semantics-approximated"
	| "path-finishing.unsupported-outline";

export type PathFinishingIssue = {
	readonly code: PathFinishingIssueCode;
	readonly message: string;
	readonly severity: PathOpIssue["severity"];
	readonly operation: PathFinishingOperation;
	readonly sourceId?: string;
	readonly geometryKind?: NodeGeometry["kind"];
};

export type PathFinishingNodePatch = {
	readonly geometry?: NodeGeometry;
	readonly transform?: Transform;
	readonly style?: Partial<NodeStyle>;
};

export type PathFinishingNodeChanged = {
	readonly ok: true;
	readonly changed: true;
	readonly operation: PathFinishingOperation;
	readonly nodeId: string;
	readonly patch: PathFinishingNodePatch;
	readonly issues: readonly PathFinishingIssue[];
};

export type PathFinishingNodeNoop = {
	readonly ok: true;
	readonly changed: false;
	readonly operation: PathFinishingOperation;
	readonly nodeId: string;
	readonly issues: readonly PathFinishingIssue[];
};

export type PathFinishingNodeUnsupported = {
	readonly ok: false;
	readonly changed: false;
	readonly operation: PathFinishingOperation;
	readonly nodeId: string;
	readonly issues: readonly PathFinishingIssue[];
};

export type PathFinishingNodeResult =
	| PathFinishingNodeChanged
	| PathFinishingNodeNoop
	| PathFinishingNodeUnsupported;

export type PathFinishingCommandSuccess = {
	readonly ok: true;
	readonly operation: PathFinishingOperation;
	readonly sourceNodeIds: readonly string[];
	readonly changedNodeIds: readonly string[];
	readonly unchangedNodeIds: readonly string[];
	readonly unsupportedNodeIds: readonly string[];
	readonly nodeResults: readonly PathFinishingNodeResult[];
	readonly issues: readonly PathFinishingIssue[];
	readonly command: SceneCommand;
};

export type PathFinishingCommandFailure = {
	readonly ok: false;
	readonly operation: PathFinishingOperation;
	readonly sourceNodeIds: readonly string[];
	readonly changedNodeIds: readonly string[];
	readonly unchangedNodeIds: readonly string[];
	readonly unsupportedNodeIds: readonly string[];
	readonly nodeResults: readonly PathFinishingNodeResult[];
	readonly issues: readonly PathFinishingIssue[];
};

export type PathFinishingCommandResult =
	| PathFinishingCommandSuccess
	| PathFinishingCommandFailure;

export type PathFinishingSelection = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
};

export type SelectedPathFinishingAvailable = {
	readonly enabled: true;
	readonly operation: PathFinishingOperation;
	readonly sourceNodeIds: readonly string[];
	readonly changedNodeIds: readonly string[];
	readonly issues: readonly PathFinishingIssue[];
};

export type SelectedPathFinishingUnavailable = {
	readonly enabled: false;
	readonly operation: PathFinishingOperation;
	readonly sourceNodeIds: readonly string[];
	readonly reason: string;
	readonly issues: readonly PathFinishingIssue[];
};

export type SelectedPathFinishingState =
	| SelectedPathFinishingAvailable
	| SelectedPathFinishingUnavailable;

export type SelectedPathFinishingCommitSuccess = PathFinishingCommandSuccess & {
	readonly changed: boolean;
};

export type SelectedPathFinishingCommitFailure = PathFinishingCommandFailure & {
	readonly changed: false;
	readonly reason: string;
};

export type SelectedPathFinishingCommitResult =
	| SelectedPathFinishingCommitSuccess
	| SelectedPathFinishingCommitFailure;

export type SelectedPathFinishingCleanupSelection = {
	readonly nodeIds: readonly string[];
	readonly primary: string | null;
};

const POINT_EPSILON = 1e-7;
const NONE_PAINT = "none";

const finishingLabel = (operation: PathFinishingOperation): string => {
	switch (operation) {
		case "flatten":
			return "Flatten paths";
		case "outline-stroke":
			return "Outline stroke";
		case "swap-fill-stroke":
			return "Swap fill and stroke";
		case "remove-fill":
			return "Remove fill";
		case "remove-stroke":
			return "Remove stroke";
	}
};

const cloneIdentityTransform = (): typeof IDENTITY_TRANSFORM => ({
	position: { ...IDENTITY_TRANSFORM.position },
	rotation: IDENTITY_TRANSFORM.rotation,
	scale: { ...IDENTITY_TRANSFORM.scale },
	anchor: { ...IDENTITY_TRANSFORM.anchor },
});

const issue = (
	operation: PathFinishingOperation,
	code: PathFinishingIssueCode,
	message: string,
	severity: PathFinishingIssue["severity"],
	node?: Pick<VectorNode, "id" | "geometry">,
): PathFinishingIssue => ({
	code,
	message,
	severity,
	operation,
	sourceId: node?.id,
	geometryKind: node?.geometry.kind,
});

const issueFromPathOp = (
	operation: PathFinishingOperation,
	item: PathOpIssue,
	node: VectorNode,
): PathFinishingIssue => ({
	code: item.code,
	message: item.message,
	severity: item.severity,
	operation,
	sourceId: item.sourceId ?? node.id,
	geometryKind: item.geometryKind ?? node.geometry.kind,
});

const sameNumber = (left: number, right: number): boolean =>
	Math.abs(left - right) <= POINT_EPSILON;

const samePoint = (left: Vec2, right: Vec2): boolean =>
	sameNumber(left.x, right.x) && sameNumber(left.y, right.y);

const finitePoint = (point: Vec2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const isNonePaint = (paint: string): boolean =>
	paint.trim().toLowerCase() === NONE_PAINT;

const hasVisibleStroke = (style: NodeStyle): boolean =>
	!isNonePaint(style.stroke) &&
	Number.isFinite(style.strokeWidth) &&
	style.strokeWidth > POINT_EPSILON;

const isIdentityTransform = (transform: Transform): boolean =>
	samePoint(transform.position, IDENTITY_TRANSFORM.position) &&
	sameNumber(transform.rotation, IDENTITY_TRANSFORM.rotation) &&
	samePoint(transform.scale, IDENTITY_TRANSFORM.scale) &&
	samePoint(transform.anchor, IDENTITY_TRANSFORM.anchor);

const isZeroTangent = (point: readonly number[]): boolean =>
	sameNumber(point[0] ?? 0, 0) && sameNumber(point[1] ?? 0, 0);

const isFlatShape = (shape: BezierShape): boolean =>
	shape.inTangents.every(isZeroTangent) &&
	shape.outTangents.every(isZeroTangent);

/**
 * A compound path counts as "already flattened" only when the outer contour and
 * every hole are tangent-free; otherwise flattening must still run so curved
 * holes are not silently left in place.
 */
const isFlatPathGeometry = (geometry: PathGeometry): boolean =>
	isFlatShape(geometry.shape) && (geometry.subpaths ?? []).every(isFlatShape);

const isFiniteTuple = (point: readonly number[] | undefined): boolean =>
	Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]);

const transformedPoints = (
	points: readonly Vec2[],
	transform: Transform,
): readonly PathOpPoint[] => {
	const matrix = matrixFromTransform(transform);
	return points.map((point) => ({
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f,
	}));
};

const zeroTangent = (): [number, number] => [0, 0];

const pathGeometryFromPolyline = (
	points: readonly PathOpPoint[],
	closed: boolean,
): PathGeometry => ({
	kind: "path",
	shape: {
		type: "Shape",
		closed,
		vertices: points.map((point): [number, number] => [point.x, point.y]),
		inTangents: points.map(zeroTangent),
		outTangents: points.map(zeroTangent),
	},
});

const invalidFlatten = (
	operation: PathFinishingOperation,
	node: VectorNode,
	message: string,
): PathFinishingNodeUnsupported => ({
	ok: false,
	changed: false,
	operation,
	nodeId: node.id,
	issues: [
		issue(operation, "path-op.invalid-geometry", message, "error", node),
	],
});

const validatePathShapeForFinishing = (
	node: VectorNode & { readonly geometry: PathGeometry },
	operation: PathFinishingOperation,
): PathFinishingIssue | null => {
	const { shape } = node.geometry;
	const requiredVertices = shape.closed ? 3 : 2;
	if (
		shape.vertices.length < requiredVertices ||
		shape.inTangents.length !== shape.vertices.length ||
		shape.outTangents.length !== shape.vertices.length
	) {
		return issue(
			operation,
			"path-op.invalid-geometry",
			"Path finishing requires valid path topology.",
			"error",
			node,
		);
	}
	for (const point of [
		...shape.vertices,
		...shape.inTangents,
		...shape.outTangents,
	]) {
		if (!isFiniteTuple(point)) {
			return issue(
				operation,
				"path-op.invalid-geometry",
				"Path finishing requires finite path coordinates.",
				"error",
				node,
			);
		}
	}
	for (const subpath of node.geometry.subpaths ?? []) {
		if (
			subpath.inTangents.length !== subpath.vertices.length ||
			subpath.outTangents.length !== subpath.vertices.length
		) {
			return issue(
				operation,
				"path-op.invalid-geometry",
				"Compound path holes require valid path topology.",
				"error",
				node,
			);
		}
		for (const point of [
			...subpath.vertices,
			...subpath.inTangents,
			...subpath.outTangents,
		]) {
			if (!isFiniteTuple(point)) {
				return issue(
					operation,
					"path-op.invalid-geometry",
					"Compound path holes require finite path coordinates.",
					"error",
					node,
				);
			}
		}
	}
	return null;
};

const flattenStrokeSemanticsIssues = (
	node: VectorNode,
): readonly PathFinishingIssue[] => {
	if (!hasVisibleStroke(node.style)) return [];
	switch (node.geometry.kind) {
		case "line":
		case "rect":
		case "polygon":
		case "star":
			return [
				issue(
					"flatten",
					"path-finishing.stroke-semantics-approximated",
					"Flattening a stroked primitive converts it to path stroke cap/join semantics.",
					"warning",
					node,
				),
			];
		default:
			return [];
	}
};

const flattenedLine = (
	node: VectorNode,
	start: Vec2,
	end: Vec2,
): PathFinishingNodeResult => {
	if (!finitePoint(start) || !finitePoint(end)) {
		return invalidFlatten(
			"flatten",
			node,
			"Line flattening requires finite endpoints.",
		);
	}
	if (samePoint(start, end)) {
		return invalidFlatten(
			"flatten",
			node,
			"Line flattening requires distinct endpoints.",
		);
	}

	return {
		ok: true,
		changed: true,
		operation: "flatten",
		nodeId: node.id,
		patch: {
			geometry: pathGeometryFromPolyline(
				transformedPoints([start, end], node.transform),
				false,
			),
			transform: cloneIdentityTransform(),
		},
		issues: flattenStrokeSemanticsIssues(node),
	};
};

const starPoints = (
	geometry: Extract<NodeGeometry, { kind: "star" }>,
): Vec2[] => {
	const points = geometry.points;
	if (
		!Number.isSafeInteger(points) ||
		points < 2 ||
		points > 128 ||
		!Number.isFinite(geometry.center.x) ||
		!Number.isFinite(geometry.center.y) ||
		!Number.isFinite(geometry.innerRadius) ||
		!Number.isFinite(geometry.outerRadius) ||
		geometry.innerRadius <= POINT_EPSILON ||
		geometry.outerRadius <= POINT_EPSILON
	) {
		return [];
	}

	const vertices: Vec2[] = [];
	const total = points * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index * Math.PI) / points;
		vertices.push({
			x: geometry.center.x + Math.cos(angle) * radius,
			y: geometry.center.y + Math.sin(angle) * radius,
		});
	}
	return vertices;
};

/** Flattens one Ae shape into baked, tangent-free points in artboard space. */
const flattenShapeToPoints = (
	shape: BezierShape,
	node: VectorNode,
): {
	readonly points: readonly PathOpPoint[];
	readonly issues: readonly PathOpIssue[];
} => {
	const polyline = pathShapeToPolyline(shape, {
		id: node.id,
		name: node.name,
		geometry: node.geometry,
		transform: node.transform,
	});
	return {
		points: transformedPoints(polyline.points, node.transform),
		issues: polyline.issues,
	};
};

/**
 * Flattens a path node, including the holes of a compound path. Each hole is
 * flattened with the same transform bake as the outer contour and re-attached as
 * a `subpaths` entry so flattening never silently drops the cutouts; the
 * `fillRule` is preserved whenever holes survive. Degenerate holes that collapse
 * below a closed contour are skipped because they describe no fillable area.
 */
const flattenPathGeometryNode = (
	node: VectorNode,
	geometry: PathGeometry,
): PathFinishingNodeResult => {
	const outer = flattenShapeToPoints(geometry.shape, node);
	const minimumPointCount = geometry.shape.closed ? 3 : 2;
	if (
		outer.points.length < minimumPointCount ||
		!outer.points.every((point) => finitePoint(point))
	) {
		return invalidFlatten(
			"flatten",
			node,
			geometry.shape.closed
				? "Closed path flattening requires at least three finite points."
				: "Open path flattening requires at least two finite points.",
		);
	}
	const baseGeometry = pathGeometryFromPolyline(
		outer.points,
		geometry.shape.closed,
	);

	const holeIssues: PathFinishingIssue[] = [];
	const flattenedHoles: BezierShape[] = [];
	for (const subpath of geometry.subpaths ?? []) {
		const hole = flattenShapeToPoints(subpath, node);
		if (
			hole.points.length < 3 ||
			!hole.points.every((point) => finitePoint(point))
		) {
			continue;
		}
		flattenedHoles.push(pathGeometryFromPolyline(hole.points, true).shape);
		holeIssues.push(
			...hole.issues.map((item) => issueFromPathOp("flatten", item, node)),
		);
	}

	const flattenedGeometry: PathGeometry =
		flattenedHoles.length > 0
			? {
					...baseGeometry,
					subpaths: flattenedHoles,
					...(geometry.fillRule ? { fillRule: geometry.fillRule } : {}),
				}
			: baseGeometry;

	return {
		ok: true,
		changed: true,
		operation: "flatten",
		nodeId: node.id,
		patch: {
			geometry: flattenedGeometry,
			transform: cloneIdentityTransform(),
		},
		issues: outer.issues
			.map((item) => issueFromPathOp("flatten", item, node))
			.concat(holeIssues)
			.concat(flattenStrokeSemanticsIssues(node)),
	};
};

const flattenNodeGeometry = (node: VectorNode): PathFinishingNodeResult => {
	if (node.geometry.kind === "path") {
		const invalidPathIssue = validatePathShapeForFinishing(
			node as VectorNode & { readonly geometry: PathGeometry },
			"flatten",
		);
		if (invalidPathIssue) {
			return {
				ok: false,
				changed: false,
				operation: "flatten",
				nodeId: node.id,
				issues: [invalidPathIssue],
			};
		}
		if (
			isFlatPathGeometry(node.geometry) &&
			isIdentityTransform(node.transform)
		) {
			return {
				ok: true,
				changed: false,
				operation: "flatten",
				nodeId: node.id,
				issues: [
					issue(
						"flatten",
						"path-finishing.no-op",
						"Path is already flattened.",
						"info",
						node,
					),
				],
			};
		}
		return flattenPathGeometryNode(node, node.geometry);
	}

	if (node.geometry.kind === "line") {
		return flattenedLine(node, node.geometry.start, node.geometry.end);
	}

	if (node.geometry.kind === "star") {
		const points = starPoints(node.geometry);
		if (points.length < 3) {
			return invalidFlatten(
				"flatten",
				node,
				"Star flattening requires 2-128 integer points and finite positive radii.",
			);
		}
		return {
			ok: true,
			changed: true,
			operation: "flatten",
			nodeId: node.id,
			patch: {
				geometry: pathGeometryFromPolyline(
					transformedPoints(points, node.transform),
					true,
				),
				transform: cloneIdentityTransform(),
			},
			issues: flattenStrokeSemanticsIssues(node),
		};
	}

	const pathResult = geometryToPathGeometry(node.geometry);
	if (!pathResult.ok) {
		return {
			ok: false,
			changed: false,
			operation: "flatten",
			nodeId: node.id,
			issues: pathResult.issues.map((item) =>
				issueFromPathOp("flatten", item, node),
			),
		};
	}

	const polyline = pathShapeToPolyline(pathResult.geometry.shape, {
		id: node.id,
		name: node.name,
		geometry: node.geometry,
		transform: node.transform,
	});
	const points = transformedPoints(polyline.points, node.transform);
	const minimumPointCount = pathResult.geometry.shape.closed ? 3 : 2;
	if (
		points.length < minimumPointCount ||
		!points.every((point) => finitePoint(point))
	) {
		return invalidFlatten(
			"flatten",
			node,
			pathResult.geometry.shape.closed
				? "Closed path flattening requires at least three finite points."
				: "Open path flattening requires at least two finite points.",
		);
	}

	return {
		ok: true,
		changed: true,
		operation: "flatten",
		nodeId: node.id,
		patch: {
			geometry: pathGeometryFromPolyline(
				points,
				pathResult.geometry.shape.closed,
			),
			transform: cloneIdentityTransform(),
		},
		issues: polyline.issues
			.map((item) => issueFromPathOp("flatten", item, node))
			.concat(flattenStrokeSemanticsIssues(node)),
	};
};

const stylePatchResult = (
	operation: Exclude<PathFinishingOperation, "flatten" | "outline-stroke">,
	node: VectorNode,
	patch: Partial<NodeStyle>,
	noOpMessage: string,
): PathFinishingNodeResult => {
	const changed =
		(patch.fill !== undefined && patch.fill !== node.style.fill) ||
		(patch.stroke !== undefined && patch.stroke !== node.style.stroke) ||
		(patch.strokeWidth !== undefined &&
			!sameNumber(patch.strokeWidth, node.style.strokeWidth));

	if (!changed) {
		return {
			ok: true,
			changed: false,
			operation,
			nodeId: node.id,
			issues: [
				issue(operation, "path-finishing.no-op", noOpMessage, "info", node),
			],
		};
	}

	return {
		ok: true,
		changed: true,
		operation,
		nodeId: node.id,
		patch: { style: patch },
		issues: [],
	};
};

const outlinePointsForSegment = (
	start: Vec2,
	end: Vec2,
	strokeWidth: number,
): readonly Vec2[] | null => {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);
	if (length <= POINT_EPSILON || !Number.isFinite(length)) return null;
	const half = Math.max(0, strokeWidth) / 2;
	const nx = (-dy / length) * half;
	const ny = (dx / length) * half;
	return [
		{ x: start.x + nx, y: start.y + ny },
		{ x: end.x + nx, y: end.y + ny },
		{ x: end.x - nx, y: end.y - ny },
		{ x: start.x - nx, y: start.y - ny },
	];
};

const straightOpenPathEndpoints = (
	geometry: PathGeometry,
): readonly [Vec2, Vec2] | null => {
	if (geometry.shape.closed || geometry.shape.vertices.length !== 2)
		return null;
	if (
		geometry.shape.inTangents.length !== 2 ||
		geometry.shape.outTangents.length !== 2
	) {
		return null;
	}
	if (
		!geometry.shape.inTangents.every(isZeroTangent) ||
		!geometry.shape.outTangents.every(isZeroTangent)
	) {
		return null;
	}
	const start = geometry.shape.vertices[0];
	const end = geometry.shape.vertices[1];
	if (!start || !end) return null;
	return [
		{ x: start[0], y: start[1] },
		{ x: end[0], y: end[1] },
	];
};

const outlineStroke = (node: VectorNode): PathFinishingNodeResult => {
	if (!Number.isFinite(node.style.strokeWidth)) {
		return invalidFlatten(
			"outline-stroke",
			node,
			"Outline stroke requires a finite stroke width.",
		);
	}
	if (
		isNonePaint(node.style.stroke) ||
		node.style.strokeWidth <= POINT_EPSILON
	) {
		return {
			ok: true,
			changed: false,
			operation: "outline-stroke",
			nodeId: node.id,
			issues: [
				issue(
					"outline-stroke",
					"path-finishing.no-visible-stroke",
					"Outline stroke requires a visible stroke.",
					"info",
					node,
				),
			],
		};
	}

	const endpoints =
		node.geometry.kind === "line"
			? ([node.geometry.start, node.geometry.end] as const)
			: node.geometry.kind === "path"
				? straightOpenPathEndpoints(node.geometry)
				: null;

	if (!endpoints) {
		return {
			ok: false,
			changed: false,
			operation: "outline-stroke",
			nodeId: node.id,
			issues: [
				issue(
					"outline-stroke",
					"path-finishing.unsupported-outline",
					"Outline stroke currently supports straight open line paths; closed shapes need compound path output.",
					"error",
					node,
				),
			],
		};
	}

	const transformedEndpoints = transformedPoints(
		[endpoints[0], endpoints[1]],
		node.transform,
	);
	const outline = outlinePointsForSegment(
		transformedEndpoints[0] ?? endpoints[0],
		transformedEndpoints[1] ?? endpoints[1],
		node.style.strokeWidth,
	);
	if (!outline) {
		return invalidFlatten(
			"outline-stroke",
			node,
			"Outline stroke requires a non-zero straight segment.",
		);
	}

	const issues =
		node.geometry.kind === "path"
			? [
					issue(
						"outline-stroke",
						"path-finishing.stroke-semantics-approximated",
						"Outlining a straight open path currently uses butt caps.",
						"warning",
						node,
					),
				]
			: [];

	return {
		ok: true,
		changed: true,
		operation: "outline-stroke",
		nodeId: node.id,
		patch: {
			geometry: pathGeometryFromPolyline(outline, true),
			transform: cloneIdentityTransform(),
			style: {
				fill: node.style.stroke,
				stroke: NONE_PAINT,
				strokeWidth: 0,
			},
		},
		issues,
	};
};

/**
 * Computes one path-finishing node patch without mutating the scene. Geometry
 * operations bake the node transform into the resulting path and reset the
 * transform to identity so later export/action surfaces receive plain editable
 * path data instead of a second transform seam.
 */
export function applyPathFinishingToNode(
	node: VectorNode,
	operation: PathFinishingOperation,
): PathFinishingNodeResult {
	switch (operation) {
		case "flatten":
			return flattenNodeGeometry(node);
		case "outline-stroke":
			return outlineStroke(node);
		case "swap-fill-stroke":
			return stylePatchResult(
				operation,
				node,
				{
					fill: node.style.stroke,
					stroke: node.style.fill,
				},
				"Fill and stroke are already identical.",
			);
		case "remove-fill":
			return stylePatchResult(
				operation,
				node,
				{ fill: NONE_PAINT },
				"Fill is already removed.",
			);
		case "remove-stroke":
			return stylePatchResult(
				operation,
				node,
				{ stroke: NONE_PAINT, strokeWidth: 0 },
				"Stroke is already removed.",
			);
	}
}

const applyNodePatch = (
	node: Draft<VectorNode> | undefined,
	patch: PathFinishingNodePatch,
): void => {
	if (!node) return;
	if (patch.geometry) node.geometry = castDraft(patch.geometry);
	if (patch.transform) node.transform = castDraft(patch.transform);
	if (patch.style) {
		if (patch.style.fill !== undefined) node.style.fill = patch.style.fill;
		if (patch.style.stroke !== undefined)
			node.style.stroke = patch.style.stroke;
		if (patch.style.strokeWidth !== undefined) {
			node.style.strokeWidth = Math.max(0, patch.style.strokeWidth);
		}
		if (patch.style.opacity !== undefined) {
			node.style.opacity = Math.min(1, Math.max(0, patch.style.opacity));
		}
	}
};

const pathFinishingPatchTouchesSharedColor = (
	document: Pick<SceneDocument, "componentProps">,
	nodeId: string,
	patch: PathFinishingNodePatch,
): boolean =>
	readComponentProps(document).some(
		(prop) =>
			prop.type === "color" &&
			prop.bindings.some((binding) => {
				if (binding.kind !== "style-color" || binding.nodeId !== nodeId) {
					return false;
				}
				return binding.role === "fill"
					? patch.style?.fill !== undefined || patch.style?.fills !== undefined
					: patch.style?.stroke !== undefined ||
							patch.style?.strokes !== undefined;
			}),
	);

const findMutableDraftNode = (
	document: Draft<SceneDocument>,
	nodeId: string,
): Draft<VectorNode> | undefined => {
	const visit = (
		nodes: Draft<readonly VectorNode[]>,
		blockedByAncestor: boolean,
	): Draft<VectorNode> | undefined => {
		for (const node of nodes) {
			const blocked = blockedByAncestor || !node.visible || node.locked;
			if (node.id === nodeId) return blocked ? undefined : node;
			if (node.children) {
				const child = visit(node.children, blocked);
				if (child) return child;
			}
		}
		return undefined;
	};

	for (const layer of document.layers) {
		const node = visit(layer.nodes, !layer.visible || layer.locked);
		if (node) return node;
	}
	return undefined;
};

/**
 * Wraps precomputed finishing patches in one scene command. The command stores
 * only plain patch data so Immer history can undo/redo without re-running
 * geometry conversion against a later scene snapshot.
 */
export function createApplyPathFinishingCommand(
	operation: PathFinishingOperation,
	results: readonly PathFinishingNodeChanged[],
): SceneCommand {
	const patches = results.map((result) => ({
		nodeId: result.nodeId,
		patch: result.patch,
	}));
	return {
		type: `path-ops/finish/${operation}`,
		label: finishingLabel(operation),
		run: (draft) => {
			if (
				patches.some((item) =>
					pathFinishingPatchTouchesSharedColor(draft, item.nodeId, item.patch),
				)
			) {
				return;
			}
			for (const item of patches) {
				applyNodePatch(findMutableDraftNode(draft, item.nodeId), item.patch);
			}
		},
	};
}

const collectIssues = (
	results: readonly PathFinishingNodeResult[],
	extraIssues: readonly PathFinishingIssue[],
): readonly PathFinishingIssue[] => [
	...extraIssues,
	...results.flatMap((result) => result.issues),
];

/**
 * Plans a selected-node finishing operation for the scene command bus. The
 * planner intentionally allows partial progress: unsupported, missing, locked,
 * or already-finished nodes are reported as deterministic per-node results while
 * supported nodes still receive one undoable command.
 */
export function buildPathFinishingCommand(
	document: SceneDocument,
	operation: PathFinishingOperation,
	sourceNodeIds: readonly string[],
): PathFinishingCommandResult {
	const extraIssues: PathFinishingIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of sourceNodeIds) {
		if (uniqueIds.includes(nodeId)) {
			extraIssues.push({
				code: "path-finishing.duplicate-source",
				message: "Path finishing source ids must be unique.",
				severity: "warning",
				operation,
				sourceId: nodeId,
			});
			continue;
		}
		uniqueIds.push(nodeId);
	}

	if (uniqueIds.length === 0) {
		extraIssues.push({
			code: "path-finishing.too-few-sources",
			message: "Path finishing requires at least one source node.",
			severity: "error",
			operation,
		});
	}

	const nodeResults: PathFinishingNodeResult[] = [];
	for (const nodeId of uniqueIds) {
		const node = findNode(document, nodeId);
		if (!node) {
			nodeResults.push({
				ok: false,
				changed: false,
				operation,
				nodeId,
				issues: [
					{
						code: "path-finishing.missing-source",
						message: "Path finishing source node was not found in the scene.",
						severity: "error",
						operation,
						sourceId: nodeId,
					},
				],
			});
			continue;
		}
		const layer = findLayerByNodeId(document, nodeId);
		if (!layer || !isNodeTransformable(document, nodeId)) {
			nodeResults.push({
				ok: false,
				changed: false,
				operation,
				nodeId,
				issues: [
					issue(
						operation,
						"path-finishing.protected-source",
						"Hidden or locked path finishing sources are protected from mutation.",
						"error",
						node,
					),
				],
			});
			continue;
		}
		const result = applyPathFinishingToNode(node, operation);
		if (
			result.ok &&
			result.changed &&
			pathFinishingPatchTouchesSharedColor(document, nodeId, result.patch)
		) {
			nodeResults.push({
				ok: false,
				changed: false,
				operation,
				nodeId,
				issues: [
					issue(
						operation,
						"path-finishing.shared-color-owned",
						"This finishing operation would replace a shared-color-owned paint. Remove or reassign the shared driver first.",
						"error",
						node,
					),
				],
			});
			continue;
		}
		nodeResults.push(result);
	}

	const changedResults = nodeResults.filter(
		(result): result is PathFinishingNodeChanged => result.ok && result.changed,
	);
	const changedNodeIds = changedResults.map((result) => result.nodeId);
	const unchangedNodeIds = nodeResults
		.filter((result) => result.ok && !result.changed)
		.map((result) => result.nodeId);
	const unsupportedNodeIds = nodeResults
		.filter((result) => !result.ok)
		.map((result) => result.nodeId);
	const issues = collectIssues(nodeResults, extraIssues);
	const hasSharedColorConflict = issues.some(
		(item) => item.code === "path-finishing.shared-color-owned",
	);
	const base = {
		operation,
		sourceNodeIds: uniqueIds,
		changedNodeIds,
		unchangedNodeIds,
		unsupportedNodeIds,
		nodeResults,
		issues,
	};

	if (changedResults.length === 0 || hasSharedColorConflict) {
		return { ok: false, ...base };
	}

	return {
		ok: true,
		...base,
		command: createApplyPathFinishingCommand(operation, changedResults),
	};
}

/**
 * Orders selected node ids for finishing commands. The primary node stays first
 * for stable result reporting, but unlike Boolean path operations no nodes are
 * removed and every selected id is independently eligible for mutation.
 */
export function selectedPathFinishingSourceIds(
	selection: PathFinishingSelection,
): readonly string[] {
	const sourceNodeIds: string[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string | null): void => {
		if (!nodeId || seen.has(nodeId)) return;
		seen.add(nodeId);
		sourceNodeIds.push(nodeId);
	};

	if (selection.primary && selection.nodeIds.includes(selection.primary)) {
		add(selection.primary);
	}
	for (const nodeId of selection.nodeIds) add(nodeId);
	return sourceNodeIds;
}

/** Converts typed finishing issues into a concise disabled/action reason. */
export function pathFinishingIssueReason(
	issues: readonly PathFinishingIssue[],
): string {
	const item =
		issues.find((issueItem) => issueItem.severity === "error") ??
		issues[0] ??
		null;
	if (!item) return "Path finishing is unavailable for this selection.";
	const source = item.sourceId ? ` (${item.sourceId})` : "";
	return `${item.message}${source}`;
}

/**
 * Plans whether the current selection can run a finishing operation without
 * mutating the scene. Later ActionSurface wiring can use this same model state
 * for enabled flags and deterministic skipped-node reports.
 */
export function selectedPathFinishingState(
	document: SceneDocument,
	operation: PathFinishingOperation,
	selection: PathFinishingSelection,
): SelectedPathFinishingState {
	const sourceNodeIds = selectedPathFinishingSourceIds(selection);
	const planned = buildPathFinishingCommand(document, operation, sourceNodeIds);
	if (planned.ok) {
		return {
			enabled: true,
			operation,
			sourceNodeIds,
			changedNodeIds: planned.changedNodeIds,
			issues: planned.issues,
		};
	}

	return {
		enabled: false,
		operation,
		sourceNodeIds,
		reason: pathFinishingIssueReason(planned.issues),
		issues: planned.issues,
	};
}

/**
 * Executes selected-node finishing through the scene command bus. This remains
 * selection-store agnostic so widgets can decide whether to keep the full
 * selection or focus only changed nodes after partial operations.
 */
export function commitSelectedPathFinishingOperation(
	operation: PathFinishingOperation,
	selection: PathFinishingSelection,
): SelectedPathFinishingCommitResult {
	const store = useSceneStore.getState();
	const before = store.document;
	const sourceNodeIds = selectedPathFinishingSourceIds(selection);
	const planned = buildPathFinishingCommand(before, operation, sourceNodeIds);
	if (!planned.ok) {
		return {
			...planned,
			changed: false,
			reason: pathFinishingIssueReason(planned.issues),
		};
	}

	store.apply(planned.command);
	return {
		...planned,
		changed: useSceneStore.getState().document !== before,
	};
}

/**
 * Defines a minimal post-command selection contract without importing selection
 * stores. Finishing operations do not delete operands, so keeping changed nodes
 * focused gives later UI integration a stable, non-stale selection target.
 */
export function selectedPathFinishingCleanupSelection(
	result: SelectedPathFinishingCommitResult,
): SelectedPathFinishingCleanupSelection | null {
	if (!result.ok || !result.changed) return null;
	const primary =
		result.changedNodeIds.find(
			(nodeId) => nodeId === result.sourceNodeIds[0],
		) ??
		result.changedNodeIds[0] ??
		null;
	return {
		nodeIds: result.changedNodeIds,
		primary,
	};
}
