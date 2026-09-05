import type {
	AeKeyframe,
	AeTemporalEasePoint,
} from "@/shared/glammer/keyframe-track";
import type { AnimatableValue } from "./types";

/**
 * Timing presets the timeline exposes. They are an authoring vocabulary on top of
 * the vendored After Effects keyframe model: each preset is expressed purely as
 * temporal-ease influence, so the frozen glammer sampler renders them with no
 * custom curve code.
 *
 * Easing is a property of the *segment* between two keys. The glammer sampler
 * derives a segment's curve from the left key's out-handle (start, x1) and the
 * right key's in-handle (end, x2). The preset names follow CSS semantics:
 * `easeIn` = slow start, `easeOut` = slow end.
 */
export const EASING_PRESETS = [
	"linear",
	"easeIn",
	"easeOut",
	"easeInOut",
] as const;

export type EasingPreset = (typeof EASING_PRESETS)[number];

export type SegmentEasingKind = EasingPreset | "custom";

/**
 * Sampler-compatible temporal cubic. The four authored handles define normalized
 * time/value control points `(0,0) -> (x1,y1) -> (x2,y2) -> (1,1)`; y may leave
 * 0..1 to express value overshoot while x remains monotonic in normalized time.
 */
export type EasingCurve = {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
};

export type EasingCurveInfluence = {
	/** Out-handle influence on the segment's left key, expressed as 0..100%. */
	readonly outInfluence: number;
	/** In-handle influence on the segment's right key, expressed as 0..100%. */
	readonly inInfluence: number;
};

/** User-facing intent bucket for semantic timing templates. */
export type MotionTimingTemplateFamily =
	| "neutral"
	| "commit"
	| "absorb"
	| "transfer"
	| "snap"
	| "follow"
	| "settle"
	| "loop";

/** Whether one authoring surface can honestly apply a timing template. */
export type MotionTimingTemplateApplicability =
	| "primary"
	| "fallback"
	| "unsupported";

/** Small preview renderer families used by compact timeline controls. */
export type MotionTimingTemplatePreviewKind =
	| "dot-path"
	| "value-curve"
	| "profile-loop";

/** Normalized point sampled for a non-mutating timing-template preview. */
export type MotionTimingTemplatePreviewPoint = {
	readonly x: number;
	readonly y: number;
};

/** Normalized cubic-bezier payload used by expression-backed motion profiles. */
export type MotionTimingTemplateUnitBezier = {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
};

/** Optional key insertion contract for templates that need a visible hold beat. */
export type MotionTimingTemplateKeyframeHold = {
	readonly progress: number;
	readonly minGapFrames: number;
	readonly source: "right-key-value";
};

/** Runtime timing data carried by a semantic template before surface compiling. */
export type MotionTimingTemplatePayload =
	| {
			readonly kind: "ae-segment";
			readonly outInfluence: number;
			readonly inInfluence: number;
			readonly preset?: EasingPreset;
	  }
	| {
			readonly kind: "unit-bezier";
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
	  }
	| {
			readonly kind: "settle-profile";
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly lambda: number;
			readonly omega: number;
	  }
	| {
			readonly kind: "stagger-profile";
			readonly delayBias: number;
	  }
	| {
			readonly kind: "phase-profile";
			readonly seamBias: number;
	  };

/** Semantic timing template shared by timeline UI, motion grammar, and agents. */
export type MotionTimingTemplate = {
	readonly id: string;
	readonly label: string;
	readonly uiLabel: string;
	readonly family: MotionTimingTemplateFamily;
	readonly intent: string;
	readonly force: string;
	readonly beatRoles: readonly string[];
	readonly signature: string;
	readonly preview: {
		readonly kind: MotionTimingTemplatePreviewKind;
		readonly sampleCount: number;
	};
	readonly applicability: {
		readonly keyframeSegment: MotionTimingTemplateApplicability;
		readonly grammarProfile: MotionTimingTemplateApplicability;
		readonly agentCommand: MotionTimingTemplateApplicability;
	};
	readonly payload: MotionTimingTemplatePayload;
	readonly keyframeHold?: MotionTimingTemplateKeyframeHold;
	readonly keyframeFallbackId?: string;
};

