import { refreshSceneBlendNodes } from "@/entities/scene/model/blend";
import type { SceneDocument } from "@/entities/scene/model/types";

/**
 * Blend presentation stage, skippable by a lean composer. Keep this a bare
 * pass-through — a spread/clone here breaks `blendRefreshCache`'s
 * document-identity keying in `blend.ts`.
 */
export const sampleFrameBlendScene = (scene: SceneDocument): SceneDocument =>
	refreshSceneBlendNodes(scene);
