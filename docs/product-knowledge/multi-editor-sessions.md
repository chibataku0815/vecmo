# Multi-editor sessions

Date: 2026-07-12.

## Summary

Vecmo can keep multiple editor tabs or windows open without sharing one browser
autosave slot. Each editor has an `EditorInstanceId`, a URL-stable
`WorkingCopyId`, an optional cloud `ProjectId`, and a monotonic `BindingEpoch`.
Scene, motion, and motion grammar are persisted as one project-backup snapshot
per working copy.

## User workflow

- Project rows and revision rows expose **Open new editor**. The native link
  opens an isolated editor runtime and supports normal browser tab/window
  behavior.
- Reloading an editor keeps its `workingCopy` URL locator and restores only that
  copy.
- Opening an already-owned Working Copy URL in another tab forks to a new URL
  and clones the source's latest durable snapshot before editing begins.
- When two editors open the same cloud project, one holds the **Writer** lock.
  Others show **Review · Take over** and cannot autosave over the writer. Review
  editors can take over explicitly or save as a separate cloud copy.
- Browser titles include the project name and a short working-copy suffix, so
  operating-system tab/window switchers remain distinguishable.

## Safety contract

- Cloud updates remain revision-conditional through `baseRevision`.
- An async save result is accepted only while editor instance, working copy,
  project binding, and binding epoch still match its start fence.
- Local MCP relays register every editor descriptor. With multiple editors, a
  live request must select `editorInstanceId`; implicit last-connected routing
  is forbidden. The editor rechecks optional working-copy/project/epoch fields
  before apply or save.
- Authored document content is excluded from the diagnostic ring. Diagnostics
  contain only timestamps, identity metadata, persistence fallback, and writer
  mode changes.

## Developer workflow

`bun run session -- start <name>` starts a named Vite + agent-bridge session with
ports derived from the absolute worktree path and session name. Add
`--production-cloud` for the signed-in production-data path. `bun run session -- list`
reports cwd, branch, ports, URL, mode, and liveness without revealing bridge
tokens; `bun run session -- stop <name>` stops the owning process.
Run a CLI/MCP command against one named relay without printing its token via
`bun run session -- exec <name> -- bun run vmactl -- live editors`.

`bun run vmactl -- live editors` lists connected editor descriptors. Pass
`--editor <editorInstanceId>` to live observe/apply/save commands, or set
`VMA_AGENT_BRIDGE_EDITOR_ID`.

## Limits

- This is parallel independent editing, not collaborative CRDT editing.
- Writer ownership is origin-local; server revision conflicts remain the final
  cross-device safety boundary.
- A review editor does not receive live document changes from the writer. Reopen
  the latest cloud revision or save a fork when divergence is intentional.
