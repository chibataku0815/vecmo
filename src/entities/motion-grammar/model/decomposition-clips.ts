import {
	type AnimationClipTrackAssignmentRejectionReason,
	validateAnimationClipTrackAssignment,
} from "@/entities/motion/model/clips";
import type { MotionCommand } from "@/entities/motion/model/command";
import {
	type CreateAnimationClipInput,
	createAnimationClip,
} from "@/entities/motion/model/commands";
import type {
	AnimationClipProvenance,
	MotionDocument,
} from "@/entities/motion/model/types";
import type {
	MotionGrammarClipPlan,
	MotionGrammarDecompositionOutput,
	MotionGrammarDecompositionPlan,
} from "./decomposition";

/** Map from deterministic decomposition id seeds to ids emitted by materializers. */
export type MotionGrammarDecompositionIdMap =
	| Readonly<Record<string, string>>
	| ReadonlyMap<string, string>;

export type MotionGrammarClipWriteIssueCode =
	| "duplicate-clip-id"
	| "unresolved-track-id-seed"
	| "unresolved-generated-node-id-seed"
	| "invalid-track-assignment"
	| "empty-clip";

export type MotionGrammarClipWriteIssueSeverity = "warning" | "error";

/** Diagnostic emitted while turning planned grammar clips into motion commands. */
export type MotionGrammarClipWriteIssue = {
	readonly code: MotionGrammarClipWriteIssueCode;
	readonly severity: MotionGrammarClipWriteIssueSeverity;
	readonly clipIdSeed: string;
	readonly message: string;
	readonly seed?: string;
	readonly resolvedId?: string;
	readonly trackAssignmentReason?: AnimationClipTrackAssignmentRejectionReason;
};

/**
 * Inputs for resolving deterministic clip-plan seeds into concrete motion ids.
 * Passing `motion` enables duplicate and track-assignment diagnostics, but the
 * writer can still emit commands before scalar tracks have been applied.
 */
export type CreateMotionGrammarClipWritePlanInput = {
	readonly plan: MotionGrammarDecompositionPlan;
	readonly motion?: Pick<MotionDocument, "tracks" | "clips" | "durationFrames">;
	readonly clipIdsBySeed?: MotionGrammarDecompositionIdMap;
	readonly trackIdsBySeed?: MotionGrammarDecompositionIdMap;
	readonly generatedNodeIdsBySeed?: MotionGrammarDecompositionIdMap;
};

/** Ordinary animation-clip inputs plus non-blocking diagnostics for the bake UI. */
export type MotionGrammarClipWritePlan = {
	readonly clips: readonly CreateAnimationClipInput[];
	readonly issues: readonly MotionGrammarClipWriteIssue[];
};

const isReadonlyMap = (
	value: MotionGrammarDecompositionIdMap,
): value is ReadonlyMap<string, string> =>
	typeof (value as ReadonlyMap<string, string>).get === "function";

const idFromMap = (
	map: MotionGrammarDecompositionIdMap | undefined,
	seed: string,
): string | undefined => {
	if (!map) return undefined;
	if (isReadonlyMap(map)) return map.get(seed);
	return map[seed];
};

const resolveIdSeed = (
	seed: string,
	map: MotionGrammarDecompositionIdMap | undefined,
): string => idFromMap(map, seed) ?? seed;

const clipOutputsFromPlan = (
	plan: MotionGrammarDecompositionPlan,
): readonly MotionGrammarClipPlan[] =>
	plan.outputs.filter(isMotionGrammarClipPlan);

const addUnresolvedSeedIssue = (
	issues: MotionGrammarClipWriteIssue[],
	clip: MotionGrammarClipPlan,
	code: Extract<
		MotionGrammarClipWriteIssueCode,
		"unresolved-track-id-seed" | "unresolved-generated-node-id-seed"
	>,
	seed: string,
): void => {
	issues.push({
		code,
		severity: "warning",
		clipIdSeed: clip.idSeed,
		seed,
		message: `No emitted id was provided for decomposition seed "${seed}"; using the seed as the persisted id.`,
	});
};

const resolveTrackIds = (
	clip: MotionGrammarClipPlan,
	trackIdsBySeed: MotionGrammarDecompositionIdMap | undefined,
	issues: MotionGrammarClipWriteIssue[],
): readonly string[] =>
	clip.trackIdSeeds.map((seed) => {
		const mapped = idFromMap(trackIdsBySeed, seed);
		if (!mapped && trackIdsBySeed) {
			addUnresolvedSeedIssue(issues, clip, "unresolved-track-id-seed", seed);
		}
		return mapped ?? seed;
	});

const resolveGeneratedNodeIds = (
	clip: MotionGrammarClipPlan,
	generatedNodeIdsBySeed: MotionGrammarDecompositionIdMap | undefined,
	issues: MotionGrammarClipWriteIssue[],
): readonly string[] =>
	clip.generatedNodeIdSeeds.map((seed) => {
		const mapped = idFromMap(generatedNodeIdsBySeed, seed);
		if (!mapped && generatedNodeIdsBySeed) {
			addUnresolvedSeedIssue(
				issues,
				clip,
				"unresolved-generated-node-id-seed",
				seed,
			);
		}
		return mapped ?? seed;
	});

