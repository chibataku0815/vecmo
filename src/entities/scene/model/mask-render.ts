import {
	type AppearanceMaskChannel,
	type AppearanceMaskCoordinateSpace,
	type AppearanceMaskRelationKind,
	type AppearanceMaskRelationMetadata,
	type AppearanceMaskSourceSampling,
	readAppearanceMaskRelations,
} from "./appearance";
import {
	composeMatrix,
	IDENTITY_MATRIX,
	invertMatrix,
	matrixFromTransform,
	transformWithPresentationMatrix,
} from "./rendering";
import { allNodes, selectArtboardIdForNode } from "./selectors";
import { resolveNodeStyle } from "./style-resolve";
import type {
	BezierShape,
	NodeGeometry,
	SceneDocument,
	VectorNode,
} from "./types";

/**
 * How a representable mask relation is emitted by a renderer adapter:
 * - `clip`: a hard silhouette clip (SVG `<clipPath>`); faithful for `clip-path`.
 * - `alpha-mask`: an SVG `<mask>` carrying either alpha coverage or the admitted
 *   solid-fill pre-effect luminance source. Unsupported source pixels remain a
 *   typed relation issue instead of a misleading approximation.
 */
export type MaskRenderMode = "clip" | "alpha-mask";

/**
 * Geometry kinds usable as a mask source silhouette in the minimal tier. Lines
 * have no area, and text/image/group sources need glyph outlines or luminance
 * rasterization that the minimal contract defers to a typed issue.
 */
const SUPPORTED_MASK_SOURCE_KINDS: ReadonlySet<VectorNode["geometry"]["kind"]> =
	new Set(["rect", "ellipse", "polygon", "star", "path"]);

/**
 * A representable mask shared by every content node that references one source.
 * `maskNode` is the resolved source from the SAME (already motion-sampled) scene
 * the adapter renders, so an animated mask silhouette tracks the content exactly.
 */
export type ResolvedMaskDef = {
	readonly key: string;
	readonly domId: string;
	readonly mode: MaskRenderMode;
	readonly relationKind: AppearanceMaskRelationKind;
	readonly relationId: string;
	readonly maskNodeId: string;
	readonly maskNode: VectorNode;
	/** Flattened pre-effect vector source subtree in the content-parent space. */
	readonly maskNodes: readonly VectorNode[];
	/** Existing direct GPU stencil subset: one top-level source/content sibling. */
	readonly directGpuCompatible: boolean;
	readonly layerId: string;
	readonly artboardId: string;
	readonly featherRadius: number;
	/** Mask coverage multiplier, `0..1`; `1` = fully opaque (default). */
	readonly opacity: number;
	/** Signed silhouette choke/spread in scene px; `>0` dilates, `<0` erodes. */
	readonly expand: number;
	/** When true the mask shows content OUTSIDE the silhouette (inverted alpha). */
	readonly invert: boolean;
	readonly channel?: AppearanceMaskChannel;
	readonly sourceSampling?: AppearanceMaskSourceSampling;
	readonly coordinateSpace?: AppearanceMaskCoordinateSpace;
};

/** One clip/mask application a content node must receive when it is rendered. */
export type ResolvedMaskApplication = {
	readonly contentNodeId: string;
	readonly defKey: string;
	readonly domId: string;
	readonly maskNodeId: string;
	readonly mode: MaskRenderMode;
	readonly relationId: string;
	readonly featherRadius: number;
	readonly channel?: AppearanceMaskChannel;
};

/**
 * Returns whether a resolved mask application is a binary, fully opaque
 * silhouette that can be represented by a hard clip test. This includes true
 * `clip-path` relations and authoring `mask` relations whose alpha output is
 * still identical to a white hard silhouette because no feather, opacity,
 * expand, or invert setting is active.
 */
