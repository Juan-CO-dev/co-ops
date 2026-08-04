# Delivery Intake P2 — Email Channel + Inference Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Implementers have NO shell — write files; the controller runs tests/commits. READ every referenced live file before authoring (confirm-before-authoring).

**Goal:** Light up the vendor-claim side of the two-way match (email receipts: ingest → store → link → side-by-side compare → manager attestation) and give on-hand its cold-start (inferred baselines from prep activity), plus the counts→Inventory Audit reframe.

**Architecture:** Ledger-first email ingestion per the EZCater webhook pattern, dormant-until-DNS for the inbound address, manual upload live day one. Anchors compose at READ time — `sku_count_events` stays pure census forever; the `inferred` tier is a lazily-persisted baseline table; `computeOnHand` gains source provenance. No parsing in P2 (P4): match verdicts are manager ATTESTATION on a visual compare. Match-missing badges derive at read (no cron).

**Spec:** `docs/superpowers/specs/2026-08-02-delivery-intake-ordering-design.md` (D4, D6 as amended, A-calls). Grounding facts (verified 2026-08-04): highest migration 0169 · photos bucket = images-only 8MB (receipts need their own) · no email_receipt_id yet · EZCater pattern at `app/api/webhooks/ezcater/route.ts` + `lib/ezcater/webhook-shared.ts` (HMAC ts.hex, 300s freshness, always-explicit status) · cron auth = `CRON_SECRET` timing-safe header (dormant-safe 503) · Resend outbound-only, domain UNVERIFIED · counts copy keys `counts.page.title` ("Physical count") etc. · `OnHandInput` = { skuId, anchorOz, anchorAt, receivedSinceOz, consumedSinceOz, anchorStale } at `lib/counts-shared.ts:420` · usage-rank consumption queries already exist in `lib/receiving.ts` `loadSkuUsageRank` (mirror its lanes).

**Constants (locked at plan time):** inferred baseline = `COVERAGE_DAYS (7) × avg daily consumed oz over trailing WINDOW_DAYS (28)`; SKUs with zero consumption in the window get NO baseline (advisory-null stays — never fabricate). Missing-email flag threshold = 48h. Auto-link rule = single-candidate only.

---

### Task 1: Migration 0170 — email_receipts + receipts bucket + FKs

**Files:** Create `supabase/migrations/0170_email_receipts.sql`

- [ ] **Step 1: Write the migration** (verify referenced tables live first; house provenance header):

```sql
-- 0170: delivery-intake P2 — email-receipt ledger + storage + inference baselines (spec D4/D6)

create table if not exists public.email_receipts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid null references public.locations(id),   -- null until linked/attributed
  source text not null check (source in ('inbound','upload')),
  from_address text null,
  subject text null,
  received_at timestamptz not null default now(),
  raw_storage_path text null,            -- bucket path of the raw .eml, when inbound
  attachment_paths jsonb not null default '[]'::jsonb,  -- bucket paths of stored attachments
  parse_state text not null default 'unparsed' check (parse_state in ('unparsed','parsed','failed')), -- parsing lands P4
  parsed_json jsonb null,
  linked_delivery_id uuid null references public.vendor_deliveries(id),
  vendor_guess_id uuid null references public.vendors(id), -- from_address matched against vendor_contacts
  created_by uuid null references public.users(id),        -- null for inbound (machine)
  created_at timestamptz not null default now()
);
create index if not exists email_receipts_unlinked_ix on public.email_receipts (location_id, received_at) where linked_delivery_id is null;
create index if not exists email_receipts_delivery_ix on public.email_receipts (linked_delivery_id);
alter table public.email_receipts enable row level security;
revoke all on public.email_receipts from anon, authenticated, public;

alter table public.vendor_deliveries
  add column if not exists email_receipt_id uuid null references public.email_receipts(id);

alter table public.locations
  add column if not exists receipt_email_address text null;  -- dormant until Resend DNS

create table if not exists public.sku_inferred_baselines (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  sku_id uuid not null references public.vendor_items(id),
  inferred_oz numeric not null,
  computed_at timestamptz not null default now(),
  basis jsonb not null,   -- { method, window_days, coverage_days, daily_avg_oz, lanes: {production_oz, direct_oz} }
  unique (location_id, sku_id)   -- computed ONCE per SKU/location; never regenerated (spec D6)
);
alter table public.sku_inferred_baselines enable row level security;
revoke all on public.sku_inferred_baselines from anon, authenticated, public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 15728640,
  array['application/pdf','message/rfc822','text/plain','text/html','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
-- deny-by-default: no storage policies for user roles; service-role only (0164 pattern — read 0164's policy section and mirror EXACTLY what it does/omits for the bucket).
```

