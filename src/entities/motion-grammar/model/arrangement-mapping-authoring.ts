import type { ArrangementLayoutSnapshot } from "@/entities/scene/model/types";
import type { MotionGrammarArrangementMapping } from "./types";

export type ArrangementMappingAuthoringPlan =
	| { readonly status: "blocked"; readonly reason: string }
	| {
			readonly status: "ready";
			readonly targetIds: readonly string[];
			readonly mapping: MotionGrammarArrangementMapping;
	  };

/**
 * Builds an explicit one-to-one Arrangement correspondence from two frozen
 * Scene snapshots. Member order is the authored correspondence; stage seats are
 * the midpoint between source/destination seats and remain individually
 * editable after creation.
 */
export function createArrangementMappingAuthoringPlan({
	source,
	destination,
}: {
	readonly source: ArrangementLayoutSnapshot;
	readonly destination: ArrangementLayoutSnapshot;
}): ArrangementMappingAuthoringPlan {
	if (source.artboardId !== destination.artboardId) {
		return {
			status: "blocked",
			reason: "Arrangement snapshots must belong to the same artboard.",
		};
	}
	if (
		source.memberNodeIds.length === 0 ||
		source.memberNodeIds.length !== destination.memberNodeIds.length
	) {
		return {
			status: "blocked",
			reason:
				"Arrangement snapshots must contain the same non-zero member count.",
		};
	}
	const sourceToStage: Record<string, string> = {};
	const stageToDestination: Record<string, string> = {};
	const stageSlots: Record<string, { readonly x: number; readonly y: number }> =
		{};
	const stagingDelayFractionBySource: Record<string, number> = {};
	let pivotX = 0;
	let pivotY = 0;
	const lastIndex = Math.max(1, source.memberNodeIds.length - 1);
	for (const [index, sourceNodeId] of source.memberNodeIds.entries()) {
		const destinationNodeId = destination.memberNodeIds[index];
		const sourcePoint = source.positions[sourceNodeId];
		const destinationPoint = destinationNodeId
			? destination.positions[destinationNodeId]
			: undefined;
		if (!destinationNodeId || !sourcePoint || !destinationPoint) {
			return {
				status: "blocked",
				reason: "Arrangement snapshots contain an unresolved member seat.",
			};
		}
		const stageSlotId = `stage-${index + 1}`;
		const stagePoint = {
			x: (sourcePoint.x + destinationPoint.x) / 2,
			y: (sourcePoint.y + destinationPoint.y) / 2,
		};
		sourceToStage[sourceNodeId] = stageSlotId;
		stageToDestination[stageSlotId] = destinationNodeId;
		stageSlots[stageSlotId] = stagePoint;
		stagingDelayFractionBySource[sourceNodeId] = index / lastIndex;
		pivotX += stagePoint.x;
		pivotY += stagePoint.y;
	}
	const count = source.memberNodeIds.length;
	return {
		status: "ready",
		targetIds: [...source.memberNodeIds],
		mapping: {
			sourceSnapshotId: source.id,
			destinationSnapshotId: destination.id,
			sourceToStage,
			stageToDestination,
			stageSlots,
			pivot: { x: pivotX / count, y: pivotY / count },
			stagingDelayFractionBySource,
		},
	};
}
