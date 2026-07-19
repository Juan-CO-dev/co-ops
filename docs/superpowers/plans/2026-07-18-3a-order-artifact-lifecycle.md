# 3a — Order-Artifact Lifecycle + Real-Data Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the customer new-order flow into ONE real server artifact — born at intake, carried through build → review → deposit → account — wired to the real catering menu + server-side pricing, structurally eliminating the 24→20 headcount bug.

**Architecture:** The artifact = the existing `catering_pipeline` lead (mutable intake/CRM details) + its `catering_quotes` row (versioned priced doc), linked by `pipeline_id`. Born at intake as a `draft` **on magic-link consume** (create-only-post-verify; the intake rides the single-use token), mutable-in-place while `draft`, immutable+versioned after `submitted`. Three order pages are rewritten from sessionStorage mockups to server-backed reads of the draft. All pricing flows through W1a's derivation + `computeChargeStack` (D20 — client sends refs + qty, never prices).

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`, route `params` is a Promise, `useSearchParams`→Suspense), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS, project `bgcvurheqzylyfehqgzh`), integer-cents money, bps rates. Tests = `tsx` seeded smoke. Branch: `claude/3a-order-artifact-lifecycle`.

**Model tiering (per Juan's W1a pattern):** Fable 5 on the money/security cores + smoke (T4/T5/T6 draft lib, T12 smoke); Opus 4.8 on migration/wiring/routes (T1/T2/T3/T7/T8); Sonnet 4.6 on the UI rewrites (T9/T10/T11). CC (main loop) is SOLE reviewer of every diff + owns the prod migration + all git.

---

## Confirm-before-authoring — VERIFIED against live DB (2026-07-18)

Already grounded (do not re-verify unless a task says to):
- `catering_pipeline` cols: `id, customer_id, contact_name, company, event_date, headcount, stage, lead_source, location_id, notes, follow_up_date, created_by, created_at, updated_at, estimated_revenue_cents`. **None of the 7 new intake fields exist yet.**
- `catering_pipeline_stage_check` = `stage IN ('inquiry','quote_sent','confirmed','completed','lost')` — **`'out'` absent, add it.**
- `catering_quotes`: versioning present (`root_id`, `version`, `superseded_at`); `status_check` includes both `'draft'` and `'submitted'`; `origin_check` = `('self_serve','staff')`; all charge-stack + bps cols present. **No schema change needed for the draft lifecycle.**
- `catering_quote_items`: `portion` present (W1a). `catering_quote_items_one_ref` = `item_id IS NULL OR menu_item_id IS NULL` (mutually exclusive). `catering_quote_items_identified` = `description OR item_id OR menu_item_id NOT NULL`. Napkins add-on rides as an `items` row (`item_id`) → satisfies both.
- Next migration number: **0129** (tip = 0128).
- Dormancy: 0 catering-available items/menu_items, 0 active rate rules, 0 pipeline rows, 1 customer, 1 quote, 2 locations. The flow is correctly DORMANT until data (same as W1a) — the smoke seeds its own rows and rolls back.

Substrate confirmed by reading: `lib/catering/pipeline.ts` (createLead/moveStage/editLead, PIPELINE_STAGES), `lib/catering/quotes.ts` (computeChargeStack/ChargeRates/ChargeStack/lineTotalCents/snapshotColumns shape), `lib/portal/menu.ts` (loadPublicCateringMenu/loadPublicPricingContext — un-gated, UUID-guarded), `lib/portal/orders.ts` (submitOrder — the one-shot the draft flow supersedes), `lib/portal/session.ts` (requireCustomerSession → `{customerId,email,sessionId}`), `lib/portal/magic-link.ts` (requestMagicLink stores token EMAIL-keyed with optional `name`; consumeMagicLink flips single-use + resolves customer + returns `{ok, session}`), `lib/portal/quotes.ts` (loadCustomerQuoteDetail/initiatePayment — the pay surface), `lib/catering/payments.ts` (createPaymentDue), `app/order/{start,build,review,verify}/page.tsx` (the mockups + verify already routes to `data.next`).

## Two design decisions locked at plan time (spec §12 deferred these)

1. **Create-post-verify = intake rides the token.** `/order/start` POSTs the intake to `/api/portal/magic-link/request` which stores it as a new `catering_portal_tokens.intake` jsonb. `consumeMagicLink` (post-verify) calls `createDraftFromIntake(customerId, intake)` when the token carried one, and the verify route returns `next: "/order/build?draft=<quoteId>"`. This is Juan's locked "email verified right after intake → created after submit," and it is cross-device robust (no sessionStorage carrier). A pure sign-in token (no intake) just signs in → `next: "/order/account"`.
2. **Real locations reach intake.** `catering_quotes.location_id` is NOT NULL, so `createDraftFromIntake` needs a real location UUID. `/order/start` becomes a thin **server component wrapper** that loads the 2 real active locations and passes them to a client form, replacing the hardcoded location names.

Out of 3a scope (deferred, unchanged): 3a-print (printable summaries), W4 (reserve/deplete off `confirmed`/`out`), abandoned-draft sweep, full Security Hardening pass, portal-wide i18n (the portal flow is English-only today; new strings match that — a portal i18n pass is its own effort).

---

## File Structure

**Migration (CC applies via Supabase MCP, then commits the repo file):**
- Create: `supabase/migrations/0129_order_artifact_intake.sql` — `catering_pipeline` +7 intake cols; stage CHECK +`'out'`; `catering_portal_tokens` +`intake` jsonb.

**Lib (each file one responsibility):**
- Modify: `lib/catering/pipeline.ts` — `'out'` stage + 7 intake fields threaded through the lead type/cols/map/create/edit.
- Create: `lib/portal/locations.ts` — `loadPublicLocations()` (un-gated id+name).
- Create: `lib/portal/draft.ts` — the portal draft lifecycle (create/load/setLines/preview/submit + napkins). The core of 3a.
- Modify: `lib/portal/magic-link.ts` — thread optional `intake` onto the token; create draft on consume; return `quoteId`.

**Routes (customer-session gated, origin-checked):**
- Modify: `app/api/portal/magic-link/request/route.ts` — accept + forward `intake`.
- Modify: `app/api/portal/magic-link/verify/route.ts` — return the draft-aware `next`.
- Create: `app/api/portal/order/draft/lines/route.ts` — POST `setDraftLines`.
- Create: `app/api/portal/order/draft/preview/route.ts` — POST `previewDraft`.
- Create: `app/api/portal/order/draft/submit/route.ts` — POST `submitDraft`.

**Pages (real-data rewrites):**
- Modify: `app/order/start/page.tsx` — server wrapper + client intake form (7 new fields, real locations).
- Modify: `app/order/build/page.tsx` — real menu + draft; cart → `setDraftLines`; headcount from the draft.
- Modify: `app/order/review/page.tsx` — server charge stack (`previewDraft`) + napkins toggle + tip → `submitDraft`.

**Scripts:**
- Create: `scripts/seed-napkins-item.ts` — idempotent seed of the "Napkins & Utensils" catering `items` row (+ rate rule for pricing in dev/smoke).
- Create: `scripts/3a-smoke.ts` — seeded, self-cleaning lifecycle smoke.

---

## Task 1: Migration 0129 — intake columns + `'out'` stage + token intake

**Files:**
- Create: `supabase/migrations/0129_order_artifact_intake.sql`
- Apply: via Supabase MCP `apply_migration` (CC only; name `0129_order_artifact_intake`)

**Context for the implementer:** This is a schema-only migration. CC (main loop) applies it to prod via the Supabase MCP and commits the repo file — the implementer subagent WRITES the SQL file only and does NOT apply it. The pipeline stage CHECK must be dropped + recreated to add `'out'` (Postgres can't extend a CHECK in place). Mirror the migration-file header convention (AGENTS.md "Migration text repo capture").

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 0129_order_artifact_intake
-- Applied via Supabase MCP apply_migration on 2026-07-18.
-- Canonical reference: docs/superpowers/specs/2026-07-18-3a-order-artifact-lifecycle-design.md
--                      + lib/portal/draft.ts
--
-- 3a: the order artifact is the pipeline lead (mutable intake details) + its versioned quote.
-- (1) richer intake detail fields on the lead; (2) an 'out' fulfillment stage (confirmed=reserve,
-- out=deplete — the reserve/deplete LOGIC is W4, this only makes the stage valid); (3) an optional
-- intake payload on the magic-link token so the draft can be created post-verify (create-only-post-verify).

-- 1. catering_pipeline: the 7 new intake detail fields (all nullable text; event_date/headcount/
--    company/contact_name already exist).
ALTER TABLE public.catering_pipeline
  ADD COLUMN contact_phone   text,
  ADD COLUMN delivery_address text,
  ADD COLUMN time_window     text,
  ADD COLUMN event_type      text,
  ADD COLUMN dietary_notes   text,
  ADD COLUMN event_name      text,
  ADD COLUMN dropoff_door    text;

-- 2. Add 'out' to the pipeline stage CHECK (drop + recreate — a CHECK can't be extended in place).
ALTER TABLE public.catering_pipeline DROP CONSTRAINT catering_pipeline_stage_check;
ALTER TABLE public.catering_pipeline
  ADD CONSTRAINT catering_pipeline_stage_check
  CHECK (stage IN ('inquiry','quote_sent','confirmed','out','completed','lost'));

-- 3. catering_portal_tokens.intake — the optional intake payload a new-order magic-link carries,
--    so consumeMagicLink can create the draft AFTER email verification (never before → no spam rows).
--    NULL for pure sign-in links.
ALTER TABLE public.catering_portal_tokens
  ADD COLUMN intake jsonb;
```

