import { useEffect, useRef } from "react";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	computeAudioTrackSchedule,
	linearGainFromDb,
	resolveAudibleAudioTracks,
} from "@/entities/scene/model/audio";
import { useSceneStore } from "@/entities/scene/model/store";

/**
 * Structural mirror of the canvas registry's `OverlayProps["subscribePlayback"]`.
 * Features cannot import the widget-layer registry types (the FSA downward
 * dependency: app -> pages -> widgets -> features -> entities -> shared); the
 * host (`widgets/canvas-shell/ui/CanvasShell.tsx`) passes a compatible
 * superset object at render time. Same pattern as
 * `features/motion/canvas/overlay.tsx`'s `MotionOverlayProps`.
 */
type AudioPreviewOverlayProps = {
	readonly subscribePlayback?: (
		cb: (frame: number, playing: boolean) => void,
	) => () => void;
};

type ActiveAudioSource = {
	readonly source: AudioBufferSourceNode;
	readonly gain: GainNode;
};

// Module-level (not per-mount) so a remount (e.g. Fast Refresh) reuses the
// same context/decode cache instead of leaking one AudioContext per mount —
// browsers cap the number of live AudioContexts per page.
let sharedAudioContext: AudioContext | null = null;
const decodeCacheByKey = new Map<string, Promise<AudioBuffer>>();

const getAudioContext = (): AudioContext | null => {
	if (typeof AudioContext === "undefined") return null;
	if (!sharedAudioContext) sharedAudioContext = new AudioContext();
	return sharedAudioContext;
};

/**
 * Decodes (and caches by asset id + href) the audio bytes behind one resolved
 * track's asset. `decodeAudioData` detaches the buffer it consumes, so the
 * cached promise reads from a fresh `slice(0)` each time this is called for
 * an asset not yet in flight — the cache itself stores the settled
 * `AudioBuffer` promise, never a consumed `ArrayBuffer`.
 */
const decodeAudioAsset = (
	context: AudioContext,
	assetId: string,
	href: string,
): Promise<AudioBuffer> => {
	const cacheKey = `${assetId}\u0000${href}`;
	const cached = decodeCacheByKey.get(cacheKey);
	if (cached) return cached;
	const promise = fetch(href)
		.then((response) => response.arrayBuffer())
		.then((arrayBuffer) => context.decodeAudioData(arrayBuffer));
	decodeCacheByKey.set(cacheKey, promise);
	// A failed decode should not permanently poison the cache: a later retry
	// (e.g. after the asset's data URL is corrected) should decode again.
	promise.catch(() => decodeCacheByKey.delete(cacheKey));
	return promise;
};

/**
 * S5a minimal audio lane: headless preview driver, auto-discovered by the
 * canvas-shell overlay glob exactly like `features/motion/canvas/overlay.tsx`'s
 * `PlaybackDriver`. It schedules WebAudio playback for every audible
 * `AudioTrack` off the SAME transport tick signal `PlaybackDriver` follows
 * (`subscribePlayback`, supplied by the canvas-shell widget precisely so a
 * feature overlay never has to import the transport store directly), using
 * the SAME frame-anchored schedule math the export mux uses
 * (`entities/scene/model/audio.ts::computeAudioTrackSchedule`) — so preview
 * and export cannot drift onto two different offset contracts.
 *
 * V1 scope (per the S5a plan): schedules once at the play-start transition
 * and stops every active source at the pause/stop transition. Frame-seeking
 * while paused needs no audible scrubbing. A scrub or track edit that lands
 * WHILE already playing is not re-synced until the next play/pause
 * transition — there is no waveform/timeline-lane authoring yet to make that
 * a common gesture, so this is a deliberate V1 tradeoff, not an oversight.
 */
function AudioPreviewDriver({ subscribePlayback }: AudioPreviewOverlayProps) {
	const activeSourcesRef = useRef<Map<string, ActiveAudioSource>>(new Map());
	const isPlayingRef = useRef(false);

	useEffect(() => {
		const stopAllActiveSources = (): void => {
			for (const active of activeSourcesRef.current.values()) {
				try {
					active.source.stop();
				} catch {
					// Already stopped/ended naturally — nothing to clean up further.
				}
				active.source.disconnect();
				active.gain.disconnect();
			}
			activeSourcesRef.current.clear();
		};

		const scheduleAudibleTracks = (referenceFrame: number): void => {
			const context = getAudioContext();
			if (!context) return;
			// Resuming here runs inside the same call stack as the user's Play
			// click (zustand notifies transport subscribers synchronously), which
			// satisfies the browser's user-gesture requirement for audio playback.
			void context.resume();
			const fps = useMotionStore.getState().document.fps;
			const document = useSceneStore.getState().document;
			for (const { track, asset, href } of resolveAudibleAudioTracks(
				document,
			)) {
				decodeAudioAsset(context, asset.id, href)
					.then((decodedBuffer) => {
						// Playback may have already paused again while this decode was
						// in flight; do not start audio for a paused transport.
						if (!isPlayingRef.current) return;
						const schedule = computeAudioTrackSchedule({
							track,
							fps,
							referenceFrame,
							sourceDurationSeconds: decodedBuffer.duration,
						});
						if (!schedule) return;
						const source = context.createBufferSource();
						source.buffer = decodedBuffer;
						const gain = context.createGain();
						gain.gain.value = linearGainFromDb(track.gainDb);
						source.connect(gain);
						gain.connect(context.destination);
						source.addEventListener("ended", () => {
							activeSourcesRef.current.delete(track.id);
						});
						source.start(
							context.currentTime + schedule.delaySeconds,
							schedule.sourceOffsetSeconds,
							schedule.playDurationSeconds,
						);
						activeSourcesRef.current.set(track.id, { source, gain });
					})
					.catch(() => {
						// A failed decode simply omits that one track from live
						// preview; the export mux records its own typed issue
						// independently (`features/export/model/audio-mix.ts`).
					});
			}
		};

		const unsubscribe = subscribePlayback?.((frame, playing) => {
			if (playing && !isPlayingRef.current) {
				isPlayingRef.current = true;
				scheduleAudibleTracks(frame);
			} else if (!playing && isPlayingRef.current) {
				isPlayingRef.current = false;
				stopAllActiveSources();
			}
		});
		return () => {
			unsubscribe?.();
			isPlayingRef.current = false;
			stopAllActiveSources();
		};
	}, [subscribePlayback]);

	return null;
}

export const overlay = {
	// Headless driver: must run under every tool so audio preview never
	// depends on the active tool, same as `motion-playback`.
	id: "audio-preview",
	Component: AudioPreviewDriver,
};
