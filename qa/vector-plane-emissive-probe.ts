/**
 * Vector-plane emissive probe: does `createVectorPlane`
 * (`src/shared/babylon/runtime.ts`) actually show the vector texture's colour,
 * or does `disableLighting` with no `emissiveColor` sink it to black the same
 * way `createFrameSequencePlacement` did before 8400f90c?
 *
 * Throwaway, dev-only QA harness. Nothing links here and no build entry
 * references it. It drives the real `createBabylonRuntimeSurface` adapter with
 * one hand-built `Runtime3dFrame` carrying a single `Runtime3dVectorPlane`,
 * exercising the exact same `createVectorPlane` code path a real vector plane
 * placement would.
 *
 * The texture is a solid `rgb(200,100,50)` opaque PNG data URI (rasterized
 * via `<canvas>.toDataURL`) rather than the production `svg-data-url` —
 * `createVectorPlane` only ever reads `plane.texture.uri` as a generic image
 * source for `new Texture(uri, scene, ...)`, so the raster format is
 * immaterial to the material/shader defect under test. The substitution is
 * load-bearing for THIS harness only: in this tool's headless browser pane
 * `document.visibilityState` stays `"hidden"`, and Chromium's SVG decode
 * pipeline (unlike its raster-image decode) apparently never completes for a
 * hidden document — measured directly: an SVG data URI `Texture` never
 * reached `isReady()` after 6s while an otherwise-identical PNG data URI
 * `Texture` reached it in <1s. That stall is a property of this automation
 * environment, not of `createVectorPlane` or production SVG rasterization.
 *
 * The known colour matches what a prior session (commit 8400f90c's message)
 * fed through the unfixed `createVectorPlane` and read back as
 * `(0,0,0,255)` at the center pixel. This probe reproduces that reading from
 * the SAME unfixed code path (not cited from memory) and then re-reads after
 * the emissive fix lands.
 *
 * Serve with a Vite dev instance (any free port) and open
 * `/qa/vector-plane-emissive-probe.html`.
 */

import type {
	Runtime3dCamera,
	Runtime3dCoordinateContract,
	Runtime3dFrame,
	Runtime3dVectorPlane,
	Runtime3dWorldMatrix,
} from "@/shared/runtime-3d/types";

const VIEWPORT_WIDTH = 640;
const VIEWPORT_HEIGHT = 360;
const NODE_ID = "vector-plane-emissive-probe";
const ARTBOARD_ID = "vector-plane-emissive-probe-artboard";

/** The known colour the prior session fed through the unfixed code path. */
const KNOWN_RGB = { r: 200, g: 100, b: 50 };
const TEXTURE_SIZE = 64;

/** Fraction of the readback sampled for the median, centered on the plane. */
const SAMPLE_HALF_EXTENT = 0.15;

const statusElement = document.getElementById("status");
const setStatus = (text: string): void => {
	if (statusElement) statusElement.textContent = text;
};

const COORDINATES: Runtime3dCoordinateContract = {
	handedness: "right-handed",
	xAxis: "right",
	yAxis: "down",
	zAxis: "scene-depth",
	fovAxis: "vertical",
};