export const DEFAULT_EASING: EasingPreset = "easeInOut";

// AE interpolation type codes (mirror KeyframeInterpolationType in glammer).
const LINEAR_INTERP = 6612;
const BEZIER_INTERP = 6613;

// Influence percent applied to an eased side. AE "Easy Ease" uses 33.33; a higher
// value makes the four presets read as visibly distinct motion in the editor.
const EASE_INFLUENCE = 66.67;
const NO_INFLUENCE = 0;
const MAX_INFLUENCE = 100;
const DEFAULT_LEFT_X = 0;
const DEFAULT_RIGHT_X = 1;
const MIN_CURVE_Y = -4;
const MAX_CURVE_Y = 5;
const CURVE_TOLERANCE = 0.01;
// Presets retain the legacy zero-speed metadata while exact value behavior lives
// in the authored four-handle temporal curve.
const EASE_SPEED = 0;

type SegmentSides = {
	/** Out-handle influence on the segment's left key (controls the start). */
	readonly left: number;
	/** In-handle influence on the segment's right key (controls the end). */
	readonly right: number;
};

const SEGMENT_INFLUENCE: Record<EasingPreset, SegmentSides> = {
	linear: { left: NO_INFLUENCE, right: NO_INFLUENCE },
	easeIn: { left: EASE_INFLUENCE, right: NO_INFLUENCE },
	easeOut: { left: NO_INFLUENCE, right: EASE_INFLUENCE },
	easeInOut: { left: EASE_INFLUENCE, right: EASE_INFLUENCE },
};

