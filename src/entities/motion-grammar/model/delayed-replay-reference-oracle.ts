import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

/**
 * One ordered consumer of a shared master phrase. roleId is an oracle-only
 * semantic label; Vecmo candidates map it to their own durable role slot.
 */
export type DelayedReplayReferenceTarget = {
	readonly targetId: string;
	readonly roleId: string;
	readonly delayFrames: number;
};

/**
 * Inputs for an independent delayed-replay comparison.
 *
 * sampleMaster and isMasterSampleValid are supplied by the source-law oracle
 * rather than Vecmo's product evaluator. They must be pure and deterministic;
 * this keeps the comparison harness from validating one implementation only
 * against itself.
 */
export type DelayedReplayReferenceInput<TValue> = {
	readonly periodFrames: number;
	readonly targets: readonly DelayedReplayReferenceTarget[];
	readonly masterCriticalFrames?: readonly MotionStudyReferenceCriticalFrame[];
	readonly sampleMaster: (input: {
		readonly localFrame: number;
		readonly target: DelayedReplayReferenceTarget;
	}) => TValue;
	readonly isMasterSampleValid: (value: TValue) => boolean;
};

/** One target's replayed master sample at a global comparison frame. */
export type DelayedReplayReferenceSample<TValue> = {
	readonly targetId: string;
	readonly roleId: string;
	readonly order: number;
	readonly delayFrames: number;
	readonly sourceFrame: number;
	readonly value: TValue;
};

const blocked = <TValue>(
	reason: string,
): MotionStudyReferenceResult<DelayedReplayReferenceSample<TValue>> => ({
	status: "blocked",
	reason,
});

const blockedCriticalFrames = (
	reason: string,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> => ({
	status: "blocked",
	reason,
});

const validTargets = (
	targets: readonly DelayedReplayReferenceTarget[],
): string | null => {
	if (targets.length === 0) {
		return "Delayed replay requires at least one target.";
	}
	const seenTargetIds = new Set<string>();
	for (const target of targets) {
		if (!target.targetId) return "Delayed replay target id is required.";
		if (!target.roleId) return "Delayed replay role id is required.";
		if (seenTargetIds.has(target.targetId)) {
			return `Delayed replay target "${target.targetId}" is duplicated.`;
		}
		if (!Number.isFinite(target.delayFrames)) {
			return `Delayed replay delay for "${target.targetId}" must be finite.`;
		}
		if (target.delayFrames < 0) {
			return `Delayed replay delay for "${target.targetId}" must be zero or greater.`;
		}
		seenTargetIds.add(target.targetId);
	}
	return null;
};

/**
 * Samples one master phrase through explicit ordered target delays.
 *
 * This is the delayed-address sublaw used by a Time Delay comparison. It does
 * not invent a jump, look, node, or renderer representation; those are supplied
 * by the reference-side master sampler and the Vecmo candidate independently.
 */
export function sampleDelayedReplayReference<TValue>(
	input: DelayedReplayReferenceInput<TValue>,
	frame: number,
): MotionStudyReferenceResult<DelayedReplayReferenceSample<TValue>> {
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null) {
		return blocked(
			"Delayed replay frame and period must be finite; period must be positive.",
		);
	}
	const targetIssue = validTargets(input.targets);
	if (targetIssue) return blocked(targetIssue);
	const samples: DelayedReplayReferenceSample<TValue>[] = [];
	for (const [order, target] of input.targets.entries()) {
		const sourceFrame = wrapReferenceFrame(
			localFrame - target.delayFrames,
			input.periodFrames,
		);
		if (sourceFrame === null) {
			return blocked(
				`Delayed replay source frame for "${target.targetId}" is invalid.`,
			);
		}
		try {
			const value = input.sampleMaster({ localFrame: sourceFrame, target });
			if (!input.isMasterSampleValid(value)) {
				return blocked(
					'Delayed replay source sampler returned an invalid value for "' +
						target.targetId +
						'" at frame ' +
						sourceFrame +
						".",
				);
			}
			samples.push({
				targetId: target.targetId,
				roleId: target.roleId,
				order,
				delayFrames: target.delayFrames,
				sourceFrame,
				value,
			});
		} catch {
			return blocked(
				'Delayed replay source sampler or validator failed for "' +
					target.targetId +
					'" at frame ' +
					sourceFrame +
					".",
			);
		}
	}
	return { status: "ready", samples };
}

