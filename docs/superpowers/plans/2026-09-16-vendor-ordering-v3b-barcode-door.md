# Vendor Ordering V3-B — Barcode Scanning at the Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the receiving door a scan of a case label (phone camera or a Bluetooth keyboard-wedge scanner) opens the right delivery line and steps its quantity, teaches an unknown code in one tap, and never changes anything for a receiver who never taps Scan.

**Architecture:** One table `sku_barcodes` keyed by the manufacturer's GTIN (parsed out of GS1-128 labels), a PURE lookup law (`lib/barcodes-shared.ts`: `normalizeCode`, `resolveScan`, and the keyboard burst/dedupe state machine) tested in node, two small routes under the receiving gate (`lookup`, `teach`, `forget`), and a thin client `ScanField` mounted once in `ReceivingForm` that turns a scan into the same `setLine(i, patch)` the stepper already uses. Camera decoding uses `BarcodeDetector` where present and `zxing-wasm` (pinned 3.1.4, dynamically imported only when the camera sheet opens) elsewhere. The app's `Permissions-Policy` opens the camera for its own origin only.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (service-role, deny-all RLS), Vitest (node environment — no component tests; keep logic pure), `zxing-wasm@3.1.4`.

**Spec:** `docs/superpowers/specs/2026-09-16-vendor-ordering-v3b-barcode-door-design.md` (r2.1, Juan-approved; Aggie review adjudicated in §11). Read §3–§8 before Task 1.

**Branch:** `feat/vendor-ordering-v3b-barcode` from `main` (a02cfce or later) in `~/co-ops`.

**Design correction vs the spec (facts from the code):** the door intake (`components/receiving/ReceivingForm.tsx`) has NO delivery id until submit — lines live in client state (`LineDraft[]`, `setLine(i, patch)`) and the delivery row is created by `POST /api/operations/receiving` at the end. So `lookup` and `teach` key on **`vendorId` + `locationId`** (both known while the form is open), never on a `deliveryId`; the audit metadata carries `vendor_id`, `location_id`, and the `invoice_number` typed so far (nullable) so "codes taught during delivery X" is still a query on the audit log by vendor + day. Spec §4/§5's `deliveryId` reads as `{ vendorId, locationId }` everywhere below.

**House rules that apply to every task** — same as V3-A: deny-all RLS; every route `requireSession` → `ROLES[...].level >= RECEIVE_MIN` (4) → `assertSameOrigin(req)` (`lib/portal/csrf.ts`) on POST → `parseJsonBody`; audit actions registered in `lib/audit-actions.ts`; every string in `lib/i18n/en.json` AND `es.json`; `npx vitest run <file>` per task, `npx tsc --noEmit` before each commit; commit messages end with the session trailer. **Harness bookkeeping for a new table (learned on V3-A):** `fixtures/manifest.json` inventory (HISTORY — the journey teaches its own codes) + `expectedTableCount` (146 → 147), `tests/sim-fixtures.test.ts` pins (147 tables, 382 FKs: `sku_barcodes.sku_id`, `sku_barcodes.taught_by`), the clone's private `schema-meta.json` (tables, primary key, BOTH FKs, and a `columns_nullable` boolean for EVERY FK column: `sku_barcodes.sku_id: false`, `sku_barcodes.taught_by: true`).

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0206_sku_barcodes.sql` | the table, partial unique index, RLS |
| `lib/barcodes-shared.ts` | **pure**: `normalizeCode` (GS1 AI parsing → GTIN), `resolveScan`, `ScanBurst` keyboard state machine, `dedupeCameraDecode` |
| `lib/barcodes.ts` | DB: `lookupScan(actor, {vendorId, locationId, code, lineSkuIds})`, `teachBarcode`, `forgetBarcode`, `BarcodeError`; re-exports the pure surface |
| `app/api/operations/receiving/scan/lookup/route.ts` · `…/scan/teach/route.ts` · `…/scan/forget/route.ts` | the three routes |
| `components/receiving/ScanField.tsx` | client island: keyboard listener + camera sheet + unknown-code sheet; calls `onScan(match)` |
| `components/receiving/ReceivingForm.tsx` | mounts `ScanField`, maps a match onto `lines` via `setLine`, owns the "…" → Forget this code menu item |
| `lib/security-headers.ts` | `camera=(self)` |
| `lib/audit-actions.ts` | `sku.barcode.taught` (NON_DESTRUCTIVE), `sku.barcode.forgotten` (DESTRUCTIVE) |
| tests | `barcodes-shared.test.ts`, `barcodes-db.test.ts`, `scan-routes.test.ts`, `security-headers.test.ts` (extended), `sim-fixtures.test.ts` (pins) |

---

### Task 1: Migration 0206 on the sim + harness pins

**Files:** create `supabase/migrations/0206_sku_barcodes.sql`; modify `scripts/sim/launch-readiness/fixtures/manifest.json`, `tests/sim-fixtures.test.ts`, the clone's private `schema-meta.json`.

- [ ] **Step 1: Write the migration**

```sql
-- 0206_sku_barcodes.sql — Vendor Ordering V3-B (spec 2026-09-16 §3)
begin;
create table if not exists public.sku_barcodes (
  id           uuid primary key default gen_random_uuid(),
  sku_id       uuid not null references public.vendor_items(id),
  code         text not null,
  symbology    text not null default 'unknown',
  level        text not null default 'case',
  taught_by    uuid null references public.users(id),
  taught_at    timestamptz not null default now(),
  note         text null,
  forgotten_at timestamptz null,
  check (level in ('case','inner')),
  check (symbology in ('ean_13','upc_a','code_128','gs1_128','itf_14','qr','unknown'))
);
comment on table public.sku_barcodes is
  'Codes taught at the receiving door (V3-B). code = the manufacturer''s GTIN (GS1 application identifiers stripped in TS), '
  'so twins at two vendors legitimately share it; level = what ONE scan means (case | inner) and the same code may carry both. '
  'forgotten_at is a soft delete: lookups ignore it, history stays. Service-role only; deny-all RLS.';
