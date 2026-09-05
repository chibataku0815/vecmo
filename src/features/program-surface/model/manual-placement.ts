import type { SceneCommand } from "@/entities/scene/model/command";
import { createPlaceProgramSurfaceAssetCommand } from "@/entities/scene/model/node-commands";
import {
	allNodes,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type { Bounds, SceneDocument } from "@/entities/scene/model/types";
import type { VerifiedManualProgramSurfacePackage } from "./package-intake";

const PROGRAM_SURFACE_MAX_ARTBOARD_RATIO = 0.68;
const PROGRAM_SURFACE_MIN_PLACEMENT_SIDE = 24;
const PROGRAM_SURFACE_DEFAULT_PLACEMENT_WIDTH = 320;
const PROGRAM_SURFACE_DEFAULT_ASPECT_RATIO = 4 / 3;

export type ManualProgramSurfacePlacementPlan = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly command: SceneCommand;
};

const finitePositive = (value: number | undefined): number | undefined =>
	Number.isFinite(value) && (value ?? 0) > 0 ? value : undefined;

const rounded = (value: number): number => Math.round(value * 100) / 100;

const stemFor = (name: string): string => {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug.slice(0, 72) : "program-surface";
};

const uniqueId = (usedIds: ReadonlySet<string>, baseId: string): string => {
	if (!usedIds.has(baseId)) return baseId;
	let suffix = 2;
	let candidate = `${baseId}-${suffix}`;
	while (usedIds.has(candidate)) {
		suffix += 1;
		candidate = `${baseId}-${suffix}`;
	}
	return candidate;
};

/**
 * Fits the verified surface's declared output into the current artboard. The
 * bounds are artboard-local, matching the existing normal image-geometry
 * placement contract used by the entity command.
 */
export function createManualProgramSurfacePlacementBounds(
	artboard: { readonly width: number; readonly height: number },
	output: { readonly width: number; readonly height: number },
): Bounds {
	const artboardWidth =
		finitePositive(artboard.width) ?? PROGRAM_SURFACE_DEFAULT_PLACEMENT_WIDTH;
	const artboardHeight =
		finitePositive(artboard.height) ??
		PROGRAM_SURFACE_DEFAULT_PLACEMENT_WIDTH /
			PROGRAM_SURFACE_DEFAULT_ASPECT_RATIO;
	const outputWidth =
		finitePositive(output.width) ?? PROGRAM_SURFACE_DEFAULT_PLACEMENT_WIDTH;
	const outputHeight =
		finitePositive(output.height) ??
		PROGRAM_SURFACE_DEFAULT_PLACEMENT_WIDTH /
			PROGRAM_SURFACE_DEFAULT_ASPECT_RATIO;
	const maxWidth = Math.max(
		PROGRAM_SURFACE_MIN_PLACEMENT_SIDE,
		artboardWidth * PROGRAM_SURFACE_MAX_ARTBOARD_RATIO,
	);
	const maxHeight = Math.max(
		PROGRAM_SURFACE_MIN_PLACEMENT_SIDE,
		artboardHeight * PROGRAM_SURFACE_MAX_ARTBOARD_RATIO,
	);
	const scale = Math.min(1, maxWidth / outputWidth, maxHeight / outputHeight);
	const width = Math.max(
		PROGRAM_SURFACE_MIN_PLACEMENT_SIDE,
		outputWidth * scale,
	);
	const height = Math.max(
		PROGRAM_SURFACE_MIN_PLACEMENT_SIDE,
		outputHeight * scale,
	);
	return {
		x: rounded((artboardWidth - width) / 2),
		y: rounded((artboardHeight - height) / 2),
		width: rounded(width),
		height: rounded(height),
	};
}

/**
 * Allocates current-document ids and creates one command-bus placement for an
 * already verified, inert package. This planner neither applies the command
 * nor reads/writes approval or runtime state.
 */
export function planManualProgramSurfacePlacement(
	scene: SceneDocument,
	candidate: VerifiedManualProgramSurfacePackage,
): ManualProgramSurfacePlacementPlan | null {
	if (scene.layers.length === 0) return null;

	const stem = stemFor(candidate.name);
	const usedAssetIds = new Set(scene.assets?.map((asset) => asset.id) ?? []);
	const usedNodeIds = new Set(allNodes(scene).map((node) => node.id));
	const assetId = uniqueId(usedAssetIds, `asset-program-surface-${stem}`);
	const nodeId = uniqueId(usedNodeIds, `node-program-surface-${stem}`);
	const artboard = selectCurrentArtboard(scene);
	const bounds = createManualProgramSurfacePlacementBounds(
		artboard,
		candidate.manifest.output,
	);

	return {
		assetId,
		nodeId,
		name: candidate.name,
		command: createPlaceProgramSurfaceAssetCommand(
			{
				assetId,
				nodeId,
				name: candidate.name,
				bounds,
				source: candidate.source,
				manifest: candidate.manifest,
				artboardId: artboard.id,
				mimeType: "text/javascript",
			},
			{ label: `Place ${candidate.name}` },
		),
	};
}
