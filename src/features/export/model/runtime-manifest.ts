import { stableJsonStringify } from "./json";
import {
	type ExportOptimizationOptions,
	stableJsonOptionsForExport,
} from "./optimization";

const RUNTIME_ASSET_MANIFEST_MIME_TYPE = "application/json;charset=utf-8";

export const RUNTIME_ASSET_MANIFEST_FORMAT =
	"vector-motion-author/runtime-asset-manifest" as const;

/** Runtime renderer family that generated files are meant to boot. */
export type RuntimeAssetManifestRenderer = "motion-code-svg" | "webgl-player";

/** Role of a generated file in a runtime download set. */
export type RuntimeAssetManifestFileRole =
	| "runtime"
	| "data"
	| "html"
	| "react"
	| "types"
	| "support"
	| "manifest";

/** Single file entry in the generated runtime packaging manifest. */
export type RuntimeAssetManifestFile = {
	readonly role: RuntimeAssetManifestFileRole;
	readonly fileName: string;
	readonly shared?: boolean;
};

/** Downloadable JSON map that keeps split/shared runtime files addressable. */
export type RuntimeAssetManifestAsset = {
	readonly kind: "runtime-manifest-json";
	readonly fileName: string;
	readonly mimeType: typeof RUNTIME_ASSET_MANIFEST_MIME_TYPE;
	readonly contents: string;
};

/** Inputs needed to describe one generated runtime download set. */
export type CreateRuntimeAssetManifestAssetInput = {
	readonly fileName: string;
	readonly runtimeFormat: string;
	readonly renderer: RuntimeAssetManifestRenderer;
	readonly options: ExportOptimizationOptions;
	readonly files: {
		readonly runtimeFileName: string;
		readonly dataFileName?: string;
		readonly htmlFileName: string;
		readonly typesFileName: string;
		readonly reactFileName?: string;
		readonly supportFileNames?: readonly string[];
	};
	readonly entrypoints: {
		readonly mountExport: string;
		readonly dataLoaderExport?: string;
		readonly overlayMountExport?: string;
	};
	readonly includePlayerApi?: boolean;
	readonly sceneSequence?: boolean;
	readonly capabilities?: Record<string, unknown>;
};

const runtimeManifestFiles = (
	input: CreateRuntimeAssetManifestAssetInput,
): readonly RuntimeAssetManifestFile[] => {
	const { files, options } = input;
	const candidates: readonly RuntimeAssetManifestFile[] = [
		{
			role: "runtime",
			fileName: files.runtimeFileName,
			...(options.runtimePackaging === "shared-runtime"
				? { shared: true }
				: {}),
		},
		...(files.dataFileName
			? [{ role: "data" as const, fileName: files.dataFileName }]
			: []),
		{ role: "html", fileName: files.htmlFileName },
		...(files.reactFileName
			? [{ role: "react" as const, fileName: files.reactFileName }]
			: []),
		{
			role: "types",
			fileName: files.typesFileName,
			...(options.runtimePackaging === "shared-runtime"
				? { shared: true }
				: {}),
		},
		...(files.supportFileNames ?? []).map((fileName) => ({
			role: "support" as const,
			fileName,
		})),
		{ role: "manifest", fileName: input.fileName },
	];
	const seen = new Set<string>();
	return candidates.filter((file) => {
		const key = `${file.role}:${file.fileName}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/**
 * Creates a small machine-readable map for generated runtime downloads. Split
 * and shared-runtime profiles intentionally produce multiple files; this manifest
 * keeps that set addressable without re-embedding the scene payload in JS.
 */
export function createRuntimeAssetManifestAsset(
	input: CreateRuntimeAssetManifestAssetInput,
): RuntimeAssetManifestAsset {
	const { options } = input;
	const requiresHttp = options.runtimePackaging !== "embedded";
	const payload = {
		exportFormat: RUNTIME_ASSET_MANIFEST_FORMAT,
		runtimeFormat: input.runtimeFormat,
		renderer: input.renderer,
		profile: options.profile,
		runtimePackaging: options.runtimePackaging,
		requiresHttp,
		files: runtimeManifestFiles(input),
		entrypoints: {
			html: input.files.htmlFileName,
			runtime: input.files.runtimeFileName,
			types: input.files.typesFileName,
			...(input.files.dataFileName ? { data: input.files.dataFileName } : {}),
			...(input.files.reactFileName
				? { react: input.files.reactFileName }
				: {}),
			mountExport: input.entrypoints.mountExport,
			...(input.entrypoints.overlayMountExport
				? { overlayMountExport: input.entrypoints.overlayMountExport }
				: {}),
			...(input.entrypoints.dataLoaderExport
				? { dataLoaderExport: input.entrypoints.dataLoaderExport }
				: {}),
		},
		...(input.includePlayerApi === false
			? {}
			: {
					playerApi: {
						contractVersion: 2,
						renderer: input.renderer === "motion-code-svg" ? "svg" : "webgl",
						timing: ["frame", "progress"],
						frameScope: ["scene", "scene-sequence"],
						sceneSequence: input.sceneSequence === true,
						hooks: ["frameSampled", "frameRendered"],
						camera: { read: true, override: true, crossfadeState: true },
						types: input.files.typesFileName,
					},
				}),
		...(input.capabilities ? { capabilities: input.capabilities } : {}),
		hosting: {
			requiresHttp,
			reason: requiresHttp
				? "Data payload is loaded with fetch(), so serve the files from the same HTTP directory."
				: "Runtime payload is embedded in the generated module.",
		},
	};
	return {
		kind: "runtime-manifest-json",
		fileName: input.fileName,
		mimeType: RUNTIME_ASSET_MANIFEST_MIME_TYPE,
		contents: stableJsonStringify(payload, stableJsonOptionsForExport(options)),
	};
}
