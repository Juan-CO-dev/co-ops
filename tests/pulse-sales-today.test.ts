/**
 * Nav PR 8, T-S1 (plan r2 2.11, A4): the sales extraction is a pure refactor.
 *
 * The golden `tests/fixtures/pulse/sales-today-golden.json` was written by `loadPulseSales` on the UNCHANGED code (commit
 * 2a), before `loadPulseSalesToday` was extracted from it (2b). The fixture has 14 checks, nonzero discounts (3 / 1,250 ¢)
 * and refunds (1 / 800 ¢), no unknown amounts (so the average check is not null) and `captured_at` set. The whole
 * `SalesFacts` (all seven parts) must deep-equal the golden before and after the extract.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { clearBaselineCache, loadPulseSales } from "@/lib/pulse/sales";
import * as salesModule from "@/lib/pulse/sales";
import type { PulseCtx } from "@/lib/pulse/sections";

const LOC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DATE = "2026-11-18";
const GOLDEN = resolve(__dirname, "fixtures/pulse/sales-today-golden.json");

export const TODAY_RAW = {
  classes: [
    { business_date: DATE, sale_class: "sale", checks: 14, amount_cents: 31_450, tax_cents: 3_145, amount_missing: 0, tax_missing: 0,
      gross_cents: 33_900, discounts_comps_cents: 1_250, voids_cents: 400, service_charges_cents: 0, accounting_missing: 0 },
    { business_date: DATE, sale_class: "gift_card", checks: 1, amount_cents: 2_500, tax_cents: 0, amount_missing: 0 },
    { business_date: DATE, sale_class: "void", checks: 1, amount_cents: 400, tax_cents: 0, amount_missing: 0 },
  ],
  discounts: [{ business_date: DATE, count: 3, cents: 1_250, amount_missing: 0 }],
  refunds: [{ business_date: DATE, count: 1, refund_cents: 800, refund_tip_cents: 0, sales_refund_cents: 800, sales_refund_missing: 0 }],
  captured_days: [DATE],
  captured_at: "2026-11-18T18:42:00Z",
};
const BREAKDOWN: Record<string, unknown[]> = {
  item: [{ key: "Italian", label: "Italian", cents: 9_000, units: 9, checks: 8 }, { key: "Turkey", label: "Turkey", cents: 4_000, units: 4, checks: 4 }],
  channel: [{ key: "Dine In", channel: "Dine In", sale_class: "sale", cents: 20_000, checks: 9 }, { key: "Online", channel: "Online", sale_class: "sale", cents: 11_450, checks: 5 }],
  discount: [{ key: "Staff", label: "Staff", cents: 1_250, count: 3 }],
  server: [{ key: "s1", label: "Ana", cents: 31_450, checks: 14 }],
  hour_weekday: [{ key: "3|11", dow: 3, hour: 11, cents: 15_000, checks: 7 }, { key: "3|12", dow: 3, hour: 12, cents: 16_450, checks: 7 }],
};
const HISTORY = { hours: [{ key: "3|11", dow: 3, hour: 11, cents: 14_000, checks: 6 }], captured_days: ["2026-11-11", "2026-11-04", "2026-11-11"] };

export function salesFake(over: { today?: unknown; todayError?: { code?: string; message: string } } = {}) {
  const calls: string[] = [];
  const client = {
    from() { throw new Error("no table read expected"); },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(name);
      let result: { data: unknown; error: unknown };
      if (name === "pulse_sales_today") result = over.todayError ? { data: null, error: over.todayError } : { data: over.today ?? TODAY_RAW, error: null };
      else if (name === "pulse_sales_baseline") result = { data: HISTORY, error: null };
      else result = { data: BREAKDOWN[String(args.p_dimension)] ?? [], error: null };
      const p = Promise.resolve(result);
      return { abortSignal() { return this; }, then: p.then.bind(p) };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ctx = (level = 7, locations: string[] = [LOC]): PulseCtx => ({
  auth: { user: { id: "u-gm", role: "gm", language: "en" }, role: "gm", level, locations } as AuthContext,
  locationId: LOC, date: DATE, now: new Date("2026-11-18T19:00:00Z"),
});

afterEach(() => clearBaselineCache());

describe("T-S1: loadPulseSales equals the golden frozen before the extraction", () => {
  it("the whole SalesFacts deep-equals the golden", async () => {
    const facts = JSON.parse(JSON.stringify(await loadPulseSales(salesFake().client, ctx())));
    if (process.env.WRITE_SALES_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(facts, null, 2)}\n`);
      if (process.env.WRITE_SALES_GOLDEN !== "1") throw new Error("golden was missing: written; re-run");
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    expect(facts).toEqual(golden);
    // The fixture is the one the plan names: nonzero discounts, refunds and average check; captured_at set.
    expect(golden.today.totals).toMatchObject({ checks: 14, discountCount: 3, discountCents: 1_250, refundCount: 1, refundCents: 800, amountMissing: 0 });
    expect(golden.today.totals.avgCheckCents).not.toBeNull();
    expect(golden.today.capturedAt).toBe(TODAY_RAW.captured_at);
    expect(Object.keys(golden).sort()).toEqual(["channels", "discounts", "heatTrailing", "hoursToday", "items", "servers", "today", "trailing"]);
  });

  it("loadPulseSalesToday (once extracted) deep-equals the golden's today and refuses before any RPC", async () => {
    const extracted = (salesModule as Record<string, unknown>).loadPulseSalesToday as
      | ((c: SupabaseClient, a: { viewer: { userId: string; level: number; locations: string[] }; locationId: string; date: string }) => Promise<unknown>)
      | undefined;
    if (!extracted) return; // commit 2a: the extraction does not exist yet
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    const { client, calls } = salesFake();
    const today = JSON.parse(JSON.stringify(await extracted(client, { viewer: { userId: "u-gm", level: 7, locations: [LOC] }, locationId: LOC, date: DATE })));
    expect(today).toEqual(golden.today);
    expect(calls).toEqual(["pulse_sales_today"]);
    for (const [viewer, code] of [
      [{ userId: "u", level: 6, locations: [LOC] }, "role_insufficient"],
      [{ userId: "u", level: 7, locations: [OTHER] }, "location_forbidden"],
    ] as const) {
      const f = salesFake();
      await expect(extracted(f.client, { viewer: { ...viewer, locations: [...viewer.locations] }, locationId: LOC, date: DATE })).rejects.toMatchObject({ code });
      expect(f.calls).toEqual([]);
    }
    const missing = salesFake({ todayError: { code: "PGRST202", message: "x" } });
    await expect(extracted(missing.client, { viewer: { userId: "u", level: 7, locations: [LOC] }, locationId: LOC, date: DATE }))
      .rejects.toMatchObject({ code: "sales_reads_not_installed" });
  });
});
