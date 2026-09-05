/**
 * Durable V1 contract for the lead-track Follow-through adapter.
 *
 * This is intentionally not a `MotionExpressionDefinition`: its sampler reads
 * the canonical MotionDocument lead track, while generic expressions receive
 * only a scene-oriented expression environment. The marker still shares the
 * versioned-binding compatibility boundary so legacy `lag-follow-through`
 * bindings retain their original delayed-delta evaluator.
 */

import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument } from "@/entities/scene/model/types";
import { MOTION_EXPRESSION_VERSION_PARAM_KEY } from "./expression-definition";
import { buildFollowThroughLeadPresentationAdapter } from "./follow-through-lead-presentation-adapter";
import type {
	MotionGrammarBinding,
	MotionGrammarParamSpec,
	MotionGrammarTechniqueId,
} from "./types";

export const FOLLOW_THROUGH_LEAD_ADAPTER_VERSION = 1;
export const FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID =
	"lag-follow-through" as const satisfies MotionGrammarTechniqueId;
export const FOLLOW_THROUGH_LEAD_ROLE = "lead";
export const FOLLOW_THROUGH_FOLLOWER_ROLE = "follower";

const roleValue = (roleId: string): string =>
	`${FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID}:${roleId}`;

export const FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS = [
	{
		key: "leadExitFrame",
		label: "Lead exit",
		default: 12,
		min: 1,
		max: 100_000,
		step: 1,
	},
	{
		key: "velocityWindowFrames",
		label: "Velocity window",
		default: 1,
		min: 1,
		max: 24,
		step: 1,
	},
	{
		key: "followerDelayFrames",
		label: "Follower delay",
		default: 6,
		min: 0,
		max: 120,
		step: 1,
	},
	{
		key: "followerStaggerFrames",
		label: "Follower stagger",
		default: 6,
		min: 0,
		max: 120,
		step: 1,
	},
	{
		key: "settleFrames",
		label: "Settle duration",
		default: 30,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "settleDecay",
		label: "Settle decay",
		default: 2,
		min: 0,
		max: 8,
		step: 0.1,
	},
	{
		key: "settleWaves",
		label: "Settle waves",
		default: 2,
		min: 1,
		max: 6,
		step: 1,
	},
	{
		key: "derivedVelocityGain",
		label: "Velocity response",
		default: 0.08,
		min: 0,
		max: 0.5,
		step: 0.01,
	},
] as const satisfies readonly MotionGrammarParamSpec[];

/** The marker is the only durable selector; all other values stay declarative. */
export const followThroughLeadAdapterDefaultParameters = (): Readonly<
	Record<string, number>
> => ({
	...Object.fromEntries(
		FOLLOW_THROUGH_LEAD_ADAPTER_PARAM_SPECS.map((spec) => [
			spec.key,
			spec.default,
		]),
	),
	[MOTION_EXPRESSION_VERSION_PARAM_KEY]: FOLLOW_THROUGH_LEAD_ADAPTER_VERSION,
});

export const isFollowThroughLeadAdapterParameters = (
	techniqueId: string,
	parameters: Readonly<Record<string, unknown>>,
): boolean =>
	techniqueId === FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID &&
	parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY] ===
		FOLLOW_THROUGH_LEAD_ADAPTER_VERSION;

/** Deterministic selection order: the first node is the authored-motion lead. */
export const defaultFollowThroughLeadAdapterRoleMap = (
	targetIds: readonly string[],
): Readonly<Record<string, string>> =>
	Object.fromEntries(
		targetIds.map((nodeId, index) => [
			nodeId,
			index === 0
				? roleValue(FOLLOW_THROUGH_LEAD_ROLE)
				: roleValue(FOLLOW_THROUGH_FOLLOWER_ROLE),
		]),
	);

const roleIdForValue = (value: string): string | undefined => {
	if (
		value === FOLLOW_THROUGH_LEAD_ROLE ||
		value === roleValue(FOLLOW_THROUGH_LEAD_ROLE)
	) {
		return FOLLOW_THROUGH_LEAD_ROLE;
	}
	if (
		value === FOLLOW_THROUGH_FOLLOWER_ROLE ||
		value === roleValue(FOLLOW_THROUGH_FOLLOWER_ROLE)
	) {
		return FOLLOW_THROUGH_FOLLOWER_ROLE;
	}
	return undefined;
};

