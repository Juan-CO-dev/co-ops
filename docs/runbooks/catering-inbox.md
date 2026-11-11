# Catering inbox: phase 1 (shadow) and phase 1b (delivery, shipping OFF)

Phase 1 receives and classifies catering email, attaches existing identities and artifacts, and stores proposed replies for review. **Drafts are not being sent.** The singleton `catering_inbox_settings.mode` is seeded `shadow`. Phase 1b (migration 0298) adds the sending side behind TWO switches that both ship OFF — the settings mode and the env flag — plus explicit sender configuration; see "Phase 1b: delivery" below. Nothing sends until Juan activates it in that order. There is still no token generation and no SMS.

## Alias and transport checks

Before rollout, verify the active aliases in the existing inbound settings surface against the actual Workspace copy rule. Catering aliases **must include the legacy address preserved in the original To header**, not just the copy destination. Verify the lane is `catering` and location is null (0294 requires catering aliases to be global). No tenant address is seeded by the migrations.

Check `CATERING_LEGACY_ADDRESSES` (comma-separated addresses), `EMAIL_FROM`, `EMAIL_FROM_TEAM`, active inbound aliases and `locations.receipt_email_address`: together these form own-address suppression. Check `NEXT_PUBLIC_APP_URL` is the intended app origin and uses `https:` (no username or password); proposed replies use its plain `/order/start` route, never a magic-link token. Check the existing receiving-provider configuration without copying credentials into logs, screenshots or this runbook.

Mixed catering/vendor recipients retain the router's existing ambiguous behavior. A missing alias is a routing configuration issue, not an invitation to parse catering mail as a vendor receipt. Catering fetches only the receiving-email endpoint, including text/HTML, selected headers and attachment metadata; it never downloads attachments or lists their endpoint.

## Apply order and review

`supabase/migrations/0296_catering_inbox.sql` remains an unapplied file in this change. Apply its dependencies, including 0294 transport routing, before 0296. Run the offline `node scripts/sql-harness-0296.mjs` first. CC then applies 0296 to **sim first**, verifies writer privileges, idempotent ingest/resume and authenticated English/Spanish panes at 375px. Production application is only on Juan's word. Stamp the migration header with the actual application provenance afterward; never infer application from this document.

**Merge ONLY after 0296 is applied in production.** The missing-schema fallback is deployment-window protection, not permission to reverse this order.

The inbox permits active catering managers, GMs for their current shops and level 8+. Null-location messages are for catering managers and level 8+ only. Check inactive/stale memberships and cross-shop detail/action IDs. The sender, subject and body are plain text under the inbox and catering-contact gates. Artifact links retain their own authorization.

## Redrive

After 0296 is installed, count the skipped-catering backlog using this read-only query:

```sql
select count(*) from inbound_messages where lane='catering' and content_state='skipped' and route_reason='catering_address';
```

Review the matching transport IDs, then redrive each through step 2 below (no bulk SQL reset). Repeat the count after the worker runs and reconcile any remaining rows before declaring the backlog recovered.

1. Diagnose and correct the missing provider configuration or alias first. Open the existing Ops Health inbound queue as MoO+.
2. Use its existing redrive action for failed or blocked-configuration transport rows. Skipped rows are not listed in that health queue: for a reviewed skipped row ID, use the same existing `POST /api/admin/inbound/redrive` with JSON `{ "id": "<transport UUID>" }`, the authenticated MoO+ session, same-origin request and existing admin step-up requirement. A skipped row is eligible only with `lane = catering` and `route_reason = catering_address`; no bulk reset is supported.
3. Redrive resets the transport to pending through a lane-fenced compare-and-set and emits `inbound.redrive`. A conflict means the row changed or is leased; refresh and inspect it before retrying.
4. Let the existing inbound retry worker process the pending row. An absent child fetches once, records, then finalizes; a recorded child resumes from stored content without refetch; a finalized child repairs transport completion. Review the pane and event history. Provider failure rows without children appear in Needs your reply.

