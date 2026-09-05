import { create } from "zustand";
import {
	createDebouncedPersistenceWriter,
	createLocalStorageTextAdapter,
	readLocalStorageTextSync,
} from "@/shared/lib/persistence";
import { normalizeHex } from "./index";

/**
 * Most-recently-used color history shared across every picker surface (inspector
 * fill/stroke, gradient stops, mesh points). A color used on one surface should
 * appear when editing another, so the store lives in `shared` — the only layer
 * the inspector widget AND the gradient/mesh features can all import without
 * crossing the feature→feature boundary.
 *
 * Entries are lowercase `#rrggbb` only (alpha is never folded into the color
 * string), de-duplicated, capped, and most-recent-first. Recents are pushed on
 * COMMIT, never per live drag frame, so a single drag cannot flood the list.
 */
const RECENTS_STORAGE_KEY = "vecmo.color.recents";
const RECENTS_LIMIT = 10;
const RECENTS_DEBOUNCE_MS = 250;

const recentsAdapter = createLocalStorageTextAdapter({
	key: RECENTS_STORAGE_KEY,
});

const recentsWriter = createDebouncedPersistenceWriter<readonly string[]>({
	delayMs: RECENTS_DEBOUNCE_MS,
	save: (recents) => recentsAdapter.save(JSON.stringify(recents)),
});

/** Parses the persisted payload into a clean, valid, capped recents list. */
const hydrateRecents = (raw: string | null): readonly string[] => {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const recents: string[] = [];
		for (const entry of parsed) {
			if (typeof entry !== "string") continue;
			const hex = normalizeHex(entry);
			if (!hex || seen.has(hex)) continue;
			seen.add(hex);
			recents.push(hex);
			if (recents.length >= RECENTS_LIMIT) break;
		}
		return recents;
	} catch {
		return [];
	}
};

/** Moves `hex` to the front, de-duping and capping. Invalid hex is ignored. */
const pushRecent = (
	recents: readonly string[],
	input: string,
): readonly string[] => {
	const hex = normalizeHex(input);
	if (!hex) return recents;
	const next = [hex, ...recents.filter((entry) => entry !== hex)];
	return next.slice(0, RECENTS_LIMIT);
};

type ColorRecentsState = {
	readonly recents: readonly string[];
	/** Records a committed color. No-op for invalid hex or a live drag tick. */
	readonly addRecent: (hex: string) => void;
};

export const useColorRecents = create<ColorRecentsState>()((set, get) => ({
	recents: hydrateRecents(
		readLocalStorageTextSync({ key: RECENTS_STORAGE_KEY }),
	),
	addRecent: (hex) => {
		const next = pushRecent(get().recents, hex);
		if (next === get().recents) return;
		set({ recents: next });
		recentsWriter.schedule(next);
	},
}));

// Exposed for unit tests of the pure list logic.
export const __test = { hydrateRecents, pushRecent, RECENTS_LIMIT };
