# Codemap — where things live & how they flow

**Read this before exploring.** It exists to collapse per-task orientation from ~10 serial greps
into one lookup. Find your subsystem, note its **entry points**, **invariants**, and
**blast-radius**, then go straight to the code.

- **Anchors are `path::Symbol`** (durable). If a symbol moved, `rg` the symbol name — never trust a
  line number. Paths are relative to repo root; layer alias `@/` → `src/`.
- **Still need detail after this map?** Fire **one** `Explore` subagent seeded with the entry points
  below. Do not run 10 serial greps in the main context — that serial rediscovery is the exact cost
  this file removes.
- ⚠️ **`docs/*.md` (230+ files) are point-in-time plans & handoffs — frequently stale.** Never cite
  them as current behavior; ground truth = source + this map. *This file is the maintained exception.*
- **Keeping it fresh:** update this file when a change alters how a future agent should navigate a
  subsystem: source-of-truth ownership, primary entry points, cross-layer flow, invariants, generated
  artifacts, N-place sync, or blast-radius. Sections are short on purpose so this stays cheap.
- **Update at AI-navigation grain, not commit grain.** A good entry helps the next agent choose files,
  preserve invariants, and avoid hidden sync/regeneration traps without replaying git history. Prefer
  stable subsystem/workflow slices such as "Inspector transform authoring" or "Command bus"; do not
  add rows for branch names, PRs, loop numbers, one-off bug fixes, or chronological task notes.
- **Tooling note:** do not `rg` a content match inside `*.generated.ts` — they are single-line
  minified IIFEs (100s of KB) and one match prints the whole line. Grep the header or the `export`
  name only.

Layers import **downward only**: `app → pages → widgets → features → entities → shared`.
The base inventory was verified on 2026-07-04; the shared editor-platform rows
and dispatch boundary were refreshed on 2026-07-20.

## L1 index

| Touching… | Start at | Never forget |
| --- | --- | --- |
| Keyboard / shortcut / tool dispatch | `widgets/action-surface/model/editor-actions.ts`, `widgets/action-surface/ui/ActionSurface.tsx`, then product-local Canvas/feature handlers | One global registry/dispatcher; aliases, palette, help, labels, tools, panels, opacity, frame navigation, zoom, grid, and Save derive from it. Canvas/feature handlers keep only scoped behavior. |
| Working Copy / cloud save | `app/App.tsx::{useWorkingCopyPersistence,saveActiveCloudProjectNow,EditorRoute}`, `features/cloud-projects/model/editor-cloud-project-store.ts`, `widgets/action-surface/model/editor-actions.ts::file.save` | Manual save flushes local first, cloud only for an eligible writer, then local again. Exact attempt IDs own every async settlement and TopBar busy/notice; reference sessions never persist. |
| Selected-object / structure actions | `features/structure-actions/model/selected-object-actions.ts`, `widgets/layers-panel/model/{workflow-actions,row-actions}.ts`, `widgets/action-surface/model/editor-actions.ts` | Rename, Canvas object actions, Layers workflow delete, and node-row delete/lock/hide route through the spine |
| Inspector transform authoring | `widgets/inspector/model/authoring-controller.ts`, `widgets/inspector/ui/{InspectorPanel,FloatingInspector}.tsx` | read-state + scene-vs-motion write policy live in the controller |
| Document mutation / undo-redo | `entities/scene/model/{store,command,runner,gesture-transaction}.ts`, `features/history/model/undo-coordinator.ts` | 3 buses; command bus only (check:arch catches Scene+Motion only) |
| Scene model / node types | `entities/scene/model/{types,selectors,serialization}.ts` | FROZEN = **manual** review; additive-only |
| Scene assets / imported media | `entities/scene/model/{types,assets,node-commands,rendering,serialization,runtime-3d,production-link,production-artifacts,audio}.ts` | `SceneDocument.assets` is metadata; image/video/external asset placement is command-bus owned; external code/3D assets preserve source/preview/capability/fidelity data; eligible GLB/GLTF previews render through one shared, transparent Babylon Engine/Scene/Canvas (`shared/babylon`), not a Three.js overlay; code previews execute only in a sandboxed iframe; a linked `.blend` production source rebuilds through a local companion into that same Babylon path; agent summaries expose placed node ids for follow-up camera/depth edits |
| Scene camera / projection | `entities/scene/model/{scene-camera,scene-camera-commands,scene-camera-authoring,types}.ts`, `entities/motion/model/{camera-commands,presentation,types}.ts`, `features/scene-camera/model/authoring.ts`, `features/scene-camera/canvas/{overlay.tsx,handles.ts}`, `features/motion/ui/{timeline-adapter.ts,TimelineTracks.tsx,EasingPicker.tsx}`, `widgets/{inspector,layers-panel,timeline,action-surface}`, `features/export/model/bundle.ts` | Authored scene camera ≠ viewport camera; `scene-camera-authoring.ts` owns effective free/bound/stale target read state; camera lanes use `cameraTracks`/`cameraCuts`, not fake node ids; GUI writes command plans; coincident model anchors use display proxies while drag writes model deltas; selected and active cameras are separate facts; Timeline exposes projection-relevant Zoom/FOV lanes and compact one-camera Cut entry; crossfade renders as a previous/current projected-frame blend; export manifest reports fidelity/DOF approximation and active transition metadata |
| General motion relationships | `entities/scene/model/{motion-relations,motion-relation-commands,scene-camera,scene-camera-commands,node-commands,serialization}.ts`, `features/motion-parenting/{model/authoring,canvas/overlay.tsx}`, `entities/motion/model/presentation.ts`, `widgets/{action-surface,inspector,layers-panel}`, `features/export/model/{bundle,preview,svg,pdf}.ts`, `worker/export-jobs/render/scene-svg.ts` (cloud-only, not in this repository) | `motionParent` is camera-independent affine 2D after local motion and before camera projection; exact presentation matrices carry rotated non-uniform-scale shear without persisting skew into authored TRS; editor and Agent share keep-pose bind/detach planning and compound Scene+Motion undo; relations stay structural; clone/component/artboard paths remap internal controller ids; controller paint is editor-only; regenerate `runtime-sampler*.generated.ts` after resolver/presentation dependency changes |
| Transform / property constraints | `entities/scene/model/{types,scene-constraints,scene-constraint-commands,serialization,node-commands}.ts`, `entities/motion/model/presentation.ts`, `widgets/{inspector,layers-panel}`, `entities/agent/model`, `scripts/vma-agent-mcp.ts` | `TransformConstraint` follows explicit position/rotation/scale channels with strength, local/world spaces, and maintain-offset; `PropertyRelation` maps registry-backed numeric properties with scale/offset/clamp; both share dependency/cycle/remap infrastructure without becoming a generic link; a target cannot also use `motionParent`; presentation strips/restores metadata to prevent double evaluation |
| Reproduction descriptor import | `features/reproduction-descriptor/model/{input-contract,descriptor-import}.ts`, `scripts/vma-agent-mcp.ts` | Consumes the explicit app-local input subset of the accepted upstream descriptor shapes and lowers it into scene/motion/grammar skeletons; MCP `load_reproduction_descriptor` exposes the safe load path; preserve camera/depth/null intent as Vecmo data and issues, not prose |
| Selection / transform / viewport | `features/{selection,transform,viewport}/model` | live-drag override ≠ scene store until commit |
| Canvas render / the renderers | `widgets/canvas-shell/ui/{CanvasShell,SvgSceneNode}.tsx`, `features/export/model/{svg,code}.ts` | 4 SVG renderers + 1 flag-gated experimental GPU surface; `hasSubtreeCarrier` is a manual mirror |
| Visual review / blind comparison | `features/visual-review`, `widgets/visual-review-workspace`, `shared/editor-chrome/model/store.ts`, `pages/editor/ui/EditorPage.tsx` | review references and verdicts are session-only; critic pixels stay separate from the hidden technical manifest; diagnostic bypasses never mutate SceneDocument or make grain-off mandatory |
| Effect Field routing | `shared/effect-field`, `shared/vec-core`, `entities/scene/model/{effect-field-routing,effect-field-filter,effect-field-identity}.ts`, `features/effect-authoring`, `widgets/inspector/ui/EffectFieldControls.tsx` | field value is a normalized applicability matte routed through registered canonical owners; direct canvas modes cover contour, linear, radial, rect, and mesh while precision values stay in Inspector; old inline influence sources remain fallback; duplicate/unknown routes emit typed issues and never silently use the first assignment; editor/client/Worker adapters must share lowering and explicit per-surface fidelity; standalone runtime regeneration and direct WebGL are separate blast-radius gates |
| Source Optics / material response | `entities/scene/model/{source-optics,source-optics-ray-kernel,source-optics-commands,source-optics-filter,types}.ts`, `entities/motion/model/{types,commands,sampler,presentation,serialization}.ts`, `features/motion/ui/{timeline-adapter,TimelineTracks,EasingPicker}.tsx`, `widgets/inspector/ui/SourceOpticsControls.tsx`, `features/source-optics-authoring/canvas/overlay.tsx`, `entities/scene/model/gpu/capability.ts`, `widgets/canvas-shell/model/gpu-scene-frame.ts`, `shared/gpu/{types,quad-shader,webgpu}.ts`, `features/export/model/{render-presentation,bundle,svg}.ts`, `entities/agent/model`, `scripts/vma-agent-mcp.ts` | `Artboard.sourceOpticsRigs` owns static relationships; optional `MotionDocument.sourceOpticsTracks` addresses numeric rig/ray/binding params without a second timeline; transform sampling precedes optical parameter sampling; the source node owns core pixels; one active source per target; no helper nodes/hidden Looks/material names; one entity-level exact-angle kernel feeds SVG/export/runtime/WebGPU; direct WebGPU uses generic ordered effect islands and unsupported arrangements fail the whole artboard to typed SVG; Inspector, Timeline, and Agent use the same exact target address; regenerate runtime sampler and WebGL player after renderer or sampler changes |
| Axis-aligned X/Y blur | `entities/scene/model/{types,effect-filter,look-graph,look-graph-operations}.ts`, `widgets/inspector/model/shadow-blur-editing.ts`, `features/look-authoring/model/look-graph-editor.ts` | `radius` is X and omitted `radiusY` links Y to X; relinking Look blur deletes the whole Y track with compound Scene+Motion undo; do not describe this as angle/path/trajectory motion blur |
| Browser derived cache | `shared/cache`, `widgets/canvas-shell/model/persistent-cache-client.ts`, `entities/scene/model/cache-keys.ts` | artifacts are regenerable; scene/motion/assets stay source of truth |
| Motion / timeline / keyframes | `entities/motion/model`, `shared/glammer/keyframe-track.ts`, `features/motion/ui/{EasingPicker,TemporalGraphEditor}.tsx` | materialize layout **before** sampling; exact x1/y1/x2/y2 temporal curves are sampler truth; Value/Speed Graph samples the same tracks; `gen:runtime-sampler` |
| Direct spatial motion paths | `entities/motion/model/{types,position-path,commands,motion-path,sampler,presentation,serialization}.ts`, `features/motion/canvas/overlay.tsx`, `widgets/{action-surface,inspector}`, `entities/agent/model`, `scripts/vma-agent-mcp.ts` | X/Y scalar tracks remain value/time truth; `positionPaths` owns only artboard-space cubic tangents, spatial mode, and roving identity; exact numeric tangents and speed dots remain separate from temporal graph handles; paired retime/easing stays synchronized; invalid metadata yields typed scalar fallback; regenerate runtime sampler after sampler/path dependency changes |
| Traveling layer mattes | `entities/scene/model/{appearance,mask-render,mask-svg}.ts`, `features/structure-actions/model/mask-actions.ts`, `widgets/inspector/model/editing-shared.ts`, `widgets/inspector/ui/InspectorPanel.tsx`, `features/export/model/svg.ts`, `entities/agent/model`, `scripts/vma-agent-mcp.ts` | Consumer-owned reference relation, never adjacency; any visible pre-FX vector source subtree in the same artboard is flattened through exact transforms/opacity for multiple consumers; alpha and solid-fill luminance/RGB are shared-SVG native; post-FX, pixel-derived channels, cross-artboard, and mask chains fail typed; direct GPU admits only its compatible top-level hard subset |
| Morph topology correspondence | `entities/motion/model/{morph-topology,commands,sampler,presentation}.ts`, `features/motion/canvas/overlay.tsx`, `widgets/inspector/ui/InspectorPanel.tsx`, `entities/agent/model`, `scripts/vma-agent-mcp.ts` | Ordered `pathShape` snapshots are the only truth: index is pairing, index 0 is seam, direction is winding; canvas shows adjacent ghosts/correspondence, selects vertices, previews and commits first/reverse/count repair at exact keys; mismatch remains typed hold; no nearest-point side-car or frame bake; sampler changes require runtime regeneration |
| Multi-role transition phrase timing | `entities/motion/model/{types,commands,easing}.ts`, `widgets/inspector/ui/MotionTechniqueSection.tsx`, `entities/motion-grammar/model/system-map.ts`, `entities/agent/model`, `scripts/vma-agent-mcp.ts` | `AnimationClip.trackIds` is the scene-level timing boundary and motion-grammar system map owns named roles; clip-wide templates apply in one Motion patch; ordinary templates change segment timing only, while Snap hold may add a destination-value proof key; roles/spatial/matte/morph/controller state and clip range stay unchanged; unsupported profile templates fail closed |
| Motion concept + AEP evidence gates / production briefs | `CONTRIBUTING.md`, `.agents/skills/vecmo-motion-concept/SKILL.md`, `docs/knowledge/README.md`, `docs/knowledge/motion-concept-primer.md`, `docs/knowledge/vecmo-concept-gate-template.md`, `docs/knowledge/motion-reproduction-leverage.md`, `docs/knowledge/construction-signature-catalog.md`, `docs/templates/video-only-reference-packet.md`, `docs/knowledge/crcr-aep-reference.md`, `docs/knowledge/aep-evidence-acquisition.md`, `docs/knowledge/after-effects-course-vecmo-import.md`, `docs/knowledge/master-motion-design/README.md`, `docs/master-motion-design-course-to-vecmo-loop-plan.md`, `docs/core-motion-capability-completion-loop-plan.md`, `docs/crcr-aep-evidence-loop-plan.md`, `docs/crcr-transcript-concept-function-knowledge-loop-plan.md`, `docs/section-07-course-to-vecmo-loop-plan.md`, `docs/work3-gradient-field-evidence-reproduction-loop-plan.md`, `docs/section-07-equivalent-quality-vecmo-production-loop-plan.md`, `docs/aep-evidence/crcr/README.md`, `docs/knowledge/crcr/README.md`, `docs/knowledge/crcr/remaining-task-ledger.md` | enter through the task router and concept skill; bind video-only or failed-loop work to a reference packet, construction signature, Vecmo primitive/import path, and contact-sheet critique; for CRCR, enter through the single agent reference and AEP-only index before broader course joins; for Master Motion Design, preserve the Week 5 filename / narrated Week 6 distinction and follow the core-motion dependency order; read the generic AEP gate before inspection/extraction/reproduction/import/product decisions; preserve native role hierarchy, finish ablation, deterministic delivery, and the frozen quality rubric; course synthesis imports editable construction/relations rather than Adobe UI artifacts, and typed runtime/source/pixel blockers never count as faithful reproduction |
| Look graph / effects / appearance | `entities/scene/model/{look-graph,look-graph-compile,effect-filter,fidelity-issues}.ts` | regen `webgl-player.generated.ts` for runtime look changes; import/export fidelity targets share one sorter |
| MCP / agent commands | `entities/agent/model`, `entities/scene/model/{dot-matrix,pixel-art-object}.ts`, `features/pixel-object-import/model/objectify.ts`, `scripts/{pixel-art-object-plan,vma-agent-toolkit,vmactl,vma-agent-mcp}.ts` | CLI is primary; MCP is thin compatibility; 4-place command sync (check:agent-contract); dot matrices lower to one circular compound path. Pixel import feature code stops at lattice-preserving palette/index canonicalization; `entities/scene/model/pixel-art-object.ts` is the sole owner of connected-region budgets, run compression, compact indexed provenance, and native path lowering. One pixel-art append is allowed per reviewed plan and missing artboards fail closed. |
| Build, gates & generated artifacts | `package.json`, `scripts/check-*.ts` | `check:bundle` needs `build` first |
| iPad native shell probe + UX | `ios/VectorMotionAuthor/VectorMotionAuthor/{EditorHostViewController.swift,WetInkOverlayView.swift,NativeBridge.swift}` + `features/ipad-shell/model/{native-bridge,authoring-surface}.ts` + `features/draw/model/{native-pencil,freehand-commit}.ts` + `pages/editor/ui/EditorPage.tsx` + `widgets/canvas-shell/ui/CanvasShell.tsx`; TestFlight release path in `ios/fastlane/` | WKWebView hosts `/editor`; Swift captures Pencil-only wet ink, TS commits strokes through draw command path; iPad-only canvas chrome stays web-owned; fastlane must stay env/secret-driven |

