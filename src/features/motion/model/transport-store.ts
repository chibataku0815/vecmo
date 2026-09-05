import { create } from "zustand";

const FIRST_FRAME = 0;

const transportFrame = (frame: number): number =>
	Number.isFinite(frame) ? Math.max(FIRST_FRAME, frame) : FIRST_FRAME;

/**
 * Playback transport state. It is intentionally a dumb state holder: it knows the
 * playhead and the play/loop/record flags but not the document length or fps. The
 * rAF playback driver owns advancement and reads duration/fps from the motion
 * store, which keeps this store free of timing math and trivially testable.
 *
 * `currentFrame` may be fractional while playing (sub-frame interpolation) and is
 * snapped to whole frames only when authoring keyframes.
 *
 * `interactionPreview` is playback-adjacent (Interactive Motion program, T3-S4):
 * `true` while the canvas is driven by the interaction engine instead of
 * ordinary playback/scrub. `preInteractionPreviewFrame` is the playhead frame
 * captured the moment preview STARTS, so exiting (toggle off or Esc) can restore
 * it — kept here rather than component-local state so any caller (the toggle
 * button, an Esc key handler, a future host) can read/drive the same restore
 * point without threading it through props.
 *
 * `performing` is the one-shot arming flag for iPad Pencil-motion "Perform mode"
 * (L3): true only until the SINGLE next Select-tool drag on exactly one node
 * finishes. `armPerform` sets it from a quick action; the canvas-shell recorder
 * that converts a captured drag into x/y keyframes calls `disarmPerform` the
 * moment it commits them (see `docs/product-knowledge/ipad-perform-motion.md`),
 * so a stray click or an unrelated later drag never records without the user
 * explicitly arming again.
 */
export type TransportState = {
	readonly currentFrame: number;
	readonly isPlaying: boolean;
	readonly loop: boolean;
	readonly recording: boolean;
	readonly interactionPreview: boolean;
	readonly preInteractionPreviewFrame: number | null;
	readonly performing: boolean;
};

type TransportStore = TransportState & {
	readonly play: () => void;
	readonly pause: () => void;
	readonly togglePlay: () => void;
	readonly stop: () => void;
	readonly setFrame: (frame: number) => void;
	readonly toggleLoop: () => void;
	readonly setRecording: (recording: boolean) => void;
	readonly toggleRecording: () => void;
	readonly setInteractionPreview: (active: boolean) => void;
	readonly toggleInteractionPreview: () => void;
	readonly armPerform: () => void;
	readonly disarmPerform: () => void;
	/**
	 * Restores every transport field verbatim from a previously read
	 * {@link TransportState}. Unlike composing `setFrame`/`setInteractionPreview`,
	 * this writes the snapshot as-is, so it cannot trigger `setInteractionPreview`'s
	 * frame-restore side effect and cannot drift a single field. The read-only
	 * agent artboard-capture session (`widgets/canvas-shell/model/agent-preview-capture.ts`)
	 * snapshots transport before pausing for a committed still and calls this to
	 * put playback back exactly as the user left it. Transient playback state only —
	 * no document mutation, no command-bus entry.
	 */
	readonly restoreSnapshot: (snapshot: TransportState) => void;
};

export const useTransportStore = create<TransportStore>()((set, get) => ({
	currentFrame: FIRST_FRAME,
	isPlaying: false,
	loop: true,
	recording: false,
	interactionPreview: false,
	preInteractionPreviewFrame: null,
	performing: false,
	play: () => set({ isPlaying: true }),
	pause: () => set({ isPlaying: false }),
	togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
	stop: () => set({ isPlaying: false, currentFrame: FIRST_FRAME }),
	setFrame: (frame) => set({ currentFrame: transportFrame(frame) }),
	toggleLoop: () => set((state) => ({ loop: !state.loop })),
	setRecording: (recording) => set({ recording }),
	toggleRecording: () => set((state) => ({ recording: !state.recording })),
	setInteractionPreview: (active) => {
		const state = get();
		if (active === state.interactionPreview) return;
		if (active) {
			// Entering: pause ordinary playback and remember the current frame so
			// exiting can restore it, matching a scrub-then-cancel round trip.
			set({
				interactionPreview: true,
				isPlaying: false,
				preInteractionPreviewFrame: state.currentFrame,
			});
			return;
		}
		// Exiting: restore the pre-preview frame (falling back to the current one
		// if preview was somehow entered without ever storing it) and clear the
		// stored restore point so a later entry captures a fresh one.
		set({
			interactionPreview: false,
			currentFrame: transportFrame(
				state.preInteractionPreviewFrame ?? state.currentFrame,
			),
			preInteractionPreviewFrame: null,
		});
	},
	toggleInteractionPreview: () => {
		get().setInteractionPreview(!get().interactionPreview);
	},
	armPerform: () => set({ performing: true }),
	disarmPerform: () => set({ performing: false }),
	restoreSnapshot: (snapshot) => set({ ...snapshot }),
}));
