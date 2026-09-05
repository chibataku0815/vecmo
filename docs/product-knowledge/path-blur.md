# Path Blur Look Node (curvature-following directional streak)

Date: 2026-07-01.
Status: `beta` (inherits the Look graph authoring surface, which is beta/internal).
Update 2026-07-01: added **per-object Path Blur** (scoped overlay) — see
[Per-Object Path Blur](#per-object-path-blur-scoped-overlay) below.
Update 2026-07-02: added **legacy auto-seed detection + one-click repair** — see
[Legacy Auto-Seed Repair](#legacy-auto-seed-repair) below.

## Summary

The Look graph gains a `path-blur` effect node: a **directional streak that follows
user-drawn guide paths**, the GPU equivalent of Photoshop's **Path Blur**. Instead of
smearing every pixel along one global vector (a plain motion blur), Path Blur builds a
**velocity field** from one or more guide paths and streaks each pixel along the local
direction of the nearest guide — so the blur **bends with the curve** of the path. It is
a frame-tier effect on **VMA's GPU (WebGL) raster-finish surface**, alongside Lens,
Kaleidoscope, and Flow — a curved-velocity remap SVG filters provably cannot do
(`feDisplacementMap` cannot follow a curved field).

A freshly inserted node seeds a single **curved arc guide** (a left→centre→right sweep
with bent tangents), so it reads as an intentional curved streak the moment it inserts —
no setup needed.

## What Changed?

- The GPU raster surface (`@/shared/gpu-lens/surface`) gains a `path-blur` mode: it
  samples a precomputed RGBA velocity field (built from the guide paths) and integrates
  a multi-tap streak along the local flow direction. Per-guide `startSpeed`/`endSpeed`
  taper the reach from the path head to its tail.
- A new authorable Look node kind `path-blur`, an ordinary effect node (image + optional
  mask in, image out). Params: **Speed** (reach multiplier, 0..500%), **Length** (base
  streak length in UV, e.g. 0.12), **Taper** (0..1), **Centered Blur** (centre the streak
  on the pixel vs trail behind it), plus **Strobe Strength** / **Strobe Flashes** (stored on
  the node but withheld from every editing surface until a later strobe render phase). Speed /
  Length / Taper are bindable scalars (set by AI/code through the bindable seam) and surface as
  Inspector controls; the guide geometry and per-guide speeds are authored as guide data.
- The editor canvas overlay and WebM video export detect `path-blur` and render it on the
  GPU surface; the entities compile path marks it `deferred`. SVG export already warns that
  deferred nodes are not rendered; PDF export now emits the **same deferred-effect warning**
  (previously it dropped Path Blur silently), and PNG-still inherits the SVG warning.

## What Can The User Do Now?

Pick the **Path Blur tool** (tool rail, shortcut `B`). Path Blur is a **frame-level** effect —
it blurs the whole artboard composite, so every object on the artboard (including a plain shape
drawn afterward) picks up the streak. Because that is a deliberate, artboard-wide choice, the
tool does **not** auto-enable it: on an artboard with no path-blur node yet, picking the tool
shows a non-blocking on-canvas hint (“this effect applies to the whole artboard”) with a
one-click **“Add Path Blur”** button plus a route to the Look workspace. Only after you add it
does a curved guide + blur appear; the add is non-destructive (it preserves any existing look).
The guide draws with an Illustrator-style visual language that keeps the two handle roles apart
at a glance: **anchor points are squares** (drag to move the curve) and **tangent handles are
circles** on their arms (drag to reshape the curvature); the streak re-bends to follow live
(one undo per drag). The cursor signals what each spot does — grab over a handle, a crosshair
over the curve body, a remove cursor over an Alt-held anchor.

On-canvas guide editing:

- **Move / reshape** — drag an anchor square (move) or a tangent circle (bend).
- **Select + delete a guide** — click a guide's anchor to select it (it highlights heavier),
  then press **Delete / Backspace** to remove that guide. Deleting the last guide is allowed.
- **Insert an anchor** — click on the curve body; the split preserves the curve exactly.
- **Remove an anchor** — **Alt-click** the anchor (kept above a two-vertex minimum).
- **Add another guide** — click empty canvas; the velocity field blends all guides.

Path Blur's scalars now surface directly in the **Inspector** (artboard → Frame Look → Look
Graph, with the Path Blur node selected): scrub **Speed** and **Length** to set how far the
streak reaches, **Taper** to fade the tail, and toggle **Centered** to centre the smear on
each pixel — no Look-workspace trip needed (the workspace still shows the same controls). The
effect shows live on the editor canvas (on scrub) and in WebM video export, can be gated by a
Mask node, and combines with other Look nodes (it streaks the already-graded/glowed composite,
sitting downstream of them in the graph).

## Per-Object Path Blur (scoped overlay)

Path Blur no longer has to be artboard-wide. Selecting a single **top-level**
object (not nested inside a group) while the Path Blur tool is active retargets
the tool: the on-canvas hint now offers **"Add Path Blur to the selected
object"**, and picking it creates a `look-graph-overlay` scoped effect
(`source: "object-path-blur"`, same storage family as Object Noise Gradient)
targeting only that node, instead of touching the frame Look. If the selected
object already owns a scoped Path Blur, no hint shows — the guide handles
appear directly, ready to edit.

Mechanically, this is a different rendering path from the frame node, not a
smaller version of it:

- **Isolated GPU crop, not a whole-frame pass.** The target node is rendered
  alone into a small crop surface sized to its own padded paint bounds, blurred
  by the same shader as the frame node, then composited back onto the finished
  frame at that bounds offset (`buildScopedPathBlurTargets` in
  `gpu-raster-adapter.ts`, `renderIsolatedNodeSvg` in `svg.ts`). The base
  render (editor canvas SVG, WebM's per-frame SVG) omits the target node
  entirely when a GPU compositor is about to run — painting it there too would
  double it (sharp underneath the blurred crop).
- **Guides are object-local UV** (0..1 across the object's own crop), not
  frame UV — there is no coordinate remap between the two spaces, which also
  sidesteps any stretch/anisotropy risk a frame-relative-with-remap design
  would have had. The guide-editing tool (`resolvePathBlurTarget` in
  `features/path-blur/model/guide-commit.ts`) automatically resolves to the
  selected object's own edit space when one is selected and owns a scoped
  overlay, otherwise falls back to the frame graph (legacy behavior
  unchanged).
- **One shared GPU surface**, reused (resized) across every scoped target and
  every frame — not one WebGL context per blurred object — in both the editor
  overlay (`features/path-blur/canvas/object-composite-overlay.tsx`) and WebM
  export (`features/export/adapters/video.ts`).
- **Top-of-stack only.** Only the frontmost node in paint order composites —
  drawing a crop "on top of the finished frame" cannot respect a later sibling
  that should occlude it, so a non-topmost target is skipped from the target
  list. Base-render suppression (both the live canvas and export) keys off the
  exact same topmost check (`scopedPathBlurTopmostTargetNodeIds`), so a target
  that loses topmost status (something is added on top of it) degrades to a
  plain sharp/unblurred render rather than vanishing — live-verified by
  temporarily occluding a blurred object with another shape.
- **Top-level only.** The isolated compositor reads the node's own `transform`
  as artboard-root space, which only holds for a node that is a direct child
  of its layer (not nested inside a group) — `createAddObjectPathBlurCommand`
  refuses for a nested node, and the hint does not offer it either.
- **Static export unaffected.** SVG/PDF/PNG-still have no GPU compositor, so a
  scoped Path Blur node there falls through to the existing "deferred, not
  rendered" honest-degradation path and the object renders sharp/unblurred —
  same as the frame node's static-export behavior.
- **Artboard duplicate follows the copy (2026-07-02).** Duplicating an artboard
  remaps every scoped look's `targetNodeIds` through the same old→new node-id
  map the content clone uses, and rebuilds node-id-embedded look ids
  (`object-path-blur:<nodeId>` / `object-noise-gradient:<nodeId>`) for the new
  targets. Previously the duplicate kept the source artboard's target ids
  verbatim, so the copied objects rendered without their scoped effects and the
  duplicate carried cross-artboard references. Targets that were not cloned are
  dropped, a look left with no duplicated target is removed, and duplicating
  with `duplicateContents: false` drops all scoped looks (their targets stay on
  the source artboard). This applies to every scoped look source: object Path
  Blur, object Noise Gradient, and analog-film selection overlays.
- **Explicit paint order over a frame-level GPU Look.** A frame that carries
  both a frame-level GPU Look (Deep Glow, Lens, etc.) and an object-scoped
  Path Blur always composites the object blur *on top of* the frame-processed
  result — `OverlayDescriptor.paintOrder` (`widgets/canvas-shell/model/
  registry.ts`) makes this a deliberate ordering, not an accident of
  `import.meta.glob`'s alphabetical file-path sort (which happened to put
  `gpu-lens` before `path-blur` today, but would silently flip if a feature
  were ever renamed). Live-verified: added a frame Deep Glow node while an
  object-scoped Path Blur was active — the blurred object stayed visible over
  the glow rather than being buried under the frame's opaque raster canvas.
  The object blur is not itself affected by the frame effect — this
  strictly-on-top ordering is a deliberate simplification, not a
  requirements-driven choice.
- **Scoped looks do not outlive their target nodes (2026-07-02).** Deleting a
  node (`scene/delete-nodes`, including via a deleted ancestor's subtree) and
  unframing (`scene/unframe-node`, which permanently drops the wrapper's id)
  now prune the removed ids from every scoped-look `targetNodeIds` list — a
  look whose target list empties is removed, and an emptied `effectIntent`
  side-car is dropped, all inside the same undoable command (undo restores
  both the node and its scoped look). This applies to the whole scoped-look
  family (object Path Blur, Object Noise Gradient, analog-film selection).
  Documents polluted before this cleanup existed are repaired on load:
  `deserializeSceneDocument` prunes scoped-look targets that reference no
  existing node id (`pruneSceneDocumentScopedLookTargets` in
  `entities/scene/model/scoped-look-prune.ts`), so stale invisible entries no
  longer accumulate in saved/autosaved documents.

## Legacy Auto-Seed Repair

Before commit `17229d7` ("Path Blur: don't auto-enable the frame blur on tool
activation"), merely picking the Path Blur tool auto-seeded a frame-level
`source → path-blur → output` Look graph onto the current artboard. Documents
saved by those builds (cloud autosave, `localStorage`) still carry that node,
so every object drawn on the artboard renders blurred even though current
builds never seed it — users read this as "the bug is not fixed".

The editor now detects those documents and offers a one-click repair, mirroring
the orphaned-motion recovery surface:

- **Detection** (`entities/scene/model/legacy-path-blur-seed.ts`) is
  deliberately conservative. An artboard is flagged only when its frame Look
  graph contains a node that is bit-for-bit the untouched auto-seed:
  - node id is exactly `path-blur:effect` — the fixed id minted only by the
    deleted `buildDefaultPathBlurGraph`. Every current insert path mints
    owner-prefixed ids (`<owner>-look-path-blur[-n]`), so this id alone dates
    the node to a pre-fix build and can never match a user-added Path Blur;
  - the node is still **enabled** (an eye-off'd node is a user decision and is
    left alone);
  - every parameter is at the insert-time default: exactly one guide deep-equal
    to `DEFAULT_PATH_BLUR_GUIDE`, speed 100, length 0.12, taper 0.4, centered
    off, strobe 0/0 (`isDefaultPathBlurPayload` in
    `entities/scene/model/look-graph.ts`). Any moved anchor, added guide, or
    scrubbed slider makes the node user-authored and it never gets flagged.
- **Surface**: the document-health monitor (`app/App.tsx`) rescans on scene
  hydration and on every committed document swap, and the approval banner
  (`widgets/agent-bridge/ui/AgentApprovalBanner.tsx`) shows a card ("Path Blur
  auto-added by an older version (n)", Japanese UI copy) with a repair button.
  **Nothing is ever removed automatically**; the button click is the explicit
  confirmation.
- **Repair** (`features/look-authoring/model/legacy-path-blur-repair.ts`)
  re-derives the scan at click time and removes each flagged node through
  `createRemoveLookGraphNodeCommand` — the same command as the Inspector's node
  Trash button, so serial neighbors re-wire (the artboard keeps a passthrough
  `source → output` graph, identical to a manual node delete) and any other
  look nodes the user added around the seed survive. All removals commit in one
  scene-store transaction, so a single **Cmd+Z restores everything** — the
  safety net if a user actually wanted an untouched default blur. The undo also
  re-triggers the scan, so the card comes back rather than being lost.

## What Should A Reviewer Verify?

- `bun run check` is green; `tsc -b` covers the node cascade. Adding the `path-blur` kind
  forces every exhaustive seam (the `normalizePayload` / `lookGraphNodeLabel` /
  `compileNode` switches, the `LOOK_GRAPH_NODE_PORT_CATALOG` and
  `FRAME_LOOK_GRAPH_NODE_KIND_LABELS` records, `defaultPayloadForKind`); the
  exhaustiveness-without-default switches are the safety net. The non-exhaustive
  `NODE_KINDS` array and the `GPU_RASTER_KINDS` set were updated by hand so the node is
  not silently dropped on insert or rendered nowhere.
- In the browser (milestone smoke): a Path Blur node on the seed artboard renders a curved
  directional streak on the editor canvas; Lens / Kaleidoscope / Flow still render (the
  shared surface mode dispatch did not regress them).
- WebM export composites Path Blur via the same `drawImage(webglCanvas → 2-D capture
  canvas)` path proven for the lens; the per-frame raster params come from the GPU raster
  adapter (the velocity field is baked from the guide topology + per-guide speeds). The
  MediaRecorder path is unchanged.
- **Object-scoped WebM export is live-verified** (static top-level target): recorded a
  timeline with one object-scoped Path Blur target and a frame-level Deep Glow, decoded the
  resulting WebM via an offscreen `<video>` + canvas, and sampled the ellipse's center pixel
  from the decoded frame — it matched the node's own fill color, confirming the isolated
  crop actually composites into the recorded output (not just that recording completes
  without throwing). The isolated crop's own render call passes `initialMotionDocument`
  (no tracks) rather than the real, animated `motion` document — mirroring the editor
  overlay — because the crop source is `sampledScene` (already sampled to the current
  frame's pose); passing the real motion doc there would re-sample the crop back to frame 0
  on every export frame, silently overriding the correct pose for a keyframed target. An
  actually-animated (keyframed) target has not been exercised end-to-end in WebM export.

## What Is Still Limited?

- **Editor canvas + WebM video, this slice.** SVG and PDF export omit Path Blur (no SVG
  path) and honestly report it as a deferred, not-rendered node via the Look graph export
  manifest. There is no PNG-still render in v1.
- The **Cloudflare Worker** SVG renderer does not run WebGL, so server-side renders also
  omit it (the same honest degradation as the other GPU nodes).
- **Strobe** (Strength / Flashes) is stored on the node but not yet rendered, so its controls
  are **withheld from every editing surface** (Inspector, Look workspace, keyframing) until the
  strobe render phase lands — the stored fields stay in the model for save compatibility, but a
  user never sees a control that does nothing. Remaining on-canvas follow-ups: pen-style drawing
  of a fresh path and per-endpoint speed rings. There is no PNG-still render in v1.
- Guide geometry and per-guide speeds are authored as guide data (not through the numeric
  bindable seam). The frame-level scalars — **Speed, Length, Taper, and the Centered toggle —
  now surface as Inspector controls** (Frame Look → Look Graph → Path Blur node), so they can be
  tuned without opening the Look workspace; per-guide start/end speeds remain guide-data-only.
- **Per-object Path Blur has no Inspector scalar controls yet** — Speed / Length / Taper /
  Centered are only editable via on-canvas guide authoring for a scoped overlay (no numeric
  entry point), unlike the frame node's Inspector sliders. Object-scoped playback tracks a
  moving/animated target's *bounds* correctly (read from the current sampled frame each
  render), but an actually-animated (keyframed) target has not been exercised end-to-end in
  either the editor's playback-follow path or WebM export — only a static target has been
  live-verified in both.
