import { create } from "zustand";
import type { Arrangement, Pt } from "./arrangement";
import type { ShapeBuilderOperationIntent } from "./command";
import {
	SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
	SHAPE_BUILDER_OUTPUT_DETAIL_MAX,
	SHAPE_BUILDER_OUTPUT_DETAIL_MIN,
} from "./output-detail";

/** Source of the style applied to generated Shape Builder merge/extract regions. */
export type ShapeBuilderPaintMode = "artwork" | "swatch";

/** Durable fallback fill used before the user picks a Shape Builder swatch. */
export const DEFAULT_SHAPE_BUILDER_FILL = "#0d9488";

export type ShapeBuilderCleanupState = {
	/** Operation that produced these short-lived extract remainders. */
	readonly operationId: string | null;
	/** Exact reconstructed source fragments from the most recent extract commit. */
	readonly remainderNodeIds: readonly string[];
	/** Preferred selection target after those remainders are manually removed. */
	readonly focusNodeIds: readonly string[];
};

const EMPTY_CLEANUP: ShapeBuilderCleanupState = {
	operationId: null,
	remainderNodeIds: [],
	focusNodeIds: [],
};

const clampOutputDetail = (detail: number): number =>
	Math.min(
		SHAPE_BUILDER_OUTPUT_DETAIL_MAX,
		Math.max(
			SHAPE_BUILDER_OUTPUT_DETAIL_MIN,
			Number.isFinite(detail) ? detail : SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
		),
	);

const sameOrderedIds = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((id, index) => id === right[index]);

/**
 * Feature-local store for the Shape Builder tool's ephemeral, non-undoable state:
 * the computed arrangement (recomputed only when the selection signature changes,
 * never per pointer move), the hovered face, the swept face set, and the live
 * sweep stroke the overlay draws. Committed geometry lives in the scene store.
 */
type ShapeBuilderState = {
	readonly arrangement: Arrangement | null;
	/** Selection signature the arrangement was computed for (source ids + geometry refs). */
	readonly signature: string | null;
	readonly error: string | null;
	readonly hoveredFaceId: string | null;
	readonly sweptFaceIds: readonly string[];
	readonly sweepPath: readonly Pt[] | null;
	/** "erase" while Alt/Option is held during a gesture; drives the overlay tint. */
	readonly mode: "merge" | "erase";
	/** Real operation intent currently previewed by the overlay and committed on release. */
	readonly operationIntent: ShapeBuilderOperationIntent;
	/** Marquee rect (artboard-local) while Shift-dragging, else null. */
	readonly marquee: readonly [Pt, Pt] | null;
	/** Current cursor position (artboard-local) — anchors the +/- mode badge. */
	readonly hoverPoint: Pt | null;
	/**
	 * Paint mode is durable tool state: Artwork keeps Illustrator-style source
	 * inheritance, Swatch applies the active fill to generated Shape Builder regions.
	 */
	readonly paintMode: ShapeBuilderPaintMode;
	readonly activeFill: string;
	readonly activeSwatchIndex: number;
	/** User-facing path detail for future Shape Builder generated/rebuilt output. */
	readonly outputDetail: number;
	/**
	 * Exact ids of the latest extract remainders that can be manually cleaned up if
	 * the user decides they are construction leftovers.
	 */
	readonly cleanup: ShapeBuilderCleanupState;
	/**
	 * Transient post-commit flash: the union outline (SVG `d`, artboard-local) of
	 * the shape a merge just created / an erase just removed, so the user sees what
	 * changed. Keyed by a monotonic `id` so the overlay can restart its one-shot
	 * animation on every commit; auto-cleared shortly after.
	 */
	readonly lastCommit: {
		readonly id: number;
		readonly d: string;
		readonly mode: "merge" | "erase";
		readonly fill?: string;
	} | null;
	readonly setArrangement: (
		arrangement: Arrangement | null,
		signature: string | null,
		error: string | null,
	) => void;
	readonly setHovered: (faceId: string | null) => void;
	readonly setHoverPoint: (point: Pt | null) => void;
	readonly addSwept: (faceId: string) => void;
	readonly setSwept: (faceIds: readonly string[]) => void;
	readonly setSweepPath: (path: readonly Pt[] | null) => void;
	readonly setMode: (mode: "merge" | "erase") => void;
	readonly setOperationIntent: (intent: ShapeBuilderOperationIntent) => void;
	readonly setPaintMode: (mode: ShapeBuilderPaintMode) => void;
	readonly setActiveFill: (fill: string, swatchIndex?: number) => void;
	readonly setActiveSwatchIndex: (index: number) => void;
	readonly setOutputDetail: (detail: number) => void;
	readonly setCleanupCandidates: (entry: ShapeBuilderCleanupState) => void;
	readonly clearCleanupCandidates: () => void;
	readonly setMarquee: (marquee: readonly [Pt, Pt] | null) => void;
	readonly setLastCommit: (entry: {
		readonly d: string;
		readonly mode: "merge" | "erase";
		readonly fill?: string;
	}) => void;
	readonly clearLastCommit: () => void;
	readonly clearGesture: () => void;
	readonly reset: () => void;
};

