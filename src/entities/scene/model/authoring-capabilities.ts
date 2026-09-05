import type { EntityAuthoringCapabilityManifest } from "@/shared/authoring-capability/model";
import {
	BINDABLE_PROPERTY_DESCRIPTORS,
	type BindablePropertyDescriptor,
} from "./bindable-property";
import { EFFECT_CAPABILITY_DESCRIPTORS } from "./effect-capabilities";
import type { LookGraphNodeKind } from "./look-graph";
import type {
	Artboard,
	BlendMode,
	ComponentPropBinding,
	ComponentPropType,
	Effect,
	InteractionActionKind,
	InteractionTriggerKind,
	NodeGeometry,
	Paint,
	SceneAsset,
	SceneDocument,
	SceneLayer,
	StrokeAlign,
	StrokeCap,
	StrokeJoin,
	VectorNode,
} from "./types";

const sceneCapability = <
	const TManifest extends Omit<EntityAuthoringCapabilityManifest, "owner">,
>(
	manifest: TManifest,
): TManifest & { readonly owner: "scene" } => ({ ...manifest, owner: "scene" });

export const SCENE_AUTHORING_CAPABILITIES = [
	sceneCapability({
		id: "scene.document.id",
		label: "Document identity",
		classification: "system_managed",
		kind: "atomic",
		modelAnchorIds: ["SceneDocument.id"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		classificationReason: "Document identity is minted by its owner.",
	}),
	sceneCapability({
		id: "scene.document.name",
		label: "Document name",
		classification: "authorable",
		kind: "atomic",
		modelAnchorIds: ["SceneDocument.name"],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["scene/rename-document"],
		presenceProbeId: "scene.document.name",
	}),
	sceneCapability({
		id: "scene.document.schema-version",
		label: "Scene schema version",
		classification: "system_managed",
		kind: "atomic",
		modelAnchorIds: ["SceneDocument.schemaVersion"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		classificationReason: "Serialization owns schema versions.",
	}),
	sceneCapability({
		id: "scene.artboards",
		label: "Artboards",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: ["SceneDocument.artboard", "SceneDocument.artboards"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/add-artboard",
			"scene/update-artboard",
			"scene/remove-artboard",
			"scene/reorder-artboard",
		],
		presenceProbeId: "scene.artboards",
	}),
	sceneCapability({
		id: "scene.current-artboard",
		label: "Current artboard",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: ["SceneDocument.currentArtboardId"],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["scene/set-current-artboard"],
		presenceProbeId: "scene.current-artboard",
	}),
	sceneCapability({
		id: "scene.sequence",
		label: "Scene sequence",
		classification: "authorable",
		kind: "timeline",
		modelAnchorIds: ["SceneDocument.sequence"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/sequence-initialize",
			"scene/sequence-update",
			"scene/sequence-update-item",
			"scene/sequence-remove",
			"scene/sequence-move-item",
		],
		presenceProbeId: "scene.sequence",
	}),
	sceneCapability({
		id: "scene.layers",
		label: "Layers",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: ["SceneDocument.layers", "SceneLayer"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/add-layer",
			"scene/update-layer",
			"scene/remove-layer",
			"scene/reorder-layer",
		],
		presenceProbeId: "scene.layers",
	}),
	sceneCapability({
		id: "scene.node.identity",
		label: "Node identity and name",
		classification: "authorable",
		kind: "atomic",
		modelAnchorIds: ["VectorNode.id", "VectorNode.name"],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["scene/rename-node"],
		presenceProbeId: "scene.node.identity",
	}),
	sceneCapability({
		id: "scene.node.visibility-lock",
		label: "Node visibility and lock",
		classification: "authorable",
		kind: "atomic",
		modelAnchorIds: ["VectorNode.visible", "VectorNode.locked"],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["scene/set-node-visibility", "scene/set-node-locked"],
		presenceProbeId: "scene.node.visibility-lock",
	}),
	sceneCapability({
		id: "scene.node.hierarchy",
		label: "Node hierarchy",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: ["SceneLayer.nodes", "VectorNode.children"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/append-node",
			"scene/reparent-nodes",
			"scene/delete-nodes",
			"scene/reorder-node-within-layer",
		],
		presenceProbeId: "scene.node.hierarchy",
	}),
	...(
		[
			"rect",
			"ellipse",
			"line",
			"polygon",
			"star",
			"path",
			"text",
			"image",
		] as const
	).map((kind) =>
		sceneCapability({
			id: `scene.geometry.${kind}`,
			label: `${kind} geometry`,
			classification: "authorable",
			kind: "structure",
			modelAnchorIds: [`NodeGeometry.${kind}`],
			requiredOperations: ["read", "create", "update", "remove"],
			commandPlannerIds: [
				"scene/append-node",
				"scene/update-node-geometry",
				"scene/delete-nodes",
			],
			presenceProbeId: `scene.geometry.${kind}`,
		}),
	),
	sceneCapability({
		id: "scene.node.transform",
		label: "Node transform",
		classification: "authorable",
		kind: "atomic",
		modelAnchorIds: ["VectorNode.transform"],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["scene/update-node-transform"],
		presenceProbeId: "scene.node.transform",
	}),
	sceneCapability({
		id: "scene.appearance.basic",
		label: "Basic appearance",
		classification: "authorable",
		kind: "atomic",
		modelAnchorIds: [
			"VectorNode.style.fill",
			"VectorNode.style.stroke",
			"VectorNode.style.strokeWidth",
			"VectorNode.style.opacity",
		],
		requiredOperations: ["read", "update"],
		commandPlannerIds: ["scene/update-node-style"],
		presenceProbeId: "scene.appearance.basic",
	}),
	sceneCapability({
		id: "scene.appearance.rich",
		label: "Rich appearance",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: [
			"NodeStyle.fills",
			"NodeStyle.strokes",
			"NodeStyle.effects",
		],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/add-appearance-item",
			"scene/update-appearance-item",
			"scene/reorder-appearance-item",
			"scene/remove-appearance-item",
		],
		presenceProbeId: "scene.appearance.rich",
	}),
	sceneCapability({
		id: "scene.appearance.look",
		label: "Look and effect intent",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: [
			"SceneDocument.effectIntent",
			"Artboard.effectIntent",
			"VectorNode.recipe",
		],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"createApplyLookGraphOperationCommand",
			"scene/update-effect-intent",
		],
		presenceProbeId: "scene.appearance.look",
	}),
	sceneCapability({
		id: "scene.appearance.mask",
		label: "Appearance mask relation",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: ["NodeStyle.appearanceMask"],
		requiredOperations: ["read", "bind", "update", "unbind"],
		commandPlannerIds: [
			"scene/set-mask-relation-behavior",
			"scene/release-mask",
		],
		presenceProbeId: "scene.appearance.mask",
	}),
	sceneCapability({
		id: "scene.assets",
		label: "Scene assets",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: [
			"SceneDocument.assets",
			"ImageGeometry.assetId",
			// S5a minimal audio lane: audio has no node/geometry placement, so its
			// only durable anchor is this frame-anchored sidecar rather than a
			// second capability id. See `docs/plans/active/blender-vecmo-integrated-motion-plan.html`
			// #s5 (S5a) for the four-point minimal contract this covers.
			"SceneDocument.audioTracks",
		],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/place-existing-asset",
			"scene/replace-image-asset",
			"scene/remove-unused-asset",
			"scene/add-audio-asset",
			"scene/upsert-audio-track",
			"scene/remove-audio-track",
		],
		presenceProbeId: "scene.assets",
	}),
	sceneCapability({
		id: "scene.components",
		label: "Components",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: ["SceneDocument.componentSymbols", "VectorNode.component"],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/create-component-source",
			"scene/apply-component-override",
			"scene/remove-component-symbol",
		],
		presenceProbeId: "scene.components",
	}),
	sceneCapability({
		id: "scene.component-props",
		label: "Component properties",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: ["SceneDocument.componentProps"],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/add-component-prop",
			"scene/update-component-prop",
			"scene/remove-component-prop",
		],
		presenceProbeId: "scene.component-props",
	}),
	sceneCapability({
		id: "scene.style-presets",
		label: "Style presets",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: ["SceneDocument.stylePresets"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/add-style-preset",
			"scene/replace-style-preset",
			"scene/remove-style-preset",
			"scene/reorder-style-preset",
		],
		presenceProbeId: "scene.style-presets",
	}),
	sceneCapability({
		id: "scene.expressions",
		label: "Native and effect expressions",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: [
			"SceneDocument.nativeExpressionBindings",
			"SceneDocument.effectExpressionBindings",
		],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/set-native-expression-binding",
			"scene/set-effect-expression-binding",
			"scene/clear-native-expression-binding",
			"scene/clear-effect-expression-binding",
		],
		presenceProbeId: "scene.expressions",
	}),
	sceneCapability({
		id: "scene.duplicate-generators",
		label: "Duplicate generators",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: ["SceneDocument.duplicateGenerators"],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/set-duplicate-generator",
			"scene/remove-duplicate-generator",
		],
		presenceProbeId: "scene.duplicate-generators",
	}),
	sceneCapability({
		id: "scene.layout-frame",
		label: "Layout frames",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: ["VectorNode.frame"],
		requiredOperations: ["read", "create", "update", "remove", "reorder"],
		commandPlannerIds: [
			"scene/frame-nodes",
			"scene/update-layout-frame",
			"scene/unframe-node",
			"scene/set-layout-child-placement",
		],
		presenceProbeId: "scene.layout-frame",
	}),
	sceneCapability({
		id: "scene.blend",
		label: "Blend structure",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: ["VectorNode.blend", "VectorNode.blendStep"],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/create-blend",
			"scene/update-blend",
			"scene/release-blend",
		],
		presenceProbeId: "scene.blend",
	}),
	sceneCapability({
		id: "scene.motion-parent",
		label: "Motion parent",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: ["VectorNode.motionParent"],
		requiredOperations: ["read", "bind", "update", "unbind"],
		commandPlannerIds: [
			"scene/set-motion-parents",
			"scene/detach-motion-parents",
		],
		presenceProbeId: "scene.motion-parent",
	}),
	sceneCapability({
		id: "scene.constraints",
		label: "Transform and property constraints",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: [
			"VectorNode.transformConstraint",
			"VectorNode.propertyRelations",
		],
		requiredOperations: ["read", "bind", "update", "unbind"],
		commandPlannerIds: [
			"scene/set-transform-constraint",
			"scene/set-property-relation",
			"scene/remove-transform-constraint",
			"scene/remove-property-relation",
		],
		presenceProbeId: "scene.constraints",
	}),
	sceneCapability({
		id: "scene.camera-depth",
		label: "Scene cameras and depth",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: [
			"SceneDocument.sceneCameras",
			"Artboard.activeSceneCameraId",
			"VectorNode.depthPlane",
		],
		requiredOperations: [
			"read",
			"create",
			"update",
			"remove",
			"bind",
			"unbind",
		],
		commandPlannerIds: [
			"scene-camera/add",
			"scene-camera/update",
			"scene-camera/remove",
			"scene-camera/set-active",
			"scene-camera/set-depth-plane",
		],
		presenceProbeId: "scene.camera-depth",
	}),
	sceneCapability({
		id: "scene.source-optics",
		label: "Source Optics",
		classification: "authorable",
		kind: "relationship",
		modelAnchorIds: ["Artboard.sourceOpticsRigs"],
		requiredOperations: [
			"read",
			"create",
			"update",
			"remove",
			"bind",
			"unbind",
		],
		commandPlannerIds: [
			"scene/add-source-optics-rig",
			"scene/update-source-optics-rig",
			"scene/remove-source-optics-rig",
		],
		presenceProbeId: "scene.source-optics",
	}),
	sceneCapability({
		id: "scene.interactions",
		label: "Interactions",
		classification: "authorable",
		kind: "structure",
		modelAnchorIds: ["SceneDocument.interactions"],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/add-interaction",
			"scene/update-interaction",
			"scene/remove-interaction",
		],
		presenceProbeId: "scene.interactions",
	}),
	sceneCapability({
		id: "scene.arrangement-snapshots",
		label: "Arrangement snapshots",
		classification: "authorable",
		kind: "collection",
		modelAnchorIds: ["SceneDocument.arrangementLayoutSnapshots"],
		requiredOperations: ["read", "create", "update", "remove"],
		commandPlannerIds: [
			"scene/capture-arrangement-layout-snapshot",
			"scene/recapture-arrangement-layout-snapshot",
			"scene/remove-arrangement-layout-snapshot",
		],
		presenceProbeId: "scene.arrangement-snapshots",
	}),
	sceneCapability({
		id: "scene.node.provenance-data",
		label: "Node provenance data",
		classification: "system_managed",
		kind: "structure",
		modelAnchorIds: ["VectorNode.data"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		presenceProbeId: "scene.node.provenance-data",
		classificationReason:
			"Open provenance payloads are compatibility metadata, not a raw authoring surface.",
	}),
	sceneCapability({
		id: "scene.generated-roles",
		label: "Generated presentation roles",
		classification: "derived",
		kind: "structure",
		modelAnchorIds: ["VectorNode.blendStep", "VectorNode.textFragmentGroup"],
		requiredOperations: ["read"],
		commandPlannerIds: [],
		presenceProbeId: "scene.generated-roles",
		classificationReason:
			"Generated roles are edited through their owning Blend or Text operation.",
	}),
] as const satisfies readonly EntityAuthoringCapabilityManifest[];

