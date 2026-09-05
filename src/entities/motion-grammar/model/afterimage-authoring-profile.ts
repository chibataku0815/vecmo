import type {
	MotionGrammarAuthoringParameterRole,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileDescriptor,
} from "./authoring-profile";
import { findCatalogEntry } from "./catalog";
import type { MotionGrammarBinding, MotionGrammarParamSpec } from "./types";

type AfterimageParameterGroupDefinition = {
	readonly id: string;
	readonly label: string;
	readonly intent: string;
	readonly parameters: readonly {
		readonly key: string;
		readonly role: MotionGrammarAuthoringParameterRole;
		readonly advanced?: boolean;
	}[];
};

const AFTERIMAGE_TECHNIQUE_ID = "periodic-afterimage";

const AFTERIMAGE_PARAMETER_GROUPS: readonly AfterimageParameterGroupDefinition[] =
	[
		{
			id: "timing",
			label: "Timing",
			intent:
				"Controls the live echo loop and the frame spacing between historical poses.",
			parameters: [
				{ key: "periodFrames", role: "timing" },
				{ key: "delayFrames", role: "timing" },
			],
		},
		{
			id: "layout",
			label: "Echoes",
			intent:
				"Controls how many presentation duplicates are drawn and how strongly each echo fades.",
			parameters: [
				{ key: "copies", role: "layout" },
				{ key: "decay", role: "look" },
			],
		},
	] as const;

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const catalogSpecsByKey = (): ReadonlyMap<string, MotionGrammarParamSpec> => {
	const specs = new Map<string, MotionGrammarParamSpec>();
	for (const spec of findCatalogEntry(AFTERIMAGE_TECHNIQUE_ID)?.params ?? []) {
		specs.set(spec.key, spec);
	}
	return specs;
};

const authoringParameter = ({
	spec,
	role,
	advanced,
}: {
	readonly spec: MotionGrammarParamSpec;
	readonly role: MotionGrammarAuthoringParameterRole;
	readonly advanced?: boolean;
}): MotionGrammarAuthoringParameterSpec => ({
	...spec,
	role,
	...(advanced !== undefined ? { advanced } : {}),
});

const bindingNumber = (
	binding: MotionGrammarBinding,
	spec: MotionGrammarParamSpec,
): number => {
	const value = binding.parameters[spec.key];
	return Number.isFinite(value) ? value : spec.default;
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const boundedCopyCount = (
	binding: MotionGrammarBinding,
	specs: ReadonlyMap<string, MotionGrammarParamSpec>,
): number => {
	const spec = specs.get("copies");
	if (!spec) return 0;
	return Math.max(
		0,
		Math.floor(clamp(bindingNumber(binding, spec), spec.min, spec.max)),
	);
};

const echoDelayFrames = (
	binding: MotionGrammarBinding,
	specs: ReadonlyMap<string, MotionGrammarParamSpec>,
	copyIndex: number,
): number | undefined => {
	const spec = specs.get("delayFrames");
	if (!spec) return undefined;
	return bindingNumber(binding, spec) * copyIndex;
};

const sourceRole = (
	binding: MotionGrammarBinding,
	nodeId: string,
	sourceIndex: number,
): string =>
	binding.roleMap?.[nodeId] ??
	`${AFTERIMAGE_TECHNIQUE_ID}:source:${sourceIndex + 1}`;

const sourceRoleLabel = (sourceIndex: number, sourceCount: number): string =>
	sourceCount === 1 ? "Echo source" : `Echo source ${sourceIndex + 1}`;

const echoRoleLabel = ({
	sourceIndex,
	sourceCount,
	copyIndex,
}: {
	readonly sourceIndex: number;
	readonly sourceCount: number;
	readonly copyIndex: number;
}): string =>
	sourceCount === 1
		? `Echo ${copyIndex}`
		: `Source ${sourceIndex + 1} echo ${copyIndex}`;

/**
 * Describes `periodic-afterimage` as a live presentation-duplicate motion
 * system. Source objects remain real scene nodes, while echoes are semantic
 * presentation artifacts until an explicit bake materializes clone tracks.
 */
export function describeGlammerAfterimageAuthoringProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	if (binding.techniqueId !== AFTERIMAGE_TECHNIQUE_ID) return undefined;
	const specs = catalogSpecsByKey();
	const copyCount = boundedCopyCount(binding, specs);
	const sourceCount = binding.targetIds.length;
	const instances: MotionGrammarAuthoringProfileDescriptor["instances"] =
		binding.targetIds.flatMap(
			(
				nodeId,
				sourceIndex,
			): MotionGrammarAuthoringProfileDescriptor["instances"] => [
				{
					index: sourceIndex,
					slotId: `source:${sourceIndex + 1}`,
					reference: { kind: "scene-node", nodeId },
					nodeId,
					role: sourceRole(binding, nodeId, sourceIndex),
					roleLabel: sourceRoleLabel(sourceIndex, sourceCount),
					kind: "source",
					editable: true,
					replaceable: true,
					sourceProfileIndex: sourceIndex,
				},
				...Array.from({ length: copyCount }, (_, echoIndex) => {
					const copyIndex = echoIndex + 1;
					const artifactId = `${nodeId}::grammar:${binding.id}:echo:${copyIndex}`;
					return {
						index: sourceIndex * copyCount + echoIndex,
						slotId: `source:${sourceIndex + 1}:echo:${copyIndex}`,
						reference: {
							kind: "presentation-artifact" as const,
							artifactId,
							sourceNodeId: nodeId,
							lifecycle: "runtime-evaluated" as const,
						},
						nodeId: artifactId,
						role: `${AFTERIMAGE_TECHNIQUE_ID}:echo:${copyIndex}`,
						roleLabel: echoRoleLabel({
							sourceIndex,
							sourceCount,
							copyIndex,
						}),
						kind: "artifact" as const,
						editable: false,
						replaceable: false,
						sourceProfileIndex: sourceIndex,
						delayFrames: echoDelayFrames(binding, specs, copyIndex),
					};
				}),
			],
		);
	return {
		bindingId: binding.id,
		techniqueId: AFTERIMAGE_TECHNIQUE_ID,
		label: "Afterimage",
		summary:
			"Live presentation duplicates replay historical source poses with semantic echo count, delay, and decay controls.",
		kind: "presentation-duplicates",
		timeline: {
			mode: "presentation-only",
			bakePolicy: "explicit-command",
			clipLabel: "Afterimage",
			durationParameterKey: "periodFrames",
		},
		expansion: {
			mode: "specialized-artifacts",
			label: "Editable echo output",
			actionLabel: "Create editable echoes",
			previewLabel: "Preview echo output",
			description:
				"Creates editable echo artifacts from the live Afterimage presentation duplicate profile.",
			outputSummary:
				"Source objects remain editable scene nodes; echo copies become explicit editable artifacts/tracks.",
		},
		parameterGroups: AFTERIMAGE_PARAMETER_GROUPS.map((group) => ({
			id: group.id,
			label: group.label,
			intent: group.intent,
			parameters: group.parameters
				.map((parameter) => {
					const spec = specs.get(parameter.key);
					return spec
						? authoringParameter({
								spec,
								role: parameter.role,
								advanced: parameter.advanced,
							})
						: undefined;
				})
				.filter(isDefined),
		})),
		instances,
		roleSlots: instances,
		recipeRoles: ["source", "echo"],
	};
}
