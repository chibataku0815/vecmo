import type { SerializedMotionGrammarLayer } from "@/entities/motion/model/grammar-bridge";
import { cloneMotionDocument } from "@/entities/motion/model/seed-motion";
import {
	deserializeMotionDocument,
	isMotionDocument,
	SERIALIZED_MOTION_DOCUMENT_KIND,
} from "@/entities/motion/model/serialization";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import {
	parseMotionGrammarLayer,
	serializeMotionGrammarLayer,
} from "@/entities/motion-grammar/model/parse";
import { ANALOG_FILM_LOOK_RECIPE } from "@/entities/motion-grammar/model/time-delay-materialization";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import { normalizeSceneDocumentVectorRecipes } from "@/entities/scene/model/recipe-compatibility";
import {
	deserializeSceneDocument,
	isSceneDocument,
	SERIALIZED_SCENE_DOCUMENT_KIND,
} from "@/entities/scene/model/serialization";
import type { Artboard, SceneDocument } from "@/entities/scene/model/types";
import { stableJsonStringify } from "@/shared/lib/stable-json";
import {
	createProjectAuthoringCompatibilityReport,
	type ProjectAuthoringCompatibilityReport,
} from "./authoring-compatibility";

export const PROJECT_BACKUP_KIND =
	"vector-motion-author.project-backup" as const;
export const PROJECT_BACKUP_VERSION = 1 as const;
const LEGACY_TIME_DELAY_MASTER_INSTANCES_BACKUP_KIND =
	"vecmo-time-delay-master-instances-backup" as const;

/** File extension and MIME type the portability backup is written and read as. */
export const PROJECT_BACKUP_EXTENSION = "json" as const;
const PROJECT_BACKUP_MIME = "application/json;charset=utf-8" as const;

/**
 * True when a browser file should be handled by the portability restore path
 * rather than the SVG/AI vector importer. Routing JSON here is what lets a user
 * reload an exported scene/backup instead of hitting "unsupported file type".
 */
export function isPortableProjectFile(name: string, type?: string): boolean {
	const extension = name.trim().toLowerCase().split(".").at(-1) ?? "";
	const mime = type?.toLowerCase() ?? "";
	return extension === PROJECT_BACKUP_EXTENSION || mime.includes("json");
}

/** MIME type for downloading a project backup as a file. */
export const projectBackupMimeType = (): string => PROJECT_BACKUP_MIME;

/** Deterministic, filesystem-safe backup file name derived from the scene. */
export function projectBackupFileName(sceneName: string): string {
	const stem =
		sceneName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project";
	return `${stem}.vecmo-backup.${PROJECT_BACKUP_EXTENSION}`;
}

export type ProjectBackupIssueCode =
	| "invalid-json"
	| "unrecognized-format"
	| "invalid-scene"
	| "invalid-motion";

export type ProjectBackupIssue = {
	readonly code: ProjectBackupIssueCode;
	readonly message: string;
};

export type ProjectBackupEnvelope = {
	readonly kind: typeof PROJECT_BACKUP_KIND;
	readonly version: typeof PROJECT_BACKUP_VERSION;
	readonly savedAt: string;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar?: SerializedMotionGrammarLayer;
};

/**
 * Result of restoring a portable JSON payload. `motion` is only present when the
 * source actually carried timing data, so importing a scene-only backup never
 * silently wipes the editor's current motion side-car.
 */
