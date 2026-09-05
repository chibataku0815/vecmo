# Live MCP Agent Runbook

Use this whenever a user asks an agent to open, connect, or operate Live MCP
against the running editor.

## Freshness Gate

Live MCP changes faster than agent memory. Before giving setup advice or calling
live tools:

1. Read this runbook and the Live Editor Bridge section of
   `docs/agent-mcp-setup.md`.
2. If MCP tools are not visible yet, discover/load the `vector-motion-author`
   MCP server instead of guessing tool names.
3. After the server is connected, read `vma://docs/agent-contract` when the MCP
   resource is available. The resource and current tool descriptions are the
   canonical contract for tool names, argument shapes, approval behavior, and id
   semantics.
4. Inspect `package.json` before quoting command names if there is any doubt.

Do not run smoke commands or test-like verification unless the user explicitly
asks for testing in the current task.

## Opening Live MCP

There are two supported bridge paths.

### Local Relay Path

Use this for the normal local dev editor. Use `dev:production-cloud` only when
the user needs the local Worker to authenticate/save as the production D1/R2
user/workspace.

```sh
bun run agent:bridge
bun run dev
# or, only for production-user local auth/cloud save:
bun run dev:production-cloud
```

Open `/editor` in the local dev app and keep that tab open. The editor connects
to the loopback relay through Vite discovery. The MCP client runs:

```sh
bun run mcp:agent
```

For this path, live tools normally omit the `bridge` argument; they discover the
local relay.

### Explicit Bridge Session Path

Use this when the editor is opened with an explicit agent bridge session:

1. Open `/editor?agentBridge=1`.
2. Copy the MCP bridge config shown by the MCP chip.
3. Pass that config as the live tool's `bridge` argument, or set
   `VMA_AGENT_BRIDGE_BASE_URL`, `VMA_AGENT_BRIDGE_SESSION_ID`, and
   `VMA_AGENT_BRIDGE_TOKEN` for the MCP process.

## Multi-Editor Target Gate

Do not assume the most recently connected tab is the live target. Before an
observe/apply/save sequence, list the relay's connected editors:

```sh
bun run vmactl -- live editors
```

When more than one editor is connected, pass `--editor <editorInstanceId>` to
the CLI live command or set `VMA_AGENT_BRIDGE_EDITOR_ID` for MCP. The client
resolves that id to the editor's full target descriptor; the editor then checks
its working copy, cloud project, and binding epoch before mutation. An absent or
ambiguous target must fail closed.

For parallel worktree validation, prefer named sessions so app and relay ports
remain isolated:

```sh
bun run session -- start <name>
bun run session -- list
bun run session -- exec <name> -- bun run vmactl -- live editors
```

## Required Live Tool Order

Start with a read-only live observation:

- `observe_selection` reads the running editor selection and proves which bridge
  session is connected. It never mutates and never prompts.
- `validate_edit_plan_live` reviews a typed plan against the live document
  without mutation. Created ids from this result are provisional; never chain
  them into a later command.

Only then use mutating live tools:

- `apply_edit_plan_live` applies a typed plan through the same command bus as a
  human edit. It normally waits for the editor approval banner, or applies
  immediately only if the human enabled auto-apply trust mode. For created ids,
  use `result.appliedCommands[].affected`; it is the committed per-command
  mapping.
- `save_project_live` saves the currently open live editor document through the
  cloud-project save path. In `dev:production-cloud`, this writes the signed-in
  production user's cloud-project workspace after approval.

If a live tool reports no relay, session, or editor, stop and report the bridge
state. Do not switch to headless `apply_scene_commands`,
`apply_motion_commands`, or `apply_motion_grammar_commands` as a fallback for
current-editor work.

## Headless vs Live

Headless tools (`apply_scene_commands`, `apply_motion_commands`, and
`apply_motion_grammar_commands`) run against a seed or file-scoped document
snapshot and return updated JSON payloads. They do not touch the open editor and
do not save files.

Live tools (`observe_selection`, `validate_edit_plan_live`,
`apply_edit_plan_live`, and `save_project_live`) go through the bridge to the
running editor. Use these for current editor state, current selection,
approval-gated edits, and cloud project saves.
