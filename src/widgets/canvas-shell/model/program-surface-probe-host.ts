import { PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION } from "@/entities/scene/model/program-surface";
import type { Matrix2D } from "@/entities/scene/model/rendering";
import { inspectProgramSurfaceBundleV1 } from "@/features/program-surface/model/bundle-static-gate";
import type { ApprovedProgramSurfaceProbe } from "@/features/program-surface/model/local-approval";

const BOOTSTRAP_PROTOCOL = "vecmo.program-surface/bootstrap-v1";
const PROGRAM_SURFACE_PROTOCOL = "vecmo.program-surface/v1";

/**
 * `allow-scripts` retains an opaque origin and withholds all navigation,
 * popup, form, same-origin, and top-level-navigation sandbox allowances.
 */
export const PROGRAM_SURFACE_PROBE_IFRAME_SANDBOX = "allow-scripts";

export type ProgramSurfaceProbeHostLimits = {
	readonly maxDpr: number;
	readonly bootstrapTimeoutMs: number;
	readonly frameTimeoutMs: number;
};

export const PROGRAM_SURFACE_PROBE_HOST_LIMITS: ProgramSurfaceProbeHostLimits =
	{
		maxDpr: 2,
		bootstrapTimeoutMs: 4_000,
		frameTimeoutMs: 2_000,
	} as const;

export type ProgramSurfaceProbePlacement = {
	readonly nodeId: string;
	readonly artboardId: string;
	readonly matrix: Matrix2D;
	readonly cssWidth: number;
	readonly cssHeight: number;
	readonly opacity: number;
};

export type ProgramSurfaceProbeFrame = {
	readonly frame: number;
	readonly fps: number;
	readonly placement: ProgramSurfaceProbePlacement;
};

export type ProgramSurfaceHostStatus =
	| { readonly kind: "booting" }
	| {
			readonly kind: "live";
			readonly nodeId: string;
			readonly contentKey: string;
			readonly sequence: number;
	  }
	| {
			readonly kind: "fallback";
			readonly nodeId?: string;
			readonly code: ProgramSurfaceHostIssueCode;
	  }
	| { readonly kind: "disposed"; readonly nodeId?: string };

export type ProgramSurfaceHostIssueCode =
	| "program-surface.host-unavailable"
	| "program-surface.bootstrap-failed"
	| "program-surface.webgl2-unavailable"
	| "program-surface.module-failed"
	| "program-surface.protocol-invalid"
	| "program-surface.output-size-invalid"
	| "program-surface.frame-stalled"
	| "program-surface.context-lost"
	| "program-surface.frame-invalid"
	| "program-surface.stale-frame"
	| "program-surface.bundle-static-gate-rejected";

/**
 * Source-free identity for a host render request. It intentionally excludes
 * bundle data, source references, local paths, port payloads, and pixels.
 */
export type ProgramSurfaceProbeHostTraceFrame = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly frame: number;
	readonly fps: number;
	readonly pixelWidth: number;
	readonly pixelHeight: number;
};

export type ProgramSurfaceProbeHostFrameDropReason =
	| "invalid-request"
	| "invalid-bitmap"
	| "unexpected-sequence"
	| "invalid-size"
	| "output-size-mismatch"
	| "stale-content"
	| "draw-failed"
	| "timeout"
	| "host-failed"
	| "host-disposed";

export type ProgramSurfaceProbeHostTraceEvent =
	| {
			readonly kind: "frame-requested";
			readonly request: ProgramSurfaceProbeHostTraceFrame;
	  }
	| {
			readonly kind: "frame-coalesced";
			readonly request: ProgramSurfaceProbeHostTraceFrame;
			readonly reason: "awaiting-ready" | "frame-in-flight";
			readonly pendingSequence?: number;
	  }
	| {
			readonly kind: "frame-sent";
			readonly request: ProgramSurfaceProbeHostTraceFrame;
			readonly sequence: number;
	  }
	| {
			readonly kind: "frame-received";
			readonly assetId: string;
			/** `null` records a malformed child envelope without preserving it. */
			readonly sequence: number | null;
	  }
	| {
			readonly kind: "frame-accepted";
			readonly request: ProgramSurfaceProbeHostTraceFrame;
			readonly sequence: number;
	  }
	| {
			readonly kind: "frame-dropped";
			readonly assetId: string;
			readonly reason: ProgramSurfaceProbeHostFrameDropReason;
			readonly request?: ProgramSurfaceProbeHostTraceFrame;
			readonly sequence?: number;
	  }
	| {
			readonly kind: "resource-disposed";
			readonly assetId: string;
			readonly resource: "bitmap";
			readonly outcome: "closed" | "close-failed" | "transferred";
			readonly reason:
				| "accepted"
				| "invalid-bitmap"
				| "unexpected-sequence"
				| "invalid-size"
				| "output-size-mismatch"
				| "stale-content"
				| "draw-failed";
	  }
	| {
			readonly kind: "resource-disposed";
			readonly assetId: string;
			readonly resource: "message-port";
			readonly outcome: "closed" | "close-failed";
			readonly reason: "host-failed" | "host-disposed";
	  }
	| {
			readonly kind: "resource-disposed";
			readonly assetId: string;
			readonly resource: "iframe";
			readonly outcome: "removed";
			readonly reason: "host-failed" | "host-disposed";
	  }
	| {
			readonly kind: "resource-disposed";
			readonly assetId: string;
			readonly resource: "host";
			readonly outcome: "disposed";
			readonly reason: "host-failed" | "host-disposed";
	  };

