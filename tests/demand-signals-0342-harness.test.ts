// Item 4 PR 1: the 0342 offline proof (PGlite, single session, synthetic fixtures only; no network, no sim,
// no prod). The REAL migration file is applied and driven by the REAL TS replay harness.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { baselineModel, candidateModel, parForecastRecord, targetFreezeArgs, NOT_COVERED_FINGERPRINT } from "@/lib/demand-signals/ledger-shared";
import { blobOf, forecastPars, parTargetFromInputs, replayVerdict, snapshotParInputs, type Blob } from "@/lib/demand-signals/replay";
import { buildParInputs, FIX_LOC } from "./helpers/par-engine-fixture";

const M0342 = readFileSync("supabase/migrations/0342_demand_signals_replay.sql", "utf8");
const PARENTS = `create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to public, anon, authenticated, service_role;
  create table public.locations(id uuid primary key, name text);
  insert into public.locations values ('${FIX_LOC}', 'Shop A');`;

let db: PGlite;
let today: string;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = unknown>(sql: string, params: unknown[] = []) => Object.values((await q(sql, params))[0] as Record<string, T>)[0] as T;
const put = (blobs: Blob[]) => one<{ stored: number; existed: number }>("select demand_blobs_put($1::jsonb)", [JSON.stringify(blobs)]);
const fails = async (p: Promise<unknown>, message: string) => { await expect(p).rejects.toThrow(message); };
async function as<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}
const fromDb = async () => {
  const rows = await q<{ hash: string; payload: string }>("select hash, payload from demand_input_blobs");
  const map = new Map(rows.map((r) => [r.hash, r.payload]));
  return (hash: string) => map.get(hash);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PARENTS);
  await db.exec(M0342);
  today = String(await one("select demand_today_et()::text"));
}, 120_000);

describe("0342: shape and ceilings", () => {
  it("refuses a second apply by name", async () => {
    await fails(db.exec(M0342), "0342: already applied");
    await db.exec("rollback");
  });
  it("service_role reads and cannot write a table directly; PostgREST roles reach nothing", async () => {
    await as("service_role", async () => {
      expect(await q("select count(*) from demand_forecast_ledger")).toHaveLength(1);
      await fails(q("insert into demand_input_blobs(hash, kind, payload, bytes) values (repeat('a',64), 'model', '{}', 2)"), "permission denied");
      await fails(q("delete from demand_forecast_ledger"), "permission denied");
      await fails(q("update demand_target_freezes set coverage = 'covered'"), "permission denied");
    });
    for (const role of ["anon", "authenticated"]) {
      await as(role, async () => {
        await fails(q("select * from demand_input_blobs"), "permission denied");
        await fails(q("select demand_blobs_put('[]'::jsonb)"), "permission denied");
        await fails(q("select demand_holdout_claim('x','labor_day_cents',1,current_date,current_date,'x')"), "permission denied");
      });
    }
  });
  it("touches no existing object: the file creates and never alters, drops or re-emits", () => {
    const body = M0342.replace(/^--.*$/gm, "");
    expect(body).not.toMatch(/\bdrop\s+(table|function|policy|constraint|index|trigger)|\btruncate\s+(table\s+)?public\.|\bdelete\s+from\b/i);
    expect(body).not.toMatch(/create or replace/i);
    expect([...body.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1])).toEqual([]);
    expect(body).not.toMatch(/claim_cron_route|par_auto_moves|vendor_items|schedule_/);
  });
});

describe("0342: blobs are named by their content", () => {
  it("the database recomputes the hash and stores an unchanged blob once", async () => {
    const b = blobOf("par_day", { v: 1, note: "día con acento ñ" });
    expect(await as("service_role", () => put([b]))).toEqual({ stored: 1, existed: 0 });
    expect(await put([b, b])).toEqual({ stored: 0, existed: 2 });
    await fails(put([{ ...b, text: b.text + " " }]), "blob_hash_mismatch");
    await fails(put([{ ...b, kind: "anything" as Blob["kind"], hash: blobOf("model", { x: 1 }).hash, text: blobOf("model", { x: 1 }).text }]), "demand_input_blobs_kind_check");
    expect(await one("select payload from demand_input_blobs where hash = $1", [b.hash])).toBe(b.text);
  });
});

