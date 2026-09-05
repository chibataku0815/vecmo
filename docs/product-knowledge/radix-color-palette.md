# A Searchable Radix Color Palette In Every Picker

Date: 2026-06-28.
Status: shipped a searchable, full-spectrum swatch palette in the shared color picker.

## Summary

The color picker's built-in swatches were a single hard-coded row of ten arbitrary
colors — enough to seed recents, useless for actually *finding* a color. Picking a
considered, harmonious color meant leaving the app or eyeballing the HSV plane.

The swatch row is now the complete **Radix Colors** palette — 31 professionally tuned
scales (grays, the full hue wheel, browns, and bright accents), each as its 12-step
ramp from near-white to near-black. Critically, it is built to make a color
**findable**, not just available:

- **Type to filter.** A search field narrows the list to a family by name — type
  `jade` and only the jade ramp remains.
- **The picker shows you where you are.** The family nearest the shape's current color
  is highlighted, and the list scrolls to it the moment the picker opens. The exact
  step lights up when the current color *is* a Radix color.
- **The hex field is now a palette locator.** Paste or type any `#rrggbb` into the hex
  box and the list jumps to the Radix family that color belongs to — so an imported or
  eyedropped color is instantly placed in a palette you can pivot around.

This is a single shared surface, so the palette appears everywhere the color picker
does: the Inspector's fill and stroke, gradient stops, and gradient-mesh points. Only
Radix's solid light scales are used — every step is a plain 6-digit hex the scene model
already accepts, so no swatch can produce a color the document cannot save. Recents, the
screen eyedropper, the hex/RGB fields, and "No fill" are unchanged.

## What the user can do now

- Browse the entire Radix palette inside the color picker instead of one fixed row of
  ten colors, scrolling a spectrum-ordered list of named 12-step ramps.
- Search the palette by family name (e.g. `blue`, `tomato`, `jade`) to jump straight to
  a scale.
- Open the picker on any shape and immediately see which Radix family its current color
  is closest to, highlighted and scrolled into view.
- Paste a hex into the hex field and have the list locate that color's Radix family.
- Click any step in any ramp to apply it as a flat fill or stroke; it is committed as a
  single undo entry and pushed to recents.

## How the user operates it

- **Open the palette:** select a shape → in the Appearance section click the **Fill**
  (or **Stroke**) swatch to open the picker. The Radix palette sits below the hex/RGB
  fields, under any recents.
- **Find a family:** type a name into **Search colors…** to filter to matching scales;
  clear it (or press `Escape` while it has text) to restore the full list.
- **Read "you are here":** the family nearest the current color has a brightened label
  and a ringed step; the list auto-scrolls to it on open and after each committed edit.
- **Locate a pasted color:** type or paste a `#rrggbb` into the hex field and press
  Enter — the list scrolls to the nearest Radix family and rings the matching step.
- **Apply a color:** click a step in a ramp (hover shows its name and hex, e.g.
  "Blue 9 · #0090ff"). The fill/stroke updates and the color enters recents.

## What a reviewer should manually verify

- Open the fill picker on a shape → a **Search colors…** field and a scrollable list of
  named Radix ramps appear below the hex/RGB fields; the list is scrolled so the family
  nearest the current color is visible with its label highlighted.
- Type `jade` → only the **Jade** ramp remains; clear the field → all 31 scales return.
- Click a step (e.g. Jade 9) → the shape's fill changes to that hex, the hex field and
  swatch update, and the color appears in recents as one undo entry.
- Type `#e5484d` into the hex field and press Enter → the list scrolls to **Red** and
  rings **Red 9** (the exact match).
- Confirm the same palette appears for **Stroke**, for **gradient stops** (gradient
  tool), and for **gradient-mesh points** (mesh tool).

## What is still intentionally limited

- Only Radix's **solid light** scales are offered. The alpha and Display-P3 variants are
  excluded because their 8-digit / `color(display-p3 …)` values are not in the scene
  model's accepted color set.
- Nearest-family matching is a fast perceptual RGB approximation (redmean), tuned to
  pick the right *family*, not to rank steps with full Lab/ΔE precision.
- The palette applies a **flat color**. It does not author gradients or meshes — those
  remain the paint-type rows of the picker (see `unified-fill-paint-picker.md`).
- The list auto-scrolls to the active family on open and on commit, not when a search
  filter is cleared; clearing search returns the list to the top.
