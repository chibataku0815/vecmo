/**
 * Inverse Proportion v1: two editable circle roles remain tangent to one
 * declared anchor while the follower radius is the complement of a driver
 * radius. Derived follower center/scale are presentation-only.
 */

import {
	INVERSE_PROPORTION_ANCHOR_X_DEFAULT,
	INVERSE_PROPORTION_ANCHOR_Y_DEFAULT,
	INVERSE_PROPORTION_AXIS_X_DEFAULT,
	INVERSE_PROPORTION_AXIS_Y_DEFAULT,
	INVERSE_PROPORTION_CLEARANCE_DEFAULT,
	INVERSE_PROPORTION_MODE_DEFAULT,
	INVERSE_PROPORTION_RADIUS_SUM_DEFAULT,
	INVERSE_PROPORTION_STRENGTH_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const INVERSE_PROPORTION_DRIVER_ROLE = "driver";
export const INVERSE_PROPORTION_FOLLOWER_ROLE = "follower";
const DRIVER_ALIASES = ["inverse-proportion-link:driver"] as const;
const FOLLOWER_ALIASES = ["inverse-proportion-link:follower"] as const;

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;
const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const positionOf = (
	env: ExpressionSampleEnv,
	nodeId: string,
): { readonly x: number; readonly y: number } =>
	env.samplePositionAt?.(nodeId, env.frame) ?? env.restPositionOf(nodeId);
const scaleOf = (
	env: ExpressionSampleEnv,
	nodeId: string,
): { readonly x: number; readonly y: number } =>
	env.sampleScaleAt?.(nodeId, env.frame) ?? { x: 1, y: 1 };

const sampleInverseProportion = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const driverId = env.resolvedRoleNodeIds.get(
		INVERSE_PROPORTION_DRIVER_ROLE,
	)?.[0];
	const followerId = env.resolvedRoleNodeIds.get(
		INVERSE_PROPORTION_FOLLOWER_ROLE,
	)?.[0];
	if (!driverId || !followerId || driverId === followerId) return [];
	if (finiteOr(env.parameters.mode, INVERSE_PROPORTION_MODE_DEFAULT) < 0.5)
		return [];
	const response = clamp(
		finiteOr(env.parameters.strength, INVERSE_PROPORTION_STRENGTH_DEFAULT),
		0,
		1,
	);
	if (response <= 0) return [];
	const driverBaseRadius = env.restCircleRadiusOf?.(driverId);
	const followerBaseRadius = env.restCircleRadiusOf?.(followerId);
	if (
		driverBaseRadius === null ||
		driverBaseRadius === undefined ||
		followerBaseRadius === null ||
		followerBaseRadius === undefined
	)
		return [];
	const driverScale = scaleOf(env, driverId);
	const followerScale = scaleOf(env, followerId);
	if (
		Math.abs(driverScale.x - driverScale.y) > 1e-6 ||
		Math.abs(followerScale.x - followerScale.y) > 1e-6 ||
		driverScale.x <= 0 ||
		followerScale.x <= 0
	)
		return [];
	const driverRadius = driverBaseRadius * driverScale.x;
	const followerRadiusAtFrame = followerBaseRadius * followerScale.x;
	const radiusSum = finiteOr(
		env.parameters.radiusSum,
		INVERSE_PROPORTION_RADIUS_SUM_DEFAULT,
	);
	const clearance = Math.max(
		0,
		finiteOr(env.parameters.clearance, INVERSE_PROPORTION_CLEARANCE_DEFAULT),
	);
	const followerRadius = radiusSum - driverRadius;
	if (!(driverRadius > 0) || !(followerRadius > 0) || radiusSum <= clearance)
		return [];
	const axisX = finiteOr(
		env.parameters.axisX,
		INVERSE_PROPORTION_AXIS_X_DEFAULT,
	);
	const axisY = finiteOr(
		env.parameters.axisY,
		INVERSE_PROPORTION_AXIS_Y_DEFAULT,
	);
	const axisLength = Math.hypot(axisX, axisY);
	if (!(axisLength > 1e-8)) return [];
	const axis = { x: axisX / axisLength, y: axisY / axisLength };
	const anchor = {
		x: finiteOr(env.parameters.anchorX, INVERSE_PROPORTION_ANCHOR_X_DEFAULT),
		y: finiteOr(env.parameters.anchorY, INVERSE_PROPORTION_ANCHOR_Y_DEFAULT),
	};
	const clearanceHalf = clearance / 2;
	const driverCenter = {
		x: anchor.x - axis.x * (driverRadius + clearanceHalf),
		y: anchor.y - axis.y * (driverRadius + clearanceHalf),
	};
	const followerCenter = {
		x: anchor.x + axis.x * (followerRadius + clearanceHalf),
		y: anchor.y + axis.y * (followerRadius + clearanceHalf),
	};
	const driverNow = positionOf(env, driverId);
	const followerNow = positionOf(env, followerId);
	const followerScaleFactor = followerRadius / followerRadiusAtFrame;
	return [
		{
			kind: "translate",
			nodeId: driverId,
			value: {
				x: (driverCenter.x - driverNow.x) * response,
				y: (driverCenter.y - driverNow.y) * response,
			},
		},
		{
			kind: "translate",
			nodeId: followerId,
			value: {
				x: (followerCenter.x - followerNow.x) * response,
				y: (followerCenter.y - followerNow.y) * response,
			},
		},
		{
			kind: "scaleFactor",
			nodeId: followerId,
			value: {
				x: 1 + (followerScaleFactor - 1) * response,
				y: 1 + (followerScaleFactor - 1) * response,
			},
		},
	];
};