export const maskApplicationUsesHardSilhouette = (
	application: ResolvedMaskApplication,
	def: ResolvedMaskDef | undefined,
): boolean =>
	(application.mode === "clip" &&
		(application.channel ?? "alpha") === "alpha") ||
	(application.mode === "alpha-mask" &&
		(application.channel ?? "alpha") === "alpha" &&
		def !== undefined &&
		def.featherRadius === 0 &&
		def.opacity === 1 &&
		def.expand === 0 &&
		!def.invert);

/** Why a mask relation could not be represented in the minimal render tier. */
export type MaskUnrepresentedReason =
	| "no-mask-node"
	| "mask-node-missing"
	| "mask-node-not-sibling"
	| "mask-node-not-same-artboard"
	| "mask-geometry-unsupported"
	| "mask-kind-unsupported"
	| "mask-source-sampling-unsupported"
	| "mask-luminance-paint-unsupported"
	| "mask-chain-unsupported";

/**
 * A mask relation the adapter must fall back on (render the content unclipped)
 * while emitting a typed issue. Only top-level relations are classified here;
 * nested-node relations are out of the minimal representable scope by definition,
 * so adapters fall those back the same way without a descriptor entry.
 */
export type UnrepresentedMaskRelation = {
	readonly contentNodeId: string;
	readonly layerId: string;
	readonly relationId: string;
	readonly reason: MaskUnrepresentedReason;
};

/**
 * Renderer-neutral resolution of a scene's mask relations.
 *
 * Z-order / selection / export semantics this descriptor makes explicit:
 * - A mask SOURCE node is CONSUMED: when its silhouette clips content, the
 *   source itself is not painted as ordinary geometry (matching Figma/Illustrator
 *   "use as mask"). It remains an ordinary, selectable scene node in the document.
 * - Masked CONTENT keeps its own z-order; each affected node receives the clip.
 * - Representation is reference-based and order-independent, so it does not depend
 *   on the source being physically reordered above the content.
 *
 * Representability requires the mask source to be a TOP-LEVEL sibling of the
 * content in the SAME layer and SAME artboard with a supported area geometry.
 * That invariant keeps the clip resolvable in artboard space (layers carry no
 * transform), so adapters can apply it on an untransformed wrapper without
 * double-applying the source transform.
 */
export type SceneMaskPlan = {
	readonly defs: readonly ResolvedMaskDef[];
	readonly applicationsByContentNodeId: ReadonlyMap<
		string,
		readonly ResolvedMaskApplication[]
	>;
	readonly representedRelationIds: ReadonlySet<string>;
	readonly consumedMaskNodeIds: ReadonlySet<string>;
	readonly unrepresented: readonly UnrepresentedMaskRelation[];
};

const featherRadiusForRelation = (
	relation: AppearanceMaskRelationMetadata,
): number => {
	const featherRadius = relation.settings?.featherRadius ?? 0;
	return Number.isFinite(featherRadius) && featherRadius > 0
		? featherRadius
		: 0;
};

const opacityForRelation = (
	relation: AppearanceMaskRelationMetadata,
): number => {
	const opacity = relation.settings?.opacity ?? 1;
	if (!Number.isFinite(opacity)) return 1;
	return Math.min(1, Math.max(0, opacity));
};

const expandForRelation = (
	relation: AppearanceMaskRelationMetadata,
): number => {
	const expand = relation.settings?.expand ?? 0;
	return Number.isFinite(expand) ? expand : 0;
};

const invertForRelation = (relation: AppearanceMaskRelationMetadata): boolean =>
	relation.settings?.invert === true;

const channelForRelation = (
	relation: AppearanceMaskRelationMetadata,
): AppearanceMaskChannel => relation.settings?.channel ?? "alpha";

