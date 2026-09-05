# Scene Camera Rig Projection

Date: 2026-07-09.
Status: beta authoring spine.

## What Changed

Vecmo now has the first domain-level contract for authored scene cameras:
camera rigs live on the scene document, camera motion lives in side-car motion
tracks, artboards can point at an active scene camera, and vector nodes can opt
into camera space with a depth-plane contract.

This is intentionally separate from the editor viewport camera. The viewport
still controls how the author pans and zooms the workspace; a scene camera
controls how authored artwork is sampled for presentation, playback, export, and
future runtime paths.

## What Users Can Do Now

The first GUI authoring spine is reachable from the editor:

- Command palette camera actions can create a scene camera, create a camera with
  a target/null, create a target/null for an existing camera, bind the selected
  layer as a camera target, clear the target binding, set/clear the active
  artboard camera, select the active camera, and remove a selected camera.
- Layers shows a compact camera structure above normal layers: camera rigs,
  target rows, target/body null controllers, active-camera status, and projection
  kind.
- Inspector shows a Scene Camera section in page, single-selection, and
  multi-selection states. It is grouped by authoring role — Rig, Lens,
  Transform, Target, Key, and Layer depth — so camera identity, optics,
  placement, orientation, target binding, keying, and depth assignment do not
  read as one flat control dump. It can edit artboard-camera state, body X/Y/Z,
  target X/Y/Z, body
  Pitch/Yaw/Roll, projection kind, zoom/FOV, focus distance, aperture,
  target/null binding, selected-node depth presets, and exact Z.
- Camera selection now receives a dedicated Inspector context instead of
  falling through the page Inspector. Exact rig controls require an explicitly
  selected camera. The roster identifies the selected camera separately from
  the artboard fallback camera and the cut-resolved frame camera; Lens reports
  which camera owns frame preview and keeps detailed DOF diagnostics collapsed
  until requested.
- GUI-created cameras receive deterministic artboard-scoped names (`Scene
  Camera`, `Scene Camera 2`, and so on). Names can be edited inline in the
  Inspector roster through the camera command path, while rig ids remain stable.
- Target authoring uses one resolved read state for free, node-bound,
  controller-bound, stale, and conflicting bindings. Bound target coordinates
  are read-only, camera target keys are disabled, and Clear is available only
  while a binding exists. Free target points are world-space; controller-bound
  points are controller-local offsets. Creating a target null converts between
  those spaces without moving the effective target, and clearing a binding
  writes the current effective world point back before detaching.
- Inspector key buttons write real `MotionDocument.cameraTracks` for camera body,
  target, body rotation, and lens/focus/aperture channels at the current
  playhead frame.
- Timeline shows first-class camera lanes for the selected scene camera: Body
  X/Y/Z, Pitch/Yaw/Roll, free Target X/Y/Z, the projection-relevant Zoom or FOV
  lane, Focus, and Aperture. Inactive projection tracks remain stored.
- Timeline camera diamonds can be added, removed, dragged to retime, and edited
  in the easing picker without encoding the camera as a fake vector node.
- Timeline exposes a compact one-row camera-cut entry even with one selected
  camera and expands to the two-row camera-cut editor for existing cuts or a
  multi-camera scene. It supports assigning the selected scene
  camera at the playhead, splitting an existing cut when needed, deleting the
  current cut, dragging cut segments/edges to retime or trim them, renaming the
  current cut, toggling hard cut/crossfade, editing crossfade duration in
  frames, moving cuts across lanes, keyboard move/trim, and resolving same-lane
  overlaps.
- Select/direct-select canvas interaction can grab the selected camera body,
  free target point, body/target depth handles, body rotate X/Y/Z handles, focus
  handle, and aperture handle directly on canvas with Shift snap, Alt fine drag,
  Cmd/Ctrl camera-axis lock for body/target moves, and a live numeric HUD;
  hovering a handle shows the same role/value HUD, and compact
  P/Y/R/F/A/BZ/TZ markers avoid color-only identification. Bound target
  nodes/controllers remain selected through their own rows and handles.
  On-canvas handle labels render as small role chips, including explicit Body
  and Target labels. Coincident model anchors are separated by screen-space
  proxy handles with leader lines, and drag deltas continue from the authored
  model point without a pointer-down jump. Numeric values remain in the drag
  HUD instead of rendering nine permanent labels.
- Canvas overlay draws the active/selected camera body-target relation and depth
  badges only for selected depth nodes, reducing artwork occlusion.
- Export bundle manifest now reports scene-camera usage, active camera rigs,
  depth-node count, camera-track count, camera-cut count, per-artboard active
  camera source (`cut`, `artboard`, or `none`), active crossfade transition
  metadata (`fromCameraRigId`, `toCameraRigId`, progress, duration),
  per-artboard
  `svg-affine`/`invalid`/future `requires-3d` fidelity, depth-of-field blur
  approximation status, and projection issues. TopBar export report surfaces
  those issues.
