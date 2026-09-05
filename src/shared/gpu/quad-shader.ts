import { MAX_GRADIENT_STOPS } from "./types";

/** WGSL array-length literal, interpolated from the SAME `MAX_GRADIENT_STOPS` the capability predicate reads — see `shared/gpu/types.ts`. */
const MAX_GRADIENT_STOPS_WGSL = MAX_GRADIENT_STOPS;

/**
 * WGSL for the flat-color/gradient world-space quad pass — background quads
 * (S1, always `paintKind = 0`) AND the S2/S3 fill cover pass share this ONE
 * shader/pipeline pair (see `webgpu.ts`'s doc comment for why: both are "one
 * draw call per quad, camera-projected, premultiplied output" with the SAME
 * `QuadUniforms` binding shape). `QuadUniforms` is bound per-draw via a
 * dynamic uniform-buffer offset (see `webgpu.ts`).
 *
 * Camera projection mirrors `features/viewport/model/camera.ts` exactly:
 * `screen = rotate(world, rotation) * scale + pan` (CSS pixels, origin
 * top-left, Y-down), then screen -> WebGPU clip space (`-1..1`, Y-up) via
 * `clipY = 1 - 2*screenY/h`.
 *
 * GRADIENT PARAMETERIZATION (E1 S3 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s gradient decisions and
 * `shared/gpu/types.ts::GpuPaint`'s doc comment for the full derivation):
 * `paintKind` selects solid (`0`) / linear (`1`) / radial (`2`). The vertex
 * shader passes its own already-computed WORLD position through as a
 * `@location(0)` varying (`worldPosition` — the SAME `worldX`/`worldY` the
 * camera projection already derives, no extra math). `worldToLocal` (a 2x3
 * affine matrix, `worldToLocalRow0`/`Row1`) is the INVERSE of the fill's own
 * `worldTransform`, computed ONCE CPU-side per draw
 * (`entities/scene/model/rendering.ts::invertMatrix`) — the fragment shader
 * applies it to the interpolated `worldPosition` to recover the node-LOCAL
 * position, then compares that against `gradientGeometry`'s `from`/`to`
 * (linear) or `center`/`radius` (radial) — numbers that stay in the SAME
 * local space as the fill's own contours, never transformed. This is exact
 * under rotation/anisotropic-scale/shear alike, unlike a naive
 * perpendicular-projection computed directly in WORLD space (see this
 * codebase's `docs/gpu-canvas-convergence-e1-plan.md` for why that shortcut
 * was rejected). Stops interpolate in PREMULTIPLIED space (matching browser
 * gradient behavior — no gray fringing at a transparent stop): `stopColors`
 * arrives STRAIGHT-alpha (each stop's alpha already folds in this fill's full
 * opacity chain, see `entities/scene/model/gpu/display-list.ts`), and
 * `sampleGradient` premultiplies the two bracketing stops itself, right
 * before mixing them, so the interpolation never blends toward a fully
 * transparent stop's arbitrary RGB.
 *
 * Color is written straight to the swapchain's preferred format (non-sRGB
 * view) with no gamma re-encoding, so an sRGB-encoded input (matching CSS/SVG
 * `#rrggbb` colors) round-trips byte-for-byte — the SAME contract
 * `renderFrame`'s doc comment describes. The canvas context is configured
 * `alphaMode: "premultiplied"`, so every code path below emits PREMULTIPLIED
 * RGBA regardless of paint kind.
 */
