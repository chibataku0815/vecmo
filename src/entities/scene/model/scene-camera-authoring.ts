import { resolveSceneCameraTargetPoints } from "./scene-camera";
import {
	allNodes,
	findArtboardById,
	findNode,
	selectAllArtboards,
	selectArtboardIdForNode,
	selectCurrentArtboard,
} from "./selectors";
import type {
	Artboard,
	SceneCameraRigContract,
	SceneDepthPlaneContract,
	SceneDocument,
	Vec3,
	VectorNode,
} from "./types";

export type SceneCameraDepthPreset =
	| "off"
	| "background"
	| "midground"
	| "foreground";

export const SCENE_CAMERA_DEPTH_PRESETS = {
	background: -400,
	midground: 0,
	foreground: 400,
} as const satisfies Record<Exclude<SceneCameraDepthPreset, "off">, number>;

export type SceneCameraControllerReadModel = {
	readonly node: VectorNode;
	readonly artboardId?: string;
};

export type SceneCameraDepthNodeReadModel = {
	readonly node: VectorNode;
	readonly artboardId?: string;
	readonly depthPlane: SceneDepthPlaneContract;
	readonly preset: SceneCameraDepthPreset | "custom";
};

/** Effective target source and capabilities shared by camera authoring surfaces. */
export type SceneCameraTargetReadModel = {
	readonly source:
		| "free-point"
		| "node"
		| "controller"
		| "stale-node"
		| "stale-controller"
		| "conflict";
	readonly point: Vec3;
	readonly fallbackPoint: Vec3;
	readonly bound: boolean;
	readonly editable: boolean;
	readonly keyable: boolean;
	readonly conflict: boolean;
	readonly driverNode?: VectorNode;
	readonly staleNodeId?: string;
};

export type SceneCameraRigReadModel = {
	readonly rig: SceneCameraRigContract;
	readonly active: boolean;
	readonly scopedArtboardIds: readonly string[];
	readonly targetNode?: VectorNode;
	readonly bodyController?: VectorNode;
	readonly targetController?: VectorNode;
	readonly target: SceneCameraTargetReadModel;
};

export type SceneCameraAuthoringState = {
	readonly artboard: Artboard;
	readonly activeCameraRigId?: string;
	readonly activeCamera?: SceneCameraRigReadModel;
	readonly cameras: readonly SceneCameraRigReadModel[];
	readonly controllers: readonly SceneCameraControllerReadModel[];
	readonly depthNodes: readonly SceneCameraDepthNodeReadModel[];
};

export type SceneCameraAuthoringSelection =
	| { readonly kind: "camera-rig"; readonly cameraRigId: string }
	| { readonly kind: "camera-body"; readonly cameraRigId: string }
	| { readonly kind: "camera-target"; readonly cameraRigId: string }
	| {
			readonly kind: "motion-controller";
			readonly nodeId: string;
			readonly cameraRigId?: string;
			readonly role?: "body" | "target" | "free";
	  };

export type ResolvedSceneCameraAuthoringSelection =
	| { readonly status: "none" }
	| {
			readonly status: "camera";
			readonly selection: Extract<
				SceneCameraAuthoringSelection,
				{ readonly cameraRigId: string }
			>;
			readonly role: "camera-rig" | "camera-body" | "camera-target";
			readonly camera: SceneCameraRigReadModel;
	  }
	| {
			readonly status: "controller";
			readonly selection: Extract<
				SceneCameraAuthoringSelection,
				{ readonly kind: "motion-controller" }
			>;
			readonly controller: SceneCameraControllerReadModel;
			readonly camera?: SceneCameraRigReadModel;
	  }
	| {
			readonly status: "stale";
			readonly selection: SceneCameraAuthoringSelection;
			readonly reason: "missing-camera" | "missing-controller";
	  };

const cameraRigScopesArtboard = (
	rig: SceneCameraRigContract,
	artboardId: string,
): boolean =>
	rig.scope.kind === "scene" ||
	(rig.scope.kind === "artboard" && rig.scope.artboardId === artboardId);

const scopedArtboardIds = (
	scene: SceneDocument,
	rig: SceneCameraRigContract,
): readonly string[] =>
	rig.scope.kind === "scene"
		? selectAllArtboards(scene).map((artboard) => artboard.id)
		: [rig.scope.artboardId];

/** Resolves the effective GUI target and its authored free/local point. */
export function readSceneCameraTarget(
	rig: SceneCameraRigContract,
	resolvedPoint: Vec3,
	targetNode?: VectorNode,
	targetController?: VectorNode,
): SceneCameraTargetReadModel {
	const fallbackPoint = rig.target?.point ?? { x: 0, y: 0, z: 0 };
	const targetNodeId = rig.target?.nodeId;
	const targetControllerId = rig.target?.parentControllerNodeId;
	const conflict = Boolean(targetNodeId && targetControllerId);

	if (targetNode) {
		return {
			source: conflict ? "conflict" : "node",
			point: resolvedPoint,
			fallbackPoint,
			bound: true,
			editable: false,
			keyable: false,
			conflict,
			driverNode: targetNode,
		};
	}
	if (targetNodeId && !targetController) {
		return {
			source: "stale-node",
			point: fallbackPoint,
			fallbackPoint,
			bound: true,
			editable: false,
			keyable: false,
			conflict,
			staleNodeId: targetNodeId,
		};
	}
	if (targetController) {
		return {
			source: conflict ? "conflict" : "controller",
			point: resolvedPoint,
			fallbackPoint,
			bound: true,
			editable: false,
			keyable: false,
			conflict,
			driverNode: targetController,
		};
	}
	if (targetControllerId) {
		return {
			source: "stale-controller",
			point: fallbackPoint,
			fallbackPoint,
			bound: true,
			editable: false,
			keyable: false,
			conflict,
			staleNodeId: targetControllerId,
		};
	}
	return {
		source: "free-point",
		point: fallbackPoint,
		fallbackPoint,
		bound: false,
		editable: true,
		keyable: true,
		conflict: false,
	};
}

