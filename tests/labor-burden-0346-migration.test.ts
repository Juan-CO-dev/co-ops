// 0346 (board two labor views PR 2): the burden "follow the company" row + the optional labor.hourlyTargetPct key.
// Offline (PGlite): the REAL parents + 0338 + 0339 + 0340 + 0345, 0274's json helpers and 0286's structure
// validator (extracted, never retyped), then the REAL 0346.
//  - with no follow row the burden every shop-week reads is 0338's (read before and after the apply);
//  - a shop row that follows the company ends the shop's own rate from its date on, and only from it;
//  - the new writer: Sunday starts only, the expected head, already-following, role, ceilings, ONE audit row;
//  - the pre-flight (0345 missing, a drifted body, a second apply);
//  - valid_schedule_structure is 0286's body plus the optional key, and the SQL and TS validators agree.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { M0338, M0345, freshLaborParents, M0339, M0340 } from "./helpers/fact-0338-parents";
import { A, B, GMU, MGR, W, laborPlanDb, type LaborPlanDb } from "./helpers/labor-plan-fixture";
import { validScheduleStructure } from "@/lib/scheduling/structure-shared";
import { burdenFor, type BurdenRow } from "@/lib/facts/labor-burden-shared";
import { crewStructureCases, loadStructureCases, materializeStructureCase } from "../scripts/schedule-structure-cases.mjs";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const M0346 = read("0346_labor_burden_follow_company.sql");
const M0274 = read("0274_schedule_settings.sql");
const M0286 = read("0286_schedule_backup_cover_week_cap.sql");
const md5 = (s: string) => createHash("md5").update(s.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
function prosrc(sql: string, name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf("$$", start) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
}
function structureFn(sql: string): string {
  const start = sql.indexOf("create or replace function public.valid_schedule_structure(");
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}
/** 0274's json helpers, as written there (each is one `language sql` function ending in a `$$;` line). */
const HELPERS = ["schedule_json_num", "schedule_json_int", "schedule_json_quarter", "schedule_json_qhours", "schedule_json_exact_keys",
  "schedule_role_codes", "schedule_role_list_ok"].map((n) => {
  const m = M0274.match(new RegExp(`create function public\\.${n}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!m) throw new Error(`${n} not found in 0274`);
  return m[0];
});
const STRUCTURE_ACL = `revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated;
  grant execute on function public.valid_schedule_structure(jsonb) to service_role;`;
async function withStructureParents(f: { db: LaborPlanDb["db"] }) {
  for (const h of HELPERS) await f.db.exec(h);
  await f.db.exec(structureFn(M0286));
  await f.db.exec(STRUCTURE_ACL);
}

let f: LaborPlanDb;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => f.q<T>(sql, params);
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (f.db.isInTransaction()) await f.db.exec("rollback"); }
}
const C = "00000000-0000-4000-8000-0000000000cc";
const WEEKS = ["2026-07-19", "2026-08-02", "2026-09-06", W, "2026-11-01", "2099-01-04"];
const burdens = async () => {
  const out: unknown[] = [];
  for (const loc of [A, B, C]) for (const w of WEEKS) out.push([loc, w, (await q("select * from fact_labor_burden_for($1, $2)", [loc, w]))[0]]);
  return out;
};
const cost = (loc: string) => q("select * from fact_labor_cost($1, $2, '2026-10-10', 'first_known')", [loc, W]);
const burden = async (loc: string, week: string) => {
  const r = (await q<{ burden_pct: string; burden_basis: string }>("select * from fact_labor_burden_for($1, $2)", [loc, week]))[0]!;
  return [Number(r.burden_pct), r.burden_basis];
};
const head = async (loc: string | null) => (await q<{ id: string }>(
  "select id from labor_burden_settings where location_id is not distinct from $1 order by created_at desc, id desc limit 1", [loc]))[0]?.id ?? null;
/** The new writer, bound to the scope's current head unless one is given. */
const save = async (actor: string, loc: string | null, o: { follow?: boolean; pct?: number | null; from: string; source?: string | null; note?: string | null; expected?: string | null }) =>
  (await q<{ id: string }>("select save_labor_burden($1, $2, $3, $4, $5, $6, $7, $8) id", [actor, loc, o.follow ?? false, o.pct ?? null, o.from,
    o.source === undefined ? (o.follow ? null : "payroll") : o.source, o.note ?? null, o.expected === undefined ? await head(loc) : o.expected]))[0]!.id;
const audits = async () => (await q<{ n: number }>("select count(*)::int n from audit_log where action = 'labor_burden.save'"))[0]!.n;

let before: unknown[]; let costBefore: unknown[];

beforeAll(async () => {
  f = await laborPlanDb();
  await f.db.exec(M0345);
  await withStructureParents(f);
  await q("insert into locations(id) values($1)", [C]);
  // 0338's writer (any date): a company payroll rate from the floor, a later company rate, a shop override.
  await q("select save_labor_burden($1, null, 10, '2026-07-19', 'payroll', 'register')", [MGR]);
  await q("select save_labor_burden($1, null, 11, '2026-09-02', 'payroll', null)", [MGR]);
  await q("select save_labor_burden($1, $2, 15.5, '2026-08-02', 'estimated', null)", [MGR, B]);
  before = await burdens();
  costBefore = [await cost(A), await cost(B)];
  await f.db.exec(M0346);
}, 240_000);

describe("0346 static shape", () => {
  it("one transaction; the header says authored, not applied; the pre-flight names 0338's two bodies", () => {
    expect(M0346).toMatch(/^begin;$/m);
    expect(M0346.trimEnd().endsWith("commit;")).toBe(true);
    expect(M0346.split("\n")[1]).toMatch(/^-- AUTHORED 2026-11-18 .*NOT YET APPLIED/);
    expect(M0346).toContain(`'${md5(prosrc(M0338, "save_labor_burden"))}'`);
    expect(M0346).toContain(`'${md5(prosrc(M0338, "fact_labor_burden_for"))}'`);
    for (const later of [M0339, M0340, M0345]) expect(later).not.toMatch(/function public\.(save_labor_burden|fact_labor_burden_for)\(/);
  });
  it("writes no row and deletes nothing; the pricer is not re-emitted", () => {
    expect(M0346).not.toMatch(/delete from|truncate (table )?public|update public\./i);
    expect(M0346.match(/insert into public\.(\w+)/g)).toEqual(["insert into public.labor_burden_settings", "insert into public.audit_log"]);
    expect(M0346).not.toMatch(/function public\.fact_labor_cost/);
  });
});

describe("A. with no follow row the burden is 0338's", () => {
  it("every shop-week reads the same burden, and the priced rows are identical", async () => {
    expect(await burdens()).toEqual(before);
    expect([await cost(A), await cost(B)]).toEqual(costBefore);
    expect(await burden(A, W)).toEqual([11, "payroll"]);
    expect(await burden(B, W)).toEqual([15.5, "estimated"]);
    expect(await burden(B, "2026-07-19")).toEqual([10, "payroll"]); // before the shop's own row: the company's
    expect(await burden(C, "2099-01-04")).toEqual([11, "payroll"]);
  });
  it("0338's writer is gone; the table is still read-only for service_role", async () => {
    expect((await q<{ x: string | null }>("select to_regprocedure('public.save_labor_burden(uuid,uuid,numeric,date,text,text)')::text x"))[0]!.x).toBeNull();
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect((await q<{ x: boolean }>(`select has_table_privilege('service_role', 'public.labor_burden_settings', '${p}') x`))[0]!.x).toBe(false);
    }
    for (const fn of ["save_labor_burden(uuid,uuid,boolean,numeric,date,text,text,uuid)", "fact_labor_burden_for(uuid,date)", "valid_schedule_structure(jsonb)"]) {
      const [r] = await q<{ s: boolean; a: boolean; u: boolean }>(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') s,
        has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') u`);
      expect(r, fn).toEqual({ s: true, a: false, u: false });
    }
  });
});

