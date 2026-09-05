import {
	type AppearanceMaskChannel,
	type AppearanceMaskRelationKind,
	type AppearanceMaskRelationOrigin,
	type AppearanceMaskSourceSampling,
	MASK_RELATION_FEATHER_PROPERTY_ID,
	type MaskRelationPropertyId,
	readAppearanceMaskRelations,
} from "./appearance";
import {
	type BindablePropertySupportMatrix,
	bindablePropertyById,
} from "./bindable-property";
import type { VectorNode } from "./types";

/**
 * Object-appearance effects are the soft vector primitives that live on a node's
 * own appearance/style or its native mask relations — stroke-only blur and object
 * mask feather. They are deliberately NOT a second state model: this module only
 * *derives* a discoverable view from the canonical scene state, and every entry
 * carries the existing canonical command that writes it. There is one state owner
 * (node style / mask relation metadata); deleting or editing the underlying
 * primitive is automatically coherent because nothing is stored here.
 *
 * This contrasts with the frame-look {@link ./effect-layer-stack EffectLayerStack},
 * which stores its own ordered scalar recipe state for scene/artboard looks. Keep
 * the two surfaces separate: this is object appearance, that is frame look.
 */
export type ObjectAppearanceEffectKind = "stroke-softness" | "mask-feather";

/** The canonical command that writes one discovered object-appearance effect. */
export type ObjectAppearanceEffectWrite =
	| {
			readonly command: "scene/set-bindable-property";
			readonly nodeId: string;
			readonly propertyId: "style.strokeSoftness.blurRadius";
	  }
	| {
			readonly command: "scene/set-mask-relation-property";
			readonly contentNodeId: string;
			readonly relationId: string;
			readonly propertyId: MaskRelationPropertyId;
	  };

/** Authoring metadata for the scalar value of an object-appearance effect. */
export type ObjectAppearanceEffectControl = {
	readonly min: number;
	readonly step: number;
	readonly unit: string;
	readonly defaultValue: number;
};

/** Extra mask-relation context for a `mask-feather` effect. */
export type ObjectAppearanceMaskRelationInfo = {
	readonly relationId: string;
	readonly maskNodeId: string;
	readonly kind: AppearanceMaskRelationKind;
	readonly origin: AppearanceMaskRelationOrigin;
	readonly affectedNodeIds: readonly string[];
	/** Current coverage opacity, `0..1` (default 1). */
	readonly opacity: number;
	/** Current signed choke/spread in scene px (default 0). */
	readonly expand: number;
	/** Whether the mask is currently inverted (default false). */
	readonly invert: boolean;
	readonly channel: AppearanceMaskChannel;
	readonly sourceSampling: AppearanceMaskSourceSampling;
};

/**
 * One discoverable object-appearance effect on a node. The scalar `value` is read
 * from canonical state; `write` names the canonical command that mutates it. A
 * `0` value preserves the hard/sharp baseline.
 */
export type ObjectAppearanceEffect = {
	readonly id: string;
	readonly kind: ObjectAppearanceEffectKind;
	readonly label: string;
	readonly nodeId: string;
	readonly value: number;
	readonly enabled: boolean;
	readonly writable: boolean;
	readonly control: ObjectAppearanceEffectControl;
	readonly write: ObjectAppearanceEffectWrite;
	readonly support: BindablePropertySupportMatrix;
	readonly maskRelation?: ObjectAppearanceMaskRelationInfo;
};

/**
 * Honest per-surface fidelity for object mask feather: native on the editor
 * canvas, the client SVG export, and the standalone code/runtime export (all emit
 * the same `<mask>` + `<feGaussianBlur>` soft edge via the shared mask-svg helper),
 * unsupported in PDF, capture-only for WebM, and faithfully serialized into the
 * JSON bundle manifest.
 */
const MASK_FEATHER_SUPPORT = {
	editorCanvas: "native",
	svgExport: "native",
	pdfExport: "unsupported",
	motionRuntimeJs: "native",
	reactWrapper: "native",
	webmCapture: "capture-only",
	bundleManifest: "native",
} as const satisfies BindablePropertySupportMatrix;

const STROKE_SOFTNESS_DESCRIPTOR = bindablePropertyById(
	"style.strokeSoftness.blurRadius",
);

