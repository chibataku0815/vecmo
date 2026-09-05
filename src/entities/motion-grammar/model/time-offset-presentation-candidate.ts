import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import {
	findNode,
	findRenderableNodeEntry,
	isTopLevelSceneNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type MotionGrammarAuthoringProfileDescriptor,
	motionGrammarAuthoringParameterKeys,
} from "./authoring-profile";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import {
	describeTimeOffsetPropagationAuthoringProfile,
	GLAMMER_OFFSET_SEMANTIC_VERSION,
	GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION,
} from "./time-offset-authoring-profile";
import {
	type TimeOffsetReferenceInput,
	timeOffsetReferenceCriticalFrames,
} from "./time-offset-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export const TIME_OFFSET_CANDIDATE_SURFACE =
	"shared-presentation-structural" as const;

type UnitBezier = readonly [number, number, number, number];

type TimeOffsetCandidateIncompatibilityCode =
	| "period-frames"
	| "subcycle-frames"
	| "active-frames"
	| "easing"
	| "spacing"
	| "slot-values"
	| "override"
	| "visibility-threshold"
	| "value-unit"
	| "authoring-surface"
	| "stagger-not-effective";

export type TimeOffsetCandidateIncompatibility = {
	readonly code: TimeOffsetCandidateIncompatibilityCode;
	readonly message: string;
	readonly expected: string;
	readonly actual: string;
};

export type TimeOffsetCandidateRoleMapping = {
	readonly sourceTargetId: string;
	readonly candidateRole: string;
};

export type TimeOffsetPresentationCandidateInput = {
	readonly source: TimeOffsetReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly roleMappings: readonly TimeOffsetCandidateRoleMapping[];
	readonly candidateFrameOffset?: number;
	readonly artboardId?: string | null;
};

export type TimeOffsetPresentationCandidateSample = {
	readonly targetId: string;
	readonly slotIndex: number;
	readonly candidateFrame: number;
	readonly role: string;
	readonly nodeId: string;
	/** Centered artboard-space transform, not a pixel centroid. */
	readonly profilePositionX: number;
	readonly profilePositionY: number;
	/** Runtime scale channels; v2 also exposes the declared radius-equivalent channel. */
	readonly scaleX: number;
	readonly scaleY: number;
	/** Candidate radius reconstructed from the declared source-unit calibration. */
	readonly radiusEquivalentSceneUnits: number;
	readonly opacity: number;
	/** Candidate-side opacity presence observation; not DOM or pixel visibility. */
	readonly opacityPresent: boolean;
};

export type TimeOffsetCandidateProfileObservation = {
	readonly semanticVersion: number;
	readonly periodFrames: number;
	readonly subcycleFrames: number;
	readonly activeFrames: number;
	/** Candidate artboard transform units; never directly comparable to source SVG units. */
	readonly spacingSceneUnits: number;
	readonly slotCount: number;
	readonly slotValues: readonly number[];
	readonly overrideSlot: number;
	readonly overrideDup: number;
	readonly overrideValue: number;
	readonly referenceOriginX: number;
	readonly referenceOriginY: number;
	readonly easing: "fixed-smoothstep-v1" | "source-cubic-bezier-v2";
	readonly easingCurve?: UnitBezier;
	readonly sourceCoordinateScale: number;
	readonly sourceValueScale: number;
	readonly radiusAnchorSceneUnits: number;
	readonly visibilityThreshold: number;
	readonly visibilityThresholdSourceUnits: number;
	readonly valueUnit: "scale-factor" | "source-radius-projected";
	readonly positionUnit: "artboard-transform" | "source-coordinate-projected";
	readonly staggerFrames: number;
};

export type TimeOffsetCandidateAuthoringObservation = {
	readonly exposedParameterKeys: readonly string[];
	readonly requiredSourceSemanticKeys: readonly string[];
	readonly unavailableSourceSemanticKeys: readonly string[];
	readonly ineffectiveExposedKeys: readonly string[];
	readonly descriptor: MotionGrammarAuthoringProfileDescriptor | undefined;
};

