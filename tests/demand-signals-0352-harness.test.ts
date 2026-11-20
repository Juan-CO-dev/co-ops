// Item 4 PR 7: the 0352 offline proof (PGlite, single session, synthetic fixtures; no network, no sim, no prod).
// The REAL parents, the REAL 0342 and 0343, and the REAL 0352.
//  - ship state: an empty ledger; ceilings (service_role reads, writes nothing; PostgREST roles reach nothing);
//  - who may reserve (gm at their shop, moo / owner / cgs anywhere; never a level-6 role or an inactive user);
//  - ONE attempt per shop per ET day; the month's cap counts a settled call at its real cost and a failed or
//    crashed one at its FULL reservation; a caller's cap can only LOWER the ceiling;
//  - a settlement is written once; a failed one carries no claim; the stored claims' shape is checked in SQL;
//  - every reservation writes its audit row, with no content.
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshLaborParents } from "./helpers/fact-0338-parents";
import { INSIGHT_MAX_CLAIMS, INSIGHT_MAX_FACTS_PER_CLAIM, acceptClaims, type InsightFact } from "@/lib/demand-signals/insights-shared";

const M0342 = readFileSync("supabase/migrations/0342_demand_signals_replay.sql", "utf8");
const M0343 = readFileSync("supabase/migrations/0343_demand_signal_sources.sql", "utf8");
const M0352 = readFileSync("supabase/migrations/0352_demand_ai_insights.sql", "utf8");
const SHOP_A = randomUUID(), SHOP_B = randomUUID(), SHOP_C = randomUUID(), SHOP_D = randomUUID(), SHOP_E = randomUUID(), CLOSED = randomUUID();
const MOO = randomUUID(), OWNER = randomUUID(), CGS = randomUUID(), GM_A = randomUUID(), AGM = randomUUID(), SMM = randomUUID(), GONE = randomUUID();
const HASH = "a".repeat(64), MODEL = "claude-opus-5-5", CEILING = 5_000_000;

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = unknown>(sql: string, params: unknown[] = []) => Object.values((await q(sql, params))[0] as Record<string, T>)[0] as T;
const count = (table: string, where = "true") => one<number>(`select count(*)::int from ${table} where ${where}`);
const fails = async (p: Promise<unknown>, message: string) => { await expect(p).rejects.toThrow(message); };
async function as<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}
const reserve = (actor: string | null, shop: string, micro = 70_000, cap = CEILING, o: Partial<{ hash: string; model: string; version: number }> = {}) =>
  one<{ id: string; day_et: string; month_spent_before_micro: number }>("select demand_ai_reserve($1,$2,$3,$4,$5,$6,$7)",
    [actor, shop, o.hash ?? HASH, o.model ?? MODEL, o.version ?? 1, micro, cap]);
const settle = (id: string, o: Partial<{ outcome: string; input: number | null; output: number | null; micro: number | null; stop: string | null; error: string | null; claims: unknown; rejected: number }> = {}) =>
  one("select demand_ai_settle($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", [id, o.outcome ?? "ok", o.input === undefined ? 900 : o.input, o.output === undefined ? 300 : o.output,
    o.micro === undefined ? 9_600 : o.micro, o.stop === undefined ? "end_turn" : o.stop, o.error ?? null, JSON.stringify(o.claims ?? []), o.rejected ?? 0]);
const spent = () => one<number>("select demand_ai_month_spent_micro(demand_today_et())").then(Number);
const todayOf = (shop: string) => one<{ day_et: string; attempt: Record<string, unknown> | null; month_spent_micro: number; cap_ceiling_micro: number }>("select demand_ai_today($1)", [shop]);
const CLAIM = [{ type: "event_on_date", facts: [{ id: "e1", kind: "named_event", date: "2026-11-21", endDate: "2026-11-21", category: "sports_game", impact: "up" }] }];

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(`create table public.user_locations(user_id uuid not null, location_id uuid not null, active boolean not null default true, assigned_by uuid);`);
  await db.exec(M0342);
  await db.exec(M0343);
  await db.exec(M0352);
  await db.query("insert into locations(id, name, active) values ($1,'Shop A',true), ($2,'Shop B',true), ($3,'Shop C',true), ($4,'Shop D',true), ($5,'Closed',false)", [SHOP_A, SHOP_B, SHOP_C, SHOP_D, CLOSED]);
  await db.query(`insert into users(id, role, active) values ($1,'moo',true), ($2,'owner',true), ($3,'cgs',true), ($4,'gm',true), ($5,'agm',true), ($6,'social_media_mgr',true), ($7,'moo',false)`,
    [MOO, OWNER, CGS, GM_A, AGM, SMM, GONE]);
  await db.query("insert into user_locations(user_id, location_id, active) values ($1,$2,true), ($1,$3,false)", [GM_A, SHOP_A, SHOP_B]);
}, 240_000);

