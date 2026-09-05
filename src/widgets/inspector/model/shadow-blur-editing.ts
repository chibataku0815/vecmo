/**
 * Inspector editing for node-level shadow (drop/inner) and layer-blur effects.
 */
import type { NodeStylePatch } from "@/entities/scene/model/node-commands";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	BlurEffect,
	Effect,
	ShadowEffect,
	ShadowEffectKind,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	applyStylePatchEntriesAsTransaction,
	clampOpacity,
	DEFAULT_LAYER_BLUR,
	type DropShadowNumberField,
	defaultShadowForKind,
	isLayerBlur,
	isShadowOfKind,
	layerBlurEnabled,
	layerBlurForNode,
	normalizeColorInput,
	type ShadowNumberField,
	shadowEnabled,
	shadowForNode,
	uniqueNodeIds,
} from "./editing-shared";

const upsertShadow = (
	effects: readonly Effect[] | undefined,
	kind: ShadowEffectKind,
	update: (shadow: ShadowEffect) => ShadowEffect,
): readonly Effect[] => {
	const currentEffects = effects ?? [];
	const shadowIndex = currentEffects.findIndex(isShadowOfKind(kind));
	if (shadowIndex < 0) {
		return [update(defaultShadowForKind(kind)), ...currentEffects];
	}
	const match = isShadowOfKind(kind);
	return currentEffects.map((effect, index) =>
		index === shadowIndex && match(effect) ? update(effect) : effect,
	);
};

const shadowPatchForNode = (
	node: VectorNode,
	kind: ShadowEffectKind,
	update: (shadow: ShadowEffect) => ShadowEffect,
): NodeStylePatch => ({
	effects: upsertShadow(node.style.effects, kind, update),
});

const upsertBlur = (
	effects: readonly Effect[] | undefined,
	update: (blur: BlurEffect) => BlurEffect,
): readonly Effect[] => {
	const currentEffects = effects ?? [];
	const blurIndex = currentEffects.findIndex(isLayerBlur);
	if (blurIndex < 0) return [update(DEFAULT_LAYER_BLUR), ...currentEffects];
	return currentEffects.map((effect, index) =>
		index === blurIndex && isLayerBlur(effect) ? update(effect) : effect,
	);
};

const layerBlurPatchForNode = (
	node: VectorNode,
	update: (blur: BlurEffect) => BlurEffect,
): NodeStylePatch => ({
	effects: upsertBlur(node.style.effects, update),
});

/**
 * Enables or hides the first shadow effect of `kind` without disturbing other
 * effects. Disabling when no matching shadow exists is a no-op so the toggle
 * never writes an invisible default into the scene.
 */
export function commitShadowEnabled(
	nodeIds: readonly string[],
	kind: ShadowEffectKind,
	enabled: boolean,
): boolean {
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		if (shadowEnabled(node, kind) === enabled) return [];
		if (!enabled && !shadowForNode(node, kind)) return [];
		return [
			{
				nodeId,
				patch: shadowPatchForNode(node, kind, (shadow) => ({
					...shadow,
					visible: enabled,
				})),
			},
		];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${kind}:enabled:${nodeIds.join(",")}`,
		"Edit effect",
		entries,
	);
}

/** Commits the first shadow color of `kind`, creating the effect when needed. */
export function commitShadowColor(
	nodeIds: readonly string[],
	kind: ShadowEffectKind,
	input: string,
	coalesceKey?: string,
): boolean {
	const color = normalizeColorInput(input);
	if (!color || color === "none") return false;
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		return [
			{
				nodeId,
				patch: shadowPatchForNode(node, kind, (shadow) => ({
					...shadow,
					color,
					visible: true,
				})),
			},
		];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${kind}:color:${nodeIds.join(",")}`,
		"Edit effect",
		entries,
		coalesceKey,
	);
}

const normalizedShadowNumber = (
	field: ShadowNumberField,
	value: number,
): number | null => {
	if (!Number.isFinite(value)) return null;
	if (field === "opacity") return clampOpacity(value);
	if (field === "radius" || field === "spread")
		return value >= 0 ? value : null;
	return value;
};

