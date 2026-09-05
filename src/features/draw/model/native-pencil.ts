import type { Vec2 } from "@/entities/scene/model/types";
import type { PencilIntentSample } from "@/shared/stroke/pencil-intent";
import type { FreehandPoint } from "./freehand";

export type NativePencilSample = {
	readonly x: number;
	readonly y: number;
	readonly force: number;
	readonly altitudeAngle: number;
	readonly azimuthAngle: number;
	readonly rollAngle?: number | null;
	readonly timestamp: number;
	readonly estimatedProperties: number;
	readonly estimationUpdateIndex?: number | null;
};

export type NativePencilStrokePhase =
	| "began"
	| "changed"
	| "ended"
	| "cancelled"
	| "estimated-properties-updated";

export type NativePencilStrokeMessage = {
	readonly kind: "native-pencil-stroke";
	readonly strokeId: string;
	readonly phase: NativePencilStrokePhase;
	readonly samples: readonly NativePencilSample[];
	readonly predictedSamples: readonly NativePencilSample[];
	readonly source: "ios-wet-ink-overlay";
};

export type NativePencilSqueezeMessage = {
	readonly kind: "native-pencil-squeeze";
	readonly phase: string;
	readonly preferredAction: string;
	readonly hoverPose?: {
		readonly x: number;
		readonly y: number;
		readonly zOffset?: number | null;
		readonly altitudeAngle?: number | null;
		readonly azimuthAngle?: number | null;
		readonly rollAngle?: number | null;
	} | null;
};

export type NativePencilDoubleTapMessage = {
	readonly kind: "native-pencil-double-tap";
	readonly preferredAction: string;
	readonly hoverPose?: NativePencilSqueezeMessage["hoverPose"];
};

export const NATIVE_PENCIL_FINALIZE_DELAY_MS = 80;

const DEFAULT_STALE_SESSION_MS = 10_000;
const NATIVE_PENCIL_PRESSURE_FLOOR = 0.24;

type NativePencilStrokeSession = {
	readonly strokeId: string;
	phase: NativePencilStrokePhase;
	samples: NativePencilSample[];
	updatedAtMs: number;
	endedAtMs: number | null;
};

export type NativePencilStrokeSessionUpdate =
	| {
			readonly kind: "pending";
			readonly strokeId: string;
			readonly sampleCount: number;
	  }
	| {
			readonly kind: "finalizing";
			readonly strokeId: string;
			readonly sampleCount: number;
			readonly delayMs: number;
	  }
	| {
			readonly kind: "cancelled";
			readonly strokeId: string;
	  }
	| {
			readonly kind: "ignored";
			readonly strokeId?: string;
			readonly reason:
				| "empty-stroke-id"
				| "empty-final-stroke"
				| "unknown-stroke";
	  };

export type FinalizedNativePencilStroke = {
	readonly strokeId: string;
	readonly samples: readonly NativePencilSample[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isOptionalFiniteNumber = (
	value: unknown,
): value is number | null | undefined =>
	value === undefined || value === null || isFiniteNumber(value);

const isNativePencilSample = (value: unknown): value is NativePencilSample => {
	if (!isRecord(value)) return false;
	return (
		isFiniteNumber(value.x) &&
		isFiniteNumber(value.y) &&
		isFiniteNumber(value.force) &&
		isFiniteNumber(value.altitudeAngle) &&
		isFiniteNumber(value.azimuthAngle) &&
		isOptionalFiniteNumber(value.rollAngle) &&
		isFiniteNumber(value.timestamp) &&
		isFiniteNumber(value.estimatedProperties) &&
		isOptionalFiniteNumber(value.estimationUpdateIndex)
	);
};

const isNativePencilStrokePhase = (
	value: unknown,
): value is NativePencilStrokePhase =>
	value === "began" ||
	value === "changed" ||
	value === "ended" ||
	value === "cancelled" ||
	value === "estimated-properties-updated";

export function isNativePencilStrokeMessage(
	value: unknown,
): value is NativePencilStrokeMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-pencil-stroke" &&
		typeof value.strokeId === "string" &&
		isNativePencilStrokePhase(value.phase) &&
		Array.isArray(value.samples) &&
		value.samples.every(isNativePencilSample) &&
		Array.isArray(value.predictedSamples) &&
		value.predictedSamples.every(isNativePencilSample) &&
		value.source === "ios-wet-ink-overlay"
	);
}

