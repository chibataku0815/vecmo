import { isAeShape } from "@/shared/glammer/ae-shape";
import { cloneSceneDocument } from "./factory";
import { normalizeSceneDocumentVectorRecipes } from "./recipe-compatibility";
import { pruneSceneDocumentScopedLookTargets } from "./scoped-look-prune";
import { normalizeSceneDocumentPathStrokeDefaults } from "./stroke-compatibility";
import {
	type Artboard,
	type Bounds,
	type NodeGeometry,
	type NodeStyle,
	SCENE_SCHEMA_VERSION,
	type SceneDocument,
	type SceneLayer,
	type Transform,
	type Vec2,
	type VectorNode,
} from "./types";

export const SERIALIZED_SCENE_DOCUMENT_KIND =
	"vector-motion-author.scene-document" as const;
export const SERIALIZED_SCENE_DOCUMENT_VERSION = 2 as const;
/**
 * Prior envelope version, still accepted on read. v1 envelopes predate the
 * canvas renderer honoring path-kind `strokeCap`/`strokeJoin`: their path
 * nodes were authored and visually approved against the renderer's old
 * hardcoded round look, so loading a v1 envelope runs the round backfill
 * ({@link normalizeSceneDocumentPathStrokeDefaults}) to preserve it. v2+
 * envelopes are written by a renderer that already paints the authored
 * value, so an undefined `strokeCap`/`strokeJoin` on those documents
 * legitimately means butt/miter and must not mutate across save/reload.
 */
const LEGACY_SERIALIZED_SCENE_DOCUMENT_VERSION = 1 as const;

export type SceneDocumentSerializationIssueCode =
	| "missing-payload"
	| "invalid-json"
	| "invalid-envelope"
	| "unsupported-kind"
	| "unsupported-version"
	| "unsupported-scene-schema"
	| "invalid-document";

export type SceneDocumentSerializationIssue = {
	readonly code: SceneDocumentSerializationIssueCode;
	readonly message: string;
};

export type SerializedSceneDocumentEnvelope = {
	readonly kind: typeof SERIALIZED_SCENE_DOCUMENT_KIND;
	readonly version: typeof SERIALIZED_SCENE_DOCUMENT_VERSION;
	readonly sceneSchemaVersion: typeof SCENE_SCHEMA_VERSION;
	readonly savedAt: string;
	readonly document: SceneDocument;
};

export type SceneDocumentDeserializeResult =
	| {
			readonly status: "ok";
			readonly envelope: SerializedSceneDocumentEnvelope;
			readonly document: SceneDocument;
			readonly issues: readonly SceneDocumentSerializationIssue[];
	  }
	| {
			readonly status: "failed";
			readonly issues: readonly SceneDocumentSerializationIssue[];
	  };

export type SceneDocumentRestoreResult = {
	readonly source: "persisted" | "fallback";
	readonly document: SceneDocument;
	readonly issues: readonly SceneDocumentSerializationIssue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const issue = (
	code: SceneDocumentSerializationIssueCode,
	message: string,
): SceneDocumentSerializationIssue => ({ code, message });

const invalidAt = (path: string, expected: string): string =>
	`${path} must be ${expected}.`;

const isVec2 = (value: unknown): value is Vec2 =>
	isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isBounds = (value: unknown): value is Bounds =>
	isRecord(value) &&
	isFiniteNumber(value.x) &&
	isFiniteNumber(value.y) &&
	isFiniteNumber(value.width) &&
	isFiniteNumber(value.height);

const isTransform = (value: unknown): value is Transform =>
	isRecord(value) &&
	isVec2(value.position) &&
	isFiniteNumber(value.rotation) &&
	isVec2(value.scale) &&
	isVec2(value.anchor) &&
	value.presentationMatrix === undefined;

const isAffineMatrix2D = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.a) &&
	isFiniteNumber(value.b) &&
	isFiniteNumber(value.c) &&
	isFiniteNumber(value.d) &&
	isFiniteNumber(value.e) &&
	isFiniteNumber(value.f);

const isMotionParentBinding = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.parentNodeId === "string" &&
	value.parentNodeId.trim().length > 0 &&
	isAffineMatrix2D(value.bindMatrix);

const TRANSFORM_CONSTRAINT_CHANNELS = new Set([
	"position",
	"rotation",
	"scale",
]);
const CONSTRAINT_SPACES = new Set(["local", "world"]);
const RELATION_NUMERIC_PROPERTIES = new Set([
	"style.opacity",
	"geometry.cornerRadius",
	"geometry.cornerSmoothing",
]);

