import { castDraft } from "immer";
import type { MotionCommand } from "@/entities/motion/model/command";
import type { MotionTimingTemplateId } from "@/entities/motion/model/easing";
import type {
	AnimationClip,
	AnimationClipProvenance,
	KeyframeTrack,
	ScalarAnimatableProperty,
} from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { cloneSceneDocument, createNode } from "@/entities/scene/model/factory";
import { findLayerByNodeId, findNode } from "@/entities/scene/model/selectors";
import type {
	Artboard,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import { type UnitBezier, unitBezierY } from "@/shared/glammer/unit-bezier";
import { createId } from "@/shared/lib/id";
import {
	legacyRgbSplitToCanonical,
	normalizeVisualRecipe,
	VECMO_CHROMATIC_ABERRATION_MAX_SHIFT_METADATA_KEY,
	VECMO_FILM_GRAIN_BACKGROUND_WEIGHT_METADATA_KEY,
	VECMO_FILM_GRAIN_OBJECT_WEIGHT_METADATA_KEY,
	VECMO_FILM_GRAIN_SEED_NAMESPACE_METADATA_KEY,
	type VisualRecipe,
} from "@/shared/vec-core";
import type {
	MotionGrammarAuthoringParameterGroup,
	MotionGrammarAuthoringParameterRole,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileDescriptor,
} from "./authoring-profile";
import type { MotionGrammarBinding } from "./types";
import {
	MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY,
	type MotionGrammarWorkspaceInstanceNode,
	type MotionGrammarWorkspaceRoleData,
} from "./workspace-instance";

type TimeDelaySatelliteState = {
	readonly cx: number;
	readonly cy: number;
	readonly r: number;
};

type TimeDelayDotState = {
	readonly cx: number;
	readonly cy: number;
	readonly width: number;
	readonly height: number;
	readonly satellite: TimeDelaySatelliteState | null;
};

type TimeDelayMasterState = Omit<TimeDelayDotState, "cx" | "satellite"> & {
	readonly satellite: Omit<TimeDelaySatelliteState, "cx"> | null;
};

type TimeDelayProfileParams = {
	readonly tLift: number;
	readonly riseDur: number;
	readonly fallDur: number;
	readonly cyApex: number;
	readonly riseBezier: UnitBezier;
	readonly fallBezier: UnitBezier;
	readonly settleLambda: number;
	readonly settleOmega: number;
};

type TimeDelaySatelliteParams = {
	readonly separationLocalFrame: number;
	readonly preSeparationFrames: number;
	readonly lifeFrames: number;
	readonly rAnchor: number;
	readonly rDecay: number;
	readonly cyAnchor: number;
	readonly cyAsymptote: number;
	readonly cyRatio: number;
};

type TimeDelayParams = {
	readonly periodFrames: number;
	readonly staggerFrames: number;
	readonly launchPhaseShift: number;
	readonly dotCount: number;
	readonly dotCx0: number;
	readonly dotSpacing: number;
	readonly restCy: number;
	readonly sizeBasePx: number;
	readonly stretchK: number;
	readonly jump: TimeDelayProfileParams;
	readonly satellite: TimeDelaySatelliteParams;
	readonly bodyFillRgb: readonly [number, number, number];
	readonly satelliteFillRgb: readonly [number, number, number];
};

type TimeDelayTrackProperty = Extract<
	ScalarAnimatableProperty,
	"x" | "y" | "scaleX" | "scaleY" | "opacity"
>;

type TimeDelayMaterializedNodeSet = {
	readonly body: VectorNode;
	readonly satellite: VectorNode;
	readonly bodyRole: string;
	readonly satelliteRole: string;
};

type TimeDelayTrackSample = {
	readonly frame: number;
	readonly value: number;
};

export type GlammerTimeDelayAuthoringRoleSample = {
	readonly nodeId: string;
	readonly role: string;
	readonly kind: "body" | "satellite";
	readonly x: number;
	readonly y: number;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly opacity: number;
};

export type GlammerTimeDelayInstanceDescriptor = {
	readonly index: number;
	readonly bodyNodeId: string;
	readonly bodyRole: string;
	readonly satelliteNodeId?: string;
	readonly satelliteRole: string;
	readonly delayFrames: number;
	readonly xOffset: number;
};

export type TimeDelayMaterializationPlan =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly techniqueId: "time-delay";
			readonly binding: MotionGrammarBinding;
			readonly layerId?: string;
			readonly artboardId: string;
			readonly stageBackground: string;
			readonly generatedNodes: readonly MotionGrammarWorkspaceInstanceNode[];
			readonly roleMap: Readonly<Record<string, string>>;
			readonly selectedSourceNodeIds: readonly string[];
			readonly nextSelectionNodeIds: readonly string[];
			readonly tracks: readonly KeyframeTrack<number>[];
			readonly clip: AnimationClip;
	  };

export type ReadyTimeDelayMaterializationPlan = Extract<
	TimeDelayMaterializationPlan,
	{ readonly status: "ready" }
>;

const TIME_DELAY_PARAMS = {
	periodFrames: 90,
	staggerFrames: 4,
	launchPhaseShift: 1,
	dotCount: 5,
	dotCx0: 101.3,
	dotSpacing: 34.275,
	restCy: 171.5,
	sizeBasePx: 28.9,
	stretchK: 0.0313,
	jump: {
		tLift: 84.6,
		riseDur: 19.69,
		fallDur: 10.29,
		cyApex: 68.9,
		riseBezier: [0.746, 0.008, 0.196, 1],
		fallBezier: [0.79, 0, 0.789, 0.741],
		settleLambda: 0.17,
		settleOmega: 0.426,
	},
	satellite: {
		separationLocalFrame: 29,
		preSeparationFrames: 3,
		lifeFrames: 18,
		rAnchor: 9.3,
		rDecay: 0.89,
		cyAnchor: 155.3,
		cyAsymptote: 119.1,
		cyRatio: 0.901,
	},
	bodyFillRgb: [29, 31, 35],
	satelliteFillRgb: [29, 31, 35],
} as const satisfies TimeDelayParams;

export const GLAMMER_TIME_DELAY_STAGE_BACKGROUND = "#f4f3ef" as const;

const REFERENCE_COMP = {
	width: 340,
	height: 240,
} as const;
const TIME_DELAY_FOLLOW_TEMPLATE_ID =
	"follow.stagger-inherit" satisfies MotionTimingTemplateId;

export const GLAMMER_TIME_DELAY_REFERENCE_FRAME = 18 as const;
export const GLAMMER_TIME_DELAY_PROFILE_KIND = "glammer-time-delay-v1" as const;
export const GLAMMER_TIME_DELAY_PROFILE_VERSION = 1 as const;
export const GLAMMER_TIME_DELAY_MASTER_INSTANCE_VERSION = 1 as const;
export const GLAMMER_TIME_DELAY_LOOK_PROFILE_VERSION = 1 as const;
const GLAMMER_TIME_DELAY_CA_FRINGING = 0.6;
const GLAMMER_TIME_DELAY_CA_MAX_SHIFT_PX = 18;

export const GLAMMER_TIME_DELAY_MASTER_INSTANCE_PARAMETER_DEFAULTS = {
	masterInstanceVersion: GLAMMER_TIME_DELAY_MASTER_INSTANCE_VERSION,
	masterProfileIndex: 0,
	instanceCount: TIME_DELAY_PARAMS.dotCount,
	instanceDelayFrames: TIME_DELAY_PARAMS.staggerFrames,
	instanceSpacingX: TIME_DELAY_PARAMS.dotSpacing,
} as const satisfies Readonly<Record<string, number>>;

const GLAMMER_TIME_DELAY_INSTANCE_PARAMETER_DEFAULTS = Object.fromEntries(
	Array.from({ length: TIME_DELAY_PARAMS.dotCount }, (_, index) => [
		[
			`instance${index + 1}DelayFrames`,
			index * TIME_DELAY_PARAMS.staggerFrames,
		],
		[`instance${index + 1}OffsetX`, index * TIME_DELAY_PARAMS.dotSpacing],
	]).flat(),
) as Readonly<Record<string, number>>;

const instanceParameterKey = (
	index: number,
	suffix: "DelayFrames" | "OffsetX",
): string => `instance${index + 1}${suffix}`;

