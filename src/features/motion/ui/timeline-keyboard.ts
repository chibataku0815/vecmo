import type { TimelineRow } from "./timeline-adapter";
import {
	isCameraSelectedKey,
	isNodeSelectedKey,
	isSourceOpticsSelectedKey,
	isTextAnimatorOffsetSelectedKey,
	resolveSelectedKeyInRows,
	selectedTimelineKeyForRowFrame,
	snapTimelineFrame,
} from "./timeline-adapter";
import type { SelectedKey } from "./timeline-model";

const DEFAULT_LARGE_STEP_FRAMES = 10;
const EDITABLE_TAG_NAMES = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const NATIVE_ACTIVATION_TAG_NAMES = new Set(["BUTTON", "A", "SUMMARY"]);

type TimelineKeyboardEventLike = {
	readonly key: string;
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly shiftKey?: boolean;
	readonly defaultPrevented?: boolean;
	readonly target?: EventTarget | null;
};

type TargetLike = {
	readonly nodeName?: string;
	readonly isContentEditable?: boolean;
	readonly getAttribute?: (name: string) => string | null;
	readonly closest?: (selector: string) => unknown | null;
};

export type TimelineKeyDirection = "previous" | "next";

export type TimelineTransportKeyboardAction =
	| { readonly type: "toggle-play" }
	| { readonly type: "step-frame"; readonly deltaFrames: number }
	| { readonly type: "jump-frame"; readonly frame: "start" | "end" };

export type TimelineKeyKeyboardAction =
	| {
			readonly type: "select-adjacent-key";
			readonly direction: TimelineKeyDirection;
	  }
	| { readonly type: "retime-selected-key"; readonly deltaFrames: number }
	| { readonly type: "delete-selected-key" };

type KeyboardStepOptions = {
	readonly largeStepFrames?: number;
};

type AdjacentKeyRequest = {
	readonly rows: readonly TimelineRow[];
	readonly selectedKey: SelectedKey | null;
	readonly currentFrame: number;
	readonly direction: TimelineKeyDirection;
};

const normalizedTagName = (target: TargetLike | null): string | null =>
	typeof target?.nodeName === "string" ? target.nodeName.toUpperCase() : null;

const targetLike = (
	target: EventTarget | null | undefined,
): TargetLike | null =>
	target && typeof target === "object" ? (target as TargetLike) : null;

const hasClosest = (target: TargetLike, selector: string): boolean =>
	typeof target.closest === "function" &&
	target.closest(selector) !== null &&
	target.closest(selector) !== undefined;

const allowsTimelineShortcutActivation = (target: TargetLike): boolean =>
	target.getAttribute?.("data-timeline-shortcuts") === "true" ||
	hasClosest(target, "[data-timeline-shortcuts='true']");

const frameStep = (options: KeyboardStepOptions, shiftKey?: boolean): number =>
	shiftKey ? (options.largeStepFrames ?? DEFAULT_LARGE_STEP_FRAMES) : 1;

const platformModified = (event: TimelineKeyboardEventLike): boolean =>
	event.metaKey === true || event.ctrlKey === true;

const sameSelectedKey = (left: SelectedKey, right: SelectedKey): boolean => {
	if (
		isTextAnimatorOffsetSelectedKey(left) ||
		isTextAnimatorOffsetSelectedKey(right)
	) {
		return (
			isTextAnimatorOffsetSelectedKey(left) &&
			isTextAnimatorOffsetSelectedKey(right) &&
			left.bindingId === right.bindingId &&
			left.selectorIndex === right.selectorIndex &&
			left.frame === right.frame
		);
	}
	if (
		left.trackId !== right.trackId ||
		left.property !== right.property ||
		left.frame !== right.frame
	) {
		return false;
	}
	if (isCameraSelectedKey(left) || isCameraSelectedKey(right)) {
		return (
			isCameraSelectedKey(left) &&
			isCameraSelectedKey(right) &&
			left.cameraRigId === right.cameraRigId
		);
	}
	if (isSourceOpticsSelectedKey(left) || isSourceOpticsSelectedKey(right)) {
		return (
			isSourceOpticsSelectedKey(left) &&
			isSourceOpticsSelectedKey(right) &&
			left.nodeId === right.nodeId
		);
	}
	if (!isNodeSelectedKey(left) || !isNodeSelectedKey(right)) return false;
	return left.nodeId === right.nodeId;
};

/**
 * Keeps timeline shortcuts away from text entry surfaces while still allowing
 * arrow-based timeline navigation to bubble from keyframe buttons.
 */
export function shouldIgnoreTimelineKeyboardEvent(
	event: TimelineKeyboardEventLike,
	target: EventTarget | null | undefined = event.target,
): boolean {
	if (event.defaultPrevented === true) return true;
	const candidate = targetLike(target);
	if (!candidate) return false;
	const tagName = normalizedTagName(candidate);
	if (tagName && EDITABLE_TAG_NAMES.has(tagName)) return true;
	if (candidate.isContentEditable === true) return true;
	const contentEditable = candidate.getAttribute?.("contenteditable");
	if (contentEditable === "true" || contentEditable === "plaintext-only") {
		return true;
	}
	if (
		hasClosest(
			candidate,
			"input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']",
		)
	) {
		return true;
	}
	if (event.key !== " " && event.key !== "Spacebar" && event.key !== "Enter") {
		return false;
	}
	if (tagName && NATIVE_ACTIVATION_TAG_NAMES.has(tagName)) {
		return !allowsTimelineShortcutActivation(candidate);
	}
	return (
		hasClosest(candidate, "button, a[href], summary") &&
		!allowsTimelineShortcutActivation(candidate)
	);
}

