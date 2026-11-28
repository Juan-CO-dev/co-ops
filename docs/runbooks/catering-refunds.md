# Catering refunds (in-app Stripe refunds)

Owner: CC (sim and prod applies, the merge), Juan (every prod act, the switch, the Stripe Dashboard checks below).

**State.** Everything here is DARK. The switch is the server env `CATERING_REFUNDS=1`; it is unset everywhere. With it
unset no refund UI is rendered and no refund route does any refund work, whatever migrations are applied and whoever is
signed in: a signed-in, same-origin request is answered 503 `refunds_off` before its body is read. (The two checks that
come before the switch still answer first: a cross-origin POST is 403, and a request with no session is 401.)

| Build | What | Migration |
|---|---|---|
| #638 (merged) | The refund step on a rejected / cancelled / lost order: reserve, send to Stripe, retry, release | 0357, APPLIED TO PROD 2026-11-25 UTC |
| Round 2, Part A (#639, merged) | GM and AGM may refund, at a shop they belong to | 0358, APPLIED TO SIM 2026-11-26 UTC (version 20261126055240); 0358, APPLIED TO PROD 2026-11-27 UTC (version 20261127204650) |
| Round 2, Part B1 (money) | One financial writer, failed / canceled / reversed refunds handled, durable webhook ingress, recovery, the 15-minute sweep, operator exits, the epoch | 0359, NOT YET APPLIED (sim first, then prod on Juan's word; see "Part B1 — money (0359)") |
| Round 2, Part B2 / B3 | Customer and staff refund email (0362), the digest (0363) | Later PRs. Not on this branch. |

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

Another shop's order, for anyone below owner / CGS, in the order the gates run:

1. A role outside the list is 403 `forbidden` at the route, whatever shop the order belongs to.
2. On Confirm, a role in the list without a fresh password is 403: `step_up_required` when the session was never
   unlocked, `step_up_stale` when an earlier unlock has aged out.
3. Then the order is looked up, and a shop the person does not belong to is 404 `not_found`: it is never said that the
   order exists. The same on Retry / Release (which have no step 2), and on the panel's read.

So a GM or AGM of another shop gets a 404, never a refund, and never a 403 that would confirm the order is real.

## Applying 0358 (CC)

`supabase/migrations/0358_catering_refund_roles.sql` re-emits ONE function and touches nothing else: no table, column,
trigger, policy or row. It takes no table lock.

1. **Read-only pre-flight.** The live body must still be 0357's:
   `select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure;`
   → `e33880cdb5aab577a829ef45c2afa61a`. Any other value: stop. The file refuses by name too (a later definer exists),
   and it also compares a second, exact fingerprint that sees a change inside a string literal (the file header has
   that query).
2. **Sim first:** dry run (the file without its `commit`, rolled back), then apply. Done 2026-11-26 UTC: `schema_migrations` version 20261126055240, verify clean, nothing outside the one function changed.
3. **Prod on Juan's word.** Done 2026-11-27 UTC: `schema_migrations` version 20261127204650 (the file header carries the
   stamp). Dry run first. The file's own assertions also check that 0357's other privileges are still
   as 0357 left them, by the WHOLE ACL: on the six functions nobody but the owner and `service_role` holds anything; on
   the two tables, the owner aside, exactly `service_role` SELECT and 0357's nine UPDATE columns. A database that has
   drifted (another role, a grant option, a changed guard trigger) is refused by name and nothing is changed. An
   unexpected grant is never revoked silently: a person finds out who made it.
4. **Verify:** the same query answers `4076029ec89d7b777af23ff3d8fcbdee`; `has_function_privilege` on the function is
   false for `anon` and `authenticated`, true for `service_role`.
5. **Stamp the header** under the gate line: `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0358_catering_refund_roles')`.

### Deploy order

Either order is safe. Nothing opens until BOTH are in, and the switch is off regardless.

| App | SQL rule | A member GM / AGM |
|---|---|---|
| Old | 0357 | Refused by the app (today) |
| Old | 0358 | Refused by the app, before the database is asked |
| New | 0357 | The app lets them through and the reserve answers `forbidden` → 403. With the switch on, the panel would show the Refund button and the press would fail until 0358 is applied, with a message that names their own role. Apply 0358 before the switch. |
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

**Do not turn the switch on with #638 and Part A alone.** A refund that Stripe later fails or cancels is not handled
until Part B: the payment would keep saying "refunded" and nobody would be told. Only Juan can decide otherwise, in
writing, and lines 1 to 3 gate the switch either way.

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

## Part B1 — money (0359)

Owner: CC (sim and prod applies, every operator step below), Juan (every prod migration, the switch, promotion, break
glass). Plan: PLAN-refund2B-r5 section B1 + Activation + Platform evidence, with CC's binding addendum (A1, A2, A3, P3).

### What it is

`supabase/migrations/0359_catering_refund_reconciler.sql` is the money half of Part B. It adds:

- **One financial writer**, `catering_refund_apply` (its private body `catering_refund_apply_inner`), fed by one
  evidence contract: only an EXACT read of a refund id drives its status; a list or a webhook event only contributes
  ids. It is the only writer of refund identities, outcomes, event floors, request transitions, the derived snapshot
  and, on this branch, the only NEW writer of `catering_payments.status` (`paid -> refunded` when verified succeeded
  cents cover a known capture; `refunded -> paid` when a refund failed or was canceled, with a checkout-cleanup
  obligation written in the same commit).
- **Durable webhook ingress**: with the switch ON a refund event (`charge.refunded`, `refund.created`,
  `refund.updated`, `refund.failed`, `charge.refund.updated`) becomes work in one transaction and its ledger verdict is
  `refund_state_owed`. Nothing is reconciled inline.
- **The epoch** (`none | sealed | recovering | live | draining`, stored as `recovering -> live -> draining -> closed`):
  the admission barrier for everything above. Every protected call carries the build's contract version
  (`REFUND_CALLER_CONTRACT`, `b1-1`) as its first argument and fails closed on any other.
- **Recovery, the 15-minute sweep, and the operator exits** (below).
- **The stale sender is withdrawn**: `service_role` loses the nine direct UPDATE column grants on
  `catering_refund_requests` and EXECUTE on 0357's `catering_refund_reserve`, `catering_refund_claim` and
  `catering_refund_record_snapshot`. main @ 9ce98df5 with the switch ON is refused before any reservation, audit row or
  Stripe POST.

**It ships DARK and opens NO epoch.** Applying 0359 turns nothing on: the switch is unset everywhere, the file writes
only its own install record (part B1, version `b1-1`), and no money path admits anything without an open epoch.

**B1 alone CANNOT be activated.** `catering_refund_open_recovery` and `catering_refund_promote` each require the three
current install records B1, B2 and B3 (`install_incomplete` otherwise). B2's record is written by 0362 and B3's by
0363; neither exists on this branch. Apply order is **0359 -> 0362 -> 0363**. 0360 belongs to other work; 0361 is
released.

### Applying 0359 (CC)

The tooling for this apply lives in `scratchpad/refund-0359/` (dry-run copy of the file without its `commit`, the
read-only queries below, the verify output). Nothing there is committed.

1. **Drain old senders first.** The file's pre-flight REFUSES while a live 0357 claim exists (`a live refund claim
   exists`), checked under its own `share row exclusive` lock on `catering_refund_requests`: a claim is a Stripe POST
   that may be in flight, and revoking a grant cannot recall it. With the switch unset there should be none:
   `select count(*) from public.catering_refund_requests where claimed_until > now();` must be 0.
2. **Read-only pre-flight.** The file compares BOTH fingerprints (house and exact, 0358's two conventions) of the seven
   bodies it re-emits or relies on (0357's guard, figures, snapshot writer, reserve and claim; 0358's actor rule;
   0343's cron lease) with the values in its pre-flight table, plus the guard trigger's binding, the cron CHECK, the
   whole ACLs of 0357's two tables and the dependency columns. Any drift is refused by name and nothing is changed.
3. **Sim first:** dry run (rolled back), then apply. Then CC's two-session lock proof on sim,
   `scripts/sim/refund-0359-lock-check.mjs` (sim only).
4. **Prod on Juan's word.** Dry run first, then apply. **Needs Juan's word.**
5. **Verify:** `select part, version, migration from public.catering_refund_install_contracts;` answers exactly one row
   (`B1`, `b1-1`, `0359_catering_refund_reconciler`); `select count(*) from public.catering_refund_epochs;` answers 0.
6. **Stamp the header** under the gate line: `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0359_catering_refund_reconciler')`,
   and this runbook's table in the same PR.

Deploy order is safe both ways while the switch is OFF: main's OFF paths touch nothing 0359 creates; the new app with
the switch ON and no 0359 answers `refunds_unavailable` and never falls back to the old money writer.

### Entry points, by installation and switch state

| Installation and switch | What the entry points do |
|---|---|
| OFF, any supported deployment order | Main's refund routes, webhook, settlement behaviour. The sweep cron skips before any service client, lease or heartbeat (`catering_refunds_off`). The job watch makes no refund read and raises no refund alert. |
| ON, 0359 missing or the build's contract incompatible | `refunds_unavailable` (503), visible to the operator. A valid refund webhook answers the retryable `processing_failed` only when its ingress cannot be made durable. Never falls through to the old money writer. |
| ON, 0359 present, no open epoch (`none`) | Refund actions answer `refunds_no_epoch`; the sweep skips (`refunds_no_epoch`). No reserve, claim, apply, sweep lease or heartbeat. Signed ingress still commits `refund_state_owed` and answers 2xx. |
| ON, `sealed` (after a finished drain, until the next recovery opens) | As no epoch, except that new refund ingress is refused (`refunds_sealed`) BEFORE any verdict: an old ON instance leaves the ledger row `null` or `processing_failed`, never a final verdict (addendum P3 a). |
| ON, `recovering` | Signed ingress, stored-state reads and bounded recovery work (the seed and discovery passes). Confirm and Retry-create refuse `503 refunds_recovering` before any reserve or claim. |
| ON, `live` | Authorized creates (claim -> complete discovery + financial check -> arm -> POST), the protected apply, the sweep and its monitoring. |
| ON, `draining` | Creates refuse `refunds_draining`. Existing money work, settlement attach and the sweep stay available until the drain is finished. |

Reads (the panel GET, the pipeline banner, the reload after a mutation) are STORED STATE in every row above: zero
Stripe calls.

### Activation (CC performs, in this order)

Activation is one production operation after B1, B2 and B3 are all applied and deployed. B1 alone stops at step 2
with `install_incomplete`.

1. **Install and deploy.** 0359, 0362 and 0363 applied (each **needs Juan's word**), each stamped. Drain every
   deployment whose compiled contract version is not the one the records name; verify the deployed caller versions.
2. **Open recovery with the switch OFF, and read it back.** With Juan's approval (**needs Juan's word**), as the owner:
   `select public.catering_refund_open_recovery('<operator>');` then
   `select public.catering_refund_epoch_state('b1-1');` must answer `state = recovering`, `caller_ok = true`. The
   activation tooling prints its next step from `activationNextStep` (lib/catering/refund-outcomes-shared.ts) and
   nothing else: `open_recovery_first` until the read-back shows `recovering`, then `set_switch_on`. It never says
   "set the switch" without a recovering epoch read back.
3. **Only then set `CATERING_REFUNDS=1`.** **Needs Juan's word** (a live switch).
4. **Seed.** The sweep runs `catering_refund_recovery_seed_batch` in bounded, idempotent batches (every settled Stripe
   payment and its retained ids, then every historical refund event on the webhook ledger, `ignored` included, by its
   original event id). Its cursors are stored with each batch; a historical seed creates hints and baseline work and
   NO floor. Recovery is complete when both stages report done.
5. **Verify the counts.** `select public.catering_refund_recovery_report();` — read `counts` (payments, unbaselined,
   held_payments, quarantined_events, unmatched_payment_intents, seeded_events, prior_successes,
   unarmed_reservations, attempted_unbound, cumulative_gaps), `by_shop`, `oldest_work_at`, and the
   **cumulative-gap list** `cumulative_gaps` (addendum Opus P3-c): every seeded payment whose historical cumulative
   refunded is above its verified non-void sum, i.e. where ON would show more money available than main did. Review
   each one before promoting. Record the activation evidence of plan Activation 4 per Stripe account (mode, offered
   payment methods, signing endpoint and version, the four event subscriptions, whether deprecated
   `charge.refund.updated` is still delivered, refund-receipt settings OFF). Never create a production refund as proof.
6. **One promotion, with the acknowledged counts.** **Needs Juan's word.**
   `select public.catering_refund_promote('<epoch id>', <generation>, '<the counts object exactly as read>'::jsonb, '<operator>');`
   It re-checks the three install records, that recovery completed, and that the counts are still the ones
   acknowledged (`ack_mismatch` otherwise: read the report again). The epoch is then `live`.

### The stop: drain BEFORE off

Never set the switch OFF while an epoch is open: acknowledged refund work would be stranded.

1. `select public.catering_refund_start_drain('<epoch id>', <generation>, '<operator>');` Creates close at once; the
   sweep keeps working.
2. `select public.catering_refund_finish_drain('<epoch id>', <generation>, '<operator>');` takes the same admission
   lock ingress takes. While anything blocking is left it answers `closed: false` with the report, and the epoch STAYS
   draining (a list alone never authorizes OFF). Repair or retry, then call it again. Its classes (addendum A2):

   | Class | Blocks the close? | What happens |
   |---|---|---|
   | `outstanding_events` | Yes | Accepted ingress that can still change a payment: attached and not applied, attached with an outstanding floor, or unmatched / `no_payment` while a payment row now carries its PaymentIntent (attach owed). |
   | `admitted_senders` | Yes | A live sender claim, or an arm younger than 180 seconds (a create response may still add evidence). |
   | applied (`counts.applied`) | No | Done. |
   | `out_of_scope` | No | Parked / unmatched / `no_payment` events whose PaymentIntent matches no `catering_payments` row. At the seal each is RE-STAMPED to main's `payment_not_found` verdict, so main's own OFF replay picks it up. Nothing parks for ever and nothing blocks the drain for ever. |
   | `outstanding_events`, reason `capture_review` | Yes | An applied event on a payment under an open capture review: its refund may already be whole while the stored status OFF readers use still says `paid`. Disposition the review (panel) or break glass. |
   | `pending_whole_refunds` | No (listed) | A whole refund still PENDING at the drain: the payment stays `paid` (the money has not returned yet), and main's legacy `charge.refunded` settles it when Stripe does. **UNVERIFIED: whether Stripe sends a new `charge.refunded` when a pending refund later succeeds** (its documented signal for that transition is `refund.updated`, which main ignores). So for every payment listed here: re-check the charge in Stripe after the refund settles and confirm the payment reads `refunded`; if it does not, resend that charge's `charge.refunded` event from the Stripe dashboard. |
   | `cleanup_open`, `unconfirmed_requests` | No (listed) | Post-reversal checkout cleanup still owed; armed requests whose create response was lost. |
   | `quarantined_events` | No (listed) | Wrong-shop / wrong-mode ingress: it changed no money and is never re-stamped. |

3. With nothing blocking, the same call seals ON ingress and closes the epoch in one transaction (`closed: true`).
   **Only after that receipt** may CC set the switch OFF and roll the app back. The seal stays across the rollout.

### Break glass (addendum A3 ii)

OFF with undrained work is allowed **ONLY on Juan's explicit word** (**needs Juan's word**, recorded):
`select public.catering_refund_break_glass_close('<epoch id>', <generation>, '<operator>', '<reference to Juan''s recorded word>');`
It records the FULL undrained list in the epoch's drain report and in a destructive `catering.refund.break_glass`
audit row (outstanding events, admitted senders, out-of-scope events, pending whole refunds, open cleanup, unconfirmed
requests, quarantined events), and re-stamps every event-backed item (outstanding and out-of-scope) to main's
`payment_not_found` per A2.
**A re-stamp alone applies nothing to a payment that is already settled:** Stripe does not redeliver an event it was
answered 2xx for, and main replays a seen-first refund only at settlement. So after the switch is OFF, for every
payment in the recorded `outstanding_events` list: resend its `charge.refunded` event from the Stripe dashboard (main's
duplicate gate then works it, because its verdict is `payment_not_found` and a paid row carries the charge) and confirm
the payment's status against the charge.
The reference is a structured id (8 to 120 of `A-Za-z0-9_.:/#-`), never a name or a message body.

