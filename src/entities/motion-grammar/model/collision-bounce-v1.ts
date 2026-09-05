/**
 * Built-in Collision Bounce expression (`collision-bounce`) — the canonical
 * support-anchored bounce verb (`docs/knowledge/bounce-canonical-representation.md`,
 * aesthetic laws in `docs/knowledge/bounce-motion-authorship.md`). It samples a
 * ballistic beat schedule (built in `ballistic-bounce.ts`) into `translate`,
 * `scaleFactor`, and `rotate` with no baked keyframes; the explicit bake to
 * sparse beat-anchored tracks is a separate Wave-2 emitter (not this file).
 *
 * Two roles: `subject` (per-target, the bouncing body) and an optional shared
 * `support` (the collision receiver), mirroring Cycle's `body`/`path` split.
 * `supportMode: floor-line` needs no role at all; `supportMode:
 * radial-from-support` requires `support` to resolve — sample() emits nothing
 * rather than guessing a support position when it does not (mirrors
 * `sampleNoiseWipe`'s "emit nothing rather than fabricate" precedent in
 * `evaluator.ts`; `sample()`'s frozen return type has no status/reason channel
 * to report why).
 */

import {
	AUTHORING_MODE_PHYSICS_FIRST,
	type BounceExpressiveParams,
	deformationEnvelopeAt,
	normalDistanceAt,
	type PerTargetPhraseParams,
	perTargetPhrase,
	resolveDurationFirstTotalFrames,
	restAnchorDistancePx,
	SETTLE_RETURN_MODE_RETURN_TO_REST,
	SUPPORT_MODE_RADIAL_FROM_SUPPORT,
	solveBeatScheduleDurationFirst,
	solveBeatSchedulePhysicsFirst,
} from "./ballistic-bounce";
import {
	COLLISION_BOUNCE_ANTICIPATION_FRAMES_DEFAULT,
	COLLISION_BOUNCE_ANTICIPATION_LIFT_PX_DEFAULT,
	COLLISION_BOUNCE_AREA_COMPENSATION_DEFAULT,
	COLLISION_BOUNCE_AUTHORING_MODE_DEFAULT,
	COLLISION_BOUNCE_BOUNCES_DEFAULT,
	COLLISION_BOUNCE_BOUNCINESS_DEFAULT,
	COLLISION_BOUNCE_CONTACT_HOLD_FRAMES_DEFAULT,
	COLLISION_BOUNCE_CONTACT_OFFSET_PX_DEFAULT,
	COLLISION_BOUNCE_CONTACT_SQUASH_DEFAULT,
	COLLISION_BOUNCE_DROP_HEIGHT_PX_DEFAULT,
	COLLISION_BOUNCE_ENERGY_FALLOFF_DEFAULT,
	COLLISION_BOUNCE_FLOOR_OFFSET_PX_DEFAULT,
	COLLISION_BOUNCE_FRONT_SPEED_SHAPE_DEFAULT,
	COLLISION_BOUNCE_GRAVITY_PX_PER_FRAME2_DEFAULT,
	COLLISION_BOUNCE_INITIAL_VELOCITY_PX_DEFAULT,
	COLLISION_BOUNCE_LAUNCH_GAIN_DEFAULT,
	COLLISION_BOUNCE_PHASE_STEP_FRAMES_DEFAULT,
	COLLISION_BOUNCE_POST_STRETCH_DEFAULT,
	COLLISION_BOUNCE_SETTLE_BUDGET_MODE_DEFAULT,
	COLLISION_BOUNCE_SETTLE_RETURN_MODE_DEFAULT,
	COLLISION_BOUNCE_STOP_THRESHOLD_PX_DEFAULT,
	COLLISION_BOUNCE_STRETCH_VELOCITY_LINK_DEFAULT,
	COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT,
	COLLISION_BOUNCE_SUPPORT_PIN_MODE_DEFAULT,
	COLLISION_BOUNCE_TOTAL_DURATION_FRAMES_DEFAULT,
	COLLISION_BOUNCE_TRAVEL_AXIS_DEGREES_DEFAULT,
} from "./catalog";
import type {
	ExpressionChannelEmit,
	ExpressionSampleEnv,
	ExpressionVector2,
	MotionExpressionDefinition,
} from "./expression-definition";