/** Canonical semantic timing templates; UI labels are author-facing, not math names. */
export const MOTION_TIMING_TEMPLATES = [
	{
		id: "neutral.linear",
		label: "Linear",
		uiLabel: "Linear",
		family: "neutral",
		intent: "Move at an even rate without authored pressure.",
		force: "No acceleration bias; the beat reads mechanical or exact.",
		beatRoles: ["debug", "mechanical sweep", "constant reveal"],
		signature: "Even progress from start to end.",
		preview: { kind: "value-curve", sampleCount: 18 },
		applicability: {
			keyframeSegment: "primary",
			grammarProfile: "fallback",
			agentCommand: "primary",
		},
		payload: {
			kind: "ae-segment",
			outInfluence: NO_INFLUENCE,
			inInfluence: NO_INFLUENCE,
			preset: "linear",
		},
	},
	{
		id: "commit.fast-exit",
		label: "Ease In",
		uiLabel: "Ease in",
		family: "commit",
		intent: "Build speed into a decisive departure or handoff.",
		force: "The beat starts controlled, then commits forcefully.",
		beatRoles: ["exit", "launch", "handoff"],
		signature: "Slow start, fast finish.",
		preview: { kind: "dot-path", sampleCount: 18 },
		applicability: {
			keyframeSegment: "primary",
			grammarProfile: "fallback",
			agentCommand: "primary",
		},
		payload: {
			kind: "ae-segment",
			outInfluence: EASE_INFLUENCE,
			inInfluence: NO_INFLUENCE,
			preset: "easeIn",
		},
	},
	{
		id: "absorb.soft-land",
		label: "Ease Out",
		uiLabel: "Ease out",
		family: "absorb",
		intent: "Arrive with a readable slowdown.",
		force: "The target absorbs momentum instead of stopping abruptly.",
		beatRoles: ["enter", "land", "collect", "attract"],
		signature: "Fast start, controlled finish.",
		preview: { kind: "dot-path", sampleCount: 18 },
		applicability: {
			keyframeSegment: "primary",
			grammarProfile: "fallback",
			agentCommand: "primary",
		},
		payload: {
			kind: "ae-segment",
			outInfluence: NO_INFLUENCE,
			inInfluence: EASE_INFLUENCE,
			preset: "easeOut",
		},
	},
	{
		id: "transfer.gather-release",
		label: "Ease In-Out",
		uiLabel: "Ease in-out",
		family: "transfer",
		intent: "Compress attention before passing force to the next role.",
		force: "The beat gathers, crosses the midpoint, then settles into handoff.",
		beatRoles: ["morph", "group reflow", "role handoff"],
		signature: "Symmetric acceleration and deceleration.",
		preview: { kind: "value-curve", sampleCount: 18 },
		applicability: {
			keyframeSegment: "primary",
			grammarProfile: "primary",
			agentCommand: "primary",
		},
		payload: {
			kind: "ae-segment",
			outInfluence: EASE_INFLUENCE,
			inInfluence: EASE_INFLUENCE,
			preset: "easeInOut",
		},
	},
	{
		id: "snap.quick-lock",
		label: "Snap Hold",
		uiLabel: "Snap hold",
		family: "snap",
		intent: "Reach a state quickly enough that the hold becomes the proof.",
		force: "The beat snaps into place and spends time confirming the state.",
		beatRoles: ["latch", "impact", "state stop"],
		signature: "Short move with a hard-feeling finish.",
		preview: { kind: "dot-path", sampleCount: 18 },
		applicability: {
			keyframeSegment: "fallback",
			grammarProfile: "fallback",
			agentCommand: "fallback",
		},
		payload: {
			kind: "ae-segment",
			outInfluence: 18,
			inInfluence: 88,
		},
		keyframeHold: {
			progress: 0.42,
			minGapFrames: 2,
			source: "right-key-value",
		},
	},
	{
		id: "follow.stagger-inherit",
		label: "Follow With Lag",
		uiLabel: "Follow with lag",
		family: "follow",
		intent: "Let followers inherit a source beat later.",
		force: "The source moves first; copies or followers receive delayed force.",
		beatRoles: ["tail", "follower", "echo"],
		signature: "Shared timing with visible offset.",
		preview: { kind: "profile-loop", sampleCount: 18 },
		applicability: {
			keyframeSegment: "unsupported",
			grammarProfile: "primary",
			agentCommand: "unsupported",
		},
		payload: { kind: "stagger-profile", delayBias: 1 },
		keyframeFallbackId: "absorb.soft-land",
	},
	{
		id: "settle.velocity-land",
		label: "Settle After Impact",
		uiLabel: "Settle after impact",
		family: "settle",
		intent: "Overshoot, recoil, and resolve after a landing or hit.",
		force: "Velocity continues past the target, then decays into rest.",
		beatRoles: ["bounce", "recoil", "landing"],
		signature: "Overshoot with damped resolution.",
		preview: { kind: "profile-loop", sampleCount: 24 },
		applicability: {
			keyframeSegment: "unsupported",
			grammarProfile: "primary",
			agentCommand: "unsupported",
		},
		payload: {
			kind: "settle-profile",
			x1: 0.79,
			y1: 0,
			x2: 0.789,
			y2: 0.741,
			lambda: 0.17,
			omega: 0.426,
		},
		keyframeFallbackId: "absorb.soft-land",
	},
	{
		id: "loop.phase-continuity",
		label: "Phase Loop",
		uiLabel: "Phase loop",
		family: "loop",
		intent: "Keep cyclic motion continuous across the loop seam.",
		force:
			"The end of the phrase inherits the same phase pressure as the start.",
		beatRoles: ["cycle", "echo", "loop seam"],
		signature: "Seam-aware phase continuity.",
		preview: { kind: "profile-loop", sampleCount: 24 },
		applicability: {
			keyframeSegment: "unsupported",
			grammarProfile: "primary",
			agentCommand: "unsupported",
		},
		payload: { kind: "phase-profile", seamBias: 1 },
		keyframeFallbackId: "transfer.gather-release",
	},
	{
		id: "loop.echo-sweep",
		label: "Echo Sweep",
		uiLabel: "Echo sweep",
		family: "loop",
		intent: "Sweep one authored source while echoes replay the same pressure.",
		force:
			"The source completes a controlled sweep and every echo inherits that curve later.",
		beatRoles: ["orbit sweep", "afterimage source", "echo tail"],
		signature: "Fast rotational sweep with a resolved loop handoff.",
		preview: { kind: "profile-loop", sampleCount: 24 },
		applicability: {
			keyframeSegment: "unsupported",
			grammarProfile: "primary",
			agentCommand: "unsupported",
		},
		payload: {
			kind: "unit-bezier",
			x1: 0.72,
			y1: 0.02,
			x2: 0.2,
			y2: 1,
		},
	},
] as const satisfies readonly MotionTimingTemplate[];

