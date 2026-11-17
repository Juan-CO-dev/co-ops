// 0339 (Juan 2026-11-17): overtime PER EMPLOYER. The two shops are separate LLCs, so hours past 40 in a
// Sunday-Saturday week (calendar midnight ET) count per shop. Offline (PGlite, synthetic fixtures): the REAL
// parents + the REAL 0338 (as applied to prod) + the REAL 0339; the REAL builder; the one writer.
//  - the pre-flight refuses a database without 0338, a drifted 0338 body, and a second apply;
//  - weeks built before 0339 keep the scope they were built with (labor-v1 = company), are listed stale
//    by the new builder version, and their premium still blends company-wide until rebuilt;
//  - after 0339 the writer refuses a payload that does not name the scope in force;
//  - fact_labor_cost blends the overtime premium rate per (person, week, SHOP) on a per_shop week.
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildLaborWeek, laborWeekSourceFromJson } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION, type LaborOtScope } from "@/lib/facts/labor-config-shared";
import { M0338, M0339, freshLaborParents } from "./helpers/fact-0338-parents";

const RE_EMITTED = [
  { sig: "public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)", name: "fact_replace_labor_week" },
  { sig: "public.fact_labor_cost(uuid,date,date,text)", name: "fact_labor_cost" },
];
/** prosrc = the text between the dollar quotes; the fingerprint ignores everything but printable ASCII (the 0315 rule). */
function bodyOf(sql: string, name: string): string {
  const at = sql.indexOf(`create function public.${name}(`);
  const alt = sql.indexOf(`create or replace function public.${name}(`);
  const start = at >= 0 ? at : alt;
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf("$$", start) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
}
const md5 = (s: string) => createHash("md5").update(s.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");

describe("0339 static shape", () => {
  it("the pre-flight accepts exactly 0338's body of every function it re-emits", () => {
    for (const f of RE_EMITTED) expect(M0339).toContain(`('${f.sig}', '${md5(bodyOf(M0338, f.name))}')`);
    expect(M0339).toContain("md5(regexp_replace(p.prosrc, '[^\\x21-\\x7E]+', '', 'g'))");
  });
  it("re-emits with create or replace (grants kept) and is wrapped in one transaction", () => {
    for (const f of RE_EMITTED) expect(M0339).toContain(`create or replace function public.${f.name}(`);
    expect(M0339.trimEnd().endsWith("commit;")).toBe(true);
    expect(M0339).toMatch(/^begin;$/m);
  });
});

const A = "00000000-0000-4000-8000-0000000000aa", B = "00000000-0000-4000-8000-0000000000bb";
const MGR = "00000000-0000-4000-8000-0000000000f1", ALICE = "00000000-0000-4000-8000-0000000000f2";
const W1 = "2026-10-04", W2 = "2026-10-11";
const etIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (db.isInTransaction()) await db.exec("rollback"); }
}
let pid = 7000;
const punch = (user: number, loc7: number, inIso: string, outIso: string) =>
  q("insert into sevenshifts_time_punches(id, user_id, location_id, clocked_in, clocked_out, break_minutes) values($1,$2,$3,$4,$5,0)",
    [++pid, user, loc7, inIso, outIso]);
async function wage(user: number, cents: number) {
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger) values($1, 'cron')", [run]);
  await q("select reconcile_sevenshifts_user_snapshot($1, $2, 'wages', true, $3::jsonb)", [run, user,
    JSON.stringify([{ user_id: String(user), wage_id: String(user * 10), upcoming: false, effective_date: "2026-01-01", wage_type: "hourly", wage_cents: cents, role_id: null }])]);
}
async function payloadFor(week: string, version: string, otScope?: LaborOtScope) {
  const j = (await q<{ s: Record<string, unknown> }>("select fact_labor_week_source($1, $2) s", [week, version]))[0]!.s;
  const { source, fingerprint } = laborWeekSourceFromJson(j);
  return { payload: buildLaborWeek(source, otScope ? { otScope } : {}), fingerprint };
}
const replace = (week: string, version: string, fingerprint: string, p: ReturnType<typeof buildLaborWeek>, weekRow: unknown = p.week) =>
  q("select fact_replace_labor_week($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)", [week, version, fingerprint,
    JSON.stringify(p.quarters), JSON.stringify(p.days), JSON.stringify(weekRow), JSON.stringify(p.salaried)]);