export function isNativePencilSqueezeMessage(
	value: unknown,
): value is NativePencilSqueezeMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-pencil-squeeze" &&
		typeof value.phase === "string" &&
		typeof value.preferredAction === "string" &&
		(value.hoverPose === undefined ||
			value.hoverPose === null ||
			(isRecord(value.hoverPose) &&
				isFiniteNumber(value.hoverPose.x) &&
				isFiniteNumber(value.hoverPose.y) &&
				isOptionalFiniteNumber(value.hoverPose.zOffset) &&
				isOptionalFiniteNumber(value.hoverPose.altitudeAngle) &&
				isOptionalFiniteNumber(value.hoverPose.azimuthAngle) &&
				isOptionalFiniteNumber(value.hoverPose.rollAngle)))
	);
}

export function isNativePencilDoubleTapMessage(
	value: unknown,
): value is NativePencilDoubleTapMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-pencil-double-tap" &&
		typeof value.preferredAction === "string" &&
		(value.hoverPose === undefined ||
			value.hoverPose === null ||
			(isRecord(value.hoverPose) &&
				isFiniteNumber(value.hoverPose.x) &&
				isFiniteNumber(value.hoverPose.y) &&
				isOptionalFiniteNumber(value.hoverPose.zOffset) &&
				isOptionalFiniteNumber(value.hoverPose.altitudeAngle) &&
				isOptionalFiniteNumber(value.hoverPose.azimuthAngle) &&
				isOptionalFiniteNumber(value.hoverPose.rollAngle)))
	);
}

const estimationIndex = (sample: NativePencilSample): number | null =>
	typeof sample.estimationUpdateIndex === "number"
		? sample.estimationUpdateIndex
		: null;

const sameSamplePosition = (
	left: NativePencilSample,
	right: NativePencilSample,
): boolean =>
	left.timestamp === right.timestamp &&
	left.x === right.x &&
	left.y === right.y;

const mergeEstimatedSamples = (
	current: readonly NativePencilSample[],
	incoming: readonly NativePencilSample[],
): NativePencilSample[] => {
	if (incoming.length === 0) return [...current];
	if (current.length === 0 || incoming.length >= current.length) {
		return [...incoming];
	}

	const next = [...current];
	const positionsByEstimationIndex = new Map<number, number>();
	for (const [index, sample] of next.entries()) {
		const updateIndex = estimationIndex(sample);
		if (updateIndex !== null)
			positionsByEstimationIndex.set(updateIndex, index);
	}

	for (const sample of incoming) {
		const updateIndex = estimationIndex(sample);
		const existingIndex =
			updateIndex === null
				? undefined
				: positionsByEstimationIndex.get(updateIndex);
		if (existingIndex !== undefined) {
			next[existingIndex] = sample;
			continue;
		}
		if (next.some((candidate) => sameSamplePosition(candidate, sample)))
			continue;
		next.push(sample);
	}
	return next;
};

const reconcileNativeSamples = (
	current: readonly NativePencilSample[],
	incoming: readonly NativePencilSample[],
	phase: NativePencilStrokePhase,
): NativePencilSample[] => {
	if (phase === "estimated-properties-updated") {
		return mergeEstimatedSamples(current, incoming);
	}
	return incoming.length > 0 ? [...incoming] : [...current];
};

/**
 * Tracks native iPad Pencil stroke messages as a small session protocol. UIKit
 * may send estimated-property updates after the first sample snapshot, so the
 * web adapter waits briefly after `ended` and finalizes the latest merged sample
 * list instead of committing the first terminal payload blindly.
 */
