import {
	computeAudioTrackSchedule,
	linearGainFromDb,
	resolveAudibleAudioTracks,
} from "@/entities/scene/model/audio";
import type { SceneDocument } from "@/entities/scene/model/types";
import type { ExportIssue } from "./issues";

/**
 * S5a minimal audio lane: mixes every audible `AudioTrack` in the export frame
 * range into one rendered `AudioBuffer` via `OfflineAudioContext`, entirely
 * off the frame-driven WebCodecs video encode path in `../adapters/video.ts`.
 * The mix's own clock is `computeAudioTrackSchedule`
 * (`entities/scene/model/audio.ts`) — the SAME pure timing helper the live
 * preview driver (`features/audio-preview`) uses — so preview and export
 * cannot drift onto two different offset contracts.
 *
 * Every failure here is fail-open for audio specifically (never for video):
 * an unresolvable browser API, a track that fails to decode, or an unusable
 * export window all fall back to a `null` buffer plus a typed issue, so the
 * caller can complete a video-only WebM rather than blocking the whole export.
 */

/** Mixed export audio at this fixed rate; mediabunny's Opus encoder accepts it directly. */
export const AUDIO_MIX_SAMPLE_RATE = 48_000;
/** Stereo output regardless of source channel count(s). */
export const AUDIO_MIX_CHANNEL_COUNT = 2;

export type ExportAudioMixInput = {
	readonly scene: SceneDocument;
	/** The document's single global-frame clock rate driving this export. */
	readonly fps: number;
	/** First global frame of the export range; the mix buffer's t=0. */
	readonly startFrame: number;
	/** Export range length in frames, at `fps`. */
	readonly durationFrames: number;
};

export type ExportAudioMixResult = {
	/** `null` when there is nothing audible to mix, or the mix could not run. */
	readonly buffer: AudioBuffer | null;
	readonly issues: readonly ExportIssue[];
};

const audioTrackDecodeFailedIssue = (
	assetId: string,
	error: unknown,
): ExportIssue => {
	const detail =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return {
		severity: "warning",
		category: "fallback",
		code: "audio-track-decode-failed",
		message: `An audio track's source could not be decoded (${detail}); it was omitted from this export's mixed audio.`,
		fallback: "audio-track-omitted",
		assetId,
	};
};

export const audioMixUnavailableIssue = (error: unknown): ExportIssue => {
	const detail =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return {
		severity: "warning",
		category: "fallback",
		code: "audio-mix-unavailable",
		message: `This browser could not render the export's mixed audio (${detail}); the export completed video-only.`,
		fallback: "audio-track-omitted",
	};
};

const decodeAudioAssetBuffer = async (
	context: OfflineAudioContext,
	href: string,
): Promise<AudioBuffer> => {
	const response = await fetch(href);
	const arrayBuffer = await response.arrayBuffer();
	return context.decodeAudioData(arrayBuffer);
};

/**
 * Renders every audible `AudioTrack` intersecting
 * `[startFrame, startFrame + durationFrames)` into one mixed `AudioBuffer`.
 * Returns `{ buffer: null, issues: [] }` when there is simply nothing audible
 * to mix (no error) — callers should only surface an "omitted" fact when
 * `resolveAudibleAudioTracks` found tracks but this still returned `null`.
 */
export async function buildExportAudioMix(
	input: ExportAudioMixInput,
): Promise<ExportAudioMixResult> {
	const resolved = resolveAudibleAudioTracks(input.scene);
	if (resolved.length === 0) return { buffer: null, issues: [] };
	if (typeof OfflineAudioContext === "undefined") {
		return {
			buffer: null,
			issues: [
				audioMixUnavailableIssue(
					new Error("OfflineAudioContext is unavailable in this browser."),
				),
			],
		};
	}
	const durationSeconds = Math.max(
		0,
		input.durationFrames / Math.max(1, input.fps),
	);
	if (durationSeconds <= 0) return { buffer: null, issues: [] };
	const frameCount = Math.max(
		1,
		Math.round(durationSeconds * AUDIO_MIX_SAMPLE_RATE),
	);

	try {
		const context = new OfflineAudioContext(
			AUDIO_MIX_CHANNEL_COUNT,
			frameCount,
			AUDIO_MIX_SAMPLE_RATE,
		);
		const issues: ExportIssue[] = [];
		let scheduledAny = false;
		for (const { track, asset, href } of resolved) {
			let decoded: AudioBuffer;
			try {
				decoded = await decodeAudioAssetBuffer(context, href);
			} catch (error) {
				issues.push(audioTrackDecodeFailedIssue(asset.id, error));
				continue;
			}
			const schedule = computeAudioTrackSchedule({
				track,
				fps: input.fps,
				referenceFrame: input.startFrame,
				sourceDurationSeconds: decoded.duration,
			});
			// `schedule === null` here means this track's trimmed window simply
			// does not reach this export range — not a failure, so no issue.
			if (!schedule) continue;
			const source = context.createBufferSource();
			source.buffer = decoded;
			const gain = context.createGain();
			gain.gain.value = linearGainFromDb(track.gainDb);
			source.connect(gain);
			gain.connect(context.destination);
			source.start(
				schedule.delaySeconds,
				schedule.sourceOffsetSeconds,
				schedule.playDurationSeconds,
			);
			scheduledAny = true;
		}
		if (!scheduledAny) return { buffer: null, issues };
		const rendered = await context.startRendering();
		return { buffer: rendered, issues };
	} catch (error) {
		return { buffer: null, issues: [audioMixUnavailableIssue(error)] };
	}
}
