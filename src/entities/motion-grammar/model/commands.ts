import { castDraft } from "immer";
import { validateMotionGrammarBinding } from "./binding-validation";
import {
	clearMotionGrammarCommandValidationDiagnostic,
	type MotionGrammarCommand,
	setMotionGrammarCommandValidationDiagnostic,
} from "./command";
import type {
	MotionGrammarArrangementMapping,
	MotionGrammarBinding,
	MotionGrammarEffectBinding,
	MotionGrammarRandomPulseProfile,
} from "./types";
import {
	type VersionedMotionExpressionBindingValidationIssue,
	validateVersionedMotionExpressionBinding,
} from "./versioned-expression-binding";

/** Mutable subset of a binding that {@link updateGrammarBinding} can patch. */
export type MotionGrammarBindingPatch = Partial<
	Pick<MotionGrammarBinding, "targetIds" | "parameters">
> & {
	readonly randomPulseProfile?: MotionGrammarRandomPulseProfile | null;
	readonly roleMap?: Readonly<Record<string, string>> | null;
	readonly arrangementMapping?: MotionGrammarArrangementMapping | null;
	readonly seed?: number | null;
	readonly effectBinding?: MotionGrammarEffectBinding | null;
};

const commandValidationDiagnostic = (
	binding: MotionGrammarBinding,
	issue: VersionedMotionExpressionBindingValidationIssue,
) => ({
	code:
		issue.code === "unsupported-expression-version"
			? ("motion-grammar.expression-version-unsupported" as const)
			: ("motion-grammar.versioned-binding-invalid" as const),
	bindingId: binding.id,
	techniqueId: binding.techniqueId,
	// Do not reflect arbitrary parameter keys, role-map values, or caller payload
	// into the store diagnostic. The detailed reason remains local to validation;
	// this session-visible fact stays source-free.
	message:
		issue.code === "unsupported-expression-version"
			? "Motion expression version is unsupported or malformed; the binding was not written."
			: issue.code === "invalid-versioned-role-map"
				? "Versioned motion expression role map does not meet the declared direct role contract; the binding was not written."
				: "Versioned motion expression parameters do not meet the declared numeric contract; the binding was not written.",
});

const nextBindingForValidation = (
	binding: MotionGrammarBinding,
	patch: MotionGrammarBindingPatch,
): MotionGrammarBinding => ({
	...binding,
	...(patch.parameters
		? { parameters: { ...binding.parameters, ...patch.parameters } }
		: {}),
	...(patch.targetIds ? { targetIds: [...patch.targetIds] } : {}),
	...(patch.roleMap !== undefined
		? { roleMap: patch.roleMap ? { ...patch.roleMap } : undefined }
		: {}),
	...(patch.randomPulseProfile !== undefined
		? { randomPulseProfile: patch.randomPulseProfile ?? undefined }
		: {}),
	...(patch.arrangementMapping !== undefined
		? { arrangementMapping: patch.arrangementMapping ?? undefined }
		: {}),
	...(patch.seed !== undefined
		? { seed: patch.seed === null ? undefined : patch.seed }
		: {}),
	...(patch.effectBinding !== undefined
		? { effectBinding: patch.effectBinding ?? undefined }
		: {}),
});

/**
 * The grammar runner (`runMotionGrammarCommands`) and combined grammar commands
 * both invoke this command body's `run` function. Validate the complete
 * candidate before touching durable binding fields so no bypass path can persist
 * malformed intrinsic state or an invalid active versioned expression.
 */
const rejectInvalidBindingWrite = (
	draft: Parameters<MotionGrammarCommand["run"]>[0],
	binding: MotionGrammarBinding,
): boolean => {
	const bindingIssue = validateMotionGrammarBinding(binding);
	if (bindingIssue) {
		setMotionGrammarCommandValidationDiagnostic(draft, {
			code: "motion-grammar.binding-invalid",
			bindingId: binding.id,
			techniqueId: binding.techniqueId,
			message: `${bindingIssue.message} The binding was not written.`,
		});
		return true;
	}
	const issue = validateVersionedMotionExpressionBinding(binding);
	if (!issue) return false;
	setMotionGrammarCommandValidationDiagnostic(
		draft,
		commandValidationDiagnostic(binding, issue),
	);
	return true;
};

/**
 * Apply (or replace by id) a grammar binding. Discrete create — no coalesce key,
 * so each apply is its own undo step.
 */
