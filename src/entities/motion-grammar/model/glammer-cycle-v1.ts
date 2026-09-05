/**
 * Built-in Glammer Cycle expression (`glammer-cycle-v1`) — the pilot that proves
 * the motion-expression runtime. It declares its roles, params, outputs, timeline
 * policy, and a pure per-frame sampler in ONE place; the Inspector descriptor,
 * timeline clip, runtime sampler, and bake all derive from this declaration.
 *
 * The default binding preserves the legacy circular travel, while a resolved Path
 * role promotes the expression into a closed-lap whip/crawl path law with a
 * shared stroke window and optional tangent orientation.
 */

import {
	CYCLIC_PATH_HEAD_LAG_FRACTION_DEFAULT,
	CYCLIC_PATH_OFFSET_DEFAULT,
	CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT,
	CYCLIC_PATH_ORIENTATION_OFFSET_DEFAULT,
	CYCLIC_PATH_PHASE_OFFSET_DEFAULT,
	CYCLIC_PATH_PHASE_START_FRAME_DEFAULT,
	CYCLIC_PATH_PHASE_STEP_DEFAULT,
	CYCLIC_PATH_RADIUS_DEFAULT,
	CYCLIC_PATH_WHIP_DURATION_DEFAULT,
	CYCLIC_PATH_WHIP_SPAN_FRACTION_DEFAULT,
	CYCLIC_PATH_WINDOW_FRACTION_DEFAULT,
	TIME_DELAY_PERIOD_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	MotionExpressionDefinition,
} from "./expression-definition";

const FULL_TURN_DEGREES = 360;
const TAU = Math.PI * 2;

/** Primary role: moving bodies. Spreads across the binding's ordered targets. */
const CYCLE_BODY_ROLE = "body";
const CYCLE_BODY_ROLE_ALIASES = [
	"cyclic-path-travel:body",
	"cyclic-path-travel:traveler",
] as const;

/** Optional constraint role: a sampled scene path that drives body positions. */
const CYCLE_PATH_ROLE = "path";
const CYCLE_PATH_ROLE_ALIASES = ["cyclic-path-travel:path"] as const;
const CYCLE_HEAD_DOT_ROLE = "head-dot";
const CYCLE_HEAD_DOT_ROLE_ALIASES = ["cyclic-path-travel:head-dot"] as const;

/** Positive modulo so a wrapped frame is always in `[0, period)` (mirrors `wrap`). */
const wrapFrame = (value: number, period: number): number => {
	if (!(period > 0)) return value;
	return ((value % period) + period) % period;
};

const wrapUnit = (value: number): number => ((value % 1) + 1) % 1;

