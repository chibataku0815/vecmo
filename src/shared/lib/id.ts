import { nanoid } from "nanoid";

/**
 * Creates compact ids with a domain prefix. This keeps scene ids stable enough
 * to inspect while avoiding centralized counters that would break redo replay.
 */
export function createId(prefix: string): string {
	return `${prefix}-${nanoid(10)}`;
}
