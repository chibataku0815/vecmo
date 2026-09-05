/**
 * Builds the "Embeddable Motion Artifact" palette manifest embedded into
 * runtime.js exports — both `code.ts`'s `createMotionCodeRuntimeAsset` (SVG)
 * and `webgl-player.ts`'s `createWebglPlayerRuntimeAsset` (WebGL) call
 * {@link buildPaletteManifest} against their own serialized runtime payload,
 * so the manifest can never drift between the two artifact kinds — the walk,
 * the semantic-role scoring, and color-token normalization all live here
 * exactly once.
 *
 * The manifest is a flat slot/role name -> default color-string map: `color1`,
 * `color2`, ... in first-occurrence traversal order, plus (when assignable)
 * the semantic roles `background`, `night`, `paper`, `accent`. A host passes
 * any of these names back into `mount(el, { palette })` to recolor an
 * exported artifact without touching the render pipeline. `normalizeColorToken`
 * recognizes `#hex` plus the closed set of CSS Color 4 functional notations in
 * {@link PALETTE_COLOR_FUNCTION_PATTERN} (`rgb()`/`hsl()`/`oklch()`/...) — see
 * its own doc comment for exactly what is and is not covered. This module's
 * `resolvePaletteReplacements`/`applyPaletteReplacements` mount-time
 * counterparts are duplicated (never imported) in TWO other places, both of
 * which must be kept byte-for-byte in sync with any change to the
 * recognition/canonicalization logic here: `webgl-player-runtime.ts` (a real
 * bundled TS module, which deliberately omits this file's build-time-only
 * semantic-role scoring so that math never ships in the WebGL runtime
 * bundle) and `RUNTIME_PLAYER_SOURCE` inside `code.ts` (a `String.raw` plain-
 * JS string template, since that runtime ships as a self-contained script
 * rather than a bundled module and so cannot import this file at all).
 */

const PALETTE_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Closed set of CSS Color 4 functional color notations recognized alongside
 * `#hex`. Deliberately closed and anchored: {@link walkColors} scans every
 * string anywhere in a scene payload (node names, technique ids, easing
 * curves, ...), so a permissive `\w+\(.+\)` match would false-positive on
 * unrelated function-shaped strings (a `matrix(...)` transform, a
 * `cubic-bezier(...)` easing, a `url(#foo)` paint-server reference). Only
 * these exact function names are ever treated as color candidates. CSS named
 * colors (`"red"`) and keywords (`currentColor`, `transparent`) are
 * deliberately NOT recognized — see {@link normalizeColorToken}'s doc comment.
 */
const PALETTE_COLOR_FUNCTION_PATTERN =
	/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((.+)\)$/i;

/**
 * Canonicalizes a CSS color function's argument list to one spelling: legacy
 * comma-separated args and modern space-separated args collapse to the same
 * space-separated form, `/`-alpha spacing is normalized, and interior
 * whitespace collapses to one space. This is SYNTAX canonicalization only —
 * no numeric or unit math — so `rgb(29, 31, 35)` and `rgb(29 31 35)` collapse
 * to the same slot while `rgb(29 31 35)` and the same color spelled as
 * `rgb(11.4% 12.2% 13.7%)` do NOT, and neither do the legacy 4-arg
 * `rgba(r,g,b,a)` alpha spelling and its modern `rgb(r g b / a)` equivalent
 * (different function name AND different separator). Two un-merged spellings
 * of the same rendered color simply become two independently-substitutable
 * slots instead of one shared slot — never a fidelity loss, only a missed
 * dedup. Returns `null` for an empty/whitespace-only argument list.
 */
const canonicalizeColorFunctionArgs = (rawArgs: string): string | null => {
	const args = rawArgs
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(" ")
		.replace(/\s*\/\s*/g, " / ")
		.replace(/\s+/g, " ")
		.trim();
	return args.length > 0 ? args : null;
};

