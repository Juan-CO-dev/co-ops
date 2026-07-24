# Spec #2c — EZCater Live Intake (design)

**Date:** 2026-07-24 · **Approved:** Juan ("build 2c on auto, same hold rules" — HOLD at CI-green PR; migration 0149 staged, prod apply on his go)
**Grounding:** EZCater API deep dive `~/.claude/docs/2026-07-24-ezcater-api-deep-dive.md` (source: ezCater Public API User Guide May 2024 v5, official PDF — ALL fixture shapes cite it; fixture-fiction rule in force). Builds on spec #2b's source registry + `fetchPlatformOrders` seam.

## Purpose & honest scope

Accepted EZCater orders become CO-OPS pipeline leads with ZERO manual entry: signed webhook → append-only event ledger → `orderByID` enrichment → auto-created lead (`lead_source='ezcater'`, deduped on order UUID, full order context in notes). Cancellations flag the lead's events ledger row and surface for human action.
**v1 does NOT auto-advance to confirmed:** W4a reserve resolves QUOTE LINES, and an auto-created lead has none — real auto-reserve needs the EZCater item→CO-OPS entity mapping + quote synthesis (named fast-follow #2c-b, after the PLU mapping via api_support@ezcater.com). The human confirm click on the board is the v1 acknowledgment into the prep plan.

## EZCater contract facts this build pins (from the official guide)

GraphQL `POST https://api.ezcater.com/graphql`; headers `Authorization: <raw token>` (NOT Bearer) + `Apollographql-client-name/-version`; operations MUST be named (`orderByID`, `allCaterers`, `allSubscribers`, `createSubscriber`, `createSubscription`). Webhook-ONLY order feed (`accepted`/`cancelled` on entity Order, per Caterer parent; fires on ACCEPT, not placement; NO list-orders query → no polling reconciliation exists). Thin notification payload `{id, parent_type, parent_id, entity_type, entity_id, key, occurred_at}`. Signature header `X-Ezcater-Signature: <timestamp>.<hmac>` where hmac = HMAC-SHA256(webhookSecret, `<timestamp>.<raw body>`). Money = `{currency, subunits}`. Order detail per the doc's `orderByID` example (orderNumber, event{headcount,timestamp,catererHandoffFoodTime,orderType}, caterer{uuid,...}, totals, catererCart.orderItems{name,uuid,quantity,posItemId,menuItemSizeId,specialInstructions,customizations}).

## Data model (migration 0149 — STAGED)

```sql
alter table public.locations add column ezcater_caterer_uuid text;
alter table public.catering_pipeline add column external_ref text;
create unique index catering_pipeline_external_ref_uq on public.catering_pipeline(external_ref)
  where external_ref is not null;

create table public.ezcater_events (
  id uuid primary key default gen_random_uuid(),
  notification_id text,
  parent_id text,               -- ezCater caterer uuid
  entity_id text,               -- ezCater order uuid
  event_key text,               -- accepted | cancelled | (anything they add)
  occurred_at timestamptz,
  raw jsonb not null,           -- full webhook body, verbatim (forensics)
  signature_valid boolean not null,
  processing_result text,      -- created_lead | duplicate | cancelled_flagged | unmapped_location | invalid_signature | error:<code>
  lead_id uuid references public.catering_pipeline(id),
  received_at timestamptz not null default now()
);
-- deny-all RLS split policies (0143/0146/0147 pattern); lib is sole authority.
```

## Modules

- **`lib/ezcater/webhook-shared.ts`** (pure + node:crypto, fully unit-tested): `parseEzcaterSignature(header)` → `{timestampSec, signature}|null`; `verifyEzcaterSignature(secret, header, rawBody)` → boolean (HMAC-SHA256 over `<ts>.<body>`, `timingSafeEqual`); `parseEzcaterNotification(json)` → typed notification | throws (shape from the doc, poison on malformed).
- **`lib/ezcater/client.ts`** (server-only): env `EZCATER_API_TOKEN`; `ezcaterConfigured()`; `ezcaterGraphql<T>(operationName, query, variables?)` with the four required headers (`Apollographql-client-name: co-ops`); FIXTURE MODE when unconfigured or `EZCATER_FIXTURES=1` → `tests/fixtures/ezcater/<operationName>.json`. Typed `EzcaterApiError` (`not_configured|auth_failed|http_<n>|bad_payload|graphql_error` — a non-empty `errors` key poisons).
- **`lib/ezcater/orders.ts` + `orders-shared.ts`**: `orderByID` query string (exact doc fields); pure `normalizeEzcaterOrder(json)` → `{orderNumber, orderType, headcount, eventTimestamp, handoffTime, catererUuid, totalDueCents, items:[{name, quantity, sizeId, posItemId, specialInstructions, customizations:[...]}]}`; fixture from the doc example, source-noted.
- **`lib/catering/ezcater-intake.ts`** (server-only, service-role, NO actor — system ingestion): `processEzcaterNotification(rawBody, signatureValid)`:
  1. Always append to `ezcater_events` first (raw, verbatim) — even invalid signatures (`invalid_signature`, no processing).
  2. `accepted`: dedupe on `catering_pipeline.external_ref = entity_id` (existing → `duplicate`, append a re-accept note via direct update of ezcater_events row only — the lead is NOT silently mutated); resolve location via `locations.ezcater_caterer_uuid = parent_id` (miss → `unmapped_location`); fetch + normalize order; INSERT lead directly (createLead requires an AuthContext — system path inserts the same shape: stage `inquiry`, `lead_source='ezcater'`, `external_ref`, contact_name = `EZCater order <orderNumber>` (contact fields unconfirmed in their schema — introspect at first-live), headcount, event_date from eventTimestamp, time_window from handoffTime, notes = ordered-items summary + totals; created_by null) + the append-only inquiry pipeline event + audit `catering.pipeline.create` with `actor_context:'ezcater_webhook'`, actorId null. Stamp `created_lead` + lead_id.
  3. `cancelled`: find lead by external_ref → stamp `cancelled_flagged` + lead_id (human moves the stage; if the lead was confirmed, the human move releases W4a per existing wiring). Unknown lead → `unmapped_location`-style result `error:lead_not_found`… recorded as `processing_result='cancelled_unmatched'`.
  4. NEVER throws to the route: every failure path records `error:<code>` on the ledger row and returns.
- **Webhook route `app/api/webhooks/ezcater/route.ts`** (FIRST inbound webhook in the codebase): POST only; `EZCATER_WEBHOOK_SECRET` unset → 503 `webhook_disabled` (dormant-safe, nothing stored); read RAW body (`req.text()`); verify signature → invalid: ledger row + 401; valid: process + **200 always** (webhook providers retry on non-2xx; skips/duplicates are 200 with `{result}`); 500 only on ledger-append failure itself.
- **Admin visibility (Toast tab grows an Integrations footer):** per-location `EZCater caterer UUID` input beside the Toast GUID (new `POST /api/admin/ezcater/location`, GM+ ≥7 Tier-A, audited `ezcater.set_location_uuid`, lib `lib/admin/ezcater-map.ts` incl. `loadEzcaterEvents` last 20 for the read ≥6 events list rendered under it). Webhook URL + setup state shown (env-configured or not).
- **Setup script `scripts/ezcater-setup.ts`** (one-shot, runs when the token lands): prints `allCaterers` (uuid↔store mapping for the location inputs), runs `createSubscriber` (name "CO-OPS", webhook URL arg) — PRINTS the webhookSecret ONCE with a save-it-now warning — then `createSubscription` (accepted + cancelled) per caterer uuid arg. Direct-invocation-gated per house seed-script law.
- **`fetchPlatformOrders` seam:** ezcater branch now returns `{status:"fetched"}` with a single-order lookup? NO — the seam's contract was list-shaped and this generation has no list query; seam stays `not_configured` with its header updated to point here. (Honest, avoids a lying interface.)
- Env example: `EZCATER_API_TOKEN`, `EZCATER_WEBHOOK_SECRET`, `EZCATER_FIXTURES`. i18n en+es for all new admin strings.

## Testing

`tests/ezcater-webhook.test.ts`: signature parse/verify (valid, tampered body, wrong secret, malformed header) + notification parse poisoning. `tests/ezcater-orders.test.ts`: normalize on the doc-shaped fixture (money subunits→cents, items/customizations, missing-optional tolerance, malformed poisons). Route/intake logic exercised through the pure seams; ledger paths typecheck-verified (house pattern — no DB mocking in the unit spine).

## OUT (named)

Auto-confirm + quote synthesis + item crosswalk (#2c-b, needs PLU mapping); menu-updated subscription; the newer-generation submit/accept mutations; any outbound write to ezCater; retry/replay tooling (their retries + the ledger cover v1).

## Done criteria

Typecheck/tests/build green with zero env; webhook route 503s unconfigured; with `EZCATER_FIXTURES=1` a doc-shaped notification processes end-to-end locally into a lead; 0149 staged only. HOLD at CI-green PR.
