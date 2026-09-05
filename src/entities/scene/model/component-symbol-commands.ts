import { castDraft, current, type Draft } from "immer";
import type { SceneCommand } from "./command";
import {
	pruneDraftComponentPropBindings,
	synchronizeSharedColorComponentPropsFromNodeStyle,
} from "./component-prop-commands";
import { readComponentProps } from "./component-props";
import {
	type ComponentInstancePlan,
	type ComponentNodeOverrideInput,
	type ComponentOverrideResetFilter,
	type CreateComponentInstanceOptions,
	type CreateComponentSymbolOptions,
	createComponentSymbol,
	detachComponentNode,
	planComponentInstance,
	planComponentNodeOverride,
	readComponentSymbols,
	withComponentOverride,
	withoutComponentOverrides,
} from "./component-symbols";
import { cloneSceneDocument } from "./factory";
import {
	createUpdateNodeStyleCommand,
	createUpdateTextNodeCommand,
} from "./node-commands";
import { findDraftLayer, findDraftNode } from "./selectors";
import type {
	ComponentInstanceBinding,
	ComponentNodeOverride,
	ComponentSymbol,
	NodeStyle,
	SceneDocument,
	TextStyle,
	VectorNode,
} from "./types";

/**
 * Undoable command bridge for component sources and instances. The pure planning
 * helpers live in `component-symbols.ts`; commands here only connect those plans
 * to Immer drafts so source creation, instance insertion, detach, and override
 * edits remain one history entry per user action.
 */

const writeComponentSymbolLibrary = (
	draft: Draft<SceneDocument>,
	symbols: readonly ComponentSymbol[],
): void => {
	draft.componentSymbols = castDraft(cloneSceneDocument(symbols));
};

const clampInsertIndex = (length: number, toIndex: number): number =>
	Math.min(length, Math.max(0, toIndex));

const clearDraftComponentBindings = (node: Draft<VectorNode>): void => {
	delete node.component;
	if (!node.children) return;
	for (const child of node.children) clearDraftComponentBindings(child);
};

const insertComponentInstancePlan = (
	draft: Draft<SceneDocument>,
	plan: ComponentInstancePlan,
): void => {
	for (const nodeId of plan.newNodeIds) {
		if (findDraftNode(draft, nodeId)) return;
	}
	if (!findDraftNode(draft, plan.sourceNodeId)) return;
	const liveSymbol = readComponentSymbols(draft).find(
		(symbol) => symbol.id === plan.symbol.id,
	);
	if (!liveSymbol || liveSymbol.sourceNodeId !== plan.sourceNodeId) return;
	const layer = findDraftLayer(draft, plan.layerId);
	if (!layer) return;
	layer.nodes.splice(
		clampInsertIndex(layer.nodes.length, plan.toIndex),
		0,
		castDraft(cloneSceneDocument(plan.rootNode)),
	);
};

export type StoreComponentSourceOnAssetBoardPlan = {
	readonly symbol: ComponentSymbol;
	readonly sourceNode: VectorNode;
	readonly sourceLayerId: string;
	readonly instanceRootNodeId: string;
	readonly sourceToInstanceNodeIds: Readonly<Record<string, string>>;
};

const collectDraftSubtreeNodeIds = (
	node: Draft<VectorNode>,
	output: Set<string>,
): void => {
	output.add(node.id);
	if (!node.children) return;
	for (const child of node.children) collectDraftSubtreeNodeIds(child, output);
};

const removeDraftNodeById = (
	nodes: Draft<readonly VectorNode[]>,
	nodeId: string,
	removedNodeIds: Set<string>,
): boolean => {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (node.id === nodeId) {
			collectDraftSubtreeNodeIds(node, removedNodeIds);
			nodes.splice(index, 1);
			return true;
		}
		if (
			node.children &&
			removeDraftNodeById(node.children, nodeId, removedNodeIds)
		) {
			return true;
		}
	}
	return false;
};

const detachDraftComponentInstance = (node: Draft<VectorNode>): void => {
	const detached = detachComponentNode(node);
	Object.assign(node, castDraft(detached));
	clearDraftComponentBindings(node);
};

