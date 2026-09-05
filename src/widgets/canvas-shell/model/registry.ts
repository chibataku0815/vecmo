import type { ComponentType } from "react";
import type { SceneCommand } from "@/entities/scene/model/command";
import type { GestureTransaction } from "@/entities/scene/model/gesture-transaction";
import type { Matrix2D } from "@/entities/scene/model/rendering";
import type { SceneCameraAuthoringSelection } from "@/entities/scene/model/scene-camera-authoring";
import type {
	Bounds,
	SceneDocument,
	Transform,
	Vec2,
} from "@/entities/scene/model/types";
import type {
	SelectionState,
	SubSelection,
} from "@/features/selection/model/store";
import type { ToolId } from "@/features/tool-selection/model/tools";
import type { ViewportTransform } from "@/features/viewport/model/store";
import type {
	StaticRasterCompositionFrame,
	StaticRasterCompositionPlan,
} from "@/shared/gpu-lens/static-composition";

/** Result of planning a duplicate-nodes command; `null` when ineligible. */
export type DuplicateCommandPlan = {
	readonly command: SceneCommand;
	readonly newRootNodeIds: readonly string[];
};

export type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

export type CanvasPointerContext = {
	/** Pointer in the gesture artboard's local space (node hit-testing space). */
	readonly point: CanvasPoint;
	/**
	 * Pointer in pasteboard ("world") space. Artboard positions, frames, and the
	 * artboard move/resize gestures live here, so artboard interaction must use
	 * this rather than the artboard-local `point`.
	 */
	readonly pasteboardPoint: CanvasPoint;
	/** Artboard that owns this pointer event after pasteboard hit-resolution. */
	readonly artboardId: string;
	readonly hitNodeId: string | null;
	/** Exact front-to-back hit stack under the pointer, already lock/visibility filtered. */
	readonly hitStackNodeIds: readonly string[];
	/** True when the shared 3D runtime resolved the pointer against actual mesh geometry. */
	readonly runtime3dHitResolved?: boolean;
	readonly event: PointerEvent;
};

export type TransformWriter = (
	nodeId: string,
	patch: {
		readonly matrix?: Matrix2D;
		readonly transform?: Partial<Transform>;
		readonly opacity?: number;
	},
) => void;

/**
 * Frozen host API exposed to feature canvas handlers. Feature streams may add
 * behavior behind this API, but must not mutate scene state outside `apply`.
 *
 * The selection mutators are the additive seam (2026-06-18, orchestrator
 * approved) that lets a registered tool handler write the canonical selection
 * store: a feature cannot import `features/selection` (the arch gate bans
 * feature-to-feature imports), yet once a tool registers a handler the host
 * stops doing default selection, so the handler must drive it through here.
 * They mirror `useSelectionStore`'s setters so the host is the only writer.
 * `setActiveTool` extends the same idea to the active-tool store, letting a tool
 * (e.g. draw) hand control back to the select tool after authoring a node.
 */