describe("A. follow the company from a date", () => {
  it("ends the shop's own rate from that Sunday on, and only from it; a later override starts again", async () => {
    const n = await audits();
    const id = await save(MGR, B, { follow: true, from: "2026-10-04", note: "back to the company rate" });
    expect(await burden(B, "2026-09-27")).toEqual([15.5, "estimated"]); // the week before: still the shop's
    expect(await burden(B, W)).toEqual([11, "payroll"]);                // from the date: the company's
    expect(await burden(B, "2099-01-04")).toEqual([11, "payroll"]);
    expect((await cost(B))[0]).toMatchObject({ burden_pct: "11.00", burden_basis: "payroll" }); // through 0345's pricer, untouched
    expect(await audits()).toBe(n + 1);
    const [a] = await q<Record<string, unknown>>("select * from audit_log where resource_id = $1", [id]);
    expect(a).toMatchObject({ actor_id: MGR, actor_role: "moo", action: "labor_burden.save", resource_table: "labor_burden_settings", destructive: true,
      before_state: { burden_pct: 15.5, source: "estimated", scope: "shop" },
      after_state: { follow_company: true, burden_pct: 11, source: "payroll", valid_from: "2026-10-04", location_id: B },
      metadata: { scope: "shop", location_id: B, valid_from: "2026-10-04", follow_company: true, has_note: true } });
    expect(JSON.stringify(a)).not.toContain("back to the company rate");
    // the company rate moves: the following shop moves with it
    await save(MGR, null, { pct: 12.5, from: "2026-11-01" });
    expect(await burden(B, "2026-11-01")).toEqual([12.5, "payroll"]);
    expect(await burden(B, W)).toEqual([11, "payroll"]);
    // a new shop rate later: the shop's own again from there
    await save(MGR, B, { pct: 9, from: "2026-11-08", source: "payroll" });
    expect(await burden(B, "2026-11-08")).toEqual([9, "payroll"]);
    expect(await burden(B, "2026-11-01")).toEqual([12.5, "payroll"]);
  });
  it("a follow row is a shop's, with no rate of its own; nothing to end is refused by name", async () => {
    await refuses(save(MGR, null, { follow: true, from: "2026-10-04" }), "labor_burden_invalid");
    await refuses(save(MGR, B, { follow: true, pct: 10, from: "2026-11-15", source: null }), "labor_burden_invalid");
    await refuses(save(MGR, B, { follow: true, from: "2026-11-15", source: "payroll" }), "labor_burden_invalid");
    await refuses(save(MGR, A, { follow: true, from: "2026-10-04" }), "labor_burden_already_following"); // A never had its own rate
    await refuses(save(MGR, B, { follow: true, from: "2026-10-11" }), "labor_burden_already_following"); // B already follows that week
    await refuses(save(MGR, B, { follow: true, from: "2026-07-19" }), "labor_burden_already_following"); // before B's own rate
    await refuses(q("insert into labor_burden_settings(location_id, valid_from, created_by, follows_company) values (null, '2026-10-04', $1, true)", [MGR]),
      "labor_burden_settings_rate_or_follow");
    await refuses(q("insert into labor_burden_settings(location_id, valid_from, created_by, follows_company, burden_pct, source) values ($2, '2026-10-04', $1, true, 5, 'payroll')", [MGR, B]),
      "labor_burden_settings_rate_or_follow");
    await refuses(q("insert into labor_burden_settings(location_id, valid_from, created_by) values ($2, '2026-10-04', $1)", [MGR, B]), "labor_burden_settings_rate_or_follow");
  });
});

