import type { AeShape } from "@/shared/glammer/ae-shape";
import { expandStrokeWidthProfile } from "@/shared/stroke/expand";
import type { StrokeWidthProfileStop } from "@/shared/stroke/width-profile";
import { allNodes } from "./selectors";
import type {
	BezierShape,
	NodeStyle,
	SceneDocument,
	VectorNode,
} from "./types";

/**
 * The stroke color/opacity convention this codebase already uses for "no
 * stroke painted" (see `seed-scene.ts` and inline canvas fill-layer props).
 * Not a special sentinel — a literal valid CSS paint keyword used as a value.
 */
const NO_STROKE = "none";

type StrokeOutlineCacheEntry = {
	readonly shape: BezierShape;
	readonly strokeWidth: number;
	readonly profile: readonly StrokeWidthProfileStop[];
	readonly outline: AeShape | null;
};

/**
 * Per-node memo of the last {@link expandStrokeWidthProfile} result, keyed by
 * node object identity. Commands produce a new node object on every edit
 * (immer draft finalization), so identity alone is enough to detect "this
 * node object has not changed since we last expanded it" without a manual
 * invalidation call; a still-live node id that got a new object (any style or
 * geometry edit) naturally misses the cache and recomputes.
 */
const outlineCache = new WeakMap<VectorNode, StrokeOutlineCacheEntry>();

/**
 * True when `style`'s legacy single stroke (`style.stroke` + `style.strokeWidth`)
 * is the active stroke source — i.e. there is no non-empty `strokes[]` appearance
 * stack overriding it. A width profile only expands the legacy stroke; a node
 * that has moved to the expressive multi-paint stroke stack keeps its uniform
 * multi-layer stroke rendering untouched (out of v1 scope, see
 * {@link getStrokeWidthProfileOutline}'s doc).
 */
function legacyStrokeIsActive(style: NodeStyle): boolean {
	return style.stroke !== NO_STROKE && (style.strokes?.length ?? 0) === 0;
}

/**
 * True when `style` paints a visible fill — the legacy `fill` (mirrors
 * {@link legacyStrokeIsActive}'s "none" convention) or a defined, non-empty
 * `fills[]` appearance stack (see {@link resolvePaints} in `style-resolve.ts`:
 * a *defined* `fills` always wins over legacy `fill`, even filtered down to
 * zero visible entries at render time, so presence/length — not per-entry
 * visibility — is what matters here).
 *
 * {@link bakeStrokeWidthProfiles} excludes a visible-fill node from baking
 * (see {@link bakeNode}): the live canvas/SVG outline branch renders such a
 * node as *two* elements — the original fill geometry plus a separately
 * filled outline path — but a bake collapses to one node, so blindly baking
 * would either drop the fill (legacy case) or paint the outline with the old
 * fill color instead of the stroke color (expressive `fills` case, which
 * survives the style spread and outranks the overwritten legacy `fill`).
 * Leaving these nodes un-baked means the runtime falls back to ordinary
 * uniform-stroke rendering — fill preserved, no mis-color — at the cost of
 * the tapered look for this shape (a known v1 limitation, not a correctness
 * bug; see `bakeStrokeWidthProfiles`'s doc).
 */
function hasVisibleFill(style: NodeStyle): boolean {
	return style.fill !== NO_STROKE || (style.fills?.length ?? 0) > 0;
}

/**
 * Expands a path node's `style.strokeWidthProfile` into a closed filled
 * outline, or returns `null` when the node does not qualify — callers MUST
 * fall back to ordinary uniform-stroke rendering in that case:
 *
 * - `node.geometry.kind !== "path"`
 * - the primary shape is closed, or the geometry has `subpaths` (compound
 *   path) — closed-spine / hole expansion is out of v1 scope
 * - `style.strokeWidthProfile` is absent
 * - the legacy single stroke is not the active stroke source (see
 *   {@link legacyStrokeIsActive}) — a multi-paint stroke stack has no single
 *   width/color for the expander to expand
 * - `style.strokeWidth <= 0`
 * - {@link expandStrokeWidthProfile} itself returns `null` (invalid profile,
 *   degenerate spine, or a re-fit failure)
 *
 * Memoized on node object identity (see {@link outlineCache}) because the
 * rail-expansion + curve re-fit is not cheap and canvas re-renders on every
 * frame/selection change would otherwise redo it for an unchanged node.
 */
