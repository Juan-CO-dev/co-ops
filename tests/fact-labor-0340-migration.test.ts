// 0340 (Juan 2026-11-17): salaried cost to the PAYROLL shop. Offline (PGlite, synthetic fixtures): the REAL
// parents + the REAL 0338 + 0339 (as applied to prod) + the REAL 0340; the REAL builder; the one writer.
//  - the setter: roles (GM refused), destination (a live location link only), Sunday / floor, note rules,
//    `moved`, the unknown-account refusal, its audit row, the ceilings;
//  - an old deployment's salaried payload (no gap counts) is refused fact_payload_mismatch;
//  - save -> the week is listed stale -> rebuild -> clean, and the salary moved (P2-4's gate);
//  - P1-1 at SQL level: unlink + relink a person link, rebuild: labor_week_salaried byte-identical;
//  - P1-2: an unassigned salaried account nulls the cents with its count; the counts come back beside an estimate;
//  - Astra r2 P2 #3: the destination's location link removed: the write still succeeds and the no-wage
//    assignee is UNPLACED on every stored shop (the gap never disappears);
//  - line-subsequence pins of the four re-emitted bodies, the md5 pre-flight, a second apply and a drifted body.
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildLaborWeek, laborWeekSourceFromJson } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { M0338, M0339, M0340, freshLaborParents } from "./helpers/fact-0338-parents";

function bodyOf(sql: string, name: string): string {
  const at = sql.indexOf(`create function public.${name}(`);
  const alt = sql.indexOf(`create or replace function public.${name}(`);
  const start = at >= 0 ? at : alt;
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf("$$", start) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
}
const md5 = (s: string) => createHash("md5").update(s.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
const RE_EMITTED = [
  { sig: "public.fact_labor_week_source(date,text)", name: "fact_labor_week_source", from: M0338, replaced: [] as string[] },
  { sig: "public.fact_labor_week_fingerprint(date,text)", name: "fact_labor_week_fingerprint", from: M0338,
    replaced: ["v_floor date; v_span interval; v_through date; v_punch text; v_toast text; v_links text; v_wages text; v_settings text; v_days text;",
      "union select l.sevenshifts_user_id from public.sevenshifts_user_links l where l.active)",
      "'s:' || coalesce(v_settings, 'none'), 'd:' || coalesce(v_days, 'none')));"] },
  { sig: "public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)", name: "fact_replace_labor_week", from: M0339,
    replaced: ["except select f.location_id from public.fact_labor_week_days(p_week_start) f where f.linked) then"] },
  { sig: "public.fact_labor_cost(uuid,date,date,text)", name: "fact_labor_cost", from: M0339,
    replaced: ["case when s.estimated_salaried_weekly_cents is not null then 'estimate' when ws.salaried_cents is not null then 'wages' else 'unknown' end,",
      "(select coalesce(sum(c.open_punches), 0)::integer from public.labor_day_coverage c where c.location_id = g.loc and c.business_date between greatest(g.w, p_from) and least(g.w + 6, p_to))"] },
];
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

describe("0340 static shape", () => {
  it("the pre-flight accepts exactly the 0338 / 0339 body of every function it re-emits", () => {
    for (const f of RE_EMITTED) expect(M0340).toContain(`('${f.sig}', '${md5(bodyOf(f.from, f.name))}')`);
  });
  it("every re-emitted body keeps its source as a line-subsequence (only the named lines change)", () => {
    for (const f of RE_EMITTED) {
      const src = lines(bodyOf(f.from, f.name)).filter((l) => !f.replaced.includes(l));
      for (const r of f.replaced) expect(lines(bodyOf(f.from, f.name)), f.name).toContain(r);
      const out = lines(bodyOf(M0340, f.name));
      let i = 0;
      for (const l of out) if (i < src.length && l === src[i]) i++;
      expect(src[i], `${f.name}: first source line missing in order`).toBeUndefined();
    }
  });
  it("one transaction; the cost function is dropped and created (new OUT columns), the rest replaced", () => {
    expect(M0340).toMatch(/^begin;$/m);
    expect(M0340.trimEnd().endsWith("commit;")).toBe(true);
    expect(M0340).toContain("drop function public.fact_labor_cost(uuid, date, date, text);");
    for (const n of ["fact_labor_week_source", "fact_labor_week_fingerprint", "fact_replace_labor_week"]) expect(M0340).toContain(`create or replace function public.${n}(`);
  });
});

const A = "00000000-0000-4000-8000-0000000000aa", B = "00000000-0000-4000-8000-0000000000bb", C = "00000000-0000-4000-8000-0000000000cc";
const OWNER = "00000000-0000-4000-8000-0000000000f1", MOO = "00000000-0000-4000-8000-0000000000f2", GM = "00000000-0000-4000-8000-0000000000f3";
const CGS = "00000000-0000-4000-8000-0000000000f4", GONE = "00000000-0000-4000-8000-0000000000f5";
const W = "2026-10-04", FLOOR = "2026-07-19";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (db.isInTransaction()) await db.exec("rollback"); }
}
async function salary(user: number, cents: number, type = "weekly_salary") {
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger) values($1, 'cron')", [run]);
  await q("select reconcile_sevenshifts_user_snapshot($1, $2, 'wages', true, $3::jsonb)", [run, user,
    JSON.stringify([{ user_id: String(user), wage_id: String(user * 10), upcoming: false, effective_date: "2026-01-01", wage_type: type, wage_cents: cents, role_id: null }])]);
}
async function payloadFor(week: string, version = LABOR_BUILDER_VERSION) {
  const j = (await q<{ s: Record<string, unknown> }>("select fact_labor_week_source($1, $2) s", [week, version]))[0]!.s;
  const { source, fingerprint } = laborWeekSourceFromJson(j);
  return { payload: buildLaborWeek(source), fingerprint };
}
const replace = (week: string, version: string, fingerprint: string, p: ReturnType<typeof buildLaborWeek>, salaried: unknown = p.salaried) =>
  q("select fact_replace_labor_week($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)", [week, version, fingerprint,
    JSON.stringify(p.quarters), JSON.stringify(p.days), JSON.stringify(p.week), JSON.stringify(salaried)]);
