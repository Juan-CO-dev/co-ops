/**
 * Audit W22 (B122, B120, B205, B201) — migration 0329 pinned: the house header and gate line, the executable PGlite
 * proof, the lead row lock, the service_role-only grants (the backfill: no API role), no table change, and the lib
 * calling exactly these signatures with the previous path only on a missing function.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/migrations/0329_catering_prep_demand_lifecycle.sql", "utf8").replace(/\r\n/g, "\n");
const prepLib = readFileSync("lib/catering/prep-demand.ts", "utf8");
const pipelineLib = readFileSync("lib/catering/pipeline.ts", "utf8");
const ltoLib = readFileSync("lib/catering/lto.ts", "utf8");

describe("0329_catering_prep_demand_lifecycle", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0329_catering_prep_demand_lifecycle"
        && /^-- AUTHORED 2026-11-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO SIM 2026-11-16 (schema_migrations version 20261116000001, name 'catering_prep_demand_lifecycle')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the REAL parent DDL + 0329 on synthetic rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0329.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0329:");
  }, 260_000);

  it("one transaction; reserve, settle and reschedule lock the lead row FIRST; definer + pinned search_path", () => {
    expect(src).toMatch(/\nbegin;\n/);
    expect(src.trimEnd().endsWith("commit;")).toBe(true);
    expect(src.match(/select \* into v_lead from public\.catering_pipeline where id = p_(pipeline|lead)_id for update;/g)).toHaveLength(3);
    expect(src.match(/security definer set search_path = pg_catalog, public as \$\$/g)).toHaveLength(5);
    expect(src).not.toMatch(/pg_advisory/);
    // reserve re-checks under the lock
    expect(src).toContain("if v_lead.stage is distinct from 'confirmed' then");
    expect(src).toContain("if v_quote.id is distinct from p_quote_id then return jsonb_build_object('result', 'quote_changed'); end if;");
    // settle re-checks the CURRENT stage under the lock (fix round 1: a delayed release after a re-confirm)
    expect(src).toContain("if not ((p_to = 'consumed' and coalesce(v_lead.stage, '') in ('out', 'completed'))");
    expect(src).toContain("or (p_to = 'released' and coalesce(v_lead.stage, '') in ('lost', 'inquiry', 'quote_sent'))) then");
    expect(src).toContain("return jsonb_build_object('result', 'stage_changed', 'stage', v_lead.stage);");
  });

  it("no table, policy or grant on a table changes; applying it changes no row", () => {
    expect(src).not.toMatch(/\n\s*(alter|drop|create) table/i);
    expect(src).not.toMatch(/\n\s*create (policy|index|trigger)/i);
    expect(src).not.toMatch(/grant (select|insert|update|delete|all) on (table )?public\./i);
    // The only top-level statements: the preflight DO, five create function, the privilege DO.
    const body = src.slice(src.indexOf("\nbegin;\n"));
    const outside = body.replace(/\$\$[\s\S]*?\$\$/g, "$$").split("\n").filter((l) => /^(insert|update|delete|truncate)\b/i.test(l));
    expect(outside).toEqual([]);
  });

  it("writers execute for service_role only; the backfill for NO API role; all asserted in the migration", () => {
    expect(src).toContain("execute format('revoke all on function %s from public, anon, authenticated, service_role', f);");
    expect(src.match(/execute format\('grant execute on function %s to service_role', f\);/g)).toHaveLength(1);
    expect(src).toContain("and not has_function_privilege('service_role', f, 'EXECUTE'), '0329: backfill privilege escape';");
  });

  it("the lib reserves and settles through the RPCs and falls back ONLY when the function is missing", () => {
    expect(prepLib).toContain('sb.rpc("reserve_catering_prep_demand", {');
    expect(prepLib).toContain('sb.rpc("settle_catering_prep_demand", { p_pipeline_id: pipelineId, p_to: to })');
    expect(src).toContain("create function public.settle_catering_prep_demand(p_pipeline_id uuid, p_to text)");
    expect(prepLib).toContain('error.code === "PGRST202" || error.code === "42883"');
    for (const arg of ["p_pipeline_id", "p_quote_id", "p_rows", "p_actor_id"]) {
      expect(prepLib).toContain(`${arg}:`);
      expect(src).toContain(arg);
    }
  });

  it("the lib reschedules and creates LTO events through the RPCs, falling back ONLY when the function is missing", () => {
    expect(pipelineLib).toContain('sb.rpc("reschedule_catering_lead", { p_lead_id: id, p_event_date: eventDate, p_actor_id: actorId })');
    expect(pipelineLib).toContain('error.code === "PGRST202" || error.code === "42883"');
    expect(ltoLib).toContain('sb.rpc("create_lto_event", { p_actor_id: actor.user.id, p_event: event, p_items: itemRows })');
    expect(ltoLib).toContain('error.code === "PGRST202" || error.code === "42883"');
    for (const arg of ["p_lead_id", "p_event_date", "p_event", "p_items"]) expect(src).toContain(arg);
  });

  it("the backfill is never called by app code (CC runs it with the manifest)", () => {
    for (const lib of [prepLib, pipelineLib, ltoLib]) expect(lib).not.toContain("catering_prep_demand_backfill_stale");
  });
});
