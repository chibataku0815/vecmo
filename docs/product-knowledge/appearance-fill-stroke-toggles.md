# Appearance Fill / Stroke Toggles & Segmented Stroke Options

Date: 2026-07-02 (phase 3 same day; phase 4 same day — group/multi-selection
fix; phase 5 same day — group/Blend opacity and effects now actually render;
phase 6 same day — frames now composite opacity/effects over their contents
too).
Status: shipped UX overhaul of the Inspector Appearance section, stroke gradient
canvas handles, dotted stroke preset, correct behavior when a group or
multi-selection is targeted, a renderer fix so a group's or Blend's own
opacity and effects (drop shadow, inner shadow, layer blur) composite over its
members instead of being visually dead, and the same composite behavior
extended to frame containers.

## Summary

The Appearance section previously expressed "does this object have a stroke?"
only through numbers: a `Stroke px` field sitting at `0`, a color swatch that
might be `none`, and eight always-visible stroke detail fields even when nothing
was stroked. Turning a stroke on required knowing to type a width **and** set a
color; turning it off required knowing which of the two encodings (width vs.
color) to zero out. Cap/join/align lived behind dropdowns, and dash patterns
behind a bare text field.

The section is now organized around two **on/off toggles** and one-click
**segmented controls**:

1. **Fill and Stroke are toggleable blocks.** Each has a checkbox header. Off
   hides the whole detail block (no more dead fields); on brings it back. The
   toggle is non-destructive: turning a role off flags every paint in its stack
   `visible: false` (the same flag the appearance-stack eye uses), so gradients,
   meshes, images, and secondary paints all survive an off/on round trip.
   Because every renderer and exporter already drops invisible paints at
   `resolvePaints` time, canvas, SVG/PDF export, and motion output all agree.
2. **Turning a stroke on always produces a visible stroke.** If the stroke color
   resolves to `none`, a default solid black is seeded; if the width is `0`, it
   is bumped to `1`. The screenshot case — "stroke `#000000` at width 0 that
   draws nothing" — becomes a single checkbox click.
3. **Position / Cap / Join are segmented icon controls** instead of dropdowns.
   Each segment is drawn by the exact SVG attribute it commits (`stroke-linecap`,
   `stroke-linejoin`, an align band on a boundary edge), so the control previews
   the real result and changes it in one click.
4. **Stroke style is a Solid / Dashed / Dotted segment.** Dashed seeds a `4 4`
   pattern; Dotted seeds a near-zero dash with a gap based on `2×strokeWidth`
   and also sets Cap to Round so SVG renders actual dots. The free-form dash
   pattern field appears for non-solid styles. Re-selecting Dashed never
   overwrites an existing custom dashed pattern.
5. **Decluttered single-selection panel.** The `Fills legacy #000000` /
   `Strokes legacy` readout rows are gone for single selection (the
   appearance-stack list below already shows the same information); they remain
   for multi-selection, where they are the only stack summary, and now read
   `solid #000000` instead of the internal word `legacy`.

## Phase 2 (same day): Unified Stroke Paint + Opacity Sliders

1. **Stroke gets the same unified paint control as Fill.** The stroke row is now
   one swatch that previews the live paint and opens the same popover: a
   Solid / Linear / Radial row, the full ColorPicker for solids, and the
   gradient ramp / stops / Angle° editor for gradients. This replaces the old
   split across a solid-only color field, a separate "Stroke type" dropdown,
   and a detached stops block. Stroke gradients render on canvas and export
   exactly like fill gradients (same resolved-paint pipeline). The remaining
   intentional role difference is motion: the gradient keyframe diamond is
   fill-only (the `fillGradient` motion track is fill-scoped).
2. **Fill/Stroke opacity are percent sliders.** The 0–1 decimal boxes are now
   full-width 0–100% scrub sliders with live canvas feedback; a whole drag is
   one undo entry (gesture-coalesced), and the inline readout still accepts a
   typed exact value. Double-click the label resets to 100%.
3. **Hidden paints stay hidden through edits.** Switching paint kind or picking
   a color while a role is toggled off (or on a hidden paint in a mixed
   selection) no longer silently resurrects the paint — visibility is carried
   through `convertPaintKind` and the solid-color patch, and only the on/off
   toggle re-shows it.

## Phase 3 (same day): Stroke Gradient Handles + Dotted Preset

