import {
	type LookGraph,
	type LookGraphDraft,
	type LookGraphEdgeDraft,
	type LookGraphEndpoint,
	type LookGraphNodeDraft,
	type LookGraphNodePayloadDraft,
	lookGraphEdgeId,
	normalizeLookGraph,
	validateLookEdge,
} from "./look-graph";

/**
 * Sparse node edit preserving the node's stable id and kind (a kind change is a
 * remove + add, so ports/ids stay stable). A provided `payload` may be a full
 * canonical slice or a sparse top-level payload patch; omitted `kind` is filled
 * from the target node before normalization. A payload with a different `kind`
 * is rejected. `position: null` clears the layout position; on a blur payload,
 * `radiusY: null` clears the optional Y radius and restores linked X/Y blur.
 */
export type LookGraphNodePayloadPatch = Readonly<Record<string, unknown>> & {
	readonly kind?: LookGraphNodeDraft["kind"];
};

export type LookGraphNodePatch = {
	readonly label?: string;
	readonly enabled?: boolean;
	readonly payload?: LookGraphNodePayloadPatch;
	readonly position?: { readonly x: number; readonly y: number } | null;
};

/** Typed rejection emitted before a sparse payload patch reaches normalization. */
export type LookGraphNodePayloadPatchIssue = {
	readonly code:
		| "payload-kind-mismatch"
		| "payload-key-unsupported"
		| "payload-value-invalid";
	readonly nodeId?: string;
	readonly key: string;
	readonly message: string;
};

const BLUR_PAYLOAD_KEYS = new Set(["kind", "radius", "radiusY"]);

/**
 * Validates sparse Look payload patches before normalization can discard input.
 * Blur is intentionally strict because its public contract is axis-aligned X/Y:
 * accepting fields such as `angle` would falsely imply arbitrary-angle blur.
 */
export function validateLookGraphNodePayloadPatch(
	node: Pick<LookGraphNodeDraft, "id" | "kind">,
	payload: LookGraphNodePayloadPatch | LookGraphNodePayloadDraft | undefined,
): readonly LookGraphNodePayloadPatchIssue[] {
	if (!payload) return [];
	const issues: LookGraphNodePayloadPatchIssue[] = [];
	if (node.kind && payload.kind && payload.kind !== node.kind) {
		issues.push({
			code: "payload-kind-mismatch",
			...(node.id ? { nodeId: node.id } : {}),
			key: "kind",
			message: `Look node kind "${node.kind}" cannot accept payload kind "${payload.kind}".`,
		});
		return issues;
	}
	const kind = node.kind ?? payload.kind;
	if (kind !== "blur") return issues;
	for (const key of Object.keys(payload)) {
		if (BLUR_PAYLOAD_KEYS.has(key)) continue;
		issues.push({
			code: "payload-key-unsupported",
			...(node.id ? { nodeId: node.id } : {}),
			key,
			message: `Axis blur payload does not support "${key}"; only radius and radiusY are valid.`,
		});
	}
	const radius = "radius" in payload ? payload.radius : undefined;
	if (
		radius !== undefined &&
		(typeof radius !== "number" || !Number.isFinite(radius) || radius < 0)
	) {
		issues.push({
			code: "payload-value-invalid",
			...(node.id ? { nodeId: node.id } : {}),
			key: "radius",
			message: "Axis blur radius must be a finite non-negative number.",
		});
	}
	const radiusY = "radiusY" in payload ? payload.radiusY : undefined;
	if (
		radiusY !== undefined &&
		radiusY !== null &&
		(typeof radiusY !== "number" || !Number.isFinite(radiusY) || radiusY < 0)
	) {
		issues.push({
			code: "payload-value-invalid",
			...(node.id ? { nodeId: node.id } : {}),
			key: "radiusY",
			message:
				"Axis blur radiusY must be null or a finite non-negative number.",
		});
	}
	return issues;
}

/**
 * Pure, undoable-friendly graph edit shared by GUI and code-native writers. Each
 * operation maps to exactly one command-bus entry so a single edit is a single
 * undo step. Topology is re-validated by {@link applyLookGraphOperation}, so an
 * invalid connection is dropped rather than corrupting the stored graph.
 */
export type LookGraphOperation =
	| { readonly kind: "add-node"; readonly node: LookGraphNodeDraft }
	| {
			readonly kind: "update-node";
			readonly nodeId: string;
			readonly patch: LookGraphNodePatch;
	  }
	| { readonly kind: "remove-node"; readonly nodeId: string }
	| {
			readonly kind: "connect";
			readonly from: LookGraphEndpoint;
			readonly to: LookGraphEndpoint;
			readonly replaceInput?: boolean;
	  }
	| { readonly kind: "disconnect"; readonly edgeId: string }
	| {
			readonly kind: "move-node";
			readonly nodeId: string;
			readonly position: { readonly x: number; readonly y: number };
	  }
	| { readonly kind: "set-output"; readonly nodeId: string };

