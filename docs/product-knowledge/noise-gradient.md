# Noise Gradient (Particle Dissolve)

Date: 2026-06-28.
Updated: 2026-07-12.
Status: beta.

## Summary

A selected object can dissolve into a "noise gradient" — a grainy field of
particles whose density follows the shape: dense in the solid core and thinning
into a fine spray at the edge. It reproduces the look behind After Effects'
Inner Shadow + Dissolve and Illustrator's gradient + Grain effect, but as a
vec-core texture recipe rendered at high fidelity by the GPU raster surface in
the editor, WebM capture, and WebGL player export. SVG remains an honest
portable fallback tier, not the fidelity source for the particle look.

The particle field is **static by default**. Procedural motion is explicit:
raising **Motion** adds the living boil modeled on moving references.
That motion runs as a SMIL animation embedded in the filter, on the browser's
own animation clock — so it animates in live preview even though per-node filter
defs are not rebuilt per playback tick, and it exports natively inside an
interactive SVG.

It is a render mode of the existing per-object Look (the vec-core TextureRecipe),
not a new fill type: turning it on flips the object's
`texture.material.mode` to `particle`. Because it rides the shared
TextureRecipe contract, editor rendering, export metadata, MCP/agent graph
patching, and fallback renderers all read the same canonical payload. The GPU
adapter lowers that payload into a particle dissolve shader; SVG/PDF/Worker
paths preserve or approximate the same recipe without inventing parallel state.

## Reference-validated granular cube recipe (2026-07-12)

The user accepted a capability probe based on a private reference showing a
smooth isometric cube beside the same cube rendered as fine monochrome grain.
The reference pixels remain private and are not stored, traced, or embedded in
the repository. The tracked probe is an original reconstruction that preserves
only the reference's abstract material relation:

```text
one implied light direction
-> per-face tonal gradient
-> matching per-face particle-density field
-> clipped fine grain
-> solid readable cube
```

### Capability decision

The target is achievable with existing Vecmo capabilities. No schema,
renderer, Look node, public control, or preset was required. The accepted
construction uses three editable closed paths per cube, one for each isometric
face. Each textured face combines:

- a native linear-gradient fill that establishes volume;
- a target-space Linear Noise Gradient whose direction follows the same light
  relation as that face's fill;
- **Style = Overlay**, **Blend = Hard Light**, and **Film grain = On**
  (`material.mode = "mixed"`);
- **Noise = 0.78** and mixed-layer **Grain = 0.42**;
- the normal fixed monochrome overlay tint and deterministic grain seed.

The Linear field endpoints extend beyond each face's `0..1` bounds. This keeps
some grain in the highlight instead of fading to perfectly clean white while
still making the dark side visibly denser. The three faces use different local
axes, but every axis inherits the same upper-left light world. That causal
alignment is load-bearing: a uniform screen grain or one shared rectangular
field does not reproduce the material.

The successful fit-scale and close-scale reads are preserved at:

- [`comparison.png`](../../artifacts/noise-gradient-cube-capability-probe/comparison.png)
  — smooth baseline on the left, current Noise Gradient result on the right;
- [`textured-close.png`](../../artifacts/noise-gradient-cube-capability-probe/textured-close.png)
  — equal-scale close view of the textured cube;
- [`smooth-close.png`](../../artifacts/noise-gradient-cube-capability-probe/smooth-close.png)
  — equal-scale close view of the smooth control.

The result passed the visible stop conditions used for this task: grain reads at
fit scale, remains fine rather than cloudy, stays inside each face silhouette,
becomes sparser toward highlights and denser toward dark regions, preserves the
cube's volume, and does not reintroduce the washed-opacity or colored-rim defect
fixed by sRGB grain rendering.

### Reproduction contract

Run the tracked generator from the repository root:

```sh
bun run gen:noise-gradient-cube-probe
```

It authors the scene through the real agent scene-command path, stabilizes all
generated node ids before scoped Look-graph conversion, renders through
`renderSceneSvgWithIssues`, and rewrites these deterministic artifacts:

- `comparison.svg` / `comparison.html`;
- smooth and textured close-view SVG/HTML files;
- the canonical `scene.json`;
- `render-report.json` with renderer fidelity issues and primitive-presence
  facts;
- `generated-hashes.json` for every generated text artifact.

To reproduce the checked browser pixels, serve the artifact directory and
capture with a real Chromium renderer (the `feTurbulence` + inlined `feImage`
field path is the surface under review):

```sh
python3 -m http.server 4177 --bind 127.0.0.1 \
  --directory artifacts/noise-gradient-cube-capability-probe

playwright-cli --session ngcube open http://127.0.0.1:4177/comparison.html
playwright-cli --session ngcube resize 1400 820
playwright-cli --session ngcube screenshot \
  --filename artifacts/noise-gradient-cube-capability-probe/comparison.png \
  --full-page --hires
```

