import type {
	CacheCapabilityPolicy,
	CacheCapabilityProbe,
	CacheStorageEstimate,
} from "./types";

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<unknown>;
	persisted?: () => Promise<boolean>;
	persist?: () => Promise<boolean>;
};

type NavigatorWithGpu = Navigator & {
	gpu?: GPU;
};

export type CacheCapabilityProbeOptions = {
	/**
	 * Requesting an adapter/device proves more than feature detection, but it can
	 * allocate GPU resources. Keep it opt-in for editor startup probes.
	 */
	readonly requestGpuDevice?: boolean;
	readonly opfsWorkerProbeTimeoutMs?: number;
};

type WorkerOpfsProbeResult = {
	readonly ok: boolean;
	readonly reason?: string;
};

const defaultStorageEstimate = (): CacheStorageEstimate => ({
	usage: null,
	quota: null,
	available: null,
	persisted: null,
	canRequestPersistence: false,
});

const probeStorageEstimate = async (): Promise<CacheStorageEstimate> => {
	if (typeof navigator === "undefined") return defaultStorageEstimate();
	const storage = navigator.storage as StorageManagerWithDirectory | undefined;
	if (!storage) return defaultStorageEstimate();
	const estimate = storage.estimate ? await storage.estimate() : null;
	const persisted = storage.persisted ? await storage.persisted() : null;
	const usage = estimate?.usage ?? null;
	const quota = estimate?.quota ?? null;
	return {
		usage,
		quota,
		available:
			usage !== null && quota !== null ? Math.max(0, quota - usage) : null,
		persisted,
		canRequestPersistence: typeof storage.persist === "function",
	};
};

const supportsModuleWorker = (): boolean => {
	if (typeof Worker === "undefined" || typeof URL === "undefined") return false;
	const blob = new Blob([""], { type: "text/javascript" });
	const url = URL.createObjectURL(blob);
	try {
		const worker = new Worker(url, { type: "module" });
		worker.terminate();
		return true;
	} catch {
		return false;
	} finally {
		URL.revokeObjectURL(url);
	}
};

const workerOpfsProbeSource = `
self.onmessage = async () => {
	try {
		const root = await self.navigator?.storage?.getDirectory?.();
		if (!root) {
			self.postMessage({ ok: false, reason: "opfs-root-unavailable" });
			return;
		}
		const file = await root.getFileHandle("__vma_cache_probe__", { create: true });
		if (typeof file.createSyncAccessHandle !== "function") {
			self.postMessage({ ok: false, reason: "sync-access-handle-unavailable" });
			return;
		}
		const handle = await file.createSyncAccessHandle();
		handle.close();
		await root.removeEntry("__vma_cache_probe__").catch(() => {});
		self.postMessage({ ok: true });
	} catch (error) {
		self.postMessage({
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		});
	}
};
`;

const probeWorkerOpfsSyncAccess = (
	timeoutMs: number,
): Promise<WorkerOpfsProbeResult> => {
	if (typeof Worker === "undefined" || typeof URL === "undefined") {
		return Promise.resolve({ ok: false, reason: "worker-unavailable" });
	}
	const blob = new Blob([workerOpfsProbeSource], {
		type: "text/javascript",
	});
	const url = URL.createObjectURL(blob);
	return new Promise((resolve) => {
		let worker: Worker;
		try {
			worker = new Worker(url);
		} catch {
			URL.revokeObjectURL(url);
			resolve({ ok: false, reason: "worker-create-failed" });
			return;
		}
		const timeout = globalThis.setTimeout(() => {
			worker.terminate();
			URL.revokeObjectURL(url);
			resolve({ ok: false, reason: "timeout" });
		}, timeoutMs);
		worker.onmessage = (event: MessageEvent<WorkerOpfsProbeResult>) => {
			globalThis.clearTimeout(timeout);
			worker.terminate();
			URL.revokeObjectURL(url);
			resolve(event.data);
		};
		worker.onerror = () => {
			globalThis.clearTimeout(timeout);
			worker.terminate();
			URL.revokeObjectURL(url);
			resolve({ ok: false, reason: "worker-error" });
		};
		worker.postMessage("probe");
	});
};

