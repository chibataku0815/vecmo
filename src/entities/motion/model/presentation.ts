import { resolveCornerRadii } from "@/entities/scene/model/corner-geometry";
import type { EffectExpressionBinding } from "@/entities/scene/model/effect-expression-binding";
import type { GradientPaint } from "@/entities/scene/model/gradient-edit";
import {
	type LayoutMotionPositionOffset,
	type LayoutMotionPresentation,
	materializeLayoutFramesForMotionPresentation,
} from "@/entities/scene/model/layout-frame-presentation";
import {
	applyMotionRelationsToScene,
	type MotionRelationIssue,
	restoreMotionParentBindings,
} from "@/entities/scene/model/motion-relations";
import {
	evaluateNativeExpression,
	type NativeExpressionBinding,
	type NativeExpressionFrameContext,
} from "@/entities/scene/model/native-expression-binding";
import type { ProductionControlSampler } from "@/entities/scene/model/production-control";
import {
	type EffectIntentRecipeSource,
	type ResolvedFrameEffectIntent,
	resolveFrameEffectIntent,
	resolveNodeRecipe,
} from "@/entities/scene/model/recipe-resolve";
import type {
	RuntimeCameraState,
	SceneCameraPresentation,
	SceneCameraRuntimeControl,
} from "@/entities/scene/model/scene-camera";
import {
	allNodes,
	findArtboardById,
	findNode,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import { resolveOutlineGroupFragments } from "@/entities/scene/model/text-fragments";
import type {
	BezierShape,
	CornerRadii,
	MeshGradientPaint,
	NodeGeometry,
	NodeStyle,
	SceneDocument,
	SceneLayer,
	Transform,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import {
	type AutomationRecipe,
	type AutomationTrack,
	type AutomationTrackMode,
	type EffectInfluenceRecipe,
	type EffectSlotRef,
	type EffectTargetRef,
	NEUTRAL_EFFECT_INFLUENCE_RECIPE,
	NEUTRAL_VISUAL_RECIPE,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	type AutomationBridgeFrame,
	type AutomationBridgeIssue,
	type AutomationSampledWrite,
	automationPathIssueMessage,
	composeAutomationNumericPathPatch,
	type RecipeAutomationPatch,
	sampleAutomationBridgeFrame,
	sampleAutomationWrites,
} from "./automation-bridge";
import type {
	GrammarDuplicateSample,
	GrammarFrameSample,
	GrammarFrameSampler,
	GrammarNodeSample,
} from "./grammar-bridge";
import {
	haveCompatiblePathShapeTopology,
	isValidGradientValue,
	isValidMeshValue,
	isValidPathShape,
} from "./keyframe-validation";
import { resolvePositionPath } from "./position-path";
import { sampleFrameBlendScene } from "./presentation-stage-blend";
import { sampleFrameCameraPresentation } from "./presentation-stage-camera";
import {
	expressionBindingsForArtboardTarget,
	expressionBindingsForResolvedFrameIntent,
	expressionBindingsForSceneTarget,
	type FrameEffectExpressionSlotSample,
	frameExpressionBindings,
	frameExpressionTime,
	sampleFrameEffectExpressionScene,
	sampleFrameEffectExpressionSlots,
} from "./presentation-stage-effect-expression";
import { sampleFrameLookGraphScene } from "./presentation-stage-look-graph";
import { sampleFrameSourceOpticsScene } from "./presentation-stage-source-optics";
import {
	animatedNodeIds,
	effectiveCornerRadii,
	effectiveCornerRadius,
	effectiveCornerSmoothing,
	effectiveFillGradient,
	effectiveMesh,
	effectiveOpacity,
	effectiveShape,
	effectiveTransform,
	findTrack,
} from "./sampler";
import { evaluateTextAnimator, type TextFragmentPose } from "./text-animator";
import {
	ANIMATABLE_PROPERTIES,
	type AnimatableProperty,
	type AnimatableValue,
	type KeyframeTrack,
	type MotionDocument,
} from "./types";

export const MOTION_PRESENTATION_ISSUE_CODES = [
	"motion-target-missing",
	"motion-property-unsupported",
	"scalar-keyframe-invalid",
	"path-shape-target-not-path",
	"path-shape-keyframe-invalid",
	"path-shape-topology-mismatch",
	"mesh-target-not-mesh",
	"mesh-keyframe-invalid",
	"gradient-target-not-gradient",
	"gradient-keyframe-invalid",
	"position-path-target-missing",
	"position-path-key-invalid",
	"position-path-key-unpaired",
	"position-path-timing-mismatch",
	"position-path-duplicate-frame",
] as const;

export type MotionPresentationIssueCode =
	(typeof MOTION_PRESENTATION_ISSUE_CODES)[number];

export type MotionPresentationIssueSeverity = "warning" | "error";

export type MotionPresentationIssue = {
	readonly code: MotionPresentationIssueCode;
	readonly severity: MotionPresentationIssueSeverity;
	readonly trackId: string;
	readonly nodeId: string;
	readonly property: string;
	readonly keyframeIndex?: number;
	readonly frame?: number;
	readonly message: string;
};

export type MotionPresentationNodeValues = {
	readonly nodeId: string;
	readonly frame: number;
	readonly animatedProperties: readonly AnimatableProperty[];
	readonly transform: Transform;
	readonly opacity: number;
	readonly pathShape?: BezierShape;
	readonly appearance?: MotionPresentationNodeAppearance;
};

export type MotionPresentationEffectAutomation = Pick<
	AutomationBridgeFrame,
	"frame" | "writes" | "recipePatches" | "influencePatches" | "issues"
>;

export type AppearanceAutomationPatch = {
	readonly channel: "effectParam";
	readonly target: EffectTargetRef;
	readonly effect: EffectSlotRef;
	readonly path: string;
	readonly fullPath: string;
	readonly mode: AutomationTrackMode;
	readonly baseValue: number;
	readonly sampledValue: number;
	readonly value: number;
	readonly trackIndex: number;
};

export type MotionPresentationNodeAppearanceAutomation = {
	readonly frame: number;
	readonly writes: readonly AutomationSampledWrite[];
	readonly recipePatches: readonly RecipeAutomationPatch[];
	readonly stylePatches: readonly AppearanceAutomationPatch[];
	readonly issues: readonly AutomationBridgeIssue[];
};

/**
 * Node-local appearance data sampled from vec-core automation. It is intentionally
 * a presentation side-car: `style` may feed render/export adapters for the frame,
 * while `recipe` carries node look automation for metadata or a future vec-core
 * raster bridge. Neither value is written back to SceneDocument.
 */
export type MotionPresentationNodeAppearance = {
	readonly baseStyle: NodeStyle;
	readonly style: NodeStyle;
	readonly styleAutomated: boolean;
	readonly baseRecipe: VisualRecipe | null;
	readonly recipe: VisualRecipe | null;
	readonly recipeAutomated: boolean;
	readonly automation: MotionPresentationNodeAppearanceAutomation;
};

/**
 * Frame-level effect data for preview/export consumers. `base*` fields are the
 * scene/artboard intent resolved from the source document; `visualRecipe` and
 * `influenceRecipe` are the derived read-only refs after optional vec-core
 * automation writes and frame expression bindings are composed over that base.
 * Null means no authored intent exists for that slot at this frame.
 */
export type MotionPresentationEffectIntent = {
	readonly artboardId: string;
	readonly baseVisualRecipe: VisualRecipe | null;
	readonly baseVisualRecipeSource: EffectIntentRecipeSource | null;
	readonly visualRecipe: VisualRecipe | null;
	readonly visualRecipeAutomated: boolean;
	readonly visualRecipeExpressionApplied: boolean;
	readonly baseInfluenceRecipe: EffectInfluenceRecipe | null;
	readonly baseInfluenceRecipeSource: EffectIntentRecipeSource | null;
	readonly influenceRecipe: EffectInfluenceRecipe | null;
	readonly influenceRecipeAutomated: boolean;
	readonly influenceRecipeExpressionApplied: boolean;
	readonly automation: MotionPresentationEffectAutomation | null;
};

export type MotionPresentationFrame = {
	readonly sceneSchemaVersion: SceneDocument["schemaVersion"];
	readonly motionSchemaVersion: MotionDocument["schemaVersion"];
	readonly frame: number;
	readonly scene: SceneDocument;
	readonly camera: RuntimeCameraState;
	readonly values: readonly MotionPresentationNodeValues[];
	readonly effectIntent: MotionPresentationEffectIntent;
	readonly issues: readonly MotionPresentationIssue[];
	readonly relationIssues: readonly MotionRelationIssue[];
};

export type MotionPresentationFramePlan = {
	readonly fps: number;
	readonly durationFrames: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly stepFrames: number;
	readonly frames: readonly number[];
};

export type MotionPresentationSequence = MotionPresentationFramePlan & {
	readonly samples: readonly MotionPresentationFrame[];
};

export type MotionPresentationInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly automation?: AutomationRecipe | null;
	readonly artboardId?: string | null;
	readonly fps?: number;
	readonly cameraRuntimeControl?: SceneCameraRuntimeControl;
	/**
	 * Injected per-frame motion-grammar sampler. The closure is built by a higher
	 * layer (canvas-shell / export) from the grammar store's parsed bindings + the
	 * motion-grammar evaluator; presentation never imports the evaluator. Absent →
	 * no grammar composition.
	 */
	readonly grammar?: GrammarFrameSampler;
	/**
	 * Injected published-control sampler for expression `control("id")` lookups.
	 * It arrives the way `grammar` does — built by the layer that owns the
	 * documents (`createProductionControlSampler`) — so presentation never imports
	 * the linked-production contract and no export profile pays for a parser it
	 * does not use. Absent → every control reference is unresolved and the
	 * dependent binding keeps its base value instead of collapsing to zero.
	 */
	readonly controls?: ProductionControlSampler;
};

type MotionPresentationSequenceInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly automation?: AutomationRecipe | null;
	readonly artboardId?: string | null;
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly stepFrames?: number;
	readonly grammar?: GrammarFrameSampler;
};

type SampledNode = {
	readonly node: VectorNode;
	readonly changed: boolean;
};

type NodePresentationTargetInfo = {
	readonly layerId: string;
	readonly ancestorIds: readonly string[];
};

type MotionPresentationSamplingContext = {
	readonly appearances: ReadonlyMap<string, MotionPresentationNodeAppearance>;
	readonly grammar: ReadonlyMap<string, GrammarNodeSample>;
	readonly grammarDuplicates: readonly GrammarDuplicateSample[];
	readonly nativeExpressions: ReadonlyMap<
		string,
		readonly NativeExpressionBinding[]
	>;
	readonly nativeExpressionFrame: NativeExpressionFrameContext;
	readonly layoutPositionOffsets: ReadonlyMap<
		string,
		LayoutMotionPositionOffset
	>;
	/**
	 * Per-node poses from `outline-group` text animators at this frame, keyed by the
	 * member node id. Only non-identity poses are present, so a node's membership in
	 * the map both admits it to sampling and supplies its transform/opacity override.
	 */
	readonly textFragmentPoses: ReadonlyMap<string, TextFragmentPose>;
};

