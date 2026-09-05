import type { DctlHelperFunction } from "@/shared/dctl";

/** Clamps an integer texel coordinate to `[lo, hi]` — used by the root sampler. */
export const DCTL_HELPER_CLAMP_INT: DctlHelperFunction = {
	name: "lk_clamp_int",
	source: [
		"__DEVICE__ int lk_clamp_int(int value, int lo, int hi) {",
		"\treturn value < lo ? lo : (value > hi ? hi : value);",
		"}",
	].join("\n"),
};

/**
 * Component-wise `float3` lerp. DCTL's `_mix()` is not guaranteed to have a
 * vector overload the way GLSL's `mix()` does, so every emitter that needs to
 * blend two colors goes through this instead of assuming `_mix(float3, ...)`
 * compiles.
 */
export const DCTL_HELPER_MIX3: DctlHelperFunction = {
	name: "lk_mix3",
	source: [
		"__DEVICE__ float3 lk_mix3(float3 a, float3 b, float t) {",
		"\treturn make_float3(_mix(a.x, b.x, t), _mix(a.y, b.y, t), _mix(a.z, b.z, t));",
		"}",
	].join("\n"),
};

/** Component-wise `float3 * float` scale, for the same reason as {@link DCTL_HELPER_MIX3}. */
export const DCTL_HELPER_SCALE3: DctlHelperFunction = {
	name: "lk_scale3",
	source: [
		"__DEVICE__ float3 lk_scale3(float3 v, float s) {",
		"\treturn make_float3(v.x * s, v.y * s, v.z * s);",
		"}",
	].join("\n"),
};

/** Component-wise `float3 + float3` add, for the same reason as {@link DCTL_HELPER_MIX3}. */
export const DCTL_HELPER_ADD3: DctlHelperFunction = {
	name: "lk_add3",
	source: [
		"__DEVICE__ float3 lk_add3(float3 a, float3 b) {",
		"\treturn make_float3(a.x + b.x, a.y + b.y, a.z + b.z);",
		"}",
	].join("\n"),
};

/** Component-wise `float3 * float3` multiply, for the same reason as {@link DCTL_HELPER_MIX3}. Used by `crt-display`'s mask tint. */
export const DCTL_HELPER_MUL3: DctlHelperFunction = {
	name: "lk_mul3",
	source: [
		"__DEVICE__ float3 lk_mul3(float3 a, float3 b) {",
		"\treturn make_float3(a.x * b.x, a.y * b.y, a.z * b.z);",
		"}",
	].join("\n"),
};

/** GLSL-style `fract()` (`v - floor(v)`, always non-negative), since DCTL only exposes `_fmod`. */
export const DCTL_HELPER_FRACT: DctlHelperFunction = {
	name: "lk_fract",
	source: [
		"__DEVICE__ float lk_fract(float v) {",
		"\treturn v - _floorf(v);",
		"}",
	].join("\n"),
};

/** Deterministic per-position pseudo-noise in `[0, 1)`, standing in for feTurbulence where DCTL has no noise primitive. */
export const DCTL_HELPER_HASH21: DctlHelperFunction = {
	name: "lk_hash21",
	source: [
		"__DEVICE__ float lk_hash21(float2 p) {",
		"\tfloat h = _sinf(p.x * 127.1 + p.y * 311.7) * 43758.5453;",
		"\treturn h - _floorf(h);",
		"}",
	].join("\n"),
};

/** Rec. 709 luminance, matching {@link import("@/entities/scene/model/effect-filter").LUMINANCE_709_MATRIX}'s weights. */
export const DCTL_HELPER_LUMA709: DctlHelperFunction = {
	name: "lk_luma709",
	source: [
		"__DEVICE__ float lk_luma709(float3 c) {",
		"\treturn c.x * 0.2126 + c.y * 0.7152 + c.z * 0.0722;",
		"}",
	].join("\n"),
};

