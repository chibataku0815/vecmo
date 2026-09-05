/**
 * Store-free durable fixture for the lead-track Follow-through adapter.
 *
 * Unlike the procedural construction-law fixture, this carrier includes the
 * canonical SceneDocument and MotionDocument that V1 must read. It is evidence
 * for a typed adapter contract only, never a user-facing preset or visual claim.
 */

import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	defaultFollowThroughLeadAdapterRoleMap,
	followThroughLeadAdapterDefaultParameters,
} from "./follow-through-lead-binding";
import type { MotionGrammarBinding } from "./types";

export const FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS = {
	artboard: "follow-through-lead-adapter-artboard",
	lead: "follow-through-lead-adapter-lead",
	followerA: "follow-through-lead-adapter-follower-a",
	followerB: "follow-through-lead-adapter-follower-b",
} as const;

const node = ({
	id,
	name,
	x,
	y,
}: {
	readonly id: string;
	readonly name: string;
	readonly x: number;
	readonly y: number;
}): VectorNode => ({
	id,
	name,
	geometry: {
		kind: "ellipse",
		bounds: { x: -12, y: -12, width: 24, height: 24 },
	},
	transform: {
		position: { x, y },
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill: "#73d13d",
		stroke: "#191817",
		strokeWidth: 2,
		opacity: 1,
	},
	visible: true,
	locked: false,
});

export type FollowThroughLeadAdapterFixture = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
};

/**
 * Lead X travels from 100 to 196 during frames 0–12, so the adapter's one-frame
 * exit velocity is exactly `{x: 8, y: 0}`. The two followers have delays of 6
 * and 12 frames respectively, exposing distinct lag and settle states.
 */
export const createFollowThroughLeadAdapterFixture =
	(): FollowThroughLeadAdapterFixture => {
		const ids = FOLLOW_THROUGH_LEAD_ADAPTER_FIXTURE_IDS;
		const targetIds = [ids.lead, ids.followerA, ids.followerB] as const;
		const binding: MotionGrammarBinding = {
			id: "follow-through-lead-adapter-binding",
			techniqueId: "lag-follow-through",
			targetIds,
			parameters: {
				...followThroughLeadAdapterDefaultParameters(),
				leadExitFrame: 12,
				velocityWindowFrames: 1,
				followerDelayFrames: 6,
				followerStaggerFrames: 6,
				// The final follower starts settling at frame 24, so both followers
				// deterministically return to rest by frame 36.
				settleFrames: 12,
				settleDecay: 2,
				settleWaves: 2,
				derivedVelocityGain: 0.08,
			},
			roleMap: defaultFollowThroughLeadAdapterRoleMap(targetIds),
			effectBinding: { kind: "none" },
		};
		const scene: SceneDocument = {
			schemaVersion: 1,
			id: "follow-through-lead-adapter-scene",
			name: "Lead-track Follow-through Adapter Contract",
			artboard: {
				id: ids.artboard,
				name: "Follow-through Adapter",
				width: 640,
				height: 360,
				background: "#f4f3ef",
				fps: 30,
				durationFrames: 48,
				cameraSpacePolicy: "screen_2d",
			},
			layers: [
				{
					id: "follow-through-lead-adapter-layer",
					name: "Lead and Followers",
					visible: true,
					locked: false,
					nodes: [
						node({ id: ids.lead, name: "Lead", x: 100, y: 180 }),
						node({ id: ids.followerA, name: "Follower A", x: 300, y: 180 }),
						node({ id: ids.followerB, name: "Follower B", x: 420, y: 180 }),
					],
				},
			],
		};
		const motion: MotionDocument = {
			schemaVersion: 1,
			fps: 30,
			durationFrames: 48,
			tracks: [
				{
					id: "follow-through-lead-adapter-lead-x",
					target: { nodeId: ids.lead, property: "x" },
					keyframes: [
						{
							time: 0,
							value: 100,
							// The sampler's default AE-like easing is not linear. The
							// fixture pins an identity temporal curve so its one-frame
							// velocity assertion remains exactly 8 px/frame.
							outTemporalCurve: { x1: 0, y1: 0, x2: 1, y2: 1 },
						},
						{ time: 12, value: 196 },
					],
				},
			],
			clips: [
				{
					id: "follow-through-lead-adapter-clip",
					name: "Lead-track Follow-through",
					startFrame: 0,
					durationFrames: 48,
					trackIds: [],
					provenance: {
						source: "motion-grammar",
						label: "Lead-track Follow-through",
						bindingId: binding.id,
						techniqueId: binding.techniqueId,
						techniqueLabel: "Follow-through",
						targetIds: [...targetIds],
						generatedNodeIds: [],
					},
				},
			],
		};
		return { scene, motion, binding, bindings: [binding] };
	};
