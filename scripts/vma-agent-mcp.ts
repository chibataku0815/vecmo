#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	type CallToolResult,
	McpServer,
	StdioServerTransport,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
	createAgentIssue,
	createAgentToolResult,
	isAgentToolRequest,
} from "../src/entities/agent/model/contracts";
import {
	type AgentDocumentContext,
	listAgentAppearanceEffects,
	listAgentArtboards,
	listAgentBindableProperties,
	listAgentLayers,
	listAgentLookGraph,
	listAgentLookNodeCapabilities,
	listAgentMotionGrammar,
	observeAgentDocument,
	observeAgentNode,
	validateAgentDocument,
} from "../src/entities/agent/model/read-only";
import type {
	AgentToolName,
	AgentToolRequest,
	AgentToolResult,
} from "../src/entities/agent/model/types";
import {
	applyAgentCameraVerbCommands,
	applyAgentDocumentCommands,
	applyAgentMotionCommands,
	applyAgentMotionGrammarCommands,
	applyAgentSceneCommands,
	proposeAgentEditPlan,
} from "../src/entities/agent/model/write";
import {
	EASING_PRESETS,
	MOTION_TIMING_TEMPLATES,
	type MotionTimingTemplateId,
} from "../src/entities/motion/model/easing";
import { TEXT_ANIMATOR_PRESET_IDS } from "../src/entities/motion/model/text-animator";
import {
	CAMERA_RIG_ANIMATABLE_PROPERTIES,
	SCALAR_ANIMATABLE_PROPERTIES,
} from "../src/entities/motion/model/types";
import type {
	MotionGrammarArrangementMapping,
	MotionGrammarEffectBinding,
	MotionGrammarRandomPulseProfile,
} from "../src/entities/motion-grammar/model/types";
import { MOTION_GRAMMAR_TECHNIQUE_IDS } from "../src/entities/motion-grammar/model/types";
import { MASK_RELATION_PROPERTY_IDS } from "../src/entities/scene/model/appearance";
import {
	BINDABLE_PROPERTY_SOURCE_KINDS,
	BINDABLE_PROPERTY_TARGET_SCOPES,
} from "../src/entities/scene/model/bindable-property";
import {
	ADAPTATION_SOURCES,
	EFFECT_LAYER_KINDS,
	EFFECT_LAYER_PHASES,
} from "../src/entities/scene/model/effect-layer-stack";
import { LOOK_GRAPH_NODE_KINDS } from "../src/entities/scene/model/look-graph";
import { PATH_OPERATIONS } from "../src/entities/scene/model/path-boolean/types";
import {
	PIXEL_ART_MAX_HEIGHT,
	PIXEL_ART_MAX_PALETTE_SIZE,
	PIXEL_ART_MAX_WIDTH,
} from "../src/entities/scene/model/pixel-art-object";
import { TEXT_FRAGMENT_UNITS } from "../src/entities/scene/model/text-fragments";
import {
	BLEND_MODES,
	COMPONENT_PROP_TYPES,
	INTERACTION_TRIGGER_KINDS,
	STROKE_ALIGN_VALUES,
	STROKE_CAP_VALUES,
	STROKE_JOIN_VALUES,
	TEXT_ALIGN_VALUES,
} from "../src/entities/scene/model/types";
import { stableJsonStringify } from "../src/features/export/model/json";
import {
	createReproductionDescriptorSkeleton,
	type MotionReproductionDescriptor,
	type ReproductionDescriptorImportResult,
} from "../src/features/reproduction-descriptor/model/descriptor-import";
import type { AgentBridgeForwardTarget } from "./agent-bridge-forward";
import {
	agentErrorResult,
	type CaptureEditorSnapshotArgs,
	captureEditorSnapshotResult,
	type DocumentSource,
	exportAgentArtboard,
	forwardLiveAgentPlan,
	type LivePlanInput,
	type LoadReproductionDescriptorArgs,
	observeAgentBridgeStatus,
	observeDocumentLiveResult,
	observePreviewStateResult,
	observeSelectionLiveResult,
	runWithDocument,
	saveProjectLiveResult,
} from "./vma-agent-toolkit";

type SaveProjectLiveArgs = {
	readonly bridge?: AgentBridgeForwardTarget;
	readonly intent?: string;
	readonly mode?: "save" | "save-as-new" | "save-as-copy";
	readonly name?: string;
};

const documentSourceSchema = z
	.object({
		projectPath: z.string().optional(),
		scenePath: z.string().optional(),
		motionPath: z.string().optional(),
		grammarPath: z.string().optional(),
	})
	.optional();

const liveBridgeSchema = z
	.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("local"),
			port: z.number().optional(),
			token: z.string().optional(),
			hostname: z.string().optional(),
			// Pins the target editor/working-copy/binding-epoch so a caller can
			// select an unambiguous target up front, notably for the fail-closed
			// native-capture ops (`observe_preview_state`/`capture_editor_snapshot`),
			// which require all three — see `resolvePinnedPreviewTarget` in
			// `scripts/agent-bridge-forward.ts`.
			editorInstanceId: z.string().optional(),
			workingCopyId: z.string().optional(),
			bindingEpoch: z.number().optional(),
			projectId: z.string().optional(),
		}),
		z.object({
			kind: z.literal("remote"),
			baseUrl: z.string().optional(),
			sessionId: z.string().optional(),
			token: z.string(),
			url: z.string().optional(),
			editorInstanceId: z.string().optional(),
			workingCopyId: z.string().optional(),
			bindingEpoch: z.number().optional(),
			projectId: z.string().optional(),
		}),
	])
	.optional();

const detailSchema = z.enum(["summary", "normal", "full"]).optional();
const commandArraySchema = z.array(z.unknown()).max(64);
const agentIntentSchema = z.string().trim().min(1).max(2_000);

const reproductionMotionAttributionSchema = z.enum([
	"node_track",
	"camera_track",
	"target_track",
	"null_controller",
	"depth_plane",
	"mixed",
]);

const reproductionDescriptorImportOptionsSchema = z
	.object({
		sceneId: z.string().optional(),
		sceneName: z.string().optional(),
		artboardId: z.string().optional(),
		artboardSize: z
			.object({
				width: z.number(),
				height: z.number(),
			})
			.optional(),
		fps: z.number().optional(),
	})
	.optional();

const motionReproductionDescriptorSchema = z
	.object({
		schema: z.string(),
		version: z.string(),
		id: z.string(),
		referencePacket: z
			.object({
				path: z.string().optional(),
				targetWindowSec: z.tuple([z.number(), z.number()]).optional(),
			})
			.passthrough()
			.optional(),
		conceptGate: z
			.object({
				intentAltitude: z.string().optional(),
				commonality: z.string().optional(),
				force: z.string().optional(),
				angleBasePoint: z.string().optional(),
				motionThesis: z.string().optional(),
				signatureLaw: z.string().optional(),
				viewerSentence: z.string().optional(),
			})
			.passthrough()
			.optional(),
		cameraSpace: z
			.object({
				policy: z
					.enum([
						"screen_2d",
						"vector_2_5d",
						"camera_space",
						"true_3d_required",
					])
					.optional(),
				motionAttribution: z
					.array(
						z
							.object({
								beatId: z.string().optional(),
								roleId: z.string().optional(),
								preferred: reproductionMotionAttributionSchema.optional(),
								components: z
									.array(reproductionMotionAttributionSchema)
									.optional(),
								fallback: reproductionMotionAttributionSchema.optional(),
								fallbackCost: z.string().optional(),
							})
							.passthrough(),
					)
					.optional(),
				cameraRigHypotheses: z
					.array(z.record(z.string(), z.unknown()))
					.optional(),
				depthPlaneAssignments: z
					.array(
						z
							.object({
								roleId: z.string(),
								depth: z.union([z.string(), z.number()]).optional(),
								exactZ: z.number().optional(),
								required: z.boolean().optional(),
								note: z.string().optional(),
							})
							.passthrough(),
					)
					.optional(),
				projectionFidelity: z.string().optional(),
				doNotBake: z.array(z.string()).optional(),
				escalationRule: z.string().optional(),
			})
			.passthrough()
			.optional(),
		visibleRoles: z
			.array(
				z
					.object({
						id: z.string(),
						roleType: z.string().optional(),
						attentionFunction: z.string().optional(),
						visibleNodeFamily: z.string().optional(),
						driverBindings: z.array(z.string()).optional(),
						geometryHint: z.string().optional(),
						cameraSpaceBinding: z
							.object({
								depthPlane: z.union([z.string(), z.number()]).optional(),
								motionAttribution:
									reproductionMotionAttributionSchema.optional(),
								mayBakeToNodeTracks: z.boolean().optional(),
								targetNullCandidate: z.string().optional(),
								doNotBake: z.array(z.string()).optional(),
							})
							.passthrough()
							.optional(),
						handsOffTo: z.string().optional(),
						mustPreserve: z.array(z.string()).optional(),
						mustNotBecome: z.array(z.string()).optional(),
					})
					.passthrough(),
			)
			.optional(),
		beatWindows: z
			.array(
				z
					.object({
						id: z.string(),
						timeRangeSec: z.tuple([z.number(), z.number()]).optional(),
						whatMustRead: z.string().optional(),
						attentionCarrier: z.string().optional(),
						activeRoles: z.array(z.string()).optional(),
						activeDrivers: z.array(z.string()).optional(),
						acceptanceFocus: z.array(z.string()).optional(),
					})
					.passthrough(),
			)
			.optional(),
		acceptanceChecks: z
			.array(
				z
					.object({
						id: z.string(),
						question: z.string().optional(),
						expectedEvidence: z.string().optional(),
						nearestFailureMode: z.string().optional(),
						responsibleLayer: z.string().optional(),
						ifFailUpdate: z.string().optional(),
					})
					.passthrough(),
			)
			.optional(),
	})
	.passthrough();

const loadReproductionDescriptorSchema = z
	.object({
		descriptor: motionReproductionDescriptorSchema.optional(),
		descriptorPath: z.string().optional(),
		options: reproductionDescriptorImportOptionsSchema,
	})
	.strict();

const bindablePropertyTargetScopeSchema = z
	.enum(BINDABLE_PROPERTY_TARGET_SCOPES)
	.optional();

const bindablePropertySourceKindSchema = z
	.enum(BINDABLE_PROPERTY_SOURCE_KINDS)
	.optional();

const bindableEffectTargetSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("scene") }),
	z.object({ scope: z.literal("current-artboard") }),
	z.object({ scope: z.literal("default-artboard") }),
	z.object({ scope: z.literal("artboard"), artboardId: z.string() }),
]);

// Look graphs can additionally be owned by an existing selection-scoped overlay.
// Keep this narrower contract separate from bindable effects: effect fields and
// layer stacks must not gain a selected-node graph scope by accident.
const lookGraphTargetSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("scene") }),
	z.object({ scope: z.literal("current-artboard") }),
	z.object({ scope: z.literal("default-artboard") }),
	z.object({ scope: z.literal("artboard"), artboardId: z.string() }),
	z.object({
		scope: z.literal("scoped-overlay"),
		artboardId: z.string(),
		scopedLookId: z.string(),
	}),
]);

const lookGraphOwnerSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("scene") }),
	z.object({ scope: z.literal("artboard"), artboardId: z.string() }),
	z.object({ scope: z.literal("node"), nodeId: z.string() }),
	z.object({
		scope: z.literal("scoped-overlay"),
		artboardId: z.string(),
		scopedLookId: z.string(),
	}),
]);

const effectFieldSpaceSchema = z.enum(["scene", "target", "objectBoundingBox"]);

const effectFieldGradientStopSchema = z
	.object({ offset: z.number(), alpha: z.number() })
	.strict();

const effectFieldSourceSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("contourGradient"),
			space: effectFieldSpaceSchema.optional(),
			width: z.number().optional(),
			side: z.enum(["inside", "outside", "both"]).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("linearGradient"),
			space: effectFieldSpaceSchema.optional(),
			x1: z.number().optional(),
			y1: z.number().optional(),
			x2: z.number().optional(),
			y2: z.number().optional(),
			stops: z.array(effectFieldGradientStopSchema).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("fieldMesh"),
			space: effectFieldSpaceSchema.optional(),
			fieldMesh: z
				.object({
					rows: z.number().int().min(2).max(8),
					cols: z.number().int().min(2).max(8),
					points: z.array(
						z
							.object({
								x: z.number(),
								y: z.number(),
								value: z.number(),
							})
							.strict(),
					),
				})
				.strict()
				.optional(),
		})
		.strict(),
]);

const effectFieldFalloffSchema = z
	.object({
		kind: z.enum(["linear", "smoothstep", "gamma", "threshold"]).optional(),
		inputMin: z.number().optional(),
		inputMax: z.number().optional(),
		gamma: z.number().optional(),
		softness: z.number().optional(),
	})
	.strict();

const effectFieldInfluenceSchema = z
	.object({
		enabled: z.boolean().optional(),
		source: effectFieldSourceSchema,
		strength: z.number().optional(),
		invert: z.boolean().optional(),
		featherRadius: z.number().optional(),
		falloff: effectFieldFalloffSchema.optional(),
	})
	.strict();

const effectFieldTargetRefSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("scene"), id: z.string().optional() }).strict(),
	z.object({ scope: z.literal("object"), id: z.string() }).strict(),
	z.object({ scope: z.literal("group"), id: z.string() }).strict(),
	z.object({ scope: z.literal("layer"), id: z.string() }).strict(),
]);

const effectFieldAssignmentSchema = z
	.object({
		id: z.string(),
		label: z.string().optional(),
		target: effectFieldTargetRefSchema,
		effect: z.object({ id: z.string(), path: z.string() }).strict(),
		influence: effectFieldInfluenceSchema,
		fieldId: z.string().optional(),
	})
	.strict();

const effectFieldOperationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("upsert-field"),
			field: z
				.object({
					id: z.string(),
					label: z.string().optional(),
					source: effectFieldSourceSchema,
				})
				.strict(),
		})
		.strict(),
	z.object({ kind: z.literal("remove-field"), fieldId: z.string() }).strict(),
	z
		.object({
			kind: z.literal("attach-route"),
			assignment: effectFieldAssignmentSchema,
		})
		.strict(),
	z
		.object({ kind: z.literal("remove-route"), assignmentId: z.string() })
		.strict(),
	z
		.object({
			kind: z.literal("link-route"),
			assignmentId: z.string(),
			fieldId: z.string(),
		})
		.strict(),
	z
		.object({ kind: z.literal("unlink-route"), assignmentId: z.string() })
		.strict(),
	z
		.object({
			kind: z.literal("replace-field-source"),
			fieldId: z.string(),
			source: effectFieldSourceSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("update-influence"),
			assignmentId: z.string(),
			patch: z
				.object({
					enabled: z.boolean().optional(),
					strength: z.number().optional(),
					invert: z.boolean().optional(),
					featherRadius: z.number().optional(),
					falloff: effectFieldFalloffSchema.optional(),
				})
				.strict(),
		})
		.strict(),
]);

const effectLayerTargetSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("frame") }),
	z.object({ scope: z.literal("node"), nodeId: z.string() }),
	z.object({ scope: z.literal("node-set"), nodeIds: z.array(z.string()) }),
]);

const blendModeSchema = z.enum(BLEND_MODES);

const effectLayerAdaptationSchema = z.object({
	source: z.enum(ADAPTATION_SOURCES),
	strength: z.number().optional(),
	invert: z.boolean().optional(),
});

const effectLayerSchema = z.object({
	id: z.string(),
	kind: z.enum(EFFECT_LAYER_KINDS).optional(),
	label: z.string().optional(),
	enabled: z.boolean().optional(),
	phase: z.enum(EFFECT_LAYER_PHASES).optional(),
	target: effectLayerTargetSchema.optional(),
	mix: z.number().optional(),
	blendMode: blendModeSchema.optional(),
	visualRecipe: z.record(z.string(), z.unknown()).optional(),
	influenceAssignmentIds: z.array(z.string()).optional(),
	adaptation: effectLayerAdaptationSchema.partial().optional(),
});

const effectLayerPatchSchema = effectLayerSchema.omit({ id: true }).partial();

const effectLayerStackOperationSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("add"),
		layer: effectLayerSchema,
		index: z.number().optional(),
	}),
	z.object({
		kind: z.literal("update"),
		layerId: z.string(),
		patch: effectLayerPatchSchema,
	}),
	z.object({
		kind: z.literal("remove"),
		layerId: z.string(),
	}),
	z.object({
		kind: z.literal("reorder"),
		layerId: z.string(),
		toIndex: z.number(),
	}),
]);

const lookGraphNodeKindSchema = z.enum(LOOK_GRAPH_NODE_KINDS);

// Node payload wraps a canonical vec-core recipe slice; deep recipe validation
// lives in entities normalization, so the wire schema keeps it a permissive record.
const lookGraphNodePayloadSchema = z.record(z.string(), z.unknown());

const lookGraphPositionSchema = z.object({ x: z.number(), y: z.number() });

const lookGraphEndpointSchema = z.object({
	nodeId: z.string(),
	portId: z.string(),
});

const lookGraphOperationSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("add-node"),
		node: z.object({
			id: z.string(),
			kind: lookGraphNodeKindSchema,
			label: z.string().optional(),
			enabled: z.boolean().optional(),
			payload: lookGraphNodePayloadSchema.optional(),
			position: lookGraphPositionSchema.optional(),
		}),
	}),
	z.object({
		kind: z.literal("update-node"),
		nodeId: z.string(),
		patch: z.object({
			label: z.string().optional(),
			enabled: z.boolean().optional(),
			payload: lookGraphNodePayloadSchema.optional(),
			position: lookGraphPositionSchema.nullable().optional(),
		}),
	}),
	z.object({ kind: z.literal("remove-node"), nodeId: z.string() }),
	z.object({
		kind: z.literal("connect"),
		from: lookGraphEndpointSchema,
		to: lookGraphEndpointSchema,
		replaceInput: z.boolean().optional(),
	}),
	z.object({ kind: z.literal("disconnect"), edgeId: z.string() }),
	z.object({
		kind: z.literal("move-node"),
		nodeId: z.string(),
		position: lookGraphPositionSchema,
	}),
	z.object({ kind: z.literal("set-output"), nodeId: z.string() }),
]);

const agentIssueTargetSchema = z.object({
	kind: z.enum([
		"document",
		"artboard",
		"layer",
		"node",
		"motion-track",
		"motion-grammar-binding",
		"selection",
		"export",
		"tool",
		"asset",
	]),
	id: z.string().optional(),
	path: z.string().optional(),
});

const vec2Schema = z.object({
	x: z.number(),
	y: z.number(),
});

const vec3PatchSchema = z.object({
	x: z.number().optional(),
	y: z.number().optional(),
	z: z.number().optional(),
});

const boundsSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});

const sceneMediaSourceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("data-url"), dataUrl: z.string() }),
	z.object({ kind: z.literal("reference"), href: z.string() }),
]);

const sceneAssetIssueSchema = z.object({
	severity: z.enum(["info", "warning", "error"]),
	code: z.string(),
	message: z.string().optional(),
});

const programSurfaceInputSchema = z.discriminatedUnion("kind", [
	z.object({
		id: z.string(),
		kind: z.literal("scalar"),
		label: z.string().optional(),
		defaultValue: z.number().optional(),
		min: z.number().optional(),
		max: z.number().optional(),
	}),
	z.object({
		id: z.string(),
		kind: z.literal("color"),
		label: z.string().optional(),
		defaultValue: z.string().optional(),
	}),
	z.object({
		id: z.string(),
		kind: z.enum([
			"asset-texture",
			"time",
			"frame",
			"seed",
			"pointer",
			"resolved-scene-camera",
		]),
		label: z.string().optional(),
	}),
]);

const programSurfaceManifestSchema = z.object({
	schemaVersion: z.literal(1),
	runtime: z.object({
		kind: z.literal("webgl2"),
		entry: z.string(),
		compiledDigest: z.string(),
	}),
	source: z.object({
		snapshotDigest: z.string(),
		portability: z.enum(["self-contained", "reference-only"]),
	}),
	inputs: z.array(programSurfaceInputSchema),
	output: z.object({
		kind: z.literal("rgba-texture"),
		alphaMode: z.enum(["premultiplied", "straight"]),
		width: z.number(),
		height: z.number(),
	}),
	timing: z.object({
		seed: z.number(),
		deterministicAtFrame: z.boolean(),
	}),
	space: z.object({
		cameraSpacePolicy: z.enum(["screen_2d", "resolved-scene-camera"]),
	}),
	delivery: z.object({
		editor: z.enum(["live", "fallback"]),
		webglPlayer: z.enum(["live", "fallback", "unsupported"]),
		svgPdf: z.enum(["raster-fallback", "unsupported"]),
		video: z.enum(["capture", "raster-fallback", "unsupported"]),
	}),
	fallback: z
		.object({ assetId: z.string(), frame: z.number().int().optional() })
		.optional(),
});

const commonSceneAssetFields = {
	id: z.string(),
	name: z.string(),
	source: sceneMediaSourceSchema,
	mimeType: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
} as const;

const sceneAssetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("image"), ...commonSceneAssetFields }),
	z.object({
		kind: z.literal("video"),
		...commonSceneAssetFields,
		durationSeconds: z.number().optional(),
	}),
	z.object({
		kind: z.enum(["external-scene", "model-3d", "code-module"]),
		...commonSceneAssetFields,
		format: z
			.enum(["gltf", "glb", "three-scene-json", "module", "html", "unknown"])
			.optional(),
		preview: z
			.object({
				assetId: z.string(),
				role: z.enum(["thumbnail", "editor-preview", "export-fallback"]),
			})
			.optional(),
		capabilities: z.array(z.string()).optional(),
		issues: z.array(sceneAssetIssueSchema).optional(),
	}),
	z.object({
		kind: z.literal("program-surface"),
		...commonSceneAssetFields,
		manifest: programSurfaceManifestSchema,
		issues: z.array(sceneAssetIssueSchema).optional(),
	}),
]);

const paintTransformSchema = z.object({
	a: z.number(),
	b: z.number(),
	c: z.number(),
	d: z.number(),
	e: z.number(),
	f: z.number(),
});

const affineMatrix2dSchema = paintTransformSchema;

const gradientStopSchema = z.object({
	id: z.string().optional(),
	offset: z.number(),
	color: z.string(),
	opacity: z.number().optional(),
});

const paintVisibilitySchema = {
	visible: z.boolean().optional(),
} as const;

const solidPaintSchema = z.object({
	kind: z.literal("solid"),
	color: z.string(),
	opacity: z.number().optional(),
	...paintVisibilitySchema,
});

const linearGradientPaintSchema = z.object({
	kind: z.literal("linear-gradient"),
	stops: z.array(gradientStopSchema),
	from: vec2Schema,
	to: vec2Schema,
	opacity: z.number().optional(),
	transform: paintTransformSchema.optional(),
	...paintVisibilitySchema,
});

const radialGradientPaintSchema = z.object({
	kind: z.literal("radial-gradient"),
	stops: z.array(gradientStopSchema),
	center: vec2Schema,
	radius: vec2Schema,
	opacity: z.number().optional(),
	transform: paintTransformSchema.optional(),
	...paintVisibilitySchema,
});

const imageReferencePaintSchema = z.object({
	kind: z.literal("image-reference"),
	assetId: z.string().optional(),
	href: z.string().optional(),
	fit: z.enum(["fill", "fit", "crop", "tile"]).optional(),
	opacity: z.number().optional(),
	transform: paintTransformSchema.optional(),
	...paintVisibilitySchema,
});

const meshPointSchema = z.object({
	point: vec2Schema,
	color: z.string(),
	opacity: z.number().optional(),
	handleUp: vec2Schema.optional(),
	handleDown: vec2Schema.optional(),
	handleLeft: vec2Schema.optional(),
	handleRight: vec2Schema.optional(),
});

const meshGradientPaintSchema = z
	.object({
		kind: z.literal("mesh-gradient"),
		rows: z.number().int().min(2),
		cols: z.number().int().min(2),
		points: z.array(meshPointSchema),
		opacity: z.number().optional(),
		transform: paintTransformSchema.optional(),
		...paintVisibilitySchema,
	})
	.refine((paint) => paint.points.length === paint.rows * paint.cols, {
		message: "Mesh gradient points must equal rows * cols.",
		path: ["points"],
	});

const paintSchema = z.union([
	solidPaintSchema,
	linearGradientPaintSchema,
	radialGradientPaintSchema,
	imageReferencePaintSchema,
	meshGradientPaintSchema,
]);

/**
 * `author-object-noise-gradient`'s `revealPaint`: the same three vector paint
 * kinds `RevealPaint` accepts on the model side (`entities/scene/model/
 * types.ts`) — solid/linear-gradient/radial-gradient only, narrower than the
 * full `paintSchema` union above (an image/mesh reveal has no clean
 * single-element underlay rendering).
 */
const revealPaintSchema = z.union([
	solidPaintSchema,
	linearGradientPaintSchema,
	radialGradientPaintSchema,
]);

const transformValueSchema = z.object({
	position: vec2Schema.optional(),
	rotation: z.number().optional(),
	scale: vec2Schema.optional(),
	anchor: vec2Schema.optional(),
});

const transformPatchSchema = z.object({
	transform: transformValueSchema.optional(),
});

const shadowEffectSchema = z.object({
	kind: z.enum(["drop-shadow", "inner-shadow"]),
	offset: vec2Schema,
	radius: z.number(),
	color: z.string(),
	opacity: z.number().optional(),
	spread: z.number().optional(),
	visible: z.boolean().optional(),
	blendMode: blendModeSchema.optional(),
});

const blurEffectSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("layer-blur"),
			radius: z.number(),
			// Omit Y from a full `effects` replacement to relink it to X.
			radiusY: z.number().optional(),
			visible: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("background-blur"),
			radius: z.number(),
			visible: z.boolean().optional(),
		})
		.strict(),
]);

const effectSchema = z.union([shadowEffectSchema, blurEffectSchema]);

// Mirrors NodeStyle.strokeSoftness; both fields are optional/independent (a
// node may carry only the static blur radius, only the object-mask feather
// radius, or neither).
const strokeSoftnessSchema = z.object({
	blurRadius: z.number().optional(),
	featherRadius: z.number().optional(),
});

const stylePatchSchema = z.object({
	fill: z.string().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	opacity: z.number().optional(),
	fills: z.array(paintSchema).optional(),
	strokes: z.array(paintSchema).optional(),
	effects: z.array(effectSchema).optional(),
	blendMode: blendModeSchema.optional(),
	strokeAlign: z.enum(STROKE_ALIGN_VALUES).optional(),
	strokeDash: z.array(z.number()).optional(),
	strokeDashoffset: z.number().optional(),
	strokeCap: z.enum(STROKE_CAP_VALUES).optional(),
	strokeJoin: z.enum(STROKE_JOIN_VALUES).optional(),
	strokeMiterLimit: z.number().optional(),
	// AgentNodeStylePatch (and the editor's own NodeStylePatch) allow
	// strokeSoftness, but this schema previously omitted it, so an agent style
	// write reported success while silently dropping stroke-only blur/feather.
	strokeSoftness: strokeSoftnessSchema.optional(),
});

const textStylePatchSchema = z.object({
	fontFamily: z.string().optional(),
	fontSize: z.number().optional(),
	lineHeight: z.number().optional(),
	align: z.enum(TEXT_ALIGN_VALUES).optional(),
	fontWeight: z.number().optional(),
	letterSpacing: z.number().optional(),
	// AgentTextNodePatch.style is Partial<TextStyle>, which allows italic/underline;
	// this schema previously omitted both, so an agent style write reported success
	// while silently dropping the flag.
	italic: z.boolean().optional(),
	underline: z.boolean().optional(),
});

const aePointSchema = z.tuple([z.number(), z.number()]);

const bezierShapeSchema = z.object({
	type: z.literal("Shape"),
	closed: z.boolean(),
	vertices: z.array(aePointSchema),
	inTangents: z.array(aePointSchema),
	outTangents: z.array(aePointSchema),
});

const appendGeometrySchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("rect"),
		bounds: boundsSchema,
		cornerRadius: z.number().optional(),
		cornerRadii: z
			.object({
				tl: z.number(),
				tr: z.number(),
				br: z.number(),
				bl: z.number(),
			})
			.optional(),
		cornerSmoothing: z.number().optional(),
	}),
	z.object({ kind: z.literal("ellipse"), bounds: boundsSchema }),
	z.object({ kind: z.literal("line"), start: vec2Schema, end: vec2Schema }),
	z.object({
		kind: z.literal("polygon"),
		points: z.array(vec2Schema),
		cornerRadius: z.number().optional(),
		cornerSmoothing: z.number().optional(),
	}),
	z.object({
		kind: z.literal("star"),
		center: vec2Schema,
		points: z.number().int(),
		innerRadius: z.number(),
		outerRadius: z.number(),
		cornerRadius: z.number().optional(),
		cornerSmoothing: z.number().optional(),
	}),
	z.object({
		kind: z.literal("text"),
		bounds: boundsSchema,
		text: z.string(),
		style: textStylePatchSchema.optional(),
	}),
	z.object({
		kind: z.literal("path"),
		shape: bezierShapeSchema,
		subpaths: z.array(bezierShapeSchema).optional(),
		fillRule: z.enum(["nonzero", "evenodd"]).optional(),
	}),
	z.object({
		kind: z.literal("image"),
		bounds: boundsSchema,
		assetId: z.string(),
	}),
]);

const appendNodeSpecSchema = z.object({
	name: z.string().optional(),
	style: stylePatchSchema.optional(),
	transform: transformValueSchema.optional(),
	geometry: appendGeometrySchema,
});

const blendSpacingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("specified-steps"), steps: z.number().int() }),
	z.object({ kind: z.literal("specified-distance"), distance: z.number() }),
	z.object({
		kind: z.literal("smooth-color"),
		maxSteps: z.number().int().optional(),
	}),
]);

const blendSpineSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("line"), start: vec2Schema, end: vec2Schema }),
	z.object({ kind: z.literal("path"), shape: bezierShapeSchema }),
]);

const dotMatrixStyleSchema = z
	.object({
		fill: z.string().optional(),
		stroke: z.string().optional(),
		strokeWidth: z.number().optional(),
		opacity: z.number().optional(),
	})
	.strict();

const dotMatrixSpecSchema = z.object({
	name: z.string().optional(),
	origin: vec2Schema,
	rows: z.array(z.string()),
	cellSize: z.number(),
	gap: z.number().optional(),
	style: dotMatrixStyleSchema.optional(),
});

