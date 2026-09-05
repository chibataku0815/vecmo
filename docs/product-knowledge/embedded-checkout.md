# Embedded checkout (upgrade inside the editor)

> **Cloud-only.** This page describes the vecmo.dev hosted service. The backend is not part of this repository; in the open-source build these controls are hidden.

Note: `BillingEntry` is lazy-loaded from `TopBar.tsx` and `CanvasShell.tsx` (both already gated behind `platformCapabilities.account`), so the checkout/Polar bundle is excluded from the open-source build's main entry chunk.

Status: `beta` (built on this branch; needs production Polar provisioning to verify
live). Source of truth for the full design: [`../embedded-billing-portal-spec.md`](../embedded-billing-portal-spec.md).

## 1. What changed?

Upgrading a plan no longer navigates the whole browser tab away to `polar.sh`.
The account popover's **Upgrade** / **Change plan** action now opens Polar's
official **embedded checkout** as a modal layered over the editor. The editor tab
stays on the app's own domain; only the checkout form itself is an embedded
`polar.sh` iframe inside that modal.

This removes the need to configure a Polar custom domain for branded checkout: the
top-level page never leaves the app.

## 2. What can the user do now?

- Start an upgrade (Free → Creator, or Creator → Creator Pro) from the account
  popover and complete payment **without leaving the editor**.
- See the plan badge update on its own once the purchase is confirmed.

## 3. How does the user operate it?

1. Open the account popover in the editor top bar.
2. Click **Upgrade** (Free) or **Change plan** (paid).
3. Complete payment in the embedded checkout modal.
4. The iframe closes and a small status toast shows **"Finalizing your upgrade"**
   while the app polls billing status; the plan badge then reflects the new plan
   (or a calm "refresh in a moment" message if the webhook is still landing).

## 4. What should a reviewer manually verify?

- The checkout opens as a modal over the editor and the **browser URL bar stays on
  the app origin** (e.g. `vecmo.dev`); only the iframe's `src` is `checkout.polar.sh`.
- After completing a sandbox checkout, the plan badge flips to the new plan once
  the confirmation poll observes the webhook-synced status.
- The editor canvas is never replaced; closing the modal returns to a live editor.
- The build keeps the embed library code-split: `bun run build` then
  `bun run check:bundle` must pass, proving `@polar-sh/checkout` lands in its own
  dynamic chunk and no server-only package (`@polar-sh/sdk`, `better-auth`,
  `drizzle-orm`, …) appears in any `dist/client` asset.

## 5. What is still intentionally limited?

- The plan badge reflects the change only after Polar's webhook syncs entitlement
  state, so there is a brief delay. If the poll times out, the UI shows a calm
  terminal message ("Payment received — refresh in a moment") rather than implying
  failure.
- If the embedded checkout library fails to load (or the iframe never loads within
  a timeout), the toast offers a **clickable "Open checkout" affordance** that
  opens hosted checkout in a new tab on a fresh user gesture. The flow never
  auto-opens a popup (browsers block those outside a gesture) and never performs a
  top-level redirect, so the editor tab is never unloaded.
- Live checkout requires production Polar products, an access token, and a webhook
  endpoint; until provisioned, billing fails closed (sandbox by default).
- The embedded iframe posts messages between the app and `*.polar.sh`. No
  Content-Security-Policy is set today, so nothing blocks it; if a CSP is ever
  added it must allow `frame-src https://*.polar.sh`. Local verification is bounded
  by Polar's sandbox **embed-origin allow-list**: a non-allow-listed dev origin can
  load the app and prove the URL bar stays on-domain, but cannot complete a live
  sandbox purchase.
