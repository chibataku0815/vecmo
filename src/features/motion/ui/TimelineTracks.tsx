import {
	CaretDown,
	CaretRight,
	GitBranch,
	Plus,
	Stack,
	TextT,
	Trash,
	WaveSine,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	removeCameraCutSegment,
	removeCameraRigKeyframe,
	retimeCameraCutSegment,
	setCameraRigKeyframeTime,
	upsertCameraCutSegment,
} from "@/entities/motion/model/camera-commands";
import {
	removeKeyframe,
	removeSourceOpticsKeyframe,
	removeTextAnimatorOffsetKeyframe,
	setKeyframeTime,
	setSourceOpticsKeyframeTime,
	setTextAnimatorOffsetKeyframeTime,
} from "@/entities/motion/model/commands";
import {
	applyInMotionTransaction,
	beginMotionTransaction,
	commitMotionTransaction,
	type MotionGestureTransaction,
} from "@/entities/motion/model/gesture-transaction";
import { setProductionControlKeyframeTime } from "@/entities/motion/model/production-control-commands";
import { useMotionStore } from "@/entities/motion/model/store";
import type { CameraCutSegment } from "@/entities/motion/model/types";
import {
	findNode,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneCameraRigContract } from "@/entities/scene/model/types";
import {
	localShortcutScopeValue,
	shortcutMatchesEvent,
} from "@/shared/actions";
import { cn } from "@/shared/lib/cn";
import { createId } from "@/shared/lib/id";
import { frameFromClientX } from "@/shared/lib/timeline-scrub";
import { useAuthoringTransportFrame } from "../model/authoring-frame";
import {
	CAMERA_CUT_LOCAL_SHORTCUTS,
	CAMERA_CUT_SHORTCUTS,
} from "../model/timeline-shortcuts";
import { useTransportStore } from "../model/transport-store";
import { TimelinePlayheadLine } from "./TimelinePlayhead";
import {
	buildTimelineRowsForCamera,
	buildTimelineRowsForNode,
	buildTimelineRowsForProductionControls,
	buildTimelineRowsForSourceOptics,
	buildTimelineTextAnimatorLaneForNode,
	createTimelineKeyframeCommand,
	createTimelineRemoveKeyframeCommand,
	isCameraSelectedKey,
	isNodeSelectedKey,
	isProductionControlSelectedKey,
	isSourceOpticsSelectedKey,
	isTextAnimatorOffsetSelectedKey,
	isTimelineCameraRow,
	isTimelineProductionControlRow,
	isTimelineSourceOpticsRow,
	isTimelineTextAnimatorOffsetRow,
	resolveSelectedKeyInRows,
	retimedSelectedKeyInMotion,
	selectedTimelineCameraKeyForTarget,
	selectedTimelineKeyForRowFrame,
	selectedTimelineKeyForTarget,
	selectedTimelineProductionControlKeyForTarget,
	selectedTimelineSourceOpticsKeyForTarget,
	selectedTimelineTextAnimatorOffsetKeyForTarget,
	snapTimelineFrame,
	type TimelineRow,
} from "./timeline-adapter";
import {
	adjacentTimelineKey,
	retimedTimelineSelectedKeyFrame,
	timelineKeyKeyboardAction,
} from "./timeline-keyboard";
import {
	type CameraSelectedKey,
	frameToPercent,
	type NodeSelectedKey,
	type SelectedKey,
	type SourceOpticsSelectedKey,
	type TextAnimatorOffsetSelectedKey,
} from "./timeline-model";
import { useTimelineScrub } from "./use-timeline-scrub";

type TimelineTracksProps = {
	readonly primaryNodeId: string | null;
	readonly selectedCameraRigId: string | null;
	readonly selectedKey: SelectedKey | null;
	readonly onSelectKey: (
		key: SelectedKey | null,
		options?: { readonly deferTextAnimatorGraph?: boolean },
	) => void;
};

type DragState =
	| {
			readonly kind: "camera-cut";
			readonly segmentId: string;
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "camera-cut-edge";
			readonly segmentId: string;
			readonly edge: "start" | "end";
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "camera";
			readonly trackId: string;
			readonly cameraRigId: string;
			readonly property: CameraSelectedKey["property"];
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "source-optics";
			readonly trackId: string;
			readonly nodeId: string;
			readonly target: SourceOpticsSelectedKey["target"];
			readonly property: string;
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "production-control";
			readonly trackId: string;
			readonly linkId: string;
			readonly controlId: string;
			readonly property: "productionControl";
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind: "text-animator-offset";
			readonly bindingId: string;
			readonly selectorIndex: number;
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  }
	| {
			readonly kind?: "node";
			readonly trackId: string;
			readonly nodeId: string;
			readonly property: NodeSelectedKey["property"];
			frame: number;
			readonly transaction: MotionGestureTransaction;
	  };

const formatRowValue = (row: TimelineRow): string => {
	if (isTimelineTextAnimatorOffsetRow(row)) {
		const value = Number.isInteger(row.valueAtFrame)
			? String(row.valueAtFrame)
			: row.valueAtFrame.toFixed(2);
		return row.units === "percent" ? `${value}%` : value;
	}
	if (
		!isTimelineCameraRow(row) &&
		!isTimelineSourceOpticsRow(row) &&
		row.property === "pathShape"
	) {
		return `${row.valueAtFrame.vertices.length} pts`;
	}
	if (
		!isTimelineCameraRow(row) &&
		!isTimelineSourceOpticsRow(row) &&
		row.property === "meshPaint"
	) {
		return `${row.valueAtFrame.rows}×${row.valueAtFrame.cols}`;
	}
	if (row.property === "opacity")
		return `${Math.round(row.valueAtFrame * 100)}%`;
	if (Number.isInteger(row.valueAtFrame)) return String(row.valueAtFrame);
	return row.valueAtFrame.toFixed(2);
};

const selectedKeysEqual = (
	a: SelectedKey | null,
	b: SelectedKey | null,
): boolean => {
	if (!a || !b) return a === b;
	if (
		isTextAnimatorOffsetSelectedKey(a) ||
		isTextAnimatorOffsetSelectedKey(b)
	) {
		return (
			isTextAnimatorOffsetSelectedKey(a) &&
			isTextAnimatorOffsetSelectedKey(b) &&
			a.bindingId === b.bindingId &&
			a.selectorIndex === b.selectorIndex &&
			a.frame === b.frame
		);
	}
	if (
		a.trackId !== b.trackId ||
		a.property !== b.property ||
		a.frame !== b.frame
	) {
		return false;
	}
	if (isCameraSelectedKey(a) || isCameraSelectedKey(b)) {
		return (
			isCameraSelectedKey(a) &&
			isCameraSelectedKey(b) &&
			a.cameraRigId === b.cameraRigId
		);
	}
	if (isSourceOpticsSelectedKey(a) || isSourceOpticsSelectedKey(b)) {
		return (
			isSourceOpticsSelectedKey(a) &&
			isSourceOpticsSelectedKey(b) &&
			a.nodeId === b.nodeId
		);
	}
	if (!isNodeSelectedKey(a) || !isNodeSelectedKey(b)) return false;
	return a.nodeId === b.nodeId;
};

const selectedKeyTargetsRowFrame = (
	key: SelectedKey | null,
	row: TimelineRow,
	frame: number,
): boolean =>
	key !== null &&
	key.frame === frame &&
	(isTimelineTextAnimatorOffsetRow(row)
		? isTextAnimatorOffsetSelectedKey(key) &&
			key.bindingId === row.bindingId &&
			key.selectorIndex === row.selectorIndex
		: (!isTextAnimatorOffsetSelectedKey(key) && key.trackId === row.trackId) ||
			(isTimelineCameraRow(row)
				? isCameraSelectedKey(key) &&
					key.cameraRigId === row.cameraRigId &&
					key.property === row.property
				: isTimelineSourceOpticsRow(row)
					? isSourceOpticsSelectedKey(key) &&
						key.nodeId === row.nodeId &&
						key.property === row.property
					: isNodeSelectedKey(key) &&
						key.nodeId === row.nodeId &&
						key.property === row.property));