const detachDraftInstancesForSymbol = (
	nodes: Draft<readonly VectorNode[]>,
	symbolId: string,
): void => {
	for (const node of nodes) {
		if (
			node.component?.kind === "instance" &&
			node.component.symbolId === symbolId
		) {
			detachDraftComponentInstance(node);
			continue;
		}
		if (node.children) detachDraftInstancesForSymbol(node.children, symbolId);
	}
};

const sameSerialized = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const stylePatchMatches = (
	style: NodeStyle,
	patch: Partial<NodeStyle>,
): boolean =>
	(Object.keys(patch) as Array<keyof NodeStyle>).every(
		(key) => patch[key] === undefined || sameSerialized(style[key], patch[key]),
	);

/**
 * Detects a component-instance style patch that declares a fill/stroke role
 * already owned by a document shared-color prop. The declaration itself is a
 * conflict even when its current value matches: persisted override metadata
 * would become stale after the next driver edit. Instance overrides must stay
 * local and may not become a second owner for the same paint role.
 */
const stylePatchClaimsSharedColorTarget = (
	draft: Draft<SceneDocument>,
	nodeId: string,
	patch: Partial<NodeStyle>,
): boolean => {
	const claimsFill = patch.fill !== undefined || patch.fills !== undefined;
	const claimsStroke =
		patch.stroke !== undefined || patch.strokes !== undefined;
	if (!claimsFill && !claimsStroke) return false;
	for (const prop of readComponentProps(draft)) {
		if (prop.type !== "color") continue;
		for (const binding of prop.bindings) {
			if (binding.kind !== "style-color" || binding.nodeId !== nodeId) continue;
			if (
				(binding.role === "fill" && claimsFill) ||
				(binding.role === "stroke" && claimsStroke)
			) {
				return true;
			}
		}
	}
	return false;
};

const nodeHasSharedNumberOwner = (
	draft: Draft<SceneDocument>,
	nodeId: string,
	propertyId: "transform.rotation" | "style.opacity",
): boolean =>
	readComponentProps(draft).some(
		(prop) =>
			prop.type === "number" &&
			prop.bindings.some(
				(binding) =>
					binding.kind === "bindable" &&
					binding.nodeId === nodeId &&
					binding.propertyId === propertyId,
			),
	);

const overrideClaimsSharedNumberTarget = (
	draft: Draft<SceneDocument>,
	override: ComponentNodeOverride,
): boolean =>
	(override.kind === "style" &&
		override.style.opacity !== undefined &&
		nodeHasSharedNumberOwner(
			draft,
			override.instanceNodeId,
			"style.opacity",
		)) ||
	(override.kind === "transform" &&
		override.transform.rotation !== undefined &&
		nodeHasSharedNumberOwner(
			draft,
			override.instanceNodeId,
			"transform.rotation",
		));

const applyOverridePatch = (
	draft: Draft<SceneDocument>,
	override: ComponentNodeOverride,
): boolean => {
	if (overrideClaimsSharedNumberTarget(draft, override)) return false;
	switch (override.kind) {
		case "name": {
			const node = findDraftNode(draft, override.instanceNodeId);
			if (!node) return false;
			node.name = override.name;
			return node.name === override.name;
		}
		case "style": {
			if (
				stylePatchClaimsSharedColorTarget(
					draft,
					override.instanceNodeId,
					override.style,
				)
			) {
				return false;
			}
			createUpdateNodeStyleCommand(override.instanceNodeId, override.style).run(
				draft,
			);
			const node = findDraftNode(draft, override.instanceNodeId);
			return node
				? stylePatchMatches(current(node).style, override.style)
				: false;
		}
		case "transform": {
			const node = findDraftNode(draft, override.instanceNodeId);
			if (!node) return false;
			node.transform = {
				...node.transform,
				...override.transform,
			};
			return (
				Object.keys(override.transform) as Array<
					keyof typeof override.transform
				>
			).every((key) =>
				sameSerialized(node.transform[key], override.transform[key]),
			);
		}
		case "text":
			createUpdateTextNodeCommand(
				override.instanceNodeId,
				{
					text: override.text,
					bounds: override.bounds,
					style: override.style,
				},
				{ label: "Apply component override" },
			).run(draft);
			return true;
	}
};

