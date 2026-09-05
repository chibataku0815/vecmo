import type {
	AssetContainer,
	InstantiatedEntries,
} from "@babylonjs/core/assetContainer";
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Plane } from "@babylonjs/core/Maths/math.plane";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import {
	getBabylonShadowFilterMode,
	isBabylonPbrEnabled,
} from "@/shared/lib/babylon-pbr-flag";
import type {
	Runtime3dArtboardClip,
	Runtime3dCamera,
	Runtime3dFidelityIssue,
	Runtime3dFrame,
	Runtime3dFrameSequenceSource,
	Runtime3dModelSource,
	Runtime3dPickOutcome,
	Runtime3dPlacement,
	Runtime3dVectorPlane,
	Runtime3dVectorPlaneTexture,
	Runtime3dWorldMatrix,
} from "@/shared/runtime-3d/types";

type BabylonModules = {
	readonly Camera: typeof import("@babylonjs/core/Cameras/camera").Camera;
	readonly Color3: typeof import("@babylonjs/core/Maths/math.color").Color3;
	readonly Color4: typeof import("@babylonjs/core/Maths/math.color").Color4;
	readonly CreatePlane: typeof import("@babylonjs/core/Meshes/Builders/planeBuilder").CreatePlane;
	readonly DepthOfFieldEffect: typeof import("@babylonjs/core/PostProcesses/depthOfFieldEffect").DepthOfFieldEffect;
	readonly DepthOfFieldEffectBlurLevel: typeof import("@babylonjs/core/PostProcesses/depthOfFieldEffect").DepthOfFieldEffectBlurLevel;
	readonly DepthRenderer: typeof import("@babylonjs/core/Rendering/depthRenderer").DepthRenderer;
	readonly DirectionalLight: typeof import("@babylonjs/core/Lights/directionalLight").DirectionalLight;
	readonly Engine: typeof import("@babylonjs/core/Engines/engine").Engine;
	readonly FreeCamera: typeof import("@babylonjs/core/Cameras/freeCamera").FreeCamera;
	readonly FxaaPostProcess: typeof import("@babylonjs/core/PostProcesses/fxaaPostProcess").FxaaPostProcess;
	readonly HDRCubeTexture: typeof import("@babylonjs/core/Materials/Textures/hdrCubeTexture").HDRCubeTexture;
	readonly HemisphericLight: typeof import("@babylonjs/core/Lights/hemisphericLight").HemisphericLight;
	readonly ImageProcessingConfiguration: typeof import("@babylonjs/core/Materials/imageProcessingConfiguration").ImageProcessingConfiguration;
	readonly LoadAssetContainerAsync: typeof import("@babylonjs/core/Loading/sceneLoader").LoadAssetContainerAsync;
	readonly Material: typeof import("@babylonjs/core/Materials/material").Material;
	readonly Matrix: typeof import("@babylonjs/core/Maths/math.vector").Matrix;
	readonly Plane: typeof import("@babylonjs/core/Maths/math.plane").Plane;
	readonly PostProcessRenderEffect: typeof import("@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderEffect").PostProcessRenderEffect;
	readonly PostProcessRenderPipeline: typeof import("@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipeline").PostProcessRenderPipeline;
	readonly RegisterDepthRendererSceneComponent: typeof import("@babylonjs/core/Rendering/depthRendererSceneComponent").RegisterDepthRendererSceneComponent;
	readonly Scene: typeof import("@babylonjs/core/scene").Scene;
	readonly ShadowGenerator: typeof import("@babylonjs/core/Lights/Shadows/shadowGenerator").ShadowGenerator;
	readonly SSAO2RenderingPipeline: typeof import("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline").SSAO2RenderingPipeline;
	readonly StandardMaterial: typeof import("@babylonjs/core/Materials/standardMaterial").StandardMaterial;
	readonly Texture: typeof import("@babylonjs/core/Materials/Textures/texture").Texture;
	readonly TransformNode: typeof import("@babylonjs/core/Meshes/transformNode").TransformNode;
	readonly Vector3: typeof import("@babylonjs/core/Maths/math.vector").Vector3;
};

type LoadedSource = {
	readonly container: AssetContainer;
};

type ModelPlacementInstance = {
	readonly kind: "model";
	readonly entries: InstantiatedEntries;
	readonly root: TransformNode;
	readonly sourceKey: string;
};

/**
 * One rendered Blender frame package placed as a textured quad (S4-C).
 *
 * It is a PLACEMENT, not a vector plane, deliberately: the one-3D-band contract
 * says switching a link between GLB and rendered output changes which pixels
 * arrive and nothing else. Reusing `Runtime3dPlacement` — and therefore the same
 * `worldMatrix`, the same artboard clip passes, the same document order, and the
 * same picking metadata — makes that true by construction instead of by a
 * parallel code path someone has to keep in agreement.
 *
 * `texture` and `frameCacheKey` are mutable because the quad survives across
 * frames while its texture is replaced whenever the addressed frame changes.
 * Rebuilding the instance per frame would re-measure and re-place it 120 times
 * over a 120-frame package.
 */
type FrameSequencePlacementInstance = {
	readonly kind: "frame-sequence";
	readonly root: TransformNode;
	readonly mesh: Mesh;
	readonly material: StandardMaterial;
	texture: Texture;
	frameCacheKey: string;
	readonly sourceKey: string;
};

type PlacementInstance =
	| ModelPlacementInstance
	| FrameSequencePlacementInstance;

type VectorPlaneInstance = {
	readonly material: StandardMaterial;
	readonly mesh: Mesh;
	readonly texture: Texture;
	readonly textureKey: string;
};

type TexturedVectorPlane = Runtime3dVectorPlane & {
	readonly texture: Runtime3dVectorPlaneTexture;
};

export type BabylonRuntimeSurface = {
	readonly renderFrame: (frame: Runtime3dFrame) => Promise<void>;
	readonly pickNodeAtClientPoint: (
		clientX: number,
		clientY: number,
	) => Runtime3dPickOutcome | null;
	readonly dispose: () => void;
};

export type BabylonRuntimeSurfaceOptions = {
	/**
	 * Keeps the last committed pixels readable for browser-side export
	 * compositing. Live preview leaves this disabled.
	 */
	readonly preserveDrawingBuffer?: boolean;
	/**
	 * Non-fatal fidelity issue reporting, distinct from the required `onError`
	 * parameter: `onError` means the surface is broken, while an issue here
	 * means the surface degraded gracefully (e.g. the P6-A candidate
	 * environment failed to load and the baseline analytic rig took over) and
	 * rendering continues normally. Callers may omit this; nothing requires it.
	 */
	readonly onIssue?: (issue: Runtime3dFidelityIssue) => void;
};

const RUNTIME_NODE_ID_METADATA_KEY = "vecmoRuntime3dNodeId";

/** Baseline (flag-off) analytic lighting rig. Never changes. */
const BASELINE_AMBIENT_INTENSITY = 1.5;
const BASELINE_KEY_INTENSITY = 2;

/**
 * P6-A candidate (flag-on) analytic rig retune. The environment texture
 * supplies ambient contribution instead, so the hemispheric light is kept
 * (lifecycle/dispose unchanged) but zeroed.
 *
 * P6-B raised this from `1.0`: IBL is not shadowable by `ShadowGenerator`
 * (shadows only darken this analytic key's direct contribution), so most of
 * the key's energy has to live here, not in the HDR's baked-in key highlight
 * (`scripts/gen-babylon-studio-env.ts`'s `KEY_PEAK`, lowered from `14` to `3`
 * for the same reason — see that constant's doc comment). `5.4` was tuned
 * empirically so unshadowed ground brightness matches the pre-P6-B
 * candidate render (~244/255) within a few percent; see this module's P6-B
 * shadow doc for the measured numbers.
 */
const PBR_AMBIENT_INTENSITY = 0.0;
const PBR_KEY_INTENSITY = 5.4;

const STUDIO_ENVIRONMENT_URL = "/runtime-3d/studio-neutral-128x64.hdr";
const STUDIO_ENVIRONMENT_CUBE_SIZE = 128;
const ENVIRONMENT_INTENSITY = 1.0;
const PBR_EXPOSURE = 1.0;
const PBR_CONTRAST = 1.0;

/**
 * The HDR studio environment's own authored key-highlight position
 * (`scripts/gen-babylon-studio-env.ts`'s `KEY_AZIMUTH_DEG` /
 * `KEY_ELEVATION_DEG` — duplicated here, not imported, since that script is a
 * Node-only build-time generator and is not part of this browser runtime
 * bundle). P6-B derives the candidate analytic key light's direction from
 * these same two numbers so the IBL specular highlight and the
 * shadow-casting light agree on where "the light" is; see
 * {@link pbrKeyLightDirection}.
 */
const STUDIO_ENVIRONMENT_KEY_AZIMUTH_DEG = 40;
const STUDIO_ENVIRONMENT_KEY_ELEVATION_DEG = 35;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Derives the P6-B candidate key light's `direction` (the direction light
 * *travels*, light-to-scene) from the HDR studio environment's authored
 * azimuth/elevation, so the analytic shadow and the IBL specular highlight
 * agree on where the key light sits.
 *
 * Reasoning (this is genuinely multi-stage, and was cross-checked against a
 * live measurement rather than trusted from symbolic derivation alone — see
 * below):
 *
 * 1. `scripts/gen-babylon-studio-env.ts` places its key highlight blob at
 *    panorama pixel `row = HEIGHT*(90-elevationDeg)/180`,
 *    `col = WIDTH*azimuthDeg/360` (row 0 = image top = zenith).
 * 2. Babylon's own equirect→cubemap bake
 *    (`PanoramaToCubeMapTools.CalcProjectionSpherical`,
 *    `@babylonjs/core/Misc/HighDynamicRange/panoramaToCubemap.js`) samples
 *    that same pixel grid from a bake-space direction `b` via
 *    `theta=atan2(b.z,b.x)`, `phi=acos(b.y)`, with the default `invertY=true`
 *    flip applied to the row lookup.
 * 3. This scene's PBR IBL fragment path (`pbrBlockReflection`) feeds the
 *    *true world-space* reflection/irradiance direction `R` into that same
 *    bake space as `b=(R.x,R.y,-R.z)` — only Z is negated
 *    (`REFLECTIONMAP_OPPOSITEZ`, confirmed live: true only because this
 *    scene's environment texture `isCube` and `scene.useRightHandedSystem`
 *    are both true and `invertZ` is false). `INVERTCUBICMAP` (an additional
 *    Y-flip) and a non-identity `reflectionMatrix` were both directly
 *    inspected on the live `scene.environmentTexture` and ruled out
 *    (`coordinatesMode` is the plain `CUBIC_MODE`, `reflectionMatrix` is
 *    identity) — so no Y-side shader correction applies here.
 * 4. Solving steps 1-3 for `R` as a function of azimuth/elevation gives
 *    `R = (-cos(el)*cos(az), sin(el), cos(el)*sin(az))`. Babylon's own
 *    `PanoramaToCubeMapTools.FACE_UP`/`FACE_DOWN` corner arrays are the
 *    likely source of the remaining Y-axis sign (they use `y=-1` for the
 *    face literally named `FACE_UP`), which the shader-level defines above
 *    don't correct for on their own.
 * 5. This `R` (direction *toward* the highlight) was cross-checked against
 *    two live measurements — `reflect(viewDirection, surfaceNormal)` at the
 *    brightest pixel on two different glossy metal spheres in the running
 *    candidate scene — and matched in sign on all three axes with the
 *    expected small residual (highlight blob has a 28° angular radius with
 *    gaussian falloff, plus roughness/PMREM blur, so the visible brightest
 *    pixel is never exactly the mathematical peak): predicted
 *    `(-0.6275, 0.5736, 0.5266)` vs. measured `(-0.6089, 0.6422, 0.4657)` and
 *    `(-0.5656, 0.6025, 0.5631)`.
 * 6. `DirectionalLight.direction` is the direction light *travels*
 *    (light-to-scene), the opposite of `R`.
 *
 * Both the HDR generator and this analytic light are already expressed
 * directly in Babylon's real right-handed world space — unlike placements/
 * camera (`toBabylonWorldMatrix`, `configureCamera`), neither goes through
 * the separate Vecmo-authored Y-down bridge, so no further axis flip is
 * needed here; the live cross-check above was performed in that same real
 * scene (`scene.useRightHandedSystem = true`), so it already accounts for it.
 */
