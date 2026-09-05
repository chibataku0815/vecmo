import type {
	GrammarDuplicateSample,
	GrammarFrameSample,
	GrammarFrameSampler,
	GrammarNodeSample,
} from "@/entities/motion/model/grammar-bridge";
import { effectiveTransform } from "@/entities/motion/model/sampler";
import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";
import { readArrangementLayoutSnapshot } from "@/entities/scene/model/arrangement-layout-snapshot";
import { resolveNodeRecipe } from "@/entities/scene/model/recipe-resolve";
import { getGeometryBounds } from "@/entities/scene/model/rendering";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	type RangeSelectorCore,
	type RangeSelectorShape,
	wavefrontDelay,
} from "@/shared/sequencer/range-selector";
import { NEUTRAL_VISUAL_RECIPE } from "@/shared/vec-core";
import {
	isGlammerAfterimageMasterRotationEchoBinding,
	sampleGlammerAfterimageMasterRotationEchoDuplicates,
	sampleGlammerAfterimageMasterRotationEchoSources,
} from "./afterimage-master-rotation-echo";
import { sampleArrangementReference } from "./arrangement-reference-oracle";
import {
	ARRANGEMENT_GATHER_FRACTION_DEFAULT,
	ARRANGEMENT_HOLD_FRACTION_DEFAULT,
	ARRANGEMENT_LOBE_DEPTH_DEFAULT,
	ARRANGEMENT_SHARED_TURN_DEGREES_DEFAULT,
	ARRANGEMENT_TRANSITION_PERIOD_DEFAULT,
	ARRANGEMENT_TRANSITION_RADIUS_DEFAULT,
	ARRANGEMENT_TRANSITION_SCALE_AMPLITUDE_DEFAULT,
	AUTO_ORIENT_LOOKAHEAD_DEFAULT,
	BOOLEAN_DIFFERENCE_ROTATION_STRENGTH_DEFAULT,
	COUNT_GROWTH_GROW_FRAMES_DEFAULT,
	COUNT_GROWTH_OPACITY_FLOOR_DEFAULT,
	COUNT_GROWTH_PERIOD_DEFAULT,
	COUNT_GROWTH_SCALE_FLOOR_DEFAULT,
	FOLLOW_THROUGH_DELAY_DEFAULT,
	FOLLOW_THROUGH_RESPONSE_DEFAULT,
	INVERSE_PROPORTION_ANCHOR_X_DEFAULT,
	INVERSE_PROPORTION_ANCHOR_Y_DEFAULT,
	INVERSE_PROPORTION_AXIS_X_DEFAULT,
	INVERSE_PROPORTION_AXIS_Y_DEFAULT,
	INVERSE_PROPORTION_CLEARANCE_DEFAULT,
	INVERSE_PROPORTION_MODE_DEFAULT,
	INVERSE_PROPORTION_RADIUS_SUM_DEFAULT,
	INVERSE_PROPORTION_STRENGTH_DEFAULT,
	MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
	MERGE_SPLIT_PERIOD_DEFAULT,
	MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
	MERGE_SPLIT_STRENGTH_DEFAULT,
	MIRROR_SYMMETRIC_SCALE_STRENGTH_DEFAULT,
	PERIODIC_AFTERIMAGE_COPIES_DEFAULT,
	PERIODIC_AFTERIMAGE_DECAY_DEFAULT,
	PERIODIC_AFTERIMAGE_DELAY_DEFAULT,
	PLANAR_TUMBLE_MIN_PROJECTION_DEFAULT,
	PLANAR_TUMBLE_PERIOD_DEFAULT,
	PLANAR_TUMBLE_PHASE_STAGGER_DEFAULT,
	PLANAR_TUMBLE_TILT_DEFAULT,
	RANDOM_PULSE_CADENCE_DEFAULT,
	RANDOM_PULSE_PERIOD_DEFAULT,
	RANDOM_PULSE_WIDTH_DEFAULT,
	REACTIVE_NEIGHBOR_RESPONSE_DEFAULT,
	RING_WAVE_OPACITY_FLOOR_DEFAULT,
	RING_WAVE_PERIOD_DEFAULT,
	RING_WAVE_SCALE_AMPLITUDE_DEFAULT,
	RING_WAVE_WAVELENGTH_DEFAULT,
	SHEAR_SPLIT_DISTANCE_DEFAULT,
	SHEAR_SPLIT_PERIOD_DEFAULT,
	SHEAR_SPLIT_ROTATION_DEFAULT,
	SIZE_SPEED_PARALLAX_LOOKAHEAD_DEFAULT,
	SIZE_SPEED_PARALLAX_MAX_SCALE_DEFAULT,
	SIZE_SPEED_PARALLAX_OFFSET_DEFAULT,
	SIZE_SPEED_PARALLAX_SCALE_DEFAULT,
	TIME_DELAY_PERIOD_DEFAULT,
	TIME_DELAY_STAGGER_DEFAULT,
	WAVEFRONT_RANGE_END_DEFAULT,
	WAVEFRONT_RANGE_SHAPE_DEFAULT,
	WAVEFRONT_RANGE_START_DEFAULT,
} from "./catalog";
import { deterministicSeededOrder } from "./deterministic-order";
import { MOTION_EXPRESSION_VERSION_PARAM_KEY } from "./expression-definition";
import {
	findMotionExpressionDefinition,
	motionExpressionBindingState,
} from "./expression-registry";
import { sampleExpressionBinding } from "./expression-runtime";
import {
	followThroughLeadAndFollowerIds,
	isFollowThroughLeadAdapterParameters,
} from "./follow-through-lead-binding";
import {
	buildFollowThroughLeadPresentationAdapter,
	mergeFollowThroughLeadFrameSample,
} from "./follow-through-lead-presentation-adapter";
import {
	isRevealOut as isNoiseWipeRevealOut,
	noiseWipeDurationFrames,
} from "./noise-wipe-technique-module";
import { sampleRandomPulseProfile } from "./random-pulse-profile";
import {
	glammerTimeDelayAuthoringTiming,
	glammerTimeDelayLookRecipeForRole,
	isGlammerTimeDelayAuthoringProfileBinding,
	sampleGlammerTimeDelayAuthoringProfile,
} from "./time-delay-materialization";
import {
	GLAMMER_OFFSET_SEMANTIC_VERSION,
	GLAMMER_OFFSET_SOURCE_SPACING,
	GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION,
	GLAMMER_OFFSET_STAGGER_CONVEYOR_SLOT_VALUES,
} from "./time-offset-authoring-profile";
import type { MotionGrammarBinding } from "./types";

/**
 * Pure motion-grammar evaluator. Given the rich bindings and a frame, it produces
 * a per-node {@link GrammarNodeSample} map the presentation bridge composes over
 * the keyframe pose. It is DOM-free and React-free, never mutates scene/motion
 * documents, and is deterministic: the same `(bindings, frame)` always yields the
 * same map (no `Math.random`; any per-node phase/seed derives from stable ordinals
 * or ids). It may read motion's sampler one-way for techniques that re-time or
 * read neighbor-frame poses; `time-delay` needs only target order + the frame.
 */

export type GrammarSampleInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
};

export type MotionGrammarSamplingClipRange = {
	readonly clipId: string;
	readonly bindingId: string;
	readonly startFrame: number;
	readonly durationFrames: number;
};

export type MotionGrammarSamplingIndexEntry = {
	readonly binding: MotionGrammarBinding;
	readonly clip: MotionGrammarSamplingClipRange | undefined;
};

export type MotionGrammarSamplingIndex = {
	readonly entries: readonly MotionGrammarSamplingIndexEntry[];
	readonly evaluationMotion: MotionDocument;
};

type Point = { readonly x: number; readonly y: number };

type PositionedTarget = {
	readonly nodeId: string;
	readonly position: Point;
};

const TAU = Math.PI * 2;
const RELATIONAL_EPSILON = 0.001;
const MIN_RELATIONAL_SCALE_FACTOR = 0.05;
const MAX_RELATIONAL_SCALE_FACTOR = 8;
const DRIVER_ROLE_ALIASES = ["driver", "lead", "leader", "source"] as const;
const FOLLOWER_ROLE_ALIASES = [
	"follower",
	"follow",
	"paired",
	"pair",
	"mirror",
	"target",
] as const;

/**
 * These techniques had a legacy evaluator before their role-aware expression
 * definitions were promoted. Existing persisted bindings stay on that legacy
 * law unless authoring explicitly stamps the registered expression version.
 */
const VERSION_GATED_EXPRESSION_TECHNIQUES = new Set<
	MotionGrammarBinding["techniqueId"]
>([
	"random-phase-pulse",
	"count-growth",
	"mirror-symmetric-scale",
	"lag-follow-through",
	"ring-wave-interference",
	"merge-split-cycle",
	"size-speed-parallax",
	"inverse-proportion-link",
]);

/** Positive modulo so a wrapped source frame is always in `[0, period)`. */
const wrap = (value: number, period: number): number => {
	if (!(period > 0)) return value;
	return ((value % period) + period) % period;
};

const degrees = (radians: number): number => (radians * 180) / Math.PI;

const radians = (angle: number): number => (angle * Math.PI) / 180;

const normalizeDegrees = (value: number): number =>
	wrap(value + 180, 360) - 180;

