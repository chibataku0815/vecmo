import {
	type BrowserCacheStore,
	type CacheWorkerQueue,
	createBrowserCacheStore,
	createCacheWorkerQueue,
} from "@/shared/cache";

let browserStorePromise: Promise<BrowserCacheStore> | null = null;
let workerQueue: CacheWorkerQueue | null = null;
let requestCounter = 0;

export const canvasBrowserCacheStore = (): Promise<BrowserCacheStore> => {
	browserStorePromise ??= createBrowserCacheStore();
	return browserStorePromise;
};

export const canvasCacheWorkerQueue = (): CacheWorkerQueue | null => {
	if (typeof Worker === "undefined") return null;
	workerQueue ??= createCacheWorkerQueue();
	return workerQueue;
};

export const nextCanvasCacheRequestId = (scope: string): string => {
	requestCounter += 1;
	return `canvas-cache:${scope}:${requestCounter}`;
};

export const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

export const disposeCanvasCacheRuntime = (): void => {
	workerQueue?.dispose();
	workerQueue = null;
};
