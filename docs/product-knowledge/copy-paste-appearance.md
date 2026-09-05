# Copy / Paste Appearance

Date: 2026-06-23.
Status: shipped completeness + discoverability fix.

## Summary

"Copy properties / Paste properties" — the action that takes one object's whole
look and applies it to other objects — is now **honest and reachable**. Two
things changed:

1. **It now carries the full appearance.** Before, copy captured only the base
   `NodeStyle` (fill, stroke, opacity, effects, blend, dashes) and **silently
   dropped the per-node "look" (the inline vec-core `recipe`: color grade,
   surface, texture, glow, optics, shadow, distortion, stylization)**. So
   "inherit all of this object's style" was a half-truth — paste a styled object
   onto another and its grade/grain/glow would not travel. Paste now copies the
   look wholesale (including the motion sub-recipe, which is inert in the sampler
   and so cannot make a static target start animating), plus the
   `stroke-dashoffset` phase. The already-working part — fills, **including
   gradients and gradient meshes** — is unchanged and still cloned independently
   per target.

2. **Paste finally has a shortcut and a clearer name.** Paste previously had **no
   keyboard shortcut at all**, so the feature was effectively invisible. The pair
   is renamed to **Copy appearance** / **Paste appearance** (the word users map
   to fill + stroke + effects + look), and searchable by `appearance`, `look`,
   `match`, `inherit`, `style`, and `properties`.

This is the answer to "how do I make these objects inherit that one's style?" —
e.g. propagating a center object's gradient (and its grade/grain) to its
neighbors.

## What Users Can Do Now

- Copy one object's **entire appearance** — fill/gradient/mesh, stroke, effects,
  blend mode, opacity, dashes, **and its look (grade/texture/glow/etc.)** — and
  paste it onto **any number of selected objects at once**, as a single undo.
- Reach Paste appearance directly from the keyboard, not just hunt for it.
- Trust that "paste appearance" really means the whole look, so two objects end
  up visually matching, not just sharing a fill.

## How To Use

1. Select the **source** object (the one whose look you want to inherit).
2. **Copy appearance:** `⌘⌥C` (Ctrl+Alt+C), or open the command palette (`⌘K` /
   `⌘P`) and type "appearance" / "copy appearance".
3. Select the **target** object(s) — one or many.
4. **Paste appearance:** `⌘⌥⇧V` (Ctrl+Alt+Shift+V), or the command palette
   ("paste appearance" / "inherit" / "match style"). Every selected target adopts
   the copied appearance in one action; the targets stay selected.

`⌘⌥V` (the shortcut Figma uses for this) is already taken here by distribute-
vertical, and `⌘⇧V` by paste-in-place, so paste appearance takes the next combo
in the same family — it reads as "the heavier paste" and pairs with `⌘⌥C` copy.

## What A Reviewer Should Verify

- **Gradient propagation (the headline case):** give one object a gradient (or
  gradient mesh) fill, Copy appearance, select two other objects, Paste
  appearance — both adopt the gradient. Editing one target's fill afterward must
  not change the others (independent clones).
- **Different-size refit:** put a radial gradient on a **large** circle, Copy
  appearance, paste onto a **smaller** circle — the gradient must fill the small
  circle (centered, scaled down), not overflow it with the large circle's
  coordinates. Pasting between **same-size** objects must stay pixel-identical to
  the source (no drift).
- **Look travels:** give the source a per-node Look, Copy appearance, paste onto
  a plain object — the target must **render** the same look on canvas, not merely
  carry the data. (The per-node look render tier approximates some optics, so
  confirm visually; source and target should match because they share the same
  recipe.)
- **One undo:** pasting onto N targets collapses into a single undo entry that
  restores every target at once.
- **Recipe-only paste is not dropped:** if the source and targets already share
  the same base style but the source has a look the targets lack, paste must
  still apply the look (it must not report "already matches").
- **No-op honesty:** pasting onto a target that already matches everything still
  reports a no-change, and incompatible parts (typography onto a non-text node)
  still warn rather than corrupt the target.

## Still Intentionally Limited

- **Anisotropic radial gradients become circles.** Gradient and mesh paints now
  **refit to the target's size** (a gradient copied from a large object fills a
  smaller one instead of overflowing). The one residual is that a radial gradient
  pasted onto a target with a different width-to-height ratio renders as a circle
  sized to its larger axis — the pre-existing renderer model for radials, not a
  paste regression. The user's same-shape case (circle → circle) is exact.
- **Corner radius is not part of appearance yet.** It lives in geometry, not
  `NodeStyle`; including it (gated to matching shape kinds) is a planned
  follow-up.
- **Animation/keyframes do not travel.** Only the static look plus the look's
  motion *feel* are copied; per-node keyframe tracks and clips live in a separate
  motion document and are out of scope for appearance paste (a distinct
  Copy/Paste Motion feature would own that).
- **Frame-scoped looks are not propagated.** A cinematic look applied at the
  artboard/frame level (or as a selection-scoped overlay) is owned by the frame,
  not the object, so it is not part of an object's copied appearance.
- **The copied appearance is held in-session.** It is not a persisted clipboard
  and does not survive a reload.

## Note For Maintainers

Implementation extends the existing pure feature
(`src/features/style-transfer/model/style-transfer.ts`) only: the payload gained
optional `recipe` and `strokeDashoffset`, applied inside the same single atomic
`SceneCommand` loop (one undo). The recipe is written raw (no
`normalizeVisualRecipe`) because it round-trips from an already-valid source
node. The no-change gate in `planTarget` was extended in lockstep so a
recipe-only paste is not silently dropped or falsely flagged "no style change".
The Paste shortcut required widening the `styleTransferActionMetadata` shortcut
tuple type to admit a third modifier.

Gradient/mesh refit lives in a pure entities helper
(`src/entities/scene/model/paint-bounds.ts`): the payload also captures the
source node's intrinsic `sourceBounds`, and `planTarget` remaps each paint from
those bounds into the target's own `getNodeLocalBounds` before the diff. The
remap short-circuits (returns the original paint reference) for same-size or
degenerate bounds, which is what keeps the same-size paste byte-identical. Paint
transforms are conjugated `S∘T∘S⁻¹` via the existing `composeMatrix`; mesh paints
are rebuilt without their cached `dataUrl` so the raster bridge re-rasterizes from
the moved points.
