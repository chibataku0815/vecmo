import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import { buildExpressionAwareFrameSampler } from "@/entities/scene/model/expression-presentation";
import { materializeLayoutFramesForPresentation } from "@/entities/scene/model/layout-frame-presentation";
import {
	findNode,
	findRenderableNodeEntry,
	isTopLevelSceneNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import {
	glammerTimeDelayAuthoringTiming,
	glammerTimeDelayInstanceDescriptors,
	isGlammerTimeDelayAuthoringProfileBinding,
} from "./time-delay-materialization";
import {
	type TimeDelayReferenceInput,
	timeDelayReferenceCriticalFrames,
	usesCurrentTimeDelayProfileMasterLaw,
} from "./time-delay-reference-oracle";
import type { MotionGrammarBinding } from "./types";

export const TIME_DELAY_CANDIDATE_SURFACE =
	"shared-presentation-structural" as const;

export type TimeDelayCandidateRoleMapping = {
	readonly sourceTargetId: string;
	readonly candidateBodyRole: string;
	readonly candidateSatelliteRole: string;
};

/**
 * Read-only input for extracting the existing Time Delay profile from shared
 * presentation primitives. candidateFrameOffset is only an assertion of the
 * bound clip start; it never supplies an arbitrary timing shift.
 */
export type TimeDelayPresentationCandidateInput = {
	readonly source: TimeDelayReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly roleMappings: readonly TimeDelayCandidateRoleMapping[];
	readonly candidateFrameOffset?: number;
	readonly artboardId?: string | null;
};

export type TimeDelayPresentationCandidateSample = {
	readonly targetId: string;
	readonly candidateFrame: number;
	readonly body: {
		readonly role: string;
		readonly nodeId: string;
		/** Profile transform position, not a geometry or pixel centroid. */
		readonly profilePositionX: number;
		readonly profilePositionY: number;
		readonly scaleY: number;
		readonly opacity: number;
	};
	readonly satellite: {
		readonly role: string;
		readonly nodeId: string;
		/** Active is an opacity-channel state, not a pixel-visibility verdict. */
		readonly state: "suppressed" | "active";
		/** Profile transform position, not a geometry or pixel centroid. */
		readonly profilePositionX: number;
		readonly profilePositionY: number;
		readonly scaleX: number;
		readonly scaleY: number;
		readonly opacity: number;
	};
};

export type TimeDelayCandidateResult =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly surface: typeof TIME_DELAY_CANDIDATE_SURFACE;
			readonly artboardId: string;
			readonly clipStartFrame: number;
			readonly samples: readonly TimeDelayPresentationCandidateSample[];
	  };

type CandidateRoleResolution = {
	readonly sourceTargetId: string;
	readonly bodyRole: string;
	readonly bodyNodeId: string;
	readonly satelliteRole: string;
	readonly satelliteNodeId: string;
};

type CandidateClip = {
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly endFrameExclusive: number;
};

type CandidateResolution = {
	readonly roles: readonly CandidateRoleResolution[];
	readonly artboardId: string;
	readonly clip: CandidateClip;
};

const blocked = (reason: string): TimeDelayCandidateResult => ({
	status: "blocked",
	reason,
});

const positiveModulo = (value: number, modulo: number): number =>
	((value % modulo) + modulo) % modulo;

