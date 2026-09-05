# Agent Bridge Auto-Apply Trust

Date: 2026-07-05.
Status: shipped, opt-in.

## Summary

Production bridge sessions normally show a decision banner for every proposed
edit plan: a human clicks approve or reject before anything mutates. That
per-plan click is safe but breaks the fluid AI live-authoring loop the product
is built around, and a slow human response can trip the MCP client's own
120-second wait. Local dev bridge sessions use a separate development
auto-approval policy for apply/save requests so implementation loops do not
stall on the banner; see
[Agent Bridge Development Auto-Approval](./agent-bridge-dev-auto-approval.md).

The editor now offers a human-controlled "auto-apply" trust mode. Once a
person turns it on, `apply_edit_plan_live` plans apply immediately with no
banner click — but every applied edit stays ambiently visible and undoable.
Nothing changes for production bridge sessions where the user does not opt in:
the default remains "ask every time," exactly as before.

## What Users Can Do Now

- **Turn on trust from two surfaces**, both human-only:
  - The **MCP bridge chip**'s popover (top chrome, opt-in remote sessions
    only) has an "auto-apply edits" row with an on/off toggle.
  - The **approval banner**'s pending edit-plan card has a third action,
    "approve, and auto-apply from now on," alongside the existing
    reject/approve buttons — clicking it approves the current plan and turns
    the trust mode on for future plans in the same motion.
- **See the bridge mode at a glance**: the collapsed chip keeps the transport
  label stable (`MCP · Remote` for opt-in remote sessions, `MCP · Local` for the
  local dev relay). Auto-apply trust is shown in the tooltip and popover so it
  cannot be mistaken for the local relay state.
- **Watch auto-applied edits land** as non-blocking activity toasts in the
  same bottom-center slot the approval banner uses — each shows the plan's
  intent, which command store it touched (scene / motion / motion-grammar) and
  how many commands applied, and a warning count when the plan reported any.
  Up to 3 toasts show at once, newest first; each auto-dismisses after about 7
  seconds or can be dismissed manually.
- **Undo the most recent auto-applied edit** with an undo button on the newest
  toast only — it dispatches the same per-store undo primitive the global
  Cmd+Z shortcut uses for that store. The button disappears once the document
  changes again (a further undo/redo, or a new edit), since undoing the store
  at that point would no longer revert this specific edit; a static hint is
  not shown in that case — the affordance simply goes away.

## Scope and Boundaries

- **Edit plans only.** Project saves (`save_project_live`) are never
  auto-approved by this persisted toggle, regardless of its state. They still
  follow the bridge approval policy: local dev bridge auto-approves; production
  bridge sessions go through the approval banner.
- **Human-only control.** The agent/MCP side has no way to read, set, or
  request this toggle — it is an editor-local UI preference. Inside the
  editor, the approval object recorded for an auto-applied plan carries
  `autoApplied: true` so the auto path is honestly distinguishable from a
  human click; the agent never sets that field, and it does not cross the
  wire — the bridge response payload is unchanged.
- **Applies on both bridge transports** (the local dev relay and an explicit
  production bridge session opened from `/editor?agentBridge=1`) — the toggle
  is editor-side state, not tied to one connection. On local dev bridge
  sessions the development auto-approval policy already approves apply/save, so
  this toggle mostly matters for production bridge sessions and future non-dev
  pairings.
- **Persisted per browser**, not per session or per remote pairing: the choice
  is written to `localStorage` under
  `vector-motion-author:agent-bridge-trust:v1` and defaults to off (ask every
  time) whenever that value is missing or unreadable.
- **No new undo machinery.** Every auto-applied edit still lands as one
  ordinary undoable transaction in its owning command store; this feature adds
  no selective/inverse-command undo and no new public store APIs.

## Source

`src/features/agent/model/approval-store.ts`;
`src/features/agent/model/editor-bridge.ts`;
`src/features/agent/model/trust-persistence.ts`;
`src/widgets/agent-bridge/ui/AgentApprovalBanner.tsx`;
`src/widgets/agent-bridge/ui/McpBridgeChip.tsx`; `scripts/vma-agent-mcp.ts`.

Related: [Agent Bridge Development Auto-Approval](./agent-bridge-dev-auto-approval.md).