type ProgramSurfaceProbeHostBitmapDisposalReason = Extract<
	ProgramSurfaceProbeHostTraceEvent,
	{ readonly kind: "resource-disposed"; readonly resource: "bitmap" }
>["reason"];

export type ProgramSurfaceProbeHost = {
	/** Queues one parent-clocked render; only one render is ever in flight. */
	readonly render: (frame: ProgramSurfaceProbeFrame) => void;
	/** Stops future rendering and returns Canvas to its SVG fallback/placeholder. */
	readonly pause: () => void;
	/** Removes the iframe, closes the port, cancels deadlines, and clears pixels. */
	readonly dispose: () => void;
};

export type CreateProgramSurfaceProbeHostInput = {
	readonly probe: ApprovedProgramSurfaceProbe;
	readonly canvas: HTMLCanvasElement;
	readonly iframeMount: HTMLElement;
	readonly onStatus: (status: ProgramSurfaceHostStatus) => void;
	/**
	 * Optional, ephemeral diagnostics for one host instance. The host never
	 * stores the trace and the event contract deliberately omits source data.
	 */
	readonly onTrace?: (event: ProgramSurfaceProbeHostTraceEvent) => void;
	readonly limits?: Partial<ProgramSurfaceProbeHostLimits>;
};

type SurfaceSize = {
	readonly cssWidth: number;
	readonly cssHeight: number;
	readonly pixelWidth: number;
	readonly pixelHeight: number;
	readonly dpr: number;
};

type ResolvedFrame = {
	readonly frame: number;
	readonly fps: number;
	readonly timeSeconds: number;
	readonly placement: ProgramSurfaceProbePlacement;
	readonly surface: SurfaceSize;
	readonly surfaceKey: string;
};

type PendingFrame = {
	readonly sequence: number;
	readonly frame: ResolvedFrame;
};

type HostLimits = ProgramSurfaceProbeHostLimits;

/**
 * Viewport transform and output-size refreshes do not change the program's
 * sampled input. A previous consumed bitmap may stay visible during that
 * refresh; a different transport time or node must return to fallback first.
 */
export type ProgramSurfaceFrameContentIdentity = {
	readonly nodeId: string;
	readonly frame: number;
	readonly fps: number;
};

export const programSurfaceFrameContentKey = (
	identity: ProgramSurfaceFrameContentIdentity,
): string =>
	[identity.nodeId, String(identity.frame), String(identity.fps)].join(
		"\u0000",
	);

export const hasSameProgramSurfaceFrameContent = (
	left: Pick<ProgramSurfaceProbeFrame, "frame" | "fps" | "placement">,
	right: Pick<ProgramSurfaceProbeFrame, "frame" | "fps" | "placement">,
): boolean =>
	programSurfaceFrameContentKey({
		nodeId: left.placement.nodeId,
		frame: left.frame,
		fps: left.fps,
	}) ===
	programSurfaceFrameContentKey({
		nodeId: right.placement.nodeId,
		frame: right.frame,
		fps: right.fps,
	});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isNonNegativeInteger = (value: unknown): value is number =>
	isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
	isFiniteNumber(value) && Number.isInteger(value) && value > 0;

const isNormalizedDigest = (value: unknown): value is string =>
	typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/iu.test(value);

const isNormalizedColorMap = (value: unknown): boolean =>
	isRecord(value) &&
	Object.values(value).every(
		(color) => typeof color === "string" && /^#[a-f0-9]{8}$/iu.test(color),
	);

const isFiniteScalarMap = (value: unknown): boolean =>
	isRecord(value) && Object.values(value).every(isFiniteNumber);

/** Re-checks the narrow ephemeral ABI when a caller bypasses TypeScript types. */
const isHostSafeProbe = (
	probe: unknown,
): probe is ApprovedProgramSurfaceProbe => {
	if (!isRecord(probe)) return false;
	const output = probe.output;
	return (
		typeof probe.assetId === "string" &&
		probe.assetId.length > 0 &&
		typeof probe.bundleText === "string" &&
		isNormalizedDigest(probe.digest) &&
		isNonNegativeInteger(probe.seed) &&
		probe.seed <= 0xffff_ffff &&
		isFiniteScalarMap(probe.scalarPorts) &&
		isNormalizedColorMap(probe.colorPorts) &&
		isRecord(output) &&
		output.alphaMode === "premultiplied" &&
		isPositiveInteger(output.maxPixelWidth) &&
		output.maxPixelWidth <= PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION &&
		isPositiveInteger(output.maxPixelHeight) &&
		output.maxPixelHeight <= PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION
	);
};

const cssMatrix = (matrix: Matrix2D): string =>
	`matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`;

const isFiniteMatrix = (matrix: Matrix2D): boolean =>
	["a", "b", "c", "d", "e", "f"].every((key) =>
		Number.isFinite(matrix[key as keyof Matrix2D]),
	);

const escapeInlineScriptValue = (value: string): string =>
	JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");

const randomToken = (): string | null => {
	if (typeof globalThis.crypto?.getRandomValues !== "function") return null;
	try {
		const bytes = new Uint8Array(24);
		globalThis.crypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
			"",
		);
	} catch {
		return null;
	}
};

const boundedLimits = (
	input: CreateProgramSurfaceProbeHostInput["limits"],
): HostLimits => {
	const positive = (value: number | undefined, fallback: number): number =>
		isFiniteNumber(value) && value > 0 ? value : fallback;
	return {
		maxDpr: Math.min(
			4,
			positive(input?.maxDpr, PROGRAM_SURFACE_PROBE_HOST_LIMITS.maxDpr),
		),
		bootstrapTimeoutMs: Math.min(
			15_000,
			positive(
				input?.bootstrapTimeoutMs,
				PROGRAM_SURFACE_PROBE_HOST_LIMITS.bootstrapTimeoutMs,
			),
		),
		frameTimeoutMs: Math.min(
			15_000,
			positive(
				input?.frameTimeoutMs,
				PROGRAM_SURFACE_PROBE_HOST_LIMITS.frameTimeoutMs,
			),
		),
	};
};