Handle and Reassign use a revision and unique request ID, same-origin checks and fresh authorization. They do not send a reply, move a lead, confirm a quote or change an artifact's assignee. Reassignment changes the inbox message only.

## Guide-test reset gate (P3-12)

The existing `scripts/guide-test/reset-catering-fn.sql` is an installed **SIM ONLY** function, not an application migration; `scripts/guide-test/reset.ts` invokes it. Its SQL is left unchanged under this round's applied-SQL exception. **CC must review and reinstall an inbox-aware sim reset before running catering guide resets after 0296.** Do not run the old reset against inbox-linked test artifacts: its deletes can fail on the new foreign keys. No SQL was applied in this build.

The reviewed extension must collect inbox message IDs referencing test quote IDs or lead IDs, including messages owning drafts that reference those artifacts. Delete their `catering_inbox_events`, then `catering_inbox_drafts`, then `catering_inbound_messages` before deleting quotes/leads. After selecting the test customers eligible for deletion, repeat this child-first sequence for messages referencing those customers before deleting them. Keep transport rows, inbox settings, non-test rows and the append-only audit log. Retain the existing sim-persona sentinel, schema-qualified queries, pinned search path and service-role-only execution. Test both quote/lead-linked rows and customer-only rows in sim before reinstall approval.

## Rollback and follow-ups

Rollback by reverting the application code; keep 0296 tables, event history and drafts. Do not drop data or apply a compensating destructive migration. The prior router skips catering, so retained records remain available for a later reviewed resume.

Deferred: digest email, body retention/erase and the shared vendor inbox alias. Draft links now come from `portalOrigin()` (`lib/portal/origin-shared.ts`): the plain `/order/start` page of the configured portal origin, never a token. Urgency cues `today`/`hoy` intentionally err toward human review and can produce false positives.

## Phase 1b: delivery (0298) — ships OFF

### What it is