### A contract upgrade during a drain (addendum A3 i)

A later reviewed migration may supersede a part's install record (it marks the old record superseded and declares
`supersedes_version`, and re-emits the expected matrix), including while the epoch is `draining`. CC then adopts it for
the open epoch: `select public.catering_refund_adopt_contract_upgrade('<epoch id>', <generation>, '<operator>');`
(audited destructive). It refuses `upgrade_not_recorded` for a record that does not declare the version the epoch
admitted, and `nothing_to_adopt` when nothing changed.

### Re-enable

With the switch OFF, open a fresh recovering epoch (`catering_refund_open_recovery`): it releases the prior stop seal
under the same lifecycle lock. Then follow Activation from step 2 (read back, switch, seed, counts, one promotion).
Every arm, identity, floor, disposition and audit row is preserved; a request armed in an earlier live epoch keeps its
idempotency key and its original 24-hour window.

### The operator exits

Every hold an issue raises has an exit on the order's refund panel. **Who may act:** an active MoO with an active
membership at the order's shop, or an active Owner or CGS, **with a fresh password** (Tier B, 120 seconds). The
database re-checks the actor, the freshness, the role, the shop and the payment's generation from the session row
itself, and writes a destructive `catering.refund.disposition` audit row with a bounded evidence reference (never free
text or customer data). A HELD issue also offers **Reopen and recheck** (`reopen_recheck`). **Direct SQL repair is
never the procedure.**