describe("0342: the forecast ledger is the E2 clock", () => {
  const inputs = buildParInputs();
  const model = baselineModel("pars");
  const args = (decision: string, manifest: string, record: ReturnType<typeof parForecastRecord>) =>
    [FIX_LOC, "pars", model.blob.hash, record.engine, manifest, decision, JSON.stringify(record.entries)];
  const RECORD = "select demand_forecast_record($1,$2,$3,$4,$5,$6,$7::jsonb)";

  it("a model is its spec's hash, registered once", async () => {
    await fails(q("select demand_model_register($1,'pars','baseline','baseline')", [model.blob.hash]), "model_blob_missing");
    await put([model.blob]);
    expect(await one("select demand_model_register($1,'pars','baseline','baseline')", [model.blob.hash])).toBe("registered");
    expect(await one("select demand_model_register($1,'pars','baseline','baseline')", [model.blob.hash])).toBe("exists");
    await fails(q("select demand_model_register($1,'labor','baseline','baseline')", [model.blob.hash]), "model_conflict");
  });
  it("records a night and replays it from the database; a later correction never moves it", async () => {
    const snap = snapshotParInputs(inputs);
    const record = parForecastRecord(forecastPars(inputs, today));
    await put([snap.manifest, ...snap.parts, record.forecast]);
    expect(await as("service_role", () => one(RECORD, args(today, snap.manifest.hash, record)))).toEqual({ recorded: 7, kept: 0 });
    const ref = { surface: "pars" as const, manifestHash: snap.manifest.hash, forecastHash: record.forecast.hash, decisionDate: today, engine: record.engine };
    expect(replayVerdict(ref, await fromDb())).toBe("reproduced");

    // The same night read again after an order correction: other inputs, another forecast.
    const corrected = buildParInputs({ scale: 1.6 });
    const snap2 = snapshotParInputs(corrected);
    const record2 = parForecastRecord(forecastPars(corrected, today));
    expect(record2.forecast.hash).not.toBe(record.forecast.hash);
    await put([snap2.manifest, ...snap2.parts, record2.forecast]);
    // FIRST WRITE WINS: the ledger keeps what was forecast at the decision.
    expect(await one(RECORD, args(today, snap2.manifest.hash, record2))).toEqual({ recorded: 0, kept: 7 });
    const rows = await q<{ manifest_hash: string; forecast_hash: string; lead_days: number }>("select manifest_hash, forecast_hash, lead_days from demand_forecast_ledger order by valid_date");
    expect(rows.map((r) => r.lead_days)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows.every((r) => r.manifest_hash === snap.manifest.hash && r.forecast_hash === record.forecast.hash)).toBe(true);
    // And the earlier night still replays to the earlier value, with the corrected parts sitting beside it.
    expect(replayVerdict(ref, await fromDb())).toBe("reproduced");
    expect(Number(await one("select count(*) from demand_input_blobs where kind = 'par_day'"))).toBe(42);
  });
  it("a forecast cannot be back-dated or post-dated, and names only what is stored", async () => {
    const snap = snapshotParInputs(inputs);
    const record = parForecastRecord(forecastPars(inputs, addDaysEt(today, -1)));
    await put([record.forecast]);
    await fails(q(RECORD, args(addDaysEt(today, -1), snap.manifest.hash, record)), "decision_date_not_today");
    await fails(q(RECORD, args(addDaysEt(today, 1), snap.manifest.hash, record)), "decision_date_not_today");
    await fails(q(RECORD, args(today, snap.manifest.hash, record)), "entries_invalid"); // a valid date before the decision
    const ok = parForecastRecord(forecastPars(inputs, today));
    await fails(q(RECORD, args(today, "f".repeat(64), ok)), "blob_missing");
    await fails(q(RECORD, [FIX_LOC, "pars", "e".repeat(64), ok.engine, snap.manifest.hash, today, JSON.stringify(ok.entries)]), "model_unknown");
    await fails(q(RECORD, [FIX_LOC, "labor", model.blob.hash, ok.engine, snap.manifest.hash, today, JSON.stringify(ok.entries)]), "model_unknown");
    await fails(q(RECORD, args(today, snap.manifest.hash, { ...ok, entries: [{ ...ok.entries[0]!, forecast_hash: "d".repeat(64) }] })), "blob_missing");
  });
});

