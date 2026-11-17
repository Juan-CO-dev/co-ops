// Item 2 PR 2c: the build-time constants live twice (TS builder, 0338's fact_labor_constants) and must agree.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LABOR_FLOOR_WEEK, LABOR_HISTORY_FLOOR_DAY, LABOR_OT_MULTIPLIER, LABOR_OT_THRESHOLD_MINUTES, LABOR_SETTLE_HOURS, LABOR_OPEN_PUNCH_SPAN_HOURS, LABOR_PROMISED_LOOKBACK_DAYS,
  LABOR_BURDEN_DEFAULT_PCT, LABOR_ESTIMATE_DEFAULT_CENTS, factLaborEnabled, laborWageFallback } from "@/lib/facts/labor-config-shared";
import { BACKFILL_DAYS } from "@/lib/sevenshifts/sync";

const sql = readFileSync("supabase/migrations/0338_fact_layer_labor.sql", "utf8");

it("fact_labor_constants carries the TS numbers exactly", () => {
  const body = sql.match(/create function public\.fact_labor_constants\(\)[\s\S]*?\$\$;/)![0];
  expect(body).toContain(`select date '${LABOR_HISTORY_FLOOR_DAY}', date '${LABOR_FLOOR_WEEK}', interval '${LABOR_SETTLE_HOURS} hours', ${LABOR_OT_THRESHOLD_MINUTES}, ${LABOR_OT_MULTIPLIER}::numeric, ${BACKFILL_DAYS}, interval '${LABOR_OPEN_PUNCH_SPAN_HOURS} hours'`);
  expect(new Date(`${LABOR_FLOOR_WEEK}T12:00:00Z`).getUTCDay()).toBe(0);
});
it("fix r2 P2: the promised-clock lookback in SPLH is the TS number (both bounds of the captured window and the per-day join)", () => {
  const body = sql.match(/create function public\.fact_labor_splh\([\s\S]*?end \$\$;/)![0];
  const n = LABOR_PROMISED_LOOKBACK_DAYS;
  expect(body.split(`between p_from - ${n} and p_to + 1`).length - 1).toBe(2);
  expect(body).toContain(`captured.bd between g::date - ${n} and g::date + 1`);
});
it("the read-time defaults in SQL match TS (burden 12, estimate 1840)", () => {
  expect(sql).toContain(`coalesce(b.burden_pct, ${LABOR_BURDEN_DEFAULT_PCT}.00)`);
  expect(sql).toContain(`coalesce(s.estimated_hourly_cents, ${LABOR_ESTIMATE_DEFAULT_CENTS})`);
});
it("switches: only the exact value '1' turns the labor pass on; Q5 defaults to first_known", () => {
  expect([undefined, "", "0", "true", "1"].map(factLaborEnabled)).toEqual([false, false, false, false, true]);
  expect([undefined, "x", "dc_minimum"].map(laborWageFallback)).toEqual(["first_known", "first_known", "dc_minimum"]);
});
it("Juan 2026-11-17: the overtime scope is per_shop in TS and in 0339's fact_labor_ot_scope (pinned equal)", async () => {
  const { LABOR_OT_SCOPE } = await import("@/lib/facts/labor-config-shared");
  const m0339 = readFileSync("supabase/migrations/0339_fact_labor_ot_per_shop.sql", "utf8");
  const body = m0339.match(/create function public\.fact_labor_ot_scope\(\)[\s\S]*?\$\$;/)![0];
  expect(LABOR_OT_SCOPE).toBe("per_shop");
  expect(body).toContain(`select '${LABOR_OT_SCOPE}'::text`);
});