const finiteNumber = (value: number | undefined, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

const smoothstep01 = (value: number): number => {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
};

const cycleUnit = (frame: number, period: number): number => {
	if (!(period > 0)) return 0;
	return wrap(frame, period) / period;
};

const oscillatingCycle = (frame: number, period: number): number =>
	0.5 - 0.5 * Math.cos(TAU * cycleUnit(frame, period));

const distance = (from: Point, to: Point): number =>
	Math.hypot(from.x - to.x, from.y - to.y);

const findNode = (
	document: SceneDocument,
	nodeId: string,
): VectorNode | undefined => {
	const visit = (nodes: readonly VectorNode[]): VectorNode | undefined => {
		for (const node of nodes) {
			if (node.id === nodeId) return node;
			const child = node.children ? visit(node.children) : undefined;
			if (child) return child;
		}
		return undefined;
	};
	for (const layer of document.layers) {
		const node = visit(layer.nodes);
		if (node) return node;
	}
	return undefined;
};

const finiteParam = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = binding.parameters[key];
	return Number.isFinite(value) ? value : fallback;
};

const positiveParam = (
	binding: MotionGrammarBinding,
	key: string,
	fallback: number,
): number => {
	const value = finiteParam(binding, key, fallback);
	return value > 0 ? value : fallback;
};

/** Ordinal → shape for the flat `rangeShape` param; index 0 is the linear identity. */
const WAVEFRONT_SHAPES: readonly RangeSelectorShape[] = [
	"ramp-up",
	"square",
	"ramp-down",
	"smooth",
];

/** Full influence (percent) — the wavefront always selects at full strength. */
const WAVEFRONT_AMOUNT_FULL = 100;

/**
 * Builds the per-target wavefront's Range Selector from a binding's flat params.
 * The defaults (`rangeStart` 0, `rangeEnd` 100, `rangeShape` 0 = linear) are the
 * identity selector, so an unauthored binding keeps the prior uniform stagger.
 */
const wavefrontSelector = (
	binding: MotionGrammarBinding,
): RangeSelectorCore => {
	const shapeIndex = Math.round(
		finiteParam(binding, "rangeShape", WAVEFRONT_RANGE_SHAPE_DEFAULT),
	);
	const clampedShape = Math.min(
		Math.max(shapeIndex, 0),
		WAVEFRONT_SHAPES.length - 1,
	);
	return {
		units: "percent",
		start: finiteParam(binding, "rangeStart", WAVEFRONT_RANGE_START_DEFAULT),
		end: finiteParam(binding, "rangeEnd", WAVEFRONT_RANGE_END_DEFAULT),
		amount: WAVEFRONT_AMOUNT_FULL,
		shape: WAVEFRONT_SHAPES[clampedShape] ?? "ramp-up",
	};
};

const unitInterval = (value: number): number => Math.min(Math.max(value, 0), 1);

type UnitBezier = readonly [number, number, number, number];

/** Samples a unit cubic-Bezier y value for a normalized x input. */
const unitBezierY = (curve: UnitBezier, x: number): number => {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const [p1x, p1y, p2x, p2y] = curve;
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

const scaleRatio = (
	sourceRest: number,
	sourceSampled: number,
	targetRest: number,
	targetSampled: number,
): number | undefined => {
	if (Math.abs(sourceRest) < 0.0001 || Math.abs(targetSampled) < 0.0001) {
		return undefined;
	}
	return (targetRest * (sourceSampled / sourceRest)) / targetSampled;
};

const clampScaleFactor = (value: number): number =>
	Math.min(
		Math.max(value, MIN_RELATIONAL_SCALE_FACTOR),
		MAX_RELATIONAL_SCALE_FACTOR,
	);

const relationalScaleRatio = (current: number, rest: number): number => {
	if (!Number.isFinite(current) || !Number.isFinite(rest)) return 1;
	if (Math.abs(rest) < RELATIONAL_EPSILON) return 1;
	return current / rest;
};

const roleTargetId = (
	binding: MotionGrammarBinding,
	roles: readonly string[],
): string | undefined => {
	if (!binding.roleMap) return undefined;
	const targetSet = new Set(binding.targetIds);
	for (const role of roles) {
		const direct = binding.roleMap[role];
		if (direct && targetSet.has(direct)) return direct;
	}
	for (const role of roles) {
		const reverse = binding.targetIds.find(
			(targetId) => binding.roleMap?.[targetId] === role,
		);
		if (reverse) return reverse;
	}
	return undefined;
};

const relationalTargetIds = (
	binding: MotionGrammarBinding,
): readonly string[] => {
	const ordered: string[] = [];
	const seen = new Set<string>();
	const add = (nodeId: string | undefined): void => {
		if (!nodeId || seen.has(nodeId) || !binding.targetIds.includes(nodeId)) {
			return;
		}
		seen.add(nodeId);
		ordered.push(nodeId);
	};
	add(roleTargetId(binding, DRIVER_ROLE_ALIASES) ?? binding.targetIds[0]);
	add(roleTargetId(binding, FOLLOWER_ROLE_ALIASES));
	for (const nodeId of binding.targetIds) add(nodeId);
	return ordered;
};

const positionedTargets = (
	binding: MotionGrammarBinding,
	scene: SceneDocument,
): readonly PositionedTarget[] => {
	const targets: PositionedTarget[] = [];
	for (const nodeId of binding.targetIds) {
		const node = findNode(scene, nodeId);
		if (!node) continue;
		targets.push({
			nodeId,
			position: node.transform.position,
		});
	}
	return targets;
};

const centroid = (targets: readonly PositionedTarget[]): Point => {
	const total = targets.reduce(
		(sum, target) => ({
			x: sum.x + target.position.x,
			y: sum.y + target.position.y,
		}),
		{ x: 0, y: 0 },
	);
	return {
		x: total.x / targets.length,
		y: total.y / targets.length,
	};
};

/**
 * One planned duplicate draw for periodic afterimage. It is intentionally not a
 * {@link GrammarNodeSample}; the frame sampler exposes it through the
 * duplicate-instance channel so presentation can draw multiple historical poses
 * for one source node without mutating the scene document.
 */
export type PeriodicAfterimageEcho = {
	readonly sourceFrame: number;
	readonly opacityFactor: number;
};

/**
 * Computes the deterministic echo schedule for `periodic-afterimage` without
 * mutating scene or motion state. The schedule is converted into locked
 * presentation-only duplicate nodes by {@link sampleGrammarFrame}.
 */
export function planPeriodicAfterimageEchoes(
	binding: MotionGrammarBinding,
	frame: number,
): readonly PeriodicAfterimageEcho[] {
	const echo =
		binding.effectBinding?.kind === "temporal-echo"
			? binding.effectBinding
			: undefined;
	const copies = Math.max(
		0,
		Math.floor(
			finiteNumber(
				echo?.copies,
				finiteParam(binding, "copies", PERIODIC_AFTERIMAGE_COPIES_DEFAULT),
			),
		),
	);
	const delay = Math.max(
		0,
		finiteNumber(
			echo?.delayFrames,
			finiteParam(binding, "delayFrames", PERIODIC_AFTERIMAGE_DELAY_DEFAULT),
		),
	);
	const decay = unitInterval(
		finiteNumber(
			echo?.decay,
			finiteParam(binding, "decay", PERIODIC_AFTERIMAGE_DECAY_DEFAULT),
		),
	);
	const period = finiteParam(
		binding,
		"periodFrames",
		TIME_DELAY_PERIOD_DEFAULT,
	);
	return Array.from({ length: copies }, (_, index) => {
		const copy = index + 1;
		return {
			sourceFrame: wrap(frame - copy * delay, period),
			opacityFactor: decay ** copy,
		};
	});
}

const samplePeriodicAfterimage = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
	duplicates: GrammarDuplicateSample[],
): void => {
	const localFrame = grammarClipLocalFrame(
		input.motion,
		binding.id,
		input.frame,
	);
	if (localFrame === null) return;
	if (isGlammerAfterimageMasterRotationEchoBinding(binding)) {
		for (const sample of sampleGlammerAfterimageMasterRotationEchoSources(
			binding,
			localFrame,
		)) {
			out.set(sample.nodeId, {
				nodeId: sample.nodeId,
				translate: sample.translate,
				opacityOverride: sample.opacity,
			});
		}
		duplicates.push(
			...sampleGlammerAfterimageMasterRotationEchoDuplicates(
				binding,
				localFrame,
			),
		);
		return;
	}
	const echoes = planPeriodicAfterimageEchoes(binding, localFrame);
	for (const nodeId of binding.targetIds) {
		echoes.forEach((echo, index) => {
			duplicates.push({
				sourceNodeId: nodeId,
				duplicateNodeId: `${nodeId}::grammar:${binding.id}:echo:${index + 1}`,
				sourceFrame: echo.sourceFrame,
				opacityFactor: echo.opacityFactor,
			});
		});
	}
};

const scaleFactorFor = (target: number, rest: number): number =>
	Math.abs(rest) > 1e-6 ? target / rest : 1;

const normalizeGrammarClipRange = (
	clip: AnimationClip,
): MotionGrammarSamplingClipRange | undefined => {
	const bindingId = clip.provenance?.bindingId;
	if (!bindingId) return undefined;
	const durationFrames = Math.max(
		1,
		Number.isFinite(clip.durationFrames) ? clip.durationFrames : 1,
	);
	const startFrame = Math.max(
		0,
		Number.isFinite(clip.startFrame) ? clip.startFrame : 0,
	);
	return {
		clipId: clip.id,
		bindingId,
		startFrame,
		durationFrames,
	};
};

