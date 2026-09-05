# Agent Bridge Status Chip

Date: 2026-07-05.
Status: shipped UI placement + visibility fix; covers both bridge modes.

## Summary

The live agent bridge's connection indicator moved out of the bottom-center
toast slot and into a quiet, glanceable status chip in the editor's top chrome.

The bridge is the surface for pairing an MCP / agent client with the running
editor: it shows the session id and a "copy config" action so a person can paste
the connection details (base URL + session id + token) into their client. There
are two ways to reach a live bridge, and the chip appears for either once a
connection actually exists:

- An opt-in remote integration session (`?agentBridge=1`), which sets a remote
  session object as soon as it is created.
- The local dev relay (`bun run agent:bridge`), auto-discovered by dev builds
  polling `/__agent-bridge`; this path never sets a remote session, so the chip
  instead keys off the bridge reaching a `connected` status at least once.

A dev session where the local relay never connects shows nothing: the
discovery poll cycles connecting → disconnected → connecting every few
seconds with no relay running, and the chip must not blink in and out of view
on that cycle. Once a session has connected — by either path — the chip stays
mounted afterward even through a dropped connection, so it can keep serving as
the ambient reconnect indicator while the bridge auto-reconnects.

Previously the indicator was a persistent card pinned at the bottom center of the
canvas. Because it stayed on screen the whole time the bridge was connected, it
sat on top of the tool rail / timeline controls and blocked clicks there, and its
dim, low-contrast styling made it hard to read. The bottom-center slot is meant
for a *transient* decision (the agent edit-approval banner), not for ambient
state that never leaves.

The product shift is:

- Persistent bridge state (the session + any connection error) now lives in a
  compact **MCP** chip in the top bar, next to the account/billing entry. It uses
  the same glass-chip styling as the rest of the top chrome, so it reads as
  native infrastructure context rather than an interruption.
- The chip is collapsed by default: a status dot plus an `MCP` label. It reads
  `MCP · Local` for a connected local dev relay, where apply/save requests
  auto-approve, and `MCP · Remote` for an opt-in remote bridge session. Remote
  auto-apply trust is shown in the tooltip and popover, not by replacing the
  bridge-mode label, so a remote session can no longer be mistaken for the local
  `vmactl live` relay. See `agent-bridge-trust.md` and
  [Agent Bridge Development Auto-Approval](./agent-bridge-dev-auto-approval.md).
  The dot is accent-colored only when the connection status itself is
  `connected`; it is warn-colored any other time the chip is
  visible (including a remote session that is reconnecting, which previously
  and incorrectly always read as connected), and the chip turns to its danger
  state (with a warning glyph, not color alone) on a remote connection error.
- Clicking the chip opens a small popover with an auto-apply trust toggle,
  available in both bridge modes. A remote session additionally shows the base
  URL, the session id (now at readable contrast), and the copy-config button —
  the local dev relay has no config to copy, so that section is remote-session
  only, and a short line explains the connection is via the local dev relay
  instead. After a successful copy the popover auto-collapses back to the dot —
  the connect step is a once-per-session action, so it recedes rather than
  lingering (the trust toggle does not trigger this auto-collapse).
- The transient agent edit-approval banner (approve / reject) keeps the prominent
  bottom-center position it earns as a decision gate, but is lifted clear of the
  bottom controls and accent-keyed so it reads as a distinct call to action.
- Connection transitions (connected / connecting / disconnected / error) and copy
  success are announced through a polite live region for assistive tech.

## What Users Can Do Now

- See bridge connection status at a glance in the top bar without a card covering
  the canvas or blocking the tool rail and timeline controls, whether the bridge
  is a remote integration session or the local dev relay.
- Open the chip to read and copy the connection config when pairing a remote
  client, and have it tuck itself away once the config is copied. The popover
  status badge explicitly says `Local / ...` or `Remote / ...`.
- Toggle auto-apply trust from the chip for production bridge sessions. Local
  dev relay sessions show that development auto-approval is on instead of
  surfacing a redundant toggle.
- Keep the chip as an ambient reconnect indicator after a drop, instead of
  losing the trust toggle and status the moment the connection blips.
- Distinguish "still connected?" ambient status (top chrome) from "approve this
  agent edit?" decisions (bottom-center banner) by where each appears.

## How To Use

Remote integration session:

1. Open the editor with the agent bridge enabled (`/editor?agentBridge=1`).
2. Find the **MCP** chip in the top bar, near the account entry. The dot shows
   connection state.
3. Click it to reveal the base URL, session id, and the copy-config button; copy
   the config into your MCP / agent client. The popover collapses after copying.

Local dev relay:

1. Run `bun run agent:bridge` and open `/editor` in a dev build; the editor
   auto-discovers the relay via `/__agent-bridge` and connects without any URL
   parameter.
2. The **MCP · Local** chip appears once that connection is accepted. Click it to reach
   the local dev auto-approval status; there is no config to copy for this mode.

Production bridge session:

- When an agent proposes an edit, approve or reject it in the bottom-center
  banner.

Local dev relay:

- Mutating apply/save requests auto-approve while still using the normal command
  bus and undo path. See
  [Agent Bridge Development Auto-Approval](./agent-bridge-dev-auto-approval.md)
  for the full boundary.

## What A Reviewer Should Verify

- With a live bridge session, the **MCP** chip appears in the top bar and nothing
  is pinned at the bottom center for the persistent session state.
- The bottom of the canvas (tool rail, timeline toggle, contextual quick actions)
  is clickable while the bridge is connected.
- The chip's session id reads clearly (not the previous dim styling); the dot
  is accent-colored only while the connection status is `connected`, and the
  error state also shows a warning glyph.
- Clicking the chip opens the config popover; copying collapses it.
- A dev build with no local relay running never shows the chip, even though the
  discovery poll cycles through connecting/disconnected in the background.
- A dev build with the relay running (`bun run agent:bridge`) shows the chip
  once connected, and the chip stays visible with a connecting/warn tone after
  the relay is stopped, rather than disappearing.
- A remote session that drops and enters its auto-reconnect cycle shows the
  connecting tone, not the connected tone, while it retries.
- A pending agent edit still surfaces the approve / reject banner, lifted above
  the bottom controls.

## Still Intentionally Limited

- The indicator only ever appears through one of the two bridge entry points
  (opt-in remote session via `?agentBridge=1`, or the local dev relay); it is
  not shown to ordinary end users, so it is intentionally quiet rather than
  promoted.
- No reconnect / pairing-wizard UI: the copy-config action plus the approval gate
  are the whole mechanic; only placement and visibility changed.
