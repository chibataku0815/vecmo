/**
 * Merge / Split v1: ordered members replay one delayed gather/hold/return clip
 * while their seats turn around a declared core. The core scale is derived from
 * the same absorb state; no member or core keyframes are written.
 */

import {
	MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT,
	MERGE_SPLIT_GATHER_FRACTION_DEFAULT,
	MERGE_SPLIT_HOLD_FRACTION_DEFAULT,
	MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
	MERGE_SPLIT_PERIOD_DEFAULT,
	MERGE_SPLIT_RETURN_FRACTION_DEFAULT,
	MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT,
	MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT,
	MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
	MERGE_SPLIT_STAGGER_FRAMES_DEFAULT,
	MERGE_SPLIT_STRENGTH_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const MERGE_SPLIT_MEMBER_ROLE = "member";
export const MERGE_SPLIT_CORE_ROLE = "core";

const MERGE_SPLIT_MEMBER_ROLE_ALIASES = [
	"merge-split-cycle:member",
	"merge-split-cycle:member-a",
	"merge-split-cycle:member-b",
] as const;
const MERGE_SPLIT_CORE_ROLE_ALIASES = ["merge-split-cycle:core"] as const;

type Point = { readonly x: number; readonly y: number };

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const wrapFrame = (value: number, period: number): number =>
	period > 0 ? ((value % period) + period) % period : 0;

const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const rotate = (point: Point, degrees: number): Point => {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return {
		x: point.x * cosine - point.y * sine,
		y: point.x * sine + point.y * cosine,
	};
};

const pointAdd = (left: Point, right: Point): Point => ({
	x: left.x + right.x,
	y: left.y + right.y,
});

const pointScale = (point: Point, amount: number): Point => ({
	x: point.x * amount,
	y: point.y * amount,
});

const pointSub = (left: Point, right: Point): Point => ({
	x: left.x - right.x,
	y: left.y - right.y,
});

const roleIds = (env: ExpressionSampleEnv, roleId: string): readonly string[] =>
	env.resolvedRoleNodeIds.get(roleId) ?? [];

type ClipState = {
	readonly distanceFactor: number;
	readonly absorb: number;
};

const clipStateAt = ({
	phase,
	gatherFraction,
	holdFraction,
	returnFraction,
	strength,
	returnOvershoot,
}: {
	readonly phase: number;
	readonly gatherFraction: number;
	readonly holdFraction: number;
	readonly returnFraction: number;
	readonly strength: number;
	readonly returnOvershoot: number;
}): ClipState => {
	const gather = Math.max(0.05, gatherFraction);
	const hold = Math.max(0, holdFraction);
	const release = Math.max(0.05, returnFraction);
	const settle = Math.max(0, 1 - gather - hold - release);
	const duration = gather + hold + release + settle;
	const gatherEnd = gather / duration;
	const holdEnd = (gather + hold) / duration;
	const releaseEnd = (gather + hold + release) / duration;
	if (phase < gatherEnd) {
		const progress = smoothstep(phase / gatherEnd);
		return {
			distanceFactor: 1 - clamp(strength, 0, 1.5) * progress,
			absorb: progress,
		};
	}
	if (phase < holdEnd) {
		return {
			distanceFactor: 1 - clamp(strength, 0, 1.5),
			absorb: 1,
		};
	}
	if (phase < releaseEnd) {
		const progress = smoothstep(
			(phase - holdEnd) / Math.max(1e-6, releaseEnd - holdEnd),
		);
		const overshoot = progress + returnOvershoot * Math.sin(progress * Math.PI);
		return {
			distanceFactor:
				1 - clamp(strength, 0, 1.5) + clamp(strength, 0, 1.5) * overshoot,
			absorb: 1 - progress,
		};
	}
	return { distanceFactor: 1, absorb: 0 };
};

const sampleMergeSplit = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const memberIds = roleIds(env, MERGE_SPLIT_MEMBER_ROLE);
	if (memberIds.length === 0) return [];
	const coreIds = roleIds(env, MERGE_SPLIT_CORE_ROLE);
	const coreId = coreIds[0];
	const memberRest = memberIds.map((nodeId) => env.restPositionOf(nodeId));
	const center = coreId
		? env.restPositionOf(coreId)
		: memberRest.reduce(
				(sum, point) => pointAdd(sum, pointScale(point, 1 / memberRest.length)),
				{ x: 0, y: 0 },
			);
	const period = Math.max(
		1,
		finiteOr(env.parameters.periodFrames, MERGE_SPLIT_PERIOD_DEFAULT),
	);
	const strength = finiteOr(
		env.parameters.strength,
		MERGE_SPLIT_STRENGTH_DEFAULT,
	);
	const scaleFloor = clamp(
		finiteOr(env.parameters.scaleFloor, MERGE_SPLIT_SCALE_FLOOR_DEFAULT),
		0.05,
		1,
	);
	const opacityFloor = clamp(
		finiteOr(env.parameters.opacityFloor, MERGE_SPLIT_OPACITY_FLOOR_DEFAULT),
		0,
		1,
	);
	const gatherFraction = finiteOr(
		env.parameters.gatherFraction,
		MERGE_SPLIT_GATHER_FRACTION_DEFAULT,
	);
	const holdFraction = finiteOr(
		env.parameters.holdFraction,
		MERGE_SPLIT_HOLD_FRACTION_DEFAULT,
	);
	const returnFraction = finiteOr(
		env.parameters.returnFraction,
		MERGE_SPLIT_RETURN_FRACTION_DEFAULT,
	);
	const staggerFrames = Math.max(
		0,
		finiteOr(env.parameters.staggerFrames, MERGE_SPLIT_STAGGER_FRAMES_DEFAULT),
	);
	const ringTurnDegrees = finiteOr(
		env.parameters.ringTurnDegrees,
		MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT,
	);
	const returnOvershoot = Math.max(
		0,
		finiteOr(
			env.parameters.returnOvershoot,
			MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT,
		),
	);
	const coreScaleGain = Math.max(
		0,
		finiteOr(env.parameters.coreScaleGain, MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT),
	);
	const masterPhase = wrapFrame(env.frame, period) / period;
	const emits: ExpressionChannelEmit[] = [];
	let absorbSum = 0;
	for (const [index, rest] of memberRest.entries()) {
		const nodeId = memberIds[index];
		if (!nodeId) continue;
		const delta = pointSub(rest, center);
		const length = Math.hypot(delta.x, delta.y);
		const radial =
			length > 1e-6
				? delta
				: {
						x: Math.cos((index / memberIds.length) * Math.PI * 2) * 48,
						y: Math.sin((index / memberIds.length) * Math.PI * 2) * 48,
					};
		const seat = rotate(radial, ringTurnDegrees * masterPhase);
		const localPhase =
			wrapFrame(env.frame - index * staggerFrames, period) / period;
		const state = clipStateAt({
			phase: localPhase,
			gatherFraction,
			holdFraction,
			returnFraction,
			strength,
			returnOvershoot,
		});
		absorbSum += state.absorb;
		const position = pointAdd(center, pointScale(seat, state.distanceFactor));
		emits.push({
			kind: "translate",
			nodeId,
			value: pointSub(position, rest),
		});
		const scale = 1 - (1 - scaleFloor) * state.absorb;
		emits.push({
			kind: "scaleFactor",
			nodeId,
			value: { x: scale, y: scale },
		});
		emits.push({
			kind: "opacityFactor",
			nodeId,
			value: 1 - (1 - opacityFloor) * state.absorb,
		});
	}
	if (coreIds.length > 0) {
		const averageAbsorb = absorbSum / memberIds.length;
		const coreScale = 1 + coreScaleGain * Math.sqrt(clamp(averageAbsorb, 0, 1));
		for (const nodeId of coreIds) {
			emits.push({
				kind: "scaleFactor",
				nodeId,
				value: { x: coreScale, y: coreScale },
			});
		}
	}
	return emits;
};