| Issue code | Holds the payment | Panel actions |
|---|---|---|
| `awaiting_identity` | Yes | Resolve this event floor (`resolve_event_floor`, the financial exit), Recheck after restoring access (`recheck_after_access`), Reviewed, access still required (`access_still_required`), Keep payment held (`keep_held`) |
| `verified_unreadable` | Yes | `recheck_after_access`, `access_still_required`, `keep_held` |
| `ambiguous_binding` | Yes | Bind verified refund (`bind_verified_refund`), Treat as external (`treat_as_external`), `keep_held` |
| `refund_revived` | Yes | Record evidence reviewed (`evidence_reviewed`), `keep_held` |
| `released_request_has_refund` | Yes | `evidence_reviewed`, `keep_held` |
| `unfamiliar_identity` | No | `evidence_reviewed`, Acknowledge follow-up (`acknowledge_followup`) |
| `capture_review` | Yes | `evidence_reviewed`, `recheck_after_access`, `keep_held` |
| `wrong_charge` | Yes | Exclude unrelated hint (`exclude_unrelated_hint`), `recheck_after_access`, `keep_held` |
| `owner_indeterminate` | Yes | `recheck_after_access`, `access_still_required`, `keep_held` |
| `quarantined_hint` | No | `exclude_unrelated_hint`, `acknowledge_followup` |
| `reserved_not_sent` | No | Close as never sent (`release_unsent`: a proved never-armed reservation with no live claim), `acknowledge_followup` |
| `submission_unconfirmed` | No | `acknowledge_followup` |
| `checkout_still_open` | No | `acknowledge_followup` |

