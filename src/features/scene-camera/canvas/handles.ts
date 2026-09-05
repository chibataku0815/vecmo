import {
	readSceneCameraAuthoringState,
	type SceneCameraAuthoringSelection,
	type SceneCameraRigReadModel,
} from "@/entities/scene/model/scene-camera-authoring";
import type { SceneDocument, Vec2, Vec3 } from "@/entities/scene/model/types";
import {
	createUpdateSceneCameraAuthoringPlan,
	type SceneCameraAuthoringCommandPlan,
} from "../model/authoring";

export type SceneCameraCanvasHandleRole =
	| "body"
	| "target"
	| "body-depth"
	| "target-depth"
	| "rotation-x"
	| "rotation-y"
	| "rotation-z"
	| "focus"
	| "aperture";

export type SceneCameraCanvasHandleHit = {
	readonly cameraRigId: string;
	readonly role: SceneCameraCanvasHandleRole;
	readonly point: Vec2;
	readonly modelPoint: Vec2;
};

export type SceneCameraCanvasHandleHitContext = {
	readonly cameraRigId: string;
	readonly radius: number;
	readonly layout: readonly SceneCameraCanvasHandleLayoutPoint[];
};

export type SceneCameraCanvasHandleDragStart = {
	readonly cameraRigId: string;
	readonly point: Vec2;
	readonly modelPoint: Vec2;
	readonly targetDirection: Vec2;
	readonly targetRight: Vec2;
	readonly bodyPosition: Vec3;
	readonly bodyRotation: Vec3;
	readonly targetPoint: Vec3;
	readonly focusDistance: number;
	readonly aperture: number;
};

export type SceneCameraCanvasHandleDragModifiers = {
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly shiftKey?: boolean;
};

export type SceneCameraCanvasHandleLayoutPoint = {
	readonly role: SceneCameraCanvasHandleRole;
	readonly point: Vec2;
	readonly modelPoint: Vec2;
	readonly enabled: boolean;
	readonly label?: string;
};

const PERCENT = 100;
const BASE_HIT_RADIUS = 12;
const HANDLE_OFFSET = 24;
const ORIENTATION_RADIUS = 28;
const FOCUS_HANDLE_OFFSET = 18;
const ROTATION_DEGREES_PER_UNIT = 0.5;
const APERTURE_UNITS_PER_PIXEL = 1 / 80;
const SNAP_TRANSLATE_UNITS = 5;
const SNAP_DEPTH_UNITS = 10;
const SNAP_ROTATION_DEGREES = 5;
const SNAP_FOCUS_UNITS = 10;
const SNAP_APERTURE_UNITS = 0.5;
const FINE_DRAG_MULTIPLIER = 0.25;
const MIN_HANDLE_SEPARATION = 28;
const HANDLE_ROLE_PRIORITY: readonly SceneCameraCanvasHandleRole[] = [
	"body",
	"target",
	"body-depth",
	"target-depth",
	"rotation-x",
	"rotation-y",
	"rotation-z",
	"focus",
	"aperture",
];

const distance = (left: Vec2, right: Vec2): number =>
	Math.hypot(left.x - right.x, left.y - right.y);

const distance3 = (left: Vec3, right: Vec3): number =>
	Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

const delta = (from: Vec2, to: Vec2): Vec2 => ({
	x: to.x - from.x,
	y: to.y - from.y,
});

const normalize2 = (value: Vec2): Vec2 | null => {
	const length = Math.hypot(value.x, value.y);
	if (!Number.isFinite(length) || length <= 1e-6) return null;
	return { x: value.x / length, y: value.y / length };
};

const dot2 = (left: Vec2, right: Vec2): number =>
	left.x * right.x + left.y * right.y;

const finiteNumber = (value: number, fallback = 0): number =>
	Number.isFinite(value) ? value : fallback;

const positiveNumber = (value: number, fallback = 1): number =>
	Number.isFinite(value) && value > 0 ? value : fallback;

const roundHandleValue = (value: number): number =>
	Number.isFinite(value) ? Number(value.toFixed(3)) : 0;

const roundDisplayValue = (value: number, fractionDigits = 0): string =>
	Number.isFinite(value) ? value.toFixed(fractionDigits) : "0";

const handleLabel = (label: string, value: string): string =>
	value ? `${label} ${value}` : label;

const cameraRigIdFromSelection = (
	selection: SceneCameraAuthoringSelection | null | undefined,
): string | null => {
	if (!selection) return null;
	return "cameraRigId" in selection ? (selection.cameraRigId ?? null) : null;
};

