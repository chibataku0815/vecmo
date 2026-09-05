import type { CameraRigAnimatableProperty } from "@/entities/motion/model/types";
import {
	EFFECT_CAPABILITY_DESCRIPTORS,
	type EffectCapabilityDescriptor,
	type EffectCapabilityValueKind,
	type EffectRuntimeSupport,
	type EffectRuntimeSupportMatrix,
} from "./effect-capabilities";
import type { NodeGeometry } from "./types";

/** Scope that can own a code-bindable authoring property. */
export type BindablePropertyTargetScope =
	| "node"
	| "artboard"
	| "scene"
	| "duplicate-generator"
	| "scene-camera";

export const BINDABLE_PROPERTY_TARGET_SCOPES = [
	"node",
	"artboard",
	"scene",
	"duplicate-generator",
	"scene-camera",
] as const satisfies readonly BindablePropertyTargetScope[];

/** Persisted source model that ultimately owns a bindable property's value. */
export type BindablePropertySource =
	| {
			readonly kind: "scene-property";
			readonly path:
				| "transform.position.x"
				| "transform.position.y"
				| "transform.anchor.x"
				| "transform.anchor.y"
				| "transform.rotation"
				| "transform.scale.x"
				| "transform.scale.y"
				| "style.opacity"
				| "geometry.cornerRadius"
				| "geometry.cornerRadii.tl"
				| "geometry.cornerRadii.tr"
				| "geometry.cornerRadii.br"
				| "geometry.cornerRadii.bl"
				| "geometry.cornerSmoothing"
				| "style.strokeSoftness.blurRadius";
	  }
	| {
			readonly kind: "effect-capability";
			readonly capabilityId: string;
	  }
	| {
			readonly kind: "duplicate-generator";
			readonly channel: "count" | "x" | "y" | "rotation";
	  }
	| {
			readonly kind: "scene-camera";
			readonly property: CameraRigAnimatableProperty;
	  };

export const BINDABLE_PROPERTY_SOURCE_KINDS = [
	"scene-property",
	"effect-capability",
	"duplicate-generator",
	"scene-camera",
] as const satisfies readonly BindablePropertySource["kind"][];

/**
 * Eligibility for a target. This stays declarative so UI, agent commands, and
 * export reports can answer "can this property bind here?" without duplicating
 * scene-shape checks.
 */
export type BindablePropertyEligibility =
	| { readonly kind: "any-node" }
	| {
			readonly kind: "geometry";
			readonly geometryKinds: readonly NodeGeometry["kind"][];
			readonly requiredMode?: "rect-per-corner";
	  }
	| {
			readonly kind: "effect-capability";
			readonly capabilityId: string;
	  }
	| { readonly kind: "duplicate-generator" }
	| { readonly kind: "scene-camera" };

/** Primitive control metadata shared by Inspector, agents, and expression tools. */
export type BindablePropertyControl = {
	readonly valueKind: EffectCapabilityValueKind;
	readonly defaultValue: unknown;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly unit?: string;
	readonly options?: readonly string[];
	readonly keyframable: boolean;
	readonly expressionBindable: boolean;
	readonly agentWritable: boolean;
};

/** How a direct UI gesture should treat an existing expression binding. */
export type BindableDirectManipulationConflictPolicy =
	| "write-keyframe-when-recording"
	| "update-expression-parameter"
	| "detach-expression"
	| "block-with-reason";

/** Direct-manipulation affordance tied to the property, if one exists. */
export type BindableDirectManipulation = {
	readonly surface: "canvas" | "inspector" | "timeline";
	readonly gesture:
		| "drag-position"
		| "drag-rotation"
		| "drag-corner-radius"
		| "scrub-field"
		| "retime-keyframe"
		| "edit-code-field";
	readonly expressionConflictPolicy: BindableDirectManipulationConflictPolicy;
};

/** Mapping from this authoring property to a motion/keyframe channel. */
export type BindableKeyframeChannel = {
	readonly property:
		| "x"
		| "y"
		| "anchorX"
		| "anchorY"
		| "rotation"
		| "scaleX"
		| "scaleY"
		| "opacity"
		| "cornerRadius"
		| "cornerRadiusTL"
		| "cornerRadiusTR"
		| "cornerRadiusBR"
		| "cornerRadiusBL"
		| "cornerSmoothing";
	readonly valueSpace: "authored" | "render-clamped";
};

