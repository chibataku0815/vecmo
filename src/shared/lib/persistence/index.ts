export type StorageLike = {
	readonly getItem: (key: string) => string | null;
	readonly setItem: (key: string, value: string) => void;
	readonly removeItem: (key: string) => void;
};

export type TextPersistenceIssueCode =
	| "missing"
	| "storage-unavailable"
	| "read-failed"
	| "write-failed"
	| "clear-failed";

export type TextPersistenceIssue = {
	readonly code: TextPersistenceIssueCode;
	readonly message: string;
	readonly cause?: unknown;
};

export type TextPersistenceLoadResult =
	| {
			readonly status: "found";
			readonly value: string;
			readonly issues: readonly TextPersistenceIssue[];
	  }
	| {
			readonly status: "missing" | "unavailable" | "failed";
			readonly issues: readonly TextPersistenceIssue[];
	  };

export type TextPersistenceSaveResult = {
	readonly status: "saved" | "unavailable" | "failed";
	readonly issues: readonly TextPersistenceIssue[];
};

export type TextPersistenceClearResult = {
	readonly status: "cleared" | "unavailable" | "failed";
	readonly issues: readonly TextPersistenceIssue[];
};

/**
 * Swappable adapter for durable text payloads. Scene-specific serialization
 * stays outside this boundary so a future IndexedDB or cloud adapter can share
 * the same load/save contract.
 */
export type TextPersistenceAdapter = {
	readonly load: () => Promise<TextPersistenceLoadResult>;
	readonly save: (value: string) => Promise<TextPersistenceSaveResult>;
	readonly clear: () => Promise<TextPersistenceClearResult>;
};

export type LocalStorageTextAdapterOptions = {
	readonly key: string;
	readonly storage?: StorageLike | null;
};

export type DebouncedPersistenceWriter<T> = {
	readonly schedule: (value: T) => void;
	readonly flush: () => Promise<TextPersistenceSaveResult | null>;
	readonly cancel: () => void;
	readonly pending: () => boolean;
};

export type DebouncedPersistenceWriterOptions<T> = {
	readonly delayMs: number;
	readonly save: (value: T) => Promise<TextPersistenceSaveResult>;
	readonly onError?: (error: unknown) => void;
};

const issue = (
	code: TextPersistenceIssueCode,
	message: string,
	cause?: unknown,
): TextPersistenceIssue =>
	cause === undefined ? { code, message } : { code, message, cause };

const isStorageLike = (value: unknown): value is StorageLike => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<StorageLike>;
	return (
		typeof candidate.getItem === "function" &&
		typeof candidate.setItem === "function" &&
		typeof candidate.removeItem === "function"
	);
};

const getDefaultLocalStorage = (): StorageLike | null => {
	const candidate = Reflect.get(globalThis, "localStorage") as unknown;
	return isStorageLike(candidate) ? candidate : null;
};

/**
 * Synchronous one-shot read of a persisted text payload. Unlike the async
 * adapter's `load()`, this returns immediately, so a store can seed its initial
 * value at creation time without a post-mount setState — which would otherwise
 * flash the default before the persisted value arrives. Safe in this pure SPA
 * (createRoot, no SSR). Returns `null` when storage is unavailable, the key is
 * missing, or the read throws.
 */
export function readLocalStorageTextSync({
	key,
	storage = getDefaultLocalStorage(),
}: LocalStorageTextAdapterOptions): string | null {
	if (!storage) return null;
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

/**
 * Creates the first local persistence backend for the editor. The adapter only
 * stores opaque text by key; corrupt document handling belongs to the caller's
 * typed serializer/deserializer.
 */
export function createLocalStorageTextAdapter({
	key,
	storage = getDefaultLocalStorage(),
}: LocalStorageTextAdapterOptions): TextPersistenceAdapter {
	const unavailable = (
		operation: "load" | "save" | "clear",
	): TextPersistenceIssue =>
		issue(
			"storage-unavailable",
			`Local storage is unavailable for ${operation}.`,
		);

	return {
		load: async () => {
			if (!storage) {
				return { status: "unavailable", issues: [unavailable("load")] };
			}
			try {
				const value = storage.getItem(key);
				if (value === null) {
					return {
						status: "missing",
						issues: [
							issue("missing", `No persisted payload exists for ${key}.`),
						],
					};
				}
				return { status: "found", value, issues: [] };
			} catch (error) {
				return {
					status: "failed",
					issues: [
						issue("read-failed", "Failed to read local persistence.", error),
					],
				};
			}
		},
		save: async (value) => {
			if (!storage) {
				return { status: "unavailable", issues: [unavailable("save")] };
			}
			try {
				storage.setItem(key, value);
				return { status: "saved", issues: [] };
			} catch (error) {
				return {
					status: "failed",
					issues: [
						issue("write-failed", "Failed to write local persistence.", error),
					],
				};
			}
		},
		clear: async () => {
			if (!storage) {
				return { status: "unavailable", issues: [unavailable("clear")] };
			}
			try {
				storage.removeItem(key);
				return { status: "cleared", issues: [] };
			} catch (error) {
				return {
					status: "failed",
					issues: [
						issue("clear-failed", "Failed to clear local persistence.", error),
					],
				};
			}
		},
	};
}

/**
 * Schedules save calls behind a debounce boundary. Document mutation code can
 * emit plain serialized payloads while persistence decides when the latest
 * value is actually written.
 */
export function createDebouncedPersistenceWriter<T>({
	delayMs,
	save,
	onError,
}: DebouncedPersistenceWriterOptions<T>): DebouncedPersistenceWriter<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let hasLatest = false;
	let latestValue: T | undefined;

	const cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	const flush = async (): Promise<TextPersistenceSaveResult | null> => {
		cancel();
		if (!hasLatest) return null;
		const value = latestValue as T;
		hasLatest = false;
		latestValue = undefined;
		return save(value);
	};

	const schedule = (value: T) => {
		latestValue = value;
		hasLatest = true;
		cancel();
		timer = setTimeout(() => {
			void flush().catch((error: unknown) => onError?.(error));
		}, delayMs);
	};

	return {
		schedule,
		flush,
		cancel,
		pending: () => hasLatest,
	};
}
