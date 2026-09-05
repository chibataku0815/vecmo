import { createId } from "@/shared/lib/id";
import { cloneSceneDocument } from "./factory";
import { remapClonedMotionParentBindings } from "./motion-relations";
import { normalizeTextContent } from "./rendering";
import {
	allNodes,
	findArtboardById,
	findLayerByNodeId,
	findNode,
	selectArtboardIdForNode,
} from "./selectors";
import type {
	BlendMode,
	Bounds,
	ComponentInstanceBinding,
	ComponentNodeOverride,
	ComponentSymbol,
	Effect,
	NodeStyle,
	Paint,
	SceneDocument,
	SceneLayer,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	TextAlign,
	TextStyle,
	Transform,
	Vec2,
	VectorNode,
} from "./types";

/**
 * Pure component-symbol model. Sources and instances remain ordinary scene
 * nodes; this file owns the optional additive library/binding contract that
 * future UI, import/export adapters, and agent workflows can share without
 * embedding component behavior into render paths.
 */

const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
const BLEND_MODES: readonly BlendMode[] = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
];
const STROKE_ALIGNS: readonly StrokeAlign[] = ["inside", "center", "outside"];
const STROKE_CAPS: readonly StrokeCap[] = ["butt", "round", "square"];
const STROKE_JOINS: readonly StrokeJoin[] = ["miter", "round", "bevel"];

const normalizedLabel = (value: string | undefined): string | null => {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
};

const uniqueLabel = (
	existing: ReadonlySet<string>,
	base: string,
	separator: string,
): string => {
	if (!existing.has(base)) return base;
	let suffix = 2;
	let candidate = `${base}${separator}${suffix}`;
	while (existing.has(candidate)) {
		suffix += 1;
		candidate = `${base}${separator}${suffix}`;
	}
	return candidate;
};

const finiteNumber = (value: number | undefined): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const isOneOf = <Value extends string>(
	values: readonly Value[],
	value: string | undefined,
): value is Value =>
	typeof value === "string" && values.includes(value as Value);

const normalizeVec2 = (value: Vec2 | undefined): Vec2 | null => {
	const x = finiteNumber(value?.x);
	const y = finiteNumber(value?.y);
	return x === null || y === null ? null : { x, y };
};

const normalizeBounds = (value: Bounds | undefined): Bounds | null => {
	const x = finiteNumber(value?.x);
	const y = finiteNumber(value?.y);
	const width = finiteNumber(value?.width);
	const height = finiteNumber(value?.height);
	if (x === null || y === null || width === null || height === null)
		return null;
	return { x, y, width, height };
};

const normalizeStrokeDashPatch = (
	strokeDash: readonly number[] | undefined,
): readonly number[] | null => {
	if (!Array.isArray(strokeDash)) return null;
	return strokeDash
		.map((value) => Math.max(0, finiteNumber(value) ?? 0))
		.filter((value) => value > 0);
};

const normalizePositiveWithFallback = (
	value: number | undefined,
	fallback: number,
): number | null => {
	const finite = finiteNumber(value);
	if (finite === null) return null;
	return finite > 0 ? finite : fallback;
};

const normalizeStylePatch = (
	style: Partial<NodeStyle> | undefined,
): Partial<NodeStyle> | null => {
	if (!style) return null;
	const next: { -readonly [K in keyof NodeStyle]?: NodeStyle[K] } = {};
	if (typeof style.fill === "string") next.fill = style.fill;
	if (typeof style.stroke === "string") next.stroke = style.stroke;
	if (finiteNumber(style.strokeWidth) !== null) {
		next.strokeWidth = Math.max(0, style.strokeWidth ?? 0);
	}
	if (finiteNumber(style.opacity) !== null) {
		next.opacity = Math.min(1, Math.max(0, style.opacity ?? 1));
	}
	if (Array.isArray(style.fills)) {
		next.fills = cloneSceneDocument(style.fills) as readonly Paint[];
	}
	if (Array.isArray(style.strokes)) {
		next.strokes = cloneSceneDocument(style.strokes) as readonly Paint[];
	}
	if (Array.isArray(style.effects)) {
		next.effects = cloneSceneDocument(style.effects) as readonly Effect[];
	}
	if (isOneOf(BLEND_MODES, style.blendMode)) {
		next.blendMode = style.blendMode;
	}
	if (isOneOf(STROKE_ALIGNS, style.strokeAlign)) {
		next.strokeAlign = style.strokeAlign;
	}
	const strokeDash = normalizeStrokeDashPatch(style.strokeDash);
	if (strokeDash) next.strokeDash = strokeDash;
	if (isOneOf(STROKE_CAPS, style.strokeCap)) {
		next.strokeCap = style.strokeCap;
	}
	if (isOneOf(STROKE_JOINS, style.strokeJoin)) {
		next.strokeJoin = style.strokeJoin;
	}
	const strokeMiterLimit = normalizePositiveWithFallback(
		style.strokeMiterLimit,
		4,
	);
	if (strokeMiterLimit !== null) {
		next.strokeMiterLimit = strokeMiterLimit;
	}
	return Object.keys(next).length > 0 ? next : null;
};

