/**
 * Sparse beat-anchored explicit bake for `collision-bounce`
 * (`docs/knowledge/bounce-canonical-representation.md`). Walks the SAME
 * `ballistic-bounce.ts` schedule/envelope math `collision-bounce-v1.ts`
 * samples live (role resolution reused via `buildExpressionSampleEnv`,
 * beat-schedule/normal-distance/deformation-envelope reused via the exported
 * `ballistic-bounce.ts`/`collision-bounce-v1.ts` helpers), so live and bake
 * agree by construction on every beat frame outside the bake-only support-pin
 * correction below. Produces `MotionCommand`s writing sparse native
 * x/y/scaleX/scaleY/rotation keyframes with exact per-segment
 * `outTemporalCurve` cubics via `upsertKeyframeWithEasing` — never the dense
 * per-frame LINEAR representation `emitMotionGrammarScalarTracks` produces,
 * which the doc explicitly rejects for this verb (candidate (b)).
 *
 * Support-point pin correction (the doc's contact-window support correction
 * `r(t) = r_free(t) + contactWeight(t)*(h(t)-h0)`) is applied HERE ONLY:
 * `ExpressionSampleEnv` (the live sampling contract, P0-FROZEN in
 * `expression-definition.ts`) exposes rest positions only, no node bounds, so
 * live sampling keeps a center-anchored-squash approximation. This bake
 * emitter has full `SceneDocument` access, so it computes each subject's real
 * half-extent along the travel axis and applies the exact pin, which is why
 * baked and live position samples intentionally diverge within the contact
 * window (see the divergence note on {@link applySupportPinCorrection}).
 */

import type { MotionCommand } from "@/entities/motion/model/command";
import { upsertKeyframeWithEasing } from "@/entities/motion/model/commands";
import type { EasingCurve } from "@/entities/motion/model/easing";
import { getNodeParentBounds } from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	AUTHORING_MODE_PHYSICS_FIRST,
	type BounceBeatSchedule,
	type BounceExpressiveParams,
	contactLoadTouchFrames,
	deformationEnvelopeAt,
	deformationWindowFramesFor,
	EASE_IN_QUAD_CURVE,
	EASE_OUT_QUAD_CURVE,
	normalDistanceAt,
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
	COLLISION_BOUNCE_AUTHORING_MODE_DEFAULT,
	COLLISION_BOUNCE_BOUNCES_DEFAULT,
	COLLISION_BOUNCE_BOUNCINESS_DEFAULT,
	COLLISION_BOUNCE_CONTACT_HOLD_FRAMES_DEFAULT,
	COLLISION_BOUNCE_CONTACT_OFFSET_PX_DEFAULT,
	COLLISION_BOUNCE_DROP_HEIGHT_PX_DEFAULT,
	COLLISION_BOUNCE_FLOOR_OFFSET_PX_DEFAULT,
	COLLISION_BOUNCE_GRAVITY_PX_PER_FRAME2_DEFAULT,
	COLLISION_BOUNCE_INITIAL_VELOCITY_PX_DEFAULT,
	COLLISION_BOUNCE_LAUNCH_GAIN_DEFAULT,
	COLLISION_BOUNCE_SETTLE_RETURN_MODE_DEFAULT,
	COLLISION_BOUNCE_STOP_THRESHOLD_PX_DEFAULT,
	COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT,
	COLLISION_BOUNCE_TOTAL_DURATION_FRAMES_DEFAULT,
	COLLISION_BOUNCE_TRAVEL_AXIS_DEGREES_DEFAULT,
} from "./catalog";
import {
	COLLISION_BOUNCE_SUBJECT_ROLE,
	COLLISION_BOUNCE_SUPPORT_ROLE,
	COLLISION_BOUNCE_V1,
	degrees,
	expressiveParamsFrom,
	finiteOr,
	floorLineAxis,
	normalizeDegrees,
	phraseParamsFrom,
	REFERENCE_UP_DEGREES,
	radialAxis,
	wavefrontOrderedSubjectIds,
} from "./collision-bounce-v1";
import { buildExpressionSampleEnv } from "./expression-runtime";
import type { MotionGrammarBinding } from "./types";