export type TimeOffsetCandidateResult =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "incompatible";
			readonly surface: typeof TIME_OFFSET_CANDIDATE_SURFACE;
			readonly artboardId: string;
			readonly clipStartFrame: number;
			readonly profile: TimeOffsetCandidateProfileObservation;
			readonly authoring: TimeOffsetCandidateAuthoringObservation;
			readonly incompatibilities: readonly TimeOffsetCandidateIncompatibility[];
			readonly samples: readonly TimeOffsetPresentationCandidateSample[];
	  }
	| {
			readonly status: "ready";
			readonly surface: typeof TIME_OFFSET_CANDIDATE_SURFACE;
			readonly artboardId: string;
			readonly clipStartFrame: number;
			readonly profile: TimeOffsetCandidateProfileObservation;
			readonly authoring: TimeOffsetCandidateAuthoringObservation;
			readonly samples: readonly TimeOffsetPresentationCandidateSample[];
	  };

type CandidateClip = {
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly endFrameExclusive: number;
};

type CandidateRoleResolution = {
	readonly targetId: string;
	readonly slotIndex: number;
	readonly role: string;
	readonly nodeId: string;
};

type CandidateResolution = {
	readonly roles: readonly CandidateRoleResolution[];
	readonly artboardId: string;
	readonly clip: CandidateClip;
	readonly profile: TimeOffsetCandidateProfileObservation;
	readonly authoring: TimeOffsetCandidateAuthoringObservation;
	readonly incompatibilities: readonly TimeOffsetCandidateIncompatibility[];
};

const blocked = (reason: string): TimeOffsetCandidateResult => ({
	status: "blocked",
	reason,
});

const positiveModulo = (value: number, modulo: number): number => {
	const remainder = value % modulo;
	return remainder < 0 ? remainder + modulo : remainder;
};

const finiteParameter = (
	parameters: Readonly<Record<string, number>>,
	key: string,
): number | null => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const requiredPositiveInteger = (
	parameters: Readonly<Record<string, number>>,
	key: string,
): number | string => {
	const value = finiteParameter(parameters, key);
	if (value === null || !Number.isInteger(value) || value <= 0) {
		return `Canonical Offset profile parameter "${key}" must be an explicit positive integer.`;
	}
	return value;
};

const requiredFinite = (
	parameters: Readonly<Record<string, number>>,
	key: string,
): number | string => {
	const value = finiteParameter(parameters, key);
	return value === null
		? `Canonical Offset profile parameter "${key}" must be explicitly finite.`
		: value;
};

