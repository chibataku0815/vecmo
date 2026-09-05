import {
	ArrowsInSimple,
	ArrowsOutSimple,
	CaretDown,
	CaretUp,
	ChartLine,
	FilmStrip,
	Plus,
	Trash,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { validateAnimationClipTrackAssignment } from "@/entities/motion/model/clips";
import { useMotionStore } from "@/entities/motion/model/store";
import type { AnimationClip } from "@/entities/motion/model/types";
import type { MotionGrammarAuthoringProfileDescriptor } from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import { motionGrammarAuthoringTimelineLabel } from "@/entities/motion-grammar/model/authoring-system";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { buildMotionGrammarSystemMap } from "@/entities/motion-grammar/model/system-map";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import { createId } from "@/shared/lib/id";
import { frameFromClientX } from "@/shared/lib/timeline-scrub";
import { addFrameDiagnosticCount } from "@/shared/performance/frame-diagnostics";
import { useAuthoringTransportFrame } from "../model/authoring-frame";
import { useMotionClipSelectionStore } from "../model/clip-selection-store";
import {
	buildMotionClipTimelineState,
	createTimelineClipAssignTracksCommand,
	createTimelineClipCreateCommand,
	createTimelineClipDeleteCommand,
	createTimelineClipRenameCommand,
	createTimelineClipReorderCommand,
	createTimelineClipTrimRangeForEdge,
	type MotionClipTimelineRow,
	type MotionClipTrimEdge,
	resolveMotionClipTimelineSelection,
} from "../model/clip-timeline";
import {
	applyMotionSystemRetimeInGesture,
	beginMotionSystemRetimeGesture,
	commitMotionSystemRetimeGesture,
	type MotionSystemRetimeGesture,
} from "../model/motion-system-retime";
import { useTransportStore } from "../model/transport-store";
import { EasingPicker } from "./EasingPicker";
import { TemporalGraphEditor } from "./TemporalGraphEditor";
import { TimelinePlayheadLine, TimelineRulerStrip } from "./TimelinePlayhead";
import { TimelineScrubSurface } from "./TimelineScrubSurface";
import { TimelineTracks } from "./TimelineTracks";
import { TransportControls } from "./TransportControls";
import { isTextAnimatorOffsetSelectedKey } from "./timeline-adapter";
import {
	resolveTimelineTransportFrame,
	timelineTransportKeyboardAction,
} from "./timeline-keyboard";
import { frameToPercent, type SelectedKey } from "./timeline-model";
import { useTimelineScrub } from "./use-timeline-scrub";

type MotionTimelineProps = {
	/** Primary selection, passed from the widget layer for the "key pose" action. */
	readonly primaryNodeId: string | null;
	/** Camera-authoring selection, passed by the widget layer to avoid feature imports. */
	readonly selectedCameraRigId?: string | null;
	/** True when Timeline mode (the tall docked layout) is active. */
	readonly maximized?: boolean;
	/**
	 * Toggle Timeline mode. Threaded from the widget layer so this feature never
	 * imports the editor (tool-selection) store — keeping the import direction
	 * `widgets -> features` legal.
	 */
	readonly onToggleMaximize?: () => void;
};

const TIMELINE_INTERACTIVE_SELECTOR =
	"button, input, textarea, select, a[href], summary, [contenteditable='true'], [contenteditable='plaintext-only']";

const clipWidthPercent = (
	startFrame: number,
	durationFrames: number,
	documentDurationFrames: number,
): number => {
	const start = frameToPercent(startFrame, documentDurationFrames);
	const end = frameToPercent(
		startFrame + Math.max(1, durationFrames),
		documentDurationFrames,
	);
	return Math.max(2, end - start);
};

type ClipTrimDragState = {
	clipId: string;
	edge: MotionClipTrimEdge;
	transaction: MotionSystemRetimeGesture;
	startFrame: number;
	durationFrames: number;
};

type ClipLaneProps = {
	readonly primaryNodeId: string | null;
	readonly selectedClipId: string | null;
	readonly onSelectClip: (clipId: string | null) => void;
	readonly onClearSelectedKey: () => void;
};

const clipToneClass = (clip: MotionClipTimelineRow): string => {
	if (clip.selected) {
		return "border-accent/80 bg-accent-surface text-accent-fg ring-1 ring-white/[0.08]";
	}
	if (clip.activeAtFrame) {
		return "border-accent/55 bg-accent-surface/90 text-accent-fg";
	}
	return "border-white/10 bg-white/[0.05] text-fg-secondary";
};

const localFrameForClip = (
	clip: AnimationClip,
	currentFrame: number,
): number | null => {
	const frame = Math.round(currentFrame);
	const startFrame = Math.max(0, Math.round(clip.startFrame));
	const durationFrames = Math.max(1, Math.round(clip.durationFrames));
	const endFrame = startFrame + durationFrames - 1;
	if (frame < startFrame || frame > endFrame) return null;
	return frame - startFrame;
};

function MotionSystemTimelineDetails({
	clip,
	profile,
	currentFrame,
	durationFrames,
	fps,
}: {
	readonly clip: AnimationClip;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
	readonly currentFrame: number;
	readonly durationFrames: number;
	readonly fps: number;
}) {
	const localFrame = localFrameForClip(clip, currentFrame);
	const systemMap = buildMotionGrammarSystemMap(profile);
	const clipLeft = frameToPercent(clip.startFrame, durationFrames);
	const clipWidth = clipWidthPercent(
		clip.startFrame,
		clip.durationFrames,
		durationFrames,
	);
	return (
		<section
			className="timeline-scroll-region flex min-h-0 min-w-0 flex-1 overflow-hidden border-white/10 border-t"
			aria-label="Motion system timeline"
		>
			<div className="w-56 shrink-0 border-white/10 border-r">
				<div className="flex h-6 items-center border-white/10 border-b px-2 text-fg-secondary text-ui">
					Motion system
				</div>
				<div className="grid border-white/[0.06] border-b px-2 py-1 text-ui">
					<span className="truncate text-fg">{clip.name}</span>
					<span className="truncate text-fg-muted">
						{motionGrammarAuthoringTimelineLabel(profile.timeline.mode)}
					</span>
				</div>
				<div className="grid grid-cols-2 gap-1 p-2 text-ui">
					<div className="rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
						<div className="font-mono text-fg leading-3">
							{clip.durationFrames}f
						</div>
						<div className="text-fg-muted leading-3">Duration</div>
					</div>
					<div className="rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
						<div className="font-mono text-fg leading-3">
							{localFrame === null ? "off" : `${localFrame}f`}
						</div>
						<div className="text-fg-muted leading-3">Local</div>
					</div>
					<div className="rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
						<div className="font-mono text-fg leading-3">
							{systemMap.replaceableSlots}/{systemMap.totalSlots}
						</div>
						<div className="text-fg-muted leading-3">Replace</div>
					</div>
					<div className="rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
						<div className="font-mono text-fg leading-3">
							{systemMap.runtimeOnlySlots}
						</div>
						<div className="text-fg-muted leading-3">Runtime</div>
					</div>
				</div>
			</div>
			<div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-black/10">
				<TimelineScrubSurface
					durationFrames={durationFrames}
					fps={fps}
					className="flex min-h-0 flex-1 flex-col"
				>
					<div className="h-6 shrink-0 border-white/10 border-b" />
					<div className="relative min-h-14 flex-1 border-white/[0.06] border-b">
						<div
							className={cn(
								"absolute top-2 flex h-9 min-w-20 items-center rounded border px-2 text-ui",
								localFrame === null
									? "border-white/10 bg-white/[0.035] text-fg-muted"
									: "border-accent/70 bg-accent-surface text-accent-fg",
							)}
							style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
						>
							<span className="min-w-0 truncate">
								{motionGrammarAuthoringTimelineLabel(profile.timeline.mode)} ·{" "}
								{clip.startFrame}-{clip.startFrame + clip.durationFrames - 1}f
							</span>
						</div>
					</div>
				</TimelineScrubSurface>
				<div className="grid shrink-0 grid-cols-3 gap-1 px-3 py-3 text-ui">
					{systemMap.buckets.map((bucket) => (
						<div
							key={bucket.id}
							className="rounded border border-white/8 bg-black/20 px-2 py-1"
							title={bucket.summary}
						>
							<div className="truncate font-mono text-fg leading-3">
								{bucket.count}
							</div>
							<div className="truncate text-fg-muted leading-3">
								{bucket.shortLabel}
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function ClipLane({
	primaryNodeId,
	selectedClipId,
	onSelectClip,
	onClearSelectedKey,
}: ClipLaneProps) {
	const motion = useMotionStore((state) => state.document);
	const scene = useSceneStore((state) => state.document);
	const currentFrame = useAuthoringTransportFrame();
	const state = buildMotionClipTimelineState({
		motion,
		currentFrame,
		selectedClipId,
	});
	const resolvedSelectedClipId = resolveMotionClipTimelineSelection(state);
	const selectedClip = state.clips.find((clip) => clip.selected) ?? null;
	const selectedClipRowId = selectedClip?.id ?? null;
	const selectedClipName = selectedClip?.name ?? "";
	const [renameDraft, setRenameDraft] = useState(selectedClipName);
	const laneRef = useRef<HTMLDivElement>(null);
	const trimDragRef = useRef<ClipTrimDragState | null>(null);
	const skipRenameCommitRef = useRef(false);
	const scrub = useTimelineScrub({
		laneRef,
		durationFrames: state.durationFrames,
		isOtherGestureActive: () => trimDragRef.current !== null,
	});

	useLayoutEffect(() => {
		if (resolvedSelectedClipId !== selectedClipId) {
			onSelectClip(resolvedSelectedClipId);
		}
	}, [onSelectClip, resolvedSelectedClipId, selectedClipId]);

	useEffect(() => {
		skipRenameCommitRef.current = false;
		if (!selectedClipRowId) {
			setRenameDraft("");
			return;
		}
		setRenameDraft(selectedClipName);
	}, [selectedClipRowId, selectedClipName]);

	useEffect(
		() => () => {
			const drag = trimDragRef.current;
			if (!drag) return;
			commitMotionSystemRetimeGesture(drag.transaction);
			trimDragRef.current = null;
		},
		[],
	);

	const selectClip = (clipId: string | null): void => {
		onSelectClip(clipId);
		onClearSelectedKey();
	};

	const addClip = () => {
		const startFrame = state.currentFrame;
		const maxDurationFrames = Math.max(
			1,
			motion.durationFrames - startFrame + 1,
		);
		const durationFrames = Math.min(
			Math.max(1, Math.round(motion.fps)),
			maxDurationFrames,
		);
		const trackIds = primaryNodeId
			? motion.tracks
					.filter((track) => track.target.nodeId === primaryNodeId)
					.map((track) => track.id)
			: [];
		const clipId = createId("clip");
		useMotionStore.getState().apply(
			createTimelineClipCreateCommand({
				id: clipId,
				name: `Clip ${motion.clips.length + 1}`,
				startFrame,
				durationFrames,
				trackIds,
			}),
		);
		selectClip(clipId);
	};
	const removeClip = (clipId: string) => {
		useMotionStore.getState().apply(createTimelineClipDeleteCommand(clipId));
		if (selectedClipId === clipId) onSelectClip(null);
		onClearSelectedKey();
	};
	const commitRename = () => {
		if (!selectedClip) return;
		useMotionStore
			.getState()
			.apply(createTimelineClipRenameCommand(selectedClip.id, renameDraft));
	};
	const commitRenameFromBlur = (): void => {
		if (skipRenameCommitRef.current) {
			skipRenameCommitRef.current = false;
			return;
		}
		commitRename();
	};
	const reorderSelectedClip = (offset: -1 | 1): void => {
		if (!selectedClip) return;
		useMotionStore
			.getState()
			.apply(
				createTimelineClipReorderCommand(
					selectedClip.id,
					selectedClip.index + offset,
				),
			);
	};
	const toggleSelectedClipTrack = (trackId: string): void => {
		if (!selectedClip) return;
		const assigned = selectedClip.trackIds.includes(trackId);
		const trackIds = assigned
			? selectedClip.trackIds.filter((candidate) => candidate !== trackId)
			: [...selectedClip.trackIds, trackId];
		useMotionStore
			.getState()
			.apply(createTimelineClipAssignTracksCommand(selectedClip.id, trackIds));
	};
	const trackAssignmentIssue = (trackId: string): string | null => {
		if (!selectedClip || selectedClip.trackIds.includes(trackId)) return null;
		const validation = validateAnimationClipTrackAssignment(
			motion,
			[...selectedClip.trackIds, trackId],
			{ clipId: selectedClip.id, range: selectedClip },
		);
		const rejection = validation.rejected.find(
			(candidate) => candidate.trackId === trackId,
		);
		if (!rejection) return null;
		return rejection.reason === "overlapping-range"
			? "Already assigned to an overlapping clip"
			: rejection.reason === "missing-track"
				? "Track is no longer available"
				: "Track is already included";
	};
	const trimClipToFrame = (clientX: number): void => {
		const drag = trimDragRef.current;
		if (!drag) return;
		const rect = laneRef.current?.getBoundingClientRect() ?? {
			left: 0,
			width: 0,
		};
		const nextRange = createTimelineClipTrimRangeForEdge({
			clip: {
				startFrame: drag.startFrame,
				durationFrames: drag.durationFrames,
			},
			edge: drag.edge,
			frame: frameFromClientX(clientX, rect, state.durationFrames, {
				round: true,
			}),
			durationFrames: state.durationFrames,
		});
		if (
			nextRange.startFrame === drag.startFrame &&
			nextRange.durationFrames === drag.durationFrames
		) {
			return;
		}
		const result = applyMotionSystemRetimeInGesture({
			gesture: drag.transaction,
			clipId: drag.clipId,
			range: nextRange,
		});
		if (result.status === "blocked") {
			commitMotionSystemRetimeGesture(drag.transaction);
			trimDragRef.current = null;
			return;
		}
		drag.startFrame = nextRange.startFrame;
		drag.durationFrames = nextRange.durationFrames;
	};
	const startTrim = (
		event: React.PointerEvent<HTMLButtonElement>,
		clip: MotionClipTimelineRow,
		edge: MotionClipTrimEdge,
	): void => {
		event.preventDefault();
		event.stopPropagation();
		selectClip(clip.id);
		const transaction = beginMotionSystemRetimeGesture(
			"motion-clip-trim",
			edge === "start" ? "Trim clip start" : "Trim clip end",
		);
		trimDragRef.current = {
			clipId: clip.id,
			edge,
			transaction,
			startFrame: clip.startFrame,
			durationFrames: clip.durationFrames,
		};
		laneRef.current?.setPointerCapture(event.pointerId);
	};
	const onLanePointerDown = (
		event: React.PointerEvent<HTMLDivElement>,
	): void => {
		if (
			event.target instanceof Element &&
			event.target.closest(TIMELINE_INTERACTIVE_SELECTOR)
		) {
			return;
		}
		scrub.onScrubPointerDown(event);
	};
	const onLanePointerMove = (
		event: React.PointerEvent<HTMLDivElement>,
	): void => {
		if (trimDragRef.current) {
			event.preventDefault();
			trimClipToFrame(event.clientX);
			return;
		}
		scrub.onScrubPointerMove(event);
	};
	const endTrim = (event: React.PointerEvent<HTMLDivElement>): void => {
		const drag = trimDragRef.current;
		if (drag) commitMotionSystemRetimeGesture(drag.transaction);
		trimDragRef.current = null;
		scrub.onScrubPointerUp(event);
	};

	return (
		<>
			<div className="flex h-9 shrink-0 border-white/10 border-b">
				<div className="flex w-56 shrink-0 items-center gap-2 border-white/10 border-r px-2">
					<span className="min-w-0 flex-1 truncate text-fg-secondary text-ui">
						Clips
					</span>
					<button
						type="button"
						aria-label="Create animation clip"
						title="Create animation clip at current frame"
						onClick={addClip}
						className="grid size-6 place-items-center rounded-md border border-white/10 bg-white/[0.035] text-fg-secondary transition hover:border-accent/50 hover:text-accent-fg"
					>
						<Plus aria-hidden="true" size={12} />
					</button>
				</div>
				<div
					ref={laneRef}
					className="relative min-w-0 flex-1 cursor-pointer touch-none select-none overflow-hidden bg-black/10"
					onPointerDown={onLanePointerDown}
					onPointerMove={onLanePointerMove}
					onPointerUp={endTrim}
					onPointerCancel={endTrim}
					onLostPointerCapture={endTrim}
				>
					{state.hasClips ? (
						state.clips.map((clip) => {
							const width = clipWidthPercent(
								clip.startFrame,
								clip.durationFrames,
								state.durationFrames,
							);
							return (
								<div
									key={clip.id}
									className={cn(
										"absolute top-1 bottom-1 flex min-w-14 items-center gap-1 rounded border px-1.5 text-ui",
										clipToneClass(clip),
									)}
									style={{
										left: `${frameToPercent(clip.startFrame, state.durationFrames)}%`,
										width: `${width}%`,
									}}
									title={`${clip.name}: ${clip.startFrame}-${clip.endFrame}f / ${clip.trackCount} tracks`}
									onPointerDown={(event) => {
										event.stopPropagation();
										selectClip(clip.id);
									}}
								>
									{clip.selected ? (
										<>
											<button
												type="button"
												aria-label={`Trim start of ${clip.name}`}
												title={`Trim start of ${clip.name}`}
												onPointerDown={(event) =>
													startTrim(event, clip, "start")
												}
												className="-left-px absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize rounded-l border-accent/70 border-l bg-accent/20"
											/>
											<button
												type="button"
												aria-label={`Trim end of ${clip.name}`}
												title={`Trim end of ${clip.name}`}
												onPointerDown={(event) => startTrim(event, clip, "end")}
												className="-right-px absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize rounded-r border-accent/70 border-r bg-accent/20"
											/>
											<input
												aria-label={`Rename ${clip.name}`}
												value={renameDraft}
												onChange={(event) => setRenameDraft(event.target.value)}
												onBlur={commitRenameFromBlur}
												onKeyDown={(event) => {
													if (event.key === "Enter") {
														commitRename();
														event.currentTarget.blur();
													}
													if (event.key === "Escape") {
														skipRenameCommitRef.current = true;
														setRenameDraft(clip.name);
														event.currentTarget.blur();
													}
												}}
												onPointerDown={(event) => event.stopPropagation()}
												className="relative z-20 h-5 min-w-0 flex-1 rounded-sm border border-white/10 bg-black/25 px-1 text-fg text-ui outline-none focus:border-accent/70"
											/>
										</>
									) : (
										<span className="min-w-0 flex-1 truncate">{clip.name}</span>
									)}
									<span className="shrink-0 font-mono text-fg-muted text-ui">
										{clip.trackCount}
									</span>
									<button
										type="button"
										aria-label={`Delete ${clip.name}`}
										title={`Delete ${clip.name}`}
										onPointerDown={(event) => event.stopPropagation()}
										onClick={() => removeClip(clip.id)}
										className="relative z-20 grid size-4 shrink-0 place-items-center rounded border border-white/10 bg-black/20 text-fg-muted hover:border-danger/50 hover:text-danger-fg"
									>
										<Trash aria-hidden="true" size={9} />
									</button>
								</div>
							);
						})
					) : (
						<div className="flex h-full items-center px-2 text-fg-subtle text-ui">
							Create clips to block animation ranges.
						</div>
					)}
					<TimelinePlayheadLine durationFrames={state.durationFrames} />
				</div>
			</div>
			{selectedClip ? (
				<div className="flex min-h-10 shrink-0 border-white/10 border-b bg-black/10">
					<div className="flex w-56 shrink-0 items-center gap-1 border-white/10 border-r px-2">
						<span className="min-w-0 flex-1 truncate text-fg-secondary text-ui">
							Tracks · {selectedClip.name}
						</span>
						<button
							type="button"
							aria-label={`Move ${selectedClip.name} earlier`}
							title="Move clip earlier in lane order"
							disabled={selectedClip.index === 0}
							onClick={() => reorderSelectedClip(-1)}
							className="grid size-5 place-items-center rounded border border-white/10 text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
						>
							<CaretUp aria-hidden="true" size={10} />
						</button>
						<button
							type="button"
							aria-label={`Move ${selectedClip.name} later`}
							title="Move clip later in lane order"
							disabled={selectedClip.index === state.clips.length - 1}
							onClick={() => reorderSelectedClip(1)}
							className="grid size-5 place-items-center rounded border border-white/10 text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
						>
							<CaretDown aria-hidden="true" size={10} />
						</button>
					</div>
					<div className="flex max-h-24 min-w-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto p-1.5">
						{motion.tracks.length > 0 ? (
							motion.tracks.map((track) => {
								const assigned = selectedClip.trackIds.includes(track.id);
								const issue = trackAssignmentIssue(track.id);
								const nodeName = findNode(scene, track.target.nodeId)?.name;
								const label = `${nodeName ?? track.target.nodeId} · ${track.target.property}`;
								return (
									<button
										key={track.id}
										type="button"
										aria-pressed={assigned}
										disabled={issue !== null}
										title={
											issue ?? `${assigned ? "Remove" : "Assign"} ${label}`
										}
										onClick={() => toggleSelectedClipTrack(track.id)}
										className={cn(
											"h-6 max-w-56 truncate rounded border px-2 text-ui transition",
											assigned
												? "border-accent/55 bg-accent-surface text-accent-fg"
												: "border-white/10 bg-white/[0.035] text-fg-secondary hover:border-white/20",
											issue && "cursor-not-allowed opacity-35",
										)}
									>
										{label}
									</button>
								);
							})
						) : (
							<span className="px-1 text-fg-subtle text-ui">
								Create a keyframe track before assigning clip membership.
							</span>
						)}
					</div>
				</div>
			) : null}
		</>
	);
}

/**
 * Full timeline surface: transport on top, scrollable keyframe lanes in the
 * middle, and the easing editor for the selected key pinned to the bottom. The
 * selected-key state lives here so the lanes and the editor stay in sync.
 */
export function MotionTimeline({
	primaryNodeId,
	selectedCameraRigId = null,
	maximized = false,
	onToggleMaximize,
}: MotionTimelineProps) {
	addFrameDiagnosticCount("react.MotionTimeline.commit");
	const [selectedKey, setSelectedKey] = useState<SelectedKey | null>(null);
	const [graphVisible, setGraphVisible] = useState(false);
	const motion = useMotionStore((state) => state.document);
	const grammarBindings = useMotionGrammarStore(
		(state) => state.document.bindings,
	);
	const selectedClipId = useMotionClipSelectionStore(
		(state) => state.selectedClipId,
	);
	const setSelectedClipId = useMotionClipSelectionStore(
		(state) => state.setSelectedClipId,
	);
	const graphFocusIntent = useEditorChromeStore(
		(state) => state.graphFocusIntent,
	);
	const consumeGraphFocus = useEditorChromeStore(
		(state) => state.consumeGraphFocus,
	);
	const currentFrame = useAuthoringTransportFrame();
	const selectedClip =
		selectedClipId !== null
			? (motion.clips.find((clip) => clip.id === selectedClipId) ?? null)
			: null;
	const selectedBinding =
		selectedClip?.provenance?.source === "motion-grammar"
			? (grammarBindings.find(
					(binding) => binding.id === selectedClip.provenance?.bindingId,
				) ?? null)
			: null;
	const selectedProfile = selectedBinding
		? (describeMotionGrammarAuthoringProfile(selectedBinding) ?? null)
		: null;
	const selectedMotionSystem =
		selectedClip && selectedProfile
			? { clip: selectedClip, profile: selectedProfile }
			: null;
	const fps = motion.fps;
	const durationFrames = motion.durationFrames;
	useEffect(() => {
		if (selectedMotionSystem && selectedKey) setSelectedKey(null);
	}, [selectedKey, selectedMotionSystem]);
	useEffect(() => {
		if (!maximized || !selectedKey) setGraphVisible(false);
	}, [maximized, selectedKey]);
	const selectKey = (
		key: SelectedKey | null,
		options: { readonly deferTextAnimatorGraph?: boolean } = {},
	): void => {
		setSelectedKey(key);
		if (!key) return;
		setSelectedClipId(null);
		if (
			isTextAnimatorOffsetSelectedKey(key) &&
			!options.deferTextAnimatorGraph
		) {
			setGraphVisible(true);
			if (!maximized) onToggleMaximize?.();
		}
	};
	// Consume an "Open in Graph" request (Creator 2, C2-L2) exactly once: resolve
	// the requested track against the live MotionDocument and seed the Value/Speed
	// Graph on one of its keys. Fail closed — if the track no longer exists or has
	// no keyframes, drop the request rather than guess. `requestGraphFocus` already
	// forced Timeline mode, so `maximized` is true by the time this runs.
	useEffect(() => {
		if (!graphFocusIntent) return;
		const track = motion.tracks.find(
			(candidate) => candidate.id === graphFocusIntent.trackId,
		);
		if (!track || track.keyframes.length === 0) {
			consumeGraphFocus();
			return;
		}
		const requestedFrame = graphFocusIntent.frame;
		const seedFrame =
			requestedFrame !== undefined &&
			track.keyframes.some((keyframe) => keyframe.time === requestedFrame)
				? requestedFrame
				: track.keyframes[0].time;
		setSelectedClipId(null);
		setSelectedKey({
			kind: "node",
			trackId: track.id,
			nodeId: track.target.nodeId,
			property: track.target.property,
			frame: seedFrame,
		});
		setGraphVisible(true);
		consumeGraphFocus();
	}, [graphFocusIntent, motion.tracks, consumeGraphFocus, setSelectedClipId]);
	const onTimelineKeyDown = (
		event: React.KeyboardEvent<HTMLDivElement>,
	): void => {
		const action = timelineTransportKeyboardAction(event, {
			largeStepFrames: Math.max(1, Math.round(fps)),
		});
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		const transport = useTransportStore.getState();
		if (action.type === "toggle-play") {
			transport.togglePlay();
			return;
		}
		const targetFrame = resolveTimelineTransportFrame(
			action,
			transport.currentFrame,
			durationFrames,
		);
		if (targetFrame === null) return;
		transport.pause();
		transport.setFrame(targetFrame);
	};
	const onTimelinePointerDown = (
		event: React.PointerEvent<HTMLDivElement>,
	): void => {
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest(TIMELINE_INTERACTIVE_SELECTOR)
		) {
			return;
		}
		event.currentTarget.focus({ preventScroll: true });
	};

	return (
		<div
			className="flex h-full flex-col outline-none focus-visible:ring-1 focus-visible:ring-accent/70 focus-within:ring-1 focus-within:ring-accent/70"
			role="application"
			aria-label="Motion timeline"
			aria-keyshortcuts="Space ArrowLeft ArrowRight PageUp PageDown Home End"
			tabIndex={-1}
			onKeyDown={onTimelineKeyDown}
			onPointerDown={onTimelinePointerDown}
		>
			<div className="flex h-10 shrink-0 items-center justify-between gap-3 border-white/10 border-b px-3">
				<div className="flex items-center gap-2 text-fg text-ui">
					<FilmStrip aria-hidden="true" size={15} />
					Timeline
					{onToggleMaximize ? (
						<button
							type="button"
							aria-label={
								maximized ? "Exit timeline mode" : "Enter timeline mode"
							}
							aria-pressed={maximized}
							title={
								maximized
									? "Exit timeline mode (restore)"
									: "Enter timeline mode (expand)"
							}
							className={cn(
								"grid size-5 place-items-center rounded border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
								maximized
									? "border-accent/45 bg-accent-surface text-accent-fg"
									: "border-white/8 bg-black/18 text-fg-muted hover:border-white/18 hover:text-fg-secondary",
							)}
							onClick={onToggleMaximize}
						>
							{maximized ? (
								<ArrowsInSimple aria-hidden="true" size={12} weight="bold" />
							) : (
								<ArrowsOutSimple aria-hidden="true" size={12} weight="bold" />
							)}
						</button>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					{maximized && selectedKey && !selectedMotionSystem ? (
						<button
							type="button"
							aria-pressed={graphVisible}
							title="Toggle Value / Speed Graph"
							onClick={() => setGraphVisible((visible) => !visible)}
							className={cn(
								"flex h-6 items-center gap-1 rounded border px-2 text-ui",
								graphVisible
									? "border-accent/55 bg-accent-surface text-accent-fg"
									: "border-white/10 bg-white/[0.035] text-fg-secondary",
							)}
						>
							<ChartLine aria-hidden="true" size={12} />
							Graph
						</button>
					) : null}
					<TransportControls primaryNodeId={primaryNodeId} />
				</div>
			</div>
			<TimelineRulerStrip
				durationFrames={durationFrames}
				fps={fps}
				renderTicks
			/>
			<ClipLane
				primaryNodeId={primaryNodeId}
				selectedClipId={selectedClipId}
				onSelectClip={setSelectedClipId}
				onClearSelectedKey={() => setSelectedKey(null)}
			/>
			{selectedMotionSystem ? (
				<MotionSystemTimelineDetails
					clip={selectedMotionSystem.clip}
					profile={selectedMotionSystem.profile}
					currentFrame={currentFrame}
					durationFrames={durationFrames}
					fps={fps}
				/>
			) : graphVisible && selectedKey ? (
				<TemporalGraphEditor
					selectedKey={selectedKey}
					onSelectKey={selectKey}
				/>
			) : (
				<TimelineTracks
					primaryNodeId={primaryNodeId}
					selectedCameraRigId={selectedCameraRigId}
					selectedKey={selectedKey}
					onSelectKey={selectKey}
				/>
			)}
			{selectedKey && !selectedMotionSystem ? (
				<EasingPicker
					selectedKey={selectedKey}
					onClear={() => selectKey(null)}
					onSelectKey={selectKey}
				/>
			) : null}
		</div>
	);
}
