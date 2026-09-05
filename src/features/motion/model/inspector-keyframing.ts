import type { MotionCommand } from "@/entities/motion/model/command";
import { removeKeyframe } from "@/entities/motion/model/commands";
import {
	effectiveOpacity,
	effectiveTransform,
	findTrack,
} from "@/entities/motion/model/sampler";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	type InspectorTransformValues,
	inspectorBoundsForNode,
	inspectorValuesForNode,
	transformWithAnchorPreservingMatrix,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	createMotionKeyframeCommand,
	type MotionScalarAuthoringProperty,
	motionAuthoringFrame,
	sampledMotionScalarValue,
} from "./authoring-commands";

export type InspectorMotionField = keyof InspectorTransformValues;
type InspectorScalarProperty = MotionScalarAuthoringProperty;

export const INSPECTOR_TRANSFORM_KEYFRAME_FIELDS = [
	"x",
	"y",
	"width",
	"height",
	"anchorX",
	"anchorY",
	"rotation",
] as const satisfies readonly InspectorMotionField[];

export const INSPECTOR_OPACITY_KEYFRAME_FIELDS = [
	"opacity",
] as const satisfies readonly InspectorMotionField[];

export const INSPECTOR_KEYFRAME_FIELDS = [
	...INSPECTOR_TRANSFORM_KEYFRAME_FIELDS,
	...INSPECTOR_OPACITY_KEYFRAME_FIELDS,
] as const satisfies readonly InspectorMotionField[];

export type InspectorFieldMotionState = {
	readonly property: InspectorScalarProperty;
	readonly trackId: string | null;
	readonly frame: number;
	readonly animated: boolean;
	readonly keyedAtFrame: boolean;
	readonly upsertAction: "add" | "update";
};

export type InspectorKeyframeFieldStates = {
	readonly [Field in InspectorMotionField]: InspectorFieldMotionState;
};

export type InspectorKeyframeActionGroup = "transform" | "opacity";

export type InspectorKeyframeActionGroupState = {
	readonly fields: readonly InspectorMotionField[];
	readonly keyedFields: readonly InspectorMotionField[];
	readonly missingFields: readonly InspectorMotionField[];
	readonly frame: number;
	readonly animated: boolean;
	readonly someKeyedAtFrame: boolean;
	readonly allKeyedAtFrame: boolean;
	readonly upsertAction: "add" | "update" | "mixed";
};

export type InspectorKeyframeActionGroups = {
	readonly [Group in InspectorKeyframeActionGroup]: InspectorKeyframeActionGroupState;
};

export type InspectorKeyframeUnavailableReason =
	| "no-selection"
	| "stale-selection"
	| "stale-frame"
	| "empty-field-set"
	| "no-key-at-frame"
	| "invalid-value";

export type InspectorKeyframeIssue = {
	readonly reason: InspectorKeyframeUnavailableReason;
	readonly message: string;
};

/**
 * Snapshot of the editor state a future Inspector keyframe control needs. The
 * scene document is still the transform source of truth; this context only
 * resolves the selected node and sampled playhead frame against the side-car
 * motion document.
 */
export type InspectorKeyframeSelectionContext = {
	readonly document: SceneDocument;
	readonly motion: MotionDocument;
	readonly selectedNodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly currentFrame: number;
};

/**
 * UI-facing keyframe control state for the current selection. Unavailable states
 * are explicit so stale selection ids never fall through to motion writes.
 */
export type InspectorKeyframeActionState =
	| {
			readonly status: "ready";
			readonly nodeId: string;
			readonly nodeName: string;
			readonly selectedNodeCount: number;
			readonly frame: number;
			readonly values: InspectorTransformValues;
			readonly fields: InspectorKeyframeFieldStates;
			readonly groups: InspectorKeyframeActionGroups;
			readonly resetKey: string;
	  }
	| {
			readonly status: "unavailable";
			readonly selectedNodeCount: number;
			readonly frame: number;
			readonly issue: InspectorKeyframeIssue;
	  };

