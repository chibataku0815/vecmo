import { upsertLookNodeKeyframe } from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import type { LookGraphOwnerRef } from "@/entities/scene/model/look-graph";

/**
 * Reveal direction for {@link seedRisoPrintBloom}: `"in"` develops the riso dots
 * from nothing (0) to full (1), `"out"` dissolves them from full back to nothing.
 */
export type RisoPrintBloomDirection = "in" | "out";

let printBloomGestureSeq = 0;

/**
 * Seeds a `bloomProgress` 0→1 (or 1→0) keyframe ramp on a `riso` Look-graph node —
 * the one-click "Print Bloom" authoring convenience. This writes no new sampling
 * or shader code: `bloomProgress` is already a keyframable Look-node param sampled
 * every frame via `effectiveLookNodeParam` → `patchLookGraphForOwner` →
 * `sampleFrameLookGraphScene` at playback and across all export targets. Seeding
 * two keyframes inside one motion transaction (the same store dispatch
 * `applyLookNodeParamKeyframe` in `./look-node-keyframing` uses, but batched like
 * `keyNodePoseAtPlayhead` in `features/motion/model/key-pose.ts`) folds both
 * writes into a single undo entry even though each `upsertLookNodeKeyframe`
 * command carries its own per-(track, frame) coalesce key — the transaction's own
 * key governs the outer merge, and the per-call `printBloomGestureSeq` stops two
 * consecutive seeds from coalescing into each other.
 */
export const seedRisoPrintBloom = (args: {
	readonly owner: LookGraphOwnerRef;
	readonly risoNodeId: string;
	readonly direction: RisoPrintBloomDirection;
	readonly durationFrames: number;
	readonly startFrame?: number;
}): void => {
	const { owner, risoNodeId, direction, durationFrames, startFrame } = args;
	const paramKey = "bloomProgress";
	const start = Math.max(0, Math.round(startFrame ?? 0));
	const end = start + Math.max(1, Math.round(durationFrames));
	const v0 = direction === "in" ? 0 : 1;
	const v1 = direction === "in" ? 1 : 0;

	const store = useMotionStore.getState();
	printBloomGestureSeq += 1;
	store.beginTransaction(
		`riso-print-bloom:${risoNodeId}:${printBloomGestureSeq}`,
		"Print Bloom",
	);
	store.apply(upsertLookNodeKeyframe(owner, risoNodeId, paramKey, start, v0));
	store.apply(upsertLookNodeKeyframe(owner, risoNodeId, paramKey, end, v1));
	store.commit();
};
