/**
 * PR SCH-2 (plan r5 sections 6, 9, 20.6, 20.7): migration 0354_schedule_early_open_mode, FILE ONLY (never applied here).
 *  - the header, the pre-flight, the verify queries and the rollback text are pinned;
 *  - valid_schedule_structure is 0346's body with exactly two changes (the catering exact-keys check ignores
 *    earlyOpenMode; when present it is one of three strings), so a structure WITHOUT the key is judged exactly as 0346
 *    judged it;
 *  - the pre-flight's md5 is 0346's body's, computed the way Postgres will compute it;
 *  - offline (PGlite): 0274's json helpers + 0346's validator (extracted, never retyped), then the REAL 0354: the
 *    pre-flight refuses without 0346, on a drifted body and on a second apply; the sentinel answers {early_open_mode}
 *    to service_role only.
 * The full chain (0270 → 0274 with its table CHECK → 0346's validator → 0354), every case list and the broken variants
 * are scripts/sql-harness-0354.mjs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(n, "utf8").replace(/\r\n/g, "\n");
const M0354 = read("supabase/migrations/0354_schedule_early_open_mode.sql");
const M0346 = read("supabase/migrations/0346_labor_burden_follow_company.sql");
const M0274 = read("supabase/migrations/0274_schedule_settings.sql");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const md5 = (s: string) => createHash("md5").update(s.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
function structureFn(sql: string): string {
  const start = sql.indexOf("create or replace function public.valid_schedule_structure(");
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}
const prosrc = (fn: string) => { const open = fn.indexOf("$$") + 2; return fn.slice(open, fn.indexOf("$$", open)); };
const HELPERS = ["schedule_json_num", "schedule_json_int", "schedule_json_quarter", "schedule_json_qhours", "schedule_json_exact_keys",
  "schedule_role_codes", "schedule_role_list_ok"].map((n) => {
  const m = M0274.match(new RegExp(`create function public\\.${n}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!m) throw new Error(`${n} not found in 0274`);
  return m[0];
});
async function chainTo0346(fn = structureFn(M0346)): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB);
  for (const h of HELPERS) await db.exec(h);
  await db.exec(fn);
  await db.exec("create table public.schedule_structures (id uuid primary key default gen_random_uuid(), structure jsonb not null check (public.valid_schedule_structure(structure)));");
  return db;
}
async function refusal(db: PGlite, sql: string): Promise<string> {
  try { await db.exec(sql); return "applied"; } catch (e) { if (db.isInTransaction()) await db.exec("rollback"); return (e as Error).message; }
}

describe("0354 early open mode: the file", () => {
  it("header, pre-flight, verify and rollback text", () => {
    expect(M0354).toContain("-- AUTHORED 2026-11-21 (PR SCH-2, CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.");
    for (const section of ["-- WHAT:", "-- DEPENDS ON:", "-- DATA:", "-- ROLLOUT:", "-- PRE-FLIGHT (MCP, before apply):", "-- VERIFY AFTER APPLY:", "-- ROLLBACK (plan section 17):"]) expect(M0354).toContain(section);
    expect(M0354).toContain("raise exception '0354: 0346 must be applied first'");
    expect(M0354).toContain("raise exception '0354: already applied'");
    expect(M0354).toContain("is not its 0346 definition -- a later definer exists; re-emit from it. Refusing.");
    expect(M0354).toContain("select count(*) from public.schedule_structures where not public.valid_schedule_structure(structure);                   -- 0");
    expect(M0354).toContain("select public.schedule_structure_features();                                                                            -- {early_open_mode}");
    expect(M0354).toContain("NOT on 0353");
    expect(M0354.trimEnd().endsWith("commit;")).toBe(true);
    // File only: no data is written (no insert / update / delete statement anywhere in the file).
    expect(M0354).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it("valid_schedule_structure is 0346's body with exactly the two changes removed", () => {
    const actual = structureFn(M0354)
      .replace("v_cat - 'crewShift' - 'earlyOpenMode' else", "v_cat - 'crewShift' else")
      .replace(/  -- 0354 early open mode:[\s\S]*?(?=\n\n  -- labor)/, "")
      .replace("    return false;\n  end if;\n\n\n  -- labor", "    return false;\n  end if;\n\n  -- labor");
    expect(actual).toBe(structureFn(M0346));
    expect(structureFn(M0354)).toContain("if v_cat ? 'earlyOpenMode' and (jsonb_typeof(v_cat -> 'earlyOpenMode') <> 'string'\n     or not ((v_cat ->> 'earlyOpenMode') in ('manual', 'semi', 'auto'))) then return false; end if;");
    expect(M0354).not.toContain("function public.valid_gap_certificate(");
  });

  it("the pre-flight's md5 is 0346's body, as pg computes it (regexp_replace of every byte outside 0x21-0x7E)", () => {
    const want = md5(prosrc(structureFn(M0346)));
    expect(want).toBe("9f9617c8ed85f08d01d432f9a756374d");
    expect(M0354).toContain(`if v_live is distinct from '${want}' then`);
    expect(M0354).toContain(`'public.valid_schedule_structure(jsonb)'::regprocedure; -- ${want}`);
  });
});

describe("0354 early open mode: offline apply (PGlite)", () => {
  it("refuses without 0346's validator, on a drifted body, and on a second apply; the live body's md5 is the pinned one", async () => {
    const old = await chainTo0346(structureFn(read("supabase/migrations/0286_schedule_backup_cover_week_cap.sql")));
    expect(await refusal(old, M0354)).toContain("0354: 0346 must be applied first");
    await old.close();

    const drift = await chainTo0346(structureFn(M0346).replace("return true;\nend $$;", () => "return true; -- a later definer\nend $$;"));
    expect(await refusal(drift, M0354)).toContain("is not its 0346 definition");
    await drift.close();

    const db = await chainTo0346();
    const live = (await db.query<{ m: string }>("select md5(regexp_replace(prosrc, '[^\\x21-\\x7E]+', '', 'g')) m from pg_proc where oid = 'public.valid_schedule_structure(jsonb)'::regprocedure")).rows[0]!.m;
    expect(live).toBe("9f9617c8ed85f08d01d432f9a756374d");
    expect((await db.query<{ f: string | null }>("select to_regprocedure('public.schedule_structure_features()')::text f")).rows[0]!.f).toBeNull();
    expect(await refusal(db, M0354)).toBe("applied");
    expect((await db.query<{ f: string[] }>("select public.schedule_structure_features() f")).rows[0]!.f).toEqual(["early_open_mode"]);
    expect((await db.query<{ ok: boolean }>("select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0354 early open mode') > 0 ok")).rows[0]!.ok).toBe(true);
    for (const f of ["public.schedule_structure_features()", "public.valid_schedule_structure(jsonb)"]) {
      const p = (await db.query<{ v: string; c: string[]; a: boolean; u: boolean; s: boolean }>(
        "select provolatile v, proconfig c, has_function_privilege('anon', oid, 'EXECUTE') a, has_function_privilege('authenticated', oid, 'EXECUTE') u, has_function_privilege('service_role', oid, 'EXECUTE') s from pg_proc where oid = $1::regprocedure", [f])).rows[0]!;
      expect(p, f).toMatchObject({ a: false, u: false, s: true, c: ["search_path=pg_catalog, public"] });
      expect(p.v, f).toBe(f.includes("features") ? "s" : "i");
    }
    expect(await refusal(db, M0354)).toContain("0354: already applied");
    await db.close();
  }, 60_000);
});

describe("0354 early open mode: the full offline chain (scripts/sql-harness-0354.mjs)", () => {
  it("runs the real 0270 → 0274 → 0346 validator → 0354 and catches every broken variant", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0354.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).not.toMatch(/^FAIL /m);
    for (const line of [
      "ok   S1 before the apply save_schedule_structure refuses a mode: structure_invalid",
      "ok   S3 early list (63 cases, 12 valid): function and table CHECK agree",
      "ok   S5 the live head is valid under 0346's validator (the SQL twin of the TS validator an older deployment runs)",
      "EXPECTED FAIL 0354 broken variant: without the value check, catering.earlyOpenMode \"Auto\" is accepted",
      "EXPECTED FAIL 0354 broken variant: without the exact-keys change, catering.earlyOpenMode \"semi\" is refused",
      "EXPECTED FAIL 0354 broken variant: a sentinel granted to authenticated is refused by the file's own ceiling (0354: RPC escape)",
    ]) expect(output).toContain(line);
    expect(output).toMatch(/PASS 0354: \d+ checks/);
  }, 250_000);
});
