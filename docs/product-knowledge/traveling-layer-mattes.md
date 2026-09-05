# Traveling Layer Mattes

Date: 2026-07-13  
Status: **beta**

## What changed?

Native mask relations now state whether source coverage comes from alpha,
luminance, red, green, or blue and whether the intended source is sampled before
or after its effects.
The relation remains consumer-owned and reference-based, so one animated source
can drive multiple content nodes without copied geometry or keys.

Mask sources are resolved from the motion-sampled presentation scene. Ordinary
position keys, direct spatial paths, and motion controllers therefore move a
traveling matte before the shared SVG mask plan is built.

## How to use it

1. Select a source plus one or more content nodes in the same artboard and use
   **Use as mask**. Source and consumers may live in different layers or nested
   groups.
2. Select a masked content node. In Inspector Appearance choose **Alpha** or
   **Luminance**, **Red**, **Green**, or **Blue**, then edit invert, blur,
   opacity, and expand.
3. Animate the source directly or parent it to a motion controller. Every
   consumer keeps the same source identity.
4. Use **Release mask** to remove native relations without deleting the source.

## Fidelity and limits

- Alpha silhouette and solid-fill pre-effect luminance/RGB extraction are
  preserved by the shared editor/client/Worker/runtime SVG mask implementation.
- A visible pre-effect vector source subtree is flattened into the consumer's
  artboard space with exact transforms, inherited opacity, and regional paint;
  one source may feed multiple consumers without copied geometry.
- Post-effect sampling intent persists and is visible in Inspector, but currently
  returns a typed unrepresented fallback instead of approximating source pixels.
- Pixel-derived gradient/image/video/mesh channel extraction, cross-artboard
  sources, recursive mask chains, and PDF soft-matte parity remain deferred.
  Direct GPU admits only its compatible top-level hard-mask subset; other valid
  same-artboard relations use the typed SVG fallback.
