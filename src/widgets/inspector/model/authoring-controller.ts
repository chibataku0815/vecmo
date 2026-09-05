import { isSpatialAnimatableProperty } from "@/entities/motion/model/camera-standard";
import type { MotionCommand } from "@/entities/motion/model/command";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createResizeTextBoxCommand } from "@/entities/scene/model/node-commands";
import {
	type InspectorTransformValues,
	inspectorValuesForNode,
	matrixFromInspectorValues,
	matrixFromTransform,
	normalizeTextGeometry,
	transformWithAnchorPreservingMatrix,
} from "@/entities/scene/model/rendering";
import {
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	createFrameInfluenceMaskCommand,
	createFrameVisualRecipeApplyCommand,
	createFrameVisualRecipeControlCommand,
	type FrameEffectIntentTarget,
	type FrameInfluenceMaskOperation,
} from "@/features/effect-authoring/model/effect-intent-commands";
import {
	createInspectorKeyframeActionCommands,
	type InspectorKeyframeActionGroup,
	type InspectorKeyframeActionState,
	type InspectorKeyframeUnavailableReason,
	type InspectorMotionField,
	inspectorKeyframeActionState,
	inspectorKeyframeFrame,
	inspectorPropertyForField,
	shouldKeyInspectorField,
} from "@/features/motion/model/inspector-keyframing";
import { useTransportStore } from "@/features/motion/model/transport-store";
import {
	ensureSceneCameraBeforeSpatialAuthoring,
	type JustInTimeSceneCameraResult,
} from "@/features/scene-camera/model/authoring";
import { useSelectionStore } from "@/features/selection/model/store";
import {
	type RepeatTransformApplication,
	type RepeatTransformSnapshot,
	recordNodeTransformRepeat,
} from "@/features/transform/model/repeat-transform";
import type { VisualRecipe } from "@/shared/vec-core";
import { createApplyNodeTransformCommand } from "@/widgets/canvas-shell/model/writer";
import {
	inspectorFieldToBindablePropertyId,
	isNodeEligibleForBindableProperty,
} from "./property-binding";

export type InspectorSceneEditTarget =
	| "node-transform"
	| "node-opacity"
	| "text-box"
	| "frame-effect-intent"
	| "frame-effect-influence";

export type InspectorAuthoringDisabledReason =
	| InspectorKeyframeUnavailableReason
	| "invalid-scene-value"
	| "ineligible-bindable-property"
	| "missing-effect-target"
	| "missing-effect-assignment"
	| "invalid-effect-path"
	| "invalid-effect-value"
	| "invalid-effect-influence";

export type InspectorAuthoringPlan =
	| {
			readonly kind: "scene-command";
			readonly target: InspectorSceneEditTarget;
			readonly label: string;
			readonly transactionScope: string;
			readonly command: SceneCommand;
			readonly repeatTransformSnapshot?: RepeatTransformSnapshot;
			readonly repeatTransformApplication?: RepeatTransformApplication;
	  }
	| {
			readonly kind: "motion-keyframe-command";
			readonly operation: "upsert" | "remove";
			readonly label: string;
			readonly transactionScope: string;
			readonly nodeId: string;
			readonly frame: number;
			readonly fields: readonly InspectorMotionField[];
			readonly commands: readonly MotionCommand[];
	  }
	| {
			readonly kind: "noop";
			readonly reason: "unchanged" | "empty-command-list";
			readonly message: string;
	  }
	| {
			readonly kind: "disabled";
			readonly reason: InspectorAuthoringDisabledReason;
			readonly message: string;
	  };

export type InspectorNumberEditContext = {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly currentFrame: number;
	readonly recording: boolean;
	readonly node: VectorNode;
	readonly field: InspectorMotionField;
	readonly value: number;
	readonly expectedNodeId?: string;
	readonly expectedFrame?: number;
	/** Forces W/H edits to author TextGeometry bounds, converting point text to area text. */
	readonly textBoxResize?: boolean;
};

export type InspectorKeyframeEditContext = {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly currentFrame: number;
	readonly fields: readonly InspectorMotionField[];
	readonly operation?: "upsert" | "remove";
	readonly inspectorValues?: Partial<
		Record<InspectorMotionField, number | undefined>
	>;
	readonly expectedNodeId?: string;
	readonly expectedFrame?: number;
};

