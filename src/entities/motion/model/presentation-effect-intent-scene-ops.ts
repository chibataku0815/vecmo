import type {
	Artboard,
	EffectIntent,
	SceneDocument,
} from "@/entities/scene/model/types";

/**
 * Scene/artboard `effectIntent` replacement helpers shared by the
 * effect-expression and look-graph presentation stages. Hoisted here so
 * neither stage imports the other.
 */

export const withoutSceneEffectIntent = (
	scene: SceneDocument,
): SceneDocument => {
	const next: SceneDocument & { effectIntent?: EffectIntent } = { ...scene };
	delete next.effectIntent;
	return next;
};

const withoutArtboardEffectIntent = (artboard: Artboard): Artboard => {
	const next: Artboard & { effectIntent?: EffectIntent } = { ...artboard };
	delete next.effectIntent;
	return next;
};

export const replaceArtboardEffectIntent = (
	scene: SceneDocument,
	artboardId: string,
	effectIntent: EffectIntent | undefined,
): SceneDocument => {
	let changed = false;
	const update = (artboard: Artboard): Artboard => {
		if (artboard.id !== artboardId) return artboard;
		changed = true;
		const rest = withoutArtboardEffectIntent(artboard);
		return effectIntent ? { ...rest, effectIntent } : rest;
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
