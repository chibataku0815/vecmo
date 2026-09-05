import { useEffect, useRef, useState } from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { useLiveTransformStore } from "@/features/transform/model/live-drag-store";
import { useViewportStore } from "@/features/viewport/model/store";
import type {
	GpuCanvasStatus,
	GpuCanvasSurface,
	GpuFrameSpec,
} from "@/shared/gpu/types";
import { isGpuHudEnabled } from "@/shared/lib/gpu-canvas-flag";
import { buildGpuArtboardFrame } from "@/widgets/canvas-shell/model/gpu-scene-frame";
import { registerGpuStressGlobal } from "@/widgets/canvas-shell/model/gpu-stress-scene";
import { samplePresentation } from "@/widgets/canvas-shell/model/presentation";
import {
	createGpuFrameHudStats,
	GpuFrameHud,
	type GpuFrameHudStatsController,
} from "@/widgets/canvas-shell/ui/GpuFrameHud";

/**
 * Experimental GPU canvas surface (E1 S1/S2 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`). Mounted directly in
 * `CanvasShell`, positioned above the SVG scene layer and below overlays
 * (D2), behind the `gpuCanvas` flag. S1 drew per-artboard opaque background
 * quads for every artboard; S2's review pass retired that in favor of the
 * fallback-honesty contract this component now implements: an artboard in
 * `activeArtboardIds` (computed by `CanvasShell` from
 * `computeGpuArtboardSupport` on the COMMITTED documents — see that
 * function's doc comment for the no-flap rule this depends on) gets its
 * background quad AND solid-fill node content painted here; an artboard NOT
 * in `activeArtboardIds` gets ZERO pixels from this surface — no quad, no
 * fills — so the SVG scene layer beneath (background rect + real node
 * content, unsuppressed) shows through the transparent canvas untouched.
 *
 * The heavy WebGPU module (`@/shared/gpu`) is reached ONLY via a dynamic
 * `import()` inside the effect below — this is the lazy-load boundary
 * `check:bundle` cannot verify by static analysis (D3), so keeping this
 * component itself free of any WebGPU import is what makes the boundary real.
 * `@/shared/gpu/types` is a type-only import (erased at build time), so it
 * does not cross that boundary.
 *
 * Per D6 (one clock), this component is a frame READER only: it never runs
 * its own animation loop and never advances `useTransportStore`. It
 * subscribes imperatively (not via React hooks) to the scene, motion, motion-
 * grammar, live-drag-override, viewport, and transport stores so a document
 * edit, motion/grammar edit, live drag, pan/zoom, or playback tick schedules
 * exactly one coalesced redraw via `requestAnimationFrame`, matching the
 * "frame reader, never advancer" contract. `activeArtboardIds` is a prop
 * (React-driven, recomputed by `CanvasShell` on committed-document identity
 * change), but it is read through a REF inside `drawFrame`, not captured by
 * the mount effect's dependency array: `computeGpuArtboardSupport` returns a
 * fresh `Map`/`Set` on every committed edit REGARDLESS of whether the
 * supported/unsupported classification actually changed, so treating it as an
 * effect dependency would tear down and recreate the entire WebGPU device/
 * pipelines/buffers on every ordinary scene edit (fill color, opacity, etc.),
 * not just on an actual GPU/SVG capability flip — this was caught live during
 * manual smoke verification (`WebGPU device lost: destroyed` on every edit).
 * The ref keeps the one-time device/surface setup keyed only on mount, while
 * a document-store subscription (already present for other reasons) picks up
 * the latest ref value on the very next coalesced redraw.
 *
 * S4 adds four dev-only verification affordances, none of which change the
 * frame-reader contract above: `diffEnabled` applies `mix-blend-mode:
 * difference` to the canvas element (see `isGpuDiffEnabled`'s doc comment —
 * `CanvasShell` pairs this with bypassing its own SVG suppression so both
 * renderers draw the same artboard); a single-entry memo around
 * `samplePresentation` (this module) and one around the compiled draw list
 * (`gpu-scene-frame.ts`'s `memoizedArtboardsForBucket`) skip recompiling on a
 * camera-only redraw; when `isGpuHudEnabled()`, `drawFrame` times its own
 * compile/draw phases and records them into a `GpuFrameHudStatsController`
 * the mounted `<GpuFrameHud>` subscribes to for repaint — the HUD never runs
 * its own timer; and a separate mount effect registers
 * `globalThis.__vmaGpuStress` (`gpu-stress-scene.ts`, dev builds only) so a
 * developer can generate a capability-clean stress artboard from the browser
 * console.
 */
