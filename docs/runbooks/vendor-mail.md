MERGE GATE: apply + verify 0297 AND 0299 in prod first; this code stores application/json assets and writes 0297 columns

# Vendor mail

0297 is APPLIED TO SIM (version 20261111190626, per CC's build-2 packet); do not reapply or edit it. CC must apply and verify it in production before merging the application change. Verify that the receipts bucket is private, accepts all MIME types, and has a 41943040-byte file limit. Build 2 also authors `0299_vendor_mail_b2.sql` (NOT applied): the Forward claim needs a persisted, validated body SHA-256 hash, which 0297's payload allowlist does not accept. Apply and verify 0299 after 0297, first on sim and then through CC's production gate. 0298 belongs to the inbox build.

Vendor fetches share a 40 MiB message budget. Archive-only body/header entries and unsupported MIME types never enter the receipt parser. Storage failures fail ingest before a receipt is inserted; archive_error describes completed archive omissions only (`size` or `unavailable`).

The inbound health list includes skipped catering messages routed by the catering address, so operators can redrive the pre-cutover backlog.

## Screen and stale attention

`/operations/vendor-mail` is available to GMs at their own active member shops and roles level 8+. AGM, prep manager, social media manager and shift lead do not gain access through their receiving duties. Unassigned mail is visible only to level 8+. Existing level-4 receiving triage is unchanged.

The header is a **local breakdown**, not a claim of provider/webhook completeness. Shop and date filters scope it; vendor, status and search narrow the list only. All dates are included by default. Stale means received more than 24 elapsed hours ago AND neither handled nor matched to a PO or delivery (Option A). ET calendar display does not turn this into a midnight cutoff; daylight-saving days still use 24 elapsed hours. Stale mail sorts first, oldest first; remaining mail sorts newest first. Ops Health links to the stale filter. A PO/delivery match is not an attestation that a physical delivery was reconciled.

## Forward activation and recovery

Forward is OFF unless `VENDOR_MAIL_FORWARD_ENABLED` is exactly `1`. With it off, level 8+ sees “Forwarding is off”; lower roles have no Forward control. Non-Forward operations remain available and send no email. Cron `watchSiblings` monitoring stays intact and is outside this operational no-send boundary.

Before enabling, configure `EMAIL_FROM_TEAM` with the approved team@ identity (no customer-sender fallback), verify the sender and provider credentials through CC, and configure `INBOUND_RECEIVING_DOMAIN` (required; Forward fails closed without a valid domain). Verify all active receiving aliases and shop receipt addresses. Forward refuses those exact addresses, plus the configured receiving domain and its subdomains; an alias on the company domain does not block other company recipients. Forward refuses those destinations to prevent loops. A user chooses one typed recipient or an active staff recipient, optionally adds a note, reviews the full original attachment set and explicitly sends. It never marks the message handled automatically.

Original files are fetched server-side from the private receipts bucket. Missing/omitted originals, unsupported outbound files, or a full encoded message over the 40 MB cap cause a visible refusal; Forward never silently drops attachments. Ordinary attachment viewing uses an authorized download URL valid for 60 seconds. Storage paths and provider diagnostics are not displayed.

Forward claims record the immutable payload, body hash and attachment hashes before sending. Retries within 24 hours reuse the claim and provider idempotency key. A changed payload with the same key is a conflict; provider `invalid_idempotent_request` means payload mismatch. A timeout or unknown result is ambiguous, not a delivery failure or success. After the provider's 24-hour key window, do not blindly resend: CC must reconcile provider evidence first. Accepted means the provider accepted the message, not that the recipient received it. No cron performs Forward retries.

## Receiving auto-link and operating prerequisites

When receiving creates or saves a delivery, it looks for unlinked receipts at the same shop and vendor (including a manually assigned vendor), within the inclusive ±2 ET-calendar-day window around the delivery date. Automation must be allowed and attribution must be conflict-free. Exactly one eligible receipt links only if its own forward candidate set (unlinked same-vendor/same-shop deliveries within its +/-2 ET-day window) is exactly this delivery. The shared guarded writer records a system auto-link. Any remaining candidate, including a single ambiguous receipt, produces “Pick the invoice for this delivery” on the receiving page; staff select the evidence through the existing receiving triage workflow. None leaves the delivery unchanged. Repeated saves never relink an already linked receipt.

Juan's prerequisites: configure each vendor's account number for each shop, and have staff log **every physical delivery** in receiving. Matching depends on those records; email alone cannot establish that goods arrived.

## Verification and handoff

Run the vendor-mail, inbound, receiving, email-receipts, receipt-parse, ops-health and catering-inbox tests, the offline 0297/0299 SQL harnesses, full TypeScript check and production build. Offline SQL harnesses do not replace CC's two-session sim concurrency proof. The build-2 patch/report are a review handoff; no push, merge, migration application or deployment is performed by Astra.

## PR note: live matching behavior change

The existing receipt-side `attemptAutoLink` window moved from UTC to ET calendar dates and gained snapshot CAS conditions for shop, vendor, parse state, receipt timestamp and delivery date. This is a live vendor-matching behavior change, not only a new receiving-side convenience.

## Unknown Forward: acknowledge and allow a new forward (level 8+)

The pane says "Forward outcome unknown — see runbook". `application_error` (including Resend network/timeout), `internal_server_error`, concurrent/idempotency conflicts and missing or unrecognized codes remain unknown. Only explicitly recognized definite provider rejections are failed. A provider payload mismatch is also recorded unknown, even though the API names the mismatch.

A level-8+ operator (MoO, CGS or owner), through CC's approved SQL operation, must inspect the original claim/result and reconcile the provider logs by the `vendor-mail/<claim_request_id>` idempotency key, recipient and time. Record the evidence and whether the original was accepted, rejected, or still indeterminate; if still indeterminate, explicitly acknowledge duplicate-send risk before authorizing a new Forward. Do not rewrite/delete the original claim or result or reuse its provider key. No automatic retry is authorized by this procedure.

After reconciliation, fill the four literals below. Run in an approved transaction as the database operator, never from a staff client. This appends a recovery baseline with operator provenance and advances the message revision under the same parent lock; it does not mark the message handled, pretend delivery succeeded, or add an RPC. Its marker releases only the named unknown claim in the pane. Repeat separately for every unresolved claim.

```sql
begin;
do $$
declare
  v_message_id uuid := '<message UUID>';
  v_claim_id uuid := '<original Forward request UUID>';
  v_operator_id uuid := '<active level-8+ user UUID>';
  v_evidence text := '<provider evidence; verdict; explicit approval for another send>';
  v_next_revision integer;
begin
  if not exists(select 1 from public.users where id=v_operator_id and active
    and role in ('moo','cgs','owner')) then raise exception 'forbidden'; end if;
  if length(btrim(v_evidence)) < 20 then raise exception 'evidence_required'; end if;
  perform 1 from public.inbound_messages where id=v_message_id and lane='vendor_receipt' for update;
  if not found then raise exception 'not_found'; end if;
  if not exists(select 1 from public.vendor_mail_events where inbound_message_id=v_message_id
    and event_type='forward_result' and data->>'claim_request_id'=v_claim_id::text
    and data->>'outcome'='unknown') then raise exception 'unknown_result_required'; end if;
  if exists(select 1 from public.vendor_mail_events where inbound_message_id=v_message_id
    and event_type='baseline' and data->>'forward_acknowledged_claim_request_id'=v_claim_id::text)
    then raise exception 'already_acknowledged'; end if;
  update public.inbound_messages set revision=revision+1 where id=v_message_id returning revision into v_next_revision;
  insert into public.vendor_mail_events(inbound_message_id,event_type,revision,data)
  values(v_message_id,'baseline',v_next_revision,jsonb_build_object(
    'forward_acknowledged_claim_request_id',v_claim_id::text,
    'acknowledged_by',v_operator_id,'evidence',v_evidence,'allow_new_forward',true));
end $$;
commit;
```

Verify the appended baseline, its `acknowledged_by` and evidence, and the new message revision. Reload/reopen the pane; the unknown historical result remains visible, but the acknowledged claim no longer disables Forward. A deliberate new send receives a fresh request id. Forward bodies over 128 KB are refused as `forward_body_too_large`; the 40 MB encoded-message cap remains separate. `EMAIL_FROM_TEAM` retains its configured display name on the outgoing email.
