import {
	removeCameraRigKeyframe,
	upsertCameraRigKeyframe,
} from "@/entities/motion/model/camera-commands";
import type { MotionCommand } from "@/entities/motion/model/command";
import {
	findSourceOpticsTrack,
	removeKeyframe,
	removeSourceOpticsKeyframe,
	removeTextAnimatorOffsetKeyframe,
	snapMotionFrame,
	upsertSourceOpticsKeyframe,
	upsertTextAnimatorOffsetKeyframe,
} from "@/entities/motion/model/commands";
import {
	isValidMeshValue,
	isValidPathShape,
} from "@/entities/motion/model/keyframe-validation";
import { pathShapeAtFrame } from "@/entities/motion/model/path-shape";
import {
	productionControlTrackId,
	removeProductionControlKeyframe,
	upsertProductionControlKeyframe,
} from "@/entities/motion/model/production-control-commands";
import {
	effectiveMesh,
	effectiveSourceOpticsParameter,
	findTrack,
} from "@/entities/motion/model/sampler";
import {
	resolveTextAnimatorOffsetKey,
	textAnimatorOffsetAtFrame,
} from "@/entities/motion/model/text-animator";
import {
	type AeKeyframe,
	ANIMATABLE_PROPERTIES,
	type AnimatableProperty,
	type AnimatableValue,
	type CameraRigAnimatableProperty,
	type CameraRigTrack,
	type KeyframeTrack,
	type MotionDocument,
	type ScalarAnimatableProperty,
	type TextAnimatorBinding,
} from "@/entities/motion/model/types";
import {
	productionControlKeyframes,
	sampleProductionControlValue,
	sceneProductionLinks,
} from "@/entities/scene/model/production-control";
import { productionControlStaticValue } from "@/entities/scene/model/production-link";
import {
	findArtboardById,
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import {
	SOURCE_OPTICS_PARAMETER_DESCRIPTORS,
	type SourceOpticsParameterTarget,
	sourceOpticsParameterValue,
	sourceOpticsRigsForArtboard,
} from "@/entities/scene/model/source-optics";
import type {
	Artboard,
	BezierShape,
	MeshGradientPaint,
	SceneCameraRigContract,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { sampleKeyframeTrack } from "@/shared/glammer/keyframe-track";
import {
	createMotionKeyframeCommand,
	sampledMotionScalarValue,
} from "../model/authoring-commands";
import {
	CAMERA_PROPERTY_LABEL,
	type CameraSelectedKey,
	type NodeSelectedKey,
	PROPERTY_LABEL,
	type ProductionControlSelectedKey,
	type SelectedKey,
	type SourceOpticsSelectedKey,
	type TextAnimatorOffsetSelectedKey,
} from "./timeline-model";

export const TIMELINE_SCALAR_PROPERTIES = [
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
] as const satisfies readonly ScalarAnimatableProperty[];

export type TimelineScalarProperty =
	(typeof TIMELINE_SCALAR_PROPERTIES)[number];

/**
 * Scalar row properties: the always-present transform/opacity channels plus the
 * corner channels, which only appear for roundable primitives (rect/star/polygon
 * for uniform radius + smoothing, rect-only for per-corner) and are therefore not
 * in the unconditional {@link TIMELINE_SCALAR_PROPERTIES}.
 */
export type TimelineScalarRowProperty =
	| TimelineScalarProperty
	| "cornerRadius"
	| "cornerRadiusTL"
	| "cornerRadiusTR"
	| "cornerRadiusBR"
	| "cornerRadiusBL"
	| "cornerSmoothing";

const ROUNDABLE_KINDS = new Set(["rect", "star", "polygon"]);

const PER_CORNER_ROW_PROPERTIES = [
	"cornerRadiusTL",
	"cornerRadiusTR",
	"cornerRadiusBR",
	"cornerRadiusBL",
] as const satisfies readonly TimelineScalarRowProperty[];

type TimelineBaseRow<
	P extends AnimatableProperty,
	V extends AnimatableValue,
> = {
	readonly id: string;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly property: P;
	readonly label: string;
	readonly trackId: string | null;
	readonly keyframes: readonly AeKeyframe<V>[];
	readonly currentFrame: number;
	readonly valueAtFrame: V;
	readonly hasKeyAtCurrentFrame: boolean;
};

export type TimelineScalarRow = TimelineBaseRow<
	TimelineScalarRowProperty,
	number
>;

export type TimelinePathShapeRow = TimelineBaseRow<"pathShape", BezierShape>;

export type TimelineMeshPaintRow = TimelineBaseRow<
	"meshPaint",
	MeshGradientPaint
>;

export type TimelineCameraRow = {
	readonly kind: "camera";
	readonly id: string;
	readonly cameraRigId: string;
	readonly cameraName: string;
	readonly property: CameraRigAnimatableProperty;
	readonly label: string;
	readonly trackId: string | null;
	readonly keyframes: readonly AeKeyframe<number>[];
	readonly currentFrame: number;
	readonly valueAtFrame: number;
	readonly hasKeyAtCurrentFrame: boolean;
};

export type TimelineSourceOpticsRow = {
	readonly kind: "source-optics";
	readonly id: string;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly target: SourceOpticsParameterTarget;
	readonly property: string;
	readonly label: string;
	readonly trackId: string | null;
	readonly keyframes: readonly AeKeyframe<number>[];
	readonly currentFrame: number;
	readonly valueAtFrame: number;
	readonly hasKeyAtCurrentFrame: boolean;
};

/** One selector Offset projection; values remain in TextAnimatorBinding. */
export type TimelineTextAnimatorOffsetRow = {
	readonly kind: "text-animator-offset";
	readonly id: string;
	readonly bindingId: string;
	readonly selectorIndex: number;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly property: "offset";
	readonly label: "Offset";
	readonly units: "percent" | "index";
	readonly trackId: null;
	readonly keyframes: readonly AeKeyframe<number>[];
	readonly currentFrame: number;
	readonly valueAtFrame: number;
	readonly hasKeyAtCurrentFrame: boolean;
};

/** Compact parent lane for one selected node's first Text Animator binding. */
export type TimelineTextAnimatorLane = {
	readonly kind: "text-animator";
	readonly id: string;
	readonly bindingId: string;
	readonly bindingName: string;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly targetKind: TextAnimatorBinding["target"]["kind"];
	readonly enabled: boolean;
	readonly clip: TextAnimatorBinding["clip"] | undefined;
	readonly rows: readonly TimelineTextAnimatorOffsetRow[];
};

/**
 * One published production control projected as a timeline row. The row is
 * addressed by `(linkId, controlId)` — never by a node id — because the control
 * belongs to the linked production contract; `nodeId` is only the placement the
 * user selected to reach it, so the lane can name its subject.
 */
export type TimelineProductionControlRow = {
	readonly kind: "production-control";
	readonly id: string;
	readonly assetId: string;
	readonly linkId: string;
	readonly controlId: string;
	readonly nodeId: string;
	readonly nodeName: string;
	readonly property: "productionControl";
	readonly label: string;
	readonly unit: string;
	readonly trackId: string | null;
	readonly keyframes: readonly AeKeyframe<number>[];
	readonly currentFrame: number;
	readonly valueAtFrame: number;
	readonly hasKeyAtCurrentFrame: boolean;
};

export type TimelineNodeRow =
	| TimelineScalarRow
	| TimelinePathShapeRow
	| TimelineMeshPaintRow;

export type TimelineRow =
	| TimelineNodeRow
	| TimelineCameraRow
	| TimelineSourceOpticsRow
	| TimelineProductionControlRow
	| TimelineTextAnimatorOffsetRow;

export const isTimelineCameraRow = (
	row: TimelineRow,
): row is TimelineCameraRow => "kind" in row && row.kind === "camera";

export const isTimelineProductionControlRow = (
	row: TimelineRow,
): row is TimelineProductionControlRow =>
	"kind" in row && row.kind === "production-control";

export const isTimelineSourceOpticsRow = (
	row: TimelineRow,
): row is TimelineSourceOpticsRow =>
	"kind" in row && row.kind === "source-optics";

export const isTimelineTextAnimatorOffsetRow = (
	row: TimelineRow,
): row is TimelineTextAnimatorOffsetRow =>
	"kind" in row && row.kind === "text-animator-offset";

export const isCameraSelectedKey = (
	key: SelectedKey | null,
): key is CameraSelectedKey =>
	key?.kind === "camera" && typeof key.cameraRigId === "string";

export const isProductionControlSelectedKey = (
	key: SelectedKey | null,
): key is ProductionControlSelectedKey =>
	key?.kind === "production-control" &&
	typeof key.linkId === "string" &&
	typeof key.controlId === "string";

export const isSourceOpticsSelectedKey = (
	key: SelectedKey | null,
): key is SourceOpticsSelectedKey =>
	key?.kind === "source-optics" && typeof key.nodeId === "string";

export const isTextAnimatorOffsetSelectedKey = (
	key: SelectedKey | null,
): key is TextAnimatorOffsetSelectedKey =>
	key?.kind === "text-animator-offset" &&
	typeof key.bindingId === "string" &&
	Number.isInteger(key.selectorIndex) &&
	key.selectorIndex >= 0;

const NODE_ANIMATABLE_PROPERTY_SET = new Set<string>(ANIMATABLE_PROPERTIES);

export const isNodeSelectedKey = (
	key: SelectedKey | null,
): key is NodeSelectedKey =>
	key !== null &&
	key.kind !== "camera" &&
	key.kind !== "source-optics" &&
	key.kind !== "production-control" &&
	key.kind !== "text-animator-offset" &&
	typeof key.nodeId === "string" &&
	NODE_ANIMATABLE_PROPERTY_SET.has(key.property);

/** Snaps UI-authored frames to the same whole-frame, in-range grid as commands. */
export function snapTimelineFrame(
	frame: number,
	durationFrames: number,
): number {
	return snapMotionFrame(frame, durationFrames);
}

const isNumberKeyframe = (
	keyframe: AeKeyframe<AnimatableValue>,
): keyframe is AeKeyframe<number> =>
	Number.isFinite(keyframe.time) && typeof keyframe.value === "number";

const isPathShapeKeyframe = (
	keyframe: AeKeyframe<AnimatableValue>,
): keyframe is AeKeyframe<BezierShape> =>
	Number.isFinite(keyframe.time) && isValidPathShape(keyframe.value);

const numericKeyframes = (
	track: KeyframeTrack | undefined,
): readonly AeKeyframe<number>[] =>
	track?.keyframes.filter(isNumberKeyframe) ?? [];

const pathShapeKeyframes = (
	track: KeyframeTrack | undefined,
): readonly AeKeyframe<BezierShape>[] =>
	track?.keyframes.filter(isPathShapeKeyframe) ?? [];

const meshPaintKeyframes = (
	track: KeyframeTrack | undefined,
): readonly AeKeyframe<MeshGradientPaint>[] =>
	track?.keyframes.filter(
		(keyframe): keyframe is AeKeyframe<MeshGradientPaint> =>
			Number.isFinite(keyframe.time) && isValidMeshValue(keyframe.value),
	) ?? [];

const timelineValueForProperty = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	property: TimelineScalarRowProperty,
): number => sampledMotionScalarValue(node, motion, frame, property);

const TIMELINE_CAMERA_BASE_PROPERTIES = [
	"bodyX",
	"bodyY",
	"bodyZ",
	"bodyRotationX",
	"bodyRotationY",
	"bodyRotationZ",
	"targetX",
	"targetY",
	"targetZ",
	"focusDistance",
	"aperture",
] as const satisfies readonly CameraRigAnimatableProperty[];

const DEFAULT_CAMERA_FOV_DEGREES = 50;
const DEFAULT_ORTHOGRAPHIC_ZOOM = 1;

const findCameraTrack = (
	motion: MotionDocument,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
): CameraRigTrack | undefined =>
	motion.cameraTracks?.find(
		(track) =>
			track.target.cameraRigId === cameraRigId &&
			track.target.property === property,
	);

type CameraTrackIndex = ReadonlyMap<
	CameraRigAnimatableProperty,
	CameraRigTrack
>;

const createCameraTrackIndex = (
	motion: MotionDocument,
	cameraRigId: string,
): CameraTrackIndex => {
	const index = new Map<CameraRigAnimatableProperty, CameraRigTrack>();
	for (const track of motion.cameraTracks ?? []) {
		if (track.target.cameraRigId !== cameraRigId) continue;
		index.set(track.target.property, track);
	}
	return index;
};

const cameraKeyframes = (
	track: CameraRigTrack | undefined,
): readonly AeKeyframe<number>[] =>
	track?.keyframes.filter(
		(keyframe) =>
			Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
	) ?? [];

const artboardForRig = (
	scene: SceneDocument,
	rig: SceneCameraRigContract,
): Artboard => {
	if (rig.scope.kind === "artboard") {
		return (
			findArtboardById(scene, rig.scope.artboardId) ??
			selectCurrentArtboard(scene)
		);
	}
	return selectCurrentArtboard(scene);
};

const cameraRestValue = (
	rig: SceneCameraRigContract,
	artboard: Artboard,
	property: CameraRigAnimatableProperty,
): number => {
	const target = rig.target?.point ?? {
		x: artboard.width / 2,
		y: artboard.height / 2,
		z: 0,
	};
	switch (property) {
		case "bodyX":
			return rig.body.position.x;
		case "bodyY":
			return rig.body.position.y;
		case "bodyZ":
			return rig.body.position.z;
		case "bodyRotationX":
			return rig.body.rotation?.x ?? 0;
		case "bodyRotationY":
			return rig.body.rotation?.y ?? 0;
		case "bodyRotationZ":
			return rig.body.rotation?.z ?? 0;
		case "targetX":
			return target.x;
		case "targetY":
			return target.y;
		case "targetZ":
			return target.z;
		case "zoom":
			return rig.projection.zoom ?? DEFAULT_ORTHOGRAPHIC_ZOOM;
		case "fovDegrees":
			return rig.projection.fovDegrees ?? DEFAULT_CAMERA_FOV_DEGREES;
		case "focusDistance":
			return rig.projection.focusDistance ?? Math.abs(rig.body.position.z);
		case "aperture":
			return rig.projection.aperture ?? 0;
	}
};

const cameraValueAtFrame = (
	track: CameraRigTrack | undefined,
	frame: number,
	base: number,
): number => {
	const keyframes = cameraKeyframes(track);
	return keyframes.length > 0
		? sampleKeyframeTrack([...keyframes], frame)
		: base;
};

/**
 * Builds the timeline rows for a single selected node without mutating the motion
 * side-car. Missing tracks still produce rows so users can author the first key
 * for transform and opacity channels directly from the timeline.
 */
export function buildTimelineRowsForNode(
	node: VectorNode | undefined,
	motion: MotionDocument,
	frame: number,
): readonly TimelineNodeRow[] {
	if (!node) return [];
	const currentFrame = snapTimelineFrame(frame, motion.durationFrames);
	const rows: TimelineNodeRow[] = TIMELINE_SCALAR_PROPERTIES.map((property) => {
		const track = findTrack(motion, node.id, property);
		const keyframes = numericKeyframes(track);
		return {
			id: `${node.id}:${property}`,
			nodeId: node.id,
			nodeName: node.name,
			property,
			label: PROPERTY_LABEL[property],
			trackId: track?.id ?? null,
			keyframes,
			currentFrame,
			valueAtFrame: timelineValueForProperty(
				node,
				motion,
				currentFrame,
				property,
			),
			hasKeyAtCurrentFrame: keyframes.some(
				(keyframe) => keyframe.time === currentFrame,
			),
		};
	});
	// Corner channels are scalar but only roundable primitives expose them, so they
	// are appended conditionally instead of living in the unconditional list.
	const cornerNode = node;
	const pushCornerRow = (property: TimelineScalarRowProperty): void => {
		const track = findTrack(motion, cornerNode.id, property);
		const keyframes = numericKeyframes(track);
		rows.push({
			id: `${cornerNode.id}:${property}`,
			nodeId: cornerNode.id,
			nodeName: cornerNode.name,
			property,
			label: PROPERTY_LABEL[property],
			trackId: track?.id ?? null,
			keyframes,
			currentFrame,
			valueAtFrame: timelineValueForProperty(
				cornerNode,
				motion,
				currentFrame,
				property,
			),
			hasKeyAtCurrentFrame: keyframes.some(
				(keyframe) => keyframe.time === currentFrame,
			),
		});
	};
	if (ROUNDABLE_KINDS.has(node.geometry.kind)) {
		pushCornerRow("cornerRadius");
		// Per-corner rows appear only for a rect already in per-corner mode (rest
		// geometry has cornerRadii, or a per-corner channel exists) — keyed off
		// channel/rest presence, never the per-frame sampled value, so they don't
		// flicker as the playhead moves.
		if (node.geometry.kind === "rect") {
			const hasPerCorner =
				node.geometry.cornerRadii !== undefined ||
				PER_CORNER_ROW_PROPERTIES.some((property) =>
					Boolean(findTrack(motion, node.id, property)?.keyframes.length),
				);
			if (hasPerCorner) {
				for (const property of PER_CORNER_ROW_PROPERTIES)
					pushCornerRow(property);
			}
		}
		pushCornerRow("cornerSmoothing");
	}
	const mesh = node.style.fills?.[0];
	if (mesh?.kind === "mesh-gradient") {
		const property = "meshPaint";
		const track = findTrack(motion, node.id, property);
		const keyframes = meshPaintKeyframes(track);
		rows.push({
			id: `${node.id}:${property}`,
			nodeId: node.id,
			nodeName: node.name,
			property,
			label: PROPERTY_LABEL[property],
			trackId: track?.id ?? null,
			keyframes,
			currentFrame,
			valueAtFrame: effectiveMesh(node, motion, currentFrame) ?? mesh,
			hasKeyAtCurrentFrame: keyframes.some(
				(keyframe) => keyframe.time === currentFrame,
			),
		});
	}
	if (node.geometry.kind !== "path") return rows;
	const property = "pathShape";
	const track = findTrack(motion, node.id, property);
	const keyframes = pathShapeKeyframes(track);
	const valueAtFrame = pathShapeAtFrame(node, motion, currentFrame);
	if (!valueAtFrame) return rows;
	return [
		...rows,
		{
			id: `${node.id}:${property}`,
			nodeId: node.id,
			nodeName: node.name,
			property,
			label: PROPERTY_LABEL[property],
			trackId: track?.id ?? null,
			keyframes,
			currentFrame,
			valueAtFrame,
			hasKeyAtCurrentFrame: keyframes.some(
				(keyframe) => keyframe.time === currentFrame,
			),
		},
	];
}

const validTextAnimatorOffsetKeyframes = (
	binding: TextAnimatorBinding,
	selectorIndex: number,
): readonly AeKeyframe<number>[] => {
	const selector = binding.selectors[selectorIndex];
	if (!selector) return [];
	return [...(selector.offsetKeyframes ?? [])]
		.filter(
			(keyframe) =>
				Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
		)
		.sort((left, right) => left.time - right.time);
};

/**
 * Projects one selected node's Text Animator binding as a compact parent lane
 * with one Offset row per selector. It never creates node or fragment tracks.
 */
export function buildTimelineTextAnimatorLaneForNode(
	node: VectorNode | undefined,
	motion: MotionDocument,
	frame: number,
): TimelineTextAnimatorLane | null {
	if (!node) return null;
	const binding = motion.textAnimators?.find(
		(candidate) => candidate.target.nodeId === node.id,
	);
	if (!binding) return null;
	if (
		(binding.target.kind === "live-text" && node.geometry.kind !== "text") ||
		(binding.target.kind === "outline-group" && !node.textFragmentGroup)
	) {
		return null;
	}
	const currentFrame = snapTimelineFrame(frame, motion.durationFrames);
	return {
		kind: "text-animator",
		id: `text-animator:${binding.id}`,
		bindingId: binding.id,
		bindingName: binding.name,
		nodeId: node.id,
		nodeName: node.name,
		targetKind: binding.target.kind,
		enabled: binding.enabled,
		clip: binding.clip,
		rows: binding.selectors.map((selector, selectorIndex) => {
			const keyframes = validTextAnimatorOffsetKeyframes(
				binding,
				selectorIndex,
			);
			return {
				kind: "text-animator-offset",
				id: `text-animator:${binding.id}:selector:${selectorIndex}:offset`,
				bindingId: binding.id,
				selectorIndex,
				nodeId: node.id,
				nodeName: node.name,
				property: "offset",
				label: "Offset",
				units: selector.units,
				trackId: null,
				keyframes,
				currentFrame,
				valueAtFrame: textAnimatorOffsetAtFrame(selector, currentFrame),
				hasKeyAtCurrentFrame: keyframes.some(
					(keyframe) => keyframe.time === currentFrame,
				),
			};
		}),
	};
}

const SOURCE_OPTICS_PARAMETER_LABELS: Readonly<Record<string, string>> = {
	"source-optics.bloom.radius-x": "Bloom X",
	"source-optics.bloom.radius-y": "Bloom Y",
	"source-optics.bloom.intensity": "Bloom",
	"source-optics.bloom.threshold": "Threshold",
	"source-optics.ray.angle": "Ray Angle",
	"source-optics.ray.length": "Ray Length",
	"source-optics.ray.width": "Ray Width",
	"source-optics.ray.intensity": "Ray Intensity",
	"source-optics.ray.falloff": "Ray Falloff",
	"source-optics.ray.opposite-side-ratio": "Ray Opposite",
	"source-optics.atmosphere.mix": "Atmosphere",
	"source-optics.atmosphere.falloff": "Atmosphere Falloff",
	"source-optics.atmosphere.reach": "Atmosphere Reach",
	"source-optics.lens.mix": "Lens",
	"source-optics.lens.chroma": "Lens Chroma",
	"source-optics.lens.reach": "Lens Reach",
	"source-optics.surface.amount": "Surface",
	"source-optics.surface.width": "Surface Width",
	"source-optics.surface.softness": "Surface Softness",
	"source-optics.diffusion.amount": "Diffusion",
	"source-optics.diffusion.depth": "Diffusion Depth",
	"source-optics.diffusion.softness": "Diffusion Softness",
	"source-optics.edge.amount": "Edge",
	"source-optics.edge.width": "Edge Width",
	"source-optics.edge.softness": "Edge Softness",
	"source-optics.microstructure.amount": "Texture Mix",
	"source-optics.spectral.amount": "Spectral",
	"source-optics.spectral.offset": "Spectral Offset",
};

const timelineSourceOpticsRow = (
	artboard: Artboard,
	node: VectorNode,
	motion: MotionDocument,
	currentFrame: number,
	target: SourceOpticsParameterTarget,
): TimelineSourceOpticsRow | null => {
	const staticValue = sourceOpticsParameterValue(artboard, target);
	if (staticValue === undefined) return null;
	const track = findSourceOpticsTrack(motion, target);
	const keyframes = track?.keyframes ?? [];
	return {
		kind: "source-optics",
		id: `source-optics:${track?.id ?? JSON.stringify(target)}`,
		nodeId: node.id,
		nodeName: node.name,
		target,
		property: target.parameterId,
		label:
			SOURCE_OPTICS_PARAMETER_LABELS[target.parameterId] ?? target.parameterId,
		trackId: track?.id ?? null,
		keyframes,
		currentFrame,
		valueAtFrame: effectiveSourceOpticsParameter(
			motion,
			target,
			staticValue,
			currentFrame,
		),
		hasKeyAtCurrentFrame: keyframes.some(
			(keyframe) => keyframe.time === currentFrame,
		),
	};
};

/** Projects descriptor-backed Source Optics parameters beneath their real owner node. */
export function buildTimelineRowsForSourceOptics(
	scene: SceneDocument,
	node: VectorNode | undefined,
	motion: MotionDocument,
	frame: number,
): readonly TimelineSourceOpticsRow[] {
	if (!node) return [];
	const artboardId = selectNodeArtboardMapping(scene).byNodeId[node.id];
	const artboard = findArtboardById(scene, artboardId);
	if (!artboard) return [];
	const currentFrame = snapTimelineFrame(frame, motion.durationFrames);
	const targets: SourceOpticsParameterTarget[] = [];
	for (const rig of sourceOpticsRigsForArtboard(artboard)) {
		if (rig.sourceNodeId === node.id) {
			for (const descriptor of SOURCE_OPTICS_PARAMETER_DESCRIPTORS) {
				if (descriptor.owner !== "rig") continue;
				targets.push({
					kind: "rig",
					artboardId: artboard.id,
					rigId: rig.id,
					parameterId: descriptor.id,
				});
			}
			for (const ray of rig.rays ?? []) {
				for (const descriptor of SOURCE_OPTICS_PARAMETER_DESCRIPTORS) {
					if (descriptor.owner !== "ray") continue;
					targets.push({
						kind: "ray",
						artboardId: artboard.id,
						rigId: rig.id,
						rayId: ray.id,
						parameterId: descriptor.id,
					});
				}
			}
		}
		for (const binding of rig.responses) {
			if (binding.targetNodeId !== node.id) continue;
			for (const descriptor of SOURCE_OPTICS_PARAMETER_DESCRIPTORS) {
				if (descriptor.owner !== "response") continue;
				targets.push({
					kind: "binding",
					artboardId: artboard.id,
					rigId: rig.id,
					bindingId: binding.id,
					parameterId: descriptor.id,
				});
			}
		}
	}
	return targets.flatMap((target) => {
		const row = timelineSourceOpticsRow(
			artboard,
			node,
			motion,
			currentFrame,
			target,
		);
		return row ? [row] : [];
	});
}

/**
 * Builds first-class Timeline rows for one authored scene camera. These rows
 * point at `MotionDocument.cameraTracks`, not node-keyed `tracks`, so camera
 * motion remains camera-domain data through retime, easing, and export.
 */
export function buildTimelineRowsForCamera(
	scene: SceneDocument,
	motion: MotionDocument,
	cameraRigId: string | null | undefined,
	frame: number,
): readonly TimelineCameraRow[] {
	if (!cameraRigId) return [];
	const rig = scene.sceneCameras?.find((camera) => camera.id === cameraRigId);
	if (!rig) return [];
	const currentFrame = snapTimelineFrame(frame, motion.durationFrames);
	const artboard = artboardForRig(scene, rig);
	const cameraTrackIndex = createCameraTrackIndex(motion, rig.id);
	const targetBound = Boolean(
		rig.target?.nodeId || rig.target?.parentControllerNodeId,
	);
	const properties: readonly CameraRigAnimatableProperty[] = [
		...TIMELINE_CAMERA_BASE_PROPERTIES.filter(
			(property) => !targetBound || !property.startsWith("target"),
		),
		rig.projection.kind === "perspective" ? "fovDegrees" : "zoom",
	];
	return properties.map((property) => {
		const track = cameraTrackIndex.get(property);
		const keyframes = cameraKeyframes(track);
		return {
			kind: "camera",
			id: `${rig.id}:${property}`,
			cameraRigId: rig.id,
			cameraName: rig.name,
			property,
			label: CAMERA_PROPERTY_LABEL[property],
			trackId: track?.id ?? null,
			keyframes,
			currentFrame,
			valueAtFrame: cameraValueAtFrame(
				track,
				currentFrame,
				cameraRestValue(rig, artboard, property),
			),
			hasKeyAtCurrentFrame: keyframes.some(
				(keyframe) => keyframe.time === currentFrame,
			),
		};
	});
}

/**
 * Builds Timeline rows for every published control of the linked production a
 * selected placement points at. The rows read `MotionDocument.productionControlTracks`
 * and fall back to the Scene link's authored static value, which is exactly the
 * override rule `sampleProductionControlValue` applies at render time — so the
 * number on the lane is the number the renderer uses.
 */
export function buildTimelineRowsForProductionControls(
	scene: SceneDocument,
	node: VectorNode | undefined,
	motion: MotionDocument,
	frame: number,
): readonly TimelineProductionControlRow[] {
	if (node?.geometry.kind !== "image") return [];
	const assetId = node.geometry.assetId;
	const entry = sceneProductionLinks(scene).find(
		(candidate) => candidate.assetId === assetId,
	);
	if (!entry) return [];
	const currentFrame = snapTimelineFrame(frame, motion.durationFrames);
	return entry.link.controls.map((control) => {
		const keyframes = productionControlKeyframes(
			motion,
			entry.link.linkId,
			control.id,
		);
		const staticValue =
			productionControlStaticValue(entry.link, control.id) ??
			control.defaultValue;
		return {
			kind: "production-control",
			id: `${entry.link.linkId}:${control.id}`,
			assetId: entry.assetId,
			linkId: entry.link.linkId,
			controlId: control.id,
			nodeId: node.id,
			nodeName: node.name,
			property: "productionControl",
			label: control.label,
			unit: control.unit,
			trackId:
				keyframes.length > 0
					? productionControlTrackId(entry.link.linkId, control.id)
					: null,
			keyframes,
			currentFrame,
			valueAtFrame: sampleProductionControlValue(
				motion,
				entry.link.linkId,
				control.id,
				currentFrame,
				staticValue,
			),
			hasKeyAtCurrentFrame: keyframes.some(
				(keyframe) => keyframe.time === currentFrame,
			),
		} satisfies TimelineProductionControlRow;
	});
}

/** Resolves a control key address after the command created its track. */
export function selectedTimelineProductionControlKeyForTarget(
	motion: MotionDocument,
	linkId: string,
	controlId: string,
	frame: number,
): SelectedKey | null {
	const snapped = snapTimelineFrame(frame, motion.durationFrames);
	const track = motion.productionControlTracks?.find(
		(candidate) =>
			candidate.target.linkId === linkId &&
			candidate.target.controlId === controlId,
	);
	if (!track?.keyframes.some((keyframe) => keyframe.time === snapped)) {
		return null;
	}
	return {
		kind: "production-control",
		trackId: track.id,
		linkId,
		controlId,
		property: "productionControl",
		frame: snapped,
	};
}

/**
 * Creates the command for adding or replacing the selected row's key at the
 * playhead. The sampled value is read from MotionDocument plus scene rest pose,
 * so re-keying a scrubbed frame preserves what the user sees without writing the
 * scene document.
 */
export function createTimelineKeyframeCommand(
	row: TimelineRow,
	node: VectorNode | undefined,
	motion: MotionDocument,
	frame: number,
): MotionCommand | null {
	if (isTimelineTextAnimatorOffsetRow(row)) {
		return upsertTextAnimatorOffsetKeyframe(
			row.bindingId,
			row.selectorIndex,
			snapTimelineFrame(frame, motion.durationFrames),
			row.valueAtFrame,
		);
	}
	if (isTimelineCameraRow(row)) {
		return upsertCameraRigKeyframe(
			row.cameraRigId,
			row.property,
			snapTimelineFrame(frame, motion.durationFrames),
			row.valueAtFrame,
		);
	}
	if (isTimelineSourceOpticsRow(row)) {
		return upsertSourceOpticsKeyframe(
			row.target,
			snapTimelineFrame(frame, motion.durationFrames),
			row.valueAtFrame,
		);
	}
	if (isTimelineProductionControlRow(row)) {
		return upsertProductionControlKeyframe(
			row.linkId,
			row.controlId,
			snapTimelineFrame(frame, motion.durationFrames),
			row.valueAtFrame,
		);
	}
	if (!node || node.id !== row.nodeId) return null;
	const snapped = snapTimelineFrame(frame, motion.durationFrames);
	if (row.property === "pathShape") {
		const shape = pathShapeAtFrame(node, motion, snapped);
		return createMotionKeyframeCommand({
			node,
			motion,
			currentFrame: snapped,
			property: row.property,
			value: shape ?? undefined,
		});
	}
	if (row.property === "meshPaint") {
		// Deliberately omit an explicit value: the shared authoring command snapshots
		// the durable primary mesh after the user's Inspector/canvas edit, allowing
		// the same button to create or replace the key at this frame.
		return createMotionKeyframeCommand({
			node,
			motion,
			currentFrame: snapped,
			property: row.property,
		});
	}
	return createMotionKeyframeCommand({
		node,
		motion,
		currentFrame: snapped,
		property: row.property,
		value: timelineValueForProperty(node, motion, snapped, row.property),
	});
}

/** Creates the command for removing the row's key at the playhead, if present. */
export function createTimelineRemoveKeyframeCommand(
	row: TimelineRow,
	frame: number,
	durationFrames: number,
): MotionCommand | null {
	const snapped = snapTimelineFrame(frame, durationFrames);
	if (!row.keyframes.some((keyframe) => keyframe.time === snapped)) return null;
	if (isTimelineTextAnimatorOffsetRow(row)) {
		return removeTextAnimatorOffsetKeyframe({
			bindingId: row.bindingId,
			selectorIndex: row.selectorIndex,
			frame: snapped,
		});
	}
	if (!row.trackId) return null;
	if (isTimelineCameraRow(row)) {
		return removeCameraRigKeyframe(row.cameraRigId, row.property, snapped);
	}
	if (isTimelineSourceOpticsRow(row)) {
		return removeSourceOpticsKeyframe(row.target, snapped);
	}
	if (isTimelineProductionControlRow(row)) {
		return removeProductionControlKeyframe(row.linkId, row.controlId, snapped);
	}
	return removeKeyframe(row.trackId, snapped);
}

/** Creates a selected-key address from a visible row at an existing keyframe. */
export function selectedTimelineKeyForRowFrame(
	row: TimelineRow,
	frame: number,
): SelectedKey | null {
	const keyframe = row.keyframes.find((item) => item.time === frame);
	if (!keyframe) return null;
	if (isTimelineTextAnimatorOffsetRow(row)) {
		return {
			kind: "text-animator-offset",
			bindingId: row.bindingId,
			selectorIndex: row.selectorIndex,
			frame: keyframe.time,
		};
	}
	if (!row.trackId) return null;
	if (isTimelineCameraRow(row)) {
		return {
			kind: "camera",
			trackId: row.trackId,
			cameraRigId: row.cameraRigId,
			property: row.property,
			frame: keyframe.time,
		};
	}
	if (isTimelineSourceOpticsRow(row)) {
		return {
			kind: "source-optics",
			trackId: row.trackId,
			nodeId: row.nodeId,
			target: row.target,
			property: row.property,
			frame: keyframe.time,
		};
	}
	if (isTimelineProductionControlRow(row)) {
		return {
			kind: "production-control",
			trackId: row.trackId,
			linkId: row.linkId,
			controlId: row.controlId,
			property: row.property,
			frame: keyframe.time,
		};
	}
	return {
		trackId: row.trackId,
		nodeId: row.nodeId,
		property: row.property,
		frame: keyframe.time,
	};
}

/** Resolves a selector key after the first Timeline write created its array. */
export function selectedTimelineTextAnimatorOffsetKeyForTarget(
	motion: MotionDocument,
	bindingId: string,
	selectorIndex: number,
	frame: number,
): SelectedKey | null {
	const address = {
		bindingId,
		selectorIndex,
		frame: snapTimelineFrame(frame, motion.durationFrames),
	};
	return resolveTextAnimatorOffsetKey(motion, address)
		? { kind: "text-animator-offset", ...address }
		: null;
}

/** Resolves a first Source Optics key after the command created its track. */
export function selectedTimelineSourceOpticsKeyForTarget(
	motion: MotionDocument,
	nodeId: string,
	target: SourceOpticsParameterTarget,
	frame: number,
): SelectedKey | null {
	const snapped = snapTimelineFrame(frame, motion.durationFrames);
	const track = findSourceOpticsTrack(motion, target);
	if (!track?.keyframes.some((keyframe) => keyframe.time === snapped)) {
		return null;
	}
	return {
		kind: "source-optics",
		trackId: track.id,
		nodeId,
		target,
		property: target.parameterId,
		frame: snapped,
	};
}

/** Creates a selected-key address for a camera channel after a first key write. */
export function selectedTimelineCameraKeyForTarget(
	motion: MotionDocument,
	cameraRigId: string,
	property: CameraRigAnimatableProperty,
	frame: number,
): SelectedKey | null {
	const snapped = snapTimelineFrame(frame, motion.durationFrames);
	const track = findCameraTrack(motion, cameraRigId, property);
	if (!track?.keyframes.some((keyframe) => keyframe.time === snapped)) {
		return null;
	}
	return {
		kind: "camera",
		trackId: track.id,
		cameraRigId,
		property,
		frame: snapped,
	};
}

/**
 * Resolves a selected-key address from the motion side-car after a command has
 * run. This is used when adding the first key for a row whose track did not
 * exist before the command created it.
 */
export function selectedTimelineKeyForTarget(
	motion: MotionDocument,
	nodeId: string,
	property: AnimatableProperty,
	frame: number,
): SelectedKey | null {
	const snapped = snapTimelineFrame(frame, motion.durationFrames);
	const track = findTrack(motion, nodeId, property);
	if (!track?.keyframes.some((keyframe) => keyframe.time === snapped)) {
		return null;
	}
	return { trackId: track.id, nodeId, property, frame: snapped };
}

/**
 * Resolves a selected key against the currently visible rows. Track ids are
 * preferred, but node/property fallback keeps the same user intent selected if a
 * row is rebuilt around a newly created track id.
 */
export function resolveSelectedKeyInRows(
	selectedKey: SelectedKey | null,
	rows: readonly TimelineRow[],
): SelectedKey | null {
	if (!selectedKey) return null;
	if (isTextAnimatorOffsetSelectedKey(selectedKey)) {
		const row = rows.find(
			(candidate) =>
				isTimelineTextAnimatorOffsetRow(candidate) &&
				candidate.bindingId === selectedKey.bindingId &&
				candidate.selectorIndex === selectedKey.selectorIndex &&
				candidate.keyframes.some(
					(keyframe) => keyframe.time === selectedKey.frame,
				),
		);
		return row ? selectedTimelineKeyForRowFrame(row, selectedKey.frame) : null;
	}
	for (const row of rows) {
		const byTrack =
			row.trackId === selectedKey.trackId &&
			row.keyframes.some((keyframe) => keyframe.time === selectedKey.frame);
		if (byTrack) return selectedTimelineKeyForRowFrame(row, selectedKey.frame);
	}
	if (isCameraSelectedKey(selectedKey)) {
		for (const row of rows) {
			const byTarget =
				isTimelineCameraRow(row) &&
				row.cameraRigId === selectedKey.cameraRigId &&
				row.property === selectedKey.property &&
				row.keyframes.some((keyframe) => keyframe.time === selectedKey.frame);
			if (byTarget)
				return selectedTimelineKeyForRowFrame(row, selectedKey.frame);
		}
		return null;
	}
	if (isSourceOpticsSelectedKey(selectedKey)) {
		for (const row of rows) {
			const byTarget =
				isTimelineSourceOpticsRow(row) &&
				row.nodeId === selectedKey.nodeId &&
				row.property === selectedKey.property &&
				row.keyframes.some((keyframe) => keyframe.time === selectedKey.frame);
			if (byTarget) {
				return selectedTimelineKeyForRowFrame(row, selectedKey.frame);
			}
		}
		return null;
	}
	if (isProductionControlSelectedKey(selectedKey)) {
		for (const row of rows) {
			const byTarget =
				isTimelineProductionControlRow(row) &&
				row.linkId === selectedKey.linkId &&
				row.controlId === selectedKey.controlId &&
				row.keyframes.some((keyframe) => keyframe.time === selectedKey.frame);
			if (byTarget) {
				return selectedTimelineKeyForRowFrame(row, selectedKey.frame);
			}
		}
		return null;
	}
	if (!isNodeSelectedKey(selectedKey)) return null;
	for (const row of rows) {
		const byTarget =
			!isTimelineCameraRow(row) &&
			!isTimelineSourceOpticsRow(row) &&
			!isTimelineTextAnimatorOffsetRow(row) &&
			row.nodeId === selectedKey.nodeId &&
			row.property === selectedKey.property &&
			row.keyframes.some((keyframe) => keyframe.time === selectedKey.frame);
		if (byTarget) return selectedTimelineKeyForRowFrame(row, selectedKey.frame);
	}
	return null;
}

/**
 * Resolves a selected-key address against live MotionDocument state. The track
 * target is authoritative, so stale node/property metadata from an older row
 * cannot leak into the easing editor after rows are rebuilt.
 */
export function resolveSelectedKeyInMotion(
	motion: MotionDocument,
	selectedKey: SelectedKey | null,
): SelectedKey | null {
	if (!selectedKey) return null;
	if (isTextAnimatorOffsetSelectedKey(selectedKey)) {
		return resolveTextAnimatorOffsetKey(motion, selectedKey)
			? selectedKey
			: null;
	}
	if (isCameraSelectedKey(selectedKey)) {
		const track = motion.cameraTracks?.find(
			(item) => item.id === selectedKey.trackId,
		);
		if (!track) return null;
		const keyframe = track.keyframes.find(
			(item) => item.time === selectedKey.frame,
		);
		if (!keyframe) return null;
		return {
			kind: "camera",
			trackId: track.id,
			cameraRigId: track.target.cameraRigId,
			property: track.target.property,
			frame: keyframe.time,
		};
	}
	if (isSourceOpticsSelectedKey(selectedKey)) {
		const track = motion.sourceOpticsTracks?.find(
			(item) => item.id === selectedKey.trackId,
		);
		if (!track) return null;
		const keyframe = track.keyframes.find(
			(item) => item.time === selectedKey.frame,
		);
		if (!keyframe) return null;
		return {
			kind: "source-optics",
			trackId: track.id,
			nodeId: selectedKey.nodeId,
			target: track.target,
			property: track.target.parameterId,
			frame: keyframe.time,
		};
	}
	if (isProductionControlSelectedKey(selectedKey)) {
		const track = motion.productionControlTracks?.find(
			(item) => item.id === selectedKey.trackId,
		);
		if (!track) return null;
		const keyframe = track.keyframes.find(
			(item) => item.time === selectedKey.frame,
		);
		if (!keyframe) return null;
		return {
			kind: "production-control",
			trackId: track.id,
			linkId: track.target.linkId,
			controlId: track.target.controlId,
			property: "productionControl",
			frame: keyframe.time,
		};
	}
	if (!isNodeSelectedKey(selectedKey)) return null;
	const track = motion.tracks.find((item) => item.id === selectedKey.trackId);
	if (!track) return null;
	const keyframe = track.keyframes.find(
		(item) => item.time === selectedKey.frame,
	);
	if (!keyframe) return null;
	return {
		trackId: track.id,
		nodeId: track.target.nodeId,
		property: track.target.property,
		frame: keyframe.time,
	};
}

/**
 * Builds the selected-key address after a retime command has run. A collision is
 * considered failed if the source frame still exists, preventing the UI from
 * selecting the key that blocked the move.
 */
export function retimedSelectedKeyInMotion(
	motion: MotionDocument,
	selectedKey: SelectedKey,
	targetFrame: number,
): SelectedKey | null {
	const snapped = snapTimelineFrame(targetFrame, motion.durationFrames);
	if (snapped === selectedKey.frame) return selectedKey;
	if (isTextAnimatorOffsetSelectedKey(selectedKey)) {
		const selector = motion.textAnimators?.find(
			(binding) => binding.id === selectedKey.bindingId,
		)?.selectors[selectedKey.selectorIndex];
		if (!selector) return null;
		const moved = selector.offsetKeyframes?.some(
			(keyframe) => keyframe.time === snapped,
		);
		const sourceStillExists = selector.offsetKeyframes?.some(
			(keyframe) => keyframe.time === selectedKey.frame,
		);
		if (!moved || sourceStillExists) return null;
		return { ...selectedKey, frame: snapped };
	}
	if (isCameraSelectedKey(selectedKey)) {
		const track = motion.cameraTracks?.find(
			(item) => item.id === selectedKey.trackId,
		);
		if (!track) return null;
		const moved = track.keyframes.some((keyframe) => keyframe.time === snapped);
		const sourceStillExists = track.keyframes.some(
			(keyframe) => keyframe.time === selectedKey.frame,
		);
		if (!moved || sourceStillExists) return null;
		return { ...selectedKey, frame: snapped };
	}
	if (isSourceOpticsSelectedKey(selectedKey)) {
		const track = motion.sourceOpticsTracks?.find(
			(item) => item.id === selectedKey.trackId,
		);
		if (!track) return null;
		const moved = track.keyframes.some((keyframe) => keyframe.time === snapped);
		const sourceStillExists = track.keyframes.some(
			(keyframe) => keyframe.time === selectedKey.frame,
		);
		if (!moved || sourceStillExists) return null;
		return { ...selectedKey, target: track.target, frame: snapped };
	}
	if (isProductionControlSelectedKey(selectedKey)) {
		const track = motion.productionControlTracks?.find(
			(item) => item.id === selectedKey.trackId,
		);
		if (!track) return null;
		const moved = track.keyframes.some((keyframe) => keyframe.time === snapped);
		const sourceStillExists = track.keyframes.some(
			(keyframe) => keyframe.time === selectedKey.frame,
		);
		if (!moved || sourceStillExists) return null;
		return { ...selectedKey, frame: snapped };
	}
	if (!isNodeSelectedKey(selectedKey)) return null;
	const track = motion.tracks.find((item) => item.id === selectedKey.trackId);
	if (!track) return null;
	const moved = track.keyframes.some((keyframe) => keyframe.time === snapped);
	const sourceStillExists = track.keyframes.some(
		(keyframe) => keyframe.time === selectedKey.frame,
	);
	if (!moved || sourceStillExists) return null;
	return { ...selectedKey, frame: snapped };
}

/** True when the selected key still belongs to one of the visible timeline rows. */
export function selectedKeyExistsInRows(
	selectedKey: SelectedKey | null,
	rows: readonly TimelineRow[],
): boolean {
	return (
		selectedKey === null || resolveSelectedKeyInRows(selectedKey, rows) !== null
	);
}
