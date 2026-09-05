import type { PointerEvent, RefObject } from "react";
import { useRef } from "react";
import { frameFromClientX } from "@/shared/lib/timeline-scrub";
import { useTransportStore } from "../model/transport-store";

type UseTimelineScrubArgs = {
	/** The stable lane element the pointer is captured on (never a keyed child). */
	readonly laneRef: RefObject<HTMLDivElement | null>;
	/** Document length the click maps into — each view passes ITS canonical duration. */
	readonly durationFrames: number;
	/**
	 * When this returns true a higher-priority gesture (clip trim / keyframe retime)
	 * owns the pointer, so a scrub move stands down. Views with no competing gesture
	 * omit it.
	 */
	readonly isOtherGestureActive?: () => boolean;
};

export type TimelineScrubHandlers = {
	readonly onScrubPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
	readonly onScrubPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
	readonly onScrubPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
	/** True while a scrub gesture is live (the view's move handler can branch on it). */
	readonly isScrubbing: () => boolean;
};

/**
 * The single seek path shared by all three timeline views. A press anywhere on a lane
 * background — or on the grabbable playhead head — pauses playback and moves the
 * transport playhead to the pointed frame; dragging scrubs continuously.
 *
 * It writes ONLY the transport store (`pause` + `setFrame`) and opens no transaction,
 * so seeking is ephemeral: it never pushes an undo entry and never mints an auto-key
 * (auto-key reacts to scene-document edits, which a seek does not touch). `pause()`
 * runs before `setFrame` so the rAF playback loop — started/stopped by the canvas
 * driver's `isPlaying` subscription — stops co-writing `currentFrame`.
 *
 * Pointer capture is taken on the STABLE lane element (never the keyed head or a
 * per-frame diamond, both of which remount mid-drag) with the project's proven guards:
 * ref-first, `try/catch` (synthetic events can throw), release guarded by
 * `hasPointerCapture`.
 */
export function useTimelineScrub({
	laneRef,
	durationFrames,
	isOtherGestureActive,
}: UseTimelineScrubArgs): TimelineScrubHandlers {
	const scrubbingRef = useRef(false);

	const seekTo = (clientX: number): void => {
		const lane = laneRef.current;
		if (!lane) return;
		useTransportStore
			.getState()
			.setFrame(
				frameFromClientX(clientX, lane.getBoundingClientRect(), durationFrames),
			);
	};

	const onScrubPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
		const lane = laneRef.current;
		if (!lane) return;
		useTransportStore.getState().pause();
		seekTo(event.clientX);
		try {
			lane.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic or already-released pointers can throw; the gesture still works
			// without capture because the move handlers stay bound to the lane.
		}
		scrubbingRef.current = true;
	};

	const onScrubPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
		if (!scrubbingRef.current) return;
		if (isOtherGestureActive?.()) return;
		seekTo(event.clientX);
	};

	const onScrubPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
		scrubbingRef.current = false;
		const lane = laneRef.current;
		if (lane?.hasPointerCapture(event.pointerId)) {
			lane.releasePointerCapture(event.pointerId);
		}
	};

	return {
		onScrubPointerDown,
		onScrubPointerMove,
		onScrubPointerUp,
		isScrubbing: () => scrubbingRef.current,
	};
}