const normalizeTextStylePatch = (
	style: Partial<TextStyle> | undefined,
): Partial<TextStyle> | null => {
	if (!style) return null;
	const next: { -readonly [K in keyof TextStyle]?: TextStyle[K] } = {};
	const fontFamily = normalizedLabel(style.fontFamily);
	if (fontFamily) next.fontFamily = fontFamily;
	if (finiteNumber(style.fontSize) !== null && (style.fontSize ?? 0) > 0) {
		next.fontSize = style.fontSize;
	}
	if (finiteNumber(style.lineHeight) !== null && (style.lineHeight ?? 0) > 0) {
		next.lineHeight = style.lineHeight;
	}
	if (TEXT_ALIGNS.includes(style.align as TextAlign)) next.align = style.align;
	if (finiteNumber(style.fontWeight) !== null && (style.fontWeight ?? 0) > 0) {
		next.fontWeight = Math.round(style.fontWeight ?? 0);
	}
	return Object.keys(next).length > 0 ? next : null;
};

const normalizeTransformPatch = (
	transform: Partial<Transform> | undefined,
): Partial<Transform> | null => {
	if (!transform) return null;
	const next: { -readonly [K in keyof Transform]?: Transform[K] } = {};
	const position = normalizeVec2(transform.position);
	if (position) next.position = position;
	const anchor = normalizeVec2(transform.anchor);
	if (anchor) next.anchor = anchor;
	const scale = normalizeVec2(transform.scale);
	if (scale) next.scale = scale;
	if (finiteNumber(transform.rotation) !== null) {
		next.rotation = transform.rotation;
	}
	return Object.keys(next).length > 0 ? next : null;
};

const mergeTransform = (
	transform: Transform,
	patch: Partial<Transform> | undefined,
): Transform => ({
	...transform,
	...patch,
});

const collectNodeIds = (
	nodes: readonly VectorNode[],
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		output.push(node.id);
		if (node.children) collectNodeIds(node.children, output);
	}
	return output;
};

const nodeIdSet = (document: SceneDocument): Set<string> =>
	new Set(collectNodeIds(document.layers.flatMap((layer) => layer.nodes)));

const rootNodeIndex = (
	layer: SceneLayer,
	nodeId: string,
): number | undefined => {
	const index = layer.nodes.findIndex((node) => node.id === nodeId);
	return index >= 0 ? index : undefined;
};

const clampInsertIndex = (
	length: number,
	toIndex: number | undefined,
	fallback: number,
): number => {
	if (!Number.isInteger(toIndex))
		return Math.min(length, Math.max(0, fallback));
	return Math.min(length, Math.max(0, toIndex ?? fallback));
};

const cloneNodeWithRemappedIds = (
	node: VectorNode,
	options: {
		readonly usedIds: Set<string>;
		readonly idMap: Map<string, string>;
		readonly rootId?: string;
		readonly rootInstanceId: string;
		readonly artboardId?: string;
	},
): VectorNode => {
	const id =
		options.rootId ??
		uniqueLabel(options.usedIds, `${node.id}-${options.rootInstanceId}`, "-");
	options.usedIds.add(id);
	options.idMap.set(node.id, id);
	const children = node.children?.map((child) =>
		cloneNodeWithRemappedIds(child, { ...options, rootId: undefined }),
	);
	const cloned = cloneSceneDocument(node);
	const { component: _component, children: _children, ...rest } = cloned;
	const artboardId = options.artboardId ?? rest.artboardId;

	return {
		...rest,
		id,
		...(artboardId ? { artboardId } : {}),
		...(children ? { children } : {}),
	};
};

