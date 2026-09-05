# Orphaned Motion Recovery

Date: 2026-06-26.
Status: production editor recovery surface.

## Summary

Deleting a scene node is scene-only: it never touches the motion side-car or the
motion-grammar layer. A node that owned keyframe tracks or was the target of a
motion-grammar technique therefore leaves those tracks/bindings behind, now
pointing at an id that no longer exists. The agent validator flags every such
dangling reference as an error, and a single orphan makes the whole document
fail the live-agent apply gate — so an unrelated agent edit is hard-blocked, and
there was previously no way to clear the orphans (the agent bridge self-blocks on
the very errors a removal would clear) and no signal to the user that anything
was wrong.

The editor now **detects orphaned motion from document state alone** and repairs
it automatically after scene hydration, before stale references can block live
agent editing. The always-mounted agent banner remains as a fallback only if a
repair pass somehow leaves orphaned tracks or bindings behind.

## What Users Can Do Now

- Open an already-broken document and have orphaned tracks / motion-grammar
  bindings removed automatically through the editor's own command stores, with no
  bridge session required.
- Use the fallback **Repair** button only if the automatic pass cannot fully clear
  the document. It reruns the same command-store cleanup and re-opens the agent
  apply gate.
- Live agent `validate` / `apply` now reports the same pre-existing orphaned
  tracks or bindings as typed blocking issues, so an MCP/agent caller sees the
  repair requirement instead of a generic refusal.
- The scan runs on every committed document change, so fresh in-session orphans
  are pruned instead of silently accumulating broken motion state.

## How It Works

- A pure `scanOrphanedMotion(liveNodeIds, motion, grammar)` marks a track orphaned
  when its `target.nodeId` is absent from the live scene node-id set, and a
  grammar binding orphaned when ANY of its `targetIds` is absent.
- `removeTrack(trackId)` is the new motion command that prunes a whole track
  (and scrubs it from clip membership); grammar already had `removeGrammarBinding`.
- Auto-repair removes a whole orphaned binding rather than filtering its dead targets:
  `targetIds` order is load-bearing for wavefront techniques (e.g. Time Delay), so
  silently re-ordering it would corrupt the surviving targets' timing.
- Undo is one entry per store — one motion undo for the tracks, one grammar undo
  for the bindings — not a single compound undo (the two stores have independent
  histories).
- Scanning is gated on scene hydration and a zero-live-node guard, so a transient
  persistence load race (scene and motion restore on independent callbacks) can
  never present a false card that would offer to wipe all motion.

## Manual Verification

1. In the editor, give an object a motion (e.g. a rotation keyframe), then delete
   that object.
2. Confirm the orphan does not remain visible as a blocking banner after the
   document settles.
3. Reload a document that is already broken (orphan tracks on disk) and confirm
   it opens cleanly before any agent edit.

## Known Limits

- The fallback repair card should be rare; it exists only for a cleanup failure
  path, not the normal orphan-removal flow.
- The orphan scan covers motion `tracks` and grammar `bindings` only. It never
  touches `lookNodeTracks` (Look-graph node id space) or grammar `passthrough`
  (unknown-technique bindings that must round-trip verbatim).
- This heals the in-memory/local document; a deployed document only heals once
  the build that ships this surface reaches it.
