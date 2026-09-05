/**
 * Order-independent structural equality for plain JSON-shaped values (POJOs,
 * arrays, and primitives). Used where a fresh-but-identical clone would otherwise
 * be written back — e.g. component-instance motion/grammar resyncs — so the write
 * can be skipped and an immer change (and redundant history) is not recorded.
 *
 * Scope: it assumes serializable document data — no functions, class instances,
 * Maps/Sets, or cyclic references. Arrays compare by index (length + per-element);
 * objects compare by key set + per-key value, regardless of key order.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	) {
		return false;
	}
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every(
		(key) =>
			Object.hasOwn(b, key) &&
			deepEqual(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			),
	);
}
