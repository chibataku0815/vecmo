import type {
	ProgramSurfaceProbeHostTraceEvent,
	ProgramSurfaceProbeHostTraceFrame,
} from "./program-surface-probe-host";

const PROGRAM_SURFACE_HOST_TRACE_QUERY_PARAM = "programSurfaceTrace";
const PROGRAM_SURFACE_HOST_TRACE_ENABLED_VALUE = "1";
const MAX_TRACE_RECORDS = 256;
const MAX_DIAGNOSTIC_ID_LENGTH = 160;

const frameDropReasons = new Set<string>([
	"invalid-request",
	"invalid-bitmap",
	"unexpected-sequence",
	"invalid-size",
	"output-size-mismatch",
	"stale-content",
	"draw-failed",
	"timeout",
	"host-failed",
	"host-disposed",
]);

const bitmapDisposalReasons = new Set<string>([
	"accepted",
	"invalid-bitmap",
	"unexpected-sequence",
	"invalid-size",
	"output-size-mismatch",
	"stale-content",
	"draw-failed",
]);

const transportDisposalReasons = new Set<string>([
	"host-failed",
	"host-disposed",
]);

/**
 * Source-free observation passed from a concrete host mount to a development
 * diagnostic collector. It deliberately excludes the lease's digest and
 * content key so this cannot become an approval or presentation channel.
 */
export type ProgramSurfaceHostTraceObserver = (
	observation: Readonly<{
		mountId: number;
		event: ProgramSurfaceProbeHostTraceEvent;
	}>,
) => void;

export type ProgramSurfaceHostTraceRecord = Readonly<{
	ordinal: number;
	mountId: number;
	event: ProgramSurfaceProbeHostTraceEvent;
}>;

export type ProgramSurfaceHostTraceDiagnostics = Readonly<{
	record: ProgramSurfaceHostTraceObserver;
	reset: () => void;
	snapshot: () => readonly ProgramSurfaceHostTraceRecord[];
}>;

