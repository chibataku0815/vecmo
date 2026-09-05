/**
 * Interference v1: a moving driver bends one clocked ring field through a
 * bounded radial/tangential proximity response. Ring members remain Scene
 * carriers; no follower path or generated node is persisted.
 */

import {
	RING_WAVE_CENTER_X_DEFAULT,
	RING_WAVE_CENTER_Y_DEFAULT,
	RING_WAVE_DRIVER_ORBIT_RADIUS_DEFAULT,
	RING_WAVE_FALLOFF_DISTANCE_DEFAULT,
	RING_WAVE_FALLOFF_EXPONENT_DEFAULT,
	RING_WAVE_MIN_DISTANCE_DEFAULT,
	RING_WAVE_OPACITY_FLOOR_DEFAULT,
	RING_WAVE_PERIOD_DEFAULT,
	RING_WAVE_PHASE_STEP_DEGREES_DEFAULT,
	RING_WAVE_PULSE_RADIUS_DEFAULT,
	RING_WAVE_RADIAL_PUSH_DEFAULT,
	RING_WAVE_RING_RADIUS_DEFAULT,
	RING_WAVE_SCALE_AMPLITUDE_DEFAULT,
	RING_WAVE_TANGENTIAL_SLIDE_DEFAULT,
	RING_WAVE_WAVELENGTH_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const INTERFERENCE_DRIVER_ROLE = "driver";
export const INTERFERENCE_RING_ROLE = "ring";

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;
const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const wrap = (value: number, period: number): number =>
	((value % period) + period) % period;

const sampleInterference = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const driverId = env.resolvedRoleNodeIds.get(INTERFERENCE_DRIVER_ROLE)?.[0];
	const ringIds = env.resolvedRoleNodeIds.get(INTERFERENCE_RING_ROLE) ?? [];
	const samplePositionAt = env.samplePositionAt;
	if (!driverId || !samplePositionAt || ringIds.length === 0) return [];
	const period = Math.max(
		1,
		finiteOr(env.parameters.periodFrames, RING_WAVE_PERIOD_DEFAULT),
	);
	const center = {
		x: finiteOr(env.parameters.centerX, RING_WAVE_CENTER_X_DEFAULT),
		y: finiteOr(env.parameters.centerY, RING_WAVE_CENTER_Y_DEFAULT),
	};
	const ringRadius = Math.max(
		1,
		finiteOr(env.parameters.ringRadius, RING_WAVE_RING_RADIUS_DEFAULT),
	);
	const pulseRadius = finiteOr(
		env.parameters.pulseRadius,
		RING_WAVE_PULSE_RADIUS_DEFAULT,
	);
	const phaseStep =
		(finiteOr(
			env.parameters.phaseStepDegrees,
			RING_WAVE_PHASE_STEP_DEGREES_DEFAULT,
		) *
			Math.PI) /
		180;
	const radialPush = finiteOr(
		env.parameters.radialPush,
		RING_WAVE_RADIAL_PUSH_DEFAULT,
	);
	const tangentialSlide = finiteOr(
		env.parameters.tangentialSlide,
		RING_WAVE_TANGENTIAL_SLIDE_DEFAULT,
	);
	const falloffDistance = Math.max(
		1,
		finiteOr(
			env.parameters.falloffDistance,
			RING_WAVE_FALLOFF_DISTANCE_DEFAULT,
		),
	);
	const falloffExponent = Math.max(
		0.1,
		finiteOr(
			env.parameters.falloffExponent,
			RING_WAVE_FALLOFF_EXPONENT_DEFAULT,
		),
	);
	const minDistance = Math.max(
		0,
		finiteOr(env.parameters.minDistance, RING_WAVE_MIN_DISTANCE_DEFAULT),
	);
	const scaleAmplitude = finiteOr(
		env.parameters.scaleAmplitude,
		RING_WAVE_SCALE_AMPLITUDE_DEFAULT,
	);
	const opacityFloor = clamp(
		finiteOr(env.parameters.opacityFloor, RING_WAVE_OPACITY_FLOOR_DEFAULT),
		0,
		1,
	);
	const driver = samplePositionAt(driverId, env.frame);
	return ringIds.flatMap((nodeId, index) => {
		const rest = env.restPointOf?.(nodeId) ?? env.restPositionOf(nodeId);
		const restVector = { x: rest.x - center.x, y: rest.y - center.y };
		const angle = Math.atan2(restVector.y, restVector.x);
		const pulse =
			0.5 +
			0.5 *
				Math.sin(
					(2 * Math.PI * wrap(env.frame, period)) / period + index * phaseStep,
				);
		const baseRadius = ringRadius + pulseRadius * pulse;
		const pre = {
			x: center.x + Math.cos(angle) * baseRadius,
			y: center.y + Math.sin(angle) * baseRadius,
		};
		const relation = { x: pre.x - driver.x, y: pre.y - driver.y };
		const distance = Math.max(minDistance, Math.hypot(relation.x, relation.y));
		const falloff =
			clamp(1 - distance / falloffDistance, 0, 1) ** falloffExponent;
		const normal = { x: relation.x / distance, y: relation.y / distance };
		const tangent = { x: -normal.y, y: normal.x };
		const position = {
			x:
				pre.x +
				normal.x * radialPush * falloff +
				tangent.x * tangentialSlide * falloff -
				rest.x,
			y:
				pre.y +
				normal.y * radialPush * falloff +
				tangent.y * tangentialSlide * falloff -
				rest.y,
		};
		const scale = 1 + scaleAmplitude * pulse;
		return [
			{ kind: "translate" as const, nodeId, value: position },
			{ kind: "scaleFactor" as const, nodeId, value: { x: scale, y: scale } },
			{
				kind: "opacityFactor" as const,
				nodeId,
				value: opacityFloor + (1 - opacityFloor) * pulse,
			},
		];
	});
};

