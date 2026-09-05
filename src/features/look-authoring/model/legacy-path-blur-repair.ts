import { scanLegacyPathBlurSeeds } from "@/entities/scene/model/legacy-path-blur-seed";
import { useSceneStore } from "@/entities/scene/model/store";
import { createRemoveLookGraphNodeCommand } from "./look-graph-commands";

const REPAIR_COALESCE_KEY = "repair-legacy-path-blur-seed";
const REPAIR_LABEL = "Remove legacy Path Blur";

/**
 * One-click repair for pre-17229d7 auto-seeded frame Path Blur nodes (see
 * `entities/scene/model/legacy-path-blur-seed`). Never runs unprompted — the
 * approval banner's 修復 button is the explicit user confirmation. Re-derives
 * the conservative scan at call time, then removes each flagged node through
 * {@link createRemoveLookGraphNodeCommand} (the same command the Inspector's
 * node Trash button uses, so neighbors re-wire and the artboard keeps any other
 * look nodes) inside ONE scene-store transaction: a single Cmd+Z restores every
 * removed node, which is the safety net for a false positive.
 */
export function repairLegacyPathBlurSeeds(): void {
	const scan = scanLegacyPathBlurSeeds(useSceneStore.getState().document);
	if (scan.count === 0) return;
	const store = useSceneStore.getState();
	store.beginTransaction(REPAIR_COALESCE_KEY, REPAIR_LABEL);
	for (const seed of scan.seeds) {
		const result = createRemoveLookGraphNodeCommand(
			useSceneStore.getState().document,
			{ scope: "artboard", artboardId: seed.artboardId },
			seed.nodeId,
			{ label: REPAIR_LABEL },
		);
		if (result.kind === "ready") {
			useSceneStore.getState().apply(result.command);
		}
	}
	useSceneStore.getState().commit();
}
