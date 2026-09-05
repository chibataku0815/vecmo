/**
 * Keyframe commands for published controls of a linked external production.
 *
 * This file is the Motion half of one published control. The Scene half is the
 * authored static value on `ExternalProductionLink.values`; both halves are
 * addressed by the same `(linkId, controlId)` pair, and a gesture that writes
 * both carries a shared `compoundId` so the cross-store coordinator reverts it
 * as one intent. There is deliberately no new undo mechanism here.
 *
 * Structure mirrors `camera-commands.ts` on purpose: a control is document rig
 * data, not vector geometry, so its keys live in a side-car track instead of a
 * node-keyed `KeyframeTrack` with a sentinel node id.
 */

import { castDraft, type Draft } from "immer";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import type { MotionCommand } from "./command";
import { snapMotionFrame } from "./commands";
import { defaultEasedKeyframe } from "./easing";
import type { MotionDocument, ProductionControlTrack } from "./types";

const PRODUCTION_CONTROL_TRACK_ID_PREFIX = "production-control";

const byTime = (left: AeKeyframe<number>, right: AeKeyframe<number>): number =>
	left.time - right.time;

const coalesceFrame = (frame: number): number =>
	Number.isFinite(frame) ? Math.round(frame) : 0;

const finiteValue = (value: number): number | null =>
	Number.isFinite(value) ? value : null;

const normalizedId = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

/** Deterministic side-car track id for one published control. */
export function productionControlTrackId(
	linkId: string,
	controlId: string,
): string {
	return `${PRODUCTION_CONTROL_TRACK_ID_PREFIX}:${linkId}:${controlId}`;
}

const findTrackByTarget = (
	draft: Draft<MotionDocument>,
	linkId: string,
	controlId: string,
): Draft<ProductionControlTrack> | undefined =>
	draft.productionControlTracks?.find(
		(track) =>
			track.target.linkId === linkId && track.target.controlId === controlId,
	);

const ensureProductionControlTracks = (
	draft: Draft<MotionDocument>,
): Draft<ProductionControlTrack>[] => {
	if (!draft.productionControlTracks) draft.productionControlTracks = [];
	return draft.productionControlTracks as Draft<ProductionControlTrack>[];
};

const upsertProductionControlKeyframeIntoDraft = (
	draft: Draft<MotionDocument>,
	linkId: string,
	controlId: string,
	frame: number,
	value: number,
): boolean => {
	const storedValue = finiteValue(value);
	if (storedValue === null) return false;
	const snapped = snapMotionFrame(frame, draft.durationFrames);
	const existingTrack = findTrackByTarget(draft, linkId, controlId);
	const tracks = ensureProductionControlTracks(draft);
	const track =
		existingTrack ??
		tracks[
			tracks.push({
				id: productionControlTrackId(linkId, controlId),
				target: { linkId, controlId },
				keyframes: [],
			}) - 1
		];
	const existing = track.keyframes.find(
		(keyframe) => keyframe.time === snapped,
	);
	if (existing) {
		if (existing.value === storedValue) return false;
		existing.value = storedValue;
		return true;
	}
	track.keyframes.push(
		castDraft(defaultEasedKeyframe({ time: snapped, value: storedValue })),
	);
	track.keyframes.sort(byTime);
	return true;
};

/**
 * Upserts one published-control keyframe. A zero-patch write (same value at the
 * same frame) leaves the draft untouched, so re-stamping a key the user has not
 * moved does not manufacture a history entry.
 */
export function upsertProductionControlKeyframe(
	linkId: string,
	controlId: string,
	frame: number,
	value: number,
	options: { readonly compoundId?: string } = {},
): MotionCommand {
	const normalizedLinkId = normalizedId(linkId);
	const normalizedControlId = normalizedId(controlId);
	return {
		type: "motion/upsert-production-control-keyframe",
		label: "Set control keyframe",
		coalesceKey: `motion-production-control:${linkId}:${controlId}:${coalesceFrame(frame)}`,
		...(options.compoundId ? { compoundId: options.compoundId } : {}),
		run: (draft) => {
			if (!normalizedLinkId || !normalizedControlId) return;
			upsertProductionControlKeyframeIntoDraft(
				draft,
				normalizedLinkId,
				normalizedControlId,
				frame,
				value,
			);
		},
	};
}

/**
 * Removes one published-control keyframe and drops the channel once its last key
 * is gone, so an emptied control leaves no orphan track behind to widen the
 * build key.
 */
export function removeProductionControlKeyframe(
	linkId: string,
	controlId: string,
	frame: number,
	options: { readonly compoundId?: string } = {},
): MotionCommand {
	const normalizedLinkId = normalizedId(linkId);
	const normalizedControlId = normalizedId(controlId);
	return {
		type: "motion/remove-production-control-keyframe",
		label: "Delete control keyframe",
		coalesceKey: `motion-production-control-remove:${linkId}:${controlId}:${coalesceFrame(frame)}`,
		...(options.compoundId ? { compoundId: options.compoundId } : {}),
		run: (draft) => {
			if (!normalizedLinkId || !normalizedControlId) return;
			const tracks = draft.productionControlTracks;
			if (!tracks) return;
			const trackIndex = tracks.findIndex(
				(track) =>
					track.target.linkId === normalizedLinkId &&
					track.target.controlId === normalizedControlId,
			);
			if (trackIndex < 0) return;
			const snapped = snapMotionFrame(frame, draft.durationFrames);
			const track = tracks[trackIndex];
			const keyIndex = track.keyframes.findIndex(
				(keyframe) => keyframe.time === snapped,
			);
			if (keyIndex < 0) return;
			track.keyframes.splice(keyIndex, 1);
			if (track.keyframes.length === 0) tracks.splice(trackIndex, 1);
			if (tracks.length === 0) draft.productionControlTracks = undefined;
		},
	};
}

/**
 * Retimes one published-control key. A colliding move is dropped rather than
 * merged, which keeps a diamond drag from silently destroying an authored pose.
 */
export function setProductionControlKeyframeTime(
	trackId: string,
	fromFrame: number,
	toFrame: number,
	coalesceKey: string,
): MotionCommand {
	return {
		type: "motion/retime-production-control-keyframe",
		label: "Move control keyframe",
		coalesceKey,
		run: (draft) => {
			const track = draft.productionControlTracks?.find(
				(candidate) => candidate.id === trackId,
			);
			if (!track) return;
			const target = snapMotionFrame(toFrame, draft.durationFrames);
			if (target === fromFrame) return;
			const keyframe = track.keyframes.find((item) => item.time === fromFrame);
			if (!keyframe) return;
			const occupied = track.keyframes.some(
				(item) => item !== keyframe && item.time === target,
			);
			if (occupied) return;
			keyframe.time = target;
			track.keyframes.sort(byTime);
		},
	};
}
