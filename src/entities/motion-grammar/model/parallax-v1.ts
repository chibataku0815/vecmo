/**
 * Parallax v1 is a versioned, pure shared-wave Motion Grammar expression.
 * Every depth role reads one closed screen-space waveform. The only role-level
 * difference is its explicitly authored signed amplitude; node order, carrier
 * size, sampled speed, and camera depth are not inputs to this law.
 */

import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	ExpressionVector2,
	MotionExpressionDefinition,
} from "./expression-definition";

export const PARALLAX_FOREGROUND_ROLE = "foreground";
export const PARALLAX_MIDGROUND_ROLE = "midground";
export const PARALLAX_BACKGROUND_ROLE = "background";

/**
 * This source law is a screen_2d perceptual amplitude profile, not camera
 * parallax or an assertion that amplitude denotes physical Z distance.
 */
export const PARALLAX_V1_OUTPUT_CONTRACT = {
	cameraSpacePolicy: "screen_2d",
	outputTopology: "existing-scene-node-transform-patches",
	channels: ["translate"],
	bakePolicy: "not-supported",
	surfaces: {
		canvas: "shared-presentation-route",
		svg: "shared-presentation-route",
		pdf: "shared-presentation-route",
		javascriptCodeRuntime: "shared-presentation-route",
		webgl: "shared-presentation-route",
	},
} as const;

const DEFAULT_PERIOD_FRAMES = 120;
const DEFAULT_DESCENT_FRAMES = 56;
const DEFAULT_DESCENT_SHAPE = 1.25;
const DEFAULT_ASCENT_SHAPE = 1.75;
const DEFAULT_AXIS: ExpressionVector2 = { x: 0, y: 1 };
const DEFAULT_FOREGROUND_AMPLITUDE = 48;
const DEFAULT_MIDGROUND_AMPLITUDE = 26;
const DEFAULT_BACKGROUND_AMPLITUDE = 12;

type ParallaxRole =
	| typeof PARALLAX_FOREGROUND_ROLE
	| typeof PARALLAX_MIDGROUND_ROLE
	| typeof PARALLAX_BACKGROUND_ROLE;

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(maximum, Math.max(minimum, value));

const wrapFrame = (frame: number, period: number): number => {
	const remainder = frame % period;
	return remainder < 0 ? remainder + period : remainder;
};

const normalizedAxis = (
	parameters: Readonly<Record<string, number>>,
): ExpressionVector2 => {
	const x = finiteOr(parameters.axisX, DEFAULT_AXIS.x);
	const y = finiteOr(parameters.axisY, DEFAULT_AXIS.y);
	const length = Math.hypot(x, y);
	return length > 1e-8 ? { x: x / length, y: y / length } : DEFAULT_AXIS;
};

/**
 * One discrete-seam-safe top -> bottom -> top wave. Separate powers make the
 * downward and upward traversals independently shaped while retaining exactly
 * the same phase for every role.
 */
const sharedWaveAt = ({
	frame,
	periodFrames,
	descentFrames,
	descentShape,
	ascentShape,
}: {
	readonly frame: number;
	readonly periodFrames: number;
	readonly descentFrames: number;
	readonly descentShape: number;
	readonly ascentShape: number;
}): number => {
	const localFrame = wrapFrame(frame, periodFrames);
	if (localFrame < descentFrames) {
		const progress = localFrame / Math.max(1, descentFrames - 1);
		return -1 + 2 * progress ** descentShape;
	}
	const ascentFrames = periodFrames - descentFrames;
	const progress = (localFrame - descentFrames) / Math.max(1, ascentFrames - 1);
	return 1 - 2 * progress ** ascentShape;
};

const roleNodeIds = (
	env: ExpressionSampleEnv,
	role: ParallaxRole,
): readonly string[] => env.resolvedRoleNodeIds.get(role) ?? [];

const appendRole = ({
	emits,
	nodeIds,
	axis,
	amplitude,
	wave,
	seen,
}: {
	readonly emits: ExpressionChannelEmit[];
	readonly nodeIds: readonly string[];
	readonly axis: ExpressionVector2;
	readonly amplitude: number;
	readonly wave: number;
	readonly seen: Set<string>;
}): void => {
	for (const nodeId of nodeIds) {
		if (seen.has(nodeId)) continue;
		seen.add(nodeId);
		emits.push({
			kind: "translate",
			nodeId,
			value: {
				x: axis.x * amplitude * wave,
				y: axis.y * amplitude * wave,
			},
		});
	}
};

/**
 * Samples one common waveform through named role amplitudes. No role may gain
 * a private phase, and no amplitude is inferred from geometry or target order.
 */
