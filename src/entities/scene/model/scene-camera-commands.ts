import { castDraft, type Draft } from "immer";
import { createId } from "@/shared/lib/id";
import type { SceneCommand } from "./command";
import { cloneSceneDocument } from "./factory";
import { validateMotionParentTarget } from "./motion-relations";
import { findDraftNode } from "./selectors";
import {
	type AffineMatrix2D,
	type Artboard,
	IDENTITY_TRANSFORM,
	type MotionControllerNodeContract,
	type MotionParentBinding,
	type SceneCameraRigContract,
	type SceneDepthPlaneContract,
	type SceneDocument,
	type Vec3,
	type VectorNode,
} from "./types";

const DEFAULT_CAMERA_DISTANCE = 1000;
const DEFAULT_CONTROLLER_RADIUS = 10;
export type SceneCameraRigPatch = {
	readonly name?: string;
	readonly scope?: SceneCameraRigContract["scope"];
	readonly projection?: Partial<SceneCameraRigContract["projection"]>;
	readonly body?: Partial<
		Omit<
			SceneCameraRigContract["body"],
			"position" | "rotation" | "parentControllerNodeId"
		>
	> & {
		readonly position?: Partial<Vec3>;
		readonly rotation?: Partial<Vec3>;
		readonly parentControllerNodeId?: string | null;
	};
	readonly target?:
		| (Partial<
				Omit<
					NonNullable<SceneCameraRigContract["target"]>,
					"point" | "nodeId" | "parentControllerNodeId"
				>
		  > & {
				readonly point?: Partial<Vec3>;
				readonly nodeId?: string | null;
				readonly parentControllerNodeId?: string | null;
		  })
		| null;
	readonly parentControllerNodeId?: string | null;
};

export type AddSceneCameraCommandOptions = {
	readonly activateArtboardId?: string | null;
	readonly label?: string;
};

export type UpdateSceneCameraCommandOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

export type SetActiveSceneCameraCommandOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

export type SetDepthPlaneCommandOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

export type BuildSceneCameraRigOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly artboardId?: string | null;
	readonly targetPoint?: Partial<Vec3>;
	readonly bodyPosition?: Partial<Vec3>;
	readonly projection?: Partial<SceneCameraRigContract["projection"]>;
	readonly targetControllerNodeId?: string | null;
};

export type BuildMotionControllerNodeOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly artboardId?: string | null;
	readonly position?: Partial<Vec3>;
	readonly handleRadius?: number;
	readonly visible?: boolean;
};

const isFiniteNumber = (value: number | undefined): value is number =>
	typeof value === "number" && Number.isFinite(value);

const finiteOr = (value: number | undefined, fallback: number): number =>
	isFiniteNumber(value) ? value : fallback;

const positiveOrUndefined = (value: number | undefined): number | undefined =>
	isFiniteNumber(value) && value > 0 ? value : undefined;

const nonNegativeOrUndefined = (
	value: number | undefined,
): number | undefined =>
	isFiniteNumber(value) && value >= 0 ? value : undefined;

const cleanedString = (
	value: string | null | undefined,
): string | undefined => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const nextSceneCameraName = (
	document: SceneDocument,
	artboardId: string,
): string => {
	const names = new Set(
		(document.sceneCameras ?? [])
			.filter(
				(camera) =>
					camera.scope.kind === "scene" ||
					(camera.scope.kind === "artboard" &&
						camera.scope.artboardId === artboardId),
			)
			.map((camera) => camera.name.trim().toLocaleLowerCase()),
	);
	const base = "Scene Camera";
	if (!names.has(base.toLocaleLowerCase())) return base;
	let suffix = 2;
	while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
	return `${base} ${suffix}`;
};

const finiteVec3 = (
	value: Partial<Vec3> | undefined,
	fallback: Vec3,
): Vec3 => ({
	x: finiteOr(value?.x, fallback.x),
	y: finiteOr(value?.y, fallback.y),
	z: finiteOr(value?.z, fallback.z),
});

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const cameraRigScopesArtboard = (
	rig: Pick<SceneCameraRigContract, "scope">,
	artboardId: string,
): boolean =>
	rig.scope.kind === "scene" ||
	(rig.scope.kind === "artboard" && rig.scope.artboardId === artboardId);

