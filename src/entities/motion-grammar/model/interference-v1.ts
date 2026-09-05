/**
 * Interference v1 is a screen-space field expression: a constant-speed orbit
 * keeps the ring's clock running while nearby followers receive a bounded
 * radial/tangential dodge. The expression only derives presentation channels;
 * SceneDocument remains the durable owner of roles and rest positions.
 */

import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	ExpressionVector2,
	MotionExpressionDefinition,
} from "./expression-definition";

export const INTERFERENCE_DRIVER_ROLE = "driver";
export const INTERFERENCE_FOLLOWER_ROLE = "follower";
export const INTERFERENCE_CENTER_ROLE = "field-center";

const INTERFERENCE_ROLE_ALIASES = {
	driver: ["ring-wave-interference:driver"],
	follower: ["ring-wave-interference:follower"],
	center: ["ring-wave-interference:center"],
} as const;

export const INTERFERENCE_PERIOD_FRAMES_DEFAULT = 96;
export const INTERFERENCE_DRIVER_ORBIT_RADIUS_PX_DEFAULT = 80;
export const INTERFERENCE_DRIVER_START_DEGREES_DEFAULT = -90;
export const INTERFERENCE_FOLLOWER_PHASE_OFFSET_DEGREES_DEFAULT = 0;
export const INTERFERENCE_FOLLOWER_PHASE_STEP_DEGREES_DEFAULT = 45;
export const INTERFERENCE_PULSE_RADIUS_AMPLITUDE_PX_DEFAULT = 8;
export const INTERFERENCE_RADIAL_PUSH_PX_DEFAULT = 18;
export const INTERFERENCE_TANGENTIAL_SLIDE_PX_DEFAULT = 14;
export const INTERFERENCE_FALLOFF_EXPONENT_DEFAULT = 2;
export const INTERFERENCE_MINIMUM_DISTANCE_PX_DEFAULT = 16;

const TAU = Math.PI * 2;

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const wrapFrame = (frame: number, period: number): number =>
	period > 0 ? ((frame % period) + period) % period : 0;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

