import { recordCacheTelemetry } from "./observability";
import type {
	CacheWorkerQueuedRequest,
	CacheWorkerRequest,
	CacheWorkerResponse,
} from "./worker-protocol";
import { cacheWorkerTransferables } from "./worker-protocol";

type PendingRequest = {
	readonly resolve: (response: CacheWorkerResponse) => void;
	readonly reject: (error: Error) => void;
};

export type CacheWorkerQueue = {
	request(
		request: CacheWorkerRequest,
		options?: CacheWorkerRequestOptions,
	): Promise<CacheWorkerResponse>;
	cancel(id: string): void;
	dispose(): void;
};

export type CacheWorkerRequestOptions = {
	readonly priority?: number;
	readonly estimatedBytes?: number;
};

export type CacheWorkerQueueOptions = {
	readonly workerFactory?: () => Worker;
	readonly maxQueuedBytes?: number;
	readonly maxQueuedRequests?: number;
	readonly workerCount?: number;
};

const DEFAULT_MAX_QUEUED_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_QUEUED_REQUESTS = 256;
const DEFAULT_WORKER_COUNT = 2;

export function createDefaultCacheWorker(): Worker {
	return new Worker(new URL("./browser-cache-worker.ts", import.meta.url), {
		type: "module",
		name: "vma-cache-worker",
	});
}

const queuedBytes = (queue: readonly CacheWorkerQueuedRequest[]): number =>
	queue.reduce((sum, entry) => sum + entry.estimatedBytes, 0);

const prioritySort = (
	a: CacheWorkerQueuedRequest,
	b: CacheWorkerQueuedRequest,
): number => b.priority - a.priority;

const safeCreateWorker = (workerFactory: () => Worker): Worker | null => {
	try {
		return workerFactory();
	} catch (error) {
		recordCacheTelemetry({
			kind: "error",
			tier: "worker",
			message: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
};

export function createCacheWorkerQueue(
	options: CacheWorkerQueueOptions = {},
): CacheWorkerQueue {
	const workerFactory = options.workerFactory ?? createDefaultCacheWorker;
	const workerCount = Math.max(
		1,
		Math.floor(options.workerCount ?? DEFAULT_WORKER_COUNT),
	);
	const workers =
		typeof Worker === "undefined"
			? []
			: Array.from({ length: workerCount }, () =>
					safeCreateWorker(workerFactory),
				).filter((worker): worker is Worker => Boolean(worker));
	const pending = new Map<string, PendingRequest>();
	const queue: CacheWorkerQueuedRequest[] = [];
	const maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
	const maxQueuedRequests =
		options.maxQueuedRequests ?? DEFAULT_MAX_QUEUED_REQUESTS;
	let disposed = false;
	const activeByWorker = new Map<Worker, string>();

	const rejectRequest = (id: string, error: Error): void => {
		const request = pending.get(id);
		if (!request) return;
		pending.delete(id);
		request.reject(error);
	};

	const dropLowPriorityOverflow = (): void => {
		queue.sort(prioritySort);
		while (
			queue.length > maxQueuedRequests ||
			queuedBytes(queue) > maxQueuedBytes
		) {
			const dropped = queue.pop();
			if (!dropped) break;
			rejectRequest(
				dropped.request.id,
				new Error("Cache worker queue dropped a low-priority request."),
			);
			recordCacheTelemetry({
				kind: "worker",
				tier: "worker",
				message: "dropped-low-priority",
			});
		}
	};

	const pump = (): void => {
		if (workers.length === 0 || disposed) return;
		for (const worker of workers) {
			if (activeByWorker.has(worker)) continue;
			const next = queue.sort(prioritySort).shift();
			if (!next) return;
			activeByWorker.set(worker, next.request.id);
			recordCacheTelemetry({
				kind: "worker",
				tier: "worker",
				artifactKind:
					next.request.kind === "put-artifact"
						? next.request.manifest.kind
						: undefined,
				bytes: next.estimatedBytes,
				message: next.request.kind,
			});
			worker.postMessage(
				next.request,
				cacheWorkerTransferables(next.request) as Transferable[],
			);
		}
	};

	for (const worker of workers) {
		worker.onmessage = (event: MessageEvent<CacheWorkerResponse>) => {
			activeByWorker.delete(worker);
			const request = pending.get(event.data.id);
			if (request) {
				pending.delete(event.data.id);
				request.resolve(event.data);
			}
			pump();
		};
		worker.onerror = () => {
			worker.terminate();
			const workerIndex = workers.indexOf(worker);
			if (workerIndex >= 0) workers.splice(workerIndex, 1);
			const activeId = activeByWorker.get(worker);
			if (activeId) {
				activeByWorker.delete(worker);
				rejectRequest(activeId, new Error("Cache worker failed."));
			}
			for (const id of [...pending.keys()].filter((id) =>
				queue.some((entry) => entry.request.id === id),
			)) {
				rejectRequest(id, new Error("Cache worker failed."));
			}
			queue.length = 0;
			pump();
		};
	}

	return {
		request(request, requestOptions = {}) {
			if (disposed) {
				return Promise.reject(new Error("Cache worker queue is disposed."));
			}
			if (workers.length === 0) {
				return Promise.reject(new Error("Worker is not available."));
			}
			const promise = new Promise<CacheWorkerResponse>((resolve, reject) => {
				pending.set(request.id, { resolve, reject });
			});
			queue.push({
				request,
				priority: requestOptions.priority ?? 0,
				estimatedBytes: requestOptions.estimatedBytes ?? 0,
			});
			dropLowPriorityOverflow();
			pump();
			return promise;
		},
		cancel(id) {
			const index = queue.findIndex((entry) => entry.request.id === id);
			if (index >= 0) queue.splice(index, 1);
			rejectRequest(id, new Error("Cache worker request cancelled."));
		},
		dispose() {
			disposed = true;
			for (const worker of workers) worker.terminate();
			for (const id of [...pending.keys()]) {
				rejectRequest(id, new Error("Cache worker queue disposed."));
			}
			queue.length = 0;
			activeByWorker.clear();
		},
	};
}
