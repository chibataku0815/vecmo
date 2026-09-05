// Pure import seam for upstream motion-production reference descriptors.
import { defaultEasedKeyframe } from "@/entities/motion/model/easing";
import type {
	KeyframeTrack,
	MotionDocument,
	ScalarAnimatableProperty,
} from "@/entities/motion/model/types";
import {
	EMPTY_GRAMMAR_DOCUMENT,
	type MotionGrammarStoreDocument,
} from "@/entities/motion-grammar/model/command";
import type {
	Artboard,
	CameraSpacePolicy,
	NodeStyle,
	SceneCameraRigContract,
	SceneDepthPlaneContract,
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	IDENTITY_TRANSFORM,
	SCENE_SCHEMA_VERSION,
} from "@/entities/scene/model/types";
import type {
	MotionAuthoringDescriptorInput,
	MotionAuthoringRoleInput,
} from "./input-contract";

type ReproductionDescriptorRole = MotionAuthoringRoleInput;

/**
 * Input subset consumed by Vecmo's first descriptor import seam. Extra fields in
 * the upstream descriptor are intentionally ignored here and should stay in the
 * descriptor artifact until a Vecmo primitive owns them.
 */
export type MotionReproductionDescriptor = MotionAuthoringDescriptorInput;

/**
 * Import diagnostic that keeps an unmapped or lossy descriptor claim tied to the
 * contract layer that should absorb the learning after a failed attempt.
 */
export type ReproductionDescriptorImportIssue = {
	readonly severity: "info" | "warning" | "error";
	readonly code: string;
	readonly message: string;
	readonly responsibleLayer:
		| "reference_packet"
		| "construction_signature"
		| "view_geometry"
		| "camera_space"
		| "descriptor"
		| "vecmo_primitive"
		| "acceptance";
	readonly roleId?: string;
	readonly beatId?: string;
};

/** Review row generated from descriptor acceptance checks before any render exists. */
export type ReproductionDescriptorAcceptanceScaffold = {
	readonly id: string;
	readonly status: "unreviewed";
	readonly question?: string;
	readonly expectedEvidence?: string;
	readonly nearestFailureMode?: string;
	readonly responsibleLayer?: string;
	readonly ifFailUpdate?: string;
};

/** Caller-provided document defaults for descriptor skeleton generation. */
export type ReproductionDescriptorImportOptions = {
	readonly sceneId?: string;
	readonly sceneName?: string;
	readonly artboardId?: string;
	readonly artboardSize?: {
		readonly width: number;
		readonly height: number;
	};
	readonly fps?: number;
};

/**
 * Descriptor import result for one editable Vecmo reproduction skeleton. The
 * documents can be loaded into the scene, motion, and grammar stores separately;
 * `issues` preserves unmapped descriptor claims so failed attempts still route
 * learning back to a concrete contract layer.
 */
export type ReproductionDescriptorImportResult = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar: MotionGrammarStoreDocument;
	readonly roleNodeIds: Readonly<Record<string, readonly string[]>>;
	readonly cameraRigId?: string;
	readonly acceptanceScaffold: readonly ReproductionDescriptorAcceptanceScaffold[];
	readonly issues: readonly ReproductionDescriptorImportIssue[];
};

type RoleLayout = {
	readonly forceCenter: Vec2;
	readonly eventPlaneY: number;
	readonly artboard: Artboard;
	readonly fps: number;
	readonly startSec: number;
};

const BACKGROUND_Z = -400;
const MIDGROUND_Z = 0;
const FOREGROUND_Z = 400;

const roleColors: Record<string, Pick<NodeStyle, "fill" | "stroke">> = {
	proof_probe: { fill: "#f8fafc", stroke: "#111827" },
	mass: { fill: "#111827", stroke: "#f8fafc" },
	body_family: { fill: "#dbeafe", stroke: "#1d4ed8" },
	event_plane: { fill: "#22c55e", stroke: "#14532d" },
};