/** Stable id of a canonical semantic timing template. */
export type MotionTimingTemplateId =
	(typeof MOTION_TIMING_TEMPLATES)[number]["id"];

const ALL_MOTION_TIMING_TEMPLATES: readonly MotionTimingTemplate[] =
	MOTION_TIMING_TEMPLATES;

/** Current segment timing readback: known semantic template or custom handles. */
export type SegmentTimingTemplateKind = MotionTimingTemplateId | "custom";

/** Keyframe-segment easing emitted by compiling a semantic template. */
export type MotionTimingTemplateKeyframeEasing =
	| { readonly kind: "preset"; readonly preset: EasingPreset }
	| { readonly kind: "curve"; readonly curve: EasingCurve };

/** Result of compiling a semantic template for the current keyframe segment model. */
export type MotionTimingTemplateKeyframeCompileResult =
	| {
			readonly status: "ready";
			readonly template: MotionTimingTemplate;
			readonly easing: MotionTimingTemplateKeyframeEasing;
	  }
	| { readonly status: "unknown"; readonly templateId: string }
	| {
			readonly status: "unsupported";
			readonly template: MotionTimingTemplate;
			readonly reason: string;
	  };

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const finiteOr = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const normalizeInfluence = (value: number): number =>
	clamp(finiteOr(value, NO_INFLUENCE), NO_INFLUENCE, MAX_INFLUENCE);

const normalizeUnit = (value: number, fallback: number): number =>
	clamp(finiteOr(value, fallback), 0, 1);

const influencesToCurve = (
	outInfluence: number,
	inInfluence: number,
): EasingCurve => ({
	x1: normalizeInfluence(outInfluence) / MAX_INFLUENCE,
	y1: 0,
	x2: 1 - normalizeInfluence(inInfluence) / MAX_INFLUENCE,
	y2: 1,
});

const curveToInfluences = (curve: EasingCurve): EasingCurveInfluence => ({
	outInfluence: normalizeUnit(curve.x1, DEFAULT_LEFT_X) * MAX_INFLUENCE,
	inInfluence: (1 - normalizeUnit(curve.x2, DEFAULT_RIGHT_X)) * MAX_INFLUENCE,
});

const easePoint = (influence: number): AeTemporalEasePoint[] => [
	{ speed: EASE_SPEED, influence },
];

const interpFor = (influence: number): number =>
	influence > NO_INFLUENCE ? BEZIER_INTERP : LINEAR_INTERP;

const withOut = <V extends AnimatableValue>(
	keyframe: AeKeyframe<V>,
	influence: number,
): AeKeyframe<V> => {
	const { outTemporalCurve: _outTemporalCurve, ...legacy } = keyframe;
	return {
		...legacy,
		outInterpolationType: interpFor(influence),
		outTemporalEase: easePoint(influence),
	};
};

const withIn = <V extends AnimatableValue>(
	keyframe: AeKeyframe<V>,
	influence: number,
): AeKeyframe<V> => ({
	...keyframe,
	inInterpolationType: interpFor(influence),
	inTemporalEase: easePoint(influence),
});

/**
 * Stamps a freshly authored keyframe with a smooth symmetric default so the first
 * motion a user records eases on both sides instead of snapping linearly.
 */
export function defaultEasedKeyframe<V extends AnimatableValue>(
	keyframe: AeKeyframe<V>,
): AeKeyframe<V> {
	return withIn(withOut(keyframe, EASE_INFLUENCE), EASE_INFLUENCE);
}

/**
 * Normalizes UI-authored control points into the exact monotonic-time cubic the
 * motion sampler persists. X remains within normalized segment time while Y may
 * overshoot within a deliberately bounded authoring range.
 */
export function normalizeEasingCurve(curve: EasingCurve): EasingCurve {
	return {
		x1: normalizeUnit(curve.x1, DEFAULT_LEFT_X),
		y1: clamp(finiteOr(curve.y1, 0), MIN_CURVE_Y, MAX_CURVE_Y),
		x2: normalizeUnit(curve.x2, DEFAULT_RIGHT_X),
		y2: clamp(finiteOr(curve.y2, 1), MIN_CURVE_Y, MAX_CURVE_Y),
	};
}