const resetNodeStylePatch = (
	sourceNode: Draft<VectorNode>,
	instanceNode: Draft<VectorNode>,
	override: Extract<ComponentNodeOverride, { readonly kind: "style" }>,
): void => {
	if (override.style.fill !== undefined) {
		instanceNode.style.fill = sourceNode.style.fill;
	}
	if (override.style.stroke !== undefined) {
		instanceNode.style.stroke = sourceNode.style.stroke;
	}
	if (override.style.strokeWidth !== undefined) {
		instanceNode.style.strokeWidth = sourceNode.style.strokeWidth;
	}
	if (override.style.opacity !== undefined) {
		instanceNode.style.opacity = sourceNode.style.opacity;
	}
	if (override.style.fills !== undefined) {
		if (sourceNode.style.fills === undefined) {
			delete instanceNode.style.fills;
		} else {
			instanceNode.style.fills = castDraft(
				cloneSceneDocument(sourceNode.style.fills),
			);
		}
	}
	if (override.style.strokes !== undefined) {
		if (sourceNode.style.strokes === undefined) {
			delete instanceNode.style.strokes;
		} else {
			instanceNode.style.strokes = castDraft(
				cloneSceneDocument(sourceNode.style.strokes),
			);
		}
	}
	if (override.style.effects !== undefined) {
		if (sourceNode.style.effects === undefined) {
			delete instanceNode.style.effects;
		} else {
			instanceNode.style.effects = castDraft(
				cloneSceneDocument(sourceNode.style.effects),
			);
		}
	}
	if (override.style.blendMode !== undefined) {
		if (sourceNode.style.blendMode === undefined) {
			delete instanceNode.style.blendMode;
		} else {
			instanceNode.style.blendMode = sourceNode.style.blendMode;
		}
	}
	if (override.style.strokeAlign !== undefined) {
		if (sourceNode.style.strokeAlign === undefined) {
			delete instanceNode.style.strokeAlign;
		} else {
			instanceNode.style.strokeAlign = sourceNode.style.strokeAlign;
		}
	}
	if (override.style.strokeDash !== undefined) {
		if (sourceNode.style.strokeDash === undefined) {
			delete instanceNode.style.strokeDash;
		} else {
			instanceNode.style.strokeDash = castDraft(
				cloneSceneDocument(sourceNode.style.strokeDash),
			);
		}
	}
	if (override.style.strokeCap !== undefined) {
		if (sourceNode.style.strokeCap === undefined) {
			delete instanceNode.style.strokeCap;
		} else {
			instanceNode.style.strokeCap = sourceNode.style.strokeCap;
		}
	}
	if (override.style.strokeJoin !== undefined) {
		if (sourceNode.style.strokeJoin === undefined) {
			delete instanceNode.style.strokeJoin;
		} else {
			instanceNode.style.strokeJoin = sourceNode.style.strokeJoin;
		}
	}
	if (override.style.strokeMiterLimit !== undefined) {
		if (sourceNode.style.strokeMiterLimit === undefined) {
			delete instanceNode.style.strokeMiterLimit;
		} else {
			instanceNode.style.strokeMiterLimit = sourceNode.style.strokeMiterLimit;
		}
	}
};

const resetTransformPatch = (
	sourceNode: Draft<VectorNode>,
	instanceNode: Draft<VectorNode>,
	override: Extract<ComponentNodeOverride, { readonly kind: "transform" }>,
): void => {
	if (override.transform.position) {
		instanceNode.transform.position = castDraft(
			cloneSceneDocument(sourceNode.transform.position),
		);
	}
	if (override.transform.rotation !== undefined) {
		instanceNode.transform.rotation = sourceNode.transform.rotation;
	}
	if (override.transform.scale) {
		instanceNode.transform.scale = castDraft(
			cloneSceneDocument(sourceNode.transform.scale),
		);
	}
	if (override.transform.anchor) {
		instanceNode.transform.anchor = castDraft(
			cloneSceneDocument(sourceNode.transform.anchor),
		);
	}
};