create unique index if not exists sku_barcodes_live_key on public.sku_barcodes (code, sku_id, level) where forgotten_at is null;
create index if not exists sku_barcodes_code_ix on public.sku_barcodes (code) where forgotten_at is null;
create index if not exists sku_barcodes_sku_ix  on public.sku_barcodes (sku_id) where forgotten_at is null;
alter table public.sku_barcodes enable row level security;
revoke all on public.sku_barcodes from anon, authenticated;
revoke all on public.sku_barcodes from public;
commit;
```

- [ ] **Step 2: Apply to the sim** via the Supabase MCP (sim project `jepgzucrvklhqpthowsc`), name `0206_sku_barcodes`, statements between `begin;`/`commit;`. Verify with `execute_sql`: tables 147, FKs 382, `sku_barcodes` rls=true, grants 0, the two partial indexes present (`select indexname from pg_indexes where tablename='sku_barcodes'`).
- [ ] **Step 3: Pins.** `fixtures/manifest.json`: add `sku_barcodes` to `inventory.HISTORY`, `expectedTableCount` 147. `tests/sim-fixtures.test.ts`: `146 → 147`, `380 → 382`. Clone private `schema-meta.json`: table + `primary_keys.sku_barcodes = ["id"]` + FKs `{child:"sku_barcodes", parent:"vendor_items", name:"sku_barcodes_sku_id_fkey", columns:["sku_id"]}` and `{child:"sku_barcodes", parent:"users", name:"sku_barcodes_taught_by_fkey", columns:["taught_by"]}` + `columns_nullable["sku_barcodes.sku_id"]=false`, `["sku_barcodes.taught_by"]=true`, `["sku_barcodes.note"]=true`, `["sku_barcodes.forgotten_at"]=true`.
- [ ] **Step 4:** `npx vitest run tests/sim-fixtures.test.ts` → PASS. **Step 5: Commit** — `feat(receiving): migration 0206 — sku_barcodes (GTIN-keyed, level-aware, soft delete) + harness pins`.

---

### Task 2: `lib/barcodes-shared.ts` — the pure laws

**Files:** create `lib/barcodes-shared.ts`; test `tests/barcodes-shared.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeCode, resolveScan, ScanBurst, dedupeCameraDecode, type TaughtCode } from "@/lib/barcodes-shared";