export function getStrokeWidthProfileOutline(node: VectorNode): AeShape | null {
	if (node.geometry.kind !== "path") return null;
	const { shape, subpaths } = node.geometry;
	if (shape.closed || (subpaths && subpaths.length > 0)) return null;

	const { style } = node;
	const profile = style.strokeWidthProfile;
	if (!profile || profile.length === 0) return null;
	if (!legacyStrokeIsActive(style)) return null;
	if (!(style.strokeWidth > 0)) return null;

	const cached = outlineCache.get(node);
	if (
		cached &&
		cached.shape === shape &&
		cached.strokeWidth === style.strokeWidth &&
		cached.profile === profile
	) {
		return cached.outline;
	}

	const outline = expandStrokeWidthProfile({
		shape,
		strokeWidth: style.strokeWidth,
		profile,
	});
	outlineCache.set(node, {
		shape,
		strokeWidth: style.strokeWidth,
		profile,
		outline,
	});
	return outline;
}

/**
 * Structural (not imported) shape of the one motion fact
 * {@link bakeStrokeWidthProfiles} needs: whether any keyframe track targets a
 * node's `pathShape`. Declared inline rather than importing
 * `MotionDocument`/`KeyframeTrack` from `entities/motion/model` — `entities/scene`
 * is a strictly lower-ranked sibling of `entities/motion` in the Feature-Sliced
 * same-layer order (`check-architecture.ts`'s `entitiesSliceRank`), so a
 * value-level import the other way is banned. Callers (a `features/export`
 * module) pass their real `MotionDocument`, which satisfies this structurally.
 */
export type StrokeBakeMotionTracks = {
	readonly tracks: readonly {
		readonly target: { readonly nodeId: string; readonly property: string };
	}[];
};

/**
 * Why one profiled node's outline was excluded from
 * {@link bakeStrokeWidthProfiles}'s bake even though
 * {@link getStrokeWidthProfileOutline} would otherwise have produced one —
 * see {@link hasPathShapeTrack} and {@link hasVisibleFill} for the full
 * rationale. Reported so export-time tooling (the `features/export` bundle)
 * can surface the resulting canvas/SVG-vs-runtime taper divergence instead of
 * leaving it silent.
 */
export type StrokeWidthProfileBakeFallbackReason =
	| "path-shape-track"
	| "visible-fill";

/** One excluded-node record collected by {@link bakeStrokeWidthProfiles}. */
export type StrokeWidthProfileBakeFallback = {
	readonly nodeId: string;
	readonly layerId: string;
	readonly reason: StrokeWidthProfileBakeFallbackReason;
};

/**
 * {@link bakeStrokeWidthProfiles}'s result: the baked document (unchanged
 * behavior) plus every node whose profile outline was skipped for a reason a
 * live canvas/SVG render does not honor, so the two surfaces diverge. Callers
 * (the `features/export` bundle) turn `fallbacks` into typed export issues;
 * this module stays layer-agnostic (no `features/export` import — see the
 * Feature-Sliced import direction) and reports only the bare facts.
 */
export type StrokeWidthProfileBakeResult = {
	readonly document: SceneDocument;
	readonly fallbacks: readonly StrokeWidthProfileBakeFallback[];
};

/**
 * True when `motion` has a `pathShape` keyframe track targeting `nodeId`. A
 * node in this state is excluded from {@link bakeStrokeWidthProfiles}: baking
 * would replace its static geometry with the closed stroke outline, but the
 * runtime sampler resolves `pathShape` tracks by re-sampling the ORIGINAL open
 * spine at every animated frame — overriding the baked geometry back to an
 * unstroked open path (the bake also clears `stroke`/`strokeWidthProfile`),
 * which would render as invisible geometry on every frame the track drives.
 * Excluding the node leaves it on the ordinary uniform-stroke fallback render
 * path, so the shape animation keeps working; only the tapered-outline look is
 * deferred for this node (a known v1 limitation, not a correctness bug).
 */
function hasPathShapeTrack(
	motion: StrokeBakeMotionTracks,
	nodeId: string,
): boolean {
	return motion.tracks.some(
		(track) =>
			track.target.nodeId === nodeId && track.target.property === "pathShape",
	);
}

