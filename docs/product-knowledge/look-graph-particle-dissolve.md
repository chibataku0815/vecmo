# Look Graph Particle Dissolve

Status: `beta` (frame-scope Look Graph texture preset).

Updated: 2026-07-03.

## What changed?

The Look Graph workspace now exposes **Particle Dissolve** in **Texture & Source**
as a first-class palette item, and the compact no-selection Inspector Look Graph
editor exposes the same preset beside Film Grain. Internally it is still a
`grain` Look Graph node, but its texture recipe uses
`texture.material.mode = "particle"` so it lowers to the same particle dissolve
TextureRecipe as Noise Gradient instead of plain film grain. For high-fidelity
rendering, that recipe now lowers into the shared GPU raster surface's
`particle-dissolve` pass; SVG remains the portable approximation tier.

The existing `Grain` node label is now **Film Grain**. Particle Dissolve and Film
Grain share the same canonical texture payload, with a Mode control to switch
between them.

## User-facing behavior

- **Film Grain** adds clipped frame-level grain.
- **Particle Dissolve** dissolves frame pixels into grain particles; if the node
  receives an enabled alpha/luminance mask input, it affects the masked frame
  pixels.
- The selected node shows **Frame pixels** or **Masked frame pixels** so the
  user can tell whether the effect is broad frame texture or mask-gated texture.
  External, influence-assignment, or disabled mask nodes are not counted as
  masked because the SVG render path treats them as unmasked.
- Particle Dissolve exposes Amount, Size, Extent, Softness, Motion, **Field**,
  and Angle controls in both the docked Look Graph workspace and the compact
  Inspector graph editor. New Particle Dissolve nodes are static by default;
  raising Motion above `0` adds procedural particle boil without requiring a
  timeline keyframe. **Circular** writes
  `texture.material.fieldMode = "contour"` and the GPU renderer uses the source
  alpha boundary as the dissolve field; if the contour recipe also carries an
  authored angle, that angle focuses the particle band onto one silhouette arc
  instead of becoming a screen-space linear front. Linear presets write
  `texture.material.fieldMode = "linear"` plus `texture.material.linearField`
  endpoints and derived `texture.material.angle`;
  **Field Mesh** writes
  `texture.material.fieldMode = "mesh"` plus the scalar
  `texture.material.fieldMesh` density grid. The mesh editing math now uses the
  shared Effect Field foundation so future localized effects can reuse the same
  Linear/Circular/Mesh behavior.
- The same TextureRecipe may carry `texture.material.alphaMatte` as a
  transparent-gradient matte. Linear and radial mattes lower directly from the
  shared mask gradient stop contract. Object Noise Gradient exposes this as
  first-class **Matte** and **Matte feather** controls so the transparent
  gradient can be authored and inspected before Particle Dissolve thresholds it
  into particles.
- Canvas preview, WebM capture, and WebGL player export use the shared GPU
  lowering when the graph can be represented as a GPU raster pass/tree. SVG and
  Worker SVG export keep the fallback filter approximation and report deferred
  GPU nodes honestly. Raster capture omits GPU-deferred particle nodes from the
  SVG prefix before the shader is applied so Particle Dissolve is not double
  rendered.

## Scope rule

Particle Dissolve in a normal frame Look Graph is a frame-pixel effect, not
per-object Noise Gradient. Per-object Noise Gradient remains authored from the
selected object Look controls and follows object silhouettes directly.

A normal Look Graph mask wire is not enough for this bridge: masks gate the
finished effect over the original input, while per-object Noise Gradient needs
the selected silhouette to be the particle dissolve source alpha. The required
foundation is now a graph-native scoped graph overlay with replacement semantics:
stored `look-graph-overlay` scoped looks render target node runs through the graph
at their original layer/node draw order, the unfiltered originals are not left
underneath, and the same lowering is shared by canvas, client SVG export, worker
SVG render, and raster-safe export.
If a broad frame Look Graph is also present, the scoped replacement should behave
like object material first and then receive the broad frame graph with the rest of
the scene; it must not become a second top-level overlay that changes z-order.

Mask-wired Particle Dissolve stays on the SVG approximation path until the GPU
pass accepts an explicit mask texture. This avoids silently dropping the mask and
rendering a broader unmasked particle field.

Object Noise Gradient should not expose **Add to Frame Graph** as the normal
workflow. The public path is the Noise Gradient canvas tool: select an object,
activate the tool, preview direct controls without mutating the document, use
Circular for the contour reach outline, switch to Linear to drag the dissolve
axis for angle, switch to Field Mesh to drag density points / subdivide mesh
faces / scrub selected-point Density, and drag the diamond handle for
Extent/reach. The default tool edits object-material field mode, angle, Field
Mesh points/density, and Extent on first edit; **Open Graph** is the explicit
advanced path that creates or reuses the selected object's scoped
`look-graph-overlay` and routes the Look Graph workspace to that Object-scoped
target. Broad frame graphs and scoped object overlays stay separate owners.
