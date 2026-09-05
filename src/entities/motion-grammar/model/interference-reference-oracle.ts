import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const INTERFERENCE_REFERENCE_LAW_ID =
	"ring-dodge-interference-v1" as const;
export type InterferenceVec2 = { readonly x: number; readonly y: number };
export type InterferenceReferenceTarget = {
	readonly targetId: string;
	readonly index: number;
	readonly rest: InterferenceVec2;
};
export type InterferenceReferenceInput = {
	readonly periodFrames: number;
	readonly center: InterferenceVec2;
	readonly ringRadius: number;
	readonly pulseRadius: number;
	readonly phaseStepDegrees: number;
	readonly radialPush: number;
	readonly tangentialSlide: number;
	readonly falloffDistance: number;
	readonly falloffExponent: number;
	readonly minDistance: number;
	readonly scaleAmplitude: number;
	readonly opacityFloor: number;
	readonly driverPositionAt: (frame: number) => InterferenceVec2;
	readonly targets: readonly InterferenceReferenceTarget[];
};
export type InterferenceReferenceSample = {
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly driver: InterferenceVec2;
	readonly targets: readonly {
		readonly targetId: string;
		readonly position: InterferenceVec2;
		readonly scale: number;
		readonly opacity: number;
	}[];
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({ status: "blocked", reason });
const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const wrap = (value: number, period: number): number =>
	((value % period) + period) % period;

const inputIssue = (input: InterferenceReferenceInput): string | null => {
	const numbers = [
		input.periodFrames,
		input.center.x,
		input.center.y,
		input.ringRadius,
		input.pulseRadius,
		input.phaseStepDegrees,
		input.radialPush,
		input.tangentialSlide,
		input.falloffDistance,
		input.falloffExponent,
		input.minDistance,
		input.scaleAmplitude,
		input.opacityFloor,
	];
	if (!numbers.every(isFiniteReferenceNumber))
		return "Interference values must be finite.";
	if (
		input.periodFrames <= 0 ||
		input.ringRadius <= 0 ||
		input.falloffDistance <= 0 ||
		input.falloffExponent <= 0 ||
		input.minDistance < 0 ||
		input.opacityFloor < 0 ||
		input.opacityFloor > 1
	)
		return "Interference field bounds are invalid.";
	if (input.targets.length < 3)
		return "Interference requires a driver and at least two ring members.";
	return null;
};

export function interferenceReferenceCriticalFrames(
	input: InterferenceReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const quarter = input.periodFrames / 4;
	return {
		status: "ready",
		samples: [
			{ id: "loop-start", frame: 0, purpose: "ring clock start" },
			{ id: "pass-a", frame: quarter, purpose: "driver passes first quadrant" },
			{ id: "pass-b", frame: quarter * 2, purpose: "driver crosses ring axis" },
			{ id: "pass-c", frame: quarter * 3, purpose: "driver releases field" },
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "same driver/ring phase at seam",
			},
		],
	};
}

export function sampleInterferenceReference(
	input: InterferenceReferenceInput,
	frame: number,
): MotionStudyReferenceResult<InterferenceReferenceSample> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null) return blocked("Interference frame must be finite.");
	const driver = input.driverPositionAt(localFrame);
	const targets = input.targets
		.filter((target) => target.index >= 0)
		.map((target) => {
			const restVector = {
				x: target.rest.x - input.center.x,
				y: target.rest.y - input.center.y,
			};
			const angle = Math.atan2(restVector.y, restVector.x);
			const pulse =
				0.5 +
				0.5 *
					Math.sin(
						(2 * Math.PI * wrap(localFrame, input.periodFrames)) /
							input.periodFrames +
							(target.index * input.phaseStepDegrees * Math.PI) / 180,
					);
			const pre = {
				x:
					input.center.x +
					Math.cos(angle) * (input.ringRadius + input.pulseRadius * pulse),
				y:
					input.center.y +
					Math.sin(angle) * (input.ringRadius + input.pulseRadius * pulse),
			};
			const relation = { x: pre.x - driver.x, y: pre.y - driver.y };
			const distance = Math.max(
				input.minDistance,
				Math.hypot(relation.x, relation.y),
			);
			const falloff =
				clamp(1 - distance / input.falloffDistance, 0, 1) **
				input.falloffExponent;
			const normal = { x: relation.x / distance, y: relation.y / distance };
			const tangent = { x: -normal.y, y: normal.x };
			const position = {
				x:
					pre.x +
					normal.x * input.radialPush * falloff +
					tangent.x * input.tangentialSlide * falloff,
				y:
					pre.y +
					normal.y * input.radialPush * falloff +
					tangent.y * input.tangentialSlide * falloff,
			};
			return {
				targetId: target.targetId,
				position,
				scale: 1 + input.scaleAmplitude * pulse,
				opacity: input.opacityFloor + (1 - input.opacityFloor) * pulse,
			};
		});
	return {
		status: "ready",
		samples: [{ sourceFrame: frame, localFrame, driver, targets }],
	};
}

export const INTERFERENCE_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	InterferenceReferenceInput,
	InterferenceReferenceSample
> = {
	id: INTERFERENCE_REFERENCE_LAW_ID,
	criticalFrames: interferenceReferenceCriticalFrames,
	sample: sampleInterferenceReference,
};

const driverPosition = (frame: number): InterferenceVec2 => {
	const local = Math.min(96, Math.max(0, frame));
	const points = [
		{ frame: 0, x: 368, y: 180 },
		{ frame: 24, x: 320, y: 228 },
		{ frame: 48, x: 272, y: 180 },
		{ frame: 72, x: 320, y: 132 },
		{ frame: 96, x: 368, y: 180 },
	];
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index];
		const to = points[index + 1];
		if (local <= to.frame) {
			const progress = (local - from.frame) / (to.frame - from.frame);
			return {
				x: from.x + (to.x - from.x) * progress,
				y: from.y + (to.y - from.y) * progress,
			};
		}
	}
	return { x: 368, y: 180 };
};

const center = { x: 320, y: 180 } as const;
const ringTargets = Array.from({ length: 6 }, (_, index) => {
	const angle = (index / 6) * Math.PI * 2;
	return {
		targetId: `interference-ring-${index + 1}`,
		index,
		rest: {
			x: center.x + Math.cos(angle) * 110,
			y: center.y + Math.sin(angle) * 110,
		},
	};
});

export const INTERFERENCE_CONSTRUCTION_FIXTURE: InterferenceReferenceInput = {
	periodFrames: 96,
	center,
	ringRadius: 110,
	pulseRadius: 14,
	phaseStepDegrees: 28,
	radialPush: 30,
	tangentialSlide: 16,
	falloffDistance: 150,
	falloffExponent: 2,
	minDistance: 12,
	scaleAmplitude: 0.16,
	opacityFloor: 0.55,
	driverPositionAt: driverPosition,
	targets: ringTargets,
};
