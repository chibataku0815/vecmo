/**
 * Dev-only GPU frame-cost HUD (E1 S4 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D7 verification tooling). Renders
 * a plain, fixed-position, monospace readout of `GpuSceneCanvas`'s last
 * frame's timings and draw counts, behind the `?gpuHud=1`/
 * `vma:gpu-canvas-hud` flag (`isGpuHudEnabled`). This is a dev instrument, not
 * product chrome — deliberately unstyled beyond "readable" (no design-token
 * intent; `widgets/canvas-shell/ui/` is the canvas-palette-exempt directory
 * per `docs/design-system.md`).
 *
 * `GpuSceneCanvas` annotates its OWN existing imperative draws with
 * `performance.now()` deltas and calls {@link GpuFrameHudStats.record} once
 * per rendered frame — this component never runs its own timer or rAF loop
 * (D6 "frame reader" discipline extends to dev tooling: the HUD must not
 * become a second clock).
 */
import { useEffect, useState } from "react";

/** One frame's raw timing/count sample, as measured by `GpuSceneCanvas`. */
export type GpuFrameHudSample = {
	/** CPU ms spent in `samplePresentation` + `buildGpuArtboardFrame` — zero on a memoized (cache-hit) frame, see `gpu-scene-frame.ts`'s S4 memo. */
	readonly compileMs: number;
	/** CPU ms spent in `surface.renderFrame`, measured every frame regardless of memoization. */
	readonly drawMs: number;
	readonly quadCount: number;
	readonly fillCount: number;
	readonly strokeCount: number;
};

/** Rolling-average window size (in frames) for the HUD's smoothed readout. */
const HUD_ROLLING_WINDOW = 30;

/**
 * Fixed-size rolling-average accumulator for HUD samples, owned imperatively
 * by `GpuSceneCanvas` (constructed once per mount) so recording a sample never
 * itself triggers a React render — `subscribe`/`getSnapshot` bridge it into
 * this component via `useSyncExternalStore`-shaped hand-rolled wiring (a
 * plain `useState` setter subscription; the HUD updates at most once per
 * rendered GPU frame, never per pointer/animation tick, so a full
 * `useSyncExternalStore` is unnecessary ceremony here).
 */
export function createGpuFrameHudStats(): GpuFrameHudStatsController {
	const samples: GpuFrameHudSample[] = [];
	const listeners = new Set<(latest: GpuFrameHudSnapshot) => void>();

	const snapshot = (): GpuFrameHudSnapshot => {
		const count = samples.length;
		if (count === 0) {
			return {
				compileMsAvg: 0,
				drawMsAvg: 0,
				last: null,
			};
		}
		const sum = samples.reduce(
			(acc, sample) => ({
				compileMs: acc.compileMs + sample.compileMs,
				drawMs: acc.drawMs + sample.drawMs,
			}),
			{ compileMs: 0, drawMs: 0 },
		);
		return {
			compileMsAvg: sum.compileMs / count,
			drawMsAvg: sum.drawMs / count,
			last: samples[count - 1],
		};
	};

	return {
		record: (sample) => {
			samples.push(sample);
			if (samples.length > HUD_ROLLING_WINDOW) samples.shift();
			const next = snapshot();
			for (const listener of listeners) listener(next);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: snapshot,
	};
}

export type GpuFrameHudSnapshot = {
	readonly compileMsAvg: number;
	readonly drawMsAvg: number;
	readonly last: GpuFrameHudSample | null;
};

export type GpuFrameHudStatsController = {
	readonly record: (sample: GpuFrameHudSample) => void;
	readonly subscribe: (
		listener: (snapshot: GpuFrameHudSnapshot) => void,
	) => () => void;
	readonly getSnapshot: () => GpuFrameHudSnapshot;
};

const formatMs = (value: number): string => value.toFixed(2);

/**
 * The HUD's rendered readout. `stats` is the SAME controller instance
 * `GpuSceneCanvas` records into from its imperative `drawFrame` — this
 * component only subscribes for repaint, it never records a sample itself.
 */
export function GpuFrameHud({
	stats,
}: {
	readonly stats: GpuFrameHudStatsController;
}) {
	const [snapshot, setSnapshot] = useState(stats.getSnapshot);

	useEffect(() => stats.subscribe(setSnapshot), [stats]);

	const { last } = snapshot;
	return (
		<div
			aria-hidden="true"
			style={{
				position: "absolute",
				bottom: 8,
				left: 8,
				zIndex: 40,
				pointerEvents: "none",
				fontFamily: "monospace",
				fontSize: 11,
				lineHeight: 1.5,
				color: "#e8f5e9",
				background: "rgba(0, 0, 0, 0.6)",
				padding: "6px 8px",
				borderRadius: 3,
				whiteSpace: "pre",
			}}
			data-gpu-hud="active"
		>
			{`gpu compile ${formatMs(snapshot.compileMsAvg)}ms avg (last ${formatMs(last?.compileMs ?? 0)}ms)\n`}
			{`gpu draw    ${formatMs(snapshot.drawMsAvg)}ms avg (last ${formatMs(last?.drawMs ?? 0)}ms)\n`}
			{`quads ${last?.quadCount ?? 0}  fills ${last?.fillCount ?? 0}  strokes ${last?.strokeCount ?? 0}`}
		</div>
	);
}