/** Finds one semantic timing template by stable id. */
export function findMotionTimingTemplate(
	templateId: string,
): MotionTimingTemplate | undefined {
	return ALL_MOTION_TIMING_TEMPLATES.find(
		(template) => template.id === templateId,
	);
}

/** Templates that the current keyframe-segment surface can honestly apply. */
export function motionTimingTemplatesForKeyframeSegment(): readonly MotionTimingTemplate[] {
	return ALL_MOTION_TIMING_TEMPLATES.filter(
		(template) => template.applicability.keyframeSegment !== "unsupported",
	);
}

/** Templates that can be consumed honestly by expression/profile motion systems. */
export function motionTimingTemplatesForGrammarProfile(): readonly MotionTimingTemplate[] {
	return ALL_MOTION_TIMING_TEMPLATES.filter(
		(template) => template.applicability.grammarProfile !== "unsupported",
	);
}

const motionTimingTemplatePayloadCurve = (
	payload: MotionTimingTemplatePayload,
): EasingCurve | null => {
	if (payload.kind !== "ae-segment") return null;
	return influencesToCurve(payload.outInfluence, payload.inInfluence);
};

const motionTimingTemplatePayloadUnitBezier = (
	payload: MotionTimingTemplatePayload,
): MotionTimingTemplateUnitBezier | null => {
	if (payload.kind === "ae-segment") {
		return influencesToCurve(payload.outInfluence, payload.inInfluence);
	}
	if (payload.kind === "unit-bezier" || payload.kind === "settle-profile") {
		return {
			x1: payload.x1,
			y1: payload.y1,
			x2: payload.x2,
			y2: payload.y2,
		};
	}
	return null;
};

const keyframeEasingForTemplate = (
	template: MotionTimingTemplate,
): MotionTimingTemplateKeyframeEasing | null => {
	const { payload } = template;
	if (payload.kind !== "ae-segment") return null;
	if (payload.preset) return { kind: "preset", preset: payload.preset };
	return {
		kind: "curve",
		curve: influencesToCurve(payload.outInfluence, payload.inInfluence),
	};
};

/**
 * Compiles a semantic timing template into the current keyframe-segment timing
 * contract. Rich profile templates report unsupported instead of pretending that
 * an x-only segment curve can preserve lag, phase continuity, or settle physics.
 */
export function compileMotionTimingTemplateForKeyframe(
	templateId: string,
): MotionTimingTemplateKeyframeCompileResult {
	const template = findMotionTimingTemplate(templateId);
	if (!template) return { status: "unknown", templateId };
	if (template.applicability.keyframeSegment === "unsupported") {
		return {
			status: "unsupported",
			template,
			reason: `${template.uiLabel} requires a motion profile surface.`,
		};
	}
	const easing = keyframeEasingForTemplate(template);
	if (!easing) {
		return {
			status: "unsupported",
			template,
			reason: `${template.uiLabel} cannot be represented by a keyframe segment.`,
		};
	}
	return { status: "ready", template, easing };
}

/**
 * Returns the unit cubic represented by a semantic template for expression-backed
 * profiles. Templates such as stagger or phase loops are profile semantics, not a
 * single cubic, and intentionally return `undefined`.
 */
export function motionTimingTemplateUnitBezierOf(
	templateId: string,
): MotionTimingTemplateUnitBezier | undefined {
	const template = findMotionTimingTemplate(templateId);
	return template
		? (motionTimingTemplatePayloadUnitBezier(template.payload) ?? undefined)
		: undefined;
}

/** Hold-key insertion metadata for segment-compatible semantic templates. */
export function motionTimingTemplateKeyframeHoldOf(
	templateId: string,
): MotionTimingTemplateKeyframeHold | undefined {
	return findMotionTimingTemplate(templateId)?.keyframeHold;
}

