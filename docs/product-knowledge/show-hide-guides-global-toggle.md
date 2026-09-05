# Show/Hide Guides Is a Global Toggle

Date: 2026-06-22.
Status: shipped command-reliability fix.

## Summary

The **Show/hide guides** command (Shift+R, also in the command palette) is now a
global view toggle that is **always available** — like Show/hide grid and
Show/hide rulers. It no longer disables itself when the document has no guide
lines.

Previously the command toggled each guide line's individual `visible` flag, so
with zero guide lines there was nothing to toggle and the command went disabled
with the reason "Create a guide line before toggling guide visibility." In the
command palette it read as a greyed-out, un-pressable row — a dead command.

The product shift is:

- Show/hide guides now flips the global `guideLinesVisible` view preference (the
  master switch the canvas already honors), instead of per-line visibility.
- The command is always enabled and pressable, even on a fresh document with no
  guides. The preference is remembered and applies the moment a guide is added.
- Its checkmark state reflects whether guides are currently shown.

This follows the same principle as the Space play/pause fix: a command shown to
the user should execute when pressed, not sit dead. Commands that are genuinely
unavailable (e.g. Align with nothing selected) still disable correctly — that is
a real precondition, not a dead command.

## What Users Can Do Now

- Press Shift+R (or pick "Show/hide guides" in the command palette / `⌘K`) at any
  time to hide or show all guide lines, regardless of whether guides exist yet.
- Pre-set the preference before drawing guides; newly created guides respect the
  current show/hide state.

## How To Use

1. Open the editor.
2. Press `⌘K` (or `⌘P`) and type "guide", or press Shift+R directly.
3. "Show/hide guides" toggles guide-line visibility. A check appears when guides
   are shown. Hiding guides also suppresses guide snapping.

## What A Reviewer Should Verify

- On a fresh document (no guide lines), "Show/hide guides" is **enabled** in the
  command palette and Shift+R does something (flips the preference) instead of
  no-op'ing.
- With guide lines present, toggling hides/shows them on the canvas and the
  command's checkmark tracks the state.
- Hiding guides also disables snapping to guide lines; showing restores it.
- The plain `R` shape-tool key and Alt+R ruler toggle are unaffected.

## Still Intentionally Limited

- This is the global guide-lines visibility switch. Per-line show/hide (for an
  individual guide) remains a separate, guide-specific affordance.
- Rulers (Alt+R), the grid (`⌘'`, see [show-hide-grid.md](./show-hide-grid.md)),
  and pixel grid (`⌘⇧'`) are separate view toggles with their own keys; this
  command only governs guide lines.

## Note For Maintainers

This command's id was `view.toggle-rulers` — a misnomer, since it has always
toggled guide lines (`⇧R`), never rulers. It is now `view.toggle-guides`, so the
id matches its label and behavior. The `⌥R` ruler toggle is unrelated and lives
in the guide shortcut-intent layer, not this command.