const findDraftArtboard = (
	draft: Draft<SceneDocument>,
	artboardId: string,
): Draft<Artboard> | undefined => {
	if (draft.artboard.id === artboardId) return draft.artboard;
	return draft.artboards?.find((artboard) => artboard.id === artboardId);
};

const updateDraftArtboard = (
	draft: Draft<SceneDocument>,
	artboardId: string,
	visit: (artboard: Draft<Artboard>) => void,
): boolean => {
	let found = false;
	if (draft.artboard.id === artboardId) {
		visit(draft.artboard);
		found = true;
	}
	for (const artboard of draft.artboards ?? []) {
		if (artboard.id !== artboardId) continue;
		visit(artboard);
		found = true;
	}
	return found;
};

const findDraftCameraRig = (
	draft: Draft<SceneDocument>,
	cameraRigId: string,
): Draft<SceneCameraRigContract> | undefined =>
	draft.sceneCameras?.find((rig) => rig.id === cameraRigId);

const normalizeProjection = (
	projection: Partial<SceneCameraRigContract["projection"]>,
	fallback: SceneCameraRigContract["projection"] = { kind: "orthographic" },
): SceneCameraRigContract["projection"] => {
	const fovDegrees = positiveOrUndefined(projection.fovDegrees);
	const zoom = positiveOrUndefined(projection.zoom);
	const focalLengthMm = positiveOrUndefined(projection.focalLengthMm);
	const focusDistance = positiveOrUndefined(projection.focusDistance);
	const aperture = nonNegativeOrUndefined(projection.aperture);
	const near = positiveOrUndefined(projection.near);
	const far = positiveOrUndefined(projection.far);
	return {
		...fallback,
		kind: projection.kind ?? fallback.kind,
		...(fovDegrees !== undefined ? { fovDegrees } : {}),
		...(zoom !== undefined ? { zoom } : {}),
		...(focalLengthMm !== undefined ? { focalLengthMm } : {}),
		...(focusDistance !== undefined ? { focusDistance } : {}),
		...(aperture !== undefined ? { aperture } : {}),
		...(near !== undefined ? { near } : {}),
		...(far !== undefined && (near === undefined || far > near) ? { far } : {}),
	};
};

const normalizeDepthPlane = (
	depthPlane: SceneDepthPlaneContract,
): SceneDepthPlaneContract | null => {
	if (!Number.isFinite(depthPlane.z)) return null;
	return {
		kind: "depth-plane",
		version: 1,
		z: depthPlane.z,
		...(depthPlane.billboarding
			? { billboarding: depthPlane.billboarding }
			: {}),
		...(cleanedString(depthPlane.cameraRigId)
			? { cameraRigId: cleanedString(depthPlane.cameraRigId) }
			: {}),
	};
};

const normalizeMotionController = (
	controller: MotionControllerNodeContract,
): MotionControllerNodeContract => ({
	kind: "motion-controller",
	...(positiveOrUndefined(controller.handleRadius) !== undefined
		? { handleRadius: positiveOrUndefined(controller.handleRadius) }
		: {}),
});

const normalizeBindMatrix = (matrix: AffineMatrix2D): AffineMatrix2D | null =>
	Object.values(matrix).every(
		(value) => typeof value === "number" && Number.isFinite(value),
	)
		? { ...matrix }
		: null;

const normalizeMotionParentBinding = (
	binding: MotionParentBinding,
): MotionParentBinding | null => {
	const parentNodeId = cleanedString(binding.parentNodeId);
	if (!parentNodeId) return null;
	const bindMatrix = normalizeBindMatrix(binding.bindMatrix);
	if (!bindMatrix) return null;
	return {
		parentNodeId,
		bindMatrix,
	};
};

