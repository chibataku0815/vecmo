import { stableJsonStringify } from "@/shared/lib/stable-json";
import {
	AUTOMATION_EASINGS,
	AUTOMATION_TRACK_MODES,
	EFFECT_TARGET_SCOPES,
} from "@/shared/vec-core";
import { cloneMotionDocument } from "./seed-motion";
import type { MotionDocument } from "./types";

export const SERIALIZED_MOTION_DOCUMENT_KIND =
	"vector-motion-author.motion-document" as const;
export const SERIALIZED_MOTION_DOCUMENT_VERSION = 1 as const;
const MOTION_SCHEMA_VERSION = 1 as const;

export type MotionDocumentSerializationIssueCode =
	| "missing-payload"
	| "invalid-json"
	| "invalid-envelope"
	| "unsupported-kind"
	| "unsupported-version"
	| "unsupported-motion-schema"
	| "invalid-document";

export type MotionDocumentSerializationIssue = {
	readonly code: MotionDocumentSerializationIssueCode;
	readonly message: string;
};

export type SerializedMotionDocumentEnvelope = {
	readonly kind: typeof SERIALIZED_MOTION_DOCUMENT_KIND;
	readonly version: typeof SERIALIZED_MOTION_DOCUMENT_VERSION;
	readonly motionSchemaVersion: typeof MOTION_SCHEMA_VERSION;
	readonly savedAt: string;
	readonly document: MotionDocument;
};

export type MotionDocumentDeserializeResult =
	| {
			readonly status: "ok";
			readonly document: MotionDocument;
			readonly issues: readonly MotionDocumentSerializationIssue[];
	  }
	| {
			readonly status: "failed";
			readonly issues: readonly MotionDocumentSerializationIssue[];
	  };

export type MotionDocumentRestoreResult = {
	readonly source: "persisted" | "fallback";
	readonly document: MotionDocument;
	readonly issues: readonly MotionDocumentSerializationIssue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isStringArray = (value: unknown): value is readonly string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

const isOneOf = <T extends string>(
	value: unknown,
	values: readonly T[],
): value is T => typeof value === "string" && values.includes(value as T);

const issue = (
	code: MotionDocumentSerializationIssueCode,
	message: string,
): MotionDocumentSerializationIssue => ({ code, message });

const isKeyframeTrack = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	isRecord(value.target) &&
	typeof value.target.nodeId === "string" &&
	typeof value.target.property === "string" &&
	Array.isArray(value.keyframes);

const isFinitePoint = (value: unknown): boolean =>
	isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isPositionPathTrack = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.nodeId === "string" &&
	Array.isArray(value.keys) &&
	value.keys.every(
		(key) =>
			isRecord(key) &&
			isFiniteNumber(key.frame) &&
			isFinitePoint(key.inTangent) &&
			isFinitePoint(key.outTangent) &&
			isOneOf(key.spatialMode, ["corner", "continuous", "auto"] as const) &&
			(key.roving === undefined || typeof key.roving === "boolean"),
	);

const isSourceOpticsTrackTarget = (value: unknown): boolean => {
	if (
		!isRecord(value) ||
		!isOneOf(value.kind, ["rig", "ray", "binding"] as const) ||
		typeof value.artboardId !== "string" ||
		typeof value.rigId !== "string" ||
		typeof value.parameterId !== "string"
	) {
		return false;
	}
	if (value.kind === "ray") return typeof value.rayId === "string";
	if (value.kind === "binding") return typeof value.bindingId === "string";
	return true;
};

const isSourceOpticsParameterTrack = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	isSourceOpticsTrackTarget(value.target) &&
	Array.isArray(value.keyframes) &&
	value.keyframes.every(
		(keyframe) =>
			isRecord(keyframe) &&
			isFiniteNumber(keyframe.time) &&
			isFiniteNumber(keyframe.value),
	);

const isAnimationClipEditableArtifactProvenance = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.kind === "string" &&
	isStringArray(value.targetIds) &&
	isStringArray(value.channels) &&
	typeof value.description === "string";

const isAnimationClipProvenance = (value: unknown): boolean =>
	isRecord(value) &&
	value.source === "motion-grammar" &&
	typeof value.label === "string" &&
	typeof value.bindingId === "string" &&
	typeof value.techniqueId === "string" &&
	typeof value.techniqueLabel === "string" &&
	isStringArray(value.targetIds) &&
	isStringArray(value.generatedNodeIds) &&
	(value.editableArtifacts === undefined ||
		(Array.isArray(value.editableArtifacts) &&
			value.editableArtifacts.every(
				isAnimationClipEditableArtifactProvenance,
			)));

const isAnimationClip = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.name === "string" &&
	isFiniteNumber(value.startFrame) &&
	isFiniteNumber(value.durationFrames) &&
	Array.isArray(value.trackIds) &&
	value.trackIds.every((id) => typeof id === "string") &&
	(value.provenance === undefined ||
		isAnimationClipProvenance(value.provenance));

const isEffectTargetRef = (value: unknown): boolean =>
	isRecord(value) &&
	isOneOf(value.scope, EFFECT_TARGET_SCOPES) &&
	(value.id === undefined || typeof value.id === "string");

const isEffectSlotRef = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.path === "string" &&
	(value.label === undefined || typeof value.label === "string");

const isAutomationBinding = (value: unknown): boolean => {
	if (!isRecord(value) || typeof value.channel !== "string") return false;
	switch (value.channel) {
		case "effectInfluence":
			return (
				typeof value.assignmentId === "string" && typeof value.path === "string"
			);
		case "effectParam":
			return (
				isEffectTargetRef(value.target) &&
				isEffectSlotRef(value.effect) &&
				typeof value.path === "string"
			);
		case "transform":
			return isEffectTargetRef(value.target) && typeof value.path === "string";
		default:
			return false;
	}
};

const isAutomationKeyframe = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.frame) &&
	isFiniteNumber(value.value) &&
	(value.easing === undefined || isOneOf(value.easing, AUTOMATION_EASINGS));