type ProgramSurfaceHostTraceGlobal = Readonly<{
	reset: () => void;
	snapshot: () => readonly ProgramSurfaceHostTraceRecord[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
	isNonNegativeInteger(value) && value > 0;

/**
 * Node and asset ids are useful to correlate host teardown, but only their
 * bounded identifier form is allowed into the diagnostic snapshot. This keeps
 * an accidental source or URL-shaped value out even if a caller violates the
 * typed callback contract at runtime.
 */
const diagnosticId = (value: unknown): string | null =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= MAX_DIAGNOSTIC_ID_LENGTH &&
	/^[A-Za-z0-9._:-]+$/u.test(value)
		? value
		: null;

const projectFrame = (
	value: unknown,
): ProgramSurfaceProbeHostTraceFrame | null => {
	if (!isRecord(value)) return null;
	const assetId = diagnosticId(value.assetId);
	const nodeId = diagnosticId(value.nodeId);
	if (
		assetId === null ||
		nodeId === null ||
		!isNonNegativeInteger(value.frame) ||
		!isPositiveInteger(value.fps) ||
		!isPositiveInteger(value.pixelWidth) ||
		!isPositiveInteger(value.pixelHeight)
	) {
		return null;
	}
	return {
		assetId,
		nodeId,
		frame: value.frame,
		fps: value.fps,
		pixelWidth: value.pixelWidth,
		pixelHeight: value.pixelHeight,
	};
};

/**
 * Re-materializes only the allowlisted trace schema before it reaches a global
 * development inspector. Do not replace this with object spreading: the host
 * callback boundary must not retain future/raw protocol fields by accident.
 */
const projectTraceEvent = (
	value: unknown,
): ProgramSurfaceProbeHostTraceEvent | null => {
	if (!isRecord(value) || typeof value.kind !== "string") return null;
	switch (value.kind) {
		case "frame-requested": {
			const request = projectFrame(value.request);
			return request ? { kind: "frame-requested", request } : null;
		}
		case "frame-coalesced": {
			const request = projectFrame(value.request);
			if (
				!request ||
				(value.reason !== "awaiting-ready" &&
					value.reason !== "frame-in-flight")
			) {
				return null;
			}
			return {
				kind: "frame-coalesced",
				request,
				reason: value.reason,
				...(isNonNegativeInteger(value.pendingSequence)
					? { pendingSequence: value.pendingSequence }
					: {}),
			};
		}
		case "frame-sent": {
			const request = projectFrame(value.request);
			return request && isNonNegativeInteger(value.sequence)
				? { kind: "frame-sent", request, sequence: value.sequence }
				: null;
		}
		case "frame-received": {
			const assetId = diagnosticId(value.assetId);
			return assetId !== null &&
				(value.sequence === null || isNonNegativeInteger(value.sequence))
				? { kind: "frame-received", assetId, sequence: value.sequence }
				: null;
		}
		case "frame-accepted": {
			const request = projectFrame(value.request);
			return request && isNonNegativeInteger(value.sequence)
				? { kind: "frame-accepted", request, sequence: value.sequence }
				: null;
		}
		case "frame-dropped": {
			const assetId = diagnosticId(value.assetId);
			if (assetId === null || !frameDropReasons.has(String(value.reason))) {
				return null;
			}
			const request = projectFrame(value.request);
			return {
				kind: "frame-dropped",
				assetId,
				reason: value.reason as Extract<
					ProgramSurfaceProbeHostTraceEvent,
					{ readonly kind: "frame-dropped" }
				>["reason"],
				...(request ? { request } : {}),
				...(isNonNegativeInteger(value.sequence)
					? { sequence: value.sequence }
					: {}),
			};
		}
		case "resource-disposed": {
			const assetId = diagnosticId(value.assetId);
			if (assetId === null || typeof value.resource !== "string") return null;
			if (
				value.resource === "bitmap" &&
				(value.outcome === "closed" ||
					value.outcome === "close-failed" ||
					value.outcome === "transferred") &&
				bitmapDisposalReasons.has(String(value.reason))
			) {
				return {
					kind: "resource-disposed",
					assetId,
					resource: "bitmap",
					outcome: value.outcome,
					reason: value.reason as Extract<
						ProgramSurfaceProbeHostTraceEvent,
						{
							readonly kind: "resource-disposed";
							readonly resource: "bitmap";
						}
					>["reason"],
				};
			}
			if (
				value.resource === "message-port" &&
				(value.outcome === "closed" || value.outcome === "close-failed") &&
				transportDisposalReasons.has(String(value.reason))
			) {
				return {
					kind: "resource-disposed",
					assetId,
					resource: "message-port",
					outcome: value.outcome,
					reason: value.reason as "host-failed" | "host-disposed",
				};
			}
			if (
				value.resource === "iframe" &&
				value.outcome === "removed" &&
				transportDisposalReasons.has(String(value.reason))
			) {
				return {
					kind: "resource-disposed",
					assetId,
					resource: "iframe",
					outcome: "removed",
					reason: value.reason as "host-failed" | "host-disposed",
				};
			}
			if (
				value.resource === "host" &&
				value.outcome === "disposed" &&
				transportDisposalReasons.has(String(value.reason))
			) {
				return {
					kind: "resource-disposed",
					assetId,
					resource: "host",
					outcome: "disposed",
					reason: value.reason as "host-failed" | "host-disposed",
				};
			}
			return null;
		}
		default:
			return null;
	}
};

const copyRecord = (
	record: ProgramSurfaceHostTraceRecord,
): ProgramSurfaceHostTraceRecord | null => {
	const event = projectTraceEvent(record.event);
	return event
		? { ordinal: record.ordinal, mountId: record.mountId, event }
		: null;
};

/**
 * Creates a bounded, in-memory collector for a single CanvasShell instance.
 * The caller must still opt in and install the source-free read controls; this
 * object itself has no global side effect and cannot affect host liveness.
 */
export function createProgramSurfaceHostTraceDiagnostics(): ProgramSurfaceHostTraceDiagnostics {
	const records: ProgramSurfaceHostTraceRecord[] = [];
	let ordinal = 0;

	return {
		record: ({ mountId, event }) => {
			if (!isPositiveInteger(mountId)) return;
			const projected = projectTraceEvent(event);
			if (!projected) return;
			ordinal += 1;
			records.push({ ordinal, mountId, event: projected });
			if (records.length > MAX_TRACE_RECORDS) records.shift();
		},
		reset: () => {
			records.length = 0;
			ordinal = 0;
		},
		snapshot: () => {
			const snapshot: ProgramSurfaceHostTraceRecord[] = [];
			for (const record of records) {
				const copy = copyRecord(record);
				if (copy) snapshot.push(copy);
			}
			return snapshot;
		},
	};
}

/**
 * Development-only, explicit URL opt-in. Production builds never install the
 * reader, and ordinary development sessions do not incur trace collection.
 */
export function isProgramSurfaceHostTraceDiagnosticsEnabled(): boolean {
	if (!import.meta.env.DEV || typeof window === "undefined") return false;
	return (
		new URLSearchParams(window.location.search).get(
			PROGRAM_SURFACE_HOST_TRACE_QUERY_PARAM,
		) === PROGRAM_SURFACE_HOST_TRACE_ENABLED_VALUE
	);
}

/**
 * Exposes only reset/snapshot controls for an already-created collector. The
 * event sink remains private to CanvasShell, so browser automation can observe
 * evidence but cannot inject host events or executable package data.
 */
export function installProgramSurfaceHostTraceDiagnostics(
	diagnostics: ProgramSurfaceHostTraceDiagnostics,
): () => void {
	if (!import.meta.env.DEV) return () => {};
	const host = globalThis as typeof globalThis & {
		__vmaProgramSurfaceHostTrace?: ProgramSurfaceHostTraceGlobal;
	};
	const controls: ProgramSurfaceHostTraceGlobal = {
		reset: diagnostics.reset,
		snapshot: diagnostics.snapshot,
	};
	host.__vmaProgramSurfaceHostTrace = controls;
	return () => {
		if (host.__vmaProgramSurfaceHostTrace === controls) {
			delete host.__vmaProgramSurfaceHostTrace;
		}
	};
}
