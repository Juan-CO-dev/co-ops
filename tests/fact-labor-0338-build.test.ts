// Item 2 PR 2c: the 0338 BUILD side, offline (PGlite, single session, synthetic fixtures only). REAL parent
// DDL + the REAL 0338; THE 0268 reconciler writes the wages; the REAL TS builder builds from 0338's
// one-snapshot source read and writes through the one writer.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildLaborWeek, laborWeekSourceFromJson } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { laborWeekViews, toLaborCostRow } from "@/lib/facts/labor-cost-shared";
import { M0338, M0339, freshLaborParents } from "./helpers/fact-0338-parents";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (db.isInTransaction()) await db.exec("rollback"); }
}
async function sync(user: number, rows: { wage_id: string; upcoming: boolean; effective_date: string | null; wage_cents: number }[]) {
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger) values($1, 'cron')", [run]);
  await q("select reconcile_sevenshifts_user_snapshot($1, $2, 'wages', true, $3::jsonb)", [run, user,
    JSON.stringify(rows.map((r) => ({ user_id: String(user), wage_type: "hourly", role_id: null, ...r })))]);
}

const LOC_A = "00000000-0000-4000-8000-0000000000aa", LOC_B = "00000000-0000-4000-8000-0000000000bb";
const MGR = "00000000-0000-4000-8000-0000000000f1", ALICE = "00000000-0000-4000-8000-0000000000f2";
const WEEK = "2026-10-04", NEXT = "2026-10-11";
const etIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();
let punchId = 5000;
async function addPunch(user: number, loc7: number, date: string, from: string, to: string | null) {
  const id = ++punchId;
  await q("insert into sevenshifts_time_punches(id, user_id, location_id, clocked_in, clocked_out, break_minutes) values($1,$2,$3,$4,$5,0)",
    [id, user, loc7, etIso(date, from), to === null ? null : etIso(date, to)]);
  return id;
}
async function addRun(startedAt: string, punchesError: string | null | "absent") {
  const id = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger, started_at) values($1, 'cron', $2)", [id, startedAt]);
  const results = punchesError === "absent" ? {} : { time_punches: { rows: 0, skipped: 0, pages: 1, error_code: punchesError } };
  await q("insert into sevenshifts_sync_runs(id, trigger, started_at, finished_at, status, requests, results) values($1,'cron',$2,$2,'partial',1,$3::jsonb)",
    [id, startedAt, JSON.stringify(results)]);
  return id;
}
async function weekSource(week: string) {
  const j = (await q<{ s: Record<string, unknown> }>("select fact_labor_week_source($1, $2) s", [week, LABOR_BUILDER_VERSION]))[0]!.s;
  return laborWeekSourceFromJson(j);
}
async function replaceWeek(week: string, payload: ReturnType<typeof buildLaborWeek>, fp: string) {
  return (await q<{ r: Record<string, unknown> }>("select fact_replace_labor_week($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb) r",
    [week, LABOR_BUILDER_VERSION, fp, JSON.stringify(payload.quarters), JSON.stringify(payload.days), JSON.stringify(payload.week),
      JSON.stringify(payload.salaried)]))[0]!.r;
}
async function buildWeek(week: string) {
  const { source, fingerprint } = await weekSource(week);
  const payload = buildLaborWeek(source);
  return { payload, result: await replaceWeek(week, payload, fingerprint) };
}
async function staleWeeks() {
  return (await q<{ w: string }>("select to_char(week_start,'YYYY-MM-DD') w from fact_labor_weeks_stale(1000, $1)", [LABOR_BUILDER_VERSION])).map((r) => r.w);
}
const dayRow = async (loc: string, d: string) =>
  (await q("select state, source, evidence_run_id from labor_day_coverage where location_id=$1 and business_date=$2", [loc, d]))[0];
const minutesAt = async (week: string) => (await q<{ m: number; ot: number }>(
  "select coalesce(sum(minutes),0)::int m, coalesce(sum(ot_minutes),0)::int ot from labor_quarter where week_start=$1", [week]))[0]!;

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(M0338);
  await db.exec(M0339); // the production shape: overtime per shop (Juan 2026-11-17)
  await q("insert into locations(id) values($1),($2)", [LOC_A, LOC_B]);
  await q("insert into users(id, role) values($1,'moo'),($2,'employee')", [MGR, ALICE]);
  await q("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $3), ($2, 502, $3)", [LOC_A, LOC_B, MGR]);
}, 180_000);