export function GpuSceneCanvas({
	activeArtboardIds,
	diffEnabled,
}: {
	readonly activeArtboardIds: ReadonlySet<string>;
	readonly diffEnabled: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [status, setStatus] = useState<GpuCanvasStatus>("init");
	const activeArtboardIdsRef = useRef(activeArtboardIds);
	activeArtboardIdsRef.current = activeArtboardIds;
	// Read once per mount, matching every other GPU-canvas flag's one-shot
	// contract (see `isGpuCanvasEnabled`'s doc comment). Mirrors
	// `activeArtboardIdsRef` above: never reassigned after mount, but still
	// read through a ref (not the `useState` value directly) inside the
	// mount-once `drawFrame` effect below so it is never a "stale closure"
	// lint concern for that effect's empty dependency array.
	const [hudEnabled] = useState(isGpuHudEnabled);
	const hudEnabledRef = useRef(hudEnabled);
	const hudStatsRef = useRef<GpuFrameHudStatsController | null>(null);
	if (hudEnabled && !hudStatsRef.current) {
		hudStatsRef.current = createGpuFrameHudStats();
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		let cancelled = false;
		let surface: GpuCanvasSurface | null = null;
		let rafHandle: number | null = null;
		let resizeObserver: ResizeObserver | null = null;
		const unsubscribers: Array<() => void> = [];

		const scheduleRedraw = (): void => {
			if (document.visibilityState === "hidden") return;
			if (rafHandle !== null) return;
			rafHandle = requestAnimationFrame(() => {
				rafHandle = null;
				drawFrame();
			});
		};

		const drawFrame = (): void => {
			if (!surface || surface.isLost()) return;
			const parent = canvas.parentElement;
			if (!parent) return;
			const cssWidth = parent.clientWidth;
			const cssHeight = parent.clientHeight;
			if (cssWidth <= 0 || cssHeight <= 0) return;
			const dpr = window.devicePixelRatio || 1;
			surface.configure({ cssWidth, cssHeight, dpr });

			const compileStart = hudEnabledRef.current ? performance.now() : 0;

			const viewport = useViewportStore.getState();
			const scene = useSceneStore.getState().document;
			const motion = useMotionStore.getState().document;
			const grammarBindings =
				useMotionGrammarStore.getState().document.bindings;
			const currentFrame = useTransportStore.getState().currentFrame;
			// SAME sampling call CanvasShell makes for the SVG renderer
			// (`sampledPresentationDocument` in `CanvasShell.tsx`) — an
			// imperative call here, not a React `useMemo`, matching this
			// component's "frame reader" (D6) subscription model. S4:
			// memoized (single-entry) by reference identity of its four
			// inputs, so a camera-only redraw (pan/zoom/HUD-driven redraw with
			// no document/frame change) reuses the SAME sampled document
			// instead of re-sampling motion/grammar from scratch.
			const sampledDocument = memoizedSamplePresentation(
				scene,
				motion,
				currentFrame,
				grammarBindings,
			);

			const liveDrag = useLiveTransformStore.getState();
			const overrides = liveDrag.overrides
				? filterDuplicateIntentSources(
						liveDrag.overrides,
						liveDrag.duplicateIntent,
					)
				: null;

			const scale = viewport.zoom / 100;
			const { artboards } = buildGpuArtboardFrame(
				sampledDocument,
				activeArtboardIdsRef.current,
				overrides,
				currentFrame,
				scale,
				dpr,
				() => {
					if (!cancelled) scheduleRedraw();
				},
			);
			const compileMs = hudEnabledRef.current
				? performance.now() - compileStart
				: 0;

			const frame: GpuFrameSpec = {
				camera: {
					scale,
					panX: viewport.panX,
					panY: viewport.panY,
					rotation: viewport.rotation,
				},
				artboards,
			};
			const drawStart = hudEnabledRef.current ? performance.now() : 0;
			surface.renderFrame(frame);
			if (hudEnabledRef.current) {
				const drawMs = performance.now() - drawStart;
				// `fillCount`/`strokeCount` are derived by tag from the ONE ordered
				// `draws` array (post-S4 review fix — see `gpu-scene-frame.ts`'s top
				// doc comment: `GpuArtboardContent` no longer splits fills/strokes
				// into separate arrays), so the HUD still reports both counts
				// separately even though the renderer consumes one interleaved list.
				hudStatsRef.current?.record({
					compileMs,
					drawMs,
					quadCount: artboards.filter((entry) => entry.backgroundQuad).length,
					fillCount: artboards.reduce(
						(sum, entry) =>
							sum + entry.draws.filter((draw) => draw.kind === "fill").length,
						0,
					),
					strokeCount: artboards.reduce(
						(sum, entry) =>
							sum + entry.draws.filter((draw) => draw.kind === "stroke").length,
						0,
					),
				});
			}
		};

		const initializeSurface = (): void => {
			if (cancelled || document.visibilityState === "hidden" || surface) return;
			document.removeEventListener("visibilitychange", initializeSurface);
			void import("@/shared/gpu").then(async ({ createGpuCanvasSurface }) => {
				if (cancelled) return;
				// E1 S5: an image/mesh fill draw skipped this frame because its
				// texture was not yet resident (see `texture-cache.ts`'s sync-hit/
				// async-miss contract) becomes available on the NEXT successful
				// async load — `onTextureReady` schedules exactly one more coalesced
				// redraw to pick it up, matching every other store subscription's
				// "schedule, never draw synchronously here" contract (D6).
				const created = await createGpuCanvasSurface(canvas, () => {
					if (!cancelled) scheduleRedraw();
				});
				if (cancelled) {
					created?.dispose();
					return;
				}
				if (!created) {
					setStatus("unavailable");
					return;
				}
				surface = created;
				setStatus("active");

				resizeObserver = new ResizeObserver(scheduleRedraw);
				const parent = canvas.parentElement;
				if (parent) resizeObserver.observe(parent);

				unsubscribers.push(useSceneStore.subscribe(scheduleRedraw));
				unsubscribers.push(useMotionStore.subscribe(scheduleRedraw));
				unsubscribers.push(useMotionGrammarStore.subscribe(scheduleRedraw));
				unsubscribers.push(useLiveTransformStore.subscribe(scheduleRedraw));
				unsubscribers.push(useViewportStore.subscribe(scheduleRedraw));
				unsubscribers.push(useTransportStore.subscribe(scheduleRedraw));

				const pollLost = window.setInterval(() => {
					if (document.visibilityState === "hidden") return;
					if (surface?.isLost()) {
						setStatus("lost");
						window.clearInterval(pollLost);
					}
				}, LOST_POLL_INTERVAL_MS);
				unsubscribers.push(() => window.clearInterval(pollLost));
				const onVisibilityChange = (): void => {
					if (document.visibilityState === "visible") scheduleRedraw();
				};
				document.addEventListener("visibilitychange", onVisibilityChange);
				unsubscribers.push(() =>
					document.removeEventListener("visibilitychange", onVisibilityChange),
				);

				scheduleRedraw();
			});
		};
		document.addEventListener("visibilitychange", initializeSurface);
		initializeSurface();

		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", initializeSurface);
			if (rafHandle !== null) cancelAnimationFrame(rafHandle);
			resizeObserver?.disconnect();
			for (const unsubscribe of unsubscribers) unsubscribe();
			surface?.dispose();
		};
		// Intentionally mount-once: `activeArtboardIds` is read through
		// `activeArtboardIdsRef` (kept current every render, see above) rather
		// than being a dependency here — see this component's doc comment for
		// why treating it as a dependency would tear down/recreate the WebGPU
		// device on every ordinary scene edit instead of just redrawing.
	}, []);

	// E1 S4 dev-only stress-scene generator (D7 verification tooling):
	// registers `globalThis.__vmaGpuStress` for the lifetime of this mount.
	// A separate effect from the WebGPU device/surface setup above — this one
	// has nothing to do with rendering, only with exposing the console
	// affordance — so it is unaffected by that effect's mount-once dependency
	// reasoning.
	useEffect(() => registerGpuStressGlobal(), []);

	return (
		<>
			<canvas
				ref={canvasRef}
				className="pointer-events-none absolute inset-0 block h-full w-full"
				// E1 S4 diff mode (D7): blending the GPU canvas against the SVG
				// backdrop beneath it (same stacking context, see `CanvasShell`'s
				// mount site) turns identical pixels black and any mismatch glows —
				// dev-only, so this never applies when `diffEnabled` is false.
				style={diffEnabled ? { mixBlendMode: "difference" } : undefined}
				aria-hidden="true"
				tabIndex={-1}
				data-gpu-canvas={status}
				data-gpu-diff={diffEnabled ? "active" : undefined}
			/>
			{hudEnabled && hudStatsRef.current ? (
				<GpuFrameHud stats={hudStatsRef.current} />
			) : null}
		</>
	);
}