/** Returns exact sRGB channel coverage for admitted hex solid paints. */
export function maskSolidPaintChannelCoverage(
	color: string,
	channel: "red" | "green" | "blue",
): number | null {
	const raw = color.trim().replace(/^#/, "");
	const normalized =
		raw.length === 3
			? raw
					.split("")
					.map((entry) => `${entry}${entry}`)
					.join("")
			: raw;
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
	const index = channel === "red" ? 0 : channel === "green" ? 2 : 4;
	return Number.parseInt(normalized.slice(index, index + 2), 16) / 255;
}

const sourceSamplingForRelation = (
	relation: AppearanceMaskRelationMetadata,
): AppearanceMaskSourceSampling =>
	relation.settings?.sourceSampling ?? "pre-effects";

const coordinateSpaceForRelation = (
	relation: AppearanceMaskRelationMetadata,
): AppearanceMaskCoordinateSpace =>
	relation.settings?.coordinateSpace ?? "artboard";

/**
 * Whether a relation carries any non-default soft setting. A relation with all
 * defaults (no feather, full opacity, no expand, no invert) renders as the hard
 * `clip`/`mask` baseline; any soft setting forces the representable output to an
 * alpha mask with a filter chain.
 */
const hasSoftMaskSettings = (
	featherRadius: number,
	opacity: number,
	expand: number,
	invert: boolean,
): boolean => featherRadius > 0 || opacity < 1 || expand !== 0 || invert;

const modeForRelation = (
	relation: AppearanceMaskRelationMetadata,
): MaskRenderMode | null => {
	if (channelForRelation(relation) === "luminance") return "alpha-mask";
	if (channelForRelation(relation) !== "alpha") return "alpha-mask";
	const soft = hasSoftMaskSettings(
		featherRadiusForRelation(relation),
		opacityForRelation(relation),
		expandForRelation(relation),
		invertForRelation(relation),
	);
	if (relation.kind === "clip-path") {
		return soft ? "alpha-mask" : "clip";
	}
	if (relation.kind === "mask") return "alpha-mask";
	return null;
};

const hashString = (value: string): string => {
	let hash = 2_166_136_261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0).toString(36);
};

const idSegment = (value: string): string => {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized.length > 0 ? normalized.slice(0, 48) : "mask";
};

const normalizedFeatherKey = (featherRadius: number): string =>
	featherRadius > 0 ? Number(featherRadius.toFixed(3)).toString() : "0";

const defKeyFor = (
	mode: MaskRenderMode,
	maskNodeId: string,
	featherRadius: number,
	channel: AppearanceMaskChannel,
): string => {
	if (featherRadius <= 0) return `${mode}\u0000${maskNodeId}\u0000${channel}`;
	return [mode, maskNodeId, channel, normalizedFeatherKey(featherRadius)].join(
		"\u0000",
	);
};

/**
 * Identity suffix for the non-feather soft settings, appended to the base def key
 * only when present. Empty for all-default and feather-only masks so their keys /
 * DOM ids stay byte-identical to the pre-settings output; otherwise it makes the
 * same source with different opacity/expand/invert resolve to distinct defs.
 */
const extraSoftMaskKey = (
	opacity: number,
	expand: number,
	invert: boolean,
): string => {
	const parts: string[] = [];
	if (opacity < 1) parts.push(`o${Number(opacity.toFixed(3))}`);
	if (expand !== 0) parts.push(`e${Number(expand.toFixed(3))}`);
	if (invert) parts.push("i");
	return parts.join("|");
};

const domIdForDef = (
	mode: MaskRenderMode,
	maskNodeId: string,
	hasSoftSettings: boolean,
	key: string,
): string => {
	const prefix = mode === "clip" ? "mask-clip" : "mask-alpha";
	const sourceSegment = idSegment(maskNodeId);
	if (!hasSoftSettings) return `${prefix}-${sourceSegment}`;
	return `${prefix}-${sourceSegment}-${hashString(key)}`;
};

/**
 * Ordered alpha-mask filter primitives derived from a representable def. The list
 * is empty for an all-default (hard) mask and exactly one Gaussian blur for a
 * feather-only mask, so existing output is unchanged; new settings append in the
 * order morphology -> blur -> invert -> opacity. The first emitted primitive
 * reads `SourceGraphic`; the rest chain implicitly. Both the editor canvas and
 * the SVG exporter map this single description to their own markup so live and
 * exported masks stay identical.
 */
