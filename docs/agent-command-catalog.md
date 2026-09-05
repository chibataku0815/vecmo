# Agent Command Catalog

Created: 2026-07-09.

This is the durable reference point for high-bandwidth agent integrations. MCP
tool descriptions stay intentionally compact; agents should use `vmactl` plus
this catalog when they need command detail.

## Primary Transport

Use `vmactl` for local/headless/live agent work:

```sh
bun run vmactl -- schema
bun run vmactl -- observe --detail summary
bun run vmactl -- validate --plan plan.json
bun run vmactl -- apply --plan plan.json --dry-run
bun run vmactl -- live status
bun run vmactl -- live validate --plan plan.json
bun run vmactl -- live apply --plan plan.json
```

MCP remains a compatibility surface for clients that require tools, but it is no
longer the preferred place to carry the full command catalog in model-visible
metadata. MCP command arrays are intentionally accepted as loose JSON arrays at
the input-schema boundary, then narrowed through Vecmo's internal
`isAgentToolRequest` guard before any command compiler runs; this keeps new
command types from being rejected by stale tool metadata while preserving typed
execution.

## Plan Envelope

`vmactl` and the live bridge use the same command envelope:

```json
{
  "planId": "agent-edit-1",
  "intent": "Short human-readable edit intent.",
  "source": {
    "scenePath": "optional.scene.json",
    "motionPath": "optional.motion.json",
    "grammarPath": "optional.grammar.json"
  },
  "target": { "kind": "document" },
  "transactionId": "optional-undo-coalesce-key",
  "sceneCommands": [],
  "motionCommands": [],
  "motionGrammarCommands": [],
  "includeValidation": true
}
```

`source` is headless-only. Live commands read the open editor document over the
bridge and use the editor-owned approval policy: local dev bridge auto-approves,
while production bridge sessions remain human-gated.

## Command Families

Scene commands mutate `SceneDocument` through the scene command bus. They cover
node/artboard creation, structure, transforms, style/text patches, layout frames,
assets, masks, look graphs, style presets, component symbols, component props,
interactions, scene camera rigs/depth planes/controllers, and bindable
properties/expressions.

### Visible circle-cell studies

Use `scene/append-dot-matrix` when an agent-authored visible candidate should be
constructed from one disciplined circle-cell vocabulary. The command accepts a
rectangular `rows` occupancy pattern (`#` = circular contour, `.` = negative
space), `origin`, positive `cellSize`, optional non-negative `gap`, one shared
fill/stroke/opacity `style`, and an optional target `layerId`. It creates one
editable compound path and returns that path as the command's affected node.

```json
{
  "type": "scene/append-dot-matrix",
  "matrix": {
    "name": "Offset fold",
    "origin": { "x": 320, "y": 180 },
    "rows": ["##........", "####......", ".######...", "..###.###.", "...######.", "......####", "........##"],
    "cellSize": 18,
    "gap": 6,
    "style": { "fill": "#191817", "stroke": "none", "strokeWidth": 0 }
  }
}
```

Do not use this command as an automatic art-direction decision. Read
`docs/product-knowledge/agent-dot-matrix-authoring.md` before presenting the
result as a visual candidate. Low-level `scene/append-node` remains appropriate
for diagnostics and bespoke geometry, but diagnostic primitives must not be
presented as authored visual proof. The source-less headless context still loads
the legacy technical demo; use an explicit clean scene source or a separately
created and focused clean artboard for visible candidates.

### Codex-generated pixel objects

Use `scene/append-pixel-art-objects` after Codex/GPT Image has semantically
redrawn a reference as square-grid pixel art. The payload is compact and
deterministic: `.` is transparent and `0-9a-v` address a 1-32 color hex palette.
The command accepts a grid up to 128 × 128, an integer scene-unit `pixelSize`, an
explicit origin, and an optional artboard. It creates one parent group with
ordinary filled compound-path children in one undoable scene transaction.

```json
{
  "type": "scene/append-pixel-art-objects",
  "pixelArt": {
    "name": "Forest traveler",
    "origin": { "x": 120, "y": 80 },
    "pixelSize": 5,
    "palette": ["#121210", "#28afa5", "#8f58a6", "#dc9d4b"],
    "rows": ["0000", "0120", "0330", "0000"],
    "artboardId": "artboard-main"
  }
}
```

