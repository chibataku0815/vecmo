import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import {
	createStrokeDrawOnAuthoringPlan,
	drawOnFramesFromDurationMs,
} from "@/entities/motion-grammar/model/stroke-draw-on-authoring";
import { useSceneStore } from "@/entities/scene/model/store";
import { useStrokeIntentStore } from "@/shared/stroke/intent-store";

/**
 * Stroke-to-draw-on authoring: turns a committed Pencil path into an animated
 * reveal that draws itself on over the clip. It fills the `stroke-draw-on`
 * expression technique registered in `entities/motion-grammar`.
 *
 * It is deliberately opt-in (never auto-applied) and reversible. Two facts shape
 * the v1 contract:
 * - Renderers ignore a dash array while a `strokeWidthProfile` is present, and a
 *   freehand commit always attaches one, so draw-on strips the profile. Draw-on
 *   and the pressure-width taper are therefore mutually exclusive in v1;
 *   undoing the style command restores the taper.
 * - The technique marches `strokeDashoffset` additively over a static offset of
 *   0, so a `+L → 0` reveal reads as hidden → drawn and removing the binding
 *   leaves the committed stroke fully visible.
 */

export { drawOnFramesFromDurationMs };

/**
 * Turns a committed path node into a draw-on reveal over `durationFrames`. Sets a
 * full-length dash and a static offset of 0, strips the pressure width profile,
 * and binds the marching `stroke-draw-on` technique. Returns false when the node
 * is missing, is not a path, or has zero length.
 */
export function authorStrokeDrawOn({
	nodeId,
	durationFrames,
	reverse = false,
}: {
	readonly nodeId: string;
	readonly durationFrames: number;
	readonly reverse?: boolean;
}): boolean {
	const plan = createStrokeDrawOnAuthoringPlan({
		scene: useSceneStore.getState().document,
		nodeId,
		durationFrames,
		reverse,
	});
	if (plan.status === "blocked") return false;
	for (const command of plan.sceneCommands) {
		useSceneStore.getState().apply(command);
	}
	for (const command of plan.grammarCommands) {
		useMotionGrammarStore.getState().apply(command);
	}
	return true;
}

/**
 * Applies draw-on to the most recently committed Pencil stroke, using its
 * captured duration as the initial clip length, then consumes the intent so the
 * next gesture starts fresh. No-op (returns false) when no intent is pending.
 */
export function authorStrokeDrawOnFromLastIntent(): boolean {
	const intent = useStrokeIntentStore.getState().lastIntent;
	if (!intent) return false;
	const fps = useMotionStore.getState().document.fps;
	const durationFrames = drawOnFramesFromDurationMs(
		intent.signals.durationMs,
		fps,
	);
	const applied = authorStrokeDrawOn({ nodeId: intent.id, durationFrames });
	if (applied) useStrokeIntentStore.getState().clearLastIntent();
	return applied;
}
