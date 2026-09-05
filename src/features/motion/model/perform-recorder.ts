import { extendMotionDuration } from "@/entities/motion/model/commands";
import {
	applyInMotionTransaction,
	beginMotionTransaction,
	commitMotionTransaction,
} from "@/entities/motion/model/gesture-transaction";
import { useMotionStore } from "@/entities/motion/model/store";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { createMotionKeyframeCommand } from "@/features/motion/model/authoring-commands";
import { performSamplesToKeyframes } from "@/features/motion/model/perform-recording";
import { useTransportStore } from "@/features/motion/model/transport-store";

/**
 * Store/command-touching half of iPad Pencil-motion "Perform mode" (L3): owns
 * the live capture buffer and the commit-to-keyframes orchestration, wired into
 * a canvas tool handler through `HandlerApi.onPerformSample`/`onPerformCommit`.
 * Kept in `features/motion` (not the canvas widget) because it only ever reaches
 * feature/entity state — the transport, scene, and motion stores plus the motion
 * command bus — and never any canvas-local state, so the recorder is a motion
 * concern the widget merely invokes. The pure `(x, y, tMs) → frame` conversion
 * lives next door in `perform-recording.ts`, which stays store/DOM-free for unit
 * tests; this module is its impure driver.
 */

/**
 * In-flight capture buffer: the samples accumulated for the single node
 * currently being performed. Module-level (like the transform handler's own
 * `drag` gesture state) because only one canvas surface — and therefore one live
 * gesture — exists per app instance; a fresh buffer starts the moment a sample
 * for a DIFFERENT node arrives, so a stale buffer from an interrupted gesture can
 * never bleed into the next one.
 */
let performRecordingBuffer: {
	nodeId: string;
	samples: { x: number; y: number; tMs: number }[];
} | null = null;

/** Scope/label for the ONE motion transaction a Perform commit opens. */
const PERFORM_TRANSACTION_SCOPE = "perform";
const PERFORM_TRANSACTION_LABEL = "Perform";

/**
 * `HandlerApi.onPerformSample` implementation: accumulates one live drag
 * sample into {@link performRecordingBuffer}, starting a fresh buffer on the
 * first sample of a gesture (or if a stray sample somehow arrives for a
 * different node than the buffer holds).
 */
export function recordPerformSample(
	nodeId: string,
	x: number,
	y: number,
	tMs: number,
): void {
	if (!performRecordingBuffer || performRecordingBuffer.nodeId !== nodeId) {
		performRecordingBuffer = { nodeId, samples: [] };
	}
	performRecordingBuffer.samples.push({ x, y, tMs });
}

/**
 * `HandlerApi.onPerformCommit` implementation: converts the accumulated
 * Perform buffer for `nodeId` into x/y keyframes and commits them as ONE
 * motion transaction, then always clears the buffer and disarms Perform —
 * even when there is nothing to commit (buffer missing/empty/for a different
 * node) — so the one-shot arm never gets stuck armed after a gesture ends.
 *
 * Extends `motion.durationFrames` (via {@link extendMotionDuration}) BEFORE
 * authoring any keyframe past the old duration: `createMotionKeyframeCommand`
 * clamps its target frame into the document's CURRENT duration
 * (`motionAuthoringFrame`/`snapMotionFrame`), so authoring in the old order
 * would silently truncate a capture longer than the timeline onto its final
 * frame. Re-reads `useMotionStore.getState().document` after the extend so
 * every keyframe command below clamps against the widened duration, not the
 * stale pre-extend snapshot.
 */
export function commitPerformRecording(nodeId: string): void {
	const buffer = performRecordingBuffer;
	performRecordingBuffer = null;
	useTransportStore.getState().disarmPerform();
	if (!buffer || buffer.nodeId !== nodeId || buffer.samples.length === 0) {
		return;
	}
	const node = findNode(useSceneStore.getState().document, nodeId);
	if (!node) return;
	const keyframes = performSamplesToKeyframes(
		buffer.samples,
		useMotionStore.getState().document.fps,
	);
	const lastFrame = keyframes.at(-1)?.frame;
	if (lastFrame === undefined) return;

	const transaction = beginMotionTransaction(
		PERFORM_TRANSACTION_SCOPE,
		PERFORM_TRANSACTION_LABEL,
	);
	if (lastFrame > useMotionStore.getState().document.durationFrames) {
		applyInMotionTransaction(transaction, extendMotionDuration(lastFrame));
	}
	// Read ONCE, after the extend above (never before it — the pre-extend
	// snapshot's `durationFrames` would still clamp every frame past the old
	// duration). Safe to reuse for the whole loop below: every command here
	// supplies an explicit `value`, so `motion` is only ever read for
	// `durationFrames` (fixed from here on) and never for `tracks`.
	const motion = useMotionStore.getState().document;
	for (const keyframe of keyframes) {
		const xCommand = createMotionKeyframeCommand({
			node,
			motion,
			currentFrame: keyframe.frame,
			property: "x",
			value: keyframe.x,
		});
		if (xCommand) applyInMotionTransaction(transaction, xCommand);
		const yCommand = createMotionKeyframeCommand({
			node,
			motion,
			currentFrame: keyframe.frame,
			property: "y",
			value: keyframe.y,
		});
		if (yCommand) applyInMotionTransaction(transaction, yCommand);
	}
	commitMotionTransaction(transaction);
}
