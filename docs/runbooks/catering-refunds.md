# Catering refunds (in-app Stripe refunds)

Owner: CC (sim and prod applies, the merge), Juan (every prod act, the switch, the Stripe Dashboard checks below).

**State.** Everything here is DARK. The switch is the server env `CATERING_REFUNDS=1`; it is unset everywhere. With it
unset no refund UI is rendered and no refund route does any refund work, whatever migrations are applied and whoever is
signed in: a signed-in, same-origin request is answered 503 `refunds_off` before its body is read. (The two checks that
come before the switch still answer first: a cross-origin POST is 403, and a request with no session is 401.)
Part B1 adds a second switch, `CATERING_REFUNDS_OBSERVE=1`, also unset everywhere: see "Part B1: the Stripe mirror
(0359)" below.

| Build | What | Migration |
|---|---|---|
| #638 (merged) | The refund step on a rejected / cancelled / lost order: reserve, send to Stripe, retry, release | 0357, APPLIED TO PROD 2026-11-25 UTC |
| Round 2, Part A | GM and AGM may refund, at a shop they belong to | 0358, APPLIED TO SIM 2026-11-26 UTC (version 20261126055240); APPLIED TO PROD 2026-11-27 UTC (version 20261127204650) |
| Part B1 (this runbook's PR) | The Stripe mirror: figures read from Stripe, one send per press, staff resolve an unconfirmed send | 0359, NOT YET APPLIED (sim first, then prod on Juan's word; see "Part B1: the Stripe mirror (0359)") |
| Parts B2, B3 | Customer refund email, failed / canceled refund handling | Not built. A create stays refused by the database until both are merged and applied. |

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
row naming who, how much and why. (With 0359 and its code, Part B1 changes this: the Retry button is gone, Check Stripe
asks for no password, and Release and Attach need a fresh password and a MoO, Owner or CGS. See Part B1.)

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
3. **Prod on Juan's word.** Dry run first. The file's own assertions also check that 0357's other privileges are still
   as 0357 left them, by the WHOLE ACL: on the six functions nobody but the owner and `service_role` holds anything; on
   the two tables, the owner aside, exactly `service_role` SELECT and 0357's nine UPDATE columns. A database that has
   drifted (another role, a grant option, a changed guard trigger) is refused by name and nothing is changed. An
   unexpected grant is never revoked silently: a person finds out who made it. Done 2026-11-27 UTC: `schema_migrations`
   version 20261127204650.
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

## Part B1: the Stripe mirror (0359)

Migration `supabase/migrations/0359_catering_refund_mirror.sql`. Plan: `PLAN-refundB1v2.md` (sections 0-11 and CC's
rulings T1-T9 in section 15). Pinned by `tests/catering-refund-runbook.test.ts`.

What B1 does, in one paragraph. Stripe is the truth. B1 keeps a copy of every Stripe refund on a catering payment
(the mirror) and shows a payment's figures only when its last full read of Stripe is recent and nothing has changed
since. No figure means no Refund button. A refund press sends exactly ONE request to Stripe and never sends it again.
If Stripe's answer does not confirm the refund, the refund is "unconfirmed": its amount stays held, and a person
resolves it (below). **B1 never writes a table or column main reads for its own logic.** Main's webhook stays the only
writer of the payment's status and of the refund events. The named audit appends are aside: `catering.refund.request`,
`catering.refund.release`, `catering.refund.attach`, `catering.refund.stripe_result` and the cron heartbeat.

### 1. State and the two switches

`CATERING_REFUNDS_OBSERVE` is the env switch for reading Stripe. Beside it, the database records whether the operator
turned observation ON (step 3). The env switch decides whether B1 makes GETs; the database record decides whether any
figure can be shown.

| `CATERING_REFUNDS_OBSERVE` | `CATERING_REFUNDS` | Behaviour |
|---|---|---|
| unset | unset | **Main, byte for byte, on every existing path.** The new cron answers `skipped` with no client; the inventory page is `notFound()`; nothing of B1 runs, and B1 writes no table or column main reads. |
| 1 | unset | GETs only, and only once ON is recorded (until then the sweep answers `observe_not_recorded` and makes no GET): the sweep mirrors every settled Stripe catering payment; the inventory page works. Existing refund routes still answer 503 `refunds_off`; no panel; the webhook is main's. No money can move. |
| 1 | 1 | + the panel, Check Stripe, Attach, Release. A create also needs F4 (the database) and `REFUND_PARTS_BUILT` (the build) to say B2 and B3 are in: until then `refunds_not_activated`. |
| unset | 1 | The panel reads stored state; every payment reads `paused` at once if OFF was recorded, and within 60 minutes of the last claim if it was not (no figure, no button); every create, check, attach and release is 503 `refunds_unavailable`. Nothing is sent. |

