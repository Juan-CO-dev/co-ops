/**
 * W09 — migration 0309 pinned: the house header and the enforced rollout order, the re-emitted 0271 writers equal
 * to 0271 plus ONE line, the duplicate collapse (keep the newest) before the unique index under a table lock, NO
 * trigger on pm_employee_evals (the self INSERT trigger is 0310, after the W09 deploy drains: fix round 2), the eval
 * writer's day-row lock, the grants — and the executable PGlite proof (old writer vs new schema included) runs green.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0309_pm_reviews_self_and_atomic_eval.sql", "utf8"));
const m0271 = normalize(readFileSync("supabase/migrations/0271_pm_reports_v2.sql", "utf8"));
const LOCK = "  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');\n";
const SELF = "  if p_subject = p_actor then raise exception 'subject_is_author'; end if;  -- 0309 (W09/B059)\n";

describe("0309_pm_reviews_self_and_atomic_eval", () => {
  it("house header and gate line — a later APPLIED stamp under it never breaks the pin", () => {
    // The apply stamps (2026-11-15) sit under the gate line; the pin reads the authored header around them.
    expect(src.split("\n").slice(2, 4)).toEqual([
      "-- APPLIED TO SIM 2026-11-15 (schema_migrations version 20261115204850, name '0309_pm_reviews_self_and_atomic_eval')",
      "-- APPLIED TO PROD 2026-11-15 (schema_migrations version 20261115205216, name '0309_pm_reviews_self_and_atomic_eval')",
    ]);
    const lines = src.split("\n").filter((l) => !/^-- APPLIED TO (SIM|PROD) /.test(l));
    expect(lines[0]).toBe("-- Migration 0309_pm_reviews_self_and_atomic_eval");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0271; BEFORE the W09 PR merges\)\.$/);
    expect(lines[2]).toBe("-- ROLLOUT (enforced order, W09 fix round 2): apply 0309 -> merge + deploy the W09 PR -> older deployments drain -> apply 0310.");
    for (const k of ["-- Provenance:", "-- WHAT:", "-- EXISTING ROWS:", "-- CONSUMERS", "-- DEPENDS ON:", "-- IDEMPOTENT:", "-- PRE-FLIGHT", "-- VERIFY AFTER APPLY:"]) expect(src).toContain(k);
  });

  it("the three 0271 writers are re-emitted IDENTICAL but for one line after pm_copy_lock", () => {
    for (const name of ["save_pm_copy_grade", "save_pm_copy_note", "add_pm_copy_position"]) {
      const was = extractFunction(m0271, `create function public.${name}(`, "end $$;");
      const now = extractFunction(src, `create or replace function public.${name}(`, "end $$;");
      expect(now).toBe(was.replace(`create function public.${name}(`, `create or replace function public.${name}(`).replace(LOCK, LOCK + SELF));
    }
  });

  it("collapse (keep the newest) runs under a table lock BEFORE the unique index; nothing is deleted", () => {
    const lock = src.indexOf("lock table public.pm_employee_evals in share row exclusive mode;");
    const collapse = src.indexOf("order by created_at desc, id desc");
    const index = src.indexOf("create unique index if not exists pm_employee_evals_one_live\n  on public.pm_employee_evals (pm_report_id, employee_id) where superseded_at is null;");
    expect(lock).toBeGreaterThan(0);
    expect(collapse).toBeGreaterThan(lock);
    expect(index).toBeGreaterThan(collapse);
    expect(src.replace(/^--.*$/gm, "")).not.toMatch(/\bdelete\s+from\b|\btruncate\s+(table\s+)?public\./i);
    expect(src).toContain("'pm_report.eval_duplicate_collapse'");
  });

  it("0309 adds NO refusal on pm_employee_evals INSERT: the self trigger is 0310 (the old two-call writer would lose the GM's row)", () => {
    const code = src.replace(/^--.*$/gm, "");
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?trigger|pm_employee_evals_no_self|add constraint|check\s*\(\s*author_id/i);
    // the header no longer claims the old app refuses self-evaluation; it says the old path still lands one
    expect(src).not.toContain("the lib's own self-evaluation refusal (403) runs before the trigger can");
    expect(src).toContain("a self-evaluation still LANDS through the old path (as it does today)");
    expect(src).toContain("NOT HERE (moved to 0310_pm_eval_no_self_trigger");
  });

  it("the eval writer locks the day row FOR NO KEY UPDATE, then supersedes and inserts; service_role only", () => {
    const fn = extractFunction(src, "create or replace function public.save_pm_employee_eval(", "end $$;");
    const order = ["for no key update", "'format_mismatch'", "'forbidden'", "'report_already_submitted'", "'self_evaluation'", "'invalid_target'",
      "update public.pm_employee_evals set superseded_at", "insert into public.pm_employee_evals"].map((k) => fn.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fn).toContain("security definer set search_path = pg_catalog, public");
    expect(src).toContain("revoke all on function public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;");
    expect(src).toContain("grant execute on function public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text) to service_role;");
  });

  it("the executable proof (PGlite: the REAL 0072/0073/0267/0270/0271 + 0309) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0309.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("C0 the duplicate pair collapsed to the NEWEST live eval (W09-4 a)");
    expect(out).toContain("C1 two saves for one (report, employee) leave exactly one live eval");
    expect(out).toContain("C4 superseding an OLD self-written row still works");
    expect(out).toContain("C4 0309 installs no trigger on pm_employee_evals");
    expect(out).toContain("C9 an old-path save still works on 0309");
    expect(out).toContain("C9 a concurrent old-path duplicate (supersede, supersede, insert, insert) only 23505s");
    expect(out).toContain("C9 ... and a 23505 always leaves one live eval");
    expect(out).toContain("C9 an old-path self save still lands on 0309");
    expect(out).toContain("C9 ... and the GM's live eval is untouched by the refusal");
    expect(out).toContain("PASS 0309:");
  }, 260_000);
});