/**
 * One posterized channel: `bands` evenly spaced steps over `[0, 1]`, matching
 * the SVG `feComponentTransfer type="discrete"` semantics `posterizePrimitives`
 * uses (`k = floor(clamp(v) * bands)` clamped to `bands - 1`, then `k / (bands - 1)`).
 */
export const DCTL_HELPER_POSTERIZE_CHANNEL: DctlHelperFunction = {
	name: "lk_posterize_channel",
	source: [
		"__DEVICE__ float lk_posterize_channel(float value, float bands) {",
		"\tfloat clamped = _clamp(value, 0.0, 1.0);",
		"\tfloat step = _floorf(clamped * bands);",
		"\tstep = _fminf(step, bands - 1.0);",
		"\treturn step / _fmaxf(bands - 1.0, 1.0);",
		"}",
	].join("\n"),
};

/** `float2` Euclidean length, written manually (component math) rather than assuming a `length()` vector intrinsic exists. */
export const DCTL_HELPER_LENGTH2: DctlHelperFunction = {
	name: "lk_length2",
	source: [
		"__DEVICE__ float lk_length2(float2 v) {",
		"\treturn _sqrtf(v.x * v.x + v.y * v.y);",
		"}",
	].join("\n"),
};

/** GLSL-style `mod()` (always non-negative for a positive `b`), since DCTL's `_fmod` follows C `fmod` sign semantics instead. */
export const DCTL_HELPER_GL_MOD: DctlHelperFunction = {
	name: "lk_gl_mod",
	source: [
		"__DEVICE__ float lk_gl_mod(float a, float b) {",
		"\treturn a - b * _floorf(a / b);",
		"}",
	].join("\n"),
};

/** GLSL-style `step(edge, x)`: `0.0` below `edge`, `1.0` at or above it. */
export const DCTL_HELPER_STEP: DctlHelperFunction = {
	name: "lk_step",
	source: [
		"__DEVICE__ float lk_step(float edge, float x) {",
		"\treturn x < edge ? 0.0 : 1.0;",
		"}",
	].join("\n"),
};

/** GLSL-style `smoothstep(edge0, edge1, x)`: clamped Hermite interpolation. */
export const DCTL_HELPER_SMOOTHSTEP: DctlHelperFunction = {
	name: "lk_smoothstep",
	source: [
		"__DEVICE__ float lk_smoothstep(float edge0, float edge1, float x) {",
		"\tfloat t = _clamp((x - edge0) / _fmaxf(edge1 - edge0, 0.00001), 0.0, 1.0);",
		"\treturn t * t * (3.0 - 2.0 * t);",
		"}",
	].join("\n"),
};

/**
 * 3D hash in `[0, 1)`, an exact port of `FRAGMENT_SHADER_FLOW`'s `hash(vec3)`
 * (`shared/gpu-lens/surface.ts`) — the seed for `lk_vnoise3`'s value noise.
 */
export const DCTL_HELPER_HASH3: DctlHelperFunction = {
	name: "lk_hash3",
	source: [
		"__DEVICE__ float lk_hash3(float3 p) {",
		"\tfloat px = lk_fract(p.x * 0.3183099 + 0.1);",
		"\tfloat py = lk_fract(p.y * 0.3183099 + 0.1);",
		"\tfloat pz = lk_fract(p.z * 0.3183099 + 0.1);",
		"\tpx *= 17.0;",
		"\tpy *= 17.0;",
		"\tpz *= 17.0;",
		"\treturn lk_fract(px * py * pz * (px + py + pz));",
		"}",
	].join("\n"),
};

/**
 * 3D trilinearly-interpolated value noise, an exact port of
 * `FRAGMENT_SHADER_FLOW`'s `vnoise(vec3)`. Depends on {@link DCTL_HELPER_HASH3}
 * and {@link DCTL_HELPER_FRACT} (via `lk_fract`, though this function itself
 * only needs `_floorf`).
 */