export type MaskFilterPrimitive =
	| {
			readonly kind: "morphology";
			readonly operator: "dilate" | "erode";
			readonly radius: number;
	  }
	| { readonly kind: "blur"; readonly stdDeviation: number }
	| { readonly kind: "invert-alpha" }
	| { readonly kind: "invert-luminance" }
	| { readonly kind: "opacity"; readonly value: number };

export const maskFilterPrimitives = (
	def: ResolvedMaskDef,
): readonly MaskFilterPrimitive[] => {
	const list: MaskFilterPrimitive[] = [];
	if (def.expand !== 0)
		list.push({
			kind: "morphology",
			operator: def.expand > 0 ? "dilate" : "erode",
			radius: Math.abs(def.expand),
		});
	if (def.featherRadius > 0)
		list.push({ kind: "blur", stdDeviation: def.featherRadius / 2 });
	if (def.invert)
		list.push({
			kind:
				(def.channel ?? "alpha") === "luminance"
					? "invert-luminance"
					: "invert-alpha",
		});
	if (def.opacity < 1) list.push({ kind: "opacity", value: def.opacity });
	return list;
};

/**
 * Outward filter-region padding for a mask def: the blur reach (`3 * sigma`) plus
 * any outward dilation. Erode (`expand < 0`) shrinks inward and adds none, and a
 * feather-only mask keeps its existing `3 * sigma` padding exactly.
 */
export const maskFilterPadding = (def: ResolvedMaskDef): number =>
	Math.max(0, def.expand) + (def.featherRadius / 2) * 3;

const compareStrings = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

const isFinitePair = (pair: readonly [number, number] | undefined): boolean =>
	pair !== undefined && Number.isFinite(pair[0]) && Number.isFinite(pair[1]);

const isFiniteVec = (point: {
	readonly x: number;
	readonly y: number;
}): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * Whether a path shape can produce a non-empty clip silhouette. Mirrors the SVG
 * exporter's renderable-shape guard (matching vertex/tangent arrays, all finite)
 * and additionally requires at least two vertices so a single-point path cannot
 * become an empty `<clipPath>` that would clip all content away.
 */
const isRenderableMaskShape = (shape: BezierShape): boolean =>
	shape.vertices.length >= 2 &&
	shape.inTangents.length === shape.vertices.length &&
	shape.outTangents.length === shape.vertices.length &&
	shape.vertices.every(isFinitePair) &&
	shape.inTangents.every(isFinitePair) &&
	shape.outTangents.every(isFinitePair);

/**
 * Whether a mask source geometry yields a non-degenerate clip region. A zero-area
 * or empty silhouette is rejected so a consumed mask source never produces an
 * empty `<clipPath>`/`<mask>` that would silently clip its content to nothing.
 */
const isRenderableMaskSilhouette = (geometry: NodeGeometry): boolean => {
	switch (geometry.kind) {
		case "rect":
		case "ellipse":
			return (
				Number.isFinite(geometry.bounds.width) &&
				Number.isFinite(geometry.bounds.height) &&
				geometry.bounds.width > 0 &&
				geometry.bounds.height > 0
			);
		case "polygon":
			return geometry.points.length >= 3 && geometry.points.every(isFiniteVec);
		case "star":
			return (
				geometry.points >= 2 &&
				Number.isFinite(geometry.outerRadius) &&
				geometry.outerRadius > 0 &&
				isFiniteVec(geometry.center)
			);
		case "path":
			return isRenderableMaskShape(geometry.shape);
		default:
			return false;
	}
};

type ClassifyResult =
	| { readonly status: "representable"; readonly mode: MaskRenderMode }
	| {
			readonly status: "unrepresented";
			readonly reason: MaskUnrepresentedReason;
	  };

