import {
	type LookGraph,
	type LookGraphNodePayload,
	type LookGraphOwnerRef,
	NOISE_SOURCE_EVOLVE_PER_FRAME,
	sameLookGraphOwner,
	withLookNodeParam,
} from "@/entities/scene/model/look-graph";

/**
 * Payload variants that carry both a `speed` auto-evolve rate and an
 * `evolution` phase to fold it into — `noise-source`'s original contract,
 * now shared by `vhs-tracking`/`vhs-noise`. Checked structurally (not by a
 * hardcoded kind list) so a future node adopting the same two fields opts in
 * automatically instead of needing another edit here.
 */
type AutoEvolvingLookGraphPayload = Extract<
	LookGraphNodePayload,
	{ readonly speed: number; readonly evolution: number }
>;

const isAutoEvolvingPayload = (
	payload: LookGraphNodePayload,
): payload is AutoEvolvingLookGraphPayload =>
	"speed" in payload &&
	"evolution" in payload &&
	typeof payload.speed === "number" &&
	typeof payload.evolution === "number";

import { selectAllArtboards } from "@/entities/scene/model/selectors";
import type {
	Artboard,
	LookGraphScopedEffectLook,
	SceneDocument,
	ScopedEffectLook,
} from "@/entities/scene/model/types";
import {
	replaceArtboardEffectIntent,
	withoutSceneEffectIntent,
} from "./presentation-effect-intent-scene-ops";
import { effectiveLookNodeParam } from "./sampler";
import type { LookNodeParamTrack, MotionDocument } from "./types";

const isMotionScopedLookGraphOverlay = (
	look: ScopedEffectLook,
): look is LookGraphScopedEffectLook => look.kind === "look-graph-overlay";

const replaceScopedLookGraphOverlayInArtboard = (
	artboard: Artboard,
	scopedLookId: string,
	lookGraph: LookGraph,
): Artboard => {
	const scopedLooks = artboard.effectIntent?.scopedLooks;
	if (!scopedLooks) return artboard;
	let changed = false;
	const nextScopedLooks = scopedLooks.map((look) => {
		if (!isMotionScopedLookGraphOverlay(look) || look.id !== scopedLookId) {
			return look;
		}
		changed = true;
		return { ...look, lookGraph };
	});
	if (!changed) return artboard;
	return {
		...artboard,
		effectIntent: {
			...artboard.effectIntent,
			scopedLooks: nextScopedLooks,
		},
	};
};

const replaceScopedLookGraphOverlay = (
	scene: SceneDocument,
	owner: Extract<LookGraphOwnerRef, { readonly scope: "scoped-overlay" }>,
	lookGraph: LookGraph,
): SceneDocument => {
	let changed = false;
	const update = (artboard: Artboard): Artboard => {
		if (artboard.id !== owner.artboardId) return artboard;
		const next = replaceScopedLookGraphOverlayInArtboard(
			artboard,
			owner.scopedLookId,
			lookGraph,
		);
		if (next !== artboard) changed = true;
		return next;
	};
	const artboard = update(scene.artboard);
	const artboards = scene.artboards?.map(update);
	if (!changed) return scene;
	return {
		...scene,
		artboard,
		...(artboards ? { artboards } : {}),
	};
};

/**
 * Patches a Look graph's node payloads with this frame's animated param values for
 * one owner. Returns a new graph when any non-empty track drives a present node,
 * else `undefined` (no change). Values are RAW — `compileLookGraph` re-normalizes.
 */
const patchLookGraphForOwner = (
	lookGraph: LookGraph,
	owner: LookGraphOwnerRef,
	tracks: readonly LookNodeParamTrack[],
	motion: MotionDocument,
	frame: number,
): LookGraph | undefined => {
	const patched = new Map<string, LookGraphNodePayload>();
	for (const track of tracks) {
		if (track.keyframes.length === 0) continue;
		const node = lookGraph.nodes.find(
			(item) => item.id === track.target.lookNodeId,
		);
		if (!node) continue;
		const current = patched.get(node.id) ?? node.payload;
		const value = effectiveLookNodeParam(
			motion,
			owner,
			track.target.lookNodeId,
			track.target.paramKey,
			0,
			frame,
		);
		patched.set(
			node.id,
			withLookNodeParam(current, track.target.paramKey, value),
		);
	}
	// Auto-evolve: any node with a `speed`+`evolution` payload pair (originally
	// `noise-source`; `vhs-tracking`/`vhs-noise` share the contract) boils on its
	// own when `speed > 0`. Fold `speed * frame` into its evolution (on top of any
	// keyframed value), so the field morphs during playback AND export with no
	// keyframing — deterministic in `frame`, so what plays is what exports.
	for (const node of lookGraph.nodes) {
		const base = patched.get(node.id) ?? node.payload;
		if (!isAutoEvolvingPayload(base) || base.speed <= 0) continue;
		patched.set(
			node.id,
			withLookNodeParam(
				base,
				"evolution",
				base.evolution + base.speed * frame * NOISE_SOURCE_EVOLVE_PER_FRAME,
			),
		);
	}
	if (patched.size === 0) return undefined;
	return {
		...lookGraph,
		nodes: lookGraph.nodes.map((node) => {
			const next = patched.get(node.id);
			return next ? { ...node, payload: next } : node;
		}),
	};
};

