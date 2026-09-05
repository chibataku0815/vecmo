# Grainy Dissolve Cover

Date: 2026-07-05.
Status: reference-scene gallery entry (Design category).

## Summary

The **Grainy dissolve cover** is the fifth `/tutorials` reference scene: an
album-cover-style composition of four nodes on a 1080x1080 artboard — a
full-bleed background rect and a large sphere, each built as **two stacked
plates**. Bottom to top: `bgDeep` (a linear-gradient rect), `bgPink` (the same
rect, noise-gradient-dissolved), `sphereDeep` (a radial-gradient circle), and
`spherePink` (the same circle, noise-gradient-dissolved). It reproduces a real
"two-plate grainy dissolve" composition from an approved authoring session, not
an invented demo shape — the gradient stops, node bounds, and Noise Gradient
field endpoints are the exact values from that session.

Like Corner radius and Grainy gradient orb, this is a **Design** capability
tutorial with no motion — the artboard's motion document is empty.

What the scene demonstrates:

- **One shared palette, two gradient geometries.** `bgDeep`/`sphereDeep` both
  use the same violet (`#7A64EC`) to blue-violet (`#4E3BD8`) two-stop gradient;
  `bgPink`/`spherePink` both use the same bright-pink (`#F6B6DC`/`#F8C4E4`)
  family. The background pair renders that palette as a `linear-gradient`
  (corner to corner); the sphere pair renders the identical palette family as a
  `radial-gradient` (center + radius). The only difference between "background
  look" and "sphere look" is gradient geometry, not color.
- **Noise Gradient as a dissolve, not an overlay.** Both pink plates carry a
  Noise Gradient authored with the explicit `blendMode: "dissolve"`, which
  routes to the particle **dissolve** render path
  (`particleDissolvePrimitives`): the pink plate's own content erodes into
  discrete opaque/transparent grain specks, so the deep plate underneath shows
  through the holes. This is a two-plate construction, not a semi-transparent
  noise texture painted over one fill — the default fresh-enable blend mode
  (`"hard-light"`, a fill-based overlay) has a hard brightness ceiling that
  cannot reach this look, so this scene must author `"dissolve"` explicitly
  rather than relying on any default (see the Noise Gradient product doc's
  particle-dissolve vs. overlay path distinction).
- **Field direction as the second authoring axis.** `bgPink`'s Linear field
  runs on a diagonal axis (top-right corner near-clean, bottom-left densest);
  `spherePink`'s Linear field runs vertically (top mostly solid pink, bottom
  mostly dissolved to the deep plate). Same dissolve mechanism, different field
  geometry, on nodes that already share gradient family and Noise Gradient
  tuning (`particleContrast: 0.85`, `Noise` size `0.9`) — this is the second
  half of the "shared building blocks, geometry differs" lesson the scene
  teaches, alongside the fill-gradient-geometry contrast above.
- **Grain size must be set before conversion.** Each pink plate's `Noise`
  (`effect.node-look.noiseScale`) value is set via
  `scene/set-bindable-property` *before* the matching
  `scene/author-object-noise-gradient` command for that same node, in the same
  authoring batch. `scene/author-object-noise-gradient` converts the node's
  recipe into a scoped `look-graph-overlay` targeting that node by id
  (mirroring the Inspector's "Open Graph" action) and snapshot-copies
  `node.recipe.texture` at that conversion instant — there is no later edit
  path that would apply a grain-size change to an already-converted node, so
  the order is load-bearing, not stylistic.

## What Users Can Do Now

- Visit `/tutorials` and open the **Grainy dissolve cover** card.
- Select each of the four plates in the editor and compare their Appearance
  gradients (Linear vs. Radial, deep vs. pink family) in the Inspector.
- Select either pink plate and inspect its Noise Gradient block: the toggle's
  subtitle reads **Scoped effect · on** (this plate was converted to a scoped
  noise-gradient graph), and its **Field** control shows **Linear** with a
  **Linear field** row exposing invert/fit actions.
- Adjust a pink plate's **Extent** and **Softness** fields to see how far the
  dissolve reaches and how hard or soft its speck edges read.

## How To Operate It

1. Open `/tutorials` and click **Open in editor** on the Grainy dissolve cover
   card (or navigate directly to `/editor?ref=grainy-dissolve-cover`). It loads
   as an ephemeral session — your own saved document is untouched.
2. Open the Layers panel and select `bgDeep`, `bgPink`, `sphereDeep`, and
   `spherePink` in turn, reading each one's Appearance gradient in the
   Inspector.
3. With a pink plate selected, open its Noise Gradient block in the Look
   section to read the Field direction and the Extent/Softness values.
4. Reload `/editor` (no `?ref`) to return to your own document, unchanged.

## Manual Verification

1. Navigate to `/tutorials`. The Grainy dissolve cover card renders with a
   visible pink/violet album-cover-style poster (a bright field and sphere
   over a deep violet ground), not a blank preview.
2. Open the scene in the editor. Confirm the artboard is 1080x1080 with four
   nodes (`bgDeep`, `bgPink`, `sphereDeep`, `spherePink`) in that Layers-panel
   order, and that neither pink plate carries a visible 1px stroke ring.
3. Select `bgPink`: its Noise Gradient block reads **Scoped effect · on** with
   **Field** = **Linear**, and the field direction (visible via the on-canvas
   diagonal field line when the Noise Gradient Tool is active) runs from the
   top-right toward the bottom-left. Select `spherePink`: its field runs
   top-to-bottom instead.
4. Run `bun run check:reference-scenes`. It reports the scene passing (the
   look-effect approximation warnings for the Noise Gradient recipe on both
   pink plates are expected and non-fatal — the SVG poster approximates them
   through filter primitives; the editor renders the full-fidelity GPU raster
   path).
5. Run `bun run check:reference-scenes-fresh` after any generator change. It
   regenerates `grainy-dissolve-cover.fixture.ts` and fails if the committed
   fixture no longer matches its generator source.

## What Is Still Intentionally Limited

- **No motion.** This is a static Design tutorial; the artboard's motion
  document is empty, matching Corner radius and Grainy gradient orb.
- **The SVG gallery poster approximates the dissolve.** Both pink plates'
  Noise Gradient recipes rasterize through the SVG filter-primitive
  approximation tier (`feTurbulence` + `feImage`-based directional ramps); the
  editor's GPU raster surface renders the full-fidelity `particle-dissolve`
  pass.
- **The tutorial is explore-first, not build-from-scratch.** Like Grainy
  gradient orb, the reader inspects and tweaks an already-authored
  composition rather than reproducing every authoring command by hand; the
  full authoring sequence (including the grain-size-before-conversion
  ordering) lives in `scripts/generate-reference-scenes.ts`'s
  `buildGrainyDissolveCoverSource`, not in the tutorial steps.
- **Edits to the reference are not saved.** Like every reference scene, it
  opens as an ephemeral session; changes are not persisted back into the
  fixture.

## Related Docs

- [Reference scene tutorial gallery](./tutorial-gallery.md)
- [Grainy gradient orb](./grainy-gradient-orb.md)
- [Noise Gradient (Particle Dissolve)](./noise-gradient.md)
- [Look Graph Particle Dissolve](./look-graph-particle-dissolve.md)
