import type { MotionGrammarAuthoringCapabilityId } from "./authoring-capabilities";
import type { MotionGrammarStoreDocument } from "./command";

/** Returns only Motion Grammar capabilities present in the live store document. */
export function presentMotionGrammarAuthoringCapabilities(
	document: MotionGrammarStoreDocument,
): ReadonlySet<MotionGrammarAuthoringCapabilityId> {
	const present = new Set<MotionGrammarAuthoringCapabilityId>();
	if (document.bindings.length > 0) {
		present.add("grammar.bindings");
		present.add("grammar.technique-profile");
		for (const binding of document.bindings) {
			present.add(`grammar.technique.${binding.techniqueId}`);
		}
	}
	if (document.passthrough.length > 0) present.add("grammar.passthrough");
	if ((document.diagnostics?.length ?? 0) > 0)
		present.add("grammar.diagnostics");
	return present;
}
