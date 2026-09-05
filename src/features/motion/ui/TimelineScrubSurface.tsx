import type { ReactNode } from "react";
import { useRef } from "react";
import { cn } from "@/shared/lib/cn";
import { TimelinePlayheadLine } from "./TimelinePlayhead";
import { frameToPercent } from "./timeline-model";
import { useTimelineScrub } from "./use-timeline-scrub";

type TimelineScrubSurfaceProps = {
	readonly durationFrames: number;
	readonly fps: number;
	/** Draw the fps-based second-tick ruler (full-height guide lines + labels). */
	readonly renderTicks?: boolean;
	readonly className?: string;
	/** Lane content (e.g. a clip bar), absolutely positioned over the surface. */
	readonly children?: ReactNode;
};

/**
 * A self-contained clickable timeline lane: it owns its own lane ref + the scrub hook
 * (no competing gesture here), renders an optional fps-correct ruler, the caller's
 * {@link children} over the lane, and the playhead with its grabbable head. Used by
 * views that have no pre-existing pointer gesture of their own (the motion-system clip
 * view). Views that already multiplex a drag on their lane (clip trim, keyframe retime)
 * compose {@link useTimelineScrub} + {@link TimelinePlayheadHead} into their own lane
 * instead of nesting this surface.
 */
export function TimelineScrubSurface({
	durationFrames,
	fps,
	renderTicks = false,
	className,
	children,
}: TimelineScrubSurfaceProps) {
	const laneRef = useRef<HTMLDivElement>(null);
	const scrub = useTimelineScrub({ laneRef, durationFrames });
	const secondCount = fps > 0 ? Math.floor(durationFrames / fps) : 0;
	const ticks = Array.from({ length: secondCount + 1 }, (_, second) => second);

	return (
		<div
			ref={laneRef}
			className={cn(
				"relative touch-none cursor-pointer select-none",
				className,
			)}
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
			{children}
			<TimelinePlayheadLine durationFrames={durationFrames} />
		</div>
	);
}