/** Support matrix for code-native property handoff surfaces. */
export type BindablePropertySupportMatrix = {
	readonly editorCanvas: EffectRuntimeSupport;
	readonly svgExport: EffectRuntimeSupport;
	readonly pdfExport: EffectRuntimeSupport;
	readonly motionRuntimeJs: EffectRuntimeSupport;
	readonly reactWrapper: EffectRuntimeSupport;
	readonly webmCapture: EffectRuntimeSupport;
	readonly bundleManifest: EffectRuntimeSupport;
};

/**
 * One source-of-truth descriptor for a property that can be authored visually,
 * driven by expressions, patched by agents, and reported at export/runtime
 * boundaries. The descriptor is intentionally behavior-free; writers still use
 * the existing scene/motion command buses.
 */
export type BindablePropertyDescriptor = {
	readonly id: string;
	readonly label: string;
	readonly source: BindablePropertySource;
	readonly targetScopes: readonly BindablePropertyTargetScope[];
	readonly eligibility: BindablePropertyEligibility;
	readonly control: BindablePropertyControl;
	readonly keyframeChannel?: BindableKeyframeChannel;
	readonly directManipulation?: readonly BindableDirectManipulation[];
	readonly support: BindablePropertySupportMatrix;
};

export type BindablePropertyValidationIssue =
	| { readonly kind: "duplicate-id"; readonly id: string }
	| { readonly kind: "empty-target-scopes"; readonly id: string }
	| { readonly kind: "invalid-effect-capability"; readonly id: string };

const NATIVE_SCALAR_SUPPORT = {
	editorCanvas: "native",
	svgExport: "native",
	pdfExport: "native",
	motionRuntimeJs: "native",
	reactWrapper: "native",
	webmCapture: "capture-only",
	bundleManifest: "native",
} as const satisfies BindablePropertySupportMatrix;

const CORNER_RADIUS_SUPPORT = {
	editorCanvas: "native",
	svgExport: "native",
	pdfExport: "native",
	motionRuntimeJs: "approximated",
	reactWrapper: "approximated",
	webmCapture: "capture-only",
	bundleManifest: "native",
} as const satisfies BindablePropertySupportMatrix;

const CORNER_SMOOTHING_SUPPORT = {
	editorCanvas: "native",
	svgExport: "native",
	pdfExport: "approximated",
	motionRuntimeJs: "side-car-only",
	reactWrapper: "side-car-only",
	webmCapture: "capture-only",
	bundleManifest: "native",
} as const satisfies BindablePropertySupportMatrix;

// Stroke-only blur renders natively on the editor canvas, the client SVG export,
// and the standalone code/runtime export (all split fill/stroke and Gaussian-blur
// just the stroke via the shared mask-svg filter helper). PDF renders the stroke
// sharp (no soft-stroke primitive). The bundle manifest carries the raw scene-JSON
// value faithfully.
const STROKE_BLUR_SUPPORT = {
	editorCanvas: "native",
	svgExport: "native",
	pdfExport: "unsupported",
	motionRuntimeJs: "native",
	reactWrapper: "native",
	webmCapture: "capture-only",
	bundleManifest: "native",
} as const satisfies BindablePropertySupportMatrix;

const DUPLICATE_GENERATOR_SUPPORT = {
	editorCanvas: "native",
	svgExport: "native",
	pdfExport: "unsupported",
	motionRuntimeJs: "native",
	reactWrapper: "native",
	webmCapture: "capture-only",
	bundleManifest: "native",
} as const satisfies BindablePropertySupportMatrix;

const directManipulation = (
	surface: BindableDirectManipulation["surface"],
	gesture: BindableDirectManipulation["gesture"],
	expressionConflictPolicy: BindableDirectManipulationConflictPolicy,
): BindableDirectManipulation => ({
	surface,
	gesture,
	expressionConflictPolicy,
});

const numberControl = (options: {
	readonly defaultValue: number;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly unit?: string;
	readonly keyframable?: boolean;
	readonly expressionBindable?: boolean;
	readonly agentWritable?: boolean;
}): BindablePropertyControl => ({
	valueKind: "number",
	defaultValue: options.defaultValue,
	min: options.min,
	max: options.max,
	step: options.step,
	unit: options.unit,
	keyframable: options.keyframable ?? true,
	expressionBindable: options.expressionBindable ?? true,
	agentWritable: options.agentWritable ?? true,
});

