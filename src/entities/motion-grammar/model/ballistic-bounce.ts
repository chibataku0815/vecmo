/**
 * Pure ballistic-bounce math: beat-schedule solvers, the exact quad-bezier
 * easing constants, and the two piecewise sampling functions (`normalDistanceAt`,
 * `deformationEnvelopeAt`) plus per-target phrasing (`perTargetPhrase`).
 *
 * This module is the ONLY consumer of these formulas
 * (`docs/knowledge/bounce-canonical-representation.md`) and stays inside the
 * entity per that document's architecture recommendation: no scene/store/React
 * import, no `Math.random` / `Date`, deterministic given `(schedule, frame,
 * params)`. `collision-bounce-v1.ts` is the only caller; it resolves scene
 * geometry (rest positions, support role) and calls into this module with
 * plain numbers.
 */

// ---------------------------------------------------------------------------
// Authoring-mode / enum values (mirror the doc's numeric-enum parameter schema)
// ---------------------------------------------------------------------------

/** `authoringMode` 0 — duration-first (designer): target total duration + bounce count. */
export const AUTHORING_MODE_DURATION_FIRST = 0;
/** `authoringMode` 1 — physics-first (agent): drop height + gravity derive duration. */
export const AUTHORING_MODE_PHYSICS_FIRST = 1;

/** `supportMode` 0 — floor-line: axis from `travelAxisDegrees`, floor at `floorOffsetPx`. Works with zero roles. */
export const SUPPORT_MODE_FLOOR_LINE = 0;
/** `supportMode` 1 — radial-from-support: axis is `normalize(targetRest - supportCenter)`. Requires the `support` role. */
export const SUPPORT_MODE_RADIAL_FROM_SUPPORT = 1;

/** `stretchVelocityLink` 0 — poses: discrete single-frame contact squash, no continuous velocity stretch. */
export const STRETCH_VELOCITY_LINK_POSES = 0;
/** `stretchVelocityLink` 1 (default) — envelope: continuous velocity-linked deformation (Attempt014 win). */
export const STRETCH_VELOCITY_LINK_ENVELOPE = 1;

/** `supportPinMode` 0 — single-frame contact-load window. */
export const SUPPORT_PIN_MODE_SINGLE_FRAME = 0;
/** `supportPinMode` 1 (default) — distributed contact-load window across neighboring frames. */
export const SUPPORT_PIN_MODE_DISTRIBUTED = 1;

/** `frontSpeedShape` 0 (default) — uniform per-target cadence (`index * phaseStepFrames`). */
export const FRONT_SPEED_SHAPE_UNIFORM = 0;
/** `frontSpeedShape` 1 — eased cadence (smoothstep over target index). */
export const FRONT_SPEED_SHAPE_EASED = 1;
/** `frontSpeedShape` 2 — accelerating cadence (quadratic over target index). */
export const FRONT_SPEED_SHAPE_ACCEL = 2;

/** `settleBudgetMode` 0 — clamp: no settle-span reservation; late targets may compress. */
export const SETTLE_BUDGET_MODE_CLAMP = 0;
/** `settleBudgetMode` 1 (default) — allocate: reserve a settle tail so late targets are not compressed. */
export const SETTLE_BUDGET_MODE_ALLOCATE = 1;

/** `settleReturnMode` 0 (default) — on-support: terminal rest is the contact plane itself (v1 behavior, byte-identical). */
export const SETTLE_RETURN_MODE_ON_SUPPORT = 0;
/**
 * `settleReturnMode` 1 — return-to-rest: terminal rest resolves back to the
 * authored rest distance from the contact plane (`restDistancePx`), not the
 * plane itself — the topology "Gravity Field — Parent Child Study 01" needs
 * (a child perturbed toward a parent rebounds and settles back at its own
 * equilibrium radius, per `bounce-canonical-representation.md`'s return-mode
 * note). Wave 4a addition; additive to the v1 on-support schedule shape.
 */
export const SETTLE_RETURN_MODE_RETURN_TO_REST = 1;

// ---------------------------------------------------------------------------
// Numeric guards (internal safety bounds, not authoring defaults)
// ---------------------------------------------------------------------------

const MIN_BOUNCE_COUNT = 1;
const MAX_BOUNCE_COUNT = 12;
const MIN_BOUNCINESS = 0.05;
const MAX_BOUNCINESS = 0.95;
const MIN_BALLISTIC_FRAMES = 1;
const MIN_FIRST_FALL_FRAMES = 1;
const MIN_GRAVITY_PX_PER_FRAME2 = 0.05;
const MIN_STOP_THRESHOLD_PX = 0.5;
/** Contact-load bump half-width when `supportPinMode` selects the single-frame window. */
const CONTACT_LOAD_SINGLE_FRAME_WINDOW_FRAMES = 1;
/** Contact-load bump half-width when `supportPinMode` selects the distributed window (matches the study's 7-9f envelope order of magnitude). */
const CONTACT_LOAD_DISTRIBUTED_WINDOW_FRAMES = 4;
const MIN_CONTACT_SQUASH = 0.4;
const MAX_CONTACT_SQUASH = 1;
const MIN_POST_STRETCH = 1;
const MAX_POST_STRETCH = 2;
const MIN_SCALE_ALONG = 0.2;
const MAX_SCALE_ALONG = 3;
const MIN_SCALE_ALONG_EPSILON = 0.0001;
const MIN_FIRST_FALL_FRAMES_EPSILON = 0.0001;
/** Threshold separating enum values 0/1 on flat `Record<string, number>` params (mirrors `boolParam` elsewhere in this entity). */
const ENUM_ON_THRESHOLD = 0.5;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const clamp01 = (value: number): number => clamp(value, 0, 1);

