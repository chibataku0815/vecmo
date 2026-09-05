import type {
	ComponentPropBindingIssue,
	ComponentPropSharedNumberOwnershipConflictKind,
	SharedNumberPropertyId,
} from "@/entities/scene/model/component-props";

const propertyLabel = (propertyId: SharedNumberPropertyId): string =>
	propertyId === "transform.rotation" ? "Rotation" : "Opacity";

const ownershipLabel: Readonly<
	Record<ComponentPropSharedNumberOwnershipConflictKind, string>
> = {
	"duplicate-number-prop": "another Shared value",
	"native-expression": "a native expression",
	"property-relation": "a property relation",
	"motion-parent": "motion parenting",
	"transform-constraint": "a transform constraint",
	"motion-grammar": "Motion Grammar",
	"component-override": "a component override",
};

/** Converts entity ownership classifications into exact, visible Inspector copy. */
export function sharedNumberOwnershipReason(
	conflicts: readonly ComponentPropSharedNumberOwnershipConflictKind[],
	propertyId: SharedNumberPropertyId,
	nodeId: string,
): string {
	const owners = conflicts.map((conflict) => ownershipLabel[conflict]);
	return `${propertyLabel(propertyId)} on ${nodeId} is controlled by ${owners.join(
		", ",
	)}.`;
}

/** Converts binding eligibility/animation failures into exact Inspector copy. */
export function sharedNumberBindingIssueReason(
	issue: ComponentPropBindingIssue,
	propertyId: SharedNumberPropertyId,
	nodeId: string,
): string {
	const label = propertyLabel(propertyId);
	switch (issue.kind) {
		case "node-missing":
			return `Target node ${issue.nodeId} is missing.`;
		case "binding-animated-conflict":
			return `${label} on ${nodeId} is keyframed (${issue.property}).`;
		case "bindable-property-not-eligible":
			return `${label} is not eligible on ${nodeId}.`;
		case "bindable-property-unknown":
			return `Binding property ${issue.propertyId} is unknown.`;
		case "bindable-property-not-numeric":
			return `Binding property ${issue.propertyId} is not numeric.`;
		case "type-mismatch":
			return `Binding kind ${issue.bindingKind} cannot drive a number prop.`;
		case "style-color-not-solid":
		case "text-content-not-text-node":
			return `${label} has an incompatible binding on ${nodeId}.`;
	}
}
