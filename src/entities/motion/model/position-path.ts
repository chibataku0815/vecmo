import type { Vec2 } from "@/entities/scene/model/types";
import {
	type AeKeyframe,
	sampleKeyframeTrack,
} from "@/shared/glammer/keyframe-track";
import { deepEqual } from "@/shared/lib/deep-equal";
import type {
	KeyframeTrack,
	MotionDocument,
	PositionPathKey,
	PositionPathTrack,
} from "./types";

export type PositionPathIssueCode =
	| "position-path-target-missing"
	| "position-path-key-invalid"
	| "position-path-key-unpaired"
	| "position-path-timing-mismatch"
	| "position-path-duplicate-frame";

export type PositionPathIssue = {
	readonly code: PositionPathIssueCode;
	readonly severity: "warning" | "error";
	readonly trackId: string;
	readonly nodeId: string;
	readonly frame?: number;
	readonly message: string;
};

export type ResolvedPositionPathKey = PositionPathKey & {
	readonly position: Vec2;
	readonly resolvedInTangent: Vec2;
	readonly resolvedOutTangent: Vec2;
};

export type PositionPathResolution = {
	readonly track: PositionPathTrack | null;
	readonly keys: readonly ResolvedPositionPathKey[];
	readonly issues: readonly PositionPathIssue[];
};

const finitePoint = (value: Vec2): boolean =>
	Number.isFinite(value.x) && Number.isFinite(value.y);

const numericKeys = (track: KeyframeTrack | undefined): AeKeyframe<number>[] =>
	track?.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<number> =>
			Number.isFinite(keyframe.time) &&
			typeof keyframe.value === "number" &&
			Number.isFinite(keyframe.value),
	) ?? [];

type PositionPathMotionIndex = {
	readonly pathByNodeId: ReadonlyMap<string, PositionPathTrack>;
	readonly scalarTrackByTarget: ReadonlyMap<string, KeyframeTrack>;
};

const motionIndexCache = new WeakMap<MotionDocument, PositionPathMotionIndex>();
const resolutionCache = new WeakMap<
	MotionDocument,
	Map<string, PositionPathResolution>
>();

const scalarTargetKey = (nodeId: string, property: "x" | "y"): string =>
	`${nodeId}\u0000${property}`;

const motionIndex = (motion: MotionDocument): PositionPathMotionIndex => {
	const cached = motionIndexCache.get(motion);
	if (cached) return cached;
	const index: PositionPathMotionIndex = {
		pathByNodeId: new Map(
			(motion.positionPaths ?? []).map((path) => [path.nodeId, path]),
		),
		scalarTrackByTarget: new Map(
			motion.tracks.flatMap((track) =>
				track.target.property === "x" || track.target.property === "y"
					? [
							[
								scalarTargetKey(track.target.nodeId, track.target.property),
								track,
							],
						]
					: [],
			),
		),
	};
	motionIndexCache.set(motion, index);
	return index;
};

const scalarTrack = (
	motion: MotionDocument,
	nodeId: string,
	property: "x" | "y",
): KeyframeTrack | undefined =>
	motionIndex(motion).scalarTrackByTarget.get(
		scalarTargetKey(nodeId, property),
	);

const keyAt = (
	keys: readonly AeKeyframe<number>[],
	frame: number,
): AeKeyframe<number> | undefined =>
	keys.find((keyframe) => keyframe.time === frame);

const temporalEnvelope = (
	from: AeKeyframe<number>,
	to: AeKeyframe<number>,
): unknown => ({
	outInterpolationType: from.outInterpolationType,
	outTemporalEase: from.outTemporalEase,
	inInterpolationType: to.inInterpolationType,
	inTemporalEase: to.inTemporalEase,
});

const autoTangent = (
	positions: readonly Vec2[],
	index: number,
): { readonly incoming: Vec2; readonly outgoing: Vec2 } => {
	const current = positions[index];
	const previous = positions[Math.max(0, index - 1)] ?? current;
	const next = positions[Math.min(positions.length - 1, index + 1)] ?? current;
	const tangent = {
		x: (next.x - previous.x) / 6,
		y: (next.y - previous.y) / 6,
	};
	return {
		incoming: index === 0 ? { x: 0, y: 0 } : { x: -tangent.x, y: -tangent.y },
		outgoing: index === positions.length - 1 ? { x: 0, y: 0 } : tangent,
	};
};

/** Returns the optional spatial path metadata for a node. */
export function findPositionPathTrack(
	motion: MotionDocument,
	nodeId: string,
): PositionPathTrack | undefined {
	return motionIndex(motion).pathByNodeId.get(nodeId);
}

/**
 * Resolves paired X/Y values and effective spatial tangents without mutating the
 * MotionDocument. Invalid metadata remains inspectable through typed issues and
 * is excluded from cubic sampling.
 */