const isAutomationTrack = (value: unknown): boolean =>
	isRecord(value) &&
	isAutomationBinding(value.binding) &&
	(value.mode === undefined || isOneOf(value.mode, AUTOMATION_TRACK_MODES)) &&
	Array.isArray(value.keyframes) &&
	value.keyframes.every(isAutomationKeyframe);

const isAutomationRecipe = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.enabled === "boolean" &&
	isFiniteNumber(value.fps) &&
	isFiniteNumber(value.durationFrames) &&
	Array.isArray(value.tracks) &&
	value.tracks.every(isAutomationTrack);

/**
 * Runtime guard for persisted motion payloads. Mirroring the scene guard's
 * philosophy, it validates the render-critical track/clip envelope but only
 * shallowly checks keyframe arrays so future keyframe value shapes (number or
 * BezierShape today) stay migration-free across the serialization boundary.
 */
export function isMotionDocument(value: unknown): value is MotionDocument {
	return (
		isRecord(value) &&
		value.schemaVersion === MOTION_SCHEMA_VERSION &&
		isFiniteNumber(value.fps) &&
		isFiniteNumber(value.durationFrames) &&
		Array.isArray(value.tracks) &&
		value.tracks.every(isKeyframeTrack) &&
		(value.positionPaths === undefined ||
			(Array.isArray(value.positionPaths) &&
				value.positionPaths.every(isPositionPathTrack))) &&
		(value.sourceOpticsTracks === undefined ||
			(Array.isArray(value.sourceOpticsTracks) &&
				value.sourceOpticsTracks.every(isSourceOpticsParameterTrack))) &&
		(value.cameraTracks === undefined || Array.isArray(value.cameraTracks)) &&
		// Shallow, like `cameraTracks`: the expression AST is structurally
		// re-validated where it is USED (`createCameraChannelExpressionIndex`), so a
		// single hand-edited expression degrades to "no expression" instead of
		// rejecting a document full of otherwise-good keyframes.
		(value.cameraChannelExpressions === undefined ||
			Array.isArray(value.cameraChannelExpressions)) &&
		(value.productionControlTracks === undefined ||
			Array.isArray(value.productionControlTracks)) &&
		(value.cameraCuts === undefined || Array.isArray(value.cameraCuts)) &&
		Array.isArray(value.clips) &&
		value.clips.every(isAnimationClip) &&
		(value.automation === undefined || isAutomationRecipe(value.automation))
	);
}