const smoothstep01 = (value: number): number => {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
};

/** Linear interpolation, `a` at `t=0` to `b` at `t=1`; `t` is not itself clamped, callers pre-shape it (e.g. via {@link smoothstep01}). */
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Threshold check for numeric enum params on flat `Record<string, number>` param bags (`ENUM_ON_THRESHOLD` separates value 0 from value 1). */
const isEnumAtLeast = (value: number, threshold: number): boolean =>
	value >= threshold;

// ---------------------------------------------------------------------------
// Exact quad-bezier easing constants
// ---------------------------------------------------------------------------

/**
 * A quadratic Bezier degree-elevates to a cubic exactly. `y=x^2` (quadratic
 * control points `(0,0),(1/2,0),(1,1)`) elevates to cubic control points
 * `(0,0),(1/3,0),(2/3,1/3),(1,1)`; the X-coordinates are equally spaced so
 * `X(t)=t` exactly and `Y(t)` reduces to `t^2`. Confirmed exact — see
 * `bounce-canonical-representation.md#Free-flight-arcs-are-exactly-unit-cubic-bezier-segments`.
 */
export const EASE_IN_QUAD_CURVE = { x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 / 3 };

/** Degree-elevation of `y=1-(1-x)^2`; `Y(t)` reduces to `2t-t^2`. Same exactness proof as {@link EASE_IN_QUAD_CURVE}. */
export const EASE_OUT_QUAD_CURVE = { x1: 1 / 3, y1: 2 / 3, x2: 2 / 3, y2: 1 };

/** Closed-form `Y(t)` for {@link EASE_IN_QUAD_CURVE} (fall from apex: starts at rest, accelerates). */
const easeInQuadY = (t: number): number => t * t;

/** Closed-form `Y(t)` for {@link EASE_OUT_QUAD_CURVE} (rise to apex: fast off contact, decelerates to zero). */
const easeOutQuadY = (t: number): number => t * (2 - t);

// ---------------------------------------------------------------------------
// Beat schedule
// ---------------------------------------------------------------------------

/**
 * One resolved collision-bounce timeline, in frames (except the two `*Px`
 * height fields). Both authoring modes ({@link solveBeatScheduleDurationFirst},
 * {@link solveBeatSchedulePhysicsFirst}) compile to this one shape. `settleFrame`
 * is the exact geometric-tail resolution frame (`contact_{N+1}` in the doc's
 * closed form) — settle is deliberately NOT a damped sine; see
 * `bounce-canonical-representation.md#Settle-is-a-geometric-tail-NOT-a-damped-spring`.
 */
export type BounceBeatSchedule = {
	/** Frames of anticipation wind-up before `releaseFrame`; 0 = no anticipation. */
	readonly anticipationFrames: number;
	/** Local frame where anticipation ends and the first ballistic fall begins. Equals `anticipationFrames`. */
	readonly releaseFrame: number;
	/** Restitution `e` used to build this schedule, already clamped to `[0.05, 0.95]`. */
	readonly bounciness: number;
	/** First-fall duration in frames (`t0`), the schedule's base ballistic time unit. */
	readonly firstFallFrames: number;
	/** Per-contact hold length (frames) baked into every gap after a contact. */
	readonly contactHoldFrames: number;
	/** Absolute local frame of each contact `1..N` (`contactFrames[0]` is `contact_1`). */
	readonly contactFrames: readonly number[];
	/** Absolute local frame of each rebound apex `1..N`, one per `contactFrames` entry. */
	readonly apexFrames: readonly number[];
	/** Apex height in px for each rebound `1..N` (`apexHeights[0]` is `H_1 = e^2 * H0`, `launchGain`-scaled). */
	readonly apexHeights: readonly number[];
	/** Height in px the subject falls from at rest, before the first contact (`H0`). In return-to-rest mode, `H0 = restDistancePx + anticipationLiftPx` — NOT the zero-displacement anchor; see {@link restAnchorDistancePx}. */
	readonly initialHeightPx: number;
	/** Local frame where the geometric tail resolves to exact rest (`contact_{N+1}`). */
	readonly settleFrame: number;
	/** `settleReturnMode`: 0=on-support (default), 1=return-to-rest. See {@link SETTLE_RETURN_MODE_ON_SUPPORT} / {@link SETTLE_RETURN_MODE_RETURN_TO_REST}. */
	readonly settleReturnMode: number;
	/**
	 * Authored rest distance from the contact plane (`d_rest` in the doc's
	 * return-mode note), already net of `contactOffsetPx`. Only meaningful when
	 * `settleReturnMode` selects return-to-rest — it is the anticipation ramp's
	 * start value and the schedule's terminal target; on-support mode ignores
	 * it (terminal is always the plane, `0`).
	 */
	readonly restDistancePx: number;
};