/**
 * Validates only the direct nodeId-to-role convention. The adapter must never
 * accept a reverse legacy map because it needs a unique lead and every follower
 * to be unambiguous before reading authored motion tracks.
 */
export const validateFollowThroughLeadAdapterRoleMap = (
	targetIds: readonly string[],
	roleMap: Readonly<Record<string, string>>,
): string | undefined => {
	if (new Set(targetIds).size !== targetIds.length) {
		return "Follow-through V1 requires each target id exactly once.";
	}
	if (targetIds.length < 2) {
		return "Follow-through V1 requires one lead and at least one follower.";
	}
	const targetIdSet = new Set(targetIds);
	const extraKey = Object.keys(roleMap).find((key) => !targetIdSet.has(key));
	if (extraKey) {
		return `Follow-through V1 accepts only a direct nodeId-to-role map; "${extraKey}" is not a target id.`;
	}
	if (Object.keys(roleMap).length !== targetIds.length) {
		return "Follow-through V1 requires one direct role value for every target id.";
	}
	const roleIds = targetIds.map((targetId) =>
		roleIdForValue(roleMap[targetId] ?? ""),
	);
	if (roleIds.some((roleId) => roleId === undefined)) {
		return "Follow-through V1 accepts only lead and follower role values.";
	}
	const leadCount = roleIds.filter(
		(roleId) => roleId === FOLLOW_THROUGH_LEAD_ROLE,
	).length;
	const followerCount = roleIds.filter(
		(roleId) => roleId === FOLLOW_THROUGH_FOLLOWER_ROLE,
	).length;
	return leadCount === 1 && followerCount >= 1
		? undefined
		: "Follow-through V1 requires exactly one lead and at least one follower.";
};

export const followThroughLeadAndFollowerIds = (
	targetIds: readonly string[],
	roleMap: Readonly<Record<string, string>> | undefined,
):
	| { readonly leadNodeId: string; readonly followerNodeIds: readonly string[] }
	| undefined => {
	if (!roleMap || validateFollowThroughLeadAdapterRoleMap(targetIds, roleMap)) {
		return undefined;
	}
	const leadNodeId = targetIds.find(
		(nodeId) =>
			roleIdForValue(roleMap[nodeId] ?? "") === FOLLOW_THROUGH_LEAD_ROLE,
	);
	if (!leadNodeId) return undefined;
	return {
		leadNodeId,
		followerNodeIds: targetIds.filter((nodeId) => nodeId !== leadNodeId),
	};
};

export type FollowThroughLeadAdapterBindingPlan =
	| { readonly status: "blocked"; readonly reason: string }
	| { readonly status: "ready"; readonly binding: MotionGrammarBinding };

/**
 * Resolves the same exclusive grammar-clip end used by the V1 runtime. A
 * binding without a grammar clip is allowed to use the document duration;
 * once a clip exists, parameter edits must be feasible within that narrower
 * activation window too.
 */
export const followThroughLeadAdapterActiveEndFrame = (
	motion: MotionDocument,
	bindingId: string,
): number => {
	const clip = motion.clips.find(
		(candidate) =>
			candidate.provenance?.source === "motion-grammar" &&
			candidate.provenance.bindingId === bindingId &&
			Number.isInteger(candidate.startFrame) &&
			Number.isInteger(candidate.durationFrames) &&
			candidate.startFrame >= 0 &&
			candidate.durationFrames > 0,
	);
	return clip
		? Math.min(motion.durationFrames, clip.startFrame + clip.durationFrames)
		: motion.durationFrames;
};

/**
 * Validates the cross-document invariants that a generic grammar command cannot
 * see: canonical lead velocity, screen_2d policy, one local coordinate space,
 * and enough active time for every follower to settle. Callers that write a V1
 * binding (Inspector, Agent, runtime) must invoke this before treating it as
 * executable. It never edits SceneDocument or MotionDocument.
 */
