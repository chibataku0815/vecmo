# iPad Thin Shell Probe

Status: first probe scaffold, web native-stroke adapter, physical-device launch
path, Pencil-first iPad controls, wet-ink/path fidelity, and finger-driven
viewport navigation, capability probe reflection, and native Files/share backup
handoff, plus inline iPad backup action feedback, were added on 2026-07-06. The
current product focus is making Pencil authoring feel native while keeping the
existing web engine as the only editor.

Current productization loop SSOT:
`docs/ipad-e2-productization-loop-plan.md`.

Vecmo's iPad direction is a thin native shell around the existing editor engine,
not a separate native rewrite. The iPad app hosts `/editor` in `WKWebView` and
adds native-only Pencil affordances where they improve product quality:
low-latency wet ink, Pencil pressure/orientation metadata, Pencil Pro squeeze,
and real-device capability probes.

The current scaffold lives under `ios/VectorMotionAuthor.xcodeproj`. It captures
Pencil-only touches in `WetInkOverlayView` only while the web Pencil tool is
active, sends raw native sample messages to the web editor bridge, keeps a short
web-side stroke session for estimated-property updates, and commits completed
strokes through the existing TypeScript freehand command path.

Real-device use confirmed that the next meaningful iPad work is not more shell
surface area, but editor ergonomics. The web editor now shows compact
iPad-only Pencil-first canvas controls for Pencil, Select, Hand, Undo, Redo, and
Fit Artboard when the native bridge or iPad-like coarse pointer surface is
detected. Those controls are web-owned chrome over the existing editor, not
Swift UI that duplicates editor state.

The current Pencil-feel pass makes native wet ink visually match the committed
Vecmo path: UIKit force is mapped into the same visible pressure curve used by
the TypeScript freehand width profile, the live ink uses the committed black
stroke color/base width, and predicted samples extend from the last actual
sample so the live tail reads continuously before the stroke commits.

The iPad authoring surface also treats fingers as viewport input while Pencil is
the drawing input. Two-finger pan/pinch updates the existing web viewport state
from the gesture's starting camera, so the artboard tracks under the user's
fingers without adding native viewport state or scene mutation.

If a second finger starts viewport navigation while a web canvas gesture is
active, the web gesture is torn down through the normal handler deactivation and
scene commit path before the pinch begins. This keeps touch navigation from
leaving a stale transform/layout gesture under the iPad viewport state.

Post-stroke editing stays web-owned, but the selected path is easier to read on
iPad: selected-object and selected-artboard chrome uses screen-stable handle
sizing, and iPad authoring surfaces get slightly larger handles so a committed
Pencil path reads as immediately editable. Contextual selection actions also use
larger iPad touch targets, so common post-selection commands are reachable from
the canvas without opening desktop panels.

The native host reflects its WKWebView capability probe back to the web editor.
The iPad quickbar's status dot reports whether the native host is ready, whether
`navigator.gpu` and PointerEvent were observed inside `WKWebView`, and whether a
Pencil squeeze event has been seen.

The iPad Files/offline path uses the existing `.vecmo-backup.json` envelope.
The web editor serializes/restores scene, motion, and motion-grammar state; Swift
only presents a share sheet or document picker and moves UTF-8 JSON between the
system UI and the web editor.

The iPad quickbar reports native document handoff state inline for the final
device pass: opening Files, preparing Share, share sheet ready, restore success,
open cancellation, and native open/share failures. These are web-owned status
chips over the existing editor, not Swift-owned project state.

Opening a backup from the iPad quickbar is a full local project replacement.
Full `.vecmo-backup.json` files restore scene, motion, and motion-grammar state;
scene-only JSON is still accepted as a recovery input, but stale motion and
motion-grammar sidecars are cleared so the restored canvas cannot inherit timing
data from the previous project.

The iPad quickbar also exposes deterministic viewport recovery controls:
zoom out, current zoom with actual-size reset, zoom in, and fit artboard. The
Fit button becomes Fit selection when a node or artboard is selected. The
controls drive the same web viewport store as desktop shortcuts and gestures, so
there is still no native camera state.

The quickbar is now selection-aware: it stays bottom-docked by default, moves to
the top when the selected object would sit under the bottom command band, and
keeps transient native open/share notices separate from the command strip so the
primary Pencil/edit controls stay stable in Split View widths.

On iPad authoring surfaces, the editor now enters a canvas-first workspace mode.
The same web-side iPad surface detector used by `CanvasShell` marks the editor
grid, and `EditorPage` avoids mounting desktop-first chrome such as the top bar,
tool rail, tool options, side panels, timeline, Look workspace, parameter
capture, and floating inspector. The action surface remains mounted only as the
web-owned keyboard/command-palette dispatcher while its desktop path-operation
strip is hidden. The iPad quickbar remains the primary creation command surface,
and workspace fit calculations reserve clearance for the top- or bottom-docked
quickbar instead of treating it as decorative overlay.

The same iPad command strip also mirrors the editor's cloud/local continuity
state: Local, Saved, Unsaved, Saving, Stale, Failed, or Conflict. This does not
add an iOS document model; it reads the existing web cloud-project store and
keeps `.vecmo-backup.json` open/share as the local recovery path.

The iPad quickbar now exposes the motion Timeline and cloud recovery directly.
Timeline toggles the existing web timeline store, and cloud recovery opens
`/projects`, deep-linking to the active project history when a cloud project is
attached. These controls are intentionally web-owned because the TestFlight app
loads the production editor at `https://vecmo.dev/editor`.

The iPad selection Style panel now covers the core post-Pencil edit loop without
bringing back desktop panels: stroke color, fill, width, opacity, cap, join,
dash, and text size, leading, tracking, alignment, bold, italic, and underline.
All changes still write through the scene command bus, so undo/redo and the
single scene source of truth remain intact.

The native `WKWebView` uses WebKit's default persistent website data store for
the hosted production editor. Auth, cookies, local storage, and cloud-project
session pointers stay web-owned, but the shell is configured as a real app
session rather than an ephemeral probe surface.

Hardware-keyboard behavior remains web-routed. The canvas keydown path uses the
shared editor shortcut guard, so tool keys, zoom/playback keys, and command
actions do not fire while the user is typing in nested inspector fields,
textboxes, or contenteditable editor surfaces.

The hosted editor opts into `viewport-fit=cover`, and the native controller
prefers hidden status/home indicators with deferred bottom/side system gestures.
Safe-area avoidance remains web-owned through CSS env insets, so the Swift shell
does not need to lay out editor chrome.

The iPad shell now has release-facing native chrome basics: a Vecmo AppIcon
asset catalog generated from the product favicon, a minimal LaunchScreen, and
the confirmed Forestone Apple team (`C3G77H8NM6`) set in the Xcode project.
The AppIcon asset PNGs are opaque for App Store Connect validation. App Store
Connect app record `6788233298` exists, and TestFlight build `0.1 (1)` was
uploaded through fastlane on 2026-07-07; build `0.1 (2)` is the latest uploaded
TestFlight build. The remaining release assertion is the
TestFlight-installed physical iPad pass, not signing or upload mechanics.

Important boundary: Swift must not become a second scene model, motion model,
renderer, exporter, or serializer. The success condition for the iPad version is
that a Pencil stroke becomes normal Vecmo data, editable by the same editor,
motion, AI, and export surfaces as any web-authored stroke.
