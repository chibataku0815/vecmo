import { deepEqual } from "@/shared/lib/deep-equal";
import {
	materializeLayoutChildIntoBounds,
	resolveLayoutFramePlan,
} from "./layout-frame";
import type {
	Bounds,
	LayoutCellPlacement,
	SceneDocument,
	Transform,
	VectorNode,
} from "./types";

/**
 * Parent-space translation from a child node's authored rest position to the
 * non-mutating layout projection used as motion rest. Motion sampling applies it
 * only to authored `x`/`y` tracks, preserving source keyframes.
 */
export type LayoutMotionPositionOffset = {
	readonly x: number;
	readonly y: number;
};

/**
 * Layout-resolved scene plus per-node position offsets needed to keep animated
 * layout children attached to their current cells during presentation sampling.
 */
export type LayoutMotionPresentation = {
	readonly scene: SceneDocument;
	readonly positionOffsets: ReadonlyMap<string, LayoutMotionPositionOffset>;
};

// Scene documents are immutable-at-root in normal editor writes. Caching by root
// identity lets canvas, motion sampling, and export share layout materialization
// work while stale entries fall out with GC when old document objects disappear.
const renderPresentationCache = new WeakMap<SceneDocument, SceneDocument>();
const motionPresentationCache = new WeakMap<
	SceneDocument,
	LayoutMotionPresentation
>();

/**
 * Primes the render-presentation cache after an external content-key check.
 * This exists for persistent cache hydration only; callers must prove the
 * materialized document was derived from the exact immutable scene root they
 * pass here.
 */
export function primeLayoutPresentationCache(
	scene: SceneDocument,
	materialized: SceneDocument,
): void {
	renderPresentationCache.set(scene, materialized);
}

/**
 * Primes the motion-presentation cache after an external content-key check.
 * Persistent cache readers use this to avoid rewalking layout frames on the
 * next presentation sample without making cache artifacts authoritative.
 */
export function primeLayoutMotionPresentationCache(
	scene: SceneDocument,
	materialized: LayoutMotionPresentation,
): void {
	motionPresentationCache.set(scene, materialized);
}

const materializeLayoutChildForPresentation = (
	node: VectorNode,
	bounds: Bounds,
	placement: LayoutCellPlacement,
): VectorNode => {
	const materialized = materializeLayoutChildIntoBounds(
		node,
		bounds,
		placement.fit,
	);
	if (
		deepEqual(node.geometry, materialized.geometry) &&
		deepEqual(node.transform, materialized.transform)
	) {
		return node;
	}
	return {
		...node,
		geometry: materialized.geometry,
		transform: materialized.transform,
	};
};

const positionOffset = (
	source: Transform,
	materialized: Transform,
): LayoutMotionPositionOffset => ({
	x: materialized.position.x - source.position.x,
	y: materialized.position.y - source.position.y,
});

const isZeroPositionOffset = (offset: LayoutMotionPositionOffset): boolean =>
	offset.x === 0 && offset.y === 0;

const recordPositionOffset = (
	output: Map<string, LayoutMotionPositionOffset>,
	node: VectorNode,
	materialized: VectorNode,
): void => {
	const offset = positionOffset(node.transform, materialized.transform);
	if (isZeroPositionOffset(offset)) return;
	output.set(node.id, offset);
};

/**
 * Resolves a node tree for render/export presentation without mutating the
 * stored scene. Layout frames keep their serial `frame.layout` intent, while
 * direct children are projected into the currently effective cells so renderers
 * no longer need a command-side reapply to see live layout geometry.
 */