export const GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS = {
	lookProfileVersion: GLAMMER_TIME_DELAY_LOOK_PROFILE_VERSION,
	lookBodyGrain: 0,
	lookBodyNoiseScale: 0.84,
	lookBodyGlow: 0,
	lookBodyGlowRadius: 0,
	lookBodyExposure: 0,
	lookBodyContrast: 1.04,
	lookBodySaturation: 1,
	lookBodyRgbSplit: 0,
	lookSatelliteGrain: 0,
	lookSatelliteNoiseScale: 0.76,
	lookSatelliteGlow: 0,
	lookSatelliteGlowRadius: 0,
	lookSatelliteExposure: 0,
	lookSatelliteContrast: 1.04,
	lookSatelliteSaturation: 1,
	lookSatelliteRgbSplit: 0,
} as const satisfies Readonly<Record<string, number>>;

export type GlammerTimeDelayLookRole = "body" | "satellite";

export type GlammerTimeDelayLookSettings = {
	readonly grain: number;
	readonly noiseScale: number;
	readonly glow: number;
	readonly glowRadius: number;
	readonly exposure: number;
	readonly contrast: number;
	readonly saturation: number;
	readonly rgbSplit: number;
};

export type GlammerTimeDelayLookPatch = {
	readonly body?: Partial<GlammerTimeDelayLookSettings>;
	readonly satellite?: Partial<GlammerTimeDelayLookSettings>;
};

const authoringParameter = ({
	key,
	label,
	defaultValue,
	min,
	max,
	step,
	role,
	advanced,
}: {
	readonly key: string;
	readonly label: string;
	readonly defaultValue: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly role: MotionGrammarAuthoringParameterRole;
	readonly advanced?: boolean;
}): MotionGrammarAuthoringParameterSpec => ({
	key,
	label,
	default: defaultValue,
	min,
	max,
	step,
	role,
	...(advanced === undefined ? {} : { advanced }),
});

const lookAuthoringParameter = (
	key: keyof typeof GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS,
	label: string,
	min: number,
	max: number,
	step: number,
): MotionGrammarAuthoringParameterSpec =>
	authoringParameter({
		key,
		label,
		defaultValue: GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS[key],
		min,
		max,
		step,
		role: "look",
	});

const TIME_DELAY_LOOK_PARAMETER_KEYS = {
	body: {
		grain: "lookBodyGrain",
		noiseScale: "lookBodyNoiseScale",
		glow: "lookBodyGlow",
		glowRadius: "lookBodyGlowRadius",
		exposure: "lookBodyExposure",
		contrast: "lookBodyContrast",
		saturation: "lookBodySaturation",
		rgbSplit: "lookBodyRgbSplit",
	},
	satellite: {
		grain: "lookSatelliteGrain",
		noiseScale: "lookSatelliteNoiseScale",
		glow: "lookSatelliteGlow",
		glowRadius: "lookSatelliteGlowRadius",
		exposure: "lookSatelliteExposure",
		contrast: "lookSatelliteContrast",
		saturation: "lookSatelliteSaturation",
		rgbSplit: "lookSatelliteRgbSplit",
	},
} as const satisfies Readonly<
	Record<
		GlammerTimeDelayLookRole,
		Record<
			keyof GlammerTimeDelayLookSettings,
			keyof typeof GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS
		>
	>
>;

const TIME_DELAY_LOOK_SETTING_LIMITS = {
	grain: { min: 0, max: 1 },
	noiseScale: { min: 0.05, max: 2 },
	glow: { min: 0, max: 1 },
	glowRadius: { min: 0, max: 100 },
	exposure: { min: -1, max: 1 },
	contrast: { min: 0, max: 4 },
	saturation: { min: 0, max: 4 },
	rgbSplit: { min: 0, max: 6 },
} as const satisfies Readonly<
	Record<
		keyof GlammerTimeDelayLookSettings,
		{ readonly min: number; readonly max: number }
	>
>;

const GLAMMER_TIME_DELAY_AUTHORING_PARAMETER_GROUPS = [
	{
		id: "timing",
		label: "Timing",
		intent:
			"Controls the shared master profile timing and the default delay between replayed instances.",
		parameters: [
			authoringParameter({
				key: "periodFrames",
				label: "Period",
				defaultValue: TIME_DELAY_PARAMS.periodFrames,
				min: 1,
				max: 600,
				step: 1,
				role: "timing",
			}),
			authoringParameter({
				key: "staggerFrames",
				label: "Catalog stagger",
				defaultValue: TIME_DELAY_PARAMS.staggerFrames,
				min: 0,
				max: 60,
				step: 1,
				role: "timing",
				advanced: true,
			}),
			authoringParameter({
				key: "instanceDelayFrames",
				label: "Instance delay",
				defaultValue: TIME_DELAY_PARAMS.staggerFrames,
				min: 0,
				max: 60,
				step: 1,
				role: "timing",
			}),
		],
	},
	{
		id: "layout",
		label: "Layout",
		intent:
			"Controls the default spacing used when the delayed instances are reconstructed from the master profile.",
		parameters: [
			authoringParameter({
				key: "instanceSpacingX",
				label: "Instance spacing",
				defaultValue: TIME_DELAY_PARAMS.dotSpacing,
				min: 0,
				max: 240,
				step: 0.25,
				role: "layout",
			}),
		],
	},
	{
		id: "instance-overrides",
		label: "Instance overrides",
		intent:
			"Optional per-instance delay and x-offset overrides. These describe delayed instances; they are not separate motion curves.",
		parameters: Array.from(
			{ length: TIME_DELAY_PARAMS.dotCount },
			(_, index): readonly MotionGrammarAuthoringParameterSpec[] => [
				authoringParameter({
					key: instanceParameterKey(index, "DelayFrames"),
					label: `Dot ${index + 1} delay`,
					defaultValue: index * TIME_DELAY_PARAMS.staggerFrames,
					min: 0,
					max: 180,
					step: 1,
					role: "timing",
					advanced: true,
				}),
				authoringParameter({
					key: instanceParameterKey(index, "OffsetX"),
					label: `Dot ${index + 1} x offset`,
					defaultValue: index * TIME_DELAY_PARAMS.dotSpacing,
					min: -240,
					max: 360,
					step: 0.25,
					role: "layout",
					advanced: true,
				}),
			],
		).flat(),
	},
	{
		id: "body-look",
		label: "Body look",
		intent:
			"Controls the vec-core recipe sampled onto the capsule bodies while keeping their fill color dark.",
		parameters: [
			lookAuthoringParameter("lookBodyGrain", "Body grain", 0, 1, 0.01),
			lookAuthoringParameter(
				"lookBodyNoiseScale",
				"Body noise scale",
				0.05,
				2,
				0.01,
			),
			lookAuthoringParameter("lookBodyGlow", "Body glow", 0, 1, 0.01),
			lookAuthoringParameter(
				"lookBodyGlowRadius",
				"Body glow radius",
				0,
				100,
				1,
			),
			lookAuthoringParameter("lookBodyExposure", "Body exposure", -1, 1, 0.01),
			lookAuthoringParameter("lookBodyContrast", "Body contrast", 0, 4, 0.01),
			lookAuthoringParameter(
				"lookBodySaturation",
				"Body saturation",
				0,
				4,
				0.01,
			),
			lookAuthoringParameter("lookBodyRgbSplit", "Body RGB split", 0, 6, 0.01),
		],
	},
	{
		id: "satellite-look",
		label: "Satellite look",
		intent:
			"Controls the vec-core recipe sampled onto the follower satellite dots.",
		parameters: [
			lookAuthoringParameter(
				"lookSatelliteGrain",
				"Satellite grain",
				0,
				1,
				0.01,
			),
			lookAuthoringParameter(
				"lookSatelliteNoiseScale",
				"Satellite noise scale",
				0.05,
				2,
				0.01,
			),
			lookAuthoringParameter("lookSatelliteGlow", "Satellite glow", 0, 1, 0.01),
			lookAuthoringParameter(
				"lookSatelliteGlowRadius",
				"Satellite glow radius",
				0,
				100,
				1,
			),
			lookAuthoringParameter(
				"lookSatelliteExposure",
				"Satellite exposure",
				-1,
				1,
				0.01,
			),
			lookAuthoringParameter(
				"lookSatelliteContrast",
				"Satellite contrast",
				0,
				4,
				0.01,
			),
			lookAuthoringParameter(
				"lookSatelliteSaturation",
				"Satellite saturation",
				0,
				4,
				0.01,
			),
			lookAuthoringParameter(
				"lookSatelliteRgbSplit",
				"Satellite RGB split",
				0,
				6,
				0.01,
			),
		],
	},
] as const satisfies readonly MotionGrammarAuthoringParameterGroup[];

