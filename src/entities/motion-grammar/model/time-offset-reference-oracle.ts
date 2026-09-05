import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const TIME_OFFSET_REFERENCE_LAW_ID =
	"offset-stagger-conveyor-v1" as const;

type UnitBezier = readonly [number, number, number, number];

export type TimeOffsetReferenceSlot = {
	readonly targetId: string;
	readonly slotIndex: number;
	/** Radius-like value in the source SVG viewBox's drawing units. */
	readonly valueSvgUnits: number;
};

export type TimeOffsetReferenceOverride = {
	readonly duplicateClass: number;
	readonly slotIndex: number;
	/** Radius-like value in the source SVG viewBox's drawing units. */
	readonly valueSvgUnits: number;
};

/** Transient observation; never a serialized Motion Grammar payload. */
export type TimeOffsetReferenceInput = {
	readonly periodFrames: number;
	readonly subcycleFrames: number;
	readonly activeFrames: number;
	readonly easing: UnitBezier;
	readonly anchorCoordinateX: number;
	/** Observed page SVG `cx` addend; not a Vecmo origin/anchor contract. */
	readonly pageCxAddendX: number;
	/** Observed page SVG baseline coordinate; not sampled by the semantic law. */
	readonly pageBaselineY: number;
	/** Slot pitch in source SVG viewBox drawing units. */
	readonly spacingSvgUnits: number;
	readonly slots: readonly TimeOffsetReferenceSlot[];
	readonly overrides: readonly TimeOffsetReferenceOverride[];
	/** Served-page SVG render-presence cutoff (`value > .01`). */
	readonly pageRenderPresenceCutoffSvgUnits: number;
};

export type TimeOffsetReferenceSample = {
	readonly targetId: string;
	readonly slotIndex: number;
	readonly sourceFrame: number;
	readonly localFrame: number;
	readonly subcycleIndex: number;
	readonly withinSubcycleFrames: number;
	readonly duplicateClass: number;
	readonly progress: number;
	readonly profilePositionX: number;
	readonly profilePositionY: number;
	readonly coordinateX: number;
	readonly interpolatedValueSvgUnits: number;
	readonly pageRenderPresent: boolean;
};

export const TIME_OFFSET_PUBLIC_PAGE_CALIBRATION: TimeOffsetReferenceInput = {
	periodFrames: 90,
	subcycleFrames: 30,
	activeFrames: 18,
	easing: [0.58, 0.057, 0.415, 0.93],
	anchorCoordinateX: 46.1,
	// Observed page SVG placement: `cx = coord + (162 - 170.1)`.
	pageCxAddendX: 162 - 170.1,
	pageBaselineY: 162,
	spacingSvgUnits: 62,
	slots: [
		{ targetId: "offset-source-slot-1", slotIndex: 0, valueSvgUnits: 0 },
		{ targetId: "offset-source-slot-2", slotIndex: 1, valueSvgUnits: 15.9 },
		{ targetId: "offset-source-slot-3", slotIndex: 2, valueSvgUnits: 28.85 },
		{ targetId: "offset-source-slot-4", slotIndex: 3, valueSvgUnits: 15.9 },
		{ targetId: "offset-source-slot-5", slotIndex: 4, valueSvgUnits: 0 },
	],
	overrides: [{ duplicateClass: 1, slotIndex: 3, valueSvgUnits: 18.5 }],
	// Observed page filter (`value > .01`), not a product acceptance threshold.
	pageRenderPresenceCutoffSvgUnits: 0.01,
};

const positiveModulo = (value: number, modulo: number): number => {
	const remainder = value % modulo;
	return remainder < 0 ? remainder + modulo : remainder;
};