export function applyGrammarBinding(
	binding: MotionGrammarBinding,
): MotionGrammarCommand {
	return {
		type: "motion-grammar/apply",
		label: "Apply Motion Technique",
		run: (draft) => {
			if (rejectInvalidBindingWrite(draft, binding)) return;
			const index = draft.bindings.findIndex((b) => b.id === binding.id);
			if (index >= 0) draft.bindings[index] = castDraft(binding);
			else draft.bindings.push(castDraft(binding));
			// A newly applied rich binding explicitly supersedes a same-id inert
			// serialized binding. Keeping both would serialize two durable ids and
			// make reload order choose behavior implicitly.
			const passthroughIndex = draft.passthrough.findIndex(
				(item) => item.id === binding.id,
			);
			if (passthroughIndex >= 0) draft.passthrough.splice(passthroughIndex, 1);
			if (draft.diagnostics) {
				draft.diagnostics = draft.diagnostics.filter(
					(diagnostic) => diagnostic.bindingId !== binding.id,
				);
			}
		},
	};
}

/**
 * Patch an existing binding. The caller supplies a per-gesture `coalesceKey` so a
 * live drag collapses into one undo step while separate edits stay distinct
 * (mirrors the inspector scrub-gesture coalescing). Absent target id is a no-op.
 */
export function updateGrammarBinding(
	id: string,
	patch: MotionGrammarBindingPatch,
	options: { readonly coalesceKey?: string } = {},
): MotionGrammarCommand {
	return {
		type: "motion-grammar/update",
		label: "Adjust Motion Technique",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const binding = draft.bindings.find((b) => b.id === id);
			if (!binding) return;
			const candidate = nextBindingForValidation(binding, patch);
			if (rejectInvalidBindingWrite(draft, candidate)) return;
			if (patch.parameters) {
				binding.parameters = { ...binding.parameters, ...patch.parameters };
			}
			if (patch.targetIds) binding.targetIds = [...patch.targetIds];
			if (patch.randomPulseProfile !== undefined) {
				binding.randomPulseProfile = patch.randomPulseProfile
					? {
							...patch.randomPulseProfile,
							segments: patch.randomPulseProfile.segments.map((segment) => ({
								...segment,
								easing: [...segment.easing] as [number, number, number, number],
							})),
						}
					: undefined;
			}
			if (patch.roleMap !== undefined) {
				binding.roleMap = patch.roleMap ? { ...patch.roleMap } : undefined;
			}
			if (patch.arrangementMapping !== undefined) {
				binding.arrangementMapping = patch.arrangementMapping
					? {
							...patch.arrangementMapping,
							sourceToStage: { ...patch.arrangementMapping.sourceToStage },
							stageToDestination: {
								...patch.arrangementMapping.stageToDestination,
							},
							stageSlots: Object.fromEntries(
								Object.entries(patch.arrangementMapping.stageSlots).map(
									([key, point]) => [key, { ...point }],
								),
							),
							pivot: { ...patch.arrangementMapping.pivot },
							...(patch.arrangementMapping.stagingDelayFractionBySource
								? {
										stagingDelayFractionBySource: {
											...patch.arrangementMapping.stagingDelayFractionBySource,
										},
									}
								: {}),
						}
					: undefined;
			}
			if (patch.seed !== undefined) {
				binding.seed = patch.seed === null ? undefined : patch.seed;
			}
			if (patch.effectBinding !== undefined) {
				binding.effectBinding = patch.effectBinding ?? undefined;
			}
			clearMotionGrammarCommandValidationDiagnostic(draft, id);
		},
	};
}

/** Reorders one active binding in the durable Motion Grammar stack. */
export function reorderGrammarBinding(
	id: string,
	toIndex: number,
): MotionGrammarCommand {
	return {
		type: "motion-grammar/reorder",
		label: "Move Motion Technique",
		coalesceKey: `motion-grammar-order:${id}`,
		run: (draft) => {
			const fromIndex = draft.bindings.findIndex(
				(binding) => binding.id === id,
			);
			if (fromIndex < 0) return;
			const lastIndex = draft.bindings.length - 1;
			const targetIndex = Number.isFinite(toIndex)
				? Math.min(lastIndex, Math.max(0, Math.round(toIndex)))
				: fromIndex;
			if (targetIndex === fromIndex) return;
			const [binding] = draft.bindings.splice(fromIndex, 1);
			if (!binding) return;
			draft.bindings.splice(targetIndex, 0, binding);
		},
	};
}

/** Remove a binding by id. No-op (no history entry) when the id is absent. */
export function removeGrammarBinding(id: string): MotionGrammarCommand {
	return {
		type: "motion-grammar/remove",
		label: "Remove Motion Technique",
		run: (draft) => {
			const index = draft.bindings.findIndex((b) => b.id === id);
			if (index >= 0) draft.bindings.splice(index, 1);
			const passthroughIndex = draft.passthrough.findIndex(
				(binding) => binding.id === id,
			);
			if (passthroughIndex >= 0) draft.passthrough.splice(passthroughIndex, 1);
			if (draft.diagnostics) {
				draft.diagnostics = draft.diagnostics.filter(
					(diagnostic) => diagnostic.bindingId !== id,
				);
			}
		},
	};
}