const boundedParameter = (
	parameters: Readonly<Record<string, number>>,
	key: keyof typeof GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS,
	min: number,
	max: number,
): number => {
	const fallback = GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS[key];
	const value = parameters[key];
	const numeric =
		typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(Math.max(numeric, min), max);
};

const timeDelayLookProfile = (
	parameters: Readonly<Record<string, number>>,
	role: GlammerTimeDelayLookRole,
): GlammerTimeDelayLookSettings => {
	const keys = TIME_DELAY_LOOK_PARAMETER_KEYS[role];
	return {
		grain: boundedParameter(parameters, keys.grain, 0, 1),
		noiseScale: boundedParameter(parameters, keys.noiseScale, 0.05, 2),
		glow: boundedParameter(parameters, keys.glow, 0, 1),
		glowRadius: boundedParameter(parameters, keys.glowRadius, 0, 100),
		exposure: boundedParameter(parameters, keys.exposure, -1, 1),
		contrast: boundedParameter(parameters, keys.contrast, 0, 4),
		saturation: boundedParameter(parameters, keys.saturation, 0, 4),
		rgbSplit: boundedParameter(parameters, keys.rgbSplit, 0, 6),
	};
};

const clampLookSetting = (
	key: keyof GlammerTimeDelayLookSettings,
	value: number,
): number => {
	const limits = TIME_DELAY_LOOK_SETTING_LIMITS[key];
	return Math.min(Math.max(value, limits.min), limits.max);
};

/**
 * Builds a safe numeric binding-parameter patch from semantic Time Delay look
 * fields. This is the AI/MCP-facing authoring seam: tools can request
 * `{ satellite: { glow: 0.7 } }` and let Vecmo map it to the durable parameter
 * keys that later evaluate into vec-core recipes.
 */
export function createGlammerTimeDelayLookParameterPatch(
	patch: GlammerTimeDelayLookPatch,
): Readonly<Record<string, number>> {
	const parameters: Record<string, number> = {
		lookProfileVersion: GLAMMER_TIME_DELAY_LOOK_PROFILE_VERSION,
	};
	for (const role of ["body", "satellite"] as const) {
		const rolePatch = patch[role];
		if (!rolePatch) continue;
		const keys = TIME_DELAY_LOOK_PARAMETER_KEYS[role];
		for (const key of Object.keys(
			keys,
		) as (keyof GlammerTimeDelayLookSettings)[]) {
			const value = rolePatch[key];
			if (typeof value !== "number" || !Number.isFinite(value)) continue;
			parameters[keys[key]] = clampLookSetting(key, value);
		}
	}
	return parameters;
}

/**
 * Applies a semantic look patch over existing binding parameters without
 * touching motion timing or role mapping. The returned object is safe to pass to
 * the existing motion-grammar binding update command.
 */
export function mergeGlammerTimeDelayLookParameters(
	parameters: Readonly<Record<string, number>>,
	patch: GlammerTimeDelayLookPatch,
): Readonly<Record<string, number>> {
	return {
		...parameters,
		...createGlammerTimeDelayLookParameterPatch(patch),
	};
}

/**
 * Converts the Time Delay typed look profile into the canonical vec-core recipe
 * consumed by CanvasShell/export. AI/MCP callers should edit the numeric
 * `look*` parameters on the binding; this function is the deterministic adapter
 * from semantic profile values to recipe payload.
 */
export function glammerTimeDelayLookRecipeForRole(
	parameters: Readonly<Record<string, number>>,
	role: GlammerTimeDelayLookRole,
): VisualRecipe {
	const profile = timeDelayLookProfile(parameters, role);
	const idSuffix = role === "body" ? "body" : "satellite";
	const labelSuffix = role === "body" ? "Body" : "Satellite";
	return normalizeVisualRecipe({
		id: `glammer-time-delay-${idSuffix}-look`,
		label: `Glammer Time Delay ${labelSuffix}`,
		intent: "motion-graphics",
		texture: { grain: profile.grain, noiseScale: profile.noiseScale },
		glow: { bloom: profile.glow, radius: profile.glowRadius },
		color: {
			exposure: profile.exposure,
			contrast: profile.contrast,
			saturation: profile.saturation,
			tint: null,
		},
		optics: { chromaticFringing: legacyRgbSplitToCanonical(profile.rgbSplit) },
		metadata: {
			"profile.kind": GLAMMER_TIME_DELAY_PROFILE_KIND,
			"profile.lookVersion": GLAMMER_TIME_DELAY_LOOK_PROFILE_VERSION,
			"profile.role": role,
		},
	});
}

const TIME_DELAY_BODY_LOOK_RECIPE: VisualRecipe =
	glammerTimeDelayLookRecipeForRole(
		GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS,
		"body",
	);

const TIME_DELAY_SATELLITE_LOOK_RECIPE: VisualRecipe =
	glammerTimeDelayLookRecipeForRole(
		GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS,
		"satellite",
	);

/**
 * The canonical "Analog Film" frame look — a soft analog-film treatment (fine
 * additive grain + a faint cyan/orange chromatic-aberration edge over a slightly
 * de-saturated, gently lifted grade). This is the SINGLE SOURCE OF TRUTH: it is
 * BOTH the stage recipe the Time Delay motion paints (via {@link
 * timeDelayStageArtboard}) AND the recipe surfaced by the editor's one-click
 * "Analog Film" frame-look recall (Inspector Frame Look + command palette). The
 * look is named generically because it is reusable on any frame, not
 * Time-Delay-specific; it physically lives in this module only because its
 * CA/grain dependency consts do (moving it to entities/scene would be an upward
 * import). Both consumers IMPORT this const rather than re-inlining it,
 * so tuning the texture here updates the recall in lockstep and the recall's
 * active-state signature compare stays true.
 *
 * It must remain a {@link normalizeVisualRecipe} output: the apply path
 * (`applyEffectIntentPatch` → `normalizeVisualRecipe`) is idempotent, every
 * metadata key (grain weights, CA max-shift, `profile.stage`) survives
 * byte-identically, and the frame renderer (`CanvasShell` film-grain overlay +
 * chromatic-aberration `feDisplacementMap`) reproduces the loved texture exactly.
 *
 * It stays in `entities/motion-grammar` (not `entities/scene`) because its three
 * `GLAMMER_TIME_DELAY_*` dependency consts live here and have no other consumers;
 * the recall's consumers are `widgets/*`, which import this DOWNWARD legally.
 */
export const ANALOG_FILM_LOOK_RECIPE: VisualRecipe = normalizeVisualRecipe({
	id: "glammer-time-delay-stage-film",
	label: "Glammer Time Delay Stage Film",
	intent: "motion-graphics",
	texture: {
		grain: {
			enabled: true,
			strength: 0.9,
			size: 0.4,
			seed: 41,
			character: "neutral",
			fusionMode: "additive",
			chroma: 0,
		},
	},
	color: {
		exposure: 0.02,
		contrast: 0.98,
		saturation: 0.92,
		tint: null,
	},
	optics: { chromaticFringing: GLAMMER_TIME_DELAY_CA_FRINGING },
	metadata: {
		"profile.kind": GLAMMER_TIME_DELAY_PROFILE_KIND,
		"profile.stage": "film-background",
		[VECMO_CHROMATIC_ABERRATION_MAX_SHIFT_METADATA_KEY]:
			GLAMMER_TIME_DELAY_CA_MAX_SHIFT_PX,
		[VECMO_FILM_GRAIN_SEED_NAMESPACE_METADATA_KEY]: "api-finish-time-delay",
		[VECMO_FILM_GRAIN_OBJECT_WEIGHT_METADATA_KEY]: 0.6,
		[VECMO_FILM_GRAIN_BACKGROUND_WEIGHT_METADATA_KEY]: 0.16,
	},
});

/** Stable id for the one recallable "Analog Film" frame look. */
export const ANALOG_FILM_LOOK_ID = "analog-film" as const;

/** Human label for the recallable "Analog Film" frame look. */
export const ANALOG_FILM_LOOK_LABEL = "Analog Film" as const;

const LINEAR_INTERP = 6612;
const HOLD_INTERP = 6614;
const LINEAR_EASE = [{ speed: 0, influence: 0 }] as const;
const TRACK_VALUE_EPSILON = 1e-6;

const TRACK_TOLERANCE = {
	bodyY: 0.45,
	bodyScaleY: 0.012,
	satelliteY: 0.6,
	satelliteScale: 0.018,
} as const;

