import {
	Circle,
	CursorClick,
	Diamond,
	Pause,
	Play,
	Repeat,
	Stop,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import { readInteractions } from "@/entities/scene/model/interactions";
import { useSceneStore } from "@/entities/scene/model/store";
import { cn } from "@/shared/lib/cn";
import { parseFrameInput } from "@/shared/lib/timeline-scrub";
import { IconButton } from "@/shared/ui/IconButton";
import { keyNodePoseAtPlayhead } from "../model/key-pose";
import { useTransportStore } from "../model/transport-store";

type TransportControlsProps = {
	/** Primary selection, threaded from the widget layer (features can't read it). */
	readonly primaryNodeId: string | null;
};

type FrameFieldProps = {
	readonly currentFrame: number;
	readonly durationFrames: number;
};

/**
 * The current-frame readout, clickable to type an exact target frame. Display mode is a
 * button showing the rounded frame; clicking opens a small numeric input. Commit (Enter
 * or blur) pauses playback and seeks to the parsed, clamped frame — the same ephemeral,
 * undo-free transport write the scrub gesture uses; Escape cancels. The input swallows
 * its own keydowns so the timeline's Space/arrow transport shortcuts never fire while
 * typing (the keyboard guard already ignores INPUT targets; this is belt-and-suspenders).
 */
function FrameField({ currentFrame, durationFrames }: FrameFieldProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const skipCommitRef = useRef(false);
	const displayFrame = Math.round(currentFrame);

	if (draft === null) {
		return (
			<button
				type="button"
				aria-label={`Current frame ${displayFrame}. Click to set the playhead frame.`}
				title="Set playhead frame"
				onClick={() => {
					skipCommitRef.current = false;
					setDraft(String(displayFrame));
				}}
				className="rounded-sm px-0.5 font-mono text-ui text-warn tabular-nums outline-none transition hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-accent/70"
			>
				{displayFrame}
			</button>
		);
	}

	const close = (commit: boolean, raw: string): void => {
		if (commit) {
			const frame = parseFrameInput(raw, durationFrames);
			if (frame !== null) {
				const transport = useTransportStore.getState();
				transport.pause();
				transport.setFrame(frame);
			}
		}
		setDraft(null);
	};

	return (
		<input
			// biome-ignore lint/a11y/noAutofocus: the field mounts only on an explicit click, so focusing it is the intent.
			autoFocus
			aria-label="Current frame"
			inputMode="numeric"
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onFocus={(event) => event.currentTarget.select()}
			onBlur={(event) => {
				const skip = skipCommitRef.current;
				skipCommitRef.current = false;
				close(!skip, event.currentTarget.value);
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.currentTarget.blur();
				} else if (event.key === "Escape") {
					skipCommitRef.current = true;
					event.currentTarget.blur();
				}
			}}
			className="w-10 rounded-sm bg-black/30 px-1 font-mono text-ui text-warn tabular-nums outline-none ring-1 ring-accent/70"
		/>
	);
}

/**
 * Preview-interactions toggle label, describing WHY it is disabled or noting
 * the one trigger kind (`scroll-progress`) this editor preview cannot
 * simulate (host-scroll-driven; see `interactionPreview`'s own JSDoc in
 * `CanvasShell.tsx` and the product-knowledge doc for the full rationale).
 */
const interactionPreviewToggleLabel = (
	active: boolean,
	interactionCount: number,
	hasScrollProgressTrigger: boolean,
): string => {
	if (interactionCount === 0) {
		return "Preview interactions (no interactions authored yet)";
	}
	const base = active
		? "Exit interaction preview (Esc)"
		: "Preview interactions";
	return hasScrollProgressTrigger
		? `${base} — scroll-progress triggers are not simulated in the editor`
		: base;
};

export function TransportControls({ primaryNodeId }: TransportControlsProps) {
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const isPlaying = useTransportStore((state) => state.isPlaying);
	const loop = useTransportStore((state) => state.loop);
	const recording = useTransportStore((state) => state.recording);
	const interactionPreview = useTransportStore(
		(state) => state.interactionPreview,
	);
	const togglePlay = useTransportStore((state) => state.togglePlay);
	const stop = useTransportStore((state) => state.stop);
	const toggleLoop = useTransportStore((state) => state.toggleLoop);
	const toggleRecording = useTransportStore((state) => state.toggleRecording);
	const toggleInteractionPreview = useTransportStore(
		(state) => state.toggleInteractionPreview,
	);
	const fps = useMotionStore((state) => state.document.fps);
	const durationFrames = useMotionStore(
		(state) => state.document.durationFrames,
	);
	// Select the raw field (stable reference unless an interactions-library
	// command actually ran), not `readInteractions`'s output — that helper
	// allocates a fresh array on every call, which would re-render this
	// component on every unrelated scene edit if used directly inside the
	// selector.
	const rawInteractions = useSceneStore((state) => state.document.interactions);
	const interactions = readInteractions({ interactions: rawInteractions });
	const hasScrollProgressTrigger = interactions.some(
		(interaction) => interaction.trigger.kind === "scroll-progress",
	);

	return (
		<div className="flex items-center gap-2">
			<IconButton
				icon={isPlaying ? Pause : Play}
				label={isPlaying ? "Pause" : "Play"}
				active={isPlaying}
				onClick={togglePlay}
			/>
			<IconButton icon={Stop} label="Stop" onClick={stop} />
			<IconButton
				icon={Repeat}
				label="Loop"
				active={loop}
				onClick={toggleLoop}
			/>
			<IconButton
				icon={CursorClick}
				label={interactionPreviewToggleLabel(
					interactionPreview,
					interactions.length,
					hasScrollProgressTrigger,
				)}
				active={interactionPreview}
				disabled={interactions.length === 0}
				onClick={toggleInteractionPreview}
			/>
			<button
				type="button"
				aria-label={recording ? "Auto-key on" : "Auto-key off"}
				aria-pressed={recording}
				title={recording ? "Auto-key on" : "Auto-key off"}
				onClick={toggleRecording}
				className={cn(
					"inline-flex h-8 items-center gap-1 rounded-md border px-2 text-ui transition",
					recording
						? "border-warn bg-warn-surface text-warn-fg"
						: "border-hairline/8 bg-hairline/5 text-fg-secondary hover:border-hairline/20 hover:bg-hairline/10 hover:text-fg",
				)}
			>
				<Circle
					aria-hidden="true"
					size={12}
					weight={recording ? "fill" : "regular"}
				/>
				<span className="font-medium">Auto-key</span>
				<span className="font-mono tabular-nums">
					{recording ? "On" : "Off"}
				</span>
			</button>
			<div className="mx-1 h-5 w-px bg-white/10" />
			<IconButton
				icon={Diamond}
				label="Key pose at playhead"
				disabled={primaryNodeId === null}
				onClick={() => {
					if (primaryNodeId) keyNodePoseAtPlayhead(primaryNodeId);
				}}
			/>
			<div className="ml-1 flex items-center font-mono text-fg-secondary text-ui tabular-nums">
				<FrameField
					currentFrame={currentFrame}
					durationFrames={durationFrames}
				/>
				<span className="text-fg-subtle"> / {durationFrames}</span>
				<span className="ml-2 text-fg-subtle">{fps}fps</span>
			</div>
		</div>
	);
}