describe("A. the writer's rules", () => {
  it("a start is a Sunday on or after the labor history's first week", async () => {
    for (const bad of ["2026-10-05", "2026-10-10", "2026-07-12", "2026-07-01"]) await refuses(save(MGR, A, { pct: 10, from: bad }), "labor_burden_invalid_date");
    await save(MGR, C, { pct: 14, from: "2026-07-19", source: "estimated" });
    expect(await burden(C, "2026-07-19")).toEqual([14, "estimated"]);
  });
  it("a rate is 0 to 50 with a source; only the owner, the CGS and the MoO write", async () => {
    const n = await audits();
    for (const pct of [-1, 50.01, null]) await refuses(save(MGR, A, { pct, from: "2026-10-04" }), "labor_burden_invalid");
    await refuses(save(MGR, A, { pct: 10, from: "2026-10-04", source: "guess" }), "labor_burden_invalid");
    await refuses(save(MGR, A, { pct: 10, from: "2026-10-04", source: null }), "labor_burden_invalid");
    await refuses(save(MGR, "00000000-0000-4000-8000-00000000dead", { pct: 10, from: "2026-10-04", expected: null }), "labor_burden_invalid");
    await refuses(save(MGR, A, { pct: 10, from: "2026-10-04", note: "x".repeat(501) }), "labor_burden_invalid");
    await refuses(save(GMU, A, { pct: 10, from: "2026-10-04" }), "labor_burden_forbidden");
    await refuses(q("select save_labor_burden(null, $1, false, 10, '2026-10-04', 'payroll', null, null)", [A]), "labor_burden_forbidden");
    await q("update users set active = false where id = $1", [MGR]);
    await refuses(save(MGR, A, { pct: 10, from: "2026-10-04" }), "labor_burden_forbidden");
    await q("update users set active = true where id = $1", [MGR]);
    expect(await audits()).toBe(n); // a refusal writes no audit row and no setting
  });
  it("a save is bound to the head the person saw: another save in between is labor_burden_moved", async () => {
    const seen = await head(A);
    expect(seen).toBeNull();
    const first = await save(MGR, A, { pct: 13, from: "2026-10-04", expected: seen });
    await refuses(save(MGR, A, { pct: 14, from: "2026-10-04", expected: seen }), "labor_burden_moved");
    await refuses(save(MGR, A, { pct: 14, from: "2026-10-04", expected: await head(null) }), "labor_burden_moved"); // another scope's head
    expect(await burden(A, W)).toEqual([13, "payroll"]);
    const [a] = await q<Record<string, unknown>>("select before_state, after_state from audit_log where resource_id = $1", [first]);
    expect(a).toMatchObject({ before_state: { burden_pct: 11, source: "payroll", scope: "company" }, after_state: { follow_company: false, burden_pct: 13 } });
    // a correction for the same date: the newer row wins, and the audit row's before is the row it replaced
    const second = await save(MGR, A, { pct: 13.25, from: "2026-10-04", source: "estimated" });
    expect(await burden(A, W)).toEqual([13.25, "estimated"]);
    expect((await q<Record<string, unknown>>("select before_state from audit_log where resource_id = $1", [second]))[0])
      .toMatchObject({ before_state: { burden_pct: 13, scope: "shop", row_id: first } });
  });
  it("with no row at all the before state is the 12% estimated default", async () => {
    const D = "00000000-0000-4000-8000-0000000000dd";
    await q("insert into locations(id) values($1)", [D]);
    expect(await burden(D, "2026-07-19")).toEqual([10, "payroll"]);
    // a database with no company row: the default
    const g = await laborPlanDb();
    await g.db.exec(M0345); await withStructureParents(g); await g.db.exec(M0346);
    expect((await g.q("select * from fact_labor_burden_for($1, $2)", [A, W]))[0]).toEqual({ burden_pct: "12.00", burden_basis: "estimated" });
    const id = (await g.q<{ id: string }>("select save_labor_burden($1, $2, false, 14, '2026-07-19', 'estimated', null, null) id", [MGR, A]))[0]!.id;
    expect((await g.q("select before_state from audit_log where resource_id = $1", [id]))[0])
      .toMatchObject({ before_state: { burden_pct: 12, source: "estimated", scope: "default" } });
  }, 240_000);
});