Resolving a floor needs a fresh complete pass at the current generation and a reference to the operator's own
reconciliation in the owning Stripe account; it lifts that ONE event's floor and cannot mark a refund succeeded,
release a request, clear another event or authorize a Stripe POST. The panel's ordinary **Release** (after the original
24 hours, with staff verification in Stripe and a fresh complete pass) is unchanged.

### The sweep and its two alerts

`/api/cron/catering-refund-sweep`, every 15 minutes (`vercel.json`), under the `catering-refund-sweep` cron lease
(330 seconds). OFF: it answers before any service client, lease or heartbeat. ON it runs only while an epoch admits
work. It performs GETs only and has no Stripe create capability. Each run works fair, separately bounded due lists
(armed-unbound and reserved-unarmed requests, event work, identity polls, discovery, post-reversal cleanup) and the
housekeeping (`reserved_not_sent` after 15 minutes unarmed, `submission_unconfirmed`, `no_payment` parking after 24
hours, aged floors at 24 hours).

The job watch raises two separate alerts, only while an epoch is open (recovering, live or draining):

1. **Missing run**: two missed 15-minute intervals since the later of the last success and the epoch's opening
   (reason `missing_run`, the existing deduplicated operator alert).
2. **Aged work**: the oldest due, actionable obligation with no progress for 24 hours, even with fresh heartbeats.
   Healthy future polls, parked foreign PaymentIntents, quarantined hints, issues already with staff and restricted
   payments with a current disposition are excluded; an overdue event on such a payment stays visible. It alerts once
   per obligation and evidence fingerprint across ET days, and again on new evidence. An alert exclusion never
   discharges financial work: the stop gate counts it independently.