- Generated SVG and WebGL players expose the exact render-effective camera
  beside a discriminated frame scope. For scene sequences, host time remains
  global while camera/motion sampling is addressed by the active artboard and
  local frame. An artboard-scoped forced camera becomes dormant on incompatible
  cuts rather than invalidating the document-level player.

A document authored by GUI, internal tooling, agent/MCP code, or the
camera-authoring command seam can carry:

- `SceneDocument.sceneCameras`
- `Artboard.activeSceneCameraId`
- `VectorNode.depthPlane`
- `VectorNode.motionParent` / `VectorNode.motionController`
- `MotionDocument.cameraTracks`
- `MotionDocument.cameraCuts`

The presentation sampler projects screen-facing depth planes through the active
camera before canvas playback consumes the sampled scene. `cameraCuts` override
the artboard active camera only for covered frames; uncovered frames still use
the artboard's active camera. Crossfade cuts are rendered as a presentation-level
blend between the previous camera's projected frame and the current camera's
projected frame, with duplicated synthetic node/component/effect ids so the
source document is not rewritten or ID-aliased. Documents without an active
scene camera keep the existing 2D path.

## Authoring Surface

The first C6 authoring seam now exists for UI and agent callers:

- scene camera rig create/update/remove commands;
- active-camera commands for artboards;
- depth-plane assignment/removal commands for nodes;
- motion/null controller creation and camera target/body binding commands;
- camera side-car track keyframe upsert/removal/retime/easing commands;
- camera-cut upsert/retime/remove commands for hard cut/crossfade sequencing;
- a read-only authoring state for active camera, scoped cameras, controllers,
  and depth-plane nodes;
- a separate camera-authoring selection channel for camera rigs, camera
  body/target handles, and motion/null controllers;
- MCP `observe_document` compact summaries for scene-camera rigs, active camera
  ids, depth-node counts, camera-track counts, camera-cut counts, camera-cut
  segments, and document asset placement ids/counts, preview roles, capability
  flags, and fidelity issue codes so agents can plan camera/imported-asset work
  without scraping raw scene JSON first;
- live MCP `observe_selection` exposure for the optional camera-authoring
  selection, focused artboard, and current playhead frame;
- MCP typed scene commands for scene-camera rig creation/update/removal, active
  camera assignment, node depth planes, motion/null controllers, motion-parent
  bindings, and camera body/target bindings;
- MCP typed motion commands for camera side-car keyframes, vector body/target
  pose keys, vector body-rotation keys, camera key removal, retiming, easing,
  camera-cut name/lane/transition/duration metadata, camera-cut
  upsert/retime/remove, and camera-track/cut cleanup;
- GUI command-palette, Inspector, Layers, Timeline, and canvas-overlay
  composition on top of the same seam;
- canvas body/free-target/depth/orientation/focus/aperture handle hit testing
  and drag planning that writes scene-camera command plans, with handles laid
  out on the camera body-to-target axis, current pitch/yaw/roll/Z/focus/aperture
  labels, tilt rings so pitch/yaw/roll are visually separable, Shift snapping,
  Alt fine drag, Cmd/Ctrl axis lock for body/target moves, and a live HUD for
  exact drag values;
- Inspector DOF readouts for the active camera at the playhead: blurred node
  count, max blur, normalized CoC, near/far split, renderer tier, and whether
  optical bokeh preview is required;
- export manifest detection for the admitted 2.5D subset, including a
  depth-of-field fidelity tier, normalized circle-of-confusion summary, and
  depth-driven layer-blur DOF approximation when aperture actually affects
  projected nodes; TopBar report surfacing for camera projection issues.

The important product constraint is that future Timeline lanes, MCP workflows,
runtime players, and import surfaces should keep routing through this seam
instead of mutating `sceneCameras`, `depthPlane`, `motionController`, or
`cameraTracks` directly, and should not encode camera rigs as fake vector node
ids.

## How To Operate It

1. Open the command palette and run `Create scene camera` or `Create scene camera
   with target null`.
2. Use the Layers camera rows to select the camera, target point, or null
   controller.
3. Use Inspector's Scene Camera section to edit body/target/projection values
   and active-camera state.
4. Select ordinary layers and use Inspector depth presets: Off / Back / Mid /
   Front, or enter an exact Z value.
5. Move the playhead, then use Body / Target / Orient / Lens key buttons or the
   Timeline camera lanes to author camera tracks.
