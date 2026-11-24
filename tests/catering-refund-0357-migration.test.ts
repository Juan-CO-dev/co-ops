/**
 * Migration 0357 (catering refund requests) pinned BY NAME. FILE ONLY — CC applies sim then prod on Juan's word.
 * Pins the house header and gate line, one transaction, that it is the only 0357, that it alters nothing that exists,
 * holds the TS vocabularies (reasons, triggers, statuses, the refusal names, the actor roles, the audit name) to the
 * SQL, and runs the offline PGlite proof (scripts/sql-harness-0357.mjs, the REAL file).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS, RESERVED_ACTIONS } from "@/lib/audit-actions";
import {
  MAX_REFUND_NOTE,
  REFUND_REASON_CODES,
  REFUND_ROLES,
  REFUND_SQL_REFUSALS,
  REFUND_STATUSES,
  REFUND_TRIGGERS,
} from "@/lib/catering/refunds-shared";

const NAME = "0357_catering_refund_requests";
const sql = readFileSync(`supabase/migrations/${NAME}.sql`, "utf8").replace(/\r\n/g, "\n");
const code = sql.replace(/--[^\n]*/g, "");
const list = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
const fn = (name: string) => {
  const m = code.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`));
  if (!m) throw new Error(`function ${name} not found`);
  return m[0];
};

describe("0357 header and shape", () => {
  it("gate header, one transaction, file only, the number explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe(`-- Migration ${NAME}`);
    expect(lines[1]).toBe("-- AUTHORED 2026-11-23 (refund build, CC bench Opus, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.");
    // A later APPLIED stamp goes UNDER the gate line, never instead of it.
    expect(lines.slice(2, 6).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l))).toBe(true);
    expect(sql).toMatch(/0355 is reserved for the all-shops access build/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
  });

  it("is the ONLY file numbered 0357", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0357_"))).toEqual([`${NAME}.sql`]);
  });

  it("purely additive: one table, four functions, one trigger on its own table; nothing existing is altered", () => {
    expect(code.match(/^create table public\.[a-z_]+/gm)).toEqual(["create table public.catering_refund_requests"]);
    expect(code.match(/^create function public\.[a-z_]+/gm)).toEqual([
      "create function public.catering_refund_requests_guard",
      "create function public.catering_refund_actor_ok",
      "create function public.catering_refund_figures",
      "create function public.catering_refund_reserve",
    ]);
    expect(code.match(/^create trigger [a-z_]+ [^\n]+/gm)).toEqual(["create trigger catering_refund_requests_guard before update on public.catering_refund_requests"]);
    expect(code).not.toMatch(/\balter table public\.(?!catering_refund_requests)/);
    expect(code).not.toMatch(/\bcreate or replace\b/);
    expect(code).not.toMatch(/\bdrop\b/);
    expect(code).not.toMatch(/^\s*(update|delete from)\s+public\./m);
  });

  it("the privilege ceiling: deny-all RLS, service_role SELECT + outcome-column UPDATE, functions service_role only", () => {
    expect(code).toContain("alter table public.catering_refund_requests enable row level security;");
    expect(code).toContain("revoke all on table public.catering_refund_requests from public, anon, authenticated, service_role;");
    expect(code).toContain("grant select on table public.catering_refund_requests to service_role;");
    expect(code).not.toMatch(/grant (insert|delete|all)/);
    expect(code).not.toMatch(/create policy/);
    for (const f of ["catering_refund_actor_ok(uuid, uuid)", "catering_refund_figures(uuid)", "catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)"]) {
      expect(code).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${f} to service_role;`);
    }
    for (const f of ["catering_refund_actor_ok", "catering_refund_figures", "catering_refund_reserve"]) {
      expect(fn(f)).toMatch(/security definer set search_path = pg_catalog, public/);
    }
  });
});

describe("the vocabularies are the SQL's", () => {
  it("reasons, triggers and statuses", () => {
    const table = code.slice(code.indexOf("create table public.catering_refund_requests"), code.indexOf("create index"));
    const check = (col: string) => list(table.match(new RegExp(`\\n  ${col}\\s+text[^\\n]*?check \\([\\s\\S]*?\\)\\)`))![0]);
    expect(check("reason_code")).toEqual([...REFUND_REASON_CODES]);
    expect(check("trigger_kind")).toEqual([...REFUND_TRIGGERS]);
    expect(check("status")).toEqual(["pending", ...REFUND_STATUSES]);
    expect(table).toContain(`length(reason_note) between 1 and ${MAX_REFUND_NOTE}`);
    // The reserve validates the same reason list it inserts.
    expect(list(fn("catering_refund_reserve").match(/p_reason_code not in\s*\([^)]*\)/)![0])).toEqual([...REFUND_REASON_CODES]);
  });

  it("every refusal the reserve raises is mapped by name", () => {
    const raised = [...fn("catering_refund_reserve").matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]!);
    expect([...new Set(raised)].sort()).toEqual(Object.keys(REFUND_SQL_REFUSALS).sort());
  });

  it("the actor rule's roles are the app gate's", () => {
    const body = fn("catering_refund_actor_ok");
    const roles = [...body.matchAll(/v_role in \(([^)]*)\)/g)].flatMap((m) => list(m[1]!));
    expect(roles.sort()).toEqual([...REFUND_ROLES].sort());
    expect(body).toMatch(/v_role in \('moo', 'catering_mgr'\) and p_shop_id is not null and exists \(\s*select 1 from public\.user_locations m where m\.user_id = p_actor_id and m\.location_id = p_shop_id and m\.active\)/);
  });

  it("the audit row: catering.refund.request, destructive, SQL-only (reserved); the Stripe answer is an observation", () => {
    expect(fn("catering_refund_reserve")).toContain("'catering.refund.request', 'catering_refund_requests', v_new");
    expect(fn("catering_refund_reserve")).toMatch(/'full', p_amount_cents is null\), true\);/);
    expect((DESTRUCTIVE_ACTIONS as readonly string[]).includes("catering.refund.request")).toBe(true);
    expect((RESERVED_ACTIONS as readonly string[]).includes("catering.refund.request")).toBe(true);
    expect((NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("catering.refund.stripe_result")).toBe(true);
    expect(fn("catering_refund_reserve")).not.toMatch(/'note',|reason_note', /);
  });

  it("the locks come before every figure and before the token replay", () => {
    const body = fn("catering_refund_reserve");
    const lock = body.indexOf("for no key update");
    expect(lock).toBeGreaterThan(0);
    expect(body.indexOf("where r.client_token = p_client_token")).toBeGreaterThan(lock);
    expect(body.indexOf("catering_refund_figures(v_row.id)")).toBeGreaterThan(lock);
    expect(body).toMatch(/order by p\.id for no key update/);
  });
});

describe("the executable proof", () => {
  it("scripts/sql-harness-0357.mjs (PGlite, the REAL 0127 / 0120 / 0333 DDL + 0357) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0357.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0357:");
  }, 260_000);
});
