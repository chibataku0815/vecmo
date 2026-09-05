# Variable-Width Strokes (Stroke Width Profiles)

Date: 2026-07-05.
Status: shipped end to end. The typed document field, the scene command patch
semantics, and the agent/MCP authoring surface (including preset sugar) are
wired, and so are the consumers: editor canvas and SVG export render profiled
strokes as filled outlines, Motion/Code and WebGL runtime exports receive
pre-baked outline geometry, the Inspector exposes a Width profile preset
select, and the pencil tool captures pen pressure into a profile on commit.
Remaining v1 boundaries are listed under What Is Still Intentionally Limited.

## Summary

`NodeStyle` gains an optional `strokeWidthProfile`: an ordered list of
multiplier stops (`{ t, w }`) over a path's normalized arc length. When a node
carries a profile, the effective stroke width at position `t` is
`strokeWidth * sampleWidthProfile(profile, t)` instead of a single uniform
width, and a renderer that understands the contract expands the stroked spine
into a filled outline rather than painting a uniform stroke — `strokeDash`/
`strokeDashoffset` are ignored whenever a profile is present, since a dashed
variable-width stroke is out of v1 scope. The profile is not animatable in v1:
`strokeWidth` itself keyframes as before, but the profile shape is a static
per-edit value.

The shared contract (`src/shared/stroke/width-profile.ts`: the stop shape,
`validateStrokeWidthProfile`, `sampleWidthProfile`, and four built-in presets —
`taper-out`, `taper-in`, `taper-both`, `ink`) and the pure geometry expander
(`src/shared/stroke/expand.ts`'s `expandStrokeWidthProfile`, open-spine outline
generation via offset rails + round end caps + curve re-fit) already existed
before this change. This update is the document-model layer that lets a
profile actually be authored and travel with a node: the `NodeStyle` field
itself, `createUpdateNodeStyleCommand`'s patch semantics, and the full agent
command contract (types/write/contracts/Zod, the 4-place sync) so an AI agent
can set, clear, or preset a node's stroke taper in one `scene/update-node-style`
(or `scene/append-node`) call.

## What Changed?

- `NodeStyle.strokeWidthProfile?: readonly StrokeWidthProfileStop[]` — additive
  field, FROZEN-file convention respected (append-only, no reordering).
- `NodeStylePatch.strokeWidthProfile?: readonly StrokeWidthProfileStop[] | null`
  — `undefined` leaves the field unchanged, `null` clears it, a valid array
  sets it (mirrors the existing `crop: Bounds | null` three-state clear
  convention used elsewhere in `node-commands.ts`). An array that fails
  `validateStrokeWidthProfile` is silently dropped from the patch at the
  command layer — the agent layer above it is the one that reports loudly.
- `AgentNodeStylePatch` gains the same `strokeWidthProfile` (stops or `null`)
  plus `strokeWidthProfilePreset` sugar (one of the four preset ids, or
  `"none"` to clear). `compileAgentSceneCommand`'s `scene/update-node-style`
  (and `scene/append-node`, which shares the same style patch type) resolve the
  sugar before the command reaches the scene bus: a preset wins over raw stops
  present in the same patch (with a `agent.stroke-width-profile-preset-conflict`
  WARNING, not a refusal), and invalid raw stops are refused as an
  `agent.stroke-width-profile-invalid` ERROR — the whole style write does not
  apply, rather than silently dropping just the bad field.