/**
 * A guarded authoring request from an Inspector keyframe control. `expected*`
 * values should be copied from {@link InspectorKeyframeActionState}; they prevent
 * a delayed click from writing to a newer selection or playhead frame.
 */
export type InspectorKeyframeCommandRequest =
	InspectorKeyframeSelectionContext & {
		readonly operation?: "upsert" | "remove";
		readonly fields?: readonly InspectorMotionField[];
		readonly inspectorValues?: Partial<
			Record<InspectorMotionField, number | undefined>
		>;
		readonly expectedNodeId?: string;
		readonly expectedFrame?: number;
	};

export type InspectorKeyframeCommandResult =
	| {
			readonly status: "ready";
			readonly operation: "upsert" | "remove";
			readonly nodeId: string;
			readonly frame: number;
			readonly fields: readonly InspectorMotionField[];
			readonly commands: readonly MotionCommand[];
	  }
	| {
			readonly status: "unavailable";
			readonly operation: "upsert" | "remove";
			readonly frame: number;
			readonly issue: InspectorKeyframeIssue;
			readonly commands: readonly [];
	  };

const INSPECTOR_FIELD_PROPERTIES = {
	x: "x",
	y: "y",
	width: "scaleX",
	height: "scaleY",
	anchorX: "anchorX",
	anchorY: "anchorY",
	rotation: "rotation",
	opacity: "opacity",
} as const satisfies Record<InspectorMotionField, InspectorScalarProperty>;

const TRANSFORM_TRACK_PROPERTIES = [
	"x",
	"y",
	"anchorX",
	"anchorY",
	"rotation",
	"scaleX",
	"scaleY",
] as const satisfies readonly InspectorScalarProperty[];

const EPSILON = 1e-6;

const clampOpacity = (value: number): number =>
	Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));

/** Snaps Inspector authoring to the same whole-frame grid used by motion commands. */
export function inspectorKeyframeFrame(
	motion: MotionDocument,
	currentFrame: number,
): number {
	return motionAuthoringFrame(motion, currentFrame);
}

/** Maps an Inspector-facing field to the side-car motion channel it authors. */
export function inspectorPropertyForField(
	field: InspectorMotionField,
): InspectorScalarProperty {
	return INSPECTOR_FIELD_PROPERTIES[field];
}

/**
 * Summarizes a field's timeline state at the playhead so the Inspector can show
 * keyed, animated, and plain scene-edit affordances without reading track shape.
 */
export function inspectorFieldMotionState(
	motion: MotionDocument,
	nodeId: string,
	field: InspectorMotionField,
	currentFrame: number,
): InspectorFieldMotionState {
	const property = inspectorPropertyForField(field);
	const frame = inspectorKeyframeFrame(motion, currentFrame);
	const track = findTrack(motion, nodeId, property);
	const keyedAtFrame =
		track?.keyframes.some((keyframe) => keyframe.time === frame) ?? false;
	return {
		property,
		trackId: track?.id ?? null,
		frame,
		animated: (track?.keyframes.length ?? 0) > 0,
		keyedAtFrame,
		upsertAction: keyedAtFrame ? "update" : "add",
	};
}

const inspectorFieldMotionStates = (
	motion: MotionDocument,
	nodeId: string,
	currentFrame: number,
): InspectorKeyframeFieldStates => ({
	x: inspectorFieldMotionState(motion, nodeId, "x", currentFrame),
	y: inspectorFieldMotionState(motion, nodeId, "y", currentFrame),
	width: inspectorFieldMotionState(motion, nodeId, "width", currentFrame),
	height: inspectorFieldMotionState(motion, nodeId, "height", currentFrame),
	anchorX: inspectorFieldMotionState(motion, nodeId, "anchorX", currentFrame),
	anchorY: inspectorFieldMotionState(motion, nodeId, "anchorY", currentFrame),
	rotation: inspectorFieldMotionState(motion, nodeId, "rotation", currentFrame),
	opacity: inspectorFieldMotionState(motion, nodeId, "opacity", currentFrame),
});

