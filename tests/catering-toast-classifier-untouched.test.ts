/**
 * Item 21 PR 0 (plan r3, carried from r2 F1): a Toast check linked to a house catering lead stays a
 * `sale` everywhere. Link state lives only in the new house tables/views and is joined at display
 * time; no classifier, fact reader or business-report read learns about it.
 *
 * Pin: every migration from 0343 on (the item-21 era) names none of the sales classification or
 * fact objects, and none of them re-emits an ezCater writer. PR 3 (Migration B) is the ONE place the
 * ezCater PLANNER may be re-emitted (additive lines, line-subsequence pinned there); this pin then
 * gets that file as its single, named exception — never a blanket one.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FIRST_ITEM21 = 343;
const migrations = readdirSync("supabase/migrations").filter((name) => {
  const n = Number(name.slice(0, 4));
  return /^\d{4}_.*\.sql$/.test(name) && n >= FIRST_ITEM21;
});
const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8")
  // Comments may name what the file deliberately leaves alone.
  .replace(/--[^\n]*/g, "");

/** The classifier and every reader of it: never re-emitted, never referenced by item-21 SQL. */
const CLASSIFIER = /\b(sales_report_class|sales_report_facts|sales_report_daily|fact_sales_\w+|fact_order_\w+|business_report_\w+|sales_report_catering_values)\b/;
/** ezCater writers and the planner. A house migration never redefines them or writes their links. */
const EZCATER_WRITER = /function\s+public\.(publish_ezcater_shadow|reconcile_ezcater_toast|plan_ezcater_toast|apply_ezcater_order|transfer_catering_lead)\b|(update|insert\s+into|delete\s+from)\s+public\.ezcater_toast_links\b/i;

/** The single, named exception: 0347 (item 21 PR 3) re-emits the ezCater PLANNER with added lines only (its own pin,
 * tests/catering-toast-0347-migration.test.ts, holds 0231's body as a line-subsequence). Only that one function name is
 * allowed there; every other writer pattern still applies to 0347.
 * 0348 (item 21 PR 4) re-emits the planner FROM 0347, again by added lines only (its own pin,
 * tests/catering-toast-0348-migration.test.ts): a note-typed ring code joins the dual-code test (contract #3). */
const PLANNER = /function\s+public\.plan_ezcater_toast\b/gi;
const PLANNER_EXCEPTION: Record<string, RegExp> = { "0347_catering_toast_link_step.sql": PLANNER, "0348_catering_toast_reconciler.sql": PLANNER };
const withoutException = (name: string) => PLANNER_EXCEPTION[name] ? sql(name).replace(PLANNER_EXCEPTION[name], "") : sql(name);

describe("item 21 leaves the sales classifier and the ezCater writers alone", () => {
  it("no item-21 migration names a classifier or fact object", () => {
    for (const name of migrations) expect([name, CLASSIFIER.test(sql(name))]).toEqual([name, false]);
  });
  it("no item-21 migration re-emits an ezCater writer or writes ezcater_toast_links", () => {
    for (const name of migrations) expect([name, EZCATER_WRITER.test(withoutException(name))]).toEqual([name, false]);
  });
  it("the exception is exactly the planner, in exactly 0347 and 0348", () => {
    expect(Object.keys(PLANNER_EXCEPTION)).toEqual(["0347_catering_toast_link_step.sql", "0348_catering_toast_reconciler.sql"]);
    for (const name of Object.keys(PLANNER_EXCEPTION)) {
      expect(migrations).toContain(name);
      expect(EZCATER_WRITER.test(sql(name))).toBe(true);
      expect(sql(name).match(/create or replace function public\.plan_ezcater_toast\(/g)).toHaveLength(1);
    }
  });
  it("the patterns are not vacuous", () => {
    expect(CLASSIFIER.test("select public.sales_report_class(a,b,c,d,e)")).toBe(true);
    expect(CLASSIFIER.test("from public.fact_sales_check_classes(x)")).toBe(true);
    expect(EZCATER_WRITER.test("create or replace function public.publish_ezcater_shadow(")).toBe(true);
    expect(EZCATER_WRITER.test("update public.ezcater_toast_links set is_current=false")).toBe(true);
    expect(EZCATER_WRITER.test("select 1 from public.ezcater_toast_links z where z.is_current")).toBe(false);
  });
});
