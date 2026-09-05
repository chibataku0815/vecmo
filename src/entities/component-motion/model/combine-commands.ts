import type { MotionCommand } from "@/entities/motion/model/command";
import type { MotionGrammarCommand } from "@/entities/motion-grammar/model/command";

/**
 * Folds N motion commands into one, running each `run(draft)` in order against
 * the SAME draft. This is what lets an explicit propagation request (one agent
 * command wrapping N per-instance {@link copyMotionTracksForInstance} resyncs,
 * or the one-per-instance-move variants `planMotionPropagation` returns) land
 * as a single command-bus entry, matching every other agent motion command's
 * "1 agent command -> 1 compiled `MotionCommand`" invariant instead of forcing
 * a batch-shaped exception into the compile switch. `label`/`coalesceKey`
 * default to the first command's, since propagation commands share a coalesce
 * key by construction (see `planMotionPropagation`'s `masterCoalesceKey`).
 */
export function combineMotionCommands(
	commands: readonly MotionCommand[],
	meta: { readonly type: string; readonly label?: string } = {
		type: "motion/propagate-to-instances",
	},
): MotionCommand {
	return {
		type: meta.type,
		...(meta.label ? { label: meta.label } : {}),
		run: (draft) => {
			for (const command of commands) command.run(draft);
		},
	};
}

/** Grammar twin of {@link combineMotionCommands}. */
export function combineMotionGrammarCommands(
	commands: readonly MotionGrammarCommand[],
	meta: { readonly type: string; readonly label?: string } = {
		type: "motion-grammar/propagate-to-instances",
	},
): MotionGrammarCommand {
	return {
		type: meta.type,
		...(meta.label ? { label: meta.label } : {}),
		run: (draft) => {
			for (const command of commands) command.run(draft);
		},
	};
}