const actionGroupState = (
	fieldStates: InspectorKeyframeFieldStates,
	fields: readonly InspectorMotionField[],
): InspectorKeyframeActionGroupState => {
	const states = fields.map((field) => fieldStates[field]);
	const keyedFields = fields.filter((field) => fieldStates[field].keyedAtFrame);
	const missingFields = fields.filter(
		(field) => !fieldStates[field].keyedAtFrame,
	);
	const upsertAction =
		keyedFields.length === 0
			? "add"
			: missingFields.length === 0
				? "update"
				: "mixed";
	return {
		fields,
		keyedFields,
		missingFields,
		frame: states[0]?.frame ?? 0,
		animated: states.some((state) => state.animated),
		someKeyedAtFrame: states.some((state) => state.keyedAtFrame),
		allKeyedAtFrame:
			states.length > 0 && states.every((state) => state.keyedAtFrame),
		upsertAction,
	};
};

const actionGroups = (
	fieldStates: InspectorKeyframeFieldStates,
): InspectorKeyframeActionGroups => ({
	transform: actionGroupState(fieldStates, INSPECTOR_TRANSFORM_KEYFRAME_FIELDS),
	opacity: actionGroupState(fieldStates, INSPECTOR_OPACITY_KEYFRAME_FIELDS),
});

const keyframeIssue = (
	reason: InspectorKeyframeUnavailableReason,
	message: string,
): InspectorKeyframeIssue => ({ reason, message });

type ResolvedInspectorSelection =
	| {
			readonly status: "ready";
			readonly node: VectorNode;
			readonly selectedNodeCount: number;
	  }
	| {
			readonly status: "unavailable";
			readonly selectedNodeCount: number;
			readonly issue: InspectorKeyframeIssue;
	  };

const resolveInspectorSelection = ({
	document,
	selectedNodeIds,
	primaryNodeId,
}: Pick<
	InspectorKeyframeSelectionContext,
	"document" | "selectedNodeIds" | "primaryNodeId"
>): ResolvedInspectorSelection => {
	if (selectedNodeIds.length === 0) {
		return {
			status: "unavailable",
			selectedNodeCount: 0,
			issue: keyframeIssue(
				"no-selection",
				"Select a node before adding motion keyframes.",
			),
		};
	}

	const nodes = selectedNodeIds
		.map((nodeId) => findNode(document, nodeId))
		.filter((node): node is VectorNode => node !== undefined);
	if (nodes.length === 0) {
		return {
			status: "unavailable",
			selectedNodeCount: 0,
			issue: keyframeIssue(
				"stale-selection",
				"The selected node no longer exists in the scene document.",
			),
		};
	}

	return {
		status: "ready",
		node: nodes.find((node) => node.id === primaryNodeId) ?? nodes[0],
		selectedNodeCount: nodes.length,
	};
};

/**
 * Builds the stable Inspector keyframe state for the selected node and playhead.
 * Later UI can render per-field diamonds or transform/opacity group buttons from
 * this contract without duplicating sampler, selection, or frame snapping logic.
 */
export function inspectorKeyframeActionState(
	context: InspectorKeyframeSelectionContext,
): InspectorKeyframeActionState {
	const frame = inspectorKeyframeFrame(context.motion, context.currentFrame);
	const selection = resolveInspectorSelection(context);
	if (selection.status === "unavailable") {
		return {
			status: "unavailable",
			selectedNodeCount: selection.selectedNodeCount,
			frame,
			issue: selection.issue,
		};
	}

	const fields = inspectorFieldMotionStates(
		context.motion,
		selection.node.id,
		frame,
	);
	return {
		status: "ready",
		nodeId: selection.node.id,
		nodeName: selection.node.name,
		selectedNodeCount: selection.selectedNodeCount,
		frame,
		values: inspectorValuesAtFrame(selection.node, context.motion, frame),
		fields,
		groups: actionGroups(fields),
		resetKey: `motion-keyframe:${selection.node.id}:${frame}`,
	};
}

