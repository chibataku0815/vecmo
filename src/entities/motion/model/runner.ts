import { enablePatches, type Patch, produceWithPatches } from "immer";
import type { MotionCommand } from "./command";
import type { MotionDocument } from "./types";

enablePatches();

export type MotionCommandRunnerIssue = {
	readonly code: "motion.command.invalid";
	readonly severity: "error";
	readonly message: string;
	readonly commandIndex: number;
	readonly commandType: string;
};

export type MotionCommandRunnerTransaction = {
	readonly coalesceKey: string;
	readonly label?: string;
};

export type MotionCommandRunnerOptions = {
	readonly transaction?: MotionCommandRunnerTransaction;
};

export type MotionCommandRunnerResult = {
	readonly document: MotionDocument;
	readonly changed: boolean;
	readonly appliedCommandCount: number;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
	readonly issues: readonly MotionCommandRunnerIssue[];
	readonly transaction: MotionCommandRunnerTransaction | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const commandTypeOf = (value: unknown): string => {
	if (!isRecord(value)) return "unknown";
	return typeof value.type === "string" ? value.type : "unknown";
};

const isMotionCommand = (value: unknown): value is MotionCommand => {
	if (!isRecord(value)) return false;
	return typeof value.type === "string" && typeof value.run === "function";
};

const invalidCommandIssue = (
	command: unknown,
	index: number,
): MotionCommandRunnerIssue => ({
	code: "motion.command.invalid",
	severity: "error",
	message: `Motion command ${index} is not a runnable motion command; the command sequence was not applied.`,
	commandIndex: index,
	commandType: commandTypeOf(command),
});

const validateCommands = (
	commands: readonly unknown[],
): {
	readonly commands: readonly MotionCommand[];
	readonly issues: readonly MotionCommandRunnerIssue[];
} => {
	const runnable: MotionCommand[] = [];
	const issues: MotionCommandRunnerIssue[] = [];
	for (const [index, command] of commands.entries()) {
		if (isMotionCommand(command)) {
			runnable.push(command);
			continue;
		}
		issues.push(invalidCommandIssue(command, index));
	}
	return { commands: runnable, issues };
};

/**
 * Applies MotionDocument side-car commands to the provided document without
 * reading or mutating scene state. Each command receives a separate Immer draft
 * just like `useMotionStore.apply`; this preserves command bodies that inspect
 * existing draft objects with `current()` after a prior command created them.
 * The returned patches are still accumulated as one transaction boundary.
 */
export function runMotionCommands(
	document: MotionDocument,
	commands: readonly unknown[],
	options: MotionCommandRunnerOptions = {},
): MotionCommandRunnerResult {
	const validation = validateCommands(commands);
	if (validation.issues.length > 0) {
		return {
			document,
			changed: false,
			appliedCommandCount: 0,
			patches: [],
			inversePatches: [],
			issues: validation.issues,
			transaction: options.transaction ?? null,
		};
	}

	let nextDocument = document;
	const patches: Patch[] = [];
	let inversePatches: Patch[] = [];
	for (const command of validation.commands) {
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
		appliedCommandCount: validation.commands.length,
		patches,
		inversePatches,
		issues: [],
		transaction: options.transaction ?? null,
	};
}
