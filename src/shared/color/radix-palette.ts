/**
 * The Radix Colors palette, reshaped into the editor's swatch model.
 *
 * Radix ships 31 hand-tuned 12-step scales (https://www.radix-ui.com/colors).
 * Every step in the *solid light* scales is already a 6-digit `#rrggbb` string —
 * byte-for-byte what the scene commit gate accepts — so the picker can offer the
 * whole palette without a single conversion or a color the user cannot save.
 *
 * This module makes no product decisions and touches no store or DOM: it only
 * reshapes static data and answers "which Radix step is this color nearest?".
 * That keeps it in `shared/color` alongside the hex/rgb math, importable by every
 * picker surface without crossing the feature→feature boundary.
 *
 * Only the light *solid* scales are used. Alpha (`*A`) and P3 (`*P3`) variants
 * carry 8-digit hex / `color(display-p3 …)` values the scene model rejects, so
 * they are deliberately excluded.
 */
import {
	amber,
	blue,
	bronze,
	brown,
	crimson,
	cyan,
	gold,
	grass,
	gray,
	green,
	indigo,
	iris,
	jade,
	lime,
	mauve,
	mint,
	olive,
	orange,
	pink,
	plum,
	purple,
	red,
	ruby,
	sage,
	sand,
	sky,
	slate,
	teal,
	tomato,
	violet,
	yellow,
} from "@radix-ui/colors";
import { hexToRgb, type Rgb } from "./index";

/** One Radix scale: a stable id, a display label, and its 12 ordered `#rrggbb` steps. */
export type RadixScale = {
	/** Lowercase scale id, e.g. `"blue"` — the search/match key. */
	readonly name: string;
	/** Title-cased label shown in the UI, e.g. `"Blue"`. */
	readonly label: string;
	/** The 12 scale steps, light → dark, as lowercase `#rrggbb`. */
	readonly steps: readonly string[];
};

/** A located step within the palette, returned by {@link nearestRadixStep}. */
export type RadixMatch = {
	readonly scaleIndex: number;
	/** 0-based step index (0 = Radix step 1, 11 = Radix step 12). */
	readonly stepIndex: number;
	readonly scale: RadixScale;
	readonly hex: string;
	/** True when the queried color *is* this step (not merely closest). */
	readonly exact: boolean;
};

const STEPS_PER_SCALE = 12;

/**
 * The raw scales in Radix's own browse order: neutrals, then a warm→cool hue
 * wheel, then the browns and the bright accents. This order is what makes the
 * list scannable — scrolling walks the spectrum the way the eye expects.
 */
const RAW_SCALES: readonly (readonly [string, Record<string, string>])[] = [
	["gray", gray],
	["mauve", mauve],
	["slate", slate],
	["sage", sage],
	["olive", olive],
	["sand", sand],
	["tomato", tomato],
	["red", red],
	["ruby", ruby],
	["crimson", crimson],
	["pink", pink],
	["plum", plum],
	["purple", purple],
	["violet", violet],
	["iris", iris],
	["indigo", indigo],
	["blue", blue],
	["cyan", cyan],
	["teal", teal],
	["jade", jade],
	["green", green],
	["grass", grass],
	["brown", brown],
	["bronze", bronze],
	["gold", gold],
	["sky", sky],
	["mint", mint],
	["lime", lime],
	["yellow", yellow],
	["amber", amber],
	["orange", orange],
];

const titleCase = (name: string): string =>
	name.charAt(0).toUpperCase() + name.slice(1);

/** Pulls a scale's 12 steps in order (`blue1` … `blue12`) into a string array. */
const toSteps = (
	name: string,
	scale: Record<string, string>,
): readonly string[] =>
	Array.from(
		{ length: STEPS_PER_SCALE },
		(_, index) => scale[`${name}${index + 1}`] as string,
	);

/** The full palette, ready for rendering. */
export const RADIX_SCALES: readonly RadixScale[] = RAW_SCALES.map(
	([name, scale]) => ({
		name,
		label: titleCase(name),
		steps: toSteps(name, scale),
	}),
);

/** Per-step RGB, precomputed once so nearest-match is a flat numeric scan. */
const SCALE_RGBS: readonly (readonly Rgb[])[] = RADIX_SCALES.map((scale) =>
	scale.steps.map((hex) => hexToRgb(hex) ?? { r: 0, g: 0, b: 0 }),
);

// Redmean: a cheap, well-known approximation of perceptual RGB distance that
// weights green most and shifts red/blue weight by overall lightness. Good
// enough to pick the *family* a color belongs to without a full Lab conversion.
const RMEAN_DIVISOR = 256;
const RED_WEIGHT_BASE = 2;
const GREEN_WEIGHT = 4;
const BLUE_WEIGHT_BASE = 2;

const distanceSq = (a: Rgb, b: Rgb): number => {
	const rMean = (a.r + b.r) / 2;
	const dr = a.r - b.r;
	const dg = a.g - b.g;
	const db = a.b - b.b;
	return (
		(RED_WEIGHT_BASE + rMean / RMEAN_DIVISOR) * dr * dr +
		GREEN_WEIGHT * dg * dg +
		(BLUE_WEIGHT_BASE + (255 - rMean) / RMEAN_DIVISOR) * db * db
	);
};

/**
 * Finds the Radix step perceptually nearest to `hex`, or null when `hex` is not
 * a parseable color. The result drives the picker's "you are here" indicator and
 * the open-time scroll-to-family, turning the hex field into a Radix locator:
 * paste any color, see the family it lives in.
 */
export function nearestRadixStep(hex: string): RadixMatch | null {
	const target = hexToRgb(hex);
	if (!target) return null;

	let bestScale = 0;
	let bestStep = 0;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let scaleIndex = 0; scaleIndex < SCALE_RGBS.length; scaleIndex += 1) {
		const rgbs = SCALE_RGBS[scaleIndex];
		for (let stepIndex = 0; stepIndex < rgbs.length; stepIndex += 1) {
			const distance = distanceSq(target, rgbs[stepIndex]);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestScale = scaleIndex;
				bestStep = stepIndex;
			}
		}
	}

	const scale = RADIX_SCALES[bestScale];
	const matchHex = scale.steps[bestStep];
	return {
		scaleIndex: bestScale,
		stepIndex: bestStep,
		scale,
		hex: matchHex,
		exact: bestDistance === 0,
	};
}