const pointIsFinite = (point: ExpressionVector2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const subtract = (
	left: ExpressionVector2,
	right: ExpressionVector2,
): ExpressionVector2 => ({ x: left.x - right.x, y: left.y - right.y });

const add = (
	left: ExpressionVector2,
	right: ExpressionVector2,
): ExpressionVector2 => ({ x: left.x + right.x, y: left.y + right.y });

const scale = (
	point: ExpressionVector2,
	amount: number,
): ExpressionVector2 => ({
	x: point.x * amount,
	y: point.y * amount,
});

const length = (point: ExpressionVector2): number =>
	Math.hypot(point.x, point.y);

const normalized = (
	point: ExpressionVector2,
	fallback: ExpressionVector2,
): ExpressionVector2 => {
	const magnitude = length(point);
	return magnitude > 1e-6 ? scale(point, 1 / magnitude) : fallback;
};

const rotateLeft = (point: ExpressionVector2): ExpressionVector2 => ({
	x: -point.y,
	y: point.x,
});

const wrappedAngle = (value: number): number => {
	const wrapped = (((value + Math.PI) % TAU) + TAU) % TAU;
	return wrapped - Math.PI;
};

const centroid = (
	points: readonly ExpressionVector2[],
): ExpressionVector2 | null => {
	if (points.length === 0 || points.some((point) => !pointIsFinite(point))) {
		return null;
	}
	return points.reduce(
		(sum, point) => ({
			x: sum.x + point.x / points.length,
			y: sum.y + point.y / points.length,
		}),
		{ x: 0, y: 0 },
	);
};

const exactlyOne = (
	roles: ReadonlyMap<string, readonly string[]>,
	roleId: string,
): string | null => {
	const nodeIds = roles.get(roleId) ?? [];
	return nodeIds.length === 1 ? (nodeIds[0] ?? null) : null;
};

/** One follower's causal state before it becomes a presentation transform. */
export type InterferenceFollowerState = {
	readonly nodeId: string;
	readonly restPosition: ExpressionVector2;
	readonly clockedPosition: ExpressionVector2;
	readonly distanceToDriverPx: number;
	readonly response: number;
	readonly radialPush: ExpressionVector2;
	readonly tangentialSlide: ExpressionVector2;
	readonly finalPosition: ExpressionVector2;
};

/**
 * Pure semantic state behind the Interference expression. Exporting this makes
 * the candidate observable without importing it into the reference oracle.
 */
export type InterferenceExpressionState = {
	readonly fieldCenter: ExpressionVector2;
	readonly driverNodeId: string;
	readonly driverRestPosition: ExpressionVector2;
	readonly driverPosition: ExpressionVector2;
	readonly followers: readonly InterferenceFollowerState[];
};

/**
 * Samples the clocked ring and its local dodge field without writing durable
 * transforms. Missing/ambiguous semantic roles fail closed as an empty sample.
 */
export const sampleInterferenceV1 = (
	env: ExpressionSampleEnv,
): InterferenceExpressionState | null => {
	const driverNodeId = exactlyOne(
		env.resolvedRoleNodeIds,
		INTERFERENCE_DRIVER_ROLE,
	);
	const centerNodeIds =
		env.resolvedRoleNodeIds.get(INTERFERENCE_CENTER_ROLE) ?? [];
	const followerNodeIds =
		env.resolvedRoleNodeIds.get(INTERFERENCE_FOLLOWER_ROLE) ?? [];
	if (
		!driverNodeId ||
		centerNodeIds.length > 1 ||
		followerNodeIds.length === 0 ||
		new Set(followerNodeIds).size !== followerNodeIds.length ||
		followerNodeIds.includes(driverNodeId)
	) {
		return null;
	}

	const driverRestPosition = env.restPositionOf(driverNodeId);
	const followerRestPositions = followerNodeIds.map((nodeId) =>
		env.restPositionOf(nodeId),
	);
	if (
		!pointIsFinite(driverRestPosition) ||
		followerRestPositions.some((position) => !pointIsFinite(position))
	) {
		return null;
	}
	const fieldCenter = centerNodeIds[0]
		? env.restPositionOf(centerNodeIds[0])
		: centroid(followerRestPositions);
	if (!fieldCenter || !pointIsFinite(fieldCenter)) return null;

	const period = finiteOr(
		env.parameters.periodFrames,
		INTERFERENCE_PERIOD_FRAMES_DEFAULT,
	);
	const driverOrbitRadius = finiteOr(
		env.parameters.driverOrbitRadiusPx,
		INTERFERENCE_DRIVER_ORBIT_RADIUS_PX_DEFAULT,
	);
	const driverStartRadians = radians(
		finiteOr(
			env.parameters.driverStartDegrees,
			INTERFERENCE_DRIVER_START_DEGREES_DEFAULT,
		),
	);
	const followerPhaseOffsetRadians = radians(
		finiteOr(
			env.parameters.followerPhaseOffsetDegrees,
			INTERFERENCE_FOLLOWER_PHASE_OFFSET_DEGREES_DEFAULT,
		),
	);
	const followerPhaseStepRadians = radians(
		finiteOr(
			env.parameters.followerPhaseStepDegrees,
			INTERFERENCE_FOLLOWER_PHASE_STEP_DEGREES_DEFAULT,
		),
	);
	const pulseRadiusAmplitude = finiteOr(
		env.parameters.pulseRadiusAmplitudePx,
		INTERFERENCE_PULSE_RADIUS_AMPLITUDE_PX_DEFAULT,
	);
	const radialPushPx = finiteOr(
		env.parameters.radialPushPx,
		INTERFERENCE_RADIAL_PUSH_PX_DEFAULT,
	);
	const tangentialSlidePx = finiteOr(
		env.parameters.tangentialSlidePx,
		INTERFERENCE_TANGENTIAL_SLIDE_PX_DEFAULT,
	);
	const falloffExponent = finiteOr(
		env.parameters.falloffExponent,
		INTERFERENCE_FALLOFF_EXPONENT_DEFAULT,
	);
	const minimumDistancePx = finiteOr(
		env.parameters.minimumDistancePx,
		INTERFERENCE_MINIMUM_DISTANCE_PX_DEFAULT,
	);
	if (
		!Number.isInteger(period) ||
		period <= 0 ||
		driverOrbitRadius <= 0 ||
		Math.abs(followerPhaseStepRadians) < 1e-6 ||
		pulseRadiusAmplitude <= 0 ||
		radialPushPx <= 0 ||
		tangentialSlidePx <= 0 ||
		falloffExponent <= 0 ||
		falloffExponent > 8 ||
		minimumDistancePx <= 0
	) {
		return null;
	}
	const normalizedFrame = wrapFrame(env.frame, period) / period;
	const driverAngle = driverStartRadians + TAU * normalizedFrame;
	const driverPosition = add(fieldCenter, {
		x: Math.cos(driverAngle) * driverOrbitRadius,
		y: Math.sin(driverAngle) * driverOrbitRadius,
	});
	const followers: InterferenceFollowerState[] = [];

	for (const [index, nodeId] of followerNodeIds.entries()) {
		const restPosition = followerRestPositions[index];
		if (!restPosition) return null;
		const fallbackDirection = {
			x: Math.cos((TAU * index) / followerNodeIds.length),
			y: Math.sin((TAU * index) / followerNodeIds.length),
		};
		const restOffset = subtract(restPosition, fieldCenter);
		const restRadius = length(restOffset);
		const ringDirection = normalized(restOffset, fallbackDirection);
		const clockPhase =
			TAU * normalizedFrame +
			followerPhaseOffsetRadians +
			index * followerPhaseStepRadians;
		const clockedPosition = add(
			fieldCenter,
			scale(
				ringDirection,
				Math.max(0, restRadius + pulseRadiusAmplitude * Math.sin(clockPhase)),
			),
		);
		const fromDriver = subtract(clockedPosition, driverPosition);
		const distanceToDriverPx = length(fromDriver);
		const radialDirection = normalized(fromDriver, ringDirection);
		const response =
			(minimumDistancePx / Math.max(minimumDistancePx, distanceToDriverPx)) **
			falloffExponent;
		const followerAngle = Math.atan2(
			clockedPosition.y - fieldCenter.y,
			clockedPosition.x - fieldCenter.x,
		);
		const signedAngularDelta = wrappedAngle(followerAngle - driverAngle);
		const tangentialSign = signedAngularDelta < 0 ? -1 : 1;
		const radialPush = scale(radialDirection, radialPushPx * response);
		const tangentialSlide = scale(
			rotateLeft(radialDirection),
			tangentialSlidePx * response * tangentialSign,
		);
		followers.push({
			nodeId,
			restPosition,
			clockedPosition,
			distanceToDriverPx,
			response,
			radialPush,
			tangentialSlide,
			finalPosition: add(add(clockedPosition, radialPush), tangentialSlide),
		});
	}

	return {
		fieldCenter,
		driverNodeId,
		driverRestPosition,
		driverPosition,
		followers,
	};
};

const sampleInterference = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const state = sampleInterferenceV1(env);
	if (!state) return [];
	return [
		{
			kind: "translate",
			nodeId: state.driverNodeId,
			value: subtract(state.driverPosition, state.driverRestPosition),
		},
		...state.followers.map((follower) => ({
			kind: "translate" as const,
			nodeId: follower.nodeId,
			value: subtract(follower.finalPosition, follower.restPosition),
		})),
	];
};