/**
 * Maps timeline-surface transport keys to scene-free transport actions. The
 * caller applies the action through the transport store so this helper remains
 * deterministic and testable without React.
 */
export function timelineTransportKeyboardAction(
	event: TimelineKeyboardEventLike,
	options: KeyboardStepOptions = {},
): TimelineTransportKeyboardAction | null {
	if (shouldIgnoreTimelineKeyboardEvent(event) || platformModified(event)) {
		return null;
	}
	if (event.key === " " || event.key === "Spacebar") {
		return event.altKey || event.shiftKey ? null : { type: "toggle-play" };
	}
	if (event.altKey) return null;
	if (event.key === "ArrowLeft" || event.key === "PageUp") {
		return {
			type: "step-frame",
			deltaFrames: -frameStep(options, event.shiftKey),
		};
	}
	if (event.key === "ArrowRight" || event.key === "PageDown") {
		return {
			type: "step-frame",
			deltaFrames: frameStep(options, event.shiftKey),
		};
	}
	if (!event.shiftKey && event.key === "Home") {
		return { type: "jump-frame", frame: "start" };
	}
	if (!event.shiftKey && event.key === "End") {
		return { type: "jump-frame", frame: "end" };
	}
	return null;
}

/**
 * Maps keys that operate on visible timeline keyframes. These are intentionally
 * timeline-local so global editor shortcuts and canvas Space-pan keep their
 * current ownership.
 */
export function timelineKeyKeyboardAction(
	event: TimelineKeyboardEventLike,
	options: KeyboardStepOptions = {},
): TimelineKeyKeyboardAction | null {
	if (shouldIgnoreTimelineKeyboardEvent(event) || platformModified(event)) {
		return null;
	}
	if (event.altKey && event.key === "ArrowLeft") {
		return {
			type: "retime-selected-key",
			deltaFrames: -frameStep(options, event.shiftKey),
		};
	}
	if (event.altKey && event.key === "ArrowRight") {
		return {
			type: "retime-selected-key",
			deltaFrames: frameStep(options, event.shiftKey),
		};
	}
	if (!event.altKey && event.shiftKey && event.key === "ArrowLeft") {
		return { type: "select-adjacent-key", direction: "previous" };
	}
	if (!event.altKey && event.shiftKey && event.key === "ArrowRight") {
		return { type: "select-adjacent-key", direction: "next" };
	}
	if (!event.altKey && !event.shiftKey && event.key === "[") {
		return { type: "select-adjacent-key", direction: "previous" };
	}
	if (!event.altKey && !event.shiftKey && event.key === "]") {
		return { type: "select-adjacent-key", direction: "next" };
	}
	if (!event.altKey && (event.key === "{" || event.key === "}")) {
		return {
			type: "select-adjacent-key",
			direction: event.key === "{" ? "previous" : "next",
		};
	}
	if (
		!event.altKey &&
		!event.shiftKey &&
		(event.key === "Delete" || event.key === "Backspace")
	) {
		return { type: "delete-selected-key" };
	}
	return null;
}

/** Resolves a transport keyboard action into an in-range MotionDocument frame. */
export function resolveTimelineTransportFrame(
	action: TimelineTransportKeyboardAction,
	currentFrame: number,
	durationFrames: number,
): number | null {
	if (action.type === "toggle-play") return null;
	if (action.type === "jump-frame") {
		return action.frame === "start"
			? 0
			: snapTimelineFrame(durationFrames, durationFrames);
	}
	return snapTimelineFrame(
		Math.round(Number.isFinite(currentFrame) ? currentFrame : 0) +
			action.deltaFrames,
		durationFrames,
	);
}

/** Returns the selected key's clamped target frame for keyboard retiming. */
export function retimedTimelineSelectedKeyFrame(
	selectedKey: SelectedKey | null,
	deltaFrames: number,
	durationFrames: number,
): number | null {
	if (!selectedKey || !Number.isFinite(deltaFrames) || deltaFrames === 0) {
		return null;
	}
	const target = snapTimelineFrame(
		selectedKey.frame + deltaFrames,
		durationFrames,
	);
	return target === selectedKey.frame ? null : target;
}

/**
 * Finds the previous or next visible key. If no key is selected, navigation
 * starts from the playhead so keyboard users can enter key selection without a
 * mouse click.
 */
export function adjacentTimelineKey({
	rows,
	selectedKey,
	currentFrame,
	direction,
}: AdjacentKeyRequest): SelectedKey | null {
	const keys = rows
		.flatMap((row, rowIndex) =>
			row.keyframes.flatMap((keyframe) => {
				const selected = selectedTimelineKeyForRowFrame(row, keyframe.time);
				return selected ? [{ selected, rowIndex }] : [];
			}),
		)
		.sort((left, right) => {
			if (left.selected.frame !== right.selected.frame) {
				return left.selected.frame - right.selected.frame;
			}
			return left.rowIndex - right.rowIndex;
		})
		.map((item) => item.selected);
	if (keys.length === 0) return null;
	const resolved = resolveSelectedKeyInRows(selectedKey, rows);
	if (resolved) {
		const index = keys.findIndex((key) => sameSelectedKey(key, resolved));
		if (index < 0) return null;
		const targetIndex = direction === "next" ? index + 1 : index - 1;
		return keys[targetIndex] ?? null;
	}
	const frame = Math.round(Number.isFinite(currentFrame) ? currentFrame : 0);
	if (direction === "next") {
		return keys.find((key) => key.frame >= frame) ?? null;
	}
	return keys.findLast((key) => key.frame <= frame) ?? null;
}
