import {
	effectiveTransform,
	isNodeAnimated,
} from "@/entities/motion/model/sampler";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	buildRasterPasses,
	buildRasterTree,
	buildScopedDeepGlowPlan,
} from "@/entities/scene/model/gpu-raster-adapter";
import { matrixFromTransform } from "@/entities/scene/model/rendering";
import { scopedLookGraphNodeBounds } from "@/entities/scene/model/scoped-look-graph-overlay";
import { buildSourceOpticsPresentation } from "@/entities/scene/model/source-optics";
import { sourceOpticsFilterPrimitives } from "@/entities/scene/model/source-optics-filter";
import type {
	Bounds,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { hexToRgb } from "@/shared/color";
import type {
	StaticRasterCompositionFrame,
	StaticRasterCompositionPlan,
} from "@/shared/gpu-lens/static-composition";

const TRANSFORM_PROPERTIES = new Set([
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
]);

const MAX_STATIC_RASTER_LAYERS = 128;

const padBounds = (bounds: Bounds, padding: number): Bounds => ({
	height: bounds.height + padding * 2,
	width: bounds.width + padding * 2,
	x: bounds.x - padding,
	y: bounds.y - padding,
});

export type StaticRasterPlaybackDescriptor = {
	readonly background: readonly [number, number, number, number];
	readonly excludedScopedLookId: string;
	readonly glow: StaticRasterCompositionPlan["glow"];
	readonly sourceOpticsSourceNodeIds: ReadonlySet<string>;
	readonly nodes: readonly {
		readonly bounds: StaticRasterCompositionPlan["layers"][number]["bounds"];
		readonly node: VectorNode;
	}[];
};

/**
 * Admits only the narrow, exact transform-only compositor envelope. Any scene
 * behavior that could change source pixels or ordering fails closed to the
 * existing full-frame SVG raster path.
 */
export function describeStaticRasterPlayback(input: {
	readonly grammarBindingCount: number;
	readonly hasVideoMedia: boolean;
	readonly motion: MotionDocument;
	readonly scene: SceneDocument;
}): StaticRasterPlaybackDescriptor | null {
	const { grammarBindingCount, hasVideoMedia, motion, scene } = input;
	const artboardFill = scene.artboard.fills?.filter(
		(fill) => fill.visible !== false,
	);
	if (
		grammarBindingCount > 0 ||
		hasVideoMedia ||
		(scene.artboards?.length ?? 0) > 1 ||
		scene.sequence ||
		(scene.duplicateGenerators?.length ?? 0) > 0 ||
		(motion.positionPaths?.length ?? 0) > 0 ||
		(motion.lookNodeTracks?.length ?? 0) > 0 ||
		(motion.sourceOpticsTracks?.length ?? 0) > 0 ||
		(motion.cameraTracks?.length ?? 0) > 0 ||
		(motion.cameraCuts?.length ?? 0) > 0 ||
		(motion.textAnimators?.length ?? 0) > 0 ||
		motion.automation ||
		motion.grammar ||
		scene.effectIntent ||
		scene.artboard.effectIntent?.lookGraph ||
		scene.artboard.effectIntent?.effectLayerStack ||
		scene.artboard.effectIntent?.visualRecipe ||
		scene.artboard.effectIntent?.influenceRecipe ||
		(artboardFill &&
			(artboardFill.length !== 1 ||
				artboardFill[0]?.kind !== "solid" ||
				artboardFill[0].color !== scene.artboard.background ||
				(artboardFill[0].opacity ?? 1) !== 1))
	) {
		return null;
	}
	if (
		motion.tracks.some(
			(track) =>
				track.keyframes.length > 0 &&
				!TRANSFORM_PROPERTIES.has(track.target.property),
		)
	) {
		return null;
	}
	if (buildRasterTree(scene) || buildRasterPasses(scene).length > 0)
		return null;
	const glow = buildScopedDeepGlowPlan(scene);
	if (glow?.pass.params.mode !== "glow") return null;
	const hasUnsupportedScopedLook = (
		scene.artboard.effectIntent?.scopedLooks ?? []
	).some(
		(look) =>
			look.id !== glow.overlayId &&
			(look.kind !== "look-graph-overlay" ||
				look.source !== "object-noise-gradient"),
	);
	if (hasUnsupportedScopedLook) return null;
	const nodes = scene.layers.flatMap((layer) =>
		layer.visible ? layer.nodes.filter((node) => node.visible) : [],
	);
	const nodeIds = new Set(nodes.map((node) => node.id));
	const sourceOptics = buildSourceOpticsPresentation(
		scene,
		scene.artboard.id,
		"svg-export",
	);
	if (sourceOptics.issues.length > 0) return null;
	const sourceOpticsSourceNodeIds = new Set(
		sourceOptics.sourcePlans.map((plan) => plan.sourceNodeId),
	);
	if (
		nodes.length === 0 ||
		nodes.length > MAX_STATIC_RASTER_LAYERS ||
		nodes.some(
			(node) =>
				(node.children?.length ?? 0) > 0 ||
				Boolean(node.blend) ||
				Boolean(node.motionParent),
		) ||
		[...sourceOpticsSourceNodeIds].some(
			(nodeId) => !nodeIds.has(nodeId) || isNodeAnimated(motion, nodeId),
		)
	) {
		return null;
	}
	const targetIds = new Set(glow.targetNodeIds);
	if (
		targetIds.size !== nodes.length ||
		nodes.some((node) => !targetIds.has(node.id))
	) {
		return null;
	}
	const rgb = hexToRgb(scene.artboard.background);
	if (!rgb) return null;
	return {
		background: [rgb.r / 255, rgb.g / 255, rgb.b / 255, 1],
		excludedScopedLookId: glow.overlayId,
		glow: glow.pass.params,
		sourceOpticsSourceNodeIds,
		nodes: nodes.map((node) => {
			const bounds = scopedLookGraphNodeBounds(node);
			const opticsReach = sourceOpticsFilterPrimitives(
				sourceOptics.nodePlans[node.id],
				bounds,
				"SourceGraphic",
			).outwardReach;
			return {
				bounds: padBounds(bounds, opticsReach),
				node,
			};
		}),
	};
}

/** Samples only admitted transform channels from the canonical motion document. */
export function sampleStaticRasterPlayback(
	descriptor: StaticRasterPlaybackDescriptor,
	motion: MotionDocument,
	frame: number,
): StaticRasterCompositionFrame {
	return {
		frame,
		layers: descriptor.nodes.map(({ node }) => ({
			matrix: matrixFromTransform(effectiveTransform(node, motion, frame)),
			nodeId: node.id,
		})),
	};
}