/** Registered delayed gather/absorb/return expression for Merge / Split. */
export const MERGE_SPLIT_V1: MotionExpressionDefinition = {
	expressionId: "merge-split-cycle",
	version: 1,
	source: { origin: "vecmo", reference: "delayed-gather-absorb-return-v1" },
	label: "Merge / Split",
	summary:
		"Delayed members gather into a derived core, hold, and return to turning seats.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Merge / Split field",
		actionLabel: "Create Merge / Split",
		previewLabel: "Preview merge / split",
		description:
			"One delayed clip owns gather, core area, and reseating; scene members remain editable.",
		outputSummary: "Member translation/scale/opacity plus derived core scale.",
	},
	roles: [
		{
			roleId: MERGE_SPLIT_MEMBER_ROLE,
			aliases: MERGE_SPLIT_MEMBER_ROLE_ALIASES,
			label: "Members",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: MERGE_SPLIT_CORE_ROLE,
			aliases: MERGE_SPLIT_CORE_ROLE_ALIASES,
			label: "Core",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		[
			"periodFrames",
			"Period",
			MERGE_SPLIT_PERIOD_DEFAULT,
			1,
			600,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"strength",
			"Strength",
			MERGE_SPLIT_STRENGTH_DEFAULT,
			0,
			1.5,
			0.05,
			"motion",
			"gather",
			"Gather",
		],
		[
			"scaleFloor",
			"Member Size",
			MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
			0.05,
			1,
			0.05,
			"motion",
			"gather",
			"Gather",
		],
		[
			"opacityFloor",
			"Member Floor",
			MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
			0,
			1,
			0.05,
			"motion",
			"gather",
			"Gather",
		],
		[
			"gatherFraction",
			"Gather",
			MERGE_SPLIT_GATHER_FRACTION_DEFAULT,
			0.05,
			0.7,
			0.01,
			"timing",
			"timing",
			"Timing",
		],
		[
			"holdFraction",
			"Hold",
			MERGE_SPLIT_HOLD_FRACTION_DEFAULT,
			0,
			0.7,
			0.01,
			"timing",
			"timing",
			"Timing",
		],
		[
			"returnFraction",
			"Return",
			MERGE_SPLIT_RETURN_FRACTION_DEFAULT,
			0.05,
			0.9,
			0.01,
			"timing",
			"timing",
			"Timing",
		],
		[
			"staggerFrames",
			"Stagger",
			MERGE_SPLIT_STAGGER_FRAMES_DEFAULT,
			0,
			120,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"ringTurnDegrees",
			"Ring Turn",
			MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT,
			-720,
			720,
			1,
			"layout",
			"layout",
			"Layout",
		],
		[
			"returnOvershoot",
			"Overshoot",
			MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT,
			0,
			0.5,
			0.01,
			"motion",
			"return",
			"Return",
		],
		[
			"coreScaleGain",
			"Core Gain",
			MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT,
			0,
			3,
			0.05,
			"motion",
			"core",
			"Core",
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
	outputs: ["translate", "scaleFactor", "opacityFactor"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Merge / Split",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: MERGE_SPLIT_MEMBER_ROLE },
	recipeRoles: [MERGE_SPLIT_CORE_ROLE, MERGE_SPLIT_MEMBER_ROLE],
	sample: sampleMergeSplit,
};
