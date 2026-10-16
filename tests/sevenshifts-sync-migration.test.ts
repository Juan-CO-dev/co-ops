/** Scheduling Phase 1 — migration 0268 pinned: header, the executable PGlite proof, the 0243 lease re-emit, the shapes. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMods, extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";
import { MIRROR_WRITE_SPEC } from "@/lib/sevenshifts/mirror-spec-shared";

const src = normalize(readFileSync("supabase/migrations/0268_sevenshifts_sync.sql", "utf8"));
const src0243 = normalize(readFileSync("supabase/migrations/0243_cron_route_leases.sql", "utf8"));

describe("0268_sevenshifts_sync", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0268_sevenshifts_sync"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, BEFORE SEVENSHIFTS_SYNC=1\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-20 (schema_migrations version 20261020000001, name 'sevenshifts_sync')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the REAL 0243 + 0268 on synthetic rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0268.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0268:");
  }, 260_000);

  it("claim_cron_route is 0243's body with exactly the job list extended (nothing else moved)", () => {
    const body = (s: string) => extractFunction(s, "function public.claim_cron_route(p_job text)", "end $$;");
    const expected = applyMods(body(src0243), [[
      "p_job not in ('toast-sales-today', 'toast-catering-scan')",
      "p_job not in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync')",
    ]]);
    expect(body(src)).toBe(expected);
    expect(src).toContain("create or replace function public.claim_cron_route(p_job text)");
    expect(src).toContain("add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync'))");
    expect(src).toMatch(/revoke all on function public\.claim_cron_route\(text\) from public, anon, authenticated;\ngrant execute on function public\.claim_cron_route\(text\) to service_role;/);
  });

  it("every upsert mirror's conflict key is a primary key in the migration (MIRROR_WRITE_SPEC)", () => {
    for (const spec of Object.values(MIRROR_WRITE_SPEC)) {
      if (spec.mode !== "upsert") continue;
      const table = extractFunction(src, `create table public.${spec.table} (`, "\n);");
      expect(table).toMatch(new RegExp(`\\n  ${spec.onConflict[0]}\\s+bigint\\s+primary key`));
      for (const col of spec.columns) expect(table, `${spec.table}.${col}`).toMatch(new RegExp(`\\n  ${col}\\s`));
    }
  });

  it("users carry employee_id (≤ 64), CC's ruling; the reconciled mirrors keep one live row per identity", () => {
    expect(src).toContain("employee_id          text        check (char_length(employee_id) <= 64)");
    expect(src).toContain("create unique index sevenshifts_user_assignments_one_live on public.sevenshifts_user_assignments (edge_key) where active;");
    expect(src).toContain("create unique index sevenshifts_wages_one_live on public.sevenshifts_wages (user_id, wage_id, upcoming) where active;");
  });

  it("the reconciler is SECURITY DEFINER with a pinned search_path, locks per (kind, user), and service_role only", () => {
    const fn = extractFunction(src, "create function public.reconcile_sevenshifts_user_snapshot(", "end $$;");
    expect(fn).toContain("security definer set search_path = pg_catalog, public");
    expect(fn).toContain("pg_advisory_xact_lock(hashtextextended('sevenshifts-snap/' || p_kind || '/' || p_user::text, 0))");
    expect(fn.indexOf("if not p_complete then")).toBeLessThan(fn.indexOf("set active = false"));
    expect(src).toContain("revoke all on function public.reconcile_sevenshifts_user_snapshot(uuid, bigint, text, boolean, jsonb) from public, anon, authenticated;");
    expect(src).toContain("grant execute on function public.reconcile_sevenshifts_user_snapshot(uuid, bigint, text, boolean, jsonb) to service_role;");
  });
});
