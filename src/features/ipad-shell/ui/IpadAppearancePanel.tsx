import { Minus, Palette } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type {
	NodeStylePatch,
	TextStylePatch,
} from "@/entities/scene/model/node-commands";
import type {
	StrokeCap,
	StrokeJoin,
	TextStyle,
	VectorNode,
} from "@/entities/scene/model/types";

/** Compact style snapshot for the current iPad appearance-panel selection. */
export type IpadAppearanceStyle = Pick<
	VectorNode["style"],
	"fill" | "stroke" | "strokeWidth" | "opacity"
> & {
	readonly strokeCap: StrokeCap;
	readonly strokeJoin: StrokeJoin;
	readonly dashedStroke: boolean;
	readonly text?: Pick<
		TextStyle,
		| "align"
		| "fontSize"
		| "fontWeight"
		| "italic"
		| "letterSpacing"
		| "lineHeight"
		| "underline"
	>;
};

/** Scene style patch emitted by touch controls; CanvasShell owns command commit. */
export type IpadAppearancePatch = Pick<
	NodeStylePatch,
	| "fill"
	| "stroke"
	| "strokeCap"
	| "strokeDash"
	| "strokeJoin"
	| "strokeWidth"
	| "opacity"
>;

/** Text-geometry style patch emitted by the compact iPad typography controls. */
export type IpadTextAppearancePatch = Pick<
	TextStylePatch,
	| "align"
	| "fontSize"
	| "fontWeight"
	| "italic"
	| "letterSpacing"
	| "lineHeight"
	| "underline"
>;

const IPAD_STROKE_CAPS = [
	"butt",
	"round",
	"square",
] as const satisfies readonly StrokeCap[];
const IPAD_STROKE_JOINS = [
	"miter",
	"round",
	"bevel",
] as const satisfies readonly StrokeJoin[];
const IPAD_TEXT_ALIGNS = [
	"left",
	"center",
	"right",
] as const satisfies readonly TextStyle["align"][];
const IPAD_DASH_PATTERN = [12, 8] as const;
const IPAD_REGULAR_FONT_WEIGHT = 400;
const IPAD_BOLD_FONT_WEIGHT = 700;
const IPAD_BOLD_WEIGHT_THRESHOLD = 600;

const colorInputValue = (value: string, fallback = "#000000"): string =>
	/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

/**
 * Compact iPad-only appearance controls for the selected object. CanvasShell
 * owns command wiring; this component owns the touch-sized control layout.
 */
