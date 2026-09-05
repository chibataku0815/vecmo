/**
 * SVG grid overlays for the canvas: the infinite workspace/pasteboard grid, the
 * per-artboard content grid, and the GPU-active variant that re-layers the
 * artboard grid above the GPU scene canvas. Pure presentational SVG extracted
 * verbatim from `CanvasShell` (see `docs/canvas-shell-decomposition-plan.md`);
 * the shared `rotationDegrees` lives in `model/camera-transform`.
 */
import type { ArtboardGridLine } from "@/entities/guides/model/artboard-grid";
import type { WorkspaceGridLine } from "@/entities/guides/model/snapping";
import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import { artboardLookSvgIdSegment as svgIdSegment } from "@/widgets/canvas-shell/model/artboard-look-plan";
import { rotationDegrees } from "@/widgets/canvas-shell/model/camera-transform";

const WORKSPACE_GRID_STROKE = "rgba(65, 70, 66, 0.09)";
const WORKSPACE_MAJOR_GRID_STROKE = "rgba(65, 70, 66, 0.2)";
const WORKSPACE_PIXEL_GRID_STROKE = "rgba(15, 118, 110, 0.1)";
const ARTBOARD_LAYOUT_GRID_STROKE = "rgba(44, 111, 216, 0.15)";
const ARTBOARD_MAJOR_GRID_STROKE = "rgba(44, 111, 216, 0.32)";
const ARTBOARD_PIXEL_GRID_STROKE = "rgba(15, 23, 42, 0.1)";

export function WorkspaceGridOverlay({
	lines,
	viewportWidth,
	viewportHeight,
}: {
	readonly lines: readonly WorkspaceGridLine[];
	readonly viewportWidth: number;
	readonly viewportHeight: number;
}) {
	if (viewportWidth <= 0 || viewportHeight <= 0 || lines.length === 0) {
		return null;
	}

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
			viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<g shapeRendering="crispEdges">
				{lines.map((line) => {
					const stroke =
						line.kind === "pixel"
							? WORKSPACE_PIXEL_GRID_STROKE
							: line.kind === "major"
								? WORKSPACE_MAJOR_GRID_STROKE
								: WORKSPACE_GRID_STROKE;
					return line.axis === "x" ? (
						<line
							key={`${line.kind}:${line.axis}:${line.value}`}
							x1={line.screenPosition}
							y1={0}
							x2={line.screenPosition}
							y2={viewportHeight}
							stroke={stroke}
						/>
					) : (
						<line
							key={`${line.kind}:${line.axis}:${line.value}`}
							x1={0}
							y1={line.screenPosition}
							x2={viewportWidth}
							y2={line.screenPosition}
							stroke={stroke}
						/>
					);
				})}
			</g>
		</svg>
	);
}

export function ArtboardGridOverlay({
	lines,
	clipPathId,
}: {
	readonly lines: readonly ArtboardGridLine[];
	readonly clipPathId: string;
}) {
	if (lines.length === 0) return null;

	return (
		<g clipPath={`url(#${clipPathId})`} shapeRendering="crispEdges">
			{lines.map((line) => {
				const stroke =
					line.kind === "pixel"
						? ARTBOARD_PIXEL_GRID_STROKE
						: line.kind === "major"
							? ARTBOARD_MAJOR_GRID_STROKE
							: ARTBOARD_LAYOUT_GRID_STROKE;
				return (
					<line
						key={`${line.kind}:${line.axis}:${line.value}`}
						x1={line.from.x}
						y1={line.from.y}
						x2={line.to.x}
						y2={line.to.y}
						stroke={stroke}
						vectorEffect="non-scaling-stroke"
					/>
				);
			})}
		</g>
	);
}

/**
 * Re-layers the artboard-scoped grid ABOVE `GpuSceneCanvas` for GPU-active
 * artboards only (E1 D2 — see `docs/gpu-canvas-convergence-e1-plan.md`). The
 * ordinary in-scene-SVG grid render (`artboardGridOverlay` inside
 * `ArtboardChrome` in the main `artboardContentNodes` loop) paints BELOW that
 * artboard's node content in the common case (only a `filmActive` artboard —
 * a whole-artboard film Look/scoped-look mask — hoists it above content
 * in-place, to stay unfiltered/ungrained). GPU capability is defined to
 * EXCLUDE any attached Look/filter (see `gpu-canvas-experimental.md`'s
 * capability list), so a GPU-active artboard can never be `filmActive`: the
 * two conditions are mutually exclusive by construction, and every artboard
 * this component draws for is guaranteed to be in the "grid below content"
 * in-scene branch, which the opaque GPU canvas paints over. This component
 * repaints that grid a second time in a screen-space `<svg>` mounted after
 * `GpuSceneCanvas` (so it wins the paint order) — the in-scene grid render
 * for a GPU-active artboard is suppressed at the call site below, so the
 * grid still draws exactly once per artboard.
 *
 * Mirrors the main scene `<svg>`'s own world-transform nesting exactly
 * (`translate(panX panY) rotate(rotation) scale(scale)` then a per-artboard
 * `translate(position)`) so the lines land at the identical screen
 * coordinates the in-scene render would have produced. Reuses the SAME
 * `clipPathId` the main loop already defined a `<clipPath>` element for
 * (artboard-look-plan.ts's `artboardGridClipId`) rather than redefining
 * it — an SVG `clip-path: url(#id)` reference resolves by id anywhere in the
 * document, not just within the same `<svg>` root (this file's
 * `scopedLookFilteredOverlay` already relies on the identical cross-subtree
 * reference for this same id).
 *
 * Never gated on `gpuDiffEnabled`: diff mode only changes whether the SVG
 * renderer keeps painting a GPU-active artboard's NODE CONTENT (so the GPU
 * canvas has real pixels to diff against) — the grid was never part of that
 * suppressed/diffed content, so it always renders exactly once, here, in its
 * normal (undiffed) position above the diff canvas.
 */
export function GpuArtboardGridLayer({
	artboards,
	linesById,
	viewport,
	scale,
	viewportSize,
}: {
	readonly artboards: readonly NormalizedArtboard[];
	readonly linesById: ReadonlyMap<string, readonly ArtboardGridLine[]>;
	readonly viewport: {
		readonly panX: number;
		readonly panY: number;
		readonly rotation: number;
	};
	readonly scale: number;
	readonly viewportSize: { readonly width: number; readonly height: number };
}) {
	if (viewportSize.width <= 0 || viewportSize.height <= 0) return null;

	return (
		<svg
			className="pointer-events-none absolute inset-0 block h-full w-full overflow-visible"
			viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
			aria-hidden="true"
		>
			<g
				transform={`translate(${viewport.panX} ${viewport.panY}) rotate(${rotationDegrees(viewport.rotation)}) scale(${scale})`}
			>
				{artboards.map((artboard, artboardIndex) => {
					const lines = linesById.get(artboard.id) ?? [];
					if (lines.length === 0) return null;
					return (
						<g
							key={artboard.id}
							transform={`translate(${artboard.position.x} ${artboard.position.y})`}
						>
							<ArtboardGridOverlay
								lines={lines}
								clipPathId={`vecmo-artboard-grid-${svgIdSegment(artboard.id)}-${artboardIndex}`}
							/>
						</g>
					);
				})}
			</g>
		</svg>
	);
}
