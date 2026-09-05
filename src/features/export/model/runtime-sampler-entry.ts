/**
 * Portable bundler entry for the motion/code handoff runtime.
 *
 * The `vma:motion-runtime-sampler` Vite plugin (see {@link ../../../../vite.config.ts})
 * esbuild-bundles THIS module into a single self-contained IIFE string, which
 * {@link ./code.ts} embeds into the generated `*.runtime.js` payload. The point is
 * that the standalone runtime samples motion with the SAME pure code the editor
 * and the in-app SVG/PDF export already use ({@link ./render-presentation.ts} →
 * `sampleMotionPresentationScene` + the motion-grammar evaluator), so exported
 * playback can never drift from the live canvas — every grammar technique
 * (cycle, ring-wave, afterimage, …) reproduces identically, not just `time-delay`.
 * `buildSceneMeshPaintSvgArtifacts` gives the same guarantee for mesh-gradient
 * paints, which have no native SVG paint server: it rasterizes the SAME Coons
 * patches the live canvas and in-app SVG export already use, so a mesh fill
 * never silently drops out of exported playback. `buildScenePaintSvgArtifacts`
 * extends that guarantee to every other paint kind (linear/radial gradient,
 * image-reference) and to multi-paint stacks; `buildSceneEffectFilterArtifacts`
 * gives node effects (layer-blur, drop/inner shadow) and attached vec-core
 * recipes (grain, color grade, …) the same shared-filter-build guarantee.
 *
 * It re-exports only DOM-free, React-free pure functions; the bundle therefore
 * runs unchanged in a browser, a worker, or a bare module. Nothing imports this
 * file directly — it exists solely as the bundler entry.
 */

export { createInteractionEngine } from "@/entities/motion/model/interaction-engine";
export {
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
export {
	buildMotionGrammarFrameSampler,
	sampleGrammarFrame,
} from "@/entities/motion-grammar/model/evaluator";
export { buildSceneEffectFilterArtifacts } from "@/entities/scene/model/effect-filter-artifacts";
export {
	buildSceneMaskSvgArtifacts,
	buildSceneStrokeBlurArtifacts,
} from "@/entities/scene/model/mask-svg";
export { buildSceneMeshPaintSvgArtifacts } from "@/entities/scene/model/mesh-paint-svg";
export { buildScenePaintSvgArtifacts } from "@/entities/scene/model/paint-stack-svg";
export { runtimeCameraControlForArtboard } from "@/entities/scene/model/scene-camera";
export { resolveSequenceFrameAddress } from "@/entities/scene/model/sequence";
export { buildExportRenderPresentation } from "./render-presentation";
export { createRuntimePlayerControl } from "./runtime-player-control";