async function build(week = W) { const { payload, fingerprint } = await payloadFor(week); await replace(week, LABOR_BUILDER_VERSION, fingerprint, payload); }
const save = (actor: string, account: number, loc: string | null, disposition: string, validFrom: string, note: string | null, expected: number | null) =>
  q<{ r: { id: string; seq: number } }>("select save_labor_payroll_shop($1,$2,$3,$4,$5,$6,$7) r", [actor, account, loc, disposition, validFrom, note, expected]);
const newest = async (account: number) => (await q<{ s: string | null }>("select max(seq)::text s from labor_payroll_shops where sevenshifts_user_id=$1", [account]))[0]!.s;
const salariedRows = async (week = W) => q<Record<string, unknown>>(
  "select location_id, salaried_cents::int c, salaried_people p, unplaced_people u, missing_wage_people m from labor_week_salaried where week_start=$1 order by location_id", [week]);
const stale = async () => (await q<{ w: string }>("select to_char(week_start,'YYYY-MM-DD') w from fact_labor_weeks_stale(1000, $1)", [LABOR_BUILDER_VERSION])).map((r) => r.w);
const cost = async (loc: string) => (await q<Record<string, unknown>>(
  "select salaried_cents::int c, salary_basis b, salaried_people p, salary_unplaced_people u, salary_missing_wage_people m from fact_labor_cost($1, $2, $3, 'first_known')",
  [loc, W, "2026-10-10"]))[0]!;

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(M0338);
  await db.exec(M0339);
  await q("insert into locations(id) values($1),($2),($3)", [A, B, C]);
  await q("insert into users(id, role, active) values($1,'owner',true),($2,'moo',true),($3,'gm',true),($4,'cgs',true),($5,'owner',false)", [OWNER, MOO, GM, CGS, GONE]);
  await q("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $3), ($2, 502, $3)", [A, B, MOO]);
  for (const id of [9, 10, 11]) await q("insert into sevenshifts_users(id, company_id, first_name, active) values($1, 1, 'X', true)", [id]);
  // 9 = the owner's ONE account, linked at both shops (0338 halved it); 10 = a Capitol-Hill-style salary; 11 = no wage.
  await q("insert into sevenshifts_user_links(sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values(9, $1, $2, $4), (9, $1, $3, $4)", [OWNER, A, B, MOO]);
  await salary(9, 200000); await salary(10, 5200000, "annual_salary");
  // Production before 0340: the week built by labor-v2 (the link split).
  { const j = (await q<{ s: Record<string, unknown> }>("select fact_labor_week_source($1, 'labor-v2') s", [W]))[0]!.s;
    const { source, fingerprint } = laborWeekSourceFromJson({ ...j, payroll_shops: [] });
    const p = buildLaborWeek(source);
    const v2 = p.salaried.map((r) => ({ location_id: r.location_id, salaried_cents: r.salaried_cents, salaried_people: r.salaried_people }));
    await replace(W, "labor-v2", fingerprint, p, v2); }
  await db.exec(M0340);
}, 180_000);