/**
 * Deformation-envelope key count per contact-like touch (doc open question 1:
 * ~4 vs 7-9 keys). v1 picks 4 semantic keys — envelope enter, max squash at
 * contact, post-stretch peak, envelope exit — tunable by editing this
 * constant and {@link DEFORMATION_CLUSTER_OFFSET_FRACTIONS} together without
 * touching the emission logic.
 */
const DEFORMATION_CLUSTER_KEY_COUNT = 4;

/**
 * Offsets (as a fraction of the touch's contact-load window half-width, see
 * {@link deformationWindowFramesFor}) for the 4 cluster keys, relative to the
 * touch frame: enter (-1), max squash (0, AT the touch), post-stretch peak
 * (+0.5, partway through the rebound where the velocity-linked stretch term
 * is rising), exit (+1). Length must match
 * {@link DEFORMATION_CLUSTER_KEY_COUNT}.
 */
const DEFORMATION_CLUSTER_OFFSET_FRACTIONS = [-1, 0, 0.5, 1] as const;

/**
 * Exact cubic reproducing `smoothstep01` under this module's linear-x
 * parameterization (`x1=1/3,x2=2/3`, matching the `ballistic-bounce.ts`
 * quad-curve convention). Degree-elevating a cubic Bezier with these X
 * control points and solving for Y control points that reproduce
 * `3t^2-2t^3` (matching Bernstein coefficients term-by-term) gives
 * `(0,0),(1/3,0),(2/3,1),(1,1)` — used for the anticipation wind-up bump's
 * rising half (`smoothstep01(2*progress)` over the first half-window).
 */
const SMOOTHSTEP_RISE_CURVE: EasingCurve = {
	x1: 1 / 3,
	y1: 0,
	x2: 2 / 3,
	y2: 1,
};
/** Mirror of {@link SMOOTHSTEP_RISE_CURVE} for the wind-up bump's falling half (`1 - smoothstep01(u)`, point-symmetric). */
const SMOOTHSTEP_FALL_CURVE: EasingCurve = {
	x1: 1 / 3,
	y1: 1,
	x2: 2 / 3,
	y2: 0,
};

/**
 * Best-fit cubic for the FINAL fall into permanent rest. Keeps
 * `EASE_IN_QUAD_CURVE`'s zero-slope departure from the last apex (`x1=1/3,
 * y1=0`, continuous with the preceding rise segment) but pushes the second
 * control point outward (`x2=5/6,y2=1`) so the tangent arriving at settle is
 * nearly flat, instead of `EASE_IN_QUAD_CURVE`'s maximum-speed impact — the
 * doc's "flat terminal tangent into rest" requirement. Not claimed exact: the
 * doc scopes exactness to ballistic arcs only; settle is explicitly a
 * geometric tail, authored with a best-fit cubic, never a single exact quad.
 */
const SETTLE_APPROACH_CURVE: EasingCurve = {
	x1: 1 / 3,
	y1: 0,
	x2: 5 / 6,
	y2: 1,
};

/** Placeholder curve for degenerate (equal-value) hold/leading segments, where the curve shape leaves no visible trace. */
const NEUTRAL_CURVE: EasingCurve = EASE_IN_QUAD_CURVE;

/** Nonzero-rotation threshold (degrees) below which the alignment delta is treated as no rotation and the whole track is skipped (a true no-op, not a false positive from floating-point noise). */
const ROTATION_CONSTANT_EPSILON_DEGREES = 1e-6;

/** Neutral scale factor written at the leading deformation key and implicitly held outside every cluster. */
const NEUTRAL_SCALE_FACTOR = 1;

export type CollisionBounceBakeTargetSummary = {
	readonly nodeId: string;
	readonly positionKeyCount: number;
	readonly deformationKeyCount: number;
	readonly rotationKeyCount: number;
};

export type CollisionBounceBakeResult =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly commands: readonly MotionCommand[];
			readonly targets: readonly CollisionBounceBakeTargetSummary[];
	  };

type Vector2 = { readonly x: number; readonly y: number };