export function materializeLayoutFrameNodeForPresentation(
	node: VectorNode,
): VectorNode {
	const children = node.children ?? [];
	const layoutSource =
		node.frame?.kind === "frame" &&
		node.frame.layout &&
		node.geometry.kind === "rect"
			? { layout: node.frame.layout, bounds: node.geometry.bounds }
			: undefined;
	const plan =
		layoutSource && children.length > 0
			? resolveLayoutFramePlan(
					layoutSource.bounds,
					layoutSource.layout,
					children.map((child) => child.id),
				)
			: null;
	const cellsByNodeId = new Map(
		plan?.cells.map((cell) => [cell.nodeId, cell] as const) ?? [],
	);
	const directChildren = plan
		? children.map((child) => {
				const cell = cellsByNodeId.get(child.id);
				return cell
					? materializeLayoutChildForPresentation(
							child,
							cell.bounds,
							cell.placement,
						)
					: child;
			})
		: children;

	const nestedChildren = directChildren.map((child) =>
		materializeLayoutFrameNodeForPresentation(child),
	);
	const childrenChanged =
		nestedChildren.length !== children.length ||
		nestedChildren.some((child, index) => child !== children[index]);

	if (!childrenChanged) return node;
	return {
		...node,
		...(nestedChildren.length > 0
			? { children: nestedChildren }
			: node.children
				? { children: [] }
				: {}),
	};
}

const materializeLayoutFrameNodeForMotionPresentation = (
	node: VectorNode,
	positionOffsets: Map<string, LayoutMotionPositionOffset>,
): VectorNode => {
	const children = node.children ?? [];
	const layoutSource =
		node.frame?.kind === "frame" &&
		node.frame.layout &&
		node.geometry.kind === "rect"
			? { layout: node.frame.layout, bounds: node.geometry.bounds }
			: undefined;
	const plan =
		layoutSource && children.length > 0
			? resolveLayoutFramePlan(
					layoutSource.bounds,
					layoutSource.layout,
					children.map((child) => child.id),
				)
			: null;
	const cellsByNodeId = new Map(
		plan?.cells.map((cell) => [cell.nodeId, cell] as const) ?? [],
	);
	const directChildren = plan
		? children.map((child) => {
				const cell = cellsByNodeId.get(child.id);
				if (!cell) return child;
				const materialized = materializeLayoutChildForPresentation(
					child,
					cell.bounds,
					cell.placement,
				);
				recordPositionOffset(positionOffsets, child, materialized);
				return materialized;
			})
		: children;

	const nestedChildren = directChildren.map((child) =>
		materializeLayoutFrameNodeForMotionPresentation(child, positionOffsets),
	);
	const childrenChanged =
		nestedChildren.length !== children.length ||
		nestedChildren.some((child, index) => child !== children[index]);

	if (!childrenChanged) return node;
	return {
		...node,
		...(nestedChildren.length > 0
			? { children: nestedChildren }
			: node.children
				? { children: [] }
				: {}),
	};
};

/**
 * Projects every layout frame in a scene into render/export geometry while
 * preserving source-document identity when no layout frame changed.
 */
export function materializeLayoutFramesForPresentation(
	scene: SceneDocument,
): SceneDocument {
	const cached = renderPresentationCache.get(scene);
	if (cached) return cached;
	let changed = false;
	const layers = scene.layers.map((layer) => {
		const nodes = layer.nodes.map((node) =>
			materializeLayoutFrameNodeForPresentation(node),
		);
		if (nodes.some((node, index) => node !== layer.nodes[index])) {
			changed = true;
			return { ...layer, nodes };
		}
		return layer;
	});
	const materialized = changed ? { ...scene, layers } : scene;
	renderPresentationCache.set(scene, materialized);
	return materialized;
}

/**
 * Projects layout frames for motion sampling and reports each direct
 * layout-managed child's position delta from authored rest to resolved cell rest.
 * Motion sampling uses that delta only for x/y tracks so child motion can ride on
 * the current cell without rewriting stored keyframes.
 */
export function materializeLayoutFramesForMotionPresentation(
	scene: SceneDocument,
): LayoutMotionPresentation {
	const cached = motionPresentationCache.get(scene);
	if (cached) return cached;
	let changed = false;
	const positionOffsets = new Map<string, LayoutMotionPositionOffset>();
	const layers = scene.layers.map((layer) => {
		const nodes = layer.nodes.map((node) =>
			materializeLayoutFrameNodeForMotionPresentation(node, positionOffsets),
		);
		if (nodes.some((node, index) => node !== layer.nodes[index])) {
			changed = true;
			return { ...layer, nodes };
		}
		return layer;
	});
	const materialized = {
		scene: changed ? { ...scene, layers } : scene,
		positionOffsets,
	};
	motionPresentationCache.set(scene, materialized);
	return materialized;
}
