// 0349 (business report access): what GMs can see, as ONE company-wide append-only setting with ONE writer.
// Offline (PGlite): the REAL parents + 0338 + 0339 + 0341, then the REAL 0349, pinned BY NAME.
//  - the pre-flights (0341 missing, a second apply);
//  - the row's shape: the SQL validator and the TS parser agree on every case of the shared case file, and the
//    validator never raises; the SQL defaults are the TS defaults;
//  - the writer: every refusal by name, the expected head, "unchanged", ONE audit row per save (before, after,
//    which switches moved), append-only;
//  - the ceilings: service_role SELECT only, the PostgREST roles nothing, EXECUTE on the writer service_role only.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { M0338, M0339, freshLaborParents } from "./helpers/fact-0338-parents";
import { GM_VISIBILITY_DEFAULTS, GM_VISIBILITY_KEYS, GM_VISIBILITY_NEEDS, gmVisibilityCombinations, parseGmVisibility } from "@/lib/business-access-shared";
import { GM_VISIBILITY_CASES } from "./fixtures/business/gm-visibility-cases";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const M0341 = read("0341_business_report_reads.sql");
const M0349 = read("0349_business_report_gm_visibility.sql");
const T = "business_report_gm_visibility";
const MOO = "00000000-0000-4000-8000-00000000aaa1", OWNER = "00000000-0000-4000-8000-00000000aaa2", CGS = "00000000-0000-4000-8000-00000000aaa3";
const GM = "00000000-0000-4000-8000-00000000aaa4", AGM = "00000000-0000-4000-8000-00000000aaa5", GONE = "00000000-0000-4000-8000-00000000aaa6";
const NOBODY = "00000000-0000-4000-8000-00000000aaa9";
const ALL_ON = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, true]));

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (db.isInTransaction()) await db.exec("rollback"); }
}
const head = async () => (await q<{ id: string }>(`select id from ${T} order by seq desc limit 1`))[0]?.id ?? null;
const save = async (actor: string | null, settings: unknown, expected?: string | null) =>
  (await q<{ id: string }>("select save_business_report_gm_visibility($1, $2::jsonb, $3) id", [actor, JSON.stringify(settings), expected === undefined ? await head() : expected]))[0]!.id;
const count = async () => (await q<{ n: number }>(`select count(*)::int n from ${T}`))[0]!.n;
const audits = () => q<Record<string, unknown>>("select * from audit_log where action = 'business_report_visibility.save' order by occurred_at, id");

async function parents(): Promise<PGlite> {
  const d = await freshLaborParents();
  await d.exec(M0338);
  await d.exec(M0339);
  await d.exec("alter table public.users add column name text");
  return d;
}

beforeAll(async () => {
  db = await parents();
  await db.exec(M0341);
  await db.exec(M0349);
  await q(`insert into users(id, role, active) values ($1,'moo',true),($2,'owner',true),($3,'cgs',true),($4,'gm',true),($5,'agm',true),($6,'moo',false)`,
    [MOO, OWNER, CGS, GM, AGM, GONE]);
}, 240_000);

