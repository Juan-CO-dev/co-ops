# Cash Deposit Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-of-day Cash Deposit Confirmation module — projected vs register-count-to-$200 → derived over/short + deposit, cash tips, on-shift staff, PIN-signature — as a dedicated `cash_reports` record that auto-ticks the closing checklist.

**Architecture:** A purpose-built `cash_reports` table (append-only, KH+ RLS) instead of the checklist-item machinery. Server-authoritative money math (integer cents, recomputed at write). A `/cash` page with a count-mode toggle + live denomination counter, signed via a newly-built `/api/auth/pin-confirm`. Closing tie-in via the existing `reconcileClosingReportRefs` pull-reconcile.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase Postgres 17 (custom JWT/RLS), Supabase MCP `apply_migration`.

**Spec:** `docs/superpowers/specs/2026-06-16-cash-deposit-confirmation-design.md`

**Verification model (no unit-test framework):** each task ends with `npm run typecheck` + (where it builds UI) `npm run build`, plus a throwaway `tsx` smoke for logic tasks, then a commit. Smokes run via `npx tsx --env-file=.env.local scripts/<smoke>.ts` and clean up their own rows. Branch base: `main` **after PR #54 (button uniformity) merges** — the tile + form use `ActionButton`/`ActionLink`. If #54 is unmerged at build time, stack this branch on it.

**Money rule (the core, from spec §2):** `over_short_cents = register_count_cents − register_target_cents`; `deposit_cents = projected_cents + over_short_cents`. Negative over/short = short, positive = over. All money is integer **cents**.

**Prod project ref:** `bgcvurheqzylyfehqgzh`. Locations: MEP `54ce1029-400e-4a92-9c2b-0ccb3b031f0a`, EM `d2cced11-b167-49fa-bab6-86ec9bf4ff09`.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/NNNN_cash_reports.sql` | `cash_reports` table + partial unique index + RLS |
| `lib/cash.ts` | Types, constants, pure money math (`computeCashTotals`, `sumDenominations`), loaders, `submitCashReport` |
| `lib/i18n/format.ts` (modify) | Add `formatCents` |
| `lib/auth-flows.ts` (modify) | Add `verifyActorPin` shared helper |
| `app/api/auth/pin-confirm/route.ts` | POST PIN verify for the authenticated actor (reusable; wires `PinConfirmModal`) |
| `app/api/cash/route.ts` | POST submit/supersede a cash report (KH+ gate, PIN verify, server recompute) |
| `app/(authed)/cash/page.tsx` | Server loader → read-only view OR entry form |
| `app/(authed)/cash/cash-client.tsx` | Interactive form (count-mode toggle, totals, staff select, PIN-confirm submit) |
| `components/cash/DenominationCounter.tsx` | Bill/coin counter + live register-vs-$200 feedback |
| `components/CashDepositTile.tsx` | Dashboard tile |
| `app/(authed)/dashboard/page.tsx` (modify) | Load + render `CashDepositTile` |
| `lib/prep.ts` (modify) | `reconcileClosingReportRefs` 4th branch (cash) |
| `components/ReportReferenceItem.tsx` (modify) | `reportRoute('cash_report') → /cash` |
| `scripts/seed-closing-cash-ref.ts` | Seed the "Cash deposited" closing ref item |
| `lib/i18n/{en,es}.json` (modify) | `cash.*` keys |

---

## Task 1: Schema — `cash_reports` table + RLS

**Files:**
- Create: `supabase/migrations/0067_cash_reports.sql` (renumber to the next free number if 0067 is taken — check `supabase/migrations/` for the highest applied)
- Apply via: Supabase MCP `apply_migration` (name `cash_reports`)

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 0067_cash_reports
-- Applied via Supabase MCP apply_migration on <date>.
-- Canonical reference: lib/cash.ts; docs/.../2026-06-16-cash-deposit-confirmation-design.md
-- Cash Deposit Confirmation (Wave 2 #1) — dedicated financial record, append-only, KH+ RLS.

CREATE TABLE public.cash_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id           uuid NOT NULL REFERENCES public.locations(id),
  report_date           date NOT NULL,
  projected_cents       integer NOT NULL,
  register_count_cents  integer NOT NULL,
  register_target_cents integer NOT NULL DEFAULT 20000,
  count_method          text NOT NULL CHECK (count_method IN ('hand','denomination')),
  denominations         jsonb,
  cash_tips_cents       integer NOT NULL DEFAULT 0,
  on_shift              jsonb NOT NULL DEFAULT '[]'::jsonb,
  over_short_cents      integer NOT NULL,
  deposit_cents         integer NOT NULL,
  over_short_note       text,
  signed_by             uuid NOT NULL REFERENCES public.users(id),
  signed_at             timestamptz NOT NULL,
  entered_by            uuid NOT NULL REFERENCES public.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  superseded_by         uuid REFERENCES public.cash_reports(id)
);

-- One live report per location/day.
CREATE UNIQUE INDEX cash_reports_one_live_per_day
  ON public.cash_reports (location_id, report_date)
  WHERE superseded_at IS NULL;

CREATE INDEX cash_reports_location_date ON public.cash_reports (location_id, report_date);

ALTER TABLE public.cash_reports ENABLE ROW LEVEL SECURITY;

-- KH+ (level >= 4) at the location (level 7+ all-locations override via current_user_locations()).
CREATE POLICY cash_reports_read ON public.cash_reports FOR SELECT
  USING (public.current_user_role_level() >= 4 AND location_id = ANY (public.current_user_locations()));

CREATE POLICY cash_reports_insert ON public.cash_reports FOR INSERT
  WITH CHECK (public.current_user_role_level() >= 4 AND location_id = ANY (public.current_user_locations()));

-- Append-only: no end-user UPDATE/DELETE (supersede is service-role via the API).
CREATE POLICY cash_reports_no_user_update ON public.cash_reports FOR UPDATE USING (false);
CREATE POLICY cash_reports_no_user_delete ON public.cash_reports FOR DELETE USING (false);
```