export type SceneAuthoringCapabilityId =
	(typeof SCENE_AUTHORING_CAPABILITIES)[number]["id"];

export const SCENE_DOCUMENT_CAPABILITY_BY_KEY = {
	schemaVersion: "scene.document.schema-version",
	id: "scene.document.id",
	name: "scene.document.name",
	artboard: "scene.artboards",
	artboards: "scene.artboards",
	currentArtboardId: "scene.current-artboard",
	sequence: "scene.sequence",
	effectIntent: "scene.appearance.look",
	layers: "scene.layers",
	stylePresets: "scene.style-presets",
	componentSymbols: "scene.components",
	assets: "scene.assets",
	sceneCameras: "scene.camera-depth",
	effectExpressionBindings: "scene.expressions",
	nativeExpressionBindings: "scene.expressions",
	duplicateGenerators: "scene.duplicate-generators",
	componentProps: "scene.component-props",
	interactions: "scene.interactions",
	arrangementLayoutSnapshots: "scene.arrangement-snapshots",
	audioTracks: "scene.assets",
} as const satisfies Record<keyof SceneDocument, SceneAuthoringCapabilityId>;

export const ARTBOARD_CAPABILITY_BY_KEY = {
	id: "scene.artboards",
	name: "scene.artboards",
	role: "scene.artboards",
	position: "scene.artboards",
	width: "scene.artboards",
	height: "scene.artboards",
	background: "scene.appearance.basic",
	fills: "scene.appearance.rich",
	fps: "scene.artboards",
	durationFrames: "scene.artboards",
	activeSceneCameraId: "scene.camera-depth",
	cameraSpacePolicy: "scene.camera-depth",
	effectIntent: "scene.appearance.look",
	sourceOpticsRigs: "scene.source-optics",
} as const satisfies Record<keyof Artboard, SceneAuthoringCapabilityId>;

