import type { SceneCommand } from "@/entities/scene/model/command";
import type { MotionConflictView } from "@/entities/scene/model/component-props";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import {
	createUpdateNodeRecipeCommand,
	createUpdateNodeStyleCommand,
	createUpdateTextNodeCommand,
	type NodeStylePatch,
	type TextStylePatch,
} from "@/entities/scene/model/node-commands";
import {
	boundsRemapNeeded,
	remapPaintListBounds,
} from "@/entities/scene/model/paint-bounds";
import { getNodeLocalBounds } from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { normalizeTextStyle } from "@/entities/scene/model/text-geometry";
import type {
	Bounds,
	NodeStyle,
	SceneDocument,
	TextStyle,
	VectorNodeKind,
} from "@/entities/scene/model/types";
import type { VisualRecipe } from "@/shared/vec-core";

export const STYLE_TRANSFER_PAYLOAD_KIND =
	"vector-motion-author/style-transfer" as const;
export const STYLE_TRANSFER_PAYLOAD_VERSION = 2 as const;

export type StyleTransferOperation = "copy-properties" | "paste-properties";

export type StyleTransferIssueCode =
	| "style-transfer.duplicate-target"
	| "style-transfer.empty-payload"
	| "style-transfer.empty-source"
	| "style-transfer.empty-targets"
	| "style-transfer.missing-source"
	| "style-transfer.missing-target"
	| "style-transfer.no-compatible-targets"
	| "style-transfer.no-style-change"
	| "style-transfer.typography-target-incompatible";

export type StyleTransferIssueSeverity = "warning" | "error";

/** Typed planning feedback for future Copy/Paste properties UI and shortcuts. */
export type StyleTransferIssue = {
	readonly code: StyleTransferIssueCode;
	readonly message: string;
	readonly severity: StyleTransferIssueSeverity;
	readonly operation: StyleTransferOperation;
	readonly sourceId?: string;
	readonly targetId?: string;
};

/**
 * Serializable Copy properties payload. It intentionally carries value-copied
 * style parts only: no node clones, id remap tables, store handles, or live
 * document references are needed to paste properties later.
 */
export type StyleTransferPayload = {
	readonly kind: typeof STYLE_TRANSFER_PAYLOAD_KIND;
	readonly schemaVersion: typeof STYLE_TRANSFER_PAYLOAD_VERSION;
	readonly source: {
		readonly documentId: string;
		readonly nodeId: string;
		readonly nodeKind: VectorNodeKind;
	};
	readonly nodeStyle?: NodeStylePatch;
	readonly textStyle?: TextStylePatch;
	/**
	 * The source node's inline vec-core "look" ({@link VectorNode.recipe}). Copied
	 * wholesale (including the motion sub-recipe, which is inert in the sampler so
	 * it cannot self-animate a static target) so "paste appearance" carries the
	 * full visual identity, not just fill/stroke/effects. Omitted when the source
	 * has no look — paste then leaves the target's existing look untouched.
	 */
	readonly recipe?: VisualRecipe;
	/**
	 * The source node's intrinsic local bounds at copy time. Gradient/mesh paints
	 * store coordinates in this node-local space, so paste refits them from here
	 * into each target's own bounds — a gradient copied from a large object fills a
	 * smaller one instead of overflowing. Omitted when the source carries no
	 * fills/strokes (nothing to refit) or for legacy payloads, in which case paste
	 * copies paints verbatim.
	 */
	readonly sourceBounds?: Bounds;
};

export type StyleTransferPayloadSuccess = {
	readonly ok: true;
	readonly payload: StyleTransferPayload;
	readonly issues: readonly StyleTransferIssue[];
};

export type StyleTransferPayloadFailure = {
	readonly ok: false;
	readonly issues: readonly StyleTransferIssue[];
};

export type StyleTransferPayloadResult =
	| StyleTransferPayloadSuccess
	| StyleTransferPayloadFailure;

export type StyleTransferCommandSuccess = {
	readonly ok: true;
	readonly command: SceneCommand;
	readonly payload: StyleTransferPayload;
	readonly targetNodeIds: readonly string[];
	readonly appliedTargetNodeIds: readonly string[];
	readonly issues: readonly StyleTransferIssue[];
};

