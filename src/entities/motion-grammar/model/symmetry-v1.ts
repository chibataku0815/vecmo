/**
 * Symmetry v1 is a versioned Motion Grammar expression. Existing unmarked
 * bindings retain their legacy evaluator; new bindings opt in through the
 * reserved expression version marker.
 *
 * One pulse drives all paired roles. The left/right sign is derived from the
 * role slot, so callers cannot give mirrored counterparts independent clocks.
 * This file intentionally declares no store, command, renderer, or Inspector
 * integration; it is evidence for the smallest reusable relation only.
 */

import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	ExpressionVector2,
	MotionExpressionDefinition,
} from "./expression-definition";

export const SYMMETRY_MEMBER_ROLE = "member";
export const SYMMETRY_LEFT_OUTER_ROLE = "left-outer";
export const SYMMETRY_RIGHT_OUTER_ROLE = "right-outer";
export const SYMMETRY_LEFT_INNER_ROLE = "left-inner";
export const SYMMETRY_RIGHT_INNER_ROLE = "right-inner";
export const SYMMETRY_CENTER_ROLE = "center";

export const SYMMETRY_V1_OUTPUT_CONTRACT = {
	cameraSpacePolicy: "screen_2d",
	outputTopology: "existing-scene-node-transform-patches",
	channels: ["translate", "scaleFactor", "rotate"],
	bakePolicy: "not-supported",
	surfaces: {
		canvas: "shared-presentation-route",
		svg: "shared-presentation-route",
		pdf: "shared-presentation-route",
		javascriptCodeRuntime: "shared-presentation-route",
		webgl: "shared-presentation-route",
	},
} as const;

const DEFAULT_PERIOD_FRAMES = 96;
const DEFAULT_RISE_FRAMES = 24;
const DEFAULT_HOLD_FRAMES = 24;
const DEFAULT_AXIS: ExpressionVector2 = { x: 1, y: 0 };
const DEFAULT_OUTER_TRANSLATE = 72;
const DEFAULT_INNER_TRANSLATE = 36;
const DEFAULT_OUTER_SCALE_DELTA = 0.25;
const DEFAULT_INNER_SCALE_DELTA = 0.12;
const DEFAULT_CENTER_SCALE_DELTA = 0.18;
const DEFAULT_CENTER_ROTATION_DEGREES = 18;

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(maximum, Math.max(minimum, value));

const wrapFrame = (frame: number, period: number): number => {
	const remainder = frame % period;
	return remainder < 0 ? remainder + period : remainder;
};

const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const axisFrom = (
	parameters: Readonly<Record<string, number>>,
): ExpressionVector2 => {
	const x = finiteOr(parameters.axisX, DEFAULT_AXIS.x);
	const y = finiteOr(parameters.axisY, DEFAULT_AXIS.y);
	const length = Math.hypot(x, y);
	return length > 1e-8 ? { x: x / length, y: y / length } : DEFAULT_AXIS;
};

const pulseAt = (
	frame: number,
	periodFrames: number,
	riseFrames: number,
	holdFrames: number,
): number => {
	const period = Math.max(4, periodFrames);
	const rise = clamp(riseFrames, 1, period - 2);
	const hold = clamp(holdFrames, 0, period - rise - 2);
	const returnFrames = period - rise - hold;
	const localFrame = wrapFrame(frame, period);
	if (localFrame < rise) return smoothstep(localFrame / rise);
	if (localFrame < rise + hold) return 1;
	const returnProgress =
		(localFrame - rise - hold) / Math.max(1, returnFrames - 1);
	return smoothstep(1 - returnProgress);
};

const roleNodeIds = (
	env: ExpressionSampleEnv,
	roleId: string,
): readonly string[] => env.resolvedRoleNodeIds.get(roleId) ?? [];

