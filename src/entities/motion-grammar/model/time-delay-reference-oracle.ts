import {
	type DelayedReplayReferenceInput,
	delayedReplayReferenceCriticalFrames,
	sampleDelayedReplayReference,
} from "./delayed-replay-reference-oracle";
import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
} from "./reference-law-oracle";

export const TIME_DELAY_REFERENCE_LAW_ID = "seeded-settle-jump-v1" as const;

type UnitBezier = readonly [number, number, number, number];

export type TimeDelayReferenceTarget = {
	readonly targetId: string;
	readonly bodyRoleId: string;
	readonly satelliteRoleId: string;
	readonly delayFrames: number;
	readonly centerX: number;
};

export type TimeDelayReferenceBody = {
	readonly restCenterY: number;
	readonly baseSizePx: number;
	readonly stretchGain: number;
};

export type TimeDelayReferenceJump = {
	readonly liftoffPhase: number;
	readonly riseFrames: number;
	readonly fallFrames: number;
	readonly apexCenterY: number;
	readonly riseBezier: UnitBezier;
	readonly fallBezier: UnitBezier;
	readonly settleLambda: number;
	readonly settleOmega: number;
};

export type TimeDelayReferenceSatellite = {
	readonly separationPhase: number;
	readonly preSeparationFrames: number;
	readonly lifeFrames: number;
	readonly radiusAnchorPx: number;
	readonly radiusDecay: number;
	readonly centerYAnchor: number;
	readonly centerYAsymptote: number;
	readonly centerYRatio: number;
};

/**
 * Source-law input for a Time Delay comparison packet.
 *
 * This is transient comparison data. It is intentionally not a Motion Grammar
 * binding, an authoring profile, or a serializable document payload.
 */
export type TimeDelayReferenceInput = {
	readonly periodFrames: number;
	readonly staggerFrames: number;
	readonly launchPhaseShift: number;
	readonly targets: readonly TimeDelayReferenceTarget[];
	readonly body: TimeDelayReferenceBody;
	readonly jump: TimeDelayReferenceJump;
	readonly satellite: TimeDelayReferenceSatellite;
};

export type TimeDelayReferenceMasterSample = {
	readonly localFrame: number;
	readonly phase: number;
	readonly tau: number;
	readonly body: {
		readonly centerY: number;
		readonly baseWidth: number;
		readonly height: number;
		readonly velocityY: number;
		readonly stretchY: number;
	};
	readonly satellite:
		| {
				readonly kind: "absent";
		  }
		| {
				readonly kind: "present";
				readonly ageFrames: number;
				readonly centerY: number;
				readonly radius: number;
		  };
};

