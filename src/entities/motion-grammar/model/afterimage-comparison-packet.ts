import type {
	GrammarFrameSample,
	GrammarFrameSampler,
} from "@/entities/motion/model/grammar-bridge";
import { sampleMotionPresentationFrame } from "@/entities/motion/model/presentation";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	type AfterimageReferenceInput,
	type AfterimageReferenceSample,
	afterimageReferenceCriticalFrames,
	sampleAfterimageReference,
} from "./afterimage-reference-oracle";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import type { MotionGrammarBinding } from "./types";

export const AFTERIMAGE_CANDIDATE_SURFACE =
	"grammar-duplicate-history-gate" as const;

type SurfaceId =
	| "canvas"
	| "svg"
	| "pdf"
	| "javascript-code-runtime"
	| "webgl"
	| "bake";

export type AfterimageSurfaceObservation = {
	readonly surface: SurfaceId;
	readonly status: "not-evaluated" | "unsupported";
	readonly reason: string;
};

export type AfterimageCandidateInput = {
	readonly source: AfterimageReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly bindings: readonly MotionGrammarBinding[];
	readonly binding: MotionGrammarBinding;
	readonly selectedSourceNodeIds: readonly string[];
	readonly artboardId?: string | null;
};

export type AfterimageComparisonFrame = {
	readonly id: string;
	readonly purpose: string;
	readonly sourceFrame: number;
	readonly reference: AfterimageReferenceSample;
	readonly candidateDuplicates: readonly {
		readonly sourceNodeId: string;
		readonly duplicateNodeId: string;
		readonly sourceFrame: number;
		readonly opacityFactor: number;
	}[];
	readonly masterPoseComparisons: readonly {
		readonly sourceNodeId: string;
		readonly sourceFrame: number;
		readonly candidatePose: {
			readonly x: number;
			readonly y: number;
			readonly rotation: number;
			readonly scaleX: number;
			readonly scaleY: number;
		} | null;
		readonly referencePosePresent: boolean;
		readonly matches: boolean;
	}[];
};

export type AfterimageComparisonPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly candidateSurface: typeof AFTERIMAGE_CANDIDATE_SURFACE;
			readonly frames: readonly AfterimageComparisonFrame[];
			readonly surfaces: readonly AfterimageSurfaceObservation[];
	  }
	| {
			readonly status: "incompatible";
			readonly candidateSurface: typeof AFTERIMAGE_CANDIDATE_SURFACE;
			readonly frames: readonly AfterimageComparisonFrame[];
			readonly gaps: readonly string[];
			readonly surfaces: readonly AfterimageSurfaceObservation[];
	  };

const blocked = (reason: string): AfterimageComparisonPacket => ({
	status: "blocked",
	reason,
});

const surfaces = (): readonly AfterimageSurfaceObservation[] => [
	...(
		["canvas", "svg", "pdf", "javascript-code-runtime", "webgl"] as const
	).map((surface) => ({
		surface,
		status: "not-evaluated" as const,
		reason: "History artifact packet has not evaluated this output surface.",
	})),
	{
		surface: "bake",
		status: "not-evaluated",
		reason: "Explicit source-to-copy bake parity remains unproved.",
	},
];

const asGrammarFrameSample = (
	sample: ReturnType<GrammarFrameSampler>,
): GrammarFrameSample =>
	"samples" in sample ? sample : { samples: sample, duplicates: [] };

const finiteParameter = (
	parameters: Readonly<Record<string, number>>,
	key: string,
	defaultValue: number,
): number => {
	const value = parameters[key];
	return Number.isFinite(value) ? value : defaultValue;
};

const effectiveAfterimageParameters = (binding: MotionGrammarBinding) => {
	const echo =
		binding.effectBinding?.kind === "temporal-echo"
			? binding.effectBinding
			: undefined;
	return {
		copies: Math.max(
			0,
			Math.floor(
				echo?.copies ?? finiteParameter(binding.parameters, "copies", 0),
			),
		),
		delayFrames: Math.max(
			0,
			echo?.delayFrames ??
				finiteParameter(binding.parameters, "delayFrames", 0),
		),
		decay: Math.min(
			1,
			Math.max(
				0,
				echo?.decay ?? finiteParameter(binding.parameters, "decay", 1),
			),
		),
		periodFrames: finiteParameter(binding.parameters, "periodFrames", 0),
	};
};