/** Returns the exact curve represented by a timing preset in the sampler. */
export function easingCurveForPreset(preset: EasingPreset): EasingCurve {
	const sides = SEGMENT_INFLUENCE[preset];
	return influencesToCurve(sides.left, sides.right);
}

/**
 * Converts a sampler-compatible curve into the temporal influence pair stored on
 * the neighboring AE keyframes for a segment.
 */
export function easingCurveInfluenceOf(
	curve: EasingCurve,
): EasingCurveInfluence {
	return curveToInfluences(normalizeEasingCurve(curve));
}

/**
 * Applies a preset to the segment between `left` and `right`. Returns rewritten
 * copies; `right` is `undefined` for the final key (no outgoing segment), in
 * which case only the left key's out-handle is touched.
 */
export function withSegmentEasing<V extends AnimatableValue>(
	left: AeKeyframe<V>,
	right: AeKeyframe<V> | undefined,
	preset: EasingPreset,
): { readonly left: AeKeyframe<V>; readonly right: AeKeyframe<V> | undefined } {
	const sides = SEGMENT_INFLUENCE[preset];
	return {
		left: withOut(left, sides.left),
		right: right ? withIn(right, sides.right) : undefined,
	};
}

/**
 * Applies an exact custom cubic curve to the segment between two keys. Legacy AE
 * influence remains synchronized for import/readback, while the outgoing key's
 * normalized curve is the sampler truth for non-zero speed and overshoot.
 */
export function withSegmentEasingCurve<V extends AnimatableValue>(
	left: AeKeyframe<V>,
	right: AeKeyframe<V> | undefined,
	curve: EasingCurve,
): { readonly left: AeKeyframe<V>; readonly right: AeKeyframe<V> | undefined } {
	const influence = easingCurveInfluenceOf(curve);
	const normalized = normalizeEasingCurve(curve);
	return {
		left: {
			...withOut(left, influence.outInfluence),
			outInterpolationType: BEZIER_INTERP,
			outTemporalCurve: normalized,
		},
		right: right ? withIn(right, influence.inInfluence) : undefined,
	};
}

const averageInfluence = (
	eases: readonly AeTemporalEasePoint[] | undefined,
): number => {
	if (!eases?.length) return NO_INFLUENCE;
	return normalizeInfluence(
		eases.reduce((sum, ease) => sum + ease.influence, 0) / eases.length,
	);
};

const segmentInfluenceOf = <V extends AnimatableValue>(
	left: AeKeyframe<V>,
	right: AeKeyframe<V> | undefined,
): EasingCurveInfluence => ({
	outInfluence: averageInfluence(left.outTemporalEase),
	inInfluence: right ? averageInfluence(right.inTemporalEase) : NO_INFLUENCE,
});

const isPresetInfluence = (
	influence: EasingCurveInfluence,
	preset: EasingPreset,
): boolean => {
	const sides = SEGMENT_INFLUENCE[preset];
	return (
		Math.abs(influence.outInfluence - sides.left) <= CURVE_TOLERANCE &&
		Math.abs(influence.inInfluence - sides.right) <= CURVE_TOLERANCE
	);
};

/**
 * Recovers the preset describing the segment between `left` and `right` so the
 * timeline can show the active timing without persisting a redundant label.
 * Non-preset handle pairs report `custom`; the final key (no right neighbor)
 * reports `linear`.
 */
export function segmentEasingOf<V extends AnimatableValue>(
	left: AeKeyframe<V>,
	right: AeKeyframe<V> | undefined,
): SegmentEasingKind {
	if (right === undefined) return "linear";
	if (left.outTemporalCurve) return "custom";
	const influence = segmentInfluenceOf(left, right);
	const preset = EASING_PRESETS.find((item) =>
		isPresetInfluence(influence, item),
	);
	return preset ?? "custom";
}

/**
 * Reads the exact cubic curve represented by the segment's stored temporal
 * handles. A final key has no outgoing segment, so it reports the linear curve.
 */
export function segmentEasingCurveOf<V extends AnimatableValue>(
	left: AeKeyframe<V>,
	right: AeKeyframe<V> | undefined,
): EasingCurve {
	if (right === undefined) return easingCurveForPreset("linear");
	if (left.outTemporalCurve) return normalizeEasingCurve(left.outTemporalCurve);
	const influence = segmentInfluenceOf(left, right);
	return influencesToCurve(influence.outInfluence, influence.inInfluence);
}