const pbrKeyLightDirection = (
	azimuthDeg: number,
	elevationDeg: number,
): readonly [number, number, number] => {
	const azimuth = azimuthDeg * DEG_TO_RAD;
	const elevation = elevationDeg * DEG_TO_RAD;
	const cosElevation = Math.cos(elevation);
	const towardHighlight: readonly [number, number, number] = [
		-cosElevation * Math.cos(azimuth),
		Math.sin(elevation),
		cosElevation * Math.sin(azimuth),
	];
	return [-towardHighlight[0], -towardHighlight[1], -towardHighlight[2]];
};

/**
 * Upper bound on how long the P6-A candidate path waits for the studio HDR to
 * fetch and PMREM-prefilter before failing closed to the baseline rig. The
 * asset is small and same-origin; this is a hang guard, not an expected path.
 */
const ENVIRONMENT_READY_TIMEOUT_MS = 10_000;

/**
 * P6-B shadow generator tuning, active only inside the same `pbrEnabled`
 * candidate path (see this module's top-level doc and the P6-B plan). Shadows
 * are cast/received only by real GLB placement meshes — never an invented
 * ground plane — so bias needs to tolerate arbitrary caster scale/placement
 * rather than one authored scene's known proportions.
 */
const SHADOW_MAP_SIZE = 2048;
/** Depth-direction offset that prevents shadow acne on the casting surface. */
const SHADOW_BIAS = 0.001;
/** Additional offset along the surface normal; reduces acne on curved casters (e.g. spheres) that plain depth bias alone leaves banded. */
const SHADOW_NORMAL_BIAS = 0.02;
/**
 * PCSS penumbra size, expressed as a fraction of the shadow map's UV space
 * (`ShadowGenerator.contactHardeningLightSizeUVRatio`'s own unit). Only reached
 * in `"pcss"` filter mode.
 */
const PCSS_CONTACT_HARDENING_LIGHT_SIZE_UV_RATIO = 0.05;

/**
 * P6-C candidate optical depth of field, gated by the document's own
 * `apertureStrength` (no separate feature flag) inside the `pbrEnabled`
 * candidate path — matching the existing `runtime-3d-dof-unsupported`
 * emission condition this pass now fills in for GLB placements.
 *
 * Unlike shadows (P6-B) and PBR/IBL (P6-A), this is assembled from raw
 * `PostProcessRenderPipeline` + `DepthOfFieldEffect` pieces rather than
 * Babylon's `DefaultRenderingPipeline`: that pipeline's `imageProcessingEnabled`
 * setter unconditionally writes the scene's SHARED
 * `imageProcessingConfiguration.isEnabled` (`true` also adds its own
 * `ImageProcessingPostProcess` bound to that same shared config) — either
 * value conflicts with the P6-A candidate's own tone-mapping configuration on
 * that identical shared object. The raw assembly below only ever touches its
 * own pipeline/effect/depth-renderer objects.
 */
const DOF_PIPELINE_NAME = "vecmo-runtime-3d-dof";
/**
 * The literal name `DepthOfFieldEffect`'s own constructor hardcodes for its
 * internal `PostProcessRenderEffect` (`super(engine, "depth of field", ...)`
 * in `@babylonjs/core/PostProcesses/depthOfFieldEffect.js`) — needed to target
 * `PostProcessRenderPipelineManager.enableEffectInPipeline`/
 * `disableEffectInPipeline` without reaching into the effect's `@internal
 * _name` field.
 */
const DOF_EFFECT_NAME = "depth of field";
/**
 * P6-D Stage 2 fallback: name for the `FxaaPostProcess` wrapper effect added
 * to the SAME `DOF_PIPELINE_NAME` pipeline, always AFTER the DOF effect (see
 * `ensureDofPipeline`), so it runs last — the final pass before the canvas
 * backbuffer. Stage 1 (MSAA on the DOF chain's raw-rasterization input,
 * `RUNTIME_3D_INPUT_MSAA_SAMPLES`) left the merge-stage silhouette edge
 * unchanged: the circle-of-confusion value that drives
 * `depthOfFieldMerge.fragment`'s blend comes from a SEPARATE, non-MSAA
 * `DepthRenderer` depth map, so a silhouette's partially-covered edge texel
 * still samples a binary (all-background or all-foreground) depth value
 * regardless of how clean the color input is — MSAA on the color chain head
 * has nothing to smooth there. FXAA instead re-detects edges directly in the
 * FINAL composited image (luma contrast), so it is not sensitive to that
 * upstream depth-precision mismatch. Toggled in lockstep with
 * `DOF_EFFECT_NAME` (see `applyDepthOfField`/`dispose`) — it must never be
 * enabled without DOF also being enabled, and never at all in the baseline
 * or no-DOF candidate path.
 */
const FXAA_EFFECT_NAME = "vecmo-runtime-3d-dof-fxaa";
/**
 * Fixes Babylon's `fStop` at 1 so the effective aperture diameter
 * (`lensSize / fStop`) is controlled by `lensSize` alone — see
 * `dofLensSizeMm`'s doc comment for why `lensSize` itself is derived from
 * `focusDistance`, not a fixed mm constant.
 */
const DOF_REFERENCE_F_STOP = 1;
/**
 * Upper bound on the `focalLength` param as a fraction of `focusDistance`,
 * keeping Babylon's CoC denominator `(focusDistance - focalLength)`
 * comfortably positive (see `circleOfConfusion.fragment`'s
 * `cocPrecalculation`) even for an implausibly small sampled focus distance.
 */
const DOF_MAX_FOCAL_LENGTH_FOCUS_DISTANCE_FRACTION = 0.1;
/**
 * `lensSize` (Babylon's DOF aperture-diameter param, in scene-units/1000, i.e.
 * millimeters — see `DepthOfFieldEffect.lensSize`'s own doc comment) expressed
 * as a FRACTION of the frame's `focusDistance` param rather than a fixed mm
 * value. Babylon's own circle-of-confusion shader
 * (`node_modules/@babylonjs/core/Shaders/circleOfConfusion.fragment.js`)
 * computes `cocPrecalculation = (lensSize/fStop) * focalLength /
 * (focusDistance - focalLength)`, then multiplies by the RELATIVE depth ratio
 * `(focusDistance - pixelDistance) / pixelDistance`. With `focalLength <<
 * focusDistance`, `cocPrecalculation ≈ (lensSize/fStop) * focalLength /
 * focusDistance`. Keeping `lensSize` proportional to `focusDistance` (instead
 * of fixed) cancels that `1 / focusDistance` term, so the candidate produces
 * the same blur for the same *relative* depth separation regardless of a
 * document's absolute scene-unit scale — a hand-built QA probe's small units
 * and a real editor scene's pixel-scale units can differ from each other by
 * orders of magnitude in `focusDistance` alone, without differing at all in
 * relative depth ratios.
 *
 * Calibrated empirically against `qa/babylon-probe.ts`'s two placement rows
 * (`?babylonPbr=1&dofAperture=2&dofFocus=<front-row distance>`). A first pass
 * at `0.28` fully blurred even the FOCUSED row: a single probe sphere's own
 * rounded-surface depth extent (~radius, a relative depth ratio `δ` of only
 * ~0.06 against the ~5.68-unit focus distance) already pushed `coc` to ~0.95
 * (derivation: `coc ≈ apertureScale * FRACTION * focalLengthMm * δ` for small
 * `δ`, so `FRACTION` alone sets how much relative depth separation reads as
 * "out of focus"). `0.036` instead puts a single sphere's own depth extent at
 * `coc ≈ 0.1` (a few px of natural edge softening, not a visible blur) while
 * the front-to-back row separation (`δ ≈ (9.40-5.68)/5.68 ≈ 0.65`) still
 * reaches `coc ≈ 1` (clamped, full kernel) at `dofAperture=2` — see this
 * module's P6-C verification notes for the measured blur-radius numbers.
 */
const DOF_LENS_SIZE_FOCUS_DISTANCE_FRACTION = 0.036;
/**
 * Babylon's `focalLength`/`focusDistance`/`lensSize` DOF params are all in
 * "scene units/1000" (Babylon's own convention for treating 1 scene unit as
 * roughly 1mm-equivalent for lens math) — see `DepthOfFieldEffect`'s own doc
 * comments. This project's Babylon adapter otherwise never rescales Vecmo
 * scene units when feeding Babylon (`configureCamera`, `toBabylonWorldMatrix`
 * copy positions directly), so this constant is the one place that
 * convention is applied, converting an actual Babylon-space distance (in
 * this adapter's native scene units) into that param convention.
 */
const DOF_SCENE_UNITS_TO_MM = 1000;
/** Floor for the projected focus distance; see the clamp comment at use. */
const DOF_MIN_FOCUS_DISTANCE_MM = 1;
/**
 * `DepthOfFieldEffectBlurLevel.High`'s fixed blur kernel (51px, see
 * `ThinDepthOfFieldEffect`'s constructor) caps the maximum on-screen blur
 * radius at roughly half that, ~25px — chosen (over `Medium`/`Low`) to land in
 * the same range as the existing 2D vector-plane DOF approximation's own
 * `DEFAULT_DOF_MAX_BLUR_RADIUS` cap of 24px (`scene-camera.ts`), so neither
 * path reads as obviously "more blurred" than the other at comparable
 * apertures. Referenced directly as `modules.DepthOfFieldEffectBlurLevel.High`
 * at the one construction call site below; no separate constant needed.
 */

/**
 * P6-D Stage 1 root-cause fix: MSAA sample count applied to whichever
 * postprocess is the CURRENT head of this camera's `_postProcesses` chain —
 * the one and only place raw 3D geometry rasterizes once any postprocess is
 * attached (see the two call sites below for exactly which postprocess that
 * is in each pipeline). Attaching a bare `PostProcess`/pipeline makes the
 * engine render the scene into that postprocess's own offscreen render
 * target instead of straight to the canvas's own MSAA-enabled WebGL2
 * context, which is what previously gave every silhouette edge free
 * anti-aliasing; this restores it on that same offscreen target.
 *
 * Traced from source, not assumed: `PostProcessManager._prepareFrame`
 * (`postProcessManager.js`) calls `postProcesses[0].activate(camera,
 * sourceTexture)` — binding that postprocess's own render target as the
 * current framebuffer — BEFORE any scene mesh draws for the frame, and
 * `postProcesses[0]` there is `_getActivePostProcesses(camera._postProcesses)`'s
 * first non-null entry, i.e. whichever postprocess this adapter attached
 * EARLIEST among those currently enabled (`Camera.attachPostProcess`
 * pushes to the end of a stable-indexed array; `detachPostProcess` only
 * nulls a slot, never splices — see `camera.pure.js`).
 *
 * `PostProcess.samples`'s own doc: "Number of sample textures" — its setter
 * (`postProcess.pure.js`) clamps to `engine.getCaps().maxMSAASamples` and
 * updates any already-created backing texture in place, so this is safe to
 * set both before and after the first render.
 */
const RUNTIME_3D_INPUT_MSAA_SAMPLES = 4;

/**
 * P6-D Stage 3 candidate SSAO2 contact shading, gated by `pbrEnabled &&
 * frame.vectorPlanes.length === 0` (see `applyScreenSpaceAmbientOcclusion`) —
 * independent of DOF's `apertureStrength`. Screen-space AO reads the whole
 * framebuffer's depth/normal buffer and cannot exclude individual meshes the
 * way `ShadowGenerator.addShadowCaster` can, so admitting it whenever a vector
 * plane is present would risk the P6-A pixel-identity guarantee for that
 * plane's texture; requiring zero vector planes in the frame sidesteps that
 * risk entirely instead of trying to mask it out post hoc.
 */
