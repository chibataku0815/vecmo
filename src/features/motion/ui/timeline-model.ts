import type {
	AnimatableProperty,
	CameraRigAnimatableProperty,
} from "@/entities/motion/model/types";
import type { SourceOpticsParameterTarget } from "@/entities/scene/model/source-optics";

/** A visible node-keyed timeline selection. */
export type NodeSelectedKey = {
	readonly kind?: "node";
	readonly trackId: string;
	readonly nodeId: string;
	readonly property: AnimatableProperty;
	readonly frame: number;
};

/** A visible scene-camera timeline selection. */
export type CameraSelectedKey = {
	readonly kind: "camera";
	readonly trackId: string;
	readonly cameraRigId: string;
	readonly property: CameraRigAnimatableProperty;
	readonly frame: number;
};

/** A visible Source Optics parameter selection using its stable owner address. */
export type SourceOpticsSelectedKey = {
	readonly kind: "source-optics";
	readonly trackId: string;
	readonly nodeId: string;
	readonly target: SourceOpticsParameterTarget;
	readonly property: string;
	readonly frame: number;
};

/**
 * A published production-control key. It is addressed by the link + control ids
 * rather than a node id, mirroring how a camera key is addressed by its rig.
 */
export type ProductionControlSelectedKey = {
	readonly kind: "production-control";
	readonly trackId: string;
	readonly linkId: string;
	readonly controlId: string;
	readonly property: "productionControl";
	readonly frame: number;
};

/** A Range Selector Offset key owned directly by one Text Animator binding. */
export type TextAnimatorOffsetSelectedKey = {
	readonly kind: "text-animator-offset";
	readonly bindingId: string;
	readonly selectorIndex: number;
	readonly frame: number;
};

/** A key selection from any first-class Timeline side-car. */
export type SelectedKey =
	| NodeSelectedKey
	| CameraSelectedKey
	| SourceOpticsSelectedKey
	| ProductionControlSelectedKey
	| TextAnimatorOffsetSelectedKey;

export const PROPERTY_LABEL: Record<AnimatableProperty, string> = {
	x: "X",
	y: "Y",
	anchorX: "Anchor X",
	anchorY: "Anchor Y",
	rotation: "Rotate",
	scaleX: "Scale X",
	scaleY: "Scale Y",
	opacity: "Opacity",
	cornerRadius: "Radius",
	cornerRadiusTL: "Radius TL",
	cornerRadiusTR: "Radius TR",
	cornerRadiusBR: "Radius BR",
	cornerRadiusBL: "Radius BL",
	cornerSmoothing: "Smoothing",
	pathShape: "Path",
	meshPaint: "Mesh",
	fillGradient: "Gradient",
};

export const CAMERA_PROPERTY_LABEL: Record<
	CameraRigAnimatableProperty,
	string
> = {
	bodyX: "Body X",
	bodyY: "Body Y",
	bodyZ: "Body Z",
	bodyRotationX: "Pitch",
	bodyRotationY: "Yaw",
	bodyRotationZ: "Roll",
	targetX: "Target X",
	targetY: "Target Y",
	targetZ: "Target Z",
	fovDegrees: "FOV",
	zoom: "Zoom",
	focusDistance: "Focus",
	aperture: "Aperture",
};

const FULL_PERCENT = 100;

/** Maps a frame onto a 0..100 lane percentage shared by ruler, keys, and playhead. */
export const frameToPercent = (
	frame: number,
	durationFrames: number,
): number => (durationFrames > 0 ? (frame / durationFrames) * FULL_PERCENT : 0);
