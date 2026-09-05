# Vecmo Product Knowledge

Created: 2026-06-22.

This folder is the product-facing knowledge base for Vecmo. It records what was
added, why it matters, and how a user should operate the feature. Planning docs
and handoff docs can stay implementation-heavy; pages here should reduce support,
sales, demo, and onboarding explanation cost.

## Start here

- [`current-capabilities.md`](./current-capabilities.md) — the full, source-grounded
  inventory of everything Vecmo can do today, grouped by category, with a
  status (`public` / `beta` / `internal` / `draft`) and a known-limits list. This
  is the map; per-feature pages are the detail.
- [`effect-field.md`](./effect-field.md) — the reusable Linear / Circular / Mesh
  routing and authoring system for localized canonical properties.
- [`source-optics-material-response-rig.md`](./source-optics-material-response-rig.md)
  — one source driving bounded bloom, atmosphere, and independently authored
  target responses without helper Layers or artwork presets.
- [`deep-glow-source-driven-compositor.md`](./deep-glow-source-driven-compositor.md)
  — linear-light Deep Glow with separate material/target-response emission and
  completed-artboard base for complete selection-scoped target sets.
- [`axis-aligned-anisotropic-blur.md`](./axis-aligned-anisotropic-blur.md) —
  linked or independent X/Y Gaussian blur without motion-blur overclaiming.
- [`visual-review.md`](./visual-review.md) — the private metadata-blind A/B
  workspace for frozen Vecmo stills and local reference pixels.
- [`release-notes-index.md`](./release-notes-index.md) — which capabilities should
  become public release notes, with ready-to-edit outward copy, and which are not
  ready. Feeds `/updates`.

## Update Rule

Any product-facing improvement should add or update one entry here when it changes
one of these surfaces:

- a user-visible workflow
- a demoable capability
- a motion/effect concept users must understand
- a manual verification path
- a known limitation that affects expectations

Each entry should answer:

1. What changed?
2. What can the user do now?
3. How does the user operate it?
4. What should a reviewer manually verify?
5. What is still intentionally limited?

## Merge Rule

Before merging a feature branch to `main`, update this folder whenever the branch
changes product-facing source under `src/app`, `src/pages`, `src/widgets`,
`src/features`, `src/entities`, `src/shared/ui`, or `worker`.

`bun run check` runs `check:product-knowledge` and fails if those surfaces change
without a `docs/product-knowledge/` update. External-facing improvements should
also update `src/pages/updates/model/product-updates.ts` so `/updates` reflects
the public story.

## Where to write what (classification)

When you add or change a feature, the content splits across three homes. Put each
piece in the right one:

| Kind of content | Goes in | Rule |
| --- | --- | --- |
| **Release note** — "this is new, here is the value" | `release-notes-index.md`, then `src/pages/updates/model/product-updates.ts` for `public` items | Describe only what is `public` and wired. Match the actual affordance. Roadmap and "coming soon" do **not** belong here. |
| **Usage guide** — "here is how to operate it" | A per-feature page in this folder (the five-question format) | One page per feature/concept. Say where the control is and what a reviewer should verify. Keep it operational, not marketing. |
| **Implementation navigation** — "where does this live and what can it break" | `docs/codemap.md` | Update at subsystem/workflow grain when entry points, source-of-truth ownership, invariants, generated artifacts, N-place syncs, or blast-radius change. Do not write commit chronology here. |
| **Limitation** — "this is intentionally not supported / not yet reachable" | The feature page's "still limited" answer **and** the relevant row of `current-capabilities.md` | A known limit sets expectations; it is not a release note. Unwired code goes in the capabilities page "Not yet reachable" table, never in `/updates`. |

Two cross-cutting rules:

- **Status discipline.** Tag every capability `public` / `beta` / `internal` /
  `draft` (see the rubric in `current-capabilities.md`). Only `public` is
  publishable outward. `beta` publishes with caveats or waits; `internal` and
  `draft` never publish.