const validateResolvedTrackIds = (
	clip: MotionGrammarClipPlan,
	clipId: string,
	trackIds: readonly string[],
	motion:
		| Pick<MotionDocument, "tracks" | "clips" | "durationFrames">
		| undefined,
	issues: MotionGrammarClipWriteIssue[],
): readonly string[] => {
	if (!motion) return trackIds;
	const validation = validateAnimationClipTrackAssignment(motion, trackIds, {
		clipId,
		range: {
			startFrame: clip.frameRange.startFrame,
			durationFrames: clip.frameRange.durationFrames,
		},
	});
	for (const rejection of validation.rejected) {
		issues.push({
			code: "invalid-track-assignment",
			severity: "warning",
			clipIdSeed: clip.idSeed,
			resolvedId: rejection.trackId,
			trackAssignmentReason: rejection.reason,
			message: `Resolved track "${rejection.trackId}" will not be assigned to "${clip.name}" because ${rejection.reason}.`,
		});
	}
	const existingTrackIds = new Set(validation.trackIds);
	const missingTrackIds = new Set(
		validation.rejected
			.filter((rejection) => rejection.reason === "missing-track")
			.map((rejection) => rejection.trackId),
	);
	return trackIds.filter(
		(trackId, index) =>
			trackIds.indexOf(trackId) === index &&
			(existingTrackIds.has(trackId) || missingTrackIds.has(trackId)),
	);
};

/**
 * Narrows shared decomposition outputs to clip plans without duplicating the IR.
 * Writers use this guard when they only own timeline grouping behavior.
 */
export function isMotionGrammarClipPlan(
	output: MotionGrammarDecompositionOutput,
): output is MotionGrammarClipPlan {
	return output.kind === "clip";
}

/**
 * Converts a decomposition clip plan into persisted clip provenance. The result
 * intentionally keeps only labels and ids; it does not retain grammar parameters
 * or sampling data, so baked clips stay ordinary `MotionDocument` artifacts.
 */
export function createMotionGrammarClipProvenance(
	clip: MotionGrammarClipPlan,
	generatedNodeIds: readonly string[],
	generatedNodeIdsBySeed?: MotionGrammarDecompositionIdMap,
): AnimationClipProvenance {
	return {
		source: "motion-grammar",
		label: `Expanded from ${clip.provenance.techniqueLabel}`,
		bindingId: clip.provenance.bindingId,
		techniqueId: clip.provenance.techniqueId,
		techniqueLabel: clip.provenance.techniqueLabel,
		targetIds: [...clip.provenance.targetIds],
		generatedNodeIds: [...generatedNodeIds],
		...(clip.editableArtifacts.length > 0
			? {
					editableArtifacts: clip.editableArtifacts.map((artifact) => ({
						id: artifact.idSeed,
						kind: artifact.artifactKind,
						targetIds: artifact.targetIds.map((targetId) =>
							resolveIdSeed(targetId, generatedNodeIdsBySeed),
						),
						channels: [...artifact.channels],
						description: artifact.description,
					})),
				}
			: {}),
	};
}

/**
 * Builds ordinary `createAnimationClip` inputs from `clip` outputs in the shared
 * decomposition IR. Scalar and scene-node emitters can remap deterministic seeds
 * to concrete ids; absent maps fall back to seed ids so deterministic emitters do
 * not need an extra registry.
 */
export function createMotionGrammarClipWritePlan({
	plan,
	motion,
	clipIdsBySeed,
	trackIdsBySeed,
	generatedNodeIdsBySeed,
}: CreateMotionGrammarClipWritePlanInput): MotionGrammarClipWritePlan {
	const clips: CreateAnimationClipInput[] = [];
	const issues: MotionGrammarClipWriteIssue[] = [];
	const seenClipIds = new Set(motion?.clips.map((clip) => clip.id) ?? []);
	for (const clip of clipOutputsFromPlan(plan)) {
		const clipId = resolveIdSeed(clip.idSeed, clipIdsBySeed);
		if (seenClipIds.has(clipId)) {
			issues.push({
				code: "duplicate-clip-id",
				severity: "warning",
				clipIdSeed: clip.idSeed,
				resolvedId: clipId,
				message: `Clip "${clipId}" already exists; no duplicate clip command will be emitted.`,
			});
			continue;
		}
		seenClipIds.add(clipId);
		const generatedNodeIds = resolveGeneratedNodeIds(
			clip,
			generatedNodeIdsBySeed,
			issues,
		);
		const resolvedTrackIds = resolveTrackIds(clip, trackIdsBySeed, issues);
		const trackIds = validateResolvedTrackIds(
			clip,
			clipId,
			resolvedTrackIds,
			motion,
			issues,
		);
		if (trackIds.length === 0 && generatedNodeIds.length === 0) {
			issues.push({
				code: "empty-clip",
				severity: "warning",
				clipIdSeed: clip.idSeed,
				resolvedId: clipId,
				message: `Clip "${clip.name}" has no resolved tracks or generated nodes.`,
			});
		}
		clips.push({
			id: clipId,
			name: clip.name,
			startFrame: clip.frameRange.startFrame,
			durationFrames: clip.frameRange.durationFrames,
			trackIds,
			provenance: createMotionGrammarClipProvenance(
				clip,
				generatedNodeIds,
				generatedNodeIdsBySeed,
			),
		});
	}
	return { clips, issues };
}

/**
 * Emits motion commands for the resolved clip write plan. Callers that combine
 * scalar-track, scene-node, and clip writes should run the returned commands in a
 * single bake transaction so undo/redo treats expansion as one user action.
 */
export function createMotionGrammarClipCommands(
	input: CreateMotionGrammarClipWritePlanInput,
): readonly MotionCommand[] {
	return createMotionGrammarClipWritePlan(input).clips.map((clip) =>
		createAnimationClip(clip),
	);
}