async function build(week: string, version = LABOR_BUILDER_VERSION, otScope?: LaborOtScope) {
  const { payload, fingerprint } = await payloadFor(week, version, otScope);
  await replace(week, version, fingerprint, payload);
}
const otAt = async (week: string, loc: string) => (await q<{ m: number; ot: number }>(
  "select coalesce(sum(minutes),0)::int m, coalesce(sum(ot_minutes),0)::int ot from labor_quarter where week_start=$1 and location_id=$2", [week, loc]))[0]!;
const premium = async (loc: string, week: string) => Number((await q<{ p: string }>(
  "select ot_premium_cents p from fact_labor_cost($1, $2, $3, 'first_known')", [loc, week, addDays(week, 6)]))[0]!.p);
const scopeOf = async (week: string) => (await q<{ s: string }>("select ot_scope s from labor_week_coverage where week_start=$1", [week]))[0]?.s;
function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Alice holds a 7shifts account at each shop (7 at A at $20, 8 at B at $30). W1: 45 h at A (Mon-Wed 06-21),
// then 10 h at B (Thu 06-16), then a Saturday close at A across midnight (30 min Saturday). Company-wide that
// is 15.5 h overtime (5.5 at A, 10 at B); per shop it is 5.5 h at A and none at B.

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(M0338);
  await q("insert into locations(id) values($1),($2)", [A, B]);
  await q("insert into users(id, role) values($1,'moo'),($2,'employee')", [MGR, ALICE]);
  await q("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $3), ($2, 502, $3)", [A, B, MGR]);
  await q("insert into sevenshifts_user_links(sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values(7, $1, $2, $4), (8, $1, $3, $4)", [ALICE, A, B, MGR]);
  await wage(7, 2000); await wage(8, 3000);
  for (const d of ["2026-10-05", "2026-10-06", "2026-10-07"]) await punch(7, 501, etIso(d, "06:00"), etIso(d, "21:00"));
  await punch(8, 502, etIso("2026-10-08", "06:00"), etIso("2026-10-08", "16:00"));
  // A Saturday close across calendar midnight into W2.
  await punch(7, 501, etIso("2026-10-10", "23:30"), etIso("2026-10-11", "00:30"));
  // Production before 0339: W1 built by the old builder (labor-v1, company-wide); W2 by a deploy that
  // reached prod before 0339 was applied (the new builder, per shop; 0338 ignores the scope key).
  await build(W1, "labor-v1", "company");
  await build(W2, LABOR_BUILDER_VERSION, "per_shop");
  await db.exec(M0339);
}, 180_000);

describe("weeks built before 0339", () => {
  it("keep the scope they were built with: labor-v1 = company, the new builder = per_shop", async () => {
    expect(await scopeOf(W1)).toBe("company");
    expect(await scopeOf(W2)).toBe("per_shop");
    expect(await otAt(W1, A)).toEqual({ m: 2730, ot: 330 });
    expect(await otAt(W1, B)).toEqual({ m: 600, ot: 600 });
  });
  it("a company-built week still prices its premium at the company-wide blended rate (it says what it was built with)", async () => {
    expect(await premium(A, W1)).toBe(Math.round(0.5 * ((2730 * 2000 + 600 * 3000) / 3330) * 330 / 60));
    expect(await premium(B, W1)).toBe(Math.round(0.5 * ((2730 * 2000 + 600 * 3000) / 3330) * 600 / 60));
  });
  it("the bumped builder version lists every labor-v1 week stale", async () => {
    const stale = (await q<{ w: string }>("select to_char(week_start,'YYYY-MM-DD') w from fact_labor_weeks_stale(1000, $1)", [LABOR_BUILDER_VERSION])).map((r) => r.w);
    expect(stale).toContain(W1);
    expect(stale).not.toContain(W2);
  });
});