const sourceNodeIdForInstanceNode = (
	binding: ComponentInstanceBinding,
	instanceNodeId: string,
): string | undefined =>
	Object.entries(binding.sourceToInstanceNodeIds).find(
		([, mappedInstanceNodeId]) => mappedInstanceNodeId === instanceNodeId,
	)?.[0];

const sameOverrideTarget = (
	left: ComponentNodeOverride,
	right: ComponentNodeOverride,
): boolean =>
	left.kind === right.kind &&
	left.sourceNodeId === right.sourceNodeId &&
	left.instanceNodeId === right.instanceNodeId;

const sameOverride = (
	left: ComponentNodeOverride,
	right: ComponentNodeOverride,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const mergeComponentOverride = (
	previous: ComponentNodeOverride,
	next: ComponentNodeOverride,
): ComponentNodeOverride => {
	if (!sameOverrideTarget(previous, next)) return next;
	switch (next.kind) {
		case "name":
			return next;
		case "style": {
			if (previous.kind !== "style") return next;
			return {
				...next,
				style: { ...previous.style, ...next.style },
			};
		}
		case "transform": {
			if (previous.kind !== "transform") return next;
			return {
				...next,
				transform: { ...previous.transform, ...next.transform },
			};
		}
		case "text": {
			if (previous.kind !== "text") return next;
			return {
				...next,
				...(previous.text !== undefined || next.text !== undefined
					? { text: next.text ?? previous.text }
					: {}),
				...(previous.bounds || next.bounds
					? { bounds: next.bounds ?? previous.bounds }
					: {}),
				...(previous.style || next.style
					? { style: { ...previous.style, ...next.style } }
					: {}),
			};
		}
	}
};

/** Options for minting a component source library entry. */
export type CreateComponentSymbolOptions = {
	readonly id?: string;
	readonly name?: string;
};

/** Options for planning a new component instance clone. */
export type CreateComponentInstanceOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly layerId?: string;
	readonly artboardId?: string;
	readonly toIndex?: number;
	readonly transform?: Partial<Transform>;
};

/**
 * Snapshot-scoped plan for inserting a component instance. Future UI can use
 * `rootNode.id` or `newNodeIds` for selection immediately after applying the
 * matching command, while the command still owns the actual document mutation.
 */
export type ComponentInstancePlan = {
	readonly symbol: ComponentSymbol;
	readonly sourceNodeId: string;
	readonly layerId: string;
	readonly toIndex: number;
	readonly rootNode: VectorNode;
	readonly newNodeIds: readonly string[];
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
};

export type ComponentNodeOverrideInput =
	| {
			readonly kind: "name";
			readonly name: string;
	  }
	| {
			readonly kind: "style";
			readonly style: Partial<NodeStyle>;
	  }
	| {
			readonly kind: "transform";
			readonly transform: Partial<Transform>;
	  }
	| {
			readonly kind: "text";
			readonly text?: string;
			readonly bounds?: Bounds;
			readonly style?: Partial<TextStyle>;
	  };

export type ComponentInstanceNodeEntry = {
	readonly node: VectorNode;
	readonly binding: ComponentInstanceBinding;
};

/**
 * Resolved view of one tracked instance override. `stale` is true when the
 * stored id-map relation no longer resolves, allowing UI to surface cleanup
 * without inventing document migration rules.
 */
export type ComponentInstanceOverrideEntry = {
	readonly override: ComponentNodeOverride;
	readonly sourceNode?: VectorNode;
	readonly instanceNode?: VectorNode;
	readonly stale: boolean;
};

/** Filter for removing tracked component overrides from an instance binding. */
export type ComponentOverrideResetFilter = {
	readonly instanceNodeId?: string;
	readonly kind?: ComponentNodeOverride["kind"];
};

