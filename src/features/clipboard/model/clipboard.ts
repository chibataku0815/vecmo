import { castDraft } from "immer";
import type { SceneCommand } from "@/entities/scene/model/command";
import { duplicateEffectIntentFieldAssignmentsForTargets } from "@/entities/scene/model/effect-field-identity";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import { remapClonedMotionParentBindings } from "@/entities/scene/model/motion-relations";
import {
	getNodeLocalBounds,
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import {
	selectAllArtboards,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import { duplicateSourceOpticsRelationsForNodeMap } from "@/entities/scene/model/source-optics-commands";
import type {
	Bounds,
	NodeGeometry,
	NodeStyle,
	SceneDocument,
	SceneLayer,
	Transform,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";

export const CLIPBOARD_PAYLOAD_KIND = "vector-motion-author/clipboard" as const;
export const CLIPBOARD_PAYLOAD_VERSION = 1 as const;
export const DEFAULT_PASTE_OFFSET = { x: 16, y: 16 } as const satisfies Vec2;

/** Operation label carried by typed clipboard issues for UI routing. */
export type ClipboardOperation = "copy" | "paste" | "duplicate";

/** Stable issue codes returned instead of silently dropping invalid sources. */
export type ClipboardIssueCode =
	| "clipboard.cross-artboard-payload"
	| "clipboard.cross-artboard-target"
	| "clipboard.cross-layer-paste-unsupported"
	| "clipboard.cross-layer-source"
	| "clipboard.cross-layer-target"
	| "clipboard.duplicate-source"
	| "clipboard.empty-payload"
	| "clipboard.empty-selection"
	| "clipboard.empty-target-selection"
	| "clipboard.hidden-source"
	| "clipboard.invalid-payload"
	| "clipboard.locked-source"
	| "clipboard.missing-layer"
	| "clipboard.missing-source"
	| "clipboard.missing-target"
	| "clipboard.nested-source-unsupported"
	| "clipboard.protected-source"
	| "clipboard.protected-target";

/** Clipboard planning currently treats every issue as either blocking or FYI. */
export type ClipboardIssueSeverity = "warning" | "error";

/** Explains which document protection boundary blocked a source or target. */
export type ClipboardProtectionReason =
	| "ancestor-hidden"
	| "ancestor-locked"
	| "layer-hidden"
	| "layer-locked"
	| "node-hidden"
	| "node-locked";

/** Typed feedback for copy, paste, and duplicate planning failures. */
export type ClipboardIssue = {
	readonly code: ClipboardIssueCode;
	readonly message: string;
	readonly severity: ClipboardIssueSeverity;
	readonly operation: ClipboardOperation;
	readonly sourceId?: string;
	readonly layerId?: string;
	readonly reason?: ClipboardProtectionReason;
};

/** POJO payload that can be serialized by UI code without using DOM Clipboard. */
export type ClipboardPayload = {
	readonly kind: typeof CLIPBOARD_PAYLOAD_KIND;
	readonly schemaVersion: typeof CLIPBOARD_PAYLOAD_VERSION;
	readonly source: {
		readonly documentId: string;
		readonly layerId: string;
		readonly nodeIds: readonly string[];
	};
	readonly nodes: readonly VectorNode[];
};

/** Successful payload planning result for copy-like operations. */
export type ClipboardPayloadSuccess = {
	readonly ok: true;
	readonly payload: ClipboardPayload;
	readonly issues: readonly ClipboardIssue[];
};

/** Blocking payload planning result with typed issues for the caller. */
export type ClipboardPayloadFailure = {
	readonly ok: false;
	readonly issues: readonly ClipboardIssue[];
};

/** Payload helper result shared by copy build and payload parsing. */
export type ClipboardPayloadResult =
	| ClipboardPayloadSuccess
	| ClipboardPayloadFailure;

export type ClipboardPayloadParseResult = ClipboardPayloadResult;

/** Successful paste/duplicate planning result ready for the scene command bus. */
export type ClipboardCommandSuccess = {
	readonly ok: true;
	readonly operation: "paste" | "duplicate";
	readonly command: SceneCommand;
	readonly payload: ClipboardPayload;
	readonly targetLayerId: string;
	readonly newRootNodeIds: readonly string[];
	readonly idMap: Readonly<Record<string, string>>;
	readonly offset: Vec2;
	readonly issues: readonly ClipboardIssue[];
};

/** Blocking paste/duplicate planning result with no scene command. */
export type ClipboardCommandFailure = {
	readonly ok: false;
	readonly operation: "paste" | "duplicate";
	readonly issues: readonly ClipboardIssue[];
};

/** Command builder result consumed by future UI/shortcut bridges. */
export type ClipboardCommandResult =
	| ClipboardCommandSuccess
	| ClipboardCommandFailure;

type ClipboardSourceLocation = {
	readonly node: VectorNode;
	readonly layer: SceneLayer;
	readonly layerIndex: number;
	readonly topLevelIndex: number;
	readonly parentIds: readonly string[];
	readonly hiddenByAncestor: boolean;
	readonly lockedByAncestor: boolean;
};

const issue = (
	code: ClipboardIssueCode,
	message: string,
	severity: ClipboardIssueSeverity,
	operation: ClipboardOperation,
	options: {
		readonly sourceId?: string;
		readonly layerId?: string;
		readonly reason?: ClipboardProtectionReason;
	} = {},
): ClipboardIssue => ({
	code,
	message,
	severity,
	operation,
	...options,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isVec2 = (value: unknown): value is Vec2 =>
	isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isBounds = (value: unknown): value is Bounds =>
	isRecord(value) &&
	isFiniteNumber(value.x) &&
	isFiniteNumber(value.y) &&
	isFiniteNumber(value.width) &&
	isFiniteNumber(value.height);

const isTransform = (value: unknown): value is Transform =>
	isRecord(value) &&
	isVec2(value.position) &&
	isFiniteNumber(value.rotation) &&
	isVec2(value.scale) &&
	isVec2(value.anchor);

const isStyle = (value: unknown): value is NodeStyle =>
	isRecord(value) &&
	typeof value.fill === "string" &&
	typeof value.stroke === "string" &&
	isFiniteNumber(value.strokeWidth) &&
	isFiniteNumber(value.opacity);

const isPointTuple = (value: unknown): value is [number, number] =>
	Array.isArray(value) &&
	value.length === 2 &&
	isFiniteNumber(value[0]) &&
	isFiniteNumber(value[1]);

const isAeShapePayload = (
	value: unknown,
): value is Extract<NodeGeometry, { readonly kind: "path" }>["shape"] => {
	if (!isRecord(value)) return false;
	if (value.type !== "Shape" || typeof value.closed !== "boolean") return false;
	return (
		Array.isArray(value.vertices) &&
		Array.isArray(value.inTangents) &&
		Array.isArray(value.outTangents) &&
		value.vertices.every(isPointTuple) &&
		value.inTangents.every(isPointTuple) &&
		value.outTangents.every(isPointTuple)
	);
};

const isGeometry = (value: unknown): value is NodeGeometry => {
	if (!isRecord(value) || typeof value.kind !== "string") return false;
	switch (value.kind) {
		case "rect":
			return isBounds(value.bounds) && isFiniteNumber(value.cornerRadius);
		case "ellipse":
			return isBounds(value.bounds);
		case "line":
			return isVec2(value.start) && isVec2(value.end);
		case "polygon":
			return Array.isArray(value.points) && value.points.every(isVec2);
		case "star":
			return (
				isVec2(value.center) &&
				isFiniteNumber(value.points) &&
				isFiniteNumber(value.innerRadius) &&
				isFiniteNumber(value.outerRadius)
			);
		case "path":
			return isAeShapePayload(value.shape);
		case "text":
			return isBounds(value.bounds) && typeof value.text === "string";
		case "image":
			return isBounds(value.bounds) && typeof value.assetId === "string";
		default:
			return false;
	}
};

const isVectorNode = (value: unknown): value is VectorNode => {
	if (!isRecord(value)) return false;
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		!isGeometry(value.geometry) ||
		!isTransform(value.transform) ||
		!isStyle(value.style) ||
		typeof value.visible !== "boolean" ||
		typeof value.locked !== "boolean"
	) {
		return false;
	}
	if (value.recipeRef !== undefined && typeof value.recipeRef !== "string") {
		return false;
	}
	if (value.data !== undefined && !isRecord(value.data)) return false;
	if (value.children === undefined) return true;
	return Array.isArray(value.children) && value.children.every(isVectorNode);
};

const isClipboardPayload = (value: unknown): value is ClipboardPayload => {
	if (!isRecord(value)) return false;
	if (
		value.kind !== CLIPBOARD_PAYLOAD_KIND ||
		value.schemaVersion !== CLIPBOARD_PAYLOAD_VERSION ||
		!isRecord(value.source) ||
		typeof value.source.documentId !== "string" ||
		typeof value.source.layerId !== "string" ||
		!Array.isArray(value.source.nodeIds) ||
		!value.source.nodeIds.every((nodeId) => typeof nodeId === "string") ||
		!Array.isArray(value.nodes) ||
		!value.nodes.every(isVectorNode)
	) {
		return false;
	}
	return true;
};

const locateNode = (
	document: SceneDocument,
	nodeId: string,
): ClipboardSourceLocation | undefined => {
	for (const [layerIndex, layer] of document.layers.entries()) {
		const visit = (
			nodes: readonly VectorNode[],
			parentIds: readonly string[],
			topLevelIndex: number,
			hiddenByAncestor: boolean,
			lockedByAncestor: boolean,
		): ClipboardSourceLocation | undefined => {
			for (const [index, node] of nodes.entries()) {
				const rootIndex = parentIds.length === 0 ? index : topLevelIndex;
				if (node.id === nodeId) {
					return {
						node,
						layer,
						layerIndex,
						topLevelIndex: rootIndex,
						parentIds,
						hiddenByAncestor,
						lockedByAncestor,
					};
				}
				if (node.children) {
					const child = visit(
						node.children,
						[...parentIds, node.id],
						rootIndex,
						hiddenByAncestor || !node.visible,
						lockedByAncestor || node.locked,
					);
					if (child) return child;
				}
			}
			return undefined;
		};

		const found = visit(layer.nodes, [], 0, false, false);
		if (found) return found;
	}
	return undefined;
};

const sourceProtectionIssues = (
	location: ClipboardSourceLocation,
	operation: ClipboardOperation,
): ClipboardIssue[] => {
	const issues: ClipboardIssue[] = [];
	const { node, layer } = location;
	if (location.parentIds.length > 0) {
		issues.push(
			issue(
				"clipboard.nested-source-unsupported",
				"Clipboard commands currently accept top-level layer sources; nested child paste needs an explicit parent insertion contract.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id },
			),
		);
	}
	if (!node.visible) {
		issues.push(
			issue(
				"clipboard.hidden-source",
				"Hidden clipboard sources are protected from copy and duplicate operations.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id, reason: "node-hidden" },
			),
		);
	}
	if (node.locked) {
		issues.push(
			issue(
				"clipboard.locked-source",
				"Locked clipboard sources are protected from copy and duplicate operations.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id, reason: "node-locked" },
			),
		);
	}
	if (!layer.visible) {
		issues.push(
			issue(
				"clipboard.protected-source",
				"Clipboard sources in hidden layers are protected from copy and duplicate operations.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id, reason: "layer-hidden" },
			),
		);
	}
	if (layer.locked) {
		issues.push(
			issue(
				"clipboard.protected-source",
				"Clipboard sources in locked layers are protected from copy and duplicate operations.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id, reason: "layer-locked" },
			),
		);
	}
	if (location.hiddenByAncestor) {
		issues.push(
			issue(
				"clipboard.protected-source",
				"Clipboard sources under hidden parents are protected from copy and duplicate operations.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id, reason: "ancestor-hidden" },
			),
		);
	}
	if (location.lockedByAncestor) {
		issues.push(
			issue(
				"clipboard.protected-source",
				"Clipboard sources under locked parents are protected from copy and duplicate operations.",
				"error",
				operation,
				{ sourceId: node.id, layerId: layer.id, reason: "ancestor-locked" },
			),
		);
	}
	return issues;
};

const collectSourceLocations = (
	document: SceneDocument,
	sourceNodeIds: readonly string[],
	operation: ClipboardOperation,
): {
	readonly locations: readonly ClipboardSourceLocation[];
	readonly issues: readonly ClipboardIssue[];
} => {
	const issues: ClipboardIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of sourceNodeIds) {
		if (uniqueIds.includes(nodeId)) {
			issues.push(
				issue(
					"clipboard.duplicate-source",
					"Clipboard source ids must be unique.",
					"error",
					operation,
					{ sourceId: nodeId },
				),
			);
			continue;
		}
		uniqueIds.push(nodeId);
	}

	if (uniqueIds.length === 0) {
		issues.push(
			issue(
				"clipboard.empty-selection",
				"Clipboard commands require at least one selected source node.",
				"error",
				operation,
			),
		);
	}

	const locations: ClipboardSourceLocation[] = [];
	for (const nodeId of uniqueIds) {
		const location = locateNode(document, nodeId);
		if (!location) {
			issues.push(
				issue(
					"clipboard.missing-source",
					"Clipboard source node was not found in the scene.",
					"error",
					operation,
					{ sourceId: nodeId },
				),
			);
			continue;
		}
		issues.push(...sourceProtectionIssues(location, operation));
		locations.push(location);
	}

	const layerIds = new Set(locations.map((location) => location.layer.id));
	if (layerIds.size > 1) {
		issues.push(
			issue(
				"clipboard.cross-layer-source",
				"Clipboard core currently supports same-layer source sets only.",
				"error",
				operation,
			),
		);
	}

	return { locations, issues };
};

const sortLocationsForLayerOrder = (
	locations: readonly ClipboardSourceLocation[],
): readonly ClipboardSourceLocation[] =>
	[...locations].sort((left, right) => {
		if (left.layerIndex !== right.layerIndex) {
			return left.layerIndex - right.layerIndex;
		}
		return left.topLevelIndex - right.topLevelIndex;
	});

const hasError = (issues: readonly ClipboardIssue[]): boolean =>
	issues.some((item) => item.severity === "error");

const pointFromMatrix = (matrix: Matrix2D, point: Vec2): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const boundsFromPoints = (points: readonly Vec2[]): Bounds | null => {
	if (points.length === 0) return null;
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const transformedNodeBounds = (node: VectorNode): Bounds => {
	const bounds = getNodeLocalBounds(node);
	const matrix = matrixFromTransform(node.transform);
	const transformed = [
		pointFromMatrix(matrix, { x: bounds.x, y: bounds.y }),
		pointFromMatrix(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
		pointFromMatrix(matrix, {
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		}),
		pointFromMatrix(matrix, { x: bounds.x, y: bounds.y + bounds.height }),
	];
	const result = boundsFromPoints(transformed);
	if (!result) return { x: 0, y: 0, width: 0, height: 0 };
	return result;
};

const unionNodeBounds = (nodes: readonly VectorNode[]): Bounds | null =>
	boundsFromPoints(
		nodes.flatMap((node) => {
			const bounds = transformedNodeBounds(node);
			return [
				{ x: bounds.x, y: bounds.y },
				{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
			];
		}),
	);

const collectPasteOverTargetLocations = (
	document: SceneDocument,
	targetNodeIds: readonly string[],
): {
	readonly locations: readonly ClipboardSourceLocation[];
	readonly issues: readonly ClipboardIssue[];
} => {
	const issues: ClipboardIssue[] = [];
	const uniqueIds: string[] = [];
	for (const nodeId of targetNodeIds) {
		if (!uniqueIds.includes(nodeId)) uniqueIds.push(nodeId);
	}

	if (uniqueIds.length === 0) {
		issues.push(
			issue(
				"clipboard.empty-target-selection",
				"Paste over selection needs at least one target node.",
				"error",
				"paste",
			),
		);
	}

	const locations: ClipboardSourceLocation[] = [];
	for (const nodeId of uniqueIds) {
		const location = locateNode(document, nodeId);
		if (!location) {
			issues.push(
				issue(
					"clipboard.missing-target",
					"Paste-over target node was not found in the scene.",
					"error",
					"paste",
					{ sourceId: nodeId },
				),
			);
			continue;
		}
		locations.push(location);
	}

	const layerIds = new Set(locations.map((location) => location.layer.id));
	if (layerIds.size > 1) {
		issues.push(
			issue(
				"clipboard.cross-layer-target",
				"Paste over selection currently needs target nodes in one layer.",
				"error",
				"paste",
			),
		);
	}

	return { locations, issues };
};

/**
 * Creates the serializable scene clipboard payload for a same-layer top-level
 * selection. The payload keeps node order in layer/render order, not caller
 * array order, because paste must preserve visual stacking.
 */
export function buildClipboardPayload(
	document: SceneDocument,
	sourceNodeIds: readonly string[],
): ClipboardPayloadResult {
	return buildClipboardPayloadForOperation(document, sourceNodeIds, "copy");
}

const buildClipboardPayloadForOperation = (
	document: SceneDocument,
	sourceNodeIds: readonly string[],
	operation: ClipboardOperation,
): ClipboardPayloadResult => {
	const { locations, issues } = collectSourceLocations(
		document,
		sourceNodeIds,
		operation,
	);
	if (hasError(issues)) return { ok: false, issues };

	const ordered = sortLocationsForLayerOrder(locations);
	const layerId = ordered[0]?.layer.id;
	if (!layerId) {
		return {
			ok: false,
			issues: [
				issue(
					"clipboard.empty-selection",
					"Clipboard commands require at least one selected source node.",
					"error",
					operation,
				),
			],
		};
	}

	return {
		ok: true,
		payload: {
			kind: CLIPBOARD_PAYLOAD_KIND,
			schemaVersion: CLIPBOARD_PAYLOAD_VERSION,
			source: {
				documentId: document.id,
				layerId,
				nodeIds: ordered.map((location) => location.node.id),
			},
			nodes: cloneSceneDocument(ordered.map((location) => location.node)),
		},
		issues,
	};
};

/**
 * Serializes a payload without touching browser Clipboard APIs. UI bridges can
 * choose their own transport while this model layer stays deterministic.
 */
export function serializeClipboardPayload(payload: ClipboardPayload): string {
	return JSON.stringify(payload);
}

/**
 * Parses a JSON string or already-decoded value back into a typed clipboard
 * payload. The guard validates the scene-node shape enough to keep invalid
 * external payloads out of command planning.
 */
export function parseClipboardPayload(
	input: string | unknown,
): ClipboardPayloadParseResult {
	let parsedInput: unknown = input;
	if (typeof input === "string") {
		const parsed = parseJsonPayload(input);
		if (!parsed.ok) return parsed;
		parsedInput = parsed.input;
	}

	if (!isClipboardPayload(parsedInput)) {
		return {
			ok: false,
			issues: [
				issue(
					"clipboard.invalid-payload",
					"Clipboard payload is not a supported vector-motion-author payload.",
					"error",
					"paste",
				),
			],
		};
	}

	return {
		ok: true,
		payload: cloneSceneDocument(parsedInput),
		issues: [],
	};
}

const parseJsonPayload = (
	input: string,
):
	| { readonly ok: true; readonly input: unknown }
	| { readonly ok: false; readonly issues: readonly ClipboardIssue[] } => {
	try {
		return { ok: true, input: JSON.parse(input) as unknown };
	} catch {
		return {
			ok: false,
			issues: [
				issue(
					"clipboard.invalid-payload",
					"Clipboard payload JSON could not be parsed.",
					"error",
					"paste",
				),
			],
		};
	}
};

const collectNodeIds = (
	nodes: readonly VectorNode[],
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		output.push(node.id);
		if (node.children) collectNodeIds(node.children, output);
	}
	return output;
};

const createUniqueNodeId = (usedIds: Set<string>): string => {
	let nextId = createId("node");
	while (usedIds.has(nextId)) nextId = createId("node");
	usedIds.add(nextId);
	return nextId;
};

const addOffset = (position: Vec2, offset: Vec2): Vec2 => ({
	x: position.x + offset.x,
	y: position.y + offset.y,
});

const normalizeOffset = (offset: Vec2 | undefined): Vec2 => {
	if (!offset) return DEFAULT_PASTE_OFFSET;
	return {
		x: Number.isFinite(offset.x) ? offset.x : DEFAULT_PASTE_OFFSET.x,
		y: Number.isFinite(offset.y) ? offset.y : DEFAULT_PASTE_OFFSET.y,
	};
};

const cloneNodeForPaste = (
	node: VectorNode,
	options: {
		readonly usedIds: Set<string>;
		readonly idMap: Map<string, string>;
		readonly offset: Vec2;
		readonly offsetRoot: boolean;
		readonly targetArtboardId?: string;
	},
): VectorNode => {
	const cloned = cloneSceneDocument(node);
	const nextId = createUniqueNodeId(options.usedIds);
	options.idMap.set(node.id, nextId);
	const children = node.children?.map((child) =>
		cloneNodeForPaste(child, {
			...options,
			offsetRoot: false,
		}),
	);

	return {
		...cloned,
		id: nextId,
		...(options.targetArtboardId
			? { artboardId: options.targetArtboardId }
			: {}),
		transform: options.offsetRoot
			? {
					...cloned.transform,
					position: addOffset(cloned.transform.position, options.offset),
				}
			: cloned.transform,
		...(children ? { children } : {}),
	};
};

const insertionIndexForSourceIds = (
	nodes: readonly VectorNode[],
	sourceNodeIds: readonly string[],
): number => {
	const indexes = sourceNodeIds
		.map((nodeId) => nodes.findIndex((node) => node.id === nodeId))
		.filter((index) => index >= 0);
	if (indexes.length === 0) return nodes.length;
	return Math.max(...indexes) + 1;
};

const payloadShapeIssues = (
	payload: ClipboardPayload,
	operation: ClipboardOperation,
): ClipboardIssue[] => {
	const issues: ClipboardIssue[] = [];
	if (payload.nodes.length === 0) {
		issues.push(
			issue(
				"clipboard.empty-payload",
				"Clipboard paste requires at least one payload node.",
				"error",
				operation,
			),
		);
	}

	const payloadIds = collectNodeIds(payload.nodes);
	if (new Set(payloadIds).size !== payloadIds.length) {
		issues.push(
			issue(
				"clipboard.invalid-payload",
				"Clipboard payload node ids must be unique before remapping.",
				"error",
				operation,
			),
		);
	}

	if (payload.source.nodeIds.length !== payload.nodes.length) {
		issues.push(
			issue(
				"clipboard.invalid-payload",
				"Clipboard payload source root ids must match payload root nodes.",
				"error",
				operation,
			),
		);
	}

	return issues;
};

const targetLayerIssues = (
	document: SceneDocument,
	payload: ClipboardPayload,
	targetLayerId: string,
	operation: ClipboardOperation,
): {
	readonly layer?: SceneLayer;
	readonly issues: readonly ClipboardIssue[];
} => {
	const issues: ClipboardIssue[] = [];
	if (targetLayerId !== payload.source.layerId) {
		issues.push(
			issue(
				"clipboard.cross-layer-paste-unsupported",
				"Clipboard core currently supports paste back into the payload source layer only.",
				"error",
				operation,
				{ layerId: targetLayerId },
			),
		);
	}

	const layer = document.layers.find((item) => item.id === targetLayerId);
	if (!layer) {
		issues.push(
			issue(
				"clipboard.missing-layer",
				"Clipboard paste target layer was not found in the scene.",
				"error",
				operation,
				{ layerId: targetLayerId },
			),
		);
		return { issues };
	}

	if (!layer.visible) {
		issues.push(
			issue(
				"clipboard.protected-target",
				"Clipboard paste target layer is hidden.",
				"error",
				operation,
				{ layerId: targetLayerId, reason: "layer-hidden" },
			),
		);
	}
	if (layer.locked) {
		issues.push(
			issue(
				"clipboard.protected-target",
				"Clipboard paste target layer is locked.",
				"error",
				operation,
				{ layerId: targetLayerId, reason: "layer-locked" },
			),
		);
	}
	return { layer, issues };
};

const hasNodeIdCollision = (
	document: SceneDocument,
	nodeIds: readonly string[],
): boolean => {
	const existingIds = new Set(
		collectNodeIds(document.layers.flatMap((layer) => layer.nodes)),
	);
	return nodeIds.some((nodeId) => existingIds.has(nodeId));
};

const createInsertClipboardNodesCommand = (options: {
	readonly operation: "paste" | "duplicate";
	readonly payload: ClipboardPayload;
	readonly targetLayerId: string;
	readonly nodes: readonly VectorNode[];
	readonly idMap: Readonly<Record<string, string>>;
	readonly copyLiveFieldSidecars: boolean;
	readonly insertionReferenceNodeIds?: readonly string[];
}): SceneCommand => ({
	type:
		options.operation === "duplicate"
			? "clipboard/duplicate-nodes"
			: "clipboard/paste-nodes",
	label: options.operation === "duplicate" ? "Duplicate" : "Paste",
	run: (draft) => {
		const targetLayer = draft.layers.find(
			(layer) => layer.id === options.targetLayerId,
		);
		if (!targetLayer?.visible || targetLayer.locked) return;
		if (hasNodeIdCollision(draft, collectNodeIds(options.nodes))) return;
		const insertionIndex = insertionIndexForSourceIds(
			targetLayer.nodes,
			options.insertionReferenceNodeIds ?? options.payload.source.nodeIds,
		);
		targetLayer.nodes.splice(
			insertionIndex,
			0,
			...castDraft(cloneSceneDocument(options.nodes)),
		);
		const liveNodeIds = new Set(
			collectNodeIds(draft.layers.flatMap((layer) => layer.nodes)),
		);
		const canCopyLiveFieldSidecars =
			options.copyLiveFieldSidecars &&
			(options.operation === "duplicate" ||
				(options.payload.source.documentId === draft.id &&
					options.payload.source.nodeIds.every((nodeId) =>
						liveNodeIds.has(nodeId),
					)));
		if (!canCopyLiveFieldSidecars) return;
		const targetIds = new Map(Object.entries(options.idMap));
		const effectIntentOwners = [
			draft,
			draft.artboard,
			...(draft.artboards ?? []),
		];
		for (const owner of effectIntentOwners) {
			const nextIntent = duplicateEffectIntentFieldAssignmentsForTargets(
				owner.effectIntent,
				targetIds,
			);
			if (!nextIntent || nextIntent === owner.effectIntent) continue;
			owner.effectIntent = castDraft(cloneSceneDocument(nextIntent));
		}
		for (const artboard of [draft.artboard, ...(draft.artboards ?? [])]) {
			const sourceOpticsRigs = duplicateSourceOpticsRelationsForNodeMap(
				artboard.sourceOpticsRigs,
				options.idMap,
			);
			if (!sourceOpticsRigs || sourceOpticsRigs === artboard.sourceOpticsRigs) {
				continue;
			}
			artboard.sourceOpticsRigs = castDraft(
				cloneSceneDocument(sourceOpticsRigs),
			);
		}
	},
});

const buildPasteClipboardCommandInternal = (
	document: SceneDocument,
	payload: ClipboardPayload,
	options: {
		readonly operation: "paste" | "duplicate";
		readonly targetLayerId?: string;
		readonly offset?: Vec2;
		readonly insertionReferenceNodeIds?: readonly string[];
		readonly targetArtboardId?: string;
	} = { operation: "paste" },
): ClipboardCommandResult => {
	const operation = options.operation;
	const targetLayerId = options.targetLayerId ?? payload.source.layerId;
	const issues = [
		...payloadShapeIssues(payload, operation),
		...targetLayerIssues(document, payload, targetLayerId, operation).issues,
	];
	if (hasError(issues)) return { ok: false, operation, issues };

	const offset = normalizeOffset(options.offset);
	const usedIds = new Set(
		collectNodeIds(document.layers.flatMap((layer) => layer.nodes)),
	);
	const idMap = new Map<string, string>();
	const clonedNodes = payload.nodes.map((node) =>
		cloneNodeForPaste(node, {
			usedIds,
			idMap,
			offset,
			offsetRoot: true,
			targetArtboardId: options.targetArtboardId,
		}),
	);
	const pastedNodes = remapClonedMotionParentBindings(clonedNodes, idMap).nodes;
	const idMapObject = Object.fromEntries(idMap.entries());
	const sourceArtboardIds = knownPayloadRootArtboardIds(document, payload);
	const copyLiveFieldSidecars =
		operation === "duplicate" ||
		(payload.source.documentId === document.id &&
			(options.targetArtboardId === undefined ||
				(sourceArtboardIds.size === 1 &&
					sourceArtboardIds.has(options.targetArtboardId))));

	return {
		ok: true,
		operation,
		command: createInsertClipboardNodesCommand({
			operation,
			payload,
			targetLayerId,
			nodes: pastedNodes,
			idMap: idMapObject,
			copyLiveFieldSidecars,
			insertionReferenceNodeIds: options.insertionReferenceNodeIds,
		}),
		payload,
		targetLayerId,
		newRootNodeIds: pastedNodes.map((node) => node.id),
		idMap: idMapObject,
		offset,
		issues,
	};
};

/**
 * Builds a paste command from a serializable payload. The initial contract is
 * deliberately same-layer only so later parent/cross-layer UI can add explicit
 * insertion semantics without guessing in the model layer.
 */
export function buildPasteClipboardCommand(
	document: SceneDocument,
	payload: ClipboardPayload,
	options: {
		readonly targetLayerId?: string;
		readonly offset?: Vec2;
	} = {},
): ClipboardCommandResult {
	return buildPasteClipboardCommandInternal(document, payload, {
		...options,
		operation: "paste",
	});
}

const knownPayloadRootArtboardIds = (
	document: SceneDocument,
	payload: ClipboardPayload,
): ReadonlySet<string> => {
	const mapping = selectNodeArtboardMapping(document);
	const validArtboardIds = new Set(
		selectAllArtboards(document).map((artboard) => artboard.id),
	);
	const artboardIds = new Set<string>();
	for (const [index, node] of payload.nodes.entries()) {
		const mapped = mapping.byNodeId[payload.source.nodeIds[index] ?? ""];
		if (mapped) {
			artboardIds.add(mapped);
			continue;
		}
		if (node.artboardId && validArtboardIds.has(node.artboardId)) {
			artboardIds.add(node.artboardId);
		}
	}
	return artboardIds;
};

/**
 * Builds a paste command whose root payload bounds land over the current target
 * selection. This keeps paste-in-place and paste-over-selection as two explicit
 * clipboard placements: in-place uses a zero offset, while over-selection derives
 * the offset from scene geometry without guessing in the UI layer.
 */
export function buildPasteOverSelectionClipboardCommand(
	document: SceneDocument,
	payload: ClipboardPayload,
	targetNodeIds: readonly string[],
	options: {
		readonly targetLayerId?: string;
	} = {},
): ClipboardCommandResult {
	const targetResolution = collectPasteOverTargetLocations(
		document,
		targetNodeIds,
	);
	if (hasError(targetResolution.issues)) {
		return {
			ok: false,
			operation: "paste",
			issues: targetResolution.issues,
		};
	}

	const artboardMapping = selectNodeArtboardMapping(document);
	const targetArtboardIds = new Set(
		targetResolution.locations.flatMap((location) => {
			const artboardId = artboardMapping.byNodeId[location.node.id];
			return artboardId ? [artboardId] : [];
		}),
	);
	if (targetArtboardIds.size > 1) {
		return {
			ok: false,
			operation: "paste",
			issues: [
				...targetResolution.issues,
				issue(
					"clipboard.cross-artboard-target",
					"Paste over selection currently needs target nodes in one artboard.",
					"error",
					"paste",
				),
			],
		};
	}

	const payloadArtboardIds = knownPayloadRootArtboardIds(document, payload);
	if (payloadArtboardIds.size > 1) {
		return {
			ok: false,
			operation: "paste",
			issues: [
				...targetResolution.issues,
				issue(
					"clipboard.cross-artboard-payload",
					"Paste over selection currently needs clipboard roots from one artboard.",
					"error",
					"paste",
				),
			],
		};
	}

	const targetBounds = unionNodeBounds(
		targetResolution.locations.map((location) => location.node),
	);
	const payloadBounds = unionNodeBounds(payload.nodes);
	if (!targetBounds || !payloadBounds) {
		return {
			ok: false,
			operation: "paste",
			issues: [
				...targetResolution.issues,
				issue(
					payload.nodes.length === 0
						? "clipboard.empty-payload"
						: "clipboard.empty-target-selection",
					payload.nodes.length === 0
						? "Clipboard paste requires at least one payload node."
						: "Paste over selection could not resolve target bounds.",
					"error",
					"paste",
				),
			],
		};
	}

	return buildPasteClipboardCommandInternal(document, payload, {
		operation: "paste",
		targetLayerId:
			options.targetLayerId ?? targetResolution.locations[0]?.layer.id,
		offset: {
			x: targetBounds.x - payloadBounds.x,
			y: targetBounds.y - payloadBounds.y,
		},
		targetArtboardId: [...targetArtboardIds][0],
		insertionReferenceNodeIds: targetResolution.locations.map(
			(location) => location.node.id,
		),
	});
}

/**
 * Builds duplicate as copy-payload planning plus same-layer paste planning.
 * Callers apply the returned command through the scene command bus and can use
 * `newRootNodeIds` to update selection after the command succeeds.
 */
export function buildDuplicateClipboardCommand(
	document: SceneDocument,
	sourceNodeIds: readonly string[],
	options: {
		readonly offset?: Vec2;
	} = {},
): ClipboardCommandResult {
	const payloadResult = buildClipboardPayloadForOperation(
		document,
		sourceNodeIds,
		"duplicate",
	);
	if (!payloadResult.ok) {
		return {
			ok: false,
			operation: "duplicate",
			issues: payloadResult.issues,
		};
	}
	return buildPasteClipboardCommandInternal(document, payloadResult.payload, {
		operation: "duplicate",
		offset: options.offset,
	});
}