export const QUAD_SHADER_SOURCE = /* wgsl */ `
struct QuadUniforms {
	rect: vec4<f32>,
	color: vec4<f32>,
	camera: vec4<f32>,
	viewport: vec4<f32>,
	// x = paintKind (0 solid, 1 linear, 2 radial), y = stop count, z/w unused.
	paintMeta: vec4<f32>,
	// Linear: xy = from, zw = to. Radial: xy = center, z = radius, w unused.
	gradientGeometry: vec4<f32>,
	// worldToLocal 2x3 affine, row-major: row0 = (a, c, e, _), row1 = (b, d, f, _).
	worldToLocalRow0: vec4<f32>,
	worldToLocalRow1: vec4<f32>,
	// 4 offsets packed per vec4, ${MAX_GRADIENT_STOPS_WGSL} stops total.
	stopOffsets: array<vec4<f32>, ${MAX_GRADIENT_STOPS_WGSL / 4}>,
	// Straight-alpha sRGB per stop, ${MAX_GRADIENT_STOPS_WGSL} stops total.
	stopColors: array<vec4<f32>, ${MAX_GRADIENT_STOPS_WGSL}>,
};

@group(0) @binding(0) var<uniform> quad: QuadUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) worldPosition: vec2<f32>,
};

// Triangle-strip corner order for vertex indices 0..3: (0,0) (1,0) (0,1) (1,1)
// in the quad's local unit space, i.e. top-left, top-right, bottom-left,
// bottom-right when rect.xy is the top-left world corner.
const UNIT_CORNERS = array<vec2<f32>, 4>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	let unit = UNIT_CORNERS[vertexIndex];
	let worldX = quad.rect.x + unit.x * quad.rect.z;
	let worldY = quad.rect.y + unit.y * quad.rect.w;

	let scale = quad.camera.x;
	let panX = quad.camera.y;
	let panY = quad.camera.z;
	let rotation = quad.camera.w;
	let cosR = cos(rotation);
	let sinR = sin(rotation);
	let screenX = (worldX * cosR - worldY * sinR) * scale + panX;
	let screenY = (worldX * sinR + worldY * cosR) * scale + panY;

	let cssWidth = quad.viewport.x;
	let cssHeight = quad.viewport.y;
	let clipX = (screenX / cssWidth) * 2.0 - 1.0;
	let clipY = 1.0 - (screenY / cssHeight) * 2.0;

	var out: VertexOutput;
	out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
	out.worldPosition = vec2<f32>(worldX, worldY);
	return out;
}

// Fetches stop index's offset from the packed stopOffsets uniform array.
fn stopOffsetAt(index: i32) -> f32 {
	let vecIndex = index / 4;
	let component = index % 4;
	let packed = quad.stopOffsets[vecIndex];
	if (component == 0) { return packed.x; }
	if (component == 1) { return packed.y; }
	if (component == 2) { return packed.z; }
	return packed.w;
}

// Samples the gradient at parameter t, interpolating the two bracketing
// stops in PREMULTIPLIED space (premultiplying each stop's straight color by
// its own alpha before the mix, then leaving the result premultiplied - this
// is what avoids gray fringing when one bracketing stop is fully
// transparent, since a straight-space mix would blend toward that stop's
// arbitrary, invisible RGB instead of toward "no color contribution"). t is
// clamped to the first/last stop's offset outside [stops[0].offset,
// stops[last].offset], matching the CSS/SVG gradient "pad" spread default
// (the only spread mode S3 supports - see GpuPaint's TS doc comment).
fn sampleGradient(t: f32) -> vec4<f32> {
	let stopCount = i32(quad.paintMeta.y);
	if (stopCount <= 1) {
		let only = quad.stopColors[0];
		return vec4<f32>(only.rgb * only.a, only.a);
	}

	let firstOffset = stopOffsetAt(0);
	let lastOffset = stopOffsetAt(stopCount - 1);
	let clamped = clamp(t, firstOffset, lastOffset);

	var lowerIndex = 0;
	for (var i = 0; i < stopCount - 1; i = i + 1) {
		if (clamped >= stopOffsetAt(i)) {
			lowerIndex = i;
		}
	}
	let upperIndex = min(lowerIndex + 1, stopCount - 1);

	let lowerOffset = stopOffsetAt(lowerIndex);
	let upperOffset = stopOffsetAt(upperIndex);
	let span = upperOffset - lowerOffset;
	let mixAmount = select((clamped - lowerOffset) / span, 0.0, span <= 0.0);

	let lowerStraight = quad.stopColors[lowerIndex];
	let upperStraight = quad.stopColors[upperIndex];
	let lowerPremultiplied = vec4<f32>(lowerStraight.rgb * lowerStraight.a, lowerStraight.a);
	let upperPremultiplied = vec4<f32>(upperStraight.rgb * upperStraight.a, upperStraight.a);
	return mix(lowerPremultiplied, upperPremultiplied, mixAmount);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	let paintKind = i32(quad.paintMeta.x);
	if (paintKind == 0) {
		// Premultiply for the "premultiplied" canvas alpha mode.
		return vec4<f32>(quad.color.rgb * quad.color.a, quad.color.a);
	}

	// Recover this fragment's node-LOCAL position via the precomputed
	// worldToLocal inverse (see this shader's TS doc comment).
	let localX = quad.worldToLocalRow0.x * in.worldPosition.x
		+ quad.worldToLocalRow0.y * in.worldPosition.y
		+ quad.worldToLocalRow0.z;
	let localY = quad.worldToLocalRow1.x * in.worldPosition.x
		+ quad.worldToLocalRow1.y * in.worldPosition.y
		+ quad.worldToLocalRow1.z;

	if (paintKind == 1) {
		// Linear: t = projection of (local - from) onto (to - from), normalized.
		let fromX = quad.gradientGeometry.x;
		let fromY = quad.gradientGeometry.y;
		let toX = quad.gradientGeometry.z;
		let toY = quad.gradientGeometry.w;
		let axisX = toX - fromX;
		let axisY = toY - fromY;
		let lengthSq = axisX * axisX + axisY * axisY;
		let t = select(
			((localX - fromX) * axisX + (localY - fromY) * axisY) / lengthSq,
			0.0,
			lengthSq <= 0.0,
		);
		return sampleGradient(t);
	}

	// Radial: t = distance(local, center) / radius.
	let centerX = quad.gradientGeometry.x;
	let centerY = quad.gradientGeometry.y;
	let radius = quad.gradientGeometry.z;
	let dx = localX - centerX;
	let dy = localY - centerY;
	let t = select(sqrt(dx * dx + dy * dy) / radius, 0.0, radius <= 0.0);
	return sampleGradient(t);
}
`;

/**
 * WGSL for the TEXTURED cover-pass (E1 S5 — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s S5 decisions). A SEPARATE
 * pipeline/shader/bind-group-layout from `QUAD_SHADER_SOURCE`'s solid/
 * gradient cover pass (per that slice's decision: never force the solid/
 * gradient pipeline to bind a dummy texture) — but the SAME `QuadUniforms`
 * struct/binding-0 layout, so `webgpu.ts`'s existing `writeQuadUniforms`
 * writer and dynamic-offset uniform buffer serve BOTH pipelines unmodified;
 * only `@group(0) @binding(1)` (texture) and `@binding(2)` (sampler) are new,
 * on a SEPARATE bind group layout specific to this pipeline.
 *
 * `vs_main` is BYTE-IDENTICAL to `QUAD_SHADER_SOURCE`'s (camera projection,
 * `rect`-quad corners) — WGSL shader modules are self-contained strings, so
 * this is duplicated rather than shared, matching `STENCIL_SHADER_SOURCE`'s
 * existing precedent of a small, independent vertex stage per pipeline.
 *
 * UV MAPPING: `gradientGeometry` is REPURPOSED to carry the image's
 * NODE-LOCAL placement rect (`x, y, width, height` — see
 * `entities/scene/model/gpu/display-list.ts::GpuPaint`'s `"image"` variant)
 * instead of gradient `from`/`to`/`center`/`radius` — `paintKind == 3`
 * discriminates this from the solid/gradient pipeline's own paintKind values,
 * even though both pipelines share one uniform LAYOUT. The fragment shader
 * recovers the node-local position via the SAME `worldToLocal` inverse
 * `QUAD_SHADER_SOURCE`'s gradient branch already uses, then normalizes it
 * against the placement rect into a base `0..1` UV. S21 uses `paintMeta.xyz`
 * as image fit mode/source width/source height and `paintMeta.w` +
 * `stopOffsets[0]` as an optional normalized source rect for cropped placed
 * image nodes: `fill` stretches exactly like SVG's `preserveAspectRatio="none"`,
 * `fit` centers a `meet` image and returns transparent for letterbox pixels,
 * and `crop` centers a `slice` source crop. Tiled image paints still fail
 * capability before reaching this shader.
 * `color.a` in `QuadUniforms` carries this fill's straight-alpha paint opacity
 * (already folded with the leaf's full inherited-opacity chain, see
 * `display-list.ts`'s `GpuPaint.kind === "image"` doc comment) — multiplied
 * into the sampled texel's RGB only (see the fragment stage's own comment for
 * why alpha is NOT multiplied a second time), matching every other paint kind's
 * premultiplied output convention for the "premultiplied" canvas alpha mode.
 */