export type StyleTransferCommandFailure = {
	readonly ok: false;
	readonly payload: StyleTransferPayload;
	readonly targetNodeIds: readonly string[];
	readonly issues: readonly StyleTransferIssue[];
};

export type StyleTransferCommandResult =
	| StyleTransferCommandSuccess
	| StyleTransferCommandFailure;

type StyleTransferTargetPlan = {
	readonly targetNodeId: string;
	readonly nodeStyle?: NodeStylePatch;
	readonly textStyle?: TextStylePatch;
	readonly recipe?: VisualRecipe;
};

type MutableNodeStylePatch = {
	-readonly [Key in keyof NodeStylePatch]?: NodeStylePatch[Key];
};

const issue = (
	code: StyleTransferIssueCode,
	message: string,
	severity: StyleTransferIssueSeverity,
	operation: StyleTransferOperation,
	options: {
		readonly sourceId?: string;
		readonly targetId?: string;
	} = {},
): StyleTransferIssue => ({
	code,
	message,
	severity,
	operation,
	...options,
});

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const sameTextStyle = (left: TextStyle, right: TextStyle): boolean =>
	left.fontFamily === right.fontFamily &&
	Object.is(left.fontSize, right.fontSize) &&
	Object.is(left.lineHeight, right.lineHeight) &&
	left.align === right.align &&
	Object.is(left.fontWeight, right.fontWeight);

const hasPatchValues = (patch: object | undefined): boolean =>
	patch !== undefined && Object.keys(patch).length > 0;

const captureNodeStylePatch = (style: NodeStyle): NodeStylePatch => ({
	fill: style.fill,
	stroke: style.stroke,
	strokeWidth: style.strokeWidth,
	opacity: style.opacity,
	...(style.fills !== undefined
		? { fills: cloneSceneDocument(style.fills) }
		: {}),
	...(style.strokes !== undefined
		? { strokes: cloneSceneDocument(style.strokes) }
		: {}),
	...(style.effects !== undefined
		? { effects: cloneSceneDocument(style.effects) }
		: {}),
	...(style.blendMode !== undefined ? { blendMode: style.blendMode } : {}),
	...(style.strokeAlign !== undefined
		? { strokeAlign: style.strokeAlign }
		: {}),
	...(style.strokeDash !== undefined
		? { strokeDash: cloneSceneDocument(style.strokeDash) }
		: {}),
	...(style.strokeDashoffset !== undefined
		? { strokeDashoffset: style.strokeDashoffset }
		: {}),
	...(style.strokeCap !== undefined ? { strokeCap: style.strokeCap } : {}),
	...(style.strokeJoin !== undefined ? { strokeJoin: style.strokeJoin } : {}),
	...(style.strokeMiterLimit !== undefined
		? { strokeMiterLimit: style.strokeMiterLimit }
		: {}),
	...(style.strokeSoftness !== undefined
		? { strokeSoftness: cloneSceneDocument(style.strokeSoftness) }
		: {}),
	...(style.strokeWidthProfile !== undefined
		? { strokeWidthProfile: cloneSceneDocument(style.strokeWidthProfile) }
		: {}),
});

