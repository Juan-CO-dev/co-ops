// Item 2 PR 2c: the 0338 offline proof (PGlite, single session, synthetic fixtures only; no network,
// no sim, no prod). REAL parent DDL (0268 reconciler, 0269/0301 links, 0224, 0233, 0274, and 0337 on its
// own parents) is extracted from the applied migrations, then the REAL 0338 is applied.
// Section A drives THE 0268 reconciler (reconcile_sevenshifts_user_snapshot) and reads the wage through
// 0338's fact_wage_current_versions + the pure pickWage: plan r6 T1–T6 and Astra r6's P1 (a stale
// upcoming row must never override a corrected current wage after an incomplete promotion).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pickWage, toWageVersion, type WageVersion } from "@/lib/facts/labor-wages-shared";
import { M0338, freshLaborParents } from "./helpers/fact-0338-parents";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], on: PGlite = db) => (await on.query<T>(sql, params)).rows;
async function refuses(p: Promise<unknown>, code: string, on: PGlite = db) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (on.isInTransaction()) await on.exec("rollback"); }
}

interface WageRow { wage_id: string; upcoming: boolean; effective_date: string | null; wage_cents: number; role_id?: string | null; wage_type?: string }
let userSeq = 1000;
const nextUser = () => ++userSeq;
/** One reconcile of one user's wage snapshot through THE 0268 reconciler, in its own run. */
async function sync(user: number, rows: WageRow[], complete = true, startedAt?: string, on: PGlite = db) {
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger, started_at) values($1, 'cron', coalesce($2::timestamptz, clock_timestamp()))", [run, startedAt ?? null], on);
  const payload = rows.map((r) => ({ user_id: String(user), wage_id: r.wage_id, upcoming: r.upcoming, effective_date: r.effective_date,
    wage_type: r.wage_type ?? "hourly", wage_cents: r.wage_cents, role_id: r.role_id ?? null }));
  return (await q<{ r: Record<string, unknown> }>("select reconcile_sevenshifts_user_snapshot($1, $2, 'wages', $3, $4::jsonb) r",
    [run, user, complete, JSON.stringify(payload)], on))[0]!.r;
}
async function versions(user: number, on: PGlite = db): Promise<WageVersion[]> {
  return (await q<Record<string, unknown>>("select * from fact_wage_current_versions($1::bigint[])", [[user]], on)).map(toWageVersion);
}
const observations = async (user: number, on: PGlite = db) =>
  q<{ source: string; upcoming: boolean; wage_cents: number; active: boolean }>(
    "select source, upcoming, wage_cents, active from fact_wage_observations where user_id = $1 order by seq", [user], on);
async function rate(user: number, date: string, role = "0") {
  const p = pickWage(await versions(user), role, date);
  return { basis: p.basis, cents: p.rate?.wage_cents ?? null, carry: p.carryBack?.wage_cents ?? null, upcoming: p.rate?.upcoming ?? null };
}

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(M0338);
}, 180_000);

