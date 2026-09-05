# Shape Builder

An Illustrator-style Shape Builder tool. With one or more editable shapes
selected, it partitions the (overlapping, when more than one) selection into
discrete regions ("faces") and lets the user extract a single clicked face or
merge dragged regions into clean generated shapes. The tool stays live on a
single source, so the compound node a merge just produced can immediately be
eroded further or extended by clicking in more shapes, without a round-trip
back through the Select tool.

## How to use

1. Select one or more editable shapes (rectangles, ellipses, polygons, stars, or
   paths) with the Select tool — typically two or more overlapping shapes, so
   there is an overlap to work with, but a single shape is enough to activate
   the tool and start eroding or extracting regions from it.
2. Activate Shape Builder from the tool rail or press `Shift+M`.
3. Use the Shape Builder options strip to choose **Artwork** or **Swatch** mode.
   Artwork keeps Illustrator-style source style inheritance. Swatch applies the
   active fill colour to newly extracted/merged regions; click the fill chip to
   open the in-app colour picker, or use `←` / `→` while Shape Builder is active
   to cycle the cursor swatches. The same strip also has curve detail presets:
   **Fewer** reduces fitted anchors, while **Detailed** is the default and keeps
   more anchors for higher fidelity.
4. Hover the cursor over the overlap. Each bounded region is outlined with a
   high-contrast halo edge that stays legible over any fill colour. The region
   under the cursor is darkened, and a **bold outline previews the exact shape you
   will get** — as you drag across more regions the preview grows to trace the
   combined silhouette, so you see the result before committing. In Swatch mode,
   the preview is also washed with the active fill and the cursor shows a compact
   three-swatch strip. A cursor label names the actual commit intent (Extract /
   Merge / Erase), so a single click — which extracts one region and splits the
   rest, as in Illustrator — is explicit at the point of action.
5. **Extract**: click a single region to cut it out as a new shape while keeping
   the affected source remainders around it. This is the face-level, Divide-like
   workflow for precise region picking.
6. **Merge**: drag/scribble a stroke across several regions to combine them into
   one clean shape. The stroke has an Illustrator-style
   tolerance, so tracing along an existing seam or path edge still collects the
   adjacent regions instead of requiring a perfect interior hit. Drag/marquee
   merge treats every touched source shape as construction input, consumed
  wholly: the result is one compound node containing the union of the whole
  participating shapes plus the gap faces/bridge necks reached by the original
  sweep, not just the faces the stroke happened to trace. Once the participating
  source set is expanded, bridge detection is not widened again across the whole
  compound; this keeps the fifth-and-later merge from adding remote necks the
  pointer never approached. Merge never leaves remainders or cleanup candidates,
  and the generated node is the sole selection after commit. Selected shapes that
  did not contribute to the merged regions stay intact.
7. **Erase**: hold **Alt/Option** and click or drag across regions to delete them.
   A region shared by several objects is cut out and the objects are broken.
   **Alt-clicking a shape that is not part of the current mesh** (nothing swept,
   no drag) instead deletes that whole shape as one undoable command, enabling
   consecutive Alt-clicks across separate objects — click, click, click — with no
   re-selection round-trip in between. This resolves only on release of a true
   click; an Alt-drag that engages a stroke cancels the pending delete and falls
   through to the normal face-level erase gesture. Alt-clicking a shape that IS
   already part of the mesh keeps the face-precise erase behavior above
   unchanged — a tolerance miss on an in-mesh shape is a no-op, never a
   whole-shape delete.
8. **Marquee**: hold **Shift** and drag a rectangle to select every region inside it
   at once.
9. On release the operation commits and the created (merge) or removed (erase) shape
   flashes once, so it is clear what changed. `Cmd/Ctrl+Z` undoes the whole thing in
   a single step. If a click extract leaves source remainders that the user decides
   are construction leftovers, the Shape Builder strip exposes a remainder cleanup
   button with the current candidate count; it deletes only those recent candidates
   through the normal undoable delete command. `Esc` cancels an in-progress drag.

## What it does under the hood

The tool computes the **planar arrangement** of the selected paths: it finds every
intersection between their edges, splits the edges there, and walks the resulting
planar graph to enumerate every minimal bounded face. Each face is tagged with the
set of source shapes that cover it (its provenance).