type ScheduleBuildInput = {
	readonly anticipationFrames: number;
	readonly bounciness: number;
	readonly firstFallFrames: number;
	readonly contactHoldFrames: number;
	readonly bounceCount: number;
	readonly initialHeightPx: number;
	readonly launchGain: number;
	readonly settleReturnMode: number;
	readonly restDistancePx: number;
};

/** `1 + 2e(1-e^{k-1})/(1-e)` — the doc's closed-form geometric-series offset (in `t0` units) to `contact_k`. */
const geometricContactOffset = (bounciness: number, k: number): number =>
	1 + (2 * bounciness * (1 - bounciness ** (k - 1))) / (1 - bounciness);

/**
 * Shared beat-schedule construction for both authoring modes. `apex_k =
 * contact_k + contactHoldFrames + e^k*t0` (the rise begins only after
 * `contact_k`'s own hold ends); `settleFrame` uses the same closed-form offset
 * extended to `k=N+1`, which is algebraically identical to
 * `apex_N + e^N*t0` (the matching final fall) — verified by expanding both
 * forms; see the geometric-series identity in the module's design notes.
 */
const buildSchedule = (input: ScheduleBuildInput): BounceBeatSchedule => {
	const releaseFrame = input.anticipationFrames;
	const contactFrames: number[] = [];
	const apexFrames: number[] = [];
	const apexHeights: number[] = [];
	for (let k = 1; k <= input.bounceCount; k += 1) {
		const priorHolds = (k - 1) * input.contactHoldFrames;
		const contactFrame =
			releaseFrame +
			input.firstFallFrames * geometricContactOffset(input.bounciness, k) +
			priorHolds;
		contactFrames.push(contactFrame);
		const flightSpan = input.bounciness ** k * input.firstFallFrames;
		apexFrames.push(contactFrame + input.contactHoldFrames + flightSpan);
		apexHeights.push(
			input.launchGain * input.bounciness ** (2 * k) * input.initialHeightPx,
		);
	}
	const settleFrame =
		releaseFrame +
		input.firstFallFrames *
			geometricContactOffset(input.bounciness, input.bounceCount + 1) +
		input.bounceCount * input.contactHoldFrames;
	return {
		anticipationFrames: input.anticipationFrames,
		releaseFrame,
		bounciness: input.bounciness,
		firstFallFrames: input.firstFallFrames,
		contactHoldFrames: input.contactHoldFrames,
		contactFrames,
		apexFrames,
		apexHeights,
		initialHeightPx: input.initialHeightPx,
		settleFrame,
		settleReturnMode: input.settleReturnMode,
		restDistancePx: Math.max(0, input.restDistancePx),
	};
};

export type DurationFirstBounceInput = {
	/** `totalDurationFrames`: 6..600, default 120. */
	readonly totalDurationFrames: number;
	/** `bounces` (N): int 1..12, default 3. */
	readonly bounces: number;
	/** `bounciness` (e): 0.05..0.95, default 0.6. */
	readonly bounciness: number;
	/** `anticipationFrames`: int 0..30, default 6 (expressive layer, shared). */
	readonly anticipationFrames: number;
	/** `contactHoldFrames`: int 0..8, default 0. */
	readonly contactHoldFrames: number;
	/** `launchGain`: 1.0..4.0, default 1.0 (expressive layer, shared). */
	readonly launchGain: number;
	/**
	 * Geometric fall height `H0` in px. NOT an authored duration-first
	 * parameter — the doc's duration-first table has no height/distance key,
	 * so `collision-bounce-v1.ts` derives it from scene geometry (rest
	 * position vs. the resolved support boundary) and passes it in resolved.
	 */
	readonly initialHeightPx: number;
	/** `settleReturnMode`: 0=on-support,1=return-to-rest, default 0 (Wave 4a). */
	readonly settleReturnMode: number;
	/** `restDistancePx`: authored rest distance from the contact plane, net of `contactOffsetPx` (Wave 4a; only used in return-to-rest mode). */
	readonly restDistancePx: number;
};

/**
 * Duration-first (designer) solve. Subtracts the non-ballistic span
 * (anticipation + total contact holds) from `totalDurationFrames`, then solves
 * the finite-N geometric series `T_ballistic = t0*(1 + 2e(1-e^N)/(1-e))` for
 * `t0`.
 */