1. **Stroke gradients now use the on-canvas Gradient tool.** Opening a Fill or
   Stroke gradient popover activates the same Gradient tool and targets the role
   that opened it. Linear stroke gradients can be re-aimed by dragging endpoint
   handles, and radial stroke gradients expose center/radius handles instead of
   staying locked to the bounds-seeded geometry. Bare `G` / tool-rail activation
   still defaults to Fill so it does not unexpectedly seed strokes.
2. **The canvas gradient stop editor is role-aware.** Stop selection, double-click
   color editing, add/remove, and drag-to-offset write the primary fill or
   stroke paint selected by the popover/stop sub-selection while preserving
   secondary paints in that role.
3. **Dotted is a first-class stroke style preset.** Choosing Dotted writes a
   tiny positive dash plus a `2×strokeWidth`-style gap and sets Cap to Round.
   This is the persisted representation because the command/resolver pipeline
   intentionally strips exact zero dash lengths. Changing Cap away from Round is
   allowed; the stroke then renders as a tiny dash pattern and the Style control
   reads it as Dashed/custom rather than Dotted.

## Phase 4 (same day): Correct Behavior on Groups and Mixed Selections

Groups (and Blend containers) are wrapper nodes: they hold their members in
`children` and paint a degenerate placeholder geometry that never renders — the
member nodes are what actually appear on canvas. Before this fix, every
paint-scoped Appearance control (the Fill/Stroke toggle, paint color/opacity,
paint kind, image fit, gradient stop editing, and the paint-adjacent stroke
geometry fields — width, position, cap, join, dash) read and wrote the selected
node's OWN style. For a selected group this meant the toggle displayed the
wrapper's meaningless placeholder state instead of the children's actual
fill/stroke, and clicking it edited a paint nobody could ever see — the children
were untouched and the canvas did not change. In a mixed selection containing a
group alongside plain shapes, the plain shapes responded correctly while the
group silently no-opped, which looked like a partial, unreliable toggle.

The fix: every paint-scoped read and write now resolves a group or Blend
container to its drawable leaf descendants first (recursing through nested
wrappers, skipping frames — a frame keeps a real background and is not
expanded). A selected group's Fill/Stroke checkbox now reflects its children's
actual paint state, and toggling it, recoloring it, or changing its stroke
geometry applies to every leaf the group visually represents, as one undo step.
Node-scoped properties — opacity, blend mode, drop/inner shadow, layer blur —
still read and write the selected node itself (the Inspector fields target the
group, not its children). At the time of Phase 4 that was believed to also be
correct for *rendering*; Phase 5 below found and fixed a renderer gap where
opacity/effects landed on the wrapper's own paint element but never actually
composited over the children (blend mode was correctly applied at the group
`<g>` level all along). Plain multi-selection (no groups involved) was already
correct and is unchanged.

The single-selection appearance-stack list (the per-row fill/stroke list with
eye/reorder/delete) is hidden for a selected group, replaced with a short note
that appearance edits apply to the group's contents — editing the wrapper's own
placeholder stack row-by-row would be as meaningless as the toggle was.

## Phase 5 (same day): Group/Blend Opacity and Effects Now Actually Render