type ResolvedBakeTarget = {
	readonly nodeId: string;
	readonly rest: Vector2;
	readonly awayFromSupport: Vector2;
	readonly halfExtentAlongAxis: number;
	readonly schedule: BounceBeatSchedule;
	/**
	 * `perTargetPhrase`'s per-target start offset (doc §5 full-phrase clock
	 * law). `schedule` is solved in LOCAL phase-shifted time, matching
	 * `sampleCollisionBounce`'s `localFrame = env.frame - startOffsetFrames`;
	 * every emitted document frame must add this back
	 * (`documentFrame = localFrame + startOffsetFrames`) or every target past
	 * the first collapses onto the same document frames, losing the staggered
	 * wavefront that is the primary multi-target use case.
	 */
	readonly startOffsetFrames: number;
	/**
	 * The subject's authored (rest) rotation/scale, read from the scene
	 * document at bake time. Baked `rotation`/`scaleX`/`scaleY` keyframe
	 * tracks are the sampler's SOLE source for those channels once present
	 * (`effectiveTransform` in `sampler.ts` reads a track value directly, with
	 * no separate base to combine it with) — unlike live grammar sampling,
	 * where `composeGrammarTransform` (`presentation.ts`) layers `rotate`
	 * ADDITIVELY and `scaleFactor` MULTIPLICATIVELY onto the base transform.
	 * Every baked rotation/scale value below must therefore fold this base in
	 * explicitly (`baseRotation + delta`, `baseScale * factor`) to reproduce
	 * the same final pose live sampling produces.
	 */
	readonly baseRotation: number;
	readonly baseScale: Vector2;
};

const axisHalfExtent = (
	scene: SceneDocument,
	nodeId: string,
	axis: Vector2,
): number => {
	const node = findNode(scene, nodeId);
	if (!node) return 0;
	const bounds = getNodeParentBounds(node);
	return (
		Math.abs((bounds.width / 2) * axis.x) +
		Math.abs((bounds.height / 2) * axis.y)
	);
};

const baseTransformOf = (
	scene: SceneDocument,
	nodeId: string,
): { readonly rotation: number; readonly scale: Vector2 } => {
	const node = findNode(scene, nodeId);
	return {
		rotation: node?.transform.rotation ?? 0,
		scale: node?.transform.scale ?? { x: 1, y: 1 },
	};
};

/**
 * Resolves subjects, axis policy, and per-target beat schedules exactly like
 * `sampleCollisionBounce`, plus the bake-only per-target axis-aligned
 * half-extent used by {@link applySupportPinCorrection}. Blocks (no
 * commands) under the same conditions `sample()` silently emits nothing for
 * — radial support mode with no resolved support role — so bake reports a
 * reason instead of the live sampler's "emit nothing" degradation.
 */
