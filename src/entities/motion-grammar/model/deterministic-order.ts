/**
 * Returns a deterministic seeded order for semantic motion roles.
 *
 * This is deliberately a Motion Grammar primitive rather than a generic
 * random helper: a seed selects a stable permutation once, while sampling
 * never consults wall time or `Math.random`. The role key is part of the hash
 * input, so the same `(seed, role key)` pair produces the same rank across
 * Canvas, export, and runtime adapters. Callers still own the durable seed or
 * explicit rank-map contract; this function does not persist or mutate either.
 */
export const deterministicSeededOrder = <T>(
	values: readonly T[],
	keyOf: (value: T) => string,
	seed?: number,
): readonly T[] => {
	const seedText = Number.isFinite(seed) ? String(seed) : "0";
	return values
		.map((value, index) => {
			const key = keyOf(value);
			return {
				value,
				index,
				key,
				hash: hashString(`${seedText}:${key}`),
			};
		})
		.sort(
			(left, right) =>
				left.hash - right.hash ||
				left.key.localeCompare(right.key) ||
				left.index - right.index,
		)
		.map(({ value }) => value);
};

const hashString = (value: string): number => {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};
