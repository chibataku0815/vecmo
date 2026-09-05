# Path Stroke Cap / Join Honesty

Date: 2026-07-06
Status: shipped rendering-fidelity fix. The live SVG canvas now renders the
authored/resolved stroke **cap** and **join** for `path`-kind geometry (and for
the baked rounded-corner `rect` / `polygon` / `star` branches), matching what
the SVG, PDF, and PNG exporters have always emitted. Existing round-looking
path/pencil artwork is preserved by explicit authoring defaults plus a
version-gated load-time migration, so nothing visually regresses.

## Summary

`renderVectorGeometry` in the canvas shell hardcoded `stroke-linecap="round"`
and `stroke-linejoin="round"` on the `path` branch, and `stroke-linejoin="round"`
on the three baked-path branches (a `rect` with per-corner or squircle corners,
and rounded-corner `polygon` / `star`). Those literals were spread **after**
`{...baseProps}`, so they always won over the honest cap/join that
`strokePresentation(resolveNodeStyle(...))` had already put on `baseProps`.

The result was a live editor-vs-export divergence:

- The bundled seed "orbit spline" (a `path` node with no explicit cap/join)
  rendered with round caps/joins on the canvas but butt caps / miter joins in
  every export, because the exporters honor the resolved default
  (`butt` / `miter`) while the canvas forced round.
- A stroke imported from an external SVG or PDF that explicitly set
  `stroke-linecap="butt"` (a common choice to avoid dash-cap overlap) was parsed
  into an explicit `strokeCap: "butt"` on the node, shown correctly in the
  Inspector, honored by export — and then silently overridden to round on the
  canvas only.

Only the canvas lied. The style model (`strokeCap?` / `strokeJoin?` optional on
`NodeStyle`, defaulting to `butt` / `miter` in `resolveNodeStyle`), the
Inspector cap/join segmented controls, and every exporter were already honest.

## The Fix

1. **The four hardcoded literals are removed.** `renderVectorGeometry` now
   sources cap/join solely from `baseProps` (ultimately `resolveNodeStyle` via
   `strokePresentation`) for every geometry kind. A contract comment on the
   function records that no case may reintroduce a cap/join literal that would
   win over the resolved value.
2. **The round look is now authored explicitly, not forced by the renderer.**
   The pen and pencil tool creation styles (`PEN_STYLE`, `PENCIL_STYLE`) and the
   seed spline now carry explicit `strokeCap: "round", strokeJoin: "round"`, so
   newly drawn freehand/pen strokes keep the round feel that the old renderer
   used to impose. (The line tool is unchanged — it was always honest and stays
   `butt`/`miter`.)
3. **Legacy persisted documents are migrated on load.**
   `normalizeSceneDocumentPathStrokeDefaults` backfills `round`/`round` onto any
   `path`-kind node whose `strokeCap`/`strokeJoin` is undefined, so a document
   saved before this change keeps the round look it was authored against.

## Why The Migration Is Version-Gated

The backfill runs **only for `v1` persistence envelopes**. The serialized
envelope version was bumped `1 → 2` (`SERIALIZED_SCENE_DOCUMENT_VERSION`), and
`deserializeSceneDocument` still accepts both but applies the backfill only when
the loaded envelope was `v1`.

Without this gate, an undefined cap/join on a path node created *after* the fix
— by a boolean operation, a shape→path conversion, an MCP `apply_scene_commands`
author, or an SVG import whose source genuinely omitted `stroke-linecap` —
would render honestly as `butt`/`miter` live, then silently mutate to `round`
the first time the document was saved and reloaded. Post-fix, undefined
legitimately means `butt`/`miter` and must survive a save/reload round trip;
only pre-fix (`v1`) documents get the round backfill.

The envelope version is the correct lever here (not the document-embedded
`SCENE_SCHEMA_VERSION`): what changed is the *persistence epoch* — "saved before
or after the canvas started honoring cap/join" — not the document shape.
`SCENE_SCHEMA_VERSION` is embedded per-document and strict-equality-checked by
`isSceneDocument` and by the export-job worker's document guard, so bumping it
would reject every existing document instead of migrating it.

## Relationship To The GPU Canvas

Honest rendered caps are the precondition for the experimental GPU canvas (E1)
to admit dashed `path`-kind strokes. Butt-cut fragment-discard dashing cannot
match a round-capped SVG dash, so dash admission had been narrowed to `rect`-kind
while the SVG `<path>` branch still force-rounded caps. With the caps now honest,
that blocker is lifted. See `gpu-canvas-experimental.md`.

## What Users Notice

- A `path` or pencil stroke whose cap/join is set to Butt/Square or
  Miter/Bevel in the Inspector now renders that on the canvas, matching export.
- Pen/pencil strokes drawn from now on still look round by default.
- Documents made before this change look the same as they did — the round they
  relied on is preserved by the load-time backfill.
- Export (SVG/PDF/PNG) is unchanged; the canvas moved to match it, not the
  other way around.

## What A Reviewer Should Verify

- Draw a pencil stroke: the rendered `<path>` carries `stroke-linecap="round"`
  and `stroke-linejoin="round"`, sourced from `PENCIL_STYLE` (not a renderer
  literal).
- Select a `path` node and set Cap to Butt in the Inspector: the canvas end cap
  becomes flat immediately, matching an SVG export of the same node.
- Load a `v1` document (or the legacy seed) whose path node has no explicit
  cap/join: it renders round (backfill applied), and after an edit + autosave the
  stored envelope reads `version: 2` with the path node's `strokeCap`/`strokeJoin`
  now persisted as `round`.
- Author a path node via MCP / boolean op with undefined cap/join in a `v2`
  document: it renders `butt`/`miter` and still reads `butt`/`miter` after
  save + reload (no round mutation).
- A non-`path` shape's stroke join does not carry a hardcoded round unless
  authored (e.g. a plain `rect` renders with no `stroke-linejoin` attribute).

## Intentional Limits

- A `v1` document that had an **explicit** non-round cap/join on a path node
  (which the old renderer still drew round, because the literal always won) now
  renders that real authored value. This is a deliberate, narrow visual change —
  it finally honors the user's stored choice — not a regression.
- `MaskSilhouette` (the internal mask/clip geometry renderer) still strokes its
  silhouette with the SVG default cap/join; it never force-rounded and is out of
  scope for visible-artwork honesty.
- The standalone exported-code runtime player emits cap/join through a separate
  serializer; parity there is tracked independently of this canvas fix.