const EMPTY_FRAGMENT_POSE_MAP: ReadonlyMap<string, TextFragmentPose> =
	new Map();

const isIdentityFragmentPose = (pose: TextFragmentPose): boolean =>
	pose.translate.x === 0 &&
	pose.translate.y === 0 &&
	pose.rotation === 0 &&
	pose.scaleX === 1 &&
	pose.scaleY === 1 &&
	pose.opacity === 1;

/**
 * Builds the per-frame map of scene-node fragment poses from every enabled
 * `outline-group` text animator. The group's children are resolved to ordered
 * fragments, the selector is evaluated, and each non-identity pose is keyed by its
 * real member node id. This is computed once per frame and threaded through the
 * sampling context so `sampleNode` can compose each member's override cheaply.
 */
const buildOutlineFragmentPoses = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	expressionFrame: NativeExpressionFrameContext,
): ReadonlyMap<string, TextFragmentPose> => {
	const bindings = motion.textAnimators?.filter(
		(binding) => binding.enabled && binding.target.kind === "outline-group",
	);
	if (!bindings || bindings.length === 0) return EMPTY_FRAGMENT_POSE_MAP;
	const poses = new Map<string, TextFragmentPose>();
	for (const binding of bindings) {
		const group = findNode(scene, binding.target.nodeId);
		if (!group) continue;
		const target = resolveOutlineGroupFragments(group);
		if (target.fragments.length === 0) continue;
		const evaluation = evaluateTextAnimator(
			target,
			binding,
			frame,
			expressionFrame,
		);
		for (const pose of evaluation.poses) {
			if (pose.source.kind !== "scene-node") continue;
			if (isIdentityFragmentPose(pose)) continue;
			poses.set(pose.source.nodeId, pose);
		}
	}
	return poses;
};

/**
 * Composes a fragment pose onto a node's sampled transform/opacity. Translation and
 * rotation are additive deltas; scale multiplies; the anchor is set to the fragment
 * center so rotation/scale orbit the glyph. Exact for the common case of an exploded
 * fragment whose rest transform is identity (its anchor is then irrelevant at rest).
 */
const applyFragmentPose = (
	transform: Transform,
	opacity: number,
	pose: TextFragmentPose,
): { readonly transform: Transform; readonly opacity: number } => ({
	transform: {
		position: {
			x: transform.position.x + pose.translate.x,
			y: transform.position.y + pose.translate.y,
		},
		rotation: transform.rotation + pose.rotation,
		scale: {
			x: transform.scale.x * pose.scaleX,
			y: transform.scale.y * pose.scaleY,
		},
		anchor: { x: pose.pivot.x, y: pose.pivot.y },
	},
	opacity: opacity * pose.opacity,
});

const EMPTY_GRAMMAR_SAMPLE_MAP: ReadonlyMap<string, GrammarNodeSample> =
	new Map();
const EMPTY_GRAMMAR_FRAME_SAMPLE: GrammarFrameSample = {
	samples: EMPTY_GRAMMAR_SAMPLE_MAP,
	duplicates: [],
};

const resolveMotionAutomation = (
	motion: MotionDocument,
	automation: AutomationRecipe | null | undefined,
): AutomationRecipe | null =>
	automation === undefined ? (motion.automation ?? null) : automation;

const isGrammarFrameSample = (
	value: ReadonlyMap<string, GrammarNodeSample> | GrammarFrameSample,
): value is GrammarFrameSample => "samples" in value;

/** Resolves per-frame grammar samples from the injected sampler (if any). */
const resolveGrammarFrame = (
	grammar: GrammarFrameSampler | undefined,
	frame: number,
): GrammarFrameSample => {
	if (!grammar) return EMPTY_GRAMMAR_FRAME_SAMPLE;
	const sample = grammar(frame);
	return isGrammarFrameSample(sample)
		? sample
		: { samples: sample, duplicates: [] };
};

/**
 * Layers a grammar sample over the keyframe-sampled transform. Additive
 * `translate`/`rotate`, multiplicative `scaleFactor`, then `rotationOverride`
 * (auto-orient) supersedes the composed rotation entirely. The anchor is carried
 * through so pivoting stays stable.
 */
const composeGrammarTransform = (
	transform: Transform,
	sample: GrammarNodeSample | undefined,
): Transform => {
	if (!sample) return transform;
	const { translate, rotate, scaleFactor, rotationOverride } = sample;
	if (
		!translate &&
		rotate === undefined &&
		!scaleFactor &&
		rotationOverride === undefined
	) {
		return transform;
	}
	return {
		position: {
			x: transform.position.x + (translate?.x ?? 0),
			y: transform.position.y + (translate?.y ?? 0),
		},
		rotation: rotationOverride ?? transform.rotation + (rotate ?? 0),
		scale: {
			x: transform.scale.x * (scaleFactor?.x ?? 1),
			y: transform.scale.y * (scaleFactor?.y ?? 1),
		},
		anchor: { ...transform.anchor },
	};
};

/**
 * Composes grammar opacity over the already-composed opacity. Generated profile
 * systems can use `opacityOverride` for exact lifecycle states such as invisible
 * satellites; additive grammar keeps using `opacityFactor`.
 */
const composeGrammarOpacity = (
	opacity: number,
	sample: GrammarNodeSample | undefined,
): number =>
	sample?.opacityOverride !== undefined
		? sample.opacityOverride
		: sample?.opacityFactor !== undefined
			? opacity * sample.opacityFactor
			: opacity;

/**
 * Composes the grammar dash-phase channel over the node's static dash offset.
 * The channel is additive over the base style, never under it (see
 * {@link GrammarNodeSample}); `undefined` means the sample leaves the base
 * offset untouched so the caller can skip the style spread entirely.
 */
const composeGrammarStrokeDashoffset = (
	strokeDashoffset: number | undefined,
	sample: GrammarNodeSample | undefined,
): number | undefined =>
	sample?.strokeDashoffset !== undefined
		? (strokeDashoffset ?? 0) + sample.strokeDashoffset
		: undefined;

const hasPositionTrack = (
	motion: MotionDocument,
	nodeId: string,
	property: "x" | "y",
): boolean => {
	const track = findTrack(motion, nodeId, property);
	return !!track && track.keyframes.length > 0;
};

const composeLayoutPositionTrackOffset = (
	transform: Transform,
	motion: MotionDocument,
	nodeId: string,
	offsets: ReadonlyMap<string, LayoutMotionPositionOffset>,
): Transform => {
	const offset = offsets.get(nodeId);
	if (!offset) return transform;
	const hasX = hasPositionTrack(motion, nodeId, "x");
	const hasY = hasPositionTrack(motion, nodeId, "y");
	if (!hasX && !hasY) return transform;
	return {
		...transform,
		position: {
			x: transform.position.x + (hasX ? offset.x : 0),
			y: transform.position.y + (hasY ? offset.y : 0),
		},
	};
};

/**
 * Builds the per-frame expression context once per sampled frame. The injected
 * control sampler is frame-parameterized, so binding the frame here is the ONE
 * place presentation has to know about published controls — every evaluation
 * site downstream just reads the context it already received.
 */
const nativeExpressionFrameContext = (
	controls: ProductionControlSampler | undefined,
	frame: number,
	fps: number,
): NativeExpressionFrameContext => ({
	time: frameExpressionTime(frame, fps),
	frame,
	...(controls
		? { controls: (controlId: string) => controls(controlId, frame) }
		: {}),
});

const groupNativeExpressionBindings = (
	bindings: readonly NativeExpressionBinding[],
): ReadonlyMap<string, readonly NativeExpressionBinding[]> => {
	const grouped = new Map<string, NativeExpressionBinding[]>();
	for (const binding of bindings) {
		const list = grouped.get(binding.nodeId) ?? [];
		list.push(binding);
		grouped.set(binding.nodeId, list);
	}
	return grouped;
};

const applyNativeExpressionBindings = ({
	bindings,
	transform,
	opacity,
	frame,
}: {
	readonly bindings: readonly NativeExpressionBinding[];
	readonly transform: Transform;
	readonly opacity: number;
	readonly frame: NativeExpressionFrameContext;
}): {
	readonly transform: Transform;
	readonly opacity: number;
	readonly changed: boolean;
	readonly opacityChanged: boolean;
} => {
	let nextTransform = transform;
	let nextOpacity = opacity;
	let changed = false;
	let opacityChanged = false;
	for (const binding of bindings) {
		switch (binding.propertyId) {
			case "transform.x": {
				const value = evaluateNativeExpression(
					binding,
					nextTransform.position.x,
					frame,
				);
				if (value === null || Object.is(value, nextTransform.position.x)) {
					break;
				}
				nextTransform = {
					...nextTransform,
					position: { ...nextTransform.position, x: value },
				};
				changed = true;
				break;
			}
			case "transform.y": {
				const value = evaluateNativeExpression(
					binding,
					nextTransform.position.y,
					frame,
				);
				if (value === null || Object.is(value, nextTransform.position.y)) {
					break;
				}
				nextTransform = {
					...nextTransform,
					position: { ...nextTransform.position, y: value },
				};
				changed = true;
				break;
			}
			case "transform.anchorX": {
				const value = evaluateNativeExpression(
					binding,
					nextTransform.anchor.x,
					frame,
				);
				if (value === null || Object.is(value, nextTransform.anchor.x)) {
					break;
				}
				nextTransform = {
					...nextTransform,
					anchor: { ...nextTransform.anchor, x: value },
				};
				changed = true;
				break;
			}
			case "transform.anchorY": {
				const value = evaluateNativeExpression(
					binding,
					nextTransform.anchor.y,
					frame,
				);
				if (value === null || Object.is(value, nextTransform.anchor.y)) {
					break;
				}
				nextTransform = {
					...nextTransform,
					anchor: { ...nextTransform.anchor, y: value },
				};
				changed = true;
				break;
			}
			case "transform.rotation": {
				const value = evaluateNativeExpression(
					binding,
					nextTransform.rotation,
					frame,
				);
				if (value === null || Object.is(value, nextTransform.rotation)) {
					break;
				}
				nextTransform = { ...nextTransform, rotation: value };
				changed = true;
				break;
			}
			case "style.opacity": {
				const value = evaluateNativeExpression(binding, nextOpacity, frame);
				if (value === null || Object.is(value, nextOpacity)) break;
				nextOpacity = value;
				changed = true;
				opacityChanged = true;
				break;
			}
			case "geometry.cornerRadius":
			case "geometry.cornerRadii.tl":
			case "geometry.cornerRadii.tr":
			case "geometry.cornerRadii.br":
			case "geometry.cornerRadii.bl":
			case "geometry.cornerSmoothing":
				break;
		}
	}
	return {
		transform: nextTransform,
		opacity: nextOpacity,
		changed,
		opacityChanged,
	};
};

