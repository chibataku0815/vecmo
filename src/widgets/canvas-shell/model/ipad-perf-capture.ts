import type { ToolId } from "@/features/tool-selection/model/tools";
import { readLocalStorageTextSync } from "@/shared/lib/persistence";

export const IPAD_PERF_CAPTURE_STORAGE_KEY = "vma:ipad-perf";

const IPAD_PERF_CAPTURE_QUERY_PARAM = "ipadPerf";
const IPAD_PERF_CAPTURE_ENABLED_VALUE = "1";
const IPAD_PERF_WINDOW_MS = 30_000;
const IPAD_PERF_NOTIFY_MS = 250;

export type IpadPerfLane =
	| "idle"
	| "camera-touch"
	| "hand-pan"
	| "space-pan"
	| "pencil-hover"
	| "pencil-stroke"
	| "select-transform"
	| "stage-pointer"
	| "external-layout"
	| "wheel"
	| "unknown";

export type IpadPerfRenderPath = "svg" | "gpu" | "gpu-diff";

export type IpadPerfMetadata = {
	readonly activeGpuArtboards: number;
	readonly activeTool: ToolId;
	readonly iPadShellVisible: boolean;
	readonly layerCount: number;
	readonly renderPath: IpadPerfRenderPath;
	readonly topLevelNodeCount: number;
	readonly viewportHeight: number;
	readonly viewportWidth: number;
	readonly zoomPercent: number;
};

export type IpadPerfSnapshot = {
	readonly activeGesture: IpadPerfLane | null;
	readonly avgFrameMs: number;
	readonly elapsedMs: number;
	readonly frames: number;
	readonly framesOver20Ms: number;
	readonly framesOver33Ms: number;
	readonly framesOver50Ms: number;
	readonly hoverWrites: number;
	readonly hoverWritesByLane: Partial<Record<IpadPerfLane, number>>;
	readonly lastFrameMs: number;
	readonly longTaskCount: number;
	readonly longTaskMs: number;
	readonly maxFrameMs: number;
	readonly maxLongTaskMs: number;
	readonly metadata: IpadPerfMetadata | null;
	readonly pointerByLane: Partial<Record<IpadPerfLane, number>>;
	readonly pointerEvents: number;
	readonly startedAt: number;
	readonly viewportWrites: number;
	readonly viewportWritesByLane: Partial<Record<IpadPerfLane, number>>;
	readonly windowMs: number;
};

export type IpadPerfCaptureController = {
	readonly copySummary: () => Promise<string>;
	readonly dispose: () => void;
	readonly getSnapshot: () => IpadPerfSnapshot;
	readonly recordHoverWrite: (lane: IpadPerfLane) => void;
	readonly recordPointer: (lane: IpadPerfLane) => void;
	readonly recordViewportWrite: (lane: IpadPerfLane) => void;
	readonly reset: () => void;
	readonly setActiveGesture: (lane: IpadPerfLane | null) => void;
	readonly setMetadata: (metadata: IpadPerfMetadata) => void;
	readonly subscribe: (
		listener: (snapshot: IpadPerfSnapshot) => void,
	) => () => void;
};

type IpadPerfFrameSample = {
	readonly activeGesture: IpadPerfLane | null;
	readonly at: number;
	readonly frameMs: number;
	readonly hoverWrites: number;
	readonly hoverWritesByLane: Partial<Record<IpadPerfLane, number>>;
	readonly pointerByLane: Partial<Record<IpadPerfLane, number>>;
	readonly pointerEvents: number;
	readonly viewportWrites: number;
	readonly viewportWritesByLane: Partial<Record<IpadPerfLane, number>>;
};

type IpadPerfLongTaskSample = {
	readonly at: number;
	readonly durationMs: number;
};

type IpadPerfGlobal = {
	readonly copy: () => Promise<string>;
	readonly reset: () => void;
	readonly summary: () => IpadPerfSnapshot;
};

/**
 * Enables the real-device iPad performance capture. The flag is intentionally
 * opt-in and one-shot so production users never see or pay for this debug
 * instrumentation unless a reviewer opens the app with `?ipadPerf=1` or stores
 * `vma:ipad-perf=1` locally.
 */
