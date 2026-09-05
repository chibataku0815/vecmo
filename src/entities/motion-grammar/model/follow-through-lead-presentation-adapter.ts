/**
 * Explicit read-only bridge from an authored MotionDocument lead track into a
 * Follow-through presentation sampler.
 *
 * Boundary (intentionally one-way):
 *
 *   SceneDocument + MotionDocument --effectiveTransform--> adapter sampler
 *     --GrammarFrameSampler--> motion presentation / export presentation
 *
 * The adapter never stores a second lead trajectory. `leadExitFrame` is only a
 * semantic address into the existing MotionDocument; every lead pose, lag
 * delta, and exit velocity is read through motion's canonical sampler. It also
 * deliberately reads the pre-grammar MotionDocument pose, so the response
 * cannot recursively consume its own presentation output.
 */

import type {
	GrammarDuplicateSample,
	GrammarFrameSample,
	GrammarFrameSampler,
	GrammarNodeSample,
} from "@/entities/motion/model/grammar-bridge";
import { effectiveTransform } from "@/entities/motion/model/sampler";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	findNode,
	selectAllArtboards,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";

const VELOCITY_EPSILON = 1e-6;
const DEFAULT_VELOCITY_WINDOW_FRAMES = 1;
const DEFAULT_FOLLOWER_DELAY_FRAMES = 6;
const DEFAULT_FOLLOWER_STAGGER_FRAMES = 6;
const DEFAULT_SETTLE_FRAMES = 30;
const DEFAULT_SETTLE_DECAY = 2;
const DEFAULT_SETTLE_WAVES = 2;
const DEFAULT_DERIVED_VELOCITY_GAIN = 0.08;
/**
 * A follower's transient lean is derived from its residual displacement along
 * the authored lead exit direction. It is deliberately not an authorable
 * control: changing it would create a second, ungrounded rotation law.
 */
const DERIVED_LEAN_DEGREES_PER_PIXEL = 0.12;

export type FollowThroughLeadTrackRead = {
	readonly leadNodeId: string;
	readonly exitFrame: number;
	readonly velocityWindowFrames: number;
	readonly restPosition: { readonly x: number; readonly y: number };
	readonly exitPosition: { readonly x: number; readonly y: number };
	readonly precedingPosition: { readonly x: number; readonly y: number };
	/** Pixels per frame, derived only from the authored lead track. */
	readonly exitVelocity: { readonly x: number; readonly y: number };
};

/**
 * Presentation-only controls. `leadExitFrame` references an existing motion
 * frame and never duplicates a position, curve, or lead transform. The bounded
 * `derivedVelocityGain` multiplies the calculated velocity; it is not an
 * independent bounce-amplitude field.
 */
export type FollowThroughLeadPresentationAdapterInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly leadNodeId: string;
	readonly followerNodeIds: readonly string[];
	/** Optional explicit artboard target; it must equal every role's owner. */
	readonly artboardId?: string | null;
	/** Absolute MotionDocument frame at which the authored lead leg exits. */
	readonly leadExitFrame: number;
	readonly velocityWindowFrames?: number;
	readonly followerDelayFrames?: number;
	readonly followerStaggerFrames?: number;
	readonly settleFrames?: number;
	readonly settleDecay?: number;
	readonly settleWaves?: number;
	readonly derivedVelocityGain?: number;
	/**
	 * Exclusive absolute frame at which this binding stops being active. A
	 * grammar clip supplies it at runtime; authoring without a clip uses the
	 * MotionDocument duration. The adapter rejects a window that would cut off
	 * the final follower before it settles.
	 */
	readonly activeEndFrameExclusive?: number;
};

export type FollowThroughLeadPresentationAdapter = {
	readonly cameraSpacePolicy: "screen_2d";
	readonly leadTrack: FollowThroughLeadTrackRead;
	/**
	 * A grammar payload for existing follower nodes only. Give this sampler to
	 * `composeFollowThroughLeadPresentationSampler`, then pass that result through
	 * the normal expression-aware/motion presentation route.
	 */
	readonly sampler: GrammarFrameSampler;
};