const cameraBodyPoint = (camera: SceneCameraRigReadModel): Vec2 => ({
	x: camera.rig.body.position.x,
	y: camera.rig.body.position.y,
});

const cameraTargetPoint = (camera: SceneCameraRigReadModel): Vec2 => {
	return { x: camera.target.point.x, y: camera.target.point.y };
};

const cameraTargetVec3 = (camera: SceneCameraRigReadModel): Vec3 =>
	camera.target.point;

const editableTargetPoint = (camera: SceneCameraRigReadModel): boolean =>
	camera.target.editable;

const fallbackTargetDirection = (): Vec2 => ({ x: 1, y: 0 });

const bodyToTargetDirection = (camera: SceneCameraRigReadModel): Vec2 => {
	const body = cameraBodyPoint(camera);
	const target = cameraTargetPoint(camera);
	return (
		normalize2({ x: target.x - body.x, y: target.y - body.y }) ??
		fallbackTargetDirection()
	);
};

const perpendicular = (value: Vec2): Vec2 => ({ x: -value.y, y: value.x });

const pointFromBasis = ({
	origin,
	forward,
	right,
	forwardOffset = 0,
	rightOffset = 0,
}: {
	readonly origin: Vec2;
	readonly forward: Vec2;
	readonly right: Vec2;
	readonly forwardOffset?: number;
	readonly rightOffset?: number;
}): Vec2 => ({
	x: origin.x + forward.x * forwardOffset + right.x * rightOffset,
	y: origin.y + forward.y * forwardOffset + right.y * rightOffset,
});

const scaleMove = (
	move: Vec2,
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): Vec2 => {
	const multiplier = modifiers?.altKey ? FINE_DRAG_MULTIPLIER : 1;
	return { x: move.x * multiplier, y: move.y * multiplier };
};

const snapValue = (
	value: number,
	step: number,
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): number => {
	if (!modifiers?.shiftKey || step <= 0) return value;
	return Math.round(value / step) * step;
};

const snapPoint = (
	point: Vec2,
	step: number,
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): Vec2 => {
	if (!modifiers?.shiftKey) return point;
	return {
		x: snapValue(point.x, step, modifiers),
		y: snapValue(point.y, step, modifiers),
	};
};

const axisLockActive = (
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): boolean =>
	Boolean(modifiers?.shiftKey || modifiers?.metaKey || modifiers?.ctrlKey);

const axisLockedMove = (
	move: Vec2,
	base: SceneCameraCanvasHandleDragStart,
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): Vec2 => {
	if (!axisLockActive(modifiers)) return move;
	const forwardAmount = dot2(move, base.targetDirection);
	const rightAmount = dot2(move, base.targetRight);
	if (Math.abs(forwardAmount) >= Math.abs(rightAmount)) {
		return {
			x: base.targetDirection.x * forwardAmount,
			y: base.targetDirection.y * forwardAmount,
		};
	}
	return {
		x: base.targetRight.x * rightAmount,
		y: base.targetRight.y * rightAmount,
	};
};

const dragPointForRole = (
	role: SceneCameraCanvasHandleRole,
	base: SceneCameraCanvasHandleDragStart,
	point: Vec2,
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): Vec2 => {
	const rawMove = scaleMove(delta(base.point, point), modifiers);
	const move =
		role === "body" || role === "target"
			? axisLockedMove(rawMove, base, modifiers)
			: rawMove;
	const next = {
		x: base.modelPoint.x + move.x,
		y: base.modelPoint.y + move.y,
	};
	return role === "body" || role === "target"
		? snapPoint(next, SNAP_TRANSLATE_UNITS, modifiers)
		: next;
};

type SceneCameraCanvasDragValues = {
	readonly point: Vec2;
	readonly focusDelta: number;
	readonly zDelta: number;
	readonly pitchDelta: number;
	readonly yawDelta: number;
	readonly rollDelta: number;
	readonly apertureDelta: number;
};

