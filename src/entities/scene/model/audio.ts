import type {
	AudioAsset,
	AudioAssetSource,
	AudioTrack,
	SceneDocument,
} from "./types";

/**
 * S5a minimal audio lane: asset href/mime resolution, audible-track filtering,
 * and pure frame-anchored playback timing math. This module intentionally has
 * no DOM/AudioContext dependency so the timing math is importable from both a
 * browser preview driver (`features/audio-preview`) and the export mux path
 * (`features/export/model/audio-mix.ts`) without a feature-to-feature import,
 * and so a Bun script can probe the math directly (no browser required).
 *
 * Frame-anchored contract: every timestamp here derives from an integer frame
 * index divided by `fps` — never from wall-clock time. `AudioTrack.offsetFrames`
 * positions the track's trimmed-in point on the document's single global frame
 * clock and may be negative (started before frame 0); `inFrames`/`outFrames`
 * trim the source asset itself, in the same frame units, independent of
 * `offsetFrames`.
 */

const audioDataUrlPattern = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?,/iu;

/** Returns true when a source string can be embedded as an audio data URL. */
export function isAudioDataUrl(value: string): boolean {
	return audioDataUrlPattern.test(value.trim());
}

/**
 * Extracts the MIME type carried by an audio data URL without decoding bytes.
 * The result is metadata only; decode support still depends on the runtime.
 */
export function mimeTypeFromAudioDataUrl(value: string): string | undefined {
	return audioDataUrlPattern.exec(value.trim())?.[1]?.toLowerCase();
}

