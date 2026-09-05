import type {
	InteractionAction,
	InteractionDefinition,
} from "@/entities/scene/model/types";
import type { AnimationClip } from "./types";

/**
 * Pure, deterministic playback-interaction engine (Interactive Motion program,
 * T3-S2: interaction engine + SVG runtime wiring). This module owns ONLY the
 * state machine that turns semantic host events (`click`, `hover-in`, …) and
 * clock ticks into a frame position plus a small typed event stream — it has
 * no DOM, timer, or randomness dependency (no `Date.now`/`Math.random`; the
 * host supplies every clock delta), so it runs identically inside the
 * standalone SVG runtime, the WebGL runtime (a later slice), and any future
 * host (editor preview, a test harness) without adaptation. `set-prop`
 * actions are intentionally NOT applied here: this engine has no scene/DOM
 * knowledge, so a `set-prop` action surfaces as an emitted `"set-prop"` event
 * for the host to apply through its own props machinery (`player.setProps` in
 * the SVG runtime).
 *
 * Bundled into BOTH generated runtime-sampler bundles (`runtime-sampler-entry.ts`
 * / `runtime-sampler-core-entry.ts`) via `RUNTIME_SAMPLER.createInteractionEngine`,
 * so every exported runtime reaches the same engine code the editor would use,
 * mirroring how `buildExportRenderPresentation` is shared today.
 */

/** One semantic input the host reports to the engine. `nodeId` scopes a node-level trigger match; omitted means a component-level (whole-player) event. `value` carries the `scroll-progress` trigger's `0..1` fraction. */
export type InteractionEngineEvent =
	| { readonly kind: "click"; readonly nodeId?: string }
	| { readonly kind: "hover-in"; readonly nodeId?: string }
	| { readonly kind: "hover-out"; readonly nodeId?: string }
	| { readonly kind: "in-view"; readonly nodeId?: string }
	| {
			readonly kind: "scroll-progress";
			readonly nodeId?: string;
			readonly value: number;
	  };

/** One item in `engine.tick()`'s output event stream, surfaced to the host in emission order. */
export type InteractionEngineOutputEvent =
	| { readonly kind: "frame"; readonly frame: number }
	| { readonly kind: "clipStart"; readonly clipId: string }
	| { readonly kind: "clipEnd"; readonly clipId: string }
	| { readonly kind: "ended" }
	| {
			readonly kind: "stateChange";
			readonly state: InteractionEngineActiveState;
	  }
	| {
			readonly kind: "set-prop";
			readonly propName: string;
			readonly value: number | string;
	  };

/** Result of one `engine.tick(deltaSeconds)` call. `ended` is present (and `true`) only on the tick where whole-timeline, non-looping playback reaches its last frame. */
export type InteractionEngineTickResult = {
	readonly frame: number;
	readonly ended?: true;
	readonly events: readonly InteractionEngineOutputEvent[];
};

/** High-level playback mode name, exposed on `stateChange` events and readable via `engine.getState()`. */
export type InteractionEngineActiveState = "idle" | "playing-clip" | "paused";

export type CreateInteractionEngineOptions = {
	readonly interactions: readonly InteractionDefinition[];
	readonly clips: readonly AnimationClip[];
	readonly fps: number;
	readonly durationFrames: number;
	/**
	 * Whole-timeline (no active clip segment) end-of-playback behavior:
	 * `true` (default) wraps back to frame 0, matching the standalone SVG
	 * player's existing `options.loop !== false` default; `false` stops at
	 * the last frame and reports `ended: true` on that tick. Has no effect
	 * while a `play-clip`/`toggle-clip` segment is active — a clip's OWN
	 * `loop`/`then` action fields govern its end-of-window behavior instead.
	 */
	readonly loop?: boolean;
};

