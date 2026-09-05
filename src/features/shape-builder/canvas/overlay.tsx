import { type ComponentType, useEffect, useMemo } from "react";
import type { SceneDocument } from "@/entities/scene/model/types";
import { useColorRecents } from "@/shared/color/recents";
import { expandShapeBuilderMergeFaces } from "../model/command";
import {
	buildShapeBuilderFaceGeometries,
	buildShapeBuilderGeneratedGeometries,
	shapeBuilderPathDForGeometries,
} from "../model/output-geometry";
import {
	buildShapeBuilderPalette,
	type ShapeBuilderSwatch,
	swatchIndexForFill,
} from "../model/palette";
import { useShapeBuilderStore } from "../model/store";

// Local structural mirror of the registry overlay surface (features cannot import
// widget-layer types). The host passes a compatible superset.
type LocalToolId = "shape-builder";
type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
	};
	readonly viewport: { readonly zoom: number };
};
type OverlayDescriptor = {
	readonly id: string;
	readonly tool?: LocalToolId;
	readonly Component: ComponentType<OverlayProps>;
};

// Color-agnostic palette. Every meaningful edge is a DUAL-STROKE LUMINANCE HALO —
// a wide light under-stroke beneath a narrow dark/accent over-stroke — so a seam
// stays legible on ANY underlying fill (the old single translucent teal vanished
// on teal art). Contrast is luminance-based, so it is also color-blind safe.
const HALO = "#ffffff"; // light under-stroke
const INK = "#1e2530"; // near-black over-stroke for the resting mesh
const MERGE = "#0d9488"; // deep teal — dark enough to read on pale teal art
const ERASE = "#b42318"; // deep crimson
const PERCENT = 100;

const SB_STYLE = `
.sb-march { animation: sb-march 600ms linear infinite; }
@keyframes sb-march { to { stroke-dashoffset: -12; } }
.sb-commit-merge { animation: sb-commit-merge 460ms ease-out forwards; }
.sb-commit-erase { animation: sb-commit-erase 440ms ease-in forwards; }
@keyframes sb-commit-merge { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(1.03); } }
@keyframes sb-commit-erase { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.95); } }
.sb-label { font-family: inherit; font-weight: 500; }
@media (prefers-reduced-motion: reduce) {
	.sb-march { animation: none; }
	.sb-commit-merge, .sb-commit-erase { animation-duration: 1ms; }
}
`;

const swatchWindow = (
	palette: readonly ShapeBuilderSwatch[],
	activeFill: string,
	activeSwatchIndex: number,
): readonly (ShapeBuilderSwatch & {
	readonly active: boolean;
	readonly slot: -1 | 0 | 1;
})[] => {
	if (palette.length === 0) return [];
	const current = swatchIndexForFill(palette, activeFill, activeSwatchIndex);
	if (palette.length === 1) {
		const only = palette[current];
		return only ? [{ ...only, active: true, slot: 0 }] : [];
	}
	const fallback = palette[current] ?? palette[0];
	if (!fallback) return [];
	return ([-1, 0, 1] as const).map((offset) => {
		const index = (current + offset + palette.length) % palette.length;
		const swatch = palette[index] ?? fallback;
		return { ...swatch, active: offset === 0, slot: offset };
	});
};

/**
 * Renders the Shape Builder feedback in artboard-local space, designed to be
 * legible on any canvas and to make the operation comprehensible:
 * - Resting faces: a faint neutral wash + a dual-stroke halo hairline (visible on
 *   any fill), so the clickable regions read without pulling the eye.
 * - Hover/drag: the HERO is a live union outline of the exact shape you will get
 *   (computed with the same pipeline the commit uses), a bold marching/solid halo;
 *   picked faces also get a neutral darken scrim to show which tiles feed it.
 * - Commit: the created/removed shape flashes once (keyed so it replays), so the
 *   user sees what merged/changed. All ephemeral.
 */
