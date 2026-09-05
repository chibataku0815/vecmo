import type { createInteractionEngine } from "@/entities/motion/model/interaction-engine";
import type {
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import type { buildSceneEffectFilterArtifacts } from "@/entities/scene/model/effect-filter-artifacts";
import type {
	buildSceneMaskSvgArtifacts,
	buildSceneStrokeBlurArtifacts,
} from "@/entities/scene/model/mask-svg";
import type { buildSceneMeshPaintSvgArtifacts } from "@/entities/scene/model/mesh-paint-svg";
import type { buildScenePaintSvgArtifacts } from "@/entities/scene/model/paint-stack-svg";
import type { runtimeCameraControlForArtboard } from "@/entities/scene/model/scene-camera";
import type { resolveSequenceFrameAddress } from "@/entities/scene/model/sequence";
import type {
	ExportRenderPresentation,
	ExportRenderPresentationInput,
} from "./render-presentation";
import type { createRuntimePlayerControl } from "./runtime-player-control";

/**
 * Contract every runtime-sampler bundler entry (FULL, CORE, and any future
 * leaner tier) must satisfy. `code.ts`'s embedded `RUNTIME_PLAYER_SOURCE` calls
 * `RUNTIME_SAMPLER.buildScene*`/`createInteractionEngine`/etc. unconditionally
 * regardless of which bundle got embedded (see `runtime-sampler-bundle.ts` and
 * the tier selection in `code.ts`), so a tier that cannot provide a capability
 * must still export an EXPLICIT no-op/degrade implementation — an omitted
 * export is a `TypeError` at render, not a type error at build. `typeof`-ing
 * each member off its real implementation (rather than hand-declaring
 * signatures here) keeps this contract a compile error away from drifting off
 * the actual pure functions it constrains.
 *
 * `buildExportRenderPresentation` is the one member typed explicitly rather
 * than via `typeof`: FULL's implementation accepts an optional
 * `grammarBindings` field and CORE's/a lean tier's may omit that field
 * entirely (structurally a supertype of this signature, so it still satisfies
 * it) — see `render-presentation-core.ts`'s `buildCoreRenderPresentation`.
 */
export type RuntimeSamplerApi = {
	readonly createInteractionEngine: typeof createInteractionEngine;
	readonly effectiveShape: typeof effectiveShape;
	readonly effectiveTransform: typeof effectiveTransform;
	readonly buildSceneEffectFilterArtifacts: typeof buildSceneEffectFilterArtifacts;
	readonly buildSceneMaskSvgArtifacts: typeof buildSceneMaskSvgArtifacts;
	readonly buildSceneStrokeBlurArtifacts: typeof buildSceneStrokeBlurArtifacts;
	readonly buildSceneMeshPaintSvgArtifacts: typeof buildSceneMeshPaintSvgArtifacts;
	readonly buildScenePaintSvgArtifacts: typeof buildScenePaintSvgArtifacts;
	readonly runtimeCameraControlForArtboard: typeof runtimeCameraControlForArtboard;
	readonly resolveSequenceFrameAddress: typeof resolveSequenceFrameAddress;
	readonly buildExportRenderPresentation: (
		input: ExportRenderPresentationInput,
	) => ExportRenderPresentation;
	readonly createRuntimePlayerControl: typeof createRuntimePlayerControl;
};