/**
 * Primary role: the bouncing body. Spreads across the binding's ordered
 * targets. Exported so `collision-bounce-bake.ts` resolves the identical
 * role/axis/phrase math as this live sampler (single source, per
 * `bounce-canonical-representation.md`'s architecture recommendation item 5).
 */
export const COLLISION_BOUNCE_SUBJECT_ROLE = "subject";
/** Optional shared role: the collision receiver, required only by `supportMode: radial-from-support`. */
export const COLLISION_BOUNCE_SUPPORT_ROLE = "support";

/** "Up" in this codebase's screen-space atan2 convention (+Y down); the default floor-line axis resolves here. */
export const REFERENCE_UP_DEGREES = -90;

export const finiteOr = (
	value: number | undefined,
	fallback: number,
): number => (Number.isFinite(value) ? (value as number) : fallback);

export const degrees = (radians: number): number => (radians * 180) / Math.PI;
const radians = (angleDegrees: number): number =>
	(angleDegrees * Math.PI) / 180;

/** Wraps to `(-180, 180]`, mirroring `evaluator.ts`'s `normalizeDegrees` (duplicated locally; this module takes no cross-technique imports). */
export const normalizeDegrees = (value: number): number => {
	const wrapped = (((value + 180) % 360) + 360) % 360;
	return wrapped - 180;
};

const vectorLength = (vector: ExpressionVector2): number =>
	Math.hypot(vector.x, vector.y);

const normalizeVector = (vector: ExpressionVector2): ExpressionVector2 => {
	const length = vectorLength(vector);
	return length > 0
		? { x: vector.x / length, y: vector.y / length }
		: { x: 0, y: -1 };
};

/**
 * The collision-normal direction, pointing from the support toward the resting
 * subject (authorship doc's literal `n`). Floor-line derives it from
 * `travelAxisDegrees` (read as the fall/gravity direction, so the default 90°
 * = down gives an "away from support" of up, `REFERENCE_UP_DEGREES`); radial
 * derives it per-target from `normalize(targetRest - supportCenter)` exactly
 * per the doc's formula.
 */
export type ResolvedAxis = {
	readonly awayFromSupport: ExpressionVector2;
	readonly initialHeightPx: number;
};

export const floorLineAxis = ({
	rest,
	travelAxisDegrees,
	floorOffsetPx,
}: {
	readonly rest: ExpressionVector2;
	readonly travelAxisDegrees: number;
	readonly floorOffsetPx: number;
}): ResolvedAxis => {
	const fallRadians = radians(travelAxisDegrees);
	const awayFromSupport = {
		x: -Math.cos(fallRadians),
		y: -Math.sin(fallRadians),
	};
	const restAxisCoordinate =
		rest.x * awayFromSupport.x + rest.y * awayFromSupport.y;
	const initialHeightPx = Math.abs(restAxisCoordinate - floorOffsetPx);
	return { awayFromSupport, initialHeightPx };
};

export const radialAxis = ({
	rest,
	supportCenter,
}: {
	readonly rest: ExpressionVector2;
	readonly supportCenter: ExpressionVector2;
}): ResolvedAxis => {
	const offset = { x: rest.x - supportCenter.x, y: rest.y - supportCenter.y };
	return {
		awayFromSupport: normalizeVector(offset),
		initialHeightPx: vectorLength(offset),
	};
};

/** Screen-space clockwise order around the subject-set centroid (doc §5.3: order by angle, never node id). */
export const wavefrontOrderedSubjectIds = (
	subjectIds: readonly string[],
	env: ExpressionSampleEnv,
): readonly string[] => {
	const positions = subjectIds.map((nodeId) => env.restPositionOf(nodeId));
	const count = positions.length;
	if (count === 0) return subjectIds;
	const center = positions.reduce(
		(sum, position) => ({
			x: sum.x + position.x / count,
			y: sum.y + position.y / count,
		}),
		{ x: 0, y: 0 },
	);
	return subjectIds
		.map((nodeId, index) => ({
			nodeId,
			angle: Math.atan2(
				(positions[index]?.y ?? center.y) - center.y,
				(positions[index]?.x ?? center.x) - center.x,
			),
		}))
		.sort((left, right) => left.angle - right.angle)
		.map((entry) => entry.nodeId);
};