export const SCENE_LAYER_CAPABILITY_BY_KEY = {
	id: "scene.layers",
	name: "scene.layers",
	visible: "scene.layers",
	locked: "scene.layers",
	nodes: "scene.node.hierarchy",
} as const satisfies Record<keyof SceneLayer, SceneAuthoringCapabilityId>;

export const VECTOR_NODE_CAPABILITY_BY_KEY = {
	id: "scene.node.identity",
	name: "scene.node.identity",
	artboardId: "scene.node.hierarchy",
	geometry: "discriminant:NodeGeometry",
	transform: "scene.node.transform",
	style: "scene.appearance.rich",
	visible: "scene.node.visibility-lock",
	locked: "scene.node.visibility-lock",
	recipeRef: "scene.appearance.look",
	recipe: "scene.appearance.look",
	component: "scene.components",
	frame: "scene.layout-frame",
	motionParent: "scene.motion-parent",
	transformConstraint: "scene.constraints",
	propertyRelations: "scene.constraints",
	motionController: "scene.motion-parent",
	depthPlane: "scene.camera-depth",
	children: "scene.node.hierarchy",
	textFragmentGroup: "scene.generated-roles",
	blend: "scene.blend",
	blendStep: "scene.generated-roles",
	data: "scene.node.provenance-data",
} as const satisfies Record<
	keyof VectorNode,
	SceneAuthoringCapabilityId | "discriminant:NodeGeometry"
