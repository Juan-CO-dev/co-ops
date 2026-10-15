/**
 * B10 — the Cash Deposit "Projected (from Toast)" rule (lib/cash-toast-shared.ts).
 * Pure: the SQL bounds the rows (shop · CASH · latest snapshot · the day); these pin what counts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  cashToastRowCounts,
  computeToastCashProjected,
  projectedEditedFromPrefill,
  submittedToastLine,
  toastPrefillCents,
  toastPrefillDollars,
  type CashToastFacts,
  type CashToastFlags,
} from "@/lib/cash-toast-shared";

const OK: CashToastFlags = {
  payment_status: "CAPTURED", void_business_date: null,
  order_deleted: false, order_voided: false, check_deleted: false, check_voided: false,
};
const AS_OF = "2026-10-14T23:10:00Z";
const facts = (over: Partial<CashToastFacts> = {}): CashToastFacts => ({ as_of: AS_OF, payments: [], refunds: [], ...over });

describe("cashToastRowCounts", () => {
  it("counts an ordinary captured cash payment", () => {
    expect(cashToastRowCounts(OK)).toBe(true);
  });
  it("keeps a NULL status (unknown is not voided — the reports' coalesce rule)", () => {
    expect(cashToastRowCounts({ ...OK, payment_status: null })).toBe(true);
  });
  it("keeps the non-void statuses (settlement words, not a 'no money' signal)", () => {
    for (const s of ["AUTHORIZED", "OPEN", "PROCESSING", "CAPTURE_IN_PROGRESS"]) {
      expect(cashToastRowCounts({ ...OK, payment_status: s }), s).toBe(true);
    }
  });
  it("drops VOIDED and DENIED (any case)", () => {
    for (const s of ["VOIDED", "DENIED", "voided"]) {
      expect(cashToastRowCounts({ ...OK, payment_status: s }), s).toBe(false);
    }
  });
  it("drops a payment carrying a void business date", () => {
    expect(cashToastRowCounts({ ...OK, void_business_date: "2026-10-14" })).toBe(false);
  });
  it("drops deleted/voided orders and checks", () => {
    expect(cashToastRowCounts({ ...OK, order_deleted: true })).toBe(false);
    expect(cashToastRowCounts({ ...OK, order_voided: true })).toBe(false);
    expect(cashToastRowCounts({ ...OK, check_deleted: true })).toBe(false);
    expect(cashToastRowCounts({ ...OK, check_voided: true })).toBe(false);
  });
});

describe("computeToastCashProjected", () => {
  it("is null with no completed capture run (no as_of)", () => {
    expect(computeToastCashProjected(null)).toBeNull();
    expect(computeToastCashProjected(facts({ as_of: null, payments: [{ ...OK, amount_cents: 500 }] }))).toBeNull();
  });

  it("is a real zero when a run completed and no cash was taken", () => {
    expect(computeToastCashProjected(facts())).toEqual({ cents: 0, asOf: AS_OF });
  });

  it("sums counted cash payments and skips voided ones", () => {
    const r = computeToastCashProjected(facts({
      payments: [
        { ...OK, amount_cents: 1250 },
        { ...OK, amount_cents: 875 },
        { ...OK, payment_status: "VOIDED", amount_cents: 9999 },
        { ...OK, order_voided: true, amount_cents: 4000 },
      ],
    }));
    expect(r).toEqual({ cents: 2125, asOf: AS_OF });
  });

  it("subtracts cash refunds dated the day, never tips", () => {
    const r = computeToastCashProjected(facts({
      payments: [{ ...OK, amount_cents: 10_000 }],
      refunds: [{ ...OK, refund_amount_cents: 1500 }, { ...OK, check_deleted: true, refund_amount_cents: 700 }],
    }));
    expect(r).toEqual({ cents: 8500, asOf: AS_OF });
  });

  it("a refunded payment still counts on its paid day (refund_status is not an exclusion)", () => {
    const r = computeToastCashProjected(facts({
      payments: [{ ...OK, amount_cents: 2000 }],
      refunds: [{ ...OK, refund_amount_cents: 2000 }],
    }));
    expect(r?.cents).toBe(0);
  });

  it("an unknown amount on a COUNTED row makes the figure unknown", () => {
    expect(computeToastCashProjected(facts({ payments: [{ ...OK, amount_cents: null }] }))).toBeNull();
    expect(computeToastCashProjected(facts({ refunds: [{ ...OK, refund_amount_cents: null }] }))).toBeNull();
  });

  it("an unknown amount on an EXCLUDED row is ignored", () => {
    const r = computeToastCashProjected(facts({
      payments: [{ ...OK, amount_cents: 300 }, { ...OK, payment_status: "DENIED", amount_cents: null }],
    }));
    expect(r?.cents).toBe(300);
  });

  it("keeps a negative net (refunds above sales) as the stored truth", () => {
    const r = computeToastCashProjected(facts({ refunds: [{ ...OK, refund_amount_cents: 500 }] }));
    expect(r?.cents).toBe(-500);
  });
});

describe("prefill + changed hint", () => {
  it("prefills dollars with cents, clamped at zero, empty when there is no figure", () => {
    expect(toastPrefillDollars(null)).toBe("");
    expect(toastPrefillDollars({ cents: 123456, asOf: AS_OF })).toBe("1234.56");
    expect(toastPrefillDollars({ cents: 0, asOf: AS_OF })).toBe("0.00");
    expect(toastPrefillDollars({ cents: -500, asOf: AS_OF })).toBe("0.00");
  });
  it("prefill cents: clamped at zero, null when there is no figure", () => {
    expect(toastPrefillCents(null)).toBeNull();
    expect(toastPrefillCents({ cents: 700, asOf: AS_OF })).toBe(700);
    expect(toastPrefillCents({ cents: -500, asOf: AS_OF })).toBe(0);
  });
  it("form: 'Changed' compares against what was PREFILLED, never a later figure", () => {
    expect(projectedEditedFromPrefill(1000, null)).toBe(false);
    expect(projectedEditedFromPrefill(1000, { cents: 1000, asOf: AS_OF })).toBe(false);
    expect(projectedEditedFromPrefill(1001, { cents: 1000, asOf: AS_OF })).toBe(true);
    // a negative Toast net prefills 0.00 — leaving it untouched is not an edit
    expect(projectedEditedFromPrefill(0, { cents: -500, asOf: AS_OF })).toBe(false);
  });
  it("submitted view: neutral line, never 'Changed'", () => {
    expect(submittedToastLine(1000, null, null)).toBe("none");
    expect(submittedToastLine(1000, 1000, null)).toBe("none");
    expect(submittedToastLine(1000, 1000, AS_OF)).toBe("from");
    expect(submittedToastLine(1200, 1000, AS_OF)).toBe("at_save");
  });
});

describe("migration 0253 posture", () => {
  const src = readFileSync(path.resolve(__dirname, "../supabase/migrations/0253_cash_reports_toast_projected.sql"), "utf8");
  const lower = src.toLowerCase();

  it("carries the house header and the review gate", () => {
    const lines = src.split("\n");
    expect(lines[0]).toBe("-- Migration 0253_cash_reports_toast_projected");
    expect(lines[1]).toMatch(/NOT YET APPLIED — apply via MCP after review/);
  });

  it("expands only: two nullable columns, no drop/alter of existing columns", () => {
    expect(lower).toContain("add column toast_projected_cents bigint");
    expect(lower).toContain("add column toast_projected_as_of timestamptz");
    expect(lower).not.toMatch(/drop column|alter column|not null default/);
  });

  it("leaves 0188's submit_cash_report_atomic untouched (unwired; no re-emit, no drop)", () => {
    expect(lower).not.toMatch(/(create|drop|replace)[^;]*function public\.submit_cash_report_atomic/);
    expect(lower).not.toMatch(/(grant|revoke)[^;]*submit_cash_report_atomic/);
  });

  it("the facts function is SECURITY DEFINER, pinned search_path, service_role only", () => {
    expect(lower).toContain("create function public.cash_toast_projected_facts(");
    expect(lower.match(/security definer set search_path = pg_catalog, public/g)?.length).toBe(1);
    expect(lower).toContain("revoke all on function public.cash_toast_projected_facts(uuid, date) from public, anon, authenticated;");
    expect(lower).toContain("grant execute on function public.cash_toast_projected_facts(uuid, date) to service_role;");
    expect(lower).toContain("raise exception '0253 unexpected function grant'");
  });

  it("the facts read is CASH-only, latest-snapshot, shop-bound, tips never selected", () => {
    const start = lower.indexOf("create function public.cash_toast_projected_facts(");
    const body = lower.slice(start, lower.indexOf("comment on function public.cash_toast_projected_facts", start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("pm.type = 'cash'");
    expect(body).toContain("p.snapshot_id = o.id");
    expect(body).toContain("o.location_id = p_location_id");
    expect(body).toContain("pm.paid_business_date = p_business_date");
    expect(body).toContain("pm.refund_business_date = p_business_date");
    expect(body).toContain("r.status = 'completed'");
    expect(body).not.toContain("tip_cents");
  });
});