/**
 * Direct registered-expression candidate. It is deliberately not added to the
 * runtime registry in this module; promotion requires a separate owner-level
 * integration decision and does not serialize executable code.
 */
export const INTERFERENCE_V1: MotionExpressionDefinition = {
	expressionId: "ring-wave-interference",
	version: 1,
	activation: "versioned",
	source: { origin: "motion-studies", reference: "ring-dodge" },
	label: "Interference",
	summary:
		"A constant-speed orbit locally bends a separately clocked ring through bounded radial and tangential dodge.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Interference field",
		actionLabel: "Create Interference",
		previewLabel: "Interference preview",
		description:
			"Samples a screen-space orbit and ring response without durable follower tracks or generated nodes.",
		outputSummary: "Driver orbit and follower translation presentation only.",
	},
	roles: [
		{
			roleId: INTERFERENCE_DRIVER_ROLE,
			aliases: INTERFERENCE_ROLE_ALIASES.driver,
			label: "Orbit driver",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: INTERFERENCE_FOLLOWER_ROLE,
			aliases: INTERFERENCE_ROLE_ALIASES.follower,
			label: "Ring follower",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: INTERFERENCE_CENTER_ROLE,
			aliases: INTERFERENCE_ROLE_ALIASES.center,
			label: "Field center",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		{
			key: "periodFrames",
			label: "Period",
			default: INTERFERENCE_PERIOD_FRAMES_DEFAULT,
			min: 1,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "driverOrbitRadiusPx",
			label: "Orbit radius",
			default: INTERFERENCE_DRIVER_ORBIT_RADIUS_PX_DEFAULT,
			min: 1,
			max: 2048,
			step: 1,
			role: "layout",
			groupId: "orbit",
			groupLabel: "Orbit",
		},
		{
			key: "driverStartDegrees",
			label: "Orbit start",
			default: INTERFERENCE_DRIVER_START_DEGREES_DEFAULT,
			min: -360,
			max: 360,
			step: 1,
			role: "motion",
			groupId: "orbit",
			groupLabel: "Orbit",
		},
		{
			key: "followerPhaseOffsetDegrees",
			label: "Clock offset",
			default: INTERFERENCE_FOLLOWER_PHASE_OFFSET_DEGREES_DEFAULT,
			min: -360,
			max: 360,
			step: 1,
			role: "motion",
			groupId: "clock",
			groupLabel: "Ring clock",
		},
		{
			key: "followerPhaseStepDegrees",
			label: "Clock step",
			default: INTERFERENCE_FOLLOWER_PHASE_STEP_DEGREES_DEFAULT,
			min: 1,
			max: 360,
			step: 1,
			role: "motion",
			groupId: "clock",
			groupLabel: "Ring clock",
		},
		{
			key: "pulseRadiusAmplitudePx",
			label: "Pulse radius",
			default: INTERFERENCE_PULSE_RADIUS_AMPLITUDE_PX_DEFAULT,
			min: 1,
			max: 512,
			step: 1,
			role: "motion",
			groupId: "clock",
			groupLabel: "Ring clock",
		},
		{
			key: "radialPushPx",
			label: "Radial dodge",
			default: INTERFERENCE_RADIAL_PUSH_PX_DEFAULT,
			min: 1,
			max: 512,
			step: 1,
			role: "motion",
			groupId: "dodge",
			groupLabel: "Dodge",
		},
		{
			key: "tangentialSlidePx",
			label: "Tangential dodge",
			default: INTERFERENCE_TANGENTIAL_SLIDE_PX_DEFAULT,
			min: 1,
			max: 512,
			step: 1,
			role: "motion",
			groupId: "dodge",
			groupLabel: "Dodge",
		},
		{
			key: "falloffExponent",
			label: "Falloff",
			default: INTERFERENCE_FALLOFF_EXPONENT_DEFAULT,
			min: 0.1,
			max: 8,
			step: 0.1,
			role: "motion",
			groupId: "dodge",
			groupLabel: "Dodge",
		},
		{
			key: "minimumDistancePx",
			label: "Minimum distance",
			default: INTERFERENCE_MINIMUM_DISTANCE_PX_DEFAULT,
			min: 1,
			max: 1024,
			step: 1,
			role: "layout",
			groupId: "dodge",
			groupLabel: "Dodge",
		},
	],
	outputs: ["translate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Interference",
		durationParameterKey: "periodFrames",
	},
	timingTemplates: [
		{
			templateId: "loop.phase-continuity",
			role: "Orbit and ring seam",
			note: "The driver orbit and follower clock share one wrapped period.",
			parameterKeys: ["periodFrames"],
		},
	],
	roleExpansion: { mode: "per-target", roleId: INTERFERENCE_FOLLOWER_ROLE },
	sample: sampleInterference,
};