export const expressiveParamsFrom = (
	parameters: Readonly<Record<string, number>>,
): BounceExpressiveParams => ({
	anticipationLiftPx: finiteOr(
		parameters.anticipationLiftPx,
		COLLISION_BOUNCE_ANTICIPATION_LIFT_PX_DEFAULT,
	),
	contactSquash: finiteOr(
		parameters.contactSquash,
		COLLISION_BOUNCE_CONTACT_SQUASH_DEFAULT,
	),
	postStretch: finiteOr(
		parameters.postStretch,
		COLLISION_BOUNCE_POST_STRETCH_DEFAULT,
	),
	stretchVelocityLink: finiteOr(
		parameters.stretchVelocityLink,
		COLLISION_BOUNCE_STRETCH_VELOCITY_LINK_DEFAULT,
	),
	areaCompensation: finiteOr(
		parameters.areaCompensation,
		COLLISION_BOUNCE_AREA_COMPENSATION_DEFAULT,
	),
	supportPinMode: finiteOr(
		parameters.supportPinMode,
		COLLISION_BOUNCE_SUPPORT_PIN_MODE_DEFAULT,
	),
});

export const phraseParamsFrom = (
	parameters: Readonly<Record<string, number>>,
): PerTargetPhraseParams => ({
	phaseStepFrames: finiteOr(
		parameters.phaseStepFrames,
		COLLISION_BOUNCE_PHASE_STEP_FRAMES_DEFAULT,
	),
	frontSpeedShape: finiteOr(
		parameters.frontSpeedShape,
		COLLISION_BOUNCE_FRONT_SPEED_SHAPE_DEFAULT,
	),
	energyFalloff: finiteOr(
		parameters.energyFalloff,
		COLLISION_BOUNCE_ENERGY_FALLOFF_DEFAULT,
	),
	settleBudgetMode: finiteOr(
		parameters.settleBudgetMode,
		COLLISION_BOUNCE_SETTLE_BUDGET_MODE_DEFAULT,
	),
});

/**
 * Pure sampler. Resolves the wavefront-ordered subject list and the shared
 * axis policy once, then per target: phrases the complete local bounce phrase
 * (doc §5 full-phrase clock law — every target owns start offset, energy
 * scale, AND settle span, not only a delayed contact key), solves that
 * target's beat schedule under the authoritative authoring-mode group, and
 * composes translate/scaleFactor/rotate from the shared ballistic-bounce math.
 * `authoringMode` selects which parameter group is authoritative for duration
 * (binding design decision, doc open question 6): physics-first derives an
 * absolute schedule from `dropHeightPx`/gravity and holds terminal rest beyond
 * it regardless of what `totalDurationFrames` says; sample() never writes
 * parameters back (frozen contract).
 */