/** The engine's public surface: feed it events and clock ticks, read `frame`/`getState()` between ticks. */
export type InteractionEngine = {
	handleEvent(
		event: InteractionEngineEvent,
	): readonly InteractionEngineOutputEvent[];
	tick(deltaSeconds: number): InteractionEngineTickResult;
	/**
	 * Host-driven direct seek, independent of any authored `seek` action: sets
	 * the engine's frame to `frame` (clamped to the document's duration) and
	 * clears any active clip segment, returning to whole-timeline mode. Exists
	 * so a host's own playback controls (a scrubber, a `player.seek()` call)
	 * stay authoritative over the engine's frame pointer instead of being
	 * silently overwritten by the next `tick()` — an authored `play-clip`/
	 * `toggle-clip` action naturally re-establishes a segment afterward via
	 * `handleEvent`, so this does not need its own segment-aware variant.
	 */
	seek(frame: number): void;
	/** Updates whole-timeline wrapping without rebuilding interaction state. */
	setLoop(loop: boolean): void;
	readonly frame: number;
	getState(): InteractionEngineActiveState;
};

type PlaySegment = {
	readonly clipId: string;
	readonly startFrame: number;
	readonly endFrameExclusive: number;
	readonly direction: "forward" | "reverse";
	readonly loop: boolean;
	/** Mirrors the authored action's `then` field (renamed here — a `then`-named property on an object literal trips lint/suspicious/noThenProperty, since it can be mistaken for a thenable). */
	readonly onEnd: "hold" | "reset";
};