const pixelArtObjectSpecSchema = z
	.object({
		name: z.string().trim().min(1).max(160),
		origin: z.object({ x: z.number().finite(), y: z.number().finite() }),
		rows: z
			.array(z.string().min(1).max(PIXEL_ART_MAX_WIDTH))
			.min(1)
			.max(PIXEL_ART_MAX_HEIGHT),
		palette: z
			.array(z.string().regex(/^#[0-9a-f]{6}$/i))
			.min(1)
			.max(PIXEL_ART_MAX_PALETTE_SIZE),
		pixelSize: z.number().int().min(1).max(32),
		artboardId: z.string().trim().min(1).max(256).optional(),
	})
	.strict();

const layoutCellPlacementSchema = z.object({
	column: z.number(),
	row: z.number(),
	columnSpan: z.number().optional(),
	rowSpan: z.number().optional(),
	fit: z.enum(["contain", "cover"]).optional(),
});

const layoutFrameVariantSchema = z.object({
	id: z.string(),
	name: z.string(),
	minWidth: z.number().optional(),
	maxWidth: z.number().optional(),
	columns: z.number().optional(),
	rows: z.union([z.number(), z.literal("auto")]).optional(),
	gap: z
		.object({
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.optional(),
	padding: z
		.object({
			top: z.number().optional(),
			right: z.number().optional(),
			bottom: z.number().optional(),
			left: z.number().optional(),
		})
		.optional(),
	autoFlow: z.enum(["row", "column"]).optional(),
	allowOverlap: z.boolean().optional(),
	preset: z
		.enum(["uniform-grid", "bento-hero-left", "bento-hero-top", "bento-mosaic"])
		.optional(),
	placements: z.record(z.string(), layoutCellPlacementSchema).optional(),
});

const layoutFramePatchSchema = z.object({
	kind: z.literal("grid").optional(),
	version: z.literal(1).optional(),
	columns: z.number().optional(),
	rows: z.union([z.number(), z.literal("auto")]).optional(),
	gap: z
		.object({
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.optional(),
	padding: z
		.object({
			top: z.number().optional(),
			right: z.number().optional(),
			bottom: z.number().optional(),
			left: z.number().optional(),
		})
		.optional(),
	autoFlow: z.enum(["row", "column"]).optional(),
	allowOverlap: z.boolean().nullable().optional(),
	preset: z
		.enum(["uniform-grid", "bento-hero-left", "bento-hero-top", "bento-mosaic"])
		.nullable()
		.optional(),
	placements: z
		.record(z.string(), layoutCellPlacementSchema)
		.nullable()
		.optional(),
	variantMode: z.enum(["manual", "auto"]).nullable().optional(),
	activeVariantId: z.string().nullable().optional(),
	variants: z.array(layoutFrameVariantSchema).nullable().optional(),
});

const textNodePatchSchema = z.object({
	text: z.string().optional(),
	bounds: boundsSchema.optional(),
	style: textStylePatchSchema.optional(),
});

const artboardSpecSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	width: z.number(),
	height: z.number(),
	background: z.string().optional(),
	position: vec2Schema.optional(),
	fps: z.number().optional(),
	durationFrames: z.number().optional(),
	cameraSpacePolicy: z
		.enum(["screen_2d", "vector_2_5d", "camera_space", "true_3d_required"])
		.optional(),
});

const artboardPatchSchema = z.object({
	name: z.string().optional(),
	position: vec2Schema.optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	background: z.string().optional(),
	fps: z.number().optional(),
	durationFrames: z.number().optional(),
	cameraSpacePolicy: z
		.enum(["screen_2d", "vector_2_5d", "camera_space", "true_3d_required"])
		.nullable()
		.optional(),
});

const sourceOpticsBloomPatchSchema = z.object({
	enabled: z.boolean().optional(),
	radiusX: z.number().optional(),
	radiusY: z.number().nullable().optional(),
	intensity: z.number().optional(),
	threshold: z.number().optional(),
	blendMode: blendModeSchema.optional(),
});

const sourceOpticsRaySchema = z.object({
	id: z.string(),
	enabled: z.boolean(),
	angle: z.number(),
	length: z.number(),
	width: z.number(),
	intensity: z.number(),
	falloff: z.number(),
	oppositeSideRatio: z.number(),
});

const sourceOpticsAtmospherePatchSchema = z.object({
	enabled: z.boolean().optional(),
	fieldId: z.string().optional(),
	mix: z.number().optional(),
	falloff: z.number().optional(),
	reach: z.number().optional(),
	tint: z.string().optional(),
});

const sourceOpticsLensPatchSchema = z.object({
	enabled: z.boolean().optional(),
	mix: z.number().optional(),
	chroma: z.number().optional(),
	reach: z.number().optional(),
});

const sourceOpticsSurfacePatchSchema = z.object({
	amount: z.number().optional(),
	width: z.number().optional(),
	softness: z.number().optional(),
	tint: z.string().optional(),
});

const sourceOpticsDiffusionPatchSchema = z.object({
	amount: z.number().optional(),
	depth: z.number().optional(),
	softness: z.number().optional(),
	tint: z.string().optional(),
});

const sourceOpticsEdgePatchSchema = z.object({
	amount: z.number().optional(),
	width: z.number().optional(),
	softness: z.number().optional(),
	tint: z.string().optional(),
});

const sourceOpticsResponsePatchSchema = z.object({
	enabled: z.boolean().optional(),
	fieldId: z.string().nullable().optional(),
	surface: sourceOpticsSurfacePatchSchema.nullable().optional(),
	diffusion: sourceOpticsDiffusionPatchSchema.nullable().optional(),
	edge: sourceOpticsEdgePatchSchema.nullable().optional(),
	microstructure: z
		.object({ amount: z.number().optional() })
		.nullable()
		.optional(),
	spectral: z
		.object({ amount: z.number().optional(), offset: z.number().optional() })
		.nullable()
		.optional(),
});

const sourceOpticsRigPatchSchema = z.object({
	name: z.string().optional(),
	enabled: z.boolean().optional(),
	bloom: sourceOpticsBloomPatchSchema.optional(),
	rays: z.array(sourceOpticsRaySchema).nullable().optional(),
	atmosphere: sourceOpticsAtmospherePatchSchema.nullable().optional(),
	lens: sourceOpticsLensPatchSchema.nullable().optional(),
});

// Mirrors AppearanceMaskRelationKind (a hand-typed 3-literal union in
// entities/scene/model/appearance.ts, not backed by a canonical `as const`
// array, so this list is hand-kept in sync with `isImportedClipMaskKind`).
const maskRelationKindSchema = z.enum(["clip-path", "mask", "soft-mask"]);

// Mirrors AppearanceMaskRelationSettings.
const maskRelationSettingsSchema = z.object({
	featherRadius: z.number().optional(),
	expand: z.number().optional(),
	opacity: z.number().optional(),
	invert: z.boolean().optional(),
	channel: z.enum(["alpha", "luminance", "red", "green", "blue"]).optional(),
	sourceSampling: z.enum(["pre-effects", "post-effects"]).optional(),
	coordinateSpace: z.literal("artboard").optional(),
});

// Mirrors StylePresetPaint (Partial<Pick<NodeStyle, "fill"|"stroke"|"strokeWidth"|"opacity">>).
const stylePresetPaintSchema = z.object({
	fill: z.string().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	opacity: z.number().optional(),
});

// Mirrors StylePresetTypography (Partial<TextStyle>).
const stylePresetTypographySchema = z.object({
	fontFamily: z.string().optional(),
	fontSize: z.number().optional(),
	lineHeight: z.number().optional(),
	align: z.enum(TEXT_ALIGN_VALUES).optional(),
	fontWeight: z.number().optional(),
	letterSpacing: z.number().optional(),
	italic: z.boolean().optional(),
	underline: z.boolean().optional(),
});

// Mirrors StylePresetAppearance (Partial<Pick<NodeStyle, "fills"|"strokes"|
// "effects"|"blendMode"|"strokeAlign"|"strokeDash"|"strokeCap"|"strokeJoin"|
// "strokeMiterLimit"|"opacity">>) — deliberately narrower than stylePatchSchema
// (AgentNodeStylePatch's mirror), which additionally allows fill/stroke/
// strokeWidth/strokeDashoffset/strokeSoftness that a graphic-style preset does
// not carry.
const stylePresetAppearanceSchema = z.object({
	fills: z.array(paintSchema).optional(),
	strokes: z.array(paintSchema).optional(),
	effects: z.array(effectSchema).optional(),
	blendMode: blendModeSchema.optional(),
	strokeAlign: z.enum(STROKE_ALIGN_VALUES).optional(),
	strokeDash: z.array(z.number()).optional(),
	strokeCap: z.enum(STROKE_CAP_VALUES).optional(),
	strokeJoin: z.enum(STROKE_JOIN_VALUES).optional(),
	strokeMiterLimit: z.number().optional(),
	opacity: z.number().optional(),
});

// Mirrors CreateStylePresetOptions.
const createStylePresetOptionsSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	kind: z.enum(["node", "text"]).optional(),
	paint: stylePresetPaintSchema.optional(),
	typography: stylePresetTypographySchema.optional(),
	appearance: stylePresetAppearanceSchema.optional(),
});

// Mirrors StylePreset.
const stylePresetSchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["node", "text"]),
	paint: stylePresetPaintSchema.optional(),
	typography: stylePresetTypographySchema.optional(),
	appearance: stylePresetAppearanceSchema.optional(),
});

// Mirrors CreateComponentSymbolOptions.
const createComponentSymbolOptionsSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
});

// Mirrors CreateComponentInstanceOptions.
const createComponentInstanceOptionsSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	layerId: z.string().optional(),
	artboardId: z.string().optional(),
	toIndex: z.number().optional(),
	transform: transformValueSchema.optional(),
});

// Mirrors ComponentNodeOverrideInput. `style` reuses stylePatchSchema (the full
// Partial<NodeStyle> surface), matching AgentNodeStylePatch's shape exactly —
// unlike stylePresetAppearanceSchema, which is deliberately narrower.
const componentNodeOverrideInputSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("name"), name: z.string() }),
	z.object({ kind: z.literal("style"), style: stylePatchSchema }),
	z.object({ kind: z.literal("transform"), transform: transformValueSchema }),
	z.object({
		kind: z.literal("text"),
		text: z.string().optional(),
		bounds: boundsSchema.optional(),
		style: textStylePatchSchema.optional(),
	}),
]);

// Mirrors ComponentOverrideResetFilter.
const componentOverrideResetFilterSchema = z.object({
	instanceNodeId: z.string().optional(),
	kind: z.enum(["name", "style", "transform", "text"]).optional(),
});

// Mirrors ComponentPropValue.
const componentPropValueSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("number"), value: z.number() }),
	z.object({ type: z.literal("color"), value: z.string() }),
	z.object({ type: z.literal("text"), value: z.string() }),
]);

// Mirrors ComponentPropBinding.
const componentPropBindingSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("bindable"),
		nodeId: z.string(),
		propertyId: z.string(),
	}),
	z.object({
		kind: z.literal("style-color"),
		nodeId: z.string(),
		role: z.enum(["fill", "stroke"]),
		paintIndex: z.number().optional(),
	}),
	z.object({
		kind: z.literal("text-content"),
		nodeId: z.string(),
	}),
]);

// Mirrors CreateComponentPropOptions.
const createComponentPropOptionsSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	type: z.enum(COMPONENT_PROP_TYPES),
	defaultValue: componentPropValueSchema,
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
	bindings: z.array(componentPropBindingSchema).optional(),
});

// Mirrors ComponentPropUpdatePatch.
const componentPropUpdatePatchSchema = z.object({
	name: z.string().optional(),
	defaultValue: componentPropValueSchema.optional(),
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
	bindings: z.array(componentPropBindingSchema).optional(),
});

// Mirrors InteractionTrigger. Cross-field rules (nodeId existence, threshold
// range, scroll-progress's single-action shape) are validated by
// interactions.ts at compile time, not here — this is a loose, permissive
// wire shape (see the "exactly one of frame/progress" comment on
// interactionActionSchema for why cross-field constraints stay out of a
// z.discriminatedUnion member).
const interactionTriggerSchema = z.object({
	kind: z.enum(INTERACTION_TRIGGER_KINDS),
	nodeId: z.string().optional(),
	threshold: z.number().optional(),
});

// Mirrors InteractionAction. `seek`'s `frame`/`progress` are both optional
// here (a real Zod discriminatedUnion member cannot carry a `.refine()`
// cross-field check — refine returns a ZodEffects, which z.discriminatedUnion
// cannot introspect for its own literal-discriminant dispatch); the "exactly
// one of frame|progress" rule is enforced by interactions.ts's
// validateInteractionAction at compile time instead, matching how this file
// defers every other cross-field agent-command rule to write.ts.
const interactionActionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("play-clip"),
		clipId: z.string(),
		loop: z.boolean().optional(),
		direction: z.enum(["forward", "reverse"]).optional(),
		// biome-ignore lint/suspicious/noThenProperty: mirrors InteractionActionPlayClip.then (what happens at clip end); this is a Zod schema field, never awaited or treated as a thenable.
		then: z.enum(["hold", "reset"]).optional(),
	}),
	z.object({
		kind: z.literal("toggle-clip"),
		clipId: z.string(),
		loop: z.boolean().optional(),
	}),
	z.object({
		kind: z.literal("seek"),
		frame: z.number().optional(),
		progress: z.number().optional(),
	}),
	z.object({
		kind: z.literal("set-prop"),
		propName: z.string(),
		value: z.union([z.number(), z.string()]),
	}),
	z.object({ kind: z.literal("pause") }),
	z.object({ kind: z.literal("resume") }),
]);

// Mirrors CreateInteractionOptions.
const createInteractionOptionsSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	trigger: interactionTriggerSchema,
	actions: z.array(interactionActionSchema),
});

// Mirrors InteractionUpdatePatch.
const interactionUpdatePatchSchema = z.object({
	name: z.string().optional(),
	trigger: interactionTriggerSchema.optional(),
	actions: z.array(interactionActionSchema).optional(),
});

const sceneCameraProjectionPatchSchema = z.object({
	kind: z.enum(["orthographic", "perspective"]).optional(),
	fovDegrees: z.number().optional(),
	zoom: z.number().optional(),
	focalLengthMm: z.number().optional(),
	focusDistance: z.number().optional(),
	aperture: z.number().optional(),
	near: z.number().optional(),
	far: z.number().optional(),
});

const sceneCameraScopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("scene") }),
	z.object({ kind: z.literal("artboard"), artboardId: z.string() }),
]);

const sceneCameraSpecSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	artboardId: z.string().nullable().optional(),
	targetPoint: vec3PatchSchema.optional(),
	bodyPosition: vec3PatchSchema.optional(),
	projection: sceneCameraProjectionPatchSchema.optional(),
	targetControllerNodeId: z.string().nullable().optional(),
});

const sceneCameraRigPatchSchema = z.object({
	name: z.string().optional(),
	scope: sceneCameraScopeSchema.optional(),
	projection: sceneCameraProjectionPatchSchema.optional(),
	body: z
		.object({
			position: vec3PatchSchema.optional(),
			rotation: vec3PatchSchema.optional(),
			parentControllerNodeId: z.string().nullable().optional(),
		})
		.optional(),
	target: z
		.object({
			point: vec3PatchSchema.optional(),
			nodeId: z.string().nullable().optional(),
			parentControllerNodeId: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
	parentControllerNodeId: z.string().nullable().optional(),
});

const sceneDepthPlaneSpecSchema = z.object({
	z: z.number(),
	billboarding: z.enum(["screen-facing", "plane"]).optional(),
	cameraRigId: z.string().optional(),
});

const externalSceneAssetSpecSchema = z.object({
	assetId: z.string().optional(),
	nodeId: z.string().optional(),
	kind: z.enum(["external-scene", "model-3d", "code-module"]),
	name: z.string(),
	source: sceneMediaSourceSchema,
	bounds: boundsSchema,
	artboardId: z.string().optional(),
	format: z
		.enum(["gltf", "glb", "three-scene-json", "module", "html", "unknown"])
		.optional(),
	mimeType: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	previewAssetId: z.string().optional(),
	capabilities: z
		.array(
			z.enum([
				"preview",
				"runtime-webgl",
				"runtime-sandbox",
				"agent-generated",
				"import-placeholder",
				"depth-plane-ready",
				"export-fallback",
			]),
		)
		.optional(),
	issues: z
		.array(
			z.object({
				severity: z.enum(["info", "warning", "error"]),
				code: z.string(),
				message: z.string().optional(),
			}),
		)
		.optional(),
});

const motionControllerSpecSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	artboardId: z.string().nullable().optional(),
	position: vec3PatchSchema.optional(),
	handleRadius: z.number().optional(),
	visible: z.boolean().optional(),
});

const motionParentBindingSpecSchema = z.object({
	parentNodeId: z.string(),
	bindMatrix: affineMatrix2dSchema.optional(),
});

const transformConstraintChannelSchema = z.enum([
	"position",
	"rotation",
	"scale",
]);
const transformConstraintSpaceSchema = z.enum(["local", "world"]);
const relationNumericPropertySchema = z.enum([
	"style.opacity",
	"geometry.cornerRadius",
	"geometry.cornerSmoothing",
]);
const propertyRelationSpecSchema = z.object({
	id: z.string().optional(),
	sourceNodeId: z.string(),
	sourceProperty: relationNumericPropertySchema,
	targetProperty: relationNumericPropertySchema,
	scale: z.number().optional(),
	offset: z.number().optional(),
	clamp: z.object({ min: z.number(), max: z.number() }).optional(),
});