Repeat at `430x590` for `smooth-close.html` and `textured-close.html`. The SVG,
scene, report, and their hash manifest are byte-deterministic. PNG bytes may
differ across Chromium builds or device-pixel configurations, so the committed
PNGs are the visual baselines and the fixed viewport is the comparison
contract; PNG byte equality is not claimed across browser versions.

### Boundaries and deferred escalation

- Each face remains a separate editable 2D object. Automatic 3D face lighting
  or cross-face field coupling is outside this proof and was not needed.
- The browser SVG path honestly reports the existing approximation/unsupported
  recipe warnings; PDF still cannot carry this filter exactly.
- The closest remaining aesthetic residual is grain character: the current
  neutral grain is slightly more uniform than an aggressively binary
  pepper/crystal texture. Escalate to renderer/UI support for the existing
  `texture.grain.character` vocabulary only if a future target specifically
  requires that sharper particle family. Do not add it merely to recreate this
  accepted cube.

## What Changed?

- The node Look section gained a **Noise Gradient** toggle (next to Analog Film).
  Its subtitle is **Object material** because it edits the selected node recipe,
  unlike Analog Film's selection overlay. Enabling it dissolves the selected
  object(s) into noise particles; disabling it restores the solid look.
- The ToolRail and `N` shortcut now expose a **Noise Gradient Tool**. Activating
  it on a selected object draws direct controls without mutating the document;
  the first field, Angle, Extent, Circular, Linear, or Mesh edit applies the
  object-material Noise Gradient as the same undo step. The canvas adds a diamond handle for
  **Extent** (the dissolve reach). **Circular** mode follows the object's contour
  and shows a dashed silhouette outline; **Linear** mode shows a field line with
  start/end handles, a center move handle, a direction arrow, and a range tick,
  so dragging either endpoint sets the dissolve direction, Option-dragging an
  endpoint resizes symmetrically around the center, dragging the line body or
  center moves the whole field, double-clicking the line fits it back to the
  object bounds, and the diamond adjusts reach; **Mesh** uses the saved scalar
  density surface. The icon-only bottom tool-options strip exposes **Circular /
  Linear / Mesh** field mode, Linear invert/fit actions, and graph access while
  the tool is active; the on-canvas mini HUD stays focused on exact **Angle**,
  **Extent**, or selected mesh-point **Density** edits.
  **Open Graph** converts the selected object's Noise Gradient into a scoped
  `look-graph-overlay` and opens that object graph in the Look Graph workspace.
  If another scoped Look Graph already targets the object, the button becomes
  **Open Existing Graph** and opens that owner instead of silently attempting a
  second conversion. Subsequent direct controls keep editing the scoped graph
  texture when it is a single-object Particle Dissolve graph; otherwise the
  direct controls stay disabled and the workspace is the editing surface. The
  public selected-object UI does **not** expose an **Add to Frame Graph**
  operation.
- The GPU raster surface gained a `particle-dissolve` pass. It samples the source
  alpha as a contour/signed-distance field, supports Linear and Field Mesh density
  fields from the same vec-core TextureRecipe, and sprays source colour outside
  the matte so object edges read as particles rather than a clipped SVG filter
  band. In Circular/Contour mode the high-fidelity GPU path builds the dissolve
  from the shape boundary itself; when an authored contour angle is present, that
  angle focuses the particle band onto one silhouette arc without turning the
  effect into a rectangular screen-space gradient. The SVG effect-filter
  primitive chain remains as a fallback/portable approximation.
- The TextureRecipe can now carry a material-local transparent alpha matte at
  `texture.material.alphaMatte`. The Inspector exposes it as **Matte** with
  **Object alpha**, **Linear alpha**, and **Radial alpha** modes plus a
  **Matte feather** control. This makes the transparent gradient authorable
  first, then lets Particle Dissolve consume that alpha as the density/coverage
  source instead of hiding the shape falloff inside noise shader tuning.
- With particles enabled, the GPU path treats that transparent matte as the
  particle density field using alpha-to-coverage: the solid side stays white,
  while the transparent falloff becomes thresholded white particles over the
  artboard colour instead of semi-transparent white fog.
- The grain **can animate**: a SMIL `<animate>` on the noise `baseFrequency`
  makes the field reorganize continuously (a living "boil") when **Motion** is
  above `0`. The amount is driven by `grain.temporalStability` (motion =
  `1 − temporalStability`); enabling the toggle now seeds a static default, and
  `temporalStability = 1` freezes it to a perfectly static grain with
  byte-identical output (no `<animate>` emitted).
- `grain.size` (the existing "Noise" Look slider) sets grain coarseness;
  `material.strength` the band reach; `material.particleContrast` the threshold
  hardness; `grain.densityCoupling` a density bias; `grain.seed` the noise field.
