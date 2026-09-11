/**
 * Unit spine — the mid-day Phase 2 save supersedes BEFORE it inserts (0199, LRA-215).
 *
 * 0196 made the live-head index UNIQUE (instance_id, template_item_id, coalesce(prep_data ? 'phase2', false)).
 * Mid-day rows carry no 'phase2' key, so a replacement inserted while the prior row is still live shares its key
 * and is a 23505 on every second save of the same item. 0064 inserted first; 0199 mirrors opening's 0056 order.
 * Source assertion over the LATEST migration that defines the RPC, pinned so a rewrite cannot swap the order back.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const DEFINES = "CREATE OR REPLACE FUNCTION public.save_mid_day_phase2_item_atomic(";

const latest = (() => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").includes(DEFINES));
  expect(defining.length).toBeGreaterThan(0);
  const file = defining[defining.length - 1]!;
  const src = readFileSync(`${MIGRATIONS}/${file}`, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf(DEFINES);
  const end = src.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return { file, body: src.slice(start, end) };
})();

describe("save_mid_day_phase2_item_atomic supersedes before it inserts (0199)", () => {
  it("is defined last by 0199 or later", () => {
    expect(latest.file >= "0199").toBe(true);
  });

  it("the prior live row is superseded BEFORE the replacement INSERT, and linked AFTER", () => {
    const supersede = latest.body.search(/SET superseded_at = v_saved_at/);
    const insert = latest.body.indexOf("INSERT INTO checklist_completions");
    const link = latest.body.search(/SET superseded_by = v_new_id/);
    expect(supersede).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(supersede);
    expect(link).toBeGreaterThan(insert);
    // The supersede must not depend on the replacement's id (that is what forced the old order).
    const supersedeStmt = latest.body.slice(supersede, latest.body.indexOf(";", supersede));
    expect(supersedeStmt).not.toMatch(/v_new_id/);
  });

  it("the payload shape and the phase1_complete gate are unchanged from 0064", () => {
    expect(latest.body).toMatch(/status = 'phase1_complete'/);
    for (const key of ["'inputs'", "'snapshot'", "'overUnder'"]) expect(latest.body).toContain(key);
    // Mid-day rows deliberately carry no phase2 key — judged on code, not on the comments that explain the index.
    const code = latest.body.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/'phase2'/);
  });
});