const STROKE_SOFTNESS_SUPPORT: BindablePropertySupportMatrix =
	STROKE_SOFTNESS_DESCRIPTOR?.support ?? MASK_FEATHER_SUPPORT;

const STROKE_SOFTNESS_CONTROL: ObjectAppearanceEffectControl = {
	min: STROKE_SOFTNESS_DESCRIPTOR?.control.min ?? 0,
	step: STROKE_SOFTNESS_DESCRIPTOR?.control.step ?? 0.5,
	unit: STROKE_SOFTNESS_DESCRIPTOR?.control.unit ?? "px",
	defaultValue:
		typeof STROKE_SOFTNESS_DESCRIPTOR?.control.defaultValue === "number"
			? STROKE_SOFTNESS_DESCRIPTOR.control.defaultValue
			: 0,
};

const MASK_FEATHER_CONTROL: ObjectAppearanceEffectControl = {
	min: 0,
	step: 0.5,
	unit: "px",
	defaultValue: 0,
};

/** Stable handle for an object-appearance effect (UI keys / agent references). */
export const strokeSoftnessEffectId = (nodeId: string): string =>
	`object-effect:stroke-softness:${nodeId}`;

/** Stable handle for one node+relation mask feather effect. */
export const maskFeatherEffectId = (
	contentNodeId: string,
	relationId: string,
): string => `object-effect:mask-feather:${contentNodeId}:${relationId}`;

/**
 * Derives the object-appearance effects present on one node from canonical state.
 *
 * - Stroke softness is listed when the node has a stroke (`strokeWidth > 0`) or a
 *   nonzero stroke blur, matching where the effect is meaningful.
 * - Mask feather is listed for every native/imported mask relation that resolves
 *   to a mask source; imported relations are read-only (`writable: false`).
 *
 * Nothing is stored: the returned list is a pure projection of the node's style
 * and mask-relation metadata.
 */
export function deriveObjectAppearanceEffects(
	node: VectorNode,
): readonly ObjectAppearanceEffect[] {
	const effects: ObjectAppearanceEffect[] = [];

	const strokeBlur = node.style.strokeSoftness?.blurRadius ?? 0;
	const strokeWidth = node.style.strokeWidth ?? 0;
	if (strokeWidth > 0 || strokeBlur > 0) {
		effects.push({
			id: strokeSoftnessEffectId(node.id),
			kind: "stroke-softness",
			label: "Stroke softness",
			nodeId: node.id,
			value: strokeBlur,
			enabled: strokeBlur > 0,
			writable: true,
			control: STROKE_SOFTNESS_CONTROL,
			write: {
				command: "scene/set-bindable-property",
				nodeId: node.id,
				propertyId: "style.strokeSoftness.blurRadius",
			},
			support: STROKE_SOFTNESS_SUPPORT,
		});
	}

	for (const relation of readAppearanceMaskRelations(node)) {
		if (!relation.maskNodeId) continue;
		const featherRadius = relation.settings?.featherRadius ?? 0;
		effects.push({
			id: maskFeatherEffectId(node.id, relation.id),
			kind: "mask-feather",
			label: `Mask feather (${relation.kind})`,
			nodeId: node.id,
			value: featherRadius,
			enabled: featherRadius > 0,
			writable: relation.origin === "native",
			control: MASK_FEATHER_CONTROL,
			write: {
				command: "scene/set-mask-relation-property",
				contentNodeId: node.id,
				relationId: relation.id,
				propertyId: MASK_RELATION_FEATHER_PROPERTY_ID,
			},
			support: MASK_FEATHER_SUPPORT,
			maskRelation: {
				relationId: relation.id,
				maskNodeId: relation.maskNodeId,
				kind: relation.kind,
				origin: relation.origin,
				affectedNodeIds: relation.affectedNodeIds,
				opacity: relation.settings?.opacity ?? 1,
				expand: relation.settings?.expand ?? 0,
				invert: relation.settings?.invert === true,
				channel: relation.settings?.channel ?? "alpha",
				sourceSampling: relation.settings?.sourceSampling ?? "pre-effects",
			},
		});
	}

	return effects;
}
