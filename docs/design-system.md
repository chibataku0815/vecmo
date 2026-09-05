# Design System

Canonical design rules for `vector-motion-author`. **Read this before adding or
restyling editor chrome.** It is the judgment layer: it covers what the automated
guard (`scripts/check-design-tokens.ts`, run as `check:tokens` in `bun run check`)
**cannot** enforce. Where a rule here can be machine-checked, it already is — so a
green `bun run check` means you followed the enforceable half of this document.

## 1. The one rule

**Chrome consumes semantic tokens, never raw values.** Every color and the chrome
type size come from the token layer in `src/app/styles/index.css` (`:root` raw
vars bridged to Tailwind utilities via `@theme inline`). No raw hex / `rgb()` /
`hsl()` in chrome class names, no arbitrary `text-[Npx]`. The token layer is the
single place a value is defined, so the design cannot silently decay back into
one-off colors. This half is enforced by `check:tokens`.

## 2. The palette split (the load-bearing concept)

There are **three** color worlds. Do not mix them.

| World | Where | Color source | Enforced |
| --- | --- | --- | --- |
| **Chrome** | panels, toolbars, menus, buttons, inputs — everything in `widgets/*`, `pages/*`, `app/*`, `shared/ui/*` (except `overlay/`) | semantic tokens (`bg-surface-raised`, `text-fg-muted`, `border-accent`, `var(--color-warn)`) | ✅ `check:tokens` |
| **Canvas workspace** | the canvas surface itself: grid, artboard shadow, selection/handle overlays, SVG presentation attributes | a separate, zoom-stable palette — `--color-overlay-*` tokens via `fill-*`/`stroke-*` class names where possible, named hex in raw SVG `fill="…"`/`stroke="…"` attributes (which cannot resolve `var()`) | exempt: `features/*/canvas/`, `shared/ui/overlay/`, `widgets/canvas-shell/ui/` |
| **Scene data** | document paint stored on nodes (`node.style.fill`, seed/fixtures) | literal hex — it is serialized DATA the user authored and exporters assert exactly; tokenizing it would corrupt export | exempt: `entities/` |

The canvas workspace is intentionally **not** part of the chrome token system: it
must stay stable over arbitrary artwork at any zoom, so it owns its own palette.

## 3. Chrome tokens (the catalog)

All exist as both `--color-*` (CSS) and Tailwind utilities (`bg-accent`,
`text-fg-muted`, …). Opacity modifiers work via color-mix (`bg-surface/85`).

| Group | Tokens | Use for |
| --- | --- | --- |
| Accent | `accent`, `accent-fg`, `accent-surface`, `accent-strong` | primary action / selection / active state |
| Warn | `warn`, `warn-fg`, `warn-surface` | locked / caution / non-blocking issue |
| Danger | `danger`, `danger-fg`, `danger-surface` | destructive / error |
| Foreground | `fg`, `fg-secondary`, `fg-muted`, `fg-subtle` | text & icons, brightest → dimmest. `fg-muted` = active labels, `fg-subtle` = disabled/placeholder/Mixed (do not collapse these two) |
| Surface | `surface`, `surface-raised`, `surface-sunken`, `surface-light` | panel/menu backgrounds, sunken wells, light artboard |
| Structural | `ink`, `hairline`, `scrim` | strokes, 1px dividers, modal scrims |
| Overlay (canvas) | `overlay-accent`, `overlay-accent-line`, `overlay-handle`, `overlay-handle-deep`, `overlay-handle-disabled`, `overlay-ink`, `overlay-on-dark`, `overlay-warn` | canvas-workspace only — decoupled from chrome accent on purpose |

## 4. Typography — flat, single size

Chrome type is **one size: `text-ui` (10px)**. Panels, toolbar, timeline, modals,
headers, values, names — all 10px. Hierarchy comes from **color + at most
`font-medium` (500)**, never a second size, never `uppercase` / `tracking` /
`bold`. (Add `--text-micro` only for a reviewed dense-cell overflow.)

Trap, now documented in `index.css`: a `button, input { font: inherit }` reset
**must** live in `@layer base`, or it beats every `text-*` utility and chrome
renders at the inherited 16px. If a `text-*` class isn't taking, suspect an
unlayered reset first.

## 5. Components & interaction primitives

- **Right-click menus** → `src/shared/ui/ContextMenu.tsx` (the single primitive;
  data-driven `groups`/`items`). It always owns right-click within its children
  (suppresses the native menu) and renders the surface only when there are items.
- **Chrome interaction primitives** (menus, dialogs, popovers, combobox/palette,
  number fields) → **Base UI** (`@base-ui/react`). It gives positioning, roving
  focus, ARIA roles, focus return, and dismissal for free. NOT for the canvas
  (hand-rolled). The command palette's combobox a11y is hand-rolled ARIA, not Base
  UI, because it wraps a registry-driven list — that is a deliberate exception.
- **Icons** → Phosphor (`@phosphor-icons/react`).
- **Conditional classes** → `cn()` (clsx wrapper) from `@/shared/lib/cn`.

## 6. Enforced vs. judgment

**Machine-enforced** (`bun run check`): no literal color in a chrome class-name
arbitrary value (`shadow-[…#f4c430]`, `[box-shadow:…rgba()]`); no `text-[Npx/rem/em]`;
FSL import direction (`check:arch`); biome/oxlint.

**Judgment (this doc, not checkable):** the palette split, the flat-type
philosophy, "menus → ContextMenu, interaction → Base UI", and which token *role*
fits a given element. Reviewers enforce these.

## 7. Known guard limitations (don't rely on the guard for these)

The guard is scoped to **class-name arbitrary values** to avoid false-positiving
data. It does **not** catch:

- raw color in inline `style={{ … }}` (could be data-driven, e.g.
  `style={{ backgroundColor: chipColor }}` from scene data — must stay allowed);
- raw color in SVG `fill="…"`/`stroke="…"` attributes (prefer `fill-*`/`stroke-*`
  token class names; named hex is the documented fallback since attributes can't
  resolve `var()`);
- white/black alpha utilities (`bg-white/[0.08]`) — tolerated as neutral
  hairline/hover alphas, not part of the semantic token set.

When you touch these by hand, apply Section 2 yourself.

## References

- Tokens & guard: `src/app/styles/index.css`, `scripts/check-design-tokens.ts`
- Origin & rationale: `docs/design-system-tokens-and-headless-ui-plan.md`
- UI/UX direction: `docs/figma-ui-ux-recommendations.md`
- Repository task router and global safeguards: `CONTRIBUTING.md`

This document is the sole detailed source of truth for editor-chrome design
rules; `CONTRIBUTING.md` only declares when it must be read.