/**
 * Minimum HSL saturation (0-1) for a color to be considered for the `accent`
 * role. Below this threshold a color reads as a near-neutral gray, so it is
 * excluded from accent candidacy entirely (never merely down-ranked).
 */
const ACCENT_MIN_SATURATION = 0.2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Recognizes and canonicalizes a color string in any form this module slots:
 * `#hex` (3/4/6/8-digit — lowercased, shorthand expanded to 6/8-digit) or one
 * of the closed {@link PALETTE_COLOR_FUNCTION_PATTERN} functional notations
 * (syntax-canonicalized by {@link canonicalizeColorFunctionArgs}). Returns
 * `null` for anything else, including a syntactically-plausible but
 * unrecognized function name, a CSS named color (`"red"`), or a keyword
 * (`currentColor`, `transparent`) — none of those are addressed by this
 * function; a named/keyword color that reaches a scene document (e.g. via
 * raw SVG import passthrough) is left un-slotted rather than risking a false-
 * positive match against an unrelated payload string. Two differently-cased,
 * shorthand/full, or comma/space spellings of the identical color always
 * normalize to the same string, which is what lets slot/role dedup and
 * mount-time replacement matching agree with each other.
 */
export const normalizeColorToken = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (PALETTE_HEX_COLOR_PATTERN.test(trimmed)) {
		const lower = trimmed.toLowerCase();
		const digits = lower.slice(1);
		if (digits.length === 3 || digits.length === 4) {
			return `#${digits
				.split("")
				.map((digit) => digit + digit)
				.join("")}`;
		}
		return lower;
	}
	const match = PALETTE_COLOR_FUNCTION_PATTERN.exec(trimmed);
	if (!match) return null;
	const name = match[1]?.toLowerCase();
	const args = match[2] ? canonicalizeColorFunctionArgs(match[2]) : null;
	return name && args ? `${name}(${args})` : null;
};

/** A normalized color token (hex or a recognized CSS color function) found while walking a payload, with its usage count and stable first-occurrence index. */
type WalkedColor = {
	readonly normalized: string;
	readonly count: number;
	readonly firstIndex: number;
};

/**
 * Shared counting/ordering core for both color walks below: `visitAll` calls
 * its `visit` callback once per candidate raw value it finds (in whatever
 * traversal order that walk defines); this function normalizes, dedups by
 * normalized value, counts occurrences, and records each color's stable
 * first-occurrence index within THAT walk's own traversal — so the whole-
 * payload walk and the paint-only walk each get self-consistent, independent
 * tie-break ordering.
 */
const collectWalkedColors = (
	visitAll: (visit: (raw: unknown) => void) => void,
): readonly WalkedColor[] => {
	const order: string[] = [];
	const counts = new Map<string, number>();
	visitAll((raw) => {
		const normalized = normalizeColorToken(raw);
		if (!normalized) return;
		const count = counts.get(normalized) ?? 0;
		counts.set(normalized, count + 1);
		if (count === 0) order.push(normalized);
	});
	return order.map((normalized, firstIndex) => ({
		normalized,
		count: counts.get(normalized) ?? 1,
		firstIndex,
	}));
};

/**
 * Deep-walks `payload` (object keys in insertion order, arrays by index)
 * collecting every distinct normalized color token found ANYWHERE in the
 * payload, regardless of whether it paints a pixel (a disabled drop-shadow
 * color or a dither-ink swatch counts here). This is deliberately permissive
 * because it feeds only the `colorN` auto slots: a host that names `color7`
 * explicitly chose it, so it may as well be addressable even when inert.
 * Dedup is by NORMALIZED value (not raw string) so `"#fff"`/`"#FFFFFF"` and
 * `"rgb(1,2,3)"`/`"rgb(1 2 3)"` are each recognized as the same color —
 * matching how mount-time replacement matching already normalizes before
 * comparing (see {@link normalizeColorToken}). Every string anywhere in the
 * payload is a candidate here, which is exactly why {@link normalizeColorToken}
 * keeps its recognized-function list closed: a permissive matcher would pull
 * unrelated function-shaped strings (easing curves, transforms) into the
 * auto-slot list. Semantic roles use the narrower {@link walkPaintColors}
 * instead — see its doc comment.
 */
