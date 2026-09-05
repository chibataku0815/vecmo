import type { SceneDocument } from "@/entities/scene/model/types";
import type { AeShape } from "@/shared/glammer/ae-shape";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import { resolvePathBlurTarget } from "../model/guide-commit";
import { guideTangentHandlesPx } from "../model/guide-edit";
import { overlay as objectCompositeOverlay } from "./object-composite-overlay";

/**
 * On-canvas guide overlay for the Path Blur tool. Resolves the current tool
 * target (the frame Look graph's `path-blur` node, or the selected object's
 * scoped one — see `resolvePathBlurTarget`) and draws each guide curve plus
 * its anchor handles so the direction the blur streaks along is visible and
 * editable.
 *
 * Coordinate space: guide shapes are stored in normalized 0..1 UV *within the
 * target's own edit space* — the whole artboard for a frame target, or one
 * object's padded paint-bounds crop for an object target (object-local UV,
 * matching the isolated GPU crop compositor). The overlay SVG uses the
 * artboard's pixel `viewBox`, so converting UV → space px (× width/height)
 * then offsetting by the space's artboard-pixel origin is the transform this
 * overlay needs.
 */

const ZOOM_PERCENT = 100;
const LINE_PX = 1.6;
/**
 * Visual language (Illustrator/Figma convention) so anchors and direction handles
 * read as different tools at a glance:
 *  - anchor point (drag to MOVE the path)  = cream SQUARE, dark outline
 *  - tangent handle (drag to bend/ANGLE)   = cream CIRCLE, teal ring, on a teal arm
 *  - guide curve                            = teal stroke with a dark halo
 * Sizes are generous enough to grab; both keep a constant on-screen size via
 * `non-scaling-stroke` + a `/scale` radius.
 */
const ANCHOR_PX = 12;
const TANGENT_PX = 11;
/** Extra ring weight on a tangent handle so the circle reads as a grabbable arm end. */
const TANGENT_RING_WEIGHT = 1.5;
/** Multiplier applied to the selected guide's stroke width and anchor radius so a
 *  selected guide reads as active — without this, select+Delete is invisible. */
const SELECTED_EMPHASIS = 1.6;

/**
 * Mirror of the host's `path-blur-guide` sub-selection variant. The overlay reads
 * only this variant to emphasize the selected guide; it ignores the host union's
 * other sub-selection kinds.
 */
type PathBlurGuideSub = {
	readonly nodeId: string;
	readonly kind: "path-blur-guide";
	readonly guideIndex: number;
};

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly sub:
			| PathBlurGuideSub
			| {
					readonly nodeId: string;
					readonly kind: string;
			  }
			| null;
	};
	readonly viewport: { readonly zoom: number };
};

/**
 * Narrows the mirrored host sub-selection to the `path-blur-guide` variant. A bare
 * `sub?.kind === "path-blur-guide"` cannot narrow because the other-kinds variant
 * types `kind` as the wider `string`; this predicate does.
 */
const isPathBlurGuideSub = (
	sub: OverlayProps["selection"]["sub"],
): sub is PathBlurGuideSub => sub?.kind === "path-blur-guide";

/**
 * Scale a guide shape from normalized 0..1 edit-space UV into artboard-pixel
 * space so it lands on the same texels the GPU field samples, then offset by
 * the edit space's artboard-pixel origin (zero for a frame target; the
 * object's crop position for an object target). Tangents are relative
 * offsets, so they scale (but do not re-offset) by the same factors as the
 * vertices.
 */
const shapeToArtboardPx = (
	shape: AeShape,
	width: number,
	height: number,
	offsetX: number,
	offsetY: number,
): AeShape => ({
	...shape,
	vertices: shape.vertices.map(([x, y]) => [
		x * width + offsetX,
		y * height + offsetY,
	]),
	inTangents: shape.inTangents.map(([x, y]) => [x * width, y * height]),
	outTangents: shape.outTangents.map(([x, y]) => [x * width, y * height]),
});