const classifyRelation = (
	relation: AppearanceMaskRelationMetadata,
	contentArtboardId: string | undefined,
	contentNodeId: string,
	maskNode: VectorNode | undefined,
	maskArtboardId: string | undefined,
	allNodeIds: ReadonlySet<string>,
	maskNodes: readonly VectorNode[],
): ClassifyResult => {
	if (!relation.maskNodeId) {
		return { status: "unrepresented", reason: "no-mask-node" };
	}
	// A node cannot meaningfully be its own clip source: consuming it would skip
	// the only painted content. Treat as geometry-unsupported rather than represent.
	if (relation.maskNodeId === contentNodeId) {
		return { status: "unrepresented", reason: "mask-geometry-unsupported" };
	}
	if (!maskNode) {
		return {
			status: "unrepresented",
			reason: allNodeIds.has(relation.maskNodeId)
				? "mask-geometry-unsupported"
				: "mask-node-missing",
		};
	}
	if (
		!contentArtboardId ||
		!maskArtboardId ||
		maskArtboardId !== contentArtboardId
	) {
		return { status: "unrepresented", reason: "mask-node-not-same-artboard" };
	}
	if (
		maskNodes.length === 0 ||
		maskNodes.some(
			(candidate) =>
				!SUPPORTED_MASK_SOURCE_KINDS.has(candidate.geometry.kind) ||
				!isRenderableMaskSilhouette(candidate.geometry),
		)
	) {
		return { status: "unrepresented", reason: "mask-geometry-unsupported" };
	}
	if (sourceSamplingForRelation(relation) === "post-effects") {
		return {
			status: "unrepresented",
			reason: "mask-source-sampling-unsupported",
		};
	}
	if (channelForRelation(relation) !== "alpha") {
		if (
			maskNodes.some((candidate) => {
				const style = resolveNodeStyle(candidate.style);
				return style.fills.length !== 1 || style.fills[0]?.kind !== "solid";
			})
		) {
			return {
				status: "unrepresented",
				reason: "mask-luminance-paint-unsupported",
			};
		}
		const channel = channelForRelation(relation);
		if (
			(channel === "red" || channel === "green" || channel === "blue") &&
			maskNodes.some((candidate) => {
				const paint = resolveNodeStyle(candidate.style).fills[0];
				return (
					paint?.kind !== "solid" ||
					maskSolidPaintChannelCoverage(paint.color, channel) === null
				);
			})
		) {
			return {
				status: "unrepresented",
				reason: "mask-luminance-paint-unsupported",
			};
		}
	}
	const mode = modeForRelation(relation);
	if (!mode)
		return { status: "unrepresented", reason: "mask-kind-unsupported" };
	return { status: "representable", mode };
};

/**
 * Resolves all native/imported mask relations in a scene into a representable
 * clip/mask plan plus a typed list of relations that must fall back. The input
 * should be the renderer-facing (already motion-sampled) scene so resolved mask
 * sources match the geometry the adapter paints.
 */