/**
 * Normalizes a component symbol record. Invalid blank identifiers are dropped so
 * read paths never need to branch on partially usable source definitions.
 */
export function normalizeComponentSymbol(
	symbol: ComponentSymbol | undefined,
): ComponentSymbol | null {
	if (!symbol) return null;
	const id = normalizedLabel(symbol.id);
	const name = normalizedLabel(symbol.name);
	const sourceNodeId = normalizedLabel(symbol.sourceNodeId);
	if (!id || !name || !sourceNodeId) return null;
	return { id, name, sourceNodeId };
}

/**
 * Reads the optional component-symbol library as a normalized array. Legacy
 * documents that omit `componentSymbols` read as empty; duplicate symbol ids or
 * duplicate source nodes keep the first valid entry to preserve stable ordering.
 */
export function readComponentSymbols(
	document: Pick<SceneDocument, "componentSymbols">,
): readonly ComponentSymbol[] {
	const symbols = document.componentSymbols;
	if (!symbols || symbols.length === 0) return [];
	const seenIds = new Set<string>();
	const seenSourceNodeIds = new Set<string>();
	const result: ComponentSymbol[] = [];
	for (const symbol of symbols) {
		const normalized = normalizeComponentSymbol(symbol);
		if (!normalized) continue;
		if (
			seenIds.has(normalized.id) ||
			seenSourceNodeIds.has(normalized.sourceNodeId)
		) {
			continue;
		}
		seenIds.add(normalized.id);
		seenSourceNodeIds.add(normalized.sourceNodeId);
		result.push(normalized);
	}
	return result;
}

/** Finds one component symbol by id from the normalized optional library. */
export function findComponentSymbol(
	document: Pick<SceneDocument, "componentSymbols">,
	symbolId: string | null | undefined,
): ComponentSymbol | undefined {
	if (!symbolId) return undefined;
	return readComponentSymbols(document).find(
		(symbol) => symbol.id === symbolId,
	);
}

/** Finds the component symbol whose source is the given scene node id. */
export function findComponentSymbolBySourceNodeId(
	document: Pick<SceneDocument, "componentSymbols">,
	sourceNodeId: string | null | undefined,
): ComponentSymbol | undefined {
	if (!sourceNodeId) return undefined;
	return readComponentSymbols(document).find(
		(symbol) => symbol.sourceNodeId === sourceNodeId,
	);
}

/**
 * Mints a normalized, collision-free component source for an existing node. A
 * node that is already a source, or an instance node, returns null so callers do
 * not create ambiguous source ownership.
 */
export function createComponentSymbol(
	existingSymbols: readonly ComponentSymbol[],
	sourceNode: VectorNode,
	options: CreateComponentSymbolOptions = {},
): ComponentSymbol | null {
	if (sourceNode.component?.kind === "instance") return null;
	if (existingSymbols.some((symbol) => symbol.sourceNodeId === sourceNode.id)) {
		return null;
	}

	const existingIds = new Set(existingSymbols.map((symbol) => symbol.id));
	const existingNames = new Set(existingSymbols.map((symbol) => symbol.name));
	const idBase = normalizedLabel(options.id) ?? createId("component");
	const nameBase =
		normalizedLabel(options.name) ?? `${sourceNode.name} component`;

	return {
		id: uniqueLabel(existingIds, idBase, "-"),
		name: uniqueLabel(existingNames, nameBase, " "),
		sourceNodeId: sourceNode.id,
	};
}

/**
 * Plans an instance clone from a source symbol. The cloned root carries the
 * instance binding and a complete source-to-instance id map; descendants remain
 * ordinary nodes with remapped ids so existing rendering and hit testing work
 * without component-aware branches.
 */