const resolveProfile = (
	binding: MotionGrammarBinding,
): TimeOffsetCandidateProfileObservation | string => {
	if (binding.techniqueId !== "time-offset-propagation") {
		return "Offset candidate must use the time-offset-propagation technique.";
	}
	if (
		binding.parameters.profileVersion !==
		GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION
	) {
		return "Offset candidate must use the canonical conveyor profile version, not the generic delayed-transform fallback.";
	}
	const semanticVersion = Math.round(
		finiteParameter(binding.parameters, "semanticVersion") ?? 1,
	);
	if (
		semanticVersion !== 1 &&
		semanticVersion !== GLAMMER_OFFSET_SEMANTIC_VERSION
	) {
		return "Offset candidate semanticVersion must be 1 or the admitted source-law version 2.";
	}
	const sourceLaw = semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION;
	const periodFrames = requiredPositiveInteger(
		binding.parameters,
		"periodFrames",
	);
	const subcycleFrames = requiredPositiveInteger(
		binding.parameters,
		"subcycleFrames",
	);
	const activeFrames = requiredPositiveInteger(
		binding.parameters,
		"activeFrames",
	);
	const slotCount = requiredPositiveInteger(binding.parameters, "slotCount");
	const spacingSceneUnits = requiredFinite(binding.parameters, "spacing");
	const overrideSlot = requiredFinite(binding.parameters, "overrideSlot");
	const overrideDup = requiredFinite(binding.parameters, "overrideDup");
	const overrideValue = requiredFinite(binding.parameters, "overrideValue");
	const referenceOriginX = requiredFinite(
		binding.parameters,
		"referenceOriginX",
	);
	const referenceOriginY = requiredFinite(
		binding.parameters,
		"referenceOriginY",
	);
	const staggerFrames = requiredFinite(binding.parameters, "staggerFrames");
	const sourceCoordinateScale = sourceLaw
		? requiredFinite(binding.parameters, "sourceCoordinateScale")
		: 1;
	const sourceValueScale = sourceLaw
		? requiredFinite(binding.parameters, "sourceValueScale")
		: 1;
	const radiusAnchorSceneUnits = sourceLaw
		? requiredFinite(binding.parameters, "radiusAnchorSceneUnits")
		: 1;
	const visibilityThresholdSourceUnits = sourceLaw
		? requiredFinite(binding.parameters, "visibilityCutoffSourceUnits")
		: 0.04;
	const easingCurve = sourceLaw
		? ([
				requiredFinite(binding.parameters, "easingP1X"),
				requiredFinite(binding.parameters, "easingP1Y"),
				requiredFinite(binding.parameters, "easingP2X"),
				requiredFinite(binding.parameters, "easingP2Y"),
			] as const)
		: null;
	const slotValues = Array.from({ length: 5 }, (_, index) =>
		requiredFinite(binding.parameters, `slotValue${index + 1}`),
	);
	const values = [
		periodFrames,
		subcycleFrames,
		activeFrames,
		slotCount,
		spacingSceneUnits,
		overrideSlot,
		overrideDup,
		overrideValue,
		referenceOriginX,
		referenceOriginY,
		staggerFrames,
		...slotValues,
		sourceCoordinateScale,
		sourceValueScale,
		radiusAnchorSceneUnits,
		visibilityThresholdSourceUnits,
		...(easingCurve ?? []),
	];
	const invalid = values.find(
		(value): value is string => typeof value === "string",
	);
	if (invalid) return invalid;
	const numericPeriodFrames = periodFrames as number;
	const numericSubcycleFrames = subcycleFrames as number;
	const numericActiveFrames = activeFrames as number;
	const numericSlotCount = slotCount as number;
	const numericSpacingSceneUnits = spacingSceneUnits as number;
	const numericOverrideSlot = overrideSlot as number;
	const numericOverrideDup = overrideDup as number;
	const numericOverrideValue = overrideValue as number;
	const numericReferenceOriginX = referenceOriginX as number;
	const numericReferenceOriginY = referenceOriginY as number;
	const numericStaggerFrames = staggerFrames as number;
	const numericSlotValues = slotValues as number[];
	const numericSourceCoordinateScale = sourceCoordinateScale as number;
	const numericSourceValueScale = sourceValueScale as number;
	const numericRadiusAnchorSceneUnits = radiusAnchorSceneUnits as number;
	const numericVisibilityThresholdSourceUnits =
		visibilityThresholdSourceUnits as number;
	const numericEasingCurve = sourceLaw
		? (easingCurve as readonly number[])
		: null;
	const resolvedSpacingSceneUnits = sourceLaw
		? numericSpacingSceneUnits * numericSourceCoordinateScale
		: numericSpacingSceneUnits;
	if (numericPeriodFrames % numericSubcycleFrames !== 0) {
		return "Canonical Offset profile period must contain an integer number of subcycles.";
	}
	if (
		numericActiveFrames > numericSubcycleFrames ||
		(sourceLaw && numericActiveFrames >= numericSubcycleFrames)
	) {
		return "Canonical Offset profile active duration must be shorter than its subcycle.";
	}
	if (numericSlotCount !== 5 || binding.targetIds.length !== 5) {
		return "Canonical Offset profile comparison requires exactly five slots.";
	}
	if (
		resolvedSpacingSceneUnits <= 0 ||
		!numericSlotValues.every((value) => value >= 0) ||
		numericOverrideSlot < 0 ||
		!Number.isInteger(numericOverrideSlot) ||
		numericOverrideSlot >= numericSlotCount ||
		numericOverrideDup < 0 ||
		!Number.isInteger(numericOverrideDup) ||
		numericOverrideDup >= numericPeriodFrames / numericSubcycleFrames ||
		numericOverrideValue <= 0
	) {
		return "Canonical Offset profile slot and override parameters are outside their declared ranges.";
	}
	if (
		sourceLaw &&
		(!numericSourceCoordinateScale ||
			numericSourceCoordinateScale <= 0 ||
			!numericSourceValueScale ||
			numericSourceValueScale <= 0 ||
			!numericRadiusAnchorSceneUnits ||
			numericRadiusAnchorSceneUnits <= 0 ||
			numericVisibilityThresholdSourceUnits < 0 ||
			!numericEasingCurve?.every((value) => value >= 0 && value <= 1))
	) {
		return "Canonical Offset source-law calibration and cubic-Bezier values are outside their declared ranges.";
	}
	return {
		semanticVersion,
		periodFrames: numericPeriodFrames,
		subcycleFrames: numericSubcycleFrames,
		activeFrames: numericActiveFrames,
		spacingSceneUnits: resolvedSpacingSceneUnits,
		slotCount: numericSlotCount,
		slotValues: numericSlotValues,
		overrideSlot: numericOverrideSlot,
		overrideDup: numericOverrideDup,
		overrideValue: numericOverrideValue,
		referenceOriginX: numericReferenceOriginX,
		referenceOriginY: numericReferenceOriginY,
		easing: sourceLaw ? "source-cubic-bezier-v2" : "fixed-smoothstep-v1",
		...(sourceLaw && numericEasingCurve
			? { easingCurve: numericEasingCurve as UnitBezier }
			: {}),
		sourceCoordinateScale: numericSourceCoordinateScale,
		sourceValueScale: numericSourceValueScale,
		radiusAnchorSceneUnits: numericRadiusAnchorSceneUnits,
		visibilityThreshold: sourceLaw
			? (numericVisibilityThresholdSourceUnits * numericSourceValueScale) /
				numericRadiusAnchorSceneUnits
			: 0.04,
		visibilityThresholdSourceUnits: numericVisibilityThresholdSourceUnits,
		valueUnit: sourceLaw ? "source-radius-projected" : "scale-factor",
		positionUnit: sourceLaw
			? "source-coordinate-projected"
			: "artboard-transform",
		staggerFrames: numericStaggerFrames,
	};
};