- [ ] **Step 2:** Controller pre-flights live schema + applies via MCP. **Step 3:** Commit.

### Task 2: Inference math (TDD) + anchor-source threading

**Files:** Modify `lib/counts-shared.ts` (pure) · Test `tests/counts-shared.test.ts` (extend — read its existing structure first) · Modify `lib/counts.ts`

- [ ] **Step 1 (TDD):** In counts-shared: `computeInferredBaselineOz(dailyRows: Array<{ oz: number }>, windowDays = 28, coverageDays = 7): { inferredOz: number, dailyAvgOz: number } | null` — null when rows sum ≤ 0; else dailyAvg = totalOz/windowDays (calendar window, not active days), inferredOz = dailyAvg × coverageDays. Tests: zero rows → null; simple sum math; window normalization. Write failing tests first (controller runs them).
- [ ] **Step 2:** Extend `OnHandInput` with `anchorSource: "census" | "inferred" | null` and pass it through to `OnHandResult` untouched (display provenance only — the math is source-blind). Null = no anchor (existing advisory-null path). Grep all `OnHandInput` constructors and update.
- [ ] **Step 3:** In `lib/counts.ts` `loadOnHand`: for SKUs with NO census anchor, look up `sku_inferred_baselines` (one batch query); for SKUs also missing a baseline AND having consumption history, compute via the SAME two consumption lanes as `lib/receiving.ts` `loadSkuUsageRank` (28d window) and INSERT baselines (`on conflict do nothing` — lazy, once, race-safe), then use them: anchorOz = inferred_oz, anchorAt = computed_at, anchorSource = "inferred"; received/consumed-since accrue from computed_at exactly like a census anchor. Census anchors set anchorSource = "census". Variance stays census-only (existing `computeVariance` path untouched — verify it only ever receives census anchors and add a guard comment).
- [ ] **Step 4:** On-hand surface (`counts.onhand` panel): source chip per row — "Audited {date}" / "Inferred" (i18n en+es, AlertPill info tone for inferred).

### Task 3: lib/email-receipts.ts (ledger + lifecycle)

**Files:** Create `lib/email-receipts.ts` (mirror lib/credits.ts structure: service-role, app-layer gates, error class)

- [ ] Exports: `RECEIPT_MIN = 4` · `ingestInboundReceipt({ fromAddress, subject, rawEml, attachments })` (service-internal, no actor — webhook caller; stores raw+attachments to the receipts bucket via a small storage helper modeled on lib/photos.ts, guesses vendor from `vendor_contacts.email` + `vendor_ordering_details` email values, attributes location when the to-address matches a `locations.receipt_email_address`, inserts the row, then `attemptAutoLink`) · `uploadManualReceipt(actor, { locationId, deliveryId?, file })` (KH+; stores, inserts source='upload', links immediately when deliveryId given) · `attemptAutoLink(receiptId)` (vendor_guess + ±2d date window over unlinked counted deliveries at that vendor/location; link ONLY on exactly one candidate: set linked_delivery_id + vendor_deliveries.email_receipt_id both ways, error-checked) · `listUnlinkedReceipts(actor, locationId)` · `linkReceipt(actor, receiptId, deliveryId)` (KH+, both-ways set, 409 if either side already linked) · `attestMatch(actor, deliveryId, verdict: "matched"|"discrepant", note?)` (KH+; requires a linked receipt; updates match_state w/ rowcount check + audit `delivery.match_attested`) · `overrideMatch(actor, deliveryId, note)` (AGM+; match_state='override', note REQUIRED, audit). Every Supabase call error-checked; append-only respected.