export function planComponentInstance(
	document: SceneDocument,
	symbolId: string,
	options: CreateComponentInstanceOptions = {},
): ComponentInstancePlan | null {
	const symbol = findComponentSymbol(document, symbolId);
	if (!symbol) return null;
	const sourceNode = findNode(document, symbol.sourceNodeId);
	if (!sourceNode || sourceNode.component?.kind === "instance") return null;

	const sourceLayer = findLayerByNodeId(document, sourceNode.id);
	const targetLayer =
		(options.layerId
			? document.layers.find((layer) => layer.id === options.layerId)
			: undefined) ??
		sourceLayer ??
		document.layers.at(-1);
	if (!targetLayer) return null;

	const usedIds = nodeIdSet(document);
	const idMap = new Map<string, string>();
	const rootIdBase = normalizedLabel(options.id) ?? `${sourceNode.id}-instance`;
	const rootId = uniqueLabel(usedIds, rootIdBase, "-");
	const rootName =
		normalizedLabel(options.name) ?? `${sourceNode.name} instance`;
	const requestedArtboardId =
		options.artboardId && findArtboardById(document, options.artboardId)
			? options.artboardId
			: undefined;
	const targetArtboardId =
		requestedArtboardId ?? selectArtboardIdForNode(document, sourceNode.id);
	const clonedRootBeforeRelations = cloneNodeWithRemappedIds(sourceNode, {
		usedIds,
		idMap,
		rootId,
		rootInstanceId: rootId,
		artboardId: targetArtboardId,
	});
	const clonedRoot =
		remapClonedMotionParentBindings([clonedRootBeforeRelations], idMap)
			.nodes[0] ?? clonedRootBeforeRelations;
	const sourceToInstanceNodeIds = Object.fromEntries(idMap.entries());
	const newNodeIds = [...idMap.values()];
	const sourceIndex =
		sourceLayer?.id === targetLayer.id
			? rootNodeIndex(targetLayer, sourceNode.id)
			: undefined;
	const fallbackIndex =
		sourceIndex === undefined ? targetLayer.nodes.length : sourceIndex + 1;
	const toIndex = clampInsertIndex(
		targetLayer.nodes.length,
		options.toIndex,
		fallbackIndex,
	);
	const rootNode: VectorNode = {
		...clonedRoot,
		id: rootId,
		name: rootName,
		artboardId: targetArtboardId,
		transform: mergeTransform(clonedRoot.transform, options.transform),
		component: {
			kind: "instance",
			symbolId: symbol.id,
			sourceNodeId: symbol.sourceNodeId,
			sourceToInstanceNodeIds,
		},
	};

	return {
		symbol,
		sourceNodeId: symbol.sourceNodeId,
		layerId: targetLayer.id,
		toIndex,
		rootNode,
		newNodeIds,
		sourceToInstanceNodeIds,
	};
}

/**
 * Returns a deep copy with all component bindings removed. Detach keeps the
 * current visible node data intact while severing source/instance semantics.
 */
export function detachComponentNode(node: VectorNode): VectorNode {
	const cloned = cloneSceneDocument(node);
	const { component: _component, children, ...rest } = cloned;
	return {
		...rest,
		...(children ? { children: children.map(detachComponentNode) } : {}),
	};
}

/**
 * Selects component instance roots from a scene snapshot. Consumers receive live
 * read-only node references plus their instance binding for compact panels or
 * future sync/override UI.
 */
export function selectComponentInstanceNodes(
	document: SceneDocument,
	symbolId?: string,
): readonly ComponentInstanceNodeEntry[] {
	return allNodes(document).flatMap((node) => {
		const binding = node.component;
		if (binding?.kind !== "instance") return [];
		if (symbolId && binding.symbolId !== symbolId) return [];
		return [{ node, binding }];
	});
}

const matchesComponentOverrideFilter = (
	override: ComponentNodeOverride,
	filter: ComponentOverrideResetFilter,
): boolean => {
	if (
		filter.instanceNodeId &&
		override.instanceNodeId !== filter.instanceNodeId
	) {
		return false;
	}
	if (filter.kind && override.kind !== filter.kind) return false;
	return true;
};

/**
 * Resolves tracked override metadata for one instance root into source and
 * instance nodes. Stale entries are kept visible instead of hidden so future
 * Inspector/Layers UI can offer reset or detach affordances without guessing.
 */
