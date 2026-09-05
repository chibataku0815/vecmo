/**
 * Pure color math for the in-app color picker: hex ↔ rgb ↔ hsv.
 *
 * This module makes no product decisions and touches no store or DOM, so every
 * picker surface (inspector widget, gradient + mesh features) can depend on it
 * without breaking the downward-only import rule.
 *
 * Design rules that keep dragging stable and commits valid:
 * - RGB channels are integers 0..255 (the scale every in-repo parser and the
 *   user-facing R/G/B fields use). Never mix in a 0..1 scale.
 * - HSV is `h ∈ [0,360)`, `s,v ∈ [0,1]`, held UNROUNDED in component state;
 *   rounding happens once, at the rgb→hex boundary, so dragging value at a
 *   constant hue does not accumulate drift.
 * - {@link rgbToHsv} takes an optional `prev` hint because hue is undefined for
 *   grays (chroma 0) and saturation is undefined for black (v 0). Without the
 *   hint the SV/hue cursor snaps to 0 and jumps mid-drag. The hint keeps the
 *   module pure (no hidden "last hue" state) while letting the component pass
 *   its live h/s.
 * - {@link hexToRgb}'s accepted set is byte-for-byte identical to the scene
 *   commit gate ({@link normalizeHex}): lowercase, `#abc`→`#aabbcc`, `#rrggbb`;
 *   8-digit / `rgb()` / `hsl()` / named / a missing `#` are rejected. A picker
 *   that accepted more would let a user author a color they cannot save.
 */

/** Integer RGB channels, each 0..255. */
export type Rgb = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
};

/** HSV with `h ∈ [0,360)` and `s`, `v ∈ [0,1]`. */
export type Hsv = {
	readonly h: number;
	readonly s: number;
	readonly v: number;
};

const HEX_SHORT = /^#([\da-f])([\da-f])([\da-f])$/u;
const HEX_FULL = /^#[\da-f]{6}$/u;
const CHANNEL_MAX = 255;
const HUE_MAX = 360;
const HUE_SECTOR = 60;

const clampChannel = (value: number): number =>
	Math.max(0, Math.min(CHANNEL_MAX, Math.round(value)));

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const wrapHue = (hue: number): number => {
	const wrapped = hue % HUE_MAX;
	return wrapped < 0 ? wrapped + HUE_MAX : wrapped;
};

const toHexChannel = (value: number): string =>
	clampChannel(value).toString(16).padStart(2, "0");

/**
 * Canonicalizes a hex string to lowercase `#rrggbb`, expanding `#abc`. Returns
 * null for anything the scene model rejects (8-digit, `rgb()`, named, no `#`).
 * This is the single home for the picker/commit accepted-set rule.
 */
export function normalizeHex(input: string): string | null {
	const value = input.trim().toLowerCase();
	const short = HEX_SHORT.exec(value);
	if (short) {
		const [, r, g, b] = short;
		return `#${r}${r}${g}${g}${b}${b}`;
	}
	return HEX_FULL.test(value) ? value : null;
}

/**
 * Parses a hex color to integer RGB, or null when invalid. Accepts exactly what
 * {@link normalizeHex} accepts. Never throws.
 */
export function hexToRgb(input: string): Rgb | null {
	const hex = normalizeHex(input);
	if (!hex) return null;
	return {
		r: Number.parseInt(hex.slice(1, 3), 16),
		g: Number.parseInt(hex.slice(3, 5), 16),
		b: Number.parseInt(hex.slice(5, 7), 16),
	};
}

/** Serializes integer RGB to lowercase `#rrggbb` (rounds + clamps each channel). */
export function rgbToHex(rgb: Rgb): string {
	return `#${toHexChannel(rgb.r)}${toHexChannel(rgb.g)}${toHexChannel(rgb.b)}`;
}

/**
 * Converts RGB to HSV. `prev` supplies the hue to keep when the color is gray
 * (chroma 0) and the saturation to keep when the color is black (v 0); both
 * default to 0. Pass the component's live `{ h, s }` so the cursor does not jump
 * at the gray/black degeneracies.
 */
export function rgbToHsv(
	rgb: Rgb,
	prev?: { readonly h?: number; readonly s?: number },
): Hsv {
	const r = clampChannel(rgb.r) / CHANNEL_MAX;
	const g = clampChannel(rgb.g) / CHANNEL_MAX;
	const b = clampChannel(rgb.b) / CHANNEL_MAX;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	const v = max;
	const s = max === 0 ? (prev?.s ?? 0) : delta / max;

	if (delta === 0) {
		return { h: wrapHue(prev?.h ?? 0), s, v };
	}

	let h: number;
	if (max === r) h = (g - b) / delta;
	else if (max === g) h = (b - r) / delta + 2;
	else h = (r - g) / delta + 4;
	h *= HUE_SECTOR;

	return { h: wrapHue(h), s, v };
}

/** Converts HSV to integer RGB. Clamps inputs (`h` wraps, `s`/`v` clamp to 0..1). */
export function hsvToRgb(hsv: Hsv): Rgb {
	const h = wrapHue(hsv.h);
	const s = clamp01(hsv.s);
	const v = clamp01(hsv.v);

	const c = v * s;
	const x = c * (1 - Math.abs(((h / HUE_SECTOR) % 2) - 1));
	const m = v - c;
	const sector = Math.floor(h / HUE_SECTOR);

	const [r, g, b] =
		sector === 0
			? [c, x, 0]
			: sector === 1
				? [x, c, 0]
				: sector === 2
					? [0, c, x]
					: sector === 3
						? [0, x, c]
						: sector === 4
							? [x, 0, c]
							: [c, 0, x];

	return {
		r: clampChannel((r + m) * CHANNEL_MAX),
		g: clampChannel((g + m) * CHANNEL_MAX),
		b: clampChannel((b + m) * CHANNEL_MAX),
	};
}
