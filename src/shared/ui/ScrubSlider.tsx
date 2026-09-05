import {
	type KeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/shared/lib/cn";
import {
	clamp,
	formatScrubValue,
	quantizeToRange,
	scrubFraction,
	snapToNeutral,
} from "./scrub-math";

/** Sentinel a multi-selection passes when its nodes disagree on this value. */
export const SCRUB_MIXED = "mixed" as const;

/** Half-width (px) of the bipolar center-detent capture zone around neutral. */
const DETENT_PX = 3;
/** Fine-scrub gain while Shift is held; coarse gain while Cmd/Ctrl is held. */
const FINE_GAIN = 0.2;
const COARSE_GAIN = 3;

export type ScrubSliderProps = {
	readonly label: string;
	/** Current value in DISPLAYED units, or {@link SCRUB_MIXED} for a mixed selection. */
	readonly value: number | typeof SCRUB_MIXED;
	readonly min: number;
	readonly max: number;
	/** Default/rest value; the fill diverges from here and double-click resets to it. */
	readonly neutral: number;
	readonly step: number;
	/** Bipolar tracks (e.g. Exposure) get a center-detent snap at neutral; others do not. */
	readonly bipolar?: boolean;
	readonly unit?: string;
	readonly disabled?: boolean;
	readonly format?: (value: number) => string;
	/** Optional trailing inspector action, such as keyframe or code binding. */
	readonly action?: ReactNode;
	/** Opens the coalesced drag gesture (host begins one held undo transaction). */
	readonly onScrubStart: () => void;
	/** Live drag tick — host applies into the open transaction (no history entry yet). */
	readonly onScrub: (value: number) => void;
	/** Seals the gesture as exactly one undo entry. */
	readonly onScrubEnd: () => void;
	/** A single discrete commit (double-click reset, keyboard nudge, typed value). */
	readonly onCommitValue: (value: number) => void;
};

/**
 * A compact, token-styled scrub slider for the editor inspector. Drag the track
 * (absolute: the thumb follows the cursor; Shift = fine, Cmd/Ctrl = coarse),
 * double-click the label to reset to neutral, arrow-key to nudge, or type an exact
 * value in the inline readout.
 *
 * Undo contract (load-bearing): a drag emits onScrubStart → many onScrub →
 * onScrubEnd, which the host maps to ONE held command-bus transaction = one undo
 * entry. onScrub ticks are rAF-coalesced, so on release we MUST
 * cancel the pending frame, flush the final value synchronously, THEN call
 * onScrubEnd — otherwise a stale frame applies after the transaction closes and
 * lands a second, un-coalesced history entry. The gesture is sealed on pointerup,
 * pointercancel, lost capture, window blur, and unmount so a held transaction can
 * never leak. Discrete edits (reset/nudge/type) use onCommitValue, each its own
 * undo entry, and keyboard auto-repeat is dropped so a held arrow cannot flood.
 */
export function ScrubSlider({
	label,
	value,
	min,
	max,
	neutral,
	step,
	bipolar = false,
	unit,
	disabled = false,
	format,
	action,
	onScrubStart,
	onScrub,
	onScrubEnd,
	onCommitValue,
}: ScrubSliderProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const rawValueRef = useRef(0);
	const lastXRef = useRef(0);
	const rafRef = useRef<number | null>(null);
	const pendingRef = useRef<number | null>(null);
	const draggingRef = useRef(false);
	const [dragValue, setDragValue] = useState<number | null>(null);
	const [draft, setDraft] = useState<string | null>(null);
	// Discard an uncommitted readout draft the moment the value changes underneath
	// us (a drag, preset, or reset) — the "adjust state during render" pattern.
	const [lastValue, setLastValue] = useState(value);
	if (value !== lastValue) {
		setLastValue(value);
		setDraft(null);
	}

	const isMixed = value === SCRUB_MIXED;
	const displayValue = dragValue ?? (isMixed ? null : value);

	const flushRaf = () => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (pendingRef.current !== null) {
			onScrub(pendingRef.current);
			pendingRef.current = null;
		}
	};

	const scheduleRaf = (next: number) => {
		pendingRef.current = next;
		if (rafRef.current !== null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			if (pendingRef.current !== null) {
				onScrub(pendingRef.current);
				pendingRef.current = null;
			}
		});
	};

	const resolveDisplay = (raw: number): number => {
		const quantized = quantizeToRange(raw, min, max, step);
		if (!bipolar) return quantized;
		const width = trackRef.current?.getBoundingClientRect().width ?? 0;
		const tolerance = width > 0 ? (DETENT_PX / width) * (max - min) : 0;
		return snapToNeutral(quantized, neutral, tolerance);
	};

	const endGesture = () => {
		if (!draggingRef.current) return;
		flushRaf();
		draggingRef.current = false;
		setDragValue(null);
		onScrubEnd();
	};

	// Hold the latest sealer so the mount-only listener below always closes over
	// current callbacks without resubscribing every render.
	const sealRef = useRef(endGesture);
	sealRef.current = endGesture;

	// Seal the gesture if the window loses focus mid-drag, and on unmount, so a
	// held command-bus transaction can never leak past a missed pointer release.
	useEffect(() => {
		const seal = () => sealRef.current();
		window.addEventListener("blur", seal);
		return () => {
			window.removeEventListener("blur", seal);
			sealRef.current();
		};
	}, []);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (disabled || event.button !== 0) return;
		const track = trackRef.current;
		if (!track) return;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return;
		track.setPointerCapture(event.pointerId);
		const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
		rawValueRef.current = min + fraction * (max - min);
		lastXRef.current = event.clientX;
		draggingRef.current = true;
		const next = resolveDisplay(rawValueRef.current);
		setDragValue(next);
		onScrubStart();
		scheduleRaf(next);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return;
		const gain = event.shiftKey
			? FINE_GAIN
			: event.metaKey || event.ctrlKey
				? COARSE_GAIN
				: 1;
		const delta =
			((event.clientX - lastXRef.current) / rect.width) * (max - min);
		lastXRef.current = event.clientX;
		rawValueRef.current = clamp(rawValueRef.current + delta * gain, min, max);
		const next = resolveDisplay(rawValueRef.current);
		setDragValue(next);
		scheduleRaf(next);
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (trackRef.current?.hasPointerCapture(event.pointerId)) {
			trackRef.current.releasePointerCapture(event.pointerId);
		}
		endGesture();
	};

	const nudge = (next: number) => {
		onCommitValue(quantizeToRange(next, min, max, step));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (disabled || event.repeat) return;
		const base = displayValue ?? neutral;
		const coarse = event.shiftKey ? step * 10 : step;
		if (event.key === "ArrowRight" || event.key === "ArrowUp") {
			event.preventDefault();
			nudge(base + coarse);
		} else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
			event.preventDefault();
			nudge(base - coarse);
		} else if (event.key === "Home") {
			event.preventDefault();
			nudge(min);
		} else if (event.key === "End") {
			event.preventDefault();
			nudge(max);
		}
	};

	const commitDraft = () => {
		if (draft === null) return;
		const parsed = Number.parseFloat(draft);
		setDraft(null);
		if (Number.isFinite(parsed))
			onCommitValue(quantizeToRange(parsed, min, max, step));
	};

	const onReadoutKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
		} else if (event.key === "Escape") {
			event.preventDefault();
			setDraft(null);
			event.currentTarget.blur();
		}
	};

	const valueFraction =
		displayValue === null ? null : scrubFraction(displayValue, min, max);
	const neutralFraction = scrubFraction(neutral, min, max);
	const fillLeft =
		valueFraction === null ? 0 : Math.min(neutralFraction, valueFraction);
	const fillWidth =
		valueFraction === null ? 0 : Math.abs(valueFraction - neutralFraction);

	const readoutText =
		draft ??
		(displayValue === null
			? ""
			: format
				? format(displayValue)
				: formatScrubValue(displayValue, step, unit));

	return (
		<div
			className={cn(
				"grid h-6 items-center gap-1.5 text-ui",
				action
					? "grid-cols-[4.25rem_1fr_2.75rem_1.5rem]"
					: "grid-cols-[4.25rem_1fr_2.75rem]",
				disabled && "opacity-45",
			)}
		>
			<button
				type="button"
				disabled={disabled}
				onDoubleClick={() => {
					if (!disabled) onCommitValue(neutral);
				}}
				title={`${label} — double-click to reset`}
				className="min-w-0 truncate text-left text-fg-muted disabled:cursor-not-allowed"
			>
				{label}
			</button>

			<div
				ref={trackRef}
				role="slider"
				tabIndex={disabled ? -1 : 0}
				aria-label={label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={displayValue ?? undefined}
				aria-valuetext={isMixed ? "Mixed" : undefined}
				aria-disabled={disabled || undefined}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onLostPointerCapture={onPointerUp}
				onKeyDown={onKeyDown}
				className={cn(
					"group relative h-4 rounded-full outline-none",
					disabled ? "cursor-not-allowed" : "cursor-ew-resize",
				)}
			>
				{/* Rail */}
				<div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/8 group-focus-visible:ring-1 group-focus-visible:ring-accent/70" />
				{/* Mixed indicator */}
				{isMixed && dragValue === null ? (
					<div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/5" />
				) : null}
				{/* Neutral tick */}
				<div
					className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg-subtle/60"
					style={{ left: `${neutralFraction * 100}%` }}
				/>
				{/* Fill (diverges from neutral) */}
				{valueFraction === null ? null : (
					<div
						className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
						style={{
							left: `${fillLeft * 100}%`,
							width: `${fillWidth * 100}%`,
						}}
					/>
				)}
				{/* Thumb */}
				{valueFraction === null ? null : (
					<div
						className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2.5 rounded-full border border-accent bg-fg shadow-sm"
						style={{ left: `${valueFraction * 100}%` }}
					/>
				)}
			</div>

			<input
				type="text"
				inputMode="decimal"
				disabled={disabled}
				value={readoutText}
				placeholder={isMixed ? "Mixed" : ""}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onFocus={(event) => event.currentTarget.select()}
				onBlur={commitDraft}
				onKeyDown={onReadoutKeyDown}
				className="h-5 w-full rounded border border-white/10 bg-black/25 px-1 text-right font-mono text-fg text-ui tabular-nums outline-none transition placeholder:text-fg-subtle focus:border-accent/70 disabled:cursor-not-allowed"
			/>
			{action ? <div className="flex justify-end">{action}</div> : null}
		</div>
	);
}