const resolveGrammarLocalFrame = (
	clip: MotionGrammarSamplingClipRange | undefined,
	frame: number,
): number | null => {
	if (!clip) return frame;
	const endFrameExclusive = clip.startFrame + clip.durationFrames;
	if (frame < clip.startFrame || frame >= endFrameExclusive) return null;
	return frame - clip.startFrame;
};

const withoutGrammarClips = (motion: MotionDocument): MotionDocument => {
	const clips = motion.clips.filter((clip) => !clip.provenance?.bindingId);
	return clips.length === motion.clips.length ? motion : { ...motion, clips };
};

const grammarClipLocalFrame = (
	motion: MotionDocument,
	bindingId: string,
	frame: number,
): number | null => {
	return resolveGrammarLocalFrame(
		motion.clips
			.map(normalizeGrammarClipRange)
			.find((clip) => clip?.bindingId === bindingId),
		frame,
	);
};

const sampleGlammerTimeDelayProfile = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const localFrame = grammarClipLocalFrame(
		input.motion,
		binding.id,
		input.frame,
	);
	if (localFrame === null) return;
	const bodyRecipe = glammerTimeDelayLookRecipeForRole(
		binding.parameters,
		"body",
	);
	const satelliteRecipe = glammerTimeDelayLookRecipeForRole(
		binding.parameters,
		"satellite",
	);
	for (const sample of sampleGlammerTimeDelayAuthoringProfile(
		binding,
		localFrame,
	)) {
		const node = findNode(input.scene, sample.nodeId);
		if (!node) continue;
		out.set(sample.nodeId, {
			nodeId: sample.nodeId,
			translate: {
				x: sample.x - node.transform.position.x,
				y: sample.y - node.transform.position.y,
			},
			scaleFactor:
				sample.kind === "body"
					? {
							x: 1,
							y: scaleFactorFor(sample.scaleY, node.transform.scale.y),
						}
					: {
							x: scaleFactorFor(sample.scaleX, node.transform.scale.x),
							y: scaleFactorFor(sample.scaleY, node.transform.scale.y),
						},
			opacityOverride: sample.opacity,
			recipeOverride: sample.kind === "body" ? bodyRecipe : satelliteRecipe,
		});
	}
};

/**
 * `time-delay`: a wave of causality through ORDERED targets. Target `i` replays the
 * shared motion at `frame - i*staggerFrames`, wrapped into one period so the
 * wavefront loops. This is a TIME REMAP of the targets' existing animation
 * (emitted as `sourceFrame`), not a motion generator — the targets must carry base
 * motion for the wave to read.
 */
const sampleTimeDelay = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	if (isGlammerTimeDelayAuthoringProfileBinding(binding)) {
		sampleGlammerTimeDelayProfile(binding, input, out);
		return;
	}
	const authoringTiming = glammerTimeDelayAuthoringTiming(binding);
	const stagger =
		authoringTiming?.staggerFrames ??
		finiteParam(binding, "staggerFrames", TIME_DELAY_STAGGER_DEFAULT);
	const period =
		authoringTiming?.periodFrames ??
		finiteParam(binding, "periodFrames", TIME_DELAY_PERIOD_DEFAULT);
	const wavefront = wavefrontSelector(binding);
	const count = binding.targetIds.length;
	binding.targetIds.forEach((nodeId, index) => {
		out.set(nodeId, {
			nodeId,
			sourceFrame: wrap(
				input.frame - wavefrontDelay(index, count, wavefront, stagger),
				period,
			),
		});
	});
};

const isGlammerOffsetStaggerConveyorBinding = (
	binding: MotionGrammarBinding,
): boolean =>
	binding.parameters.profileVersion ===
	GLAMMER_OFFSET_STAGGER_CONVEYOR_PROFILE_VERSION;

const offsetConveyorValue = ({
	slot,
	dup,
	slotCount,
	slotValues,
	overrideSlot,
	overrideDup,
	overrideValue,
}: {
	readonly slot: number;
	readonly dup: number;
	readonly slotCount: number;
	readonly slotValues: readonly number[];
	readonly overrideSlot: number;
	readonly overrideDup: number;
	readonly overrideValue: number;
}): number => {
	if (slot < 0 || slot >= slotCount) return 0;
	if (dup === overrideDup && slot === overrideSlot) return overrideValue;
	return Math.max(0, slotValues[slot] ?? 1);
};

const offsetConveyorSlotValues = (
	binding: MotionGrammarBinding,
	slotCount: number,
): readonly number[] =>
	Array.from({ length: slotCount }, (_, index) =>
		Math.max(
			0,
			finiteParam(
				binding,
				`slotValue${index + 1}`,
				GLAMMER_OFFSET_STAGGER_CONVEYOR_SLOT_VALUES[index] ?? 1,
			),
		),
	);

/**
 * Glammer `Offset`: five editable circles slide left while size values are read
 * from staggered copies of the same move. This mirrors the article's `dotsAt`
 * skeleton: one progress number controls both conveyor position and slot size.
 */
const sampleGlammerOffsetStaggerConveyor = (
	binding: MotionGrammarBinding,
	frame: number,
	out: Map<string, GrammarNodeSample>,
): void => {
	const semanticVersion = Math.round(
		finiteParam(binding, "semanticVersion", 1),
	);
	const period = positiveParam(
		binding,
		"periodFrames",
		TIME_DELAY_PERIOD_DEFAULT,
	);
	const subcycleFrames = positiveParam(binding, "subcycleFrames", 18);
	const activeFrames = positiveParam(binding, "activeFrames", 14);
	const sourceCoordinateScale =
		semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
			? positiveParam(binding, "sourceCoordinateScale", 1)
			: 1;
	const spacing = positiveParam(binding, "spacing", 64) * sourceCoordinateScale;
	const slotCount = Math.max(
		1,
		Math.min(
			binding.targetIds.length,
			Math.round(positiveParam(binding, "slotCount", binding.targetIds.length)),
		),
	);
	const overrideSlot = Math.round(finiteParam(binding, "overrideSlot", 3));
	const overrideDup = Math.round(finiteParam(binding, "overrideDup", 1));
	const overrideValue = positiveParam(binding, "overrideValue", 1.22);
	const slotValues = offsetConveyorSlotValues(binding, slotCount);
	const sourceValueScale =
		semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
			? positiveParam(binding, "sourceValueScale", 1)
			: 1;
	const radiusAnchorSceneUnits =
		semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
			? positiveParam(binding, "radiusAnchorSceneUnits", 52)
			: 1;
	const visibilityCutoff =
		semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
			? finiteParam(binding, "visibilityCutoffSourceUnits", 0.01)
			: 0.04;
	const easing: UnitBezier = [
		finiteParam(binding, "easingP1X", 0.58),
		finiteParam(binding, "easingP1Y", 0.057),
		finiteParam(binding, "easingP2X", 0.415),
		finiteParam(binding, "easingP2Y", 0.93),
	];
	const local = wrap(frame, period);
	const subcycle = Math.floor(local / subcycleFrames);
	const within = local - subcycle * subcycleFrames;
	const normalizedProgress = Math.min(within / activeFrames, 1);
	const progress =
		semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
			? unitBezierY(easing, normalizedProgress)
			: smoothstep01(normalizedProgress);
	const dupCount = Math.max(1, Math.round(period / subcycleFrames));
	for (let slot = 0; slot < slotCount; slot += 1) {
		const nodeId = binding.targetIds[slot];
		const dup = wrap(subcycle + slot - (slotCount - 1), dupCount);
		const from = offsetConveyorValue({
			slot,
			dup,
			slotCount,
			slotValues,
			overrideSlot,
			overrideDup,
			overrideValue,
		});
		const to = offsetConveyorValue({
			slot: slot - 1,
			dup,
			slotCount,
			slotValues,
			overrideSlot,
			overrideDup,
			overrideValue,
		});
		const value = from * (1 - progress) + to * progress;
		const scaleValue =
			semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
				? (value * sourceValueScale) / radiusAnchorSceneUnits
				: value;
		const opacityCutoff =
			semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
				? (visibilityCutoff * sourceValueScale) / radiusAnchorSceneUnits
				: visibilityCutoff;
		out.set(nodeId, {
			nodeId,
			translate: {
				x:
					semanticVersion >= GLAMMER_OFFSET_SEMANTIC_VERSION
						? (slot - (slotCount - 1) / 2) *
								(spacing - GLAMMER_OFFSET_SOURCE_SPACING) -
							spacing * progress
						: -spacing * progress,
				y: 0,
			},
			scaleFactor: { x: scaleValue, y: scaleValue },
			opacityOverride: scaleValue <= opacityCutoff ? 0 : 1,
		});
	}
};

/**
 * `time-offset-propagation`: ordered followers inherit the lead target's delayed
 * authored pose while preserving their rest-layout offset. Unlike `time-delay`,
 * followers do not need their own matching tracks; the wave can propagate from
 * one animated driver through static neighbors as additive bridge samples.
 */