> **These rows are the highest-traffic or newest mapped subsystems, not full coverage.** Cross-cutting operations that
> span several (e.g. grouping / boolean / arrange = *Selection/transform* + *Command bus*) and whole
> areas not yet mapped — the **export pipeline** (incl. the PNG-export stub), **pen / path editing**
> (`features/bezier`, `features/path-ops`), and **cloud / persistence / billing** (`worker/`,
> `features/{cloud-projects,project-backup,billing}`) — are **not** first-class here. For those:
> grep + one `Explore` agent. **A missing row means not-yet-mapped, never trivial.**

---

## Codemap entry rules

Add or revise a row/section only when it reduces future orientation cost for a stable subsystem or
workflow. The useful unit is the smallest slice that has its own entry points, invariants, and
blast-radius. If a change only affects local implementation inside an already accurate section,
leave the map alone.

Every first-class codemap entry should answer three questions:

1. **Where do I start?** Name durable `path::Symbol` anchors, not line numbers.
2. **What must stay true?** Capture source-of-truth, ownership, ordering, cross-store, or runtime
   invariants that an agent could otherwise miss.
3. **What else changes with it?** List generated files, checks, product-knowledge pages, public
   routes, Worker bindings, export/runtime adapters, or N-place syncs that form the blast-radius.

Use product docs for user-facing operation and release value. Use this file for implementation
navigation. If both matter, update both, but keep each doc in its own voice.

---

## iPad native shell probe — WKWebView host + Pencil wet ink

The E2 iPad shell is an adapter, not an engine fork.

- Entry: `ios/VectorMotionAuthor.xcodeproj` opens the native probe. `VectorMotionAuthorApp.swift`
  mounts `EditorHostViewController`, which loads `/editor` in `WKWebView`.
- Native bridge: `NativeBridge.swift` injects `window.__vmaNativeBridge`, logs web-to-native probe
  messages, reflects WKWebView capability probes back through `native-web-capability-probe`, sends
  native events through `vma:native-message`, and accepts `set-pencil-capture`,
  `perform-pencil-feedback`, plus native backup open/share requests from the web editor.
- Wet ink: `WetInkOverlayView.swift` captures Pencil-only touches above the web view, including force,
  altitude, azimuth, roll, coalesced touches, predicted touches, and estimated-property updates. Its
  live ink color, base width, and pressure curve mirror the TS freehand commit path so Pencil strokes
  do not visually jump when committed.
- Web adapter: `features/ipad-shell/model/native-bridge.ts` validates host/capability/Files bridge
  messages; `features/draw/model/native-pencil.ts` validates Pencil stroke, squeeze, and double-tap
  payloads and owns the native stroke session/estimated-update merge;
  `features/draw/model/freehand-commit.ts` shares the browser/native freehand commit path.
- iPad UX: `features/ipad-shell/model/authoring-surface.ts` detects the native bridge or iPad-like
  coarse-pointer surface. `EditorPage.tsx` uses that detector to enter canvas-first iPad authoring
  mode, where desktop-first chrome is not mounted while persisted desktop panel state remains
  untouched. `ActionSurface` remains mounted as the web keyboard/command-palette dispatcher, but its
  desktop path-operation strip is hidden. `CanvasShell.tsx` owns iPad gesture routing, quickbar
  action/account wiring, larger iPad handles/contextual action targets, and quickbar clearance;
  `features/ipad-shell/ui/IpadAuthoringQuickbar.tsx` owns the docked quickbar rendering,
  `features/ipad-shell/ui/IpadAppearancePanel.tsx` owns compact Style controls, and
  `features/ipad-shell/ui/IpadQuickMenu.tsx` owns the rectangular QuickMenu and Pencil squeeze radial
  menu rendering/slot persistence. They activate existing web tools/history/viewport actions and
  must not create Swift-side editor state. The same wrapper reserves iPad finger touch for viewport
  navigation: pinch zoom/rotate, Quick Pinch
  fit/restore, two/three-finger tap-or-hold undo/redo, three-finger swipe-down QuickMenu, and
  four-finger focus mode all stay web-owned. Apple Pencil Pro squeeze opens the six-slot radial
  QuickMenu with persisted slot assignment, double tap toggles Pencil/Select or opens Style for
  palette-like preferences, hover preview is visual-only, selected Delete routes through scene
  commands, native end-hold straight strokes can request draw-feature QuickLine recognition, and
  haptic feedback is requested through the native bridge. iPad camera gestures and Pencil hover
  preview are frame-coalesced in `CanvasShell.tsx`; pointermove handlers should not directly drive
  repeated viewport or hover React/store updates. The quickbar status dot reports native host
  readiness, WKWebView WebGPU/PointerEvent probe results, and whether Pencil squeeze has been
  observed. The quickbar uses existing web viewport actions for zoom out/current zoom/actual
  size/zoom in and fit-artboard-or-selection, and workspace fitting reserves top/bottom clearance for
  the docked quickbar.
  Its open/share backup actions reuse the existing project backup envelope and show inline web-owned
  handoff feedback; Swift only moves UTF-8 JSON through Files/share surfaces and reports share
  handoff success/failure.
- TestFlight: `ios/fastlane/` owns iPad beta archive/upload automation. Lanes must be
  environment-driven, keep App Store Connect API keys/signing material out of git, and stop when
  Apple Developer/App Store Connect or 1Password inputs are missing or ambiguous.

**Invariants:** Swift never owns scene state, motion state, command history, export, or serialization.
Any committed stroke must route back into the existing TS draw/freehand command path and then through
the scene command bus. Predicted samples are wet-ink-only; finalized scene paths use merged actual
samples after the short `ended` settle window. The overlay should hit-test only Pencil events while
the web Pencil tool is active so normal touch gestures and non-Pencil tools remain web-owned.
iPad-specific controls must call existing TS stores/actions; do not mirror tool, undo, selection,
viewport, QuickMenu assignment, or focus-mode state into the native shell.

**Blast-radius:** adding a new native message kind must update `ios/README.md` and the TS adapter once
one exists. Any native document/file feature must reuse the existing project backup contract; do not
create an iOS-only format or parse scene data in Swift. Changing TestFlight automation must update
`docs/ipad-testflight-validation-loop-plan.md` and avoid committing secrets, profiles, certificates,
or generated API-key JSON.

---

## Dispatch — one global action authority plus product-local handlers

Global editor commands have one authority and one dispatcher:

1. `widgets/action-surface/ui/ShortcutHelpOverlay.tsx` is the top capture-phase modal owner for
   `Escape` while help is open.
2. `widgets/action-surface/model/editor-actions.ts::editorActionRegistry` owns every global action,
   its primary/alias shortcuts, availability, label, keywords, and execution intent. This includes
   command palette, rename, tool activation, panels, opacity, frame navigation, zoom, grid, and
   `file.save`.
3. `widgets/action-surface/ui/ActionSurface.tsx::onKeyDown` is the capture-phase DOM adapter. It
   projects current context through `shared/actions/model/registry.ts`, resolves Kernel precedence,
   and executes the registered action. Palette/help/TopBar labels read the same definitions.

Product-local input remains deliberately separate after global resolution:

- `CanvasShell.tsx::onKeyDown` keeps Space pan/playback, preview/perform Escape, rulers, pixel grid,
  arrow nudge, and the active tool handler. It has no global tool/opacity/frame/zoom/grid fallback.
- Mesh and gradient overlays keep their active-feature document handlers.
- Timeline camera-cut controls claim their exact local chords with
  `data-editor-local-shortcuts`; touch/iPad and camera-cut behavior never becomes a global action.
- `LayersPanel` owns inline rename UI only; F2 and Mod+R request rename through the registered action.

Tool activation keys come only from `toolReachability` projected into `editorActionRegistry`.
`CanvasShell`'s handler list maps an already active tool to its product behavior; it is not a second
activation table.

**Invariants** (enforced by `scripts/check-architecture.ts`):

- **1 ToolId = 1 handler** (`collectToolRegistrations`); a 2nd handler for a tool is dead code
  (`handlers.find` takes the first).
- No feature→feature imports; `features/*/canvas/handler.ts` use a *local structural mirror* of the
  host API, never a cross-feature import.
- `createActionRegistry` (`shared/actions/model/registry.ts`) throws on **duplicate shortcuts at
  module init**, expanding both primary and alias shortcuts before collision checks.
- Each dispatcher gates on `shortcutHelpOpen` **independently** (not via propagation) — a new
  dispatcher must add that gate or it fires while the overlay is open.

**Blast-radius — adding a ToolId is a 5-place sync:** (1) `ToolId` union + (2) `editorTools` in
`features/tool-selection/model/tools.ts`; (3) a `features/*/canvas/handler.ts` with a **string-literal**
`tool:`; (4) `ACTIVATABLE_TOOL_IDS` / `UNAVAILABLE_TOOL_IDS` and (5) the `toolReachability` shortcut,
both in `widgets/tool-rail/model/tool-reachability.ts`. Miss one → fails `check:arch`, throws at
registry init, or leaves the tool silently unreachable. `M` (motion-path) / `E` (effect) are
display-only metadata today — the keys are **DEAD**. Tool activation writes go through the command
bus like any mutation (see *Command bus*).

---

## Selected-object and structure actions — action spine vs panel workflow

High-frequency object operations are mid-migration from Widget-local decisions to a shared Feature
planner. There are **three overlapping planners**:

1. `features/structure-actions/model/selected-object-actions.ts::planSelectedObjectActions` — the
   shared selected-object spine. It plans delete, duplicate, lock/unlock, show/hide, rename intent, and
   focus-artboard from a `SceneDocument` + selection snapshot. Results carry enabled/disabled state,
   typed issues, undo metadata, next-selection instructions, and either scene commands, a clipboard
   duplicate factory input, or a rename UI intent.
2. `widgets/layers-panel/model/workflow-actions.ts::planLayerWorkflowActions` plus
   `workflow-clipboard.ts::planLayerWorkflowClipboardActions` — Layers workflow buttons for copy,
   duplicate, paste, delete, grouping, and component instance/source/detach. It also carries
   cross-store companion commands for component instance motion and grammar binding clones.
3. `widgets/layers-panel/model/{row-actions,artboard-actions}.ts` — row-scoped
   artboard/layer/node adapters: inline rename command creation, feature-planned reorder, and
   row-local selection cleanup. Artboard-row focus/duplicate/remove/role/reorder delegate to
   `features/artboard/model/workflow.ts::{buildFocusArtboardRowCommand,buildDuplicateArtboardRowCommand,buildRemoveArtboardRowCommand,buildSetArtboardRoleRowCommand,buildMoveArtboardRowCommand}`.
   Layer-row visibility/lock delegate to
   `features/layer-hierarchy/model/layer-row-actions.ts`; layer/node row reorder and drag/drop
   command creation also route through that feature planner. Row mask use/release delegate to
   `features/structure-actions/model/mask-actions.ts`; node-row delete/lock/hide use the selected-object
   spine for scene command planning.

`widgets/action-surface/model/editor-actions.ts` already consumes the selected-object spine for
workflow delete/duplicate, lock/hide, focus-artboard, and rename through `executeSelectedObjectAction`.
Rename is a two-step UI intent: the spine returns `RenameSelectedNodeIntent`, ActionSurface publishes it
to `features/structure-actions/model/rename-request-store.ts::useSelectedObjectRenameRequestStore`, and
LayersPanel consumes the request to open its inline editor. `ActionSurface` opens LayersPanel first if
it is closed, so command-palette rename, `Mod+R`, and the `F2` alias no longer depend on LayersPanel
already being mounted. LayersPanel still owns the inline editing UI and commit command creation.
`widgets/canvas-shell/ui/CanvasShell.tsx` also consumes the spine for context-menu duplicate/delete
and lock/hide, then adapts duplicate factory input through the clipboard feature, single scene commands
through the command bus, and multi-command lock/hide plans through
`features/structure-actions/model/workflow-transaction.ts::selectedObjectWorkflowTransactionCoalesceKey`.
`widgets/layers-panel/model/workflow-actions.ts` consumes the spine for the workflow delete button and
adapts the selected-object issues back into Layers workflow report issues.

**Invariants/gaps:**
- The shared selected-object planner is store-free and must stay usable by canvas menus, command
  palette, layer rows, and future contextual bars.
- Duplicate in the selected-object spine intentionally returns a clipboard command-factory input so
  the clipboard feature remains the source of truth for cloning and id remap.
- Layer workflow component-instance actions are not just scene commands; they may apply scene, motion,
  and motion-grammar commands under one compound id. Do not flatten those into the selected-object
  spine without preserving global undo.
- Row actions are allowed to remain row-scoped, but global actions such as rename/delete/lock/hide must
  not depend on LayersPanel being mounted.
- LayersPanel drag/drop still owns pointer lifecycle, DOM hit testing, and indicator rendering; command
  creation after a valid drop target belongs to `features/layer-hierarchy`.

**Blast-radius:** selected-object action rewiring touches `features/structure-actions`,
`widgets/action-surface`, `widgets/layers-panel`, and sometimes `widgets/canvas-shell`. Keep one
authoring flow per loop. If the change reaches command-bus transaction semantics, stop and use the
Command bus section.

---

## Inspector transform authoring — read model vs write policy

The docked Inspector rail and floating HUD share the same transform/opacity authoring read model:
`widgets/inspector/model/authoring-controller.ts::inspectorAuthoringReadState`. It wraps
`features/motion/model/inspector-keyframing.ts::inspectorKeyframeActionState`, snaps the authoring
frame, and carries the recording state that the UI displays. `InspectorPanel` and `FloatingInspector`
should consume this controller contract instead of calling the motion keyframe selector directly.

Writes for single-node transform, opacity, text-box dimensions, keyframe diamonds, and pivot presets go
through the same controller file: `planInspectorNumberEdit`, `planInspectorKeyframeEdit`,
`planInspectorAnchorPresetEdit`, and `executeInspectorAuthoringPlan`. Those planners decide whether a
change is a scene rest-state command, a motion keyframe command, a noop, or a disabled stale edit. The
UI should render controls and dispatch commits; it should not decide recording/autokey vs scene writes.

**Invariants/gaps:**
- `features/motion/model/inspector-keyframing.ts` remains the owner of bindable motion field state,
  sampled values, stale keyframe guards, and motion command generation.
- `widgets/inspector/model/authoring-controller.ts` is the Widget-owned adapter that combines scene,
  motion, selection, transport, and effect-authoring contracts into Inspector authoring plans.
- Multi-selection text-box, typography, appearance, frame-look, and graph-node controls still have
  specialized commit helpers; move only one authoring flow at a time into the controller.

**Blast-radius:** transform/opacity/pivot authoring affects both `InspectorPanel` and
`FloatingInspector`. Do not mix this with broad appearance UI work or command-bus transaction changes.

---

## Command bus — mutation, transactions, undo/redo

**THREE parallel Immer-patch command buses**, each a Zustand store with the identical
`apply / beginTransaction / commit / abortTransaction / undo / redo` API, arbitrated by one
cross-store coordinator. **This is the corruption-critical seam** — per CONTRIBUTING.md every confirmed
document-corruption defect to date came through here; it gets full adversarial review on any change.

- Scene bus (source of truth): `entities/scene/model/store.ts::useSceneStore`.
- Mirror buses: `entities/motion/model/store.ts::useMotionStore`,
  `entities/motion-grammar/model/store.ts::useMotionGrammarStore`.
- Command contract: `entities/scene/model/command.ts::SceneCommand` (= `CommandMeta & { run(draft) }`).
  `CommandMeta` carries `coalesceKey`, `compoundId`, `layoutReapply`.
- Pure patch generator: `entities/scene/model/runner.ts::runSceneCommands` — store-independent
  (also the agent headless writer). Emits `{document, changed, patches, inversePatches, issues}` and
  does **in-boundary layout + blend reapply** (`reapplyLayoutFrames…`, `reapplyAffectedBlendNodes…`)
  in the same transaction, so undo reverts geometry + its derived consequences atomically.
- Gesture wrapper: `entities/scene/model/gesture-transaction.ts::{begin,commit,abort}GestureTransaction`.
- Global undo: `features/history/model/undo-coordinator.ts::globalUndo` — picks the store whose
  top entry has the largest `seq` (`shared/history/sequence.ts::nextHistorySeq`); a shared
  `compoundId` fans the undo across all three buses atomically.

**Flow:** non-transactional edit → `useSceneStore.apply(cmd)` → `runSceneCommands` → if `changed`,
`appendHistory` (coalesce). Gesture → `beginGestureTransaction` (mints `coalesceKey = ${scope}:${id}`)
→ N × `apply` accumulate into `transaction.patches` → `commitGestureTransaction` appends **one** entry;
`abort` replays `inversePatches`.

**Invariants & gaps:**
- **Single-writer** — `features/**` must not raw-write document stores. Enforced by
  `check-architecture.ts::documentStoreBypassPattern` =
  `/\b(useSceneStore|useMotionStore)\s*\.\s*(setState|getState().document=)/`. **GAP (review-only):**
  the regex does **not** cover `useMotionGrammarStore`, nor nested writes like
  `getState().document.layers.push(...)`. Treat those as manual-review surfaces.
- **1 gesture = 1 undo** via unique per-gesture `coalesceKey` + single commit — *not* a depth counter
  (the old `openGestureDepth` name is **stale/gone**).
- **Stale commit/abort ignored** — coalesceKey identity check, so an interrupted handler can't seal a
  newer gesture.
- **Undo replays patches, never re-runs the command body** — commands may mint ids safely.
- **Scene `undo` does NOT auto-seal an open transaction** (host owns teardown); **motion `undo` DOES**
  (`if (get().transaction) get().commit()`). Do not assume symmetry.
