/**
 * Bundler entry for the CORE motion/code handoff runtime — the grammar/expression-
 * free sibling of {@link ./runtime-sampler-entry.ts}.
 *
 * Exports the same `buildExportRenderPresentation` global API the generated player
 * calls, but backed by {@link buildCoreRenderPresentation}, which omits the motion-
 * grammar evaluator and expression sampler. {@link ./code.ts} embeds THIS bundle
 * instead of the full one when the exported scene uses none of those features, in
 * which case the two runtimes sample identically (see render-presentation-core.ts).
 *
 * `createInteractionEngine` has no grammar/expression dependency of its own, so it
 * is re-exported unchanged here — both bundles carry the SAME interaction engine
 * code. The scene-artifact builders below (masks, stroke-blur, mesh paint, paint
 * stacks, effect filters) are likewise grammar/expression-independent, and
 * `RUNTIME_PLAYER_SOURCE` (`code.ts`) calls ALL of them unconditionally regardless
 * of which bundle was embedded — they must be re-exported by BOTH entries by
 * contract with the player, or a grammar-free scene (this bundle's selection
 * condition, see `exportPrefersCoreRuntime` in `code.ts`) throws a `TypeError` at
 * render for calling an undefined `RUNTIME_SAMPLER.buildScene*` function.
 *
 * `effectiveShape`/`effectiveTransform` are the same case: `code.ts` passes them
 * into `buildSceneMaskSvgArtifacts` unconditionally as the mask module's injected
 * `effectiveGeometry` resolver (see `MaskEffectiveGeometryResolver`), and a `"path"`
 * mask source calls `effectiveShape` at render time. Omitting them here cost
 * nothing to bundle (`sampler.ts` is already pulled in transitively for other
 * exports) but left a keyframe-only scene with a path mask throwing `TypeError`
 * on the CORE runtime — re-exported here for the same contract reason as the
 * builders above, not because this bundle needs a new dependency.
 *
 * Nothing imports this file directly — it exists solely as the bundler entry.
 */

export { createInteractionEngine } from "@/entities/motion/model/interaction-engine";
export {
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
export { buildSceneEffectFilterArtifacts } from "@/entities/scene/model/effect-filter-artifacts";
export {
	buildSceneMaskSvgArtifacts,
	buildSceneStrokeBlurArtifacts,
} from "@/entities/scene/model/mask-svg";
export { buildSceneMeshPaintSvgArtifacts } from "@/entities/scene/model/mesh-paint-svg";
export { buildScenePaintSvgArtifacts } from "@/entities/scene/model/paint-stack-svg";
export { runtimeCameraControlForArtboard } from "@/entities/scene/model/scene-camera";
export { resolveSequenceFrameAddress } from "@/entities/scene/model/sequence";
export { buildCoreRenderPresentation as buildExportRenderPresentation } from "./render-presentation-core";
export { createRuntimePlayerControl } from "./runtime-player-control";