const rectUniformCornerRadiusValue = (
	geometry: Extract<NodeGeometry, { readonly kind: "rect" }>,
): number => {
	const radii = resolveCornerRadii(geometry);
	if (radii.tl === radii.tr && radii.tr === radii.br && radii.br === radii.bl) {
		return radii.tl;
	}
	return (radii.tl + radii.tr + radii.br + radii.bl) / 4;
};

const rectWithCornerRadii = (
	geometry: Extract<NodeGeometry, { readonly kind: "rect" }>,
	radii: CornerRadii,
): NodeGeometry => {
	const uniform =
		radii.tl === radii.tr && radii.tr === radii.br && radii.br === radii.bl;
	return uniform
		? { ...geometry, cornerRadius: radii.tl, cornerRadii: undefined }
		: { ...geometry, cornerRadii: radii };
};

const applyNativeExpressionGeometryBindings = ({
	bindings,
	geometry,
	frame,
}: {
	readonly bindings: readonly NativeExpressionBinding[];
	readonly geometry: NodeGeometry;
	readonly frame: NativeExpressionFrameContext;
}): { readonly geometry: NodeGeometry; readonly changed: boolean } => {
	let nextGeometry = geometry;
	let changed = false;
	for (const binding of bindings) {
		switch (binding.propertyId) {
			case "geometry.cornerRadius": {
				if (
					nextGeometry.kind !== "rect" &&
					nextGeometry.kind !== "star" &&
					nextGeometry.kind !== "polygon"
				) {
					break;
				}
				const current =
					nextGeometry.kind === "rect"
						? rectUniformCornerRadiusValue(nextGeometry)
						: (nextGeometry.cornerRadius ?? 0);
				const value = evaluateNativeExpression(binding, current, frame);
				if (value === null || Object.is(value, current)) break;
				nextGeometry =
					nextGeometry.kind === "rect"
						? rectWithCornerRadii(nextGeometry, {
								tl: value,
								tr: value,
								br: value,
								bl: value,
							})
						: { ...nextGeometry, cornerRadius: value };
				changed = true;
				break;
			}
			case "geometry.cornerRadii.tl":
			case "geometry.cornerRadii.tr":
			case "geometry.cornerRadii.br":
			case "geometry.cornerRadii.bl": {
				if (nextGeometry.kind !== "rect") break;
				const corner = binding.propertyId.slice(
					"geometry.cornerRadii.".length,
				) as keyof CornerRadii;
				const current = resolveCornerRadii(nextGeometry);
				const value = evaluateNativeExpression(binding, current[corner], frame);
				if (value === null || Object.is(value, current[corner])) break;
				nextGeometry = rectWithCornerRadii(nextGeometry, {
					...current,
					[corner]: value,
				});
				changed = true;
				break;
			}
			case "geometry.cornerSmoothing": {
				if (
					nextGeometry.kind !== "rect" &&
					nextGeometry.kind !== "star" &&
					nextGeometry.kind !== "polygon"
				) {
					break;
				}
				const current = nextGeometry.cornerSmoothing ?? 0;
				const value = evaluateNativeExpression(binding, current, frame);
				if (value === null || Object.is(value, current)) break;
				nextGeometry = { ...nextGeometry, cornerSmoothing: value };
				changed = true;
				break;
			}
			case "transform.x":
			case "transform.y":
			case "transform.anchorX":
			case "transform.anchorY":
			case "transform.rotation":
			case "style.opacity":
				break;
		}
	}
	return { geometry: nextGeometry, changed };
};

const duplicateNodeIdForChild = (
	parentDuplicateId: string,
	childId: string,
): string => `${parentDuplicateId}::child:${childId}`;

const sampleDuplicateNode = (
	node: VectorNode,
	motion: MotionDocument,
	duplicate: GrammarDuplicateSample,
	context: MotionPresentationSamplingContext,
	duplicateNodeId: string,
	applyDuplicatePose = true,
): VectorNode => {
	const duplicateGrammarSample: GrammarNodeSample = {
		nodeId: duplicateNodeId,
		...(applyDuplicatePose && duplicate.translate
			? { translate: duplicate.translate }
			: {}),
		...(applyDuplicatePose && duplicate.rotate !== undefined
			? { rotate: duplicate.rotate }
			: {}),
		...(applyDuplicatePose && duplicate.scaleFactor
			? { scaleFactor: duplicate.scaleFactor }
			: {}),
		...(duplicate.opacityOverride !== undefined
			? { opacityOverride: duplicate.opacityOverride }
			: { opacityFactor: duplicate.opacityFactor }),
		...(duplicate.recipeOverride
			? { recipeOverride: duplicate.recipeOverride }
			: {}),
	};
	const style = sampledStyle(
		node,
		motion,
		duplicate.sourceFrame,
		context.appearances.get(node.id),
	);
	const nextOpacity = composeGrammarOpacity(
		style.opacity,
		duplicateGrammarSample,
	);
	return {
		...node,
		id: duplicateNodeId,
		name: `${node.name} afterimage`,
		geometry: sampledGeometry(node, motion, duplicate.sourceFrame),
		transform: composeGrammarTransform(
			effectiveTransform(node, motion, duplicate.sourceFrame),
			duplicateGrammarSample,
		),
		...(duplicate.recipeOverride ? { recipe: duplicate.recipeOverride } : {}),
		style: {
			...style,
			opacity: nextOpacity,
		},
		locked: true,
		children: node.children?.map((child) =>
			sampleDuplicateNode(
				child,
				motion,
				duplicate,
				context,
				duplicateNodeIdForChild(duplicateNodeId, child.id),
				false,
			),
		),
		data: {
			...node.data,
			motionGrammarDuplicate: {
				sourceNodeId: duplicate.sourceNodeId,
				sourceFrame: duplicate.sourceFrame,
			},
		},
	};
};

type SanitizedMotion = {
	readonly motion: MotionDocument;
	readonly issues: readonly MotionPresentationIssue[];
};

const propertyOrder = new Map<AnimatableProperty, number>(
	ANIMATABLE_PROPERTIES.map((property, index) => [property, index]),
);

const isAnimatableProperty = (value: unknown): value is AnimatableProperty =>
	typeof value === "string" && propertyOrder.has(value as AnimatableProperty);

const issueForTrack = ({
	code,
	severity,
	track,
	property,
	keyframeIndex,
	frame,
	message,
}: {
	readonly code: MotionPresentationIssueCode;
	readonly severity: MotionPresentationIssueSeverity;
	readonly track: KeyframeTrack;
	readonly property?: string;
	readonly keyframeIndex?: number;
	readonly frame?: number;
	readonly message: string;
}): MotionPresentationIssue => ({
	code,
	severity,
	trackId: track.id,
	nodeId: track.target.nodeId,
	property: property ?? String(track.target.property),
	keyframeIndex,
	frame,
	message,
});

const hasFiniteTime = (keyframe: AeKeyframe<unknown>): boolean =>
	Number.isFinite(keyframe.time);

const isValidScalarKeyframe = (
	keyframe: AeKeyframe<unknown>,
): keyframe is AeKeyframe<number> =>
	hasFiniteTime(keyframe) &&
	typeof keyframe.value === "number" &&
	Number.isFinite(keyframe.value);

const sanitizeScalarKeyframes = (
	track: KeyframeTrack,
	issues: MotionPresentationIssue[],
): readonly AeKeyframe<number>[] =>
	track.keyframes.filter((keyframe, index): keyframe is AeKeyframe<number> => {
		if (isValidScalarKeyframe(keyframe)) return true;
		issues.push(
			issueForTrack({
				code: "scalar-keyframe-invalid",
				severity: "error",
				track,
				keyframeIndex: index,
				frame: Number.isFinite(keyframe.time) ? keyframe.time : undefined,
				message:
					"Scalar motion keyframes must have finite frame time and numeric value.",
			}),
		);
		return false;
	});

const sanitizePathShapeKeyframes = (
	track: KeyframeTrack,
	issues: MotionPresentationIssue[],
): readonly AeKeyframe<BezierShape>[] => {
	const keyframes = track.keyframes.filter(
		(keyframe, index): keyframe is AeKeyframe<BezierShape> => {
			if (hasFiniteTime(keyframe) && isValidPathShape(keyframe.value)) {
				return true;
			}
			issues.push(
				issueForTrack({
					code: "path-shape-keyframe-invalid",
					severity: "error",
					track,
					keyframeIndex: index,
					frame: Number.isFinite(keyframe.time) ? keyframe.time : undefined,
					message:
						"Path-shape motion keyframes must have finite frame time and finite aligned shape points.",
				}),
			);
			return false;
		},
	);

	for (let index = 1; index < keyframes.length; index += 1) {
		const previous = keyframes[index - 1];
		const current = keyframes[index];
		if (haveCompatiblePathShapeTopology(previous.value, current.value)) {
			continue;
		}
		issues.push(
			issueForTrack({
				code: "path-shape-topology-mismatch",
				severity: "warning",
				track,
				keyframeIndex: index,
				frame: current.time,
				message:
					"Path-shape keyframes with mismatched topology sample with hold behavior instead of tweening.",
			}),
		);
	}

	return keyframes;
};

const sanitizeMeshKeyframes = (
	track: KeyframeTrack,
	issues: MotionPresentationIssue[],
): readonly AeKeyframe<MeshGradientPaint>[] =>
	track.keyframes.filter(
		(keyframe, index): keyframe is AeKeyframe<MeshGradientPaint> => {
			if (hasFiniteTime(keyframe) && isValidMeshValue(keyframe.value)) {
				return true;
			}
			issues.push(
				issueForTrack({
					code: "mesh-keyframe-invalid",
					severity: "error",
					track,
					keyframeIndex: index,
					frame: Number.isFinite(keyframe.time) ? keyframe.time : undefined,
					message:
						"Mesh motion keyframes must have finite frame time and a valid mesh snapshot (rows*cols points).",
				}),
			);
			return false;
		},
	);

const sanitizeGradientKeyframes = (
	track: KeyframeTrack,
	issues: MotionPresentationIssue[],
): readonly AeKeyframe<GradientPaint>[] =>
	track.keyframes.filter(
		(keyframe, index): keyframe is AeKeyframe<GradientPaint> => {
			if (hasFiniteTime(keyframe) && isValidGradientValue(keyframe.value)) {
				return true;
			}
			issues.push(
				issueForTrack({
					code: "gradient-keyframe-invalid",
					severity: "error",
					track,
					keyframeIndex: index,
					frame: Number.isFinite(keyframe.time) ? keyframe.time : undefined,
					message:
						"Gradient motion keyframes must have finite frame time and a valid linear/radial gradient snapshot (>=2 stops).",
				}),
			);
			return false;
		},
	);

const sceneNodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> =>
	new Map(allNodes(scene).map((node) => [node.id, node]));

const sortedKeyframes = <V extends AnimatableValue>(
	keyframes: readonly AeKeyframe<V>[],
): readonly AeKeyframe<V>[] =>
	[...keyframes].sort((left, right) => left.time - right.time);

const sanitizeTrack = (
	track: KeyframeTrack,
	nodes: ReadonlyMap<string, VectorNode>,
	issues: MotionPresentationIssue[],
): KeyframeTrack | null => {
	const property = track.target.property;
	if (!isAnimatableProperty(property)) {
		issues.push(
			issueForTrack({
				code: "motion-property-unsupported",
				severity: "error",
				track,
				property: String(property),
				message:
					"Motion presentation can only sample the supported animatable property set.",
			}),
		);
		return null;
	}

	const node = nodes.get(track.target.nodeId);
	if (!node) {
		issues.push(
			issueForTrack({
				code: "motion-target-missing",
				severity: "warning",
				track,
				property,
				message:
					"Motion track targets a node id that is not present in the scene document.",
			}),
		);
		return null;
	}

	if (property === "pathShape") {
		if (node.geometry.kind !== "path") {
			issues.push(
				issueForTrack({
					code: "path-shape-target-not-path",
					severity: "error",
					track,
					property,
					message:
						"Path-shape motion tracks can only be sampled on scene nodes with path geometry.",
				}),
			);
			return null;
		}
		const keyframes = sanitizePathShapeKeyframes(track, issues);
		return keyframes.length > 0
			? {
					...track,
					target: { ...track.target, property },
					keyframes: sortedKeyframes(keyframes),
				}
			: null;
	}

	if (property === "meshPaint") {
		if (node.style.fills?.[0]?.kind !== "mesh-gradient") {
			issues.push(
				issueForTrack({
					code: "mesh-target-not-mesh",
					severity: "error",
					track,
					property,
					message:
						"Mesh motion tracks can only be sampled on nodes whose primary fill is a mesh gradient.",
				}),
			);
			return null;
		}
		const keyframes = sanitizeMeshKeyframes(track, issues);
		return keyframes.length > 0
			? {
					...track,
					target: { ...track.target, property },
					keyframes: sortedKeyframes(keyframes),
				}
			: null;
	}

	if (property === "fillGradient") {
		const base = node.style.fills?.[0];
		if (base?.kind !== "linear-gradient" && base?.kind !== "radial-gradient") {
			issues.push(
				issueForTrack({
					code: "gradient-target-not-gradient",
					severity: "error",
					track,
					property,
					message:
						"Gradient motion tracks can only be sampled on nodes whose primary fill is a linear or radial gradient.",
				}),
			);
			return null;
		}
		const keyframes = sanitizeGradientKeyframes(track, issues);
		return keyframes.length > 0
			? {
					...track,
					target: { ...track.target, property },
					keyframes: sortedKeyframes(keyframes),
				}
			: null;
	}

	const keyframes = sanitizeScalarKeyframes(track, issues);
	return keyframes.length > 0
		? {
				...track,
				target: { ...track.target, property },
				keyframes: sortedKeyframes(keyframes),
			}
		: null;
};

const sanitizeMotionForPresentation = (
	scene: SceneDocument,
	motion: MotionDocument,
): SanitizedMotion => {
	const nodes = sceneNodeMap(scene);
	const issues: MotionPresentationIssue[] = [];
	const tracks = motion.tracks.flatMap((track) => {
		const sanitized = sanitizeTrack(track, nodes, issues);
		return sanitized ? [sanitized] : [];
	});
	const sanitizedMotion = { ...motion, tracks };
	for (const path of motion.positionPaths ?? []) {
		if (!nodes.has(path.nodeId)) {
			issues.push({
				code: "position-path-target-missing",
				severity: "warning",
				trackId: path.id,
				nodeId: path.nodeId,
				property: "positionPath",
				message:
					"Spatial path targets a node id that is not present in the scene document.",
			});
			continue;
		}
		const resolution = resolvePositionPath(sanitizedMotion, path.nodeId);
		for (const pathIssue of resolution.issues) {
			issues.push({
				code: pathIssue.code,
				severity: pathIssue.severity,
				trackId: pathIssue.trackId,
				nodeId: pathIssue.nodeId,
				property: "positionPath",
				...(pathIssue.frame !== undefined ? { frame: pathIssue.frame } : {}),
				message: pathIssue.message,
			});
		}
	}
	return {
		motion: sanitizedMotion,
		issues,
	};
};

const collectNodeTargetInfo = (
	scene: SceneDocument,
): ReadonlyMap<string, NodePresentationTargetInfo> => {
	const result = new Map<string, NodePresentationTargetInfo>();
	for (const layer of scene.layers) {
		const visit = (
			nodes: readonly VectorNode[],
			ancestorIds: readonly string[],
		): void => {
			for (const node of nodes) {
				result.set(node.id, { layerId: layer.id, ancestorIds });
				if (node.children) {
					visit(node.children, [...ancestorIds, node.id]);
				}
			}
		};
		visit(layer.nodes, []);
	}
	return result;
};

const nodeTargetMatches = (
	target: EffectTargetRef,
	node: VectorNode,
	info: NodePresentationTargetInfo | undefined,
): boolean => {
	if (target.scope === "object" || target.scope === "group") {
		return target.id === node.id;
	}
	if (target.scope === "layer") {
		return Boolean(target.id && info?.layerId === target.id);
	}
	return false;
};

const automationBridgeIssue = ({
	code,
	severity = "error",
	frame,
	write,
	path,
	message,
}: {
	readonly code: AutomationBridgeIssue["code"];
	readonly severity?: AutomationBridgeIssue["severity"];
	readonly frame: number;
	readonly write: AutomationSampledWrite;
	readonly path?: string;
	readonly message: string;
}): AutomationBridgeIssue => ({
	code,
	severity,
	frame,
	trackIndex: write.trackIndex,
	binding: write.binding,
	path,
	message,
});

const isFrameEffectIntentTrack = (track: AutomationTrack): boolean => {
	const { binding } = track;
	return (
		binding.channel === "effectInfluence" ||
		(binding.channel === "effectParam" && binding.target.scope === "scene")
	);
};

const filterAutomationRecipeTracks = (
	automation: AutomationRecipe,
	predicate: (track: AutomationTrack) => boolean,
): AutomationRecipe => ({
	...automation,
	tracks: automation.tracks.filter(predicate),
});

const appearanceStylePath = (
	effectPath: string,
	path: string,
): string | null => {
	if (effectPath === "style" || effectPath === "appearance") return path;
	const stylePrefix = "style.";
	if (effectPath.startsWith(stylePrefix)) {
		const rootPath = effectPath.slice(stylePrefix.length);
		return rootPath ? `${rootPath}.${path}` : path;
	}
	const appearancePrefix = "appearance.";
	if (effectPath.startsWith(appearancePrefix)) {
		const rootPath = effectPath.slice(appearancePrefix.length);
		return rootPath ? `${rootPath}.${path}` : path;
	}
	return null;
};

const effectParamWritesForNode = ({
	writes,
	node,
	info,
}: {
	readonly writes: readonly AutomationSampledWrite[];
	readonly node: VectorNode;
	readonly info: NodePresentationTargetInfo | undefined;
}): readonly AutomationSampledWrite[] =>
	writes.filter(
		(write) =>
			write.binding.channel === "effectParam" &&
			nodeTargetMatches(write.binding.target, node, info),
	);

const sampleAppearanceForNode = ({
	node,
	frame,
	writes,
	resolveBaseRecipe,
}: {
	readonly node: VectorNode;
	readonly frame: number;
	readonly writes: readonly AutomationSampledWrite[];
	/**
	 * Injected rather than calling `resolveNodeRecipe` directly, so the LEAN
	 * export composer (`sampleLeanMotionPresentationFrame`) never statically
	 * references it — the motion-artifact tier predicate already guarantees a
	 * LEAN-selected scene has no node with a `recipe`/`recipeRef`, so a lean
	 * caller passes a resolver that always returns `null`, letting the real
	 * `resolveNodeRecipe` (and its recipe/look-graph resolution chain) tree-
	 * shake out of the LEAN bundle entirely.
	 */
	readonly resolveBaseRecipe: (node: VectorNode) => VisualRecipe | null;
}): MotionPresentationNodeAppearance | null => {
	if (writes.length === 0) return null;

	const baseRecipe = resolveBaseRecipe(node);
	let recipe = baseRecipe ?? NEUTRAL_VISUAL_RECIPE;
	let recipeAutomated = false;
	let style = node.style;
	let styleAutomated = false;
	const recipePatches: RecipeAutomationPatch[] = [];
	const stylePatches: AppearanceAutomationPatch[] = [];
	const issues: AutomationBridgeIssue[] = [];

	for (const write of writes) {
		const binding = write.binding;
		if (binding.channel !== "effectParam") continue;
		if (binding.effect.path === "recipe") {
			const patch = composeAutomationNumericPathPatch(
				recipe,
				binding.path,
				write.value,
				write.mode,
			);
			if (!patch.ok) {
				issues.push(
					automationBridgeIssue({
						code: patch.code,
						frame,
						write,
						path: binding.path,
						message: automationPathIssueMessage(patch.code, binding.path),
					}),
				);
				continue;
			}
			recipe = patch.next;
			recipeAutomated = true;
			recipePatches.push({
				channel: "effectParam",
				target: binding.target,
				effect: binding.effect,
				path: binding.path,
				mode: write.mode,
				baseValue: patch.baseValue,
				sampledValue: write.value,
				value: patch.value,
				trackIndex: write.trackIndex,
			});
			continue;
		}

		const fullPath = appearanceStylePath(binding.effect.path, binding.path);
		if (!fullPath) {
			issues.push(
				automationBridgeIssue({
					code: "automation-path-invalid",
					frame,
					write,
					path: binding.effect.path,
					message: `Effect slot path "${binding.effect.path}" is not a supported node presentation appearance slot.`,
				}),
			);
			continue;
		}

		const patch = composeAutomationNumericPathPatch(
			style,
			fullPath,
			write.value,
			write.mode,
		);
		if (!patch.ok) {
			issues.push(
				automationBridgeIssue({
					code: patch.code,
					frame,
					write,
					path: fullPath,
					message: automationPathIssueMessage(patch.code, fullPath),
				}),
			);
			continue;
		}
		style = patch.next;
		styleAutomated = true;
		stylePatches.push({
			channel: "effectParam",
			target: binding.target,
			effect: binding.effect,
			path: binding.path,
			fullPath,
			mode: write.mode,
			baseValue: patch.baseValue,
			sampledValue: write.value,
			value: patch.value,
			trackIndex: write.trackIndex,
		});
	}

	if (
		!recipeAutomated &&
		!styleAutomated &&
		recipePatches.length === 0 &&
		stylePatches.length === 0 &&
		issues.length === 0
	) {
		return null;
	}

	return {
		baseStyle: node.style,
		style,
		styleAutomated,
		baseRecipe,
		recipe: recipeAutomated ? recipe : baseRecipe,
		recipeAutomated,
		automation: {
			frame,
			writes,
			recipePatches,
			stylePatches,
			issues,
		},
	};
};