const isTransformConstraint = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.sourceNodeId === "string" &&
	Array.isArray(value.channels) &&
	value.channels.length > 0 &&
	value.channels.every(
		(channel) =>
			typeof channel === "string" && TRANSFORM_CONSTRAINT_CHANNELS.has(channel),
	) &&
	isFiniteNumber(value.strength) &&
	value.strength >= 0 &&
	value.strength <= 1 &&
	typeof value.sourceSpace === "string" &&
	CONSTRAINT_SPACES.has(value.sourceSpace) &&
	typeof value.destinationSpace === "string" &&
	CONSTRAINT_SPACES.has(value.destinationSpace) &&
	typeof value.maintainOffset === "boolean" &&
	(value.offset === undefined ||
		(isRecord(value.offset) &&
			(value.offset.position === undefined || isVec2(value.offset.position)) &&
			(value.offset.rotation === undefined ||
				isFiniteNumber(value.offset.rotation)) &&
			(value.offset.scale === undefined || isVec2(value.offset.scale))));

const isPropertyRelation = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.sourceNodeId === "string" &&
	typeof value.sourceProperty === "string" &&
	RELATION_NUMERIC_PROPERTIES.has(value.sourceProperty) &&
	typeof value.targetProperty === "string" &&
	RELATION_NUMERIC_PROPERTIES.has(value.targetProperty) &&
	isFiniteNumber(value.scale) &&
	isFiniteNumber(value.offset) &&
	(value.clamp === undefined ||
		(isRecord(value.clamp) &&
			isFiniteNumber(value.clamp.min) &&
			isFiniteNumber(value.clamp.max) &&
			value.clamp.min <= value.clamp.max));

const isMotionController = (value: unknown): boolean =>
	isRecord(value) &&
	value.kind === "motion-controller" &&
	(value.handleRadius === undefined ||
		(isFiniteNumber(value.handleRadius) && value.handleRadius > 0));

const isNodeStyle = (value: unknown): value is NodeStyle =>
	isRecord(value) &&
	typeof value.fill === "string" &&
	typeof value.stroke === "string" &&
	isFiniteNumber(value.strokeWidth) &&
	isFiniteNumber(value.opacity);

const isPointTuple = (value: unknown): value is readonly [number, number] =>
	Array.isArray(value) &&
	value.length === 2 &&
	isFiniteNumber(value[0]) &&
	isFiniteNumber(value[1]);

const isAeShapePayload = (value: unknown): boolean =>
	isAeShape(value) &&
	typeof value.closed === "boolean" &&
	value.vertices.every(isPointTuple) &&
	value.inTangents.every(isPointTuple) &&
	value.outTangents.every(isPointTuple) &&
	value.vertices.length === value.inTangents.length &&
	value.vertices.length === value.outTangents.length;

const isCornerRadii = (value: unknown): boolean =>
	isRecord(value) &&
	isFiniteNumber(value.tl) &&
	isFiniteNumber(value.tr) &&
	isFiniteNumber(value.br) &&
	isFiniteNumber(value.bl);

const isOptionalFiniteNumber = (value: unknown): boolean =>
	value === undefined || isFiniteNumber(value);

const isNodeGeometry = (value: unknown): value is NodeGeometry => {
	if (!isRecord(value) || typeof value.kind !== "string") return false;

	switch (value.kind) {
		case "rect":
			return (
				isBounds(value.bounds) &&
				isFiniteNumber(value.cornerRadius) &&
				(value.cornerRadii === undefined || isCornerRadii(value.cornerRadii)) &&
				isOptionalFiniteNumber(value.cornerSmoothing)
			);
		case "ellipse":
			return isBounds(value.bounds);
		case "line":
			return isVec2(value.start) && isVec2(value.end);
		case "polygon":
			return (
				Array.isArray(value.points) &&
				value.points.every((point) => isVec2(point)) &&
				isOptionalFiniteNumber(value.cornerRadius) &&
				isOptionalFiniteNumber(value.cornerSmoothing)
			);
		case "star":
			return (
				isVec2(value.center) &&
				isFiniteNumber(value.points) &&
				isFiniteNumber(value.innerRadius) &&
				isFiniteNumber(value.outerRadius) &&
				isOptionalFiniteNumber(value.cornerRadius) &&
				isOptionalFiniteNumber(value.cornerSmoothing)
			);
		case "path":
			return isAeShapePayload(value.shape);
		case "text":
			return isBounds(value.bounds) && typeof value.text === "string";
		case "image":
			return isBounds(value.bounds) && typeof value.assetId === "string";
		default:
			return false;
	}
};

