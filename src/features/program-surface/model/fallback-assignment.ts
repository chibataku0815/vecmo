import {
	programSurfaceAssetReadModel,
	programSurfaceFallbackReadModelForAsset,
} from "@/entities/scene/model/assets";
import { createAssignProgramSurfaceFallbackCommand } from "@/entities/scene/model/node-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	ImageAsset,
	ProgramSurfaceAsset,
	SceneDocument,
} from "@/entities/scene/model/types";

export type ProgramSurfaceFallbackCandidate = {
	readonly id: string;
	readonly name: string;
};

export type ProgramSurfaceFallbackAssignmentResult =
	| {
			readonly status: "assigned";
			readonly assetId: string;
			readonly fallbackAssetId: string;
	  }
	| {
			readonly status: "unchanged";
			readonly assetId: string;
			readonly fallbackAssetId: string;
	  }
	| {
			readonly status: "rejected";
			readonly reason:
				| "program-surface-unavailable"
				| "fallback-unavailable"
				| "scene-busy"
				| "scene-command-rejected";
	  };

const programSurfaceForId = (
	document: Pick<SceneDocument, "assets">,
	assetId: string,
): ProgramSurfaceAsset | undefined =>
	programSurfaceAssetReadModel(document, assetId).asset;

const fallbackReadinessWithCandidate = (
	document: Pick<SceneDocument, "assets">,
	asset: ProgramSurfaceAsset,
	candidate: ImageAsset,
) => {
	const candidateAsset: ProgramSurfaceAsset = {
		...asset,
		manifest: {
			...asset.manifest,
			fallback: { assetId: candidate.id },
		},
	};
	const assets = document.assets?.map((entry) =>
		entry.id === asset.id ? candidateAsset : entry,
	);
	return programSurfaceFallbackReadModelForAsset({ assets }, candidateAsset);
};

/**
 * Returns only image assets that satisfy the entity-owned ready-fallback
 * contract when assigned to this Program Surface. The Inspector never infers
 * image usability from a filename or source label, and no source href crosses
 * this source-free option projection.
 */
export function programSurfaceFallbackCandidates(
	document: Pick<SceneDocument, "assets">,
	assetId: string,
): readonly ProgramSurfaceFallbackCandidate[] {
	const asset = programSurfaceForId(document, assetId);
	if (!asset) return [];
	return (document.assets ?? []).flatMap((entry) => {
		if (entry.kind !== "image" || entry.id === asset.id) return [];
		return fallbackReadinessWithCandidate(document, asset, entry).state ===
			"ready"
			? [{ id: entry.id, name: entry.name }]
			: [];
	});
}

/**
 * Commits exactly one entity-owned fallback command for an Inspector choice.
 * The live-host and local-approval paths remain separately fenced and must
 * re-read fallback readiness; this action neither approves nor executes code.
 */
export function assignProgramSurfaceFallback(
	assetId: string,
	fallbackAssetId: string,
): ProgramSurfaceFallbackAssignmentResult {
	const store = useSceneStore.getState();
	const asset = programSurfaceForId(store.document, assetId);
	if (!asset) {
		return { status: "rejected", reason: "program-surface-unavailable" };
	}
	const candidate = programSurfaceFallbackCandidates(
		store.document,
		assetId,
	).find((entry) => entry.id === fallbackAssetId);
	if (!candidate) {
		return { status: "rejected", reason: "fallback-unavailable" };
	}
	const currentFallback = programSurfaceFallbackReadModelForAsset(
		store.document,
		asset,
	);
	if (
		currentFallback.state === "ready" &&
		currentFallback.assetId === candidate.id
	) {
		return {
			status: "unchanged",
			assetId,
			fallbackAssetId: candidate.id,
		};
	}
	if (store.transaction) {
		return { status: "rejected", reason: "scene-busy" };
	}

	const before = store.document;
	store.apply(
		createAssignProgramSurfaceFallbackCommand(
			assetId,
			{ assetId: candidate.id },
			{ label: "Assign Program Surface fallback" },
		),
	);
	if (useSceneStore.getState().document === before) {
		return { status: "rejected", reason: "scene-command-rejected" };
	}
	return {
		status: "assigned",
		assetId,
		fallbackAssetId: candidate.id,
	};
}
