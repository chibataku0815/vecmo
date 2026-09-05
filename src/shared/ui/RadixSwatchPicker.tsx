import { MagnifyingGlass } from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { nearestRadixStep, RADIX_SCALES } from "@/shared/color/radix-palette";
import { cn } from "@/shared/lib/cn";

/**
 * The Radix Colors palette as a searchable swatch browser, embedded under the
 * {@link ColorPicker}'s editing controls. It exists to make a color *findable*,
 * not merely available: type a family name to filter (`jade` → the jade ramp),
 * and the family nearest the picker's current color is highlighted and scrolled
 * into view on open and on every committed edit. Paste a hex into the field
 * above and this list jumps to where that color lives in Radix.
 *
 * Presentational and store-free: it reads the palette data and reports a chosen
 * `#rrggbb` up through {@link onPick}; the host owns the commit + undo entry.
 */
export type RadixSwatchPickerProps = {
	/** The picker's live color — drives the "you are here" highlight (follows drags). */
	readonly activeHex: string;
	/** The committed/external color — re-scrolls to its family on change (not mid-drag). */
	readonly seedHex: string | null;
	readonly disabled?: boolean;
	/** Commit a chosen swatch; the host applies it as one undo entry. */
	readonly onPick: (hex: string) => void;
};

const LIST_MAX_HEIGHT_PX = 180;
const STEP_NUMBER_OFFSET = 1;

/** Centers a row within the scroll viewport, but only when it is off-screen. */
const scrollRowIntoView = (
	container: HTMLDivElement,
	row: HTMLDivElement,
): void => {
	const rowTop = row.offsetTop;
	const rowBottom = rowTop + row.offsetHeight;
	const viewTop = container.scrollTop;
	const viewBottom = viewTop + container.clientHeight;
	if (rowTop >= viewTop && rowBottom <= viewBottom) return;
	const centered = rowTop - (container.clientHeight - row.offsetHeight) / 2;
	container.scrollTop = Math.max(0, centered);
};

export function RadixSwatchPicker({
	activeHex,
	seedHex,
	disabled = false,
	onPick,
}: RadixSwatchPickerProps) {
	const [query, setQuery] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

	const trimmed = query.trim().toLowerCase();
	const visible = useMemo(() => {
		const all = RADIX_SCALES.map((scale, index) => ({ scale, index }));
		if (!trimmed) return all;
		return all.filter(({ scale }) => scale.name.includes(trimmed));
	}, [trimmed]);

	// The live highlight follows the picker color frame-by-frame (cheap scan).
	const liveMatch = useMemo(() => nearestRadixStep(activeHex), [activeHex]);

	// Scroll to the *committed* color's family on mount and on each external
	// commit — keyed on seedHex so a live drag (which never changes seedHex) does
	// not yank the list out from under the user. Runs post-mount in a layout
	// effect so the portal-rendered rows exist to scroll to.
	useLayoutEffect(() => {
		if (!seedHex) return;
		const match = nearestRadixStep(seedHex);
		if (!match) return;
		const container = scrollRef.current;
		const row = rowRefs.current.get(match.scaleIndex);
		if (container && row) scrollRowIntoView(container, row);
	}, [seedHex]);

	const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		// A non-empty query owns Escape (clear it); an empty one lets Escape bubble
		// so the host popover can close — mirrors the hex field's behavior.
		if (event.key === "Escape" && query.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			setQuery("");
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="relative">
				<MagnifyingGlass
					aria-hidden="true"
					size={12}
					className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 text-fg-subtle"
				/>
				<input
					type="text"
					aria-label="Search Radix colors"
					spellCheck={false}
					disabled={disabled}
					value={query}
					placeholder="Search colors…"
					onChange={(event) => setQuery(event.currentTarget.value)}
					onKeyDown={onSearchKeyDown}
					className="h-6 w-full rounded-md border border-white/10 bg-black/25 pr-1.5 pl-6 text-fg text-ui capitalize outline-none transition placeholder:text-fg-subtle placeholder:normal-case focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
				/>
			</div>

			<div
				ref={scrollRef}
				className="chrome-scrollbar-thin relative flex flex-col gap-1 overflow-y-auto pr-1"
				style={{ maxHeight: `${LIST_MAX_HEIGHT_PX}px` }}
			>
				{visible.length === 0 ? (
					<p className="px-0.5 py-1 text-fg-subtle text-ui">No colors match.</p>
				) : (
					visible.map(({ scale, index }) => {
						const scaleActive = liveMatch?.scaleIndex === index;
						return (
							<div
								key={scale.name}
								ref={(el) => {
									if (el) rowRefs.current.set(index, el);
									else rowRefs.current.delete(index);
								}}
								className="flex items-center gap-1.5"
							>
								<span
									className={cn(
										"w-11 shrink-0 truncate text-ui capitalize transition-colors",
										scaleActive ? "text-fg" : "text-fg-muted",
									)}
									title={scale.label}
								>
									{scale.label}
								</span>
								<div className="flex h-3.5 flex-1 overflow-hidden rounded-sm">
									{scale.steps.map((hex, stepIndex) => {
										const stepActive =
											scaleActive && liveMatch?.stepIndex === stepIndex;
										const stepNumber = stepIndex + STEP_NUMBER_OFFSET;
										return (
											<button
												key={hex}
												type="button"
												disabled={disabled}
												aria-label={`Apply ${scale.label} ${stepNumber}, ${hex}`}
												aria-pressed={stepActive || undefined}
												title={`${scale.label} ${stepNumber} · ${hex}`}
												onClick={() => onPick(hex)}
												className={cn(
													"relative h-full flex-1 outline-none",
													disabled
														? "cursor-not-allowed"
														: "hover:z-10 hover:ring-2 hover:ring-white/70 hover:ring-inset focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
												)}
												style={{ backgroundColor: hex }}
											>
												{stepActive ? (
													<span
														aria-hidden="true"
														className={cn(
															"pointer-events-none absolute inset-0 z-10 ring-2 ring-inset",
															liveMatch?.exact ? "ring-accent" : "ring-white",
														)}
														style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.55)" }}
													/>
												) : null}
											</button>
										);
									})}
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