const SSAO_PIPELINE_NAME = "vecmo-runtime-3d-ssao";
/**
 * `forceGeometryBuffer: true` in `SSAO2RenderingPipeline`'s constructor
 * (`ssao2RenderingPipeline.pure.js`) makes it use the legacy, standalone
 * `GeometryBufferRenderer` for its depth/normal input instead of the modern
 * default, `scene.enablePrePassRenderer()`. This is a deliberate choice, not
 * the library default: `prePassRenderer.js` writes
 * `scene.imageProcessingConfiguration.applyByPostProcess` and can attach its
 * OWN `ImageProcessingPostProcess` to that SAME shared config object when a
 * pass "needs composition" — exactly the kind of shared-config mutation the
 * P6-A/P6-C docs above already ruled out for `DefaultRenderingPipeline`.
 * `geometryBufferRenderer.pure.js` has no `imageProcessing` references at
 * all (grepped), so this path cannot trip that ADR regardless of scene
 * state.
 */
const SSAO_FORCE_GEOMETRY_BUFFER = true;
/** Babylon's own default output-strength/radius/base — see the constants below for what this candidate overrides and why. */
const SSAO_RATIO = 1.0;
/** World-space AO search radius. Start point per the P6-D plan; this adapter's world is the placement-normalizing unit cube (see `normalizeInstance`), so a radius on that same order reaches neighboring geometry without sampling the whole scene. */
const SSAO_RADIUS = 0.5;
const SSAO_TOTAL_STRENGTH = 1.0;
/**
 * 16 is not just "a reasonable sample count" — it is the exact threshold
 * `ThinSSAO2PostProcess._generateHemisphere()` (`thinSSAO2PostProcess.js`)
 * branches on: `numSamples < 16` draws two `Math.random()` values per sample,
 * `numSamples >= 16` instead walks a deterministic Hammersley/van-der-Corput
 * sequence. At 16 this candidate's AO KERNEL is fully deterministic with no
 * seeding trick needed; see `SSAO_NOISE_TEXTURE_SEED` for the ONE remaining
 * randomness source this doesn't cover.
 */
const SSAO_SAMPLES = 16;
const SSAO_EXPENSIVE_BLUR = true;
/**
 * Fixed seed for the ONE Babylon-internal randomness source `SSAO_SAMPLES`
 * doesn't already make deterministic: `ThinSSAO2PostProcess._createRandomTexture()`
 * (`thinSSAO2PostProcess.js`) unconditionally builds a 128x128 rotation-noise
 * texture from `RandomRange` -> `Math.random()`, once, in its constructor —
 * regardless of sample count, with no constructor param, settable field, or
 * seed hook of any kind (grepped the whole class). Two fresh page loads would
 * therefore bake in DIFFERENT noise and never hash-match, failing this
 * program's determinism gate. `ensureSsaoPipeline` substitutes a seeded PRNG
 * for `Math.random` for the exact synchronous extent of the
 * `SSAO2RenderingPipeline` constructor call (which is where that texture is
 * built) and restores the real `Math.random` immediately after, in a
 * `finally` block — verified empirically (two independent page loads produce
 * an identical whole-framebuffer hash with this in place; see this module's
 * P6-D verification notes). This is a deliberate, tightly-scoped exception to
 * "never touch globals": no public Babylon API exists to inject a fixed
 * noise texture or kernel seed for SSAO2 in this version.
 */
const SSAO_NOISE_TEXTURE_SEED = 0x53534132;
/**
 * MSAA sample count for whichever postprocess is SSAO's own chain head
 * (`SSAO2RenderingPipeline.textureSamples`, which — because of
 * `SSAO_FORCE_GEOMETRY_BUFFER` — maps to `_originalColorPostProcess.samples`,
 * NOT `prePassRenderer.samples`; see that setter in `ssao2RenderingPipeline.pure.js`).
 * Same root cause and same value as `RUNTIME_3D_INPUT_MSAA_SAMPLES`; kept as
 * a separate constant because it is set through a different public API
 * (`textureSamples`, not `.samples` on an internal effect array element).
 */
const SSAO_INPUT_MSAA_SAMPLES = 4;

/**
 * Mulberry32, a small well-known deterministic PRNG (public domain) — used
 * ONLY to stand in for `Math.random` for the exact duration of the
 * `SSAO2RenderingPipeline` construction call; see `SSAO_NOISE_TEXTURE_SEED`.
 * Same output sequence for a given seed on every call, unlike `Math.random`.
 */
const createSeededRandom = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const loadBabylonModules = async (): Promise<BabylonModules> => {
	const rayModule = import("@babylonjs/core/Culling/ray");
	const [
		cameraModule,
		colorModule,
		depthOfFieldEffectModule,
		depthRendererModule,
		depthRendererSceneComponentModule,
		directionalLightModule,
		engineModule,
		freeCameraModule,
		fxaaPostProcessModule,
		hdrCubeTextureModule,
		hemisphericLightModule,
		imageProcessingConfigurationModule,
		materialModule,
		sceneLoaderModule,
		mathModule,
		planeModule,
		planeBuilderModule,
		postProcessRenderEffectModule,
		postProcessRenderPipelineModule,
		sceneModule,
		shadowGeneratorModule,
		ssao2RenderingPipelineModule,
		standardMaterialModule,
		textureModule,
		transformNodeModule,
	] = await Promise.all([
		import("@babylonjs/core/Cameras/camera"),
		import("@babylonjs/core/Maths/math.color"),
		// P6-C candidate DOF: the raw effect + pipeline assembly, never
		// `DefaultRenderingPipeline` (its `imageProcessingEnabled` toggle writes
		// the scene's SHARED `imageProcessingConfiguration.isEnabled`/adds its
		// own `ImageProcessingPostProcess` either way — both outcomes conflict
		// with the P6-A candidate's own tone-mapping ADR; a bare
		// `PostProcessRenderPipeline` with only the DOF effect added never
		// touches that shared config).
		import("@babylonjs/core/PostProcesses/depthOfFieldEffect"),
		import("@babylonjs/core/Rendering/depthRenderer"),
		// `DepthRenderer` does not self-register `Scene.prototype.enableDepthRenderer`
		// the way `ShadowGenerator` self-registers its own scene component (see
		// the comment on the shadow-generator import below) — `DefaultRenderingPipeline`
		// calls `RegisterDepthRendererSceneComponent(DepthRenderer)` explicitly at
		// the top of its own constructor; this module does the same, once, lazily.
		import("@babylonjs/core/Rendering/depthRendererSceneComponent"),
		import("@babylonjs/core/Lights/directionalLight"),
		import("@babylonjs/core/Engines/engine"),
		import("@babylonjs/core/Cameras/freeCamera"),
		// P6-D Stage 2 fallback pass, appended (only) after the DOF pipeline's own
		// effect — see `FXAA_EFFECT_NAME`'s doc comment.
		import("@babylonjs/core/PostProcesses/fxaaPostProcess"),
		import("@babylonjs/core/Materials/Textures/hdrCubeTexture"),
		import("@babylonjs/core/Lights/hemisphericLight"),
		import("@babylonjs/core/Materials/imageProcessingConfiguration"),
		import("@babylonjs/core/Materials/material"),
		import("@babylonjs/core/Loading/sceneLoader"),
		import("@babylonjs/core/Maths/math.vector"),
		import("@babylonjs/core/Maths/math.plane"),
		import("@babylonjs/core/Meshes/Builders/planeBuilder"),
		// Wraps `FxaaPostProcess` (a plain `PostProcess`) so it can be
		// `pipeline.addEffect(...)`-ed into the SAME `DOF_PIPELINE_NAME` pipeline
		// as the DOF effect, ordered after it — see `FXAA_EFFECT_NAME`.
		import(
			"@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderEffect"
		),
		// (Non-`.pure`) `PostProcessRenderPipeline`'s own constructor calls
		// `RegisterPostProcessRenderPipelineManagerSceneComponent(...)`, so
		// `scene.postProcessRenderPipelineManager` needs no separate registration
		// call here — unlike the depth renderer above.
		import(
			"@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipeline"
		),
		import("@babylonjs/core/scene"),
		// `ShadowGenerator`'s own constructor calls
		// `RegisterShadowGeneratorSceneComponent(ShadowGenerator)` followed by
		// `ShadowGenerator._SceneComponentInitialization(this._scene)` (see
		// `node_modules/@babylonjs/core/Lights/Shadows/shadowGenerator.js`,
		// around the end of the constructor) — that registration call is what
		// attaches `ShadowGeneratorSceneComponent` to the scene's
		// `_gatherRenderTargetsStage`. No separate side-effect import of
		// `shadowGeneratorSceneComponent` is needed: this module import alone
		// is inert (registration only runs when a `ShadowGenerator` instance is
		// constructed, which only happens below when `pbrEnabled` is true).
		import("@babylonjs/core/Lights/Shadows/shadowGenerator"),
		// `SSAO2RenderingPipeline`'s own constructor registers both the
		// PrePass and (legacy) GeometryBufferRenderer scene components itself
		// (`RegisterPrePassRendererSceneComponent`/`RegisterGeometryBufferRendererSceneComponent`
		// at the top of `ssao2RenderingPipeline.pure.js`'s constructor) — no
		// separate registration import needed here, unlike the depth renderer
		// above.
		import(
			"@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline"
		),
		import("@babylonjs/core/Materials/standardMaterial"),
		import("@babylonjs/core/Materials/Textures/texture"),
		import("@babylonjs/core/Meshes/transformNode"),
		import("@babylonjs/loaders/glTF"),
	]);
	await rayModule;
	return {
		Camera: cameraModule.Camera,
		Color3: colorModule.Color3,
		Color4: colorModule.Color4,
		CreatePlane: planeBuilderModule.CreatePlane,
		DepthOfFieldEffect: depthOfFieldEffectModule.DepthOfFieldEffect,
		DepthOfFieldEffectBlurLevel:
			depthOfFieldEffectModule.DepthOfFieldEffectBlurLevel,
		DepthRenderer: depthRendererModule.DepthRenderer,
		DirectionalLight: directionalLightModule.DirectionalLight,
		Engine: engineModule.Engine,
		FreeCamera: freeCameraModule.FreeCamera,
		FxaaPostProcess: fxaaPostProcessModule.FxaaPostProcess,
		HDRCubeTexture: hdrCubeTextureModule.HDRCubeTexture,
		HemisphericLight: hemisphericLightModule.HemisphericLight,
		ImageProcessingConfiguration:
			imageProcessingConfigurationModule.ImageProcessingConfiguration,
		LoadAssetContainerAsync: sceneLoaderModule.LoadAssetContainerAsync,
		Material: materialModule.Material,
		Matrix: mathModule.Matrix,
		Plane: planeModule.Plane,
		PostProcessRenderEffect:
			postProcessRenderEffectModule.PostProcessRenderEffect,
		PostProcessRenderPipeline:
			postProcessRenderPipelineModule.PostProcessRenderPipeline,
		RegisterDepthRendererSceneComponent:
			depthRendererSceneComponentModule.RegisterDepthRendererSceneComponent,
		Scene: sceneModule.Scene,
		ShadowGenerator: shadowGeneratorModule.ShadowGenerator,
		SSAO2RenderingPipeline: ssao2RenderingPipelineModule.SSAO2RenderingPipeline,
		StandardMaterial: standardMaterialModule.StandardMaterial,
		Texture: textureModule.Texture,
		TransformNode: transformNodeModule.TransformNode,
		Vector3: mathModule.Vector3,
	};
};

type BabylonClipPlanes = readonly [Plane, Plane, Plane, Plane];

const toBabylonClipPlanes = (
	clip: Runtime3dArtboardClip,
	modules: BabylonModules,
): BabylonClipPlanes => {
	const points = clip.polygon.map((point) => ({
		x: point.x,
		y: -point.y,
	}));
	const planeForEdge = (
		start: (typeof points)[number],
		end: (typeof points)[number],
	): Plane => {
		const edgeX = end.x - start.x;
		const edgeY = end.y - start.y;
		const length = Math.hypot(edgeX, edgeY) || 1;
		const normalX = -edgeY / length;
		const normalY = edgeX / length;
		return new modules.Plane(
			normalX,
			normalY,
			0,
			-(normalX * start.x + normalY * start.y),
		);
	};
	return [
		planeForEdge(points[0], points[1]),
		planeForEdge(points[1], points[2]),
		planeForEdge(points[2], points[3]),
		planeForEdge(points[3], points[0]),
	];
};

