# Pencil Brush Authoring

Status: shipped. Adds a pre-draw brush options bar to the Pencil tool, in
response to feedback that pressure and brush-type settings had no home in the UI.

## Summary

The Pencil tool now carries a brush options bar (in the ToolOptions bar, shown
while the Pencil tool is active): pick a brush family, set the stroke width, and
control pressure — all before drawing. Previously the pencil was one fixed style
(2.4px, automatic pressure taper) with no settings surface, so a user could not
tell where to set pressure or choose a brush.

## Brush families

- **Pen** — uniform width, round tip, pressure off. A clean technical line.
- **Pencil** (default) — pressure tapers the width like graphite; round tip.
- **Marker** — wide (8px), flat butt tip, uniform width.

Choosing a family seeds its sensible width / tip / pressure defaults; width and
pressure can then be overridden.

## Controls (ToolOptions bar, Pencil active)

- **Brush type** — Pen / Pencil / Marker segmented buttons.
- **Width** — slider, 0.5–40 px (the committed stroke's base width).
- **Pressure** — on/off toggle, plus a **Sensitivity** slider (0–100%) shown when
  pressure is on. Sensitivity scales how far pressure deviates the stroke width
  from uniform: 0% = uniform, 100% = the full raw pressure range. It is applied to
  the derived width profile at commit (`w' = clamp(1 + (w − 1) · sensitivity)`).

## The live trace reflects the brush

The in-progress "wet ink" trace draws at the chosen width and tip (Marker draws
visibly thick, Pen thin), scaled to the committed stroke's on-screen size, so the
brush reads WYSIWYG while drawing. The trace keeps the teal in-progress guide
colour — it is still the rough trace that settles into a smooth path on release.

## v1 limits

- **Draw-on still strips the pressure width profile.** A stroke converted to a
  draw-on reveal renders at uniform width — draw-on and the pressure taper are
  mutually exclusive in v1 (a renderer cannot dash a variable-width stroke). See
  `docs/product-knowledge/pencil-stroke-to-motion.md`.
- **No brush colour control yet** — the committed stroke keeps the default colour.
- **The live trace shows the base width, not the pressure taper** — the taper is
  derived and settles on release, not previewed mid-stroke.