export const DCTL_HELPER_VNOISE3: DctlHelperFunction = {
	name: "lk_vnoise3",
	source: [
		"__DEVICE__ float lk_vnoise3(float3 x) {",
		"\tfloat3 i = make_float3(_floorf(x.x), _floorf(x.y), _floorf(x.z));",
		"\tfloat3 f = make_float3(x.x - i.x, x.y - i.y, x.z - i.z);",
		"\tfloat3 u = make_float3(",
		"\t\tf.x * f.x * (3.0 - 2.0 * f.x),",
		"\t\tf.y * f.y * (3.0 - 2.0 * f.y),",
		"\t\tf.z * f.z * (3.0 - 2.0 * f.z)",
		"\t);",
		"\tfloat h000 = lk_hash3(make_float3(i.x, i.y, i.z));",
		"\tfloat h100 = lk_hash3(make_float3(i.x + 1.0, i.y, i.z));",
		"\tfloat h010 = lk_hash3(make_float3(i.x, i.y + 1.0, i.z));",
		"\tfloat h110 = lk_hash3(make_float3(i.x + 1.0, i.y + 1.0, i.z));",
		"\tfloat h001 = lk_hash3(make_float3(i.x, i.y, i.z + 1.0));",
		"\tfloat h101 = lk_hash3(make_float3(i.x + 1.0, i.y, i.z + 1.0));",
		"\tfloat h011 = lk_hash3(make_float3(i.x, i.y + 1.0, i.z + 1.0));",
		"\tfloat h111 = lk_hash3(make_float3(i.x + 1.0, i.y + 1.0, i.z + 1.0));",
		"\tfloat mixX0 = _mix(h000, h100, u.x);",
		"\tfloat mixX1 = _mix(h010, h110, u.x);",
		"\tfloat mixY0 = _mix(mixX0, mixX1, u.y);",
		"\tfloat mixX2 = _mix(h001, h101, u.x);",
		"\tfloat mixX3 = _mix(h011, h111, u.x);",
		"\tfloat mixY1 = _mix(mixX2, mixX3, u.y);",
		"\treturn _mix(mixY0, mixY1, u.z);",
		"}",
	].join("\n"),
};

/**
 * Rotates `v` by `radians` (2D rotation matrix, written as manual component
 * math rather than assuming a `mat2` type/operator exists in DCTL). Used by
 * the cell-based gather nodes (`halftone`, `riso`) that rotate a dot-screen
 * lattice, mirroring `rotate2`/`rot2` in `shared/gpu-lens/surface.ts`.
 */
export const DCTL_HELPER_ROTATE2: DctlHelperFunction = {
	name: "lk_rotate2",
	source: [
		"__DEVICE__ float2 lk_rotate2(float2 v, float radians) {",
		"\tfloat c = _cosf(radians);",
		"\tfloat s = _sinf(radians);",
		"\treturn make_float2(v.x * c - v.y * s, v.x * s + v.y * c);",
		"}",
	].join("\n"),
};

/**
 * 2D bilinearly-interpolated value noise in `[0, 1)`, built on
 * {@link DCTL_HELPER_HASH21}. Used by `displace`'s fBm noise field — DCTL has
 * no `feTurbulence`-equivalent noise primitive (same gap {@link DCTL_HELPER_HASH21}
 * and `scanline`'s emitter already document).
 */
export const DCTL_HELPER_VALUE_NOISE21: DctlHelperFunction = {
	name: "lk_value_noise21",
	source: [
		"__DEVICE__ float lk_value_noise21(float2 p) {",
		"\tfloat2 i = make_float2(_floorf(p.x), _floorf(p.y));",
		"\tfloat2 f = make_float2(p.x - i.x, p.y - i.y);",
		"\tfloat2 u = make_float2(f.x * f.x * (3.0 - 2.0 * f.x), f.y * f.y * (3.0 - 2.0 * f.y));",
		"\tfloat a = lk_hash21(i);",
		"\tfloat b = lk_hash21(make_float2(i.x + 1.0, i.y));",
		"\tfloat c = lk_hash21(make_float2(i.x, i.y + 1.0));",
		"\tfloat d = lk_hash21(make_float2(i.x + 1.0, i.y + 1.0));",
		"\tfloat mixAB = _mix(a, b, u.x);",
		"\tfloat mixCD = _mix(c, d, u.x);",
		"\treturn _mix(mixAB, mixCD, u.y);",
		"}",
	].join("\n"),
};

