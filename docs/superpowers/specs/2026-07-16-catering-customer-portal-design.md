# Catering Customer Portal — Design Spec

**Date:** 2026-07-16 · **Status:** design locked with Juan (flows), visual + build pending
**Owner:** the catering module's single customer-facing surface

---

## 1. Vision

One **beautiful ordering experience**. The order *is* the portal; accounts, past orders,
and content hang off it. This is the only surface a customer ever sees, so it earns the most
polish in the whole app — **phone-first, brand-forward, genuinely delightful**, top-tier
customer experience. Confidence-building content (FAQ, food facts, allergens) is woven in,
not bolted on.

Everything already built feeds it: the **picker engine** (PR-2) becomes their menu, the
**charge stack** (1E) their price, the **identity model** (PR-1) their account, the
**pipeline** (1C) how staff receive the order, **capacity** (1B) their availability.

## 2. Two principals, never crossed

- **Staff** (existing): `co_ops_session` cookie → JWT → `sessions` → `current_user_*` RLS.
- **Customer** (NEW): separate `co_ops_portal` cookie → separate JWT (`customer_id`/
  `client_email` claim) → new `catering_portal_sessions` → new `current_customer_id()` RLS
  helper. A customer is a `catering_customers` contact — **never** a `users` row. Shares the
  `lib/auth.ts` token primitives (generate/hash) but nothing else; a customer JWT can never
  satisfy a staff check or vice-versa. (`email_verifications` + `sessions` are `user_id`-scoped,
  so the customer needs its own token + session tables.)

## 3. Identity & account model (Juan-locked)

- **Email = the account identity, enforced unique** (one active `catering_customers` per
  `lower(email)` — already live from PR-1's unique index).
- **Ordering requires a verified account.** "New customer" = create-an-account-via-email-verify
  *during* the first order. Not anonymous guest checkout.
- **Duplicate email → verify or new email.** Entering an email that already has an account →
  "sign in (open your verify link) or use a different email for a new order." Prevents duplicate
  accounts; ties every order to a verified email.
- **Company auto-attribution** (PR-1) applies: a corporate-domain email rolls the account up to
  its company; personal domains stay individual (hand-attached by staff).
- **Fix owed:** PR-1's `catering_companies.claimed_by_user_id` → `claimed_by_customer_id`
  (the claimer is a customer contact, not a staff user).

## 4. Entry — two lanes, one flow

Landing page has two doors:
- **Returning → Sign in:** email → magic-link → prefilled, sees past orders.
- **New → Start an order:** browse → build order → at checkout, enter email → verify
  (magic-link) → account created → order submitted.

Both roads end at a verified account. Auth gates *submission*, not *browsing* — the whole
storefront + cart is explorable pre-auth.

## 5. The money lifecycle (Juan-locked)

1. **Order placed** → real-time **availability check** (capacity, 1B) → **deposit upfront**
   (secure payment link in v1; Stripe in-flow later).
2. **Catering team approves** (from the staff pipeline/quote side).
3. **Pay in full to lock the date** — the customer must pay the balance ASAP, **hard deadline
   48h before the event**. Unpaid by the deadline → the date is at risk / released (exact
   auto-release policy TBD — likely a pg_cron sweep, Wave 2).
4. **Company accounts:** **Net-30 / Net-60** terms as an alternative to pay-upfront (invoice,
   pay later) — a per-company setting.

**Payment mechanism:** v1 = emailed secure payment links + staff tracking of paid/unpaid.
Wave-2 = Stripe in-flow (deposit + balance + net-terms) on the settlement-aware ledger +
hold/reservation machinery (D19/D23/D27). Every amount is **re-priced server-side** — client
prices are never trusted (D20 server-side price authority).

## 6. Screens

- **Landing:** brand moment + the two doors + trust content (a taste of FAQ / facts).
- **Storefront:** packages as beautiful cards + à-la-carte, food facts / tidbits / allergens
  surfaced on the cards and in a help area (builds confidence).
- **Order builder / cart:** customize items + quantities; event details (date, headcount,
  delivery vs pickup, address); live server-priced running total.
- **Review:** the full charge stack (subtotal / delivery / service / gratuity / tax / total /
  deposit) + the deposit + pay-in-full-by-48h terms spelled out plainly.
- **Checkout:** email-verify (magic-link) → account → deposit link → submitted.
- **Confirmation:** "pending our team's approval — you'll get an email," clear next steps.
- **Account home:** past orders, live status (pending / approved / deposit paid / paid in full /
  confirmed), reorder, saved details, payment/invoice status.
- **Help:** full FAQ + food facts + allergen reference.

## 7. Security substrate (the actually-hard part)

- **Public routes:** new portal paths in `proxy.ts` PUBLIC_PATHS + the matcher regex; portal
  pages live outside `(authed)`.
- **Rate-limiting:** none exists → an **in-DB throttle** (`catering_portal_rate_limits`, keyed
  on IP + email + window) on order submission + magic-link requests.
- **Spam:** honeypot field + throttle. **CSRF:** Origin/Referer check on public POSTs.
- **Server-side price authority:** every submitted order re-priced via the charge-stack engine.
- **Second-principal RLS:** `current_customer_id()` → customers read ONLY their own
  quotes/orders (D20 client-RLS second principal).
- **Prompt-injection read-scoping:** if/when an AI concierge lands, read-scope it to the
  customer's own data.

## 8. Prerequisites (external, Juan-controlled)

- **Resend DNS** — gates email-verify + confirmations. Built now but **allowlist-gated**
  (delivers only to Juan until the domain's verified). **The portal can't go LIVE to customers
  until DNS is verified** — the build doesn't wait; the launch does.
- **Stripe KYC** — gates in-flow deposits / balance / net-terms. v1 uses payment links.

## 9. Phased build

| PR | Scope | Blocked on |
|---|---|---|
| **Portal-1** | The beautiful **storefront + order builder/cart** (customer-styled picker) + **content** (FAQ / food facts / allergens). Browsable, no auth/payment. **The beauty showcase — unblocked.** | nothing |
| **Portal-2** | Customer **principal + magic-link auth** (allowlist-gated) + account creation + `claimed_by_customer_id` fix + `current_customer_id()` RLS. | Resend DNS (built gated) |
| **Portal-3** | **Order submission** (ties to account + creates a pipeline lead/quote) + **deposit link** + confirmation emails (gated) + the in-DB throttle substrate. | — |
| **Portal-4** | **Account home** — past orders, status, reorder, payment status. | — |
| **Portal-5** | **Stripe money** — deposit in-flow, pay-in-full, net-terms, 48h auto-release (pg_cron). | Stripe KYC (Wave 2) |

## 10. Visual / UX principles

Phone-first. Brand-forward (Mustard / Diet Coke / Mayo palette, Midnight Sans wordmark).
Reuse the CO UI system (`co-card`, tokens, gradients) but **elevated** for a customer-facing
storefront — this should feel like the nicest thing in the app. Delightful micro-interactions,
minimal friction to order, confidence-building content at every decision point. **Mockups
before code** for the customer-facing screens.

---

### Open sub-decisions (defaults proposed, adjustable)
- URLs: `/order` (storefront) + `/portal` (account) + `/order/[confirmation]` — or a subdomain.
- 48h auto-release: release the date vs just flag-for-staff — likely a pg_cron sweep in Wave 2.
- Delivery vs pickup + address capture live on the order builder.