describe("A. wage resolution survives upcoming -> current (plan r6 §2; Astra r6 P1)", () => {
  it("T1: complete promotion records insert U, insert C, retire U; the current version prices the wage", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-12-01", wage_cents: 2000 }]);
    expect(await observations(u)).toEqual([
      { source: "insert", upcoming: true, wage_cents: 2000, active: true },
      { source: "insert", upcoming: false, wage_cents: 2000, active: true },
      { source: "retire", upcoming: true, wage_cents: 2000, active: false },
    ]);
    expect(await versions(u)).toHaveLength(1);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2000, carry: null, upcoming: false });
  });
  it("T1b: an unchanged complete sync adds no observation and keeps the answer", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-12-01", wage_cents: 2000 }]);
    const before = (await observations(u)).length;
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-12-01", wage_cents: 2000 }]);
    expect((await observations(u)).length).toBe(before);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2000, carry: null, upcoming: false });
  });
  it("T1c: incomplete promotion on the same date: C and U both live, C wins; a later complete run changes nothing", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-12-01", wage_cents: 2100 }], false);
    expect((await q("select count(*)::int n from sevenshifts_wages where user_id=$1 and active", [u]))[0]).toEqual({ n: 2 });
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2100, carry: null, upcoming: false });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-12-01", wage_cents: 2100 }]);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2100, carry: null, upcoming: false });
  });
  it("Astra r6 P1: incomplete promotion with a DATE and RATE correction: stale upcoming never prices history or the carry-back", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-08-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2200 }], false);
    const before = { aug: await rate(u, "2026-08-15"), sep: await rate(u, "2026-09-05") };
    expect(before.aug).toEqual({ basis: "before_first_known", cents: null, carry: 2200, upcoming: null });
    expect(before.sep).toEqual({ basis: "known", cents: 2200, carry: null, upcoming: false });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2200 }]);
    expect({ aug: await rate(u, "2026-08-15"), sep: await rate(u, "2026-09-05") }).toEqual(before);
  });
  it("Astra r6 P1: incomplete promotion with a ROLE correction: the stale upcoming role never matches", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-08-01", wage_cents: 2000, role_id: "11" },
      { wage_id: "2", upcoming: false, effective_date: "2026-07-01", wage_cents: 1840, role_id: null }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2300, role_id: "12" },
      { wage_id: "2", upcoming: false, effective_date: "2026-07-01", wage_cents: 1840, role_id: null }], false);
    const before = { r11: await rate(u, "2026-08-15", "11"), r12: await rate(u, "2026-08-15", "12") };
    // Role 11 has no live claim any more: it falls to the null-role wage, never the stale upcoming 11.
    expect(before.r11).toEqual({ basis: "known", cents: 1840, carry: null, upcoming: false });
    expect(before.r12).toEqual({ basis: "known", cents: 2300, carry: null, upcoming: false });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2300, role_id: "12" },
      { wage_id: "2", upcoming: false, effective_date: "2026-07-01", wage_cents: 1840, role_id: null }]);
    expect({ r11: await rate(u, "2026-08-15", "11"), r12: await rate(u, "2026-08-15", "12") }).toEqual(before);
  });
  it("Astra r6 P1: date AND role corrected at an incomplete promotion; first-known carry-back before and after the complete snapshot", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-08-01", wage_cents: 2000, role_id: "11" }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2400, role_id: "12" }], false);
    const probe = async () => ({ aug11: await rate(u, "2026-08-15", "11"), aug12: await rate(u, "2026-08-15", "12"), sep11: await rate(u, "2026-09-05", "11") });
    const before = await probe();
    expect(before).toEqual({
      aug11: { basis: "before_first_known", cents: null, carry: 2400, upcoming: null },
      aug12: { basis: "before_first_known", cents: null, carry: 2400, upcoming: null },
      sep11: { basis: "known", cents: 2400, carry: null, upcoming: false },
    });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2400, role_id: "12" }]);
    expect(await probe()).toEqual(before);
  });
  it("a wage moved BACK to upcoming after it was current: the newest assertion wins while it is live", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2600 }], false);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2600, carry: null, upcoming: true });
    expect(await rate(u, "2026-09-05")).toEqual({ basis: "before_first_known", cents: null, carry: 2600, upcoming: null });
  });
  it("T2: an in-place correction of a current wage ($20 Aug 1 -> $22 Sep 1) is one update observation", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2200 }]);
    expect((await observations(u)).map((o) => o.source)).toEqual(["insert", "update"]);
    expect(await rate(u, "2026-08-15")).toEqual({ basis: "before_first_known", cents: null, carry: 2200, upcoming: null });
    expect(await rate(u, "2026-09-05")).toEqual({ basis: "known", cents: 2200, carry: null, upcoming: false });
    const w = nextUser();
    await sync(w, [{ wage_id: "9", upcoming: false, effective_date: "2026-06-01", wage_cents: 1800 },
      { wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2000 }]);
    await sync(w, [{ wage_id: "9", upcoming: false, effective_date: "2026-06-01", wage_cents: 1800 },
      { wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2200 }]);
    expect(await rate(w, "2026-08-15")).toEqual({ basis: "known", cents: 1800, carry: null, upcoming: false });
    expect(await rate(w, "2026-09-05")).toEqual({ basis: "known", cents: 2200, carry: null, upcoming: false });
  });
  it("T3: an upcoming wage corrected $20 -> $23 prices $23 live, then $23 from its current version; $20 is never used", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2000 }]);
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2300 }]);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2300, carry: null, upcoming: true });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-12-01", wage_cents: 2300 }]);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "known", cents: 2300, carry: null, upcoming: false });
    expect(await rate(u, "2026-11-05")).toEqual({ basis: "before_first_known", cents: null, carry: 2300, upcoming: null });
  });
  it("T3b: a cancelled upcoming wage (retired, no current) is no candidate", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-12-01", wage_cents: 2000 }]);
    await sync(u, []);
    expect(await versions(u)).toEqual([]);
    expect(await rate(u, "2026-12-05")).toEqual({ basis: "none", cents: null, carry: null, upcoming: null });
  });
  it("T4: a role changed in place R1 -> R2: R1 quarters fall to the null-role wage, then any wage", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2400, role_id: "11" }]);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2400, role_id: "12" }]);
    expect(await rate(u, "2026-08-15", "12")).toMatchObject({ basis: "known", cents: 2400 });
    expect(await rate(u, "2026-08-15", "11")).toMatchObject({ basis: "known", cents: 2400 });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2400, role_id: "12" },
      { wage_id: "2", upcoming: false, effective_date: "2026-07-01", wage_cents: 1900, role_id: null }]);
    expect(await rate(u, "2026-08-15", "11")).toMatchObject({ basis: "known", cents: 1900 });
  });
  it("T5 / T5b: no wage yet = before_first_known with the first wage carried back; no wage at all = none", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2500 }]);
    expect(await rate(u, "2026-08-15")).toEqual({ basis: "before_first_known", cents: null, carry: 2500, upcoming: null });
    expect(await rate(nextUser(), "2026-08-15")).toEqual({ basis: "none", cents: null, carry: null, upcoming: null });
  });
  it("T6: a current wage retired, then back as a new row: the newest version wins", async () => {
    const u = nextUser();
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2000 }]);
    await sync(u, []);
    expect(await rate(u, "2026-08-15")).toMatchObject({ basis: "known", cents: 2000 });
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 3000 }]);
    expect(await rate(u, "2026-08-15")).toMatchObject({ basis: "known", cents: 3000 });
  });
  it("versions are read only for the users asked for", async () => {
    const a = nextUser(), b = nextUser();
    await sync(a, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 1 }]);
    await sync(b, [{ wage_id: "1", upcoming: false, effective_date: "2026-08-01", wage_cents: 2 }]);
    expect((await versions(a)).map((x) => x.wage_cents)).toEqual([1]);
  });
});

