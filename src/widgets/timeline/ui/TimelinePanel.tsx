import {
	ArrowsClockwise,
	CaretLeft,
	CaretRight,
	FilmStrip,
	type Icon,
	Plus,
	Timer,
	Trash,
	WarningCircle,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import { createSetCurrentArtboardCommand } from "@/entities/scene/model/node-commands";
import type { SceneCameraAuthoringSelection } from "@/entities/scene/model/scene-camera-authoring";
import {
	findNode,
	selectCurrentArtboard,
	selectSceneArtboards,
} from "@/entities/scene/model/selectors";
import {
	mapGlobalFrameToSequenceItem,
	type ResolvedSceneSequenceItem,
	resolveSequenceTimeline,
	type SceneSequenceTimeline,
} from "@/entities/scene/model/sequence";
import {
	createInitializeSceneSequenceCommand,
	createMoveSceneSequenceItemCommand,
	createRemoveSceneSequenceItemCommand,
	createSetSceneSequenceItemDurationCommand,
} from "@/entities/scene/model/sequence-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { MotionTimeline } from "@/features/motion/ui/MotionTimeline";
import { useSelectionStore } from "@/features/selection/model/store";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { usePanelResize } from "@/shared/editor-chrome/model/use-panel-resize";
import { cn } from "@/shared/lib/cn";
import { addFrameDiagnosticCount } from "@/shared/performance/frame-diagnostics";
import { PanelResizeHandle } from "@/shared/ui/PanelResizeHandle";

type SequenceIconButtonProps = {
	readonly label: string;
	readonly IconComponent: Icon;
	readonly onClick: () => void;
	readonly disabled?: boolean;
	readonly pressed?: boolean;
	readonly danger?: boolean;
};

const cameraRigIdFromSelection = (
	selection: SceneCameraAuthoringSelection | null,
): string | null => {
	if (!selection) return null;
	return "cameraRigId" in selection ? (selection.cameraRigId ?? null) : null;
};

function SequenceIconButton({
	label,
	IconComponent,
	onClick,
	disabled = false,
	pressed = false,
	danger = false,
}: SequenceIconButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			disabled={disabled}
			className={cn(
				"grid size-5 shrink-0 place-items-center rounded border text-fg-muted transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
				disabled
					? "cursor-not-allowed border-white/6 bg-black/15 text-fg-subtle opacity-35"
					: pressed
						? "border-accent/45 bg-accent-surface text-accent-fg"
						: danger
							? "border-white/8 bg-black/18 hover:border-danger/40 hover:text-danger-fg"
							: "border-white/8 bg-black/18 hover:border-white/18 hover:text-fg-secondary",
			)}
			onClick={onClick}
		>
			<IconComponent aria-hidden="true" size={11} />
		</button>
	);
}

function SequenceDurationInput({
	itemId,
	durationFrames,
	onCommit,
}: {
	readonly itemId: string;
	readonly durationFrames: number;
	readonly onCommit: (itemId: string, durationFrames: number) => void;
}) {
	const [draft, setDraft] = useState(String(durationFrames));

	useEffect(() => {
		setDraft(String(durationFrames));
	}, [durationFrames]);

	const commit = (): void => {
		const value = Number.parseInt(draft, 10);
		if (Number.isFinite(value) && value > 0) {
			onCommit(itemId, value);
			return;
		}
		setDraft(String(durationFrames));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (event.key === "Enter") event.currentTarget.blur();
		if (event.key === "Escape") {
			setDraft(String(durationFrames));
			event.currentTarget.blur();
		}
	};

	return (
		<input
			type="number"
			min={1}
			inputMode="numeric"
			aria-label="Scene duration frames"
			title="Scene duration frames"
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={commit}
			onKeyDown={onKeyDown}
			className="h-5 w-14 rounded border border-white/10 bg-black/24 px-1 text-right font-mono text-fg-secondary text-ui outline-none focus:border-accent/60"
		/>
	);
}

type SequenceStripProps = {
	readonly timeline: SceneSequenceTimeline;
	readonly currentArtboardId: string | undefined;
	readonly canInitialize: boolean;
	readonly onInitialize: () => void;
	readonly onMoveItem: (itemId: string, toIndex: number) => void;
	readonly onRemoveItem: (itemId: string) => void;
	readonly onSetDuration: (itemId: string, durationFrames: number) => void;
	readonly onFocusArtboard: (artboardId: string) => void;
};