const sampleTimeOffsetPropagation = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	if (isGlammerOffsetStaggerConveyorBinding(binding)) {
		sampleGlammerOffsetStaggerConveyor(binding, input.frame, out);
		return;
	}
	const leaderId = binding.targetIds[0];
	if (!leaderId) return;
	const leader = findNode(input.scene, leaderId);
	if (!leader) return;
	const stagger = finiteParam(
		binding,
		"staggerFrames",
		TIME_DELAY_STAGGER_DEFAULT,
	);
	const period = finiteParam(
		binding,
		"periodFrames",
		TIME_DELAY_PERIOD_DEFAULT,
	);
	const wavefront = wavefrontSelector(binding);
	const count = binding.targetIds.length;
	for (let index = 1; index < count; index += 1) {
		const nodeId = binding.targetIds[index];
		const target = findNode(input.scene, nodeId);
		if (!target) continue;
		const sourceFrame = wrap(
			input.frame - wavefrontDelay(index, count, wavefront, stagger),
			period,
		);
		const leaderPose = effectiveTransform(leader, input.motion, sourceFrame);
		const targetPose = effectiveTransform(target, input.motion, input.frame);
		const restOffset = {
			x: target.transform.position.x - leader.transform.position.x,
			y: target.transform.position.y - leader.transform.position.y,
		};
		const translate = {
			x: leaderPose.position.x + restOffset.x - targetPose.position.x,
			y: leaderPose.position.y + restOffset.y - targetPose.position.y,
		};
		const rotate =
			leaderPose.rotation +
			(target.transform.rotation - leader.transform.rotation) -
			targetPose.rotation;
		const xScale = scaleRatio(
			leader.transform.scale.x,
			leaderPose.scale.x,
			target.transform.scale.x,
			targetPose.scale.x,
		);
		const yScale = scaleRatio(
			leader.transform.scale.y,
			leaderPose.scale.y,
			target.transform.scale.y,
			targetPose.scale.y,
		);
		out.set(nodeId, {
			nodeId,
			translate,
			rotate,
			...(xScale !== undefined || yScale !== undefined
				? { scaleFactor: { x: xScale ?? 1, y: yScale ?? 1 } }
				: {}),
		});
	}
};

/**
 * `random-phase-pulse`: a field of identical pulses fired in a deterministic
 * pseudo-random order. The variance is temporal order, not jitter or amplitude
 * noise, so every target shares the same pulse shape. A valid declarative
 * `randomPulseProfile` overrides the legacy sine fallback without changing the
 * binding's selector or output topology.
 */
const sampleRandomPhasePulse = (
	binding: MotionGrammarBinding,
	frame: number,
	out: Map<string, GrammarNodeSample>,
): void => {
	const period = finiteParam(
		binding,
		"periodFrames",
		RANDOM_PULSE_PERIOD_DEFAULT,
	);
	const cadence = finiteParam(
		binding,
		"cadenceFrames",
		RANDOM_PULSE_CADENCE_DEFAULT,
	);
	const pulseFrames = finiteParam(
		binding,
		"pulseFrames",
		RANDOM_PULSE_WIDTH_DEFAULT,
	);
	const scaleAmplitude = finiteParam(binding, "scaleAmplitude", 0.22);
	const opacityFloor = finiteParam(binding, "opacityFloor", 0.45);
	const ordered = deterministicSeededOrder(
		binding.targetIds,
		(targetId) => targetId,
		binding.seed,
	);
	ordered.forEach((nodeId, rank) => {
		const age = wrap(frame - rank * cadence, period);
		const pulse = binding.randomPulseProfile
			? (sampleRandomPulseProfile(binding.randomPulseProfile, age) ?? 0)
			: (() => {
					const progress = pulseFrames > 0 ? age / pulseFrames : 1;
					return progress >= 0 && progress <= 1
						? Math.sin(Math.PI * progress)
						: 0;
				})();
		const scale = 1 + scaleAmplitude * pulse;
		out.set(nodeId, {
			nodeId,
			scaleFactor: { x: scale, y: scale },
			opacityFactor: opacityFloor + (1 - opacityFloor) * clamp01(pulse),
		});
	});
};

/**
 * `ring-wave-interference`: two deterministic radial wave emitters (first and
 * last target positions) interfere across the target field. The resulting crest
 * strength modulates scale and opacity only, which is the visible field channel
 * available to the current bridge.
 */
const sampleRingWaveInterference = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const targets = positionedTargets(binding, input.scene);
	if (targets.length === 0) return;
	const firstTarget = targets[0];
	const lastTarget = targets[targets.length - 1];
	if (!firstTarget || !lastTarget) return;
	const first = firstTarget.position;
	const last = lastTarget.position;
	const period = finiteParam(binding, "periodFrames", RING_WAVE_PERIOD_DEFAULT);
	const wavelength = Math.max(
		finiteParam(binding, "wavelengthPx", RING_WAVE_WAVELENGTH_DEFAULT),
		0.001,
	);
	const scaleAmplitude = finiteParam(
		binding,
		"scaleAmplitude",
		RING_WAVE_SCALE_AMPLITUDE_DEFAULT,
	);
	const opacityFloor = finiteParam(
		binding,
		"opacityFloor",
		RING_WAVE_OPACITY_FLOOR_DEFAULT,
	);
	const time = cycleUnit(input.frame, period);
	for (const target of targets) {
		const waveA = Math.sin(
			TAU * (time - distance(target.position, first) / wavelength),
		);
		const waveB = Math.sin(
			TAU * (time - distance(target.position, last) / wavelength + 0.25),
		);
		const crest = clamp01((waveA + waveB) * 0.25 + 0.5);
		const scale = 1 + scaleAmplitude * crest;
		out.set(target.nodeId, {
			nodeId: target.nodeId,
			scaleFactor: { x: scale, y: scale },
			opacityFactor: opacityFloor + (1 - opacityFloor) * crest,
		});
	}
};

/**
 * Samples the native Arrangement path only when a binding carries valid,
 * Scene-owned snapshots and explicit grammar maps. Additive presentation can
 * preserve the source rest only when the authored source snapshot still equals
 * the current base pose; otherwise the legacy evaluator remains the safe path.
 */
const sampleNativeArrangementTransition = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): boolean => {
	const mapping = binding.arrangementMapping;
	if (!mapping) return false;
	const snapshots = input.scene.arrangementLayoutSnapshots ?? [];
	const sourceSnapshot = snapshots.find(
		(snapshot) => snapshot.id === mapping.sourceSnapshotId,
	);
	const destinationSnapshot = snapshots.find(
		(snapshot) => snapshot.id === mapping.destinationSnapshotId,
	);
	if (!sourceSnapshot || !destinationSnapshot) return false;
	const sourceRead = readArrangementLayoutSnapshot(input.scene, sourceSnapshot);
	const destinationRead = readArrangementLayoutSnapshot(
		input.scene,
		destinationSnapshot,
	);
	if (sourceRead.status === "stale" || destinationRead.status === "stale")
		return false;
	if (sourceRead.snapshot.memberNodeIds.length !== binding.targetIds.length)
		return false;
	const targetSet = new Set(binding.targetIds);
	if (
		sourceRead.snapshot.memberNodeIds.some((nodeId) => !targetSet.has(nodeId))
	)
		return false;
	for (const nodeId of binding.targetIds) {
		const node = findNode(input.scene, nodeId);
		const sourcePosition = sourceRead.snapshot.positions[nodeId];
		if (
			!node ||
			!sourcePosition ||
			node.transform.position.x !== sourcePosition.x ||
			node.transform.position.y !== sourcePosition.y
		) {
			return false;
		}
	}
	const result = sampleArrangementReference(
		{
			periodFrames: positiveParam(
				binding,
				"periodFrames",
				ARRANGEMENT_TRANSITION_PERIOD_DEFAULT,
			),
			phaseStartFrame: finiteParam(binding, "phaseStartFrame", 0),
			sourceSnapshot: sourceRead.snapshot,
			destinationSnapshot: destinationRead.snapshot,
			sourceToStage: mapping.sourceToStage,
			stageToDestination: mapping.stageToDestination,
			stageSlots: mapping.stageSlots,
			pivot: mapping.pivot,
			gatherFraction: finiteParam(
				binding,
				"gatherFraction",
				ARRANGEMENT_GATHER_FRACTION_DEFAULT,
			),
			holdFraction: finiteParam(
				binding,
				"holdFraction",
				ARRANGEMENT_HOLD_FRACTION_DEFAULT,
			),
			sharedTurnDegrees: finiteParam(
				binding,
				"sharedTurnDegrees",
				ARRANGEMENT_SHARED_TURN_DEGREES_DEFAULT,
			),
			lobeDepth: finiteParam(
				binding,
				"lobeDepth",
				ARRANGEMENT_LOBE_DEPTH_DEFAULT,
			),
			...(mapping.stagingDelayFractionBySource
				? { stagingDelayFractionBySource: mapping.stagingDelayFractionBySource }
				: {}),
		},
		input.frame,
	);
	if (result.status === "blocked") return false;
	const sample = result.samples[0];
	if (!sample) return false;
	for (const target of sample.targets) {
		const node = findNode(input.scene, target.sourceNodeId);
		if (!node) return false;
		out.set(target.sourceNodeId, {
			nodeId: target.sourceNodeId,
			translate: {
				x: target.position.x - node.transform.position.x,
				y: target.position.y - node.transform.position.y,
			},
		});
	}
	return true;
};