> Note: `current_user_locations()` returns the caller's location ids (all-locations for 7+). Confirm its return shape with `\df current_user_locations` — if it returns `setof uuid` rather than `uuid[]`, use `location_id IN (SELECT public.current_user_locations())` instead of `= ANY(...)`. Verify before applying (confirm-before-authoring).

- [ ] **Step 2: Apply via MCP + capture the file**

Apply with `apply_migration` (name `cash_reports`, the SQL above). Save the same SQL to `supabase/migrations/0067_cash_reports.sql`.

- [ ] **Step 3: Verify the table + policies exist**

Run (MCP `execute_sql`):
```sql
select column_name, data_type from information_schema.columns where table_name='cash_reports' order by ordinal_position;
select policyname from pg_policies where tablename='cash_reports';
```
Expected: 19 columns; 4 policies (`cash_reports_read/insert/no_user_update/no_user_delete`).

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/0067_cash_reports.sql
git commit -m "feat(cash): cash_reports table + RLS (migration 0067)"
```

---

## Task 2: `lib/cash.ts` — types + pure money math

**Files:**
- Create: `lib/cash.ts`
- Create (smoke): `scripts/smoke-cash-totals.ts`

- [ ] **Step 1: Write the types + math**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";

/** KH+ — matches the closing-finalize gate (the closer deposits). */
export const CASH_REPORT_BASE_LEVEL = 4;
/** $200 float kept in the register. */
export const DEFAULT_REGISTER_TARGET_CENTS = 20000;

/** US denomination units in cents, largest first (bills then coins). */
export const DENOMINATION_UNITS_CENTS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1] as const;

/** unit_cents (as string key) → quantity. */
export type Denominations = Record<string, number>;
export interface OnShiftEntry { userId: string | null; name: string }
export interface CashActor { userId: string; role: RoleCode; level: number }

export interface CashTotals { overShortCents: number; depositCents: number }

/**
 * The one money rule (spec §2). over/short = register − target; deposit =
 * projected + over/short. Pure + total; the server recomputes with this at
 * write time and never trusts client-sent totals.
 */
export function computeCashTotals(input: {
  projectedCents: number;
  registerCountCents: number;
  registerTargetCents: number;
}): CashTotals {
  const overShortCents = input.registerCountCents - input.registerTargetCents;
  const depositCents = input.projectedCents + overShortCents;
  return { overShortCents, depositCents };
}

/** Sum a denomination map to cents. Ignores non-positive / unknown-unit entries. */
export function sumDenominations(denoms: Denominations): number {
  let total = 0;
  for (const unit of DENOMINATION_UNITS_CENTS) {
    const qty = denoms[String(unit)];
    if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
      total += unit * Math.floor(qty);
    }
  }
  return total;
}

export interface CashReport {
  id: string;
  locationId: string;
  reportDate: string;
  projectedCents: number;
  registerCountCents: number;
  registerTargetCents: number;
  countMethod: "hand" | "denomination";
  denominations: Denominations | null;
  cashTipsCents: number;
  onShift: OnShiftEntry[];
  overShortCents: number;
  depositCents: number;
  overShortNote: string | null;
  signedBy: string;
  signedByName: string | null; // resolved by loader
  signedAt: string;
  createdAt: string;
}
```

- [ ] **Step 2: Write the smoke**

