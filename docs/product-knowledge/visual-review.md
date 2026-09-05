# Visual Review Workspace

Date: 2026-07-11.
Status: beta.

## Summary

Vecmo now has a detached, session-only workspace for comparing a frozen scene
frame with local reference pixels before implementation facts are shown. It is a
review sensor, not an aesthetic scorer: it separates technical capture fidelity
from the critic's visual verdict and leaves final aesthetic acceptance with the
user.

## What Changed?

- **Visual review** in the top bar, or **Toggle visual review** in the command
  palette, opens a dedicated detached window.
- The current artboard and playhead frame are frozen by content revision. The
  candidate still uses the SVG + GPU raster compositor shared with WebM frame
  construction; font readiness and asynchronous SVG/GPU passes complete before
  PNG encoding.
- A source change before or during capture invalidates the packet. Blank output,
  lost contexts, tainted canvases, oversized raw surfaces, and renderer fallback
  issues are typed blockers rather than accepted pixels.
- Local reference files are decoded and re-encoded into fresh session PNGs.
  Filename, path, and embedded source metadata are not retained; the resulting
  object URLs are revoked when the workspace closes or resets.
- The comparison surface provides synchronized Fit, 100%, and an optional
  selected-object edge probe, plus side-by-side, blink, swipe, pan, and zoom.
- A monochrome diagnostic is derived from the same frozen baseline. Diagnostics
  are optional: unsupported diagnostics stay in the private manifest and never
  make a native baseline incomplete. Grain-off is not mandatory.
- A/B roles are randomized. Candidate identity, renderer facts, frame metadata,
  and diagnostic names remain hidden until the critic locks one terminal, one
  largest visible residual, and a confidence level.
- Native or imported candidate dimensions must match the frozen output.
  References may use a different source resolution because this is
  reference-relative review, not pixel equivalence; Fit/probe views align by
  normalized composition while 100% preserves each source's real pixels.

## How To Use

1. Pause on the frame to review. Select a top-level object first when a material
   or edge probe is useful.
2. Open **Visual review** and import local reference pixels.
3. Capture the frozen Vecmo candidate, or import an exact-size candidate image.
4. Review A/B pixels using Fit, 100%, the probe, blink, or swipe.
5. Choose `Visual reject`, `Retry one residual`, `User review ready`, or
   `Critic uncertain`; name the largest visible residual and lock the verdict.
6. Reveal technical facts only after that visual decision.

`User review ready` is not a pass. The producer cannot accept its own work, and
only the user supplies final aesthetic acceptance.

## What A Reviewer Should Verify

- Changing the scene, motion, grammar bindings, artboard, or playhead after the
  window opens makes native capture return `source_changed`.
- A native packet exposes Fit and 100% without retaining multiple raw 4K
  surfaces; a top-level selection adds a bounded edge probe.
- A/B roles and technical metadata stay hidden until verdict lock.
- A mismatched candidate cannot enter pixel review; a different-resolution
  reference remains undistorted and its 100% view remains source-native.
- Reset and close revoke all reference/candidate preview URLs.
- A no-grain document completes normally and no grain-off requirement appears.
- An SVG/export issue makes the baseline `approximated` and blocks native review
  instead of silently promoting it.

## What Is Still Intentionally Limited?

- Browser, 4K memory, GPU-context recovery, and cross-surface visual parity have
  not been run in this task because tests, build, typecheck, and browser smoke
  were not authorized. The feature remains beta until that verification occurs.
- The editor host auto-configures monochrome only. Contributor bypass is generic
  in the packet contract but requires stable contributor ownership; ambiguous
  glow, atmosphere, grain, or other owners are reported rather than guessed.
- A nested selection does not synthesize a potentially incorrect edge crop. Fit
  and 100% remain available; callers can supply an explicit normalized probe.
- Review pixels and verdicts are intentionally not persisted, synced, exported,
  or turned into an automatic aesthetic score.