/**
 * `arrangement-transition`: ordered targets morph from their current positions
 * into evenly spaced points on a ring around the field centroid, then return.
 * The original scene positions remain untouched; only additive translate samples
 * are emitted for the bridge to compose.
 */
const sampleArrangementTransition = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	if (sampleNativeArrangementTransition(binding, input, out)) return;
	const targets = positionedTargets(binding, input.scene);
	if (targets.length === 0) return;
	const center = centroid(targets);
	const period = finiteParam(
		binding,
		"periodFrames",
		ARRANGEMENT_TRANSITION_PERIOD_DEFAULT,
	);
	const radius = finiteParam(
		binding,
		"radiusPx",
		ARRANGEMENT_TRANSITION_RADIUS_DEFAULT,
	);
	const angleOffset = radians(finiteParam(binding, "angleOffset", 0));
	const scaleAmplitude = finiteParam(
		binding,
		"scaleAmplitude",
		ARRANGEMENT_TRANSITION_SCALE_AMPLITUDE_DEFAULT,
	);
	const progress = oscillatingCycle(input.frame, period);
	const scale = 1 + scaleAmplitude * progress;
	targets.forEach((target, index) => {
		const angle = -Math.PI / 2 + angleOffset + (TAU * index) / targets.length;
		const destination = {
			x: center.x + Math.cos(angle) * radius,
			y: center.y + Math.sin(angle) * radius,
		};
		out.set(target.nodeId, {
			nodeId: target.nodeId,
			translate: {
				x: (destination.x - target.position.x) * progress,
				y: (destination.y - target.position.y) * progress,
			},
			scaleFactor: { x: scale, y: scale },
		});
	});
};

/**
 * `merge-split-cycle`: ordered targets periodically move toward their centroid
 * and then return to the split arrangement. Scale and opacity tighten at the
 * merge point so overlap remains visible under the bridge's additive transform
 * constraints.
 */
const sampleMergeSplitCycle = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const targets = positionedTargets(binding, input.scene);
	if (targets.length === 0) return;
	const center = centroid(targets);
	const period = finiteParam(
		binding,
		"periodFrames",
		MERGE_SPLIT_PERIOD_DEFAULT,
	);
	const strength = finiteParam(
		binding,
		"strength",
		MERGE_SPLIT_STRENGTH_DEFAULT,
	);
	const scaleFloor = finiteParam(
		binding,
		"scaleFloor",
		MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
	);
	const opacityFloor = finiteParam(
		binding,
		"opacityFloor",
		MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
	);
	const merge = oscillatingCycle(input.frame, period);
	const scale = 1 - (1 - scaleFloor) * merge;
	const opacity = 1 - (1 - opacityFloor) * merge;
	for (const target of targets) {
		out.set(target.nodeId, {
			nodeId: target.nodeId,
			translate: {
				x: (center.x - target.position.x) * merge * strength,
				y: (center.y - target.position.y) * merge * strength,
			},
			scaleFactor: { x: scale, y: scale },
			opacityFactor: opacity,
		});
	}
};

/**
 * `count-growth`: a deterministic rank cursor reveals the ordered target set over
 * one cycle. Targets ahead of the cursor are kept small and faint; revealed
 * targets grow to their authored pose without changing scene membership.
 */
const sampleCountGrowth = (
	binding: MotionGrammarBinding,
	frame: number,
	out: Map<string, GrammarNodeSample>,
): void => {
	const count = binding.targetIds.length;
	if (count === 0) return;
	const period = finiteParam(
		binding,
		"periodFrames",
		COUNT_GROWTH_PERIOD_DEFAULT,
	);
	const growFrames = finiteParam(
		binding,
		"growFrames",
		COUNT_GROWTH_GROW_FRAMES_DEFAULT,
	);
	const scaleFloor = finiteParam(
		binding,
		"scaleFloor",
		COUNT_GROWTH_SCALE_FLOOR_DEFAULT,
	);
	const opacityFloor = finiteParam(
		binding,
		"opacityFloor",
		COUNT_GROWTH_OPACITY_FLOOR_DEFAULT,
	);
	const cursor = cycleUnit(frame, period) * count;
	const growSpan =
		period > 0 ? Math.max((growFrames / period) * count, 0.001) : 1;
	binding.targetIds.forEach((nodeId, index) => {
		const activation = smoothstep01((cursor - index) / growSpan);
		const scale = scaleFloor + (1 - scaleFloor) * activation;
		out.set(nodeId, {
			nodeId,
			scaleFactor: { x: scale, y: scale },
			opacityFactor: opacityFloor + (1 - opacityFloor) * activation,
		});
	});
};

/**
 * `mirror-symmetric-scale`: one driver target owns the scale gesture; paired
 * followers receive the opposite scale delta around unit scale. This is a real
 * relational constraint over the driver's sampled transform, but it only emits
 * bridge-supported `scaleFactor` samples.
 */
const sampleMirrorSymmetricScale = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const [driverId, ...followerIds] = relationalTargetIds(binding);
	if (!driverId || followerIds.length === 0) return;
	const driver = findNode(input.scene, driverId);
	if (!driver) return;
	const strength = finiteParam(
		binding,
		"strength",
		MIRROR_SYMMETRIC_SCALE_STRENGTH_DEFAULT,
	);
	if (Math.abs(strength) < RELATIONAL_EPSILON) return;
	const driverNow = effectiveTransform(driver, input.motion, input.frame);
	const scaleDelta = {
		x: relationalScaleRatio(driverNow.scale.x, driver.transform.scale.x) - 1,
		y: relationalScaleRatio(driverNow.scale.y, driver.transform.scale.y) - 1,
	};
	const scaleFactor = {
		x: clampScaleFactor(1 - scaleDelta.x * strength),
		y: clampScaleFactor(1 - scaleDelta.y * strength),
	};
	if (
		Math.abs(scaleFactor.x - 1) < RELATIONAL_EPSILON &&
		Math.abs(scaleFactor.y - 1) < RELATIONAL_EPSILON
	) {
		return;
	}
	for (const nodeId of followerIds) {
		if (!findNode(input.scene, nodeId)) continue;
		out.set(nodeId, { nodeId, scaleFactor });
	}
};

/**
 * `boolean-difference-rotation`: the follower's rotation tracks the angular
 * difference between the rest driver->follower vector and the sampled current
 * vector. The bridge cannot express a geometry boolean yet, so the difference is
 * represented by the orientation of the relation vector.
 */
const sampleBooleanDifferenceRotation = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const [driverId, ...followerIds] = relationalTargetIds(binding);
	if (!driverId || followerIds.length === 0) return;
	const driver = findNode(input.scene, driverId);
	if (!driver) return;
	const strength = finiteParam(
		binding,
		"strength",
		BOOLEAN_DIFFERENCE_ROTATION_STRENGTH_DEFAULT,
	);
	if (Math.abs(strength) < RELATIONAL_EPSILON) return;
	const driverNow = effectiveTransform(driver, input.motion, input.frame);
	for (const nodeId of followerIds) {
		const follower = findNode(input.scene, nodeId);
		if (!follower) continue;
		const followerNow = effectiveTransform(follower, input.motion, input.frame);
		const restVector = {
			x: follower.transform.position.x - driver.transform.position.x,
			y: follower.transform.position.y - driver.transform.position.y,
		};
		const currentVector = {
			x: followerNow.position.x - driverNow.position.x,
			y: followerNow.position.y - driverNow.position.y,
		};
		if (
			Math.hypot(restVector.x, restVector.y) < RELATIONAL_EPSILON ||
			Math.hypot(currentVector.x, currentVector.y) < RELATIONAL_EPSILON
		) {
			continue;
		}
		const rotate =
			normalizeDegrees(
				degrees(Math.atan2(currentVector.y, currentVector.x)) -
					degrees(Math.atan2(restVector.y, restVector.x)),
			) * strength;
		if (Math.abs(rotate) < RELATIONAL_EPSILON) continue;
		out.set(nodeId, { nodeId, rotate });
	}
};

/**
 * `inverse-proportion-link`: mode 0 preserves the legacy reciprocal-scale
 * approximation. Mode 1 owns a true-circle tangent-anchor relation: one driver
 * radius is sampled from the pre-grammar transform, the follower radius is the
 * derived complement, and both centers are placed on one declared axis.
 */