const sanitizeNewSceneCameraRig = (
	rig: SceneCameraRigContract,
): SceneCameraRigContract | null => {
	const id = cleanedString(rig.id);
	if (!id) return null;
	const name = cleanedString(rig.name) ?? "Scene Camera";
	const projection = normalizeProjection(rig.projection);
	const bodyParentControllerNodeId = cleanedString(
		rig.body.parentControllerNodeId,
	);
	const body = {
		position: finiteVec3(rig.body.position, { x: 0, y: 0, z: -1 }),
		...(rig.body.rotation
			? { rotation: finiteVec3(rig.body.rotation, { x: 0, y: 0, z: 0 }) }
			: {}),
		...(bodyParentControllerNodeId
			? { parentControllerNodeId: bodyParentControllerNodeId }
			: {}),
	};
	const targetPoint = rig.target
		? finiteVec3(rig.target.point, { x: 0, y: 0, z: 0 })
		: undefined;
	const targetNodeId = cleanedString(rig.target?.nodeId);
	const targetParentControllerNodeId = cleanedString(
		rig.target?.parentControllerNodeId,
	);
	const target = targetPoint
		? {
				point: targetPoint,
				...(targetNodeId ? { nodeId: targetNodeId } : {}),
				...(targetParentControllerNodeId
					? { parentControllerNodeId: targetParentControllerNodeId }
					: {}),
			}
		: undefined;
	const parentControllerNodeId = cleanedString(rig.parentControllerNodeId);
	return {
		id,
		name,
		version: 1,
		scope: rig.scope,
		projection,
		body,
		...(target ? { target } : {}),
		...(parentControllerNodeId ? { parentControllerNodeId } : {}),
	};
};

const setArtboardActiveCamera = (
	artboard: Draft<Artboard>,
	cameraRigId: string | null,
): void => {
	if (cameraRigId) {
		artboard.activeSceneCameraId = cameraRigId;
		return;
	}
	delete artboard.activeSceneCameraId;
};

const applySceneCameraRigPatch = (
	rig: Draft<SceneCameraRigContract>,
	patch: SceneCameraRigPatch,
): void => {
	const name = cleanedString(patch.name);
	if (name) rig.name = name;
	if (patch.scope) rig.scope = castDraft(cloneSceneDocument(patch.scope));
	if (patch.projection) {
		rig.projection = castDraft(
			normalizeProjection(patch.projection, cloneSceneDocument(rig.projection)),
		);
	}
	if (patch.body) {
		if (patch.body.position) {
			rig.body.position = finiteVec3(patch.body.position, rig.body.position);
		}
		if (patch.body.rotation) {
			rig.body.rotation = finiteVec3(
				patch.body.rotation,
				rig.body.rotation ?? { x: 0, y: 0, z: 0 },
			);
		}
		if (patch.body.parentControllerNodeId !== undefined) {
			const parentControllerNodeId = cleanedString(
				patch.body.parentControllerNodeId,
			);
			if (parentControllerNodeId) {
				rig.body.parentControllerNodeId = parentControllerNodeId;
			} else {
				delete rig.body.parentControllerNodeId;
			}
		}
	}
	if (patch.target !== undefined) {
		if (patch.target === null) {
			delete rig.target;
		} else {
			const fallbackTarget = rig.target?.point ?? { x: 0, y: 0, z: 0 };
			const nextTarget: {
				point: Vec3;
				nodeId?: string;
				parentControllerNodeId?: string;
			} = {
				...(rig.target?.nodeId ? { nodeId: rig.target.nodeId } : {}),
				...(rig.target?.parentControllerNodeId
					? { parentControllerNodeId: rig.target.parentControllerNodeId }
					: {}),
				point: finiteVec3(patch.target.point, fallbackTarget),
			};
			const nodeId = cleanedString(patch.target.nodeId);
			if (patch.target.nodeId !== undefined) {
				if (nodeId) {
					nextTarget.nodeId = nodeId;
				} else {
					delete nextTarget.nodeId;
				}
			}
			const parentControllerNodeId = cleanedString(
				patch.target.parentControllerNodeId,
			);
			if (patch.target.parentControllerNodeId !== undefined) {
				if (parentControllerNodeId) {
					nextTarget.parentControllerNodeId = parentControllerNodeId;
				} else {
					delete nextTarget.parentControllerNodeId;
				}
			}
			rig.target = castDraft(nextTarget);
		}
	}
	if (patch.parentControllerNodeId !== undefined) {
		const parentControllerNodeId = cleanedString(patch.parentControllerNodeId);
		if (parentControllerNodeId) {
			rig.parentControllerNodeId = parentControllerNodeId;
		} else {
			delete rig.parentControllerNodeId;
		}
	}
};

/**
 * Builds a camera rig centered on one artboard. Callers can precompute this plan
 * before applying commands so UI selection and layer rows know the minted id.
 */
