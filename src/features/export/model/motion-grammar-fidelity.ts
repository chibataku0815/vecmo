import type { SerializedMotionGrammarBinding } from "@/entities/motion/model/grammar-bridge";
import type { ExportIssue } from "./issues";

/**
 * Export-safe fidelity facts for durable Motion Grammar entries that cannot be
 * executed by a runtime. These facts intentionally expose neither serialized
 * parameters nor source locators: a runtime handoff needs the degrade reason,
 * not the unavailable authoring payload.
 */
export type ExportMotionGrammarFidelityIssueCode =
	| "motion-grammar-unknown-binding-omitted"
	| "motion-grammar-unsupported-version-omitted"
	| "motion-grammar-invalid-binding-omitted"
	| "motion-grammar-versioned-binding-pruned";

export type ExportMotionGrammarFidelityIssue = ExportIssue & {
	readonly code: ExportMotionGrammarFidelityIssueCode;
};

/** Minimal source-free diagnostic view; callers must not forward its message. */
export type MotionGrammarPersistenceDiagnostic = {
	readonly bindingId: string;
	readonly code: string;
};

const issue = (
	code: ExportMotionGrammarFidelityIssueCode,
	message: string,
): ExportMotionGrammarFidelityIssue => ({
	severity: "warning",
	category: "unsupported",
	code,
	message,
	fallback: "motion-grammar-omitted",
});

const issueForPersistedDiagnostic = (
	diagnosticCode: string | undefined,
): ExportMotionGrammarFidelityIssue => {
	switch (diagnosticCode) {
		case "unsupported-expression-version":
		case "motion-grammar.expression-version-unsupported":
			return issue(
				"motion-grammar-unsupported-version-omitted",
				"A persisted motion-grammar expression uses an unavailable version and is omitted from runtime playback.",
			);
		case "invalid-versioned-role-map":
		case "invalid-versioned-parameters":
		case "motion-grammar.versioned-binding-invalid":
			return issue(
				"motion-grammar-invalid-binding-omitted",
				"A persisted versioned motion-grammar binding is invalid and is omitted from runtime playback.",
			);
		case "unknown-technique":
			return issue(
				"motion-grammar-unknown-binding-omitted",
				"A persisted motion-grammar technique is unavailable and is omitted from runtime playback.",
			);
		default:
			return issue(
				"motion-grammar-invalid-binding-omitted",
				"A persisted motion-grammar binding cannot be safely executed and is omitted from runtime playback.",
			);
	}
};

/**
 * Converts only durable passthrough bindings into public export fidelity facts.
 * Session-only command rejection diagnostics are deliberately ignored unless
 * they identify a persisted passthrough entry, so the export report never
 * claims that a rejected edit was saved into the document.
 */
export function persistedMotionGrammarFidelityIssuesForExport({
	passthrough,
	diagnostics = [],
}: {
	readonly passthrough: readonly SerializedMotionGrammarBinding[];
	readonly diagnostics?: readonly MotionGrammarPersistenceDiagnostic[];
}): readonly ExportMotionGrammarFidelityIssue[] {
	const diagnosticCodeByBindingId = new Map<string, string>();
	for (const diagnostic of diagnostics) {
		if (!diagnosticCodeByBindingId.has(diagnostic.bindingId)) {
			diagnosticCodeByBindingId.set(diagnostic.bindingId, diagnostic.code);
		}
	}
	return passthrough.map((binding) =>
		issueForPersistedDiagnostic(diagnosticCodeByBindingId.get(binding.id)),
	);
}

/**
 * A V1 direct role map became incomplete after hidden nodes were projected
 * away. It is safer to omit the whole relation than to reinterpret a surviving
 * subset with a different semantic role assignment.
 */
export const prunedVersionedMotionGrammarBindingIssue =
	(): ExportMotionGrammarFidelityIssue =>
		issue(
			"motion-grammar-versioned-binding-pruned",
			"A versioned motion-grammar relation loses a required role in this export scope and is omitted from runtime playback.",
		);

/** A rich binding violates its explicit versioned contract at export time. */
export const invalidVersionedMotionGrammarBindingIssue =
	(): ExportMotionGrammarFidelityIssue =>
		issue(
			"motion-grammar-invalid-binding-omitted",
			"A versioned motion-grammar binding is invalid and is omitted from runtime playback.",
		);

/** A rich binding selects an unavailable version and must not enter a runtime. */
export const unsupportedVersionedMotionGrammarBindingIssue =
	(): ExportMotionGrammarFidelityIssue =>
		issue(
			"motion-grammar-unsupported-version-omitted",
			"A motion-grammar expression uses an unavailable version and is omitted from runtime playback.",
		);