- `supabase/migrations/0298_catering_inbox_delivery.sql`: delivery state ON the draft row (`draft | claimed | sent | failed | ambiguous | cancelled`, fencing token, attempt times, provider id, closed error code, recipient snapshot), the per-thread daily cap table `catering_inbox_thread_limits` (max **three** customer replies per thread per UTC day; a retry reuses its reservation), the writers `claim_catering_inbox_delivery` / `finish_catering_inbox_delivery` (lock order settings → message → draft → thread row; every eligibility fact is re-checked at claim time; a lost lease cannot finish; sent never returns to draft; an expired lease becomes `ambiguous` for a person and is never auto-resent), `set_catering_inbox_mode` (owner / CGS only, revision-checked, audited `catering.inbox.delivery_mode_change`), and the cron lease job `catering-inbox-delivery`. Deny-all RLS and the service-role SELECT-only ceiling hold for every inbox table. Offline proof: `node scripts/sql-harness-0298.mjs` (CI-pinned).
- **The ONLY sender is `lib/catering/inbox-delivery.ts`** (pinned by `tests/catering-inbox-no-send.test.ts`). A send needs ALL of: mode `live`, `CATERING_INBOX_DELIVERY_ENABLED=1`, `CATERING_INBOX_FROM` (customer replies; `addr` or `Name <addr>` — no fallback to `EMAIL_FROM`), `EMAIL_FROM_TEAM` (staff escalations), `RESEND_API_KEY`, and a successful SQL claim. Anything missing or malformed fails closed (`delivery_off` / `not_configured`).
- Customer replies go from the inbox sender with `In-Reply-To` / `References` (validated in `lib/email.ts`); escalations of `needs_human` arrivals go to the message's assignee from team@ in the assignee's language. One claim = one attempt = one idempotency key `catering-inbox:<draft id>:<attempt>`. **Uncertainty is preserved:** a timeout, a network error, a 5xx, a 200 with no id, an unknown provider error name or Resend's `concurrent_idempotent_requests` is retried ONCE under the same key and otherwise recorded `ambiguous` (`provider_uncertain`); a same-key payload conflict (`invalid_idempotent_request`) is `ambiguous` / `idempotency_conflict`. Only a confirmed 4xx rejection (validation, bad sender, quota, rate limit…) is `failed`, the one state a later attempt (new key) may follow. The cron sweeps claims whose holder never reported within 10 minutes (`sweep_catering_inbox_delivery`) into `ambiguous` / `lease_expired` with an audit row — nothing resends them; a person reads the thread and decides.
- The claim re-reads the customer (active, same email), the lead (open, same customer and shop) and the linked quote (same owner, lead and shop, `superseded_at IS NULL` → else `quote_revalidation_failed`). The three-per-thread cap is reserved for the UTC day of the attempt: a retry on a later day takes that day's capacity (a reservation never carries over).
- The cron's queue is `catering_inbox_delivery_due` (0298): eligibility — drafted / needs_human, since `live_since`, draft or failed under 3 attempts past the 10-minute backoff, no escalation yet or a retryable one — is decided IN SQL before the 25-row limit, so any number of sent, handled, exhausted or notified predecessors never hides a newer eligible row (harness: 300 per lane). A same-key retry resolves an uncertain first answer only by CONFIRMING success; a rejection of the retry keeps the first outcome ambiguous.
- 0298 re-emits the cron lease with the UNION of the two parallel jobs (`catering-inbox-delivery` + 0300's `meta-leads`) and accepts either prior set at preflight, so 0298 and 0300 may apply in either order without dropping the other's job.
- Surfaces: `POST /api/catering/inbox/[id]/send` (human "Send draft": same-origin, Tier B password, live mode only, server-selected recipient, no editable body or address), `POST /api/admin/catering-inbox/settings` (owner / CGS, Tier B), `GET /api/cron/catering-inbox-delivery` (every ten minutes at :05; inert before its lease unless BOTH switches are on; not in `JOBS_REGISTRY`). The pane shows a Send button only in live mode on a sendable draft, a delivery chip, named errors, and the mode control to owner / CGS.
- **Activation never bulk-sends old shadow drafts.** The cron only takes drafts finalized after `live_since` (0298 `not_new`); older drafts stay visible and become manually sendable after the claim's revalidation (customer still active and matching, lead still open, message not handled, no automated-mail headers).

### Activation (Juan's call, in this order)

1. Apply 0298 to **sim** (`node scripts/sql-harness-0298.mjs` first; preflight refuses if a parallel migration changed the cron lease job set — re-sync 0298 then). Verify writer privileges and run the sim concurrency check (two sessions claiming one draft; two cron ticks). Then **prod** on Juan's word; stamp the header.
2. Set `CATERING_INBOX_FROM` (the real catering@ sender on the verified domain — never `onboarding@resend.dev`), confirm `EMAIL_FROM_TEAM` and `RESEND_API_KEY`, then `CATERING_INBOX_DELIVERY_ENABLED=1` in Vercel and redeploy. The mode is still `shadow`: nothing sends yet.
3. Pete or Juan (owner / CGS) opens `/catering/inbox`, chooses **Live** in the delivery mode control and confirms the password. `live_since` is stamped; from the next cron tick new eligible arrivals send automatically and Keith's Send button appears on drafted messages.
4. Watch the first day: `catering.inbox.delivery_*` audit rows, the delivery chips, and any `ambiguous` draft (a person must read the thread and decide; nothing re-sends it).

### Rollback

- One tap: owner / CGS sets the mode to **Off** (or **Shadow**). Every claim refuses `delivery_off` at once; the cron skips before its lease.
- Unset `CATERING_INBOX_DELIVERY_ENABLED` (or revert the code). Keep 0298: tables, drafts, reservations and events are evidence. Never reset a `sent` row.
