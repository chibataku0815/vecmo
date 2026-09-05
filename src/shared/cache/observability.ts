import type { CacheArtifactKind, CachePersistenceMode } from "./types";

export type CacheTelemetryEventKind =
	| "probe"
	| "hit"
	| "miss"
	| "put"
	| "delete"
	| "sweep"
	| "worker"
	| "error";

export type CacheTelemetryEvent = {
	readonly kind: CacheTelemetryEventKind;
	readonly at: number;
	readonly artifactKind?: CacheArtifactKind;
	readonly cacheKey?: string;
	readonly tier?: CachePersistenceMode | "gpu" | "worker";
	readonly bytes?: number;
	readonly durationMs?: number;
	readonly message?: string;
};

export type CacheTelemetrySnapshot = {
	readonly events: readonly CacheTelemetryEvent[];
	readonly hitsByKind: Readonly<Record<string, number>>;
	readonly missesByKind: Readonly<Record<string, number>>;
	readonly putsByKind: Readonly<Record<string, number>>;
	readonly bytesByKind: Readonly<Record<string, number>>;
	readonly workerEvents: number;
	readonly errors: number;
};

type CacheTelemetryListener = (snapshot: CacheTelemetrySnapshot) => void;

const MAX_EVENTS = 240;
const events: CacheTelemetryEvent[] = [];
const listeners = new Set<CacheTelemetryListener>();

const increment = (
	record: Record<string, number>,
	key: string | undefined,
	value = 1,
): void => {
	const normalized = key ?? "unknown";
	record[normalized] = (record[normalized] ?? 0) + value;
};

const snapshotFromEvents = (): CacheTelemetrySnapshot => {
	const hitsByKind: Record<string, number> = {};
	const missesByKind: Record<string, number> = {};
	const putsByKind: Record<string, number> = {};
	const bytesByKind: Record<string, number> = {};
	let workerEvents = 0;
	let errors = 0;
	for (const event of events) {
		if (event.kind === "hit") increment(hitsByKind, event.artifactKind);
		if (event.kind === "miss") increment(missesByKind, event.artifactKind);
		if (event.kind === "put") increment(putsByKind, event.artifactKind);
		if (event.bytes !== undefined) {
			increment(bytesByKind, event.artifactKind, event.bytes);
		}
		if (event.kind === "worker") workerEvents += 1;
		if (event.kind === "error") errors += 1;
	}
	return {
		events: [...events],
		hitsByKind,
		missesByKind,
		putsByKind,
		bytesByKind,
		workerEvents,
		errors,
	};
};

export function recordCacheTelemetry(
	event: Omit<CacheTelemetryEvent, "at"> & { readonly at?: number },
): void {
	events.push({ ...event, at: event.at ?? Date.now() });
	while (events.length > MAX_EVENTS) events.shift();
	const snapshot = snapshotFromEvents();
	for (const listener of listeners) listener(snapshot);
}

export function cacheTelemetrySnapshot(): CacheTelemetrySnapshot {
	return snapshotFromEvents();
}

export function subscribeCacheTelemetry(
	listener: CacheTelemetryListener,
): () => void {
	listeners.add(listener);
	listener(snapshotFromEvents());
	return () => listeners.delete(listener);
}

export function resetCacheTelemetry(): void {
	events.length = 0;
	const snapshot = snapshotFromEvents();
	for (const listener of listeners) listener(snapshot);
}