- **Range controls.** Four controls appear under the toggle when it is on:
  **Extent** (how far the dissolve reaches, `material.strength`), **Softness**
  (how feathered the particles are, `1 − material.particleContrast`), **Motion**
  (how much the grain boils, `1 − grain.temporalStability`; `0` = a still field),
  and **Field** — **Circular**, **Field Mesh**, or a Linear compass direction.
  Circular writes `material.fieldMode = "contour"` and follows the object alpha
  silhouette; Linear writes `material.fieldMode = "linear"` plus
  `material.linearField` target-space endpoints, while keeping
  `material.angle` as a derived legacy/simple-control value. The Inspector shows
  derived **Angle**, Linear invert/fit, and endpoint precision controls
  (**X1/Y1/X2/Y2**) when Linear is active. Field Mesh writes
  `material.fieldMode = "mesh"` plus
  `material.fieldMesh`, a scalar density grid normalized to the effect bounds,
  and rasterizes that density surface into the same `feImage` alpha path used by
  Linear fields. The Linear/Circular/Mesh math is now backed by the shared
  Effect Field foundation so future localized effects can reuse the same scalar
  field editing instead of rebuilding Noise Gradient-specific controls.
  **Custom angle** appears only as the current state for an off-preset value, not
  as a normal no-op choice. The renderer builds the Linear ramp as an inlined
  `data:image/svg+xml` gradient and Field Mesh as an inlined `data:image/png`
  alpha map, then feeds either to `feImage`, so it serializes identically on
  canvas and both exporters while avoiding external sub-resource fetches.
  The high-fidelity GPU path does not use that rectangle as the final field:
  Circular uses the alpha contour distance and optional authored angle to focus
  the band on one arc; Linear remains the directional gradient-tool field.
  As an alternative fallback path, the dissolve can still follow the object's own
  fill alpha gradient (the Illustrator "gradient + grain" workflow), so a
  gradient fill that fades to transparent steers the SVG approximation too.
- A **Blend** dropdown now sits above **Matte**, offering the 16 standard blend
  modes (Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge,
  Color Burn, Hard Light, Soft Light, Difference, Exclusion, Hue, Saturation,
  Color, Luminosity) plus **Dissolve**. Blend modes composite the noise/particle
  output over the object's own fill (a lighter, texture-over-fill look);
  **Dissolve** instead routes to the legacy particle-dissolve pipeline, where the
  fill itself erodes into stippled coverage. A fresh enable now defaults to
  **Overlay** so the reframed noise-over-fill look is the one-click default;
  documents that already had Particle Dissolve applied before this change keep
  reading as **Dissolve** so existing looks stay byte-identical. Blend edits the
  same object-material or scoped-graph texture as every other Noise Gradient
  control, in the same undo step.
- The default look is tuned **refined and static** (soft, fine, wide) so a fresh
  enable reads as an atmospheric particle field rather than a surprising
  animation or a harsh speckle.
- **One-click presets** — **Spray** (wide, soft, static edge), **Crisp** (tight,
  hard, still edge), and **Motion** (wide, soft, animated, directional) — set the
  whole config at once for a fast starting look.
- **Fixed: setting Type to Off on a scoped-object overlay no longer traps the
  tool.** The Noise Gradient Tool and Inspector resolved a scoped overlay's
  grain node with a finder that filters to `mode === "particle" | "mixed"`
  (`objectNoiseGradientParticleNode` — intentionally strict, since render paths
  must keep using it so an off overlay renders nothing). Authoring/reading paths
  now use a new mode-agnostic finder, `objectNoiseGradientGrainNode`, that
  matches the grain node regardless of material mode. Previously, switching
  Type to **Off** wrote `mode: "off"` into the grain node, which the strict
  finder could no longer see: the tool-options bar (including the Type control
  itself) vanished, and switching back to Particle/Mixed silently no-op'd
  because the write path could not find the node to update either. The two
  render callers (`svg.ts`, `CanvasShell.tsx`) are unchanged and still use the
  strict finder, so an Off overlay continues to render nothing.
- **The Noise Gradient Tool's bottom bar now leads with a single primary Style
  axis.** The old setup exposed two controls — a **Type** segmented
  (Off / Particle / Mixed) plus a **Blend** dropdown that mixed the 16
  compositing modes together with **Dissolve** — which was non-obvious, because
  **Dissolve is a render mode (the fill erodes into particles), not a
  compositing blend** like the other 16. Picking it from the Blend list
  silently swapped the whole control cluster, and pairing `Type = Mixed` with
  `Blend = Dissolve` rendered nothing extra (the dissolve path wins and drops
  the film-grain layer). The bar now leads with a **Style** segmented —
  **Off / Overlay / Dissolve** — and chunks its controls into three labelled
  groups, **Field / Style / Look**:
  - **Overlay** composites the noise over the object's own fill. Its Look
    controls are a **Blend** dropdown (the 16 real compositing modes only —
    Dissolve is no longer in this list), a **Tint** swatch
    (`material.overlayColor`), and a **Film grain** toggle that layers a grain
    pass over the overlay (this is the old Particle-vs-Mixed distinction:
    off = particle, on = mixed), with a **Grain** strength slider when it is on.
  - **Dissolve** erodes the fill into stippled particles. Its Look controls are
    **Coverage**, **Softness**, and the **Reveal paint** swatch — unchanged.
  - **Off** disables the look; the bar and its reserved Look region stay in
    place (Disabled-not-Hidden) so nothing jumps.
  This is a pure UI remap — Style writes the same `material.mode` /
  `material.blendMode` / `grain` fields the old Type/Blend controls did
  (Off → `mode: "off"`; Overlay → particle|mixed with a non-dissolve blend,
  default Hard Light; Dissolve → `blendMode: "dissolve"`, grain off), so
  existing documents render byte-identically. The Look region is a CSS
  grid-stack sized to its widest variant, so switching Style — or toggling Film
  grain — never re-wraps or shifts the bar. Every render/export path is
  unchanged.