const sceneNumberProperty = (descriptor: {
	readonly id: string;
	readonly label: string;
	readonly path: Extract<
		BindablePropertySource,
		{ readonly kind: "scene-property" }
	>["path"];
	readonly defaultValue: number;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly unit?: string;
	readonly eligibility?: BindablePropertyEligibility;
	readonly keyframeChannel?: BindableKeyframeChannel;
	readonly directManipulation?: readonly BindableDirectManipulation[];
	readonly support?: BindablePropertySupportMatrix;
	readonly keyframable?: boolean;
	readonly expressionBindable?: boolean;
}): BindablePropertyDescriptor => ({
	id: descriptor.id,
	label: descriptor.label,
	source: { kind: "scene-property", path: descriptor.path },
	targetScopes: ["node"],
	eligibility: descriptor.eligibility ?? { kind: "any-node" },
	control: numberControl({
		defaultValue: descriptor.defaultValue,
		min: descriptor.min,
		max: descriptor.max,
		step: descriptor.step,
		unit: descriptor.unit,
		keyframable: descriptor.keyframable,
		expressionBindable: descriptor.expressionBindable,
	}),
	keyframeChannel: descriptor.keyframeChannel,
	directManipulation: descriptor.directManipulation,
	support: descriptor.support ?? NATIVE_SCALAR_SUPPORT,
});

/**
 * `@__PURE__`-wrapped (via an IIFE, since the array literal itself isn't a
 * call expression esbuild can annotate directly) so a bundler that never
 * reaches a consumer of {@link BINDABLE_PROPERTY_DESCRIPTORS} (every LEAN/FLAT
 * runtime-sampler tier — see `docs/codemap.md`'s motion/timeline row) can
 * tree-shake this whole derivation away, same reasoning and same fix shape as
 * `source-optics.ts`'s `SOURCE_OPTICS_PARAMETER_DESCRIPTORS`. Without this,
 * esbuild can't prove the `sceneNumberProperty(...)` calls inside are free of
 * observable side effects and keeps this array (and the module-level code
 * that pulls it, and everything downstream through `BINDABLE_PROPERTY_
 * DESCRIPTORS`/`BINDABLE_PROPERTY_BY_ID`) alive even when nothing in a given
 * bundle calls `bindablePropertyById`. Must stay free of real side effects;
 * behavior for every existing caller (editor, FULL, CORE) is unchanged.
 */