const changedNodeStylePatch = (
	current: NodeStyle,
	patch: NodeStylePatch | undefined,
): NodeStylePatch | null => {
	if (!patch) return null;
	const next: MutableNodeStylePatch = {};
	if (patch.fill !== undefined && !sameSerializable(current.fill, patch.fill)) {
		next.fill = patch.fill;
	}
	if (
		patch.stroke !== undefined &&
		!sameSerializable(current.stroke, patch.stroke)
	) {
		next.stroke = patch.stroke;
	}
	if (
		patch.strokeWidth !== undefined &&
		!sameSerializable(current.strokeWidth, patch.strokeWidth)
	) {
		next.strokeWidth = patch.strokeWidth;
	}
	if (
		patch.opacity !== undefined &&
		!sameSerializable(current.opacity, patch.opacity)
	) {
		next.opacity = patch.opacity;
	}
	if (
		patch.fills !== undefined &&
		!sameSerializable(current.fills, patch.fills)
	) {
		next.fills = cloneSceneDocument(patch.fills);
	}
	if (
		patch.strokes !== undefined &&
		!sameSerializable(current.strokes, patch.strokes)
	) {
		next.strokes = cloneSceneDocument(patch.strokes);
	}
	if (
		patch.effects !== undefined &&
		!sameSerializable(current.effects, patch.effects)
	) {
		next.effects = cloneSceneDocument(patch.effects);
	}
	if (
		patch.blendMode !== undefined &&
		!sameSerializable(current.blendMode, patch.blendMode)
	) {
		next.blendMode = patch.blendMode;
	}
	if (
		patch.strokeAlign !== undefined &&
		!sameSerializable(current.strokeAlign, patch.strokeAlign)
	) {
		next.strokeAlign = patch.strokeAlign;
	}
	if (
		patch.strokeDash !== undefined &&
		!sameSerializable(current.strokeDash, patch.strokeDash)
	) {
		next.strokeDash = cloneSceneDocument(patch.strokeDash);
	}
	if (
		patch.strokeDashoffset !== undefined &&
		!sameSerializable(current.strokeDashoffset, patch.strokeDashoffset)
	) {
		next.strokeDashoffset = patch.strokeDashoffset;
	}
	if (
		patch.strokeCap !== undefined &&
		!sameSerializable(current.strokeCap, patch.strokeCap)
	) {
		next.strokeCap = patch.strokeCap;
	}
	if (
		patch.strokeJoin !== undefined &&
		!sameSerializable(current.strokeJoin, patch.strokeJoin)
	) {
		next.strokeJoin = patch.strokeJoin;
	}
	if (
		patch.strokeMiterLimit !== undefined &&
		!sameSerializable(current.strokeMiterLimit, patch.strokeMiterLimit)
	) {
		next.strokeMiterLimit = patch.strokeMiterLimit;
	}
	if (
		patch.strokeSoftness !== undefined &&
		!sameSerializable(current.strokeSoftness, patch.strokeSoftness)
	) {
		next.strokeSoftness = cloneSceneDocument(patch.strokeSoftness);
	}
	if (
		patch.strokeWidthProfile !== undefined &&
		!sameSerializable(current.strokeWidthProfile, patch.strokeWidthProfile)
	) {
		next.strokeWidthProfile = cloneSceneDocument(patch.strokeWidthProfile);
	}
	return hasPatchValues(next) ? next : null;
};

const changedTextStylePatch = (
	current: TextStyle,
	patch: TextStylePatch | undefined,
): TextStylePatch | null => {
	if (!patch) return null;
	const nextStyle = normalizeTextStyle({ ...current, ...patch });
	return sameTextStyle(current, nextStyle) ? null : cloneSceneDocument(patch);
};

const payloadHasStyle = (payload: StyleTransferPayload): boolean =>
	hasPatchValues(payload.nodeStyle) || hasPatchValues(payload.textStyle);

/**
 * Captures Copy properties data from one scene node. Text nodes include both
 * appearance and normalized typography; non-text nodes include appearance only.
 */
export function buildStyleTransferPayload(
	document: SceneDocument,
	sourceNodeId: string | null | undefined,
): StyleTransferPayloadResult {
	if (!sourceNodeId) {
		return {
			ok: false,
			issues: [
				issue(
					"style-transfer.empty-source",
					"Copy properties requires one source node.",
					"error",
					"copy-properties",
				),
			],
		};
	}

	const sourceNode = findNode(document, sourceNodeId);
	if (!sourceNode) {
		return {
			ok: false,
			issues: [
				issue(
					"style-transfer.missing-source",
					"Copy properties source node was not found in the scene.",
					"error",
					"copy-properties",
					{ sourceId: sourceNodeId },
				),
			],
		};
	}

	const payload: StyleTransferPayload = {
		kind: STYLE_TRANSFER_PAYLOAD_KIND,
		schemaVersion: STYLE_TRANSFER_PAYLOAD_VERSION,
		source: {
			documentId: document.id,
			nodeId: sourceNode.id,
			nodeKind: sourceNode.geometry.kind,
		},
		nodeStyle: captureNodeStylePatch(sourceNode.style),
		...(sourceNode.geometry.kind === "text"
			? { textStyle: normalizeTextStyle(sourceNode.geometry.style) }
			: {}),
		...(sourceNode.recipe !== undefined
			? { recipe: cloneSceneDocument(sourceNode.recipe) }
			: {}),
		...(sourceNode.style.fills !== undefined ||
		sourceNode.style.strokes !== undefined
			? { sourceBounds: getNodeLocalBounds(sourceNode) }
			: {}),
	};

	return { ok: true, payload, issues: [] };
}