- MCP wire schema (`scripts/vma-agent-mcp.ts`): `stylePatchSchema` (shared by
  `scene/update-node-style` and `scene/append-node`'s `node.style`) gains
  `strokeWidthProfile` (`{t, w}` stops, 2-32 entries, nullable) and
  `strokeWidthProfilePreset` (the 4 preset ids + `"none"`), and the
  `apply_scene_commands` tool description documents both fields plus the
  preset-wins-with-warning precedence.
- Rendering and input wiring (landed immediately after the model layer):
  `stroke-outline.ts` derives a memoized profile outline per node and
  `bakeStrokeWidthProfiles` pre-bakes outlines into the exported scene JSON at
  the single bundle seam (the generated runtime players stay untouched) and
  reports every node it excludes from the bake as a `scene-json` export issue
  (see What Is Still Intentionally Limited below); `CanvasShell` and the SVG
  exporter render profiled strokes as filled outlines on their single-paint
  path; the Inspector gains a Width profile preset select (Style and Dash
  controls disable while a profile is active); the freehand/pencil tool
  records pen pressure (with coalesced events, a predicted preview tail, and
  touch rejection) and attaches a derived profile on commit. One reference
  scene carries a profiled taper node.

## What Can The User Do Now?

An **agent/MCP client** can author a variable-width stroke on an existing node
via `apply_scene_commands` → `scene/update-node-style`, or on a brand-new node
via `scene/append-node`'s `node.style`: set explicit `{t, w}` stops, apply one
of the four named presets (`taper-out`, `taper-in`, `taper-both`, `ink`) via
`strokeWidthProfilePreset`, or clear an existing profile with `null` /
`"none"`.

A **human** can author profiles two ways: pick a preset from the Inspector's
Width profile select on any stroked node (None restores a uniform stroke; a
pen-derived profile shows as Custom), or draw with a pressure pen — the pencil
tool records per-point pressure and commits a taper automatically, while mouse
strokes stay uniform exactly as before. There is no on-canvas width handle
yet.

## How To Operate It

- Agent/MCP: `apply_scene_commands` with a `scene/update-node-style` (or
  `scene/append-node`) command whose `patch`/`node.style` includes
  `strokeWidthProfile` (an array of `{t, w}`, `t` from 0 to 1 strictly
  increasing, `w` a 0-8 multiplier) or `strokeWidthProfilePreset` (a name from
  `taper-out`/`taper-in`/`taper-both`/`ink`/`none`). Call `observe_node` first
  to confirm the target node id.
- Editor: select a stroked node → Inspector → Stroke → Width profile select;
  or draw with the pencil tool using a pressure pen.

## What A Reviewer Should Verify

- `bun run check` is green, in particular `check:agent-contract` (the
  `scene/update-node-style` command kind stays in sync across
  types/write/contracts/Zod) and `tsc -b` (the `AgentNodeStylePatch` ↔
  `stylePatchSchema` ↔ `NodeStylePatch` field sets agree — this is a manual
  parity check, not something `check:agent-contract` verifies at the
  field level, since that gate only compares command-kind literals).
- An agent write with a valid preset resolves to the preset's stops and clears
  cleanly with `"none"`; a patch with both `strokeWidthProfile` and
  `strokeWidthProfilePreset` set applies the preset and returns a WARNING
  issue naming the ignored stops; an invalid raw `strokeWidthProfile` (e.g.
  fewer than 2 stops, non-monotonic `t`, or an out-of-range `w`) returns an
  ERROR issue and the node's style is unchanged.
- `strokeWidthProfile` is intentionally absent from
  `BINDABLE_PROPERTY_DESCRIPTORS` — no bindable-property or expression surface
  should be able to target it.
- Export a scene with a profiled node that also has a live `pathShape` track,
  and a profiled node with a visible fill: the TopBar export report shows a
  `fallback`-category issue for each (and the downloaded `*.manifest.json`'s
  `scene-json` asset entry carries the matching
  `stroke-width-profile-*-unbaked` code), while a profiled node with neither
  condition still bakes to a taper outline with no issue.

## What Is Still Intentionally Limited

- **Single-paint strokes only.** Profiles apply when the legacy single
  `stroke`/`strokeWidth` pair is the active stroke source; nodes using the
  multi-paint `strokes[]` appearance stack render their uniform strokes
  unchanged.
- **Runtime-export degradations (editor and SVG still render the taper).** A
  profiled node that also has a live `pathShape` keyframe track, or that
  paints a visible fill of its own, is excluded from the export bake and falls
  back to a uniform stroke in the generated runtime players — motion and fill
  correctness win over the taper look. This fallback is reported, not silent:
  the `scene-json` bundle asset carries one
  `stroke-width-profile-path-shape-track-unbaked` or
  `stroke-width-profile-visible-fill-unbaked` issue (category `fallback`,
  fallback `uniform-stroke-width`) per excluded node, and it rolls into the
  bundle manifest and the TopBar export report exactly like SVG/PDF appearance
  issues do (`bundle.ts`'s `hasIssueList` /
  `sceneJsonIssuesForStrokeWidthProfileBakeFallbacks` wire it in;
  `widgets/top-bar/model/export-report.ts`'s asset-issue aggregation is
  kind-agnostic, so it needed no change). PDF export does not consume
  profiles.
- **No on-canvas width handle.** Authoring is presets, agent commands, or pen
  pressure; there is no Illustrator-style width point editor yet.
- **Not animatable.** The profile shape itself cannot be keyframed or
  expression-bound in v1; only the base `strokeWidth` scalar animates.
- **Open spines only** (inherited from `expandStrokeWidthProfile`'s existing
  contract): closed-path variable-width expansion is out of v1 scope once
  rendering lands.
- **Dash is mutually exclusive.** `strokeDash`/`strokeDashoffset` are ignored
  whenever a profile is present; there is no combined dashed-taper mode.
