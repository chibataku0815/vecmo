import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Generates a same-origin, hand-authored equirectangular Radiance `.hdr`
 * environment used by the flag-gated Babylon PBR/IBL candidate path
 * (`src/shared/babylon/runtime.ts`). No CDN and no network fetch: this file
 * is committed to `public/runtime-3d/` and read at editor/export runtime.
 *
 * The panorama is achromatic (R=G=B everywhere) and intentionally simple: a
 * smooth sky-to-ground luminance ramp plus one soft key highlight and one
 * weak fill highlight, both gaussian falloff. This is a neutral studio for
 * material readability, not an art-directed environment.
 */

const OUTPUT_PATH = path.resolve(
	process.cwd(),
	"public/runtime-3d/studio-neutral-128x64.hdr",
);

const WIDTH = 128;
const HEIGHT = 64;

/** Upper-hemisphere luminance at the +Y pole (straight up). */
const ZENITH = 1.6;
/** Luminance at the equator (elevation 0), shared by both hemisphere ramps. */
const HORIZON = 0.55;
/** Lower-hemisphere luminance at the -Y pole (straight down). */
const FLOOR = 0.12;

const KEY_AZIMUTH_DEG = 40;
const KEY_ELEVATION_DEG = 35;
const KEY_RADIUS_DEG = 28;
/**
 * P6-B: lowered from `14.0`. IBL contributes ambient/specular energy that the
 * shadow generator cannot shadow (shadows only darken the analytic key light
 * below), so a large baked-in key blob dominated ground/sphere brightness
 * regardless of the analytic shadow, making contact shadows read as
 * near-invisible even when geometrically correct. Blob position/radius are
 * unchanged, so the key's reflection on glossy metals stays in the same
 * place — just dimmer — while `PBR_KEY_INTENSITY` in
 * `src/shared/babylon/runtime.ts` makes up the shadowable share of that same
 * energy so overall brightness is preserved.
 */
const KEY_PEAK = 3.0;

const FILL_AZIMUTH_DEG = 220;
const FILL_ELEVATION_DEG = 15;
const FILL_RADIUS_DEG = 45;
const FILL_PEAK = 1.1;

/** Shared gaussian falloff coefficient for both the key and fill highlights. */
const HIGHLIGHT_FALLOFF_COEFFICIENT = 2.5;

/** Below this radiance, Radiance/RGBE treats the pixel as exact black. */
const RGBE_MIN_VALUE = 1e-32;

const DEG_TO_RAD = Math.PI / 180;

/** Smooth Hermite interpolant, `t` clamped to [0, 1] first. */
const smoothstep = (t: number): number => {
	const clamped = Math.min(1, Math.max(0, t));
	return clamped * clamped * (3 - 2 * clamped);
};

/**
 * Base achromatic sky/ground luminance for a given elevation, in degrees,
 * where +90 is straight up and -90 is straight down. Ramps `ZENITH` ->
 * `HORIZON` over the upper hemisphere and `HORIZON` -> `FLOOR` over the lower
 * hemisphere, both via {@link smoothstep} on normalized elevation.
 */
const baseLuminance = (elevationDeg: number): number => {
	if (elevationDeg >= 0) {
		const t = smoothstep(elevationDeg / 90);
		return HORIZON + (ZENITH - HORIZON) * t;
	}
	const t = smoothstep(-elevationDeg / 90);
	return HORIZON + (FLOOR - HORIZON) * t;
};

/** Unit direction vector for a spherical (azimuth, elevation) pair, in degrees. */
const directionVector = (
	azimuthDeg: number,
	elevationDeg: number,
): readonly [number, number, number] => {
	const azimuth = azimuthDeg * DEG_TO_RAD;
	const elevation = elevationDeg * DEG_TO_RAD;
	const cosElevation = Math.cos(elevation);
	return [
		cosElevation * Math.cos(azimuth),
		cosElevation * Math.sin(azimuth),
		Math.sin(elevation),
	];
};

/** Angular separation, in degrees, between two spherical directions. */
const angularDistanceDeg = (
	azimuthADeg: number,
	elevationADeg: number,
	azimuthBDeg: number,
	elevationBDeg: number,
): number => {
	const a = directionVector(azimuthADeg, elevationADeg);
	const b = directionVector(azimuthBDeg, elevationBDeg);
	const dot = Math.min(
		1,
		Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
	);
	return Math.acos(dot) / DEG_TO_RAD;
};