>;

export const NODE_GEOMETRY_CAPABILITY_BY_KIND = {
	rect: "scene.geometry.rect",
	ellipse: "scene.geometry.ellipse",
	line: "scene.geometry.line",
	polygon: "scene.geometry.polygon",
	star: "scene.geometry.star",
	path: "scene.geometry.path",
	text: "scene.geometry.text",
	image: "scene.geometry.image",
} as const satisfies Record<NodeGeometry["kind"], SceneAuthoringCapabilityId>;

export const PAINT_CAPABILITY_BY_KIND = {
	solid: "scene.appearance.rich",
	"linear-gradient": "scene.appearance.rich",
	"radial-gradient": "scene.appearance.rich",
	"image-reference": "scene.assets",
	"mesh-gradient": "scene.appearance.rich",
} as const satisfies Record<Paint["kind"], SceneAuthoringCapabilityId>;

export const EFFECT_CAPABILITY_BY_KIND = {
	"drop-shadow": "scene.appearance.rich",
	"inner-shadow": "scene.appearance.rich",
	"layer-blur": "scene.appearance.rich",
	"background-blur": "scene.appearance.rich",
} as const satisfies Record<Effect["kind"], SceneAuthoringCapabilityId>;

export const COMPONENT_PROP_CAPABILITY_BY_TYPE = {
	number: "scene.component-props",
	color: "scene.component-props",
	text: "scene.component-props",
} as const satisfies Record<ComponentPropType, SceneAuthoringCapabilityId>;