const isVectorNode = (value: unknown): value is VectorNode => {
	if (!isRecord(value)) return false;
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		(value.artboardId !== undefined && typeof value.artboardId !== "string") ||
		!isNodeGeometry(value.geometry) ||
		!isTransform(value.transform) ||
		!isNodeStyle(value.style) ||
		typeof value.visible !== "boolean" ||
		typeof value.locked !== "boolean" ||
		(value.motionParent !== undefined &&
			!isMotionParentBinding(value.motionParent)) ||
		(value.transformConstraint !== undefined &&
			!isTransformConstraint(value.transformConstraint)) ||
		(value.propertyRelations !== undefined &&
			(!Array.isArray(value.propertyRelations) ||
				!value.propertyRelations.every(isPropertyRelation))) ||
		(value.motionController !== undefined &&
			!isMotionController(value.motionController))
	) {
		return false;
	}

	if (value.children === undefined) return true;
	return (
		Array.isArray(value.children) &&
		value.children.every((child) => isVectorNode(child))
	);
};

const isSceneLayer = (value: unknown): value is SceneLayer =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.name === "string" &&
	typeof value.visible === "boolean" &&
	typeof value.locked === "boolean" &&
	Array.isArray(value.nodes) &&
	value.nodes.every((node) => isVectorNode(node));

const isArtboardRole = (value: unknown): boolean =>
	value === "scene" ||
	value === "asset-board" ||
	value === "scratch" ||
	value === "reference";

const isArtboard = (value: unknown): value is Artboard =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.name === "string" &&
	(value.role === undefined || isArtboardRole(value.role)) &&
	(value.position === undefined || isVec2(value.position)) &&
	isFiniteNumber(value.width) &&
	isFiniteNumber(value.height) &&
	typeof value.background === "string" &&
	isFiniteNumber(value.fps) &&
	isFiniteNumber(value.durationFrames);

const isSceneSequenceItem = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.artboardId === "string" &&
	(value.label === undefined || typeof value.label === "string") &&
	(value.durationFrames === undefined ||
		isFiniteNumber(value.durationFrames)) &&
	(value.transition === undefined || isRecord(value.transition));

const isSceneSequence = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.name === "string" &&
	(value.fps === undefined || isFiniteNumber(value.fps)) &&
	(value.exportSize === undefined ||
		(isRecord(value.exportSize) &&
			isFiniteNumber(value.exportSize.width) &&
			isFiniteNumber(value.exportSize.height))) &&
	Array.isArray(value.items) &&
	value.items.every((item) => isSceneSequenceItem(item));

/**
 * Runtime guard for persisted scene payloads before they hydrate the editor.
 * This intentionally validates the render-critical graph and only shallowly
 * checks additive libraries so future optional fields can remain migration-free.
 */
export function isSceneDocument(value: unknown): value is SceneDocument {
	return (
		isRecord(value) &&
		value.schemaVersion === SCENE_SCHEMA_VERSION &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		isArtboard(value.artboard) &&
		(value.artboards === undefined ||
			(Array.isArray(value.artboards) && value.artboards.every(isArtboard))) &&
		(value.currentArtboardId === undefined ||
			typeof value.currentArtboardId === "string") &&
		(value.sequence === undefined || isSceneSequence(value.sequence)) &&
		Array.isArray(value.layers) &&
		value.layers.every((layer) => isSceneLayer(layer)) &&
		(value.stylePresets === undefined || Array.isArray(value.stylePresets)) &&
		(value.componentSymbols === undefined ||
			Array.isArray(value.componentSymbols)) &&
		(value.assets === undefined || Array.isArray(value.assets)) &&
		(value.sceneCameras === undefined || Array.isArray(value.sceneCameras)) &&
		(value.componentProps === undefined ||
			Array.isArray(value.componentProps)) &&
		(value.interactions === undefined || Array.isArray(value.interactions)) &&
		(value.audioTracks === undefined || Array.isArray(value.audioTracks))
	);
}

const canonicalize = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;

	const output: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		const next = value[key];
		if (next !== undefined) output[key] = canonicalize(next);
	}
	return output;
};

const stableJsonStringify = (value: unknown): string => {
	const serialized = JSON.stringify(canonicalize(value), null, 2);
	return `${serialized ?? "null"}\n`;
};

/**
 * Creates the versioned local-persistence envelope around a scene document.
 * The envelope is separate from `SceneDocument.schemaVersion` so future storage
 * backends can evolve metadata without changing the scene model itself.
 */