export const sceneCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("scene/rename-document"),
		name: z.string(),
	}),
	z.object({
		type: z.literal("scene/reorder-artboard"),
		artboardId: z.string(),
		toIndex: z.number().int(),
	}),
	z.object({
		type: z.literal("scene/initialize-sequence"),
		name: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/update-sequence"),
		patch: z.object({
			name: z.string().optional(),
			fps: z.number().nullable().optional(),
			exportSize: z
				.object({ width: z.number(), height: z.number() })
				.nullable()
				.optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/update-sequence-item"),
		itemId: z.string(),
		patch: z.object({
			label: z.string().nullable().optional(),
			durationFrames: z.number().nullable().optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/reorder-sequence-item"),
		itemId: z.string(),
		toIndex: z.number().int(),
	}),
	z.object({
		type: z.literal("scene/remove-sequence-item"),
		itemId: z.string(),
	}),
	z.object({ type: z.literal("scene/remove-sequence") }),
	z.object({
		type: z.literal("scene/add-layer"),
		layer: z
			.object({
				id: z.string().optional(),
				name: z.string().optional(),
				toIndex: z.number().int().optional(),
			})
			.optional(),
	}),
	z.object({
		type: z.literal("scene/update-layer"),
		layerId: z.string(),
		patch: z.object({
			name: z.string().optional(),
			visible: z.boolean().optional(),
			locked: z.boolean().optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/remove-layer"),
		layerId: z.string(),
		fallbackLayerId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/rename-node"),
		nodeId: z.string(),
		name: z.string(),
	}),
	z.object({
		type: z.literal("scene/set-node-visibility"),
		nodeId: z.string(),
		visible: z.boolean(),
	}),
	z.object({
		type: z.literal("scene/set-node-locked"),
		nodeId: z.string(),
		locked: z.boolean(),
	}),
	z.object({
		type: z.literal("scene/update-node-geometry"),
		nodeId: z.string(),
		geometry: appendGeometrySchema,
	}),
	z.object({
		type: z.literal("scene/create-blend"),
		sourceNodeIds: z.array(z.string()),
		spacing: blendSpacingSchema.optional(),
		orientation: z.enum(["page", "spine"]).optional(),
	}),
	z.object({
		type: z.literal("scene/update-blend"),
		blendNodeId: z.string(),
		patch: z.object({
			spacing: blendSpacingSchema.optional(),
			orientation: z.enum(["page", "spine"]).optional(),
			spine: blendSpineSchema.nullable().optional(),
			stacking: z.enum(["normal", "reversed"]).optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/remove-blend"),
		blendNodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/update-node-transform"),
		nodeId: z.string(),
		patch: transformPatchSchema,
	}),
	z.object({
		type: z.literal("scene/center-node-anchor"),
		nodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/update-node-style"),
		nodeId: z.string(),
		patch: stylePatchSchema,
	}),
	z.object({
		type: z.literal("scene/patch-effect-field"),
		target: bindableEffectTargetSchema,
		operation: effectFieldOperationSchema,
	}),
	z.object({
		type: z.literal("scene/update-text-node"),
		nodeId: z.string(),
		patch: textNodePatchSchema,
	}),
	z.object({
		type: z.literal("scene/update-corner-radius"),
		nodeId: z.string(),
		cornerRadius: z.number(),
	}),
	z.object({
		type: z.literal("scene/update-rect-corner-radii"),
		nodeId: z.string(),
		radii: z.object({
			tl: z.number().optional(),
			tr: z.number().optional(),
			br: z.number().optional(),
			bl: z.number().optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/update-corner-smoothing"),
		nodeId: z.string(),
		cornerSmoothing: z.number(),
	}),
	z.object({
		type: z.literal("scene/reorder-layer"),
		layerId: z.string(),
		toIndex: z.number(),
	}),
	z.object({
		type: z.literal("scene/reorder-node-within-layer"),
		layerId: z.string(),
		nodeId: z.string(),
		toIndex: z.number(),
	}),
	z.object({
		type: z.literal("scene/append-node"),
		layerId: z.string().optional(),
		node: appendNodeSpecSchema,
	}),
	z.object({
		type: z.literal("scene/set-duplicate-generator"),
		generator: z.object({
			sourceNodeId: z.string(),
			count: z.string(),
			seed: z.number().optional(),
			instance: z
				.object({
					x: z.string().optional(),
					y: z.string().optional(),
					rotation: z.string().optional(),
				})
				.optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/append-dot-matrix"),
		layerId: z.string().optional(),
		matrix: dotMatrixSpecSchema,
	}),
	z.object({
		type: z.literal("scene/append-pixel-art-objects"),
		layerId: z.string().optional(),
		pixelArt: pixelArtObjectSpecSchema,
	}),
	z.object({
		type: z.literal("scene/place-external-asset"),
		asset: externalSceneAssetSpecSchema,
		layerId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/upsert-asset"),
		asset: sceneAssetSchema,
	}),
	z.object({
		type: z.literal("scene/place-asset"),
		placement: z.object({
			assetId: z.string(),
			nodeId: z.string().optional(),
			name: z.string().optional(),
			bounds: boundsSchema,
			artboardId: z.string().optional(),
			layerId: z.string().optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/remove-unused-asset"),
		assetId: z.string(),
	}),
	z.object({
		type: z.literal("scene/add-scene-camera"),
		camera: sceneCameraSpecSchema,
		activateArtboardId: z.string().nullable().optional(),
	}),
	z.object({
		type: z.literal("scene/update-scene-camera"),
		cameraRigId: z.string(),
		patch: sceneCameraRigPatchSchema,
	}),
	z.object({
		type: z.literal("scene/remove-scene-camera"),
		cameraRigId: z.string(),
	}),
	z.object({
		type: z.literal("scene/set-active-scene-camera"),
		artboardId: z.string(),
		cameraRigId: z.string().nullable(),
	}),
	z.object({
		type: z.literal("scene/set-node-depth-plane"),
		nodeIds: z.array(z.string()),
		depthPlane: sceneDepthPlaneSpecSchema.nullable(),
	}),
	z.object({
		type: z.literal("scene/add-motion-controller"),
		controller: motionControllerSpecSchema,
		layerId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/set-motion-controller"),
		nodeId: z.string(),
		controller: z.object({ handleRadius: z.number().optional() }).nullable(),
	}),
	z.object({
		type: z.literal("scene/set-motion-parent"),
		nodeId: z.string(),
		binding: motionParentBindingSpecSchema.nullable(),
		frame: z.number().optional(),
	}),
	z.object({
		type: z.literal("scene/set-transform-constraint"),
		nodeId: z.string(),
		sourceNodeId: z.string().nullable(),
		channels: z.array(transformConstraintChannelSchema).min(1).optional(),
		strength: z.number().optional(),
		sourceSpace: transformConstraintSpaceSchema.optional(),
		destinationSpace: transformConstraintSpaceSchema.optional(),
		maintainOffset: z.boolean().optional(),
		frame: z.number().optional(),
	}),
	z.object({
		type: z.literal("scene/set-property-relation"),
		nodeId: z.string(),
		relation: propertyRelationSpecSchema.nullable(),
		relationId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/bind-camera-target-node"),
		cameraRigId: z.string(),
		nodeId: z.string().nullable(),
	}),
	z.object({
		type: z.literal("scene/bind-camera-target-controller"),
		cameraRigId: z.string(),
		controllerNodeId: z.string().nullable(),
	}),
	z.object({
		type: z.literal("scene/bind-camera-body-controller"),
		cameraRigId: z.string(),
		controllerNodeId: z.string().nullable(),
	}),
	z.object({
		type: z.literal("scene/create-layout-frame"),
		frameNodeId: z.string().optional(),
		layerId: z.string().optional(),
		parentNodeId: z.string().nullable().optional(),
		sourceNodeIds: z.array(z.string()),
		layout: layoutFramePatchSchema.optional(),
		preset: z
			.enum([
				"uniform-grid",
				"bento-hero-left",
				"bento-hero-top",
				"bento-mosaic",
			])
			.optional(),
		name: z.string().optional(),
		bounds: boundsSchema.optional(),
	}),
	z.object({
		type: z.literal("scene/update-layout-frame"),
		frameNodeId: z.string(),
		patch: layoutFramePatchSchema,
	}),
	z.object({
		type: z.literal("scene/set-layout-child-placement"),
		frameNodeId: z.string(),
		childNodeId: z.string(),
		placement: layoutCellPlacementSchema,
	}),
	z.object({
		type: z.literal("scene/set-layout-children-placements"),
		frameNodeId: z.string(),
		placements: z.array(
			z.object({
				childNodeId: z.string(),
				placement: layoutCellPlacementSchema,
			}),
		),
	}),
	z.object({
		type: z.literal("scene/apply-layout-preset"),
		frameNodeId: z.string(),
		preset: z.enum([
			"uniform-grid",
			"bento-hero-left",
			"bento-hero-top",
			"bento-mosaic",
		]),
	}),
	z.object({
		type: z.literal("scene/pack-layout-frame"),
		frameNodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/reapply-layout-frame"),
		frameNodeId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/capture-arrangement-layout-snapshot"),
		snapshot: z.object({
			snapshotId: z.string(),
			name: z.string(),
			artboardId: z.string(),
			nodeIds: z.array(z.string()),
			captureToken: z.string(),
		}),
	}),
	z.object({
		type: z.literal("scene/recapture-arrangement-layout-snapshot"),
		snapshot: z.object({
			snapshotId: z.string(),
			captureToken: z.string(),
			nodeIds: z.array(z.string()).optional(),
			name: z.string().optional(),
		}),
	}),
	z.object({
		type: z.literal("scene/remove-arrangement-layout-snapshot"),
		snapshotId: z.string(),
	}),
	z.object({
		type: z.literal("scene/delete-nodes"),
		nodeIds: z.array(z.string()),
	}),
	z.object({
		type: z.literal("scene/set-mask-relation-property"),
		contentNodeId: z.string(),
		relationId: z.string(),
		propertyId: z.enum(MASK_RELATION_PROPERTY_IDS),
		value: z.number(),
	}),
	z.object({
		type: z.literal("scene/set-bindable-property"),
		nodeId: z.string(),
		propertyId: z.string(),
		value: z.number(),
	}),
	z.object({
		type: z.literal("scene/set-bindable-expression"),
		nodeId: z.string(),
		propertyId: z.string(),
		expression: z.string(),
	}),
	z.object({
		type: z.literal("scene/clear-bindable-expression"),
		nodeId: z.string(),
		propertyId: z.string(),
	}),
	z.object({
		type: z.literal("scene/set-bindable-effect-property"),
		target: bindableEffectTargetSchema,
		propertyId: z.string(),
		value: z.number(),
	}),
	z.object({
		type: z.literal("scene/set-bindable-effect-expression"),
		target: bindableEffectTargetSchema,
		propertyId: z.string(),
		expression: z.string(),
	}),
	z.object({
		type: z.literal("scene/clear-bindable-effect-expression"),
		target: bindableEffectTargetSchema,
		propertyId: z.string(),
	}),
	z.object({
		type: z.literal("scene/patch-effect-stack"),
		target: bindableEffectTargetSchema,
		operation: effectLayerStackOperationSchema,
	}),
	z.object({
		type: z.literal("scene/set-effect-layer-property"),
		target: bindableEffectTargetSchema,
		layerId: z.string(),
		propertyId: z.string(),
		value: z.number(),
	}),
	z.object({
		type: z.literal("scene/patch-look-graph"),
		target: lookGraphTargetSchema,
		operation: lookGraphOperationSchema,
	}),
	z.object({
		type: z.literal("scene/mark-text-fragments"),
		groupId: z.string(),
		unit: z.enum(TEXT_FRAGMENT_UNITS).optional(),
	}),
	z.object({
		type: z.literal("scene/remove-duplicate-generator"),
		nodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/add-artboard"),
		artboard: artboardSpecSchema,
	}),
	z.object({
		type: z.literal("scene/update-artboard"),
		artboardId: z.string(),
		patch: artboardPatchSchema,
	}),
	z.object({
		type: z.literal("scene/add-source-optics-rig"),
		artboardId: z.string(),
		sourceNodeId: z.string(),
		id: z.string().optional(),
		name: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/update-source-optics-rig"),
		artboardId: z.string(),
		rigId: z.string(),
		patch: sourceOpticsRigPatchSchema,
	}),
	z.object({
		type: z.literal("scene/remove-source-optics-rig"),
		artboardId: z.string(),
		rigId: z.string(),
	}),
	z.object({
		type: z.literal("scene/bind-source-optics-response"),
		artboardId: z.string(),
		rigId: z.string(),
		targetNodeId: z.string(),
		id: z.string().optional(),
		response: sourceOpticsResponsePatchSchema.optional(),
	}),
	z.object({
		type: z.literal("scene/update-source-optics-response"),
		artboardId: z.string(),
		rigId: z.string(),
		bindingId: z.string(),
		patch: sourceOpticsResponsePatchSchema,
	}),
	z.object({
		type: z.literal("scene/unbind-source-optics-response"),
		artboardId: z.string(),
		rigId: z.string(),
		bindingId: z.string(),
	}),
	z.object({
		type: z.literal("scene/remove-artboard"),
		artboardId: z.string(),
		fallbackArtboardId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/set-current-artboard"),
		artboardId: z.string(),
	}),
	z.object({
		type: z.literal("scene/reparent-nodes"),
		nodeIds: z.array(z.string()),
		targetParentNodeId: z.string().nullable(),
		targetLayerId: z.string().optional(),
		toIndex: z.number().optional(),
	}),
	z.object({
		type: z.literal("scene/frame-nodes"),
		sourceNodeIds: z.array(z.string()),
		layerId: z.string().optional(),
		frameNodeId: z.string().optional(),
		name: z.string().optional(),
		clipsContent: z.boolean().optional(),
		artboardId: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/unframe-node"),
		frameNodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/group-nodes"),
		nodeIds: z.array(z.string()),
	}),
	z.object({
		type: z.literal("scene/ungroup-node"),
		groupNodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/use-node-as-mask"),
		maskNodeId: z.string(),
		contentNodeIds: z.array(z.string()),
		kind: maskRelationKindSchema.optional(),
	}),
	z.object({
		type: z.literal("scene/author-object-noise-gradient"),
		nodeId: z.string(),
		fieldMode: z.enum(["contour", "linear", "mesh"]).optional(),
		linearField: z
			.object({
				x1: z.number(),
				y1: z.number(),
				x2: z.number(),
				y2: z.number(),
				plateau: z.number().optional(),
			})
			.optional(),
		amount: z.number().optional(),
		grainStrength: z.number().optional(),
		materialStrength: z.number().optional(),
		particleContrast: z.number().optional(),
		blendMode: z.string().optional(),
		mode: z.enum(["particle", "mixed"]).optional(),
		overlayColor: z.string().optional(),
		revealPaint: revealPaintSchema.optional(),
	}),
	z.object({
		type: z.literal("scene/release-mask"),
		maskNodeId: z.string(),
	}),
	z.object({
		type: z.literal("scene/set-mask-relation-settings"),
		contentNodeId: z.string(),
		kind: maskRelationKindSchema,
		maskNodeId: z.string().optional(),
		value: z.string().optional(),
		relationId: z.string().optional(),
		settings: maskRelationSettingsSchema.optional(),
	}),
	z.object({
		type: z.literal("scene/add-style-preset"),
		options: createStylePresetOptionsSchema.optional(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/insert-style-preset"),
		preset: stylePresetSchema,
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/apply-style-preset"),
		presetId: z.string(),
		nodeIds: z.array(z.string()),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/rename-style-preset"),
		presetId: z.string(),
		name: z.string(),
	}),
	z.object({
		type: z.literal("scene/replace-style-preset"),
		presetId: z.string(),
		options: createStylePresetOptionsSchema,
	}),
	z.object({
		type: z.literal("scene/update-style-preset-typography"),
		presetId: z.string(),
		typography: stylePresetTypographySchema,
	}),
	z.object({
		type: z.literal("scene/remove-style-preset"),
		presetId: z.string(),
	}),
	z.object({
		type: z.literal("scene/reorder-style-preset"),
		presetId: z.string(),
		toIndex: z.number(),
	}),
	z.object({
		type: z.literal("scene/apply-path-operation"),
		operation: z.enum(PATH_OPERATIONS),
		nodeIds: z.array(z.string()),
	}),
	z.object({
		type: z.literal("scene/create-component-source"),
		sourceNodeId: z.string(),
		options: createComponentSymbolOptionsSchema.optional(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/insert-component-instance-from-symbol"),
		symbolId: z.string(),
		options: createComponentInstanceOptionsSchema.optional(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/set-component-timing-offset"),
		instanceRootNodeId: z.string(),
		offsetFrames: z.number(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/detach-component-instance"),
		instanceRootNodeId: z.string(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/apply-component-override"),
		instanceRootNodeId: z.string(),
		instanceNodeId: z.string(),
		override: componentNodeOverrideInputSchema,
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/reset-component-override"),
		instanceRootNodeId: z.string(),
		filter: componentOverrideResetFilterSchema.optional(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/add-component-prop"),
		options: createComponentPropOptionsSchema,
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/update-component-prop"),
		propId: z.string(),
		patch: componentPropUpdatePatchSchema,
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/remove-component-prop"),
		propId: z.string(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/add-interaction"),
		options: createInteractionOptionsSchema,
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/update-interaction"),
		interactionId: z.string(),
		patch: interactionUpdatePatchSchema,
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("scene/remove-interaction"),
		interactionId: z.string(),
		label: z.string().optional(),
	}),
]);

const sceneCommandArraySchema = z.array(sceneCommandSchema).max(64);

// Every ScalarAnimatableProperty (ANIMATABLE_PROPERTIES minus the three
// snapshot-valued properties handled by the dedicated pathShape case below).
// Deriving from the canonical array closes a real gap the hand-typed 8-literal
// list left: the six per-corner radii and cornerSmoothing were fully keyframable
// through the command bus but unreachable through this wire schema.
const scalarAnimatablePropertySchema = z.enum(SCALAR_ANIMATABLE_PROPERTIES);
const cameraRigAnimatablePropertySchema = z.enum(
	CAMERA_RIG_ANIMATABLE_PROPERTIES,
);

const pointSchema = z.tuple([z.number(), z.number()]);

const pathShapeSchema = z.object({
	type: z.literal("Shape"),
	closed: z.boolean(),
	vertices: z.array(pointSchema),
	inTangents: z.array(pointSchema),
	outTangents: z.array(pointSchema),
});

// Mirrors AgentKeyframeEasing. `template` is the preferred semantic timing path;
// custom y handles are optional so older x-only clients still resolve to 0/1.
const keyframeEasingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("template"), templateId: z.string() }),
	z.object({ kind: z.literal("preset"), preset: z.enum(EASING_PRESETS) }),
	z.object({
		kind: z.literal("custom"),
		x1: z.number(),
		y1: z.number().optional(),
		x2: z.number(),
		y2: z.number().optional(),
	}),
]);

const motionTimingTemplateIdSchema = z.custom<MotionTimingTemplateId>(
	(value) =>
		typeof value === "string" &&
		MOTION_TIMING_TEMPLATES.some((template) => template.id === value),
);

// Mirrors AgentAnimationClipSpec. `provenance` is deliberately absent: it
// marks a clip as motion-grammar-generated, which an agent-created clip
// cannot claim to be.
const animationClipSpecSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	startFrame: z.number(),
	durationFrames: z.number(),
	trackIds: z.array(z.string()).optional(),
});

const automationEffectTargetSchema = z.object({
	scope: z.enum(["scene", "selection", "group", "object", "layer"]),
	id: z.string().optional(),
});

const automationEffectSlotSchema = z.object({
	id: z.string(),
	path: z.string(),
	label: z.string().optional(),
});

const automationBindingSchema = z.discriminatedUnion("channel", [
	z.object({
		channel: z.literal("effectInfluence"),
		assignmentId: z.string(),
		path: z.string(),
	}),
	z.object({
		channel: z.literal("effectParam"),
		target: automationEffectTargetSchema,
		effect: automationEffectSlotSchema,
		path: z.string(),
	}),
	z.object({
		channel: z.literal("transform"),
		target: automationEffectTargetSchema,
		path: z.string(),
	}),
]);

const automationTrackSchema = z.object({
	binding: automationBindingSchema,
	mode: z.enum(["additive", "replace"]).optional(),
	keyframes: z
		.array(
			z.object({
				frame: z.number(),
				value: z.number(),
				easing: z.enum(["linear", "easeInOut", "hold"]).optional(),
			}),
		)
		.min(1),
});

const cameraCutSegmentSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	artboardId: z.string(),
	cameraRigId: z.string(),
	laneId: z.string().optional(),
	startFrame: z.number(),
	durationFrames: z.number(),
	transition: z.enum(["cut", "crossfade"]),
	transitionDurationFrames: z.number().optional(),
	thumbnailFrame: z.number().optional(),
});

const sourceOpticsParameterTargetSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("rig"),
		artboardId: z.string(),
		rigId: z.string(),
		parameterId: z.string(),
	}),
	z.object({
		kind: z.literal("ray"),
		artboardId: z.string(),
		rigId: z.string(),
		rayId: z.string(),
		parameterId: z.string(),
	}),
	z.object({
		kind: z.literal("binding"),
		artboardId: z.string(),
		rigId: z.string(),
		bindingId: z.string(),
		parameterId: z.string(),
	}),
]);

// Exported (alongside sceneCommandSchema/motionGrammarCommandSchema below) so
// scripts/check-agent-contract.ts can introspect the live Zod schema's literal
// `type` values instead of hand-maintaining a fourth copy of the command-kind
// list to check the other three against.
export const motionCommandSchema = z.union([
	z.object({
		type: z.literal("motion/apply-clip-timing-template"),
		clipId: z.string(),
		templateId: motionTimingTemplateIdSchema,
	}),
	z.object({
		type: z.literal("motion/repair-path-morph-topology"),
		trackId: z.string(),
	}),
	z.object({
		type: z.literal("motion/set-path-morph-first-vertex"),
		trackId: z.string(),
		frame: z.number(),
		firstVertexIndex: z.number(),
	}),
	z.object({
		type: z.literal("motion/reverse-path-morph-winding"),
		trackId: z.string(),
		frame: z.number(),
	}),
	z.object({
		type: z.literal("motion/enable-position-path"),
		nodeId: z.string(),
		keys: z
			.array(
				z.object({
					frame: z.number(),
					position: vec2Schema,
					inTangent: vec2Schema.optional(),
					outTangent: vec2Schema.optional(),
					spatialMode: z.enum(["corner", "continuous", "auto"]).optional(),
					roving: z.boolean().optional(),
				}),
			)
			.min(2),
	}),
	z.object({
		type: z.literal("motion/update-position-path-key"),
		nodeId: z.string(),
		frame: z.number(),
		inTangent: vec2Schema.optional(),
		outTangent: vec2Schema.optional(),
		spatialMode: z.enum(["corner", "continuous", "auto"]).optional(),
		roving: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("motion/retime-position-path-key"),
		nodeId: z.string(),
		fromFrame: z.number(),
		toFrame: z.number(),
	}),
	z.object({
		type: z.literal("motion/set-source-optics-keyframe"),
		target: sourceOpticsParameterTargetSchema,
		frame: z.number(),
		value: z.number(),
	}),
	z.object({
		type: z.literal("motion/remove-source-optics-keyframe"),
		target: sourceOpticsParameterTargetSchema,
		frame: z.number(),
	}),
	z.object({
		type: z.literal("motion/upsert-keyframe"),
		nodeId: z.string(),
		property: scalarAnimatablePropertySchema,
		frame: z.number(),
		value: z.number(),
		easing: keyframeEasingSchema.optional(),
	}),
	z.object({
		type: z.literal("motion/upsert-keyframe"),
		nodeId: z.string(),
		property: z.literal("pathShape"),
		frame: z.number(),
		value: pathShapeSchema,
		easing: keyframeEasingSchema.optional(),
	}),
	z.object({
		type: z.literal("motion/set-keyframe-easing"),
		trackId: z.string(),
		frame: z.number(),
		easing: keyframeEasingSchema,
	}),
	z.object({
		type: z.literal("motion/retime-keyframe"),
		trackId: z.string(),
		fromFrame: z.number(),
		toFrame: z.number(),
	}),
	z.object({
		type: z.literal("motion/remove-keyframe"),
		trackId: z.string(),
		frame: z.number(),
	}),
	z.object({
		type: z.literal("motion/remove-track"),
		trackId: z.string(),
	}),
	z.object({
		type: z.literal("motion/set-bindable-keyframe"),
		nodeId: z.string(),
		propertyId: z.string(),
		frame: z.number(),
		value: z.number(),
	}),
	z
		.object({
			type: z.literal("motion/upsert-look-node-keyframe"),
			lookNodeId: z.string(),
			paramKey: z.string(),
			frame: z.number(),
			value: z.number(),
			artboardId: z.string().optional(),
			owner: lookGraphOwnerSchema.optional(),
			expectedTargetNodeIds: z.array(z.string()).min(1).optional(),
		})
		.refine(
			(command) =>
				command.artboardId === undefined || command.owner === undefined,
			{
				message:
					"motion/upsert-look-node-keyframe accepts either artboardId or owner, not both — the TS contract makes them mutually exclusive (AgentLookGraphOwner replaces the legacy artboardId form).",
				path: ["owner"],
			},
		),
	z.object({
		type: z.literal("motion/remove-look-node-track"),
		lookNodeId: z.string(),
		paramKey: z.string(),
		owner: lookGraphOwnerSchema,
		expectedTargetNodeIds: z.array(z.string()).min(1).optional(),
	}),
	z.object({
		type: z.literal("motion/upsert-camera-keyframe"),
		cameraRigId: z.string(),
		property: cameraRigAnimatablePropertySchema,
		frame: z.number(),
		value: z.number(),
	}),
	z.object({
		type: z.literal("motion/upsert-production-control-keyframe"),
		linkId: z.string(),
		controlId: z.string(),
		frame: z.number(),
		value: z.number(),
	}),
	z.object({
		type: z.literal("motion/remove-production-control-keyframe"),
		linkId: z.string(),
		controlId: z.string(),
		frame: z.number(),
	}),
	z.object({
		type: z.literal("motion/retime-production-control-keyframe"),
		linkId: z.string(),
		controlId: z.string(),
		fromFrame: z.number(),
		toFrame: z.number(),
	}),
	z.object({
		type: z.literal("motion/set-camera-channel-expression"),
		cameraRigId: z.string(),
		channel: cameraRigAnimatablePropertySchema,
		expression: z.string(),
	}),
	z.object({
		type: z.literal("motion/remove-camera-channel-expression"),
		cameraRigId: z.string(),
		channel: cameraRigAnimatablePropertySchema,
	}),
	z.object({
		type: z.literal("motion/set-text-animator-offset-expression"),
		bindingId: z.string(),
		selectorIndex: z.number(),
		expression: z.string(),
	}),
	z.object({
		type: z.literal("motion/remove-text-animator-offset-expression"),
		bindingId: z.string(),
		selectorIndex: z.number(),
	}),
	z.object({
		type: z.literal("motion/upsert-camera-vector-keyframes"),
		cameraRigId: z.string(),
		kind: z.enum(["body", "target", "bodyRotation"]),
		frame: z.number(),
		value: z.object({
			x: z.number().optional(),
			y: z.number().optional(),
			z: z.number().optional(),
		}),
	}),
	z.object({
		type: z.literal("motion/remove-camera-keyframe"),
		cameraRigId: z.string(),
		property: cameraRigAnimatablePropertySchema,
		frame: z.number(),
	}),
	z.object({
		type: z.literal("motion/remove-camera-track"),
		cameraRigId: z.string(),
		property: cameraRigAnimatablePropertySchema,
	}),
	z.object({
		type: z.literal("motion/remove-camera-rig-tracks"),
		cameraRigId: z.string(),
	}),
	z.object({
		type: z.literal("motion/upsert-camera-cut"),
		segment: cameraCutSegmentSchema,
	}),
	z.object({
		type: z.literal("motion/retime-camera-cut"),
		segmentId: z.string(),
		startFrame: z.number().optional(),
		durationFrames: z.number().optional(),
	}),
	z.object({
		type: z.literal("motion/remove-camera-cut"),
		segmentId: z.string(),
	}),
	z.object({
		type: z.literal("motion/retime-camera-keyframe"),
		trackId: z.string(),
		fromFrame: z.number(),
		toFrame: z.number(),
	}),
	z.object({
		type: z.literal("motion/set-camera-keyframe-easing"),
		trackId: z.string(),
		frame: z.number(),
		easing: keyframeEasingSchema,
	}),
	z.object({
		type: z.literal("motion/apply-text-animator"),
		nodeId: z.string(),
		preset: z.enum(TEXT_ANIMATOR_PRESET_IDS),
		target: z.enum(["live-text", "outline-group"]).optional(),
		durationFrames: z.number().optional(),
	}),
	z.object({
		type: z.literal("motion/remove-text-animator"),
		nodeId: z.string(),
	}),
	z.object({
		type: z.literal("motion/set-text-animator-enabled"),
		nodeId: z.string(),
		enabled: z.boolean(),
	}),
	z.object({
		type: z.literal("motion/create-clip"),
		clip: animationClipSpecSchema,
	}),
	z.object({
		type: z.literal("motion/rename-clip"),
		clipId: z.string(),
		name: z.string(),
	}),
	z.object({
		type: z.literal("motion/trim-clip"),
		clipId: z.string(),
		startFrame: z.number(),
		durationFrames: z.number(),
	}),
	z.object({
		type: z.literal("motion/assign-clip-tracks"),
		clipId: z.string(),
		trackIds: z.array(z.string()),
	}),
	z.object({
		type: z.literal("motion/reorder-clip"),
		clipId: z.string(),
		toIndex: z.number(),
	}),
	z.object({
		type: z.literal("motion/delete-clip"),
		clipId: z.string(),
	}),
	z.object({
		type: z.literal("motion/create-automation-track"),
		track: automationTrackSchema,
	}),
	z.object({
		type: z.literal("motion/update-automation-track"),
		trackIndex: z.number(),
		track: automationTrackSchema,
	}),
	z.object({
		type: z.literal("motion/remove-automation-track"),
		trackIndex: z.number(),
	}),
	z.object({
		type: z.literal("motion/reorder-automation-track"),
		trackIndex: z.number(),
		toIndex: z.number(),
	}),
	z.object({
		type: z.literal("motion/set-automation-enabled"),
		enabled: z.boolean(),
	}),
	z.object({
		type: z.literal("motion/remove-automation"),
	}),
	z.object({
		type: z.literal("motion/propagate-to-instances"),
		sourceNodeIds: z.array(z.string()).optional(),
	}),
]);

const motionGrammarParametersSchema = z.record(z.string(), z.number());
const motionGrammarRandomPulseProfileSchema = z.object({
	version: z.literal(1),
	durationFrames: z.number(),
	segments: z.array(
		z.object({
			fromFrame: z.number(),
			toFrame: z.number(),
			fromValue: z.number(),
			toValue: z.number(),
			easing: z.tuple([z.number(), z.number(), z.number(), z.number()]),
		}),
	),
}) satisfies z.ZodType<MotionGrammarRandomPulseProfile>;
const motionGrammarArrangementMappingSchema = z.object({
	sourceSnapshotId: z.string(),
	destinationSnapshotId: z.string(),
	sourceToStage: z.record(z.string(), z.string()),
	stageToDestination: z.record(z.string(), z.string()),
	stageSlots: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
	pivot: z.object({ x: z.number(), y: z.number() }),
	stagingDelayFractionBySource: z.record(z.string(), z.number()).optional(),
}) satisfies z.ZodType<MotionGrammarArrangementMapping>;
const motionGrammarEffectBindingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("none") }),
	z.object({
		kind: z.literal("active-target-influence"),
		effect: automationEffectSlotSchema,
		targetScope: z
			.enum(["scene", "selection", "group", "object", "layer"])
			.optional(),
		strength: z.number().optional(),
	}),
	z.object({
		kind: z.literal("automation-param"),
		effect: automationEffectSlotSchema,
		path: z.string(),
		mode: z.enum(["additive", "replace"]).optional(),
	}),
	z.object({
		kind: z.literal("temporal-echo"),
		copies: z.number(),
		delayFrames: z.number(),
		decay: z.number(),
	}),
]) satisfies z.ZodType<MotionGrammarEffectBinding>;

export const motionGrammarCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("motion-grammar/apply-technique"),
		techniqueId: z.enum(MOTION_GRAMMAR_TECHNIQUE_IDS),
		targetIds: z.array(z.string()),
		bindingId: z.string().optional(),
		roleMap: z.record(z.string(), z.string()).optional(),
		parameters: motionGrammarParametersSchema.optional(),
		arrangementMapping: motionGrammarArrangementMappingSchema.optional(),
		seed: z.number().optional(),
		randomPulseProfile: motionGrammarRandomPulseProfileSchema.optional(),
	}),
	z.object({
		type: z.literal("motion-grammar/update-binding"),
		bindingId: z.string(),
		targetIds: z.array(z.string()).optional(),
		roleMap: z.record(z.string(), z.string()).nullable().optional(),
		arrangementMapping: motionGrammarArrangementMappingSchema
			.nullable()
			.optional(),
		randomPulseProfile: motionGrammarRandomPulseProfileSchema
			.nullable()
			.optional(),
		seed: z.number().nullable().optional(),
		effectBinding: motionGrammarEffectBindingSchema.nullable().optional(),
	}),
	z.object({
		type: z.literal("motion-grammar/reorder-binding"),
		bindingId: z.string(),
		toIndex: z.number(),
	}),
	z.object({
		type: z.literal("motion-grammar/apply-afterimage-selected-sources"),
		selectedSourceNodeIds: z.array(z.string()),
		bindingId: z.string(),
		parameters: motionGrammarParametersSchema.optional(),
	}),
	z.object({
		type: z.literal("motion-grammar/update-parameters"),
		bindingId: z.string(),
		parameters: motionGrammarParametersSchema,
		seed: z.number().optional(),
	}),
	z.object({
		type: z.literal("motion-grammar/remove-binding"),
		bindingId: z.string(),
	}),
	z.object({
		type: z.literal("motion-grammar/propagate-to-instances"),
		sourceNodeIds: z.array(z.string()).optional(),
	}),
]);