const rowSubjectName = (row: TimelineRow): string =>
	isTimelineCameraRow(row)
		? row.cameraName
		: isTimelineTextAnimatorOffsetRow(row)
			? `Selector ${row.selectorIndex + 1}`
			: row.nodeName;

const cameraRigScopesArtboard = (
	camera: Pick<SceneCameraRigContract, "scope">,
	artboardId: string,
): boolean => {
	return (
		camera.scope.kind === "scene" ||
		(camera.scope.kind === "artboard" && camera.scope.artboardId === artboardId)
	);
};

const cameraCutAtFrame = (
	segments: readonly CameraCutSegment[],
	frame: number,
): CameraCutSegment | undefined => {
	let winner: CameraCutSegment | undefined;
	for (const segment of segments) {
		if (
			frame < segment.startFrame ||
			frame >= segment.startFrame + segment.durationFrames
		) {
			continue;
		}
		if (
			!winner ||
			segment.startFrame > winner.startFrame ||
			(segment.startFrame === winner.startFrame &&
				segment.durationFrames > winner.durationFrames)
		) {
			winner = segment;
		}
	}
	return winner;
};

const nextCameraCutAfterFrame = (
	segments: readonly CameraCutSegment[],
	frame: number,
): CameraCutSegment | undefined => {
	let winner: CameraCutSegment | undefined;
	for (const segment of segments) {
		if (segment.startFrame <= frame) continue;
		if (!winner || segment.startFrame < winner.startFrame) {
			winner = segment;
		}
	}
	return winner;
};

const CAMERA_CUT_LANE_HEIGHT = 28;
const CAMERA_CUT_CONTROL_BUTTON_CLASS =
	"grid size-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-accent/50 hover:text-accent-fg";
const CAMERA_CUT_CONTROL_DISABLED_CLASS =
	"cursor-not-allowed opacity-35 hover:border-white/10 hover:text-fg-secondary";
const CAMERA_CUT_MODE_BUTTON_CLASS =
	"inline-flex h-6 min-w-0 shrink-0 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.035] px-1.5 text-fg-secondary text-ui transition hover:border-accent/50 hover:text-accent-fg";

const defaultCameraCutCrossfadeDurationFrames = (fps: number): number =>
	Math.max(2, Math.round((Number.isFinite(fps) ? fps : 24) / 4));

const clampCameraCutCrossfadeDuration = (
	value: number,
	segmentDurationFrames: number,
	fps: number,
): number => {
	const rounded = Number.isFinite(value)
		? Math.round(value)
		: defaultCameraCutCrossfadeDurationFrames(fps);
	return Math.min(Math.max(1, rounded), Math.max(1, segmentDurationFrames));
};

const cameraCutKeyboardStepFrames = (
	event: React.KeyboardEvent,
	fps: number,
): number => (event.shiftKey ? Math.max(1, Math.round(fps)) : 1);

const cameraCutLaneTop = (laneIndex: number, headerHeight: number): number =>
	laneIndex === 0
		? 4
		: headerHeight + (laneIndex - 1) * CAMERA_CUT_LANE_HEIGHT + 4;

const cameraCutLaneVisualTop = (
	laneIndex: number,
	headerHeight: number,
): number =>
	laneIndex === 0 ? 0 : headerHeight + (laneIndex - 1) * CAMERA_CUT_LANE_HEIGHT;

const cameraCutLaneVisualHeight = (
	laneIndex: number,
	headerHeight: number,
): number => (laneIndex === 0 ? headerHeight : CAMERA_CUT_LANE_HEIGHT);

const cameraCutLaneId = (segment: CameraCutSegment): string =>
	segment.laneId?.trim() || segment.cameraRigId;

const cameraCutTransitionLabel = (
	segment: CameraCutSegment,
	fps: number,
): string => {
	if (segment.transition !== "crossfade") return "Cut";
	const duration =
		segment.transitionDurationFrames ??
		defaultCameraCutCrossfadeDurationFrames(fps);
	return `Xfade ${duration}f`;
};

const cameraCutDisplayName = (
	segment: CameraCutSegment,
	cameraName: string | undefined,
): string => segment.name?.trim() || cameraName || segment.cameraRigId;

const cameraCutInitials = (label: string): string =>
	label
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("") || "C";

const cameraCutLaneSortTuple = (
	laneId: string,
	selectedCameraRigId: string | null,
): readonly [number, number, string] => {
	const laneMatch = /^lane-(\d+)$/u.exec(laneId);
	if (selectedCameraRigId && laneId === selectedCameraRigId) {
		return [0, 0, laneId];
	}
	if (laneMatch) return [1, Number(laneMatch[1]), laneId];
	return [2, 0, laneId];
};

const compareCameraCutLaneIds =
	(selectedCameraRigId: string | null) =>
	(left: string, right: string): number => {
		const leftTuple = cameraCutLaneSortTuple(left, selectedCameraRigId);
		const rightTuple = cameraCutLaneSortTuple(right, selectedCameraRigId);
		return (
			leftTuple[0] - rightTuple[0] ||
			leftTuple[1] - rightTuple[1] ||
			leftTuple[2].localeCompare(rightTuple[2])
		);
	};

const cameraCutLaneIds = (
	segments: readonly CameraCutSegment[],
	selectedCameraRigId: string | null,
): readonly string[] => {
	const ids = new Set<string>();
	for (const segment of segments) ids.add(cameraCutLaneId(segment));
	if (selectedCameraRigId) ids.add(selectedCameraRigId);
	return [...ids].sort(compareCameraCutLaneIds(selectedCameraRigId));
};

const cameraCutLaneLabel = (
	laneId: string,
	selectedCameraRigId: string | null,
	cameraName: string | undefined,
): string => {
	if (selectedCameraRigId && laneId === selectedCameraRigId) return "Primary";
	const laneMatch = /^lane-(\d+)$/u.exec(laneId);
	if (laneMatch) return `Lane ${laneMatch[1]}`;
	return cameraName ?? "Lane";
};

const cameraCutHasCollision = (
	segments: readonly CameraCutSegment[],
	segment: CameraCutSegment,
): boolean => {
	const laneId = cameraCutLaneId(segment);
	const start = segment.startFrame;
	const end = segment.startFrame + segment.durationFrames;
	return segments.some((candidate) => {
		if (candidate.id === segment.id || cameraCutLaneId(candidate) !== laneId) {
			return false;
		}
		const candidateStart = candidate.startFrame;
		const candidateEnd = candidate.startFrame + candidate.durationFrames;
		return start < candidateEnd && end > candidateStart;
	});
};