/** Registered typed field expression for orbit-driver interference. */
export const INTERFERENCE_RING_V1: MotionExpressionDefinition = {
	expressionId: "ring-wave-interference",
	version: 1,
	source: { origin: "vecmo", reference: "ring-dodge-interference-v1" },
	label: "Interference",
	summary: "A clocked ring field bends locally under a passing orbit driver.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Interference field",
		actionLabel: "Create Interference",
		previewLabel: "Preview interference",
		description:
			"Keeps the driver and ring members editable while deriving proximity dodge in presentation.",
		outputSummary:
			"Ring translation, scale, and opacity with bounded proximity falloff.",
	},
	roles: [
		{
			roleId: INTERFERENCE_DRIVER_ROLE,
			aliases: [
				"ring-wave-interference:driver",
				"ring-wave-interference:emitter-a",
			],
			label: "Orbit driver",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: INTERFERENCE_RING_ROLE,
			aliases: [
				"ring-wave-interference:ring",
				"ring-wave-interference:sample",
				"ring-wave-interference:emitter-b",
			],
			label: "Ring member",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		[
			"periodFrames",
			"Period",
			RING_WAVE_PERIOD_DEFAULT,
			1,
			600,
			1,
			"timing",
			"timing",
			"Timing",
		],
		[
			"wavelengthPx",
			"Wavelength",
			RING_WAVE_WAVELENGTH_DEFAULT,
			1,
			400,
			1,
			"layout",
			"field",
			"Field",
		],
		[
			"scaleAmplitude",
			"Scale",
			RING_WAVE_SCALE_AMPLITUDE_DEFAULT,
			0,
			2,
			0.01,
			"motion",
			"field",
			"Field",
		],
		[
			"opacityFloor",
			"Floor",
			RING_WAVE_OPACITY_FLOOR_DEFAULT,
			0,
			1,
			0.05,
			"look",
			"field",
			"Field",
		],
		[
			"centerX",
			"Center X",
			RING_WAVE_CENTER_X_DEFAULT,
			-4000,
			4000,
			1,
			"layout",
			"field",
			"Field",
		],
		[
			"centerY",
			"Center Y",
			RING_WAVE_CENTER_Y_DEFAULT,
			-4000,
			4000,
			1,
			"layout",
			"field",
			"Field",
		],
		[
			"ringRadius",
			"Ring Radius",
			RING_WAVE_RING_RADIUS_DEFAULT,
			1,
			2000,
			1,
			"layout",
			"field",
			"Field",
		],
		[
			"pulseRadius",
			"Pulse Radius",
			RING_WAVE_PULSE_RADIUS_DEFAULT,
			-400,
			400,
			1,
			"motion",
			"field",
			"Field",
		],
		[
			"driverOrbitRadius",
			"Driver Orbit",
			RING_WAVE_DRIVER_ORBIT_RADIUS_DEFAULT,
			0,
			1000,
			1,
			"layout",
			"field",
			"Field",
		],
		[
			"phaseStepDegrees",
			"Phase Step",
			RING_WAVE_PHASE_STEP_DEGREES_DEFAULT,
			-360,
			360,
			1,
			"timing",
			"field",
			"Field",
		],
		[
			"radialPush",
			"Radial Push",
			RING_WAVE_RADIAL_PUSH_DEFAULT,
			-1000,
			1000,
			1,
			"motion",
			"response",
			"Response",
		],
		[
			"tangentialSlide",
			"Tangential Slide",
			RING_WAVE_TANGENTIAL_SLIDE_DEFAULT,
			-1000,
			1000,
			1,
			"motion",
			"response",
			"Response",
		],
		[
			"falloffDistance",
			"Falloff",
			RING_WAVE_FALLOFF_DISTANCE_DEFAULT,
			1,
			2000,
			1,
			"layout",
			"response",
			"Response",
		],
		[
			"falloffExponent",
			"Falloff Exponent",
			RING_WAVE_FALLOFF_EXPONENT_DEFAULT,
			0.1,
			8,
			0.1,
			"motion",
			"response",
			"Response",
		],
		[
			"minDistance",
			"Minimum Distance",
			RING_WAVE_MIN_DISTANCE_DEFAULT,
			0,
			1000,
			1,
			"layout",
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
			role: role as "timing" | "layout" | "motion" | "look",
			groupId: groupId as string,
			groupLabel: groupLabel as string,
		}),
	),
	outputs: ["translate", "scaleFactor", "opacityFactor"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Interference",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: INTERFERENCE_RING_ROLE },
	recipeRoles: [INTERFERENCE_DRIVER_ROLE, INTERFERENCE_RING_ROLE],
	sample: sampleInterference,
};
