import { readImportedAppearance } from "@/entities/scene/model/appearance";
import { sceneAssetForGeometry } from "@/entities/scene/model/assets";
import { findComponentSymbol } from "@/entities/scene/model/component-symbols";
import { normalizeTextGeometry } from "@/entities/scene/model/rendering";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";

export type StageGInspectorReadoutRow = {
	readonly label: string;
	readonly value: string;
	readonly tone: "default" | "good" | "warning";
};

export type StageGInspectorReadout = {
	readonly rows: readonly StageGInspectorReadoutRow[];
	readonly hasSignal: boolean;
};

const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const dataRecord = (node: VectorNode): Record<string, unknown> =>
	node.data ?? {};

const hasImportTextMetadata = (node: VectorNode): boolean =>
	typeof dataRecord(node).importText === "object" &&
	dataRecord(node).importText !== null;

const hasImportImageMetadata = (node: VectorNode): boolean =>
	typeof dataRecord(node).importImage === "object" &&
	dataRecord(node).importImage !== null;

const componentRowForNodes = (
	document: SceneDocument,
	nodes: readonly VectorNode[],
): StageGInspectorReadoutRow | null => {
	let sourceCount = 0;
	let instanceCount = 0;
	let overrideCount = 0;
	let missingSymbolCount = 0;
	for (const node of nodes) {
		const binding = node.component;
		if (!binding) continue;
		const symbol = findComponentSymbol(document, binding.symbolId);
		if (!symbol) missingSymbolCount += 1;
		if (binding.kind === "source") {
			sourceCount += 1;
			continue;
		}
		instanceCount += 1;
		overrideCount += binding.overrides?.length ?? 0;
	}
	if (sourceCount + instanceCount === 0) return null;
	const parts = [
		sourceCount > 0 ? `${sourceCount} src` : null,
		instanceCount > 0 ? `${instanceCount} inst` : null,
		overrideCount > 0 ? `${overrideCount} overrides` : null,
		missingSymbolCount > 0 ? `${missingSymbolCount} missing` : null,
	].filter((part): part is string => part !== null);
	return {
		label: "Component",
		value: parts.join(" / "),
		tone: missingSymbolCount > 0 ? "warning" : "good",
	};
};

const imageRowForNodes = (
	document: SceneDocument,
	nodes: readonly VectorNode[],
): StageGInspectorReadoutRow | null => {
	let imageCount = 0;
	let videoCount = 0;
	let externalCount = 0;
	let dataUrlCount = 0;
	let referenceCount = 0;
	let missingCount = 0;
	let importedCount = 0;
	for (const node of nodes) {
		if (node.geometry.kind !== "image") continue;
		const asset = sceneAssetForGeometry(document, node.geometry);
		if (asset?.kind === "video") {
			videoCount += 1;
		} else if (
			asset?.kind === "external-scene" ||
			asset?.kind === "model-3d" ||
			asset?.kind === "code-module"
		) {
			externalCount += 1;
		} else {
			imageCount += 1;
		}
		if (hasImportImageMetadata(node)) importedCount += 1;
		if (!asset) {
			missingCount += 1;
			continue;
		}
		if (asset.source.kind === "data-url") dataUrlCount += 1;
		if (asset.source.kind === "reference") referenceCount += 1;
	}
	if (imageCount + videoCount + externalCount === 0) return null;
	const parts = [
		imageCount > 0 ? plural(imageCount, "image") : null,
		videoCount > 0 ? plural(videoCount, "video") : null,
		externalCount > 0 ? plural(externalCount, "external asset") : null,
		dataUrlCount > 0 ? `${dataUrlCount} embedded` : null,
		referenceCount > 0 ? `${referenceCount} ref` : null,
		importedCount > 0 ? `${importedCount} imported` : null,
		missingCount > 0 ? `${missingCount} missing asset` : null,
	].filter((part): part is string => part !== null);
	return {
		label: "Asset",
		value: parts.join(" / "),
		tone: missingCount > 0 ? "warning" : "good",
	};
};

const appearanceRowForNodes = (
	nodes: readonly VectorNode[],
): StageGInspectorReadoutRow | null => {
	let effects = 0;
	let opacityGroups = 0;
	let paintFallbacks = 0;
	let compoundPaths = 0;
	for (const node of nodes) {
		const appearance = readImportedAppearance(node);
		effects += appearance.effects.length;
		opacityGroups += appearance.opacityGroups.length;
		if (appearance.paint?.fill) paintFallbacks += 1;
		if (appearance.paint?.stroke) paintFallbacks += 1;
		if (appearance.compoundPath) compoundPaths += 1;
	}
	const total = effects + opacityGroups + paintFallbacks + compoundPaths;
	if (total === 0) return null;
	const parts = [
		effects > 0 ? `${effects} effects` : null,
		opacityGroups > 0 ? `${opacityGroups} opacity` : null,
		paintFallbacks > 0 ? `${paintFallbacks} paint` : null,
		compoundPaths > 0 ? `${compoundPaths} compound` : null,
	].filter((part): part is string => part !== null);
	return {
		label: "Fidelity",
		value: parts.join(" / "),
		tone: "warning",
	};
};

const typographyRowForNodes = (
	nodes: readonly VectorNode[],
): StageGInspectorReadoutRow | null => {
	let textCount = 0;
	let styledCount = 0;
	let importedCount = 0;
	const families = new Set<string>();
	for (const node of nodes) {
		if (node.geometry.kind !== "text") continue;
		textCount += 1;
		const text = normalizeTextGeometry(node.geometry);
		families.add(text.style.fontFamily);
		if (node.geometry.style && Object.keys(node.geometry.style).length > 0) {
			styledCount += 1;
		}
		if (hasImportTextMetadata(node)) importedCount += 1;
	}
	if (textCount === 0) return null;
	const familyLabel =
		families.size === 1 ? [...families][0] : `${families.size} families`;
	const parts = [
		plural(textCount, "text"),
		styledCount > 0 ? `${styledCount} styled` : null,
		importedCount > 0 ? `${importedCount} imported` : null,
		familyLabel,
	].filter((part): part is string => part !== null);
	return {
		label: "Type",
		value: parts.join(" / "),
		tone: styledCount > 0 || importedCount > 0 ? "good" : "default",
	};
};

/**
 * Builds the compact production-fidelity readout shown by Inspector. It is
 * read-only by design: Stage G domain metadata remains in scene/motion helpers,
 * while the widget layer only summarizes what the selected nodes already carry.
 */
export function createStageGInspectorReadout(
	document: SceneDocument,
	nodes: readonly VectorNode[],
): StageGInspectorReadout {
	const rows = [
		componentRowForNodes(document, nodes),
		imageRowForNodes(document, nodes),
		appearanceRowForNodes(nodes),
		typographyRowForNodes(nodes),
	].filter((row): row is StageGInspectorReadoutRow => row !== null);
	return {
		rows,
		hasSignal: rows.length > 0,
	};
}