/**
 * Merges source-law critical frames with shifted proof points for every target
 * in the temporal fanout and a loop-seam frame.
 */
export function delayedReplayReferenceCriticalFrames<TValue>(
	input: DelayedReplayReferenceInput<TValue>,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	if (!Number.isFinite(input.periodFrames) || input.periodFrames <= 0) {
		return blockedCriticalFrames(
			"Delayed replay period must be finite and positive.",
		);
	}
	const targetIssue = validTargets(input.targets);
	if (targetIssue) return blockedCriticalFrames(targetIssue);
	const masterCriticalFrames = input.masterCriticalFrames?.length
		? input.masterCriticalFrames
		: [
				{
					id: "master-start",
					frame: 0,
					purpose: "Master phrase begins at its rest or declared start state.",
				},
			];
	const masterCriticalIds = new Set<string>();
	for (const criticalFrame of masterCriticalFrames) {
		if (
			!criticalFrame.id ||
			!criticalFrame.purpose ||
			!isFiniteReferenceNumber(criticalFrame.frame) ||
			masterCriticalIds.has(criticalFrame.id)
		) {
			return blockedCriticalFrames(
				"Delayed replay master critical frames require unique ids, purposes, and finite frames.",
			);
		}
		masterCriticalIds.add(criticalFrame.id);
	}
	const frames: MotionStudyReferenceCriticalFrame[] = [];
	const outputIds = new Set<string>();
	const appendCriticalFrame = (
		criticalFrame: MotionStudyReferenceCriticalFrame,
	): boolean => {
		if (outputIds.has(criticalFrame.id)) return false;
		outputIds.add(criticalFrame.id);
		frames.push(criticalFrame);
		return true;
	};
	for (const criticalFrame of masterCriticalFrames) {
		const frame = wrapReferenceFrame(criticalFrame.frame, input.periodFrames);
		if (frame === null) {
			return blockedCriticalFrames(
				"Delayed replay master critical frame is invalid.",
			);
		}
		if (!appendCriticalFrame({ ...criticalFrame, frame })) {
			return blockedCriticalFrames(
				"Delayed replay emitted a duplicate critical-frame id.",
			);
		}
	}
	for (const target of input.targets) {
		for (const criticalFrame of masterCriticalFrames) {
			const frame = wrapReferenceFrame(
				criticalFrame.frame + target.delayFrames,
				input.periodFrames,
			);
			if (frame === null) {
				return blockedCriticalFrames(
					"Delayed replay target critical frame is invalid.",
				);
			}
			const replayId = ["replay", target.targetId, criticalFrame.id]
				.map((part) => `${String(part.length)}:${part}`)
				.join("|");
			if (
				!appendCriticalFrame({
					id: replayId,
					frame,
					purpose:
						'Role "' +
						target.roleId +
						'" replays master critical frame "' +
						criticalFrame.id +
						'".',
				})
			) {
				return blockedCriticalFrames(
					"Delayed replay emitted a duplicate critical-frame id.",
				);
			}
		}
	}
	if (
		!appendCriticalFrame({
			id: "loop-seam",
			frame: input.periodFrames,
			purpose:
				"One full period later; every replay must wrap to the initial state.",
		})
	) {
		return blockedCriticalFrames(
			"Delayed replay emitted a duplicate critical-frame id.",
		);
	}
	return { status: "ready", samples: frames };
}

/** Store-free delayed-address oracle adapter. */
export const DELAYED_REPLAY_REFERENCE_ORACLE = {
	id: "delayed-replay",
	criticalFrames: delayedReplayReferenceCriticalFrames,
	sample: sampleDelayedReplayReference,
} satisfies MotionStudyReferenceOracle<
	DelayedReplayReferenceInput<unknown>,
	DelayedReplayReferenceSample<unknown>
>;