/**
 * Signed distance from `p` to a rounded box centred at the origin with
 * (square, so a scalar) `halfSize` and corner `radius` — an exact port of
 * `roundedBoxSdf` in `FRAGMENT_SHADER_PIXEL_GRID` (`shared/gpu-lens/surface.ts`),
 * written with manual component math instead of assuming `abs(vec2)`/
 * `max(vec2, vec2)`/`length(vec2)` intrinsics.
 */
export const DCTL_HELPER_ROUNDED_BOX_SDF: DctlHelperFunction = {
	name: "lk_rounded_box_sdf",
	source: [
		"__DEVICE__ float lk_rounded_box_sdf(float2 p, float halfSize, float radius) {",
		"\tfloat qx = _fabs(p.x) - (halfSize - radius);",
		"\tfloat qy = _fabs(p.y) - (halfSize - radius);",
		"\tfloat outsideX = _fmaxf(qx, 0.0);",
		"\tfloat outsideY = _fmaxf(qy, 0.0);",
		"\tfloat outside = _sqrtf(outsideX * outsideX + outsideY * outsideY);",
		"\tfloat inside = _fminf(_fmaxf(qx, qy), 0.0);",
		"\treturn outside + inside - radius;",
		"}",
	].join("\n"),
};

/**
 * Row bit-pattern lookup for one of the 5x7 ASCII density glyphs' 7 rows
 * (`row` 0..6), an exact port of `rowAt` in `FRAGMENT_SHADER_ASCII_GLYPH`
 * (`shared/gpu-lens/surface.ts`) — `row` is a runtime value (it depends on
 * the sampled pixel's position inside the glyph cell), so this stays a real
 * DCTL function rather than a codegen-time constant.
 */
export const DCTL_HELPER_ASCII_ROW_AT: DctlHelperFunction = {
	name: "lk_ascii_row_at",
	source: [
		"__DEVICE__ float lk_ascii_row_at(float row, float r0, float r1, float r2, float r3, float r4, float r5, float r6) {",
		"\tif (row < 0.5) return r0;",
		"\tif (row < 1.5) return r1;",
		"\tif (row < 2.5) return r2;",
		"\tif (row < 3.5) return r3;",
		"\tif (row < 4.5) return r4;",
		"\tif (row < 5.5) return r5;",
		"\treturn r6;",
		"}",
	].join("\n"),
};

/**
 * Bit-pattern row for one of the 10 density-ramp glyphs (`glyph` 0..9, both
 * runtime values), an exact port of `glyphRow` in `FRAGMENT_SHADER_ASCII_GLYPH`
 * — see that shader's comment for why the density ramp is ordered by each
 * bitmap's MEASURED lit-pixel count rather than the conventional ASCII-art
 * ramp order. Depends on {@link DCTL_HELPER_ASCII_ROW_AT}.
 */
export const DCTL_HELPER_ASCII_GLYPH_ROW: DctlHelperFunction = {
	name: "lk_ascii_glyph_row",
	source: [
		"__DEVICE__ float lk_ascii_glyph_row(float glyph, float row) {",
		"\tif (glyph < 0.5) return 0.0;",
		"\tif (glyph < 1.5) return lk_ascii_row_at(row, 0.0, 0.0, 0.0, 0.0, 0.0, 4.0, 4.0);",
		"\tif (glyph < 2.5) return lk_ascii_row_at(row, 0.0, 4.0, 4.0, 0.0, 4.0, 4.0, 0.0);",
		"\tif (glyph < 3.5) return lk_ascii_row_at(row, 0.0, 0.0, 0.0, 31.0, 0.0, 0.0, 0.0);",
		"\tif (glyph < 4.5) return lk_ascii_row_at(row, 17.0, 2.0, 4.0, 8.0, 16.0, 17.0, 0.0);",
		"\tif (glyph < 5.5) return lk_ascii_row_at(row, 0.0, 4.0, 4.0, 31.0, 4.0, 4.0, 0.0);",
		"\tif (glyph < 6.5) return lk_ascii_row_at(row, 0.0, 0.0, 31.0, 0.0, 31.0, 0.0, 0.0);",
		"\tif (glyph < 7.5) return lk_ascii_row_at(row, 0.0, 21.0, 14.0, 31.0, 14.0, 21.0, 0.0);",
		"\tif (glyph < 8.5) return lk_ascii_row_at(row, 10.0, 31.0, 10.0, 10.0, 31.0, 10.0, 0.0);",
		"\treturn lk_ascii_row_at(row, 14.0, 31.0, 23.0, 21.0, 23.0, 17.0, 14.0);",
		"}",
	].join("\n"),
};