describe("after 0339", () => {
  it("the writer refuses a payload that does not name the scope in force (an old deployment, or company)", async () => {
    const { payload, fingerprint } = await payloadFor(W1, LABOR_BUILDER_VERSION);
    const noScope: Record<string, unknown> = { ...payload.week };
    delete noScope.ot_scope;
    await refuses(replace(W1, LABOR_BUILDER_VERSION, fingerprint, payload, noScope), "fact_payload_mismatch");
    await refuses(replace(W1, LABOR_BUILDER_VERSION, fingerprint, payload, { ...payload.week, ot_scope: "company" }), "fact_payload_mismatch");
    expect(await scopeOf(W1)).toBe("company");
  });
  it("a rebuild is per shop: 5 h overtime at A, none at B; the premium blends A's own minutes only", async () => {
    await build(W1);
    expect(await scopeOf(W1)).toBe("per_shop");
    expect(await otAt(W1, A)).toEqual({ m: 2730, ot: 330 });
    expect(await otAt(W1, B)).toEqual({ m: 600, ot: 0 });
    expect(await premium(A, W1)).toBe(Math.round(0.5 * 2000 * 330 / 60));
    expect(await premium(B, W1)).toBe(0);
  });
  it("the week turns over at calendar midnight ET: the Saturday close is 30 min in W1's Saturday and 30 min in W2's Sunday", async () => {
    const byDate = async (week: string) => (await q<{ d: string; m: number }>(
      "select to_char(business_date,'YYYY-MM-DD') d, sum(minutes)::int m from labor_quarter where week_start=$1 and location_id=$2 and business_date in ('2026-10-10','2026-10-11') group by 1 order by 1", [week, A]));
    expect(await byDate(W1)).toEqual([{ d: "2026-10-10", m: 30 }]);
    expect(await byDate(W2)).toEqual([{ d: "2026-10-11", m: 30 }]);
    expect((await q<{ d: string }>("select to_char(min(business_date),'YYYY-MM-DD') d from fact_labor_week_days($1)", [W2]))[0]!.d).toBe(W2);
    // The Sunday minutes start W2's counter at 0, even though W1 ended in overtime.
    expect(await otAt(W2, A)).toEqual({ m: 30, ot: 0 });
  });
  it("ot_scope has no default (the writer names it) and only the two scopes exist", async () => {
    const col = (await q<{ d: string | null; n: string }>(
      "select column_default d, is_nullable n from information_schema.columns where table_name='labor_week_coverage' and column_name='ot_scope'"))[0]!;
    expect(col).toEqual({ d: null, n: "NO" });
    await refuses(q("update labor_week_coverage set ot_scope='shop' where week_start=$1", [W1]), "labor_week_coverage_ot_scope_check");
  });
  it("the scope function is internal; the re-emitted RPCs keep the service-role-only ceiling", async () => {
    for (const r of ["service_role", "anon", "authenticated"]) {
      expect((await q<{ x: boolean }>(`select has_function_privilege('${r}', 'public.fact_labor_ot_scope()', 'EXECUTE') x`))[0]!.x, r).toBe(false);
    }
    for (const f of RE_EMITTED) {
      expect((await q<{ x: boolean }>(`select has_function_privilege('service_role', '${f.sig}', 'EXECUTE') x`))[0]!.x).toBe(true);
      expect((await q<{ x: boolean }>(`select has_function_privilege('authenticated', '${f.sig}', 'EXECUTE') x`))[0]!.x).toBe(false);
      expect((await q<{ x: boolean }>(`select has_function_privilege('anon', '${f.sig}', 'EXECUTE') x`))[0]!.x).toBe(false);
    }
  });
  it("a second apply refuses", async () => {
    await refuses(db.exec(M0339), "0339: already applied");
  });
});

describe("0339 pre-flight refusals", () => {
  it("refuses without 0338, and refuses a drifted 0338 body by name", async () => {
    const d = await freshLaborParents();
    const run = async (sql: string) => { try { await d.exec(sql); return null; } catch (e) { if (d.isInTransaction()) await d.exec("rollback"); return String(e); } };
    expect(await run(M0339)).toContain("0339: apply 0338 first");
    await d.exec(M0338);
    const live = bodyOf(M0338, "fact_labor_cost");
    const tampered = M0338.match(/create function public\.fact_labor_cost\([\s\S]*?end \$\$;/)![0]
      .replace("create function", "create or replace function").replace(live, live.replace("'fact_invalid_request'", "'fact_invalid_requesx'"));
    await d.exec(tampered);
    expect(await run(M0339)).toContain("0339: the live body of public.fact_labor_cost(uuid,date,date,text)");
    expect((await d.query("select 1 from information_schema.columns where table_name='labor_week_coverage' and column_name='ot_scope'")).rows).toEqual([]);
    await d.close();
  }, 180_000);
});