const setSceneClipPlanes = (
	scene: Scene,
	planes: BabylonClipPlanes | null,
): void => {
	scene.clipPlane = planes?.[0] ?? null;
	scene.clipPlane2 = planes?.[1] ?? null;
	scene.clipPlane3 = planes?.[2] ?? null;
	scene.clipPlane4 = planes?.[3] ?? null;
};

const configureCamera = (
	camera: FreeCamera,
	plan: Runtime3dCamera,
	modules: BabylonModules,
): void => {
	// Vecmo is right-handed with Y-down and camera-behind-target negative Z.
	// Reflecting both Y and Z maps that convention into Babylon world space
	// without changing handedness.
	camera.position.copyFromFloats(
		plan.position.x,
		-plan.position.y,
		-plan.position.z,
	);
	camera.upVector.copyFromFloats(plan.up.x, -plan.up.y, -plan.up.z);
	camera.setTarget(
		new modules.Vector3(plan.target.x, -plan.target.y, -plan.target.z),
	);
	camera.minZ = plan.near;
	camera.maxZ = plan.far;
	if (plan.kind === "perspective") {
		camera.mode = modules.Camera.PERSPECTIVE_CAMERA;
		camera.fovMode = modules.Camera.FOVMODE_VERTICAL_FIXED;
		camera.fov = plan.verticalFovRadians;
		return;
	}
	camera.mode = modules.Camera.ORTHOGRAPHIC_CAMERA;
	camera.orthoLeft = -plan.halfWidth;
	camera.orthoRight = plan.halfWidth;
	camera.orthoTop = plan.halfHeight;
	camera.orthoBottom = -plan.halfHeight;
};

const toBabylonWorldMatrix = (worldMatrix: Runtime3dWorldMatrix): number[] =>
	worldMatrix.map((value, index) => {
		const row = index % 4;
		return row === 1 || row === 2 ? -value : value;
	});

const texturedVectorPlanes = (
	frame: Runtime3dFrame,
): readonly TexturedVectorPlane[] =>
	frame.vectorPlanes.filter(
		(plane): plane is TexturedVectorPlane => plane.texture !== null,
	);

const setPlacementOpacity = (
	instance: ModelPlacementInstance,
	opacity: number,
): void => {
	for (const node of instance.entries.rootNodes) {
		const candidate = node as {
			visibility?: number;
			getChildMeshes?: () => readonly { visibility: number }[];
		};
		if (typeof candidate.visibility === "number") {
			candidate.visibility = opacity;
		}
		for (const mesh of candidate.getChildMeshes?.() ?? []) {
			mesh.visibility = opacity;
		}
	}
};

const setPlacementTransform = (
	instance: PlacementInstance,
	placement: Runtime3dPlacement,
	modules: BabylonModules,
): void => {
	instance.root.setPreTransformMatrix(
		modules.Matrix.FromArray(toBabylonWorldMatrix(placement.worldMatrix)),
	);
	instance.root.setEnabled(placement.visible);
	if (instance.kind === "model") {
		setPlacementOpacity(instance, placement.opacity);
		return;
	}
	instance.material.alpha = placement.opacity;
	instance.mesh.isPickable = placement.pickable;
};

const setVectorPlaneTransform = (
	instance: VectorPlaneInstance,
	plane: TexturedVectorPlane,
	modules: BabylonModules,
): void => {
	instance.mesh.setPreTransformMatrix(
		modules.Matrix.FromArray(toBabylonWorldMatrix(plane.worldMatrix)),
	);
	instance.mesh.setEnabled(plane.visible);
	instance.mesh.isPickable = plane.pickable;
	instance.material.alpha = plane.opacity;
};

const createVectorPlane = (
	plane: TexturedVectorPlane,
	modules: BabylonModules,
	scene: Scene,
	pbrEnabled: boolean,
): VectorPlaneInstance => {
	const texture = new modules.Texture(plane.texture.uri, scene, {
		invertY: true,
		noMipmap: false,
		// NOT `useSRGBBuffer: true`. This scene's default
		// `ImageProcessingConfiguration` (no active tonemap/exposure/contrast)
		// compiles the material without the `IMAGEPROCESSING` shader define, so
		// nothing re-encodes a linearized sample back to sRGB before it reaches
		// the framebuffer. `useSRGBBuffer` would make the GPU decode sRGB→linear
		// on sample and then write that linear value out unconverted — a silent
		// re-grade of the browser-rasterized SVG bytes. Same reasoning as
		// `createFrameTexture`'s options (8400f90c).
	});
	texture.hasAlpha = true;
	texture.wrapU = modules.Texture.CLAMP_ADDRESSMODE;
	texture.wrapV = modules.Texture.CLAMP_ADDRESSMODE;
	const material = new modules.StandardMaterial(
		`vecmo-vector-plane-material:${plane.nodeId}`,
		scene,
	);
	material.backFaceCulling = false;
	material.diffuseColor = modules.Color3.White();
	material.specularColor = modules.Color3.Black();
	material.diffuseTexture = texture;
	material.disableLighting = true;
	// `disableLighting` skips the light loop entirely, so `diffuseBase` stays
	// zero and `diffuseColor` never reaches the fragment's colour term.
	// StandardMaterial only shows a colour under `disableLighting` through
	// `emissiveColor` (default black) added into `finalDiffuse` before it
	// multiplies the diffuse texture's own RGB — so this must be white for the
	// texture's pixels to pass through unlit and unattenuated. Same defect and
	// fix as `createFrameSequencePlacement` (8400f90c).
	material.emissiveColor = modules.Color3.White();
	material.useAlphaFromDiffuseTexture = true;
	material.alphaCutOff = 1 / 255;
	material.transparencyMode = modules.Material.MATERIAL_ALPHATESTANDBLEND;
	// Alpha-tested depth prepass preserves transparent SVG holes while allowing
	// opaque vector pixels to occlude and be occluded by GLB mesh depth.
	material.needDepthPrePass = true;
	if (pbrEnabled) {
		// Admitted vector pixels must stay pixel-identical between baseline and
		// the P6-A candidate path. Assigning `null` here would be a no-op (the
		// material mixin re-picks the scene's own configuration in that case —
		// see `imageProcessing.js` `_attachImageProcessingConfiguration`), so
		// this material instead gets its own, untouched-default configuration,
		// isolating it from the scene's candidate-path tone mapping/exposure.
		material.imageProcessingConfiguration =
			new modules.ImageProcessingConfiguration();
	}
	const mesh = modules.CreatePlane(
		`vecmo-vector-plane:${plane.nodeId}`,
		{ size: 1 },
		scene,
	);
	mesh.material = material;
	mesh.metadata = {
		[RUNTIME_NODE_ID_METADATA_KEY]: plane.nodeId,
	};
	const instance = {
		material,
		mesh,
		texture,
		textureKey: plane.texture.cacheKey,
	};
	setVectorPlaneTransform(instance, plane, modules);
	return instance;
};

/**
 * Decodes ONE rendered frame to a GPU-uploadable bitmap.
 *
 * `premultiplyAlpha: "none"` and `colorSpaceConversion: "none"` are both load
 * bearing. The package declares its own colour primaries, EOTF, view transform,
 * and alpha mode as S0c 法定値; letting the browser premultiply or convert here
 * would re-grade pixels Blender already finished, and the damage shows up only
 * on soft alpha edges — exactly where a motion-blurred render lives.
 */
const decodeFrameBitmap = async (
	source: Runtime3dFrameSequenceSource,
): Promise<ImageBitmap> => {
	const response = await fetch(source.uri);
	if (!response.ok) {
		throw new Error(
			`Rendered frame ${source.frameIndex} could not be read (HTTP ${response.status}).`,
		);
	}
	return createImageBitmap(await response.blob(), {
		premultiplyAlpha: "none",
		colorSpaceConversion: "none",
	});
};

/**
 * Uploads one decoded frame and resolves only once the GPU texture is ready.
 *
 * This program has already paid for the lesson that a resolved promise is not a
 * completed draw. Babylon's ImageBitmap path uploads inside the constructor and
 * calls `onLoad` synchronously, so `ready`'s resolver is captured BEFORE the
 * constructor runs — awaiting a promise whose resolver the constructor may
 * already have called is what makes the readiness gate real rather than
 * incidental. The bitmap is closed in every outcome; it is a decoded surface,
 * not a garbage-collected buffer.
 */
const createFrameTexture = async (
	source: Runtime3dFrameSequenceSource,
	modules: BabylonModules,
	scene: Scene,
): Promise<Texture> => {
	const bitmap = await decodeFrameBitmap(source);
	try {
		let markReady: () => void = () => undefined;
		let markFailed: (reason: unknown) => void = () => undefined;
		const ready = new Promise<void>((resolve, reject) => {
			markReady = resolve;
			markFailed = reject;
		});
		const texture = new modules.Texture(source.uri, scene, {
			buffer: bitmap,
			mimeType: source.mimeType,
			invertY: true,
			// A frame package is addressed 1:1 at its authored size; mip levels
			// would only ever be sampled if the band were minified, and building
			// them per frame costs more than it can return.
			noMipmap: true,
			samplingMode: modules.Texture.BILINEAR_SAMPLINGMODE,
			// NOT `useSRGBBuffer: true`. This scene's default
			// `ImageProcessingConfiguration` (no active tonemap/exposure/contrast)
			// compiles the material without the `IMAGEPROCESSING` shader define, so
			// nothing re-encodes a linearized sample back to sRGB before it reaches
			// the framebuffer. `useSRGBBuffer` would make the GPU decode sRGB→linear
			// on sample and then write that linear value out unconverted — a
			// silent re-grade of pixels Blender already finished (the same class of
			// re-grade `decodeFrameBitmap`'s `colorSpaceConversion: "none"` exists
			// to prevent one step earlier). Measured: with it on, decoded red at
			// frame 59 read back as 12 instead of the encoded 60.
			onLoad: () => markReady(),
			onError: (message) => {
				markFailed(
					new Error(
						`Rendered frame ${source.frameIndex} failed to upload (${message ?? "unknown error"}).`,
					),
				);
			},
		});
		try {
			await ready;
		} catch (error) {
			texture.dispose();
			throw error;
		}
		texture.hasAlpha = true;
		texture.wrapU = modules.Texture.CLAMP_ADDRESSMODE;
		texture.wrapV = modules.Texture.CLAMP_ADDRESSMODE;
		return texture;
	} finally {
		bitmap.close();
	}
};

/**
 * Local quad size for a frame package, normalized so its LONGEST side is 1.
 *
 * That is the same convention `normalizeInstance` imposes on a GLB (max
 * hierarchy extent scaled to 1), which is what lets a rendered placement and a
 * GLB placement consume an identical `worldMatrix` and land in the same place.
 * The frame's own aspect ratio must come from the manifest — a square quad would
 * stretch every non-square package, and it would do it identically on every
 * frame, so nothing about the motion would look wrong.
 */
const frameSequencePlaneSize = (
	source: Runtime3dFrameSequenceSource,
): { readonly width: number; readonly height: number } => {
	const width = source.width > 0 ? source.width : 1;
	const height = source.height > 0 ? source.height : 1;
	const extent = Math.max(width, height);
	return { width: width / extent, height: height / extent };
};

const runtimeNodeIdForPickedMesh = (mesh: unknown): string | null => {
	let current: unknown = mesh;
	while (current && typeof current === "object") {
		const metadata = Reflect.get(current, "metadata");
		if (metadata && typeof metadata === "object") {
			const nodeId = Reflect.get(metadata, RUNTIME_NODE_ID_METADATA_KEY);
			if (typeof nodeId === "string") return nodeId;
		}
		current = Reflect.get(current, "parent");
	}
	return null;
};

const pointInPolygon = (
	x: number,
	y: number,
	polygon: Runtime3dArtboardClip["polygon"],
): boolean => {
	let inside = false;
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; ) {
		const currentPoint = polygon[index];
		const previousPoint = polygon[previous];
		if (!currentPoint || !previousPoint) return false;
		const crosses =
			currentPoint.y > y !== previousPoint.y > y &&
			x <
				((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) /
					(previousPoint.y - currentPoint.y) +
					currentPoint.x;
		if (crosses) inside = !inside;
		previous = index;
		index += 1;
	}
	return inside;
};