Each commit first builds a **Shape Builder operation plan**: it records the actual
intent (`extract`, `merge`, or `erase`), the generated face set, per-source fate
(`untouched`, `rebuilt`, or `consumed`), cleanup candidates, selection targets, and
output complexity counts (generated/remainder nodes, contours, and anchors). The
scene mutation is then a thin one-command apply of that plan.

The result uses **affected-source cleanup**. With `S` the set of swept regions,
sources that do not cover any swept face are left untouched with their original
ids and layer positions. **Click extract** and **erase** rebuild affected sources
as the union of *their* faces minus `S`, preserving source style for intentional
remainders — this is the precise, divide-like operation, and the only one of the
three that leaves rebuilt remainders (offered as cleanup candidates).

**Drag/marquee merge** treats every participating source as construction input,
consumed wholly, not just the faces `S` happened to sweep. A source
"participates" if it covers at least one face in `S` (after gap-bridge
expansion); every face covered by any participating source — anywhere in the
arrangement, not only inside `S` — is pulled into the output, and bridge
detection re-runs over that expanded set so participating shapes still join
across a small gap even when the trace missed the neck. The generated node is
`union(whole participating shapes ∪ swept-near gap faces ∪ swept-near bridge necks)`
(inheriting the mouse-down source's style in Artwork mode, or receiving the
active solid fill in Swatch mode), emitted as exactly ONE compound node. The
bridge necks are those reached by the original sweep before whole-source
expansion; bridge expansion is not re-run after the compound grows, so adding a
fifth shape cannot pull in a remote connector from some other part of the large
source. Merge never creates remainders or cleanup candidates for the
participating sources, and the generated node is the sole selection after
commit. Disconnected generated contours are stored as subpaths of that one
compound path node rather than separate layer rows. This is what keeps repeat
merge workflows from leaving unwanted source fragments or leftover layer rows
behind, without deleting unrelated selected artwork that never contributed to
the merge.

Region outlines are produced by re-tracing the boundary of each face group
(dropping interior shared edges); disconnected contours are compacted into the
single generated compound path for the operation. The whole operation is one scene
command — a single undo step, which restores the full prior source set.

Generated output uses a shared curve-detail pipeline for hover preview, commit
flash, and committed scene geometry. Detail changes pre-fit boundary
simplification and cubic re-fit tolerance: Fewer uses stronger simplification and
a larger tolerance to reduce anchors, while Detailed is the default and lowers
the tolerance to preserve more fitted anchors. The planar arrangement itself is
not re-flattened by this control, so hit testing, face identity, source fate,
contour count, and object count stay stable.

## Scope and limits (current)

- **Extract, merge, erase, and marquee** are supported. Extract/erase are
  face-precise and preserve intentional affected remainders; drag/marquee merge
  consumes every participating source shape WHOLLY (not just the swept faces)
  and selects only one generated compound merge result, with no remainders or
  cleanup candidates.
- **Artwork / Swatch colour modes.** Artwork mode preserves existing style
  inheritance. Swatch mode applies a user-chosen solid fill to generated regions,
  with cursor swatch preview and arrow-key cycling. Used Swatch colours are added
  to the shared recents list. Extract/erase source remainders keep their original
  styles, and erase remains unpainted.
- **Manual remainder cleanup.** Click extract preserves affected source
  remainders for precise Divide-like editing, but those remainder ids are tracked
  as short-lived cleanup candidates tied to the creating extract operation. The
  toolbar cleanup button is hidden until candidates exist, then deletes only the
  latest candidate ids returned by that commit; it never infers targets from node
  names, layer positions, or `-sb` id patterns. Starting another gesture or
  rebuilding the arrangement clears the candidates. Erase remainders are
  considered the edited result and are not offered as cleanup candidates.
- **Generated curve detail.** Fewer / Detailed presets adjust boundary
  simplification and the tolerance used when the generated or reconstructed
  regions are re-fitted to cubic Béziers. Detailed is the default; Fewer is an
  explicit simplification mode. This changes anchor density/fidelity for future
  Shape Builder output without changing which faces are selected or how many
  connected output contours are produced inside the compound path.