const sampleInverseProportionLink = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const [driverId, ...followerIds] = relationalTargetIds(binding);
	if (!driverId || followerIds.length === 0) return;
	const driver = findNode(input.scene, driverId);
	if (!driver) return;
	const strength = finiteParam(
		binding,
		"strength",
		INVERSE_PROPORTION_STRENGTH_DEFAULT,
	);
	if (Math.abs(strength) < RELATIONAL_EPSILON) return;
	const mode = finiteParam(binding, "mode", INVERSE_PROPORTION_MODE_DEFAULT);
	if (mode >= 0.5) {
		const tangentDriverId =
			roleTargetId(binding, [
				...DRIVER_ROLE_ALIASES,
				"inverse-proportion-link:driver",
			]) ?? driverId;
		const tangentFollowerId =
			roleTargetId(binding, [
				...FOLLOWER_ROLE_ALIASES,
				"inverse-proportion-link:follower",
			]) ?? followerIds[0];
		if (
			!tangentDriverId ||
			!tangentFollowerId ||
			tangentDriverId === tangentFollowerId
		)
			return;
		const followerId = tangentFollowerId;
		const follower = followerId ? findNode(input.scene, followerId) : undefined;
		const tangentDriver = findNode(input.scene, tangentDriverId);
		if (!follower || !tangentDriver) return;
		const driverNow = effectiveTransform(
			tangentDriver,
			input.motion,
			input.frame,
		);
		const followerNow = effectiveTransform(follower, input.motion, input.frame);
		const radiusAt = (
			node: VectorNode,
			scale: { readonly x: number; readonly y: number },
		): number | null => {
			if (node.geometry.kind !== "ellipse") return null;
			const bounds = getGeometryBounds(node.geometry);
			if (
				!(bounds.width > 0) ||
				bounds.width !== bounds.height ||
				scale.x !== scale.y
			)
				return null;
			const radius = (bounds.width * Math.abs(scale.x)) / 2;
			return Number.isFinite(radius) && radius > 0 ? radius : null;
		};
		const driverRadius = radiusAt(tangentDriver, driverNow.scale);
		const followerRadiusAtFrame = radiusAt(follower, followerNow.scale);
		if (driverRadius === null || followerRadiusAtFrame === null) return;
		const radiusSum = finiteParam(
			binding,
			"radiusSum",
			INVERSE_PROPORTION_RADIUS_SUM_DEFAULT,
		);
		const clearance = Math.max(
			0,
			finiteParam(binding, "clearance", INVERSE_PROPORTION_CLEARANCE_DEFAULT),
		);
		const followerRadius = radiusSum - driverRadius;
		if (!(followerRadius > 0) || radiusSum <= clearance) return;
		const axisX = finiteParam(
			binding,
			"axisX",
			INVERSE_PROPORTION_AXIS_X_DEFAULT,
		);
		const axisY = finiteParam(
			binding,
			"axisY",
			INVERSE_PROPORTION_AXIS_Y_DEFAULT,
		);
		const axisLength = Math.hypot(axisX, axisY);
		if (!(axisLength > RELATIONAL_EPSILON)) return;
		const axis = { x: axisX / axisLength, y: axisY / axisLength };
		const anchor = {
			x: finiteParam(binding, "anchorX", INVERSE_PROPORTION_ANCHOR_X_DEFAULT),
			y: finiteParam(binding, "anchorY", INVERSE_PROPORTION_ANCHOR_Y_DEFAULT),
		};
		const clearanceHalf = clearance / 2;
		const driverCenter = {
			x: anchor.x - axis.x * (driverRadius + clearanceHalf),
			y: anchor.y - axis.y * (driverRadius + clearanceHalf),
		};
		const followerCenter = {
			x: anchor.x + axis.x * (followerRadius + clearanceHalf),
			y: anchor.y + axis.y * (followerRadius + clearanceHalf),
		};
		const response = Math.min(1, Math.max(0, strength));
		const followerScale = followerRadius / followerRadiusAtFrame;
		out.set(tangentDriver.id, {
			nodeId: tangentDriver.id,
			translate: {
				x: (driverCenter.x - driverNow.position.x) * response,
				y: (driverCenter.y - driverNow.position.y) * response,
			},
		});
		out.set(follower.id, {
			nodeId: follower.id,
			translate: {
				x: (followerCenter.x - followerNow.position.x) * response,
				y: (followerCenter.y - followerNow.position.y) * response,
			},
			scaleFactor: {
				x: 1 + (followerScale - 1) * response,
				y: 1 + (followerScale - 1) * response,
			},
		});
		return;
	}
	const driverNow = effectiveTransform(driver, input.motion, input.frame);
	const driverScaleRatio =
		(Math.abs(
			relationalScaleRatio(driverNow.scale.x, driver.transform.scale.x),
		) +
			Math.abs(
				relationalScaleRatio(driverNow.scale.y, driver.transform.scale.y),
			)) /
		2;
	if (driverScaleRatio < RELATIONAL_EPSILON) return;
	const inverse = 1 / driverScaleRatio;
	const uniformScale = clampScaleFactor(1 + (inverse - 1) * strength);
	if (Math.abs(uniformScale - 1) < RELATIONAL_EPSILON) return;
	const scaleFactor = { x: uniformScale, y: uniformScale };
	for (const nodeId of followerIds) {
		if (!findNode(input.scene, nodeId)) continue;
		out.set(nodeId, { nodeId, scaleFactor });
	}
};

/**
 * `reactive-neighbor-displacement`: an ordered chain where target `i` reacts to
 * target `i-1`'s sampled displacement from rest. The chain is deterministic from
 * `roleMap` priority plus target order and remains additive-only in the bridge.
 */
const sampleReactiveNeighborDisplacement = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const ordered = relationalTargetIds(binding);
	if (ordered.length < 2) return;
	const response = finiteParam(
		binding,
		"response",
		REACTIVE_NEIGHBOR_RESPONSE_DEFAULT,
	);
	if (Math.abs(response) < RELATIONAL_EPSILON) return;
	for (let index = 1; index < ordered.length; index += 1) {
		const sourceId = ordered[index - 1];
		const nodeId = ordered[index];
		if (!sourceId || !nodeId) continue;
		const source = findNode(input.scene, sourceId);
		const target = findNode(input.scene, nodeId);
		if (!source || !target) continue;
		const sourceNow = effectiveTransform(source, input.motion, input.frame);
		const translate = {
			x: (sourceNow.position.x - source.transform.position.x) * response,
			y: (sourceNow.position.y - source.transform.position.y) * response,
		};
		if (Math.hypot(translate.x, translate.y) < RELATIONAL_EPSILON) {
			continue;
		}
		out.set(nodeId, { nodeId, translate });
	}
};

/**
 * `lag-follow-through`: target 0 is the driver; followers respond to the driver's
 * delayed position delta. This keeps the follower identity independent from the
 * driver and creates a readable lag even when the follower itself has no track.
 */
const sampleLagFollowThrough = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const leadId = binding.targetIds[0];
	if (!leadId) return;
	const lead = findNode(input.scene, leadId);
	if (!lead) return;
	const baseDelay = finiteParam(
		binding,
		"delayFrames",
		FOLLOW_THROUGH_DELAY_DEFAULT,
	);
	const response = finiteParam(
		binding,
		"response",
		FOLLOW_THROUGH_RESPONSE_DEFAULT,
	);
	const leadNow = effectiveTransform(lead, input.motion, input.frame).position;
	for (const [index, nodeId] of binding.targetIds.entries()) {
		if (index === 0) continue;
		const delay = baseDelay * index;
		const leadDelayed = effectiveTransform(
			lead,
			input.motion,
			input.frame - delay,
		).position;
		const delta = {
			x: (leadDelayed.x - leadNow.x) * response,
			y: (leadDelayed.y - leadNow.y) * response,
		};
		out.set(nodeId, {
			nodeId,
			translate: delta,
			rotate: delta.x * 0.08,
		});
	}
};

/**
 * `planar-solid-tumble`: 2D projection only. The current bridge has no 3D
 * rotation or depth channel, so this emits the projected silhouette of a card
 * tumbling out of plane: horizontal squash plus a small additive tilt.
 */
const samplePlanarSolidTumble = (
	binding: MotionGrammarBinding,
	frame: number,
	out: Map<string, GrammarNodeSample>,
): void => {
	const period = positiveParam(
		binding,
		"periodFrames",
		PLANAR_TUMBLE_PERIOD_DEFAULT,
	);
	const phaseStagger = finiteParam(
		binding,
		"phaseStaggerFrames",
		PLANAR_TUMBLE_PHASE_STAGGER_DEFAULT,
	);
	const minProjection = clamp(
		finiteParam(binding, "minProjection", PLANAR_TUMBLE_MIN_PROJECTION_DEFAULT),
		0.05,
		1,
	);
	const tiltDegrees = finiteParam(
		binding,
		"tiltDegrees",
		PLANAR_TUMBLE_TILT_DEFAULT,
	);
	binding.targetIds.forEach((nodeId, index) => {
		const angle =
			(wrap(frame + index * phaseStagger, period) / period) * Math.PI * 2;
		const sideOn = Math.abs(Math.sin(angle));
		const projectedWidth =
			minProjection + (1 - minProjection) * Math.abs(Math.cos(angle));
		out.set(nodeId, {
			nodeId,
			rotate: Math.sin(angle) * tiltDegrees,
			scaleFactor: {
				x: projectedWidth,
				y: 1 + sideOn * 0.06,
			},
		});
	});
};

/**
 * `shear-split`: no shear matrix is available in GrammarNodeSample, so the
 * authorable 2D approximation separates ordered targets around their center line
 * and counter-rotates them during the split phase.
 */
const sampleShearSplit = (
	binding: MotionGrammarBinding,
	frame: number,
	out: Map<string, GrammarNodeSample>,
): void => {
	const period = positiveParam(
		binding,
		"periodFrames",
		SHEAR_SPLIT_PERIOD_DEFAULT,
	);
	const splitDistance = finiteParam(
		binding,
		"splitDistance",
		SHEAR_SPLIT_DISTANCE_DEFAULT,
	);
	const rotationDegrees = finiteParam(
		binding,
		"rotationDegrees",
		SHEAR_SPLIT_ROTATION_DEFAULT,
	);
	const split = Math.sin((wrap(frame, period) / period) * Math.PI);
	const center = (binding.targetIds.length - 1) / 2;
	const maxDistanceFromCenter = binding.targetIds.length === 1 ? 1 : center;
	binding.targetIds.forEach((nodeId, index) => {
		const rank =
			binding.targetIds.length === 1
				? 1
				: (index - center) / maxDistanceFromCenter;
		out.set(nodeId, {
			nodeId,
			translate: {
				x: rank * splitDistance * split,
				y: Math.abs(rank) * splitDistance * 0.12 * split,
			},
			rotate: rank * rotationDegrees * split,
		});
	});
};