- [ ] **Step 2: (CC) apply via Supabase MCP + verify**

CC applies `apply_migration(name="0129_order_artifact_intake", query=<the SQL>)`, then verifies:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='catering_pipeline_stage_check';
-- Expect: CHECK ((stage = ANY (ARRAY['inquiry','quote_sent','confirmed','out','completed','lost'])))
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='catering_pipeline'
  AND column_name IN ('contact_phone','delivery_address','time_window','event_type','dietary_notes','event_name','dropoff_door');
-- Expect: 7 rows
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='catering_portal_tokens' AND column_name='intake';
-- Expect: 1 row
```
Expected: constraint shows 6 stages incl. `out`; 7 pipeline cols; `intake` present.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0129_order_artifact_intake.sql
git commit -m "feat(3a): migration 0129 — pipeline intake fields + 'out' stage + token intake"
```

---

## Task 2: `lib/catering/pipeline.ts` — `'out'` stage + intake fields on the lead

**Files:**
- Modify: `lib/catering/pipeline.ts`

**Context:** The mutable lead is the intake-detail home (spec §4). Thread the 7 new fields through the view type, DB row type, column list, mapper, and both write paths (`createLead`, `editLead`). Add `'out'` to the stage vocabulary so `moveStage` accepts it (the reserve/deplete logic is W4 — here we only widen the vocabulary). This is the "grep for type consumers" discipline: `PipelineLead` and `CreateLeadInput` are the shared contracts.

- [ ] **Step 1: Add `'out'` to the stage vocabulary**

Edit line 24:
```ts
export const PIPELINE_STAGES = ["inquiry", "quote_sent", "confirmed", "out", "completed", "lost"] as const;
```
(`isPipelineStage`, `mapLead` fallback, and `TERMINAL_STAGES` need no change — `out` is non-terminal, correctly staying in the follow-up queue until `completed`/`lost`.)

- [ ] **Step 2: Extend `PipelineLead`, `DbLeadRow`, `LEAD_COLS`, `mapLead`**

Add to `PipelineLead` (after `headcount`):
```ts
  contactPhone: string | null;
  deliveryAddress: string | null;
  timeWindow: string | null;
  eventType: string | null;
  dietaryNotes: string | null;
  eventName: string | null;
  dropoffDoor: string | null;
```
Add to `DbLeadRow` (after `headcount`):
```ts
  contact_phone: string | null;
  delivery_address: string | null;
  time_window: string | null;
  event_type: string | null;
  dietary_notes: string | null;
  event_name: string | null;
  dropoff_door: string | null;
```
Extend `LEAD_COLS`:
```ts
const LEAD_COLS =
  "id, customer_id, contact_name, company, event_date, headcount, contact_phone, delivery_address, time_window, event_type, dietary_notes, event_name, dropoff_door, stage, lead_source, location_id, notes, follow_up_date, estimated_revenue_cents, created_by, created_at, updated_at";
```
Extend `mapLead` return (after `headcount: r.headcount,`):
```ts
    contactPhone: r.contact_phone,
    deliveryAddress: r.delivery_address,
    timeWindow: r.time_window,
    eventType: r.event_type,
    dietaryNotes: r.dietary_notes,
    eventName: r.event_name,
    dropoffDoor: r.dropoff_door,
```

- [ ] **Step 3: Thread intake fields through `CreateLeadInput` + `createLead`**

Add to `CreateLeadInput`:
```ts
  contactPhone?: string | null;
  deliveryAddress?: string | null;
  timeWindow?: string | null;
  eventType?: string | null;
  dietaryNotes?: string | null;
  eventName?: string | null;
  dropoffDoor?: string | null;
```
In `createLead`'s `.insert({...})`, add (after `headcount: input.headcount ?? null,`):
```ts
      contact_phone: input.contactPhone ?? null,
      delivery_address: input.deliveryAddress ?? null,
      time_window: input.timeWindow ?? null,
      event_type: input.eventType ?? null,
      dietary_notes: input.dietaryNotes ?? null,
      event_name: input.eventName ?? null,
      dropoff_door: input.dropoffDoor ?? null,
```

- [ ] **Step 4: Thread intake fields through `EditLeadInput` + `editLead`**

Add the same seven optional fields to `EditLeadInput`, and in `editLead`'s patch block add (following the existing `if (input.x !== undefined) patch.x = input.x;` pattern):
```ts
  if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone;
  if (input.deliveryAddress !== undefined) patch.delivery_address = input.deliveryAddress;
  if (input.timeWindow !== undefined) patch.time_window = input.timeWindow;
  if (input.eventType !== undefined) patch.event_type = input.eventType;
  if (input.dietaryNotes !== undefined) patch.dietary_notes = input.dietaryNotes;
  if (input.eventName !== undefined) patch.event_name = input.eventName;
  if (input.dropoffDoor !== undefined) patch.dropoff_door = input.dropoffDoor;
```

- [ ] **Step 5: Typecheck + commit**
```bash
npm run typecheck
```
Expected: PASS (no consumers of the new optional fields break; existing `createLead` callers omit them).
```bash
git add lib/catering/pipeline.ts
git commit -m "feat(3a): pipeline lead carries intake detail fields + 'out' stage"
```

---

## Task 3: `lib/portal/locations.ts` — public location loader

**Files:**
- Create: `lib/portal/locations.ts`

**Context:** `/order/start` needs the real active locations (id + display name) so intake can capture a real `location_id`. Un-gated public read (mirrors `lib/portal/menu.ts` — the portal has no staff AuthContext). Verify the `locations` display-name column at authoring time.

- [ ] **Step 1: Confirm the locations name column**

Run (CC or implementer via Supabase MCP `execute_sql`):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='locations' ORDER BY ordinal_position;
```
Use the actual display column (e.g. `name`) + `code` in the loader below; adjust the select if the column names differ.

- [ ] **Step 2: Write the loader**

```ts
/**
 * Public (customer-facing) locations loader — Portal-3 / 3a.
 *
 * SERVER-ONLY, un-gated (the portal has no staff AuthContext). Service-role read of the active
 * locations so the intake form can capture a REAL location_id (catering_quotes.location_id is
 * NOT NULL). Mirrors lib/portal/menu.ts: a thin public read, id is the only thing the client
 * echoes back, and every downstream use validates it as a UUID.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

export interface PublicLocation {
  id: string;
  name: string;
  code: string | null;
}

export async function loadPublicLocations(): Promise<PublicLocation[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id, name, code")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; code: string | null }>>();
  if (error) throw new Error(`loadPublicLocations: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, code: r.code }));
}
```
(If `locations` has no `active` column, drop that `.eq`. Confirm in Step 1.)

- [ ] **Step 3: Typecheck + commit**
```bash
npm run typecheck
git add lib/portal/locations.ts
git commit -m "feat(3a): public locations loader for intake"
```

---

## Task 4: `lib/portal/draft.ts` — create + load (core, part A)

**Files:**
- Create: `lib/portal/draft.ts`

**Context:** This is the artifact core. Customer-principal, service-role, ownership-checked (`customer_id`), status-guarded, D20 server price authority. Part A = the types, `createDraftFromIntake`, and `loadDraft`. Reuse `computeChargeStack`/`lineTotalCents`/`ChargeRates`/`ChargeStack` from `lib/catering/quotes.ts` and `loadPublicCateringMenu`/`loadPublicPricingContext` from `lib/portal/menu.ts`. The portal deliberately re-declares small helpers rather than widening staff files (see `lib/portal/orders.ts`).

- [ ] **Step 1: Header + types + errors + intake shape**

```ts
/**
 * Portal draft lifecycle — 3a (the order artifact's server-backed working state).
 *
 * SERVER-ONLY. Service-role writes; the authorization boundary is the customer principal
 * (customer_id ownership), re-checked on EVERY op — a non-owned / non-draft / missing quote
 * yields a 404/409, never leaking another customer's order.
 *
 * The artifact = the pipeline LEAD (mutable intake details) + its current QUOTE (versioned priced
 * doc), linked by pipeline_id. Born at intake as status='draft', origin='self_serve'. While
 * 'draft', line edits happen IN PLACE (replace catering_quote_items + recompute the charge stack
 * on the same row — no version churn per keystroke). On submitDraft the draft flips to 'submitted'
 * and becomes immutable; any later edit goes through the append-only reviseQuote (W-later).
 *
 * STRICT SERVER PRICE AUTHORITY (D20): the client submits item/menu_item/package REFERENCES +
 * quantities + portion ONLY. Every unit price is resolved from loadPublicCateringMenu (W1a
 * derivation). A client-supplied price is never read. With 0 catering rows the flow is correctly
 * DORMANT (no cart resolves) — proven via scripts/3a-smoke.ts.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { computeChargeStack, lineTotalCents } from "@/lib/catering/quotes";
import type { ChargeRates, ChargeStack } from "@/lib/catering/quotes";
import { loadPublicCateringMenu, loadPublicPricingContext } from "./menu";
import type { CateringMenuItem } from "@/lib/catering/menu";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The dedicated menu section the napkins/utensils add-on lives in (excluded from the shopping list). */
export const ADDON_SECTION = "Add-ons";

