# Grainy Gradient Orb

Date: 2026-07-05.
Status: reference-scene gallery entry (Design category).

## Summary

The **Grainy gradient orb** is the fourth `/tutorials` reference scene: a single
720x720 rectangle carrying a 9-by-9 mesh gradient, a layer blur, and fine
node-scoped grain. It reproduces a real document authored live in the product
via the agent bridge, not an invented demo shape — the mesh anchor field, blur
radius, and grain amount are the exact values from that authoring session.

Unlike the other three reference scenes (Cycle, Time Delay, Corner radius),
which wear the editor's dark Analog Film frame look, this scene is
intentionally light and airy: a plain `#f8fafc` stage with no frame-level look,
so the orb itself reads as a glow rather than sitting on a charcoal
silhouette. It has no motion — it is a **Design** capability tutorial like
Corner radius, not a Motion one.

What the scene demonstrates:

- **Multi-pole mesh-gradient color field.** The fill is one `mesh-gradient`
  paint (9 rows x 9 cols = 81 points) whose colors are an inverse-distance
  blend of eight fixed violet/indigo/blue anchor points, so the orb reads as a
  continuous aurora field rather than a simple two-stop gradient.
- **Per-point opacity for a soft silhouette edge.** Each mesh point also
  carries its own `opacity`, falling off with distance from the orb's visual
  center — this is what gives the orb a soft radial edge instead of a hard
  rectangular boundary, entirely from mesh-point data (no separate mask).
- **Layer blur for the glow.** A `layer-blur` node effect (`radius: 10`) softens
  the whole rasterized mesh, turning the mesh's patch seams into a smooth glow.
- **Fine node-look grain.** The node carries a `node-look` recipe with a small
  grain `strength` and `size` (noise scale), authored through the same
  `scene/set-bindable-property` agent command the product's agent bridge uses,
  so the shipped fixture's `node.recipe.texture.grain` values are exactly what
  that authoring flow produces.

## What Users Can Do Now

- Visit `/tutorials` and open the **Grainy gradient orb** card (it is the
  featured, first entry in the gallery).
- Select the orb rectangle in the editor and drag its mesh points in the mesh
  editing tool to reshape the color field and the soft edge.
- Adjust the **Layer blur** radius in the Inspector's effects list to make the
  glow tighter or softer.
- Adjust **Grain** and **Noise scale** in the Inspector's look/appearance
  controls to change how visible the object-scoped grain is.

## How To Operate It

1. Open `/tutorials` and click **Open in editor** on the Grainy gradient orb
   card (or navigate directly to `/editor?ref=grainy-gradient-orb`). It loads
   as an ephemeral session — your own saved document is untouched.
2. Select the single rectangle node on the canvas.
3. Use the mesh editing tool to drag individual mesh points and see the color
   field and opacity falloff update live.
4. Open the Inspector's effects section to change the layer-blur radius.
5. Open the Inspector's look/appearance controls to change the grain amount
   and noise scale.
6. Reload `/editor` (no `?ref`) to return to your own document, unchanged.

## Manual Verification

1. Navigate to `/tutorials`. The Grainy gradient orb card renders first, as a
   featured card, with a visible blue/violet glowing orb poster on a light
   background (not a blank or charcoal preview).
2. Open the scene in the editor. Confirm the artboard is 720x720 with a light
   background and the orb renders as a soft-edged glowing field, not a hard
   rectangle.
3. Run `bun run check:reference-scenes`. It reports the scene passing (a
   look-effect approximation warning for the mesh/blur/grain is expected and
   non-fatal — the SVG poster approximates them; the editor renders them
   fully).
4. Run `bun run check:reference-scenes-fresh` after any generator change. It
   regenerates `grainy-gradient-orb.fixture.ts` and fails if the committed
   fixture no longer matches its generator source.

## What Is Still Intentionally Limited

- **No motion.** This is a static Design tutorial; the artboard's motion
  document is empty, matching Corner radius's pattern.
- **The SVG gallery poster approximates the look stack.** The mesh gradient
  rasterizes to a `<pattern><image>` and the layer blur and grain are close
  approximations in the static SVG preview; the editor's live canvas renders
  the full-fidelity result.
- **Mesh gradients are not yet animatable** through the motion system (see the
  mesh-gradient paint's own documentation) — the mesh points are a static
  authoring-time field for this tutorial.
- **Edits to the reference are not saved.** Like every reference scene, it
  opens as an ephemeral session; changes are not persisted back into the
  fixture.

## Related Docs

- [Reference scene tutorial gallery](./tutorial-gallery.md)
- [Corner radius & squircle](./corner-radius-expansion.md)
