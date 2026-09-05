const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Recursively rebuilds a value with object keys sorted and `undefined` fields
 * dropped, so two structurally-equal documents always serialize to identical
 * bytes regardless of incidental construction order.
 */
const canonicalize = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;

	const output: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		const next = value[key];
		if (next !== undefined) output[key] = canonicalize(next);
	}
	return output;
};

/**
 * Serializes a value to deterministic, key-sorted JSON with a trailing newline.
 * Durable-storage and portable-backup formats need byte-stable output so saved
 * files, tests, and round-trips do not churn on object-construction order.
 */
export function stableJsonStringify(value: unknown): string {
	const serialized = JSON.stringify(canonicalize(value), null, 2);
	return `${serialized ?? "null"}\n`;
}
