import {
	ArrowsLeftRight,
	Minus,
	Pause,
	Play,
	Plus,
} from "@phosphor-icons/react";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useRef,
} from "react";
import { cn } from "@/shared/lib/cn";
import { frameFromClientX } from "@/shared/lib/timeline-scrub";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";

/**
 * Frames nudged per stepper tap. Deliberately coarser than the `stroke-draw-on`
 * catalog's own per-frame step (1) — a 1-frame tap would be nearly invisible on
 * a compact touch surface, so this control moves in a small, human-scale chunk
 * instead of mirroring the catalog's fine-grained authoring step.
 */
const DURATION_STEP_FRAMES = 5;

/**
 * iPad-scale button recipe for this transport, matching the non-danger states of
 * `conversionHudButtonClass` (`IpadConversionHud.tsx`) and `ipadQuickbarButtonClass`
 * (`IpadAuthoringQuickbar.tsx`) — kept as its own small copy since neither helper
 * is exported, same as those two files already do for each other.
 */
const transportButtonClass = (active = false): string =>
	cn(
		"grid size-10 shrink-0 place-items-center rounded-md border text-ui transition",
		active
			? "border-accent bg-accent-surface text-accent-fg"
			: "border-hairline/10 bg-hairline/5 text-fg-secondary",
		"hover:border-accent/40 hover:bg-accent-surface/55 hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
	);

/** Same defensive pointer-capture guard `IpadQuickMenu.tsx` uses for its drag gesture. */
const safelyCapturePointer = (element: Element, pointerId: number): void => {
	if (!("setPointerCapture" in element)) return;
	try {
		element.setPointerCapture(pointerId);
	} catch {
		// Synthetic or already-released pointers can throw; the gesture still
		// works without capture since the move/up handlers stay bound to the lane.
	}
};

const safelyReleasePointer = (element: Element, pointerId: number): void => {
	if (
		!("hasPointerCapture" in element) ||
		!("releasePointerCapture" in element) ||
		!element.hasPointerCapture(pointerId)
	) {
		return;
	}
	try {
		element.releasePointerCapture(pointerId);
	} catch {
		// See safelyCapturePointer.
	}
};

/**
 * iPad Pencil-motion loop L6 — "iPad timeline minimum": a compact, canvas-docked
 * transport to play/pause/scrub the motion a Pencil gesture just created, and to
 * shorten/lengthen/reverse a `stroke-draw-on` reveal, without opening the full
 * desktop timeline panel (`widgets/timeline`, which stays available and unchanged).
 *
 * Purely presentational, like `IpadConversionHud`/`IpadAuthoringQuickbar`: it reads
 * nothing from any store and dispatches nothing itself. Every value arrives as a
 * prop and every effect happens through the callback props the widget layer
 * (`CanvasShell`) supplies, wired there to `useTransportStore` (play/scrub) and
 * `useMotionGrammarStore` (duration/reverse, through the command bus).
 *
 * `totalFrames` (the scrub lane's range — the whole motion document's length) and
 * `duration` (this one draw-on binding's own reveal length, in frames) are
 * deliberately different numbers; do not conflate them. `duration`/`reverse`
 * travel together and are both omitted by the caller when no `stroke-draw-on`
 * binding exists yet, which hides the stepper and the reverse toggle entirely.
 */