export type ReadyInspectorKeyframeActionState = Extract<
	InspectorKeyframeActionState,
	{ readonly status: "ready" }
>;

export type InspectorAuthoringReadContext = {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly currentFrame: number;
	readonly recording: boolean;
};

export type InspectorAuthoringReadState = {
	readonly frame: number;
	readonly recording: boolean;
	readonly keyframeState: InspectorKeyframeActionState;
};

export type InspectorAnchorPresetEditContext = {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly currentFrame: number;
	readonly recording: boolean;
	readonly node: VectorNode;
	readonly anchor: Vec2;
	readonly expectedNodeId?: string;
	readonly expectedFrame?: number;
};

export type InspectorFrameEffectRecipeScope = "current-artboard" | "scene";

export type InspectorFrameRecipeEditContext = {
	readonly document: SceneDocument;
	readonly scope: InspectorFrameEffectRecipeScope;
	readonly path: string;
	readonly value: number;
	readonly artboardId?: string | null;
};

export type InspectorFrameRecipeApplyContext = {
	readonly document: SceneDocument;
	readonly scope: InspectorFrameEffectRecipeScope;
	readonly recipe: VisualRecipe;
	readonly artboardId?: string | null;
	readonly label?: string;
};

export type InspectorFrameInfluenceMaskEditContext = {
	readonly document: SceneDocument;
	readonly scope: InspectorFrameEffectRecipeScope;
	readonly operation: FrameInfluenceMaskOperation | null;
	readonly artboardId?: string | null;
	readonly label?: string;
	readonly unavailableReason?: Extract<
		InspectorAuthoringDisabledReason,
		"missing-effect-assignment" | "invalid-effect-influence"
	>;
};

const clampOpacity = (value: number): number =>
	Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));

const finitePositiveScale = (value: number): number =>
	Number.isFinite(value) && Math.abs(value) > 0 ? Math.abs(value) : 1;

const effectIntentTargetForScope = (
	scope: InspectorFrameEffectRecipeScope,
	artboardId?: string | null,
): FrameEffectIntentTarget => {
	if (scope === "scene") return { scope: "scene" };
	return artboardId
		? { scope: "artboard", artboardId }
		: { scope: "current-artboard" };
};

const disabled = (
	reason: InspectorAuthoringDisabledReason,
	message: string,
): InspectorAuthoringPlan => ({ kind: "disabled", reason, message });

const noop = (
	reason: Extract<InspectorAuthoringPlan, { readonly kind: "noop" }>["reason"],
	message: string,
): InspectorAuthoringPlan => ({ kind: "noop", reason, message });

const sceneCommandPlan = ({
	target,
	label,
	transactionScope,
	command,
	repeatTransformSnapshot,
	repeatTransformApplication,
}: {
	readonly target: InspectorSceneEditTarget;
	readonly label: string;
	readonly transactionScope: string;
	readonly command: SceneCommand;
	readonly repeatTransformSnapshot?: RepeatTransformSnapshot;
	readonly repeatTransformApplication?: RepeatTransformApplication;
}): InspectorAuthoringPlan => ({
	kind: "scene-command",
	target,
	label,
	transactionScope,
	command,
	repeatTransformSnapshot,
	repeatTransformApplication,
});

const motionCommandPlan = (
	result: Extract<
		ReturnType<typeof createInspectorKeyframeActionCommands>,
		{ readonly status: "ready" }
	>,
): InspectorAuthoringPlan => {
	if (result.commands.length === 0) {
		return noop(
			"empty-command-list",
			"The Inspector keyframe action produced no motion commands.",
		);
	}
	return {
		kind: "motion-keyframe-command",
		operation: result.operation,
		label:
			result.operation === "remove"
				? "Remove Inspector keyframes"
				: "Set Inspector keyframes",
		transactionScope: `inspector-keyframe:${result.nodeId}:${result.frame}:${result.fields.join("|")}`,
		nodeId: result.nodeId,
		frame: result.frame,
		fields: result.fields,
		commands: result.commands,
	};
};

/**
 * Builds the Inspector authoring read model used by both the docked rail and
 * floating HUD. The UI receives one frame/keyframe/recording snapshot and does
 * not need to know how the motion feature snaps the playhead for authoring.
 */
