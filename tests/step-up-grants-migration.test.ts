/** 0257 (authored SQL, not live integration) — catalog clock + one-shot grants. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GRANT_ACTIONS } from "@/lib/admin/step-up-shared";

const sql = readFileSync("supabase/migrations/0257_step_up_catalog_window_and_grants.sql", "utf8");

describe("0257_step_up_catalog_window_and_grants", () => {
  it("carries the house gate line", () => {
    expect(sql).toContain("NOT YET APPLIED — apply via MCP after review");
  });

  it("adds exactly one column to sessions: the catalog clock", () => {
    expect(sql).toMatch(/alter table public\.sessions\s+add column if not exists catalog_edit_unlocked_at timestamptz;/);
    expect(sql.match(/alter table public\.sessions/g)).toHaveLength(1);
  });

  it("the grant action CHECK is exactly the code's closed set", () => {
    const list = sql.match(/check \(action in \(([^)]*)\)\)/)?.[1] ?? "";
    const actions = [...list.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).sort();
    expect(actions).toEqual([...GRANT_ACTIONS].sort());
  });

  it("deny-all to the PostgREST roles; service_role revoked to zero FIRST, then exactly select/insert/update", () => {
    expect(sql).toMatch(/alter table public\.step_up_grants enable row level security;/);
    const revoke = sql.indexOf("revoke all on public.step_up_grants from public, anon, authenticated, service_role;");
    const grant = sql.indexOf("grant select, insert, update on public.step_up_grants to service_role;");
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/^\s*grant\s[^;]*\bdelete\b[^;]*;/im);
    expect(sql).not.toMatch(/on delete cascade/i);
    expect(sql).not.toMatch(/for all/i);
  });

  it("refuses to commit if a PostgREST role holds any grant, or service_role exceeds its ceiling", () => {
    expect(sql).toContain("raise exception '0257: unexpected step_up_grants table grant'");
    for (const p of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.step_up_grants', '${p}')`);
    }
    expect(sql).toContain("privilege_type not in ('SELECT', 'INSERT', 'UPDATE')");
  });

  it("changes no grant on sessions, and refuses to commit if sessions lost RLS", () => {
    expect(sql).not.toMatch(/^\s*(grant|revoke)\s[^;]*on public\.sessions/im);
    expect(sql).toContain("raise exception '0257: sessions must keep RLS enabled'");
  });
});