const normalizeDegrees = (value: number): number =>
	((value % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const boolParam = (value: number | undefined, fallback: number): boolean =>
	finiteOr(value, fallback) >= 0.5;

/**
 * Pure sampler. With only body targets it keeps the legacy circular orbit around
 * each body rest point. When a path role resolves to a sampleable scene node, the
 * same binding owns one closed-lap whip/crawl progress: bodies, dash offset, and
 * optional head-dot targets all sample that progress.
 */
const sampleCycle = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const period = finiteOr(
		env.parameters.periodFrames,
		TIME_DELAY_PERIOD_DEFAULT,
	);
	const radius = finiteOr(env.parameters.radius, CYCLIC_PATH_RADIUS_DEFAULT);
	const phaseOffsetDegrees = finiteOr(
		env.parameters.phaseOffsetDegrees,
		CYCLIC_PATH_PHASE_OFFSET_DEFAULT,
	);
	const phaseStepDegrees = finiteOr(
		env.parameters.phaseStepDegrees,
		CYCLIC_PATH_PHASE_STEP_DEFAULT,
	);
	const phaseStep = (phaseStepDegrees * Math.PI) / 180;
	const phaseOffset = (phaseOffsetDegrees * Math.PI) / 180;
	const phaseStartFrame = finiteOr(
		env.parameters.phaseStartFrame,
		CYCLIC_PATH_PHASE_START_FRAME_DEFAULT,
	);
	const whipDurationFrames = Math.max(
		1,
		Math.min(
			Math.max(1, period - 1),
			finiteOr(
				env.parameters.whipDurationFrames,
				CYCLIC_PATH_WHIP_DURATION_DEFAULT,
			),
		),
	);
	const whipSpanFraction = Math.min(
		0.99,
		Math.max(
			0.01,
			finiteOr(
				env.parameters.whipSpanFraction,
				CYCLIC_PATH_WHIP_SPAN_FRACTION_DEFAULT,
			),
		),
	);
	const pathOffsetPx = finiteOr(
		env.parameters.pathOffsetPx,
		CYCLIC_PATH_OFFSET_DEFAULT,
	);
	const orientToTangent = boolParam(
		env.parameters.orientToTangent,
		CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT,
	);
	const orientationOffsetDegrees = finiteOr(
		env.parameters.orientationOffsetDegrees,
		CYCLIC_PATH_ORIENTATION_OFFSET_DEFAULT,
	);
	const headLagFraction = finiteOr(
		env.parameters.headLagFraction,
		CYCLIC_PATH_HEAD_LAG_FRACTION_DEFAULT,
	);
	const localFrame =
		period > 0 ? wrapFrame(env.frame - phaseStartFrame, period) : 0;
	const whipProgress = Math.min(
		1,
		Math.max(0, localFrame / whipDurationFrames),
	);
	const crawlDurationFrames = Math.max(1, period - whipDurationFrames);
	const crawlProgress = Math.min(
		1,
		Math.max(0, (localFrame - whipDurationFrames) / crawlDurationFrames),
	);
	const progress =
		period > 0
			? localFrame <= whipDurationFrames
				? whipSpanFraction * whipProgress
				: whipSpanFraction + (1 - whipSpanFraction) * crawlProgress
			: 0;
	const orbitProgress = period > 0 ? wrapFrame(env.frame, period) / period : 0;
	const nodeIds = env.resolvedRoleNodeIds.get(CYCLE_BODY_ROLE) ?? [];
	const pathNodeId = env.resolvedRoleNodeIds.get(CYCLE_PATH_ROLE)?.[0];
	const headDotNodeIds = env.resolvedRoleNodeIds.get(CYCLE_HEAD_DOT_ROLE) ?? [];
	if (pathNodeId && env.pathSampleAt) {
		const emits: ExpressionChannelEmit[] = [];
		const pathLengthSample = env.pathSampleAt(pathNodeId, 1);
		for (const [index, nodeId] of nodeIds.entries()) {
			const pathProgress = wrapUnit(
				progress +
					(phaseOffsetDegrees + index * phaseStepDegrees) / FULL_TURN_DEGREES,
			);
			const sample = env.pathSampleAt(pathNodeId, pathProgress);
			if (!sample) continue;
			const normal = { x: -sample.tangent.y, y: sample.tangent.x };
			const rest = env.restPointOf?.(nodeId) ?? env.restPositionOf(nodeId);
			emits.push({
				kind: "translate",
				nodeId,
				value: {
					x: sample.point.x + normal.x * pathOffsetPx - rest.x,
					y: sample.point.y + normal.y * pathOffsetPx - rest.y,
				},
			});
			if (orientToTangent) {
				emits.push({
					kind: "rotationOverride",
					nodeId,
					value: normalizeDegrees(
						sample.angleDegrees + orientationOffsetDegrees,
					),
				});
			}
		}
		if (pathLengthSample && Number.isFinite(pathLengthSample.length)) {
			emits.push({
				kind: "strokeDashoffset",
				nodeId: pathNodeId,
				value:
					-(progress + phaseOffsetDegrees / FULL_TURN_DEGREES) *
					pathLengthSample.length,
			});
		}
		const headDotSample = env.pathSampleAt(
			pathNodeId,
			wrapUnit(
				progress + phaseOffsetDegrees / FULL_TURN_DEGREES + headLagFraction,
			),
		);
		if (headDotSample) {
			for (const headDotNodeId of headDotNodeIds) {
				const rest = env.restPositionOf(headDotNodeId);
				emits.push({
					kind: "translate",
					nodeId: headDotNodeId,
					value: {
						x: headDotSample.point.x - rest.x,
						y: headDotSample.point.y - rest.y,
					},
				});
			}
		}
		if (emits.length > 0) return emits;
	}
	return nodeIds.flatMap((nodeId, index) => {
		const baseline = index * phaseStep;
		const theta = orbitProgress * TAU + phaseOffset + baseline;
		const emits: ExpressionChannelEmit[] = [
			{
				kind: "translate" as const,
				nodeId,
				value: {
					x: radius * (Math.cos(theta) - Math.cos(phaseOffset + baseline)),
					y: radius * (Math.sin(theta) - Math.sin(phaseOffset + baseline)),
				},
			},
		];
		if (orientToTangent) {
			emits.push({
				kind: "rotationOverride",
				nodeId,
				value: normalizeDegrees(
					(theta * FULL_TURN_DEGREES) / TAU + 90 + orientationOffsetDegrees,
				),
			});
		}
		return emits;
	});
};

/** The frozen Cycle expression definition. */
export const GLAMMER_CYCLE_V1: MotionExpressionDefinition = {
	expressionId: "cyclic-path-travel",
	version: 1,
	source: {
		origin: "glammer",
		reference: "whip-crawl-path-cycle",
	},
	label: "Cycle",
	summary:
		"A closed path uses one whip/crawl progress for bodies, stroke window, and head dot.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Cycle loop",
		actionLabel: "Create Cycle",
		previewLabel: "Cycle preview",
		description:
			"Drives a closed-lap whip/crawl path from one frame-to-pose expression; no baked keyframes.",
		outputSummary:
			"Path translation, optional tangent rotation, dash offset, and head-dot translation.",
	},
	roles: [
		{
			roleId: CYCLE_BODY_ROLE,
			aliases: CYCLE_BODY_ROLE_ALIASES,
			label: "Body",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: CYCLE_HEAD_DOT_ROLE,
			aliases: CYCLE_HEAD_DOT_ROLE_ALIASES,
			label: "Head dot",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: CYCLE_PATH_ROLE,
			aliases: CYCLE_PATH_ROLE_ALIASES,
			label: "Path",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		{
			key: "periodFrames",
			label: "Period",
			default: TIME_DELAY_PERIOD_DEFAULT,
			min: 1,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "phaseOffsetDegrees",
			label: "Phase Offset",
			default: CYCLIC_PATH_PHASE_OFFSET_DEFAULT,
			min: -360,
			max: 360,
			step: 1,
			role: "motion",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "phaseStartFrame",
			label: "Phase Start",
			default: CYCLIC_PATH_PHASE_START_FRAME_DEFAULT,
			min: 0,
			max: 600,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "whipDurationFrames",
			label: "Whip Duration",
			default: CYCLIC_PATH_WHIP_DURATION_DEFAULT,
			min: 1,
			max: 599,
			step: 1,
			role: "timing",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "whipSpanFraction",
			label: "Whip Span",
			default: CYCLIC_PATH_WHIP_SPAN_FRACTION_DEFAULT,
			min: 0.01,
			max: 0.99,
			step: 0.01,
			role: "motion",
			groupId: "timing",
			groupLabel: "Timing",
		},
		{
			key: "phaseStepDegrees",
			label: "Phase",
			default: CYCLIC_PATH_PHASE_STEP_DEFAULT,
			min: -360,
			max: 360,
			step: 1,
			role: "motion",
			groupId: "layout",
			groupLabel: "Layout",
		},
		{
			key: "pathOffsetPx",
			label: "Path Offset",
			default: CYCLIC_PATH_OFFSET_DEFAULT,
			min: -512,
			max: 512,
			step: 1,
			role: "layout",
			groupId: "layout",
			groupLabel: "Layout",
		},
		{
			key: "radius",
			label: "Radius",
			default: CYCLIC_PATH_RADIUS_DEFAULT,
			min: 0,
			max: 512,
			step: 1,
			role: "layout",
			groupId: "layout",
			groupLabel: "Layout",
		},
		{
			key: "orientToTangent",
			label: "Orient",
			default: CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "motion",
			groupId: "orientation",
			groupLabel: "Orientation",
			options: [
				{ value: 0, label: "Off" },
				{ value: 1, label: "On" },
			],
		},
		{
			key: "orientationOffsetDegrees",
			label: "Orient Offset",
			default: CYCLIC_PATH_ORIENTATION_OFFSET_DEFAULT,
			min: -360,
			max: 360,
			step: 1,
			role: "motion",
			groupId: "orientation",
			groupLabel: "Orientation",
		},
		{
			key: "windowFraction",
			label: "Stroke Window",
			default: CYCLIC_PATH_WINDOW_FRACTION_DEFAULT,
			min: 0.01,
			max: 0.95,
			step: 0.01,
			role: "motion",
			groupId: "path-window",
			groupLabel: "Path Window",
		},
		{
			key: "headLagFraction",
			label: "Head Dot Lag",
			default: CYCLIC_PATH_HEAD_LAG_FRACTION_DEFAULT,
			min: -0.5,
			max: 0.5,
			step: 0.01,
			role: "motion",
			groupId: "path-window",
			groupLabel: "Path Window",
		},
	],
	outputs: ["translate", "rotationOverride", "strokeDashoffset"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "explicit-command",
		clipLabel: "Cycle",
		durationParameterKey: "periodFrames",
	},
	timingTemplates: [
		{
			templateId: "loop.phase-continuity",
			role: "Cycle seam",
			note: "Period and phase controls preserve continuity across the loop boundary.",
			parameterKeys: ["periodFrames", "phaseOffsetDegrees", "phaseStepDegrees"],
		},
	],
	roleExpansion: { mode: "per-target", roleId: CYCLE_BODY_ROLE },
	sample: sampleCycle,
};
