# AI Pixel-Art Object Import

Date: 2026-07-13
Status: binding V1 product and implementation contract

## Summary

Vecmo's AI pixel-art object workflow is not a low-resolution photo filter and it
is not the existing Pixel Grid or dot-matrix effect. It accepts either a verbal
object brief or an image reference, produces or accepts an authored pixel-art
raster, then lowers the accepted raster into a deterministic set of editable
Vecmo objects.

The source route is explicit:

| Starting state | Generation step | Required downstream step |
| --- | --- | --- |
| object must be created from scratch | Codex asks GPT Image to generate pixel art directly | normalize the logical lattice, then objectify |
| non-pixel image already exists | Codex asks GPT Image for a semantic pixel-art redraw | normalize the logical lattice, then objectify |
| accepted pixel art already exists | no image-generation call | normalize when needed, then objectify |

Do not add a non-pixel intermediate when generating from scratch. Direct
pixel-art generation removes the semantic-redraw pass, but it does not remove
normalization or objectification: GPT Image still returns a flattened raster,
not editable Vecmo nodes or a guaranteed exact logical lattice.

The primary V1 workflow uses Codex as the generation client and the existing
live agent bridge as the editor transport:

```text
verbal brief or source image
-> direct pixel-art generation, semantic redraw, or accepted pixel-art input
-> lattice-aware logical-grid sampling and palette reduction
-> compact palette + indexed rows edit plan
-> contiguous color-region extraction
-> run-compressed compound paths, with same-color overflow aggregation
-> one selectable Vecmo group with independently editable children
-> normal transform, motion, save, undo, and export paths
```

A workflow that ends at one placed bitmap does not satisfy this contract.

### Final data identity

The generated or supplied PNG is an intermediate image source and review
artifact only. The inserted Vecmo result is one ordinary parent group containing
ordinary compound-path children; it does not contain an image node or an image
asset reference, and it does not create one node per pixel. V1 child boundaries
follow connected palette regions. They are editable vector regions, but they do
not guarantee semantic part names such as `body`, `window`, or `wind-up key`.
Semantic part segmentation is a separate future capability.

## User Need

Creating every new motion object by manually assembling primitives is wasteful.
The useful product action is **Generate pixel objects**: generate pixel art
directly from a brief, semantically redraw a non-pixel reference, or accept
existing pixel art, then convert the accepted raster into scene-native objects
that can be moved, recolored, selected, grouped, and animated.

## OpenAI Capability Boundary

Codex may call GPT Image directly for generation or reference-led editing, keep
the generated candidate in the local workspace, and pass only the compact
indexed result through Vecmo's live bridge.
The optional, fail-closed Worker adapter can call the Image API edit endpoint
with the source image and the same structured redraw prompt for clients that do
not have a Codex image-generation surface. It is disabled unless the deployment
explicitly enables it after adding quota/accounting controls. OpenAI documents the Image API as the
single-prompt path for editing an existing image and identifies `gpt-image-2`
as the current GPT Image model. Responses API multi-turn refinement is deferred;
V1 makes one bounded edit request per candidate.

Sources:

- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI image edit API reference](https://developers.openai.com/api/reference/resources/images/methods/edit)

The OpenAI response is a flattened generated image. It does not provide Vecmo
nodes, semantic layers, reliable per-object masks, pivots, or a scene graph.
Vecmo therefore owns the deterministic lowering stage. Do not claim that GPT
Image directly returns editable objects.

## Concept Gate

```text
reference / user brief:
Create or convert one accepted pixel-art visual into reusable motion parts.

intent altitude:
structure visual complexity into editable carriers

construction recipe hypotheses:
1. semantic image redraw followed by palette-constrained normalization
2. four-connected color-region extraction
3. row-run compression into compound vector paths under one motion group

commonality:
Every child inherits one logical pixel grid, palette, crop, and source scale.

force:
The import action compresses a flattened image into a bounded hierarchy of
color/continuity carriers, creating handles for later motion.

angle / base point:
The cropped top-left logical pixel is the shared origin; all regions remain in
one artboard-local coordinate system.

role chain:
brief or reference -> accepted pixel image -> normalized grid -> editable regions -> motion carriers

five-field beat brief:
- hero: the recognized primary silhouette and its largest internal masses
- verb: separate
- timing signature: static conversion followed by independently authored motion
- secondary reaction: detail regions inherit the same grid and group transform
- offset-composition: region hierarchy follows occupied area rather than file order
- world: one edge-sharing square-pixel lattice with no automatic cell gaps

motion thesis:
A flattened visual becomes a hierarchy whose meaningful masses can move without
destroying their shared pixel world.

signature law:
Every indexed pixel must survive unchanged and every contour edge must lie on
the same integer logical-pixel lattice. A child owns either one connected region
or a documented same-color overflow aggregate.

viewer sentence:
The picture has become a set of solid parts that can move separately while
still looking like one pixel-art scene.
```

## V1 Visual Quality Entry

```text
quality thesis:
Quality comes from a generated semantic redraw with a legible silhouette and
role-based color clusters, followed by exact square-pixel reconstruction.

simple-geometry carrier:
One compound path per retained palette region; budget overflow combines only
disconnected regions of the same palette color. Paths contain rectangular row
runs rather than one circle or scene node per pixel.

fit-scale legibility claim:
The primary silhouette, foreground/background separation, and major material
planes remain readable at normal canvas Fit scale.

perceptual ownership map:
- source: GPT Image redraw prompt plus input image
- surface: normalized palette regions
- internal response: shadow/highlight clusters authored by the generated image
- boundary transition: hard integer-grid contour
- atmosphere: only when represented by explicit regions
- microstructure: retained only when it survives palette and region thresholds
- lens/display consequence: nearest-neighbor presentation; no smoothing

material differentiation:
Materials must differ through cluster shape and light response, not hue alone.

representation strategy:
Generated-but-native compound paths in an ordinary Vecmo group.

native-capability map:
- direct native: group/child selection, path fill, transform, motion, undo, save, SVG/runtime export
- generated-but-native: palette quantization, region extraction, row-run contours
- coordinated surrogate: semantic meaning inferred from contiguous color regions
- missing: model-provided editable layers, reliable named-part masks, linked cels, indexed PixelAsset editing

freeze list:
Preserve source aspect ratio, crop, grid origin, palette assignment, region
coordinates, and child order through the lowering transaction.

automatic rejectors:
- a low-resolution version of the photograph is presented as the AI result
- circular dots, automatic gaps, antialiasing, or fractional pixel placement
- one scene node per pixel
- a single bitmap is claimed as objectification
- more than the configured region/run budget is silently dropped
- large unexplained exterior padding survives normalization

pixel-only packet:
Source, generated candidate, normalized raster preview, and final Vecmo canvas at
Fit and 400% nearest-neighbor scale.
```

## Seven-Lens Implementation Decision

### Product quality

GPT Image owns semantic redrawing. Local code only canonicalizes the accepted
candidate; it must not pretend that quantizing a photograph is equivalent to
authoring pixel art.

### Editor UX

The user gives Codex either a verbal object brief or a PNG, JPEG, or WebP
reference and asks for pixel objects. Codex routes the source correctly, emits a
reviewable plan from the accepted pixel-art raster, validates the explicit live
editor target, and submits one `scene/append-pixel-art-objects` command. The
inserted parent group behaves like ordinary artwork: it can be selected, moved,
keyed, ungrouped, undone, saved, and exported. A first-party generation/import
surface is a follow-up, not part of the current V1 claim.

### Domain model

V1 does not change the frozen `NodeGeometry` union. It creates ordinary `path`
children inside an ordinary group. Each child stores import provenance in
`node.data.pixelObjectImport`; the parent also retains the compact palette and
indexed rows so a future native indexed renderer can reuse the authoritative
source without reverse-engineering contours.

### Rendering and performance

Logical output is bounded to 16-128 pixels on its longest edge, 2-32 palette
entries, at most 256 region objects, and at most 16,384 run contours. Matching
horizontal runs on consecutive rows coalesce into one taller rectangle. Each
retained run becomes one four-vertex contour inside its region path. The
implementation must never emit one Scene node per logical pixel.

The 128-pixel ceiling is a limit of this V1 **vector lowering**, not a limit of
pixel-art generation. A checked complex 128 field expanded an approximately 19
KB indexed plan into roughly 1.9 MB of path data. Blindly moving to 256 would
quadruple logical pixels and can multiply contour/serialization cost enough to
freeze validation, rendering, or export. Finer 256-512 work therefore requires a
native indexed `PixelAsset` that stores palette + rows and renders with
nearest-neighbor sampling, with a much smaller semantic region overlay for
selection and motion. Semantic segmentation into character, prop, foreground,
and background local grids is the nearer-term way to spend the existing 128
budget on actual subject detail rather than one whole-scene field.

### Implementation architecture

- Codex owns image generation and visual review in the primary workflow.
- `scripts/pixel-art-object-plan.ts` decodes a candidate and emits the compact,
  reviewable live edit plan.
- `worker/ai-pixel-art/` owns the optional authenticated same-origin Image API
  adapter, OpenAI request/response parsing, and safe errors.
- `features/pixel-object-import/model/` owns pure RGBA normalization, palette,
  accent preservation, and indexed-row creation.
- `entities/scene/model/pixel-art-object.ts` exclusively owns connected-region
  extraction, budgets, run compression, provenance, and native lowering.
- `entities/agent` and the live bridge own validation, approval, and one-step
  command-bus insertion.
- `entities/scene` remains the source of truth after the command is applied.

### Cloudflare and security

`OPENAI_API_KEY` is a Worker secret and never appears in client code, scene data,
logs, or responses. The endpoint is disabled by default, authenticates with the
existing Better Auth helper when enabled, rejects cross-origin requests, accepts
exactly one bounded image field, replaces the private client filename before
forwarding, returns `no-store` responses with no provider internals, and records
no source pixels. Do not enable it publicly until deployment-level rate/credit
accounting exists; the primary Codex workflow does not need this endpoint.

### Verification

Pure tests cover crop, palette mapping, chromatic-accent retention,
four-connectivity, run compression, determinism, caps, and node construction.
Worker tests cover origin and provider request/response parsing without a real
key. Browser QA must prove one undoable group insertion, selection, transform
and motion eligibility, and visual output.

## Generation Prompt Contract

The Worker constructs the production prompt; clients do not send arbitrary
provider instructions in V1.

```text
Redraw the supplied reference as original, hand-authored 2D pixel art for an
editable motion asset. Author it on an exact 128 by 128 logical pixel canvas and
present that canvas as an 8x nearest-neighbor enlargement to the 1024 by 1024
output: every logical pixel must be one aligned 8 by 8 square block, with no
sub-cell detail. Preserve the subject identity, silhouette, pose, composition,
major overlaps, and material distinctions, but redesign the image with deliberate
contiguous square-pixel color clusters and a limited role-based palette. Use
crisp hard pixel boundaries, readable large masses, controlled stair-step curves,
selective one-pixel accents, and dense intentional occupancy.
Do not apply a low-resolution photo filter. Do not use round dots, LED cells,
halftone circles, a visible grid, gaps between pixels, antialiasing, blur,
watermarks, text, or unexplained exterior padding. Keep foreground and
background separable through cluster shape and value.
```

## Boundary-Test Matrix

The first boundary reference must contain all of the following in one image:

- one articulated character with hair, face, layered clothing, hands, and a tool;
- thin structures crossing larger masses;
- foliage or similarly irregular organic edges;
- reflective or translucent material;
- smoke, mist, or another soft atmospheric region;
- foreground/background overlap and cast shadow;
- small high-contrast details near the logical-pixel limit.

Record:

- source and generated dimensions;
- crop percentage;
- logical grid dimensions and palette size;
- raw and retained connected-region counts;
- row-run contour count;
- generated Scene node count;
- conversion time and serialized byte estimate;
- visible losses: semantic merges, over-segmentation, lost thin lines,
  atmosphere banding, reflective-material collapse, and excess padding.

V1 is successful when the main silhouette and major parts survive as editable
children and the result stays within budgets. It is not a claim of automatic
named body-part segmentation. Regions are color/continuity objects; user-guided
merge/split, named semantic masks, native indexed `PixelAsset`, tiles, palettes,
and cel animation remain follow-up work.

## Recorded Complex Boundary Result

The first V1 boundary run used an original fantasy traveler reference containing
an expressive face and hair, layered cloth and leather, thin staff filigree,
glass and liquid, foliage, stone, mist, glow, reflection, cast shadow, and dense
occlusion. Codex generated the semantic pixel-art redraw before any local
quantization.

| Measurement | Result |
| --- | ---: |
| Source dimensions | 1,254 × 1,254 |
| Generated candidate dimensions | 1,254 × 1,254 |
| Exterior crop | 0% (the composition already occupied the frame) |
| Logical grid | 128 × 128 |
| Palette | 32 colors, including reserved cyan/purple/gold accents |
| Occupied logical pixels | 16,384 / 16,384 |
| Raw four-connected regions | 8,881 |
| Retained editable region nodes | 256 |
| Same-color regions aggregated into compound paths | 8,625 |
| Coalesced run contours | 11,060 |
| Scene nodes including parent | 257 |
| Serialized live plan | 18,432 bytes (repository-formatted JSON) |

The first 64 × 64 attempt failed visual review because cleanup changed small
regions to neighboring colors. V1 now preserves every palette index and meets
the node budget by aggregating disconnected small regions of the same color
inside compound paths. The adversarial review then found that the first 128
normalizer incorrectly gave partially covered source pixels full weight. The
record above is the corrected lattice-aware/coverage-weighted rerun: it retains
the character, staff, bottle, flowers, arch, and major lighting structure with
no exterior object padding, but it is **not accepted as the final visual-quality
bar**. Fine face/material detail still compresses, mist/reflections band, and the
whole scene competes for one 128 grid. That is the current native-vector boundary,
not evidence that finer pixel art is impossible.

Live validation and application targeted one explicit `editorInstanceId`. The
editor applied one scene transaction with zero issues; one Undo removed all 257
nodes, selection exposed a 512 × 512 parent with no padded bounds, and the normal
Transform inspector successfully created and undid transform keyframes.
Negative live validation also proved that an unknown artboard and a plan with two
pixel-art appends both fail closed before mutation.

## Operational Setup

The Codex workflow does not require a Vecmo Worker key. Generate or edit the
candidate in Codex, then create and review the plan:

```bash
bun run pixel-art:plan --input candidate.png --out pixel-plan.json \
  --name "Pixel objects" --origin 120,80 --pixel-size 5 \
  --long-edge 128 --palette 32 --artboard artboard-main
bun run vmactl -- live editors
bun run vmactl -- live validate --plan pixel-plan.json --editor <editorInstanceId>
bun run vmactl -- live apply --plan pixel-plan.json --editor <editorInstanceId>
```

The optional Worker Image API route requires `OPENAI_API_KEY` in an ignored
`.dev.vars*` file or a 1Password Environment mounted to that path. It also
requires the explicit non-secret opt-in `AI_PIXEL_ART_API_ENABLED=true`; keep the
flag absent until the deployment has quota/accounting controls. Production uses
a Wrangler secret:

```bash
bunx wrangler secret put OPENAI_API_KEY
```

`OPENAI_IMAGE_MODEL` may override the default model as non-secret configuration
for compatibility testing. Never commit either a real key or generated private
source imagery.