/**
 * Recursively rebuilds one node (and its `children`, for a group) with its
 * stroke-width-profile outline baked in where {@link getStrokeWidthProfileOutline}
 * returns one and the node has no `pathShape` track (see {@link hasPathShapeTrack})
 * and no visible fill of its own (see {@link hasVisibleFill}). A baked node's
 * geometry becomes the closed outline, its fill becomes the old stroke color
 * (the node's `style.opacity` is untouched and already applies uniformly to
 * the whole node, so it keeps carrying the stroke's opacity contribution with
 * no separate field to compute), and the stroke/profile/dash fields are
 * cleared so the runtime player never sees a `strokeWidthProfile` it has no
 * renderer for. Every other node is returned unchanged (by reference, so an
 * unaffected subtree costs nothing beyond the traversal itself).
 */
function bakeNode(
	node: VectorNode,
	motion: StrokeBakeMotionTracks,
	layerId: string,
	fallbacks: StrokeWidthProfileBakeFallback[],
): VectorNode {
	const children = node.children?.map((child) =>
		bakeNode(child, motion, layerId, fallbacks),
	);
	const childrenChanged = children?.some(
		(child, index) => child !== node.children?.[index],
	);

	const excludedByPathShapeTrack = hasPathShapeTrack(motion, node.id);
	const excludedByVisibleFill = hasVisibleFill(node.style);
	// Only computed when the node actually declares a profile — cheap
	// short-circuit for the common no-profile case, and memoized (see
	// `outlineCache`) so this never duplicates the rail-expansion work below.
	const potentialOutline =
		node.style.strokeWidthProfile !== undefined
			? getStrokeWidthProfileOutline(node)
			: null;
	if (potentialOutline && (excludedByPathShapeTrack || excludedByVisibleFill)) {
		fallbacks.push({
			nodeId: node.id,
			layerId,
			reason: excludedByPathShapeTrack ? "path-shape-track" : "visible-fill",
		});
	}

	const outline =
		excludedByPathShapeTrack || excludedByVisibleFill ? null : potentialOutline;
	if (!outline) {
		return childrenChanged ? { ...node, children } : node;
	}

	return {
		...node,
		...(childrenChanged ? { children } : {}),
		geometry: { kind: "path", shape: outline },
		style: {
			...node.style,
			fill: node.style.stroke,
			stroke: NO_STROKE,
			strokeWidth: 0,
			strokeWidthProfile: undefined,
			strokeDash: undefined,
			strokeDashoffset: undefined,
		},
	};
}

/**
 * Pure export-time bake: replaces every eligible profiled path node's geometry
 * with its closed stroke-outline (see {@link getStrokeWidthProfileOutline} for
 * eligibility) so a renderer with no variable-width-stroke support — the
 * generated runtime code/WebGL players — can paint it as a plain filled path.
 * Ineligible nodes — including one excluded by {@link hasPathShapeTrack} (a
 * live shape-animation track) or {@link hasVisibleFill} (a node whose own
 * fill the single-node bake can't preserve alongside the outline) — pass
 * through unchanged, keeping their ordinary uniform-stroke fallback render.
 * Every excluded node is also returned as a {@link StrokeWidthProfileBakeFallback}
 * so the caller can report the resulting canvas/SVG-vs-runtime divergence;
 * this reporting is purely additive and never changes the baked document
 * itself.
 *
 * Callers MUST apply this only to the scene payload embedded for runtime
 * export (the single `createSceneJsonExport` call site in `bundle.ts`), never
 * to the live editor document — the canvas keeps rendering profiled strokes
 * natively (see `CanvasShell.tsx`'s `strokePresentation` callers) so the
 * author can keep editing the profile after export.
 */
export function bakeStrokeWidthProfiles(
	document: SceneDocument,
	motion: StrokeBakeMotionTracks,
): StrokeWidthProfileBakeResult {
	const hasAnyProfile = allNodes(document).some(
		(node) => node.style.strokeWidthProfile !== undefined,
	);
	if (!hasAnyProfile) return { document, fallbacks: [] };

	const fallbacks: StrokeWidthProfileBakeFallback[] = [];
	const bakedDocument: SceneDocument = {
		...document,
		layers: document.layers.map((layer) => ({
			...layer,
			nodes: layer.nodes.map((node) =>
				bakeNode(node, motion, layer.id, fallbacks),
			),
		})),
	};
	return { document: bakedDocument, fallbacks };
}
