import { enablePatches, type Patch, produceWithPatches } from "immer";
import type {
	MotionGrammarCommand,
	MotionGrammarStoreDocument,
} from "./command";

enablePatches();

export type MotionGrammarRunnerIssue = {
	readonly code: "motion-grammar.command.invalid";
	readonly severity: "error";
	readonly message: string;
	readonly commandIndex: number;
	readonly commandType: string;
};

export type MotionGrammarRunnerResult = {
	readonly document: MotionGrammarStoreDocument;
	readonly changed: boolean;
	readonly appliedCommandCount: number;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
	readonly issues: readonly MotionGrammarRunnerIssue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const commandTypeOf = (value: unknown): string =>
	isRecord(value) && typeof value.type === "string" ? value.type : "unknown";

const isGrammarCommand = (value: unknown): value is MotionGrammarCommand =>
	isRecord(value) &&
	typeof value.type === "string" &&
	typeof value.run === "function";

/**
 * Applies motion-grammar commands to the provided document, mirroring
 * `runMotionCommands`: each command receives a separate Immer draft and the
 * resulting patches accumulate as one transaction boundary. Pure — never reads or
 * mutates scene/motion state.
 */
export function runMotionGrammarCommands(
	document: MotionGrammarStoreDocument,
	commands: readonly unknown[],
): MotionGrammarRunnerResult {
	const issues: MotionGrammarRunnerIssue[] = [];
	const runnable: MotionGrammarCommand[] = [];
	for (const [index, command] of commands.entries()) {
		if (isGrammarCommand(command)) {
			runnable.push(command);
			continue;
		}
		issues.push({
			code: "motion-grammar.command.invalid",
			severity: "error",
			message: `Motion-grammar command ${index} is not runnable; the sequence was not applied.`,
			commandIndex: index,
			commandType: commandTypeOf(command),
		});
	}
	if (issues.length > 0) {
		return {
			document,
			changed: false,
			appliedCommandCount: 0,
			patches: [],
			inversePatches: [],
			issues,
		};
	}

	let nextDocument = document;
	const patches: Patch[] = [];
	let inversePatches: Patch[] = [];
	for (const command of runnable) {
		const [commandDocument, commandPatches, commandInversePatches] =
			produceWithPatches(nextDocument, (draft) => {
				command.run(draft);
			});
		nextDocument = commandDocument;
		patches.push(...commandPatches);
		inversePatches = [...commandInversePatches, ...inversePatches];
	}

	return {
		document: nextDocument,
		changed: patches.length > 0,
		appliedCommandCount: runnable.length,
		patches,
		inversePatches,
		issues: [],
	};
}
