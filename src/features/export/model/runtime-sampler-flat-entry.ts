/**
 * Bundler entry for the FLAT motion/code handoff runtime — LEAN minus camera,
 * the leanest sibling of {@link ./runtime-sampler-lean-entry.ts}.
 *
 * Backed by {@link buildFlatRenderPresentation}, which additionally skips real
 * camera projection (`resolveSceneCameraProjection`'s 3D rig/crossfade/
 * depth-of-field matrix math): motion-parent/property-relation resolution
 * still runs (a separate capability from camera projection), but the camera
 * itself is always `{ kind: "none" }` — see `presentation.ts`'s
 * `flatResolveCameraPresentation`. `code.ts` embeds THIS bundle only when the
 * export-side motion-artifact tier predicate (`sceneQualifiesForFlatTier`)
 * has confirmed the scene has no scene-camera rig anywhere and the export
 * artboard declares `cameraSpacePolicy: "screen_2d"`.
 *
 * `RUNTIME_PLAYER_SOURCE` (`code.ts`) calls every `RUNTIME_SAMPLER.buildScene*`
 * member and `runtimeCameraControlForArtboard` unconditionally regardless of
 * which bundle got embedded (see {@link ./runtime-sampler-api.ts}), so the
 * members this tier cannot provide for real are EXPLICIT no-op/degrade
 * implementations below, matching `runtime-sampler-lean-entry.ts`'s reasoning
 * for each. `runtimeCameraControlForArtboard` is additionally a no-op here
 * (unlike LEAN, which keeps it real): the tier predicate already guarantees
 * `scene.sceneCameras` is empty, so the real implementation's only live
 * branch (`if (!activeCameraRigId) return runtimeControl;`) is the only
 * branch a FLAT-eligible scene could ever reach — a plain passthrough is
 * behaviorally identical without statically referencing `scene-camera.ts`.
 *
 * Nothing imports this file directly — it exists solely as the bundler entry.
 */

import type {
	CreateInteractionEngineOptions,
	InteractionEngine,
} from "@/entities/motion/model/interaction-engine";
import {
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneEffectFilterArtifacts } from "@/entities/scene/model/effect-filter-artifacts";
import type {
	MaskEffectiveGeometryResolver,
	SceneMaskSvgArtifacts,
	SceneStrokeBlurSvgArtifacts,
} from "@/entities/scene/model/mask-svg";
import type {
	SceneMeshPaintSvgArtifacts,
	SceneMeshPaintSvgOptions,
} from "@/entities/scene/model/mesh-paint-svg";
import {
	createScenePaintSvgArtifactsBuilder,
	type MeshPatternDefResolver,
} from "@/entities/scene/model/paint-stack-svg";
import type { SceneCameraRuntimeControl } from "@/entities/scene/model/scene-camera";
import { resolveSequenceFrameAddress } from "@/entities/scene/model/sequence";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildFlatRenderPresentation as buildExportRenderPresentation } from "./render-presentation-flat";
import { createRuntimePlayerControl } from "./runtime-player-control";

/** No-op degrade: the tier predicate already confirmed this scene has no representable mask source. */
const buildSceneMaskSvgArtifacts = (
	_scene: SceneDocument,
	_motion: MotionDocument,
	_frame: number,
	_effectiveGeometry: MaskEffectiveGeometryResolver,
): SceneMaskSvgArtifacts => ({
	defs: "",
	applicationsByNodeId: {},
	consumedNodeIds: [],
});

/** No-op degrade: the tier predicate already confirmed this scene has no blend node needing a stroke-blur filter this tier would otherwise skip along with masks. */
const buildSceneStrokeBlurArtifacts = (
	_scene: SceneDocument,
): SceneStrokeBlurSvgArtifacts => ({
	defs: "",
	filterIdByNodeId: {},
});

/** No-op degrade: the tier predicate already confirmed this scene has no node-level effect filter, recipe, or look-graph/Source-Optics capability. */
const buildSceneEffectFilterArtifacts = (
	_scene: SceneDocument,
	_frameTimeSeconds?: number,
): SceneEffectFilterArtifacts => ({
	defs: "",
	filterIdByNodeId: {},
	sourceOpticsIssues: [],
});

/** No-op degrade: the tier predicate already confirmed this scene has no mesh-gradient paint. */
const buildSceneMeshPaintSvgArtifacts = (
	_scene: SceneDocument,
	_options?: SceneMeshPaintSvgOptions,
): SceneMeshPaintSvgArtifacts => ({
	defs: "",
	fillPatternRefByNodeId: {},
	strokePatternRefByNodeId: {},
	hrefByToken: {},
});

/** No-op degrade: the tier predicate already confirmed this scene has no authored interactions, so a mounted player never actually calls this (see `code.ts`'s `interactionsEnabled` guard). */
const createInteractionEngine = (
	_options: CreateInteractionEngineOptions,
): InteractionEngine => ({
	handleEvent: () => [],
	tick: (_deltaSeconds: number) => ({ frame: 0, events: [] }),
	seek: () => {},
	setLoop: () => {},
	frame: 0,
	getState: () => "idle",
});

/**
 * Passthrough no-op: the tier predicate already confirmed `scene.sceneCameras`
 * is empty, so the real implementation's rig-scope dormant check can never
 * fire for a FLAT-eligible scene — this returns `runtimeControl` unchanged,
 * the real function's only reachable branch.
 */
const runtimeCameraControlForArtboard = (
	_scene: SceneDocument,
	_artboardId: string,
	runtimeControl: SceneCameraRuntimeControl | undefined,
): SceneCameraRuntimeControl | undefined => runtimeControl;

/**
 * Fail-loud no-op: the tier predicate already confirmed this scene has no
 * mesh-gradient paint anywhere in its fill/stroke stacks (same predicate
 * `buildSceneMeshPaintSvgArtifacts` above relies on), so
 * `buildScenePaintSvgArtifacts`'s "mesh-gradient" paint case is structurally
 * unreachable for a FLAT-eligible scene. Throws instead of degrading silently
 * (unlike the other no-ops above) because reaching it means the tier
 * predicate itself was wrong — a mesh paint silently dropped from exported
 * playback is exactly the class of bug this module exists to prevent.
 */
const flatMeshPatternDef: MeshPatternDefResolver = () => {
	throw new Error(
		"FLAT runtime sampler reached a mesh-gradient paint; the motion-artifact tier predicate should have excluded this scene from FLAT.",
	);
};

const buildScenePaintSvgArtifacts =
	createScenePaintSvgArtifactsBuilder(flatMeshPatternDef);

export {
	buildExportRenderPresentation,
	buildSceneEffectFilterArtifacts,
	buildSceneMaskSvgArtifacts,
	buildSceneMeshPaintSvgArtifacts,
	buildScenePaintSvgArtifacts,
	buildSceneStrokeBlurArtifacts,
	createInteractionEngine,
	createRuntimePlayerControl,
	effectiveShape,
	effectiveTransform,
	resolveSequenceFrameAddress,
	runtimeCameraControlForArtboard,
};