export function resolvePositionPath(
	motion: MotionDocument,
	nodeId: string,
): PositionPathResolution {
	const cached = resolutionCache.get(motion)?.get(nodeId);
	if (cached) return cached;
	const cache = resolutionCache.get(motion) ?? new Map();
	if (!resolutionCache.has(motion)) resolutionCache.set(motion, cache);
	const track = findPositionPathTrack(motion, nodeId) ?? null;
	if (!track) {
		const empty = { track: null, keys: [], issues: [] } as const;
		cache.set(nodeId, empty);
		return empty;
	}
	const xKeys = numericKeys(scalarTrack(motion, nodeId, "x"));
	const yKeys = numericKeys(scalarTrack(motion, nodeId, "y"));
	const issues: PositionPathIssue[] = [];
	const seen = new Set<number>();
	const paired = [...track.keys]
		.sort((left, right) => left.frame - right.frame)
		.flatMap((key) => {
			if (
				!Number.isFinite(key.frame) ||
				!finitePoint(key.inTangent) ||
				!finitePoint(key.outTangent)
			) {
				issues.push({
					code: "position-path-key-invalid",
					severity: "error",
					trackId: track.id,
					nodeId,
					...(Number.isFinite(key.frame) ? { frame: key.frame } : {}),
					message: "Spatial path keys require finite frame and tangent values.",
				});
				return [];
			}
			if (seen.has(key.frame)) {
				issues.push({
					code: "position-path-duplicate-frame",
					severity: "error",
					trackId: track.id,
					nodeId,
					frame: key.frame,
					message: `Spatial path has more than one key at frame ${key.frame}.`,
				});
				return [];
			}
			seen.add(key.frame);
			const x = keyAt(xKeys, key.frame);
			const y = keyAt(yKeys, key.frame);
			if (!x || !y) {
				issues.push({
					code: "position-path-key-unpaired",
					severity: "error",
					trackId: track.id,
					nodeId,
					frame: key.frame,
					message: `Spatial path key at frame ${key.frame} requires paired X and Y keys.`,
				});
				return [];
			}
			return [{ key, position: { x: x.value, y: y.value }, x, y }];
		});

	for (let index = 0; index < paired.length - 1; index += 1) {
		const current = paired[index];
		const next = paired[index + 1];
		if (
			!deepEqual(
				temporalEnvelope(current.x, next.x),
				temporalEnvelope(current.y, next.y),
			)
		) {
			issues.push({
				code: "position-path-timing-mismatch",
				severity: "error",
				trackId: track.id,
				nodeId,
				frame: current.key.frame,
				message: `Spatial segment from frame ${current.key.frame} requires matching X/Y temporal easing.`,
			});
		}
	}

	const positions = paired.map((entry) => entry.position);
	const keys = paired.map((entry, index): ResolvedPositionPathKey => {
		const automatic = autoTangent(positions, index);
		return {
			...entry.key,
			position: entry.position,
			resolvedInTangent:
				entry.key.spatialMode === "auto"
					? automatic.incoming
					: entry.key.inTangent,
			resolvedOutTangent:
				entry.key.spatialMode === "auto"
					? automatic.outgoing
					: entry.key.outTangent,
		};
	});
	const resolution = { track, keys, issues };
	cache.set(nodeId, resolution);
	return resolution;
}

const cubic = (
	from: Vec2,
	control1: Vec2,
	control2: Vec2,
	to: Vec2,
	t: number,
): Vec2 => {
	const inverse = 1 - t;
	const a = inverse * inverse * inverse;
	const b = 3 * inverse * inverse * t;
	const c = 3 * inverse * t * t;
	const d = t * t * t;
	return {
		x: a * from.x + b * control1.x + c * control2.x + d * to.x,
		y: a * from.y + b * control1.y + c * control2.y + d * to.y,
	};
};

/**
 * Samples a valid cubic spatial segment. Returns `null` outside the authored
 * spatial range or when any issue would make the result ambiguous, allowing the
 * caller to preserve the established scalar X/Y fallback.
 */
export function samplePositionPath(
	motion: MotionDocument,
	nodeId: string,
	frame: number,
): {
	readonly position: Vec2;
	readonly issues: readonly PositionPathIssue[];
} | null {
	const resolution = resolvePositionPath(motion, nodeId);
	if (
		resolution.keys.length < 2 ||
		resolution.issues.some((entry) => entry.severity === "error")
	) {
		return null;
	}
	const keys = resolution.keys;
	if (frame < keys[0].frame || frame > keys[keys.length - 1].frame) return null;
	const exact = keys.find((key) => key.frame === frame);
	if (exact) return { position: exact.position, issues: resolution.issues };
	const index = keys.findIndex(
		(key, keyIndex) =>
			keyIndex < keys.length - 1 &&
			frame > key.frame &&
			frame < keys[keyIndex + 1].frame,
	);
	if (index < 0) return null;
	const from = keys[index];
	const to = keys[index + 1];
	const xTrack = scalarTrack(motion, nodeId, "x");
	const fromX = xTrack ? keyAt(numericKeys(xTrack), from.frame) : undefined;
	const toX = xTrack ? keyAt(numericKeys(xTrack), to.frame) : undefined;
	if (!fromX || !toX) return null;
	const progress = sampleKeyframeTrack(
		[
			{ ...fromX, value: 0 },
			{ ...toX, value: 1 },
		],
		frame,
	);
	return {
		position: cubic(
			from.position,
			{
				x: from.position.x + from.resolvedOutTangent.x,
				y: from.position.y + from.resolvedOutTangent.y,
			},
			{
				x: to.position.x + to.resolvedInTangent.x,
				y: to.position.y + to.resolvedInTangent.y,
			},
			to.position,
			progress,
		),
		issues: resolution.issues,
	};
}