function ShapeBuilderOverlay({ document, selection, viewport }: OverlayProps) {
	const arrangement = useShapeBuilderStore((state) => state.arrangement);
	const hoveredFaceId = useShapeBuilderStore((state) => state.hoveredFaceId);
	const sweptFaceIds = useShapeBuilderStore((state) => state.sweptFaceIds);
	const sweepPath = useShapeBuilderStore((state) => state.sweepPath);
	const mode = useShapeBuilderStore((state) => state.mode);
	const operationIntent = useShapeBuilderStore(
		(state) => state.operationIntent,
	);
	const paintMode = useShapeBuilderStore((state) => state.paintMode);
	const activeFill = useShapeBuilderStore((state) => state.activeFill);
	const activeSwatchIndex = useShapeBuilderStore(
		(state) => state.activeSwatchIndex,
	);
	const outputDetail = useShapeBuilderStore((state) => state.outputDetail);
	const marquee = useShapeBuilderStore((state) => state.marquee);
	const hoverPoint = useShapeBuilderStore((state) => state.hoverPoint);
	const lastCommit = useShapeBuilderStore((state) => state.lastCommit);
	const error = useShapeBuilderStore((state) => state.error);
	const recents = useColorRecents((state) => state.recents);

	// Deactivating the tool unmounts this overlay (the host filters by active tool);
	// discard the computed arrangement and any in-flight sweep.
	useEffect(() => () => useShapeBuilderStore.getState().reset(), []);

	const idToIndex = useMemo(() => {
		const map = new Map<string, number>();
		if (arrangement)
			for (const face of arrangement.faces) map.set(face.id, face.index);
		return map;
	}, [arrangement]);

	// MERGE-intent whole-participating-shapes expansion — the same expansion the
	// commit uses (`expandShapeBuilderMergeFaces`). Deliberately depends ONLY on
	// (arrangement, sweptFaceIds, operationIntent, idToIndex), NEVER hoveredFaceId:
	// during an engaged merge drag, hoveredFaceId changes on every pointermove
	// while sweptFaceIds (the actual output-determining set) does not, so this
	// union-expansion + downstream refit must not re-run on hover churn alone.
	const mergeExpandedFaceIds = useMemo(() => {
		if (!arrangement || operationIntent !== "merge") return null;
		const indices: number[] = [];
		for (const id of sweptFaceIds) {
			const index = idToIndex.get(id);
			if (index !== undefined) indices.push(index);
		}
		if (indices.length === 0) return new Set<string>(sweptFaceIds);
		const expansion = expandShapeBuilderMergeFaces(arrangement, indices);
		const outputIndices = new Set(expansion.outputFaceIndices);
		const expandedIds = new Set<string>();
		for (const face of arrangement.faces)
			if (outputIndices.has(face.index)) expandedIds.add(face.id);
		return expandedIds;
	}, [arrangement, sweptFaceIds, operationIntent, idToIndex]);

	// Face set that feeds the expensive union-outline refit (`previewD`). For
	// merge this is exactly `mergeExpandedFaceIds` — hover never enters this
	// input. For extract/erase it stays face-precise (swept ∪ hovered), matching
	// those intents' face-precise commit semantics (hover DOES affect their
	// preview, same as before).
	const previewFaceIds = useMemo(() => {
		if (!arrangement) return new Set<string>();
		if (operationIntent === "merge")
			return mergeExpandedFaceIds ?? new Set<string>(sweptFaceIds);
		const ids = new Set<string>(sweptFaceIds);
		if (hoveredFaceId) ids.add(hoveredFaceId);
		return ids;
	}, [
		arrangement,
		sweptFaceIds,
		hoveredFaceId,
		operationIntent,
		mergeExpandedFaceIds,
	]);

	// Pre-commit "source fate" tint set: always hover-inclusive (unlike
	// `previewFaceIds`), so the face-tint scrim still shows the WHOLE shapes
	// about to be consumed as the user hovers before committing to the sweep —
	// this is a cheap Set union over an already-computed expansion, not a
	// geometry recompute, so hover-inclusion here costs nothing extra.
	const pickedFaceIds = useMemo(() => {
		if (!arrangement) return new Set<string>();
		if (operationIntent !== "merge") {
			const ids = new Set<string>(sweptFaceIds);
			if (hoveredFaceId) ids.add(hoveredFaceId);
			return ids;
		}
		const ids = new Set<string>(mergeExpandedFaceIds ?? sweptFaceIds);
		if (hoveredFaceId) ids.add(hoveredFaceId);
		return ids;
	}, [
		arrangement,
		sweptFaceIds,
		hoveredFaceId,
		operationIntent,
		mergeExpandedFaceIds,
	]);

	// Live preview = the exact resulting shape. Merge preview receives the already
	// expanded output face set from `expandShapeBuilderMergeFaces`, so it must not
	// run bridge expansion a second time; extract/erase still use the generated
	// helper because those intents are face-precise and may need swept neck faces.
	// The hovered face is included even before it is swept for extract/erase, so a
	// plain hover telegraphs "click to get THIS shape".
	const previewD = useMemo(() => {
		if (!arrangement) return "";
		const indices: number[] = [];
		for (const id of previewFaceIds) {
			const index = idToIndex.get(id);
			if (index !== undefined) indices.push(index);
		}
		if (indices.length === 0) return "";
		return shapeBuilderPathDForGeometries(
			operationIntent === "merge"
				? buildShapeBuilderFaceGeometries(arrangement, indices, outputDetail)
				: buildShapeBuilderGeneratedGeometries(
						arrangement,
						indices,
						outputDetail,
					),
		);
	}, [arrangement, previewFaceIds, idToIndex, outputDetail, operationIntent]);

	const sweepD = useMemo(() => {
		if (!sweepPath || sweepPath.length < 2) return "";
		return sweepPath
			.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`)
			.join(" ");
	}, [sweepPath]);

	// Resting mesh + picked-face scrim, isolated from the rest of the render so a
	// hoverPoint-only update (the cursor badge, which changes every pointermove)
	// does not re-run four `.map()` passes over every face in the arrangement.
	// Keyed by (arrangement, pickedFaceIds): INK/HALO are fixed constants, so
	// nothing else this layer reads is hover- or mode-dependent.
	const faceLayer = useMemo(() => {
		if (!arrangement) return null;
		return (
			<>
				{arrangement.faces.map((face) => (
					<path
						key={`wash-${face.id}`}
						d={face.pathD}
						fill={INK}
						fillOpacity={0.05}
						stroke="none"
					/>
				))}
				{arrangement.faces.map((face) => (
					<path
						key={`halo-${face.id}`}
						d={face.pathD}
						fill="none"
						stroke={HALO}
						strokeOpacity={0.9}
						strokeWidth={2.75}
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				))}
				{arrangement.faces.map((face) => (
					<path
						key={`ink-${face.id}`}
						d={face.pathD}
						fill="none"
						stroke={INK}
						strokeOpacity={0.85}
						strokeWidth={1}
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				))}
				{arrangement.faces
					.filter((face) => pickedFaceIds.has(face.id))
					.map((face) => (
						<path
							key={`pick-${face.id}`}
							d={face.pathD}
							fill="#000000"
							fillOpacity={0.13}
							stroke="none"
						/>
					))}
			</>
		);
	}, [arrangement, pickedFaceIds]);

	const palette = useMemo(
		() =>
			buildShapeBuilderPalette({
				document,
				nodeIds: selection.nodeIds,
				recents,
			}),
		[document, selection.nodeIds, recents],
	);
	const cursorSwatches = useMemo(
		() => swatchWindow(palette, activeFill, activeSwatchIndex),
		[palette, activeFill, activeSwatchIndex],
	);

	const needsSource = !arrangement && error === "shape-builder.needs-source";
	if (!arrangement && !lastCommit && !needsSource) return null;

	const { width, height } = document.artboard;
	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	// Screen-constant sizing for the badge's real geometry (the strokes below use
	// non-scaling-stroke, which is already screen-constant, so they take raw px).
	const px = (value: number) => value / scale;
	const accent = mode === "erase" ? ERASE : MERGE;
	const commitAccent =
		lastCommit?.mode === "erase" ? ERASE : (lastCommit?.fill ?? MERGE);
	const showSwatchPaint = paintMode === "swatch" && mode !== "erase";
	const pickedCount = new Set(
		[...sweptFaceIds, hoveredFaceId].filter((id): id is string => id !== null),
	).size;
	const actionWord =
		operationIntent === "erase"
			? "Erase"
			: operationIntent === "merge"
				? "Merge"
				: "Extract";

	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${width} ${height}`}
			style={{ overflow: "visible" }}
			aria-hidden="true"
		>
			<title>Shape Builder faces</title>
			<style>{SB_STYLE}</style>
			{needsSource ? (
				<g transform={`translate(${width / 2} ${height / 2})`}>
					<rect
						x={px(-158)}
						y={px(-16)}
						width={px(316)}
						height={px(32)}
						rx={px(8)}
						fill={INK}
						opacity={0.92}
					/>
					<text
						className="sb-label"
						x={0}
						y={px(4.5)}
						fontSize={px(12)}
						fill={HALO}
						textAnchor="middle"
					>
						No editable shape source
					</text>
				</g>
			) : null}
			{arrangement ? (
				<>
					{faceLayer}
					{sweepD ? (
						<>
							<path
								d={sweepD}
								fill="none"
								stroke={HALO}
								strokeOpacity={0.92}
								strokeWidth={9}
								strokeLinecap="round"
								strokeLinejoin="round"
								vectorEffect="non-scaling-stroke"
							/>
							<path
								d={sweepD}
								fill="none"
								stroke={accent}
								strokeOpacity={0.9}
								strokeWidth={4.5}
								strokeLinecap="round"
								strokeLinejoin="round"
								vectorEffect="non-scaling-stroke"
								strokeDasharray={mode === "erase" ? "8 6" : undefined}
								className={mode === "erase" ? "sb-march" : undefined}
							/>
						</>
					) : null}
					{previewD ? (
						<>
							{showSwatchPaint ? (
								<path
									d={previewD}
									fill={activeFill}
									fillOpacity={0.24}
									stroke="none"
								/>
							) : null}
							<path
								d={previewD}
								fill="none"
								stroke={HALO}
								strokeOpacity={0.95}
								strokeWidth={4}
								strokeLinejoin="round"
								vectorEffect="non-scaling-stroke"
							/>
							<path
								d={previewD}
								fill="none"
								stroke={accent}
								strokeWidth={2}
								strokeLinejoin="round"
								vectorEffect="non-scaling-stroke"
								strokeDasharray={mode === "erase" ? "7 5" : undefined}
								className={mode === "erase" ? "sb-march" : undefined}
							/>
						</>
					) : null}
					{marquee ? (
						<>
							<rect
								x={Math.min(marquee[0].x, marquee[1].x)}
								y={Math.min(marquee[0].y, marquee[1].y)}
								width={Math.abs(marquee[1].x - marquee[0].x)}
								height={Math.abs(marquee[1].y - marquee[0].y)}
								fill="none"
								stroke={HALO}
								strokeOpacity={0.9}
								strokeWidth={2}
								vectorEffect="non-scaling-stroke"
							/>
							<rect
								x={Math.min(marquee[0].x, marquee[1].x)}
								y={Math.min(marquee[0].y, marquee[1].y)}
								width={Math.abs(marquee[1].x - marquee[0].x)}
								height={Math.abs(marquee[1].y - marquee[0].y)}
								fill="none"
								stroke={INK}
								strokeWidth={1}
								strokeDasharray="4 3"
								vectorEffect="non-scaling-stroke"
							/>
						</>
					) : null}
				</>
			) : null}
			{lastCommit ? (
				<g
					key={lastCommit.id}
					className={
						lastCommit.mode === "erase" ? "sb-commit-erase" : "sb-commit-merge"
					}
					style={{ transformBox: "fill-box", transformOrigin: "center" }}
				>
					<path
						d={lastCommit.d}
						fill={commitAccent}
						fillOpacity={lastCommit.mode === "erase" ? 0.2 : 0.24}
						stroke="none"
					/>
					<path
						d={lastCommit.d}
						fill="none"
						stroke={HALO}
						strokeOpacity={0.95}
						strokeWidth={5}
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
					<path
						d={lastCommit.d}
						fill="none"
						stroke={commitAccent}
						strokeWidth={2.5}
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				</g>
			) : null}
			{arrangement && hoverPoint ? (
				<g
					transform={`translate(${hoverPoint.x + px(15)} ${hoverPoint.y - px(15)})`}
				>
					<circle r={px(8.5)} fill={INK} stroke={HALO} strokeWidth={px(1.5)} />
					<line
						x1={px(-4)}
						y1={0}
						x2={px(4)}
						y2={0}
						stroke={HALO}
						strokeWidth={px(1.7)}
						strokeLinecap="round"
					/>
					{mode === "merge" ? (
						<line
							x1={0}
							y1={px(-4)}
							x2={0}
							y2={px(4)}
							stroke={HALO}
							strokeWidth={px(1.7)}
							strokeLinecap="round"
						/>
					) : null}
				</g>
			) : null}
			{arrangement &&
			hoverPoint &&
			showSwatchPaint &&
			cursorSwatches.length > 0 ? (
				<g
					transform={`translate(${hoverPoint.x + px(15)} ${hoverPoint.y - px(43)})`}
				>
					{cursorSwatches.map((swatch) => (
						<g
							key={`${swatch.id}:${swatch.slot}`}
							transform={`translate(${px(swatch.slot * 14)} 0)`}
						>
							<circle
								r={px(swatch.active ? 6.8 : 5)}
								fill={HALO}
								opacity={swatch.active ? 0.96 : 0.72}
							/>
							<circle
								r={px(swatch.active ? 5.1 : 3.8)}
								fill={swatch.color}
								stroke={swatch.active ? INK : HALO}
								strokeWidth={px(swatch.active ? 1.2 : 0.8)}
							/>
						</g>
					))}
				</g>
			) : null}
			{arrangement && hoverPoint && pickedCount >= 1 ? (
				<g
					transform={`translate(${hoverPoint.x + px(15)} ${hoverPoint.y + px(6)})`}
				>
					<rect
						x={0}
						y={0}
						width={px(62)}
						height={px(16)}
						rx={px(4)}
						fill={accent}
					/>
					<text
						className="sb-label"
						x={px(31)}
						y={px(11.5)}
						fontSize={px(10)}
						fill={HALO}
						textAnchor="middle"
					>
						{actionWord}
					</text>
				</g>
			) : null}
		</svg>
	);
}

const overlay: OverlayDescriptor = {
	id: "shape-builder-overlay",
	tool: "shape-builder",
	Component: ShapeBuilderOverlay,
};

export const overlays: readonly OverlayDescriptor[] = [overlay];
