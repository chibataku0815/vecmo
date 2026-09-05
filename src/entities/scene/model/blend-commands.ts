import { castDraft } from "immer";
import { createId } from "@/shared/lib/id";
import {
	type BlendIssue,
	blendNodeEligibilityIssue,
	blendPairEligibilityIssue,
	canUseCustomBlendSpine,
	createBlendContainerNode,
	isClosedBlendSpine,
	moveNodeBlendSourceStopToPoint,
	normalizeBlendOrientation,
	normalizeBlendSourceStops,
	normalizeBlendSpacing,
	normalizeBlendStacking,
	refreshBlendNode,
	removeBlendPathSpineAnchor,
	replaceableBlendSpineFromNode,
	resetBlendPathSpineHandle,
	reverseBlendSpine,
	sampleBlendSpine,
} from "./blend";
import type { SceneCommand } from "./command";
import { pruneDraftComponentPropBindings } from "./component-prop-commands";
import {
	composeMatrix,
	isIdentityMatrix,
	matrixFromTransform,
	transformFromMatrix,
} from "./rendering";
import { findNode } from "./selectors";
import type {
	BlendNodeContract,
	BlendOrientation,
	BlendSourceStop,
	BlendSpacing,
	BlendSpine,
	BlendStackingOrder,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "./types";

export type BlendPatch = {
	readonly spacing?: BlendSpacing;
	readonly orientation?: BlendOrientation;
	/** `null` restores the live straight endpoint spine. */
	readonly spine?: BlendSpine | null;
	readonly stacking?: BlendStackingOrder;
};

export type BlendCommandResult =
	| {
			readonly ok: true;
			readonly blendNodeId: string;
			readonly sourceNodeIds: readonly string[];
			readonly layerId: string;
			readonly command: SceneCommand;
			readonly issues: readonly BlendIssue[];
	  }
	| {
			readonly ok: false;
			readonly issues: readonly BlendIssue[];
	  };

type TopLevelNodeEntry = {
	readonly layer: SceneLayer;
	readonly node: VectorNode;
	readonly index: number;
};

const issue = (
	code: BlendIssue["code"],
	message: string,
	nodeId?: string,
	layerId?: string,
): BlendIssue => ({
	code,
	severity: "error",
	message,
	...(nodeId ? { nodeId } : {}),
	...(layerId ? { layerId } : {}),
});

const uniqueSourceIds = (nodeIds: readonly string[]): readonly string[] => {
	const unique: string[] = [];
	for (const nodeId of nodeIds) {
		if (!unique.includes(nodeId)) unique.push(nodeId);
	}
	return unique;
};

const findTopLevelNode = (
	document: SceneDocument,
	nodeId: string,
): TopLevelNodeEntry | null => {
	for (const layer of document.layers) {
		const index = layer.nodes.findIndex((node) => node.id === nodeId);
		const node = index >= 0 ? layer.nodes[index] : undefined;
		if (node) return { layer, node, index };
	}
	return null;
};

const hasErrors = (issues: readonly BlendIssue[]): boolean =>
	issues.some((item) => item.severity === "error");

const sourceArtboardId = (document: SceneDocument, node: VectorNode): string =>
	node.artboardId ?? document.currentArtboardId ?? document.artboard.id;

/**
 * Wraps same-layer top-level nodes in a typed Blend container. The command
 * re-reads sources from the draft at execution time so the materialized blend
 * uses the latest scene data and lands as one undoable edit.
 */
export function createBlendNodesCommand(options: {
	readonly layerId: string;
	readonly blendNodeId: string;
	readonly sourceNodeIds: readonly string[];
	readonly sourceStops?: readonly BlendSourceStop[];
	readonly spacing?: BlendSpacing;
	readonly orientation?: BlendOrientation;
}): SceneCommand {
	return {
		type: "scene/create-blend",
		label: "Make blend",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer || layer.locked || !layer.visible) return;
			const sourceEntries = options.sourceNodeIds
				.map((nodeId) => ({
					nodeId,
					index: layer.nodes.findIndex((node) => node.id === nodeId),
				}))
				.filter(
					(
						entry,
					): entry is { readonly nodeId: string; readonly index: number } =>
						entry.index >= 0,
				);
			if (
				sourceEntries.length !== options.sourceNodeIds.length ||
				sourceEntries.length < 2
			) {
				return;
			}
			const ordered = [...sourceEntries].sort(
				(left, right) => left.index - right.index,
			);
			const firstIndex = ordered[0]?.index;
			if (firstIndex === undefined) return;
			const sources = sourceEntries.flatMap((entry) => {
				const node = layer.nodes[entry.index];
				return node ? [node] : [];
			});
			if (sources.length !== sourceEntries.length) return;
			const blendNode = createBlendContainerNode({
				blendNodeId: options.blendNodeId,
				sources,
				sourceStops: options.sourceStops,
				spacing: options.spacing,
				orientation: options.orientation,
			});
			for (const entry of ordered.toReversed()) {
				layer.nodes.splice(entry.index, 1);
			}
			layer.nodes.splice(firstIndex, 0, castDraft(blendNode));
		},
	};
}