describe("0342: targets freeze at D+4", () => {
  const FREEZE = "select demand_target_freeze($1,$2,$3,$4,$5,$6)";
  const later = buildParInputs({ runDate: "2026-10-15" });
  const read = parTargetFromInputs(later, "2026-10-14")!;
  const call = (valid: string, a: ReturnType<typeof targetFreezeArgs>) => one<string>(FREEZE, [FIX_LOC, a.target, valid, a.coverage, a.blob?.hash ?? null, a.fingerprint]);

  it("refuses before D+4 and freezes on it", async () => {
    const a = targetFreezeArgs("par_product_day_oz", "x", read);
    await put([a.blob!]);
    await fails(call(addDaysEt(today, -3), a), "target_freeze_too_early");
    await fails(call(today, a), "target_freeze_too_early");
    expect(await as("service_role", () => call(addDaysEt(today, -4), a))).toBe("frozen");
    expect(await call(addDaysEt(today, -4), a)).toBe("kept");
  });
  it("a later, different reading is a revision beside the frozen row; the frozen row stands", async () => {
    const a = targetFreezeArgs("par_product_day_oz", "x", read);
    const revised = targetFreezeArgs("par_product_day_oz", "x", { coverage: "covered", payload: { ...read.payload!, direct: { ...read.payload!.direct, extra: 5 } } });
    await put([revised.blob!]);
    expect(await call(addDaysEt(today, -4), revised)).toBe("revised");
    expect(await call(addDaysEt(today, -4), revised)).toBe("revised");
    expect(await one("select source_fingerprint from demand_target_freezes where valid_date = $1", [addDaysEt(today, -4)])).toBe(a.fingerprint);
    expect(await q("select source_fingerprint from demand_target_revisions")).toEqual([{ source_fingerprint: revised.fingerprint }]);
  });
  it("an uncaptured day is frozen as not covered: no payload, never a zero", async () => {
    const a = targetFreezeArgs("labor_sales_day", "x", { coverage: "not_covered", payload: null });
    expect(a.fingerprint).toBe(NOT_COVERED_FINGERPRINT);
    expect(await call(addDaysEt(today, -6), a)).toBe("frozen");
    expect(await call(addDaysEt(today, -6), a)).toBe("kept");
    await fails(q(FREEZE, [FIX_LOC, "labor_sales_day", addDaysEt(today, -7), "covered", null, a.fingerprint]), "blob_missing");
    await fails(q(FREEZE, [FIX_LOC, "labor_sales_day", addDaysEt(today, -7), "not_covered", blobOf("target", { y: 1 }).hash, a.fingerprint]), "demand_target_freezes");
  });
});

describe("0342: the holdout is read once per model hash, target and lead", () => {
  const CLAIM = "select demand_holdout_claim($1,$2,$3,$4,$5,$6)";
  const trend = candidateModel("labor", "trend");
  const hindsight = { ...candidateModel("labor", "calendar_holiday"), blob: blobOf("model", { kind: "candidate", signal: "observed_weather" }) };
  beforeAll(async () => {
    await put([trend.blob, hindsight.blob]);
    await q("select demand_model_register($1,'labor','trend','known_in_advance')", [trend.blob.hash]);
    await q("select demand_model_register($1,'labor','observed_weather','hindsight')", [hindsight.blob.hash]);
  });
  it("a holdout must start after the model was frozen and end on frozen days", async () => {
    await fails(q(CLAIM, [trend.blob.hash, "labor_day_cents", 7, addDaysEt(today, -30), addDaysEt(today, -5), "report"]), "holdout_before_registration");
    await fails(q(CLAIM, [trend.blob.hash, "labor_day_cents", 7, today, addDaysEt(today, 20), "report"]), "holdout_before_registration");
    await fails(q(CLAIM, ["9".repeat(64), "labor_day_cents", 7, today, today, "report"]), "model_unknown");
    // Fixture only (the table owner; no writer can do this): the model was registered 40 days ago.
    await q("update demand_models set registered_on = $2 where model_hash = $1", [trend.blob.hash, addDaysEt(today, -40)]);
    await fails(q(CLAIM, [trend.blob.hash, "labor_day_cents", 7, addDaysEt(today, -30), addDaysEt(today, -3), "report"]), "holdout_not_frozen");
    await fails(q(CLAIM, [trend.blob.hash, "labor_day_cents", 7, addDaysEt(today, -5), addDaysEt(today, -30), "report"]), "holdout_window_invalid");
  });
  it("is granted once; a second claim is told it was already read; another lead is its own read", async () => {
    const win = [addDaysEt(today, -30), addDaysEt(today, -5)];
    const first = await as("service_role", () => one<{ status: string; id: string }>(CLAIM, [trend.blob.hash, "labor_day_cents", 7, ...win, "report"]));
    expect(first.status).toBe("granted");
    const second = await one<{ status: string; id: string }>(CLAIM, [trend.blob.hash, "labor_day_cents", 7, ...win, "someone else"]);
    expect(second).toMatchObject({ status: "already_read", id: first.id });
    expect((await one<{ status: string }>(CLAIM, [trend.blob.hash, "labor_day_cents", 1, ...win, "report"])).status).toBe("granted");
    expect((await one<{ status: string }>(CLAIM, [trend.blob.hash, "labor_hour_cents", 7, ...win, "report"])).status).toBe("granted");
    expect(Number(await one("select count(*) from demand_holdout_reads"))).toBe(3);
  });
  it("a hindsight model (observed weather) can never read a holdout", async () => {
    await q("update demand_models set registered_on = $2 where model_hash = $1", [hindsight.blob.hash, addDaysEt(today, -40)]);
    await fails(q(CLAIM, [hindsight.blob.hash, "labor_day_cents", 7, addDaysEt(today, -30), addDaysEt(today, -5), "report"]), "holdout_refused_hindsight");
  });
});