/**
 * Decides whether an Inspector edit should write timing data instead of mutating
 * the scene rest pose. Recording keys any edited field; an already-animated
 * channel is always edited in MotionDocument so sampled values stay independent
 * from base scene values. Anchor edits also key when any transform track exists:
 * changing the rest anchor under sampled position/scale/rotation tracks would
 * silently reshape the whole animation instead of the visible playhead pose.
 */
export function shouldKeyInspectorField(
	motion: MotionDocument,
	nodeId: string,
	field: InspectorMotionField,
	recording: boolean,
): boolean {
	const property = inspectorPropertyForField(field);
	const animated =
		(findTrack(motion, nodeId, property)?.keyframes.length ?? 0) > 0;
	if (field === "anchorX" || field === "anchorY") {
		const hasTransformMotion = TRANSFORM_TRACK_PROPERTIES.some(
			(trackProperty) =>
				(findTrack(motion, nodeId, trackProperty)?.keyframes.length ?? 0) > 0,
		);
		return recording || animated || hasTransformMotion;
	}
	return recording || animated;
}

/**
 * Clones a scene node with sampled transform/opacity for read-only Inspector
 * presentation. The returned node is never written back to SceneDocument.
 */
export function nodeWithInspectorMotion(
	node: VectorNode,
	motion: MotionDocument,
	currentFrame: number,
): VectorNode {
	const frame = inspectorKeyframeFrame(motion, currentFrame);
	return {
		...node,
		transform: effectiveTransform(node, motion, frame),
		style: {
			...node.style,
			opacity: effectiveOpacity(node, motion, frame),
		},
	};
}

/** Returns the Inspector values that match the sampled canvas pose at a frame. */
export function inspectorValuesAtFrame(
	node: VectorNode,
	motion: MotionDocument,
	currentFrame: number,
): InspectorTransformValues {
	return inspectorValuesForNode(
		nodeWithInspectorMotion(node, motion, currentFrame),
	);
}

const sampledChannelValue = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	property: InspectorScalarProperty,
): number => sampledMotionScalarValue(node, motion, frame, property);

const channelValueFromInspectorValue = (
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	field: InspectorMotionField,
	value: number,
): number => {
	const bounds = inspectorBoundsForNode(node);
	const transform = effectiveTransform(node, motion, frame);
	switch (field) {
		case "x":
			return value - bounds.x;
		case "y":
			return value - bounds.y;
		case "width":
			return bounds.width === 0 ? transform.scale.x : value / bounds.width;
		case "height":
			return bounds.height === 0 ? transform.scale.y : value / bounds.height;
		case "anchorX":
			return value;
		case "anchorY":
			return value;
		case "rotation":
			return value;
		case "opacity":
			return clampOpacity(value);
	}
};

/**
 * Creates the motion command for a single Inspector field. When `inspectorValue`
 * is omitted, the current sampled channel is keyed; when provided, the UI value
 * is converted back to the motion channel value before authoring.
 */
export function createInspectorFieldKeyframeCommand({
	node,
	motion,
	currentFrame,
	field,
	inspectorValue,
}: {
	readonly node: VectorNode;
	readonly motion: MotionDocument;
	readonly currentFrame: number;
	readonly field: InspectorMotionField;
	readonly inspectorValue?: number;
}): MotionCommand | null {
	if (inspectorValue !== undefined && !Number.isFinite(inspectorValue)) {
		return null;
	}
	const frame = inspectorKeyframeFrame(motion, currentFrame);
	const property = inspectorPropertyForField(field);
	const value =
		inspectorValue === undefined
			? sampledChannelValue(node, motion, frame, property)
			: channelValueFromInspectorValue(
					node,
					motion,
					frame,
					field,
					inspectorValue,
				);
	return createMotionKeyframeCommand({
		node,
		motion,
		currentFrame: frame,
		property,
		value,
	});
}

const createPositionCompensationCommand = ({
	node,
	motion,
	frame,
	property,
	value,
}: {
	readonly node: VectorNode;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly property: "x" | "y";
	readonly value: number;
}): MotionCommand | null =>
	createMotionKeyframeCommand({
		node,
		motion,
		currentFrame: frame,
		property,
		value,
	});

