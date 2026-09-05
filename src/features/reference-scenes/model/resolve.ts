import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import { restoreMotionDocumentFromSerialized } from "@/entities/motion/model/serialization";
import { parseMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import { blankSceneDocument } from "@/entities/scene/model/seed-scene";
import { restoreSceneDocumentFromSerialized } from "@/entities/scene/model/serialization";
import type { ReferenceSceneFixture } from "../fixtures";
import type { ResolvedReferenceScene } from "./types";

/**
 * Rehydrates a reference fixture's serialized strings into live documents using
 * the exact persistence restore path the editor runs on reload, so any fixture
 * that resolves here is guaranteed loadable in the editor. The motion side-car
 * carries its grammar layer inline (mirroring local autosave); this splits it
 * back out into the `{bindings, passthrough}` the grammar store loads, keeping
 * scene, motion, and grammar in lockstep.
 *
 * On a malformed fixture the underlying restorers fall back to blank/seed rather
 * than throwing — the `check:reference-scenes` gate is what fails the build on
 * such drift, so the gallery degrades to an empty study instead of crashing.
 */
export function resolveReferenceScene(
	fixture: ReferenceSceneFixture,
): ResolvedReferenceScene {
	const scene = restoreSceneDocumentFromSerialized(
		fixture.sceneEnvelope,
		blankSceneDocument,
	).document;
	const restoredMotion = restoreMotionDocumentFromSerialized(
		fixture.motionEnvelope,
		initialMotionDocument,
	).document;
	const { grammar: serializedGrammar, ...motion } = restoredMotion;
	const parsed = parseMotionGrammarLayer(serializedGrammar);
	return {
		scene,
		motion,
		grammar: {
			bindings: parsed.bindings,
			passthrough: parsed.passthrough,
			diagnostics: parsed.issues,
		},
	};
}