const selectedSourceParametersMatch = (
	input: AfterimageCandidateInput,
): boolean => {
	const parameters = effectiveAfterimageParameters(input.binding);
	return (
		parameters.copies === Math.floor(input.source.copies) &&
		parameters.delayFrames === input.source.delayFrames &&
		parameters.decay === input.source.fadePerCopy &&
		parameters.periodFrames === input.source.periodFrames
	);
};

const duplicateCopyIndex = (duplicateNodeId: string): number | null => {
	const match = /:(?:echo|master-rotation-echo):(\d+)$/u.exec(duplicateNodeId);
	if (!match) return null;
	const copyIndex = Number(match[1]);
	return Number.isInteger(copyIndex) && copyIndex > 0 ? copyIndex : null;
};

const duplicateHistoryMatchesReference = (
	frame: AfterimageComparisonFrame,
): boolean => {
	const candidateByKey = new Map<
		string,
		AfterimageComparisonFrame["candidateDuplicates"][number]
	>();
	for (const duplicate of frame.candidateDuplicates) {
		const copyIndex = duplicateCopyIndex(duplicate.duplicateNodeId);
		if (copyIndex === null) return false;
		const key = `${duplicate.sourceNodeId}:${copyIndex}`;
		if (candidateByKey.has(key)) return false;
		candidateByKey.set(key, duplicate);
	}
	const expectedKeys = new Set<string>();
	for (const echo of frame.reference.echoes) {
		const key = `${echo.sourceId}:${echo.copyIndex}`;
		expectedKeys.add(key);
		const candidate = candidateByKey.get(key);
		if (echo.lifecycle === "absent") {
			if (candidate) return false;
			continue;
		}
		if (
			!candidate ||
			candidate.sourceFrame !== echo.sourceFrame ||
			candidate.opacityFactor !== echo.opacity
		) {
			return false;
		}
	}
	return (
		candidateByKey.size === expectedKeys.size &&
		[...candidateByKey.keys()].every((key) => expectedKeys.has(key))
	);
};

const masterPoseComparisonsMatch = (
	frames: readonly AfterimageComparisonFrame[],
): boolean => {
	let expectedPoseCount = 0;
	let comparisonCount = 0;
	for (const frame of frames) {
		expectedPoseCount += frame.reference.echoes.filter(
			(echo) => echo.pose !== null && echo.sourceFrame !== null,
		).length;
		comparisonCount += frame.masterPoseComparisons.length;
		if (frame.masterPoseComparisons.some((comparison) => !comparison.matches)) {
			return false;
		}
	}
	return expectedPoseCount > 0 && comparisonCount === expectedPoseCount;
};

/**
 * Pairs the independent pose-history law with the existing presentation-only
 * duplicate bridge. It does not write selected sources or claim surface parity.
 */
