/**
 * Count Growth v1: a durable lattice blueprint breathes open, reveals named
 * groups, and closes without creating or destroying scene members.
 *
 * The sampler is intentionally screen-space. It emits only declarative
 * presentation channels; the scene remains the source of truth for every
 * member's rest geometry and role assignment.
 */

import {
	COUNT_GROWTH_BREATH_HOLD_FRACTION_DEFAULT,
	COUNT_GROWTH_BREATH_OPEN_FRACTION_DEFAULT,
	COUNT_GROWTH_BREATH_RADIUS_SCALE_DEFAULT,
	COUNT_GROWTH_CENTER_OFFSET_X_DEFAULT,
	COUNT_GROWTH_CENTER_OFFSET_Y_DEFAULT,
	COUNT_GROWTH_EDGE_RAIL_AMPLITUDE_DEFAULT,
	COUNT_GROWTH_GROUP_STAGGER_FRAMES_DEFAULT,
	COUNT_GROWTH_GROW_FRAMES_DEFAULT,
	COUNT_GROWTH_OPACITY_FLOOR_DEFAULT,
	COUNT_GROWTH_PERIOD_DEFAULT,
	COUNT_GROWTH_ROTATION_DEGREES_DEFAULT,
	COUNT_GROWTH_SCALE_FLOOR_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

export const COUNT_GROWTH_MEMBER_ROLE = "member";
export const COUNT_GROWTH_CORE_ROLE = "core";
export const COUNT_GROWTH_ARM_ROLE = "arm";
export const COUNT_GROWTH_EDGE_ROLE = "edge";

const COUNT_GROWTH_ROLE_ALIASES = {
	member: ["count-growth:member", "count-growth:item"],
	core: ["count-growth:core"],
	arm: ["count-growth:arm"],
	edge: ["count-growth:edge"],
} as const;

const COUNT_GROWTH_GROUP_ROLES = [
	COUNT_GROWTH_CORE_ROLE,
	COUNT_GROWTH_ARM_ROLE,
	COUNT_GROWTH_EDGE_ROLE,
] as const;

/** Deterministic default group assignment used by Agent and workspace apply. */
export const defaultCountGrowthRoleMap = (
	targetIds: readonly string[],
): Readonly<Record<string, string>> => {
	const roleByIndex = [
		"count-growth:core",
		"count-growth:arm",
		"count-growth:edge",
	] as const;
	return Object.fromEntries(
		targetIds.map((nodeId, index) => [
			nodeId,
			roleByIndex[index] ?? "count-growth:member",
		]),
	);
};

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const wrapFrame = (value: number, period: number): number => {
	if (!(period > 0)) return 0;
	return ((value % period) + period) % period;
};

const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const unique = (values: readonly string[]): readonly string[] => [
	...new Set(values),
];

const roleIds = (env: ExpressionSampleEnv, roleId: string): readonly string[] =>
	env.resolvedRoleNodeIds.get(roleId) ?? [];

const breathAt = (
	frame: number,
	period: number,
	openFraction: number,
	holdFraction: number,
): number => {
	const phase = wrapFrame(frame, period) / period;
	const open = clamp(openFraction, 0.05, 0.7);
	const hold = clamp(holdFraction, 0, 0.7);
	const close = Math.max(0.05, 1 - open - hold);
	const total = open + hold + close;
	const openEnd = open / total;
	const holdEnd = (open + hold) / total;
	if (phase < openEnd) return smoothstep(phase / openEnd);
	if (phase < holdEnd) return 1;
	return smoothstep(1 - (phase - holdEnd) / (1 - holdEnd));
};

const rotate = (
	vector: { readonly x: number; readonly y: number },
	degrees: number,
): { readonly x: number; readonly y: number } => {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return {
		x: vector.x * cosine - vector.y * sine,
		y: vector.x * sine + vector.y * cosine,
	};
};

const sampleCountGrowth = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const period = Math.max(
		1,
		finiteOr(env.parameters.periodFrames, COUNT_GROWTH_PERIOD_DEFAULT),
	);
	const growFrames = Math.max(
		1,
		finiteOr(env.parameters.growFrames, COUNT_GROWTH_GROW_FRAMES_DEFAULT),
	);
	const scaleFloor = clamp(
		finiteOr(env.parameters.scaleFloor, COUNT_GROWTH_SCALE_FLOOR_DEFAULT),
		0.05,
		1,
	);
	const opacityFloor = clamp(
		finiteOr(env.parameters.opacityFloor, COUNT_GROWTH_OPACITY_FLOOR_DEFAULT),
		0,
		1,
	);
	const openFraction = finiteOr(
		env.parameters.breathOpenFraction,
		COUNT_GROWTH_BREATH_OPEN_FRACTION_DEFAULT,
	);
	const holdFraction = finiteOr(
		env.parameters.breathHoldFraction,
		COUNT_GROWTH_BREATH_HOLD_FRACTION_DEFAULT,
	);
	const radiusScale = Math.max(
		1,
		finiteOr(
			env.parameters.breathRadiusScale,
			COUNT_GROWTH_BREATH_RADIUS_SCALE_DEFAULT,
		),
	);
	const centerOffsetX = finiteOr(
		env.parameters.centerOffsetX,
		COUNT_GROWTH_CENTER_OFFSET_X_DEFAULT,
	);
	const centerOffsetY = finiteOr(
		env.parameters.centerOffsetY,
		COUNT_GROWTH_CENTER_OFFSET_Y_DEFAULT,
	);
	const rotationDegrees = finiteOr(
		env.parameters.rotationDegrees,
		COUNT_GROWTH_ROTATION_DEGREES_DEFAULT,
	);
	const edgeRailAmplitude = finiteOr(
		env.parameters.edgeRailAmplitude,
		COUNT_GROWTH_EDGE_RAIL_AMPLITUDE_DEFAULT,
	);
	const groupStaggerFrames = Math.max(
		0,
		finiteOr(
			env.parameters.groupStaggerFrames,
			COUNT_GROWTH_GROUP_STAGGER_FRAMES_DEFAULT,
		),
	);

	const explicitGroups = COUNT_GROWTH_GROUP_ROLES.flatMap((roleId) => {
		const ids = roleIds(env, roleId);
		return ids.length > 0 ? [{ roleId, ids }] : [];
	});
	const memberIds = roleIds(env, COUNT_GROWTH_MEMBER_ROLE);
	const allNodeIds = unique([
		...explicitGroups.flatMap((group) => group.ids),
		...memberIds,
	]);
	if (allNodeIds.length === 0) return [];

	const groups =
		explicitGroups.length > 0
			? [
					...explicitGroups,
					...(memberIds.length > 0
						? [{ roleId: COUNT_GROWTH_MEMBER_ROLE, ids: memberIds }]
						: []),
				]
			: COUNT_GROWTH_GROUP_ROLES.map((roleId, groupIndex) => ({
					roleId,
					ids: allNodeIds.filter(
						(_nodeId, index) =>
							index % COUNT_GROWTH_GROUP_ROLES.length === groupIndex,
					),
				}));

	const center = allNodeIds.reduce(
		(sum, nodeId) => {
			const point = env.restPointOf?.(nodeId) ?? env.restPositionOf(nodeId);
			return { x: sum.x + point.x, y: sum.y + point.y };
		},
		{ x: 0, y: 0 },
	);
	center.x /= allNodeIds.length;
	center.y /= allNodeIds.length;
	center.x += centerOffsetX;
	center.y += centerOffsetY;

	const masterBreath = breathAt(env.frame, period, openFraction, holdFraction);
	const emits: ExpressionChannelEmit[] = [];
	for (const [groupIndex, group] of groups.entries()) {
		const groupBreath = breathAt(
			env.frame - groupIndex * groupStaggerFrames,
			period,
			openFraction,
			holdFraction,
		);
		const visible = smoothstep(
			Math.min(1, (groupBreath * period) / growFrames),
		);
		const rotation = rotationDegrees * masterBreath;
		for (const [nodeIndex, nodeId] of group.ids.entries()) {
			const rest = env.restPointOf?.(nodeId) ?? env.restPositionOf(nodeId);
			const delta = { x: rest.x - center.x, y: rest.y - center.y };
			const length = Math.hypot(delta.x, delta.y);
			const radial =
				length > 0.001
					? delta
					: {
							x: Math.cos(
								(nodeIndex / Math.max(1, group.ids.length)) * Math.PI * 2,
							),
							y: Math.sin(
								(nodeIndex / Math.max(1, group.ids.length)) * Math.PI * 2,
							),
						};
			const posed = rotate(
				{
					x: radial.x * (1 + (radiusScale - 1) * masterBreath),
					y: radial.y * (1 + (radiusScale - 1) * masterBreath),
				},
				rotation,
			);
			const rail =
				group.roleId === COUNT_GROWTH_EDGE_ROLE
					? edgeRailAmplitude * Math.sin(masterBreath * Math.PI) * groupBreath
					: 0;
			const lengthForRail = Math.max(length, 0.001);
			const tangent = {
				x: -delta.y / lengthForRail,
				y: delta.x / lengthForRail,
			};
			emits.push(
				{
					kind: "translate",
					nodeId,
					value: {
						x: center.x + posed.x + tangent.x * rail - rest.x,
						y: center.y + posed.y + tangent.y * rail - rest.y,
					},
				},
				{
					kind: "scaleFactor",
					nodeId,
					value: {
						x: scaleFloor + (1 - scaleFloor) * visible,
						y: scaleFloor + (1 - scaleFloor) * visible,
					},
				},
				{
					kind: "opacityFactor",
					nodeId,
					value: opacityFloor + (1 - opacityFloor) * visible,
				},
				{ kind: "rotate", nodeId, value: rotation },
			);
		}
	}
	return emits;
};