const uniqueTargetIdsWithIssues = (
	targetNodeIds: readonly string[],
): {
	readonly targetNodeIds: readonly string[];
	readonly issues: readonly StyleTransferIssue[];
} => {
	const seen = new Set<string>();
	const uniqueIds: string[] = [];
	const issues: StyleTransferIssue[] = [];
	for (const targetId of targetNodeIds) {
		if (seen.has(targetId)) {
			issues.push(
				issue(
					"style-transfer.duplicate-target",
					"Paste properties target ids must be unique; duplicate target was skipped.",
					"warning",
					"paste-properties",
					{ targetId },
				),
			);
			continue;
		}
		seen.add(targetId);
		uniqueIds.push(targetId);
	}
	return { targetNodeIds: uniqueIds, issues };
};

/**
 * Refits the gradient/mesh paints in a node-style patch from the source's bounds
 * `b0` into a target's bounds `b1` so a copied gradient fills a differently-sized
 * target instead of keeping the source's absolute coordinates. Returns the patch
 * unchanged (same reference) for same-size/degenerate bounds, preserving the
 * byte-identical same-size paste path.
 */
const remapNodeStylePatchBounds = (
	patch: NodeStylePatch,
	b0: Bounds,
	b1: Bounds,
): NodeStylePatch => {
	if (!boundsRemapNeeded(b0, b1)) return patch;
	const fills = remapPaintListBounds(patch.fills, b0, b1);
	const strokes = remapPaintListBounds(patch.strokes, b0, b1);
	if (fills === patch.fills && strokes === patch.strokes) return patch;
	return {
		...patch,
		...(fills !== undefined ? { fills } : {}),
		...(strokes !== undefined ? { strokes } : {}),
	};
};

const planTarget = (
	document: SceneDocument,
	payload: StyleTransferPayload,
	targetNodeId: string,
): {
	readonly plan: StyleTransferTargetPlan | null;
	readonly issues: readonly StyleTransferIssue[];
} => {
	const targetNode = findNode(document, targetNodeId);
	if (!targetNode) {
		return {
			plan: null,
			issues: [
				issue(
					"style-transfer.missing-target",
					"Paste properties target node was not found in the scene.",
					"warning",
					"paste-properties",
					{ targetId: targetNodeId },
				),
			],
		};
	}

	const issues: StyleTransferIssue[] = [];
	// Refit gradient/mesh paints to this target's size before diffing, so a
	// gradient copied from a larger object fills a smaller one (and a same-size
	// target diffs byte-identically to today).
	const sourceBounds = payload.sourceBounds;
	const remappedNodeStyle =
		sourceBounds && payload.nodeStyle
			? remapNodeStylePatchBounds(
					payload.nodeStyle,
					sourceBounds,
					getNodeLocalBounds(targetNode),
				)
			: payload.nodeStyle;
	const nodeStyle = changedNodeStylePatch(targetNode.style, remappedNodeStyle);
	let textStyle: TextStylePatch | null = null;
	const canReceiveNodeStyle = hasPatchValues(payload.nodeStyle);
	let canReceiveTextStyle = false;
	// The inline "look" is node-local, reference-free data, so each target gets an
	// independent deep clone (editing one pasted look must never mutate siblings),
	// matching the fills[]/strokes[] clone discipline above.
	const recipe =
		payload.recipe !== undefined &&
		!sameSerializable(targetNode.recipe, payload.recipe)
			? cloneSceneDocument(payload.recipe)
			: null;
	const canReceiveRecipe = payload.recipe !== undefined;

	if (payload.textStyle) {
		if (targetNode.geometry.kind === "text") {
			canReceiveTextStyle = true;
			textStyle = changedTextStylePatch(
				normalizeTextStyle(targetNode.geometry.style),
				payload.textStyle,
			);
		} else {
			issues.push(
				issue(
					"style-transfer.typography-target-incompatible",
					"Paste properties payload includes typography, but this target is not a text node.",
					"warning",
					"paste-properties",
					{ targetId: targetNode.id },
				),
			);
		}
	}

	if (!nodeStyle && !textStyle && !recipe) {
		if (canReceiveNodeStyle || canReceiveTextStyle || canReceiveRecipe) {
			issues.push(
				issue(
					"style-transfer.no-style-change",
					"Paste properties target already matches the transferable style parts.",
					"warning",
					"paste-properties",
					{ targetId: targetNode.id },
				),
			);
		}
		return { plan: null, issues };
	}

	return {
		plan: {
			targetNodeId: targetNode.id,
			...(nodeStyle ? { nodeStyle } : {}),
			...(textStyle ? { textStyle } : {}),
			...(recipe ? { recipe } : {}),
		},
		issues,
	};
};