- **The Inspector's Noise Gradient section now uses the same Style axis.** Its
  parallel implementation previously exposed a binary on/off toggle plus a Blend
  dropdown that hid **Dissolve** among the compositing modes; it now leads with
  the same **Style [Off | Overlay | Dissolve]** segmented control as the tool
  bar and Style-gates its Look — **Overlay** shows Blend (16 modes, Dissolve
  excluded), **Grain tint**, a **Film grain** toggle, and a **Grain** strength
  field; **Dissolve** shows **Coverage**, **Softness**, and **Reveal paint**. The
  Inspector's richer, panel-only controls are regrouped, not removed: **Field**
  (field mode, Angle, Linear X1–Y2 precision, Extent), **Matte** (plus its
  numerics), and the **Spray/Crisp** presets. Style writes the same
  `material.mode` / `material.blendMode` / `grain` fields as the tool bar (a
  shared mapping) for both owner kinds — the object-material recipe and the
  scoped frame-graph overlay — so it stays a pure UI remap with no schema or
  render change. Picking **Off** on a scoped overlay removes it (matching the
  old disable), and on an object-material recipe sets `mode: "off"`. **Reveal
  paint** now shows for any Dissolve, including a plain object-material one —
  setting it auto-promotes the object to its scoped form (mirroring the tool
  bar's `commitNoiseGradientToolRevealPaint`), so reveal is no longer
  scoped-only in the Inspector.

## What Can The User Do Now?

Select one or more objects, open the Inspector Appearance panel's Noise Gradient
section, and pick a **Style** — **Overlay** composites noise over the object's
own fill, **Dissolve** erodes the fill into grain particles (dense at the core,
thinning at the edge). Under **Overlay**, **Blend** chooses how the noise
composites (16 modes), **Grain tint** colors it, **Film grain** adds a grain
layer, and **Grain** sets its strength. Under **Dissolve**, **Coverage** and
**Softness** tune the erosion and **Reveal paint** sets the color it reveals
under the fill. **Field** chooses **Circular** contour, **Field Mesh**, or a
**Linear** direction, **Angle** sets any exact Linear direction, **Extent** the
reach, **Matte** whether the object alpha is unchanged, linearly faded, or
radially faded before particles are applied, and **Matte feather** the
transparent ramp width. The particle field stays static unless a **Motion**
preset is applied. Pick **Off** to remove the look. The whole change is a single
undo step.

For spatial editing, select an object and press **N** or choose **Noise Gradient**
from the ToolRail. The tool shows direct controls over the selected object
without creating an undo entry. If the object was not already using Noise
Gradient, the first field drag, diamond drag, Angle scrub, fit/invert action, or
Circular/Linear/Mesh edit enables it in that same undo step. Dragging the
diamond handle changes **Extent**.
**Circular** draws the dashed guide on the selected geometry silhouette (ellipse,
rounded rect, polygon, star, or path), not on a bounding rectangle; its diamond is
only an extent handle. Switch to **Linear** to show the dissolve field line;
dragging either endpoint sets the direction, the arrow marks the dissolve side,
the tick marks the current range boundary, holding Shift snaps endpoint drags to
45-degree increments, and holding Option while dragging an endpoint resizes the
field symmetrically around its center. Drag the field line or center handle to
move the whole dissolve range, use the Linear invert action to swap start/end, or
double-click the field line / use fit to reset it to the object's bounds. The
Inspector exposes the same Linear invert/fit recovery actions beside the
normalized endpoint fields. Switch to **Mesh** to edit the scalar density mesh
directly: drag points to reshape the field, click inside a face to add a row and
column, Alt-click or Delete a selected point to remove its interior row/column, and scrub
the selected point's **Density** in the on-canvas mini HUD. The bottom
tool-options strip switches **Circular / Linear / Mesh** mode with icons and
opens the object graph without covering the selected geometry; the mini HUD only
carries the numeric control relevant to the active direct-manipulation target.
The strip also leads with the **Style** axis (Off / Overlay / Dissolve) and, per
Style, its Look controls (Overlay: Blend / Tint / Film grain; Dissolve: Coverage /
Softness / Reveal paint), so the whole look is authorable from the bar.
Press the graph icon in the tool-options strip to move the selected object's
dissolve into its own scoped Look Graph and open the docked graph editor on that
object target. If the object is already owned by a different scoped Look Graph,
the graph icon opens that owner so authoring follows the same owner the renderer
uses. If that graph is multi-target or not a Particle Dissolve graph, the mini
HUD controls stay hidden.

## How Does The User Operate It?

1. Select an object (or several).
2. Press **N** or choose **Noise Gradient** from the ToolRail to edit it on
   canvas. Alternatively, open the Inspector Appearance panel's Noise Gradient
   section.
3. Pick a **Style** — **Overlay** or **Dissolve** — to turn it on (the segment
   highlights); pick **Off** to turn it off.
4. Drag the diamond handle to change **Extent**. Switch to **Linear** and drag a
   field-line endpoint to set the dissolve direction; drag the line body to move
   the range, Option-drag an endpoint to resize symmetrically, use invert/fit
   from the tool-options strip or Inspector, and hold Shift to snap endpoint
   drags to 45-degree directions.
5. Use the icon-only bottom tool-options strip for **Circular / Linear / Mesh**
   mode, and use the on-canvas mini HUD for exact **Angle**, **Extent**, or
   selected mesh-point **Density** scrubbing. Pick **Style**
   (Off / Overlay / Dissolve) on the same strip and tune its Look controls
   (Overlay: Blend / Tint / Film grain; Dissolve: Coverage / Softness / Reveal) there.
6. Use **Open Graph** when the object needs advanced node-level editing; the
   Look Graph workspace switches to **Object** scope for that selected object's
   scoped overlay. If the object is already targeted by another scoped graph, use
   **Open Existing Graph** to edit that current owner.
7. Tune **Matte** first when the desired shape is a transparent gradient:
   **Linear alpha** exposes a matte angle, and **Radial alpha** exposes center X,
   center Y, radius X/Y, and Matte feather. Then tune **Extent** (reach),
   **Softness** (particle feather), and **Motion** (procedural boil,
   `0` = still),
   pick a **Field** (Circular, Field Mesh, or a Linear compass direction), scrub
   **Angle** for any exact Linear degree, edit **X1/Y1/X2/Y2** for normalized
   Linear endpoint precision, use Inspector invert/fit when the field needs to
   flip or return to bounds, and adjust **Noise** (Texture group) for finer or
   coarser grain.
8. A fill gradient that fades to transparent also steers the dissolve — an
   alternative Field source for fill-driven looks.

## What Should A Reviewer Manually Verify?

- Toggling the button on a solid-filled object produces a static grainy edge
  that thins outward; toggling off restores the solid shape, and each is one
  undo step. Raising **Motion** above `0` makes the particle field boil.
- Pressing **N** on a selected object shows direct dissolve controls;
  **Circular** shows a dashed outline on the actual geometry silhouette,
  **Linear** shows the field line with start/end handles, direction arrow, and
  range tick, and **Mesh** shows a scalar density grid without a direction axis.
  Dragging a Linear endpoint changes Angle, Option-dragging a Linear endpoint
  resizes symmetrically around the center, dragging the field line or center
  handle moves the whole Linear field, invert swaps start/end, fit restores the
  current angle to full bounds, dragging the diamond changes **Extent**, and
  dragging Field Mesh points reshapes the density surface without opening graph
  controls.
- Pressing **N** on an object that does not yet use Noise Gradient does not create
  an undo entry by itself; the first field, Angle, Extent, Circular, Linear, or
  Mesh edit enables Noise Gradient in the same undo step as that edit.
- The icon-only bottom tool-options strip switches to Circular or Mesh without
  losing the last Linear angle and restores that direction through **Linear**.
  The on-canvas mini HUD edits Angle/Extent as one undoable gesture per scrub
  and edits the selected Field Mesh point's Density as one undoable scrub.
- **Open Graph** creates or reuses the selected object's scoped Noise Gradient
  graph, opens the Look Graph workspace in **Object** scope, and keeps Frame /
  Scene graph edits separate. If another scoped graph already owns the object,
  the graph icon opens that existing graph rather than doing nothing or
  creating a conflicting owner; direct controls remain active only for a
  single-object Particle Dissolve graph.
- When **Motion** is above `0`, the procedural boil keeps running while you
  scrub or select other objects (it does not hard-reset), because it lives on the
  browser animation clock, not on React re-renders.
- The same object in the editor, WebM export, and WebGL player uses the GPU
  particle pass. SVG export still shows the portable approximation and reports
  fidelity honestly; PDF keeps the existing flat/vector fallback plus recipe
  metadata.
- A matte-only QA scene should show the authored transparent gradient before
  particles are layered on: Linear alpha must fade along the selected axis, and
  Radial alpha must fade from the authored center/radius. The particle QA pass
  should then threshold that same matte so the background shows through as
  particles, not white fog.

## What Is Still Intentionally Limited?

- **The graph backing is advanced, not the default workflow.** Normal
  Circular/Linear/Mesh edits still use object-material tool options first.
  **Open Graph** is the explicit opt-in path for node-level authoring: it creates
  or reuses the
  selected object's scoped Object Noise Gradient overlay, or opens the existing
  scoped graph that already targets the object, and routes the Look Graph
  workspace to **Object** scope so object overlays do not masquerade as the broad
  frame graph.
- **Raster capture and code runtime use the GPU path when available.** WebM and
  the generated WebGL player render the SVG prefix without GPU-deferred particle
  nodes, then apply the same `particle-dissolve` shader from the canonical
  TextureRecipe. If WebGL is unavailable, WebM falls back to the SVG approximation
  rather than silently dropping the look. The sampled GPU params carry frame time
  so explicit Motion/boil is deterministic across capture and player seeks.
- **PDF export** still cannot carry SVG filters. Noise Gradient / Particle
  Dissolve now emits a dedicated `vec-core-recipe-pdf-local-raster-required`
  issue instead of a generic vec-core unsupported issue, so export reports can
  route these objects to the future local-raster PDF tier while the current basic
  vector PDF keeps its deterministic flat fallback and preserves the canonical
  `.recipe.json` sidecar.
- **Field authoring keeps canonical target-space data.** The serialized contract
  is `material.fieldMode = "contour" | "linear" | "mesh"`, optional Linear
  `material.linearField` endpoints/plateau plus derived legacy
  `material.angle`, optional Mesh `material.fieldMesh`, and optional transparent
  matte `material.alphaMatte`. The Noise Gradient Tool supports Linear endpoint
  move, symmetric endpoint resize, whole-field move, center-handle move, invert,
  fit-to-bounds, Linear extent/range edits, Inspector endpoint precision plus
  invert/fit edits, Field Mesh point move, face-click subdivision,
  selected-point Density edits, interior row/column removal, and
  return to Circular or Linear. Arbitrary point-cloud fields,
  explicit matte stop editing, and higher-density mesh textures remain later
  payload evolutions. The current GPU pass samples the mesh into an 8x8 uniform
  grid; denser authored meshes remain canonical in the TextureRecipe and can
  receive a higher-capacity texture-backed GPU path later.
- **Effect Field is now the reusable core.** `src/shared/effect-field/` owns the
  pure Linear field-line geometry, radial/circular geometry, scalar mesh
  normalization, point editing, projection, point hit-testing, and patch
  hit-testing. Noise
  Gradient adapts that generic `value` channel back to the persisted particle
  `density` field; future blur, reveal, distortion, glow, or grain-localization
  tools should map the same scalar field value to their own effect parameter
  instead of reimplementing Linear/Circular/Mesh.
- **Agent/MCP pathing is intentionally canonical.** `texture.material.fieldMode`
  is a registered recipe control, while `texture.material.linearField.*`,
  `texture.material.angle`, and `texture.material.fieldMesh` live in the same
  canonical `TextureRecipe`. Look Graph patch payloads carry that same recipe,
  so agents do not need a parallel Noise Gradient shape contract. Writing
  `texture.material.angle` through the canonical recipe path selects Linear and
  rotates the current Linear field; writing `texture.material.linearField.*`
  selects Linear, updates the derived angle and Extent, and persists the actual
  target-space endpoints. A recipe that explicitly keeps
  `fieldMode = "contour"` with an authored angle lets the GPU path focus the
  contour band onto one arc. Writing `texture.material.fieldMesh` selects Mesh
  during normalization when no explicit field mode is supplied.
- **`scene/author-object-noise-gradient` enables object Noise Gradient from
  scratch in one agent call.** Before this command, an agent could only tune an
  ALREADY-enabled Noise Gradient (`set-bindable-property` is numeric-only, and
  the enabling controls are enum/bool recipe controls) — it could not turn
  Noise Gradient on for a plain node. The command takes `nodeId` plus optional
  `fieldMode` (`contour`/`linear`/`mesh`, default `linear`), `linearField`
  (normalized target-space `x1`/`y1`/`x2`/`y2` plus optional `plateau`, only
  meaningful when `fieldMode` resolves to `linear`), `amount`, `grainStrength`,
  `materialStrength`, `particleContrast`, `blendMode` (a
  `TextureMaterialBlendMode`), `mode` (`"particle"`/`"mixed"`), and
  `overlayColor`. It sets the node's recipe to a particle Noise-Gradient
  material, then converts it to the scoped Look Graph overlay form the product
  uses — the same `createConvertNodeNoiseGradientToScopedLookGraphCommand`
  builder behind the Inspector's **Open Graph** action — so the compiled
  scoped overlay and the node-local recipe cleanup stay identical to the
  manual authoring path.
  **`blendMode` defaults to `"hard-light"` when omitted** (mirrors the
  Inspector toggle's and the Noise Gradient Tool's own fresh-enable default,
  `NOISE_GRADIENT_FRESH_ENABLE_BLEND_MODE`), so an agent that omits it gets the
  reframed noise-OVER-fill look — the same one-click default a human gets —
  not the legacy erosion look. Pass the explicit `"dissolve"` enum value to opt
  into that legacy path, where the fill itself erodes into stippled coverage.
  **`mode` selects the material type** — `"particle"` (default) or `"mixed"`,
  which layers a film-grain pass over the particle overlay (the same
  `material.mode` axis the Noise Gradient Tool's material-mode control writes,
  distinct from `blendMode`'s composite-mode axis). **`overlayColor`** (hex)
  tints the overlay noise, matching the tool's grain-color control
  (`material.overlayColor`). Honest param semantics, since several read as
  more general than they are: `amount` sets `texture.grain.densityCoupling`, a
  coverage-**threshold bias** (denser near `1`), not an intensity multiplier.
  `grainStrength` sets `texture.grain.strength` and is mode-conditional: for
  `mode: "particle"` (default) it only affects the plain (non-particle) grain
  surface and is **inert** for this command's particle recipe — use `amount`
  to shape density instead; for `mode: "mixed"` it sets the film-grain-layer
  strength, defaulting to `OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN` (`0.5`)
  when omitted. Note the interaction: `mode: "mixed"` combined with
  `blendMode: "dissolve"` routes to the dissolve erosion path and renders NO
  grain layer (dissolve wins), so mixed's grain is only visible under a
  non-dissolve blend mode. `materialStrength` (dissolve reach) and
  `particleContrast` (particle-edge softness) both only take effect under
  `blendMode: "dissolve"` — on every other (overlay) blend mode they are
  **inert**, since overlay compositing uses a fixed alpha rather than a
  band/threshold. The code-string SVG export path (`code.ts`) does not emit
  Noise Gradient at all; only the editor/GPU, WebM, WebGL player, and
  `renderSceneSvgWithIssues` SVG paths render it.
  **Re-authoring an already-converted node preserves `mode`/`overlayColor`/the
  mixed grain strength.** The shared builder behind both the fresh-enable and
  re-author paths (`objectNoiseGradientTextureFromRecipe`) now preserves an
  authored `"mixed"` material mode and its grain strength instead of forcing
  every recipe back to `"particle"` with `grain.strength = amount` — so a
  `mode: "mixed"` + `overlayColor` call, followed by a later re-author call
  that only tweaks `amount`, keeps rendering mixed grain in that tint rather
  than silently reverting to plain particle. This also fixed a latent
  Inspector-side gap: opening a Mixed-mode object's graph via **Open Graph**
  previously forced it back to `"particle"` on conversion; it now preserves
  Mixed.
- **`revealPaint` closes the "second plate node" gap for a dissolve.** Before
  this optional `author-object-noise-gradient` param, rendering a two-color
  interpenetrating grain (one color eroding away to reveal a second color/
  gradient underneath, rather than eroding to transparency) required stacking
  a second plate node beneath the dissolved object — the document structure
  faked a one-object appearance with two objects. `revealPaint` (solid,
  linear-gradient, or radial-gradient only; an image or mesh paint is
  rejected as a typed issue) is stored on the grain node's payload inside the
  object's scoped Look Graph, and the SVG renderer (both the editor canvas and
  `renderSceneSvgWithIssues` export) emits it as an UNFILTERED sibling element
  under the dissolve-filtered content — same geometry, revealPaint's color/
  gradient, no filter — so the dissolve mask's "holes" show the reveal color
  through instead of transparency. It is only visible under `blendMode:
  "dissolve"` (every other blend mode has no hole for it to show through) and
  is reset-style like the command's other params: an omitted `revealPaint` on
  a fresh-enable call leaves the graph without one. **Re-authoring an
  already-converted node** (calling `author-object-noise-gradient` again with
  the same node id) refreshes that node's existing scoped Look Graph particle
  texture and `revealPaint` in place from the new call's params, instead of
  leaving the graph untouched — this is what makes an iterate-and-re-author
  loop actually change the rendered result. Any other customization already
  present in that node's Look Graph (a node the user added or rewired in the
  Look workspace) is preserved. This differs from the Inspector's "Open Graph"
  action, which never touches an existing graph. Inspector texture-only edits
  (grain/material slider drags in `tool-controls.ts`/`noise-gradient-editing.ts`)
  preserve an already-authored `revealPaint` automatically — only agent
  re-authoring (or removing the look entirely) clears it. **The Inspector also
  exposes `revealPaint` directly** as a "Reveal paint" row in the object Noise
  Gradient section (`RevealPaintField` in `InspectorPanel.tsx`,
  `commitNoiseGradientFrameGraphRevealPaint`/
  `noiseGradientFrameGraphRevealPaintForSelection` in
  `noise-gradient-editing.ts`), so this is no longer an agent/MCP-only param:
  picking a color/gradient sets it, a "Clear" button removes it (`null`,
  distinct from an explicit solid `"none"` paint), and the row only appears
  once the object has a scoped overlay with `blendMode: "dissolve"` (matching
  `revealPaintForNode`'s own render gate — a node with no overlay, or a
  non-dissolve overlay, has nowhere to render a reveal, so the control stays
  hidden rather than editing a value that would never show). Gradient depth in
  the Inspector is intentionally pragmatic: kind is selectable and each stop's
  color is editable, but there is no on-canvas endpoint drag or ramp/stop
  add-remove-reverse (those are hard-bound to `node.style.fills`/`strokes` via
  the shared gradient-tool target-role plumbing, which `revealPaint` does not
  participate in) — setting an arbitrarily-shaped gradient reveal is still
  available through the agent/MCP command surface. **Known gaps:** the GPU
  raster particle-dissolve pass (`gpu-raster-adapter.ts`, active under
  `?gpuCanvas=1`) does not read `revealPaint` yet — it renders the same
  fill-erodes-to-transparency look it always has. **The code-string/code-export
  runtime player (`RUNTIME_PLAYER_SOURCE` in `code.ts`, the `.runtime.js` a
  developer-handoff export embeds) does not render the object Noise Gradient
  dissolve at all** — not just `revealPaint`: the scoped Look Graph overlay
  compiler that produces the dissolve filter itself
  (`look-graph-compile.ts`/`scoped-look-graph-overlay.ts`) has never been
  bundled into the runtime-sampler entries the player calls, so there is no
  dissolve substrate in that runtime for a `revealPaint` underlay to sit beside
  yet. This only affects that one export surface; the default editor canvas
  and the SVG/PDF-adjacent `renderSceneSvgWithIssues` export both render
  `revealPaint` correctly.
  The reveal underlay renders INSIDE the node's own wrapper group, as a
  sibling of the dissolve-filtered content — not as a separate element with
  its own opacity or blend mode. The node's own `opacity` and blend mode live
  ONLY on that shared wrapper, so the (underlay + filtered fill) pair
  composites and fades against the backdrop as ONE object: an
  `opacity: 0.5` node with a `revealPaint` underneath does not let the reveal
  color bleed through the non-eroded fill, and a non-`normal` blend mode
  applies exactly to the composited pair, not approximately to the fill
  alone.