const dragValuesFor = (
	role: SceneCameraCanvasHandleRole,
	base: SceneCameraCanvasHandleDragStart,
	point: Vec2,
	modifiers?: SceneCameraCanvasHandleDragModifiers,
): SceneCameraCanvasDragValues => {
	const adjustedPoint = dragPointForRole(role, base, point, modifiers);
	const move = delta(base.modelPoint, adjustedPoint);
	return {
		point: adjustedPoint,
		focusDelta: dot2(move, base.targetDirection) || -move.y,
		zDelta: dot2(move, base.targetRight) || -move.y,
		pitchDelta: -dot2(move, base.targetRight) || move.y,
		yawDelta: dot2(move, base.targetDirection) || move.x,
		rollDelta: dot2(move, base.targetRight) || move.x,
		apertureDelta: finiteNumber(move.x - move.y) * APERTURE_UNITS_PER_PIXEL,
	};
};

const focusPoint = (camera: SceneCameraRigReadModel, scale: number): Vec2 => {
	const body = cameraBodyPoint(camera);
	const target = cameraTargetPoint(camera);
	const body3 = camera.rig.body.position;
	const target3 = cameraTargetVec3(camera);
	const distanceToTarget = positiveNumber(distance3(body3, target3), 1);
	const focusDistance = camera.rig.projection.focusDistance ?? distanceToTarget;
	const ratio = Math.max(0.08, Math.min(1.8, focusDistance / distanceToTarget));
	const direction = normalize2({
		x: target.x - body.x,
		y: target.y - body.y,
	}) ?? {
		x: 1,
		y: 0,
	};
	const visualDistance = Math.max(
		FOCUS_HANDLE_OFFSET / scale,
		distance(body, target) * ratio,
	);
	return {
		x: body.x + direction.x * visualDistance,
		y: body.y + direction.y * visualDistance,
	};
};

/**
 * Computes the stable artboard-space handle locations used by hit-testing and
 * the overlay. The handles are offset by viewport scale so they stay visually
 * stable while zooming.
 */
export function sceneCameraCanvasHandleLayout(
	camera: SceneCameraRigReadModel,
	scale: number,
): readonly SceneCameraCanvasHandleLayoutPoint[] {
	const safeScale = Math.max(scale, 0.001);
	const body = cameraBodyPoint(camera);
	const target = cameraTargetPoint(camera);
	const focus = focusPoint(camera, safeScale);
	const forward = bodyToTargetDirection(camera);
	const right = perpendicular(forward);
	const offset = HANDLE_OFFSET / safeScale;
	const rotation = ORIENTATION_RADIUS / safeScale;
	const targetEditable = editableTargetPoint(camera);
	const bodyRotation = camera.rig.body.rotation ?? { x: 0, y: 0, z: 0 };
	const bodyZLabel = roundDisplayValue(camera.rig.body.position.z);
	const targetZLabel = roundDisplayValue(cameraTargetVec3(camera).z);
	const focusLabel = roundDisplayValue(
		camera.rig.projection.focusDistance ??
			distance3(camera.rig.body.position, cameraTargetVec3(camera)),
	);
	const apertureLabel = roundDisplayValue(
		camera.rig.projection.aperture ?? 0,
		1,
	);
	const raw = [
		{ role: "body", point: body, enabled: true, label: "Body" },
		{ role: "target", point: target, enabled: true, label: "Target" },
		{
			role: "body-depth",
			point: pointFromBasis({
				origin: body,
				forward,
				right,
				forwardOffset: offset * 0.35,
				rightOffset: offset,
			}),
			enabled: true,
			label: handleLabel("Body Z", bodyZLabel),
		},
		{
			role: "target-depth",
			point: pointFromBasis({
				origin: target,
				forward,
				right,
				forwardOffset: offset * 0.35,
				rightOffset: offset,
			}),
			enabled: targetEditable,
			label: handleLabel("Target Z", targetZLabel),
		},
		{
			role: "rotation-x",
			point: pointFromBasis({
				origin: body,
				forward,
				right,
				rightOffset: -rotation,
			}),
			enabled: true,
			label: handleLabel("Pitch", `${roundDisplayValue(bodyRotation.x)} deg`),
		},
		{
			role: "rotation-y",
			point: pointFromBasis({
				origin: body,
				forward,
				right,
				forwardOffset: rotation,
			}),
			enabled: true,
			label: handleLabel("Yaw", `${roundDisplayValue(bodyRotation.y)} deg`),
		},
		{
			role: "rotation-z",
			point: pointFromBasis({
				origin: body,
				forward,
				right,
				rightOffset: rotation,
			}),
			enabled: true,
			label: handleLabel("Roll", `${roundDisplayValue(bodyRotation.z)} deg`),
		},
		{
			role: "focus",
			point: focus,
			enabled: true,
			label: handleLabel("Focus", focusLabel),
		},
		{
			role: "aperture",
			point: pointFromBasis({
				origin: focus,
				forward,
				right,
				forwardOffset: FOCUS_HANDLE_OFFSET / safeScale,
				rightOffset: FOCUS_HANDLE_OFFSET / safeScale,
			}),
			enabled: true,
			label: handleLabel("Aperture", apertureLabel),
		},
	] satisfies readonly Omit<SceneCameraCanvasHandleLayoutPoint, "modelPoint">[];
	const placed: SceneCameraCanvasHandleLayoutPoint[] = [];
	const separation = MIN_HANDLE_SEPARATION / safeScale;
	const candidateOffsets = [
		{ x: 0, y: 0 },
		right,
		{ x: -right.x, y: -right.y },
		forward,
		{ x: -forward.x, y: -forward.y },
		{ x: right.x + forward.x, y: right.y + forward.y },
		{ x: right.x - forward.x, y: right.y - forward.y },
		{ x: -right.x + forward.x, y: -right.y + forward.y },
		{ x: -right.x - forward.x, y: -right.y - forward.y },
	];
	for (const handle of raw) {
		const modelPoint = handle.point;
		const point = handle.enabled
			? (candidateOffsets
					.map((candidate) => ({
						x: modelPoint.x + candidate.x * separation,
						y: modelPoint.y + candidate.y * separation,
					}))
					.find((candidate) =>
						placed.every(
							(other) =>
								!other.enabled ||
								distance(candidate, other.point) >= separation,
						),
					) ?? modelPoint)
			: modelPoint;
		placed.push({ ...handle, point, modelPoint });
	}
	return placed;
}

