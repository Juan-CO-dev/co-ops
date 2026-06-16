# Cash Deposit Confirmation — Design Spec

**Date:** 2026-06-16
**Module:** Wave 2, Module #1 — Cash Deposit Confirmation (`cash_report`)
**Status:** Design approved by Juan (brainstorm 2026-06-16); pending spec review → implementation plan.

---

## 1. Purpose

A faithful digital capture of CO's end-of-day cash close-out, replacing the paper process. The closing manager, at end of day:

1. Sees **projected** cash (what Toast says was made in cash) and sets it aside as the intended deposit.
2. **Counts the register** (the cash left in the drawer) to verify it equals the **$200 float**, using a per-denomination counter the system sums live.
3. The system derives the **actual deposit** and the **over/short** from the register vs $200.
4. Counts **cash tips** from the jar.
5. Records **everyone on shift** that day.
6. **Signs** the deposit (PIN-confirm) and deposits the money in the office safe.

This is NOT a POS reconciliation — the Toast adapter is a disabled stub (`/api/toast` returns 501, deferred per spec §2.8). v1 is manual entry with a documented seam for Toast-pull later. Per-person tip *splitting* is out of scope (that's the Wave 5 Tip Pool Calculator); here we capture the cash-tip total + who was on shift.

## 2. The money model (the core)

The closer keeps **$200 in the register** (the float) and deposits the rest. They set the projected deposit aside, then count the register to confirm it's at $200; the difference tells them over/short and adjusts the deposit.

**Stored values (all money as integer cents — never floats):**

| Field | Meaning |
|---|---|
| `projected_cents` | Expected cash deposit (Toast cash sales). Manual in v1. |
| `register_count_cents` | What the closer counted in the register (drawer after setting projected aside). |
| `register_target_cents` | The float target. Default **20000 ($200)**; stored per-report so a future float change is on the record. |
| `count_method` | `'hand'` (typed a single total) or `'denomination'` (counted by bill/coin). |
| `denominations` | jsonb, non-null only when `count_method='denomination'`: `{ "<unit_cents>": <qty> }`, e.g. `{ "2000": 6, "1000": 8, "25": 12 }`. Audit trail of the bill-by-bill count. |
| `cash_tips_cents` | Cash counted from the tip jar. |
| `on_shift` | jsonb array: `[{ "userId": "<uuid>" | null, "name": "<string>" }]`. Picked CO-OPS users + free-text adds for non-users. |
| `over_short_cents` | **Computed + stored** = `register_count_cents − register_target_cents`. Negative = short, positive = over. |
| `deposit_cents` | **Computed + stored** = `projected_cents + over_short_cents`. The amount actually deposited. |
| `over_short_note` | Optional text (nullable) — explanation when over/short ≠ 0. |
| `signed_by` | users.id of the PIN-confirmed closer. |
| `signed_at` | timestamptz of the signature. |

**Derivations (authoritative — recomputed server-side at write, never trusted from the client):**

```
over_short_cents = register_count_cents − register_target_cents
deposit_cents    = projected_cents + over_short_cents
```

**Worked examples** (projected = $500, target = $200):

| register_count | over_short | deposit | reading |
|---|---|---|---|
| $190 | −$10 | $490 | short — pulled $10 from the deposit to top the register to $200 |
| $215 | +$15 | $515 | over — register's at $200, the extra $15 fell into the deposit |
| $200 | $0 | $500 | even |

The denomination counter's job is to help the closer **hit $200**: as they tap in bills/coins it sums live and shows **"✓ Register $200"** or **"Register $X — $Y over/short."**

## 3. Data model — new `cash_reports` table

A dedicated, purpose-built table (NOT shoehorned into `checklist_instances`) — cash deposit is a structured financial record, not a checklist of tickable items.

```
cash_reports
  id                    uuid pk default gen_random_uuid()
  location_id           uuid not null  → locations(id)
  report_date           date not null            -- operational (NY) date
  projected_cents       integer not null
  register_count_cents  integer not null
  register_target_cents integer not null default 20000
  count_method          text not null check (count_method in ('hand','denomination'))
  denominations         jsonb                    -- null unless count_method='denomination'
  cash_tips_cents       integer not null default 0
  on_shift              jsonb not null default '[]'::jsonb
  over_short_cents      integer not null         -- = register_count − register_target
  deposit_cents         integer not null         -- = projected + over_short
  over_short_note       text
  signed_by             uuid not null  → users(id)
  signed_at             timestamptz not null
  entered_by            uuid not null  → users(id)   -- the actor who wrote the row
  created_at            timestamptz not null default now()
  superseded_at         timestamptz              -- append-only edit chain
  superseded_by         uuid → cash_reports(id)
```

- **One live report per location/day:** partial unique index `(location_id, report_date) WHERE superseded_at IS NULL`.
- **Append-only:** edits write a NEW row and set the prior row's `superseded_at`/`superseded_by` (mirrors the completion-supersede pattern). No in-place UPDATE of value columns by users.
- **Money:** all `*_cents` integers. Format `$` at display only.
- **Migration** captured as `supabase/migrations/NNNN_cash_reports.sql` per the repo convention.

### RLS (per AGENTS.md patterns)

- `cash_reports_read` — `current_user_role_level() >= 4` (KH+) AND location in `current_user_locations()` (level 7+ all-locations override).
- `cash_reports_insert` — same gate, `WITH CHECK`.
- `cash_reports_no_user_update USING (false)` + `cash_reports_no_user_delete USING (false)` — append-only; supersede is service-role via the API.
- Helper functions are the existing SECURITY DEFINER set. Service-role writes go through the API route (like the other report submits).

## 4. Flow + UI (`/cash?location=<id>` — replaces the PlaceholderCard stub)

- **One per day.** If today's live `cash_report` exists → **read-only locked view** (the recorded deposit + signature); else → the **entry form**. KH+ can **supersede-edit** a submitted report (append-only) until... (open: until closing finalizes? — see §9 assumptions).
- **Entry form sections:**
  1. **Cash** — Projected (number input; "Pull from Toast" seam, inert until `TOAST_ENABLED`). Count method toggle: **Enter total** (one register input) vs **Count by denomination** (bill/coin rows → live sum + **register-vs-$200** indicator). Live readout: deposit, over/short (color-coded), `over_short_note` shown when ≠ 0.
  2. **Tips** — cash tips counted (number input).
  3. **On shift** — multi-select of the location's active users + a free-text "add name" for non-users → builds `on_shift`.
- **Submit → PinConfirmModal** (the existing scaffold; wire `POST /api/auth/pin-confirm` — note this route is currently a Phase-4 TODO stub per AGENTS.md, so the plan must include wiring it OR confirming an existing confirm path). On success the API writes the row with `signed_by`/`signed_at` = the confirmer + now.
- **Read-only after submit;** unlock only via the KH+ supersede-edit path.
- **Dashboard `CashDepositTile`** in the Reports section: not-started / submitted ("Finalized at {time} by {name}", consistent with the opening/am-prep/mid-day tiles). Built with the unified `ActionButton`/`ActionLink` (from the button-uniformity PR).

## 5. Closing tie-in

- Seed a **"Cash deposited"** report-reference item into the active closing template (`report_reference_type = 'cash_report'` — the enum value already exists in `lib/types.ts`).
- Extend **`reconcileClosingReportRefs`** (lib/prep.ts) with a 4th branch: if a live `cash_report` exists for the location/day, auto-complete the closing's cash ref item (idempotent + C.55-reopen-aware, same as the other three). Meta carries `{ reportType: 'cash_report', reportInstanceId, reportSubmittedAt }`.
- `reportRoute('cash_report')` in `ReportReferenceItem` → `/cash` (tap routes the closer to the deposit form/view).

## 6. Role gate

**KH+ (level ≥ 4)** — matches the closing-finalize gate (the closer is the one who deposits). Enforced at three layers per AGENTS.md: RLS, the API route, and the dashboard-tile visibility + page guard.

## 7. Toast seam (future — NOT built in v1)

`projected_cents`, `on_shift`, and `cash_tips_cents` are manual in v1 because the Toast adapter is a disabled stub. The design leaves a clean seam: when `TOAST_ENABLED`, a "Pull from Toast" action pre-fills projected cash sales + the on-shift roster + aggregated cash tips (the way Toast already aggregates card tips). Flag-don't-build: no Toast call ships in this module; the affordance is inert/hidden until the adapter lands.

## 8. Cross-cutting

- **i18n:** EN + ES keys from day one (C.37) — `cash.*` namespace. Spanish is operational/tú-form.
- **Money formatting:** a shared `formatCents(cents, language)` helper (locale-aware `Intl.NumberFormat` currency). Integer cents in, `$` string out.
- **Language-aware time/date** via the canonical `lib/i18n/format` helpers.
- **Audit:** `cash_report.submit` (and `cash_report.supersede` for edits) audit rows via `lib/audit.ts`, with `over_short_cents`/`deposit_cents` in metadata for forensic visibility. New action codes added to the audit vocabulary.

## 9. Assumptions (flag-and-proceed; confirm in spec review)

- **Edit window:** KH+ may supersede-edit a submitted cash report **until today's closing is finalized** (after that it's locked, matching the report-lifecycle pattern). If Juan wants a stricter/looser rule, adjust.
- **`register_count` semantics:** the closer counts the register *after* setting the projected deposit aside (Juan's method). The denomination counter sums whatever they enter; the math (`over_short = register − 200`) holds regardless of how they physically separate the cash.
- **Multi-tenant flag (not built):** `register_target_cents` is per-report (not hardcoded), and the location is explicit — no new single-tenant assumptions added. The $200 default is the only CO-specific constant, and it's overridable on the row.

## 10. Out of scope (YAGNI)

- Per-person tip **splitting** → Wave 5 Tip Pool Calculator.
- Deposit **photo** (Juan: counts + names driven, not photo-driven).
- **Live Toast** integration (adapter deferred).
- **Multiple deposits/day** (single end-of-day deposit).
- **Card/credit reconciliation** (cash-only module).

## 11. Testing

- `tsc --noEmit` + `next build` gates (per the repo's two-gate discipline).
- A throwaway `tsx` smoke (isolated test date; self-cleaning): write a `cash_report`, assert `over_short`/`deposit` derivations across short/over/even cases, assert one-live-per-day, assert `reconcileClosingReportRefs` ticks the closing cash ref + is idempotent + reopen-aware.
- Preview-URL manual test by Juan (the canonical CO-OPS verification step).

## 12. File structure (informs the plan)

- `supabase/migrations/NNNN_cash_reports.sql` — table + indexes + RLS.
- `lib/cash.ts` — types (`CashReport`, `Denominations`, `OnShiftEntry`), the derivation helper (`computeCashTotals`), loaders (`loadCashReport`, `loadCashDashboardState`), and `submitCashReport` (server-authoritative recompute + append-only write + audit).
- `lib/i18n/format.ts` — add `formatCents`.
- `app/api/cash/route.ts` — `POST` (submit/supersede; KH+ gate; PIN-confirm verification).
- `app/(authed)/cash/page.tsx` — server loader + read-only/entry branch.
- `app/(authed)/cash/cash-client.tsx` — the interactive form (count-mode toggle, denomination counter, live totals, staff multi-select, PIN-confirm submit).
- `components/CashDepositTile.tsx` — dashboard tile.
- `components/cash/DenominationCounter.tsx` — the bill/coin counter with live $200 feedback.
- `lib/prep.ts` — extend `reconcileClosingReportRefs` (4th branch).
- `components/ReportReferenceItem.tsx` — `reportRoute('cash_report') → /cash`.
- Closing template seed — add the "Cash deposited" ref item.
- `lib/i18n/{en,es}.json` — `cash.*` keys.

> **Dependency note:** the dashboard tile + form submit use `ActionButton`/`ActionLink` from the button-uniformity PR (#54). Implementation should base on `main` after #54 merges (or stack on it).
