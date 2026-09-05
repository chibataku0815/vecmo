# Morph Topology Correspondence

Date: 2026-07-13  
Status: **beta**

## What changed?

Path-shape animation now has explicit topology repair and correspondence tools.
The ordered vertices inside each ordinary `pathShape` key remain the source of
truth: index order defines pairing, index zero defines the closed-path seam, and
array direction defines winding.

Inspector and the exact-key canvas overlay can split the longest cubic segments
of smaller keys until every key has one vertex count, rotate a closed key's first
vertex without changing its pixels, and reverse winding. Direct Select shows the
current and adjacent ghost vertices plus explicit index-to-index correspondence
lines, allows direct vertex selection, and previews each write before commit.
Agent/MCP exposes the same repair, seam, and winding commands and readback.

## Why it matters

Compatible keys interpolate vertices and tangents deterministically across
canvas, export, and runtime. Incompatible counts or closed states continue to
hold with a typed issue; Vecmo does not hide the mismatch behind nearest-point
guessing or baked frames.

## Limits

- Count repair uses exact cubic subdivision and does not infer semantic feature
  matches such as eye corner to eye corner.
- First-vertex rotation applies only to closed keys; open paths retain endpoint
  identity.
- Canvas commands operate only at an exact authored path key; between keys the
  sampled morph remains inspectable but correspondence writes fail closed.