/**
 * Plans a Blend creation command for two or more ordered stops.
 */
export function buildCreateBlendCommand(
	document: SceneDocument,
	sourceNodeIds: readonly string[],
	options: {
		readonly spacing?: BlendSpacing;
		readonly orientation?: BlendOrientation;
		readonly sourceOrder?: "selection" | "layer";
		readonly sourceStops?: readonly BlendSourceStop[];
	} = {},
): BlendCommandResult {
	const issues: BlendIssue[] = [];
	const uniqueIds = uniqueSourceIds(sourceNodeIds);
	if (uniqueIds.length !== sourceNodeIds.length) {
		for (const nodeId of sourceNodeIds) {
			if (sourceNodeIds.indexOf(nodeId) !== sourceNodeIds.lastIndexOf(nodeId)) {
				issues.push(
					issue(
						"blend.duplicate-source",
						"Blend source ids must be unique.",
						nodeId,
					),
				);
			}
		}
	}
	if (uniqueIds.length < 2) {
		issues.push(
			issue(
				"blend.requires-at-least-two-sources",
				"Blend requires at least two source nodes.",
			),
		);
	}

	const entries: TopLevelNodeEntry[] = [];
	for (const nodeId of uniqueIds) {
		const node = findNode(document, nodeId);
		if (!node) {
			issues.push(
				issue(
					"blend.missing-source",
					"Blend source node was not found in the scene.",
					nodeId,
				),
			);
			continue;
		}
		const entry = findTopLevelNode(document, nodeId);
		if (!entry) {
			issues.push(
				issue(
					"blend.child-source",
					"Blend currently accepts top-level source nodes only.",
					nodeId,
				),
			);
			continue;
		}
		if (entry.layer.locked || entry.node.locked) {
			issues.push(
				issue(
					"blend.locked-source",
					"Locked nodes or nodes in locked layers cannot be blended.",
					nodeId,
					entry.layer.id,
				),
			);
		}
		if (!entry.layer.visible || !entry.node.visible) {
			issues.push(
				issue(
					"blend.hidden-source",
					"Hidden nodes or nodes in hidden layers cannot be blended.",
					nodeId,
					entry.layer.id,
				),
			);
		}
		const eligibilityIssue = blendNodeEligibilityIssue(entry.node);
		if (eligibilityIssue) issues.push(eligibilityIssue);
		entries.push(entry);
	}

	const layerId = entries[0]?.layer.id;
	if (layerId) {
		for (const entry of entries) {
			if (entry.layer.id === layerId) continue;
			issues.push(
				issue(
					"blend.cross-layer-source",
					"Blend currently requires all sources in one layer.",
					entry.node.id,
					entry.layer.id,
				),
			);
		}
	}
	const artboardId = entries[0]
		? sourceArtboardId(document, entries[0].node)
		: null;
	if (artboardId) {
		for (const entry of entries) {
			if (sourceArtboardId(document, entry.node) === artboardId) continue;
			issues.push(
				issue(
					"blend.cross-artboard-source",
					"Blend currently requires all sources on one artboard.",
					entry.node.id,
					entry.layer.id,
				),
			);
		}
	}
	const orderedEntries =
		options.sourceOrder === "layer"
			? [...entries].sort((left, right) => left.index - right.index)
			: uniqueIds
					.map((nodeId) => entries.find((entry) => entry.node.id === nodeId))
					.filter((entry): entry is TopLevelNodeEntry => Boolean(entry));
	for (let index = 0; index < orderedEntries.length - 1; index += 1) {
		const from = orderedEntries[index];
		const to = orderedEntries[index + 1];
		if (!from || !to) continue;
		const pairIssue = blendPairEligibilityIssue(from.node, to.node);
		if (pairIssue) issues.push(pairIssue);
	}

	if (hasErrors(issues) || uniqueIds.length < 2 || !layerId) {
		return { ok: false, issues };
	}

	const blendNodeId = createId("blend");
	const orderedSourceIds = orderedEntries.map((entry) => entry.node.id);
	const sourceStops = normalizeBlendSourceStops(
		orderedSourceIds,
		options.sourceStops,
	);
	return {
		ok: true,
		blendNodeId,
		sourceNodeIds: orderedSourceIds,
		layerId,
		command: createBlendNodesCommand({
			layerId,
			blendNodeId,
			sourceNodeIds: orderedSourceIds,
			...(sourceStops ? { sourceStops } : {}),
			spacing: normalizeBlendSpacing(options.spacing),
			orientation: normalizeBlendOrientation(options.orientation),
		}),
		issues,
	};
}