const appendPair = ({
	emits,
	nodeIds,
	axis,
	sign,
	translateMagnitude,
	scaleDelta,
	pulse,
	seen,
}: {
	readonly emits: ExpressionChannelEmit[];
	readonly nodeIds: readonly string[];
	readonly axis: ExpressionVector2;
	readonly sign: -1 | 1;
	readonly translateMagnitude: number;
	readonly scaleDelta: number;
	readonly pulse: number;
	readonly seen: Set<string>;
}): void => {
	for (const nodeId of nodeIds) {
		if (seen.has(nodeId)) continue;
		seen.add(nodeId);
		emits.push(
			{
				kind: "translate",
				nodeId,
				value: {
					x: axis.x * sign * translateMagnitude * pulse,
					y: axis.y * sign * translateMagnitude * pulse,
				},
			},
			{
				kind: "scaleFactor",
				nodeId,
				value: {
					x: 1 + scaleDelta * pulse,
					y: 1 + scaleDelta * pulse,
				},
			},
		);
	}
};

/** Samples one held pulse into signed pair transforms and a center response. */
const sampleSymmetry = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const periodFrames = Math.max(
		4,
		finiteOr(env.parameters.periodFrames, DEFAULT_PERIOD_FRAMES),
	);
	const riseFrames = finiteOr(env.parameters.riseFrames, DEFAULT_RISE_FRAMES);
	const holdFrames = finiteOr(env.parameters.holdFrames, DEFAULT_HOLD_FRAMES);
	const pulse = pulseAt(env.frame, periodFrames, riseFrames, holdFrames);
	const axis = axisFrom(env.parameters);
	const outerTranslate = finiteOr(
		env.parameters.outerTranslate,
		DEFAULT_OUTER_TRANSLATE,
	);
	const innerTranslate = finiteOr(
		env.parameters.innerTranslate,
		DEFAULT_INNER_TRANSLATE,
	);
	const outerScaleDelta = finiteOr(
		env.parameters.outerScaleDelta,
		DEFAULT_OUTER_SCALE_DELTA,
	);
	const innerScaleDelta = finiteOr(
		env.parameters.innerScaleDelta,
		DEFAULT_INNER_SCALE_DELTA,
	);
	const centerScaleDelta = finiteOr(
		env.parameters.centerScaleDelta,
		DEFAULT_CENTER_SCALE_DELTA,
	);
	const centerRotationDegrees = finiteOr(
		env.parameters.centerRotationDegrees,
		DEFAULT_CENTER_ROTATION_DEGREES,
	);
	const emits: ExpressionChannelEmit[] = [];
	const seen = new Set<string>();
	appendPair({
		emits,
		nodeIds: roleNodeIds(env, SYMMETRY_LEFT_OUTER_ROLE),
		axis,
		sign: -1,
		translateMagnitude: outerTranslate,
		scaleDelta: outerScaleDelta,
		pulse,
		seen,
	});
	appendPair({
		emits,
		nodeIds: roleNodeIds(env, SYMMETRY_RIGHT_OUTER_ROLE),
		axis,
		sign: 1,
		translateMagnitude: outerTranslate,
		scaleDelta: outerScaleDelta,
		pulse,
		seen,
	});
	appendPair({
		emits,
		nodeIds: roleNodeIds(env, SYMMETRY_LEFT_INNER_ROLE),
		axis,
		sign: -1,
		translateMagnitude: innerTranslate,
		scaleDelta: innerScaleDelta,
		pulse,
		seen,
	});
	appendPair({
		emits,
		nodeIds: roleNodeIds(env, SYMMETRY_RIGHT_INNER_ROLE),
		axis,
		sign: 1,
		translateMagnitude: innerTranslate,
		scaleDelta: innerScaleDelta,
		pulse,
		seen,
	});
	for (const nodeId of roleNodeIds(env, SYMMETRY_CENTER_ROLE)) {
		if (seen.has(nodeId)) continue;
		seen.add(nodeId);
		emits.push(
			{
				kind: "scaleFactor",
				nodeId,
				value: {
					x: 1 + centerScaleDelta * pulse,
					y: 1 + centerScaleDelta * pulse,
				},
			},
			{
				kind: "rotate",
				nodeId,
				value: centerRotationDegrees * pulse,
			},
		);
	}
	return emits;
};

/**
 * The version marker preserves legacy bindings while new bindings use this
 * typed role/parameter law through the shared presentation route.
 */
