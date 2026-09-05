# Source-Driven Deep Glow Compositor

Date: 2026-07-12.
Status: beta; pixel-only user acceptance recorded for the controlled
equal-carrier optical QA scene. Broader surface verification remains deferred.

## Summary

Deep Glow now treats rendered bright material as radiance instead of treating a
target's opaque silhouette as a halo mask. The GPU kernel extracts
post-material luminance in linear light through a smooth threshold, reconstructs
a weighted multi-resolution field, applies exposure, composites with the
authored draw mode, and adds a small display dither to suppress visible bands.

For a selection-scoped Deep Glow that targets every visible top-level node, the
editor and raster capture keep two inputs separate:

- a transparent emission source containing the targeted post-material pixels
  plus their target-owned Surface, Diffusion, Edge, and Spectral consequences;
  and
- the completed artboard base, including the background and source-owned
  Source Optics Bloom, Ray, Atmosphere, and Lens.

The emission field is reconstructed coarse-to-fine through progressive tent
upsampling, then composited over the base inside the same GPU kernel used by
frame Deep Glow. This prevents small bright sources from exposing coarse
pyramid texels as rectangles or columns. No helper Layer, hidden Look, new node
kind, schema field, artwork preset, or scene-name branch is created.

## What Can The User Do Now?

- Add Deep Glow and get a visibly useful default rather than an almost-neutral
  insertion.
- Use Radius to move energy toward wider field bands, Exposure to control
  radiance gain, Threshold to choose the emitting material range, Fringe to add
  a source-local spectral split, and Blend Mode to select the optical composite.
- Apply one selection-scoped Deep Glow to a complete visible top-level target
  set while keeping its prior object material Looks, including Noise Gradient,
  and its target-owned Source Optics surface response in the emission source.
- See the same scoped source/base separation in the editor, deterministic PNG
  review capture, and WebM frame compositor.

## How To Use

Select the complete visible top-level object set, open its scoped Look Graph,
and use a direct `Source -> Deep Glow -> Output` chain. Start with Threshold high
enough that only genuine bright material contributes, then increase Exposure
and Radius until the core, medium bloom, and low-energy tail read as one field.
Use Fringe locally; it should not replace the luminance falloff.

Dark opaque regions are intentionally not guaranteed equal halo strength. Every
target is eligible to emit, but the visible result remains proportional to its
rendered bright pixels.

## What A Reviewer Should Verify

- Bright post-material regions seed the glow; alpha alone never creates a
  uniform contour rim.
- The core stays identifiable while medium bloom and the wide tail fall off
  continuously without steps, crosses, rectangles, or a hard outer boundary.
- Background and source-owned Bloom, Ray, Atmosphere, and Lens do not become
  emission merely because they are present in the finished frame; target-owned
  Surface, Diffusion, Edge, and Spectral consequences may emit.
- Noise Gradient and other earlier object material Looks remain visible inside
  the emitting circles.
- Material differences and the parent/child focal hierarchy survive an
  assertive exposure.
- Editor fit view and the native-size deterministic capture show the same
  ownership and falloff law.

Pixel quality remains a human gate. Renderer success can produce
`user_review_ready`; it cannot produce aesthetic acceptance.

## Accepted QA And Reproduction Contract

The controlled calibration `ACCEPT-GRAVITY-EQUAL-CARRIER-DEEP-GLOW-01` was
accepted by the user on 2026-07-12.

The accepted diagnostic used one unchanged parent and twelve equal-size child
carriers. Equal geometry removed size as an effect-coverage confound; it did
not equalize material response or halo energy. Every child remained eligible
to emit, material differences survived, and base-gradient eccentricity was
redirected toward the shared source where an opposing highlight had created a
two-source read.

This acceptance establishes that the current complete-visible-target path can
produce the intended result in the controlled QA scene. It does not establish
partial-selection ordering, all renderer surfaces, arbitrary graphs, or
automatic aesthetic quality.

Use the generic
[`equal-carrier-single-source-optical-qa.md`](../knowledge/section-07-quality-production/equal-carrier-single-source-optical-qa.md)
protocol to reproduce the comparison. The binding sequence is:

1. copy the last valid native backup to a new ignored revision;
2. normalize comparison-carrier geometry while preserving ids, world centres,
   gradient topology, material stops, and optical parameters;
3. audit base-material highlight direction against the declared source;
4. capture one native-size full frame and one unlabeled equal-scale all-target
   contact sheet;
5. let the producer self-reject or return `user_review_ready`; only the user may
   accept.

Accepted artifact identity is recorded in the knowledge protocol by SHA-256.
The pixels, native backup, and private paths remain ignored and untracked.

## What Is Still Intentionally Limited?

- The P1 selection-scoped GPU compositor accepts only one enabled Deep Glow in
  a direct graph whose target set exactly covers every visible top-level node.
  Partial/non-contiguous selections and mixed scoped graphs remain deferred.
- A frame GPU pipeline and this selection-scoped compositor are not chained in
  the same render invocation yet; the established frame pipeline keeps
  precedence.
- Static SVG, PDF, and Worker SVG cannot contain this GPU raster finish.
- The committed Motion / Code WebGL snapshot requires its normal regeneration
  before this kernel change can be claimed there; that build-like codegen was
  not authorized in this task.
- The source texture is still an 8-bit display-encoded SVG raster before the
  kernel linearizes it. This is source-driven linear-light processing, not a
  true scene-linear HDR authoring pipeline or a proprietary plug-in clone.
- Threshold Smooth, aspect/angle, tint, glow-only view, explicit unmult,
  independent RGB radii, lens dirt, and image-based glow remain separate P2
  product decisions.

Tests, typecheck, build, general browser smoke, and runtime regeneration were
not authorized. The accepted visual packet used an ignored native backup, a
3840x2160 deterministic full-frame capture, and an equal-scale all-carrier
contact sheet. Those artifacts establish the reviewed revision; they do not
expand the supported-surface claims above.

## Implementation Ownership

- Deep Glow kernel and source/base compositor:
  `src/shared/gpu-lens/surface.ts`
- Target-response-only Source Optics projection:
  `src/entities/scene/model/source-optics.ts`
- Scoped-plan eligibility and parameter lowering:
  `src/entities/scene/model/gpu-raster-adapter.ts`
- Transparent post-material target-set serialization:
  `src/features/export/model/svg.ts`
- Editor integration:
  `src/features/gpu-lens/canvas/overlay.tsx` and
  `src/widgets/canvas-shell/ui/CanvasShell.tsx`
- Deterministic still and WebM frame integration:
  `src/features/export/adapters/video.ts`
