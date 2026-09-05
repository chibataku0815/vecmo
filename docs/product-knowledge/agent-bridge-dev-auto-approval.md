# Agent Bridge Development Auto-Approval

Date: 2026-07-09.
Status: shipped internal development policy.

## Summary

Local development bridge sessions auto-approve mutating live agent requests so
implementation loops do not stall on an editor approval banner. This applies to
the local dev relay path only:

```sh
bun run agent:bridge
# open /editor in a Vite dev build
bun run vmactl -- live apply --plan plan.json
bun run vmactl -- live save
```

The auto-approval is editor-owned. The agent still sends an ordinary
`apply_edit_plan_live` or `save_project_live` request; the editor decides that
the local dev bridge may approve it.

## What Changes In Dev

- `apply_edit_plan_live` applies without parking an approval banner.
- `save_project_live` saves without parking an approval banner.
- Both paths still run through the live editor bridge, `validateAgentCommandPlan`,
  the normal command bus, and the usual undoable transaction path.
- The MCP bridge chip reads `MCP · Local` for connected local dev sessions and
  the popover shows that development auto-approval is on.
- Failed validation, no relay, no editor, blocked plans, cross-store live plans,
  and orphan-motion protection still return typed errors instead of falling back
  to a sandbox.

## What Does Not Change

- Production bridge sessions opened with `/editor?agentBridge=1` remain
  human-gated by default.
- The persisted "auto-apply edits" trust toggle remains a separate
  human-controlled preference. It mainly matters for production bridge sessions
  and future non-dev pairings.
- Project saves are never covered by that persisted trust toggle. They only skip
  the banner through the local development bridge auto-approval policy.
- The agent cannot set `approved` or `autoApplied`; those fields are created by
  the editor approval wrapper.
- No arbitrary JavaScript execution is introduced. Agent writes still use typed
  scene/motion/motion-grammar command envelopes.

## Implementation Pointers

- Local dev auto-approval lives in
  `src/features/agent/model/editor-bridge.ts` as `developmentAutoApprove`.
- `createEditorBridgeConnection` defaults `developmentAutoApprove` to `true`.
- `createProductionEditorBridgeConnection` does not enable it by default.
- Edit-plan and project-save approval wrappers return
  `{ approved: true, reviewer: "dev-editor", autoApplied: true }` in a Vite dev
  build when `developmentAutoApprove` is enabled.
- `src/widgets/agent-bridge/ui/McpBridgeChip.tsx` exposes the dev state as
  `MCP · Local` instead of a redundant toggle.
- `AgentCommandPlanApproval.autoApplied` documents that short-circuited approval
  can come from either human-granted trust or the local dev bridge policy.

## Reviewer Checklist

- Local dev relay: `bun run agent:bridge` + `/editor` + `vmactl live apply`
  should mutate without a pending approval card.
- Local dev relay: `vmactl live save` should follow the cloud-project save path
  without a pending approval card.
- Production bridge session: `/editor?agentBridge=1` should still show the
  approval banner unless the human enabled persisted auto-apply trust.
- The local dev chip should show `MCP · Local`; production remote sessions should
  keep the transport label `MCP · Remote` even when auto-apply trust is on.
- Undo behavior after an auto-approved edit should remain the same command-store
  undo behavior as any other live apply.

## Related Knowledge

- [Agent Bridge Auto-Apply Trust](./agent-bridge-trust.md)
- [Agent Bridge Status Chip](./agent-bridge-status-chip.md)
- [Cloud project save/open](./cloud-project-save-open.md)
- [Current capabilities - AI agent / MCP](./current-capabilities.md#21-ai-agent--mcp)
- [Agent MCP setup](../agent-mcp-setup.md)
