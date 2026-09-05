/**
 * One parent-consumed Program Surface bitmap may suppress its SVG fallback.
 * The lease is deliberately mount-scoped: a late callback from an iframe that
 * has already been replaced cannot clear or replace a newer host's pixels.
 */
export type ProgramSurfaceLiveFrameLease = {
	readonly mountId: number;
	readonly nodeId: string;
	readonly assetId: string;
	readonly compiledDigest: string;
	/** Parent-clocked content identity, never source or bundle data. */
	readonly contentKey: string;
	readonly sequence: number;
};

export type ProgramSurfaceLiveFrameLeaseUpdate =
	| {
			readonly kind: "live";
			readonly lease: ProgramSurfaceLiveFrameLease;
	  }
	| {
			readonly kind: "clear";
			readonly mountId: number;
	  };

/**
 * Applies a host update without allowing an earlier mount to hide a newer
 * bitmap. The reducer is pure so CanvasShell remains the sole UI owner of the
 * fallback suppression state.
 */
export const applyProgramSurfaceLiveFrameLease = (
	current: ProgramSurfaceLiveFrameLease | null,
	update: ProgramSurfaceLiveFrameLeaseUpdate,
): ProgramSurfaceLiveFrameLease | null => {
	if (update.kind === "clear") {
		return current?.mountId === update.mountId ? null : current;
	}
	const next = update.lease;
	if (!current || next.mountId > current.mountId) return next;
	if (next.mountId < current.mountId) return current;
	if (
		next.nodeId !== current.nodeId ||
		next.assetId !== current.assetId ||
		next.compiledDigest !== current.compiledDigest ||
		next.sequence < current.sequence
	) {
		return current;
	}
	return next.sequence === current.sequence ? current : next;
};
