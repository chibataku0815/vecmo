import {
	CAMERA_RIG_ANIMATABLE_PROPERTIES,
	type CameraRigAnimatableProperty,
} from "@/entities/motion/model/types";
import type {
	RuntimeCameraOverride,
	RuntimeCameraState,
	SceneCameraRuntimeControl,
} from "@/entities/scene/model/scene-camera";

export type VectorMotionRenderer = "svg" | "webgl";

/** Host-visible address of one sampled frame. Player time is global while sequence motion remains artboard-local. */
export type VectorMotionFrameScope =
	| {
			readonly kind: "scene";
			readonly artboardId: string;
			readonly localFrame: number;
	  }
	| {
			readonly kind: "scene-sequence";
			readonly sequenceId: string;
			readonly itemId: string;
			readonly artboardId: string;
			readonly globalFrame: number;
			readonly localFrame: number;
			readonly itemStartFrame: number;
			readonly itemEndFrameExclusive: number;
	  };

export type RuntimeCameraCatalogEntry = {
	readonly cameraRigId: string;
	readonly name?: string;
	readonly artboardId?: string;
	readonly projectionKind: "perspective" | "orthographic";
};

export type VectorMotionFrameSnapshot = {
	readonly revision: number;
	readonly renderer: VectorMotionRenderer;
	readonly frame: number;
	readonly progress: number;
	readonly fps: number;
	readonly durationFrames: number;
	readonly duration: number;
	readonly scope: VectorMotionFrameScope;
	readonly camera: RuntimeCameraState;
};

export type FrameSampleEvent = {
	readonly phase: "sampled";
	readonly requestId: number;
	readonly requestedFrame: number;
	readonly sampledFrame: number;
	readonly renderer: VectorMotionRenderer;
	readonly scope: VectorMotionFrameScope;
	readonly camera: RuntimeCameraState;
};

export type FrameRenderedEvent = {
	readonly phase: "rendered";
	readonly requestId: number;
	readonly revision: number;
	readonly snapshot: VectorMotionFrameSnapshot;
};

export type RuntimeControlIssue = {
	readonly code: string;
	readonly message: string;
};

export type RenderRequestResult =
	| {
			readonly status: "committed";
			readonly requestId: number;
			readonly snapshot: VectorMotionFrameSnapshot;
	  }
	| {
			readonly status: "superseded";
			readonly requestId: number;
			readonly byRequestId: number;
	  }
	| {
			readonly status: "rejected";
			readonly requestId: number;
			readonly issue: RuntimeControlIssue;
	  }
	| { readonly status: "disposed"; readonly requestId: number };

export type RuntimeRenderCommit = {
	readonly frame: number;
	readonly scope?: VectorMotionFrameScope;
	readonly camera: RuntimeCameraState;
};

export type RuntimeRenderRequest = {
	readonly requestId: number;
	readonly requestedFrame: number;
	readonly cameraRuntimeControl: SceneCameraRuntimeControl;
	readonly sample: (
		frame: number,
		camera: RuntimeCameraState,
		scope?: VectorMotionFrameScope,
	) => boolean;
	readonly isActive: () => boolean;
};

type PendingRequest = {
	readonly requestId: number;
	readonly requestedFrame: number;
	readonly cameraRuntimeControl: SceneCameraRuntimeControl;
	readonly resolve: (result: RenderRequestResult) => void;
	settled: boolean;
	sampled: boolean;
	sampledCamera?: RuntimeCameraState;
	sampledScope?: VectorMotionFrameScope;
};

export type RuntimePlayerControlOptions = {
	readonly renderer: VectorMotionRenderer;
	readonly fps: number;
	readonly durationFrames: number;
	readonly initialFrame?: number;
	readonly initialCamera: RuntimeCameraState;
	readonly initialFrameScope?: VectorMotionFrameScope;
	readonly cameraCatalog?: readonly RuntimeCameraCatalogEntry[];
	readonly initialCameraOverrides?: readonly {
		readonly cameraRigId: string;
		readonly override: RuntimeCameraOverride;
	}[];
	readonly initialActiveCameraOverride?: string | null;
	readonly onFrameSampled?: (event: FrameSampleEvent) => void;
	readonly onFrameRendered?: (event: FrameRenderedEvent) => void;
	readonly render: (
		request: RuntimeRenderRequest,
	) => RuntimeRenderCommit | Promise<RuntimeRenderCommit>;
};

const finite = (value: number): boolean => Number.isFinite(value);

const clampFrame = (frame: number, durationFrames: number): number =>
	Math.max(0, Math.min(durationFrames - 1, finite(frame) ? frame : 0));

