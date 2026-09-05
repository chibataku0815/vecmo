/**
 * Symmetry v1: one shared pulse drives mirrored role coefficients. The
 * expression owns the timing law and emits only ordinary transform channels;
 * scene nodes remain the durable source of geometry and role identity.
 */

import {
	SYMMETRY_CENTER_ROTATION_DEFAULT,
	SYMMETRY_CENTER_SCALE_DEFAULT,
	SYMMETRY_INNER_SCALE_DEFAULT,
	SYMMETRY_INNER_TRANSLATION_DEFAULT,
	SYMMETRY_OUTER_SCALE_DEFAULT,
	SYMMETRY_OUTER_TRANSLATION_DEFAULT,
	SYMMETRY_PULSE_HOLD_FRAMES_DEFAULT,
	SYMMETRY_PULSE_PERIOD_DEFAULT,
	SYMMETRY_PULSE_RISE_FRAMES_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const SYMMETRY_OUTER_LEFT_ROLE = "outer-left";
export const SYMMETRY_OUTER_RIGHT_ROLE = "outer-right";
export const SYMMETRY_INNER_LEFT_ROLE = "inner-left";
export const SYMMETRY_INNER_RIGHT_ROLE = "inner-right";
export const SYMMETRY_CENTER_ROLE = "center";

const roleIds = (env: ExpressionSampleEnv, roleId: string): readonly string[] =>
	env.resolvedRoleNodeIds.get(roleId) ?? [];

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const pulseAt = (
	frame: number,
	periodFrames: number,
	riseFrames: number,
	holdFrames: number,
): number => {
	const period = Math.max(1, periodFrames);
	const local = ((frame % period) + period) % period;
	const rise = Math.min(Math.max(1, riseFrames), period);
	const hold = Math.min(Math.max(0, holdFrames), Math.max(0, period - rise));
	const fall = Math.max(1, period - rise - hold);
	if (local < rise) return smoothstep(local / rise);
	if (local < rise + hold) return 1;
	return smoothstep(1 - (local - rise - hold) / fall);
};

const emitScale = (
	nodeIds: readonly string[],
	coefficient: number,
	pulse: number,
): readonly ExpressionChannelEmit[] =>
	nodeIds.map((nodeId) => ({
		kind: "scaleFactor" as const,
		nodeId,
		value: {
			x: 1 + coefficient * pulse,
			y: 1 + coefficient * pulse,
		},
	}));

const emitTranslate = (
	nodeIds: readonly string[],
	distance: number,
	pulse: number,
): readonly ExpressionChannelEmit[] =>
	nodeIds.map((nodeId) => ({
		kind: "translate" as const,
		nodeId,
		value: { x: distance * pulse, y: 0 },
	}));

const sampleSymmetryPulse = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const pulse = pulseAt(
		env.frame,
		finiteOr(env.parameters.periodFrames, SYMMETRY_PULSE_PERIOD_DEFAULT),
		finiteOr(env.parameters.riseFrames, SYMMETRY_PULSE_RISE_FRAMES_DEFAULT),
		finiteOr(env.parameters.holdFrames, SYMMETRY_PULSE_HOLD_FRAMES_DEFAULT),
	);
	const outerTranslation = finiteOr(
		env.parameters.outerTranslation,
		SYMMETRY_OUTER_TRANSLATION_DEFAULT,
	);
	const innerTranslation = finiteOr(
		env.parameters.innerTranslation,
		SYMMETRY_INNER_TRANSLATION_DEFAULT,
	);
	const outerScale = finiteOr(
		env.parameters.outerScale,
		SYMMETRY_OUTER_SCALE_DEFAULT,
	);
	const innerScale = finiteOr(
		env.parameters.innerScale,
		SYMMETRY_INNER_SCALE_DEFAULT,
	);
	const centerScale = finiteOr(
		env.parameters.centerScale,
		SYMMETRY_CENTER_SCALE_DEFAULT,
	);
	const centerRotation = finiteOr(
		env.parameters.centerRotationDegrees,
		SYMMETRY_CENTER_ROTATION_DEFAULT,
	);
	return [
		...emitTranslate(
			roleIds(env, SYMMETRY_OUTER_LEFT_ROLE),
			-outerTranslation,
			pulse,
		),
		...emitTranslate(
			roleIds(env, SYMMETRY_OUTER_RIGHT_ROLE),
			outerTranslation,
			pulse,
		),
		...emitTranslate(
			roleIds(env, SYMMETRY_INNER_LEFT_ROLE),
			-innerTranslation,
			pulse,
		),
		...emitTranslate(
			roleIds(env, SYMMETRY_INNER_RIGHT_ROLE),
			innerTranslation,
			pulse,
		),
		...emitScale(roleIds(env, SYMMETRY_OUTER_LEFT_ROLE), outerScale, pulse),
		...emitScale(roleIds(env, SYMMETRY_OUTER_RIGHT_ROLE), outerScale, pulse),
		...emitScale(roleIds(env, SYMMETRY_INNER_LEFT_ROLE), innerScale, pulse),
		...emitScale(roleIds(env, SYMMETRY_INNER_RIGHT_ROLE), innerScale, pulse),
		...emitScale(roleIds(env, SYMMETRY_CENTER_ROLE), centerScale, pulse),
		...roleIds(env, SYMMETRY_CENTER_ROLE).map((nodeId) => ({
			kind: "rotate" as const,
			nodeId,
			value: centerRotation * pulse,
		})),
	];
};

