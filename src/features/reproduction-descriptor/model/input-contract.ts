import type { CameraSpacePolicy } from "@/entities/scene/model/types";

/** Motion ownership vocabulary accepted from an upstream reproduction descriptor. */
export type ReproductionMotionAttribution =
	| "node_track"
	| "camera_track"
	| "target_track"
	| "null_controller"
	| "depth_plane"
	| "mixed";

/**
 * Upstream role fields consumed by Vecmo's reproduction-descriptor adapter.
 * Additional provider fields remain outside the editable Vecmo document.
 */
export type MotionAuthoringRoleInput = {
	readonly id: string;
	readonly roleType?: string;
	readonly attentionFunction?: string;
	readonly driverBindings?: readonly string[];
	readonly geometryHint?: string;
	readonly cameraSpaceBinding?: {
		readonly depthPlane?: string | number;
		readonly motionAttribution?: ReproductionMotionAttribution;
		readonly mayBakeToNodeTracks?: boolean;
		readonly doNotBake?: readonly string[];
		readonly [field: string]: unknown;
	};
	readonly mustPreserve?: readonly string[];
	readonly mustNotBecome?: readonly string[];
	readonly [field: string]: unknown;
};

/**
 * Product-local input boundary for reproduction descriptors. It deliberately
 * models only the fields the importer reads while retaining both accepted
 * schema names; Forestone remains a possible producer, not a runtime package
 * dependency of the maintained Vecmo application.
 */
export type MotionAuthoringDescriptorInput = {
	readonly schema:
		| "forestone.motion-authoring-descriptor"
		| "motion_reproduction_descriptor";
	readonly id: string;
	readonly referencePacket?: {
		readonly targetWindowSec?: readonly [number, number];
		readonly [field: string]: unknown;
	};
	readonly conceptGate?: {
		readonly motionThesis?: string;
		readonly [field: string]: unknown;
	};
	readonly visibleRoles?: readonly MotionAuthoringRoleInput[];
	readonly cameraSpace?: {
		readonly policy?: CameraSpacePolicy;
		readonly motionAttribution?: readonly {
			readonly beatId?: string;
			readonly roleId?: string;
			readonly preferred?: ReproductionMotionAttribution;
			readonly components?: readonly ReproductionMotionAttribution[];
			readonly fallback?: ReproductionMotionAttribution;
			readonly fallbackCost?: string;
		}[];
		readonly depthPlaneAssignments?: readonly {
			readonly roleId: string;
			readonly depth?: string | number;
			readonly exactZ?: number;
			readonly required?: boolean;
			readonly note?: string;
		}[];
		readonly doNotBake?: readonly string[];
		readonly [field: string]: unknown;
	};
	readonly acceptanceChecks?: readonly {
		readonly id: string;
		readonly question?: string;
		readonly expectedEvidence?: string;
		readonly nearestFailureMode?: string;
		readonly responsibleLayer?: string;
		readonly ifFailUpdate?: string;
	}[];
	readonly [field: string]: unknown;
};