export function inspectorAuthoringReadState(
	context: InspectorAuthoringReadContext,
): InspectorAuthoringReadState {
	const frame = inspectorKeyframeFrame(context.motion, context.currentFrame);
	return {
		frame,
		recording: context.recording,
		keyframeState: inspectorKeyframeActionState({
			document: context.document,
			motion: context.motion,
			selectedNodeIds: context.selectedNodeIds,
			primaryNodeId: context.primaryNodeId,
			currentFrame: frame,
		}),
	};
}

/**
 * Plans one single-selection transform/opacity Inspector edit without touching
 * stores. The returned plan makes the authoring policy explicit: plain channels
 * write scene rest state; recording or already-animated channels write motion
 * keyframes through the existing keyframing adapter.
 */
export function planInspectorNumberEdit(
	context: InspectorNumberEditContext,
): InspectorAuthoringPlan {
	if (!Number.isFinite(context.value)) {
		return disabled(
			"invalid-scene-value",
			"Inspector numeric edits require finite values.",
		);
	}

	// Gate the edit on the bindable-property registry when the field maps to one.
	// Transform/opacity bind to any node, so this is currently inert for them; it
	// makes the controller registry-driven and ready for geometry-scoped fields.
	const bindablePropertyId = inspectorFieldToBindablePropertyId(context.field);
	if (
		bindablePropertyId &&
		!isNodeEligibleForBindableProperty(context.node, bindablePropertyId)
	) {
		return disabled(
			"ineligible-bindable-property",
			`The "${bindablePropertyId}" property cannot bind to a ${context.node.geometry.kind} node.`,
		);
	}

	const isDimensionField =
		context.field === "width" || context.field === "height";
	if (isDimensionField && context.value <= 0) {
		return disabled(
			"invalid-scene-value",
			"Inspector width and height edits must stay positive.",
		);
	}

	if (
		context.node.geometry.kind === "text" &&
		isDimensionField &&
		(context.textBoxResize ||
			normalizeTextGeometry(context.node.geometry).mode === "area")
	) {
		if (
			Object.is(
				inspectorValuesForNode(context.node)[context.field],
				context.value,
			)
		) {
			return noop("unchanged", "The Inspector text-box value is unchanged.");
		}
		const scale =
			context.field === "width"
				? finitePositiveScale(context.node.transform.scale.x)
				: finitePositiveScale(context.node.transform.scale.y);
		return sceneCommandPlan({
			target: "text-box",
			label: "Edit text box",
			transactionScope: `text-box:${context.node.id}:${context.field}`,
			command: createResizeTextBoxCommand(context.node.id, {
				mode: "area",
				bounds: {
					...context.node.geometry.bounds,
					[context.field]: context.value / scale,
				},
			}),
		});
	}

	if (
		shouldKeyInspectorField(
			context.motion,
			context.node.id,
			context.field,
			context.recording,
		)
	) {
		return planInspectorKeyframeEdit({
			document: context.document,
			motion: context.motion,
			selectedNodeIds: context.selectedNodeIds,
			primaryNodeId: context.primaryNodeId,
			currentFrame: context.currentFrame,
			fields: [context.field],
			inspectorValues: { [context.field]: context.value },
			expectedNodeId: context.expectedNodeId,
			expectedFrame: context.expectedFrame,
		});
	}

	if (context.field === "opacity") {
		const opacity = clampOpacity(context.value);
		if (Object.is(context.node.style.opacity, opacity)) {
			return noop("unchanged", "The Inspector opacity value is unchanged.");
		}
		return sceneCommandPlan({
			target: "node-opacity",
			label: "Edit opacity",
			transactionScope: `opacity:${context.node.id}`,
			command: createApplyNodeTransformCommand(context.node.id, { opacity }),
		});
	}

	if (context.field === "anchorX" || context.field === "anchorY") {
		if (
			Object.is(
				inspectorValuesForNode(context.node)[context.field],
				context.value,
			)
		) {
			return noop("unchanged", "The Inspector pivot value is unchanged.");
		}
		const nextTransform = transformWithAnchorPreservingMatrix(
			context.node.transform,
			{
				x:
					context.field === "anchorX"
						? context.value
						: context.node.transform.anchor.x,
				y:
					context.field === "anchorY"
						? context.value
						: context.node.transform.anchor.y,
			},
		);
		return sceneCommandPlan({
			target: "node-transform",
			label: "Edit pivot",
			transactionScope: `transform:${context.node.id}:${context.field}`,
			command: createApplyNodeTransformCommand(context.node.id, {
				transform: {
					position: nextTransform.position,
					anchor: nextTransform.anchor,
				},
			}),
		});
	}

	if (
		Object.is(
			inspectorValuesForNode(context.node)[context.field],
			context.value,
		)
	) {
		return noop("unchanged", "The Inspector transform value is unchanged.");
	}

	return sceneCommandPlan({
		target: "node-transform",
		label: "Edit transform",
		transactionScope: `transform:${context.node.id}:${context.field}`,
		command: createApplyNodeTransformCommand(context.node.id, {
			matrix: matrixFromInspectorValues(context.node, {
				[context.field]: context.value,
			} satisfies Partial<InspectorTransformValues>),
		}),
		repeatTransformSnapshot: {
			nodeId: context.node.id,
			matrix: matrixFromTransform(context.node.transform),
		},
		repeatTransformApplication:
			context.field === "width" || context.field === "height"
				? "local"
				: "world",
	});
}

