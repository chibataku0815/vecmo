import { hexToRgb } from "@/shared/color";

/**
 * Converts an arbitrary string (typically a Look Graph node id or kind) into a
 * valid DCTL/C identifier fragment: lowercase ASCII alphanumerics and
 * underscores only, never starting with a digit. Node ids and kinds can carry
 * hyphens (`"color-map"`) or other characters DCTL's C-like grammar rejects in
 * a variable or function name.
 */
export const dctlIdentifierSegment = (value: string): string => {
	const cleaned = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/gu, "_")
		.replace(/^_+|_+$/gu, "");
	const segment = cleaned.length > 0 ? cleaned : "node";
	return /^[0-9]/u.test(segment) ? `n_${segment}` : segment;
};

/**
 * Formats a finite number as a DCTL float literal that always carries a
 * decimal point (DCTL, like C, treats a bare integer literal as an `int`
 * where a `float` is expected in some contexts). Non-finite input is baked as
 * `0.0` rather than emitting `NaN`/`Infinity`, which DCTL cannot parse.
 */
export const dctlFloat = (value: number): string => {
	const safe = Number.isFinite(value) ? value : 0;
	let text = safe.toFixed(6);
	text = text.replace(/0+$/u, "");
	if (text.endsWith(".")) text += "0";
	return text;
};

/** Formats a finite number as a DCTL integer literal (rounded toward nearest). */
export const dctlInt = (value: number): string =>
	String(Math.round(Number.isFinite(value) ? value : 0));

/** Formats a `0`/`1` RGB triple as a `make_float3(...)` constant expression. */
export const dctlFloat3 = (r: number, g: number, b: number): string =>
	`make_float3(${dctlFloat(r)}, ${dctlFloat(g)}, ${dctlFloat(b)})`;

/**
 * Parses a `#rrggbb` hex color at codegen time and bakes it as a
 * `make_float3(...)` constant (0..1 channels). Falls back to black for an
 * invalid hex — the same fail-closed default {@link hexToRgb} callers use
 * elsewhere — since DCTL has no runtime string parsing to defer to.
 */
export const dctlFloat3FromHex = (hex: string): string => {
	const rgb = hexToRgb(hex);
	return rgb
		? dctlFloat3(rgb.r / 255, rgb.g / 255, rgb.b / 255)
		: dctlFloat3(0, 0, 0);
};
