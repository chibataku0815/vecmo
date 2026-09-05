# Reference Scene Tutorial Gallery

## What changed?

Vecmo now has a `/tutorials` surface: a browsable gallery of **reference
scenes** — open-ready vector and motion studies, one per capability, that show
how a feature is actually built rather than describing it in prose. Each entry
is a real `SceneDocument` plus its `MotionDocument` motion side-car, stored as
serialized data and rendered by the editor's own SVG renderer, so a gallery
preview is byte-faithful to what the scene shows in the editor.

**The gallery is now tutorial-first, not just browsable.** Every entry pairs
its scene with real tutorial content — a "You will…" goal, an honest time
estimate, and 4-8 imperative steps naming the exact UI to touch — and opening
a scene in the editor surfaces that content as a live, in-editor step guide.
Before this, `/tutorials` was a gallery of openable scenes with no goal, no
steps, and no in-editor guidance; a scene you could open was not yet a
tutorial you could follow.

This release establishes the pipeline end to end — a drift-gated fixture
library, a pure-renderer thumbnail path, the `/tutorials` route, the
ephemeral in-editor "open" handoff, a tutorial-content data model, and an
in-editor guide panel — and ships four real tutorials spanning both
**Design** and **Motion**:

- **Grainy gradient orb** (Design) — the featured, first-listed entry: a single
  rectangle carrying a 9-by-9 mesh gradient, a layer blur, and fine node-look
  grain, reproducing a document authored live via the agent bridge. See
  [Grainy gradient orb](./grainy-gradient-orb.md).
- **Cycle** (Motion) — the looping-orbit system (`cyclic-path-travel`): a row of
  phase-offset dots that travel a closed loop.
- **Time Delay** (Motion) — the master-instance delayed-replay system, authored
  from the editor's real `createTimeDelayMaterializationPlan` (five master dots,
  five satellites, a "Time Delay expansion" clip, and the authoring-profile
  binding), not a bare grammar binding — so it is the genuine product feature.
- **Corner radius & squircle** (Design) — three shapes showing uniform radius,
  per-corner radii, and squircle smoothing; the corner geometry bakes to native
  SVG paths.

A later addition ships a fifth entry:

- **Grainy dissolve cover** (Design) — an album-cover-style, four-node
  two-plate composition: a full-bleed background and a large sphere, each a
  bright pink plate noise-gradient-dissolved over a deep blue-violet plate of
  the same geometry beneath it. One shared palette; the background/sphere
  pair differ only in gradient geometry (linear vs. radial) and Noise Gradient
  field direction (diagonal vs. vertical). See
  [Grainy dissolve cover](./grainy-dissolve-cover.md).

Afterimage and other techniques follow as their authoring systems are captured.