export type FollowThroughLeadPresentationAdapterResult =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly adapter: FollowThroughLeadPresentationAdapter;
	  };

type ResolvedOptions = {
	readonly velocityWindowFrames: number;
	readonly followerDelayFrames: number;
	readonly followerStaggerFrames: number;
	readonly settleFrames: number;
	readonly settleDecay: number;
	readonly settleWaves: number;
	readonly derivedVelocityGain: number;
};

type FollowThroughFollowerPose = {
	readonly translate: { readonly x: number; readonly y: number };
	readonly rotate: number;
};

const emptyFrame = (): GrammarFrameSample => ({
	samples: new Map<string, GrammarNodeSample>(),
	duplicates: [],
});

const blocked = (
	reason: string,
): FollowThroughLeadPresentationAdapterResult => ({
	status: "blocked",
	reason,
});

const finiteOr = (value: number | undefined, fallback: number): number =>
	Number.isFinite(value) ? (value as number) : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(maximum, Math.max(minimum, value));

const subtract = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => ({
	x: left.x - right.x,
	y: left.y - right.y,
});

const scale = (
	vector: { readonly x: number; readonly y: number },
	factor: number,
): { readonly x: number; readonly y: number } => ({
	x: vector.x * factor,
	y: vector.y * factor,
});

const add = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => ({
	x: left.x + right.x,
	y: left.y + right.y,
});

const dot = (
	left: { readonly x: number; readonly y: number },
	right: { readonly x: number; readonly y: number },
): number => left.x * right.x + left.y * right.y;

const isFiniteVector = (value: {
	readonly x: number;
	readonly y: number;
}): boolean => Number.isFinite(value.x) && Number.isFinite(value.y);

const resolveOptions = (
	input: FollowThroughLeadPresentationAdapterInput,
): ResolvedOptions | string => {
	const suppliedValues = [
		input.velocityWindowFrames,
		input.followerDelayFrames,
		input.followerStaggerFrames,
		input.settleFrames,
		input.settleDecay,
		input.settleWaves,
		input.derivedVelocityGain,
	];
	if (
		suppliedValues.some(
			(value) => value !== undefined && !Number.isFinite(value),
		)
	) {
		return "Follow-through options must be finite numbers when supplied.";
	}
	const velocityWindowFrames = finiteOr(
		input.velocityWindowFrames,
		DEFAULT_VELOCITY_WINDOW_FRAMES,
	);
	const followerDelayFrames = finiteOr(
		input.followerDelayFrames,
		DEFAULT_FOLLOWER_DELAY_FRAMES,
	);
	const followerStaggerFrames = finiteOr(
		input.followerStaggerFrames,
		DEFAULT_FOLLOWER_STAGGER_FRAMES,
	);
	const settleFrames = finiteOr(input.settleFrames, DEFAULT_SETTLE_FRAMES);
	const settleDecay = finiteOr(input.settleDecay, DEFAULT_SETTLE_DECAY);
	const settleWaves = finiteOr(input.settleWaves, DEFAULT_SETTLE_WAVES);
	const derivedVelocityGain = finiteOr(
		input.derivedVelocityGain,
		DEFAULT_DERIVED_VELOCITY_GAIN,
	);
	if (
		!Number.isInteger(velocityWindowFrames) ||
		velocityWindowFrames < 1 ||
		velocityWindowFrames > 24
	) {
		return "Follow-through velocityWindowFrames must be a whole value from 1 to 24.";
	}
	if (
		!Number.isInteger(followerDelayFrames) ||
		!Number.isInteger(followerStaggerFrames) ||
		followerDelayFrames < 0 ||
		followerDelayFrames > 120 ||
		followerStaggerFrames < 0 ||
		followerStaggerFrames > 120
	) {
		return "Follow-through follower delay and stagger must be whole values from 0 to 120.";
	}
	if (
		!Number.isInteger(settleFrames) ||
		settleFrames < 1 ||
		settleFrames > 600
	) {
		return "Follow-through settleFrames must be a whole value from 1 to 600.";
	}
	if (settleDecay < 0 || settleDecay > 8) {
		return "Follow-through settleDecay must be between zero and eight.";
	}
	if (!Number.isInteger(settleWaves) || settleWaves < 1 || settleWaves > 6) {
		return "Follow-through settleWaves must be a whole value from 1 to 6.";
	}
	if (derivedVelocityGain < 0 || derivedVelocityGain > 0.5) {
		return "Follow-through derivedVelocityGain must remain between zero and 0.5.";
	}
	return {
		velocityWindowFrames,
		followerDelayFrames,
		followerStaggerFrames,
		settleFrames,
		settleDecay,
		settleWaves,
		derivedVelocityGain,
	};
};