const safeStatus = (
	callback: (status: ProgramSurfaceHostStatus) => void,
	status: ProgramSurfaceHostStatus,
): void => {
	try {
		callback(status);
	} catch {
		// A derived UI status must never keep an untrusted host alive.
	}
};

const safeTrace = (
	callback: CreateProgramSurfaceProbeHostInput["onTrace"],
	event: ProgramSurfaceProbeHostTraceEvent,
): void => {
	if (!callback) return;
	try {
		callback(event);
	} catch {
		// Diagnostics must never change isolated host liveness or cleanup.
	}
};

/**
 * CSP is intentionally source-free and network-free. Navigation containment is
 * provided by the restrictive iframe sandbox, not the unsupported `navigate-to`
 * CSP directive.
 */
export const buildProgramSurfaceProbeHostCsp = (nonce: string): string =>
	[
		"default-src 'none'",
		`script-src 'nonce-${nonce}' blob:`,
		`style-src 'nonce-${nonce}'`,
		"img-src data: blob:",
		"connect-src 'none'",
		"media-src 'none'",
		"font-src 'none'",
		"worker-src 'none'",
		"child-src 'none'",
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");

const bootstrapSrcDoc = ({
	nonce,
	instanceId,
	generation,
	probe,
}: {
	readonly nonce: string;
	readonly instanceId: string;
	readonly generation: number;
	readonly probe: ApprovedProgramSurfaceProbe;
}): string => {
	const csp = buildProgramSurfaceProbeHostCsp(nonce);
	const bootstrap = `(() => {
	"use strict";
	const BOOTSTRAP_PROTOCOL = ${escapeInlineScriptValue(BOOTSTRAP_PROTOCOL)};
	const PROGRAM_SURFACE_PROTOCOL = ${escapeInlineScriptValue(PROGRAM_SURFACE_PROTOCOL)};
	const nonce = ${escapeInlineScriptValue(nonce)};
	const instanceId = ${escapeInlineScriptValue(instanceId)};
	const generation = ${String(generation)};
	const bundleText = ${escapeInlineScriptValue(probe.bundleText)};
	const expectedDigest = ${escapeInlineScriptValue(probe.digest)};
	const maxPixelWidth = ${String(probe.output.maxPixelWidth)};
	const maxPixelHeight = ${String(probe.output.maxPixelHeight)};
	let port = null;
	let canvas = null;
	let renderer = null;
	let initialized = false;
	let contextLost = false;
	let disposed = false;

	const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
	const finite = (value) => typeof value === "number" && Number.isFinite(value);
	const positiveInteger = (value) => finite(value) && Number.isInteger(value) && value > 0;
	const nonNegativeInteger = (value) => finite(value) && Number.isSafeInteger(value) && value >= 0;
	const validColorMap = (value) => isRecord(value) && Object.values(value).every((item) => typeof item === "string" && /^#[a-f0-9]{8}$/iu.test(item));
	const validScalarMap = (value) => isRecord(value) && Object.values(value).every(finite);
	const envelope = (message) => ({ protocol: PROGRAM_SURFACE_PROTOCOL, instanceId, generation, ...message });
	const send = (message, transfer) => {
		if (!port || disposed) return;
		try { port.postMessage(envelope(message), transfer ?? []); } catch {}
	};
	const diagnostic = (phase, code, severity = "error") => send({ type: "diagnostic", phase, severity, code });
	const disposeRenderer = () => {
		if (!renderer) return;
		try { renderer.dispose(); } catch {}
		renderer = null;
	};
	const isEnvelope = (value) => isRecord(value) && value.protocol === PROGRAM_SURFACE_PROTOCOL && value.instanceId === instanceId && value.generation === generation && typeof value.type === "string";
	const validSurface = (surface) => isRecord(surface) && finite(surface.cssWidth) && surface.cssWidth > 0 && finite(surface.cssHeight) && surface.cssHeight > 0 && positiveInteger(surface.pixelWidth) && positiveInteger(surface.pixelHeight) && surface.pixelWidth <= maxPixelWidth && surface.pixelHeight <= maxPixelHeight && finite(surface.dpr) && surface.dpr > 0;
	const validRender = (message) => nonNegativeInteger(message.sequence) && nonNegativeInteger(message.frame) && finite(message.fps) && message.fps > 0 && finite(message.timeSeconds) && Math.abs(message.timeSeconds - message.frame / message.fps) <= 1e-9 && nonNegativeInteger(message.seed) && validScalarMap(message.scalarPorts) && validColorMap(message.colorPorts);
	const onContextLost = (event) => {
		event.preventDefault?.();
		if (disposed || contextLost) return;
		contextLost = true;
		disposeRenderer();
		send({ type: "context-lost" });
	};
	const onContextRestored = () => {
		if (disposed) return;
		send({ type: "context-restored" });
	};
	const createRenderer = async (surface) => {
		if (typeof OffscreenCanvas !== "function") {
			diagnostic("bootstrap", "webgl2-unavailable");
			return false;
		}
		canvas = new OffscreenCanvas(surface.pixelWidth, surface.pixelHeight);
		const context = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
		if (!context) {
			diagnostic("bootstrap", "webgl2-unavailable");
			return false;
		}
		canvas.addEventListener("webglcontextlost", onContextLost);
		canvas.addEventListener("webglcontextrestored", onContextRestored);
		let url = null;
		try {
			url = URL.createObjectURL(new Blob([bundleText], { type: "text/javascript" }));
			const module = await import(url);
			const createProgramSurface = module.createProgramSurface;
			if (typeof createProgramSurface !== "function") throw new Error("missing-create");
			const candidate = createProgramSurface({ canvas, alphaMode: "premultiplied" });
			if (candidate && typeof candidate.then === "function") throw new Error("async-renderer-forbidden");
			if (!candidate || typeof candidate.render !== "function" || typeof candidate.dispose !== "function") throw new Error("invalid-renderer");
			renderer = candidate;
			if (typeof renderer.resize === "function") {
				const resizeResult = renderer.resize(surface.pixelWidth, surface.pixelHeight, surface.dpr);
				if (resizeResult && typeof resizeResult.then === "function") throw new Error("async-resize-forbidden");
			}
			return true;
		} catch {
			diagnostic("compile", "module-failed");
			disposeRenderer();
			return false;
		} finally {
			if (url) URL.revokeObjectURL(url);
		}
	};
	const initialize = async (message) => {
		if (initialized || !validSurface(message.surface) || message.digest !== expectedDigest || !isRecord(message.initial) || !validRender({ ...message.initial, sequence: 0 })) {
			diagnostic("protocol", "init-invalid");
			return;
		}
		if (message.surface.alphaMode !== "premultiplied") {
			diagnostic("protocol", "init-invalid");
			return;
		}
		const created = await createRenderer(message.surface);
		if (!created || contextLost || disposed) return;
		initialized = true;
		send({ type: "ready", digest: expectedDigest, webgl2: true });
	};
	const resize = (message) => {
		if (!initialized || !canvas || !renderer || !nonNegativeInteger(message.sequence) || !validSurface(message.surface)) {
			diagnostic("protocol", "resize-invalid");
			return;
		}
		canvas.width = message.surface.pixelWidth;
		canvas.height = message.surface.pixelHeight;
		try {
			const resizeResult = renderer.resize?.(message.surface.pixelWidth, message.surface.pixelHeight, message.surface.dpr);
			if (resizeResult && typeof resizeResult.then === "function") throw new Error("async-resize-forbidden");
		} catch { diagnostic("render", "resize-failed"); }
	};
	const render = (message) => {
		if (!initialized || !canvas || !renderer || contextLost || !validRender(message)) {
			diagnostic("protocol", "render-invalid");
			return;
		}
		try {
			const result = renderer.render({ frame: message.frame, fps: message.fps, timeSeconds: message.timeSeconds, seed: message.seed, scalarPorts: message.scalarPorts, colorPorts: message.colorPorts });
			if (result && typeof result.then === "function") throw new Error("async-render-forbidden");
			if (disposed || contextLost || !canvas) return;
			const bitmap = canvas.transferToImageBitmap();
			try {
				if (!port || disposed) throw new Error("port-unavailable");
				port.postMessage(envelope({ type: "frame", sequence: message.sequence, width: bitmap.width, height: bitmap.height, bitmap }), [bitmap]);
			} catch { bitmap.close(); diagnostic("render", "frame-transfer-failed"); }
		} catch { diagnostic("render", "render-failed"); }
	};
	const dispose = () => {
		if (disposed) return;
		send({ type: "disposed" });
		disposed = true;
		disposeRenderer();
		if (canvas) {
			canvas.removeEventListener("webglcontextlost", onContextLost);
			canvas.removeEventListener("webglcontextrestored", onContextRestored);
		}
		try { port?.close(); } catch {}
		port = null;
	};
	const onPortMessage = (event) => {
		const message = event.data;
		if (!isEnvelope(message) || disposed) { diagnostic("protocol", "envelope-invalid"); return; }
		switch (message.type) {
			case "init": void initialize(message); return;
			case "resize": resize(message); return;
			case "render": render(message); return;
			case "dispose": dispose(); return;
			default: diagnostic("protocol", "message-invalid");
		}
	};
	const onBootstrapMessage = (event) => {
		const message = event.data;
		if (event.source !== parent || !isRecord(message) || message.protocol !== BOOTSTRAP_PROTOCOL || message.type !== "connect" || message.nonce !== nonce || event.ports.length !== 1) return;
		window.removeEventListener("message", onBootstrapMessage);
		port = event.ports[0];
		port.onmessage = onPortMessage;
		port.start?.();
	};
	window.addEventListener("message", onBootstrapMessage);
	parent.postMessage({ protocol: BOOTSTRAP_PROTOCOL, type: "hello", nonce }, "*");
})();`;
	return [
		'<!doctype html><html><head><meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${csp}">`,
		"</head><body>",
		`<script nonce="${nonce}">${bootstrap}</script>`,
		"</body></html>",
	].join("");
};

/**
 * Hosts one approved Program Surface in an opaque-origin iframe. The iframe is
 * the trust boundary; this class only forwards bounded pixels to a parent-owned
 * canvas and never receives a document, store, command, or generic callback
 * from the program.
 */
export const createProgramSurfaceProbeHost = (
	input: CreateProgramSurfaceProbeHostInput,
): ProgramSurfaceProbeHost => {
	if (!isHostSafeProbe(input.probe)) {
		input.canvas.style.visibility = "hidden";
		input.canvas.style.opacity = "0";
		input.canvas.width = 1;
		input.canvas.height = 1;
		safeStatus(input.onStatus, {
			kind: "fallback",
			code: "program-surface.protocol-invalid",
		});
		return { render: () => {}, pause: () => {}, dispose: () => {} };
	}
	const bundleGate = inspectProgramSurfaceBundleV1(input.probe.bundleText);
	if (bundleGate.status === "rejected") {
		input.canvas.style.visibility = "hidden";
		input.canvas.style.opacity = "0";
		input.canvas.width = 1;
		input.canvas.height = 1;
		safeStatus(input.onStatus, {
			kind: "fallback",
			code: "program-surface.bundle-static-gate-rejected",
		});
		return { render: () => {}, pause: () => {}, dispose: () => {} };
	}
	const limits = boundedLimits(input.limits);
	const nonce = randomToken();
	const instanceId = randomToken();
	let disposed = false;
	let failed = false;
	let ready = false;
	let initSent = false;
	// The child initializes asynchronously. Keep the size that its canvas has
	// acknowledged so a transport tick during module compilation cannot send a
	// resize before `initialized`, nor render at the obsolete initial size.
	let initializedSurfaceKey: string | null = null;
	let iframe: HTMLIFrameElement | null = null;
	let port: MessagePort | null = null;
	let bitmapContext: ImageBitmapRenderingContext | null | undefined;
	let twoDimensionalContext: CanvasRenderingContext2D | null | undefined;
	let bootstrapTimer: number | undefined;
	let frameTimer: number | undefined;
	let latestFrame: ResolvedFrame | null = null;
	// SVG fallback suppression is permitted only while this exact program input
	// has a parent-consumed bitmap. A viewport-only placement or output-size
	// refresh may retain that bitmap until its replacement arrives; a new logical
	// transport frame immediately returns to the fallback.
	let displayedFrame: ResolvedFrame | null = null;
	let pendingFrame: PendingFrame | null = null;
	let renderSequence = 0;
	let controlSequence = 0;
	let lastStatusKey: string | null = null;

	const trace = (event: ProgramSurfaceProbeHostTraceEvent): void => {
		safeTrace(input.onTrace, event);
	};
	const traceFrame = (
		frame: ResolvedFrame,
	): ProgramSurfaceProbeHostTraceFrame => ({
		assetId: input.probe.assetId,
		nodeId: frame.placement.nodeId,
		frame: frame.frame,
		fps: frame.fps,
		pixelWidth: frame.surface.pixelWidth,
		pixelHeight: frame.surface.pixelHeight,
	});
	const traceDroppedFrame = (
		reason: ProgramSurfaceProbeHostFrameDropReason,
		pending?: PendingFrame,
		sequence?: number,
	): void => {
		trace({
			kind: "frame-dropped",
			assetId: input.probe.assetId,
			reason,
			...(pending ? { request: traceFrame(pending.frame) } : {}),
			...(sequence === undefined ? {} : { sequence }),
		});
	};
	const nodeId = (): string | undefined => latestFrame?.placement.nodeId;
	const emit = (status: ProgramSurfaceHostStatus): void => {
		const key =
			status.kind === "live"
				? `${status.kind}:${status.nodeId}`
				: status.kind === "fallback"
					? `${status.kind}:${status.nodeId ?? ""}:${status.code}`
					: status.kind === "disposed"
						? `${status.kind}:${status.nodeId ?? ""}`
						: status.kind;
		if (key === lastStatusKey) return;
		lastStatusKey = key;
		safeStatus(input.onStatus, status);
	};
	const clearBootstrapTimer = (): void => {
		if (bootstrapTimer === undefined) return;
		window.clearTimeout(bootstrapTimer);
		bootstrapTimer = undefined;
	};
	const clearFrameTimer = (): void => {
		if (frameTimer === undefined) return;
		window.clearTimeout(frameTimer);
		frameTimer = undefined;
	};
	const hideCanvas = (): void => {
		input.canvas.style.visibility = "hidden";
		input.canvas.style.opacity = "0";
		input.canvas.width = 1;
		input.canvas.height = 1;
		displayedFrame = null;
	};
	const clearPendingFrame = (): PendingFrame | null => {
		clearFrameTimer();
		const pending = pendingFrame;
		pendingFrame = null;
		return pending;
	};
	const discardPendingFrame = (
		reason: ProgramSurfaceProbeHostFrameDropReason,
	): PendingFrame | null => {
		const pending = clearPendingFrame();
		if (pending) traceDroppedFrame(reason, pending, pending.sequence);
		return pending;
	};
	const disposeBitmap = (
		bitmap: ImageBitmap,
		reason: ProgramSurfaceProbeHostBitmapDisposalReason,
	): void => {
		let outcome: "closed" | "close-failed" = "closed";
		try {
			bitmap.close();
		} catch {
			outcome = "close-failed";
		}
		trace({
			kind: "resource-disposed",
			assetId: input.probe.assetId,
			resource: "bitmap",
			outcome,
			reason,
		});
	};
	const removeTransport = (reason: "host-failed" | "host-disposed"): void => {
		clearBootstrapTimer();
		discardPendingFrame(reason);
		window.removeEventListener("message", onWindowMessage);
		if (port) {
			let outcome: "closed" | "close-failed" = "closed";
			try {
				port.onmessage = null;
				port.close();
			} catch {
				outcome = "close-failed";
			}
			trace({
				kind: "resource-disposed",
				assetId: input.probe.assetId,
				resource: "message-port",
				outcome,
				reason,
			});
		}
		port = null;
		if (iframe) {
			iframe.remove();
			trace({
				kind: "resource-disposed",
				assetId: input.probe.assetId,
				resource: "iframe",
				outcome: "removed",
				reason,
			});
		}
		iframe = null;
	};
	const fail = (code: ProgramSurfaceHostIssueCode): void => {
		if (disposed || failed) return;
		failed = true;
		ready = false;
		hideCanvas();
		removeTransport("host-failed");
		trace({
			kind: "resource-disposed",
			assetId: input.probe.assetId,
			resource: "host",
			outcome: "disposed",
			reason: "host-failed",
		});
		emit({ kind: "fallback", nodeId: nodeId(), code });
	};
	const post = (message: Record<string, unknown>): boolean => {
		if (!port || disposed || failed) return false;
		try {
			port.postMessage({
				protocol: PROGRAM_SURFACE_PROTOCOL,
				instanceId: instanceId ?? "",
				generation: 1,
				...message,
			});
			return true;
		} catch {
			fail("program-surface.protocol-invalid");
			return false;
		}
	};
	const normalizeFrame = (
		frame: ProgramSurfaceProbeFrame,
	): ResolvedFrame | ProgramSurfaceHostIssueCode => {
		const { placement } = frame;
		if (
			!isNonNegativeInteger(frame.frame) ||
			!isFiniteNumber(frame.fps) ||
			frame.fps <= 0 ||
			!placement.nodeId ||
			!placement.artboardId ||
			!isFiniteMatrix(placement.matrix) ||
			!isFiniteNumber(placement.cssWidth) ||
			placement.cssWidth <= 0 ||
			!isFiniteNumber(placement.cssHeight) ||
			placement.cssHeight <= 0 ||
			!isFiniteNumber(placement.opacity) ||
			placement.opacity < 0 ||
			placement.opacity > 1
		) {
			return "program-surface.frame-invalid";
		}
		const deviceDpr =
			typeof window === "undefined" || !isFiniteNumber(window.devicePixelRatio)
				? 1
				: Math.max(1, window.devicePixelRatio);
		const dpr = Math.min(limits.maxDpr, deviceDpr);
		// CSS applies the full camera/node matrix after rasterization. Allocate
		// against each transformed basis vector so a zoomed or scaled selected
		// surface does not silently become low-resolution, while the manifest cap
		// remains the final memory boundary.
		const xScale = Math.hypot(placement.matrix.a, placement.matrix.b);
		const yScale = Math.hypot(placement.matrix.c, placement.matrix.d);
		const pixelWidth = Math.max(
			1,
			Math.min(
				input.probe.output.maxPixelWidth,
				Math.round(placement.cssWidth * dpr * xScale),
			),
		);
		const pixelHeight = Math.max(
			1,
			Math.min(
				input.probe.output.maxPixelHeight,
				Math.round(placement.cssHeight * dpr * yScale),
			),
		);
		const surface = {
			cssWidth: placement.cssWidth,
			cssHeight: placement.cssHeight,
			pixelWidth,
			pixelHeight,
			dpr,
		};
		return {
			frame: frame.frame,
			fps: frame.fps,
			timeSeconds: frame.frame / frame.fps,
			placement,
			surface,
			surfaceKey: [pixelWidth, pixelHeight, dpr].join(":"),
		};
	};
	const applyPlacement = (frame: ResolvedFrame): void => {
		const { canvas } = input;
		canvas.style.width = `${frame.surface.cssWidth}px`;
		canvas.style.height = `${frame.surface.cssHeight}px`;
		canvas.style.transform = cssMatrix(frame.placement.matrix);
		canvas.style.transformOrigin = "0 0";
		canvas.style.opacity = String(frame.placement.opacity);
	};
	const maybeResize = (frame: ResolvedFrame): void => {
		if (
			!ready ||
			!initSent ||
			initializedSurfaceKey === frame.surfaceKey ||
			failed ||
			disposed
		) {
			return;
		}
		if (
			!post({
				type: "resize",
				sequence: ++controlSequence,
				surface: frame.surface,
			})
		) {
			return;
		}
		initializedSurfaceKey = frame.surfaceKey;
	};
	const sendInit = (frame: ResolvedFrame): void => {
		if (initSent || !port || failed || disposed) return;
		initSent = post({
			type: "init",
			digest: input.probe.digest,
			surface: { ...frame.surface, alphaMode: "premultiplied" },
			initial: {
				frame: frame.frame,
				fps: frame.fps,
				timeSeconds: frame.timeSeconds,
				seed: input.probe.seed,
				scalarPorts: input.probe.scalarPorts,
				colorPorts: input.probe.colorPorts,
			},
		});
		if (initSent) initializedSurfaceKey = frame.surfaceKey;
	};
	const flush = (): void => {
		if (!ready || !latestFrame || pendingFrame || failed || disposed) return;
		// A completed frame is the current output until the parent requests a
		// different transport input or a different raster size. Calling `flush()`
		// after every accepted bitmap is necessary for an update that arrived while
		// one frame was in flight, but it must not turn an unchanged parent clock
		// into an unbounded child render loop. Placement-only changes are applied
		// synchronously by `render()` and do not require another program output.
		if (
			displayedFrame &&
			hasSameProgramSurfaceFrameContent(displayedFrame, latestFrame) &&
			displayedFrame.surfaceKey === latestFrame.surfaceKey
		) {
			return;
		}
		const frame = latestFrame;
		const sequence = ++renderSequence;
		pendingFrame = { sequence, frame };
		if (
			!post({
				type: "render",
				sequence,
				frame: frame.frame,
				fps: frame.fps,
				timeSeconds: frame.timeSeconds,
				seed: input.probe.seed,
				scalarPorts: input.probe.scalarPorts,
				colorPorts: input.probe.colorPorts,
			})
		) {
			return;
		}
		trace({
			kind: "frame-sent",
			request: traceFrame(frame),
			sequence,
		});
		frameTimer = window.setTimeout(() => {
			if (pendingFrame?.sequence === sequence) {
				discardPendingFrame("timeout");
				fail("program-surface.frame-stalled");
			}
		}, limits.frameTimeoutMs);
	};
	const drawBitmap = (bitmap: ImageBitmap): boolean => {
		try {
			// Changing a canvas's backing-store size clears its pixels. Resize only
			// when a matching replacement bitmap has arrived so pan/zoom/resize can
			// retain the last consumed logical frame while the one allowed request is
			// in flight.
			if (
				input.canvas.width !== bitmap.width ||
				input.canvas.height !== bitmap.height
			) {
				input.canvas.width = bitmap.width;
				input.canvas.height = bitmap.height;
			}
			if (bitmapContext === undefined) {
				bitmapContext = input.canvas.getContext("bitmaprenderer");
			}
			if (bitmapContext) {
				bitmapContext.transferFromImageBitmap(bitmap);
				trace({
					kind: "resource-disposed",
					assetId: input.probe.assetId,
					resource: "bitmap",
					outcome: "transferred",
					reason: "accepted",
				});
				return true;
			}
			if (twoDimensionalContext === undefined) {
				twoDimensionalContext = input.canvas.getContext("2d");
			}
			if (!twoDimensionalContext) {
				disposeBitmap(bitmap, "draw-failed");
				return false;
			}
			twoDimensionalContext.clearRect(
				0,
				0,
				input.canvas.width,
				input.canvas.height,
			);
			twoDimensionalContext.drawImage(bitmap, 0, 0);
			disposeBitmap(bitmap, "accepted");
			return true;
		} catch {
			disposeBitmap(bitmap, "draw-failed");
			return false;
		}
	};
	const onPortMessage = (event: MessageEvent): void => {
		const message = event.data;
		if (
			!isRecord(message) ||
			message.protocol !== PROGRAM_SURFACE_PROTOCOL ||
			message.instanceId !== instanceId ||
			message.generation !== 1 ||
			typeof message.type !== "string"
		) {
			fail("program-surface.protocol-invalid");
			return;
		}
		switch (message.type) {
			case "ready": {
				if (
					!initSent ||
					ready ||
					message.digest !== input.probe.digest ||
					message.webgl2 !== true
				) {
					fail("program-surface.protocol-invalid");
					return;
				}
				ready = true;
				clearBootstrapTimer();
				if (latestFrame) maybeResize(latestFrame);
				flush();
				return;
			}
			case "frame": {
				const receivedSequence = isNonNegativeInteger(message.sequence)
					? message.sequence
					: null;
				trace({
					kind: "frame-received",
					assetId: input.probe.assetId,
					sequence: receivedSequence,
				});
				const bitmap = message.bitmap;
				if (
					typeof ImageBitmap === "undefined" ||
					!(bitmap instanceof ImageBitmap)
				) {
					try {
						(bitmap as ImageBitmap | undefined)?.close();
					} catch {
						// A malformed transfer cannot retain a parent-side bitmap.
					}
					const discarded = discardPendingFrame("invalid-bitmap");
					if (!discarded) {
						traceDroppedFrame(
							"invalid-bitmap",
							undefined,
							receivedSequence ?? undefined,
						);
					}
					fail("program-surface.protocol-invalid");
					return;
				}
				if (!pendingFrame || message.sequence !== pendingFrame.sequence) {
					disposeBitmap(bitmap, "unexpected-sequence");
					traceDroppedFrame(
						"unexpected-sequence",
						undefined,
						receivedSequence ?? undefined,
					);
					flush();
					return;
				}
				if (
					!isPositiveInteger(message.width) ||
					!isPositiveInteger(message.height) ||
					bitmap.width !== message.width ||
					bitmap.height !== message.height
				) {
					disposeBitmap(bitmap, "invalid-size");
					discardPendingFrame("invalid-size");
					fail("program-surface.protocol-invalid");
					return;
				}
				const pending = pendingFrame;
				clearPendingFrame();
				if (
					message.width !== pending.frame.surface.pixelWidth ||
					message.height !== pending.frame.surface.pixelHeight
				) {
					disposeBitmap(bitmap, "output-size-mismatch");
					traceDroppedFrame("output-size-mismatch", pending, pending.sequence);
					fail("program-surface.output-size-invalid");
					return;
				}
				if (
					!latestFrame ||
					!hasSameProgramSurfaceFrameContent(latestFrame, pending.frame)
				) {
					disposeBitmap(bitmap, "stale-content");
					traceDroppedFrame("stale-content", pending, pending.sequence);
					hideCanvas();
					emit({
						kind: "fallback",
						nodeId: pending.frame.placement.nodeId,
						code: "program-surface.stale-frame",
					});
					flush();
					return;
				}
				if (!drawBitmap(bitmap)) {
					traceDroppedFrame("draw-failed", pending, pending.sequence);
					fail("program-surface.host-unavailable");
					return;
				}
				displayedFrame = pending.frame;
				// A pan/zoom/rotate/resize may have arrived while this one allowed
				// request was in flight. Keep the new presentation immediately, while
				// `flush()` queues the latest surface size behind the consumed bitmap.
				applyPlacement(latestFrame);
				input.canvas.style.visibility = "visible";
				input.canvas.style.opacity = String(latestFrame.placement.opacity);
				trace({
					kind: "frame-accepted",
					request: traceFrame(pending.frame),
					sequence: pending.sequence,
				});
				emit({
					kind: "live",
					nodeId: pending.frame.placement.nodeId,
					contentKey: programSurfaceFrameContentKey({
						nodeId: pending.frame.placement.nodeId,
						frame: pending.frame.frame,
						fps: pending.frame.fps,
					}),
					sequence: pending.sequence,
				});
				flush();
				return;
			}
			case "diagnostic": {
				if (
					(message.phase !== "bootstrap" &&
						message.phase !== "compile" &&
						message.phase !== "render" &&
						message.phase !== "protocol") ||
					(message.severity !== "warning" && message.severity !== "error") ||
					typeof message.code !== "string"
				) {
					fail("program-surface.protocol-invalid");
					return;
				}
				if (message.severity === "error") {
					fail(
						message.code === "webgl2-unavailable"
							? "program-surface.webgl2-unavailable"
							: message.code === "module-failed"
								? "program-surface.module-failed"
								: "program-surface.protocol-invalid",
					);
				}
				return;
			}
			case "context-lost":
				fail("program-surface.context-lost");
				return;
			case "context-restored":
				// Context restoration invalidates all program-owned resources. The
				// fail-closed recovery path is a fresh iframe, never reuse in place.
				fail("program-surface.context-lost");
				return;
			case "disposed":
				fail("program-surface.module-failed");
				return;
			default:
				fail("program-surface.protocol-invalid");
		}
	};
	const onWindowMessage = (event: MessageEvent): void => {
		const message = event.data;
		if (
			!iframe ||
			event.source !== iframe.contentWindow ||
			!isRecord(message) ||
			message.protocol !== BOOTSTRAP_PROTOCOL ||
			message.type !== "hello" ||
			message.nonce !== nonce
		) {
			return;
		}
		const target = iframe.contentWindow;
		if (!target) {
			fail("program-surface.bootstrap-failed");
			return;
		}
		const channel = new MessageChannel();
		port = channel.port1;
		port.onmessage = onPortMessage;
		port.start?.();
		window.removeEventListener("message", onWindowMessage);
		try {
			target.postMessage(
				{
					protocol: BOOTSTRAP_PROTOCOL,
					type: "connect",
					nonce,
				},
				"*",
				[channel.port2],
			);
		} catch {
			fail("program-surface.bootstrap-failed");
			return;
		}
		if (latestFrame) sendInit(latestFrame);
	};
	if (
		!nonce ||
		!instanceId ||
		typeof window === "undefined" ||
		typeof document === "undefined" ||
		typeof MessageChannel === "undefined" ||
		typeof ImageBitmap === "undefined"
	) {
		hideCanvas();
		emit({ kind: "fallback", code: "program-surface.host-unavailable" });
		return { render: () => {}, pause: () => {}, dispose: () => {} };
	}

	input.canvas.style.position = "absolute";
	input.canvas.style.pointerEvents = "none";
	input.canvas.style.visibility = "hidden";
	window.addEventListener("message", onWindowMessage);
	iframe = document.createElement("iframe");
	iframe.setAttribute("sandbox", PROGRAM_SURFACE_PROBE_IFRAME_SANDBOX);
	iframe.setAttribute("aria-hidden", "true");
	iframe.setAttribute("tabindex", "-1");
	iframe.referrerPolicy = "no-referrer";
	iframe.style.display = "none";
	iframe.srcdoc = bootstrapSrcDoc({
		nonce,
		instanceId,
		generation: 1,
		probe: input.probe,
	});
	input.iframeMount.append(iframe);
	bootstrapTimer = window.setTimeout(() => {
		fail("program-surface.bootstrap-failed");
	}, limits.bootstrapTimeoutMs);
	emit({ kind: "booting" });

	return {
		render: (frame) => {
			if (disposed || failed) return;
			const normalized = normalizeFrame(frame);
			if (typeof normalized === "string") {
				traceDroppedFrame("invalid-request");
				fail(normalized);
				return;
			}
			const priorLatestFrame = latestFrame;
			const pendingSequence = pendingFrame?.sequence;
			trace({
				kind: "frame-requested",
				request: traceFrame(normalized),
			});
			if (pendingSequence !== undefined) {
				trace({
					kind: "frame-coalesced",
					request: traceFrame(normalized),
					reason: "frame-in-flight",
					pendingSequence,
				});
			} else if (!ready && priorLatestFrame) {
				trace({
					kind: "frame-coalesced",
					request: traceFrame(normalized),
					reason: "awaiting-ready",
				});
			}
			latestFrame = normalized;
			if (
				displayedFrame &&
				!hasSameProgramSurfaceFrameContent(displayedFrame, normalized)
			) {
				hideCanvas();
				emit({
					kind: "fallback",
					nodeId: normalized.placement.nodeId,
					code: "program-surface.stale-frame",
				});
			}
			applyPlacement(normalized);
			maybeResize(normalized);
			sendInit(normalized);
			flush();
		},
		pause: () => {
			if (disposed || failed) return;
			// JavaScript work in the iframe cannot be cancelled safely. Removing the
			// isolated transport is the V1 pause boundary: a later visible/remount
			// creates a fresh host rather than allowing a second render in flight.
			fail("program-surface.stale-frame");
		},
		dispose: () => {
			if (disposed) return;
			const finalNodeId = nodeId();
			disposed = true;
			try {
				port?.postMessage({
					protocol: PROGRAM_SURFACE_PROTOCOL,
					instanceId,
					generation: 1,
					type: "dispose",
				});
			} catch {
				// iframe removal below is the authoritative termination path.
			}
			hideCanvas();
			removeTransport("host-disposed");
			trace({
				kind: "resource-disposed",
				assetId: input.probe.assetId,
				resource: "host",
				outcome: "disposed",
				reason: "host-disposed",
			});
			emit({ kind: "disposed", nodeId: finalNodeId });
		},
	};
};