export function IpadAppearancePanel({
	nodeStyle,
	onChange,
	onClose,
	onTextChange,
	selectedCount,
	style,
}: {
	readonly nodeStyle: IpadAppearanceStyle;
	readonly onChange: (patch: IpadAppearancePatch) => void;
	readonly onClose: () => void;
	readonly onTextChange: (patch: IpadTextAppearancePatch) => void;
	readonly selectedCount: number;
	readonly style: CSSProperties;
}) {
	const textStyle = nodeStyle.text;

	return (
		<div
			className="pointer-events-auto absolute z-[44] w-72 rounded-lg border border-hairline/10 bg-surface-raised/96 p-2 text-fg shadow-2xl shadow-scrim/45 backdrop-blur-xl"
			style={{
				...style,
				maxHeight: "calc(100svh - 96px)",
				overflowY: "auto",
			}}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="mb-2 flex h-6 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5 text-fg-secondary text-ui">
					<Palette aria-hidden="true" size={15} />
					<span className="truncate">
						{selectedCount > 1 ? `${selectedCount} objects` : "Appearance"}
					</span>
				</div>
				<button
					type="button"
					aria-label="Close appearance controls"
					className="grid size-6 place-items-center rounded text-fg-muted hover:bg-hairline/8 hover:text-fg"
					onClick={onClose}
				>
					<Minus aria-hidden="true" size={14} />
				</button>
			</div>
			<div className="grid gap-2">
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-fg-secondary text-ui">
					<span>Stroke</span>
					<input
						type="color"
						aria-label="Stroke color"
						value={colorInputValue(nodeStyle.stroke)}
						className="h-8 w-full rounded border border-hairline/10 bg-surface-sunken p-0.5"
						onChange={(event) =>
							onChange({ stroke: event.currentTarget.value })
						}
					/>
				</label>
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-fg-secondary text-ui">
					<span>Fill</span>
					<input
						type="color"
						aria-label="Fill color"
						value={colorInputValue(nodeStyle.fill, "#ebe7dd")}
						className="h-8 w-full rounded border border-hairline/10 bg-surface-sunken p-0.5"
						onChange={(event) => onChange({ fill: event.currentTarget.value })}
					/>
				</label>
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-fg-secondary text-ui">
					<span>Width</span>
					<input
						type="range"
						aria-label="Stroke width"
						min={0}
						max={64}
						step={0.5}
						value={Math.min(64, Math.max(0, nodeStyle.strokeWidth))}
						className="accent-accent"
						onChange={(event) =>
							onChange({ strokeWidth: Number(event.currentTarget.value) })
						}
					/>
					<span className="text-right font-mono text-fg-muted">
						{Math.round(nodeStyle.strokeWidth)}
					</span>
				</label>
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-fg-secondary text-ui">
					<span>Opacity</span>
					<input
						type="range"
						aria-label="Opacity"
						min={0}
						max={100}
						step={1}
						value={Math.round(nodeStyle.opacity * 100)}
						className="accent-accent"
						onChange={(event) =>
							onChange({ opacity: Number(event.currentTarget.value) / 100 })
						}
					/>
					<span className="text-right font-mono text-fg-muted">
						{Math.round(nodeStyle.opacity * 100)}
					</span>
				</label>
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-fg-secondary text-ui">
					<span>Cap</span>
					<select
						aria-label="Stroke cap"
						value={nodeStyle.strokeCap}
						className="h-8 rounded border border-hairline/10 bg-surface-sunken px-2 text-fg text-ui"
						onChange={(event) =>
							onChange({ strokeCap: event.currentTarget.value as StrokeCap })
						}
					>
						{IPAD_STROKE_CAPS.map((cap) => (
							<option key={cap} value={cap}>
								{cap}
							</option>
						))}
					</select>
				</label>
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-fg-secondary text-ui">
					<span>Join</span>
					<select
						aria-label="Stroke join"
						value={nodeStyle.strokeJoin}
						className="h-8 rounded border border-hairline/10 bg-surface-sunken px-2 text-fg text-ui"
						onChange={(event) =>
							onChange({ strokeJoin: event.currentTarget.value as StrokeJoin })
						}
					>
						{IPAD_STROKE_JOINS.map((join) => (
							<option key={join} value={join}>
								{join}
							</option>
						))}
					</select>
				</label>
				<label className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-fg-secondary text-ui">
					<span>Dash</span>
					<span className="flex h-8 items-center gap-2 rounded border border-hairline/10 bg-surface-sunken px-2">
						<input
							type="checkbox"
							aria-label="Dashed stroke"
							checked={nodeStyle.dashedStroke}
							className="h-4 w-4 accent-accent"
							onChange={(event) =>
								onChange({
									strokeDash: event.currentTarget.checked
										? IPAD_DASH_PATTERN
										: [],
								})
							}
						/>
						<span>{nodeStyle.dashedStroke ? "On" : "Off"}</span>
					</span>
				</label>
			</div>
			{textStyle ? (
				<div className="mt-2 border-hairline/10 border-t pt-2 text-ui">
					<div className="mb-2 flex items-center justify-between gap-2">
						<span className="font-medium text-fg-secondary">Text</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								aria-label="Bold"
								aria-pressed={
									textStyle.fontWeight >= IPAD_BOLD_WEIGHT_THRESHOLD
								}
								className={`grid size-8 place-items-center rounded border text-ui font-medium transition ${
									textStyle.fontWeight >= IPAD_BOLD_WEIGHT_THRESHOLD
										? "border-accent bg-accent-surface text-accent-fg"
										: "border-hairline/10 bg-surface-sunken text-fg-secondary hover:border-accent/40 hover:text-fg"
								}`}
								onClick={() =>
									onTextChange({
										fontWeight:
											textStyle.fontWeight >= IPAD_BOLD_WEIGHT_THRESHOLD
												? IPAD_REGULAR_FONT_WEIGHT
												: IPAD_BOLD_FONT_WEIGHT,
									})
								}
							>
								B
							</button>
							<button
								type="button"
								aria-label="Italic"
								aria-pressed={Boolean(textStyle.italic)}
								className={`grid size-8 place-items-center rounded border text-ui font-medium italic transition ${
									textStyle.italic
										? "border-accent bg-accent-surface text-accent-fg"
										: "border-hairline/10 bg-surface-sunken text-fg-secondary hover:border-accent/40 hover:text-fg"
								}`}
								onClick={() => onTextChange({ italic: !textStyle.italic })}
							>
								I
							</button>
							<button
								type="button"
								aria-label="Underline"
								aria-pressed={Boolean(textStyle.underline)}
								className={`grid size-8 place-items-center rounded border text-ui font-medium underline transition ${
									textStyle.underline
										? "border-accent bg-accent-surface text-accent-fg"
										: "border-hairline/10 bg-surface-sunken text-fg-secondary hover:border-accent/40 hover:text-fg"
								}`}
								onClick={() =>
									onTextChange({ underline: !textStyle.underline })
								}
							>
								U
							</button>
						</div>
					</div>
					<div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 text-fg-secondary">
						<label htmlFor="ipad-text-size">Size</label>
						<input
							id="ipad-text-size"
							type="range"
							min={8}
							max={240}
							step={1}
							value={textStyle.fontSize}
							className="h-8 w-full accent-accent"
							onChange={(event) =>
								onTextChange({ fontSize: Number(event.currentTarget.value) })
							}
						/>
						<label htmlFor="ipad-text-line-height">Lead</label>
						<input
							id="ipad-text-line-height"
							type="range"
							min={8}
							max={280}
							step={1}
							value={textStyle.lineHeight}
							className="h-8 w-full accent-accent"
							onChange={(event) =>
								onTextChange({ lineHeight: Number(event.currentTarget.value) })
							}
						/>
						<label htmlFor="ipad-text-tracking">Track</label>
						<input
							id="ipad-text-tracking"
							type="range"
							min={-20}
							max={80}
							step={1}
							value={textStyle.letterSpacing}
							className="h-8 w-full accent-accent"
							onChange={(event) =>
								onTextChange({
									letterSpacing: Number(event.currentTarget.value),
								})
							}
						/>
						<label htmlFor="ipad-text-align">Align</label>
						<select
							id="ipad-text-align"
							value={textStyle.align}
							className="h-8 rounded border border-hairline/10 bg-surface-sunken px-2 text-fg text-ui"
							onChange={(event) =>
								onTextChange({
									align: event.currentTarget.value as TextStyle["align"],
								})
							}
						>
							{IPAD_TEXT_ALIGNS.map((align) => (
								<option key={align} value={align}>
									{align}
								</option>
							))}
						</select>
					</div>
				</div>
			) : null}
		</div>
	);
}
