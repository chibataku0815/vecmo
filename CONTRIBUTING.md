# Contributing

## Dev setup

```sh
bun install
bun run dev
```

`bun run build` builds; `bun run check` runs every static gate below plus a full `tsc -b`. Run `check` before opening a PR.

## Static gates (`bun run check`)

- `check:arch` — enforces the `app -> pages -> widgets -> features -> entities -> shared` dependency direction, declared same-layer import order, feature isolation, and ToolId ownership.
- `check:source-disposition` — keeps files that must survive the public export tree in the right place.
- `check:authoring-parity` — checks that motion-grammar techniques, bindable properties, and effect descriptors each declare their authoring-capability status, so no capability gap goes undocumented.
- `check:tokens` — chrome styling must use semantic design tokens; no raw one-off hex/px values.
- `check:agent-contract` — keeps the agent command contract (typed commands, compiler, runtime guards, MCP tool schemas) in sync across all four places it is manually mirrored.
- `check:product-knowledge` — see below.
- `check:public-english` — public-facing copy (README, `docs/product-knowledge`, public pages) must be in English.
- `check:runtime-sampler`, `check:webgl-player` — freshness gates; re-bundle the runtime sampler and WebGL player from source and fail if the committed generated bundle is stale.
- `check:runtime-player-declarations` — compiles real TypeScript consumers against the generated `.d.ts` files.
- `check:reference-scenes`, `check:reference-scenes-fresh` — run every bundled reference scene through the real deserialize/render/validate path and check its fixture is current.
- `check:residual-closure` — guards the repo's planning-evidence register; not a product gate.

## Architecture rule

Changes must respect the layer graph above: a layer may import its own slice, a lower-ranked same-layer sibling where `check:arch` declares that order, or a lower layer. No upward or cyclic imports, no feature importing another feature. `check:arch` fails the build otherwise. See [`docs/architecture.md`](docs/architecture.md).

## Product-knowledge rule

If your change touches product-facing source (`src/app`, `src/pages`, `src/widgets`, `src/features`, `src/entities`, or `src/shared/ui`), add or update a page under `docs/product-knowledge/`. `check:product-knowledge` fails the PR otherwise. See [`docs/product-knowledge/README.md`](docs/product-knowledge/README.md) for the expected shape.

## Tests

No test suite ships in this repo. Verification is the static gates above.

## Issues

Bugs and reproducible export problems are welcome. The maintainer is solo and triages weekly; there is no SLA.

## Sign-off

Contributions are accepted under the license of the file you touch (AGPL-3.0-only or MIT — see [LICENSING.md](./LICENSING.md) and `REUSE.toml`). Please add a `Signed-off-by: Your Name <email>` line to your commits (`git commit -s`) certifying you have the right to submit the change (Developer Certificate of Origin, https://developercertificate.org).
