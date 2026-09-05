# Architecture Boundaries

Date: 2026-07-03.
Status: internal.

## Summary

`scripts/check-architecture.ts` (`check:arch`, part of `bun run check`)
statically enforces the Feature-Sliced layer boundaries this codebase is
built on. This is a reference for what that gate checks today, not a
changelog of one fix — it documents the standing contract so a contributor
can look up "is this import allowed?" without reading the gate script. This
is an internal tooling doc: it does not change any authoring, motion, or
export behavior.

## What The Gate Enforces

**Layer direction (downward-only).** `src/` is split into `app -> pages ->
widgets -> features -> entities -> shared`, ranked highest to lowest. A file
may import only from its own layer or a strictly lower one; upward imports
are an error. `src/main.tsx` is the one allowed top-level file outside a
layer directory.

**No feature-to-feature imports.** `src/features/<a>/` may not import from
`src/features/<b>/`. Shared behavior between features belongs in `entities`
or `shared`; workflows needing both are composed in `widgets`/`pages`.

**Same-layer slice sub-order (entities, widgets).** Within `entities` and
`widgets`, each top-level slice folder has a rank, and a value-level import
may only reach a strictly lower-ranked sibling in the same layer — the same
no-upward, no-cycle rule as the cross-layer check, one level down.
**Type-only imports (`import type`/`export type`, erased by
`verbatimModuleSyntax`) are exempt**, since they create no runtime
dependency; a known legitimate case is `entities/scene` reading
`entities/motion`'s grammar-bridge types. A slice missing from the rank map
is flagged rather than silently allowed.

Current measured ranks (0 = lowest):

```
entities: platform 0, scene 1, guides 2, motion 3,
          motion-grammar 4, component-motion 5, agent 6

widgets:  canvas-shell, layers-panel, tool-rail, agent-bridge,
          look-workspace, parameter-capture, timeline, tool-options,
          component-motion — all rank 0 (no cross-slice deps today)
          action-surface, inspector — rank 1 (compose the rank-0 leaves)
          top-bar — rank 2 (composes action-surface + agent-bridge)
```

This reflects the measured dependency direction: `scene` is foundational,
`motion` samples/animates scene nodes, `motion-grammar` compiles onto
motion, `component-motion` links motion across component instances, and
`agent` reads/writes all of the above for the MCP bridge. In `widgets`, the
leaf editor surfaces have no cross-slice dependencies; `action-surface`/
`inspector` compose those leaves, and `top-bar` composes `action-surface`
(plus `agent-bridge` for MCP status).

**Worker boundary.** `worker/` is checked independently of `src/`:

- May import `@/entities/*` and `@/shared/*`, same as any other consumer.
- Must not import `@/app`, `@/pages`, `@/widgets`, or `@/features` — those
  are client-only layers; the Worker never renders UI.
- Must not import `"react"`, `"react-dom"`, or their subpaths, by value or
  type — same reason: no UI-rendering library belongs in server code.
- A `node:*` sub-rule was scoped but is a no-op here: `wrangler.jsonc`
  already sets `compatibility_flags: ["nodejs_compat"]` (Better Auth needs
  `node:crypto`), so `node:` imports are accepted, not restricted.

**Other invariants the same gate enforces** (for completeness): the scene
model (`src/entities/scene/model/`) stays DOM-free; `features/**` mutates
the document only through the command bus, never a raw
`useSceneStore`/`useMotionStore` `setState`; and exactly one canvas-tool
handler may register a given `ToolId`.

## Why It Matters

These are the invariants `CONTRIBUTING.md` describes in prose
(downward-only imports, no feature-to-feature coupling, worker/client
separation, the scene model as source of truth). Machine-checking them means
a regression fails `bun run check` immediately instead of surfacing later as
a harder-to-trace layering or Cloudflare-runtime problem.

## What Should A Reviewer Verify?

- `bun run check` passes, in particular `check:arch`.
- A new top-level slice under `src/entities/` or `src/widgets/` is added to
  the rank map in `scripts/check-architecture.ts` before it takes on any
  cross-slice dependency; otherwise the gate reports it as unrankable.

## What Is Still Limited?

- The same-layer check covers only `entities` and `widgets`; `features` is
  already fully flat (no feature-to-feature imports at all), so it needs no
  sub-order.
- Rank numbers are a measured snapshot, not a permanent design; they are
  expected to shift as slices are added or refactored, and the map must be
  updated alongside such changes.
- The type-only exemption trusts `verbatimModuleSyntax` to keep type-only
  imports fully erased.
