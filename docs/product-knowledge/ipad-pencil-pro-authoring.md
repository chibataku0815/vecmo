# iPad Pencil Pro authoring

Created: 2026-07-07.

## What changed?

The iPad authoring surface now treats Apple Pencil Pro and iPad touch gestures as
primary editor input, not a thin pointer fallback. The web editor still owns the
scene, command history, renderer, selection, and tools; Swift stays a host bridge
for wet ink, Pencil events, Files handoff, and haptic feedback.

## What can the user do now?

Users can select objects or artboards and delete them directly from the iPad
quickbar, open compact Style controls, and use Apple Pencil Pro squeeze to open a
six-slot radial QuickMenu. The radial menu supports flick selection and persisted
slot assignment by long-pressing a slot. Pencil double tap toggles Pencil/Select,
or opens Style when the system preference is palette-like.

The iPad quickbar now exposes the Shape tool as a first-class authoring entry
beside Pencil, Select, and Hand. Its icon reflects the current shape kind. The
QuickMenu includes direct Rectangle, Ellipse, Line, Polygon, and Star actions;
choosing one switches the draw store's shape kind and activates the Shape tool,
so the next Pencil drag creates that vector primitive.

Gradient and Noise Gradient are also first-class iPad authoring entries. They
appear in the quickbar and QuickMenu, and the default Pencil squeeze radial menu
prioritizes authoring tools so Gradient and Noise Gradient are reachable without
falling back to desktop chrome.

The Pencil squeeze radial QuickMenu uses large circular slots with a fixed icon
area and up to two balanced label lines, so tool names such as Noise Gradient are
readable without truncation on iPad.

Pencil hover shows a brush cursor with pressure, tilt/azimuth, and roll cues when
the host exposes that data through PointerEvent. Native iOS haptics confirm
palette open, selection, delete, undo, and redo actions.

iPad touch gestures now include pinch zoom/rotate, Quick Pinch fit/restore,
two-finger tap or hold undo, three-finger tap or hold redo, three-finger
swipe-down QuickMenu, and four-finger focus mode. A native Pencil stroke that
pauses at the end and is already line-like commits as a clean line path with
success feedback.

Viewport gestures on iPad are frame-coalesced: multi-touch pan/pinch/rotate and
Hand/Space panning collect pointermove deltas and write the viewport store from
`requestAnimationFrame`, with a final flush on gesture end. Pointermove handlers
must not write the viewport store directly on iPad because WKWebView can deliver
more touch moves than the display can paint, making camera motion feel uneven.
Pencil hover preview follows the same rule: it reads the cached viewport rect
instead of forcing layout and coalesces cursor state updates to animation frames.

During active iPad viewport gestures, the editor temporarily suppresses
nonessential workspace grid, guide, label, contextual-action, frame-preset,
path-blur hint, GPU grid-overlay, and feature-overlay chrome. The scene itself
and iPad quickbar/menu remain available; the suppression exists only to reduce
SVG/React overlay pressure while the camera is moving.

On the default SVG render path, active iPad camera gestures use an imperative
world-transform fast path: the visible scene group moves during zoom/pan/rotate,
and the canonical viewport store is committed once at the gesture boundary. This
keeps artboard React/SVG drawing from running on every camera frame. When the
experimental GPU canvas is enabled, camera gestures stay on the store-driven
path until GPU/SVG layer synchronization is designed for that mode.

Reviewers can open the editor with `?ipadPerf=1` to enable a debug-only iPad
performance HUD. It records a rolling in-memory window of frame deltas, pointer
events by lane, viewport writes, hover writes, render path, coarse document
complexity, and long-task totals, with a Copy JSON button. It does not persist
or record scene contents, layer names, user text, asset payloads, project IDs,
or account data.

## How does the user operate it?

Open `/editor` in the iPad shell or on an iPad-like coarse-pointer surface. Use
Pencil for drawing and selection; use fingers for viewport and global gestures.
Squeeze Pencil Pro to open the radial QuickMenu, drag/flick toward a slot to
execute it, or long-press a slot to assign a different action. Select an object
or artboard to make Delete appear in the quickbar.

Tap the quickbar Shape button to enter shape drawing with the current primitive.
Open the QuickMenu when you need a different primitive, then tap Rectangle,
Ellipse, Line, Polygon, or Star and drag on the artboard with Pencil.

Tap Gradient to edit gradient handles on the selected object or artboard. Tap
Noise Gradient with an eligible object selected to reveal the on-canvas field
controls for the object-material dissolve.

## What should a reviewer manually verify?

On a physical iPad Air M2 or better, verify Pencil stroke commit, pressure
variation, hover cursor, squeeze radial menu, flick selection, slot assignment
persistence after reload, double tap, selected-object delete, selected-artboard
delete refusal for the final artboard, pinch rotate, Quick Pinch fit/restore,
two/three-finger tap and hold undo/redo, three-finger swipe-down QuickMenu,
four-finger focus mode, native haptic responses, and a paused straight Pencil
stroke committing as a clean line. Also verify that Shape is visible in the
quickbar, that the QuickMenu exposes Rectangle/Ellipse/Line/Polygon/Star, and
that each primitive can be selected there and created by the next Pencil drag.
Verify that Gradient and Noise Gradient are visible in the quickbar, available
from QuickMenu/squeeze assignment, and activate the existing canvas tool flows.
During pan/pinch/rotate and Hand panning, verify that secondary overlays hide
only while the viewport gesture is active and return immediately afterward.
When using `?ipadPerf=1`, copy the HUD JSON after the worst gesture and record
which lane is worst: camera-touch, hand-pan, pencil-hover, pencil-stroke,
select-transform, idle/render, or geometry.

## What is still intentionally limited?

The iPad shell remains a thin `WKWebView` host. Swift does not parse or mutate
Vecmo scene data. Continuous native hover is only used when exposed by the host
PointerEvent path or Pencil interaction metadata; browser/iPadOS support can vary
by device and OS version. QuickShape recognition is intentionally limited to
clean-line commits for this slice; circles, rectangles, and arbitrary polygon
recognition are authored through the Shape tool rather than promoted from a
paused Pencil stroke.