export function TimelineTracks({
	primaryNodeId,
	selectedCameraRigId,
	selectedKey,
	onSelectKey,
}: TimelineTracksProps) {
	const motion = useMotionStore((state) => state.document);
	const scene = useSceneStore((state) => state.document);
	const currentFrame = useAuthoringTransportFrame();
	const durationFrames = motion.durationFrames;
	const fps = motion.fps;
	const selectedNode = findNode(scene, primaryNodeId);
	const currentArtboard = selectCurrentArtboard(scene);
	const sceneCameras = scene.sceneCameras ?? [];
	const sceneCameraById = new Map(
		sceneCameras.map((camera) => [camera.id, camera]),
	);
	const selectedCameraRig = selectedCameraRigId
		? sceneCameraById.get(selectedCameraRigId)
		: undefined;
	const selectedCameraScopesCurrentArtboard = selectedCameraRig
		? cameraRigScopesArtboard(selectedCameraRig, currentArtboard.id)
		: false;
	const artboardCameraCuts =
		motion.cameraCuts?.filter(
			(segment) => segment.artboardId === currentArtboard.id,
		) ?? [];
	const currentCameraCut = cameraCutAtFrame(artboardCameraCuts, currentFrame);
	const currentCameraCutCrossfadeDuration =
		currentCameraCut?.transition === "crossfade"
			? clampCameraCutCrossfadeDuration(
					currentCameraCut.transitionDurationFrames ??
						defaultCameraCutCrossfadeDurationFrames(fps),
					currentCameraCut.durationFrames,
					fps,
				)
			: 0;
	const cameraCutLanes = useMemo(
		() => cameraCutLaneIds(artboardCameraCuts, selectedCameraRigId),
		[artboardCameraCuts, selectedCameraRigId],
	);
	const compactCameraCutLane =
		sceneCameras.length === 1 && artboardCameraCuts.length === 0;
	const cameraCutHeaderHeight =
		CAMERA_CUT_LANE_HEIGHT * (compactCameraCutLane ? 1 : 2);
	const cameraCutLaneHeight =
		cameraCutHeaderHeight +
		Math.max(0, cameraCutLanes.length - 1) * CAMERA_CUT_LANE_HEIGHT;
	const currentCameraCutHasCollision = currentCameraCut
		? cameraCutHasCollision(artboardCameraCuts, currentCameraCut)
		: false;
	const cameraCutCollisionCount = artboardCameraCuts.filter((segment) =>
		cameraCutHasCollision(artboardCameraCuts, segment),
	).length;
	const showCameraCutLane =
		selectedCameraRigId !== null && selectedCameraScopesCurrentArtboard;
	const textAnimatorLane = selectedCameraRigId
		? null
		: buildTimelineTextAnimatorLaneForNode(selectedNode, motion, currentFrame);
	const [expandedTextAnimatorId, setExpandedTextAnimatorId] = useState<
		string | null
	>(null);
	const textAnimatorExpanded = Boolean(
		textAnimatorLane &&
			(expandedTextAnimatorId === textAnimatorLane.bindingId ||
				(isTextAnimatorOffsetSelectedKey(selectedKey) &&
					selectedKey.bindingId === textAnimatorLane.bindingId)),
	);
	const rows = selectedCameraRigId
		? buildTimelineRowsForCamera(
				scene,
				motion,
				selectedCameraRigId,
				currentFrame,
			)
		: [
				...(textAnimatorExpanded ? (textAnimatorLane?.rows ?? []) : []),
				...buildTimelineRowsForNode(selectedNode, motion, currentFrame),
				...buildTimelineRowsForSourceOptics(
					scene,
					selectedNode,
					motion,
					currentFrame,
				),
				// Published controls of a linked production hang off the placement the
				// user selected; the rows themselves stay addressed by link + control
				// id, so the lane never claims a node owns the control.
				...buildTimelineRowsForProductionControls(
					scene,
					selectedNode,
					motion,
					currentFrame,
				),
			];
	const textAnimatorClip = textAnimatorLane?.clip;
	const textAnimatorClipLeft = textAnimatorClip
		? Math.min(
				100,
				Math.max(
					0,
					frameToPercent(textAnimatorClip.startFrame, durationFrames),
				),
			)
		: 0;
	const textAnimatorClipWidth = textAnimatorClip
		? Math.max(
				1,
				Math.min(
					100 - textAnimatorClipLeft,
					frameToPercent(textAnimatorClip.durationFrames, durationFrames),
				),
			)
		: 0;

	const laneRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const scrub = useTimelineScrub({
		laneRef,
		durationFrames,
		isOtherGestureActive: () => dragRef.current !== null,
	});

	useLayoutEffect(() => {
		const resolved = resolveSelectedKeyInRows(selectedKey, rows);
		if (!selectedKeysEqual(selectedKey, resolved)) onSelectKey(resolved);
	}, [onSelectKey, rows, selectedKey]);

	useEffect(
		() => () => {
			const drag = dragRef.current;
			if (!drag) return;
			commitMotionTransaction(drag.transaction);
			dragRef.current = null;
		},
		[],
	);

	// One handler drives both gestures: a retime drag (captured to the lane on a
	// diamond press) takes priority over scrubbing. Anchoring on the lane — which
	// never remounts — keeps the drag alive even though the diamond button is keyed
	// by its frame and is replaced on every retime step.
	const onLanePointerMove = (
		event: React.PointerEvent<HTMLDivElement>,
	): void => {
		const drag = dragRef.current;
		if (drag) {
			const lane = laneRef.current;
			if (!lane) return;
			const target = frameFromClientX(
				event.clientX,
				lane.getBoundingClientRect(),
				durationFrames,
				{ round: true },
			);
			if (target === drag.frame) return;
			if (drag.kind === "camera-cut") {
				const segment = useMotionStore
					.getState()
					.document.cameraCuts?.find((item) => item.id === drag.segmentId);
				if (!segment) return;
				const targetStart = Math.max(
					0,
					Math.min(
						target,
						Math.max(0, durationFrames - segment.durationFrames),
					),
				);
				const applied = applyInMotionTransaction(
					drag.transaction,
					retimeCameraCutSegment({
						segmentId: drag.segmentId,
						startFrame: targetStart,
						durationFrames: segment.durationFrames,
					}),
				);
				if (!applied) {
					dragRef.current = null;
					return;
				}
				drag.frame = targetStart;
				return;
			}
			if (drag.kind === "camera-cut-edge") {
				const segment = useMotionStore
					.getState()
					.document.cameraCuts?.find((item) => item.id === drag.segmentId);
				if (!segment) return;
				const endFrame = segment.startFrame + segment.durationFrames;
				const startTarget = Math.max(0, Math.min(target, endFrame - 1));
				const endTarget = Math.min(
					durationFrames,
					Math.max(segment.startFrame + 1, target),
				);
				const command =
					drag.edge === "start"
						? retimeCameraCutSegment({
								segmentId: drag.segmentId,
								startFrame: startTarget,
								durationFrames: Math.max(1, endFrame - startTarget),
							})
						: retimeCameraCutSegment({
								segmentId: drag.segmentId,
								durationFrames: Math.max(1, endTarget - segment.startFrame),
							});
				const applied = applyInMotionTransaction(drag.transaction, command);
				if (!applied) {
					dragRef.current = null;
					return;
				}
				drag.frame = drag.edge === "start" ? startTarget : endTarget;
				return;
			}
			if (drag.kind === "text-animator-offset") {
				const selector = useMotionStore
					.getState()
					.document.textAnimators?.find(
						(binding) => binding.id === drag.bindingId,
					)?.selectors[drag.selectorIndex];
				const keys = selector?.offsetKeyframes;
				if (
					!keys?.some((keyframe) => keyframe.time === drag.frame) ||
					keys.some((keyframe) => keyframe.time === target)
				) {
					return;
				}
				const selectedBefore: TextAnimatorOffsetSelectedKey = {
					kind: "text-animator-offset",
					bindingId: drag.bindingId,
					selectorIndex: drag.selectorIndex,
					frame: drag.frame,
				};
				const applied = applyInMotionTransaction(
					drag.transaction,
					setTextAnimatorOffsetKeyframeTime(
						selectedBefore,
						target,
						drag.transaction.coalesceKey,
					),
				);
				if (!applied) {
					dragRef.current = null;
					return;
				}
				const retimed = retimedSelectedKeyInMotion(
					useMotionStore.getState().document,
					selectedBefore,
					target,
				);
				if (!retimed) return;
				drag.frame = retimed.frame;
				onSelectKey(retimed, { deferTextAnimatorGraph: true });
				return;
			}
			const store = useMotionStore.getState();
			const track =
				drag.kind === "camera"
					? store.document.cameraTracks?.find(
							(item) => item.id === drag.trackId,
						)
					: drag.kind === "source-optics"
						? store.document.sourceOpticsTracks?.find(
								(item) => item.id === drag.trackId,
							)
						: drag.kind === "production-control"
							? store.document.productionControlTracks?.find(
									(item) => item.id === drag.trackId,
								)
							: store.document.tracks.find((item) => item.id === drag.trackId);
			if (!track) return;
			if (track.keyframes.some((keyframe) => keyframe.time === target)) return;
			const selectedBefore: SelectedKey =
				drag.kind === "camera"
					? {
							kind: "camera",
							trackId: drag.trackId,
							cameraRigId: drag.cameraRigId,
							property: drag.property,
							frame: drag.frame,
						}
					: drag.kind === "source-optics"
						? {
								kind: "source-optics",
								trackId: drag.trackId,
								nodeId: drag.nodeId,
								target: drag.target,
								property: drag.property,
								frame: drag.frame,
							}
						: drag.kind === "production-control"
							? {
									kind: "production-control",
									trackId: drag.trackId,
									linkId: drag.linkId,
									controlId: drag.controlId,
									property: drag.property,
									frame: drag.frame,
								}
							: {
									trackId: drag.trackId,
									nodeId: drag.nodeId,
									property: drag.property,
									frame: drag.frame,
								};
			const applied = applyInMotionTransaction(
				drag.transaction,
				drag.kind === "camera"
					? setCameraRigKeyframeTime(
							drag.trackId,
							drag.frame,
							target,
							drag.transaction.coalesceKey,
						)
					: drag.kind === "source-optics"
						? setSourceOpticsKeyframeTime(
								drag.trackId,
								drag.frame,
								target,
								drag.transaction.coalesceKey,
							)
						: drag.kind === "production-control"
							? setProductionControlKeyframeTime(
									drag.trackId,
									drag.frame,
									target,
									drag.transaction.coalesceKey,
								)
							: setKeyframeTime(
									drag.trackId,
									drag.frame,
									target,
									drag.transaction.coalesceKey,
								),
			);
			if (!applied) {
				dragRef.current = null;
				return;
			}
			const retimed = retimedSelectedKeyInMotion(
				useMotionStore.getState().document,
				selectedBefore,
				target,
			);
			if (!retimed) return;
			drag.frame = retimed.frame;
			onSelectKey(retimed);
			return;
		}
		scrub.onScrubPointerMove(event);
	};

	const endLaneGesture = (event: React.PointerEvent<HTMLDivElement>): void => {
		const drag = dragRef.current;
		const textAnimatorSelection =
			drag?.kind === "text-animator-offset"
				? ({
						kind: "text-animator-offset",
						bindingId: drag.bindingId,
						selectorIndex: drag.selectorIndex,
						frame: drag.frame,
					} satisfies TextAnimatorOffsetSelectedKey)
				: null;
		if (drag) {
			commitMotionTransaction(drag.transaction);
			dragRef.current = null;
		}
		scrub.onScrubPointerUp(event);
		if (textAnimatorSelection) onSelectKey(textAnimatorSelection);
	};

	const onDiamondPointerDown = (
		event: React.PointerEvent<HTMLButtonElement>,
		row: TimelineRow,
		frame: number,
	): void => {
		event.stopPropagation();
		const selected = selectedTimelineKeyForRowFrame(row, frame);
		if (!selected) return;
		onSelectKey(selected, {
			deferTextAnimatorGraph: isTextAnimatorOffsetSelectedKey(selected),
		});
		const transaction = beginMotionTransaction(
			"motion-key-retime",
			"Move keyframe",
		);
		if (isTextAnimatorOffsetSelectedKey(selected)) {
			dragRef.current = {
				kind: "text-animator-offset",
				bindingId: selected.bindingId,
				selectorIndex: selected.selectorIndex,
				frame: selected.frame,
				transaction,
			};
		} else if (isCameraSelectedKey(selected)) {
			dragRef.current = {
				kind: "camera",
				trackId: selected.trackId,
				cameraRigId: selected.cameraRigId,
				property: selected.property,
				frame: selected.frame,
				transaction,
			};
		} else if (isSourceOpticsSelectedKey(selected)) {
			dragRef.current = {
				kind: "source-optics",
				trackId: selected.trackId,
				nodeId: selected.nodeId,
				target: selected.target,
				property: selected.property,
				frame: selected.frame,
				transaction,
			};
		} else if (isProductionControlSelectedKey(selected)) {
			dragRef.current = {
				kind: "production-control",
				trackId: selected.trackId,
				linkId: selected.linkId,
				controlId: selected.controlId,
				property: selected.property,
				frame: selected.frame,
				transaction,
			};
		} else if (isNodeSelectedKey(selected)) {
			dragRef.current = {
				kind: "node",
				trackId: selected.trackId,
				nodeId: selected.nodeId,
				property: selected.property,
				frame: selected.frame,
				transaction,
			};
		} else {
			commitMotionTransaction(transaction);
			return;
		}
		laneRef.current?.setPointerCapture(event.pointerId);
	};

	const addOrSplitCameraCut = (): void => {
		if (!selectedCameraRigId || !selectedCameraScopesCurrentArtboard) return;
		const snapped = snapTimelineFrame(currentFrame, durationFrames);
		const store = useMotionStore.getState();
		const storeArtboardCuts =
			store.document.cameraCuts?.filter(
				(segment) => segment.artboardId === currentArtboard.id,
			) ?? [];
		const existing = cameraCutAtFrame(storeArtboardCuts, snapped);
		if (existing?.cameraRigId === selectedCameraRigId) return;
		if (
			existing &&
			snapped > existing.startFrame &&
			snapped < existing.startFrame + existing.durationFrames
		) {
			store.beginTransaction(
				`motion-camera-cut-split:${existing.id}:${snapped}`,
				"Split camera cut",
			);
			store.apply(
				retimeCameraCutSegment({
					segmentId: existing.id,
					durationFrames: snapped - existing.startFrame,
				}),
			);
			store.apply(
				upsertCameraCutSegment({
					id: createId("camera-cut"),
					artboardId: currentArtboard.id,
					cameraRigId: selectedCameraRigId,
					startFrame: snapped,
					durationFrames:
						existing.startFrame + existing.durationFrames - snapped,
					transition: "cut",
				}),
			);
			store.commit();
			return;
		}
		const nextCut = nextCameraCutAfterFrame(storeArtboardCuts, snapped);
		store.apply(
			upsertCameraCutSegment({
				id: existing?.id ?? createId("camera-cut"),
				artboardId: currentArtboard.id,
				cameraRigId: selectedCameraRigId,
				startFrame: existing?.startFrame ?? snapped,
				durationFrames:
					existing?.durationFrames ??
					Math.max(1, (nextCut?.startFrame ?? durationFrames) - snapped),
				transition: "cut",
			}),
		);
	};

	const removeCurrentCameraCut = (): void => {
		if (!currentCameraCut) return;
		useMotionStore
			.getState()
			.apply(removeCameraCutSegment(currentCameraCut.id));
	};

	const updateCameraCut = (
		segment: CameraCutSegment,
		patch: Partial<CameraCutSegment>,
	): void => {
		useMotionStore.getState().apply(
			upsertCameraCutSegment({
				...segment,
				...patch,
			}),
		);
	};

	const renameCurrentCameraCut = (name: string): void => {
		if (!currentCameraCut) return;
		const trimmed = name.trim();
		updateCameraCut(currentCameraCut, { name: trimmed });
	};

	const toggleCurrentCameraCutTransition = (): void => {
		if (!currentCameraCut) return;
		updateCameraCut(
			currentCameraCut,
			currentCameraCut.transition === "crossfade"
				? { transition: "cut", transitionDurationFrames: 0 }
				: {
						transition: "crossfade",
						transitionDurationFrames:
							defaultCameraCutCrossfadeDurationFrames(fps),
					},
		);
	};

	const updateCurrentCameraCutTransitionDuration = (value: string): void => {
		if (currentCameraCut?.transition !== "crossfade") return;
		const parsed = Number(value);
		updateCameraCut(currentCameraCut, {
			transitionDurationFrames: clampCameraCutCrossfadeDuration(
				parsed,
				currentCameraCut.durationFrames,
				fps,
			),
		});
	};

	const moveCurrentCameraCutByFrames = (deltaFrames: number): boolean => {
		if (!currentCameraCut) return false;
		const startFrame = Math.max(
			0,
			Math.min(
				currentCameraCut.startFrame + deltaFrames,
				Math.max(0, durationFrames - currentCameraCut.durationFrames),
			),
		);
		if (startFrame === currentCameraCut.startFrame) return false;
		useMotionStore.getState().apply(
			retimeCameraCutSegment({
				segmentId: currentCameraCut.id,
				startFrame,
				durationFrames: currentCameraCut.durationFrames,
			}),
		);
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(startFrame);
		return true;
	};

	const trimCurrentCameraCutStartByFrames = (deltaFrames: number): boolean => {
		if (!currentCameraCut) return false;
		const endFrame =
			currentCameraCut.startFrame + currentCameraCut.durationFrames;
		const startFrame = Math.max(
			0,
			Math.min(currentCameraCut.startFrame + deltaFrames, endFrame - 1),
		);
		if (startFrame === currentCameraCut.startFrame) return false;
		useMotionStore.getState().apply(
			retimeCameraCutSegment({
				segmentId: currentCameraCut.id,
				startFrame,
				durationFrames: endFrame - startFrame,
			}),
		);
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(startFrame);
		return true;
	};

	const trimCurrentCameraCutEndByFrames = (deltaFrames: number): boolean => {
		if (!currentCameraCut) return false;
		const endFrame = Math.min(
			durationFrames,
			Math.max(
				currentCameraCut.startFrame + 1,
				currentCameraCut.startFrame +
					currentCameraCut.durationFrames +
					deltaFrames,
			),
		);
		const duration = endFrame - currentCameraCut.startFrame;
		if (duration === currentCameraCut.durationFrames) return false;
		useMotionStore.getState().apply(
			retimeCameraCutSegment({
				segmentId: currentCameraCut.id,
				durationFrames: duration,
			}),
		);
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(endFrame - 1);
		return true;
	};

	const moveCurrentCameraCutToNextLane = (): void => {
		if (!currentCameraCut) return;
		const currentLane = cameraCutLaneId(currentCameraCut);
		const numericLanes = cameraCutLanes
			.map((laneId) => /^lane-(\d+)$/u.exec(laneId)?.[1])
			.filter((value): value is string => Boolean(value))
			.map((value) => Number(value));
		const currentLaneMatch = /^lane-(\d+)$/u.exec(currentLane);
		const highestNumericLane =
			numericLanes.length > 0 ? Math.max(...numericLanes) : 0;
		const nextIndex =
			currentLaneMatch !== null
				? Number(currentLaneMatch[1]) + 1
				: highestNumericLane + 1;
		updateCameraCut(currentCameraCut, { laneId: `lane-${nextIndex}` });
	};

	const resolveCameraCutCollisions = (): void => {
		const store = useMotionStore.getState();
		const segments = [...artboardCameraCuts].sort(
			(left, right) =>
				cameraCutLaneId(left).localeCompare(cameraCutLaneId(right)) ||
				left.startFrame - right.startFrame,
		);
		if (segments.length === 0) return;
		store.beginTransaction("motion-camera-cut-resolve", "Resolve camera cuts");
		const laneEnd = new Map<string, number>();
		for (const segment of segments) {
			const laneId = cameraCutLaneId(segment);
			const minStart = laneEnd.get(laneId) ?? 0;
			const nextStart = Math.max(segment.startFrame, minStart);
			const maxDuration = Math.max(1, durationFrames - nextStart);
			const nextDuration = Math.min(segment.durationFrames, maxDuration);
			if (
				nextStart !== segment.startFrame ||
				nextDuration !== segment.durationFrames
			) {
				store.apply(
					retimeCameraCutSegment({
						segmentId: segment.id,
						startFrame: nextStart,
						durationFrames: nextDuration,
					}),
				);
			}
			laneEnd.set(laneId, nextStart + nextDuration);
		}
		store.commit();
	};

	const onCameraCutPointerDown = (
		event: React.PointerEvent<HTMLButtonElement>,
		segment: CameraCutSegment,
	): void => {
		event.preventDefault();
		event.stopPropagation();
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(segment.startFrame);
		const transaction = beginMotionTransaction(
			"motion-camera-cut-retime",
			"Move camera cut",
		);
		dragRef.current = {
			kind: "camera-cut",
			segmentId: segment.id,
			frame: segment.startFrame,
			transaction,
		};
		laneRef.current?.setPointerCapture(event.pointerId);
	};

	const onCameraCutEdgePointerDown = (
		event: React.PointerEvent<HTMLButtonElement>,
		segment: CameraCutSegment,
		edge: "start" | "end",
	): void => {
		event.preventDefault();
		event.stopPropagation();
		useTransportStore.getState().pause();
		useTransportStore
			.getState()
			.setFrame(
				edge === "start"
					? segment.startFrame
					: Math.max(
							segment.startFrame,
							segment.startFrame + segment.durationFrames - 1,
						),
			);
		const transaction = beginMotionTransaction(
			"motion-camera-cut-trim",
			"Trim camera cut",
		);
		dragRef.current = {
			kind: "camera-cut-edge",
			segmentId: segment.id,
			edge,
			frame:
				edge === "start"
					? segment.startFrame
					: segment.startFrame + segment.durationFrames,
			transaction,
		};
		laneRef.current?.setPointerCapture(event.pointerId);
	};

	const addRowKeyframe = (row: TimelineRow): void => {
		const command = createTimelineKeyframeCommand(
			row,
			selectedNode,
			motion,
			currentFrame,
		);
		if (!command) return;
		useMotionStore.getState().apply(command);
		const frame = snapTimelineFrame(currentFrame, durationFrames);
		const selected = isTimelineTextAnimatorOffsetRow(row)
			? selectedTimelineTextAnimatorOffsetKeyForTarget(
					useMotionStore.getState().document,
					row.bindingId,
					row.selectorIndex,
					frame,
				)
			: isTimelineCameraRow(row)
				? selectedTimelineCameraKeyForTarget(
						useMotionStore.getState().document,
						row.cameraRigId,
						row.property,
						frame,
					)
				: isTimelineSourceOpticsRow(row)
					? selectedTimelineSourceOpticsKeyForTarget(
							useMotionStore.getState().document,
							row.nodeId,
							row.target,
							frame,
						)
					: isTimelineProductionControlRow(row)
						? selectedTimelineProductionControlKeyForTarget(
								useMotionStore.getState().document,
								row.linkId,
								row.controlId,
								frame,
							)
						: selectedTimelineKeyForTarget(
								useMotionStore.getState().document,
								row.nodeId,
								row.property,
								frame,
							);
		if (selected) onSelectKey(selected);
	};

	const removeRowKeyframe = (row: TimelineRow): void => {
		const frame = snapTimelineFrame(currentFrame, durationFrames);
		const command = createTimelineRemoveKeyframeCommand(
			row,
			currentFrame,
			durationFrames,
		);
		if (!command) return;
		useMotionStore.getState().apply(command);
		if (selectedKeyTargetsRowFrame(selectedKey, row, frame)) {
			onSelectKey(null);
		}
	};
	const selectAdjacentKey = (direction: "previous" | "next"): boolean => {
		const adjacent = adjacentTimelineKey({
			rows,
			selectedKey,
			currentFrame,
			direction,
		});
		if (!adjacent) return false;
		onSelectKey(adjacent);
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(adjacent.frame);
		return true;
	};
	const retimeSelectedKey = (deltaFrames: number): boolean => {
		const resolved = resolveSelectedKeyInRows(selectedKey, rows);
		const targetFrame = retimedTimelineSelectedKeyFrame(
			resolved,
			deltaFrames,
			durationFrames,
		);
		if (!resolved || targetFrame === null) return false;
		const store = useMotionStore.getState();
		store.apply(
			isTextAnimatorOffsetSelectedKey(resolved)
				? setTextAnimatorOffsetKeyframeTime(
						resolved,
						targetFrame,
						`motion-text-animator-keyboard-retime:${resolved.bindingId}:${resolved.selectorIndex}`,
					)
				: isCameraSelectedKey(resolved)
					? setCameraRigKeyframeTime(
							resolved.trackId,
							resolved.frame,
							targetFrame,
							`motion-camera-keyboard-retime:${resolved.trackId}`,
						)
					: isSourceOpticsSelectedKey(resolved)
						? setSourceOpticsKeyframeTime(
								resolved.trackId,
								resolved.frame,
								targetFrame,
								`motion-source-optics-keyboard-retime:${resolved.trackId}`,
							)
						: setKeyframeTime(
								resolved.trackId,
								resolved.frame,
								targetFrame,
								`motion-keyboard-retime:${resolved.trackId}`,
							),
		);
		const retimed = retimedSelectedKeyInMotion(
			useMotionStore.getState().document,
			resolved,
			targetFrame,
		);
		if (!retimed) return false;
		onSelectKey(retimed);
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(retimed.frame);
		return true;
	};
	const deleteSelectedKey = (): boolean => {
		const resolved = resolveSelectedKeyInRows(selectedKey, rows);
		if (!resolved) return false;
		useMotionStore
			.getState()
			.apply(
				isTextAnimatorOffsetSelectedKey(resolved)
					? removeTextAnimatorOffsetKeyframe(resolved)
					: isCameraSelectedKey(resolved)
						? removeCameraRigKeyframe(
								resolved.cameraRigId,
								resolved.property,
								resolved.frame,
							)
						: isSourceOpticsSelectedKey(resolved)
							? removeSourceOpticsKeyframe(resolved.target, resolved.frame)
							: removeKeyframe(resolved.trackId, resolved.frame),
			);
		onSelectKey(null);
		useTransportStore.getState().pause();
		useTransportStore.getState().setFrame(resolved.frame);
		return true;
	};
	const onTracksKeyDown = (
		event: React.KeyboardEvent<HTMLFieldSetElement>,
	): void => {
		// IME composition keystrokes must never reach keyframe mutation below —
		// a stray Delete/Backspace while composing Japanese text would delete
		// or retime keyframes instead of editing the IME candidate.
		if (event.nativeEvent.isComposing) return;
		if (
			event.target instanceof HTMLElement &&
			event.target.closest("[data-timeline-text-input='true']")
		) {
			return;
		}
		if (event.key === "Delete") {
			event.preventDefault();
			event.stopPropagation();
			if (!deleteSelectedKey() && currentCameraCut) {
				removeCurrentCameraCut();
			}
			return;
		}
		if (
			currentCameraCut &&
			shortcutMatchesEvent(CAMERA_CUT_SHORTCUTS.toggleTransition, event)
		) {
			event.preventDefault();
			event.stopPropagation();
			toggleCurrentCameraCutTransition();
			return;
		}
		if (
			currentCameraCut &&
			shortcutMatchesEvent(CAMERA_CUT_SHORTCUTS.moveToNextLane, event)
		) {
			event.preventDefault();
			event.stopPropagation();
			moveCurrentCameraCutToNextLane();
			return;
		}
		if (currentCameraCut && event.altKey && event.key === "ArrowLeft") {
			event.preventDefault();
			event.stopPropagation();
			moveCurrentCameraCutByFrames(-cameraCutKeyboardStepFrames(event, fps));
			return;
		}
		if (currentCameraCut && event.altKey && event.key === "ArrowRight") {
			event.preventDefault();
			event.stopPropagation();
			moveCurrentCameraCutByFrames(cameraCutKeyboardStepFrames(event, fps));
			return;
		}
		if (currentCameraCut && (event.key === "[" || event.key === "{")) {
			event.preventDefault();
			event.stopPropagation();
			trimCurrentCameraCutStartByFrames(
				(event.altKey ? -1 : 1) * cameraCutKeyboardStepFrames(event, fps),
			);
			return;
		}
		if (currentCameraCut && (event.key === "]" || event.key === "}")) {
			event.preventDefault();
			event.stopPropagation();
			trimCurrentCameraCutEndByFrames(
				(event.altKey ? 1 : -1) * cameraCutKeyboardStepFrames(event, fps),
			);
			return;
		}
		const action = timelineKeyKeyboardAction(event, {
			largeStepFrames: Math.max(1, Math.round(fps)),
		});
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		if (action.type === "select-adjacent-key") {
			selectAdjacentKey(action.direction);
			return;
		}
		if (action.type === "retime-selected-key") {
			retimeSelectedKey(action.deltaFrames);
			return;
		}
		deleteSelectedKey();
	};
	const toggleTextAnimatorLane = (): void => {
		if (!textAnimatorLane) return;
		if (textAnimatorExpanded) {
			setExpandedTextAnimatorId(null);
			if (
				isTextAnimatorOffsetSelectedKey(selectedKey) &&
				selectedKey.bindingId === textAnimatorLane.bindingId
			) {
				onSelectKey(null);
			}
			return;
		}
		setExpandedTextAnimatorId(textAnimatorLane.bindingId);
	};

	return (
		<fieldset
			className="timeline-scroll-region m-0 flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto border-0 p-0 focus-within:ring-1 focus-within:ring-accent/70"
			aria-label="Timeline keyframes and camera cuts"
			data-editor-local-shortcuts={
				currentCameraCut
					? localShortcutScopeValue(CAMERA_CUT_LOCAL_SHORTCUTS)
					: undefined
			}
			onKeyDown={onTracksKeyDown}
		>
			<div className="w-56 shrink-0 border-white/10 border-r">
				{showCameraCutLane ? (
					<div
						className="border-white/[0.06] border-b bg-black/12 text-ui"
						style={{ height: cameraCutLaneHeight }}
					>
						<div className="flex h-7 items-center gap-1 px-2">
							<span className="w-10 shrink-0 text-fg-secondary">Cut</span>
							<input
								key={currentCameraCut?.id ?? "no-camera-cut"}
								data-timeline-text-input="true"
								type="text"
								aria-label="Rename current camera cut"
								disabled={!currentCameraCut}
								defaultValue={currentCameraCut?.name ?? ""}
								placeholder={
									currentCameraCut
										? (sceneCameraById.get(currentCameraCut.cameraRigId)
												?.name ?? currentCameraCut.cameraRigId)
										: "No cut"
								}
								className={cn(
									"min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-1.5 py-1 text-fg-secondary text-ui outline-none transition placeholder:text-fg-muted focus:border-accent/60 focus:text-fg-primary",
									currentCameraCutHasCollision &&
										"border-danger/50 text-danger-fg focus:border-danger/70",
									!currentCameraCut && "cursor-not-allowed opacity-45",
								)}
								onBlur={(event) =>
									renameCurrentCameraCut(event.currentTarget.value)
								}
								onKeyDown={(event) => {
									event.stopPropagation();
									if (event.key === "Escape") {
										event.currentTarget.value = currentCameraCut?.name ?? "";
										event.currentTarget.blur();
										return;
									}
									if (event.key === "Enter") event.currentTarget.blur();
								}}
							/>
							<button
								type="button"
								aria-label="Assign selected camera at playhead"
								title="Assign selected camera at playhead"
								onClick={addOrSplitCameraCut}
								className={CAMERA_CUT_CONTROL_BUTTON_CLASS}
							>
								<Plus aria-hidden="true" size={12} />
							</button>
							<button
								type="button"
								aria-label="Remove camera cut at playhead"
								title="Remove camera cut at playhead"
								disabled={!currentCameraCut}
								onClick={removeCurrentCameraCut}
								className={cn(
									CAMERA_CUT_CONTROL_BUTTON_CLASS,
									"hover:border-danger/50 hover:text-danger-fg",
									!currentCameraCut && CAMERA_CUT_CONTROL_DISABLED_CLASS,
								)}
							>
								<Trash aria-hidden="true" size={12} />
							</button>
						</div>
						{compactCameraCutLane ? null : (
							<div className="flex h-7 items-center gap-1 border-white/[0.06] border-t px-2">
								<button
									type="button"
									aria-label="Toggle camera cut transition"
									title="Toggle cut / crossfade"
									disabled={!currentCameraCut}
									onClick={toggleCurrentCameraCutTransition}
									className={cn(
										CAMERA_CUT_MODE_BUTTON_CLASS,
										currentCameraCut?.transition === "crossfade" &&
											"border-accent/45 text-accent-fg",
										!currentCameraCut && CAMERA_CUT_CONTROL_DISABLED_CLASS,
									)}
								>
									<WaveSine aria-hidden="true" size={12} />
									<span className="max-w-10 truncate">
										{currentCameraCut?.transition === "crossfade"
											? "Xfade"
											: "Cut"}
									</span>
								</button>
								{currentCameraCut?.transition === "crossfade" ? (
									<label
										className="flex h-6 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-accent/35 bg-accent/10 text-accent-fg"
										title="Crossfade duration"
									>
										<span className="sr-only">Crossfade duration</span>
										<input
											key={`${currentCameraCut.id}:${currentCameraCutCrossfadeDuration}`}
											data-timeline-text-input="true"
											type="number"
											min={1}
											max={currentCameraCut.durationFrames}
											step={1}
											defaultValue={currentCameraCutCrossfadeDuration}
											aria-label="Crossfade duration in frames"
											className="h-full min-w-0 flex-1 bg-transparent px-1 text-right font-mono text-ui tabular-nums outline-none"
											onBlur={(event) =>
												updateCurrentCameraCutTransitionDuration(
													event.currentTarget.value,
												)
											}
											onKeyDown={(event) => {
												event.stopPropagation();
												if (event.key === "Escape") {
													event.currentTarget.value = String(
														currentCameraCutCrossfadeDuration,
													);
													event.currentTarget.blur();
													return;
												}
												if (event.key === "Enter") event.currentTarget.blur();
											}}
										/>
										<span
											aria-hidden="true"
											className="shrink-0 pr-1 text-fg-muted"
										>
											f
										</span>
									</label>
								) : (
									<div className="flex h-6 min-w-0 flex-1 cursor-not-allowed items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.035] text-fg-subtle opacity-50">
										<span className="min-w-0 flex-1 px-1 text-right font-mono text-ui tabular-nums">
											--
										</span>
										<span
											aria-hidden="true"
											className="shrink-0 pr-1 text-fg-muted"
										>
											f
										</span>
									</div>
								)}
								<button
									type="button"
									aria-label="Move camera cut to next lane"
									title="Move camera cut to next lane"
									disabled={!currentCameraCut}
									onClick={moveCurrentCameraCutToNextLane}
									className={cn(
										CAMERA_CUT_CONTROL_BUTTON_CLASS,
										!currentCameraCut && CAMERA_CUT_CONTROL_DISABLED_CLASS,
									)}
								>
									<GitBranch aria-hidden="true" size={12} />
								</button>
								<button
									type="button"
									aria-label="Resolve overlapping camera cuts"
									title="Resolve overlapping camera cuts"
									disabled={cameraCutCollisionCount === 0}
									onClick={resolveCameraCutCollisions}
									className={cn(
										CAMERA_CUT_CONTROL_BUTTON_CLASS,
										cameraCutCollisionCount > 0 &&
											"border-danger/45 text-danger-fg hover:border-danger/70",
										cameraCutCollisionCount === 0 &&
											CAMERA_CUT_CONTROL_DISABLED_CLASS,
									)}
								>
									<Stack aria-hidden="true" size={12} />
								</button>
							</div>
						)}
						{cameraCutLanes.slice(1).map((laneId) => (
							<div
								key={laneId}
								className="flex h-7 items-center border-white/[0.06] border-t px-2 text-fg-muted"
							>
								<span className="w-9 shrink-0" />
								<span className="truncate">
									{cameraCutLaneLabel(
										laneId,
										selectedCameraRigId,
										sceneCameraById.get(laneId)?.name,
									)}
								</span>
							</div>
						))}
					</div>
				) : null}
				{textAnimatorLane ? (
					<button
						type="button"
						aria-expanded={textAnimatorExpanded}
						title={`${textAnimatorLane.bindingName} · ${textAnimatorLane.targetKind === "live-text" ? "Live text" : "Outline group"}`}
						onClick={toggleTextAnimatorLane}
						className={cn(
							"flex h-7 w-full items-center gap-1.5 border-white/[0.06] border-b px-2 text-left text-ui transition hover:bg-white/[0.025]",
							textAnimatorExpanded && "bg-accent/[0.05]",
						)}
					>
						{textAnimatorExpanded ? (
							<CaretDown aria-hidden="true" size={11} />
						) : (
							<CaretRight aria-hidden="true" size={11} />
						)}
						<TextT aria-hidden="true" size={12} className="text-fg-muted" />
						<span className="shrink-0 text-fg-secondary">Text Animator</span>
						<span className="min-w-0 flex-1 truncate text-fg-subtle">
							{textAnimatorLane.bindingName}
						</span>
						<span
							className={cn(
								"shrink-0 font-mono text-fg-muted",
								!textAnimatorLane.enabled && "text-warn-fg",
							)}
						>
							{textAnimatorLane.enabled ? textAnimatorLane.rows.length : "Off"}
						</span>
					</button>
				) : null}
				{rows.length === 0 ? (
					<div className="px-3 py-4 text-fg-subtle text-ui leading-relaxed">
						Select a layer or scene camera to author motion keys.
					</div>
				) : (
					rows.map((row) => {
						const rowHasSelectedKey = isTimelineTextAnimatorOffsetRow(row)
							? isTextAnimatorOffsetSelectedKey(selectedKey) &&
								selectedKey.bindingId === row.bindingId &&
								selectedKey.selectorIndex === row.selectorIndex
							: isTimelineCameraRow(row)
								? isCameraSelectedKey(selectedKey) &&
									selectedKey.cameraRigId === row.cameraRigId &&
									selectedKey.property === row.property
								: isTimelineSourceOpticsRow(row)
									? isSourceOpticsSelectedKey(selectedKey) &&
										selectedKey.nodeId === row.nodeId &&
										selectedKey.property === row.property
									: isNodeSelectedKey(selectedKey) &&
										selectedKey.nodeId === row.nodeId &&
										selectedKey.property === row.property;
						return (
							<div
								key={row.id}
								title={`${rowSubjectName(row)} ${row.label}`}
								className={cn(
									"flex h-7 items-center gap-2 border-white/[0.06] border-b px-2 text-ui",
									row.hasKeyAtCurrentFrame && "bg-warn/[0.04]",
									rowHasSelectedKey && "bg-accent/[0.06]",
								)}
							>
								<div className="flex min-w-0 flex-1 items-center gap-2">
									<span className="w-12 shrink-0 text-fg-secondary">
										{row.label}
									</span>
									<span className="truncate text-fg-subtle">
										{rowSubjectName(row)}
									</span>
									<span className="ml-auto shrink-0 font-mono text-fg-muted text-ui tabular-nums">
										{formatRowValue(row)}
									</span>
								</div>
								<button
									type="button"
									aria-label={`Add ${row.label} keyframe`}
									title={`Add ${row.label} keyframe`}
									onClick={() => addRowKeyframe(row)}
									className="grid size-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-accent/50 hover:text-accent-fg"
								>
									<Plus aria-hidden="true" size={12} />
								</button>
								<button
									type="button"
									aria-label={`Remove ${row.label} keyframe`}
									title={`Remove ${row.label} keyframe`}
									disabled={!row.hasKeyAtCurrentFrame}
									onClick={() => removeRowKeyframe(row)}
									className={cn(
										"grid size-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-danger/50 hover:text-danger-fg",
										!row.hasKeyAtCurrentFrame &&
											"cursor-not-allowed opacity-35 hover:border-white/10 hover:text-fg-secondary",
									)}
								>
									<Trash aria-hidden="true" size={12} />
								</button>
							</div>
						);
					})
				)}
			</div>

			<div
				ref={laneRef}
				className="relative min-w-0 flex-1 cursor-pointer touch-none select-none"
				onPointerDown={scrub.onScrubPointerDown}
				onPointerMove={onLanePointerMove}
				onPointerUp={endLaneGesture}
				onPointerCancel={endLaneGesture}
				onLostPointerCapture={endLaneGesture}
			>
				{showCameraCutLane ? (
					<div
						className="relative border-white/[0.06] border-b bg-black/10"
						style={{ height: cameraCutLaneHeight }}
					>
						{cameraCutLanes.map((laneId, laneIndex) => (
							<div
								key={laneId}
								aria-hidden="true"
								className={cn(
									"absolute right-0 left-0 border-white/[0.06] border-b",
									laneIndex % 2 === 1 && "bg-white/[0.015]",
								)}
								style={{
									height: cameraCutLaneVisualHeight(
										laneIndex,
										cameraCutHeaderHeight,
									),
									top: cameraCutLaneVisualTop(laneIndex, cameraCutHeaderHeight),
								}}
							/>
						))}
						{artboardCameraCuts.map((segment) => {
							const camera = sceneCameraById.get(segment.cameraRigId);
							const label = cameraCutDisplayName(segment, camera?.name);
							const laneIndex = Math.max(
								0,
								cameraCutLanes.indexOf(cameraCutLaneId(segment)),
							);
							const selected =
								currentFrame >= segment.startFrame &&
								currentFrame < segment.startFrame + segment.durationFrames;
							const collision = cameraCutHasCollision(
								artboardCameraCuts,
								segment,
							);
							const left = frameToPercent(segment.startFrame, durationFrames);
							const width = Math.max(
								1,
								frameToPercent(segment.durationFrames, durationFrames),
							);
							const transitionWidth =
								segment.transition === "crossfade"
									? Math.min(
											100,
											Math.max(
												12,
												((segment.transitionDurationFrames ??
													defaultCameraCutCrossfadeDurationFrames(fps)) /
													Math.max(1, segment.durationFrames)) *
													100,
											),
										)
									: 0;
							return (
								<div
									key={segment.id}
									className="absolute"
									style={{
										left: `${left}%`,
										height: CAMERA_CUT_LANE_HEIGHT - 8,
										top: cameraCutLaneTop(laneIndex, cameraCutHeaderHeight),
										width: `${width}%`,
									}}
								>
									<button
										type="button"
										aria-label={`${label} camera cut at frame ${segment.startFrame}`}
										title={`${label}: ${segment.startFrame}-${segment.startFrame + segment.durationFrames - 1}f · ${cameraCutTransitionLabel(segment, fps)}`}
										className={cn(
											"absolute inset-0 flex min-w-2 cursor-grab items-center gap-1 overflow-hidden rounded border px-1 text-left text-ui active:cursor-grabbing",
											collision
												? "border-danger/70 bg-danger/10 text-danger-fg"
												: selected
													? "border-accent/60 bg-accent-surface text-accent-fg"
													: "border-white/10 bg-white/[0.05] text-fg-muted hover:border-white/20 hover:text-fg-secondary",
										)}
										onPointerDown={(event) =>
											onCameraCutPointerDown(event, segment)
										}
									>
										{transitionWidth > 0 ? (
											<span
												aria-hidden="true"
												className="pointer-events-none absolute top-0 bottom-0 left-0 border-accent/35 border-r bg-accent/20"
												style={{ width: `${transitionWidth}%` }}
											/>
										) : null}
										<span className="relative z-10 grid size-4 shrink-0 place-items-center rounded-sm bg-white/10 font-mono text-ui">
											{cameraCutInitials(label)}
										</span>
										<span className="relative z-10 min-w-0 flex-1 truncate">
											{label}
										</span>
										<span
											className={cn(
												"relative z-10 max-w-16 shrink-0 truncate rounded-sm border px-1 font-mono text-ui",
												segment.transition === "crossfade"
													? "border-accent/30 bg-accent/15 text-accent-fg"
													: "border-white/10 bg-black/10 text-fg-muted",
											)}
										>
											{cameraCutTransitionLabel(segment, fps)}
										</span>
									</button>
									<button
										type="button"
										aria-label={`Trim start of ${label} camera cut`}
										title="Trim camera cut start"
										className="-left-1 absolute top-0 bottom-0 w-2 cursor-ew-resize rounded-l border-accent/50 border-l bg-accent/35"
										onPointerDown={(event) =>
											onCameraCutEdgePointerDown(event, segment, "start")
										}
									/>
									<button
										type="button"
										aria-label={`Trim end of ${label} camera cut`}
										title="Trim camera cut end"
										className="-right-1 absolute top-0 bottom-0 w-2 cursor-ew-resize rounded-r border-accent/50 border-r bg-accent/35"
										onPointerDown={(event) =>
											onCameraCutEdgePointerDown(event, segment, "end")
										}
									/>
								</div>
							);
						})}
					</div>
				) : null}
				{textAnimatorLane ? (
					<div className="relative h-7 border-white/[0.06] border-b bg-black/10">
						{textAnimatorClip ? (
							<div
								className="pointer-events-none absolute top-1 bottom-1 flex min-w-8 items-center overflow-hidden rounded border border-accent/45 bg-accent-surface/75 px-1 text-accent-fg text-ui"
								style={{
									left: `${textAnimatorClipLeft}%`,
									width: `${textAnimatorClipWidth}%`,
								}}
								title={`Text Animator clip ${textAnimatorClip.startFrame}-${textAnimatorClip.startFrame + textAnimatorClip.durationFrames - 1}f · read-only in Timeline`}
							>
								<span className="truncate">
									Clip {textAnimatorClip.startFrame}-
									{textAnimatorClip.startFrame +
										textAnimatorClip.durationFrames -
										1}
									f · read-only
								</span>
							</div>
						) : (
							<span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-fg-subtle text-ui">
								Full timeline
							</span>
						)}
					</div>
				) : null}
				{rows.map((row) => (
					<div
						key={row.id}
						className="relative h-7 border-white/[0.06] border-b"
					>
						{row.keyframes.map((keyframe) => {
							const isSelected = selectedKeyTargetsRowFrame(
								selectedKey,
								row,
								keyframe.time,
							);
							return (
								<button
									key={keyframe.time}
									type="button"
									data-timeline-shortcuts="true"
									aria-label={`${row.label} keyframe at frame ${keyframe.time}`}
									className={cn(
										"-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-3 rotate-45 cursor-grab rounded-[2px] border active:cursor-grabbing",
										isSelected
											? "border-white bg-accent"
											: "border-surface bg-warn hover:bg-warn",
									)}
									style={{
										left: `${frameToPercent(keyframe.time, durationFrames)}%`,
									}}
									onPointerDown={(event) =>
										onDiamondPointerDown(event, row, keyframe.time)
									}
								/>
							);
						})}
					</div>
				))}

				<TimelinePlayheadLine durationFrames={durationFrames} />
			</div>
		</fieldset>
	);
}