const sampleParallax = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	if (!Number.isFinite(env.frame)) return [];
	const periodFrames = Math.max(
		4,
		finiteOr(env.parameters.periodFrames, DEFAULT_PERIOD_FRAMES),
	);
	const descentFrames = clamp(
		finiteOr(env.parameters.descentFrames, DEFAULT_DESCENT_FRAMES),
		2,
		Math.max(2, periodFrames - 2),
	);
	const descentShape = clamp(
		finiteOr(env.parameters.descentShape, DEFAULT_DESCENT_SHAPE),
		0.1,
		8,
	);
	const ascentShape = clamp(
		finiteOr(env.parameters.ascentShape, DEFAULT_ASCENT_SHAPE),
		0.1,
		8,
	);
	const wave = sharedWaveAt({
		frame: env.frame,
		periodFrames,
		descentFrames,
		descentShape,
		ascentShape,
	});
	const axis = normalizedAxis(env.parameters);
	const foregroundAmplitude = finiteOr(
		env.parameters.foregroundAmplitude,
		DEFAULT_FOREGROUND_AMPLITUDE,
	);
	const midgroundAmplitude = finiteOr(
		env.parameters.midgroundAmplitude,
		DEFAULT_MIDGROUND_AMPLITUDE,
	);
	const backgroundAmplitude = finiteOr(
		env.parameters.backgroundAmplitude,
		DEFAULT_BACKGROUND_AMPLITUDE,
	);
	const emits: ExpressionChannelEmit[] = [];
	const seen = new Set<string>();
	appendRole({
		emits,
		nodeIds: roleNodeIds(env, PARALLAX_FOREGROUND_ROLE),
		axis,
		amplitude: foregroundAmplitude,
		wave,
		seen,
	});
	appendRole({
		emits,
		nodeIds: roleNodeIds(env, PARALLAX_MIDGROUND_ROLE),
		axis,
		amplitude: midgroundAmplitude,
		wave,
		seen,
	});
	appendRole({
		emits,
		nodeIds: roleNodeIds(env, PARALLAX_BACKGROUND_ROLE),
		axis,
		amplitude: backgroundAmplitude,
		wave,
		seen,
	});
	return emits;
};

/**
 * New marker-enabled bindings use this explicit role-amplitude contract through
 * the shared presentation route; legacy bindings keep their old evaluator.
 */
export const PARALLAX_V1: MotionExpressionDefinition = {
	expressionId: "size-speed-parallax",
	version: 1,
	activation: "versioned",
	source: { origin: "motion-studies", reference: "parallax-bob" },
	label: "Parallax",
	summary:
		"One closed screen-space wave moves explicit foreground, midground, and background role amplitudes in unison.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Shared-wave Parallax",
		actionLabel: "Create Shared-wave Parallax",
		previewLabel: "Shared-wave Parallax preview",
		description:
			"Samples existing named depth roles from one phase; no nodes, depth planes, or presentation clones are created.",
		outputSummary:
			"Screen-space translations whose only role difference is the explicit signed amplitude.",
	},
	roles: [
		{
			roleId: PARALLAX_FOREGROUND_ROLE,
			aliases: ["size-speed-parallax:foreground"],
			label: "Foreground",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: PARALLAX_MIDGROUND_ROLE,
			aliases: ["size-speed-parallax:midground"],
			label: "Midground",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: PARALLAX_BACKGROUND_ROLE,
			aliases: ["size-speed-parallax:background"],
			label: "Background",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		{
			key: "periodFrames",
			label: "Period",
			default: DEFAULT_PERIOD_FRAMES,
			min: 4,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "descentFrames",
			label: "Descent",
			default: DEFAULT_DESCENT_FRAMES,
			min: 2,
			max: 598,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "descentShape",
			label: "Descent easing",
			default: DEFAULT_DESCENT_SHAPE,
			min: 0.1,
			max: 8,
			step: 0.05,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "ascentShape",
			label: "Ascent easing",
			default: DEFAULT_ASCENT_SHAPE,
			min: 0.1,
			max: 8,
			step: 0.05,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "axisX",
			label: "Axis X",
			default: DEFAULT_AXIS.x,
			min: -1,
			max: 1,
			step: 0.01,
			role: "layout",
			groupId: "axis",
			groupLabel: "Screen axis",
		},
		{
			key: "axisY",
			label: "Axis Y",
			default: DEFAULT_AXIS.y,
			min: -1,
			max: 1,
			step: 0.01,
			role: "layout",
			groupId: "axis",
			groupLabel: "Screen axis",
		},
		{
			key: "foregroundAmplitude",
			label: "Foreground amplitude",
			default: DEFAULT_FOREGROUND_AMPLITUDE,
			min: -2048,
			max: 2048,
			step: 1,
			role: "motion",
			groupId: "foreground",
			groupLabel: "Foreground",
		},
		{
			key: "midgroundAmplitude",
			label: "Midground amplitude",
			default: DEFAULT_MIDGROUND_AMPLITUDE,
			min: -2048,
			max: 2048,
			step: 1,
			role: "motion",
			groupId: "midground",
			groupLabel: "Midground",
		},
		{
			key: "backgroundAmplitude",
			label: "Background amplitude",
			default: DEFAULT_BACKGROUND_AMPLITUDE,
			min: -2048,
			max: 2048,
			step: 1,
			role: "motion",
			groupId: "background",
			groupLabel: "Background",
		},
	],
	outputs: ["translate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Shared parallax wave",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: PARALLAX_FOREGROUND_ROLE },
	recipeRoles: [
		PARALLAX_FOREGROUND_ROLE,
		PARALLAX_MIDGROUND_ROLE,
		PARALLAX_BACKGROUND_ROLE,
	],
	sample: sampleParallax,
};