const sourceSemanticKeys = [
	"periodFrames",
	"subcycleFrames",
	"activeFrames",
	"easing",
	"spacingSvgUnits",
	"slotValuesSvgUnits",
	"overrides",
	"pageRenderPresenceCutoffSvgUnits",
	"valueUnit",
] as const;

const resolveAuthoring = (
	binding: MotionGrammarBinding,
): TimeOffsetCandidateAuthoringObservation => {
	const descriptor = describeTimeOffsetPropagationAuthoringProfile(binding);
	const exposedParameterKeys = motionGrammarAuthoringParameterKeys({
		binding,
		descriptor,
	});
	const sourceLaw =
		Math.round(finiteParameter(binding.parameters, "semanticVersion") ?? 1) >=
		GLAMMER_OFFSET_SEMANTIC_VERSION;
	const hasEasingContract = [
		"easingP1X",
		"easingP1Y",
		"easingP2X",
		"easingP2Y",
	].every((key) => exposedParameterKeys.includes(key));
	const hasSlotValueContract = Array.from({ length: 5 }, (_, index) =>
		exposedParameterKeys.includes(`slotValue${index + 1}`),
	).every(Boolean);
	const hasOverrideContract = [
		"overrideSlot",
		"overrideDup",
		"overrideValue",
	].every((key) => exposedParameterKeys.includes(key));
	const unavailableSourceSemanticKeys = sourceLaw
		? sourceSemanticKeys.filter((key) => {
				if (
					key === "periodFrames" ||
					key === "subcycleFrames" ||
					key === "activeFrames"
				) {
					return !exposedParameterKeys.includes(key);
				}
				if (key === "easing") return !hasEasingContract;
				if (key === "spacingSvgUnits") {
					return !exposedParameterKeys.includes("spacing");
				}
				if (key === "slotValuesSvgUnits") return !hasSlotValueContract;
				if (key === "overrides") return !hasOverrideContract;
				if (key === "pageRenderPresenceCutoffSvgUnits") {
					return !exposedParameterKeys.includes("visibilityCutoffSourceUnits");
				}
				return false;
			})
		: sourceSemanticKeys.filter(
				(key) => key !== "periodFrames" && !exposedParameterKeys.includes(key),
			);
	const ineffectiveExposedKeys = sourceLaw
		? []
		: ["staggerFrames", "rangeStart", "rangeEnd", "rangeShape"].filter((key) =>
				exposedParameterKeys.includes(key),
			);
	return {
		exposedParameterKeys,
		requiredSourceSemanticKeys: sourceSemanticKeys,
		unavailableSourceSemanticKeys,
		ineffectiveExposedKeys,
		descriptor,
	};
};