describe("B. labor build side (0338)", () => {
  it("the source read and the fingerprint are one snapshot; the frame covers both linked shops, every day", async () => {
    const { source, fingerprint } = await weekSource(WEEK);
    expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint).toBe((await q<{ f: string }>("select fact_labor_week_fingerprint($1,$2) f", [WEEK, LABOR_BUILDER_VERSION]))[0]!.f);
    expect(source.days).toHaveLength(14);
    expect(source.builtThrough).toBe("2026-10-10");
    expect(source.days.every((d) => d.linked && d.settled && d.evidence_run_id === null)).toBe(true);
  });

  it("no ledger evidence = incomplete; a failed time_punches read, or a run without one, is never evidence", async () => {
    await addRun("2026-10-14T12:00:00Z", "rate_limited");
    await addRun("2026-10-14T13:00:00Z", "absent");
    await buildWeek(WEEK);
    expect(await dayRow(LOC_A, "2026-10-05")).toMatchObject({ state: "incomplete", source: "7shifts", evidence_run_id: null });
    expect(await staleWeeks()).not.toContain(WEEK);
  });

  it("a successful time_punches read (even with no punches) after the settle time covers the day; the earliest run stays the evidence", async () => {
    // 2026-10-11 12:30 ET: >= 36 h after the end of every day through Fri 10-09, not Sat 10-10.
    const early = await addRun("2026-10-11T16:30:00Z", null);
    expect(await staleWeeks()).toContain(WEEK);
    await buildWeek(WEEK);
    expect(await dayRow(LOC_A, "2026-10-09")).toMatchObject({ state: "covered", evidence_run_id: early });
    expect(await dayRow(LOC_A, "2026-10-10")).toMatchObject({ state: "incomplete" });
    expect((await q("select ot_state from labor_week_coverage where week_start=$1", [WEEK]))[0]).toEqual({ ot_state: "lower_bound" });
    const late = await addRun("2026-10-20T12:00:00Z", null);
    expect(await staleWeeks()).toContain(WEEK);
    await buildWeek(WEEK);
    expect(await dayRow(LOC_A, "2026-10-10")).toMatchObject({ state: "covered", evidence_run_id: late });
    expect(await dayRow(LOC_A, "2026-10-09")).toMatchObject({ evidence_run_id: early });
    expect((await q("select ot_state from labor_week_coverage where week_start=$1", [WEEK]))[0]).toEqual({ ot_state: "assessed" });
  });

  it("a run that read a day only from outside its 90-day window is never that day's evidence", async () => {
    const d = await freshLaborParents();
    await d.exec(M0338);
    await d.query("insert into locations(id) values($1)", [LOC_A]);
    await d.query("insert into users(id, role) values($1,'moo')", [MGR]);
    await d.query("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $2)", [LOC_A, MGR]);
    const run = randomUUID();
    await d.query("insert into sevenshifts_sync_run_ids(id, trigger, started_at) values($1, 'cron', '2026-10-25T12:00:00Z')", [run]);
    await d.query("insert into sevenshifts_sync_runs(id, trigger, started_at, finished_at, status, requests, results) values($1,'cron','2026-10-25T12:00:00Z','2026-10-25T12:00:00Z','ok',1,$2::jsonb)",
      [run, JSON.stringify({ time_punches: { rows: 0, skipped: 0, pages: 1, error_code: null } })]);
    const ev = async (week: string, day: string) => (await d.query<{ e: string | null }>(
      "select evidence_run_id::text e from fact_labor_week_days($1) where business_date = $2", [week, day])).rows[0]!.e;
    expect(await ev("2026-07-19", "2026-07-23")).toBeNull(); // 10-25 minus 90 days = 07-27
    expect(await ev("2026-07-26", "2026-07-28")).toBe(run);
  }, 120_000);

  it("punches + wages through THE reconciler: per-shop overtime (30 h at A + 15 h at B = none); the diff drains; a repeat build is identical", async () => {
    await sync(7, [{ wage_id: "70", upcoming: false, effective_date: "2026-01-01", wage_cents: 2000 }]);
    await q("insert into sevenshifts_user_links(sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values(7, $1, $2, $3), (8, $1, $4, $3)", [ALICE, LOC_A, MGR, LOC_B]);
    await sync(8, [{ wage_id: "80", upcoming: false, effective_date: "2026-01-01", wage_cents: 2200 }]);
    await addPunch(7, 501, "2026-10-05", "06:00", "21:00");
    await addPunch(7, 501, "2026-10-06", "06:00", "21:00");
    await addPunch(8, 502, "2026-10-08", "06:00", "21:00");
    expect(await staleWeeks()).toContain(WEEK);
    const { result } = await buildWeek(WEEK);
    expect(result).toMatchObject({ week_start: WEEK, days: 14 });
    expect(await minutesAt(WEEK)).toEqual({ m: 2700, ot: 0 });
    expect(await q("select sum(ot_minutes)::int ot, max(rate_cents) r from labor_quarter where week_start=$1 and location_id=$2", [WEEK, LOC_B]))
      .toEqual([{ ot: 0, r: 2200 }]);
    expect(await staleWeeks()).not.toContain(WEEK);
    const before = await q("select * from labor_quarter where week_start=$1 order by location_id, quarter_start_at", [WEEK]);
    await buildWeek(WEEK);
    expect(await q("select * from labor_quarter where week_start=$1 order by location_id, quarter_start_at", [WEEK])).toEqual(before);
  });

  it("a wage correction, a link change and a punch moved across the week boundary each make the right weeks stale", async () => {
    await sync(7, [{ wage_id: "70", upcoming: false, effective_date: "2026-01-01", wage_cents: 2100 }]);
    expect(await staleWeeks()).toContain(WEEK);
    await buildWeek(WEEK);
    expect(await q("select distinct rate_cents from labor_quarter where week_start=$1 and location_id=$2", [WEEK, LOC_A])).toEqual([{ rate_cents: 2100 }]);
    await q("update sevenshifts_user_links set active = false, unlinked_at = now(), unlinked_by = $1 where sevenshifts_user_id = 8", [MGR]);
    expect(await staleWeeks()).toContain(WEEK);
    await buildWeek(WEEK);
    expect(await q("select distinct person_key from labor_quarter where week_start=$1 and location_id=$2", [WEEK, LOC_B])).toEqual([{ person_key: "ss:8" }]);
    await buildWeek(NEXT);
    const moved = await addPunch(7, 501, "2026-10-09", "10:00", "11:00");
    await buildWeek(WEEK);
    expect(await staleWeeks()).not.toContain(NEXT);
    await q("update sevenshifts_time_punches set clocked_in=$2, clocked_out=$3 where id=$1", [moved, etIso("2026-10-12", "10:00"), etIso("2026-10-12", "11:00")]);
    const st = await staleWeeks();
    expect(st).toContain(WEEK);
    expect(st).toContain(NEXT);
  });

  it("refuses a stale fingerprint, a payload that is not the frame, a non-payroll week, and a day not closed yet", async () => {
    const { source, fingerprint } = await weekSource(WEEK);
    const payload = buildLaborWeek(source);
    await refuses(replaceWeek(WEEK, payload, "0".repeat(32)), "fact_stale");
    await refuses(replaceWeek(WEEK, { ...payload, days: payload.days.slice(1) }, fingerprint), "fact_payload_mismatch");
    const lie = payload.days.map((d, i) => i === 0 ? { ...d, evidence_run_id: randomUUID() } : d);
    await refuses(replaceWeek(WEEK, { ...payload, days: lie }, fingerprint), "fact_payload_mismatch");
    const flipped = payload.quarters.map((x, i) => i === 0 ? { ...x, source: "toast" as const } : x);
    await refuses(replaceWeek(WEEK, { ...payload, quarters: flipped }, fingerprint), "fact_payload_mismatch");
    await refuses(replaceWeek(WEEK, { ...payload, salaried: [] }, fingerprint), "fact_payload_mismatch");
    await refuses(replaceWeek("2026-10-05", payload, fingerprint), "fact_invalid_request");
    await refuses(replaceWeek("2026-07-12", payload, fingerprint), "fact_invalid_request");
    const today = (await q<{ d: string }>("select to_char((clock_timestamp() at time zone 'America/New_York')::date,'YYYY-MM-DD') d"))[0]!.d;
    const tw = new Date(`${today}T12:00:00Z`); tw.setUTCDate(tw.getUTCDate() - tw.getUTCDay());
    const week = tw.toISOString().slice(0, 10);
    const q0 = { ...payload.quarters[0]!, business_date: today, week_start: week };
    await refuses(replaceWeek(week, { ...payload, quarters: [q0], week: { ...payload.week, week_start: week } }, fingerprint), "fact_open_day");
  });

  it("the diff lists the floor week and nothing before it; a non-Sunday source read is refused", async () => {
    const weeks = await staleWeeks();
    expect(weeks).toContain("2026-07-19");
    expect(weeks.every((w) => w >= "2026-07-19")).toBe(true);
    await refuses(q("select fact_labor_week_source('2026-10-05', $1)", [LABOR_BUILDER_VERSION]), "fact_invalid_request");
  });

  it("fix r2 P1: an overnight open punch makes the next day (and the next payroll week's Sunday) not definitive, end to end", async () => {
    await addRun("2026-10-30T12:00:00Z", null); // evidence for every day through 10-28: the days are 'covered'
    const mon = await addPunch(7, 501, "2026-10-19", "23:00", null); // Monday 23:00, never clocked out
    const sat = await addPunch(7, 501, "2026-10-24", "23:00", null); // Saturday 23:00, never clocked out
    const { source } = await weekSource("2026-10-25");
    expect(source.punches.map((p) => p.id)).toContain(String(sat)); // the NEXT week's source reads the Saturday punch
    expect(source.punches.map((p) => p.id)).not.toContain(String(mon));
    await buildWeek("2026-10-18"); await buildWeek("2026-10-25");
    const day = async (d: string) => (await q<{ state: string; open_punches: number; ss_minutes: number }>(
      "select state, open_punches, ss_minutes from labor_day_coverage where location_id=$1 and business_date=$2", [LOC_A, d]))[0];
    expect(await day("2026-10-20")).toEqual({ state: "covered", open_punches: 1, ss_minutes: 0 });
    expect(await day("2026-10-25")).toEqual({ state: "covered", open_punches: 1, ss_minutes: 0 });
    expect((await day("2026-10-21"))!.open_punches).toBe(0);
    // A Tuesday-only (and a Sunday-only) cost read: hours unknown, so no definitive %.
    for (const d of ["2026-10-20", "2026-10-25"]) {
      const rows = await q("select * from fact_labor_cost($1, $2, $2, 'first_known')", [LOC_A, d]);
      const [v] = laborWeekViews(rows.map((r) => toLaborCostRow(r)));
      expect(v).toMatchObject({ hoursKnown: false, openPunches: 1 });
    }
    // Closing the Saturday punch moves both weeks' fingerprints; the Sunday clears on rebuild.
    await q("update sevenshifts_time_punches set clocked_out=$2 where id=$1", [sat, etIso("2026-10-24", "23:30")]);
    const st = await staleWeeks();
    expect(st).toContain("2026-10-18"); expect(st).toContain("2026-10-25");
    await buildWeek("2026-10-25");
    expect((await day("2026-10-25"))!.open_punches).toBe(0);
  });

  it("the derived tables and the writer carry the service-role ceiling", async () => {
    for (const t of ["labor_quarter", "labor_day_coverage", "labor_week_coverage", "labor_week_salaried"]) {
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect((await q<{ x: boolean }>(`select has_table_privilege('service_role', 'public.${t}', '${p}') x`))[0]!.x, `${t} ${p}`).toBe(false);
      }
      expect((await q<{ x: boolean }>(`select has_table_privilege('anon', 'public.${t}', 'SELECT') x`))[0]!.x).toBe(false);
    }
    expect((await q<{ x: boolean }>("select has_function_privilege('authenticated', 'public.fact_replace_labor_week(date,text,text,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE') x"))[0]!.x).toBe(false);
  });
});
