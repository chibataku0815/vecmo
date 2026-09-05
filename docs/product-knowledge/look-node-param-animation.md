# Look-node Parameter Animation

Date: 2026-06-25. Updated: 2026-07-02.
Status: `beta` — human authoring (scrub-to-key) + agent/MCP write; timeline rows pending.

## Summary

Frame Look-graph node parameters (e.g. a Turbulent Displace `scale`, a Posterize
`levels`, a Color Look `mix`) can be driven per frame. Phase 1 landed the **data
path** (`MotionDocument.lookNodeTracks` side-car). Phase 2 (this update) closes the
**human authoring loop**: with recording on (or a param already animated), scrubbing
a Look node slider in the Inspector or the docked Look Graph workspace records a
keyframe at the playhead instead of writing a static base value, and the slider then
shows the keyframed value at the playhead so it tracks the timeline.

## What Changed?

- `MotionDocument.lookNodeTracks?` — an additive, optional side-car of numeric
  keyframe tracks keyed by `{ owner, lookNodeId, paramKey }` (NOT the node-keyed
  `KeyframeTrackTarget`; a look-node param has no scene node). Modeled like the
  existing `automation`/`grammar` side-cars: additive, `schemaVersion` stays `1`.
- `effectiveLookNodeParam` (sampler) interpolates one track at a frame; the new
  `sampleFrameLookGraphScene` (presentation) patches the sampled scene's frame
  look graph for scene/artboard owners. The canvas and SVG export already read the
  look graph from the sampled scene, so the animated value flows to both unchanged.
- Pure helpers `withLookNodeParam` / `sameLookGraphOwner` (look-graph).
- `upsertLookNodeKeyframe` (commands) — the typed authoring op that writes a
  coalescing keyframe into `lookNodeTracks` (one undo per track+frame).
- **MCP/agent typed-write**: `apply_motion_commands` accepts a
  `motion/upsert-look-node-keyframe` command (`lookNodeId` + `paramKey` + frame +
  value; optional `artboardId`, absent = scene scope). `list_look_node_capabilities`
  exposes the entity-owned parameter catalog with `keyframable` on numeric params.
  The write path now rejects missing artboards, empty graphs, missing look nodes,
  unknown params, and enum/boolean params instead of leaving dead
  `lookNodeTracks` entries that the sampler would ignore.
- **Human authoring (Phase 2)**: a shared `look-node-keyframing` helper decides —
  exactly like `shouldKeyInspectorField` for normal props — to record a keyframe
  when recording is on OR the param is already animated, else write the base. Both
  Look slider surfaces (Inspector `LookGraphSlider`, workspace `GraphSlider`) pass
  the transport `{recording, frame}` into the existing scrub commit/gesture, which
  now route to `upsertLookNodeKeyframe` on the motion store (one undo per scrub via
  the command's per-(track, frame) coalesce key). The slider value is the sampled
  value-at-frame (`effectiveLookNodeParam`) when animated, so it tracks the playhead.
  Only `withLookNodeParam`-recognized params are routed; grade/glow/grain fall
  through to the base write (they animate via recipe automation).
- **Keyframe affordance (Phase 2b)**: each keyframable Look slider gets a tri-state
  keyframe diamond (`shared/ui/KeyframeDiamond`) in the slider's `action` slot —
  filled at a key, outlined when animated between keys, dim when not animated.
  Clicking toggles a key at the playhead: it pins the current value-at-frame when
  none exists, or removes the one that does (`removeLookNodeKeyframe`, which drops
  the track when its last key goes). The frame is snapped identically to the
  upsert, so the indicator, add, and remove address the same stored frame. This
  also bootstraps animation without the record button: add a key, then scrubbing
  auto-keys because the param is now animated. Human slider diamonds and agent/MCP
  writes now resolve keyframe eligibility from the same entity-owned numeric param
  catalog. Non-keyframable sliders (grade/glow/grain) show no diamond.

## What Can The User Do Now?

A **human** can keyframe a Look node param: turn on recording, scrub a Look slider
(e.g. Color Look `mix`, Turbulent Displace `scale`, Posterize `levels`), and the
param animates on canvas and in export; scrubbing the timeline moves the slider to
the keyframed value. A **code/agent (MCP) client** can author the same via
`motion/upsert-look-node-keyframe` after discovering the target node and numeric
param through `list_look_graph` + `list_look_node_capabilities`. Values are not
frozen vec-core contracts — `AutomationRecipe` is untouched.

## What Should A Reviewer Verify?

- `bun run check` green; `presentation.test.ts` proves a `lookNodeTracks` entry on
  a displace `scale` yields different sampled scale at frame 0 / 5 / 10 (10 / 25 /
  40) without mutating the base document. `commands.test.ts` proves
  `upsertLookNodeKeyframe` writes/replaces/coalesces a side-car keyframe.
- The MCP `motion/upsert-look-node-keyframe` path is covered by `tsc` (union /
  validator / compile / Zod kept consistent) + `mcp:agent:smoke`; it delegates to
  the unit-tested command, so it has no dedicated end-to-end agent test yet.
- For the 2026-07-02 agent validation update, an invalid MCP write should return
  an agent issue before mutation when the artboard, graph, look node, param key, or
  numeric keyframe eligibility does not resolve.

## What Is Still Limited?

- **No timeline rows yet**: `lookNodeTracks` keyframes are authored + toggled per
  slider but are not shown as timeline lanes, so there is no scrub-the-diamond
  drag or cross-param overview. The per-slider diamond covers add/remove/inspect at
  the playhead; timeline lanes are the optional layer on top.
- The typed catalog covers numeric params for blur/chromatic-fringe/displace/
  posterize/color-map/find-edges, the Display/Print pack, noise-field, warp, lens,
  kaleidoscope, flow, path-blur, noise-source, deep-glow, mask, and composite.
  Enum/boolean payload params are discoverable for static graph patches, but are
  not keyframable. Grade/glow/grain animate via the recipe automation path instead.
- The MCP command still addresses scene or artboard owners only. Object-scoped
  overlay Look graphs have a domain owner and human editor path, but no scoped
  overlay variant on `motion/upsert-look-node-keyframe` yet.
- During continuous rAF playback the frame look filter may be frozen (the overlay
  patches transforms); per-frame look re-evaluation on playback is a follow-up
  fidelity item. Scrubbing already reflects the animated value.