- **Two coalescing mechanisms, don't conflate:** (1) history coalesce by equal `coalesceKey` in
  `appendHistory`; (2) one held transaction (recipe/slider drags via
  `widgets/inspector/model/frame-look-editing.ts::beginRecipeNumberGesture`, stable
  `recipe-scrub:${field}:${seq}` key; **rAF-drain is the caller's job**). Inspector edits go through
  `widgets/inspector/model/editing-shared.ts::applyCommandsAsTransaction` (stable key merges a drag;
  `nextCommitKey` = discrete).

**Blast-radius:** changing `CommandMeta` ripples to all three buses + `undo-coordinator`; a new bus
that wants global undo must stamp `seq` and register in `undo-coordinator.ts::coordinatedStores`.
Layout-relevant node fields must be added to the runner's reapply heuristics or undo strands derived
caches. Gate: `bun run check` (`tsc -b` + `check:arch`).

---

## Scene model — document shape, FROZEN contracts, serialization

`entities/scene/model/` is large (it also hosts commands, look-graph, appearance…); this covers only
the document-shape / FROZEN / serialization seam.

- Shape SSOT: `types.ts` — `SceneDocument → SceneLayer[] → VectorNode[]` (nodes recurse via
  `children`; artboards are a sibling axis). All fields `readonly`; everything beyond
  `artboard`/`layers` is **optional + additive** (migration-free). Node type is **`VectorNode`** —
  there is no exported `SceneNode` *type* (`SceneNode` is a React component in `SvgSceneNode.tsx`). Typography
  lives on `types.ts::TextStyle` (`italic?`/`underline?` optional). `SCENE_SCHEMA_VERSION = 1`.
- Seed: `seed-scene.ts::initialSceneDocument` (+ `allSceneNodes` = static flatten of the *seed only*).
- Read helpers over an arbitrary document: **`selectors.ts`** — `findNode`, `allNodes` (general
  recursive traversal), `findLayerByNodeId`, `isTopLevelSceneNode`. *(`findNode` lives here, not in
  `types.ts`/`seed-scene.ts`.)*
- Serialization: `serialization.ts` — two-layer versioned envelope
  (`SERIALIZED_SCENE_DOCUMENT_KIND`/`_VERSION` wraps `SceneDocument.schemaVersion`); `isSceneDocument`
  guard accepts future optional fields; `canonicalize` drops `undefined` for stable diffs.

**FROZEN contracts** = a named set where **only additive changes are allowed**; any edit triggers full
adversarial review + a **manual git-diff review** merge-gate step. **There is NO `check:frozen` script,
no CI workflow, and no git hook** — enforcement is human discipline, backstopped only by `tsc` (a
breaking change breaks consumers) and the reference-scene freshness gate. The frozen surface list is:
**`entities/scene` types + store, `entities/motion` types,
`registry.ts` HandlerApi/ToolHandler, selection + viewport stores.**

**Blast-radius — editing scene types/serializer:** must regen reference fixtures
(`bun run gen:reference-scenes`, gated by `check:reference-scenes-fresh`); persisted-document round-trip
(`App.tsx` autosave/restore, `features/project-backup`) depends on additive-only evolution; the
`SceneNode` renderer requires the `assets` prop threaded from `SceneDocument["assets"]`; agent writes
resolve nodes via `entities/agent/model/write.ts::requireSceneNode`.

---

## Scene camera / projection — authored camera space

Entry points:

- Contracts: `entities/scene/model/types.ts` owns `SceneCameraRigContract`,
  `SceneDepthPlaneContract`, `MotionParentBinding`,
  `Artboard.activeSceneCameraId`, and `SceneDocument.sceneCameras`.
  `entities/motion/model/types.ts` owns `MotionDocument.cameraTracks` and
  `MotionDocument.cameraCuts`.
- Resolver: `entities/scene/model/scene-camera.ts` resolves active camera,
  hard/crossfade camera cuts, sampled camera tracks, depth planes,
  depth-of-field layer-blur approximation,
  projection issues, projected world matrices, renderer-local matrices, and
  crossfade presentation scenes with duplicated synthetic ids. Its batched
  target-point resolver is also the authoring read source, so Inspector/canvas
  coordinates cannot diverge from presentation transforms.
- Commands/read-models: `entities/scene/model/scene-camera-commands.ts`,
  `entities/motion/model/camera-commands.ts`, and
  `entities/scene/model/scene-camera-authoring.ts` own the mutation/read seams
  that Inspector, Layers, Timeline, and agent/MCP code must call. The feature
  facade is `features/scene-camera/model/authoring.ts`.
- GUI composition: command-palette actions live in
  `widgets/action-surface/model/editor-actions.ts`; Inspector camera/depth
  controls live in `widgets/inspector/ui/InspectorPanel.tsx`; Layers camera
  identity rows live in `widgets/layers-panel/ui/LayersPanel.tsx`;
  `widgets/timeline/ui/TimelinePanel.tsx` passes selected camera identity into
  `features/motion/ui/timeline-adapter.ts`,
  `features/motion/ui/TimelineTracks.tsx`, and
  `features/motion/ui/EasingPicker.tsx` so Timeline can render and edit real
  camera side-car lanes.
- Selection: `features/selection/model/store.ts` has a dedicated
  `sceneCamera` channel for camera rigs, camera body/target handles, and
  motion/null controllers. Do not represent camera rigs as fake vector node ids.
- Presentation integration: `entities/motion/model/presentation.ts` applies
  camera projection to the sampled presentation scene; crossfade cuts blend
  previous/current projected camera frames; source scene documents keep authored
  camera/depth intent, not sampled matrices.
- Playback: `features/motion/canvas/overlay.tsx` switches to the rich
  presentation-scene path when an active scene camera is present.
- Authoring overlay: `features/scene-camera/canvas/overlay.tsx` is auto-mounted
  by `widgets/canvas-shell/ui/CanvasShell.tsx`'s overlay glob and paints
  camera target/body relation plus selected/camera-scoped depth badges.
- Canvas handles: `features/scene-camera/canvas/handles.ts` owns body/free-target
  depth/orientation/focus/aperture hit testing and drag-plan creation;
  `CanvasShell.tsx` only wires pointer capture and commits the resulting
  scene-camera authoring plan.
- Export: `features/export/model/artboards.ts` must preserve
  `Artboard.activeSceneCameraId` when scoping artboards; `features/export/model/bundle.ts`
  writes the `sceneCamera` manifest summary; `widgets/top-bar/model/export-report.ts`
  turns projection issues into export report rows.
- Runtime integration: `entities/scene/model/scene-camera.ts::sampleSceneCameraPresentation`
  returns the projected scene and `none | invalid | single | crossfade` camera
  sidecar from one resolution pass. `entities/motion/model/presentation.ts` carries
  it into export presentation. `features/export/model/runtime-player-control.ts`
  owns the renderer-neutral request queue, snapshots, hooks, and ephemeral
  overrides; SVG `code.ts` and `webgl-player-runtime.ts` own only renderer commit.
  `entities/scene/model/sequence.ts::resolveSequenceFrameAddress` is the sole
  global-frame to item/artboard/local-frame resolver. Sequence adapters pass the
  resolved artboard into presentation sampling; `artboards.ts::scopeSceneToArtboard`
  narrows only the renderer-facing scene after sampling. `runtime-react-template.ts`
  owns the generated SVG/WebGL React mount, callback relay, mutable controls,
  snapshot hook, and cleanup lifecycle.
  `runtime-player-declarations.ts` and `runtime-manifest.ts` pair every module with
  `.d.ts` and `playerApi` discovery metadata. Regenerate both sampler snapshots and
  `webgl-player.generated.ts` when those dependency graphs change.
  `scripts/generate-camera-runtime-verification.ts` emits the generated-artifact
  SVG/WebGL single/sequence matrix, mixed-size surface cut, React lifecycle
  harness, and browser trace under `artifacts/camera-runtime-verification/`.
  The completed design and verification decision are recorded in
  `docs/camera-runtime-library-integration-loop-plan.md`.

**Invariants:** authored scene camera is not `features/viewport/model/camera.ts`.
Do not store sampled renderer matrices in `SceneDocument`. Camera tracks and
camera cuts are non-node side-cars; Timeline rows, cut lane, and easing/retime
commands must operate on `MotionDocument.cameraTracks` / `MotionDocument.cameraCuts`,
never sentinel node ids such as `"__camera"`.
Camera projection and camera selection must fail/read as typed states instead of
silently flattening unsupported true-3D cases or stale authoring references.
Free target points are world-space and controller-bound target points are
controller-local offsets. Target-null creation and binding removal must preserve
the effective world point atomically through the command bus. Inspector must
name artboard fallback and cut-resolved frame camera states separately.

**Blast-radius:** changing camera/depth contracts touches FROZEN scene/motion
types and requires manual diff review before landing. Changing camera authoring
commands can affect Inspector, Layers, Timeline, MCP/agent editing, undo/redo,
and export reports. The current admitted output is screen-facing 2.5D
`svg-affine`; Motion/Code and generated WebGL player exports consume it through
the shared presentation sampler. Camera body rotateX/rotateY/roll,
focusDistance/aperture, normalized CoC DOF facts, depth-driven DOF layer blur,
and compact hard/crossfade camera cuts are authored/rendered data; crossfade is
a projected-frame blend rather than camera-matrix interpolation. Exact optical
bokeh, perspective-correct tilted cards, true camera-space gizmo math beyond the
current snap/fine/axis/HUD handles, and NLE-grade camera-cut management remain
later surfaces. External 3D/code asset import preserves source/preview/fidelity data;
eligible GLB/GLTF preview renders through the shared transparent Babylon Engine/Scene/Canvas
(`shared/babylon`, `entities/scene/model/runtime-3d.ts`), not a Three.js canvas overlay;
code-module preview remains sandboxed iframe-only.

---

## General motion relationships — camera-independent controller rigs

Entry points:

- Domain resolution: `entities/scene/model/motion-relations.ts` validates and
  resolves controller ancestry, bind matrices, structural local/world matrices,
  child-local sampled motion, renderer-local matrices, and deterministic typed
  fallback. It owns the relation math; camera code only consumes its materialized
  presentation scene.
- Commands: `entities/scene/model/motion-relation-commands.ts` plans keep-world
  bind and pose-preserving detach writes. `features/motion-parenting/model/authoring.ts`
  composes Scene and Motion commands, current-frame sampling, selection changes,
  transactions, and compound undo.
- Mutation integrity: `entities/scene/model/{node-commands,component-symbols}.ts`
  and `features/clipboard/model/clipboard.ts` own id remap/drop behavior for
  artboard, component, clipboard, and duplicate flows. Controller deletion fails
  closed while live external children reference the deleted subtree.
- Presentation: `entities/motion/model/presentation.ts` samples ordinary node
  motion first; `entities/scene/model/scene-camera.ts` then materializes general
  relations before camera projection. Relation metadata is restored after
  presentation transforms are materialized so downstream consumers retain
  identity without evaluating the relation twice.
- GUI: action ids and command-palette reachability live in
  `widgets/action-surface/model/editor-actions.ts`; precise parent/detach and
  controller-child navigation live in `widgets/inspector/ui/InspectorPanel.tsx`;
  Layers shows controller/relation identity; the auto-mounted
  `features/motion-parenting/canvas/overlay.tsx` paints selected controller and
  relation authoring chrome.
- Delivery: canvas, client SVG/PDF, Worker still SVG, Motion / Code, and generated
  WebGL runtime consume the shared presentation relation result. Export bundle
  and preview manifests surface relation issue codes. Controller geometry is
  selectable editor structure but is omitted from exported paint and GPU display
  lists.
- Agent writes: `entities/agent/model/write.ts` validates missing/self/cycle/
  cross-artboard targets through the same relation contract before compiling
  `set-motion-parent` commands. Frame-aware headless bind/detach uses the shared
  keep-pose planner and coordinates Scene + Motion as one compound undo.

**Invariants:** `motionParent` never changes structural Layers ownership. A
relation is same-artboard affine 2D and has one parent per child. Evaluation order
is structural layout -> local node motion -> motion relation -> scene camera.
Bind and detach must preserve the current presentation pose. Child-local motion
remains independently authorable; controller motion is never copied into every
child track. Missing parents, cycles, malformed binds, singular matrices, and
unsupported scope return typed issues with a deterministic structural-pose
fallback instead of silent loss. Exact sampled affine output is held in a
presentation-only matrix; authored and serialized node transforms remain TRS.

**Blast-radius:** the relation fields live on the FROZEN Scene contracts, so
contract edits require manual diff review. Resolver or presentation dependency
changes require `bun run gen:runtime-sampler`. Command changes affect cross-store
undo, Inspector, action surface, agent writes, duplicate/remap, delete safety,
canvas, client/Worker export, and runtime parity. Constraints, weighted parents,
IK, and cross-artboard controller space are separate contracts rather than flags
on this relation.

---

## Transform and property constraints — partial-channel relationships

Entry points:

- Contract/resolution: `entities/scene/model/types.ts` owns
  `TransformConstraint` and `PropertyRelation`; `scene-constraints.ts` validates
  source identity, property registry addresses, scope, cycles, evaluation order,
  coordinate spaces, offsets, strength, and numeric mappings.
- Commands: `scene-constraint-commands.ts` plans add/update/remove writes through
  the Scene command bus. Clone/delete/remap and serialization are handled beside
  other Scene references.
- Presentation: motion relation dependency resolution orders constraints with
  ordinary local motion and rejects a target that also carries `motionParent`.
  Relation metadata is stripped during materialization and restored afterward so
  render/export adapters do not evaluate it twice.
- GUI/Agent: Inspector authors source/channels/strength/space/offset and numeric
  property maps; Layers shows relation badges; Agent types, guards, compiler,
  schema, and readback expose the same identities.

**Invariants:** full-transform parenting, partial transform following, and
numeric property mapping remain distinct typed domains. V1 is one source per
relation, same-artboard, 2D position/rotation/scale, and registry-backed numeric
properties only. Cycles, missing sources, cross-artboard links, and ambiguous
full-parent ownership fail closed.

**Blast-radius:** contracts live in the FROZEN Scene node shape. Changes affect
serialization, clone/delete/remap, command history, Inspector/Layers, Agent/MCP,
presentation ordering, every renderer/exporter, and generated runtime samplers.

---

## Scene assets / imported media — document assets + placed nodes

Entry points:

- Contracts: `entities/scene/model/types.ts` owns `SceneMediaSource`,
  `ImageAsset`, `VideoAsset`, `ExternalSceneAsset`, `SceneAsset`, and
  `ImageGeometry`. The asset union covers image/video plus external scene,
  model-3D, and code-module metadata.
- Helpers: `entities/scene/model/assets.ts` resolves image/video/external asset
  sources, hrefs, placement, preview metadata, crop metadata, and missing-asset
  fallback states.
- Commands: `entities/scene/model/node-commands.ts` owns imported payload
  append, image/video placement, asset replacement, and cleanup. Asset placement
  should route through these commands or a future sibling command, not direct
  mutation of `SceneDocument.assets`.
- Rendering: `entities/scene/model/rendering.ts`, canvas/export renderers, and
  `widgets/canvas-shell/ui/ExternalAssetRuntimePreviewLayer.tsx` consume the
  document asset metadata while node geometry remains the placement source of
  truth. Eligible GLB/GLTF previews default to one shared, transparent Babylon
  Engine/Scene/Canvas (`shared/babylon`, `entities/scene/model/runtime-3d.ts`):
  one `AssetContainer` is cached per exact source and instantiated per
  placement, the adapter renders only from immutable `samplePresentation()`-derived
  plans and waits for shader readiness, and no Babylon-owned clock is ever
  handed over (`scene.animationsEnabled` stays `false`) — this replaced the
  earlier lazy Three.js overlay. HTML/code-module previews use an iframe
  sandbox without same-origin access.
- Linked Blender production (internal; S0–S4, S3v visual-acceptance gate
  reached 2026-08-06 for one hero scene — see
  `docs/knowledge/blender-vecmo-s3v-acceptance-2026-08-06.html`):
  `entities/scene/model/{production-link,production-artifacts,
  production-link-protocol,production-control,camera-channel-expression}.ts`
  own the `.blend` link contract. `production-link.ts` strictly parses
  `ExternalProductionLink` (allowlisted binding descriptors only — no
  data-path, no arbitrary Python, no absolute path) and its `PublishedControl`
  union; callers never bare-spread the payload. `production-artifacts.ts` is
  the SINGLE derivation of the build key shared by the browser feature store
  and the Bun companion, so the two canonicalizations cannot diverge.
  `production-control.ts` and `camera-channel-expression.ts` resolve a
  published control / camera-channel expression to a sampled number, never a
  fabricated `0` on an unresolved reference. `production-link-protocol.ts`
  owns the typed loopback WS protocol and the monotone editor-binding fence
  (`bindingEpoch` non-decreasing per owner) that lets a legitimate relink
  advance mid-session without permanently rejecting the paired companion.
  `features/blender-link/**` owns the visible per-link lifecycle and never
  writes `SceneDocument` directly — every durable change goes through
  `scene/link-production`/`scene/unlink-production` on the Scene command bus.
  `scripts/blender-link-companion*` is the local Bun loopback server plus
  Blender CLI adapter; it never saves the user's `.blend` in a normal build.
  Product-facing status boundary: `docs/product-knowledge/blender-linked-production.md`.
- Audio lane (S5a, internal): `entities/scene/model/audio.ts` owns pure,
  frame-anchored timing math (`AudioAsset`, `SceneDocument.audioTracks`,
  `AudioTrack.offsetFrames`) with no DOM/AudioContext dependency, so both
  `features/audio-preview` (headless WebAudio preview) and
  `features/export/model/audio-mix.ts` (`OfflineAudioContext` → mediabunny
  `addAudioTrack`) import the SAME timing helper and cannot drift onto two
  offset conventions. Audio failure is fail-open for audio only: export
  degrades to a video-only WebM with a typed issue.
- Operational guide: `docs/scene-camera-agent-asset-performance-loop-plan.md`
  records the first MCP/agent path for camera rigs plus imported/code asset
  loading, placement, preview, and fidelity reporting.

**Invariants:** document assets are source metadata; node geometry owns editable
placement. Missing asset references must render/export deterministic fallbacks
or typed fidelity issues. Do not treat externally generated code or 3D assets as
ordinary images unless the preview/fallback status is explicit. Do not execute
agent-authored code outside the explicit sandboxed preview contract.

**Blast-radius:** extending `SceneAsset` or `NodeGeometry` touches FROZEN scene
types and serialization. Any code/3D asset runtime support must also touch
rendering, export fidelity reports, agent command schemas, and product
knowledge. If the sandbox/runtime contract changes, review the canvas overlay,
export fallback, and MCP capability summary together.
Linked Blender production changes additionally require review of: the
`entities/scene/model/production-*.ts` FROZEN additive contract (manual diff,
backup compatibility); the companion protocol version and its 4-place agent
mirror when a new command kind is added (`production-control-commands.ts` and
`camera-expression-commands.ts` in the `AgentMotionCommand` union, compiled in
`write.ts`, narrowed in `contracts.ts`, schema'd in `scripts/vma-agent-mcp.ts`);
the monotone binding-epoch fence whenever bind/relink/rebind ordering changes;
and `docs/product-knowledge/blender-linked-production.md` for the
internal-status claim boundary. Audio-lane changes additionally require
keeping `entities/scene/model/audio.ts` free of DOM/AudioContext imports so
`features/audio-preview` and `features/export/model/audio-mix.ts` keep sharing
one timing contract.

---

## Reproduction descriptor import - motion-production to Vecmo skeleton

Entry points: `features/reproduction-descriptor/model/input-contract.ts`,
`features/reproduction-descriptor/model/descriptor-import.ts`, and MCP
`load_reproduction_descriptor` in `scripts/vma-agent-mcp.ts`.

- Input: the app-local structural adapter for
  `forestone.motion-authoring-descriptor` (with the legacy
  `motion_reproduction_descriptor` name retained as a compatibility alias),
  especially `visibleRoles`,
  `cameraSpace`, `referencePacket.targetWindowSec`, and `acceptanceChecks`.
- Output: store-ready `SceneDocument`, `MotionDocument`, empty
  `MotionGrammarStoreDocument`, role-node id mapping, acceptance scaffold, and
  typed import issues.
- Camera-space mapping: non-`screen_2d` descriptors create Vecmo scene-camera,
  active-artboard camera, force-center target/null controller, and
  `VectorNode.depthPlane` assignments instead of flattening that intent into
  unrelated node tracks.
- Motion scope: initial tracks are only a reference-skeleton seed for known
  Gravity-style roles. Camera/target track claims remain issues until a
  descriptor provides numeric camera keyframes or a Vecmo primitive owns the
  mapping.
- Operational path: MCP agents pass a descriptor object or JSON path to
  `load_reproduction_descriptor`. The tool returns the full store-ready skeleton
  and maps descriptor issues into agent issues without mutating the live editor.

**Invariants:** this feature must not mutate stores directly and must not bypass
the scene-camera contracts. The input type is a product-local adapter boundary;
it must not import a former workspace package or fork the accepted external
schema names. It returns plain documents/artifacts; callers decide whether to
load them, save them, or write a reproduction attempt result.

**Blast-radius:** wiring this into top-bar Import, backups, reference scenes, or
agent/MCP apply paths will affect store loading, persistence, and product
knowledge. Keep exact-reference QA and broad Import UI out of this seam until
the descriptor-to-document mapping proves useful.

---

## Selection / transform / viewport — the geometry gesture layer

Highest-traffic subsystem; every geometry task lands here.

- **Selection:** `features/selection/model/store.ts::useSelectionStore` — `{nodeIds, primary, sub,
  selectedArtboardId}`. Node vs artboard selection is **mutually exclusive** (every setter clears the
  other). Hit-test: `features/transform/canvas/handler.ts::SelectToolHandler` calls
  `features/transform/model/geometry.ts::hitTestNodeId`
  → `entities/scene/model/spatial.ts::getSceneSpatialIndex` (WeakMap memoized per document identity).
- **Transform:** `features/transform/canvas/handler.ts::SelectToolHandler` owns all gesture state in a
  module `drag` var. Geometry math is pure in `features/transform/model/`:
  `geometry.ts` (`frameFromNodes`, `classifyHit`, `localBounds`→`getNodeLocalBounds`), `gestures.ts`
  (`moveMatrix`, `rotateMatrix`, `resizeSingleMatrix`, `groupResizeMatrix`, `MIN_SCALE`),
  `matrix.ts` (TRS, no shear). Overlay is presentation-only (`canvas/overlay.tsx::SelectOverlay`,
  `pointer-events-none`).
- **Two-store live drag:** overlays/preview write `features/transform/model/live-drag-store.ts::useLiveTransformStore`
  (`overrides` map, per-pointermove); the **scene document is written ONCE at pointerUp** via the
  command bus. `SceneNode` subscribes with a per-node selector returning stable `undefined` for
  uninvolved nodes → no mid-drag re-render.
- **Layout frame overlay:** `widgets/canvas-shell/ui/LayoutFrameCanvasOverlay.tsx` owns layout-frame
  grid overlay rendering, selected cell move/resize math, one-cell keyboard routing for layout-managed
  children, and the external drag path that starts on a layout-managed child before the overlay has
  captured selection. `CanvasShell.tsx` only collects targets, holds the live external-drag preview
  state, and wires root SVG pointer events into the exported helpers.
- **Viewport:** `features/viewport/model/camera.ts` (pure: `zoomAtPoint`, `MIN_ZOOM=2`,
  `MAX_ZOOM=6400`), `store.ts::useViewportStore`, `workspace-fit.ts` (chrome-aware asymmetric insets).
  Camera is **document-independent** — adding/moving artboards never changes `{zoom,panX,panY}`.
  Trackpad: `ctrlKey` pinch → cursor-anchored `zoomToAt`; plain two-finger → `panBy`.
- **iPad touch routing:** `widgets/canvas-shell/model/ipad-authoring-device.ts` is the shared
  iPad-like device detector. `pages/editor/ui/EditorPage.tsx` uses it to avoid mounting desktop
  ToolRail/ToolOptions/Layers/Inspector subtrees on iPad-like devices. `widgets/canvas-shell/ui/CanvasShell.tsx`
  owns the iPad quickbar action/account wiring, timeline/recovery entry actions, portable backup entry
  actions, and touch capture policy; `features/ipad-shell/ui/IpadAuthoringQuickbar.tsx` owns quickbar
  rendering, `features/ipad-shell/ui/IpadAppearancePanel.tsx` owns the compact Style panel, and
  `features/ipad-shell/ui/IpadQuickMenu.tsx` owns the QuickMenu surfaces themselves. Touch pointers on
  iPad-like devices are intercepted
  in capture phase for viewport pan/pinch and two/three-finger undo/redo; pan/pinch viewport writes are
  coalesced through `requestAnimationFrame`, with pointerup flushing the final movement before tap
  judgement. Pencil/pen input still reaches the registered draw handlers. Compact Style writes node
  appearance through `createUpdateNodeStyleCommand` and text typography through
  `createUpdateTextNodeCommand`; cloud recovery only navigates to `/projects`
  (with `history=<activeProjectId>` when attached). Do not move this policy into Swift or a feature
  slice unless the scene/selection/viewport command boundaries move with it.
- **iPad perf capture and visual diet:** `widgets/canvas-shell/model/ipad-perf-capture.ts` is the
  opt-in real-device diagnostic path behind `?ipadPerf=1` / `vma:ipad-perf`, with the compact readout in
  `widgets/canvas-shell/ui/IpadPerfHud.tsx`. It records only rolling timing/count metadata: frame
  deltas, pointer lanes, viewport writes, hover writes, render path, coarse complexity, and long-task
  totals. It must never persist or record scene contents, layer names, text, asset payloads, project IDs,
  or account data. `CanvasShell.tsx` also suppresses nonessential grid/guide/label/tool overlays while
  an iPad viewport gesture is active; keep the scene, iPad quickbar, and quick menu interactive.
  On the default SVG path, iPad camera gestures use an imperative world-`<g>` transform fast path and
  commit the viewport store at gesture boundaries. Do not enable that path for GPU canvas sessions
  until the GPU surface and SVG chrome can be moved under one synchronized camera contract.

**Invariants/gotchas:** group/Blend transforms stay in the **similarity class** (routed through
`groupResizeMatrix`, uniform only — the ungroup bake relies on it); degenerate (line/group) bounds come
from `getNodeLocalBounds` (recurses into children); handles are unpickable when hidden (`classifyHit`
gates on `handlesEnabled`); **snap precedence is FALL-THROUGH** — Snap-to-Point first, `if
(lock.snapped) return`, else Smart Guides (`entities/guides/model/snapping.ts`), grid is a
priority-10 guide candidate; `HostApi.selection` must be a **stable `useMemo` ref** built from scalar
selectors (a new array each render → `getSnapshot` crash). Tests: `matrix.test.ts`,
`geometry.test.ts`, `camera.test.ts`, `workspace-fit.test.ts`.

---

## Canvas render — the renderers and what keeps them in sync

The scene reaches pixels through **five render surfaces** (four SVG-family + one experimental GPU
surface). Keeping them consistent is a recurring bug source; the sync points below are the whole game.

1. **Editor SVG (React):** `widgets/canvas-shell/ui/CanvasShell.tsx` — `useSceneStore` →
   `samplePresentation` (`widgets/canvas-shell/model/presentation.ts`) →
   `widgets/canvas-shell/ui/SvgSceneNode.tsx::SceneNode` → `VectorShape` →
   `resolveCanvasRenderDocument` (`widgets/canvas-shell/model/presentation.ts`, async video
   materialization staleness guard) → `SceneNode` → `VectorShape` → SVG DOM. CanvasShell decides
   which artboard/layer/node groups render; `SvgSceneNode.tsx` owns geometry paint, mask, effect,
   scoped-look, text-fragment, image, and duplicate-ghost rendering. Emits the `data-node-id` /
   `data-render-part` attributes.
2. **Live playback overlay (imperative):** `features/motion/canvas/overlay.tsx` — bypasses React on
   every rAF, patches opacity/transform directly on `[data-node-id]` / `[data-render-part]` elements.
   `resolveCanvasPresentationFrame` **freezes** CanvasShell's frame during playback so the overlay owns
   the DOM. Stable source nodes reuse a root-keyed DOM-handle plan and skip byte-identical attribute
   writes; disconnected/replaced elements and generated-node identity changes invalidate the entry.
   `entities/motion/model/sampling-plan.ts` supplies the immutable-`MotionDocument`-keyed track index,
   sanitized numeric keys, cached animated-node set, and direct addressing for consecutive linear
   tracks. The document remains the timing truth; this is derived read state only.
3. **SVG export string:** `features/export/model/svg.ts::renderSceneSvg` — static string for
   PDF/sequence/preview; `deferGpuRasterEffects=true` when feeding the WebGL texture path.
4. **Embedded IIFE player (3rd renderer):** `features/export/model/code.ts::RUNTIME_PLAYER_SOURCE`
   (`String.raw`, **no backticks inside**) — self-contained JS shipped in exports; has its own inline
   `renderNode`/filter builder. Selects `MOTION_RUNTIME_SAMPLER_SOURCE` vs `…_CORE_SOURCE` via
   `motionCodeRuntimeFavorsCore`.
   *(WebGL player `webgl-player-runtime.ts` → `webgl-player.generated.ts` mirrors this renderer's event
   API and rasterizes the SVG export into a GPU texture — see *Look graph*.)*
5. **Experimental GPU canvas (flag-gated, E1):** `widgets/canvas-shell/ui/GpuSceneCanvas.tsx` +
   `widgets/canvas-shell/model/gpu-scene-frame.ts` + `entities/scene/model/gpu/{capability,display-list}.ts`
   + `shared/gpu/*`. Behind `?gpuCanvas=1`/`vma:gpu-canvas` (`shared/lib/gpu-canvas-flag.ts`), off by
   default; see `docs/product-knowledge/gpu-canvas-experimental.md` and
   `docs/gpu-canvas-convergence-e1-plan.md`. **Invariants:** (a) `computeGpuArtboardSupport` runs on the
   **committed** scene+motion documents ONLY — never live-drag overrides, never a `samplePresentation`-
   sampled document — so an artboard's GPU/SVG render path cannot flip mid-drag or mid-scrub (only on a
   committed edit); (b) it is a frame **READER**: it subscribes to stores and redraws imperatively, but
   never calls `transport.setFrame`/`advanceFrame` and never runs its own rAF loop —
   `features/motion/canvas/overlay.tsx::PlaybackDriver` stays the sole frame advancer; (c) SVG
   suppression for a GPU-active artboard is a single guard clause inside `CanvasShell.tsx`'s
   `canRenderArtboardNode` — artboard chrome (background rect/shadow, frame border, name label, grid)
   stays in SVG always; (d) every capability/geometry/paint predicate it uses is IMPORTED from the SSOT
   modules (`hasSubtreeCarrier`, `isWrapperContainer`, `canvasPaintsForStyle`, `getGeometryBounds`,
   `resolveFrameEffectIntent`, `resolveSceneMaskPlan`, path-conversion converters) — never a copied
   mirror, unlike renderer 4's hand-copies above; (e) `entities/scene/model/gpu/*` stays DOM-free AND
   **may not value-import `entities/motion`** (`check:arch`'s same-layer rank order: `scene` rank 1 <
   `motion` rank 3) — a motion-derived fact (e.g. an animated-opacity check) must be computed from a
   `MotionDocument` **type**-only import (exempt) using inline logic, never an imported function from
   `entities/motion/model/*`; (f) a legacy uniform stroke's on-screen width is NEVER baked into its
   extruded mesh — `strokeDrawForEntry` (`gpu-scene-frame.ts`) computes `halfWidthWorld = strokeWidth /
   2 / cameraScale` fresh every frame from the LIVE camera zoom and writes it as a per-draw dynamic-
   offset uniform (`shared/gpu/webgpu.ts::writeStrokeHalfWidthUniform`); the vertex shader
   (`STROKE_STENCIL_SHADER_SOURCE` in `quad-shader.ts`) adds `unitOffset * halfWidthWorld` to the
   already-world-space centerline position. This is what reproduces `non-scaling-stroke` (constant
   screen-pixel width at any zoom) — an E0 width-profile stroke is NOT this path; it is pre-expanded to
   a filled outline polygon by `getStrokeWidthProfileOutline` and painted through the ordinary solid-fill
   pipeline instead (`display-list.ts::buildOutlineEntry` returns `kind: "fill"`, never `"stroke"`);
   dashed legacy strokes share that screen-pixel contract and are admitted only by
   `capability.ts::isDashableGeometry` (native un-rounded rect fast path, `line`, all-straight
   `path`, or sharp `polygon`/`star`, butt cap, normalized pattern length ≤ 8), while SVG path cap/join parity is owned by
   `style-presentation.ts::strokePresentation` and `CanvasShell.tsx::renderVectorGeometry`;
   (g) **image/untransformed mesh paints (E1 S5/S23)** resolve through an async texture cache owned INSIDE
   `shared/gpu/webgpu.ts` (`texture-cache.ts`) — a synchronous cache HIT returns a `GPUTexture`
   immediately, a MISS kicks off exactly one `createImageBitmap` + `copyExternalImageToTexture` load and
   **skips that one draw for this frame** (never blocks the frame), calling `onTextureReady` once
   resolved so `GpuSceneCanvas.tsx` schedules exactly one more redraw — a mesh-gradient paint additionally
   rasterizes (synchronously, CPU-side) through the SAME `widgets/canvas-shell/model/mesh-raster-bridge.ts`
   singleton the SVG renderer already calls, so GPU/SVG mesh bitmaps stay cache-shared and pixel-identical;
   S21/S22 image parity is owned by `display-list.ts` carrying `GpuPaint.fit` / `GpuPaint.sourceRect`
   and `webgpu.ts`/`quad-shader.ts` remapping UVs from decoded texture dimensions and source crop
   metadata; tiled or transformed image paints still fail capability;
   `entities/scene/model/gpu/display-list.ts` therefore emits a THIRD paint shape
   (`GpuMeshPendingPaint`, distinct from `shared/gpu`'s `GpuPaint`) for an unrasterized mesh, resolved to a
   real `GpuPaint.kind === "image"` only in the widget layer (`gpu-scene-frame.ts`) — never inside that
   entities-layer compiler, which may not import the widgets-layer mesh-raster-bridge singleton; (h) static
   text rasterization (E1 S9.x) follows the same ownership rule: `display-list.ts` emits DOM-free
   `GpuTextPendingPaint` with `TextGeometry`, resolved solid/gradient/image/mesh fill facts, and folded
   opacity/blend mode, while `gpu-scene-frame.ts` alone touches browser Canvas2D, owns image decode/cache
   invalidation for image-text fills, shares the mesh-raster bridge for mesh-text fills, rasterizes at the
   zoom-bucket/DPR tolerance, and converts the result to `GpuPaint.kind === "image"` for the existing S5 texture path.
   `shared/gpu/*` stays unaware of text geometry, glyph measurement, and Canvas2D; (i) opaque
   linear/radial artboard backgrounds are NOT a scene-node concept and do not widen the RHI — solid
   backgrounds remain `GpuQuad`, while `gpu-scene-frame.ts` injects a gradient background as the first
   artboard-local `GpuFillDraw` so the existing cover shader owns the pixels; (j) polygon/star GPU
   support is only a display-list normalization step (`filletPolygonShape`/`starVertices` →
   `GpuDrawListEntry.contours`); sharp polygon/star dash rides the same contour order through
   `capability.ts::isDashableGeometry`, while rounded polygon/star remains a curved-path fallback;
   (k) line GPU support is stroke-only: `display-list.ts` emits an open two-point contour and skips
   fill/outline entries for `geometry.kind === "line"`; (l) `shared/gpu/webgpu.ts` keeps frame
   preparation (`prepareFrameDraws`) separate from ordered render-pass replay
   (`encodePreparedArtboards`), now replaying into an offscreen `sourceColorTexture` before a final
   swapchain composite pass so WGSL Look/effect passes can sample one shared SourceGraphic-equivalent
   texture without duplicating clip/stencil/blend logic. S17/S18/S20's first consumers are legacy
   frame film post effects: `gpu-scene-frame.ts` attaches ordered `GpuArtboardPostEffect[]` from the
   live `visualRecipe` projection, including projected effect-layer-stack authoring state when no
   explicit Look graph or influence mask is present; `webgpu.ts` writes one dynamic uniform slot per
   ready effect, and `quad-shader.ts` owns `CHROMATIC_ABERRATION_SHADER_SOURCE` plus
   `FRAME_FILM_GRAIN_SHADER_SOURCE` for the safe non-overlapping/non-overhanging frame-rect subset.

**Cross-renderer sync points (edit one → edit its mirror):**
- **`hasSubtreeCarrier`** (`entities/scene/model/appearance-targets.ts`, source of truth) has a hand
  copy `hasSubtreeCarrierNode` inside `code.ts::RUNTIME_PLAYER_SOURCE`. Decides the
  `<g data-render-part="subtree" opacity filter>` carrier vs a leaf `<shape data-render-part="paint">`.
  **Highest-risk manual mirror.**
- **`buildEffectFilter`** (`entities/scene/model/effect-filter.ts`) is the shared filter builder for
  renderers 1/2/3; renderer 4 (IIFE) has an inline copy. `style-resolve.ts` comment: "all three
  renderers feed `buildEffectFilter` identical input."
- **DOM contract** `shared/lib/svg-render-parts.ts::SVG_RENDER_PARTS` (`data-node-id`,
  `data-render-part`) — CanvasShell/export emit via `svgRenderPartAttributes` /
  `svgRenderPartAttributePair`, overlay queries via `svgRenderPartSelector`; break either side and live
  playback breaks. Use `cssQuotedAttributeValue` to escape node ids in selectors.
- **Paint bounds** `entities/scene/model/rendering.ts::getNodeLocalPaintBounds` is the single
  carrier/paint boundary used by both editor and export.
- **Compound paths:** editor/in-app SVG uses
  `entities/scene/model/rendering.ts::pathGeometryToSvgPath` / `svg.ts::compoundPathData`;
  the embedded IIFE renderer mirrors this in
  `code.ts::RUNTIME_PLAYER_SOURCE::pathForGeometry`. It must concatenate the
  primary contour plus every `geometry.subpaths` entry and preserve authored
  `evenodd`; otherwise Motion / Code silently collapses compound artwork to its
  first contour.
- **Grain sRGB:** `GRAIN_COLOR_INTERPOLATION`/`NOISE_FIELD_COLOR_INTERPOLATION = "sRGB"` per-primitive
  in `effect-filter.ts`, *plus* `colorInterpolationFilters="sRGB"` on CanvasShell's
  `FrameFilmGrainDefs`/`FrameChromaticAberrationDefs` `<filter>` (linearRGB washes the object out).

### Browser derived cache — persistent/parallel warm path

`shared/cache` owns browser-local derived-cache infrastructure: capability probing
(IndexedDB/OPFS/Worker/OffscreenCanvas/WebGPU/storage estimate), content-addressed
artifact keys/manifests, IndexedDB metadata/blob fallback, OPFS blob storage,
memory fallback, Worker request queue/runtime, sweep/clear, and telemetry. It is
scene-agnostic and must not import `entities`, `features`, `widgets`, React, or
Cloudflare Worker code.

`entities/scene/model/cache-keys.ts` is the scene-specific key builder. It hashes
scene content and caller-owned input subsets, but cache artifacts remain derived
data only. Do not use cache payloads as command history, document mutation input,
or serialization source of truth.

`widgets/canvas-shell/model/persistent-cache-client.ts` is the editor integration
point. `CanvasShell.tsx` schedules it after committed document/GPU-support changes
and marks it interaction-active during viewport pan/playback, so persistent reads
and writes stay off the Pencil/finger hot path. It currently warms layout and
Blend projections, then primes the existing `WeakMap` caches only after the stored
document hash matches the current scene. `CanvasShell.tsx` exposes derived-cache
clear in the no-selection iPad Quick Menu, and dev builds also expose
`globalThis.__vmaCanvasCache.snapshot()` and `.clear(kind?)`. Both clear paths
delete only derived artifacts, never project documents.

`widgets/canvas-shell/model/persistent-raster-cache.ts` is the synchronous-render
bridge for raster data URLs. Text rasters, mesh rasters, and frame-grain upload
sources first check memory, schedule OPFS/IndexedDB hydrate on miss, and write
freshly generated data URLs back through the same cache store without awaiting
inside render.

`widgets/canvas-shell/model/browser-cache-runtime.ts` shares the canvas-shell
browser store promise and cache Worker queue so layout/Blend warming, raster
hydration, and GPU draw-list persistence use one backpressure surface instead of
spawning independent Worker pools.

`widgets/canvas-shell/model/persistent-gpu-draw-list-cache.ts` persists
committed-scene GPU draw-list source artifacts keyed by sampled scene content,
active artboards, and tolerance bucket. Live transform overrides bypass this
cache so interaction preview remains source-of-truth driven.

`shared/gpu/texture-cache.ts` owns live `GPUTexture` lifetime and stale-safe
data-image upload-source persistence. It may persist `data:image/*` source bytes
as regenerable `image-decode` artifacts, but it must not persist `GPUTexture`
handles or treat external URL bytes as canonical document data.

---

## Motion / timeline / keyframes / materialization

- **Store (authoring):** `entities/motion/model/store.ts::useMotionStore` — a command bus (see above).
  **Playback never calls `apply`.**
- **Pure keyframe sampler:** `shared/glammer/keyframe-track.ts::sampleKeyframeTrack` (+ `…Vec`) — no
  DOM/React/Worker imports. AE interp codes: `6614` hold, `6612` linear, `6613` bezier (Newton + bisect).
  Snapshot props (shape/mesh/gradient) reuse it via `entities/motion/model/sampler.ts::easeProbe`;
  `interpolateShape` **holds on topology mismatch**.
- **High-level sampler:** `sampler.ts::effectiveTransform/effectiveOpacity/effectiveShape/…`;
  `animatedNodeIds` drives culling. `sampling-plan.ts` caches first-track lookup and numeric-track
  preparation in a `WeakMap<MotionDocument, …>`; consecutive sampler-equivalent linear keys use
  direct index interpolation, while general tracks retain the canonical keyframe sampler. Replacing
  the immutable motion-document identity is the invalidation boundary.
- **Playback math (pure):** `entities/motion/model/playback.ts::advanceFrame` (caps
  `MAX_DELTA_SECONDS=0.25`, loop-wrap vs clamp).
- **Timing templates:** `entities/motion/model/easing.ts::MOTION_TIMING_TEMPLATES` is the shared
  authoring vocabulary for keyframe-segment easing, motion-grammar profile timing, and Agent/MCP
  template ids. UI surfaces consume the registry through helper views:
  `motionTimingTemplatesForKeyframeSegment`, `motionTimingTemplatesForGrammarProfile`,
  `compileMotionTimingTemplateForKeyframe`, and `motionTimingTemplateKeyframeHoldOf`. Labels are
  conventional easing words (`Linear`, `Ease in`, `Ease out`, `Ease in-out`, `Snap hold`); richer
  concepts stay profile-contextual. Hold-key semantics live in the motion command bus, not in React.
- **Presentation (refresh/materialize-then-sample):** editor `entities/motion/model/presentation.ts::sampleMotionPresentationFrame`
  and export `features/export/model/render-presentation.ts::buildExportRenderPresentation` both call
  `refreshSceneBlendNodes` / `materializeLayoutFramesFor…` **before** sampling. Those projectors cache
  resolved Blend/layout scenes in `WeakMap`s keyed by immutable `SceneDocument` root identity, so repeated
  canvas/export/motion reads of the same document reuse the same projection and let old projections fall
  out with GC.
  `buildExportRenderPresentation` returns an inert
  `renderMotion` (`{automation: undefined, clips: [], tracks: []}`) so the renderer can't re-apply
  tracks.
- **Interactive engine:** `entities/motion/model/interaction-engine.ts::createInteractionEngine` —
  pure deterministic state machine (no DOM/`Date.now`/`Math.random`); states = clips; trigger → action
  → `PlaySegment`; emits `frame`/`clipStart`/`clipEnd`/`ended`/`stateChange`/`set-prop` for the host to
  apply.
- **Expression runtime / Cycle:** `entities/motion-grammar/model/expression-runtime.ts::sampleExpressionBinding`;
  `glammer-cycle-v1.ts::GLAMMER_CYCLE_V1` (the `Cycle` construct). Role resolution accepts both
  `nodeId -> roleKey` workspace maps and `roleKey -> nodeId` maps; non-primary roles (e.g. Cycle's
  Path) are excluded from primary body-family outputs.
- **Parametric path metrics:** `entities/scene/model/path-metrics.ts::sampleNodePathMetric` samples
  path-like scene nodes (`path`, `ellipse`, `rect`, `line`) into artboard-space point/tangent/angle
  data for expression-backed constraint motion. Keep this pure and renderer-free; expression/runtime
  export imports it transitively.

**Invariants:** `applyRenderFrame` (DOM-only, **must not** `engine.seek()` — would wipe an active
segment) vs `api.renderFrame` (seek + apply) are strictly separated in `code.ts`;
`installComponentPropsApi` receives `applyRenderFrame`, never `api.renderFrame`. `startLoop`/`stopLoop`
are the shared bodies of `api.play`/`api.pause`.

**Blast-radius:** editing `keyframe-track.ts`, `interaction-engine.ts`, `expression-runtime.ts`,
`entities/scene/model/path-metrics.ts`, or `entities/scene/model/layout-frame-presentation.ts` requires
**`bun run gen:runtime-sampler`** (they're
transitively bundled into `runtime-sampler.generated.ts` + `…-core.generated.ts`; gated by
`check:runtime-sampler`). Editing timing-template ids or payloads does not require sampler
regeneration unless the sampler dependency graph changes, but it does require syncing Timeline UI,
motion-grammar profile descriptors, Agent/MCP command schema, product knowledge, and any profile
that consumes a template-owned cubic. The materializer is shared by **3 surfaces** (motion
presentation, export presentation, `widgets/canvas-shell/model/presentation.ts`).

---

## Direct spatial motion paths — paired values + spatial side-car

Entry points:

- Contract: `entities/motion/model/types.ts` owns additive
  `MotionDocument.positionPaths`, `PositionPathTrack`, and `PositionPathKey`.
  Ordinary `tracks` targeting `x` and `y` remain the only position-value and
  temporal-easing truth.
- Resolution: `entities/motion/model/position-path.ts` pairs spatial keys to
  exact X/Y frames, resolves automatic tangents, checks duplicate/unpaired/
  invalid/timing-divergent metadata, and samples the cubic route. Invalid paths
  return typed issues and `sampler.ts::effectiveTransform` keeps scalar X/Y.
- Commands: `entities/motion/model/commands.ts` owns path enable, paired anchor
  writes, tangent/mode/roving edits, chord-length roving distribution, paired
  retime, removal, component copy, node retarget, and X/Y track cleanup. Existing
  Timeline retime and normal easing commands synchronize a spatial key's paired
  axes.
- Read/presentation: `motion-path.ts::buildMotionPath` exposes anchors, resolved
  tangents, modes, roving identity, and sampled polyline. `presentation.ts`
  promotes path problems into the ordinary motion issue stream consumed by
  export manifests/reports.
- GUI: command-palette enable lives in
  `widgets/action-surface/model/editor-actions.ts`; Inspector owns enable/edit/
  exact numeric tangent/auto/distribute/remove reachability; the Motion Path
  overlay directly edits anchors and handles, shows frame-spaced speed dots, and
  uses Shift/Alt plus double-click auto/roving gestures. Expanded Timeline mode
  owns sampled Value/Speed Graphs and exact temporal curve edit/copy/paste/
  split/join/fit/zoom through `TemporalGraphEditor.tsx` and `EasingPicker.tsx`.
- Agent: `observe_node` reports compact spatial-path identity; typed create,
  patch, and paired-retime commands stay synchronized across
  `entities/agent/model/{types,contracts,write}.ts` and `scripts/vma-agent-mcp.ts`.

**Invariants:** an SVG path is never motion truth. Spatial tangent vectors are
artboard-space offsets and never temporal easing handles. A spatial stop exists
only at a paired X/Y key frame; anchor drag, retime, component copy, and cleanup
move both scalar values plus metadata atomically. Local rotation/pivot and child
controller inheritance remain separate from route geometry. Sampling order is
position path -> local transform -> general motion relation -> scene camera.

**Blast-radius:** `MotionDocument` is FROZEN, so `positionPaths` changes are
additive-only and need manual diff review. Resolver/sampler changes affect canvas,
client/Worker export, Motion / Code, and generated WebGL runtime and require
`bun run gen:runtime-sampler`. Command changes affect Timeline undo/coalescing,
component propagation, orphan repair, Inspector, direct canvas gestures, Agent
validation, and the four-place Agent contract.

---

## Morph topology correspondence — ordered pathShape snapshots

Entry points:

- Truth and sampling: ordinary `MotionDocument.tracks` targeting `pathShape`
  contain full `BezierShape` snapshots. `sampler.ts::interpolateShape` pairs by
  array index and holds when counts/closed state are incompatible;
  `presentation.ts` surfaces topology mismatch as a typed issue.
- Pure repair: `entities/motion/model/morph-topology.ts` inspects track topology,
  splits the longest cubic at t=.5 without changing its curve, rotates a closed
  shape's array seam, and reverses winding while swapping in/out tangents.
- Commands: `commands.ts` applies count repair across one track or seam/winding
  edits to one exact key through the Motion command bus. No correspondence state
  exists outside the path snapshots.
- GUI: Inspector reports counts and writes repair/seam/winding. At an exact key,
  Direct Select paints current/adjacent ghost vertices and correspondence lines,
  selects a vertex, previews first/reverse/repair, then commits through Motion
  commands without introducing a second mapping schema.
- Agent: repair, first-vertex, and winding commands are synchronized through
  Agent types/contracts/compiler and the MCP Zod schema. Whole path keys remain
  writable through the existing `motion/upsert-keyframe` contract.

**Invariants:** index order is correspondence, index zero is the closed-path
first vertex, array direction is winding, and `closed` is a hard compatibility
boundary. Count repair may insert exact cubic split points; it may not delete
authored vertices, guess semantic features, or bake intermediate frames. Open
paths retain endpoint identity and cannot rotate their first vertex.

**Blast-radius:** changes to interpolation or path-key shape affect Timeline,
Direct Select diagnostics, Inspector, Agent, canvas, export, and generated runtime.
`morph-topology.ts` is authoring-only; edits to `sampler.ts` or its runtime
dependency graph require `bun run gen:runtime-sampler`.

---

## Look graph / effects / appearance

- **Data model (SSOT):** `entities/scene/model/look-graph.ts` — `LookGraph` DAG per `LookGraphOwnerRef`
  scope (`scene`/`artboard`/`node`/`scoped-overlay`), 27-variant `LookGraphNodeKind`,
  `LOOK_GRAPH_SCHEMA_VERSION = 1`.
- **Compiler:** `entities/scene/model/look-graph-compile.ts::compileLookGraph` → `LookGraphPlan`
  (topo-sort → per-node compile → fidelity tag: `native`/`approx`/`capture-only`/`runtime-only`/
  `deferred`/`unsupported`). `lookGraphPlanToEffectFilter(plan, …)` → `EffectFilterSpec | null`
  (**null-check before attaching a `<filter>`**). The GPU capability gate also reuses this null
  edge for explicit frame-level Look identity checks before falling back via `filter_or_look`.
  Options: `deferGpuRasterEffects` (GPU callers), `rasterSafe` (bake SMIL particles).
- **GPU raster path:** `entities/scene/model/look-graph-raster.ts` — `GPU_RASTER_KINDS` /
  `isGpuRasterNode` / `canGpuComposite` (single shared predicate, no divergence) / `rasterPlan` /
  `rasterSegment`. GPU-deferred nodes (lens, kaleidoscope, flow, halftone, pixel-grid, dither, ascii,
  mosaic, path-blur, noise-source, deep-glow, grain particle/mixed) render as fragment passes in the
  WebGL player after the SVG prefix.
- **Target-owned Deep Glow:**
  `entities/scene/model/gpu-raster-adapter.ts::buildScopedDeepGlowPlan` recognizes the deliberately
  narrow P1 contract: one direct Deep Glow graph whose targets equal every visible top-level node.
  `features/export/model/svg.ts::renderIsolatedNodeSetSvg` serializes those post-material targets
  against transparency while retaining earlier object Looks. It uses
  `entities/scene/model/source-optics.ts::sourceOpticsTargetResponsePresentation` to retain only each
  target's Surface/Diffusion/Edge/Spectral consequence while excluding the consuming graph,
  artboard background, frame Look, and source-owned Bloom/Ray/Atmosphere/Lens.
  `shared/gpu-lens/surface.ts::renderScopedGlow` runs that emission texture through the same
  linear-light smooth-threshold / weighted-pyramid / progressive tent reconstruction / exposure
  compositor as frame Deep Glow, but composites over a separate completed-artboard texture.
  The editor overlay and `features/export/adapters/video.ts` are the two callers. Never replace this
  source/base split with alpha-silhouette emission, the whole Source Optics presentation, direct
  coarse-level upsampling, or Canvas2D source-over. Partial selections, mixed scoped graphs, and
  coexistence with a frame GPU graph are fidelity-deferred, not implicit alternate representations.
  During editor playback only, `widgets/canvas-shell/model/static-raster-playback.ts` may admit the
  narrower transform-only/all-visible-target case. `CanvasShell` serializes one cropped post-material
  source per node once (admission caps the plan at 128 layers). A static Source
  Optics owner uses distinct cached base and emission SVGs: the base retains its
  source-owned optics, while the emission source keeps target responses but omits
  source-owned Bloom/Atmosphere so Deep Glow does not consume them twice;
  `shared/gpu-lens/surface.ts::prepareStaticComposition` retains bounded source
  textures and `renderStaticComposition` updates transform matrices into base/emission FBOs before the
  same Deep Glow kernel. Video, geometry/appearance/opacity animation, nested/blended/parented nodes,
  camera/grammar/automation/animated Source Optics, non-solid artboard fills, partial targets, and other
  unrepresented semantics fail closed to the existing full-frame base/emission SVG path. Playback
  resize buckets dispose only resolution-dependent targets; document/callback replacement, surface
  disposal, and context replacement dispose the source plan.
  `features/path-blur/canvas/object-composite-overlay.tsx` is globally registered
  but subscribes to the heavyweight sampled-SVG playback bridge only when the
  current artboard has an eligible scoped Path Blur target.
- **Primitives:** `entities/scene/model/effect-filter.ts::buildEffectFilter` → `EffectFilterSpec`
  (POJO, Workers-safe). `effectCanRenderVisibly` is the shared identity/no-op predicate for object
  effects and is also used by the GPU capability gate before treating a node as filter-bearing.
  `frame-look-visibility.ts` contains the live-canvas frame-recipe visibility predicate (film grain
  and chromatic aberration) that both CanvasShell and GPU capability use to distinguish neutral
  legacy frame recipes from renderable frame Looks. Mask gate uses `feComposite in/out +
  arithmetic` (exact lerp). `BACKGROUND_BLUR_DEFERRED_REASON` is surfaced, never silently dropped.
- **Appearance stack:** `entities/scene/model/appearance-stack.ts` (`readAppearanceStack`;
  `fill`/`stroke`/`effect` are ordered, `opacity`/`blend` are singletons); canvas paint adapter
  `canvas-paint.ts::canvasPaintsForStyle`; mask relations on `appearance.ts`.
- **Fidelity review targets:** `entities/scene/model/fidelity-issues.ts` owns stable target identity,
  target sorting, and source-path normalization for import/export review rows.
  `features/import/model/types.ts` and `features/export/model/issues.ts` keep their format-specific
  categories/copy, but share this target contract so source paths, scene ids, and roles do not dedupe
  differently. SVG/PDF export both use `sortedSceneFidelitySourcePaths` for imported appearance
  metadata before attaching `sourcePaths` to issues.
- **Style transfer / recipe paste:** `features/style-transfer/model/style-transfer.ts` captures
  `sourceBounds` at copy time and **refits gradient/mesh coords** into each target's bbox on paste.

**Invariants:** grain `material.mode === "particle" || "mixed"` both defer to GPU
(`look-graph-compile.ts`); the warp `feImage` displacement path IS SVG-native (works in browser/Worker/
export) — the "can't raster" limit is only the particle-SMIL `feImage` path under `rasterSafe`.

**Blast-radius:** look/effect changes touching the WebGL runtime require regenerating
`features/export/model/webgl-player.generated.ts` via **`bun scripts/generate-webgl-player.ts`**;
`bun run check:webgl-player` re-bundles the entry and rejects a stale committed snapshot. See
*Build, gates & generated artifacts*.

---

## Traveling layer mattes — reference-based appearance mask relations

Entry points:

- Contract and commands: `entities/scene/model/appearance.ts` owns consumer-side
  `AppearanceMaskRelationMetadata`, source node identity, alpha/luminance/RGB channel,
  pre/post-effect intent, artboard coordinate space, invert, feather, expand, and
  opacity. Use/release and per-relation writes stay on the Scene command bus.
- Resolution: `mask-render.ts::resolveSceneMaskPlan` reads the renderer-facing,
  already motion-sampled scene. One source can feed multiple consumers; ordinary
  keys, direct spatial paths, and controller relations therefore move the source
  before mask resolution. Visible pre-effect vector source subtrees are flattened
  through exact artboard-space transforms and inherited opacity; cross-artboard,
  source geometry, recursive chain, and fidelity checks return explicit reasons.
- SVG lowering: `mask-svg.ts` single-sources editor, client export, Worker/runtime
  defs. Alpha uses silhouette coverage; admitted luminance uses the source's solid
  fill color/opacity with `mask-type=luminance`; red/green/blue isolate the chosen
  solid-paint channel; morphology, feather, invert, and opacity share one chain.
- GUI: selected content exposes Matte channel, source sampling, invert, blur,
  opacity, and expand in Inspector Appearance. Structure actions create/release
  the reference without copying source geometry.
- Agent: full relation settings round-trip through
  `scene/set-mask-relation-settings`; appearance discovery and the MCP schema use
  the same relation ids and fields.

**Invariants:** relation ownership is never implicit layer adjacency. Source and
consumer remain ordinary editable scene nodes, and a source consumed as a matte
does not paint separately. The admitted coordinate space is same-artboard
`userSpaceOnUse`. `pre-effects` is native for alpha/solid luminance/RGB; `post-effects`
intent persists but is typed-unrepresented until a full source-subtree render
owner exists. Look Graph masks and Effect Fields are not alternate state owners.

**Blast-radius:** appearance metadata lives inside the FROZEN Scene node contract.
Changes affect structure actions, Inspector, imports, Scene serialization, canvas,
client/Worker SVG, runtime sampler, GPU capability/fallback, PDF fidelity rows,
Agent validation, and MCP schema. `mask-render.ts`/`mask-svg.ts` are runtime-sampler
dependencies; regenerate `runtime-sampler*.generated.ts` after edits.

---

## MCP / agent contract

**Start:** `entities/agent/model/` (`types` / `write` / `contracts` / `read-only` / `bridge-protocol`)
+ `scripts/vma-agent-toolkit.ts` (shared headless/live adapter)
+ `scripts/vmactl.ts` (primary CLI)
+ `scripts/vma-agent-mcp.ts` (thin MCP compatibility server, 20 tools)
+ `docs/agent-command-catalog.md`
+ `scripts/check-agent-contract.ts` (the gate).

**Adding a command kind = a 4-place manual mirror** (source-of-truth comment at the top of
`scripts/check-agent-contract.ts`, `rg "manually mirrored across four places"`):
1. `entities/agent/model/types.ts` — member of the `AgentSceneCommand` / `AgentMotionCommand` /
   `AgentMotionGrammarCommand` discriminated union **(source of truth)**.
2. `entities/agent/model/write.ts` — `case` in `compileAgentSceneCommand` (etc.).
3. `entities/agent/model/contracts.ts` — `case` in the `isAgentSceneCommand` (etc.) narrowing guard.
4. `scripts/vma-agent-mcp.ts` — `z.literal` member of `sceneCommandSchema = z.discriminatedUnion(...)`.

`check:agent-contract` (`checkCommandFamilies` + `checkToolNames`) fails CI on any missing mirror. A
new **tool** also needs `AGENT_TOOL_NAMES` (+ `MUTATING_AGENT_TOOL_NAMES` if it writes) ↔
`server.registerTool(...)`. The gate checks command-kind **presence**, not field shape — field drift is
caught by `tsc`.

Agent keyframe easing accepts `{kind:"template", templateId}` in addition to preset/custom curves.
Template ids are stable registry ids from `entities/motion/model/easing.ts`; profile-only ids must
return typed unsupported-template issues on plain keyframe segments. `list_motion_grammar` also exposes
profile timing-template descriptors through an Agent-owned boundary type, not the Inspector/profile
implementation type.

MCP descriptions are intentionally compact to avoid model-visible tool-metadata
bloat. Put long command semantics in `docs/agent-command-catalog.md`,
`bun run vmactl -- schema`, and the typed source contracts instead of expanding
MCP tool descriptions.

Agent-authored visible circle-cell studies use `scene/append-dot-matrix` and the
quality boundary in `docs/product-knowledge/agent-dot-matrix-authoring.md`.
Before calling any circle-cell result pixel art or targeting hand-authored game
sprite quality, read
`docs/knowledge/pixel-art/legend-of-mana-quality-and-memory.md`. The existing
helper is intentionally a circle-matrix compiler, not an indexed pixel-grid,
tile, palette, or cel model; `gap: 0` removes explicit spacing but circles still
leave geometric interstices and each active cell still expands to one four-cubic
Bezier contour. Do not treat density tuning as a substitute for the missing
native pixel representation.
`entities/scene/model/dot-matrix.ts` validates the `#`/`.` occupancy grid and
builds one ordinary compound path with circular Bezier contours; `write.ts` maps
validation failures to typed issues and appends the pre-minted path through the
scene command bus. Renderers, exporters, motion, and persistence must continue to
see an ordinary Scene path. The `signal-handoff` reference source in
`scripts/generate-reference-scenes.ts` deliberately reuses the same domain
compiler for its constrained wake and masked signal fields, then overrides only
stable fixture ids and relation metadata; generated fixtures/runtime must be
refreshed after that source changes. Low-level
`scene/append-node` remains the diagnostic/bespoke geometry surface and must not
be treated as visual-quality evidence by itself.

Scene-camera agent commands are now part of this contract: scene commands route
camera rig/depth/null/controller writes through `entities/scene/model/scene-camera-commands.ts`,
and motion commands route camera keyframes/cuts through `entities/motion/model/camera-commands.ts`
into `MotionDocument.cameraTracks` / `MotionDocument.cameraCuts`. Do not encode
camera edits as fake node tracks.

**Three agent surfaces, one command contract:**
- **CLI** (`bun run vmactl -- ...`): primary local/headless/live agent transport. It parses the shared
  JSON plan envelope, calls `scripts/vma-agent-toolkit.ts`, and avoids loading the full MCP tool
  catalog into every model turn.
- **Headless MCP** (`apply_scene_commands`, stateless doc-in/doc-out): `isAgentSceneCommand` narrow →
  `applyAgentSceneCommands` (`write.ts`) → `compileAgentSceneCommand` → native `SceneCommand`s →
  `runSceneCommands` in one transaction. No Zustand store touched. Motion/grammar batches
  **auto-append a propagation pass** (`write.ts`, `rg "HEADLESS auto-propagation"`) that the live path
  otherwise gets from the `useMotionPropagation` subscription.
- **Live** (`vmactl live apply` / `apply_edit_plan_live`): CLI or MCP →
  `scripts/agent-bridge-relay.ts` (loopback WS, **never reads payloads**) →
  `features/agent/model/editor-bridge.ts` → `dispatchAgentBridgeRequest` →
  `validateAgentCommandPlan` → editor-owned approval policy (`useAgentBridgeStore`;
  local dev bridge auto-approves, production bridge sessions require human approval) →
  `applyApprovedAgentCommandPlan`
  mutates through the **same command bus a human uses** (see *Command bus*).
  `withLiveSelection` (`editor-bridge.ts`) stamps `selectedNodeIds`,
  `selectedArtboardId`, `selectedSceneCamera`, `currentArtboardId`, and
  `currentFrame` onto every response when the live editor knows them.
- **Live project save** (`vmactl live save` / `save_project_live`): CLI or MCP → the same bridge
  client/relay → `save-project` bridge op → `App.tsx`'s injected cloud-project save handler. The handler reads the live
  scene/motion/grammar stores, calls `createCloudProject` or `updateCloudProject`, updates
  `useEditorCloudProjectStore`, and returns a project/revision summary. It uses the same editor-owned
  approval policy as live apply: local dev bridge auto-approves; production bridge sessions remain
  human-gated because they write the signed-in user's cloud-project workspace.

**Production-user local dev is not the bridge:** `bun run dev:production-cloud` only makes the local
Worker use production D1/R2 bindings and localhost Better Auth for the same production user/workspace.
Live editing still needs `bun run agent:bridge` + `/editor`, plus either `bun run vmactl -- live ...`,
`bun run mcp:agent`, or an explicit `/editor?agentBridge=1` copied bridge config. Login confirms
auth/cloud-save identity; a bridge session confirms live editor reachability. Mutating live plans on
the local dev bridge auto-approve for iteration speed; production bridge sessions remain
approval-gated in the editor. The durable product-knowledge reference is
`docs/product-knowledge/agent-bridge-dev-auto-approval.md`.
For the agent-facing opening sequence and freshness gate, use `docs/live-mcp-agent-runbook.md` and the
MCP resource `vma://docs/agent-contract`.

**Multi-editor sessions:** `entities/editor-session/model/` owns Working Copy locators, editor binding
epochs, the IndexedDB working-copy repository, the single-writer cloud lease, and content-free
diagnostics. `App.tsx` restores one atomic project snapshot per URL-stable working copy and fences
async cloud results. The local relay keeps a descriptor map; multiple connected editors require an
explicit `editorInstanceId` (`vmactl live editors` lists targets). `scripts/dev-session.ts` owns named
worktree/session ports and token-redacted manifests. See `docs/product-knowledge/multi-editor-sessions.md`.

**Invariants:** scene edits only via typed commands (no eval tool exists); mutating tools require the
editor-owned approval policy (`agentToolRequiresApproval`; local dev can auto-approve, production
sessions stay human-gated); a live plan can't span >1 command store (`crossStoreLivePlanIssue`) or
delete nodes with orphaned motion; `AGENT_CONTRACT_VERSION` is stamped on results; bump
`AGENT_BRIDGE_PROTOCOL_VERSION` on any wire change.

---

## Build, gates & generated artifacts (the blast-radius catalog)

**`bun run check` = 11 steps, in order:** `biome check .` →
`oxlint . --ignore-pattern '**/runtime-sampler.generated.ts'` → `check:arch` → `check:tokens` →
`check:agent-contract` → `check:product-knowledge` → `check:public-english` → `check:runtime-sampler` →
`check:reference-scenes` → `check:reference-scenes-fresh` → `tsc -b`. Each `check:*` is
`scripts/check-*.ts`.

- **`check:arch`** — FSD downward imports; no feature→feature; worker imports only `entities`/`shared`
  (no `react`/`app`/`pages`/`widgets`/`features`); **single-writer** (Scene+Motion only — see
  *Command bus* for the gap); 1 ToolId = 1 handler; scene model stays DOM-free.
- **`check:tokens`** — chrome `.tsx` must use semantic tokens; bans arbitrary hex / `rgb()` / `hsl()` /
  `text-[Npx]`. **Exempt** (may write literal colors / raw SVG attrs): `entities/`,
  `features/*/canvas/`, `shared/ui/overlay/`, `widgets/canvas-shell/ui/`. Reason: SVG presentation
  attributes can't resolve `var()`.
- **`check:product-knowledge`** — a product-facing source change ⇒ must also change a
  `docs/product-knowledge/` file (diffed vs `merge-base ..main`).
- **`check:public-english`** — no Japanese in `README.md`, `docs/product-knowledge`, and public pages
  (checkout / legal / updates / tutorials).
- **`check:runtime-sampler` / `check:reference-scenes(-fresh)`** — freshness gates: committed generated
  files must byte-match a fresh regen.

**Separate merge-gate step (NOT in `check`):** `bun run build` (`tsc -b && vite build`) →
`bun run check:bundle`. Ordering is load-bearing — `check:bundle` reads `dist/` and exits 1 if `build`
did not run. It guards: no `three` / `@react-three/fiber` / `@bridges/svg-webgpu` in entry chunks; no
server-only pkg (`better-auth`, `drizzle-orm`, `@polar-sh/*`) leaking to client JS;
`@polar-sh/checkout` stays a **dynamic** chunk; route/page and large editor panel chunks stay dynamic
entries; no `.env` / `.dev.vars` emitted into `dist`.

**Generated files → regen (forget = stale ship / gate fail):**

| File | Regen | Guarded by |
|---|---|---|
| `features/export/model/runtime-sampler.generated.ts` + `…-core.generated.ts` | `bun run gen:runtime-sampler` | `check:runtime-sampler` |
| `features/export/model/webgl-player.generated.ts` | `bun scripts/generate-webgl-player.ts` | `check:webgl-player` |
| `features/reference-scenes/fixtures/*.fixture.ts` | `bun run gen:reference-scenes` | `check:reference-scenes-fresh` |
| `worker-configuration.d.ts` | `bunx wrangler types` | `tsc -b` (worker types) |

**Worker / API boundary:** `worker/index.ts` (cloud-only, not in this repository) (Hono) owns all `/api/*` and exports the
`AgentBridgeSession` Durable Object; everything else falls through to the `ASSETS` binding (the SPA).
Worker and client compile under different tsconfigs (Workers types vs DOM libs), which is *why* they
must not cross-import. `vitest.config.ts` excludes `**/.claude/**` (a broken sibling worktree would
otherwise give a false-green pass).

**Verification altitude (from CONTRIBUTING.md):** docs/comment-only
changes get readback/grep — not the full gate. A change that opens a document-store transaction or
touches the command-bus/pointer lifecycle gets full adversarial review regardless of import-additivity.
Never run tests unless the task explicitly asks.