const walkColors = (payload: unknown): readonly WalkedColor[] =>
	collectWalkedColors((visit) => {
		const walk = (value: unknown): void => {
			if (typeof value === "string") {
				visit(value);
				return;
			}
			if (Array.isArray(value)) {
				for (const item of value) walk(item);
				return;
			}
			if (isRecord(value)) {
				for (const key of Object.keys(value)) walk(value[key]);
			}
		};
		walk(payload);
	});

/**
 * Reads one {@link Paint}'s own color(s) into `visit`, skipping the paint
 * entirely when `visible === false` — a toggled-off fill/stroke entry paints
 * no pixel, so it must never win a semantic role. Gradient stops and mesh
 * points are walked regardless of the paint's own `opacity`; only the
 * boolean visibility flag gates candidacy. An `image-reference` paint has no
 * scalar color and contributes nothing.
 */
const visitPaintColors = (
	paint: unknown,
	visit: (raw: unknown) => void,
): void => {
	if (!isRecord(paint) || paint.visible === false) return;
	switch (paint.kind) {
		case "solid":
			visit(paint.color);
			return;
		case "linear-gradient":
		case "radial-gradient": {
			const stops = paint.stops;
			if (!Array.isArray(stops)) return;
			for (const stop of stops) {
				if (isRecord(stop)) visit(stop.color);
			}
			return;
		}
		case "mesh-gradient": {
			const points = paint.points;
			if (!Array.isArray(points)) return;
			for (const point of points) {
				if (isRecord(point)) visit(point.color);
			}
			return;
		}
		default:
			return;
	}
};

/**
 * Visits a node's resolved fill/stroke colors: the richer `fills`/`strokes`
 * paint stack is authoritative when present (per {@link NodeStyle}'s own
 * contract) and the legacy scalar `fill`/`stroke` is visited only as the
 * fallback when that stack is absent or empty — never both, so a paint that
 * has been superseded is never double-counted or mistaken for a rendering
 * color it no longer is.
 */
const visitNodeStyleColors = (
	style: unknown,
	visit: (raw: unknown) => void,
): void => {
	if (!isRecord(style)) return;
	const fills = style.fills;
	if (Array.isArray(fills) && fills.length > 0) {
		for (const paint of fills) visitPaintColors(paint, visit);
	} else if (typeof style.fill === "string") {
		visit(style.fill);
	}
	const strokes = style.strokes;
	if (Array.isArray(strokes) && strokes.length > 0) {
		for (const paint of strokes) visitPaintColors(paint, visit);
	} else if (typeof style.stroke === "string") {
		visit(style.stroke);
	}
};

/** Recurses a node subtree (depth-first, `children` order), skipping hidden nodes (`visible === false`) entirely so their colors never reach the role candidate pool. */
const visitNodeTreeColors = (
	nodes: unknown,
	visit: (raw: unknown) => void,
): void => {
	if (!Array.isArray(nodes)) return;
	for (const node of nodes) {
		if (!isRecord(node) || node.visible === false) continue;
		visitNodeStyleColors(node.style, visit);
		visitNodeTreeColors(node.children, visit);
	}
};

/** Visits the artboard's own paintable color(s): its `fills` stack when present and non-empty (authoritative per {@link Artboard}'s own contract), otherwise its scalar `background`. */
const visitArtboardColors = (
	artboard: unknown,
	visit: (raw: unknown) => void,
): void => {
	if (!isRecord(artboard)) return;
	const fills = artboard.fills;
	if (Array.isArray(fills) && fills.length > 0) {
		for (const paint of fills) visitPaintColors(paint, visit);
		return;
	}
	if (typeof artboard.background === "string") visit(artboard.background);
};