const sampleCollisionBounce = (
	env: ExpressionSampleEnv,
): readonly ExpressionChannelEmit[] => {
	const subjectIds =
		env.resolvedRoleNodeIds.get(COLLISION_BOUNCE_SUBJECT_ROLE) ?? [];
	if (subjectIds.length === 0) return [];

	const supportMode = finiteOr(
		env.parameters.supportMode,
		COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT,
	);
	const usesRadialSupport = supportMode >= SUPPORT_MODE_RADIAL_FROM_SUPPORT;
	const supportNodeId = env.resolvedRoleNodeIds.get(
		COLLISION_BOUNCE_SUPPORT_ROLE,
	)?.[0];
	if (usesRadialSupport && !supportNodeId) return [];
	const supportCenter = supportNodeId
		? env.restPositionOf(supportNodeId)
		: undefined;
	if (usesRadialSupport && !supportCenter) return [];

	const authoringMode = finiteOr(
		env.parameters.authoringMode,
		COLLISION_BOUNCE_AUTHORING_MODE_DEFAULT,
	);
	const isPhysicsFirst = authoringMode >= AUTHORING_MODE_PHYSICS_FIRST;
	const travelAxisDegrees = finiteOr(
		env.parameters.travelAxisDegrees,
		COLLISION_BOUNCE_TRAVEL_AXIS_DEGREES_DEFAULT,
	);
	const floorOffsetPx = finiteOr(
		env.parameters.floorOffsetPx,
		COLLISION_BOUNCE_FLOOR_OFFSET_PX_DEFAULT,
	);
	const bounciness = finiteOr(
		env.parameters.bounciness,
		COLLISION_BOUNCE_BOUNCINESS_DEFAULT,
	);
	const anticipationFrames = finiteOr(
		env.parameters.anticipationFrames,
		COLLISION_BOUNCE_ANTICIPATION_FRAMES_DEFAULT,
	);
	const launchGain = finiteOr(
		env.parameters.launchGain,
		COLLISION_BOUNCE_LAUNCH_GAIN_DEFAULT,
	);
	const expressiveParams = expressiveParamsFrom(env.parameters);
	const phraseParams = phraseParamsFrom(env.parameters);
	const settleReturnMode = finiteOr(
		env.parameters.settleReturnMode,
		COLLISION_BOUNCE_SETTLE_RETURN_MODE_DEFAULT,
	);
	const isReturnToRest = settleReturnMode >= SETTLE_RETURN_MODE_RETURN_TO_REST;
	const contactOffsetPx = Math.max(
		0,
		finiteOr(
			env.parameters.contactOffsetPx,
			COLLISION_BOUNCE_CONTACT_OFFSET_PX_DEFAULT,
		),
	);

	const orderedSubjectIds = wavefrontOrderedSubjectIds(subjectIds, env);
	const emits: ExpressionChannelEmit[] = [];

	orderedSubjectIds.forEach((nodeId, index) => {
		const rest = env.restPositionOf(nodeId);
		const axis =
			usesRadialSupport && supportCenter
				? radialAxis({ rest, supportCenter })
				: floorLineAxis({ rest, travelAxisDegrees, floorOffsetPx });

		const phrase = perTargetPhrase(
			index,
			orderedSubjectIds.length,
			phraseParams,
		);
		const localFrame = env.frame - phrase.startOffsetFrames;
		// `restDistancePx` (d_rest): authored rest distance from the CONTACT
		// PLANE, net of `contactOffsetPx`. When `contactOffsetPx=0` this equals
		// `axis.initialHeightPx` exactly, so `excursionHeightPx` below reduces to
		// today's `scaledHeightPx` formula byte-for-byte in on-support mode.
		const restDistancePx = Math.max(0, axis.initialHeightPx - contactOffsetPx);
		const scaledRestDistancePx = restDistancePx * phrase.energyScale;
		// H0 (the schedule's excursion baseline): on-support keeps today's pure
		// geometric fall height; return-to-rest folds `anticipationLiftPx`
		// permanently in (`H0 = d_rest + anticipationLiftPx`, arbitrated design —
		// geometry always wins the excursion, lift itself is NOT energy-scaled,
		// matching how `anticipationDistance`'s v1 bump already bypasses
		// `phrase.energyScale`).
		const excursionHeightPx = isReturnToRest
			? scaledRestDistancePx + expressiveParams.anticipationLiftPx
			: scaledRestDistancePx;

		const schedule = isPhysicsFirst
			? solveBeatSchedulePhysicsFirst({
					// Return-to-rest: geometry always wins the excursion — physics-first
					// contributes only timing off the SAME `excursionHeightPx` geometric
					// H0, `dropHeightPx` is a mode-0(on-support)-only parameter.
					dropHeightPx: isReturnToRest
						? excursionHeightPx
						: finiteOr(
								env.parameters.dropHeightPx,
								COLLISION_BOUNCE_DROP_HEIGHT_PX_DEFAULT,
							) * phrase.energyScale,
					gravityPxPerFrame2: finiteOr(
						env.parameters.gravityPxPerFrame2,
						COLLISION_BOUNCE_GRAVITY_PX_PER_FRAME2_DEFAULT,
					),
					initialVelocityPx: finiteOr(
						env.parameters.initialVelocityPx,
						COLLISION_BOUNCE_INITIAL_VELOCITY_PX_DEFAULT,
					),
					bounciness,
					stopThresholdPx: finiteOr(
						env.parameters.stopThresholdPx,
						COLLISION_BOUNCE_STOP_THRESHOLD_PX_DEFAULT,
					),
					anticipationFrames,
					launchGain,
					settleReturnMode,
					restDistancePx,
				})
			: solveBeatScheduleDurationFirst({
					totalDurationFrames: resolveDurationFirstTotalFrames({
						totalDurationFrames: finiteOr(
							env.parameters.totalDurationFrames,
							COLLISION_BOUNCE_TOTAL_DURATION_FRAMES_DEFAULT,
						),
						startOffsetFrames: phrase.startOffsetFrames,
						settleBudgetMode: phraseParams.settleBudgetMode,
						expressiveParams,
					}),
					bounces: finiteOr(
						env.parameters.bounces,
						COLLISION_BOUNCE_BOUNCES_DEFAULT,
					),
					bounciness,
					anticipationFrames,
					contactHoldFrames: finiteOr(
						env.parameters.contactHoldFrames,
						COLLISION_BOUNCE_CONTACT_HOLD_FRAMES_DEFAULT,
					),
					launchGain,
					initialHeightPx: excursionHeightPx,
					settleReturnMode,
					restDistancePx,
				});

		const distance = normalDistanceAt(schedule, localFrame, expressiveParams);
		const deformation = deformationEnvelopeAt(
			schedule,
			localFrame,
			expressiveParams,
		);
		const displacement = distance - restAnchorDistancePx(schedule);

		emits.push({
			kind: "translate",
			nodeId,
			value: {
				x: axis.awayFromSupport.x * displacement,
				y: axis.awayFromSupport.y * displacement,
			},
		});
		emits.push({
			kind: "scaleFactor",
			nodeId,
			value: { x: deformation.scaleAcross, y: deformation.scaleAlong },
		});
		const axisAngleDegrees = degrees(
			Math.atan2(axis.awayFromSupport.y, axis.awayFromSupport.x),
		);
		emits.push({
			kind: "rotate",
			nodeId,
			value: normalizeDegrees(axisAngleDegrees - REFERENCE_UP_DEGREES),
		});
	});

	return emits;
};

