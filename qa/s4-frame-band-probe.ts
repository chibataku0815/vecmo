/**
 * S4-C browser probe: does the rendered frame band draw the frame it was asked
 * for, in a real browser, through the real Babylon adapter?
 *
 * Throwaway, dev-only QA harness. Nothing links here and no build entry
 * references it. It drives `createBabylonRuntimeSurface` with hand-built
 * `Runtime3dFrame`s whose placements carry `frame-sequence` sources pointing at
 * OBJECT URLs — created exactly the way `artifact-cache.ts::admitFramePackage`
 * creates them — over the real 120-frame probe package.
 *
 * The package's frames carry a frame-number bar whose RED channel equals the
 * Blender frame (the S4-B render job authored it; `verify_frames.py` decodes the
 * same band with Pillow). So the question "is frame N on screen actually N" has
 * a numeric answer read from PIXELS, which is the only kind of answer this
 * program accepts after "renderFrame resolve ≠ GPU draw complete".
 *
 * It deliberately checks more than frame 0: a frame-0-only reading passes for
 * both the correct mapping and a texture that lags by one. It also reads the bar
 * from BOTH the bottom and the top of the readback and reports which decoded,
 * rather than assuming an orientation — the GLB lane's F1 finding was a 180°
 * flip, and that class of defect must not be able to hide behind an assumption.
 *
 * Serve the package with `bun qa/s4-frame-band-serve.ts <package-dir> [port]`
 * and open `/qa/s4-frame-band-probe.html?frames=<origin>`.
 */

import type {
	Runtime3dCamera,
	Runtime3dCoordinateContract,
	Runtime3dFrame,
	Runtime3dFrameSequenceSource,
	Runtime3dPlacement,
	Runtime3dWorldMatrix,
} from "@/shared/runtime-3d/types";

const VIEWPORT_WIDTH = 640;
const VIEWPORT_HEIGHT = 360;
const NODE_ID = "s4-frame-band";
const ASSET_ID = "s4-frame-band-asset";
const ARTBOARD_ID = "s4-frame-band-artboard";
const DEFAULT_FRAMES_ORIGIN = "http://127.0.0.1:6251";

/** Same band `verify_frames.py` reads, expressed as fractions of the readback. */
const BAR_BAND_TOP = 0.955;
const BAR_BAND_BOTTOM = 0.99;
const BAR_BAND_LEFT = 0.35;
const BAR_BAND_RIGHT = 0.65;

const COORDINATES: Runtime3dCoordinateContract = {
	handedness: "right-handed",
	xAxis: "right",
	yAxis: "down",
	zAxis: "scene-depth",
	fovAxis: "vertical",
};

type ManifestFrame = {
	readonly index: number;
	readonly blenderFrame: number;
	readonly fileName: string;
	readonly byteLength: number;
};
type Manifest = {
	readonly blenderFrameStart: number;
	readonly frameCount: number;
	readonly width: number;
	readonly height: number;
	readonly buildKey: string;
	readonly codec: string;
	readonly reproducible: boolean;
	readonly frames: readonly ManifestFrame[];
};

const statusElement = document.getElementById("status");
const setStatus = (text: string): void => {
	if (statusElement) statusElement.textContent = text;
};

const framesOrigin =
	new URLSearchParams(window.location.search).get("frames") ??
	DEFAULT_FRAMES_ORIGIN;

const identityWorldMatrix: Runtime3dWorldMatrix = [
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/**
 * Orthographic and framed so the unit-longest-side quad covers the viewport
 * exactly. Any pixel-level disagreement is then the texture's, not a projection
 * mismatch that would blur the reading.
 */
const camera = (): Runtime3dCamera => ({
	kind: "orthographic",
	coordinates: COORDINATES,
	position: { x: 0, y: 0, z: -2 },
	target: { x: 0, y: 0, z: 0 },
	up: { x: 0, y: -1, z: 0 },
	near: 0.01,
	far: 100,
	halfWidth: 0.5,
	halfHeight: (0.5 * VIEWPORT_HEIGHT) / VIEWPORT_WIDTH,
	zoom: 1,
});

const sourceFor = (
	manifest: Manifest,
	frameIndex: number,
	href: string,
): Runtime3dFrameSequenceSource => {
	const cacheKey = `frame-sequence:s4probe:${manifest.buildKey}`;
	return {
		variant: "frame-sequence",
		kind: "reference",
		uri: href,
		mimeType: "image/webp",
		frameIndex,
		blenderFrame: manifest.blenderFrameStart + frameIndex,
		frameCount: manifest.frameCount,
		width: manifest.width,
		height: manifest.height,
		buildKey: manifest.buildKey,
		exact: true,
		cacheKey,
		frameCacheKey: `${cacheKey}:${frameIndex}`,
	};
};

const placementFor = (source: Runtime3dFrameSequenceSource) =>
	({
		nodeId: NODE_ID,
		sourceNodeId: NODE_ID,
		assetId: ASSET_ID,
		artboardId: ARTBOARD_ID,
		source,
		worldMatrix: identityWorldMatrix,
		opacity: 1,
		visible: true,
		pickable: true,
	}) satisfies Runtime3dPlacement;

const frameFor = (source: Runtime3dFrameSequenceSource): Runtime3dFrame => ({
	frame: source.frameIndex,
	viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, dpr: 1 },
	camera: camera(),
	artboardClips: [],
	placements: [placementFor(source)],
	vectorPlanes: [],
	issues: [],
});