export function solveBeatScheduleDurationFirst(
	input: DurationFirstBounceInput,
): BounceBeatSchedule {
	const bounceCount = clamp(
		Math.round(input.bounces),
		MIN_BOUNCE_COUNT,
		MAX_BOUNCE_COUNT,
	);
	const bounciness = clamp(input.bounciness, MIN_BOUNCINESS, MAX_BOUNCINESS);
	const anticipationFrames = Math.max(0, Math.round(input.anticipationFrames));
	const contactHoldFrames = Math.max(0, Math.round(input.contactHoldFrames));
	const nonBallisticFrames =
		anticipationFrames + bounceCount * contactHoldFrames;
	const ballisticFrames = Math.max(
		MIN_BALLISTIC_FRAMES,
		input.totalDurationFrames - nonBallisticFrames,
	);
	const geometricSpan = geometricContactOffset(bounciness, bounceCount + 1);
	const firstFallFrames = Math.max(
		MIN_FIRST_FALL_FRAMES,
		ballisticFrames / geometricSpan,
	);
	return buildSchedule({
		anticipationFrames,
		bounciness,
		firstFallFrames,
		contactHoldFrames,
		bounceCount,
		initialHeightPx: Math.max(0, input.initialHeightPx),
		launchGain: Math.max(1, input.launchGain),
		settleReturnMode: input.settleReturnMode,
		restDistancePx: input.restDistancePx,
	});
}

export type PhysicsFirstBounceInput = {
	/** `dropHeightPx` (H0): 1..4000, default 320. */
	readonly dropHeightPx: number;
	/** `gravityPxPerFrame2` (g): 0.05..80, default 0.9. */
	readonly gravityPxPerFrame2: number;
	/** `initialVelocityPx` (v0): -400..400, default 0. */
	readonly initialVelocityPx: number;
	/** `bounciness` (e): 0.05..0.95, default 0.6. */
	readonly bounciness: number;
	/** `stopThresholdPx` (eps): 0.5..50, default 2. */
	readonly stopThresholdPx: number;
	/** `anticipationFrames`: int 0..30, default 6 (expressive layer, shared). */
	readonly anticipationFrames: number;
	/** `launchGain`: 1.0..4.0, default 1.0 (expressive layer, shared). */
	readonly launchGain: number;
	/** `settleReturnMode`: 0=on-support,1=return-to-rest, default 0 (Wave 4a). */
	readonly settleReturnMode: number;
	/**
	 * `restDistancePx`: authored rest distance from the contact plane (Wave
	 * 4a). Return-to-rest mode ALWAYS derives `dropHeightPx` from this (the
	 * doc's "geometry always wins for the excursion" rule) — the caller folds
	 * `restDistancePx + anticipationLiftPx` into `dropHeightPx` itself before
	 * calling this solver, so `dropHeightPx` stays the sole H0 input here;
	 * this field only supplies the terminal/anticipation anchor.
	 */
	readonly restDistancePx: number;
};

/**
 * Physics-first (agent) solve. `t0` comes from constant-acceleration
 * kinematics `H0 = v0*t0 + (1/2)*g*t0^2` (the doc's `t0=sqrt(2*H0/g)` is the
 * `v0=0` special case); `N` comes from the apex-height stop threshold
 * `N = ceil(ln(eps/H0)/(2*ln(e)))`. Both feed the same {@link buildSchedule}
 * used by the duration-first solve, per the doc's "one internal beat schedule"
 * decision.
 */
export function solveBeatSchedulePhysicsFirst(
	input: PhysicsFirstBounceInput,
): BounceBeatSchedule {
	const bounciness = clamp(input.bounciness, MIN_BOUNCINESS, MAX_BOUNCINESS);
	const gravity = Math.max(MIN_GRAVITY_PX_PER_FRAME2, input.gravityPxPerFrame2);
	const initialHeightPx = Math.max(0, input.dropHeightPx);
	const initialVelocityPx = input.initialVelocityPx;
	const firstFallFrames = Math.max(
		MIN_FIRST_FALL_FRAMES,
		(Math.sqrt(
			Math.max(0, initialVelocityPx ** 2 + 2 * gravity * initialHeightPx),
		) -
			initialVelocityPx) /
			gravity,
	);
	const stopThreshold = Math.max(MIN_STOP_THRESHOLD_PX, input.stopThresholdPx);
	const bounceCount =
		initialHeightPx > stopThreshold
			? clamp(
					Math.ceil(
						Math.log(stopThreshold / initialHeightPx) /
							(2 * Math.log(bounciness)),
					),
					MIN_BOUNCE_COUNT,
					MAX_BOUNCE_COUNT,
				)
			: MIN_BOUNCE_COUNT;
	const anticipationFrames = Math.max(0, Math.round(input.anticipationFrames));
	return buildSchedule({
		anticipationFrames,
		bounciness,
		firstFallFrames,
		contactHoldFrames: 0,
		bounceCount,
		initialHeightPx,
		launchGain: Math.max(1, input.launchGain),
		settleReturnMode: input.settleReturnMode,
		restDistancePx: input.restDistancePx,
	});
}

// ---------------------------------------------------------------------------
// Normal-distance sampling
// ---------------------------------------------------------------------------

