export const SVG_NODE_ID_ATTRIBUTE = "data-node-id" as const;
export const SVG_RENDER_PART_ATTRIBUTE = "data-render-part" as const;

/**
 * Marks a node's own `<g data-node-id>` wrapper as the element that owns this
 * node's opacity, instead of the usual paint/subtree-carrier target (see
 * `findOpacityTarget` in `features/motion/canvas/overlay.tsx`). Set ONLY when
 * `CanvasShell.tsx` `SceneNode`/`features/export/model/svg.ts` `renderNode`
 * internalize a revealing object-Noise-Gradient dissolve's `revealPaint`
 * underlay into this same wrapper (see `SceneNode`'s `revealingFilter` prop
 * doc): the wrapper opacity fades the (underlay + filtered content) pair as
 * ONE object, so motion playback's imperative opacity write must land on this
 * SAME element, not the inner filtered-content paint element it would
 * otherwise resolve to. Keyed off the exact same condition that moves opacity
 * to the wrapper (not "does an underlay element exist") — an object-NG
 * dissolve with a `revealPaint` whose gradient stops all resolve to nothing
 * still moves opacity to the wrapper even though no underlay element renders,
 * so detecting via underlay-element presence would miss that case and let
 * playback double-apply opacity on the wrong element.
 */
export const SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE =
	"data-reveal-opacity-owner" as const;

export const SVG_RENDER_PARTS = {
	paint: "paint",
	/**
	 * The untransformed carrier `<g>` a children-bearing node (group, Blend, or
	 * frame) emits around its own shape AND its children, carrying the node's own
	 * opacity and effect filter so they composite over the whole subtree instead
	 * of only the node's own shape — which, for a group/Blend, is a meaningless
	 * degenerate placeholder, and for a frame, is real background paint that
	 * would otherwise sit as a sibling of its children rather than their
	 * ancestor. See `entities/scene/model/appearance-targets.ts`
	 * `hasSubtreeCarrier`.
	 */
	subtree: "subtree",
} as const;

export type SvgRenderPart =
	(typeof SVG_RENDER_PARTS)[keyof typeof SVG_RENDER_PARTS];

export type SvgRenderPartAttributeProps<
	TPart extends SvgRenderPart = SvgRenderPart,
> = {
	readonly [SVG_RENDER_PART_ATTRIBUTE]: TPart;
};

export type SvgRenderPartAttributePair<
	TPart extends SvgRenderPart = SvgRenderPart,
> = readonly [typeof SVG_RENDER_PART_ATTRIBUTE, TPart];

/**
 * Builds React/SVG props that mark a renderer-owned node part. Renderers should
 * emit this helper instead of open-coding the computed `data-render-part`
 * object, keeping the imperative playback selector contract tied to one module.
 */
export function svgRenderPartAttributes<TPart extends SvgRenderPart>(
	part: TPart,
): SvgRenderPartAttributeProps<TPart> {
	return {
		[SVG_RENDER_PART_ATTRIBUTE]: part,
	} as SvgRenderPartAttributeProps<TPart>;
}

/**
 * Tuple form for string serializers that assemble SVG attributes as key/value
 * pairs instead of React props.
 */
export function svgRenderPartAttributePair<TPart extends SvgRenderPart>(
	part: TPart,
): SvgRenderPartAttributePair<TPart> {
	return [SVG_RENDER_PART_ATTRIBUTE, part] as const;
}

/**
 * Escapes a value for use inside a quoted CSS attribute selector. Render part
 * lookups cross the React/imperative playback boundary, so selector construction
 * must stay centralized instead of open-coded at each query site.
 */
export function cssQuotedAttributeValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\A ")
		.replace(/\r/g, "\\D ")
		.replace(/\f/g, "\\C ");
}

/**
 * Selects the SVG group that owns one scene node in the live canvas renderer.
 * Node ids are authored data, so callers should not interpolate them into CSS
 * selectors without this escaping step.
 */
export function svgNodeSelector(nodeId: string): string {
	return `[${SVG_NODE_ID_ATTRIBUTE}="${cssQuotedAttributeValue(nodeId)}"]`;
}

/**
 * Selects a stable renderer-owned part inside a node group. Motion playback uses
 * this to patch the painted element instead of assuming a child order that can
 * change when filters, gradients, or future render descriptors are added.
 */
export function svgRenderPartSelector(part: SvgRenderPart): string {
	return `[${SVG_RENDER_PART_ATTRIBUTE}="${part}"]`;
}