const isTemplateInfluence = (
	influence: EasingCurveInfluence,
	template: MotionTimingTemplate,
): boolean => {
	if (template.payload.kind !== "ae-segment") return false;
	return (
		Math.abs(influence.outInfluence - template.payload.outInfluence) <=
			CURVE_TOLERANCE &&
		Math.abs(influence.inInfluence - template.payload.inInfluence) <=
			CURVE_TOLERANCE
	);
};

/**
 * Recovers the semantic template describing the segment between two keyframes.
 * Unknown handle pairs remain `custom` so UI can keep numeric editing honest.
 */
export function segmentTimingTemplateOf<V extends AnimatableValue>(
	left: AeKeyframe<V>,
	right: AeKeyframe<V> | undefined,
): SegmentTimingTemplateKind {
	if (right === undefined) return "neutral.linear";
	if (left.outTemporalCurve) return "custom";
	const influence = segmentInfluenceOf(left, right);
	const template = motionTimingTemplatesForKeyframeSegment().find((item) =>
		isTemplateInfluence(influence, item),
	);
	return template ? (template.id as MotionTimingTemplateId) : "custom";
}

const cubicPoint = (
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	t: number,
): MotionTimingTemplatePreviewPoint => {
	const clampedT = normalizeUnit(t, 0);
	const oneMinusT = 1 - clampedT;
	return {
		x:
			3 * oneMinusT * oneMinusT * clampedT * x1 +
			3 * oneMinusT * clampedT * clampedT * x2 +
			clampedT * clampedT * clampedT,
		y:
			3 * oneMinusT * oneMinusT * clampedT * y1 +
			3 * oneMinusT * clampedT * clampedT * y2 +
			clampedT * clampedT * clampedT,
	};
};

const previewPointForTemplate = (
	template: MotionTimingTemplate,
	t: number,
): MotionTimingTemplatePreviewPoint => {
	const { payload } = template;
	if (payload.kind === "ae-segment") {
		const curve = motionTimingTemplatePayloadCurve(payload);
		return curve ? pointOnEasingCurve(curve, t) : { x: t, y: t };
	}
	if (payload.kind === "unit-bezier" || payload.kind === "settle-profile") {
		return cubicPoint(payload.x1, payload.y1, payload.x2, payload.y2, t);
	}
	if (payload.kind === "stagger-profile") {
		const y = Math.max(0, Math.min(1, t - 0.18 * payload.delayBias));
		return { x: t, y };
	}
	if (payload.kind === "phase-profile") {
		return { x: t, y: 0.5 - Math.cos(t * Math.PI * 2) * 0.5 };
	}
	return { x: t, y: t };
};

/**
 * Samples a semantic template into normalized preview points for tiny UI
 * sparklines. The sampler is read-only and never mutates motion documents.
 */
export function sampleMotionTimingTemplatePreview(
	templateId: string,
): readonly MotionTimingTemplatePreviewPoint[] {
	const template = findMotionTimingTemplate(templateId);
	if (!template) return [];
	const count = Math.max(2, Math.round(template.preview.sampleCount));
	return Array.from({ length: count }, (_, index) =>
		previewPointForTemplate(template, index / (count - 1)),
	);
}

/** Evaluates the visible unit cubic point at a parametric t for curve previews. */
export function pointOnEasingCurve(
	curve: EasingCurve,
	t: number,
): { readonly x: number; readonly y: number } {
	const normalized = normalizeEasingCurve(curve);
	const clampedT = normalizeUnit(t, 0);
	const oneMinusT = 1 - clampedT;
	const x =
		3 * oneMinusT * oneMinusT * clampedT * normalized.x1 +
		3 * oneMinusT * clampedT * clampedT * normalized.x2 +
		clampedT * clampedT * clampedT;
	const y =
		3 * oneMinusT * oneMinusT * clampedT * normalized.y1 +
		3 * oneMinusT * clampedT * clampedT * normalized.y2 +
		clampedT * clampedT * clampedT;
	return { x, y };
}