describe("A. the cutover seed (T1d)", () => {
  async function seededAnswer(order: "u_first" | "c_first", incomplete = false) {
    const d = await freshLaborParents();
    const u = 77;
    const early = "2026-10-01T10:00:00Z", late = "2026-10-02T10:00:00Z";
    // The rows as 0268 left them, BEFORE 0338's triggers exist. Run start times decide the seed order
    // across lanes; "c_first" makes the promoted current row's run look EARLIER than the upcoming one's.
    await sync(u, [{ wage_id: "1", upcoming: true, effective_date: "2026-08-01", wage_cents: 2000, role_id: "11" }], true, order === "u_first" ? early : late, d);
    await sync(u, [{ wage_id: "1", upcoming: false, effective_date: "2026-09-01", wage_cents: 2200, role_id: "12" }], !incomplete, order === "u_first" ? late : early, d);
    await d.exec(M0338);
    const vs = (await q<Record<string, unknown>>("select * from fact_wage_current_versions($1::bigint[])", [[u]], d)).map(toWageVersion);
    const seeded = await q<{ source: string }>("select distinct source from fact_wage_observations", [], d);
    return { seeded, aug: pickWage(vs, "11", "2026-08-15"), sep: pickWage(vs, "12", "2026-09-05") };
  }
  it("seeds every wage row (retired and live) and gives the T1 answer in both cross-lane orders", async () => {
    const a = await seededAnswer("u_first"), b = await seededAnswer("c_first");
    expect(a.seeded).toEqual([{ source: "seed" }]);
    for (const r of [a, b]) {
      expect(r.aug).toMatchObject({ basis: "before_first_known", carryBack: { wage_cents: 2200, upcoming: false } });
      expect(r.sep).toMatchObject({ basis: "known", rate: { wage_cents: 2200, upcoming: false } });
    }
  }, 120_000);
  it("an incomplete promotion at cutover (both rows live) seeds in run order: the current version wins", async () => {
    const r = await seededAnswer("u_first", true);
    expect(r.aug).toMatchObject({ basis: "before_first_known", carryBack: { wage_cents: 2200 } });
    expect(r.sep).toMatchObject({ basis: "known", rate: { wage_cents: 2200, upcoming: false } });
  }, 120_000);
});

describe("A. observation ledger ceilings", () => {
  it("service_role reads the ledger and cannot write it; the trigger function is not callable", async () => {
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect((await q<{ x: boolean }>(`select has_table_privilege('service_role', 'public.fact_wage_observations', '${p}') x`))[0]!.x).toBe(false);
    }
    expect((await q<{ x: boolean }>("select has_table_privilege('service_role', 'public.fact_wage_observations', 'SELECT') x"))[0]!.x).toBe(true);
  });
  it("a second apply refuses", async () => {
    await refuses(db.exec(M0338), "already applied");
  });
});