Both unset = main byte for byte. Turning either switch OFF drains nothing.

Both switches are unset everywhere today. Turning either one on is a live switch: it needs Juan's word.

### 2. Applying 0359 (CC; sim first, then prod on Juan's word)

**Precondition: every old sender is retired.** `CATERING_REFUNDS` has been unset in every serving deployment for longer
than 15 minutes (longer than a function can live). The file checks what it can from the rows: it refuses while a 0357
claim is live, or while a `pending` / `submitted` request row was touched in the last 15 minutes. It cannot see a
deployment, so the 15 minutes are CC's to confirm. The file withdraws the old sender's grants, which stops a NEW
reserve or claim; it cannot recall a main invocation that already claimed. Such a row has an attempt on it, so 0359
treats it as possibly sent: it stays reserved, a read finds its refund by our request id, or a person attaches or
releases it (step 6). A main deployment with the switch ON can still make Stripe GETs from its read surfaces.

1. **Sim only, first:** the guarded reset of the old 0359 (it refuses unless the old tables are empty; it also puts
   the cron lease back as 0343 left it). Log it in READY.
2. **Read-only pre-flight.** Confirm the precondition above. The file's own pre-flight refuses by name and changes
   nothing: already applied; a dependency missing; any object of the old 0359; a cron lease that is not 0343's; a body
   it re-emits or relies on that is not its source file's (both fingerprints); 0357's ACLs; an old sender that may
   still be alive; two `pending` rows on one payment; an attempted row whose payment has no PaymentIntent.
3. **Dry run** (the file without its `commit`, rolled back). Then **apply**.
4. **Verify.** The file's assertions ran before its commit. Check: the three new tables exist and hold the one
   observation row; `select public.catering_refund_parts_ready();` answers false; a re-apply refuses
   `0359: already applied`. On sim, also run the two-session lock proof `scripts/sim/refund-0359-lock-check.mjs`.
5. **Stamp the header** under the gate line:
   `-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0359_catering_refund_mirror')`, and this runbook's
   state table, in the same PR or the next one.

**Locks.** `catering_refund_requests` ACCESS EXCLUSIVE (taken first, once). SHARE ROW EXCLUSIVE on `catering_payments`
and `users` (the new foreign keys). `stripe_events` and `cron_route_leases` are not locked or touched.

**Deploy order: safe both ways,** because both switches stay unset during either.

| App | Schema | Result |
|---|---|---|
| Main | 0359 applied | Main's old sender has lost its grants; with `CATERING_REFUNDS` unset it calls nothing. |
| B1 | 0359 not applied | With both switches unset nothing of B1 runs. With a switch on, every B1 call answers 503 `refunds_unavailable` and the sweep writes a `cron.failure`; nothing falls back to the old sender. |

**Rollback.**
- While the mirror and state tables are empty and no request row is armed: a NEW reviewed migration that drops the
  functions, the three tables, the eight columns and the index, re-emits 0357's guard and restores 0357's grants.
- After observation has run (rows exist): both switches off + revert the PR. The schema stays and nothing reads it.
  Removing it is a separately reviewed migration.

### 3. Turning observation on and off (needs Juan's word: a live switch)

**Turn-on, EVERY time, in this order:**

(a) CC runs the ONE operator statement, as the database owner:

```sql
select public.catering_refund_observe_set(true);
```

It prints the new transition count and how many payments it stamped. (The job's tooling folder holds exactly this
statement, the ON form and the OFF form, as `observe-switch.sql`. It is a file to copy from, not a program: a person
runs the statement.)

(b) Then set `CATERING_REFUNDS_OBSERVE=1`.

No Stripe account change is made, before or after.

**Turn-off, in this order:** unset `CATERING_REFUNDS_OBSERVE`, then run
`select public.catering_refund_observe_set(false);`.

