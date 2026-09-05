# Vecmo Architecture

A Cloudflare Workers-ready, Figma-class **vector + motion authoring editor** — mature
(~665 source files across the Feature-Sliced layers below), not a shell. This file is the
**conceptual** layer: stack, responsibility boundaries, deployment. For **operational navigation**
(where each subsystem lives, how it flows, its invariants and blast-radius) see
**[`docs/codemap.md`](codemap.md)**.

## Stack

- Runtime/package manager: Bun
- UI: React 19 + TypeScript 7
- Dev/build: Vite 8 with Rolldown and the Cloudflare Vite plugin
- Styling: Tailwind CSS 4 via the first-party Vite plugin
- Icons: Phosphor Icons
- Edge runtime: Cloudflare Workers + Workers Assets
- API surface: Hono on Workers
- Quality gate: Biome 2 + Oxlint + TypeScript build
- State: Zustand
- Validation-ready dependency: Zod

## Responsibility Boundaries

- `app`: bootstrapping, global styles, providers
- `pages`: route-level composition
- `widgets`: stable editor surfaces such as canvas, layers, inspector, timeline
- `features`: user actions and tool behavior
- `entities`: scene, artboard, layer, vector node, style, timeline domain model
- `shared`: pure helpers and generic UI primitives

These responsibilities form a hard downward dependency graph:

```text
app -> pages -> widgets -> features -> entities -> shared
```

- A slice may import within itself, from a lower-ranked same-layer sibling when
  that order is explicitly declared in `check:arch`, or from a lower layer.
  Upward and cyclic imports are forbidden. One feature must never import another
  feature; shared behavior moves down and workflow composition moves up.
- The scene document has one durable write path through the owning entity
  command bus. Feature code must not mutate scene or motion document stores
  directly.
- Renderers, exporters, motion bridges, and agent/MCP integrations adapt the
  scene model; they do not own competing document state.
- The Worker remains outside the client layer graph and may not import client
  UI or browser-only code.

These are correctness invariants, not organizational suggestions.
`scripts/check-architecture.ts` (`check:arch`) enforces the dependency graph,
ranked same-layer seams, feature isolation, command-bus writes, Worker isolation,
and ToolId ownership. See
[`docs/product-knowledge/architecture-boundaries.md`](product-knowledge/architecture-boundaries.md)
for the enforced contract and `docs/codemap.md` for operational ownership.

The scene model is the source of truth. Renderers, geometry libraries, exporters,
and AI/motion bridges should be adapters around that model.

## Shared Editor Platform Boundary

Vecmo consumes the private `@motion-surface/editor-kernel` package from the
Motion Surface Studio root workspace. The Kernel owns only domain-agnostic
action projection/execution, primary and alias shortcut matching, input
candidate generation and precedence, gesture/history ports, neutral geometry,
and revision-save protocol. React, DOM/platform inspection, Zustand stores,
Scene/Motion/Grammar commands, persistence, rendering, export, and delivery stay
inside Vecmo.

`widgets/action-surface/model/editor-actions.ts` is the only global product
action and shortcut authority. `ActionSurface.tsx` adapts DOM input and current
editor context, then projects the same definitions into global dispatch,
command palette, shortcut help, TopBar labels, and manual save. Canvas and
feature overlays retain only genuinely local behavior: Space pan/playback,
preview or perform Escape, arrow nudge, active-tool keys, touch/iPad routing,
rulers, pixel grid, and camera-cut scopes. Do not add page, Canvas, Layers, App,
or chrome-store listeners/constants as a second global shortcut authority.

Manual save is local-first. `App.tsx` flushes the hydrated Working Copy, saves
the active cloud project only when this editor owns its writer lease, then
flushes the resulting cloud pointer locally. Every asynchronous cloud save uses
the exact attempt ID returned by `beginSave()` through settlement, agent result,
TopBar notice, and busy-label ownership. Superseded results fail closed.
Reference-scene sessions do not mount persistence hooks and expose Save as
unavailable.

## Deployment Boundary

The editor is a browser-heavy SPA. It should ship as Workers Assets, while
server/API work lives behind `worker/index.ts`.

Initial routing:

- Static editor shell: served by Workers Assets
- `/api/health`: handled by Hono in the Worker
- Other `/api/*`: JSON 404
- Other non-asset routes: fallback to the SPA asset binding

TanStack Start and React Router framework mode remain viable later if SSR,
server functions, or route data loading become product requirements. They are
not part of the initial editor shell because the first useful surface is
canvas-heavy and client-runtime dominant.