const finiteParameter = (
	parameters: Readonly<Record<string, number>>,
	key: string,
	fallback: number,
): number => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const resolveCandidateClip = (
	input: TimeDelayPresentationCandidateInput,
): CandidateClip | string => {
	const clips = input.motion.clips.filter(
		(clip) => clip.provenance?.bindingId === input.binding.id,
	);
	if (clips.length !== 1) {
		return "Time Delay comparison requires exactly one profile clip for the sampled binding.";
	}
	const clip = clips[0];
	if (
		!clip ||
		!Number.isFinite(clip.startFrame) ||
		!Number.isFinite(clip.durationFrames) ||
		clip.startFrame < 0 ||
		clip.durationFrames <= 0
	) {
		return "Time Delay comparison clip timing must be finite, non-negative, and positive in duration.";
	}
	const endFrameExclusive = clip.startFrame + clip.durationFrames;
	if (
		!Number.isFinite(input.motion.durationFrames) ||
		input.motion.durationFrames <= 0 ||
		endFrameExclusive > input.motion.durationFrames
	) {
		return "Time Delay comparison clip must fit inside the supplied motion duration.";
	}
	if (!Object.is(clip.durationFrames, input.source.periodFrames)) {
		return "Time Delay comparison clip duration must equal the source period.";
	}
	if (
		input.candidateFrameOffset !== undefined &&
		(!Number.isFinite(input.candidateFrameOffset) ||
			!Object.is(input.candidateFrameOffset, clip.startFrame))
	) {
		return "Time Delay candidate frame offset must exactly equal the profile clip start.";
	}
	return {
		startFrame: clip.startFrame,
		durationFrames: clip.durationFrames,
		endFrameExclusive,
	};
};

const resolveRoles = (
	input: TimeDelayPresentationCandidateInput,
): readonly CandidateRoleResolution[] | string => {
	if (!isGlammerTimeDelayAuthoringProfileBinding(input.binding)) {
		return "Candidate binding is not a typed Glammer Time Delay authoring profile.";
	}
	if (input.source.targets.length !== 5) {
		return "The current Time Delay profile proves exactly five source targets.";
	}
	if (input.roleMappings.length !== input.source.targets.length) {
		return "Time Delay candidate mappings must cover every source target exactly once.";
	}
	const descriptors = glammerTimeDelayInstanceDescriptors(input.binding);
	if (descriptors.length !== input.source.targets.length) {
		return "Time Delay candidate instance count does not match the source target count.";
	}
	const sourceTargets = new Map(
		input.source.targets.map((target) => [target.targetId, target] as const),
	);
	const descriptorByBodyRole = new Map(
		descriptors.map((descriptor) => [descriptor.bodyRole, descriptor] as const),
	);
	const mappedSourceTargetIds = new Set<string>();
	const mappedBodyRoles = new Set<string>();
	const mappedSatelliteRoles = new Set<string>();
	const resolutions: CandidateRoleResolution[] = [];
	for (const mapping of input.roleMappings) {
		const sourceTarget = sourceTargets.get(mapping.sourceTargetId);
		const descriptor = descriptorByBodyRole.get(mapping.candidateBodyRole);
		if (!sourceTarget || !descriptor?.satelliteNodeId) {
			return "Time Delay candidate mappings must point to a source target and paired body/satellite instance.";
		}
		if (descriptor.satelliteRole !== mapping.candidateSatelliteRole) {
			return "Time Delay candidate satellite role does not match the profile instance.";
		}
		if (
			mappedSourceTargetIds.has(mapping.sourceTargetId) ||
			mappedBodyRoles.has(mapping.candidateBodyRole) ||
			mappedSatelliteRoles.has(mapping.candidateSatelliteRole)
		) {
			return "Time Delay candidate role mappings must be one-to-one.";
		}
		if (!Object.is(sourceTarget.delayFrames, descriptor.delayFrames)) {
			return "Time Delay source delay does not match the candidate instance delay.";
		}
		mappedSourceTargetIds.add(mapping.sourceTargetId);
		mappedBodyRoles.add(mapping.candidateBodyRole);
		mappedSatelliteRoles.add(mapping.candidateSatelliteRole);
		resolutions.push({
			sourceTargetId: mapping.sourceTargetId,
			bodyRole: descriptor.bodyRole,
			bodyNodeId: descriptor.bodyNodeId,
			satelliteRole: descriptor.satelliteRole,
			satelliteNodeId: descriptor.satelliteNodeId,
		});
	}
	if (
		mappedSourceTargetIds.size !== sourceTargets.size ||
		mappedBodyRoles.size !== descriptors.length
	) {
		return "Time Delay candidate mappings leave at least one source target or profile instance unresolved.";
	}
	return resolutions;
};

