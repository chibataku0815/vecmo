import {
	type CacheArtifactKeyInput,
	type CacheArtifactKind,
	createCacheArtifactKey,
	stableHashValue,
} from "@/shared/cache";
import type { SceneDocument } from "./types";

export const SCENE_DERIVED_CACHE_SCHEMA_VERSION = "scene-derived-cache:v1";
export const SCENE_DERIVED_CACHE_RENDERER_VERSION = "scene-renderer:v1";

export type SceneDerivedCacheKeyOptions = {
	readonly artifactKind: CacheArtifactKind;
	readonly scene: SceneDocument;
	readonly input?: unknown;
	readonly motionInput?: unknown;
	readonly grammarInput?: unknown;
	readonly rendererVersion?: string;
	readonly capabilityVersion?: string;
	readonly deviceBucket?: string;
	readonly dependencyKeys?: readonly string[];
};

/** Stable content identity for a scene document, independent of object identity. */
export function sceneDocumentContentHash(scene: SceneDocument): string {
	return stableHashValue(scene);
}

/** Stable content identity for motion inputs that can affect presentation. */
export function sceneMotionInputHash(
	motionInput: unknown,
	grammarInput: unknown,
): string {
	return stableHashValue({
		motionInput,
		grammarInput,
	});
}

/**
 * Builds a stale-safe derived artifact key for scene-owned cache artifacts.
 * Callers choose the input subset so hot paths can key by artboard/node when a
 * full-document hash would be unnecessary.
 */
export function createSceneDerivedCacheKey(
	options: SceneDerivedCacheKeyOptions,
): string {
	return createCacheArtifactKey(createSceneDerivedCacheKeyInput(options));
}

/** Builds the full key payload when the caller also needs manifest fields. */
export function createSceneDerivedCacheKeyInput(
	options: SceneDerivedCacheKeyOptions,
): CacheArtifactKeyInput {
	const artifactInputHash = stableHashValue({
		input: options.input ?? null,
		motion: sceneMotionInputHash(
			options.motionInput ?? null,
			options.grammarInput ?? null,
		),
	});
	const keyInput: CacheArtifactKeyInput = {
		schemaVersion: SCENE_DERIVED_CACHE_SCHEMA_VERSION,
		artifactKind: options.artifactKind,
		documentContentHash: sceneDocumentContentHash(options.scene),
		artifactInputHash,
		rendererVersion:
			options.rendererVersion ?? SCENE_DERIVED_CACHE_RENDERER_VERSION,
		capabilityVersion: options.capabilityVersion ?? "capability:any",
		deviceBucket: options.deviceBucket ?? "device:any",
		dependencyKeys: options.dependencyKeys,
	};
	return keyInput;
}
