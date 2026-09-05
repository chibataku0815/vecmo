import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument } from "@/entities/scene/model/types";

export type ExportAssetKind =
	| "manifest-json"
	| "scene-json"
	| "motion-json"
	| "recipe-json"
	| "svg"
	| "pdf"
	| "animation-sequence-json"
	| "animation-sequence-svg"
	| "raster-intent-json";

export type ExportAsset = {
	readonly kind: ExportAssetKind;
	readonly fileName: string;
	readonly mimeType: string;
	readonly contents: string;
};

const JSON_MIME_TYPE = "application/json;charset=utf-8";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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

const slugify = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

export type StableJsonStringifyOptions = {
	readonly pretty?: boolean;
};

/**
 * Serializes scene and motion POJOs with sorted object keys. The export contract
 * needs byte-stable output for tests, reviews, and future Worker-side exports,
 * so it cannot depend on incidental object construction order.
 */
export function stableJsonStringify(
	value: unknown,
	options: StableJsonStringifyOptions = {},
): string {
	const space = options.pretty === false ? 0 : 2;
	const serialized = JSON.stringify(canonicalize(value), null, space);
	return `${serialized ?? "null"}\n`;
}

/** Returns a deterministic filesystem-safe stem shared by all export assets. */
export function fileStemForScene(scene: SceneDocument): string {
	return slugify(scene.name) || slugify(scene.id) || "scene";
}

/**
 * Creates the canonical JSON representation of the current scene document.
 * SceneDocument already carries its schema version, so no wrapper is needed.
 */
export function createSceneJsonExport(scene: SceneDocument): ExportAsset {
	return {
		kind: "scene-json",
		fileName: `${fileStemForScene(scene)}.scene.json`,
		mimeType: JSON_MIME_TYPE,
		contents: stableJsonStringify(scene),
	};
}

/**
 * Creates the canonical JSON representation of the side-car motion document.
 * Motion data remains separate from the scene and keeps its own schema version.
 */
export function createMotionJsonExport(
	scene: SceneDocument,
	motion: MotionDocument,
): ExportAsset {
	return {
		kind: "motion-json",
		fileName: `${fileStemForScene(scene)}.motion.json`,
		mimeType: JSON_MIME_TYPE,
		contents: stableJsonStringify(motion),
	};
}
