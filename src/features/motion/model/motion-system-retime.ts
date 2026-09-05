import type { AnimationClipRange } from "@/entities/motion/model/clips";
import {
	applyInMotionTransaction,
	beginMotionTransaction,
	commitMotionTransaction,
	type MotionGestureTransaction,
} from "@/entities/motion/model/gesture-transaction";
import { useMotionStore } from "@/entities/motion/model/store";
import { createMotionGrammarClipRetimePlan } from "@/entities/motion-grammar/model/retime";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";

export type MotionSystemRetimeResult =
	| {
			readonly status: "retimed";
			readonly durationParameterKey?: string;
	  }
	| {
			readonly status: "blocked";
			readonly reason: "missing-clip" | "stale-transaction";
	  };

export type MotionSystemRetimeGesture = {
	readonly motion: MotionGestureTransaction;
	readonly grammarCoalesceKey: string;
};

/**
 * Opens coordinated motion and grammar transactions for one clip retime gesture.
 * The stores still keep their own histories today, but sharing the coalesce key
 * and label preserves the single user intent for future unified undo plumbing.
 */
export function beginMotionSystemRetimeGesture(
	scope: string,
	label?: string,
): MotionSystemRetimeGesture {
	const motion = beginMotionTransaction(scope, label);
	useMotionGrammarStore
		.getState()
		.beginTransaction(motion.coalesceKey, motion.label);
	return { motion, grammarCoalesceKey: motion.coalesceKey };
}

/**
 * Applies one shared motion-system retime plan inside an active gesture. Timeline
 * edge drags call this repeatedly so clip range and duration-owning grammar
 * parameter stay synchronized for the whole drag.
 */
export function applyMotionSystemRetimeInGesture({
	gesture,
	clipId,
	range,
}: {
	readonly gesture: MotionSystemRetimeGesture;
	readonly clipId: string;
	readonly range: AnimationClipRange;
}): MotionSystemRetimeResult {
	const motionStore = useMotionStore.getState();
	const grammarStore = useMotionGrammarStore.getState();
	const plan = createMotionGrammarClipRetimePlan({
		motion: motionStore.document,
		bindings: grammarStore.document.bindings,
		clipId,
		range,
		coalesceKey: gesture.motion.coalesceKey,
	});
	if (plan.status === "blocked") return plan;
	const applied = applyInMotionTransaction(gesture.motion, plan.motionCommand);
	if (!applied) return { status: "blocked", reason: "stale-transaction" };
	if (plan.grammarCommand) {
		const latestGrammarStore = useMotionGrammarStore.getState();
		if (
			latestGrammarStore.transaction?.coalesceKey !== gesture.grammarCoalesceKey
		) {
			return { status: "blocked", reason: "stale-transaction" };
		}
		latestGrammarStore.apply(plan.grammarCommand);
	}
	return {
		status: "retimed",
		...(plan.durationParameterKey
			? { durationParameterKey: plan.durationParameterKey }
			: {}),
	};
}

/** Commits a coordinated retime gesture after the final pointer or field edit. */
export function commitMotionSystemRetimeGesture(
	gesture: MotionSystemRetimeGesture,
): void {
	commitMotionTransaction(gesture.motion);
	const grammarStore = useMotionGrammarStore.getState();
	if (grammarStore.transaction?.coalesceKey !== gesture.grammarCoalesceKey)
		return;
	grammarStore.commit();
}

/**
 * Applies one Inspector-style motion-system retime edit as a single user intent.
 * This is the same planner used by Timeline trim, wrapped in a short transaction
 * so duration field edits and duration-parameter edits do not diverge.
 */
export function commitMotionSystemClipRetime({
	clipId,
	range,
	label = "Retime motion system",
}: {
	readonly clipId: string;
	readonly range: AnimationClipRange;
	readonly label?: string;
}): MotionSystemRetimeResult {
	const gesture = beginMotionSystemRetimeGesture("motion-system-retime", label);
	const result = applyMotionSystemRetimeInGesture({ gesture, clipId, range });
	commitMotionSystemRetimeGesture(gesture);
	return result;
}
