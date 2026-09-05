# Grid and Bento Layout Authoring

Vecmo supports layout frames for arranging selected scene nodes into editable
column/grid and bento compositions.

The first authoring path is available from the action surface as **Wrap in grid
layout**. It wraps selected top-level nodes, or selected direct children that
share the same parent, into a frame, stores grid layout intent on that frame, and
materializes the children into cells so normal selection, rendering, export, and
undo continue to use ordinary scene nodes.

When a layout frame is selected, the Inspector exposes compact controls for
enabling grid layout on an ordinary frame, columns, rows, auto-flow direction,
gaps, padding, presets, clearing authored cells, and reapplying the stored layout
to child geometry. It also exposes Pack cells, which repairs overlapping authored
placements by moving conflicted cells to the first available grid range while
preserving authored spans and Fit/Fill modes where possible. Selecting a direct
child of a layout frame exposes its zero-based cell, span, and cell fit controls,
plus a parent-frame jump back to the owning layout controls. Deeper nested
selections expose a Cell Host section for editing the direct layout-managed
item's cell/span/Fit/Fill placement without leaving the descendant selection,
plus a Layout Path section that can jump back to the nearest or outer layout
ancestor without using the layer tree.

Layout frames can store responsive variants as sparse overrides on the base
layout. The Inspector can add a variant from the current effective layout, switch
between Auto, Base, and a named variant, edit variant min/max width breakpoints,
rename variants, allow intentional cell overlap for the active layout target, and
remove the active variant. Manual selection uses `activeVariantId`; Auto
selection uses `variantMode: "auto"` and resolves the matching variant from the
frame width. In Auto mode, the Inspector highlights and edits that
width-resolved variant target without forcing manual selection when one matches;
otherwise the base layout remains the edit target.

The canvas shows a grid overlay for the selected layout frame or the layout
frame that owns the selected child. Selecting a direct child exposes its cell
overlay; selecting a deeper descendant resolves the same overlay to the direct
layout-managed Cell Host. Dragging the cell body moves the authored placement
while preserving span, and dragging edge/corner handles updates the span. For
`rows: "auto"` layouts, dragging below the current grid can create the needed
lower row placement directly from the canvas. In multi-selection, drag handles
follow the primary selected Cell Host while the other selected hosts remain
highlighted; dragging the primary cell body moves the selected host cells
together by the same row/column delta, and dragging the primary span handles
resizes the selected host cells by the same edge delta with per-cell boundary
and selected-cell overlap clamping. If the selected cells already overlap, the
canvas outlines the conflicting cells in amber while preserving the authored
priority-group command path. When Overlap is enabled for the active layout
target, canvas span editing can create intentional overlaps while keeping the
amber conflict outline as feedback. The canvas overlay reads its metrics from
the layout-only interaction document, so drag-to-span writes target source
layout intent rather than motion-sampled presentation geometry. Both paths write
through the same command bus used by the Inspector. Inspector Cell and Cell Host
controls read the same resolved layout plan, so Auto-mode variants and auto-flow
placements show the cell coordinates that a canvas drag would edit. Layout frame
controls use that resolved plan for Auto row display and for copying the current
cell map into newly added responsive variants.

Grid-managed children move in grid terms; free children move freely. Dragging a
layout-managed child with the Select tool moves its cell placement even before
it is selected — the same click-drag gesture that would select an unselected
child now also drags it into a new cell, and multi-selected cells that share a
frame move together by the same delta. `rows: "auto"` layouts can still grow a
new row directly from this drag. With a layout-managed child selected as the
primary, an arrow key (Shift included) moves it one cell per press in that
direction, clamped to the grid, with the same `rows: "auto"` downward growth a
drag allows. Ordinary bounding-box resize is inert for a layout-managed child;
span handles (on the canvas cell overlay, once selected) own its size instead.
Rotation is preserved: a rotated child fits inside its cell via the same
contain/cover fit non-box children use, instead of being snapped upright, and
its transform anchor survives every relayout so a rotate/scale keyframe pivot
set in Motion keeps working. In the Inspector, X/Y/W/H are read-only for a
layout-managed child (cell/span/fit controls own position and size); anchor
and rotation stay editable there too.