const resetTextStyleKey = <Key extends keyof TextStyle>(
	style: { -readonly [K in keyof TextStyle]?: TextStyle[K] },
	sourceStyle: Partial<TextStyle> | undefined,
	key: Key,
): void => {
	if (sourceStyle?.[key] === undefined) {
		delete style[key];
		return;
	}
	style[key] = sourceStyle[key];
};

const resetTextStylePatch = (
	sourceStyle: Partial<TextStyle> | undefined,
	instanceNode: Draft<VectorNode>,
	styleOverride: Partial<TextStyle>,
): void => {
	if (instanceNode.geometry.kind !== "text") return;
	const style: { -readonly [K in keyof TextStyle]?: TextStyle[K] } = {
		...instanceNode.geometry.style,
	};
	let changed = false;
	if (styleOverride.fontFamily !== undefined) {
		resetTextStyleKey(style, sourceStyle, "fontFamily");
		changed = true;
	}
	if (styleOverride.fontSize !== undefined) {
		resetTextStyleKey(style, sourceStyle, "fontSize");
		changed = true;
	}
	if (styleOverride.lineHeight !== undefined) {
		resetTextStyleKey(style, sourceStyle, "lineHeight");
		changed = true;
	}
	if (styleOverride.align !== undefined) {
		resetTextStyleKey(style, sourceStyle, "align");
		changed = true;
	}
	if (styleOverride.fontWeight !== undefined) {
		resetTextStyleKey(style, sourceStyle, "fontWeight");
		changed = true;
	}
	if (!changed) return;
	if (Object.keys(style).length > 0) {
		instanceNode.geometry.style = castDraft(cloneSceneDocument(style));
	} else {
		delete instanceNode.geometry.style;
	}
};

const sameVec2 = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): boolean => Object.is(left.x, right.x) && Object.is(left.y, right.y);

const sameBounds = (
	left: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
	right: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
): boolean =>
	Object.is(left.x, right.x) &&
	Object.is(left.y, right.y) &&
	Object.is(left.width, right.width) &&
	Object.is(left.height, right.height);

const textStyleMatchesSource = (
	sourceStyle: Partial<TextStyle> | undefined,
	style: Partial<TextStyle>,
): boolean => {
	if (
		style.fontFamily !== undefined &&
		sourceStyle?.fontFamily !== style.fontFamily
	)
		return false;
	if (
		style.fontSize !== undefined &&
		sourceStyle?.fontSize !== style.fontSize
	) {
		return false;
	}
	if (
		style.lineHeight !== undefined &&
		sourceStyle?.lineHeight !== style.lineHeight
	) {
		return false;
	}
	if (style.align !== undefined && sourceStyle?.align !== style.align) {
		return false;
	}
	if (
		style.fontWeight !== undefined &&
		sourceStyle?.fontWeight !== style.fontWeight
	) {
		return false;
	}
	return true;
};

const nodeStyleFieldMatchesSource = <Key extends keyof NodeStyle>(
	sourceStyle: Draft<NodeStyle>,
	style: Partial<NodeStyle>,
	key: Key,
): boolean =>
	style[key] === undefined || sameSerialized(sourceStyle[key], style[key]);

