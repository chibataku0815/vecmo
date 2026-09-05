import { useSceneStore } from "@/entities/scene/model/store";
import type { Bounds, Vec2 } from "@/entities/scene/model/types";
import {
	ARTBOARD_CREATION_PRESETS,
	type ArtboardCreationPresetId,
	buildCreateArtboardFromBoundsCommand,
	buildCreateArtboardFromPresetCommand,
	type CreateArtboardWorkflowSuccess,
} from "./workflow";

/**
 * Commits a Frame-tool drag rectangle as a new artboard through the scene command
 * bus. Geometry only ever enters the document via the workflow's add-artboard
 * command, so the scene model stays the single source of truth and creation is
 * undoable through the shared Cmd+Z history — the same path the artboard Quick
 * Actions already use. Returns the workflow success (with the new artboard id) so
 * the caller can select it, or null when the drag was too degenerate to become a
 * valid artboard.
 *
 * `select: false` is deliberate: it keeps `currentArtboardId` on the artboard the
 * user was already working in, so the workspace-fit reframe (which follows the
 * current artboard) does NOT yank the camera to zoom-fit the freshly drawn frame.
 * Drawing a small frame otherwise jumped the view to a deep zoom — jarring, and
 * unlike Figma, where the view stays put. The handler still surfaces the new frame
 * with a real selection (chrome + Inspector) through `selectArtboard`, which is
 * ephemeral selection state and does not move the camera.
 */
export function commitFrameFromBounds(
	bounds: Bounds,
): CreateArtboardWorkflowSuccess | null {
	const document = useSceneStore.getState().document;
	const result = buildCreateArtboardFromBoundsCommand(document, bounds, {
		select: false,
	});
	if (!result.ok) return null;
	useSceneStore.getState().apply(result.command);
	return result;
}

/**
 * Commits a preset-sized artboard centered on a pasteboard anchor (the Frame-tool
 * click point). Mirrors {@link commitFrameFromBounds}: same command bus, same
 * `select: false` no-camera-yank contract; only the size comes from the preset and
 * the placement centers the artboard on the click rather than taking a dragged
 * rectangle. Returns null for an unknown preset id.
 */
export function commitFramePreset(
	presetId: ArtboardCreationPresetId,
	anchor: Vec2,
): CreateArtboardWorkflowSuccess | null {
	const preset = ARTBOARD_CREATION_PRESETS.find((item) => item.id === presetId);
	if (!preset) return null;
	const document = useSceneStore.getState().document;
	const result = buildCreateArtboardFromPresetCommand(document, presetId, {
		position: {
			x: anchor.x - preset.width / 2,
			y: anchor.y - preset.height / 2,
		},
		select: false,
	});
	if (!result.ok) return null;
	useSceneStore.getState().apply(result.command);
	return result;
}