const resolveRoleArtboard = (
	input: TimeDelayPresentationCandidateInput,
	roles: readonly CandidateRoleResolution[],
): string | null => {
	let artboardId: string | undefined;
	for (const role of roles) {
		for (const nodeId of [role.bodyNodeId, role.satelliteNodeId]) {
			const node = findNode(input.scene, nodeId);
			if (!node) return null;
			if (!isTopLevelSceneNode(input.scene, nodeId)) return null;
			if (!findRenderableNodeEntry(input.scene, nodeId)) return null;
			if (
				node.motionParent ||
				node.transformConstraint ||
				node.propertyRelations?.length ||
				node.depthPlane
			) {
				return null;
			}
			const nodeArtboardId = selectArtboardIdForNode(input.scene, nodeId);
			if (!nodeArtboardId) return null;
			if (artboardId && artboardId !== nodeArtboardId) return null;
			artboardId = nodeArtboardId;
		}
	}
	return artboardId ?? null;
};

const unrelatedBindingTouchesRole = (
	binding: MotionGrammarBinding,
	roleNodeIds: ReadonlySet<string>,
): boolean =>
	binding.targetIds.some((nodeId) => roleNodeIds.has(nodeId)) ||
	Object.keys(binding.roleMap ?? {}).some((nodeId) => roleNodeIds.has(nodeId));

const resolveCandidate = (
	input: TimeDelayPresentationCandidateInput,
): CandidateResolution | string => {
	const sourceCriticalFrames = timeDelayReferenceCriticalFrames(input.source);
	if (sourceCriticalFrames.status === "blocked")
		return sourceCriticalFrames.reason;
	if (!usesCurrentTimeDelayProfileMasterLaw(input.source)) {
		return "The current Time Delay profile accepts only its fixed default master law.";
	}
	const timing = glammerTimeDelayAuthoringTiming(input.binding);
	if (!timing) {
		return "Candidate binding has no readable Time Delay timing contract.";
	}
	if (!Object.is(timing.periodFrames, input.source.periodFrames)) {
		return "Time Delay source period does not match the candidate profile period.";
	}
	const matchingBindings = input.bindings.filter(
		(binding) => binding.id === input.binding.id,
	);
	if (matchingBindings.length !== 1 || matchingBindings[0] !== input.binding) {
		return "Candidate binding must appear exactly once and be the binding sampled by shared grammar presentation.";
	}
	const clip = resolveCandidateClip(input);
	if (typeof clip === "string") return clip;
	const roles = resolveRoles(input);
	if (typeof roles === "string") return roles;
	const artboardId = resolveRoleArtboard(input, roles);
	if (!artboardId) {
		return "Time Delay comparison requires renderable, top-level, same-artboard roles with no transform relation or depth plane.";
	}
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== artboardId
	) {
		return "Time Delay comparison artboard must match every mapped role.";
	}
	const roleNodeIds = new Set(
		roles.flatMap((role) => [role.bodyNodeId, role.satelliteNodeId]),
	);
	if (
		input.bindings.some(
			(binding) =>
				binding.id !== input.binding.id &&
				unrelatedBindingTouchesRole(binding, roleNodeIds),
		)
	) {
		return "Another motion-grammar binding also targets a Time Delay comparison role.";
	}
	if (
		input.motion.tracks.some((track) => roleNodeIds.has(track.target.nodeId))
	) {
		return "Keyframe tracks on a Time Delay comparison role would contaminate structural sampling.";
	}
	if (
		input.motion.positionPaths?.some((path) => roleNodeIds.has(path.nodeId))
	) {
		return "Spatial position paths on a Time Delay comparison role would contaminate structural sampling.";
	}
	if (
		input.scene.nativeExpressionBindings?.some((binding) =>
			roleNodeIds.has(binding.nodeId),
		)
	) {
		return "Native expression bindings on a Time Delay comparison role would contaminate structural sampling.";
	}
	return { roles, artboardId, clip };
};