describe("existing rows and the version bump", () => {
  it("a labor-v2 week keeps its rows (no gaps) and is listed stale for labor-v3", async () => {
    expect((await salariedRows()).every((r) => r.u === 0 && r.m === 0)).toBe(true);
    expect(await stale()).toContain(W);
  });
  it("an old deployment's salaried payload (no gap counts) is refused fact_payload_mismatch, and so is a split unplaced count", async () => {
    const { payload, fingerprint } = await payloadFor(W, "labor-v2");
    const old = payload.salaried.map((r) => ({ location_id: r.location_id, salaried_cents: r.salaried_cents, salaried_people: r.salaried_people }));
    await refuses(replace(W, "labor-v2", fingerprint, payload, old), "fact_payload_mismatch");
    const split = payload.salaried.map((r, i) => ({ ...r, unplaced_people: i, salaried_cents: null }));
    await refuses(replace(W, "labor-v2", fingerprint, payload, split), "fact_payload_mismatch");
  });
});

describe("the setter", () => {
  it("only an active owner / CGS / MoO; a GM and an inactive owner are refused", async () => {
    await refuses(save(GM, 9, A, "shop", FLOOR, "seed", null), "labor_payroll_shop_forbidden");
    await refuses(save(GONE, 9, A, "shop", FLOOR, "seed", null), "labor_payroll_shop_forbidden");
  });
  it("refuses a non-Sunday, a date before the floor week, an unknown account, a shop without a live location link, a shape error", async () => {
    await refuses(save(MOO, 9, A, "shop", "2026-07-20", "x", null), "labor_payroll_shop_invalid_date");
    await refuses(save(MOO, 9, A, "shop", "2026-07-12", "x", null), "labor_payroll_shop_invalid_date");
    await refuses(save(MOO, 999, A, "shop", FLOOR, "x", null), "labor_payroll_shop_unknown_account");
    await refuses(save(MOO, 9, C, "shop", FLOOR, "x", null), "labor_payroll_shop_invalid_destination");
    await refuses(save(MOO, 9, null, "shop", FLOOR, "x", null), "labor_payroll_shop_invalid");
    await refuses(save(MOO, 9, A, "excluded", FLOOR, "x", null), "labor_payroll_shop_invalid");
  });
  it("a note is required to exclude and to backdate", async () => {
    await refuses(save(MOO, 11, null, "excluded", "2099-01-04", " ", null), "labor_payroll_shop_note_required");
    await refuses(save(MOO, 9, A, "shop", FLOOR, null, null), "labor_payroll_shop_note_required");
  });
  it("saves, writes ONE destructive audit row without the note text, and is optimistic on the newest row", async () => {
    const r = (await save(OWNER, 9, A, "shop", FLOOR, "P Street payroll (secret words)", null))[0]!.r;
    expect(r.seq).toBeGreaterThan(0);
    const audit = await q<Record<string, unknown>>("select actor_id, actor_role, action, resource_id, destructive, before_state, after_state, metadata from audit_log where action='labor_payroll_shop.save'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: OWNER, actor_role: "owner", resource_id: r.id, destructive: true,
      before_state: { disposition: "none" }, after_state: { disposition: "shop", location_id: A, valid_from: FLOOR } });
    expect(audit[0]!.metadata).toMatchObject({ sevenshifts_user_id: 9, has_note: true, backdated: true });
    expect(JSON.stringify(audit[0])).not.toContain("secret");
    await refuses(save(OWNER, 9, B, "shop", FLOOR, "again", null), "labor_payroll_shop_moved");
    await refuses(save(OWNER, 9, B, "shop", FLOOR, "again", Number(r.seq) - 1), "labor_payroll_shop_moved");
  });
  it("the table is append-only by grant and deny-all to PostgREST; the setter is service_role only", async () => {
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect((await q<{ x: boolean }>(`select has_table_privilege('service_role', 'public.labor_payroll_shops', '${p}') x`))[0]!.x, p).toBe(false);
    }
    expect((await q<{ x: boolean }>("select has_table_privilege('service_role', 'public.labor_payroll_shops', 'SELECT') x"))[0]!.x).toBe(true);
    for (const r of ["anon", "authenticated"]) {
      expect((await q<{ x: boolean }>(`select has_table_privilege('${r}', 'public.labor_payroll_shops', 'SELECT') x`))[0]!.x).toBe(false);
      expect((await q<{ x: boolean }>(`select has_function_privilege('${r}', 'public.save_labor_payroll_shop(uuid,bigint,uuid,text,date,text,bigint)', 'EXECUTE') x`))[0]!.x).toBe(false);
    }
    expect((await q<{ x: boolean }>("select relrowsecurity x from pg_class where relname='labor_payroll_shops'"))[0]!.x).toBe(true);
  });
});