/** Keeps the rAF playhead subscription inside one absolutely-positioned node. */
function SequencePlayhead({
	timeline,
}: {
	readonly timeline: SceneSequenceTimeline;
}) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const frameAddress = mapGlobalFrameToSequenceItem(timeline, currentFrame);
	const playheadPercent =
		timeline.totalFrames > 1 && frameAddress
			? (frameAddress.globalFrame / Math.max(1, timeline.totalFrames - 1)) * 100
			: null;
	return playheadPercent === null ? null : (
		<div
			className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent"
			style={{ left: `${playheadPercent}%` }}
		/>
	);
}

function SequenceItemBlock({
	resolved,
	index,
	totalItems,
	active,
	onMoveItem,
	onRemoveItem,
	onSetDuration,
	onFocusArtboard,
}: {
	readonly resolved: ResolvedSceneSequenceItem;
	readonly index: number;
	readonly totalItems: number;
	readonly active: boolean;
	readonly onMoveItem: (itemId: string, toIndex: number) => void;
	readonly onRemoveItem: (itemId: string) => void;
	readonly onSetDuration: (itemId: string, durationFrames: number) => void;
	readonly onFocusArtboard: (artboardId: string) => void;
}) {
	return (
		<div
			className={cn(
				"relative flex min-w-24 items-center gap-1 overflow-hidden border-r border-white/8 px-1.5 text-ui",
				active
					? "bg-accent-surface text-accent-fg"
					: "bg-white/[0.035] text-fg-secondary",
			)}
			style={{ flexGrow: Math.max(1, resolved.durationFrames), flexBasis: 0 }}
		>
			<button
				type="button"
				className="min-w-0 flex-1 truncate text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
				title={`${resolved.label}: ${resolved.startFrame}-${resolved.endFrameExclusive - 1}f`}
				onClick={() => onFocusArtboard(resolved.artboard.id)}
			>
				{resolved.label}
			</button>
			<SequenceDurationInput
				itemId={resolved.item.id}
				durationFrames={resolved.durationFrames}
				onCommit={onSetDuration}
			/>
			<SequenceIconButton
				label={`Move ${resolved.label} earlier`}
				IconComponent={CaretLeft}
				disabled={index === 0}
				onClick={() => onMoveItem(resolved.item.id, index - 1)}
			/>
			<SequenceIconButton
				label={`Move ${resolved.label} later`}
				IconComponent={CaretRight}
				disabled={index >= totalItems - 1}
				onClick={() => onMoveItem(resolved.item.id, index + 1)}
			/>
			<SequenceIconButton
				label={`Remove ${resolved.label} from sequence`}
				IconComponent={Trash}
				danger
				onClick={() => onRemoveItem(resolved.item.id)}
			/>
		</div>
	);
}

function SequenceStrip({
	timeline,
	currentArtboardId,
	canInitialize,
	onInitialize,
	onMoveItem,
	onRemoveItem,
	onSetDuration,
	onFocusArtboard,
}: SequenceStripProps) {
	const initializeLabel = timeline.sequence
		? "Refresh sequence from scene artboards"
		: "Create sequence from scene artboards";
	const issueLabel = timeline.issues.map((issue) => issue.message).join("\n");

	return (
		<div className="flex h-12 shrink-0 border-white/10 border-b bg-black/12">
			<div className="flex w-56 shrink-0 items-center gap-2 border-white/10 border-r px-2">
				<FilmStrip aria-hidden="true" size={14} className="text-fg-muted" />
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium text-fg-secondary text-ui">
						{timeline.sequence?.name ?? "Sequence"}
					</div>
					<div className="flex items-center gap-1 truncate text-fg-muted text-ui">
						<Timer aria-hidden="true" size={10} />
						<span className="font-mono">
							{timeline.totalFrames}f / {timeline.items.length}
						</span>
					</div>
				</div>
				{timeline.issues.length > 0 ? (
					<span title={issueLabel}>
						<WarningCircle
							aria-label="Sequence issues"
							size={14}
							className="text-warn-fg"
						/>
					</span>
				) : null}
				<SequenceIconButton
					label={initializeLabel}
					IconComponent={timeline.sequence ? ArrowsClockwise : Plus}
					disabled={!canInitialize}
					onClick={onInitialize}
				/>
			</div>
			<div className="relative flex min-w-0 flex-1 overflow-hidden">
				{timeline.items.length > 0 ? (
					timeline.items.map((resolved, index) => (
						<SequenceItemBlock
							key={resolved.item.id}
							resolved={resolved}
							index={index}
							totalItems={timeline.items.length}
							active={resolved.artboard.id === currentArtboardId}
							onMoveItem={onMoveItem}
							onRemoveItem={onRemoveItem}
							onSetDuration={onSetDuration}
							onFocusArtboard={onFocusArtboard}
						/>
					))
				) : (
					<div className="flex h-full items-center px-3 text-fg-subtle text-ui">
						No sequence scenes
					</div>
				)}
				<SequencePlayhead timeline={timeline} />
			</div>
		</div>
	);
}

