/**
 * Follow-through v1: followers read a delayed lead delta plus a bounded
 * residual derived from the lead's finite-difference velocity. The expression
 * never stores an independent bounce amplitude.
 */

import {
	FOLLOW_THROUGH_DECAY_DEFAULT,
	FOLLOW_THROUGH_DELAY_DEFAULT,
	FOLLOW_THROUGH_PERIOD_DEFAULT,
	FOLLOW_THROUGH_RESPONSE_DEFAULT,
	FOLLOW_THROUGH_ROTATION_RESPONSE_DEFAULT,
	FOLLOW_THROUGH_SETTLE_FRAMES_DEFAULT,
	FOLLOW_THROUGH_VELOCITY_LOOKBACK_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const FOLLOW_THROUGH_LEADER_ROLE = "leader";
export const FOLLOW_THROUGH_FOLLOWER_ROLE = "follower";

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const wrap = (value: number, period: number): number =>
	period > 0 ? ((value % period) + period) % period : value;

const responseAt = ({
	env,
	frame,
	index,
}: {
	readonly env: ExpressionSampleEnv;
	readonly frame: number;
	readonly index: number;
}): {
	readonly x: number;
	readonly y: number;
	readonly rotation: number;
} | null => {
	const samplePositionAt = env.samplePositionAt;
	const leaderId = env.resolvedRoleNodeIds.get(FOLLOW_THROUGH_LEADER_ROLE)?.[0];
	if (!samplePositionAt || !leaderId) return null;
	const period = Math.max(
		1,
		finiteOr(env.parameters.periodFrames, FOLLOW_THROUGH_PERIOD_DEFAULT),
	);
	const delay =
		Math.max(
			0,
			finiteOr(env.parameters.delayFrames, FOLLOW_THROUGH_DELAY_DEFAULT),
		) * index;
	const response = finiteOr(
		env.parameters.response,
		FOLLOW_THROUGH_RESPONSE_DEFAULT,
	);
	const settleFrames = Math.max(
		1,
		finiteOr(env.parameters.settleFrames, FOLLOW_THROUGH_SETTLE_FRAMES_DEFAULT),
	);
	const decay = Math.max(
		0,
		finiteOr(env.parameters.decay, FOLLOW_THROUGH_DECAY_DEFAULT),
	);
	const lookback = Math.max(
		1,
		finiteOr(
			env.parameters.velocityLookback,
			FOLLOW_THROUGH_VELOCITY_LOOKBACK_DEFAULT,
		),
	);
	const rotationResponse = finiteOr(
		env.parameters.rotationResponse,
		FOLLOW_THROUGH_ROTATION_RESPONSE_DEFAULT,
	);
	const now = samplePositionAt(leaderId, frame);
	const delayed = samplePositionAt(leaderId, frame - delay);
	const previous = samplePositionAt(leaderId, frame - lookback);
	const velocity = {
		x: (now.x - previous.x) / lookback,
		y: (now.y - previous.y) / lookback,
	};
	const lag = {
		x: (delayed.x - now.x) * response,
		y: (delayed.y - now.y) * response,
	};
	const phase = wrap(frame - delay, period) / period;
	const settle = Math.exp((-decay * phase * period) / settleFrames);
	const oscillation =
		Math.sin(phase * Math.PI * 2) * settle * settleFrames * response;
	return {
		x: lag.x + velocity.x * oscillation,
		y: lag.y + velocity.y * oscillation,
		rotation: (lag.x + velocity.x * oscillation) * rotationResponse,
	};
};

const sampleFollowThrough = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const followerIds =
		env.resolvedRoleNodeIds.get(FOLLOW_THROUGH_FOLLOWER_ROLE) ?? [];
	return followerIds.flatMap((nodeId, index) => {
		const response = responseAt({ env, frame: env.frame, index: index + 1 });
		if (!response) return [];
		return [
			{
				kind: "translate" as const,
				nodeId,
				value: { x: response.x, y: response.y },
			},
			{ kind: "rotate" as const, nodeId, value: response.rotation },
		];
	});
};

/** Registered derivative-aware Follow-through expression. */
export const FOLLOW_THROUGH_V1: MotionExpressionDefinition = {
	expressionId: "lag-follow-through",
	version: 1,
	source: { origin: "vecmo", reference: "velocity-seeded-overshoot-v1" },
	label: "Follow-through",
	summary:
		"Followers combine delayed lead motion with a velocity-derived, decaying residual.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Follow-through relation",
		actionLabel: "Create Follow-through",
		previewLabel: "Preview follow-through",
		description:
			"Reads the leader through the shared presentation sampler; follower amplitude is never an independent key.",
		outputSummary: "Derived follower translate and rotation.",
	},
	roles: [
		{
			roleId: FOLLOW_THROUGH_LEADER_ROLE,
			aliases: ["lag-follow-through:leader"],
			label: "Leader",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: FOLLOW_THROUGH_FOLLOWER_ROLE,
			aliases: ["lag-follow-through:follower"],
			label: "Follower",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		[
			"periodFrames",
			"Period",
			FOLLOW_THROUGH_PERIOD_DEFAULT,
			1,
			600,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"delayFrames",
			"Delay",
			FOLLOW_THROUGH_DELAY_DEFAULT,
			0,
			90,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"response",
			"Response",
			FOLLOW_THROUGH_RESPONSE_DEFAULT,
			0,
			1.5,
			0.05,
			"motion",
			"response",
			"Response",
		],
		[
			"settleFrames",
			"Settle",
			FOLLOW_THROUGH_SETTLE_FRAMES_DEFAULT,
			1,
			180,
			1,
			"timing",
			"response",
			"Response",
		],
		[
			"decay",
			"Decay",
			FOLLOW_THROUGH_DECAY_DEFAULT,
			0,
			1,
			0.01,
			"motion",
			"response",
			"Response",
		],
		[
			"velocityLookback",
			"Velocity Lookback",
			FOLLOW_THROUGH_VELOCITY_LOOKBACK_DEFAULT,
			1,
			12,
			1,
			"timing",
			"response",
			"Response",
		],
		[
			"rotationResponse",
			"Rotation Response",
			FOLLOW_THROUGH_ROTATION_RESPONSE_DEFAULT,
			-1,
			1,
			0.01,
			"motion",
			"response",
			"Response",
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
			role: role as "timing" | "motion",
			groupId: groupId as string,
			groupLabel: groupLabel as string,
		}),
	),
	outputs: ["translate", "rotate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Follow-through",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: FOLLOW_THROUGH_FOLLOWER_ROLE },
	recipeRoles: [FOLLOW_THROUGH_LEADER_ROLE, FOLLOW_THROUGH_FOLLOWER_ROLE],
	sample: sampleFollowThrough,
};
