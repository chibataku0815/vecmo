# Video Media Source

Created: 2026-07-01.
Status: beta.

## What changed?

The top-bar Import flow can now place browser-playable video files as scene media
nodes. A video is stored as a document asset, placed on the current artboard with
normal rectangular transform bounds, selected immediately, and shown in Layers as
Video.

## What can the user do now?

Users can import MP4, WebM, MOV, M4V, and `.ogv` (`video/ogg`) files, apply
frame/artboard Look Graph effects to the scene, and use the browser render,
WebM export, and Motion / Code WebGL player paths that are wired to sample the
video source per timeline frame before GPU Look effects are applied. A manual
browser pass on 2026-07-02 verified this end-to-end with a real MP4: the
current frame renders on the editor canvas with a GPU Look (Pixel Grid)
applied, the recorded WebM contains the moving source with the Look baked in
(frame-extracted and inspected), and the exported WebGL player renders moving
video frames with the Look, upright, with deterministic seeks.

## How does the user operate it?

Click Import in the top bar, choose a supported video file, then transform the
placed media node like any other rectangular object. Use the existing Look Graph
workspace to add effects, Export -> Video WebM to bake the resulting animated
look into a real browser-recorded video, or Export -> Motion / Code to produce a
transparent WebGL player runtime for host-page overlay/compositing.

## What should a reviewer manually verify?

Import a short MP4 or WebM, confirm the first/current frame appears on the
artboard with selection handles, confirm Layers labels it as Video with the
film-strip icon, add a GPU Look node such as Halftone or Pixel Grid, then export
Video WebM and confirm the exported file contains the moving source with the
effect baked in. Also export Motion / Code and confirm the WebGL player renders
moving video frames with the Look effect rather than the video-placeholder
rectangle.

## What is still intentionally limited?

Local video is embedded as a data URL for this first slice, so large files can
make scene JSON, undo history, and backups heavy. Static SVG/PDF and Worker SVG
exports do not embed playable video; when frame materialization is unavailable
they report a visible placeholder. Motion / Code WebGL player export materializes
referenced video assets in the browser, but external video references remain
host/CORS/decode sensitive and large embedded data URLs can make runtime payloads
heavy.