export type BounceExpressiveParams = {
	/** `anticipationLiftPx`: 0..400, default 0. */
	readonly anticipationLiftPx: number;
	/** `contactSquash`: 0.4..1.0, default 0.72. */
	readonly contactSquash: number;
	/** `postStretch`: 1.0..2.0, default 1.35. */
	readonly postStretch: number;
	/** `stretchVelocityLink`: enum 0=poses,1=envelope, default 1. */
	readonly stretchVelocityLink: number;
	/** `areaCompensation`: 0..1, default 1. */
	readonly areaCompensation: number;
	/** `supportPinMode`: enum 0=single-frame,1=distributed, default 1. */
	readonly supportPinMode: number;
};

const TERMINAL_REST_DISTANCE_PX = 0;

/** `true` when `schedule` selects return-to-rest ({@link SETTLE_RETURN_MODE_RETURN_TO_REST}); `false` (v1, on-support) otherwise. */
const isSettleReturnMode = (schedule: BounceBeatSchedule): boolean =>
	isEnumAtLeast(schedule.settleReturnMode, ENUM_ON_THRESHOLD);

/**
 * The terminal (post-`settleFrame`) resting distance from the contact plane:
 * `0` (on the plane) for on-support mode, `restDistancePx` (back at the
 * authored position) for return-to-rest.
 */
const terminalDistancePx = (schedule: BounceBeatSchedule): number =>
	isSettleReturnMode(schedule)
		? schedule.restDistancePx
		: TERMINAL_REST_DISTANCE_PX;

/**
 * The zero-displacement reference `collision-bounce-v1.ts` (live) and
 * `collision-bounce-bake.ts` (bake) both subtract `normalDistanceAt` against
 * when composing a target's translate channel (`distance -
 * restAnchorDistancePx(schedule)`). On-support mode: the authored rest
 * position sits exactly `initialHeightPx` (H0) away from the plane, so H0 IS
 * the anchor (v1's only convention, unchanged). Return-to-rest mode inflates
 * H0 with `anticipationLiftPx` (`H0 = restDistancePx + anticipationLiftPx`,
 * see `bounce-canonical-representation.md`'s return-mode note), so the anchor
 * must be the RAW `restDistancePx` instead — subtracting H0 there would leave
 * a permanent `-anticipationLiftPx` residual displacement at settle, breaking
 * "terminal resolves to the exact authored rest." Exported so live and bake
 * can never diverge on which anchor they subtract.
 */
export const restAnchorDistancePx = (schedule: BounceBeatSchedule): number =>
	isSettleReturnMode(schedule)
		? schedule.restDistancePx
		: schedule.initialHeightPx;

const segmentProgress = (
	frame: number,
	startFrame: number,
	endFrame: number,
): number => {
	const span = endFrame - startFrame;
	return span > 0 ? clamp01((frame - startFrame) / span) : 1;
};

/** Fall segment (ease-in-quad): `heightPx` at `startFrame` decaying to 0 at `endFrame`. */
const fallDistance = (
	frame: number,
	startFrame: number,
	endFrame: number,
	heightPx: number,
): number =>
	heightPx * (1 - easeInQuadY(segmentProgress(frame, startFrame, endFrame)));

/**
 * Generalized {@link fallDistance}: ease-in-quad interpolation from `fromPx`
 * at `startFrame` to `toPx` at `endFrame`. `fallDistance(f,s,e,h)` is the
 * `toPx=0` special case; kept as a SEPARATE function (not rewritten in terms
 * of this one) so every on-support call site keeps its exact original
 * floating-point formula, byte-identical. Used only by the return-to-rest
 * terminal segment, where `toPx=restDistancePx` may be above OR below
 * `fromPx` (the last apex can land short of or past rest depending on
 * `launchGain`) — the same ease-in-quad shaping handles both directions.
 */
const fallTowardDistance = (
	frame: number,
	startFrame: number,
	endFrame: number,
	fromPx: number,
	toPx: number,
): number =>
	mix(fromPx, toPx, easeInQuadY(segmentProgress(frame, startFrame, endFrame)));

/** Rise segment (ease-out-quad): 0 at `startFrame` growing to `heightPx` at `endFrame`. */
const riseDistance = (
	frame: number,
	startFrame: number,
	endFrame: number,
	heightPx: number,
): number =>
	heightPx * easeOutQuadY(segmentProgress(frame, startFrame, endFrame));

/** Triangular 0->1->0 shape used to place the anticipation lift bump inside its window. */
const anticipationBump = (progress: number): number =>
	1 - Math.abs(2 * progress - 1);

/**
 * On-support mode: `H0` plus a transient triangular lift bump that returns to
 * `H0` baseline by release (unchanged v1 formula). Return-to-rest mode:
 * `anticipationLiftPx` is folded permanently into `H0` (`H0 = restDistancePx
 * + anticipationLiftPx`, resolved by the caller), so anticipation is instead
 * ONE monotonic smoothstep ramp from `restDistancePx` (true rest, frame 0) up
 * to `H0` (release) — continuous with `ballisticDistance`'s primary fall,
 * which starts its OWN progress at `initialHeightPx` (H0) at `releaseFrame`.
 */