const createInspectorFieldKeyframeCommands = ({
	node,
	motion,
	currentFrame,
	field,
	inspectorValue,
}: {
	readonly node: VectorNode;
	readonly motion: MotionDocument;
	readonly currentFrame: number;
	readonly field: InspectorMotionField;
	readonly inspectorValue?: number;
}): readonly MotionCommand[] | null => {
	const command = createInspectorFieldKeyframeCommand({
		node,
		motion,
		currentFrame,
		field,
		inspectorValue,
	});
	if (!command) return null;
	if (
		inspectorValue === undefined ||
		(field !== "anchorX" && field !== "anchorY")
	) {
		return [command];
	}
	const frame = inspectorKeyframeFrame(motion, currentFrame);
	const transform = effectiveTransform(node, motion, frame);
	const nextTransform = transformWithAnchorPreservingMatrix(transform, {
		x: field === "anchorX" ? inspectorValue : transform.anchor.x,
		y: field === "anchorY" ? inspectorValue : transform.anchor.y,
	});
	const commands: MotionCommand[] = [command];
	if (Math.abs(nextTransform.position.x - transform.position.x) > EPSILON) {
		const xCommand = createPositionCompensationCommand({
			node,
			motion,
			frame,
			property: "x",
			value: nextTransform.position.x,
		});
		if (xCommand) commands.push(xCommand);
	}
	if (Math.abs(nextTransform.position.y - transform.position.y) > EPSILON) {
		const yCommand = createPositionCompensationCommand({
			node,
			motion,
			frame,
			property: "y",
			value: nextTransform.position.y,
		});
		if (yCommand) commands.push(yCommand);
	}
	return commands;
};

const isAnchorField = (
	field: InspectorMotionField,
): field is "anchorX" | "anchorY" => field === "anchorX" || field === "anchorY";

const createInspectorAnchorKeyframeCommands = ({
	node,
	motion,
	currentFrame,
	fields,
	inspectorValues,
}: {
	readonly node: VectorNode;
	readonly motion: MotionDocument;
	readonly currentFrame: number;
	readonly fields: readonly ("anchorX" | "anchorY")[];
	readonly inspectorValues: Partial<
		Record<InspectorMotionField, number | undefined>
	>;
}): readonly MotionCommand[] | null => {
	const frame = inspectorKeyframeFrame(motion, currentFrame);
	const transform = effectiveTransform(node, motion, frame);
	const nextAnchor = {
		x: inspectorValues.anchorX ?? transform.anchor.x,
		y: inspectorValues.anchorY ?? transform.anchor.y,
	};
	const commands: MotionCommand[] = [];
	for (const field of fields) {
		const inspectorValue = inspectorValues[field];
		if (inspectorValue === undefined) continue;
		const command = createInspectorFieldKeyframeCommand({
			node,
			motion,
			currentFrame: frame,
			field,
			inspectorValue,
		});
		if (!command) return null;
		commands.push(command);
	}
	if (commands.length === 0) return null;
	const nextTransform = transformWithAnchorPreservingMatrix(
		transform,
		nextAnchor,
	);
	if (Math.abs(nextTransform.position.x - transform.position.x) > EPSILON) {
		const xCommand = createPositionCompensationCommand({
			node,
			motion,
			frame,
			property: "x",
			value: nextTransform.position.x,
		});
		if (xCommand) commands.push(xCommand);
	}
	if (Math.abs(nextTransform.position.y - transform.position.y) > EPSILON) {
		const yCommand = createPositionCompensationCommand({
			node,
			motion,
			frame,
			property: "y",
			value: nextTransform.position.y,
		});
		if (yCommand) commands.push(yCommand);
	}
	return commands;
};

const normalizedKeyframeFields = (
	fields: readonly InspectorMotionField[] | undefined,
): readonly InspectorMotionField[] =>
	fields === undefined ? INSPECTOR_KEYFRAME_FIELDS : [...new Set(fields)];

