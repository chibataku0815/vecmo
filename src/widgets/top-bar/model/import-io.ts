import {
	createAppendImportedScenePayloadCommand,
	createPlaceImageNodeCommand,
	createPlaceVideoNodeCommand,
} from "@/entities/scene/model/node-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneLayer } from "@/entities/scene/model/types";
import {
	createRasterImagePlacementPlan,
	type RasterImageIntrinsicSize,
} from "@/features/import/model/image-placement";
import type { ImportedScenePayload } from "@/features/import/model/types";
import { planManualProgramSurfacePlacement } from "@/features/program-surface/model/manual-placement";
import type { VerifiedManualProgramSurfacePackage } from "@/features/program-surface/model/package-intake";
import { useSelectionStore } from "@/features/selection/model/store";
import {
	createTopBarImagePlacementReport,
	createTopBarProgramSurfacePlacementReport,
	createTopBarVideoPlacementReport,
} from "./import-report";
import {
	createTopBarVideoPlacementPlan,
	type TopBarVideoIntrinsicMetadata,
} from "./video-placement";

type VideoIntrinsicMetadataReadResult =
	| {
			readonly status: "ready";
			readonly metadata: TopBarVideoIntrinsicMetadata;
	  }
	| {
			readonly status: "decode-error";
			readonly metadata: null;
			readonly reason: "decode" | "no-video-track";
	  };

export const readFileAsDataUrl = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
				return;
			}
			reject(new Error("The selected file could not be read as a data URL."));
		});
		reader.addEventListener("error", () => {
			reject(reader.error ?? new Error("The selected file could not be read."));
		});
		reader.readAsDataURL(file);
	});

export const readImageIntrinsicSize = (
	dataUrl: string,
): Promise<RasterImageIntrinsicSize | null> =>
	new Promise((resolve) => {
		const image = new Image();
		image.addEventListener("load", () => {
			const width = image.naturalWidth || image.width;
			const height = image.naturalHeight || image.height;
			resolve(
				Number.isFinite(width) &&
					width > 0 &&
					Number.isFinite(height) &&
					height > 0
					? { width, height }
					: null,
			);
		});
		image.addEventListener("error", () => resolve(null));
		image.src = dataUrl;
	});

const readVideoIntrinsicMetadata = (
	file: File,
): Promise<VideoIntrinsicMetadataReadResult> =>
	new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		const cleanup = () => {
			URL.revokeObjectURL(url);
			video.removeAttribute("src");
			video.load();
		};
		video.preload = "metadata";
		video.muted = true;
		video.playsInline = true;
		video.addEventListener(
			"loadedmetadata",
			() => {
				const width = video.videoWidth;
				const height = video.videoHeight;
				const durationSeconds = video.duration;
				cleanup();
				resolve(
					Number.isFinite(width) &&
						width > 0 &&
						Number.isFinite(height) &&
						height > 0
						? {
								status: "ready",
								metadata: {
									width,
									height,
									...(Number.isFinite(durationSeconds) && durationSeconds > 0
										? { durationSeconds }
										: {}),
								},
							}
						: {
								status: "decode-error",
								metadata: null,
								reason: "no-video-track",
							},
				);
			},
			{ once: true },
		);
		video.addEventListener(
			"error",
			() => {
				cleanup();
				resolve({ status: "decode-error", metadata: null, reason: "decode" });
			},
			{ once: true },
		);
		video.src = url;
	});

export const collectNodeIds = (layers: readonly SceneLayer[]): string[] => {
	const ids: string[] = [];
	const visit = (nodes: SceneLayer["nodes"]) => {
		for (const node of nodes) {
			ids.push(node.id);
			if (node.children) visit(node.children);
		}
	};
	for (const layer of layers) visit(layer.nodes);
	return ids;
};

export const hasPayloadSceneContent = (
	payload: ImportedScenePayload,
): boolean => payload.layers.length > 0 || (payload.artboards?.length ?? 0) > 0;