const clampStopIndex = (value: number, max: number): number =>
	Math.min(max, Math.max(0, Math.round(value)));

/**
 * Inserts one compatible top-level source into an existing Blend's ordered
 * stops. An omitted `index` appends the stop; interior indexes make the new
 * source the stop between its neighbors without moving any geometry.
 */
export function createInsertBlendSourceCommand(options: {
	readonly layerId: string;
	readonly blendNodeId: string;
	readonly sourceNodeId: string;
	readonly index?: number;
	readonly sourceStop?: BlendSourceStop;
}): SceneCommand {
	return {
		type: "scene/insert-blend-source",
		label: "Add blend stop",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer || layer.locked || !layer.visible) return;
			const blendIndex = layer.nodes.findIndex(
				(node) => node.id === options.blendNodeId && node.blend,
			);
			const sourceIndex = layer.nodes.findIndex(
				(node) =>
					node.id === options.sourceNodeId && !node.blend && !node.blendStep,
			);
			const blendNode = blendIndex >= 0 ? layer.nodes[blendIndex] : undefined;
			const sourceNode =
				sourceIndex >= 0 ? layer.nodes[sourceIndex] : undefined;
			if (!blendNode?.blend || !blendNode.children || !sourceNode) return;
			if (blendNode.blend.sourceNodeIds.includes(sourceNode.id)) return;
			const currentIds = blendNode.blend.sourceNodeIds;
			const stopIndex = clampStopIndex(
				options.index ?? currentIds.length,
				currentIds.length,
			);
			const nextSourceIds = [
				...currentIds.slice(0, stopIndex),
				sourceNode.id,
				...currentIds.slice(stopIndex),
			];
			const insertedStop =
				options.sourceStop?.nodeId === sourceNode.id
					? options.sourceStop
					: { nodeId: sourceNode.id };
			const sourceStops = normalizeBlendSourceStops(nextSourceIds, [
				...(blendNode.blend.sourceStops ?? []),
				insertedStop,
			]);
			const nextBlend = clone({
				...blendNode,
				children: [...blendNode.children, sourceNode],
				blend: {
					...blendNode.blend,
					sourceNodeIds: nextSourceIds,
					...(sourceStops ? { sourceStops } : {}),
				},
			});
			const next = refreshBlendNode(nextBlend);
			if (sourceIndex > blendIndex) {
				layer.nodes.splice(sourceIndex, 1);
				layer.nodes.splice(blendIndex, 1, castDraft(next));
			} else {
				layer.nodes.splice(blendIndex, 1, castDraft(next));
				layer.nodes.splice(sourceIndex, 1);
			}
		},
	};
}

/**
 * Plans inserting a node into an existing ordered-stop Blend. An omitted
 * `index` appends; otherwise the stop joins between its would-be neighbors,
 * both of which must be pair-compatible with the new source.
 */
