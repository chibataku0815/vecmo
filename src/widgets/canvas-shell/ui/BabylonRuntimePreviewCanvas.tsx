import { useCallback, useEffect, useRef } from "react";
import type { BabylonRuntimeSurface } from "@/shared/babylon";
import type { Runtime3dFrame } from "@/shared/runtime-3d/types";

export type BabylonRuntimePreviewStatus = "loading" | "ready" | "error";

/**
 * CanvasShell-owned lifecycle for the shared Babylon adapter. The component is
 * intentionally a frame reader: transport ticks are sampled by its owner and
 * coalesced here, while Babylon never advances the clock or owns durable state.
 *
 * Left unwired: `createBabylonRuntimeSurface`'s optional non-fatal `onIssue`
 * (e.g. `runtime-3d-environment-unavailable`) — this component has no
 * existing non-fatal issue prop/display path, only the fatal `onStatus`
 * `"error"` transition, so wiring it would mean inventing a new channel here
 * and threading it through `ExternalAssetRuntimePreviewLayer`.
 */
export function BabylonRuntimePreviewCanvas({
	frame,
	onPickerChange,
	onStatus,
	onVectorPlaneConsumptionChange,
	prepareFrame,
	resolveFrame,
	subscribePlayback,
}: {
	readonly frame: Runtime3dFrame;
	readonly onPickerChange: (
		picker: BabylonRuntimeSurface["pickNodeAtClientPoint"] | null,
	) => void;
	readonly onStatus: (status: BabylonRuntimePreviewStatus) => void;
	readonly onVectorPlaneConsumptionChange: (nodeIds: readonly string[]) => void;
	readonly prepareFrame: (frame: Runtime3dFrame) => Promise<Runtime3dFrame>;
	readonly resolveFrame: (frame: number) => Promise<Runtime3dFrame>;
	readonly subscribePlayback: (
		cb: (frame: number, playing: boolean) => void,
	) => () => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const frameRef = useRef(frame);
	const adapterRef = useRef<BabylonRuntimeSurface | null>(null);
	const onPickerChangeRef = useRef(onPickerChange);
	const onStatusRef = useRef(onStatus);
	const onVectorPlaneConsumptionChangeRef = useRef(
		onVectorPlaneConsumptionChange,
	);
	const pendingFrameRef = useRef<Runtime3dFrame | null>(frame);
	const preparationIdRef = useRef(0);
	const prepareFrameRef = useRef(prepareFrame);
	const renderingRef = useRef(false);
	const resolveFrameRef = useRef(resolveFrame);
	const surfaceGenerationRef = useRef(0);
	frameRef.current = frame;
	onPickerChangeRef.current = onPickerChange;
	onStatusRef.current = onStatus;
	onVectorPlaneConsumptionChangeRef.current = onVectorPlaneConsumptionChange;
	prepareFrameRef.current = prepareFrame;
	resolveFrameRef.current = resolveFrame;

	const flushPendingFrame = useCallback(async () => {
		const adapter = adapterRef.current;
		if (!adapter || renderingRef.current) return;
		const generation = surfaceGenerationRef.current;
		renderingRef.current = true;
		try {
			while (
				pendingFrameRef.current &&
				adapterRef.current === adapter &&
				surfaceGenerationRef.current === generation
			) {
				const pendingFrame = pendingFrameRef.current;
				pendingFrameRef.current = null;
				await adapter.renderFrame(pendingFrame);
				if (
					adapterRef.current === adapter &&
					surfaceGenerationRef.current === generation
				) {
					onStatusRef.current("ready");
					onVectorPlaneConsumptionChangeRef.current(
						pendingFrame.vectorPlanes
							.filter((plane) => plane.texture !== null)
							.map((plane) => plane.sourceNodeId),
					);
				}
			}
		} catch {
			pendingFrameRef.current = null;
			if (
				adapterRef.current === adapter &&
				surfaceGenerationRef.current === generation
			) {
				onStatusRef.current("error");
				onVectorPlaneConsumptionChangeRef.current([]);
			}
		} finally {
			renderingRef.current = false;
		}
	}, []);

	const requestFrame = useCallback(
		(resolve: () => Promise<Runtime3dFrame>) => {
			const preparationId = preparationIdRef.current + 1;
			preparationIdRef.current = preparationId;
			void resolve()
				.then((nextFrame) => {
					if (preparationIdRef.current !== preparationId) return;
					pendingFrameRef.current = nextFrame;
					void flushPendingFrame();
				})
				.catch(() => {
					if (preparationIdRef.current !== preparationId) return;
					pendingFrameRef.current = null;
					onStatusRef.current("error");
					onVectorPlaneConsumptionChangeRef.current([]);
				});
		},
		[flushPendingFrame],
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let cancelled = false;
		const generation = surfaceGenerationRef.current + 1;
		surfaceGenerationRef.current = generation;
		onStatusRef.current("loading");
		void import("@/shared/babylon")
			.then(async ({ createBabylonRuntimeSurface }) => {
				if (cancelled) return;
				const adapter = await createBabylonRuntimeSurface(canvas, () => {
					if (!cancelled) onStatusRef.current("error");
				});
				if (cancelled) {
					adapter.dispose();
					return;
				}
				adapterRef.current = adapter;
				onPickerChangeRef.current(adapter.pickNodeAtClientPoint);
				requestFrame(() => prepareFrameRef.current(frameRef.current));
			})
			.catch(() => {
				if (!cancelled) onStatusRef.current("error");
			});
		return () => {
			cancelled = true;
			surfaceGenerationRef.current += 1;
			preparationIdRef.current += 1;
			pendingFrameRef.current = null;
			onPickerChangeRef.current(null);
			onVectorPlaneConsumptionChangeRef.current([]);
			adapterRef.current?.dispose();
			adapterRef.current = null;
		};
	}, [requestFrame]);

	useEffect(() => {
		requestFrame(() => prepareFrameRef.current(frame));
	}, [frame, requestFrame]);

	useEffect(
		() =>
			subscribePlayback((playbackFrame, playing) => {
				if (!playing) return;
				requestFrame(() => resolveFrameRef.current(playbackFrame));
			}),
		[requestFrame, subscribePlayback],
	);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 block h-full w-full bg-transparent"
			data-runtime-3d="babylon"
		/>
	);
}
