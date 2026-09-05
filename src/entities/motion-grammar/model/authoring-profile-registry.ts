import type { MotionGrammarAuthoringProfileDescriptor } from "./authoring-profile";
import { findCatalogEntry } from "./catalog";
import { describeMotionGrammarTechniqueAuthoringProfile } from "./technique-module";
import type { MotionGrammarBinding } from "./types";
import { motionGrammarParameterSpecsForBinding } from "./versioned-expression-binding";

const describeCatalogBackedAuthoringProfile = (
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined => {
	const entry = findCatalogEntry(binding.techniqueId);
	if (entry?.status !== "implemented") return undefined;
	const parameters = motionGrammarParameterSpecsForBinding(binding).map(
		(spec) => ({
			...spec,
			role: "motion" as const,
		}),
	);
	const instances = binding.targetIds.map((nodeId, index) => {
		const role = binding.roleMap?.[nodeId] ?? `target-${index + 1}`;
		return {
			index,
			slotId: `${binding.id}:${role}:${index}`,
			reference: { kind: "scene-node" as const, nodeId },
			nodeId,
			role,
			roleLabel: role,
			kind: "source" as const,
			editable: true,
			replaceable: binding.techniqueId !== "stroke-draw-on",
		};
	});
	const isLiveOnly = binding.techniqueId === "stroke-draw-on";
	return {
		bindingId: binding.id,
		techniqueId: binding.techniqueId,
		label: entry.label,
		summary: `${entry.label} uses ordered scene targets and catalog-backed editable output.`,
		kind: isLiveOnly ? "master-instances" : "baked-tracks",
		timeline: {
			mode: isLiveOnly ? "trackless-expression" : "scalar-tracks",
			bakePolicy: isLiveOnly ? "not-supported" : "explicit-command",
			clipLabel: entry.label,
		},
		expansion: {
			mode: isLiveOnly ? "live-only" : "editable-motion",
			label: isLiveOnly ? "Live semantic output" : "Editable output",
			actionLabel: isLiveOnly ? "Live output only" : "Create editable motion",
			previewLabel: isLiveOnly
				? "Live output contract"
				: "Preview editable output",
			description: isLiveOnly
				? "This technique drives a semantic presentation channel directly; edit its binding parameters or remove the binding instead of baking unsupported tracks."
				: "Materializes the registered decomposition into ordinary editable scene and Motion artifacts.",
			outputSummary: isLiveOnly
				? "Stroke dash offset remains a live Motion Grammar channel because MotionDocument has no equivalent editable scalar property."
				: "Registered scalar, snapshot, geometry, or automation emitters create editable artifacts without replacing the binding implicitly.",
		},
		parameterGroups:
			parameters.length > 0
				? [
						{
							id: "parameters",
							label: "Parameters",
							intent:
								"Technique parameters from the production Motion Grammar catalog.",
							parameters,
						},
					]
				: [],
		...(entry.usesSeed
			? {
					seedControl: {
						key: "seed",
						label: "Seed",
						default: binding.seed ?? 0,
						min: 0,
						max: 999999,
						step: 1,
						role: "motion" as const,
					},
				}
			: {}),
		instances,
		roleSlots: instances,
	};
};

/**
 * Returns the semantic authoring profile for bindings that have graduated from
 * raw scalar-track decomposition into an editable profile contract. Techniques
 * without a descriptor continue to use catalog parameters and decomposition.
 */
export function describeMotionGrammarAuthoringProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	return (
		describeMotionGrammarTechniqueAuthoringProfile(binding) ??
		describeCatalogBackedAuthoringProfile(binding)
	);
}