/** Registered, trackless shared-pulse relation definition for Symmetry. */
export const SYMMETRY_PULSE_V1: MotionExpressionDefinition = {
	expressionId: "mirror-symmetric-scale",
	version: 1,
	source: { origin: "vecmo", reference: "symmetry-shared-hold-pulse-v1" },
	label: "Symmetry",
	summary:
		"One held pulse drives signed outer/inner role coefficients and a bounded center response.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Symmetry pulse",
		actionLabel: "Create Symmetry",
		previewLabel: "Preview symmetry pulse",
		description:
			"Keeps scene roles editable while one shared pulse owns mirrored translation, scale, and center turn.",
		outputSummary: "Mirrored translate/scale channels plus center rotation.",
	},
	roles: [
		...[
			[SYMMETRY_OUTER_LEFT_ROLE, "Outer left"],
			[SYMMETRY_OUTER_RIGHT_ROLE, "Outer right"],
			[SYMMETRY_INNER_LEFT_ROLE, "Inner left"],
			[SYMMETRY_INNER_RIGHT_ROLE, "Inner right"],
			[SYMMETRY_CENTER_ROLE, "Center"],
		].map(([roleId, label]) => ({
			roleId,
			aliases: [`mirror-symmetric-scale:${roleId}`],
			label,
			kind: "scene-node" as const,
			editable: true,
			replaceable: true,
		})),
	],
	params: [
		[
			"periodFrames",
			"Period",
			SYMMETRY_PULSE_PERIOD_DEFAULT,
			1,
			600,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"riseFrames",
			"Rise",
			SYMMETRY_PULSE_RISE_FRAMES_DEFAULT,
			1,
			300,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"holdFrames",
			"Hold",
			SYMMETRY_PULSE_HOLD_FRAMES_DEFAULT,
			0,
			300,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"outerTranslation",
			"Outer Spread",
			SYMMETRY_OUTER_TRANSLATION_DEFAULT,
			-512,
			512,
			1,
			"layout",
			"coefficients",
			"Coefficients",
		],
		[
			"innerTranslation",
			"Inner Spread",
			SYMMETRY_INNER_TRANSLATION_DEFAULT,
			-512,
			512,
			1,
			"layout",
			"coefficients",
			"Coefficients",
		],
		[
			"outerScale",
			"Outer Scale",
			SYMMETRY_OUTER_SCALE_DEFAULT,
			-1,
			2,
			0.01,
			"motion",
			"coefficients",
			"Coefficients",
		],
		[
			"innerScale",
			"Inner Scale",
			SYMMETRY_INNER_SCALE_DEFAULT,
			-1,
			2,
			0.01,
			"motion",
			"coefficients",
			"Coefficients",
		],
		[
			"centerScale",
			"Center Scale",
			SYMMETRY_CENTER_SCALE_DEFAULT,
			-1,
			2,
			0.01,
			"motion",
			"center",
			"Center",
		],
		[
			"centerRotationDegrees",
			"Center Turn",
			SYMMETRY_CENTER_ROTATION_DEFAULT,
			-360,
			360,
			1,
			"motion",
			"center",
			"Center",
		],
	].map(
		([
			key,
			label,
			defaultValue,
			min,
			max,
			step,
			role,
			groupId,
			groupLabel,
		]) => ({
			key: key as string,
			label: label as string,
			default: defaultValue as number,
			min: min as number,
			max: max as number,
			step: step as number,
			role: role as "timing" | "layout" | "motion",
			groupId: groupId as string,
			groupLabel: groupLabel as string,
		}),
	),
	outputs: ["translate", "scaleFactor", "rotate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Symmetry",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: SYMMETRY_OUTER_LEFT_ROLE },
	recipeRoles: [
		SYMMETRY_OUTER_LEFT_ROLE,
		SYMMETRY_OUTER_RIGHT_ROLE,
		SYMMETRY_INNER_LEFT_ROLE,
		SYMMETRY_INNER_RIGHT_ROLE,
		SYMMETRY_CENTER_ROLE,
	],
	sample: sampleSymmetryPulse,
};
