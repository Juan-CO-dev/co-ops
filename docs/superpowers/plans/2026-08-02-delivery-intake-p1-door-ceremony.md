# Delivery Intake P1 — Door Ceremony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the manager-at-door intake ceremony: pre-filled count-by-exception receiving with inline discrepancy flags, required receipt photo, dedupe/partial-delivery guards, offline draft, and a tracked vendor-credits ledger surfaced where managers look.

**Architecture:** Extend the proven `recordDelivery()` spine (`lib/receiving.ts`, 375 lines) and `ReceivingForm.tsx` (132 lines) — no re-architecture. One migration (0168) adds lifecycle columns + the `vendor_credits` table. Credits derive server-side from flagged lines via a pure helper (TDD'd), idempotent per line. Match/email work is P2 — this plan only adds the `match_state` column so P2 needs no second migration.

**Tech Stack:** Next.js App Router + Supabase (service-role libs, app-layer auth per house pattern) · vitest (`npm test`, `tests/*.test.ts`) · existing PhotoCapture + 0164 photos bucket · i18n via existing `t(...)` convention.

**Spec:** `docs/superpowers/specs/2026-08-02-delivery-intake-ordering-design.md` (D1, D3, D7 + match_state groundwork). Prior read REQUIRED: `lib/receiving.ts` whole file; `components/receiving/ReceivingForm.tsx` whole file.

**House laws that bind every task:** app-layer auth (`getRoleLevel` ≥ RECEIVE_MIN=4 — KH means KEY HOLDER) + `lockLocationContext` IDOR bind · server derives all money/oz (client never authoritative) · append-only, never repurpose columns · advisory-null, never fabricate · oz-normalized display paths (BC-026) · credits atomic-or-idempotent with intake (BC-007) · inactive-vendor filtering in rollups (BC-009).

---

### Task 1: Migration 0168 — lifecycle columns + vendor_credits

**Files:**
- Create: `supabase/migrations/0168_delivery_intake_p1.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0168: delivery-intake P1 (spec 2026-08-02-delivery-intake-ordering-design.md D1/D3)
-- match_state added now so P2 (email channel) needs no schema change.

alter table public.vendor_deliveries
  add column if not exists match_state text not null default 'counted_only'
    check (match_state in ('counted_only','matched','discrepant','override')),
  add column if not exists delivery_status text not null default 'complete'
    check (delivery_status in ('in_progress','complete'));

alter table public.vendor_delivery_items
  add column if not exists expected_qty numeric null,          -- qty pre-filled at the door (level units); null = unexpected/added line
  add column if not exists discrepancy_type text null
    check (discrepancy_type in ('short','over','damaged','substitution'));

create table if not exists public.vendor_credits (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  vendor_id uuid not null references public.vendors(id),
  delivery_id uuid null references public.vendor_deliveries(id),
  delivery_item_id uuid null references public.vendor_delivery_items(id),
  reason text not null check (reason in ('short','over','damaged','substitution','price_discrepancy')),
  sku_id uuid null references public.vendor_items(id),
  qty numeric null,
  amount_cents integer null,               -- server-derived estimate: qty * intake unit_price
  status text not null default 'open'
    check (status in ('open','in_progress','resolved_credit','resolved_refund','written_off')),
  memo_url text null,
  notes text null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

-- Idempotency: one credit per (line, reason) — retry-safe if intake write is re-run.
create unique index if not exists vendor_credits_line_reason_uq
  on public.vendor_credits (delivery_item_id, reason) where delivery_item_id is not null;
create index if not exists vendor_credits_vendor_open_ix
  on public.vendor_credits (vendor_id, status);
create index if not exists vendor_credits_location_ix
  on public.vendor_credits (location_id);

-- House pattern: deny-by-default; service-role only.
alter table public.vendor_credits enable row level security;
revoke all on public.vendor_credits from anon, authenticated;
revoke all on public.vendor_credits from public;
```

- [ ] **Step 2: Apply to prod via the established migration flow** (Supabase MCP `apply_migration`, name `0168_delivery_intake_p1`). Expected: success; verify with `list_migrations` showing 0168.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0168_delivery_intake_p1.sql
git commit -m "feat(receiving): migration 0168 — intake lifecycle columns + vendor_credits"
```

---

### Task 2: Pure credit-derivation helper (TDD)

**Files:**
- Create: `lib/receiving-shared.ts`
- Test: `tests/receiving-shared.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/receiving-shared.test.ts
import { describe, it, expect } from "vitest";
import { deriveCreditDrafts, dedupeKey, type IntakeLineForCredits } from "../lib/receiving-shared";

const line = (over: Partial<IntakeLineForCredits>): IntakeLineForCredits => ({
  deliveryItemId: "item-1", skuId: "sku-1", qtyReceived: 5, expectedQty: 5,
  unitPrice: 12.5, discrepancyType: null, ...over,
});

describe("deriveCreditDrafts", () => {
  it("returns nothing for clean lines", () => {
    expect(deriveCreditDrafts([line({})])).toEqual([]);
  });
  it("derives a short credit with qty = expected - received and amount from intake price", () => {
    const [c] = deriveCreditDrafts([line({ qtyReceived: 3, discrepancyType: "short" })]);
    expect(c).toMatchObject({ deliveryItemId: "item-1", reason: "short", qty: 2, amountCents: 2500 });
  });
  it("flags with no qty delta still produce a credit with null qty (damaged whole-line judgment)", () => {
    const [c] = deriveCreditDrafts([line({ discrepancyType: "damaged" })]);
    expect(c).toMatchObject({ reason: "damaged", qty: null, amountCents: null });
  });
  it("never derives negative qty (over-delivery credit carries the overage qty)", () => {
    const [c] = deriveCreditDrafts([line({ qtyReceived: 8, discrepancyType: "over" })]);
    expect(c).toMatchObject({ reason: "over", qty: 3 });
  });
  it("null expectedQty (added line) with a flag produces a null-qty credit", () => {
    const [c] = deriveCreditDrafts([line({ expectedQty: null, discrepancyType: "substitution" })]);
    expect(c).toMatchObject({ reason: "substitution", qty: null });
  });
  it("amountCents is null when unitPrice missing", () => {
    const [c] = deriveCreditDrafts([line({ qtyReceived: 3, discrepancyType: "short", unitPrice: null })]);
    expect(c.amountCents).toBeNull();
  });
});

describe("dedupeKey", () => {
  it("normalizes invoice casing/whitespace", () => {
    expect(dedupeKey("v1", " INV-001 ", "2026-08-02")).toBe("v1|inv-001|2026-08-02");
  });
  it("null invoice yields a date-scoped key", () => {
    expect(dedupeKey("v1", null, "2026-08-02")).toBe("v1||2026-08-02");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- tests/receiving-shared.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/receiving-shared.ts — pure math for the door ceremony. No I/O (counts-shared discipline).
export interface IntakeLineForCredits {
  deliveryItemId: string;
  skuId: string;
  qtyReceived: number;
  expectedQty: number | null;
  unitPrice: number | null;
  discrepancyType: "short" | "over" | "damaged" | "substitution" | null;
}

export interface CreditDraft {
  deliveryItemId: string;
  skuId: string;
  reason: "short" | "over" | "damaged" | "substitution";
  qty: number | null;          // level units; null = whole-line judgment call
  amountCents: number | null;  // qty * intake unit_price; intake price is price authority (spec D1)
}

export function deriveCreditDrafts(lines: IntakeLineForCredits[]): CreditDraft[] {
  const out: CreditDraft[] = [];
  for (const l of lines) {
    if (!l.discrepancyType) continue;
    let qty: number | null = null;
    if (l.expectedQty != null) {
      const delta = l.discrepancyType === "over" ? l.qtyReceived - l.expectedQty : l.expectedQty - l.qtyReceived;
      qty = delta > 0 ? delta : null;
    }
    const amountCents = qty != null && l.unitPrice != null ? Math.round(qty * l.unitPrice * 100) : null;
    out.push({ deliveryItemId: l.deliveryItemId, skuId: l.skuId, reason: l.discrepancyType, qty, amountCents });
  }
  return out;
}

export function dedupeKey(vendorId: string, invoiceNumber: string | null, deliveryDate: string): string {
  return `${vendorId}|${(invoiceNumber ?? "").trim().toLowerCase()}|${deliveryDate}`;
}
```

- [ ] **Step 4: Run tests** — `npm test -- tests/receiving-shared.test.ts`. Expected: PASS (8 tests).

- [ ] **Step 5: Commit** — `git add lib/receiving-shared.ts tests/receiving-shared.test.ts && git commit -m "feat(receiving): pure credit-derivation + dedupe helpers (TDD)"`

---

### Task 3: lib/receiving.ts extensions

**Files:**
- Modify: `lib/receiving.ts` (currently 375 lines — read whole file first)
- Create: `lib/credits.ts`

- [ ] **Step 1: Extend `DeliveryLineInput` (lib/receiving.ts:64-76)** — add two optional fields, never repurposing existing ones:

```typescript
  expectedQty?: number | null;      // pre-filled at door; null/absent = added line
  discrepancyType?: "short" | "over" | "damaged" | "substitution" | null;
```

Also extend `RecordDeliveryInput` header with `deliveryStatus?: "in_progress" | "complete"` (default `"complete"`).

- [ ] **Step 2: Add the dedupe guard inside `recordDelivery` (before the header insert, ~line 220 where invoice_number is handled):**

```typescript
  // Dedupe guard (spec D1): two managers, one truck. Same vendor+invoice+date = same delivery.
  if (input.invoiceNumber?.trim()) {
    const { data: dupe } = await sb
      .from("vendor_deliveries")
      .select("id, delivery_status")
      .eq("vendor_id", input.vendorId)
      .eq("location_id", input.locationId)
      .eq("delivery_date", input.deliveryDate)
      .ilike("invoice_number", input.invoiceNumber.trim())
      .maybeSingle();
    if (dupe) {
      throw new ReceivingError(409, "duplicate_delivery",
        dupe.delivery_status === "in_progress"
          ? "This delivery is already in progress — continue it instead."
          : "This invoice was already received for this vendor today.");
    }
  }
```

- [ ] **Step 3: Persist the new line fields** in the existing line-mapping block (where `received_level_label`/`received_qty_at_level`/`resolved_oz` are built): add `expected_qty: line.expectedQty ?? null, discrepancy_type: line.discrepancyType ?? null`, and `delivery_status: input.deliveryStatus ?? "complete"` on the header insert.

- [ ] **Step 4: Insert credits idempotently after the lines insert** (same function, after the lines insert succeeds and line ids are known — select them back with `delivery_id` + `vendor_item_id`):

```typescript
  const drafts = deriveCreditDrafts(insertedLines.map((l) => ({
    deliveryItemId: l.id, skuId: l.vendor_item_id,
    qtyReceived: l.received_qty_at_level ?? l.qty_received,
    expectedQty: l.expected_qty, unitPrice: l.unit_price,
    discrepancyType: l.discrepancy_type,
  })));
  if (drafts.length) {
    const { error: credErr } = await sb.from("vendor_credits").upsert(
      drafts.map((d) => ({
        location_id: input.locationId, vendor_id: input.vendorId,
        delivery_id: deliveryId, delivery_item_id: d.deliveryItemId,
        reason: d.reason, sku_id: d.skuId, qty: d.qty, amount_cents: d.amountCents,
        created_by: actor.user.id,
      })),
      { onConflict: "delivery_item_id,reason", ignoreDuplicates: true },
    );
    if (credErr) throw new ReceivingError(500, "credit_write_failed", credErr.message);
  }
```

- [ ] **Step 5: Add `loadLastDeliveryTemplate`** (new export in lib/receiving.ts, same auth/location pattern as `loadReceivingFormData`):

```typescript
export async function loadLastDeliveryTemplate(
  actor: AuthContext, locationId: string, vendorId: string,
): Promise<{ lines: Array<{ skuId: string; level: string | null; qty: number }> } | null> {
  requireReceiver(actor); requireLocation(actor, locationId);   // reuse the file's existing guard helpers
  const sb = serviceClient();
  const { data: last } = await sb.from("vendor_deliveries")
    .select("id").eq("vendor_id", vendorId).eq("location_id", locationId)
    .order("delivery_date", { ascending: false }).order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!last) return null;
  const { data: lines } = await sb.from("vendor_delivery_items")
    .select("vendor_item_id, received_level_label, received_qty_at_level, qty_received")
    .eq("delivery_id", last.id);
  return { lines: (lines ?? []).map((l) => ({
    skuId: l.vendor_item_id, level: l.received_level_label,
    qty: l.received_qty_at_level ?? l.qty_received,
  })) };
}
```

(If the file's guards are inline rather than named helpers, follow the file's exact existing style — read it first.)

- [ ] **Step 6: Add `addDeliveryLines`** (partial-delivery continue): same validation path as `recordDelivery`'s line handling, appends lines + credits to an existing `in_progress` delivery owned by the same location, and a `completeDelivery(actor, deliveryId)` that flips `delivery_status` to `complete`. Reject appends to `complete` deliveries with 409.

- [ ] **Step 7: Create `lib/credits.ts`** (service-role; RECEIVE_MIN read gate; AGM (6) for resolution):

```typescript
// lib/credits.ts — vendor credit lifecycle (spec D3). App-layer auth per house pattern.
import { getRoleLevel } from "./roles";
export const CREDIT_RESOLVE_MIN = 6; // AGM+ resolves/writes off; KH+ views.

export async function loadOpenCreditsSummary(actor: AuthContext, locationId: string) {
  // KH+ gate + location-bind, then:
  // select vendor_id, vendors(name), status, amount_cents, created_at from vendor_credits
  //   join vendors (filter vendors.active — BC-009)
  //   where location_id = $1 and status in ('open','in_progress')
  // aggregate per vendor: { vendorId, vendorName, openCount, totalCents, oldestDays }
}

export async function resolveCredit(
  actor: AuthContext, creditId: string,
  outcome: "resolved_credit" | "resolved_refund" | "written_off", notes?: string,
) {
  // AGM+ gate; location-bind via the credit's location_id; set status/resolved_at/notes append.
}
```

Implement both fully following `lib/counts.ts:86-93`'s `requireLevel`/`lockLocationContext` idiom.

- [ ] **Step 8: Typecheck + full test run** — `npx tsc --noEmit && npm test`. Expected: clean.

- [ ] **Step 9: Commit** — `git commit -am "feat(receiving): dedupe guard, expected/discrepancy fields, idempotent credits, template + continue loaders"`

---

### Task 4: API routes

**Files:**
- Modify: `app/api/operations/receiving/route.ts` (accept the new header/line fields; pass through to `recordDelivery`; surface the 409 dedupe message verbatim to the client)
- Create: `app/api/operations/receiving/template/route.ts` — GET `?locationId=&vendorId=` → `loadLastDeliveryTemplate` (KH+; same auth extraction as the POST route — copy its exact session-derivation lines)
- Create: `app/api/operations/receiving/credits/route.ts` — GET summary (KH+) / PATCH resolve (AGM+ via `resolveCredit`)

- [ ] **Step 1: Implement all three** following the existing POST route's auth/parse/error shape exactly (read it first; keep error JSON shape identical).
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` — clean.
- [ ] **Step 3: Commit** — `git commit -am "feat(receiving): template, credits, and extended intake API routes"`

---

### Task 5: ReceivingForm — count-by-exception rebuild

**Files:**
- Modify: `components/receiving/ReceivingForm.tsx` (132 lines; props `{formData, locationId, today}` stay; `LineDraft` grows)
- Create: `components/receiving/IntakeLineRow.tsx`

- [ ] **Step 1: Extend `LineDraft`:** `expectedQty: number | null; discrepancyType: "short"|"over"|"damaged"|"substitution"|null; confirmed: boolean;`

- [ ] **Step 2: Pre-fill on vendor select:** fetch `/api/operations/receiving/template?...`; when present, seed lines (qty = expectedQty, confirmed=false) and render ONLY those + an "Add item" button opening the existing SKU picker (spec: never scroll 163 SKUs). No template → current blank-line behavior unchanged.

- [ ] **Step 3: Build `IntakeLineRow`** (the door UX — spec D1):
  - Collapsed: SKU name + `expectedQty × level` + one big ✓ button (sets qty=expected, confirmed=true, row turns green).
  - Tap row (not ✓) → expanded: qty steppers `−/+` at the received level (44px+ touch targets, no numeric keypad as primary; keyboard entry still possible), flag chips `Short · Over · Damaged · Sub` (auto-suggest Short when qty<expected, Over when >), note field, existing per-line PhotoCapture. Flag selection is one tap; chips render inline in the row (no modal).
  - Added lines (no expectedQty) render expanded by default with the SKU picker.

- [ ] **Step 4: Photo as a required step:** move receipt `PhotoCapture` into a distinct final section styled as a step ("Step 2 — Receipt photo"); submit button disabled until `receiptPhotoId != null` OR the `Photo later` checkbox is ticked (which appends `[PHOTO PENDING] ` to the header note — the receiving list derives its missing-photo badge from `receipt_url` being null, no schema needed).

- [ ] **Step 5: Submit payload** gains per-line `expectedQty`/`discrepancyType` and header `deliveryStatus` (a `Save partial — truck still unloading` secondary action posts `in_progress`). On 409 `duplicate_delivery`, show the server message with a "View existing" link to `/operations/receiving/{id}` when the API returns the id.

- [ ] **Step 6: Manual smoke on all three form factors** (phone width 390px, tablet 820px, desktop) via the app's dev server + browser tools: template pre-fill renders; ✓-all + photo + submit < 90s; flags create credits (verify in Task 6's panel).

- [ ] **Step 7: Commit** — `git commit -am "feat(receiving): count-by-exception door form with required photo step"`

---

### Task 6: Offline draft

**Files:**
- Modify: `components/receiving/ReceivingForm.tsx`

- [ ] **Step 1:** Persist `{locationId, vendorId, header, lines, receiptPhotoId, savedAt}` to `localStorage` key `coops.intake.draft.{locationId}` on every state change (debounced 500ms). Photos upload immediately when online (existing behavior) — the draft stores ids, not blobs; a visible pill shows "Saved on device HH:MM".
- [ ] **Step 2:** On mount with a stored draft: offer "Resume draft from HH:MM / Discard". Clear the key on successful submit.
- [ ] **Step 3:** Manual smoke: fill form → kill tab → reopen → resume intact. Commit — `git commit -am "feat(receiving): offline intake draft with resume"`

---

### Task 7: Surfaces — credits panel, badges, vendor aggregate, detail actions

**Files:**
- Modify: `app/(authed)/operations/receiving/page.tsx` (server component; add `loadOpenCreditsSummary` to its existing `Promise.all`)
- Create: `components/receiving/OpenCreditsPanel.tsx`
- Modify: `app/(authed)/operations/receiving/[id]/page.tsx` (delivery detail)
- Modify: admin vendor detail page (the vendors admin surface — locate exact file at execution; add the aggregate line)

- [ ] **Step 1: Receiving list:** `OpenCreditsPanel` above recent deliveries — per-vendor rows "{vendor} · {n} open · ${total} · oldest {d}d" (amber when oldest > 7d — sonnet's false-trust guard); recent-delivery rows gain badges: `📷 missing` when `receipt_url` null, `⚠ discrepant`/`in progress` from the new columns.
- [ ] **Step 2: Delivery detail:** per-line discrepancy chips + credits section listing that delivery's credits with status; AGM+ sees resolve buttons (PATCH credits route); `Continue intake` button when `delivery_status = 'in_progress'` linking back to the form in continue mode (Task 3 Step 6 API).
- [ ] **Step 3: Vendor admin detail:** one line — "Outstanding credits: ${total} across {n} deliveries" (from the same summary loader, vendor-filtered).
- [ ] **Step 4: i18n:** add all new strings through the existing `t(...)` catalog files (follow the pattern of the receiving page's current strings — no hardcoded English).
- [ ] **Step 5: Typecheck + `npm test` + manual smoke of both pages. Commit** — `git commit -am "feat(receiving): open-credits surfaces, intake badges, vendor aggregate"`

---

### Task 8: Verification pass + PR

- [ ] **Step 1:** Full suite: `npx tsc --noEmit && npm test` — clean.
- [ ] **Step 2:** End-to-end door rehearsal on the dev server (phone width): select vendor → template pre-fills → confirm-all → flag one line short → photo → submit → verify: delivery recorded, credit row exists (`open`), panel shows it, dedupe blocks a re-submit of the same invoice, partial-save + continue works, offline draft resumes.
- [ ] **Step 3:** Update `docs/ROADMAP.md`: the "FIRST PHYSICAL SKU COUNT" errand line is superseded by the spec's truth model — rewrite that block to reference the audit-tool reframe + inference bootstrap (cite the spec path).
- [ ] **Step 4:** Open PR titled "Delivery intake P1 — the door ceremony" with the spec linked; **Juan clicks merge** (prod law).

---

## Self-review (done at write time)
- Spec coverage: D1 fully (Tasks 1,3,5,6), D3 fully (Tasks 1,2,3,7), D7 unchanged-by-design, match_state groundwork only (P2 owns the lifecycle) — intentional.
- No placeholders: Task 3 Steps 6-7 and Task 7 reference "follow existing idiom/locate exact file" for surfaces whose exact shape must be read at execution — each names the pattern file to copy. Acceptable per read-first discipline; everything else carries real code.
- Type consistency: `IntakeLineForCredits`/`CreditDraft` (Task 2) match Task 3 Step 4's mapping; `LineDraft` extensions (Task 5) match the payload fields (Task 3 Step 1).
