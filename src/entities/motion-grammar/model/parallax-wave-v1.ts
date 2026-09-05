/**
 * Parallax v1: one shared screen-space wave is multiplied by authored depth
 * role amplitudes. It is a perceptual amplitude profile, not a camera or 3D
 * depth claim.
 */

import {
	PARALLAX_AXIS_DEGREES_DEFAULT,
	PARALLAX_DESCENT_FRACTION_DEFAULT,
	PARALLAX_FAR_AMPLITUDE_DEFAULT,
	PARALLAX_MID_AMPLITUDE_DEFAULT,
	PARALLAX_NEAR_AMPLITUDE_DEFAULT,
	PARALLAX_PERIOD_DEFAULT,
	PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const PARALLAX_NEAR_ROLE = "near";
export const PARALLAX_MID_ROLE = "mid";
export const PARALLAX_FAR_ROLE = "far";
const PARALLAX_NEAR_ROLE_ALIASES = [
	"size-speed-parallax:near",
	"size-speed-parallax:parallax-layer",
] as const;
const PARALLAX_MID_ROLE_ALIASES = ["size-speed-parallax:mid"] as const;
const PARALLAX_FAR_ROLE_ALIASES = ["size-speed-parallax:far"] as const;

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;
const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const wrap = (value: number, period: number): number =>
	period > 0 ? ((value % period) + period) % period : 0;
const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const sharedWaveAt = (
	frame: number,
	period: number,
	descentFraction: number,
): number => {
	const phase = wrap(frame, period) / period;
	const descent = clamp(descentFraction, 0.1, 0.9);
	return phase < descent
		? smoothstep(phase / descent)
		: smoothstep(1 - (phase - descent) / (1 - descent));
};

const roleIds = (env: ExpressionSampleEnv, roleId: string): readonly string[] =>
	env.resolvedRoleNodeIds.get(roleId) ?? [];

const emitRole = (
	nodeIds: readonly string[],
	amplitude: number,
	wave: number,
	axis: { readonly x: number; readonly y: number },
): readonly ExpressionChannelEmit[] =>
	nodeIds.map((nodeId) => ({
		kind: "translate" as const,
		nodeId,
		value: {
			x: axis.x * amplitude * wave,
			y: axis.y * amplitude * wave,
		},
	}));

const sampleParallax = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const period = Math.max(
		1,
		finiteOr(env.parameters.periodFrames, PARALLAX_PERIOD_DEFAULT),
	);
	const descentFraction = finiteOr(
		env.parameters.descentFraction,
		PARALLAX_DESCENT_FRACTION_DEFAULT,
	);
	const axisDegrees = finiteOr(
		env.parameters.axisDegrees,
		PARALLAX_AXIS_DEGREES_DEFAULT,
	);
	const radians = (axisDegrees * Math.PI) / 180;
	const axis = { x: Math.cos(radians), y: Math.sin(radians) };
	const phaseOffset = finiteOr(
		env.parameters.phaseOffsetFrames,
		PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT,
	);
	const wave = sharedWaveAt(env.frame + phaseOffset, period, descentFraction);
	return [
		...emitRole(
			roleIds(env, PARALLAX_NEAR_ROLE),
			finiteOr(env.parameters.nearAmplitude, PARALLAX_NEAR_AMPLITUDE_DEFAULT),
			wave,
			axis,
		),
		...emitRole(
			roleIds(env, PARALLAX_MID_ROLE),
			finiteOr(env.parameters.midAmplitude, PARALLAX_MID_AMPLITUDE_DEFAULT),
			wave,
			axis,
		),
		...emitRole(
			roleIds(env, PARALLAX_FAR_ROLE),
			finiteOr(env.parameters.farAmplitude, PARALLAX_FAR_AMPLITUDE_DEFAULT),
			wave,
			axis,
		),
	];
};

/** Registered screen-space shared-wave Parallax expression. */
export const PARALLAX_WAVE_V1: MotionExpressionDefinition = {
	expressionId: "size-speed-parallax",
	version: 1,
	source: { origin: "vecmo", reference: "shared-wave-depth-amplitudes-v1" },
	label: "Parallax",
	summary:
		"One shared screen-space wave displaces near, mid, and far roles by editable amplitudes.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Parallax wave",
		actionLabel: "Create Parallax",
		previewLabel: "Preview parallax wave",
		description:
			"Keeps every role phase-locked while authored amplitudes create the depth reading.",
		outputSummary: "Shared-wave translate channels for near/mid/far roles.",
	},
	roles: [
		{
			roleId: PARALLAX_NEAR_ROLE,
			aliases: PARALLAX_NEAR_ROLE_ALIASES,
			label: "Near",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: PARALLAX_MID_ROLE,
			aliases: PARALLAX_MID_ROLE_ALIASES,
			label: "Mid",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: PARALLAX_FAR_ROLE,
			aliases: PARALLAX_FAR_ROLE_ALIASES,
			label: "Far",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		[
			"periodFrames",
			"Period",
			PARALLAX_PERIOD_DEFAULT,
			1,
			600,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"descentFraction",
			"Descent",
			PARALLAX_DESCENT_FRACTION_DEFAULT,
			0.1,
			0.9,
			0.01,
			"timing",
			"timing",
			"Timing",
		],
		[
			"axisDegrees",
			"Axis",
			PARALLAX_AXIS_DEGREES_DEFAULT,
			-360,
			360,
			1,
			"layout",
			"layout",
			"Layout",
		],
		[
			"phaseOffsetFrames",
			"Phase",
			PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT,
			-600,
			600,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"nearAmplitude",
			"Near",
			PARALLAX_NEAR_AMPLITUDE_DEFAULT,
			-512,
			512,
			1,
			"motion",
			"amplitudes",
			"Amplitudes",
		],
		[
			"midAmplitude",
			"Mid",
			PARALLAX_MID_AMPLITUDE_DEFAULT,
			-512,
			512,
			1,
			"motion",
			"amplitudes",
			"Amplitudes",
		],
		[
			"farAmplitude",
			"Far",
			PARALLAX_FAR_AMPLITUDE_DEFAULT,
			-512,
			512,
			1,
			"motion",
			"amplitudes",
			"Amplitudes",
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
	outputs: ["translate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Parallax",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: PARALLAX_NEAR_ROLE },
	recipeRoles: [PARALLAX_NEAR_ROLE, PARALLAX_MID_ROLE, PARALLAX_FAR_ROLE],
	sample: sampleParallax,
};
