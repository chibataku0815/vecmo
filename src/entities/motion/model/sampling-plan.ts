import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import { sampleKeyframeTrack } from "@/shared/glammer/keyframe-track";
import type {
	AnimatableProperty,
	KeyframeTrack,
	MotionDocument,
} from "./types";

type CompiledNumericTrack = {
	readonly denseLinearStart: number | null;
	readonly keyframes: AeKeyframe<number>[];
	readonly values: readonly number[];
};

export type MotionSamplingPlan = {
	readonly animatedNodeIdSet: ReadonlySet<string>;
	readonly animatedNodeIds: readonly string[];
	readonly tracksByNode: ReadonlyMap<
		string,
		ReadonlyMap<AnimatableProperty, KeyframeTrack>
	>;
	readonly numericTracks: ReadonlyMap<KeyframeTrack, CompiledNumericTrack>;
};

const plans = new WeakMap<MotionDocument, MotionSamplingPlan>();

const averageInfluence = (
	points: readonly { readonly influence: number }[] | undefined,
): number | null => {
	if (!points?.length) return null;
	return (
		points.reduce((sum, point) => sum + point.influence, 0) / points.length
	);
};

const curveSamplesLinearly = (
	from: AeKeyframe<number>,
	to: AeKeyframe<number>,
): boolean => {
	if (from.outInterpolationType === 6614) return false;
	const curve = from.outTemporalCurve;
	if (curve) {
		return (
			curve.x1 === curve.y1 &&
			curve.x2 === curve.y2 &&
			curve.x1 >= 0 &&
			curve.x1 <= 1 &&
			curve.x2 >= 0 &&
			curve.x2 <= 1
		);
	}
	return (
		averageInfluence(from.outTemporalEase) === 0 &&
		averageInfluence(to.inTemporalEase) === 0
	);
};

const compileNumericTrack = (
	track: KeyframeTrack,
): CompiledNumericTrack | null => {
	const keyframes = track.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<number> =>
			Number.isFinite(keyframe.time) &&
			typeof keyframe.value === "number" &&
			Number.isFinite(keyframe.value),
	);
	if (keyframes.length === 0) return null;
	const start = keyframes[0]?.time ?? 0;
	const denseLinear = keyframes.every((keyframe, index) => {
		if (keyframe.time !== start + index) return false;
		const next = keyframes[index + 1];
		return !next || curveSamplesLinearly(keyframe, next);
	});
	return {
		denseLinearStart: denseLinear ? start : null,
		keyframes,
		values: keyframes.map((keyframe) => keyframe.value),
	};
};

/**
 * Builds immutable-document-keyed lookup and numeric sampling state. The plan is
 * derived read data: replacing a MotionDocument identity makes the old plan
 * unreachable and never changes serialization, history, or command ownership.
 */
export function getMotionSamplingPlan(
	motion: MotionDocument,
): MotionSamplingPlan {
	const cached = plans.get(motion);
	if (cached) return cached;
	const mutableTracksByNode = new Map<
		string,
		Map<AnimatableProperty, KeyframeTrack>
	>();
	const numericTracks = new Map<KeyframeTrack, CompiledNumericTrack>();
	const animatedNodeIds: string[] = [];
	const animatedNodes = new Set<string>();
	for (const track of motion.tracks) {
		let byProperty = mutableTracksByNode.get(track.target.nodeId);
		if (!byProperty) {
			byProperty = new Map();
			mutableTracksByNode.set(track.target.nodeId, byProperty);
		}
		if (!byProperty.has(track.target.property)) {
			byProperty.set(track.target.property, track);
		}
		const numeric = compileNumericTrack(track);
		if (numeric) numericTracks.set(track, numeric);
		if (track.keyframes.length > 0 && !animatedNodes.has(track.target.nodeId)) {
			animatedNodes.add(track.target.nodeId);
			animatedNodeIds.push(track.target.nodeId);
		}
	}
	const plan: MotionSamplingPlan = {
		animatedNodeIdSet: animatedNodes,
		animatedNodeIds,
		tracksByNode: mutableTracksByNode,
		numericTracks,
	};
	plans.set(motion, plan);
	return plan;
}

/** Looks up a track without scanning the document's complete track array. */
export function indexedTrack(
	motion: MotionDocument,
	nodeId: string,
	property: AnimatableProperty,
): KeyframeTrack | undefined {
	return getMotionSamplingPlan(motion).tracksByNode.get(nodeId)?.get(property);
}

/**
 * Samples a sanitized numeric track. Consecutive, sampler-equivalent linear
 * tracks address values directly; every other track uses the canonical sampler.
 */
export function sampleIndexedNumericTrack(
	motion: MotionDocument,
	track: KeyframeTrack,
	frame: number,
): number | null {
	const compiled = getMotionSamplingPlan(motion).numericTracks.get(track);
	if (!compiled) return null;
	const start = compiled.denseLinearStart;
	if (start === null) return sampleKeyframeTrack(compiled.keyframes, frame);
	const lastIndex = compiled.values.length - 1;
	if (frame <= start) return compiled.values[0] ?? null;
	if (frame >= start + lastIndex) return compiled.values[lastIndex] ?? null;
	const offset = frame - start;
	const lowerIndex = Math.floor(offset);
	const from = compiled.values[lowerIndex];
	const to = compiled.values[lowerIndex + 1];
	if (from === undefined || to === undefined) return null;
	return from + (to - from) * (offset - lowerIndex);
}