const overrideMatchesSource = (
	draft: Draft<SceneDocument>,
	override: ComponentNodeOverride,
): boolean => {
	const sourceNode = findDraftNode(draft, override.sourceNodeId);
	if (!sourceNode) return false;
	switch (override.kind) {
		case "name":
			return sourceNode.name === override.name;
		case "style":
			if (
				override.style.fill !== undefined &&
				sourceNode.style.fill !== override.style.fill
			)
				return false;
			if (
				override.style.stroke !== undefined &&
				sourceNode.style.stroke !== override.style.stroke
			)
				return false;
			if (
				override.style.strokeWidth !== undefined &&
				!Object.is(sourceNode.style.strokeWidth, override.style.strokeWidth)
			)
				return false;
			if (
				override.style.opacity !== undefined &&
				!Object.is(sourceNode.style.opacity, override.style.opacity)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(sourceNode.style, override.style, "fills")
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"strokes",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"effects",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"blendMode",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"strokeAlign",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"strokeDash",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"strokeCap",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"strokeJoin",
				)
			)
				return false;
			if (
				!nodeStyleFieldMatchesSource(
					sourceNode.style,
					override.style,
					"strokeMiterLimit",
				)
			)
				return false;
			return true;
		case "transform":
			if (
				override.transform.position &&
				!sameVec2(sourceNode.transform.position, override.transform.position)
			)
				return false;
			if (
				override.transform.rotation !== undefined &&
				!Object.is(sourceNode.transform.rotation, override.transform.rotation)
			)
				return false;
			if (
				override.transform.scale &&
				!sameVec2(sourceNode.transform.scale, override.transform.scale)
			)
				return false;
			if (
				override.transform.anchor &&
				!sameVec2(sourceNode.transform.anchor, override.transform.anchor)
			)
				return false;
			return true;
		case "text":
			if (sourceNode.geometry.kind !== "text") return false;
			if (
				override.text !== undefined &&
				sourceNode.geometry.text !== override.text
			)
				return false;
			if (
				override.bounds &&
				!sameBounds(sourceNode.geometry.bounds, override.bounds)
			)
				return false;
			if (
				override.style &&
				!textStyleMatchesSource(sourceNode.geometry.style, override.style)
			)
				return false;
			return true;
	}
};

const resetOverridePatch = (
	draft: Draft<SceneDocument>,
	override: ComponentNodeOverride,
): boolean => {
	const sourceNode = findDraftNode(draft, override.sourceNodeId);
	const instanceNode = findDraftNode(draft, override.instanceNodeId);
	if (!sourceNode || !instanceNode) return true;
	if (overrideClaimsSharedNumberTarget(draft, override)) return false;

	switch (override.kind) {
		case "name":
			instanceNode.name = sourceNode.name;
			return true;
		case "style": {
			if (
				stylePatchClaimsSharedColorTarget(
					draft,
					override.instanceNodeId,
					override.style,
				)
			) {
				return false;
			}
			const beforeStyle = current(instanceNode.style);
			resetNodeStylePatch(sourceNode, instanceNode, override);
			if (
				!synchronizeSharedColorComponentPropsFromNodeStyle(
					draft,
					instanceNode.id,
					beforeStyle,
				)
			) {
				instanceNode.style = castDraft(beforeStyle);
				return false;
			}
			return true;
		}
		case "transform":
			resetTransformPatch(sourceNode, instanceNode, override);
			return true;
		case "text":
			if (
				sourceNode.geometry.kind !== "text" ||
				instanceNode.geometry.kind !== "text"
			) {
				return true;
			}
			if (override.text !== undefined) {
				instanceNode.geometry.text = sourceNode.geometry.text;
			}
			if (override.bounds) {
				instanceNode.geometry.bounds = castDraft(
					cloneSceneDocument(sourceNode.geometry.bounds),
				);
			}
			if (override.style) {
				resetTextStylePatch(
					sourceNode.geometry.style,
					instanceNode,
					override.style,
				);
			}
			return true;
	}
};

const overrideBelongsToBinding = (
	binding: ComponentInstanceBinding,
	override: ComponentNodeOverride,
): boolean =>
	binding.sourceToInstanceNodeIds[override.sourceNodeId] ===
	override.instanceNodeId;

const matchesResetFilter = (
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
 * Marks an existing scene node as a reusable component source and writes the
 * optional document library entry in the same undoable command. Existing source
 * nodes, instance nodes, missing nodes, and duplicate sources are safe no-ops.
 */
export function createComponentSourceCommand(
	sourceNodeId: string,
	options: CreateComponentSymbolOptions = {},
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/create-component-source",
		label: commandOptions.label ?? "Create component",
		run: (draft) => {
			const sourceNode = findDraftNode(draft, sourceNodeId);
			if (!sourceNode || sourceNode.component?.kind === "instance") return;
			const symbols = readComponentSymbols(draft);
			const symbol = createComponentSymbol(symbols, sourceNode, options);
			if (!symbol) return;
			writeComponentSymbolLibrary(draft, [...symbols, symbol]);
			sourceNode.component = {
				kind: "source",
				symbolId: symbol.id,
			};
		},
	};
}