export function isIpadPerfCaptureEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	if (
		params.get(IPAD_PERF_CAPTURE_QUERY_PARAM) ===
		IPAD_PERF_CAPTURE_ENABLED_VALUE
	) {
		return true;
	}
	return (
		readLocalStorageTextSync({ key: IPAD_PERF_CAPTURE_STORAGE_KEY }) ===
		IPAD_PERF_CAPTURE_ENABLED_VALUE
	);
}

const addCount = (
	counts: Map<IpadPerfLane, number>,
	lane: IpadPerfLane,
): void => {
	counts.set(lane, (counts.get(lane) ?? 0) + 1);
};

const countsToRecord = (
	counts: ReadonlyMap<IpadPerfLane, number>,
): Partial<Record<IpadPerfLane, number>> =>
	Object.fromEntries(counts) as Partial<Record<IpadPerfLane, number>>;

const totalFromRecord = (
	record: Partial<Record<IpadPerfLane, number>>,
): number =>
	Object.values(record).reduce((sum, value) => sum + (value ?? 0), 0);

const addRecord = (
	target: Map<IpadPerfLane, number>,
	record: Partial<Record<IpadPerfLane, number>>,
): void => {
	for (const [lane, count] of Object.entries(record) as Array<
		[IpadPerfLane, number]
	>) {
		target.set(lane, (target.get(lane) ?? 0) + count);
	}
};

const frameThresholdCount = (
	samples: readonly IpadPerfFrameSample[],
	thresholdMs: number,
): number => samples.filter((sample) => sample.frameMs > thresholdMs).length;

/**
 * Creates the in-memory iPad performance capture used by the post-deploy jank
 * loop. It records only timing/count metadata in a rolling window, never scene
 * contents or project identifiers.
 */