export function buildInsertBlendSourceCommand(
	document: SceneDocument,
	blendNodeId: string,
	sourceNodeId: string,
	options: {
		readonly index?: number;
		readonly sourceStop?: BlendSourceStop;
	} = {},
): BlendCommandResult {
	const issues: BlendIssue[] = [];
	const blendEntry = findTopLevelNode(document, blendNodeId);
	const sourceEntry = findTopLevelNode(document, sourceNodeId);
	if (!blendEntry?.node.blend || !blendEntry.node.children) {
		issues.push(
			issue(
				"blend.missing-source",
				"Selected Blend was not found in the scene.",
				blendNodeId,
			),
		);
	}
	if (!sourceEntry) {
		issues.push(
			issue(
				"blend.missing-source",
				"Blend source node was not found in the scene.",
				sourceNodeId,
			),
		);
	}
	if (!blendEntry?.node.blend || !blendEntry.node.children || !sourceEntry) {
		return { ok: false, issues };
	}
	if (blendEntry.layer.id !== sourceEntry.layer.id) {
		issues.push(
			issue(
				"blend.cross-layer-source",
				"Blend currently requires all sources in one layer.",
				sourceNodeId,
				sourceEntry.layer.id,
			),
		);
	}
	if (
		sourceArtboardId(document, blendEntry.node) !==
		sourceArtboardId(document, sourceEntry.node)
	) {
		issues.push(
			issue(
				"blend.cross-artboard-source",
				"Blend currently requires all sources on one artboard.",
				sourceNodeId,
				sourceEntry.layer.id,
			),
		);
	}
	if (blendEntry.node.blend.sourceNodeIds.includes(sourceNodeId)) {
		issues.push(
			issue(
				"blend.duplicate-source",
				"Blend source ids must be unique.",
				sourceNodeId,
			),
		);
	}
	if (
		sourceEntry.layer.locked ||
		blendEntry.layer.locked ||
		sourceEntry.node.locked
	) {
		issues.push(
			issue(
				"blend.locked-source",
				"Locked nodes or nodes in locked layers cannot be blended.",
				sourceNodeId,
				sourceEntry.layer.id,
			),
		);
	}
	if (
		!sourceEntry.layer.visible ||
		!blendEntry.layer.visible ||
		!sourceEntry.node.visible
	) {
		issues.push(
			issue(
				"blend.hidden-source",
				"Hidden nodes or nodes in hidden layers cannot be blended.",
				sourceNodeId,
				sourceEntry.layer.id,
			),
		);
	}
	const eligibilityIssue = blendNodeEligibilityIssue(sourceEntry.node);
	if (eligibilityIssue) issues.push(eligibilityIssue);
	const currentIds = blendEntry.node.blend.sourceNodeIds;
	const stopIndex = Math.min(
		currentIds.length,
		Math.max(0, Math.round(options.index ?? currentIds.length)),
	);
	const neighborIds = [currentIds[stopIndex - 1], currentIds[stopIndex]].filter(
		(neighborId): neighborId is string => Boolean(neighborId),
	);
	for (const neighborId of neighborIds) {
		const neighbor = blendEntry.node.children.find(
			(child) => child.id === neighborId,
		);
		if (!neighbor) {
			issues.push(
				issue(
					"blend.missing-source",
					"Existing Blend source node was not found in the container.",
					neighborId,
				),
			);
			continue;
		}
		const pairIssue = blendPairEligibilityIssue(neighbor, sourceEntry.node);
		if (pairIssue) issues.push(pairIssue);
	}
	if (hasErrors(issues)) return { ok: false, issues };
	return {
		ok: true,
		blendNodeId,
		sourceNodeIds: [
			...currentIds.slice(0, stopIndex),
			sourceNodeId,
			...currentIds.slice(stopIndex),
		],
		layerId: blendEntry.layer.id,
		command: createInsertBlendSourceCommand({
			layerId: blendEntry.layer.id,
			blendNodeId,
			sourceNodeId,
			index: stopIndex,
			...(options.sourceStop ? { sourceStop: options.sourceStop } : {}),
		}),
		issues,
	};
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stripBlendChildMetadata = (node: VectorNode): VectorNode => {
	const next = clone(node);
	delete (next as { blend?: unknown }).blend;
	delete (next as { blendStep?: unknown }).blendStep;
	return next;
};

/**
 * Bakes the Blend container's own transform into a child leaving the
 * container, mirroring ungroup: a container that was moved/rotated/uniformly
 * scaled as a whole keeps every ejected child at its on-canvas placement.
 * Container transforms stay in the similarity class, so
 * `containerMatrix ∘ childMatrix` is representable as a shear-free TRS; the
 * identity case returns the child untouched for exact round-trips.
 */
const bakeBlendContainerTransform = (
	container: VectorNode,
	child: VectorNode,
): VectorNode => {
	const containerMatrix = matrixFromTransform(container.transform);
	if (isIdentityMatrix(containerMatrix)) return child;
	return {
		...child,
		transform: transformFromMatrix(
			composeMatrix(containerMatrix, matrixFromTransform(child.transform)),
			{ x: 0, y: 0 },
		),
	};
};

const topLevelBlendIndex = (layer: SceneLayer, blendNodeId: string): number =>
	layer.nodes.findIndex((node) => node.id === blendNodeId && node.blend);

/** Updates a Blend container's spacing and rematerializes its generated steps. */
export function createUpdateBlendSpacingCommand(
	blendNodeId: string,
	spacing: BlendSpacing,
	options: { readonly coalesceKey?: string } = {},
): SceneCommand {
	return {
		type: "scene/update-blend-spacing",
		label: "Update blend",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				const next = refreshBlendNode({
					...clone(node),
					blend: {
						...node.blend,
						spacing: normalizeBlendSpacing(spacing),
					},
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/** Updates a Blend container's orientation mode and rematerializes its steps. */
export function createUpdateBlendOrientationCommand(
	blendNodeId: string,
	orientation: BlendOrientation,
	options: { readonly coalesceKey?: string } = {},
): SceneCommand {
	return {
		type: "scene/update-blend-orientation",
		label: "Update blend orientation",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				const next = refreshBlendNode({
					...clone(node),
					blend: {
						...node.blend,
						orientation: normalizeBlendOrientation(orientation),
					},
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/** Applies the complete editable Blend contract as one undoable rematerialize. */
export function createUpdateBlendCommand(
	blendNodeId: string,
	patch: BlendPatch,
): SceneCommand {
	return {
		type: "scene/update-blend",
		label: "Update blend",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				if (patch.spine && !canUseCustomBlendSpine(patch.spine)) return;
				let blend: BlendNodeContract = {
					...node.blend,
					...(patch.spacing
						? { spacing: normalizeBlendSpacing(patch.spacing) }
						: {}),
					...(patch.orientation
						? { orientation: normalizeBlendOrientation(patch.orientation) }
						: {}),
					...(patch.stacking
						? { stacking: normalizeBlendStacking(patch.stacking) }
						: {}),
				};
				if (patch.spine === null) {
					const { spine: _spine, ...withoutSpine } = blend;
					blend = withoutSpine;
				} else if (patch.spine) {
					blend = { ...blend, spine: clone(patch.spine) };
				}
				layer.nodes.splice(
					index,
					1,
					castDraft(refreshBlendNode({ ...clone(node), blend })),
				);
				return;
			}
		},
	};
}

/** Restores a Blend container to the default straight endpoint spine. */
export function createClearBlendSpineCommand(
	blendNodeId: string,
): SceneCommand {
	return {
		type: "scene/clear-blend-spine",
		label: "Clear blend spine",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				const nextBlend = { ...node.blend };
				delete (nextBlend as { spine?: unknown }).spine;
				const next = refreshBlendNode({
					...clone(node),
					blend: nextBlend,
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

type BlendSpineEndpoint = "start" | "end";

/**
 * Updates an authored Blend spine and rematerializes generated steps. Endpoint
 * alignment is opt-in so interior path edits never move authored source objects,
 * while start/end anchor drags keep the Illustrator spine mental model intact.
 * `persistSpine: false` is reserved for default endpoint drags: the supplied
 * spine drives child alignment, then the Blend keeps its live center-to-center
 * spine by leaving `blend.spine` omitted.
 */
export function createUpdateBlendSpineCommand(
	blendNodeId: string,
	spine: BlendSpine,
	options: {
		readonly coalesceKey?: string;
		readonly label?: string;
		readonly alignEndpointCenters?: readonly BlendSpineEndpoint[];
		readonly persistSpine?: boolean;
	} = {},
): SceneCommand {
	return {
		type: "scene/update-blend-spine",
		label: options.label ?? "Edit blend spine",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!canUseCustomBlendSpine(spine)) return;
			const alignableEndpoints = !isClosedBlendSpine(spine);
			const alignStart =
				alignableEndpoints &&
				(options.alignEndpointCenters?.includes("start") ?? false);
			const alignEnd =
				alignableEndpoints &&
				options.alignEndpointCenters?.includes("end") === true;
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children) continue;
				const sourceIds = node.blend.sourceNodeIds;
				const sourceStops = node.blend.sourceStops;
				const stopFor = (nodeId: string): BlendSourceStop | undefined =>
					sourceStops?.find((stop) => stop.nodeId === nodeId);
				const firstSourceId = sourceIds[0];
				const lastSourceId = sourceIds[sourceIds.length - 1];
				const start = alignStart ? sampleBlendSpine(spine, 0).point : null;
				const end = alignEnd ? sampleBlendSpine(spine, 1).point : null;
				const nextChildren =
					start || end
						? node.children.map((child) => {
								if (start && child.id === firstSourceId) {
									return moveNodeBlendSourceStopToPoint(
										child,
										stopFor(child.id),
										start,
									);
								}
								if (end && child.id === lastSourceId) {
									return moveNodeBlendSourceStopToPoint(
										child,
										stopFor(child.id),
										end,
									);
								}
								return child;
							})
						: node.children;
				const nextBlend = { ...node.blend };
				if (options.persistSpine === false) {
					delete (nextBlend as { spine?: unknown }).spine;
				} else {
					nextBlend.spine = clone(spine);
				}
				const next = refreshBlendNode({
					...clone(node),
					children: nextChildren,
					blend: nextBlend,
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/**
 * Deletes one anchor from a Blend's authored path spine. Open path endpoints are
 * intentionally immutable because they are the source/target attachment
 * contract; closed contours allow any valid anchor deletion.
 */
export function createDeleteBlendSpineAnchorCommand(
	blendNodeId: string,
	anchorIndex: number,
): SceneCommand {
	return {
		type: "scene/delete-blend-spine-anchor",
		label: "Delete blend spine point",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children || !node.blend.spine) continue;
				const spine = removeBlendPathSpineAnchor(node.blend.spine, anchorIndex);
				if (!spine) continue;
				const next = refreshBlendNode({
					...clone(node),
					blend: {
						...node.blend,
						spine,
					},
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/**
 * Resets one selected Blend spine handle to a corner. The command intentionally
 * keeps the current spine sub-selection model outside the scene document; it only
 * replaces the stored spine and rematerializes generated children.
 */
export function createResetBlendSpineHandleCommand(
	blendNodeId: string,
	handleIndex: number,
	kind: "in" | "out",
): SceneCommand {
	return {
		type: "scene/reset-blend-spine-handle",
		label: "Reset blend spine handle",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children || !node.blend.spine) continue;
				const spine = resetBlendPathSpineHandle(
					node.blend.spine,
					handleIndex,
					kind,
				);
				if (!spine) continue;
				const next = refreshBlendNode({
					...clone(node),
					blend: {
						...node.blend,
						spine,
					},
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/**
 * Replaces a Blend container's spine with a selected top-level vector node. The
 * spine node is consumed into the Blend contract, matching Illustrator's
 * replace-spine workflow while keeping the scene graph one live object.
 */
export function createReplaceBlendSpineCommand(
	blendNodeId: string,
	spineNodeId: string,
	options: {
		readonly orientation?: BlendOrientation;
		readonly alignEndpoints?: boolean;
	} = {},
): SceneCommand {
	return {
		type: "scene/replace-blend-spine",
		label: "Replace blend spine",
		run: (draft) => {
			for (const layer of draft.layers) {
				const blendIndex = topLevelBlendIndex(layer, blendNodeId);
				const spineIndex = layer.nodes.findIndex(
					(node) => node.id === spineNodeId && !node.blend && !node.blendStep,
				);
				if (blendIndex < 0 || spineIndex < 0 || blendIndex === spineIndex) {
					continue;
				}
				const blendNode = layer.nodes[blendIndex];
				const spineNode = layer.nodes[spineIndex];
				if (!blendNode?.blend || !blendNode.children || !spineNode) continue;
				if (
					layer.locked ||
					!layer.visible ||
					spineNode.locked ||
					!spineNode.visible
				) {
					continue;
				}
				const spine = replaceableBlendSpineFromNode(spineNode);
				if (!spine) continue;
				const sourceIds = blendNode.blend.sourceNodeIds;
				const alignEndpoints =
					options.alignEndpoints !== false && !isClosedBlendSpine(spine);
				const orientation = normalizeBlendOrientation(
					options.orientation ?? blendNode.blend.orientation,
				);
				const sourceStops = blendNode.blend.sourceStops;
				const nextChildren = !alignEndpoints
					? blendNode.children
					: blendNode.children.map((child) => {
							const sourceIndex = sourceIds.indexOf(child.id);
							if (sourceIndex >= 0 && sourceIds.length > 1) {
								return moveNodeBlendSourceStopToPoint(
									child,
									sourceStops?.find((stop) => stop.nodeId === child.id),
									sampleBlendSpine(spine, sourceIndex / (sourceIds.length - 1))
										.point,
								);
							}
							return child;
						});
				const next = refreshBlendNode({
					...clone(blendNode),
					children: nextChildren,
					blend: {
						...blendNode.blend,
						spine,
						orientation,
					},
				});
				if (spineIndex > blendIndex) {
					layer.nodes.splice(spineIndex, 1);
					layer.nodes.splice(blendIndex, 1, castDraft(next));
				} else {
					layer.nodes.splice(blendIndex, 1, castDraft(next));
					layer.nodes.splice(spineIndex, 1);
				}
				return;
			}
		},
	};
}

/** Rematerializes one Blend container from its current source-stop children. */
export function createRefreshBlendCommand(blendNodeId: string): SceneCommand {
	return {
		type: "scene/refresh-blend",
		label: "Refresh blend",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				layer.nodes.splice(index, 1, castDraft(refreshBlendNode(clone(node))));
				return;
			}
		},
	};
}

/** Reverses the source order of a Blend container without changing endpoints. */
export function createReverseBlendCommand(blendNodeId: string): SceneCommand {
	return {
		type: "scene/reverse-blend",
		label: "Reverse blend",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				const next = refreshBlendNode({
					...clone(node),
					blend: {
						...node.blend,
						sourceNodeIds: [...node.blend.sourceNodeIds].toReversed(),
						...(node.blend.spine
							? { spine: reverseBlendSpine(node.blend.spine) }
							: {}),
					},
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/**
 * Reverses only the Blend's paint stacking order. Source ids, interpolation
 * direction, and spine direction are preserved; refresh uses the stacking
 * contract to keep the reversed front/back order across later edits.
 */
export function createReverseBlendFrontBackCommand(
	blendNodeId: string,
): SceneCommand {
	return {
		type: "scene/reverse-blend-front-back",
		label: "Reverse blend front/back",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend) continue;
				const stacking = normalizeBlendStacking(node.blend.stacking);
				const next = refreshBlendNode({
					...clone(node),
					blend: {
						...node.blend,
						stacking: stacking === "reversed" ? "normal" : "reversed",
					},
				});
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/**
 * Converts a Blend relationship to ordinary editable nodes by replacing the
 * container with its endpoints and generated steps.
 */
export function createExpandBlendCommand(blendNodeId: string): SceneCommand {
	return {
		type: "scene/expand-blend",
		label: "Expand blend",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children) continue;
				const refreshed = refreshBlendNode(clone(node));
				if (!refreshed.children) continue;
				const children = refreshed.children.map((child) => ({
					...bakeBlendContainerTransform(
						refreshed,
						stripBlendChildMetadata(child),
					),
					locked: false,
				}));
				layer.nodes.splice(index, 1, ...castDraft(children));
				pruneDraftComponentPropBindings(draft, new Set([node.id]));
				return;
			}
		},
	};
}

/**
 * Removes one source stop from a Blend while keeping the relationship alive.
 * The removed child leaves the container as an ordinary top-level node right
 * above the Blend, so removing a stop never destroys authored artwork. The
 * command is a no-op when only two stops remain.
 */
export function createRemoveBlendSourceCommand(options: {
	readonly blendNodeId: string;
	readonly sourceNodeId: string;
}): SceneCommand {
	return {
		type: "scene/remove-blend-source",
		label: "Remove blend stop",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, options.blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children) continue;
				if (layer.locked || !layer.visible) return;
				const sourceIds = node.blend.sourceNodeIds;
				if (
					sourceIds.length <= 2 ||
					!sourceIds.includes(options.sourceNodeId)
				) {
					return;
				}
				const removed = node.children.find(
					(child) => child.id === options.sourceNodeId,
				);
				if (!removed) return;
				const next = refreshBlendNode(
					clone({
						...node,
						children: node.children.filter(
							(child) => child.id !== options.sourceNodeId,
						),
						blend: {
							...node.blend,
							sourceNodeIds: sourceIds.filter(
								(sourceId) => sourceId !== options.sourceNodeId,
							),
						},
					}),
				);
				layer.nodes.splice(
					index,
					1,
					castDraft(next),
					castDraft(
						bakeBlendContainerTransform(next, stripBlendChildMetadata(removed)),
					),
				);
				return;
			}
		},
	};
}

/** Plans removing one stop from a Blend that keeps at least two stops. */
export function buildRemoveBlendSourceCommand(
	document: SceneDocument,
	blendNodeId: string,
	sourceNodeId: string,
): BlendCommandResult {
	const issues: BlendIssue[] = [];
	const blendEntry = findTopLevelNode(document, blendNodeId);
	if (!blendEntry?.node.blend || !blendEntry.node.children) {
		issues.push(
			issue(
				"blend.missing-source",
				"Selected Blend was not found in the scene.",
				blendNodeId,
			),
		);
		return { ok: false, issues };
	}
	if (blendEntry.layer.locked || !blendEntry.layer.visible) {
		issues.push(
			issue(
				"blend.locked-source",
				"Blends in locked or hidden layers cannot be edited.",
				blendNodeId,
				blendEntry.layer.id,
			),
		);
	}
	const sourceIds = blendEntry.node.blend.sourceNodeIds;
	const removeIndex = sourceIds.indexOf(sourceNodeId);
	if (removeIndex < 0) {
		issues.push(
			issue(
				"blend.missing-source",
				"Blend source node was not found in the Blend.",
				sourceNodeId,
			),
		);
	}
	if (sourceIds.length <= 2) {
		issues.push(
			issue(
				"blend.requires-at-least-two-sources",
				"Blend keeps at least two source stops; release the Blend instead.",
				sourceNodeId,
			),
		);
	}
	const previousId = removeIndex > 0 ? sourceIds[removeIndex - 1] : undefined;
	const nextId =
		removeIndex >= 0 && removeIndex < sourceIds.length - 1
			? sourceIds[removeIndex + 1]
			: undefined;
	if (previousId && nextId) {
		const previous = blendEntry.node.children.find(
			(child) => child.id === previousId,
		);
		const next = blendEntry.node.children.find((child) => child.id === nextId);
		if (previous && next) {
			const pairIssue = blendPairEligibilityIssue(previous, next);
			if (pairIssue) issues.push(pairIssue);
		}
	}
	if (hasErrors(issues)) return { ok: false, issues };
	return {
		ok: true,
		blendNodeId,
		sourceNodeIds: sourceIds.filter((sourceId) => sourceId !== sourceNodeId),
		layerId: blendEntry.layer.id,
		command: createRemoveBlendSourceCommand({ blendNodeId, sourceNodeId }),
		issues,
	};
}

/**
 * Reorders one Blend source stop to a new index. Only the ordered id contract
 * changes: source geometry stays put, per-source attachment stops follow their
 * node ids, and generated steps rematerialize for the new adjacencies.
 */
export function createMoveBlendSourceCommand(options: {
	readonly blendNodeId: string;
	readonly sourceNodeId: string;
	readonly toIndex: number;
}): SceneCommand {
	return {
		type: "scene/move-blend-source",
		label: "Reorder blend stops",
		run: (draft) => {
			if (!Number.isFinite(options.toIndex)) return;
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, options.blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children) continue;
				if (layer.locked || !layer.visible) return;
				const sourceIds = [...node.blend.sourceNodeIds];
				const fromIndex = sourceIds.indexOf(options.sourceNodeId);
				const toIndex = clampStopIndex(options.toIndex, sourceIds.length - 1);
				if (fromIndex < 0 || fromIndex === toIndex) return;
				sourceIds.splice(fromIndex, 1);
				sourceIds.splice(toIndex, 0, options.sourceNodeId);
				const next = refreshBlendNode(
					clone({
						...node,
						blend: { ...node.blend, sourceNodeIds: sourceIds },
					}),
				);
				layer.nodes.splice(index, 1, castDraft(next));
				return;
			}
		},
	};
}

/** Plans reordering one Blend stop, validating the resulting stop adjacencies. */
export function buildMoveBlendSourceCommand(
	document: SceneDocument,
	blendNodeId: string,
	sourceNodeId: string,
	toIndex: number,
): BlendCommandResult {
	const issues: BlendIssue[] = [];
	const blendEntry = findTopLevelNode(document, blendNodeId);
	if (!blendEntry?.node.blend || !blendEntry.node.children) {
		issues.push(
			issue(
				"blend.missing-source",
				"Selected Blend was not found in the scene.",
				blendNodeId,
			),
		);
		return { ok: false, issues };
	}
	if (blendEntry.layer.locked || !blendEntry.layer.visible) {
		issues.push(
			issue(
				"blend.locked-source",
				"Blends in locked or hidden layers cannot be edited.",
				blendNodeId,
				blendEntry.layer.id,
			),
		);
	}
	const sourceIds = [...blendEntry.node.blend.sourceNodeIds];
	const fromIndex = sourceIds.indexOf(sourceNodeId);
	if (fromIndex < 0) {
		issues.push(
			issue(
				"blend.missing-source",
				"Blend source node was not found in the Blend.",
				sourceNodeId,
			),
		);
		return { ok: false, issues };
	}
	const boundedIndex = Math.min(
		sourceIds.length - 1,
		Math.max(0, Math.round(toIndex)),
	);
	if (!Number.isFinite(toIndex) || boundedIndex === fromIndex) {
		return { ok: false, issues };
	}
	sourceIds.splice(fromIndex, 1);
	sourceIds.splice(boundedIndex, 0, sourceNodeId);
	for (let index = 0; index < sourceIds.length - 1; index += 1) {
		const from = blendEntry.node.children.find(
			(child) => child.id === sourceIds[index],
		);
		const to = blendEntry.node.children.find(
			(child) => child.id === sourceIds[index + 1],
		);
		if (!from || !to) continue;
		const pairIssue = blendPairEligibilityIssue(from, to);
		if (pairIssue) issues.push(pairIssue);
	}
	if (hasErrors(issues)) return { ok: false, issues };
	return {
		ok: true,
		blendNodeId,
		sourceNodeIds: sourceIds,
		layerId: blendEntry.layer.id,
		command: createMoveBlendSourceCommand({
			blendNodeId,
			sourceNodeId,
			toIndex: boundedIndex,
		}),
		issues,
	};
}

/**
 * Removes a Blend relationship and drops generated steps, leaving only authored
 * source stops in the current child paint order.
 */
export function createReleaseBlendCommand(blendNodeId: string): SceneCommand {
	return {
		type: "scene/release-blend",
		label: "Release blend",
		run: (draft) => {
			for (const layer of draft.layers) {
				const index = topLevelBlendIndex(layer, blendNodeId);
				const node = index >= 0 ? layer.nodes[index] : undefined;
				if (!node?.blend || !node.children) continue;
				const sourceIds = new Set(node.blend.sourceNodeIds);
				const endpoints = node.children
					.filter((child) => sourceIds.has(child.id))
					.map((child) =>
						bakeBlendContainerTransform(node, stripBlendChildMetadata(child)),
					);
				if (endpoints.length !== node.blend.sourceNodeIds.length) return;
				layer.nodes.splice(index, 1, ...castDraft(endpoints));
				pruneDraftComponentPropBindings(draft, new Set([node.id]));
				return;
			}
		},
	};
}