export type HandlerApi = {
	readonly apply: TransformWriter;
	readonly getDoc: () => SceneDocument;
	readonly selection: SelectionState;
	readonly viewport: ViewportTransform;
	readonly select: (nodeId: string, additive?: boolean) => void;
	readonly setSelection: (
		nodeIds: readonly string[],
		primary?: string | null,
	) => void;
	readonly clearSelection: () => void;
	readonly setSubSelection: (sub: SubSelection) => void;
	/**
	 * Selects an artboard (or clears it with `null`). Mirrors the selection
	 * store's `selectArtboard`; node and artboard selection are mutually
	 * exclusive, so this also clears node selection.
	 */
	readonly selectArtboard: (artboardId: string | null) => void;
	/**
	 * Selects a camera-authoring item without exposing `features/selection` to a
	 * registered feature handler. Camera rigs are not vector nodes, so they need a
	 * separate selection channel from `select` / `setSelection`.
	 */
	readonly selectSceneCamera: (
		selection: SceneCameraAuthoringSelection | null,
	) => void;
	readonly setActiveTool: (tool: ToolId) => void;
	/**
	 * Allows the freehand Pencil handler to treat browser touch events as drawing
	 * input. Native iPad shells provide Pencil samples through their bridge; plain
	 * iPad Safari does not, so rejecting touch there makes the web editor inert.
	 */
	readonly allowTouchFreehand: boolean;
	/**
	 * Opens an existing text node in the text authoring overlay. The host owns this
	 * seam so select/transform can expose direct-edit UX without importing the text
	 * feature or knowing which overlay/tool must be active.
	 */
	readonly editTextNode: (nodeId: string) => boolean;
	readonly beginGestureTransaction: (
		scope: string,
		label?: string,
	) => GestureTransaction;
	readonly commitGestureTransaction: (transaction: GestureTransaction) => void;
	/**
	 * Plans a duplicate-nodes command for `nodeIds` offset by `offset`, without
	 * applying it. Delegates to the clipboard feature's duplicate planner so a
	 * feature (which cannot import another feature) can drive Alt/Option-drag
	 * duplicate through the same command the Duplicate quick-action and `Mod+D`
	 * use, while staying ignorant of the clipboard model. Returns `null` when the
	 * selection is not eligible (nested/multi-layer/hidden/locked sources, etc.)
	 * — callers must fall back to a plain move in that case.
	 */
	readonly buildDuplicateCommand: (
		nodeIds: readonly string[],
		offset: Vec2,
	) => DuplicateCommandPlan | null;
	/**
	 * iPad Pencil-motion "Perform mode" (L3) seam. `isPerforming` is true only
	 * for the single Select-tool drag Perform was armed for; while true AND the
	 * transform handler is dragging exactly one selected node, it streams live
	 * positions through `onPerformSample` instead of writing a scene transform,
	 * then hands off to `onPerformCommit` at gesture end (see
	 * `docs/product-knowledge/ipad-perform-motion.md`). All optional: a host that
	 * predates Perform mode (e.g. a hand-rolled test double) behaves exactly as
	 * it did before — the handler treats a missing `onPerformSample`/
	 * `onPerformCommit` the same as `isPerforming` being false.
	 */
	readonly isPerforming?: boolean;
	/** Reports one live drag sample for `nodeId`: position and elapsed ms since the gesture started. */
	readonly onPerformSample?: (
		nodeId: string,
		x: number,
		y: number,
		tMs: number,
	) => void;
	/**
	 * Finalizes a Perform gesture for `nodeId` — the host converts the
	 * accumulated samples to x/y keyframes and commits them as one motion
	 * transaction, then disarms Perform. Called INSTEAD of the handler's normal
	 * scene-transform commit, so the node's base transform never changes and the
	 * recorded motion is the only outcome (no double write).
	 */
	readonly onPerformCommit?: (nodeId: string) => void;
};

export type ToolHandler = {
	readonly id: string;
	readonly tool: ToolId;
	readonly onPointerDown?: (
		context: CanvasPointerContext,
		api: HandlerApi,
	) => void;
	readonly onPointerMove?: (
		context: CanvasPointerContext,
		api: HandlerApi,
	) => void;
	readonly onPointerUp?: (
		context: CanvasPointerContext,
		api: HandlerApi,
	) => void;
	/**
	 * Optional keyboard seam dispatched by the host while the tool is active and
	 * focus is not inside an editable field. Tools own their own key semantics
	 * (e.g. select-tool Escape deselects and arrows nudge) so keyboard behavior
	 * stays tool-local rather than hard-coded in the host.
	 */
	readonly onKeyDown?: (event: KeyboardEvent, api: HandlerApi) => void;
	/**
	 * Optional activation seam dispatched by the host when the tool becomes active
	 * (and never during motion playback). Lets a tool apply an immediate, idempotent
	 * setup — e.g. the gradient tool seeds a linear gradient on a solid-filled
	 * selection so picking the tool shows on-canvas handles at once. Dispatched after
	 * the outgoing tool's `onDeactivate` + scene commit, so any edit it applies lands
	 * as its own isolated, single-undo command rather than folding into the previous
	 * tool's flushed gesture.
	 */
	readonly onActivate?: (api: HandlerApi) => void;
	/**
	 * Optional teardown dispatched by the host when an in-progress gesture is
	 * interrupted (pointercancel / lost pointer capture) or the tool is
	 * deactivated. A handler that opens a scene transaction (via
	 * `beginTransaction`) must commit/reset it here so an interrupted gesture
	 * never strands an open transaction — once stranded, the scene store folds
	 * every later command's patches into it, corrupting cross-feature undo.
	 */
	readonly onDeactivate?: (api: HandlerApi) => void;
};