export const documentCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("document/update-timing"),
		artboardId: z.string(),
		fps: z.number(),
		durationFrames: z.number(),
		temporalPolicy: z.literal("preserve-frame-indices"),
		outOfRangePolicy: z.literal("reject"),
	}),
	z.object({
		type: z.literal("document/apply-stroke-draw-on"),
		nodeId: z.string(),
		durationFrames: z.number(),
		reverse: z.boolean().optional(),
		bindingId: z.string().optional(),
	}),
	z.object({
		type: z.literal("document/bake-motion-grammar-binding"),
		bindingId: z.string(),
		sampleStepFrames: z.number().optional(),
		sourceDisposition: z.enum(["archive", "remove"]),
	}),
	z.object({
		type: z.literal("document/expand-motion-grammar-binding"),
		bindingId: z.string(),
		sampleStepFrames: z.number().optional(),
		sourceDisposition: z.enum(["archive", "remove"]),
	}),
	z.object({
		type: z.literal("document/replace-motion-grammar-role"),
		bindingId: z.string(),
		fromNodeId: z.string(),
		toNodeId: z.string(),
		removeGeneratedSource: z.boolean().optional(),
	}),
]);

const documentCommandArraySchema = z.array(documentCommandSchema).min(1);

/**
 * Wire schema for the `camera/*` agent command family (camera verbs v1). Kept in
 * sync with the type union / compile switch / runtime guard by
 * `check:agent-contract` and consumed by the headless camera adapter.
 */
