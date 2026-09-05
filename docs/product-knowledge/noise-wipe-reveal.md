# Noise-Wipe Reveal (Stage 1 — recipe model + SVG render; Stage 2 — motion-grammar verb)

Date: 2026-07-04.
Status: reachable via motion-grammar (Inspector picker, "Apply Noise Wipe"
button, and MCP `motion-grammar/apply-technique { techniqueId: "noise-wipe" }`);
still SVG-only.

## Summary

Vecmo's noise-wipe reveal is a calibrated final alpha mask that dissolves or
reveals a node's fully-composited output through a directional field perturbed
by fractal noise, independent of the node's own material/grain look. Stage 1
landed the two lower layers: the vec-core recipe field
(`TextureRecipe.material.reveal`) and the SVG render primitive
(`revealMattePrimitives` in `effect-filter.ts`). Stage 2 (this update) adds the
`"noise-wipe"` motion-grammar technique — the code/AI-authorable verb that
seeds `material.reveal`/`material.linearField` once and then animates
`progress` live, every frame, from the binding — so the reveal is now
reachable from the Inspector's motion-grammar picker/Apply button and from
`motion-grammar/apply-technique` over MCP.

## What Changed?

### Stage 1 (recipe model + SVG render)

- `src/shared/vec-core/index.ts` adds `TextureMaterialReveal` (`progress`,
  `softness`, `noiseWeight`, `mode: "in" | "out"`) and an optional
  `TextureRecipe.material.reveal` field. Absent (the default for every existing
  document, including `NEUTRAL_TEXTURE_RECIPE`) means no reveal — fully
  backward-compatible. `normalizeTextureRecipe` threads it through the same
  validate-or-omit pattern as the sibling optional `alphaMatte` field: clamps
  `progress`/`softness`/`noiseWeight` to `[0, 1]`, defaults `mode` to `"in"`,
  and never synthesizes a `reveal` that wasn't authored.
- `src/entities/scene/model/effect-filter.ts` adds `revealMattePrimitives`, a
  pure `TextureRecipe → FilterPrimitive[]` chain: fractal noise flattened to
  luminance-in-alpha, composited with the authored directional field's alpha
  (the same Linear/Mesh field ramp `particleOverlayPrimitives` and
  `particleDissolvePrimitives` already read, falling back to `SourceAlpha` when
  none is authored) via `feComposite arithmetic`, then a calibrated linear
  `feComponentTransfer` remap whose `slope`/`intercept` slide outside `[0, 1]`
  as `progress` sweeps `0→1` (so the reveal fully clears even though the
  composited field stays clamped), and a final `feComposite operator="in"`
  masking the object. `mode: "out"` computes the same remap's complement
  (`1 − α`) directly instead of an extra invert stage.
- `buildEffectFilter` appends the reveal as the **final** stage, after every
  existing effect (recipe look, shadows, layer blend) has produced the
  composited object — it runs for any `material.mode`, including `"off"`, since
  the reveal is an orthogonal mask, not part of the material/grain dispatch.
  Node filters with no reveal authored serialize byte-identically to before
  (the multi-layer merge/blend stays unnamed unless a reveal needs to reference
  its output).

### Stage 2 (motion-grammar verb)

- `src/entities/motion-grammar/model/types.ts` adds `"noise-wipe"` to
  `MotionGrammarTechniqueId` and `MOTION_GRAMMAR_TECHNIQUE_IDS`. The MCP Zod
  schema (`z.enum(MOTION_GRAMMAR_TECHNIQUE_IDS)` in `scripts/vma-agent-mcp.ts`)
  derives from this array, so the wire contract syncs automatically.
- `src/entities/motion-grammar/model/catalog.ts` adds the `"noise-wipe"`
  catalog entry (family `temporal-placement`, `status: "implemented"`,
  `minTargets: 1`) with five numeric params: `durationFrames`, `angle` (wipe
  direction in degrees), `softness`, `noiseWeight`, and `mode` (0 = reveal-in,
  1 = dissolve-out, rendered as a labeled dropdown). It is also added to
  `AUTHORABLE_TECHNIQUE_IDS`, which promotes it into the Inspector's
  motion-grammar picker and satisfies the `AUTHORABLE_MOTION_GRAMMAR_TECHNIQUE_IDS`
  gate that `entities/agent/model/write.ts` enforces for
  `motion-grammar/apply-technique` — without this, the MCP command would parse
  but be rejected as "non-authorable".