describe("save -> stale -> rebuild -> clean (the P2-4 gate) and the allocation", () => {
  it("P1-2: one assigned salary + one UNASSIGNED salaried account = NULL cents with the count (never 200000 alone)", async () => {
    await build();
    expect(await stale()).not.toContain(W);
    expect(await salariedRows()).toEqual([
      { location_id: A, c: null, p: 1, u: 1, m: 0 },
      { location_id: B, c: null, p: 0, u: 1, m: 0 },
    ]);
    expect(await cost(A)).toEqual({ c: null, b: "incomplete", p: 1, u: 1, m: 0 });
  });
  it("assigning the last account restales the week; the rebuild places 100% at each payroll shop (no link split)", async () => {
    await save(MOO, 10, B, "shop", FLOOR, "Capitol Hill payroll", null);
    expect(await stale()).toContain(W);
    await build();
    expect(await stale()).not.toContain(W);
    expect(await salariedRows()).toEqual([
      { location_id: A, c: 200000, p: 1, u: 0, m: 0 },
      { location_id: B, c: 100000, p: 1, u: 0, m: 0 },
    ]);
    expect(await cost(B)).toEqual({ c: 100000, b: "wages", p: 1, u: 0, m: 0 });
  });
  it("P1-1: unlinking and relinking a person link rebuilds to byte-identical salaried rows", async () => {
    const before = await salariedRows();
    await q("update sevenshifts_user_links set active=false, unlinked_at=now(), unlinked_by=$1 where sevenshifts_user_id=9 and linked_at_location_id=$2", [MOO, B]);
    expect(await stale()).toContain(W);
    await build();
    expect(await salariedRows()).toEqual(before);
    await q("insert into sevenshifts_user_links(sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values(9, $1, $2, $3)", [OWNER, B, MOO]);
    await build();
    expect(await salariedRows()).toEqual(before);
  });
  it("a no-wage assignee is a missing wage at its shop; the counts come back beside an estimate too", async () => {
    await save(MOO, 11, A, "shop", FLOOR, "on P Street payroll, salary not entered yet", null);
    await build();
    expect(await salariedRows()).toEqual([
      { location_id: A, c: null, p: 1, u: 0, m: 1 },
      { location_id: B, c: 100000, p: 1, u: 0, m: 0 },
    ]);
    await q("insert into schedule_shop_settings(location_id, estimated_salaried_weekly_cents, updated_by) values($1, 300000, $2)", [A, MOO]);
    expect(await cost(A)).toEqual({ c: 300000, b: "estimate", p: 1, u: 0, m: 1 });
    await q("delete from schedule_shop_settings where location_id=$1", [A]);
  });
  it("Astra r2 P2 #3: the destination's location link removed: the write succeeds and the no-wage assignee is UNPLACED on every stored shop", async () => {
    await q("update sevenshifts_location_links set active=false, unlinked_at=now(), unlinked_by=$1 where location_id=$2", [MOO, A]);
    expect(await stale()).toContain(W);
    await build();
    expect(await salariedRows()).toEqual([{ location_id: B, c: null, p: 1, u: 2, m: 0 }]);
    expect(await cost(B)).toMatchObject({ c: null, b: "incomplete", u: 2 });
    await q("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $2)", [A, MOO]);
    await build();
  });
  it("a same-date correction (newest seq) moves the salary; the destination check applies to it too", async () => {
    await save(CGS, 9, B, "shop", FLOOR, "correction: CH", Number(await newest(9)));
    await build();
    expect((await salariedRows()).find((r) => r.location_id === B)).toMatchObject({ c: 300000, p: 2 });
    await refuses(save(CGS, 9, C, "shop", FLOOR, "x", Number(await newest(9))), "labor_payroll_shop_invalid_destination");
  });
  it("the cost function keeps the service-role-only ceiling after drop + create", async () => {
    const sig = "public.fact_labor_cost(uuid,date,date,text)";
    expect((await q<{ x: boolean }>(`select has_function_privilege('service_role', '${sig}', 'EXECUTE') x`))[0]!.x).toBe(true);
    for (const r of ["anon", "authenticated"]) expect((await q<{ x: boolean }>(`select has_function_privilege('${r}', '${sig}', 'EXECUTE') x`))[0]!.x).toBe(false);
  });
  it("labor_week_salaried: cents NULL exactly when nobody placed or a gap; no default on the counts", async () => {
    await refuses(q("insert into labor_week_salaried(week_start, location_id, salaried_cents, salaried_people, unplaced_people, missing_wage_people) values('2026-09-27',$1,5,1,1,0)", [A]), "labor_week_salaried_cents_known");
    await refuses(q("insert into labor_week_salaried(week_start, location_id, salaried_cents, salaried_people) values('2026-09-27',$1,null,0)", [A]), "null value");
  });
  it("a second apply refuses", async () => {
    await refuses(db.exec(M0340), "0340: already applied");
  });
});

describe("0340 pre-flight refusals", () => {
  it("refuses without 0339, and refuses a drifted body by name", async () => {
    const d = await freshLaborParents();
    const run = async (sql: string) => { try { await d.exec(sql); return null; } catch (e) { if (d.isInTransaction()) await d.exec("rollback"); return String(e); } };
    await d.exec(M0338);
    expect(await run(M0340)).toContain("0340: apply 0339 first");
    await d.exec(M0339);
    const live = bodyOf(M0338, "fact_labor_week_source");
    const tampered = M0338.match(/create function public\.fact_labor_week_source\([\s\S]*?end \$\$;/)![0]
      .replace("create function", "create or replace function").replace(live, live.replace("'fact_invalid_request'", "'fact_invalid_requesx'"));
    await d.exec(tampered);
    expect(await run(M0340)).toContain("0340: the live body of public.fact_labor_week_source(date,text)");
    expect(await d.query("select to_regclass('public.labor_payroll_shops') r").then((r) => (r.rows[0] as { r: unknown }).r)).toBeNull();
    await d.close();
  }, 180_000);
});
