/**
 * Pure frame↔pixel geometry for the motion-timeline scrub surface — the inverse
 * mirror of `frameToPercent` (the forward map in
 * `features/motion/ui/timeline-model.ts`). Given a pointer's `clientX` and the
 * lane's measured rect it resolves the frame the user is pointing at.
 *
 * Kept React-free and DOM-free (the lane rect and `durationFrames` arrive as plain
 * numbers) so the mapping is unit-testable without rendering or pointer events, and
 * so a single source of truth replaces the per-view `frameFromClientX`/`clampFrame`
 * copies that had silently drifted (one rounded, one stayed fractional).
 *
 * It OWNS the upper clamp: the transport store's `setFrame` only clamps `>= 0`, so
 * the ceiling (a far-right click must land on `durationFrames`, never beyond) lives
 * here. Seeking is fractional by default to match the transport contract
 * (`currentFrame` may be sub-frame while playing); callers that author whole frames
 * (clip trim, keyframe retime) pass `{ round: true }`, which rounds AFTER clamping so
 * a snap can never push the value past an endpoint.
 */

/** The measured horizontal geometry of a lane element (a structural subset of `DOMRect`). */
export type LaneRect = {
	readonly left: number;
	readonly width: number;
};

/** Options shared by the ratio→frame conversions. */
export type FrameFromRatioOptions = {
	/** Round to a whole frame AFTER clamping. Defaults to false (fractional seek). */
	readonly round?: boolean;
};

/**
 * Position (0…1) of `clientX` within the lane. A zero or negative width (an unmounted
 * or collapsed lane) yields 0 so the caller never divides by zero or seeks to NaN.
 */
export function ratioFromClientX(clientX: number, rect: LaneRect): number {
	if (!(rect.width > 0)) return 0;
	const ratio = (clientX - rect.left) / rect.width;
	return Math.max(0, Math.min(1, ratio));
}

/**
 * Clamps `frame` into the inclusive range `[0, durationFrames]` — the ceiling the
 * transport store's `setFrame` (which only clamps `>= 0`) does not own. A non-finite
 * input falls back to 0. Rounds AFTER clamping when `round` is set, so a round can
 * never push the value past an endpoint.
 */
export function clampFrame(
	frame: number,
	durationFrames: number,
	options?: FrameFromRatioOptions,
): number {
	const upper = Math.max(0, durationFrames);
	const value = Number.isFinite(frame) ? frame : 0;
	const clamped = Math.max(0, Math.min(upper, value));
	return options?.round ? Math.round(clamped) : clamped;
}

/**
 * Maps a 0…1 lane ratio onto a frame in the inclusive range `[0, durationFrames]`
 * (ratio 1 lands exactly on the last frame). Clamps first, then optionally rounds, so
 * rounding can never push the value past an endpoint.
 */
export function frameFromRatio(
	ratio: number,
	durationFrames: number,
	options?: FrameFromRatioOptions,
): number {
	const raw = durationFrames > 0 ? ratio * durationFrames : 0;
	return clampFrame(raw, durationFrames, options);
}

/**
 * Parses a typed frame string into a whole, in-range frame, or `null` when the input
 * is empty or not a finite number (so the caller leaves the playhead untouched). A
 * typed `200` on a 180-frame document lands on 180 and a negative lands on 0 via
 * {@link clampFrame}.
 */
export function parseFrameInput(
	raw: string,
	durationFrames: number,
): number | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const value = Number(trimmed);
	if (!Number.isFinite(value)) return null;
	return clampFrame(value, durationFrames, { round: true });
}

/**
 * The frame under `clientX` for a lane of `rect` — the single inverse of
 * `frameToPercent`. Replaces every per-view `frameFromClientX`/`clampFrame` pair.
 */
export function frameFromClientX(
	clientX: number,
	rect: LaneRect,
	durationFrames: number,
	options?: FrameFromRatioOptions,
): number {
	return frameFromRatio(
		ratioFromClientX(clientX, rect),
		durationFrames,
		options,
	);
}