- New `src/entities/motion-grammar/model/noise-wipe-technique-module.ts`
  implements the `MotionGrammarTechniqueModule` contract. Unlike every other
  promoted technique it creates no scene nodes: `createWorkspacePlan` resolves
  each selected target's current recipe; `createSceneCommands` seeds
  `material.reveal` (progress at the fully-hidden end for the chosen `mode`)
  and a full-span `material.linearField` (endpoints from `angle` via the
  existing `textureParticleLinearFieldFromAngle` helper, `plateau: 0`) merged
  onto each target's own recipe. `createMotionCommands` is intentionally a
  no-op (returns `[]`): noise-wipe is **sample-driven**, not track-driven — see
  below.
- `src/entities/motion-grammar/model/evaluator.ts` adds a `"noise-wipe"` case
  to `sampleGrammarFrameDirect`'s technique switch (`sampleNoiseWipe`), the
  same live per-frame mechanism every other promoted technique uses. At
  sampled frame `f` it computes `t = smoothstep01(f / durationFrames)`
  (`clamp01` + the same cubic ease `automation-bridge.ts` uses for keyframe
  segments), then `progress = mode === "out" ? 1 - t : t`, reads each target's
  **current, already-seeded** recipe from the scene the evaluator already has,
  and emits a `recipeOverride` that is the seeded recipe with only
  `texture.material.reveal.progress` replaced — every other authored field
  (softness, noiseWeight, mode, unrelated recipe state) passes through
  untouched. `recipeOverride` is the presentation bridge's existing per-node
  full-recipe-replacement channel (`GrammarNodeSample.recipeOverride`,
  composed in `presentation.ts`'s `sampleNode`); noise-wipe reuses it rather
  than depending on per-node `effectParam`/recipe automation-track sampling,
  which `presentation.ts`'s own doc comment documents as **not** written back
  to the rendered scene (`MotionPresentationNodeAppearance` is an intentional
  metadata side-car, "for a future vec-core raster bridge") — a vec-core
  `AutomationTrack` keyframing this path would have been silently inert on
  the canvas/scrub render.
- `src/entities/motion-grammar/model/technique-module.ts` registers
  `NOISE_WIPE_TECHNIQUE_MODULE` in `MOTION_GRAMMAR_TECHNIQUE_MODULES` and adds
  `commitsOnApply?: boolean` to the `MotionGrammarTechniqueModule` contract,
  set `true` only for noise-wipe. Every other promoted technique's Inspector
  "Apply" button (`commitApplyTechnique` in
  `widgets/inspector/model/motion-grammar-authoring.ts`) only ever needs to
  record a bare `MotionGrammarBinding` — the evaluator/expression-registry
  reads it live, so nothing else is required for the effect to appear.
  Noise-wipe has no such live-sampler entry to fall back on for its *base*
  state: without its seed, the target's recipe never carries a `reveal` field
  at all. `commitsOnApply: true` routes `commitApplyTechnique` to run the same
  seed-then-bind sequence `commitCreateMotionGrammarWorkspaceInstance` (the
  separate "Create System" button every technique already exposes) uses,
  instead of only recording the binding.
  `describeAuthoringProfile` delegates to `describeNoiseWipeAuthoringProfile`,
  which returns a real `MotionGrammarAuthoringProfileDescriptor`
  (`kind: "master-instances"`, `timeline.mode: "trackless-expression"`,
  `bakePolicy: "not-supported"` — there are no keyframe tracks to bake, since
  the evaluator recomputes `progress` live) exposing the five catalog params
  grouped into "Timing" (duration, mode) and "Wipe" (angle, softness, noise).
- `src/entities/motion-grammar/model/decomposition.ts` adds a `"noise-wipe"`
  row to `MOTION_GRAMMAR_DECOMPOSITION_COVERAGE` (`outputKinds: []`,
  `targetScope: "none"`, `scalarTracks: []`, `generatedNodeStrategy: "none"`,
  `clipStrategy: "none"`) — an honestly-empty row, since noise-wipe never
  produces scalar-track/generated-node/clip output through this generic
  pipeline. Without this row, `motionGrammarDecompositionCoverageForTechnique`
  throws for any technique missing a matching entry; that throw is
  unconditionally reachable from the Inspector's `MotionExpansionControls`
  (rendered whenever a binding exists, regardless of whether
  `describeAuthoringProfile` returns a profile), so a missing row crashes the
  whole Inspector the moment a noise-wipe binding is applied. An all-empty
  coverage row degrades to the existing "No planned outputs" blocked bake
  state instead.
- `src/entities/motion-grammar/model/workspace-instance.ts` gets a small
  structural addition (an unused placeholder workspace-recipe row) so the
  total-record lookup that enumerates every `MotionGrammarTechniqueId` still
  compiles; it is never read for `"noise-wipe"` since the technique does not
  use the generic workspace-instance planner.

## What Can The User Do Now?

Select one or more objects, choose "Noise Wipe" from the Inspector's
motion-grammar technique picker and click "Apply Noise Wipe" (or send
`motion-grammar/apply-technique { techniqueId: "noise-wipe", targetIds: [...] }`
over MCP), and each selected object gets a seeded noise-wipe reveal that
animates live from hidden to shown (or shown to hidden, in dissolve-out mode)
over the authored duration as playback/scrub advances. `angle`, `softness`,
`noiseWeight`, `durationFrames`, and `mode` are editable catalog params on the
binding, surfaced through a real authoring profile in the Inspector.

## Why It Matters

Stage 1 validated the hard, easy-to-get-subtly-wrong render math (the
range-expansion calibration that lets a clamped composited field still sweep a
full 0→1 reveal, and the noise-perturbed directional edge) as pure, type-safe
SVG primitives, orthogonal to `material.mode`/`blendMode`. Stage 2 only has to
vary `progress` over time against that already-correct, already-composable
mask — it does not touch the render chain at all. Building it as a
motion-grammar technique (rather than a one-off Inspector-only control) means
it inherits the catalog/module contract every other technique already uses:
MCP discovery (`list_motion_grammar`), the same numeric-param clamp envelope,
the same authoring-profile shape, and the same undo/coalescing model, for
free — while following the sample-driven mechanism (evaluator case,
`recipeOverride`) the other 18 promoted techniques already use, rather than a
one-off automation-track path that the shared presentation renderer does not
compose back onto the scene.

## How Does The User Operate It?

From the Inspector: select target object(s), open the motion-grammar picker,
choose "Noise Wipe", click "Apply Noise Wipe", adjust
`Angle`/`Softness`/`Noise`/`Duration`/`Direction` in the authoring profile
panel. From MCP/AI: call `motion-grammar/apply-technique` with `techniqueId:
"noise-wipe"` and one or more `targetIds`; `list_motion_grammar` reports the
technique's param specs and current bindings first.

## What Should A Reviewer Verify?

- `bun run check` is green: `tsc -b`, `check:arch`, `check:agent-contract` (the
  technique is a new value in the existing `techniqueId` enum, not a new
  top-level command kind, so the four-place command-kind mirror this gate
  audits is unaffected), `check:product-knowledge` (this doc),
  `check:runtime-sampler` (`evaluator.ts` is bundled into the runtime sampler;
  regenerate with `bun run gen:runtime-sampler` after touching it).
- `AUTHORABLE_TECHNIQUE_IDS` includes `"noise-wipe"` — without it,
  `motion-grammar/apply-technique { techniqueId: "noise-wipe" }` would be
  rejected by `entities/agent/model/write.ts`'s
  `AUTHORABLE_MOTION_GRAMMAR_TECHNIQUE_IDS` gate even though the technique
  module exists.
- The scene command actually merges onto the target's existing recipe (grain,
  particle dissolve, alphaMatte, etc. from any prior authoring survive) rather
  than replacing it wholesale.
