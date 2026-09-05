# Corner Radius Expansion

Date: 2026-06-23.
Status: implemented (pending in-app visual sign-off). On-canvas corner handles,
keyframe animation, per-corner independence, star/polygon rounding, corner
smoothing (squircle), SVG/PDF export, and AI/MCP authoring are all wired and the
static gate + unit suite are green. The geometry is verified by unit tests; the
on-canvas drag and squircle curve are best confirmed visually in the editor.

## Summary

Vecmo already had a single uniform corner radius on rectangles (the Inspector
"Radius px" field). This work expands corner radius into a first-class,
direct-manipulation, and animatable feature for a motion editor:

- On-canvas corner-radius handles on the selection bounding box (drag to round).
- Corner radius as keyframe channels, so rounding can animate over time.
- Per-corner independence (top-left / top-right / bottom-right / bottom-left) for
  rectangles and frames.
- Corner smoothing (squircle) blending from a circular arc to an iOS-style
  superellipse, with a one-click 60% preset.
- Rounding for stars and polygons (outer corners), in addition to rectangles.

A single shared geometry module (`corner-geometry.ts`) is the only source of
rounded-corner math, so the canvas and every exporter stay consistent. Radii are
stored RAW (the authored value) and clamped only at render time, so animating a
shape's size never makes its radius "stick" at the pill state.

## What Users Can Do Now

- Round a rectangle directly on the canvas: select it and drag the inset corner
  handles toward the center. Hold Alt/Option to round only the dragged corner.
- Round rectangles, stars, and polygons from the Inspector "Radius px" field.
  Stars round their outer tips; the inner points stay sharp.
- Round each rectangle corner independently via the Inspector "Per corner" toggle
  (top-left / top-right / bottom-left / bottom-right fields).
- Apply iOS-style corner smoothing (squircle) via the Inspector "Smoothing %"
  field, with a one-click 60% preset.
- Keyframe corner radius (uniform, per-corner, and smoothing) and scrub the
  timeline to animate rounding; the animation also bakes into SVG/PDF export.
- Have the AI agent create rounded shapes and adjust corner radius / per-corner
  radii / smoothing through the MCP scene commands.

## How To Operate It

- Canvas: select a rectangle; the inset corner-radius handles appear near the
  bounding-box corners. Drag toward the center to round; Alt/Option-drag rounds a
  single corner. (Stars/polygons round from the Inspector, not on canvas.)
- Inspector: set "Radius px" for any roundable shape; toggle "Per corner" for a
  rectangle to expose the four corner fields; set "Smoothing %" (or press the iOS
  preset) for the squircle blend.
- Timeline: each corner channel shows its own row; add keys to animate. Editing a
  field while recording keys the playhead frame.

## What A Reviewer Should Verify

- Existing documents with a uniform corner radius render and export unchanged
  (the backward-compatibility byte-lock test guards this).
- Dragging an on-canvas corner handle rounds the shape and is a single undo.
- The on-canvas resize handle is still reachable at the exact corner (the radius
  handle sits inset and never blocks resize).
- Keyframing a corner radius and scrubbing animates the rounding on the canvas
  and in exports.

## Export Fidelity

| Surface | Uniform | Per-corner | Star/polygon | Squircle |
| --- | --- | --- | --- | --- |
| Canvas | `<rect rx>` | baked path | baked path | baked path (arc) |
| SVG | `<rect rx>` | baked path | baked path | baked path (arc) |
| PDF | `re` | baked cubics | baked cubics | circular fallback |
| Code export | unchanged | unchanged | unchanged | unchanged |

PDF has no arc operator, so a squircle exports as its circular equivalent
(per-corner radii are exact). The standalone "code export" runtime does not yet
bake rounded corners — that requires bundling the corner math into the runtime
and is a separate task.

## What Is Still Intentionally Limited

- Per-anchor "Live Corners" on arbitrary bezier paths is out of scope; rounding
  applies to rectangles, frames, stars, and polygons.
- Only round corners and squircle smoothing are supported; chamfer and inverted
  corner styles are out of scope.
- On-canvas corner handles are rectangle-only. Stars and polygons round from the
  Inspector — placing a handle at a bounding-box corner of a star would sit far
  from its tips and mislead, so it is deliberately omitted.
- A frame's background rounds, but clipping its children to the rounded
  silhouette is deferred to the mask/clip system. A rounded frame still clips
  children to a square box for now.
- Corner smoothing (squircle) is edited in the Inspector only; there is no
  separate on-canvas smoothing handle.
- Per-corner radii animate independently only after the rectangle is in
  "Per corner" mode; a uniform rectangle animates through the single radius
  channel.
- SVG import maps `rx`/`ry` to a uniform radius only; per-corner and squircle
  values are not imported. PDF squircle export is circular (see Export Fidelity).