/**
 * Builds the versioned envelope around a motion document. The envelope mirrors
 * the scene-document storage envelope so a future unified backend can evolve
 * metadata for both side-cars without touching either domain model.
 */
export function createSerializedMotionDocumentEnvelope(
	document: MotionDocument,
	options: { readonly savedAt?: string } = {},
): SerializedMotionDocumentEnvelope {
	return {
		kind: SERIALIZED_MOTION_DOCUMENT_KIND,
		version: SERIALIZED_MOTION_DOCUMENT_VERSION,
		motionSchemaVersion: MOTION_SCHEMA_VERSION,
		savedAt: options.savedAt ?? new Date().toISOString(),
		document: cloneMotionDocument(document),
	};
}

/** Serializes a motion document into deterministic JSON for durable storage. */
export function serializeMotionDocument(
	document: MotionDocument,
	options: { readonly savedAt?: string } = {},
): string {
	return stableJsonStringify(
		createSerializedMotionDocumentEnvelope(document, options),
	);
}

/**
 * Parses and validates a persisted motion envelope without mutating any store.
 * Callers decide whether to surface issues or fall back to the seed timeline.
 */
export function deserializeMotionDocument(
	serialized: string,
): MotionDocumentDeserializeResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return {
			status: "failed",
			issues: [
				issue("invalid-json", "Persisted motion JSON could not be parsed."),
			],
		};
	}

	if (!isRecord(parsed)) {
		return {
			status: "failed",
			issues: [
				issue(
					"invalid-envelope",
					"Persisted motion envelope must be an object.",
				),
			],
		};
	}

	if (parsed.kind !== SERIALIZED_MOTION_DOCUMENT_KIND) {
		return {
			status: "failed",
			issues: [
				issue(
					"unsupported-kind",
					"Persisted payload is not a motion document.",
				),
			],
		};
	}

	if (parsed.version !== SERIALIZED_MOTION_DOCUMENT_VERSION) {
		return {
			status: "failed",
			issues: [
				issue(
					"unsupported-version",
					"Persisted motion envelope version is not supported.",
				),
			],
		};
	}

	if (parsed.motionSchemaVersion !== MOTION_SCHEMA_VERSION) {
		return {
			status: "failed",
			issues: [
				issue(
					"unsupported-motion-schema",
					"Persisted motion schema version is not supported.",
				),
			],
		};
	}

	if (typeof parsed.savedAt !== "string") {
		return {
			status: "failed",
			issues: [
				issue("invalid-envelope", "Persisted motion savedAt must be a string."),
			],
		};
	}

	if (!isMotionDocument(parsed.document)) {
		return {
			status: "failed",
			issues: [
				issue(
					"invalid-document",
					"Persisted motion document failed runtime validation.",
				),
			],
		};
	}

	return {
		status: "ok",
		document: cloneMotionDocument(parsed.document),
		issues: [],
	};
}

/**
 * Converts a maybe-missing serialized payload into a safe motion document.
 * Invalid or absent payloads never hydrate the timeline; callers get a cloned
 * fallback plus recoverable issues they can surface or ignore.
 */
export function restoreMotionDocumentFromSerialized(
	serialized: string | null | undefined,
	fallback: MotionDocument,
): MotionDocumentRestoreResult {
	if (
		serialized === null ||
		serialized === undefined ||
		serialized.trim() === ""
	) {
		return {
			source: "fallback",
			document: cloneMotionDocument(fallback),
			issues: [
				issue("missing-payload", "No persisted motion payload was found."),
			],
		};
	}

	const result = deserializeMotionDocument(serialized);
	if (result.status === "failed") {
		return {
			source: "fallback",
			document: cloneMotionDocument(fallback),
			issues: result.issues,
		};
	}

	return { source: "persisted", document: result.document, issues: [] };
}