Setting a group's or Blend's own Opacity, Drop shadow, Inner shadow, or Layer
blur wrote to the right place in the document (the wrapper node's `style`) but
those values were applied to the wrapper's own invisible placeholder paint
element — the same degenerate zero-length line described above. Since the
member nodes render as siblings of that placeholder, not descendants, the
group's opacity slider and shadow/blur effects looked like they did nothing:
the children never dimmed, and no shadow or blur ever appeared.

The fix: canvas rendering, SVG export, the motion-playback overlay, and the
standalone exported-code runtime player each now wrap a wrapper container's own
shape AND its children in one extra, untransformed "subtree carrier" element
that actually carries the opacity and effect filter. This carrier is always
present for a group/Blend (even at opacity 100% with no effects), so it is a
stable anchor motion playback can retarget without a structural DOM change
when opacity crosses 100% during an animation. A drop/inner shadow or layer
blur on a group renders as ONE composite effect around the union of the
children (e.g. one shadow behind the whole cluster), not a separate shadow
per child. The effect's region is sized from the group's composited bounding
box (the same box the Inspector and selection outline already use for a
group), not the placeholder's zero-size geometry, so the shadow/blur is not
clipped. Leaf nodes and frames are unaffected — this only changes wrapper
containers.

Bulk paint edits reached through a group (see Phase 4) now also skip a
descendant that is consumed as another node's clipping/alpha mask source
(masks render only their silhouette and are never painted, so a bulk edit
through a group would have silently no-opped on them); selecting a mask
source directly is unaffected.

## Phase 6 (same day): Frame Opacity and Effects Now Composite Over Contents Too

Phase 5 fixed opacity/effect compositing for group and Blend wrapper
containers but deliberately excluded frames, because a frame (unlike a group)
has real own geometry and a paintable background, so its own paint is not
meaningless the way a wrapper's degenerate placeholder is. That exclusion was
correct for *paint editing* — a frame's own fill/stroke still needs to stay
directly editable, unlike a group's — but it left frames with the exact same
*rendering* gap groups had before Phase 5: a frame's Opacity slider and
Drop/Inner shadow or Layer blur effects were applied only to the frame's own
background shape, so children rendered as full-opacity, unfiltered siblings
underneath. Fading a frame to 50% dimmed only its background fill, not the
content inside it; a frame shadow only ever hugged the background rect and
never covered content that stuck out past it.

The fix separates two concepts that Phase 4/5 had implicitly conflated under
one predicate:

- **"Is this node's own paint meaningless to edit?"** — unchanged, still true
  only for group/Blend, still false for a frame. This still drives paint-target
  expansion (Phase 4) and hides the per-row appearance-stack list for a
  selected group, but leaves a frame's own Fill/Stroke block fully editable,
  exactly as before.
- **"Should this node's opacity/effects composite over its whole subtree?"** —
  now true for every children-bearing node: group, Blend, **and frame**. All
  three render children as visual content alongside (group/Blend: an invisible
  placeholder; frame: a real background) the node's own shape, so in all three
  cases an opacity/filter left only on that own shape can never reach the
  children — the same structural bug, just previously fixed for only two of
  the three cases.

This is Figma's frame semantics: a frame's opacity and effects apply to the
frame as one composited unit — background plus every child — not just to its
own background layer.

Frames in this editor do not clip their children in any renderer today (the
schema-level `clipsContent` flag on a frame is currently wired only to a
Layers-panel "Clips content" badge, not to an actual `clipPath`/`overflow` in
the canvas or export renderers), so a frame's effect region is sized from the
union of the frame's own background rect AND its (possibly overflowing)
children — never just the background rect — so a shadow or blur is never
clipped away even when a child has been moved, resized, or added outside the
frame's own background bounds after the frame was created.

Groups and Blend containers render byte-identically to Phase 5: their
degenerate placeholder geometry is always positioned exactly at the top-left
corner of their children's own bounding box, so including it in the same
composite-bounds union that now also serves frames can never change their
computed region.

## What Users Can Do Now

- Toggle fill/stroke presence with one click, in the floating inspector HUD or
  the docked rail — no more typing `0` into a width field or hunting for a
  "none" swatch.
- See at a glance whether an object is stroked: the checkbox state and the
  collapsed/expanded block say it before any number is read.
- Switch stroke position (inside/center/outside), cap (butt/round/square), join
  (miter/round/bevel), and solid/dashed/dotted style in a single click each,
  with glyphs that look like the result.
- Batch-toggle across a multi-selection; a mixed selection shows an
  indeterminate checkbox plus the standard Mixed badge, and checking it turns
  the role on for every selected node.

## How To Use

1. Select one or more objects; open **Appearance** (floating HUD tab or docked
   rail).
2. **Fill / Stroke checkbox** at the top of each block turns the role on or
   off. Off collapses the block; on restores exactly what was hidden (or seeds
   a default solid + 1px width when nothing would otherwise appear).
3. Inside the Stroke block: **Color / Opacity / Width px**, then segmented
   **Position**, **Cap**, **Join**, **Style**. Hover any segment for its name.
4. Choosing **Dashed** or **Dotted** reveals the **Dash px** pattern field
   (space/comma separated lengths, e.g. `6 3`). Dotted also sets Cap to Round;
   changing Cap away from Round keeps the dash values but no longer renders dots.
5. Open a Fill or Stroke **Linear** / **Radial** paint popover to show the
   Gradient tool handles on canvas for that role.

## What A Reviewer Should Verify

- Toggle a gradient-filled object's Fill off, then on — the gradient (not a
  flat color) returns, on canvas and in SVG export.