/** Polling interval for surfacing a `device.lost` event to `data-gpu-canvas`. */
const LOST_POLL_INTERVAL_MS = 500;

/**
 * Applies the SAME "Alt-drag duplicate source" suppression rule `SceneNode`
 * uses (`CanvasShell.tsx`): while a duplicate-drag ghost is live, the
 * ORIGINAL (source) nodes render at their base position, not the live
 * override — the moving preview is a separate ghost pass this GPU surface
 * does not participate in (S2 non-goal). Returns the map unchanged when no
 * duplicate intent is active, which is the common case.
 */
function filterDuplicateIntentSources(
	overrides: ReadonlyMap<string, VectorNode>,
	duplicateIntent: { readonly sourceIds: readonly string[] } | null,
): ReadonlyMap<string, VectorNode> {
	if (!duplicateIntent || duplicateIntent.sourceIds.length === 0) {
		return overrides;
	}
	const sourceIds = new Set(duplicateIntent.sourceIds);
	const filtered = new Map(overrides);
	for (const nodeId of sourceIds) filtered.delete(nodeId);
	return filtered;
}

/**
 * Single-entry ("last value") memo around `samplePresentation` (E1 S4 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D7 verification tooling). Keyed on
 * REFERENCE identity of `scene`/`motion`/`grammarBindings` plus `frame`
 * (`===` on a `number` is exact equality, matching "playback tick changed").
 * A document edit, undo/redo, motion/grammar edit, or playback frame advance
 * always changes at least one of these four (the scene/motion/motion-grammar
 * stores allocate a fresh document on every committed patch; `transport`
 * advances `currentFrame`), so a camera-only redraw (pan, zoom, or an
 * HUD-driven repaint with nothing else changed) is the only case that can
 * ever hit this cache — never a false hit that would show a stale frame.
 * Exactly one retained entry, replaced on every miss, matching
 * `gpu-scene-frame.ts`'s `memoizedArtboardsForBucket` policy.
 */
let lastSampledPresentation: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings: readonly MotionGrammarBinding[];
	readonly result: SceneDocument;
} | null = null;

function memoizedSamplePresentation(
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	grammarBindings: readonly MotionGrammarBinding[],
): SceneDocument {
	const cached = lastSampledPresentation;
	if (
		cached &&
		cached.scene === scene &&
		cached.motion === motion &&
		cached.frame === frame &&
		cached.grammarBindings === grammarBindings
	) {
		return cached.result;
	}
	const result = samplePresentation(scene, motion, frame, grammarBindings);
	lastSampledPresentation = { scene, motion, frame, grammarBindings, result };
	return result;
}
