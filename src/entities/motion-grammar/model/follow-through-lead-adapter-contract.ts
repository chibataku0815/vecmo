/**
 * Structural proof for the V1 lead-track Follow-through adapter.
 *
 * This packet proves only read-only MotionDocument adaptation and its central
 * grammar-sampler integration. It intentionally does not claim renderer pixels,
 * GPU execution, export capture, or user acceptance.
 */

import type {
	GrammarFrameSample,
	GrammarFrameSampler,
	GrammarNodeSample,
} from "@/entities/motion/model/grammar-bridge";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { buildMotionGrammarFrameSampler } from "./evaluator";
import {
	createFollowThroughLeadAdapterFixture,
	FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS,
	type FollowThroughLeadAdapterFixture,
} from "./follow-through-lead-adapter-fixture";
import {
	buildFollowThroughLeadPresentationAdapter,
	composeFollowThroughLeadPresentationSampler,
} from "./follow-through-lead-presentation-adapter";
import type { MotionGrammarBinding } from "./types";

export const FOLLOW_THROUGH_LEAD_ADAPTER_CONTRACT_SURFACE =
	"motion-document-lead-track-presentation-adapter" as const;

type SampledTranslate = { readonly x: number; readonly y: number };

export type FollowThroughLeadAdapterContractPacket =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly surface: typeof FOLLOW_THROUGH_LEAD_ADAPTER_CONTRACT_SURFACE;
			readonly scope: string;
			readonly assertions: {
				readonly readsCanonicalLeadTrack: boolean;
				readonly absoluteMotionDocumentFrame: boolean;
				readonly centralSamplerDispatchesV1: boolean;
				readonly leadNeverReceivesFollowerSample: boolean;
				readonly exitLag: {
					readonly followerA: SampledTranslate;
					readonly followerB: SampledTranslate;
					readonly matchesExpected: boolean;
				};
				readonly staggerSettleAndLean: {
					readonly frame19FollowerA: SampledTranslate;
					readonly frame19FollowerB: SampledTranslate;
					readonly frame19FollowerARotate: number;
					readonly frame36FollowerA: SampledTranslate;
					readonly frame36FollowerB: SampledTranslate;
					readonly matchesExpected: boolean;
				};
				readonly centralFieldwiseComposition: boolean;
				readonly compositionPreservesBaseChannelsAndDuplicates: boolean;
				readonly finiteFrameAndDuplicateContract: boolean;
				readonly inputsRemainUnchanged: boolean;
				readonly invalidInputsFailClosed: Readonly<
					Record<
						| "zeroVelocity"
						| "nonScreen2d"
						| "duplicateFollower"
						| "crossArtboard"
						| "differentStructuralParent"
						| "outOfRangeExit"
						| "shortActiveWindow",
						boolean
					>
				>;
			};
	  };

const emptySample = (): GrammarFrameSample => ({
	samples: new Map<string, GrammarNodeSample>(),
	duplicates: [],
});

const asFrameSample = (
	sampler: GrammarFrameSampler | undefined,
	frame: number,
): GrammarFrameSample => {
	if (!sampler) return emptySample();
	const sampled = sampler(frame);
	return "samples" in sampled
		? { samples: new Map(sampled.samples), duplicates: [...sampled.duplicates] }
		: { samples: new Map(sampled), duplicates: [] };
};

const translateFor = (
	sample: GrammarFrameSample,
	nodeId: string,
): SampledTranslate => sample.samples.get(nodeId)?.translate ?? { x: 0, y: 0 };

const rotateFor = (sample: GrammarFrameSample, nodeId: string): number =>
	sample.samples.get(nodeId)?.rotate ?? 0;

const approximatelyEqual = (left: number, right: number): boolean =>
	Number.isFinite(left) &&
	Number.isFinite(right) &&
	Math.abs(left - right) <= 1e-5;

const vectorEquals = (
	left: SampledTranslate,
	right: SampledTranslate,
): boolean =>
	approximatelyEqual(left.x, right.x) && approximatelyEqual(left.y, right.y);

const adapterInput = (
	fixture: FollowThroughLeadAdapterFixture,
	overrides: Partial<{
		readonly scene: SceneDocument;
		readonly motion: MotionDocument;
		readonly leadNodeId: string;
		readonly followerNodeIds: readonly string[];
		readonly leadExitFrame: number;
		readonly activeEndFrameExclusive: number;
	}> = {},
) => {
	const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
	const parameters = fixture.binding.parameters;
	return {
		scene: overrides.scene ?? fixture.scene,
		motion: overrides.motion ?? fixture.motion,
		leadNodeId: overrides.leadNodeId ?? ids.lead,
		followerNodeIds: overrides.followerNodeIds ?? [
			ids.followerA,
			ids.followerB,
		],
		leadExitFrame: overrides.leadExitFrame ?? parameters.leadExitFrame ?? 12,
		velocityWindowFrames: parameters.velocityWindowFrames,
		followerDelayFrames: parameters.followerDelayFrames,
		followerStaggerFrames: parameters.followerStaggerFrames,
		settleFrames: parameters.settleFrames,
		settleDecay: parameters.settleDecay,
		settleWaves: parameters.settleWaves,
		derivedVelocityGain: parameters.derivedVelocityGain,
		...(overrides.activeEndFrameExclusive === undefined
			? {}
			: { activeEndFrameExclusive: overrides.activeEndFrameExclusive }),
	};
};

