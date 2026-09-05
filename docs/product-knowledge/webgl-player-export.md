# Motion / Code WebGL Runtime

Date: 2026-06-27.
Updated: 2026-07-10.
Status: verified for renderer-neutral camera/runtime integration; browser parity,
bounded request handling, generated declarations, and freshness gating passed.

## Summary

The **Motion / Code** export automatically switches to a self-contained WebGL
runtime when the scoped artboard contains GPU raster Look graph effects or
video media. It mounts one transparent canvas, renders the real SVG export into
a texture, materializes video frames in the browser when needed, applies the
same GPU raster Look passes used by editor/video rendering, and exposes a
deterministic player API for GSAP or any host event source.

Unlike the Motion / Code SVG runtime, this path is designed for raster-fidelity
effects such as Lens, Flow, Kaleidoscope, Noise Source, GPU Composite, Deep
Glow, vec-core Particle Dissolve / Noise Gradient, and browser-playable video
media. Users do not choose a separate export mode; the export path selects the
SVG runtime or WebGL runtime from the authored content. The same Web Embed,
Production, and Editable profiles apply to this generated WebGL payload:
Production projects out hidden content and editor-only metadata before embedding
the scene/motion data into a `*.webgl-player.data.json` payload. It also removes
runtime-unused editor state and production-only display names, then reuses
`vector-motion-webgl-runtime.js`.

When a document-level scene sequence contains a GPU-required artboard, the
export now keeps the sequence as one WebGL payload and one host timeline. The
runtime resolves the active artboard and local frame before presentation
sampling, reuses one canvas, and resizes its backing surface only when a cut
changes artboard dimensions.

## What Users Can Do Now

- Export through **Export -> Motion / Code** and, when any scoped target needs GPU
  raster rendering or contains video media, receive WebGL player code plus HTML.
  Editable keeps the payload embedded in `*.webgl-player.js`; Web Embed /
  Production split it into runtime JS plus `*.webgl-player.data.json`.
- Choose Web Embed, Production, or Editable from the Motion / Code export menu
  without manually selecting SVG versus WebGL.
- Use the Production WebGL output to avoid repeating the browser player source
  for every artboard; scoped artboards share the runtime and keep their own data.
- Drop any generated module into a web page and call the renderer-neutral
  `mountVectorMotion(container, { source })`. Legacy WebGL-specific mount names
  remain compatibility aliases.
- Use `mountVectorMotionWebglOverlay(...)` or
  `mountVectorMotionWebglOverlayFromUrl(...)` when the host page wants Vecmo's
  transparent output layered over external video, VJ surfaces, signage, or
  browser-source compositing. The runtime manifest advertises that overlay
  mount export and the transparent-output capability.
- Drive `player.progress`, `seekFrame()`, or `seekProgress()` from GSAP,
  ScrollTrigger, a custom scrubber, or host application state. Fractional frames
  are preserved exactly as in the SVG runtime.
- Synchronize another renderer from `onFrameSampled()`, observe committed
  snapshots through `onFrameRendered()` / `subscribe()`, and read or temporarily
  override the same resolved camera state exposed by SVG output.
- Read `snapshot.scope` to distinguish global sequence time from the active
  artboard's local frame. An out-of-scope artboard camera override becomes
  dormant at a cut and resumes on a later compatible item instead of rejecting
  or freezing playback.
- Receive a paired `.d.ts`, runtime manifest `playerApi` block, and—when enabled—the
  same React facade implementation as SVG output. Inline callback changes and
  component-prop updates do not recreate the WebGL surface.
- Preserve transparent pixels outside the artboard/source content when the host
  page places the canvas over its own background.
- Materialize referenced video assets per frame before the SVG prefix and GPU
  Look passes are drawn, so Display / Pixel / Print looks can be exported as
  runtime overlays on video-backed scenes instead of falling back to the SVG
  placeholder path.
- Preserve Particle Dissolve field modes (Circular contour, Linear angle, and
  Field Mesh) through the same TextureRecipe-to-GPU adapter used by the editor
  and WebM capture.

## How To Use

1. Author a scene whose Frame Look graph uses GPU raster effects.
2. Choose the export scope in the top bar.
3. Open **Export -> Motion / Code** and choose Web Embed, Production, or Editable.
4. Use the generated HTML for a quick page, or import the generated JS module:

