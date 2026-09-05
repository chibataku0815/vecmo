# Agent Dot-Matrix Authoring

Date: 2026-07-13.
Status: beta agent-authoring surface.

## Summary

Agents can create a bounded circle-cell composition with one
`scene/append-dot-matrix` command. The command converts a rectangular `#`/`.`
occupancy pattern into one editable native compound path of circular contours:

- `#` creates one circular contour;
- `.` preserves intentional negative space;
- one shared cell size, gap, and style keep the result in one motif family;
- the complete matrix can be selected, moved, saved, exported, and undone as
  an ordinary scene path.

This is a constrained construction surface, not an automatic beauty score. Its
purpose is to make agent-authored visual studies begin from exact relations
instead of unrelated primitive placement.

## Why It Exists

Low-level `scene/append-node` remains correct for geometry diagnostics and
bespoke paths, but a technical rectangle, ellipse, or mixed primitive batch is
not automatically a presentable visual candidate. Reusing those diagnostics as
artwork produces the known primitive-soup, loader, HUD, and generic motion-study
failure classes.

The dot-matrix command gives visible experimental work a smaller vocabulary:

```text
one occupancy grid
-> one spacing law
-> one shared style
-> one editable compound silhouette
```

The authored decision remains the pattern itself: silhouette, counterform,
density, hierarchy, crop, and negative space still require human judgement.

Use `gap: 0` when the intended read is a contiguous dot-matrix or
pixel-art-like cluster. A positive gap deliberately changes the read toward a
dotted pattern, LED matrix, or halftone; it must not be described as ordinary
pixel art merely because the cells share a grid. Strict pixel art uses adjacent
square pixels, while circular cells remain a dot-matrix interpretation whose
maximum continuity occurs at zero explicit gap.

## Agent Workflow

1. Decide whether the output is a technical diagnostic or a visual candidate.
2. For headless MCP or `vmactl`, do not treat the source-less legacy demo as a
   visual-candidate canvas. Pass an explicit clean scene source, or create and
   focus a clean artboard before authoring the candidate.
3. Keep diagnostics on a scratch artboard and use low-level primitives only for
   the property being checked.
4. For a visible circle-cell candidate, write a small rectangular occupancy
   pattern before mutation.
5. Use `scene/append-dot-matrix` with an explicit origin, positive cell size,
   non-negative gap, and one shared appearance.
6. Treat the committed path id as the authored object id for selection,
   transform, motion, grouping, and follow-up reads.
7. Judge the still before adding motion or finish. Reject a generic loader,
   badge, HUD, uniformly filled grid, or field of unrelated accents.

Example command:

```json
{
  "type": "scene/append-dot-matrix",
  "matrix": {
    "name": "Offset fold",
    "origin": { "x": 320, "y": 180 },
    "rows": [
      "##........",
      "####......",
      ".######...",
      "..###.###.",
      "...######.",
      "......####",
      "........##"
    ],
    "cellSize": 18,
    "gap": 6,
    "style": {
      "fill": "#191817",
      "stroke": "none",
      "strokeWidth": 0
    }
  }
}
```

The example's signature relation is directional: one mass expands diagonally,
turns around an off-axis notch, then compresses again. The pattern is not a
recommended preset; it demonstrates that occupied and empty cells must share a
single construction law.

## Validation And Ownership

- Patterns must be rectangular, non-empty, and contain only `#` and `.`.
- Occupied cells must touch all four pattern boundaries; internal `.` cells own
  negative space, while unused outer padding is rejected so selection bounds
  remain equal to the authored grid footprint.
- Rows and columns are limited to 64 each.
- Active cells are limited to 1,024.
- Origin coordinates must be finite.
- `cellSize` must be finite and greater than zero.
- `gap` must be finite and greater than or equal to zero.
- Invalid input returns typed `agent.dot-matrix-*` issues and does not mutate the
  document.
- Compilation builds one pre-minted compound path and appends it through the
  normal scene command bus, so a live apply remains one approved, undoable
  transaction.
- Circular cells are ordinary Bezier subpaths. No renderer, exporter,
  persistence, or motion-specific dot-matrix adapter exists.
- Motion / Code's ordinary path serializer concatenates the primary circle and
  every subpath and preserves the authored fill rule. Dot matrices therefore do
  not need a runtime-only representation or per-cell export branch.
- The path stores its source pattern and construction parameters under
  `node.data.dotMatrix` for inspection; those fields do not override path
  contours.

## Quality Contract

A dot matrix is a visual candidate only when:

- its focal silhouette reads at thumbnail scale;
- occupied and empty cells create an intentional counterform;
- primary and secondary masses are not equal-weight noise;
- the composition retains directional negative space;
- every accent belongs to the same generating relation;
- finish is not required to explain the main shape;
- it does not read as a loader, status badge, generic icon, HUD, or effect demo.

The command guarantees construction discipline only. It does not accept a
candidate aesthetically, generate a composition from adjectives, or replace the
pixel-first human review contract in `DESIGN.md`.

The same Scene-domain compiler may also be used by maintained reference-scene
generators when a reviewed sample deliberately adopts the circle-cell language.
`signal-handoff` uses it for a sparse constrained wake and two masked signal
fields while keeping its aperture morph and relation ids unchanged. This reuse
does not turn the example pattern into a preset or bypass visual review.

## Limits

- There is no dedicated editor UI for painting occupancy cells.
- All active cells share one geometry size and a deliberately narrow appearance:
  fill, stroke, stroke width, and opacity. Per-cell color, scale, timing, and
  random variation are intentionally absent.
- Cells are contours inside one path, not independent layer rows. Editing path
  geometry does not rewrite the stored source pattern; path geometry is the
  rendered source of truth after creation.
- Large or multicolor pixel illustrations should be deliberately decomposed into
  a few owned paths instead of bypassing the limits or emitting thousands of
  unrelated nodes.
