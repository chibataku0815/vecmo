import { useCallback, useEffect, useRef, useState } from "react";
import {
	buildRasterPasses,
	buildRasterTree,
	buildScopedDeepGlowPlan,
} from "@/entities/scene/model/gpu-raster-adapter";
import type { SceneDocument } from "@/entities/scene/model/types";
import type {
	StaticRasterCompositionFrame,
	StaticRasterCompositionPlan,
} from "@/shared/gpu-lens/static-composition";
import type { GpuRasterSurface } from "@/shared/gpu-lens/surface";
import {
	addFrameDiagnosticCount,
	setFrameDiagnosticGauge,
} from "@/shared/performance/frame-diagnostics";

/**
 * GPU raster overlay — renders GPU raster-finish Look nodes (CC Lens spherical
 * refraction, Kaleidoscope symmetry, Flow, Particle Dissolve, Deep Glow) on the
 * editor canvas. A complete target-set Deep Glow uses a separate transparent
 * post-material emission SVG, so the artboard background and Source Optics stay
 * in the completed base instead of becoming accidental emitters.
 * SVG filters provably cannot do these UV remaps, so they compile to no SVG and are
 * drawn here instead: the rasterized artboard is uploaded to a WebGL texture and
 * remapped by the effect shader (`@/shared/gpu-lens/surface`), pixel-aligned over the
 * artboard.
 *
 * The heavy WebGL surface is dynamically imported so it only loads when such a node is
 * present. The artboard SVG comes from `renderArtboardSvg` (supplied by the canvas-
 * shell widget) because the export serializer lives in a sibling feature this overlay
 * may not import directly. On scrub it renders off the `document` prop; during editor
 * playback (when that prop is frozen) it follows the transport via `subscribePlayback`
 * + `getRasterFrame`, so a keyframed effect param animates live.
 */

/** Local mirror of the host overlay props (avoids importing upward from widgets). */
type OverlayProps = {
	readonly document: SceneDocument;
	readonly viewport: {
		readonly zoom: number;
	};
	readonly renderArtboardSvg?: () => Promise<string>;
	readonly subscribePlayback?: (
		cb: (frame: number, playing: boolean) => void,
	) => () => void;
	readonly getRasterFrame?: (frame: number) => Promise<{
		readonly svg: string;
		readonly document: SceneDocument;
		readonly timeSeconds: number;
	}>;
	readonly getStaticRasterPlaybackPlan?: () => Promise<StaticRasterCompositionPlan | null>;
	readonly getStaticRasterPlaybackFrame?: (
		frame: number,
	) => StaticRasterCompositionFrame | null;
	readonly renderIsolatedNodeSetSvg?: (
		nodeIds: readonly string[],
		excludedScopedLookId: string,
		sampledScene?: SceneDocument,
	) => Promise<string | null>;
};

const PREVIEW_SCALE_BUCKETS = [
	0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
] as const;

/** Quantizes upward so the preview never undersamples its displayed device pixels. */
const previewScaleForViewport = (zoomPercent: number): number => {
	if (typeof window === "undefined") return 1;
	const dpr = window.devicePixelRatio;
	if (
		!Number.isFinite(zoomPercent) ||
		zoomPercent <= 0 ||
		!Number.isFinite(dpr) ||
		dpr <= 0
	) {
		return 1;
	}
	const required = Math.min(1, (zoomPercent / 100) * dpr);
	return PREVIEW_SCALE_BUCKETS.find((bucket) => bucket >= required) ?? 1;
};

/** Position the WebGL canvas to fill the artboard-sized overlay div. */
function styleRasterCanvas(canvas: HTMLCanvasElement): void {
	canvas.style.position = "absolute";
	canvas.style.inset = "0";
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.pointerEvents = "none";
}