const normalizeInstance = (
	instance: ModelPlacementInstance,
	modules: BabylonModules,
	scene: Scene,
): void => {
	const scaleRoot = new modules.TransformNode(
		`${instance.root.name}:normalized-scale`,
		scene,
	);
	const centerRoot = new modules.TransformNode(
		`${instance.root.name}:normalized-center`,
		scene,
	);
	scaleRoot.parent = instance.root;
	centerRoot.parent = scaleRoot;
	for (const node of instance.entries.rootNodes) node.parent = centerRoot;
	instance.root.computeWorldMatrix(true);
	const bounds = centerRoot.getHierarchyBoundingVectors(true);
	const size = bounds.max.subtract(bounds.min);
	const measuredExtent = Math.max(size.x, size.y, size.z);
	const extent =
		Number.isFinite(measuredExtent) && measuredExtent > 1e-6
			? measuredExtent
			: 1;
	const center = bounds.min.add(bounds.max).scale(0.5);
	scaleRoot.scaling.copyFromFloats(1 / extent, 1 / extent, 1 / extent);
	if (
		Number.isFinite(center.x) &&
		Number.isFinite(center.y) &&
		Number.isFinite(center.z)
	) {
		centerRoot.position.copyFrom(center.scale(-1));
	}
	for (const animation of instance.entries.animationGroups) {
		animation.stop();
		animation.reset();
	}
};

/**
 * Seconds-to-key-frame scale the glTF loader bakes into every imported
 * animation. `GLTFFileLoader.targetFps` defaults to 60 and each sampler key is
 * written as `frame = gltfTimeSeconds * targetFps`, so an imported group's
 * frame space is "sixtieths of a second", never the source `.blend`'s frames.
 * Measured, not assumed: the S2-B spike GLB's sole sampler carries glTF input
 * times `[0.0416667, 1.0, 2.0]` for Blender frames 1/24/48 at 24 fps, and the
 * loader turns them into Babylon key frames `[2.5, 60, 120]`.
 *
 * This constant is the ONLY renderer-specific piece of the frame contract, and
 * it deliberately lives here rather than in `Runtime3dPlacementAnimation`.
 */
const GLTF_IMPORT_TARGET_FPS = 60;

/**
 * Blender-frame -> imported-glTF-group-frame.
 *
 * The Blender glTF exporter writes ABSOLUTE source time, `seconds =
 * blenderFrame / fps`, not time elapsed since `frame_start`. Verified on the
 * spike source (`frame_start = 1`, 24 fps): the exported sampler input begins
 * at 0.0416667 s = 1/24, not at 0. Subtracting `blenderFrameStart` — the
 * obvious guess — would therefore shift every pose by one frame-start's worth
 * of time, so the conversion below must not do it.
 */
const gltfGroupFrameForBlenderFrame = (
	blenderFrame: number,
	fps: number,
): number | null => {
	if (!Number.isFinite(blenderFrame) || !Number.isFinite(fps) || fps <= 0) {
		return null;
	}
	return (blenderFrame / fps) * GLTF_IMPORT_TARGET_FPS;
};

/**
 * Poses one placement's imported animation at the frame the Vecmo document
 * asked for, without ever giving Babylon the clock.
 *
 * Babylon 9.19's `AnimationGroup.goToFrame` early-returns on `!_isStarted`, so
 * a group left in the imported/stopped state silently ignores every seek — the
 * exact failure S2-B's opening probe was written to catch. The deterministic
 * shape that does work is start-then-pause-then-seek:
 *
 * - `start(false, 1)` registers one `Animatable` per targeted animation in
 *   `scene._activeAnimatables`. It does NOT hand over a clock: `Scene._animate`
 *   is gated on `scene.animationsEnabled`, which this surface pins to `false`
 *   for its whole lifetime, so nothing advances those animatables per render.
 * - `pause()` is belt-and-braces on top of that, because a paused `Animatable`
 *   returns from `_animate` before touching a value even if the scene-level
 *   gate is ever flipped by a future caller.
 * - `goToFrame` then reaches `RuntimeAnimation.goToFrame`, which clamps to the
 *   key range, interpolates, and writes the value directly. It is a pure
 *   function of the requested frame, which is what makes a repeated seek to the
 *   same frame — and a play/pause/scrub round trip — land on an identical pose.
 *
 * The group is started at most once per instance: on later frames `isStarted`
 * is already true, so only the seek runs.
 */
const seekPlacementAnimation = (
	instance: ModelPlacementInstance,
	animation: NonNullable<Runtime3dPlacement["animation"]>,
): void => {
	const groupFrame = gltfGroupFrameForBlenderFrame(
		animation.frame,
		animation.fps,
	);
	if (groupFrame === null) return;
	for (const group of instance.entries.animationGroups) {
		if (group.targetedAnimations.length === 0) continue;
		if (!group.isStarted) {
			group.start(false, 1);
			group.pause();
		}
		group.goToFrame(groupFrame);
	}
};

/**
 * Creates one Engine/Scene/Canvas adapter. The adapter reads immutable Vecmo
 * frame plans, owns all Babylon resources, and never advances a clock.
 */
