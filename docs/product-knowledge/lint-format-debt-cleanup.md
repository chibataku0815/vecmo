# Lint / Format Debt Cleanup

Date: 2026-07-05.
Status: internal.

## Summary

This is a formatting- and lint-only cleanup pass that unblocked `bun run check`
at the `biome check .` step. Eight files carried pre-existing Biome findings
(import ordering, formatter reflow, and one `noSwitchDeclarations` fix) that were
already on the branch tip, independent of any feature work. Each was fixed with a
per-file `bunx biome check --write <file>`. **No authoring, motion, export,
billing, worker, or runtime behavior changed** — the edits are import re-ordering,
whitespace/line-wrapping, and one switch-case block wrap.

This entry exists only because `check:product-knowledge` keys on changed paths:
six of the touched files live under product-facing prefixes
(`src/features/**`, `src/widgets/**`, `worker/**`), so the gate requires a
`docs/product-knowledge/` note even though the change is pure code hygiene. It
documents that this was mechanical debt cleanup, not a capability change.

## What Changed

| File | Fix |
| --- | --- |
| `src/features/look-authoring/model/look-graph-commands.ts` | `lint/correctness/noSwitchDeclarations` — wrapped the `case "grain.angle":` body in `{ }` |
| `src/features/noise-gradient/canvas/handler.ts` | Formatter reflow (ternary) |
| `src/features/noise-gradient/model/axis.ts` | `organizeImports` — sorted the `@/shared/vec-core` import group |
| `src/shared/gpu-lens/surface.ts` | Formatter reflow (collapsed a `gl.uniform1i(...)` call) |
| `src/widgets/inspector/model/frame-look-editing.ts` | `organizeImports` — sorted the `@/shared/vec-core` import group |
| `worker/admin/guard.ts` | `organizeImports` — sorted the `../account/db` import |
| `scripts/dev-production-cloud.ts` | Formatter reflow (multi-line call/signature wrapping) |
| `src/features/billing/ui/BillingEntry.tsx` | Formatter reflow (ternary indentation) |

The last two were introduced by the branch-tip commit `297e86bd`
("Add production-cloud local dev mode") after the original debt was catalogued;
they are the same pure-formatter class and were fixed in the same pass.

## Why It Matters

`bun run check` runs `biome check .` first, so these findings blocked the entire
static gate. Clearing them lets the gate reach — and pass — its remaining checks.

## What Should A Reviewer Verify?

- `git diff` shows only import ordering, whitespace/line-wrapping, and the single
  `case "grain.angle":` block wrap — no changed identifiers, literals, or control
  flow.
- `bun run check` passes.

## What Is Still Limited?

- Nothing behavioral. This is a mechanical cleanup with no follow-up work.
