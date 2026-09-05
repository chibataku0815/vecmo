import { useCallback, useEffect, useRef } from "react";
import { buildScopedPathBlurTargets } from "@/entities/scene/model/gpu-raster-adapter";
import type { Bounds, SceneDocument } from "@/entities/scene/model/types";
import type { GpuRasterSurface } from "@/shared/gpu-lens/surface";

/**
 * Composites object-scoped Path Blur targets on top of the finished frame —
 * the base SVG (and the frame-level GPU lens overlay, if any) already omit
 * these nodes (`deferGpuRasterEffects` in `svg.ts`'s `renderScopedLookGraphRun`
 * suppression), so this draws the blurred replacement in their place rather
 * than doubling them.
 *
 * One small, transparent-output `GpuRasterSurface` is created lazily and
 * REUSED (resized) across every target and every render — not one per object
 * — since a fresh WebGL context per object would not scale. Each target's
 * isolated crop SVG comes from `renderIsolatedNodeSvg` (canvas-shell), is
 * blurred by the shared surface, then drawn onto this overlay's own
 * artboard-sized 2D canvas at the target's bounds offset.
 */

/** Local mirror of the host overlay props (avoids importing upward from widgets). */
type OverlayProps = {
	readonly document: SceneDocument;
	readonly renderIsolatedNodeSvg?: (
		nodeId: string,
		bounds: Bounds,
		sampledScene?: SceneDocument,
	) => Promise<string | null>;
	readonly subscribePlayback?: (
		cb: (frame: number, playing: boolean) => void,
	) => () => void;
	readonly getRasterFrame?: (frame: number) => Promise<{
		readonly svg: string;
		readonly document: SceneDocument;
		readonly timeSeconds: number;
	}>;
};

const styleCompositeCanvas = (canvas: HTMLCanvasElement): void => {
	canvas.style.position = "absolute";
	canvas.style.inset = "0";
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.pointerEvents = "none";
};

function PathBlurObjectCompositeOverlay({
	document,
	renderIsolatedNodeSvg,
	subscribePlayback,
	getRasterFrame,
}: OverlayProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const contextRef = useRef<CanvasRenderingContext2D | null>(null);
	const cropSurfaceRef = useRef<GpuRasterSurface | null>(null);

	const width = Math.round(document.artboard.width);
	const height = Math.round(document.artboard.height);
	const hasPlaybackTargets = buildScopedPathBlurTargets(document).length > 0;

	// Composites every target from `doc` (already motion-sampled) onto the
	// overlay canvas, reusing one crop surface across all of them.
	const renderTargets = useCallback(
		async (
			doc: SceneDocument,
			sampledSceneForCrop: SceneDocument | undefined,
		): Promise<void> => {
			const context = contextRef.current;
			if (!context) return;
			const targets = buildScopedPathBlurTargets(doc);
			context.clearRect(0, 0, width, height);
			if (targets.length === 0 || !renderIsolatedNodeSvg) return;
			let surface = cropSurfaceRef.current;
			if (!surface) {
				const { createGpuRasterSurface } = await import(
					"@/shared/gpu-lens/surface"
				);
				surface = createGpuRasterSurface(1, 1, { transparentOutput: true });
				if (!surface) return; // WebGL unavailable → no blurred objects this pass.
				cropSurfaceRef.current = surface;
			}
			for (const target of targets) {
				const svg = await renderIsolatedNodeSvg(
					target.nodeId,
					target.bounds,
					sampledSceneForCrop,
				);
				if (!svg) continue;
				const cropWidth = Math.max(1, Math.round(target.bounds.width));
				const cropHeight = Math.max(1, Math.round(target.bounds.height));
				surface.resize(cropWidth, cropHeight);
				await surface.renderPipeline({
					svgPrefix: svg,
					passes: [{ nodeId: target.nodeId, params: target.params }],
				});
				context.drawImage(
					surface.canvas,
					target.bounds.x,
					target.bounds.y,
					cropWidth,
					cropHeight,
				);
			}
		},
		[renderIsolatedNodeSvg, width, height],
	);

	// Mount/resize the composite canvas at the artboard's native resolution
	// (CSS-scaled to the displayed zoom by `styleCompositeCanvas`), mirroring
	// the frame-level GPU overlay's canvas sizing.
	useEffect(() => {
		let canvas = canvasRef.current;
		if (!canvas) {
			canvas = window.document.createElement("canvas");
			styleCompositeCanvas(canvas);
			canvasRef.current = canvas;
			contextRef.current = canvas.getContext("2d");
			containerRef.current?.replaceChildren(canvas);
		}
		canvas.width = width;
		canvas.height = height;
	}, [width, height]);

	// Scrub render: off the `document` prop directly.
	useEffect(() => {
		void renderTargets(document, undefined);
	}, [document, renderTargets]);

	// Playback-follow: during editor Play the presentation document is frozen, so
	// re-resolve targets off the transport clock instead, via the SAME sampled
	// document `getRasterFrame` already produced (passed through as the crop
	// source too, so the crop is never sampled at a stale scrub-position frame).
	// Coalesce-to-latest (never queue) so an async render cannot pile up into lag.
	useEffect(() => {
		// This overlay is registered globally. Do not subscribe every document to
		// the heavyweight sampled-SVG bridge when the current artboard has no Path
		// Blur replacement to composite; doing so serialized an otherwise static
		// Deep Glow scene once per playback tick even though this canvas stayed empty.
		if (!hasPlaybackTargets || !subscribePlayback || !getRasterFrame) return;
		let inFlight = false;
		let pendingFrame: number | null = null;
		const renderFrame = async (frame: number): Promise<void> => {
			if (inFlight) {
				pendingFrame = frame;
				return;
			}
			inFlight = true;
			try {
				const { document: docAtFrame } = await getRasterFrame(frame);
				await renderTargets(docAtFrame, docAtFrame);
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
			if (playing) void renderFrame(frame);
		});
	}, [hasPlaybackTargets, subscribePlayback, getRasterFrame, renderTargets]);

	// Release the WebGL context when the overlay unmounts.
	useEffect(
		() => () => {
			cropSurfaceRef.current?.dispose();
			cropSurfaceRef.current = null;
		},
		[],
	);

	return (
		<div ref={containerRef} className="pointer-events-none absolute inset-0" />
	);
}

export const overlay = {
	id: "path-blur-object-composite",
	Component: PathBlurObjectCompositeOverlay,
	// Must paint above the frame-level GPU raster overlay (Deep Glow, Lens,
	// etc.) or an object-scoped blur would be buried under an opaque
	// frame-wide effect instead of staying visible on top of it.
	paintOrder: 1,
};
