import { useRef } from "react";
import { useTransportStore } from "../model/transport-store";
import { frameToPercent } from "./timeline-model";
import { useTimelineScrub } from "./use-timeline-scrub";

type TimelinePlayheadLineProps = {
	readonly durationFrames: number;
};

/**
 * One vertical playhead line segment, rendered INSIDE a lane's flex-1 region so it
 * tracks that lane's own content (clip chips, keyframe diamonds) and never decouples
 * from the lane's scrollbar. It stays `pointer-events-none` so a click on the line
 * falls through to the lane's own scrub. Each timeline lane renders exactly one; stacked
 * vertically they read as a single continuous playhead, capped by the one grabbable head
 * in the {@link TimelineRulerStrip} above. The head — not these segments — is the only
 * eventful, draggable part of the playhead.
 */
export function TimelinePlayheadLine({
	durationFrames,
}: TimelinePlayheadLineProps) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	return (
		<div
			className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-danger"
			style={{ left: `${frameToPercent(currentFrame, durationFrames)}%` }}
		/>
	);
}

type TimelineRulerStripProps = {
	readonly durationFrames: number;
	readonly fps: number;
	/** Draw the fps-based second-tick ruler (the canonical timeline ruler). */
	readonly renderTicks?: boolean;
};

/**
 * The single timecode ruler / scrub strip that sits above every lane. It owns the ONE
 * grabbable playhead head for the whole timeline — living in its own thin band above the
 * lanes so the head never overlaps clip chips, trim handles, or keyframe diamonds in any
 * body view, and so "grab the head" works regardless of which body view is shown.
 *
 * It mirrors each lane's `[w-56 gutter][flex-1 lane]` flex layout (no hard-coded gutter
 * width) so the head and the per-lane {@link TimelinePlayheadLine}s line up pixel-exact.
 * The strip-lane is the timeline's only eventful playhead surface: clicking it seeks,
 * dragging it scrubs, and grabbing the head captures the pointer ON the strip-lane so a
 * drag keeps scrubbing even as the cursor moves down over the (click-through) body lanes.
 * Seeking reuses {@link useTimelineScrub} — transport-only, undo-free, pauses playback.
 */
export function TimelineRulerStrip({
	durationFrames,
	fps,
	renderTicks = false,
}: TimelineRulerStripProps) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const laneRef = useRef<HTMLDivElement>(null);
	const scrub = useTimelineScrub({ laneRef, durationFrames });
	const secondCount = fps > 0 ? Math.floor(durationFrames / fps) : 0;
	const ticks = Array.from({ length: secondCount + 1 }, (_, second) => second);
	const roundedFrame = Math.round(currentFrame);

	return (
		<div className="flex h-6 shrink-0 border-white/10 border-b">
			<div className="w-56 shrink-0 border-white/10 border-r" />
			<div
				ref={laneRef}
				className="relative min-w-0 flex-1 cursor-pointer touch-none select-none bg-black/15"
				onPointerDown={scrub.onScrubPointerDown}
				onPointerMove={scrub.onScrubPointerMove}
				onPointerUp={scrub.onScrubPointerUp}
				onPointerCancel={scrub.onScrubPointerUp}
				onLostPointerCapture={scrub.onScrubPointerUp}
			>
				{renderTicks
					? ticks.map((second) => (
							<div
								key={second}
								className="pointer-events-none absolute top-0 bottom-0 border-white/[0.06] border-l pl-1 text-fg-subtle text-ui"
								style={{
									left: `${frameToPercent(second * fps, durationFrames)}%`,
								}}
							>
								{second}s
							</div>
						))
					: null}
				<div
					className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-danger"
					style={{ left: `${frameToPercent(currentFrame, durationFrames)}%` }}
				>
					<div
						role="slider"
						tabIndex={0}
						aria-label="Playhead"
						aria-valuemin={0}
						aria-valuemax={durationFrames}
						aria-valuenow={roundedFrame}
						aria-valuetext={`Frame ${roundedFrame} of ${durationFrames}`}
						onPointerDown={(event) => {
							event.stopPropagation();
							scrub.onScrubPointerDown(event);
						}}
						className="-translate-x-1/2 pointer-events-auto absolute top-0 h-full w-3 cursor-ew-resize rounded-sm bg-danger outline-none focus-visible:ring-1 focus-visible:ring-white/80"
					/>
				</div>
			</div>
		</div>
	);
}