export type ProjectRestoreResult =
	| {
			readonly status: "ok";
			readonly format:
				| "project-backup"
				| "legacy-time-delay-master-instances"
				| "scene-envelope"
				| "scene-pojo";
			readonly scene: SceneDocument;
			readonly motion?: MotionDocument;
			readonly grammar?: MotionGrammarStoreDocument;
			readonly compatibility: ProjectAuthoringCompatibilityReport;
			readonly issues: readonly ProjectBackupIssue[];
	  }
	| {
			readonly status: "failed";
			readonly issues: readonly ProjectBackupIssue[];
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const issue = (
	code: ProjectBackupIssueCode,
	message: string,
): ProjectBackupIssue => ({ code, message });

const normalizeScene = (document: SceneDocument): SceneDocument =>
	cloneSceneDocument(normalizeSceneDocumentVectorRecipes(document));

const withLegacyTimeDelayFrameLook = (artboard: Artboard): Artboard => {
	if (artboard.effectIntent?.visualRecipe) return artboard;
	return {
		...artboard,
		effectIntent: {
			...artboard.effectIntent,
			visualRecipe: ANALOG_FILM_LOOK_RECIPE,
		},
	};
};

const normalizeLegacyTimeDelayScene = (
	document: SceneDocument,
): SceneDocument => {
	const scene = normalizeScene(document);
	return {
		...scene,
		artboard: withLegacyTimeDelayFrameLook(scene.artboard),
		...(scene.artboards
			? { artboards: scene.artboards.map(withLegacyTimeDelayFrameLook) }
			: {}),
	};
};

const isSerializedMotionGrammarBinding = (
	value: unknown,
): value is SerializedMotionGrammarLayer["bindings"][number] =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.techniqueId === "string" &&
	Array.isArray(value.targetIds) &&
	value.targetIds.every((targetId) => typeof targetId === "string") &&
	isRecord(value.parameters);

const serializedMotionGrammarLayerFromUnknown = (
	value: unknown,
): SerializedMotionGrammarLayer | undefined => {
	if (!isRecord(value)) return undefined;
	if (value.schemaVersion !== 1 || !Array.isArray(value.bindings)) {
		return undefined;
	}
	if (!value.bindings.every(isSerializedMotionGrammarBinding)) {
		return undefined;
	}
	return { schemaVersion: 1, bindings: value.bindings };
};

const legacyGrammarLayerFromUnknown = (
	value: unknown,
): SerializedMotionGrammarLayer | undefined => {
	if (!Array.isArray(value)) return undefined;
	if (!value.every(isSerializedMotionGrammarBinding)) return undefined;
	return { schemaVersion: 1, bindings: value };
};

const restoreGrammarLayer = (
	layer: SerializedMotionGrammarLayer | undefined,
): MotionGrammarStoreDocument | undefined => {
	if (!layer) return undefined;
	const parsed = parseMotionGrammarLayer(layer);
	return {
		bindings: parsed.bindings,
		passthrough: parsed.passthrough,
		diagnostics: parsed.issues,
	};
};

/**
 * Serializes the full project — scene plus its motion side-car — into a single
 * deterministic, restorable JSON file. This is the user's "take your work with
 * you" safety net: one file that fully reconstructs the document without any
 * server, which is the only durable hedge against the service going away.
 */
export function serializeProjectBackup(
	scene: SceneDocument,
	motion: MotionDocument,
	options: {
		readonly savedAt?: string;
		readonly grammar?: MotionGrammarStoreDocument;
	} = {},
): string {
	const envelope: ProjectBackupEnvelope = {
		kind: PROJECT_BACKUP_KIND,
		version: PROJECT_BACKUP_VERSION,
		savedAt: options.savedAt ?? new Date().toISOString(),
		scene: cloneSceneDocument(scene),
		motion: cloneMotionDocument(motion),
		...(options.grammar
			? {
					grammar: serializeMotionGrammarLayer(
						options.grammar.bindings,
						options.grammar.passthrough,
					),
				}
			: {}),
	};
	return stableJsonStringify(envelope);
}

const restoreProjectBackupEnvelope = (
	parsed: Record<string, unknown>,
): ProjectRestoreResult => {
	if (!isSceneDocument(parsed.scene)) {
		return {
			status: "failed",
			issues: [
				issue("invalid-scene", "Backup scene failed runtime validation."),
			],
		};
	}
	if (!isMotionDocument(parsed.motion)) {
		return {
			status: "failed",
			issues: [
				issue("invalid-motion", "Backup motion failed runtime validation."),
			],
		};
	}
	const scene = normalizeScene(parsed.scene);
	const motion = cloneMotionDocument(parsed.motion);
	const grammar = restoreGrammarLayer(
		serializedMotionGrammarLayerFromUnknown(parsed.grammar),
	);
	return {
		status: "ok",
		format: "project-backup",
		scene,
		motion,
		grammar,
		compatibility: createProjectAuthoringCompatibilityReport({
			scene,
			motion,
			grammar,
		}),
		issues: [],
	};
};

const restoreLegacyTimeDelayBackupEnvelope = (
	parsed: Record<string, unknown>,
): ProjectRestoreResult => {
	if (!isSceneDocument(parsed.scene)) {
		return {
			status: "failed",
			issues: [
				issue(
					"invalid-scene",
					"Legacy time-delay scene failed runtime validation.",
				),
			],
		};
	}
	if (!isMotionDocument(parsed.motion)) {
		return {
			status: "failed",
			issues: [
				issue(
					"invalid-motion",
					"Legacy time-delay motion failed runtime validation.",
				),
			],
		};
	}
	const scene = normalizeLegacyTimeDelayScene(parsed.scene);
	const motion = cloneMotionDocument(parsed.motion);
	const grammar = restoreGrammarLayer(
		legacyGrammarLayerFromUnknown(parsed.grammarBindings),
	);
	return {
		status: "ok",
		format: "legacy-time-delay-master-instances",
		scene,
		motion,
		grammar,
		compatibility: createProjectAuthoringCompatibilityReport({
			scene,
			motion,
			grammar,
		}),
		issues: [],
	};
};

/**
 * Tolerant reader for every portable JSON shape the app can emit: the combined
 * project backup, the scene-document storage envelope, and the bare scene POJO
 * that the export bundle writes as `*.scene.json`. Bridging all three means a
 * user can always reload their own exported data instead of hitting a dead end.
 */
export function restorePortableProject(
	serialized: string,
): ProjectRestoreResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return {
			status: "failed",
			issues: [issue("invalid-json", "File is not valid JSON.")],
		};
	}

	if (isRecord(parsed) && parsed.kind === PROJECT_BACKUP_KIND) {
		return restoreProjectBackupEnvelope(parsed);
	}

	if (
		isRecord(parsed) &&
		parsed.kind === LEGACY_TIME_DELAY_MASTER_INSTANCES_BACKUP_KIND
	) {
		return restoreLegacyTimeDelayBackupEnvelope(parsed);
	}

	if (isRecord(parsed) && parsed.kind === SERIALIZED_SCENE_DOCUMENT_KIND) {
		const result = deserializeSceneDocument(serialized);
		if (result.status === "failed") {
			return {
				status: "failed",
				issues: [
					issue("invalid-scene", "Scene document failed runtime validation."),
				],
			};
		}
		return {
			status: "ok",
			format: "scene-envelope",
			scene: result.document,
			compatibility: createProjectAuthoringCompatibilityReport({
				scene: result.document,
			}),
			issues: [],
		};
	}

	if (isRecord(parsed) && parsed.kind === SERIALIZED_MOTION_DOCUMENT_KIND) {
		const result = deserializeMotionDocument(serialized);
		if (result.status === "failed") {
			return {
				status: "failed",
				issues: [
					issue("invalid-motion", "Motion document failed runtime validation."),
				],
			};
		}
		// A bare motion file has no scene to restore; surface it as unrecognized so
		// the caller does not blank the canvas with a seed scene.
		return {
			status: "failed",
			issues: [
				issue(
					"unrecognized-format",
					"This is a motion-only file. Import a full backup or scene to restore the canvas.",
				),
			],
		};
	}

	if (isSceneDocument(parsed)) {
		const scene = normalizeScene(parsed);
		return {
			status: "ok",
			format: "scene-pojo",
			scene,
			compatibility: createProjectAuthoringCompatibilityReport({
				scene,
			}),
			issues: [],
		};
	}

	return {
		status: "failed",
		issues: [
			issue(
				"unrecognized-format",
				"File is not a recognized vector-motion-author backup, scene, or motion document.",
			),
		],
	};
}