const anticipationDistance = (
	schedule: BounceBeatSchedule,
	frame: number,
	params: BounceExpressiveParams,
): number => {
	if (schedule.anticipationFrames <= 0) {
		return isSettleReturnMode(schedule)
			? schedule.restDistancePx
			: schedule.initialHeightPx;
	}
	const progress = clamp01(frame / schedule.anticipationFrames);
	if (isSettleReturnMode(schedule)) {
		return mix(
			schedule.restDistancePx,
			schedule.initialHeightPx,
			smoothstep01(progress),
		);
	}
	const lift =
		params.anticipationLiftPx * smoothstep01(anticipationBump(progress));
	return schedule.initialHeightPx + lift;
};

const ballisticDistance = (
	schedule: BounceBeatSchedule,
	frame: number,
): number => {
	const {
		releaseFrame,
		contactFrames,
		apexFrames,
		apexHeights,
		contactHoldFrames,
		initialHeightPx,
		settleFrame,
	} = schedule;
	const firstContact = contactFrames[0] ?? settleFrame;
	if (frame < firstContact) {
		return fallDistance(frame, releaseFrame, firstContact, initialHeightPx);
	}
	const lastContactIndex = contactFrames.length - 1;
	for (let index = 0; index < contactFrames.length; index += 1) {
		const contactFrame = contactFrames[index];
		const apexFrame = apexFrames[index];
		const apexHeight = apexHeights[index];
		if (
			contactFrame === undefined ||
			apexFrame === undefined ||
			apexHeight === undefined
		) {
			continue;
		}
		const holdEnd = contactFrame + contactHoldFrames;
		const nextContactFrame = contactFrames[index + 1] ?? settleFrame;
		if (frame < holdEnd) return TERMINAL_REST_DISTANCE_PX;
		if (frame < apexFrame)
			return riseDistance(frame, holdEnd, apexFrame, apexHeight);
		if (frame < nextContactFrame) {
			// The LAST contact's post-apex fall is the terminal settle-approach
			// segment: on-support falls to the plane (0, unchanged `fallDistance`
			// call — byte-identical to v1); return-to-rest falls/rises TOWARD
			// `restDistancePx` instead (field relaxation, not a support contact).
			if (index === lastContactIndex && isSettleReturnMode(schedule)) {
				return fallTowardDistance(
					frame,
					apexFrame,
					nextContactFrame,
					apexHeight,
					schedule.restDistancePx,
				);
			}
			return fallDistance(frame, apexFrame, nextContactFrame, apexHeight);
		}
	}
	return terminalDistancePx(schedule);
};

/**
 * Piecewise ballistic distance along the collision normal, always `>= 0`.
 * Rest (`frame <= releaseFrame` window boundary) holds at `H0` plus the
 * anticipation wind-up bump (on-support) or ramps from authored rest to `H0`
 * (return-to-rest, see {@link anticipationDistance}); the ballistic body
 * walks fall/hold/rise segments built from {@link EASE_IN_QUAD_CURVE} /
 * {@link EASE_OUT_QUAD_CURVE}; rest after `settleFrame` is a terminal hold at
 * {@link terminalDistancePx} — exactly 0 (on the support) for on-support
 * mode, `restDistancePx` (authored rest) for return-to-rest — never an
 * asymptotic decay.
 */
export function normalDistanceAt(
	schedule: BounceBeatSchedule,
	frame: number,
	params: BounceExpressiveParams,
): number {
	const clampedFrame = Math.max(0, frame);
	if (clampedFrame < schedule.releaseFrame) {
		return anticipationDistance(schedule, clampedFrame, params);
	}
	if (clampedFrame >= schedule.settleFrame) return terminalDistancePx(schedule);
	return ballisticDistance(schedule, clampedFrame);
}

// ---------------------------------------------------------------------------
// Deformation envelope
// ---------------------------------------------------------------------------

export type BounceDeformationEnvelope = {
	/** Scale factor along the travel/collision-normal axis (squash < 1, stretch > 1). */
	readonly scaleAlong: number;
	/** Scale factor across (tangential to) the travel axis; area-compensates `scaleAlong`. */
	readonly scaleAcross: number;
	/**
	 * The doc's `contactWeight(t)` coefficient from `r(t) = r_free(t) +
	 * contactWeight(t)*(h(t)-h0)`, in `[0,1]`. This module has no node
	 * half-extent (`h0` in scene px) to compute the full pixel correction —
	 * `ExpressionSampleEnv` exposes rest positions/points, not bounds — so the
	 * weight is returned for the caller to combine with whatever length scale
	 * it has available (see `collision-bounce-v1.ts`).
	 */
	readonly supportCorrection: number;
};

const NEUTRAL_DEFORMATION_ENVELOPE: BounceDeformationEnvelope = {
	scaleAlong: 1,
	scaleAcross: 1,
	supportCorrection: 0,
};

/**
 * The contact-load window half-width `deformationEnvelopeAt` uses for a given
 * expressive-param set. Exported so `collision-bounce-bake.ts` places its
 * deformation-cluster keys at the SAME window the live envelope actually
 * shapes (single source) instead of re-deriving/duplicating this branch.
 */
