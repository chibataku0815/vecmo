import type { AnimatableProperty } from "./types";

/**
 * Transform-channel {@link AnimatableProperty} values that count as spatial
 * motion for the camera-first standard (`docs/3d-camera-motion-standards-plan.md`
 * §3.2, §4): the properties a scene camera can carry instead of correlated
 * per-node transforms. Shared verbatim by agent validation
 * (`entities/agent/model/read-only.ts`'s `agent.motion-without-scene-camera` /
 * `agent.scene-camera-unused` issues) and GUI just-in-time camera provisioning
 * (widget-layer authoring entries in `widgets/inspector/model/*`,
 * `widgets/action-surface/model/editor-actions.ts`) so both surfaces agree on
 * what counts as "spatial" without either importing the other's slice.
 * Deliberately excludes `opacity` and every non-scalar look/paint property — a
 * fade or a look/appearance change does not need a scene camera.
 */
export const CAMERA_STANDARD_SPATIAL_PROPERTIES: ReadonlySet<AnimatableProperty> =
	new Set<AnimatableProperty>(["x", "y", "scaleX", "scaleY", "rotation"]);

/** True when `property` is one of {@link CAMERA_STANDARD_SPATIAL_PROPERTIES}. */
export function isSpatialAnimatableProperty(
	property: AnimatableProperty,
): boolean {
	return CAMERA_STANDARD_SPATIAL_PROPERTIES.has(property);
}
