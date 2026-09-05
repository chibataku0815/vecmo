export const SHAPE_BUILDER_OUTPUT_DETAIL_MIN = 0;
export const SHAPE_BUILDER_OUTPUT_DETAIL_MAX = 100;
const SHAPE_BUILDER_OUTPUT_DETAIL_BASELINE = 60;
export const SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT = 90;

export const SHAPE_BUILDER_OUTPUT_DETAIL_PRESETS = [
	{ id: "fewer-anchors", label: "Fewer", detail: 25 },
	{
		id: "detailed",
		label: "Detailed",
		detail: SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
	},
] as const;

/**
 * Converts the user-facing Shape Builder curve detail control into the cubic
 * re-fit tolerance multiplier used by generated paths. Higher detail lowers the
 * tolerance to preserve more anchors; lower detail raises it to simplify output.
 */
export function shapeBuilderToleranceScaleForDetail(detail: number): number {
	const clamped = Math.min(
		SHAPE_BUILDER_OUTPUT_DETAIL_MAX,
		Math.max(
			SHAPE_BUILDER_OUTPUT_DETAIL_MIN,
			Number.isFinite(detail) ? detail : SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
		),
	);
	if (clamped <= SHAPE_BUILDER_OUTPUT_DETAIL_BASELINE) {
		const t =
			(SHAPE_BUILDER_OUTPUT_DETAIL_BASELINE - clamped) /
			SHAPE_BUILDER_OUTPUT_DETAIL_BASELINE;
		return 1 + t * 3;
	}
	const t =
		(clamped - SHAPE_BUILDER_OUTPUT_DETAIL_BASELINE) /
		(SHAPE_BUILDER_OUTPUT_DETAIL_MAX - SHAPE_BUILDER_OUTPUT_DETAIL_BASELINE);
	return 1 - t * 0.65;
}