/**
 * Plans explicit keyframe button actions for the Inspector. This keeps stale
 * selection/frame guards and channel conversion in `features/motion`, while the
 * widget receives a uniform authoring plan.
 */
export function planInspectorKeyframeEdit(
	context: InspectorKeyframeEditContext,
): InspectorAuthoringPlan {
	const result = createInspectorKeyframeActionCommands({
		document: context.document,
		motion: context.motion,
		selectedNodeIds: context.selectedNodeIds,
		primaryNodeId: context.primaryNodeId,
		currentFrame: context.currentFrame,
		fields: context.fields,
		operation: context.operation,
		inspectorValues: context.inspectorValues,
		expectedNodeId: context.expectedNodeId,
		expectedFrame: context.expectedFrame,
	});
	if (result.status === "unavailable") {
		return disabled(result.issue.reason, result.issue.message);
	}
	return motionCommandPlan(result);
}

/**
 * Plans the 3x3 pivot preset as the same authoring plan shape as numeric fields.
 * Rest-pose anchor changes stay in the scene; recording or existing transform
 * motion keys both anchor axes through the motion command bridge.
 */
export function planInspectorAnchorPresetEdit(
	context: InspectorAnchorPresetEditContext,
): InspectorAuthoringPlan {
	if (
		!Number.isFinite(context.anchor.x) ||
		!Number.isFinite(context.anchor.y)
	) {
		return disabled(
			"invalid-scene-value",
			"Inspector pivot presets require finite anchor values.",
		);
	}

	const frame = inspectorKeyframeFrame(context.motion, context.currentFrame);
	if (
		context.expectedNodeId !== undefined &&
		context.expectedNodeId !== context.node.id
	) {
		return disabled(
			"stale-selection",
			"The Inspector pivot target changed before the action committed.",
		);
	}
	if (context.expectedFrame !== undefined && context.expectedFrame !== frame) {
		return disabled(
			"stale-frame",
			"The playhead moved before the Inspector pivot action committed.",
		);
	}
	if (context.primaryNodeId !== context.node.id) {
		return disabled(
			"stale-selection",
			"The Inspector pivot target is no longer the primary selection.",
		);
	}

	const currentNode = findNode(context.document, context.node.id);
	if (!currentNode) {
		return disabled(
			"stale-selection",
			"The Inspector pivot target no longer exists in the scene document.",
		);
	}

	if (
		shouldKeyInspectorField(
			context.motion,
			currentNode.id,
			"anchorX",
			context.recording,
		) ||
		shouldKeyInspectorField(
			context.motion,
			currentNode.id,
			"anchorY",
			context.recording,
		)
	) {
		return planInspectorKeyframeEdit({
			document: context.document,
			motion: context.motion,
			selectedNodeIds: context.selectedNodeIds,
			primaryNodeId: context.primaryNodeId,
			currentFrame: context.currentFrame,
			fields: ["anchorX", "anchorY"],
			inspectorValues: {
				anchorX: context.anchor.x,
				anchorY: context.anchor.y,
			},
			expectedNodeId: context.expectedNodeId,
			expectedFrame: context.expectedFrame,
		});
	}

	if (
		Object.is(currentNode.transform.anchor.x, context.anchor.x) &&
		Object.is(currentNode.transform.anchor.y, context.anchor.y)
	) {
		return noop("unchanged", "The Inspector pivot preset is already active.");
	}

	const transform = transformWithAnchorPreservingMatrix(
		currentNode.transform,
		context.anchor,
	);
	return sceneCommandPlan({
		target: "node-transform",
		label: "Set pivot",
		transactionScope: `transform:${currentNode.id}:anchor`,
		command: createApplyNodeTransformCommand(currentNode.id, {
			transform: {
				position: transform.position,
				anchor: transform.anchor,
			},
		}),
	});
}