export const IMAGE_QUAD_SHADER_SOURCE = /* wgsl */ `
struct QuadUniforms {
	rect: vec4<f32>,
	color: vec4<f32>,
	camera: vec4<f32>,
	viewport: vec4<f32>,
	paintMeta: vec4<f32>,
	// Image placement rect (node-local): xy = origin, zw = size.
	gradientGeometry: vec4<f32>,
	worldToLocalRow0: vec4<f32>,
	worldToLocalRow1: vec4<f32>,
	stopOffsets: array<vec4<f32>, ${MAX_GRADIENT_STOPS_WGSL / 4}>,
	stopColors: array<vec4<f32>, ${MAX_GRADIENT_STOPS_WGSL}>,
};

@group(0) @binding(0) var<uniform> quad: QuadUniforms;
@group(0) @binding(1) var quadTexture: texture_2d<f32>;
@group(0) @binding(2) var quadSampler: sampler;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) worldPosition: vec2<f32>,
};

const IMAGE_UNIT_CORNERS = array<vec2<f32>, 4>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	let unit = IMAGE_UNIT_CORNERS[vertexIndex];
	let worldX = quad.rect.x + unit.x * quad.rect.z;
	let worldY = quad.rect.y + unit.y * quad.rect.w;

	let scale = quad.camera.x;
	let panX = quad.camera.y;
	let panY = quad.camera.z;
	let rotation = quad.camera.w;
	let cosR = cos(rotation);
	let sinR = sin(rotation);
	let screenX = (worldX * cosR - worldY * sinR) * scale + panX;
	let screenY = (worldX * sinR + worldY * cosR) * scale + panY;

	let cssWidth = quad.viewport.x;
	let cssHeight = quad.viewport.y;
	let clipX = (screenX / cssWidth) * 2.0 - 1.0;
	let clipY = 1.0 - (screenY / cssHeight) * 2.0;

	var out: VertexOutput;
	out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
	out.worldPosition = vec2<f32>(worldX, worldY);
	return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	let localX = quad.worldToLocalRow0.x * in.worldPosition.x
		+ quad.worldToLocalRow0.y * in.worldPosition.y
		+ quad.worldToLocalRow0.z;
	let localY = quad.worldToLocalRow1.x * in.worldPosition.x
		+ quad.worldToLocalRow1.y * in.worldPosition.y
		+ quad.worldToLocalRow1.z;

	let rectX = quad.gradientGeometry.x;
	let rectY = quad.gradientGeometry.y;
	let rectWidth = max(quad.gradientGeometry.z, 1e-6);
	let rectHeight = max(quad.gradientGeometry.w, 1e-6);
	var uv = vec2<f32>((localX - rectX) / rectWidth, (localY - rectY) / rectHeight);

	let fitMode = quad.paintMeta.x;
	if (fitMode > 0.5) {
		let sourceWidth = max(quad.paintMeta.y, 1e-6);
		let sourceHeight = max(quad.paintMeta.z, 1e-6);
		let sourceAspect = sourceWidth / sourceHeight;
		let destAspect = rectWidth / rectHeight;
		if (fitMode < 1.5) {
			var imageSize = vec2<f32>(1.0, 1.0);
			var imageOffset = vec2<f32>(0.0, 0.0);
			if (sourceAspect > destAspect) {
				imageSize.y = destAspect / sourceAspect;
				imageOffset.y = (1.0 - imageSize.y) * 0.5;
			} else {
				imageSize.x = sourceAspect / destAspect;
				imageOffset.x = (1.0 - imageSize.x) * 0.5;
			}
			let imageMax = imageOffset + imageSize;
			if (
				uv.x < imageOffset.x ||
				uv.y < imageOffset.y ||
				uv.x > imageMax.x ||
				uv.y > imageMax.y
			) {
				return vec4<f32>(0.0, 0.0, 0.0, 0.0);
			}
			uv = (uv - imageOffset) / imageSize;
		} else {
			var sourceSize = vec2<f32>(1.0, 1.0);
			var sourceOffset = vec2<f32>(0.0, 0.0);
			if (sourceAspect > destAspect) {
				sourceSize.x = destAspect / sourceAspect;
				sourceOffset.x = (1.0 - sourceSize.x) * 0.5;
			} else {
				sourceSize.y = sourceAspect / destAspect;
				sourceOffset.y = (1.0 - sourceSize.y) * 0.5;
			}
			uv = sourceOffset + uv * sourceSize;
		}
	}
	if (quad.paintMeta.w > 0.5) {
		let sourceRect = quad.stopOffsets[0];
		uv = sourceRect.xy + uv * sourceRect.zw;
		if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
			return vec4<f32>(0.0, 0.0, 0.0, 0.0);
		}
	}

	let texel = textureSample(quadTexture, quadSampler, uv);
	// texel arrives ALREADY premultiplied - the texture cache uploads via
	// copyExternalImageToTexture with premultipliedAlpha: true (see
	// texture-cache.ts), so texel.rgb is already sourceColor * texel.a. Only
	// this draw's own opacity (quad.color.a) still needs folding in;
	// multiplying texel.rgb by texel.a again would square the source alpha
	// into rgb, darkening every partially-transparent pixel versus the SVG
	// renderer's image output.
	return vec4<f32>(texel.rgb * quad.color.a, texel.a * quad.color.a);
}
`;

