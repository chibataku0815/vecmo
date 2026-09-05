# Artboard Frame Fills

## What changed?

Artboards now follow Figma's Frame model for background paint:
`artboard.fills` is the visual source of truth and can carry solid, linear,
radial, image, or mesh paint stacks. The legacy `artboard.background` string
remains as the solid fallback/metadata color for old documents, thumbnails, and
adapters that only understand one opaque color.

## What can the user do now?

The Gradient tool can apply and edit a gradient directly on a selected or clicked
artboard background, without drawing a rectangle behind the scene.

## How does the user operate it?

Select the Gradient tool, then select an artboard or click empty space inside an
artboard. The tool seeds a primary Frame fill when the artboard has a solid or
missing fill, then exposes the same on-canvas handles and stops used for node
gradients. Artboards do not expose strokes, so the tool always edits Frame
background `fills` for artboard targets even if the last node role was `strokes`.

## What should a reviewer manually verify?

On the editor canvas, select a Frame and activate the Gradient tool; the Frame
background should become a linear gradient with handles. Drag endpoints and stops,
double-click a stop to edit color/opacity, delete a stop, export SVG, and confirm
the artboard background keeps the same gradient.

## What is still intentionally limited?

GPU canvas keeps only the exact single opaque solid background subset and falls
back to the SVG renderer for gradient/image/mesh artboard backgrounds. This
preserves visual correctness while the GPU background quad cannot yet represent a
full Frame paint stack.
