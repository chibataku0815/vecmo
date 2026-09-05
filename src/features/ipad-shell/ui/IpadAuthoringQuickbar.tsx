import {
	ArrowClockwise,
	ArrowCounterClockwise,
	ArrowLineDown,
	ArrowLineUp,
	BoundingBox,
	CheckCircle,
	ClockCounterClockwise,
	DotsSix,
	FilmStrip,
	type Icon,
	Minus,
	Palette,
	Plus,
	Trash,
	WarningCircle,
} from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import type { NativeWebCapabilityProbeMessage } from "@/features/ipad-shell/model/native-bridge";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";

/** Native-host readiness snapshot surfaced by the iPad quickbar status dot. */
export type IpadNativeStatus = {
	readonly hostReady: boolean;
	readonly capabilityProbe: NativeWebCapabilityProbeMessage | null;
	readonly squeezeSeen: boolean;
};

/** Short-lived iPad quickbar handoff feedback owned by CanvasShell timers. */
export type IpadQuickbarNotice = {
	readonly tone: "neutral" | "success" | "warning" | "danger";
	readonly label: string;
	readonly detail: string;
};

/** Visual severity for cloud/project status in the compact iPad quickbar. */
export type IpadCloudStatusTone = "neutral" | "success" | "warning" | "danger";

/** User-facing cloud/project status copy rendered in the iPad quickbar. */
export type IpadCloudStatus = {
	readonly tone: IpadCloudStatusTone;
	readonly label: string;
	readonly detail: string;
};

/** Dock edge used when the quickbar moves away from Pencil squeeze or menu UI. */
export type IpadQuickbarDock = "bottom" | "top";

/** Tool action already resolved by CanvasShell so this component stays presentational. */
export type IpadQuickbarToolAction = {
	readonly id: string;
	readonly label: string;
	readonly IconComponent: Icon;
	readonly active: boolean;
	readonly onClick: () => void;
};

const IPAD_QUICKBAR_EDGE_INSET = "max(0.875rem, env(safe-area-inset-bottom))";
const IPAD_QUICKBAR_TOP_INSET = "max(0.875rem, env(safe-area-inset-top))";

const ipadQuickbarButtonClass = (
	active = false,
	enabled = true,
	danger = false,
): string =>
	[
		"grid size-10 shrink-0 place-items-center rounded-md border text-ui transition",
		active
			? "border-accent bg-accent-surface text-accent-fg"
			: danger
				? "border-danger/35 bg-danger-surface/55 text-danger-fg hover:border-danger/50 hover:bg-danger-surface"
				: "border-hairline/10 bg-hairline/5 text-fg-secondary hover:border-hairline/25 hover:bg-hairline/10 hover:text-fg",
		!enabled
			? "cursor-not-allowed border-hairline/8 bg-hairline/5 text-fg-subtle opacity-45 hover:border-hairline/8 hover:bg-hairline/5 hover:text-fg-subtle"
			: "",
	]
		.filter(Boolean)
		.join(" ");

const ipadQuickbarNoticeClass = (tone: IpadQuickbarNotice["tone"]): string =>
	[
		"flex h-10 min-w-0 max-w-36 items-center gap-1.5 rounded-md border px-2 text-ui font-medium",
		tone === "success"
			? "border-accent/35 bg-accent-surface text-accent-fg"
			: tone === "warning"
				? "border-warn/35 bg-warn-surface/35 text-warn-fg"
				: tone === "danger"
					? "border-danger/35 bg-danger-surface text-danger-fg"
					: "border-hairline/12 bg-hairline/5 text-fg-secondary",
	].join(" ");

const ipadCloudStatusClass = (tone: IpadCloudStatusTone): string =>
	[
		"flex h-10 max-w-28 shrink-0 items-center rounded-md border px-2 text-ui font-medium",
		tone === "success"
			? "border-accent/35 bg-accent-surface/35 text-accent-fg"
			: tone === "warning"
				? "border-warn/35 bg-warn-surface/35 text-warn-fg"
				: tone === "danger"
					? "border-danger/35 bg-danger-surface/35 text-danger-fg"
					: "border-hairline/12 bg-hairline/5 text-fg-secondary",
	].join(" ");

function IpadQuickbarNoticeChip({
	notice,
}: {
	readonly notice: IpadQuickbarNotice;
}) {
	const NoticeIcon =
		notice.tone === "success"
			? CheckCircle
			: notice.tone === "warning" || notice.tone === "danger"
				? WarningCircle
				: null;

	return (
		<Tooltip label={notice.detail} side="top">
			<span
				role="status"
				aria-label={notice.detail}
				className={ipadQuickbarNoticeClass(notice.tone)}
			>
				{NoticeIcon ? <NoticeIcon aria-hidden="true" size={15} /> : null}
				<span className="min-w-0 truncate">{notice.label}</span>
			</span>
		</Tooltip>
	);
}