/**
 * Full-screen copy/composite shader for the E1 S16 offscreen source texture.
 * The main scene pass resolves MSAA into a single-sample, texture-bindable
 * premultiplied RGBA target; this shader writes those pixels into the current
 * swapchain texture without changing alpha or blending math. UVs follow the
 * same top-left origin the scene pass wrote, so this is an unflipped 1:1 copy.
 */
export const SOURCE_COMPOSITE_SHADER_SOURCE = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

const COMPOSITE_POSITIONS = array<vec2<f32>, 4>(
	vec2<f32>(-1.0, 1.0),
	vec2<f32>(1.0, 1.0),
	vec2<f32>(-1.0, -1.0),
	vec2<f32>(1.0, -1.0),
);

const COMPOSITE_UVS = array<vec2<f32>, 4>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	var out: VertexOutput;
	out.position = vec4<f32>(COMPOSITE_POSITIONS[vertexIndex], 0.0, 1.0);
	out.uv = COMPOSITE_UVS[vertexIndex];
	return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	return textureSample(sourceTexture, sourceSampler, in.uv);
}
`;

/**
 * Node-local radiance/surface-response compositor. The input texture contains
 * only one effect island's original draws; this shader emits the optical
 * consequence only, so the renderer can composite it immediately after the
 * original draws at the same document paint-order position.
 */
export const NODE_OPTICAL_EFFECT_SHADER_SOURCE = /* wgsl */ `
struct OpticalEffectUniforms {
	screenRect: vec4<f32>,
	viewport: vec4<f32>,
	meta: vec4<f32>,
	bloom: vec4<f32>,
	atmosphere: vec4<f32>,
	atmosphereDirection: vec4<f32>,
	atmosphereColor: vec4<f32>,
	lens: vec4<f32>,
	responseDirection: vec4<f32>,
	surface: vec4<f32>,
	surfaceColor: vec4<f32>,
	diffusion: vec4<f32>,
	diffusionColor: vec4<f32>,
	edge: vec4<f32>,
	edgeColor: vec4<f32>,
	spectral: vec4<f32>,
	rayGeometry: array<vec4<f32>, 4>,
	rayBridge: array<vec4<f32>, 4>,
	raySamples: array<vec4<f32>, 68>,
};

@group(0) @binding(0) var islandTexture: texture_2d<f32>;
@group(0) @binding(1) var islandSampler: sampler;
@group(0) @binding(2) var<uniform> optical: OpticalEffectUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) screen: vec2<f32>,
	@location(1) unit: vec2<f32>,
};

const OPTICAL_CORNERS = array<vec2<f32>, 4>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	let unit = OPTICAL_CORNERS[vertexIndex];
	let screen = optical.screenRect.xy + unit * optical.screenRect.zw;
	var out: VertexOutput;
	out.position = vec4<f32>(
		(screen.x / optical.viewport.x) * 2.0 - 1.0,
		1.0 - (screen.y / optical.viewport.y) * 2.0,
		0.0,
		1.0,
	);
	out.screen = screen;
	out.unit = unit;
	return out;
}

fn sampleScreen(screen: vec2<f32>) -> vec4<f32> {
	if (
		screen.x < 0.0 || screen.y < 0.0 ||
		screen.x > optical.viewport.x || screen.y > optical.viewport.y
	) {
		return vec4<f32>(0.0);
	}
	return textureSample(islandTexture, islandSampler, screen / optical.viewport.xy);
}

fn premultipliedTint(color: vec4<f32>, alpha: f32) -> vec4<f32> {
	let boundedAlpha = clamp(alpha * color.a, 0.0, 1.0);
	return vec4<f32>(color.rgb * boundedAlpha, boundedAlpha);
}

fn emissionAt(screen: vec2<f32>) -> vec4<f32> {
	let source = sampleScreen(screen);
	if (source.a <= 1e-6) { return vec4<f32>(0.0); }
	let straight = source.rgb / source.a;
	let luma = dot(straight, vec3<f32>(0.2126, 0.7152, 0.0722));
	let threshold = clamp(optical.meta.y, 0.0, 0.999);
	let alpha = source.a * clamp((luma - threshold) / (1.0 - threshold), 0.0, 1.0);
	return vec4<f32>(straight * alpha, alpha);
}

fn crossBloom(screen: vec2<f32>, radius: vec2<f32>) -> vec4<f32> {
	var sum = vec4<f32>(0.0);
	var weightSum = 0.0;
	for (var index: i32 = -4; index <= 4; index = index + 1) {
		let t = f32(index) / 4.0;
		let weight = exp(-2.4 * t * t);
		sum = sum + emissionAt(screen + vec2<f32>(t * radius.x, 0.0)) * weight;
		sum = sum + emissionAt(screen + vec2<f32>(0.0, t * radius.y)) * weight;
		weightSum = weightSum + weight * 2.0;
	}
	return sum / max(weightSum, 1e-6);
}