export const COMPONENT_PROP_BINDING_CAPABILITY_BY_KIND = {
	bindable: "scene.component-props",
	"style-color": "scene.component-props",
	"text-content": "scene.component-props",
} as const satisfies Record<
	ComponentPropBinding["kind"],
	"scene.component-props"
>;

export const BLEND_MODE_CAPABILITY = {
	normal: "scene.appearance.rich",
	multiply: "scene.appearance.rich",
	screen: "scene.appearance.rich",
	overlay: "scene.appearance.rich",
	darken: "scene.appearance.rich",
	lighten: "scene.appearance.rich",
	"color-dodge": "scene.appearance.rich",
	"color-burn": "scene.appearance.rich",
	"hard-light": "scene.appearance.rich",
	"soft-light": "scene.appearance.rich",
	difference: "scene.appearance.rich",
	exclusion: "scene.appearance.rich",
	hue: "scene.appearance.rich",
	saturation: "scene.appearance.rich",
	color: "scene.appearance.rich",
	luminosity: "scene.appearance.rich",
} as const satisfies Record<BlendMode, "scene.appearance.rich">;

export const STROKE_ALIGN_CAPABILITY = {
	inside: "scene.appearance.rich",
	center: "scene.appearance.rich",
	outside: "scene.appearance.rich",
} as const satisfies Record<StrokeAlign, "scene.appearance.rich">;

export const STROKE_CAP_CAPABILITY = {
	butt: "scene.appearance.rich",
	round: "scene.appearance.rich",
	square: "scene.appearance.rich",
} as const satisfies Record<StrokeCap, "scene.appearance.rich">;

export const STROKE_JOIN_CAPABILITY = {
	miter: "scene.appearance.rich",
	round: "scene.appearance.rich",
	bevel: "scene.appearance.rich",
} as const satisfies Record<StrokeJoin, "scene.appearance.rich">;