export function selectComponentInstanceOverrides(
	document: SceneDocument,
	instanceRootNodeId: string,
	filter: ComponentOverrideResetFilter = {},
): readonly ComponentInstanceOverrideEntry[] {
	const instanceRoot = findNode(document, instanceRootNodeId);
	const binding = instanceRoot?.component;
	if (binding?.kind !== "instance") return [];
	return (binding.overrides ?? [])
		.filter((override) => matchesComponentOverrideFilter(override, filter))
		.map((override) => {
			const sourceNode = findNode(document, override.sourceNodeId);
			const instanceNode = findNode(document, override.instanceNodeId);
			return {
				override,
				...(sourceNode ? { sourceNode } : {}),
				...(instanceNode ? { instanceNode } : {}),
				stale:
					binding.sourceToInstanceNodeIds[override.sourceNodeId] !==
						override.instanceNodeId ||
					!sourceNode ||
					!instanceNode,
			};
		});
}

/**
 * Plans override metadata for an instance node without mutating the scene. The
 * target must belong to the instance id map so future sync can relate the
 * override back to the source node it diverged from.
 */
export function planComponentNodeOverride(
	document: SceneDocument,
	instanceRootNodeId: string,
	instanceNodeId: string,
	input: ComponentNodeOverrideInput,
): ComponentNodeOverride | null {
	const instanceRoot = findNode(document, instanceRootNodeId);
	const binding = instanceRoot?.component;
	if (binding?.kind !== "instance") return null;
	const sourceNodeId = sourceNodeIdForInstanceNode(binding, instanceNodeId);
	if (!sourceNodeId) return null;
	const sourceNode = findNode(document, sourceNodeId);
	if (!sourceNode) return null;
	const targetNode = findNode(document, instanceNodeId);
	if (!targetNode) return null;

	switch (input.kind) {
		case "name": {
			const name = normalizedLabel(input.name);
			return name ? { kind: "name", sourceNodeId, instanceNodeId, name } : null;
		}
		case "style": {
			const style = normalizeStylePatch(input.style);
			return style
				? { kind: "style", sourceNodeId, instanceNodeId, style }
				: null;
		}
		case "transform": {
			const transform = normalizeTransformPatch(input.transform);
			return transform
				? { kind: "transform", sourceNodeId, instanceNodeId, transform }
				: null;
		}
		case "text": {
			if (
				sourceNode.geometry.kind !== "text" ||
				targetNode.geometry.kind !== "text"
			) {
				return null;
			}
			const text =
				input.text === undefined ? undefined : normalizeTextContent(input.text);
			const bounds = normalizeBounds(input.bounds);
			const style = normalizeTextStylePatch(input.style);
			if (text === undefined && !bounds && !style) return null;
			return {
				kind: "text",
				sourceNodeId,
				instanceNodeId,
				...(text !== undefined ? { text } : {}),
				...(bounds ? { bounds } : {}),
				...(style ? { style } : {}),
			};
		}
	}
}

/**
 * Adds or replaces one override on an instance binding. The returned reference
 * is unchanged when the existing override is byte-identical, avoiding spurious
 * command-history entries for semantic no-ops.
 */
export function withComponentOverride(
	binding: ComponentInstanceBinding,
	override: ComponentNodeOverride,
): ComponentInstanceBinding {
	const existing = binding.overrides ?? [];
	const previous = existing.find((item) => sameOverrideTarget(item, override));
	const nextOverride = previous
		? mergeComponentOverride(previous, override)
		: override;
	if (previous && sameOverride(previous, nextOverride)) return binding;
	return {
		...binding,
		overrides: [
			...existing.filter((item) => !sameOverrideTarget(item, override)),
			nextOverride,
		],
	};
}

/**
 * Removes tracked overrides from an instance binding. Reset commands use this
 * after restoring visible node data from source nodes, while read-only UI can
 * use the same predicate to preview whether a reset action is available.
 */
export function withoutComponentOverrides(
	binding: ComponentInstanceBinding,
	filter: ComponentOverrideResetFilter = {},
): ComponentInstanceBinding {
	const existing = binding.overrides ?? [];
	if (existing.length === 0) return binding;
	const overrides = existing.filter(
		(override) => !matchesComponentOverrideFilter(override, filter),
	);
	if (overrides.length === existing.length) return binding;
	const { overrides: _overrides, ...rest } = binding;
	return overrides.length > 0 ? { ...rest, overrides } : rest;
}