export function buildSceneCameraRigForArtboard(
	document: SceneDocument,
	options: BuildSceneCameraRigOptions = {},
): SceneCameraRigContract | null {
	const artboardId =
		options.artboardId ?? document.currentArtboardId ?? document.artboard.id;
	const artboard =
		(artboardId
			? document.artboards?.find((candidate) => candidate.id === artboardId)
			: undefined) ??
		(artboardId === document.artboard.id ? document.artboard : undefined);
	if (!artboard) return null;
	const center = {
		x: artboard.width / 2,
		y: artboard.height / 2,
		z: 0,
	};
	const distance = Math.max(
		artboard.width,
		artboard.height,
		DEFAULT_CAMERA_DISTANCE,
	);
	const targetPoint = options.targetControllerNodeId
		? { x: 0, y: 0, z: 0 }
		: finiteVec3(options.targetPoint, center);
	return {
		id: options.id ?? createId("scene-camera"),
		name:
			cleanedString(options.name) ?? nextSceneCameraName(document, artboard.id),
		version: 1,
		scope: { kind: "artboard", artboardId: artboard.id },
		projection: normalizeProjection(
			options.projection ?? { kind: "orthographic", zoom: 1 },
		),
		body: {
			position: finiteVec3(options.bodyPosition, {
				x: center.x,
				y: center.y,
				z: -distance,
			}),
		},
		target: {
			point: targetPoint,
			...(cleanedString(options.targetControllerNodeId)
				? {
						parentControllerNodeId: cleanedString(
							options.targetControllerNodeId,
						),
					}
				: {}),
		},
	};
}

/** Adds a prebuilt scene camera rig and optionally activates it for an artboard. */
export function createAddSceneCameraCommand(
	rig: SceneCameraRigContract,
	options: AddSceneCameraCommandOptions = {},
): SceneCommand {
	return {
		type: "scene-camera/add",
		label: options.label ?? "Create scene camera",
		coalesceKey: `scene-camera:add:${rig.id}`,
		run: (draft) => {
			const nextRig = sanitizeNewSceneCameraRig(rig);
			if (!nextRig) return;
			if (
				draft.sceneCameras?.some((candidate) => candidate.id === nextRig.id)
			) {
				return;
			}
			if (
				nextRig.scope.kind === "artboard" &&
				!findDraftArtboard(draft, nextRig.scope.artboardId)
			) {
				return;
			}
			if (!draft.sceneCameras) draft.sceneCameras = [];
			draft.sceneCameras.push(castDraft(nextRig));
			const activateArtboardId =
				options.activateArtboardId ??
				(nextRig.scope.kind === "artboard" ? nextRig.scope.artboardId : null);
			if (!activateArtboardId) return;
			updateDraftArtboard(draft, activateArtboardId, (artboard) => {
				setArtboardActiveCamera(artboard, nextRig.id);
			});
		},
	};
}

/** Updates camera rig fields without touching sampled renderer matrices. */
export function createUpdateSceneCameraCommand(
	cameraRigId: string,
	patch: SceneCameraRigPatch,
	options: UpdateSceneCameraCommandOptions = {},
): SceneCommand {
	return {
		type: "scene-camera/update",
		label: options.label ?? "Edit scene camera",
		coalesceKey: options.coalesceKey ?? `scene-camera:update:${cameraRigId}`,
		run: (draft) => {
			const rig = findDraftCameraRig(draft, cameraRigId);
			if (!rig) return;
			applySceneCameraRigPatch(rig, patch);
		},
	};
}

/** Sets or clears the active authored camera for one artboard. */
export function createSetActiveSceneCameraCommand(
	artboardId: string,
	cameraRigId: string | null,
	options: SetActiveSceneCameraCommandOptions = {},
): SceneCommand {
	return {
		type: "scene-camera/set-active",
		label:
			options.label ??
			(cameraRigId ? "Set active camera" : "Clear active camera"),
		coalesceKey:
			options.coalesceKey ??
			`scene-camera:active:${artboardId}:${cameraRigId ?? "none"}`,
		run: (draft) => {
			if (!findDraftArtboard(draft, artboardId)) return;
			if (cameraRigId) {
				const rig = findDraftCameraRig(draft, cameraRigId);
				if (!rig || !cameraRigScopesArtboard(rig, artboardId)) return;
			}
			updateDraftArtboard(draft, artboardId, (artboard) => {
				setArtboardActiveCamera(artboard, cameraRigId);
			});
		},
	};
}