type EngineInternalState = {
	frame: number;
	paused: boolean;
	segment: PlaySegment | null;
	/** Clip ids currently "on" for `toggle-clip` bookkeeping — a clip can be toggled off even if a later action switched the active segment away from it. */
	toggledOn: Set<string>;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const clampFrame = (frame: number, durationFrames: number): number =>
	Math.min(Math.max(0, frame), Math.max(0, durationFrames - 1));

const clipById = (
	clips: readonly AnimationClip[],
	clipId: string,
): AnimationClip | undefined => clips.find((clip) => clip.id === clipId);

/**
 * Whether a trigger fires for a reported event: the trigger kind must match,
 * and a node-scoped trigger (`trigger.nodeId` present) only fires for an event
 * reporting that SAME node id — a component-level trigger (`trigger.nodeId`
 * omitted) fires for ANY event of the matching kind regardless of the event's
 * own `nodeId`, matching the document model's "whole mounted player" semantics
 * for an omitted trigger `nodeId` (see `InteractionTrigger`'s JSDoc in
 * `entities/scene/model/types.ts`).
 */
const triggerMatchesEvent = (
	interaction: InteractionDefinition,
	event: InteractionEngineEvent,
): boolean => {
	if (interaction.trigger.kind !== event.kind) return false;
	if (!interaction.trigger.nodeId) return true;
	return interaction.trigger.nodeId === event.nodeId;
};

/**
 * Pure, deterministic interaction engine over one document's authored
 * `interactions`/`clips`. Construct once per mounted player; `handleEvent`
 * and `tick` are the only two entry points that change engine state, both
 * synchronous and side-effect-free beyond the returned event list — the host
 * is responsible for acting on `"set-prop"` events and for driving `tick`
 * from its own clock (typically a `requestAnimationFrame` loop).
 */
export function createInteractionEngine({
	interactions,
	clips,
	fps,
	durationFrames,
	loop = true,
}: CreateInteractionEngineOptions): InteractionEngine {
	const safeFps = Math.max(1, fps);
	const safeDuration = Math.max(1, durationFrames);
	const state: EngineInternalState = {
		frame: 0,
		paused: false,
		segment: null,
		toggledOn: new Set(),
	};
	let loopEnabled = loop;

	const activeState = (): InteractionEngineActiveState => {
		if (state.paused) return "paused";
		if (state.segment) return "playing-clip";
		return "idle";
	};

	const stateChangeEvent = (): InteractionEngineOutputEvent => ({
		kind: "stateChange",
		state: activeState(),
	});

	/** Builds a `PlaySegment` for `play-clip`/`toggle-clip`'s shared clip-window semantics. Returns `null` for an unresolved `clipId` (allow-with-warning at authoring time; a dangling reference is silently inert at runtime rather than throwing). */
	const segmentForClip = (
		clipId: string,
		options: {
			readonly loop?: boolean;
			readonly direction?: "forward" | "reverse";
			readonly onEnd?: "hold" | "reset";
		},
	): PlaySegment | null => {
		const clip = clipById(clips, clipId);
		if (!clip) return null;
		return {
			clipId: clip.id,
			startFrame: clip.startFrame,
			endFrameExclusive: clip.startFrame + Math.max(0, clip.durationFrames),
			direction: options.direction ?? "forward",
			loop: options.loop ?? false,
			onEnd: options.onEnd ?? "hold",
		};
	};

	const seekToClipEntry = (segment: PlaySegment): number =>
		segment.direction === "forward"
			? segment.startFrame
			: Math.max(segment.startFrame, segment.endFrameExclusive - 1);

	/** Runs one action, appending any resulting events to `out`. `runAction` never throws on a dangling reference — export-time validation already dropped genuinely invalid interactions; a reference that is merely unresolved at THIS runtime call (e.g. an intentionally-absent clip) is a silent no-op, matching the document model's allow-with-warning authoring contract. */
	const runAction = (
		action: InteractionAction,
		out: InteractionEngineOutputEvent[],
	): void => {
		if (action.kind === "play-clip") {
			const segment = segmentForClip(action.clipId, {
				loop: action.loop,
				direction: action.direction,
				onEnd: action.then,
			});
			if (!segment) return;
			state.segment = segment;
			state.paused = false;
			state.toggledOn.add(segment.clipId);
			state.frame = clampFrame(seekToClipEntry(segment), safeDuration);
			out.push({ kind: "clipStart", clipId: segment.clipId });
			out.push(stateChangeEvent());
			return;
		}
		if (action.kind === "toggle-clip") {
			const isOn =
				state.segment?.clipId === action.clipId ||
				state.toggledOn.has(action.clipId);
			if (isOn) {
				state.toggledOn.delete(action.clipId);
				if (state.segment?.clipId === action.clipId) {
					out.push({ kind: "clipEnd", clipId: action.clipId });
					state.segment = null;
				}
				out.push(stateChangeEvent());
				return;
			}
			const segment = segmentForClip(action.clipId, { loop: action.loop });
			if (!segment) return;
			state.segment = segment;
			state.paused = false;
			state.toggledOn.add(segment.clipId);
			state.frame = clampFrame(seekToClipEntry(segment), safeDuration);
			out.push({ kind: "clipStart", clipId: segment.clipId });
			out.push(stateChangeEvent());
			return;
		}
		if (action.kind === "seek") {
			const bounds = state.segment
				? {
						start: state.segment.startFrame,
						endExclusive: state.segment.endFrameExclusive,
					}
				: { start: 0, endExclusive: safeDuration };
			const span = Math.max(1, bounds.endExclusive - bounds.start);
			const target =
				action.frame !== undefined
					? action.frame
					: bounds.start + clamp01(action.progress ?? 0) * (span - 1);
			state.frame = clampFrame(target, safeDuration);
			out.push({ kind: "frame", frame: state.frame });
			return;
		}
		if (action.kind === "set-prop") {
			out.push({
				kind: "set-prop",
				propName: action.propName,
				value: action.value,
			});
			return;
		}
		if (action.kind === "pause") {
			if (state.paused) return;
			state.paused = true;
			out.push(stateChangeEvent());
			return;
		}
		if (action.kind === "resume") {
			if (!state.paused) return;
			state.paused = false;
			out.push(stateChangeEvent());
		}
	};

	/**
	 * `scroll-progress`'s single validated action maps the reported `0..1`
	 * fraction onto either the whole timeline (`seek` form) or the referenced
	 * clip's local range (`play-clip` form, entering/scrubbing that clip's
	 * window without starting playback) — see `InteractionDefinition`'s
	 * document-model JSDoc for why this trigger's `actions` shape is
	 * constrained to exactly one of these two forms.
	 */
	const runScrollProgressAction = (
		action: InteractionAction,
		progress: number,
		out: InteractionEngineOutputEvent[],
	): void => {
		const fraction = clamp01(progress);
		if (action.kind === "seek") {
			state.frame = clampFrame(fraction * (safeDuration - 1), safeDuration);
			out.push({ kind: "frame", frame: state.frame });
			return;
		}
		if (action.kind === "play-clip") {
			const clip = clipById(clips, action.clipId);
			if (!clip) return;
			const span = Math.max(1, clip.durationFrames);
			state.segment = {
				clipId: clip.id,
				startFrame: clip.startFrame,
				endFrameExclusive: clip.startFrame + span,
				direction: "forward",
				loop: false,
				onEnd: action.then ?? "hold",
			};
			state.paused = true;
			state.frame = clampFrame(
				clip.startFrame + fraction * (span - 1),
				safeDuration,
			);
			out.push({ kind: "frame", frame: state.frame });
		}
	};

	const handleEvent = (
		event: InteractionEngineEvent,
	): readonly InteractionEngineOutputEvent[] => {
		const out: InteractionEngineOutputEvent[] = [];
		// `event.kind === "scroll-progress"` narrows `event` itself (not just
		// `interaction.trigger.kind`, which `triggerMatchesEvent` already
		// confirmed matches it) so `event.value` is accessible below.
		if (event.kind === "scroll-progress") {
			for (const interaction of interactions) {
				if (!triggerMatchesEvent(interaction, event)) continue;
				const [scrollAction] = interaction.actions;
				if (scrollAction)
					runScrollProgressAction(scrollAction, event.value, out);
			}
			return out;
		}
		for (const interaction of interactions) {
			if (!triggerMatchesEvent(interaction, event)) continue;
			for (const action of interaction.actions) runAction(action, out);
		}
		return out;
	};

	/**
	 * Advances `state.frame` by `deltaSeconds * fps` when not paused, resolving
	 * clip-window loop/direction/`then` semantics when `state.segment` is set,
	 * or the constructor's `loop` option otherwise (whole-timeline): looping
	 * wraps to frame 0, non-looping clamps to the last frame, pauses, and
	 * reports `ended: true` on exactly the tick that reaches it (never on a
	 * later no-op tick, since a paused engine returns before advancing).
	 */
	const tick = (deltaSeconds: number): InteractionEngineTickResult => {
		const out: InteractionEngineOutputEvent[] = [];
		if (state.paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
			return { frame: state.frame, events: out };
		}
		const deltaFrames = deltaSeconds * safeFps;
		let ended: true | undefined;
		if (state.segment) {
			const segment = state.segment;
			const span = Math.max(1, segment.endFrameExclusive - segment.startFrame);
			const signedDelta =
				segment.direction === "forward" ? deltaFrames : -deltaFrames;
			let next = state.frame + signedDelta;
			const passedEnd =
				segment.direction === "forward"
					? next >= segment.endFrameExclusive
					: next < segment.startFrame;
			if (passedEnd) {
				if (segment.loop) {
					const overshoot =
						segment.direction === "forward"
							? (next - segment.startFrame) % span
							: span - 1 - ((segment.startFrame - 1 - next) % span);
					next = segment.startFrame + (((overshoot % span) + span) % span);
				} else {
					next =
						segment.direction === "forward"
							? segment.endFrameExclusive - 1
							: segment.startFrame;
					out.push({ kind: "clipEnd", clipId: segment.clipId });
					state.toggledOn.delete(segment.clipId);
					// "reset" returns to the clip's own entry frame; "hold" (default)
					// freezes on the last frame reached above. Neither sets
					// state.paused — a "paused" active-state is reserved for an
					// explicit pause action, so a later whole-timeline tick or a new
					// play-clip/toggle-clip action can proceed immediately.
					if (segment.onEnd === "reset") next = seekToClipEntry(segment);
					state.segment = null;
					out.push(stateChangeEvent());
				}
			}
			state.frame = clampFrame(next, safeDuration);
		} else {
			let next = state.frame + deltaFrames;
			if (next > safeDuration - 1) {
				if (loopEnabled) {
					next %= safeDuration;
					if (safeDuration <= 1) next = 0;
				} else {
					next = safeDuration - 1;
					state.paused = true;
					ended = true;
				}
			}
			state.frame = clampFrame(next, safeDuration);
		}
		out.push({ kind: "frame", frame: state.frame });
		if (ended) out.push({ kind: "ended" });
		return { frame: state.frame, ended, events: out };
	};

	const seek = (frame: number): void => {
		state.frame = clampFrame(frame, safeDuration);
		state.segment = null;
	};

	return {
		handleEvent,
		tick,
		seek,
		setLoop(nextLoop: boolean) {
			loopEnabled = nextLoop;
		},
		get frame() {
			return state.frame;
		},
		getState: activeState,
	};
}