**Each entry now also ships a "View export result" demo page.** This closes
the tutorial loop — build it in the editor, then see the exported code running
unmodified on a real page — and it is a genuine `editable`-profile motion/code
export artifact (the same `createExportBundle` → `createMotionCodeHtmlAsset`/
`createMotionCodeRuntimeAsset` pipeline the in-app export panel runs), not a
bespoke demo renderer. See [View Export Result Demo
Pages](#view-export-result-demo-pages) below.

**Look design.** Cycle, Time Delay, and Corner radius wear the editor's real
**Analog Film** look at the FRAME level
(`artboard.effectIntent.visualRecipe = ANALOG_FILM_LOOK_RECIPE`), exactly as the
Time Delay preset does — dark charcoal shapes (`rgb(29 31 35)`) on the warm film
stage (`GLAMMER_TIME_DELAY_STAGE_BACKGROUND`, `#f4f3ef`). The SVG exporter now
applies the frame-level look to the static poster (grain via `feTurbulence`,
grade via `feColorMatrix`), so the shapes carry **no per-node look** — the
poster shows the Analog Film grain via the frame finish and the editor adds the
chromatic-aberration fringe. These three scenes share the same frame look, so
that part of the gallery is one consistent product look. These are the preset's
own values, reused — not an invented palette.

**Grainy gradient orb is the deliberate exception.** It carries no frame-level
look at all — a plain light `#f8fafc` stage — because its look lives entirely
on the node: a mesh-gradient fill, a `layer-blur` node effect, and a node-look
grain recipe authored through `scene/set-bindable-property`. This keeps the
gallery honest about both authoring paths (frame-level look vs. node-level
look) instead of forcing every entry into one visual family.

## Tutorial Content Data Model

`src/features/reference-scenes/model/tutorial-content.ts` defines
`TutorialContent` (`slug`, `goal`, `estimatedMinutes`, `steps`) and the
`TUTORIAL_CONTENT` catalog, one entry per `REFERENCE_SCENES` slug. `steps` is
an ordered list of `{ title, detail }` pairs, each naming the exact UI the
reader touches — tool names, panel section headers, field labels, shortcuts —
as they exist in the current build, not aspirational copy. The module is
imported statically only by `pages/tutorials` (already its own lazy chunk);
the in-editor guide panel reaches it through a dynamic `import()` so a plain
`/editor` session never downloads tutorial copy.

`scripts/check-reference-scenes.ts` enforces this as a second, bidirectional
foreign key alongside the existing fixture/doc pairing: every registry slug
must have a `TUTORIAL_CONTENT` entry with a non-empty goal, `estimatedMinutes`
of at least 1, and at least 3 steps with non-empty title and detail; every
`TUTORIAL_CONTENT` slug must have a matching registry entry. A scene without
real step copy is a browsable preview, not a tutorial, so this is checked as
strictly as the scene/motion/render checks the script already runs.

## In-Editor Tutorial Guide Panel

Opening a reference scene (`/editor?ref=<slug>`) now renders
`widgets/tutorial-guide/ui/TutorialGuide` — a floating, collapsible card over
the canvas, positioned left-anchored above the timeline dock so it never
covers the tool rail, Layers panel, Inspector, or Timeline in their default
visible states. It shows the tutorial's title, goal, honest time estimate, and
an ordered, checkable step list; clicking a step toggles it done (muted with a
check mark), and the first unchecked step is highlighted as current. A
**Back to tutorials** link returns to `/tutorials`; a collapse control reduces
the card to a small `Tutorial · N/M` pill in the same corner.

The guide is rendered only in `app/App.tsx::ReferenceEditorRoute` (never in
the normal `/editor` route), and its state is local `useState` only — like the
reference scene itself, the session is ephemeral by design: reloading resets
both the loaded scene and the guide's checklist. There is no persistence hook
for step progress, matching the reference scene's own "never overwrites your
work" contract.

## View Export Result Demo Pages

Every registry entry carries a `readonly exportDemo: string`
(`features/reference-scenes/model/types.ts`) — a path relative to
`/tutorial-exports/` pointing at that scene's standalone "View export result"
page. `scripts/generate-reference-scenes.ts` produces these pages the same run
it produces the fixture library: for each source, after building its
(remapped, byte-deterministic) `{scene, motion, grammarBindings}` triple, it
calls the real export pipeline —
`createExportBundle({ scene, motion, currentFrame: 0, artboardScope: "current",
grammarBindings })` from `features/export/model/bundle.ts`, then
`createMotionCodeHtmlAsset`/`createMotionCodeRuntimeAsset` from
`features/export/model/code.ts` with the `editable` optimization profile
(`exportOptimizationOptionsForProfile("editable")`) — and writes both emitted
assets, byte-exact and under their own generated file names, into
`public/tutorial-exports/`. This is the identical code path the in-app export
panel runs; the demo page is not a bespoke renderer, so opening it is the
product's real exported-code output, not a lookalike.

`public/tutorial-exports/` is served as static files by both Vite dev (`public/`
passthrough) and the production Worker (`worker/index.ts`'s `app.notFound`
falls through to the `ASSETS` binding for any non-`/api/*` path that doesn't
match an app route, and `wrangler.jsonc`'s asset `not_found_handling` is
`single-page-application`, which only applies once a request already 404s —
a real file under `public/` is served directly, never SPA-fallback-substituted).
The HTML page is a `<!doctype html>` document with a `<script type="module">`
that imports its sibling `*.runtime.js` (relative import, no bundler, no
`eval`) and calls `mountVectorMotion(container, { autoplay: true, loop: true })`
— the runtime module is a self-contained ES module bundling the shared motion
sampler, the embedded scene/motion/grammar payload, and the SVG player, all
produced by the export pipeline itself.

Two gates hold this pipeline honest:

- `scripts/check-reference-scenes.ts` verifies, per registry entry, that
  `exportDemo`'s HTML file exists under `public/tutorial-exports/`, is at least
  500 bytes (catching an empty/truncated write), and that the runtime file its
  `<script type="module">` imports (parsed out of the `from "./<runtime>"`
  specifier) also exists.
- `scripts/check-reference-scenes-fresh.ts` — already a non-destructive
  snapshot → regenerate → diff → restore harness for the fixture library — now
  covers `public/tutorial-exports/**` the same way: every file there is
  generator output, so any diff after a regeneration means a demo page was
  hand-edited or a generator source changed without a re-run. The harness
  restores the committed bytes of BOTH directories regardless of outcome, so
  it never mutates the working tree.

The export pipeline itself has no volatile inputs (no timestamps, no random or
generated ids reach the bundle/code-export layer — unlike the fixture
serializers, which pin a fixed `savedAt`), so `gen:reference-scenes` produces
byte-identical demo pages on every run without any additional pinning.

The `grainy-gradient-orb` entry's demo page briefly regressed to a blank
canvas: its node paints a mesh-gradient fill (the `fills` paint stack, not the
legacy `style.fill` scalar), and the runtime player (`code.ts`'s
`RUNTIME_PLAYER_SOURCE`) read only the legacy scalar, so the mesh rendered as
`fill="none"`. This was a pre-existing gap in the runtime player, not something
this pipeline introduced — `mesh-export.test.ts` only ever covered the SVG-
exporter path, never the runtime/code path, so nothing had exercised a mesh
paint through this renderer before this gallery shipped it as a demo. It is
now fixed: the runtime bundles `buildSceneMeshPaintSvgArtifacts`
(`entities/scene/model/mesh-paint-svg.ts`) via the runtime-sampler bundle, which
rasterizes each mesh paint to a `<pattern><image>` def with a content-keyed
cache, the same pattern the live canvas bridge uses — see
[Motion Code Runtime Export](./motion-code-runtime-export.md) for the fix in
full and what related paint kinds (gradients, image references) and effects
(grain, blur) remain unsupported in the runtime player.

## What Users Can Do Now

- Visit `/tutorials` to browse the reference-scene gallery. The page now reads
  as tutorials, not just previews: the featured entry shows its goal, a
  `~N min` / `M steps` meta pair, and a preview of its first steps; every grid
  card shows a `M steps · ~N min` line.
- See a static motion-accurate poster for each scene, sampled from the real
  scene + motion data (not a hand-built mockup).
- Read a one-line summary, category, and status badge for each scene.
- Open a reference scene in the editor with one click (**Start tutorial**). It
  loads as an **ephemeral session** — your own saved document is neither read
  nor written, so opening a reference can never overwrite your work. Reloading
  `/editor` brings your document back.
- Follow the in-editor **Tutorial** guide panel step by step, checking off
  steps as you go, collapsing it out of the way, and returning to
  `/tutorials` from its footer link.
- Click **View export result** on the featured card or any grid card to open
  that scene's real exported code — a standalone HTML page — in a new tab. It
  is the genuine `editable`-profile export artifact running unmodified, closing
  the loop from "build it" to "see the exported code run."

## How To Use

1. Open `/tutorials` (the **Tutorials** link in the landing and Updates headers).
2. Scan the gallery cards; each shows a preview rendered from the scene's own
   data, plus its step count and time estimate.
3. Click **Start tutorial** on a card to load that scene into the editor, cued
   to its poster frame, with the Tutorial guide panel open.
4. Follow the guide's steps in order, clicking each to mark it done as you
   complete it.
5. Use the guide's **Back to tutorials** link, or the header's **Open editor**
   link to return to your own document.
6. Click **View export result** on any card to open that scene's exported
   HTML page in a new tab and see the real exported code animate.

## Manual Verification

1. Navigate to `/tutorials`. The page renders with the Vecmo header, a
   "Tutorials" heading, and the featured card showing a goal line, meta chips,
   and a step preview.
2. Five cards appear — **Grainy gradient orb** (Design, featured first),
   **Grainy dissolve cover** (Design), **Cycle — looping orbit** (Motion),
   **Time Delay — delayed replay** (Motion), and **Corner radius & squircle**
   (Design) — each with a non-blank preview and a `M steps · ~N min` meta
   line. The Grainy gradient orb card shows a glowing blue/violet orb on a
   light background; the Grainy dissolve cover card shows a pink/violet
   album-cover-style field and sphere; the Corner radius card shows three
   gradient-filled rounded shapes.
3. Click **Start tutorial** on each card: the Tutorial guide panel renders
   with the right title, goal, and steps; it does not cover the tool rail,
   Layers panel, Inspector, or Timeline at their default visible state.
   Clicking a step toggles its done state; collapsing shows a `Tutorial · N/M`
   pill that reopens the panel.
4. In `/editor`, make a small edit so a document is autosaved. Then open a
   reference via a card's **Start tutorial**: the reference scene and its
   guide load. Reload `/editor` (no `?ref`): your edited document is back,
   unchanged, and no guide panel renders — the reference never overwrote it.
5. Run `bun run check`. `check:reference-scenes` passes and reports the
   fixture count; it also fails if a registry entry is missing its
   `TUTORIAL_CONTENT` pairing or a tutorial's steps are too few or empty.
6. Temporarily corrupt a fixture (e.g. change `sceneSchemaVersion`) and rerun
   `bun run check:reference-scenes`: it exits non-zero and names the drift.
   Restore with `bun run gen:reference-scenes`.
7. After editing the generator or a fixture, run `bun run
   check:reference-scenes-fresh`: it regenerates and fails if the committed
   fixtures no longer match their generator sources (it is a standalone
   merge-time guard, not part of the fast `bun run check`).
8. Click **View export result** on the featured card and each grid card: each
   opens `/tutorial-exports/<file>.html` in a new tab. The page's motion
   animates and loops (Cycle and Time Delay visibly move; Grainy gradient orb,
   Grainy dissolve cover, and Corner radius render their static shapes); the
   browser console has no errors. The `href`/`target="_blank"`/
   `rel="noopener noreferrer"` attributes are present, and there is no
   nested-`<a>` DOM warning on either card layout.
9. Run `bun run gen:reference-scenes` twice in a row and diff
   `public/tutorial-exports/`: the output is byte-identical (the export
   pipeline has no volatile inputs), proving determinism.

## Known Limits

- **Five tutorials so far (Grainy gradient orb, Grainy dissolve cover, Cycle,
  Time Delay, Corner radius).** Afterimage and the remaining techniques are not
  yet in the gallery. A technique whose motion transforms an *underlying*
  animation must be authored from its real editor system, not a bare grammar
  binding (Time Delay is, via `createTimeDelayMaterializationPlan`);
  self-contained techniques like Cycle, and static design features like Corner
  radius, Grainy gradient orb, and Grainy dissolve cover, author directly as
  literals through the real agent scene command bus
  (`applyAgentSceneCommands`) rather than a literal recipe — the orb's grain
  and both dissolve cover plates' Noise Gradient are applied through real
  `scene/set-bindable-property`/`scene/author-object-noise-gradient` agent
  commands.
- **The Time Delay poster is approximate.** Its bodies carry a WebGL-only look
  (chromatic fringe, grain) that the editor renders fully but the SVG gallery
  thumbnail can only approximate as flat fills — `check:reference-scenes` warns
  when a preview approximates look effects. Open the scene in the editor to see
  the real look.
- **Edits to a reference are not saved.** A reference opens as an ephemeral
  session by design. To keep changes, the user would copy them into their own
  document; a "duplicate into my project" affordance is future work.
- **Tutorial step progress is not saved either.** The guide panel's checklist
  and collapsed/expanded state are local component state, reset on reload —
  consistent with the reference scene itself never persisting.
- **Previews are static posters.** Motion does not animate in the gallery; the
  scene animates only once opened in the editor. Scenes that depend on
  WebGL-only raster effects cannot be previewed faithfully as SVG and are out of
  scope for the gallery.
- **Export-demo pages regenerate only with the fixture library.** They are not
  a live "export the current editor document" action — they are baked at
  `gen:reference-scenes` time from the same fixed sources as the fixtures, so
  they go stale (or fail `check:reference-scenes-fresh`) only if a source
  changes without a regeneration, same as the fixtures themselves.
- **Export-demo `.runtime.js` files are sizeable (roughly 380-590 KB each).**
  They embed the full motion sampler plus the scene/motion payload
  (`editable` profile, developer-handoff intent) so the page is a complete,
  self-contained artifact — this is the same size class as the in-app
  editable-profile export, not a regression specific to the gallery.
- Tutorial step copy is a maintained, hand-authored catalog
  (`tutorial-content.ts`), not generated from `docs/product-knowledge/`.
  Product-knowledge docs remain the deeper how-to reference; the gallery and
  in-editor guide carry the shorter, actionable step list.