const crossArtboardScene = (
	fixture: FollowThroughLeadAdapterFixture,
): SceneDocument => {
	const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
	const otherArtboardId = "follow-through-lead-adapter-other-artboard";
	return {
		...fixture.scene,
		artboards: [
			{
				...fixture.scene.artboard,
				id: otherArtboardId,
				name: "Other artboard",
				position: { x: 700, y: 0 },
			},
		],
		layers: fixture.scene.layers.map((layer) => ({
			...layer,
			nodes: layer.nodes.map((node) =>
				node.id === ids.followerB
					? { ...node, artboardId: otherArtboardId }
					: node,
			),
		})),
	};
};

const differentStructuralParentScene = (
	fixture: FollowThroughLeadAdapterFixture,
): SceneDocument => {
	const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
	return {
		...fixture.scene,
		layers: fixture.scene.layers.map((layer) => {
			const follower = layer.nodes.find((node) => node.id === ids.followerB);
			if (!follower) return layer;
			const container: VectorNode = {
				...follower,
				id: "follow-through-lead-adapter-nested-container",
				name: "Nested follower container",
				children: [{ ...follower }],
			};
			return {
				...layer,
				nodes: [
					...layer.nodes.filter((node) => node.id !== ids.followerB),
					container,
				],
			};
		}),
	};
};

const legacyCollisionBinding = (): MotionGrammarBinding => {
	const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
	return {
		id: "follow-through-lead-adapter-legacy-collision",
		techniqueId: "lag-follow-through",
		targetIds: [ids.lead, ids.followerA],
		parameters: { delayFrames: 1, response: 1 },
		effectBinding: { kind: "none" },
	};
};

const pulseCollisionBinding = (): MotionGrammarBinding => {
	const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
	return {
		id: "follow-through-lead-adapter-pulse-collision",
		techniqueId: "random-phase-pulse",
		targetIds: [ids.followerA],
		parameters: {
			periodFrames: 30,
			cadenceFrames: 1,
			pulseFrames: 30,
			scaleAmplitude: 0.2,
			opacityFloor: 0.5,
		},
		seed: 7,
		effectBinding: { kind: "none" },
	};
};

/**
 * Runs named invariant checks on a fixed lead motion. A `ready` packet is
 * structural evidence only; native/GPU capture and user review remain external
 * gates in the residual register.
 */