export type TimeDelayReferenceSample = {
	readonly targetId: string;
	readonly bodyRoleId: string;
	readonly satelliteRoleId: string;
	readonly order: number;
	readonly delayFrames: number;
	readonly sourceFrame: number;
	readonly centerX: number;
	readonly master: TimeDelayReferenceMasterSample;
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const positiveModulo = (value: number, modulo: number): number =>
	((value % modulo) + modulo) % modulo;

const hasFiniteValues = (values: readonly number[]): boolean =>
	values.every(isFiniteReferenceNumber);

const settleWindowFrames = (input: TimeDelayReferenceInput): number =>
	input.periodFrames - input.jump.riseFrames - input.jump.fallFrames;

const firstSettleExtremumAge = (input: TimeDelayReferenceInput): number =>
	Math.atan2(input.jump.settleOmega, input.jump.settleLambda) /
	input.jump.settleOmega;

const criticalProbeFrames = (input: TimeDelayReferenceInput): number | null => {
	const settleWindow = settleWindowFrames(input);
	const probe = Math.min(
		0.25,
		settleWindow / 2,
		input.satellite.lifeFrames / 2,
	);
	return isFiniteReferenceNumber(probe) && probe > 0 ? probe : null;
};

const landingVelocity = (input: TimeDelayReferenceInput): number => {
	const [, , controlX, controlY] = input.jump.fallBezier;
	const slope = 1 - controlX > 1e-9 ? (1 - controlY) / (1 - controlX) : 0;
	return (
		(slope * (input.body.restCenterY - input.jump.apexCenterY)) /
		input.jump.fallFrames
	);
};

const isUnitBezier = (value: unknown): value is UnitBezier =>
	Array.isArray(value) &&
	value.length === 4 &&
	hasFiniteValues(value) &&
	value.every((coordinate) => coordinate >= 0 && coordinate <= 1);

const inputIssue = (input: TimeDelayReferenceInput): string | null => {
	if (!isFiniteReferenceNumber(input.periodFrames) || input.periodFrames <= 0) {
		return "Time Delay period must be finite and positive.";
	}
	if (
		!isFiniteReferenceNumber(input.staggerFrames) ||
		input.staggerFrames <= 0
	) {
		return "Time Delay stagger must be finite and positive.";
	}
	if (!isFiniteReferenceNumber(input.launchPhaseShift)) {
		return "Time Delay launch phase shift must be finite.";
	}
	if (input.targets.length < 2) {
		return "Time Delay requires one zero-delay master and at least one follower.";
	}
	if (
		!hasFiniteValues([
			input.body.restCenterY,
			input.body.baseSizePx,
			input.body.stretchGain,
			input.jump.liftoffPhase,
			input.jump.riseFrames,
			input.jump.fallFrames,
			input.jump.apexCenterY,
			input.jump.settleLambda,
			input.jump.settleOmega,
			input.satellite.separationPhase,
			input.satellite.preSeparationFrames,
			input.satellite.lifeFrames,
			input.satellite.radiusAnchorPx,
			input.satellite.radiusDecay,
			input.satellite.centerYAnchor,
			input.satellite.centerYAsymptote,
			input.satellite.centerYRatio,
		])
	) {
		return "Time Delay source-law parameters must be finite.";
	}
	if (input.body.baseSizePx <= 0 || input.body.stretchGain < 0) {
		return "Time Delay body size must be positive and stretch gain non-negative.";
	}
	if (input.body.restCenterY <= input.jump.apexCenterY) {
		return "Time Delay apex must be above the rest center in screen coordinates.";
	}
	if (input.jump.riseFrames <= 0 || input.jump.fallFrames <= 0) {
		return "Time Delay rise and fall durations must be positive.";
	}
	if (input.jump.riseFrames + input.jump.fallFrames >= input.periodFrames) {
		return "Time Delay rise and fall must leave a settle window inside the period.";
	}
	if (
		!isUnitBezier(input.jump.riseBezier) ||
		!isUnitBezier(input.jump.fallBezier)
	) {
		return "Time Delay rise and fall curves must be unit Bezier tuples.";
	}
	if (input.jump.settleLambda <= 0 || input.jump.settleOmega <= 0) {
		return "Time Delay settle decay and frequency must be positive.";
	}
	const firstSettleAge = firstSettleExtremumAge(input);
	if (
		!isFiniteReferenceNumber(firstSettleAge) ||
		firstSettleAge <= 0 ||
		firstSettleAge >= settleWindowFrames(input)
	) {
		return "Time Delay first seeded-settle extremum must occur inside its settle window.";
	}
	if (landingVelocity(input) <= 0) {
		return "Time Delay seeded settle requires a positive fall exit velocity.";
	}
	if (
		input.satellite.preSeparationFrames < 0 ||
		input.satellite.lifeFrames <= 0 ||
		input.satellite.preSeparationFrames > input.periodFrames / 2 ||
		input.satellite.lifeFrames > input.periodFrames / 2 ||
		input.satellite.preSeparationFrames + input.satellite.lifeFrames >=
			input.periodFrames ||
		input.satellite.radiusAnchorPx <= 0 ||
		input.satellite.radiusDecay <= 0 ||
		input.satellite.radiusDecay > 1 ||
		input.satellite.centerYRatio <= 0 ||
		input.satellite.centerYRatio > 1
	) {
		return "Time Delay satellite parameters are outside the bounded source-law range.";
	}
	if (criticalProbeFrames(input) === null) {
		return "Time Delay cannot derive a positive settle and satellite-lifecycle probe.";
	}
	const targetIds = new Set<string>();
	const bodyRoles = new Set<string>();
	const satelliteRoles = new Set<string>();
	for (const [index, target] of input.targets.entries()) {
		if (!target.targetId || !target.bodyRoleId || !target.satelliteRoleId) {
			return "Time Delay target and body/satellite role ids are required.";
		}
		if (
			targetIds.has(target.targetId) ||
			bodyRoles.has(target.bodyRoleId) ||
			satelliteRoles.has(target.satelliteRoleId)
		) {
			return "Time Delay target and role ids must be unique.";
		}
		if (
			!isFiniteReferenceNumber(target.delayFrames) ||
			target.delayFrames < 0 ||
			!isFiniteReferenceNumber(target.centerX)
		) {
			return "Time Delay target delays must be non-negative and positions finite.";
		}
		if (!Object.is(target.delayFrames, index * input.staggerFrames)) {
			return "Time Delay targets must begin at the zero-delay master and use one uniform ordered stagger.";
		}
		targetIds.add(target.targetId);
		bodyRoles.add(target.bodyRoleId);
		satelliteRoles.add(target.satelliteRoleId);
	}
	if ((input.targets.length - 1) * input.staggerFrames >= input.periodFrames) {
		return "Time Delay ordered target delays must remain distinct inside one period.";
	}
	return null;
};

const unitBezierY = (
	p1x: number,
	p1y: number,
	p2x: number,
	p2y: number,
	x: number,
): number => {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	let lower = 0;
	let upper = 1;
	for (let index = 0; index < 40; index += 1) {
		const t = (lower + upper) / 2;
		const inverse = 1 - t;
		const bezierX =
			3 * inverse * inverse * t * p1x + 3 * inverse * t * t * p2x + t ** 3;
		if (bezierX < x) lower = t;
		else upper = t;
	}
	const t = (lower + upper) / 2;
	const inverse = 1 - t;
	return 3 * inverse * inverse * t * p1y + 3 * inverse * t * t * p2y + t ** 3;
};

const unitBezierSlope = (
	p1x: number,
	p1y: number,
	p2x: number,
	p2y: number,
	x: number,
): number => {
	if (x <= 0) return p1x > 1e-9 ? p1y / p1x : 0;
	if (x >= 1) return 1 - p2x > 1e-9 ? (1 - p2y) / (1 - p2x) : 0;
	let lower = 0;
	let upper = 1;
	for (let index = 0; index < 40; index += 1) {
		const t = (lower + upper) / 2;
		const inverse = 1 - t;
		const bezierX =
			3 * inverse * inverse * t * p1x + 3 * inverse * t * t * p2x + t ** 3;
		if (bezierX < x) lower = t;
		else upper = t;
	}
	const t = (lower + upper) / 2;
	const inverse = 1 - t;
	const derivativeX =
		3 * inverse * inverse * p1x +
		6 * inverse * t * (p2x - p1x) +
		3 * t * t * (1 - p2x);
	const derivativeY =
		3 * inverse * inverse * p1y +
		6 * inverse * t * (p2y - p1y) +
		3 * t * t * (1 - p2y);
	return derivativeX <= 1e-12 ? 0 : derivativeY / derivativeX;
};

const masterCenterY = (tau: number, input: TimeDelayReferenceInput): number => {
	const amplitude = input.body.restCenterY - input.jump.apexCenterY;
	if (tau < input.jump.riseFrames) {
		const [x1, y1, x2, y2] = input.jump.riseBezier;
		return (
			input.body.restCenterY -
			amplitude * unitBezierY(x1, y1, x2, y2, tau / input.jump.riseFrames)
		);
	}
	const landingTau = input.jump.riseFrames + input.jump.fallFrames;
	if (tau < landingTau) {
		const [x1, y1, x2, y2] = input.jump.fallBezier;
		return (
			input.jump.apexCenterY +
			amplitude *
				unitBezierY(
					x1,
					y1,
					x2,
					y2,
					(tau - input.jump.riseFrames) / input.jump.fallFrames,
				)
		);
	}
	const settleAge = tau - landingTau;
	return (
		input.body.restCenterY +
		(landingVelocity(input) / input.jump.settleOmega) *
			Math.exp(-input.jump.settleLambda * settleAge) *
			Math.sin(input.jump.settleOmega * settleAge)
	);
};

const masterVelocityY = (
	tau: number,
	input: TimeDelayReferenceInput,
): number => {
	const amplitude = input.body.restCenterY - input.jump.apexCenterY;
	if (tau < input.jump.riseFrames) {
		const [x1, y1, x2, y2] = input.jump.riseBezier;
		return (
			(-amplitude / input.jump.riseFrames) *
			unitBezierSlope(x1, y1, x2, y2, tau / input.jump.riseFrames)
		);
	}
	const landingTau = input.jump.riseFrames + input.jump.fallFrames;
	if (tau < landingTau) {
		const [x1, y1, x2, y2] = input.jump.fallBezier;
		return (
			(amplitude / input.jump.fallFrames) *
			unitBezierSlope(
				x1,
				y1,
				x2,
				y2,
				(tau - input.jump.riseFrames) / input.jump.fallFrames,
			)
		);
	}
	const settleAge = tau - landingTau;
	const velocity = landingVelocity(input);
	const decay = Math.exp(-input.jump.settleLambda * settleAge);
	return (
		(velocity / input.jump.settleOmega) *
		decay *
		(input.jump.settleOmega * Math.cos(input.jump.settleOmega * settleAge) -
			input.jump.settleLambda * Math.sin(input.jump.settleOmega * settleAge))
	);
};

const sampleMaster = (
	input: TimeDelayReferenceInput,
	localFrame: number,
): TimeDelayReferenceMasterSample => {
	const phase = positiveModulo(
		localFrame + input.launchPhaseShift,
		input.periodFrames,
	);
	const tau = positiveModulo(
		phase - input.jump.liftoffPhase,
		input.periodFrames,
	);
	const velocityY = masterVelocityY(tau, input);
	const stretchY = 1 + input.body.stretchGain * Math.abs(velocityY);
	const halfPeriod = input.periodFrames / 2;
	const satelliteAge =
		positiveModulo(
			phase - input.satellite.separationPhase + halfPeriod,
			input.periodFrames,
		) - halfPeriod;
	const satellite =
		satelliteAge >= -input.satellite.preSeparationFrames &&
		satelliteAge < input.satellite.lifeFrames
			? {
					kind: "present" as const,
					ageFrames: satelliteAge,
					centerY:
						input.satellite.centerYAsymptote +
						(input.satellite.centerYAnchor - input.satellite.centerYAsymptote) *
							input.satellite.centerYRatio ** satelliteAge,
					radius:
						input.satellite.radiusAnchorPx *
						input.satellite.radiusDecay ** satelliteAge,
				}
			: { kind: "absent" as const };
	return {
		localFrame: positiveModulo(localFrame, input.periodFrames),
		phase,
		tau,
		body: {
			centerY: masterCenterY(tau, input),
			baseWidth: input.body.baseSizePx,
			height: input.body.baseSizePx * stretchY,
			velocityY,
			stretchY,
		},
		satellite,
	};
};

const isValidMasterSample = (
	value: TimeDelayReferenceMasterSample,
): boolean => {
	if (
		!hasFiniteValues([
			value.localFrame,
			value.phase,
			value.tau,
			value.body.centerY,
			value.body.baseWidth,
			value.body.height,
			value.body.velocityY,
			value.body.stretchY,
		]) ||
		value.body.baseWidth <= 0 ||
		value.body.height <= 0 ||
		value.body.stretchY < 1
	) {
		return false;
	}
	return (
		value.satellite.kind === "absent" ||
		(hasFiniteValues([
			value.satellite.ageFrames,
			value.satellite.centerY,
			value.satellite.radius,
		]) &&
			value.satellite.radius > 0)
	);
};

const sourceFrameForPhase = (
	input: TimeDelayReferenceInput,
	phase: number,
): number => positiveModulo(phase - input.launchPhaseShift, input.periodFrames);

const masterCriticalFrames = (
	input: TimeDelayReferenceInput,
): readonly MotionStudyReferenceCriticalFrame[] => {
	const continuityProbeFrames = criticalProbeFrames(input);
	if (continuityProbeFrames === null) return [];
	const landingPhase =
		input.jump.liftoffPhase + input.jump.riseFrames + input.jump.fallFrames;
	const firstSettleLowAge = firstSettleExtremumAge(input);
	return [
		{
			id: "liftoff-base",
			frame: sourceFrameForPhase(input, input.jump.liftoffPhase),
			purpose:
				"Body reaches its rest center at the named liftoff phase; the soft lift begins from this base.",
		},
		{
			id: "settle-tail-before-liftoff",
			frame: sourceFrameForPhase(
				input,
				input.jump.liftoffPhase - continuityProbeFrames,
			),
			purpose:
				"Immediately before the next liftoff, the body remains on the un-clamped seeded settle tail.",
		},
		{
			id: "apex",
			frame: sourceFrameForPhase(
				input,
				input.jump.liftoffPhase + input.jump.riseFrames,
			),
			purpose: "The master body reaches the rise-to-fall apex.",
		},
		{
			id: "landing-seed",
			frame: sourceFrameForPhase(input, landingPhase),
			purpose:
				"Landing restores the rest center and transfers the fall exit velocity into the settle.",
		},
		{
			id: "settle-low",
			frame: sourceFrameForPhase(input, landingPhase + firstSettleLowAge),
			purpose:
				"The first velocity-zero settle extremum proves the seeded decay rather than a separate key.",
		},
		{
			id: "satellite-pre-separation",
			frame: sourceFrameForPhase(
				input,
				input.satellite.separationPhase - input.satellite.preSeparationFrames,
			),
			purpose:
				"The satellite generator becomes visible in its bounded pre-separation window.",
		},
		{
			id: "satellite-separation",
			frame: sourceFrameForPhase(input, input.satellite.separationPhase),
			purpose: "The satellite reaches age zero at its named separation phase.",
		},
		{
			id: "satellite-last-live",
			frame: sourceFrameForPhase(
				input,
				input.satellite.separationPhase +
					input.satellite.lifeFrames -
					continuityProbeFrames,
			),
			purpose:
				"The bounded satellite remains present immediately before its declared lifetime ends.",
		},
		{
			id: "satellite-first-absent",
			frame: sourceFrameForPhase(
				input,
				input.satellite.separationPhase + input.satellite.lifeFrames,
			),
			purpose:
				"The satellite is absent at the exact end of its bounded lifetime.",
		},
	];
};

const delayedInput = (
	input: TimeDelayReferenceInput,
): DelayedReplayReferenceInput<TimeDelayReferenceMasterSample> => ({
	periodFrames: input.periodFrames,
	targets: input.targets.map((target) => ({
		targetId: target.targetId,
		roleId: target.bodyRoleId,
		delayFrames: target.delayFrames,
	})),
	masterCriticalFrames: masterCriticalFrames(input),
	sampleMaster: ({ localFrame }) => sampleMaster(input, localFrame),
	isMasterSampleValid: isValidMasterSample,
});

const sourceTargets = Array.from(
	{ length: 5 },
	(_, index): TimeDelayReferenceTarget => ({
		targetId: `dot-${index + 1}`,
		bodyRoleId: `body-${index + 1}`,
		satelliteRoleId: `satellite-${index + 1}`,
		delayFrames: index * 4,
		centerX: 101.3 + index * 34.275,
	}),
);

/**
 * Structural source-law sheet for the measured seeded-settle-jump study.
 *
 * It contains no fill, background, grain, or camera choice. Those visual facts
 * remain outside this construction-calibration oracle.
 */
export const DEFAULT_TIME_DELAY_REFERENCE_INPUT: TimeDelayReferenceInput = {
	periodFrames: 90,
	staggerFrames: 4,
	launchPhaseShift: 1,
	targets: sourceTargets,
	body: {
		restCenterY: 171.5,
		baseSizePx: 28.9,
		stretchGain: 0.0313,
	},
	jump: {
		liftoffPhase: 84.6,
		riseFrames: 19.69,
		fallFrames: 10.29,
		apexCenterY: 68.9,
		riseBezier: [0.746, 0.008, 0.196, 1],
		fallBezier: [0.79, 0, 0.789, 0.741],
		settleLambda: 0.17,
		settleOmega: 0.426,
	},
	satellite: {
		separationPhase: 29,
		preSeparationFrames: 3,
		lifeFrames: 18,
		radiusAnchorPx: 9.3,
		radiusDecay: 0.89,
		centerYAnchor: 155.3,
		centerYAsymptote: 119.1,
		centerYRatio: 0.901,
	},
};

const sameUnitBezier = (left: UnitBezier, right: UnitBezier): boolean =>
	left.every((value, index) => Object.is(value, right[index]));

/**
 * The current Vecmo Time Delay profile keeps its master construction fixed.
 * It can retime the period and individual instances, but cannot accept a new
 * rise/fall/settle/satellite master sheet through its binding parameters.
 */
export const usesCurrentTimeDelayProfileMasterLaw = (
	input: TimeDelayReferenceInput,
): boolean =>
	!inputIssue(input) &&
	Object.is(
		input.launchPhaseShift,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.launchPhaseShift,
	) &&
	Object.is(
		input.body.restCenterY,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.body.restCenterY,
	) &&
	Object.is(
		input.body.baseSizePx,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.body.baseSizePx,
	) &&
	Object.is(
		input.body.stretchGain,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.body.stretchGain,
	) &&
	Object.is(
		input.jump.liftoffPhase,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.liftoffPhase,
	) &&
	Object.is(
		input.jump.riseFrames,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.riseFrames,
	) &&
	Object.is(
		input.jump.fallFrames,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.fallFrames,
	) &&
	Object.is(
		input.jump.apexCenterY,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.apexCenterY,
	) &&
	sameUnitBezier(
		input.jump.riseBezier,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.riseBezier,
	) &&
	sameUnitBezier(
		input.jump.fallBezier,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.fallBezier,
	) &&
	Object.is(
		input.jump.settleLambda,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.settleLambda,
	) &&
	Object.is(
		input.jump.settleOmega,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.jump.settleOmega,
	) &&
	Object.is(
		input.satellite.separationPhase,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.separationPhase,
	) &&
	Object.is(
		input.satellite.preSeparationFrames,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.preSeparationFrames,
	) &&
	Object.is(
		input.satellite.lifeFrames,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.lifeFrames,
	) &&
	Object.is(
		input.satellite.radiusAnchorPx,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.radiusAnchorPx,
	) &&
	Object.is(
		input.satellite.radiusDecay,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.radiusDecay,
	) &&
	Object.is(
		input.satellite.centerYAnchor,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.centerYAnchor,
	) &&
	Object.is(
		input.satellite.centerYAsymptote,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.centerYAsymptote,
	) &&
	Object.is(
		input.satellite.centerYRatio,
		DEFAULT_TIME_DELAY_REFERENCE_INPUT.satellite.centerYRatio,
	);

/**
 * Samples the source-law Time Delay packet at one global comparison frame.
 *
 * The source evaluator is independent of the product Time Delay materializer.
 * It must remain out of the runtime sampler and document serialization path.
 */
export function sampleTimeDelayReference(
	input: TimeDelayReferenceInput,
	frame: number,
): MotionStudyReferenceResult<TimeDelayReferenceSample> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const targetsById = new Map(
		input.targets.map((target) => [target.targetId, target] as const),
	);
	const result = sampleDelayedReplayReference(delayedInput(input), frame);
	if (result.status === "blocked") return result;
	const samples: TimeDelayReferenceSample[] = [];
	for (const sample of result.samples) {
		const target = targetsById.get(sample.targetId);
		if (!target) {
			return blocked(
				"Time Delay replay emitted a target that is absent from the source sheet.",
			);
		}
		samples.push({
			targetId: sample.targetId,
			bodyRoleId: target.bodyRoleId,
			satelliteRoleId: target.satelliteRoleId,
			order: sample.order,
			delayFrames: sample.delayFrames,
			sourceFrame: sample.sourceFrame,
			centerX: target.centerX,
			master: sample.value,
		});
	}
	return { status: "ready", samples };
}

/**
 * Returns source and per-target critical frames for a Time Delay comparison.
 */
export function timeDelayReferenceCriticalFrames(
	input: TimeDelayReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	return delayedReplayReferenceCriticalFrames(delayedInput(input));
}

export const TIME_DELAY_REFERENCE_ORACLE = {
	id: TIME_DELAY_REFERENCE_LAW_ID,
	criticalFrames: timeDelayReferenceCriticalFrames,
	sample: sampleTimeDelayReference,
} satisfies MotionStudyReferenceOracle<
	TimeDelayReferenceInput,
	TimeDelayReferenceSample
>;
