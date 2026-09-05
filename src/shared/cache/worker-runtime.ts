import { createBrowserCacheStore } from "./browser-store";
import { probeBrowserCacheCapabilities } from "./capabilities";
import type {
	CacheWorkerRequest,
	CacheWorkerResponse,
} from "./worker-protocol";

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

let storePromise: ReturnType<typeof createBrowserCacheStore> | null = null;

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const browserCacheStore = () => {
	storePromise ??= createBrowserCacheStore();
	return storePromise;
};

export async function handleCacheWorkerRequest(
	request: CacheWorkerRequest,
): Promise<CacheWorkerResponse> {
	try {
		if (request.kind === "probe") {
			return {
				id: request.id,
				ok: true,
				result: await probeBrowserCacheCapabilities(),
			};
		}
		const { store } = await browserCacheStore();
		if (request.kind === "get-artifact") {
			const artifact = await store.getArtifact(request.key);
			return {
				id: request.id,
				ok: true,
				result: artifact
					? {
							manifest: artifact.manifest,
							bytes: exactArrayBuffer(artifact.bytes),
						}
					: null,
			};
		}
		if (request.kind === "put-artifact") {
			return {
				id: request.id,
				ok: true,
				result: await store.putArtifact(
					request.manifest,
					new Uint8Array(request.bytes),
				),
			};
		}
		if (request.kind === "delete-artifact") {
			await store.deleteArtifact(request.key);
			return { id: request.id, ok: true, result: null };
		}
		if (request.kind === "clear") {
			return {
				id: request.id,
				ok: true,
				result: await store.clearDerivedArtifacts(request.artifactKind),
			};
		}
		if (request.kind === "sweep") {
			return {
				id: request.id,
				ok: true,
				result: await store.sweep(request.options),
			};
		}
		return {
			id: request.id,
			ok: true,
			result: await store.estimate(),
		};
	} catch (error) {
		return { id: request.id, ok: false, error: errorMessage(error) };
	}
}