/** Returns the href-like browser source for an audio asset, if it is non-empty. */
export function hrefForAudioAsset(asset: AudioAsset): string | undefined {
	const href =
		asset.source.kind === "data-url" ? asset.source.dataUrl : asset.source.href;
	const trimmed = href.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Looks up a document-local audio asset by id. */
export function audioAssetById(
	document: Pick<SceneDocument, "assets">,
	assetId: string,
): AudioAsset | undefined {
	return document.assets?.find(
		(asset): asset is AudioAsset =>
			asset.kind === "audio" && asset.id === assetId,
	);
}

/**
 * Builds a serializable audio asset. Unlike image/video, audio never places a
 * scene node: it has no geometry, selection, or transform, so this factory
 * returns only the asset — callers append it via
 * `createAddAudioAssetCommand` (`node-commands.ts`).
 */
export function createAudioAsset(input: {
	readonly assetId: string;
	readonly name: string;
	readonly source: AudioAssetSource;
	readonly mimeType?: string;
	readonly durationSeconds?: number;
	readonly sampleRate?: number;
	readonly channels?: number;
}): AudioAsset {
	const mimeType =
		input.mimeType ??
		(input.source.kind === "data-url"
			? mimeTypeFromAudioDataUrl(input.source.dataUrl)
			: undefined);
	return {
		id: input.assetId,
		kind: "audio",
		name: input.name,
		source: input.source,
		...(mimeType ? { mimeType } : {}),
		...(input.durationSeconds !== undefined
			? { durationSeconds: input.durationSeconds }
			: {}),
		...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
		...(input.channels !== undefined ? { channels: input.channels } : {}),
	};
}

/** One audible track resolved against its (assumed present) source asset. */
export type ResolvedAudioTrack = {
	readonly track: AudioTrack;
	readonly asset: AudioAsset;
	readonly href: string;
};

/**
 * Returns every unmuted `AudioTrack` whose referenced asset resolves to a
 * usable href, in document order. Muted tracks, missing assets, and
 * empty/invalid sources are silently excluded here — callers that need to
 * report a gap (export) do their own pass over `document.audioTracks` instead.
 */
export function resolveAudibleAudioTracks(
	document: Pick<SceneDocument, "assets" | "audioTracks">,
): readonly ResolvedAudioTrack[] {
	const tracks = document.audioTracks ?? [];
	const resolved: ResolvedAudioTrack[] = [];
	for (const track of tracks) {
		if (track.muted) continue;
		const asset = audioAssetById(document, track.assetId);
		if (!asset) continue;
		const href = hrefForAudioAsset(asset);
		if (!href) continue;
		resolved.push({ track, asset, href });
	}
	return resolved;
}

/** Converts an authored gain in decibels to a linear amplitude multiplier. */
export function linearGainFromDb(gainDb: number): number {
	if (!Number.isFinite(gainDb)) return 1;
	return 10 ** (gainDb / 20);
}

/** One track's resolved playback schedule, all in seconds. */
export type AudioTrackSchedule = {
	/** Seconds from the reference frame's context time before playback starts. */
	readonly delaySeconds: number;
	/** Seconds into the decoded source buffer playback should start from. */
	readonly sourceOffsetSeconds: number;
	/** Seconds of source audio to play, already clamped to the decoded buffer. */
	readonly playDurationSeconds: number;
};

export type AudioTrackScheduleInput = {
	readonly track: Pick<AudioTrack, "offsetFrames" | "inFrames" | "outFrames">;
	/** The document's single global-frame clock rate. */
	readonly fps: number;
	/**
	 * The frame this schedule is computed relative to: the transport's current
	 * frame for live preview (playback starts "now"), or the export render
	 * window's first frame for the offline mix (the render buffer's t=0).
	 */
	readonly referenceFrame: number;
	/** The decoded source buffer's duration, in seconds. */
	readonly sourceDurationSeconds: number;
};

/**
 * Computes one track's playback schedule relative to `referenceFrame`, pure
 * frame-and-fps arithmetic with no DOM/AudioContext dependency. Returns `null`
 * when the track has nothing left to play at or after `referenceFrame` (fully
 * elapsed, fully trimmed away, or an invalid/non-positive `fps`).
 *
 * Both call sites (live preview scheduling "from now", and the offline export
 * mix scheduling "from the render window's start") reduce to the same shape:
 * `delaySeconds` before playback should begin, `sourceOffsetSeconds` into the
 * decoded buffer to start from, and `playDurationSeconds` to play — this is
 * the one shared clock so preview and export cannot drift from each other.
 */
export function computeAudioTrackSchedule(
	input: AudioTrackScheduleInput,
): AudioTrackSchedule | null {
	const { fps } = input;
	if (!Number.isFinite(fps) || fps <= 0) return null;

	const trimStartFrames = Math.max(0, Math.round(input.track.inFrames ?? 0));
	const rawTrimEndFrames =
		input.track.outFrames !== undefined
			? Math.round(input.track.outFrames)
			: undefined;
	const trimEndFrames =
		rawTrimEndFrames !== undefined && rawTrimEndFrames > trimStartFrames
			? rawTrimEndFrames
			: undefined;
	const trimStartSeconds = trimStartFrames / fps;
	const sourceDurationSeconds = Math.max(0, input.sourceDurationSeconds);
	const trimDurationSeconds =
		trimEndFrames !== undefined
			? (trimEndFrames - trimStartFrames) / fps
			: Math.max(0, sourceDurationSeconds - trimStartSeconds);
	if (trimDurationSeconds <= 0) return null;

	const elapsedSinceOffsetSeconds =
		(input.referenceFrame - input.track.offsetFrames) / fps;
	const delaySeconds = Math.max(0, -elapsedSinceOffsetSeconds);
	const consumedSeconds = Math.max(0, elapsedSinceOffsetSeconds);
	if (consumedSeconds >= trimDurationSeconds) return null;

	const sourceOffsetSeconds = trimStartSeconds + consumedSeconds;
	const remainingInSourceSeconds = Math.max(
		0,
		sourceDurationSeconds - sourceOffsetSeconds,
	);
	const playDurationSeconds = Math.min(
		trimDurationSeconds - consumedSeconds,
		remainingInSourceSeconds,
	);
	if (playDurationSeconds <= 0) return null;

	return { delaySeconds, sourceOffsetSeconds, playDurationSeconds };
}