export const deformationWindowFramesFor = (
	params: BounceExpressiveParams,
): number => {
	const posesOnly = !isEnumAtLeast(
		params.stretchVelocityLink,
		ENUM_ON_THRESHOLD,
	);
	if (posesOnly) return CONTACT_LOAD_SINGLE_FRAME_WINDOW_FRAMES;
	return isEnumAtLeast(params.supportPinMode, ENUM_ON_THRESHOLD)
		? CONTACT_LOAD_DISTRIBUTED_WINDOW_FRAMES
		: CONTACT_LOAD_SINGLE_FRAME_WINDOW_FRAMES;
};

/**
 * Frames {@link contactLoad} (and the bake's deformation-cluster placement,
 * `collision-bounce-bake.ts`) treat as real support touches. On-support mode
 * includes `settleFrame`: the terminal position IS the plane, a genuine
 * contact (v1, unchanged). Return-to-rest mode excludes it: the terminal
 * arrival is a free-field relaxation back to the authored rest, not a
 * support contact, so it must not drive squash/pin correction
 * (`bounce-canonical-representation.md` return-mode note). Exported so live
 * and bake compute the identical touch set.
 */
export const contactLoadTouchFrames = (
	schedule: BounceBeatSchedule,
): readonly number[] =>
	isSettleReturnMode(schedule)
		? schedule.contactFrames
		: [...schedule.contactFrames, schedule.settleFrame];

/**
 * Compact bump peaking at 1 exactly at a contact/settle touch and decaying to
 * 0 across `windowFrames`, shaped with smoothstep. Multiple touches take the
 * max rather than summing, so overlapping windows never double-count load.
 */
const contactLoad = (
	frame: number,
	schedule: BounceBeatSchedule,
	windowFrames: number,
): number => {
	let peak = 0;
	for (const touch of contactLoadTouchFrames(schedule)) {
		const distance = Math.abs(frame - touch);
		if (distance > windowFrames) continue;
		const shaped = smoothstep01(1 - distance / windowFrames);
		if (shaped > peak) peak = shaped;
	}
	return peak;
};

/**
 * Velocity-linked continuous squash/stretch envelope plus the distributed
 * support-window correction weight. `stretchVelocityLink: poses` degrades to a
 * single-frame contact spike with no continuous velocity term (the legacy
 * isolated-pose behavior the doc contrasts against continuity); the default
 * `envelope` mode links stretch to `|velocity|` (via a 1-frame backward
 * difference of {@link normalDistanceAt}, the same lookahead-differencing
 * idiom `evaluator.ts` uses for tangent/velocity sampling) and squash to
 * {@link contactLoad}. Deformation is neutral before release and — once well
 * past the settle frame's own contact window — neutral again, matching "must
 * return to the exact resting shape at settle" (authorship doc §3).
 */
export function deformationEnvelopeAt(
	schedule: BounceBeatSchedule,
	frame: number,
	params: BounceExpressiveParams,
): BounceDeformationEnvelope {
	if (frame < schedule.releaseFrame) return NEUTRAL_DEFORMATION_ENVELOPE;
	const posesOnly = !isEnumAtLeast(
		params.stretchVelocityLink,
		ENUM_ON_THRESHOLD,
	);
	const windowFrames = deformationWindowFramesFor(params);
	if (frame > schedule.settleFrame + CONTACT_LOAD_DISTRIBUTED_WINDOW_FRAMES) {
		return NEUTRAL_DEFORMATION_ENVELOPE;
	}

	const load = contactLoad(frame, schedule, windowFrames);
	const velocityPxPerFrame = posesOnly
		? 0
		: normalDistanceAt(schedule, frame, params) -
			normalDistanceAt(schedule, Math.max(0, frame - 1), params);
	const referenceSpeed =
		schedule.firstFallFrames > MIN_FIRST_FALL_FRAMES_EPSILON
			? (2 * schedule.initialHeightPx) / schedule.firstFallFrames
			: 1;
	const speedFactor =
		referenceSpeed > 0
			? clamp01(Math.abs(velocityPxPerFrame) / referenceSpeed)
			: 0;

	const contactSquash = clamp(
		params.contactSquash,
		MIN_CONTACT_SQUASH,
		MAX_CONTACT_SQUASH,
	);
	const postStretch = clamp(
		params.postStretch,
		MIN_POST_STRETCH,
		MAX_POST_STRETCH,
	);
	const stretchTerm = speedFactor * (postStretch - 1);
	const squashTerm = load * (1 - contactSquash);
	const scaleAlong = clamp(
		1 + stretchTerm - squashTerm,
		MIN_SCALE_ALONG,
		MAX_SCALE_ALONG,
	);

	const areaCompensation = clamp01(params.areaCompensation);
	const inverseAlong =
		scaleAlong > MIN_SCALE_ALONG_EPSILON ? 1 / scaleAlong : 1;
	const scaleAcross = 1 + areaCompensation * (inverseAlong - 1);

	return { scaleAlong, scaleAcross, supportCorrection: load };
}

// ---------------------------------------------------------------------------
// Per-target phrasing
// ---------------------------------------------------------------------------