/**
 * Whether the glyph-space pixel at `localUv` (0..1 across the character
 * cell) is lit for `glyph` at `scale`, an exact port of `glyphMask` in
 * `FRAGMENT_SHADER_ASCII_GLYPH`. Depends on {@link DCTL_HELPER_ASCII_GLYPH_ROW}
 * and {@link DCTL_HELPER_GL_MOD}.
 */
export const DCTL_HELPER_ASCII_GLYPH_MASK: DctlHelperFunction = {
	name: "lk_ascii_glyph_mask",
	source: [
		"__DEVICE__ float lk_ascii_glyph_mask(float glyph, float2 localUv, float scale) {",
		"\tfloat s = _fmaxf(scale, 0.1);",
		"\tfloat glyphUvX = (localUv.x - 0.5) / s + 0.5;",
		"\tfloat glyphUvY = (localUv.y - 0.5) / s + 0.5;",
		"\tif (glyphUvX < 0.0 || glyphUvX >= 1.0 || glyphUvY < 0.0 || glyphUvY >= 1.0) return 0.0;",
		"\tfloat col = _floorf(glyphUvX * 5.0);",
		"\tfloat row = _floorf(glyphUvY * 7.0);",
		"\tfloat mask = lk_ascii_glyph_row(glyph, row);",
		"\tfloat divisor = _powf(2.0, 4.0 - col);",
		"\treturn lk_gl_mod(_floorf(mask / divisor), 2.0);",
		"}",
	].join("\n"),
};

/**
 * Rec. 601 RGB -> YUV, an exact port of `rgb2yuv601` in
 * `FRAGMENT_SHADER_VHS_COLOR` (`shared/gpu-lens/surface.ts`). Used by
 * `vhs-color` to isolate luma from chroma before lowpassing chroma only.
 */
export const DCTL_HELPER_RGB2YUV601: DctlHelperFunction = {
	name: "lk_rgb2yuv601",
	source: [
		"__DEVICE__ float3 lk_rgb2yuv601(float3 c) {",
		"\tfloat y = c.x * 0.299 + c.y * 0.587 + c.z * 0.114;",
		"\tfloat u = c.x * -0.14713 + c.y * -0.28886 + c.z * 0.436;",
		"\tfloat v = c.x * 0.615 + c.y * -0.51499 + c.z * -0.10001;",
		"\treturn make_float3(y, u, v);",
		"}",
	].join("\n"),
};

/**
 * Rec. 601 YUV -> RGB, an exact port of `yuv2rgb601` in
 * `FRAGMENT_SHADER_VHS_COLOR`. Depends on nothing else — inverse of
 * {@link DCTL_HELPER_RGB2YUV601}.
 */
export const DCTL_HELPER_YUV2RGB601: DctlHelperFunction = {
	name: "lk_yuv2rgb601",
	source: [
		"__DEVICE__ float3 lk_yuv2rgb601(float3 yuv) {",
		"\tfloat y = yuv.x;",
		"\tfloat u = yuv.y;",
		"\tfloat v = yuv.z;",
		"\treturn make_float3(y + 1.13983 * v, y - 0.39465 * u - 0.58060 * v, y + 2.03211 * u);",
		"}",
	].join("\n"),
};
