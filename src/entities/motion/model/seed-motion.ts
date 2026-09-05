import { blankSceneDocument } from "@/entities/scene/model/seed-scene";
import type { MotionDocument } from "./types";

/**
 * Initial side-car motion document. It starts with no tracks so the editor opens
 * on a static scene; fps and duration mirror the seed artboard so the timeline
 * ruler and the renderer agree on frame units from the first paint.
 */
export const initialMotionDocument: MotionDocument = {
	schemaVersion: 1,
	fps: blankSceneDocument.artboard.fps,
	durationFrames: blankSceneDocument.artboard.durationFrames,
	tracks: [],
	clips: [],
};

/**
 * Returns a structurally-independent copy of a motion document. The store keeps
 * its live document detached from the frozen seed literal so Immer drafts never
 * alias module-level constants.
 */
export function cloneMotionDocument(document: MotionDocument): MotionDocument {
	return structuredClone(document);
}