```js
import { mountVectorMotion } from "./vector-motion-webgl-runtime.js";

const player = await mountVectorMotion(
  document.querySelector("#player"),
  {
    source: { kind: "url", url: "./my-scene.webgl-player.data.json" },
    autoplay: false,
  },
);

gsap.to(player, { progress: 1, duration: player.duration, ease: "none" });
```

For host-composited overlays, mount into an absolutely-positioned layer above
the host media:

```js
import { mountVectorMotionWebglOverlayFromUrl } from "./vector-motion-webgl-runtime.js";

const player = await mountVectorMotionWebglOverlayFromUrl(
  document.querySelector("#vecmo-overlay"),
  "./my-scene.webgl-player.data.json",
  { autoplay: true, fit: "cover" },
);
```

## Verification Performed (2026-07-02)

A live browser pass exercised the real export path on a video-backed scene
with a GPU Look (Pixel Grid): the generated Editable module was imported and
mounted with `mountVectorMotionWebglPlayer` (video frames render with the
Look, upright, artboard background transparent over a checkerboard) and with
`mountVectorMotionWebglOverlay` (full-container transparent overlay
compositing over live page content). Seeking is deterministic: repeated
`seek(0)`/`seek(90)` produced pixel-identical frames, and distinct frames
differ. The same pass fixed a pre-existing vertical mirror in every GPU
raster presentation and a WebM recording race that could silently drop GPU
passes — see the WebM export notes and
`docs/look-effects-pack-handoff.md` §6 (bugs 3 and 5).

The camera/runtime matrix was rerun on 2026-07-10 with generated Editable
artifacts for SVG and WebGL, single scenes and a two-item mixed-size scene
sequence, plus the generated React wrappers. The browser trace confirms one
global sequence timeline, fractional global/local scope at both sides of the
cut, camera parity, dormant/resuming artboard-scoped active override, one WebGL
surface resized at the cut, sampled-before-rendered hooks, bounded latest-wins
requests, disposed settlement, stable external-store snapshots, latest React
callbacks without remount, and no material hook-overhead regression. The
recorded result is
`artifacts/camera-runtime-verification/browser-verification.json`.

Note the overlay mount's contract: it takes over the container's `position`,
size (100%), and background — the host supplies a positioned parent and its
own backdrop behind it.

## Manual Verification

1. Build the reference glow-sphere chain: Gradient or Noise Source -> Flow -> Lens ->
   Deep Glow.
2. Export **Motion / Code** and open the generated HTML on a checkerboard or
   high contrast background.
3. Confirm there is a single canvas, no opaque artboard rectangle outside the
   rendered content, and the rim/glow composite remains visually continuous.
4. Scrub `player.progress` from 0 to 1 and confirm repeated seeks land on the
   same frame.
5. Try a GSAP or ScrollTrigger tween against `player.progress`.
6. Import a short video, add Pixel Grid or Halftone, export **Motion / Code**,
   and confirm the WebGL player shows moving video frames with the Look effect
   instead of the static video-placeholder rectangle.

## What Is Still Intentionally Limited

- The export is beta until a browser visual pass confirms the transparent Deep
  Glow alpha behavior on the reference glow-sphere chain.
- Static SVG/PDF/vector export remains intentionally unsupported for GPU raster
  effects and playable video. The WebGL runtime is the code/runtime path for
  those looks.
- A WebGL player renders one artboard per canvas. Multi-artboard export produces
  separate player pairs for the scoped artboards rather than one combined page.
- The player exposes typed camera-channel replacement, not arbitrary node or raw
  object-path mutation. Overrides are instance-local and never serialize.
- Video media still depends on browser decode/seek behavior and same-origin or
  data URL accessibility. Large embedded video data URLs can make WebGL payloads
  heavy; external references remain host/CORS-sensitive.
- The runtime bundle is generated at development time and embedded into the
  exported JS module. Regenerate it with `bun scripts/generate-webgl-player.ts`
  after changing the player entry or its browser dependency graph — INCLUDING
  `shared/gpu-lens/surface.ts`. `bun run check:webgl-player` re-bundles the entry
  and fails when the committed snapshot is stale; regeneration remains the fix.

## Related Docs

- [Motion Code Runtime Export](./motion-code-runtime-export.md)
- [Effect capability contract](./effect-capability-contract.md)
- [Current capabilities](./current-capabilities.md#15-export)
