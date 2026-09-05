import type { MotionDocument } from "@/entities/motion/model/types";
import {
	allNodes,
	selectAllArtboards,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";

/**
 * The single canonical `contextRevision` for the Motion Copilot planning loop
 * (Creator 2, C2-L4). React/zustand-free so it can be called by BOTH features that
 * take part in the loop without a feature-to-feature import: the composer
 * (`features/motion-copilot`) mints it against the projection it sends, and the
 * bridge review recorder (`features/agent`) mints it at receipt for an externally
 * proposed plan. The staleness watcher recomputes it from the live stores and
 * compares — so all three MUST derive it from this one function or drift is
 * undetectable.
 *
 * CRITICAL — it must be value-sensitive, not count-sensitive. The manual Graph
 * edits this loop must survive (C2-L1) are a keyframe value drag, a retime, and a
 * temporal-handle reshape — none of which change any COUNT. So the fingerprint
 * folds each node-keyed track's per-keyframe `time`, scalar `value`, interpolation
 * types, and exact temporal curve. A pure count hash (an earlier draft) would let
 * a "reshape the settle directly" edit slip past staleness detection entirely.
 *
 * It is a coarse-grained fingerprint, not a diff: it proves only that SOMETHING
 * the plan was built against changed, which is all the stale card needs. The apply
 * spine's fresh re-validation remains the real last line of defense.
 */

/** Same track cap the projection uses, so revision and projection see the same set. */
const TRACK_CAP = 200;
/** Per-track keyframe cap — a pathological track cannot inflate the fold. */
const KEYFRAME_CAP = 512;

const djb2 = (parts: readonly (string | number)[]): string => {
	const input = parts.join("|");
	let hash = 5381;
	for (let index = 0; index < input.length; index += 1) {
		hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
	}
	return (hash >>> 0).toString(36);
};

/**
 * Mints the context revision from the live scene + motion documents, or `null`
 * when there is no current artboard to plan against (fail closed, matching the
 * projection builder). The inputs are the raw documents (never store handles) so
 * the composer, the bridge recorder, and the watcher all pass the same snapshot
 * shape.
 */
export function computeContextRevision(
	scene: SceneDocument,
	motion: MotionDocument,
): string | null {
	const artboard = selectCurrentArtboard(scene);
	if (!artboard) return null;

	const parts: (string | number)[] = [
		scene.id,
		allNodes(scene).length,
		selectAllArtboards(scene).length,
		motion.tracks.length,
		motion.durationFrames,
		motion.fps,
		artboard.id,
	];

	for (const track of motion.tracks.slice(0, TRACK_CAP)) {
		parts.push("T", track.id, track.keyframes.length);
		for (const keyframe of track.keyframes.slice(0, KEYFRAME_CAP)) {
			// Scalar tracks fold their numeric value; snapshot-valued tracks (mesh
			// paint, path shape) are out of the C2 motion scope, so a stable marker
			// keeps them in the fold without pretending to track their content.
			const value =
				typeof keyframe.value === "number" && Number.isFinite(keyframe.value)
					? keyframe.value
					: "s";
			const curve = keyframe.outTemporalCurve;
			parts.push(
				keyframe.time,
				value,
				keyframe.inInterpolationType ?? "",
				keyframe.outInterpolationType ?? "",
				curve ? `${curve.x1},${curve.y1},${curve.x2},${curve.y2}` : "",
			);
		}
	}

	return djb2(parts);
}