describe("the TS twin", () => {
  it("burdenFor (the card) reads what fact_labor_burden_for (the pricer) reads, for every shop-week of this database", async () => {
    const raw = await q<Record<string, unknown>>("select id, location_id, burden_pct, source, valid_from::text valid_from, follows_company, created_at::text created_at, created_by from labor_burden_settings");
    expect(raw.some((r) => r.follows_company)).toBe(true);
    const rows: BurdenRow[] = raw.map((r) => ({ id: String(r.id), location_id: r.location_id as string | null, burden_pct: r.burden_pct === null ? null : Number(r.burden_pct),
      source: r.source as BurdenRow["source"], valid_from: String(r.valid_from), follows_company: r.follows_company === true, created_at: String(r.created_at),
      created_by: r.created_by as string | null, has_note: false }));
    for (const loc of [A, B, C]) for (const w of [...WEEKS, "2026-09-27", "2026-10-11", "2026-11-08", "2026-11-15"]) {
      const ts = burdenFor(rows, loc, w);
      expect([ts.pct, ts.basis], `${loc} ${w}`).toEqual(await burden(loc, w));
    }
  });
});

describe("the pre-flight", () => {
  it("a second apply is refused", async () => {
    await refuses(f.db.exec(M0346), "0346: already applied");
  });
  it("refused without 0345, on a drifted burden body, and without 0286's validator", async () => {
    const d = await freshLaborParents();
    const run = async (sql: string, code: string) => {
      try { await expect(d.exec(sql)).rejects.toThrow(code); } finally { if (d.isInTransaction()) await d.exec("rollback"); }
    };
    await d.exec(M0338); await d.exec(M0339); await d.exec(M0340);
    await run(M0346, "0346: apply 0345 first");
    await d.exec(M0345);
    await run(M0346, "0346: 0286 must be applied first");
    for (const h of HELPERS) await d.exec(h);
    await d.exec(structureFn(M0286).replace("0286 backup cover week cap", "0285 only"));
    await run(M0346, "0346: 0286 must be applied first");
    await d.exec(structureFn(M0286));
    await d.exec(`create or replace function public.fact_labor_burden_for(p_location_id uuid, p_week_start date)
      returns table(burden_pct numeric, burden_basis text) language sql stable security definer set search_path = pg_catalog, public as $$ select 13.00::numeric, 'payroll'::text $$;`);
    await run(M0346, "is not its 0338 definition");
  }, 240_000);
});