- Applying via the Inspector's "Apply Noise Wipe" button (`commitApplyTechnique`,
  not only the separate "Create System" button) must seed `material.reveal` —
  verify `commitsOnApply: true` is still set on the noise-wipe module and that
  `commitApplyTechnique` still branches on
  `motionGrammarTechniqueCommitsOnApply` before falling back to a bare-binding
  apply.
- The evaluator's `"noise-wipe"` case must read each target's recipe from the
  scene it is called with (not a stale snapshot) and must skip a target whose
  recipe has no seeded `reveal` yet, rather than fabricating one.
- No change to Stage 1's render chain: `effect-filter.ts` and
  `webgl-player.generated.ts` are untouched by Stage 2.

## What Is Still Limited?

- SVG-only: there is still no GPU/WebGL raster path for the reveal, so the
  animated technique will not appear in the GPU-accelerated preview/export tier
  until a later wave adds one (consistent with how Particle Dissolve and Grain
  currently work).
- No generic decomposition output: noise-wipe's `MOTION_GRAMMAR_DECOMPOSITION_COVERAGE`
  row is intentionally empty, so the Inspector's "Create editable motion"
  expansion/bake affordance always reports "No planned outputs" for this
  technique. It is not currently possible to bake the live sweep into ordinary
  editable keyframe tracks from the Inspector; the sweep only exists as long as
  the grammar binding does.