export class PortalDraftError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PortalDraftError";
  }
}

/** The intake payload captured at /order/start and carried on the magic-link token. */
export interface DraftIntake {
  locationId: string;
  contactName: string;
  email?: string | null;
  company?: string | null;
  eventDate?: string | null;
  headcount?: number | null;
  isDelivery: boolean;
  deliveryAddress?: string | null;
  contactPhone?: string | null;
  timeWindow?: string | null;
  eventType?: string | null;
  dietaryNotes?: string | null;
  eventName?: string | null;
  dropoffDoor?: string | null;
}

export type Portion = "quarter" | "half" | "whole";
/** A cart line reference (no price — D20). Exactly one of itemId / menuItemId / packageId. */
export interface DraftLineInput {
  itemId?: string | null;
  menuItemId?: string | null;
  packageId?: string | null;
  portion?: Portion | null;
  quantity: number;
}

export interface DraftItem {
  id: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  portion: Portion | null;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  displayOrder: number;
}

/** The lead's intake detail fields the review recap shows. */
export interface DraftLead {
  contactName: string;
  company: string | null;
  eventDate: string | null;
  headcount: number | null;
  contactPhone: string | null;
  deliveryAddress: string | null;
  timeWindow: string | null;
  eventType: string | null;
  dietaryNotes: string | null;
  eventName: string | null;
  dropoffDoor: string | null;
}

export interface DraftView {
  quoteId: string;
  pipelineId: string | null;
  locationId: string;
  status: string;
  isDelivery: boolean;
  deliveryZoneId: string | null;
  stack: ChargeStack;
  items: DraftItem[];
}

/** loadDraft's full payload: the build page's data (draft + real menu + lead intake + napkins add-on). */
export interface DraftLoad extends DraftView {
  lead: DraftLead | null;
  menu: CateringMenuItem[];
  addonNapkins: CateringMenuItem | null;
}
```

- [ ] **Step 2: Shared internals — ownership load + rates-with-tip + snapshot columns**

```ts
/** Self-serve overrides the rule's gratuity with the customer's chosen tip. */
function ratesWithTip(base: ChargeRates, tipBps: number | null | undefined): ChargeRates {
  return { ...base, gratuityBps: tipBps ?? 0 };
}

/** EXACT snapshot column shape (rates + stack + delivery) — mirrors lib/catering/quotes.ts. */
function snapshotColumns(rates: ChargeRates, stack: ChargeStack, isDelivery: boolean, deliveryZoneId: string | null) {
  return {
    is_delivery: isDelivery,
    delivery_zone_id: deliveryZoneId,
    subtotal_cents: stack.subtotalCents,
    delivery_fee_cents: stack.deliveryFeeCents,
    service_charge_cents: stack.serviceChargeCents,
    gratuity_cents: stack.gratuityCents,
    tax_cents: stack.taxCents,
    total_cents: stack.totalCents,
    deposit_cents: stack.depositCents,
    tax_rate_bps: rates.taxRateBps,
    gratuity_bps: rates.gratuityBps,
    service_charge_bps: rates.serviceChargeBps,
    deposit_pct_bps: rates.depositPctBps,
    tax_on_delivery: rates.taxOnDelivery,
    tax_on_gratuity: rates.taxOnGratuity,
  };
}

/** Load an OWNED, still-DRAFT quote header (id/location/is_delivery/delivery_zone/pipeline). Throws
 * 404 if missing or not owned, 409 if not 'draft'. The authorization boundary is customer_id. */
async function loadOwnedDraftHeader(
  sb: ReturnType<typeof getServiceRoleClient>,
  customerId: string,
  quoteId: string,
): Promise<{ id: string; location_id: string; is_delivery: boolean; delivery_zone_id: string | null; pipeline_id: string | null }> {
  if (!UUID_RE.test(quoteId)) throw new PortalDraftError(404, "not_found", "Draft not found");
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select("id, customer_id, location_id, status, superseded_at, is_delivery, delivery_zone_id, pipeline_id")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; customer_id: string | null; location_id: string; status: string; superseded_at: string | null; is_delivery: boolean; delivery_zone_id: string | null; pipeline_id: string | null }>();
  if (error) throw new Error(`loadOwnedDraftHeader: ${error.message}`);
  if (!row || row.customer_id !== customerId) throw new PortalDraftError(404, "not_found", "Draft not found");
  if (row.superseded_at != null || row.status !== "draft") throw new PortalDraftError(409, "not_draft", "This order can no longer be edited");
  return { id: row.id, location_id: row.location_id, is_delivery: row.is_delivery, delivery_zone_id: row.delivery_zone_id, pipeline_id: row.pipeline_id };
}
```

- [ ] **Step 3: `createDraftFromIntake`**

```ts
/**
 * Create the order artifact from a verified customer's intake: a pipeline lead (stage 'inquiry',
 * lead_source 'portal', + intake detail fields) + a draft quote (status 'draft', origin
 * 'self_serve', 0 lines, all charges 0). Called from consumeMagicLink AFTER email verification —
 * never before (no unverified/competitor rows). Returns the draft handle the flow carries.
 */