const resolveScreenSpaceRoles = (
	input: FollowThroughLeadPresentationAdapterInput,
):
	| {
			readonly lead: VectorNode;
			readonly followers: readonly string[];
	  }
	| string => {
	const lead = findNode(input.scene, input.leadNodeId);
	if (!lead)
		return "Follow-through lead must resolve to an existing scene node.";
	if (input.followerNodeIds.length === 0) {
		return "Follow-through requires at least one existing follower node.";
	}
	const uniqueFollowerIds = [...new Set(input.followerNodeIds)];
	if (uniqueFollowerIds.length !== input.followerNodeIds.length) {
		return "Follow-through follower node ids must be unique.";
	}
	if (uniqueFollowerIds.includes(input.leadNodeId)) {
		return "Follow-through lead cannot also be a follower.";
	}
	const leadArtboardId = selectArtboardIdForNode(input.scene, lead.id);
	if (!leadArtboardId) {
		return "Follow-through lead must resolve to one artboard.";
	}
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== leadArtboardId
	) {
		return "Follow-through artboardId must match the lead artboard.";
	}
	const structuralParentPaths = structuralParentPathsByNodeId(input.scene);
	const leadParentPath = structuralParentPaths.get(lead.id);
	if (!leadParentPath) {
		return "Follow-through lead must belong to a stable structural parent path.";
	}
	for (const followerNodeId of uniqueFollowerIds) {
		if (!findNode(input.scene, followerNodeId)) {
			return "Follow-through followers must resolve to existing scene nodes.";
		}
		if (
			selectArtboardIdForNode(input.scene, followerNodeId) !== leadArtboardId
		) {
			return "Follow-through lead and followers must share one artboard.";
		}
		if (structuralParentPaths.get(followerNodeId) !== leadParentPath) {
			return "Follow-through lead and followers must share one structural parent coordinate space.";
		}
	}
	const artboard = selectAllArtboards(input.scene).find(
		(candidate) => candidate.id === leadArtboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return "Follow-through lead-track adapter requires an explicit screen_2d artboard policy.";
	}
	return { lead, followers: uniqueFollowerIds };
};

/**
 * Returns the layer plus ancestor-node chain for each scene node. Grammar
 * translation is locally composed, so same-artboard alone does not make two
 * differently nested nodes comparable. V1 intentionally supports only roles
 * under one identical parent chain rather than guessing world-to-local math.
 */
const structuralParentPathsByNodeId = (
	scene: SceneDocument,
): ReadonlyMap<string, string> => {
	const paths = new Map<string, string>();
	const visit = (
		nodes: readonly VectorNode[],
		parentPath: readonly string[],
	): void => {
		for (const node of nodes) {
			paths.set(node.id, parentPath.join("/"));
			if (node.children) visit(node.children, [...parentPath, node.id]);
		}
	};
	for (const layer of scene.layers) {
		visit(layer.nodes, [`layer:${layer.id}`]);
	}
	return paths;
};

const readLeadTrack = ({
	lead,
	motion,
	exitFrame,
	velocityWindowFrames,
}: {
	readonly lead: VectorNode;
	readonly motion: MotionDocument;
	readonly exitFrame: number;
	readonly velocityWindowFrames: number;
}): FollowThroughLeadTrackRead | string => {
	const exitPosition = effectiveTransform(lead, motion, exitFrame).position;
	const precedingPosition = effectiveTransform(
		lead,
		motion,
		exitFrame - velocityWindowFrames,
	).position;
	if (!isFiniteVector(exitPosition) || !isFiniteVector(precedingPosition)) {
		return "Follow-through lead track yielded a non-finite effective transform.";
	}
	const exitVelocity = scale(
		subtract(exitPosition, precedingPosition),
		1 / velocityWindowFrames,
	);
	if (Math.hypot(exitVelocity.x, exitVelocity.y) <= VELOCITY_EPSILON) {
		return "Follow-through lead exit must have non-zero effective position velocity.";
	}
	return {
		leadNodeId: lead.id,
		exitFrame,
		velocityWindowFrames,
		restPosition: { ...lead.transform.position },
		exitPosition,
		precedingPosition,
		exitVelocity,
	};
};

