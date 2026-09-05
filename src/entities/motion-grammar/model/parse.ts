import type {
	SerializedMotionGrammarBinding,
	SerializedMotionGrammarLayer,
} from "@/entities/motion/model/grammar-bridge";
import { findCatalogEntry } from "./catalog";
import { MOTION_EXPRESSION_VERSION_PARAM_KEY } from "./expression-definition";
import {
	findActiveVersionedMotionExpressionDefinition,
	motionExpressionBindingState,
} from "./expression-registry";
import { isFollowThroughLeadAdapterParameters } from "./follow-through-lead-binding";
import { randomPulseProfileIssue } from "./random-pulse-profile";
import {
	MOTION_GRAMMAR_EFFECT_BINDING_KINDS,
	MOTION_GRAMMAR_TECHNIQUE_IDS,
	type MotionGrammarArrangementMapping,
	type MotionGrammarBinding,
	type MotionGrammarEffectBinding,
	type MotionGrammarRandomPulseProfile,
	type MotionGrammarTechniqueId,
} from "./types";
import {
	motionGrammarParameterSpecsForSerializedBinding,
	validateVersionedMotionExpressionRoleMap,
} from "./versioned-expression-binding";

/**
 * Normalizes the serialized grammar layer into rich bindings at the evaluator
 * boundary. Unknown technique ids are NEVER dropped — they are preserved verbatim
 * in `passthrough` so re-serialization is byte-stable, and reported as typed
 * issues. Known bindings have their parameters clamped to the catalog envelope;
 * `roleMap` and unrecognized numeric parameters are preserved verbatim.
 */

export type MotionGrammarParseIssueCode =
	| "unknown-technique"
	| "unsupported-expression-version"
	| "invalid-versioned-role-map"
	| "invalid-versioned-parameters"
	| "missing-targets"
	| "invalid-random-pulse-profile"
	| "invalid-binding";

export type MotionGrammarParseIssue = {
	readonly code: MotionGrammarParseIssueCode;
	readonly bindingId: string;
	readonly techniqueId?: string;
	readonly message: string;
};

export type MotionGrammarParseResult = {
	readonly bindings: readonly MotionGrammarBinding[];
	/** Unknown-technique bindings preserved verbatim for lossless re-serialization. */
	readonly passthrough: readonly SerializedMotionGrammarBinding[];
	readonly issues: readonly MotionGrammarParseIssue[];
};

const isTechniqueId = (id: string): id is MotionGrammarTechniqueId =>
	(MOTION_GRAMMAR_TECHNIQUE_IDS as readonly string[]).includes(id);

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/**
 * Builds the clamped numeric parameter bag: every catalog-declared key resolves to
 * a clamped value (or its default), and any extra finite-number keys are preserved
 * so forward-version parameters are not silently stripped.
 */
const normalizeParameters = (
	techniqueId: MotionGrammarTechniqueId,
	raw: Record<string, unknown>,
): Record<string, number> => {
	const result: Record<string, number> = {};
	for (const spec of motionGrammarParameterSpecsForSerializedBinding(
		techniqueId,
		raw,
	)) {
		const value = raw[spec.key];
		result[spec.key] = isFiniteNumber(value)
			? clamp(value, spec.min, spec.max)
			: spec.default;
	}
	for (const [key, value] of Object.entries(raw)) {
		if (!(key in result) && isFiniteNumber(value)) result[key] = value;
	}
	return result;
};

/**
 * A current version marker is an explicit contract selection, not permission to
 * silently fill absent fields with catalog defaults. Validate its raw storage
 * payload before normalization so a truncated/corrupt V1 document remains
 * preserved and inert instead of becoming a different executable motion.
 */