const resolveClip = (
	input: TimeOffsetPresentationCandidateInput,
	profile: TimeOffsetCandidateProfileObservation,
): CandidateClip | string => {
	const clips = input.motion.clips.filter(
		(clip) => clip.provenance?.bindingId === input.binding.id,
	);
	if (clips.length !== 1) {
		return "Offset comparison requires exactly one profile clip for the sampled binding.";
	}
	const clip = clips[0];
	if (
		!clip ||
		!Number.isFinite(clip.startFrame) ||
		!Number.isFinite(clip.durationFrames) ||
		clip.startFrame < 0 ||
		clip.durationFrames <= 0
	) {
		return "Offset comparison clip timing must be finite, non-negative, and positive in duration.";
	}
	const endFrameExclusive = clip.startFrame + clip.durationFrames;
	if (
		!Number.isFinite(input.motion.durationFrames) ||
		input.motion.durationFrames <= 0 ||
		endFrameExclusive > input.motion.durationFrames
	) {
		return "Offset comparison clip must fit inside the supplied motion duration.";
	}
	if (!Object.is(clip.durationFrames, profile.periodFrames)) {
		return "Offset comparison clip duration must equal the candidate profile period.";
	}
	if (
		input.candidateFrameOffset !== undefined &&
		(!Number.isFinite(input.candidateFrameOffset) ||
			!Object.is(input.candidateFrameOffset, clip.startFrame))
	) {
		return "Offset candidate frame offset must exactly equal the profile clip start.";
	}
	return {
		startFrame: clip.startFrame,
		durationFrames: clip.durationFrames,
		endFrameExclusive,
	};
};

const resolveRoles = (
	input: TimeOffsetPresentationCandidateInput,
): readonly CandidateRoleResolution[] | string => {
	if (input.source.slots.length !== 5) {
		return "The current Offset profile proves exactly five source slots.";
	}
	if (input.roleMappings.length !== input.source.slots.length) {
		return "Offset candidate mappings must cover every source slot exactly once.";
	}
	const sourceById = new Map(
		input.source.slots.map((slot) => [slot.targetId, slot] as const),
	);
	const sourceIds = new Set<string>();
	const candidateRoles = new Set<string>();
	const roles: CandidateRoleResolution[] = [];
	for (const mapping of input.roleMappings) {
		const sourceSlot = sourceById.get(mapping.sourceTargetId);
		if (!sourceSlot || sourceIds.has(mapping.sourceTargetId)) {
			return "Offset candidate mappings must reference unique source slots.";
		}
		const nodeId = input.binding.targetIds[sourceSlot.slotIndex];
		const expectedRole = `time-offset-propagation:slot-${sourceSlot.slotIndex + 1}`;
		if (
			!nodeId ||
			mapping.candidateRole !== expectedRole ||
			input.binding.roleMap?.[nodeId] !== expectedRole ||
			candidateRoles.has(mapping.candidateRole)
		) {
			return "Offset candidate mappings must preserve the canonical five-slot role order.";
		}
		sourceIds.add(mapping.sourceTargetId);
		candidateRoles.add(mapping.candidateRole);
		roles.push({
			targetId: mapping.sourceTargetId,
			slotIndex: sourceSlot.slotIndex,
			role: mapping.candidateRole,
			nodeId,
		});
	}
	return roles.sort((left, right) => left.slotIndex - right.slotIndex);
};

