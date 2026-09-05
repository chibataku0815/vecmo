import { findCatalogEntry } from "./catalog";
import { randomPulseProfileIssue } from "./random-pulse-profile";
import type {
	MotionGrammarArrangementMapping,
	MotionGrammarBinding,
	MotionGrammarEffectBinding,
} from "./types";

export type MotionGrammarBindingValidationIssue = {
	readonly code:
		| "binding-identity-invalid"
		| "binding-targets-invalid"
		| "binding-parameters-invalid"
		| "binding-role-map-invalid"
		| "binding-random-profile-invalid"
		| "binding-arrangement-invalid"
		| "binding-seed-invalid"
		| "binding-effect-invalid";
	readonly message: string;
};

const nonEmptyString = (value: string): boolean => value.trim().length > 0;

const arrangementMappingIssue = (
	mapping: MotionGrammarArrangementMapping,
): string | undefined => {
	if (
		!nonEmptyString(mapping.sourceSnapshotId) ||
		!nonEmptyString(mapping.destinationSnapshotId)
	) {
		return "Arrangement snapshot ids must be non-empty.";
	}
	const sourceToStage = Object.entries(mapping.sourceToStage);
	const stageToDestination = Object.entries(mapping.stageToDestination);
	const stageSlots = Object.entries(mapping.stageSlots);
	if (
		sourceToStage.length === 0 ||
		stageToDestination.length === 0 ||
		stageSlots.length === 0
	) {
		return "Arrangement correspondence maps and stage slots must be non-empty.";
	}
	if (
		!Number.isFinite(mapping.pivot.x) ||
		!Number.isFinite(mapping.pivot.y) ||
		stageSlots.some(
			([slotId, point]) =>
				!nonEmptyString(slotId) ||
				!Number.isFinite(point.x) ||
				!Number.isFinite(point.y),
		)
	) {
		return "Arrangement pivot and stage-slot points must be finite.";
	}
	const stageSlotIds = new Set(stageSlots.map(([slotId]) => slotId));
	if (
		sourceToStage.some(
			([sourceId, slotId]) =>
				!nonEmptyString(sourceId) ||
				!nonEmptyString(slotId) ||
				!stageSlotIds.has(slotId),
		) ||
		stageToDestination.some(
			([slotId, destinationId]) =>
				!stageSlotIds.has(slotId) || !nonEmptyString(destinationId),
		)
	) {
		return "Arrangement correspondence must resolve through declared stage slots.";
	}
	if (
		mapping.stagingDelayFractionBySource &&
		Object.entries(mapping.stagingDelayFractionBySource).some(
			([sourceId, delay]) =>
				!mapping.sourceToStage[sourceId] ||
				!Number.isFinite(delay) ||
				delay < 0 ||
				delay > 1,
		)
	) {
		return "Arrangement staging delays must resolve to source ids and stay within 0–1.";
	}
	return undefined;
};

const effectBindingIssue = (
	effect: MotionGrammarEffectBinding,
): string | undefined => {
	switch (effect.kind) {
		case "none":
			return undefined;
		case "active-target-influence":
			if (
				!nonEmptyString(effect.effect.id) ||
				!nonEmptyString(effect.effect.path)
			) {
				return "Effect slot id and path must be non-empty.";
			}
			return effect.strength === undefined || Number.isFinite(effect.strength)
				? undefined
				: "Effect influence strength must be finite.";
		case "automation-param":
			return nonEmptyString(effect.effect.id) &&
				nonEmptyString(effect.effect.path) &&
				nonEmptyString(effect.path)
				? undefined
				: "Effect slot id, effect path, and automation path must be non-empty.";
		case "temporal-echo":
			return Number.isInteger(effect.copies) &&
				effect.copies >= 1 &&
				Number.isFinite(effect.delayFrames) &&
				effect.delayFrames >= 0 &&
				Number.isFinite(effect.decay) &&
				effect.decay >= 0 &&
				effect.decay <= 1
				? undefined
				: "Temporal echo copies, delay, and decay must use valid finite ranges.";
	}
};

/** Validates intrinsic binding state that does not require a Scene/Motion lookup. */
export function validateMotionGrammarBinding(
	binding: MotionGrammarBinding,
): MotionGrammarBindingValidationIssue | undefined {
	if (!nonEmptyString(binding.id)) {
		return {
			code: "binding-identity-invalid",
			message: "Motion Grammar binding id must be non-empty.",
		};
	}
	const targetIds = [...binding.targetIds];
	const minTargets = findCatalogEntry(binding.techniqueId)?.minTargets ?? 1;
	if (
		targetIds.length < minTargets ||
		new Set(targetIds).size !== targetIds.length ||
		targetIds.some((targetId) => !nonEmptyString(targetId))
	) {
		return {
			code: "binding-targets-invalid",
			message:
				"Motion Grammar targets must be unique, non-empty, and meet the technique minimum.",
		};
	}
	if (
		Object.values(binding.parameters).some((value) => !Number.isFinite(value))
	) {
		return {
			code: "binding-parameters-invalid",
			message: "Motion Grammar parameters must be finite.",
		};
	}
	if (
		binding.roleMap &&
		Object.entries(binding.roleMap).some(
			([key, value]) => !nonEmptyString(key) || !nonEmptyString(value),
		)
	) {
		return {
			code: "binding-role-map-invalid",
			message: "Motion Grammar role-map keys and values must be non-empty.",
		};
	}
	if (binding.randomPulseProfile) {
		const issue =
			binding.techniqueId === "random-phase-pulse"
				? randomPulseProfileIssue(binding.randomPulseProfile)
				: "Only Random Pulse may carry a Random Pulse profile.";
		if (issue) {
			return { code: "binding-random-profile-invalid", message: issue };
		}
	}
	if (binding.arrangementMapping) {
		const issue =
			binding.techniqueId === "arrangement-transition"
				? arrangementMappingIssue(binding.arrangementMapping)
				: "Only Arrangement may carry an arrangement mapping.";
		if (issue) {
			return { code: "binding-arrangement-invalid", message: issue };
		}
	}
	if (binding.seed !== undefined && !Number.isFinite(binding.seed)) {
		return {
			code: "binding-seed-invalid",
			message: "Motion Grammar seed must be finite.",
		};
	}
	if (binding.effectBinding) {
		const issue = effectBindingIssue(binding.effectBinding);
		if (issue) return { code: "binding-effect-invalid", message: issue };
	}
	return undefined;
}