const cameraArtboardId = (camera: RuntimeCameraState): string => {
	switch (camera.kind) {
		case "none":
		case "invalid":
			return camera.artboardId;
		case "single":
			return camera.view.artboardId;
		case "crossfade":
			return camera.from.artboardId;
	}
};

const sceneFrameScope = (
	frame: number,
	camera: RuntimeCameraState,
): VectorMotionFrameScope => ({
	kind: "scene",
	artboardId: cameraArtboardId(camera),
	localFrame: frame,
});

const issueFromUnknown = (error: unknown): RuntimeControlIssue => ({
	code: "render-failed",
	message: error instanceof Error ? error.message : String(error),
});

const cloneOverride = (
	override: RuntimeCameraOverride,
): RuntimeCameraOverride =>
	Object.freeze({
		mode: "replace",
		channels: Object.freeze({ ...override.channels }),
	});

const listenerError = (error: unknown): void => {
	if (typeof console !== "undefined" && typeof console.error === "function") {
		console.error("Vector motion runtime listener failed.", error);
	}
};

const immutableRuntimeValue = <T>(value: T): T => {
	if (Array.isArray(value)) {
		return Object.freeze(value.map(immutableRuntimeValue)) as T;
	}
	if (value && typeof value === "object") {
		return Object.freeze(
			Object.fromEntries(
				Object.entries(value).map(([key, entry]) => [
					key,
					immutableRuntimeValue(entry),
				]),
			),
		) as T;
	}
	return value;
};

const notify = <T>(
	listeners: ReadonlySet<(event: T) => void>,
	event: T,
): void => {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch (error) {
			listenerError(error);
		}
	}
};

const validateOverride = (
	override: RuntimeCameraOverride,
): RuntimeControlIssue | null => {
	if (override.mode !== "replace") {
		return {
			code: "camera-override-mode-invalid",
			message: 'Camera override mode must be "replace".',
		};
	}
	const allowed = new Set<string>(CAMERA_RIG_ANIMATABLE_PROPERTIES);
	for (const [property, value] of Object.entries(override.channels)) {
		if (!allowed.has(property)) {
			return {
				code: "camera-override-channel-invalid",
				message: `Unknown camera override channel "${property}".`,
			};
		}
		if (typeof value !== "number" || !finite(value)) {
			return {
				code: "camera-override-value-invalid",
				message: `Camera override channel "${property}" must be finite.`,
			};
		}
		const channel = property as CameraRigAnimatableProperty;
		if (channel === "fovDegrees" && (value < 1 || value > 179)) {
			return {
				code: "camera-override-range-invalid",
				message: "fovDegrees must be between 1 and 179.",
			};
		}
		if ((channel === "zoom" || channel === "focusDistance") && value <= 0) {
			return {
				code: "camera-override-range-invalid",
				message: `${channel} must be greater than zero.`,
			};
		}
		if (channel === "aperture" && value < 0) {
			return {
				code: "camera-override-range-invalid",
				message: "aperture must be zero or greater.",
			};
		}
	}
	return null;
};

