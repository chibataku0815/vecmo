# Show/Hide Grid

Date: 2026-06-22.
Status: shipped discoverability fix.

## Summary

The canvas grid can now be hidden and shown from three discoverable places. A
single **Show/hide grid** toggle governs both grid layers a user perceives as
"the grid":

- the **workspace grid** — the full-viewport graph-paper grid over the desk /
  pasteboard, and
- the **artboard layout grid** — the grid drawn inside each artboard.

Before this change the workspace grid had **no toggle at all** (no key, no
command, no menu), and the artboard grid could only be toggled with the
undiscoverable `⌘'`. So a user looking at the grid had no findable way to turn it
off — exactly the "I can't hide the grid" complaint this resolves.

The **pixel grid** (`⌘⇧'`, zoom-gated, off by default) stays a separate
specialist toggle and is intentionally not folded into this one.

## What Users Can Do Now

- Hide or show every ambient grid line in one action, from whichever surface is
  closest to hand — no need to know a hidden keyboard chord.
- Right-click directly on the canvas (including empty canvas, where the grid is
  all there is) and toggle it from a **View** group.
- Hide the grid once and have it **stay hidden across reloads** — the preference
  is remembered per browser.

## How To Use

Any of these toggles the grid; all three route through the same switch so they
never disagree:

1. **Keyboard:** `⌘'` (Ctrl+' on Windows/Linux).
2. **Command palette:** press `⌘K` (or `⌘P`), type "grid", and pick
   **Show/hide grid**. A check appears when the grid is shown.
3. **Right-click the canvas:** choose **Show grid** / **Hide grid** under the
   **View** group. The label reflects the current state.

## What A Reviewer Should Verify

- `⌘'` hides **both** the desk graph grid and the in-artboard layout grid, and
  shows them again — in a single press, with no half-toggled state.
- The command palette lists **Show/hide grid**, it is always enabled (never a
  dead/greyed row), and its checkmark tracks whether the grid is shown.
- Right-clicking empty canvas opens a menu containing **Show grid** / **Hide
  grid**, and it toggles the grid.
- Regression guard: `⌥R` rulers, `⇧R` guides, and `⌘⇧'` pixel grid all still work
  independently and are unaffected by the rename and the new toggle.
- **Persistence:** hide the grid, reload the page, and it stays hidden; the
  visibility is restored from local storage at startup with no flash of the
  default.

## Still Intentionally Limited

- **Persistence is per-browser and local.** View preferences are saved to this
  browser's local storage, out-of-band from the document — not synced across
  devices and not part of an exported/imported scene. Clearing site data resets
  them to the default (grid shown). A corrupt or older payload falls back to the
  defaults field-by-field rather than failing.
- The **pixel grid** remains a separate `⌘⇧'` toggle.
- There is no per-artboard grid settings UI yet (spacing, subdivisions, color);
  its absence is why the desk and layout grids can share one toggle for now.

## Note For Maintainers

The command id `view.toggle-rulers` was renamed to `view.toggle-guides` in this
change: it always governed guide-line visibility (`⇧R`), never rulers, so the id
now matches its label and behavior. The new grid command is `view.toggle-grid`.
The `toggle-rulers` shortcut *intent* string (the real `⌥R` ruler toggle) is a
separate namespace and was deliberately left untouched. See
[show-hide-guides-global-toggle.md](./show-hide-guides-global-toggle.md).