describe("normalizeCode", () => {
  it("strips spaces and dashes, keeps digits", () => {
    expect(normalizeCode(" 0 12345 67890 5 ")).toEqual({ code: "012345678905", symbology: "upc_a", checkDigitOk: true });
  });
  it("folds a GTIN-14 with a leading zero to its 13-digit form when the check digit holds", () => {
    expect(normalizeCode("04006381333931").code).toBe("4006381333931");
  });
  it("parses GS1-128: AI 01 → GTIN, lot/weight/date AIs discarded (FNC1 as GS or as '(01)' brackets)", () => {
    expect(normalizeCode("(01)10614141000415(10)LOT77(3102)001250")).toEqual({ code: "10614141000415", symbology: "gs1_128", checkDigitOk: true });
    expect(normalizeCode("011061414100041510LOT773102001250").code).toBe("10614141000415");
  });
  it("AI 02 (contained GTIN) is accepted when 01 is absent", () => {
    expect(normalizeCode("(02)10614141000415(37)6").code).toBe("10614141000415");
  });
  it("a bad check digit is kept as scanned but flagged unknown", () => {
    expect(normalizeCode("012345678906")).toEqual({ code: "012345678906", symbology: "unknown", checkDigitOk: false });
  });
  it("rejects fewer than 6 characters", () => {
    expect(normalizeCode("12345")).toBeNull();
  });
  it("alphanumeric Code 128 passes through uppercased", () => {
    expect(normalizeCode("abc-12345")).toEqual({ code: "ABC12345", symbology: "code_128", checkDigitOk: null });
  });
});

const taught = (code: string, skuId: string, vendorId: string, level: "case" | "inner" = "case", productId: string | null = null): TaughtCode => ({ code, skuId, vendorId, level, productId });

describe("resolveScan", () => {
  const ctx = {
    vendorId: "v-pfg",
    lineSkuIds: ["sku-turkey-pfg", "sku-ham-pfg"],
    taught: [taught("111", "sku-turkey-pfg", "v-pfg"), taught("222", "sku-swiss-pfg", "v-pfg"), taught("333", "sku-turkey-leo", "v-leo", "case", "prod-turkey"), taught("444", "sku-turkey-pfg", "v-pfg", "inner")],
    vendorSkus: [{ skuId: "sku-turkey-pfg", productId: "prod-turkey" }, { skuId: "sku-ham-pfg", productId: null }, { skuId: "sku-swiss-pfg", productId: null }],
  };
  it("line > sku > twin > unknown", () => {
    expect(resolveScan("111", ctx)).toEqual({ kind: "line", skuId: "sku-turkey-pfg", level: "case", levels: ["case"], ambiguous: false });
    expect(resolveScan("222", ctx)).toEqual({ kind: "sku", skuId: "sku-swiss-pfg", level: "case", levels: ["case"], ambiguous: false });
    expect(resolveScan("333", ctx)).toEqual({ kind: "twin", skuId: "sku-turkey-pfg", viaSkuId: "sku-turkey-leo", level: "case", levels: ["case"], ambiguous: false });
    expect(resolveScan("999", ctx)).toEqual({ kind: "unknown" });
  });
  it("a code taught at both levels returns both, defaulting to case", () => {
    const both = { ...ctx, taught: [...ctx.taught, taught("111", "sku-turkey-pfg", "v-pfg", "inner")] };
    expect(resolveScan("111", both)).toMatchObject({ kind: "line", level: "case", levels: ["case", "inner"] });
  });
  it("two of this vendor's SKUs sharing a code is ambiguous: the one on the delivery wins, flagged", () => {
    const dup = { ...ctx, taught: [...ctx.taught, taught("111", "sku-ham-pfg", "v-pfg")] };
    expect(resolveScan("111", dup)).toMatchObject({ kind: "line", skuId: "sku-turkey-pfg", ambiguous: true });
  });
  it("a twin is offered only when this vendor has a SKU of the same product", () => {
    const noTwin = { ...ctx, vendorSkus: ctx.vendorSkus.filter((s) => s.skuId !== "sku-turkey-pfg"), lineSkuIds: ["sku-ham-pfg"], taught: ctx.taught.filter((t) => t.skuId !== "sku-turkey-pfg") };
    expect(resolveScan("333", noTwin)).toEqual({ kind: "unknown" });
  });
});

describe("ScanBurst (keyboard-wedge state machine)", () => {
  it("keys ≤35 ms apart, ≥6 chars, Enter-terminated → one scan; keystrokes reported as swallowed", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000; const out: string[] = [];
    for (const ch of "012345678905") { expect(b.key(ch, t)).toBe("swallow"); t += 20; }
    expect(b.key("Enter", t)).toEqual({ scan: "012345678905" });
    expect(out).toEqual([]);
  });
  it("human typing (>35 ms between keys) is never a scan and is never swallowed", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000;
    for (const ch of "turkey") { expect(b.key(ch, t)).toBe("pass"); t += 120; }
    expect(b.key("Enter", t)).toBe("pass");
  });
  it("a 300 ms silence terminates a burst without Enter", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000; for (const ch of "4006381333931") { b.key(ch, t); t += 10; }
    expect(b.tick(t + 299)).toBeNull();
    expect(b.tick(t + 300)).toEqual({ scan: "4006381333931" });
  });
  it("a burst shorter than 6 chars is released as typing", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 0; for (const ch of "1234") { b.key(ch, t); t += 10; }
    expect(b.tick(t + 300)).toEqual({ release: "1234" });
  });
});