fn rayEmission(screen: vec2<f32>, offset: vec2<f32>, bridgeSigma: vec2<f32>) -> vec4<f32> {
	let center = screen - offset;
	return (
		emissionAt(center) * 0.4 +
		emissionAt(center + vec2<f32>(bridgeSigma.x, 0.0)) * 0.15 +
		emissionAt(center - vec2<f32>(bridgeSigma.x, 0.0)) * 0.15 +
		emissionAt(center + vec2<f32>(0.0, bridgeSigma.y)) * 0.15 +
		emissionAt(center - vec2<f32>(0.0, bridgeSigma.y)) * 0.15
	);
}

fn radianceField(screen: vec2<f32>) -> vec4<f32> {
	var output = vec4<f32>(0.0);
	if (optical.bloom.w > 0.5 && optical.bloom.z > 0.0) {
		output = output + crossBloom(screen, optical.bloom.xy) * optical.bloom.z;
	}
	let rayCount = min(4, i32(optical.meta.z));
	for (var rayIndex: i32 = 0; rayIndex < rayCount; rayIndex = rayIndex + 1) {
		let geometry = optical.rayGeometry[rayIndex];
		if (geometry.w <= 0.5 || geometry.z <= 0.0) { continue; }
		let bridgeSigma = max(optical.rayBridge[rayIndex].xy, vec2<f32>(0.1));
		var ray = vec4<f32>(0.0);
		for (var sampleIndex: i32 = 0; sampleIndex < 17; sampleIndex = sampleIndex + 1) {
			let sample = optical.raySamples[rayIndex * 17 + sampleIndex];
			if (sample.z <= 0.0) { continue; }
			ray = ray + rayEmission(screen, sample.xy, bridgeSigma) * sample.z;
		}
		output = output + ray * geometry.z;
	}
	if (optical.atmosphere.w > 0.5 && optical.atmosphere.x > 0.0) {
		let directionLength = length(optical.atmosphereDirection.xy);
		let direction = select(vec2<f32>(0.0, 1.0), optical.atmosphereDirection.xy / directionLength, directionLength > 1e-6);
		let perpendicular = vec2<f32>(-direction.y, direction.x);
		var spill = vec4<f32>(0.0);
		var spillWeight = 0.0;
		for (var sampleIndex: i32 = 0; sampleIndex <= 8; sampleIndex = sampleIndex + 1) {
			let progress = f32(sampleIndex) / 8.0;
			let weight = max(0.01, pow(1.0 - progress, 0.5 + optical.atmosphere.y * 3.5));
			let center = screen - direction * optical.atmosphere.z * progress;
			spill = spill + emissionAt(center) * weight * 0.5;
			spill = spill + emissionAt(center + perpendicular * optical.atmosphere.z * 0.12) * weight * 0.25;
			spill = spill + emissionAt(center - perpendicular * optical.atmosphere.z * 0.12) * weight * 0.25;
			spillWeight = spillWeight + weight;
		}
		let spillAlpha = (spill / max(spillWeight, 1e-6)).a * optical.atmosphere.x;
		output = output + premultipliedTint(optical.atmosphereColor, spillAlpha);
	}
	if (optical.lens.w > 0.5 && optical.lens.x > 0.0 && optical.lens.y > 0.0) {
		let red = emissionAt(screen + vec2<f32>(optical.lens.y, 0.0));
		let blue = emissionAt(screen - vec2<f32>(optical.lens.y, 0.0));
		let alpha = max(red.a, blue.a) * optical.lens.x;
		output = output + vec4<f32>(red.r, 0.0, blue.b, alpha);
	}
	return vec4<f32>(max(output.rgb, vec3<f32>(0.0)), clamp(output.a, 0.0, 1.0));
}

fn alphaAt(screen: vec2<f32>) -> f32 {
	return sampleScreen(screen).a;
}

fn softenedFrontBand(screen: vec2<f32>, direction: vec2<f32>, width: f32, softness: f32) -> f32 {
	let perpendicular = vec2<f32>(-direction.y, direction.x);
	var band = 0.0;
	var weight = 0.0;
	for (var index: i32 = -2; index <= 2; index = index + 1) {
		let t = f32(index) / 2.0;
		let samplePosition = screen + perpendicular * softness * t;
		let current = alphaAt(samplePosition);
		let outside = alphaAt(samplePosition + direction * width);
		let sampleWeight = select(0.65, 1.0, index == 0);
		band = band + max(0.0, current - outside) * sampleWeight;
		weight = weight + sampleWeight;
	}
	return band / max(weight, 1e-6);
}

