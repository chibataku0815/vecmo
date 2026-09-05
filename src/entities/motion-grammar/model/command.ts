import type { Draft } from "immer";
import type { SerializedMotionGrammarBinding } from "@/entities/motion/model/grammar-bridge";
import type { MotionGrammarBinding } from "./types";

/**
 * Live store document for the motion-grammar layer. `bindings` are the rich,
 * authorable bindings; `passthrough` are unknown-technique serialized bindings
 * preserved verbatim so re-serialization is lossless. The store is a side-car to
 * `MotionDocument`, mirroring the scene/motion command bus so a future unified
 * undo stack can fold all three without re-deriving the contract.
 */
export type MotionGrammarStoreDocument = {
	readonly bindings: readonly MotionGrammarBinding[];
	readonly passthrough: readonly SerializedMotionGrammarBinding[];
	/**
	 * Source-free load and command-rejection diagnostics. This is session state
	 * only: persistence serializes `bindings` plus `passthrough`, never
	 * diagnostic text or raw payload.
	 */
	readonly diagnostics?: readonly MotionGrammarStoreDiagnostic[];
};

/** A non-durable explanation of why one serialized binding cannot execute. */
export type MotionGrammarStoreDiagnostic = {
	readonly code: string;
	readonly bindingId: string;
	readonly techniqueId?: string;
	readonly message: string;
};

/**
 * Non-durable rejection facts emitted by command-bus validation. They are kept
 * separate from parser/load diagnostics so a successful later write can clear
 * only the failed command attempt without erasing an unrelated load fact.
 */
export const MOTION_GRAMMAR_COMMAND_VALIDATION_DIAGNOSTIC_CODES = [
	"motion-grammar.binding-invalid",
	"motion-grammar.expression-version-unsupported",
	"motion-grammar.versioned-binding-invalid",
] as const;

type MotionGrammarCommandValidationDiagnosticCode =
	(typeof MOTION_GRAMMAR_COMMAND_VALIDATION_DIAGNOSTIC_CODES)[number];

export type MotionGrammarCommandValidationDiagnostic =
	MotionGrammarStoreDiagnostic & {
		readonly code: MotionGrammarCommandValidationDiagnosticCode;
	};

const isCommandValidationDiagnostic = (
	diagnostic: MotionGrammarStoreDiagnostic,
): diagnostic is MotionGrammarCommandValidationDiagnostic =>
	(
		MOTION_GRAMMAR_COMMAND_VALIDATION_DIAGNOSTIC_CODES as readonly string[]
	).includes(diagnostic.code);

/**
 * Replaces only the transient command-validation diagnostic for one binding.
 * The grammar runner invokes every command's `run` body, including combined
 * commands, so this keeps rejected writes observable without storing any
 * caller/source payload in the document.
 */
export const setMotionGrammarCommandValidationDiagnostic = (
	draft: Draft<MotionGrammarStoreDocument>,
	diagnostic: MotionGrammarCommandValidationDiagnostic,
): void => {
	draft.diagnostics = [
		...(draft.diagnostics ?? []).filter(
			(candidate) =>
				candidate.bindingId !== diagnostic.bindingId ||
				!isCommandValidationDiagnostic(candidate),
		),
		diagnostic,
	];
};

/** Clears a rejected command fact once a compatible binding write succeeds. */
export const clearMotionGrammarCommandValidationDiagnostic = (
	draft: Draft<MotionGrammarStoreDocument>,
	bindingId: string,
): void => {
	if (!draft.diagnostics) return;
	draft.diagnostics = draft.diagnostics.filter(
		(diagnostic) =>
			diagnostic.bindingId !== bindingId ||
			!isCommandValidationDiagnostic(diagnostic),
	);
};

export const EMPTY_GRAMMAR_DOCUMENT: MotionGrammarStoreDocument = {
	bindings: [],
	passthrough: [],
	diagnostics: [],
};

export type MotionGrammarCommandMeta = {
	readonly type: string;
	readonly label?: string;
	readonly coalesceKey?: string;
	/**
	 * Optional cross-store grouping token (see scene `CommandMeta.compoundId`). Lets
	 * a grammar history entry revert atomically with the scene/motion halves of the
	 * same gesture under one global Cmd+Z. Omitted for ordinary grammar edits.
	 */
	readonly compoundId?: string;
};

/**
 * A grammar command is an imperative draft mutation executed exactly once. Undo
 * and redo replay Immer patches rather than the command body, so commands may mint
 * ids freely. Mirrors the scene/motion command contract.
 */
export type MotionGrammarCommand = MotionGrammarCommandMeta & {
	readonly run: (draft: Draft<MotionGrammarStoreDocument>) => void;
};