export function createIpadPerfCaptureController(): IpadPerfCaptureController {
	let startedAt = performance.now();
	let lastFrameAt: number | null = null;
	let lastNotifyAt = 0;
	let rafHandle: number | null = null;
	let activeGesture: IpadPerfLane | null = null;
	let metadata: IpadPerfMetadata | null = null;
	const listeners = new Set<(snapshot: IpadPerfSnapshot) => void>();
	const samples: IpadPerfFrameSample[] = [];
	const longTasks: IpadPerfLongTaskSample[] = [];
	const pointerCounts = new Map<IpadPerfLane, number>();
	const viewportWriteCounts = new Map<IpadPerfLane, number>();
	const hoverWriteCounts = new Map<IpadPerfLane, number>();

	const prune = (now: number): void => {
		while (samples.length > 0) {
			const first = samples[0];
			if (!first || now - first.at <= IPAD_PERF_WINDOW_MS) break;
			samples.shift();
		}
		while (longTasks.length > 0) {
			const first = longTasks[0];
			if (!first || now - first.at <= IPAD_PERF_WINDOW_MS) break;
			longTasks.shift();
		}
	};

	const snapshot = (): IpadPerfSnapshot => {
		const now = performance.now();
		prune(now);
		const timedSamples = samples.filter((sample) => sample.frameMs > 0);
		const pointerByLane = new Map<IpadPerfLane, number>();
		const viewportWritesByLane = new Map<IpadPerfLane, number>();
		const hoverWritesByLane = new Map<IpadPerfLane, number>();
		for (const sample of samples) {
			addRecord(pointerByLane, sample.pointerByLane);
			addRecord(viewportWritesByLane, sample.viewportWritesByLane);
			addRecord(hoverWritesByLane, sample.hoverWritesByLane);
		}
		const totalFrameMs = timedSamples.reduce(
			(sum, sample) => sum + sample.frameMs,
			0,
		);
		const longTaskMs = longTasks.reduce(
			(sum, sample) => sum + sample.durationMs,
			0,
		);
		return {
			activeGesture,
			avgFrameMs:
				timedSamples.length === 0 ? 0 : totalFrameMs / timedSamples.length,
			elapsedMs: now - startedAt,
			frames: timedSamples.length,
			framesOver20Ms: frameThresholdCount(timedSamples, 20),
			framesOver33Ms: frameThresholdCount(timedSamples, 33),
			framesOver50Ms: frameThresholdCount(timedSamples, 50),
			hoverWrites: totalFromRecord(countsToRecord(hoverWritesByLane)),
			hoverWritesByLane: countsToRecord(hoverWritesByLane),
			lastFrameMs: timedSamples.at(-1)?.frameMs ?? 0,
			longTaskCount: longTasks.length,
			longTaskMs,
			maxFrameMs: Math.max(0, ...timedSamples.map((sample) => sample.frameMs)),
			maxLongTaskMs: Math.max(
				0,
				...longTasks.map((sample) => sample.durationMs),
			),
			metadata,
			pointerByLane: countsToRecord(pointerByLane),
			pointerEvents: totalFromRecord(countsToRecord(pointerByLane)),
			startedAt,
			viewportWrites: totalFromRecord(countsToRecord(viewportWritesByLane)),
			viewportWritesByLane: countsToRecord(viewportWritesByLane),
			windowMs: IPAD_PERF_WINDOW_MS,
		};
	};

	const notify = (): void => {
		const next = snapshot();
		for (const listener of listeners) listener(next);
	};

	const frame = (now: number): void => {
		const frameMs = lastFrameAt === null ? 0 : now - lastFrameAt;
		lastFrameAt = now;
		samples.push({
			activeGesture,
			at: now,
			frameMs,
			hoverWrites: totalFromRecord(countsToRecord(hoverWriteCounts)),
			hoverWritesByLane: countsToRecord(hoverWriteCounts),
			pointerByLane: countsToRecord(pointerCounts),
			pointerEvents: totalFromRecord(countsToRecord(pointerCounts)),
			viewportWrites: totalFromRecord(countsToRecord(viewportWriteCounts)),
			viewportWritesByLane: countsToRecord(viewportWriteCounts),
		});
		pointerCounts.clear();
		viewportWriteCounts.clear();
		hoverWriteCounts.clear();
		prune(now);
		if (now - lastNotifyAt >= IPAD_PERF_NOTIFY_MS) {
			lastNotifyAt = now;
			notify();
		}
		rafHandle = window.requestAnimationFrame(frame);
	};

	let longTaskObserver: PerformanceObserver | null = null;
	if (typeof PerformanceObserver !== "undefined") {
		try {
			longTaskObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks.push({
						at: entry.startTime + entry.duration,
						durationMs: entry.duration,
					});
				}
				prune(performance.now());
			});
			longTaskObserver.observe({ entryTypes: ["longtask"] });
		} catch {
			longTaskObserver = null;
		}
	}

	rafHandle = window.requestAnimationFrame(frame);

	const controller: IpadPerfCaptureController = {
		copySummary: async () => {
			const text = JSON.stringify(snapshot(), null, 2);
			if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			}
			return text;
		},
		dispose: () => {
			if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
			rafHandle = null;
			longTaskObserver?.disconnect();
			listeners.clear();
			const host = globalThis as typeof globalThis & {
				__vmaIpadPerf?: IpadPerfGlobal;
			};
			if (host.__vmaIpadPerf?.summary === snapshot) {
				delete host.__vmaIpadPerf;
			}
		},
		getSnapshot: snapshot,
		recordHoverWrite: (lane) => addCount(hoverWriteCounts, lane),
		recordPointer: (lane) => addCount(pointerCounts, lane),
		recordViewportWrite: (lane) => addCount(viewportWriteCounts, lane),
		reset: () => {
			startedAt = performance.now();
			lastFrameAt = null;
			lastNotifyAt = 0;
			activeGesture = null;
			samples.length = 0;
			longTasks.length = 0;
			pointerCounts.clear();
			viewportWriteCounts.clear();
			hoverWriteCounts.clear();
			notify();
		},
		setActiveGesture: (lane) => {
			activeGesture = lane;
		},
		setMetadata: (next) => {
			metadata = next;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			listener(snapshot());
			return () => listeners.delete(listener);
		},
	};

	const host = globalThis as typeof globalThis & {
		__vmaIpadPerf?: IpadPerfGlobal;
	};
	host.__vmaIpadPerf = {
		copy: controller.copySummary,
		reset: controller.reset,
		summary: controller.getSnapshot,
	};

	return controller;
}
