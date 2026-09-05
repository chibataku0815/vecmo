import type { SceneCommand } from "@/entities/scene/model/command";
import { createPlaceImageNodeCommand } from "@/entities/scene/model/node-commands";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	createRasterImagePlacementPlan,
	type RasterImageIntrinsicSize,
	type RasterImagePlacementPlan,
} from "./image-placement";

export type LocalImageFilePlacementPlan = {
	readonly command: SceneCommand;
	readonly nodeId: string;
	readonly assetId: string;
	readonly sourceName: string;
	readonly sourceFormat: RasterImagePlacementPlan["sourceFormat"];
};

const readFileAsDataUrl = (file: File): Promise<string> =>
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

const readImageIntrinsicSize = (
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

/**
 * Reads a browser `File` and builds the command-bus placement plan shared by
 * editor surfaces that import local raster images. The caller owns applying the
 * command and updating selection/report UI.
 */
export async function createLocalImageFilePlacementPlan(
	scene: SceneDocument,
	file: File,
): Promise<LocalImageFilePlacementPlan | null> {
	const sourceName = file.name || "Untitled image";
	const dataUrl = await readFileAsDataUrl(file);
	const intrinsicSize = await readImageIntrinsicSize(dataUrl);
	const plan = createRasterImagePlacementPlan({
		scene,
		sourceName,
		sourceType: file.type,
		source: { kind: "data-url", dataUrl },
		intrinsicSize,
	});
	if (!plan) return null;
	return {
		command: createPlaceImageNodeCommand(
			plan.commandInput,
			plan.commandOptions,
		),
		nodeId: plan.nodeId,
		assetId: plan.assetId,
		sourceName: plan.sourceName,
		sourceFormat: plan.sourceFormat,
	};
}
