/**
 * W16/B090 + B091 (+ the B094 legacy-row step) — migration 0322 pinned: the house header and gate line, the
 * fold writer's body (completion lock, stale refusal, the produced_at rule), the ACL, the bounded data step,
 * the app's caller, and the executable PGlite proof.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const m = read("supabase/migrations/0322_prep_production_completion_link.sql");
const SIG = "public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb)";
const body = (() => {
  const i = m.indexOf("create or replace function public.record_prep_production_atomic(");
  return m.slice(i, m.indexOf("end $$;", i));
})();

describe("0322_prep_production_completion_link", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const lines = m.split("\n");
    expect(lines[0]).toBe("-- Migration 0322_prep_production_completion_link");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0215\)\.$/);
    for (const h of ["-- WHAT:", "-- EXISTING ROWS:", "-- PRE-FLIGHT", "-- VERIFY AFTER APPLY:", "-- ROLLBACK:", "-- PROOF:"]) expect(m).toContain(h);
  });

  it("is one transaction with a preflight, and the column add is idempotent", () => {
    expect(m).toMatch(/\nbegin;\n/);
    expect(m.trimEnd().endsWith("commit;")).toBe(true);
    expect(m).toContain("raise exception '0322: productions is missing a 0102 / 0215 column (expected 0215 applied first)';");
    expect(m).toContain("add column if not exists completion_id uuid null references public.checklist_completions(id);");
  });

  it("B090: the writer locks the completion and refuses (writes nothing) when it is no longer the live head", () => {
    expect(body).toContain("from public.checklist_completions where id = p_completion_id for no key update;");
    const stale = body.indexOf("if c.superseded_at is not null or c.revoked_at is not null then");
    expect(stale).toBeGreaterThan(-1);
    expect(body.slice(stale, stale + 400)).toContain("'stale_completion'");
    // the refusal comes BEFORE any write
    expect(stale).toBeLessThan(body.indexOf("update public.productions set superseded_at"));
    expect(body).toContain("created_by, produced_at, completion_id,");
    expect(body.indexOf("update public.productions")).toBeLessThan(body.indexOf("insert into public.productions"));
  });

  it("B091: a single-box re-save carries the prior live header's produced_at; a batch row its session's", () => {
    expect(body).toContain("returning produced_at into v_prior_produced_at;");
    expect(body).toContain("else coalesce(v_prior_produced_at, c.completed_at) end;");
    expect(body).toContain("when p_batch is not null then (p_batch->>'produced_at')::timestamptz");
    expect(body).not.toMatch(/produced_at\s*:=\s*(now|clock_timestamp)\(\)/);
  });

  it("service_role only, definer with a pinned search_path, asserted in the file", () => {
    expect(body).toContain("security definer set search_path = pg_catalog, public");
    expect(m).toContain(`revoke all on function ${SIG} from public, anon, authenticated;`);
    expect(m).toContain(`grant execute on function ${SIG} to service_role;`);
    expect(m).toContain("raise exception '0322: record_prep_production_atomic grant escaped';");
    expect(m).toContain("raise exception '0322: PUBLIC holds EXECUTE on record_prep_production_atomic';");
  });

  it("B094: the data step deactivates (never deletes) only the two legacy business-wide rows, audited, bounded", () => {
    expect(m).not.toMatch(/delete from public\.toast_ingest_exclusions/i);
    expect(m).toContain("where location_id is null and kind = 'dining_option' and active");
    expect(m).toContain("and lower(btrim(value)) in ('ezcater', 'app catering delivery')");
    expect(m).toContain("raise exception '0322: expected at most the 2 legacy dining-option rows, matched %', n;");
    expect(m).toContain("'toast_sales.exclusion_remove', 'toast_ingest_exclusions', r.id, false,");
  });

  it("the app calls the writer with the same argument names, and falls back only on a missing function", () => {
    const src = read("lib/prep-consumption.ts");
    expect(src).toContain('sb.rpc("record_prep_production_atomic", {');
    for (const a of ["p_completion_id", "p_location_id", "p_instance_id", "p_template_item_id", "p_output_item_id",
      "p_output_qty", "p_source", "p_actor_id", "p_lines", "p_batch"]) {
      expect(src).toContain(`${a}:`);
      expect(body).toContain(a);
    }
    expect(src).toContain('error.code === "PGRST202" || error.code === "42883"');
  });

  it("the executable proof (PGlite: the REAL 0101/0102/0107 + 0215 columns + 0147 + 0322 on synthetic rows) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0322.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0322:");
  }, 260_000);
});