const versionedParameterContractIssue = (
	techniqueId: MotionGrammarTechniqueId,
	raw: Readonly<Record<string, unknown>>,
): string | undefined => {
	const specs = motionGrammarParameterSpecsForSerializedBinding(
		techniqueId,
		raw,
	);
	const allowedKeys = new Set([
		MOTION_EXPRESSION_VERSION_PARAM_KEY,
		...specs.map((spec) => spec.key),
	]);
	const unknownKey = Object.keys(raw).find((key) => !allowedKeys.has(key));
	if (unknownKey) {
		return "Versioned motion expression has an undeclared parameter.";
	}
	for (const spec of specs) {
		const value = raw[spec.key];
		if (!isFiniteNumber(value)) {
			return "Versioned motion expression is missing a finite declared parameter.";
		}
		if (value < spec.min || value > spec.max) {
			return "Versioned motion expression has a parameter outside its declared range.";
		}
		if (
			spec.options &&
			!spec.options.some((option) => option.value === value)
		) {
			return "Versioned motion expression has a parameter outside its declared options.";
		}
		const stepIndex = (value - spec.min) / spec.step;
		if (
			!Number.isFinite(stepIndex) ||
			Math.abs(stepIndex - Math.round(stepIndex)) >
				1e-8 * Math.max(1, Math.abs(stepIndex))
		) {
			return "Versioned motion expression has a parameter misaligned with its declared step.";
		}
	}
	return undefined;
};

const normalizeEffectBinding = (raw: unknown): MotionGrammarEffectBinding => {
	if (raw === undefined) return { kind: "none" };
	if (
		isRecord(raw) &&
		typeof raw.kind === "string" &&
		(MOTION_GRAMMAR_EFFECT_BINDING_KINDS as readonly string[]).includes(
			raw.kind,
		)
	) {
		return raw as unknown as MotionGrammarEffectBinding;
	}
	return { kind: "none" };
};

