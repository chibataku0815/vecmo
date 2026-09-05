/**
 * What a capture actually delivered out of a Blender rendered frame package
 * (S4-D).
 *
 * This exists because "the band looked right" is not evidence for a frame
 * package. A package is a promise about IDENTITY — frame `f` of the export is
 * frame `f` of the manifest — and the only way to stand behind that promise
 * afterwards is to record, per capture, which package frames were composed,
 * under which build key, through which encoder. Everything here is observed
 * during the capture; nothing is re-derived from the document afterwards.
 */

/** One composed Vecmo frame that carried one package frame. */
export type FramePackageFrameRecord = {
	readonly nodeId: string;
	readonly assetId: string;
	readonly buildKey: string;
	/** Package-local index this composite addressed. */
	readonly frameIndex: number;
	/** Blender-space frame the index resolved to. */
	readonly blenderFrame: number;
	readonly packageFrameCount: number;
	/**
	 * Whether the package itself may back an exact claim (current build key and
	 * a reproducibility claim from the producing side). An encoder that drops
	 * frames can only ever subtract from this, never restore it.
	 */
	readonly exact: boolean;
};

export type FramePackageDeliveryEncoder =
	/** WebCodecs, one encode call per composed frame. */
	| "frame-driven-webcodecs"
	/**
	 * `MediaRecorder`/`captureStream`, sampled on the compositor's wall clock.
	 * Structurally unable to promise frame identity: this program measured 70 of
	 * 180 frames surviving that path.
	 */
	| "real-time-mediarecorder";

export const FRAME_PACKAGE_EXACTNESS_BLOCKED_CODES = [
	/** The capture ran through the wall-clock sampled encoder. */
	"frame-package-exact-requires-frame-driven-encoder",
	/** At least one composed package was stale or not reproducible. */
	"frame-package-not-exact-capable",
	/** Fewer composed frames carried a package frame than the capture requested. */
	"frame-package-frame-coverage-incomplete",
] as const;
export type FramePackageExactnessBlockedCode =
	(typeof FRAME_PACKAGE_EXACTNESS_BLOCKED_CODES)[number];

export type FramePackageDeliveryReport = {
	readonly buildKeys: readonly string[];
	/** Vecmo frames the capture asked for. */
	readonly requestedFrameCount: number;
	/** Composed frames that actually carried a package frame. */
	readonly deliveredFrameCount: number;
	/**
	 * Distinct package indices delivered. Lower than `deliveredFrameCount` means
	 * a package frame was shown more than once, which for a frame-addressed
	 * package is a defect and not a hold.
	 */
	readonly distinctPackageFrameCount: number;
	readonly firstBlenderFrame: number | null;
	readonly lastBlenderFrame: number | null;
	readonly fps: number;
	/**
	 * Presentation timestamps of the first and last delivered frame, in
	 * microseconds on the EXPORT plan's clock (`round(index * 1e6 / fps)`) — the
	 * same clock the muxer stamps frames with. They are recorded rather than
	 * measured from the muxed file, so they describe what was requested of the
	 * encoder.
	 */
	readonly firstTimestampMicros: number | null;
	readonly lastTimestampMicros: number | null;
	/** Whether this capture was asked to preserve transparent output. */
	readonly alphaRequested: boolean;
	readonly encoder: FramePackageDeliveryEncoder;
	readonly exact: boolean;
	readonly blockedCodes: readonly FramePackageExactnessBlockedCode[];
};

const microsForFrameIndex = (index: number, fps: number): number =>
	fps > 0 ? Math.round((index * 1_000_000) / fps) : 0;

/**
 * Folds a capture's observed package frames into one delivery record.
 *
 * Exactness is decided here and only here, and it is a conjunction: every
 * composed package must itself be exact-capable, every requested frame must
 * have carried a package frame, and the encoder must have been the frame-driven
 * one. A missing condition adds a code; it never gets rounded away.
 */
export const framePackageDeliveryReport = ({
	records,
	requestedFrameCount,
	fps,
	alphaRequested,
	encoder,
}: {
	readonly records: readonly FramePackageFrameRecord[];
	readonly requestedFrameCount: number;
	readonly fps: number;
	readonly alphaRequested: boolean;
	readonly encoder: FramePackageDeliveryEncoder;
}): FramePackageDeliveryReport | null => {
	if (records.length === 0) return null;
	const frameIndices = records.map((record) => record.frameIndex);
	const blenderFrames = records.map((record) => record.blenderFrame);
	const blockedCodes: FramePackageExactnessBlockedCode[] = [];
	if (encoder !== "frame-driven-webcodecs") {
		blockedCodes.push("frame-package-exact-requires-frame-driven-encoder");
	}
	if (records.some((record) => !record.exact)) {
		blockedCodes.push("frame-package-not-exact-capable");
	}
	if (records.length < requestedFrameCount) {
		blockedCodes.push("frame-package-frame-coverage-incomplete");
	}
	return {
		buildKeys: [...new Set(records.map((record) => record.buildKey))].sort(),
		requestedFrameCount,
		deliveredFrameCount: records.length,
		distinctPackageFrameCount: new Set(frameIndices).size,
		firstBlenderFrame: Math.min(...blenderFrames),
		lastBlenderFrame: Math.max(...blenderFrames),
		fps,
		firstTimestampMicros: microsForFrameIndex(0, fps),
		lastTimestampMicros: microsForFrameIndex(records.length - 1, fps),
		alphaRequested,
		encoder,
		exact: blockedCodes.length === 0,
		blockedCodes,
	};
};