/**
 * `auto-orient-along-path`: honest tangent-follow. It samples the node's own
 * animated position at the current frame and a nearby future frame, then emits an
 * absolute rotation override from that tangent. No synthetic 3D billboard channel
 * is introduced in this slice.
 */
const sampleAutoOrientAlongPath = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const lookAhead = finiteParam(
		binding,
		"lookAheadFrames",
		AUTO_ORIENT_LOOKAHEAD_DEFAULT,
	);
	const angleOffset = finiteParam(binding, "angleOffset", 0);
	for (const nodeId of binding.targetIds) {
		const node = findNode(input.scene, nodeId);
		if (!node) continue;
		const now = effectiveTransform(node, input.motion, input.frame).position;
		const future = effectiveTransform(
			node,
			input.motion,
			input.frame + lookAhead,
		).position;
		const dx = future.x - now.x;
		const dy = future.y - now.y;
		if (Math.hypot(dx, dy) < 0.001) continue;
		out.set(nodeId, {
			nodeId,
			rotationOverride: degrees(Math.atan2(dy, dx)) + angleOffset,
		});
	}
};

/**
 * `size-speed-parallax`: target order is treated as a shallow-to-deep stack and
 * each node's own sampled velocity controls how far and how much it enlarges.
 * Static targets stay inert; moving front targets receive the strongest sample.
 */
const sampleSizeSpeedParallax = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const lookAhead = positiveParam(
		binding,
		"lookAheadFrames",
		SIZE_SPEED_PARALLAX_LOOKAHEAD_DEFAULT,
	);
	const offsetMultiplier = finiteParam(
		binding,
		"offsetMultiplier",
		SIZE_SPEED_PARALLAX_OFFSET_DEFAULT,
	);
	const scalePerSpeed = finiteParam(
		binding,
		"scalePerSpeed",
		SIZE_SPEED_PARALLAX_SCALE_DEFAULT,
	);
	const maxScaleBoost = finiteParam(
		binding,
		"maxScaleBoost",
		SIZE_SPEED_PARALLAX_MAX_SCALE_DEFAULT,
	);
	const count = Math.max(binding.targetIds.length, 1);
	binding.targetIds.forEach((nodeId, index) => {
		const node = findNode(input.scene, nodeId);
		if (!node) return;
		const now = effectiveTransform(node, input.motion, input.frame).position;
		const future = effectiveTransform(
			node,
			input.motion,
			input.frame + lookAhead,
		).position;
		const velocity = {
			x: (future.x - now.x) / lookAhead,
			y: (future.y - now.y) / lookAhead,
		};
		const speed = Math.hypot(velocity.x, velocity.y);
		if (speed < 0.001) return;
		const depth = (index + 1) / count;
		const scaleBoost = Math.min(maxScaleBoost, speed * scalePerSpeed * depth);
		out.set(nodeId, {
			nodeId,
			translate: {
				x: velocity.x * offsetMultiplier * depth,
				y: velocity.y * offsetMultiplier * depth,
			},
			scaleFactor: {
				x: 1 + scaleBoost,
				y: 1 + scaleBoost,
			},
		});
	});
};

/**
 * `noise-wipe`: each target independently sweeps its own seeded
 * `material.reveal.progress` from 0 to 1 (mode "in") or 1 to 0 (mode "out")
 * over `durationFrames`, eased with the same smoothstep curve
 * `automation-bridge.ts` uses for keyframe segments. Unlike a keyframe-track
 * technique, this recomputes `progress` from the binding on every frame — no
 * track is ever written (`createNoiseWipeMotionCommands` is a no-op); the
 * scene command only seeds the base `reveal`/`linearField` state so the
 * target has a real `material.reveal` to vary and reads correctly before this
 * sample composes on top. The target's CURRENT recipe (already seeded) is
 * read from `input.scene` and shallow-merged with only `progress` changed —
 * every other authored field (softness, noiseWeight, mode, unrelated recipe
 * state) passes through untouched, since this technique varies one scalar,
 * not the whole look. If the target's recipe has no seeded `reveal` yet (the
 * scene command has not landed, or ran against a stale plan), this emits
 * nothing rather than fabricating a guessed `reveal` object that could
 * diverge from what the scene command would have seeded.
 */
const sampleNoiseWipe = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	out: Map<string, GrammarNodeSample>,
): void => {
	const durationFrames = noiseWipeDurationFrames(binding);
	const revealOut = isNoiseWipeRevealOut(binding);
	const eased = smoothstep01(input.frame / durationFrames);
	const progress = revealOut ? 1 - eased : eased;
	for (const nodeId of binding.targetIds) {
		const node = findNode(input.scene, nodeId);
		if (!node) continue;
		const recipe = resolveNodeRecipe(node) ?? NEUTRAL_VISUAL_RECIPE;
		const reveal = recipe.texture.material.reveal;
		if (!reveal) continue;
		out.set(nodeId, {
			nodeId,
			recipeOverride: {
				...recipe,
				texture: {
					...recipe.texture,
					material: {
						...recipe.texture.material,
						reveal: { ...reveal, progress },
					},
				},
			},
		});
	}
};

const mergeGrammarFrameSample = (
	target: {
		readonly samples: Map<string, GrammarNodeSample>;
		readonly duplicates: GrammarDuplicateSample[];
	},
	source: GrammarFrameSample,
): void => {
	for (const [nodeId, sample] of source.samples) {
		target.samples.set(nodeId, sample);
	}
	target.duplicates.push(...source.duplicates);
};

/**
 * Samples the marker-enabled Follow-through adapter at the document's absolute
 * frame. Its grammar clip still controls whether the binding is active, but the
 * adapter's `leadExitFrame` is an address into the canonical MotionDocument, not
 * a clip-local offset. This keeps a clip beginning after frame zero from reading
 * the wrong lead velocity or inventing a second trajectory.
 */
const sampleFollowThroughLeadAdapter = (
	binding: MotionGrammarBinding,
	input: GrammarSampleInput,
	activeEndFrameExclusive: number,
): GrammarFrameSample => {
	const roles = followThroughLeadAndFollowerIds(
		binding.targetIds,
		binding.roleMap,
	);
	if (!roles) return { samples: new Map(), duplicates: [] };
	const adapter = buildFollowThroughLeadPresentationAdapter({
		scene: input.scene,
		motion: input.motion,
		leadNodeId: roles.leadNodeId,
		followerNodeIds: roles.followerNodeIds,
		leadExitFrame: binding.parameters.leadExitFrame ?? 12,
		velocityWindowFrames: binding.parameters.velocityWindowFrames,
		followerDelayFrames: binding.parameters.followerDelayFrames,
		followerStaggerFrames: binding.parameters.followerStaggerFrames,
		settleFrames: binding.parameters.settleFrames,
		settleDecay: binding.parameters.settleDecay,
		settleWaves: binding.parameters.settleWaves,
		derivedVelocityGain: binding.parameters.derivedVelocityGain,
		activeEndFrameExclusive,
	});
	if (adapter.status === "blocked")
		return { samples: new Map(), duplicates: [] };
	const sampled = adapter.adapter.sampler(input.frame);
	return "samples" in sampled ? sampled : { samples: sampled, duplicates: [] };
};