/** The registered Count Growth expression definition. */
export const COUNT_GROWTH_V1: MotionExpressionDefinition = {
	expressionId: "count-growth",
	version: 1,
	source: { origin: "glammer", reference: "count-growth-lattice-breath" },
	label: "Count Growth",
	summary:
		"A durable lattice breathes open while named groups reveal in sequence, then closes without creating members.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Count Growth loop",
		actionLabel: "Create Count Growth",
		previewLabel: "Count Growth preview",
		description:
			"Samples one screen-space lattice breath from a stable scene blueprint; no runtime nodes are created.",
		outputSummary:
			"Radial translation, shared rotation, group-local scale, and opacity presentation.",
	},
	roles: [
		{
			roleId: COUNT_GROWTH_MEMBER_ROLE,
			aliases: COUNT_GROWTH_ROLE_ALIASES.member,
			label: "Member",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		...COUNT_GROWTH_GROUP_ROLES.map((roleId) => ({
			roleId,
			aliases: COUNT_GROWTH_ROLE_ALIASES[roleId],
			label: roleId[0].toUpperCase() + roleId.slice(1),
			kind: "scene-node" as const,
			editable: true,
			replaceable: true,
		})),
	],
	params: [
		{
			key: "periodFrames",
			label: "Period",
			default: COUNT_GROWTH_PERIOD_DEFAULT,
			min: 1,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "growFrames",
			label: "Grow",
			default: COUNT_GROWTH_GROW_FRAMES_DEFAULT,
			min: 1,
			max: 120,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "breathOpenFraction",
			label: "Open",
			default: COUNT_GROWTH_BREATH_OPEN_FRACTION_DEFAULT,
			min: 0.05,
			max: 0.7,
			step: 0.01,
			role: "timing",
			groupId: "breath",
			groupLabel: "Breath",
		},
		{
			key: "breathHoldFraction",
			label: "Hold",
			default: COUNT_GROWTH_BREATH_HOLD_FRACTION_DEFAULT,
			min: 0,
			max: 0.7,
			step: 0.01,
			role: "timing",
			groupId: "breath",
			groupLabel: "Breath",
		},
		{
			key: "breathRadiusScale",
			label: "Radius",
			default: COUNT_GROWTH_BREATH_RADIUS_SCALE_DEFAULT,
			min: 1,
			max: 3,
			step: 0.05,
			role: "layout",
			groupId: "breath",
			groupLabel: "Breath",
		},
		{
			key: "centerOffsetX",
			label: "Center X",
			default: COUNT_GROWTH_CENTER_OFFSET_X_DEFAULT,
			min: -1024,
			max: 1024,
			step: 1,
			role: "layout",
			groupId: "breath",
			groupLabel: "Breath",
		},
		{
			key: "centerOffsetY",
			label: "Center Y",
			default: COUNT_GROWTH_CENTER_OFFSET_Y_DEFAULT,
			min: -1024,
			max: 1024,
			step: 1,
			role: "layout",
			groupId: "breath",
			groupLabel: "Breath",
		},
		{
			key: "rotationDegrees",
			label: "Turn",
			default: COUNT_GROWTH_ROTATION_DEGREES_DEFAULT,
			min: -720,
			max: 720,
			step: 1,
			role: "motion",
			groupId: "breath",
			groupLabel: "Breath",
		},
		{
			key: "edgeRailAmplitude",
			label: "Edge Rail",
			default: COUNT_GROWTH_EDGE_RAIL_AMPLITUDE_DEFAULT,
			min: -256,
			max: 256,
			step: 1,
			role: "motion",
			groupId: "rails",
			groupLabel: "Rails",
		},
		{
			key: "groupStaggerFrames",
			label: "Stagger",
			default: COUNT_GROWTH_GROUP_STAGGER_FRAMES_DEFAULT,
			min: 0,
			max: 60,
			step: 1,
			role: "timing",
			groupId: "groups",
			groupLabel: "Groups",
		},
		{
			key: "scaleFloor",
			label: "Size",
			default: COUNT_GROWTH_SCALE_FLOOR_DEFAULT,
			min: 0.05,
			max: 1,
			step: 0.05,
			role: "motion",
			groupId: "groups",
			groupLabel: "Groups",
		},
		{
			key: "opacityFloor",
			label: "Floor",
			default: COUNT_GROWTH_OPACITY_FLOOR_DEFAULT,
			min: 0,
			max: 1,
			step: 0.05,
			role: "look",
			groupId: "groups",
			groupLabel: "Groups",
		},
	],
	outputs: ["translate", "rotate", "scaleFactor", "opacityFactor"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Count Growth",
		durationParameterKey: "periodFrames",
	},
	timingTemplates: [
		{
			templateId: "loop.phase-continuity",
			role: "Lattice breath seam",
			note: "The master open/hold/close envelope returns to a closed lattice at the loop boundary.",
			parameterKeys: [
				"periodFrames",
				"breathOpenFraction",
				"breathHoldFraction",
			],
		},
	],
	roleExpansion: { mode: "per-target", roleId: COUNT_GROWTH_MEMBER_ROLE },
	recipeRoles: [COUNT_GROWTH_MEMBER_ROLE, ...COUNT_GROWTH_GROUP_ROLES],
	sample: sampleCountGrowth,
};
