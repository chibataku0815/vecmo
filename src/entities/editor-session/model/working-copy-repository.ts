import type {
	TextPersistenceAdapter,
	TextPersistenceClearResult,
	TextPersistenceLoadResult,
	TextPersistenceSaveResult,
} from "@/shared/lib/persistence";
import { createLocalStorageTextAdapter } from "@/shared/lib/persistence";
import { recordEditorDiagnostic } from "./diagnostics";
import {
	clearCurrentWorkingCopyForkSource,
	editorSessionStorageKey,
	readCurrentWorkingCopyForkSource,
	WORKING_COPY_SNAPSHOT_SUFFIX,
	workingCopyStorageKey,
} from "./session";

const DATABASE_NAME = "vector-motion-author";
const DATABASE_VERSION = 1;
const STORE_NAME = "working-copies";
const SNAPSHOT_KIND = "vector-motion-author/working-copy";

export type WorkingCopySnapshotRead =
	| {
			readonly format: "working-copy";
			readonly projectJson: string;
			readonly cloudStateJson: string | null;
	  }
	| { readonly format: "legacy-project"; readonly projectJson: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Serializes authored content and its cloud pointer into one atomic record. */
export const serializeWorkingCopySnapshot = (
	projectJson: string,
	cloudStateJson: string,
): string =>
	JSON.stringify({
		kind: SNAPSHOT_KIND,
		version: 1,
		savedAt: new Date().toISOString(),
		projectJson,
		cloudStateJson,
	});

/** Accepts the current wrapper and pre-migration raw project backups. */
export const readWorkingCopySnapshot = (
	serialized: string,
): WorkingCopySnapshotRead => {
	try {
		const value: unknown = JSON.parse(serialized);
		if (
			isRecord(value) &&
			value.kind === SNAPSHOT_KIND &&
			value.version === 1 &&
			typeof value.projectJson === "string" &&
			(value.cloudStateJson === undefined ||
				typeof value.cloudStateJson === "string")
		) {
			return {
				format: "working-copy",
				projectJson: value.projectJson,
				cloudStateJson:
					typeof value.cloudStateJson === "string"
						? value.cloudStateJson
						: null,
			};
		}
	} catch {
		// Portable-project restoration reports malformed legacy content later.
	}
	return { format: "legacy-project", projectJson: serialized };
};

const openDatabase = (): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		if (!globalThis.indexedDB) {
			reject(new Error("IndexedDB is unavailable."));
			return;
		}
		const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."));
	});

/**
 * Persists a complete working-copy payload in one IndexedDB record. Local
 * storage is a recovery fallback only; both backends remain copy-namespaced.
 */
export const createWorkingCopyTextAdapter = (): TextPersistenceAdapter => {
	const key = editorSessionStorageKey(WORKING_COPY_SNAPSHOT_SUFFIX);
	const fallback = createLocalStorageTextAdapter({ key });
	return {
		load: async (): Promise<TextPersistenceLoadResult> => {
			try {
				const db = await openDatabase();
				const forkSource = readCurrentWorkingCopyForkSource();
				const transaction = db.transaction(
					STORE_NAME,
					forkSource ? "readwrite" : "readonly",
				);
				const done = transactionDone(transaction);
				const store = transaction.objectStore(STORE_NAME);
				let value = await requestResult(store.get(key));
				if (forkSource) {
					// The IndexedDB store holds only the snapshot record; the remaining
					// fork suffixes are localStorage-only and are copied in `session.ts`.
					const sourceKey = workingCopyStorageKey(
						forkSource,
						WORKING_COPY_SNAPSHOT_SUFFIX,
					);
					const sourceValue = await requestResult(store.get(sourceKey));
					if (typeof sourceValue === "string") {
						await requestResult(store.put(sourceValue, key));
						value = sourceValue;
					}
				}
				await done;
				db.close();
				if (typeof value === "string") {
					await fallback.save(value);
					clearCurrentWorkingCopyForkSource();
					recordEditorDiagnostic({ event: "working-copy-restored" });
					return { status: "found", value, issues: [] };
				}
				const fallbackResult = await fallback.load();
				if (fallbackResult.status === "found") {
					clearCurrentWorkingCopyForkSource();
				}
				return fallbackResult;
			} catch {
				recordEditorDiagnostic({ event: "working-copy-fallback" });
				return fallback.load();
			}
		},
		save: async (value: string): Promise<TextPersistenceSaveResult> => {
			// Write the synchronous fallback first so pagehide cannot strand the
			// final debounced snapshot while IndexedDB is still opening.
			const fallbackResult = await fallback.save(value);
			try {
				const db = await openDatabase();
				const transaction = db.transaction(STORE_NAME, "readwrite");
				const done = transactionDone(transaction);
				await requestResult(
					transaction.objectStore(STORE_NAME).put(value, key),
				);
				await done;
				db.close();
				return { status: "saved", issues: [] };
			} catch {
				recordEditorDiagnostic({ event: "working-copy-fallback" });
				return fallbackResult;
			}
		},
		clear: async (): Promise<TextPersistenceClearResult> => {
			try {
				const db = await openDatabase();
				const transaction = db.transaction(STORE_NAME, "readwrite");
				const done = transactionDone(transaction);
				await requestResult(transaction.objectStore(STORE_NAME).delete(key));
				await done;
				db.close();
			} catch {
				// The namespaced fallback is still clearable when IndexedDB is blocked.
			}
			return fallback.clear();
		},
	};
};