describe("0352: ship state and ceilings", () => {
  it("ships with an empty ledger and is this PR's one migration, by name", async () => {
    expect(await count("demand_ai_reservations")).toBe(0);
    expect(await count("demand_ai_settlements")).toBe(0);
    const files = readdirSync("supabase/migrations").filter((f) => /^\d{4}_/.test(f));
    expect(files.filter((f) => f.includes("demand_ai"))).toEqual(["0352_demand_ai_insights.sql"]);
    expect(files.filter((f) => f.startsWith("0352_"))).toEqual(["0352_demand_ai_insights.sql"]);
    expect(M0352).toMatch(/^-- AUTHORED 2026-11-19 .* NOT YET APPLIED/m);
    expect(M0352.replace(/^--.*$/gm, "")).not.toMatch(/delete from|update public\.|drop /i);
  });
  it("refuses a second apply by name", async () => {
    await fails(db.exec(M0352), "0352: already applied");
    await db.exec("rollback");
  });
  it("service_role reads and cannot write a table directly; PostgREST roles reach nothing", async () => {
    await as("service_role", async () => {
      expect(await count("demand_ai_reservations")).toBe(0);
      await fails(db.query("insert into demand_ai_settlements(reservation_id, outcome, error_code) values ($1,'failed','x')", [randomUUID()]), "permission denied");
      await fails(db.query("delete from demand_ai_reservations"), "permission denied");
      await fails(db.query("update demand_ai_reservations set reserved_micro = 1"), "permission denied");
    });
    for (const role of ["anon", "authenticated"]) {
      await as(role, async () => {
        await fails(db.query("select 1 from demand_ai_reservations"), "permission denied");
        await fails(db.query("select demand_ai_reserve($1,$2,$3,$4,1,1,1)", [MOO, SHOP_A, HASH, MODEL]), "permission denied");
        await fails(db.query("select demand_ai_today($1)", [SHOP_A]), "permission denied");
        await fails(db.query("select demand_ai_month_spent_micro(current_date)"), "permission denied");
      });
    }
  });
});

describe("0352: who may reserve, and what is refused before anything is written", () => {
  it("a level-6 role, an inactive user, nobody, and a GM outside their shop are refused by name", async () => {
    for (const actor of [AGM, SMM, GONE, null, randomUUID()]) await fails(reserve(actor, SHOP_A), "demand_ai_forbidden");
    await fails(reserve(GM_A, SHOP_B), "demand_ai_shop_forbidden");   // an inactive membership is not a membership
    await fails(reserve(GM_A, SHOP_C), "demand_ai_shop_forbidden");
    expect(await count("demand_ai_reservations")).toBe(0);
    expect(await count("audit_log", "action = 'demand_ai.request'")).toBe(0);
  });
  it("a bad hash, model, version, amount or shop is demand_ai_invalid; a cap above the ceiling is refused", async () => {
    await fails(reserve(MOO, SHOP_A, 70_000, CEILING, { hash: "nope" }), "demand_ai_invalid");
    await fails(reserve(MOO, SHOP_A, 70_000, CEILING, { model: "Some Model!" }), "demand_ai_invalid");
    await fails(reserve(MOO, SHOP_A, 70_000, CEILING, { version: 0 }), "demand_ai_invalid");
    await fails(reserve(MOO, SHOP_A, 0), "demand_ai_invalid");
    await fails(reserve(MOO, SHOP_A, 70_000, 0), "demand_ai_invalid");
    await fails(reserve(MOO, SHOP_A, 70_000, CEILING + 1), "demand_ai_invalid");   // an env value can only LOWER the cap
    await fails(reserve(MOO, CLOSED), "demand_ai_invalid");
    await fails(reserve(MOO, randomUUID()), "demand_ai_invalid");
    expect(await count("demand_ai_reservations")).toBe(0);
  });
});

