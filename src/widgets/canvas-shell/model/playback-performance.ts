import {
	addFrameDiagnosticCount,
	getFrameDiagnosticsSnapshot,
	recordFramePhase,
	resetFrameDiagnostics,
	setFrameDiagnosticsEnabled,
} from "@/shared/performance/frame-diagnostics";

type PlaybackPerformanceGlobal = {
	readonly reset: () => void;
	readonly snapshot: typeof getFrameDiagnosticsSnapshot;
};

/**
 * Installs the dev-only playback performance snapshot. Lower layers write to the
 * generic bounded collector; the canvas widget owns the playback-facing global.
 */
export function installPlaybackPerformanceDiagnostics(): () => void {
	if (!import.meta.env.DEV) return () => {};
	const host = globalThis as typeof globalThis & {
		__vmaPlaybackPerf?: PlaybackPerformanceGlobal;
	};
	const controls: PlaybackPerformanceGlobal = {
		reset: resetFrameDiagnostics,
		snapshot: getFrameDiagnosticsSnapshot,
	};
	setFrameDiagnosticsEnabled(true);
	host.__vmaPlaybackPerf = controls;
	let observer: PerformanceObserver | null = null;
	if (typeof PerformanceObserver !== "undefined") {
		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					addFrameDiagnosticCount("browser.longTaskCount");
					recordFramePhase("browser.longTask", entry.duration);
				}
			});
			observer.observe({ entryTypes: ["longtask"] });
		} catch {
			observer = null;
		}
	}
	return () => {
		observer?.disconnect();
		if (host.__vmaPlaybackPerf === controls) {
			delete host.__vmaPlaybackPerf;
			setFrameDiagnosticsEnabled(false);
		}
	};
}
