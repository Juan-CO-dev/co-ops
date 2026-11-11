# Catering inbox: phase 1 (shadow)

Phase 1 receives and classifies catering email, attaches existing identities and artifacts, and stores proposed replies for review. **Drafts are not being sent yet.** The singleton `catering_inbox_settings.mode` is seeded `shadow`; this release has no settings mutation, send route, delivery worker, token generation or email/SMS notification. Do not change the mode to activate delivery: phase 1b is a separate reviewed release.

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

Deferred: delivery phase 1b, digest email, body retention/erase and the shared vendor inbox alias. The separate portal-origin PR will replace the local plain-start URL helper with `portalOrigin()` from `lib/portal/origin-shared.ts`; this change does not depend on that file. Urgency cues `today`/`hoy` intentionally err toward human review and can produce false positives.
