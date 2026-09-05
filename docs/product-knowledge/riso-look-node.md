# Riso Look Node

Date: 2026-07-05.
Status: beta — GPU raster-finish node in the Display/Pixel/Print Look effects
pack, alongside Halftone.

## Summary

The Look graph gains a new node kind, `riso`: a GPU raster-finish dot-screen
effect that simulates a risograph print pass. One to three spot-ink plates
are each screened at their own angle and registration offset, then composited
as a subtractive overprint (overlapping dots multiply toward a darker mixed
ink, e.g. pink x blue = purple) over the source image. Grain thins ink
coverage unevenly, and a print-on control grows the dots from nothing for a
reveal.

Like `halftone`, this node is **not SVG-native**. It needs per-plate rotated
lattice sampling and anti-aliased variable dot radius, so it runs as a WebGL
fragment-shader pass in the same deferred fidelity family as `lens`,
`kaleidoscope`, `flow`, `noise-source`, `path-blur`, `deep-glow`, and
`halftone`. Static SVG/PDF and Worker SVG output report the node as
deferred/omitted rather than overclaiming native fidelity.

This entry also covers the node's second stage: a global **Amount** and a
spatial **Field** (uniform / linear / radial) that gradient the print effect
across the object instead of applying it uniformly.

## What Users Can Do Now

- Add **Riso** from the Look workspace node palette in the Texture category
  (search "riso", "risograph", "risograph print", "spot color", "spot ink",
  "screen print", "print", "dot screen", "dots", "newsprint", or "poster").
- Control the print pass with sliders:
  - **Cell Size** — dot pitch, in artboard pixels / scene units.
  - **Dot Size** — maximum dot radius multiplier; values above 1 let the
    darkest cells overlap slightly.
  - **Contrast** — tonal steepness before dot radius is calculated.
  - **Grain** — ink-coverage unevenness (paper-texture roughness).
  - **Mix** — blend the printed result over the original image.
  - **Print On** — reveal progress, from unprinted (source shows) to fully
    printed. Keyframable for a print-on animation.
  - **Amount** — a single global effect strength, 0 to 1, gating both dot
    scale and the final printed/source blend. Keyframable.
  - **Field Softness** — edge softness for the spatial field below, from a
    hard cutoff to a fully smooth falloff. Keyframable.
- **Print Bloom** — a one-click authoring shortcut next to the Field controls
  that seeds a **Print On** (`bloomProgress`) keyframe ramp for you instead of
  hand-placing two keys: enter a duration in frames (default 36), then choose
  **Bloom in** (0→1, dots develop in from nothing) or **Dissolve out** (1→0,
  dots dissolve back to the source), starting at frame 0. Both keyframes land
  as a single undo entry. This writes to the same `bloomProgress` param the
  **Print On** slider drives — no new param, no shader change — it is purely a
  faster way to author the print-on/print-off reveal.
- Choose a **Blend** mode for how the printed dot screen composites over the
  source, from the 12 separable blend modes: Normal, Multiply, Screen,
  Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light,
  Difference, or Exclusion. (The 4 non-separable HSL modes — hue, saturation,
  color, luminosity — are not offered; they have no simple per-channel GLSL
  formula.)
- Choose a **Field** shape for how the print effect distributes across the
  object:
  - **Uniform** — the effect applies evenly everywhere (default).
  - **Linear** — the effect gradients along an axis across the object.
  - **Radial** — the effect gradients outward from a center point.
  - An **Invert field** toggle flips which side of the field reads as fully
    printed vs. unprinted.
- Drag the field's spatial handles directly on the canvas while the `riso`
  node is selected in the Look workspace: a Linear field shows a draggable
  start/end axis line, a Radial field shows a draggable center point and a
  radius handle on its ring. No separate tool is needed — the handles appear
  automatically whenever a `riso` node with a Linear or Radial field is
  selected, and disappear when the field is Uniform or the node is locked.
  Handles work for both frame/artboard-scoped and object-scoped Riso graphs.
- Author 1-3 spot inks, each with its own color, screen angle, and
  registration offset, via the default two-ink preset on insert.
- Chain it with other GPU raster-finish Look nodes on the editor canvas and in
  WebM/WebGL playback export.
- Agent/MCP clients can discover the node's image ports and the `amount`
  param through `list_look_node_capabilities`, then add or update it with
  `scene/patch-look-graph`.
- Keep effects open: this node is not Pro-gated. Pro value remains cloud/publish
  continuity, not effect availability.

## How To Use

