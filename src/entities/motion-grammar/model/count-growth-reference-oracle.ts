import {
	isFiniteReferenceNumber,
	type MotionStudyReferenceCriticalFrame,
	type MotionStudyReferenceOracle,
	type MotionStudyReferenceResult,
	wrapReferenceFrame,
} from "./reference-law-oracle";

export const COUNT_GROWTH_REFERENCE_LAW_ID =
	"lattice-breath-group-reveal-v1" as const;

export type CountGrowthReferenceRole = "core" | "arm" | "edge" | "member";

export type CountGrowthReferencePoint = {
	readonly x: number;
	readonly y: number;
};

export type CountGrowthReferenceTarget = {
	readonly targetId: string;
	readonly role: CountGrowthReferenceRole;
	readonly rest: CountGrowthReferencePoint;
};

export type CountGrowthReferenceInput = {
	readonly periodFrames: number;
	readonly growFrames: number;
	readonly scaleFloor: number;
	readonly opacityFloor: number;
	readonly breathOpenFraction: number;
	readonly breathHoldFraction: number;
	readonly breathRadiusScale: number;
	readonly centerOffsetX: number;
	readonly centerOffsetY: number;
	readonly rotationDegrees: number;
	readonly edgeRailAmplitude: number;
	readonly groupStaggerFrames: number;
	readonly targets: readonly CountGrowthReferenceTarget[];
};

export type CountGrowthReferenceTargetSample = {
	readonly targetId: string;
	readonly role: CountGrowthReferenceRole;
	readonly position: CountGrowthReferencePoint;
	readonly rotation: number;
	readonly scale: number;
	readonly opacity: number;
	readonly masterBreath: number;
	readonly groupBreath: number;
	readonly apparentActive: boolean;
};

export type CountGrowthReferenceSample = {
	readonly sourceFrame: number;
	readonly targets: readonly CountGrowthReferenceTargetSample[];
};

const blocked = <TSample>(
	reason: string,
): MotionStudyReferenceResult<TSample> => ({
	status: "blocked",
	reason,
});

const GROUP_ROLES: readonly CountGrowthReferenceRole[] = [
	"core",
	"arm",
	"edge",
];

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const smoothstep = (value: number): number => {
	const t = clamp(value, 0, 1);
	return t * t * (3 - 2 * t);
};

const rotate = (
	point: CountGrowthReferencePoint,
	degrees: number,
): CountGrowthReferencePoint => {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return {
		x: point.x * cosine - point.y * sine,
		y: point.x * sine + point.y * cosine,
	};
};

const breathAt = (frame: number, input: CountGrowthReferenceInput): number => {
	const wrapped = wrapReferenceFrame(frame, input.periodFrames) ?? 0;
	const phase = wrapped / input.periodFrames;
	const open = clamp(input.breathOpenFraction, 0.05, 0.7);
	const hold = clamp(input.breathHoldFraction, 0, 0.7);
	const close = Math.max(0.05, 1 - open - hold);
	const total = open + hold + close;
	const openEnd = open / total;
	const holdEnd = (open + hold) / total;
	if (phase < openEnd) return smoothstep(phase / openEnd);
	if (phase < holdEnd) return 1;
	return smoothstep(1 - (phase - holdEnd) / (1 - holdEnd));
};

const inputIssue = (input: CountGrowthReferenceInput): string | null => {
	const numericValues = [
		input.periodFrames,
		input.growFrames,
		input.scaleFloor,
		input.opacityFloor,
		input.breathOpenFraction,
		input.breathHoldFraction,
		input.breathRadiusScale,
		input.centerOffsetX,
		input.centerOffsetY,
		input.rotationDegrees,
		input.edgeRailAmplitude,
		input.groupStaggerFrames,
	];
	if (!numericValues.every(isFiniteReferenceNumber)) {
		return "Count Growth timing, breath, layout, and reveal values must be finite.";
	}
	if (!Number.isInteger(input.periodFrames) || input.periodFrames <= 0) {
		return "Count Growth period must be a positive integer.";
	}
	if (!Number.isInteger(input.growFrames) || input.growFrames <= 0) {
		return "Count Growth grow duration must be a positive integer.";
	}
	if (input.scaleFloor < 0 || input.scaleFloor > 1) {
		return "Count Growth scale floor must be in [0, 1].";
	}
	if (input.opacityFloor < 0 || input.opacityFloor > 1) {
		return "Count Growth opacity floor must be in [0, 1].";
	}
	if (input.breathRadiusScale < 1) {
		return "Count Growth breath radius scale must be at least one.";
	}
	if (input.breathOpenFraction <= 0 || input.breathHoldFraction < 0) {
		return "Count Growth open and hold fractions must be non-negative with a positive opening.";
	}
	if (input.groupStaggerFrames < 0) {
		return "Count Growth group stagger must be non-negative.";
	}
	if (input.targets.length === 0)
		return "Count Growth requires at least one blueprint member.";
	const ids = new Set<string>();
	for (const target of input.targets) {
		if (
			!target.targetId ||
			ids.has(target.targetId) ||
			!isFiniteReferenceNumber(target.rest.x) ||
			!isFiniteReferenceNumber(target.rest.y)
		) {
			return "Count Growth blueprint members need unique ids and finite rest points.";
		}
		ids.add(target.targetId);
	}
	return null;
};

type Group = {
	readonly role: CountGrowthReferenceRole;
	readonly targets: readonly CountGrowthReferenceTarget[];
};