export function createRuntimePlayerControl(
	options: RuntimePlayerControlOptions,
) {
	const renderer = options.renderer;
	const fps = Math.max(1, finite(options.fps) ? options.fps : 30);
	const durationFrames = Math.max(
		1,
		finite(options.durationFrames) ? options.durationFrames : 1,
	);
	const duration = durationFrames / fps;
	const cameraCatalog = Object.freeze(
		(options.cameraCatalog ?? []).map((entry) => Object.freeze({ ...entry })),
	);
	const cameraIds = new Set(cameraCatalog.map((entry) => entry.cameraRigId));
	const overrides = new Map<string, RuntimeCameraOverride>();
	let activeCameraRigId: string | null = null;
	let nextRequestId = 1;
	let revision = 0;
	let disposed = false;
	let active: PendingRequest | null = null;
	let pending: PendingRequest | null = null;
	const subscribers = new Set<() => void>();
	const sampledListeners = new Set<(event: FrameSampleEvent) => void>();
	const renderedListeners = new Set<(event: FrameRenderedEvent) => void>();
	if (options.onFrameSampled) sampledListeners.add(options.onFrameSampled);
	if (options.onFrameRendered) renderedListeners.add(options.onFrameRendered);

	const initialFrame = clampFrame(options.initialFrame ?? 0, durationFrames);
	const initialFrameScope = immutableRuntimeValue(
		options.initialFrameScope ??
			sceneFrameScope(initialFrame, options.initialCamera),
	);
	let snapshot: VectorMotionFrameSnapshot = Object.freeze({
		revision,
		renderer,
		frame: initialFrame,
		progress: durationFrames <= 1 ? 0 : initialFrame / (durationFrames - 1),
		fps,
		durationFrames,
		duration,
		scope: initialFrameScope,
		camera: options.initialCamera,
	});

	const validateCameraRigId = (
		cameraRigId: string,
	): RuntimeControlIssue | null =>
		cameraIds.has(cameraRigId)
			? null
			: {
					code: "camera-rig-missing",
					message: `Camera rig "${cameraRigId}" is not present in this export.`,
				};

	for (const entry of options.initialCameraOverrides ?? []) {
		const rigIssue = validateCameraRigId(entry.cameraRigId);
		const overrideIssue = validateOverride(entry.override);
		if (rigIssue || overrideIssue)
			throw new Error((rigIssue ?? overrideIssue)?.message);
		overrides.set(entry.cameraRigId, cloneOverride(entry.override));
	}
	if (options.initialActiveCameraOverride != null) {
		const rigIssue = validateCameraRigId(options.initialActiveCameraOverride);
		if (rigIssue) throw new Error(rigIssue.message);
		activeCameraRigId = options.initialActiveCameraOverride;
	}

	const cameraControlSnapshot = (): SceneCameraRuntimeControl =>
		Object.freeze({
			activeCameraRigId,
			cameraOverrides: Object.freeze(
				Object.fromEntries(
					[...overrides].map(([cameraRigId, override]) => [
						cameraRigId,
						cloneOverride(override),
					]),
				),
			),
		});

	const settle = (
		request: PendingRequest,
		result: RenderRequestResult,
	): void => {
		if (request.settled) return;
		request.settled = true;
		request.resolve(result);
	};

	const publishCommit = (
		request: PendingRequest,
		commit: RuntimeRenderCommit,
	): void => {
		if (disposed || request.settled || active !== request) return;
		if (!request.sampled) {
			rejectRequest(request, new Error("Renderer committed without sampling."));
			return;
		}
		const camera = request.sampledCamera;
		if (!camera) {
			rejectRequest(
				request,
				new Error("Renderer sampled without camera state."),
			);
			return;
		}
		const scope = request.sampledScope;
		if (!scope) {
			rejectRequest(
				request,
				new Error("Renderer sampled without frame scope."),
			);
			return;
		}
		const frame = clampFrame(commit.frame, durationFrames);
		revision += 1;
		snapshot = Object.freeze({
			revision,
			renderer,
			frame,
			progress: durationFrames <= 1 ? 0 : frame / (durationFrames - 1),
			fps,
			durationFrames,
			duration,
			scope,
			camera,
		});
		const result: RenderRequestResult = {
			status: "committed",
			requestId: request.requestId,
			snapshot,
		};
		const renderedEvent: FrameRenderedEvent = {
			phase: "rendered",
			requestId: request.requestId,
			revision,
			snapshot,
		};
		notify(renderedListeners, renderedEvent);
		for (const listener of subscribers) {
			try {
				listener();
			} catch (error) {
				listenerError(error);
			}
		}
		// Keep the request active while callbacks run so callback-triggered seeks
		// enter the bounded pending slot, then release it before its Promise settles.
		// Thus `await requestFrame()` is a true lifecycle boundary for callers.
		finishActive(request);
		settle(request, result);
	};

	const rejectRequest = (request: PendingRequest, error: unknown): void => {
		if (request.settled) return;
		finishActive(request);
		settle(request, {
			status: "rejected",
			requestId: request.requestId,
			issue: issueFromUnknown(error),
		});
	};

	const finishActive = (request: PendingRequest): void => {
		if (active === request) active = null;
		if (disposed || !pending) return;
		queueMicrotask(() => {
			if (disposed || active || !pending) return;
			const next = pending;
			pending = null;
			execute(next);
		});
	};

	const execute = (request: PendingRequest): void => {
		if (disposed) {
			settle(request, { status: "disposed", requestId: request.requestId });
			return;
		}
		active = request;
		const sample = (
			frame: number,
			camera: RuntimeCameraState,
			scope: VectorMotionFrameScope = sceneFrameScope(frame, camera),
		): boolean => {
			if (disposed || request.settled || active !== request) return false;
			if (request.sampled)
				throw new Error("Render request sampled more than once.");
			request.sampled = true;
			request.sampledCamera = immutableRuntimeValue(camera);
			request.sampledScope = immutableRuntimeValue(scope);
			const sampleEvent: FrameSampleEvent = {
				phase: "sampled",
				requestId: request.requestId,
				requestedFrame: request.requestedFrame,
				sampledFrame: frame,
				renderer,
				scope: request.sampledScope,
				camera: request.sampledCamera,
			};
			notify(sampledListeners, sampleEvent);
			return !disposed && !request.settled && active === request;
		};
		try {
			const rendered = options.render({
				requestId: request.requestId,
				requestedFrame: request.requestedFrame,
				cameraRuntimeControl: request.cameraRuntimeControl,
				sample,
				isActive: () => !disposed && !request.settled && active === request,
			});
			if (
				rendered &&
				typeof (rendered as Promise<RuntimeRenderCommit>).then === "function"
			) {
				void (rendered as Promise<RuntimeRenderCommit>)
					.then((commit) => publishCommit(request, commit))
					.catch((error) => rejectRequest(request, error))
					.finally(() => finishActive(request));
				return;
			}
			publishCommit(request, rendered as RuntimeRenderCommit);
		} catch (error) {
			rejectRequest(request, error);
		}
		finishActive(request);
	};

	const createRejectedResult = (
		controlIssue: RuntimeControlIssue,
	): Promise<RenderRequestResult> => {
		const requestId = nextRequestId++;
		return Promise.resolve({
			status: "rejected",
			requestId,
			issue: controlIssue,
		});
	};

	const requestFrame = (frame: number): Promise<RenderRequestResult> => {
		const requestId = nextRequestId++;
		if (disposed) return Promise.resolve({ status: "disposed", requestId });
		return new Promise((resolve) => {
			const request: PendingRequest = {
				requestId,
				requestedFrame: clampFrame(frame, durationFrames),
				cameraRuntimeControl: cameraControlSnapshot(),
				resolve,
				settled: false,
				sampled: false,
			};
			if (!active && !pending) {
				execute(request);
				return;
			}
			if (pending) {
				settle(pending, {
					status: "superseded",
					requestId: pending.requestId,
					byRequestId: requestId,
				});
			}
			pending = request;
		});
	};

	const setCameraOverride = (
		cameraRigId: string,
		override: RuntimeCameraOverride | null,
	): Promise<RenderRequestResult> => {
		const rigIssue = validateCameraRigId(cameraRigId);
		if (rigIssue) return createRejectedResult(rigIssue);
		if (override) {
			const overrideIssue = validateOverride(override);
			if (overrideIssue) return createRejectedResult(overrideIssue);
			overrides.set(cameraRigId, cloneOverride(override));
		} else {
			overrides.delete(cameraRigId);
		}
		return requestFrame(snapshot.frame);
	};

	return {
		renderer,
		fps,
		durationFrames,
		duration,
		requestFrame,
		seekProgress: (progress: number) =>
			requestFrame(
				Math.max(0, Math.min(1, finite(progress) ? progress : 0)) *
					(durationFrames - 1),
			),
		rerenderCommittedFrame: () => requestFrame(snapshot.frame),
		getSnapshot: () => snapshot,
		getCameraState: () => snapshot.camera,
		getCameraCatalog: () => cameraCatalog,
		subscribe(
			listener: () => void,
			subscribeOptions?: { emitCurrent?: boolean },
		) {
			subscribers.add(listener);
			if (subscribeOptions?.emitCurrent) {
				try {
					listener();
				} catch (error) {
					listenerError(error);
				}
			}
			return () => subscribers.delete(listener);
		},
		onFrameSampled(listener: (event: FrameSampleEvent) => void) {
			sampledListeners.add(listener);
			return () => sampledListeners.delete(listener);
		},
		onFrameRendered(listener: (event: FrameRenderedEvent) => void) {
			renderedListeners.add(listener);
			return () => renderedListeners.delete(listener);
		},
		setCameraOverride,
		clearCameraOverrides(): Promise<RenderRequestResult> {
			overrides.clear();
			return requestFrame(snapshot.frame);
		},
		setActiveCameraOverride(cameraRigId: string | null) {
			if (cameraRigId !== null) {
				const rigIssue = validateCameraRigId(cameraRigId);
				if (rigIssue) return createRejectedResult(rigIssue);
			}
			activeCameraRigId = cameraRigId;
			return requestFrame(snapshot.frame);
		},
		destroy(): void {
			if (disposed) return;
			disposed = true;
			if (active)
				settle(active, { status: "disposed", requestId: active.requestId });
			if (pending)
				settle(pending, { status: "disposed", requestId: pending.requestId });
			active = null;
			pending = null;
			subscribers.clear();
			sampledListeners.clear();
			renderedListeners.clear();
		},
		isDisposed: () => disposed,
	};
}
