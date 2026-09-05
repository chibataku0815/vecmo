import type { MotionDocument } from "@/entities/motion/model/types";
import type {
	ArrangementLayoutSnapshot,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import type { ArrangementReferenceInput } from "./arrangement-reference-oracle";
import type { MotionGrammarBinding } from "./types";

const ARTBOARD_ID = "arrangement-alternate-artboard";
const NODE_IDS = [
	"arrangement-alt-circle-a",
	"arrangement-alt-circle-b",
	"arrangement-alt-circle-c",
	"arrangement-alt-circle-d",
] as const;

const SOURCE_POSITIONS: Readonly<Record<string, Vec2>> = {
	[NODE_IDS[0]]: { x: 160, y: 132 },
	[NODE_IDS[1]]: { x: 302, y: 116 },
	[NODE_IDS[2]]: { x: 444, y: 164 },
	[NODE_IDS[3]]: { x: 286, y: 316 },
};

const DESTINATION_POSITIONS: Readonly<Record<string, Vec2>> = {
	[NODE_IDS[0]]: { x: 236, y: 214 },
	[NODE_IDS[1]]: { x: 320, y: 128 },
	[NODE_IDS[2]]: { x: 404, y: 214 },
	[NODE_IDS[3]]: { x: 320, y: 300 },
};

const STAGE_SLOTS: Readonly<Record<string, Vec2>> = {
	"stage-a": { x: 228, y: 204 },
	"stage-b": { x: 320, y: 184 },
	"stage-c": { x: 412, y: 204 },
	"stage-d": { x: 320, y: 286 },
};

const sourceSnapshot: ArrangementLayoutSnapshot = {
	id: "arrangement-alt-layout-source",
	name: "Alternate source layout",
	artboardId: ARTBOARD_ID,
	coordinateSpace: "artboard-local",
	memberNodeIds: [...NODE_IDS],
	positions: SOURCE_POSITIONS,
	captureToken: "arrangement-alt-source-capture-v1",
	capturedArtboardSize: { width: 640, height: 420 },
};

const destinationSnapshot: ArrangementLayoutSnapshot = {
	id: "arrangement-alt-layout-destination",
	name: "Alternate destination layout",
	artboardId: ARTBOARD_ID,
	coordinateSpace: "artboard-local",
	memberNodeIds: [...NODE_IDS],
	positions: DESTINATION_POSITIONS,
	captureToken: "arrangement-alt-destination-capture-v1",
	capturedArtboardSize: { width: 640, height: 420 },
};

const node = (id: string, position: Vec2): VectorNode => ({
	id,
	name: `Arrangement alternate ${id.slice(-1).toUpperCase()}`,
	geometry: {
		kind: "ellipse",
		bounds: { x: -18, y: -18, width: 36, height: 36 },
	},
	transform: {
		position,
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

const sourceToStage: Readonly<Record<string, string>> = {
	[NODE_IDS[0]]: "stage-a",
	[NODE_IDS[1]]: "stage-b",
	[NODE_IDS[2]]: "stage-c",
	[NODE_IDS[3]]: "stage-d",
};

const stageToDestination: Readonly<Record<string, string>> = {
	[NODE_IDS[0]]: NODE_IDS[2],
	[NODE_IDS[1]]: NODE_IDS[0],
	[NODE_IDS[2]]: NODE_IDS[3],
	[NODE_IDS[3]]: NODE_IDS[1],
};

export type ArrangementAlternateCandidateFixture = {
	readonly source: ArrangementReferenceInput;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly binding: MotionGrammarBinding;
	readonly bindings: readonly MotionGrammarBinding[];
};

/** Four-member alternate carrier proving Arrangement is not tied to the three-role workspace seed. */
export const createArrangementAlternateCandidateFixture =
	(): ArrangementAlternateCandidateFixture => {
		const source: ArrangementReferenceInput = {
			periodFrames: 120,
			phaseStartFrame: 0,
			sourceSnapshot,
			destinationSnapshot,
			sourceToStage,
			stageToDestination,
			stageSlots: STAGE_SLOTS,
			pivot: { x: 320, y: 210 },
			gatherFraction: 0.24,
			holdFraction: 0.12,
			sharedTurnDegrees: 180,
			lobeDepth: 0.7,
			stagingDelayFractionBySource: {
				[NODE_IDS[0]]: 0,
				[NODE_IDS[1]]: 0.04,
				[NODE_IDS[2]]: 0.08,
				[NODE_IDS[3]]: 0.12,
			},
		};
		const binding: MotionGrammarBinding = {
			id: "arrangement-alternate-binding",
			techniqueId: "arrangement-transition",
			targetIds: [...NODE_IDS],
			roleMap: Object.fromEntries(
				NODE_IDS.map((nodeId, index) => [
					nodeId,
					`arrangement-transition:member-${String.fromCharCode(97 + index)}`,
				]),
			),
			arrangementMapping: {
				sourceSnapshotId: sourceSnapshot.id,
				destinationSnapshotId: destinationSnapshot.id,
				sourceToStage,
				stageToDestination,
				stageSlots: STAGE_SLOTS,
				pivot: source.pivot,
				stagingDelayFractionBySource: source.stagingDelayFractionBySource,
			},
			parameters: {
				phaseStartFrame: source.phaseStartFrame,
				periodFrames: source.periodFrames,
				radiusPx: 48,
				angleOffset: 0,
				scaleAmplitude: 0,
				gatherFraction: source.gatherFraction,
				holdFraction: source.holdFraction,
				sharedTurnDegrees: source.sharedTurnDegrees,
				lobeDepth: source.lobeDepth,
			},
			effectBinding: { kind: "none" },
		};
		const scene: SceneDocument = {
			schemaVersion: 1,
			id: "arrangement-alternate-scene",
			name: "Arrangement alternate four-member carrier",
			artboard: {
				id: ARTBOARD_ID,
				name: "Arrangement alternate",
				width: 640,
				height: 420,
				background: "#f4f3ef",
				fps: 30,
				durationFrames: source.periodFrames,
				cameraSpacePolicy: "screen_2d",
			},
			layers: [
				{
					id: "arrangement-alternate-layer",
					name: "Arrangement alternate carrier",
					visible: true,
					locked: false,
					nodes: NODE_IDS.map((id) => node(id, SOURCE_POSITIONS[id])),
				},
			],
			arrangementLayoutSnapshots: [sourceSnapshot, destinationSnapshot],
		};
		const trackIds: readonly string[] = [];
		return {
			source,
			scene,
			motion: {
				schemaVersion: 1,
				fps: 30,
				durationFrames: source.periodFrames,
				tracks: [],
				clips: [
					{
						id: "arrangement-alternate-clip",
						name: "Arrangement alternate",
						startFrame: 0,
						durationFrames: source.periodFrames,
						trackIds: [...trackIds],
						provenance: {
							source: "motion-grammar",
							label: "Arrangement alternate",
							bindingId: binding.id,
							techniqueId: binding.techniqueId,
							techniqueLabel: "Arrangement",
							targetIds: [...binding.targetIds],
							generatedNodeIds: [],
						},
					},
				],
			},
			binding,
			bindings: [binding],
		};
	};