const identityWorldMatrix: Runtime3dWorldMatrix = [
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/**
 * Orthographic and framed so the unit-size vector plane covers the viewport
 * exactly — same rig `qa/s4-frame-band-probe.ts` uses for its frame-sequence
 * quad, so a pixel disagreement here is the material's, not a projection
 * mismatch.
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

/** Solid opaque `KNOWN_RGB` square, encoded as a PNG data URI. See module doc. */
const knownColorPngDataUrl = (): string => {
	const canvas = document.createElement("canvas");
	canvas.width = TEXTURE_SIZE;
	canvas.height = TEXTURE_SIZE;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("no 2D context to rasterize the probe texture");
	context.fillStyle = `rgb(${KNOWN_RGB.r},${KNOWN_RGB.g},${KNOWN_RGB.b})`;
	context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
	return canvas.toDataURL("image/png");
};

const vectorPlaneFor = (): Runtime3dVectorPlane => {
	const uri = knownColorPngDataUrl();
	return {
		nodeId: NODE_ID,
		sourceNodeId: NODE_ID,
		artboardId: ARTBOARD_ID,
		worldMatrix: identityWorldMatrix,
		opacity: 1,
		visible: true,
		pickable: true,
		rasterBounds: { x: 0, y: 0, width: TEXTURE_SIZE, height: TEXTURE_SIZE },
		texture: {
			kind: "svg-data-url",
			uri,
			cacheKey: `vector-plane-emissive-probe:${uri.length}`,
		},
	};
};

const frameFor = (): Runtime3dFrame => ({
	frame: 0,
	viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, dpr: 1 },
	camera: camera(),
	artboardClips: [],
	placements: [],
	vectorPlanes: [vectorPlaneFor()],
	issues: [],
});

type PixelReading = {
	readonly medianR: number | null;
	readonly medianG: number | null;
	readonly medianB: number | null;
	readonly opaqueCount: number;
	readonly sampleCount: number;
};

/** Median RGB over a centered square, counting only fully opaque pixels. */
const readCenter = (
	data: ImageData,
	width: number,
	height: number,
): PixelReading => {
	const reds: number[] = [];
	const greens: number[] = [];
	const blues: number[] = [];
	let sampleCount = 0;
	const x0 = Math.floor(width * (0.5 - SAMPLE_HALF_EXTENT));
	const x1 = Math.floor(width * (0.5 + SAMPLE_HALF_EXTENT));
	const y0 = Math.floor(height * (0.5 - SAMPLE_HALF_EXTENT));
	const y1 = Math.floor(height * (0.5 + SAMPLE_HALF_EXTENT));
	for (let y = y0; y < y1; y += 1) {
		for (let x = x0; x < x1; x += 1) {
			sampleCount += 1;
			const offset = (y * width + x) * 4;
			if (data.data[offset + 3] !== 255) continue;
			reds.push(data.data[offset] ?? 0);
			greens.push(data.data[offset + 1] ?? 0);
			blues.push(data.data[offset + 2] ?? 0);
		}
	}
	const median = (values: number[]): number | null => {
		if (values.length === 0) return null;
		const sorted = [...values].sort((left, right) => left - right);
		return sorted[Math.floor(sorted.length / 2)] ?? null;
	};
	return {
		medianR: median(reds),
		medianG: median(greens),
		medianB: median(blues),
		opaqueCount: reds.length,
		sampleCount,
	};
};

const run = async (): Promise<void> => {
	setStatus("booting Babylon surface…");
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
	setStatus("rendering frame…");

	await surface.renderFrame(frameFor());
	if (surfaceError) throw surfaceError;

	const readback = document.createElement("canvas");
	readback.width = VIEWPORT_WIDTH;
	readback.height = VIEWPORT_HEIGHT;
	const context = readback.getContext("2d", {
		alpha: true,
		colorSpace: "srgb",
	});
	if (!context) throw new Error("no 2D readback context");
	context.drawImage(canvas, 0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	const data = context.getImageData(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	const reading = readCenter(data, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

	const result = {
		knownColor: KNOWN_RGB,
		reading,
		matchesKnownColor:
			reading.medianR !== null &&
			reading.medianG !== null &&
			reading.medianB !== null &&
			Math.abs(reading.medianR - KNOWN_RGB.r) <= 2 &&
			Math.abs(reading.medianG - KNOWN_RGB.g) <= 2 &&
			Math.abs(reading.medianB - KNOWN_RGB.b) <= 2,
	};
	setStatus(`VECTOR_PLANE_EMISSIVE_RESULT ${JSON.stringify(result)}`);
	surface.dispose();
};

run().catch((error: unknown) => {
	setStatus(
		`VECTOR_PLANE_EMISSIVE_RESULT ${JSON.stringify({
			error: error instanceof Error ? error.message : String(error),
		})}`,
	);
});