/**
 * Walks only colors that can actually paint a pixel: the artboard background
 * (or its fill stack when present/authoritative), and each visible node's
 * resolved fill/stroke paint. This is the candidate pool for the semantic
 * roles ({@link buildSemanticRoles}) — deliberately narrower than
 * {@link walkColors} (which feeds the `colorN` auto slots and also picks up
 * inert colors like a disabled drop-shadow or dither-ink swatch). A role is
 * a promise that recoloring it visibly changes the artifact; scoring it
 * against colors that never render breaks that promise — see the regression
 * this guards against where `night`/`paper` landed on a disabled shadow's
 * pure black/white instead of any rendered color.
 */
const walkPaintColors = (payload: unknown): readonly WalkedColor[] =>
	collectWalkedColors((visit) => {
		const scene = isRecord(payload) ? payload.scene : undefined;
		const artboard = isRecord(scene) ? scene.artboard : undefined;
		visitArtboardColors(artboard, visit);
		const layers = isRecord(scene) ? scene.layers : undefined;
		if (!Array.isArray(layers)) return;
		for (const layer of layers) {
			if (isRecord(layer)) visitNodeTreeColors(layer.nodes, visit);
		}
	});

const buildAutoSlots = (
	colors: readonly WalkedColor[],
): Record<string, string> => {
	const manifest: Record<string, string> = {};
	colors.forEach((color, index) => {
		manifest[`color${index + 1}`] = color.normalized;
	});
	return manifest;
};

/** Strips alpha from a normalized hex color for luminance/saturation math; returns `null` for a digit count that isn't the standard 6 (rrggbb) or 8 (rrggbbaa) form. */
const hex6WithoutAlpha = (normalizedHex: string): string | null => {
	if (normalizedHex.length === 7) return normalizedHex;
	if (normalizedHex.length === 9) return normalizedHex.slice(0, 7);
	return null;
};

const hexChannels = (hex6: string): readonly [number, number, number] => [
	Number.parseInt(hex6.slice(1, 3), 16),
	Number.parseInt(hex6.slice(3, 5), 16),
	Number.parseInt(hex6.slice(5, 7), 16),
];

/**
 * Standard CSS Color 4 hsl->rgb conversion: exact and lossless, since hsl is
 * only a cylindrical reparametrization of the same sRGB cube (no gamut
 * mapping, no clamping beyond the already-valid 0..1 s/l range) — the same
 * category of transform this codebase already trusts for HSV in
 * `shared/color`'s `hsvToRgb`. Used ONLY to derive a numeric [r,g,b] for
 * {@link scorableCandidates}'s build-time-only luminance/saturation ranking;
 * the color VALUE that actually gets slotted and substituted is always the
 * original `hsl(...)` string, never this derived triple, so this conversion
 * never touches round-trip fidelity.
 */