export async function createBabylonRuntimeSurface(
	canvas: HTMLCanvasElement,
	onError: (error: unknown) => void,
	options: BabylonRuntimeSurfaceOptions = {},
): Promise<BabylonRuntimeSurface> {
	const modules = await loadBabylonModules();
	// Read once per surface. Editor and export both call this same factory, so
	// gating here (rather than at the two call sites) keeps them structurally
	// identical — see `docs/gpu-canvas-convergence-e1-plan.md`'s flag precedent.
	const pbrEnabled = isBabylonPbrEnabled();
	const engine: Engine = new modules.Engine(
		canvas,
		true,
		{
			alpha: true,
			premultipliedAlpha: true,
			preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
			stencil: true,
		},
		false,
	);
	const scene: Scene = new modules.Scene(engine);
	scene.useRightHandedSystem = true;
	scene.animationsEnabled = false;
	scene.autoClear = true;
	scene.clearColor = new modules.Color4(0, 0, 0, 0);
	const camera = new modules.FreeCamera(
		"vecmo-runtime-3d-camera",
		modules.Vector3.Zero(),
		scene,
	);
	scene.activeCamera = camera;
	const ambient = new modules.HemisphericLight(
		"vecmo-runtime-3d-ambient",
		new modules.Vector3(0, -1, 0),
		scene,
	);
	ambient.intensity = BASELINE_AMBIENT_INTENSITY;
	const key = new modules.DirectionalLight(
		"vecmo-runtime-3d-key",
		new modules.Vector3(-0.45, 0.65, 1),
		scene,
	);
	key.intensity = BASELINE_KEY_INTENSITY;
	engine.onContextLostObservable.add(() => {
		onError(new Error("Babylon WebGL context lost."));
	});

	const sourceLoads = new Map<string, Promise<LoadedSource>>();
	const loadedSources = new Map<string, LoadedSource>();
	const instances = new Map<string, PlacementInstance>();
	const vectorPlaneInstances = new Map<string, VectorPlaneInstance>();
	let disposed = false;
	let queue = Promise.resolve();
	let renderedFrame: Runtime3dFrame | null = null;

	/**
	 * Resolves once the P6-A candidate environment has either finished PMREM
	 * prefiltering or definitively failed/timed out and been rolled back to
	 * the baseline analytic rig. `applyFrame` awaits this before every render
	 * so a 10 -> 0 -> 10 seek always sees the same, already-settled state —
	 * never a partially-prefiltered environment. Stays the resolved no-op
	 * promise when the flag is off. On failure/timeout this also reports
	 * exactly one `runtime-3d-environment-unavailable` issue through
	 * `options.onIssue`, if provided (see `BabylonRuntimeSurfaceOptions`).
	 */
	let environmentReadyPromise: Promise<void> = Promise.resolve();

	/**
	 * P6-B shadow generator, created only inside the `pbrEnabled` candidate
	 * path and only on the existing directional key light — never a second,
	 * invented light. `null` in the baseline path, so no shadow code path
	 * (caster/receiver registration, dispose) ever runs there.
	 */
	let shadowGenerator: InstanceType<BabylonModules["ShadowGenerator"]> | null =
		null;

	/**
	 * P6-D Stage 3 SSAO2 pipeline state, created lazily on the first frame that
	 * activates it (`pbrEnabled && frame.vectorPlanes.length === 0`) — same
	 * "pay only if used" discipline as `dof` below. `null` until then and
	 * whenever creation fails (`ensureSsaoPipeline` reports
	 * `runtime-3d-ssao-degraded` and leaves this `null` on failure).
	 */
	let ssao: {
		readonly pipeline: InstanceType<BabylonModules["SSAO2RenderingPipeline"]>;
	} | null = null;
	/** Tracks whether `ssao`'s five effects are currently attached to `camera`, mirroring `dofAttached`. */
	let ssaoAttached = false;

	/**
	 * The five named effects `SSAO2RenderingPipeline` registers on itself (see
	 * its own constructor) — read from the instance rather than hardcoded,
	 * since they are declared as ordinary instance properties, not constants.
	 */
	const ssaoEffectNames = (
		pipeline: InstanceType<BabylonModules["SSAO2RenderingPipeline"]>,
	): readonly string[] => [
		pipeline.SSAOOriginalSceneColorEffect,
		pipeline.SSAORenderEffect,
		pipeline.SSAOBlurHRenderEffect,
		pipeline.SSAOBlurVRenderEffect,
		pipeline.SSAOCombineRenderEffect,
	];

	/**
	 * Creates the P6-D Stage 3 SSAO2 pipeline on first use. Returns the
	 * existing instance on later calls, and `null` (after reporting
	 * `runtime-3d-ssao-degraded` once) if creation throws or the engine
	 * reports no support — `applyFrame` then renders that frame, and every
	 * later frame, without SSAO rather than leaving the surface broken.
	 */
	const ensureSsaoPipeline = (): typeof ssao => {
		if (ssao) return ssao;
		try {
			if (!modules.SSAO2RenderingPipeline.IsSupported) {
				throw new Error(
					"SSAO2RenderingPipeline.IsSupported is false for this engine (WebGL2/WebGPU required).",
				);
			}
			// See `SSAO_NOISE_TEXTURE_SEED`'s doc comment: this is the ONLY place
			// in this adapter that touches the global `Math.random`, and only for
			// the synchronous extent of this one constructor call.
			const originalRandom = Math.random;
			Math.random = createSeededRandom(SSAO_NOISE_TEXTURE_SEED);
			let pipeline: InstanceType<BabylonModules["SSAO2RenderingPipeline"]>;
			try {
				pipeline = new modules.SSAO2RenderingPipeline(
					SSAO_PIPELINE_NAME,
					scene,
					SSAO_RATIO,
					undefined,
					SSAO_FORCE_GEOMETRY_BUFFER,
				);
				pipeline.radius = SSAO_RADIUS;
				pipeline.totalStrength = SSAO_TOTAL_STRENGTH;
				pipeline.samples = SSAO_SAMPLES;
				pipeline.expensiveBlur = SSAO_EXPENSIVE_BLUR;
				pipeline.textureSamples = SSAO_INPUT_MSAA_SAMPLES;
			} finally {
				Math.random = originalRandom;
			}
			scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
				SSAO_PIPELINE_NAME,
				camera,
			);
			// Start detached, same discipline as `ensureDofPipeline` below.
			for (const effectName of ssaoEffectNames(pipeline)) {
				scene.postProcessRenderPipelineManager.disableEffectInPipeline(
					SSAO_PIPELINE_NAME,
					effectName,
					camera,
				);
			}
			// Composition order requirement: SSAO -> DOF (see `FXAA_EFFECT_NAME`'s
			// sibling doc comments and this module's P6-D plan). `camera._postProcesses`
			// order is fixed at first-attach time per postprocess and never changes
			// on later enable/disable (`Camera.attachPostProcess` pushes to the end
			// of a stable-indexed array; `detachPostProcess` only nulls a slot —
			// see `camera.pure.js`, already traced for `RUNTIME_3D_INPUT_MSAA_SAMPLES`).
			// `applyFrame` calls this ensure function before `applyDepthOfField`
			// every frame, so the ordinary case (SSAO's first activation on or
			// before DOF's) never reaches this branch. It exists only for the
			// asymmetric case: a document whose FIRST frame needs DOF but not SSAO,
			// and only on a LATER frame needs SSAO too — DOF would otherwise have
			// already claimed the lower indices. Detaching and reattaching DOF here
			// re-pushes its same effect objects to the (now later) end of the
			// array, after SSAO's just-reserved indices, then restores whatever
			// enable state DOF had before this reorder.
			if (dof) {
				const wasDofAttached = dofAttached;
				scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
					DOF_PIPELINE_NAME,
					camera,
				);
				scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
					DOF_PIPELINE_NAME,
					camera,
				);
				if (!wasDofAttached) {
					scene.postProcessRenderPipelineManager.disableEffectInPipeline(
						DOF_PIPELINE_NAME,
						DOF_EFFECT_NAME,
						camera,
					);
					scene.postProcessRenderPipelineManager.disableEffectInPipeline(
						DOF_PIPELINE_NAME,
						FXAA_EFFECT_NAME,
						camera,
					);
				}
			}
			ssaoAttached = false;
			ssao = { pipeline };
			return ssao;
		} catch (error) {
			options.onIssue?.({
				code: "runtime-3d-ssao-degraded",
				severity: "warning",
				message: `The Babylon SSAO2 candidate pipeline failed to initialize (${error instanceof Error ? error.message : String(error)}); GLB-only frames render without contact ambient occlusion.`,
			});
			return null;
		}
	};

	/**
	 * Updates the P6-D Stage 3 SSAO2 pipeline's attach state from the current
	 * frame's activation condition (`pbrEnabled && frame.vectorPlanes.length
	 * === 0`, independent of DOF's `apertureStrength`) — see `SSAO_PIPELINE_NAME`'s
	 * doc comment for why vector planes gate this out entirely rather than
	 * being excluded some other way. Called BEFORE `applyDepthOfField` in
	 * `applyFrame` so SSAO's pipeline reserves the lower `camera._postProcesses`
	 * indices whenever both activate for the first time on the same frame;
	 * see `ensureSsaoPipeline`'s own doc comment for the asymmetric case this
	 * doesn't cover on its own.
	 */
	const applyScreenSpaceAmbientOcclusion = (frame: Runtime3dFrame): void => {
		const active = pbrEnabled && frame.vectorPlanes.length === 0;
		if (!active) {
			if (ssao && ssaoAttached) {
				for (const effectName of ssaoEffectNames(ssao.pipeline)) {
					scene.postProcessRenderPipelineManager.disableEffectInPipeline(
						SSAO_PIPELINE_NAME,
						effectName,
						camera,
					);
				}
				ssaoAttached = false;
			}
			return;
		}
		const activeSsao = ensureSsaoPipeline();
		if (!activeSsao) return;
		if (!ssaoAttached) {
			for (const effectName of ssaoEffectNames(activeSsao.pipeline)) {
				scene.postProcessRenderPipelineManager.enableEffectInPipeline(
					SSAO_PIPELINE_NAME,
					effectName,
					camera,
				);
			}
			ssaoAttached = true;
		}
	};

	/**
	 * P6-C candidate optical DOF pipeline state, created lazily on the first
	 * frame that activates it (`pbrEnabled && sourceCamera.apertureStrength >
	 * 0`) — never at surface creation, so a flag-on document that never uses
	 * scene-camera DOF pays no depth-renderer/postprocess cost and renders
	 * pixel-identical to a build that never shipped this pass. `null` until
	 * then and whenever creation fails (`ensureDofPipeline` reports
	 * `runtime-3d-dof-degraded` and leaves this `null` on failure, which
	 * `applyFrame` treats identically to "never activated").
	 */
	let dof: {
		readonly pipeline: InstanceType<
			BabylonModules["PostProcessRenderPipeline"]
		>;
		readonly effect: InstanceType<BabylonModules["DepthOfFieldEffect"]>;
		readonly depthRenderer: InstanceType<BabylonModules["DepthRenderer"]>;
		readonly fxaa: InstanceType<BabylonModules["FxaaPostProcess"]>;
	} | null = null;
	/** Tracks whether `dof`'s effect is currently attached to `camera`, so `applyFrame` only calls `enable`/`disableEffectInPipeline` on an actual state transition. */
	let dofAttached = false;

	/**
	 * Creates the P6-C DOF pipeline on first use. Returns the existing instance
	 * on later calls, and `null` (after reporting `runtime-3d-dof-degraded`
	 * once) if creation throws — `applyFrame` then renders that frame, and
	 * every later frame, without DOF rather than leaving the surface broken.
	 */
	const ensureDofPipeline = (): typeof dof => {
		if (dof) return dof;
		try {
			modules.RegisterDepthRendererSceneComponent(modules.DepthRenderer);
			const depthRenderer = scene.enableDepthRenderer(camera);
			// Admits the probe's transparent GLB sphere and (in real documents)
			// alpha-tested/alpha-blended vector-plane texture planes into the
			// depth map. Left at Babylon's own default (`false`) here would
			// exclude every transparent/alpha-tested mesh from the depth buffer,
			// making an out-of-focus transparent subject read as "background"
			// (whatever is behind it) instead of blurring itself.
			depthRenderer.alphaBlendedDepth = true;
			const effect = new modules.DepthOfFieldEffect(
				scene,
				depthRenderer.getDepthMap(),
				modules.DepthOfFieldEffectBlurLevel.High,
			);
			effect.fStop = DOF_REFERENCE_F_STOP;
			// P6-D Stage 1: `effect._effects[0]` is the `CircleOfConfusionPostProcess`
			// (see `DepthOfFieldEffect`'s own constructor: `this._effects =
			// [this._circleOfConfusion, ...]`) — a plain, non-TS-private field
			// (only `@internal`-tagged) despite the truly-private
			// `_circleOfConfusion` it aliases. It is the first postprocess this
			// pipeline ever attaches to `camera`, so it is the one whose render
			// target receives the raw scene rasterization; see
			// `RUNTIME_3D_INPUT_MSAA_SAMPLES`'s doc comment for the full trace.
			effect._effects[0].samples = RUNTIME_3D_INPUT_MSAA_SAMPLES;
			// P6-D Stage 2 fallback (see `FXAA_EFFECT_NAME`'s doc comment): a plain
			// `PostProcess`, constructed with `camera: null` like `circleOfConfusion`
			// above — attachment is driven entirely by the pipeline/effect-name
			// machinery below, never by the constructor's own `camera` param.
			const fxaa = new modules.FxaaPostProcess(
				FXAA_EFFECT_NAME,
				1.0,
				null,
				undefined,
				engine,
			);
			const pipeline = new modules.PostProcessRenderPipeline(
				engine,
				DOF_PIPELINE_NAME,
			);
			pipeline.addEffect(effect);
			// Added AFTER the DOF effect so it is the LAST pass in this pipeline —
			// `PostProcessRenderEffect._attachCameras` (see this file's own P6-D
			// doc comments) attaches effects in `addEffect` call order, and that
			// order is what fixes each effect's permanent position in
			// `camera._postProcesses`.
			pipeline.addEffect(
				new modules.PostProcessRenderEffect(
					engine,
					FXAA_EFFECT_NAME,
					() => fxaa,
					true,
				),
			);
			scene.postProcessRenderPipelineManager.addPipeline(pipeline);
			scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
				DOF_PIPELINE_NAME,
				camera,
			);
			// `attachCamerasToRenderPipeline` enables every effect already added
			// to the pipeline for that camera; start detached so a frame that
			// merely creates the pipeline lazily (see `applyFrame`) without
			// wanting DOF this frame does not leave it attached. FXAA is toggled
			// in lockstep with the DOF effect (see `applyDepthOfField`), so it is
			// disabled here too.
			scene.postProcessRenderPipelineManager.disableEffectInPipeline(
				DOF_PIPELINE_NAME,
				DOF_EFFECT_NAME,
				camera,
			);
			scene.postProcessRenderPipelineManager.disableEffectInPipeline(
				DOF_PIPELINE_NAME,
				FXAA_EFFECT_NAME,
				camera,
			);
			dofAttached = false;
			dof = { pipeline, effect, depthRenderer, fxaa };
			return dof;
		} catch (error) {
			options.onIssue?.({
				code: "runtime-3d-dof-degraded",
				severity: "warning",
				message: `The Babylon depth-of-field candidate pipeline failed to initialize (${error instanceof Error ? error.message : String(error)}); GLB placements render without optical depth of field.`,
			});
			return null;
		}
	};

	/**
	 * Derives the Babylon-space distance from the ACTUAL rendering camera
	 * (`camera`, configured from `frame.camera` just before this is called —
	 * always the fixed orthographic presentation camera in the real editor
	 * path, but a direct perspective camera in `qa/babylon-probe.ts`) to the
	 * scene-camera rig's authored/sampled focus plane.
	 *
	 * This is NOT the same axis as `sourceCamera.focusDistance` itself:
	 * `focusDistance` is measured from the Vecmo scene-camera rig's OWN body
	 * position (`entities/scene/model/scene-camera.ts`'s `nodeCameraDepthById`
	 * — `dot(point - rig.body.position, forward)`), a different point in space
	 * from Babylon's actual rendering camera (the fixed-distance orthographic
	 * presentation camera bears no fixed relationship to any authored rig's
	 * body position — the offset between them is viewport-dependent). This
	 * derivation instead: (1) finds the focus plane's point in Vecmo's raw,
	 * camera-independent coordinate space (the same space `depthPlane.z`
	 * placements live in) by walking `focusDistance` along the rig's own
	 * forward axis from its body position; (2) maps that point through the
	 * SAME Y/Z bridge `configureCamera`/`toBabylonWorldMatrix` already apply
	 * to every camera and placement; (3) projects the result onto the actual
	 * Babylon camera's real forward axis. The result is exact for any
	 * `frame.camera` kind (orthographic or perspective) and needs no knowledge
	 * of the presentation camera's own distance formula.
	 */
	const babylonFocusDistance = (
		sourceCamera: NonNullable<Runtime3dFrame["sourceCamera"]>,
		focusDistanceSceneUnits: number,
	): number => {
		const { position, target } = sourceCamera;
		const rawForward = {
			x: target.x - position.x,
			y: target.y - position.y,
			z: target.z - position.z,
		};
		const rawForwardLength = Math.hypot(
			rawForward.x,
			rawForward.y,
			rawForward.z,
		);
		const normalizedRawForward =
			rawForwardLength > 1e-6
				? {
						x: rawForward.x / rawForwardLength,
						y: rawForward.y / rawForwardLength,
						z: rawForward.z / rawForwardLength,
					}
				: { x: 0, y: 0, z: 1 };
		const focusPointRaw = {
			x: position.x + normalizedRawForward.x * focusDistanceSceneUnits,
			y: position.y + normalizedRawForward.y * focusDistanceSceneUnits,
			z: position.z + normalizedRawForward.z * focusDistanceSceneUnits,
		};
		const focusPointBabylon = new modules.Vector3(
			focusPointRaw.x,
			-focusPointRaw.y,
			-focusPointRaw.z,
		);
		const cameraForwardBabylon = camera
			.getTarget()
			.subtract(camera.position)
			.normalize();
		return modules.Vector3.Dot(
			focusPointBabylon.subtract(camera.position),
			cameraForwardBabylon,
		);
	};

	/**
	 * Updates the P6-C DOF pipeline's parameters from the frame's sampled
	 * `sourceCamera` optics and attaches/detaches it from `camera`, or does
	 * nothing when the pipeline was never created (baseline path, or a
	 * document that never sets `apertureStrength > 0`). Called after
	 * `configureCamera` so `camera.position`/`getTarget()` already reflect this
	 * frame's `frame.camera`.
	 */
	const applyDepthOfField = (frame: Runtime3dFrame): void => {
		const sourceCamera = frame.sourceCamera;
		const apertureStrength = Math.max(0, sourceCamera?.apertureStrength ?? 0);
		const active =
			pbrEnabled && sourceCamera !== undefined && apertureStrength > 0;
		if (!active) {
			if (dof && dofAttached) {
				scene.postProcessRenderPipelineManager.disableEffectInPipeline(
					DOF_PIPELINE_NAME,
					DOF_EFFECT_NAME,
					camera,
				);
				// FXAA is toggled in lockstep with DOF (see `FXAA_EFFECT_NAME`'s doc
				// comment) — it must never remain enabled once DOF turns off.
				scene.postProcessRenderPipelineManager.disableEffectInPipeline(
					DOF_PIPELINE_NAME,
					FXAA_EFFECT_NAME,
					camera,
				);
				dofAttached = false;
			}
			return;
		}
		const activeDof = ensureDofPipeline();
		if (!activeDof) return;
		const focusDistanceSceneUnits = Math.max(
			1e-3,
			sourceCamera.focusDistance ?? 0,
		);
		// A pathological rig can place the focus plane behind the Babylon
		// camera (negative projected distance), which the CoC formula does not
		// handle; clamp to a small positive distance so DOF degrades to
		// "everything defocused" instead of undefined shader behavior.
		const focusDistanceMm = Math.max(
			DOF_MIN_FOCUS_DISTANCE_MM,
			babylonFocusDistance(sourceCamera, focusDistanceSceneUnits) *
				DOF_SCENE_UNITS_TO_MM,
		);
		const focalLengthMm = Math.min(
			sourceCamera.focalLengthMm ?? 50,
			Math.max(
				1,
				focusDistanceMm * DOF_MAX_FOCAL_LENGTH_FOCUS_DISTANCE_FRACTION,
			),
		);
		const apertureScale = Math.log1p(apertureStrength);
		activeDof.effect.focalLength = focalLengthMm;
		activeDof.effect.focusDistance = focusDistanceMm;
		activeDof.effect.lensSize =
			apertureScale * focusDistanceMm * DOF_LENS_SIZE_FOCUS_DISTANCE_FRACTION;
		if (!dofAttached) {
			scene.postProcessRenderPipelineManager.enableEffectInPipeline(
				DOF_PIPELINE_NAME,
				DOF_EFFECT_NAME,
				camera,
			);
			scene.postProcessRenderPipelineManager.enableEffectInPipeline(
				DOF_PIPELINE_NAME,
				FXAA_EFFECT_NAME,
				camera,
			);
			dofAttached = true;
		}
	};

	if (pbrEnabled) {
		const imageProcessing = scene.imageProcessingConfiguration;
		imageProcessing.toneMappingEnabled = true;
		imageProcessing.toneMappingType =
			modules.ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
		imageProcessing.exposure = PBR_EXPOSURE;
		imageProcessing.contrast = PBR_CONTRAST;
		imageProcessing.vignetteEnabled = false;
		imageProcessing.ditheringEnabled = false;
		ambient.intensity = PBR_AMBIENT_INTENSITY;
		key.intensity = PBR_KEY_INTENSITY;
		// Baseline keeps the original, HDR-independent `(-0.45, 0.65, 1)`
		// direction (set at construction, untouched here). The candidate path
		// re-points the same light to agree with the IBL environment's key
		// highlight — see `pbrKeyLightDirection`'s doc comment.
		const [pbrKeyDirectionX, pbrKeyDirectionY, pbrKeyDirectionZ] =
			pbrKeyLightDirection(
				STUDIO_ENVIRONMENT_KEY_AZIMUTH_DEG,
				STUDIO_ENVIRONMENT_KEY_ELEVATION_DEG,
			);
		key.direction = new modules.Vector3(
			pbrKeyDirectionX,
			pbrKeyDirectionY,
			pbrKeyDirectionZ,
		);
		shadowGenerator = new modules.ShadowGenerator(SHADOW_MAP_SIZE, key);
		shadowGenerator.bias = SHADOW_BIAS;
		shadowGenerator.normalBias = SHADOW_NORMAL_BIAS;
		// Alpha-BLEND meshes (the probe's transparent sphere; any translucent
		// GLB material in real documents) cast a softened, opacity-weighted
		// shadow instead of either a full-strength or no shadow at all.
		shadowGenerator.transparencyShadow = true;
		const shadowFilterMode = getBabylonShadowFilterMode();
		if (shadowFilterMode === "pcss") {
			shadowGenerator.useContactHardeningShadow = true;
			shadowGenerator.contactHardeningLightSizeUVRatio =
				PCSS_CONTACT_HARDENING_LIGHT_SIZE_UV_RATIO;
		} else {
			shadowGenerator.usePercentageCloserFiltering = true;
			shadowGenerator.filteringQuality = modules.ShadowGenerator.QUALITY_HIGH;
		}
		// Placements are positioned anywhere in world space via arbitrary
		// `setPreTransformMatrix` matrices (see `setPlacementTransform`), so a
		// fixed shadow frustum sized for one document would clip or waste
		// resolution on another. `autoUpdateExtends` (Babylon's own default)
		// refits the light's ortho X/Y bounds from the shadow map's live
		// render list every time the shadow projection matrix is recomputed;
		// `autoCalcShadowZBounds` extends that same refit to the Z (depth)
		// bounds. Both are driven from `renderList`'s world-space bounding
		// boxes inside `DirectionalLight`'s `setShadowProjectionMatrix`
		// (`directionalLight.pure.js`), which `ShadowGenerator.getTransformMatrix`
		// calls on every distinct `scene.getRenderId()` — i.e. every
		// `scene.render()` call this adapter makes, never a cached/stale fit.
		key.autoUpdateExtends = true;
		key.autoCalcShadowZBounds = true;
		// PCF/PCSS filtering read the shadow map once per sample, so no
		// temporal accumulation exists to reset. The shadow map's own
		// `RenderTargetTexture.refreshRate` (`ObjectRenderer`'s default `1`,
		// i.e. render every frame) is left untouched deliberately: it is
		// already not `REFRESHRATE_RENDER_ONCE`, so every one-shot
		// `scene.render()` call this adapter makes re-renders the shadow map
		// from the frame's current caster transforms.
		environmentReadyPromise = new Promise<void>((resolve) => {
			let settled = false;
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const settle = (available: boolean): void => {
				if (settled) return;
				settled = true;
				if (timeoutId !== undefined) clearTimeout(timeoutId);
				if (!available && !disposed) {
					scene.environmentTexture = null;
					ambient.intensity = BASELINE_AMBIENT_INTENSITY;
					key.intensity = BASELINE_KEY_INTENSITY;
					// `PBR_EXPOSURE`/`PBR_CONTRAST` are 1.0, the same neutral
					// default the baseline path never touches — reusing them
					// here restores that untouched baseline value exactly.
					imageProcessing.toneMappingEnabled = false;
					imageProcessing.exposure = PBR_EXPOSURE;
					imageProcessing.contrast = PBR_CONTRAST;
					options.onIssue?.({
						code: "runtime-3d-environment-unavailable",
						severity: "warning",
						message:
							"The Babylon PBR/IBL studio environment failed to load or prefilter in time; the surface fell back to the baseline analytic lighting rig.",
					});
				}
				resolve();
			};
			timeoutId = setTimeout(() => settle(false), ENVIRONMENT_READY_TIMEOUT_MS);
			const environmentTexture = new modules.HDRCubeTexture(
				STUDIO_ENVIRONMENT_URL,
				scene,
				STUDIO_ENVIRONMENT_CUBE_SIZE,
				false,
				true,
				false,
				true,
				null,
				() => settle(false),
			);
			scene.environmentTexture = environmentTexture;
			scene.environmentIntensity = ENVIRONMENT_INTENSITY;
			environmentTexture.onLoadObservable.addOnce(() => settle(true));
		});
	}

	const loadSource = (
		placement: Runtime3dPlacement,
		source: Runtime3dModelSource,
	): Promise<LoadedSource> => {
		const existing = sourceLoads.get(source.cacheKey);
		if (existing) return existing;
		const loading = modules
			.LoadAssetContainerAsync(source.uri, scene, {
				pluginExtension: `.${source.format}`,
				name: placement.assetId,
			})
			.then((container) => {
				if (disposed) {
					container.dispose();
					throw new Error("Babylon runtime surface disposed during load.");
				}
				const loaded = { container };
				loadedSources.set(source.cacheKey, loaded);
				return loaded;
			})
			.catch((error: unknown) => {
				sourceLoads.delete(source.cacheKey);
				throw error;
			});
		sourceLoads.set(source.cacheKey, loading);
		return loading;
	};

	/**
	 * Registers every real mesh under a GLB placement's root as both a shadow
	 * caster and receiver. Vector planes never call this — they use a
	 * separate `VectorPlaneInstance`/`createVectorPlane` path that never
	 * touches `shadowGenerator` — so they neither cast nor receive shadows,
	 * preserving the P6-A pixel-identity guarantee for admitted vector pixels.
	 * A no-op in the baseline path (`shadowGenerator` is `null`).
	 */
	const registerPlacementShadowParticipation = (
		instance: ModelPlacementInstance,
	): void => {
		if (!shadowGenerator) return;
		for (const mesh of instance.root.getChildMeshes()) {
			mesh.receiveShadows = true;
			shadowGenerator.addShadowCaster(mesh, false);
		}
	};

	/** Inverse of `registerPlacementShadowParticipation`; called before the placement's meshes are disposed. */
	const unregisterPlacementShadowParticipation = (
		instance: ModelPlacementInstance,
	): void => {
		if (!shadowGenerator) return;
		for (const mesh of instance.root.getChildMeshes()) {
			shadowGenerator.removeShadowCaster(mesh, false);
		}
	};

	/**
	 * Builds the quad for a rendered frame package. The material mirrors the
	 * vector-plane one: unlit, alpha from the texture, alpha-tested depth prepass
	 * so transparent regions neither occlude nor receive. These are final Blender
	 * pixels — relighting or re-tone-mapping them would be a second grade on top
	 * of the one the render already baked, so under the PBR candidate path this
	 * material gets its own untouched image-processing configuration exactly as
	 * admitted vector pixels do.
	 */
	const createFrameSequencePlacement = async (
		placement: Runtime3dPlacement,
		source: Runtime3dFrameSequenceSource,
	): Promise<FrameSequencePlacementInstance> => {
		const texture = await createFrameTexture(source, modules, scene);
		if (disposed) {
			texture.dispose();
			throw new Error("Babylon runtime surface disposed during load.");
		}
		const material = new modules.StandardMaterial(
			`vecmo-frame-sequence-material:${placement.nodeId}`,
			scene,
		);
		material.backFaceCulling = false;
		material.diffuseColor = modules.Color3.White();
		material.specularColor = modules.Color3.Black();
		material.diffuseTexture = texture;
		material.disableLighting = true;
		// `disableLighting` skips the light loop entirely, so `diffuseBase` stays
		// zero and `diffuseColor` never reaches the fragment's colour term.
		// StandardMaterial only shows a colour under `disableLighting` through
		// `emissiveColor` (default black) added into `finalDiffuse` before it
		// multiplies the diffuse texture's own RGB — so this must be white for
		// the frame's decoded pixels to pass through unlit and unattenuated.
		material.emissiveColor = modules.Color3.White();
		material.useAlphaFromDiffuseTexture = true;
		material.alphaCutOff = 1 / 255;
		material.transparencyMode = modules.Material.MATERIAL_ALPHATESTANDBLEND;
		material.needDepthPrePass = true;
		if (pbrEnabled) {
			material.imageProcessingConfiguration =
				new modules.ImageProcessingConfiguration();
		}
		const { width, height } = frameSequencePlaneSize(source);
		const mesh = modules.CreatePlane(
			`vecmo-frame-sequence:${placement.nodeId}`,
			{ width, height },
			scene,
		);
		mesh.material = material;
		mesh.metadata = {
			[RUNTIME_NODE_ID_METADATA_KEY]: placement.nodeId,
		};
		const root = new modules.TransformNode(
			`vecmo-placement:${placement.nodeId}`,
			scene,
		);
		root.metadata = {
			[RUNTIME_NODE_ID_METADATA_KEY]: placement.nodeId,
		};
		mesh.parent = root;
		const instance: FrameSequencePlacementInstance = {
			kind: "frame-sequence",
			root,
			mesh,
			material,
			texture,
			frameCacheKey: source.frameCacheKey,
			sourceKey: source.cacheKey,
		};
		setPlacementTransform(instance, placement, modules);
		instances.set(placement.nodeId, instance);
		return instance;
	};

	/**
	 * Swaps in the exact frame this runtime frame addresses. A no-op when the
	 * addressed frame has not moved, so a repeated capture of the same frame does
	 * not churn a texture — and, more importantly, so a frame that DID move never
	 * renders against the previous upload.
	 */
	const updateFrameSequenceTexture = async (
		instance: FrameSequencePlacementInstance,
		source: Runtime3dFrameSequenceSource,
	): Promise<void> => {
		if (instance.frameCacheKey === source.frameCacheKey) return;
		const texture = await createFrameTexture(source, modules, scene);
		if (disposed) {
			texture.dispose();
			return;
		}
		const previous = instance.texture;
		instance.material.diffuseTexture = texture;
		instance.texture = texture;
		instance.frameCacheKey = source.frameCacheKey;
		previous.dispose();
	};

	const createPlacement = async (
		placement: Runtime3dPlacement,
	): Promise<PlacementInstance> => {
		if (placement.source.variant === "frame-sequence") {
			return createFrameSequencePlacement(placement, placement.source);
		}
		const modelSource = placement.source;
		const source = await loadSource(placement, modelSource);
		if (disposed)
			throw new Error("Babylon runtime surface disposed during load.");
		const entries = source.container.instantiateModelsToScene(
			(sourceName) => `${placement.nodeId}:${sourceName}`,
			false,
		);
		const root = new modules.TransformNode(
			`vecmo-placement:${placement.nodeId}`,
			scene,
		);
		root.metadata = {
			[RUNTIME_NODE_ID_METADATA_KEY]: placement.nodeId,
		};
		const instance: ModelPlacementInstance = {
			kind: "model",
			entries,
			root,
			sourceKey: modelSource.cacheKey,
		};
		normalizeInstance(instance, modules, scene);
		setPlacementTransform(instance, placement, modules);
		registerPlacementShadowParticipation(instance);
		instances.set(placement.nodeId, instance);
		return instance;
	};

	const disposePlacement = (nodeId: string): void => {
		const instance = instances.get(nodeId);
		if (!instance) return;
		instances.delete(nodeId);
		if (instance.kind === "frame-sequence") {
			// One quad owns exactly one uploaded frame at a time; disposing the
			// root alone would leave that texture resident for the surface's life.
			instance.mesh.dispose(false, false);
			instance.material.dispose(false, false);
			instance.texture.dispose();
			instance.root.dispose(false, true);
			return;
		}
		unregisterPlacementShadowParticipation(instance);
		instance.entries.dispose();
		instance.root.dispose(false, true);
	};

	const disposeVectorPlane = (nodeId: string): void => {
		const instance = vectorPlaneInstances.get(nodeId);
		if (!instance) return;
		vectorPlaneInstances.delete(nodeId);
		instance.mesh.dispose(false, false);
		instance.material.dispose(false, false);
		instance.texture.dispose();
	};

	const releaseUnusedSources = (): void => {
		const inUse = new Set(
			[...instances.values()].map((instance) => instance.sourceKey),
		);
		for (const [sourceKey, source] of loadedSources) {
			if (inUse.has(sourceKey)) continue;
			loadedSources.delete(sourceKey);
			sourceLoads.delete(sourceKey);
			source.container.dispose();
		}
	};

	const applyFrame = async (frame: Runtime3dFrame): Promise<void> => {
		if (disposed) return;
		// A no-op await once the P6-A candidate environment has settled (or
		// immediately when the flag is off); see `environmentReadyPromise`'s
		// doc comment for why every frame — not just the first — awaits it.
		await environmentReadyPromise;
		if (disposed) return;
		engine.setHardwareScalingLevel(1 / Math.max(1, frame.viewport.dpr));
		engine.resize(true);
		configureCamera(camera, frame.camera, modules);
		// SSAO before DOF: see `applyScreenSpaceAmbientOcclusion`'s own doc
		// comment for why this call order (not just the pipeline's internal
		// effect order) matters for `camera._postProcesses` indexing.
		applyScreenSpaceAmbientOcclusion(frame);
		applyDepthOfField(frame);
		const desiredPlacementNodeIds = new Set(
			frame.placements.map((placement) => placement.nodeId),
		);
		for (const nodeId of instances.keys()) {
			if (!desiredPlacementNodeIds.has(nodeId)) disposePlacement(nodeId);
		}
		for (const placement of frame.placements) {
			const current = instances.get(placement.nodeId);
			if (current && current.sourceKey !== placement.source.cacheKey) {
				disposePlacement(placement.nodeId);
			}
			const instance =
				instances.get(placement.nodeId) ?? (await createPlacement(placement));
			// The addressed frame is swapped BEFORE the transform is applied and
			// before this loop can reach `scene.render`, and it is awaited, so no
			// pass can composite frame f's geometry against frame f-1's pixels.
			if (
				instance.kind === "frame-sequence" &&
				placement.source.variant === "frame-sequence"
			) {
				await updateFrameSequenceTexture(instance, placement.source);
				if (disposed) return;
			}
			setPlacementTransform(instance, placement, modules);
			// After `createPlacement`, never before it: `normalizeInstance`
			// measures the hierarchy bounds that define this placement's unit
			// normalization, and measuring them at a seeked pose would make the
			// normalization itself depend on which frame happened to load first.
			// A frame package has no animation groups and never receives an
			// `animation` from the compiler, so this stays GLB-only.
			if (placement.animation && instance.kind === "model") {
				seekPlacementAnimation(instance, placement.animation);
			}
		}
		const vectorPlanes = texturedVectorPlanes(frame);
		const desiredVectorPlaneNodeIds = new Set(
			vectorPlanes.map((plane) => plane.nodeId),
		);
		for (const nodeId of vectorPlaneInstances.keys()) {
			if (!desiredVectorPlaneNodeIds.has(nodeId)) disposeVectorPlane(nodeId);
		}
		for (const plane of vectorPlanes) {
			const current = vectorPlaneInstances.get(plane.nodeId);
			if (current && current.textureKey !== plane.texture.cacheKey) {
				disposeVectorPlane(plane.nodeId);
			}
			const instance =
				vectorPlaneInstances.get(plane.nodeId) ??
				createVectorPlane(plane, modules, scene, pbrEnabled);
			vectorPlaneInstances.set(plane.nodeId, instance);
			setVectorPlaneTransform(instance, plane, modules);
		}
		releaseUnusedSources();
		const visibleArtboardIds = new Set([
			...frame.placements
				.filter((placement) => placement.visible)
				.map((placement) => placement.artboardId),
			...vectorPlanes
				.filter((plane) => plane.visible)
				.map((plane) => plane.artboardId),
		]);
		const renderPasses = frame.artboardClips.filter((clip) =>
			visibleArtboardIds.has(clip.artboardId),
		);
		const preparePass = (clip: Runtime3dArtboardClip): void => {
			setSceneClipPlanes(scene, toBabylonClipPlanes(clip, modules));
			for (const placement of frame.placements) {
				instances
					.get(placement.nodeId)
					?.root.setEnabled(
						placement.visible && placement.artboardId === clip.artboardId,
					);
			}
			for (const plane of vectorPlanes) {
				vectorPlaneInstances
					.get(plane.nodeId)
					?.mesh.setEnabled(
						plane.visible && plane.artboardId === clip.artboardId,
					);
			}
		};
		if (renderPasses.length === 0) {
			setSceneClipPlanes(scene, null);
			// This adapter intentionally owns no render loop. Wait for parallel
			// shader compilation so the requested render cannot commit blank.
			await scene.whenReadyAsync();
			if (disposed) return;
			scene.render(false, true);
			renderedFrame = frame;
			return;
		}
		try {
			for (const [index, clip] of renderPasses.entries()) {
				preparePass(clip);
				// Each pass can expose a different model/material set. Wait for its
				// clip-plane shader variant before the one-shot pass.
				await scene.whenReadyAsync();
				if (disposed) return;
				// Preserve prior artboard color while clearing depth/stencil so
				// later artboards compose in document order.
				scene.autoClear = index === 0;
				scene.autoClearDepthAndStencil = true;
				scene.render(false, true);
			}
		} finally {
			scene.autoClear = true;
			setSceneClipPlanes(scene, null);
			for (const placement of frame.placements) {
				instances.get(placement.nodeId)?.root.setEnabled(placement.visible);
			}
			for (const plane of vectorPlanes) {
				vectorPlaneInstances.get(plane.nodeId)?.mesh.setEnabled(plane.visible);
			}
		}
		renderedFrame = frame;
	};

	return {
		renderFrame: (frame) => {
			const result = queue.then(() => applyFrame(frame));
			queue = result.catch(onError);
			return result;
		},
		pickNodeAtClientPoint: (clientX, clientY) => {
			if (disposed || !renderedFrame) return null;
			const bounds = canvas.getBoundingClientRect();
			const x = clientX - bounds.left;
			const y = clientY - bounds.top;
			if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
				return null;
			}
			const clip = [...renderedFrame.artboardClips]
				.reverse()
				.find((candidate) => pointInPolygon(x, y, candidate.polygon));
			if (!clip) return null;
			const runtimeItemsByNodeId = new Map(
				[
					...renderedFrame.placements,
					...texturedVectorPlanes(renderedFrame),
				].map((item) => [item.nodeId, item] as const),
			);
			const pick = scene.pick(
				x,
				y,
				(mesh) => {
					const runtimeNodeId = runtimeNodeIdForPickedMesh(mesh);
					if (!runtimeNodeId) return false;
					const placement = runtimeItemsByNodeId.get(runtimeNodeId);
					return Boolean(
						placement?.visible &&
							placement.pickable &&
							placement.artboardId === clip.artboardId,
					);
				},
				false,
				camera,
			);
			const runtimeNodeId = runtimeNodeIdForPickedMesh(pick?.pickedMesh);
			if (!pick?.hit || !runtimeNodeId) {
				return { kind: "miss", artboardId: clip.artboardId };
			}
			const placement = runtimeItemsByNodeId.get(runtimeNodeId);
			return placement
				? {
						kind: "hit",
						nodeId: placement.sourceNodeId,
						artboardId: placement.artboardId,
					}
				: { kind: "miss", artboardId: clip.artboardId };
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			for (const nodeId of [...instances.keys()]) disposePlacement(nodeId);
			for (const nodeId of [...vectorPlaneInstances.keys()]) {
				disposeVectorPlane(nodeId);
			}
			for (const source of loadedSources.values()) source.container.dispose();
			loadedSources.clear();
			sourceLoads.clear();
			shadowGenerator?.dispose();
			// `PostProcessRenderPipeline.dispose()` is a documented no-op on the
			// base class this adapter constructs directly ("Must be implemented
			// by children" — `postProcessRenderPipeline.js`); `scene.dispose()`
			// below does not walk the pipeline manager's registered pipelines
			// either, so the effect's own postprocesses must be torn down
			// explicitly or they leak.
			if (dof) {
				scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
					DOF_PIPELINE_NAME,
					camera,
				);
				dof.effect.disposeEffects(camera);
				dof.fxaa.dispose(camera);
				scene.postProcessRenderPipelineManager.removePipeline(
					DOF_PIPELINE_NAME,
				);
				dof.depthRenderer.dispose();
				dof = null;
			}
			// Unlike the raw `dof.pipeline` above, `SSAO2RenderingPipeline.dispose()`
			// (`ssao2RenderingPipeline.pure.js`) is a COMPLETE, self-sufficient
			// teardown: it disposes each of its five postprocesses per camera,
			// detaches and removes itself from the pipeline manager, and disposes
			// its own `ThinSSAO2RenderingPipeline`. `true` also disables the
			// `GeometryBufferRenderer` this surface forced on
			// (`SSAO_FORCE_GEOMETRY_BUFFER`) — this surface is its only user.
			ssao?.pipeline.dispose(true);
			ssao = null;
			scene.dispose();
			engine.dispose();
		},
	};
}