export function buildAfterimageComparisonPacket(
	input: AfterimageCandidateInput,
): AfterimageComparisonPacket {
	if (input.bindings.length !== 1 || input.bindings[0] !== input.binding) {
		return blocked(
			"Afterimage comparison requires exactly one binding object matching input.binding.",
		);
	}
	if (input.binding.techniqueId !== "periodic-afterimage") {
		return blocked(
			"Afterimage comparison requires the periodic-afterimage binding.",
		);
	}
	if (
		input.selectedSourceNodeIds.length === 0 ||
		new Set(input.selectedSourceNodeIds).size !==
			input.selectedSourceNodeIds.length ||
		input.selectedSourceNodeIds.length !== input.binding.targetIds.length ||
		input.selectedSourceNodeIds.some(
			(nodeId, index) => input.binding.targetIds[index] !== nodeId,
		)
	) {
		return blocked(
			"Afterimage selected sources must exactly match the ordered binding target set.",
		);
	}
	if (
		input.source.sourceIds.length !== input.selectedSourceNodeIds.length ||
		input.source.sourceIds.some(
			(sourceId, index) => input.selectedSourceNodeIds[index] !== sourceId,
		)
	) {
		return blocked(
			"Afterimage reference source ids must exactly match the ordered selected-source set.",
		);
	}
	const sourceArtboards = new Set(
		input.selectedSourceNodeIds.map((nodeId) => {
			if (!findNode(input.scene, nodeId)) return null;
			return selectArtboardIdForNode(input.scene, nodeId);
		}),
	);
	if (sourceArtboards.has(null) || sourceArtboards.size !== 1) {
		return blocked("Afterimage selected sources must remain in one artboard.");
	}
	const resolvedArtboardId = [...sourceArtboards][0];
	if (!resolvedArtboardId)
		return blocked("Afterimage source artboard could not be resolved.");
	if (
		input.artboardId !== undefined &&
		input.artboardId !== null &&
		input.artboardId !== resolvedArtboardId
	) {
		return blocked("Afterimage artboard must match the selected source roles.");
	}
	const artboard = (input.scene.artboards ?? [input.scene.artboard]).find(
		(candidate) => candidate.id === resolvedArtboardId,
	);
	if (artboard?.cameraSpacePolicy !== "screen_2d") {
		return blocked(
			"Afterimage comparison requires an explicit screen_2d camera-space policy.",
		);
	}
	const sampler = buildMotionGrammarFrameSampler({
		bindings: input.bindings,
		scene: input.scene,
		motion: input.motion,
	});
	if (!sampler)
		return blocked("Afterimage candidate has no grammar frame sampler.");
	const critical = afterimageReferenceCriticalFrames(input.source);
	if (critical.status === "blocked") return blocked(critical.reason);
	const frames: AfterimageComparisonFrame[] = [];
	for (const frame of critical.samples) {
		const reference = sampleAfterimageReference(input.source, frame.frame);
		if (reference.status === "blocked") return blocked(reference.reason);
		const referenceSample = reference.samples[0];
		if (!referenceSample)
			return blocked("Afterimage oracle returned no critical-frame sample.");
		const grammar = asGrammarFrameSample(sampler(frame.frame));
		const masterPoseComparisons = referenceSample.echoes
			.filter((echo) => echo.pose && echo.sourceFrame !== null)
			.map((echo) => {
				const presentation = sampleMotionPresentationFrame({
					scene: input.scene,
					motion: input.motion,
					frame: echo.sourceFrame as number,
					artboardId: resolvedArtboardId,
					grammar: sampler,
				});
				const value = presentation.values.find(
					(candidate) => candidate.nodeId === echo.sourceId,
				);
				const candidatePose = value
					? {
							x: value.transform.position.x,
							y: value.transform.position.y,
							rotation: value.transform.rotation,
							scaleX: value.transform.scale.x,
							scaleY: value.transform.scale.y,
						}
					: null;
				const referencePose = echo.pose;
				const matches = Boolean(
					candidatePose &&
						referencePose &&
						candidatePose.x === referencePose.x &&
						candidatePose.y === referencePose.y &&
						candidatePose.rotation === referencePose.rotation &&
						candidatePose.scaleX === referencePose.scaleX &&
						candidatePose.scaleY === referencePose.scaleY,
				);
				return {
					sourceNodeId: echo.sourceId,
					sourceFrame: echo.sourceFrame as number,
					candidatePose,
					referencePosePresent: referencePose !== null,
					matches,
				};
			});
		frames.push({
			id: frame.id,
			purpose: frame.purpose,
			sourceFrame: frame.frame,
			reference: referenceSample,
			candidateDuplicates: grammar.duplicates
				.filter((duplicate) =>
					input.selectedSourceNodeIds.includes(duplicate.sourceNodeId),
				)
				.map((duplicate) => ({
					sourceNodeId: duplicate.sourceNodeId,
					duplicateNodeId: duplicate.duplicateNodeId,
					sourceFrame: duplicate.sourceFrame,
					opacityFactor: duplicate.opacityFactor,
				})),
			masterPoseComparisons,
		});
	}
	const structuralGaps: string[] = [];
	if (!selectedSourceParametersMatch(input)) {
		structuralGaps.push(
			"selected-source binding history parameters do not match the reference input",
		);
	}
	if (frames.some((frame) => !duplicateHistoryMatchesReference(frame))) {
		structuralGaps.push(
			"presentation duplicate identity, source-frame, opacity, or lifecycle does not match the reference history",
		);
	}
	if (!masterPoseComparisonsMatch(frames)) {
		structuralGaps.push(
			"master-pose comparisons are incomplete or do not match the reference source history",
		);
	}
	if (structuralGaps.length === 0) {
		return {
			status: "ready",
			candidateSurface: AFTERIMAGE_CANDIDATE_SURFACE,
			frames,
			surfaces: surfaces(),
		};
	}
	return {
		status: "incompatible",
		candidateSurface: AFTERIMAGE_CANDIDATE_SURFACE,
		frames,
		gaps: [
			...structuralGaps,
			"master-pose comparisons are structural exact-value probes; they do not establish pixel parity",
			"this packet does not evaluate Canvas, export, runtime, or explicit bake parity; those are separate surface evidence gates",
		],
		surfaces: surfaces(),
	};
}
