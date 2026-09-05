import type {
	LookGraph,
	LookGraphEdge,
	LookGraphNodeKind,
	LookGraphNodePayload,
} from "./look-graph";
import type { LookGraphFidelity, LookGraphPlan } from "./look-graph-compile";
import { lookGraphToEffectLayerStack } from "./look-graph-project";

/** Honest per-node support tier carried straight from the graph compiler. */
export type LookGraphFidelityStatus = LookGraphFidelity["status"];

/** SVG export reproduces only the `native` tier at full fidelity. */
const SVG_FAITHFUL_STATUSES: readonly LookGraphFidelityStatus[] = ["native"];

/** SVG export can faithfully render or approximate these tiers. */
const SVG_REPRESENTABLE_STATUSES: readonly LookGraphFidelityStatus[] = [
	"native",
	"approx",
];

/**
 * One graph node as it appears in an export/runtime manifest. The `payload` is
 * the canonical vec-core recipe/routing slice the node references (color/glow/
 * texture for effects, mask routing + `influenceAssignmentIds`, composite blend/
 * mix) — no scalar state is duplicated. `svgFaithful`/`svgRepresentable` are
 * derived from the compiler fidelity so SVG export never overclaims a node.
 */
export type LookGraphExportNode = {
	readonly nodeId: string;
	readonly kind: LookGraphNodeKind;
	readonly label: string;
	readonly enabled: boolean;
	readonly fidelity: LookGraphFidelity;
	readonly svgFaithful: boolean;
	readonly svgRepresentable: boolean;
	readonly payload: LookGraphNodePayload;
};

/**
 * Renderer-neutral, serializable manifest for a compiled Look graph. Export, MCP,
 * and UI adapters can all report the same node ids, edges, and honest support
 * tiers from this single shape. SVG-faithfulness is a strict projection of the
 * compiler's fidelity, so a deferred/runtime-only/capture-only node is surfaced
 * in `svgUnsupportedNodeIds` instead of being silently claimed by the exporter.
 */
export type LookGraphExportManifest = {
	readonly schemaVersion: LookGraph["schemaVersion"];
	readonly owner: LookGraphPlan["owner"];
	readonly outputNodeId: string;
	readonly cacheKey: string;
	readonly outwardReach: number;
	readonly nodeCount: number;
	readonly enabledNodeCount: number;
	/** True only when the graph is a linear chain projectable to a layer stack. */
	readonly serialProjectable: boolean;
	/** True only when every node is reproduced at full SVG fidelity (`native`). */
	readonly svgFaithful: boolean;
	/** True only when every node is at least SVG-approximable (`native`/`approx`). */
	readonly svgRepresentable: boolean;
	readonly fidelityStatuses: readonly LookGraphFidelityStatus[];
	/** Node ids SVG export must not claim (deferred/runtime/capture/unsupported). */
	readonly svgUnsupportedNodeIds: readonly string[];
	readonly nodes: readonly LookGraphExportNode[];
	readonly edges: readonly LookGraphEdge[];
};

const sortedUniqueStatuses = (
	statuses: readonly LookGraphFidelityStatus[],
): readonly LookGraphFidelityStatus[] =>
	[...new Set(statuses)].sort((left, right) => left.localeCompare(right));

/**
 * Builds an export/runtime manifest from a Look graph and its compiled plan. The
 * compiler is the single source of per-node fidelity, so this join only adds the
 * authoring-level metadata (`label`, canonical `payload`, edges) the compiled
 * plan does not carry and derives SVG support honestly from each node's tier.
 */
export function lookGraphExportManifest(
	graph: LookGraph,
	plan: LookGraphPlan,
): LookGraphExportManifest {
	const fidelityByNodeId = new Map(
		plan.fidelity.map((entry) => [entry.nodeId, entry]),
	);
	const nodes: readonly LookGraphExportNode[] = graph.nodes.map((node) => {
		const fidelity: LookGraphFidelity = fidelityByNodeId.get(node.id) ?? {
			nodeId: node.id,
			status: "native",
		};
		return {
			nodeId: node.id,
			kind: node.kind,
			label: node.label,
			enabled: node.enabled,
			fidelity,
			svgFaithful: SVG_FAITHFUL_STATUSES.includes(fidelity.status),
			svgRepresentable: SVG_REPRESENTABLE_STATUSES.includes(fidelity.status),
			payload: node.payload,
		};
	});
	return {
		schemaVersion: graph.schemaVersion,
		owner: plan.owner,
		outputNodeId: graph.outputNodeId,
		cacheKey: plan.cacheKey,
		outwardReach: plan.outwardReach,
		nodeCount: nodes.length,
		enabledNodeCount: nodes.filter((node) => node.enabled).length,
		serialProjectable: lookGraphToEffectLayerStack(graph) !== undefined,
		svgFaithful: nodes.every((node) => node.svgFaithful),
		svgRepresentable: nodes.every((node) => node.svgRepresentable),
		fidelityStatuses: sortedUniqueStatuses(
			nodes.map((node) => node.fidelity.status),
		),
		svgUnsupportedNodeIds: nodes
			.filter((node) => !node.svgRepresentable)
			.map((node) => node.nodeId),
		nodes,
		edges: graph.edges,
	};
}