const unitBezierY = ([p1x, p1y, p2x, p2y]: UnitBezier, x: number): number => {
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

const isInteger = (value: number): boolean =>
	isFiniteReferenceNumber(value) && Number.isInteger(value);

const inputIssue = (input: TimeOffsetReferenceInput): string | null => {
	if (
		![input.periodFrames, input.subcycleFrames, input.activeFrames].every(
			isInteger,
		)
	) {
		return "Offset period, subcycle, and active durations must be finite integers.";
	}
	if (input.periodFrames <= 0 || input.subcycleFrames <= 0) {
		return "Offset period and subcycle durations must be positive.";
	}
	if (input.activeFrames <= 0 || input.activeFrames >= input.subcycleFrames) {
		return "Offset active duration must be positive and shorter than one subcycle so the hold phase is observable.";
	}
	if (input.periodFrames % input.subcycleFrames !== 0) {
		return "Offset period must contain an integer number of subcycles for a closed duplicate address.";
	}
	if (
		!input.easing.every(
			(value) => isFiniteReferenceNumber(value) && value >= 0 && value <= 1,
		)
	) {
		return "Offset easing must be a finite unit cubic-Bezier tuple.";
	}
	if (
		![
			input.anchorCoordinateX,
			input.pageCxAddendX,
			input.pageBaselineY,
			input.spacingSvgUnits,
			input.pageRenderPresenceCutoffSvgUnits,
		].every(isFiniteReferenceNumber)
	) {
		return "Offset coordinate, spacing, and visibility values must be finite.";
	}
	if (
		input.spacingSvgUnits <= 0 ||
		input.pageRenderPresenceCutoffSvgUnits < 0
	) {
		return "Offset spacing must be positive and visibility threshold non-negative.";
	}
	if (input.slots.length < 2) {
		return "Offset requires at least two ordered conveyor slots.";
	}
	const targetIds = new Set<string>();
	for (const [index, slot] of input.slots.entries()) {
		if (
			!slot.targetId ||
			targetIds.has(slot.targetId) ||
			slot.slotIndex !== index ||
			!isFiniteReferenceNumber(slot.valueSvgUnits) ||
			slot.valueSvgUnits < 0
		) {
			return "Offset slots must have unique ids, contiguous indices, and non-negative values.";
		}
		targetIds.add(slot.targetId);
	}
	const duplicateCount = input.periodFrames / input.subcycleFrames;
	const overrideKeys = new Set<string>();
	for (const override of input.overrides) {
		const key = `${override.duplicateClass}:${override.slotIndex}`;
		if (
			overrideKeys.has(key) ||
			!isInteger(override.duplicateClass) ||
			override.duplicateClass < 0 ||
			override.duplicateClass >= duplicateCount ||
			!isInteger(override.slotIndex) ||
			override.slotIndex < 0 ||
			override.slotIndex >= input.slots.length ||
			!isFiniteReferenceNumber(override.valueSvgUnits) ||
			override.valueSvgUnits < 0
		) {
			return "Offset overrides must address unique in-range duplicate/slot pairs.";
		}
		overrideKeys.add(key);
	}
	return null;
};

const slotValue = (
	input: TimeOffsetReferenceInput,
	slotIndex: number,
	duplicateClass: number,
): number => {
	const override = input.overrides.find(
		(candidate) =>
			candidate.duplicateClass === duplicateClass &&
			candidate.slotIndex === slotIndex,
	);
	if (override) return override.valueSvgUnits;
	return input.slots[slotIndex]?.valueSvgUnits ?? 0;
};

const duplicateClassFor = (
	input: TimeOffsetReferenceInput,
	subcycleIndex: number,
	slotIndex: number,
): number =>
	positiveModulo(
		subcycleIndex + slotIndex - (input.slots.length - 1),
		input.periodFrames / input.subcycleFrames,
	);

/** Center of the source coordinate carrier after page registration. */
export const timeOffsetReferenceCenterX = (
	input: TimeOffsetReferenceInput,
): number =>
	input.pageCxAddendX +
	input.anchorCoordinateX +
	((input.slots.length - 1) / 2) * input.spacingSvgUnits;

export function timeOffsetReferenceCriticalFrames(
	input: TimeOffsetReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return { status: "blocked", reason: issue };
	const holdFrame =
		input.activeFrames + (input.subcycleFrames - input.activeFrames) / 2;
	const frames: MotionStudyReferenceCriticalFrame[] = [
		{ id: "loop-start", frame: 0, purpose: "closed-loop opening address" },
		{
			id: "active-midpoint",
			frame: input.activeFrames / 2,
			purpose:
				"midpoint of adjacent-slot interpolation window; proves easing interior",
		},
		{
			id: "active-end",
			frame: input.activeFrames,
			purpose: "end of adjacent-slot interpolation window",
		},
		{
			id: "hold-midpoint",
			frame: holdFrame,
			purpose: "subcycle hold after the active interpolation window",
		},
		{
			id: "subcycle-boundary",
			frame: input.subcycleFrames,
			purpose: "duplicate-address increment",
		},
	];
	const duplicateCount = input.periodFrames / input.subcycleFrames;
	for (const [index, override] of input.overrides.entries()) {
		const subcycleIndex = positiveModulo(
			override.duplicateClass - override.slotIndex + (input.slots.length - 1),
			duplicateCount,
		);
		const frame = subcycleIndex * input.subcycleFrames;
		frames.push({
			id: `override-${index + 1}-entry`,
			frame,
			purpose: `duplicate ${override.duplicateClass} override enters slot ${override.slotIndex}`,
		});
		frames.push({
			id: `override-${index + 1}-active-end`,
			frame: frame + input.activeFrames,
			purpose: `duplicate ${override.duplicateClass} override reaches the active-window end`,
		});
		frames.push({
			id: `override-${index + 1}-active-midpoint`,
			frame: frame + input.activeFrames / 2,
			purpose: `duplicate ${override.duplicateClass} override midpoint handoff into slot ${override.slotIndex}`,
		});
	}
	frames.push({
		id: "loop-return",
		frame: input.periodFrames,
		purpose: "period seam maps back to local frame zero",
	});
	return { status: "ready", samples: frames };
}

/** Samples the independent public-page conveyor law at one frame. */
export function sampleTimeOffsetReference(
	input: TimeOffsetReferenceInput,
	frame: number,
): MotionStudyReferenceResult<TimeOffsetReferenceSample> {
	const issue = inputIssue(input);
	if (issue) return { status: "blocked", reason: issue };
	const localFrame = wrapReferenceFrame(frame, input.periodFrames);
	if (localFrame === null) {
		return { status: "blocked", reason: "Offset source frame must be finite." };
	}
	const subcycleIndex = Math.floor(localFrame / input.subcycleFrames);
	const withinSubcycleFrames =
		localFrame - subcycleIndex * input.subcycleFrames;
	const progress = unitBezierY(
		input.easing,
		Math.min(withinSubcycleFrames / input.activeFrames, 1),
	);
	const centerX = timeOffsetReferenceCenterX(input);
	const samples = input.slots.map((slot) => {
		const duplicateClass = duplicateClassFor(
			input,
			subcycleIndex,
			slot.slotIndex,
		);
		const from = slotValue(input, slot.slotIndex, duplicateClass);
		const to = slotValue(input, slot.slotIndex - 1, duplicateClass);
		const coordinateX =
			input.pageCxAddendX +
			input.anchorCoordinateX +
			input.spacingSvgUnits * (slot.slotIndex - progress);
		const interpolatedValueSvgUnits = from * (1 - progress) + to * progress;
		return {
			targetId: slot.targetId,
			slotIndex: slot.slotIndex,
			sourceFrame: frame,
			localFrame,
			subcycleIndex,
			withinSubcycleFrames,
			duplicateClass,
			progress,
			profilePositionX: coordinateX - centerX,
			profilePositionY: 0,
			coordinateX,
			interpolatedValueSvgUnits,
			pageRenderPresent:
				interpolatedValueSvgUnits > input.pageRenderPresenceCutoffSvgUnits,
		};
	});
	return { status: "ready", samples };
}

export const TIME_OFFSET_REFERENCE_ORACLE = {
	id: TIME_OFFSET_REFERENCE_LAW_ID,
	criticalFrames: timeOffsetReferenceCriticalFrames,
	sample: sampleTimeOffsetReference,
} as const;