- **Verify, do not assume.** A claim is only true if a route, shortcut, panel
  control, or menu item reaches a handler in the current checkout. Plans and
  internal notes are leads to verify, not evidence.

## Current Entries

| Date | Entry | Summary |
| --- | --- | --- |
| 2026-07-13 | [General Motion Relationships](./general-motion-relationships.md) | Beta camera-independent controller parenting with exact affine presentation, shared keep-pose bind/detach, ordinary keyframing, id remap, typed failures, and shared preview/export/runtime sampling. |
| 2026-07-13 | [Transform and Property Constraints](./transform-and-property-constraints.md) | Beta partial-channel transform following and registry-backed numeric property relations with explicit strength/space/offset, shared dependency validation, Inspector/Layers/Agent authoring, and runtime parity. |
| 2026-07-13 | [Direct Spatial Motion Paths](./direct-spatial-motion-paths.md) | Beta paired-position path authoring with exact tangents, speed dots, sampled Value/Speed Graphs, four-handle temporal curves, roving distribution, typed fallback, Agent commands, and shared runtime sampling. |
| 2026-07-13 | [Traveling Layer Mattes](./traveling-layer-mattes.md) | Beta same-artboard cross-layer/nested alpha/luminance/RGB vector mattes with multiple consumers, shared SVG delivery, and typed post-effect/pixel-channel/GPU limits. |
| 2026-07-13 | [Morph Topology Correspondence](./morph-topology-correspondence.md) | Beta exact-cubic count repair, canvas ghost/correspondence authoring, explicit seam/winding previews, Agent read/write, and honest hold-on-mismatch delivery. |
| 2026-07-13 | [Multi-role Transition Phrase Timing](./multi-role-transition-phrase-timing.md) | Beta one-command semantic timing synchronization across every member segment of a selected motion-system clip, preserving ordinary role/key/path/matte/morph/controller ownership. |
| 2026-07-12 | [Multi-editor sessions](./multi-editor-sessions.md) | Public independent editor tabs with URL-stable Working Copies, atomic browser recovery, explicit one-writer cloud ownership, target-aware live agent routing, and named collision-free dev sessions. |
| 2026-07-12 | [Source-driven Deep Glow compositor](./deep-glow-source-driven-compositor.md) | Beta linear-light smooth-threshold kernel with progressive multiscale falloff, exposure compositing, display dither, and a separate material/target-response emission source for complete visible top-level selections; a controlled equal-carrier QA scene has pixel-only user acceptance while broader surface gaps remain. |
| 2026-07-12 | [Source Optics and Material Response Rig](./source-optics-material-response-rig.md) | Beta artboard-scoped source/target optical relationship with a canonical source core, bounded bloom/ray/atmosphere/lens owners, per-target response channels, command-bus/Agent authoring, shared export/runtime lowering, and explicit fidelity/resource limits. |
| 2026-07-11 | [Effect Field](./effect-field.md) | Beta generic Contour/Linear/Mesh authoring and registry-owned routing for localized opacity, layer-blur wet mix, and Glow wet mix, with shared identity and explicit fidelity limits. |
| 2026-07-11 | [Axis-aligned anisotropic blur](./axis-aligned-anisotropic-blur.md) | Beta linked/unlinked X/Y Gaussian blur for Layer blur and Look Graph Blur; relinking restores the legacy scalar representation and removes Y animation atomically. |
| 2026-07-11 | [Visual Review workspace](./visual-review.md) | Beta detached review sensor: frozen Vecmo still capture, metadata-stripped session references, randomized metadata-blind A/B comparison, optional monochrome/selection probe, verdict lock, and technical reveal without an automatic aesthetic pass. |
| 2026-07-09 | [Easing Template Picker](./easing-template-picker.md) | Beta Timeline keyframe easing editor now promotes semantic timing templates such as Ease in, Ease out, Ease in-out, and Snap hold, each with a tiny preview; Snap hold can insert an early hold key, motion-system profiles expose profile timing templates, and agent/MCP commands can request segment-compatible templates by id. |
| 2026-07-09 | [Reproduction descriptor importer](./reproduction-descriptor-importer.md) | Internal importer foundation for turning motion-production reproduction descriptors into Vecmo scene/motion/grammar skeleton documents while preserving camera-space/depth/null intent and acceptance-routing issues. |
| 2026-07-09 | [Scene camera rig projection](./scene-camera-rig-projection.md) | Beta authoring spine for authored scene cameras: command-palette creation, Layers camera identity, Inspector camera/depth controls, selected-camera Timeline lanes, canvas body/free-target handles, presentation-sampler projection, and export manifest/report detection for the first 2.5D SVG-affine subset. |
| 2026-07-07 | [iPad canvas authoring mode](./ipad-canvas-authoring-mode.md) | Beta iPad-focused canvas command layer: bottom quickbar with Pencil/Shape/Gradient/Noise Gradient/Select/Hand, Quick Menu shape/material tools, compact Style/text controls, Timeline, account, and cloud-recovery entry points, rAF-batched finger viewport navigation, two/three-finger undo/redo, canvas-local backup save/open/share, and iPad-only desktop chrome suppression while keeping editor state in the TypeScript engine. |
| 2026-07-07 | [Canvas render performance](./canvas-render-performance.md) | Internal performance foundation: browser-local derived-cache substrate with capability probing, IndexedDB metadata, OPFS binary artifacts, memory fallback, Worker queue, idle layout/Blend projection warming, persistent text/mesh/frame-grain/GPU draw-list/data-image source artifacts, GPU/text/image cache telemetry, iPad Quick Menu cache clear, and dev-only derived-cache diagnostics. No document format or authoring workflow change. |
| 2026-06-22 | [Current capabilities](./current-capabilities.md) | Full source-grounded inventory of every Vecmo capability, by category, with status and known limits. |
| 2026-06-22 | [Release-notes index](./release-notes-index.md) | Which capabilities should become public release notes, with ready outward copy, and which are not ready. |
| 2026-06-22 | [Contextual action toolbar](./contextual-action-toolbar.md) | Selected-object actions moved from a pinned top-center 14-button strip onto the single selection-following float (duplicate + group/ungroup); the right-click menu gained the common long-tail verbs (z-order, lock, hide) and the command palette holds the full set. The float tracks the object, hides during playback, and clamps/flips to stay on-screen. |
| 2026-06-22 | [Motion technique menu](./motion-technique-menu.md) | The Motion menu now exposes only production-authorable techniques while the full 18-technique grammar catalog stays internal. |
| 2026-06-22 | [Afterimage motion system](./afterimage-motion-system.md) | `Afterimage` now has a beta Glammer Master Rotation Echo profile with editable orbit dots and runtime echo artifacts; public completion waits on visual parity capture. |
| 2026-06-22 | [Time Delay motion system](./time-delay-motion-system.md) | `Time Delay expansion` is now an editable motion-system clip with source/master object selection and clip-local timing. |
| 2026-06-22 | [Timeline toolbar icon clarity](./timeline-toolbar-icon-clarity.md) | The Timeline toggle switched from a clock-like stopwatch to a film-strip glyph (plus a history divider) so it no longer collides with Undo/Redo. |
| 2026-06-22 | [Show/hide guides global toggle](./show-hide-guides-global-toggle.md) | "Show/hide guides" is an always-available global view toggle that no longer requires an object selection. |
| 2026-06-22 | [Timeline mode (Motion workspace)](./timeline-motion-workspace.md) | A maximize button expands the timeline into a tall, full-width, drag-resizable docked surface that reserves its own space (no panel overlap), with the canvas re-fitting to stay visible. |
| 2026-06-22 | [Show/hide grid](./show-hide-grid.md) | A single Show/hide grid toggle (⌘', command palette, and canvas right-click) now controls the previously trigger-less workspace grid plus the artboard layout grid. |
| 2026-06-22 | [Frame Look recall — Analog Film](./frame-look-recall.md) | The five meaningless per-node Look presets are gone; one selection-sensitive "Analog Film" recall applies a scoped grain/chromatic overlay clipped to the selection, includes remove-from-selection, or applies the frame treatment broadly when nothing is selected. |
| 2026-06-23 | [Effect capability contract](./effect-capability-contract.md) | Internal foundation: current look/effect controls now have machine-readable target scope, expression-bindability, and code/runtime fidelity metadata. |
| 2026-06-23 | [Motion-system clip Inspector](./motion-system-clip-inspector.md) | Focusing a grammar-backed clip splits the Inspector into two independently-scrolling panes — the normal inspector (Frame Look / object design) on top, the clip's motion controls on the bottom, with a draggable divider — so motion and look/design are visible and editable at the same time. |
| 2026-06-23 | [Timeline playhead scrub](./timeline-playhead-scrub.md) | The Timeline playhead is one unified object — a continuous line through every lane with a single grabbable head in a top ruler strip — and is directly manipulable from any view: click a ruler/lane to seek, drag to scrub, grab the head, or type an exact frame in the transport bar. Fixes the motion-clip and Clips views where clicking previously did nothing. Seeking pauses playback and adds no undo entry. |
| 2026-06-23 | [Codeable Effect + Duplicate](./codeable-surfaces.md) | A node's Look controls and its duplication can be driven by a small safe expression DSL (e.g. `value + sin(time)`, `Count = 8`, `X = i * 40`); the editor previews it live and the exported runtime reproduces the motion and duplication. |
| 2026-06-23 | [Snap to point and smart guides](./snap-to-point-and-smart-guides.md) | Grid/snap unification: restored the accidentally-deleted vertex snap engine ("Snap to point" locks a moved/drawn/resized point onto a real shape anchor or grid crossing), made the grid full-screen with "what you see is what you snap to", and gave each snap target its own glyph. Two toggles (⌘U Smart guides + Snap to point), decoupled from grid visibility. |
| 2026-06-23 | [Embedded checkout](./embedded-checkout.md) | Upgrade/checkout opens as an embedded modal over the editor instead of navigating the tab to `polar.sh`; the top-level page stays on the app domain. |
| 2026-06-23 | [In-app subscription management](./in-app-subscription-management.md) | Manage billing / change plan runs in a custom on-domain dialog (view, change plan, cancel, reactivate, invoices) instead of redirecting to the hosted `polar.sh` portal; only the card and invoice popups reach Polar. |
| 2026-06-23 | [Copy / Paste appearance](./copy-paste-appearance.md) | "Copy/Paste properties" is now "Copy/Paste appearance": it carries the full look — fills/gradients/meshes, stroke, effects, **plus the per-node Look (grade/texture/glow) that was previously dropped** — and applies it to many selected objects in one undo. Paste gained a real shortcut (`⌘⌥⇧V`) and search terms (appearance/look/match/inherit). |
| 2026-06-27 | [Look Graph workspace](./look-graph-workspace.md) | The Look Graph node editor now has categorized/searchable effect discovery, an expandable persistent-height dock, empty-stage pan, center controls, selectable/disconnectable wires, and selection-aware effect insertion while keeping graph edits on the command bus. |
| 2026-06-27 | [Motion / Code WebGL runtime](./webgl-player-export.md) | Motion / Code automatically emits a transparent WebGL canvas runtime for scoped GPU raster Look graph scenes, with `progress`/`seek(frame)` hooks for GSAP or host scrubbing. |
| 2026-06-27 | [Parameter Capture Stage](./parameter-capture-stage.md) | Capture Mode adds a filming HUD for selected vector parts, Duplicate generators, Look Graph nodes, Frame/Scene Effect Stacks, and focused motion-system clips: sampled motion/effect/profile values, key/animation state, rest/base deltas, and a canvas callout for SNS-ready authoring demos. |
| 2026-06-28 | [Wavefront Range Selector](./wavefront-range-selector.md) | `Time Delay` and `Time Offset` per-target stagger can be shaped by a Range Selector (start/end window + linear/square/ramp-down/smooth) over any real-node ordered set; default is the identity uniform stagger (byte-identical, no migration), authored via parameters/MCP, with editor==export parity. No dedicated Inspector control yet. |
| 2026-06-28 | [Noise Gradient (Particle Dissolve)](./noise-gradient.md) | A node Look toggle and Noise Gradient Tool dissolve the selected object into a noise gradient — grain particles whose density follows the shape (dense core, thinning edge), like After Effects' Inner Shadow + Dissolve or Illustrator's gradient + Grain. The ToolRail / `N` shortcut previews direct controls without mutating the document, shows a dashed contour reach outline in Circular mode, a Linear-mode field line with persisted endpoint handles, center/whole-field move, Option symmetric resize, invert/fit actions, direction cue, and range tick, editable Field Mesh density points, a diamond Extent handle for reach, an icon-only Circular/Linear/Mesh tool-options strip beside the ToolRail, Inspector endpoint/invert/fit controls, and an on-canvas mini HUD limited to exact Angle/Extent or selected-point Density; the first edit enables the effect in that same undo step if needed, while existing scoped Object Noise Gradient overlays keep ownership and are edited through the same tool controls. The particle field is static by default; raising Motion above `0` adds the SMIL `baseFrequency` boil driven by `temporalStability`, and WebM/sequence raster capture bakes that explicit motion per frame while preserving Linear `linearField` endpoints through an inlined data-URL ramp and Field Mesh through an inlined alpha PNG. It is a particle render mode of the existing texture recipe, carried by a shared `feTurbulence` / `feComponentTransfer` / arithmetic `feComposite` filter chain so editor canvas and SVG export match. A tracked 2026-07-12 cube probe confirms that per-face Linear gradients plus field-aligned Hard Light Mixed grain reproduce a fine solid-surface texture without a new feature. |
| 2026-06-29 | [Look Graph Particle Dissolve](./look-graph-particle-dissolve.md) | The Look Graph palette now separates **Film Grain** from **Particle Dissolve** while keeping both on the existing `grain` texture node kind. Particle Dissolve renders through shared texture lowering, supports Field choices for Circular, Linear, and Field Mesh plus Angle, and is explicitly a frame-pixel or masked-frame-pixel effect rather than per-object Noise Gradient. |
| 2026-06-30 | [Cloud project save/open](./cloud-project-save-open.md) | The top-bar Cloud popover saves the current project to the paid signed-in personal workspace, keeps an explicitly attached project current, and `/projects` manages saved projects backed by R2 document bodies and D1 revision metadata. |
| 2026-07-01 | [Frame tool](./frame-tool.md) | The Frame tool (`F`) is now wired: drag to create an artboard (live W×H, `Shift` square, `Alt` from center, **snaps to artboard edges/grid/guides**), **or click for a size-preset menu** (Desktop/Presentation/Mobile/Square) centered on the click; new artboard selected, tool returns to Select without a camera jump, one-step undo. Arrow and Scale remain disabled command-palette shells; Effect Field is now separately wired. |
| 2026-07-01 | [Cloud project save/open](./cloud-project-save-open.md) | `/projects` now exposes cloud project version history: list revisions, open/download a selected revision for recovery, and restore a past revision as a new current revision with Creator Pro. |
| 2026-07-01 | [Halftone Look node](./halftone-look-node.md) | Second Display/Pixel/Print Look effect: a GPU-deferred dot-screen node with Cell Size, Dot Size, Contrast, Angle, and Mix. It is wired through the WebGL raster surface for editor/WebM/WebGL playback; static SVG/PDF and Worker SVG output report/omit it with deferred fidelity metadata. QA continuation passed check/test/build/bundle and an editor smoke, while full WebM/runtime visual verification remains manual. |
| 2026-07-01 | [Pixel Grid Look node](./pixel-grid-look-node.md) | Third Display/Pixel/Print Look effect: a GPU-deferred LED/pixel-cell display node with Cell Size, Gap, Roundness, Brightness, Contrast, and Mix. It is wired through the WebGL raster surface for editor/WebM/WebGL playback; static SVG/PDF and Worker SVG output report/omit it with deferred fidelity metadata. QA continuation passed check/test/build/bundle and an editor smoke, while full WebM/runtime visual verification remains manual. |
| 2026-07-01 | [Ordered Dither Look node](./ordered-dither-look-node.md) | Fourth Display/Pixel/Print Look effect: a GPU-deferred true Bayer matrix dither node with Cell Size, Matrix Size, Levels, Mode, Contrast, Threshold, Strength, and Mix. It avoids the rejected native noise approximation; static SVG/PDF and Worker SVG output report/omit it with deferred fidelity metadata. QA continuation passed check/test/build/bundle and an editor smoke, while full WebM/runtime visual verification remains manual. |
| 2026-07-01 | [Glyph Mosaic Look node](./ascii-glyph-look-node.md) | Fifth Display/Pixel/Print Look effect: a GPU-deferred fixed 5x7 ASCII density-ramp node with Cell Size, Glyph Size, Contrast, Brightness, Density Bias, Invert, and Mix. It avoids external font/atlas contracts; static SVG/PDF and Worker SVG output report/omit it with deferred fidelity metadata. QA continuation passed check/test/build/bundle and an editor smoke, while full WebM/runtime visual verification remains manual. |
| 2026-07-01 | [Block Mosaic Look node](./block-mosaic-look-node.md) | Sixth Display/Pixel/Print Look effect: a GPU-deferred raised-tile/block reconstruction node with Cell Size, Gap, Bevel, Relief, Light Angle/Elevation, Contrast, Variation, and Mix. Static SVG/PDF and Worker SVG output report/omit it with deferred fidelity metadata. QA continuation passed check/test/build/bundle and an editor smoke, while full WebM/runtime visual verification remains manual. |
| 2026-07-01 | [Display / Print Look starters](./display-print-look-starters.md) | Look Graph Starter mode adds Print Poster, LED Glow, Glyph Poster, and Surveillance Feed actions. They expand into normal editable Color Map / Ordered Dither / Halftone / Pixel Grid / Glyph Mosaic / Scanline / Deep Glow chains through the existing command bus, with separate undo entries per click. |
| 2026-07-01 | [Video Media Source](./video-media-source.md) | Top-bar Import can place browser-playable video as scene media; browser preview, WebM export, and Motion / Code WebGL player paths are wired to materialize the current video frame before applying SVG/GPU Look effects. Full video import/WebM/runtime visual verification remains manual. |
| 2026-07-02 | [Motion / Code WebGL runtime](./webgl-player-export.md) | WebGL Motion / Code now treats video media as a WebGL-player trigger, materializes referenced video frames before SVG/GPU Look rendering, and exports explicit transparent overlay mount entrypoints plus runtime-manifest capability metadata for host-page compositing. |
| 2026-07-02 | [Look-node Parameter Animation](./look-node-param-animation.md) | Agent/MCP Look-node keyframing now shares the entity-owned typed parameter catalog with discovery and rejects missing graph/node/param or non-numeric keyframe writes before creating `lookNodeTracks`. |
| 2026-07-02 | [Repeat Transform](./repeat-transform.md) | `Transform again` repeats the last committed move/rotate/resize/nudge/flip/Inspector transform edit or duplicate spacing from the command palette, canvas menu, and `Mod+D`. |
| 2026-07-02 | [Canvas render performance](./canvas-render-performance.md) | Internal rendering pass: viewport-culling rect quantization now snaps outward (never culls visible nodes), pan/zoom re-renders are decoupled from per-artboard render work, Blend/layout presentation materialization and motion samplers are reused by object identity, live drag geometry routes through a transient override store, stage rect is cached per gesture, and no-op snap/hover writes are skipped. No user-facing change. |
| 2026-07-03 | [Editor New Project](./editor-new-project.md) | The editor chrome now exposes a labeled **New project** action beside the document chip, with the same guarded blank-project route also reachable from the Cloud projects popover. |
| 2026-07-05 | [Variable-width strokes (stroke width profiles)](./stroke-width-profile.md) | `NodeStyle` gains a typed `strokeWidthProfile` (multiplier stops over normalized arc length); authored today via `scene/update-node-style`/`scene/append-node` agent commands, including `taper-out`/`taper-in`/`taper-both`/`ink` preset sugar. Dash is ignored when a profile is present; not animatable in v1. Internal foundation only — no Inspector control, pencil-pressure capture, or canvas/SVG/runtime rendering wiring yet. |
| 2026-07-06 | [Artboard Frame fills](./artboard-frame-fills.md) | Artboard backgrounds now use Figma-style Frame `fills`; the Gradient tool can seed and edit an artboard background gradient directly, while legacy `background` remains the solid fallback. |
| 2026-07-06 | [Export number syntax safety (PDF/SVG)](./export-number-syntax-safety.md) | Internal correctness fix: the static PDF/SVG `formatNumber` helper emitted exponent notation (`"1e+21"`) for operands `>= 1e21`, producing invalid PDF number tokens; it now emits plain decimal via `BigInt`. Smaller values are unchanged. |
| 2026-07-07 | [iPad thin shell probe](./ipad-thin-shell-probe.md) | The iPad TestFlight shell remains a thin `WKWebView` host, while the web editor now provides the canvas-first iPad quickbar, native backup bridge, cloud status/recovery, Timeline toggle, and compact Style controls for Pencil-first editing. |
| 2026-07-07 | [iPad Pencil Pro authoring](./ipad-pencil-pro-authoring.md) | Apple Pencil Pro squeeze/double tap/haptics, radial QuickMenu, selected Delete, hover cursor, quick line recognition, pinch rotate, Quick Pinch, multi-touch undo/redo, three-finger QuickMenu, and four-finger focus mode are now first-class iPad authoring inputs. |
| 2026-07-09 | [Agent Bridge Development Auto-Approval](./agent-bridge-dev-auto-approval.md) | Local dev bridge sessions auto-approve `apply_edit_plan_live` and `save_project_live` so agent implementation loops do not stall on the approval banner, while production bridge sessions remain human-gated by default. |
| 2026-08-05 | [Blender-linked production](./blender-linked-production.md) | Internal, not user-facing yet: a linked `.blend` source with a local Bun companion rebuild, one Vecmo frame clock driving explicit GLB animation seek, published numeric controls with `control()` expression fan-out into camera focus/FOV and text-reveal offset, and a minimal frame-anchored audio lane. No public Import menu claim; neither expression field has an Inspector control yet. |

## Public Surface

External product updates are shown at `/updates`. Pages in this folder are the
internal source of truth; the public route uses curated, typed product claims
rather than rendering raw Markdown.

Until a proper multilingual system exists, public-facing product copy is
English-first. `bun run check` runs `check:public-english` to prevent Japanese
text from returning to the landing, checkout, legal, updates, README, and
product-knowledge surfaces covered by the guard.

The public surface must stay readable as entries grow. Keep these affordances in
place when adding entries:

- a category index with entry counts
- an all-updates list grouped by category
- article-level contents links for long entries
- source-of-truth references back to product-knowledge or planning docs

## Product Vocabulary

| Term | Meaning |
| --- | --- |
| Motion system | A semantic motion object that controls generated or repeated motion without forcing every generated part to become manual keyframes. |
| Source object | A real workspace object that drives or participates in the motion system. |
| Master object | A source object in a master-instance motion system. Editing it changes the generated motion result. |
| Generated instance | The repeated or delayed result produced by the motion system. It is driven by the system until explicitly baked or materialized. |
| Trackless expression | A motion behavior computed from semantic parameters instead of many scalar keyframe tracks. |
| Bake | An explicit conversion from semantic motion into editable scalar tracks and generated artifacts. |