/** Monotonic commit id so the overlay re-keys (and thus restarts) the flash. */
let commitSeq = 0;
/** How long the post-commit flash lives before it self-clears. */
const COMMIT_FLASH_MS = 520;

export const useShapeBuilderStore = create<ShapeBuilderState>()((set, get) => ({
	arrangement: null,
	signature: null,
	error: null,
	hoveredFaceId: null,
	sweptFaceIds: [],
	sweepPath: null,
	mode: "merge",
	operationIntent: "extract",
	marquee: null,
	hoverPoint: null,
	paintMode: "artwork",
	activeFill: DEFAULT_SHAPE_BUILDER_FILL,
	activeSwatchIndex: 0,
	outputDetail: SHAPE_BUILDER_OUTPUT_DETAIL_DEFAULT,
	cleanup: EMPTY_CLEANUP,
	lastCommit: null,
	setArrangement: (arrangement, signature, error) =>
		set({
			arrangement,
			signature,
			error,
			hoveredFaceId: null,
			sweptFaceIds: [],
			sweepPath: null,
			marquee: null,
			operationIntent: "extract",
		}),
	setHovered: (hoveredFaceId) => set({ hoveredFaceId }),
	setHoverPoint: (hoverPoint) => set({ hoverPoint }),
	addSwept: (faceId) =>
		set((state) =>
			state.sweptFaceIds.includes(faceId)
				? state
				: { sweptFaceIds: [...state.sweptFaceIds, faceId] },
		),
	setSwept: (sweptFaceIds) =>
		set((state) =>
			sameOrderedIds(state.sweptFaceIds, sweptFaceIds)
				? state
				: { sweptFaceIds },
		),
	setSweepPath: (sweepPath) => set({ sweepPath }),
	setMode: (mode) => set({ mode }),
	setOperationIntent: (operationIntent) => set({ operationIntent }),
	setPaintMode: (paintMode) => set({ paintMode }),
	setActiveFill: (activeFill, activeSwatchIndex) =>
		set({
			activeFill,
			...(activeSwatchIndex === undefined ? {} : { activeSwatchIndex }),
		}),
	setActiveSwatchIndex: (activeSwatchIndex) => set({ activeSwatchIndex }),
	setOutputDetail: (outputDetail) =>
		set({ outputDetail: clampOutputDetail(outputDetail) }),
	setCleanupCandidates: (cleanup) =>
		set({
			cleanup: {
				operationId: cleanup.operationId,
				remainderNodeIds: [...new Set(cleanup.remainderNodeIds)],
				focusNodeIds: [...new Set(cleanup.focusNodeIds)],
			},
		}),
	clearCleanupCandidates: () => set({ cleanup: EMPTY_CLEANUP }),
	setMarquee: (marquee) => set({ marquee }),
	setLastCommit: (entry) =>
		set(() => {
			const id = ++commitSeq;
			// Self-clear once the one-shot flash has played, unless a newer commit
			// has already superseded this one.
			setTimeout(() => {
				if (get().lastCommit?.id === id) set({ lastCommit: null });
			}, COMMIT_FLASH_MS);
			return {
				lastCommit: {
					id,
					d: entry.d,
					mode: entry.mode,
					...(entry.fill ? { fill: entry.fill } : {}),
				},
			};
		}),
	clearLastCommit: () => set({ lastCommit: null }),
	clearGesture: () => set({ sweptFaceIds: [], sweepPath: null, marquee: null }),
	reset: () =>
		set({
			arrangement: null,
			signature: null,
			error: null,
			hoveredFaceId: null,
			sweptFaceIds: [],
			sweepPath: null,
			mode: "merge",
			operationIntent: "extract",
			marquee: null,
			hoverPoint: null,
			cleanup: EMPTY_CLEANUP,
			lastCommit: null,
		}),
}));
