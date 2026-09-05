import { externalSceneAssetForGeometry } from "@/entities/scene/model/assets";
import type {
	ExternalProductionCameraContract,
	ExternalProductionLink,
} from "@/entities/scene/model/production-link";
import { EXTERNAL_PRODUCTION_LINK_CONTRACT_VERSION } from "@/entities/scene/model/production-link";
import type { ProductionLinkSourceOffer } from "@/entities/scene/model/production-link-protocol";
import {
	allNodes,
	findArtboardById,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";

/**
 * Authors the one-time seed for a linked production. `createLinkProductionCommand`
 * only ever *replaces* an existing link (see its own doc comment), so the first
 * `scene/link-production` write for an asset must already carry a complete,
 * valid contract — including the camera, which this module derives once from
 * the placement's active scene camera and which the workflow's own inspect
 * cycle never touches afterward. Vecmo stays authoritative for that half of the
 * contract; only source/frame/profile/controls are ever adopted from a fresh
 * inspect.
 */

const DEFAULT_VERTICAL_FOV_DEGREES = 50;

/**
 * Vecmo authors in scene pixels directly, so one Vecmo world unit is one scene
 * pixel by construction; this is not a measurement, it is the project's own
 * coordinate convention.
 */
const SCENE_UNITS_PER_PIXEL = 1;

const randomLinkId = (): string => globalThis.crypto.randomUUID();

export type CameraContractResolution =
	| {
			readonly ok: true;
			readonly contract: ExternalProductionCameraContract;
			/** The placement artboard's own frame contract, reused as the link seed. */
			readonly fps: number;
			readonly durationFrames: number;
	  }
	| { readonly ok: false; readonly reason: string };

/**
 * Finds the one placement node in the document that references this asset,
 * then derives a static camera contract from its artboard's active scene
 * camera rig. Fails closed with a typed reason rather than fabricating a
 * camera the source was never authored against, per the Camera-First Motion
 * Standard.
 */
export function resolvePerspectiveCameraContract(
	document: SceneDocument,
	assetId: string,
): CameraContractResolution {
	const placementNode = allNodes(document).find(
		(node) =>
			node.geometry.kind === "image" &&
			externalSceneAssetForGeometry(document, node.geometry)?.id === assetId,
	);
	if (!placementNode) {
		return {
			ok: false,
			reason: "Place this asset in the scene before linking a Blender source.",
		};
	}
	const artboardId = selectArtboardIdForNode(document, placementNode.id);
	const artboard = findArtboardById(document, artboardId);
	if (!artboard) {
		return {
			ok: false,
			reason: "The placement's artboard could not be resolved.",
		};
	}
	if (!artboard.activeSceneCameraId) {
		return {
			ok: false,
			reason:
				"This artboard has no active scene camera. Add one before linking.",
		};
	}
	const rig = document.sceneCameras?.find(
		(candidate) => candidate.id === artboard.activeSceneCameraId,
	);
	if (!rig) {
		return { ok: false, reason: "The active scene camera rig is missing." };
	}
	if (rig.projection.kind !== "perspective") {
		return {
			ok: false,
			reason:
				"The active scene camera is orthographic. A perspective scene camera is required to link a Blender source.",
		};
	}
	const fovDegrees =
		rig.projection.fovDegrees && rig.projection.fovDegrees > 0
			? rig.projection.fovDegrees
			: DEFAULT_VERTICAL_FOV_DEGREES;
	return {
		ok: true,
		contract: {
			mode: "vecmo-shot-camera",
			sceneCameraRigId: rig.id,
			verticalFovRadians: (fovDegrees * Math.PI) / 180,
			sceneUnitsPerPixel: SCENE_UNITS_PER_PIXEL,
			sensorFit: "VERTICAL",
		},
		fps: artboard.fps,
		durationFrames: artboard.durationFrames,
	};
}

/**
 * Builds the initial durable link contract for one chosen companion source
 * offer. This is intentionally the only place a fresh `linkId` is minted; every
 * later rebind/refresh/rebuild reuses it so the artifact cache, the
 * working-copy registry, and undo history all key off the same identity.
 */
export function createInitialProductionLink({
	camera,
	sourceOffer,
	fps,
	durationFrames,
}: {
	readonly camera: ExternalProductionCameraContract;
	readonly sourceOffer: ProductionLinkSourceOffer;
	readonly fps: number;
	readonly durationFrames: number;
}): ExternalProductionLink {
	return {
		contractVersion: EXTERNAL_PRODUCTION_LINK_CONTRACT_VERSION,
		adapter: "blender",
		linkId: randomLinkId(),
		source: { displayName: sourceOffer.displayName },
		frame: {
			fps: fps > 0 ? fps : 24,
			durationFrames: Math.max(1, Math.round(durationFrames)),
			blenderFrameStart: 0,
		},
		camera,
		outputProfile: "interactive-glb",
		controls: [],
	};
}