- Select an object with stroke color set but width 0 (the reported case):
  Stroke checkbox reads unchecked; checking it makes a 1px stroke appear
  immediately on canvas.
- Toggle Stroke off on a dashed, outside-aligned stroke, then on — width,
  dash pattern, and alignment are unchanged.
- Multi-select one stroked and one unstroked object — the checkbox renders
  indeterminate with a Mixed badge; checking it strokes both, as one undo.
- Cap/Join segments visually change the canvas immediately (butt→round on an
  open path end; miter→bevel on a sharp corner).
- Stroke Linear and Radial gradients show on-canvas handles when the Stroke paint
  popover is open, and dragging them updates the stroke paint rather than the fill.
- Selecting Dotted sets Cap to Round and produces dot rendering; changing Cap to
  Butt or Square makes the Style control leave Dotted.
- Each toggle/segment click is exactly one undo step.
- Select a single group whose children have visible fills: the Fill checkbox
  reads checked (not the wrapper's own placeholder state); toggling it off
  removes the fill from every child on canvas in one undo step, and toggling it
  back on restores/seeds it.
- Select a group alongside a plain shape: toggling Fill off removes fill from
  both the group's children and the plain shape, not just the plain shape.
- Recolor a fill/stroke while a group is selected: every child recolors, and
  the group's own (invisible) wrapper paint is left untouched.
- Node-scoped fields — Opacity, Blend, Drop shadow, Inner shadow, Layer blur —
  still read and write the selected group itself, not its children, in the
  Inspector's data model.
- Set a group's Opacity below 100%: every child visibly dims as one unit, on
  canvas, in SVG export, and in the standalone exported-code player.
- Add a Drop shadow to a group with two children: exactly one shadow renders,
  around the union silhouette of both children, not two separate per-child
  shadows, and the shadow is not clipped.
- Add a Layer blur to a group: the children blur together as one composited
  image, not independently.
- Keyframe a group's Opacity and scrub/play the timeline: the children fade in
  sync with the keyframes.
- A leaf shape's own Opacity/effects are unaffected by this fix — behavior and
  rendered DOM/SVG structure are unchanged for non-group, non-Blend nodes.
- Set a frame's Opacity below 100%: the background AND every child visibly dim
  together as one unit, on canvas, in SVG export, and in the standalone
  exported-code player — not just the background.
- A frame's own Fill/Stroke checkbox and paint editing still target the
  frame's own background directly (unlike a group, a frame is not expanded to
  its children for paint edits) — Phase 4/6 are deliberately different here.
- Add a Drop shadow to a frame whose background is smaller than (or offset
  from) its children, or a child has since been dragged/resized outside the
  frame's own background rect: the shadow still covers the full extent of the
  children, not just the background rect.
- Set a frame's background Fill to none and add a Drop shadow: the shadow
  follows the silhouette of the children (each child casts its own visible
  shadow shape), since there is no opaque background to hide behind.
- Keyframe a frame's Opacity and scrub/play the timeline: background and
  children fade together in sync with the keyframes (motion playback retargets
  onto the same subtree carrier a group's animated opacity uses).

## Intentional Limits

- The toggle does not remember a previous stroke width across an off→on cycle
  when the width was `0` at enable time (it seeds `1`); undo restores exact
  prior state.
- Dotted is represented as a tiny positive dash plus Round cap, not a literal
  zero-length dash, because zero dash entries are normalized away before render/export.
- Shadow / inner-shadow opacity stays a compact numeric field — a full-width
  slider row would break the 3-column shadow grid.
- Background blur on a group (like on a leaf) has no faithful SVG filter path
  and stays deferred/surfaced, not rendered — see `effect-capability-contract.md`.
- The mask-source exclusion in Phase 5's bulk-paint skip only matters for the
  general contract the underlying helper promises; today's masking feature
  requires a mask source to be a top-level layer sibling, which is mutually
  exclusive with being inside a group, so the excluded case cannot currently
  be produced through normal grouping/masking UI.
- Frames do not clip their children to the frame's own bounds in any renderer
  today, even though the frame schema carries a `clipsContent` flag (currently
  surfaced only as a Layers-panel badge). A child that visually overflows a
  frame's background rect stays fully visible past that rect, on canvas and in
  every export target; Phase 6's composite effect-region sizing depends on
  this fact and would need to change if frame clipping is implemented later.
