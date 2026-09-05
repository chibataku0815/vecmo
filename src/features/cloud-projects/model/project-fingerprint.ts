import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import { serializeMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import type { SceneDocument } from "@/entities/scene/model/types";
import { stableJsonStringify } from "@/shared/lib/stable-json";

const textFingerprint = (text: string): string => {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash.toString(36);
};

/**
 * Stable dirty-check fingerprint for cloud autosave. It intentionally excludes
 * backup `savedAt` so an unchanged document does not look dirty just because a
 * new portable backup timestamp would be emitted.
 */
export function cloudProjectFingerprint({
	grammar,
	motion,
	scene,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar: MotionGrammarStoreDocument;
}): string {
	return textFingerprint(
		stableJsonStringify({
			scene,
			motion,
			grammar: serializeMotionGrammarLayer(
				grammar.bindings,
				grammar.passthrough,
			),
		}),
	);
}
