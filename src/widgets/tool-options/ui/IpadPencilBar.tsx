import {
	DEFAULT_PENCIL_PRESSURE_SENSITIVITY,
	PENCIL_BRUSH_PRESETS,
	PENCIL_WIDTH_MAX,
	PENCIL_WIDTH_MIN,
	type PencilBrushType,
	usePencilToolStore,
} from "@/features/draw/model/pencil-tool-store";
import { cn } from "@/shared/lib/cn";
import { ScrubSlider } from "@/shared/ui/ScrubSlider";

/**
 * iPad-facing brush options for the Pencil tool: the touch counterpart of the
 * desktop `PencilOptions` (which lives in the desktop `ToolOptions` chrome that
 * the iPad authoring surface does not mount). Reads the same
 * {@link usePencilToolStore}, so brush type / width / pressure stay a single
 * source of truth across platforms. `EditorPage` mounts it top-center only while
 * the Pencil tool is active on the iPad surface; the desktop bottom quickbar
 * stays clear.
 */
const BRUSH_TYPES: readonly {
	readonly type: PencilBrushType;
	readonly label: string;
}[] = [
	{ type: "pen", label: "Pen" },
	{ type: "pencil", label: "Pencil" },
	{ type: "marker", label: "Marker" },
];

const formatPixels = (value: number): string => `${value}px`;
const formatPercent = (value: number): string => `${Math.round(value)}%`;

const noop = (): void => {};

export function IpadPencilBar() {
	const brushType = usePencilToolStore((state) => state.brushType);
	const setBrushType = usePencilToolStore((state) => state.setBrushType);
	const width = usePencilToolStore((state) => state.width);
	const setWidth = usePencilToolStore((state) => state.setWidth);
	const pressureEnabled = usePencilToolStore((state) => state.pressureEnabled);
	const setPressureEnabled = usePencilToolStore(
		(state) => state.setPressureEnabled,
	);
	const pressureSensitivity = usePencilToolStore(
		(state) => state.pressureSensitivity,
	);
	const setPressureSensitivity = usePencilToolStore(
		(state) => state.setPressureSensitivity,
	);
	const widthNeutral = PENCIL_BRUSH_PRESETS[brushType].width;

	return (
		<aside
			className="pointer-events-auto absolute left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-hairline/12 bg-surface-raised/96 px-2 py-1.5 text-fg shadow-2xl shadow-scrim/45 backdrop-blur-xl"
			style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
			role="toolbar"
			aria-label="Pencil brush"
		>
			<fieldset className="m-0 grid grid-cols-3 gap-1 rounded-lg border-0 bg-surface-sunken p-1">
				<legend className="sr-only">Pencil brush type</legend>
				{BRUSH_TYPES.map(({ type, label }) => {
					const selected = brushType === type;
					return (
						<button
							key={type}
							type="button"
							aria-label={`${label} brush`}
							aria-pressed={selected}
							onClick={() => setBrushType(type)}
							className={cn(
								"flex h-9 min-w-16 items-center justify-center rounded-md border px-3 font-medium text-ui transition",
								selected
									? "border-accent bg-accent-surface text-accent-fg"
									: "border-hairline/10 text-fg-muted",
							)}
						>
							{label}
						</button>
					);
				})}
			</fieldset>
			<div className="h-6 w-px bg-hairline/15" aria-hidden="true" />
			<div className="w-44 shrink-0">
				<ScrubSlider
					label="Width"
					value={width}
					min={PENCIL_WIDTH_MIN}
					max={PENCIL_WIDTH_MAX}
					neutral={widthNeutral}
					step={0.5}
					unit="px"
					format={formatPixels}
					onScrubStart={noop}
					onScrub={(next) => setWidth(next)}
					onScrubEnd={noop}
					onCommitValue={(next) => setWidth(next)}
				/>
			</div>
			<div className="h-6 w-px bg-hairline/15" aria-hidden="true" />
			<button
				type="button"
				aria-label="Pencil pressure-sensitive width"
				aria-pressed={pressureEnabled}
				onClick={() => setPressureEnabled(!pressureEnabled)}
				className={cn(
					"flex h-9 shrink-0 items-center justify-center rounded-md border px-3 font-medium text-ui transition",
					pressureEnabled
						? "border-accent bg-accent-surface text-accent-fg"
						: "border-hairline/10 text-fg-muted",
				)}
			>
				Pressure
			</button>
			{pressureEnabled ? (
				<>
					<div className="h-6 w-px bg-hairline/15" aria-hidden="true" />
					<div className="w-44 shrink-0">
						<ScrubSlider
							label="Sensitivity"
							value={pressureSensitivity * 100}
							min={0}
							max={100}
							neutral={DEFAULT_PENCIL_PRESSURE_SENSITIVITY * 100}
							step={1}
							unit="%"
							format={formatPercent}
							onScrubStart={noop}
							onScrub={(next) => setPressureSensitivity(next / 100)}
							onScrubEnd={noop}
							onCommitValue={(next) => setPressureSensitivity(next / 100)}
						/>
					</div>
				</>
			) : null}
		</aside>
	);
}
