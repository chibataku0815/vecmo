import type { MotionDocument } from "@/entities/motion/model/types";
import {
	type DuplicateGeneratorBinding,
	expandDuplicateGenerator,
} from "@/entities/scene/model/duplicate-generator";
import {
	type EffectLayer,
	type EffectLayerOwnerRef,
	effectLayerStackFromIntent,
} from "@/entities/scene/model/effect-layer-stack";
import {
	findArtboardById,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type {
	EffectIntent,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";

/**
 * Visual priority for read-only scene side-car rows in the filming HUD. These
 * rows are not timeline keys, but reuse the existing badge system so captures
 * can compare native, Look, Duplicate, and Effect Stack values consistently.
 */
export type SceneSidecarCaptureRowEmphasis =
	| "keyed"
	| "animated"
	| "changed"
	| "rest";

/**
 * Read-only row shown by the Parameter Capture HUD for scene side-cars that are
 * evaluated outside the node's native transform/style properties.
 */
export type SceneSidecarCaptureRow = {
	readonly id: string;
	readonly label: string;
	readonly displayValue: string;
	readonly deltaDisplay: string | null;
	readonly animated: boolean;
	readonly keyedAtFrame: boolean;
	readonly emphasis: SceneSidecarCaptureRowEmphasis;
};

/**
 * Captured Codeable Duplicate generator values for the selected source node at
 * the current playhead frame.
 */
export type DuplicateGeneratorCaptureTarget = {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly sourceName: string;
	readonly frame: number;
	readonly rows: readonly SceneSidecarCaptureRow[];
	readonly activeRowCount: number;
};

/**
 * Captured frame/scene Effect Stack summary rows. The HUD presents layer-level
 * mix/blend/kind state instead of expanding every recipe-specific internal.
 */
export type EffectStackCaptureTarget = {
	readonly id: string;
	readonly scopeLabel: string;
	readonly layerCount: number;
	readonly rows: readonly SceneSidecarCaptureRow[];
	readonly activeRowCount: number;
};

type EffectStackSource = {
	readonly scopeLabel: string;
	readonly layers: readonly EffectLayer[];
};

const frameForCapture = (currentFrame: number): number =>
	Number.isFinite(currentFrame) ? Math.max(0, Math.round(currentFrame)) : 0;

const fpsForCapture = (motion: MotionDocument): number =>
	Number.isFinite(motion.fps) && motion.fps > 0 ? motion.fps : 30;

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	if (Number.isInteger(value)) return String(value);
	return String(Number(value.toFixed(2)));
};

const formatPercent = (value: number): string =>
	`${formatNumber(Math.min(1, Math.max(0, value)) * 100)}%`;

const titleFromToken = (token: string): string =>
	token
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

const expressionLabel = (
	expression: { readonly source: string } | undefined,
	fallback: string,
): string => {
	if (!expression) return fallback;
	const source = expression.source.trim();
	return source.length > 0 ? source : fallback;
};

const row = ({
	id,
	label,
	displayValue,
	deltaDisplay,
	emphasis,
}: {
	readonly id: string;
	readonly label: string;
	readonly displayValue: string;
	readonly deltaDisplay: string | null;
	readonly emphasis: SceneSidecarCaptureRowEmphasis;
}): SceneSidecarCaptureRow => ({
	id,
	label,
	displayValue,
	deltaDisplay,
	animated: false,
	keyedAtFrame: false,
	emphasis,
});

const duplicateGeneratorForNode = (
	document: SceneDocument,
	nodeId: string,
): DuplicateGeneratorBinding | null =>
	document.duplicateGenerators?.find(
		(generator) => generator.sourceNodeId === nodeId,
	) ?? null;

/**
 * Builds the filmed parameter set for the selected node's Codeable Duplicate
 * generator. Values are evaluated at the playhead, while the supporting text
 * keeps the original expression visible for tutorial capture.
 */
export function buildDuplicateGeneratorCaptureTarget({
	document,
	motion,
	node,
	currentFrame,
}: {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly node: VectorNode | null;
	readonly currentFrame: number;
}): DuplicateGeneratorCaptureTarget | null {
	if (!node) return null;
	const generator = duplicateGeneratorForNode(document, node.id);
	if (!generator) return null;
	const frame = frameForCapture(currentFrame);
	const samples = expandDuplicateGenerator(generator, {
		frame,
		time: frame / fpsForCapture(motion),
	});
	const first = samples[0] ?? null;
	const rows = [
		row({
			id: "count",
			label: "Count",
			displayValue: String(samples.length),
			deltaDisplay: expressionLabel(generator.count, "count expression"),
			emphasis: samples.length > 0 ? "changed" : "rest",
		}),
		row({
			id: "x",
			label: "X per copy",
			displayValue: `${formatNumber(first?.translate?.x ?? 0)}px`,
			deltaDisplay: expressionLabel(generator.instance.x, "0px"),
			emphasis: generator.instance.x ? "changed" : "rest",
		}),
		row({
			id: "y",
			label: "Y per copy",
			displayValue: `${formatNumber(first?.translate?.y ?? 0)}px`,
			deltaDisplay: expressionLabel(generator.instance.y, "0px"),
			emphasis: generator.instance.y ? "changed" : "rest",
		}),
		row({
			id: "rotation",
			label: "Rotation per copy",
			displayValue: `${formatNumber(first?.rotate ?? 0)}deg`,
			deltaDisplay: expressionLabel(generator.instance.rotation, "0deg"),
			emphasis: generator.instance.rotation ? "changed" : "rest",
		}),
	];
	return {
		id: generator.id,
		sourceNodeId: node.id,
		sourceName: node.name,
		frame,
		rows,
		activeRowCount: rows.filter((item) => item.emphasis !== "rest").length,
	};
}

const stackFromIntent = ({
	intent,
	owner,
	scopeLabel,
}: {
	readonly intent: EffectIntent | undefined;
	readonly owner: EffectLayerOwnerRef;
	readonly scopeLabel: string;
}): EffectStackSource | null => {
	const stack = effectLayerStackFromIntent(intent, owner);
	const layers = stack?.layers ?? [];
	return layers.length > 0 ? { scopeLabel, layers } : null;
};

const effectStackSource = (
	document: SceneDocument,
	artboardId: string,
): EffectStackSource | null => {
	const artboard =
		findArtboardById(document, artboardId) ?? selectCurrentArtboard(document);
	return (
		stackFromIntent({
			intent: artboard.effectIntent,
			owner: { scope: "artboard", artboardId: artboard.id },
			scopeLabel: "Frame Look",
		}) ??
		stackFromIntent({
			intent: document.effectIntent,
			owner: { scope: "scene" },
			scopeLabel: "Scene Look",
		})
	);
};

const layerRow = (
	layer: EffectLayer,
	index: number,
): SceneSidecarCaptureRow => {
	const active = layer.enabled && layer.mix > 0;
	const adaptation = layer.adaptation?.source ?? "none";
	return row({
		id: layer.id,
		label: layer.label || `Layer ${index + 1}`,
		displayValue: active ? formatPercent(layer.mix) : "OFF",
		deltaDisplay: `${titleFromToken(layer.kind)} / ${titleFromToken(
			layer.blendMode,
		)} / ${titleFromToken(adaptation)}`,
		emphasis: active ? "changed" : "rest",
	});
};

/**
 * Builds the filmed parameter set for the active frame-level Effect Stack. The
 * current artboard wins over scene-level intent, matching the Inspector's Frame
 * Look precedence while staying read-only for capture.
 */
export function buildEffectStackCaptureTarget({
	document,
	artboardId,
}: {
	readonly document: SceneDocument;
	readonly artboardId: string;
}): EffectStackCaptureTarget | null {
	const source = effectStackSource(document, artboardId);
	if (!source) return null;
	const rows = source.layers.map(layerRow);
	return {
		id: source.scopeLabel,
		scopeLabel: source.scopeLabel,
		layerCount: source.layers.length,
		rows,
		activeRowCount: rows.filter((item) => item.emphasis !== "rest").length,
	};
}