/**
 * Removes a scene camera rig and clears artboard active-camera references to it.
 * Motion camera tracks are intentionally motion-side state and are removed by
 * `removeCameraRigTracks` from the motion command module when desired.
 */
export function createRemoveSceneCameraCommand(
	cameraRigId: string,
): SceneCommand {
	return {
		type: "scene-camera/remove",
		label: "Remove scene camera",
		run: (draft) => {
			const cameras = draft.sceneCameras;
			if (!cameras) return;
			const index = cameras.findIndex((rig) => rig.id === cameraRigId);
			if (index < 0) return;
			cameras.splice(index, 1);
			if (cameras.length === 0) draft.sceneCameras = undefined;
			const clearIfMatching = (artboard: Draft<Artboard>): void => {
				if (artboard.activeSceneCameraId === cameraRigId) {
					delete artboard.activeSceneCameraId;
				}
			};
			clearIfMatching(draft.artboard);
			for (const artboard of draft.artboards ?? []) clearIfMatching(artboard);
		},
	};
}

/** Assigns or removes a depth-plane contract on one or more scene nodes. */
export function createSetNodeDepthPlaneCommand(
	nodeIds: readonly string[],
	depthPlane: SceneDepthPlaneContract | null,
	options: SetDepthPlaneCommandOptions = {},
): SceneCommand {
	const normalized = depthPlane ? normalizeDepthPlane(depthPlane) : null;
	return {
		type: "scene-camera/set-depth-plane",
		label:
			options.label ?? (normalized ? "Set depth plane" : "Remove depth plane"),
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			for (const nodeId of nodeIds) {
				const node = findDraftNode(draft, nodeId);
				if (!node) continue;
				if (!normalized) {
					delete node.depthPlane;
					continue;
				}
				if (sameSerializable(node.depthPlane, normalized)) continue;
				node.depthPlane = castDraft(cloneSceneDocument(normalized));
			}
		},
	};
}

/** Marks or unmarks an existing node as a motion/null controller. */
export function createSetMotionControllerCommand(
	nodeId: string,
	controller: MotionControllerNodeContract | null,
): SceneCommand {
	const normalized = controller ? normalizeMotionController(controller) : null;
	return {
		type: "scene-camera/set-motion-controller",
		label: normalized ? "Set motion controller" : "Remove motion controller",
		coalesceKey: `scene-camera:controller:${nodeId}`,
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			if (!normalized) {
				delete node.motionController;
				return;
			}
			if (sameSerializable(node.motionController, normalized)) return;
			node.motionController = castDraft(cloneSceneDocument(normalized));
		},
	};
}

/** Parents or unparents one node to a motion/null controller. */
export function createSetMotionParentCommand(
	nodeId: string,
	binding: MotionParentBinding | null,
): SceneCommand {
	const normalized = binding ? normalizeMotionParentBinding(binding) : null;
	return {
		type: "scene-camera/set-motion-parent",
		label: normalized ? "Set motion parent" : "Remove motion parent",
		coalesceKey: `scene-camera:motion-parent:${nodeId}`,
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			if (!normalized) {
				delete node.motionParent;
				return;
			}
			if (
				validateMotionParentTarget(
					draft as unknown as SceneDocument,
					nodeId,
					normalized.parentNodeId,
				).length > 0
			) {
				return;
			}
			if (sameSerializable(node.motionParent, normalized)) return;
			node.motionParent = castDraft(cloneSceneDocument(normalized));
		},
	};
}

/**
 * Builds a hidden controller/null node for camera-target or camera-body rigging.
 * C6.6/C6.7 own how this becomes visible in Layers/canvas overlay.
 */
