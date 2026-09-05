import { bindablePropertiesForGeometryKind } from "@/entities/scene/model/bindable-property";
import type { VectorNode } from "@/entities/scene/model/types";
import type { InspectorMotionField } from "@/features/motion/model/inspector-keyframing";

/**
 * Inspector numeric authoring binding helpers.
 *
 * Stream B of the AI/code-native authoring plan: the Inspector's transform and
 * opacity numeric fields are made addressable by stable bindable-property id, and
 * geometry eligibility is answered from the bindable-property registry instead of
 * being re-derived inline. This module is intentionally pure (no React, no
 * stores) so the controller, future motion/keyframe binding (Stream C), and
 * export reporting (Stream D) can share one field-to-id contract.
 */

/**
 * Maps an Inspector transform/opacity field to its bindable-property id. `width`
 * and `height` are deliberately absent: box dimensions resize geometry/bounds and
 * are not native scene-property bindables, so they return `null`.
 */
const FIELD_TO_BINDABLE_PROPERTY_ID: Partial<
	Record<InspectorMotionField, string>
> = {
	x: "transform.x",
	y: "transform.y",
	anchorX: "transform.anchorX",
	anchorY: "transform.anchorY",
	rotation: "transform.rotation",
	opacity: "style.opacity",
};

/**
 * Resolves the bindable-property id for an Inspector numeric field, or `null`
 * when the field has no native bindable property (currently `width`/`height`).
 */
export function inspectorFieldToBindablePropertyId(
	field: InspectorMotionField,
): string | null {
	return FIELD_TO_BINDABLE_PROPERTY_ID[field] ?? null;
}

/**
 * Answers whether a node's geometry can host a bindable property, sourced from
 * the registry's eligibility rather than a duplicated geometry-kind check. Unknown
 * ids and properties that cannot target the node's geometry return `false`.
 */
export function isNodeEligibleForBindableProperty(
	node: VectorNode,
	propertyId: string,
): boolean {
	return bindablePropertiesForGeometryKind(node.geometry.kind).some(
		(descriptor) => descriptor.id === propertyId,
	);
}