export const cameraVerbCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("camera/push-in"),
		subjectIds: z.array(z.string()),
		artboardId: z.string().optional(),
		startFrame: z.number().optional(),
		durationFrames: z.number().optional(),
		mode: z.enum(["zoom", "dolly"]).optional(),
	}),
	z.object({
		type: z.literal("camera/parallax-establish"),
		artboardId: z.string().optional(),
		startFrame: z.number().optional(),
		durationFrames: z.number().optional(),
		near: z.array(z.string()).optional(),
		mid: z.array(z.string()).optional(),
		far: z.array(z.string()).optional(),
	}),
	z.object({
		type: z.literal("camera/orbit"),
		subjectIds: z.array(z.string()),
		artboardId: z.string().optional(),
		startFrame: z.number().optional(),
		durationFrames: z.number().optional(),
		sweepDegrees: z.number().optional(),
	}),
]);

const cameraVerbCommandArraySchema = z.array(cameraVerbCommandSchema).max(64);

const toolResult = <TData>(result: AgentToolResult<TData>): CallToolResult => ({
	content: [{ type: "text", text: stableJsonStringify(result) }],
	structuredContent: { result },
});

type AgentToolRequestFor<TTool extends AgentToolRequest["tool"]> = Extract<
	AgentToolRequest,
	{ readonly tool: TTool }
>;

type ParsedAgentToolRequest<TTool extends AgentToolRequest["tool"]> =
	| {
			readonly ok: true;
			readonly request: AgentToolRequestFor<TTool>;
	  }
	| {
			readonly ok: false;
			readonly result: CallToolResult;
	  };

const commandContractError = (tool: AgentToolName): CallToolResult =>
	toolResult(
		agentErrorResult(
			tool,
			"agent.mcp-command-contract-invalid",
			"Command envelope failed the agent command contract guard. Check command type names and payload shapes; use `bun run vmactl -- schema` plus docs/agent-command-catalog.md for the current catalog.",
		),
	);

const parseAgentToolRequest = <TTool extends AgentToolRequest["tool"]>(
	tool: TTool,
	value: Record<string, unknown>,
): ParsedAgentToolRequest<TTool> => {
	const request = { tool, ...value };
	if (!isAgentToolRequest(request) || request.tool !== tool) {
		return { ok: false, result: commandContractError(tool) };
	}
	return { ok: true, request: request as AgentToolRequestFor<TTool> };
};

type McpPlanInput = {
	readonly intent: string;
	readonly planId?: string;
	readonly bridge?: AgentBridgeForwardTarget;
	readonly target?: unknown;
	readonly documentCommands?: readonly unknown[];
	readonly sceneCommands?: readonly unknown[];
	readonly motionCommands?: readonly unknown[];
	readonly motionGrammarCommands?: readonly unknown[];
	readonly includeValidation?: boolean;
};

const parsePlanRequest = (
	input: McpPlanInput,
): ParsedAgentToolRequest<"propose_edit_plan"> =>
	parseAgentToolRequest("propose_edit_plan", {
		intent: input.intent,
		...(input.target === undefined ? {} : { target: input.target }),
		...(input.documentCommands === undefined
			? {}
			: { documentCommands: input.documentCommands }),
		...(input.sceneCommands === undefined
			? {}
			: { sceneCommands: input.sceneCommands }),
		...(input.motionCommands === undefined
			? {}
			: { motionCommands: input.motionCommands }),
		...(input.motionGrammarCommands === undefined
			? {}
			: { motionGrammarCommands: input.motionGrammarCommands }),
		...(input.includeValidation === undefined
			? {}
			: { includeValidation: input.includeValidation }),
	});

const livePlanInputFromMcp = (
	input: McpPlanInput,
):
	| {
			readonly ok: true;
			readonly input: LivePlanInput;
	  }
	| {
			readonly ok: false;
			readonly result: CallToolResult;
	  } => {
	const parsed = parsePlanRequest(input);
	if (!parsed.ok) return parsed;
	const request = parsed.request;
	return {
		ok: true,
		input: {
			intent: request.intent,
			...(input.planId === undefined ? {} : { planId: input.planId }),
			...(input.bridge === undefined ? {} : { bridge: input.bridge }),
			...(request.target === undefined ? {} : { target: request.target }),
			...(request.documentCommands === undefined
				? {}
				: { documentCommands: request.documentCommands }),
			...(request.sceneCommands === undefined
				? {}
				: { sceneCommands: request.sceneCommands }),
			...(request.motionCommands === undefined
				? {}
				: { motionCommands: request.motionCommands }),
			...(request.motionGrammarCommands === undefined
				? {}
				: { motionGrammarCommands: request.motionGrammarCommands }),
			...(request.includeValidation === undefined
				? {}
				: { includeValidation: request.includeValidation }),
		},
	};
};

/**
 * Forwards an edit plan to the live editor and wraps the human-gated result (or
 * an honest bridge-unavailable error) as an MCP tool result. Unlike the headless
 * apply tools, this never falls back to a sandbox snapshot.
 */
const liveToolResult = async (
	op: "validate" | "apply",
	input: LivePlanInput,
): Promise<CallToolResult> => {
	const outcome = await forwardLiveAgentPlan(op, input);
	if (!outcome.ok) {
		const payload = {
			ok: false,
			op,
			code: outcome.code,
			message: outcome.error,
		};
		return {
			content: [{ type: "text", text: stableJsonStringify(payload) }],
			structuredContent: payload,
		};
	}
	return {
		content: [{ type: "text", text: stableJsonStringify(outcome.result) }],
		structuredContent: { result: outcome.result },
	};
};