/**
 * Plans frame-level vec-core recipe edits through the Stage Q effect-authoring
 * command seam. The Inspector only chooses scene vs artboard scope; recipe path
 * validation and command creation remain owned by the effect-authoring feature.
 */
export function planFrameRecipeNumberEdit(
	context: InspectorFrameRecipeEditContext,
): InspectorAuthoringPlan {
	if (!Number.isFinite(context.value)) {
		return disabled(
			"invalid-effect-value",
			"Frame effect recipe edits require finite numeric values.",
		);
	}
	const target = effectIntentTargetForScope(context.scope, context.artboardId);
	const result = createFrameVisualRecipeControlCommand(
		context.document,
		target,
		context.path,
		context.value,
		{
			label: context.scope === "scene" ? "Edit scene look" : "Edit frame look",
		},
	);
	switch (result.kind) {
		case "ready":
			return sceneCommandPlan({
				target: "frame-effect-intent",
				label:
					context.scope === "scene" ? "Edit scene look" : "Edit frame look",
				transactionScope: `frame-look:${context.scope}:${context.path}`,
				command: result.command,
			});
		case "unchanged":
			return noop("unchanged", "The frame effect recipe value is unchanged.");
		case "missing-target":
			return disabled(
				"missing-effect-target",
				"The target artboard for this frame effect no longer exists.",
			);
		case "invalid-path":
			return disabled(
				"invalid-effect-path",
				"Frame effect recipe path is not editable by the Inspector.",
			);
		case "invalid-value":
			return disabled(
				"invalid-effect-value",
				"Frame effect recipe value is not valid for this control.",
			);
	}
}

/**
 * Plans a one-click recall that applies a COMPLETE saved frame look (a canonical
 * vec-core recipe) to scene/artboard `effectIntent`. The Inspector only chooses
 * scene vs artboard scope; the effect-authoring feature owns command creation and
 * the no-op compare, so a repeated recall on an already-applied frame is a typed
 * `noop` and never enters command history.
 */
export function planFrameVisualRecipeApply(
	context: InspectorFrameRecipeApplyContext,
): InspectorAuthoringPlan {
	const target = effectIntentTargetForScope(context.scope, context.artboardId);
	const label =
		context.label ??
		(context.scope === "scene" ? "Apply scene look" : "Apply frame look");
	const result = createFrameVisualRecipeApplyCommand(
		context.document,
		target,
		context.recipe,
		{ label },
	);
	switch (result.kind) {
		case "ready":
			return sceneCommandPlan({
				target: "frame-effect-intent",
				label,
				transactionScope: `frame-look-apply:${context.scope}`,
				command: result.command,
			});
		case "unchanged":
			return noop("unchanged", "The frame look is already applied.");
		case "missing-target":
			return disabled(
				"missing-effect-target",
				"The target artboard for this frame look no longer exists.",
			);
		case "invalid-path":
			return disabled(
				"invalid-effect-path",
				"Frame look recipe path is not editable by the Inspector.",
			);
		case "invalid-value":
			return disabled(
				"invalid-effect-value",
				"Frame look recipe value is not valid.",
			);
	}
}

/**
 * Plans a scene/artboard influence-mask edit through the effect-authoring
 * command seam. The controller keeps stale target/assignment failures explicit,
 * while the feature model owns canonical vec-core `EffectInfluenceRecipe`
 * operations.
 */