const sampleAppearanceMap = ({
	scene,
	automation,
	frame,
	resolveBaseRecipe,
}: {
	readonly scene: SceneDocument;
	readonly automation?: AutomationRecipe | null;
	readonly frame: number;
	readonly resolveBaseRecipe: (node: VectorNode) => VisualRecipe | null;
}): ReadonlyMap<string, MotionPresentationNodeAppearance> => {
	if (!automation) return new Map();
	const writes = sampleAutomationWrites(automation, frame);
	if (writes.length === 0) return new Map();
	const targetInfo = collectNodeTargetInfo(scene);
	const appearances = new Map<string, MotionPresentationNodeAppearance>();
	for (const node of allNodes(scene)) {
		const nodeWrites = effectParamWritesForNode({
			writes,
			node,
			info: targetInfo.get(node.id),
		});
		const appearance = sampleAppearanceForNode({
			node,
			frame,
			writes: nodeWrites,
			resolveBaseRecipe,
		});
		if (appearance) appearances.set(node.id, appearance);
	}
	return appearances;
};

const sampledGeometry = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
): NodeGeometry => {
	const { geometry } = node;
	if (geometry.kind === "path") {
		const shape = effectiveShape(node, motion, frame);
		return shape ? { ...geometry, shape } : geometry;
	}
	if (geometry.kind === "rect") {
		// RAW sampled radii + smoothing; renderers clamp to bounds. Preserve the
		// reference when nothing animates so unchanged rects stay cheap.
		const radii = effectiveCornerRadii(node, motion, frame);
		const smoothing = effectiveCornerSmoothing(node, motion, frame);
		if (!radii) return geometry;
		const current = resolveCornerRadii(geometry);
		const radiiChanged =
			radii.tl !== current.tl ||
			radii.tr !== current.tr ||
			radii.br !== current.br ||
			radii.bl !== current.bl;
		const smoothingChanged =
			smoothing !== undefined && smoothing !== (geometry.cornerSmoothing ?? 0);
		if (!radiiChanged && !smoothingChanged) return geometry;
		const nextSmoothing = smoothing ?? geometry.cornerSmoothing;
		const uniform =
			radii.tl === radii.tr && radii.tr === radii.br && radii.br === radii.bl;
		return uniform
			? {
					...geometry,
					cornerRadius: radii.tl,
					cornerRadii: undefined,
					cornerSmoothing: nextSmoothing,
				}
			: { ...geometry, cornerRadii: radii, cornerSmoothing: nextSmoothing };
	}
	if (geometry.kind === "star" || geometry.kind === "polygon") {
		const cornerRadius = effectiveCornerRadius(node, motion, frame);
		const smoothing = effectiveCornerSmoothing(node, motion, frame);
		const radiusChanged =
			cornerRadius !== undefined &&
			cornerRadius !== (geometry.cornerRadius ?? 0);
		const smoothingChanged =
			smoothing !== undefined && smoothing !== (geometry.cornerSmoothing ?? 0);
		if (!radiusChanged && !smoothingChanged) return geometry;
		return {
			...geometry,
			cornerRadius: cornerRadius ?? geometry.cornerRadius,
			cornerSmoothing: smoothing ?? geometry.cornerSmoothing,
		};
	}
	return geometry;
};

/**
 * Overlays sampled opacity and (for a mesh-gradient fill) the interpolated mesh
 * onto the node's rest style, preserving the original reference when nothing
 * changed so unanimated branches stay cheap. The sampled mesh flows through the
 * normal renderer (which re-rasterizes it) on the React scrub path.
 */
const sampledStyle = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	appearance: MotionPresentationNodeAppearance | undefined,
): NodeStyle => {
	let style =
		appearance?.styleAutomated && appearance.style !== node.style
			? appearance.style
			: node.style;
	const opacity = effectiveOpacity(node, motion, frame);
	if (opacity !== style.opacity) style = { ...style, opacity };
	const mesh = effectiveMesh(node, motion, frame);
	if (mesh && style.fills && style.fills[0] !== mesh) {
		style = { ...style, fills: [mesh, ...style.fills.slice(1)] };
	}
	const gradient = effectiveFillGradient(node, motion, frame);
	if (gradient && style.fills && style.fills[0] !== gradient) {
		style = { ...style, fills: [gradient, ...style.fills.slice(1)] };
	}
	return style;
};

const sampleNode = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	animatedIds: ReadonlySet<string>,
	context: MotionPresentationSamplingContext,
): SampledNode => {
	const sampledChildren = node.children?.map((child) =>
		sampleNode(child, motion, frame, animatedIds, context),
	);
	const childrenChanged =
		sampledChildren?.some((child) => child.changed) ?? false;
	const children = childrenChanged
		? sampledChildren?.map((child) => child.node)
		: node.children;
	const appearance = context.appearances.get(node.id);
	const appearanceStyleChanged = Boolean(appearance?.styleAutomated);
	const grammarSample = context.grammar.get(node.id);
	const nativeExpressions = context.nativeExpressions.get(node.id) ?? [];
	// A scene-node fragment of an active outline-group text animator: its pose is a
	// transform/opacity override, so it must be admitted and composed below even
	// though it carries no keyframe track of its own.
	const fragmentPose = context.textFragmentPoses.get(node.id);

	// Changed-gate (1/3): a grammar-only node carries no keyframe track and is not
	// in `animatedIds`, so it must be admitted here or it would silently never
	// render. Mirrors the appearance-automation admission above.
	if (
		!animatedIds.has(node.id) &&
		!appearanceStyleChanged &&
		nativeExpressions.length === 0 &&
		grammarSample === undefined &&
		fragmentPose === undefined
	) {
		return childrenChanged
			? { node: { ...node, children }, changed: true }
			: { node, changed: false };
	}

	// `sourceFrame` (time-delay time-remap) re-times this node's own tracks; additive
	// techniques leave it undefined and read the live frame.
	const baseFrame = grammarSample?.sourceFrame ?? frame;
	const sampledNodeGeometry = sampledGeometry(node, motion, baseFrame);
	const nativeGeometry = applyNativeExpressionGeometryBindings({
		bindings: nativeExpressions,
		geometry: sampledNodeGeometry,
		frame: context.nativeExpressionFrame,
	});
	const baseNode = childrenChanged ? { ...node, children } : node;
	const style = sampledStyle(node, motion, baseFrame, appearance);
	const grammarOpacity = composeGrammarOpacity(style.opacity, grammarSample);
	const grammarStrokeDashoffset = composeGrammarStrokeDashoffset(
		style.strokeDashoffset,
		grammarSample,
	);
	const grammarTransform = composeGrammarTransform(
		effectiveTransform(node, motion, baseFrame),
		grammarSample,
	);
	const layoutTransform = composeLayoutPositionTrackOffset(
		grammarTransform,
		motion,
		node.id,
		context.layoutPositionOffsets,
	);
	const nativeSample = applyNativeExpressionBindings({
		bindings: nativeExpressions,
		transform: layoutTransform,
		opacity: grammarOpacity,
		frame: context.nativeExpressionFrame,
	});
	// Outline-group fragment pose is the outermost composition: it rides on top of
	// the node's own (rest/grammar/native) transform and opacity.
	const posed = fragmentPose
		? applyFragmentPose(
				nativeSample.transform,
				nativeSample.opacity,
				fragmentPose,
			)
		: { transform: nativeSample.transform, opacity: nativeSample.opacity };
	const opacityChanged =
		nativeSample.opacityChanged ||
		grammarSample?.opacityFactor !== undefined ||
		grammarSample?.opacityOverride !== undefined ||
		(fragmentPose !== undefined && fragmentPose.opacity !== 1);
	const styleChanged = opacityChanged || grammarStrokeDashoffset !== undefined;
	return {
		node: {
			...baseNode,
			geometry: nativeGeometry.geometry,
			...(grammarSample?.recipeOverride
				? { recipe: grammarSample.recipeOverride }
				: {}),
			style: styleChanged
				? {
						...style,
						opacity: posed.opacity,
						...(grammarStrokeDashoffset !== undefined
							? { strokeDashoffset: grammarStrokeDashoffset }
							: {}),
					}
				: style,
			transform: posed.transform,
		},
		changed: true,
	};
};

const sampleLayer = (
	layer: SceneLayer,
	motion: MotionDocument,
	frame: number,
	animatedIds: ReadonlySet<string>,
	context: MotionPresentationSamplingContext,
): SceneLayer => {
	const sampled = layer.nodes.map((node) =>
		sampleNode(node, motion, frame, animatedIds, context),
	);
	if (sampled.every((item) => !item.changed)) return layer;
	return { ...layer, nodes: sampled.map((item) => item.node) };
};

const duplicateSamplesBySourceId = (
	duplicates: readonly GrammarDuplicateSample[],
): ReadonlyMap<string, readonly GrammarDuplicateSample[]> => {
	const bySource = new Map<string, GrammarDuplicateSample[]>();
	for (const duplicate of duplicates) {
		const items = bySource.get(duplicate.sourceNodeId) ?? [];
		items.push(duplicate);
		bySource.set(duplicate.sourceNodeId, items);
	}
	return bySource;
};

const injectGrammarDuplicatesIntoNodes = (
	sourceById: ReadonlyMap<string, VectorNode>,
	nodes: readonly VectorNode[],
	motion: MotionDocument,
	context: MotionPresentationSamplingContext,
	duplicatesBySource: ReadonlyMap<string, readonly GrammarDuplicateSample[]>,
): { readonly nodes: readonly VectorNode[]; readonly changed: boolean } => {
	let changed = false;
	const next: VectorNode[] = [];
	for (const node of nodes) {
		const childResult = node.children
			? injectGrammarDuplicatesIntoNodes(
					sourceById,
					node.children,
					motion,
					context,
					duplicatesBySource,
				)
			: undefined;
		const nodeWithChildren = childResult?.changed
			? { ...node, children: childResult.nodes }
			: node;
		const duplicates = duplicatesBySource.get(node.id) ?? [];
		if (duplicates.length > 0) {
			const source = sourceById.get(node.id);
			if (source) {
				for (const duplicate of duplicates) {
					next.push(
						sampleDuplicateNode(
							source,
							motion,
							duplicate,
							context,
							duplicate.duplicateNodeId,
						),
					);
				}
				changed = true;
			}
		}
		next.push(nodeWithChildren);
		changed = changed || Boolean(childResult?.changed);
	}
	return changed ? { nodes: next, changed } : { nodes, changed: false };
};