export function buildFollowThroughLeadAdapterContractPacket(): FollowThroughLeadAdapterContractPacket {
	const fixture = createFollowThroughLeadAdapterFixture();
	const beforeScene = JSON.stringify(fixture.scene);
	const beforeMotion = JSON.stringify(fixture.motion);
	const adapter = buildFollowThroughLeadPresentationAdapter(
		adapterInput(fixture),
	);
	if (adapter.status === "blocked") return adapter;

	const clip = fixture.motion.clips[0];
	if (!clip?.provenance) {
		return {
			status: "blocked",
			reason: "Follow-through fixture requires one grammar clip.",
		};
	}
	const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
	const directAtExit = asFrameSample(adapter.adapter.sampler, 12);
	const directAt19 = asFrameSample(adapter.adapter.sampler, 19);
	const directAt36 = asFrameSample(adapter.adapter.sampler, 36);
	const centralSampler = buildMotionGrammarFrameSampler({
		bindings: fixture.bindings,
		scene: fixture.scene,
		motion: fixture.motion,
	});
	const centralAtExit = asFrameSample(centralSampler, 12);
	const exitFollowerA = translateFor(directAtExit, ids.followerA);
	const exitFollowerB = translateFor(directAtExit, ids.followerB);
	const frame19FollowerA = translateFor(directAt19, ids.followerA);
	const frame19FollowerB = translateFor(directAt19, ids.followerB);
	const frame36FollowerA = translateFor(directAt36, ids.followerA);
	const frame36FollowerB = translateFor(directAt36, ids.followerB);

	const shiftedBinding: MotionGrammarBinding = {
		...fixture.binding,
		id: "follow-through-lead-adapter-shifted-binding",
	};
	const shiftedMotion: MotionDocument = {
		...fixture.motion,
		clips: [
			{
				...clip,
				startFrame: 18,
				durationFrames: 30,
				provenance: { ...clip.provenance, bindingId: shiftedBinding.id },
			},
		],
	};
	const shiftedAdapter = buildFollowThroughLeadPresentationAdapter(
		adapterInput(fixture, { motion: shiftedMotion }),
	);
	if (shiftedAdapter.status === "blocked") return shiftedAdapter;
	const shiftedCentralSampler = buildMotionGrammarFrameSampler({
		bindings: [shiftedBinding],
		scene: fixture.scene,
		motion: shiftedMotion,
	});
	const shiftedCentralAtGlobal24 = asFrameSample(shiftedCentralSampler, 24);
	const shiftedDirectAtGlobal24 = asFrameSample(
		shiftedAdapter.adapter.sampler,
		24,
	);
	const shiftedDirectAtLocal6 = asFrameSample(
		shiftedAdapter.adapter.sampler,
		6,
	);

	const legacyCollisionSampler = buildMotionGrammarFrameSampler({
		// V1 intentionally precedes legacy here; the central sampler must still
		// layer the additive response after every ordinary binding.
		bindings: [fixture.binding, legacyCollisionBinding()],
		scene: fixture.scene,
		motion: fixture.motion,
	});
	const legacyCollisionFollower = asFrameSample(
		legacyCollisionSampler,
		12,
	).samples.get(ids.followerA);
	const pulseCollisionSampler = buildMotionGrammarFrameSampler({
		bindings: [fixture.binding, pulseCollisionBinding()],
		scene: fixture.scene,
		motion: fixture.motion,
	});
	const pulseCollisionFollower = asFrameSample(
		pulseCollisionSampler,
		12,
	).samples.get(ids.followerA);

	const baseDuplicate = {
		sourceNodeId: ids.lead,
		duplicateNodeId: "follow-through-lead-adapter-base-duplicate",
		sourceFrame: 11,
		opacityFactor: 0.4,
	} as const;
	const composed = composeFollowThroughLeadPresentationSampler({
		baseSampler: () => ({
			samples: new Map([
				[
					ids.followerA,
					{
						nodeId: ids.followerA,
						translate: { x: 4, y: 1 },
						rotate: 3,
						opacityFactor: 0.5,
					},
				],
			]),
			duplicates: [baseDuplicate],
		}),
		followThroughSampler: adapter.adapter.sampler,
	});
	const composedAtExit = asFrameSample(composed, 12);
	const composedFollower = composedAtExit.samples.get(ids.followerA);

	const invalidInputsFailClosed = {
		zeroVelocity:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, { motion: { ...fixture.motion, tracks: [] } }),
			).status === "blocked",
		nonScreen2d:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, {
					scene: {
						...fixture.scene,
						artboard: {
							...fixture.scene.artboard,
							cameraSpacePolicy: "camera_space",
						},
					},
				}),
			).status === "blocked",
		duplicateFollower:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, {
					followerNodeIds: [ids.followerA, ids.followerA],
				}),
			).status === "blocked",
		crossArtboard:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, { scene: crossArtboardScene(fixture) }),
			).status === "blocked",
		differentStructuralParent:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, {
					scene: differentStructuralParentScene(fixture),
				}),
			).status === "blocked",
		outOfRangeExit:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, { leadExitFrame: fixture.motion.durationFrames }),
			).status === "blocked",
		shortActiveWindow:
			buildFollowThroughLeadPresentationAdapter(
				adapterInput(fixture, { activeEndFrameExclusive: 35 }),
			).status === "blocked",
	};

	const assertions = {
		readsCanonicalLeadTrack:
			vectorEquals(adapter.adapter.leadTrack.exitVelocity, { x: 8, y: 0 }) &&
			vectorEquals(adapter.adapter.leadTrack.exitPosition, {
				x: 196,
				y: 180,
			}) &&
			vectorEquals(adapter.adapter.leadTrack.precedingPosition, {
				x: 188,
				y: 180,
			}),
		absoluteMotionDocumentFrame:
			vectorEquals(
				translateFor(shiftedCentralAtGlobal24, ids.followerA),
				translateFor(shiftedDirectAtGlobal24, ids.followerA),
			) &&
			!vectorEquals(
				translateFor(shiftedCentralAtGlobal24, ids.followerA),
				translateFor(shiftedDirectAtLocal6, ids.followerA),
			),
		centralSamplerDispatchesV1:
			vectorEquals(translateFor(centralAtExit, ids.followerA), exitFollowerA) &&
			vectorEquals(translateFor(centralAtExit, ids.followerB), exitFollowerB),
		leadNeverReceivesFollowerSample:
			!directAtExit.samples.has(ids.lead) &&
			!centralAtExit.samples.has(ids.lead),
		exitLag: {
			followerA: exitFollowerA,
			followerB: exitFollowerB,
			matchesExpected:
				vectorEquals(exitFollowerA, { x: -48, y: 0 }) &&
				vectorEquals(exitFollowerB, { x: -96, y: 0 }),
		},
		staggerSettleAndLean: {
			frame19FollowerA,
			frame19FollowerB,
			frame19FollowerARotate: rotateFor(directAt19, ids.followerA),
			frame36FollowerA,
			frame36FollowerB,
			matchesExpected:
				frame19FollowerA.x > 0 &&
				approximatelyEqual(frame19FollowerA.y, 0) &&
				rotateFor(directAt19, ids.followerA) > 0 &&
				frame19FollowerB.x < 0 &&
				approximatelyEqual(frame19FollowerB.y, 0) &&
				vectorEquals(frame36FollowerA, { x: 0, y: 0 }) &&
				vectorEquals(frame36FollowerB, { x: 0, y: 0 }),
		},
		centralFieldwiseComposition:
			vectorEquals(legacyCollisionFollower?.translate ?? { x: 0, y: 0 }, {
				x: -56,
				y: 0,
			}) &&
			approximatelyEqual(legacyCollisionFollower?.rotate ?? 0, -0.64) &&
			pulseCollisionFollower?.scaleFactor !== undefined &&
			pulseCollisionFollower.opacityFactor !== undefined &&
			vectorEquals(pulseCollisionFollower.translate ?? { x: 0, y: 0 }, {
				x: -48,
				y: 0,
			}),
		compositionPreservesBaseChannelsAndDuplicates:
			composedFollower?.opacityFactor === 0.5 &&
			approximatelyEqual(composedFollower?.rotate ?? 0, 3) &&
			vectorEquals(composedFollower?.translate ?? { x: 0, y: 0 }, {
				x: -44,
				y: 1,
			}) &&
			composedAtExit.duplicates.length === 1 &&
			composedAtExit.duplicates[0]?.duplicateNodeId ===
				baseDuplicate.duplicateNodeId,
		finiteFrameAndDuplicateContract:
			asFrameSample(adapter.adapter.sampler, Number.NaN).samples.size === 0 &&
			directAtExit.duplicates.length === 0 &&
			directAt19.duplicates.length === 0 &&
			directAt36.duplicates.length === 0,
		inputsRemainUnchanged:
			JSON.stringify(fixture.scene) === beforeScene &&
			JSON.stringify(fixture.motion) === beforeMotion,
		invalidInputsFailClosed,
	};
	const ready =
		assertions.readsCanonicalLeadTrack &&
		assertions.absoluteMotionDocumentFrame &&
		assertions.centralSamplerDispatchesV1 &&
		assertions.leadNeverReceivesFollowerSample &&
		assertions.exitLag.matchesExpected &&
		assertions.staggerSettleAndLean.matchesExpected &&
		assertions.centralFieldwiseComposition &&
		assertions.compositionPreservesBaseChannelsAndDuplicates &&
		assertions.finiteFrameAndDuplicateContract &&
		assertions.inputsRemainUnchanged &&
		Object.values(assertions.invalidInputsFailClosed).every(Boolean);
	if (!ready) {
		const failedAssertions = Object.entries({
			readsCanonicalLeadTrack: assertions.readsCanonicalLeadTrack,
			absoluteMotionDocumentFrame: assertions.absoluteMotionDocumentFrame,
			centralSamplerDispatchesV1: assertions.centralSamplerDispatchesV1,
			leadNeverReceivesFollowerSample:
				assertions.leadNeverReceivesFollowerSample,
			exitLag: assertions.exitLag.matchesExpected,
			staggerSettleAndLean: assertions.staggerSettleAndLean.matchesExpected,
			centralFieldwiseComposition: assertions.centralFieldwiseComposition,
			compositionPreservesBaseChannelsAndDuplicates:
				assertions.compositionPreservesBaseChannelsAndDuplicates,
			finiteFrameAndDuplicateContract:
				assertions.finiteFrameAndDuplicateContract,
			inputsRemainUnchanged: assertions.inputsRemainUnchanged,
			invalidInputsFailClosed: Object.values(
				assertions.invalidInputsFailClosed,
			).every(Boolean),
		})
			.filter(([, passed]) => !passed)
			.map(([name]) => name);
		return {
			status: "blocked",
			reason: `Lead-track Follow-through adapter contract failed: ${failedAssertions.join(", ")}.`,
		};
	}
	return {
		status: "ready",
		surface: FOLLOW_THROUGH_LEAD_ADAPTER_CONTRACT_SURFACE,
		scope:
			"Read-only MotionDocument lead-track adaptation, absolute-frame clip activation, field-wise central composition, and fail-closed input validation only; no native/GPU/user verdict is implied.",
		assertions,
	};
}
