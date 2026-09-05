/**
 * Pure comparison contract for a Motion Study law.
 *
 * An oracle is deliberately outside Scene, Motion, store, renderer, and export
 * ownership. It makes a candidate law's inputs and named critical samples
 * inspectable without becoming another persisted motion representation.
 */

/** One named frame used to compare an independent law oracle and a Vecmo candidate. */
export type MotionStudyReferenceCriticalFrame = {
	readonly id: string;
	readonly frame: number;
	readonly purpose: string;
};

/** A reference-law sample either exists or is structurally invalid. */
export type MotionStudyReferenceResult<TSample> =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly samples: readonly TSample[];
	  };

/**
 * A store-free comparison oracle. It is deterministic only when its supplied
 * sampler and validator are pure and deterministic; the harness cannot enforce
 * that callback contract. It is not a product expression definition: callers
 * must never serialize executable callbacks into a Vecmo document.
 */
export type MotionStudyReferenceOracle<TInput, TSample> = {
	readonly id: string;
	readonly criticalFrames: (
		input: TInput,
	) => MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame>;
	readonly sample: (
		input: TInput,
		frame: number,
	) => MotionStudyReferenceResult<TSample>;
};

export const isFiniteReferenceNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/**
 * Wraps a finite frame into a positive finite period. Null preserves a
 * fail-closed oracle result instead of emitting NaN into a comparison packet.
 */
export const wrapReferenceFrame = (
	frame: number,
	periodFrames: number,
): number | null => {
	if (!isFiniteReferenceNumber(frame)) return null;
	if (!isFiniteReferenceNumber(periodFrames) || periodFrames <= 0) return null;
	const wrapped = frame % periodFrames;
	return wrapped < 0 ? wrapped + periodFrames : wrapped;
};