export function IpadMotionTransport({
	currentFrame,
	totalFrames,
	isPlaying,
	duration,
	reverse,
	onTogglePlay,
	onScrubToFrame,
	onChangeDuration,
	onToggleReverse,
	style,
}: {
	readonly currentFrame: number;
	readonly totalFrames: number;
	readonly isPlaying: boolean;
	/** The active draw-on reveal's length in frames. Omit (with `reverse`) to hide the duration/reverse controls. */
	readonly duration?: number;
	/** The active draw-on reveal's direction. Omit alongside `duration`. */
	readonly reverse?: boolean;
	readonly onTogglePlay: () => void;
	readonly onScrubToFrame: (frame: number) => void;
	readonly onChangeDuration?: (frames: number) => void;
	readonly onToggleReverse?: () => void;
	readonly style: CSSProperties;
}) {
	const laneRef = useRef<HTMLDivElement>(null);
	const scrubbingRef = useRef(false);

	const seekToClientX = (clientX: number): void => {
		const lane = laneRef.current;
		if (!lane) return;
		onScrubToFrame(
			frameFromClientX(clientX, lane.getBoundingClientRect(), totalFrames, {
				round: true,
			}),
		);
	};

	const onLanePointerDown = (
		event: ReactPointerEvent<HTMLDivElement>,
	): void => {
		scrubbingRef.current = true;
		safelyCapturePointer(event.currentTarget, event.pointerId);
		seekToClientX(event.clientX);
	};

	const onLanePointerMove = (
		event: ReactPointerEvent<HTMLDivElement>,
	): void => {
		if (!scrubbingRef.current) return;
		seekToClientX(event.clientX);
	};

	const onLanePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
		scrubbingRef.current = false;
		safelyReleasePointer(event.currentTarget, event.pointerId);
	};

	const roundedFrame = Math.round(currentFrame);
	const playheadPercent =
		totalFrames > 0
			? Math.min(100, Math.max(0, (roundedFrame / totalFrames) * 100))
			: 0;

	return (
		<TooltipProvider>
			<div
				className="pointer-events-auto absolute flex items-center gap-1.5 rounded-lg border border-hairline/10 bg-surface-raised/96 p-1.5 text-fg shadow-2xl shadow-scrim/45 backdrop-blur-xl"
				onPointerDown={(event) => event.stopPropagation()}
				style={style}
			>
				<Tooltip label={isPlaying ? "Pause" : "Play"} side="top">
					<button
						type="button"
						aria-label={isPlaying ? "Pause" : "Play"}
						aria-pressed={isPlaying}
						className={transportButtonClass(isPlaying)}
						onClick={onTogglePlay}
					>
						{isPlaying ? (
							<Pause aria-hidden="true" size={18} />
						) : (
							<Play aria-hidden="true" size={18} />
						)}
					</button>
				</Tooltip>
				<div
					ref={laneRef}
					role="slider"
					aria-label="Scrub"
					aria-valuemin={0}
					aria-valuemax={totalFrames}
					aria-valuenow={roundedFrame}
					aria-valuetext={`Frame ${roundedFrame} of ${totalFrames}`}
					tabIndex={0}
					className="relative h-10 w-36 shrink-0 cursor-pointer touch-none select-none rounded-md border border-hairline/10 bg-hairline/5"
					onPointerDown={onLanePointerDown}
					onPointerMove={onLanePointerMove}
					onPointerUp={onLanePointerUp}
					onPointerCancel={onLanePointerUp}
					onLostPointerCapture={onLanePointerUp}
				>
					<div
						aria-hidden="true"
						className="-translate-x-1/2 pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-accent"
						style={{ left: `${playheadPercent}%` }}
					/>
				</div>
				<span className="whitespace-nowrap px-0.5 font-mono text-fg-secondary text-ui tabular-nums">
					{roundedFrame} / {totalFrames}
				</span>
				{duration !== undefined &&
				reverse !== undefined &&
				onChangeDuration &&
				onToggleReverse ? (
					<>
						<span
							aria-hidden="true"
							className="mx-0.5 h-6 w-px shrink-0 bg-hairline/20"
						/>
						<Tooltip label="Shorten the draw-on reveal" side="top">
							<button
								type="button"
								aria-label="Shorten draw-on reveal"
								className={transportButtonClass()}
								onClick={() =>
									onChangeDuration(duration - DURATION_STEP_FRAMES)
								}
							>
								<Minus aria-hidden="true" size={18} />
							</button>
						</Tooltip>
						<span className="min-w-8 whitespace-nowrap text-center font-mono text-fg-secondary text-ui tabular-nums">
							{Math.round(duration)}
						</span>
						<Tooltip label="Lengthen the draw-on reveal" side="top">
							<button
								type="button"
								aria-label="Lengthen draw-on reveal"
								className={transportButtonClass()}
								onClick={() =>
									onChangeDuration(duration + DURATION_STEP_FRAMES)
								}
							>
								<Plus aria-hidden="true" size={18} />
							</button>
						</Tooltip>
						<Tooltip label="Reverse the draw-on direction" side="top">
							<button
								type="button"
								aria-label="Reverse draw-on direction"
								aria-pressed={reverse}
								className={transportButtonClass(reverse)}
								onClick={onToggleReverse}
							>
								<ArrowsLeftRight aria-hidden="true" size={18} />
							</button>
						</Tooltip>
					</>
				) : null}
			</div>
		</TooltipProvider>
	);
}