/** Converts the friendly depth preset used by UI controls into scene data. */
export function sceneCameraDepthPlaneForPreset(
	preset: SceneCameraDepthPreset,
	cameraRigId?: string | null,
): SceneDepthPlaneContract | null {
	if (preset === "off") return null;
	return {
		kind: "depth-plane",
		version: 1,
		z: SCENE_CAMERA_DEPTH_PRESETS[preset],
		...(cameraRigId ? { cameraRigId } : {}),
	};
}

/** Returns the closest named UI preset for an authored depth value. */
export function sceneCameraDepthPresetForZ(
	z: number,
): SceneCameraDepthPreset | "custom" {
	for (const [preset, presetZ] of Object.entries(SCENE_CAMERA_DEPTH_PRESETS)) {
		if (Object.is(z, presetZ)) return preset as SceneCameraDepthPreset;
	}
	return "custom";
}

/**
 * Builds the camera authoring read model that Inspector, Layers, Timeline, and
 * canvas overlay can share. It is intentionally read-only and owns no UI state.
 */
export function readSceneCameraAuthoringState(
	scene: SceneDocument,
	artboardId: string = selectCurrentArtboard(scene).id,
): SceneCameraAuthoringState {
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	const nodes = allNodes(scene);
	const controllers = nodes
		.filter((node) => node.motionController?.kind === "motion-controller")
		.map((node) => ({
			node,
			artboardId: selectArtboardIdForNode(scene, node.id),
		}));
	const depthNodes = nodes.flatMap((node) => {
		if (!node.depthPlane) return [];
		return [
			{
				node,
				artboardId: selectArtboardIdForNode(scene, node.id),
				depthPlane: node.depthPlane,
				preset: sceneCameraDepthPresetForZ(node.depthPlane.z),
			},
		];
	});
	const cameraRigs = scene.sceneCameras ?? [];
	const targetPoints = resolveSceneCameraTargetPoints(
		scene,
		cameraRigs,
		artboard.id,
	);
	const cameras = cameraRigs.map((rig) => {
		const targetNode = rig.target?.nodeId
			? findNode(scene, rig.target.nodeId)
			: undefined;
		const bodyController = rig.body.parentControllerNodeId
			? findNode(scene, rig.body.parentControllerNodeId)
			: undefined;
		const targetController = rig.target?.parentControllerNodeId
			? findNode(scene, rig.target.parentControllerNodeId)
			: undefined;
		const target = readSceneCameraTarget(
			rig,
			targetPoints.get(rig.id) ?? rig.target?.point ?? { x: 0, y: 0, z: 0 },
			targetNode,
			targetController,
		);
		const model = {
			rig,
			active:
				artboard.activeSceneCameraId === rig.id &&
				cameraRigScopesArtboard(rig, artboard.id),
			scopedArtboardIds: scopedArtboardIds(scene, rig),
			...(targetNode ? { targetNode } : {}),
			...(bodyController ? { bodyController } : {}),
			...(targetController ? { targetController } : {}),
			target,
		};
		return model satisfies SceneCameraRigReadModel;
	});
	const activeCamera = cameras.find((camera) => camera.active);
	return {
		artboard,
		...(artboard.activeSceneCameraId
			? { activeCameraRigId: artboard.activeSceneCameraId }
			: {}),
		...(activeCamera ? { activeCamera } : {}),
		cameras,
		controllers,
		depthNodes,
	};
}

/**
 * Resolves the camera-specific selection channel without coercing camera rigs
 * into vector-node ids. Canvas, Layers, Inspector, and agent/MCP surfaces can use
 * this as the common read side of C6.2 selection.
 */
export function resolveSceneCameraAuthoringSelection(
	scene: SceneDocument,
	selection: SceneCameraAuthoringSelection | null,
	artboardId?: string,
): ResolvedSceneCameraAuthoringSelection {
	if (!selection) return { status: "none" };
	const state = readSceneCameraAuthoringState(scene, artboardId);
	if (selection.kind === "motion-controller") {
		const controller = state.controllers.find(
			(candidate) => candidate.node.id === selection.nodeId,
		);
		if (!controller) {
			return {
				status: "stale",
				selection,
				reason: "missing-controller",
			};
		}
		const camera = selection.cameraRigId
			? state.cameras.find(
					(candidate) => candidate.rig.id === selection.cameraRigId,
				)
			: undefined;
		return {
			status: "controller",
			selection,
			controller,
			...(camera ? { camera } : {}),
		};
	}
	const camera = state.cameras.find(
		(candidate) => candidate.rig.id === selection.cameraRigId,
	);
	if (!camera) {
		return {
			status: "stale",
			selection,
			reason: "missing-camera",
		};
	}
	return {
		status: "camera",
		selection,
		role: selection.kind,
		camera,
	};
}
