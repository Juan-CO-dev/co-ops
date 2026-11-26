# Catering refunds (in-app Stripe refunds)

Owner: CC (sim and prod applies, the merge), Juan (every prod act, the switch, the Stripe Dashboard checks below).

**State.** Everything here is DARK. The switch is the server env `CATERING_REFUNDS=1`; it is unset everywhere. With it
unset no refund UI is rendered and every refund route answers 503 `refunds_off`, whatever migrations are applied and
whoever is signed in.

| Build | What | Migration |
|---|---|---|
| #638 (merged) | The refund step on a rejected / cancelled / lost order: reserve, send to Stripe, retry, release | 0357, APPLIED TO PROD 2026-11-25 UTC |
| Round 2, Part A (this runbook's PR) | GM and AGM may refund, at a shop they belong to | 0358, APPLIED TO SIM 2026-11-26 UTC (version 20261126055240); NOT YET APPLIED TO PROD (see "Applying 0358") |
| Round 2, Part B | Customer refund email, failed / canceled refund handling | Not built. Its plan is not approved. |

## Who may refund

Juan 2026-11-25: GM and AGM too.

| Role | Where |
|---|---|
| Owner, CGS | Any shop |
| MoO, catering manager, GM, AGM | Only a shop where they hold an ACTIVE membership |
| Everyone else (prep manager, social media manager, shift lead and below) | Never |

It is a ROLE list, never a level: level 6 also holds the prep manager and the social media manager, who stay out.

Every refunder goes through the same gates. Confirm asks for a fresh password (Tier B). Retry, Check Stripe and Release
ask for none and follow the same role list. Each reserved refund writes a destructive `catering.refund.request` audit
row naming who, how much and why.

### The rule has two homes, held equal by a test

| Home | Where | Checks |
|---|---|---|
| App | `REFUND_ROLES` / `canRequestRefund` (`lib/catering/refunds-shared.ts`), with `lockLocationContext` in `actorMayRefund` (`lib/catering/refunds.ts`) | The session's role and shops, before the database is asked |
| SQL | `catering_refund_actor_ok(actor, shop)` (0357, re-emitted by 0358) | The locked `users` row (active) and an active `user_locations` row, under the reserve's locks and again on every retry |

`tests/catering-refund-0358-migration.test.ts` fails when the two lists differ. A change to who may refund is a new
migration that re-emits `catering_refund_actor_ok` FROM 0358, plus the app list, in one PR.

The SQL rule reads the database, not the session. A person whose membership was switched off, who was moved to another
shop, deactivated or demoted since they signed in is refused by the reserve (403) even while their session still says
otherwise.

Another shop's order is a 404 for anyone below owner / CGS: they cannot see it, so the role is never looked at.

## Applying 0358 (CC)

`supabase/migrations/0358_catering_refund_roles.sql` re-emits ONE function and touches nothing else: no table, column,
trigger, policy or row. It takes no table lock.

1. **Read-only pre-flight.** The live body must still be 0357's:
   `select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure;`
   → `e33880cdb5aab577a829ef45c2afa61a`. Any other value: stop. The file refuses by name too (a later definer exists).
2. **Sim first:** dry run (the file without its `commit`, rolled back), then apply. Done 2026-11-26 UTC: `schema_migrations` version 20261126055240, verify clean, nothing outside the one function changed.
3. **Prod on Juan's word.** Dry run first. The file's own assertions also check that 0357's other privileges are still
   as 0357 left them; a database that has drifted is refused and nothing is changed.
4. **Verify:** the same query answers `4076029ec89d7b777af23ff3d8fcbdee`; `has_function_privilege` on the function is
   false for `anon` and `authenticated`, true for `service_role`.
5. **Stamp the header** under the gate line: `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0358_catering_refund_roles')`.

### Deploy order

Either order is safe. Nothing opens until BOTH are in, and the switch is off regardless.

| App | SQL rule | A member GM / AGM |
|---|---|---|
| Old | 0357 | Refused by the app (today) |
| Old | 0358 | Refused by the app, before the database is asked |
| New | 0357 | The app lets them through and the reserve answers `forbidden` → 403. With the switch on, the panel would show the Refund button and the press would fail until 0358 is applied. |
| New | 0358 | May refund |

Pinned by `tests/catering-refund-deploy-order.test.ts`.

### Rollback

Reverting the APP change alone withdraws the permission: the SQL rule is reachable only through service-role code that
checks the app's list first. To restore the SQL rule too, write a NEW migration that re-emits the function with 0357's
body (kept verbatim in `scripts/sql-harness-0358.mjs`, which proves it restores 0357's fingerprint). No data is
involved. Never edit 0357 or 0358.

## Before `CATERING_REFUNDS=1`: Juan's checklist

**The switch stays off until every line below is confirmed in writing, per Stripe account.** These lines gate the
already-merged #638 as much as round 2: ANY refund the app makes triggers Stripe's own behaviour, and the app cannot
stop an email Stripe sends.

"Each Stripe account" = the shared account and every shop that has its own key pair
(`STRIPE_SECRET_KEY__<locations.code>`).

| # | Who | Check |
|---|---|---|
| 1 | Juan | **Stripe's own refund emails.** In each account, Dashboard → Settings → Business → Customer emails → under Payments → **Refunds** (the refunds page calls the setting "Email customers for refunds"). It must be **off**, or Juan accepts in writing that Stripe will email the customer about a refund on its own. |
| 2 | Juan | **Payment methods.** In each account, the methods Checkout can offer. For a method "without native refund support" (bank transfers and similar) Stripe emails the customer to ask for bank details when a refund is made. Turn those methods off, or accept it in writing. |
| 3 | Juan | **Record both answers per account in the table below, with the date.** |

| Stripe account | 1. Refund emails (off / accepted) | 2. Payment methods (none of that kind / accepted) | Date | Who |
|---|---|---|---|---|
| Shared | | | | |
| (each shop with its own keys) | | | | |

Refunds are not planned to go on with #638 and Part A alone: a refund that Stripe later fails or cancels is not handled
until Part B. Turning the switch on before then is Juan's decision, and lines 1 to 3 gate it either way.

### What Stripe says (official docs, fetched 2026-11-26)

Refund emails, https://docs.stripe.com/refunds ("Refund requests"):

> "If all of the following conditions apply, Stripe sends an email to your customer notifying them of the refund:"
> "The original charge was created on a customer in your Stripe account." / "The customer has a stored email address." /
> "You enabled **Email customers for refunds** in the Dashboard."

Receipts, https://docs.stripe.com/receipts ("Automatically send receipts", "Before you begin"):

> "Automatic receipts are available for payments and refunds."
> "In the Dashboard, open **Settings** > **Business** > Customer emails." / "Under **Payments**, turn on **Successful payments** or **Refunds**."
> "Stripe uses the payment's receipt email address if one is set, and otherwise uses the email address of the payment's Customer. A Customer object isn't required."
> "Test payments don't trigger automatic receipt emails"

Refunds that need the customer to act, https://docs.stripe.com/refunds ("Refunds that require action"):

> "For some payment methods without native refund support (for example, Konbini, PromptPay, Boleto, and bank transfers),
> Stripe needs to collect bank account details from your customer before it can process the refund. In these cases, the
> refund enters the `requires_action` status and Stripe emails your customer to request their bank information."

A refund that fails, https://docs.stripe.com/refunds ("Handle failed refunds"):

> "In the rare instance that a refund fails, Stripe notifies you using the `refund.failed` event" /
> "If this occurs, you need to arrange an alternative way to provide your customer with a refund."

**UNVERIFIED (no official sentence found, so it is checked by hand in line 1 and nothing here assumes it):**

- Whether Stripe's refund email reaches a customer who paid through Checkout as a guest. Our checkout creates no
  Customer and passes the customer's email. The two pages above do not agree on whether a Customer is required, and
  test mode sends no automatic receipt, so a test cannot settle it.
- Whether the refunds page's "Email customers for refunds" and the receipts page's "Refunds" toggle are one setting.
  The pages use both names and neither says. Check every refund-email control the account's Customer emails page shows.

## Law-book text

`AGENTS.md` has no refund section yet. The text proposed to CC for it is in the PR description (CO CC does not edit
instruction files).