export function validateFollowThroughLeadAdapterBinding({
	scene,
	motion,
	binding,
	activeEndFrameExclusive,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly activeEndFrameExclusive?: number;
}): string | undefined {
	if (
		!isFollowThroughLeadAdapterParameters(
			binding.techniqueId,
			binding.parameters,
		)
	) {
		return "Follow-through lead-track validation requires the recognized V1 marker.";
	}
	const roles = followThroughLeadAndFollowerIds(
		binding.targetIds,
		binding.roleMap,
	);
	if (!roles) return "Follow-through V1 role map is invalid.";
	const adapter = buildFollowThroughLeadPresentationAdapter({
		scene,
		motion,
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
	return adapter.status === "blocked" ? adapter.reason : undefined;
}

const positionKeyFramesForLead = (
	motion: MotionDocument,
	leadNodeId: string,
): readonly number[] =>
	[
		...new Set(
			motion.tracks
				.filter(
					(track) =>
						track.target.nodeId === leadNodeId &&
						(track.target.property === "x" || track.target.property === "y"),
				)
				.flatMap((track) => track.keyframes.map((keyframe) => keyframe.time))
				.filter(
					(frame) =>
						Number.isInteger(frame) &&
						frame > 0 &&
						frame < motion.durationFrames,
				),
		),
	].sort((left, right) => right - left);

/**
 * Plans a valid V1 binding before a grammar command writes it. The first selected
 * node is the lead. With no explicit exit parameter, the latest keyed X/Y frame
 * that produces a non-zero canonical velocity is adopted; no synthetic track,
 * scene camera, or fallback trajectory is created.
 */
export function planFollowThroughLeadAdapterBinding({
	scene,
	motion,
	bindingId,
	targetIds,
	parameters = {},
	roleMap,
	explicitLeadExitFrame,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindingId: string;
	readonly targetIds: readonly string[];
	readonly parameters?: Readonly<Record<string, number>>;
	readonly roleMap?: Readonly<Record<string, string>>;
	/** Presence means caller chose the exact absolute MotionDocument frame. */
	readonly explicitLeadExitFrame?: number;
}): FollowThroughLeadAdapterBindingPlan {
	const resolvedRoleMap =
		roleMap ?? defaultFollowThroughLeadAdapterRoleMap(targetIds);
	const roleIssue = validateFollowThroughLeadAdapterRoleMap(
		targetIds,
		resolvedRoleMap,
	);
	if (roleIssue) return { status: "blocked", reason: roleIssue };
	const resolvedRoles = followThroughLeadAndFollowerIds(
		targetIds,
		resolvedRoleMap,
	);
	if (!resolvedRoles) {
		return {
			status: "blocked",
			reason:
				"Follow-through V1 requires one resolved lead and at least one resolved follower.",
		};
	}
	const leadNodeId = resolvedRoles.leadNodeId;
	const candidates =
		explicitLeadExitFrame === undefined
			? positionKeyFramesForLead(motion, leadNodeId)
			: [explicitLeadExitFrame];
	// Let the adapter return its more specific scene/policy error when the lead
	// has no usable position keyframes instead of manufacturing a trajectory.
	const candidateFrames = candidates.length > 0 ? candidates : [12];
	let lastReason =
		"Follow-through V1 requires a non-zero X/Y lead velocity at an authored whole-frame exit.";
	for (const leadExitFrame of candidateFrames) {
		const binding: MotionGrammarBinding = {
			id: bindingId,
			techniqueId: FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID,
			targetIds: [...targetIds],
			parameters: {
				...followThroughLeadAdapterDefaultParameters(),
				...parameters,
				[MOTION_EXPRESSION_VERSION_PARAM_KEY]:
					FOLLOW_THROUGH_LEAD_ADAPTER_VERSION,
				leadExitFrame,
			},
			roleMap: { ...resolvedRoleMap },
			effectBinding: { kind: "none" },
		};
		const issue = validateFollowThroughLeadAdapterBinding({
			scene,
			motion,
			binding,
			activeEndFrameExclusive: motion.durationFrames,
		});
		if (!issue) return { status: "ready", binding };
		lastReason = issue;
		if (explicitLeadExitFrame !== undefined) break;
	}
	return { status: "blocked", reason: lastReason };
}