function PathBlurGuideOverlay({ document, selection, viewport }: OverlayProps) {
	const resolved = resolvePathBlurTarget(document, selection);
	if (!resolved) return null;
	const { guides, space } = resolved;
	if (guides.length === 0) return null;

	const sub = selection.sub;
	// Only emphasize when the selected guide belongs to THIS node, so a stale
	// selection index from another node never highlights the wrong guide.
	const selectedGuideIndex =
		isPathBlurGuideSub(sub) && sub.nodeId === resolved.nodeId
			? sub.guideIndex
			: null;

	const { width, height, offsetX, offsetY } = space;
	const { width: artboardWidth, height: artboardHeight } = document.artboard;
	const scale = Math.max(viewport.zoom / ZOOM_PERCENT, 0.001);
	const strokeWidth = LINE_PX / scale;
	const anchorRadius = ANCHOR_PX / scale / 2;
	const tangentRadius = TANGENT_PX / scale / 2;

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${artboardWidth} ${artboardHeight}`}
			aria-hidden="true"
		>
			{guides.map((guide, guideIndex) => {
				const px = shapeToArtboardPx(
					guide.shape,
					width,
					height,
					offsetX,
					offsetY,
				);
				const pathData = aeShapeToSvgPath(px);
				const tangents = guideTangentHandlesPx([guide], width, height);
				// A selected guide (from clicking its anchor) paints heavier so
				// select-then-Delete is visibly targeted.
				const selected = guideIndex === selectedGuideIndex;
				const guideStroke = selected
					? strokeWidth * SELECTED_EMPHASIS
					: strokeWidth;
				const guideAnchorRadius = selected
					? anchorRadius * SELECTED_EMPHASIS
					: anchorRadius;
				return (
					// Guides/vertices keep a stable order while editing (only positions
					// move), so the index is the stable identity — and unlike a
					// coordinate key it cannot collide when two anchors coincide.
					// biome-ignore lint/suspicious/noArrayIndexKey: stable-order guide list, index is the identity.
					<g key={guideIndex}>
						<path
							d={pathData}
							fill="none"
							stroke="#191817"
							strokeWidth={guideStroke * 3}
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
						/>
						<path
							d={pathData}
							fill="none"
							stroke="#2ec4b6"
							strokeWidth={guideStroke}
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
						/>
						{tangents.map((handle) => (
							<g key={`${handle.vertexIndex}-${handle.side}`}>
								<line
									x1={handle.anchorX + offsetX}
									y1={handle.anchorY + offsetY}
									x2={handle.x + offsetX}
									y2={handle.y + offsetY}
									stroke="#2ec4b6"
									strokeWidth={strokeWidth}
									vectorEffect="non-scaling-stroke"
								/>
								<circle
									cx={handle.x + offsetX}
									cy={handle.y + offsetY}
									r={tangentRadius}
									fill="#f7f4eb"
									stroke="#2ec4b6"
									strokeWidth={strokeWidth * TANGENT_RING_WEIGHT}
									vectorEffect="non-scaling-stroke"
								/>
							</g>
						))}
						{px.vertices.map((vertex, vertexIndex) => (
							<rect
								// biome-ignore lint/suspicious/noArrayIndexKey: stable-order anchors, index is the identity.
								key={vertexIndex}
								x={vertex[0] - guideAnchorRadius}
								y={vertex[1] - guideAnchorRadius}
								width={guideAnchorRadius * 2}
								height={guideAnchorRadius * 2}
								fill={selected ? "#2ec4b6" : "#f7f4eb"}
								stroke="#191817"
								strokeWidth={guideStroke}
								vectorEffect="non-scaling-stroke"
							/>
						))}
					</g>
				);
			})}
		</svg>
	);
}

/**
 * Two overlays: the guide-editing handles (only while the Path Blur tool is
 * active) and the object-scoped blur composite (always mounted — a blurred
 * object must render under Select/any tool, not just while editing its
 * guides). See `object-composite-overlay.tsx`.
 */
export const overlays = [
	{
		id: "path-blur-guide",
		tool: "path-blur" as const,
		Component: PathBlurGuideOverlay,
	},
	objectCompositeOverlay,
];
