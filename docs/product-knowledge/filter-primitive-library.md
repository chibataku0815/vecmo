# Filter Primitive Library (Wave 0 foundation)

Date: 2026-06-25.
Status: internal foundation — not yet reachable in the editor.

## Summary

Vecmo renders node and frame effects through one renderer-neutral SVG
filter-primitive model (`effect-filter.ts` → `FilterPrimitive`) that the editor
canvas, the client SVG exporter, and the worker SVG renderer all serialize the
same way. This change extends that primitive union with three more standard SVG
filter primitives so later effect work can express new looks without a new
rendering engine. It adds **no new UI and no new user-facing effect**; it is the
"Wave 0" enabling slice from `docs/after-effects-effects-research-vma.md`.

## What Changed?

- `FilterPrimitive` gains three renderer-neutral primitives, mirroring the
  [W3C Filter Effects](https://www.w3.org/TR/filter-effects-1/) definitions:
  - `component-transfer` — per-channel transfer functions (`identity`, `table`,
    `discrete`, `linear`, `gamma`), the basis for Levels / Curves / Gamma /
    Posterize / Threshold.
  - `displacement-map` — two-input map-driven displacement (`scale`, per-axis
    `xChannelSelector` / `yChannelSelector`), the basis for Displacement Map /
    Turbulent Displace.
  - `convolve-matrix` — a square convolution kernel (`order`, `kernelMatrix`,
    optional `divisor` / `bias` / `edgeMode` / `preserveAlpha`), the basis for
    Sharpen / Find Edges / Emboss.
  - `feImage` (`image`) — paints an image into the filter graph with
    `x` / `y` / `width` / `height` lengths. It points at generated `data:` URLs:
    the Warp node uses one for its radial displacement map, and Noise Gradient
    Linear particle ramps use one for the authored direction without fetching an
    external sub-resource.
- The existing `composite` primitive gains the `arithmetic` operator (with `k1`–
  `k4` coefficients), and — unlike the three above — it is **wired**: the Look
  graph compiler now gates a masked effect with an exact per-pixel lerp
  (`effect·m + input·(1-m)` via `feComposite operator="arithmetic"`) instead of an
  `feMerge` (`over`). This fixes a real fidelity defect where a feathered (partial-
  alpha) mask over-softened the boundary (α 0.5 → 0.75).
- Both serializers emit every primitive identically: the string serializer
  (`serializeEffectFilter`) and the canvas JSX adapter in `CanvasShell`, so the
  editor and both export targets stay byte-comparable as before.
- Optional fields are omitted from the serialized output so the renderer applies
  the W3C defaults (e.g. `convolve-matrix` `divisor` defaults to the kernel sum,
  `edgeMode` to `duplicate`, `preserveAlpha` to `false`; `composite` `k1`–`k4`
  to 0).

## What Can The User Do Now?

All three new primitives now have Look Graph node consumers: `component-transfer`
backs the Posterize (discrete) and Color Look (table) nodes, `displacement-map`
backs Turbulent Displace, and `convolve-matrix` backs the Find Edges node
(grayscale Laplacian edge detection) — closing the last unconsumed Wave 0
primitive. The later `feImage` primitive backs the Warp node (radial bulge/pinch),
painting a pure-JS-generated displacement map for `feDisplacementMap`, and the
Noise Gradient Linear field, painting an inlined data-URL ramp into the particle
dissolve chain, and Noise Gradient Field Mesh, painting an inlined alpha PNG
from the scalar density mesh. The `arithmetic` composite is also live: a **feathered
mask** over a Look graph effect node now blends exactly at the boundary instead
of over-softening, so any
already-authorable masked-effect look with a soft mask renders (and exports) more
faithfully — no new control to operate.

## Why It Matters

These three primitives are the gating dependency for the bulk of the planned
creative effect waves (color Curves/Levels, Turbulent Displace, Sharpen/Find
Edges). Landing them as pure, unit-tested `POJO → string` plumbing — with no new
system and no engine — keeps every later wave a Tier-1 Look Graph node that
previews in the existing SVG canvas and exports through the existing
honest-fidelity machinery.

## How Does The User Operate It?

Not operable yet — there is no control surface. When a later wave wires one of
these primitives into a Look Graph node or recipe, that wave adds its own
discovery (`list_bindable_properties` / look-node capabilities), typed-write,
animatable, and export-fidelity acceptance, and its own product-knowledge entry.

## What Should A Reviewer Verify?

- `bun run check` is green (every primitive type-checks through both the string
  serializer and the `CanvasShell` JSX adapter, both exhaustive switches; the
  `arithmetic` operator narrows correctly at all existing `composite` sites).
- `effect-filter.test.ts` proves each primitive serializes correctly: present
  channels only and in R-G-B-A order for `component-transfer`; both inputs and
  channel selectors for `displacement-map`; omitted-vs-explicit optionals for
  `convolve-matrix` (including `bias=0` and `preserveAlpha=false`); and `k1`–`k4`
  emitted for `arithmetic` but omitted for Porter-Duff `composite`.
- The masked-effect fidelity (visual per-pixel lerp on a feathered mask) is a
  pixel-level property and is **not** unit-asserted — it is a milestone browser
  smoke check, not a compiler-shape test.
- No change to `buildEffectFilter` output for existing effects (existing tests
  unchanged and passing).

## What Is Still Limited?

- The three new primitives are not reachable: no builder, Look Graph node, recipe
  field, or Inspector control produces them, so they do not render or export for
  users yet. (The `arithmetic` composite is the wired exception, above.)
- `convolve-matrix` models a **square** kernel only (`orderX = orderY`);
  non-square kernels are out of scope for this slice.
- Lighting primitives (`feDiffuseLighting` / `feSpecularLighting`) remain the
  named Wave 0 remainder, deliberately deferred (low creative value: Bevel only).