The same layout operations are available to MCP through `apply_scene_commands`
with typed layout frame commands. A single MCP batch can create a layout frame
with a stable `frameNodeId` and then target that new frame in later commands in
the same batch. Passing `parentNodeId` to `scene/create-layout-frame` wraps
direct children of that parent, enabling nested bento structures through the same
command bus as the GUI. Agents can set one child placement with
`scene/set-layout-child-placement` or set several child placements as one
priority group with `scene/set-layout-children-placements`, matching the canvas
multi-cell move/resize command path. MCP `list_layers` returns a nested node tree
and exposes each layout frame's authored contract, variants, explicit placements,
resolved variant id, resolved child cells/bounds, current source bounds, expected
materialized bounds, and materialization drift so agents can inspect a layout
before editing it. Layout-managed child summaries also include their parent
layout frame id/name, resolved placement, resolved cell bounds, and the same
drift metadata for direct MCP targeting. `observe_document` summarizes layout
frame count, managed child count, drifted frame/child counts, and max drift so an
agent can decide whether a detailed layer read is needed; `run_validation`
reports drifted frames as warnings. Agents can also call
`scene/pack-layout-frame` to repair
overlapping authored placements through the same span-preserving packer exposed
in the Inspector, or set `allowOverlap` on the base layout or a variant when the
composition intentionally uses overlapping cells.

The initial presets are:

- `uniform-grid`
- `bento-hero-left`
- `bento-hero-top`
- `bento-mosaic`

Layout placement uses zero-based cell coordinates and span counts. Responsive
variants can carry optional `minWidth`/`maxWidth` bounds; when Auto mode is
enabled, the materializer chooses the matching variant for the current frame
width and writes resolved placements back to that variant. Layout edits and
single or batch child-placement writes, including canvas drag or MCP
`scene/set-layout-child-placement` / `scene/set-layout-children-placements`,
target the currently resolved Auto variant when one matches. Placement writes
prioritize the edited child or priority group; overlapping sibling placements are
released back to auto-flow unless the effective layout has `allowOverlap`
enabled. Child placements can also carry `fit: "contain" | "cover"` so MCP and
GUI authors can choose Fit or Fill behavior for non-box vectors inside a cell.

Materialization treats layout-managed rect, ellipse, text, and image children as
axis-aligned cell content. Non-box geometry is fitted into the target cell from
its current parent-space bounds according to the child placement's fit mode;
Fit/Fill preserve authored rotation and aspect. `scene/reapply-layout-frame`
re-materializes one layout frame, or every layout frame when no `frameNodeId` is
provided, from the stored contract without changing layout intent. The scene
command runner also reapplies stored layout frames after layout-relevant
ordinary scene patches such as frame or child geometry edits; exact node-field
patches and known layout-frame child-structure patches refresh only affected
layout frames, known non-layout sibling add/remove/reorder patches resolve
without rewriting unrelated layout geometry, and broad structural patches keep
the global fallback. Layout-specific commands materialize their affected nested
layout subtree directly. Canvas, client export presentation, and generated
motion-code runtime sampling project child geometry from stored layout intent
without rewriting sparse `frame.layout` in the presentation scene; the shared
projection preserves source node/frame identity when projected child geometry
already matches. `x`/`y` keyframes on layout-managed children
are offset from authored rest to resolved cell rest, so position animation rides
on the current cell; rotation, scale, opacity, native expressions, and grammar
motion compose over the same layout-resolved rest geometry instead of being
overwritten by layout projection. Worker still-SVG
export also resolves layout frames without mutating the source document, so
renderers can read the current layout intent even before the stored child
geometry is refreshed.