type BandReading = {
	readonly median: number | null;
	readonly min: number | null;
	readonly max: number | null;
	readonly opaqueCount: number;
};

/**
 * Median RED over the bar band, counting only fully opaque pixels — the same
 * rule the Pillow decoder uses, so a disagreement between the two is a real
 * disagreement and not a methodology difference.
 */
const readBand = (
	data: ImageData,
	fromTop: boolean,
	width: number,
	height: number,
): BandReading => {
	const reds: number[] = [];
	const y0 = fromTop
		? Math.floor(height * (1 - BAR_BAND_BOTTOM))
		: Math.floor(height * BAR_BAND_TOP);
	const y1 = fromTop
		? Math.floor(height * (1 - BAR_BAND_TOP))
		: Math.floor(height * BAR_BAND_BOTTOM);
	for (let y = y0; y < y1; y += 1) {
		for (
			let x = Math.floor(width * BAR_BAND_LEFT);
			x < Math.floor(width * BAR_BAND_RIGHT);
			x += 1
		) {
			const offset = (y * width + x) * 4;
			if (data.data[offset + 3] !== 255) continue;
			reds.push(data.data[offset] ?? 0);
		}
	}
	if (reds.length === 0) {
		return { median: null, min: null, max: null, opaqueCount: 0 };
	}
	reds.sort((left, right) => left - right);
	return {
		median: reds[Math.floor(reds.length / 2)] ?? null,
		min: reds[0] ?? null,
		max: reds[reds.length - 1] ?? null,
		opaqueCount: reds.length,
	};
};

const run = async (): Promise<void> => {
	setStatus(`loading manifest from ${framesOrigin}…`);
	const manifest: Manifest = await (
		await fetch(`${framesOrigin}/manifest.json`)
	).json();

	// The reading order deliberately is NOT monotonic. A forward-only sweep
	// cannot distinguish "shows frame f" from "shows the previously uploaded
	// frame"; jumping backwards and repeating a frame can.
	const readOrder = [0, 1, 59, 119, 59, 0, 119];
	const hrefs = new Map<number, string>();
	for (const index of new Set(readOrder)) {
		const entry = manifest.frames[index];
		if (!entry) throw new Error(`manifest has no frame ${index}`);
		const bytes = await (
			await fetch(`${framesOrigin}/${entry.fileName}`)
		).arrayBuffer();
		// Exactly how `admitFramePackage` materializes a frame.
		hrefs.set(
			index,
			URL.createObjectURL(new Blob([bytes], { type: "image/webp" })),
		);
	}

	const canvas = document.getElementById("probe-canvas") as HTMLCanvasElement;
	let surfaceError: unknown = null;
	const { createBabylonRuntimeSurface } = await import("@/shared/babylon");
	const surface = await createBabylonRuntimeSurface(
		canvas,
		(error) => {
			surfaceError = error;
		},
		{ preserveDrawingBuffer: true },
	);

	const readback = document.createElement("canvas");
	readback.width = VIEWPORT_WIDTH;
	readback.height = VIEWPORT_HEIGHT;
	const context = readback.getContext("2d", {
		alpha: true,
		colorSpace: "srgb",
	});
	if (!context) throw new Error("no 2D readback context");

	const readings: unknown[] = [];
	let failures = 0;
	for (const [step, index] of readOrder.entries()) {
		const href = hrefs.get(index);
		if (!href) throw new Error(`no href for ${index}`);
		await surface.renderFrame(frameFor(sourceFor(manifest, index, href)));
		if (surfaceError) throw surfaceError;
		context.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		context.drawImage(canvas, 0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		const data = context.getImageData(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		const bottom = readBand(data, false, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		const top = readBand(data, true, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		const expected = manifest.blenderFrameStart + index;
		const decodedBottom = bottom.median;
		const decodedTop = top.median;
		const ok = decodedBottom === expected || decodedTop === expected;
		if (!ok) failures += 1;
		readings.push({
			step,
			frameIndex: index,
			expectedBlenderFrame: expected,
			bottomBand: bottom,
			topBand: top,
			matchedBand:
				decodedBottom === expected
					? "bottom"
					: decodedTop === expected
						? "top"
						: null,
			ok,
		});
	}

	// A band that never changed would satisfy nothing above only by accident;
	// recording the distinct decoded values makes a stuck texture unmissable.
	const decoded = readings.map(
		(reading) =>
			(reading as { readonly expectedBlenderFrame: number })
				.expectedBlenderFrame,
	);
	const result = {
		framesOrigin,
		manifest: {
			buildKey: manifest.buildKey,
			frameCount: manifest.frameCount,
			blenderFrameStart: manifest.blenderFrameStart,
			codec: manifest.codec,
			width: manifest.width,
			height: manifest.height,
		},
		readOrder,
		distinctExpected: [...new Set(decoded)].length,
		readings,
		failureCount: failures,
	};
	setStatus(`S4_FRAME_BAND_RESULT ${JSON.stringify(result)}`);
	surface.dispose();
	for (const href of hrefs.values()) URL.revokeObjectURL(href);
};

run().catch((error: unknown) => {
	setStatus(
		`S4_FRAME_BAND_RESULT ${JSON.stringify({
			failureCount: -1,
			error: error instanceof Error ? error.message : String(error),
		})}`,
	);
});