/** Registered tangent-anchor complement relation. Legacy reciprocal mode remains evaluator-readable. */
export const INVERSE_PROPORTION_V1: MotionExpressionDefinition = {
	expressionId: "inverse-proportion-link",
	version: 1,
	source: { origin: "vecmo", reference: "complement-tangent-pair-v1" },
	label: "Inverse Proportion",
	summary:
		"A driver circle and derived complement follower stay tangent to one editable anchor.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Tangent anchor",
		actionLabel: "Create Inverse Proportion",
		previewLabel: "Preview tangent relation",
		description:
			"Reads circle radii from the shared presentation sampler and derives the follower pose.",
		outputSummary: "Driver/follower translate plus derived follower scale.",
	},
	roles: [
		{
			roleId: INVERSE_PROPORTION_DRIVER_ROLE,
			aliases: DRIVER_ALIASES,
			label: "Driver",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: INVERSE_PROPORTION_FOLLOWER_ROLE,
			aliases: FOLLOWER_ALIASES,
			label: "Follower",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		[
			"mode",
			"Relation Mode",
			INVERSE_PROPORTION_MODE_DEFAULT,
			0,
			1,
			1,
			"motion",
			"relation",
			"Relation",
			[
				{ value: 0, label: "Reciprocal scale (legacy)" },
				{ value: 1, label: "Tangent anchor" },
			],
		],
		[
			"strength",
			"Strength",
			INVERSE_PROPORTION_STRENGTH_DEFAULT,
			0,
			2,
			0.05,
			"motion",
			"relation",
			"Relation",
		],
		[
			"anchorX",
			"Anchor X",
			INVERSE_PROPORTION_ANCHOR_X_DEFAULT,
			-4000,
			4000,
			1,
			"layout",
			"anchor",
			"Anchor",
		],
		[
			"anchorY",
			"Anchor Y",
			INVERSE_PROPORTION_ANCHOR_Y_DEFAULT,
			-4000,
			4000,
			1,
			"layout",
			"anchor",
			"Anchor",
		],
		[
			"axisX",
			"Axis X",
			INVERSE_PROPORTION_AXIS_X_DEFAULT,
			-1,
			1,
			0.01,
			"layout",
			"anchor",
			"Anchor",
		],
		[
			"axisY",
			"Axis Y",
			INVERSE_PROPORTION_AXIS_Y_DEFAULT,
			-1,
			1,
			0.01,
			"layout",
			"anchor",
			"Anchor",
		],
		[
			"radiusSum",
			"Radius Sum",
			INVERSE_PROPORTION_RADIUS_SUM_DEFAULT,
			1,
			4000,
			1,
			"layout",
			"relation",
			"Relation",
		],
		[
			"clearance",
			"Clearance",
			INVERSE_PROPORTION_CLEARANCE_DEFAULT,
			0,
			400,
			1,
			"layout",
			"relation",
			"Relation",
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
			options,
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
			...(options
				? {
						options: options as readonly {
							readonly value: number;
							readonly label: string;
						}[],
					}
				: {}),
		}),
	),
	outputs: ["translate", "scaleFactor"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Inverse Proportion",
	},
	roleExpansion: { mode: "per-target", roleId: INVERSE_PROPORTION_DRIVER_ROLE },
	recipeRoles: [
		INVERSE_PROPORTION_DRIVER_ROLE,
		INVERSE_PROPORTION_FOLLOWER_ROLE,
	],
	sample: sampleInverseProportion,
};