const timeDelayBodyRole = (index: number): string =>
	`time-delay:dot-${index + 1}:body`;

const timeDelaySatelliteRole = (index: number): string =>
	`time-delay:dot-${index + 1}:satellite`;

const TRACKED_FRAMES = Array.from(
	{ length: TIME_DELAY_PARAMS.periodFrames + 1 },
	(_, frame) => frame,
);

const positiveModulo = (value: number, modulo: number): number =>
	((value % modulo) + modulo) % modulo;

const unitBezierSlope = (
	p1x: number,
	p1y: number,
	p2x: number,
	p2y: number,
	x: number,
): number => {
	if (x <= 0) return p1x > 1e-9 ? p1y / p1x : 0;
	if (x >= 1) return 1 - p2x > 1e-9 ? (1 - p2y) / (1 - p2x) : 0;
	let lo = 0;
	let hi = 1;
	for (let index = 0; index < 40; index += 1) {
		const mid = (lo + hi) / 2;
		const omt = 1 - mid;
		const bx = 3 * omt * omt * mid * p1x + 3 * omt * mid * mid * p2x + mid ** 3;
		if (bx < x) lo = mid;
		else hi = mid;
	}
	const t = (lo + hi) / 2;
	const omt = 1 - t;
	const dx =
		3 * omt * omt * p1x + 6 * omt * t * (p2x - p1x) + 3 * t * t * (1 - p2x);
	const dy =
		3 * omt * omt * p1y + 6 * omt * t * (p2y - p1y) + 3 * t * t * (1 - p2y);
	return dx <= 1e-12 ? 0 : dy / dx;
};

const seededSettleJumpLandVelocity = (
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): number => {
	const [, , control2X, control2Y] = params.jump.fallBezier;
	const slope = 1 - control2X > 1e-9 ? (1 - control2Y) / (1 - control2X) : 0;
	return ((params.restCy - params.jump.cyApex) * slope) / params.jump.fallDur;
};

const seededSettleJumpCy = (
	tau: number,
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): number => {
	const { jump } = params;
	const amplitude = params.restCy - jump.cyApex;
	if (tau < jump.riseDur) {
		const [x1, y1, x2, y2] = jump.riseBezier;
		return (
			params.restCy -
			amplitude * unitBezierY(x1, y1, x2, y2, tau / jump.riseDur)
		);
	}
	const landTau = jump.riseDur + jump.fallDur;
	if (tau < landTau) {
		const [x1, y1, x2, y2] = jump.fallBezier;
		return (
			jump.cyApex +
			amplitude *
				unitBezierY(x1, y1, x2, y2, (tau - jump.riseDur) / jump.fallDur)
		);
	}
	const settleT = tau - landTau;
	return (
		params.restCy +
		(seededSettleJumpLandVelocity(params) / jump.settleOmega) *
			Math.exp(-jump.settleLambda * settleT) *
			Math.sin(jump.settleOmega * settleT)
	);
};

const seededSettleJumpVy = (
	tau: number,
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): number => {
	const { jump } = params;
	const amplitude = params.restCy - jump.cyApex;
	if (tau < jump.riseDur) {
		const [x1, y1, x2, y2] = jump.riseBezier;
		return (
			(-amplitude / jump.riseDur) *
			unitBezierSlope(x1, y1, x2, y2, tau / jump.riseDur)
		);
	}
	const landTau = jump.riseDur + jump.fallDur;
	if (tau < landTau) {
		const [x1, y1, x2, y2] = jump.fallBezier;
		return (
			(amplitude / jump.fallDur) *
			unitBezierSlope(x1, y1, x2, y2, (tau - jump.riseDur) / jump.fallDur)
		);
	}
	const settleT = tau - landTau;
	const velocity = seededSettleJumpLandVelocity(params);
	const decay = Math.exp(-jump.settleLambda * settleT);
	return (
		(velocity / jump.settleOmega) *
		decay *
		(jump.settleOmega * Math.cos(jump.settleOmega * settleT) -
			jump.settleLambda * Math.sin(jump.settleOmega * settleT))
	);
};

const timeDelayMasterLocalFrame = (
	frame: number,
	delayFrames: number,
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): number =>
	positiveModulo(
		frame + params.launchPhaseShift - delayFrames,
		params.periodFrames,
	);

const timeDelayMasterState = (
	localFrame: number,
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): TimeDelayMasterState => {
	const { jump, satellite } = params;
	const phase = positiveModulo(localFrame, params.periodFrames);
	const tau = positiveModulo(phase - jump.tLift, params.periodFrames);
	const velocityY = seededSettleJumpVy(tau, params);
	const scaleY = 1 + params.stretchK * Math.abs(velocityY);
	const half = params.periodFrames / 2;
	const satelliteAge =
		positiveModulo(
			phase - satellite.separationLocalFrame + half,
			params.periodFrames,
		) - half;
	const satelliteState =
		satelliteAge >= -satellite.preSeparationFrames &&
		satelliteAge < satellite.lifeFrames
			? {
					cy:
						satellite.cyAsymptote +
						(satellite.cyAnchor - satellite.cyAsymptote) *
							satellite.cyRatio ** satelliteAge,
					r: satellite.rAnchor * satellite.rDecay ** satelliteAge,
				}
			: null;
	return {
		cy: seededSettleJumpCy(tau, params),
		width: params.sizeBasePx,
		height: params.sizeBasePx * scaleY,
		satellite: satelliteState,
	};
};

const timeDelayInstanceState = ({
	localFrame,
	x,
	params = TIME_DELAY_PARAMS,
}: {
	readonly localFrame: number;
	readonly x: number;
	readonly params?: TimeDelayParams;
}): TimeDelayDotState => {
	const master = timeDelayMasterState(localFrame, params);
	return {
		...master,
		cx: x,
		satellite: master.satellite ? { ...master.satellite, cx: x } : null,
	};
};

const timeDelayDotState = (
	frame: number,
	layerIndex: number,
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): TimeDelayDotState =>
	timeDelayInstanceState({
		localFrame: timeDelayMasterLocalFrame(
			frame,
			layerIndex * params.staggerFrames,
			params,
		),
		x: params.dotCx0 + layerIndex * params.dotSpacing,
		params,
	});

const currentArtboard = (scene: SceneDocument): Artboard =>
	(scene.artboards ?? [scene.artboard]).find(
		(artboard) => artboard.id === scene.currentArtboardId,
	) ??
	scene.artboards?.[0] ??
	scene.artboard;

const editableLayer = (
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): SceneLayer | undefined => {
	for (const nodeId of selectedNodeIds) {
		const layer = findLayerByNodeId(scene, nodeId);
		if (layer?.visible && !layer.locked) return layer;
	}
	return [...scene.layers]
		.reverse()
		.find((layer) => layer.visible && !layer.locked);
};

const existingSelection = (
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): readonly string[] => {
	const seen = new Set<string>();
	const existing: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (seen.has(nodeId) || !findNode(scene, nodeId)) continue;
		seen.add(nodeId);
		existing.push(nodeId);
	}
	return existing;
};

const nodeOwnedByArtboard = (
	node: VectorNode,
	artboardId: string,
	fallbackArtboardId: string,
): boolean => (node.artboardId ?? fallbackArtboardId) === artboardId;

const timeDelayStageArtboard = (artboard: Artboard): Artboard => ({
	...artboard,
	background: GLAMMER_TIME_DELAY_STAGE_BACKGROUND,
	effectIntent: {
		...artboard.effectIntent,
		visualRecipe: ANALOG_FILM_LOOK_RECIPE,
	},
});

const applyTimeDelayStageArtboard = (
	draft: Parameters<SceneCommand["run"]>[0],
	artboardId: string,
): void => {
	if (draft.artboard.id === artboardId) {
		draft.artboard = castDraft(timeDelayStageArtboard(draft.artboard));
	}
	if (!draft.artboards) return;
	draft.artboards = castDraft(
		draft.artboards.map((artboard) =>
			artboard.id === artboardId ? timeDelayStageArtboard(artboard) : artboard,
		),
	);
};

const artboardOriginForReferenceComp = (
	artboard: Artboard,
): { readonly x: number; readonly y: number } => ({
	x: (artboard.width - REFERENCE_COMP.width) / 2,
	y: (artboard.height - REFERENCE_COMP.height) / 2,
});