const resolveRoleArtboard = (
	input: TimeOffsetPresentationCandidateInput,
	roles: readonly CandidateRoleResolution[],
): string | null => {
	let artboardId: string | undefined;
	for (const role of roles) {
		const node = findNode(input.scene, role.nodeId);
		if (!node || !isTopLevelSceneNode(input.scene, role.nodeId)) return null;
		if (!findRenderableNodeEntry(input.scene, role.nodeId)) return null;
		if (
			node.motionParent ||
			node.transformConstraint ||
			node.propertyRelations?.length ||
			node.depthPlane
		) {
			return null;
		}
		const nodeArtboardId = selectArtboardIdForNode(input.scene, role.nodeId);
		if (!nodeArtboardId) return null;
		if (artboardId && artboardId !== nodeArtboardId) return null;
		artboardId = nodeArtboardId;
	}
	return artboardId ?? null;
};

const unrelatedBindingTouchesRole = (
	binding: MotionGrammarBinding,
	roleNodeIds: ReadonlySet<string>,
): boolean =>
	binding.targetIds.some((nodeId) => roleNodeIds.has(nodeId)) ||
	Object.keys(binding.roleMap ?? {}).some((nodeId) => roleNodeIds.has(nodeId));

const addIncompatibility = (
	list: TimeOffsetCandidateIncompatibility[],
	entry: TimeOffsetCandidateIncompatibility,
): void => {
	list.push(entry);
};