const observeSelectionLive = async (
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<CallToolResult> =>
	toolResult(await observeSelectionLiveResult(bridge));

const observeDocumentLive = async (
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<CallToolResult> =>
	toolResult(await observeDocumentLiveResult(bridge));

const saveProjectLive = async ({
	bridge,
	intent,
	mode,
	name,
}: SaveProjectLiveArgs): Promise<CallToolResult> =>
	toolResult(
		await saveProjectLiveResult(
			{
				...(intent ? { intent } : {}),
				...(mode ? { mode } : {}),
				...(name ? { name } : {}),
			},
			bridge,
		),
	);

const observePreviewState = async (
	bridge: AgentBridgeForwardTarget | undefined,
): Promise<CallToolResult> =>
	toolResult(await observePreviewStateResult(bridge));

const captureEditorSnapshot = async (
	args: CaptureEditorSnapshotArgs,
): Promise<CallToolResult> =>
	toolResult(await captureEditorSnapshotResult(args));

const readJsonFile = async <T>(filePath: string): Promise<T> => {
	const absolutePath = path.resolve(process.cwd(), filePath);
	const contents = await readFile(absolutePath, "utf8");
	return JSON.parse(contents) as T;
};

type LoadedReproductionDescriptorData = ReproductionDescriptorImportResult & {
	readonly summary: {
		readonly sceneId: string;
		readonly artboardId: string;
		readonly layerCount: number;
		readonly roleCount: number;
		readonly motionTrackCount: number;
		readonly motionClipCount: number;
		readonly grammarBindingCount: number;
		readonly issueCount: number;
		readonly acceptanceCheckCount: number;
	};
};

const loadReproductionDescriptor = async (
	args: LoadReproductionDescriptorArgs,
): Promise<AgentToolResult<LoadedReproductionDescriptorData | null>> => {
	if (Boolean(args.descriptor) === Boolean(args.descriptorPath)) {
		return createAgentToolResult("load_reproduction_descriptor", null, [
			createAgentIssue(
				"agent.reproduction-descriptor-source-ambiguous",
				"error",
				"Provide exactly one of descriptor or descriptorPath.",
				{ kind: "tool", id: "load_reproduction_descriptor" },
			),
		]);
	}
	let descriptor: MotionReproductionDescriptor;
	try {
		descriptor =
			args.descriptor ??
			(await readJsonFile<MotionReproductionDescriptor>(
				args.descriptorPath ?? "",
			));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return createAgentToolResult("load_reproduction_descriptor", null, [
			createAgentIssue(
				"agent.reproduction-descriptor-load-failed",
				"error",
				message,
				{ kind: "tool", id: "load_reproduction_descriptor" },
			),
		]);
	}

	const parsed = motionReproductionDescriptorSchema.safeParse(descriptor);
	if (!parsed.success) {
		return createAgentToolResult("load_reproduction_descriptor", null, [
			createAgentIssue(
				"agent.reproduction-descriptor-invalid",
				"error",
				z.prettifyError(parsed.error),
				{ kind: "tool", id: "load_reproduction_descriptor" },
			),
		]);
	}

	const imported = createReproductionDescriptorSkeleton(
		parsed.data as MotionReproductionDescriptor,
		args.options ?? {},
	);
	const issues = imported.issues.map((issue) =>
		createAgentIssue(
			`agent.reproduction-descriptor-${issue.code}`,
			issue.severity,
			issue.message,
			{
				kind: "tool",
				id: "load_reproduction_descriptor",
				path: [
					issue.responsibleLayer,
					issue.roleId ? `role:${issue.roleId}` : "",
					issue.beatId ? `beat:${issue.beatId}` : "",
				]
					.filter(Boolean)
					.join("/"),
			},
		),
	);
	return createAgentToolResult(
		"load_reproduction_descriptor",
		{
			...imported,
			summary: {
				sceneId: imported.scene.id,
				artboardId:
					imported.scene.currentArtboardId ?? imported.scene.artboard.id,
				layerCount: imported.scene.layers.length,
				roleCount: Object.keys(imported.roleNodeIds).length,
				motionTrackCount: imported.motion.tracks.length,
				motionClipCount: imported.motion.clips.length,
				grammarBindingCount: imported.grammar.bindings.length,
				issueCount: imported.issues.length,
				acceptanceCheckCount: imported.acceptanceScaffold.length,
			},
		},
		issues,
	);
};

const withDocument = async <TData>(
	tool: AgentToolName,
	source: DocumentSource | undefined,
	handler: (context: AgentDocumentContext) => AgentToolResult<TData>,
): Promise<CallToolResult> =>
	toolResult(await runWithDocument(tool, source, handler));

const server = new McpServer(
	{ name: "vector-motion-author-agent", version: "0.1.0" },
	{
		instructions:
			'Use this server to inspect vector-motion-author scene/motion documents, discover bindable properties and motion-grammar techniques, validate them, apply typed scene, motion, and motion-grammar commands, and prepare export metadata. Scene edits must use apply_scene_commands; arbitrary JavaScript is never accepted. Camera-first motion standard: every artboard with spatial motion MUST have an active scene camera (Artboard.activeSceneCameraId) or an explicit cameraSpacePolicy: "screen_2d" declaration. Author global movement (push-in, parallax, establish, orbit, drift) through scene-camera tracks (scene/add-scene-camera + scene/set-active-scene-camera + motion/upsert-camera-keyframe), not correlated per-node transforms; reserve node tracks for object-local performance. See AGENTS.md\'s Camera-First Motion Standard and docs/3d-camera-motion-standards-plan.md for the full rationale.',
	},
);

server.registerTool(
	"observe_document",
	{
		title: "Observe Document",
		description:
			"Return a compact scene/motion/grammar summary for planning agent edits: artboards, layers, assets, style/component/interaction libraries, layout health, scene cameras, and motion tracks. Use observe_node for full per-node detail.",
		inputSchema: z.object({
			source: documentSourceSchema,
			detail: detailSchema,
		}),
	},
	async ({ source, detail }) =>
		withDocument("observe_document", source, (context) =>
			observeAgentDocument(context, detail),
		),
);

server.registerTool(
	"observe_node",
	{
		title: "Observe Node",
		description:
			"Full per-node read for planning edits: transform, style (fills/strokes/effects/blendMode), geometry (compact bounds/anchor-counts by default; set includeGeometry:true for raw coordinates), component/frame/blend/mask roles, recipe/look presence, attached motion (keyframe counts per property, text-animator and motion-grammar binding ids), and eligible bindable-property ids. Accepts up to 20 nodeIds per call; a missing node id reports a per-node issue but does not fail the rest of the batch.",
		inputSchema: z.object({
			source: documentSourceSchema,
			nodeIds: z.array(z.string()),
			includeGeometry: z.boolean().optional(),
		}),
	},
	async ({ source, nodeIds, includeGeometry }) =>
		withDocument("observe_node", source, (context) =>
			observeAgentNode(context, {
				tool: "observe_node",
				nodeIds,
				...(includeGeometry === undefined ? {} : { includeGeometry }),
			}),
		),
);

server.registerTool(
	"load_reproduction_descriptor",
	{
		title: "Load Reproduction Descriptor",
		description:
			"Convert a motion_reproduction_descriptor object or JSON file into editable Vecmo scene/motion/motion-grammar documents. This is a narrow, non-mutating load path for reference-motion skeletons: it preserves camera-space/depth/null intent, returns acceptance scaffolding and typed import issues, and never executes descriptor code or writes files.",
		inputSchema: loadReproductionDescriptorSchema,
	},
	async (args: LoadReproductionDescriptorArgs) =>
		toolResult(await loadReproductionDescriptor(args)),
);

server.registerTool(
	"list_artboards",
	{
		title: "List Artboards",
		description: "List normalized artboards and node ownership counts.",
		inputSchema: z.object({
			source: documentSourceSchema,
		}),
	},
	async ({ source }) =>
		withDocument("list_artboards", source, (context) =>
			listAgentArtboards(context),
		),
);

server.registerTool(
	"list_layers",
	{
		title: "List Layers",
		description: "List layer rows with bounded node summaries.",
		inputSchema: z.object({
			source: documentSourceSchema,
			offset: z.number().optional(),
			limit: z.number().optional(),
		}),
	},
	async ({ source, offset, limit }) =>
		withDocument("list_layers", source, (context) =>
			listAgentLayers(context, { offset, limit }),
		),
);

server.registerTool(
	"list_bindable_properties",
	{
		title: "List Bindable Properties",
		description:
			'List stable bindable-property ids from the registry with control metadata, source kind, export/runtime support, command reachability, and optional per-node eligibility. Use this before scene/set-bindable-property, scene/set-bindable-expression, scene/clear-bindable-expression, scene/set-bindable-effect-property, scene/set-bindable-effect-expression, scene/clear-bindable-effect-expression, or motion/set-bindable-keyframe instead of guessing property ids. Scene-camera rig channels (body/target/lens, e.g. camera.bodyX, camera.fovDegrees) are discoverable by passing an existing cameraRigId, or by filtering targetScope: "scene-camera" — they are still keyframed through motion/upsert-camera-keyframe, not through this tool.',
		inputSchema: z.object({
			source: documentSourceSchema,
			targetScope: bindablePropertyTargetScopeSchema,
			sourceKind: bindablePropertySourceKindSchema,
			nodeId: z.string().optional(),
			cameraRigId: z.string().optional(),
			sceneWritableOnly: z.boolean().optional(),
			keyframableOnly: z.boolean().optional(),
			includeIneligible: z.boolean().optional(),
		}),
	},
	async ({
		source,
		targetScope,
		sourceKind,
		nodeId,
		cameraRigId,
		sceneWritableOnly,
		keyframableOnly,
		includeIneligible,
	}) =>
		withDocument("list_bindable_properties", source, (context) =>
			listAgentBindableProperties(context, {
				tool: "list_bindable_properties",
				...(targetScope ? { targetScope } : {}),
				...(sourceKind ? { sourceKind } : {}),
				...(nodeId ? { nodeId } : {}),
				...(cameraRigId ? { cameraRigId } : {}),
				...(sceneWritableOnly === undefined ? {} : { sceneWritableOnly }),
				...(keyframableOnly === undefined ? {} : { keyframableOnly }),
				...(includeIneligible === undefined ? {} : { includeIneligible }),
			}),
		),
);

server.registerTool(
	"list_appearance_effects",
	{
		title: "List Appearance Effects",
		description:
			"List stroke softness and mask-feather appearance controls with current values, writeability, fidelity, and canonical write commands. Use this before editing appearance controls that are not normal bindable properties.",
		inputSchema: z.object({
			source: documentSourceSchema,
			nodeId: z.string().optional(),
		}),
	},
	async ({ source, nodeId }) =>
		withDocument("list_appearance_effects", source, (context) =>
			listAgentAppearanceEffects(context, {
				tool: "list_appearance_effects",
				...(nodeId ? { nodeId } : {}),
			}),
		),
);

server.registerTool(
	"list_motion_grammar",
	{
		title: "List Motion Grammar",
		description:
			"List authorable Motion Grammar technique ids, parameter specs, profile timing templates, command reachability, and current grammar bindings with resolved target-node status. Use this before motion-grammar/apply-technique, motion-grammar/update-parameters, or motion-grammar/remove-binding instead of guessing technique ids, timing templates, parameter keys, or binding ids.",
		inputSchema: z.object({
			source: documentSourceSchema,
			techniqueId: z.enum(MOTION_GRAMMAR_TECHNIQUE_IDS).optional(),
			nodeId: z.string().optional(),
			authorableOnly: z.boolean().optional(),
			implementedOnly: z.boolean().optional(),
			includeBindings: z.boolean().optional(),
			includeIneligibleTargets: z.boolean().optional(),
		}),
	},
	async ({
		source,
		techniqueId,
		nodeId,
		authorableOnly,
		implementedOnly,
		includeBindings,
		includeIneligibleTargets,
	}) =>
		withDocument("list_motion_grammar", source, (context) =>
			listAgentMotionGrammar(context, {
				tool: "list_motion_grammar",
				...(techniqueId ? { techniqueId } : {}),
				...(nodeId ? { nodeId } : {}),
				...(authorableOnly === undefined ? {} : { authorableOnly }),
				...(implementedOnly === undefined ? {} : { implementedOnly }),
				...(includeBindings === undefined ? {} : { includeBindings }),
				...(includeIneligibleTargets === undefined
					? {}
					: { includeIneligibleTargets }),
			}),
		),
);

server.registerTool(
	"list_look_graph",
	{
		title: "List Look Graph",
		description:
			"Read the graph-first Look resolved for a scene, artboard, or existing scoped-overlay target (default: current artboard): node ids/kinds/labels, typed edges, scoped target metadata, per-node canonical recipe payloads, honest per-node export fidelity, and topology-health issues. Use this before scene/patch-look-graph to inspect existing node ids and ports.",
		inputSchema: z.object({
			source: documentSourceSchema,
			target: lookGraphTargetSchema.optional(),
		}),
	},
	async ({ source, target }) =>
		withDocument("list_look_graph", source, (context) =>
			listAgentLookGraph(context, {
				tool: "list_look_graph",
				...(target ? { target } : {}),
			}),
		),
);

server.registerTool(
	"list_look_node_capabilities",
	{
		title: "List Look Node Capabilities",
		description:
			"List authorable Look node kinds, typed ports, payload params, keyframe eligibility, and the deterministic port-id scheme for scene/patch-look-graph planning.",
		inputSchema: z.object({
			source: documentSourceSchema,
		}),
	},
	async ({ source }) =>
		withDocument("list_look_node_capabilities", source, () =>
			listAgentLookNodeCapabilities(),
		),
);

server.registerTool(
	"run_validation",
	{
		title: "Run Validation",
		description:
			"Check document-level scene/motion/motion-grammar invariants before agent edits or export.",
		inputSchema: z.object({
			source: documentSourceSchema,
		}),
	},
	async ({ source }) =>
		withDocument("run_validation", source, (context) =>
			validateAgentDocument(context),
		),
);

server.registerTool(
	"propose_edit_plan",
	{
		title: "Propose Edit Plan",
		description:
			'Turn an intent plus typed document-timing, scene, motion, or motion-grammar command envelopes into a deterministic, reviewable no-mutation plan. Document timing is an isolated compound Scene+Motion operation; ordinary plans remain single-store. Spatial motion should ride scene-camera tracks (scene/add-scene-camera + motion/upsert-camera-keyframe), not correlated per-node transforms — see the Camera-First Motion Standard in AGENTS.md. Spatial motion on an artboard with no active scene camera and no cameraSpacePolicy: "screen_2d" declaration raises the agent.motion-without-scene-camera validation warning.',
		inputSchema: z.object({
			source: documentSourceSchema,
			intent: agentIntentSchema,
			target: agentIssueTargetSchema.optional(),
			documentCommands: documentCommandArraySchema.optional(),
			sceneCommands: sceneCommandArraySchema.optional(),
			motionCommands: commandArraySchema.optional(),
			motionGrammarCommands: commandArraySchema.optional(),
			includeValidation: z.boolean().optional(),
		}),
	},
	async (input) => {
		const parsed = parsePlanRequest(input);
		if (!parsed.ok) return parsed.result;
		const { request } = parsed;
		return withDocument("propose_edit_plan", input.source, (context) =>
			proposeAgentEditPlan(context, {
				intent: request.intent,
				target: request.target,
				documentCommands: request.documentCommands,
				sceneCommands: request.sceneCommands,
				motionCommands: request.motionCommands,
				motionGrammarCommands: request.motionGrammarCommands,
				includeValidation: request.includeValidation,
			}),
		);
	},
);

server.registerTool(
	"apply_scene_commands",
	{
		title: "Apply Scene Commands",
		description:
			"Apply typed AgentSceneCommand envelopes through the scene command bus and return an updated SceneDocument snapshot. Prefer `bun run vmactl -- schema` and docs/agent-command-catalog.md for the full command catalog; this MCP description is intentionally compact to keep tool metadata small.",
		inputSchema: z.object({
			source: documentSourceSchema,
			transactionId: z.string().optional(),
			dryRun: z.boolean().optional(),
			commands: sceneCommandArraySchema,
		}),
	},
	async (args) => {
		const parsed = parseAgentToolRequest("apply_scene_commands", {
			commands: args.commands,
			...(args.transactionId === undefined
				? {}
				: { transactionId: args.transactionId }),
			...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
		});
		if (!parsed.ok) return parsed.result;
		const request = {
			commands: parsed.request.commands,
			...(parsed.request.dryRun === undefined
				? {}
				: { dryRun: parsed.request.dryRun }),
			...(parsed.request.transactionId === undefined
				? {}
				: { transactionId: parsed.request.transactionId }),
		};
		return withDocument("apply_scene_commands", args.source, (context) =>
			applyAgentSceneCommands(context, request),
		);
	},
);

server.registerTool(
	"apply_motion_commands",
	{
		title: "Apply Motion Commands",
		description:
			'Apply typed AgentMotionCommand envelopes through the MotionDocument side-car command bus and return an updated MotionDocument snapshot. Use `bun run vmactl -- schema` and docs/agent-command-catalog.md for the full keyframe, camera-track, clip, text-animator, and propagation catalog. Spatial motion (push-in, parallax, establish, orbit, drift) should ride scene-camera tracks, not correlated per-node transforms — see the Camera-First Motion Standard in AGENTS.md. Spatial motion on an artboard with no active scene camera and no cameraSpacePolicy: "screen_2d" declaration raises the agent.motion-without-scene-camera validation warning.',
		inputSchema: z.object({
			source: documentSourceSchema,
			transactionId: z.string().optional(),
			dryRun: z.boolean().optional(),
			commands: commandArraySchema,
		}),
	},
	async (args) => {
		const parsed = parseAgentToolRequest("apply_motion_commands", {
			commands: args.commands,
			...(args.transactionId === undefined
				? {}
				: { transactionId: args.transactionId }),
			...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
		});
		if (!parsed.ok) return parsed.result;
		const request = {
			commands: parsed.request.commands,
			...(parsed.request.dryRun === undefined
				? {}
				: { dryRun: parsed.request.dryRun }),
			...(parsed.request.transactionId === undefined
				? {}
				: { transactionId: parsed.request.transactionId }),
		};
		return withDocument("apply_motion_commands", args.source, (context) =>
			applyAgentMotionCommands(context, request),
		);
	},
);

server.registerTool(
	"apply_motion_grammar_commands",
	{
		title: "Apply Motion Grammar Commands",
		description:
			'Apply typed AgentMotionGrammarCommand envelopes to the motion-grammar side-car and return an updated grammar snapshot. Use `bun run vmactl -- schema` and docs/agent-command-catalog.md for technique binding and propagation details. Grammar techniques that move a whole composition should ride scene-camera tracks rather than being phrased as correlated per-node bindings — see the Camera-First Motion Standard in AGENTS.md. Spatial motion on an artboard with no active scene camera and no cameraSpacePolicy: "screen_2d" declaration raises the agent.motion-without-scene-camera validation warning.',
		inputSchema: z.object({
			source: documentSourceSchema,
			transactionId: z.string().optional(),
			dryRun: z.boolean().optional(),
			commands: commandArraySchema,
		}),
	},
	async (args) => {
		const parsed = parseAgentToolRequest("apply_motion_grammar_commands", {
			commands: args.commands,
			...(args.transactionId === undefined
				? {}
				: { transactionId: args.transactionId }),
			...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
		});
		if (!parsed.ok) return parsed.result;
		const request = {
			commands: parsed.request.commands,
			...(parsed.request.dryRun === undefined
				? {}
				: { dryRun: parsed.request.dryRun }),
			...(parsed.request.transactionId === undefined
				? {}
				: { transactionId: parsed.request.transactionId }),
		};
		return withDocument(
			"apply_motion_grammar_commands",
			args.source,
			(context) => applyAgentMotionGrammarCommands(context, request),
		);
	},
);

server.registerTool(
	"apply_document_commands",
	{
		title: "Apply Document Commands",
		description:
			"Atomically apply typed cross-store document commands for timing, Stroke Draw-on, grammar bake/expansion, and semantic role replacement. Returns Scene, Motion, and Motion Grammar snapshots together; if any pure runner fails, every generated snapshot is discarded.",
		inputSchema: z.object({
			source: documentSourceSchema,
			transactionId: z.string().optional(),
			dryRun: z.boolean().optional(),
			commands: documentCommandArraySchema,
		}),
	},
	async (args) => {
		const parsed = parseAgentToolRequest("apply_document_commands", {
			commands: args.commands,
			...(args.transactionId === undefined
				? {}
				: { transactionId: args.transactionId }),
			...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
		});
		if (!parsed.ok) return parsed.result;
		const request = {
			commands: parsed.request.commands,
			...(parsed.request.dryRun === undefined
				? {}
				: { dryRun: parsed.request.dryRun }),
			...(parsed.request.transactionId === undefined
				? {}
				: { transactionId: parsed.request.transactionId }),
		};
		return withDocument("apply_document_commands", args.source, (context) =>
			applyAgentDocumentCommands(context, request),
		);
	},
);

server.registerTool(
	"apply_camera_commands",
	{
		title: "Apply Camera Commands",
		description:
			"Apply typed AgentCameraVerbCommand envelopes (camera/push-in, camera/parallax-establish, camera/orbit) and return updated SceneDocument and MotionDocument snapshots. See the Camera-First Motion Standard in AGENTS.md — these verbs are the standard way to author global movement (push-in, parallax, establish, orbit) through scene-camera tracks instead of correlated per-node transforms.",
		inputSchema: z.object({
			source: documentSourceSchema,
			transactionId: z.string().optional(),
			dryRun: z.boolean().optional(),
			commands: cameraVerbCommandArraySchema,
		}),
	},
	async (args) => {
		const parsed = parseAgentToolRequest("apply_camera_commands", {
			commands: args.commands,
			...(args.transactionId === undefined
				? {}
				: { transactionId: args.transactionId }),
			...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
		});
		if (!parsed.ok) return parsed.result;
		const request = {
			commands: parsed.request.commands,
			...(parsed.request.dryRun === undefined
				? {}
				: { dryRun: parsed.request.dryRun }),
			...(parsed.request.transactionId === undefined
				? {}
				: { transactionId: parsed.request.transactionId }),
		};
		return withDocument("apply_camera_commands", args.source, (context) =>
			applyAgentCameraVerbCommands(context, request),
		);
	},
);

server.registerTool(
	"validate_edit_plan_live",
	{
		title: "Validate Edit Plan (Live Editor)",
		description:
			"Forward a typed plan to the running editor for non-mutating review against the live document. Uses local discovery or an explicit bridge config. Created ids are provisional; do not chain validate-created ids into later commands.",
		inputSchema: z.object({
			intent: agentIntentSchema,
			planId: z.string().optional(),
			bridge: liveBridgeSchema,
			target: agentIssueTargetSchema.optional(),
			documentCommands: documentCommandArraySchema.optional(),
			sceneCommands: sceneCommandArraySchema.optional(),
			motionCommands: commandArraySchema.optional(),
			motionGrammarCommands: commandArraySchema.optional(),
			includeValidation: z.boolean().optional(),
		}),
	},
	async (input) => {
		const parsed = livePlanInputFromMcp(input);
		if (!parsed.ok) return parsed.result;
		return liveToolResult("validate", parsed.input);
	},
);

server.registerTool(
	"apply_edit_plan_live",
	{
		title: "Apply Edit Plan (Live Editor)",
		description:
			'Forward a typed plan to the running editor and apply it through the command bus after the editor-side approval policy passes. Local dev bridge auto-approves; production bridge sessions remain human-gated. Returns the undoable live result; use result.appliedCommands[].affected for committed per-command ids. Spatial motion should ride scene-camera tracks, not correlated per-node transforms — see the Camera-First Motion Standard in AGENTS.md. Spatial motion on an artboard with no active scene camera and no cameraSpacePolicy: "screen_2d" declaration raises the agent.motion-without-scene-camera validation warning.',
		inputSchema: z.object({
			intent: agentIntentSchema,
			planId: z.string().optional(),
			bridge: liveBridgeSchema,
			target: agentIssueTargetSchema.optional(),
			documentCommands: documentCommandArraySchema.optional(),
			sceneCommands: sceneCommandArraySchema.optional(),
			motionCommands: commandArraySchema.optional(),
			motionGrammarCommands: commandArraySchema.optional(),
			includeValidation: z.boolean().optional(),
		}),
	},
	async (input) => {
		const parsed = livePlanInputFromMcp(input);
		if (!parsed.ok) return parsed.result;
		return liveToolResult("apply", parsed.input);
	},
);

server.registerTool(
	"observe_selection",
	{
		title: "Observe Selection (Live Editor)",
		description:
			"Read live node selection, camera-authoring selection, and selected/focused artboard ids without mutation or approval prompt. Returns a typed bridge error when no editor is connected.",
		inputSchema: z.object({
			bridge: liveBridgeSchema,
		}),
	},
	async ({ bridge }) => observeSelectionLive(bridge),
);

server.registerTool(
	"observe_bridge_status",
	{
		title: "Observe Bridge Status (MCP Server)",
		description:
			"Report whether this running MCP server (or vmactl) process is stale relative to the checkout on disk: compiled-at-startup vs. on-disk AGENT_BRIDGE_PROTOCOL_VERSION, cwd, process start time, git HEAD, and local bridge discovery file presence. Use this before debugging a live-bridge connection failure to tell 'my MCP server needs a restart' apart from 'no relay is running'.",
		inputSchema: z.object({}),
	},
	async () => toolResult(await observeAgentBridgeStatus()),
);

server.registerTool(
	"observe_document_live",
	{
		title: "Observe Document (Live Editor)",
		description:
			"Read the LIVE editor's open document without mutation or approval prompt: document identity (name, working-copy id, project id, binding epoch), the current artboard, motion document timing, a bounded motion inventory (per-track ids/keyframe counts, no values), the current artboard's nodes (id/name/kind), and its scoped Look-graph overlays (target node ids and full per-node payloads). Target-fenced the same way as validate_edit_plan_live/apply_edit_plan_live. Use this — not the headless observe_document/list_look_graph — as pre-mutation proof of what a specific live editor instance/working copy actually contains before sending a document-timing or scoped-look-graph plan.",
		inputSchema: z.object({
			bridge: liveBridgeSchema,
		}),
	},
	async ({ bridge }) => observeDocumentLive(bridge),
);

server.registerTool(
	"save_project_live",
	{
		title: "Save Project (Live Editor)",
		description:
			"Ask the running editor to save through the app cloud-project path after the editor-side approval policy passes. Local dev bridge auto-approves; production bridge sessions remain human-gated. `save` updates or creates the active project; `save-as-new` and `save-as-copy` create new projects.",
		inputSchema: z.object({
			bridge: liveBridgeSchema,
			intent: z.string().optional(),
			mode: z.enum(["save", "save-as-new", "save-as-copy"]).optional(),
			name: z.string().optional(),
		}),
	},
	async (args: SaveProjectLiveArgs) => saveProjectLive(args),
);

server.registerTool(
	"observe_preview_state",
	{
		title: "Observe Preview State (Live Editor)",
		description:
			"Read the LIVE editor's native-capture readiness without mutation or approval prompt: target identity, current transport (isPlaying is the only gate on a committed still), the current artboard's timing (valid frame range 0..durationFrames-1), and whether a still could be captured now. Target-fenced like observe_document_live. Call before capture_editor_snapshot to choose valid frames.",
		inputSchema: z.object({
			bridge: liveBridgeSchema,
		}),
	},
	async ({ bridge }) => observePreviewState(bridge),
);

server.registerTool(
	"capture_editor_snapshot",
	{
		title: "Capture Editor Snapshot (Live Editor)",
		description:
			"Render committed artboard stills from the LIVE editor over a read-only, target-fenced capture session (Phase D). Pauses playback, renders each requested frame off a frozen clone of the current artboard, and restores playback — no document mutation, no undo, no autosave. Writes frame-<NNNN>.png plus frame-<NNNN>.json (metadata) and packet.json to outDir; returns metadata and file paths only (never base64). Frames must be integers in 0..durationFrames-1 (see observe_preview_state); out-of-range frames are rejected, not clamped. Optional artboardId is verify-only (errors on mismatch; never switches artboards). Local dev relay only — capture payloads exceed the production Durable Object message cap.",
		inputSchema: z.object({
			bridge: liveBridgeSchema,
			frames: z.array(z.number().int().min(0)).min(1),
			outDir: z.string().min(1),
			artboardId: z.string().optional(),
		}),
	},
	async (args) => captureEditorSnapshot(args),
);

server.registerTool(
	"export_artboard",
	{
		title: "Export Artboard",
		description:
			"Build deterministic export metadata and asset summaries without writing files.",
		inputSchema: z.object({
			source: documentSourceSchema,
			scope: z.enum(["current", "selected", "all"]).optional(),
			artboardIds: z.array(z.string()).optional(),
			formats: z
				.array(z.enum(["manifest", "scene-json", "motion-json", "svg", "pdf"]))
				.optional(),
			frame: z.number().optional(),
		}),
	},
	async (args) =>
		withDocument("export_artboard", args.source, (context) =>
			exportAgentArtboard(context, args),
		),
);

server.registerResource(
	"agent-contract",
	"vma://docs/agent-contract",
	{
		title: "Agent Integration Contract",
		mimeType: "text/markdown",
		description:
			"Project rules for using vector-motion-author through the agent MCP server.",
	},
	async (uri) => ({
		contents: [
			{
				uri: uri.href,
				mimeType: "text/markdown",
				text: [
					"# vector-motion-author agent contract",
					"",
					"- Prefer `bun run vmactl -- ...` for high-bandwidth local/headless/live agent work; MCP stays a thin compatibility and discovery surface.",
					"- Read-only tools (observe_document, observe_selection, observe_document_live, observe_preview_state, capture_editor_snapshot, observe_node, observe_bridge_status, list_artboards, list_layers, list_bindable_properties, list_motion_grammar, run_validation, export_artboard, propose_edit_plan) are safe to call without document mutation. capture_editor_snapshot additionally writes PNG/JSON artifacts to its outDir and transiently pauses playback (restored on completion), but never mutates the document.",
					"- observe_selection reads the LIVE editor's current node selection, camera-authoring selection, canvas-selected/focused artboard ids, and current playhead frame over the same bridge as validate_edit_plan_live/apply_edit_plan_live. It never mutates and never prompts a human. There is no headless equivalent (a loaded document snapshot has no user selection).",
					"- observe_document_live reads the LIVE editor's open document over the same target-fenced bridge as validate_edit_plan_live/apply_edit_plan_live: document identity (name, working-copy id, project id, binding epoch), current artboard, motion document timing, a bounded motion inventory, current-artboard nodes, and scoped Look-graph overlays. It never mutates and never prompts a human. Use it — not the headless observe_document/list_look_graph, which read a loaded snapshot, not a specific running editor instance — as pre-mutation proof before a document-timing or scoped-look-graph plan.",
					"- observe_preview_state reads the LIVE editor's native-capture readiness over the same target-fenced bridge: target identity, current transport (isPlaying is the only gate on a committed still), the current artboard's timing (valid frame range 0..durationFrames-1), and whether a still could be captured now. Read-only; call it before capture_editor_snapshot to choose valid frames.",
					"- capture_editor_snapshot renders committed artboard stills from the LIVE editor over a read-only, target-fenced session: it pauses playback, renders each requested frame off a FROZEN clone of the current artboard (not the live DOM canvas, so a WebGL-scoped Deep Glow and selection chrome are handled correctly), and restores playback — no document mutation, no undo, no autosave. It writes frame-<NNNN>.png plus frame-<NNNN>.json and packet.json to the required outDir and returns metadata and file paths only; the base64 PNG bytes cross only the WS bridge and never enter the model context. Frames are integers in 0..durationFrames-1 and are rejected (not silently clamped) out of range; the optional artboardId is verify-only and never switches artboards. LOCAL-RELAY-ONLY: a captured PNG can approach the local relay's 16MB envelope but exceeds the production Durable Object ~1MiB message cap, so run capture against the local `bun run agent:bridge` relay, not a remote bridge session.",
					"- observe_bridge_status reports whether THIS MCP server/vmactl process is stale relative to the checkout on disk (compiled-at-startup vs. on-disk AGENT_BRIDGE_PROTOCOL_VERSION), plus cwd, process start time, git HEAD, and local bridge discovery file presence. Call it first when a live tool reports no editor connected, to tell a stale MCP process (needs a restart) apart from no relay running at all.",
					"- observe_node is the full per-node read: transform, style, geometry, roles, recipe/look presence, attached motion, and eligible bindable-property ids for up to 20 node ids. Use it instead of piecing a node's state together from list_layers (which reports only kind/visible/locked) plus a guess at list_bindable_properties.",
					"- Use list_bindable_properties before scene/set-bindable-property, scene/set-bindable-expression, scene/clear-bindable-expression, scene/set-bindable-effect-property, scene/set-bindable-effect-expression, scene/clear-bindable-effect-expression, or motion/set-bindable-keyframe instead of guessing stable property ids.",
					"- Use list_appearance_effects before feathering an object mask (scene/set-mask-relation-property) or softening a stroke (scene/set-bindable-property style.strokeSoftness.blurRadius) to discover per-node mask relation ids and stroke softness, which are not in list_bindable_properties.",
					"- Effect Field writes use scene/patch-effect-field with Contour, Linear, or Mesh sources. Canonical visible target slots are style.opacity, style.effects.layer-blur, and recipe.glow.bloom; appearance.mask.featherRadius and style.strokeSoftness.blurRadius remain typed deferred until unambiguous spatial owner adapters land, while appearance.silhouetteAlphaSoftness is unsupported because no canonical owner exists. The compiler rejects unknown, ambiguous, duplicate, or newly deferred routes instead of selecting the first assignment.",
					"- Use list_motion_grammar before motion-grammar/apply-technique, motion-grammar/update-parameters, or motion-grammar/remove-binding instead of guessing technique ids, parameter keys, target status, or binding ids.",
					"- Scene edits must go through apply_scene_commands and the scene command bus.",
					"- For an agent-authored visible circle-cell study, read docs/product-knowledge/agent-dot-matrix-authoring.md and prefer scene/append-dot-matrix: it creates one editable compound path of circular contours from a bounded #/. occupancy pattern with one spacing and style law. The source-less headless context remains a technical demo, so use an explicit clean scene/artboard for visible candidates. Keep scene/append-node primitives on diagnostic/scratch surfaces unless bespoke geometry is the explicit visual thesis; never present technical rectangles or primitive soup as visual-quality proof.",
					"- For Codex-generated pixel objects, read docs/product-knowledge/ai-pixel-object-import.md and use scene/append-pixel-art-objects only after semantic pixel-art redraw and visual review. The compact indexed payload is bounded to 128 × 128, 32 colors, 256 native children, and 16,384 run contours; one plan may contain one such command. A supplied artboardId must already exist. Small disconnected same-color regions may share an overflow compound path without recoloring or dropping pixels.",
					"- Axis blur uses `radius` for X and optional `radiusY` for Y. For `scene/update-node-style`, replace `effects` with `radiusY` omitted to relink. For sparse `scene/patch-look-graph` blur payload patches, send `radiusY: null` to clear the optional Y value. A `radiusY` keyframe requires an explicit static `radiusY`; linked blur ignores stale Y tracks. X/Y blur is axis-aligned anisotropic Gaussian blur and does not imply arbitrary-angle, trajectory, motion-blur, or background-blur support.",
					"- Two edit surfaces exist. (1) HEADLESS, seed/file-scoped: apply_scene_commands, apply_motion_commands, and apply_motion_grammar_commands run the command bus against a loaded document snapshot and return the updated payload — they do NOT write files or touch the live editor. (2) LIVE: validate_edit_plan_live and apply_edit_plan_live forward a typed plan to the running editor over the local dev bridge or an explicit production bridge session.",
					"- Production live editing is explicit: open `/editor?agentBridge=1`, copy the MCP bridge config, and pass it as the live tool's `bridge` argument or set `VMA_AGENT_BRIDGE_BASE_URL`, `VMA_AGENT_BRIDGE_SESSION_ID`, and `VMA_AGENT_BRIDGE_TOKEN`.",
					"- apply_edit_plan_live applies after the editor-side approval policy passes: local dev bridge auto-approves, production bridge sessions require the approval banner unless the human enabled auto-apply trust mode. It lands as one undoable transaction in the target store and returns the editor's result. Cross-store live plans are rejected until compound undo/rollback exists. If no relay or editor is connected it returns an honest error rather than editing a sandbox. validate_edit_plan_live reviews against the live document without mutating.",
					"- Canonical id rule (live plan tools): an apply_edit_plan_live result's `appliedCommands[].affected` is the committed id for each successfully compiled command, index-aligned per store in request order — use it for created-resource ids (nodes, clips, artboards, frames, etc.). `plan.steps[].affected` in that same result carries the same committed ids but deduplicated, so it is not guaranteed one-per-command. A validate_edit_plan_live (or propose_edit_plan) result has no appliedCommands and its ids are provisional: that call compiles the envelope fresh, and a later apply_edit_plan_live call compiles again and mints different ids for anything created — never chain a created-resource id from a validate/propose result into a follow-up command. The headless apply_scene_commands/apply_motion_commands/apply_motion_grammar_commands tools have no appliedCommands field either; their only affected-ids surface is `data.report.affected`, which is deduplicated the same way plan.steps[].affected is.",
					"- Motion edits must go through apply_motion_commands (headless) or the live plan tools, and stay in the MotionDocument side-car.",
					"- Motion-grammar edits must go through apply_motion_grammar_commands (headless) or the live plan tools, and stay in the motion-grammar side-car: apply/update/remove bindings only, no track bake or workspace-object creation.",
					"- Editing a component SOURCE's motion/grammar propagates to every linked instance automatically on both surfaces (live: the editor's store subscription fires on any commit; headless: apply_motion_commands/apply_motion_grammar_commands run the resync internally before returning) — no extra call needed for the common case. Use motion/propagate-to-instances or motion-grammar/propagate-to-instances only to force a resync with no accompanying source edit, or to narrow it to specific sourceNodeIds.",
					"- export_artboard supports per-artboard scope (current/all/selected with artboardIds); 'selected' resolves against the loaded document's selection, so a seed/file document with no selection falls back to the current artboard and reports an artboard-selection-empty issue.",
				].join("\n"),
			},
		],
	}),
);

// Guard startup so importing this module (e.g. to reuse `sceneCommandSchema` in a
// verification harness) does not spin up the stdio transport. Running the file
// directly (`bun scripts/vma-agent-mcp.ts`, the MCP entry) still connects.
if (import.meta.main) {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
