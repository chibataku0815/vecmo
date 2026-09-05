/**
 * Built-in Random Pulse expression. The field uses one shared authored pulse
 * envelope and a deterministic seed only to choose semantic rank; it never
 * samples wall time or `Math.random`.
 */

import {
	RANDOM_PULSE_CADENCE_DEFAULT,
	RANDOM_PULSE_OPACITY_FLOOR_DEFAULT,
	RANDOM_PULSE_PERIOD_DEFAULT,
	RANDOM_PULSE_WIDTH_DEFAULT,
} from "./catalog";
import { deterministicSeededOrder } from "./deterministic-order";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";
import {
	RANDOM_PULSE_PROFILE_DEFAULT,
	sampleRandomPulseProfile,
} from "./random-pulse-profile";

const RANDOM_PULSE_CELL_ROLE = "cell";

/** Explicit source-calibrated envelope used when a new binding omits a profile. */
const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const wrap = (value: number, period: number): number => {
	if (!(period > 0)) return value;
	return ((value % period) + period) % period;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const sampleRandomPulse = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const frame = env.frame;
	const period = Math.max(
		1,
		finiteOr(env.parameters.periodFrames, RANDOM_PULSE_PERIOD_DEFAULT),
	);
	const cadence = finiteOr(
		env.parameters.cadenceFrames,
		RANDOM_PULSE_CADENCE_DEFAULT,
	);
	const pulseFrames = finiteOr(
		env.parameters.pulseFrames,
		RANDOM_PULSE_WIDTH_DEFAULT,
	);
	const scaleAmplitude = finiteOr(env.parameters.scaleAmplitude, 0.22);
	const opacityFloor = finiteOr(
		env.parameters.opacityFloor,
		RANDOM_PULSE_OPACITY_FLOOR_DEFAULT,
	);
	const targets = env.resolvedRoleNodeIds.get(RANDOM_PULSE_CELL_ROLE) ?? [];
	const ordered = deterministicSeededOrder(
		targets,
		(nodeId) => nodeId,
		env.seed,
	);
	const profile = env.randomPulseProfile;
	const profileFrameScale = profile
		? profile.durationFrames / Math.max(1, pulseFrames)
		: 1;

	return ordered.flatMap((nodeId, rank) => {
		const age = wrap(frame - rank * cadence, period);
		const pulse = profile
			? (sampleRandomPulseProfile(profile, age * profileFrameScale) ?? 0)
			: (() => {
					const progress = pulseFrames > 0 ? age / pulseFrames : 1;
					return progress >= 0 && progress <= 1
						? Math.sin(Math.PI * progress)
						: 0;
				})();
		const scale = 1 + scaleAmplitude * pulse;
		return [
			{
				kind: "scaleFactor" as const,
				nodeId,
				value: { x: scale, y: scale },
			},
			{
				kind: "opacityFactor" as const,
				nodeId,
				value: opacityFloor + (1 - opacityFloor) * clamp01(pulse),
			},
		];
	});
};

/** The single source for Random Pulse profile, runtime, and Inspector metadata. */
export const RANDOM_PULSE_V1: MotionExpressionDefinition = {
	expressionId: "random-phase-pulse",
	version: 1,
	source: {
		origin: "vecmo",
		reference: "random-rank-pulse-v1",
	},
	label: "Random Pulse",
	summary:
		"A deterministic field of identical authored pulses whose temporal rank is selected by seed.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Random Pulse field",
		actionLabel: "Create Random Pulse",
		previewLabel: "Preview pulse field",
		description:
			"Keeps source cells editable and evaluates one shared pulse envelope at runtime; no implicit clone or bake is created.",
		outputSummary: "Per-target scaleFactor and opacityFactor.",
	},
	seedControl: {
		key: "seed",
		label: "Seed",
		default: 13,
		min: -2147483648,
		max: 2147483647,
		step: 1,
		role: "debug",
	},
	profileControls: [
		{
			kind: "random-pulse-envelope",
			label: "Pulse envelope",
			description:
				"Edit the shared rest, undershoot, peak, hold, recovery, and easing law. Invalid profiles are rejected before they reach the document.",
		},
	],
	roles: [
		{
			roleId: RANDOM_PULSE_CELL_ROLE,
			aliases: ["random-phase-pulse:cell"],
			label: "Pulse cell",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		{
			key: "periodFrames",
			label: "Period",
			default: RANDOM_PULSE_PERIOD_DEFAULT,
			min: 1,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "cadenceFrames",
			label: "Cadence",
			default: RANDOM_PULSE_CADENCE_DEFAULT,
			min: 1,
			max: 60,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "pulseFrames",
			label: "Pulse",
			default: RANDOM_PULSE_PROFILE_DEFAULT.durationFrames,
			min: 1,
			max: 120,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "scaleAmplitude",
			label: "Scale Amplitude",
			default: 0.22,
			min: -1,
			max: 2,
			step: 0.01,
			role: "motion",
			groupId: "response",
			groupLabel: "Response",
		},
		{
			key: "opacityFloor",
			label: "Opacity Floor",
			default: 0.45,
			min: 0,
			max: 1,
			step: 0.01,
			role: "look",
			groupId: "response",
			groupLabel: "Response",
		},
	],
	outputs: ["scaleFactor", "opacityFactor"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Random Pulse",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: RANDOM_PULSE_CELL_ROLE },
	sample: sampleRandomPulse,
};