/** Builds a reusable hit context for pointer hover and drag-start routing. */
export function createSceneCameraCanvasHandleHitContext({
	document,
	artboardId,
	selection,
	zoom,
}: {
	readonly document: SceneDocument;
	readonly artboardId?: string;
	readonly selection: {
		readonly sceneCamera?: SceneCameraAuthoringSelection | null;
	};
	readonly zoom: number;
}): SceneCameraCanvasHandleHitContext | null {
	const state = readSceneCameraAuthoringState(document, artboardId);
	const selectedCameraRigId = cameraRigIdFromSelection(selection.sceneCamera);
	const selectedCamera = selectedCameraRigId
		? state.cameras.find((camera) => camera.rig.id === selectedCameraRigId)
		: undefined;
	const camera = selectedCamera ?? state.activeCamera;
	if (!camera) return null;
	const scale = Math.max(zoom / PERCENT, 0.001);
	return {
		cameraRigId: camera.rig.id,
		radius: BASE_HIT_RADIUS / scale,
		layout: sceneCameraCanvasHandleLayout(camera, scale),
	};
}

/** Hit-tests one point against a previously resolved camera-handle layout. */
export function hitSceneCameraCanvasHandleContext(
	context: SceneCameraCanvasHandleHitContext | null,
	point: Vec2,
): SceneCameraCanvasHandleHit | null {
	if (!context) return null;
	const candidates = context.layout
		.filter((handle) => handle.enabled)
		.map((handle) => ({ handle, distance: distance(point, handle.point) }))
		.filter((candidate) => candidate.distance <= context.radius)
		.sort(
			(left, rightCandidate) =>
				left.distance - rightCandidate.distance ||
				HANDLE_ROLE_PRIORITY.indexOf(left.handle.role) -
					HANDLE_ROLE_PRIORITY.indexOf(rightCandidate.handle.role),
		);
	const winner = candidates[0]?.handle;
	return winner
		? {
				cameraRigId: context.cameraRigId,
				role: winner.role,
				point: winner.point,
				modelPoint: winner.modelPoint,
			}
		: null;
}

/**
 * Hit-tests visible camera handles. The selected camera wins over the artboard
 * camera so an inactive rig can be edited without gesture theft.
 */
export function hitSceneCameraCanvasHandle({
	document,
	artboardId,
	selection,
	point,
	zoom,
}: {
	readonly document: SceneDocument;
	readonly artboardId?: string;
	readonly selection: {
		readonly sceneCamera?: SceneCameraAuthoringSelection | null;
	};
	readonly point: Vec2;
	readonly zoom: number;
}): SceneCameraCanvasHandleHit | null {
	return hitSceneCameraCanvasHandleContext(
		createSceneCameraCanvasHandleHitContext({
			document,
			artboardId,
			selection,
			zoom,
		}),
		point,
	);
}

