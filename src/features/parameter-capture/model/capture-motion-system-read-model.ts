import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";
import type { MotionGrammarAuthoringProfileDescriptor } from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import { findCatalogEntry } from "@/entities/motion-grammar/model/catalog";
import type {
	MotionGrammarBinding,
	MotionGrammarParamSpec,
} from "@/entities/motion-grammar/model/types";

export type MotionSystemCaptureRowEmphasis =
	| "keyed"
	| "animated"
	| "changed"
	| "rest";

/**
 * One filmed row for a focused motion-system clip. Grammar parameters do not use
 * timeline keyframes directly, so rows keep the shared KEY/ANIM/LIVE shape while
 * marking non-default semantic values as changed.
 */
export type MotionSystemCaptureRow = {
	readonly id: string;
	readonly label: string;
	readonly displayValue: string;
	readonly deltaDisplay: string | null;
	readonly animated: boolean;
	readonly keyedAtFrame: boolean;
	readonly emphasis: MotionSystemCaptureRowEmphasis;
};

/**
 * Read-only capture projection for the focused grammar-backed motion clip. This
 * mirrors the Inspector's semantic authoring profile without importing Inspector
 * widget code into the filming HUD.
 */
export type MotionSystemCaptureTarget = {
	readonly clipId: string;
	readonly clipName: string;
	readonly techniqueLabel: string;
	readonly frame: number;
	readonly rows: readonly MotionSystemCaptureRow[];
	readonly activeRowCount: number;
};

const PARAMETER_LABELS: Readonly<Record<string, string>> = {
	angleOffset: "Angle offset deg",
	cadenceFrames: "Cadence frames",
	copies: "Copies",
	decay: "Opacity decay",
	delayFrames: "Delay frames",
	growFrames: "Grow frames",
	lookAheadFrames: "Look-ahead frames",
	maxScaleBoost: "Max scale boost",
	minProjection: "Projection floor",
	offsetMultiplier: "Offset multiplier",
	opacityFloor: "Opacity floor",
	periodFrames: "Period frames",
	phaseStaggerFrames: "Phase stagger frames",
	phaseStepDegrees: "Phase step deg",
	pulseFrames: "Pulse frames",
	radius: "Radius px",
	radiusPx: "Radius px",
	response: "Response",
	rotationDegrees: "Rotation deg",
	scaleAmplitude: "Scale amplitude",
	scaleFloor: "Scale floor",
	scalePerSpeed: "Scale per speed",
	splitDistance: "Split distance px",
	staggerFrames: "Stagger frames",
	strength: "Strength",
	tiltDegrees: "Tilt deg",
	wavelengthPx: "Wavelength px",
};

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const frameForCapture = (currentFrame: number): number =>
	Number.isFinite(currentFrame) ? Math.max(0, Math.round(currentFrame)) : 0;

const decimalsForStep = (step: number): number => {
	if (!Number.isFinite(step) || step <= 0 || step >= 1) return 0;
	return Math.min(4, Math.max(0, Math.ceil(Math.abs(Math.log10(step)))));
};

const formatNumber = (value: number, step = 1): string => {
	if (!Number.isFinite(value)) return "0";
	const decimals = decimalsForStep(step);
	if (decimals === 0) return String(Math.round(value));
	return String(Number(value.toFixed(decimals)));
};

const parameterLabel = (spec: MotionGrammarParamSpec): string =>
	PARAMETER_LABELS[spec.key] ?? spec.label;

const parameterUnit = (spec: MotionGrammarParamSpec): string => {
	const key = spec.key.toLowerCase();
	const label = spec.label.toLowerCase();
	if (key.endsWith("frames") || label.includes("frame")) return "f";
	if (key.endsWith("degrees") || label.includes("degree")) return "deg";
	if (key.endsWith("px") || key.includes("radius") || label.includes("px")) {
		return "px";
	}
	return "";
};

const deltaDisplay = (
	value: number,
	base: number,
	step: number,
	unit: string,
): string | null => {
	const delta = value - base;
	const tolerance = Math.max(0.01, Math.abs(step) / 2);
	if (!Number.isFinite(delta) || Math.abs(delta) < tolerance) return null;
	const prefix = delta > 0 ? "+" : "";
	return `${prefix}${formatNumber(delta, step)}${unit} from default`;
};

const row = ({
	id,
	label,
	displayValue,
	delta,
	emphasis,
}: {
	readonly id: string;
	readonly label: string;
	readonly displayValue: string;
	readonly delta: string | null;
	readonly emphasis: MotionSystemCaptureRowEmphasis;
}): MotionSystemCaptureRow => ({
	id,
	label,
	displayValue,
	deltaDisplay: delta,
	animated: false,
	keyedAtFrame: false,
	emphasis,
});