const injectGrammarDuplicates = (
	sourceScene: SceneDocument,
	sampledScene: SceneDocument,
	motion: MotionDocument,
	context: MotionPresentationSamplingContext,
): SceneDocument => {
	if (context.grammarDuplicates.length === 0) return sampledScene;
	const sourceById = new Map(
		allNodes(sourceScene).map((node) => [node.id, node]),
	);
	const duplicatesBySource = duplicateSamplesBySourceId(
		context.grammarDuplicates,
	);
	let changed = false;
	const layers = sampledScene.layers.map((layer) => {
		const result = injectGrammarDuplicatesIntoNodes(
			sourceById,
			layer.nodes,
			motion,
			context,
			duplicatesBySource,
		);
		if (!result.changed) return layer;
		changed = true;
		return { ...layer, nodes: result.nodes };
	});
	return changed ? { ...sampledScene, layers } : sampledScene;
};

const animatedPropertiesForNode = (
	motion: MotionDocument,
	node: VectorNode,
): readonly AnimatableProperty[] => {
	const properties = new Set<AnimatableProperty>();
	for (const track of motion.tracks) {
		if (track.target.nodeId !== node.id || track.keyframes.length === 0) {
			continue;
		}
		if (
			track.target.property === "pathShape" &&
			node.geometry.kind !== "path"
		) {
			continue;
		}
		if (
			track.target.property === "meshPaint" &&
			node.style.fills?.[0]?.kind !== "mesh-gradient"
		) {
			continue;
		}
		properties.add(track.target.property);
	}
	return [...properties].sort(
		(left, right) =>
			(propertyOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
			(propertyOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
	);
};

const valuesForNode = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	context: MotionPresentationSamplingContext,
): MotionPresentationNodeValues | null => {
	const animatedProperties = animatedPropertiesForNode(motion, node);
	const appearance = context.appearances.get(node.id);
	const grammarSample = context.grammar.get(node.id);
	const nativeExpressions = context.nativeExpressions.get(node.id) ?? [];
	// Changed-gate (3/3): admit grammar-only nodes so the sampled values (export /
	// metadata) match the sampled scene exactly.
	if (
		animatedProperties.length === 0 &&
		!appearance &&
		!grammarSample &&
		nativeExpressions.length === 0
	) {
		return null;
	}
	const baseFrame = grammarSample?.sourceFrame ?? frame;
	const pathShape =
		node.geometry.kind === "path"
			? effectiveShape(node, motion, baseFrame)
			: undefined;
	const grammarTransform = composeGrammarTransform(
		effectiveTransform(node, motion, baseFrame),
		grammarSample,
	);
	const layoutTransform = composeLayoutPositionTrackOffset(
		grammarTransform,
		motion,
		node.id,
		context.layoutPositionOffsets,
	);
	const grammarOpacity = composeGrammarOpacity(
		effectiveOpacity(node, motion, baseFrame),
		grammarSample,
	);
	const nativeSample = applyNativeExpressionBindings({
		bindings: nativeExpressions,
		transform: layoutTransform,
		opacity: grammarOpacity,
		frame: context.nativeExpressionFrame,
	});
	return {
		nodeId: node.id,
		frame,
		animatedProperties,
		transform: nativeSample.transform,
		opacity: nativeSample.opacity,
		pathShape,
		...(appearance ? { appearance } : {}),
	};
};

const sampleSceneWithMotion = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	context: MotionPresentationSamplingContext,
): SceneDocument => {
	const animatedIds = new Set(animatedNodeIds(motion));
	if (
		animatedIds.size === 0 &&
		context.appearances.size === 0 &&
		context.nativeExpressions.size === 0 &&
		context.grammar.size === 0 &&
		context.grammarDuplicates.length === 0 &&
		context.textFragmentPoses.size === 0
	) {
		return scene;
	}
	const layers = scene.layers.map((layer) =>
		sampleLayer(layer, motion, frame, animatedIds, context),
	);
	const sampledScene = layers.every(
		(layer, index) => layer === scene.layers[index],
	)
		? scene
		: { ...scene, layers };
	return injectGrammarDuplicates(scene, sampledScene, motion, context);
};

const automationSummary = (
	frame: AutomationBridgeFrame,
): MotionPresentationEffectAutomation | null => {
	if (
		frame.writes.length === 0 &&
		frame.recipePatches.length === 0 &&
		frame.influencePatches.length === 0 &&
		frame.issues.length === 0
	) {
		return null;
	}
	return {
		frame: frame.frame,
		writes: frame.writes,
		recipePatches: frame.recipePatches,
		influencePatches: frame.influencePatches,
		issues: frame.issues,
	};
};

/**
 * Clamps preview/export sampling to the finite frame range carried by the
 * side-car motion document. Fractional frames are preserved because playback can
 * render sub-frame interpolated poses while authored keyframes remain whole
 * frames.
 */
export function clampMotionPresentationFrame(
	frame: number,
	durationFrames: number,
): number {
	if (!Number.isFinite(frame) || !Number.isFinite(durationFrames)) return 0;
	const maxFrame = Math.max(0, durationFrames);
	return Math.min(Math.max(0, frame), maxFrame);
}

/**
 * Resolves scene/artboard vec-core effect intent at a frame and applies optional
 * `AutomationRecipe` writes without mutating the source scene or motion
 * document. When a recipe path is automated but no base visual recipe exists,
 * the neutral vec-core recipe is used as the read-only patch base so automation
 * can author a look from zero; influence automation still requires an existing
 * assignment id and reports a typed bridge issue when missing.
 */
export function sampleMotionPresentationEffectIntent({
	scene,
	frame,
	automation,
	artboardId,
	fps,
	resolveFrameIntent,
	evaluateExpressionSlots,
}: Pick<
	MotionPresentationInput,
	"scene" | "frame" | "automation" | "artboardId" | "fps"
> & {
	/**
	 * Injected rather than calling `resolveFrameEffectIntent` directly, so the
	 * LEAN export composer (`sampleLeanMotionPresentationFrame`) never
	 * statically references it — the motion-artifact tier predicate already
	 * guarantees a LEAN-selected scene has no scene/artboard `effectIntent`,
	 * so a lean caller passes a resolver that only resolves `artboardId` and
	 * hardcodes every recipe/lookGraph slot to `null`, letting the real
	 * `resolveFrameEffectIntent` (and its recipe/look-graph resolution chain)
	 * tree-shake out of the LEAN bundle entirely.
	 */
	readonly resolveFrameIntent: (
		scene: SceneDocument,
		artboardId?: string | null,
	) => ResolvedFrameEffectIntent;
	/**
	 * Injected rather than calling `sampleFrameEffectExpressionSlots` directly,
	 * for the same reason as {@link resolveFrameIntent}: the motion-artifact
	 * tier predicate already guarantees a LEAN/FLAT-selected scene has no
	 * effect-expression bindings, so a lean caller passes a no-op that returns
	 * the intent's recipes unchanged, letting the real evaluator (and the
	 * effect-expression-binding/effect-capabilities/recipe-controls chain it
	 * pulls in) tree-shake out of the LEAN/FLAT bundles entirely.
	 */
	readonly evaluateExpressionSlots: (options: {
		readonly bindings: readonly EffectExpressionBinding[];
		readonly visualRecipe: VisualRecipe | null;
		readonly influenceRecipe: EffectInfluenceRecipe | null;
		readonly frame: number;
		readonly fps?: number;
	}) => FrameEffectExpressionSlotSample;
}): MotionPresentationEffectIntent {
	const resolved = resolveFrameIntent(scene, artboardId);
	const baseVisualRecipe = resolved.visualRecipe;
	const baseInfluenceRecipe = resolved.influenceRecipe;
	const frameAutomation = automation
		? filterAutomationRecipeTracks(automation, isFrameEffectIntentTrack)
		: null;
	const automationFrame = automation
		? sampleAutomationBridgeFrame({
				automation: frameAutomation ?? automation,
				recipe: baseVisualRecipe ?? NEUTRAL_VISUAL_RECIPE,
				influenceRecipe: baseInfluenceRecipe ?? NEUTRAL_EFFECT_INFLUENCE_RECIPE,
				frame,
			})
		: null;
	const visualRecipeAutomated =
		(automationFrame?.recipePatches.length ?? 0) > 0;
	const influenceRecipeAutomated =
		(automationFrame?.influencePatches.length ?? 0) > 0;
	const automatedVisualRecipe = visualRecipeAutomated
		? (automationFrame?.recipe ?? null)
		: baseVisualRecipe;
	const automatedInfluenceRecipe = influenceRecipeAutomated
		? (automationFrame?.influenceRecipe ?? null)
		: baseInfluenceRecipe;
	const frameBindings = frameExpressionBindings(
		scene.effectExpressionBindings ?? [],
	);
	const expressionBindings = [
		...expressionBindingsForSceneTarget(frameBindings),
		...expressionBindingsForArtboardTarget(frameBindings, resolved.artboardId),
	];
	const expressionSample = evaluateExpressionSlots({
		bindings: expressionBindingsForResolvedFrameIntent(
			expressionBindings,
			resolved,
		),
		visualRecipe: automatedVisualRecipe,
		influenceRecipe: automatedInfluenceRecipe,
		frame,
		fps,
	});

	return {
		artboardId: resolved.artboardId,
		baseVisualRecipe,
		baseVisualRecipeSource: resolved.visualRecipeSource,
		visualRecipe: expressionSample.visualRecipeExpressionApplied
			? expressionSample.visualRecipe
			: automatedVisualRecipe,
		visualRecipeAutomated,
		visualRecipeExpressionApplied:
			expressionSample.visualRecipeExpressionApplied,
		baseInfluenceRecipe,
		baseInfluenceRecipeSource: resolved.influenceRecipeSource,
		influenceRecipe: expressionSample.influenceRecipeExpressionApplied
			? expressionSample.influenceRecipe
			: automatedInfluenceRecipe,
		influenceRecipeAutomated,
		influenceRecipeExpressionApplied:
			expressionSample.influenceRecipeExpressionApplied,
		automation: automationFrame ? automationSummary(automationFrame) : null,
	};
}

/**
 * Builds the rest scene that motion sampling reads. Layout projection happens
 * before motion so layout-managed children can still carry transform, opacity,
 * expression, and grammar animation on top of their resolved cell geometry.
 */
const motionPresentationBaseScene = (
	scene: SceneDocument,
): LayoutMotionPresentation =>
	materializeLayoutFramesForMotionPresentation(sampleFrameBlendScene(scene));

/**
 * Lean variant of {@link motionPresentationBaseScene} that skips the blend
 * stage, for composers that already know the scene has no Blend node (see the
 * motion-artifact tier predicate in `code.ts`).
 */