6. Select the camera and use the Timeline cut lane to assign the selected camera
   at the playhead, split an existing cut, rename the current cut, toggle
   hard/crossfade, edit crossfade duration in frames, move it to another lane,
   resolve overlaps, remove the current cut, drag a cut segment to retime it, or
   drag either segment edge to trim the cut. With timeline focus, use
   `Alt+Left/Right` to move the current cut, `[` / `]` to trim its start/end
   inward, `Alt+[` / `Alt+]` to extend outward, and Shift with those trim/move
   keys for one-second steps.
7. Select the camera body, free target point, depth, rotate, focus, or aperture
   canvas handle for direct placement/lens edits. Rotate/depth/focus handles
   follow the camera body-to-target axis rather than fixed screen up/down; hold
   Shift to snap, Alt to make fine adjustments, or Cmd/Ctrl while dragging the
   body/target handle to lock movement to the camera target/right axis.
8. Scrub/play; presentation sampling projects the cut-selected or active-camera
   scene while crossfade cuts blend the previous/current projected camera frames
   and the source document keeps authored camera/depth data.
9. Export; the bundle manifest records whether the camera projection is within
   the admitted `svg-affine` subset, whether DOF was resolved with a normalized
   circle-of-confusion profile and approximated with depth-driven layer blur,
   and whether the current frame is inside an active crossfade transition.
   TopBar report surfaces camera projection issues when they exist.

## Manual Verification

1. Load or construct a scene with one active scene camera and several depth-plane
   nodes.
2. Select the active camera, open Timeline, and scrub frames where `cameraTracks`
   animate body/target/zoom.
3. Confirm camera lanes can add, delete, retime, and ease camera keys without a
   fake node row.
4. Confirm the camera-cut lane can assign, split, rename, delete, retime, trim,
   toggle crossfade, edit crossfade duration, keyboard move/trim, move to
   another lane, and resolve overlaps between scoped scene cameras.
5. Confirm a free camera target point, camera body, depth, rotate, focus, and
   aperture handles can be dragged from canvas select/direct-select mode.
6. Confirm aperture greater than zero creates depth-driven layer blur only for
   nodes outside the focus distance threshold.
7. Confirm the presentation scene changes through the camera projection while
   crossfade cuts blend previous/current projected camera frames and the source
   scene document remains authored data, not baked per-node motion.
8. Confirm scenes without `activeSceneCameraId` still sample identically to the
   existing 2D path.
9. Confirm the export manifest includes `sceneCamera` and the TopBar report
   surfaces camera projection issues when a camera target/controller is stale.

## What Is Still Intentionally Limited

- Timeline camera lanes cover the selected camera's body, body rotation, target,
  zoom, FOV, focus distance, and aperture scalar channels. Compact multi-camera
  cuts are editable in the cut lane, including segment move, split, delete,
  edge-trim, rename, hard/crossfade toggle, lane move, collision warning, and
  one-click same-lane collision resolution. Keyboard editing covers current-cut
  move and start/end trim, including larger Shift steps and Alt extension.
  Crossfade duration is editable in frames and rendered as a
  presentation-level projected-frame blend, not camera-matrix interpolation.
  Generated thumbnails, drag-to-reorder lanes, multiple transition types,
  transition curves/easing, and NLE-style cut management remain later work.
- `rotateX` / `rotateY` are camera body-orientation controls for the active
  2.5D projection basis. They are not full perspective-correct tilted card or
  mesh manipulation.
- Depth-of-field authoring stores `focusDistance` and `aperture`, resolves a
  thin-lens-style normalized circle-of-confusion profile using subject distance
  and effective focal length, and preview/export apply a depth-driven
  `layer-blur` approximation when projected nodes fall outside focus. The
  manifest reports near/far blur counts, max CoC, max blur node/depth, renderer
  tier, and when optical bokeh preview is still required. Exact lens-shape
  simulation and WebGL bokeh kernels remain later work.
- The first projection path is a screen-facing 2.5D SVG-affine subset.
  Perspective-correct card warps, true camera-space gizmo math, modifier-rich
  transform handles beyond snap/fine/axis/HUD, perspective hit testing, and
  NLE-grade camera-cut management remain later H3 work.
- Full 3D modeling is not a Vecmo authoring goal for this phase. Externally
  generated 3D/code assets can be represented through MCP/agent/vmactl-assisted
  placement, with placed node ids surfaced for follow-up depth/camera edits.
  Placed glTF/GLB assets can render through the canvas Three.js preview overlay,
  and HTML/code-module assets can render only inside the sandboxed iframe preview
  path. Preview-less assets still render as safe placeholders; public Import UI,
  host-integrated code runtimes, and production-grade true-3D runtime/export
  fidelity remain later. Vecmo owns durable import/loading, placement, preview,
  export, and fidelity handling for them.
- Motion/Code runtime and the generated WebGL player bundle both route the
  admitted 2.5D subset through the shared presentation sampler. True-3D fidelity
  remains later work. Both renderers use the same request controller, snapshot,
  hook ordering, camera override, and global/local sequence frame contract.
