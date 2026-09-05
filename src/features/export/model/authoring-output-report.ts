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
import type { AuthoringOwner } from "@/shared/authoring-capability/model";
import {
	type AuthoringOutputDeclaration,
	authoringOutputDeclarationsForCapability,
} from "./authoring-output-contract";

type CapabilityId =
	| SceneAuthoringCapabilityId
	| MotionAuthoringCapabilityId
	| MotionGrammarAuthoringCapabilityId;

export type ProjectAuthoringOutputEntry = {
	readonly capabilityId: CapabilityId;
	readonly label: string;
	readonly owner: AuthoringOwner;
	readonly declarations: readonly AuthoringOutputDeclaration[];
};

export type ProjectAuthoringOutputReport = {
	readonly presentCapabilityCount: number;
	readonly outputRelevantCapabilityCount: number;
	readonly nonOutputCapabilityCount: number;
	readonly entries: readonly ProjectAuthoringOutputEntry[];
};

const manifests = [
	...SCENE_AUTHORING_CAPABILITIES,
	...MOTION_AUTHORING_CAPABILITIES,
	...MOTION_GRAMMAR_AUTHORING_CAPABILITIES,
] as const;

/**
 * Projects the durable capabilities present in one export snapshot onto the
 * conservative authoring-output contract shown beside generated-asset issues.
 */
export function createProjectAuthoringOutputReport(input: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar: MotionGrammarStoreDocument;
}): ProjectAuthoringOutputReport {
	const present = new Set<string>(
		presentSceneAuthoringCapabilities(input.scene),
	);
	for (const id of presentMotionAuthoringCapabilities(input.motion))
		present.add(id);
	for (const id of presentMotionGrammarAuthoringCapabilities(input.grammar)) {
		present.add(id);
	}

	const entries = manifests
		.filter(
			(manifest) =>
				manifest.classification === "authorable" && present.has(manifest.id),
		)
		.map(
			(manifest): ProjectAuthoringOutputEntry => ({
				capabilityId: manifest.id,
				label: manifest.label,
				owner: manifest.owner,
				declarations: authoringOutputDeclarationsForCapability(manifest.id),
			}),
		);
	const outputRelevantCapabilityCount = entries.filter(
		(entry) => entry.declarations[0]?.fidelity !== "not_applicable",
	).length;
	return {
		presentCapabilityCount: entries.length,
		outputRelevantCapabilityCount,
		nonOutputCapabilityCount: entries.length - outputRelevantCapabilityCount,
		entries,
	};
}