Use `bun run pixel-art:plan` to decode PNG/JPEG/WebP candidates, crop transparent
padding, preserve a detected aligned source lattice without interpolation (or
use correctly weighted coverage sampling for a non-aligned generated candidate),
quantize with protected chromatic accents, and emit a live-plan JSON. Opaque edge
bands are preserved because the importer cannot safely infer that authored
background is padding.
The lowering never creates round cells, automatic gaps, fractional pixels, or
one node per pixel. It preserves every indexed pixel; when raw connected regions
exceed 256, small disconnected regions of the same palette color share one
compound-path node. The hard contour budget is 16,384, and one plan may contain
one pixel-art append command. Matching horizontal spans on consecutive rows
coalesce into taller rectangles before that budget is evaluated. A supplied
`artboardId` must already exist. Read
`docs/product-knowledge/ai-pixel-object-import.md` before generation or review.

Effect Field writes use `scene/patch-effect-field` with one explicit owner target
and one operation: upsert/remove a shared field, attach/remove a route,
link/unlink a route, replace field source geometry, or update influence. Agent
sources are restricted to Contour, Linear, and Mesh. The visible canonical
targets are `style.opacity`, `style.effects.layer-blur`, and
`recipe.glow.bloom`; mask feather and stroke softness are typed deferred, while
silhouette softness is unsupported. Unknown, ambiguous, duplicate, or newly
deferred routes reject — never rely on first-match behavior.

Axis blur uses `radius` for X and optional `radiusY` for Y. Omit `radiusY` in a
full node-style effect replacement, or send `radiusY: null` in a sparse Look
Graph Blur patch, to relink. A Look `radiusY` keyframe requires an explicit
static Y radius. This is axis-aligned anisotropic Gaussian blur, not
arbitrary-angle or trajectory motion blur.

Source Optics writes use these scene commands:

```text
scene/add-source-optics-rig
scene/update-source-optics-rig
scene/remove-source-optics-rig
scene/bind-source-optics-response
scene/update-source-optics-response
scene/unbind-source-optics-response
```

Every command requires an explicit artboard and stable rig/source/target or
binding id. Validation rejects missing, hidden, cross-artboard, duplicate-owner,
and source-as-own-target identities; it never selects a first matching source.
Rig patches address Bloom, Rays, Atmosphere, and Lens. Response patches address
Surface, Diffusion, Edge, existing Microstructure coupling, Spectral, and an
optional shared Effect Field id. `observe_document` exposes rig summaries,
typed issue counts, parameter ids/ranges, numeric Source Optics tracks,
static/frame-zero sampled values, and editor-SVG/WebGPU/runtime-SVG fidelity;
`observe_node` exposes source and target roles.

Numeric optical animation uses:

```text
motion/set-source-optics-keyframe
motion/remove-source-optics-keyframe
```

Both commands require the exact discriminated target: `rig` needs artboard,
rig, and parameter ids; `ray` additionally needs a ray id; `binding`
additionally needs a response-binding id. The compiler validates descriptor
owner scope, optional-channel existence, keyframability, finite range, and the
exact key on removal before opening the motion write. Enable/bypass, identity,
membership, colors, and field links remain static. Node transform motion still
changes the resolved source direction because transform sampling runs before
the optical parameter sidecar.

Motion commands mutate the `MotionDocument` side-car. They cover scalar
keyframes, bindable keyframes, scene-camera camera tracks and camera cuts,
look-node and Source Optics parameter keyframes, text animators, easing, animation clips, and
component-instance propagation.

Motion-grammar commands mutate the grammar side-car. They cover technique
binding apply/update/remove and grammar propagation to component instances.

## Important Constraints

Headless apply is stateless: it returns updated documents and does not write
files, browser stores, or cloud projects.

Live apply is not a sandbox fallback: if no relay/editor/session is connected,
it returns a bridge error. Mutating live plans on the local dev bridge
auto-approve to keep implementation loops moving; production bridge sessions
apply only after editor-side human approval, unless the human has enabled editor
auto-apply trust mode.

Created ids from `validate` or `propose` are provisional. Use committed ids from
live apply results, especially `result.appliedCommands[].affected`, when chaining
created resources.

Do not execute arbitrary JavaScript through agent commands. External code and 3D
assets are represented as source/preview/capability/fidelity metadata and placed
as document assets unless a later trusted runtime explicitly owns execution.
Use `scene/place-external-asset` for externally generated `external-scene`,
`model-3d`, and `code-module` assets; follow with `observe_document` to read the
committed placed node ids before applying depth planes, scene-camera bindings, or
motion. Capability entries are preserved as asset metadata, so agent workflow
hints such as `agent-generated`, `import-placeholder`, or `depth-plane-ready` can
round-trip alongside renderer-facing flags such as `runtime-webgl`.
Preview-less external assets intentionally render/export as labeled safe
placeholders with asset kind/format/capability metadata rather than executing
the source.

## MCP Metadata Budget

Keep MCP tool descriptions to operational summaries. Detailed command semantics
belong here, in `bun run vmactl -- schema`, and in the typed contracts under
`src/entities/agent/model/`.