/** A node with an auto-evolving payload and `speed > 0` evolves every frame even with no keyframe tracks. */
const graphAutoEvolves = (graph: LookGraph | undefined): boolean =>
	graph?.nodes.some(
		(node) => isAutoEvolvingPayload(node.payload) && node.payload.speed > 0,
	) ?? false;

/**
 * Look-graph presentation stage: applies the `lookNodeTracks` side-car to the
 * sampled scene — for each scene, artboard, and scoped-overlay owner with
 * animated look-node params, patches that owner's graph at `frame`. Returns
 * the scene unchanged when there are no look-node tracks or auto-evolving
 * graph nodes; skippable by a lean composer.
 */
export const sampleFrameLookGraphScene = ({
	scene,
	motion,
	frame,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
}): SceneDocument => {
	const tracks = motion.lookNodeTracks ?? [];
	let nextScene = scene;

	// Owners are patched when they have keyframe tracks OR a self-evolving noise-source
	// (auto-evolve has no track but still needs the per-frame phase). Both routes run through
	// `patchLookGraphForOwner`, so the keyframe and auto-evolve phases compose.
	const sceneTracks = tracks.filter(
		(track) => track.target.owner.scope === "scene",
	);
	const sceneIntent = nextScene.effectIntent;
	if (
		sceneIntent?.lookGraph &&
		(sceneTracks.length > 0 || graphAutoEvolves(sceneIntent.lookGraph))
	) {
		const patched = patchLookGraphForOwner(
			sceneIntent.lookGraph,
			{ scope: "scene" },
			sceneTracks,
			motion,
			frame,
		);
		if (patched) {
			nextScene = {
				...withoutSceneEffectIntent(nextScene),
				effectIntent: { ...sceneIntent, lookGraph: patched },
			};
		}
	}

	const artboardIds = [
		...new Set([
			...tracks.flatMap((track) =>
				track.target.owner.scope === "artboard"
					? [track.target.owner.artboardId]
					: [],
			),
			...selectAllArtboards(nextScene).flatMap((artboard) =>
				graphAutoEvolves(artboard.effectIntent?.lookGraph) ? [artboard.id] : [],
			),
		]),
	];
	for (const artboardId of artboardIds) {
		const owner: LookGraphOwnerRef = { scope: "artboard", artboardId };
		const artboard = selectAllArtboards(nextScene).find(
			(item) => item.id === artboardId,
		);
		const intent = artboard?.effectIntent;
		if (!intent?.lookGraph) continue;
		const ownerTracks = tracks.filter((track) =>
			sameLookGraphOwner(track.target.owner, owner),
		);
		const patched = patchLookGraphForOwner(
			intent.lookGraph,
			owner,
			ownerTracks,
			motion,
			frame,
		);
		if (patched) {
			nextScene = replaceArtboardEffectIntent(nextScene, artboardId, {
				...intent,
				lookGraph: patched,
			});
		}
	}

	const scopedOwners = new Map<
		string,
		Extract<LookGraphOwnerRef, { readonly scope: "scoped-overlay" }>
	>();
	const addScopedOwner = (
		owner: Extract<LookGraphOwnerRef, { readonly scope: "scoped-overlay" }>,
	): void => {
		scopedOwners.set(`${owner.artboardId}:${owner.scopedLookId}`, owner);
	};
	for (const track of tracks) {
		if (track.target.owner.scope === "scoped-overlay") {
			addScopedOwner(track.target.owner);
		}
	}
	for (const artboard of selectAllArtboards(nextScene)) {
		for (const look of artboard.effectIntent?.scopedLooks ?? []) {
			if (!isMotionScopedLookGraphOverlay(look)) continue;
			if (!graphAutoEvolves(look.lookGraph)) continue;
			addScopedOwner({
				scope: "scoped-overlay",
				artboardId: artboard.id,
				scopedLookId: look.id,
			});
		}
	}
	for (const owner of scopedOwners.values()) {
		const artboard = selectAllArtboards(nextScene).find(
			(item) => item.id === owner.artboardId,
		);
		const scopedLook = artboard?.effectIntent?.scopedLooks?.find(
			(look): look is LookGraphScopedEffectLook =>
				isMotionScopedLookGraphOverlay(look) && look.id === owner.scopedLookId,
		);
		if (!scopedLook) continue;
		const ownerTracks = tracks.filter((track) =>
			sameLookGraphOwner(track.target.owner, owner),
		);
		const patched = patchLookGraphForOwner(
			scopedLook.lookGraph,
			owner,
			ownerTracks,
			motion,
			frame,
		);
		if (patched) {
			nextScene = replaceScopedLookGraphOverlay(nextScene, owner, patched);
		}
	}
	return nextScene;
};
