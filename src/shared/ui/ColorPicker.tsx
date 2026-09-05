import { Eyedropper } from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type Hsv,
	hexToRgb,
	hsvToRgb,
	normalizeHex,
	type Rgb,
	rgbToHex,
	rgbToHsv,
} from "@/shared/color";
import { useColorRecents } from "@/shared/color/recents";
import { cn } from "@/shared/lib/cn";
import { RadixSwatchPicker } from "@/shared/ui/RadixSwatchPicker";

/**
 * A capable, in-app color picker matching the editor's dark token system: a
 * saturation/value plane, hue (and optional alpha) sliders, hex + RGB fields,
 * recents, fixed swatches, and a screen eyedropper (where supported).
 *
 * It is a controlled, presentational primitive — it never touches the scene
 * store. The host owns undo: a continuous drag streams {@link onChange} ticks
 * (the host applies them under one coalesced transaction) bracketed by
 * {@link onGestureStart}/{@link onGestureEnd}; discrete edits (hex/RGB entry,
 * swatch, eyedropper, clear) go through {@link onCommit} as their own undo
 * entry. Committed output is always lowercase `#rrggbb` (or `none` via
 * {@link onClear}); alpha rides its own channel, never the hex string.
 *
 * HSV is held authoritatively while open so the SV/hue cursor never jumps at
 * the gray/black degeneracies; it is re-seeded from `value` only on external
 * change (not mid-drag) and on explicit hex/RGB entry.
 */
export type ColorPickerProps = {
	/** Current color: lowercase `#rrggbb`, `"none"`, or null (empty). */
	readonly value: string | null;
	/** True for a multi-selection with differing colors — render "Mixed", commit nothing on open. */
	readonly mixed?: boolean;
	/** Re-seeds internal HSV when it changes (e.g. selection switches). */
	readonly resetKey?: string;
	readonly disabled?: boolean;
	/** Live drag tick — host applies into the open coalesced transaction. */
	readonly onChange: (hex: string) => void;
	/** Discrete commit — host applies as one undo entry; return false to reject (resets the hex draft). */
	readonly onCommit: (hex: string) => boolean;
	/** Opens the host's per-gesture coalesce key. */
	readonly onGestureStart?: () => void;
	/** Closes the host's per-gesture coalesce key. */
	readonly onGestureEnd?: () => void;
	/** Shows an explicit no-fill control (fill/stroke); omit where `none` is invalid (artboard bg, stops). */
	readonly allowNone?: boolean;
	readonly onClear?: () => boolean;
	/** Opacity 0..1. Present only where the surface bundles opacity (gradient/mesh). */
	readonly alpha?: number;
	readonly onAlphaChange?: (alpha: number) => void;
	readonly onAlphaEnd?: () => void;
};

type EyeDropperResult = { readonly sRGBHex: string };
type EyeDropperConstructor = new () => {
	open: () => Promise<EyeDropperResult>;
};

const getEyeDropper = (): EyeDropperConstructor | null => {
	if (typeof window === "undefined" || !("EyeDropper" in window)) return null;
	return (window as unknown as { EyeDropper: EyeDropperConstructor })
		.EyeDropper;
};

