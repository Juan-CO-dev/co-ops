// Item 2 PR 2c: the build-time constants live twice (TS builder, 0338's fact_labor_constants) and must agree.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LABOR_FLOOR_WEEK, LABOR_HISTORY_FLOOR_DAY, LABOR_OT_MULTIPLIER, LABOR_OT_THRESHOLD_MINUTES, LABOR_SETTLE_HOURS,
  LABOR_BURDEN_DEFAULT_PCT, LABOR_ESTIMATE_DEFAULT_CENTS, factLaborEnabled, laborWageFallback } from "@/lib/facts/labor-config-shared";
import { BACKFILL_DAYS } from "@/lib/sevenshifts/sync";

const sql = readFileSync("supabase/migrations/0338_fact_layer_labor.sql", "utf8");

it("fact_labor_constants carries the TS numbers exactly", () => {
  const body = sql.match(/create function public\.fact_labor_constants\(\)[\s\S]*?\$\$;/)![0];
  expect(body).toContain(`select date '${LABOR_HISTORY_FLOOR_DAY}', date '${LABOR_FLOOR_WEEK}', interval '${LABOR_SETTLE_HOURS} hours', ${LABOR_OT_THRESHOLD_MINUTES}, ${LABOR_OT_MULTIPLIER}::numeric, ${BACKFILL_DAYS}`);
  expect(new Date(`${LABOR_FLOOR_WEEK}T12:00:00Z`).getUTCDay()).toBe(0);
});
it("the read-time defaults in SQL match TS (burden 12, estimate 1840)", () => {
  expect(sql).toContain(`coalesce(b.burden_pct, ${LABOR_BURDEN_DEFAULT_PCT}.00)`);
  expect(sql).toContain(`coalesce(s.estimated_hourly_cents, ${LABOR_ESTIMATE_DEFAULT_CENTS})`);
});
it("switches: only the exact value '1' turns the labor pass on; Q5 defaults to first_known", () => {
  expect([undefined, "", "0", "true", "1"].map(factLaborEnabled)).toEqual([false, false, false, false, true]);
  expect([undefined, "x", "dc_minimum"].map(laborWageFallback)).toEqual(["first_known", "first_known", "dc_minimum"]);
});