describe("0349 static shape", () => {
  it("is not applied, names its gate, and writes no row", () => {
    expect(M0349).toMatch(/^-- Migration 0349_business_report_gm_visibility\n-- AUTHORED 2026-11-19 .* NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(M0349).not.toMatch(/APPLIED TO PROD/);
    expect(M0349).not.toMatch(/insert into public\.business_report_gm_visibility[^(]*\([^)]*\)\s*select/i);
    expect(M0349).toMatch(/\nbegin;\n/);
    expect(M0349.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("the writer is SECURITY DEFINER with the pinned search_path; no FOR ALL policy; no delete or update of the table anywhere", () => {
    expect(M0349).toMatch(/create function public\.save_business_report_gm_visibility\(p_actor uuid, p_settings jsonb, p_expected_id uuid\)\nreturns uuid language plpgsql security definer set search_path = pg_catalog, public/);
    expect(M0349).not.toMatch(/for all/i);
    expect(M0349).not.toMatch(/(update|delete from) public\.business_report_gm_visibility/i);
    expect(M0349.match(/insert into public\.business_report_gm_visibility/g)).toHaveLength(1);
  });
  it("the audit action it writes is in the closed vocabulary, reserved (SQL-only) and destructive", async () => {
    const { RESERVED_ACTIONS } = await import("@/lib/audit-actions");
    const { DESTRUCTIVE_ACTIONS } = await import("@/lib/destructive-actions");
    expect(RESERVED_ACTIONS as readonly string[]).toContain("business_report_visibility.save");
    expect(DESTRUCTIVE_ACTIONS as readonly string[]).toContain("business_report_visibility.save");
    expect(M0349.match(/'business_report_visibility\.save'/g)).toHaveLength(1);
  });
});

describe("pre-flights refuse by name", () => {
  it("without 0341", async () => {
    const d = await parents();
    await expect(d.exec(M0349)).rejects.toThrow("0349: apply 0341 first");
    await d.close();
  }, 240_000);
  it("a second apply", async () => {
    await refuses(db.exec(M0349), "0349: already applied");
  });
});

describe("the row's shape: SQL validator = TS parser, case by case", () => {
  it("every case of the shared file", async () => {
    for (const c of GM_VISIBILITY_CASES) {
      const sql = (await q<{ ok: boolean }>("select valid_business_report_gm_visibility($1::jsonb) ok", [JSON.stringify(c.value)]))[0]!.ok;
      expect(sql, `SQL: ${c.name}`).toBe(c.valid);
      expect(parseGmVisibility(c.value) !== null, `TS: ${c.name}`).toBe(c.valid);
    }
  });
  it("SQL NULL is false (never NULL, never an error)", async () => {
    expect((await q<{ ok: boolean | null }>("select valid_business_report_gm_visibility(null) ok"))[0]!.ok).toBe(false);
  });
  it("every coherent combination the TS enumerates is valid in SQL, and every one-switch break of the needs is not", async () => {
    for (const s of gmVisibilityCombinations()) {
      expect((await q<{ ok: boolean }>("select valid_business_report_gm_visibility($1::jsonb) ok", [JSON.stringify(s)]))[0]!.ok, JSON.stringify(s)).toBe(true);
    }
    for (const k of GM_VISIBILITY_KEYS) for (const parent of GM_VISIBILITY_NEEDS[k]) {
      const broken = { ...ALL_ON, [parent]: false, [k]: true };
      expect((await q<{ ok: boolean }>("select valid_business_report_gm_visibility($1::jsonb) ok", [JSON.stringify(broken)]))[0]!.ok, `${k} under ${parent}`).toBe(false);
    }
  });
  it("the SQL defaults are the TS defaults: everything on but the salaried side (Juan 2026-11-19)", async () => {
    const d = (await q<{ d: Record<string, boolean> }>("select business_report_gm_visibility_defaults() d"))[0]!.d;
    expect(d).toEqual(GM_VISIBILITY_DEFAULTS);
    expect(Object.keys(d).filter((k) => !d[k]).sort()).toEqual(["loaded", "person_salary"]);
    expect([d.person_cost, d.quarter_cost]).toEqual([true, true]);
  });
  it("the needs in the SQL validator are the TS needs, edge for edge", () => {
    const body = M0349.slice(M0349.indexOf("create function public.valid_business_report_gm_visibility"), M0349.indexOf("create function public.business_report_gm_visibility_defaults"));
    const sql = [...body.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}<${m[2]}`).sort();
    const ts = GM_VISIBILITY_KEYS.flatMap((k) => GM_VISIBILITY_NEEDS[k].map((p) => `${k}<${p}`)).sort();
    expect(sql).toEqual(ts);
    // ... and both key lists in the file are the twelve, in the TS order (the validator's, and the audit row's).
    const lists = [...M0349.matchAll(/array\[('report',[^\]]*)\]/g)].map((m) => m[1]!.split(",").map((x) => x.trim().replace(/'/g, "")));
    expect(lists).toHaveLength(2);
    for (const l of lists) expect(l).toEqual([...GM_VISIBILITY_KEYS]);
  });
  it("the header documents the sim re-apply of the amended file, and that prod never had the nine-switch one", () => {
    expect(M0349).toMatch(/AMENDED 2026-11-19 \(nine switches -> twelve\)\. PROD never had the nine-switch file/);
    expect(M0349).toMatch(/SIM RE-APPLY/);
    expect(M0349).toContain("delete from supabase_migrations.schema_migrations where version = '20261119230203'");
  });
  it("the table's CHECK is the validator: a bad row cannot be stored even by the owner", async () => {
    await refuses(q(`insert into ${T}(settings, created_by) values ($1::jsonb, $2)`, [JSON.stringify({ ...ALL_ON, extra: true }), MOO]), "check");
  });
});

describe("the writer", () => {
  it("refuses anyone but an active Owner / CGS / MoO, by name, and writes nothing", async () => {
    for (const actor of [GM, AGM, GONE, NOBODY, null]) await refuses(save(actor, ALL_ON, null), "business_visibility_forbidden");
    expect(await count()).toBe(0);
    expect(await audits()).toHaveLength(0);
  });
  it("refuses settings that are not the exact coherent twelve, by name", async () => {
    for (const c of GM_VISIBILITY_CASES.filter((x) => !x.valid)) await refuses(save(MOO, c.value, null), "business_visibility_invalid");
    await refuses(q("select save_business_report_gm_visibility($1, null, null)", [MOO]), "business_visibility_invalid");
    expect(await count()).toBe(0);
  });
  it("a first save equal to the defaults is 'unchanged' (the defaults are what is in force with no row)", async () => {
    await refuses(save(MOO, GM_VISIBILITY_DEFAULTS, null), "business_visibility_unchanged");
    expect(await count()).toBe(0);
  });
  it("a first save needs expected = NULL; then ONE row and ONE destructive audit row with before = the defaults", async () => {
    await refuses(save(MOO, ALL_ON, NOBODY), "business_visibility_moved");
    const id = await save(MOO, ALL_ON, null);
    expect(await head()).toBe(id);
    const rows = await q<{ settings: unknown; created_by: string }>(`select settings, created_by from ${T}`);
    expect(rows).toEqual([{ settings: ALL_ON, created_by: MOO }]);
    const a = await audits();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: MOO, actor_role: "moo", action: "business_report_visibility.save", resource_table: T, resource_id: id,
      destructive: true, before_state: GM_VISIBILITY_DEFAULTS, after_state: ALL_ON, metadata: { turned_on: ["loaded", "person_salary"], turned_off: [], first_save: true } });
  });
  it("the next save is bound to the head the person saw: a stale or missing head is 'moved', the same settings 'unchanged'", async () => {
    const first = await head();
    await refuses(save(OWNER, { ...ALL_ON, export: false }, null), "business_visibility_moved");
    await refuses(save(OWNER, { ...ALL_ON, export: false }, NOBODY), "business_visibility_moved");
    await refuses(save(OWNER, ALL_ON, first), "business_visibility_unchanged");
    expect(await count()).toBe(1);
    expect(await audits()).toHaveLength(1);
  });
  it("owner and CGS save too; the audit row names what went on and off, in the switches' own order", async () => {
    const hoursOnly = { ...ALL_ON, hourly_cost: false, loaded: false, quarter_cost: false, person_cost: false, person_salary: false, export: false };
    const second = await save(OWNER, hoursOnly);
    const third = await save(CGS, { ...hoursOnly, hourly_cost: true, compare: false });
    expect(await head()).toBe(third);
    const a = await audits();
    expect(a).toHaveLength(3);
    expect(a[1]).toMatchObject({ actor_id: OWNER, actor_role: "owner", resource_id: second, before_state: ALL_ON, after_state: hoursOnly,
      metadata: { turned_on: [], turned_off: ["hourly_cost", "loaded", "quarter_cost", "person_cost", "person_salary", "export"], first_save: false } });
    expect(a[2]).toMatchObject({ actor_id: CGS, actor_role: "cgs", resource_id: third, before_state: hoursOnly,
      metadata: { turned_on: ["hourly_cost"], turned_off: ["compare"], first_save: false } });
    expect(Object.keys(a[2]!.metadata as object).sort()).toEqual(["first_save", "turned_off", "turned_on"]);
  });
  it("append-only: three saves are three rows in seq order, none changed", async () => {
    const rows = await q<{ seq: string; created_by: string }>(`select seq, created_by from ${T} order by seq`);
    expect(rows.map((r) => r.created_by)).toEqual([MOO, OWNER, CGS]);
    expect(rows.map((r) => Number(r.seq))).toEqual([...rows.map((r) => Number(r.seq))].sort((a, b) => a - b));
  });
  it("a refused save leaves no audit row behind", async () => {
    const before = (await audits()).length;
    await refuses(save(GM, ALL_ON), "business_visibility_forbidden");
    await refuses(save(MOO, { ...ALL_ON, hourly_cost: false }), "business_visibility_invalid");
    expect((await audits()).length).toBe(before);
  });
});

describe("ceilings", () => {
  const priv = async (role: string, p: string) => (await q<{ x: boolean }>(`select has_table_privilege('${role}', 'public.${T}', '${p}') x`))[0]!.x;
  const exec = async (role: string, fn: string) => (await q<{ x: boolean }>(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') x`))[0]!.x;
  it("service_role: SELECT only", async () => {
    expect(await priv("service_role", "SELECT")).toBe(true);
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await priv("service_role", p), p).toBe(false);
  });
  it("anon and authenticated: nothing on the table", async () => {
    for (const role of ["anon", "authenticated"]) for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(await priv(role, p), `${role} ${p}`).toBe(false);
    }
  });
  it("the writer: service_role only; the validator and the defaults: nobody but the owner; nothing granted to PUBLIC", async () => {
    const W = "public.save_business_report_gm_visibility(uuid,jsonb,uuid)";
    expect(await exec("service_role", W)).toBe(true);
    for (const role of ["anon", "authenticated"]) expect(await exec(role, W), role).toBe(false);
    for (const fn of ["public.valid_business_report_gm_visibility(jsonb)", "public.business_report_gm_visibility_defaults()"]) {
      for (const role of ["service_role", "anon", "authenticated"]) expect(await exec(role, fn), `${role} ${fn}`).toBe(false);
    }
    const pub = await q(`select p.proname from pg_proc p, lateral aclexplode(p.proacl) a
      where p.proname in ('save_business_report_gm_visibility','valid_business_report_gm_visibility','business_report_gm_visibility_defaults') and a.grantee = 0`);
    expect(pub).toEqual([]);
  });
  it("RLS is on with the four deny policies", async () => {
    expect((await q<{ r: boolean }>(`select relrowsecurity r from pg_class where oid = 'public.${T}'::regclass`))[0]!.r).toBe(true);
    const pol = await q<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      `select policyname, cmd, qual, with_check from pg_policies where tablename = '${T}' order by policyname`);
    expect(pol.map((p) => [p.policyname, p.cmd, p.qual ?? p.with_check])).toEqual([
      [`${T}_no_user_delete`, "DELETE", "false"], [`${T}_no_user_insert`, "INSERT", "false"],
      [`${T}_no_user_select`, "SELECT", "false"], [`${T}_no_user_update`, "UPDATE", "false"]]);
  });
  it("as service_role: the table reads, and cannot be written except through the writer", async () => {
    await db.exec("set role service_role");
    try {
      expect((await q<{ n: number }>(`select count(*)::int n from ${T}`))[0]!.n).toBe(3);
      await refuses(q(`insert into ${T}(settings, created_by) values ($1::jsonb, $2)`, [JSON.stringify(ALL_ON), MOO]), "permission denied");
      await refuses(q(`update ${T} set settings = settings`), "permission denied");
      await refuses(q(`delete from ${T}`), "permission denied");
      const id = (await q<{ id: string }>("select save_business_report_gm_visibility($1, $2::jsonb, $3) id", [MOO, JSON.stringify(ALL_ON), await head()]))[0]!.id;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    } finally { await db.exec("reset role"); }
    expect(await count()).toBe(4);
  });
});