export type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: SelectionState;
	readonly viewport: ViewportTransform;
	readonly clearSelection: () => void;
	/**
	 * Serializes the current overlay artboard (already motion-sampled) to a
	 * standalone, data-URL-inlined SVG string. Supplied by the canvas-shell widget
	 * because the export serializer lives in a sibling feature an overlay may not
	 * import (the feature-to-feature ban). Used by the GPU lens overlay to upload
	 * the rasterized artboard as a WebGL texture; lazily resolved so the heavy
	 * serializer only loads when an overlay actually needs it.
	 */
	readonly renderArtboardSvg?: () => Promise<string>;
	/**
	 * Subscribes to playback transport ticks. `cb` fires with the current frame and
	 * play state whenever either changes. Supplied by the canvas-shell widget so a
	 * feature overlay can follow live playback without importing the transport store
	 * (feature-to-feature ban). Returns an unsubscribe fn. During playback the
	 * presentation document is frozen, so a GPU overlay re-renders off this signal.
	 */
	readonly subscribePlayback?: (
		cb: (frame: number, playing: boolean) => void,
	) => () => void;
	/**
	 * Serializes the overlay artboard sampled at an arbitrary frame, returning both
	 * the standalone SVG and the sampled scoped document (for reading per-frame
	 * effect params). Used by the GPU overlay's playback-follow path. Heavy
	 * serializer is lazily imported.
	 */
	readonly getRasterFrame?: (
		frame: number,
	) => Promise<{ readonly svg: string; readonly document: SceneDocument }>;
	/** Returns an admitted, decoded-once transform-only playback plan when exact. */
	readonly getStaticRasterPlaybackPlan?: () => Promise<StaticRasterCompositionPlan | null>;
	/** Samples transform matrices for an already-admitted static playback plan. */
	readonly getStaticRasterPlaybackFrame?: (
		frame: number,
	) => StaticRasterCompositionFrame | null;
	/**
	 * Serializes ONE node's own rendered markup (real paint/effects/masks, not an
	 * approximation) as a standalone SVG cropped to `bounds` (artboard-root pixel
	 * space) — the isolated crop source the per-object GPU Path Blur compositor
	 * uploads, blurs, and composites back onto the finished frame. `sampledScene`
	 * lets a playback-follow caller pass the same already-sampled document it got
	 * from `getRasterFrame` (avoiding a second motion sample); omitted, it uses the
	 * current (already scrub-sampled) overlay document. Supplied by canvas-shell
	 * because the export serializer lives in a sibling feature an overlay may not
	 * import.
	 */
	readonly renderIsolatedNodeSvg?: (
		nodeId: string,
		bounds: Bounds,
		sampledScene?: SceneDocument,
	) => Promise<string | null>;
	/**
	 * Serializes a transparent full-artboard source containing only a target
	 * node set, while retaining earlier object material Looks and excluding the
	 * scoped GPU Look that will consume it. Used by target-owned Deep Glow.
	 */
	readonly renderIsolatedNodeSetSvg?: (
		nodeIds: readonly string[],
		excludedScopedLookId: string,
		sampledScene?: SceneDocument,
	) => Promise<string | null>;
};

export type OverlayDescriptor = {
	readonly id: string;
	readonly tool?: ToolId;
	readonly Component: ComponentType<OverlayProps>;
	/**
	 * Paint order among always-mounted overlays (higher paints later, i.e. on
	 * top). Defaults to 0. Without this, DOM order — and therefore stacking —
	 * falls out of `import.meta.glob`'s alphabetical file-path sort, which is
	 * an accident of feature folder naming, not a design decision. An
	 * object-scoped GPU compositor (e.g. per-object Path Blur) must paint
	 * above the frame-level GPU raster overlay so it stays visible over a
	 * frame-wide effect like Deep Glow rather than being buried under it.
	 */
	readonly paintOrder?: number;
};

export type OverlayModule = {
	readonly default?: OverlayDescriptor;
	readonly overlay?: OverlayDescriptor;
	readonly overlays?: readonly OverlayDescriptor[];
};

export type HandlerModule = {
	readonly default?: ToolHandler;
	readonly handler?: ToolHandler;
	readonly handlers?: readonly ToolHandler[];
};

export const resolveOverlayModule = (
	module: OverlayModule,
): OverlayDescriptor | undefined => module.overlay ?? module.default;

export const resolveHandlerModule = (
	module: HandlerModule,
): ToolHandler | undefined => module.handler ?? module.default;

/**
 * Resolves every overlay a feature module contributes. A feature that spans
 * multiple tools (e.g. draw owns both pen and shape previews) exports an
 * `overlays` array; single-tool features keep exporting `overlay`/`default`.
 * If a module exports both, the array form intentionally takes precedence and
 * the singular export is ignored — don't leave a stale `overlay`/`default`
 * behind when migrating a feature to the array form.
 */
export const resolveOverlayModules = (
	module: OverlayModule,
): readonly OverlayDescriptor[] => {
	if (module.overlays) return module.overlays;
	const single = resolveOverlayModule(module);
	return single ? [single] : [];
};

/**
 * Resolves every handler a feature module contributes. A feature that owns more
 * than one tool exports a `handlers` array; single-tool features keep exporting
 * `handler`/`default`. The host binds each returned handler to its own tool.
 * If a module exports both, the array form intentionally takes precedence and
 * the singular export is ignored — don't leave a stale `handler`/`default`
 * behind when migrating a feature to the array form.
 */
export const resolveHandlerModules = (
	module: HandlerModule,
): readonly ToolHandler[] => {
	if (module.handlers) return module.handlers;
	const single = resolveHandlerModule(module);
	return single ? [single] : [];
};