const leanMotionPresentationBaseScene = (
	scene: SceneDocument,
): LayoutMotionPresentation =>
	materializeLayoutFramesForMotionPresentation(scene);

/**
 * Lean bypass for `resolveNodeRecipe`: the motion-artifact tier predicate
 * already guarantees a LEAN-selected node has neither `recipe` nor
 * `recipeRef`, so the real resolver would always return `null` for it anyway
 * — hardcoding that result avoids `sampleAppearanceForNode` (reachable from
 * every composer, including LEAN's) ever statically referencing the real
 * resolver.
 */
const leanResolveAppearanceBaseRecipe = (
	_node: VectorNode,
): VisualRecipe | null => null;

/**
 * Lean bypass for `resolveFrameEffectIntent`: the motion-artifact tier
 * predicate already guarantees a LEAN-selected scene has no scene/artboard
 * `effectIntent`, so every recipe/lookGraph/effectLayerStack slot the real
 * resolver would return is always `null` — only `artboardId` needs real
 * resolution, via the same `findArtboardById`-then-`selectCurrentArtboard`
 * fallback `resolveFrameEffectIntent` itself uses.
 */
const leanResolveFrameEffectIntent = (
	scene: SceneDocument,
	artboardId?: string | null,
): ResolvedFrameEffectIntent => {
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	return {
		artboardId: artboard.id,
		lookGraph: null,
		lookGraphSource: null,
		effectLayerStack: null,
		effectLayerStackSource: null,
		visualRecipe: null,
		visualRecipeSource: null,
		influenceRecipe: null,
		influenceRecipeSource: null,
	};
};

/**
 * Lean/flat bypass for `sampleFrameEffectExpressionSlots`: the motion-artifact
 * tier predicate already guarantees a LEAN/FLAT-selected scene has no
 * effect-expression bindings (`leanResolveFrameEffectIntent` above already
 * forces every binding target this could apply to down to `null`), so the
 * real evaluator would always return its inputs unchanged — this passthrough
 * returns `visualRecipe`/`influenceRecipe` verbatim with both `*Applied` flags
 * `false`, letting the real evaluator (and the effect-expression-binding/
 * effect-capabilities/recipe-controls resolution chain it needs regardless of
 * scene content) tree-shake out of the LEAN/FLAT bundles entirely.
 */
const leanEvaluateExpressionSlots = ({
	visualRecipe,
	influenceRecipe,
}: {
	readonly bindings: readonly EffectExpressionBinding[];
	readonly visualRecipe: VisualRecipe | null;
	readonly influenceRecipe: EffectInfluenceRecipe | null;
	readonly frame: number;
	readonly fps?: number;
}): FrameEffectExpressionSlotSample => ({
	visualRecipe,
	visualRecipeExpressionApplied: false,
	influenceRecipe,
	influenceRecipeExpressionApplied: false,
});

/**
 * Flat bypass for {@link sampleFrameCameraPresentation}: the motion-artifact
 * FLAT tier predicate (`code.ts`'s `sceneQualifiesForFlatTier`) already
 * guarantees the scene has no scene-camera rig anywhere and the export
 * artboard declares `cameraSpacePolicy: "screen_2d"`, so there is no
 * projection, crossfade, or depth-of-field matrix math to run — that whole
 * chain (`resolveSceneCameraProjection` and its dependents) is what FLAT
 * exists to drop from the bundle.
 *
 * Motion-parent bindings and property-relation constraints are a SEPARATE
 * authored capability from camera projection (not covered by the camera
 * predicate) and are still resolved here via the same
 * `applyMotionRelationsToScene`/`restoreMotionParentBindings` pair the real
 * resolver uses, so a camera-free FLAT scene that still authors
 * motion-parenting keeps that behavior — this is an identity camera
 * projection, not an identity presentation.
 */
const flatResolveCameraPresentation = ({
	scene,
	artboardId,
	motionRelationRestScene,
}: {
	readonly scene: SceneDocument;
	readonly artboardId?: string | null;
	readonly motionRelationRestScene?: SceneDocument;
}): SceneCameraPresentation => {
	const artboard =
		findArtboardById(scene, artboardId) ?? selectCurrentArtboard(scene);
	const relationPresentation = applyMotionRelationsToScene({
		restScene: motionRelationRestScene,
		sampledScene: scene,
		stripBindings: true,
	});
	return {
		scene: restoreMotionParentBindings(scene, relationPresentation.scene),
		camera: {
			kind: "none",
			artboardId: artboard.id,
			fidelity: "none",
			issues: [],
		},
		motionRelationIssues: relationPresentation.resolution.issues,
	};
};

/**
 * Builds the sampled scalar/path values for animated nodes at a frame. The
 * returned list is serializable and side-car only: callers can use it for
 * preview overlays, export metadata, or diagnostics without writing to the scene
 * or motion stores.
 */
export function sampleMotionPresentationValues({
	scene,
	motion,
	frame,
	automation,
	grammar,
	controls,
}: MotionPresentationInput): Pick<
	MotionPresentationFrame,
	"frame" | "values" | "issues"
> {
	const base = motionPresentationBaseScene(scene);
	const baseScene = base.scene;
	const sampledFrame = clampMotionPresentationFrame(
		frame,
		motion.durationFrames,
	);
	const { motion: sanitizedMotion, issues } = sanitizeMotionForPresentation(
		baseScene,
		motion,
	);
	const effectiveAutomation = resolveMotionAutomation(motion, automation);
	const grammarFrame = resolveGrammarFrame(grammar, sampledFrame);
	const nativeExpressions = groupNativeExpressionBindings(
		baseScene.nativeExpressionBindings ?? [],
	);
	const context = {
		appearances: sampleAppearanceMap({
			scene: baseScene,
			automation: effectiveAutomation,
			frame: sampledFrame,
			resolveBaseRecipe: resolveNodeRecipe,
		}),
		grammar: grammarFrame.samples,
		grammarDuplicates: grammarFrame.duplicates,
		nativeExpressions,
		nativeExpressionFrame: nativeExpressionFrameContext(
			controls,
			sampledFrame,
			motion.fps,
		),
		layoutPositionOffsets: base.positionOffsets,
		textFragmentPoses: buildOutlineFragmentPoses(
			baseScene,
			sanitizedMotion,
			sampledFrame,
			nativeExpressionFrameContext(controls, sampledFrame, motion.fps),
		),
	} satisfies MotionPresentationSamplingContext;
	const values = allNodes(baseScene).flatMap((node) => {
		const value = valuesForNode(node, sanitizedMotion, sampledFrame, context);
		return value ? [value] : [];
	});
	return { frame: sampledFrame, values, issues };
}

/**
 * Produces a read-only presentation scene by overlaying sampled motion channels
 * onto a SceneDocument clone-on-change tree. Motion stays a side-car document;
 * unanimated scene branches keep their original references for cheap preview
 * rendering.
 */
export function sampleMotionPresentationScene({
	scene,
	motion,
	frame,
	automation,
	artboardId,
	grammar,
	controls,
	cameraRuntimeControl,
}: MotionPresentationInput): SceneDocument {
	const base = motionPresentationBaseScene(scene);
	const baseScene = base.scene;
	const sampledFrame = clampMotionPresentationFrame(
		frame,
		motion.durationFrames,
	);
	const { motion: sanitizedMotion } = sanitizeMotionForPresentation(
		baseScene,
		motion,
	);
	const effectiveAutomation = resolveMotionAutomation(motion, automation);
	const grammarFrame = resolveGrammarFrame(grammar, sampledFrame);
	const nativeExpressions = groupNativeExpressionBindings(
		baseScene.nativeExpressionBindings ?? [],
	);
	const sampledScene = sampleSceneWithMotion(
		baseScene,
		sanitizedMotion,
		sampledFrame,
		{
			appearances: sampleAppearanceMap({
				scene: baseScene,
				automation: effectiveAutomation,
				frame: sampledFrame,
				resolveBaseRecipe: resolveNodeRecipe,
			}),
			grammar: grammarFrame.samples,
			grammarDuplicates: grammarFrame.duplicates,
			nativeExpressions,
			nativeExpressionFrame: nativeExpressionFrameContext(
				controls,
				sampledFrame,
				motion.fps,
			),
			layoutPositionOffsets: base.positionOffsets,
			textFragmentPoses: buildOutlineFragmentPoses(
				baseScene,
				sanitizedMotion,
				sampledFrame,
				nativeExpressionFrameContext(controls, sampledFrame, motion.fps),
			),
		},
	);
	const sceneWithFrameOptics = sampleFrameSourceOpticsScene({
		scene: sampledScene,
		motion,
		frame: sampledFrame,
	});
	const sceneWithFrameLook = sampleFrameLookGraphScene({
		scene: sampleFrameEffectExpressionScene({
			scene: sceneWithFrameOptics,
			frame: sampledFrame,
			fps: motion.fps,
		}),
		motion,
		frame: sampledFrame,
	});
	return sampleFrameCameraPresentation({
		scene: sceneWithFrameLook,
		motion: sanitizedMotion,
		frame: sampledFrame,
		artboardId,
		runtimeControl: cameraRuntimeControl,
		motionRelationRestScene: baseScene,
		controls,
	}).scene;
}

/**
 * Samples both forms preview/export callers need at one frame: a presentation
 * scene for renderer-compatible consumers and compact sampled values plus issues
 * for metadata or non-DOM exporters.
 */