const COLLISION_BOUNCE_TIMING_GROUP = {
	groupId: "timing",
	groupLabel: "Timing",
};
const COLLISION_BOUNCE_PHYSICS_GROUP = {
	groupId: "physics",
	groupLabel: "Physics",
};
const COLLISION_BOUNCE_SUPPORT_GROUP = {
	groupId: "support",
	groupLabel: "Support",
};
const COLLISION_BOUNCE_DEFORMATION_GROUP = {
	groupId: "deformation",
	groupLabel: "Deformation",
};
const COLLISION_BOUNCE_PROPAGATION_GROUP = {
	groupId: "propagation",
	groupLabel: "Propagation",
};

/** The frozen Collision Bounce expression definition. */
export const COLLISION_BOUNCE_V1: MotionExpressionDefinition = {
	expressionId: "collision-bounce",
	version: 1,
	source: {
		origin: "vecmo",
		reference: "bounce-canonical-representation",
	},
	label: "Collision Bounce",
	summary:
		"A moving body meets a support, reverses velocity, and settles through a decaying restitution series.",
	kind: "master-instances",
	expansion: {
		mode: "live-only",
		label: "Collision bounce",
		actionLabel: "Create Collision Bounce",
		previewLabel: "Bounce preview",
		description:
			"Drives a support-anchored ballistic bounce with velocity-linked squash/stretch; no baked keyframes.",
		outputSummary: "Per-target translate, scaleFactor, and rotate.",
	},
	roles: [
		{
			roleId: COLLISION_BOUNCE_SUBJECT_ROLE,
			label: "Subject",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
		{
			roleId: COLLISION_BOUNCE_SUPPORT_ROLE,
			label: "Support",
			kind: "scene-node",
			editable: true,
			replaceable: true,
		},
	],
	params: [
		{
			key: "authoringMode",
			label: "Authoring Mode",
			default: COLLISION_BOUNCE_AUTHORING_MODE_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "motion",
			...COLLISION_BOUNCE_TIMING_GROUP,
			options: [
				{ value: 0, label: "Duration-first" },
				{ value: 1, label: "Physics-first" },
			],
		},
		{
			key: "totalDurationFrames",
			label: "Duration",
			default: COLLISION_BOUNCE_TOTAL_DURATION_FRAMES_DEFAULT,
			min: 6,
			max: 600,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_TIMING_GROUP,
		},
		{
			key: "bounces",
			label: "Bounces",
			default: COLLISION_BOUNCE_BOUNCES_DEFAULT,
			min: 1,
			max: 12,
			step: 1,
			role: "motion",
			...COLLISION_BOUNCE_TIMING_GROUP,
		},
		{
			key: "bounciness",
			label: "Bounciness",
			default: COLLISION_BOUNCE_BOUNCINESS_DEFAULT,
			min: 0.05,
			max: 0.95,
			step: 0.01,
			role: "motion",
			...COLLISION_BOUNCE_TIMING_GROUP,
		},
		{
			key: "contactHoldFrames",
			label: "Contact Hold",
			default: COLLISION_BOUNCE_CONTACT_HOLD_FRAMES_DEFAULT,
			min: 0,
			max: 8,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_TIMING_GROUP,
		},
		{
			key: "dropHeightPx",
			label: "Drop Height",
			default: COLLISION_BOUNCE_DROP_HEIGHT_PX_DEFAULT,
			min: 1,
			max: 4000,
			step: 1,
			role: "layout",
			...COLLISION_BOUNCE_PHYSICS_GROUP,
		},
		{
			key: "gravityPxPerFrame2",
			label: "Gravity",
			default: COLLISION_BOUNCE_GRAVITY_PX_PER_FRAME2_DEFAULT,
			min: 0.05,
			max: 80,
			step: 0.01,
			role: "motion",
			...COLLISION_BOUNCE_PHYSICS_GROUP,
		},
		{
			key: "initialVelocityPx",
			label: "Initial Velocity",
			default: COLLISION_BOUNCE_INITIAL_VELOCITY_PX_DEFAULT,
			min: -400,
			max: 400,
			step: 1,
			role: "motion",
			...COLLISION_BOUNCE_PHYSICS_GROUP,
		},
		{
			key: "stopThresholdPx",
			label: "Stop Threshold",
			default: COLLISION_BOUNCE_STOP_THRESHOLD_PX_DEFAULT,
			min: 0.5,
			max: 50,
			step: 0.5,
			role: "motion",
			...COLLISION_BOUNCE_PHYSICS_GROUP,
		},
		{
			key: "travelAxisDegrees",
			label: "Travel Axis",
			default: COLLISION_BOUNCE_TRAVEL_AXIS_DEGREES_DEFAULT,
			min: -180,
			max: 180,
			step: 1,
			role: "layout",
			...COLLISION_BOUNCE_SUPPORT_GROUP,
		},
		{
			key: "supportMode",
			label: "Support",
			default: COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "layout",
			...COLLISION_BOUNCE_SUPPORT_GROUP,
			options: [
				{ value: 0, label: "Floor line" },
				{ value: 1, label: "Radial from support" },
			],
		},
		{
			key: "floorOffsetPx",
			label: "Floor Offset",
			default: COLLISION_BOUNCE_FLOOR_OFFSET_PX_DEFAULT,
			min: -4000,
			max: 4000,
			step: 1,
			role: "layout",
			...COLLISION_BOUNCE_SUPPORT_GROUP,
		},
		{
			key: "settleReturnMode",
			label: "Settle Return",
			default: COLLISION_BOUNCE_SETTLE_RETURN_MODE_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_SUPPORT_GROUP,
			options: [
				{ value: 0, label: "On support" },
				{ value: 1, label: "Return to rest" },
			],
		},
		{
			key: "contactOffsetPx",
			label: "Contact Offset",
			default: COLLISION_BOUNCE_CONTACT_OFFSET_PX_DEFAULT,
			min: 0,
			max: 4000,
			step: 1,
			role: "layout",
			...COLLISION_BOUNCE_SUPPORT_GROUP,
		},
		{
			key: "anticipationFrames",
			label: "Anticipation",
			default: COLLISION_BOUNCE_ANTICIPATION_FRAMES_DEFAULT,
			min: 0,
			max: 30,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
		},
		{
			key: "anticipationLiftPx",
			label: "Anticipation Lift",
			default: COLLISION_BOUNCE_ANTICIPATION_LIFT_PX_DEFAULT,
			min: 0,
			max: 400,
			step: 1,
			role: "layout",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
		},
		{
			key: "launchGain",
			label: "Launch Gain",
			default: COLLISION_BOUNCE_LAUNCH_GAIN_DEFAULT,
			min: 1.0,
			max: 4.0,
			step: 0.05,
			role: "motion",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
		},
		{
			key: "contactSquash",
			label: "Contact Squash",
			default: COLLISION_BOUNCE_CONTACT_SQUASH_DEFAULT,
			min: 0.4,
			max: 1.0,
			step: 0.01,
			role: "motion",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
		},
		{
			key: "postStretch",
			label: "Post Stretch",
			default: COLLISION_BOUNCE_POST_STRETCH_DEFAULT,
			min: 1.0,
			max: 2.0,
			step: 0.01,
			role: "motion",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
		},
		{
			key: "stretchVelocityLink",
			label: "Stretch Link",
			default: COLLISION_BOUNCE_STRETCH_VELOCITY_LINK_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "motion",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
			options: [
				{ value: 0, label: "Poses" },
				{ value: 1, label: "Envelope" },
			],
		},
		{
			key: "areaCompensation",
			label: "Area Compensation",
			default: COLLISION_BOUNCE_AREA_COMPENSATION_DEFAULT,
			min: 0,
			max: 1,
			step: 0.05,
			role: "motion",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
		},
		{
			key: "supportPinMode",
			label: "Support Pin",
			default: COLLISION_BOUNCE_SUPPORT_PIN_MODE_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "motion",
			...COLLISION_BOUNCE_DEFORMATION_GROUP,
			options: [
				{ value: 0, label: "Single frame" },
				{ value: 1, label: "Distributed" },
			],
		},
		{
			key: "phaseStepFrames",
			label: "Phase Step",
			default: COLLISION_BOUNCE_PHASE_STEP_FRAMES_DEFAULT,
			min: 0,
			max: 30,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_PROPAGATION_GROUP,
		},
		{
			key: "frontSpeedShape",
			label: "Front Speed Shape",
			default: COLLISION_BOUNCE_FRONT_SPEED_SHAPE_DEFAULT,
			min: 0,
			max: 2,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_PROPAGATION_GROUP,
			options: [
				{ value: 0, label: "Uniform" },
				{ value: 1, label: "Eased" },
				{ value: 2, label: "Accelerating" },
			],
		},
		{
			key: "energyFalloff",
			label: "Energy Falloff",
			default: COLLISION_BOUNCE_ENERGY_FALLOFF_DEFAULT,
			min: 0,
			max: 1,
			step: 0.05,
			role: "motion",
			...COLLISION_BOUNCE_PROPAGATION_GROUP,
		},
		{
			key: "settleBudgetMode",
			label: "Settle Budget",
			default: COLLISION_BOUNCE_SETTLE_BUDGET_MODE_DEFAULT,
			min: 0,
			max: 1,
			step: 1,
			role: "timing",
			...COLLISION_BOUNCE_PROPAGATION_GROUP,
			options: [
				{ value: 0, label: "Clamp" },
				{ value: 1, label: "Allocate" },
			],
		},
	],
	outputs: ["translate", "scaleFactor", "rotate"],
	timeline: {
		mode: "trackless-expression",
		bakePolicy: "explicit-command",
		clipLabel: "Collision Bounce",
		durationParameterKey: "totalDurationFrames",
	},
	timingTemplates: [
		{
			templateId: "settle.velocity-land",
			role: "Bounce settle",
			note: "Timing-template vocabulary only; the geometric-tail settle math never uses this template's lambda/omega (that pair belongs to the damped-sine spring-return sibling, not collision bounce).",
			parameterKeys: ["bounciness", "bounces"],
		},
		{
			templateId: "follow.stagger-inherit",
			role: "Multi-target propagation",
			note: "Full-phrase propagation vocabulary for phaseStepFrames.",
			parameterKeys: ["phaseStepFrames", "frontSpeedShape"],
		},
	],
	roleExpansion: { mode: "per-target", roleId: COLLISION_BOUNCE_SUBJECT_ROLE },
	sample: sampleCollisionBounce,
};
