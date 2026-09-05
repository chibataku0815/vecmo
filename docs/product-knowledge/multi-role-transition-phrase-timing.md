# Multi-role Transition Phrase Timing

Date: 2026-07-13  
Status: **beta**

## What changed?

A selected motion-system clip can apply one semantic timing template across all
of its member track segments in one undo step. The edit synchronizes the phrase's
departure and arrival behavior without replacing keys, role mappings, spatial
paths, mattes, morphs, or controller relations. **Snap hold** is the deliberate
exception: it inserts an intermediate proof key that duplicates the destination
value, then applies the semantic segment curve.

Use the clip's Inspector motion pane and choose a Phrase timing option. Agent/MCP
can call the same clip-id + template-id command. Playback, canvas, export, and
runtime continue to consume ordinary tracks; no new transition playback format
is introduced.

## Limits

- V1 applies templates that are honestly representable as keyframe-segment
  easing. Profile-only lag/phase/physics templates remain unsupported.
- Phrase roles come from the existing motion-system role map and clip membership;
  arbitrary clips do not gain guessed semantic labels.
- The edit synchronizes timing but does not synthesize anticipation, crossing,
  rebound, or new semantic values. Snap hold only duplicates an existing
  destination value to make its hold explicit.