export function resolveSceneMaskPlan(scene: SceneDocument): SceneMaskPlan {
	type IndexedNode = {
		readonly node: VectorNode;
		readonly layerId: string;
		readonly parentWorld: ReturnType<typeof matrixFromTransform>;
		readonly world: ReturnType<typeof matrixFromTransform>;
		readonly opacity: number;
		readonly visible: boolean;
	};
	const nodeById = new Map<string, IndexedNode>();
	for (const layer of scene.layers) {
		const visit = (
			node: VectorNode,
			parentWorld: ReturnType<typeof matrixFromTransform>,
			parentOpacity: number,
			parentVisible: boolean,
		): void => {
			const world = composeMatrix(
				parentWorld,
				matrixFromTransform(node.transform),
			);
			const opacity = parentOpacity * resolveNodeStyle(node.style).opacity;
			const visible = parentVisible && node.visible;
			nodeById.set(node.id, {
				node,
				layerId: layer.id,
				parentWorld,
				world,
				opacity,
				visible,
			});
			for (const child of node.children ?? [])
				visit(child, world, opacity, visible);
		};
		for (const node of layer.nodes)
			visit(node, IDENTITY_MATRIX, 1, layer.visible);
	}
	const allNodeIds = new Set(allNodes(scene).map((node) => node.id));
	const sourceLeaves = (root: VectorNode): readonly IndexedNode[] => {
		const leaves: IndexedNode[] = [];
		const visit = (node: VectorNode): void => {
			const indexed = nodeById.get(node.id);
			if (!indexed?.visible) return;
			if (node.children && node.children.length > 0) {
				for (const child of node.children) visit(child);
				return;
			}
			leaves.push(indexed);
		};
		visit(root);
		return leaves;
	};

	const unrepresented: UnrepresentedMaskRelation[] = [];

	// Pass 1: classify every relation; collect representable candidates separately
	// so a second pass can reject chains (a mask source that is itself masked, or a
	// content node that is itself a mask source) which the minimal tier cannot
	// compose. Without that pass a chained mask either drops the inner clip silently
	// or over-shows the outer one.
	type MaskCandidate = {
		readonly contentNodeId: string;
		readonly layerId: string;
		readonly relation: AppearanceMaskRelationMetadata;
		readonly maskNode: VectorNode;
		readonly maskNodes: readonly VectorNode[];
		readonly mode: MaskRenderMode;
		readonly featherRadius: number;
		readonly opacity: number;
		readonly expand: number;
		readonly invert: boolean;
		readonly channel: AppearanceMaskChannel;
		readonly sourceSampling: AppearanceMaskSourceSampling;
		readonly coordinateSpace: AppearanceMaskCoordinateSpace;
		readonly artboardId: string;
		readonly directGpuCompatible: boolean;
	};
	const candidates: MaskCandidate[] = [];

	for (const layer of scene.layers) {
		const visitContent = (contentNode: VectorNode): void => {
			const contentIndex = nodeById.get(contentNode.id);
			if (!contentIndex) return;
			const contentArtboardId = selectArtboardIdForNode(scene, contentNode.id);
			for (const relation of readAppearanceMaskRelations(contentNode)) {
				const maskIndex = relation.maskNodeId
					? nodeById.get(relation.maskNodeId)
					: undefined;
				const maskNode = maskIndex?.node;
				const maskArtboardId = relation.maskNodeId
					? selectArtboardIdForNode(scene, relation.maskNodeId)
					: undefined;
				const inverseContentParent = invertMatrix(contentIndex.parentWorld);
				const maskNodes =
					maskNode && inverseContentParent
						? sourceLeaves(maskNode).map((leaf) => {
								const matrix = composeMatrix(inverseContentParent, leaf.world);
								return {
									...leaf.node,
									style: { ...leaf.node.style, opacity: leaf.opacity },
									transform: transformWithPresentationMatrix(
										matrix,
										leaf.node.transform.anchor,
									),
								};
							})
						: [];
				const result = classifyRelation(
					relation,
					contentArtboardId,
					contentNode.id,
					maskNode,
					maskArtboardId,
					allNodeIds,
					maskNodes,
				);
				if (result.status === "unrepresented") {
					unrepresented.push({
						contentNodeId: contentNode.id,
						layerId: contentIndex.layerId,
						relationId: relation.id,
						reason: result.reason,
					});
					continue;
				}
				// classifyRelation only returns "representable" with a resolved sibling
				// mask node, so this assertion holds for every representable branch.
				if (!maskNode) continue;
				candidates.push({
					contentNodeId: contentNode.id,
					layerId: contentIndex.layerId,
					relation,
					maskNode,
					maskNodes,
					directGpuCompatible:
						maskNodes.length === 1 &&
						maskIndex?.parentWorld === IDENTITY_MATRIX &&
						contentIndex.parentWorld === IDENTITY_MATRIX &&
						maskIndex.layerId === contentIndex.layerId,
					mode: result.mode,
					featherRadius: featherRadiusForRelation(relation),
					opacity: opacityForRelation(relation),
					expand: expandForRelation(relation),
					invert: invertForRelation(relation),
					channel: channelForRelation(relation),
					sourceSampling: sourceSamplingForRelation(relation),
					coordinateSpace: coordinateSpaceForRelation(relation),
					artboardId: contentArtboardId ?? "",
				});
			}
			for (const child of contentNode.children ?? []) visitContent(child);
		};
		for (const contentNode of layer.nodes) visitContent(contentNode);
	}

	const candidateMaskNodeIds = new Set(
		candidates.map((candidate) => candidate.maskNode.id),
	);
	const candidateContentNodeIds = new Set(
		candidates.map((candidate) => candidate.contentNodeId),
	);

	const defsByKey = new Map<string, ResolvedMaskDef>();
	const applicationsByContentNodeId = new Map<
		string,
		ResolvedMaskApplication[]
	>();
	const representedRelationIds = new Set<string>();
	const consumedMaskNodeIds = new Set<string>();

	// Pass 2: finalize candidates that are not part of a mask chain.
	for (const candidate of candidates) {
		const partOfChain =
			candidateContentNodeIds.has(candidate.maskNode.id) ||
			candidateMaskNodeIds.has(candidate.contentNodeId);
		if (partOfChain) {
			unrepresented.push({
				contentNodeId: candidate.contentNodeId,
				layerId: candidate.layerId,
				relationId: candidate.relation.id,
				reason: "mask-chain-unsupported",
			});
			continue;
		}
		const baseKey = defKeyFor(
			candidate.mode,
			candidate.maskNode.id,
			candidate.featherRadius,
			candidate.channel,
		);
		const extraKey = extraSoftMaskKey(
			candidate.opacity,
			candidate.expand,
			candidate.invert,
		);
		const key = extraKey === "" ? baseKey : `${baseKey}|${extraKey}`;
		const scopedKey = `${key}|content:${candidate.contentNodeId}`;
		const hasSoft =
			candidate.channel !== "alpha" ||
			hasSoftMaskSettings(
				candidate.featherRadius,
				candidate.opacity,
				candidate.expand,
				candidate.invert,
			);
		const domId = domIdForDef(
			candidate.mode,
			candidate.maskNode.id,
			hasSoft,
			scopedKey,
		);
		if (!defsByKey.has(scopedKey)) {
			defsByKey.set(scopedKey, {
				key: scopedKey,
				domId,
				mode: candidate.mode,
				relationKind: candidate.relation.kind,
				relationId: candidate.relation.id,
				maskNodeId: candidate.maskNode.id,
				maskNode: candidate.maskNode,
				maskNodes: candidate.maskNodes,
				directGpuCompatible: candidate.directGpuCompatible,
				layerId: candidate.layerId,
				artboardId: candidate.artboardId,
				featherRadius: candidate.featherRadius,
				opacity: candidate.opacity,
				expand: candidate.expand,
				invert: candidate.invert,
				channel: candidate.channel,
				sourceSampling: candidate.sourceSampling,
				coordinateSpace: candidate.coordinateSpace,
			});
		}
		const applications =
			applicationsByContentNodeId.get(candidate.contentNodeId) ?? [];
		applications.push({
			contentNodeId: candidate.contentNodeId,
			defKey: scopedKey,
			domId,
			maskNodeId: candidate.maskNode.id,
			mode: candidate.mode,
			relationId: candidate.relation.id,
			featherRadius: candidate.featherRadius,
			channel: candidate.channel,
		});
		applicationsByContentNodeId.set(candidate.contentNodeId, applications);
		representedRelationIds.add(candidate.relation.id);
		consumedMaskNodeIds.add(candidate.maskNode.id);
	}

	for (const applications of applicationsByContentNodeId.values()) {
		applications.sort((left, right) =>
			compareStrings(left.defKey, right.defKey),
		);
	}
	const defs = [...defsByKey.values()].sort((left, right) =>
		compareStrings(left.key, right.key),
	);

	return {
		defs,
		applicationsByContentNodeId,
		representedRelationIds,
		consumedMaskNodeIds,
		unrepresented,
	};
}
