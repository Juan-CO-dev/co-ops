# Catering Inbox & Channel Policy — Design

**Date:** 2026-09-01 · **Status:** APPROVED DESIGN, PARKED — implementation planning begins after the email leg goes first-live (verified sending domain + receiving MX are hard dependencies). Brainstormed with Juan in-session; every ruling below is his.

## Problem

Catering demand arrives through four channels — **Toast catering** (orders pop on KDS; we hold API creds today), **ezCater** (marketplace; emails notifications to catering@complimentsonlysubs.com; API client built dormant in `lib/ezcater/client.ts`), **Tripleseat** (event/catering CRM signed on a do-or-die discounted deal as an ezCater exit ramp, right as our own module shipped; REST API + HMAC-signed webhooks incl. `CREATE_LEAD`, OAuth 2.0, gated access — creds are a Pete/account-manager errand), and **our own infra** (portal + quotes + the new catering@ email). Messages about all four land in one human inbox today (Keith reads legacy catering@ in Google Workspace). We need one system that ingests all of it, answers what a machine may answer, escalates what it may not, and converts third-party demand toward our own funnel.

## Ratified laws (Juan, 2026-09-01)

1. **The A-boundary is control, not branding.** Concierge (machine acts directly: edit, add, remove, resend, payment ask, status) applies ONLY to artifacts our infra controls. Third-party channels get guided handoff (B) or triage (C) — never A. Toast is B today despite being our POS (we read via API; we don't machine-edit orders there). The boundary is functional: a channel graduates to A only when direct control capability is real.
2. **Pure catering intake pushes to our stuff.** A new inquiry from any channel gets the pull toward the portal funnel.
3. **Confirmation is human, forever.** No catering order reaches `confirmed` by a machine path, however automated the road to ready-to-confirm. The confirm transition requires a catering-manager-or-up actor, audited by name.
4. **Escalation always notifies the assigned human** (catering manager or per-lead assignee) with context to personally reach out. Auto-handling never silently swallows a human touchpoint.
5. **The pull is benefit-led and channel-aware.** "Save more ordering directly from us" + convenience framing — full-throated on Toast/Tripleseat/our traffic, soft on ezCater, and the final ezCater wording ships only after the vendor-terms check (recorded errand) so steering never hands them a termination reason.
6. **One customer, one story.** Every tributary auto-creates or attributes a customer profile; on our infra every action lands on the customer's SAME open artifact — the system never mints duplicate orders because a second email arrived.

## Architecture

### §1 Ingest — one river, tagged tributaries
Append-only `catering_inbound_messages` ledger: channel (`email | ezcater | tripleseat | toast | portal` — closed vocabulary), direction, sender/recipient, subject/body refs, external ref (ezCater order id / Tripleseat lead id / Toast order guid), resolved customer id, resolved lead/artifact id, classification, disposition, timestamps. Phase-1 transport = Resend receiving MX (root `@` of complimentsonlyoperations.com) into the existing svix-verified webhook, routed by `to`: `catering@` → this system · `ops-*@` → the existing vendor receipt ingest (untouched) · else → logged noise. Pete flips one Workspace forwarding rule (legacy catering@ → new catering@) to merge the old stream; replies go out from new catering@ so address books migrate themselves. API adapters bolt on per phase (below); each is just another tributary writing tagged rows — downstream never changes when one wires in.

### §2 Classification — rules first, honest when unsure
Deterministic ladder: sender/domain fingerprints (ezCater + Tripleseat notification senders) → known-customer lookup → keyword heuristics → closed vocabulary: `intake | troubleshoot_ours | troubleshoot_third_party | platform_notification | noise`. **Unclassifiable → escalate, never guess-auto-reply** (wrong words to a customer are worse than a short wait — honest-null doctrine). A model classifier may later slot behind the same vocabulary without touching downstream.

### §3 Identity resolution — every message lands on a profile and the SAME artifact
Runs between classification and playbook. (i) Sender → `catering_customers` profile: create-or-attach for EVERY tributary (an ezCater order creates/updates the profile with the external ref attributed — organization even where control is impossible). Extends the existing resolve-or-create spine (`resolveOrCreatePortalCustomer`, active → revive-deactivated → new; company auto-attribution). (ii) On our infra: profile → open artifact (existing draft/quote/order); all A-actions operate on it. New artifacts only when nothing is open or the customer explicitly starts fresh. **Caveat with written rules, not improvisation:** marketplaces mask customer emails behind relay addresses — a marketplace-born profile may key on a relay until first direct contact; the spec's build phase defines the merge rules for that moment.

### §4 Playbooks (classification × channel)
- **Intake, any channel** → warm reply from catering@ with the portal magic link (the existing auto-finish) + benefit-led pull.
- **Troubleshoot ours (A)** → machine acts on the resolved artifact: status, modify link, quote resend, payment ask (payment requests only on manager-approved artifacts — commitment-adjacent actions inherit the human gate).
- **Troubleshoot third-party (B)** → exact fix-it steps for their app, enriched by our API read where creds exist ("your Thursday order for 24 — here's where to change headcount"), + channel-aware pull line.
- **Can't help (C)** → correct support pointer, logged, digest-visible. Frustration/urgency signals skip straight to escalation.

### §5 Confirmation gate + assignment
Machine tops out at `ready_to_confirm`; the `confirmed` transition is route-enforced human-only (catering-manager level+, audit row names the actor) — closed structurally, not by policy hope. Every lead/order carries `assignee_user_id` (default: the location's catering manager — Keith today; reassignable per lead); the assignee is who the system notifies.

### §6 Escalation + digest
Escalation = immediate email from team@ (`EMAIL_FROM_TEAM`, PR #313) to the assignee's real inbox: message, customer, artifact link, suggested action. Morning digest (cron, from team@): yesterday grouped — needs-your-reply (top, linked) · auto-replied-awaiting · auto-finished · notifications · noise count — with stale unanswered items floated to top. Keith replies from his own mailbox in phase 1; in-app threaded replies (outbound with In-Reply-To via Resend) = flagged later enhancement. The deferred per-lead detail page becomes the digest click-through target.

### §7 Guardrails
Auto-reply loop protection (never reply to auto-replies/bounces/own addresses; hard per-thread daily cap) · rate limits reuse `lib/portal/rate-limit` · templates ship en+es same PR (i18n law) · ledger append-only with RLS deny-deletes · new actions join the closed `AuditAction` vocabulary · router mutations idempotent on message id (webhook retries must not double-reply).

## Staging (approach ③, Juan-approved)
Phase 1 ships the email router ON the full data model (channel vocabulary, external refs, assignee, confirmation state, identity resolution). Adapters land by credential availability: **1a Toast** catering-order read (creds in hand today) → **1b Tripleseat** `CREATE_LEAD` webhook (same HMAC pattern as Resend inbound; creds = Pete errand, OAuth 2.0) → **1c ezCater** API (creds arrive with leg ③ of the go-live batch). Keith gets one pane from day one; the pane sharpens as channels wire in.

## Dependencies & recorded errands
- Email leg first-live (verified domain, EMAIL_FROM flip, PRs #313/#314 merged) — hard gate.
- Receiving MX enable + Workspace forwarding rule (Pete) — hard gate for phase 1.
- ezCater vendor-terms check before finalizing its pull-line wording.
- Tripleseat API access (gated; no sandbox) — Pete/account manager.
- Marketplace relay-address merge rules — written during phase-1 build.
- Assignment model: confirm whether `catering_leads` needs the `assignee_user_id` column or an existing field serves.

## Explicitly out of scope
Netting catering demand out of pars (own arc, quote-link enabler filed) · in-app reply composer (later enhancement) · SMS/phone channels · auto-confirmation of anything, ever.

---

## Amendment A1 — Order-state tributaries: ezCater lifecycle + Toast catering orders (2026-09-04)

**Rulings (Juan, 2026-09-04):** (1) capture the ezCater order from **submitted** and move the lead along automatically through every stage we can observe; (2) auto-assign **Keith** (the catering manager); he reassigns as he likes; (3) Toast catering orders look like regular orders on the KDS — the classification lives in Toast's own data.

**Ground truth (introspected 2026-09-03 on api.ezcater.com):** the Order `EventKey` enum is `submitted · accepted · modified · updated · cancelled · uncancelled · rejected · failed · succeeded · succeeded_with_warnings · relish_finalized`. Subscriptions are per (caterer, eventKey). Today only `accepted` + `cancelled` are subscribed and only those two are processed (`lib/catering/ezcater-intake.ts`; everything else is ledgered as `ignored_event`). Webhook secret, subscriber and both caterer UUIDs are live on production.

### A1.1 ezCater — the lead follows the order

One lead per ezCater order, keyed on `catering_pipeline.external_ref = order uuid` (unique index already exists). Every event is ledgered in `ezcater_events` first (unchanged), then applied:

| Event | Lead action | Stage move (via `canTransition`) |
|---|---|---|
| `submitted` | create lead: `lead_source='ezcater'`, `external_ref`, contact/company from the order where the API exposes them, headcount, event date + time window from `event.timestamp` / `catererHandoffFoodTime`, items + totals in notes, **`assigned_to` = the catering manager** (see A1.3) | → `inquiry` |
| `accepted` | if no lead yet (submitted missed), create it as above | → `confirmed` — the human act is the acceptance in ezManage; audit `actor_context:'ezcater_webhook'` records that the click happened in a third-party tool |
| `modified` / `updated` | re-fetch the order, refresh headcount / date / window / notes IN PLACE (same lead), append a pipeline note "ezCater order modified" | none |
| `cancelled` / `rejected` / `failed` | append note with the event | → `lost` (releases prep demand through the existing lost path) |
| `uncancelled` | ledger + note + **notify the assignee**; no automatic reopen | none — `lost` is terminal in `LEGAL_TRANSITIONS`; reopening re-creates ledgers and stays a human act |
| `succeeded` / `succeeded_with_warnings` / `relish_finalized` | append note; **advisory only in v1** until the first real order shows what these mean in practice (payout vs fulfilment) | none in v1; `confirmed → completed` becomes automatic once verified |

Rules: a stage move that `canTransition` refuses is ledgered `illegal_transition` and left for the human — never forced. `orderByID` before acceptance is assumed to work (the fake-id probe returned an authorization error, not a validation error); the first real `submitted` event verifies it, and the code degrades to "create with what the notification carries" if the fetch is refused pre-acceptance. Subscriptions to add per caterer: `submitted · modified · updated · rejected · failed · uncancelled · succeeded · succeeded_with_warnings · relish_finalized` (nine calls per caterer, one-shot via the setup script).

**Confirmation-is-human law:** preserved. `confirmed` is reached only by the ezManage acceptance (a human), never by `submitted`.

### A1.2 Toast catering orders — born confirmed

Toast has no submit/accept split: an order is placed and paid in one step. So a Toast catering order enters the pipeline **already `confirmed`**, keyed on `external_ref = Toast order guid`, `lead_source='toast_catering'`, event date = the order's `promisedDate` when scheduled else the business date, headcount null (Toast does not carry it), items in notes, assigned to the catering manager. A voided order → `lost`.

**What is a catering order:** an order whose dining option is one of the location's catering dining options. The set already exists as data — the `toast_ingest_exclusions` rows of kind `dining_option` (today "App Catering Delivery" and "Ezcater", per shop) are exactly the "this ring is catering" levers — reuse them; **exclude "Ezcater"** from lead creation because the ezCater tributary owns those orders (one customer, one story: the Toast ring of an ezCater order attaches to the existing ezCater lead by matching the ezCater order number carried in the Toast check, else is ledgered `attributed_to_ezcater` without a lead).

**Cadence:** Toast order webhooks are partner-program only (Standard API Access does not include them), so this is a poll: a light `/api/cron/toast-catering-scan` reading orders modified since a per-location watermark, every 10–15 minutes in business hours. **Open decision:** Vercel Hobby crons are daily-only, so the driver is either (a) Vercel Pro, or (b) an external pinger hitting the endpoint with `CRON_SECRET` (the CO station's Task Scheduler or the Hermes gateway). The nightly sales pull is untouched.

### A1.3 Assignment + notification

`assigned_to` = the active user with role `catering_mgr` scoped to the lead's location, else any active `catering_mgr`, else null. On every new lead and every `uncancelled`/`cancelled`, notify the assignee (Law 4) through the inbox arc's escalation path; until that ships, the pipeline board's source chip + assignee filter is the surface.

### A1.4 Out of scope for A1

Auto-confirm of anything (never), quote synthesis from ezCater items (2c-b), Tripleseat, the receiving-MX ingest, and the morning digest — all remain in the main arc phases above.
