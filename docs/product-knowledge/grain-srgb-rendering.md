# Node grain renders in sRGB (no more washed look)

Date: 2026-06-25.
Status: rendering-fidelity fix. Affects the per-node `Look` grain (public) and the
Look Graph **Film Grain** node (`internal` authoring surface). No workflow,
command, or model change — grain just looks correct now.

## 1. What changed?

The grain filter shared by per-node texture grain and the Look Graph Film Grain
node (`grainPrimitives`) was rendering in the SVG default color space,
`linearRGB`.
Its `overlay` blend of 0.5-centered noise is luminance-preserving only in `sRGB`;
in `linearRGB` it lightened and de-saturated the object body and left a colored
fringe on the antialiased rim. The result read as if an unwanted opacity had been
applied — the object looked washed out and semi-transparent once grain was on.

The four grain filter primitives (`feTurbulence`, `feColorMatrix`, `feComposite`,
`feBlend`) now carry `color-interpolation-filters="sRGB"`, scoped to grain only.
This matches the frame-tier Analog Film grain, which already renders in `sRGB`.
Shadow, glow, and blur are untouched and keep their `linearRGB` default. The
attribute is emitted identically by the canvas renderer and by both SVG exporters
(client and worker), so the editor and exports stay aligned.

There is no literal alpha loss in either the old or new path — the object stays
fully opaque. The defect was color degradation, not transparency; sRGB removes it.

## 2. What can the user do now?

- Enable grain (the per-node `Look` section's `Grain` slider, or a Look Graph
  Film Grain node) and see clean, fine film grain that keeps the object's original
  color and full opacity instead of a washed, faded, edge-fringed surface.
- Push grain strength high (e.g. ~0.9) and still read the object as solid: the
  texture sits on top of the fill rather than appearing to thin it out.

## 3. How does the user operate it?

Nothing new. The fix is automatic wherever grain already applied:

1. Select an object and raise the `Look` section's `Grain` slider, or
2. In the Look workspace, add a **Film Grain** node and raise its `Grain` amount.

The grain now renders as proper film grain in both places.

## 4. What should a reviewer manually verify?

1. Apply grain to a light-filled shape (e.g. cream/off-white) over a light
   background. The fill keeps its color; it does not lighten toward gray/white or
   look semi-transparent.
2. The antialiased rim stays clean — no cyan/magenta or dark colored ring around
   the edge.
3. Place the same shape over a saturated background: the background does not bleed
   through the body (grain is opacity-preserving — this was already true and must
   remain true).
4. Drop-shadow, glow, and blur on other nodes look unchanged (the sRGB scope is
   grain-only).
5. SVG export of a grained shape matches the editor canvas (both emit
   `color-interpolation-filters="sRGB"` on the grain primitives).

## 5. What is still intentionally limited?

- The scope is grain only. The rest of the per-node effect chain still renders in
  `linearRGB` by design; this fix does not change shadow/glow/blur appearance.
- Grain is still an SVG-approximation tier (fractal-noise `feTurbulence` overlay),
  not the planned WebGPU finish. It is luminance-weighted, so the same strength
  reads differently on light vs. dark fills.

## Related Docs

- [Frame Look Recall — Analog Film](./frame-look-recall.md)
- [Look Graph workspace](./look-graph-workspace.md)
