# Frame Look Recall — Analog Film

Date: 2026-06-22. Updated: 2026-06-29.
Status: first production slice, selection-sensitive recall.

## Summary

The Inspector's five per-node `Look (vec-core)` presets (Aura, Glow, Film,
Faded, Noir) are removed. They were generic color grades applied per object and
their five command-palette twins (`effect.frame-look.*`) had the same problem:
too many named looks, not enough production-quality texture.

In their place there is exactly **one** recallable look: **Analog Film**. It is
a soft analog-film treatment — fine additive grain over a slightly
de-saturated, gently lifted grade, with a faint cyan/orange chromatic-aberration
edge available on the frame path. It is selection-sensitive: with objects
selected it writes an object-scoped look overlay (`effectIntent.scopedLooks`) on
the owning artboard, targeting only those node ids; with nothing selected it
writes the broad frame recipe onto the artboard or scene `effectIntent`.
The selected-object button does not mutate the selected node recipes and does
not write the broad frame `visualRecipe`. The selected `Look` section keeps a
visible **Selection overlay** state label plus a **Remove from selection** button;
when active, it subtracts the selected node ids from that scoped look instead of
clearing the whole artboard. The no-selection `Frame Look` section also keeps
**Remove frame look** visible for clearing the current Frame/Scene pass.

It is one canonical recipe (`ANALOG_FILM_LOOK_RECIPE`) shared by both the Time
Delay motion materialization and the recall, so tuning the texture in one place
keeps the other in lockstep.

## What Users Can Do Now

- Apply the Analog Film treatment in one click. With objects selected, the
  per-node `Look` section creates a **Selection overlay** for those object ids
  only; it does not edit object material. With nothing selected, the `Frame Look`
  section applies the frame treatment to the current artboard or scene.
- Remove the selected-object treatment from the current selection without
  disturbing siblings, unrelated scoped looks, or any broad frame treatment.
- Remove a no-selection Frame/Scene treatment from the same `Frame Look` section
  that applied it.
- Choose whether the no-selection recall applies to the current artboard (`Frame`)
  or the whole document (`Scene`) via the `Frame Look` section's `Scope` selector.
- Recall the same look from the command palette: search "Analog Film".
- After recalling, keep dialing object-local grade/grain/glow with the per-node
  `Look` sliders, or deselect and use the manual `Frame Look` sliders for the
  frame recipe ("recall, then tweak").
- Add a radial or linear `Influence` mask when the film pass should be limited
  to part of the frame. The editor canvas keeps the unfiltered frame visible and
  composites the Analog Film grain/chromatic pass only through that active mask;
  unsupported active mask sources suppress the pixel pass instead of falling back
  to a broad all-objects application.
- Still grade individual objects directly with the per-node `Look` sliders
  (Exposure / Contrast / Saturate / Grain / Noise / Glow / RGB split). Only the
  named presets were removed; per-object parameter control stays.

## How To Use

1. Select objects and use the `Analog Film` button in their `Look` section to
   apply the look to the selection. Deselect first when the intended target is
   the whole frame.
2. For the no-selection `Frame Look` section, leave `Scope` on `Frame` (current
   artboard) or switch to `Scene`.
3. Click the **Analog Film** button.
4. The selected objects show the film grain + frame-consistent
   chromatic-aberration edge in their own layer positions, or the current frame
   gains that pass broadly.
5. Optionally adjust the manual `Look` / `Frame Look` sliders to taste.
6. Optionally add a radial or linear `Influence` mask to confine the frame
   preview pass without changing object recipes.
7. Use **Remove from selection** to subtract the current selection from the
   scoped look, or press undo once to remove the last apply/remove command.
   Clicking the apply button again when the exact scoped look is already applied
   still does nothing (no undo flood).

## What A Reviewer Should Verify

1. With an object selected, the per-node `Look` section shows an `Analog Film`
   button captioned `Selection overlay` / `Selection overlay · on` /
   `Selection overlay · partial`.
2. Clicking the selected-object button writes one owning-artboard
   `effectIntent.scopedLooks` entry whose target ids match the selection. It
   must not write `effectIntent.visualRecipe`, `effectIntent.influenceRecipe`,
   or the selected node's own `recipe`.
3. With nothing selected, the Inspector `Frame Look` section shows an
   `Analog Film` button above the manual sliders.
4. Clicking the no-selection frame button changes the canvas: a film-grain
   overlay filter and a chromatic-aberration `feDisplacementMap` appear in the
   CanvasShell `<defs>`, and the artboard reads grainier with a faint colored
   edge.
5. One undo clears either apply path; a second click while already applied adds
   no new undo entry.
6. The `Scope` selector is respected: `Scene` writes the document-level look,
   `Frame` writes the current artboard.
7. The per-node `Look` section no longer shows the five preset chips; it shows the
   `Analog Film` selection button plus the manual grade/grain/glow sliders,
   which still edit the selected object directly.
8. Adding a radial/linear influence narrows the editor canvas frame pass.
   Selected-object Analog Film stays separate: the live nodes remain normal hit
   targets, CanvasShell renders a decorative full-artboard filtered overlay, and
   the final output is clipped to the selected silhouettes so the
   artboard/background/sibling nodes remain visually unchanged.
9. Command palette: searching "Analog Film" offers one apply action, checked
   when the current frame already carries the look.

## Known Limits / Honest Expectations

- **It reproduces the film treatment, not the dark dots.** The Time Delay demo
  dots look near-black because they have dark fills (scene content), not because
  of the look. Recalling the look onto light-colored artwork applies the grain +
  chromatic edge but does not recolor objects. Grain is luminance-weighted, so
  the same recipe reads differently on light objects than on the demo dots.
- **Frame/scoped looks are not yet rasterized into SVG/PDF export.** The grain +
  chromatic aberration pass lives in the editor canvas. Selected-object Analog
  Film is persisted as scoped look intent and rendered live in CanvasShell;
  faithful raster export is still deferred.
- **Influence narrowing is editor-canvas-only today.** It prevents the live
  Analog Film preview from coating every object when a radial/linear frame
  influence is active. Export/runtime surfaces still preserve the frame look and
  influence as side-car data until faithful frame-look raster output lands.
- **Selected-object recall samples frame optics but outputs only the selected
  objects.** CanvasShell runs the scoped film pass over a decorative full
  artboard source so chromatic aberration uses the same optical field as the
  broad frame pass, then clips the result back to the selected silhouettes. Use
  per-node `Look` sliders when you need direct object-local grade/grain/glow
  edits.
- **One look, by design.** There is intentionally no family of intensity
  variants; range comes from the manual frame sliders today, and a single
  intensity multiplier on this one look is the planned next step rather than
  fabricated sibling presets.

## Related Docs

- [Time Delay motion system](./time-delay-motion-system.md)
