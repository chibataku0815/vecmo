# Agent Live Selection

Date: 2026-06-26.
Status: live agent bridge capability.

## Summary

An agent driving the editor over the live bridge could validate and apply typed
plans, but it could not see what the user had selected — every command needs an
explicit node id, and the bridge never reported the live selection. That forced
the user to read an internal node id out of the document and hand it to the
agent, which is the wrong contract: authoring should target what the user
selected, the same as any editor action.

The live review result now carries `selectedNodeIds` — the node ids selected in
the editor when the review was produced, primary last. An agent observes the
selection by validating against the live document (no commands needed), then
authors a plan against those ids.

## What This Enables

- "Select the star, then ask the agent to spin it." The agent reads the live
  selection from a `validate_edit_plan_live` review and authors the rotation
  against the selected node — the user never types an internal id.
- The selection reflects the editor's real selection store at review time. With
  nothing selected, `selectedNodeIds` is empty, so the agent can tell the user to
  select a target instead of guessing.

## How It Works

- `AgentCommandPlanResult.selectedNodeIds?` (entities/agent) is the new optional
  field. Only the LIVE bridge populates it; headless reviews omit it.
- The editor stamps it in `editor-bridge.ts` via `withLiveSelection`, reading a
  `getSelectedNodeIds` getter injected from the app layer
  (`useSelectionStore.getState().nodeIds`). `features/agent` must not import
  `features/selection`, so the getter is injected rather than imported — the
  selection read lives in `app/App.tsx` where that import is legal.
- It rides the existing validate/apply response (no new bridge op). The bridge
  message is parsed by typeguard (no field stripping), so the field survives the
  relay → MCP hop unchanged.

## Manual Verification

1. Open the editor with the live bridge connected (`/editor?agentBridge=1`).
2. Select one node on the canvas.
3. From the agent, call `validate_edit_plan_live` (document target, no commands)
   and confirm the result's `selectedNodeIds` lists the selected node.
4. Select nothing and confirm `selectedNodeIds` is empty.

## Known Limits

- Surfaces selection only; it does not yet enumerate the full live scene. An
  agent still needs the user to select a target (or supply an id) when authoring
  against an unselected node.
- Read-only: the agent observes the selection, it cannot change it. Authoring
  still lands only through the approval banner.
