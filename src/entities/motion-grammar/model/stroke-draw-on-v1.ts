/**
 * Built-in Stroke Draw-On expression (`stroke-draw-on`) — the first
 * motion-expression that drives the `strokeDashoffset` channel. It reveals a
 * dashed stroke progressively from start to end so a hand-drawn Pencil path
 * "draws itself on" over the clip, with no baked keyframes.
 *
 * It fills the pre-wired `strokeDashoffset` slot: the channel already composes
 * additively over the node's static `strokeDashoffset` (`presentation.ts`) and
 * renders in SVG, the runtime player, and the GPU canvas — only an emitter was
 * missing. The authoring command sets `strokeDash = [L, L]` and a static offset
 * of 0 on the node; this expression adds `+L → 0`, so at frame 0 the offset is a
 * full `L` (the dash sits entirely in the gap = hidden) and at the clip end it is
 * 0 (the dash covers the path = fully drawn). Disabling/undoing the binding
 * leaves the static offset 0, i.e. the committed stroke stays fully visible.
 */

import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

/** Single role: the stroke that reveals. Spreads across the binding's targets. */
const DRAW_ON_ROLE = "stroke";

/** Default reveal length (frames) when a binding omits `durationFrames`. */
const DRAW_ON_DURATION_DEFAULT = 30;
const DRAW_ON_DURATION_PARAM = "durationFrames";
/** Dash length (= path arc length) the offset marches across; supplied per binding. */
const DRAW_ON_DASH_LENGTH_PARAM = "dashLength";
/** 0 = draw on (hidden→drawn); 1 = draw off (drawn→hidden). */
const DRAW_ON_REVERSE_PARAM = "reverse";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

/**
 * Pure sampler. `env.frame` is clip-local; `progress` clamps to [0, 1] so the
 * reveal holds fully drawn after the duration instead of looping. The emitted
 * value is the additive offset over the node's static 0: `dashLength · hidden`,
 * where `hidden` runs 1→0 forward (or 0→1 reversed).
 */
const sampleDrawOn = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const duration = Math.max(
		1,
		finiteOr(env.parameters[DRAW_ON_DURATION_PARAM], DRAW_ON_DURATION_DEFAULT),
	);
	const dashLength = Math.max(
		0,
		finiteOr(env.parameters[DRAW_ON_DASH_LENGTH_PARAM], 0),
	);
	const reverse = finiteOr(env.parameters[DRAW_ON_REVERSE_PARAM], 0) !== 0;
	const progress = clamp01(env.frame / duration);
	const hidden = reverse ? progress : 1 - progress;
	const offset = dashLength * hidden;
	const nodeIds = env.resolvedRoleNodeIds.get(DRAW_ON_ROLE) ?? [];
	return nodeIds.map((nodeId) => ({
		kind: "strokeDashoffset" as const,
		nodeId,
		value: offset,
	}));
};

/** The frozen Stroke Draw-On expression definition. */
export const STROKE_DRAW_ON_V1: MotionExpressionDefinition = {
	expressionId: "stroke-draw-on",
	version: 1,
	source: {
		origin: "vecmo",
		reference: "pencil-stroke-draw-on",
	},
	label: "Draw On",
	summary: "The stroke draws itself on from start to end over the clip.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Draw on",
		actionLabel: "Animate draw-on",
		previewLabel: "Draw-on preview",
		description:
			"Reveals a dashed stroke progressively from start to end; no baked keyframes.",
		outputSummary: "Per-target stroke-dashoffset march.",
	},
	roles: [
		{
			roleId: DRAW_ON_ROLE,
			label: "Stroke",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		{
			key: DRAW_ON_DURATION_PARAM,
			label: "Duration",
			default: DRAW_ON_DURATION_DEFAULT,
			min: 1,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: DRAW_ON_REVERSE_PARAM,
			label: "Reverse",
			default: 0,
			min: 0,
			max: 1,
			step: 1,
			role: "motion",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			// Path arc length the offset sweeps. Authored from the measured stroke,
			// not a user knob — kept in the layout group and out of the primary
			// timing controls. Declared (not a bare ride-along param) so the
			// authoring parameter validator always forwards it to the sampler.
			key: DRAW_ON_DASH_LENGTH_PARAM,
			label: "Length",
			default: 0,
			min: 0,
			max: 100000,
			step: 1,
			role: "layout",
			groupId: "layout",
			groupLabel: "Layout",
		},
	],
	outputs: ["strokeDashoffset"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "explicit-command",
		clipLabel: "Draw On",
		durationParameterKey: DRAW_ON_DURATION_PARAM,
	},
	roleExpansion: { mode: "per-target", roleId: DRAW_ON_ROLE },
	sample: sampleDrawOn,
};