const unavailableCommandResult = (
	frame: number,
	issue: InspectorKeyframeIssue,
	operation: "upsert" | "remove",
): InspectorKeyframeCommandResult => ({
	status: "unavailable",
	operation,
	frame,
	issue,
	commands: [],
});

/**
 * Creates guarded motion commands for the currently selected node. The helper is
 * intentionally store-free: the Inspector can apply the returned commands with
 * the motion command bus, while tests can verify stale selection and frame
 * guards without React or Zustand plumbing.
 */
export function createInspectorKeyframeActionCommands(
	request: InspectorKeyframeCommandRequest,
): InspectorKeyframeCommandResult {
	const frame = inspectorKeyframeFrame(request.motion, request.currentFrame);
	const operation = request.operation ?? "upsert";
	const selection = resolveInspectorSelection(request);
	if (selection.status === "unavailable") {
		return unavailableCommandResult(frame, selection.issue, operation);
	}
	if (
		request.expectedNodeId !== undefined &&
		request.expectedNodeId !== selection.node.id
	) {
		return unavailableCommandResult(
			frame,
			keyframeIssue(
				"stale-selection",
				"The Inspector keyframe target changed before the action committed.",
			),
			operation,
		);
	}
	if (
		request.expectedFrame !== undefined &&
		inspectorKeyframeFrame(request.motion, request.expectedFrame) !== frame
	) {
		return unavailableCommandResult(
			frame,
			keyframeIssue(
				"stale-frame",
				"The playhead moved before the Inspector keyframe action committed.",
			),
			operation,
		);
	}

	const fields = normalizedKeyframeFields(request.fields);
	if (fields.length === 0) {
		return unavailableCommandResult(
			frame,
			keyframeIssue(
				"empty-field-set",
				"Choose at least one Inspector field before adding keyframes.",
			),
			operation,
		);
	}

	const commands: MotionCommand[] = [];
	const combinedAnchorFields: readonly ("anchorX" | "anchorY")[] =
		operation === "remove" || request.inspectorValues === undefined
			? []
			: fields.filter(
					(field): field is "anchorX" | "anchorY" =>
						isAnchorField(field) &&
						request.inspectorValues?.[field] !== undefined,
				);
	if (combinedAnchorFields.length > 0 && request.inspectorValues) {
		const anchorCommands = createInspectorAnchorKeyframeCommands({
			node: selection.node,
			motion: request.motion,
			currentFrame: frame,
			fields: combinedAnchorFields,
			inspectorValues: request.inspectorValues,
		});
		if (!anchorCommands) {
			return unavailableCommandResult(
				frame,
				keyframeIssue(
					"invalid-value",
					"Inspector keyframes require finite numeric field values.",
				),
				operation,
			);
		}
		commands.push(...anchorCommands);
	}
	if (operation === "remove") {
		for (const field of fields) {
			const state = inspectorFieldMotionState(
				request.motion,
				selection.node.id,
				field,
				frame,
			);
			if (!state.trackId || !state.keyedAtFrame) {
				return unavailableCommandResult(
					frame,
					keyframeIssue(
						"no-key-at-frame",
						"Remove requires an existing keyframe at the Inspector playhead.",
					),
					operation,
				);
			}
			commands.push(removeKeyframe(state.trackId, frame));
		}
		return {
			status: "ready",
			operation,
			nodeId: selection.node.id,
			frame,
			fields,
			commands,
		};
	}

	for (const field of fields) {
		if (isAnchorField(field) && combinedAnchorFields.includes(field)) {
			continue;
		}
		const inspectorValue = request.inspectorValues?.[field];
		const fieldCommands = createInspectorFieldKeyframeCommands({
			node: selection.node,
			motion: request.motion,
			currentFrame: frame,
			field,
			inspectorValue,
		});
		if (!fieldCommands) {
			return unavailableCommandResult(
				frame,
				keyframeIssue(
					"invalid-value",
					"Inspector keyframes require finite numeric field values.",
				),
				operation,
			);
		}
		commands.push(...fieldCommands);
	}

	return {
		status: "ready",
		operation,
		nodeId: selection.node.id,
		frame,
		fields,
		commands,
	};
}
