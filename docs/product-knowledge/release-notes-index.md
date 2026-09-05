# Vecmo Release-Notes Index

Created: 2026-06-22.

The working index of capabilities that **should** become public release notes,
and which are not ready. A planning surface, not the published changelog. The
published changelog lives at `/updates`
(`src/pages/updates/model/product-updates.ts`); this index decides what belongs
there and supplies ready-to-edit outward copy.

Dates are approximate landing dates from `git log` for the feature group — for
ordering, not commercial-release dates (Vecmo is pre-launch).

## Publishing rules

- **Only `public` items go to `/updates`.** Publishable = works for an end user
  with no setup, and the description matches the wiring (see
  `current-capabilities.md`).
- **`beta` items publish with explicit caveats, or wait.** Backend commercial
  flows (checkout, billing, account) are `beta` until production D1 + Polar
  secrets are verified — don't announce them as available.
- **`internal` and `draft` items never go to `/updates`.** Agent/MCP tooling,
  backend job runtimes, and draft legal documents are not user release notes.
- **Roadmap is not a release note.** Items in
  [Not yet reachable](./current-capabilities.md#not-yet-reachable) belong on a
  roadmap or in known-limits.
- Each public entry should answer the same five questions every page here does:
  what changed, what can I do now, how, why it matters, what's still limited.

## Currently published on /updates

- **Parallel editor sessions** · `public` · 2026-07-12 —
  [`multi-editor-sessions.md`](./multi-editor-sessions.md)
- **Time Delay motion system** · `public` · 2026-06-22 —
  [`time-delay-motion-system.md`](./time-delay-motion-system.md)
- **Timeline workspace mode** · `public` · 2026-06-22 —
  [`timeline-motion-workspace.md`](./timeline-motion-workspace.md)

These render at `/updates` from `src/pages/updates/model/product-updates.ts`.

---

## Ready for public release notes

These are `public` capabilities that work today. Each line is ready-to-adapt
outward copy; the link points to the source-of-truth section or doc.

### Motion & timeline

- **Timeline & keyframe animation** · 2026-06-18 — Animate position, scale,
  rotation, opacity, and path with keyframes on a frame-accurate timeline; scrub,
  play, loop, and shape easing with presets or a custom curve.
  [Capabilities §12](./current-capabilities.md#12-timeline--motion)
- **Auto-key & key pose** · 2026-06-18 — Turn on recording and your edits become
  keyframes at the playhead, or snapshot a whole pose into one key.
  [Capabilities §12](./current-capabilities.md#12-timeline--motion)
- **Edit motion systems from clips** · 2026-06-22 — Select a motion-system clip to
  edit its start, duration, and parameters, and jump straight to its source
  objects. [Time Delay](./time-delay-motion-system.md)

### Drawing & paths

- **Pen & shape tools** · 2026-06-18 — Draw bezier paths, or drag out rectangles,
  ellipses, lines, polygons, and stars.
  [Capabilities §4](./current-capabilities.md#4-vector-drawing)
- **Bezier node editing** · 2026-06-18 — Direct-select a path to insert, move, and
  convert anchors and drag bezier handles.
  [Capabilities §4](./current-capabilities.md#4-vector-drawing)
- **Pencil / freehand** · 2026-06-21 — Draw a freehand stroke that is automatically
  smoothed into a clean vector path.
  [Capabilities §4](./current-capabilities.md#4-vector-drawing)
- **Boolean path operations** · 2026-06-19 — Union, subtract, intersect, and
  exclude paths — with curves re-fitted, not flattened — and keep holes via
  compound paths. [Capabilities §4](./current-capabilities.md#4-vector-drawing)
- **Gradient mesh** · 2026-06-20 — Build a gradient mesh on any shape, drag points
  and curved-edge handles, and recolor points inline.
  [Capabilities §4](./current-capabilities.md#4-vector-drawing)

### Canvas & navigation

- **New project in editor** · 2026-07-03 — Start a blank editable project from
  the labeled top-left editor action or Cloud projects popover, with the existing
  save/backup guard still protecting current work.
  [Editor New Project](./editor-new-project.md)
- **Infinite canvas** · 2026-06-21 — Pan and zoom freely on an unbounded canvas
  with cursor-anchored zoom from 2% to 6400%.
  [Capabilities §1](./current-capabilities.md#1-editor--canvas)
- **Hand tool & two-finger pan** · 2026-06-20 — Pan with two-finger scroll,
  Space-drag, or the Hand tool, anywhere on the canvas.
  [Capabilities §1](./current-capabilities.md#1-editor--canvas)
- **Resizable, toggleable panels** · 2026-06-20 — Show, hide, and resize the
  Layers, Inspector, and Timeline panels; layouts persist.
  [Capabilities §1](./current-capabilities.md#1-editor--canvas)

### Layers, selection & transform

- **Transform again** · 2026-07-02 — Repeat the last committed move, rotate,
  resize, nudge, flip, Inspector transform edit, or duplicate spacing from
  `Mod+D`, the command palette, or the canvas menu.
  [Repeat Transform](./repeat-transform.md)
- **Layer drag reparent** · 2026-06-22 — Drag layer rows to reorder among siblings
  or nest inside a container.
  [Layers reparent](../layers-dnd-reparent-spec.md)
- **Range select in Layers** · 2026-06-22 — `Shift+Click` selects a whole range of
  layers; `Cmd/Ctrl+Click` toggles individual ones.
  [Capabilities §5](./current-capabilities.md#5-layers--structure)
- **Bounding-box controls** · 2026-06-20 — Show/hide the transform box and reset a
  rotated box to upright.
  [Bounding box](../illustrator-bounding-box-plan.md)
- **Group, mask & frame** · 2026-06-19 — Group and ungroup, wrap in frames, and use
  a shape as a clipping mask.
  [Capabilities §5](./current-capabilities.md#5-layers--structure)

### Appearance, color & effects

- **Custom color picker** · 2026-06-21 — A full color picker with SV plane, hue,
  hex/RGB, swatches, cross-surface recents, and a screen eyedropper.
  [Color picker](../color-picker-overhaul-spec.md)
- **Appearance stack** · 2026-06-21 — Stack several fills and strokes on one
  object, each with its own visibility and order.
  [Capabilities §8](./current-capabilities.md#8-inspector-appearance--color)
- **Graphic styles** · 2026-06-21 — Save an object's full appearance as a named
  style and apply it to others.
  [Capabilities §10](./current-capabilities.md#10-styles--style-transfer)
- **Analog Film look + grade dials** · 2026-06-22 — Recall a single frame-level
  Analog Film treatment (grain + chromatic-aberration edge) in one click, and
  fine-tune 8 grade dials (exposure, contrast, grain, glow, and more). The same
  frame look now carries into SVG/PNG still output as a reported SVG-filter
  approximation, so film-treated presets do not lose their finish at export.
  [Capabilities §9](./current-capabilities.md#9-vec-core-effects)
- **Shadows & blur** · 2026-06-20 — Add drop shadows, inner shadows, and layer blur
  per object. [Capabilities §9](./current-capabilities.md#9-vec-core-effects)
- **On-canvas gradients & eyedropper** · 2026-06-20 — Drag gradient handles
  directly on the object and sample colors with the eyedropper.
  [Capabilities §8](./current-capabilities.md#8-inspector-appearance--color)

### Productivity

- **Keyboard-shortcut help** · 2026-06-21 — Press `?` for a grouped, always-current
  cheat-sheet of every shortcut.
  [Capabilities §18](./current-capabilities.md#18-commands--shortcuts)
- **Space play/pause** · 2026-06-22 — Tap `Space` to play or pause; hold and drag
  still pans. [Capabilities §12](./current-capabilities.md#12-timeline--motion)
- **Project backup save & restore** · 2026-06-20 — Save your whole project
  (scene, motion, and motion-grammar bindings) to one file and restore it any
  time, with a tolerant reader that also hydrates older Time Delay captures with
  their missing film look.
  [Capabilities §16](./current-capabilities.md#16-backup)
- **Command palette** · 2026-06-20 — Press `Mod+K` to search and run any command
  with live availability and shortcut hints.
  [Capabilities §18](./current-capabilities.md#18-commands--shortcuts)

### Import & export

- **SVG / image import** · 2026-06-18 — Import SVG and PDF-compatible Illustrator
  files, or place PNG/JPEG/WebP images, with a clear fidelity report.
  [Capabilities §14](./current-capabilities.md#14-import)
- **Motion code & WebM export** · 2026-06-20 — Export motion as an HTML+React
  runtime, record the timeline to WebM video, or export selected vectors as SVG.
  [Capabilities §15](./current-capabilities.md#15-export)

---

## Beta — publish only with caveats

| Feature | Status | Why caveated |
| --- | --- | --- |
| General Motion Relationships | beta | Camera-independent exact-affine controller parenting, shared keep-pose bind/detach, ordinary transform/keyframe authoring, Layers/Inspector/canvas chrome, id remap, and shared export/runtime sampling are wired. Browser/export smoke and adversarial review passed; same-artboard 2D scope and no authored skew keep this beta. |
| Transform and Property Constraints | beta | Same-artboard partial Position/Rotation/Scale following and registry-backed opacity/corner mappings are wired through one dependency resolver, command bus, Inspector/Layers, Agent/MCP, and runtime. IK, weighted parents, and arbitrary properties remain outside V1. |
| Direct Spatial Motion Paths | beta | Paired X/Y path values carry exact cubic tangents, speed dots, auto/continuous/corner modes, integral-frame roving distribution, direct canvas/Inspector authoring, sampled Value/Speed Graphs, exact four-handle temporal curves, Agent commands, typed fallback, and shared export/runtime sampling. |
| Traveling Layer Mattes | beta | Native mask relations expose alpha/luminance/RGB channel, pre/post-effect intent, same-artboard cross-layer/nested vector sources, shared multi-consumer motion, and Inspector controls without a second matte owner. Post-effect and pixel-derived channels remain typed-unrepresented; GPU/PDF limits keep this beta. |
| Morph Topology Correspondence | beta | Path-shape keys support exact-cubic count repair, explicit closed seam and winding edits, canvas adjacent ghosts/correspondence/direct selection/previews, Agent commands/readback, and shared sampler delivery. Semantic feature matching remains intentionally absent. |
| Multi-role Transition Phrase Timing | beta | Selected motion-system clips can apply one supported semantic timing template transactionally to every member segment without a new transition schema. Arbitrary clip role guessing and profile-only physics remain out of scope. |
| Source-driven Deep Glow compositor | beta | The editor and deterministic/WebM raster compositor now use linear-light source extraction, progressive tent reconstruction, and a separate material/target-response emission versus completed-base path for complete visible top-level selections. A controlled equal-carrier QA scene received pixel-only user acceptance, but partial selection ordering, frame-GPU coexistence, generated runtime regeneration, and authorized repository verification remain open. Keep it off `/updates` until those product-surface gaps are closed. |
| Effect Field authoring | beta | Contour/Linear/Mesh authoring and opacity/layer-blur/Glow routing are wired, but standalone runtime, direct WebGL, cross-document clipboard, and 4K performance remain unverified or deferred. |
| Source Optics and Material Response Rig | beta | The no-helper source/target workflow now includes exact-angle sampled rays, numeric Inspector/Timeline/Agent keyframes, shared SVG/export/generated-runtime sampling, and generic ordered direct-WebGPU effect islands with atomic typed fallback for unsupported owner arrangements. Keep it off `/updates` until a metadata-free multi-scene pixel packet receives the user verdict; PDF and legacy WebGL-native optics remain outside P2. |
| Axis-aligned anisotropic blur | beta | Inspector and Look Graph X/Y controls are wired with relink/animation semantics, but browser and export-parity smoke was not authorized in this task. |
| Metadata-blind Visual Review | beta | The detached private A/B workflow, frozen-source capture, verdict lock, and metadata reveal are wired, but browser/GPU/4K smoke was not authorized in this task. It never auto-passes aesthetic quality. |
| Afterimage Master Rotation Echo | beta | The profile exists, but it must stay off `/updates` until browser visual smoke proves the circular rotating Glammer reference: two opposing same-shape dots, nine-copy tails, and rest-tail disappearance. |
| Time Delay / Time Offset motion systems | beta/public split | Time Delay is public; Time Offset and Afterimage are authoring surfaces that still need final outward-copy and visual-parity review. |
| Frame Look & influence | beta | Influence target scope is fixed; some mask kinds unsupported. |
| Motion / Code WebGL runtime | beta | Auto-selected export wiring exists, but it should stay off `/updates` until browser visual smoke confirms transparent Deep Glow behavior and GSAP scrubbing on the reference glow-sphere chain. |
| Landing WebGL orb hero | beta | The public route now mounts a saved orb backup with GSAP/WebGL interaction, but it should stay off `/updates` until browser visual smoke confirms the shipped hero against the saved Vecmo state. |
| Parameter Capture Stage | beta | The filmed HUD is wired for selected node-native, Duplicate generator, selected Look Graph node, Frame/Scene Effect Stack, and focused motion-system clip parameters, but should stay off `/updates` until the intended capture/export story is decided. |
| iPad canvas authoring mode | beta | The touch-first quickbar, Quick Menu, compact Style/text controls, timeline/recovery entry points, finger viewport navigation, and canvas-local backup actions are wired, but it should stay off `/updates` until a TestFlight-installed physical iPad Air M2 pass confirms the subjective creation loop. |
| Cloud project save/open | beta | Creator-gated save/open, active-project autosave, safe open/replace, Work locally, and `/projects` management are wired as the first paid workflow-continuity boundary, with R2 document bodies and D1 metadata/revisions. It should stay off `/updates` until the deployed account + billing + D1 + R2 path is provisioned and verified. |
| Agent edit-approval bridge | beta | No normal entry point; UI labels not finalized; mostly developer tooling. |

---

## Internal / draft — do not publish

| Area | Status | Note |
| --- | --- | --- |
| MCP server & bridge CLI | internal | Developer/agent integration tooling, not an end-user feature. |
| Server export-jobs runtime | internal | Backend API with no editor UI. |
| Auth / billing / admin backend | beta/internal | Built but unprovisioned (needs D1 + Polar secrets); announce only after launch readiness. |
| Legal documents | draft | Templates pending professional review; not a release note. |

---

## How to turn an entry into a published update

1. Confirm the capability is `public` in `current-capabilities.md` and matches the
   wiring.
2. Add or update a per-feature page in this folder (the five-question format).
3. Add a typed entry to `src/pages/updates/model/product-updates.ts` with
   `status: "public"`, source-cited claims, and links back to the detail page.
4. Run `bun run check` (enforces product-knowledge updates and English-only public
   copy) and verify `/updates` renders the entry.