const followThroughTranslateAt = ({
	lead,
	motion,
	frame,
	followerIndex,
	leadTrack,
	options,
}: {
	readonly lead: VectorNode;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly followerIndex: number;
	readonly leadTrack: FollowThroughLeadTrackRead;
	readonly options: ResolvedOptions;
}): FollowThroughFollowerPose => {
	const delayFrames =
		options.followerDelayFrames + followerIndex * options.followerStaggerFrames;
	const leadNow = effectiveTransform(lead, motion, frame).position;
	const leadDelayed = effectiveTransform(
		lead,
		motion,
		Math.max(0, frame - delayFrames),
	).position;
	if (!isFiniteVector(leadNow) || !isFiniteVector(leadDelayed)) {
		return { translate: { x: 0, y: 0 }, rotate: 0 };
	}
	// This relative lag decays to zero once the existing lead track reaches its
	// endpoint; it is not a second follower position or a copied lead track.
	const lag = subtract(leadDelayed, leadNow);
	const responseStartFrame = leadTrack.exitFrame + delayFrames;
	const elapsedFrames = frame - responseStartFrame;
	if (elapsedFrames < 0 || elapsedFrames >= options.settleFrames) {
		return { translate: lag, rotate: 0 };
	}
	const settleProgress = clamp(elapsedFrames / options.settleFrames, 0, 1);
	const oscillation = Math.sin(
		Math.PI * 2 * options.settleWaves * settleProgress,
	);
	const damping = (1 - settleProgress) ** options.settleDecay;
	const residual = scale(
		leadTrack.exitVelocity,
		options.settleFrames * options.derivedVelocityGain * oscillation * damping,
	);
	const velocityMagnitude = Math.hypot(
		leadTrack.exitVelocity.x,
		leadTrack.exitVelocity.y,
	);
	const exitDirection = scale(leadTrack.exitVelocity, 1 / velocityMagnitude);
	return {
		translate: add(lag, residual),
		rotate: dot(residual, exitDirection) * DERIVED_LEAN_DEGREES_PER_PIXEL,
	};
};

/**
 * Reads one authored lead track once at its declared exit, then exposes a
 * presentation-only sampler for the named followers. No document is written,
 * serialized, or cached; immutable Scene/Motion inputs remain the only truth.
 */