const createApplyStyleTransferCommand = (
	targetPlans: readonly StyleTransferTargetPlan[],
	label: string,
	grammarTargetNodeIds?: ReadonlySet<string>,
	motion?: MotionConflictView,
): SceneCommand => ({
	type: "scene/apply-style-transfer",
	label,
	run: (draft) => {
		for (const target of targetPlans) {
			if (target.nodeStyle) {
				createUpdateNodeStyleCommand(target.targetNodeId, target.nodeStyle, {
					grammarTargetNodeIds,
					motion,
				}).run(draft);
			}
			if (target.textStyle) {
				createUpdateTextNodeCommand(
					target.targetNodeId,
					{ style: target.textStyle },
					{ label },
				).run(draft);
			}
			if (target.recipe) {
				// Write the captured look raw (no normalizeVisualRecipe): it round-trips
				// from an already-valid source node, so normalizing here would silently
				// alter copied looks. node.recipe is disjoint from node.style/text, so
				// the write order within this loop is irrelevant.
				createUpdateNodeRecipeCommand(target.targetNodeId, target.recipe).run(
					draft,
				);
			}
		}
	},
});

/**
 * Plans a Paste properties operation for the scene command bus. Compatible
 * target changes are grouped into one command while stale or incompatible
 * targets are returned as typed issues for future UI surfacing.
 */
export function buildApplyStyleTransferCommand(
	document: SceneDocument,
	payload: StyleTransferPayload,
	targetNodeIds: readonly string[],
	options: {
		readonly label?: string;
		readonly grammarTargetNodeIds?: ReadonlySet<string>;
		readonly motion?: MotionConflictView;
	} = {},
): StyleTransferCommandResult {
	const { targetNodeIds: uniqueTargetIds, issues: duplicateIssues } =
		uniqueTargetIdsWithIssues(targetNodeIds);
	const issues: StyleTransferIssue[] = [...duplicateIssues];

	if (!payloadHasStyle(payload)) {
		return {
			ok: false,
			payload,
			targetNodeIds: uniqueTargetIds,
			issues: [
				...issues,
				issue(
					"style-transfer.empty-payload",
					"Paste properties requires a payload with node style or text style.",
					"error",
					"paste-properties",
					{ sourceId: payload.source.nodeId },
				),
			],
		};
	}

	if (uniqueTargetIds.length === 0) {
		return {
			ok: false,
			payload,
			targetNodeIds: uniqueTargetIds,
			issues: [
				...issues,
				issue(
					"style-transfer.empty-targets",
					"Paste properties requires at least one target node.",
					"error",
					"paste-properties",
					{ sourceId: payload.source.nodeId },
				),
			],
		};
	}

	const targetPlans: StyleTransferTargetPlan[] = [];
	for (const targetNodeId of uniqueTargetIds) {
		const planned = planTarget(document, payload, targetNodeId);
		issues.push(...planned.issues);
		if (planned.plan) targetPlans.push(planned.plan);
	}

	if (targetPlans.length === 0) {
		return {
			ok: false,
			payload,
			targetNodeIds: uniqueTargetIds,
			issues: [
				...issues,
				issue(
					"style-transfer.no-compatible-targets",
					"Paste properties found no target that can receive a style change.",
					"error",
					"paste-properties",
					{ sourceId: payload.source.nodeId },
				),
			],
		};
	}

	return {
		ok: true,
		command: createApplyStyleTransferCommand(
			targetPlans,
			options.label ?? "Paste properties",
			options.grammarTargetNodeIds,
			options.motion,
		),
		payload,
		targetNodeIds: uniqueTargetIds,
		appliedTargetNodeIds: targetPlans.map((target) => target.targetNodeId),
		issues,
	};
}
