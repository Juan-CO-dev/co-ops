/**
 * Unit spine — THE PM-REPORT SUBMIT IS A GUARDED FLIP (audit 2026-08-29, cluster
 * reports-counts-ui).
 *
 * `submitPmReport` is DB-coupled, so it stays off the pure spine per the house law
 * (AGENTS.md § Module boundaries) and the guarantee is asserted at the SOURCE — the
 * posture tests/loader-scale-ceilings.test.ts and tests/dynamic-pars-walker.test.ts
 * already take for rules that live in a query's shape rather than in a return value.
 * The guarantee here is precisely a shape: a status predicate, a counted rowcount, and
 * an early return placed AHEAD of the effects. No assertion over the module's exports
 * can see an ordering, and the effects are exactly what must not run twice.
 *
 * What the shape prevents: `enqueueNotification` has no dedupe, so a second submit that
 * reached the effects would re-notify every evaluated employee and write a second
 * `pm_report.submit` audit row for a submission that already happened.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const src = readFileSync(join(LIB, "pm-report.ts"), "utf8");

/** The function body, so a match cannot come from a sibling writer or a comment block. */
const submitBody = (() => {
  const start = src.indexOf("export async function submitPmReport");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end);
})();

describe("submitPmReport — open→submitted is guarded and counted", () => {
  it("filters the UPDATE on status open, so only ONE submit can transition the row", () => {
    expect(submitBody.includes('.eq("status", "open")')).toBe(true);
  });

  it("asks for an exact rowcount — a Supabase UPDATE that matched nothing is silent", () => {
    // AGENTS.md § Database & RLS: "UPDATE denials are silent (UPDATE 0, no error)".
    // Without { count: "exact" } the guard above would filter and then be un-observable.
    expect(submitBody.includes('{ count: "exact" }')).toBe(true);
    expect(submitBody.includes("const { error, count }")).toBe(true);
  });

  it("returns on a 0-row flip BEFORE any effect — the losing submit notifies nobody", () => {
    const guard = submitBody.indexOf("if (count === 0) return { notified: 0 };");
    expect(guard).toBeGreaterThan(-1);
    // Ordering is the whole point: both effects must sit after the early return.
    expect(submitBody.indexOf("enqueueNotification")).toBeGreaterThan(guard);
    expect(submitBody.indexOf('action: "pm_report.submit"')).toBeGreaterThan(guard);
  });

  it("still throws on a real error rather than treating it as a lost race", () => {
    const thrown = submitBody.indexOf("throw new Error(`submitPmReport:");
    expect(thrown).toBeGreaterThan(-1);
    expect(thrown).toBeLessThan(submitBody.indexOf("if (count === 0)"));
  });

  it("keeps the flip ahead of the notification load, not interleaved with it", () => {
    expect(submitBody.indexOf('.from("pm_reports")')).toBeLessThan(
      submitBody.indexOf('.from("pm_employee_evals")'),
    );
  });
});