function IpadCloudStatusChip({ status }: { readonly status: IpadCloudStatus }) {
	return (
		<Tooltip label={status.detail} side="top">
			<span
				role="status"
				aria-label={status.detail}
				className={ipadCloudStatusClass(status.tone)}
			>
				<span className="min-w-0 truncate">{status.label}</span>
			</span>
		</Tooltip>
	);
}

/**
 * Touch-sized iPad editor quickbar. CanvasShell supplies state/actions; this
 * component owns only the docked chrome layout and labels.
 */
export function IpadAuthoringQuickbar({
	accountEntry,
	bridgeAvailable,
	canRedo,
	canUndo,
	cloudStatus,
	dock,
	hasNodeSelection,
	hasSelection,
	nativeStatus,
	notice,
	onDeleteSelection,
	onFitArtboard,
	onFitSelection,
	onOpenBackup,
	onOpenCloudRecovery,
	onOpenQuickMenu,
	onOpenStyle,
	onRedo,
	onShareBackup,
	onToggleTimeline,
	onUndo,
	onZoomActualSize,
	onZoomIn,
	onZoomOut,
	timelineOpen,
	toolActions,
	zoomPercent,
}: {
	readonly accountEntry?: ReactNode;
	readonly bridgeAvailable: boolean;
	readonly canRedo: boolean;
	readonly canUndo: boolean;
	readonly cloudStatus?: IpadCloudStatus;
	readonly dock: IpadQuickbarDock;
	readonly hasNodeSelection: boolean;
	readonly hasSelection: boolean;
	readonly nativeStatus: IpadNativeStatus;
	readonly notice: IpadQuickbarNotice | null;
	readonly onDeleteSelection: () => void;
	readonly onFitArtboard: () => void;
	readonly onFitSelection: () => void;
	readonly onOpenBackup: () => void;
	readonly onOpenCloudRecovery: () => void;
	readonly onOpenQuickMenu: () => void;
	readonly onOpenStyle: () => void;
	readonly onRedo: () => void;
	readonly onShareBackup: () => void;
	readonly onToggleTimeline: () => void;
	readonly onUndo: () => void;
	readonly onZoomActualSize: () => void;
	readonly onZoomIn: () => void;
	readonly onZoomOut: () => void;
	readonly timelineOpen: boolean;
	readonly toolActions: readonly IpadQuickbarToolAction[];
	readonly zoomPercent: number;
}) {
	const activePencil = toolActions.some(
		(action) => action.id === "pencil" && action.active,
	);
	const capabilityLabel = nativeStatus.capabilityProbe
		? `WebGPU ${nativeStatus.capabilityProbe.hasWebGPU ? "available" : "not available"} · PointerEvent ${
				nativeStatus.capabilityProbe.hasPointerEvent
					? "available"
					: "not available"
			}${nativeStatus.squeezeSeen ? " · Pencil squeeze seen" : ""}`
		: nativeStatus.hostReady
			? "Native host ready · waiting for WKWebView capability probe"
			: "Native host not ready";
	const nativeCaptureLabel = bridgeAvailable
		? activePencil
			? `Native Pencil capture on · ${capabilityLabel}`
			: `Native Pencil bridge ready · ${capabilityLabel}`
		: "Native Pencil bridge not detected";
	const nativeCaptureClass =
		bridgeAvailable && activePencil
			? "bg-accent ring-2 ring-accent/30"
			: bridgeAvailable
				? "bg-fg-secondary"
				: "bg-fg-subtle";
	const fitLabel = hasSelection ? "Fit selection" : "Fit artboard";
	const dockStyle =
		dock === "top"
			? ({ top: IPAD_QUICKBAR_TOP_INSET } satisfies CSSProperties)
			: ({ bottom: IPAD_QUICKBAR_EDGE_INSET } satisfies CSSProperties);

	return (
		<TooltipProvider>
			<div
				data-ipad-authoring-chrome="true"
				className="-translate-x-1/2 pointer-events-auto absolute left-1/2 z-[42] flex max-w-[calc(100vw-1rem)] flex-col items-center gap-1"
				onPointerDown={(event) => event.stopPropagation()}
				style={dockStyle}
			>
				{dock === "bottom" && notice ? (
					<IpadQuickbarNoticeChip notice={notice} />
				) : null}
				<div className="chrome-scrollbar-thin flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-white/10 bg-surface-raised/94 p-1 text-fg shadow-2xl shadow-black/50 backdrop-blur-xl">
					<Tooltip label={nativeCaptureLabel} side="top">
						<span
							role="status"
							aria-label={nativeCaptureLabel}
							className={`mx-1 size-2.5 shrink-0 rounded-full ${nativeCaptureClass}`}
						/>
					</Tooltip>
					{cloudStatus ? <IpadCloudStatusChip status={cloudStatus} /> : null}
					{accountEntry}
					{toolActions.map(({ id, label, IconComponent, active, onClick }) => (
						<Tooltip key={id} label={label} side="top">
							<button
								type="button"
								aria-label={label}
								aria-pressed={active}
								className={ipadQuickbarButtonClass(active)}
								onClick={onClick}
							>
								<IconComponent
									aria-hidden="true"
									size={18}
									weight={active ? "duotone" : "regular"}
								/>
							</button>
						</Tooltip>
					))}
					<span
						className="mx-1 h-6 w-px shrink-0 bg-white/10"
						aria-hidden="true"
					/>
					<Tooltip label="Undo" side="top">
						<button
							type="button"
							aria-label="Undo"
							disabled={!canUndo}
							className={ipadQuickbarButtonClass(false, canUndo)}
							onClick={onUndo}
						>
							<ArrowCounterClockwise aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<Tooltip label="Redo" side="top">
						<button
							type="button"
							aria-label="Redo"
							disabled={!canRedo}
							className={ipadQuickbarButtonClass(false, canRedo)}
							onClick={onRedo}
						>
							<ArrowClockwise aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<span
						className="mx-1 h-6 w-px shrink-0 bg-white/10"
						aria-hidden="true"
					/>
					<Tooltip label="Zoom out" side="top">
						<button
							type="button"
							aria-label="Zoom out"
							className={ipadQuickbarButtonClass()}
							onClick={onZoomOut}
						>
							<Minus aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<Tooltip label="Actual size" side="top">
						<button
							type="button"
							aria-label={`Actual size, current zoom ${Math.round(zoomPercent)}%`}
							className="grid h-10 min-w-12 shrink-0 place-items-center rounded-md border border-hairline/10 bg-hairline/5 px-2 font-mono text-fg-secondary text-ui transition hover:border-hairline/25 hover:bg-hairline/10 hover:text-fg"
							onClick={onZoomActualSize}
						>
							{Math.round(zoomPercent)}%
						</button>
					</Tooltip>
					<Tooltip label="Zoom in" side="top">
						<button
							type="button"
							aria-label="Zoom in"
							className={ipadQuickbarButtonClass()}
							onClick={onZoomIn}
						>
							<Plus aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<Tooltip label={fitLabel} side="top">
						<button
							type="button"
							aria-label={fitLabel}
							className={ipadQuickbarButtonClass()}
							onClick={hasSelection ? onFitSelection : onFitArtboard}
						>
							<BoundingBox aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					{hasNodeSelection ? (
						<Tooltip label="Style" side="top">
							<button
								type="button"
								aria-label="Style"
								className={ipadQuickbarButtonClass()}
								onClick={onOpenStyle}
							>
								<Palette aria-hidden="true" size={18} />
							</button>
						</Tooltip>
					) : null}
					{hasSelection ? (
						<Tooltip label="Delete selection" side="top">
							<button
								type="button"
								aria-label="Delete selection"
								className={ipadQuickbarButtonClass(false, true, true)}
								onClick={onDeleteSelection}
							>
								<Trash aria-hidden="true" size={18} />
							</button>
						</Tooltip>
					) : null}
					<Tooltip label="Quick menu" side="top">
						<button
							type="button"
							aria-label="Quick menu"
							className={ipadQuickbarButtonClass()}
							onClick={onOpenQuickMenu}
						>
							<DotsSix aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<Tooltip label="Timeline" side="top">
						<button
							type="button"
							aria-label="Timeline"
							aria-pressed={timelineOpen}
							className={ipadQuickbarButtonClass(timelineOpen)}
							onClick={onToggleTimeline}
						>
							<FilmStrip aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<Tooltip label="Cloud recovery" side="top">
						<button
							type="button"
							aria-label="Cloud recovery"
							className={ipadQuickbarButtonClass()}
							onClick={onOpenCloudRecovery}
						>
							<ClockCounterClockwise aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<span
						className="mx-1 h-6 w-px shrink-0 bg-white/10"
						aria-hidden="true"
					/>
					<Tooltip label="Open backup" side="top">
						<button
							type="button"
							aria-label="Open backup"
							disabled={!bridgeAvailable}
							className={ipadQuickbarButtonClass(false, bridgeAvailable)}
							onClick={onOpenBackup}
						>
							<ArrowLineDown aria-hidden="true" size={18} />
						</button>
					</Tooltip>
					<Tooltip label="Share backup" side="top">
						<button
							type="button"
							aria-label="Share backup"
							disabled={!bridgeAvailable}
							className={ipadQuickbarButtonClass(false, bridgeAvailable)}
							onClick={onShareBackup}
						>
							<ArrowLineUp aria-hidden="true" size={18} />
						</button>
					</Tooltip>
				</div>
				{dock === "top" && notice ? (
					<IpadQuickbarNoticeChip notice={notice} />
				) : null}
			</div>
		</TooltipProvider>
	);
}