fn surfaceResponse(screen: vec2<f32>, unit: vec2<f32>) -> vec4<f32> {
	let directionLength = length(optical.responseDirection.xy);
	let direction = select(vec2<f32>(0.0, -1.0), optical.responseDirection.xy / directionLength, directionLength > 1e-6);
	let facing = smoothstep(-0.35, 0.48, dot(unit - vec2<f32>(0.5), direction));
	let source = sampleScreen(screen);
	var output = vec4<f32>(0.0);
	var spectralMask = 0.0;
	if (optical.surface.w > 0.5 && optical.surface.x > 0.0) {
		var mask = softenedFrontBand(screen, direction, optical.surface.y, optical.surface.z) * facing;
		if (optical.meta.w > 0.0 && source.a > 1e-6) {
			let luma = dot(source.rgb / source.a, vec3<f32>(0.2126, 0.7152, 0.0722));
			mask = mask * mix(1.0, luma, clamp(optical.meta.w, 0.0, 1.0));
		}
		mask = mask * optical.surface.x;
		output = output + premultipliedTint(optical.surfaceColor, mask);
		spectralMask = max(spectralMask, mask);
	}
	if (optical.diffusion.w > 0.5 && optical.diffusion.x > 0.0) {
		let band = softenedFrontBand(screen, direction, optical.diffusion.y, optical.diffusion.z);
		let inside = band * source.a * facing * optical.diffusion.x;
		output = output + premultipliedTint(optical.diffusionColor, inside);
		spectralMask = max(spectralMask, inside);
	}
	if (optical.edge.w > 0.5 && optical.edge.x > 0.0) {
		let mask = softenedFrontBand(screen, direction, optical.edge.y, optical.edge.z) * facing * optical.edge.x;
		output = output + premultipliedTint(optical.edgeColor, mask);
		spectralMask = max(spectralMask, mask);
	}
	if (optical.spectral.z > 0.5 && optical.spectral.x > 0.0 && spectralMask > 0.0) {
		let perpendicular = vec2<f32>(-direction.y, direction.x);
		let redMask = softenedFrontBand(screen + perpendicular * optical.spectral.y, direction, max(1.0, optical.surface.y), max(0.1, optical.surface.z));
		let blueMask = softenedFrontBand(screen - perpendicular * optical.spectral.y, direction, max(1.0, optical.surface.y), max(0.1, optical.surface.z));
		let amount = optical.spectral.x * facing;
		output = output + vec4<f32>(redMask * amount, 0.0, blueMask * amount, max(redMask, blueMask) * amount);
	}
	return vec4<f32>(max(output.rgb, vec3<f32>(0.0)), clamp(output.a, 0.0, 1.0));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	if (optical.meta.x < 0.5) {
		return radianceField(in.screen);
	}
	return surfaceResponse(in.screen, in.unit);
}
`;

/**
 * Artboard-local radial chromatic-aberration pass (E1 S17). This mirrors the
 * legacy frame-film contract: red samples inward toward the optical center,
 * blue samples outward, and green/alpha remain at the current source pixel.
 * The shader draws only the target artboard's screen rect and clamps channel
 * sample coordinates to that rect so neighboring artboards never bleed into
 * the channel shifts.
 */
export const CHROMATIC_ABERRATION_SHADER_SOURCE = /* wgsl */ `
struct ChromaticAberrationUniforms {
	screenRect: vec4<f32>,
	viewport: vec4<f32>,
	artboardSize: vec4<f32>,
	params: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> ca: ChromaticAberrationUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) unit: vec2<f32>,
};

const CA_UNIT_CORNERS = array<vec2<f32>, 4>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	let unit = CA_UNIT_CORNERS[vertexIndex];
	let screen = ca.screenRect.xy + unit * ca.screenRect.zw;
	let clipX = (screen.x / ca.viewport.x) * 2.0 - 1.0;
	let clipY = 1.0 - (screen.y / ca.viewport.y) * 2.0;

	var out: VertexOutput;
	out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
	out.unit = unit;
	return out;
}

fn sampleAtLocal(localPosition: vec2<f32>) -> vec4<f32> {
	let size = max(ca.artboardSize.xy, vec2<f32>(1.0, 1.0));
	let clampedLocal = clamp(localPosition, vec2<f32>(0.0, 0.0), size);
	let screen = ca.screenRect.xy + (clampedLocal / size) * ca.screenRect.zw;
	let uv = screen / ca.viewport.xy;
	return textureSample(sourceTexture, sourceSampler, uv);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	let size = max(ca.artboardSize.xy, vec2<f32>(1.0, 1.0));
	let local = in.unit * size;
	let center = vec2<f32>(
		ca.params.z * max(size.x - 1.0, 0.0),
		ca.params.w * max(size.y - 1.0, 0.0),
	);
	let delta = local - center;
	let dist = length(delta);
	let unit = select(vec2<f32>(0.0, 0.0), delta / dist, dist > 1e-6);
	let refDist = max(1.0, length(center));
	let shift = ca.params.x * ca.params.y * (dist / refDist);

	let current = sampleAtLocal(local);
	let red = sampleAtLocal(local - unit * shift);
	let blue = sampleAtLocal(local + unit * shift);
	return vec4<f32>(red.r, current.g, blue.b, current.a);
}
`;

/**
 * Artboard-local legacy frame-film grain pass (E1 S18). The grain texture is the
 * exact black/white alpha overlay produced by vec-core's CPU grain field; WGSL
 * only recreates the SVG filter's alpha-weighting, darkness object mask, and
 * premultiplied "over" composition. When `grainParams.z` is 1, the shader first
 * applies the S17 chromatic-aberration sample pattern to SourceGraphic, matching
 * the SVG frame filter order (CA before grain) without needing a ping-pong
 * texture for the two-pass legacy film pair.
 */
export const FRAME_FILM_GRAIN_SHADER_SOURCE = /* wgsl */ `
struct FrameFilmGrainUniforms {
	screenRect: vec4<f32>,
	viewport: vec4<f32>,
	artboardSize: vec4<f32>,
	caParams: vec4<f32>,
	grainParams: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var grainTexture: texture_2d<f32>;
@group(0) @binding(3) var grainSampler: sampler;
@group(0) @binding(4) var<uniform> film: FrameFilmGrainUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) unit: vec2<f32>,
};

const FRAME_FILM_UNIT_CORNERS = array<vec2<f32>, 4>(
	vec2<f32>(0.0, 0.0),
	vec2<f32>(1.0, 0.0),
	vec2<f32>(0.0, 1.0),
	vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	let unit = FRAME_FILM_UNIT_CORNERS[vertexIndex];
	let screen = film.screenRect.xy + unit * film.screenRect.zw;
	let clipX = (screen.x / film.viewport.x) * 2.0 - 1.0;
	let clipY = 1.0 - (screen.y / film.viewport.y) * 2.0;

	var out: VertexOutput;
	out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
	out.unit = unit;
	return out;
}

