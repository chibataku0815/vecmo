import {
	MOTION_AUTHORING_CAPABILITIES,
	type MotionAuthoringCapabilityId,
} from "@/entities/motion/model/authoring-capabilities";
import { presentMotionAuthoringCapabilities } from "@/entities/motion/model/authoring-presence";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	MOTION_GRAMMAR_AUTHORING_CAPABILITIES,
	type MotionGrammarAuthoringCapabilityId,
} from "@/entities/motion-grammar/model/authoring-capabilities";
import { presentMotionGrammarAuthoringCapabilities } from "@/entities/motion-grammar/model/authoring-presence";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import {
	SCENE_AUTHORING_CAPABILITIES,
	type SceneAuthoringCapabilityId,
} from "@/entities/scene/model/authoring-capabilities";
import { presentSceneAuthoringCapabilities } from "@/entities/scene/model/authoring-presence";
import type { SceneDocument } from "@/entities/scene/model/types";

export type ProjectAuthoringCompatibilityState =
	| "editable"
	| "partial"
	| "blocked";

export type ProjectAuthoringCompatibilityEntry = {
	readonly capabilityId: string;
	readonly label: string;
	readonly owner: "scene" | "motion" | "motion-grammar";
	readonly state: ProjectAuthoringCompatibilityState;
	readonly reason?: string;
};

export type ProjectAuthoringCompatibilityReport = {
	readonly status: "full" | "limited";
	readonly presentCapabilityCount: number;
	readonly editableCapabilityCount: number;
	readonly partialCapabilityCount: number;
	readonly blockedCapabilityCount: number;
	readonly entries: readonly ProjectAuthoringCompatibilityEntry[];
};

type CapabilityId =
	| SceneAuthoringCapabilityId
	| MotionAuthoringCapabilityId
	| MotionGrammarAuthoringCapabilityId;

/**
 * Reviewed source gaps only. Keep this explicit (rather than defaulting new
 * capabilities to a limitation) so the parity gate and restore report share
 * one zero-gap terminal state. A future partial/blocked slice must add its
 * visible restore reason here and a ratcheted evidence gap in the same change.
 */
export const PROJECT_GUI_AUTHORING_LIMITATIONS: Partial<
	Record<
		CapabilityId,
		{ readonly state: "partial" | "blocked"; readonly reason: string }
	>
> = {};

const manifests = [
	...SCENE_AUTHORING_CAPABILITIES,
	...MOTION_AUTHORING_CAPABILITIES,
	...MOTION_GRAMMAR_AUTHORING_CAPABILITIES,
] as const;

/**
 * Reports only durable capabilities actually present in one restored project.
 * System/derived/diagnostic rows are excluded because they do not describe a
 * user-editable compatibility limitation.
 */
export function createProjectAuthoringCompatibilityReport(input: {
	readonly scene: SceneDocument;
	readonly motion?: MotionDocument;
	readonly grammar?: MotionGrammarStoreDocument;
}): ProjectAuthoringCompatibilityReport {
	const present = new Set<string>(
		presentSceneAuthoringCapabilities(input.scene),
	);
	if (input.motion) {
		for (const id of presentMotionAuthoringCapabilities(input.motion)) {
			present.add(id);
		}
	}
	if (input.grammar) {
		for (const id of presentMotionGrammarAuthoringCapabilities(input.grammar)) {
			present.add(id);
		}
	}

	const entries = manifests
		.filter(
			(manifest) =>
				manifest.classification === "authorable" && present.has(manifest.id),
		)
		.map((manifest): ProjectAuthoringCompatibilityEntry => {
			const limitation =
				PROJECT_GUI_AUTHORING_LIMITATIONS[
					manifest.id as keyof typeof PROJECT_GUI_AUTHORING_LIMITATIONS
				];
			return {
				capabilityId: manifest.id,
				label: manifest.label,
				owner: manifest.owner,
				state: limitation?.state ?? "editable",
				...(limitation ? { reason: limitation.reason } : {}),
			};
		});
	const partialCapabilityCount = entries.filter(
		(entry) => entry.state === "partial",
	).length;
	const blockedCapabilityCount = entries.filter(
		(entry) => entry.state === "blocked",
	).length;
	return {
		status:
			partialCapabilityCount + blockedCapabilityCount > 0 ? "limited" : "full",
		presentCapabilityCount: entries.length,
		editableCapabilityCount: entries.filter(
			(entry) => entry.state === "editable",
		).length,
		partialCapabilityCount,
		blockedCapabilityCount,
		entries,
	};
}
