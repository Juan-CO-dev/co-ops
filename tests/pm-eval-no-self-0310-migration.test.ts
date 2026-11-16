/**
 * W09 fix round 2 — migration 0310 pinned: the self-evaluation INSERT trigger split out of 0309. The gate line says
 * it is applied only AFTER the W09 deploy drains, the pre-flight refuses without 0309's writer, the trigger is
 * INSERT-only (never a CHECK), the function is callable by nobody — and the executable PGlite proof runs green,
 * including the hazard that makes the ordering mandatory.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0310_pm_eval_no_self_trigger.sql", "utf8"));
const code = src.replace(/^--.*$/gm, "");

describe("0310_pm_eval_no_self_trigger", () => {
  it("house header: applied only after 0309 AND after the W09 deploy drains; the enforced rollout order", () => {
    const lines = src.split("\n");
    expect(lines[0]).toBe("-- Migration 0310_pm_eval_no_self_trigger");
    expect(lines[1]).toBe("-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0309 AND ONLY AFTER the W09 PR is deployed READY and older deployments drain).");
    expect(lines[2]).toBe("-- ROLLOUT (enforced order, W09 fix round 2): apply 0309 -> merge + deploy the W09 PR -> older deployments drain -> apply 0310.");
    for (const k of ["-- Provenance:", "-- WHAT:", "-- WHY IT WAITS FOR THE DRAIN", "-- EXISTING ROWS:", "-- CONSUMERS:", "-- DEPENDS ON:", "-- IDEMPOTENT:", "-- PRE-FLIGHT", "-- VERIFY AFTER APPLY:"]) expect(src).toContain(k);
  });

  it("the pre-flight refuses unless 0309's save_pm_employee_eval exists (and refuses self_evaluation)", () => {
    const pre = code.indexOf("to_regprocedure('public.save_pm_employee_eval(uuid,uuid,uuid,uuid,text,text,text,text,text,text)') is null");
    expect(pre).toBeGreaterThan(0);
    expect(code).toContain("raise exception '0310: 0309 (save_pm_employee_eval) must be applied first, and the W09 deploy must have drained';");
    expect(pre).toBeLessThan(code.indexOf("create or replace function public.pm_employee_evals_no_self()"));
  });

  it("INSERT-only trigger, never a CHECK; callable by nobody; nothing else changes", () => {
    expect(code).toContain("create trigger pm_employee_evals_no_self before insert on public.pm_employee_evals\n  for each row execute function public.pm_employee_evals_no_self();");
    expect(code).toContain("if new.author_id = new.employee_id then raise exception 'self_evaluation'; end if;");
    expect(code).toContain("revoke all on function public.pm_employee_evals_no_self() from public, anon, authenticated, service_role;");
    expect(code).not.toMatch(/add constraint|check\s*\(\s*author_id|before\s+update|\bupdate\s+public\.|\bdelete\s+from\b|\bgrant\s+/i);
  });

  it("the executable proof (PGlite: the REAL 0271 + 0309 + 0310) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0310.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("T0 without 0309 the preflight refuses");
    expect(out).toContain("T1 the trigger refuses a direct self INSERT");
    expect(out).toContain("T3 superseding an OLD self-written row still works under the trigger");
    expect(out).toContain("T4 HAZARD: the OLD writer + this trigger leaves NO live eval");
    expect(out).toContain("PASS 0310:");
  }, 260_000);
});