/**
 * Added radiance from one circular gaussian-falloff highlight, zero beyond
 * `radiusDeg` per the decided `exp(-(d/r)^2 * 2.5)` shape.
 */
const highlightContribution = (
	azimuthDeg: number,
	elevationDeg: number,
	centerAzimuthDeg: number,
	centerElevationDeg: number,
	radiusDeg: number,
	peak: number,
): number => {
	const distanceDeg = angularDistanceDeg(
		azimuthDeg,
		elevationDeg,
		centerAzimuthDeg,
		centerElevationDeg,
	);
	if (distanceDeg >= radiusDeg) return 0;
	const normalized = distanceDeg / radiusDeg;
	return (
		peak * Math.exp(-(normalized * normalized) * HIGHLIGHT_FALLOFF_COEFFICIENT)
	);
};

/**
 * Encodes one achromatic radiance value into a 4-byte Radiance RGBE pixel,
 * the exact inverse of Babylon's `Rgbe2float` decoder
 * (`@babylonjs/core/Misc/HighDynamicRange/hdr.js`): decode computes
 * `factor = 2^(e - 128 - 8)` from the stored exponent byte, so encoding must
 * choose `e` such that `radiance = mantissaByte * 2^(e - 136)`.
 */
const toRgbePixel = (
	radiance: number,
): readonly [number, number, number, number] => {
	if (radiance < RGBE_MIN_VALUE) return [0, 0, 0, 0];
	const exponent = Math.floor(Math.log2(radiance)) + 1;
	const scale = 2 ** (8 - exponent);
	const channelByte = Math.min(255, Math.max(0, Math.round(radiance * scale)));
	const exponentByte = Math.min(255, Math.max(0, exponent + 128));
	return [channelByte, channelByte, channelByte, exponentByte];
};

/**
 * Builds the flat (non-run-length-encoded) RGBE pixel body, top row first,
 * matching Babylon's `ReadRGBEPixelsNotRLE` fallback: `RGBE_ReadPixels` only
 * takes the RLE path when a scanline's first two mantissa bytes are both
 * exactly `2`, which cannot happen here since every channel of an achromatic
 * pixel carries the normalized [128, 255] mantissa byte of the max channel.
 */
const buildPixelBody = (): Buffer => {
	const body = Buffer.alloc(WIDTH * HEIGHT * 4);
	let offset = 0;
	for (let row = 0; row < HEIGHT; row += 1) {
		const elevationDeg = 90 - (180 * (row + 0.5)) / HEIGHT;
		for (let col = 0; col < WIDTH; col += 1) {
			const azimuthDeg = (360 * (col + 0.5)) / WIDTH;
			const radiance =
				baseLuminance(elevationDeg) +
				highlightContribution(
					azimuthDeg,
					elevationDeg,
					KEY_AZIMUTH_DEG,
					KEY_ELEVATION_DEG,
					KEY_RADIUS_DEG,
					KEY_PEAK,
				) +
				highlightContribution(
					azimuthDeg,
					elevationDeg,
					FILL_AZIMUTH_DEG,
					FILL_ELEVATION_DEG,
					FILL_RADIUS_DEG,
					FILL_PEAK,
				);
			const [r, g, b, e] = toRgbePixel(radiance);
			body[offset] = r;
			body[offset + 1] = g;
			body[offset + 2] = b;
			body[offset + 3] = e;
			offset += 4;
		}
	}
	return body;
};

/**
 * Radiance header Babylon's `RGBE_ReadHeader` requires: a `#?` magic line, a
 * `FORMAT=32-bit_rle_rgbe` line (required even though the body below is
 * flat/non-RLE — the reader auto-detects per scanline), a blank line ending
 * the header, and a `-Y <height> +X <width>` resolution line. All lines use
 * bare `\n`; `ReadStringLine` splits on `\n` only.
 */
const buildHeader = (): Buffer =>
	Buffer.from(
		`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`,
		"ascii",
	);

const main = (): void => {
	mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
	const file = Buffer.concat([buildHeader(), buildPixelBody()]);
	writeFileSync(OUTPUT_PATH, file);
	console.log(`Wrote ${file.byteLength} bytes to ${OUTPUT_PATH}`);
};

main();
