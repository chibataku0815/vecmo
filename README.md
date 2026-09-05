# vecmo

Open-source vector motion editor that exports dependency-free runtime code.

## Quick start

```sh
bun install && bun run dev
```

## Scope

This repository is the editor itself: it runs fully in the browser, `/` opens the editor, and nothing here talks to a server.
The vecmo.dev hosted service (accounts, cloud projects, billing) is a separate private backend and is not included.

## Export sizes (measured, gzip -9)

- `hello-motion` reference scene, Export → "Motion / Code — self-contained embeddable artifact (EMBED)": 48.2 KB
- Effects-heavy reference scenes (grain, masks, motion grammar) with the same profile: 115–150 KB
Reproduce: `bun run dev`, open `/?ref=hello-motion`, Export → EMBED, gzip the `vector-motion-runtime.js` inside the zip.

## License

See [LICENSING.md](./LICENSING.md).