/**
 * Samples the existing profile through the layout and expression composition
 * used by Canvas and export. The output is a carrier-agnostic structural
 * channel read, never a rendered-pixel or visual-acceptance verdict.
 */
export function sampleTimeDelayPresentationCandidate(
	input: TimeDelayPresentationCandidateInput,
	sourceFrame: number,
): TimeDelayCandidateResult {
	if (!Number.isFinite(sourceFrame)) {
		return blocked("Time Delay source comparison frame must be finite.");
	}
	const resolved = resolveCandidate(input);
	if (typeof resolved === "string") return blocked(resolved);
	const localFrame = positiveModulo(sourceFrame, input.source.periodFrames);
	const frame = resolved.clip.startFrame + localFrame;
	if (
		frame < resolved.clip.startFrame ||
		frame >= resolved.clip.endFrameExclusive ||
		frame > input.motion.durationFrames
	) {
		return blocked(
			"Time Delay candidate frame lies outside the resolved profile clip.",
		);
	}
	const layoutScene = materializeLayoutFramesForPresentation(input.scene);
	const grammar = buildExpressionAwareFrameSampler({
		scene: layoutScene,
		fps: input.motion.fps,
		baseSampler: buildMotionGrammarFrameSampler({
			bindings: input.bindings,
			scene: layoutScene,
			motion: input.motion,
		}),
	});
	if (!grammar) {
		return blocked(
			"Time Delay candidate has no shared grammar presentation sampler.",
		);
	}
	const presentation = sampleMotionPresentationFrame({
		scene: input.scene,
		motion: input.motion,
		frame,
		artboardId: resolved.artboardId,
		grammar,
	});
	const valuesByNodeId = new Map(
		presentation.values.map((value) => [value.nodeId, value] as const),
	);
	const origin = {
		x: finiteParameter(input.binding.parameters, "referenceOriginX", 0),
		y: finiteParameter(input.binding.parameters, "referenceOriginY", 0),
	};
	const samples: TimeDelayPresentationCandidateSample[] = [];
	for (const role of resolved.roles) {
		const body = valuesByNodeId.get(role.bodyNodeId);
		const satellite = valuesByNodeId.get(role.satelliteNodeId);
		if (!body || !satellite) {
			return blocked(
				"Time Delay shared presentation omitted a mapped body or satellite node.",
			);
		}
		if (
			!Number.isFinite(body.transform.position.x) ||
			!Number.isFinite(body.transform.position.y) ||
			!Number.isFinite(body.transform.scale.y) ||
			!Number.isFinite(body.opacity) ||
			!Number.isFinite(satellite.transform.position.x) ||
			!Number.isFinite(satellite.transform.position.y) ||
			!Number.isFinite(satellite.transform.scale.x) ||
			!Number.isFinite(satellite.transform.scale.y) ||
			!Number.isFinite(satellite.opacity)
		) {
			return blocked(
				"Time Delay shared presentation emitted a non-finite channel.",
			);
		}
		samples.push({
			targetId: role.sourceTargetId,
			candidateFrame: frame,
			body: {
				role: role.bodyRole,
				nodeId: role.bodyNodeId,
				profilePositionX: body.transform.position.x - origin.x,
				profilePositionY: body.transform.position.y - origin.y,
				scaleY: body.transform.scale.y,
				opacity: body.opacity,
			},
			satellite: {
				role: role.satelliteRole,
				nodeId: role.satelliteNodeId,
				state: satellite.opacity > 0 ? "active" : "suppressed",
				profilePositionX: satellite.transform.position.x - origin.x,
				profilePositionY: satellite.transform.position.y - origin.y,
				scaleX: satellite.transform.scale.x,
				scaleY: satellite.transform.scale.y,
				opacity: satellite.opacity,
			},
		});
	}
	return {
		status: "ready",
		surface: TIME_DELAY_CANDIDATE_SURFACE,
		artboardId: resolved.artboardId,
		clipStartFrame: resolved.clip.startFrame,
		samples,
	};
}