const resolveCandidate = (
	input: TimeOffsetPresentationCandidateInput,
): CandidateResolution | string => {
	if (timeOffsetReferenceCriticalFrames(input.source).status === "blocked") {
		return "Offset source law failed its independent critical-frame validation.";
	}
	const profile = resolveProfile(input.binding);
	if (typeof profile === "string") return profile;
	const roles = resolveRoles(input);
	if (typeof roles === "string") return roles;
	const clip = resolveClip(input, profile);
	if (typeof clip === "string") return clip;
	const artboardId = resolveRoleArtboard(input, roles);
	if (!artboardId) {
		return "Offset comparison requires renderable, top-level, same-artboard roles with no transform relation or depth plane.";
	}
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== artboardId
	) {
		return "Offset comparison artboard must match every mapped role.";
	}
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(item) => item.id === artboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return "Offset comparison requires an explicit screen_2d camera-space policy.";
	}
	const roleNodeIds = new Set(roles.map((role) => role.nodeId));
	if (
		input.bindings.some(
			(binding) =>
				binding.id !== input.binding.id &&
				unrelatedBindingTouchesRole(binding, roleNodeIds),
		)
	) {
		return "Another motion-grammar binding also targets an Offset comparison role.";
	}
	if (
		input.motion.tracks.some((track) => roleNodeIds.has(track.target.nodeId))
	) {
		return "Keyframe tracks on an Offset comparison role would contaminate structural sampling.";
	}
	if (
		input.motion.positionPaths?.some((path) => roleNodeIds.has(path.nodeId))
	) {
		return "Spatial position paths on an Offset comparison role would contaminate structural sampling.";
	}
	if (
		input.scene.nativeExpressionBindings?.some((binding) =>
			roleNodeIds.has(binding.nodeId),
		)
	) {
		return "Native expression bindings on an Offset comparison role would contaminate structural sampling.";
	}
	const authoring = resolveAuthoring(input.binding);
	const incompatibilities: TimeOffsetCandidateIncompatibility[] = [];
	const compare = (
		code: TimeOffsetCandidateIncompatibilityCode,
		message: string,
		expected: unknown,
		actual: unknown,
	): void => {
		if (Object.is(expected, actual)) return;
		addIncompatibility(incompatibilities, {
			code,
			message,
			expected: String(expected),
			actual: String(actual),
		});
	};
	compare(
		"period-frames",
		"Source period differs from candidate period.",
		input.source.periodFrames,
		profile.periodFrames,
	);
	compare(
		"subcycle-frames",
		"Source subcycle is not the candidate's hidden subcycle.",
		input.source.subcycleFrames,
		profile.subcycleFrames,
	);
	compare(
		"active-frames",
		"Source active window differs from candidate active window.",
		input.source.activeFrames,
		profile.activeFrames,
	);
	const sourceOverride = input.source.overrides[0];
	if (profile.semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION) {
		compare(
			"easing",
			"Source cubic-Bezier progress law differs from the candidate curve.",
			JSON.stringify(input.source.easing),
			JSON.stringify(profile.easingCurve),
		);
		compare(
			"spacing",
			"Source spacing differs after the candidate's explicit coordinate-unit calibration.",
			input.source.spacingSvgUnits * profile.sourceCoordinateScale,
			profile.spacingSceneUnits,
		);
		compare(
			"slot-values",
			"Source radius values differ from the candidate's source-radius slot values.",
			JSON.stringify(input.source.slots.map((slot) => slot.valueSvgUnits)),
			JSON.stringify(profile.slotValues),
		);
		compare(
			"value-unit",
			"Candidate value-unit contract is not the explicit source-radius projection.",
			"source-radius-projected",
			profile.valueUnit,
		);
		compare(
			"override",
			"Source duplicate/slot override differs from candidate override.",
			sourceOverride
				? `${sourceOverride.duplicateClass}:${sourceOverride.slotIndex}:${sourceOverride.valueSvgUnits}`
				: "none",
			`${profile.overrideDup}:${profile.overrideSlot}:${profile.overrideValue}`,
		);
		compare(
			"visibility-threshold",
			"Source page visibility threshold differs from candidate source-unit cutoff.",
			input.source.pageRenderPresenceCutoffSvgUnits,
			profile.visibilityThresholdSourceUnits,
		);
	} else {
		addIncompatibility(incompatibilities, {
			code: "easing",
			message:
				"Source declares a cubic-Bezier progress law; the legacy profile hard-codes smoothstep.",
			expected: JSON.stringify(input.source.easing),
			actual: profile.easing,
		});
		compare(
			"spacing",
			"Source spacing differs from candidate conveyor spacing (units are separated).",
			input.source.spacingSvgUnits,
			profile.spacingSceneUnits,
		);
		addIncompatibility(incompatibilities, {
			code: "slot-values",
			message:
				"Source slot values are radius observations; candidate values are profile scale parameters.",
			expected: JSON.stringify(
				input.source.slots.map((slot) => slot.valueSvgUnits),
			),
			actual: JSON.stringify(profile.slotValues),
		});
		addIncompatibility(incompatibilities, {
			code: "value-unit",
			message:
				"Source interpolates radius pixels, while the candidate emits multiplicative scale factors.",
			expected: "radius-px",
			actual: profile.valueUnit,
		});
		compare(
			"override",
			"Source duplicate/slot override differs from candidate override.",
			sourceOverride
				? `${sourceOverride.duplicateClass}:${sourceOverride.slotIndex}:${sourceOverride.valueSvgUnits}`
				: "none",
			`${profile.overrideDup}:${profile.overrideSlot}:${profile.overrideValue}`,
		);
		compare(
			"visibility-threshold",
			"Source page visibility threshold differs from candidate opacity cutoff.",
			input.source.pageRenderPresenceCutoffSvgUnits,
			profile.visibilityThreshold,
		);
	}
	if (authoring.unavailableSourceSemanticKeys.length > 0) {
		addIncompatibility(incompatibilities, {
			code: "authoring-surface",
			message:
				"Source semantic controls are not exposed by the current Offset authoring profile.",
			expected: JSON.stringify(
				input.source.slots.map((slot) => slot.slotIndex),
			),
			actual: JSON.stringify(authoring.unavailableSourceSemanticKeys),
		});
	}
	if (authoring.ineffectiveExposedKeys.includes("staggerFrames")) {
		addIncompatibility(incompatibilities, {
			code: "stagger-not-effective",
			message:
				"staggerFrames is exposed in the profile descriptor but is not read by the canonical conveyor evaluator.",
			expected: "no exposed control, or an effective source-law mapping",
			actual: `${authoring.ineffectiveExposedKeys.join(", ")} exposed; canonical evaluator uses fixed subcycleFrames`,
		});
	}
	return {
		roles,
		artboardId,
		clip,
		profile,
		authoring,
		incompatibilities,
	};
};

