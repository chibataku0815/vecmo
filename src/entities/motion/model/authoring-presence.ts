import type { MotionAuthoringCapabilityId } from "./authoring-capabilities";
import { ANIMATABLE_PROPERTY_CAPABILITY } from "./authoring-capabilities";
import type { MotionDocument } from "./types";

/** Returns only Motion capabilities whose durable state is present in a document. */
export function presentMotionAuthoringCapabilities(
	document: MotionDocument,
): ReadonlySet<MotionAuthoringCapabilityId> {
	const present = new Set<MotionAuthoringCapabilityId>([
		"motion.schema-version",
		"motion.timing",
	]);
	for (const track of document.tracks) {
		present.add(ANIMATABLE_PROPERTY_CAPABILITY[track.target.property]);
	}
	if ((document.positionPaths?.length ?? 0) > 0) {
		present.add("motion.position-path");
	}
	if ((document.lookNodeTracks?.length ?? 0) > 0) {
		present.add("motion.look-node-track");
	}
	if ((document.sourceOpticsTracks?.length ?? 0) > 0) {
		present.add("motion.source-optics-track");
	}
	// Both side-cars drive the same rig channels — keyframes as the base curve,
	// expressions composed over it — so either one makes the capability present.
	if (
		(document.cameraTracks?.length ?? 0) > 0 ||
		(document.cameraChannelExpressions?.length ?? 0) > 0
	) {
		present.add("motion.camera-track");
	}
	if ((document.productionControlTracks?.length ?? 0) > 0) {
		present.add("motion.production-control-track");
	}
	if ((document.cameraCuts?.length ?? 0) > 0) {
		present.add("motion.camera-cut");
	}
	if ((document.textAnimators?.length ?? 0) > 0) {
		present.add("motion.text-animator");
	}
	if (document.clips.length > 0) present.add("motion.clips");
	if (document.automation) present.add("motion.automation");
	if (document.grammar) present.add("motion.grammar-compatibility");
	return present;
}