describe("B. valid_schedule_structure: 0286's body plus the optional labor.hourlyTargetPct", () => {
  const valid = async (v: unknown) => (await q<{ ok: boolean }>("select public.valid_schedule_structure($1::jsonb) ok", [JSON.stringify(v)]))[0]!.ok;
  it("the body is 0286's with the two changes removed", () => {
    const actual = structureFn(M0346)
      .replace("case when jsonb_typeof(v_lab) = 'object' then v_lab - 'hourlyTargetPct' else v_lab end", "v_lab")
      .replace(/  -- 0346 hourly target:[\s\S]*?(?=\n  -- roster)/, "");
    expect(actual).toBe(structureFn(M0286));
    expect(M0346).not.toContain("function public.valid_gap_certificate(");
  });
  it("every existing structure case is judged as before, by SQL and by TS", async () => {
    const cases: { name: string; value: unknown; valid: boolean }[] = [
      ...loadStructureCases().map((c: { name: string; valid: boolean }) => ({ name: c.name, value: materializeStructureCase(c), valid: c.valid })),
      ...crewStructureCases().map((c: { name: string; value: unknown; key: string | null }) => ({ name: c.name, value: c.value, valid: c.key === null }))];
    expect(cases.length).toBeGreaterThan(50);
    for (const c of cases) {
      expect(await valid(c.value), c.name).toBe(c.valid);
      expect(validScheduleStructure(c.value).ok, c.name).toBe(c.valid);
    }
  }, 120_000);
  it("the key: a number above 0, total basis only, never above targetPct; SQL and TS agree on every case", async () => {
    const base = (crewStructureCases() as { name: string; value: unknown }[]).find((c) => c.name === "crew")!.value as { labor: Record<string, unknown> };
    const withLabor = (labor: Record<string, unknown>) => ({ ...structuredClone(base), labor: { ...base.labor, ...labor } });
    const cases: [Record<string, unknown>, boolean][] = [
      [{}, true], [{ hourlyTargetPct: 18 }, true], [{ hourlyTargetPct: 16.5 }, true], [{ hourlyTargetPct: 28 }, true], [{ hourlyTargetPct: 0.5 }, true],
      [{ hourlyTargetPct: 28.5 }, false], [{ hourlyTargetPct: 0 }, false], [{ hourlyTargetPct: -3 }, false], [{ hourlyTargetPct: "18" }, false],
      [{ hourlyTargetPct: null }, false], [{ hourlyTargetPct: true }, false], [{ hourlyTargetPct: 101 }, false],
      [{ targetPct: 20, hourlyTargetPct: 21 }, false], [{ targetPct: 20, hourlyTargetPct: 20 }, true],
      [{ basis: "hourly", targetPct: 18 }, true], [{ basis: "hourly", targetPct: 18, hourlyTargetPct: 18 }, false],
      [{ hourlyTargetPct: 18, loadedTargetPct: 28 }, false],
    ];
    expect((base.labor as { basis: string; targetPct: number })).toMatchObject({ basis: "total", targetPct: 28 });
    for (const [labor, ok] of cases) {
      const v = withLabor(labor);
      expect(await valid(v), JSON.stringify(labor)).toBe(ok);
      const ts = validScheduleStructure(v);
      expect(ts.ok, JSON.stringify(labor)).toBe(ok);
      if (!ok && "hourlyTargetPct" in labor && !("loadedTargetPct" in labor)) expect(ts).toMatchObject({ ok: false, key: "labor.hourlyTargetPct" });
    }
    expect(await valid({ ...structuredClone(base), labor: "x" })).toBe(false);
  });
});