export function TimelinePanel() {
	addFrameDiagnosticCount("react.TimelinePanel.commit");
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const sceneCameraSelection = useSelectionStore((state) => state.sceneCamera);
	const document = useSceneStore((state) => state.document);
	const applySceneCommand = useSceneStore((state) => state.apply);
	const motion = useMotionStore((state) => state.document);
	const timelineExpanded = useEditorChromeStore(
		(state) => state.timelineExpanded,
	);
	const toggleTimelineExpanded = useEditorChromeStore(
		(state) => state.toggleTimelineExpanded,
	);
	const timelineResize = usePanelResize("timeline");
	const sequenceTimeline = useMemo(
		() => resolveSequenceTimeline({ scene: document, motion }),
		[document, motion],
	);
	const currentArtboard = useMemo(
		() => selectCurrentArtboard(document),
		[document],
	);
	const sceneArtboardCount = useMemo(
		() => selectSceneArtboards(document).length,
		[document],
	);
	const activePrimaryNodeId =
		primaryNodeId && findNode(document, primaryNodeId) ? primaryNodeId : null;
	const selectedCameraRigId = cameraRigIdFromSelection(sceneCameraSelection);
	const canInitializeSequence = sceneArtboardCount > 0;
	const initializeSequence = (): void => {
		applySceneCommand(createInitializeSceneSequenceCommand());
	};
	const moveSequenceItem = (itemId: string, toIndex: number): void => {
		applySceneCommand(createMoveSceneSequenceItemCommand(itemId, toIndex));
	};
	const removeSequenceItem = (itemId: string): void => {
		applySceneCommand(createRemoveSceneSequenceItemCommand(itemId));
	};
	const setSequenceItemDuration = (
		itemId: string,
		durationFrames: number,
	): void => {
		applySceneCommand(
			createSetSceneSequenceItemDurationCommand(itemId, durationFrames),
		);
	};
	const focusArtboard = (artboardId: string): void => {
		applySceneCommand(
			createSetCurrentArtboardCommand(artboardId, {
				label: "Focus sequence scene",
			}),
		);
	};

	// Height is owned by the `.timeline-panel` CSS rule (compact `clamp()` by
	// default, the resizable `--editor-timeline-expanded-height` under
	// `.editor-grid.timeline-mode`). No inline height — it would beat the
	// stylesheet and block the mode rule.
	return (
		<section className="timeline-panel relative flex min-w-0 flex-col overflow-hidden rounded-md border border-white/10 bg-surface-raised/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
			<SequenceStrip
				timeline={sequenceTimeline}
				currentArtboardId={currentArtboard.id}
				canInitialize={canInitializeSequence}
				onInitialize={initializeSequence}
				onMoveItem={moveSequenceItem}
				onRemoveItem={removeSequenceItem}
				onSetDuration={setSequenceItemDuration}
				onFocusArtboard={focusArtboard}
			/>
			<div className="min-h-0 flex-1">
				<MotionTimeline
					primaryNodeId={activePrimaryNodeId}
					selectedCameraRigId={selectedCameraRigId}
					maximized={timelineExpanded}
					onToggleMaximize={toggleTimelineExpanded}
				/>
			</div>
			{timelineExpanded ? (
				<PanelResizeHandle
					panelName="Timeline"
					orientation="horizontal"
					{...timelineResize}
				/>
			) : null}
		</section>
	);
}