export type PerTargetPhraseParams = {
	/** `phaseStepFrames`: 0..30, default 3. */
	readonly phaseStepFrames: number;
	/** `frontSpeedShape`: enum 0=uniform,1=eased,2=accel, default 0. */
	readonly frontSpeedShape: number;
	/** `energyFalloff`: 0..1, default 0. */
	readonly energyFalloff: number;
	/** `settleBudgetMode`: enum 0=clamp,1=allocate, default 1. */
	readonly settleBudgetMode: number;
};

export type PerTargetPhrase = {
	/** Frames to delay this target's local phrase (`motionStart(i)` in the doc's full-phrase clock law). */
	readonly startOffsetFrames: number;
	/** Multiplier on this target's fall height / apex heights, in `[1-energyFalloff, 1]`. */
	readonly energyScale: number;
};

/** Maps normalized target-order progress `[0,1]` to a shaped cadence fraction. */
const frontSpeedCadence = (
	progress: number,
	frontSpeedShape: number,
): number => {
	if (Math.round(frontSpeedShape) === FRONT_SPEED_SHAPE_ACCEL) {
		return progress * progress;
	}
	if (Math.round(frontSpeedShape) === FRONT_SPEED_SHAPE_EASED) {
		return smoothstep01(progress);
	}
	return progress;
};

/**
 * Per-target start offset, energy scale, and settle-span allocation for
 * full-phrase propagation (`localTime(i) = globalTime - i*phaseStep` family;
 * authorship doc §5 "Full-phrase clock law"). Every target owns a complete
 * phrase — the caller re-solves its own beat schedule at `frame -
 * startOffsetFrames` scaled by `energyScale`, it does not phase only the
 * contact key.
 */
export function perTargetPhrase(
	index: number,
	orderedCount: number,
	params: PerTargetPhraseParams,
): PerTargetPhrase {
	const safeCount = Math.max(1, Math.round(orderedCount));
	const safeIndex = clamp(Math.round(index), 0, safeCount - 1);
	const cadence = safeCount > 1 ? safeIndex / (safeCount - 1) : 0;
	const shaped = frontSpeedCadence(cadence, params.frontSpeedShape);
	const totalSpanFrames = (safeCount - 1) * Math.max(0, params.phaseStepFrames);
	const startOffsetFrames = shaped * totalSpanFrames;
	const energyFalloff = clamp01(params.energyFalloff);
	const energyScale = 1 - energyFalloff * cadence;
	return { startOffsetFrames, energyScale };
}

/**
 * Resolves the `totalDurationFrames` a target's duration-first schedule
 * solve should actually use, per `settleBudgetMode`. This is the SINGLE
 * shared composition point both `sampleCollisionBounce` (live) and
 * `collision-bounce-bake.ts` (bake) call before
 * {@link solveBeatScheduleDurationFirst}, so the two can never drift on how
 * the knob behaves.
 *
 * - `allocate` (1, default): re-solves this target's COMPLETE phrase —
 *   including its own settle AND the bake's post-settle pin-relaxation
 *   epilogue ({@link deformationWindowFramesFor}, the frames the deformation
 *   cluster's own last key takes to relax back to base past `settleFrame`) —
 *   inside `totalDurationFrames - startOffsetFrames - deformationWindowFramesFor(...)`,
 *   so every target's TERMINAL key (not just its geometric settle beat) lands
 *   at or before the authored clip length regardless of phase; later targets
 *   get a proportionally shorter (faster) schedule. Without reserving the
 *   epilogue too, the terminal key would land past `totalDurationFrames`, and
 *   a clip cut there would freeze the subject at peak squash/pin instead of
 *   true rest — exactly the cause-5 failure this knob exists to prevent. This
 *   is the doc's "reserve a settle span so late targets are not compressed"
 *   residual (cause 5) made concrete as a real per-target re-solve, replacing
 *   the earlier `settleBudgetFrames` authoring-hint constant this function
 *   supersedes. Floored at {@link MIN_BALLISTIC_FRAMES} so a large epilogue
 *   relative to a short clip cannot drive the resolved value negative.
 * - `clamp` (0): unchanged current behavior — every target solves against the
 *   same raw `totalDurationFrames`, so a late target's settle (and its
 *   epilogue) may fall past the clip end (documented truncation at
 *   playback/export, not compressed in the schedule itself).
 *
 * Physics-first mode does not call this: it derives an absolute schedule from
 * `dropHeightPx`/gravity with no authored clip-length concept to allocate
 * within, so `settleBudgetMode` is a duration-first-only knob by construction.
 */
export function resolveDurationFirstTotalFrames({
	totalDurationFrames,
	startOffsetFrames,
	settleBudgetMode,
	expressiveParams,
}: {
	readonly totalDurationFrames: number;
	readonly startOffsetFrames: number;
	readonly settleBudgetMode: number;
	readonly expressiveParams: BounceExpressiveParams;
}): number {
	if (!isEnumAtLeast(settleBudgetMode, ENUM_ON_THRESHOLD)) {
		return totalDurationFrames;
	}
	return Math.max(
		MIN_BALLISTIC_FRAMES,
		totalDurationFrames -
			startOffsetFrames -
			deformationWindowFramesFor(expressiveParams),
	);
}
