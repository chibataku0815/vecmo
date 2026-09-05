import type {
	NodeGeometry,
	PathGeometry,
	Transform,
} from "@/entities/scene/model/types";

export const PATH_OPERATIONS = [
	"union",
	"subtract",
	"intersect",
	"exclude",
] as const;

/** Boolean operation names exposed by the path-ops feature. */
export type PathOperation = (typeof PATH_OPERATIONS)[number];

export type PathOpIssueSeverity = "info" | "warning" | "error";

export type PathOpIssueCode =
	| "path-op.too-few-sources"
	| "path-op.duplicate-source"
	| "path-op.missing-source"
	| "path-op.protected-source"
	| "path-op.unsupported-geometry"
	| "path-op.invalid-geometry"
	| "path-op.open-path"
	| "path-op.curve-approximated"
	| "path-op.non-convex-input"
	| "path-op.coincident-edges"
	| "path-op.empty-result"
	| "path-op.compound-result"
	| "path-op.compound-source";

/**
 * Typed operation feedback. Errors block command creation; warnings document
 * lossy approximations such as ellipse/Bezier flattening so callers never drop
 * unsupported fidelity silently.
 */
export type PathOpIssue = {
	readonly code: PathOpIssueCode;
	readonly message: string;
	readonly severity: PathOpIssueSeverity;
	readonly operation?: PathOperation;
	readonly sourceId?: string;
	readonly geometryKind?: NodeGeometry["kind"];
};

/** Source geometry with an optional scene transform baked before clipping. */
export type PathOpSource = {
	readonly id?: string;
	readonly name?: string;
	readonly geometry: NodeGeometry;
	readonly transform?: Transform;
};

export type PathOpSuccess = {
	readonly ok: true;
	readonly operation: PathOperation;
	readonly geometry: PathGeometry;
	readonly issues: readonly PathOpIssue[];
};

export type PathOpFailure = {
	readonly ok: false;
	readonly operation: PathOperation;
	readonly issues: readonly PathOpIssue[];
};

/** Result contract for pure path-operation planning. */
export type PathOpResult = PathOpSuccess | PathOpFailure;