- **Path-like tracing.** Drag gestures use a screen-constant brush tolerance over
  the arrangement, so a fast stroke or a line drawn along shared edges still sweeps
  the touched faces. The canvas shows both the drawn sweep stroke and the exact
  resulting union preview before release.
- **Single artboard.** The tool operates within one artboard.
- **Smooth curves.** Curved sources (ellipses, curved paths) are flattened to run
  the arrangement, then the committed result is re-fitted to corner-preserving
  cubic Béziers — so a merged circle reads as a few smooth arcs joined at the
  intersection corners, not a dense faceted polygon. Straight sources stay
  straight (their corners are never rounded).
- **Gap detection.** Shapes that overlap or touch merge directly; shapes separated
  by a small gap are bridged automatically so they still merge — the tool inserts a
  thin zero-width connector across the gap (Illustrator-style gap closing) WITHOUT
  moving the artwork. The tolerance scales with the selection size (a few px up to
  ~24px); a user-facing preset/slider is a later phase. Bridge construction is
  local: both connector edges must stay near the actual gap, so sparse
  corner-near-corner cases that would create a long synthetic diagonal are left
  unbridged. Compound-path holes remain fillable regions, but their internal
  boundaries are not used as gap-bridge endpoints; gap closing only starts from
  exterior/island boundaries, preventing tunnels from cutouts to neighbouring
  shapes. Gaps wider than the tolerance are also left unbridged so shapes placed
  apart on purpose stay separate.
- **Fully-contained shapes (donut / ring).** A shape entirely inside another with no
  edge crossing is carved as a hole: the container reads as an annulus and the inner
  shape as its own region. Erasing the inner shape punches a hole (the container
  becomes a ring); the annulus can also be selected or extracted on its own. Nesting
  is detected across the disconnected pieces and holds for any depth. (Edge case: if
  the inner shape sits within the gap-detection tolerance of the container's edge it
  is bridged rather than carved — separate them slightly to punch the hole.)
- **Motion tracks on a source.** Building consumes the source nodes, so keyframe
  motion that targets a consumed node is orphaned — the existing orphan-motion
  detection surfaces it as a repairable validation issue. Carrying motion onto the
  result is a later phase.
- **Object-scoped looks on a source.** Shape Builder's main commit path removes
  sources and inserts generated output atomically, but it still keeps
  scene/artboard object-scoped look targets coherent: extract/erase sources that
  rebuild into a remainder retarget their scoped looks to the rebuilt node id,
  while sources that are truly consumed are dropped from target lists. This
  prevents invisible scoped-effect references from outliving the nodes they
  targeted without treating rebuilt source fragments as deleted.
- **Untouched selected shape.** A selected shape that does not cover any swept
  region is not rebuilt or deleted; it keeps its original id, layer slot, geometry
  kind, and appearance. Merge consumption is scoped to the source nodes that
  actually participated in the swept regions — but a participating source is
  consumed in full, including any of its faces the sweep never touched.
- **Top-level source boundary.** Shape Builder currently accepts selected
  top-level editable leaf shapes. Selected containers and nested children are
  intentionally excluded until parent-aware replacement is designed: consuming a
  child inside a group, frame, or Blend requires parent-local output rebasing and
  container metadata updates, so the tool fails closed rather than hoisting
  partial container edits into the layer root.
- **Stays live from one source upward.** The tool arranges as soon as at least
  one selected top-level editable fillable shape is reachable; with two or more
  it also detects overlap between them. This is what keeps the tool live after a merge: the merge
  commits with the generated compound node as the sole selection, so the
  arrangement immediately recomputes over that single node and Alt-click/drag
  can erase regions of it, a plain click can extract a region from it, and
  clicking any other unlocked shape on the canvas adds it to the working set
  for further drag-merging — no return to a two-object selection is required.
  Only a working set of ZERO usable sources shows a prompt, and that prompt
  invites clicking shapes rather than demanding a specific selection count.

## Robustness

The face walk sorts edges around each vertex with an exact cross-product
comparator (no floating-point angle tolerance), so near-collinear edges never
mis-sort. Three structural invariants (every half-edge visited once, twin/next
involution, per-component Euler characteristic) guard against gross topology
errors and surface a typed error rather than emitting a malformed shape.