fn sampleSourceAtLocal(localPosition: vec2<f32>) -> vec4<f32> {
	let size = max(film.artboardSize.xy, vec2<f32>(1.0, 1.0));
	let clampedLocal = clamp(localPosition, vec2<f32>(0.0, 0.0), size);
	let screen = film.screenRect.xy + (clampedLocal / size) * film.screenRect.zw;
	let uv = screen / film.viewport.xy;
	return textureSample(sourceTexture, sourceSampler, uv);
}

fn chromaticSourceAtLocal(local: vec2<f32>) -> vec4<f32> {
	let size = max(film.artboardSize.xy, vec2<f32>(1.0, 1.0));
	let center = vec2<f32>(
		film.caParams.z * max(size.x - 1.0, 0.0),
		film.caParams.w * max(size.y - 1.0, 0.0),
	);
	let delta = local - center;
	let dist = length(delta);
	let unit = select(vec2<f32>(0.0, 0.0), delta / dist, dist > 1e-6);
	let refDist = max(1.0, length(center));
	let shift = film.caParams.x * film.caParams.y * (dist / refDist);

	let current = sampleSourceAtLocal(local);
	let red = sampleSourceAtLocal(local - unit * shift);
	let blue = sampleSourceAtLocal(local + unit * shift);
	return vec4<f32>(red.r, current.g, blue.b, current.a);
}

fn over(top: vec4<f32>, under: vec4<f32>) -> vec4<f32> {
	let inverseAlpha = 1.0 - top.a;
	return vec4<f32>(
		top.rgb + under.rgb * inverseAlpha,
		top.a + under.a * inverseAlpha,
	);
}

fn alphaWeightedGrain(grain: vec4<f32>, weight: f32) -> vec4<f32> {
	let w = clamp(weight, 0.0, 1.0);
	return vec4<f32>(grain.rgb * w, grain.a * w);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	let size = max(film.artboardSize.xy, vec2<f32>(1.0, 1.0));
	let local = in.unit * size;
	let base = select(
		sampleSourceAtLocal(local),
		chromaticSourceAtLocal(local),
		film.grainParams.z > 0.5,
	);
	let grain = textureSample(grainTexture, grainSampler, in.unit);
	let background = alphaWeightedGrain(grain, film.grainParams.x);

	let straightRgb = base.rgb / max(base.a, 1e-6);
	let darkness = clamp(1.0 - dot(straightRgb, vec3<f32>(0.299, 0.587, 0.114)), 0.0, 1.0);
	let objectMask = clamp((darkness - 0.2) / 0.3, 0.0, 1.0);
	let objectExtraWeight = max(0.0, film.grainParams.y - film.grainParams.x);
	let object = alphaWeightedGrain(grain, objectExtraWeight * objectMask);

	return over(object, over(background, base));
}
`;

/**
 * WGSL for the stencil-pass vertex stage (E1 S2 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D4). Vertex positions arrive
 * ALREADY in world space (pre-transformed CPU-side by each node's
 * `worldTransform` — see `shared/gpu/flatten.ts::fanTriangulateRings`), so
 * this shader applies only the camera projection, identical to `QUAD_SHADER_SOURCE`'s
 * `vs_main` world -> clip math. `colorWriteMask: 0` at the pipeline level makes
 * the fragment stage a no-op write target; WebGPU still requires a fragment
 * entry point on a pipeline with a `fragment` stage, so this exports a stub
 * that emits transparent black (never actually written to the color
 * attachment — see `webgpu.ts`'s stencil pipeline `targets` config).
 *
 * One dynamic-offset `StencilCameraUniforms` binding carries the camera +
 * viewport (no per-triangle uniform — the whole draw call shares one camera),
 * mirroring the quad pipeline's binding-group SHAPE (binding 0, dynamic
 * uniform buffer) so both pipelines can share `webgpu.ts`'s existing
 * `growUniformBuffer`-style buffer management pattern.
 */
export const STENCIL_SHADER_SOURCE = /* wgsl */ `
struct StencilCameraUniforms {
	camera: vec4<f32>,
	viewport: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: StencilCameraUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@location(0) worldPosition: vec2<f32>) -> VertexOutput {
	let scale = frame.camera.x;
	let panX = frame.camera.y;
	let panY = frame.camera.z;
	let rotation = frame.camera.w;
	let cosR = cos(rotation);
	let sinR = sin(rotation);
	let screenX = (worldPosition.x * cosR - worldPosition.y * sinR) * scale + panX;
	let screenY = (worldPosition.x * sinR + worldPosition.y * cosR) * scale + panY;

	let cssWidth = frame.viewport.x;
	let cssHeight = frame.viewport.y;
	let clipX = (screenX / cssWidth) * 2.0 - 1.0;
	let clipY = 1.0 - (screenY / cssHeight) * 2.0;

	var out: VertexOutput;
	out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
	return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
	return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}
