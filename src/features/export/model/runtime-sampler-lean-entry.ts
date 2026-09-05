/**
 * Bundler entry for the LEAN motion/code handoff runtime — the mask/mesh-
 * paint/interaction-free sibling of {@link ./runtime-sampler-core-entry.ts}.
 *
 * Backed by {@link buildLeanRenderPresentation}, which additionally skips the
 * source-optics, effect-expression, look-graph, and blend-refresh
 * presentation stages. `code.ts` embeds THIS bundle only when the export-side
 * motion-artifact tier predicate (`selectMotionArtifactRuntimeSamplerTier`,
 * next to `motionArtifactForcesFullTier`) has confirmed the scene needs none
 * of: masks, mesh-gradient paint, blend nodes, interactions, or
 * look-graph/effect/recipe/Source-Optics capabilities — camera projection is
 * KEPT (core to visual identity, not an optional capability). Duplicate
 * generators ARE allowed at this tier (see `render-presentation-lean.ts`).
 *
 * `RUNTIME_PLAYER_SOURCE` (`code.ts`) calls every `RUNTIME_SAMPLER.buildScene*`
 * member unconditionally regardless of which bundle got embedded (see
 * {@link ./runtime-sampler-api.ts}), so the members this tier cannot provide
 * for real (mask/stroke-blur defs, mesh-paint defs, node effect-filter defs,
 * the interaction engine) are EXPLICIT no-op/degrade implementations below,
 * not missing exports — an omitted export would be a `TypeError` at render
 * for a tier-selection bug, where a no-op degrades silently instead. This is
 * safe specifically because the tier predicate already confirmed the scene
 * has no mask/mesh-paint/interaction/effect/recipe/look-graph content for
 * these to lose. `buildSceneEffectFilterArtifacts` is a no-op here (not the
 * real builder, unlike CORE) for exactly that reason: determining whether ANY
 * node has an effect filter needs the same recipe/look-graph resolution chain
 * (`effect-filter.ts`, `recipe-resolve.ts`, `look-graph.ts`, `source-optics.ts`)
 * regardless of scene content, and the tier predicate has already ruled that
 * chain out for a LEAN-selected scene.
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
import { runtimeCameraControlForArtboard } from "@/entities/scene/model/scene-camera";
import { resolveSequenceFrameAddress } from "@/entities/scene/model/sequence";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildLeanRenderPresentation as buildExportRenderPresentation } from "./render-presentation-lean";
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

/**
 * No-op degrade: the tier predicate already confirmed this scene has no
 * node-level effect filter, recipe, or look-graph/Source-Optics capability —
 * unlike CORE (which still runs the real builder), LEAN never pays for the
 * recipe/look-graph resolution chain that determining "does any node have an
 * effect filter" would otherwise require regardless of scene content.
 */
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
 * Fail-loud no-op: the tier predicate already confirmed this scene has no
 * mesh-gradient paint anywhere in its fill/stroke stacks (same predicate
 * `buildSceneMeshPaintSvgArtifacts` above relies on), so
 * `buildScenePaintSvgArtifacts`'s "mesh-gradient" paint case is structurally
 * unreachable for a LEAN-selected scene. Throws instead of degrading silently
 * (unlike the other no-ops above) because reaching it means the tier
 * predicate itself was wrong — a mesh paint silently dropped from exported
 * playback is exactly the class of bug this module exists to prevent.
 */
const leanMeshPatternDef: MeshPatternDefResolver = () => {
	throw new Error(
		"LEAN runtime sampler reached a mesh-gradient paint; the motion-artifact tier predicate should have excluded this scene from LEAN.",
	);
};

const buildScenePaintSvgArtifacts =
	createScenePaintSvgArtifactsBuilder(leanMeshPatternDef);

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