/**
 * Stores a cloned component source on an asset-board node while converting the
 * live scene node into the first placed copy. The visible scene object keeps its
 * existing id, geometry, and authored motion targets; only its component role is
 * changed, so saving an object does not move the user's artwork out of the scene.
 */
export function createStoreComponentSourceOnAssetBoardCommand(
	plan: StoreComponentSourceOnAssetBoardPlan,
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/store-component-source-on-asset-board",
		label: commandOptions.label ?? "Save object asset",
		run: (draft) => {
			if (findDraftNode(draft, plan.sourceNode.id)) return;
			const instanceRoot = findDraftNode(draft, plan.instanceRootNodeId);
			if (!instanceRoot || instanceRoot.component) return;
			const sourceLayer = findDraftLayer(draft, plan.sourceLayerId);
			if (!sourceLayer) return;

			const symbols = readComponentSymbols(draft);
			if (
				symbols.some(
					(symbol) =>
						symbol.id === plan.symbol.id ||
						symbol.sourceNodeId === plan.symbol.sourceNodeId,
				)
			) {
				return;
			}

			sourceLayer.nodes.push(castDraft(cloneSceneDocument(plan.sourceNode)));
			writeComponentSymbolLibrary(draft, [...symbols, plan.symbol]);
			instanceRoot.component = castDraft({
				kind: "instance",
				symbolId: plan.symbol.id,
				sourceNodeId: plan.sourceNode.id,
				sourceToInstanceNodeIds: plan.sourceToInstanceNodeIds,
			});
		},
	};
}

/**
 * Removes a component symbol and its source node without deleting placed copies.
 * Existing instances are detached into ordinary nodes before the library entry is
 * removed, so deleting a stored object only deletes the reusable registration.
 */
export function createRemoveComponentSymbolCommand(
	symbolId: string,
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/remove-component-symbol",
		label: commandOptions.label ?? "Delete stored object",
		run: (draft) => {
			const symbols = readComponentSymbols(draft);
			const symbol = symbols.find((entry) => entry.id === symbolId);
			if (!symbol) return;

			for (const layer of draft.layers) {
				detachDraftInstancesForSymbol(layer.nodes, symbol.id);
			}

			const removedNodeIds = new Set<string>();
			for (const layer of draft.layers) {
				removeDraftNodeById(layer.nodes, symbol.sourceNodeId, removedNodeIds);
			}
			pruneDraftComponentPropBindings(draft, removedNodeIds);

			writeComponentSymbolLibrary(
				draft,
				symbols.filter((entry) => entry.id !== symbol.id),
			);
		},
	};
}

/**
 * Inserts a precomputed component instance plan into the target layer. Passing a
 * plan keeps ids knowable before mutation, while stale plans no-op if their
 * symbol/source/layer/root id is no longer valid in the live draft.
 */
export function createInsertComponentInstanceCommand(
	plan: ComponentInstancePlan,
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/insert-component-instance",
		label: commandOptions.label ?? "Create component instance",
		run: (draft) => {
			insertComponentInstancePlan(draft, plan);
		},
	};
}

/**
 * Plans and inserts a component instance from the live draft in one command.
 * UI that needs the future node ids can still pre-plan and call
 * `createInsertComponentInstanceCommand`; simple insert actions can call this
 * directly with a symbol id and placement options.
 */
export function createInsertComponentInstanceFromSymbolCommand(
	symbolId: string,
	options: CreateComponentInstanceOptions = {},
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/insert-component-instance-from-symbol",
		label: commandOptions.label ?? "Create component instance",
		run: (draft) => {
			const plan = planComponentInstance(draft, symbolId, options);
			if (!plan) return;
			insertComponentInstancePlan(draft, plan);
		},
	};
}

/**
 * Sets a linked instance's per-instance motion timing offset (frames). The offset
 * is recorded on the instance binding; the caller pairs this with a motion-store
 * re-copy (`copyMotionTracksForInstance` with the same `timingOffsetFrames`) under
 * a shared `compoundId` so the scene record and the baked tracks stay atomic. A
 * no-op when the value is unchanged so repeated scrubs do not churn history.
 */