export function createSerializedSceneDocumentEnvelope(
	document: SceneDocument,
	options: { readonly savedAt?: string } = {},
): SerializedSceneDocumentEnvelope {
	return {
		kind: SERIALIZED_SCENE_DOCUMENT_KIND,
		version: SERIALIZED_SCENE_DOCUMENT_VERSION,
		sceneSchemaVersion: SCENE_SCHEMA_VERSION,
		savedAt: options.savedAt ?? new Date().toISOString(),
		document: cloneSceneDocument(document),
	};
}

/**
 * Serializes a scene document into deterministic JSON for client-side durable
 * storage. Undefined optional fields are omitted so local persistence matches
 * the export JSON convention while still carrying storage kind/version metadata.
 */
export function serializeSceneDocument(
	document: SceneDocument,
	options: { readonly savedAt?: string } = {},
): string {
	return stableJsonStringify(
		createSerializedSceneDocumentEnvelope(document, options),
	);
}

/**
 * Parses and validates a persisted scene envelope without mutating editor state.
 * Callers decide whether to surface issues, clear storage, or use a seed
 * fallback; this helper only returns the typed result.
 */
export function deserializeSceneDocument(
	serialized: string,
): SceneDocumentDeserializeResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return {
			status: "failed",
			issues: [
				issue("invalid-json", "Persisted scene JSON could not be parsed."),
			],
		};
	}

	if (!isRecord(parsed)) {
		return {
			status: "failed",
			issues: [
				issue(
					"invalid-envelope",
					invalidAt("Persisted scene envelope", "an object"),
				),
			],
		};
	}

	if (parsed.kind !== SERIALIZED_SCENE_DOCUMENT_KIND) {
		return {
			status: "failed",
			issues: [
				issue("unsupported-kind", "Persisted payload is not a scene document."),
			],
		};
	}

	const envelopeVersion = parsed.version;
	if (
		envelopeVersion !== SERIALIZED_SCENE_DOCUMENT_VERSION &&
		envelopeVersion !== LEGACY_SERIALIZED_SCENE_DOCUMENT_VERSION
	) {
		return {
			status: "failed",
			issues: [
				issue(
					"unsupported-version",
					"Persisted scene envelope version is not supported.",
				),
			],
		};
	}
	const isLegacyEnvelope =
		envelopeVersion === LEGACY_SERIALIZED_SCENE_DOCUMENT_VERSION;

	if (parsed.sceneSchemaVersion !== SCENE_SCHEMA_VERSION) {
		return {
			status: "failed",
			issues: [
				issue(
					"unsupported-scene-schema",
					"Persisted scene schema version is not supported.",
				),
			],
		};
	}

	if (typeof parsed.savedAt !== "string") {
		return {
			status: "failed",
			issues: [
				issue("invalid-envelope", invalidAt("Persisted savedAt", "a string")),
			],
		};
	}

	if (!isSceneDocument(parsed.document)) {
		return {
			status: "failed",
			issues: [
				issue(
					"invalid-document",
					"Persisted scene document failed runtime validation.",
				),
			],
		};
	}

	const baseNormalizedDocument = pruneSceneDocumentScopedLookTargets(
		normalizeSceneDocumentVectorRecipes(parsed.document),
	);
	const normalizedDocument = isLegacyEnvelope
		? normalizeSceneDocumentPathStrokeDefaults(baseNormalizedDocument)
		: baseNormalizedDocument;
	const envelope: SerializedSceneDocumentEnvelope = {
		kind: SERIALIZED_SCENE_DOCUMENT_KIND,
		version: SERIALIZED_SCENE_DOCUMENT_VERSION,
		sceneSchemaVersion: SCENE_SCHEMA_VERSION,
		savedAt: parsed.savedAt,
		document: cloneSceneDocument(normalizedDocument),
	};
	return {
		status: "ok",
		envelope,
		document: cloneSceneDocument(envelope.document),
		issues: [],
	};
}

/**
 * Converts a maybe-missing serialized payload into a safe document. Invalid,
 * incompatible, or absent payloads never hydrate the editor; callers receive a
 * cloned fallback plus recoverable issues they can surface or log elsewhere.
 */
export function restoreSceneDocumentFromSerialized(
	serialized: string | null | undefined,
	fallback: SceneDocument,
): SceneDocumentRestoreResult {
	if (
		serialized === null ||
		serialized === undefined ||
		serialized.trim() === ""
	) {
		return {
			source: "fallback",
			document: cloneSceneDocument(fallback),
			issues: [
				issue("missing-payload", "No persisted scene payload was found."),
			],
		};
	}

	const result = deserializeSceneDocument(serialized);
	if (result.status === "failed") {
		return {
			source: "fallback",
			document: cloneSceneDocument(fallback),
			issues: result.issues,
		};
	}

	return {
		source: "persisted",
		document: result.document,
		issues: result.issues,
	};
}