const finiteOr = (value: number | undefined, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const safeIdPart = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "descriptor";

const descriptorIdPart = (descriptor: MotionReproductionDescriptor): string =>
	safeIdPart(descriptor.id);

const secondsWindow = (
	descriptor: MotionReproductionDescriptor,
): readonly [number, number] => {
	const window = descriptor.referencePacket?.targetWindowSec;
	if (
		window &&
		window.length === 2 &&
		Number.isFinite(window[0]) &&
		Number.isFinite(window[1]) &&
		window[1] > window[0]
	) {
		return window;
	}
	return [0, 6];
};

const frameAt = (seconds: number, layout: RoleLayout): number =>
	Math.max(0, Math.round((seconds - layout.startSec) * layout.fps));

const key = (time: number, value: number) =>
	defaultEasedKeyframe({ time, value });

const track = (
	nodeId: string,
	property: ScalarAnimatableProperty,
	keyframes: readonly ReturnType<typeof key>[],
): KeyframeTrack<number> => ({
	id: `track:${nodeId}:${property}`,
	target: { nodeId, property },
	keyframes,
});

const baseStyle = (roleId: string): NodeStyle => {
	const colors = roleColors[roleId] ?? { fill: "#e5e7eb", stroke: "#111827" };
	return {
		fill: colors.fill,
		stroke: colors.stroke,
		strokeWidth: 2,
		opacity: 1,
	};
};

const depthZFor = (depth: string | number | undefined, variant = 0): number => {
	if (typeof depth === "number" && Number.isFinite(depth)) return depth;
	switch (depth) {
		case "background":
			return BACKGROUND_Z;
		case "foreground":
		case "foreground_or_secondary_base":
			return FOREGROUND_Z;
		case "mixed_depth_family":
			return (
				[FOREGROUND_Z, MIDGROUND_Z, BACKGROUND_Z][variant % 3] ?? MIDGROUND_Z
			);
		default:
			return MIDGROUND_Z;
	}
};

const depthPlaneFor = (
	depth: string | number | undefined,
	cameraRigId: string | undefined,
	variant = 0,
): SceneDepthPlaneContract | undefined => {
	if (depth === "off") return undefined;
	return {
		kind: "depth-plane",
		version: 1,
		z: depthZFor(depth, variant),
		billboarding: "screen-facing",
		...(cameraRigId ? { cameraRigId } : {}),
	};
};

const roleDepthPolicy = (
	descriptor: MotionReproductionDescriptor,
	role: ReproductionDescriptorRole,
): string | number | undefined => {
	const assignment = descriptor.cameraSpace?.depthPlaneAssignments?.find(
		(candidate) => candidate.roleId === role.id,
	);
	return (
		assignment?.exactZ ??
		assignment?.depth ??
		role.cameraSpaceBinding?.depthPlane ??
		"midground"
	);
};

const nodeData = (
	descriptor: MotionReproductionDescriptor,
	role: ReproductionDescriptorRole,
) => ({
	reproductionDescriptorRole: {
		schemaVersion: 1,
		descriptorId: descriptor.id,
		roleId: role.id,
		roleType: role.roleType,
		attentionFunction: role.attentionFunction,
		driverBindings: role.driverBindings ?? [],
		geometryHint: role.geometryHint,
		motionAttribution: role.cameraSpaceBinding?.motionAttribution,
		mustPreserve: role.mustPreserve ?? [],
		mustNotBecome: role.mustNotBecome ?? [],
	},
});

const createRoleNode = (
	descriptor: MotionReproductionDescriptor,
	role: ReproductionDescriptorRole,
	idSuffix: string,
	geometry: VectorNode["geometry"],
	position: Vec2,
	layout: RoleLayout,
	cameraRigId: string | undefined,
	variant = 0,
): VectorNode => ({
	id: `${descriptorIdPart(descriptor)}:${role.id}:${idSuffix}`,
	name: `${role.id.replace(/_/g, " ")} ${idSuffix}`,
	artboardId: layout.artboard.id,
	geometry,
	transform: {
		...IDENTITY_TRANSFORM,
		position,
	},
	style: baseStyle(role.id),
	visible: true,
	locked: false,
	data: nodeData(descriptor, role),
	...(depthPlaneFor(roleDepthPolicy(descriptor, role), cameraRigId, variant)
		? {
				depthPlane: depthPlaneFor(
					roleDepthPolicy(descriptor, role),
					cameraRigId,
					variant,
				),
			}
		: {}),
});

const createControllerNode = (
	descriptor: MotionReproductionDescriptor,
	layout: RoleLayout,
	cameraRigId: string,
): VectorNode => ({
	id: `${descriptorIdPart(descriptor)}:force-center-null`,
	name: "force center null",
	artboardId: layout.artboard.id,
	geometry: {
		kind: "ellipse",
		bounds: { x: -10, y: -10, width: 20, height: 20 },
	},
	transform: {
		...IDENTITY_TRANSFORM,
		position: layout.forceCenter,
	},
	style: {
		fill: "none",
		stroke: "#2ec4b6",
		strokeWidth: 1,
		opacity: 1,
	},
	visible: false,
	locked: false,
	motionController: {
		kind: "motion-controller",
		handleRadius: 10,
	},
	depthPlane: {
		kind: "depth-plane",
		version: 1,
		z: MIDGROUND_Z,
		billboarding: "screen-facing",
		cameraRigId,
	},
	data: {
		reproductionDescriptorDriver: {
			schemaVersion: 1,
			descriptorId: descriptor.id,
			driverId: "forceCenter",
			role: "camera-target-null",
		},
	},
});

const createCameraRig = (
	descriptor: MotionReproductionDescriptor,
	layout: RoleLayout,
	controllerNodeId: string,
): SceneCameraRigContract => {
	const distance = Math.max(
		layout.artboard.width,
		layout.artboard.height,
		1000,
	);
	return {
		id: `${descriptorIdPart(descriptor)}:scene-camera`,
		name: "Descriptor scene camera",
		version: 1,
		scope: { kind: "artboard", artboardId: layout.artboard.id },
		projection: {
			kind: "orthographic",
			zoom: 1,
			near: 1,
			far: distance * 4,
		},
		body: {
			position: {
				x: layout.forceCenter.x,
				y: layout.forceCenter.y,
				z: -distance,
			},
		},
		target: {
			point: { x: layout.forceCenter.x, y: layout.forceCenter.y, z: 0 },
			parentControllerNodeId: controllerNodeId,
		},
	};
};

const createRoleNodes = (
	descriptor: MotionReproductionDescriptor,
	role: ReproductionDescriptorRole,
	layout: RoleLayout,
	cameraRigId: string | undefined,
): readonly VectorNode[] => {
	const { forceCenter, eventPlaneY } = layout;
	if (role.id === "proof_probe") {
		return [
			createRoleNode(
				descriptor,
				role,
				"probe",
				{ kind: "ellipse", bounds: { x: -11, y: -11, width: 22, height: 22 } },
				{ x: forceCenter.x - 120, y: forceCenter.y - 24 },
				layout,
				cameraRigId,
			),
		];
	}
	if (role.id === "mass") {
		return [
			createRoleNode(
				descriptor,
				role,
				"mass",
				{ kind: "ellipse", bounds: { x: -34, y: -34, width: 68, height: 68 } },
				forceCenter,
				layout,
				cameraRigId,
			),
		];
	}
	if (role.id === "body_family") {
		const offsets = [
			{ x: -176, y: 74 },
			{ x: 142, y: -86 },
			{ x: 194, y: 88 },
		];
		return offsets.map((offset, index) =>
			createRoleNode(
				descriptor,
				role,
				`body-${index + 1}`,
				{
					kind: "ellipse",
					bounds: { x: -17, y: -17, width: 34, height: 34 },
				},
				{ x: forceCenter.x + offset.x, y: forceCenter.y + offset.y },
				layout,
				cameraRigId,
				index,
			),
		);
	}
	if (role.id === "event_plane") {
		return [
			createRoleNode(
				descriptor,
				role,
				"plane",
				{
					kind: "rect",
					bounds: { x: -240, y: -3, width: 480, height: 6 },
					cornerRadius: 3,
				},
				{ x: forceCenter.x, y: eventPlaneY },
				layout,
				cameraRigId,
			),
		];
	}
	return [
		createRoleNode(
			descriptor,
			role,
			"role",
			{
				kind: "rect",
				bounds: { x: -24, y: -24, width: 48, height: 48 },
				cornerRadius: 8,
			},
			forceCenter,
			layout,
			cameraRigId,
		),
	];
};

const createTracksForRole = (
	role: ReproductionDescriptorRole,
	nodes: readonly VectorNode[],
	layout: RoleLayout,
): readonly KeyframeTrack<number>[] => {
	const f = (sec: number) => frameAt(sec, layout);
	const { forceCenter, eventPlaneY } = layout;
	if (role.id === "proof_probe" && nodes[0]) {
		const nodeId = nodes[0].id;
		return [
			track(nodeId, "x", [
				key(f(0), forceCenter.x - 120),
				key(f(0.38), forceCenter.x - 48),
				key(f(0.8), forceCenter.x + 34),
			]),
			track(nodeId, "y", [
				key(f(0), forceCenter.y - 24),
				key(f(0.38), forceCenter.y - 112),
				key(f(0.8), forceCenter.y - 36),
			]),
			track(nodeId, "opacity", [key(f(0), 1), key(f(1.05), 0.25)]),
		];
	}
	if (role.id === "mass" && nodes[0]) {
		const nodeId = nodes[0].id;
		return [
			track(nodeId, "opacity", [key(f(0), 0), key(f(0.82), 0), key(f(1.2), 1)]),
			track(nodeId, "scaleX", [key(f(0.82), 0.35), key(f(1.3), 1)]),
			track(nodeId, "scaleY", [key(f(0.82), 0.35), key(f(1.3), 1)]),
		];
	}
	if (role.id === "body_family") {
		return nodes.flatMap((node, index) => {
			const angle = [-0.72, 0.82, 1.9][index] ?? 0;
			const startRadius = [230, 210, 250][index] ?? 220;
			const endRadius = [156, 142, 172][index] ?? 150;
			const start = {
				x: forceCenter.x + Math.cos(angle) * startRadius,
				y: forceCenter.y + Math.sin(angle) * startRadius * 0.62,
			};
			const end = {
				x: forceCenter.x + Math.cos(angle + 0.65) * endRadius,
				y: forceCenter.y + Math.sin(angle + 0.65) * endRadius * 0.62,
			};
			return [
				track(node.id, "x", [
					key(f(1.05 + index * 0.08), start.x),
					key(f(2.8 + index * 0.1), end.x),
				]),
				track(node.id, "y", [
					key(f(1.05 + index * 0.08), start.y),
					key(f(2.8 + index * 0.1), end.y),
				]),
				track(node.id, "opacity", [
					key(f(0.95 + index * 0.08), 0),
					key(f(1.35 + index * 0.08), 1),
				]),
			];
		});
	}
	if (role.id === "event_plane" && nodes[0]) {
		const nodeId = nodes[0].id;
		return [
			track(nodeId, "opacity", [key(f(0), 0), key(f(3.15), 0), key(f(3.7), 1)]),
			track(nodeId, "scaleX", [key(f(3.1), 0.08), key(f(4.15), 1)]),
			track(nodeId, "y", [
				key(f(2.4), eventPlaneY + 44),
				key(f(4.15), eventPlaneY),
			]),
		];
	}
	return [];
};

const shouldCreateCameraSpace = (
	descriptor: MotionReproductionDescriptor,
): boolean => {
	const policy = descriptor.cameraSpace?.policy ?? "screen_2d";
	return policy !== "screen_2d";
};

const importIssues = (
	descriptor: MotionReproductionDescriptor,
	roleNodeIds: Readonly<Record<string, readonly string[]>>,
): readonly ReproductionDescriptorImportIssue[] => {
	const issues: ReproductionDescriptorImportIssue[] = [];
	const supportedSchemas = new Set([
		"forestone.motion-authoring-descriptor",
		"motion_reproduction_descriptor",
	]);
	if (!supportedSchemas.has(descriptor.schema)) {
		issues.push({
			severity: "error",
			code: "unsupported-descriptor-schema",
			message: `Expected forestone.motion-authoring-descriptor or motion_reproduction_descriptor, got ${descriptor.schema}.`,
			responsibleLayer: "descriptor",
		});
	}
	if (descriptor.cameraSpace?.policy === "true_3d_required") {
		issues.push({
			severity: "warning",
			code: "true-3d-deferred",
			message:
				"The descriptor asks for true 3D; this importer preserves a vector 2.5D skeleton and leaves true-3D fidelity unresolved.",
			responsibleLayer: "vecmo_primitive",
		});
	}
	for (const text of descriptor.cameraSpace?.doNotBake ?? []) {
		issues.push({
			severity: "info",
			code: "camera-space-do-not-bake",
			message: text,
			responsibleLayer: "camera_space",
		});
	}
	for (const role of descriptor.visibleRoles ?? []) {
		for (const text of role.cameraSpaceBinding?.doNotBake ?? []) {
			issues.push({
				severity: "info",
				code: "role-camera-space-do-not-bake",
				message: text,
				responsibleLayer: "camera_space",
				roleId: role.id,
			});
		}
		if (
			role.cameraSpaceBinding?.motionAttribution &&
			role.cameraSpaceBinding.motionAttribution !== "node_track" &&
			role.cameraSpaceBinding.mayBakeToNodeTracks !== true
		) {
			issues.push({
				severity: "info",
				code: "non-node-attribution-preserved",
				message:
					"Reference-skeleton node tracks are seed motion only; keep the role's camera/depth attribution when refining the production graph.",
				responsibleLayer: "camera_space",
				roleId: role.id,
			});
		}
	}
	for (const assignment of descriptor.cameraSpace?.depthPlaneAssignments ??
		[]) {
		if (assignment.required && !roleNodeIds[assignment.roleId]?.length) {
			issues.push({
				severity: "warning",
				code: "required-depth-role-missing",
				message: `Required depth-plane role "${assignment.roleId}" was not present in visibleRoles.`,
				responsibleLayer: "descriptor",
				roleId: assignment.roleId,
			});
		}
	}
	for (const attribution of descriptor.cameraSpace?.motionAttribution ?? []) {
		const preferred = attribution.preferred;
		if (preferred === "camera_track" || preferred === "target_track") {
			issues.push({
				severity: "info",
				code: "camera-track-values-unresolved",
				message:
					"Camera/target track attribution is preserved as a claim, but the descriptor has no numeric camera keyframes yet.",
				responsibleLayer: "camera_space",
				beatId: attribution.beatId,
			});
		}
	}
	return issues;
};

const acceptanceScaffold = (
	descriptor: MotionReproductionDescriptor,
): readonly ReproductionDescriptorAcceptanceScaffold[] =>
	(descriptor.acceptanceChecks ?? []).map((check) => ({
		id: check.id,
		status: "unreviewed",
		question: check.question,
		expectedEvidence: check.expectedEvidence,
		nearestFailureMode: check.nearestFailureMode,
		responsibleLayer: check.responsibleLayer,
		ifFailUpdate: check.ifFailUpdate,
	}));

/**
 * Converts an upstream motion-reproduction descriptor into Vecmo-native editable
 * documents without flattening camera/depth intent into unrelated node tracks.
 */
export function createReproductionDescriptorSkeleton(
	descriptor: MotionReproductionDescriptor,
	options: ReproductionDescriptorImportOptions = {},
): ReproductionDescriptorImportResult {
	const [startSec, endSec] = secondsWindow(descriptor);
	const fps = Math.max(1, Math.round(finiteOr(options.fps, 30)));
	const durationFrames = Math.max(1, Math.round((endSec - startSec) * fps));
	const size = options.artboardSize ?? { width: 1280, height: 720 };
	const artboardId =
		options.artboardId ?? `${descriptorIdPart(descriptor)}:artboard`;
	const baseArtboard = {
		id: artboardId,
		name: "Descriptor skeleton",
		position: { x: 0, y: 0 },
		width: size.width,
		height: size.height,
		background: "#f8fafc",
		fps,
		durationFrames,
	} satisfies Artboard;
	const layout: RoleLayout = {
		forceCenter: { x: size.width * 0.47, y: size.height * 0.42 },
		eventPlaneY: size.height * 0.68,
		artboard: baseArtboard,
		fps,
		startSec,
	};

	const cameraRigId = shouldCreateCameraSpace(descriptor)
		? `${descriptorIdPart(descriptor)}:scene-camera`
		: undefined;
	const controller = cameraRigId
		? createControllerNode(descriptor, layout, cameraRigId)
		: undefined;
	const cameraRig = controller
		? createCameraRig(descriptor, layout, controller.id)
		: undefined;
	const artboard = {
		...baseArtboard,
		...(descriptor.cameraSpace?.policy !== undefined
			? {
					cameraSpacePolicy: descriptor.cameraSpace
						.policy satisfies CameraSpacePolicy,
				}
			: {}),
		...(cameraRig ? { activeSceneCameraId: cameraRig.id } : {}),
	} satisfies Artboard;
	const activeLayout = {
		...layout,
		artboard,
	} satisfies RoleLayout;

	const roleNodeIds: Record<string, string[]> = {};
	const roleNodes = (descriptor.visibleRoles ?? []).flatMap((role) => {
		const nodes = createRoleNodes(
			descriptor,
			role,
			activeLayout,
			cameraRig?.id,
		);
		roleNodeIds[role.id] = nodes.map((node) => node.id);
		return nodes;
	});
	const nodes = controller ? [controller, ...roleNodes] : roleNodes;
	const layer: SceneLayer = {
		id: `${descriptorIdPart(descriptor)}:layer:roles`,
		name: "descriptor roles",
		visible: true,
		locked: false,
		nodes,
	};
	const scene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: options.sceneId ?? `${descriptorIdPart(descriptor)}:scene`,
		name:
			options.sceneName ??
			descriptor.conceptGate?.motionThesis ??
			descriptor.id,
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [layer],
		...(cameraRig ? { sceneCameras: [cameraRig] } : {}),
	};
	const tracks = (descriptor.visibleRoles ?? []).flatMap((role) =>
		createTracksForRole(
			role,
			roleNodeIds[role.id]
				?.map((nodeId) => roleNodes.find((node) => node.id === nodeId))
				.filter((node): node is VectorNode => Boolean(node)) ?? [],
			activeLayout,
		),
	);
	const motion: MotionDocument = {
		schemaVersion: 1,
		fps,
		durationFrames,
		tracks,
		clips:
			tracks.length > 0
				? [
						{
							id: `${descriptorIdPart(descriptor)}:clip:skeleton`,
							name: "Descriptor skeleton",
							startFrame: 0,
							durationFrames,
							trackIds: tracks.map((item) => item.id),
						},
					]
				: [],
		...(cameraRig ? { cameraTracks: [] } : {}),
	};
	const grammar: MotionGrammarStoreDocument = {
		bindings: [...EMPTY_GRAMMAR_DOCUMENT.bindings],
		passthrough: [...EMPTY_GRAMMAR_DOCUMENT.passthrough],
	};
	return {
		scene,
		motion,
		grammar,
		roleNodeIds,
		...(cameraRig ? { cameraRigId: cameraRig.id } : {}),
		acceptanceScaffold: acceptanceScaffold(descriptor),
		issues: importIssues(descriptor, roleNodeIds),
	};
}
