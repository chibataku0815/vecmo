/**
 * Process-global monotonic history sequence.
 *
 * Independent command stores (scene, motion-grammar) stamp each NEW undo entry
 * with {@link nextHistorySeq} so a cross-store undo coordinator can dispatch a
 * single global Cmd+Z to the most-recently-edited store — correct LIFO across
 * stacks that otherwise have no shared ordering. Only new operations advance the
 * counter; undo/redo move existing entries between stacks and keep their seq.
 */
let counter = 0;

export function nextHistorySeq(): number {
	counter += 1;
	return counter;
}