```ts
// scripts/smoke-cash-totals.ts
import { computeCashTotals, sumDenominations } from "../lib/cash";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  ✓ ${label}`);
  else { fail++; console.error(`  ✗ ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// Spec §2 worked examples (projected $500 = 50000c, target $200 = 20000c)
eq("short: register 19000 → over/short -1000, deposit 49000",
  computeCashTotals({ projectedCents: 50000, registerCountCents: 19000, registerTargetCents: 20000 }),
  { overShortCents: -1000, depositCents: 49000 });
eq("over: register 21500 → over/short +1500, deposit 51500",
  computeCashTotals({ projectedCents: 50000, registerCountCents: 21500, registerTargetCents: 20000 }),
  { overShortCents: 1500, depositCents: 51500 });
eq("even: register 20000 → over/short 0, deposit 50000",
  computeCashTotals({ projectedCents: 50000, registerCountCents: 20000, registerTargetCents: 20000 }),
  { overShortCents: 0, depositCents: 50000 });
// denominations: 6×$20 + 8×$10 + 12×$0.25 = 12000 + 8000 + 300 = 20300
eq("sumDenominations", sumDenominations({ "2000": 6, "1000": 8, "25": 12 }), 20300);
eq("sumDenominations ignores junk", sumDenominations({ "2000": 6, "999": 9, "10": -3 }), 12000);

console.log(fail === 0 ? "\n✅ PASS" : `\n❌ ${fail} FAILED`);
process.exitCode = fail === 0 ? 0 : 1;
```

- [ ] **Step 3: Run the smoke + typecheck**

Run: `npx tsx --env-file=.env.local scripts/smoke-cash-totals.ts` → Expected: `✅ PASS`
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 4: Commit** (keep the smoke untracked or delete it — throwaway)
```bash
rm scripts/smoke-cash-totals.ts
git add lib/cash.ts
git commit -m "feat(cash): types + money math (computeCashTotals, sumDenominations)"
```

---

## Task 3: `formatCents` helper

**Files:**
- Modify: `lib/i18n/format.ts`

- [ ] **Step 1: Add the helper** (mirror the existing `formatTime(iso, language)` signature/locale convention in that file)

```ts
/**
 * Integer cents → localized currency string. Mirrors the language-locale
 * convention of formatTime/formatDateLabel (es → es-US, else en-US). Always
 * 2 decimals; negative renders with a leading minus (caller decides
 * short/over framing).
 */
export function formatCents(cents: number, language: Language): string {
  return new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
```
(`Language` is already imported in this file — confirm; if not, add `import type { Language } from "@/lib/i18n/types";`.)

- [ ] **Step 2: Typecheck** → `npm run typecheck` clean.
- [ ] **Step 3: Commit**
```bash
git add lib/i18n/format.ts
git commit -m "feat(i18n): formatCents currency helper"
```

---

## Task 4: PIN-confirm endpoint + shared verify helper

**Files:**
- Modify: `lib/auth-flows.ts` (add `verifyActorPin`)
- Create: `app/api/auth/pin-confirm/route.ts`

Read first (confirm-before-authoring): `lib/auth.ts` for the PIN-verify primitive (the PIN login route uses it — find the `verifyPin`/`bcrypt`-style call and the `users.pin_hash` column), and `app/api/auth/pin/route.ts` for the established shape. `verifyActorPin` must reuse the SAME primitive.

- [ ] **Step 1: Add `verifyActorPin` to `lib/auth-flows.ts`**

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { verifyPin } from "@/lib/auth"; // confirm the exact export name in lib/auth.ts

/**
 * Verifies a PIN against the given user's pin_hash. Used by /api/auth/pin-confirm
 * and the cash deposit signature gate. NO lockout — the actor is already
 * authenticated (mirrors the step-up modal philosophy, AGENTS.md). Returns true
 * on match.
 */
export async function verifyActorPin(userId: string, pin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false; // 4-digit PINs (lib/roles minPinLength)
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("users").select("pin_hash").eq("id", userId).maybeSingle<{ pin_hash: string | null }>();
  if (error || !data?.pin_hash) return false;
  return verifyPin(pin, data.pin_hash);
}
```

- [ ] **Step 2: Create the route** (mirror `app/api/auth/step-up/route.ts` shape; Node runtime)

```ts
import { type NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { verifyActorPin } from "@/lib/auth-flows";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { extractIp } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/auth/pin-confirm");
  if (ctx instanceof Response) return ctx;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const pin = (parsed as { pin?: unknown }).pin;
  if (typeof pin !== "string") return jsonError(400, "invalid_payload", { message: "pin required", field: "pin" });

  const ok = await verifyActorPin(ctx.user.id, pin);
  void audit({
    actorId: ctx.user.id, actorRole: ctx.role,
    action: ok ? "auth_pin_confirm_success" : "auth_pin_confirm_failure",
    resourceTable: "users", resourceId: ctx.user.id,
    metadata: { outcome: ok ? "confirmed" : "wrong_pin" },
    ipAddress: extractIp(req), userAgent: req.headers.get("user-agent"),
  });
  if (!ok) return jsonError(401, "pin_invalid", { message: "Incorrect PIN." });
  return jsonOk({ confirmed: true });
}
```
Add `auth_pin_confirm_success`/`auth_pin_confirm_failure` to the auth audit vocabulary note in AGENTS.md (non-destructive; do NOT add to `DESTRUCTIVE_ACTIONS`).

- [ ] **Step 3: Verify** → `npm run typecheck` clean; `npm run build` clean (new route registers).
- [ ] **Step 4: Smoke** (script: sign in path not needed — directly test the helper):
```ts
// scripts/smoke-pin-confirm.ts — verifyActorPin against the seed cgs user is impractical
// (real pin_hash unknown). Instead assert shape-guards:
import { verifyActorPin } from "../lib/auth-flows";
(async () => {
  const bad = await verifyActorPin("00000000-0000-0000-0000-000000000000", "12"); // non-4-digit
  console.log(bad === false ? "✅ guards non-4-digit + unknown user" : "❌");
  process.exitCode = bad === false ? 0 : 1;
})();
```
Run it, expect ✅, then `rm` it.

- [ ] **Step 5: Commit**
```bash
git add lib/auth-flows.ts app/api/auth/pin-confirm/route.ts AGENTS.md
git commit -m "feat(auth): /api/auth/pin-confirm + verifyActorPin (no lockout, authed actor)"
```

---

## Task 5: `lib/cash.ts` — loaders + `submitCashReport`

**Files:**
- Modify: `lib/cash.ts`

Read first: `lib/prep.ts` `loadMidDayPrepDashboardState` (the dashboard-state loader pattern + name resolution) and `finalizeMidDayPhase2` (audit + append-only supersede pattern).

- [ ] **Step 1: Add loaders + submit**

```ts
import { audit } from "@/lib/audit";

const ROW = "id, location_id, report_date, projected_cents, register_count_cents, register_target_cents, count_method, denominations, cash_tips_cents, on_shift, over_short_cents, deposit_cents, over_short_note, signed_by, signed_at, created_at";

function rowToCashReport(r: Record<string, unknown>, signedByName: string | null): CashReport {
  return {
    id: r.id as string, locationId: r.location_id as string, reportDate: r.report_date as string,
    projectedCents: r.projected_cents as number, registerCountCents: r.register_count_cents as number,
    registerTargetCents: r.register_target_cents as number, countMethod: r.count_method as "hand" | "denomination",
    denominations: (r.denominations as Denominations | null) ?? null, cashTipsCents: r.cash_tips_cents as number,
    onShift: (r.on_shift as OnShiftEntry[]) ?? [], overShortCents: r.over_short_cents as number,
    depositCents: r.deposit_cents as number, overShortNote: (r.over_short_note as string | null) ?? null,
    signedBy: r.signed_by as string, signedByName, signedAt: r.signed_at as string, createdAt: r.created_at as string,
  };
}

/** The live cash report for a location/day, or null. */
export async function loadCashReport(
  service: SupabaseClient, args: { locationId: string; date: string },
): Promise<CashReport | null> {
  const { data, error } = await service.from("cash_reports").select(ROW)
    .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
    .maybeSingle<Record<string, unknown>>();
  if (error) throw new Error(`loadCashReport: ${error.message}`);
  if (!data) return null;
  let name: string | null = null;
  if (data.signed_by) {
    const { data: u } = await service.from("users").select("name").eq("id", data.signed_by).maybeSingle<{ name: string }>();
    name = u?.name ?? null;
  }
  return rowToCashReport(data, name);
}

export interface CashDashboardState { isVisibleToActor: boolean; report: CashReport | null }

export async function loadCashDashboardState(
  service: SupabaseClient, args: { locationId: string; date: string; actor: CashActor },
): Promise<CashDashboardState> {
  if (args.actor.level < CASH_REPORT_BASE_LEVEL) return { isVisibleToActor: false, report: null };
  return { isVisibleToActor: true, report: await loadCashReport(service, args) };
}

export type CashSubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "pin_invalid" | "closing_finalized" };

/**
 * Append-only signed write. Recomputes totals server-side (never trusts the
 * client). Supersedes the prior live row (edit). Refuses if today's closing is
 * already finalized (edit window closed, spec §9). PIN already verified by the
 * route via verifyActorPin; `signedBy` is the authenticated actor.
 */
export async function submitCashReport(
  service: SupabaseClient,
  args: {
    locationId: string; date: string; actor: CashActor;
    projectedCents: number; registerCountCents: number; registerTargetCents: number;
    countMethod: "hand" | "denomination"; denominations: Denominations | null;
    cashTipsCents: number; onShift: OnShiftEntry[]; overShortNote: string | null;
  },
): Promise<CashSubmitResult> {
  // Edit-window gate: refuse if today's closing is confirmed (spec §9).
  const { data: cTmpl } = await service.from("checklist_templates").select("id")
    .eq("location_id", args.locationId).eq("type", "closing").eq("active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (cTmpl) {
    const { data: cInst } = await service.from("checklist_instances").select("status")
      .eq("template_id", cTmpl.id).eq("location_id", args.locationId).eq("date", args.date)
      .maybeSingle<{ status: string }>();
    if (cInst && (cInst.status === "confirmed" || cInst.status === "incomplete_confirmed")) {
      return { ok: false, reason: "closing_finalized" };
    }
  }

  const { overShortCents, depositCents } = computeCashTotals(args);
  const nowIso = new Date().toISOString();

  // Find prior live row (edit → supersede).
  const { data: prior } = await service.from("cash_reports").select("id")
    .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
    .maybeSingle<{ id: string }>();

  const { data: inserted, error: insErr } = await service.from("cash_reports").insert({
    location_id: args.locationId, report_date: args.date,
    projected_cents: args.projectedCents, register_count_cents: args.registerCountCents,
    register_target_cents: args.registerTargetCents, count_method: args.countMethod,
    denominations: args.countMethod === "denomination" ? args.denominations : null,
    cash_tips_cents: args.cashTipsCents, on_shift: args.onShift,
    over_short_cents: overShortCents, deposit_cents: depositCents,
    over_short_note: args.overShortNote, signed_by: args.actor.userId, signed_at: nowIso,
    entered_by: args.actor.userId,
  }).select("id").single<{ id: string }>();
  if (insErr) throw new Error(`submitCashReport: insert: ${insErr.message}`);

  if (prior) {
    await service.from("cash_reports").update({ superseded_at: nowIso, superseded_by: inserted.id }).eq("id", prior.id);
  }

  void audit({
    actorId: args.actor.userId, actorRole: args.actor.role,
    action: prior ? "cash_report.supersede" : "cash_report.submit",
    resourceTable: "cash_reports", resourceId: inserted.id,
    metadata: { over_short_cents: overShortCents, deposit_cents: depositCents, superseded: prior?.id ?? null },
    ipAddress: null, userAgent: null,
  });
  return { ok: true, id: inserted.id };
}
```
Add `cash_report.submit` + `cash_report.supersede` to the audit vocabulary (NOT destructive).

- [ ] **Step 2: Typecheck** → clean.
- [ ] **Step 3: Smoke** (the heart — append-only + recompute + edit-window):
```ts
// scripts/smoke-cash-submit.ts
import { getServiceRoleClient } from "../lib/supabase-server";
import { loadCashReport, submitCashReport } from "../lib/cash";
const sb = getServiceRoleClient();
const LOC = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a"; const DATE = "2099-07-10";
let fail = 0; const ck = (l: string, c: boolean, d?: unknown) => { if (c) console.log(`  ✓ ${l}`); else { fail++; console.error(`  ✗ ${l}`, d); } };
async function clean() { await sb.from("cash_reports").delete().eq("location_id", LOC).eq("report_date", DATE); }
(async () => {
  await clean();
  const { data: u } = await sb.from("users").select("id, name").eq("active", true).limit(1).single<{ id: string; name: string }>();
  const actor = { userId: u!.id, role: "cgs" as const, level: 8 };
  const base = { locationId: LOC, date: DATE, actor, projectedCents: 50000, registerTargetCents: 20000, countMethod: "hand" as const, denominations: null, cashTipsCents: 4200, onShift: [{ userId: u!.id, name: u!.name }, { userId: null, name: "Dee" }], overShortNote: null };
  const r1 = await submitCashReport(sb, { ...base, registerCountCents: 19000 });
  ck("submit ok", r1.ok === true, r1);
  const live1 = await loadCashReport(sb, { locationId: LOC, date: DATE });
  ck("server recompute: over/short -1000, deposit 49000", live1?.overShortCents === -1000 && live1?.depositCents === 49000, live1);
  ck("signedByName resolved", live1?.signedByName === u!.name, live1?.signedByName);
  const r2 = await submitCashReport(sb, { ...base, registerCountCents: 21500 }); // edit → supersede
  ck("edit ok", r2.ok === true, r2);
  const live2 = await loadCashReport(sb, { locationId: LOC, date: DATE });
  ck("one live row after edit, new totals", live2?.overShortCents === 1500 && live2?.depositCents === 51500, live2);
  const { count } = await sb.from("cash_reports").select("id", { count: "exact", head: true }).eq("location_id", LOC).eq("report_date", DATE).is("superseded_at", null);
  ck("exactly 1 live row", count === 1, count);
  await clean();
  console.log(fail === 0 ? "\n✅ PASS" : `\n❌ ${fail} FAILED`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
```
Run, expect ✅, then `rm`.

- [ ] **Step 4: Commit**
```bash
git add lib/cash.ts AGENTS.md
git commit -m "feat(cash): loaders + append-only signed submitCashReport (server recompute, edit-window)"
```

---

## Task 6: `/api/cash` route

**Files:**
- Create: `app/api/cash/route.ts`

Mirror `app/api/prep/mid-day/route.ts` (auth → validate → location gate → KH+ gate → service call → map result).

- [ ] **Step 1: Write the route**

```ts
import { type NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { verifyActorPin } from "@/lib/auth-flows";
import { CASH_REPORT_BASE_LEVEL, DENOMINATION_UNITS_CENTS, sumDenominations, submitCashReport, type Denominations, type OnShiftEntry } from "@/lib/cash";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/cash");
  if (ctx instanceof Response) return ctx;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const b = raw as Record<string, unknown>;

  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.date !== "string" || !DATE_RE.test(b.date)) return jsonError(400, "invalid_payload", { field: "date" });
  if (typeof b.pin !== "string") return jsonError(400, "invalid_payload", { field: "pin" });
  if (!isCents(b.projectedCents)) return jsonError(400, "invalid_payload", { field: "projectedCents" });
  if (!isCents(b.cashTipsCents)) return jsonError(400, "invalid_payload", { field: "cashTipsCents" });
  if (b.countMethod !== "hand" && b.countMethod !== "denomination") return jsonError(400, "invalid_payload", { field: "countMethod" });

  // Derive register_count: denomination → sum; hand → registerCountCents directly.
  let registerCountCents: number;
  let denominations: Denominations | null = null;
  if (b.countMethod === "denomination") {
    const d = b.denominations as Denominations | undefined;
    if (!d || typeof d !== "object") return jsonError(400, "invalid_payload", { field: "denominations" });
    // keep only valid units
    denominations = {};
    for (const unit of DENOMINATION_UNITS_CENTS) {
      const q = d[String(unit)];
      if (typeof q === "number" && Number.isInteger(q) && q > 0) denominations[String(unit)] = q;
    }
    registerCountCents = sumDenominations(denominations);
  } else {
    if (!isCents(b.registerCountCents)) return jsonError(400, "invalid_payload", { field: "registerCountCents" });
    registerCountCents = b.registerCountCents;
  }
  const registerTargetCents = isCents(b.registerTargetCents) ? (b.registerTargetCents as number) : 20000;
  const onShift = Array.isArray(b.onShift)
    ? (b.onShift as unknown[]).filter((e): e is OnShiftEntry => typeof e === "object" && e !== null && typeof (e as OnShiftEntry).name === "string")
    : [];
  const overShortNote = typeof b.overShortNote === "string" && b.overShortNote.trim() ? b.overShortNote.trim() : null;

  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, b.locationId)) {
    return jsonError(403, "location_access_denied", { location_id: b.locationId });
  }
  if (ctx.level < CASH_REPORT_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", { required_level: CASH_REPORT_BASE_LEVEL });
  }

  // PIN signature gate.
  if (!(await verifyActorPin(ctx.user.id, b.pin))) {
    return jsonError(401, "pin_invalid", { message: "Incorrect PIN." });
  }

  const service = getServiceRoleClient();
  try {
    const result = await submitCashReport(service, {
      locationId: b.locationId, date: b.date,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      projectedCents: b.projectedCents, registerCountCents, registerTargetCents,
      countMethod: b.countMethod, denominations, cashTipsCents: b.cashTipsCents, onShift, overShortNote,
    });
    if (!result.ok && result.reason === "closing_finalized") {
      return jsonError(409, "closing_finalized", { message: "Today's closing is finalized — the cash deposit is locked." });
    }
    if (!result.ok) return jsonError(400, result.reason, {});
    return jsonOk({ id: result.id });
  } catch (err) {
    console.error("[/api/cash] failed:", err instanceof Error ? err.message : err);
    return jsonError(500, "internal_error", { message: "cash report write failed" });
  }
}
```

- [ ] **Step 2: Verify** → `npm run typecheck` + `npm run build` clean.
- [ ] **Step 3: Commit**
```bash
git add app/api/cash/route.ts
git commit -m "feat(cash): POST /api/cash (KH+ gate, PIN signature, server recompute)"
```

---

## Task 7: i18n `cash.*` keys

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Add keys to BOTH files** (flat dot-keys; place after the `dashboard.mid_day_prep.*` block). Spanish is operational/tú-form. Keys (provide values in both):
```
cash.tile_label                = "Cash Deposit" / "Depósito de efectivo"
cash.status.not_started        = "Not started today" / "No iniciado hoy"
cash.status.finalized_by       = "Deposited at {time} by {name}" / "Depositado a las {time} por {name}"
cash.cta.start                 = "Start cash deposit" / "Iniciar depósito"
cash.cta.view                  = "View cash deposit" / "Ver depósito"
cash.cta.edit                  = "Edit cash deposit" / "Editar depósito"
cash.page.title                = "Cash Deposit" / "Depósito de efectivo"
cash.section.cash              = "Cash" / "Efectivo"
cash.section.tips              = "Tips" / "Propinas"
cash.section.on_shift          = "On shift today" / "En turno hoy"
cash.field.projected           = "Projected (from Toast)" / "Proyectado (de Toast)"
cash.field.register_count      = "Register count" / "Conteo de la caja"
cash.field.cash_tips           = "Cash tips" / "Propinas en efectivo"
cash.field.over_short_note     = "Over/short note (optional)" / "Nota de sobra/falta (opcional)"
cash.count.toggle_hand         = "Enter total" / "Ingresar total"
cash.count.toggle_denomination = "Count by denomination" / "Contar por billete"
cash.count.register_ok         = "Register at {target} ✓" / "Caja en {target} ✓"
cash.count.register_off        = "Register {amount} — {delta} {dir}" / "Caja {amount} — {delta} {dir}"
cash.readout.deposit           = "Deposit {amount}" / "Depósito {amount}"
cash.readout.over              = "{amount} over" / "{amount} de sobra"
cash.readout.short             = "{amount} short" / "{amount} de falta"
cash.readout.even              = "Even" / "Exacto"
cash.staff.add_placeholder     = "Add a name (not a user)" / "Agregar un nombre (no usuario)"
cash.submit.button             = "Sign & submit deposit" / "Firmar y enviar depósito"
cash.submit.submitting         = "Submitting…" / "Enviando…"
cash.error.pin_invalid         = "Incorrect PIN." / "PIN incorrecto."
cash.error.closing_finalized   = "Today's closing is finalized — the deposit is locked." / "El cierre de hoy está finalizado — el depósito está bloqueado."
cash.error.generic             = "Could not submit. Try again." / "No se pudo enviar. Intenta de nuevo."
cash.denomination.label        = "{label}" (e.g. "$20", "25¢")  // build labels in-component from DENOMINATION_UNITS_CENTS
cash.read_only.banner          = "Deposited {amount} · signed by {name} at {time}" / "Depositado {amount} · firmado por {name} a las {time}"
```

- [ ] **Step 2: Verify** → `npm run typecheck` (TranslationKey type auto-derives from JSON; new keys must parse). `npm run build` clean.
- [ ] **Step 3: Commit**
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(i18n): cash.* keys (en + es)"
```

---

## Task 8: `DenominationCounter` component

**Files:**
- Create: `components/cash/DenominationCounter.tsx`

A client component: one numeric input per unit in `DENOMINATION_UNITS_CENTS`, live sum via `sumDenominations`, and a register-vs-target indicator. Mirror the input styling of `MidDayPhase1Form` (the `h-10 w-24 rounded-md border-2` inputs). Build bill/coin labels from cents (`>=100 → "$" + cents/100`; `<100 → cents + "¢"`).

- [ ] **Step 1: Write it**

```tsx
"use client";
import { DENOMINATION_UNITS_CENTS, sumDenominations, type Denominations } from "@/lib/cash";
import { formatCents } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";

function unitLabel(cents: number): string {
  return cents >= 100 ? `$${cents / 100}` : `${cents}¢`;
}

export function DenominationCounter({
  value, onChange, targetCents, language,
}: {
  value: Denominations;
  onChange: (next: Denominations) => void;
  targetCents: number;
  language: import("@/lib/i18n/types").Language;
}) {
  const { t } = useTranslation();
  const total = sumDenominations(value);
  const delta = total - targetCents;
  const atTarget = delta === 0;
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DENOMINATION_UNITS_CENTS.map((unit) => (
          <li key={unit} className="flex items-center justify-between gap-2 rounded-md border-2 border-co-border bg-co-surface px-3 py-2">
            <span className="text-sm font-bold text-co-text">{unitLabel(unit)}</span>
            <input
              type="number" inputMode="numeric" min={0}
              value={value[String(unit)] ?? ""}
              onChange={(e) => {
                const q = e.target.value.trim() === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value)));
                const next = { ...value };
                if (q && Number.isFinite(q)) next[String(unit)] = q; else delete next[String(unit)];
                onChange(next);
              }}
              aria-label={unitLabel(unit)}
              className="h-10 w-16 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
          </li>
        ))}
      </ul>
      <p className={`text-sm font-bold ${atTarget ? "text-co-success" : "text-co-cta"}`}>
        {atTarget
          ? t("cash.count.register_ok", { target: formatCents(targetCents, language) })
          : t("cash.count.register_off", {
              amount: formatCents(total, language),
              delta: formatCents(Math.abs(delta), language),
              dir: delta > 0 ? t("cash.readout.over", { amount: "" }).trim() : t("cash.readout.short", { amount: "" }).trim(),
            })}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify** → `npm run typecheck` + `npm run build` clean.
- [ ] **Step 3: Commit**
```bash
git add components/cash/DenominationCounter.tsx
git commit -m "feat(cash): DenominationCounter with live register-vs-target"
```

---

## Task 9: `cash-client.tsx` — the entry form

**Files:**
- Create: `app/(authed)/cash/cash-client.tsx`

Read first: `components/auth/PinConfirmModal.tsx` (wire its submit to `onConfirm(pin)` — currently a TODO stub) and `app/(authed)/operations/am-prep/page.tsx` for the read-only/edit page pattern. Use `ActionButton` (from PR #54) for the submit. Form holds: projected (dollars input → cents), count-mode toggle, hand-total OR `DenominationCounter`, cash tips, on-shift multi-select (passed `users: {id,name}[]` from the page) + free-text add, over/short note. Live totals via `computeCashTotals`. Submit opens `PinConfirmModal`; on PIN entered, POST `/api/cash` with the pin + payload.

- [ ] **Step 1: Write the component.** Key logic (full state + submit; JSX structure mirrors MidDayPhase1Form sections + AmPrepTile read-only treatment):

```tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeCashTotals, DEFAULT_REGISTER_TARGET_CENTS, sumDenominations, type Denominations, type OnShiftEntry } from "@/lib/cash";
import { formatCents } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { ActionButton } from "@/components/ActionButton";
import { PinConfirmModal } from "@/components/auth/PinConfirmModal";
import { DenominationCounter } from "@/components/cash/DenominationCounter";