export function buildFollowThroughLeadPresentationAdapter(
	input: FollowThroughLeadPresentationAdapterInput,
): FollowThroughLeadPresentationAdapterResult {
	if (
		!Number.isFinite(input.motion.durationFrames) ||
		input.motion.durationFrames < 1
	) {
		return blocked(
			"Follow-through requires a MotionDocument with a positive duration.",
		);
	}
	if (
		!Number.isFinite(input.leadExitFrame) ||
		!Number.isInteger(input.leadExitFrame) ||
		input.leadExitFrame < 1 ||
		input.leadExitFrame >= input.motion.durationFrames
	) {
		return blocked(
			"Follow-through leadExitFrame must be a whole frame inside the MotionDocument after frame zero.",
		);
	}
	const options = resolveOptions(input);
	if (typeof options === "string") return blocked(options);
	if (input.leadExitFrame < options.velocityWindowFrames) {
		return blocked(
			"Follow-through leadExitFrame must leave the configured velocity window before it.",
		);
	}
	const roles = resolveScreenSpaceRoles(input);
	if (typeof roles === "string") return blocked(roles);
	const activeEndFrameExclusive =
		input.activeEndFrameExclusive ?? input.motion.durationFrames;
	if (
		!Number.isFinite(activeEndFrameExclusive) ||
		!Number.isInteger(activeEndFrameExclusive) ||
		activeEndFrameExclusive < 1 ||
		activeEndFrameExclusive > input.motion.durationFrames
	) {
		return blocked(
			"Follow-through activeEndFrameExclusive must be a whole frame inside the MotionDocument.",
		);
	}
	const finalFollowerSettleEnd =
		input.leadExitFrame +
		options.followerDelayFrames +
		(roles.followers.length - 1) * options.followerStaggerFrames +
		options.settleFrames;
	if (finalFollowerSettleEnd > activeEndFrameExclusive) {
		return blocked(
			"Follow-through active window ends before the final follower can settle; extend the grammar clip or reduce exit, delay, stagger, or settle duration.",
		);
	}
	const leadTrack = readLeadTrack({
		lead: roles.lead,
		motion: input.motion,
		exitFrame: input.leadExitFrame,
		velocityWindowFrames: options.velocityWindowFrames,
	});
	if (typeof leadTrack === "string") return blocked(leadTrack);
	const sampler: GrammarFrameSampler = (frame) => {
		if (!Number.isFinite(frame)) return emptyFrame();
		const samples = new Map<string, GrammarNodeSample>();
		for (const [followerIndex, nodeId] of roles.followers.entries()) {
			const pose = followThroughTranslateAt({
				lead: roles.lead,
				motion: input.motion,
				frame,
				followerIndex,
				leadTrack,
				options,
			});
			samples.set(nodeId, {
				nodeId,
				translate: pose.translate,
				rotate: pose.rotate,
			});
		}
		return { samples, duplicates: [] };
	};
	return {
		status: "ready",
		adapter: {
			cameraSpacePolicy: "screen_2d",
			leadTrack,
			sampler,
		},
	};
}

const asGrammarFrameSample = (
	sample: ReturnType<GrammarFrameSampler>,
): GrammarFrameSample =>
	"samples" in sample ? sample : { samples: sample, duplicates: [] };

/**
 * Adds a ready adapter to an existing grammar sampler without changing either
 * source. Consumers pass the returned sampler as `baseSampler` to
 * `buildExpressionAwareFrameSampler`, then into `sampleMotionPresentationFrame`
 * or the matching export presentation path. The motion presentation layer still
 * owns final transform composition.
 */
export function composeFollowThroughLeadPresentationSampler(input: {
	readonly baseSampler?: GrammarFrameSampler;
	readonly followThroughSampler: GrammarFrameSampler;
}): GrammarFrameSampler {
	return (frame) => {
		const base = input.baseSampler
			? asGrammarFrameSample(input.baseSampler(frame))
			: emptyFrame();
		const followThrough = asGrammarFrameSample(
			input.followThroughSampler(frame),
		);
		const target = {
			samples: new Map(base.samples),
			duplicates: [...base.duplicates],
		};
		mergeFollowThroughLeadFrameSample(target, followThrough);
		return target;
	};
}

/**
 * Field-wise composition for the lead-track adapter. Generic grammar binding
 * order intentionally replaces a whole node sample; V1 is an additive
 * presentation response, so it must retain any independently authored opacity,
 * scale, recipe, duplicate, or rotation channel on the same follower.
 */
export function mergeFollowThroughLeadFrameSample(
	target: {
		readonly samples: Map<string, GrammarNodeSample>;
		readonly duplicates: GrammarDuplicateSample[];
	},
	source: GrammarFrameSample,
): void {
	for (const [nodeId, followThroughSample] of source.samples) {
		const existing = target.samples.get(nodeId);
		const next: GrammarNodeSample = {
			...(existing ?? { nodeId }),
			nodeId,
			...(followThroughSample.translate
				? {
						translate: add(
							existing?.translate ?? { x: 0, y: 0 },
							followThroughSample.translate,
						),
					}
				: {}),
			...(followThroughSample.rotate === undefined
				? {}
				: { rotate: (existing?.rotate ?? 0) + followThroughSample.rotate }),
		};
		target.samples.set(nodeId, next);
	}
	target.duplicates.push(...source.duplicates);
}
