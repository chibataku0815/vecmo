import {
	hrefForVideoAsset,
	videoAssetForGeometry,
} from "@/entities/scene/model/assets";
import type {
	ImageAsset,
	SceneAsset,
	SceneDocument,
	VectorNode,
	VideoAsset,
} from "@/entities/scene/model/types";

type CachedVideoSource = {
	readonly video: HTMLVideoElement;
	readonly ready: Promise<void>;
	readonly canvas: HTMLCanvasElement;
	readonly context: CanvasRenderingContext2D;
	lastFrameKey?: string;
	lastDataUrl?: string;
};

const videoSources = new Map<string, CachedVideoSource>();

const finitePositive = (value: number | undefined): number | null =>
	Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? 0) : null;

const videoSourceKey = (asset: VideoAsset, href: string): string =>
	[
		asset.id,
		asset.mimeType ?? "",
		asset.width ?? "",
		asset.height ?? "",
		asset.durationSeconds ?? "",
		href,
	].join("\u0000");

const waitForEvent = (
	target: EventTarget,
	successEvent: string,
	errorMessage: string,
): Promise<void> =>
	new Promise((resolve, reject) => {
		const cleanup = () => {
			target.removeEventListener(successEvent, onSuccess);
			target.removeEventListener("error", onError);
		};
		const onSuccess = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error(errorMessage));
		};
		target.addEventListener(successEvent, onSuccess, { once: true });
		target.addEventListener("error", onError, { once: true });
	});

const createCachedVideoSource = (
	asset: VideoAsset,
	href: string,
): CachedVideoSource | null => {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { alpha: true });
	if (!context) return null;
	const video = document.createElement("video");
	video.preload = "auto";
	video.muted = true;
	video.playsInline = true;
	video.crossOrigin = "anonymous";
	const ready = waitForEvent(
		video,
		"loadedmetadata",
		`Video asset "${asset.id}" could not be loaded.`,
	).then(async () => {
		if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
			await waitForEvent(
				video,
				"loadeddata",
				`Video asset "${asset.id}" could not decode a frame.`,
			);
		}
	});
	video.src = href;
	return {
		video,
		ready,
		canvas,
		context,
	};
};

const cachedVideoSourceFor = (
	asset: VideoAsset,
	href: string,
): CachedVideoSource | null => {
	const key = videoSourceKey(asset, href);
	const cached = videoSources.get(key);
	if (cached) return cached;
	const created = createCachedVideoSource(asset, href);
	if (created) videoSources.set(key, created);
	return created;
};

const frameTimeForVideo = (
	video: HTMLVideoElement,
	timeSeconds: number,
): number => {
	const duration = finitePositive(video.duration);
	const safeTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
	if (!duration) return safeTime;
	const wrapped = safeTime % duration;
	return Math.min(Math.max(0, wrapped), Math.max(0, duration - 1 / 120));
};

const seekVideo = async (
	video: HTMLVideoElement,
	timeSeconds: number,
): Promise<void> => {
	const target = frameTimeForVideo(video, timeSeconds);
	if (Math.abs(video.currentTime - target) <= 1 / 240) return;
	const seeked = waitForEvent(
		video,
		"seeked",
		"Video frame seek failed while preparing render media.",
	);
	video.currentTime = target;
	await seeked;
};

const frameSizeForAsset = (
	asset: VideoAsset,
	video: HTMLVideoElement,
): { readonly width: number; readonly height: number } => ({
	width: Math.max(
		1,
		Math.round(finitePositive(asset.width) ?? video.videoWidth),
	),
	height: Math.max(
		1,
		Math.round(finitePositive(asset.height) ?? video.videoHeight),
	),
});

const sampleVideoFrameAsset = async (
	asset: VideoAsset,
	timeSeconds: number,
): Promise<ImageAsset | null> => {
	const href = hrefForVideoAsset(asset);
	if (!href) return null;
	const source = cachedVideoSourceFor(asset, href);
	if (!source) return null;
	await source.ready;
	await seekVideo(source.video, timeSeconds);
	const size = frameSizeForAsset(asset, source.video);
	const frameKey = `${size.width}x${size.height}@${source.video.currentTime.toFixed(4)}`;
	if (source.lastFrameKey === frameKey && source.lastDataUrl) {
		return {
			id: asset.id,
			kind: "image",
			name: asset.name,
			source: { kind: "data-url", dataUrl: source.lastDataUrl },
			mimeType: "image/png",
			width: size.width,
			height: size.height,
		};
	}
	source.canvas.width = size.width;
	source.canvas.height = size.height;
	source.context.clearRect(0, 0, size.width, size.height);
	source.context.drawImage(source.video, 0, 0, size.width, size.height);
	const dataUrl = source.canvas.toDataURL("image/png");
	source.lastFrameKey = frameKey;
	source.lastDataUrl = dataUrl;
	return {
		id: asset.id,
		kind: "image",
		name: asset.name,
		source: { kind: "data-url", dataUrl },
		mimeType: "image/png",
		width: size.width,
		height: size.height,
	};
};

const collectVideoAssetIds = (
	nodes: readonly VectorNode[],
	scene: SceneDocument,
	output: Set<string>,
): void => {
	for (const node of nodes) {
		if (node.geometry.kind === "image") {
			const asset = videoAssetForGeometry(scene, node.geometry);
			if (asset) output.add(asset.id);
		}
		if (node.children) collectVideoAssetIds(node.children, scene, output);
	}
};

const referencedVideoAssetIds = (scene: SceneDocument): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (const layer of scene.layers)
		collectVideoAssetIds(layer.nodes, scene, ids);
	return ids;
};

/** Returns whether the scene contains at least one video-backed media node. */
export function sceneHasVideoMedia(scene: SceneDocument): boolean {
	if (!scene.assets?.some((asset) => asset.kind === "video")) return false;
	const ids = referencedVideoAssetIds(scene);
	return scene.assets.some(
		(asset) => asset.kind === "video" && ids.has(asset.id),
	);
}

/**
 * Replaces video assets referenced by image geometry with frame-image assets for
 * one render time. The returned document is transient and must not be persisted.
 */
export async function materializeVideoAssetFrames(
	scene: SceneDocument,
	timeSeconds: number,
): Promise<SceneDocument> {
	if (!sceneHasVideoMedia(scene)) return scene;
	const referencedIds = referencedVideoAssetIds(scene);
	const videoAssets =
		scene.assets?.filter(
			(asset): asset is VideoAsset =>
				asset.kind === "video" && referencedIds.has(asset.id),
		) ?? [];
	const sampledEntries = await Promise.all(
		videoAssets.map(async (asset) => {
			try {
				return [
					asset.id,
					await sampleVideoFrameAsset(asset, timeSeconds),
				] as const;
			} catch {
				return [asset.id, null] as const;
			}
		}),
	);
	const frameAssets = new Map<string, ImageAsset>(
		sampledEntries.filter(
			(entry): entry is readonly [string, ImageAsset] => entry[1] !== null,
		),
	);
	if (frameAssets.size === 0) return scene;
	const assets: SceneAsset[] =
		scene.assets?.map((asset) => frameAssets.get(asset.id) ?? asset) ?? [];
	return {
		...scene,
		assets,
	};
}