- The current GPU particle pass covers the production field modes (Circular
  contour, explicit Linear field, Field Mesh). Richer particle characters such as pepper,
  crystal, or clump remain later shader/style expansions on the same
  TextureRecipe-to-GPU adapter.
- **The Noise Gradient Tool's bottom bar is a self-sufficient authoring surface
  for the whole Style axis**, so a human can pick Off / Overlay / Dissolve, tune
  each, and set the reveal paint without the Inspector or the agent. Selecting
  **Dissolve** on the **Style** segmented sets `texture.material.blendMode` to
  `"dissolve"`; selecting **Overlay** restores a real compositing blend (the
  fresh-enable default `"hard-light"`, or the last authored non-dissolve blend) —
  the same `blendMode` field the Inspector's Blend dropdown and
  `author-object-noise-gradient`'s `blendMode` param write. Under **Dissolve**,
  the Look group shows three controls: **Coverage**
  (`texture.grain.densityCoupling`, the same coverage/density bias
  `particleDissolvePrimitives` reads unconditionally as `bias`), **Softness**
  (`1 − texture.material.particleContrast`, the Inspector's Softness), and a
  **Reveal paint** swatch/popover mirroring the Inspector's `RevealPaintField`
  (kind row of Solid/Linear/Radial, `ColorPicker` per solid color or gradient
  stop, and a **Clear** button that removes the paint rather than setting an
  explicit-none solid). Picking or clearing a reveal paint auto-promotes a plain
  object-material Noise Gradient into its scoped Look Graph form first (the same
  conversion **Open Graph** performs), since `revealPaint` only exists in that
  scoped form — so the reveal paint is reachable straight from the tool without a
  manual **Open Graph** click first. Under **Overlay**, the Look group instead
  shows the **Blend** dropdown (the 16 real compositing modes, Dissolve
  excluded), a **Tint** swatch (`material.overlayColor`), and a **Film grain**
  toggle (`material.mode` particle⇄mixed) with a **Grain** strength slider when
  grain is on. This is a mirror, not a move: every Inspector Look-section control
  (Blend dropdown, Amount, Softness, Extent, Matte, Reveal paint, presets) is
  unchanged and still the deeper authoring surface; grainStrength for the
  dissolve pipeline (inert — the dissolve overlay path uses a fixed alpha, never
  `grain.strength`) and a second Extent slider (already an on-canvas diamond
  handle while the tool is active) were deliberately left out of the bar as
  redundant/dead controls.
