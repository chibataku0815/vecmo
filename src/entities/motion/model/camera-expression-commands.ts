/**
 * Undoable commands for the camera-rig channel expression seam.
 *
 * Structure mirrors `camera-commands.ts` and `production-control-commands.ts`:
 * the address is `(cameraRigId, channel)`, one expression per channel, and the
 * side-car disappears entirely once its last row is gone so an emptied document
 * serializes byte-identically to one that never had an expression.
 *
 * The command takes an already-parsed {@link ExpressionSource}. Parsing lives in
 * {@link parseCameraChannelExpression} so exactly one place decides that this
 * surface admits `control()` references — a surface that cannot resolve controls
 * must not be able to store a node it would fail to evaluate.
 */

import { castDraft, type Draft } from "immer";
import { CAMERA_CHANNEL_EXPR_VARS } from "@/entities/scene/model/camera-channel-expression";
import {
	type ExpressionSource,
	type ParseResult,
	parseExpression,
} from "@/shared/expr-dsl";
import type { MotionCommand } from "./command";
import type {
	CameraChannelExpression,
	CameraRigAnimatableProperty,
	MotionDocument,
} from "./types";

/**
 * Parses authoring text for a camera channel. `control()` is admitted because
 * camera sampling receives a published-control resolver; `value` is the sampled
 * base of the channel being bound.
 */
export function parseCameraChannelExpression(source: string): ParseResult {
	return parseExpression(source, CAMERA_CHANNEL_EXPR_VARS, {
		allowControlReferences: true,
	});
}

const readExpressions = (
	draft: Draft<MotionDocument>,
): readonly CameraChannelExpression[] => draft.cameraChannelExpressions ?? [];

const isRow = (
	row: CameraChannelExpression,
	cameraRigId: string,
	channel: CameraRigAnimatableProperty,
): boolean => row.cameraRigId === cameraRigId && row.channel === channel;

/** Sets or replaces the expression bound to one camera-rig channel. */
export function setCameraChannelExpression(
	cameraRigId: string,
	channel: CameraRigAnimatableProperty,
	expr: ExpressionSource,
	options: { readonly compoundId?: string } = {},
): MotionCommand {
	return {
		type: "motion/set-camera-channel-expression",
		label: "Bind camera channel to code",
		coalesceKey: `motion-camera-expression:${cameraRigId}:${channel}`,
		...(options.compoundId ? { compoundId: options.compoundId } : {}),
		run: (draft) => {
			const next = readExpressions(draft).filter(
				(row) => !isRow(row, cameraRigId, channel),
			);
			next.push({ cameraRigId, channel, expr });
			draft.cameraChannelExpressions = castDraft(next);
		},
	};
}

/** Clears the expression on one camera-rig channel. Missing rows are no-ops. */
export function removeCameraChannelExpression(
	cameraRigId: string,
	channel: CameraRigAnimatableProperty,
	options: { readonly compoundId?: string } = {},
): MotionCommand {
	return {
		type: "motion/remove-camera-channel-expression",
		label: "Clear camera channel code",
		coalesceKey: `motion-camera-expression-remove:${cameraRigId}:${channel}`,
		...(options.compoundId ? { compoundId: options.compoundId } : {}),
		run: (draft) => {
			const existing = readExpressions(draft);
			const next = existing.filter((row) => !isRow(row, cameraRigId, channel));
			if (next.length === existing.length) return;
			draft.cameraChannelExpressions =
				next.length > 0 ? castDraft(next) : undefined;
		},
	};
}