### Task 4: Routes

**Files:** Create `app/api/webhooks/resend-inbound/route.ts` · Create `app/api/operations/receiving/email-receipts/route.ts`

- [ ] Webhook: svix-signature verification (Resend inbound signs webhooks svix-style: `svix-id`/`svix-timestamp`/`svix-signature`, HMAC-SHA256 base64 over `id.timestamp.payload` with the `whsec_` secret — implement verify with node crypto, NO new deps, timing-safe compare; freshness 300s mirroring EZCater). Env `RESEND_INBOUND_SECRET`; unset → 503 dormant-safe (cron-route pattern). Payload → `ingestInboundReceipt`. Always-explicit statuses; on ledger failure 500 (EZCater convention).
- [ ] Operations route: GET `?locationId=` unlinked list (KH+) · POST multipart upload → `uploadManualReceipt` (read how PhotoCapture's `/api/photos` route handles multipart and mirror) · PATCH `{ deliveryId, action: "link"|"attest"|"override", ... }` → corresponding lib fns. Mirror existing route auth/error idiom exactly.

### Task 5: Compare panel + link/attest UI + badges

**Files:** Modify `app/(authed)/operations/receiving/[id]/page.tsx` · Create `components/receiving/VendorClaimPanel.tsx` (client island) · Modify receiving list page

- [ ] Detail page, new section between continue-intake and Items: linked receipt → side-by-side (stacked on phone): left = counted lines summary (SKU, qty×level); right = the claim (signed URL: pdf in `<object>`, images in `<img>`, eml/text rendered as text) + attestation bar: "Matches" / "Discrepancy (note)" / (AGM+) "Override (note required)" → PATCH → refresh. No linked receipt → "Attach emailed receipt" (upload) + "Link existing" (unlinked list picker, vendor/date-sorted). Disclosure doctrine: the panel is a top-level section (identity content, not collapsed); its unlinked-picker collapses.
- [ ] Receiving list: derived "missing email" AlertPill (warn) when `delivery_status='complete'` AND `match_state='counted_only'` AND `email_receipt_id` null AND `created_at` > 48h — extend `loadRecentDeliveries` select minimally (email_receipt_id, created_at) if absent.
- [ ] i18n: everything, en+es (tú-form).

### Task 6: Inventory Audit reframe

- [ ] `counts.page.title` → "Inventory Audit" / "Auditoría de inventario"; subtitle → on-demand tool language ("Run when the owner calls for a full audit — day to day, the system infers on-hand from deliveries, production, and sales."); `counts.form.title` → "New audit" / "Nueva auditoría"; `counts.form.submit` → "Record audit". Update BOTH locales; grep for any other user-facing "physical count" strings. Gates/routes/paths unchanged.

### Task 7: Verification + PR

- [ ] `tsc` clean · `npm test` (incl. new inference tests) · `next build` · i18n parity script · cross-family verifier card on the diff (READ-ONLY, comment-persisted) · PR "Delivery intake P2 — vendor claim + inference bootstrap" with the dormant-until-DNS note (inbound address + `locations.receipt_email_address` await Resend domain verification; manual upload live now) · Juan merges.

---
## Self-review (write time)
Spec coverage: D4 v1+v2 (ingest/store/link/compare; parse explicitly deferred P4 ✓), D6 inferred tier + provenance + audit reframe ✓, missing-email 48h ✓, never-blocks-door ✓ (all new UI on detail/list, zero door-form changes). Placeholders: storage-policy mirroring and multipart handling point at named live files per read-first discipline; all new shapes are concrete. Type consistency: anchorSource threads Input→Result; baseline table fields match the lazy-insert. Scope: single-plan-sized; P4 parse and P3 par-estimates cleanly excluded.