const clipTimingRows = (
	clip: AnimationClip,
	frame: number,
	profile: MotionGrammarAuthoringProfileDescriptor | undefined,
): readonly MotionSystemCaptureRow[] => {
	const duration = Math.max(1, clip.durationFrames);
	const rawLocalFrame = frame - clip.startFrame;
	const localFrame = clamp(rawLocalFrame, 0, duration - 1);
	const inClip = rawLocalFrame >= 0 && rawLocalFrame < duration;
	const progress =
		duration <= 1 ? 1 : clamp(localFrame / Math.max(1, duration - 1), 0, 1);
	const rows: MotionSystemCaptureRow[] = [
		row({
			id: "clip-start",
			label: "Start",
			displayValue: `${clip.startFrame}f`,
			delta:
				clip.startFrame === 0
					? "timeline start"
					: `+${clip.startFrame}f from 0`,
			emphasis: clip.startFrame === 0 ? "rest" : "changed",
		}),
		row({
			id: "clip-local-frame",
			label: "Local frame",
			displayValue: inClip ? `${localFrame + 1}f` : "out",
			delta: inClip
				? `${formatNumber(progress * 100, 1)}% through`
				: frame < clip.startFrame
					? "before clip"
					: "after clip",
			emphasis: inClip ? "changed" : "rest",
		}),
	];
	if (!profile?.timeline.durationParameterKey) {
		rows.push(
			row({
				id: "clip-duration",
				label: "Duration",
				displayValue: `${duration}f`,
				delta: "clip duration",
				emphasis: "changed",
			}),
		);
	}
	return rows;
};

const profileParameterSpecs = (
	profile: MotionGrammarAuthoringProfileDescriptor | undefined,
	binding: MotionGrammarBinding,
): readonly MotionGrammarParamSpec[] =>
	profile
		? profile.parameterGroups.flatMap((group) => group.parameters)
		: (findCatalogEntry(binding.techniqueId)?.params ?? []);

const parameterRow = ({
	spec,
	binding,
	clip,
	profile,
}: {
	readonly spec: MotionGrammarParamSpec;
	readonly binding: MotionGrammarBinding;
	readonly clip: AnimationClip;
	readonly profile: MotionGrammarAuthoringProfileDescriptor | undefined;
}): MotionSystemCaptureRow => {
	const unit = parameterUnit(spec);
	const isDurationParameter =
		spec.key === profile?.timeline.durationParameterKey;
	const value = isDurationParameter
		? clip.durationFrames
		: (binding.parameters[spec.key] ?? spec.default);
	const delta = deltaDisplay(value, spec.default, spec.step, unit);
	return row({
		id: `param:${spec.key}`,
		label: parameterLabel(spec),
		displayValue: `${formatNumber(value, spec.step)}${unit}`,
		delta,
		emphasis: delta ? "changed" : "rest",
	});
};

/**
 * Builds the read-only HUD target for the focused grammar-backed motion clip.
 * The selected clip remains the durable source for timing, while the matching
 * grammar binding/profile supplies the semantic authoring parameter list.
 */
export function buildMotionSystemCaptureTarget({
	motion,
	bindings,
	selectedClipId,
	currentFrame,
}: {
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly selectedClipId: string | null;
	readonly currentFrame: number;
}): MotionSystemCaptureTarget | null {
	if (!selectedClipId) return null;
	const clip =
		motion.clips.find((candidate) => candidate.id === selectedClipId) ?? null;
	if (!clip) return null;
	const provenance = clip.provenance;
	if (provenance?.source !== "motion-grammar") return null;
	const binding =
		bindings.find((candidate) => candidate.id === provenance.bindingId) ?? null;
	if (!binding) return null;
	const profile = describeMotionGrammarAuthoringProfile(binding);
	const frame = frameForCapture(currentFrame);
	const rows = [
		...clipTimingRows(clip, frame, profile),
		...profileParameterSpecs(profile, binding).map((spec) =>
			parameterRow({ spec, binding, clip, profile }),
		),
	];
	const techniqueLabel =
		profile?.label ??
		provenance.techniqueLabel ??
		findCatalogEntry(binding.techniqueId)?.label ??
		"Motion System";
	return {
		clipId: clip.id,
		clipName: clip.name,
		techniqueLabel,
		frame,
		rows,
		activeRowCount: rows.filter((item) => item.emphasis !== "rest").length,
	};
}
