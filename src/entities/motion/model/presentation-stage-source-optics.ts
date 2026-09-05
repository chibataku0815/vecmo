import { selectAllArtboards } from "@/entities/scene/model/selectors";
import {
	sourceOpticsParameterDescriptor,
	sourceOpticsParameterValue,
	withSourceOpticsParameterValue,
} from "@/entities/scene/model/source-optics";
import type { SceneDocument } from "@/entities/scene/model/types";
import { effectiveSourceOpticsParameter } from "./sampler";
import type { MotionDocument } from "./types";

/**
 * Source-optics presentation stage: overlays `motion.sourceOpticsTracks`
 * keyframe values onto the scene's Source Optics rig/ray/binding parameters for
 * one frame. Reference-preserving identity when there are no applicable
 * tracks, so a lean composer can skip this stage entirely.
 */
export const sampleFrameSourceOpticsScene = (options: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
}): SceneDocument => {
	let sampledScene = options.scene;
	for (const track of options.motion.sourceOpticsTracks ?? []) {
		const descriptor = sourceOpticsParameterDescriptor(
			track.target.parameterId,
		);
		const expectedOwner =
			track.target.kind === "binding" ? "response" : track.target.kind;
		if (!descriptor?.keyframable || descriptor.owner !== expectedOwner)
			continue;
		const artboard = selectAllArtboards(sampledScene).find(
			(candidate) => candidate.id === track.target.artboardId,
		);
		if (!artboard) continue;
		const base = sourceOpticsParameterValue(artboard, track.target);
		if (base === undefined) continue;
		const value = effectiveSourceOpticsParameter(
			options.motion,
			track.target,
			base,
			options.frame,
		);
		sampledScene = withSourceOpticsParameterValue(
			sampledScene,
			track.target,
			value,
		);
	}
	return sampledScene;
};