const normalizeRoleMap = (
	raw: Record<string, string> | undefined,
): Readonly<Record<string, string>> | undefined => {
	if (!isRecord(raw)) return undefined;
	const entries = Object.entries(raw).filter(
		(pair): pair is [string, string] => typeof pair[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeArrangementMapping = (
	raw: SerializedMotionGrammarBinding["arrangementMapping"],
): MotionGrammarArrangementMapping | undefined => {
	if (!isRecord(raw)) return undefined;
	if (
		typeof raw.sourceSnapshotId !== "string" ||
		typeof raw.destinationSnapshotId !== "string" ||
		!isRecord(raw.sourceToStage) ||
		!isRecord(raw.stageToDestination) ||
		!isRecord(raw.stageSlots) ||
		!isRecord(raw.pivot) ||
		!isFiniteNumber(raw.pivot.x) ||
		!isFiniteNumber(raw.pivot.y)
	) {
		return undefined;
	}
	const normalizeStringRecord = (
		value: Record<string, unknown>,
	): Record<string, string> =>
		Object.fromEntries(
			Object.entries(value).filter(
				(pair): pair is [string, string] => typeof pair[1] === "string",
			),
		);
	const stageSlots: Record<string, { readonly x: number; readonly y: number }> =
		Object.fromEntries(
			Object.entries(raw.stageSlots).flatMap(([key, value]) =>
				isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
					? [[key, { x: value.x, y: value.y }]]
					: [],
			),
		);
	if (Object.keys(stageSlots).length === 0) return undefined;
	const delay: Record<string, number> | undefined = isRecord(
		raw.stagingDelayFractionBySource,
	)
		? Object.fromEntries(
				Object.entries(raw.stagingDelayFractionBySource).filter(
					(pair): pair is [string, number] => isFiniteNumber(pair[1]),
				),
			)
		: undefined;
	return {
		sourceSnapshotId: raw.sourceSnapshotId,
		destinationSnapshotId: raw.destinationSnapshotId,
		sourceToStage: normalizeStringRecord(raw.sourceToStage),
		stageToDestination: normalizeStringRecord(raw.stageToDestination),
		stageSlots,
		pivot: { x: raw.pivot.x, y: raw.pivot.y },
		...(delay && Object.keys(delay).length > 0
			? { stagingDelayFractionBySource: delay }
			: {}),
	};
};

const normalizeRandomPulseProfile = (
	raw: SerializedMotionGrammarBinding["randomPulseProfile"],
): MotionGrammarRandomPulseProfile | undefined => {
	if (
		!isRecord(raw) ||
		raw.version !== 1 ||
		!isFiniteNumber(raw.durationFrames)
	) {
		return undefined;
	}
	if (!Array.isArray(raw.segments)) return undefined;
	const segments = raw.segments.flatMap((value) => {
		if (!isRecord(value)) return [];
		const easing = value.easing;
		if (
			!isFiniteNumber(value.fromFrame) ||
			!isFiniteNumber(value.toFrame) ||
			!isFiniteNumber(value.fromValue) ||
			!isFiniteNumber(value.toValue) ||
			!Array.isArray(easing) ||
			easing.length !== 4 ||
			!easing.every(isFiniteNumber)
		) {
			return [];
		}
		return [
			{
				fromFrame: value.fromFrame,
				toFrame: value.toFrame,
				fromValue: value.fromValue,
				toValue: value.toValue,
				easing: [easing[0], easing[1], easing[2], easing[3]] as const,
			},
		];
	});
	const profile = {
		version: 1,
		durationFrames: raw.durationFrames,
		segments,
	} satisfies MotionGrammarRandomPulseProfile;
	return randomPulseProfileIssue(profile) ? undefined : profile;
};

const parseBinding = (
	serialized: SerializedMotionGrammarBinding,
	issues: MotionGrammarParseIssue[],
): MotionGrammarBinding | null => {
	const { id, techniqueId } = serialized;
	if (!isTechniqueId(techniqueId)) {
		issues.push({
			code: "unknown-technique",
			bindingId: id,
			techniqueId,
			message: `Unknown motion-grammar technique "${techniqueId}"; binding preserved but inert.`,
		});
		return null;
	}
	const rawParameters = serialized.parameters ?? {};
	const expressionState = motionExpressionBindingState(
		techniqueId,
		rawParameters,
	);
	if (expressionState === "unsupported") {
		issues.push({
			code: "unsupported-expression-version",
			bindingId: id,
			techniqueId,
			message:
				"Motion expression version is unsupported or malformed; binding preserved but inert until a compatible Vecmo version is available.",
		});
		return null;
	}
	const activeVersionedBinding = Boolean(
		findActiveVersionedMotionExpressionDefinition(techniqueId, rawParameters) ??
			isFollowThroughLeadAdapterParameters(techniqueId, rawParameters),
	);
	if (activeVersionedBinding) {
		const parameterIssue = versionedParameterContractIssue(
			techniqueId,
			rawParameters,
		);
		if (parameterIssue) {
			issues.push({
				code: "invalid-versioned-parameters",
				bindingId: id,
				techniqueId,
				message: parameterIssue,
			});
			return null;
		}
	}
	const targetIds = serialized.targetIds.filter(
		(value) => typeof value === "string",
	);
	const entry = findCatalogEntry(techniqueId);
	if (entry && targetIds.length < entry.minTargets) {
		issues.push({
			code: "missing-targets",
			bindingId: id,
			techniqueId,
			message: `Technique "${techniqueId}" needs at least ${entry.minTargets} targets; ${targetIds.length} present.`,
		});
	}
	const roleMap = normalizeRoleMap(serialized.roleMap);
	if (activeVersionedBinding) {
		const roleIssue = validateVersionedMotionExpressionRoleMap(
			techniqueId,
			targetIds,
			roleMap ?? {},
		);
		if (roleIssue) {
			issues.push({
				code: "invalid-versioned-role-map",
				bindingId: id,
				techniqueId,
				message: roleIssue,
			});
			return null;
		}
	}
	const arrangementMapping = normalizeArrangementMapping(
		serialized.arrangementMapping,
	);
	const randomPulseProfile =
		techniqueId === "random-phase-pulse"
			? normalizeRandomPulseProfile(serialized.randomPulseProfile)
			: undefined;
	if (
		techniqueId === "random-phase-pulse" &&
		serialized.randomPulseProfile !== undefined &&
		!randomPulseProfile
	) {
		issues.push({
			code: "invalid-random-pulse-profile",
			bindingId: id,
			techniqueId,
			message:
				"Random Pulse profile is malformed or violates the explicit envelope contract.",
		});
		return null;
	}
	return {
		id,
		techniqueId,
		targetIds,
		parameters: normalizeParameters(techniqueId, rawParameters),
		effectBinding: normalizeEffectBinding(serialized.effectBinding),
		...(roleMap ? { roleMap } : {}),
		...(arrangementMapping ? { arrangementMapping } : {}),
		...(randomPulseProfile ? { randomPulseProfile } : {}),
		...(isFiniteNumber(serialized.seed) ? { seed: serialized.seed } : {}),
	};
};

export function parseMotionGrammarLayer(
	layer: SerializedMotionGrammarLayer | undefined,
): MotionGrammarParseResult {
	const issues: MotionGrammarParseIssue[] = [];
	const bindings: MotionGrammarBinding[] = [];
	const passthrough: SerializedMotionGrammarBinding[] = [];
	for (const serialized of layer?.bindings ?? []) {
		if (!isRecord(serialized) || typeof serialized.id !== "string") {
			issues.push({
				code: "invalid-binding",
				bindingId:
					isRecord(serialized) && typeof serialized.id === "string"
						? serialized.id
						: "(unknown)",
				message: "Grammar binding is missing a string id; skipped.",
			});
			continue;
		}
		const parsed = parseBinding(serialized, issues);
		if (parsed) bindings.push(parsed);
		else passthrough.push(serialized);
	}
	return { bindings, passthrough, issues };
}

/** Re-serializes rich bindings + verbatim passthrough back into the storage layer. */
export function serializeMotionGrammarLayer(
	bindings: readonly MotionGrammarBinding[],
	passthrough: readonly SerializedMotionGrammarBinding[] = [],
): SerializedMotionGrammarLayer {
	const fromRich: readonly SerializedMotionGrammarBinding[] = bindings.map(
		(binding) => ({
			id: binding.id,
			techniqueId: binding.techniqueId,
			targetIds: [...binding.targetIds],
			parameters: { ...binding.parameters },
			...(binding.randomPulseProfile
				? {
						randomPulseProfile: {
							version: binding.randomPulseProfile.version,
							durationFrames: binding.randomPulseProfile.durationFrames,
							segments: binding.randomPulseProfile.segments.map((segment) => ({
								...segment,
								easing: [...segment.easing],
							})),
						},
					}
				: {}),
			...(binding.roleMap ? { roleMap: { ...binding.roleMap } } : {}),
			...(binding.arrangementMapping
				? {
						arrangementMapping: {
							sourceSnapshotId: binding.arrangementMapping.sourceSnapshotId,
							destinationSnapshotId:
								binding.arrangementMapping.destinationSnapshotId,
							sourceToStage: { ...binding.arrangementMapping.sourceToStage },
							stageToDestination: {
								...binding.arrangementMapping.stageToDestination,
							},
							stageSlots: Object.fromEntries(
								Object.entries(binding.arrangementMapping.stageSlots).map(
									([key, point]) => [key, { ...point }],
								),
							),
							pivot: { ...binding.arrangementMapping.pivot },
							...(binding.arrangementMapping.stagingDelayFractionBySource
								? {
										stagingDelayFractionBySource: {
											...binding.arrangementMapping
												.stagingDelayFractionBySource,
										},
									}
								: {}),
						},
					}
				: {}),
			...(binding.seed !== undefined ? { seed: binding.seed } : {}),
			...(binding.effectBinding
				? { effectBinding: binding.effectBinding }
				: {}),
		}),
	);
	return { schemaVersion: 1, bindings: [...fromRich, ...passthrough] };
}
