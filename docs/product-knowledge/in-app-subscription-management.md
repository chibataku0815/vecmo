# In-app subscription management (custom on-domain portal)

Status: `beta` (built on this branch; needs production Polar provisioning to verify
live). Source of truth for the full design: [`../embedded-billing-portal-spec.md`](../embedded-billing-portal-spec.md).

## 1. What changed?

**Manage billing** and **Change plan** (for an existing paid subscription) no
longer redirect the browser to the hosted `polar.sh` customer portal. Subscription
management now happens in a **custom dialog inside the editor**, on the app's own
domain, backed by the Polar Customer Portal API through Worker proxy routes. The
Worker mints a short-lived customer session per request; the session token never
reaches the browser.

This removes the need to configure a Polar custom domain for the customer portal:
the top-level page never leaves the app.

## 2. What can the user do now?

From the in-app dialog, a subscribed user can:

- View the current subscription — plan, status, renewal or cancellation date, and
  any pending plan change.
- **Change plan** between Creator and Creator Pro without a fresh checkout. An
  upgrade applies right away and the badge updates after a short confirmation
  poll; a downgrade is queued to the end of the current period and shown as a
  pending change instead of polling for an immediate flip. If the subscription
  has no payment method on file (for example, one started through a 100%
  discount code never attached a card), the change is rejected with a calm
  "Add a payment method before switching plans." note and an inline
  **Update card** button that opens the same card-update flow as the overview
  — no dead end, no generic error.
- **Cancel** at period end (with a confirmation step) and **Reactivate** (undo a
  pending cancellation).
- View recent orders and open each order's **invoice**.

## 3. How does the user operate it?

1. Open the account popover in the editor top bar.
2. Click **Manage billing** (or **Change plan** on an active paid plan).
3. Use the dialog controls: switch plan, cancel/reactivate, or open an invoice.
4. **Update card** opens Polar's secure card form as an **embedded modal over the
   editor** (the card fields live in Polar's iframe; this app never sees the card
   number). **Invoice ↗** opens the hosted invoice in a popup. Either way the
   editor tab stays put.

## 4. What should a reviewer manually verify?

- Each management action (view, change plan, cancel, reactivate) completes
  **without the top-level page leaving the app origin**.
- The only `polar.sh` surfaces reached are the **Update card** and **Invoice**
  popups; the main editor tab is never navigated away.
- A signed-in user with no Polar customer record sees an offer to start a
  subscription instead of an error.

## 5. What is still intentionally limited?

- **Card / payment-method update is an on-domain embedded modal.** "Update card"
  opens Polar's official payment-method embed — an iframe modal over the editor
  that renders the Stripe card form and attaches the new card via the Customer
  Portal API. The card data lives in Polar's iframe (PCI stays with Polar/Stripe;
  this app never touches the card number), and the editor tab never navigates. If
  the embed library or its session cannot load, it falls back to the hosted
  card-update popup, so card update always has a path.
- Cancel / change-plan / reactivate require the Polar organization to allow
  customer-initiated subscription changes. When that is off, the dialog hides those
  controls and shows only the secure popup path — it never shows broken buttons.
  The overview reports capabilities optimistically (the "changes disabled" flag is
  not reliably observable on a read — it surfaces when a change is attempted), so
  the dialog may briefly show the controls and then hide them once the first
  attempt returns the typed "changes disabled" signal, which it latches for the
  session.
- **Missing-payment-method detection on change-plan is best-effort.** The
  Worker recognizes Polar's `422` rejection as "add a payment method" by
  trusting the provider's typed error first and falling back to matching
  "payment method" in its detail text; any other `422` cause keeps the
  generic "That change couldn't be processed" copy instead of the specific
  card-update note. The Worker also logs a sanitized `{status, subscriptionId,
  polarType, polarDetail}` line (never tokens or the raw provider error) on
  every mutation failure so a production `wrangler tail` can diagnose portal
  errors that don't match a known typed state.
- Displayed amounts and proration follow the Polar organization's configuration;
  the dialog reflects provider state rather than overriding it.
- The plan badge reflects an immediate upgrade only after Polar's webhook syncs
  entitlement state, so there is a brief confirmation delay. If that poll times
  out, the dialog shows a calm "confirmed — refresh in a moment" note rather than
  implying failure; the editor is never blocked.
- Live management requires production Polar provisioning (access token with the
  `customer_sessions:write` scope, products, webhook); until then billing fails
  closed.

## 6. Verify on install (against live Polar)

The unit and browser smokes run against injected/stubbed Polar. When the
production org is provisioned, confirm these provider-timing and behavioral
details as a set, because they cannot be exercised without live Polar:

- **Reactivate** sends `{ cancelAtPeriodEnd: false }` through the SDK's update
  union; confirm it actually clears a pending cancellation (not a silent no-op).
- **Invoice generation** may be asynchronous (HTTP `202`); if the immediate
  refetch races ahead it surfaces as "not available yet" and the user retries —
  confirm the timing is acceptable or add a short retry.
- **Ownership guard** D1 `WHERE owner_user_id = ? AND provider_subscription_id =
  ?` is exercised against the real mirror (unit tests mock the reader).
- **Changes-disabled detection**: confirm whether the customer-portal read calls
  `403` when the org disables changes. If they do, the overview can be upgraded
  to report `changesEnabled: false` directly and remove the one pre-click button
  flash; today it relies on the mutation `403` latch.
- **Missing-payment-method `422` shape**: confirm a real "subscription has no
  card, change-plan rejected" response against a live Polar org actually
  carries `MissingPaymentMethod` (or "payment method" in the detail text) in
  the shape this Worker parses (`error.body` JSON, or `error.error`/
  `error.detail` on the thrown SDK error) — today this is verified only
  against the documented Polar error contract, not a live 422.
- **Card-update popup** opens Polar's hosted surface in a new window; confirm the
  real navigation works and that no app credential rides along (opener is severed
  and a `no-referrer` policy is set on the popup).
- **Immediate-upgrade poll** flips the badge after the webhook syncs entitlement;
  confirm the live webhook latency stays within the poll budget (otherwise the
  calm "refresh in a moment" terminal note shows).
- **Card-update embed success lifecycle.** The browser smoke proved the embed
  *injects* on-domain (iframe over the editor, no navigation, no popup) and that
  the popup fallback fires when the session can't be minted — but a stub session
  token cannot fire the embed's `success`/`confirmed`/`error` events. Against live
  Polar, confirm: (a) `preventDefault()` on `success` actually suppresses the
  embed's default top-window redirect; (b) the "Your card is updated" note renders
  after success and survives the embed's `close()` (the `holder.succeeded` guard);
  (c) `confirmed`/`error` states render; (d) `setAsDefault` (defaulting `true`)
  makes the new card the one charged. The success path follows the same deferred-
  note pattern proven for the mutation flows, but is not yet exercised end-to-end.

These are confirmation items, not blockers — the flow degrades gracefully if any
provider behavior differs.
