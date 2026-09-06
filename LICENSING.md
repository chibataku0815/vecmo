# Licensing

Vecmo is open core. Copyright (C) 2026 Takumi Chiba (fores-tone). The editor is
AGPL-3.0-only, plus an added permission over what you export
(`LICENSES/LicenseRef-Vecmo-Runtime-Output-Exception.txt`).

## What you can do

- Self-host, read, fork, and modify the source.
- Embed anything you export -- `*.runtime.js`, `webgl-player.js`, their
  generated `.d.ts`, and scene / motion / `.vecmo-backup.json` documents -- in
  proprietary sites, apps, and client deliverables, under whatever terms you
  like. You owe nothing back for the exported artifact. This is the Vecmo
  Runtime Output Exception (an AGPL section 7 additional permission, modeled on
  the GCC Runtime Library Exception); keep its notice in any copy of Vecmo
  itself that you pass on. Sell what you make; your documents are yours.

## What triggers AGPL

- Modify the editor and run it as a network service -- anything users reach over
  a network, including an internal tool -- and you must offer those users the
  complete corresponding source of your modified version. Distributing a
  modified editor carries the same obligation. An unmodified Vecmo run
  privately triggers nothing.
- The exception covers the exported artifact only. It does not relicense the
  editor, the export templates, or the generators.

## What is not here

The vecmo.dev cloud backend -- accounts, billing, hosted storage, job
processing, private pages -- is proprietary and is not published. It is
denylisted at export, so `worker/`, `drizzle/` and `wrangler*.jsonc` are absent
from the public repository rather than AGPL-licensed.

## MIT developer layer

MIT, so you can vendor or fork them without AGPL obligations:
`packages/editor-kernel/**`; `src/entities/agent/model/**`; `scripts/vma-*.ts`;
`scripts/vmactl.ts`; `scripts/agent-bridge-*.ts`; and, in
`src/features/export/model/`, `runtime-player-declarations.ts`,
`runtime-player-control.ts`, `runtime-manifest.ts`, `runtime-react-template.ts`.
`REUSE.toml` is authoritative. An MIT file may still import AGPL modules; the
MIT grant covers that file's own text, not the modules it imports. If you build
a program combining these files with the rest of Vecmo, the combined work is
AGPL-3.0-only.

Contributions are accepted under the license of the file you touch.
Questions: chiba@fores-tone.co.jp