describe("dedupeCameraDecode", () => {
  it("the same code held in frame is one event until it leaves or 1500 ms pass", () => {
    const d = dedupeCameraDecode(1500);
    expect(d.decode("111", 0)).toBe(true);
    expect(d.decode("111", 400)).toBe(false);
    expect(d.decode("111", 1600)).toBe(true);
    d.frameWithout("111", 1700);
    expect(d.decode("111", 1750)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module not found).
- [ ] **Step 3: Implement** (`lib/barcodes-shared.ts`, PURE, no imports):

```ts
export type Level = "case" | "inner";
export type Symbology = "ean_13" | "upc_a" | "code_128" | "gs1_128" | "itf_14" | "qr" | "unknown";
export interface NormalizedCode { code: string; symbology: Symbology; checkDigitOk: boolean | null }

/** GTIN mod-10 check digit over the full string (last digit is the check). */
export function gtinCheckOk(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1), check = Number(digits.at(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i++) { const d = Number(body[body.length - 1 - i]); sum += d * (i % 2 === 0 ? 3 : 1); }
  return (10 - (sum % 10)) % 10 === check;
}

const GS = "";
/** Fixed-length AIs we walk past; variable-length ones end at GS. 01/02 carry the GTIN (14 digits). */
const FIXED_AI: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "13": 6, "15": 6, "17": 6, "20": 2, "3100": 6, "3101": 6, "3102": 6, "3103": 6, "3104": 6, "3105": 6 };

/** Parse a GS1 element string (bracketed "(01)…" or FNC1/GS-separated) → the GTIN, or null. */
export function gs1Gtin(raw: string): string | null {
  const bracket = raw.match(/\((01|02)\)(\d{14})/);
  if (bracket) return bracket[2]!;
  let s = raw.replace(/^\]C1/, "");   // symbology identifier some readers prefix
  while (s.length) {
    const ai2 = s.slice(0, 2), ai4 = s.slice(0, 4);
    if (ai2 === "01" || ai2 === "02") { const g = s.slice(2, 16); return /^\d{14}$/.test(g) ? g : null; }
    const len = FIXED_AI[ai4] ?? FIXED_AI[ai2];
    if (len != null) { s = s.slice((FIXED_AI[ai4] != null ? 4 : 2) + len); continue; }
    const gs = s.indexOf(GS);            // variable-length AI (10 lot, 21 serial, 37 count …)
    if (gs < 0) return null;
    s = s.slice(gs + 1);
  }
  return null;
}

export function normalizeCode(raw: string): NormalizedCode | null {
  const trimmed = raw.trim();
  if (trimmed.length < 6) return null;
  const gtin = /[()]/.test(trimmed) || /^\]C1/.test(trimmed) || /^(01|02)\d{14}/.test(trimmed) ? gs1Gtin(trimmed) : null;
  if (gtin) { const code = gtin.startsWith("0") && gtinCheckOk(gtin.slice(1)) ? gtin.slice(1) : gtin; return { code, symbology: "gs1_128", checkDigitOk: gtinCheckOk(gtin) }; }
  const compact = trimmed.replace(/[\s-]/g, "");
  if (/^\d+$/.test(compact)) {
    let code = compact;
    if (code.length === 14 && code.startsWith("0") && gtinCheckOk(code.slice(1))) code = code.slice(1);
    const ok = gtinCheckOk(code);
    const symbology: Symbology = !ok ? "unknown" : code.length === 13 ? "ean_13" : code.length === 12 ? "upc_a" : code.length === 14 ? "itf_14" : "unknown";
    return code.length < 6 ? null : { code, symbology, checkDigitOk: ok };
  }
  const upper = compact.toUpperCase();
  return upper.length < 6 ? null : { code: upper, symbology: "code_128", checkDigitOk: null };
}

export interface TaughtCode { code: string; skuId: string; vendorId: string; level: Level; productId: string | null }
export interface ScanContext { vendorId: string; lineSkuIds: readonly string[]; taught: readonly TaughtCode[]; vendorSkus: readonly { skuId: string; productId: string | null }[] }
export type ScanMatch =
  | { kind: "line"; skuId: string; level: Level; levels: Level[]; ambiguous: boolean }
  | { kind: "sku"; skuId: string; level: Level; levels: Level[]; ambiguous: boolean }
  | { kind: "twin"; skuId: string; viaSkuId: string; level: Level; levels: Level[]; ambiguous: boolean }
  | { kind: "unknown" };

const levelsOf = (rows: readonly TaughtCode[]) => [...new Set(rows.map((r) => r.level))].sort((a, b) => (a === "case" ? -1 : 1)) as Level[];

export function resolveScan(code: string, ctx: ScanContext): ScanMatch {
  const rows = ctx.taught.filter((t) => t.code === code);
  if (rows.length === 0) return { kind: "unknown" };
  const mine = rows.filter((t) => t.vendorId === ctx.vendorId);
  const skuIds = [...new Set(mine.map((t) => t.skuId))];
  const onLine = skuIds.filter((id) => ctx.lineSkuIds.includes(id));
  if (onLine.length) { const skuId = onLine[0]!; const lv = levelsOf(mine.filter((t) => t.skuId === skuId)); return { kind: "line", skuId, level: lv[0]!, levels: lv, ambiguous: skuIds.length > 1 }; }
  if (skuIds.length) { const skuId = [...skuIds].sort()[0]!; const lv = levelsOf(mine.filter((t) => t.skuId === skuId)); return { kind: "sku", skuId, level: lv[0]!, levels: lv, ambiguous: skuIds.length > 1 }; }
  for (const t of rows) {
    if (!t.productId) continue;
    const twin = ctx.vendorSkus.find((s) => s.productId === t.productId);
    if (twin) { const lv = levelsOf(rows.filter((r) => r.skuId === t.skuId)); return { kind: "twin", skuId: twin.skuId, viaSkuId: t.skuId, level: lv[0]!, levels: lv, ambiguous: false }; }
  }
  return { kind: "unknown" };
}

/** Keyboard-wedge burst detector. Feed every keydown with a timestamp; call tick(now) from a timer. */
export class ScanBurst {
  private buf = ""; private last = -Infinity;
  constructor(private readonly o: { maxGapMs: number; minLength: number; silenceMs: number }) {}
  key(key: string, now: number): "swallow" | "pass" | { scan: string } {
    const gap = now - this.last;
    if (key === "Enter") { if (this.buf.length >= this.o.minLength && gap <= this.o.maxGapMs * 3) { const s = this.buf; this.reset(); return { scan: s }; } this.reset(); return "pass"; }
    if (key.length !== 1) return "pass";
    if (this.buf && gap > this.o.maxGapMs) { this.reset(); }   // too slow: the buffer was typing; start over
    if (!this.buf) { this.buf = key; this.last = now; return "swallow"; }   // provisional: we do not know yet
    this.buf += key; this.last = now; return "swallow";
  }
  /** Called on a timer; releases a stalled short buffer as typing, or emits a silence-terminated scan. */
  tick(now: number): { scan: string } | { release: string } | null {
    if (!this.buf || now - this.last < this.o.silenceMs) return null;
    const s = this.buf; this.reset();
    return s.length >= this.o.minLength ? { scan: s } : { release: s };
  }
  private reset() { this.buf = ""; this.last = -Infinity; }
}

/** Camera keep-scanning mode: the same code held in frame is ONE event until it leaves or holdMs passes. */
export function dedupeCameraDecode(holdMs: number) {
  const seenAt = new Map<string, number>();
  return {
    decode(code: string, now: number): boolean { const t = seenAt.get(code); if (t != null && now - t < holdMs) return false; seenAt.set(code, now); return true; },
    frameWithout(code: string, _now: number) { seenAt.delete(code); },
  };
}
```

Note for the implementer on `ScanBurst.key`: the first character of a burst is swallowed *provisionally*; if the next key arrives slower than `maxGapMs` the buffer resets and that stalled single character is released by `tick` as `{ release }`, and the ScanField re-dispatches released text into the focused element (Task 5) so a person's first keystroke is never lost. The test for "human typing … never swallowed" therefore passes only if the implementation checks `gap > maxGapMs` BEFORE deciding to swallow the second key — keep the order shown.

- [ ] **Step 4: Run** → PASS (13 tests). **Step 5: Commit** — `feat(receiving): pure barcode laws — GS1 → GTIN, scan resolution, wedge burst machine, camera dedupe (V3-B §4)`.

---

### Task 3: `lib/barcodes.ts` — DB layer + audit actions

**Files:** create `lib/barcodes.ts`; modify `lib/audit-actions.ts` (`sku.barcode.taught` NON_DESTRUCTIVE; `sku.barcode.forgotten` in the DESTRUCTIVE list — read the header comment of `lib/audit-actions.ts` and `lib/destructive-actions.ts` for where each lives); test `tests/barcodes-db.test.ts` (chainable client fake, the `daily-catchup.test.ts` shape).

Exports:
```ts
export class BarcodeError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export async function lookupScan(actor: AuthContext, input: { vendorId: string; locationId: string; code: string; lineSkuIds: string[] }): Promise<ScanMatch & { normalized: NormalizedCode }>
// location-bound: lockLocationContext(actorLoc(actor), locationId) like lib/receiving.ts:707; reads sku_barcodes (forgotten_at is null) for the code,
// the vendor's active SKUs with product_id, then resolveScan.
export async function teachBarcode(actor: AuthContext, input: { vendorId: string; locationId: string; code: string; skuId: string; level: Level; symbology?: Symbology; invoiceNumber?: string | null; confirmLevelChange?: boolean }): Promise<{ created: boolean }>
// 400 vendor_mismatch if the SKU's vendor_id !== vendorId; existing live row same level → { created:false } (no audit);
// existing live row at ANOTHER level and !confirmLevelChange → 409 level_differs { storedLevel }; else INSERT (adds the level) + audit sku.barcode.taught
// metadata { code, sku_id, level, symbology, vendor_id, location_id, invoice_number }.
export async function forgetBarcode(actor: AuthContext, input: { vendorId: string; locationId: string; code: string; skuId: string; level: Level }): Promise<void>
// UPDATE forgotten_at = now() where live; 404 not_taught if none; audit sku.barcode.forgotten.
export const SCAN_MIN = 4; // = RECEIVE_MIN
```

- [ ] Tests (write first): lookup normalises then resolves and never reads forgotten rows (`.is("forgotten_at", null)` asserted on the fake); teach idempotent same level; teach other level → 409 then adds with confirm; vendor mismatch 400; forget soft-deletes + audits; location binding refused → 404 `not_found` (same shape as receiving).
- [ ] Commit — `feat(receiving): barcode DB layer — lookup, teach (level add with confirm), forget (soft) + audit actions (V3-B §5)`.

---

### Task 4: The three routes

**Files:** create `app/api/operations/receiving/scan/lookup/route.ts`, `…/scan/teach/route.ts`, `…/scan/forget/route.ts`; test `tests/scan-routes.test.ts` (mock `@/lib/session`, `@/lib/portal/csrf`, `@/lib/barcodes`).

Each route: `POST` only; `assertSameOrigin(req)` first (returns the 403 response when cross-site), `parseJsonBody`, `requireSession(req, "/api/operations/receiving/scan/<x>")`, `ROLES[ctx.user.role].level < SCAN_MIN → 403`, validate (`vendorId`/`locationId`/`skuId` UUID regex from `app/api/operations/receiving/route.ts:7`, `code` string 6–128 chars, `level` in case|inner, `lineSkuIds` array ≤ 200 UUIDs), call the lib, map `BarcodeError` → `jsonError(e.status, e.code, { message, ...(e.code === "level_differs" ? { storedLevel } : {}) })`, unknown errors rethrow.

- [ ] Tests: employee 403 before any lib call; cross-origin 403; invalid payload 400 per field; lookup 200 passes `{kind…}` through; teach 409 `level_differs` carries `storedLevel`; forget 200.
- [ ] Commit — `feat(receiving): scan lookup / teach / forget routes under the receiving gate (V3-B §5)`.

---

### Task 5: `ScanField` + `ReceivingForm` wiring + camera header + i18n

**Files:** create `components/receiving/ScanField.tsx`; modify `components/receiving/ReceivingForm.tsx`, `lib/security-headers.ts:132` (+ module comment `:120-125`), `tests/security-headers.test.ts:162,173-177`, `lib/i18n/en.json`, `lib/i18n/es.json`, `package.json` (`zxing-wasm@3.1.4` in dependencies).

- [ ] **Step 1: Headers test first.** Change the two pins to `camera=(self), microphone=(), geolocation=()` and rename the test "grants the camera to the app's own origin only (door scanner, V3-B); no microphone, no geolocation". Run → FAIL. Edit `SECURITY_HEADERS` and the comment ("Permissions-Policy grants `camera` to self only — the one consumer is the receiving-door scanner (components/receiving/ScanField.tsx); nothing else calls getUserMedia — and still denies microphone and geolocation"). Run → PASS.

- [ ] **Step 2: `ScanField.tsx`** (`"use client"`), props `{ vendorId: string; locationId: string; lineSkuIds: string[]; invoiceNumber: string | null; onMatch: (m: ScanMatch & { code: string }) => void; onUnknown: (code: string) => void; disabled: boolean }`:
  - Keyboard path: `useEffect` registers a document `keydown` listener (capture phase) when `!disabled`; feeds `ScanBurst` (`maxGapMs: 35, minLength: 6, silenceMs: 300`); on `"swallow"` → `e.preventDefault(); e.stopPropagation()`; a 50 ms interval calls `tick(performance.now())`; `{ scan }` → `lookup(code)`; `{ release }` → dispatch the released characters into `document.activeElement` if it is an input/textarea (set `value` via the native setter + `input` event) so a slow first keystroke is not lost. A small pill "Scanner ready" (`receiving.scan.ready`) renders while the listener is on.
  - Camera path: a 44 px "Scan" button (`receiving.scan.button`) opens a bottom sheet with `<video>`; `getUserMedia({ video: { facingMode: "environment" } })`; decoder = `"BarcodeDetector" in window ? new BarcodeDetector({ formats: ["ean_13","upc_a","code_128","itf","qr_code"] })` : `await import("zxing-wasm/reader")` → `readBarcodes(imageData, { formats: ["EAN-13","UPC-A","Code128","ITF","QRCode"] })`; a `requestAnimationFrame` loop samples a canvas every ~150 ms; decodes pass through `dedupeCameraDecode(1500)`; first accepted decode → `lookup(code)`; "Keep scanning" toggle (`receiving.scan.keep`) keeps the sheet open; closing stops all tracks. Camera errors → one sentence (`receiving.scan.camera_unavailable`), keyboard path unaffected.
  - `lookup(code)`: `POST /api/operations/receiving/scan/lookup { vendorId, locationId, code, lineSkuIds }` (the `postJson` helper the receiving form already uses, or `fetch` with the same headers — match `ReceivingForm`'s existing calls); 4 s timeout → treat as unknown with `receiving.scan.could_not_check`; result `kind === "unknown"` → `onUnknown(code)`, else `onMatch({...m, code})`. `ambiguous: true` → `onUnknown(code)` too (the picker, not an auto-open).
  - Unknown-code sheet (rendered by ScanField, fed by `ReceivingForm` through props `unknownOptions: { lines: {index, skuName}[]; onPickLine(i, level); onNotOnDelivery() }`): list of the delivery's lines, a case/inner toggle (default case), and "Not on this delivery" (`receiving.scan.not_on_delivery`) which calls `onNotOnDelivery()` → the form's existing add-line search.

- [ ] **Step 3: `ReceivingForm` wiring.** Mount `<ScanField>` above the line list when `vendorId` is set. `onMatch(m)`: find `i = lines.findIndex(l => l.skuId === m.skuId)`; if `< 0` and `m.kind !== "line"` → `setLines(ls => [...ls, offeredLine(skuById.get(m.skuId)!)])` then step that new line; step = `setLine(i, { expanded: true, level: levelLabelFor(m.skuId, m.level), qty: String((num(lines[i].qty) ?? 0) + 1) })` where `levelLabelFor(skuId, level)` = `level === "case" ? chainLabels[0] : chainLabels[1] ?? chainLabels[0]` (chain labels are root → leaf, `lib/receiving.ts:376`); `m.kind === "twin"` → a one-line inline confirm (`receiving.scan.twin_confirm` with `{sku}`) before stepping, then `teach` for the twin. `onUnknown(code)` → open the unknown sheet; picking a line → `teach({ vendorId, locationId, code, skuId, level, invoiceNumber })`, on 409 `level_differs` show `receiving.scan.level_confirm` ("Taught as {stored}. Also teach it as {level}?") → re-post with `confirmLevelChange: true`; then step the line. "…" menu on an expanded row gains "Forget this code" (`receiving.scan.forget`) when the row was reached by a scan this session (keep a `Map<lineKey, {code, level}>` in form state) → `POST …/scan/forget` → toast `receiving.scan.forgotten`. Teach failures: the line still steps; toast `receiving.scan.not_remembered`.

- [ ] **Step 4: i18n** (en / es): `receiving.scan.button` "Scan" / "Escanear" · `.ready` "Scanner ready" / "Escáner listo" · `.keep` "Keep scanning" / "Seguir escaneando" · `.close` "Close" / "Cerrar" · `.camera_unavailable` "Camera not available here — pick the line instead." / "La cámara no está disponible aquí: elige la línea." · `.could_not_check` "Couldn't check that code — pick the line." / "No pudimos verificar ese código: elige la línea." · `.unknown_title` "Which item is this?" / "¿Qué producto es?" · `.level_case` "Case" / "Caja" · `.level_inner` "Inner pack" / "Paquete interior" · `.not_on_delivery` "Not on this delivery" / "No está en esta entrega" · `.twin_confirm` "Taught on the other vendor's {sku}. Use this vendor's?" / "Enseñado en {sku} del otro proveedor. ¿Usar el de este proveedor?" · `.level_confirm` "Taught as {stored}. Also teach it as {level}?" / "Enseñado como {stored}. ¿Enseñarlo también como {level}?" · `.forget` "Forget this code" / "Olvidar este código" · `.forgotten` "Code forgotten" / "Código olvidado" · `.not_remembered` "Counted, but the code wasn't remembered (no connection)." / "Contado, pero el código no se guardó (sin conexión)." · `.taught` "Remembered for next time" / "Guardado para la próxima".

- [ ] **Step 5:** `npx vitest run tests/security-headers.test.ts` → PASS; `npx tsc --noEmit` clean; `npx eslint components/receiving lib/security-headers.ts` clean; `npx next build` once (the dynamic `zxing-wasm/reader` import must not break the build — if the package needs `serverExternalPackages` or an `optimizePackageImports` entry in `next.config.ts`, add it and say so).
- [ ] **Step 6: Commit** — `feat(receiving): Scan at the door — keyboard-wedge + camera into one field, teach-by-use, twin offer, forget; camera=(self) (V3-B §6)`.

---

### Task 6: Sim proof + PR

- [ ] Journey: in `scripts/sim/launch-readiness/journeys/ordering-receiving.spec.ts` after the first delivery is recorded, add `mark("receiving.scan.teach-then-hit")`: as the KH, `POST …/scan/teach { vendorId, locationId, code: "04006381333931", skuId: <first received SKU>, level: "case" }` → 200 `created: true`; `POST …/scan/lookup` with the same code and `lineSkuIds: []` → `kind: "sku"`, `level: "case"`; with `lineSkuIds: [thatSku]` → `kind: "line"`; teach again → `created: false`; teach `level: "inner"` → 409 `level_differs`, then with `confirmLevelChange: true` → 201/200; lookup → `levels: ["case","inner"]`; forget case → lookup → `levels: ["inner"]`. Add the claim `receiving.scan.teach-then-hit` to `claims.json` (guide sentence added to the manager guide's Receiving section: "Scan a case label to jump to its line — the first time, the app asks which item it is and remembers.") with the guide's revision + quote sha as V3-A did.
- [ ] Run: `SIM_PIN_TOMMY=6666 LRA_PROJECTS=phone-en ~/.claude/hooks/lra-launch.sh v3b-ordering ~/co-ops-astra -- bash ~/.claude/hooks/lra-suite.sh ~/co-ops-astra ordering cold-empty` (clone on the branch, `rm -rf .next-sim-launch/dev` first). Expected: browser 2/2; Node 17/18 (LRA-208 only).
- [ ] PR against main: what/why, spec + adjudication, the claim, the header change called out, the hardware note for Pete (any HID-mode Bluetooth scanner). **Stop at the PR.**

---

## Self-review

- **Spec coverage:** §3 table + soft delete + level key → T1; §4 normalise/resolve/counting → T2 (+T5 wiring); §5 routes/gate/idempotency/409/forget → T3, T4; §6 wedge burst, camera decoder, unknown sheet, header, i18n → T5; §7 errors (camera denied, wrong-SKU forget, offline) → T5; §8 tests → T2/T3/T4/T5/T6; §9 out-of-scope untouched; §10 rollout → T1/T6.
- **Placeholders:** none; the one open implementation detail (a `next.config.ts` entry for `zxing-wasm`) is flagged as a report-back, not a TBD.
- **Type consistency:** `ScanMatch` (T2) is what T3 returns, T4 passes through, and T5 consumes; `Level` / `Symbology` unions shared; `teachBarcode` input names match the route body names.