export function planFrameInfluenceMaskEdit(
	context: InspectorFrameInfluenceMaskEditContext,
): InspectorAuthoringPlan {
	const label = context.label ?? "Edit effect influence";
	if (!context.operation) {
		return disabled(
			context.unavailableReason ?? "invalid-effect-influence",
			context.unavailableReason === "missing-effect-assignment"
				? "The target influence assignment is no longer available."
				: "The frame effect influence edit is not valid for this mask.",
		);
	}
	const target = effectIntentTargetForScope(context.scope, context.artboardId);
	const result = createFrameInfluenceMaskCommand(
		context.document,
		target,
		context.operation,
		{ label },
	);
	switch (result.kind) {
		case "ready":
			return sceneCommandPlan({
				target: "frame-effect-influence",
				label,
				transactionScope: `frame-influence:${context.scope}:${context.operation.kind}`,
				command: result.command,
			});
		case "unchanged":
			return noop("unchanged", "The frame effect influence is unchanged.");
		case "missing-target":
			return disabled(
				"missing-effect-target",
				"The target artboard for this frame effect no longer exists.",
			);
		case "invalid-path":
			return disabled(
				"invalid-effect-path",
				"Frame effect influence path is not editable by the Inspector.",
			);
		case "invalid-value":
			return disabled(
				"invalid-effect-value",
				"Frame effect influence value is not valid for this control.",
			);
	}
}

let commitSequence = 0;

const nextCommitKey = (scope: string): string =>
	`inspector-authoring:${scope}:${commitSequence++}`;

/**
 * Just-in-time camera-first guard (Phase P4) for one Inspector keyframe plan.
 * Only an `"upsert"` that writes at least one spatial field (x/y/width/
 * height/rotation, mapped through `inspectorPropertyForField` onto
 * `entities/motion/model/camera-standard.ts`'s shared vocabulary) can
 * provision a camera; removing a keyframe never does, and neither does an
 * opacity-only or anchor-only upsert.
 */
const ensureSceneCameraForInspectorKeyframePlan = (
	plan: Extract<
		InspectorAuthoringPlan,
		{ readonly kind: "motion-keyframe-command" }
	>,
): JustInTimeSceneCameraResult => {
	const isSpatial =
		plan.operation === "upsert" &&
		plan.fields.some((field) =>
			isSpatialAnimatableProperty(inspectorPropertyForField(field)),
		);
	const artboardId = selectArtboardIdForNode(
		useSceneStore.getState().document,
		plan.nodeId,
	);
	if (!artboardId) return { ensured: false };
	return ensureSceneCameraBeforeSpatialAuthoring({ artboardId, isSpatial });
};

/**
 * Applies a previously planned Inspector edit. Scene plans are committed as one
 * transaction; motion plans keep single-channel command coalescing and group
 * multi-channel writes into one motion history entry. A motion-keyframe plan
 * that authors spatial motion on a camera-less artboard first ensures a scene
 * camera (Phase P4 just-in-time supply) and folds its compound id onto this
 * commit, so one undo reverts the camera together with the keyframe(s).
 */
export function executeInspectorAuthoringPlan(
	plan: InspectorAuthoringPlan,
): boolean {
	switch (plan.kind) {
		case "noop":
		case "disabled":
			return false;
		case "scene-command": {
			const before = useSceneStore.getState().document;
			useSceneStore
				.getState()
				.beginTransaction(nextCommitKey(plan.transactionScope), plan.label);
			useSceneStore.getState().apply(plan.command);
			useSceneStore.getState().commit();
			const document = useSceneStore.getState().document;
			const changed = document !== before;
			if (changed && plan.repeatTransformSnapshot) {
				recordNodeTransformRepeat(
					[plan.repeatTransformSnapshot],
					document,
					plan.label,
					{ application: plan.repeatTransformApplication },
				);
			}
			return changed;
		}
		case "motion-keyframe-command": {
			const before = useMotionStore.getState().document;
			const cameraResult = ensureSceneCameraForInspectorKeyframePlan(plan);
			const compoundId = cameraResult.ensured
				? cameraResult.compoundId
				: undefined;
			if (plan.commands.length === 1) {
				const command = plan.commands[0];
				if (!command) return false;
				useMotionStore
					.getState()
					.apply(compoundId ? { ...command, compoundId } : command);
				return useMotionStore.getState().document !== before;
			}
			useMotionStore
				.getState()
				.beginTransaction(plan.transactionScope, plan.label, compoundId);
			for (const command of plan.commands) {
				useMotionStore.getState().apply(command);
			}
			useMotionStore.getState().commit();
			return useMotionStore.getState().document !== before;
		}
	}
}