export function createSetComponentTimingOffsetCommand(
	instanceRootNodeId: string,
	offsetFrames: number,
	commandOptions: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	return {
		type: "scene/set-component-timing-offset",
		label: commandOptions.label ?? "Set instance timing offset",
		...(commandOptions.coalesceKey
			? { coalesceKey: commandOptions.coalesceKey }
			: {}),
		run: (draft) => {
			const node = findDraftNode(draft, instanceRootNodeId);
			const binding = node?.component;
			if (!node || binding?.kind !== "instance") return;
			const normalized = Number.isFinite(offsetFrames)
				? Math.round(offsetFrames)
				: 0;
			if ((binding.timingOffsetFrames ?? 0) === normalized) return;
			node.component = castDraft({
				...current(binding),
				timingOffsetFrames: normalized,
			});
		},
	};
}

/**
 * Detaches a component instance by removing component bindings from the target
 * subtree while preserving the current node geometry, style, transform, and
 * layer position. Source definitions remain in the library for other instances.
 */
export function createDetachComponentInstanceCommand(
	instanceRootNodeId: string,
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/detach-component-instance",
		label: commandOptions.label ?? "Detach component instance",
		run: (draft) => {
			const node = findDraftNode(draft, instanceRootNodeId);
			if (node?.component?.kind !== "instance") return;
			const detached = detachComponentNode(node);
			Object.assign(node, castDraft(detached));
			clearDraftComponentBindings(node);
		},
	};
}

/**
 * Applies a node-level component override and records the normalized override on
 * the instance root binding. The target node must belong to the instance id map,
 * which prevents stale UI from attaching override metadata to unrelated nodes.
 */
export function createApplyComponentOverrideCommand(
	instanceRootNodeId: string,
	instanceNodeId: string,
	input: ComponentNodeOverrideInput,
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/apply-component-override",
		label: commandOptions.label ?? "Apply component override",
		run: (draft) => {
			const override = planComponentNodeOverride(
				draft,
				instanceRootNodeId,
				instanceNodeId,
				input,
			);
			if (!override) return;
			const instanceRoot = findDraftNode(draft, instanceRootNodeId);
			const binding = instanceRoot?.component;
			if (!instanceRoot || binding?.kind !== "instance") return;

			if (!applyOverridePatch(draft, override)) return;
			const nextBinding = overrideMatchesSource(draft, override)
				? withoutComponentOverrides(binding, {
						instanceNodeId: override.instanceNodeId,
						kind: override.kind,
					})
				: withComponentOverride(binding, override);
			if (nextBinding !== binding) {
				instanceRoot.component = castDraft(cloneSceneDocument(nextBinding));
			}
		},
	};
}

/**
 * Resets tracked component overrides by copying the current source-node value
 * for each matching override kind back onto the instance node, then removing the
 * matching override metadata from the instance binding. Missing stale source or
 * target nodes still have their stale metadata cleared when possible.
 */
export function createResetComponentOverrideCommand(
	instanceRootNodeId: string,
	filter: ComponentOverrideResetFilter = {},
	commandOptions: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/reset-component-override",
		label: commandOptions.label ?? "Reset component override",
		run: (draft) => {
			const instanceRoot = findDraftNode(draft, instanceRootNodeId);
			const binding = instanceRoot?.component;
			if (!instanceRoot || binding?.kind !== "instance") return;
			const overrides = binding.overrides ?? [];
			const matching = overrides.filter((override) =>
				matchesResetFilter(override, filter),
			);
			if (matching.length === 0) return;

			const cleared = matching.filter(
				(override) =>
					!overrideBelongsToBinding(binding, override) ||
					resetOverridePatch(draft, override),
			);
			const originalBinding = current(binding) as ComponentInstanceBinding;
			let nextBinding = originalBinding;
			for (const override of cleared) {
				nextBinding = withoutComponentOverrides(nextBinding, {
					instanceNodeId: override.instanceNodeId,
					kind: override.kind,
				});
			}
			if (nextBinding !== originalBinding) {
				instanceRoot.component = castDraft(cloneSceneDocument(nextBinding));
			}
		},
	};
}
