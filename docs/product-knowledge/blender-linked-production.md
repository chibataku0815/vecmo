# Blender-linked Production

Date: 2026-08-05.
Status: internal (not user-facing yet).

## Summary

Vecmo can link a local `.blend` file as a stable, revision-safe 3D production
source instead of a one-time GLB import. A local Bun companion inspects the
source read-only, rebuilds an interactive GLB placement on demand, and Vecmo
holds one global frame clock that Blender-derived poses, published numeric
controls, and expression fan-out all follow. This is internal, flag-level
scaffolding: there is no public Import menu claim, no marketing surface, and no
promise that this replaces any existing workflow yet.

## What exists today

- **Linked source, not a one-time import.** `Assets` can link a `.blend` file
  and the Inspector shows source/status/rebuild/relink for that link. The
  durable link contract (`ExternalProductionLink`, `PublishedControl`) is
  strictly parsed — only an allowlisted binding shape is accepted, never an
  arbitrary Python expression or a data path — and lives on the Scene document
  as additive metadata, so it participates in Undo/Redo and save/reopen like
  any other authored edit.
- **Companion rebuild.** A local Bun companion process inspects the `.blend`
  read-only over a loopback WebSocket, derives a canonical build key from ten
  hashed contract fields, and rebuilds a GLB artifact only when that key
  changes. The companion never saves the user's `.blend` file in a normal
  build and never writes a `.blend1` sibling. The local binding (which local
  machine path a `linkId` resolves to) lives only in this browser's storage,
  scoped to one Working Copy — it never appears in a portable backup or a
  cloud-saved revision, so opening the same project elsewhere correctly shows
  "Relink required" instead of resurrecting a path that cannot exist there.
- **One frame clock.** Vecmo owns the only clock. A linked placement's
  imported animation is posed by explicit seek against the Vecmo document
  frame (converted into the source `.blend`'s own frame space and fps) rather
  than by giving Babylon an autonomous animation clock. Repeated seeks to the
  same frame, and a play/pause/scrub round trip, land on an identical pose.
- **Published numeric controls.** A `.blend` file can publish a numeric
  control (for example an "impact" property). Vecmo authors a keyframe track
  for that control on its own Timeline, and an expression reference —
  `control("id")` — lets a camera focus/FOV channel or a text reveal's offset
  read that same control's current value. One edit to the published control's
  keyframe drives every dependent channel from one Undo step; the companion
  applies the resolved value to the `.blend` as a temporary override when it
  rebuilds, never as a saved edit to the source file.
- **Minimal audio lane.** An audio asset can be placed with a frame-anchored
  offset, previewed in the browser, and mixed into exported WebM. Preview and
  export share the same frame-derived timing math, so they cannot drift onto
  two different offset conventions.

## What a reviewer can manually verify

- Link a `.blend`, edit a mesh in Blender, save, and confirm Vecmo detects
  drift and rebuilds without losing the placement, its node id, or its scene
  position.
- Edit a published control's keyframe once and confirm a camera-focus channel
  and a text-reveal offset both move together, then Undo once and confirm
  every dependent effect (and the rebuilt artifact) reverts together.
- Confirm the `.blend` file's own modification time does not change when
  Vecmo edits and rebuilds — only the companion's temporary override changes,
  never the saved source.
- Open the same project from a second Working Copy (or a different machine)
  and confirm it asks to relink rather than silently reusing a stale local
  path.

## What is still intentionally limited

- No public Import menu action, marketing copy, or workflow claim exists yet;
  this stays internal/flag-level until a dedicated capability id and
  Inspector UI ship.
- Neither the published-control keyframe track nor the camera/text expression
  fields have an Inspector authoring control yet — they are editable only from
  the Timeline/Graph keyframe surface.
- Camera body/target channels (position, orientation) are not yet carried
  into the interactive 3D camera; only focus distance, field of view, zoom,
  and aperture are.
- The standalone exported runtime (`runtime.js`) does not resolve
  `control()` references; this is a deliberate, currently fail-closed gap
  pending a dedicated export-time resolver design, not a bug.
- Rendered (non-interactive) Blender frame packages, source-time trimming, and
  a unified day-to-day timeline view do not exist yet — only the interactive
  GLB handoff and the minimal audio lane are implemented.
- This is desktop-local tooling: it depends on a locally running companion
  process and a local `.blend` file, and is not a cloud or collaborative
  Blender workflow.