**After any turn-on or resume, EVERY payment shows no figure for at least 5 minutes, read or never read.** The first
sweep tick after a turn-on reads nothing; the next one starts reading. Watch the sweep's heartbeat (`cron.success`,
counts only) until `never_read = 0`. The heartbeat also reports `ledger_rows_read` and `oldest_unchecked_at`: read
them, because the sweep's duration was never measured before turn-on.

**If a step is skipped.** If the env switch is turned on WITHOUT the statement: after a recorded OFF the sweep refuses
to work (`observe_not_recorded`); after an unrecorded OFF of 60 minutes or more the next claim re-stamps everything by
itself; an unrecorded OFF and ON inside 60 minutes is, to the database and to Stripe, a few missed cron ticks, and
loses nothing a missed tick does not lose (main's ledger kept recording; the hourly re-read is at most that much
later). Schema missing with a switch ON: every RPC answers `refunds_unavailable` (503) and the sweep writes a
`cron.failure`; nothing falls back to 0357's sender (its grants are gone).

**The sweep.** `/api/cron/catering-refund-sweep`, every 15 minutes, at most 120 seconds a run. GETs only: it cannot
create a refund. It is not in the job watch and sends no alert. A sweep that stops shows as `paused` on every panel
within the hour and on the inventory page, and resumes with every payment waiting again.

### 4. Inventory sign-off (CC + Juan), before any create turn-on

On `/admin/catering/refunds` (Owner / CGS only; it exists only while `CATERING_REFUNDS_OBSERVE=1`). Sign off only when
ALL of these hold:

- observation recorded ON and live;
- paused 0, never read 0, dirty 0, not complete 0, and no read left open;
- on TWO loads at least 15 minutes apart, with the SAME transition count on both (a change that arrives during the scan
  shows as dirty and must clear);
- every disagreement with main's payment status explained in the sign-off note;
- unresolved requests 0 (CC confirms with one count); claims 0;
- the `unsettled_checkouts` line read and understood as NOT covered.

The page shows "last claim" AND "last finished pass" (with its read counts). **A claim newer than the last finished
pass means a sweep that started and did not finish: do not sign off.** Wait for a pass that finishes.

### 5. Turning creates on

Only when ALL of these hold:

- B2 and B3 are merged AND applied. Until then the database refuses every create (`refunds_not_activated`):
  `catering_refund_parts_ready()` answers false, and the build constant `REFUND_PARTS_BUILT` must agree.
