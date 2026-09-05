import { encodePngDataUrl } from "@/shared/mesh-raster/png";

/** Radial warp field shape: `radial` bulges/pinches, `twirl` swirls around the centre. */
export type WarpMode = "radial" | "twirl";

/**
 * Generates the displacement map a radial warp ("bulge"/"pinch") feeds into an SVG
 * `feDisplacementMap`. Pure and DOM-free (no Canvas2D) so it runs in the editor,
 * both SVG exporters, AND the Cloudflare Worker — the map is a `data:image/png`
 * URL embedded as an `feImage`, which (verified) survives editor render, exported
 * SVG, and the WebM SVG→canvas capture path alike.
 *
 * The map encodes an outward radial direction field: R = horizontal offset from the
 * centre, G = vertical offset (128 = no displacement, per the `feDisplacementMap`
 * `C − 0.5` convention). The displacement MAGNITUDE is the `feDisplacementMap`
 * `scale` (the node's bipolar strength), so the map depends only on the centre —
 * which is why it is memoized: animating strength never regenerates it, and a
 * static centre is generated once.
 */

/**
 * Map resolution. The radial field is smooth and linear, so a small map upscaled by
 * `feImage width="100%"` is indistinguishable from a full-resolution one while
 * keeping the embedded data-URL tiny.
 */
const WARP_MAP_SIZE = 64;

/**
 * Channel gain. The encoded displacement is `offset · distance` (a QUADRATIC radial
 * field, not a linear one — a linear field is merely an affine scale-about-centre
 * and leaves straight lines straight; multiplying by distance makes outer pixels
 * displace more, so lines bow into a real barrel/pincushion warp). Peak magnitude
 * at a corner with the centre at (0.5, 0.5) is `0.5 · √0.5 ≈ 0.354`; gain maps that
 * onto the full ±127 either side of the 128 neutral.
 */
const CHANNEL_GAIN = 127 / (0.5 * Math.SQRT1_2);

const NEUTRAL = 128;

const clampByte = (value: number): number =>
	value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

/** Tangential gain for the `twirl` field (peak swirl displacement near the centre). */
const TWIRL_GAIN = 200;
/** Twirl swirl fades to zero by this normalized radius. */
const TWIRL_REACH = Math.SQRT1_2;

const cacheKey = (mode: WarpMode, centerX: number, centerY: number): string =>
	`${mode}:${centerX.toFixed(4)}:${centerY.toFixed(4)}`;

/** Bounded memo: the map depends only on mode + centre (strength rides scale). */
const MAP_CACHE = new Map<string, string>();
const MAP_CACHE_LIMIT = 32;

/**
 * Returns a `data:image/png` displacement map centred at (`centerX`, `centerY`),
 * both normalized 0..1. `radial` encodes an outward direction × distance (quadratic
 * → lines bow into a real barrel/pincushion; a positive `feDisplacementMap` scale
 * bulges, negative pinches). `twirl` encodes a TANGENTIAL field (perpendicular to
 * the radius) fading out by {@link TWIRL_REACH}, so a positive scale swirls one way
 * and negative the other. The strength is the `feDisplacementMap` scale, so the map
 * depends only on mode + centre and is memoized.
 */
export const warpMapDataUrl = (
	mode: WarpMode,
	centerX: number,
	centerY: number,
): string => {
	const key = cacheKey(mode, centerX, centerY);
	const cached = MAP_CACHE.get(key);
	if (cached !== undefined) return cached;

	const size = WARP_MAP_SIZE;
	const pixels = new Uint8ClampedArray(size * size * 4);
	const last = size - 1;
	for (let y = 0; y < size; y++) {
		const offY = y / last - centerY;
		for (let x = 0; x < size; x++) {
			const offX = x / last - centerX;
			const distance = Math.hypot(offX, offY);
			const index = (y * size + x) * 4;
			let dx: number;
			let dy: number;
			if (mode === "twirl") {
				// Tangential (perpendicular to the radius), fading out by TWIRL_REACH:
				// rotates content around the centre. Monotone falloff avoids folds.
				const falloff = Math.max(0, 1 - distance / TWIRL_REACH);
				dx = -offY * falloff * TWIRL_GAIN;
				dy = offX * falloff * TWIRL_GAIN;
			} else {
				// Radial direction × distance = quadratic falloff → lines bow (a true
				// barrel/pincushion), not the straight-line affine scale a linear field
				// gives. feDisplacementMap scale (the node strength) sets magnitude.
				dx = offX * distance * CHANNEL_GAIN;
				dy = offY * distance * CHANNEL_GAIN;
			}
			pixels[index] = clampByte(NEUTRAL + dx);
			pixels[index + 1] = clampByte(NEUTRAL + dy);
			pixels[index + 2] = 0;
			pixels[index + 3] = 255;
		}
	}
	const url = encodePngDataUrl(pixels, size, size);

	if (MAP_CACHE.size >= MAP_CACHE_LIMIT) {
		const oldest = MAP_CACHE.keys().next().value;
		if (oldest !== undefined) MAP_CACHE.delete(oldest);
	}
	MAP_CACHE.set(key, url);
	return url;
};