/**
 * Samples the existing profile through the shared layout/expression/presentation
 * path. `incompatible` means the observation is useful but not a source-law
 * match; it is never a visual or automatic pass verdict.
 */
export function sampleTimeOffsetPresentationCandidate(
	input: TimeOffsetPresentationCandidateInput,
	sourceFrame: number,
): TimeOffsetCandidateResult {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return blocked(
			"Offset comparison requires exactly one binding object matching input.binding.",
		);
	}
	if (!Number.isFinite(sourceFrame)) {
		return blocked("Offset source comparison frame must be finite.");
	}
	const resolved = resolveCandidate(input);
	if (typeof resolved === "string") return blocked(resolved);
	const localFrame = positiveModulo(sourceFrame, resolved.profile.periodFrames);
	const frame = resolved.clip.startFrame + localFrame;
	if (
		frame < resolved.clip.startFrame ||
		frame >= resolved.clip.endFrameExclusive ||
		frame > input.motion.durationFrames
	) {
		return blocked(
			"Offset candidate frame lies outside the resolved profile clip.",
		);
	}
	const layoutScene = materializeLayoutFramesForPresentation(input.scene);
	const grammar = buildExpressionAwareFrameSampler({
		scene: layoutScene,
		fps: input.motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: input.bindings,
			scene: layoutScene,
			motion: input.motion,
		}),
	});
	if (!grammar) {
		return blocked(
			"Offset candidate has no shared grammar presentation sampler.",
		);
	}
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame,
		artboardId: resolved.artboardId,
		grammar,
	});
	const valuesByNodeId = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const samples: TimeOffsetPresentationCandidateSample[] = [];
	for (const role of resolved.roles) {
		const value = valuesByNodeId.get(role.nodeId);
		if (!value) {
			return blocked("Offset shared presentation omitted a mapped slot node.");
		}
		if (
			![
				value.transform.position.x,
				value.transform.position.y,
				value.transform.scale.x,
				value.transform.scale.y,
				value.opacity,
			].every(Number.isFinite)
		) {
			return blocked(
				"Offset shared presentation emitted a non-finite channel.",
			);
		}
		samples.push({
			targetId: role.targetId,
			slotIndex: role.slotIndex,
			candidateFrame: frame,
			role: role.role,
			nodeId: role.nodeId,
			profilePositionX:
				value.transform.position.x - resolved.profile.referenceOriginX,
			profilePositionY:
				value.transform.position.y - resolved.profile.referenceOriginY,
			scaleX: value.transform.scale.x,
			scaleY: value.transform.scale.y,
			radiusEquivalentSceneUnits:
				value.transform.scale.x * resolved.profile.radiusAnchorSceneUnits,
			opacity: value.opacity,
			opacityPresent: value.opacity > 0,
		});
	}
	if (resolved.incompatibilities.length > 0) {
		return {
			status: "incompatible",
			surface: TIME_OFFSET_CANDIDATE_SURFACE,
			artboardId: resolved.artboardId,
			clipStartFrame: resolved.clip.startFrame,
			profile: resolved.profile,
			authoring: resolved.authoring,
			incompatibilities: resolved.incompatibilities,
			samples,
		};
	}
	return {
		status: "ready",
		surface: TIME_OFFSET_CANDIDATE_SURFACE,
		artboardId: resolved.artboardId,
		clipStartFrame: resolved.clip.startFrame,
		profile: resolved.profile,
		authoring: resolved.authoring,
		samples,
	};
}
