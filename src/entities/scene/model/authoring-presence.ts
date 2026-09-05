import { readAppearanceMaskRelations } from "./appearance";
import type { SceneAuthoringCapabilityId } from "./authoring-capabilities";
import type { SceneDocument, VectorNode } from "./types";

const flattenNodes = (nodes: readonly VectorNode[]): readonly VectorNode[] =>
	nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);

/** Returns only Scene capabilities whose durable state is present in a document. */
export function presentSceneAuthoringCapabilities(
	document: SceneDocument,
): ReadonlySet<SceneAuthoringCapabilityId> {
	const present = new Set<SceneAuthoringCapabilityId>([
		"scene.document.id",
		"scene.document.name",
		"scene.document.schema-version",
		"scene.artboards",
		"scene.current-artboard",
		"scene.layers",
	]);
	const nodes = flattenNodes(document.layers.flatMap((layer) => layer.nodes));
	const artboards = document.artboards ?? [document.artboard];

	if (document.sequence) present.add("scene.sequence");
	if (nodes.length > 0) {
		present.add("scene.node.identity");
		present.add("scene.node.visibility-lock");
		present.add("scene.node.hierarchy");
		present.add("scene.node.transform");
		present.add("scene.appearance.basic");
	}
	for (const node of nodes) {
		present.add(`scene.geometry.${node.geometry.kind}`);
		if (
			node.style.fills ||
			node.style.strokes ||
			node.style.effects ||
			node.style.blendMode ||
			node.style.strokeAlign ||
			node.style.strokeDash ||
			node.style.strokeCap ||
			node.style.strokeJoin ||
			node.style.strokeSoftness ||
			node.style.strokeWidthProfile
		) {
			present.add("scene.appearance.rich");
		}
		if (node.recipe || node.recipeRef) present.add("scene.appearance.look");
		if (readAppearanceMaskRelations(node).length > 0) {
			present.add("scene.appearance.mask");
		}
		if (node.component) present.add("scene.components");
		if (node.frame) present.add("scene.layout-frame");
		if (node.blend) present.add("scene.blend");
		if (node.motionParent || node.motionController) {
			present.add("scene.motion-parent");
		}
		if (node.transformConstraint || (node.propertyRelations?.length ?? 0) > 0) {
			present.add("scene.constraints");
		}
		if (node.depthPlane) present.add("scene.camera-depth");
		if (node.data) present.add("scene.node.provenance-data");
		if (node.blendStep || node.textFragmentGroup) {
			present.add("scene.generated-roles");
		}
	}
	if (
		document.effectIntent ||
		artboards.some((artboard) => artboard.effectIntent)
	) {
		present.add("scene.appearance.look");
	}
	if ((document.assets?.length ?? 0) > 0) present.add("scene.assets");
	if ((document.audioTracks?.length ?? 0) > 0) present.add("scene.assets");
	if ((document.componentSymbols?.length ?? 0) > 0) {
		present.add("scene.components");
	}
	if ((document.componentProps?.length ?? 0) > 0) {
		present.add("scene.component-props");
	}
	if ((document.stylePresets?.length ?? 0) > 0) {
		present.add("scene.style-presets");
	}
	if (
		(document.nativeExpressionBindings?.length ?? 0) > 0 ||
		(document.effectExpressionBindings?.length ?? 0) > 0
	) {
		present.add("scene.expressions");
	}
	if ((document.duplicateGenerators?.length ?? 0) > 0) {
		present.add("scene.duplicate-generators");
	}
	if (
		(document.sceneCameras?.length ?? 0) > 0 ||
		artboards.some((artboard) => artboard.activeSceneCameraId)
	) {
		present.add("scene.camera-depth");
	}
	if (
		artboards.some((artboard) => (artboard.sourceOpticsRigs?.length ?? 0) > 0)
	) {
		present.add("scene.source-optics");
	}
	if ((document.interactions?.length ?? 0) > 0) {
		present.add("scene.interactions");
	}
	if ((document.arrangementLayoutSnapshots?.length ?? 0) > 0) {
		present.add("scene.arrangement-snapshots");
	}
	return present;
}
