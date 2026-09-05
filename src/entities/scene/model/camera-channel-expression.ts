/**
 * Evaluation of the optional camera-rig channel expression seam.
 *
 * A scene-camera rig is a non-node sidecar, so this is deliberately NOT
 * `NativeExpressionBinding` with a rig id smuggled into `nodeId`, and the value
 * is NOT written back as a camera keyframe. The expression composes over the
 * value camera sampling already produced, exactly the way Codeable Native
 * composes over a node's sampled scalar:
 *
 * - `value` is the base (authored static channel, or its keyframe track sample),
 * - `control("id")` reaches published controls of a linked external production,
 * - an expression that yields no usable number returns the BASE value plus a
 *   typed issue, never `0`. A fabricated zero on `focusDistance` or `fovDegrees`
 *   would silently re-frame the shot.
 *
 * The lookup index is built once per resolution pass rather than scanned per
 * channel, because `sampledCameraRig` asks for thirteen channels per frame.
 *
 * It lives in `entities/scene` next to `scene-camera.ts` — the owner of camera
 * sampling — even though the stored rows hang off `MotionDocument`, because the
 * responsibility graph forbids `entities/scene` from importing values out of
 * `entities/motion`. The row TYPE crosses as a type-only import, which is inert.
 */

import type {
	CameraChannelExpression,
	CameraRigAnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import {
	type ExprEvalIssue,
	type ExprVarName,
	evaluateExprResult,
	expressionFrameTime,
} from "@/shared/expr-dsl";
import type { ProductionControlSampler } from "./production-control";

/**
 * Variables a camera-channel expression may read. Identical to Effect/Native
 * Code: per-instance fan-out (`i`/`count`/`seed`) has no meaning for a rig that
 * exists exactly once per frame.
 */
export const CAMERA_CHANNEL_EXPR_VARS = [
	"time",
	"frame",
	"value",
] as const satisfies readonly ExprVarName[];

/** Deterministic address for the one-expression-per-rig-channel model. */
export const cameraChannelExpressionKey = (
	cameraRigId: string,
	channel: CameraRigAnimatableProperty,
): string => `${channel}@camera:${cameraRigId}`;

/**
 * Per-frame evaluation context. `controls` is injected rather than imported so
 * camera sampling never learns what a linked production is — the same discipline
 * `NativeExpressionFrameContext` uses.
 */
export type CameraChannelExpressionContext = {
	readonly time: number;
	readonly frame: number;
	readonly controls?: (controlId: string) => number | undefined;
};

/** Resolved lookup for one document, safe to hold across a resolution pass. */
export type CameraChannelExpressionIndex = {
	readonly isEmpty: boolean;
	readonly has: (
		cameraRigId: string,
		channel: CameraRigAnimatableProperty,
	) => boolean;
	readonly get: (
		cameraRigId: string,
		channel: CameraRigAnimatableProperty,
	) => CameraChannelExpression | undefined;
};

const EMPTY_INDEX: CameraChannelExpressionIndex = {
	isEmpty: true,
	has: () => false,
	get: () => undefined,
};

/**
 * Admits one stored row. The check is shallow on purpose: the AST walker is
 * total over the closed node union, bounded by its own step budget, and always
 * returns a finite number, so a corrupted tree degrades instead of escaping —
 * the same posture `evaluateNativeExpression` takes. Full structural
 * re-admission belongs at the deserialization boundary for ALL expression
 * side-cars at once, not per frame inside the exported runtime.
 */
const admittedRow = (
	row: CameraChannelExpression,
): CameraChannelExpression | null =>
	typeof row?.cameraRigId === "string" &&
	row.cameraRigId.length > 0 &&
	row.expr?.ast !== undefined
		? row
		: null;

export const createCameraChannelExpressionIndex = (
	motion: MotionDocument,
): CameraChannelExpressionIndex => {
	const rows = motion.cameraChannelExpressions;
	if (!rows || rows.length === 0) return EMPTY_INDEX;
	const byKey = new Map<string, CameraChannelExpression>();
	for (const row of rows) {
		const admitted = admittedRow(row);
		if (!admitted) continue;
		byKey.set(
			cameraChannelExpressionKey(admitted.cameraRigId, admitted.channel),
			admitted,
		);
	}
	if (byKey.size === 0) return EMPTY_INDEX;
	return {
		isEmpty: byKey.size === 0,
		has: (cameraRigId, channel) =>
			byKey.has(cameraChannelExpressionKey(cameraRigId, channel)),
		get: (cameraRigId, channel) =>
			byKey.get(cameraChannelExpressionKey(cameraRigId, channel)),
	};
};

/**
 * Applies one channel expression over its base value. Returns the base value
 * unchanged when there is no expression, when the context is absent, or when
 * evaluation failed — the issue rides alongside so an authoring surface can say
 * WHY the channel did not move.
 */
export const applyCameraChannelExpression = (
	expression: CameraChannelExpression | undefined,
	baseValue: number,
	context: CameraChannelExpressionContext | undefined,
): { readonly value: number; readonly issue?: ExprEvalIssue } => {
	if (!expression || !context) return { value: baseValue };
	const result = evaluateExprResult(expression.expr.ast, {
		time: context.time,
		frame: context.frame,
		value: baseValue,
		i: 0,
		count: 1,
		seed: 0,
		...(context.controls ? { controls: context.controls } : {}),
	});
	if (!result.ok) return { value: baseValue, issue: result.issue };
	return Number.isFinite(result.value)
		? { value: result.value }
		: { value: baseValue };
};

/** Index plus per-frame context, or `undefined` when the document has none. */
export type CameraExpressionPass = {
	readonly index: CameraChannelExpressionIndex;
	readonly context: CameraChannelExpressionContext;
};

/**
 * Builds one evaluation pass for a frame, or `undefined` when the document has
 * no camera expression at all (the overwhelmingly common case, which then costs
 * nothing).
 *
 * The published-control sampler is INJECTED, never constructed here. That is the
 * same discipline `MotionPresentationInput.controls` follows and it is
 * load-bearing twice over: camera sampling never imports the linked-production
 * contract, and the exported standalone runtime — which does not inject a
 * sampler — does not carry a link parser it would never call. Without a sampler
 * every `control()` reference is unresolved, so the channel keeps its base value.
 */
export const createCameraExpressionPass = (
	motion: MotionDocument,
	frame: number,
	controls?: ProductionControlSampler,
): CameraExpressionPass | undefined => {
	const index = createCameraChannelExpressionIndex(motion);
	if (index.isEmpty) return undefined;
	return {
		index,
		context: {
			time: expressionFrameTime(frame, motion.fps),
			frame,
			...(controls
				? { controls: (controlId: string) => controls(controlId, frame) }
				: {}),
		},
	};
};