describe("0352: one attempt a shop a day, the cap, and settlement", () => {
  let first: string;
  it("a GM reserves for their shop; the row and its audit row are written, with no content", async () => {
    const out = await reserve(GM_A, SHOP_A, 70_000);
    first = out.id;
    expect(Number(out.month_spent_before_micro)).toBe(0);
    expect(await spent()).toBe(70_000);   // unsettled = the full reservation
    const audit = await q<{ actor_id: string; destructive: boolean; metadata: Record<string, unknown>; resource_id: string }>(
      "select actor_id, destructive, metadata, resource_id from audit_log where action = 'demand_ai.request'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: GM_A, destructive: false, resource_id: first });
    expect(Object.keys(audit[0]!.metadata).sort()).toEqual(["cap_micro", "day_et", "location_id", "model", "month_spent_before_micro", "prompt_version", "reserved_micro"]);
    const today = await todayOf(SHOP_A);
    expect(today.attempt).toMatchObject({ id: first, settled: false, claims: [], model: MODEL });
    expect(Number(today.cap_ceiling_micro)).toBe(CEILING);
  });
  it("a second attempt for the same shop and day is refused, whoever asks; another shop is its own day", async () => {
    await fails(reserve(MOO, SHOP_A), "demand_ai_daily_limit");
    await fails(reserve(GM_A, SHOP_A, 1), "demand_ai_daily_limit");
    expect(await count("demand_ai_reservations")).toBe(1);
    expect((await todayOf(SHOP_B)).attempt).toBeNull();
  });
  it("settling records the real cost, the month then counts THAT, and the claims are kept for the page", async () => {
    await settle(first, { micro: 9_600, claims: CLAIM, rejected: 1 });
    expect(await spent()).toBe(9_600);
    const today = await todayOf(SHOP_A);
    expect(today.attempt).toMatchObject({ settled: true, outcome: "ok", stop_reason: "end_turn", rejected_count: 1 });
    expect(today.attempt!.claims).toEqual(CLAIM);
    expect(Number(today.month_spent_micro)).toBe(9_600);
  });
  it("a settlement is written once, and only for a known reservation", async () => {
    await fails(settle(first), "demand_ai_settled");
    await fails(settle(randomUUID()), "demand_ai_unknown");
    expect(await count("demand_ai_settlements")).toBe(1);
  });
  it("a FAILED call keeps its full reservation in the month and carries no claim", async () => {
    const b = await reserve(OWNER, SHOP_B, 80_000);
    await fails(settle(b.id, { outcome: "failed", error: "timeout", claims: CLAIM, input: null, output: null, micro: null, stop: null }), "demand_ai_invalid");
    await fails(settle(b.id, { outcome: "failed", error: null, input: null, output: null, micro: null, stop: null }), "demand_ai_invalid");
    await fails(settle(b.id, { outcome: "ok", input: null }), "demand_ai_invalid");
    await fails(settle(b.id, { outcome: "ok", error: "timeout" }), "demand_ai_invalid");
    await settle(b.id, { outcome: "failed", error: "timeout", input: 5, output: 5, micro: 5, stop: null });
    const row = (await q<{ input_tokens: number | null; actual_micro: number | null; error_code: string }>("select input_tokens, actual_micro, error_code from demand_ai_settlements where reservation_id = $1", [b.id]))[0]!;
    expect(row).toEqual({ input_tokens: null, actual_micro: null, error_code: "timeout" });   // a failed call's cost is unknown, never a number
    expect(await spent()).toBe(9_600 + 80_000);
  });
  it("the stored claims' shape is checked in SQL: closed claim types, closed fact kinds, at most five", async () => {
    const c = await reserve(CGS, SHOP_C, 60_000);
    const bad: unknown[] = [
      [{ type: "demand_will_surge", facts: [{ id: "e1", kind: "named_event" }] }],
      [{ type: "event_on_date", facts: [] }],
      [{ type: "event_on_date", facts: [{ id: "e1", kind: "free_text" }] }],
      [{ type: "event_on_date", facts: [{ id: 7, kind: "named_event" }] }],
      [{ type: "event_on_date" }],
      { type: "event_on_date", facts: [] },
      Array.from({ length: 6 }, () => CLAIM[0]),
    ];
    for (const claims of bad) await fails(settle(c.id, { claims }), "demand_ai_invalid");
    expect(await count("demand_ai_settlements", `reservation_id = '${c.id}'`)).toBe(0);
    // A crashed call (no settlement at all) stands at its full reservation.
    expect(await spent()).toBe(9_600 + 80_000 + 60_000);
  });
  it("the cap: the month so far plus the new reservation must fit, and a lower cap from the caller binds", async () => {
    const soFar = await spent();
    await fails(reserve(MOO, SHOP_D, 50_000, soFar + 49_999), "demand_ai_cap_reached");
    await fails(reserve(MOO, SHOP_D, CEILING, CEILING), "demand_ai_cap_reached");
    expect(await count("demand_ai_reservations")).toBe(3);
    const d = await reserve(MOO, SHOP_D, 50_000, soFar + 50_000);   // exactly at the cap fits
    expect(Number(d.month_spent_before_micro)).toBe(soFar);
    expect(await spent()).toBe(soFar + 50_000);
  });
  it("THE ACCEPTANCE-TO-SETTLEMENT BOUNDARY (review r1 P2 #2): the largest answer the app accepts is stored; one fact more is refused by the app, not here", async () => {
    await db.query("insert into locations(id, name, active) values ($1,'Shop E',true)", [SHOP_E]);
    const facts: InsightFact[] = Array.from({ length: 12 }, (_, i) => ({ id: `e${i + 1}`, kind: "named_event", date: "2026-11-21", endDate: `2026-11-${String(21 + (i % 9)).padStart(2, "0")}`,
      category: "festival_parade", impact: "unknown", origin: "manual", scope: "shop" }));
    const ids = facts.map((f) => f.id);
    const full = acceptClaims({ claims: Array.from({ length: INSIGHT_MAX_CLAIMS }, () => ({ type: "event_on_date", evidenceIds: ids.slice(0, INSIGHT_MAX_FACTS_PER_CLAIM) })), overLimit: 0 }, facts);
    expect(full.accepted).toHaveLength(INSIGHT_MAX_CLAIMS);
    expect(full.accepted.every((c) => c.facts.length === INSIGHT_MAX_FACTS_PER_CLAIM)).toBe(true);
    const e = await reserve(MOO, SHOP_E, 1_000);
    await settle(e.id, { claims: full.accepted });                    // the ledger takes exactly what the app accepted
    expect((await todayOf(SHOP_E)).attempt!.claims).toEqual(full.accepted);
    // Eleven facts in one claim: the APP refuses it (so it never reaches settlement and never burns the day on a refusal).
    const over = acceptClaims({ claims: [{ type: "event_on_date", evidenceIds: ids.slice(0, INSIGHT_MAX_FACTS_PER_CLAIM + 1) }], overLimit: 0 }, facts);
    expect(over).toEqual({ accepted: [], rejected: 1 });
    // And SQL holds the same bound if anything ever sent one.
    expect(await one("select demand_ai_claims_valid($1::jsonb)", [JSON.stringify([{ type: "event_on_date", facts: facts.slice(0, 11) }])])).toBe(false);
    expect(await one("select demand_ai_claims_valid($1::jsonb)", [JSON.stringify(Array.from({ length: 6 }, () => full.accepted[0]))])).toBe(false);
  });
  it("only THIS ET month counts toward the cap", async () => {
    expect(Number(await one("select demand_ai_month_spent_micro((date_trunc('month', demand_today_et()) - interval '1 day')::date)"))).toBe(0);
    expect(Number(await one("select demand_ai_month_spent_micro((date_trunc('month', demand_today_et()) + interval '1 month')::date)"))).toBe(0);
  });
});
