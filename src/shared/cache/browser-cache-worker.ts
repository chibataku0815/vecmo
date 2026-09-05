import type {
	CacheWorkerRequest,
	CacheWorkerResponse,
} from "./worker-protocol";
import { cacheWorkerTransferables } from "./worker-protocol";
import { handleCacheWorkerRequest } from "./worker-runtime";

type WorkerScopeLike = {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<CacheWorkerRequest>) => void,
	): void;
	postMessage(
		message: CacheWorkerResponse,
		transfer: readonly Transferable[],
	): void;
};

const workerScope = globalThis as unknown as WorkerScopeLike;

workerScope.addEventListener("message", (event) => {
	void handleCacheWorkerRequest(event.data).then((response) => {
		workerScope.postMessage(response, cacheWorkerTransferables(response));
	});
});