const DEFAULT_HEX = "#ffffff";
const SV_HEIGHT_PX = 152;
const CHANNEL_MAX = 255;
const HUE_MAX = 360;
const PERCENT = 100;
const KEY_STEP = 0.01;
const KEY_STEP_LARGE = 0.1;
const HUE_KEY_STEP = 2;
const HUE_KEY_STEP_LARGE = 20;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const rgbToCss = (rgb: Rgb): string => `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;

const formatChannel = (value: number): string => String(Math.round(value));

type Frac = { readonly x: number; readonly y: number };

/**
 * A pointer-drag surface that rAF-coalesces live ticks and seals on every exit
 * path (pointer up/cancel/lost-capture, window blur, unmount) so a host
 * transaction can never leak. Pointer capture is guarded (it can throw on
 * synthetic events) and ref-first, so a failed capture still drives the drag.
 */
function useDragSurface(opts: {
	readonly disabled?: boolean;
	readonly onStart: (frac: Frac) => void;
	readonly onMove: (frac: Frac) => void;
	readonly onEnd: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const rafRef = useRef<number | null>(null);
	const pendingRef = useRef<Frac | null>(null);
	const optsRef = useRef(opts);
	optsRef.current = opts;

	const fracFromEvent = (event: ReactPointerEvent<HTMLDivElement>): Frac => {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
		return {
			x: clamp01((event.clientX - rect.left) / rect.width),
			y: clamp01((event.clientY - rect.top) / rect.height),
		};
	};

	const flush = () => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (pendingRef.current !== null) {
			optsRef.current.onMove(pendingRef.current);
			pendingRef.current = null;
		}
	};

	const schedule = (frac: Frac) => {
		pendingRef.current = frac;
		if (rafRef.current !== null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			if (pendingRef.current !== null) {
				optsRef.current.onMove(pendingRef.current);
				pendingRef.current = null;
			}
		});
	};

	const endGesture = () => {
		if (!draggingRef.current) return;
		flush();
		draggingRef.current = false;
		optsRef.current.onEnd();
	};

	const sealRef = useRef(endGesture);
	sealRef.current = endGesture;

	useEffect(() => {
		const seal = () => sealRef.current();
		window.addEventListener("blur", seal);
		return () => {
			window.removeEventListener("blur", seal);
			sealRef.current();
		};
	}, []);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (optsRef.current.disabled || event.button !== 0) return;
		const element = ref.current;
		if (!element) return;
		try {
			element.setPointerCapture(event.pointerId);
		} catch {
			// Capture can throw on synthetic events; the ref-first dragging flag
			// below keeps the drag working without it.
		}
		draggingRef.current = true;
		optsRef.current.onStart(fracFromEvent(event));
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		schedule(fracFromEvent(event));
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		try {
			if (ref.current?.hasPointerCapture(event.pointerId)) {
				ref.current.releasePointerCapture(event.pointerId);
			}
		} catch {
			// Releasing a capture that never landed is harmless.
		}
		endGesture();
	};

	return {
		ref,
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp,
			onLostPointerCapture: onPointerUp,
		},
	};
}

function SvArea({
	hsv,
	disabled,
	indeterminate,
	onStart,
	onMove,
	onEnd,
	onKeyAdjust,
}: {
	readonly hsv: Hsv;
	readonly disabled?: boolean;
	readonly indeterminate: boolean;
	readonly onStart: (s: number, v: number) => void;
	readonly onMove: (s: number, v: number) => void;
	readonly onEnd: () => void;
	readonly onKeyAdjust: (s: number, v: number) => void;
}) {
	const { ref, handlers } = useDragSurface({
		disabled,
		onStart: (frac) => onStart(frac.x, 1 - frac.y),
		onMove: (frac) => onMove(frac.x, 1 - frac.y),
		onEnd,
	});

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (disabled || event.repeat) return;
		const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
		if (event.key === "ArrowRight") onKeyAdjust(clamp01(hsv.s + step), hsv.v);
		else if (event.key === "ArrowLeft")
			onKeyAdjust(clamp01(hsv.s - step), hsv.v);
		else if (event.key === "ArrowUp") onKeyAdjust(hsv.s, clamp01(hsv.v + step));
		else if (event.key === "ArrowDown")
			onKeyAdjust(hsv.s, clamp01(hsv.v - step));
		else return;
		event.preventDefault();
	};

	const hueCss = rgbToCss(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

	return (
		<div
			ref={ref}
			role="slider"
			aria-label="Saturation and brightness"
			aria-valuemin={0}
			aria-valuemax={PERCENT}
			aria-valuenow={Math.round(hsv.s * PERCENT)}
			aria-valuetext={
				indeterminate
					? "Mixed"
					: `Saturation ${Math.round(hsv.s * PERCENT)}%, brightness ${Math.round(hsv.v * PERCENT)}%`
			}
			aria-disabled={disabled || undefined}
			tabIndex={disabled ? -1 : 0}
			onKeyDown={onKeyDown}
			{...handlers}
			className={cn(
				"relative w-full touch-none overflow-hidden rounded-sm outline-none ring-accent/70 focus-visible:ring-1",
				disabled ? "cursor-not-allowed" : "cursor-crosshair",
			)}
			style={{ height: `${SV_HEIGHT_PX}px`, backgroundColor: hueCss }}
		>
			<div
				className="absolute inset-0"
				style={{
					backgroundImage: "linear-gradient(to right, #fff, transparent)",
				}}
			/>
			<div
				className="absolute inset-0"
				style={{
					backgroundImage: "linear-gradient(to top, #000, transparent)",
				}}
			/>
			{indeterminate ? null : (
				<div
					className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute size-3 rounded-full border-2 border-white"
					style={{
						left: `${hsv.s * PERCENT}%`,
						top: `${(1 - hsv.v) * PERCENT}%`,
						boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
					}}
				/>
			)}
		</div>
	);
}

function LinearTrack({
	label,
	fraction,
	disabled,
	trackStyle,
	trackClassName,
	overlayStyle,
	valueText,
	step,
	stepLarge,
	max,
	onStart,
	onMove,
	onEnd,
	onKeyAdjust,
}: {
	readonly label: string;
	readonly fraction: number;
	readonly disabled?: boolean;
	readonly trackStyle?: React.CSSProperties;
	readonly trackClassName?: string;
	/** A pointer-transparent gradient layer drawn over the track background (below the thumb). */
	readonly overlayStyle?: React.CSSProperties;
	readonly valueText: string;
	readonly step: number;
	readonly stepLarge: number;
	readonly max: number;
	readonly onStart: (fraction: number) => void;
	readonly onMove: (fraction: number) => void;
	readonly onEnd: () => void;
	readonly onKeyAdjust: (value: number) => void;
}) {
	const { ref, handlers } = useDragSurface({
		disabled,
		onStart: (frac) => onStart(frac.x),
		onMove: (frac) => onMove(frac.x),
		onEnd,
	});

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (disabled || event.repeat) return;
		const delta = event.shiftKey ? stepLarge : step;
		const current = fraction * max;
		if (event.key === "ArrowRight" || event.key === "ArrowUp")
			onKeyAdjust(Math.min(max, current + delta));
		else if (event.key === "ArrowLeft" || event.key === "ArrowDown")
			onKeyAdjust(Math.max(0, current - delta));
		else if (event.key === "Home") onKeyAdjust(0);
		else if (event.key === "End") onKeyAdjust(max);
		else return;
		event.preventDefault();
	};

	return (
		<div
			ref={ref}
			role="slider"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={Math.round(fraction * max)}
			aria-valuetext={valueText}
			aria-disabled={disabled || undefined}
			tabIndex={disabled ? -1 : 0}
			onKeyDown={onKeyDown}
			{...handlers}
			className={cn(
				"relative h-3 w-full touch-none rounded-full outline-none ring-accent/70 focus-visible:ring-1",
				disabled ? "cursor-not-allowed" : "cursor-ew-resize",
				trackClassName,
			)}
			style={trackStyle}
		>
			{overlayStyle ? (
				<div
					className="pointer-events-none absolute inset-0 rounded-full"
					style={overlayStyle}
				/>
			) : null}
			<div
				className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 size-3.5 rounded-full border-2 border-white"
				style={{
					left: `${fraction * PERCENT}%`,
					boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
				}}
			/>
		</div>
	);
}

const fieldClass =
	"h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 font-mono text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45";

export function ColorPicker({
	value,
	mixed = false,
	resetKey,
	disabled = false,
	onChange,
	onCommit,
	onGestureStart,
	onGestureEnd,
	allowNone = false,
	onClear,
	alpha,
	onAlphaChange,
	onAlphaEnd,
}: ColorPickerProps) {
	const recents = useColorRecents((state) => state.recents);
	const addRecent = useColorRecents((state) => state.addRecent);

	const seedHex =
		!mixed && value && value !== "none" ? normalizeHex(value) : null;
	const isNone = !mixed && value === "none";
	const indeterminate = mixed || isNone || (!seedHex && value !== "none");

	const [hsv, setHsv] = useState<Hsv>(() =>
		rgbToHsv(hexToRgb(seedHex ?? DEFAULT_HEX) ?? { r: 255, g: 255, b: 255 }),
	);
	const [hexDraft, setHexDraft] = useState<string>(seedHex ?? "");
	const draggingRef = useRef(false);

	// Re-seed HSV from an EXTERNAL value change (selection switch / undo), but
	// never mid-drag — the picker's own commits echo back through `value` and
	// must not re-derive HSV (which would jump the cursor at gray/black). The
	// prev hint preserves hue/saturation at those degeneracies.
	const seedSignature = `${resetKey ?? ""}|${value ?? ""}|${mixed}`;
	const lastSignatureRef = useRef(seedSignature);
	if (seedSignature !== lastSignatureRef.current && !draggingRef.current) {
		lastSignatureRef.current = seedSignature;
		const nextHex =
			!mixed && value && value !== "none" ? normalizeHex(value) : null;
		if (nextHex) {
			const rgb = hexToRgb(nextHex);
			if (rgb) setHsv(rgbToHsv(rgb, { h: hsv.h, s: hsv.s }));
			setHexDraft(nextHex);
		} else {
			setHexDraft("");
		}
	}

	const liveHex = rgbToHex(hsvToRgb(hsv));

	const beginGesture = () => {
		draggingRef.current = true;
		onGestureStart?.();
	};
	const endGesture = () => {
		if (!draggingRef.current) return;
		draggingRef.current = false;
		onGestureEnd?.();
		addRecent(rgbToHex(hsvToRgb(hsv)));
	};

	const applyHsv = (next: Hsv) => {
		setHsv(next);
		const hex = rgbToHex(hsvToRgb(next));
		setHexDraft(hex);
		onChange(hex);
	};

	const commitHsv = (next: Hsv) => {
		setHsv(next);
		const hex = rgbToHex(hsvToRgb(next));
		setHexDraft(hex);
		if (onCommit(hex)) addRecent(hex);
	};

	const commitHex = (input: string) => {
		const hex = normalizeHex(input.startsWith("#") ? input : `#${input}`);
		if (!hex) {
			setHexDraft(seedHex ?? "");
			return;
		}
		const rgb = hexToRgb(hex);
		if (rgb) setHsv(rgbToHsv(rgb, { h: hsv.h, s: hsv.s }));
		setHexDraft(hex);
		if (onCommit(hex)) addRecent(hex);
	};

	const commitRgbChannel = (channel: "r" | "g" | "b", raw: string) => {
		const parsed = Number.parseInt(raw, 10);
		if (!Number.isFinite(parsed)) return;
		const base = hexToRgb(liveHex) ?? { r: 255, g: 255, b: 255 };
		const next = {
			...base,
			[channel]: Math.max(0, Math.min(CHANNEL_MAX, parsed)),
		};
		commitHsv(rgbToHsv(next, { h: hsv.h, s: hsv.s }));
	};

	const onHexKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			// Dirty draft → revert and keep the popover open; clean → let Escape
			// bubble so the host can close.
			if (hexDraft !== (seedHex ?? "")) {
				event.preventDefault();
				event.stopPropagation();
				setHexDraft(seedHex ?? "");
				event.currentTarget.blur();
			}
		}
	};

	const pickFromScreen = () => {
		const Ctor = getEyeDropper();
		if (!Ctor) return;
		void new Ctor()
			.open()
			.then((result) => {
				const hex = normalizeHex(result.sRGBHex);
				if (hex) commitHex(hex);
			})
			.catch(() => {
				// User dismissed the eyedropper; nothing to commit.
			});
	};

	const rgb = hexToRgb(liveHex) ?? { r: 255, g: 255, b: 255 };
	const swatchBackground = indeterminate
		? "repeating-linear-gradient(45deg, var(--fg-muted) 0 2px, transparent 2px 5px)"
		: isNone
			? "linear-gradient(135deg, transparent 0 46%, var(--danger) 46% 54%, transparent 54%)"
			: liveHex;
	const EyeDropperCtor = getEyeDropper();

	return (
		<div className="flex w-full flex-col gap-2">
			<SvArea
				hsv={hsv}
				disabled={disabled}
				indeterminate={indeterminate}
				onStart={(s, v) => {
					beginGesture();
					applyHsv({ ...hsv, s, v });
				}}
				onMove={(s, v) => applyHsv({ ...hsv, s, v })}
				onEnd={endGesture}
				onKeyAdjust={(s, v) => commitHsv({ ...hsv, s, v })}
			/>

			<LinearTrack
				label="Hue"
				fraction={hsv.h / HUE_MAX}
				disabled={disabled}
				valueText={`${Math.round(hsv.h)}°`}
				step={HUE_KEY_STEP}
				stepLarge={HUE_KEY_STEP_LARGE}
				max={HUE_MAX}
				trackStyle={{
					backgroundImage:
						"linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
				}}
				onStart={(frac) => {
					beginGesture();
					applyHsv({ ...hsv, h: frac * HUE_MAX });
				}}
				onMove={(frac) => applyHsv({ ...hsv, h: frac * HUE_MAX })}
				onEnd={endGesture}
				onKeyAdjust={(h) => commitHsv({ ...hsv, h })}
			/>

			{alpha === undefined ? null : (
				<LinearTrack
					label="Opacity"
					fraction={clamp01(alpha)}
					disabled={disabled}
					valueText={`${Math.round(clamp01(alpha) * PERCENT)}%`}
					step={KEY_STEP}
					stepLarge={KEY_STEP_LARGE}
					max={1}
					trackClassName="checkerboard-fine"
					overlayStyle={{
						backgroundImage: `linear-gradient(to right, transparent, ${liveHex})`,
					}}
					onStart={(frac) => {
						onAlphaChange?.(clamp01(frac));
					}}
					onMove={(frac) => onAlphaChange?.(clamp01(frac))}
					onEnd={() => onAlphaEnd?.()}
					onKeyAdjust={(next) => {
						onAlphaChange?.(clamp01(next));
						onAlphaEnd?.();
					}}
				/>
			)}

			<div className="flex items-center gap-1">
				<span
					aria-hidden="true"
					className={cn(
						"size-6 shrink-0 rounded border border-white/15",
						isNone || indeterminate ? "" : "checkerboard-fine",
					)}
				>
					<span
						className="block size-full rounded-[3px]"
						style={{ background: swatchBackground }}
					/>
				</span>
				<input
					type="text"
					aria-label="Hex color"
					aria-invalid={
						hexDraft.length > 0 &&
						normalizeHex(
							hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`,
						) === null
					}
					spellCheck={false}
					disabled={disabled}
					value={hexDraft}
					placeholder={mixed ? "Mixed" : "#rrggbb"}
					onChange={(event) => setHexDraft(event.currentTarget.value)}
					onBlur={() => {
						if (hexDraft !== (seedHex ?? "")) commitHex(hexDraft);
					}}
					onKeyDown={onHexKeyDown}
					className={cn(fieldClass, "min-w-0 flex-1 uppercase")}
				/>
				{EyeDropperCtor ? (
					<button
						type="button"
						aria-label="Pick color from screen"
						title="Pick from screen"
						disabled={disabled}
						onClick={pickFromScreen}
						className="grid size-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.05] text-fg-secondary transition hover:bg-white/[0.1] hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
					>
						<Eyedropper aria-hidden="true" size={13} />
					</button>
				) : null}
			</div>

			<div className="grid grid-cols-3 gap-1">
				{(["r", "g", "b"] as const).map((channel) => (
					<label key={channel} className="block min-w-0">
						<span className="mb-0.5 block text-fg-muted text-ui uppercase">
							{channel}
						</span>
						<input
							type="text"
							inputMode="numeric"
							aria-label={`${channel.toUpperCase()} channel`}
							disabled={disabled || indeterminate}
							defaultValue={indeterminate ? "" : formatChannel(rgb[channel])}
							key={`${channel}:${indeterminate ? "mixed" : liveHex}`}
							onBlur={(event) =>
								commitRgbChannel(channel, event.currentTarget.value)
							}
							onKeyDown={(event) => {
								if (event.key === "Enter") event.currentTarget.blur();
							}}
							className={cn(fieldClass, "text-center tabular-nums")}
						/>
					</label>
				))}
			</div>

			<div className="flex flex-col gap-1.5 border-white/10 border-t pt-1.5">
				{recents.length > 0 ? (
					<div className="grid grid-cols-10 gap-1">
						{recents.map((recent) => (
							<button
								key={recent}
								type="button"
								aria-label={`Apply recent ${recent}`}
								title={recent}
								disabled={disabled}
								onClick={() => commitHex(recent)}
								className="aspect-square rounded-sm border border-white/10 transition hover:border-white/30"
								style={{ backgroundColor: recent }}
							/>
						))}
					</div>
				) : null}
				<RadixSwatchPicker
					activeHex={liveHex}
					seedHex={seedHex}
					disabled={disabled}
					onPick={commitHex}
				/>
			</div>

			{allowNone && onClear ? (
				<button
					type="button"
					aria-pressed={isNone}
					disabled={disabled}
					onClick={() => onClear()}
					className={cn(
						"flex h-6 items-center justify-center gap-1 rounded-md border text-ui transition disabled:cursor-not-allowed disabled:opacity-45",
						isNone
							? "border-accent/50 bg-accent-surface text-accent-fg"
							: "border-white/10 bg-white/[0.04] text-fg-secondary hover:bg-white/[0.08] hover:text-fg",
					)}
				>
					No fill
				</button>
			) : null}
		</div>
	);
}