/** Captures the camera values a direct-handle gesture should be relative to. */
export function createSceneCameraCanvasHandleDragStart({
	document,
	hit,
	point,
}: {
	readonly document: SceneDocument;
	readonly hit: SceneCameraCanvasHandleHit;
	readonly point: Vec2;
}): SceneCameraCanvasHandleDragStart | null {
	const state = readSceneCameraAuthoringState(document);
	const camera = state.cameras.find((item) => item.rig.id === hit.cameraRigId);
	if (!camera) return null;
	const targetPoint = cameraTargetVec3(camera);
	const targetDistance = distance3(camera.rig.body.position, targetPoint);
	const targetDirection = bodyToTargetDirection(camera);
	return {
		cameraRigId: hit.cameraRigId,
		point,
		modelPoint: hit.modelPoint,
		targetDirection,
		targetRight: perpendicular(targetDirection),
		bodyPosition: camera.rig.body.position,
		bodyRotation: camera.rig.body.rotation ?? { x: 0, y: 0, z: 0 },
		targetPoint,
		focusDistance:
			camera.rig.projection.focusDistance ??
			positiveNumber(targetDistance, Math.abs(camera.rig.body.position.z)),
		aperture: camera.rig.projection.aperture ?? 0,
	};
}

/**
 * Builds the scene-camera drag command for a body/target handle. Bound target
 * nodes/controllers are selected by the hit-test path but are not moved here;
 * their own vector/controller editing path remains the source of truth.
 */
export function createSceneCameraCanvasHandleDragPlan({
	document,
	hit,
	modifiers,
	point,
	start,
}: {
	readonly document: SceneDocument;
	readonly hit: SceneCameraCanvasHandleHit;
	readonly modifiers?: SceneCameraCanvasHandleDragModifiers;
	readonly point: Vec2;
	readonly start?: SceneCameraCanvasHandleDragStart;
}): SceneCameraAuthoringCommandPlan | null {
	const state = readSceneCameraAuthoringState(document);
	const camera = state.cameras.find((item) => item.rig.id === hit.cameraRigId);
	if (!camera) return null;
	const base =
		start?.cameraRigId === hit.cameraRigId
			? start
			: createSceneCameraCanvasHandleDragStart({ document, hit, point });
	if (!base) return null;
	const values = dragValuesFor(hit.role, base, point, modifiers);
	const targetEditable = editableTargetPoint(camera);
	if (
		(hit.role === "target" || hit.role === "target-depth") &&
		!targetEditable
	) {
		return null;
	}
	const patch: Parameters<
		typeof createUpdateSceneCameraAuthoringPlan
	>[0]["patch"] = (() => {
		switch (hit.role) {
			case "body":
				return {
					body: {
						position: {
							x: values.point.x,
							y: values.point.y,
							z: base.bodyPosition.z,
						},
					},
				};
			case "target":
				return {
					target: {
						point: {
							x: values.point.x,
							y: values.point.y,
							z: base.targetPoint.z,
						},
					},
				};
			case "body-depth":
				return {
					body: {
						position: {
							...base.bodyPosition,
							z: roundHandleValue(
								snapValue(
									base.bodyPosition.z + values.zDelta,
									SNAP_DEPTH_UNITS,
									modifiers,
								),
							),
						},
					},
				};
			case "target-depth":
				return {
					target: {
						point: {
							...base.targetPoint,
							z: roundHandleValue(
								snapValue(
									base.targetPoint.z + values.zDelta,
									SNAP_DEPTH_UNITS,
									modifiers,
								),
							),
						},
					},
				};
			case "rotation-x":
				return {
					body: {
						rotation: {
							...base.bodyRotation,
							x: roundHandleValue(
								snapValue(
									base.bodyRotation.x +
										values.pitchDelta * ROTATION_DEGREES_PER_UNIT,
									SNAP_ROTATION_DEGREES,
									modifiers,
								),
							),
						},
					},
				};
			case "rotation-y":
				return {
					body: {
						rotation: {
							...base.bodyRotation,
							y: roundHandleValue(
								snapValue(
									base.bodyRotation.y +
										values.yawDelta * ROTATION_DEGREES_PER_UNIT,
									SNAP_ROTATION_DEGREES,
									modifiers,
								),
							),
						},
					},
				};
			case "rotation-z":
				return {
					body: {
						rotation: {
							...base.bodyRotation,
							z: roundHandleValue(
								snapValue(
									base.bodyRotation.z +
										values.rollDelta * ROTATION_DEGREES_PER_UNIT,
									SNAP_ROTATION_DEGREES,
									modifiers,
								),
							),
						},
					},
				};
			case "focus":
				return {
					projection: {
						focusDistance: roundHandleValue(
							Math.max(
								1,
								snapValue(
									base.focusDistance + values.focusDelta,
									SNAP_FOCUS_UNITS,
									modifiers,
								),
							),
						),
					},
				};
			case "aperture":
				return {
					projection: {
						aperture: roundHandleValue(
							Math.max(
								0,
								snapValue(
									base.aperture + values.apertureDelta,
									SNAP_APERTURE_UNITS,
									modifiers,
								),
							),
						),
					},
				};
		}
	})();
	const labelByRole: Record<SceneCameraCanvasHandleRole, string> = {
		body: "Move camera body",
		target: "Move camera target",
		"body-depth": "Dolly camera body",
		"target-depth": "Move camera target depth",
		"rotation-x": "Pitch camera",
		"rotation-y": "Yaw camera",
		"rotation-z": "Roll camera",
		focus: "Move camera focus",
		aperture: "Edit camera aperture",
	};
	return createUpdateSceneCameraAuthoringPlan({
		cameraRigId: hit.cameraRigId,
		patch,
		label: labelByRole[hit.role],
		coalesceKey: `scene-camera:canvas-handle:${hit.cameraRigId}:${hit.role}`,
	});
}