### Platform evidence and limits

Copied from the plan's table (fetched by the plan's author, r5), the rows B1 relies on. Polling cadence, quarantine
thresholds, alert age, route budgets and the 60-second clock margin are CO-OPS policy, not platform facts.

| Behavior | Official evidence or limit |
|---|---|
| PI discovery, exact read, terminal page | "Only return refunds for the PaymentIntent specified by this ID." "Retrieves the details of an existing refund." "If `false`, this set comprises the end of the list." https://docs.stripe.com/api/refunds/list · https://docs.stripe.com/api/refunds/retrieve · https://docs.stripe.com/api/pagination |
| Refund charge, time and statuses | "ID of the charge that's refunded." "Time at which the object was created." "This can be `pending`, `requires_action`, `succeeded`, `failed`, or `canceled`." https://docs.stripe.com/api/refunds/object |
| Owning charge and capture | "ID of the latest Charge object created by this PaymentIntent." "Amount in the smallest currency unit captured". https://docs.stripe.com/api/payment_intents/object · https://docs.stripe.com/api/charges/object |
| Retry, pruning and cap | "Limit retries of an unresolved operation to the first 24 hours after the original request, using the same key and parameters." "We generate a new request if a key is reused after the original is pruned." Stripe identifies "trying to refund more money than is left on a charge." https://docs.stripe.com/error-low-level · https://docs.stripe.com/api/idempotent_requests · https://docs.stripe.com/api/refunds/create |
| First refusal | "we save results only after the execution of an endpoint begins." **UNVERIFIED:** a blanket inference of nonexecution from HTTP 4xx. The app closes a request only on a closed list of named Stripe codes and otherwise keeps it pending and reserved. https://docs.stripe.com/api/idempotent_requests |
| Credential identity | **UNVERIFIED:** cross-key idempotency retention after a same-account key rotation, and a 404 proving that an object belongs to a different account. The app resolves the immutable payment context and limits the effect of all-account 404s (three complete scheduled passes before a hint is quarantined). |
| Webhook transport | "Stripe doesn't guarantee the delivery of events in the order that they're generated." Live retries run "up to three days". Stripe advises "Quickly return a 2xx response". https://docs.stripe.com/webhooks |
| Refund events | "Occurs whenever a refund is created." "Occurs whenever a refund has failed." "Occurs whenever a refund is updated." Stripe labels the compatibility event "`charge.refund.updated` (Deprecated)". https://docs.stripe.com/api/events/types · https://docs.stripe.com/refunds#refund-events |
| Result size | "By default, Supabase projects return a maximum of 1,000 rows." **UNVERIFIED:** this installation's cap, until checked. https://supabase.com/docs/reference/python/select |
| Scheduling | Vercel says a scheduled invocation can occur "more than once", "Vercel will not retry an invocation if a cron job fails", and during a deployment handoff "it can be skipped." **UNVERIFIED:** this installation's schedule entitlement, runtime limit and on-time execution. https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs |

**UNVERIFIED (nothing in B1 assumes any of these):** Stripe list/read-after-write latency; atomicity across provider
GETs; universal status finality; exhaustive refund-ID prefixes; availability of expanded refunds in this endpoint's
charge payload; whether every pending creation emits `charge.refunded`; behavior of cumulative flags after every
failure; a universal provider timestamp for first success. Tenant account settings and cross-clock precision at
promotion require activation evidence.

### Rollback of the schema

**Only while no epoch was ever opened** (`select count(*) from public.catering_refund_epochs;` answers 0): a NEW
reviewed migration that drops 0359's functions, tables and request columns, re-emits 0357's guard and 0343's cron
lease, and restores 0357's grants (the nine UPDATE columns and EXECUTE on the reserve, the claim and the snapshot
writer). The install record goes with its table. Once an epoch was opened, a schema reversal needs a separately
reviewed correction. Never edit 0359. Rolling the APP back while an epoch is open is the stop above, never a revert.

## Law-book text

`AGENTS.md` has no refund section yet. The text proposed to CC for it is in the PR description (CO CC does not edit
instruction files).
