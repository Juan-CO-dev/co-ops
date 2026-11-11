MERGE GATE: apply + verify 0297 in prod first; this code stores application/json assets and writes 0297 columns

# Vendor mail

0297 is APPLIED TO SIM (version 20261111190626, per CC's build-2 packet); do not reapply or edit it. CC must apply and verify it in production before merging the application change. Verify that the receipts bucket is private, accepts all MIME types, and has a 41943040-byte file limit. Build 2 also authors `0299_vendor_mail_b2.sql` (NOT applied): the Forward claim needs a persisted, validated body SHA-256 hash, which 0297's payload allowlist does not accept. Apply and verify 0299 after 0297, first on sim and then through CC's production gate. 0298 belongs to the inbox build.

Vendor fetches share a 40 MiB message budget. Archive-only body/header entries and unsupported MIME types never enter the receipt parser. Storage failures fail ingest before a receipt is inserted; archive_error describes completed archive omissions only (`size` or `unavailable`).

The inbound health list includes skipped catering messages routed by the catering address, so operators can redrive the pre-cutover backlog.

## Screen and stale attention

`/operations/vendor-mail` is available to GMs at their own active member shops and roles level 8+. AGM, prep manager, social media manager and shift lead do not gain access through their receiving duties. Unassigned mail is visible only to level 8+. Existing level-4 receiving triage is unchanged.

The header is a **local breakdown**, not a claim of provider/webhook completeness. Shop and date filters scope it; vendor, status and search narrow the list only. All dates are included by default. Stale means received more than 24 elapsed hours ago AND neither handled nor matched to a PO or delivery (Option A). ET calendar display does not turn this into a midnight cutoff; daylight-saving days still use 24 elapsed hours. Stale mail sorts first, oldest first; remaining mail sorts newest first. Ops Health links to the stale filter. A PO/delivery match is not an attestation that a physical delivery was reconciled.

## Forward activation and recovery

Forward is OFF unless `VENDOR_MAIL_FORWARD_ENABLED` is exactly `1`. With it off, level 8+ sees “Forwarding is off”; lower roles have no Forward control. Non-Forward operations remain available and send no email. Cron `watchSiblings` monitoring stays intact and is outside this operational no-send boundary.

Before enabling, configure `EMAIL_FROM_TEAM` with the approved team@ identity (no customer-sender fallback), verify the sender and provider credentials through CC, and verify the receiving aliases, shop receipt addresses and receiving domain. Forward refuses those destinations to prevent loops. A user chooses one typed recipient or an active staff recipient, optionally adds a note, reviews the full original attachment set and explicitly sends. It never marks the message handled automatically.

Original files are fetched server-side from the private receipts bucket. Missing/omitted originals, unsupported outbound files, or a full encoded message over the 40 MB cap cause a visible refusal; Forward never silently drops attachments. Ordinary attachment viewing uses an authorized download URL valid for 60 seconds. Storage paths and provider diagnostics are not displayed.

Forward claims record the immutable payload, body hash and attachment hashes before sending. Retries within 24 hours reuse the claim and provider idempotency key. A changed payload with the same key is a conflict; provider `invalid_idempotent_request` means payload mismatch. A timeout or unknown result is ambiguous, not a delivery failure or success. After the provider's 24-hour key window, do not blindly resend: CC must reconcile provider evidence first. Accepted means the provider accepted the message, not that the recipient received it. No cron performs Forward retries.

## Receiving auto-link and operating prerequisites

When receiving creates or saves a delivery, it looks for unlinked receipts at the same shop and vendor (including a manually assigned vendor), within the inclusive ±2 ET-calendar-day window around the delivery date. Automation must be allowed and attribution must be conflict-free. Exactly one eligible receipt links through the shared guarded writer and records a system auto-link. Several candidates produce “Pick the invoice for this delivery” on the receiving page; staff select the evidence through the existing receiving triage workflow. None leaves the delivery unchanged. Repeated saves never relink an already linked receipt.

Juan's prerequisites: configure each vendor's account number for each shop, and have staff log **every physical delivery** in receiving. Matching depends on those records; email alone cannot establish that goods arrived.

## Verification and handoff

Run the vendor-mail, inbound, receiving, email-receipts, receipt-parse, ops-health and catering-inbox tests, the offline 0297/0299 SQL harnesses, full TypeScript check and production build. Offline SQL harnesses do not replace CC's two-session sim concurrency proof. The build-2 patch/report are a review handoff; no push, merge, migration application or deployment is performed by Astra.