export const SYMMETRY_V1: MotionExpressionDefinition = {
	expressionId: "mirror-symmetric-scale",
	version: 1,
	activation: "versioned",
	source: { origin: "motion-studies", reference: "shared-hold-pulse" },
	label: "Symmetry",
	summary:
		"One held pulse drives signed paired transforms and a center response through a fixed screen-space axis.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Symmetry relation",
		actionLabel: "Create Symmetry relation",
		previewLabel: "Symmetry preview",
		description:
			"Samples existing paired scene roles from one shared pulse; no nodes or duplicate artifacts are created.",
		outputSummary:
			"Signed screen-space translation, uniform scale, and center rotation on existing scene nodes.",
	},
	roles: [
		{
			roleId: SYMMETRY_MEMBER_ROLE,
			aliases: ["mirror-symmetric-scale:member"],
			label: "Member",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: SYMMETRY_LEFT_OUTER_ROLE,
			aliases: ["mirror-symmetric-scale:left-outer"],
			label: "Left outer",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: SYMMETRY_RIGHT_OUTER_ROLE,
			aliases: ["mirror-symmetric-scale:right-outer"],
			label: "Right outer",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: SYMMETRY_LEFT_INNER_ROLE,
			aliases: ["mirror-symmetric-scale:left-inner"],
			label: "Left inner",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: SYMMETRY_RIGHT_INNER_ROLE,
			aliases: ["mirror-symmetric-scale:right-inner"],
			label: "Right inner",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: SYMMETRY_CENTER_ROLE,
			aliases: ["mirror-symmetric-scale:center"],
			label: "Center",
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
			key: "riseFrames",
			label: "Rise",
			default: DEFAULT_RISE_FRAMES,
			min: 1,
			max: 240,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "holdFrames",
			label: "Hold",
			default: DEFAULT_HOLD_FRAMES,
			min: 0,
			max: 240,
			step: 1,
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
			groupLabel: "Mirror axis",
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
			groupLabel: "Mirror axis",
		},
		{
			key: "outerTranslate",
			label: "Outer travel",
			default: DEFAULT_OUTER_TRANSLATE,
			min: -1024,
			max: 1024,
			step: 1,
			role: "motion",
			groupId: "outer",
			groupLabel: "Outer pair",
		},
		{
			key: "innerTranslate",
			label: "Inner travel",
			default: DEFAULT_INNER_TRANSLATE,
			min: -1024,
			max: 1024,
			step: 1,
			role: "motion",
			groupId: "inner",
			groupLabel: "Inner pair",
		},
		{
			key: "outerScaleDelta",
			label: "Outer scale",
			default: DEFAULT_OUTER_SCALE_DELTA,
			min: -0.95,
			max: 4,
			step: 0.01,
			role: "motion",
			groupId: "outer",
			groupLabel: "Outer pair",
		},
		{
			key: "innerScaleDelta",
			label: "Inner scale",
			default: DEFAULT_INNER_SCALE_DELTA,
			min: -0.95,
			max: 4,
			step: 0.01,
			role: "motion",
			groupId: "inner",
			groupLabel: "Inner pair",
		},
		{
			key: "centerScaleDelta",
			label: "Center scale",
			default: DEFAULT_CENTER_SCALE_DELTA,
			min: -0.95,
			max: 4,
			step: 0.01,
			role: "motion",
			groupId: "center",
			groupLabel: "Center",
		},
		{
			key: "centerRotationDegrees",
			label: "Center turn",
			default: DEFAULT_CENTER_ROTATION_DEGREES,
			min: -720,
			max: 720,
			step: 1,
			role: "motion",
			groupId: "center",
			groupLabel: "Center",
		},
	],
	outputs: ["translate", "scaleFactor", "rotate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "not-supported",
		clipLabel: "Symmetry pulse",
		durationParameterKey: "periodFrames",
	},
	roleExpansion: { mode: "per-target", roleId: SYMMETRY_MEMBER_ROLE },
	recipeRoles: [
		SYMMETRY_LEFT_OUTER_ROLE,
		SYMMETRY_RIGHT_OUTER_ROLE,
		SYMMETRY_LEFT_INNER_ROLE,
		SYMMETRY_RIGHT_INNER_ROLE,
		SYMMETRY_CENTER_ROLE,
	],
	sample: sampleSymmetry,
};