const gpuLimitsBucket = (device: GPUDevice): string => {
	const limits = device.limits;
	return [
		`tex2d:${limits.maxTextureDimension2D}`,
		`storage:${limits.maxStorageBufferBindingSize}`,
		`uniform:${limits.maxUniformBufferBindingSize}`,
	].join("|");
};

const probeGpu = async (
	requestDevice: boolean,
): Promise<CacheCapabilityProbe["webgpu"]> => {
	if (typeof navigator === "undefined") {
		return {
			available: false,
			adapter: "not-requested",
			device: "not-requested",
		};
	}
	const gpu = (navigator as NavigatorWithGpu).gpu;
	if (!gpu) {
		return {
			available: false,
			adapter: "not-requested",
			device: "not-requested",
		};
	}
	if (!requestDevice) {
		return {
			available: true,
			adapter: "not-requested",
			device: "not-requested",
		};
	}
	const adapter = await gpu.requestAdapter();
	if (!adapter) {
		return { available: true, adapter: "unavailable", device: "not-requested" };
	}
	const device = await adapter.requestDevice();
	const limitsBucket = gpuLimitsBucket(device);
	device.destroy();
	return {
		available: true,
		adapter: "available",
		device: "available",
		limitsBucket,
	};
};

const choosePolicy = (input: {
	readonly indexedDb: boolean;
	readonly opfs: boolean;
	readonly worker: boolean;
	readonly webgpu: boolean;
}): CacheCapabilityPolicy => ({
	persistent: input.opfs
		? "opfs"
		: input.indexedDb
			? "indexeddb-blob"
			: "memory",
	parallel: input.worker ? "worker" : "main-thread-budgeted",
	gpu: input.webgpu ? "webgpu" : "svg-fallback",
});

/** Probes browser storage/parallel/GPU capabilities without mutating product data. */
export async function probeBrowserCacheCapabilities(
	options: CacheCapabilityProbeOptions = {},
): Promise<CacheCapabilityProbe> {
	const checkedAt = Date.now();
	const secureContext =
		typeof window === "undefined" ? false : window.isSecureContext;
	const indexedDb = typeof indexedDB !== "undefined";
	const storageEstimate = await probeStorageEstimate();
	const storage =
		typeof navigator === "undefined"
			? undefined
			: (navigator.storage as StorageManagerWithDirectory | undefined);
	const opfsRootAvailable = typeof storage?.getDirectory === "function";
	const workerAvailable = typeof Worker !== "undefined";
	const moduleWorker = supportsModuleWorker();
	const workerProbe = opfsRootAvailable
		? await probeWorkerOpfsSyncAccess(options.opfsWorkerProbeTimeoutMs ?? 800)
		: { ok: false, reason: "opfs-root-unavailable" };
	const offscreenCanvasAvailable = typeof OffscreenCanvas !== "undefined";
	const webgpu = await probeGpu(options.requestGpuDevice ?? false);
	const policy = choosePolicy({
		indexedDb,
		opfs: opfsRootAvailable,
		worker: workerAvailable,
		webgpu: webgpu.available,
	});
	return {
		checkedAt,
		secureContext,
		indexedDb,
		storageEstimate,
		opfs: {
			available: opfsRootAvailable,
			syncAccessHandleInWorker: workerProbe.ok,
			...(workerProbe.reason ? { failureReason: workerProbe.reason } : {}),
		},
		worker: { available: workerAvailable, moduleWorker },
		offscreenCanvas: {
			available: offscreenCanvasAvailable,
			transferable: offscreenCanvasAvailable && workerAvailable,
		},
		webgpu,
		policy,
	};
}