const resolveBakeTargets = ({
	binding,
	scene,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
}):
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly targets: readonly ResolvedBakeTarget[];
	  } => {
	const env = buildExpressionSampleEnv(COLLISION_BOUNCE_V1, binding, {
		scene,
		frame: 0,
	});
	const subjectIds =
		env.resolvedRoleNodeIds.get(COLLISION_BOUNCE_SUBJECT_ROLE) ?? [];
	if (subjectIds.length === 0) {
		return { status: "blocked", reason: "No bounce subject to bake." };
	}

	const supportMode = finiteOr(
		env.parameters.supportMode,
		COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT,
	);
	const usesRadialSupport = supportMode >= SUPPORT_MODE_RADIAL_FROM_SUPPORT;
	const supportNodeId = env.resolvedRoleNodeIds.get(
		COLLISION_BOUNCE_SUPPORT_ROLE,
	)?.[0];
	const supportCenter = supportNodeId
		? env.restPositionOf(supportNodeId)
		: undefined;
	if (usesRadialSupport && (!supportNodeId || !supportCenter)) {
		return {
			status: "blocked",
			reason: "Radial support mode needs a resolved support object to bake.",
		};
	}

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
	const phraseParams = phraseParamsFrom(env.parameters);
	// `resolveDurationFirstTotalFrames`'s allocate-mode epilogue reservation
	// needs the SAME expressive params `createCollisionBounceBakeCommands`
	// later resolves for `buildTargetCommands` — computed here too (pure,
	// cheap) rather than threading it in from the caller, since this function
	// runs first and already builds `env`.
	const expressiveParams = expressiveParamsFrom(env.parameters);
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

	const targets = orderedSubjectIds.map((nodeId, index) => {
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
		// Mirrors `sampleCollisionBounce`'s identical derivation exactly (single
		// source of truth for the H0/rest-anchor split, per this verb's
		// architecture: live and bake must never diverge on the schedule inputs).
		const restDistancePx = Math.max(0, axis.initialHeightPx - contactOffsetPx);
		const scaledRestDistancePx = restDistancePx * phrase.energyScale;
		const excursionHeightPx = isReturnToRest
			? scaledRestDistancePx + expressiveParams.anticipationLiftPx
			: scaledRestDistancePx;

		const schedule = isPhysicsFirst
			? solveBeatSchedulePhysicsFirst({
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

		const base = baseTransformOf(scene, nodeId);
		return {
			nodeId,
			rest,
			awayFromSupport: axis.awayFromSupport,
			halfExtentAlongAxis: axisHalfExtent(scene, nodeId, axis.awayFromSupport),
			schedule,
			startOffsetFrames: phrase.startOffsetFrames,
			baseRotation: base.rotation,
			baseScale: base.scale,
		};
	});

	return { status: "ready", targets };
};

type BeatSpec = {
	readonly frame: number;
	/** Curve for the segment LEAVING this beat; absent on the final beat. */
	readonly curveOut?: EasingCurve;
};

/**
 * Ordered local-schedule-time position beats mirroring `ballisticDistance`'s
 * own piecewise control flow exactly: [anticipation start, wind-up peak] ->
 * release -> contact_1 -> [hold end] -> apex_1 -> contact_2 -> ... ->
 * apex_N -> settle -> pin-release. Each beat carries the curve leaving it
 * directly, so the structural pattern (fall-in / hold / rise-out, repeated
 * per contact, with the LAST fall replaced by {@link SETTLE_APPROACH_CURVE})
 * is built in one forward pass instead of inferred after the fact.
 *
 * The trailing `pin-release` beat exists because, in ON-SUPPORT mode,
 * `settleFrame` itself sits exactly at a `contactLoad` touch
 * (`supportCorrection=1`), so `positionValueAt` there still carries the full
 * support-pin offset C — if `settleFrame` were the terminal key, that offset
 * would freeze forever past it, while the deformation cluster's own last key
 * (`settleFrame + deformationWindowFramesFor(...)`) already relaxes scale
 * back to base. That combination is physically wrong (scale rests, position
 * stays offset) and diverges from live's terminal pose, which never carries a
 * pin offset. The pin-release beat, placed at the SAME frame the deformation
 * cluster relaxes to neutral, samples `positionValueAt` there too (where
 * `contactLoad` has decayed to 0, so `C` naturally goes to 0) and becomes the
 * true terminal key, so position and scale reach base rest in sync.
 * Return-to-rest mode excludes `settleFrame` from `contactLoadTouchFrames`
 * (it is not a support contact), so `C` is already ~0 there in the typical
 * case; the SAME two-beat tail is kept regardless — harmless, and it still
 * guarantees the true terminal key lands at `restAnchorDistancePx`-relative
 * displacement `0` (exact authored rest) even if a real contact happens to
 * sit within `windowFrames` of `settleFrame`.
 */
const positionBeatSpecs = (
	schedule: BounceBeatSchedule,
	expressiveParams: BounceExpressiveParams,
): readonly BeatSpec[] => {
	const anticipationLiftPx = expressiveParams.anticipationLiftPx;
	// Round HERE, once, so the frame used to compute this beat's VALUE
	// (`normalDistanceAt`/`deformationEnvelopeAt`, both called with this same
	// rounded number below) is identical to the frame the keyframe is written
	// at. Rounding only at the final `upsertScalarCommand` call left a gap
	// between "the frame the value was computed for" and "the frame the key
	// claims to hold that value at" — small away from contacts, but real
	// (confirmed empirically) near contact-adjacent frames where the
	// deformation envelope changes fastest.
	const at = (frame: number): number => Math.round(frame);
	const isReturnToRest =
		schedule.settleReturnMode >= SETTLE_RETURN_MODE_RETURN_TO_REST;
	const specs: BeatSpec[] = [];
	if (schedule.anticipationFrames > 0) {
		if (isReturnToRest && anticipationLiftPx > 0) {
			// Return-to-rest: anticipation is ONE monotonic outward ramp from
			// authored rest to H0 (`ballistic-bounce.ts`'s `anticipationDistance`
			// return-mode branch), not a bump that returns to baseline — a single
			// key at frame 0 reproduces that ramp exactly (`SMOOTHSTEP_RISE_CURVE`
			// reproduces `smoothstep01` exactly, the same claim the v1 bump keys
			// already rely on).
			specs.push({ frame: at(0), curveOut: SMOOTHSTEP_RISE_CURVE });
		} else if (anticipationLiftPx > 0) {
			specs.push({ frame: at(0), curveOut: SMOOTHSTEP_RISE_CURVE });
			specs.push({
				frame: at(schedule.anticipationFrames / 2),
				curveOut: SMOOTHSTEP_FALL_CURVE,
			});
		} else {
			specs.push({ frame: at(0), curveOut: NEUTRAL_CURVE });
		}
	}
	specs.push({
		frame: at(schedule.releaseFrame),
		curveOut: EASE_IN_QUAD_CURVE,
	});
	const lastContactIndex = schedule.contactFrames.length - 1;
	schedule.contactFrames.forEach((contactFrame, index) => {
		const isLastContact = index === lastContactIndex;
		if (schedule.contactHoldFrames > 0) {
			specs.push({ frame: at(contactFrame), curveOut: NEUTRAL_CURVE });
			specs.push({
				frame: at(contactFrame + schedule.contactHoldFrames),
				curveOut: EASE_OUT_QUAD_CURVE,
			});
		} else {
			specs.push({ frame: at(contactFrame), curveOut: EASE_OUT_QUAD_CURVE });
		}
		const apexFrame = schedule.apexFrames[index] ?? contactFrame;
		specs.push({
			frame: at(apexFrame),
			curveOut: isLastContact ? SETTLE_APPROACH_CURVE : EASE_IN_QUAD_CURVE,
		});
	});
	specs.push({
		frame: at(schedule.settleFrame),
		curveOut: SETTLE_APPROACH_CURVE,
	});
	specs.push({
		frame: at(
			schedule.settleFrame + deformationWindowFramesFor(expressiveParams),
		),
	});
	return specs;
};

/**
 * Exact support-point pin correction (Task 2, `expression-definition.ts`
 * Branch 3 — bake has document bounds, live does not). Without it, a
 * center-anchored `scaleAlong` squash lifts the support-side edge by
 * `(1-scaleAlong)*halfExtent`: at the default `contactSquash=0.72` this is
 * `0.28*halfExtentAlongAxis` px of edge penetration/lift at the exact contact
 * frame (e.g. a 100px-tall shape floats/sinks its near edge by ~14px at peak
 * squash). The correction shifts the center outward along
 * `awayFromSupport` by exactly that amount, weighted by the same
 * `supportCorrection` (contact-load) term the deformation envelope already
 * computes, so it self-limits to the contact-adjacent window and is a no-op
 * elsewhere.
 */
const applySupportPinCorrection = ({
	schedule,
	frame,
	params,
	halfExtentAlongAxis,
}: {
	readonly schedule: BounceBeatSchedule;
	readonly frame: number;
	readonly params: BounceExpressiveParams;
	readonly halfExtentAlongAxis: number;
}): number => {
	const deformation = deformationEnvelopeAt(schedule, frame, params);
	return (
		(1 - deformation.scaleAlong) *
		halfExtentAlongAxis *
		deformation.supportCorrection
	);
};

const positionValueAt = ({
	schedule,
	frame,
	params,
	halfExtentAlongAxis,
}: {
	readonly schedule: BounceBeatSchedule;
	readonly frame: number;
	readonly params: BounceExpressiveParams;
	readonly halfExtentAlongAxis: number;
}): number => {
	const displacement =
		normalDistanceAt(schedule, frame, params) - restAnchorDistancePx(schedule);
	const correction = applySupportPinCorrection({
		schedule,
		frame,
		params,
		halfExtentAlongAxis,
	});
	return displacement + correction;
};

/**
 * Deformation-cluster beats around one contact-like touch frame (a real
 * contact or the settle frame, both drive `contactLoad`). Rounded here (see
 * {@link positionBeatSpecs}'s `at` helper doc comment) so the frame used to
 * sample `deformationEnvelopeAt` for this key's VALUE is the same integer
 * frame the key is written at.
 */
const deformationClusterBeats = (
	touchFrame: number,
	windowFrames: number,
): readonly number[] =>
	DEFORMATION_CLUSTER_OFFSET_FRACTIONS.map((fraction) =>
		Math.round(touchFrame + fraction * windowFrames),
	);

const upsertScalarCommand = (
	nodeId: string,
	property: "x" | "y" | "scaleX" | "scaleY" | "rotation",
	frame: number,
	value: number,
	curveOut: EasingCurve | undefined,
): MotionCommand =>
	upsertKeyframeWithEasing(
		nodeId,
		property,
		Math.round(frame),
		value,
		curveOut ? { kind: "curve", curve: curveOut } : undefined,
	);

/**
 * Builds one target's sparse x/y/scaleX/scaleY/rotation MotionCommands and
 * key counts. `rotation`/`scaleX`/`scaleY` fold the node's BASE (authored)
 * rotation/scale in explicitly — a baked keyframe track is the sampler's sole
 * source for its channel once present (`effectiveTransform` in `sampler.ts`
 * reads the track value directly), unlike live grammar sampling, where
 * `composeGrammarTransform` (`presentation.ts`) layers `rotate` ADDITIVELY
 * and `scaleFactor` MULTIPLICATIVELY onto the base transform. Writing the bare
 * delta/factor without folding in the base would silently drop any authored
 * rotation/scale the moment a bake landed. Rotation is only written when the
 * resolved axis angle is actually NONZERO (a real per-target check, not an
 * assumption): Wave-1's floor-line and radial axes both depend only on rest
 * positions, so the angle is always time-INVARIANT per target, but it is not
 * always zero — a non-vertical `travelAxisDegrees` in floor-line mode, or an
 * off-axis support in radial mode, both yield a real constant alignment
 * rotation that must be baked as a 2-key flat track (first emitted frame,
 * settle), not skipped.
 */
const buildTargetCommands = (
	target: ResolvedBakeTarget,
	expressiveParams: BounceExpressiveParams,
): {
	readonly commands: MotionCommand[];
	readonly summary: CollisionBounceBakeTargetSummary;
} => {
	const commands: MotionCommand[] = [];
	const {
		nodeId,
		rest,
		awayFromSupport,
		halfExtentAlongAxis,
		schedule,
		startOffsetFrames,
		baseRotation,
		baseScale,
	} = target;
	// `schedule` is solved in LOCAL phase-shifted time (matching
	// `sampleCollisionBounce`'s `localFrame = env.frame - startOffsetFrames`);
	// every document-timeline frame this function emits MUST go through this
	// so multi-target bindings keep their staggered wavefront instead of every
	// target's keys landing on the same document frames.
	const toDocumentFrame = (localFrame: number): number =>
		localFrame + startOffsetFrames;

	// Position (x/y): one shared per-segment cubic drives both axis tracks,
	// since x/y are affine in the same scalar displacement along a fixed axis.
	const beats = positionBeatSpecs(schedule, expressiveParams);
	for (const beat of beats) {
		const value = positionValueAt({
			schedule,
			frame: beat.frame,
			params: expressiveParams,
			halfExtentAlongAxis,
		});
		const x = rest.x + awayFromSupport.x * value;
		const y = rest.y + awayFromSupport.y * value;
		const documentFrame = toDocumentFrame(beat.frame);
		commands.push(
			upsertScalarCommand(nodeId, "x", documentFrame, x, beat.curveOut),
		);
		commands.push(
			upsertScalarCommand(nodeId, "y", documentFrame, y, beat.curveOut),
		);
	}

	// Deformation (scaleX/scaleY): one leading neutral key, then a 4-key
	// cluster per REAL support touch (`contactLoadTouchFrames` — contacts
	// plus settle on-support; contacts only in return-to-rest, since the
	// return-to-rest terminal is field relaxation, not a contact).
	const windowFrames = deformationWindowFramesFor(expressiveParams);
	const deformationFrames: number[] = [schedule.releaseFrame];
	for (const touchFrame of contactLoadTouchFrames(schedule)) {
		deformationFrames.push(
			...deformationClusterBeats(touchFrame, windowFrames),
		);
	}
	let deformationKeyCount = 0;
	deformationFrames.forEach((frame, index) => {
		const isLeading = index === 0;
		const deformation = isLeading
			? undefined
			: deformationEnvelopeAt(schedule, frame, expressiveParams);
		const scaleAlongFactor = deformation?.scaleAlong ?? NEUTRAL_SCALE_FACTOR;
		const scaleAcrossFactor = deformation?.scaleAcross ?? NEUTRAL_SCALE_FACTOR;
		// Baked scaleX/scaleY tracks REPLACE the channel (sampler.ts), while
		// live `scaleFactor` MULTIPLIES onto base scale (presentation.ts) — fold
		// the base in here so the two reproduce the same final pose.
		const scaleX = baseScale.x * scaleAcrossFactor;
		const scaleY = baseScale.y * scaleAlongFactor;
		const isLastOfCluster =
			!isLeading &&
			(index - 1) % DEFORMATION_CLUSTER_KEY_COUNT ===
				DEFORMATION_CLUSTER_KEY_COUNT - 1;
		const curveOut =
			isLeading || isLastOfCluster ? EASE_OUT_QUAD_CURVE : EASE_IN_QUAD_CURVE;
		const isFinalBeat = index === deformationFrames.length - 1;
		const documentFrame = toDocumentFrame(frame);
		commands.push(
			upsertScalarCommand(
				nodeId,
				"scaleX",
				documentFrame,
				scaleX,
				isFinalBeat ? undefined : curveOut,
			),
		);
		commands.push(
			upsertScalarCommand(
				nodeId,
				"scaleY",
				documentFrame,
				scaleY,
				isFinalBeat ? undefined : curveOut,
			),
		);
		deformationKeyCount += 1;
	});

	// Rotation: skip entirely when the resolved axis alignment delta (theta_i,
	// the SAME quantity `sampleCollisionBounce` emits on the live `rotate`
	// channel) is zero — a real per-target magnitude check, not a
	// time-variance check (the angle is always time-invariant per target in
	// Wave-1's model, but not always zero: floor-line with a non-vertical
	// `travelAxisDegrees`, or radial mode with an off-axis support, both
	// produce a real constant rotation that must be baked).
	const alignmentDeltaDegrees = normalizeDegrees(
		degrees(Math.atan2(awayFromSupport.y, awayFromSupport.x)) -
			REFERENCE_UP_DEGREES,
	);
	const hasRotation =
		Math.abs(alignmentDeltaDegrees) > ROTATION_CONSTANT_EPSILON_DEGREES;
	let rotationKeyCount = 0;
	if (hasRotation) {
		const rotationValue = baseRotation + alignmentDeltaDegrees;
		const firstFrame = beats[0]?.frame ?? schedule.releaseFrame;
		commands.push(
			upsertScalarCommand(
				nodeId,
				"rotation",
				toDocumentFrame(firstFrame),
				rotationValue,
				NEUTRAL_CURVE,
			),
		);
		commands.push(
			upsertScalarCommand(
				nodeId,
				"rotation",
				toDocumentFrame(schedule.settleFrame),
				rotationValue,
				undefined,
			),
		);
		rotationKeyCount = 2;
	}

	return {
		commands,
		summary: {
			nodeId,
			positionKeyCount: beats.length,
			deformationKeyCount,
			rotationKeyCount,
		},
	};
};

/**
 * Builds the full sparse bake for one collision-bounce binding: sparse
 * beat-anchored `MotionCommand`s per subject (position, deformation,
 * conditional rotation), ready to apply through the motion command bus. Pure
 * and store-free — callers (the Inspector's bake action) own applying
 * `commands` inside a transaction and any source-binding disposition.
 */
export function createCollisionBounceBakeCommands({
	binding,
	scene,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
}): CollisionBounceBakeResult {
	const resolved = resolveBakeTargets({ binding, scene });
	if (resolved.status === "blocked") return resolved;

	const expressiveParams = expressiveParamsFrom(binding.parameters);
	const commands: MotionCommand[] = [];
	const targets: CollisionBounceBakeTargetSummary[] = [];
	for (const target of resolved.targets) {
		const built = buildTargetCommands(target, expressiveParams);
		commands.push(...built.commands);
		targets.push(built.summary);
	}

	return { status: "ready", commands, targets };
}