export function sampleMotionPresentationFrame({
	scene,
	motion,
	frame,
	automation,
	artboardId,
	grammar,
	controls,
	cameraRuntimeControl,
}: MotionPresentationInput): MotionPresentationFrame {
	const base = motionPresentationBaseScene(scene);
	const baseScene = base.scene;
	const sampledFrame = clampMotionPresentationFrame(
		frame,
		motion.durationFrames,
	);
	const { motion: sanitizedMotion, issues } = sanitizeMotionForPresentation(
		baseScene,
		motion,
	);
	const effectiveAutomation = resolveMotionAutomation(motion, automation);
	const grammarFrame = resolveGrammarFrame(grammar, sampledFrame);
	const nativeExpressions = groupNativeExpressionBindings(
		baseScene.nativeExpressionBindings ?? [],
	);
	const context = {
		appearances: sampleAppearanceMap({
			scene: baseScene,
			automation: effectiveAutomation,
			frame: sampledFrame,
			resolveBaseRecipe: resolveNodeRecipe,
		}),
		grammar: grammarFrame.samples,
		grammarDuplicates: grammarFrame.duplicates,
		nativeExpressions,
		nativeExpressionFrame: nativeExpressionFrameContext(
			controls,
			sampledFrame,
			motion.fps,
		),
		layoutPositionOffsets: base.positionOffsets,
		textFragmentPoses: buildOutlineFragmentPoses(
			baseScene,
			sanitizedMotion,
			sampledFrame,
			nativeExpressionFrameContext(controls, sampledFrame, motion.fps),
		),
	} satisfies MotionPresentationSamplingContext;
	const sceneNodes = allNodes(baseScene);
	const values = sceneNodes.flatMap((node) => {
		const value = valuesForNode(node, sanitizedMotion, sampledFrame, context);
		return value ? [value] : [];
	});
	const sceneWithMotion = sampleSceneWithMotion(
		baseScene,
		sanitizedMotion,
		sampledFrame,
		context,
	);
	const sceneWithFrameOptics = sampleFrameSourceOpticsScene({
		scene: sceneWithMotion,
		motion,
		frame: sampledFrame,
	});
	const sceneWithFrameEffects = sampleFrameLookGraphScene({
		scene: sampleFrameEffectExpressionScene({
			scene: sceneWithFrameOptics,
			frame: sampledFrame,
			fps: motion.fps,
		}),
		motion,
		frame: sampledFrame,
	});
	const cameraPresentation = sampleFrameCameraPresentation({
		scene: sceneWithFrameEffects,
		motion: sanitizedMotion,
		frame: sampledFrame,
		artboardId,
		runtimeControl: cameraRuntimeControl,
		motionRelationRestScene: baseScene,
		controls,
	});
	return {
		sceneSchemaVersion: baseScene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		frame: sampledFrame,
		scene: cameraPresentation.scene,
		camera: cameraPresentation.camera,
		values,
		effectIntent: sampleMotionPresentationEffectIntent({
			scene: baseScene,
			frame: sampledFrame,
			automation: effectiveAutomation,
			artboardId,
			resolveFrameIntent: resolveFrameEffectIntent,
			evaluateExpressionSlots: sampleFrameEffectExpressionSlots,
			fps: motion.fps,
		}),
		issues,
		relationIssues: cameraPresentation.motionRelationIssues ?? [],
	};
}

/**
 * Lean sibling of {@link sampleMotionPresentationFrame} for the export-side
 * LEAN sampler tier (`render-presentation-lean.ts`): runs the same base-scene,
 * motion-track, and camera stages — reusing the exact same private helpers,
 * not a semantic fork — but skips the source-optics, effect-expression,
 * look-graph, and blend-refresh stages. Only valid for scenes the
 * motion-artifact tier predicate (`code.ts`) has already confirmed need none
 * of those four; camera stays because it is core to visual identity, not an
 * optional capability, in every composer tier.
 */
export function sampleLeanMotionPresentationFrame({
	scene,
	motion,
	frame,
	automation,
	artboardId,
	grammar,
	controls,
	cameraRuntimeControl,
}: MotionPresentationInput): MotionPresentationFrame {
	const base = leanMotionPresentationBaseScene(scene);
	const baseScene = base.scene;
	const sampledFrame = clampMotionPresentationFrame(
		frame,
		motion.durationFrames,
	);
	const { motion: sanitizedMotion, issues } = sanitizeMotionForPresentation(
		baseScene,
		motion,
	);
	const effectiveAutomation = resolveMotionAutomation(motion, automation);
	const grammarFrame = resolveGrammarFrame(grammar, sampledFrame);
	const nativeExpressions = groupNativeExpressionBindings(
		baseScene.nativeExpressionBindings ?? [],
	);
	const context = {
		appearances: sampleAppearanceMap({
			scene: baseScene,
			automation: effectiveAutomation,
			frame: sampledFrame,
			resolveBaseRecipe: leanResolveAppearanceBaseRecipe,
		}),
		grammar: grammarFrame.samples,
		grammarDuplicates: grammarFrame.duplicates,
		nativeExpressions,
		nativeExpressionFrame: nativeExpressionFrameContext(
			controls,
			sampledFrame,
			motion.fps,
		),
		layoutPositionOffsets: base.positionOffsets,
		textFragmentPoses: buildOutlineFragmentPoses(
			baseScene,
			sanitizedMotion,
			sampledFrame,
			nativeExpressionFrameContext(controls, sampledFrame, motion.fps),
		),
	} satisfies MotionPresentationSamplingContext;
	const sceneNodes = allNodes(baseScene);
	const values = sceneNodes.flatMap((node) => {
		const value = valuesForNode(node, sanitizedMotion, sampledFrame, context);
		return value ? [value] : [];
	});
	const sceneWithMotion = sampleSceneWithMotion(
		baseScene,
		sanitizedMotion,
		sampledFrame,
		context,
	);
	const cameraPresentation = sampleFrameCameraPresentation({
		scene: sceneWithMotion,
		motion: sanitizedMotion,
		frame: sampledFrame,
		artboardId,
		runtimeControl: cameraRuntimeControl,
		motionRelationRestScene: baseScene,
		controls,
	});
	return {
		sceneSchemaVersion: baseScene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		frame: sampledFrame,
		scene: cameraPresentation.scene,
		camera: cameraPresentation.camera,
		values,
		effectIntent: sampleMotionPresentationEffectIntent({
			scene: baseScene,
			frame: sampledFrame,
			automation: effectiveAutomation,
			artboardId,
			resolveFrameIntent: leanResolveFrameEffectIntent,
			evaluateExpressionSlots: leanEvaluateExpressionSlots,
			fps: motion.fps,
		}),
		issues,
		relationIssues: cameraPresentation.motionRelationIssues ?? [],
	};
}

/**
 * Flat sibling of {@link sampleLeanMotionPresentationFrame} for the
 * export-side FLAT sampler tier (`render-presentation-flat.ts`) — identical
 * to LEAN except camera projection is replaced with
 * {@link flatResolveCameraPresentation}'s identity-projection resolution.
 * Only valid for scenes the motion-artifact tier predicate (`code.ts`'s
 * `sceneQualifiesForFlatTier`) has already confirmed have no scene-camera rig
 * and an explicit `cameraSpacePolicy: "screen_2d"` declaration on the export
 * artboard; motion-parent/property-relation resolution still runs (see
 * {@link flatResolveCameraPresentation}'s doc comment) — only the 3D
 * projection/crossfade/depth-of-field matrix math is skipped.
 */
export function sampleFlatMotionPresentationFrame({
	scene,
	motion,
	frame,
	automation,
	artboardId,
	grammar,
	controls,
}: MotionPresentationInput): MotionPresentationFrame {
	const base = leanMotionPresentationBaseScene(scene);
	const baseScene = base.scene;
	const sampledFrame = clampMotionPresentationFrame(
		frame,
		motion.durationFrames,
	);
	const { motion: sanitizedMotion, issues } = sanitizeMotionForPresentation(
		baseScene,
		motion,
	);
	const effectiveAutomation = resolveMotionAutomation(motion, automation);
	const grammarFrame = resolveGrammarFrame(grammar, sampledFrame);
	const nativeExpressions = groupNativeExpressionBindings(
		baseScene.nativeExpressionBindings ?? [],
	);
	const context = {
		appearances: sampleAppearanceMap({
			scene: baseScene,
			automation: effectiveAutomation,
			frame: sampledFrame,
			resolveBaseRecipe: leanResolveAppearanceBaseRecipe,
		}),
		grammar: grammarFrame.samples,
		grammarDuplicates: grammarFrame.duplicates,
		nativeExpressions,
		nativeExpressionFrame: nativeExpressionFrameContext(
			controls,
			sampledFrame,
			motion.fps,
		),
		layoutPositionOffsets: base.positionOffsets,
		textFragmentPoses: buildOutlineFragmentPoses(
			baseScene,
			sanitizedMotion,
			sampledFrame,
			nativeExpressionFrameContext(controls, sampledFrame, motion.fps),
		),
	} satisfies MotionPresentationSamplingContext;
	const sceneNodes = allNodes(baseScene);
	const values = sceneNodes.flatMap((node) => {
		const value = valuesForNode(node, sanitizedMotion, sampledFrame, context);
		return value ? [value] : [];
	});
	const sceneWithMotion = sampleSceneWithMotion(
		baseScene,
		sanitizedMotion,
		sampledFrame,
		context,
	);
	const cameraPresentation = flatResolveCameraPresentation({
		scene: sceneWithMotion,
		artboardId,
		motionRelationRestScene: baseScene,
	});
	return {
		sceneSchemaVersion: baseScene.schemaVersion,
		motionSchemaVersion: motion.schemaVersion,
		frame: sampledFrame,
		scene: cameraPresentation.scene,
		camera: cameraPresentation.camera,
		values,
		effectIntent: sampleMotionPresentationEffectIntent({
			scene: baseScene,
			frame: sampledFrame,
			automation: effectiveAutomation,
			artboardId,
			resolveFrameIntent: leanResolveFrameEffectIntent,
			evaluateExpressionSlots: leanEvaluateExpressionSlots,
			fps: motion.fps,
		}),
		issues,
		relationIssues: cameraPresentation.motionRelationIssues ?? [],
	};
}

/**
 * Resolves a deterministic inclusive frame plan for preview/export ranges.
 * `stepFrames` is clamped to a positive finite value and the returned frame
 * numbers are safe to feed into {@link sampleMotionPresentationFrame}.
 */
export function buildMotionPresentationFramePlan({
	motion,
	startFrame = 0,
	endFrame = motion.durationFrames,
	stepFrames = 1,
}: {
	readonly motion: MotionDocument;
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly stepFrames?: number;
}): MotionPresentationFramePlan {
	const start = clampMotionPresentationFrame(startFrame, motion.durationFrames);
	const end = clampMotionPresentationFrame(endFrame, motion.durationFrames);
	const low = Math.min(start, end);
	const high = Math.max(start, end);
	const step = Number.isFinite(stepFrames) && stepFrames > 0 ? stepFrames : 1;
	const frames: number[] = [];
	for (let frame = low; frame <= high; frame += step) {
		frames.push(frame);
		if (high - frame < step) break;
	}
	if (frames[frames.length - 1] !== high) frames.push(high);
	return {
		fps: motion.fps,
		durationFrames: motion.durationFrames,
		startFrame: low,
		endFrame: high,
		stepFrames: step,
		frames,
	};
}

/**
 * Samples an inclusive frame range into serializable presentation frames. This is
 * intentionally pure and eager so export jobs can snapshot exactly which frames
 * were requested; callers that need streaming can use the returned frame plan and
 * call {@link sampleMotionPresentationFrame} per frame.
 */
export function sampleMotionPresentationSequence({
	scene,
	motion,
	automation,
	artboardId,
	startFrame,
	endFrame,
	stepFrames,
	grammar,
}: MotionPresentationSequenceInput): MotionPresentationSequence {
	const plan = buildMotionPresentationFramePlan({
		motion,
		startFrame,
		endFrame,
		stepFrames,
	});
	const effectiveAutomation = resolveMotionAutomation(motion, automation);
	return {
		...plan,
		samples: plan.frames.map((frame) =>
			sampleMotionPresentationFrame({
				scene,
				motion,
				automation: effectiveAutomation,
				artboardId,
				frame,
				grammar,
			}),
		),
	};
}