const toCents = (dollars: string): number => {
  const n = Number(dollars.trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};

export function CashClient({ locationId, date, users, language }: {
  locationId: string; date: string; users: { id: string; name: string }[]; language: Language;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [projected, setProjected] = useState("");
  const [mode, setMode] = useState<"hand" | "denomination">("hand");
  const [handTotal, setHandTotal] = useState("");
  const [denoms, setDenoms] = useState<Denominations>({});
  const [tips, setTips] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registerCountCents = mode === "denomination" ? sumDenominations(denoms) : toCents(handTotal);
  const projectedCents = toCents(projected);
  const { overShortCents, depositCents } = useMemo(
    () => computeCashTotals({ projectedCents, registerCountCents, registerTargetCents: DEFAULT_REGISTER_TARGET_CENTS }),
    [projectedCents, registerCountCents],
  );

  const onShift: OnShiftEntry[] = [
    ...users.filter((u) => picked.has(u.id)).map((u) => ({ userId: u.id, name: u.name })),
    ...extraNames.filter((n) => n.trim()).map((n) => ({ userId: null, name: n.trim() })),
  ];

  const submit = async (pin: string) => {
    setSubmitting(true); setError(null);
    try {
      const res = await fetch("/api/cash", {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "manual",
        body: JSON.stringify({
          locationId, date, pin, projectedCents,
          countMethod: mode, registerCountCents: mode === "hand" ? registerCountCents : undefined,
          denominations: mode === "denomination" ? denoms : undefined,
          registerTargetCents: DEFAULT_REGISTER_TARGET_CENTS, cashTipsCents: toCents(tips),
          onShift, overShortNote: note.trim() || null,
        }),
      });
      if (res.ok) { setPinOpen(false); router.refresh(); return; }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(t(`cash.error.${body.error === "pin_invalid" ? "pin_invalid" : body.error === "closing_finalized" ? "closing_finalized" : "generic"}` as never));
      setSubmitting(false);
    } catch { setError(t("cash.error.generic")); setSubmitting(false); }
  };

  // JSX: section "Cash" (projected $ input; toggle hand/denomination; hand total input OR <DenominationCounter
  // value={denoms} onChange={setDenoms} targetCents={DEFAULT_REGISTER_TARGET_CENTS} language={language} />;
  // live readout: formatCents(depositCents) + over/short colored via overShortCents sign + note input).
  // section "Tips" (tips $ input). section "On shift" (checkbox list of users → toggle picked; extraNames
  // add/remove free-text rows). Submit: <ActionButton size="lg" className="w-full" onClick={() => setPinOpen(true)}
  // disabled={submitting}>{t("cash.submit.button")}</ActionButton>. <PinConfirmModal open={pinOpen}
  // onConfirm={(pin) => submit(pin)} onCancel={() => setPinOpen(false)} /> and {error && <p className="text-co-cta">…</p>}.
  return null; // replace with the JSX described above, mirroring MidDayPhase1Form's section/list styling
}
```

> The JSX body is described in the comment block precisely (every field + handler is defined above). Mirror `MidDayPhase1Form` section/list classes and `AmPrepTile`'s read-only treatment. **Wire `PinConfirmModal`**: change its submit handler (currently the AGENTS-noted TODO stub) to call a new `onConfirm: (pin: string) => void` prop instead of the stubbed fetch; pass the entered PIN up. Keep its existing overlay/focus-trap shell.

- [ ] **Step 2: Verify** → `npm run typecheck` + `npm run build` clean.
- [ ] **Step 3: Commit**
```bash
git add app/(authed)/cash/cash-client.tsx components/auth/PinConfirmModal.tsx
git commit -m "feat(cash): entry form client + wire PinConfirmModal onConfirm"
```

---

## Task 10: `cash/page.tsx` — loader + read-only/entry branch

**Files:**
- Create: `app/(authed)/cash/page.tsx` (replaces the `/cash` PlaceholderCard stub — confirm the stub route file path; it may be `app/(authed)/cash/page.tsx` already as a stub to overwrite)

Mirror `app/(authed)/operations/mid-day/page.tsx`: auth, NY date, location resolve + `lockLocationContext`, KH+ gate, load `loadCashReport`. If a live report exists → read-only banner + recorded values (use `cash.read_only.banner` + `formatCents`); else → load the location's active KH+/all users for the staff picker and render `<CashClient>`.

- [ ] **Step 1: Write the page.** Use `requireSessionFromHeaders("/cash")`, `getServiceRoleClient()`, the `nyDateString` helper (copy from the mid-day page), `lockLocationContext`. Staff list: `sb.from("users").select("id,name").eq("active",true)` joined to `user_locations` for the location (mirror `loadAgmPlusManagers` two-step in the mid-day page, but all active users at the location, not just AGM+). Read-only branch renders recorded `projected/register/over-short/deposit/tips/on_shift/signed_by name+time`. Gate: `if (auth.level < CASH_REPORT_BASE_LEVEL) redirect("/dashboard")`.

- [ ] **Step 2: Verify** → `npm run typecheck` + `npm run build` clean (watch for the `useSearchParams`/Suspense prerender rule if you read search params in a client child — the page is a Server Component reading `searchParams` prop, so it's fine).
- [ ] **Step 3: Commit**
```bash
git add "app/(authed)/cash/page.tsx"
git commit -m "feat(cash): /cash page (read-only view / entry form, KH+ gate)"
```

---

## Task 11: `CashDepositTile` + dashboard wiring

**Files:**
- Create: `components/CashDepositTile.tsx`
- Modify: `app/(authed)/dashboard/page.tsx`

Mirror `OpeningTile` (post-PR-#54: uses `ActionLink`, shows "Finalized at {time} by {name}").

- [ ] **Step 1: Write `CashDepositTile`**

```tsx
import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { ActionLink } from "./ActionButton";

export function CashDepositTile({ locationId, report, language }: {
  locationId: string;
  report: { signedAt: string; signedByName: string | null } | null;
  language: Language;
}) {
  const statusLine = report
    ? serverT(language, "cash.status.finalized_by", { time: formatTime(report.signedAt, language), name: report.signedByName ?? "—" })
    : serverT(language, "cash.status.not_started");
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-co-text-dim">{serverT(language, "cash.tile_label")}</p>
      <p className="mt-1 text-sm font-semibold text-co-text">{statusLine}</p>
      <div className="mt-3">
        <ActionLink href={`/cash?location=${locationId}`} className="w-full sm:w-auto">
          {serverT(language, report ? "cash.cta.view" : "cash.cta.start")}
        </ActionLink>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the dashboard** (`app/(authed)/dashboard/page.tsx`): import `loadCashDashboardState` from `@/lib/cash` + `CashDepositTile`; after the mid-day load, add:
```ts
const cashDashboard = selectedLocation && operational
  ? await loadCashDashboardState(sb, { locationId: selectedLocation.id, date: operational.todayDate, actor: { userId: auth.user.id, role: auth.role, level: auth.level } })
  : null;
```
Add `cashDashboard?.isVisibleToActor` to the Reports-section visibility predicate, and render `{cashDashboard?.isVisibleToActor ? <CashDepositTile locationId={selectedLocation.id} report={cashDashboard.report} language={language} /> : null}` after the mid-day tile.

- [ ] **Step 3: Verify** → `npm run typecheck` + `npm run build` clean.
- [ ] **Step 4: Commit**
```bash
git add components/CashDepositTile.tsx "app/(authed)/dashboard/page.tsx"
git commit -m "feat(cash): dashboard CashDepositTile + wiring"
```

---

## Task 12: Closing tie-in — reconcile branch + route + seed ref item

**Files:**
- Modify: `lib/prep.ts` (`reconcileClosingReportRefs`)
- Modify: `components/ReportReferenceItem.tsx` (`reportRoute`)
- Create: `scripts/seed-closing-cash-ref.ts`

- [ ] **Step 1: Add the 4th reconcile branch** in `reconcileClosingReportRefs` (after the mid-day branch), reading the live cash report:
```ts
  // ── Cash deposit (same-day; done = a live cash_report exists) ──
  const cashRefId = await resolveClosingReportRefItemId(service, { locationId: args.locationId, reportType: "cash_report" });
  if (cashRefId) {
    const { data: cash, error: cashErr } = await service.from("cash_reports").select("id, signed_at")
      .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
      .maybeSingle<{ id: string; signed_at: string }>();
    if (cashErr) throw new Error(`reconcileClosingReportRefs: cash: ${cashErr.message}`);
    if (cash) {
      bump(await ensureClosingRefCompletion(service, {
        closingInstanceId: args.closingInstanceId, refItemId: cashRefId, actor: args.actor,
        meta: { reportType: "cash_report", reportInstanceId: cash.id, reportSubmittedAt: cash.signed_at },
      }));
    }
  }
```

- [ ] **Step 2: `reportRoute('cash_report')`** in `ReportReferenceItem.tsx`:
```ts
    case "cash_report":
      return "/cash";
```

- [ ] **Step 3: Seed the "Cash deposited" closing ref item** — write `scripts/seed-closing-cash-ref.ts` that, for each active closing template (MEP + EM), inserts (if absent) a `checklist_template_items` row with `report_reference_type='cash_report'`, an appropriate `label` ("Cash deposited") + ES translation in `translations.es.label`, `station` = the closing-manager station (match the existing opening/am-prep/mid-day ref items' station — query one to copy), `required=true`, `active=true`, next `display_order`. Mirror `scripts/seed-mid-day-prep-template.ts` audit-emission + `pathToFileURL` main-gate conventions. Run it via `npx tsx --env-file=.env.local`.

> Verify first (MCP): `select label, station, report_reference_type, display_order from checklist_template_items where template_id in (select id from checklist_templates where type='closing' and active) and report_reference_type is not null;` — copy the station + display_order convention from the existing ref items so the cash item sits with them.

- [ ] **Step 4: Verify** → `npm run typecheck` + `npm run build` clean. Run the seed. Confirm the 2 cash ref items exist (one per location).
- [ ] **Step 5: Commit**
```bash
git add lib/prep.ts components/ReportReferenceItem.tsx scripts/seed-closing-cash-ref.ts
git commit -m "feat(cash): closing auto-tick (reconcile branch) + route + seed cash ref item"
```

---

## Task 13: Full-flow smoke + ship

**Files:**
- Create (throwaway): `scripts/smoke-cash-fullflow.ts`

- [ ] **Step 1: Write the end-to-end smoke** — isolated test date at MEP: (1) `submitCashReport` short case → assert deposit/over-short; (2) create today's closing instance, call `reconcileClosingReportRefs`, assert the cash ref item ticks with `reportType='cash_report'`; (3) run reconcile again → idempotent (no new tick); (4) revoke the cash tick → reconcile → respected (not re-ticked); (5) finalize the closing (status→confirmed) → `submitCashReport` returns `closing_finalized`. Mirror the Task 5 smoke's setup/cleanup. Run, expect ✅, `rm`.

- [ ] **Step 2: Final gates** → `npm run typecheck` clean; `npm run build` green; `npx eslint <all created/modified files>` → 0 errors.

- [ ] **Step 3: Open the PR** (base `main`):
```bash
git push -u origin claude/cash-deposit-confirmation
gh pr create --base main --title "feat(cash): Cash Deposit Confirmation (Wave 2 #1)" --body "<summary + test plan with preview URL>"
```
Confirm the `build` gate goes green before requesting Juan's smoke on the preview.

---

## Self-review (against the spec)

- **§2 money model** → Task 2 (`computeCashTotals`) + Task 5 (server recompute) + smokes. ✓
- **§3 table + RLS** → Task 1. ✓
- **§4 flow/UI + PIN** → Tasks 4 (pin-confirm), 8 (denomination), 9 (form), 10 (page). ✓
- **§5 closing tie-in** → Task 12. ✓
- **§6 KH+ gate** → RLS (T1), API (T6), tile/page (T10/T11). ✓
- **§7 Toast seam** → projected/tips/staff are manual inputs; "Pull from Toast" affordance noted as inert (T9 — render the button disabled with a `TOAST_ENABLED` guard, or omit until the adapter lands; YAGNI → omit the button, keep the manual fields). ✓
- **§8 i18n/format/audit** → Task 3 (formatCents), Task 7 (keys), Tasks 4/5 (audit actions). ✓
- **§9 edit window** → Task 5 (`closing_finalized` gate) + Task 13 smoke. ✓
- **§11 testing** → smokes in Tasks 2, 5, 13 + tsc/build/lint throughout. ✓
- **Type consistency:** `computeCashTotals`, `sumDenominations`, `Denominations`, `OnShiftEntry`, `CashActor`, `CASH_REPORT_BASE_LEVEL`, `DEFAULT_REGISTER_TARGET_CENTS`, `DENOMINATION_UNITS_CENTS`, `submitCashReport`/`CashSubmitResult`, `loadCashReport`/`loadCashDashboardState`/`CashDashboardState`, `verifyActorPin`, `formatCents` — names used consistently across tasks. ✓
- **Placeholder scan:** the only deferred detail is the JSX body of `CashClient` (Task 9) and the `cash/page.tsx` read-only markup (Task 10) — both fully specified by field+handler list + the exact pattern file to mirror, not vague "implement the form." Acceptable per "mirror established patterns."