export const LOOK_GRAPH_NODE_CAPABILITY_BY_KIND = {
	source: "scene.appearance.look",
	output: "scene.appearance.look",
	grade: "scene.appearance.look",
	glow: "scene.appearance.look",
	grain: "scene.appearance.look",
	blur: "scene.appearance.look",
	"chromatic-fringe": "scene.appearance.look",
	displace: "scene.appearance.look",
	posterize: "scene.appearance.look",
	"color-map": "scene.appearance.look",
	"find-edges": "scene.appearance.look",
	scanline: "scene.appearance.look",
	halftone: "scene.appearance.look",
	"pixel-grid": "scene.appearance.look",
	"ordered-dither": "scene.appearance.look",
	"ascii-glyph": "scene.appearance.look",
	"block-mosaic": "scene.appearance.look",
	"noise-field": "scene.appearance.look",
	warp: "scene.appearance.look",
	lens: "scene.appearance.look",
	kaleidoscope: "scene.appearance.look",
	flow: "scene.appearance.look",
	"path-blur": "scene.appearance.look",
	"noise-source": "scene.appearance.look",
	"deep-glow": "scene.appearance.look",
	riso: "scene.appearance.look",
	colorama: "scene.appearance.look",
	"wave-warp": "scene.appearance.look",
	"bend-warp": "scene.appearance.look",
	"vhs-color": "scene.appearance.look",
	"vhs-tracking": "scene.appearance.look",
	"vhs-noise": "scene.appearance.look",
	"crt-display": "scene.appearance.look",
	"signal-glitch": "scene.appearance.look",
	interlace: "scene.appearance.look",
	mask: "scene.appearance.look",
	composite: "scene.appearance.look",
} as const satisfies Record<LookGraphNodeKind, "scene.appearance.look">;

export const SCENE_ASSET_CAPABILITY_BY_KIND = {
	image: "scene.assets",
	video: "scene.assets",
	audio: "scene.assets",
	"external-scene": "scene.assets",
	"model-3d": "scene.assets",
	"code-module": "scene.assets",
	"program-surface": "scene.assets",
} as const satisfies Record<SceneAsset["kind"], "scene.assets">;

export const INTERACTION_TRIGGER_CAPABILITY_BY_KIND = {
	click: "scene.interactions",
	"hover-in": "scene.interactions",
	"hover-out": "scene.interactions",
	"in-view": "scene.interactions",
	"scroll-progress": "scene.interactions",
} as const satisfies Record<InteractionTriggerKind, "scene.interactions">;

export const INTERACTION_ACTION_CAPABILITY_BY_KIND = {
	"play-clip": "scene.interactions",
	"toggle-clip": "scene.interactions",
	seek: "scene.interactions",
	"set-prop": "scene.interactions",
	pause: "scene.interactions",
	resume: "scene.interactions",
} as const satisfies Record<InteractionActionKind, "scene.interactions">;

const bindableCapabilityId = (
	descriptor: BindablePropertyDescriptor,
): SceneAuthoringCapabilityId => {
	switch (descriptor.source.kind) {
		case "scene-property":
			if (descriptor.source.path.startsWith("transform.")) {
				return "scene.node.transform";
			}
			if (descriptor.source.path.startsWith("geometry.")) {
				return "scene.geometry.rect";
			}
			return descriptor.source.path === "style.opacity"
				? "scene.appearance.basic"
				: "scene.appearance.rich";
		case "effect-capability":
			return "scene.appearance.look";
		case "duplicate-generator":
			return "scene.duplicate-generators";
		case "scene-camera":
			return "scene.camera-depth";
	}
};

/** Open-id registry sensor; the reporter separately rejects duplicate ids. */
export const BINDABLE_PROPERTY_CAPABILITY_BY_ID = Object.fromEntries(
	BINDABLE_PROPERTY_DESCRIPTORS.map((descriptor) => [
		descriptor.id,
		bindableCapabilityId(descriptor),
	]),
) as Readonly<Record<string, SceneAuthoringCapabilityId>>;

/** Open-id registry sensor for the current effect capability descriptors. */
export const EFFECT_DESCRIPTOR_AUTHORING_CAPABILITY_BY_ID = Object.fromEntries(
	EFFECT_CAPABILITY_DESCRIPTORS.map((descriptor) => [
		descriptor.id,
		"scene.appearance.look" as const,
	]),
) as Readonly<Record<string, "scene.appearance.look">>;