export function buildMotionControllerNode(
	document: SceneDocument,
	options: BuildMotionControllerNodeOptions = {},
): VectorNode | null {
	const artboardId =
		options.artboardId ?? document.currentArtboardId ?? document.artboard.id;
	const artboard =
		(artboardId
			? document.artboards?.find((candidate) => candidate.id === artboardId)
			: undefined) ??
		(artboardId === document.artboard.id ? document.artboard : undefined);
	if (!artboard) return null;
	const position = finiteVec3(options.position, {
		x: artboard.width / 2,
		y: artboard.height / 2,
		z: 0,
	});
	const radius =
		positiveOrUndefined(options.handleRadius) ?? DEFAULT_CONTROLLER_RADIUS;
	return {
		id: options.id ?? createId("motion-controller"),
		name: cleanedString(options.name) ?? "Camera Target",
		artboardId: artboard.id,
		geometry: {
			kind: "ellipse",
			bounds: {
				x: -radius,
				y: -radius,
				width: radius * 2,
				height: radius * 2,
			},
		},
		transform: {
			...IDENTITY_TRANSFORM,
			position: { x: position.x, y: position.y },
		},
		style: {
			fill: "none",
			stroke: "#2ec4b6",
			strokeWidth: 1,
			opacity: 1,
		},
		// Controllers are scene-visible for hit testing and direct transform
		// authoring; render/export adapters suppress their paint by role.
		visible: options.visible ?? true,
		locked: false,
		motionController: {
			kind: "motion-controller",
			handleRadius: radius,
		},
		depthPlane: {
			kind: "depth-plane",
			version: 1,
			z: position.z,
		},
	};
}

/** Appends a prebuilt motion/null controller node to a scene layer. */
export function createAddMotionControllerNodeCommand(
	node: VectorNode,
	options: { readonly layerId?: string; readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene-camera/add-motion-controller",
		label: options.label ?? "Create target null",
		coalesceKey: `scene-camera:add-controller:${node.id}`,
		run: (draft) => {
			if (draft.layers.length === 0) return;
			if (findDraftNode(draft, node.id)) return;
			const layer = options.layerId
				? draft.layers.find((candidate) => candidate.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!layer) return;
			layer.nodes.push(castDraft(cloneSceneDocument(node)));
		},
	};
}

/** Binds a camera target to a node while preserving the target point fallback. */
export function createBindSceneCameraTargetNodeCommand(
	cameraRigId: string,
	nodeId: string | null,
): SceneCommand {
	return {
		type: "scene-camera/bind-target-node",
		label: nodeId ? "Bind camera target" : "Clear camera target",
		coalesceKey: `scene-camera:target-node:${cameraRigId}`,
		run: (draft) => {
			if (nodeId && !findDraftNode(draft, nodeId)) return;
			const rig = findDraftCameraRig(draft, cameraRigId);
			if (!rig) return;
			const fallback = rig.target?.point ?? { x: 0, y: 0, z: 0 };
			if (!rig.target) rig.target = { point: fallback };
			if (nodeId) {
				rig.target.nodeId = nodeId;
				delete rig.target.parentControllerNodeId;
			} else {
				delete rig.target.nodeId;
				delete rig.target.parentControllerNodeId;
			}
		},
	};
}

/** Binds or clears a camera target controller/null. */
export function createBindSceneCameraTargetControllerCommand(
	cameraRigId: string,
	controllerNodeId: string | null,
): SceneCommand {
	return {
		type: "scene-camera/bind-target-controller",
		label: controllerNodeId
			? "Bind camera target null"
			: "Clear camera target null",
		coalesceKey: `scene-camera:target-controller:${cameraRigId}`,
		run: (draft) => {
			if (controllerNodeId && !findDraftNode(draft, controllerNodeId)) return;
			const rig = findDraftCameraRig(draft, cameraRigId);
			if (!rig) return;
			const fallback = rig.target?.point ?? { x: 0, y: 0, z: 0 };
			if (!rig.target) rig.target = { point: fallback };
			if (controllerNodeId) {
				rig.target.parentControllerNodeId = controllerNodeId;
				delete rig.target.nodeId;
			} else {
				delete rig.target.parentControllerNodeId;
				delete rig.target.nodeId;
			}
		},
	};
}

/** Binds or clears a camera body controller/null. */
export function createBindSceneCameraBodyControllerCommand(
	cameraRigId: string,
	controllerNodeId: string | null,
): SceneCommand {
	return {
		type: "scene-camera/bind-body-controller",
		label: controllerNodeId
			? "Bind camera body null"
			: "Clear camera body null",
		coalesceKey: `scene-camera:body-controller:${cameraRigId}`,
		run: (draft) => {
			if (controllerNodeId && !findDraftNode(draft, controllerNodeId)) return;
			const rig = findDraftCameraRig(draft, cameraRigId);
			if (!rig) return;
			if (controllerNodeId) {
				rig.body.parentControllerNodeId = controllerNodeId;
			} else {
				delete rig.body.parentControllerNodeId;
			}
		},
	};
}