- The boundary for notifications is agreed with B2 / B3: no backlog (B2 reads the mirror's `first_seen_at`).
- Juan's checklist above ("Before `CATERING_REFUNDS=1`") is recorded per Stripe account.
- The inventory sign-off (step 4) is recorded.
- Juan's word.

Then set `CATERING_REFUNDS=1`, with `CATERING_REFUNDS_OBSERVE=1` already on. **Never create a production refund as
proof** that it works.

### 6. What staff see, and the unconfirmed refund

**Figures.** A payment shows its figures and the Refund button only when Stripe was read in full recently and nothing
changed since. Otherwise it says it is checking with Stripe and shows no number, with a Check Stripe button (refund
roles, no password). It shows paused when the sweep is not running: tell CC.

**After a press.** Each refund the press made is listed. The figures come back a few minutes later.

**Two copies of one press.** A double tap, or a press that meets a sweep read in flight, is answered:
"This copy of your press did not send a refund. Check the list below before you try again." The payment then shows no
figure for 5 minutes. Look at the list first. If it shows a refund in progress, do not press again.

**Unconfirmed.** If Stripe's answer did not confirm the refund, the request row reads:
"Stripe has not confirmed this refund. Do not refund it again. We keep checking. If it is still not found after
<releasableAt>, a MoO or the owner can resolve it."
Do not refund it again. Its amount stays held. No other refund can be made on that payment until it is resolved. The
sweep and Check Stripe keep looking for it, and bind it by themselves when they find it.

**Resolving it (MoO with a membership at the shop, Owner or CGS; a fresh password).**

1. The panel names the Stripe account (this shop's own, or the shared one) and the mode (live or test). Open the
   payment `pi_…` in that account and mode. If it does not open there, you are in the wrong account: stop.
2. Find the request with the key `catering-refund:<request id>` in Stripe's request log (Developers -> Logs). Stripe
   documents filters by date, status, method, endpoint and resource id, not by key, and no retention period
   (UNVERIFIED, section 9 below). If the log cannot be read, or no longer goes back that far, the finding is
   "could not tell".
3. Pick what the log showed:
   - **The request SUCCEEDED:** Attach the refund it created. Pick it from the list the panel shows (same amount; id,
     amount, date, Stripe status). Attach works at any time; there is no 24 h wait. If no refund is listed, do not
     release: press Check Stripe, then tell CC.
   - **NO request, or a request that FAILED with no refund:** Release. Only after 24 h from the send, and only after a
     full read made after that. Name the account and the mode you read; they must be the payment's own.
   - **Could not tell, or the refund the log names is not in the list:** there is no in-app exit, by design. Tell CC,
     who resolves it by a normal reviewed correction. Nothing is released.

Expected cases, not alarms:

- **A refund our own request created in the same second as the arm is never bound automatically.** Stripe's refund
  time is whole seconds, so it can look earlier than our send. A person attaches it (the "succeeded" case above).
- **A request that was armed but whose send never left** (the arm call failed in transport) looks like any unconfirmed
  request. Stripe's log shows no request. Release it after 24 h with the finding "no request".

Only CC can resolve these:

- **The panel says the Stripe key for this shop changed since the refund was sent** (`credential_changed`). Nobody can
  release or attach it in the app: tell CC.
- **An armed request whose payment stopped being eligible** has only the CC exit.
- A row the old sender attempted before 0359 carries no key record and is refused the same way: tell CC.

A real second refund is a new request, made with a new press, after the first is resolved.

### 7. Turning OFF

Either switch, any time, in any order (for OBSERVE, the turn-off order of step 3). Nothing to drain. Main's webhook
records a refund that exists at Stripe exactly as today. What stays: a reserved or unconfirmed request keeps its
reservation; the sweep finds it when OBSERVE is next on, and the inventory page and the panel list it. A turn-on after
an OFF starts with every payment waiting (step 3).

### 8. Known limits (plan section 9, with CC's rulings)

| Severity | Limit, in plain words |
|---|---|
| P2 | An unconfirmed refund is released, but its request did land at Stripe and was not yet listed. The exit has 24 h, a full read after it, a finding from Stripe's request log in the payment's own account and mode, and a named person. If the refund appears later, it is copied and counted at once and reported as a released request with a refund. |
| P2 | Accepted by CC: a change at Stripe that nothing shows yet (no event reached us), between the fresh read and the send. Stripe refuses anything past the charge; the press carries the amount it showed; one unresolved request per payment. |
| P2 | Accepted by CC: an event arrived, and Stripe's lists and retrieves still do not show the change. See the first required statement below. |
| P3 | An env switch turned off and on inside 60 minutes without the operator statement is not seen by the database. It equals a few missed cron ticks (step 3). |
| P3 | A `refunded` payment whose refund later failed stays `refunded` (main's rule). The panel and the inventory show the disagreement; the fix is a normal reviewed correction. B1 never writes the status. |
| P3 | An unconfirmed request whose log "could not tell", or whose refund is not in the list, has no in-app exit. It stays reserved and visible; CC resolves it. |
| P3 | One payment of an order that cannot be read in full (an unreachable key, an id conflict) blocks in-app refunds on the order's other payments. The inventory shows it with its reason. |
| P3 | Attach has no 24 h wait. It rests on a retrieved refund, a named person and a fresh password. |
| P3 | A Stripe change with no event is shown up to about an hour late inside the 120-day window, and after that only on an event or a press. A create never uses a shown figure: it reads again in the same request. |
| P3 | After any change on a payment, ours included, its figures are withheld for at least 5 minutes. Two copies of one press, or a press that meets a sweep read in flight, answer "check the list" and the payment shows no figure for 5 minutes. |
| P3 | A payment with too many refunds to read in one budget stays without figures. Catering payments carry a handful. |
| P3 | A Stripe refusal holds the payment 24 h (every non-2xx is unconfirmed). One unreachable key leaves that shop's payments without figures. |
| P3 | No alert when the sweep stops. It fails closed (`paused`) and resumes with every payment waiting. |
| P3 | A database with an empty or pruned webhook ledger shows no figure for the payments it cannot cover. Prod's ledger goes back to the first delivery and nothing prunes it today. |
| P3 | The sweep's duration is not measured before turn-on. The heartbeat and the inventory report it from the first run. |

**Required statements.**

- **The accepted residual (CC, Q6).** Stripe does not document that a list or a retrieve already shows a change when its
  webhook arrives, so B1 waits 5 minutes after any sign of change before it shows or uses a figure. **This lag can
  exceed five minutes.** A change that neither an event nor a read shows yet can still be missed, inside the charge's
  own cap.
- **Ledger gaps (CC, T3).** "Gaps" in main's webhook ledger means retention only. A delivery lost INSIDE the ledger is
  not seen from the ledger (accepted residual, P3). Its cover is the re-read: every payment inside the 120-day window
  gets a complete read about every hour (due 45 minutes after its last one, on the 15-minute cron, oldest first, as far
  as the run's time budget reaches). A create never rests on the re-read: it makes its own complete read in the same
  request. Beyond 120 days only an event or a staff press re-reads.
- **A future test-data purge** (the 0193 pattern) must delete B1's rows (`catering_refund_observed`,
  `catering_refund_payment_state`) BEFORE the payment rows. B1's foreign keys are NO ACTION: a payment row B1 holds a
  row for cannot be deleted first.

Also stated: B1 never writes a table or column main reads for its own logic; the named audit appends (section intro)
are aside.

### 9. Stripe citations (plan section 8, fetched 2026-11-28; fragments are verbatim)

| Used for | URL | Quote |
|---|---|---|
| A `succeeded` refund can still fail | docs.stripe.com/refunds ("Handle failed refunds") | "A refund can fail if the customer’s bank or card issuer can’t process it." · "This process can take up to 30 days from the post date." · "When using the API, a Refund object’s status transitions to `failed` and includes these attributes:" · "In the rare instance that a refund fails, Stripe notifies you using the `refund.failed` event" |
| A pending refund can sit 45 days, then fail | docs.stripe.com/refunds (intro) | "If your balance is still insufficient 45 days after you create the refund, the refund fails" |
| `succeeded` -> `requires_action` | docs.stripe.com/refunds ("Refunds that require action") | "Refund is expected to arrive in customer’s bank \| `succeeded`" · "Customer’s bank returns the funds back to Stripe \| `requires_action`" · "the funds are returned to Stripe and the refund transitions back to `requires_action`." |
| Cancel | same page | "Only Dashboard cancellations are currently supported for card refunds." |
| Status values | docs.stripe.com/api/refunds/object | "Status of the refund. This can be `pending`, `requires_action`, `succeeded`, `failed`, or `canceled`." |
| The 120 days | an operating policy, not a quote: 45 days pending + 30 days for a bank return + the customer-side delay ("approximately 5-10 business days later"), with margin. How long after `succeeded` a `requires_action` return can come is NOT stated: **UNVERIFIED**; safe side = any ledger event still marks the payment dirty after 120 days, and a staff press always re-reads. |
| Refunds never exceed the charge | docs.stripe.com/api/refunds/create | "You can do so multiple times, until the entire charge has been refunded." · "This method will raise an error when called on an already-refunded charge," + "or when trying to refund more money than is left on a charge." |
| Our id rides on the refund | docs.stripe.com/error-low-level ("Server errors") | "When creating a resource, include a local identifier in its metadata" + "so you can match an object received through a webhook to your local records, including after reconciliation." |
| A claim is correlation, not proof | docs.stripe.com/api/refunds/update | "Updates the refund that you specify by setting the values of the passed parameters." · "This request only accepts `metadata` as an argument." So metadata can be written after creation: a read binds only the unique candidate that also matches payment, amount, PaymentIntent / charge and time [Q2], and money never depends on a binding. |
| A refund's `created` is whole seconds [DR14] | docs.stripe.com/api/refunds/object | "Time at which the object was created. Measured in seconds since the Unix epoch." |
| One POST, no retry, staff reconcile | docs.stripe.com/error-low-level | "Treat the outcome of a request that returns `500` as indeterminate:" + "the operation might have produced side effects even though you received an error." · "If the outcome is still unknown after that window, don’t retry with either the old key or a new one." · "Restoring connectivity doesn’t tell you whether the original request succeeded." |
| 24 h | docs.stripe.com/error-low-level ("POST requests") · docs.stripe.com/api/idempotent_requests | "Stripe retains keys for at least 24 hours and can remove them after that." · "We generate a new request if a key is reused after the original is pruned." These are about key retention. They do NOT say an empty list after 24 h proves no refund: hence the finding the releaser must state, and section 9's first row. v2 never re-uses a key. |
| Does a 4xx mean "not executed"? | docs.stripe.com/error-low-level | NOT FOUND. The nearest text is about caching ("Errors that occur before execution begins, such as invalid parameters, an invalid API key, or rate limiting," + "don’t cache a result."); a status code does not say which side of "execution begins" an error fell on. **UNVERIFIED** -> every non-2xx is unconfirmed (DR4). |
| The request log a releaser reads [P3-5] | docs.stripe.com/development/dashboard/request-logs · docs.stripe.com/workbench/overview | "The [Logs] tab includes a list of recent API requests and responses for your Stripe account." The documented filters are date, status, method, API endpoint, source, API version, error type / code and resource id. A filter by idempotency key: NOT FOUND. How far back the log goes: NOT FOUND. **UNVERIFIED** -> the release needs a positive statement of what the log showed; "could not tell" releases nothing and goes to CC. |
| Which account a key belongs to [DR15] | docs.stripe.com/api/accounts/retrieve · docs.stripe.com/get-started/account | The documented call is `GET /v1/accounts/{id}` ("Retrieves the details of an account."), which needs the id; a call by which a key learns its OWN account id: NOT FOUND. "You can find your account ID in your Account and Personal details settings." **UNVERIFIED** -> B1 does not call it; the account is named by the credential slot the read resolved, and the person proves they are in it by opening the PaymentIntent there. |
| Discovery | docs.stripe.com/api/refunds/list · /api/pagination · /api/refunds/retrieve | "Only return refunds for the PaymentIntent specified by this ID." · "Only return refunds for the charge specified by this charge ID." · "If `false`, this set comprises the end of the list." · "Retrieves the details of an existing refund." |
| Refund -> payment; the owner charge | docs.stripe.com/api/refunds/object · /api/charges/object · /api/payment_intents/object | "ID of the PaymentIntent that’s refunded." · "ID of the charge that’s refunded." · "ID of the PaymentIntent associated with this charge, if one exists." · "ID of the latest Charge object created by this PaymentIntent." · "Amount in the smallest currency unit captured" |
| The charge's own cumulative | docs.stripe.com/api/charges/object | "Amount in the smallest currency unit refunded" + "(can be less than the amount attribute on the charge if a partial refund was issued)." Whether it includes pending refunds, or drops a refund that later failed: NOT FOUND, **UNVERIFIED**. **It is not used anywhere** [Q3]. |
| Events are triggers only | docs.stripe.com/webhooks | "Stripe doesn’t guarantee the delivery of events in the order that they’re generated." · "You can also use the API to retrieve any missing objects." |
| Which refund events exist | docs.stripe.com/refunds ("Refund events") | "`refund.updated` \| Sent when the refund is updated." · "`refund.failed` \| Sent when a refund has failed." · "`charge.refunded` \| Sent when a charge is refunded, including partial refunds." Which of them this account is subscribed to is not assumed: the sweep covers all of them. |
| **UNVERIFIED, each with the side taken** | | **Read-after-write** (that a list or retrieve already shows a change when its webhook arrives): **accepted in writing by CC [Q6]**; 5 minutes must pass between the dirty instant and a read that counts, for the display, the reserve, the arm, the attach and the release alike. The interval is a policy, not evidence that Stripe has converged [R15]: section 9, rows 2 and 3. **List consistency across pages:** every id retrieved; every already-mirrored id retrieved again; both lists. **Refund ids unique across accounts / payments:** an id under two payments is `evidence_conflict` (not complete, dirty, listed). **Every refund carries `payment_intent`:** the charge list, and the charge match. **A webhook payload's object is never expanded:** docs.stripe.com/api/events/object does not say (NOT FOUND); F2 matches scalar and expanded ids and the object's own id. **That two credentials knowing one PaymentIntent id mean one charge:** every permitted account must answer and all must agree, amounts included. |

Two rows above use names the rulings later changed: [DR14] (whole-second comparison) is WITHDRAWN by [T1]: the
automatic bind compares at full precision, and a refund in the arm's own second goes to a person. [DR15] is replaced
by [T5]: the account is still named by its credential slot and mode, and the arm also records the credential
fingerprint (a non-secret hash, never the key).

## Law-book text

`AGENTS.md` has no refund section yet. The Part B1 text proposed to CC is in
`co-ops-wt/refundB1-parts/AGENTS-proposed-section.md` (CO CC does not edit instruction files).