function GpuRasterOverlay({
	document,
	viewport,
	renderArtboardSvg,
	subscribePlayback,
	getRasterFrame,
	getStaticRasterPlaybackPlan,
	getStaticRasterPlaybackFrame,
	renderIsolatedNodeSetSvg,
}: OverlayProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const surfaceRef = useRef<GpuRasterSurface | null>(null);
	const [playing, setPlaying] = useState(false);
	const latestPlaybackFrameRef = useRef(0);
	const staticReadyRef = useRef(false);
	const staticAttemptedRef = useRef(false);
	const staticGenerationRef = useRef(0);
	const staticPreparingRef = useRef<Promise<boolean> | null>(null);
	const staticInputRef = useRef({
		getFrame: getStaticRasterPlaybackFrame,
		getPlan: getStaticRasterPlaybackPlan,
	});

	const ensureStaticComposition = useCallback(
		async (surface: GpuRasterSurface): Promise<boolean> => {
			if (!getStaticRasterPlaybackPlan || !getStaticRasterPlaybackFrame) {
				return false;
			}
			if (staticReadyRef.current) return true;
			if (staticPreparingRef.current) return staticPreparingRef.current;
			if (staticAttemptedRef.current) return false;
			staticAttemptedRef.current = true;
			const generation = staticGenerationRef.current;
			const preparation = (async () => {
				const plan = await getStaticRasterPlaybackPlan();
				if (!plan) return false;
				const ready = await surface.prepareStaticComposition(plan);
				if (ready) addFrameDiagnosticCount("gpu.staticPlanAdmitted");
				return ready;
			})();
			staticPreparingRef.current = preparation;
			try {
				const ready = await preparation;
				if (generation !== staticGenerationRef.current) return false;
				staticReadyRef.current = ready;
				return ready;
			} finally {
				if (staticPreparingRef.current === preparation) {
					staticPreparingRef.current = null;
				}
			}
		},
		[getStaticRasterPlaybackFrame, getStaticRasterPlaybackPlan],
	);

	useEffect(() => {
		const previous = staticInputRef.current;
		if (
			previous.getFrame === getStaticRasterPlaybackFrame &&
			previous.getPlan === getStaticRasterPlaybackPlan
		) {
			return;
		}
		staticInputRef.current = {
			getFrame: getStaticRasterPlaybackFrame,
			getPlan: getStaticRasterPlaybackPlan,
		};
		staticGenerationRef.current += 1;
		staticReadyRef.current = false;
		staticAttemptedRef.current = false;
		staticPreparingRef.current = null;
		surfaceRef.current?.clearStaticComposition();
	});

	const nativeWidth = Math.max(1, Math.round(document.artboard.width));
	const nativeHeight = Math.max(1, Math.round(document.artboard.height));
	const previewScale = previewScaleForViewport(viewport.zoom);
	const width = playing
		? Math.max(1, Math.ceil(nativeWidth * previewScale))
		: nativeWidth;
	const height = playing
		? Math.max(1, Math.ceil(nativeHeight * previewScale))
		: nativeHeight;

	useEffect(() => {
		// A GPU composite graph renders as a layer tree; everything else as a linear pass
		// chain (the verified path). Either being present keeps the surface mounted.
		const tree = buildRasterTree(document);
		const passes = tree ? [] : buildRasterPasses(document);
		const scopedGlow = buildScopedDeepGlowPlan(document);
		if ((!tree && passes.length === 0 && !scopedGlow) || !renderArtboardSvg) {
			// No raster node (or no serializer): tear down and show the plain SVG layer.
			surfaceRef.current?.dispose();
			surfaceRef.current = null;
			containerRef.current?.replaceChildren();
			return;
		}
		let cancelled = false;
		void (async () => {
			const { createGpuRasterSurface } = await import(
				"@/shared/gpu-lens/surface"
			);
			if (cancelled) return;
			let surface = surfaceRef.current;
			if (!surface) {
				surface = createGpuRasterSurface(width, height);
				if (!surface) return; // WebGL unavailable → degrade to the SVG layer.
				styleRasterCanvas(surface.canvas);
				staticGenerationRef.current += 1;
				staticReadyRef.current = false;
				staticAttemptedRef.current = false;
				surfaceRef.current = surface;
				containerRef.current?.replaceChildren(surface.canvas);
			} else {
				surface.resize(width, height);
			}
			if (
				playing &&
				(await ensureStaticComposition(surface)) &&
				getStaticRasterPlaybackFrame
			) {
				const staticFrame = getStaticRasterPlaybackFrame(
					latestPlaybackFrameRef.current,
				);
				if (
					staticFrame &&
					(await surface.renderStaticComposition(staticFrame))
				) {
					return;
				}
			}
			const svgPrefix = await renderArtboardSvg();
			if (cancelled) return;
			if (
				scopedGlow &&
				!tree &&
				passes.length === 0 &&
				renderIsolatedNodeSetSvg
			) {
				const emissionSvg = await renderIsolatedNodeSetSvg(
					scopedGlow.targetNodeIds,
					scopedGlow.overlayId,
				);
				if (!cancelled && emissionSvg) {
					await surface.renderScopedGlow({
						baseSvg: svgPrefix,
						emissionSvg,
						pass: scopedGlow.pass,
					});
				}
				return;
			}
			await (tree
				? surface.renderTree({ svgPrefix, root: tree })
				: surface.renderPipeline({ svgPrefix, passes }));
		})();
		return () => {
			cancelled = true;
		};
	}, [
		document,
		ensureStaticComposition,
		getStaticRasterPlaybackFrame,
		height,
		playing,
		renderArtboardSvg,
		renderIsolatedNodeSetSvg,
		width,
	]);

	// Playback-follow: during editor Play the presentation document is frozen, so the
	// surface is re-rendered off the transport clock instead. Coalesce-to-latest
	// (never queue) so an async render cannot pile up into lag; no-op while paused —
	// the scrub effect above owns the paused/stopped frame.
	useEffect(() => {
		if (!subscribePlayback || !getRasterFrame) return;
		let inFlight = false;
		let pendingFrame: number | null = null;
		let latestRequestedFrame = 0;
		const markPresented = (frame: number): void => {
			addFrameDiagnosticCount("gpu.framesPresented");
			setFrameDiagnosticGauge("gpu.committedFrame", frame);
			setFrameDiagnosticGauge(
				"gpu.frameAge",
				Math.max(0, latestRequestedFrame - frame),
			);
		};
		const renderFrame = async (frame: number): Promise<void> => {
			const surface = surfaceRef.current;
			if (!surface) return;
			if (inFlight) {
				addFrameDiagnosticCount("gpu.framesCoalesced");
				if (pendingFrame !== null)
					addFrameDiagnosticCount("gpu.framesSuperseded");
				pendingFrame = frame;
				return;
			}
			inFlight = true;
			try {
				if (
					(await ensureStaticComposition(surface)) &&
					getStaticRasterPlaybackFrame
				) {
					const staticFrame = getStaticRasterPlaybackFrame(frame);
					if (
						staticFrame &&
						(await surface.renderStaticComposition(staticFrame))
					) {
						markPresented(frame);
						return;
					}
				}
				addFrameDiagnosticCount("gpu.staticPlanFallback");
				const {
					svg,
					document: docAtFrame,
					timeSeconds,
				} = await getRasterFrame(frame);
				const rasterOptions = { timeSeconds };
				const tree = buildRasterTree(docAtFrame, rasterOptions);
				const scopedGlow = buildScopedDeepGlowPlan(docAtFrame, rasterOptions);
				if (
					scopedGlow &&
					!tree &&
					buildRasterPasses(docAtFrame, rasterOptions).length === 0 &&
					renderIsolatedNodeSetSvg
				) {
					const emissionSvg = await renderIsolatedNodeSetSvg(
						scopedGlow.targetNodeIds,
						scopedGlow.overlayId,
						docAtFrame,
					);
					if (emissionSvg) {
						await surface.renderScopedGlow({
							baseSvg: svg,
							emissionSvg,
							pass: scopedGlow.pass,
						});
						markPresented(frame);
					}
					return;
				}
				if (tree) {
					await surface.renderTree({ svgPrefix: svg, root: tree });
					markPresented(frame);
				} else {
					const passes = buildRasterPasses(docAtFrame, rasterOptions);
					if (passes.length > 0) {
						await surface.renderPipeline({ svgPrefix: svg, passes });
						markPresented(frame);
					}
				}
			} finally {
				inFlight = false;
				if (pendingFrame !== null) {
					const next = pendingFrame;
					pendingFrame = null;
					void renderFrame(next);
				}
			}
		};
		return subscribePlayback((frame, playing) => {
			setPlaying((current) => (current === playing ? current : playing));
			setFrameDiagnosticGauge("transport.frame", frame);
			setFrameDiagnosticGauge("transport.playing", playing ? 1 : 0);
			if (playing) {
				latestRequestedFrame = frame;
				latestPlaybackFrameRef.current = frame;
				addFrameDiagnosticCount("gpu.framesRequested");
				void renderFrame(frame);
			}
		});
	}, [
		ensureStaticComposition,
		getRasterFrame,
		getStaticRasterPlaybackFrame,
		renderIsolatedNodeSetSvg,
		subscribePlayback,
	]);

	// Release the WebGL context when the overlay unmounts.
	useEffect(
		() => () => {
			surfaceRef.current?.dispose();
			surfaceRef.current = null;
		},
		[],
	);

	return (
		<div ref={containerRef} className="pointer-events-none absolute inset-0" />
	);
}

export const overlay = {
	id: "gpu-raster",
	Component: GpuRasterOverlay,
};
