import type { ProgramSurfaceApprovalScope } from "./local-approval";

/**
 * Ephemeral diagnostic state for the isolated V1 host. This deliberately lives
 * beside local approval rather than in SceneDocument: a runtime failure is a
 * property of one browser/session, not a durable collaborator-visible fact.
 */
export type ProgramSurfaceRuntimeStatus =
	| {
			readonly assetId: string;
			readonly nodeId: string;
			readonly kind: "booting";
	  }
	| {
			readonly assetId: string;
			readonly nodeId: string;
			readonly kind: "live";
	  }
	| {
			readonly assetId: string;
			readonly nodeId: string;
			readonly kind: "fallback";
			readonly code: ProgramSurfaceRuntimeIssueCode;
	  }
	| {
			readonly assetId: string;
			readonly nodeId: string;
			readonly kind: "disposed";
	  };

/** Only bounded host codes are allowed into inspector-facing runtime state. */
export type ProgramSurfaceRuntimeIssueCode =
	| "program-surface.host-unavailable"
	| "program-surface.bootstrap-failed"
	| "program-surface.webgl2-unavailable"
	| "program-surface.module-failed"
	| "program-surface.protocol-invalid"
	| "program-surface.output-size-invalid"
	| "program-surface.frame-stalled"
	| "program-surface.context-lost"
	| "program-surface.frame-invalid"
	| "program-surface.stale-frame"
	| "program-surface.bundle-static-gate-rejected";

export type ProgramSurfaceRuntimeStatusRegistry = {
	/** Inspector-facing public read API; null means no host is currently mounted. */
	readonly statusFor: (
		assetId: string,
		nodeId?: string,
	) => ProgramSurfaceRuntimeStatus | null;
	readonly publish: (status: ProgramSurfaceRuntimeStatus) => void;
	readonly clear: (assetId: string, nodeId?: string) => void;
	readonly clearAll: () => void;
	readonly bindSession: (scope: ProgramSurfaceApprovalScope) => void;
	readonly subscribe: (listener: () => void) => () => void;
};

const statusKey = (assetId: string, nodeId: string): string =>
	`${assetId}\u0000${nodeId}`;

/**
 * Creates a small read model used by Inspector or future diagnostics surfaces.
 * It never writes the scene, persists an issue, or retains host/source objects.
 */
export const createProgramSurfaceRuntimeStatusRegistry =
	(): ProgramSurfaceRuntimeStatusRegistry => {
		const statuses = new Map<string, ProgramSurfaceRuntimeStatus>();
		const listeners = new Set<() => void>();
		let sessionKey: string | null = null;
		const notify = (): void => {
			for (const listener of listeners) listener();
		};
		const clearAll = (): void => {
			if (statuses.size === 0) return;
			statuses.clear();
			notify();
		};
		return {
			statusFor: (assetId, nodeId) => {
				if (nodeId) return statuses.get(statusKey(assetId, nodeId)) ?? null;
				for (const status of statuses.values()) {
					if (status.assetId === assetId) return status;
				}
				return null;
			},
			publish: (status) => {
				const key = statusKey(status.assetId, status.nodeId);
				const previous = statuses.get(key);
				if (
					previous?.kind === status.kind &&
					previous.assetId === status.assetId &&
					previous.nodeId === status.nodeId &&
					("code" in previous ? previous.code : undefined) ===
						("code" in status ? status.code : undefined)
				) {
					return;
				}
				statuses.set(key, Object.freeze({ ...status }));
				notify();
			},
			clear: (assetId, nodeId) => {
				if (nodeId) {
					if (!statuses.delete(statusKey(assetId, nodeId))) return;
					notify();
					return;
				}
				let changed = false;
				for (const [key, status] of statuses) {
					if (status.assetId !== assetId) continue;
					statuses.delete(key);
					changed = true;
				}
				if (changed) notify();
			},
			clearAll,
			bindSession: (scope) => {
				const nextKey =
					JSON.stringify([
						scope.editorInstanceId,
						scope.workingCopyId,
						String(scope.bindingEpoch),
					]) ?? "";
				if (sessionKey === nextKey) return;
				sessionKey = nextKey;
				clearAll();
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
	};

/** Page-session runtime status registry for read-only Inspector diagnostics. */
export const programSurfaceRuntimeStatusRegistry =
	createProgramSurfaceRuntimeStatusRegistry();

/** Convenience public read API for Inspector consumers that do not need a subscription. */
export const readProgramSurfaceRuntimeStatus = (
	assetId: string,
	nodeId?: string,
): ProgramSurfaceRuntimeStatus | null =>
	programSurfaceRuntimeStatusRegistry.statusFor(assetId, nodeId);