/** Commits one numeric field on the first shadow effect of `kind`. */
export function commitShadowNumber(
	nodeIds: readonly string[],
	kind: ShadowEffectKind,
	field: ShadowNumberField,
	value: number,
): boolean {
	const normalized = normalizedShadowNumber(field, value);
	if (normalized === null) return false;
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		return [
			{
				nodeId,
				patch: shadowPatchForNode(node, kind, (shadow) => {
					if (field === "x") {
						return {
							...shadow,
							offset: { ...shadow.offset, x: normalized },
							visible: true,
						};
					}
					if (field === "y") {
						return {
							...shadow,
							offset: { ...shadow.offset, y: normalized },
							visible: true,
						};
					}
					return { ...shadow, [field]: normalized, visible: true };
				}),
			},
		];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:${kind}:${field}:${nodeIds.join(",")}`,
		"Edit effect",
		entries,
	);
}

/**
 * Enables or hides the layer-blur effect without disturbing other effects.
 * Disabling when no blur exists is a no-op so the toggle never writes an
 * invisible default into the scene.
 */
export function commitLayerBlurEnabled(
	nodeIds: readonly string[],
	enabled: boolean,
): boolean {
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		if (layerBlurEnabled(node) === enabled) return [];
		if (!enabled && !layerBlurForNode(node)) return [];
		return [
			{
				nodeId,
				patch: layerBlurPatchForNode(node, (blur) => ({
					...blur,
					visible: enabled,
				})),
			},
		];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:layer-blur:enabled:${nodeIds.join(",")}`,
		"Edit effect",
		entries,
	);
}

export type LayerBlurAxis = "x" | "y";

/**
 * Commits one axis of layer blur, creating the effect when needed. X writes the
 * legacy `radius`; Y writes an explicit `radiusY` and therefore unlinks the
 * axes. Updating X preserves an already-authored Y radius.
 */
export function commitLayerBlurAxisNumber(
	nodeIds: readonly string[],
	axis: LayerBlurAxis,
	value: number,
): boolean {
	if (!Number.isFinite(value) || value < 0) return false;
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		return [
			{
				nodeId,
				patch: layerBlurPatchForNode(node, (blur) =>
					axis === "x"
						? { ...blur, radius: value, visible: true }
						: { ...blur, radiusY: value, visible: true },
				),
			},
		];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:layer-blur:radius-${axis}:${nodeIds.join(",")}`,
		"Edit effect",
		entries,
	);
}

/** Legacy scalar wrapper: commits X while preserving linked/unlinked state. */
export function commitLayerBlurNumber(
	nodeIds: readonly string[],
	value: number,
): boolean {
	return commitLayerBlurAxisNumber(nodeIds, "x", value);
}

/**
 * Links or unlinks X/Y layer blur for every selected node that already owns a
 * blur. Unlink seeds Y from X once; relink removes `radiusY`, restoring the
 * byte-compatible legacy scalar representation. A missing blur is not created,
 * and an existing blur's visibility is preserved by this structural toggle.
 */
export function commitLayerBlurAxesLinked(
	nodeIds: readonly string[],
	linked: boolean,
): boolean {
	const document = useSceneStore.getState().document;
	const entries = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		const current = node ? layerBlurForNode(node) : null;
		if (!node || !current) return [];
		const currentlyLinked = current.radiusY === undefined;
		if (currentlyLinked === linked) return [];
		return [
			{
				nodeId,
				patch: layerBlurPatchForNode(node, (blur) => {
					if (!linked) return { ...blur, radiusY: blur.radius };
					const { radiusY: _radiusY, ...relinked } = blur;
					return relinked;
				}),
			},
		];
	});
	return applyStylePatchEntriesAsTransaction(
		`style:layer-blur:axes-linked:${nodeIds.join(",")}`,
		"Edit effect",
		entries,
	);
}

/** Drop-shadow wrapper kept for existing call sites and tests. */
export function commitDropShadowEnabled(
	nodeIds: readonly string[],
	enabled: boolean,
): boolean {
	return commitShadowEnabled(nodeIds, "drop-shadow", enabled);
}

/** Drop-shadow wrapper kept for existing call sites and tests. */
export function commitDropShadowColor(
	nodeIds: readonly string[],
	input: string,
	coalesceKey?: string,
): boolean {
	return commitShadowColor(nodeIds, "drop-shadow", input, coalesceKey);
}

/** Drop-shadow wrapper kept for existing call sites and tests. */
export function commitDropShadowNumber(
	nodeIds: readonly string[],
	field: DropShadowNumberField,
	value: number,
): boolean {
	return commitShadowNumber(nodeIds, "drop-shadow", field, value);
}