const sampleGrammarFrameDirect = (
	bindings: readonly MotionGrammarBinding[],
	input: GrammarSampleInput,
): GrammarFrameSample => {
	const out = new Map<string, GrammarNodeSample>();
	const duplicates: GrammarDuplicateSample[] = [];
	for (const binding of bindings) {
		// A marker is an explicit version choice. If it cannot be resolved, the
		// document must stay inert rather than running the same technique id through
		// an older legacy switch.
		if (
			motionExpressionBindingState(binding.techniqueId, binding.parameters) ===
			"unsupported"
		) {
			continue;
		}
		// V1 Follow-through is dispatched from the indexed sampler because it
		// reads an absolute MotionDocument frame. It must never fall through to
		// the markerless delayed-delta evaluator below.
		if (
			isFollowThroughLeadAdapterParameters(
				binding.techniqueId,
				binding.parameters,
			)
		) {
			continue;
		}
		// Registry-first: an expression-backed technique is sampled through the one
		// generic adapter, so promoting a technique needs no switch case here. The
		// legacy switch is the fallback for techniques not yet expressed as a
		// definition. `input.frame` is already clip-local (resolved by the caller).
		const expressionDefinition = findMotionExpressionDefinition(
			binding.techniqueId,
		);
		if (
			expressionDefinition &&
			(!VERSION_GATED_EXPRESSION_TECHNIQUES.has(binding.techniqueId) ||
				binding.parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY] ===
					expressionDefinition.version)
		) {
			sampleExpressionBinding(
				expressionDefinition,
				binding,
				{
					scene: input.scene,
					frame: input.frame,
					samplePositionAt: (nodeId, frame) => {
						const node = findNode(input.scene, nodeId);
						return node
							? effectiveTransform(node, input.motion, frame).position
							: { x: 0, y: 0 };
					},
					sampleScaleAt: (nodeId, frame) => {
						const node = findNode(input.scene, nodeId);
						return node
							? effectiveTransform(node, input.motion, frame).scale
							: { x: 1, y: 1 };
					},
					restCircleRadiusOf: (nodeId) => {
						const node = findNode(input.scene, nodeId);
						if (node?.geometry.kind !== "ellipse") return null;
						const bounds = getGeometryBounds(node.geometry);
						return bounds.width === bounds.height && bounds.width > 0
							? bounds.width / 2
							: null;
					},
				},
				out,
			);
			continue;
		}
		switch (binding.techniqueId) {
			case "time-delay":
				sampleTimeDelay(binding, input, out);
				break;
			case "time-offset-propagation":
				sampleTimeOffsetPropagation(binding, input, out);
				break;
			case "periodic-afterimage":
				samplePeriodicAfterimage(binding, input, out, duplicates);
				break;
			case "random-phase-pulse":
				sampleRandomPhasePulse(binding, input.frame, out);
				break;
			case "ring-wave-interference":
				sampleRingWaveInterference(binding, input, out);
				break;
			case "arrangement-transition":
				sampleArrangementTransition(binding, input, out);
				break;
			case "merge-split-cycle":
				sampleMergeSplitCycle(binding, input, out);
				break;
			case "count-growth":
				sampleCountGrowth(binding, input.frame, out);
				break;
			case "mirror-symmetric-scale":
				sampleMirrorSymmetricScale(binding, input, out);
				break;
			case "boolean-difference-rotation":
				sampleBooleanDifferenceRotation(binding, input, out);
				break;
			case "inverse-proportion-link":
				sampleInverseProportionLink(binding, input, out);
				break;
			case "reactive-neighbor-displacement":
				sampleReactiveNeighborDisplacement(binding, input, out);
				break;
			case "lag-follow-through":
				sampleLagFollowThrough(binding, input, out);
				break;
			case "planar-solid-tumble":
				samplePlanarSolidTumble(binding, input.frame, out);
				break;
			case "shear-split":
				sampleShearSplit(binding, input.frame, out);
				break;
			case "auto-orient-along-path":
				sampleAutoOrientAlongPath(binding, input, out);
				break;
			case "size-speed-parallax":
				sampleSizeSpeedParallax(binding, input, out);
				break;
			case "noise-wipe":
				sampleNoiseWipe(binding, input, out);
				break;
			// Unknown forward-version techniques are inert rather than throwing.
			default:
				break;
		}
	}
	return { samples: out, duplicates };
};

/**
 * Compiles binding-to-clip activation once for a presentation pass. The index is
 * intentionally document-local: rebuild it whenever the grammar bindings or
 * motion clips change, then reuse it across frame samples for scrub, playback,
 * preview, and export.
 */
export function createMotionGrammarSamplingIndex(
	bindings: readonly MotionGrammarBinding[],
	motion: MotionDocument,
): MotionGrammarSamplingIndex {
	const clipRanges = motion.clips
		.map(normalizeGrammarClipRange)
		.filter((clip): clip is MotionGrammarSamplingClipRange => Boolean(clip));
	return {
		entries: bindings.map((binding) => ({
			binding,
			clip: clipRanges.find((clip) => clip.bindingId === binding.id),
		})),
		evaluationMotion: withoutGrammarClips(motion),
	};
}

/**
 * Samples one frame through a compiled grammar index. Clip activation is resolved
 * before technique evaluation, so ordinary techniques receive the same
 * continuous clip-local frame contract and inactive clips produce no samples or
 * duplicates. The marker-enabled Follow-through adapter is the deliberate
 * exception: its clip is an activation window, while its lead track reads the
 * absolute `MotionDocument` frame.
 */
export function sampleGrammarFrameWithIndex(
	index: MotionGrammarSamplingIndex,
	input: GrammarSampleInput,
): GrammarFrameSample {
	const out = new Map<string, GrammarNodeSample>();
	const duplicates: GrammarDuplicateSample[] = [];
	const activeFollowThroughEntries: MotionGrammarSamplingIndexEntry[] = [];
	for (const entry of index.entries) {
		const localFrame = resolveGrammarLocalFrame(entry.clip, input.frame);
		if (localFrame === null) continue;
		if (
			isFollowThroughLeadAdapterParameters(
				entry.binding.techniqueId,
				entry.binding.parameters,
			)
		) {
			// This response is deliberately composed after all ordinary grammar
			// samples. It is additive rather than a competing replace-order law,
			// so an independently authored follower channel must survive no matter
			// which binding happens to appear first in document order.
			activeFollowThroughEntries.push(entry);
			continue;
		}
		mergeGrammarFrameSample(
			{ samples: out, duplicates },
			sampleGrammarFrameDirect([entry.binding], {
				scene: input.scene,
				motion: index.evaluationMotion,
				frame: localFrame,
			}),
		);
	}
	for (const entry of activeFollowThroughEntries) {
		mergeFollowThroughLeadFrameSample(
			{ samples: out, duplicates },
			sampleFollowThroughLeadAdapter(
				entry.binding,
				{
					scene: input.scene,
					motion: index.evaluationMotion,
					frame: input.frame,
				},
				entry.clip
					? entry.clip.startFrame + entry.clip.durationFrames
					: index.evaluationMotion.durationFrames,
			),
		);
	}
	return { samples: out, duplicates };
}

/**
 * Per-`motion` cache of compiled sampling indices, keyed on the exact `bindings`
 * array reference. `createMotionGrammarSamplingIndex` only reads `bindings` and
 * `motion` (never `scene`), so its result is safe to reuse across presentation
 * calls that keep those two references stable — e.g. a geometry-only scene edit,
 * which replaces the scene document but leaves the motion and motion-grammar
 * Zustand/Immer stores (and therefore their document references) untouched. Both
 * maps are `WeakMap`s: an entry is dropped automatically once its `motion`
 * document or `bindings` array is replaced and becomes unreferenced elsewhere, so
 * this never needs explicit invalidation.
 */
const motionGrammarSamplingIndexCache = new WeakMap<
	MotionDocument,
	WeakMap<readonly MotionGrammarBinding[], MotionGrammarSamplingIndex>
>();

/**
 * Identity-memoized {@link createMotionGrammarSamplingIndex}. Exported so callers
 * that already hold a compiled index elsewhere (and tests) can observe the cache
 * behavior directly; {@link buildMotionGrammarFrameSampler} is the primary caller.
 */
export function getMotionGrammarSamplingIndex(
	bindings: readonly MotionGrammarBinding[],
	motion: MotionDocument,
): MotionGrammarSamplingIndex {
	let byBindings = motionGrammarSamplingIndexCache.get(motion);
	if (!byBindings) {
		byBindings = new WeakMap();
		motionGrammarSamplingIndexCache.set(motion, byBindings);
	}
	const cached = byBindings.get(bindings);
	if (cached) return cached;
	const index = createMotionGrammarSamplingIndex(bindings, motion);
	byBindings.set(bindings, index);
	return index;
}

/**
 * Builds the per-frame sampler consumed by the motion presentation bridge. This
 * is the shared runtime/export entry point for motion grammar so canvas scrub,
 * playback, and exported frames cannot drift on clip activation or local time.
 *
 * Only the compiled index (binding-to-clip activation) is memoized, via
 * {@link getMotionGrammarSamplingIndex}; the returned closure always captures the
 * `scene` passed on THIS call. Grammar techniques such as `ring-wave-interference`
 * and `mirror-symmetric-scale` read node positions/transforms out of `scene` at
 * sample time (see `positionedTargets`, `sampleMirrorSymmetricScale`), so caching
 * the closure itself — not just the index — would silently replay a stale scene
 * snapshot across geometry-only edits. Rebuilding this small closure per call is
 * the cheap part; recompiling the index was the part worth avoiding.
 */
export function buildMotionGrammarFrameSampler(
	input:
		| {
				readonly bindings: readonly MotionGrammarBinding[] | undefined;
				readonly scene: SceneDocument;
				readonly motion: MotionDocument;
		  }
		| undefined,
): GrammarFrameSampler | undefined {
	if (!input?.bindings || input.bindings.length === 0) return undefined;
	const index = getMotionGrammarSamplingIndex(input.bindings, input.motion);
	return (frame: number) =>
		sampleGrammarFrameWithIndex(index, {
			scene: input.scene,
			motion: input.motion,
			frame,
		});
}

/**
 * Evaluates rich grammar bindings into the full presentation bridge payload for
 * one frame. `samples` contains one composed pose per real node; `duplicates`
 * contains synthetic draw requests such as afterimages that must not be written
 * back to the scene document.
 */
export function sampleGrammarFrame(
	bindings: readonly MotionGrammarBinding[],
	input: GrammarSampleInput,
): GrammarFrameSample {
	return sampleGrammarFrameWithIndex(
		createMotionGrammarSamplingIndex(bindings, input.motion),
		input,
	);
}

/**
 * Legacy one-sample-per-node bridge for callers that only understand direct pose
 * composition. Duplicate-only techniques intentionally disappear here.
 */
export function sampleGrammarMap(
	bindings: readonly MotionGrammarBinding[],
	input: GrammarSampleInput,
): ReadonlyMap<string, GrammarNodeSample> {
	return sampleGrammarFrame(bindings, input).samples;
}