`;

/**
 * WGSL for the uniform-stroke stencil-pass vertex+fragment stages (E1 S3,
 * dashing added E1 S8 — see `docs/gpu-canvas-convergence-e1-plan.md`'s stroke
 * and S8 decisions, and `stroke-mesh.ts`'s doc comment for the CPU-side mesh
 * this consumes). Each vertex carries THREE attributes — `centerlinePosition`
 * (a WORLD-space point on the flattened stroke centerline), `unitOffset` (a
 * direction, not necessarily unit-length for a miter tip — see
 * `stroke-mesh.ts::pushJoin`), and (S8) `arcLength` (this vertex's WORLD-space
 * cumulative distance along its own contour, see `stroke-mesh.ts`'s vertex doc
 * comment) — and the vertex shader computes the actual on-screen corner as
 * `centerlinePosition + unitOffset * halfWidthWorld` BEFORE the SAME camera
 * projection `STENCIL_SHADER_SOURCE` already uses, passing `arcLength` through
 * as an interpolated varying for the fragment stage's dash test.
 *
 * `StrokeDrawUniforms` (binding 1, dynamic-offset, one slot per stroke draw —
 * S8 widens what was `StrokeHalfWidthUniforms`'s single `halfWidthWorld` slot)
 * carries every per-draw scalar the fragment stage needs to evaluate dashing
 * WITHOUT re-tessellating the mesh on zoom/pan, mirroring `halfWidthWorld`'s
 * own established pattern: `dashPattern0`/`dashPattern1` are the (already
 * screen-px -> world-px CPU-converted, see `gpu-scene-frame.ts`) dash pattern,
 * up to 8 entries packed 4-per-vec4 (matching `QuadUniforms`'s
 * `stopOffsets`-packing convention above); `dashMeta.x` is the entry COUNT
 * (`0` means undashed — the fragment stage short-circuits before touching the
 * pattern at all, so an ordinary stroke's rasterization is byte-identical to
 * pre-S8 output) and `dashMeta.y` is the world-unit dash OFFSET (phase).
 *
 * **Dash evaluation (fragment stage, stencil pass only).** When `dashCount >
 * 0`: sum the first `dashCount` pattern entries into `period`; if `period <=
 * 0` (a degenerate all-zero pattern — unreachable through the capability gate,
 * which requires at least one positive entry, but guarded here defensively)
 * draw solid instead of dividing by zero; otherwise compute `t = (arcLength +
 * dashOffsetWorld) mod period` and walk the pattern accumulating each entry's
 * length, discarding when `t` falls inside an ODD-indexed entry (a gap — SVG
 * `stroke-dasharray` alternates dash/gap/dash/gap..., entry 0 always a dash).
 * A `discard`ed fragment writes NO stencil value at all, so a dash gap
 * genuinely gets zero winding — the (unmodified) cover pass then correctly
 * paints nothing there, and an open clip scope (S7) composes with zero extra
 * code, since the gap simply never enters the stencil-then-cover contract to
 * begin with.
 *
 * `colorWriteMask: 0`/the transparent-black fragment output on the SOLID
 * (non-discarded) path mirror `STENCIL_SHADER_SOURCE` exactly (see that
 * shader's doc comment for why a stub fragment stage is required at all) —
 * `discard` is the only new fragment-stage behavior S8 introduces.
 */
export const STROKE_STENCIL_SHADER_SOURCE = /* wgsl */ `
struct StencilCameraUniforms {
	camera: vec4<f32>,
	viewport: vec4<f32>,
};

struct StrokeDrawUniforms {
	// x = halfWidthWorld, yzw unused.
	halfWidthWorld: vec4<f32>,
	// Dash pattern entries 0..4, world units (already screen->world converted CPU-side).
	dashPattern0: vec4<f32>,
	// Dash pattern entries 4..8, world units.
	dashPattern1: vec4<f32>,
	// x = dashCount (0 = undashed), y = dashOffsetWorld, zw unused.
	dashMeta: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: StencilCameraUniforms;
@group(0) @binding(1) var<uniform> stroke: StrokeDrawUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) arcLength: f32,
};

@vertex
fn vs_main(
	@location(0) centerlinePosition: vec2<f32>,
	@location(1) unitOffset: vec2<f32>,
	@location(2) arcLength: f32,
) -> VertexOutput {
	let halfWidthWorld = stroke.halfWidthWorld.x;
	let worldX = centerlinePosition.x + unitOffset.x * halfWidthWorld;
	let worldY = centerlinePosition.y + unitOffset.y * halfWidthWorld;

	let scale = frame.camera.x;
	let panX = frame.camera.y;
	let panY = frame.camera.z;
	let rotation = frame.camera.w;
	let cosR = cos(rotation);
	let sinR = sin(rotation);
	let screenX = (worldX * cosR - worldY * sinR) * scale + panX;
	let screenY = (worldX * sinR + worldY * cosR) * scale + panY;

	let cssWidth = frame.viewport.x;
	let cssHeight = frame.viewport.y;
	let clipX = (screenX / cssWidth) * 2.0 - 1.0;
	let clipY = 1.0 - (screenY / cssHeight) * 2.0;

	var out: VertexOutput;
	out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
	out.arcLength = arcLength;
	return out;
}

// Fetches dash pattern entry at index (0..7) from the two packed vec4s.
fn dashPatternAt(index: i32) -> f32 {
	if (index < 4) {
		if (index == 0) { return stroke.dashPattern0.x; }
		if (index == 1) { return stroke.dashPattern0.y; }
		if (index == 2) { return stroke.dashPattern0.z; }
		return stroke.dashPattern0.w;
	}
	if (index == 4) { return stroke.dashPattern1.x; }
	if (index == 5) { return stroke.dashPattern1.y; }
	if (index == 6) { return stroke.dashPattern1.z; }
	return stroke.dashPattern1.w;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
	let dashCount = i32(stroke.dashMeta.x);
	if (dashCount > 0) {
		var period = 0.0;
		for (var i = 0; i < dashCount; i = i + 1) {
			period = period + dashPatternAt(i);
		}
		if (period > 0.0) {
			let dashOffsetWorld = stroke.dashMeta.y;
			var t = (in.arcLength + dashOffsetWorld) % period;
			if (t < 0.0) {
				t = t + period;
			}
			var accumulated = 0.0;
			for (var i = 0; i < dashCount; i = i + 1) {
				let entryLength = dashPatternAt(i);
				let nextAccumulated = accumulated + entryLength;
				if (t < nextAccumulated) {
					// Odd index = gap (SVG stroke-dasharray convention: entry 0 is
					// always a dash) - discard so the stencil pass writes NO
					// winding here, matching a real gap's zero-coverage semantics.
					if (i % 2 == 1) {
						discard;
					}
					break;
				}
				accumulated = nextAccumulated;
			}
		}
	}
	return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}
`;