export async function createDraftFromIntake(customerId: string, intake: DraftIntake): Promise<{ quoteId: string; pipelineId: string }> {
  if (!UUID_RE.test(intake.locationId)) throw new PortalDraftError(400, "invalid_location", "A valid location is required");
  if (!intake.contactName || intake.contactName.trim().length === 0) throw new PortalDraftError(400, "invalid_payload", "contactName is required");
  if (intake.headcount != null && (!Number.isFinite(Number(intake.headcount)) || Number(intake.headcount) < 0)) {
    throw new PortalDraftError(400, "invalid_headcount", "headcount must be zero or greater");
  }
  const sb = getServiceRoleClient();

  const { data: lead, error: leadErr } = await sb
    .from("catering_pipeline")
    .insert({
      contact_name: intake.contactName.trim(),
      company: intake.company ?? null,
      event_date: intake.eventDate ?? null,
      headcount: intake.headcount ?? null,
      contact_phone: intake.contactPhone ?? null,
      delivery_address: intake.deliveryAddress ?? null,
      time_window: intake.timeWindow ?? null,
      event_type: intake.eventType ?? null,
      dietary_notes: intake.dietaryNotes ?? null,
      event_name: intake.eventName ?? null,
      dropoff_door: intake.dropoffDoor ?? null,
      stage: "inquiry",
      lead_source: "portal",
      location_id: intake.locationId,
      customer_id: customerId,
      created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (leadErr) throw new Error(`createDraftFromIntake lead: ${leadErr.message}`);

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: lead.id, from_stage: null, to_stage: "inquiry", note: null, actor_id: null,
  });
  if (evErr) throw new Error(`createDraftFromIntake lead event: ${evErr.message}`);

  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .insert({
      root_id: null, version: 1, pipeline_id: lead.id, customer_id: customerId,
      location_id: intake.locationId, status: "draft", origin: "self_serve",
      event_date: intake.eventDate ?? null, headcount: intake.headcount ?? null,
      is_delivery: intake.isDelivery, created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (qErr) throw new Error(`createDraftFromIntake quote: ${qErr.message}`);

  void audit({
    actorId: null, actorRole: null, action: "catering.draft.create",
    resourceTable: "catering_quotes", resourceId: quote.id,
    metadata: { pipeline_id: lead.id, customer_id: customerId, location_id: intake.locationId }, ipAddress: null, userAgent: null,
  });
  return { quoteId: quote.id, pipelineId: lead.id };
}
```

- [ ] **Step 4: `loadDraft` (build page data)**

```ts
/** The build page's data: the owned draft (header + lines + stack) + the real menu + the lead's
 * intake fields + the napkins add-on. Null if not owned / not found (never leak). */
export async function loadDraft(customerId: string, quoteId: string): Promise<DraftLoad | null> {
  if (!UUID_RE.test(quoteId)) return null;
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select("id, customer_id, pipeline_id, location_id, status, is_delivery, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; customer_id: string | null; pipeline_id: string | null; location_id: string; status: string; is_delivery: boolean; delivery_zone_id: string | null; subtotal_cents: number; delivery_fee_cents: number; service_charge_cents: number; gratuity_cents: number; tax_cents: number; total_cents: number; deposit_cents: number }>();
  if (error) throw new Error(`loadDraft quote: ${error.message}`);
  if (!row || row.customer_id !== customerId) return null;

  const [{ data: itemRows, error: iErr }, menuAll, lead] = await Promise.all([
    sb.from("catering_quote_items")
      .select("id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, portion")
      .eq("quote_id", quoteId).order("display_order", { ascending: true })
      .returns<Array<{ id: string; item_id: string | null; menu_item_id: string | null; package_id: string | null; description: string | null; quantity: number; unit_price_cents: number; line_total_cents: number; display_order: number; portion: string | null }>>(),
    loadPublicCateringMenu(row.location_id),
    loadDraftLead(sb, row.pipeline_id),
  ]);
  if (iErr) throw new Error(`loadDraft items: ${iErr.message}`);

  const addonNapkins = menuAll.find((m) => m.section === ADDON_SECTION) ?? null;
  const menu = menuAll.filter((m) => m.section !== ADDON_SECTION);
  const items: DraftItem[] = (itemRows ?? []).map((r) => ({
    id: r.id, itemId: r.item_id, menuItemId: r.menu_item_id, packageId: r.package_id,
    portion: r.portion === "quarter" || r.portion === "half" || r.portion === "whole" ? r.portion : null,
    description: r.description, quantity: Number(r.quantity), unitPriceCents: r.unit_price_cents,
    lineTotalCents: r.line_total_cents, displayOrder: r.display_order,
  }));

  return {
    quoteId: row.id, pipelineId: row.pipeline_id, locationId: row.location_id, status: row.status,
    isDelivery: row.is_delivery, deliveryZoneId: row.delivery_zone_id,
    stack: {
      subtotalCents: row.subtotal_cents, deliveryFeeCents: row.delivery_fee_cents,
      serviceChargeCents: row.service_charge_cents, gratuityCents: row.gratuity_cents,
      taxCents: row.tax_cents, totalCents: row.total_cents, depositCents: row.deposit_cents,
    },
    items, lead, menu, addonNapkins,
  };
}

async function loadDraftLead(sb: ReturnType<typeof getServiceRoleClient>, pipelineId: string | null): Promise<DraftLead | null> {
  if (!pipelineId) return null;
  const { data, error } = await sb
    .from("catering_pipeline")
    .select("contact_name, company, event_date, headcount, contact_phone, delivery_address, time_window, event_type, dietary_notes, event_name, dropoff_door")
    .eq("id", pipelineId)
    .maybeSingle<{ contact_name: string; company: string | null; event_date: string | null; headcount: number | null; contact_phone: string | null; delivery_address: string | null; time_window: string | null; event_type: string | null; dietary_notes: string | null; event_name: string | null; dropoff_door: string | null }>();
  if (error) throw new Error(`loadDraftLead: ${error.message}`);
  if (!data) return null;
  return {
    contactName: data.contact_name, company: data.company, eventDate: data.event_date, headcount: data.headcount,
    contactPhone: data.contact_phone, deliveryAddress: data.delivery_address, timeWindow: data.time_window,
    eventType: data.event_type, dietaryNotes: data.dietary_notes, eventName: data.event_name, dropoffDoor: data.dropoff_door,
  };
}
```

- [ ] **Step 5: Typecheck (expected to still fail on missing setDraftLines/etc. references? No — none reference them yet). Commit.**
```bash
npm run typecheck
```
Expected: PASS (part A is self-contained; the internal helpers used later are declared in Step 2).
```bash
git add lib/portal/draft.ts
git commit -m "feat(3a): draft lib part A — types, createDraftFromIntake, loadDraft"
```

---

## Task 5: `lib/portal/draft.ts` — line resolution + setDraftLines + previewDraft (part B)

**Files:**
- Modify: `lib/portal/draft.ts`

**Context:** The D20 pricing core. `resolveLines` maps client refs → server-owned prices via `loadPublicCateringMenu` (keyed `${kind}:${id}` — items and menu_items are separate id spaces, same pattern as `lib/portal/orders.ts`). `setDraftLines` persists (replace items + snapshot stack in place). `previewDraft` is compute-only for the review page's tip/delivery live display.

- [ ] **Step 1: `resolveLines` (shared by setDraftLines + previewDraft)**

Add to `lib/portal/draft.ts`:
```ts
interface ResolvedLine {
  itemId: string | null; menuItemId: string | null; packageId: string | null;
  portion: Portion | null; description: string; quantity: number;
  unitPriceCents: number; lineTotalCents: number; displayOrder: number;
}

/** Resolve + price every line from the SERVER-owned menu (D20). Client price is never read. */
async function resolveLines(locationId: string, lines: DraftLineInput[]): Promise<ResolvedLine[]> {
  const menu = await loadPublicCateringMenu(locationId);
  const byKey = new Map(menu.map((m) => [`${m.kind}:${m.id}`, m] as const));
  return lines.map((l, i) => {
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: quantity must be > 0`);
    const itemId = l.itemId ?? null;
    const menuItemId = l.menuItemId ?? null;
    if (itemId != null && itemId !== "") {
      const it = byKey.get(`item:${itemId}`);
      if (!it) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown item`);
      return { itemId, menuItemId: null, packageId: null, portion: null, description: it.name, quantity, unitPriceCents: it.unitPriceCents, lineTotalCents: lineTotalCents(quantity, it.unitPriceCents), displayOrder: i };
    }
    if (menuItemId != null && menuItemId !== "") {
      const sub = byKey.get(`menu_item:${menuItemId}`);
      if (!sub) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown sub`);
      const portion: Portion = l.portion ?? "whole";
      if (!sub.portionable && portion !== "whole") throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: item is not portioned`);
      const unitPriceCents = sub.portionable && sub.portionPricesCents ? sub.portionPricesCents[portion] : sub.unitPriceCents;
      return { itemId: null, menuItemId, packageId: null, portion: sub.portionable ? portion : null, description: sub.name, quantity, unitPriceCents, lineTotalCents: lineTotalCents(quantity, unitPriceCents), displayOrder: i };
    }
    throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: needs an item or sub reference`);
  });
}

/** Resolve the delivery fee for a chosen zone (0 unless delivery + a valid zone for this location). */
async function resolveDeliveryFee(locationId: string, isDelivery: boolean, deliveryZoneId: string | null): Promise<number> {
  if (!isDelivery || deliveryZoneId == null) return 0;
  const pricing = await loadPublicPricingContext(locationId);
  const zone = pricing.zones.find((z) => z.id === deliveryZoneId);
  if (!zone) throw new PortalDraftError(400, "invalid_payload", "Delivery zone not found for this location");
  return zone.feeCents;
}
```

- [ ] **Step 2: `setDraftLines` (build cart persistence — in place)**

```ts
export interface SetLinesOpts { isDelivery?: boolean; deliveryZoneId?: string | null; tipBps?: number | null }

/** Replace the draft's lines + recompute + snapshot the charge stack IN PLACE (owned + 'draft'
 * only — no version churn). Returns the updated DraftView. */
export async function setDraftLines(customerId: string, quoteId: string, lines: DraftLineInput[], opts: SetLinesOpts = {}): Promise<DraftView> {
  const sb = getServiceRoleClient();
  const header = await loadOwnedDraftHeader(sb, customerId, quoteId);
  const isDelivery = opts.isDelivery ?? header.is_delivery;
  const deliveryZoneId = opts.deliveryZoneId !== undefined ? opts.deliveryZoneId : header.delivery_zone_id;

  const resolved = await resolveLines(header.location_id, lines);
  const pricing = await loadPublicPricingContext(header.location_id);
  const deliveryFee = await resolveDeliveryFee(header.location_id, isDelivery, deliveryZoneId);
  const rates = ratesWithTip(pricing.rates, opts.tipBps);
  const stack = computeChargeStack(resolved.map((l) => l.lineTotalCents), deliveryFee, rates);

  // Replace the line set (delete-then-insert; the quote stays the same row → no new version).
  const { error: delErr } = await sb.from("catering_quote_items").delete().eq("quote_id", quoteId);
  if (delErr) throw new Error(`setDraftLines delete: ${delErr.message}`);
  if (resolved.length > 0) {
    const { error: insErr } = await sb.from("catering_quote_items").insert(resolved.map((l) => ({
      quote_id: quoteId, item_id: l.itemId, menu_item_id: l.menuItemId, package_id: l.packageId,
      portion: l.portion, description: l.description, quantity: l.quantity,
      unit_price_cents: l.unitPriceCents, line_total_cents: l.lineTotalCents, display_order: l.displayOrder, created_by: null,
    })));
    if (insErr) throw new Error(`setDraftLines insert: ${insErr.message}`);
  }
  const { error: upErr } = await sb.from("catering_quotes")
    .update({ ...snapshotColumns(rates, stack, isDelivery, deliveryZoneId), estimated_revenue_cents: stack.totalCents })
    .eq("id", quoteId).eq("status", "draft");
  if (upErr) throw new Error(`setDraftLines update: ${upErr.message}`);

  return { quoteId, pipelineId: header.pipeline_id, locationId: header.location_id, status: "draft", isDelivery, deliveryZoneId, stack, items: resolved.map((l, idx) => ({ id: `resolved-${idx}`, itemId: l.itemId, menuItemId: l.menuItemId, packageId: l.packageId, portion: l.portion, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, displayOrder: l.displayOrder })) };
}
```
Note: `estimated_revenue_cents` on `catering_pipeline`? No — that column is on the lead, not the quote. Remove `estimated_revenue_cents` from the quote update (it's a pipeline column). Keep only `snapshotColumns(...)` in the `.update`.

**Correction (apply this):** the `.update` above must be just:
```ts
    .update(snapshotColumns(rates, stack, isDelivery, deliveryZoneId))
```
(`estimated_revenue_cents` lives on `catering_pipeline`; do not write it to `catering_quotes`.)

- [ ] **Step 3: `previewDraft` (compute-only for review)**

```ts
export interface PreviewOpts { isDelivery?: boolean; deliveryZoneId?: string | null; tipBps?: number | null; napkins?: boolean }

/** Compute-only charge stack for the review page (owned + 'draft'). Reads the draft's CURRENT
 * persisted lines, optionally + the napkins add-on, applies the chosen tip/delivery — persists
 * NOTHING. Keeps the review breakdown server-authoritative (no client illustrative rates). */
export async function previewDraft(customerId: string, quoteId: string, opts: PreviewOpts = {}): Promise<ChargeStack> {
  const sb = getServiceRoleClient();
  const header = await loadOwnedDraftHeader(sb, customerId, quoteId);
  const lineTotals = await currentLineTotals(sb, quoteId);
  if (opts.napkins) {
    const napkins = await loadNapkinsAddon(header.location_id);
    if (napkins) lineTotals.push(lineTotalCents(1, napkins.unitPriceCents));
  }
  const pricing = await loadPublicPricingContext(header.location_id);
  const isDelivery = opts.isDelivery ?? header.is_delivery;
  const deliveryZoneId = opts.deliveryZoneId !== undefined ? opts.deliveryZoneId : header.delivery_zone_id;
  const deliveryFee = await resolveDeliveryFee(header.location_id, isDelivery, deliveryZoneId);
  return computeChargeStack(lineTotals, deliveryFee, ratesWithTip(pricing.rates, opts.tipBps));
}

/** The draft's current persisted per-line totals (server-owned; never client-supplied). */
async function currentLineTotals(sb: ReturnType<typeof getServiceRoleClient>, quoteId: string): Promise<number[]> {
  const { data, error } = await sb.from("catering_quote_items").select("line_total_cents").eq("quote_id", quoteId).returns<Array<{ line_total_cents: number }>>();
  if (error) throw new Error(`currentLineTotals: ${error.message}`);
  return (data ?? []).map((r) => r.line_total_cents);
}

/** The napkins add-on menu item for a location (the first ADDON_SECTION row), or null. */
async function loadNapkinsAddon(locationId: string): Promise<CateringMenuItem | null> {
  const menu = await loadPublicCateringMenu(locationId);
  return menu.find((m) => m.section === ADDON_SECTION) ?? null;
}
```

- [ ] **Step 4: Typecheck + commit**
```bash
npm run typecheck
git add lib/portal/draft.ts
git commit -m "feat(3a): draft lib part B — resolveLines, setDraftLines, previewDraft"
```

---

## Task 6: `lib/portal/draft.ts` — submitDraft (part C)

**Files:**
- Modify: `lib/portal/draft.ts`

**Context:** The final transition: draft → submitted, add the napkins line if toggled, freeze the authoritative stack, create the deposit-due `catering_payments` row, best-effort confirmation email, audit. Reuses the `createPaymentDue` helper + the order-confirmation email template + `loadNapkinsAddon` (part B). Mirrors `submitOrder`'s tail (`lib/portal/orders.ts`) but on the draft.

- [ ] **Step 1: Imports (add to the top of the file)**
```ts
import { createPaymentDue } from "@/lib/catering/payments";
import { sendEmail } from "@/lib/email";
import { renderOrderConfirmationEmail } from "@/lib/email-templates/order-confirmation";
```

- [ ] **Step 2: `submitDraft`**

```ts
export interface SubmitOpts { isDelivery?: boolean; deliveryZoneId?: string | null; tipBps?: number | null; napkins?: boolean }
export interface SubmitResult { quoteId: string; depositCents: number; totalCents: number }

const DEFAULT_EXPIRY_DAYS = 14;
function defaultExpiry(): string { return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86400 * 1000).toISOString(); }
function allowlisted(email: string): boolean {
  const raw = process.env.PORTAL_MAGIC_LINK_ALLOWLIST ?? "juan@complimentsonlysubs.com";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
function centsToUsd(cents: number): string { return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }); }
function eventDateLabel(d: string | null): string {
  if (!d) return "your event";
  const t = Date.parse(`${d}T00:00:00`);
  return Number.isNaN(t) ? "your event" : new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Complete the order: draft → 'submitted' (immutable), add napkins if toggled, freeze the
 * authoritative charge stack, create the deposit-due payment intent, best-effort confirm email,
 * audit. Owned + 'draft' only. Requires at least one line. */
export async function submitDraft(customerId: string, quoteId: string, opts: SubmitOpts = {}): Promise<SubmitResult> {
  const sb = getServiceRoleClient();
  const header = await loadOwnedDraftHeader(sb, customerId, quoteId);

  // Append the napkins add-on line (server-priced) if toggled, BEFORE the final compute.
  if (opts.napkins) {
    const napkins = await loadNapkinsAddon(header.location_id);
    if (napkins) {
      const nextOrder = await currentLineTotals(sb, quoteId).then((t) => t.length);
      const { error: nErr } = await sb.from("catering_quote_items").insert({
        quote_id: quoteId, item_id: napkins.id, menu_item_id: null, package_id: null, portion: null,
        description: napkins.name, quantity: 1, unit_price_cents: napkins.unitPriceCents,
        line_total_cents: lineTotalCents(1, napkins.unitPriceCents), display_order: nextOrder, created_by: null,
      });
      if (nErr) throw new Error(`submitDraft napkins: ${nErr.message}`);
    }
  }

  const lineTotals = await currentLineTotals(sb, quoteId);
  if (lineTotals.length === 0) throw new PortalDraftError(400, "empty_cart", "Your order is empty");

  const pricing = await loadPublicPricingContext(header.location_id);
  const isDelivery = opts.isDelivery ?? header.is_delivery;
  const deliveryZoneId = opts.deliveryZoneId !== undefined ? opts.deliveryZoneId : header.delivery_zone_id;
  const deliveryFee = await resolveDeliveryFee(header.location_id, isDelivery, deliveryZoneId);
  const rates = ratesWithTip(pricing.rates, opts.tipBps);
  const stack = computeChargeStack(lineTotals, deliveryFee, rates);

  // Flip draft → submitted + snapshot the final stack. Guard on status='draft' (concurrent-submit safe).
  const { error: upErr, count } = await sb.from("catering_quotes")
    .update({ status: "submitted", ...snapshotColumns(rates, stack, isDelivery, deliveryZoneId), expires_at: defaultExpiry() }, { count: "exact" })
    .eq("id", quoteId).eq("status", "draft");
  if (upErr) throw new Error(`submitDraft flip: ${upErr.message}`);
  if (count === 0) throw new PortalDraftError(409, "not_draft", "This order was already submitted");

  // Deposit-due payment intent (self-serve is deposit-required).
  await createPaymentDue(sb, { quoteId, customerId, kind: "deposit", amountCents: stack.depositCents, createdBy: customerId });

  // Best-effort confirmation email (allowlist-gated; never throws).
  try {
    const { data: cust } = await sb.from("catering_customers").select("name, email").eq("id", customerId).maybeSingle<{ name: string | null; email: string | null }>();
    if (cust?.email && allowlisted(cust.email) && process.env.NEXT_PUBLIC_APP_URL) {
      const { data: leadRow } = await sb.from("catering_quotes").select("event_date").eq("id", quoteId).maybeSingle<{ event_date: string | null }>();
      const name = cust.name ?? cust.email;
      const dateLabel = eventDateLabel(leadRow?.event_date ?? null);
      await sendEmail({
        to: cust.email, subject: "We got your catering order — Compliments Only",
        html: renderOrderConfirmationEmail({ name, eventDateLabel: dateLabel, totalCents: stack.totalCents, depositCents: stack.depositCents }),
        text: `Hi ${name},\n\nWe received your catering order for ${dateLabel}. Estimated total: ${centsToUsd(stack.totalCents)}. A ${centsToUsd(stack.depositCents)} deposit reserves the date.\n\nWe'll confirm within about 24 hours. If we're not able to do your date, your deposit is refunded in full.`,
      });
    }
  } catch (err) {
    console.error("[portal draft] confirmation email failed:", err instanceof Error ? err.message : String(err));
  }

  void audit({
    actorId: null, actorRole: null, action: "catering.draft.submit",
    resourceTable: "catering_quotes", resourceId: quoteId,
    metadata: { customer_id: customerId, total_cents: stack.totalCents, deposit_cents: stack.depositCents, napkins: !!opts.napkins }, ipAddress: null, userAgent: null,
  });
  return { quoteId, depositCents: stack.depositCents, totalCents: stack.totalCents };
}
```

- [ ] **Step 3: Typecheck + lint the file + commit**
```bash
npm run typecheck
npx eslint lib/portal/draft.ts
```
Expected: PASS.
```bash
git add lib/portal/draft.ts
git commit -m "feat(3a): draft lib part C — submitDraft (napkins + deposit + email)"
```

---

## Task 7: Magic-link — intake on the token + draft-on-consume

**Files:**
- Modify: `lib/portal/magic-link.ts`
- Modify: `app/api/portal/magic-link/request/route.ts`
- Modify: `app/api/portal/magic-link/verify/route.ts`

**Context:** The create-post-verify hand-off. `requestMagicLink` accepts an optional `intake` and stores it on the token row (`intake` jsonb — migration 0129). `consumeMagicLink` reads it back and calls `createDraftFromIntake` post-verify, returning the new `quoteId`. The verify route turns that into `next: "/order/build?draft=<id>"`. Keep the constant-shape enumeration defense: `requestMagicLink` still resolves void on every branch; storing intake happens on the same insert.

- [ ] **Step 1: `requestMagicLink` — accept + persist intake**

In `lib/portal/magic-link.ts`, extend the signature + the token insert:
```ts
import type { DraftIntake } from "./draft";

export async function requestMagicLink(input: { email: string; name?: string | null; ip?: string | null; intake?: DraftIntake | null }): Promise<void> {
```
In the `.insert({...})` for `catering_portal_tokens`, add:
```ts
      intake: input.intake ?? null,
```
(No other change — throttle/audit/constant-shape all unchanged.)

- [ ] **Step 2: `consumeMagicLink` — create the draft post-verify + return quoteId**

Extend `ConsumeResult`:
```ts
export interface ConsumeResult { ok: boolean; session?: Awaited<ReturnType<typeof createCustomerSession>>; quoteId?: string }
```
In `consumeMagicLink`, the atomic-flip `.select("id, email, name")` becomes `.select("id, email, name, intake")`. After the session is created (before the audit), add:
```ts
  let quoteId: string | undefined;
  const intake = (tok as { intake?: unknown }).intake as DraftIntake | null | undefined;
  if (intake && typeof intake === "object" && typeof intake.locationId === "string") {
    try {
      const draft = await createDraftFromIntake(customerId, { ...intake, email: tok.email });
      quoteId = draft.quoteId;
    } catch (err) {
      // A malformed intake must NOT block sign-in — the customer still lands signed-in and can
      // start a fresh order. Surface the failure to logs only.
      console.error("[magic-link] createDraftFromIntake failed:", err instanceof Error ? err.message : String(err));
    }
  }
```
Add the import at the top:
```ts
import { createDraftFromIntake } from "./draft";
import type { DraftIntake } from "./draft";
```
Return `{ ok: true, session, quoteId }`.

- [ ] **Step 3: request route — forward intake**

In `app/api/portal/magic-link/request/route.ts`, parse an optional `intake` object from the body and pass it to `requestMagicLink`. Validate minimally: `intake` is forwarded only when it's an object with a string `locationId` and non-empty `contactName`; otherwise pass `null` (a pure sign-in). Do NOT trust any price/id beyond echoing — `createDraftFromIntake` re-validates the `locationId` UUID + re-derives all pricing. (Read the existing route to match its body-parsing shape; keep the constant `{ok:true}` response.)

- [ ] **Step 4: verify route — draft-aware `next`**

In `app/api/portal/magic-link/verify/route.ts`, replace the success return:
```ts
  const next = result.quoteId ? `/order/build?draft=${result.quoteId}` : "/order/account";
  const res = NextResponse.json({ ok: true, next });
  return applyPortalCookie(res, result.session);
```
(`result` now carries `quoteId` when a draft was created. A pure sign-in → account home.)

- [ ] **Step 5: Typecheck + commit**
```bash
npm run typecheck
git add lib/portal/magic-link.ts app/api/portal/magic-link/request/route.ts app/api/portal/magic-link/verify/route.ts
git commit -m "feat(3a): intake rides the magic-link token → draft created post-verify"
```

---

## Task 8: Draft API routes (lines / preview / submit)

**Files:**
- Create: `app/api/portal/order/draft/lines/route.ts`
- Create: `app/api/portal/order/draft/preview/route.ts`
- Create: `app/api/portal/order/draft/submit/route.ts`

**Context:** Customer-session-gated, origin-checked POST routes wrapping the draft lib. Mirror `app/api/portal/order/submit/route.ts` verbatim for the CSRF/session/error scaffold (origin host check → `requireCustomerSession` → parse → try/catch `PortalDraftError` → status+code). The body carries the `draft` quote id + references only. `customerId` comes from the session, never the body.

- [ ] **Step 1: `lines` route**

```ts
/**
 * POST /api/portal/order/draft/lines — persist the customer's cart onto their draft (server-priced).
 * Body: { quoteId, lines: [{ itemId?|menuItemId?, portion?, quantity }], isDelivery?, deliveryZoneId?, tipBps? }.
 * customerId comes from the verified session; every price is resolved server-side (D20).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/portal/session";
import { setDraftLines, PortalDraftError } from "@/lib/portal/draft";
import type { DraftLineInput } from "@/lib/portal/draft";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "bad_origin" }, { status: 403 }); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); } }
  const ctx = await requireCustomerSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.quoteId !== "string" || !Array.isArray(body.lines)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const lines: DraftLineInput[] = body.lines.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      menuItemId: typeof o.menuItemId === "string" ? o.menuItemId : null,
      portion: o.portion === "quarter" || o.portion === "half" || o.portion === "whole" ? o.portion : null,
      quantity: Number(o.quantity),
    };
  });
  try {
    const view = await setDraftLines(ctx.customerId, body.quoteId, lines, {
      isDelivery: typeof body.isDelivery === "boolean" ? body.isDelivery : undefined,
      deliveryZoneId: typeof body.deliveryZoneId === "string" ? body.deliveryZoneId : (body.deliveryZoneId === null ? null : undefined),
      tipBps: typeof body.tipBps === "number" ? body.tipBps : undefined,
    });
    return NextResponse.json({ ok: true, stack: view.stack, isDelivery: view.isDelivery, deliveryZoneId: view.deliveryZoneId });
  } catch (e) {
    if (e instanceof PortalDraftError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: `preview` route** — same scaffold; body `{ quoteId, isDelivery?, deliveryZoneId?, tipBps?, napkins? }`; calls `previewDraft`; returns `{ ok: true, stack }`.

- [ ] **Step 3: `submit` route** — same scaffold; body `{ quoteId, isDelivery?, deliveryZoneId?, tipBps?, napkins? }`; calls `submitDraft`; returns `{ ok: true, quoteId, depositCents, totalCents }`.

- [ ] **Step 4: Typecheck + build + commit**
```bash
npm run typecheck
git add app/api/portal/order/draft
git commit -m "feat(3a): draft API routes — lines, preview, submit"
```

---

## Task 9: `/order/start` — server wrapper + richer intake form

**Files:**
- Modify: `app/order/start/page.tsx`
- Create: `app/order/start/start-client.tsx`

**Context:** Convert the page to a thin server component that loads the real locations and renders a client form. The `new` mode gains the 7 intake fields (kept light/progressive), captures a real `locationId`, and POSTs the intake to `/api/portal/magic-link/request`. On submit → the same "check your email" screen (unchanged). No sessionStorage carrier for the artifact anymore — the intake rides the token. Preserve the existing visual style, `GoodToKnow`, and the returning-user sign-in mode.

- [ ] **Step 1: Server wrapper (`page.tsx`)**
```tsx
import { loadPublicLocations } from "@/lib/portal/locations";
import { OrderStartClient } from "./start-client";

export default async function OrderStart() {
  const locations = await loadPublicLocations();
  return <OrderStartClient locations={locations} />;
}
```

- [ ] **Step 2: Client form (`start-client.tsx`)** — move the existing `"use client"` component here, `export function OrderStartClient({ locations }: { locations: { id: string; name: string; code: string | null }[] })`. Changes to the `new`-mode form:
  - Location choice renders `locations` (real id + name) for BOTH delivery and pickup (the fulfilling store); default to the first. Track `locationId` in form state.
  - Add fields (light, optional except where noted): **contact phone**, **delivery/pickup time window** (a text input, e.g. "11:00–11:30 AM"), **event type/occasion**, **dietary & allergen notes** (textarea), **event/order name**, **preferred drop-off door** (show only for delivery). Delivery address already exists.
  - `canSubmit` (new mode): `name.trim() && email.includes("@") && date && locationId`.
  - On submit, POST `/api/portal/magic-link/request` with:
    ```ts
    body: JSON.stringify({
      email: f.email, name: f.name,
      intake: {
        locationId: f.locationId, contactName: f.name, company: f.company || null,
        eventDate: f.date, headcount: Number(f.guests) || null,
        isDelivery: f.fulfillment === "delivery",
        deliveryAddress: f.fulfillment === "delivery" ? (f.address || null) : null,
        contactPhone: f.phone || null, timeWindow: f.timeWindow || null,
        eventType: f.eventType || null, dietaryNotes: f.dietary || null,
        eventName: f.eventName || null, dropoffDoor: f.fulfillment === "delivery" ? (f.door || null) : null,
      },
    })
    ```
  - Returning mode: unchanged (POST `{ email }` only, no intake).
  - REMOVE the `sessionStorage.setItem("co_order_details", ...)` line — the artifact no longer flows via sessionStorage.

- [ ] **Step 3: Build gate + commit**
```bash
npm run build
```
Expected: PASS (server component + client child; no `useSearchParams` added).
```bash
git add app/order/start
git commit -m "feat(3a): /order/start real locations + richer intake → token"
```

---

## Task 10: `/order/build` — real menu + server-backed draft

**Files:**
- Modify: `app/order/build/page.tsx`

**Context:** The biggest rewrite. Replace the hardcoded `MENU` + sessionStorage with the real draft. Keep the rich UX — coverage panel, customize modal, portion selector, cart, mobile bottom-sheet — but drive it from `loadDraft`'s data. **The 24→20 fix:** headcount comes from the draft (`lead.headcount`), NOT a hardcoded `20` and NOT a `?guests=` URL param. On every cart change, persist via `/api/portal/order/draft/lines` (debounced) so the server owns the priced stack. Read the `draft` id from `window.location.search` inside `useEffect` (NOT `useSearchParams` — Next 16 static-prerender rule; the file stays a client component but must not break the build gate).

**Data mapping (real `CateringMenuItem` → the page's shopping model):**
- `CateringMenuItem` fields (from `lib/catering/menu.ts` via `loadDraft().menu`): `id`, `kind: "item"|"menu_item"`, `name`, `section`, `portionable`, `unitPriceCents`, `portionPricesCents: {quarter,half,whole}|null`.
- Group by `section`. A `menu_item` with `portionable` renders the portion selector; everything else is quantity-only. (The mockup's `platter/lunchbox/bigsub` customize flows were mock-only — real package/customize behavior is W1b; 3a renders `item`/`menu_item` refs with the portion selector + quantity + the existing allergen/notes affordances, which persist as line `notes` only if the schema supports it — it does not today, so drop per-line allergens/notes from the persisted payload; keep them as display-only or remove. Persisted line = `{ itemId|menuItemId, portion, quantity }` only.)
- Prices are already cents; use `unitPriceCents / 100` for display via the existing `money()` (which takes dollars) or switch `money` to cents. Keep one consistent unit.

**Rewrite shape:**
- [ ] **Step 1:** Add `const [draftId, setDraftId] = useState<string|null>(null)`, `const [load, setLoad] = useState<DraftLoad|null>(null)`, `const [loadError, setLoadError] = useState(false)`. In a mount `useEffect`, read `draft` from `window.location.search`; if absent → show an empty state with a link back to `/order/start`. If present, `fetch("/api/portal/order/draft/lines"...)` is a write; instead add a small GET loader route OR load via a server component. **Decision:** add `GET /api/portal/order/draft/[quoteId]` returning `loadDraft` (owned) — simplest for the client page. (Create it in this task.)
- [ ] **Step 2:** Create `app/api/portal/order/draft/[quoteId]/route.ts` — `GET`, `requireCustomerSession`, `params` is a Promise (`const { quoteId } = await params`), returns `loadDraft(ctx.customerId, quoteId)` or 404. (Next 16: `export async function GET(req, { params }: { params: Promise<{ quoteId: string }> })`.)
- [ ] **Step 3:** Render the menu from `load.menu` grouped by section; headcount = `load.lead?.headcount ?? 0` (state seeded from the draft; the guest input still lets them adjust, which PATCHes the lead via… out of 3a scope — keep the guests input editable locally for coverage display, seeded from the draft; the authoritative headcount is the lead's). Coverage math reused as-is against the local headcount.
- [ ] **Step 4:** Replace `goToReview`/sessionStorage with: on cart change, POST `/api/portal/order/draft/lines` with `{ quoteId: draftId, lines }` (debounce ~400ms); "Continue" navigates to `/order/review?draft=<draftId>`. The cart/subtotal can show the server `stack` returned by the lines POST (authoritative) or a local optimistic subtotal; prefer the server stack for the subtotal line.
- [ ] **Step 5:** Preserve the CoveragePanel, CustomizeModal (portion selector + qty; drop persisted allergens/notes), Cart, and mobile sheet. Remove `ITEM_FACTS`-by-mock-id coupling if the real ids don't match (keep the generic house `FACTS` ticker).
- [ ] **Step 6: Build gate + commit**
```bash
npm run build
```
Expected: PASS. (With 0 menu rows the page shows an empty menu — correct dormant behavior.)
```bash
git add app/order/build app/api/portal/order/draft
git commit -m "feat(3a): /order/build real menu + server draft (fixes 24→20 headcount)"
```

---

## Task 11: `/order/review` — server charge stack + napkins + submit

**Files:**
- Modify: `app/order/review/page.tsx`

**Context:** Replace the illustrative client rates with the server stack from `previewDraft`, add the napkins toggle, keep the tip presets + the "how payment works" copy, and make the one "complete order" click call `submitDraft` → redirect to `/order/quote/<quoteId>` (the existing pay surface). Read `draft` id from `window.location.search` in `useEffect` (not `useSearchParams`).

- [ ] **Step 1:** On mount, read `draft` id; load the draft recap via `GET /api/portal/order/draft/[quoteId]` (Task 10 Step 2) → event details from `load.lead` (date, headcount, fulfillment via `isDelivery`, contact), the line items from `load.items`, and the napkins availability from `load.addonNapkins`. If no `draft` id or not owned → redirect to `/order/start`.
- [ ] **Step 2:** Replace the `charges` `useMemo` (SERVICE_RATE/TAX_RATE/etc.) with a server call: `POST /api/portal/order/draft/preview` with `{ quoteId, isDelivery, tipBps, napkins }` on load AND whenever tip / napkins toggle changes; render the returned `stack` (subtotal/service/delivery/gratuity/tax/total/deposit). Show a small "prices confirmed by our team" note (keep existing copy).
- [ ] **Step 3:** Add the **napkins & utensils** toggle (only if `load.addonNapkins` is present) with its price (`addonNapkins.unitPriceCents`); wire it into the preview call + the submit payload.
- [ ] **Step 4:** Tip presets: map the chosen percentage → `tipBps` (e.g. 18% → 1800) and pass to preview/submit. Keep `TIP_PRESETS`.
- [ ] **Step 5:** The sticky "Pay deposit & lock my date" button calls `POST /api/portal/order/draft/submit` with `{ quoteId, isDelivery, deliveryZoneId, tipBps, napkins }`; on `{ok:true, quoteId}` → `router.push('/order/quote/' + quoteId)`. Remove the `co_order_charges` sessionStorage write + the `/order/checkout` hop.
- [ ] **Step 6: Build gate + commit**
```bash
npm run build
git add app/order/review
git commit -m "feat(3a): /order/review server charge stack + napkins + submitDraft"
```

---

## Task 12: Napkins seed + seeded lifecycle smoke

**Files:**
- Create: `scripts/seed-napkins-item.ts`
- Create: `scripts/3a-smoke.ts`

**Context:** The napkins add-on is a catering-available `items` row in the `ADDON_SECTION` ("Add-ons"). The seed is idempotent (find-by-name-or-create). The smoke exercises the whole lifecycle against W1a's seeded menu, asserting the artifact model, then rolls back every seeded row (mirror `scripts/w1a-smoke.ts` — self-cleaning, zero residue).

- [ ] **Step 1: `seed-napkins-item.ts`** — idempotent: look up an active `items` row named "Napkins & Utensils" in section "Add-ons"; if absent, insert `{ name: "Napkins & Utensils", section: "Add-ons", catering_available: true, catering_only: true, menu_price: <a small dollar upcharge, e.g. 0.50 per… decide: a flat add-on; use e.g. 25.00 for a party pack>, active: true, created_by: null }` (confirm the `items` NOT NULL columns via `information_schema` first — items has many columns; set only the required + these). Print the id. Run: `npx tsx --env-file=.env.local scripts/seed-napkins-item.ts`. NOTE: run against DEV data only; do NOT seed prod as part of 3a (prod stays dormant until Juan's wiring pass). The seed exists for smoke + local; document this at the top of the file.

- [ ] **Step 2: `3a-smoke.ts`** — a single self-cleaning run:
  1. Seed: a location rate rule (rate_bps=10000), one catering-available `menu_items` sub (portionable) + one catering-available `items` extra + the napkins add-on item + a `catering_pricing_rules` row (tax/service/deposit bps) for the test location. Track every inserted id.
  2. Resolve-or-create a test customer (or insert one) → `customerId`.
  3. `createDraftFromIntake(customerId, { locationId, contactName:"Smoke", eventDate, headcount:24, isDelivery:false, ... })` → assert a lead row (stage 'inquiry', lead_source 'portal', headcount 24, intake fields persisted) + a draft quote (status 'draft', origin 'self_serve', 0 items).
  4. `setDraftLines(customerId, quoteId, [{ menuItemId, portion:'half', quantity:2 }, { itemId, quantity:1 }])` → assert items replaced, `unit_price_cents` = server-derived (NOT client), stack subtotal = sum of line totals, quote still 'draft', version unchanged (=1), no new quote row.
  5. `previewDraft(customerId, quoteId, { tipBps: 1800, napkins: true })` → assert gratuity = 18% of subtotal, total includes napkins, NOTHING persisted (re-load draft: still no napkins line, gratuity_cents unchanged).
  6. `submitDraft(customerId, quoteId, { tipBps: 1800, napkins: true })` → assert quote flips to 'submitted', a napkins line now exists, a `catering_payments` deposit 'due' row = stack.depositCents, gratuity snapshot = 18%.
  7. Immutability: a second `setDraftLines` on the now-'submitted' quote throws `not_draft` (409).
  8. Stage transitions: `moveStage` the lead `confirmed` → `out` → `completed` succeed (asserts the `'out'` stage is valid).
  9. **Cleanup:** delete every seeded row (payments, quote_items, quote, pipeline_events, pipeline, rate rule, pricing rule, menu_items/items, napkins, customer if created). Re-query counts → back to baseline. Print `3a SMOKE: PASS` + a residue check.
  Run: `npx tsx --env-file=.env.local scripts/3a-smoke.ts`. Expected: `PASS`, zero residue.

- [ ] **Step 3: Commit**
```bash
git add scripts/seed-napkins-item.ts scripts/3a-smoke.ts
git commit -m "test(3a): napkins seed + self-cleaning lifecycle smoke"
```

---

## Task 13: Final gates + PR

**Files:** none (verification + PR)

- [ ] **Step 1:** `npm run build` (the CI gate) → PASS. `npm run typecheck` → PASS. `npx eslint lib/portal/draft.ts lib/portal/locations.ts lib/catering/pipeline.ts` (the new/changed lib) → clean.
- [ ] **Step 2:** `npx tsx --env-file=.env.local scripts/3a-smoke.ts` → PASS, zero residue.
- [ ] **Step 3:** CC runs the recurring-bug-class checklist over the full diff (authz/tenancy: ownership on every draft op; silent-at-scale: no unbounded loaders introduced; Next.js structural: no `useSearchParams` on the rewritten pages, route `params` awaited; semantics: draft immutability guard, D20 price authority; process: migration file committed + applied).
- [ ] **Step 4:** Open the PR (verify `gh pr view --json state` == MERGED semantics per the #133 discipline — do NOT chain branch-delete after merge). Title: `feat(3a): order-artifact lifecycle + real-data wiring`. Body: the artifact model, the create-post-verify hand-off, the 24→20 fix, dormant-until-data note, the deferred set (3a-print, W4).

---

## Self-Review (against the spec)

**Spec coverage:** §2 artifact model → T4 (createDraftFromIntake). §2 mutable-draft→versioned → T5 (in-place setDraftLines) + T6 (flip on submit) + smoke step 7 (immutability). §3 `'out'` stage → T1 + T2 + smoke step 8. §4 intake fields → T1 + T2; napkins-as-item → T12 seed + T6 submit. §5 `lib/portal/draft.ts` (create/load/setLines/submit) → T4/T5/T6 (+ previewDraft for the D20-faithful review). §6 real-data wiring of the 3 pages → T9/T10/T11. §7 richer intake + napkins toggle → T9 + T11. §8 security (create-post-verify, ownership, status guards, D20, rate-limit reuse) → T4/T5/T6/T7. §10 seeded smoke → T12. §12 confirm-before-authoring → done at plan top + T1/T3/T12 spot-checks.

**Placeholder scan:** the two UI tasks (T10/T11) give data contracts + wiring points + preserve-lists rather than 600 lines of verbatim JSX — this is deliberate (the pages are large and the implementer reads the real file), matching how W1a shipped. Every LIB + route + migration task has complete code. One flagged in-plan correction: T5 Step 2 removes `estimated_revenue_cents` from the `catering_quotes` update (it's a `catering_pipeline` column).

**Type consistency:** `DraftIntake`, `DraftLineInput`, `Portion`, `DraftView`, `DraftLoad`, `PortalDraftError`, `ADDON_SECTION` are defined once in T4 and consumed consistently in T5/T6/T7/T8. `CateringMenuItem.portionPricesCents` / `.kind` / `.unitPriceCents` match `lib/catering/menu.ts` (W1a). `computeChargeStack`/`ChargeStack`/`ChargeRates`/`lineTotalCents` match `lib/catering/quotes.ts`. `createPaymentDue` signature matches `lib/catering/payments.ts`.