const groupsFor = (
	targets: readonly CountGrowthReferenceTarget[],
): readonly Group[] => {
	const explicit = GROUP_ROLES.map((role) => ({
		role,
		targets: targets.filter((target) => target.role === role),
	})).filter((group) => group.targets.length > 0);
	if (explicit.length > 0) {
		const members = targets.filter((target) => target.role === "member");
		return members.length > 0
			? [...explicit, { role: "member", targets: members }]
			: explicit;
	}
	return GROUP_ROLES.map((role, groupIndex) => ({
		role,
		targets: targets.filter(
			(_target, index) => index % GROUP_ROLES.length === groupIndex,
		),
	}));
};

const sampleAt = (
	input: CountGrowthReferenceInput,
	frame: number,
): MotionStudyReferenceResult<CountGrowthReferenceSample> => {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	if (!isFiniteReferenceNumber(frame))
		return blocked("Count Growth source frame must be finite.");
	const center = input.targets.reduce(
		(sum, target) => ({ x: sum.x + target.rest.x, y: sum.y + target.rest.y }),
		{ x: 0, y: 0 },
	);
	center.x /= input.targets.length;
	center.y /= input.targets.length;
	center.x += input.centerOffsetX;
	center.y += input.centerOffsetY;
	const masterBreath = breathAt(frame, input);
	const groups = groupsFor(input.targets);
	const targets: CountGrowthReferenceTargetSample[] = [];
	for (const [groupIndex, group] of groups.entries()) {
		const groupBreath = breathAt(
			frame - groupIndex * input.groupStaggerFrames,
			input,
		);
		const visible = smoothstep(
			Math.min(1, (groupBreath * input.periodFrames) / input.growFrames),
		);
		const rotation = input.rotationDegrees * masterBreath;
		for (const [targetIndex, target] of group.targets.entries()) {
			const delta = {
				x: target.rest.x - center.x,
				y: target.rest.y - center.y,
			};
			const length = Math.hypot(delta.x, delta.y);
			const radial =
				length > 0.001
					? delta
					: {
							x: Math.cos(
								(targetIndex / Math.max(1, group.targets.length)) * Math.PI * 2,
							),
							y: Math.sin(
								(targetIndex / Math.max(1, group.targets.length)) * Math.PI * 2,
							),
						};
			const posed = rotate(
				{
					x: radial.x * (1 + (input.breathRadiusScale - 1) * masterBreath),
					y: radial.y * (1 + (input.breathRadiusScale - 1) * masterBreath),
				},
				rotation,
			);
			const rail =
				group.role === "edge"
					? input.edgeRailAmplitude *
						Math.sin(masterBreath * Math.PI) *
						groupBreath
					: 0;
			const lengthForRail = Math.max(length, 0.001);
			const tangent = {
				x: -delta.y / lengthForRail,
				y: delta.x / lengthForRail,
			};
			targets.push({
				targetId: target.targetId,
				role: target.role,
				position: {
					x: center.x + posed.x + tangent.x * rail,
					y: center.y + posed.y + tangent.y * rail,
				},
				rotation,
				scale: input.scaleFloor + (1 - input.scaleFloor) * visible,
				opacity: input.opacityFloor + (1 - input.opacityFloor) * visible,
				masterBreath,
				groupBreath,
				apparentActive: visible >= 0.5,
			});
		}
	}
	return { status: "ready", samples: [{ sourceFrame: frame, targets }] };
};

export function countGrowthReferenceCriticalFrames(
	input: CountGrowthReferenceInput,
): MotionStudyReferenceResult<MotionStudyReferenceCriticalFrame> {
	const issue = inputIssue(input);
	if (issue) return blocked(issue);
	const openFrame =
		input.periodFrames * clamp(input.breathOpenFraction, 0.05, 0.7);
	const holdFrame =
		input.periodFrames *
		(clamp(input.breathOpenFraction, 0.05, 0.7) +
			clamp(input.breathHoldFraction, 0, 0.7) / 2);
	const closeStart =
		input.periodFrames *
		(clamp(input.breathOpenFraction, 0.05, 0.7) +
			clamp(input.breathHoldFraction, 0, 0.7));
	return {
		status: "ready",
		samples: [
			{
				id: "loop-start",
				frame: 0,
				purpose: "closed lattice and blueprint membership",
			},
			{
				id: "open-midpoint",
				frame: openFrame / 2,
				purpose: "master breath opening",
			},
			{
				id: "hold-midpoint",
				frame: holdFrame,
				purpose: "stable open lattice hold",
			},
			{
				id: "group-stagger",
				frame: input.groupStaggerFrames,
				purpose: "group-local reveal offset",
			},
			{
				id: "close-midpoint",
				frame: closeStart + (input.periodFrames - closeStart) / 2,
				purpose: "lattice close and rail return",
			},
			{
				id: "loop-seam",
				frame: input.periodFrames,
				purpose: "closed seam equals loop start",
			},
		],
	};
}

export function sampleCountGrowthReference(
	input: CountGrowthReferenceInput,
	frame: number,
): MotionStudyReferenceResult<CountGrowthReferenceSample> {
	return sampleAt(input, frame);
}

export const COUNT_GROWTH_REFERENCE_ORACLE: MotionStudyReferenceOracle<
	CountGrowthReferenceInput,
	CountGrowthReferenceSample
> = {
	id: COUNT_GROWTH_REFERENCE_LAW_ID,
	criticalFrames: countGrowthReferenceCriticalFrames,
	sample: sampleCountGrowthReference,
};