export const appendImportedPayload = (payload: ImportedScenePayload) => {
	if (!hasPayloadSceneContent(payload)) return;
	useSceneStore.getState().apply(
		createAppendImportedScenePayloadCommand(payload, {
			...(payload.sourceName ? { sourceName: payload.sourceName } : {}),
			...(payload.sourceFormat ? { sourceFormat: payload.sourceFormat } : {}),
		}),
	);
	const nodeIds = collectNodeIds(payload.layers);
	if (nodeIds.length > 0) {
		useSelectionStore.getState().setSelection(nodeIds);
	}
};

export const placeImageFile = async (file: File) => {
	const sourceName = file.name || "Untitled image";
	const dataUrl = await readFileAsDataUrl(file);
	const intrinsicSize = await readImageIntrinsicSize(dataUrl);
	const scene = useSceneStore.getState().document;
	const plan = createRasterImagePlacementPlan({
		scene,
		sourceName,
		sourceType: file.type,
		source: { kind: "data-url", dataUrl },
		intrinsicSize,
	});
	if (!plan) {
		throw new Error(
			"No editable scene layer is available for image placement.",
		);
	}

	const before = useSceneStore.getState().document;
	useSceneStore
		.getState()
		.apply(createPlaceImageNodeCommand(plan.commandInput, plan.commandOptions));
	if (useSceneStore.getState().document === before) {
		throw new Error("The selected image could not be placed in the scene.");
	}
	useSelectionStore.getState().setSelection([plan.nodeId]);
	return createTopBarImagePlacementReport({
		sourceName: plan.sourceName,
		sourceFormat: plan.sourceFormat,
		nodeId: plan.nodeId,
		assetId: plan.assetId,
		issues: plan.issues,
	});
};

export const placeVideoFile = async (file: File) => {
	const sourceName = file.name || "Untitled video";
	const metadataResult = await readVideoIntrinsicMetadata(file);
	if (metadataResult.status === "decode-error") {
		throw new Error(
			metadataResult.reason === "no-video-track"
				? "The selected file does not expose a video track this browser can place."
				: "The selected video could not be decoded by this browser. Try an MP4/H.264 or WebM source.",
		);
	}
	const metadata = metadataResult.metadata;
	const dataUrl = await readFileAsDataUrl(file);
	const scene = useSceneStore.getState().document;
	const plan = createTopBarVideoPlacementPlan({
		scene,
		sourceName,
		sourceType: file.type,
		source: { kind: "data-url", dataUrl },
		metadata,
	});
	if (!plan) {
		throw new Error(
			"No editable scene layer is available for video placement.",
		);
	}

	const before = useSceneStore.getState().document;
	useSceneStore
		.getState()
		.apply(createPlaceVideoNodeCommand(plan.commandInput, plan.commandOptions));
	if (useSceneStore.getState().document === before) {
		throw new Error("The selected video could not be placed in the scene.");
	}
	useSelectionStore.getState().setSelection([plan.nodeId]);
	return createTopBarVideoPlacementReport({
		sourceName: plan.sourceName,
		sourceFormat: plan.sourceFormat,
		nodeId: plan.nodeId,
		assetId: plan.assetId,
		durationSeconds: metadata?.durationSeconds,
		issues: plan.issues,
	});
};

/**
 * Applies exactly one entity-owned placement command for a package whose bytes
 * were already verified by the Program Surface feature. The adapter owns only
 * ephemeral selection and the compact Top Bar result.
 */
export const placeManualProgramSurfacePackage = (
	candidate: VerifiedManualProgramSurfacePackage,
) => {
	const before = useSceneStore.getState().document;
	const plan = planManualProgramSurfacePlacement(before, candidate);
	if (!plan) {
		throw new Error(
			"No editable scene layer is available for Program Surface placement.",
		);
	}

	useSceneStore.getState().apply(plan.command);
	if (useSceneStore.getState().document === before) {
		throw new Error(
			"The verified Program Surface could not be placed in the scene.",
		);
	}
	useSelectionStore.getState().setSelection([plan.nodeId]);
	return createTopBarProgramSurfacePlacementReport({
		sourceName: candidate.sourceName,
		sourceFormat: candidate.sourceFormat,
		nodeId: plan.nodeId,
		assetId: plan.assetId,
		verifiedCompiledDigest: candidate.verifiedCompiledDigest,
	});
};