const rgbColor = (rgb: readonly [number, number, number]): string =>
	`rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;

const bodyFillColor = (params: TimeDelayParams = TIME_DELAY_PARAMS): string =>
	rgbColor(params.bodyFillRgb);

const satelliteFillColor = (
	params: TimeDelayParams = TIME_DELAY_PARAMS,
): string => rgbColor(params.satelliteFillRgb);

/**
 * Detects the dedicated Time Delay workspace rig even after body roles have been
 * replaced with imported scene nodes. The role map is the durable marker; numeric
 * parameters are intentionally not trusted because this Glammer-style authoring
 * preset owns its generated body/satellite timing as one system.
 */
export function isGlammerTimeDelayAuthoringBinding(
	binding: MotionGrammarBinding,
): boolean {
	if (binding.techniqueId !== "time-delay") return false;
	if (binding.targetIds.length !== TIME_DELAY_PARAMS.dotCount) return false;
	const roleMap = binding.roleMap;
	if (!roleMap) return false;
	const bodyRolesMatch = binding.targetIds.every(
		(nodeId, index) => roleMap[nodeId] === timeDelayBodyRole(index),
	);
	if (!bodyRolesMatch) return false;
	const mappedRoles = new Set(Object.values(roleMap));
	return Array.from({ length: TIME_DELAY_PARAMS.dotCount }, (_, index) =>
		timeDelaySatelliteRole(index),
	).every((role) => mappedRoles.has(role));
}

/** True when a Time Delay authoring binding is backed by the typed profile IR. */
export function isGlammerTimeDelayAuthoringProfileBinding(
	binding: MotionGrammarBinding,
): boolean {
	return (
		isGlammerTimeDelayAuthoringBinding(binding) &&
		binding.parameters.profileVersion === GLAMMER_TIME_DELAY_PROFILE_VERSION
	);
}

/** Timing contract for the generated Glammer-style Time Delay authoring preset. */
export function glammerTimeDelayAuthoringTiming(
	binding: MotionGrammarBinding,
): { readonly periodFrames: number; readonly staggerFrames: number } | null {
	if (!isGlammerTimeDelayAuthoringBinding(binding)) return null;
	const periodFrames = binding.parameters.periodFrames;
	const staggerFrames = binding.parameters.staggerFrames;
	return {
		periodFrames:
			typeof periodFrames === "number" && Number.isFinite(periodFrames)
				? Math.max(1, periodFrames)
				: TIME_DELAY_PARAMS.periodFrames,
		staggerFrames:
			typeof staggerFrames === "number" && Number.isFinite(staggerFrames)
				? Math.max(0, staggerFrames)
				: TIME_DELAY_PARAMS.staggerFrames,
	};
}

const bindingNumber = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const timeDelayParamsForBinding = (
	binding: MotionGrammarBinding,
): TimeDelayParams => ({
	...TIME_DELAY_PARAMS,
	periodFrames: Math.max(
		1,
		bindingNumber(binding, "periodFrames", TIME_DELAY_PARAMS.periodFrames),
	),
	staggerFrames: Math.max(
		0,
		bindingNumber(binding, "staggerFrames", TIME_DELAY_PARAMS.staggerFrames),
	),
});

const roleNodeId = (
	binding: MotionGrammarBinding,
	role: string,
): string | undefined =>
	Object.entries(binding.roleMap ?? {}).find(
		([, value]) => value === role,
	)?.[0];

const boundedInstanceCount = (binding: MotionGrammarBinding): number => {
	const value = Math.round(
		bindingNumber(
			binding,
			"instanceCount",
			Math.min(TIME_DELAY_PARAMS.dotCount, binding.targetIds.length),
		),
	);
	return Math.max(0, Math.min(value, binding.targetIds.length));
};

/**
 * Reconstructs the Time Delay authoring rig as delayed instances of one master
 * motion profile. The returned descriptors are the semantic contract AI/MCP
 * tools should mutate: replace a node id through the role map, adjust delay or
 * spacing through parameters, and leave the master profile itself single-source.
 */
export function glammerTimeDelayInstanceDescriptors(
	binding: MotionGrammarBinding,
): readonly GlammerTimeDelayInstanceDescriptor[] {
	if (!isGlammerTimeDelayAuthoringProfileBinding(binding)) return [];
	const stepDelay = bindingNumber(
		binding,
		"instanceDelayFrames",
		TIME_DELAY_PARAMS.staggerFrames,
	);
	const stepX = bindingNumber(
		binding,
		"instanceSpacingX",
		TIME_DELAY_PARAMS.dotSpacing,
	);
	const descriptors: GlammerTimeDelayInstanceDescriptor[] = [];
	for (let index = 0; index < boundedInstanceCount(binding); index += 1) {
		const bodyNodeId = binding.targetIds[index];
		if (!bodyNodeId) continue;
		const bodyRole = timeDelayBodyRole(index);
		const satelliteRole = timeDelaySatelliteRole(index);
		descriptors.push({
			index,
			bodyNodeId,
			bodyRole,
			satelliteNodeId: roleNodeId(binding, satelliteRole),
			satelliteRole,
			delayFrames: bindingNumber(
				binding,
				instanceParameterKey(index, "DelayFrames"),
				index * stepDelay,
			),
			xOffset: bindingNumber(
				binding,
				instanceParameterKey(index, "OffsetX"),
				index * stepX,
			),
		});
	}
	return descriptors;
}

/**
 * Describes the Glammer-style Time Delay binding as an editable authoring
 * profile. This is intentionally not a layer-list duplicate: layers own object
 * hierarchy, while this descriptor explains which semantic profile parameters
 * and delayed instances can be edited by Inspector and AI/MCP surfaces.
 */
export function describeGlammerTimeDelayAuthoringProfile(
	binding: MotionGrammarBinding,
): MotionGrammarAuthoringProfileDescriptor | undefined {
	if (!isGlammerTimeDelayAuthoringProfileBinding(binding)) return undefined;
	const descriptors = glammerTimeDelayInstanceDescriptors(binding);
	const sourceProfileIndex = bindingNumber(binding, "masterProfileIndex", 0);
	const instances: MotionGrammarAuthoringProfileDescriptor["instances"] =
		descriptors.flatMap(
			(instance): MotionGrammarAuthoringProfileDescriptor["instances"] => [
				{
					index: instance.index,
					slotId: `dot:${instance.index + 1}:body`,
					reference: { kind: "scene-node", nodeId: instance.bodyNodeId },
					nodeId: instance.bodyNodeId,
					role: instance.bodyRole,
					roleLabel: `Dot ${instance.index + 1} body`,
					kind: "body",
					editable: true,
					replaceable: true,
					sourceProfileIndex,
					delayFrames: instance.delayFrames,
					offset: { x: instance.xOffset, y: 0 },
				},
				...(instance.satelliteNodeId
					? [
							{
								index: instance.index,
								slotId: `dot:${instance.index + 1}:satellite`,
								reference: {
									kind: "generated-scene-node" as const,
									nodeId: instance.satelliteNodeId,
								},
								nodeId: instance.satelliteNodeId,
								role: instance.satelliteRole,
								roleLabel: `Dot ${instance.index + 1} satellite`,
								kind: "satellite" as const,
								editable: true,
								replaceable: false,
								sourceProfileIndex,
								delayFrames: instance.delayFrames,
								offset: { x: instance.xOffset, y: 0 },
							},
						]
					: []),
			],
		);
	return {
		bindingId: binding.id,
		techniqueId: "time-delay",
		label: "Glammer Time Delay",
		summary:
			"One master motion profile replayed by editable delayed instances with vec-core look recipes.",
		kind: "master-instances",
		timeline: {
			mode: "trackless-expression",
			bakePolicy: "explicit-command",
			clipLabel: "Time Delay expansion",
			durationParameterKey: "periodFrames",
		},
		expansion: {
			mode: "editable-motion",
			label: "Editable motion output",
			actionLabel: "Create editable motion",
			previewLabel: "Preview editable output",
			description:
				"Creates ordinary editable tracks and generated support nodes from the Time Delay profile.",
			outputSummary:
				"Body roles stay editable scene objects; delayed satellite support can be materialized with scalar motion tracks.",
		},
		parameterGroups: GLAMMER_TIME_DELAY_AUTHORING_PARAMETER_GROUPS,
		instances,
		roleSlots: instances,
		timingTemplates: [
			{
				templateId: TIME_DELAY_FOLLOW_TEMPLATE_ID,
				role: "Delayed inheritance",
				note: "Instance delay controls replay one master profile across follower bodies and satellites.",
				parameterKeys: [
					"staggerFrames",
					"instanceDelayFrames",
					...Array.from({ length: TIME_DELAY_PARAMS.dotCount }, (_, index) =>
						instanceParameterKey(index, "DelayFrames"),
					),
				],
			},
			{
				templateId: "loop.phase-continuity",
				role: "Profile period",
				note: "The period parameter keeps the delayed phrase wrapped as one loop.",
				parameterKeys: ["periodFrames"],
			},
		],
		recipeRoles: ["body", "satellite"],
	};
}

/**
 * Evaluates the typed Glammer Time Delay authoring profile into absolute role
 * samples. AI/MCP tools should author or mutate the binding parameters and
 * role-map, not generate runtime JavaScript; this function is the deterministic
 * expression boundary used by preview/export/bake paths.
 */
export function sampleGlammerTimeDelayAuthoringProfile(
	binding: MotionGrammarBinding,
	frame: number,
): readonly GlammerTimeDelayAuthoringRoleSample[] {
	if (!isGlammerTimeDelayAuthoringProfileBinding(binding)) return [];
	const params = timeDelayParamsForBinding(binding);
	const origin = {
		x: bindingNumber(binding, "referenceOriginX", 0),
		y: bindingNumber(binding, "referenceOriginY", 0),
	};
	const samples: GlammerTimeDelayAuthoringRoleSample[] = [];
	for (const instance of glammerTimeDelayInstanceDescriptors(binding)) {
		const state = timeDelayInstanceState({
			localFrame: timeDelayMasterLocalFrame(
				frame,
				instance.delayFrames,
				params,
			),
			x: params.dotCx0 + instance.xOffset,
			params,
		});
		samples.push({
			nodeId: instance.bodyNodeId,
			role: instance.bodyRole,
			kind: "body",
			x: origin.x + state.cx,
			y: origin.y + state.cy,
			scaleX: 1,
			scaleY: state.height / state.width,
			opacity: 1,
		});

		const satelliteNodeId = instance.satelliteNodeId;
		if (!satelliteNodeId) continue;
		const satellite = state.satellite;
		const satelliteScale = satellite
			? satellite.r / params.satellite.rAnchor
			: 0.001;
		samples.push({
			nodeId: satelliteNodeId,
			role: instance.satelliteRole,
			kind: "satellite",
			x: origin.x + (satellite?.cx ?? state.cx),
			y: origin.y + (satellite?.cy ?? state.cy),
			scaleX: satelliteScale,
			scaleY: satelliteScale,
			opacity: satellite ? 1 : 0,
		});
	}
	return samples;
}

const roleData = ({
	bindingId,
	role,
	roleLabel,
	replaceable,
}: {
	readonly bindingId: string;
	readonly role: string;
	readonly roleLabel: string;
	readonly replaceable: boolean;
}): MotionGrammarWorkspaceRoleData => ({
	kind: "motion-grammar-workspace-role",
	schemaVersion: 1,
	bindingId,
	techniqueId: "time-delay",
	role,
	roleLabel,
	generated: true,
	replaceable,
});

const materializedNodeSet = ({
	artboard,
	bindingId,
	layerIndex,
	origin,
}: {
	readonly artboard: Artboard;
	readonly bindingId: string;
	readonly layerIndex: number;
	readonly origin: { readonly x: number; readonly y: number };
}): TimeDelayMaterializedNodeSet => {
	const initial = timeDelayDotState(
		GLAMMER_TIME_DELAY_REFERENCE_FRAME,
		layerIndex,
	);
	const satellite = initial.satellite;
	const dotSize = TIME_DELAY_PARAMS.sizeBasePx;
	const satelliteRadius = TIME_DELAY_PARAMS.satellite.rAnchor;
	const bodyRole = timeDelayBodyRole(layerIndex);
	const satelliteRole = timeDelaySatelliteRole(layerIndex);
	const bodyRoleLabel = `dot ${layerIndex + 1} body`;
	const satelliteRoleLabel = `dot ${layerIndex + 1} satellite`;
	const body = createNode(
		"rect",
		{
			kind: "rect",
			bounds: {
				x: -dotSize / 2,
				y: -dotSize / 2,
				width: dotSize,
				height: dotSize,
			},
			cornerRadius: dotSize / 2,
		},
		{
			name: `Time Delay dot ${layerIndex + 1}`,
			style: {
				fill: bodyFillColor(),
				stroke: bodyFillColor(),
				strokeWidth: 0,
				opacity: 1,
			},
			transform: {
				position: { x: origin.x + initial.cx, y: origin.y + initial.cy },
				scale: { x: 1, y: initial.height / initial.width },
				anchor: { x: 0, y: 0 },
			},
		},
	);
	const satelliteNode = createNode(
		"ellipse",
		{
			kind: "ellipse",
			bounds: {
				x: -satelliteRadius,
				y: -satelliteRadius,
				width: satelliteRadius * 2,
				height: satelliteRadius * 2,
			},
		},
		{
			name: `Time Delay satellite ${layerIndex + 1}`,
			style: {
				fill: satelliteFillColor(),
				stroke: satelliteFillColor(),
				strokeWidth: 0,
				opacity: satellite ? 1 : 0,
			},
			transform: {
				position: {
					x: origin.x + (satellite?.cx ?? initial.cx),
					y: origin.y + (satellite?.cy ?? initial.cy),
				},
				scale: {
					x: satellite ? satellite.r / satelliteRadius : 0.001,
					y: satellite ? satellite.r / satelliteRadius : 0.001,
				},
				anchor: { x: 0, y: 0 },
			},
		},
	);
	return {
		body: {
			...body,
			artboardId: artboard.id,
			recipe: TIME_DELAY_BODY_LOOK_RECIPE,
			data: {
				...body.data,
				[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY]: roleData({
					bindingId,
					role: bodyRole,
					roleLabel: bodyRoleLabel,
					replaceable: true,
				}),
			},
		},
		satellite: {
			...satelliteNode,
			artboardId: artboard.id,
			recipe: TIME_DELAY_SATELLITE_LOOK_RECIPE,
			data: {
				...satelliteNode.data,
				[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY]: roleData({
					bindingId,
					role: satelliteRole,
					roleLabel: satelliteRoleLabel,
					replaceable: false,
				}),
			},
		},
		bodyRole,
		satelliteRole,
	};
};

const temporalEase = (): {
	readonly speed: number;
	readonly influence: number;
}[] => LINEAR_EASE.map((point) => ({ ...point }));

const linearKeyframe = ({
	frame,
	value,
}: TimeDelayTrackSample): AeKeyframe<number> => ({
	time: frame,
	value,
	inInterpolationType: LINEAR_INTERP,
	outInterpolationType: LINEAR_INTERP,
	inTemporalEase: temporalEase(),
	outTemporalEase: temporalEase(),
});

const holdKeyframe = ({
	frame,
	value,
}: TimeDelayTrackSample): AeKeyframe<number> => ({
	time: frame,
	value,
	inInterpolationType: HOLD_INTERP,
	outInterpolationType: HOLD_INTERP,
	inTemporalEase: temporalEase(),
	outTemporalEase: temporalEase(),
});

const sampleValueAt = (
	samples: readonly TimeDelayTrackSample[],
	index: number,
): TimeDelayTrackSample | undefined => samples[index];

const isConstantSeries = (
	samples: readonly TimeDelayTrackSample[],
	tolerance: number,
): boolean => {
	const first = samples[0];
	return Boolean(
		first &&
			samples.every(
				(sample) => Math.abs(sample.value - first.value) <= tolerance,
			),
	);
};

const interpolateLinearSample = (
	from: TimeDelayTrackSample,
	to: TimeDelayTrackSample,
	frame: number,
): number => {
	const span = to.frame - from.frame;
	if (span === 0) return from.value;
	const progress = (frame - from.frame) / span;
	return from.value + (to.value - from.value) * progress;
};

const simplifyLinearRange = ({
	samples,
	startIndex,
	endIndex,
	tolerance,
	keep,
}: {
	readonly samples: readonly TimeDelayTrackSample[];
	readonly startIndex: number;
	readonly endIndex: number;
	readonly tolerance: number;
	readonly keep: Set<number>;
}): void => {
	if (endIndex - startIndex <= 1) return;
	const from = sampleValueAt(samples, startIndex);
	const to = sampleValueAt(samples, endIndex);
	if (!from || !to) return;
	let worstIndex = -1;
	let worstError = -1;
	for (let index = startIndex + 1; index < endIndex; index += 1) {
		const sample = samples[index];
		if (!sample) continue;
		const expected = interpolateLinearSample(from, to, sample.frame);
		const error = Math.abs(sample.value - expected);
		if (error > worstError) {
			worstError = error;
			worstIndex = index;
		}
	}
	if (worstIndex < 0 || worstError <= tolerance) return;
	keep.add(worstIndex);
	simplifyLinearRange({
		samples,
		startIndex,
		endIndex: worstIndex,
		tolerance,
		keep,
	});
	simplifyLinearRange({
		samples,
		startIndex: worstIndex,
		endIndex,
		tolerance,
		keep,
	});
};

const compactLinearKeyframes = ({
	samples,
	tolerance,
	protectedFrames = [],
}: {
	readonly samples: readonly TimeDelayTrackSample[];
	readonly tolerance: number;
	readonly protectedFrames?: readonly number[];
}): readonly AeKeyframe<number>[] => {
	if (samples.length === 0) return [];
	if (samples.length === 1 || isConstantSeries(samples, TRACK_VALUE_EPSILON)) {
		return [linearKeyframe(samples[0])];
	}
	const frameIndex = new Map(
		samples.map((sample, index) => [sample.frame, index] as const),
	);
	const keep = new Set<number>([0, samples.length - 1]);
	for (const frame of protectedFrames) {
		const index = frameIndex.get(frame);
		if (index !== undefined) keep.add(index);
	}
	const anchors = [...keep].sort((left, right) => left - right);
	for (let index = 0; index < anchors.length - 1; index += 1) {
		simplifyLinearRange({
			samples,
			startIndex: anchors[index],
			endIndex: anchors[index + 1],
			tolerance,
			keep,
		});
	}
	return [...keep]
		.sort((left, right) => left - right)
		.map((index) => linearKeyframe(samples[index]));
};

const holdKeyframesForSamples = (
	samples: readonly TimeDelayTrackSample[],
): readonly AeKeyframe<number>[] => {
	if (samples.length === 0) return [];
	const keep = new Map<number, TimeDelayTrackSample>();
	keep.set(samples[0].frame, samples[0]);
	for (let index = 1; index < samples.length; index += 1) {
		const previous = samples[index - 1];
		const current = samples[index];
		if (Math.abs(previous.value - current.value) <= TRACK_VALUE_EPSILON) {
			continue;
		}
		keep.set(previous.frame, previous);
		keep.set(current.frame, current);
	}
	const last = samples[samples.length - 1];
	keep.set(last.frame, last);
	return [...keep.values()]
		.sort((left, right) => left.frame - right.frame)
		.map(holdKeyframe);
};

const scalarTrack = ({
	nodeId,
	property,
	keyframes,
}: {
	readonly nodeId: string;
	readonly property: TimeDelayTrackProperty;
	readonly keyframes: readonly AeKeyframe<number>[];
}): KeyframeTrack<number> => ({
	id: createId("track"),
	target: { nodeId, property },
	keyframes,
});

const bodyTracks = ({
	node,
	layerIndex,
	origin,
}: {
	readonly node: VectorNode;
	readonly layerIndex: number;
	readonly origin: { readonly x: number; readonly y: number };
}): readonly KeyframeTrack<number>[] => [
	scalarTrack({
		nodeId: node.id,
		property: "x",
		keyframes: [
			linearKeyframe({
				frame: 0,
				value:
					origin.x +
					TIME_DELAY_PARAMS.dotCx0 +
					layerIndex * TIME_DELAY_PARAMS.dotSpacing,
			}),
		],
	}),
	scalarTrack({
		nodeId: node.id,
		property: "y",
		keyframes: compactLinearKeyframes({
			tolerance: TRACK_TOLERANCE.bodyY,
			samples: TRACKED_FRAMES.map((frame) => ({
				frame,
				value: origin.y + timeDelayDotState(frame, layerIndex).cy,
			})),
		}),
	}),
	scalarTrack({
		nodeId: node.id,
		property: "scaleY",
		keyframes: compactLinearKeyframes({
			tolerance: TRACK_TOLERANCE.bodyScaleY,
			samples: TRACKED_FRAMES.map((frame) => {
				const state = timeDelayDotState(frame, layerIndex);
				return {
					frame,
					value: state.height / state.width,
				};
			}),
		}),
	}),
];

const satelliteFrameState = ({
	frame,
	layerIndex,
	origin,
}: {
	readonly frame: number;
	readonly layerIndex: number;
	readonly origin: { readonly x: number; readonly y: number };
}): {
	readonly x: number;
	readonly y: number;
	readonly scale: number;
	readonly opacity: number;
} => {
	const body = timeDelayDotState(frame, layerIndex);
	const satellite = body.satellite;
	if (!satellite) {
		return {
			x: origin.x + body.cx,
			y: origin.y + body.cy,
			scale: 0.001,
			opacity: 0,
		};
	}
	return {
		x: origin.x + satellite.cx,
		y: origin.y + satellite.cy,
		scale: satellite.r / TIME_DELAY_PARAMS.satellite.rAnchor,
		opacity: 1,
	};
};

const satelliteTracks = ({
	node,
	layerIndex,
	origin,
}: {
	readonly node: VectorNode;
	readonly layerIndex: number;
	readonly origin: { readonly x: number; readonly y: number };
}): readonly KeyframeTrack<number>[] => {
	const states = TRACKED_FRAMES.map((frame) => ({
		frame,
		...satelliteFrameState({ frame, layerIndex, origin }),
	}));
	const opacitySamples = states.map((state) => ({
		frame: state.frame,
		value: state.opacity,
	}));
	const protectedFrames = new Set<number>([0, TIME_DELAY_PARAMS.periodFrames]);
	for (let index = 1; index < opacitySamples.length; index += 1) {
		const previous = opacitySamples[index - 1];
		const current = opacitySamples[index];
		if (Math.abs(previous.value - current.value) > TRACK_VALUE_EPSILON) {
			protectedFrames.add(previous.frame);
			protectedFrames.add(current.frame);
		}
	}
	return [
		scalarTrack({
			nodeId: node.id,
			property: "x",
			keyframes: compactLinearKeyframes({
				tolerance: TRACK_VALUE_EPSILON,
				protectedFrames: [...protectedFrames],
				samples: states.map((state) => ({
					frame: state.frame,
					value: state.x,
				})),
			}),
		}),
		scalarTrack({
			nodeId: node.id,
			property: "y",
			keyframes: compactLinearKeyframes({
				tolerance: TRACK_TOLERANCE.satelliteY,
				protectedFrames: [...protectedFrames],
				samples: states.map((state) => ({
					frame: state.frame,
					value: state.y,
				})),
			}),
		}),
		scalarTrack({
			nodeId: node.id,
			property: "scaleX",
			keyframes: compactLinearKeyframes({
				tolerance: TRACK_TOLERANCE.satelliteScale,
				protectedFrames: [...protectedFrames],
				samples: states.map((state) => ({
					frame: state.frame,
					value: state.scale,
				})),
			}),
		}),
		scalarTrack({
			nodeId: node.id,
			property: "scaleY",
			keyframes: compactLinearKeyframes({
				tolerance: TRACK_TOLERANCE.satelliteScale,
				protectedFrames: [...protectedFrames],
				samples: states.map((state) => ({
					frame: state.frame,
					value: state.scale,
				})),
			}),
		}),
		scalarTrack({
			nodeId: node.id,
			property: "opacity",
			keyframes: holdKeyframesForSamples(opacitySamples),
		}),
	];
};

/**
 * Produces ordinary scalar tracks for explicit bake/export/debug workflows.
 * Normal Time Delay creation keeps these tracks out of the MotionDocument and
 * relies on the typed profile evaluator instead.
 */
export function createGlammerTimeDelayBakeTracksForNodes({
	bodies,
	satellites,
	origin,
}: {
	readonly bodies: readonly VectorNode[];
	readonly satellites: readonly VectorNode[];
	readonly origin: { readonly x: number; readonly y: number };
}): readonly KeyframeTrack<number>[] {
	return bodies.flatMap((body, index) => [
		...bodyTracks({ node: body, layerIndex: index, origin }),
		...(satellites[index]
			? satelliteTracks({ node: satellites[index], layerIndex: index, origin })
			: []),
	]);
}

const cloneKeyframe = (keyframe: AeKeyframe<number>): AeKeyframe<number> => ({
	...keyframe,
	...(keyframe.inTemporalEase
		? {
				inTemporalEase: keyframe.inTemporalEase.map((ease) => ({
					...ease,
				})),
			}
		: {}),
	...(keyframe.outTemporalEase
		? {
				outTemporalEase: keyframe.outTemporalEase.map((ease) => ({
					...ease,
				})),
			}
		: {}),
});

const cloneTrack = (track: KeyframeTrack<number>): KeyframeTrack<number> => ({
	id: track.id,
	target: { ...track.target },
	keyframes: track.keyframes.map(cloneKeyframe),
});

const cloneClipProvenance = (
	provenance: AnimationClipProvenance,
): AnimationClipProvenance => ({
	...provenance,
	targetIds: [...provenance.targetIds],
	generatedNodeIds: [...provenance.generatedNodeIds],
	...(provenance.editableArtifacts
		? {
				editableArtifacts: provenance.editableArtifacts.map((artifact) => ({
					...artifact,
					targetIds: [...artifact.targetIds],
					channels: [...artifact.channels],
				})),
			}
		: {}),
});

const cloneClip = (clip: AnimationClip): AnimationClip => ({
	...clip,
	trackIds: [...clip.trackIds],
	...(clip.provenance
		? { provenance: cloneClipProvenance(clip.provenance) }
		: {}),
});

/**
 * Plans a Glammer-style Time Delay system as editable Vecmo scene and motion
 * data. The five body dots remain ordered grammar targets so imported objects can
 * replace any body role; satellites are ordinary companion nodes with authored
 * tracks so the expression exists directly in the workspace.
 */
export function createTimeDelayMaterializationPlan({
	scene,
	selectedNodeIds,
	bindingId = createId("motion-binding"),
}: {
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly bindingId?: string;
}): TimeDelayMaterializationPlan {
	if (scene.layers.length === 0) {
		return {
			status: "blocked",
			reason: "Scene has no editable layer for the Time Delay system.",
		};
	}
	const selectedSourceNodeIds = existingSelection(scene, selectedNodeIds);
	const layer = editableLayer(scene, selectedSourceNodeIds);
	if (!layer) {
		return {
			status: "blocked",
			reason: "No visible unlocked layer can receive the Time Delay system.",
		};
	}
	const artboard = currentArtboard(scene);
	const origin = artboardOriginForReferenceComp(artboard);
	const nodeSets = Array.from(
		{ length: TIME_DELAY_PARAMS.dotCount },
		(_, index) =>
			materializedNodeSet({
				artboard,
				bindingId,
				layerIndex: index,
				origin,
			}),
	);
	const generatedNodes = nodeSets.flatMap(
		(set, index): readonly MotionGrammarWorkspaceInstanceNode[] => [
			{
				node: set.body,
				role: set.bodyRole,
				roleLabel: `dot ${index + 1} body`,
			},
			{
				node: set.satellite,
				role: set.satelliteRole,
				roleLabel: `dot ${index + 1} satellite`,
			},
		],
	);
	const bodyNodeIds = nodeSets.map((set) => set.body.id);
	const roleMap: Record<string, string> = {};
	for (const set of nodeSets) {
		roleMap[set.body.id] = set.bodyRole;
		roleMap[set.satellite.id] = set.satelliteRole;
	}
	const binding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId: "time-delay",
		targetIds: bodyNodeIds,
		roleMap,
		parameters: {
			profileVersion: GLAMMER_TIME_DELAY_PROFILE_VERSION,
			...GLAMMER_TIME_DELAY_MASTER_INSTANCE_PARAMETER_DEFAULTS,
			...GLAMMER_TIME_DELAY_INSTANCE_PARAMETER_DEFAULTS,
			...GLAMMER_TIME_DELAY_LOOK_PARAMETER_DEFAULTS,
			staggerFrames: TIME_DELAY_PARAMS.staggerFrames,
			periodFrames: TIME_DELAY_PARAMS.periodFrames,
			referenceOriginX: origin.x,
			referenceOriginY: origin.y,
		},
		effectBinding: { kind: "none" },
	};
	const tracks: readonly KeyframeTrack<number>[] = [];
	const clip: AnimationClip = {
		id: createId("clip"),
		name: "Time Delay expansion",
		startFrame: 0,
		durationFrames: TIME_DELAY_PARAMS.periodFrames,
		trackIds: tracks.map((track) => track.id),
		provenance: {
			source: "motion-grammar",
			label: "Glammer Time Delay authoring preset",
			bindingId,
			techniqueId: "time-delay",
			techniqueLabel: "Time Delay",
			targetIds: bodyNodeIds,
			generatedNodeIds: nodeSets.flatMap((set) => [
				set.body.id,
				set.satellite.id,
			]),
			editableArtifacts: [
				{
					id: `${bindingId}:satellites`,
					kind: "time-delay-satellites",
					targetIds: nodeSets.map((set) => set.satellite.id),
					channels: ["expression:glammer-time-delay-v1"],
					description:
						"Satellite dots evaluated by the Glammer Time Delay typed profile.",
				},
			],
		},
	};
	return {
		status: "ready",
		techniqueId: "time-delay",
		binding,
		layerId: layer.id,
		artboardId: artboard.id,
		stageBackground: GLAMMER_TIME_DELAY_STAGE_BACKGROUND,
		generatedNodes,
		roleMap,
		selectedSourceNodeIds,
		nextSelectionNodeIds: bodyNodeIds,
		tracks,
		clip,
	};
}

/**
 * Replaces the current Time Delay artboard contents with the generated authoring
 * rig. This intentionally differs from the generic grammar materializer: Time
 * Delay is being tuned against a Glammer reference, so the verification surface
 * must contain only the five editable capsules on a neutral film-like stage.
 */
export function createApplyTimeDelayMaterializationSceneCommand(
	plan: ReadyTimeDelayMaterializationPlan,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	const generatedNodes = plan.generatedNodes.map(({ node }) =>
		cloneSceneDocument(node),
	);
	return {
		type: "motion-grammar/apply-time-delay-scene-materialization",
		label: options.label ?? "Create Time Delay scene",
		coalesceKey:
			options.coalesceKey ??
			`motion-grammar:time-delay-scene-materialization:${plan.binding.id}`,
		run: (draft) => {
			const targetLayer =
				(plan.layerId
					? draft.layers.find((layer) => layer.id === plan.layerId)
					: undefined) ??
				[...draft.layers]
					.reverse()
					.find((layer) => layer.visible && !layer.locked) ??
				draft.layers[draft.layers.length - 1];
			if (!targetLayer) return;

			applyTimeDelayStageArtboard(draft, plan.artboardId);
			for (const layer of draft.layers) {
				layer.nodes = castDraft(
					layer.nodes.filter(
						(node) =>
							!nodeOwnedByArtboard(node, plan.artboardId, plan.artboardId),
					),
				);
			}
			const existingIds = new Set(
				draft.layers.flatMap((layer) => layer.nodes.map((node) => node.id)),
			);
			for (const node of generatedNodes) {
				if (existingIds.has(node.id)) continue;
				targetLayer.nodes.push(castDraft(cloneSceneDocument(node)));
				existingIds.add(node.id);
			}
		},
	};
}

/** Writes the Time Delay authoring preset tracks and clip into the motion side-car. */
export function createApplyTimeDelayMaterializationMotionCommand(
	plan: ReadyTimeDelayMaterializationPlan,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): MotionCommand {
	const tracks = plan.tracks.map(cloneTrack);
	const clip = cloneClip(plan.clip);
	return {
		type: "motion-grammar/apply-time-delay-materialization",
		label: options.label ?? "Create Time Delay motion",
		coalesceKey:
			options.coalesceKey ??
			`motion-grammar:time-delay-materialization:${plan.binding.id}`,
		run: (draft) => {
			for (const track of tracks) {
				const existingIndex = draft.tracks.findIndex(
					(candidate) =>
						candidate.id === track.id ||
						(candidate.target.nodeId === track.target.nodeId &&
							candidate.target.property === track.target.property),
				);
				if (existingIndex >= 0) {
					draft.tracks[existingIndex] = castDraft(cloneTrack(track));
					continue;
				}
				draft.tracks.push(castDraft(cloneTrack(track)));
			}
			const existingClipIndex = draft.clips.findIndex(
				(candidate) => candidate.id === clip.id,
			);
			if (existingClipIndex >= 0) {
				draft.clips[existingClipIndex] = castDraft(cloneClip(clip));
				return;
			}
			draft.clips.push(castDraft(cloneClip(clip)));
		},
	};
}