const hslToRgb255 = (
	hueDegrees: number,
	saturation: number,
	lightness: number,
): readonly [number, number, number] => {
	const hue = ((hueDegrees % 360) + 360) % 360;
	const chromaTerm = saturation * Math.min(lightness, 1 - lightness);
	const channel = (offset: number): number => {
		const k = (offset + hue / 30) % 12;
		return lightness - chromaTerm * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [
		Math.round(channel(0) * 255),
		Math.round(channel(8) * 255),
		Math.round(channel(4) * 255),
	];
};

/** Splits a canonicalized color-function argument string into space-separated tokens, dropping an optional `/ alpha` suffix — alpha never participates in role-scoring channel math. */
const functionArgTokens = (canonicalizedArgs: string): readonly string[] =>
	(canonicalizedArgs.split(" / ")[0] ?? "").split(" ").filter(Boolean);

/**
 * Parses one `rgb()`/`rgba()` channel token: a plain 0-255 number or a
 * 0%-100% percentage (scaled to 0-255, exact linear scaling — not a gamut
 * conversion). Returns `null` for the CSS Color 4 `none` keyword or anything
 * non-finite, so a channel this cannot resolve exactly excludes the whole
 * color from role scoring rather than guessing at a value.
 */
const parseRgbChannelToken = (token: string): number | null => {
	if (token.endsWith("%")) {
		const percent = Number.parseFloat(token.slice(0, -1));
		return Number.isFinite(percent) ? (percent / 100) * 255 : null;
	}
	const value = Number.parseFloat(token);
	return Number.isFinite(value) && /^-?\d+(\.\d+)?$/.test(token) ? value : null;
};

/** Parses an `hsl()`/`hsla()` hue token: a bare number or an explicit `deg` suffix only. Any other CSS Color 4 angle unit (`grad`, `rad`, `turn`) or the `none` keyword is rejected rather than silently mis-scaled. */
const parseHueDegreesToken = (token: string): number | null => {
	const degMatch = /^(-?\d+(?:\.\d+)?)deg$/i.exec(token);
	const bareMatch = /^-?\d+(?:\.\d+)?$/.exec(token);
	const numeric = degMatch?.[1] ?? bareMatch?.[0];
	if (numeric === undefined) return null;
	const value = Number.parseFloat(numeric);
	return Number.isFinite(value) ? value : null;
};

/** Parses an `hsl()`/`hsla()` saturation/lightness token: CSS Color 4 requires a percentage for both, so a bare number or the `none` keyword is rejected. */
const parsePercentToken = (token: string): number | null => {
	if (!token.endsWith("%")) return null;
	const value = Number.parseFloat(token.slice(0, -1));
	return Number.isFinite(value) ? value / 100 : null;
};

const PALETTE_RGB_OR_HSL_FUNCTION_PATTERN = /^(rgba?|hsla?)\(/i;

/**
 * Derives an exact `[r, g, b]` (0-255) from a {@link normalizeColorToken}
 * output, for semantic-role scoring only — never for the slotted value
 * itself. Hex and `rgb()`/`rgba()` are exact by construction (no gamut math);
 * `hsl()`/`hsla()` uses the exact {@link hslToRgb255} conversion. `hwb()`,
 * `lab()`, `lch()`, `oklab()`, and `oklch()` return `null` here — they are
 * still fully recognized and slotted as `colorN` auto slots (see
 * {@link normalizeColorToken}), just excluded from `background`/`night`/
 * `paper`/`accent` candidacy, because ranking them fairly against an sRGB-
 * derived luminance/saturation scale would need an actual color-space
 * conversion (risking the gamut-clipping/rounding-drift this fix must not
 * introduce), not merely a syntax reparametrization.
 */
const rgb255FromToken = (
	normalized: string,
): readonly [number, number, number] | null => {
	if (normalized.startsWith("#")) {
		const hex6 = hex6WithoutAlpha(normalized);
		return hex6 ? hexChannels(hex6) : null;
	}
	const match = PALETTE_RGB_OR_HSL_FUNCTION_PATTERN.exec(normalized);
	if (!match) return null;
	const isHsl = match[1]?.toLowerCase().startsWith("hsl") ?? false;
	const closeParen = normalized.lastIndexOf(")");
	if (closeParen === -1) return null;
	const argsStart = normalized.indexOf("(") + 1;
	const tokens = functionArgTokens(normalized.slice(argsStart, closeParen));
	if (tokens.length < 3) return null;
	const [first, second, third] = tokens;
	if (first === undefined || second === undefined || third === undefined) {
		return null;
	}
	if (isHsl) {
		const hue = parseHueDegreesToken(first);
		const saturation = parsePercentToken(second);
		const lightness = parsePercentToken(third);
		if (hue === null || saturation === null || lightness === null) {
			return null;
		}
		return hslToRgb255(hue, saturation, lightness);
	}
	const r = parseRgbChannelToken(first);
	const g = parseRgbChannelToken(second);
	const b = parseRgbChannelToken(third);
	if (r === null || g === null || b === null) return null;
	const clamp255 = (channel: number): number =>
		Math.max(0, Math.min(255, Math.round(channel)));
	return [clamp255(r), clamp255(g), clamp255(b)];
};

/** Perceptual (gamma-encoded, not linear-light) relative luminance — an approximation sufficient for ranking dark/light role candidates, not for WCAG contrast math. */
const relativeLuminance = (rgb: readonly [number, number, number]): number => {
	const [r, g, b] = rgb;
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** HSL saturation (0-1) derived from 0-255 rgb channels. */
const hslSaturation = (rgb: readonly [number, number, number]): number => {
	const [r, g, b] = rgb.map((channel) => channel / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === min) return 0;
	const lightness = (max + min) / 2;
	const delta = max - min;
	return lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
};

type RoleCandidate = WalkedColor & {
	readonly luminance: number;
	readonly saturation: number;
};

/** Narrows `colors` to those with an exactly-derivable `[r,g,b]` (see {@link rgb255FromToken}) and scores each — colors this cannot derive channels for are excluded from semantic-role candidacy but remain fully addressable as `colorN` auto slots. */
const scorableCandidates = (
	colors: readonly WalkedColor[],
): readonly RoleCandidate[] =>
	colors.reduce<RoleCandidate[]>((accepted, color) => {
		const rgb = rgb255FromToken(color.normalized);
		if (!rgb) return accepted;
		accepted.push({
			...color,
			luminance: relativeLuminance(rgb),
			saturation: hslSaturation(rgb),
		});
		return accepted;
	}, []);

/**
 * Picks one candidate by a numeric key, with an explicit, fully-ordered
 * tie-break: higher usage count wins, then lower (earlier) first-occurrence
 * index wins. Never delegates to `Array.prototype.sort` — a partial
 * comparator relying on sort stability for the remaining ties is exactly the
 * shape that has produced intermittent `check:reference-scenes-fresh` drift
 * before, since this manifest is byte-compared across regenerations.
 */
const pickBy = (
	candidates: readonly RoleCandidate[],
	key: (candidate: RoleCandidate) => number,
	preferHigher: boolean,
): RoleCandidate | undefined =>
	candidates.reduce<RoleCandidate | undefined>((best, candidate) => {
		if (!best) return candidate;
		const candidateKey = key(candidate);
		const bestKey = key(best);
		if (candidateKey === bestKey) {
			if (candidate.count !== best.count) {
				return candidate.count > best.count ? candidate : best;
			}
			return candidate.firstIndex < best.firstIndex ? candidate : best;
		}
		const candidateWins = preferHigher
			? candidateKey > bestKey
			: candidateKey < bestKey;
		return candidateWins ? candidate : best;
	}, undefined);

/**
 * Assigns the semantic role slots on top of the auto `colorN` slots:
 * - `background`: the artboard's OWN `background` field verbatim (a
 *   structural fact, never inferred from the color walk) — omitted when
 *   that field is absent or not a recognized color token.
 * - `night`: darkest by luminance; ties broken by higher usage count, then
 *   earlier first occurrence.
 * - `paper`: lightest by luminance, same tie-break.
 * - `accent`: most saturated color clearing {@link ACCENT_MIN_SATURATION},
 *   same tie-break; omitted entirely when no candidate clears the
 *   threshold (e.g. a monochrome scene).
 */
const buildSemanticRoles = (
	colors: readonly RoleCandidate[],
	backgroundColor: string | null,
): Record<string, string> => {
	const roles: Record<string, string> = {};
	if (backgroundColor) roles.background = backgroundColor;
	const night = pickBy(colors, (color) => color.luminance, false);
	if (night) roles.night = night.normalized;
	const paper = pickBy(colors, (color) => color.luminance, true);
	if (paper) roles.paper = paper.normalized;
	const accentCandidates = colors.filter(
		(color) => color.saturation >= ACCENT_MIN_SATURATION,
	);
	const accent = pickBy(accentCandidates, (color) => color.saturation, true);
	if (accent) roles.accent = accent.normalized;
	return roles;
};

/**
 * Builds the full palette manifest (auto slots + semantic roles) for a
 * runtime payload. `payload` is treated structurally: only
 * `payload.scene.artboard.background` is read for the `background` role,
 * the `colorN` auto slots are discovered by the permissive whole-payload
 * {@link walkColors}, and the `night`/`paper`/`accent` roles are scored only
 * against {@link walkPaintColors}'s paint-bearing candidate pool — so a role
 * can never resolve to a color that paints nothing (see that function's doc
 * comment). This function accepts any payload shape carrying a scene
 * document (the SVG runtime's `MotionCodeRuntimePayload` and the WebGL
 * runtime's `WebglPlayerRuntimePayload` both qualify) without importing
 * either type.
 */
export const buildPaletteManifest = (
	payload: unknown,
): Readonly<Record<string, string>> => {
	const colors = walkColors(payload);
	const scene = isRecord(payload) ? payload.scene : undefined;
	const artboard = isRecord(scene) ? scene.artboard : undefined;
	const backgroundRaw = isRecord(artboard) ? artboard.background : undefined;
	const backgroundColor = normalizeColorToken(backgroundRaw);
	const paintCandidates = scorableCandidates(walkPaintColors(payload));
	const roles = buildSemanticRoles(paintCandidates, backgroundColor);
	return { ...buildAutoSlots(colors), ...roles };
};

/**
 * Resolves a host-supplied `mount(el, { palette })` map into a
 * normalized-source-color -> replacement Map, ready for
 * {@link applyPaletteReplacements}. Each key resolves in order: semantic role
 * name or auto slot name (both are flat entries of the same `manifest`, so a
 * single lookup covers both) — otherwise the key itself, as a literal color
 * token (hex or one of the recognized CSS color functions). When two keys
 * resolve to the same source color (e.g. `night` and `color3` happen to be
 * aliases), the LAST entry in `palette`'s own key order wins, since later
 * `Map.set` calls simply overwrite earlier ones for the same normalized
 * source color.
 */
export const resolvePaletteReplacements = (
	manifest: Readonly<Record<string, string>> | undefined,
	palette: Readonly<Record<string, string>> | undefined,
): ReadonlyMap<string, string> => {
	const replacements = new Map<string, string>();
	if (!palette) return replacements;
	for (const key of Object.keys(palette)) {
		const requestedReplacement = palette[key];
		if (requestedReplacement === undefined) continue;
		const sourceColor =
			manifest && Object.hasOwn(manifest, key)
				? normalizeColorToken(manifest[key])
				: normalizeColorToken(key);
		if (sourceColor) replacements.set(sourceColor, requestedReplacement);
	}
	return replacements;
};

/**
 * Deep-clones `value`, replacing every string equal (after color-token
 * normalization) to a source color in `replacements` with its mapped
 * replacement. Returns `value` unchanged (same reference) when there is
 * nothing to replace, so callers can skip cloning entirely when a host mounts
 * without a `palette` option.
 */
export const applyPaletteReplacements = <T>(
	value: T,
	replacements: ReadonlyMap<string, string>,
): T => {
	if (replacements.size === 0) return value;
	if (typeof value === "string") {
		const normalized = normalizeColorToken(value);
		const replacement = normalized ? replacements.get(normalized) : undefined;
		return (replacement ?? value) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) =>
			applyPaletteReplacements(item, replacements),
		) as T;
	}
	if (isRecord(value)) {
		const next: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			next[key] = applyPaletteReplacements(value[key], replacements);
		}
		return next as T;
	}
	return value;
};