export function createNativePencilStrokeSessionStore({
	finalizeDelayMs = NATIVE_PENCIL_FINALIZE_DELAY_MS,
	staleSessionMs = DEFAULT_STALE_SESSION_MS,
}: {
	readonly finalizeDelayMs?: number;
	readonly staleSessionMs?: number;
} = {}) {
	const sessions = new Map<string, NativePencilStrokeSession>();

	const prune = (nowMs: number) => {
		for (const [strokeId, session] of sessions) {
			if (nowMs - session.updatedAtMs > staleSessionMs) {
				sessions.delete(strokeId);
			}
		}
	};

	return {
		apply(
			message: NativePencilStrokeMessage,
			nowMs = Date.now(),
		): NativePencilStrokeSessionUpdate {
			prune(nowMs);
			if (message.strokeId.length === 0) {
				return { kind: "ignored", reason: "empty-stroke-id" };
			}
			if (message.phase === "cancelled") {
				sessions.delete(message.strokeId);
				return { kind: "cancelled", strokeId: message.strokeId };
			}

			let session = sessions.get(message.strokeId);
			if (!session && message.phase === "estimated-properties-updated") {
				return {
					kind: "ignored",
					strokeId: message.strokeId,
					reason: "unknown-stroke",
				};
			}
			if (!session || message.phase === "began") {
				session = {
					strokeId: message.strokeId,
					phase: message.phase,
					samples: [],
					updatedAtMs: nowMs,
					endedAtMs: null,
				};
				sessions.set(message.strokeId, session);
			}

			session.samples = reconcileNativeSamples(
				session.samples,
				message.samples,
				message.phase,
			);
			session.phase = message.phase;
			session.updatedAtMs = nowMs;

			if (message.phase === "ended") {
				if (session.samples.length === 0) {
					sessions.delete(message.strokeId);
					return {
						kind: "ignored",
						strokeId: message.strokeId,
						reason: "empty-final-stroke",
					};
				}
				session.endedAtMs = nowMs;
				return {
					kind: "finalizing",
					strokeId: message.strokeId,
					sampleCount: session.samples.length,
					delayMs: finalizeDelayMs,
				};
			}

			return {
				kind: "pending",
				strokeId: message.strokeId,
				sampleCount: session.samples.length,
			};
		},
		finalize(strokeId: string): FinalizedNativePencilStroke | null {
			const session = sessions.get(strokeId);
			if (!session || session.endedAtMs === null) return null;
			sessions.delete(strokeId);
			return {
				strokeId,
				samples: [...session.samples],
			};
		},
		cancel(strokeId: string) {
			sessions.delete(strokeId);
		},
		has(strokeId: string): boolean {
			return sessions.has(strokeId);
		},
		clear() {
			sessions.clear();
		},
	};
}

/**
 * Maps UIKit Pencil force, already normalized by `maximumPossibleForce`, into
 * the width-profile pressure domain used by the shared freehand pipeline.
 * The square-root curve keeps ordinary writing pressure visible while still
 * preserving harder presses as wider profile stops. This curve is mirrored by
 * the native wet-ink overlay so the live stroke does not jump on commit.
 */
export function nativePencilForceToPressure(force: number): number {
	const clampedForce = Number.isFinite(force)
		? Math.min(Math.max(force, 0), 1)
		: 0;
	return Math.max(NATIVE_PENCIL_PRESSURE_FLOOR, Math.sqrt(clampedForce));
}

/**
 * Converts native overlay-space Pencil samples into artboard-local freehand
 * points while preserving pressure for the shared freehand width profile
 * pipeline.
 */
export function nativeSamplesToFreehandPoints(
	samples: readonly NativePencilSample[],
	project: (sample: NativePencilSample) => Vec2,
): readonly FreehandPoint[] {
	return samples.map((sample) => ({
		...project(sample),
		pressure: nativePencilForceToPressure(sample.force),
	}));
}

/** UITouch.timestamp is seconds since boot; the intent layer works in milliseconds. */
const NATIVE_TIMESTAMP_TO_MS = 1000;
/** UITouch.altitudeAngle is measured from the surface; tilt is stored from vertical. */
const PERPENDICULAR_RAD = Math.PI / 2;

/**
 * Converts native overlay-space Pencil samples into normalized
 * {@link PencilIntentSample}s for the stroke-intent analysis layer, preserving
 * the timing, tilt, azimuth, and roll that {@link nativeSamplesToFreehandPoints}
 * (which needs only position + pressure) drops.
 *
 * `timestamp` is converted from UITouch seconds into milliseconds so native and
 * browser strokes share one time base; tilt is stored as the angle from vertical
 * (`π/2 − altitude`) so a perpendicular pen reads ~0; `rollAngle` stays null on
 * pre-Pencil-Pro hardware that never reports it.
 */
export function nativeSamplesToIntentSamples(
	samples: readonly NativePencilSample[],
	project: (sample: NativePencilSample) => Vec2,
): readonly PencilIntentSample[] {
	return samples.map((sample) => {
		const point = project(sample);
		return {
			x: point.x,
			y: point.y,
			tMs: sample.timestamp * NATIVE_TIMESTAMP_TO_MS,
			pressure: nativePencilForceToPressure(sample.force),
			tiltRad: PERPENDICULAR_RAD - sample.altitudeAngle,
			azimuthRad: sample.azimuthAngle,
			rollRad: typeof sample.rollAngle === "number" ? sample.rollAngle : null,
		};
	});
}