/** Converts a normalized graph (or nothing) into a mutable draft for editing. */
const toDraft = (
	graph: LookGraph | undefined,
): {
	nodes: LookGraphNodeDraft[];
	edges: LookGraphEdgeDraft[];
	outputNodeId: string | undefined;
} =>
	graph
		? {
				nodes: graph.nodes.map((node) => ({ ...node })),
				edges: graph.edges.map((edge) => ({ ...edge })),
				outputNodeId: graph.outputNodeId,
			}
		: { nodes: [], edges: [], outputNodeId: undefined };

const mergedPayloadPatch = (
	node: LookGraphNodeDraft,
	patch: LookGraphNodePatch,
): LookGraphNodePayloadDraft | undefined => {
	if (!patch.payload || !node.kind) return undefined;
	if (patch.payload.kind !== undefined && patch.payload.kind !== node.kind) {
		return undefined;
	}
	return {
		...(node.payload ?? { kind: node.kind }),
		...patch.payload,
		kind: node.kind,
	} as LookGraphNodePayloadDraft;
};

const mergedNodePatch = (
	node: LookGraphNodeDraft,
	patch: LookGraphNodePatch,
): LookGraphNodeDraft => {
	const payload = mergedPayloadPatch(node, patch);
	return {
		...node,
		...(patch.label !== undefined ? { label: patch.label } : {}),
		...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
		...(payload ? { payload } : {}),
		...(patch.position === undefined
			? {}
			: patch.position === null
				? { position: undefined }
				: { position: patch.position }),
	};
};

const sameEndpoint = (
	left: LookGraphEndpoint,
	right: LookGraphEndpoint,
): boolean => left.nodeId === right.nodeId && left.portId === right.portId;

const graphForConnectOperation = (
	graph: LookGraph,
	operation: Extract<LookGraphOperation, { readonly kind: "connect" }>,
): LookGraph | undefined => {
	if (!operation.replaceInput) return graph;
	const targetPort = graph.nodes
		.find((node) => node.id === operation.to.nodeId)
		?.inputs.find((port) => port.id === operation.to.portId);
	if (targetPort?.cardinality !== "single") return graph;
	return normalizeLookGraph({
		...graph,
		edges: graph.edges.filter((edge) => !sameEndpoint(edge.to, operation.to)),
	});
};

/**
 * Applies one graph edit as pure data and re-normalizes the result. Command
 * wrappers call this before writing through the scene command bus so GUI, MCP,
 * and future motion surfaces share the same id, port, and topology semantics.
 * Returns `undefined` when the edit empties the graph.
 */
export function applyLookGraphOperation(
	graph: LookGraph | LookGraphDraft | null | undefined,
	operation: LookGraphOperation,
): LookGraph | undefined {
	const current = normalizeLookGraph(graph);
	const next = toDraft(current);

	switch (operation.kind) {
		case "add-node":
			if (
				validateLookGraphNodePayloadPatch(
					operation.node,
					operation.node.payload,
				).length > 0
			) {
				break;
			}
			next.nodes.push({ ...operation.node });
			break;
		case "update-node": {
			const node = next.nodes.find(
				(candidate) => candidate.id === operation.nodeId,
			);
			if (
				node &&
				validateLookGraphNodePayloadPatch(node, operation.patch.payload)
					.length > 0
			) {
				break;
			}
			next.nodes = next.nodes.map((node) =>
				node.id === operation.nodeId
					? mergedNodePatch(node, operation.patch)
					: node,
			);
			break;
		}
		case "move-node":
			next.nodes = next.nodes.map((node) =>
				node.id === operation.nodeId
					? { ...node, position: operation.position }
					: node,
			);
			break;
		case "remove-node":
			next.nodes = next.nodes.filter((node) => node.id !== operation.nodeId);
			next.edges = next.edges.filter(
				(edge) =>
					edge.from?.nodeId !== operation.nodeId &&
					edge.to?.nodeId !== operation.nodeId,
			);
			if (next.outputNodeId === operation.nodeId) next.outputNodeId = undefined;
			break;
		case "connect": {
			// Reject an invalid wire up front so it never reaches command history;
			// normalizeLookGraph would also drop it, but this keeps the intent clear.
			const validationGraph = current
				? graphForConnectOperation(current, operation)
				: undefined;
			if (current && !validationGraph) break;
			if (validationGraph) {
				next.edges = validationGraph.edges.map((edge) => ({ ...edge }));
			}
			if (
				validationGraph &&
				validateLookEdge(validationGraph, operation.from, operation.to).length >
					0
			) {
				break;
			}
			next.edges.push({
				id: lookGraphEdgeId(operation.from, operation.to),
				from: operation.from,
				to: operation.to,
			});
			break;
		}
		case "disconnect":
			next.edges = next.edges.filter((edge) => edge.id !== operation.edgeId);
			break;
		case "set-output":
			next.outputNodeId = operation.nodeId;
			break;
	}

	return normalizeLookGraph(next);
}