/**
 * Store-backed bridge used by the Inspector's numeric fields. Delayed commits are
 * guarded against the latest selection and playhead before a scene or motion
 * command reaches either command bus.
 */
export function commitSingleInspectorNumberEdit(
	node: VectorNode,
	recording: boolean,
	keyframeState: { readonly nodeId: string; readonly frame: number },
	field: InspectorMotionField,
	value: number,
	options?: { readonly textBoxResize?: boolean },
): boolean {
	const sceneStore = useSceneStore.getState();
	const motionStore = useMotionStore.getState();
	const selection = useSelectionStore.getState();
	const transport = useTransportStore.getState();
	return executeInspectorAuthoringPlan(
		planInspectorNumberEdit({
			document: sceneStore.document,
			motion: motionStore.document,
			selectedNodeIds: selection.nodeIds,
			primaryNodeId: selection.primary,
			currentFrame: transport.currentFrame,
			recording,
			node,
			field,
			value,
			expectedNodeId: keyframeState.nodeId,
			expectedFrame: keyframeState.frame,
			textBoxResize: options?.textBoxResize,
		}),
	);
}

/**
 * Store-backed bridge for 3x3 pivot presets. The preset writes both anchor axes
 * together so pose compensation is calculated once for the final local point.
 */
export function commitInspectorAnchorPresetEdit(
	node: VectorNode,
	recording: boolean,
	keyframeState: { readonly nodeId: string; readonly frame: number },
	anchor: Vec2,
): boolean {
	const sceneStore = useSceneStore.getState();
	const motionStore = useMotionStore.getState();
	const selection = useSelectionStore.getState();
	const transport = useTransportStore.getState();
	return executeInspectorAuthoringPlan(
		planInspectorAnchorPresetEdit({
			document: sceneStore.document,
			motion: motionStore.document,
			selectedNodeIds: selection.nodeIds,
			primaryNodeId: selection.primary,
			currentFrame: transport.currentFrame,
			recording,
			node,
			anchor,
			expectedNodeId: keyframeState.nodeId,
			expectedFrame: keyframeState.frame,
		}),
	);
}

export type { InspectorKeyframeActionGroup, InspectorMotionField };

/**
 * Store-backed bridge for Inspector diamond buttons. The controller owns stale
 * selection/playhead guarding, while `features/motion` owns command generation.
 */
export function commitInspectorKeyframeEdit(
	fields: readonly InspectorMotionField[],
	expectedNodeId: string,
	expectedFrame: number,
	inspectorValues?: Partial<Record<InspectorMotionField, number | undefined>>,
): boolean {
	const sceneStore = useSceneStore.getState();
	const motionStore = useMotionStore.getState();
	const selection = useSelectionStore.getState();
	const transport = useTransportStore.getState();
	return executeInspectorAuthoringPlan(
		planInspectorKeyframeEdit({
			document: sceneStore.document,
			motion: motionStore.document,
			selectedNodeIds: selection.nodeIds,
			primaryNodeId: selection.primary,
			currentFrame: transport.currentFrame,
			fields,
			inspectorValues,
			expectedNodeId,
			expectedFrame,
		}),
	);
}

/** Store-backed bridge for frame influence mask edits from Inspector surfaces. */
export function commitFrameInfluenceMaskEdit(
	scope: InspectorFrameEffectRecipeScope,
	operation: FrameInfluenceMaskOperation | null,
	artboardId?: string | null,
	label?: string,
): boolean {
	return executeInspectorAuthoringPlan(
		planFrameInfluenceMaskEdit({
			document: useSceneStore.getState().document,
			scope,
			operation,
			artboardId,
			label,
			unavailableReason: operation ? undefined : "missing-effect-assignment",
		}),
	);
}