const scalarSceneProperties = /* @__PURE__ */ (() =>
	[
		sceneNumberProperty({
			id: "transform.x",
			label: "X",
			path: "transform.position.x",
			defaultValue: 0,
			unit: "px",
			keyframeChannel: { property: "x", valueSpace: "authored" },
			directManipulation: [
				directManipulation(
					"canvas",
					"drag-position",
					"write-keyframe-when-recording",
				),
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		sceneNumberProperty({
			id: "transform.y",
			label: "Y",
			path: "transform.position.y",
			defaultValue: 0,
			unit: "px",
			keyframeChannel: { property: "y", valueSpace: "authored" },
			directManipulation: [
				directManipulation(
					"canvas",
					"drag-position",
					"write-keyframe-when-recording",
				),
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		sceneNumberProperty({
			id: "transform.anchorX",
			label: "Anchor X",
			path: "transform.anchor.x",
			defaultValue: 0,
			unit: "px",
			keyframeChannel: { property: "anchorX", valueSpace: "authored" },
			directManipulation: [
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		sceneNumberProperty({
			id: "transform.anchorY",
			label: "Anchor Y",
			path: "transform.anchor.y",
			defaultValue: 0,
			unit: "px",
			keyframeChannel: { property: "anchorY", valueSpace: "authored" },
			directManipulation: [
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		sceneNumberProperty({
			id: "transform.rotation",
			label: "Rotation",
			path: "transform.rotation",
			defaultValue: 0,
			unit: "deg",
			keyframeChannel: { property: "rotation", valueSpace: "authored" },
			directManipulation: [
				directManipulation(
					"canvas",
					"drag-rotation",
					"write-keyframe-when-recording",
				),
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		// No `drag-scale` canvas gesture exists yet (resize handles compose scale
		// through the transform gesture reducer, not a dedicated scalar drag), so
		// this mirrors anchorX/anchorY: inspector-only direct manipulation. `min: 0`
		// documents the whole-editor invariant that negative (flip) scale is
		// unsupported (see MIN_SCALE in features/transform/model/gestures.ts) —
		// descriptive only, like the other numeric bounds on this registry; nothing
		// in the write path clamps against it.
		sceneNumberProperty({
			id: "transform.scaleX",
			label: "Scale X",
			path: "transform.scale.x",
			defaultValue: 1,
			min: 0,
			keyframeChannel: { property: "scaleX", valueSpace: "authored" },
			directManipulation: [
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		sceneNumberProperty({
			id: "transform.scaleY",
			label: "Scale Y",
			path: "transform.scale.y",
			defaultValue: 1,
			min: 0,
			keyframeChannel: { property: "scaleY", valueSpace: "authored" },
			directManipulation: [
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
		sceneNumberProperty({
			id: "style.opacity",
			label: "Opacity",
			path: "style.opacity",
			defaultValue: 1,
			min: 0,
			max: 1,
			step: 0.01,
			keyframeChannel: { property: "opacity", valueSpace: "authored" },
			directManipulation: [
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
		}),
	] as const satisfies readonly BindablePropertyDescriptor[])();

const cornerEligibility: BindablePropertyEligibility = {
	kind: "geometry",
	geometryKinds: ["rect", "polygon", "star"],
};

const rectPerCornerEligibility: BindablePropertyEligibility = {
	kind: "geometry",
	geometryKinds: ["rect"],
	requiredMode: "rect-per-corner",
};

/** Same `@__PURE__`-IIFE shape as {@link scalarSceneProperties} above, same reason. */
const cornerProperties = /* @__PURE__ */ (() =>
	[
		sceneNumberProperty({
			id: "geometry.cornerRadius",
			label: "Corner radius",
			path: "geometry.cornerRadius",
			defaultValue: 0,
			min: 0,
			step: 1,
			unit: "px",
			eligibility: cornerEligibility,
			keyframeChannel: { property: "cornerRadius", valueSpace: "authored" },
			directManipulation: [
				directManipulation(
					"canvas",
					"drag-corner-radius",
					"write-keyframe-when-recording",
				),
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
			support: CORNER_RADIUS_SUPPORT,
		}),
		...(["tl", "tr", "br", "bl"] as const).map((corner) =>
			sceneNumberProperty({
				id: `geometry.cornerRadii.${corner}`,
				label: `Corner radius ${corner.toUpperCase()}`,
				path: `geometry.cornerRadii.${corner}`,
				defaultValue: 0,
				min: 0,
				step: 1,
				unit: "px",
				eligibility: rectPerCornerEligibility,
				keyframeChannel: {
					property: (
						{
							tl: "cornerRadiusTL",
							tr: "cornerRadiusTR",
							br: "cornerRadiusBR",
							bl: "cornerRadiusBL",
						} as const
					)[corner],
					valueSpace: "authored",
				},
				directManipulation: [
					directManipulation(
						"canvas",
						"drag-corner-radius",
						"write-keyframe-when-recording",
					),
					directManipulation("inspector", "scrub-field", "detach-expression"),
				],
				support: CORNER_RADIUS_SUPPORT,
			}),
		),
		sceneNumberProperty({
			id: "geometry.cornerSmoothing",
			label: "Corner smoothing",
			path: "geometry.cornerSmoothing",
			defaultValue: 0,
			min: 0,
			max: 1,
			step: 0.01,
			eligibility: cornerEligibility,
			keyframeChannel: { property: "cornerSmoothing", valueSpace: "authored" },
			directManipulation: [
				directManipulation("inspector", "scrub-field", "detach-expression"),
			],
			support: CORNER_SMOOTHING_SUPPORT,
		}),
	] as const satisfies readonly BindablePropertyDescriptor[])();

/**
 * Node-wide stroke-only blur softness, addressable by stable id so agents/code
 * can soften a stroke without touching its fill. It starts non-keyframable and
 * non-expression-bindable: stroke softness has no motion channel and no
 * native-expression presentation yet, so dynamic binding is deferred until those
 * surfaces exist (plan: expose the code-native id once the render contract is
 * real, keep it static-only first). Agent writes compile to the canonical
 * `scene/update-node-style` command, which clamps and clears the bucket at `0`.
 */
const strokeBlurProperty = /* @__PURE__ */ sceneNumberProperty({
	id: "style.strokeSoftness.blurRadius",
	label: "Stroke blur",
	path: "style.strokeSoftness.blurRadius",
	defaultValue: 0,
	min: 0,
	step: 0.5,
	unit: "px",
	keyframable: false,
	expressionBindable: false,
	support: STROKE_BLUR_SUPPORT,
});

const supportFromEffectCapability = (
	support: EffectRuntimeSupportMatrix,
): BindablePropertySupportMatrix => ({
	editorCanvas: support.editorCanvas,
	svgExport: support.svgExport,
	pdfExport: "unsupported",
	motionRuntimeJs: support.motionRuntimeJs,
	reactWrapper: support.reactWrapper,
	webmCapture: support.webmCapture,
	bundleManifest: support.recipeJson,
});

const effectCapabilityProperty = (
	capability: EffectCapabilityDescriptor,
): BindablePropertyDescriptor => ({
	id: `effect.${capability.id}`,
	label: capability.label,
	source: { kind: "effect-capability", capabilityId: capability.id },
	targetScopes: capability.targetScopes,
	eligibility: {
		kind: "effect-capability",
		capabilityId: capability.id,
	},
	control: {
		valueKind: capability.control.valueKind,
		defaultValue: capability.control.defaultValue,
		min: capability.control.min,
		max: capability.control.max,
		step: capability.control.step,
		unit: capability.control.unit,
		options: capability.control.options,
		keyframable: capability.control.keyframable,
		expressionBindable: capability.control.expressionBindable,
		agentWritable: true,
	},
	directManipulation:
		capability.control.valueKind === "number"
			? [directManipulation("inspector", "scrub-field", "detach-expression")]
			: undefined,
	support: supportFromEffectCapability(capability.support),
});

const duplicateGeneratorProperty = (descriptor: {
	readonly channel: "count" | "x" | "y" | "rotation";
	readonly label: string;
	readonly defaultValue: number;
	readonly unit?: string;
}): BindablePropertyDescriptor => ({
	id: `duplicate.${descriptor.channel}`,
	label: descriptor.label,
	source: { kind: "duplicate-generator", channel: descriptor.channel },
	targetScopes: ["duplicate-generator"],
	eligibility: { kind: "duplicate-generator" },
	control: numberControl({
		defaultValue: descriptor.defaultValue,
		unit: descriptor.unit,
		keyframable: false,
		expressionBindable: true,
		agentWritable: true,
	}),
	directManipulation: [
		directManipulation("inspector", "edit-code-field", "detach-expression"),
	],
	support: DUPLICATE_GENERATOR_SUPPORT,
});

/**
 * One scene-camera rig channel (P5, `docs/3d-camera-motion-standards-plan.md`
 * §3.7): the id embeds the exact {@link CameraRigAnimatableProperty} name (e.g.
 * `camera.bodyX`) so an agent can round-trip straight from a `list_bindable_
 * properties` row into `motion/upsert-camera-keyframe`'s `property` argument.
 * Camera channels are NOT written through `scene/set-bindable-property` or
 * `motion/set-bindable-keyframe` — those stay the generic node-property paths —
 * so `keyframeChannel` is intentionally left unset (`BindableKeyframeChannel`'s
 * `property` union is closed over node-scoped names and cannot express a
 * camera channel). `expressionBindable` is false: no expression-binding
 * surface reads `cameraTracks` today. Numeric bounds/steps/defaults mirror the
 * Inspector's scene-camera NumericFields
 * (`widgets/inspector/ui/InspectorPanel.tsx`) exactly, not invented values.
 */
const sceneCameraNumberProperty = (descriptor: {
	readonly property: CameraRigAnimatableProperty;
	readonly label: string;
	readonly defaultValue: number;
	readonly min?: number;
	readonly step?: number;
	readonly unit?: string;
}): BindablePropertyDescriptor => ({
	id: `camera.${descriptor.property}`,
	label: descriptor.label,
	source: { kind: "scene-camera", property: descriptor.property },
	targetScopes: ["scene-camera"],
	eligibility: { kind: "scene-camera" },
	control: numberControl({
		defaultValue: descriptor.defaultValue,
		min: descriptor.min,
		step: descriptor.step,
		unit: descriptor.unit,
		keyframable: true,
		expressionBindable: false,
		agentWritable: true,
	}),
	support: NATIVE_SCALAR_SUPPORT,
});

/**
 * Discoverable scene-camera rig channels. Deliberately 11 of the 13
 * {@link CameraRigAnimatableProperty} values, not all 13: `bodyRotationX`
 * (pitch/tilt) and `bodyRotationY` (yaw/pan) are excluded on purpose. Both
 * channels exist in the FROZEN motion contract and `motion/upsert-camera-
 * keyframe` will write them if asked directly; the current resolver samples
 * them as a camera-basis rotation. That is not a general perspective-correct
 * tilted-card or plane-3D fidelity contract, and no camera verb authors them
 * (see `entities/camera-motion/model/camera-verbs.ts`). Discovery lists only
 * established first-class vocabulary: an agent reasonably treats "listed here"
 * as "safe to author", so pitch/yaw remain undiscoverable until their intended
 * quality-grade and fidelity contract exists. `bodyRotationZ` (roll) is a pure
 * in-plane 2D rotation and stays admitted.
 */
/** Same `@__PURE__`-IIFE shape as {@link scalarSceneProperties} above, same reason. */
const sceneCameraProperties = /* @__PURE__ */ (() =>
	[
		sceneCameraNumberProperty({
			property: "bodyX",
			label: "Camera body X",
			defaultValue: 0,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "bodyY",
			label: "Camera body Y",
			defaultValue: 0,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "bodyZ",
			label: "Camera body Z",
			defaultValue: 0,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "bodyRotationZ",
			label: "Camera roll (Z)",
			defaultValue: 0,
			step: 1,
			unit: "deg",
		}),
		sceneCameraNumberProperty({
			property: "targetX",
			label: "Camera target X",
			defaultValue: 0,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "targetY",
			label: "Camera target Y",
			defaultValue: 0,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "targetZ",
			label: "Camera target Z",
			defaultValue: 0,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "fovDegrees",
			label: "Camera FOV",
			defaultValue: 50,
			min: 1,
			step: 1,
			unit: "deg",
		}),
		sceneCameraNumberProperty({
			property: "zoom",
			label: "Camera zoom",
			defaultValue: 1,
			min: 0.01,
			step: 0.05,
		}),
		sceneCameraNumberProperty({
			property: "focusDistance",
			label: "Camera focus distance",
			defaultValue: 1000,
			min: 0.001,
			step: 10,
			unit: "px",
		}),
		sceneCameraNumberProperty({
			property: "aperture",
			label: "Camera aperture",
			defaultValue: 0,
			min: 0,
			step: 0.1,
		}),
	] as const satisfies readonly BindablePropertyDescriptor[])();

/**
 * Registry of currently reachable or explicitly planned code-bindable authoring
 * properties. It intentionally starts with real cross-surface cases so future UI
 * and agent work can migrate incrementally instead of inventing one-off contracts.
 *
 * Same `@__PURE__`-IIFE shape as {@link scalarSceneProperties} above, same
 * reason — this array directly contains further non-pure-annotated calls
 * (`duplicateGeneratorProperty(...)`, the `EFFECT_CAPABILITY_DESCRIPTORS.map`
 * call) on top of the spreads, so it independently needs the same wrap even
 * though its spread sources are now individually prunable too.
 */
export const BINDABLE_PROPERTY_DESCRIPTORS: readonly BindablePropertyDescriptor[] =
	/* @__PURE__ */ (() => [
		...scalarSceneProperties,
		...cornerProperties,
		strokeBlurProperty,
		...EFFECT_CAPABILITY_DESCRIPTORS.map(effectCapabilityProperty),
		...sceneCameraProperties,
		duplicateGeneratorProperty({
			channel: "count",
			label: "Duplicate count",
			defaultValue: 1,
		}),
		duplicateGeneratorProperty({
			channel: "x",
			label: "Duplicate X",
			defaultValue: 0,
			unit: "px",
		}),
		duplicateGeneratorProperty({
			channel: "y",
			label: "Duplicate Y",
			defaultValue: 0,
			unit: "px",
		}),
		duplicateGeneratorProperty({
			channel: "rotation",
			label: "Duplicate rotation",
			defaultValue: 0,
			unit: "deg",
		}),
	])();

/**
 * `@__PURE__`-IIFE-wrapped, same shape as {@link scalarSceneProperties} above
 * and for a subtle reason worth recording: annotating the `new Map` call
 * alone is NOT enough here, because its argument
 * (`BINDABLE_PROPERTY_DESCRIPTORS.map(...)`) is its own unannotated call —
 * esbuild must still assume evaluating that argument could have side effects
 * even when the outer `new Map` call is marked pure, since arguments are
 * evaluated whether or not the call's result is used. Wrapping the whole
 * `new Map(...)` construction (map call included) inside a zero-argument
 * arrow function called immediately makes the entire body one atomic,
 * pure-marked unit: skipping the call skips everything inside it, including
 * unannotated nested calls, so esbuild can drop it all together when
 * `BINDABLE_PROPERTY_BY_ID` itself is unused.
 */
const BINDABLE_PROPERTY_BY_ID: ReadonlyMap<string, BindablePropertyDescriptor> =
	/* @__PURE__ */ (() =>
		new Map(
			BINDABLE_PROPERTY_DESCRIPTORS.map((descriptor) => [
				descriptor.id,
				descriptor,
			]),
		))();

/** Looks up one bindable property descriptor by stable id. */
export function bindablePropertyById(
	id: string,
): BindablePropertyDescriptor | null {
	return BINDABLE_PROPERTY_BY_ID.get(id) ?? null;
}

/** Looks up the bindable property that wraps one scene effect capability. */
export function bindableEffectPropertyForCapabilityId(
	capabilityId: string,
): BindablePropertyDescriptor | null {
	const descriptor = bindablePropertyById(`effect.${capabilityId}`);
	if (descriptor?.source.kind !== "effect-capability") return null;
	return descriptor;
}

/** Returns bindable properties available for one target scope. */
export function bindablePropertiesForTargetScope(
	scope: BindablePropertyTargetScope,
): readonly BindablePropertyDescriptor[] {
	return BINDABLE_PROPERTY_DESCRIPTORS.filter((descriptor) =>
		descriptor.targetScopes.some((targetScope) => targetScope === scope),
	);
}

/** Returns properties that can target a given node geometry kind. */
export function bindablePropertiesForGeometryKind(
	geometryKind: NodeGeometry["kind"],
): readonly BindablePropertyDescriptor[] {
	return BINDABLE_PROPERTY_DESCRIPTORS.filter((descriptor) => {
		if (descriptor.eligibility.kind === "any-node") return true;
		if (descriptor.eligibility.kind === "effect-capability") {
			return descriptor.targetScopes.some(
				(targetScope) => targetScope === "node",
			);
		}
		if (descriptor.eligibility.kind !== "geometry") return false;
		return descriptor.eligibility.geometryKinds.some(
			(kind) => kind === geometryKind,
		);
	});
}

/**
 * Validates descriptor uniqueness and cross-registry references. Build/check
 * streams can use this before wiring new UI or agent command arms to the registry.
 */
export function validateBindablePropertyDescriptors(
	descriptors: readonly BindablePropertyDescriptor[] = BINDABLE_PROPERTY_DESCRIPTORS,
): readonly BindablePropertyValidationIssue[] {
	const issues: BindablePropertyValidationIssue[] = [];
	const ids = new Set<string>();
	for (const descriptor of descriptors) {
		if (ids.has(descriptor.id)) {
			issues.push({ kind: "duplicate-id", id: descriptor.id });
		}
		ids.add(descriptor.id);
		if (descriptor.targetScopes.length === 0) {
			issues.push({ kind: "empty-target-scopes", id: descriptor.id });
		}
		// Hoist to a const local so the `effect-capability` narrowing survives into
		// the `.some()` callback (TS does not narrow re-read property accesses in
		// closures, only const locals).
		const source = descriptor.source;
		if (
			source.kind === "effect-capability" &&
			!EFFECT_CAPABILITY_DESCRIPTORS.some(
				(capability) => capability.id === source.capabilityId,
			)
		) {
			issues.push({
				kind: "invalid-effect-capability",
				id: descriptor.id,
			});
		}
	}
	return issues;
}