export function sceneCameraCanvasHandleDragHud({
	hit,
	modifiers,
	point,
	start,
}: {
	readonly hit: SceneCameraCanvasHandleHit;
	readonly modifiers?: SceneCameraCanvasHandleDragModifiers;
	readonly point: Vec2;
	readonly start: SceneCameraCanvasHandleDragStart;
}): string {
	const values = dragValuesFor(hit.role, start, point, modifiers);
	const axisLocked =
		(hit.role === "body" || hit.role === "target") && axisLockActive(modifiers);
	const suffix = [
		modifiers?.shiftKey ? "snap" : null,
		modifiers?.altKey ? "fine" : null,
		axisLocked ? "axis" : null,
	]
		.filter(Boolean)
		.join(" · ");
	const withSuffix = (label: string): string =>
		suffix ? `${label} · ${suffix}` : label;
	switch (hit.role) {
		case "body":
			return withSuffix(
				`Body ${roundDisplayValue(values.point.x, 1)}, ${roundDisplayValue(values.point.y, 1)}`,
			);
		case "target":
			return withSuffix(
				`Target ${roundDisplayValue(values.point.x, 1)}, ${roundDisplayValue(values.point.y, 1)}`,
			);
		case "body-depth":
			return withSuffix(
				`Body Z ${roundDisplayValue(snapValue(start.bodyPosition.z + values.zDelta, SNAP_DEPTH_UNITS, modifiers), 1)}`,
			);
		case "target-depth":
			return withSuffix(
				`Target Z ${roundDisplayValue(snapValue(start.targetPoint.z + values.zDelta, SNAP_DEPTH_UNITS, modifiers), 1)}`,
			);
		case "rotation-x":
			return withSuffix(
				`Pitch ${roundDisplayValue(snapValue(start.bodyRotation.x + values.pitchDelta * ROTATION_DEGREES_PER_UNIT, SNAP_ROTATION_DEGREES, modifiers), 1)} deg`,
			);
		case "rotation-y":
			return withSuffix(
				`Yaw ${roundDisplayValue(snapValue(start.bodyRotation.y + values.yawDelta * ROTATION_DEGREES_PER_UNIT, SNAP_ROTATION_DEGREES, modifiers), 1)} deg`,
			);
		case "rotation-z":
			return withSuffix(
				`Roll ${roundDisplayValue(snapValue(start.bodyRotation.z + values.rollDelta * ROTATION_DEGREES_PER_UNIT, SNAP_ROTATION_DEGREES, modifiers), 1)} deg`,
			);
		case "focus":
			return withSuffix(
				`Focus ${roundDisplayValue(Math.max(1, snapValue(start.focusDistance + values.focusDelta, SNAP_FOCUS_UNITS, modifiers)), 1)}`,
			);
		case "aperture":
			return withSuffix(
				`Aperture ${roundDisplayValue(Math.max(0, snapValue(start.aperture + values.apertureDelta, SNAP_APERTURE_UNITS, modifiers)), 2)}`,
			);
	}
}