1. Open the Look workspace for the target frame/artboard Look graph.
2. Add **Riso** from the Texture category.
3. Keep the defaults for a visible two-ink risograph print on insert.
4. Increase **Cell Size** for chunkier print dots, or lower it for a tighter
   screen.
5. Raise **Dot Size**, **Contrast**, or **Grain** for heavier, rougher ink
   coverage.
6. Animate **Print On** from 0 to 1 for a print-reveal effect, or **Amount**
   for an overall effect fade in/out — or use the **Print Bloom** shortcut to
   seed that same ramp in one click: set the duration in frames and click
   **Bloom in** or **Dissolve out**.
7. Switch **Field** to Linear or Radial to gradient the print across the
   object (e.g. printed at one edge, clean source at the other) instead of
   applying it uniformly; raise **Field Softness** for a smoother transition.
8. With the `riso` node selected in the Look workspace, drag the on-canvas
   handles to reposition the field directly: the axis endpoints for Linear,
   or the center/radius handles for Radial.
9. Lower **Mix** when the effect should texture the source instead of
   replacing it.

## What A Reviewer Should Verify

1. Adding the node from the palette inserts a `riso` node and the canvas
   shows a visible two-ink dot screen.
2. Dragging **Cell Size**, **Dot Size**, **Contrast**, **Grain**, **Mix**,
   **Print On**, and **Amount** produces monotonic visual changes.
3. Switching **Field** between Uniform/Linear/Radial changes how the print
   effect distributes across the object; **Invert field** flips the
   direction; **Field Softness** changes edge sharpness.
4. Selecting a `riso` node with a Linear or Radial field shows the matching
   on-canvas drag handles; selecting a Uniform-field node, a different node
   kind, or no node shows none. Dragging a handle updates the rendered field
   live and lands as a single undo entry per drag; the handles track object
   bounds correctly for both frame/artboard-scoped and object-scoped graphs.
5. Clicking **Bloom in** or **Dissolve out** in the Print Bloom control seeds
   two `bloomProgress` keyframes (at frame 0 and at the entered duration) as
   one undo entry; scrubbing the timeline between them should show the riso
   dots growing in (or dissolving out), and the **Print On** slider should
   read the interpolated value at the playhead.
6. Toggling the node removes/restores the GPU overlay.
7. A serial chain of GPU raster nodes still renders in order.
8. Static SVG/PDF and Worker SVG output do not pretend the node is native;
   fidelity metadata should identify the node as deferred/omitted.

## Verification Performed

`bunx tsc -b`, `bun run check:arch`, and `bun run check:agent-contract` pass.
The field math (uniform/linear/radial gradient, softness falloff, invert) was
verified in an isolated WebGL harness before this port; this change wires the
verified GLSL and the surrounding payload/normalizer/adapter/inspector plumbing
without altering the field formula.

The on-canvas field drag handles (always-mounted overlay, self-gated on Look
graph node selection; writes go through the same command bus as every other
scene edit, coalesced to one undo per drag) pass `bunx tsc -b` and
`bun run check:arch`. Live drag behavior in the editor has not yet been
manually verified in-browser.

**Print Bloom** (the one-click `bloomProgress` ramp seed) adds no new
sampling or shader code: it seeds two keyframes on the same `bloomProgress`
track the **Print On** slider already reads via
`effectiveLookNodeParam` → `patchLookGraphForOwner` →
`sampleFrameLookGraphScene` at playback and across export targets. The seed
helper and Inspector control pass `bunx tsc -b` and `bun run check:arch`; live
in-browser playback (scrubbing the timeline and confirming the riso dots grow
or dissolve) has not yet been manually verified.

## What Is Still Intentionally Limited

- **Not native to static SVG/PDF/Worker SVG.** This is a deferred GPU effect.
  Static vector surfaces should omit it with fidelity metadata rather than
  approximating it.
- **No CMYK/rosette simulation.** The print pass is 1-3 spot-ink plates, not a
  print-accurate multi-channel press model.
- **Radial handle is not aspect-corrected for non-square objects.** The
  radius ring renders as an ellipse (`radius` scaled independently by the
  target's width/height) rather than a true circle when the target bounds
  aren't square; a follow-up should give the radius handle its own
  aspect-correct drag axis.
- **Ink list (color/angle/offset) has no dedicated Inspector editor yet.**
  Inks are set from the default two-ink preset on insert; per-ink editing UI
  is future work.

## Related Docs

- [Halftone Look node](./halftone-look-node.md)
- [Display / Print Look recipe starters](./display-print-look-starters.md)
- [Commercial packaging strategy](./commercial-packaging-strategy.md)
- [Motion / Code WebGL runtime](./webgl-player-export.md)
